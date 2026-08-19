// modules/combat/fixtures.ts
// 最小 Fixture：玩家隊（2 名角色）對一個小型敵群（2 隻小怪）+ 決定性 stub Port。
// 所有 stub 皆決定性（無真 RNG / 時間）；RNG 只經注入的 DeterministicRng + Encounter RngContext。

import type {
  ContentPackId,
  ResolverId,
  TeamId,
  CharacterId,
  MasteryId,
  WeaponSetId,
  EncounterId,
  CombatantId,
  RuntimeEnemyId,
  MonsterDefinitionId,
  SkillDefinitionId,
  CombatEffectDefinitionId,
  CombatStatusInstanceId,
  CombatRuleId,
  EncounterGroupDefinitionId,
  OpeningCtbRuleId,
  ActionDelayRuleId,
  CombatDamageRuleId,
  CombatHealRuleId,
  CombatCtbAdjustmentRuleId,
  CombatInterruptionRuleId,
  CombatStatusDefinitionId,
  EncounterExperienceBudgetId,
  MonsterExperienceProfileId,
  AttackMasteryAwardRuleId,
  SupportMasteryAwardRuleId,
  MonsterNaturalAttackProfileId,
  CombatControlResistanceProfileId,
  CombatAiPolicyId,
  DefinitionId,
  RngContext,
  RngStreamId,
  Seed,
  RngCursor,
  Revision,
  MapInstanceId,
  ContentInstanceId,
} from '../../contracts/core';
import type {
  CombatDefinitionReader,
  CombatRuleDefinition,
  EncounterGroupDefinition,
  MonsterDefinition,
  CombatSkillDefinitionView,
  OpeningCtbRuleDefinition,
  ActionDelayRuleDefinition,
  CombatStatusDefinition,
  CombatEffectDefinition,
  CombatDamageRuleDefinition,
  CombatHealRuleDefinition,
  CombatCtbAdjustmentRuleDefinition,
  CombatInterruptionRuleDefinition,
  CombatControlResistanceProfileDefinition,
  EquipmentEffectDefinition,
  CombatAiPolicyDefinition,
  EncounterExperienceBudgetDefinition,
  MonsterExperienceProfileDefinition,
  StartCombatEncounterCommand,
  CombatEncounterSource,
  CombatDamageChannel,
} from '../../contracts/combat';
import type { PrimaryAttributes, ProgressionQuery } from '../../contracts/progression';
import type { CharacterEquipmentLoadoutView } from '../../contracts/inventory';
import { deterministicRng } from '../../kernel/rng';

import type {
  CombatEncounter,
  CombatantState,
  CounterStanceInstance,
} from './state';
import { rebuildGrid, localCell } from './state';
import type {
  CombatHandlerContext,
  CombatIdAllocator,
  CombatLoadoutQuery,
  CombatFormationQuery,
  CombatFormationSnapshot,
  CombatResolverPort,
  EnemyActionChoice,
  CombatPowerInput,
} from './system';

// ── ID 常數 ─────────────────────────────────────────────────────────────
const PACK_ID = 'pack-test' as ContentPackId;

export const TEAM_ID = 'team-player' as TeamId;
export const HERO_ID = 'char-hero' as CharacterId;
export const MAGE_ID = 'char-mage' as CharacterId;

export const WEAPON_SET_A = 'ws-a' as WeaponSetId;
export const WEAPON_SET_B = 'ws-b' as WeaponSetId;
export const WEAPON_SET_C = 'ws-c' as WeaponSetId;

export const SWORD_MASTERY = 'mastery-sword' as MasteryId;
export const ARMOR_MASTERY = 'mastery-armor' as MasteryId;
export const SUPPORT_MASTERY = 'mastery-support' as MasteryId;

export const SKILL_STRIKE = 'skill-strike' as SkillDefinitionId;
export const SKILL_COUNTER = 'skill-counter' as SkillDefinitionId;
export const SKILL_HEAL = 'skill-heal' as SkillDefinitionId;
export const SKILL_BITE = 'skill-bite' as SkillDefinitionId;
// actionKind='cast' 但帶 dealDamage 效果——用來證明側別由**效果**推定，非 actionKind（不能靠標成 cast 繞過）。
export const SKILL_CAST_DAMAGE = 'skill-cast-damage' as SkillDefinitionId;
// 純控制技能：只帶 adjustCtb／interruptCasting，不帶傷害——側別因此不由 dealDamage 推定，
// 正好是「其餘效果側別待資料化 targeting resolver」那條路徑上的受測對象。
export const SKILL_CTB_DELAY = 'skill-ctb-delay' as SkillDefinitionId;
export const SKILL_INTERRUPT = 'skill-interrupt' as SkillDefinitionId;

