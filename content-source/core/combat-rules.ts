// content-source/core/combat-rules.ts
// 戰鬥的**文化無關**規則骨架：倒扣式 CTB 的開場值、五處行動延遲、傷害／治療／CTB／中斷規則、
// 首批狀態語彙與其效果、控制抗性檔、AI 策略檔、經驗預算與怪物經驗帶。
//
// 這一份檔案裡沒有任何一國的怪物、技能、裝備或遭遇——那些是 culture pack。此處只放
// 「四國載入同一份、換文化不會改變」的規則與平衡基準。
//
// ── 來源（逐筆對照）────────────────────────────────────────────────────────────
//   * `docs/03_content/yunhua/yunhua_content.data.mjs` 的 `balanceModel`（只讀）：
//       - `formulas`「開場 CTB」            → opening-ctb-rule.core.standard
//       - `delayProfiles`（六筆）           → action-delay-rule.core.{quick,standard,heavy,cast,perform,stance}
//       - `ctbAdjustments`（四列）          → combat-ctb-adjustment-rule ×3 + action-delay-rule.core.interruption
//       - `statusRules`（五列）             → combat-status ×5 + applyStatus 效果 ×5
//       - `controlResistanceRules`（三列）  → combat-control-resistance-profile ×3
//       - `experience`（五列）              → monster-experience-profile ×6
//       - `formulas`「物理／魔法／樂器傷害」→ combat-damage-rule ×3 的通道劃分
//     `balanceModel` 雖然放在雲華目錄下，它的延遲／狀態／CTB／控制抗性／Tier 帶是四國共用的平衡
//     基準（見該檔 `scope`：以雲華為第一版可玩基準並向 Tier III～V 延伸），因此屬 core。
//   * `docs/00_core/architecture/11_combat_module.md` §2.5～§2.7、§8.1～§8.6：型別、效果語彙的
//     封閉集合、控制抗性語意、經驗彙總方式。
//   * `docs/03_content/yunhua/yunhua_content.md` §6.1（疊加規則逐 Effect 明示）、§6.3（延遲語言）、
//     §7.1（Tier 帶與威脅抗性百分比）。
//   * `docs/02_systems/combat_skill_effect_spec.md`：反擊須「先花一次行動、事後付延遲代價」。
//
// 標成「**第一版方案（待討論）**」的數值＝設計文件沒有明文，由本輪作者設計。它們全部進資料，
// 沒有一個落在程式裡；要改只改這張表。
//
// ── 文化內容的邊界（不在此檔）──────────────────────────────────────────────────
//   * `monster` / `encounter-group` / `combat-skill` / `equipment-effect`：一國的內容。
//   * 五個狀態的**名字**（瘴息／破綻／印痕／護印／定息）是雲華語彙。`CombatStatusDefinition`
//     沒有名稱或本地化欄位，所以此處只有機制槽位（降命中／降格擋／降魔防／升魔防／升命中），
//     沒有任何文化字串外洩。四國各自的顯示名走 UI 本地化，不是這一份定義。
//   * 一國專屬的 CTB 量（例如雲華裝備效果的「自身 CTB −6／−10」）不在此檔：culture pack 可以
//     自己宣告 `combat-ctb-adjustment-rule` 這個 kind 並補上該國的那幾筆。

import type {
  ActionDelayRuleDefinition,
  CombatAiPolicyDefinition,
  CombatControlResistanceProfileDefinition,
  CombatCtbAdjustmentRuleDefinition,
  CombatDamageChannel,
  CombatDamageRuleDefinition,
  CombatEffectDefinition,
  CombatHealRuleDefinition,
  CombatInterruptionRuleDefinition,
  CombatRuleDefinition,
  CombatStatusDefinition,
  CombatStatusPolarity,
  CombatStatusStackPolicy,
  EncounterExperienceBudgetDefinition,
  MonsterExperienceProfileDefinition,
  OpeningCtbRuleDefinition,
  CombatSkillDefinitionView,
} from '../../src/contracts/combat';
import type { PrimaryAttributeId } from '../../src/contracts/progression';
import { combatTargetResolverId } from './resolver-ids';
import type {
  ActionDelayRuleId,
  CombatAiPolicyId,
  CombatControlResistanceProfileId,
  CombatCtbAdjustmentRuleId,
  CombatDamageRuleId,
  CombatEffectDefinitionId,
  DefinitionHeader,
  SkillDefinitionId,
  CombatHealRuleId,
  CombatInterruptionRuleId,
  CombatRuleId,
  CombatStatusDefinitionId,
  EncounterExperienceBudgetId,
  ExperienceAwardRuleId,
  MonsterExperienceProfileId,
  OpeningCtbRuleId,
  ResolverId,
} from '../../src/contracts/core';
import type { DefenseMasteryRoutingRuleId } from '../../src/contracts/progression';
import { cultureIds, type Authored, type AuthoredDomain } from '../authoring';

const core = cultureIds('core');

// kind 字串的權威來源是 `src/app/content/combat-reader.ts` 的 `COMBAT_DEFINITION_KINDS`。
// 此處逐字對照抄寫（作者層不 import src 的執行期值，只 import 型別）；打錯字會在自檢的
// `requireDefinitionSchemaVersion(kind)` 立刻失敗，不會靜默變成「讀不到這筆定義」。
const KIND = {
  combatRule: 'combat-rule',
  openingCtbRule: 'opening-ctb-rule',
  actionDelayRule: 'action-delay-rule',
  damageRule: 'combat-damage-rule',
  healRule: 'combat-heal-rule',
  ctbAdjustmentRule: 'combat-ctb-adjustment-rule',
  interruptionRule: 'combat-interruption-rule',
  status: 'combat-status',
  effect: 'combat-effect',
  aiPolicy: 'combat-ai-policy',
  experienceBudget: 'encounter-experience-budget',
  monsterExperienceProfile: 'monster-experience-profile',
  controlResistanceProfile: 'combat-control-resistance-profile',
  skill: 'combat-skill',
};

