// app/content/combat-resolver-bridge.test.ts
// 證明 combat resolver bridge 把**真實內容**的傷害 params 一路算成傷害數字。
// 路徑：content/** → registry（weighted-power 綁定）＋ weighted-product-params reader → bridge.resolvePower
//   → §7.1 kernel（bias + actor.muscle×1.5 − target.muscle×1）。這是「作者寫下的數字真的算出戰鬥結果」。

import { resolve } from 'node:path';

import type { CombatantId, ResolverId } from '../../contracts/core';
import type { PrimaryAttributeId } from '../../contracts/progression';
import type { WeightedLinearProductParams } from '../../data-runtime';
import { loadContentFromDisk } from '../../platform/content-repository';
import { deterministicRng } from '../../kernel/rng';
import { makeEncounter, stubLoadoutQuery, stubProgressionQuery } from '../../modules/combat/fixtures';
import { createCombatDefinitionReader } from './combat-reader';
import { createProgressionDefinitionReader } from './progression-reader';
import { narrowedDomainReader } from './reader-adapter';
import { createProductionResolverRegistry } from './resolver-registrations';
import { createCombatResolverPort } from './combat-resolver-bridge';

const CONTENT_ROOT = resolve(import.meta.dirname, '../../../content');

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

// 攻方 p1 muscle 20、目標 p2 muscle 10；其餘主屬 0。以 combat fixtures 的完整 ProgressionQuery 為底、
// 只覆寫 getPrimaryAttributes（避免 as-cast，且 resolvePower 只用到這一個查詢）。
function attributesById(id: unknown): Readonly<Record<PrimaryAttributeId, number>> {
  const muscle: Record<string, number> = { 'char-p1': 20, 'char-p2': 10, p1: 20, p2: 10 };
  return { muscle: muscle[String(id)] ?? 0, intelligence: 0, reaction: 0, coordination: 0, charisma: 0 };
}

export function runTests(): void {
  const loaded = loadContentFromDisk(CONTENT_ROOT);
  if (!loaded.success) throw new Error('內容載入失敗');

  const registry = createProductionResolverRegistry(loaded.resolverBindings);
  const combatDefs = createCombatDefinitionReader(loaded.registry);
  const progressionDefs = createProgressionDefinitionReader(loaded.registry);
  const powerParamsReader = narrowedDomainReader<WeightedLinearProductParams>(
    loaded.registry,
    'test:combat-power-params',
    ['weighted-product-params'],
  );

  let weaponDamage = 0;
  const bridge = createCombatResolverPort({
    statistics: { getSnapshot: id => ({
      effectivePrimaryAttributes: attributesById(id),
      secondaryAttributes: { 'secondary-attribute.core.physical-damage': weaponDamage, 'secondary-attribute.core.general-damage-reduction': 0.5 },
      maxHealth: 200, maxMana: 120, carryingCapacity: 30, sourceRevisionKey: 'test',
    }) },
    registry,
    combatDefs,
    progressionDefs,
    powerParams: { getPowerParams: (id) => powerParamsReader.get(id) },
    // 本測試只驗 power／目標，不走 AI 路徑；碰到就是測試寫錯，明確拋而不是給假 params。
    aiParams: {
      getAiParams: () => {
        throw new Error('combat-resolver-bridge.test：本測試不應觸及 AI params');
      },
      getCounterParams: () => {
        throw new Error('combat-resolver-bridge.test：本測試不應觸及反擊 params');
      },
    },
    progression: { ...stubProgressionQuery(), getPrimaryAttributes: (id) => attributesById(id) },
    loadout: stubLoadoutQuery(),
    // 本測試不觸及防禦 MXP 路由：沒有裝備定義可查（回 undefined ＝「沒有可歸屬的防具」）。
    equipmentOf: () => undefined,
    rng: deterministicRng,
    rngContextFor: () => ({ worldSeed: 'seed' as never, streamId: 'combat.ai' as never, cursor: 0 as never }),
  });

  // 兩名角色（都走 progression 屬性；resolvePower 不需 monster）。
  const encounter = makeEncounter([
    { combatantId: 'p1', side: 'player', row: 0, col: 0 },
    { combatantId: 'p2', side: 'player', row: 0, col: 1 },
  ]);

  // 用**內容裡真的**物理傷害 resolver ID（core 綁定 → weighted-power → damage-physical params）。
  const damage = bridge.resolvePower({
    resolverId: 'resolver:combat.damage-power.physical' as ResolverId,
    encounter,
    actorId: 'p1' as CombatantId,
    targetId: 'p2' as CombatantId,
  });

  // 真實內容 params：bias 5 + actor.muscle×1.5 − target.muscle×1 = 5 + 30 − 10 = 25。
  weaponDamage = 60;
  const equippedDamage = bridge.resolvePower({ resolverId: 'resolver:combat.damage-power.physical' as ResolverId,
    encounter, actorId: 'p1' as CombatantId, targetId: 'p2' as CombatantId,
    mitigationSecondaryId: 'secondary-attribute.core.general-damage-reduction' as import('../../contracts/core').SecondaryAttributeId });
  assert(equippedDamage === 42.5, `武器與 50% 減傷應為 42.5，實得 ${equippedDamage}`);
  assert(damage === 25, `真實內容物理傷害應為 25，實得 ${String(damage)}`);
}
