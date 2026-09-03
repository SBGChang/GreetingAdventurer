// contracts/combat — public contract transcribed from docs/00_core/architecture/11_combat_module.md

import type {
  DefinitionHeader,
  ResolverId,
  CultureId,
  CombatRuleId,
  EncounterGroupDefinitionId,
  MonsterDefinitionId,
  SkillDefinitionId,
  OpeningCtbRuleId,
  ActionDelayRuleId,
  CombatStatusDefinitionId,
  CombatEffectDefinitionId,
  CombatDamageRuleId,
  CombatHealRuleId,
  CombatCtbAdjustmentRuleId,
  CombatInterruptionRuleId,
  EquipmentEffectDefinitionId,
  CombatAiPolicyId,
  CombatControlResistanceProfileId,
  MonsterNaturalAttackProfileId,
  MonsterExperienceProfileId,
  EncounterExperienceBudgetId,
  ExperienceAwardRuleId,
  AttackMasteryAwardRuleId,
  SupportMasteryAwardRuleId,
  TechniqueId,
  WeaponRequirementId,
  CombatStatusInstanceId,
  EncounterId,
  CombatantId,
  RuntimeEnemyId,
  WeaponSetId,
  ItemInstanceId,
  CharacterId,
  TeamId,
  MapInstanceId,
  ContentInstanceId,
  InteractionId,
  PlayerTravelEventInstanceId,
  RngContext,
  Revision,
} from '../core';
// Cross-module: map owns GridCell (src/contracts/map).
import type { GridCell } from '../map';
// B.5：外送 Internal Command 一律引用接收模組契約的真實型別，讓 tsc 在發送端就攔下不匹配
// （原本 combat 自行拼了 ResolvePlayerMapContent / CommitCombatItemUse 的欄位，兩邊都對不上）。
import type { ResolvePlayerMapContent } from '../map';
import type { ApplyCombatCondition } from '../character';
import type { CommitCombatItemUse } from '../inventory';
// Cross-module: progression owns PrimaryAttributeId + DefenseMasteryRoutingRuleId (src/contracts/progression).
import type { PrimaryAttributeId, DefenseMasteryRoutingRuleId } from '../progression';
// Shared growth-event contract lives in combat-sequence; detailed combat reuses it (doc §8.7, §7).
// 三個 mastery-earned payload 由 combat-sequence 擁有（兩個模組都發此事件，收成單一擁有者的型別，
// 避免同 discriminant 兩套 payload）。此處只引用，不再自行宣告。
import type {
  CombatMasterySource,
  MasteryExperienceAmount,
  CombatAttackMasteryEarnedPayload,
  CombatDefenseMasteryEarnedPayload,
  CombatSupportMasteryEarnedPayload,
} from '../combat-sequence';

// ── 敵人定義（§2.2）──────────────────────────────────────────────────
export type MonsterSpeciesKind = 'nonHuman' | 'human';
export type MonsterThreatRank = 'normal' | 'elite' | 'boss';
export type MonsterBodySize = 'small' | 'medium' | 'large';

export type MonsterDefinition = DefinitionHeader & {
  cultureId: CultureId;
  speciesKind: MonsterSpeciesKind;
  threatRank: MonsterThreatRank;
  bodySize: MonsterBodySize;
  attributes: {
    health: number;
    muscle: number;
    intelligence: number;
    reaction: number;
    coordination: number;
    charisma: number;
  };
  skillIds: SkillDefinitionId[];
  naturalAttackProfileId: MonsterNaturalAttackProfileId;
  controlResistanceProfileId: CombatControlResistanceProfileId;
  aiPolicyId: CombatAiPolicyId;
  experienceProfileId: MonsterExperienceProfileId;
  // §2.4 射程：怪物用 skillIds＋共用 resolver 攻擊，沒有武器 loadout，故射程格數（等同角色武器格數）
  // 直接放在怪物定義上，供 Handler 算有效射程（近戰怪 1；有距離攻擊的怪更高）。
  reachCells: number;
};