// ── 跨 domain 引用 ──────────────────────────────────────────────────────────
//
// 這三筆 ID 屬 **progression** 的 kind（`defense-mastery-routing-rule` / `experience-award-rule`），
// 不是這個檔案能鑄的。依 ID 規約 `<kind 前綴>.core.<local>` 拼字串引用，由整合者確認 progression
// 那一側真的產出同名定義；對不上就是載入期的「引用不存在的定義」，不是這裡給預設值可以蓋掉的。
const DEFENSE_MASTERY_ROUTING_RULE_ID = core.id<DefenseMasteryRoutingRuleId>(
  'defense-mastery-routing-rule',
  'standard',
);
const COMBAT_ATTACK_AWARD_RULE_ID = core.id<ExperienceAwardRuleId>(
  'experience-award-rule',
  'combat-attack',
);
const COMBAT_DEFENSE_AWARD_RULE_ID = core.id<ExperienceAwardRuleId>(
  'experience-award-rule',
  'combat-defense',
);

// ── Resolver ID ─────────────────────────────────────────────────────────────
//
// 現有的 Definition 只給 `xxxResolverId: ResolverId`，**沒有** params 定義的指標，而
// `CombatResolverPort.resolvePower` 的輸入也只有 `resolverId / encounter / actorId / targetId`。
// 因此「+8 CTB」「命中 raw −18」「技能威力 ×1.2」這些調校量在目前的契約下沒有資料落點——
// 唯一能表達差異的手段是**一個調校值一個 Resolver ID**。這不是好形狀（見回報的契約缺口），
// 但它至少讓每一個調校量在資料裡有名字、可被計數，而不是藏在某個 Handler 的常數裡。
export const RESOLVER = {
  damagePhysical: 'resolver:combat.damage-power.physical' as ResolverId,
  damageMagic: 'resolver:combat.damage-power.magic' as ResolverId,
  damageInstrument: 'resolver:combat.damage-power.instrument' as ResolverId,
  healStandard: 'resolver:combat.heal-power.standard' as ResolverId,
  healPotent: 'resolver:combat.heal-power.potent' as ResolverId,
  ctbLight: 'resolver:combat.ctb-amount.light' as ResolverId,
  ctbStandard: 'resolver:combat.ctb-amount.standard' as ResolverId,
  ctbHeavy: 'resolver:combat.ctb-amount.heavy' as ResolverId,
  statusAccuracyDown: 'resolver:combat.status-modifier.accuracy-down' as ResolverId,
  statusGuardDown: 'resolver:combat.status-modifier.guard-down' as ResolverId,
  statusMagicDefenseDown: 'resolver:combat.status-modifier.magic-defense-down' as ResolverId,
  statusMagicDefenseUp: 'resolver:combat.status-modifier.magic-defense-up' as ResolverId,
  statusAccuracyUp: 'resolver:combat.status-modifier.accuracy-up' as ResolverId,
  aiSingleSkillAggressor: 'resolver:combat.ai-behavior.single-skill-aggressor' as ResolverId,
  aiEliteThreatFocus: 'resolver:combat.ai-behavior.elite-threat-focus' as ResolverId,
  aiBossRotation: 'resolver:combat.ai-behavior.boss-rotation' as ResolverId,
};

// ── 純資料展開工具 ──────────────────────────────────────────────────────────
//
// 只把「主屬 −N／點」這種表格寫法攤成契約的物件陣列，沒有任何規則判斷。
// （契約的 `reductions` 是可變陣列，所以這裡回傳可變陣列，不加 readonly。）
type Reduction = { primaryAttribute: PrimaryAttributeId; reductionPerPoint: number };

function reductions(
  ...rows: readonly (readonly [PrimaryAttributeId, number])[]
): Reduction[] {
  return rows.map(([primaryAttribute, reductionPerPoint]) => ({
    primaryAttribute,
    reductionPerPoint,
  }));
}

// ── 開場 CTB（§2.7 / balanceModel.formulas「開場 CTB」）────────────────────────
//
// `max(22, 70 − 反 × 0.35 − 協 × 0.15)`，敵我共用同一基礎值（§8.1）。
const OPENING_CTB_RULE_ID = core.id<OpeningCtbRuleId>(KIND.openingCtbRule, 'standard');

const openingCtbRule: Authored<OpeningCtbRuleDefinition> = {
  kind: KIND.openingCtbRule,
  id: OPENING_CTB_RULE_ID,
  baseCtb: 70,
  reductions: reductions(['reaction', 0.35], ['coordination', 0.15]),
  minimumCtb: 22,
};

// ── 行動延遲（§2.7 / balanceModel.delayProfiles / yunhua_content.md §6.3）──────
//
// combat 的**五處**延遲全部經 `delayFromRule` 取得一個 ActionDelayRuleId：技能、切換武器組、
// 反擊、中斷、休息。每一處都必須在這張表裡有一筆對應資料，否則那條路是 typed rejection。
//
// 前六筆（quick…stance）是 balanceModel.delayProfiles 逐列照抄，供技能引用。
// 後四筆是另外四處延遲來源，設計文件沒有給數字，標為第一版方案。
type DelayRow = Readonly<{
  local: string;
  baseDelay: number;
  minimumDelay: number;
  reductions: Reduction[];
}>;