export const EFF_DAMAGE = 'eff-damage' as CombatEffectDefinitionId;
export const EFF_COUNTER_DAMAGE = 'eff-counter-damage' as CombatEffectDefinitionId;
export const EFF_HEAL = 'eff-heal' as CombatEffectDefinitionId;
export const EFF_MONSTER_DAMAGE = 'eff-monster-damage' as CombatEffectDefinitionId;
// 控制類效果（§2.6 控制抗性的受測對象）。
export const EFF_CTB_DELAY = 'eff-ctb-delay' as CombatEffectDefinitionId;
export const EFF_INTERRUPT = 'eff-interrupt' as CombatEffectDefinitionId;

export const DMG_PHYSICAL = 'dmg-physical' as CombatDamageRuleId;
export const DMG_MONSTER = 'dmg-monster' as CombatDamageRuleId;
export const HEAL_RULE = 'heal-basic' as CombatHealRuleId;
export const CTB_RULE = 'ctb-standard' as CombatCtbAdjustmentRuleId;
export const INTERRUPT_RULE = 'interrupt-standard' as CombatInterruptionRuleId;

export const RES_DAMAGE = 'res-damage' as ResolverId;
export const RES_MONSTER_DAMAGE = 'res-monster-damage' as ResolverId;
export const RES_HEAL = 'res-heal' as ResolverId;

export const OPENING_CTB_RULE = 'opening-standard' as OpeningCtbRuleId;
export const DELAY_STANDARD = 'delay-standard' as ActionDelayRuleId;
export const COMBAT_RULE_ID = 'combat-rule-standard' as CombatRuleId;

export const GOBLIN_ID = 'monster-goblin' as MonsterDefinitionId;
export const ENCOUNTER_GROUP = 'group-goblins' as EncounterGroupDefinitionId;
export const XP_BUDGET = 'xp-budget-goblins' as EncounterExperienceBudgetId;
export const XP_PROFILE = 'xp-profile-goblin' as MonsterExperienceProfileId;
export const ATTACK_AWARD_RULE = 'attack-award-sword' as AttackMasteryAwardRuleId;
export const SUPPORT_AWARD_RULE = 'support-award-heal' as SupportMasteryAwardRuleId;

export const MAP_ID = 'map-1' as MapInstanceId;
export const CONTENT_ID = 'content-1' as ContentInstanceId;

const RES_CTB = 'res-ctb' as ResolverId;

// resolvePower 對照表（資料調校 kernel 的決定性 stub 輸出）。
const POWER_TABLE: Readonly<Record<string, number>> = {
  [RES_DAMAGE]: 30,
  [RES_MONSTER_DAMAGE]: 5,
  [RES_HEAL]: 10,
  // CTB 調整量：取設計基準的「標準 +14 CTB」。挑 14 是為了讓折算看得出取整方向——
  // 菁英 ×0.75 = 10.5 → floor 10（不是 11），Boss ×0.50 = 7。
  [RES_CTB]: 14,
};

// ── DefinitionHeader helper（id 統一折成基底 DefinitionId，供各 Definition 型別複用）──
// 保留傳入的品牌型別：回傳 `id: string` 會讓每個 Definition 的 id 退化成裸字串，
// 呼叫端就得再轉型回去（那正是 as unknown as 的來源之一）。
function header<T extends string>(id: T) {
  return { id, schemaVersion: 1, packId: PACK_ID, enabled: true as const };
}