export type MonsterNaturalAttackProfileDefinition = DefinitionHeader & {
  physicalPowerResolverId: ResolverId;
  magicPowerResolverId: ResolverId;
  hitScoreResolverId: ResolverId;
  // §2.4 射程（格數）：怪物天生攻擊的觸及距離。近戰怪 1；有距離攻擊的怪更高。等同角色的武器格數，
  // 是怪物這一側算「有效射程 = 此值 + 招式額外距離」的基底（怪物沒有武器 loadout）。
  reachCells: number;
};

export type CombatControlResistanceProfileDefinition = DefinitionHeader & {
  ctbIncreaseMultiplier: number;
  maxExternalCtbIncreaseBeforeOwnAction?: number;
  interruptionImmunityUntilOwnActionAfterSuccess: boolean;
};

// Derived: doc references getAiPolicy(id): CombatAiPolicyDefinition but never
// specifies its body (see report note).
export type CombatAiPolicyDefinition = DefinitionHeader & {
  behaviorResolverId: ResolverId;
};

// ── 敵方 AI 的行為參數（F3 P1）──────────────────────────────────────────────
//
// 三個 AI Policy（雜兵／菁英／首領）**共用同一個 shape**，差異全部落在這張表——
// 工作單明講「若你發現需要三份不同程式，先回報，那代表 shape 切錯了」。
//
// 兩個欄位都是**封閉 tagged 值**（不是自由字串、不是 expression DSL）：資料只能從已註冊的有限
// 選項裡挑一個，新增一種行為必須改程式（新策略＋測試），這正是 §6「封閉 tagged variant」允許
// 而 expression DSL 禁止的分界。
export type CombatAiSkillSelection =
  // 只會一招的雜兵：取唯一一招（多於一招＝資料與 policy 不符，明確失敗）。
  | 'onlySkill'
  // 首領輪替：依 encounter.revision 取模輪流。revision 每筆交易遞增，所以同一場戰鬥的連續行動
  // 會拿到不同招式，且可重播。
  | 'rotateByEncounterRevision'
  // 從負擔得起的招式裡隨機挑一招。
  | 'randomAffordable';

export type CombatAiTargetPreference =
  // 射程內任一敵方，均勻抽取。
  | 'randomInReach'
  // 射程內生命最低者（收尾）。
  | 'lowestHealthInReach'
  // 射程內生命最高者（先啃硬的）。
  | 'highestHealthInReach';

export type CombatAiParamsDefinition = DefinitionHeader & {
  skillSelection: CombatAiSkillSelection;
  targetPreference: CombatAiTargetPreference;
};

// 反擊架勢條件的參數（F3 P1 的第二個 shape）。述詞，無 RNG。
export type CombatCounterConditionParamsDefinition = DefinitionHeader & {
  // 哪些來襲動作種類會觸發反擊。
  triggeringActionKinds: readonly CombatActionKind[];
  // 攻方排距上限；**缺席＝不限距離**（不是「距離 0」）。近戰架勢填 1。
  maxAttackerDistanceCells?: number;
};

// Derived: doc references getEquipmentEffect(id): EquipmentEffectDefinition but
// never specifies its body here; likely inventory-owned (see report note).
export type EquipmentEffectDefinition = DefinitionHeader & {
  triggerResolverId: ResolverId;
  effectIds: CombatEffectDefinitionId[];
};

// ── 遭遇編組（§2.3）──────────────────────────────────────────────────
// Derived: initialPlacements element type is referenced but never defined (see report note).
export type EnemyPlacementDefinition = {
  monsterDefinitionId: MonsterDefinitionId;
  anchorCell: GridCell;
};

export type EncounterGroupDefinition = DefinitionHeader & {
  memberDefinitionIds: MonsterDefinitionId[];
  initialPlacements: EnemyPlacementDefinition[];
  experienceBudgetId: EncounterExperienceBudgetId;
  rewardResolverId: ResolverId;
};

export type EncounterExperienceBudgetDefinition = DefinitionHeader & {
  aggregation: 'sumMemberProfiles';
  groupModifier: number;
  minimumAwardRuleId?: ExperienceAwardRuleId;
};

export type MonsterExperienceProfileDefinition = DefinitionHeader & {
  attackExperience: number;
  defenseExperience: number;
  attackAwardRuleId: ExperienceAwardRuleId;
  defenseAwardRuleId: ExperienceAwardRuleId;
};