const DELAY_ROWS: readonly DelayRow[] = [
  // balanceModel.delayProfiles.quick —— 迅捷：補品、飛針、短刀試探、管樂支援。
  { local: 'quick', baseDelay: 28, minimumDelay: 14, reductions: reductions(['reaction', 0.1], ['coordination', 0.06]) },
  // balanceModel.delayProfiles.standard —— 標準：多數單體攻擊、一般符術（同 Tier 的比較基準）。
  { local: 'standard', baseDelay: 36, minimumDelay: 18, reductions: reductions(['reaction', 0.1], ['coordination', 0.05]) },
  // balanceModel.delayProfiles.heavy —— 沉重：橫掃、雙手重擊、範圍符術、高量治療。
  { local: 'heavy', baseDelay: 48, minimumDelay: 24, reductions: reductions(['reaction', 0.08], ['coordination', 0.04]) },
  // balanceModel.delayProfiles.cast —— 施術：由智與反減免。
  { local: 'cast', baseDelay: 42, minimumDelay: 22, reductions: reductions(['intelligence', 0.05], ['reaction', 0.06]) },
  // balanceModel.delayProfiles.perform —— 演奏：由魅與協減免。
  { local: 'perform', baseDelay: 40, minimumDelay: 20, reductions: reductions(['charisma', 0.06], ['coordination', 0.05]) },
  // balanceModel.delayProfiles.stance —— 架勢：建立守勢／反擊架勢的那一次行動。
  { local: 'stance', baseDelay: 32, minimumDelay: 16, reductions: reductions(['reaction', 0.1], ['coordination', 0.05]) },

  // 第一版方案（待討論）：反擊**解析後**支付的延遲。
  // 理由：combat_skill_effect_spec.md 明列反擊的平衡來源之一是「反擊後的行動延遲代價」，但沒有
  // 數字。設計成比最快的技能（quick 28）更低、又不可忽略：架勢那一次已付 32，反擊本身再付 20，
  // 兩次合計 52 略高於一次 heavy（48）——換到的是一次條件成立才發生的額外出手。
  { local: 'counter', baseDelay: 20, minimumDelay: 10, reductions: reductions(['reaction', 0.08], ['coordination', 0.04]) },

  // 第一版方案（待討論）：跨武器組施放技能時先付的切換延遲（§8.3）。
  // 理由：三組武器 × 三招＝九招隨時可用，切換若為 0 就是戰鬥系統裡最強的免費自由度。設計成
  // 明顯低於任何一招（quick 28 的 43%）但非零：同組連打仍是最有效率的打法，跨組換招要付價。
  // 只由反應減免（換手是手部動作，不吃智／魅）。
  { local: 'weapon-set-switch', baseDelay: 12, minimumDelay: 6, reductions: reductions(['reaction', 0.04]) },

  // 第一版方案（待討論）：戰鬥休息的延遲。
  // 理由：休息不產生任何對敵效果，代價必須高於一般攻擊，否則會變成 CTB 換血的最佳解。取略低於
  // heavy（48）的 44，並給比 heavy 更弱的屬性減免——高反應的角色不該把休息變成廉價動作。
  { local: 'rest', baseDelay: 44, minimumDelay: 22, reductions: reductions(['reaction', 0.06], ['coordination', 0.03]) },

  // balanceModel.ctbAdjustments 第四列「中斷：取消讀條並 +16 CTB」。
  // 這 16 是**被中斷者**要付的延遲，經 `interruptionDelayRuleId` → `delayFromRule` 生效。
  // 刻意不給任何屬性減免：+16 是「讀條被打斷」的固定代價，讓它隨被中斷者的反應而縮水，會使
  // 高反應目標幾乎免疫中斷。依 §2.2 Rule Validation：「控制抗性只改寫外來正值 CTB 增加與成功
  // 中斷頻率；自身 CTB 扣減、技能原始延遲與狀態持續不受影響。」——中斷頻率的調節權在
  // controlResistanceProfile，不在被中斷者的主屬。
  // 因此 base 與 minimum 同值，reductions 為空——這是內容的明確宣告，不是漏填。
  { local: 'interruption', baseDelay: 16, minimumDelay: 16, reductions: reductions() },
];

function delayRule(row: DelayRow): Authored<ActionDelayRuleDefinition> {
  return {
    kind: KIND.actionDelayRule,
    id: core.id<ActionDelayRuleId>(KIND.actionDelayRule, row.local),
    baseDelay: row.baseDelay,
    reductions: row.reductions,
    minimumDelay: row.minimumDelay,
  };
}

export const ACTION_DELAY_RULE_IDS: Readonly<Record<string, ActionDelayRuleId>> =
  Object.fromEntries(
    DELAY_ROWS.map((row) => [row.local, core.id<ActionDelayRuleId>(KIND.actionDelayRule, row.local)]),
  );

function delayRuleId(local: string): ActionDelayRuleId {
  return core.id<ActionDelayRuleId>(KIND.actionDelayRule, local);
}

// ── 傷害規則（§2.5／§2.6 + balanceModel.formulas 的三條傷害公式）───────────────
//
// 通道劃分是結構：物理／魔法／樂器各走自己的減傷管道（balanceModel「一般／魔法減傷」與
// 「格擋吸收」是兩套不同的公式）。每個通道的加權公式（物傷引用肌、協；魔傷引用智；樂器傷害
// 用智、協、魅）由對應 Resolver 承載。
//
// `canBeBlocked`：**第一版方案（待討論）**。文件沒有明文說哪個通道可格擋。依據是
// `yunhua_content.data.mjs` 的裝備係數輔助函式：`block = (reaction, coordination)`、
// `blockAbsorb = muscle`、`magicDr = intelligence`——格擋與格擋吸收兩條 raw 只由物理側的
// 盾牌／中甲／重甲／巨劍供給，魔法側的對應機制是「魔法減傷 raw」＋印痕／護印。兩套機制各管
// 一邊，所以第一版讓物理可格擋、魔法與樂器不可。
//
// **注意：這個欄位目前沒有任何消費者。** `src/**` 只有契約宣告（`src/contracts/combat/index.ts`）
// 與 fixtures（`src/modules/combat/fixtures.ts`，一律填 true）讀得到它；`system.ts` 的傷害路徑
// 從未讀 `canBeBlocked`。也就是說這三筆值現在改成什麼都不會改變行為——等格擋接上傷害管道時，
// 這個劃分才會第一次生效，屆時需要重新確認。
type DamageRow = Readonly<{
  local: string;
  channel: CombatDamageChannel;
  canBeBlocked: boolean;
  powerResolverId: ResolverId;
}>;

const DAMAGE_ROWS: readonly DamageRow[] = [
  { local: 'physical', channel: 'physical', canBeBlocked: true, powerResolverId: RESOLVER.damagePhysical },
  { local: 'magic', channel: 'magic', canBeBlocked: false, powerResolverId: RESOLVER.damageMagic },
  { local: 'instrument', channel: 'instrument', canBeBlocked: false, powerResolverId: RESOLVER.damageInstrument },
];

