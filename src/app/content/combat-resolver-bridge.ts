// app/content/combat-resolver-bridge.ts
// CombatResolverPort 的真實實作：把 combat Handler 需要的每個 resolver 方法橋到 data-runtime
// ResolverRegistry（傷害/治療/CTB/AI/反擊條件走 resolverId）或直接讀 Definition（攻/防 Mastery 路由）。
//
// 這是「Handler 只消費結果、公式藏在 resolver 後」的落地點：Handler 拿到的 CombatResolverPort 就是本檔。
// power（傷害/治療/CTB）走 §7.1 kernel（weighted-power shape，數值在 weighted-product-params 內容）；
// 目標走純格陣 shape；AI／反擊條件走各自 resolver（尚未實作者，registry.require 會明確拋，不靜默）。

import type {
  CharacterId,
  CombatantId,
  DefinitionId,
  DeterministicRng,
  MasteryId,
  MonsterDefinitionId,
  RngContext,
  SkillDefinitionId,
} from '../../contracts/core';
import type { CombatDefinitionReader } from '../../contracts/combat';
import type { ProgressionDefinitionReader, ProgressionQuery } from '../../contracts/progression';
import type { ResolverRegistry, WeightedLinearProductParams } from '../../data-runtime';
import type {
  CombatLoadoutQuery,
  CombatPowerInput,
  CombatResolverPort,
  CombatSkillTargetInput,
  EnemyActionChoice,
} from '../../modules/combat/system';
import { resolverContext, runResolver } from './resolver-adapter';

// weighted-power shape 讀 params 的窄門（weighted-product-params 的 reader）。
export type CombatPowerParamsReader = Readonly<{
  getPowerParams(id: DefinitionId): WeightedLinearProductParams;
}>;

export type CombatResolverBridgeDeps = Readonly<{
  registry: ResolverRegistry;
  combatDefs: CombatDefinitionReader; // getSkillView / getMonster / getAiPolicy
  progressionDefs: ProgressionDefinitionReader; // getAttackMasteryAwardRule
  powerParams: CombatPowerParamsReader; // weighted-product-params
  progression: ProgressionQuery; // getPrimaryAttributes（power kernel 的輸入）
  loadout: CombatLoadoutQuery; // 防禦 Mastery 路由用（本版尚未接）
  rng: DeterministicRng;
  rngContextFor: (tag: string) => RngContext; // AI 抽選用
}>;

export function createCombatResolverPort(deps: CombatResolverBridgeDeps): CombatResolverPort {
  // power kernel 的能力受限 Context：傷害/治療/CTB resolver 從這裡讀 params 與雙方主屬。
  const powerContext = () =>
    resolverContext({
      definitions: {
        getPowerParams: (id: DefinitionId) => deps.powerParams.getPowerParams(id),
        getMonster: (id: MonsterDefinitionId) => deps.combatDefs.getMonster(id),
      },
      queries: { getPrimaryAttributes: (id: CharacterId) => deps.progression.getPrimaryAttributes(id) },
    });

  return {
    // 傷害/治療/CTB 的實際數值：resolverId 由規則帶入，走 weighted-power kernel。
    resolvePower: (input: CombatPowerInput): number =>
      runResolver<number>(deps.registry, input.resolverId, input, powerContext()).value,

    // 合法目標集合：純格陣 shape，無 params、無 RNG。射程過濾在下一個增量隨 Handler 算出的有效射程接上。
    resolveSkillTargets: (input: CombatSkillTargetInput): readonly CombatantId[] =>
      runResolver<readonly CombatantId[]>(deps.registry, input.resolverId, input, resolverContext({}))
        .value,

    // 攻擊 MXP 路由：讀該技能的 attack-mastery-award-rule，取占比最高的 Mastery。
    // 第一版單一路由（完整比例分配走結算，見帳本待討論）；缺規則＝內容錯，明確拋。
    resolveAttackMastery: (skillId: SkillDefinitionId): MasteryId => {
      const ruleId = deps.combatDefs.getSkillView(skillId).attackMasteryAwardRuleId;
      if (ruleId === undefined) {
        throw new Error(`combat-bridge: 技能 ${String(skillId)} 無 attackMasteryAwardRuleId`);
      }
      const splits = deps.progressionDefs.getAttackMasteryAwardRule(ruleId).masterySplits;
      let best = splits[0];
      if (best === undefined) {
        throw new Error(`combat-bridge: attack-mastery-award-rule ${String(ruleId)} 無 masterySplits`);
      }
      for (const split of splits) if (split.ratio > best.ratio) best = split;
      return best.masteryId;
    },

    // 防禦 MXP 路由：讀防禦裝備 → defense-mastery-routing-rule → mastery。整合塊·防禦 MXP 增量接線；
    // 玩家攻擊的基本戰不觸及（沒有角色在此路徑防禦）。未接時明確拋，不回假值。
    resolveDefenseMastery: (characterId: CharacterId): MasteryId => {
      throw new Error(
        `combat-bridge: resolveDefenseMastery 尚未接線（characterId=${String(characterId)}）——` +
          `待防禦 MXP 增量（讀防禦裝備＋defense-mastery-routing-rule）。`,
      );
    },

    // 敵方 AI：讀怪物 ai-policy 的 behaviorResolverId，走該 resolver 選招＋目標（用 RNG）。
    // AI resolver 尚未實作＝registry.require 明確拋（不靜默休息）。
    chooseEnemyAction: ({ encounter, actorId }): EnemyActionChoice | undefined => {
      const actor = encounter.combatants[actorId];
      if (actor === undefined || actor.source.kind !== 'monster') return undefined;
      const monster = deps.combatDefs.getMonster(actor.source.monsterDefinitionId);
      const policy = deps.combatDefs.getAiPolicy(monster.aiPolicyId);
      return runResolver<EnemyActionChoice | undefined>(
        deps.registry,
        policy.behaviorResolverId,
        { encounter, actorId },
        resolverContext({ rng: deps.rng, rngContext: deps.rngContextFor('combat.ai') }),
      ).value;
    },

    // 反擊條件：讀守方架勢的 conditionResolverId，走該述詞 resolver。條件 resolver 尚未實作＝明確拋。
    evaluateCounterStance: (input): boolean => {
      const defender = input.encounter.combatants[input.defenderId];
      if (defender === undefined || defender.counterStance === undefined) return false;
      return runResolver<boolean>(
        deps.registry,
        defender.counterStance.conditionResolverId,
        input,
        resolverContext({}),
      ).value;
    },
  };
}
