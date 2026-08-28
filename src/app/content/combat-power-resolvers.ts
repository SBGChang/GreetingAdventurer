// app/content/combat-power-resolvers.ts
// combat 的數值 Resolver：傷害／治療／CTB 調整（CombatResolverPort.resolvePower 的實作）。
//
// 「形狀＝程式，數值＝內容」（規範 §7.1）：本檔用**單一** kernel 形狀 `combat:weighted-power`
// 服務全部傷害/治療/CTB resolver。差別**只在內容**——每個 resolver 綁定一筆 weighted-product-params
// （bias + 具名 terms），terms 用哪些屬性、權重多少，全由那筆 params 決定。因此：
//   * 物理/魔法/樂器傷害的差別 = 三筆 params 分別取 muscle/intelligence/charisma（見 combat-rules 的通道）。
//   * 傷害含「− 目標屬」減項、治療只有「+ 行動者屬」、CTB 只有常數 bias——全是 params 的 terms 差異。
// 程式這邊完全不含任何倍率或屬性選擇；那些是我設計的第一版數值，記在 docs/first_version_design_ledger.html。
//
// 輸入組裝：把行動者與（若有）目標的五個主屬攤成 KernelInputs 的 `actor.<attr>` / `target.<attr>`。
// 角色的屬性走 progression Query，怪物的走 Monster Definition——與 combat/system.ts 的 attributesOf 同源。

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
      return { value: weightedLinearProduct(params, gatherInputs(input, defs, queries)) };
    },
  };
}

export const COMBAT_POWER_SHAPE_BUILDERS: Readonly<
  Record<string, (binding: ResolverBinding) => AnyResolverRegistration>
> = {
  'combat:weighted-power': weightedPowerRegistration,
};