// ── 技能戰鬥 View（§2.4）─────────────────────────────────────────────
export type CombatActivationHand = 'mainHand' | 'offHand' | 'bothHands' | 'handless';
export type CombatActionKind = 'attack' | 'guard' | 'cast' | 'perform' | 'support';
export type CombatMasteryExperienceMode = 'damage' | 'fixedSupport';

// Derived: doc references these but never defines their bodies (see report note).
export type TargetingDefinition = {
  targetResolverId: ResolverId;
  // §2.4 射程：有效射程 = 武器格數 + 本欄「招式額外距離」。大多數招式沒有（省略＝0）；魔法/治療
  // 招式一律 +6（全場可及）。合法目標＝施展當下真實排距 ≤ 有效射程（見 combatDistance）。
  extraReachCells?: number;
};
export type CounterStanceDefinition = {
  conditionResolverId: ResolverId;
  counterDelayRuleId: ActionDelayRuleId;
};
export type ResourceCostDefinition = {
  resource: 'health' | 'mana';
  amount: number;
};

export type CombatSkillDefinitionView = {
  skillId: SkillDefinitionId;
  activationHand: CombatActivationHand;
  weaponRequirementIds: WeaponRequirementId[];
  actionKind: CombatActionKind;
  masteryExperienceMode: CombatMasteryExperienceMode;
  attackMasteryAwardRuleId?: AttackMasteryAwardRuleId;
  supportMasteryAwardRuleId?: SupportMasteryAwardRuleId;
  techniqueIds: TechniqueId[];
  targeting: TargetingDefinition;
  actionDelayRuleId: ActionDelayRuleId;
  effectIds: CombatEffectDefinitionId[];
  counterStance?: CounterStanceDefinition;
  resourceCosts: ResourceCostDefinition[];
};

// ── 戰鬥效果與狀態語彙（§2.5）─────────────────────────────────────────
export type CombatStatusStackPolicy = 'replace' | 'refresh' | 'strongest';

export type CombatEffectDefinition = DefinitionHeader & {
  operation:
    | { kind: 'dealDamage'; damageRuleId: CombatDamageRuleId }
    | { kind: 'heal'; healRuleId: CombatHealRuleId }
    | { kind: 'adjustCtb'; adjustmentRuleId: CombatCtbAdjustmentRuleId }
    | { kind: 'interruptCasting'; interruptionRuleId: CombatInterruptionRuleId }
    | {
        kind: 'applyStatus';
        statusId: CombatStatusDefinitionId;
        durationTargetActions: number;
        stackPolicy: CombatStatusStackPolicy;
      }
    | { kind: 'removeStatus'; statusId: CombatStatusDefinitionId };
};

export type CombatDamageChannel = 'physical' | 'magic' | 'instrument';

export type CombatDamageRuleDefinition = DefinitionHeader & {
  damageChannel: CombatDamageChannel;
  powerResolverId: ResolverId;
  canBeBlocked: boolean;
};

export type CombatHealRuleDefinition = DefinitionHeader & {
  powerResolverId: ResolverId;
};

export type CombatCtbAdjustmentRuleDefinition = DefinitionHeader & {
  amountResolverId: ResolverId;
};

export type CombatInterruptionRuleDefinition = DefinitionHeader & {
  appliesToActionKinds: Array<'cast' | 'perform'>;
  interruptionDelayRuleId: ActionDelayRuleId;
};

export type CombatStatusPolarity = 'positive' | 'negative';

export type CombatStatusDefinition = DefinitionHeader & {
  polarity: CombatStatusPolarity;
  modifierResolverId: ResolverId;
  displayPriority: number;
};

export type CombatStatusInstance = {
  statusInstanceId: CombatStatusInstanceId;
  statusId: CombatStatusDefinitionId;
  remainingTargetActions: number;
  appliedByCombatantId: CombatantId;
  revision: Revision;
};

// ── 開場 CTB 與行動延遲（§2.7）───────────────────────────────────────
// Derived: AttributeReductionRule referenced by OpeningCtbRuleDefinition but never
// defined (mirrors the defined ActionDelayAttributeReductionRule; see report note).
export type AttributeReductionRule = {
  primaryAttribute: PrimaryAttributeId;
  reductionPerPoint: number;
};