function damageRule(row: DamageRow): Authored<CombatDamageRuleDefinition> {
  return {
    kind: KIND.damageRule,
    id: core.id<CombatDamageRuleId>(KIND.damageRule, row.local),
    damageChannel: row.channel,
    powerResolverId: row.powerResolverId,
    canBeBlocked: row.canBeBlocked,
  };
}

export const COMBAT_DAMAGE_RULE_IDS: Readonly<Record<string, CombatDamageRuleId>> =
  Object.fromEntries(
    DAMAGE_ROWS.map((row) => [row.local, core.id<CombatDamageRuleId>(KIND.damageRule, row.local)]),
  );

// ── 治療規則 ────────────────────────────────────────────────────────────────
//
// 兩段治療量級。**第一版方案（待討論）**：文件沒有列治療數值，但 yunhua_content.md §6.3 把
// 「高量治療」歸在沉重延遲、把補品歸在迅捷延遲，可見至少存在兩個量級。實際回復量在 Resolver
// 的調校量裡（見上方 Resolver ID 的說明與回報的契約缺口）。
type HealRow = Readonly<{ local: string; powerResolverId: ResolverId }>;

const HEAL_ROWS: readonly HealRow[] = [
  { local: 'standard', powerResolverId: RESOLVER.healStandard },
  { local: 'potent', powerResolverId: RESOLVER.healPotent },
];

function healRule(row: HealRow): Authored<CombatHealRuleDefinition> {
  return {
    kind: KIND.healRule,
    id: core.id<CombatHealRuleId>(KIND.healRule, row.local),
    powerResolverId: row.powerResolverId,
  };
}

export const COMBAT_HEAL_RULE_IDS: Readonly<Record<string, CombatHealRuleId>> =
  Object.fromEntries(
    HEAL_ROWS.map((row) => [row.local, core.id<CombatHealRuleId>(KIND.healRule, row.local)]),
  );

// ── CTB 調整規則（balanceModel.ctbAdjustments 前三列）────────────────────────
//
// 輕 +8（飛針、低階干擾）／標準 +14（盾擊、長槍）／重 +22（Boss 重擊、沉重符術）。
// 實際數值在 Resolver 的調校量裡；此處三筆的差別就是三個不同的 Resolver ID。
type CtbRow = Readonly<{ local: string; amountResolverId: ResolverId }>;

const CTB_ROWS: readonly CtbRow[] = [
  { local: 'light', amountResolverId: RESOLVER.ctbLight },
  { local: 'standard', amountResolverId: RESOLVER.ctbStandard },
  { local: 'heavy', amountResolverId: RESOLVER.ctbHeavy },
];

function ctbAdjustmentRule(row: CtbRow): Authored<CombatCtbAdjustmentRuleDefinition> {
  return {
    kind: KIND.ctbAdjustmentRule,
    id: core.id<CombatCtbAdjustmentRuleId>(KIND.ctbAdjustmentRule, row.local),
    amountResolverId: row.amountResolverId,
  };
}

export const COMBAT_CTB_ADJUSTMENT_RULE_IDS: Readonly<Record<string, CombatCtbAdjustmentRuleId>> =
  Object.fromEntries(
    CTB_ROWS.map((row) => [
      row.local,
      core.id<CombatCtbAdjustmentRuleId>(KIND.ctbAdjustmentRule, row.local),
    ]),
  );

// ── 中斷規則（§2.6 + balanceModel.ctbAdjustments 第四列）──────────────────────
//
// 只能中斷正在進行的 cast／perform 讀條，並以 `interruption` 延遲規則（+16）結束該次讀條。
const CASTING_INTERRUPTION_RULE_ID = core.id<CombatInterruptionRuleId>(
  KIND.interruptionRule,
  'casting',
);

const castingInterruptionRule: Authored<CombatInterruptionRuleDefinition> = {
  kind: KIND.interruptionRule,
  id: CASTING_INTERRUPTION_RULE_ID,
  appliesToActionKinds: ['cast', 'perform'],
  interruptionDelayRuleId: delayRuleId('interruption'),
};

// ── 首批狀態（balanceModel.statusRules + yunhua_content.md §6.1）───────────────
//
// 五個機制槽位。對照表（設計來源的雲華名 → 本檔的機制 local 名）：
//   瘴息 miasma        → accuracy-down        命中、魔法命中 raw −18
//   破綻 open-guard    → guard-down           格擋與格擋吸收 raw −24
//   印痕 sigil-mark    → magic-defense-down   魔法減傷 raw −30
//   護印 sigil-ward    → magic-defense-up     魔法減傷 raw +36、預判 raw +14
//   定息 steady-breath → accuracy-up          命中 raw +18、格擋 raw +12
//
// 上列 raw 修正量進不了這份定義：`CombatStatusDefinition` 只有 polarity / modifierResolverId /
// displayPriority，數值在 `modifierResolverId` 後面（見回報的契約缺口）。因此一個狀態一個 Resolver。
//
// `displayPriority`：**第一版方案（待討論）**。契約沒有說大小的方向，目前也還沒有消費者（UI）。
// 依 balanceModel.statusRules 的列序給 1…5（負面在前、正面在後），讓順序至少是資料決定的。
type StatusRow = Readonly<{
  local: string;
  polarity: CombatStatusPolarity;
  displayPriority: number;
  modifierResolverId: ResolverId;
  // 該狀態被套用時的疊加策略（§6.1：負面標記 refresh、護印與定息 strongest）。
  // 放在這張表只是為了讓「狀態 ↔ 其標準疊加方式」在同一列可讀；實際寫進的是下方 applyStatus
  // **效果**的 `stackPolicy` 欄位——契約要求疊加規則由 Effect 明示，不由狀態名推導。
  stackPolicy: CombatStatusStackPolicy;
}>;

