import Ajv from 'ajv';
import schema from './game-state.schema.json';
import type { GameState } from '../composition/state';
import type { DefinitionRegistry } from '../../data-runtime';
import { fnv1a64, toHex16 } from '../../kernel/hash';
import { JOB_TYPE_ORDER_BY_PHASE } from '../composition/manifest';
import { restoreState, type SavedGameState } from './save-state';

// Generated from the actual GameState contract. No coercion, defaults or removal of invalid data.
const validateState = new Ajv({ strict: false, allErrors: true }).compile<SavedGameState>(schema);
const saveSchemaVersion = 1;

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

export function decodeSave(text: string, registry: DefinitionRegistry): GameState {
  const envelope: unknown = JSON.parse(text);
  if (!object(envelope) || typeof envelope.payload !== 'string' ||
      envelope.checksum !== toHex16(fnv1a64(envelope.payload))) {
    throw new Error('save/checksum-mismatch');
  }
  const payload: unknown = JSON.parse(envelope.payload);
  if (!object(payload) || payload.saveSchemaVersion !== saveSchemaVersion) {
    throw new Error('save/schema-version-incompatible');
  }
  if (payload.schemaHash !== toHex16(fnv1a64(JSON.stringify(schema)))) {
    throw new Error('save/schema-version-incompatible');
  }
  if (JSON.stringify(payload.content) !== JSON.stringify(registry.getManifestIdentity())) {
    throw new Error('save/content-incompatible');
  }
  if (!validateState(payload.state)) {
    throw new Error(`save/invalid-state: ${JSON.stringify(validateState.errors?.slice(0, 3))}`);
  }
  const state = restoreState(payload.state);
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
  return state;
}