export type ActionDelayAttributeReductionRule = {
  primaryAttribute: PrimaryAttributeId;
  reductionPerPoint: number;
};

export type CombatRuleDefinition = DefinitionHeader & {
  openingCtbRuleId: OpeningCtbRuleId;
  combatRestDelayRuleId: ActionDelayRuleId;
  defenseMasteryRoutingRuleId: DefenseMasteryRoutingRuleId;
  // 戰鬥休息的回復量。原本是 Handler 裡的 `const RESTORE = 5`，且自承「第一版固定小額；資料化細節待接」。
  // 回復多少是平衡，換一份 Pack 就該不同——它從來不是結構。
  combatRestHealthRestore: number;
  combatRestManaRestore: number;
  // 跨武器組施放技能的切換延遲（§8.3「跨組技能先套用切換武器組延遲，再執行技能」）。
  //
  // 這個欄位先前不存在，於是 handleUseCombatSkill 只更新 activeWeaponSetId 就往下走——**等於把切換
  // 延遲寫死成 0**。零成本切換是戰鬥系統裡最強的自由度（三組武器＝九個技能隨時可用），把它寫死成 0
  // 不是「還沒接」，是已經替內容做了平衡決定。切換要付多少延遲是平衡、換一份 Pack 就該不同，
  // 所以它是資料；而「延遲怎麼由屬性折算」是既有的 ActionDelayRule 形狀，直接沿用同一張表。
  //
  // 必填（不是選填）：選填會讓「這套規則不收切換延遲」與「作者忘了填」長得一模一樣，而前者的正確
  // 表達是填一筆 baseDelay=0 的 ActionDelayRule——那是**內容說的**，不是實作替內容說的。
  weaponSetSwitchDelayRuleId: ActionDelayRuleId;
};

export type OpeningCtbRuleDefinition = DefinitionHeader & {
  baseCtb: number;
  reductions: AttributeReductionRule[];
  minimumCtb: number;
};

export type ActionDelayRuleDefinition = DefinitionHeader & {
  baseDelay: number;
  reductions: ActionDelayAttributeReductionRule[];
  minimumDelay: number;
};

export interface CombatDefinitionReader {
  getCombatRule(id: CombatRuleId): CombatRuleDefinition;
  getEncounterGroup(id: EncounterGroupDefinitionId): EncounterGroupDefinition;
  getMonster(id: MonsterDefinitionId): MonsterDefinition;
  getSkillView(id: SkillDefinitionId): CombatSkillDefinitionView;
  // 「這筆技能定義存在嗎」是一個**合法的問題**，不該只能靠攔截 getSkillView 的例外來回答。
  //
  // 武器組裡可能存著失效的技能引用（舊存檔、被移除的內容、未載入的內容包），讀取端需要區分
  // 「沒有這筆定義」與「讀取過程出錯」。用 try/catch 兩者都會被收成同一個結果，連 Reader 內部的
  // 程式錯誤都會被靜默當成「技能不存在」——那正是規範 §6 禁止的「捕捉 Reader 例外後繼續」。
  // data-runtime 的 DefinitionReader 本來就有 tryGet；這裡把該能力沿用到領域介面上。
  trySkillView(id: SkillDefinitionId): CombatSkillDefinitionView | undefined;
  getOpeningCtbRule(id: OpeningCtbRuleId): OpeningCtbRuleDefinition;
  getActionDelayRule(id: ActionDelayRuleId): ActionDelayRuleDefinition;
  getCombatStatus(id: CombatStatusDefinitionId): CombatStatusDefinition;
  getCombatEffect(id: CombatEffectDefinitionId): CombatEffectDefinition;
  getDamageRule(id: CombatDamageRuleId): CombatDamageRuleDefinition;
  getHealRule(id: CombatHealRuleId): CombatHealRuleDefinition;
  getCtbAdjustmentRule(id: CombatCtbAdjustmentRuleId): CombatCtbAdjustmentRuleDefinition;
  getCombatInterruptionRule(id: CombatInterruptionRuleId): CombatInterruptionRuleDefinition;
  // 控制抗性（§2.6）。`MonsterDefinition.controlResistanceProfileId` 與
  // `CombatControlResistanceProfileDefinition` 早就存在，但 Reader 沒有這個 getter，於是
  // `resistedCtbIncrease()` 只能整個函式 `return raw`——一個看起來有抗性接縫、實際倍率恆為 1
  // 的恆等函式（規範 §5 點名的「缺少控制抗性時使用倍率 1」）。
  getControlResistanceProfile(
    id: CombatControlResistanceProfileId,
  ): CombatControlResistanceProfileDefinition;
  getEquipmentEffect(id: EquipmentEffectDefinitionId): EquipmentEffectDefinition;
  getAiPolicy(id: CombatAiPolicyId): CombatAiPolicyDefinition;
  getExperienceBudget(id: EncounterExperienceBudgetId): EncounterExperienceBudgetDefinition;
  getMonsterExperienceProfile(
    id: MonsterExperienceProfileId,
  ): MonsterExperienceProfileDefinition;
}