const STATUS_ROWS: readonly StatusRow[] = [
  { local: 'accuracy-down', polarity: 'negative', displayPriority: 1, modifierResolverId: RESOLVER.statusAccuracyDown, stackPolicy: 'refresh' },
  { local: 'guard-down', polarity: 'negative', displayPriority: 2, modifierResolverId: RESOLVER.statusGuardDown, stackPolicy: 'refresh' },
  { local: 'magic-defense-down', polarity: 'negative', displayPriority: 3, modifierResolverId: RESOLVER.statusMagicDefenseDown, stackPolicy: 'refresh' },
  { local: 'magic-defense-up', polarity: 'positive', displayPriority: 4, modifierResolverId: RESOLVER.statusMagicDefenseUp, stackPolicy: 'strongest' },
  { local: 'accuracy-up', polarity: 'positive', displayPriority: 5, modifierResolverId: RESOLVER.statusAccuracyUp, stackPolicy: 'strongest' },
];

function statusId(local: string): CombatStatusDefinitionId {
  return core.id<CombatStatusDefinitionId>(KIND.status, local);
}

function combatStatus(row: StatusRow): Authored<CombatStatusDefinition> {
  return {
    kind: KIND.status,
    id: statusId(row.local),
    polarity: row.polarity,
    modifierResolverId: row.modifierResolverId,
    displayPriority: row.displayPriority,
  };
}

export const COMBAT_STATUS_IDS: Readonly<Record<string, CombatStatusDefinitionId>> =
  Object.fromEntries(STATUS_ROWS.map((row) => [row.local, statusId(row.local)]));

// 所有五個狀態的持續時間都是 2 次目標行動（balanceModel.statusRules 第四欄「2 次目標行動」）。
// 倒扣單位是「目標後續完成的行動次數」（§2.5），不是世界日或 UI 回合。
const STATUS_DURATION_TARGET_ACTIONS = 2;

// ── 戰鬥效果（§2.5 的封閉 tagged variant）─────────────────────────────────────
//
// `CombatEffectDefinition.operation` 是六個 kind 的封閉判別聯集：一個 kind 只帶自己的具名必填
// 欄位，兩個 kind 不共用模糊欄位。新增效果＝挑一個 kind 填欄位（內容改動）；新增 kind＝改契約
// ＋Handler＋Validator（程式改動）。此處只填前者。
//
// **此檔不寫 dealDamage 與 heal 效果**，而不是漏寫：
//   `CombatEffectDefinition` 的 dealDamage 只帶 `damageRuleId`，而 `CombatDamageRuleDefinition`
//   只帶通道與一個 Resolver ID——「技能威力」（balanceModel 傷害公式的最後一個乘項）在契約裡
//   沒有欄位可放，`resolvePower` 的輸入也拿不到 skillId。所以一筆 dealDamage 效果的實際傷害
//   完全由「哪一個 Resolver」決定，也就是**每一招技能都需要自己的 damage rule 與 Resolver**。
//   那是技能的一部分＝文化內容。core 只提供三個通道的傷害規則供文化包引用或比照。
//   （這個限制列在回報的契約缺口第 1 條。）
// 一個狀態一筆 applyStatus 效果，local 名固定為 `apply-<狀態 local>`。直接走 STATUS_ROWS，
// 不再繞一層「效果列 → 用 statusLocal 反查狀態列」：那層反查必然成功（列本身就是從 STATUS_ROWS
// 生出來的），於是它的 `find` + `throw` 是永遠不會執行的分支——資料檔裡不需要擋不到東西的條件。

// 解除狀態：只給三個負面狀態。「解除負面」是四國共用的行為——`yunhua_content.md` §2.1 四條內容
// 支柱裡，藥材是「治療、解除負面……」、符印是「施法、護印、定身、解除狀態、CTB 干擾」。
//
// （前一版註解在這裡引了 §6.1 的「需要中斷讀條時由獨立資料效果處理」當依據，那是錯的：那句話在
// 印痕那一列，講的是 interruptCasting 必須是獨立效果，與 removeStatus 無關。已移除。）
//
// 逐筆的實際使用者在 §10.1 戰鬥消耗品：清瘴丸「解除瘴息」→ remove-accuracy-down；醒神香
// 「解除印痕」→ remove-magic-defense-down；五草湯劑「解除瘴息或印痕其中一種」；回天膏
// 「解除一個負面狀態」。
// **remove-guard-down（破綻）目前沒有任何列名的使用者**——它在這裡是為了讓三個負面狀態對稱，
// 屬第一版方案；若整合者要嚴守「零消費者就不寫」，該刪的是這一筆。
// 解除**正面**狀態沒有任何設計來源指定的使用者，照「零跳優先、不預先付間接成本」不先寫。
const REMOVE_STATUS_LOCALS: readonly string[] = [
  'accuracy-down',
  'guard-down',
  'magic-defense-down',
];

function effectId(local: string): CombatEffectDefinitionId {
  return core.id<CombatEffectDefinitionId>(KIND.effect, local);
}

const applyStatusEffects: readonly Authored<CombatEffectDefinition>[] = STATUS_ROWS.map((row) => ({
  kind: KIND.effect,
  id: effectId(`apply-${row.local}`),
  operation: {
    kind: 'applyStatus',
    statusId: statusId(row.local),
    durationTargetActions: STATUS_DURATION_TARGET_ACTIONS,
    // 逐個 Effect 明示（§2.6「相同 Status 的疊加完全依該 Effect 的 stackPolicy 決定」
    // + yunhua_content.md §6.1「不得依名稱猜測疊加方式」）。
    stackPolicy: row.stackPolicy,
  },
}));

const removeStatusEffects: readonly Authored<CombatEffectDefinition>[] = REMOVE_STATUS_LOCALS.map(
  (local) => ({
    kind: KIND.effect,
    id: effectId(`remove-${local}`),
    operation: { kind: 'removeStatus', statusId: statusId(local) },
  }),
);

const adjustCtbEffects: readonly Authored<CombatEffectDefinition>[] = CTB_ROWS.map((row) => ({
  kind: KIND.effect,
  id: effectId(`ctb-${row.local}`),
  operation: {
    kind: 'adjustCtb',
    adjustmentRuleId: core.id<CombatCtbAdjustmentRuleId>(KIND.ctbAdjustmentRule, row.local),
  },
}));