// ── Skill Views ─────────────────────────────────────────────────────────
function skillStrike(): CombatSkillDefinitionView {
  return {
    skillId: SKILL_STRIKE,
    activationHand: 'mainHand',
    weaponRequirementIds: [],
    actionKind: 'attack',
    masteryExperienceMode: 'damage',
    attackMasteryAwardRuleId: ATTACK_AWARD_RULE,
    techniqueIds: [],
    targeting: { targetResolverId: 'res-target-single' as ResolverId },
    actionDelayRuleId: DELAY_STANDARD,
    effectIds: [EFF_DAMAGE],
    resourceCosts: [],
  };
}
function skillCounter(): CombatSkillDefinitionView {
  return {
    skillId: SKILL_COUNTER,
    activationHand: 'mainHand',
    weaponRequirementIds: [],
    actionKind: 'guard',
    masteryExperienceMode: 'damage',
    techniqueIds: [],
    targeting: { targetResolverId: 'res-target-self' as ResolverId },
    actionDelayRuleId: DELAY_STANDARD,
    effectIds: [EFF_COUNTER_DAMAGE],
    counterStance: {
      conditionResolverId: 'res-counter-cond' as ResolverId,
      counterDelayRuleId: DELAY_STANDARD,
    },
    resourceCosts: [],
  };
}
function skillHeal(): CombatSkillDefinitionView {
  return {
    skillId: SKILL_HEAL,
    activationHand: 'handless',
    weaponRequirementIds: [],
    actionKind: 'support',
    masteryExperienceMode: 'fixedSupport',
    supportMasteryAwardRuleId: SUPPORT_AWARD_RULE,
    techniqueIds: [],
    targeting: { targetResolverId: 'res-target-ally' as ResolverId },
    actionDelayRuleId: DELAY_STANDARD,
    effectIds: [EFF_HEAL],
    resourceCosts: [{ resource: 'mana', amount: 5 }],
  };
}
function skillBite(): CombatSkillDefinitionView {
  return {
    skillId: SKILL_BITE,
    activationHand: 'handless',
    weaponRequirementIds: [],
    actionKind: 'attack',
    masteryExperienceMode: 'damage',
    techniqueIds: [],
    targeting: { targetResolverId: 'res-target-single' as ResolverId },
    actionDelayRuleId: DELAY_STANDARD,
    effectIds: [EFF_MONSTER_DAMAGE],
    resourceCosts: [],
  };
}

function skillCastDamage(): CombatSkillDefinitionView {
  return {
    skillId: SKILL_CAST_DAMAGE,
    activationHand: 'handless',
    weaponRequirementIds: [],
    actionKind: 'cast', // 標成 cast，但效果是 dealDamage —— 側別須由效果推定
    masteryExperienceMode: 'damage',
    techniqueIds: [],
    targeting: { targetResolverId: 'res-target-single' as ResolverId },
    actionDelayRuleId: DELAY_STANDARD,
    effectIds: [EFF_MONSTER_DAMAGE],
    resourceCosts: [],
  };
}

// 純控制技能：只有 adjustCtb（或 interruptCasting），沒有 dealDamage／heal。
function controlSkill(skillId: SkillDefinitionId, effectId: CombatEffectDefinitionId): CombatSkillDefinitionView {
  return {
    skillId,
    activationHand: 'handless',
    weaponRequirementIds: [],
    actionKind: 'perform',
    masteryExperienceMode: 'fixedSupport',
    techniqueIds: [],
    targeting: { targetResolverId: 'res-target-single' as ResolverId },
    actionDelayRuleId: DELAY_STANDARD,
    effectIds: [effectId],
    resourceCosts: [],
  };
}

const SKILL_VIEWS: Readonly<Record<string, CombatSkillDefinitionView>> = {
  [SKILL_STRIKE]: skillStrike(),
  [SKILL_COUNTER]: skillCounter(),
  [SKILL_HEAL]: skillHeal(),
  [SKILL_BITE]: skillBite(),
  [SKILL_CAST_DAMAGE]: skillCastDamage(),
  [SKILL_CTB_DELAY]: controlSkill(SKILL_CTB_DELAY, EFF_CTB_DELAY),
  [SKILL_INTERRUPT]: controlSkill(SKILL_INTERRUPT, EFF_INTERRUPT),
};

