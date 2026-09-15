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
  ItemInstanceId,
} from '../../contracts/core';
import type {
  CombatAiParamsDefinition,
  CombatCounterConditionParamsDefinition,
  CombatDefinitionReader,
} from '../../contracts/combat';
import type { CombatAiDefinitions, MonsterSkillView } from './combat-ai-resolvers';
import type { ProgressionDefinitionReader, ProgressionQuery } from '../../contracts/progression';
import type { ResolverRegistry, WeightedLinearProductParams } from '../../data-runtime';
import type { EquipmentDefinition } from '../../contracts/inventory';
import type {
  CombatLoadoutQuery,
  CombatPowerInput,
  CombatResolverPort,
  EnemyActionChoice,
} from '../../modules/combat/system';
import { filterByReach } from '../../modules/combat/target-shapes';
import { resolverContext, runResolver } from './resolver-adapter';

// weighted-power shape 讀 params 的窄門（weighted-product-params 的 reader）。
export type CombatPowerParamsReader = Readonly<{
  getPowerParams(id: DefinitionId): WeightedLinearProductParams;
}>;

// P1：AI shape 與反擊述詞 shape 讀 params 的窄門。
export type CombatAiParamsReader = Readonly<{
  getAiParams(id: DefinitionId): CombatAiParamsDefinition;
  getCounterParams(id: DefinitionId): CombatCounterConditionParamsDefinition;
}>;

export type CombatResolverBridgeDeps = Readonly<{
  registry: ResolverRegistry;
  combatDefs: CombatDefinitionReader; // getSkillView / getMonster / getAiPolicy
  progressionDefs: ProgressionDefinitionReader; // getAttackMasteryAwardRule
  powerParams: CombatPowerParamsReader;
  aiParams: CombatAiParamsReader; // weighted-product-params
  statistics?: { getSnapshot(id: CharacterId, weaponSetId?: import('../../contracts/core').WeaponSetId): import('../../contracts/statistics').CharacterStatisticsSnapshot };
  progression: ProgressionQuery; // getPrimaryAttributes（power kernel 的輸入）
  loadout: CombatLoadoutQuery; // 防禦 Mastery 路由：讀該角色身上的防具
  // 由裝備實體反查它的定義（防禦路由要看 equipmentKind 與 relatedMasteryIds）。
  equipmentOf: (itemId: ItemInstanceId) => EquipmentDefinition | undefined;
  rng: DeterministicRng;
  rngContextFor: (tag: string) => RngContext; // AI 抽選用
}>;

/** Pure targeting shared by command resolution and the player's target preview. */
export function createCombatTargetResolver(registry: ResolverRegistry): CombatResolverPort['resolveSkillTargets'] {
 return input=>filterByReach(input.encounter,input.actorId,input.actorReachCells,
  runResolver<readonly CombatantId[]>(registry,input.resolverId,input,resolverContext({})).value);
}