const interruptCastingEffect: Authored<CombatEffectDefinition> = {
  kind: KIND.effect,
  id: effectId('interrupt-casting'),
  operation: { kind: 'interruptCasting', interruptionRuleId: CASTING_INTERRUPTION_RULE_ID },
};

// ── 怪物共通攻擊：撞擊 ──────────────────────────────────────────────────────
//
// 【設計決定】所有怪物共用這一招。20 隻怪的 `skillIds` 原本全空，設計來源的 41 招怪物技能
// 屬 skills domain 且尚未授權——在那之前怪物在 Detailed Combat 裡選不到任何行動
//（`content-source/yunhua/monsters.ts` 自己寫著「這 20 筆怪物在 skillIds 接上之前不是可玩內容」）。
// 共通一招把那個缺口關掉，而且不必先發明 41 招的數值。
//
// ── 為什麼這一筆 dealDamage 可以住在 core（本檔上面說「此檔不寫 dealDamage」）──
//
// 上面那條的理由是「技能威力在契約裡沒有欄位可放，所以每一招都需要自己的 damage rule 與
// Resolver，那是文化內容」。撞擊是**基準攻擊**——它沒有任何倍率修正，威力就是通道本身的值，
// 所以它引用 core 既有的 `combat-damage-rule.core.physical`（其 powerResolver 已綁定且有 params）
// 是完整的，不是「少填了倍率」。有倍率的招式仍然各自需要自己的 damage rule，那條限制沒有變。
//
// 怪物沒有武器也沒有熟練度成長，所以：`activationHand: 'handless'`（契約為此而設的值）、
// `weaponRequirementIds` 空、不給 `attackMasteryAwardRuleId`（缺席＝這招不發攻擊熟練）。
const monsterSlamEffect: Authored<CombatEffectDefinition> = {
  kind: KIND.effect,
  id: core.id<CombatEffectDefinitionId>(KIND.effect, 'deal-physical-damage'),
  operation: {
    kind: 'dealDamage',
    damageRuleId: core.id<CombatDamageRuleId>(KIND.damageRule, 'physical'),
  },
};

export const MONSTER_COMMON_SKILL_ID = core.id<SkillDefinitionId>(KIND.skill, 'monster-slam');

// combat 契約只有 `CombatSkillDefinitionView`（以 `skillId` 為鍵、不帶 DefinitionHeader），
// 沒有 `CombatSkillDefinition`——與 `content-source/yunhua/skills.ts` 同一個處理（見該檔說明）。
type CombatSkillDefinition = DefinitionHeader<SkillDefinitionId> &
  Omit<CombatSkillDefinitionView, 'skillId'>;

const monsterSlamSkill: Authored<CombatSkillDefinition> = {
  kind: KIND.skill,
  id: MONSTER_COMMON_SKILL_ID,
  activationHand: 'handless',
  weaponRequirementIds: [],
  actionKind: 'attack',
  masteryExperienceMode: 'damage',
  // technique 這個 kind 目前不存在任何定義（玩家技能引用的 `technique.yunhua.*` 也不存在，
  // 只因 technique 未登記為 kind 而躲過跨引用檢查）。留空是誠實的，不是漏填。
  techniqueIds: [],
  targeting: {
    // 單體敵方；`resolver:combat.target-single-hostile` 是已實作且已綁定的純格陣形狀。
    targetResolverId: combatTargetResolverId('single-hostile'),
  },
  actionDelayRuleId: core.id<ActionDelayRuleId>(KIND.actionDelayRule, 'standard'),
  effectIds: [core.id<CombatEffectDefinitionId>(KIND.effect, 'deal-physical-damage')],
  resourceCosts: [],
};

const allEffects: readonly Authored<CombatEffectDefinition>[] = [
  ...applyStatusEffects,
  ...removeStatusEffects,
  ...adjustCtbEffects,
  interruptCastingEffect,
  monsterSlamEffect,
];

export const COMBAT_EFFECT_IDS: Readonly<Record<string, CombatEffectDefinitionId>> =
  Object.fromEntries(
    [
      ...STATUS_ROWS.map((row) => `apply-${row.local}`),
      ...REMOVE_STATUS_LOCALS.map((local) => `remove-${local}`),
      ...CTB_ROWS.map((row) => `ctb-${row.local}`),
      'interrupt-casting',
    ].map((local) => [local, effectId(local)]),
  );

// ── 控制抗性檔（§2.6 + balanceModel.controlResistanceRules + yunhua_content.md §7.1）──
//
// 一般 100%／菁英 75%／Boss 50%；Boss 兩次自身行動之間外來 CTB 增加合計最多 18，且成功被
// 中斷一次後到完成下一次行動前免疫再次中斷。只作用於**外來正值** adjustCtb，負值不吃抗性。
type ControlRow = Readonly<{
  local: string;
  ctbIncreaseMultiplier: number;
  maxExternalCtbIncreaseBeforeOwnAction?: number;
  interruptionImmunityUntilOwnActionAfterSuccess: boolean;
}>;

const CONTROL_ROWS: readonly ControlRow[] = [
  { local: 'normal', ctbIncreaseMultiplier: 1, interruptionImmunityUntilOwnActionAfterSuccess: false },
  { local: 'elite', ctbIncreaseMultiplier: 0.75, interruptionImmunityUntilOwnActionAfterSuccess: false },
  {
    local: 'boss',
    ctbIncreaseMultiplier: 0.5,
    maxExternalCtbIncreaseBeforeOwnAction: 18,
    interruptionImmunityUntilOwnActionAfterSuccess: true,
  },
];

function controlResistanceProfile(
  row: ControlRow,
): Authored<CombatControlResistanceProfileDefinition> {
  return {
    kind: KIND.controlResistanceProfile,
    id: core.id<CombatControlResistanceProfileId>(KIND.controlResistanceProfile, row.local),
    ctbIncreaseMultiplier: row.ctbIncreaseMultiplier,
    // 一般與菁英**沒有**累積上限：只有 Boss 那一列寫了 18。選填欄位在此的語意是「這一檔不設
    // 上限」，由資料明講，不是忘了填。
    ...(row.maxExternalCtbIncreaseBeforeOwnAction === undefined
      ? {}
      : { maxExternalCtbIncreaseBeforeOwnAction: row.maxExternalCtbIncreaseBeforeOwnAction }),
    interruptionImmunityUntilOwnActionAfterSuccess:
      row.interruptionImmunityUntilOwnActionAfterSuccess,
  };
}