// ── Effects ─────────────────────────────────────────────────────────────
function damageEffect(id: CombatEffectDefinitionId, ruleId: CombatDamageRuleId): CombatEffectDefinition {
  return { ...header(id), operation: { kind: 'dealDamage', damageRuleId: ruleId } };
}
const EFFECTS: Readonly<Record<string, CombatEffectDefinition>> = {
  [EFF_DAMAGE]: damageEffect(EFF_DAMAGE, DMG_PHYSICAL),
  [EFF_COUNTER_DAMAGE]: damageEffect(EFF_COUNTER_DAMAGE, DMG_PHYSICAL),
  [EFF_MONSTER_DAMAGE]: damageEffect(EFF_MONSTER_DAMAGE, DMG_MONSTER),
  [EFF_HEAL]: { ...header(EFF_HEAL), operation: { kind: 'heal', healRuleId: HEAL_RULE } },
  [EFF_CTB_DELAY]: {
    ...header(EFF_CTB_DELAY),
    operation: { kind: 'adjustCtb', adjustmentRuleId: CTB_RULE },
  },
  [EFF_INTERRUPT]: {
    ...header(EFF_INTERRUPT),
    operation: { kind: 'interruptCasting', interruptionRuleId: INTERRUPT_RULE },
  },
};

function damageRule(id: CombatDamageRuleId, channel: CombatDamageChannel, resolverId: ResolverId): CombatDamageRuleDefinition {
  return { ...header(id), damageChannel: channel, powerResolverId: resolverId, canBeBlocked: true };
}
const DAMAGE_RULES: Readonly<Record<string, CombatDamageRuleDefinition>> = {
  [DMG_PHYSICAL]: damageRule(DMG_PHYSICAL, 'physical', RES_DAMAGE),
  [DMG_MONSTER]: damageRule(DMG_MONSTER, 'physical', RES_MONSTER_DAMAGE),
};

// ── Opening CTB / Delay Rules ───────────────────────────────────────────
const OPENING_RULE: OpeningCtbRuleDefinition = {
  ...header(OPENING_CTB_RULE),
  baseCtb: 100,
  reductions: [{ primaryAttribute: 'reaction', reductionPerPoint: 1 }],
  minimumCtb: 1,
};
const DELAY_RULE: ActionDelayRuleDefinition = {
  ...header(DELAY_STANDARD),
  baseDelay: 100,
  reductions: [{ primaryAttribute: 'reaction', reductionPerPoint: 1 }],
  minimumDelay: 10,
};

// ── 控制抗性檔（§2.6）─────────────────────────────────────────────────────
// 數值取自設計基準 balanceModel.controlResistanceRules：
//   一般 100%（無上限、無中斷免疫）／菁英 75%／Boss 50% + 兩次自身行動間上限 18 + 中斷免疫。
export const CTRL_NORMAL = 'ctrl-none' as CombatControlResistanceProfileId;
export const CTRL_ELITE = 'ctrl-elite' as CombatControlResistanceProfileId;
export const CTRL_BOSS = 'ctrl-boss' as CombatControlResistanceProfileId;

// ── Monster / Encounter / Experience ────────────────────────────────────
function goblin(controlResistanceProfileId: CombatControlResistanceProfileId = CTRL_NORMAL): MonsterDefinition {
  return {
    ...header(GOBLIN_ID),
    cultureId: 'culture-wild' as never,
    speciesKind: 'nonHuman',
    threatRank: 'normal',
    bodySize: 'small',
    attributes: { health: 20, muscle: 10, intelligence: 5, reaction: 10, coordination: 10, charisma: 5 },
    skillIds: [SKILL_BITE],
    naturalAttackProfileId: 'natk-goblin' as MonsterNaturalAttackProfileId,
    controlResistanceProfileId,
    aiPolicyId: 'ai-aggressive' as CombatAiPolicyId,
    experienceProfileId: XP_PROFILE,
  };
}
function encounterGroup(): EncounterGroupDefinition {
  return {
    ...header(ENCOUNTER_GROUP),
    memberDefinitionIds: [GOBLIN_ID, GOBLIN_ID],
    initialPlacements: [
      { monsterDefinitionId: GOBLIN_ID, anchorCell: localCell(1, 1) },
      { monsterDefinitionId: GOBLIN_ID, anchorCell: localCell(1, 2) },
    ],
    experienceBudgetId: XP_BUDGET,
    rewardResolverId: 'res-reward' as ResolverId,
  };
}