// ── Encounter Source 與 Detailed 請求（§3.1）─────────────────────────
export type CombatEncounterSource =
  | {
      kind: 'mapContent';
      mapId: MapInstanceId;
      contentId: ContentInstanceId;
      encounterGroupId: EncounterGroupDefinitionId;
    }
  | {
      kind: 'playerTravelEvent';
      interactionId: InteractionId;
      eventInstanceId: PlayerTravelEventInstanceId;
      encounterGroupId: EncounterGroupDefinitionId;
    };

export type DetailedCombatRequest = {
  teamId: TeamId;
  source: CombatEncounterSource;
  participantSnapshotRevision: Revision;
  rngContext: RngContext;
};

// ── 公開 Query（§4）───────────────────────────────────────────────────
export type CombatFootprint = { width: 1 | 2 | 3; height: 1 | 2 | 3 };
export type CombatEncounterPhase =
  | 'initializing'
  | 'active'
  | 'awaitingPlayerCommand'
  | 'resolved';
export type CombatantLifecycle = 'ready' | 'acting' | 'incapacitated' | 'dead';
export type CombatSide = 'player' | 'enemy';

export type CombatantSourceRef =
  | { kind: 'character'; characterId: CharacterId }
  | {
      kind: 'monster';
      monsterDefinitionId: MonsterDefinitionId;
      runtimeEnemyId: RuntimeEnemyId;
    };

// Derived read model; doc names CombatantView but never defines it (see report note).
export type CombatantView = Readonly<{
  combatantId: CombatantId;
  source: CombatantSourceRef;
  side: CombatSide;
  footprint: CombatFootprint;
  anchorCell: GridCell;
  health: number;
  mana: number;
  currentCtb: number;
  activeWeaponSetId?: WeaponSetId;
  activeStatuses: readonly CombatStatusInstance[];
  state: CombatantLifecycle;
  revision: Revision;
}>;

// Derived read model; doc names CombatEncounterView but never defines it (see report note).
export type CombatEncounterView = Readonly<{
  encounterId: EncounterId;
  source: CombatEncounterSource;
  playerTeamId: TeamId;
  playerFormationRevision: Revision;
  state: CombatEncounterPhase;
  currentActorId?: CombatantId;
  readyQueue: readonly CombatantId[];
  combatants: readonly CombatantView[];
  revision: Revision;
}>;

// Derived: doc names CombatActionOption[] as getAvailableActions return but never
// defines it (see report note).
export type CombatActionOption = Readonly<{
  skillId: SkillDefinitionId;
  actionKind: CombatActionKind;
  activationHand: CombatActivationHand;
  requiresWeaponSetId?: WeaponSetId;
  available: boolean;
}>;

export interface CombatQuery {
  getEncounter(id: EncounterId): CombatEncounterView;
  getAvailableActions(encounterId: EncounterId, actorId: CombatantId): CombatActionOption[];
  getCtbOrder(encounterId: EncounterId): CombatantId[];
  getCombatant(id: CombatantId): CombatantView;
}

export interface DetailedCombatResolver {
  begin(input: DetailedCombatRequest): EncounterId;
}

// ── 輸入 Internal Command（§5.1）─────────────────────────────────────
// Derived payload: doc describes StartCombatEncounter inputs in prose (see report note).
export type StartCombatEncounterCommand = Readonly<{
  type: 'StartCombatEncounter';
  teamId: TeamId;
  source: CombatEncounterSource;
  participantSnapshotRevision: Revision;
  rngContext: RngContext;
}>;