export const COMBAT_CONTROL_RESISTANCE_PROFILE_IDS: Readonly<
  Record<string, CombatControlResistanceProfileId>
> = Object.fromEntries(
  CONTROL_ROWS.map((row) => [
    row.local,
    core.id<CombatControlResistanceProfileId>(KIND.controlResistanceProfile, row.local),
  ]),
);

// ── AI 策略檔（§2.2 的 aiPolicyId）───────────────────────────────────────────
//
// **第一版方案（待討論）**：`CombatAiPolicyDefinition` 只有 `behaviorResolverId`，設計文件沒有
// 列出策略清單。分檔的依據是招數上限，因為「有幾招可選」正是選招策略唯一需要分歧的地方。
//
// 招數來源要分清楚（前一版註解把出處寫錯，此處更正）：
//   * `11_combat_module.md` §2.2 Rule Validation 與 `yunhua_content.md` §7.5 必測項都只講到
//     「一般敵人恰好 1 招；菁英與 Boss 為 2～4 招；任何敵人不得超過 4 招」——**沒有**把菁英與
//     Boss 分開。
//   * 「菁英 2～3、Boss 3～4」出自 `yunhua_content.md` §7.1 的階級基準表，而且只對 Tier I 成立
//     （同表 Tier II 菁英是 2～4）。所以那個分界是 Tier I 的平衡帶，不是全域規則。
// 因此下面三檔的邊界是本輪設計，不是文件明文；真正的硬約束只有「1 招／2～4 招／不超過 4 招」。
//   single-skill-aggressor：只有一招，策略退化為選目標（前排優先）。
//   elite-threat-focus    ：2～3 招，依威脅／狀態選招。
//   boss-rotation         ：3～4 招，依序輪替以保證每招都會出現。
// 行為本身文化無關（怪物是文化內容，選招邏輯不是）。
type AiRow = Readonly<{ local: string; behaviorResolverId: ResolverId }>;

const AI_ROWS: readonly AiRow[] = [
  { local: 'single-skill-aggressor', behaviorResolverId: RESOLVER.aiSingleSkillAggressor },
  { local: 'elite-threat-focus', behaviorResolverId: RESOLVER.aiEliteThreatFocus },
  { local: 'boss-rotation', behaviorResolverId: RESOLVER.aiBossRotation },
];

function aiPolicy(row: AiRow): Authored<CombatAiPolicyDefinition> {
  return {
    kind: KIND.aiPolicy,
    id: core.id<CombatAiPolicyId>(KIND.aiPolicy, row.local),
    behaviorResolverId: row.behaviorResolverId,
  };
}

export const COMBAT_AI_POLICY_IDS: Readonly<Record<string, CombatAiPolicyId>> =
  Object.fromEntries(
    AI_ROWS.map((row) => [row.local, core.id<CombatAiPolicyId>(KIND.aiPolicy, row.local)]),
  );

// ── 遭遇經驗預算（§2.3）─────────────────────────────────────────────────────
//
// `aggregation: 'sumMemberProfiles'` 是契約唯一的字面值：Encounter 建立時把實際成員的 Profile
// 加總一次，再乘 groupModifier，形成本次總預算（不得對每隻怪重複發放）。
//
// `groupModifier: 1.00` —— **第一版方案（待討論）**：balanceModel.experience 給的是**整群**的
// 目標值（Tier I 一般群 320／80），而下方 monster-experience-profile 已把它除回逐隻，因此加總
// 後恰好回到目標值，modifier 為乘法單位元 1。要調整群體人數獎懲時改這一欄，不改逐隻 Profile。
//
// `minimumAwardRuleId` 不填：那是 progression 的 `experience-award-rule`，而設計文件沒有為
// Encounter 設下限。選填欄位在此的語意是「沒有下限」——需要時補一筆 progression 定義再指過來。
const ENCOUNTER_EXPERIENCE_BUDGET_ID = core.id<EncounterExperienceBudgetId>(
  KIND.experienceBudget,
  'standard',
);

const standardExperienceBudget: Authored<EncounterExperienceBudgetDefinition> = {
  kind: KIND.experienceBudget,
  id: ENCOUNTER_EXPERIENCE_BUDGET_ID,
  aggregation: 'sumMemberProfiles',
  groupModifier: 1,
};

// ── 怪物經驗帶（balanceModel.experience + yunhua_content.md §7.1）──────────────
//
// balanceModel.experience 列的是**遭遇**目標值；這裡是**逐隻** Profile，兩者關係為
// 「Σ(成員 Profile) × groupModifier = 遭遇預算」。
//
//   Tier I 一般群 320／80  ÷ 8 隻 → 40／10      （§7.1：8～9 隻小型敵人形成一個低階群體遭遇）
//   Tier I 菁英    960／240 單獨出場 → 960／240  （一般群 ×3）
//   Tier I Boss  2,880／720 單獨出場             （一般群 ×9；Boss 必為大型 3×3、單獨出場）
//   Tier II 一般群 800／200 ÷ 8 隻 → 100／25
//   Tier II 菁英 2,400／600 單獨出場
//   Tier II Boss 7,200／1,800 單獨出場
//
// 除數 8 是**第一版方案（待討論），而且已知會讓一條「必測項」在 9 隻編組時失敗**——前一版註解
// 把這件事寫成「文件只給了區間」，那是低估了。文件其實把它講成硬要求：
//   * `yunhua_content.md` §7.4：「『小怪群』的怪物數量只改變戰鬥畫面與**個體 Profile 分配**，
//     不改變 Encounter 總 MXP。」
//   * `yunhua_content.md` §7.5 怪物資料必測項：「小怪群以 8～9 隻填滿或接近填滿敵方九宮格時，
//     其 `MonsterExperienceProfile` 加總與 Encounter Budget **完全一致**。」
// 一筆固定的逐隻 Profile（40／10）只能讓其中一個隻數精準：8 隻 → 320／80 ✅；9 隻 → 360／90
// （+12.5%）✗。所以這不是在區間裡選一個值，而是**目前的契約形狀滿足不了那條必測項**：
// 「隻數改變逐隻分配、總額不變」要求分配是編組層的除法，但 `MonsterExperienceProfileDefinition`
// 是掛在**怪物**上的定值，看不到自己屬於幾隻的編組。
//
// 三條可能的出路，需整合者裁決（我認為 (c) 才對得上 §7.4 的語意）：
//   (a) 逐編組 `EncounterExperienceBudgetDefinition.groupModifier`：8 隻用 1.00、9 隻用 8/9，
//       總額回到目標值。缺點是每個隻數要一筆 budget 定義。
//   (b) 接受 ±12.5% 漂移，並改寫 §7.5 的「完全一致」。
//   (c) 把攻防經驗改成由 Encounter 預算**往下除**給成員（§7.4 的原意），逐隻 Profile 只帶權重
//       而非絕對值。這需要改契約，不是內容能修的。
// 在裁決之前，下面的 tier1-normal／tier2-normal 兩筆對 8 隻編組是正確的，對 9 隻編組會超出預算。
type ExperienceRow = Readonly<{ local: string; attack: number; defense: number }>;