// ── Definition Reader stub ──────────────────────────────────────────────
export function stubDefinitionReader(
  monsterControlProfileId: CombatControlResistanceProfileId = CTRL_NORMAL,
): CombatDefinitionReader {
  const notImplemented = (what: string) => (): never => {
    throw new Error(`stubDefinitionReader: ${what} not needed in fixtures`);
  };
  return {
    getCombatRule: (): CombatRuleDefinition => ({
      ...header(COMBAT_RULE_ID),
      openingCtbRuleId: OPENING_CTB_RULE,
      combatRestDelayRuleId: DELAY_STANDARD,
      defenseMasteryRoutingRuleId: 'defense-routing' as never,
      // 原本寫死在 handleCombatRest 的 5/5，現在由規則資料供給。
      combatRestHealthRestore: 5,
      combatRestManaRestore: 5,
    }),
    getEncounterGroup: () => encounterGroup(),
    getMonster: () => goblin(monsterControlProfileId),
    getSkillView: (id) => {
      const v = SKILL_VIEWS[id];
      if (v === undefined) throw new Error(`no skill view ${String(id)}`);
      return v;
    },
    trySkillView: (id) => SKILL_VIEWS[id],
    getOpeningCtbRule: () => OPENING_RULE,
    getActionDelayRule: () => DELAY_RULE,
    getCombatStatus: (id): CombatStatusDefinition => ({
      ...header(id),
      polarity: 'negative',
      modifierResolverId: 'res-status-mod' as ResolverId,
      displayPriority: 1,
    }),
    getCombatEffect: (id) => {
      const e = EFFECTS[id];
      if (e === undefined) throw new Error(`no effect ${String(id)}`);
      return e;
    },
    getDamageRule: (id) => {
      const r = DAMAGE_RULES[id];
      if (r === undefined) throw new Error(`no damage rule ${String(id)}`);
      return r;
    },
    getHealRule: (id): CombatHealRuleDefinition => ({ ...header(id), powerResolverId: RES_HEAL }),
    getCtbAdjustmentRule: (id): CombatCtbAdjustmentRuleDefinition => ({
      ...header(id),
      amountResolverId: RES_CTB,
    }),
    getCombatInterruptionRule: (id): CombatInterruptionRuleDefinition => ({
      ...header(id),
      appliesToActionKinds: ['cast', 'perform'],
      interruptionDelayRuleId: DELAY_STANDARD,
    }),
    getControlResistanceProfile: (id): CombatControlResistanceProfileDefinition => {
      if (String(id) === String(CTRL_ELITE)) {
        return {
          ...header(id),
          ctbIncreaseMultiplier: 0.75,
          interruptionImmunityUntilOwnActionAfterSuccess: false,
        };
      }
      if (String(id) === String(CTRL_BOSS)) {
        return {
          ...header(id),
          ctbIncreaseMultiplier: 0.5,
          maxExternalCtbIncreaseBeforeOwnAction: 18,
          interruptionImmunityUntilOwnActionAfterSuccess: true,
        };
      }
      return {
        ...header(id),
        ctbIncreaseMultiplier: 1,
        interruptionImmunityUntilOwnActionAfterSuccess: false,
      };
    },
    getEquipmentEffect: notImplemented('getEquipmentEffect') as unknown as (
      id: never,
    ) => EquipmentEffectDefinition,
    getAiPolicy: (id): CombatAiPolicyDefinition => ({
      ...header(id),
      behaviorResolverId: 'res-ai' as ResolverId,
    }),
    getExperienceBudget: (): EncounterExperienceBudgetDefinition => ({
      ...header(XP_BUDGET),
      aggregation: 'sumMemberProfiles',
      groupModifier: 1,
    }),
    getMonsterExperienceProfile: (): MonsterExperienceProfileDefinition => ({
      ...header(XP_PROFILE),
      attackExperience: 10,
      defenseExperience: 10,
      attackAwardRuleId: 'xp-award-atk' as never,
      defenseAwardRuleId: 'xp-award-def' as never,
    }),
  };
}

// ── Progression / Loadout / Formation stubs ─────────────────────────────
function attributesFor(characterId: CharacterId): PrimaryAttributes {
  // Hero 反應 30（開場 CTB 低 → 先手）；Mage 反應 30。怪物反應 10。
  void characterId;
  return { muscle: 20, intelligence: 20, reaction: 30, coordination: 20, charisma: 10 };
}