export function createCombatResolverPort(deps: CombatResolverBridgeDeps): CombatResolverPort {
  // P1：AI／反擊 shape 的能力受限 Context。
  //
  // `getMonsterSkills` 在這裡投影而不是讓 shape 自己讀 Reader，理由與 powerContext 相同：
  // shape 只該認識「一招有多遠、付不付得起」，不該認識 MonsterDefinition／SkillView 的完整形狀。
  // 有效射程 ＝ 怪物天生攻擊格數 ＋ 招式額外距離（§2.4，與 filterByReach 的語意同源）。
  const aiDefinitions: CombatAiDefinitions = {
    getAiParams: (id) => deps.aiParams.getAiParams(id),
    getCounterParams: (id) => deps.aiParams.getCounterParams(id),
    getMonsterSkills: (actor): readonly MonsterSkillView[] => {
      if (actor.source.kind !== 'monster') return [];
      const monster = deps.combatDefs.getMonster(actor.source.monsterDefinitionId);
      return monster.skillIds.map((skillId) => {
        const view = deps.combatDefs.getSkillView(skillId);
        const affordable = view.resourceCosts.every((cost) =>
          cost.resource === 'health' ? actor.health > cost.amount : actor.mana >= cost.amount,
        );
        // `extraReachCells` 缺席**是契約定義的 0**（contracts/combat：「大多數招式沒有（省略＝0）；
        // 魔法/治療招式一律 +6」），不是「缺資料所以補一個值」。寫成顯式三元而非 `?? 0`，
        // 與 `modules/combat/system.ts` 計算有效射程時的既有寫法一致。
        const extraReachCells =
          view.targeting.extraReachCells === undefined ? 0 : view.targeting.extraReachCells;
        return {
          skillId,
          reachCells: monster.reachCells + extraReachCells,
          affordable,
        };
      });
    },
  };

  // power kernel 的能力受限 Context：傷害/治療/CTB resolver 從這裡讀 params 與雙方主屬。
  const powerContext = () =>
    resolverContext({
      definitions: {
        getPowerParams: (id: DefinitionId) => deps.powerParams.getPowerParams(id),
        getMonster: (id: MonsterDefinitionId) => deps.combatDefs.getMonster(id),
      },
      queries: {
        getPrimaryAttributes: (id: CharacterId) => deps.progression.getPrimaryAttributes(id),
        getSecondaryAttribute: (id: CharacterId, setId: import('../../contracts/core').WeaponSetId | undefined, attributeId: string) => {
          if (!deps.statistics) throw new Error('combat/statistics-query-missing');
          const value = deps.statistics.getSnapshot(id, setId).secondaryAttributes[attributeId as import('../../contracts/core').SecondaryAttributeId];
          if (value === undefined) throw new Error('combat/secondary-attribute-missing');
          return value;
        },
      },
    });

  return {
    // 傷害/治療/CTB 的實際數值：resolverId 由規則帶入，走 weighted-power kernel。
    resolvePower: (input: CombatPowerInput): number => {
      const power = runResolver<number>(deps.registry, input.resolverId, input, powerContext()).value;
      const target = input.targetId === undefined ? undefined : input.encounter.combatants[input.targetId];
      if (input.mitigationSecondaryId === undefined || target?.source.kind !== 'character') return power;
      if (!deps.statistics) throw new Error('combat/statistics-query-missing');
      const ratio = deps.statistics.getSnapshot(target.source.characterId, target.activeWeaponSetId).secondaryAttributes[input.mitigationSecondaryId];
      if (ratio === undefined || !Number.isFinite(ratio) || ratio < 0 || ratio > 1) throw new Error('combat/invalid-damage-reduction');
      return power * (1 - ratio);
    },

    // 合法目標集合：純格陣 shape 產候選，再以 Handler 算好的有效射程（input.actorReachCells）做排距過濾
    //（敵方超射程剔除；同側不受限）。shape 無 params、無 RNG。
    resolveSkillTargets: createCombatTargetResolver(deps.registry),

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

    // 防禦 MXP 路由：這一份經驗記進**身上那件防具**的熟練度。
    //
    // 為什麼不必再繞一個 Resolver：路由的自由度在資料裡已經用完了。
    // `EquipmentDefinition.relatedMasteryIds` 就是「這件裝備練哪一項」的宣告（輕甲→輕甲熟練、
    // 圓盾→單手盾熟練），而雲華的防具每件只占一格 `body`、盾只占手格——所以「穿哪件」對應
    // 「練哪項」是一對一，沒有需要決定的事。
    //
    // 優先序：防具（armor）優先於盾（shield）。文件（mastery_experience_economy_v1.md §六）寫
    // 「個人份額最後進入哪些防具／盾牌 Mastery」——兩者都可能，而承受傷害的主體是身上的甲；
    // 只有在完全沒穿甲時，這一份才記到盾上。
    //
    // 兩件都沒有 → `undefined`：那是「這一份沒有去處」，呼叫端略過（見 CombatResolverPort 的說明）。
    resolveDefenseMastery: (characterId: CharacterId): MasteryId | undefined => {
      const loadout = deps.loadout.getEquipmentLoadout(characterId);
      const worn: EquipmentDefinition[] = [];
      for (const itemId of Object.values(loadout.armorSlots)) {
        if (itemId === undefined) continue;
        const def = deps.equipmentOf(itemId);
        if (def !== undefined) worn.push(def);
      }
      for (const set of loadout.weaponSets) {
        for (const itemId of [set.mainHandItemId, set.offHandItemId]) {
          if (itemId === undefined) continue;
          const def = deps.equipmentOf(itemId);
          if (def !== undefined) worn.push(def);
        }
      }
      const pick = (kind: EquipmentDefinition['equipmentKind']): MasteryId | undefined =>
        worn.find((d) => d.equipmentKind === kind && d.relatedMasteryIds.length > 0)
          ?.relatedMasteryIds[0];
      return pick('armor') ?? pick('shield');
    },

    // 敵方 AI：讀怪物 ai-policy 的 behaviorResolverId，走該 resolver 選招＋目標（用 RNG）。
    // 缺少指名的 AI resolver 時由 registry.require 明確拋錯，不靜默改成休息。
    chooseEnemyAction: ({ encounter, actorId }): EnemyActionChoice | undefined => {
      const actor = encounter.combatants[actorId];
      if (actor === undefined || actor.source.kind !== 'monster') return undefined;
      const monster = deps.combatDefs.getMonster(actor.source.monsterDefinitionId);
      const policy = deps.combatDefs.getAiPolicy(monster.aiPolicyId);
      return runResolver<EnemyActionChoice | undefined>(
        deps.registry,
        policy.behaviorResolverId,
        { encounter, actorId },
        resolverContext({
          definitions: aiDefinitions,
          rng: deps.rng,
          rngContext: deps.rngContextFor('combat.ai'),
        }),
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
        resolverContext({ definitions: aiDefinitions }),
      ).value;
    },
  };
}