const EXPERIENCE_ROWS: readonly ExperienceRow[] = [
  { local: 'tier1-normal', attack: 40, defense: 10 },
  { local: 'tier1-elite', attack: 960, defense: 240 },
  { local: 'tier1-boss', attack: 2_880, defense: 720 },
  { local: 'tier2-normal', attack: 100, defense: 25 },
  { local: 'tier2-elite', attack: 2_400, defense: 600 },
  { local: 'tier2-boss', attack: 7_200, defense: 1_800 },
];

function monsterExperienceProfile(
  row: ExperienceRow,
): Authored<MonsterExperienceProfileDefinition> {
  return {
    kind: KIND.monsterExperienceProfile,
    id: core.id<MonsterExperienceProfileId>(KIND.monsterExperienceProfile, row.local),
    attackExperience: row.attack,
    defenseExperience: row.defense,
    // 跨 domain：兩筆都是 progression 的 `experience-award-rule`。見檔首的跨 domain 引用區塊。
    attackAwardRuleId: COMBAT_ATTACK_AWARD_RULE_ID,
    defenseAwardRuleId: COMBAT_DEFENSE_AWARD_RULE_ID,
  };
}

export const MONSTER_EXPERIENCE_PROFILE_IDS: Readonly<Record<string, MonsterExperienceProfileId>> =
  Object.fromEntries(
    EXPERIENCE_ROWS.map((row) => [
      row.local,
      core.id<MonsterExperienceProfileId>(KIND.monsterExperienceProfile, row.local),
    ]),
  );

export const ENCOUNTER_EXPERIENCE_BUDGET_IDS: Readonly<Record<string, EncounterExperienceBudgetId>> =
  { standard: ENCOUNTER_EXPERIENCE_BUDGET_ID };

// ── 戰鬥規則（§2.7）────────────────────────────────────────────────────────
//
// 一場戰鬥的規則骨架。`weaponSetSwitchDelayRuleId` 是 Wave E 新增的必填欄位：不填就等於把跨組
// 切換成本宣告為 0，而那是一個平衡決定，必須由內容說。
//
// `combatRestHealthRestore: 40` / `combatRestManaRestore: 30` —— **第一版方案（待討論）**。
// 設計來源只寫「回復少量生命／魔力」（§5.2），沒有數字。取值理由：
//   * balanceModel 的生命上限為 `200 + 肌 × 20`，Tier I 生命約 700～1,000，故 40 約為 4～6%；
//     魔力上限 `120 + 智 × 14`，Tier I 約 540，故 30 約為 5.5%。兩者同一量級。
//   * 同期單手標準技能傷害 55～110，所以一次休息換不到一次挨打的量；休息付 rest 延遲（44，
//     略低於 heavy 48）。這讓休息是「沒有更好選擇時的補救」，不是 CTB 換血的最佳解。
const COMBAT_RULE_ID = core.id<CombatRuleId>(KIND.combatRule, 'standard');

const standardCombatRule: Authored<CombatRuleDefinition> = {
  kind: KIND.combatRule,
  id: COMBAT_RULE_ID,
  openingCtbRuleId: OPENING_CTB_RULE_ID,
  combatRestDelayRuleId: delayRuleId('rest'),
  // 跨 domain：progression 的 `defense-mastery-routing-rule`。見檔首的跨 domain 引用區塊。
  defenseMasteryRoutingRuleId: DEFENSE_MASTERY_ROUTING_RULE_ID,
  combatRestHealthRestore: 40,
  combatRestManaRestore: 30,
  weaponSetSwitchDelayRuleId: delayRuleId('weapon-set-switch'),
};

export { COMBAT_RULE_ID, CASTING_INTERRUPTION_RULE_ID, OPENING_CTB_RULE_ID };

// 反擊延遲供文化包的 `counterStance.counterDelayRuleId` 引用（技能是文化內容，延遲規則是 core）。
export const COUNTER_DELAY_RULE_ID = delayRuleId('counter');

export const combatRulesDomain: AuthoredDomain = {
  domain: 'combat-rules',
  definitions: [
    standardCombatRule,
    openingCtbRule,
    ...DELAY_ROWS.map(delayRule),
    ...DAMAGE_ROWS.map(damageRule),
    ...HEAL_ROWS.map(healRule),
    ...CTB_ROWS.map(ctbAdjustmentRule),
    castingInterruptionRule,
    ...STATUS_ROWS.map(combatStatus),
    ...allEffects,
    ...AI_ROWS.map(aiPolicy),
    monsterSlamSkill,
    standardExperienceBudget,
    ...EXPERIENCE_ROWS.map(monsterExperienceProfile),
    ...CONTROL_ROWS.map(controlResistanceProfile),
  ],
};