export function stubProgressionQuery(): ProgressionQuery {
  return {
    getMastery: () => ({ masteryId: SWORD_MASTERY, experience: 0, level: 0, revision: 0 as Revision }),
    getPrimaryAttributes: (characterId) => attributesFor(characterId),
    getSocialMasteryBenefits: () => ({ personalTradeBonus: 0, inviteSuccessBonus: 0, memberDepartureResistance: 0 }),
    knows: () => true,
    meetsRequirements: () => true,
    getTeachingSession: () => undefined,
  };
}

// 一個武器組最多配 3 個技能（契約的 tuple 長度就是這條結構不變量），所以不能為了測試把第 4、5
// 個技能塞進預設組——要測其他技能就換這一組的內容，由呼叫端指定。
type WeaponSetSkills = CharacterEquipmentLoadoutView['weaponSets'][number]['selectedSkillIds'];

const DEFAULT_WEAPON_SET_SKILLS: WeaponSetSkills = [SKILL_STRIKE, SKILL_COUNTER, SKILL_HEAL];

function loadoutFor(characterId: CharacterId, skills: WeaponSetSkills): CharacterEquipmentLoadoutView {
  const set = (id: WeaponSetId): CharacterEquipmentLoadoutView['weaponSets'][number] => ({
    weaponSetId: id,
    selectedSkillIds: skills,
  });
  return {
    characterId,
    armorSlots: {},
    weaponSets: [set(WEAPON_SET_A), set(WEAPON_SET_B), set(WEAPON_SET_C)],
    revision: 0 as Revision,
  };
}

export function stubLoadoutQuery(skills: WeaponSetSkills = DEFAULT_WEAPON_SET_SKILLS): CombatLoadoutQuery {
  return { getEquipmentLoadout: (characterId) => loadoutFor(characterId, skills) };
}

export function stubFormationQuery(): CombatFormationQuery {
  const snapshot: CombatFormationSnapshot = {
    teamId: TEAM_ID,
    formationRevision: 0 as Revision,
    members: [
      { characterId: HERO_ID, cell: localCell(1, 1), activeWeaponSetId: WEAPON_SET_A, maxHealth: 100, maxMana: 30, startHealth: 100, startMana: 30 },
      { characterId: MAGE_ID, cell: localCell(1, 2), activeWeaponSetId: WEAPON_SET_A, maxHealth: 80, maxMana: 50, startHealth: 80, startMana: 50 },
    ],
  };
  return { getPlayerFormation: () => snapshot };
}

// ── Resolver Port stub（可覆寫）──────────────────────────────────────────
export function stubResolverPort(overrides: Partial<CombatResolverPort> = {}): CombatResolverPort {
  const base: CombatResolverPort = {
    resolvePower: (input: CombatPowerInput) => POWER_TABLE[input.resolverId] ?? 0,
    resolveAttackMastery: () => SWORD_MASTERY,
    resolveDefenseMastery: () => ARMOR_MASTERY,
    chooseEnemyAction: ({ encounter, actorId }): EnemyActionChoice | undefined => {
      const actor = encounter.combatants[actorId];
      if (actor === undefined || actor.source.kind !== 'monster') return undefined;
      const monster = MONSTER_SKILLS;
      // 目標：最前排（row 最小）仍存活的玩家單位。
      const players = (Object.keys(encounter.combatants) as CombatantId[])
        .map((id) => encounter.combatants[id])
        .filter((c): c is CombatantState => c !== undefined && c.side === 'player' && c.state !== 'dead')
        .sort((a, b) => a.anchorCell.row - b.anchorCell.row);
      const target = players[0];
      if (target === undefined) return undefined;
      return { skillId: monster[0]!, targetCombatantIds: [target.combatantId] };
    },
    evaluateCounterStance: ({ incomingActionKind }) => incomingActionKind === 'attack',
  };
  return { ...base, ...overrides };
}
const MONSTER_SKILLS: readonly SkillDefinitionId[] = [SKILL_BITE];

// ── Id Allocator stub ────────────────────────────────────────────────────
export function stubIdAllocator(prefix = 'gen'): CombatIdAllocator {
  let n = 0;
  const next = (kind: string): string => {
    n += 1;
    return `${prefix}-${kind}-${n}`;
  };
  return {
    nextEncounterId: () => next('enc') as EncounterId,
    nextCombatantId: () => next('cbt') as CombatantId,
    nextRuntimeEnemyId: () => next('enemy') as RuntimeEnemyId,
    nextStatusInstanceId: () => next('status') as CombatStatusInstanceId,
  };
}