// ── 輸入 玩家 Game Command（§5.2）────────────────────────────────────
export type UseCombatSkillCommand = Readonly<{
  type: 'useCombatSkill';
  encounterId: EncounterId;
  actorId: CombatantId;
  skillId: SkillDefinitionId;
  weaponSetId?: WeaponSetId;
  targetCombatantIds: readonly CombatantId[];
}>;
export type UseCombatItemCommand = Readonly<{
  type: 'useCombatItem';
  encounterId: EncounterId;
  actorId: CombatantId;
  itemInstanceId: ItemInstanceId;
}>;
// 指揮隊友：**未閉合的能力**。不在 CombatGameCommand union 內，因此不會進 GameCommand、
// GAME_COMMAND_ENTRY 或 Manifest；Router 查不到它。
//
// 原本此處有 `directive: Readonly<Record<string, JsonValue>>`——規範 §7 逐字點名的袋子欄位
// （「名字本身就在說『這裡什麼都能放』」）。它之所以是袋子，正因為**指令語彙還不存在**：
// 沒有人知道可以命令隊友做哪幾件事，於是用一個什麼都塞得下的型別把問題推遲。
//
// 兩條路都不能走：留著袋子＝把「Schema 不夠用」寫成型別；現在發明一套 directive schema＝在沒有
// 任何消費者、也沒有設計來源的情況下憑空造內容形狀（§6.0：真的需要時再以具名欄位補）。
// 因此欄位整個移除，能力維持不註冊。實作那天要補的是一個**封閉判別聯集**（一個 Func 一張表：
// 每種指令一個 kind、自己的具名必填欄位），而不是把這個袋子接回來。
export type CommandAllyCommand = Readonly<{
  type: 'commandAlly';
  encounterId: EncounterId;
  allyId: CombatantId;
}>;
export type CombatRestCommand = Readonly<{
  type: 'combatRest';
  encounterId: EncounterId;
  actorId: CombatantId;
}>;
// 只列已實作的。尚未註冊：
//   useCombatItem —— 只送出 CommitCombatItemUse，不套效果、不加延遲，卻回報成功。
//   commandAlly   —— 指令語彙不存在（見上方 CommandAllyCommand 說明）；system.ts 的
//                    handleCommandAlly 只是第二道保險的 typed rejection，不是實作。
export type CombatGameCommand = UseCombatSkillCommand | CombatRestCommand;

// combat 作為唯一 Handler 接收的 Internal Command（目前僅一筆）。
export type CombatInternalCommand = StartCombatEncounterCommand;

// ── 輸出 Internal Command（接收者：character / map / inventory）────────
export type CombatOutboundInternalCommand =
  | ApplyCombatCondition
  | ResolvePlayerMapContent
  | CommitCombatItemUse;

// ── 輸出事件（§7）─────────────────────────────────────────────────────
export type CombatEncounterOutcome = 'victory' | 'defeat';

// `CombatEncounterResolvedPayload.contentResolution?: Readonly<Record<string, JsonValue>>` 已移除。
//
// 它是規範 §7 的袋子欄位，而且**零生產者、零消費者**：resolveEncounter 從來沒有填過它，也沒有任何
// 訂閱者讀過它。地圖內容的處理權在 B.5 就已裁定歸 dungeon（dungeon 訂閱 CombatEncounterResolved
// 後發 ResolvePlayerMapContent，因為該命令必填的 distributionId 屬 Dungeon Session，combat 取不到）。
// 所以 combat 這一側本來就不該帶內容處理結果。
// §6.0：沒有消費者時優先刪除欄位，而不是替一個沒人要的欄位發明 schema；真的需要時再以具名欄位補。

