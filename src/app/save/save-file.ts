import { upgradeCharacterNames, type UnnamedSavedGameState } from './name-upgrade';
import { createCharacterNameReader } from '../content/character-name-reader';
import { characterNameDisplay } from '../../modules/character/public';
import { PREVIOUS_CONTENT, PREVIOUS_SCHEMA_HASH, PRE_NAMING_CONTENT, PRE_NAMING_SCHEMA_HASH, TARGET_CONTENT } from './content-upgrade';
import Ajv from 'ajv';
import schema from './game-state.schema.json';
import type { GameState } from '../composition/state';
import type { DefinitionRegistry } from '../../data-runtime';
import { fnv1a64, toHex16 } from '../../kernel/hash';
import { JOB_TYPE_ORDER_BY_PHASE } from '../composition/manifest';
import { restoreState, type SavedGameState } from './save-state';

// Generated from the actual GameState contract. No coercion, defaults or removal of invalid data.
const validateState = new Ajv({ strict: false, allErrors: true }).compile<SavedGameState>(schema);
const saveSchemaVersion = 2;
// The only schema change to Character in the two explicitly supported predecessors is the missing name.
const unnamedSchema = structuredClone(schema);
const { name: omittedName, ...unnamedProperties } = unnamedSchema.definitions.Character.properties;
void omittedName;
Object.assign(unnamedSchema.definitions.Character, { properties: unnamedProperties,
  required: unnamedSchema.definitions.Character.required.filter(key => key !== 'name') });
const validateUnnamedState = new Ajv({ strict: false, allErrors: true }).compile<UnnamedSavedGameState>(unnamedSchema);

export function encodeSave(state: GameState, registry: DefinitionRegistry): string {
  const payload = JSON.stringify({
    saveSchemaVersion,
    schemaHash: toHex16(fnv1a64(JSON.stringify(schema))),
    content: registry.getManifestIdentity(),
    state,
  });
  // Check the JSON representation too: JSON.stringify turns NaN/Infinity into null.
  decodeSave(JSON.stringify({ payload, checksum: toHex16(fnv1a64(payload)) }), registry);
  return JSON.stringify({ payload, checksum: toHex16(fnv1a64(payload)) });
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function decodeSave(text: string, registry: DefinitionRegistry, upgrade?: (state: GameState) => GameState): GameState {
  const envelope: unknown = JSON.parse(text);
  if (!object(envelope) || typeof envelope.payload !== 'string' ||
      envelope.checksum !== toHex16(fnv1a64(envelope.payload))) {
    throw new Error('save/checksum-mismatch');
  }
  const payload: unknown = JSON.parse(envelope.payload);
  if (!object(payload) || (payload.saveSchemaVersion !== saveSchemaVersion && payload.saveSchemaVersion !== 1)) {
    throw new Error('save/schema-version-incompatible');
  }
  const isTarget = JSON.stringify(registry.getManifestIdentity()) === JSON.stringify(TARGET_CONTENT);
  const needsWorldUpgrade = isTarget && payload.saveSchemaVersion === 1 && JSON.stringify(payload.content) === JSON.stringify(PREVIOUS_CONTENT) && payload.schemaHash === PREVIOUS_SCHEMA_HASH;
  const needsNameUpgrade = needsWorldUpgrade || (isTarget && payload.saveSchemaVersion === 1 && JSON.stringify(payload.content) === JSON.stringify(PRE_NAMING_CONTENT) && payload.schemaHash === PRE_NAMING_SCHEMA_HASH);
  if (!needsNameUpgrade && (payload.saveSchemaVersion !== saveSchemaVersion || payload.schemaHash !== toHex16(fnv1a64(JSON.stringify(schema))))) throw new Error('save/schema-version-incompatible');
  if (!needsNameUpgrade && JSON.stringify(payload.content) !== JSON.stringify(registry.getManifestIdentity())) throw new Error('save/content-incompatible');
  let savedState: unknown = payload.state;
  if (needsNameUpgrade) {
    if (!validateUnnamedState(savedState)) throw new Error(`save/invalid-state: ${JSON.stringify(validateUnnamedState.errors?.slice(0, 3))}`);
    savedState = upgradeCharacterNames(savedState, registry);
  }
  if (!validateState(savedState)) throw new Error(`save/invalid-state: ${JSON.stringify(validateState.errors?.slice(0, 3))}`);
  const state = restoreState(savedState);
  const nameReader = createCharacterNameReader(registry);
  for (const character of Object.values(state.character.characters)) characterNameDisplay(nameReader, character.name);

  if (!Number.isSafeInteger(state.core.worldDay) || state.core.worldDay < 0 ||
      !Number.isSafeInteger(state.core.nextRuntimeSequence) || state.core.nextRuntimeSequence < 0 ||
      state.core.worldSeed.trim() === '') throw new Error('save/invalid-core');
  const team = state.team.teams[state.team.playerTeamId];
  if (team === undefined || !team.memberIds.includes(team.leaderId) ||
      team.memberIds.some(id => state.character.characters[id] === undefined)) {
    throw new Error('save/invalid-player-team');
  }
  const jobTypes = new Set(Object.values(JOB_TYPE_ORDER_BY_PHASE).flat());
  for (const [id, job] of Object.entries(state.core.scheduler.jobsById)) {
    if (job.jobId !== id || !jobTypes.has(job.type) || !Number.isSafeInteger(job.dueDay) || job.dueDay < 0) {
      throw new Error('save/invalid-scheduler');
    }
  }
  if (needsWorldUpgrade) {
    if (!upgrade) throw new Error('save/content-upgrade-required');
    return upgrade(state);
  }
  return state;
}