// ── Handler Context ──────────────────────────────────────────────────────
export function makeCombatContext(overrides: Partial<CombatHandlerContext> = {}): CombatHandlerContext {
  return {
    definitions: overrides.definitions ?? stubDefinitionReader(),
    combatRuleId: overrides.combatRuleId ?? COMBAT_RULE_ID,
    progression: overrides.progression ?? stubProgressionQuery(),
    loadout: overrides.loadout ?? stubLoadoutQuery(),
    formation: overrides.formation ?? stubFormationQuery(),
    resolvers: overrides.resolvers ?? stubResolverPort(),
    ids: overrides.ids ?? stubIdAllocator(),
    rng: overrides.rng ?? deterministicRng,
  };
}

// ── RngContext ────────────────────────────────────────────────────────────
export function fixtureRngContext(): RngContext {
  return {
    worldSeed: 'seed-combat' as Seed,
    streamId: 'stream-combat' as RngStreamId,
    cursor: 0 as RngCursor,
  };
}

export function fixtureStartCommand(source?: CombatEncounterSource): StartCombatEncounterCommand {
  return {
    type: 'StartCombatEncounter',
    teamId: TEAM_ID,
    source:
      source ??
      { kind: 'mapContent', mapId: MAP_ID, contentId: CONTENT_ID, encounterGroupId: ENCOUNTER_GROUP },
    participantSnapshotRevision: 0 as Revision,
    rngContext: fixtureRngContext(),
  };
}

// ── 直接組裝 Encounter（供排程 / 反擊等單元測試）──────────────────────────
export type CombatantSpec = Readonly<{
  combatantId: string;
  side: 'player' | 'enemy';
  currentCtb?: number;
  health?: number;
  row?: number;
  col?: number;
  characterId?: CharacterId;
  counterStance?: CounterStanceInstance;
}>;

export function makeCombatant(spec: CombatantSpec): CombatantState {
  const id = spec.combatantId as CombatantId;
  const source: CombatantState['source'] =
    spec.side === 'player'
      ? { kind: 'character', characterId: spec.characterId ?? (spec.combatantId as unknown as CharacterId) }
      : { kind: 'monster', monsterDefinitionId: GOBLIN_ID, runtimeEnemyId: `${spec.combatantId}-e` as RuntimeEnemyId };
  return {
    combatantId: id,
    source,
    side: spec.side,
    footprint: { width: 1, height: 1 },
    anchorCell: localCell(spec.row ?? 1, spec.col ?? 1),
    health: spec.health ?? 100,
    maxHealth: 100,
    mana: 30,
    maxMana: 30,
    startHealth: spec.health ?? 100,
    startMana: 30,
    currentCtb: spec.currentCtb ?? 0,
    externalCtbIncreaseSinceOwnAction: 0,
    interruptionImmuneUntilOwnAction: false,
    activeStatuses: [],
    ...(spec.counterStance ? { counterStance: spec.counterStance } : {}),
    state: 'ready',
    revision: 0 as Revision,
  };
}

export function makeEncounter(specs: readonly CombatantSpec[]): CombatEncounter {
  const combatants: Record<CombatantId, CombatantState> = {};
  for (const spec of specs) {
    const c = makeCombatant(spec);
    combatants[c.combatantId] = c;
  }
  return {
    encounterId: 'enc-test' as EncounterId,
    source: { kind: 'mapContent', mapId: MAP_ID, contentId: CONTENT_ID, encounterGroupId: ENCOUNTER_GROUP },
    playerTeamId: TEAM_ID,
    playerFormationRevision: 0 as Revision,
    combatants,
    playerGrid: rebuildGrid(combatants, 'player'),
    enemyGrid: rebuildGrid(combatants, 'enemy'),
    state: 'active',
    readyQueue: [],
    supportMasteryUseCounts: {},
    rngContext: fixtureRngContext(),
    revision: 0 as Revision,
    participantCharacterIds: specs
      .filter((s) => s.side === 'player')
      .map((s) => (s.characterId ?? (s.combatantId as unknown as CharacterId))),
    defenseFormationRows: [],
    attackDamageByCharacter: {},
  };
}
