// app/content/combat-power-resolvers.ts
// combat 的數值 Resolver：傷害／治療／CTB 調整（CombatResolverPort.resolvePower 的實作）。
// 主屬與角色裝備副屬攤平成 kernel 輸入；公式係數由 content-source/core/combat-resolver-params.ts 提供。

import {
  weightedLinearProduct,
  type KernelInputs,
  type WeightedLinearProductParams,
  type AnyResolverRegistration,
  type ResolverRegistration,
} from '../../data-runtime';
import type {
  CharacterId,
  DefinitionId,
  MonsterDefinitionId,
  ResolverBinding,
  SchemaId,
} from '../../contracts/core';
import type { MonsterDefinition } from '../../contracts/combat';
import type { PrimaryAttributeId } from '../../contracts/progression';
import type { CombatPowerInput } from '../../modules/combat/system';
import type { CombatantState } from '../../modules/combat/state';

// 五個主屬（與 combat/system.ts 的 PRIMARY_ATTRIBUTE_IDS 同一組結構常數）。
const PRIMARY_ATTRIBUTE_IDS: readonly PrimaryAttributeId[] = [
  'muscle',
  'intelligence',
  'reaction',
  'coordination',
  'charisma',
];

const POWER_INPUT_SCHEMA = 'schema:combat-power-input' as SchemaId;
const NUMBER_RESULT_SCHEMA = 'schema:number-result' as SchemaId;

// 本形狀需要的窄化 Context（由 combat resolver bridge 於 ContextAssembler 注入；測試以 stub 提供）。
export type CombatPowerDefinitions = Readonly<{
  getPowerParams(id: DefinitionId): WeightedLinearProductParams;
  getMonster(id: MonsterDefinitionId): MonsterDefinition;
}>;
export type CombatPowerQueries = Readonly<{
  getSecondaryAttribute(characterId: CharacterId, weaponSetId: import('../../contracts/core').WeaponSetId | undefined, attributeId: string): number;
  getPrimaryAttributes(characterId: CharacterId): Readonly<Record<PrimaryAttributeId, number>>;
}>;

function attributesOf(
  combatant: CombatantState,
  defs: CombatPowerDefinitions,
  queries: CombatPowerQueries,
): Readonly<Record<PrimaryAttributeId, number>> {
  if (combatant.source.kind === 'character') {
    return queries.getPrimaryAttributes(combatant.source.characterId);
  }
  const monster = defs.getMonster(combatant.source.monsterDefinitionId);
  return {
    muscle: monster.attributes.muscle,
    intelligence: monster.attributes.intelligence,
    reaction: monster.attributes.reaction,
    coordination: monster.attributes.coordination,
    charisma: monster.attributes.charisma,
  };
}

// 攤平行動者（＋目標，若有）的主屬為 KernelInputs。行動者必存在（Handler 前置已驗）；缺＝結構被破壞，拋。
function gatherInputs(
  input: CombatPowerInput,
  defs: CombatPowerDefinitions,
  queries: CombatPowerQueries,
): KernelInputs {
  const out: Record<string, number> = {};
  const actor = input.encounter.combatants[input.actorId];
  if (actor === undefined) {
    throw new Error(`combat:weighted-power: 行動者 ${String(input.actorId)} 不在遭遇中`);
  }
  const actorAttrs = attributesOf(actor, defs, queries);
  for (const attr of PRIMARY_ATTRIBUTE_IDS) out[`actor.${attr}`] = actorAttrs[attr];

  if (input.targetId !== undefined) {
    const target = input.encounter.combatants[input.targetId];
    if (target !== undefined) {
      const targetAttrs = attributesOf(target, defs, queries);
      for (const attr of PRIMARY_ATTRIBUTE_IDS) out[`target.${attr}`] = targetAttrs[attr];
    }
  }
  return out;
}

function weightedPowerRegistration(
  binding: ResolverBinding,
): ResolverRegistration<CombatPowerInput, number> {
  const paramsDefId = binding.paramsDefId;
  if (paramsDefId === undefined) {
    throw new Error(
      `combat:weighted-power 綁定缺 paramsDefId（Resolver ${String(binding.resolverId)}）——` +
        `這個 shape 的數值住在一筆 weighted-product-params，binding 必須指向它。`,
    );
  }
  return {
    resolverId: binding.resolverId,
    ownerModule: binding.ownerModule,
    inputSchemaId: POWER_INPUT_SCHEMA,
    resultSchemaId: NUMBER_RESULT_SCHEMA,
    resolve: (input, ctx) => {
      const defs = ctx.definitions as CombatPowerDefinitions;
      const queries = ctx.queries as CombatPowerQueries;
      const params = defs.getPowerParams(paramsDefId);
      const inputs: Record<string, number> = { ...gatherInputs(input, defs, queries) };
      for (const term of params.terms) {
        const match = /^(actor|target)\.secondary\.(.+)$/.exec(term.inputKey);
        if (!match) continue;
        const id = match[1] === 'actor' ? input.actorId : input.targetId;
        const unit = id === undefined ? undefined : input.encounter.combatants[id];
        if (!unit) throw new Error('combat/power-combatant-missing');
        // 怪物沒有角色裝備；天生力量已由其主屬項提供。
        inputs[term.inputKey] = unit.source.kind === 'monster' ? 0 : queries.getSecondaryAttribute(unit.source.characterId, unit.activeWeaponSetId, match[2]!);
      }
      return { value: weightedLinearProduct(params, inputs) };
    },
  };
}

export const COMBAT_POWER_SHAPE_BUILDERS: Readonly<
  Record<string, (binding: ResolverBinding) => AnyResolverRegistration>
> = {
  'combat:weighted-power': weightedPowerRegistration,
};