// 單次行動解析出的逐項結果（CombatActionResolved.results）。
//
// 原本是 `Readonly<Record<string, JsonValue>>`——一個袋子。後果是規範列的四件事同時發生：讀的人
// 得先知道 `kind` 才知道 `amount` 是傷害還是 CTB、欄位加不了必填約束、驗證器寫不出來、產生端拿
// `String(id)` 把 branded ID 攤成裸字串（型別資訊在事件邊界整個掉光）。
//
// 現在照「一個 Func 一張表」定形：**每個 kind 只帶自己的欄位、全部必填、不共用模糊欄位**。
// 兩個 kind 之間沒有任何共用欄位，也不需要共用——`targetId` 與 `actorId`/`defenderId` 語意不同，
// 就不會被壓成同一個 `id`。ID 一律用 branded 型別，訂閱者不必再自己轉回去。
//
// 這裡的 `kind` 是**領域模型變體**（與 CombatEncounterSource.kind、ItemLocation.kind 同類），
// 不是 Definition 家族識別，不進 registry，也不與 definition-kinds.ts 相干。
export type CombatActionResult =
  | Readonly<{
      kind: 'dealDamage';
      targetId: CombatantId;
      // 面板傷害（未被 HP 夾住的原始值），用於顯示與致死判定。
      amount: number;
      targetDied: boolean;
    }>
  | Readonly<{ kind: 'heal'; targetId: CombatantId; amount: number }>
  | Readonly<{
      kind: 'adjustCtb';
      targetId: CombatantId;
      // 已套控制抗性折算與行動窗上限之後、真正加到 CTB 上的量（可為負）。
      appliedCtbDelta: number;
    }>
  | Readonly<{
      kind: 'interruptCasting';
      targetId: CombatantId;
      interruptedSkillId: SkillDefinitionId;
      addedDelay: number;
    }>
  | Readonly<{
      kind: 'applyStatus';
      targetId: CombatantId;
      statusId: CombatStatusDefinitionId;
      // 合併（replace/refresh/strongest）之後**實際生效**的那一筆，不是本次鑄出來的那一筆。
      statusInstanceId: CombatStatusInstanceId;
      remainingTargetActions: number;
    }>
  | Readonly<{ kind: 'removeStatus'; targetId: CombatantId; statusId: CombatStatusDefinitionId }>
  | Readonly<{
      kind: 'counter';
      defenderId: CombatantId;
      attackerId: CombatantId;
      counterSkillId: SkillDefinitionId;
    }>
  | Readonly<{ kind: 'counterStanceEstablished'; actorId: CombatantId; skillId: SkillDefinitionId }>
  | Readonly<{
      kind: 'rest';
      actorId: CombatantId;
      healthRestored: number;
      manaRestored: number;
    }>;

export type CombatEncounterStartedPayload = Readonly<{
  type: 'CombatEncounterStarted';
  encounterId: EncounterId;
  teamId: TeamId;
  source: CombatEncounterSource;
}>;
export type CombatActionResolvedPayload = Readonly<{
  type: 'CombatActionResolved';
  encounterId: EncounterId;
  actorId: CombatantId;
  skillId?: SkillDefinitionId;
  results: readonly CombatActionResult[];
}>;
export type CombatEncounterResolvedPayload = Readonly<{
  type: 'CombatEncounterResolved';
  encounterId: EncounterId;
  teamId: TeamId;
  participantCharacterIds: readonly CharacterId[];
  source: CombatEncounterSource;
  outcome: CombatEncounterOutcome;
}>;
export type CombatTeamOutcomePayload = Readonly<{
  type: 'CombatTeamOutcome';
  teamId: TeamId;
  canContinue: boolean;
  reason: string;
}>;
// mastery-earned payloads 由 combat-sequence 擁有（見檔首 import）；此處不再宣告，直接用於事件 union。

export type CombatDomainEvent =
  | ({ type: 'CombatEncounterStarted' } & CombatEncounterStartedPayload)
  | ({ type: 'CombatActionResolved' } & CombatActionResolvedPayload)
  | ({ type: 'CombatEncounterResolved' } & CombatEncounterResolvedPayload)
  | ({ type: 'CombatTeamOutcome' } & CombatTeamOutcomePayload)
  | ({ type: 'CombatAttackMasteryEarned' } & CombatAttackMasteryEarnedPayload)
  | ({ type: 'CombatDefenseMasteryEarned' } & CombatDefenseMasteryEarnedPayload)
  | ({ type: 'CombatSupportMasteryEarned' } & CombatSupportMasteryEarnedPayload);
