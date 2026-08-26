// content-source/core/progression-rules.ts
// Progression 的**規則**內容：傳授、經驗發放、戰鬥 MXP 分割、年齡倍率、子女教育。
// **文化無關**——四國共用同一份。一國自己的技能、配方、怪物、委託只引用這裡的規則 ID。
//
// 熟練度清單／升級曲線／交流熟練度效益在 `./progression`；`skill` 屬文化內容，不在 core。
//
// ── 來源（逐節對照；未見於文件者一律在該處標「第一版方案（待討論）」）──────────────
//   * 傳授／城鎮訓練：`docs/02_systems/mastery_experience_economy_v1.md` §五「旅行、地圖探索與傳授」
//     （28 日、成人 0.15%、子女 0.225%、城鎮教師 Lv.5）與同節「單次跨級上限」。
//   * 內容階級 I～V 的基礎值：同文件 §四「遭遇戰基準」（一般群體攻擊／防禦 MXP）、
//     §五「製造、採集與交流」「任務熟練度」「旅行、地圖探索與傳授」。
//   * 攻擊 MXP 的雙來源 50/50：同文件 §四；`docs/02_systems/time_and_mastery_progression.md` §四
//     「雙來源傷害技能」。
//   * 防禦 MXP 進哪些 Mastery：上述兩節都明講「由**資料化 Defense Routing Rule** 決定」，
//     因此本檔只提供規則列與它指向的 Resolver ID，分割本身由 Resolver 算。
//   * 年齡倍率的分段、支援技能的固定 MXP、子女自學速率：文件**未給數值**（§六「第一版需要驗證的
//     項目」第 2 點明列支援 MXP 待填），皆為第一版方案。
//
// ── 跨檔引用的紀律（本檔是提供端）────────────────────────────────────────────
//   `experience-award-rule` 這個 kind 由本檔擁有，但引用端散在其他作者檔。Content Compiler
//   **不驗跨定義引用**（`scripts/lib/content-compiler.ts` 只檢查 id 存在／kind 已登記／
//   pack 內 ID 唯一／declaredKinds 交叉比對），所以提供端與引用端的 local 名對不上時，
//   編譯與載入都會成功，直到執行期 reader 查不到才炸。因此本檔的 local 名一律**以引用端實際
//   寫下的字串為準**，不以本檔的命名美感為準。目前已對齊的引用端：
//     * `core/team.ts`                        → `travel-normal`、`travel-npc-team`、
//                                               `social-conversation-tier-1`、`social-shopping-tier-1`
//     * `core/economy-social-distribution.ts` → `social-conversation-tier-1`
//     * `core/quest-crafting-sequence.ts`     → `quest-purchase` … `quest-subjugation`（無階級後綴）
//     * `core/combat-rules.ts`                → `defense-mastery-routing-rule.core.standard`
//
// ── 已知缺口（不在本檔補，見交付回報）──────────────────────────────────────────
//   1. §三「內容階級與有效範圍」的「全額有效至 Lv.N／再上一級 25%／再高 0%」衰減**無處可放**：
//      `ExperienceAwardRuleDefinition` 沒有階級欄位、也沒有指向 thresholdTable params 的欄位，
//      而 `src/modules/progression/system.ts:345` 的 `resolveBaseExperience` 只算
//      `baseExperience × 年齡倍率`。本檔把階級寫進 ID 的最後一段（`...-tier-iii`）保留可追溯性，
//      但那不是引擎讀得到的欄位——這是契約缺口，不是本檔可以用資料繞過的事。
//   2. **`core/combat-rules.ts` 引用了本檔刻意不提供的兩筆**：
//      `experience-award-rule.core.combat-attack`、`...core.combat-defense`
//      （`monsterExperienceProfile` 的 `attackAwardRuleId` / `defenseAwardRuleId`，必填欄位）。
//      不提供的理由是那兩個欄位語意矛盾：`MonsterExperienceProfileDefinition`
//      （`src/contracts/combat/index.ts:135-140`）自帶 `attackExperience` / `defenseExperience`
//      兩個數值，又要求指向自帶 `masteryId + baseExperience` 的 award rule——同一個數值兩個來源；
//      而攻擊 MXP 進哪個 Mastery 由**玩家用什麼武器**決定，不由怪物決定，所以替它挑任何一個
//      `masteryId` 都是假資料。`src/` 目前也沒有任何模組讀這兩個欄位（只有契約與 combat fixtures）。
//      **這是 2 筆已知會落空的引用，必須由使用者／整合者裁決**：刪掉契約那兩個欄位（本檔建議），
//      或先定義它們的語意。在裁決前發一筆 masteryId 亂填的規則，只會讓假資料無聲通過。

import type {
  AgeExperienceRuleDefinition,
  AttackMasteryAwardRuleDefinition,
  ChildEducationRuleDefinition,
  DefenseMasteryRoutingRuleDefinition,
  DefenseMasteryRoutingRuleId,
  ExperienceAwardRuleDefinition,
  MasterySplit,
  SupportMasteryAwardRuleDefinition,
  TeachingRuleDefinition,
} from '../../src/contracts/progression';
import type {
  AgeExperienceRuleId,
  AttackMasteryAwardRuleId,
  ChildEducationRuleId,
  ExperienceAwardRuleId,
  MasteryId,
  ResolverId,
  SupportMasteryAwardRuleId,
  TeachingRuleId,
} from '../../src/contracts/core';
import { cultureIds, type Authored, type AuthoredDomain } from '../authoring';
import { MASTERY_IDS } from './progression';

const core = cultureIds('core');

// kind 字串與 `src/app/content/progression-reader.ts` 的 `PROGRESSION_DEFINITION_KINDS` 一致；
// 打錯字會在 Compiler 的「kind 沒有登記擁有模組」檢查當場失敗，不會靜默載入。
const KIND_TEACHING_RULE = 'teaching-rule';
const KIND_EXPERIENCE_AWARD_RULE = 'experience-award-rule';
const KIND_ATTACK_AWARD_RULE = 'attack-mastery-award-rule';
const KIND_DEFENSE_ROUTING_RULE = 'defense-mastery-routing-rule';
const KIND_SUPPORT_AWARD_RULE = 'support-mastery-award-rule';
const KIND_AGE_EXPERIENCE_RULE = 'age-experience-rule';
const KIND_CHILD_EDUCATION_RULE = 'child-education-rule';

// 熟練度 ID 一律從 `./progression` 取，不在這裡拼 `mastery.core.*` 字串。
// `MASTERY_IDS` 是 `Record<string, MasteryId>`，在 noUncheckedIndexedAccess 下取值可能是 undefined：
// 那代表**這個 local 名不存在**（打錯字或熟練度清單改了），是建置期就該爆的錯，不是可以放過的空值。
function masteryId(local: string): MasteryId {
  const id = MASTERY_IDS[local];
  if (id === undefined) {
    throw new Error(
      `progression-rules：熟練度 local 名 "${local}" 不在 core/progression.ts 的 MASTERY_IDS 裡`,
    );
  }
  return id;
}

// ── 內容階級 I～V ───────────────────────────────────────────────────────────
//
// 階級是文件 §三 的五個等級。這裡只用它展開「同一種來源的五筆規則」，衰減規則見檔頭缺口說明。
type ContentTier = 1 | 2 | 3 | 4 | 5;
const CONTENT_TIERS: readonly ContentTier[] = [1, 2, 3, 4, 5];
// 一張「階級 → 基礎 MXP」表。索引鍵是字面值聯集，所以取值不會是 undefined。
type TierValues = Readonly<Record<ContentTier, number>>;

// ID 最後一段的階級標記用小寫羅馬數字，與契約既有的階級詞彙一致
// （`GatheringRuleDefinition.sourceTier: 'I' | 'II' | 'III' | 'IV' | 'V'`）。
// 內容作者寫 `sourceTier: 'III'` 時要找的規則就是 `...-tier-iii`，不必再換一套刻度。
const TIER_LABEL: Readonly<Record<ContentTier, string>> = {
  1: 'i',
  2: 'ii',
  3: 'iii',
  4: 'iv',
  5: 'v',
};

// ── 年齡經驗倍率 ────────────────────────────────────────────────────────────
//
// 第一版方案（待討論）。**兩份文件都沒有「年齡 → MXP 倍率」表**，唯一相關的明文是
//   * `time_and_mastery_progression.md` §三「世代定位」：「子女在 0～15 歲不能加入隊伍，
//     卻可在家中接受教育；**成年前的熟練度成長較快**。」（只有方向，沒有倍率）
//   * `mastery_experience_economy_v1.md` §五 傳授表：子女教育 0.225% 對成人 0.15%，比值恰為 1.5。
// 因此本規則只分兩段：未成年 ×1.5（取上述比值）、成年後 ×1。
// 注意 1.5 是從**傳授吸收率**的比值借過來的，文件並未說一般 MXP 來源也按這個比例放大——
// 這一步是設計判讀，不是文件數值。
// 刻意**不**替 55 歲以上另立一段：同節說 15～55 歲是主要養成期，但沒說老年學得慢，
// 立一段倍率同為 1 的分段只是噪音；真要衰退就改這張表的資料。
//
// stages 必須覆蓋所有可能年齡——`ageMultiplierFor` 找不到分段時是明確拋錯而不是退回 1，
// 所以第二段刻意不寫 maxAgeDays（開放上界）。
const DAYS_PER_YEAR = 365; // 「在家休息一年 365 日」（time_and_mastery_progression.md §一 表）
const ADULT_AGE_YEARS = 15; // 可加入隊伍／成人吸收率的起點（同文件 §三「世代定位」）

const AGE_RULE_ID = core.id<AgeExperienceRuleId>(KIND_AGE_EXPERIENCE_RULE, 'standard');

const ageExperienceRule: Authored<AgeExperienceRuleDefinition> = {
  kind: KIND_AGE_EXPERIENCE_RULE,
  id: AGE_RULE_ID,
  stages: [
    { minAgeDays: 0, maxAgeDays: ADULT_AGE_YEARS * DAYS_PER_YEAR - 1, experienceMultiplier: 1.5 },
    { minAgeDays: ADULT_AGE_YEARS * DAYS_PER_YEAR, experienceMultiplier: 1 },
  ],
};

// ── 傳授規則 ────────────────────────────────────────────────────────────────
//
// 一筆就夠：成人傳授、子女教育、城鎮生活技藝訓練共用同一組數值，差別只在
// 「用哪一條差額比例」與「教師等級從哪來」，兩者都是這張表的欄位。
// 28 日／0.15%／0.225%／Lv.5 全部取自 `mastery_experience_economy_v1.md` §五 傳授表與其後條列。
//
// `maxLevelGainPerSession: 1` 是「開始時顯示為 Lv.`N`，結束時最多為 Lv.`N+1` 的 99.99%」的欄位化
// （`time_and_mastery_progression.md` §三「已確認：城鎮生活技藝訓練與單次上限」逐字；
// `mastery_experience_economy_v1.md` §五 同義寫成「進入 Lv.N+2 的門檻 − 1」）。
// 契約自己也註明「第一版為 1」（`src/contracts/progression/index.ts:310`）。
//
// **但這個欄位目前沒有任何人讀**：`computeTeachingResult`（`src/modules/progression/system.ts:569`）
// 把上限寫死成 `learnerEntryLevel + 2`，不讀本欄；`getTeachingRule` 在 `src/` 只出現在
// `progression-reader.ts` 與 fixtures。填 1 是為了讓資料與文件一致，不是因為它會生效——
// 改成 2 也不會有任何行為變化。見交付回報。
const teachingRule: Authored<TeachingRuleDefinition> = {
  kind: KIND_TEACHING_RULE,
  id: core.id<TeachingRuleId>(KIND_TEACHING_RULE, 'standard'),
  durationDays: 28,
  adultDifferenceRate: 0.0015, // 成人傳授（28 日）：差額 × 0.15%
  childDifferenceRate: 0.00225, // 子女教育（28 日）：差額 × 0.225%
  cityTeacherMasteryLevel: 5, // 城鎮生活技藝訓練：教師固定 Lv.5
  maxLevelGainPerSession: 1,
};

// ── 子女教育規則 ────────────────────────────────────────────────────────────
//
// `teacherMinimumPostDays` 28、`childStudyCycleDays` 14、`npcChildParentMasteryShare` 0.2
// 在契約裡是字面值型別（結構不變量），這裡照填——型別只允許這一個值，不是選了一個數字。
//
// `selfStudyParentMasteryRate` 是唯一自由的數值，文件沒有給：**第一版方案（待討論）**。
// 契約只寫「數值待試算，必須遠低於 1」（`src/contracts/progression/index.ts:224`）。
// 取法：直接取子女受教率（每 28 日差額 × 0.225% = 0.00225）的 1/10，當成一個 14 日自學周期的率。
//   0.00225 / 10 = 0.000225（每個 14 日周期，作用於「父母 MXP − 子女 MXP」的差額）
// 注意這是「28 日率的 1/10 拿去當 14 日率」，**不是**先折成 14 日率再取 1/10
// （那會是 0.00225/2/10 = 0.0001125）。刻意選前者：自學周期較短、次數較多，若連率都再對半折，
// 15 年下來會低到失去意義。這一步純粹是設計取捨，沒有文件依據。
// 以 Lv.10 父母（24,000,000 MXP，§二 累積門檻表）、0～15 歲共 390 個 14 日周期估算，自學收斂到
// 約 2,020,000 MXP（§二 表：Lv.4 累積 1,700,000、Lv.5 為 2,700,000，故落在 Lv.4）；
// 同期有專任家教約 8,530,000（§五 末條明列，Lv.7），NPC 子女固定分得父母 20%（4,800,000，Lv.6）。
// 三條路徑排序 自學 < NPC < 家教，且遠低於 1（契約的硬性要求）。
const childEducationRule: Authored<ChildEducationRuleDefinition> = {
  kind: KIND_CHILD_EDUCATION_RULE,
  id: core.id<ChildEducationRuleId>(KIND_CHILD_EDUCATION_RULE, 'standard'),
  teacherMinimumPostDays: 28,
  childStudyCycleDays: 14,
  selfStudyParentMasteryRate: 0.000225,
  npcChildParentMasteryShare: 0.2,
};

// ── 防禦 Mastery 去向規則 ───────────────────────────────────────────────────
//
// 文件兩處都明講「個人份額最後進入哪些防具／盾牌 Mastery，由 detailed 與 Combat Sequence 共用的
// **資料化 Defense Routing Rule** 決定」。契約的 `DefenseMasteryRoutingRuleDefinition` 只有
// 一個 `resolverId`——分割是依角色當下裝備算出來的，不是能列在資料裡的固定比例，所以這筆規則
// 的內容就是「指名哪一個 Resolver」。
//
// ResolverId 沒有 `definitionId()` 那樣的工廠（它不是 DefinitionId 家族），只能在作者層鑄字面值。
// 命名沿用既有慣例 `resolver:<擁有模組>.<用途>`。
// **這個 Resolver 目前還沒註冊**：core pack 的 `requiredResolverIds` 必須列入它，
// Bootstrap 才會在啟動時擋下「用到未註冊 Resolver」——見交付回報。
const DEFENSE_ROUTING_RESOLVER_ID =
  'resolver:progression.defense-mastery-routing' as ResolverId;

const defenseMasteryRoutingRule: Authored<DefenseMasteryRoutingRuleDefinition> = {
  kind: KIND_DEFENSE_ROUTING_RULE,
  id: core.id<DefenseMasteryRoutingRuleId>(KIND_DEFENSE_ROUTING_RULE, 'standard'),
  resolverId: DEFENSE_ROUTING_RESOLVER_ID,
};

// ── 攻擊 MXP 的 Mastery 分割 ────────────────────────────────────────────────
//
// §四：「武器與攻擊魔法依有效傷害占怪物生命的比例取得攻擊 MXP。純攻擊魔法取得其份額；
// 法杖施放攻擊魔法時，既定為法杖與攻擊魔法各 50%。」
// time_and_mastery_progression.md §四 把它一般化：「雙來源傷害技能：同時屬於武器與攻擊魔法時，
// 怪物攻擊經驗固定各分 50%。」
//
// 因此三族規則：
//   1. 單一武器來源 → 該武器熟練度 100%（八種武器各一筆）
//   2. 純攻擊魔法   → 攻擊魔法 100%
//   3. 武器＋攻擊魔法 → 各 50%（**八種武器都給**，不只法杖）
// 第 3 族只有法杖兩筆是文件點名的；其餘六筆依上面那條一般化規則展開，理由是文化 pack 不能往
// core 加規則列——真出現「魔劍」這類雙來源技能時，缺的那一筆會讓該國卡住。
// 未展開的組合（例如武器＋防禦魔法）文件沒有依據，不預先發明。
const ATTACK_WEAPON_MASTERY_LOCALS: readonly string[] = [
  'one-hand-weapon',
  'two-hand-weapon',
  'throwing-weapon',
  'shooting-weapon',
  'one-hand-staff',
  'two-hand-staff',
  // 「攻擊型樂器仍屬攻擊來源」（§四 最後一條）。
  'wind-instrument',
  'string-instrument',
];

const ATTACK_MAGIC_LOCAL = 'attack-magic';

function attackAwardRule(
  local: string,
  masterySplits: readonly MasterySplit[],
): Authored<AttackMasteryAwardRuleDefinition> {
  return {
    kind: KIND_ATTACK_AWARD_RULE,
    id: core.id<AttackMasteryAwardRuleId>(KIND_ATTACK_AWARD_RULE, local),
    masterySplits,
  };
}

const soleSourceAttackRules: readonly Authored<AttackMasteryAwardRuleDefinition>[] = [
  ...ATTACK_WEAPON_MASTERY_LOCALS,
  ATTACK_MAGIC_LOCAL,
].map((local) => attackAwardRule(local, [{ masteryId: masteryId(local), ratio: 1 }]));

const dualSourceAttackRules: readonly Authored<AttackMasteryAwardRuleDefinition>[] =
  ATTACK_WEAPON_MASTERY_LOCALS.map((weaponLocal) =>
    attackAwardRule(`${weaponLocal}-and-attack-magic`, [
      { masteryId: masteryId(weaponLocal), ratio: 0.5 },
      { masteryId: masteryId(ATTACK_MAGIC_LOCAL), ratio: 0.5 },
    ]),
  );

// ── 支援技能的固定 MXP ──────────────────────────────────────────────────────
//
// §四：「無傷害的增益、減益、治療魔法與支援樂器技能，依各技能的**固定 Support Mastery Award
// Rule** 額外發放 MXP，不看有效防護、增益、減益或疊加量。」數值文件沒有給——§六 第 2 點正是
// 「為每種支援魔法／樂器填入固定 Support Mastery MXP 與受益 Mastery 分割資料」。
//
// **第一版方案（待討論）**：每次使用 = 該階級「遭遇防禦 MXP」的 1/4。
//   遭遇防禦 MXP（§四）  I 80、II 200、III 480、IV 1,200、V 2,880
//   ÷4                  I 20、II 50、III 120、IV 300、V 720   ← 全為整數
// 挑 1/4 的理由：detailed 戰鬥中同角色同技能每場最多 3 次（結構上限 SUPPORT_USE_CAP），
// 因此支援者單場約得 3×20 = 60；同場四人分傷害的攻擊者單場約得 320/4 = 80。兩者同量級，
// 支援者略低（他另外還吃 3／2／1 站位分到的防禦份額），符合「支援不該比揮劍更快升級」。
const SUPPORT_FIXED_BY_TIER: TierValues = { 1: 20, 2: 50, 3: 120, 4: 300, 5: 720 };

// 受益 Mastery：五族支援來源，各自 100% 進自己的熟練度。
// 治療／增益 → 祝福魔法；減益 → 詛咒魔法；防護 → 防禦魔法；支援樂器 → 管／弦樂器。
const SUPPORT_MASTERY_LOCALS: readonly string[] = [
  'defense-magic',
  'blessing-magic',
  'curse-magic',
  'wind-instrument',
  'string-instrument',
];

const supportAwardRules: readonly Authored<SupportMasteryAwardRuleDefinition>[] =
  SUPPORT_MASTERY_LOCALS.flatMap((local) =>
    CONTENT_TIERS.map((tier) => ({
      kind: KIND_SUPPORT_AWARD_RULE,
      id: core.id<SupportMasteryAwardRuleId>(
        KIND_SUPPORT_AWARD_RULE,
        `${local}-tier-${TIER_LABEL[tier]}`,
      ),
      fixedExperiencePerUse: SUPPORT_FIXED_BY_TIER[tier],
      masterySplits: [{ masteryId: masteryId(local), ratio: 1 }],
    })),
  );

// ── 經驗發放規則 ────────────────────────────────────────────────────────────
//
// 一筆 = 一種來源 × 一個階級（或旅行的一種模式）。`ageExperienceRuleId` 一律指向上面那條
// 標準年齡規則：不指名的話年齡倍率恆為 1，`AgeExperienceRuleDefinition.stages` 就又變成沒人讀
// 的資料（那正是 repo 那筆「the age experience multiplier comes from data instead of always
// being 1」修正要治的病）。代價是**每個拿 MXP 的角色都必須有出生日**，否則
// `ageMultiplierFor` 會明確拋錯——這是刻意的，不是缺口。
function awardRule(
  local: string,
  masteryLocal: string,
  baseExperience: number,
): Authored<ExperienceAwardRuleDefinition> {
  return {
    kind: KIND_EXPERIENCE_AWARD_RULE,
    id: core.id<ExperienceAwardRuleId>(KIND_EXPERIENCE_AWARD_RULE, local),
    masteryId: masteryId(masteryLocal),
    baseExperience,
    ageExperienceRuleId: AGE_RULE_ID,
  };
}

// 把一張「階級 → 基礎 MXP」表展開成五筆規則。純資料重複的消除，不是規則。
function tieredAwardRules(
  localPrefix: string,
  masteryLocal: string,
  byTier: TierValues,
): readonly Authored<ExperienceAwardRuleDefinition>[] {
  return CONTENT_TIERS.map((tier) =>
    awardRule(`${localPrefix}-tier-${TIER_LABEL[tier]}`, masteryLocal, byTier[tier]),
  );
}

// §五 表「製造一件成品」：I 400、II 1,000、III 2,400、IV 6,000、V 14,400。
const CRAFTING_BY_TIER: TierValues = { 1: 400, 2: 1_000, 3: 2_400, 4: 6_000, 5: 14_400 };

// §五 表「採集一次」＝「一次購物／聊天」：I 160、II 400、III 960、IV 2,400、V 5,760。
const GATHERING_BY_TIER: TierValues = { 1: 160, 2: 400, 3: 960, 4: 2_400, 5: 5_760 };
const SOCIAL_BY_TIER: TierValues = GATHERING_BY_TIER;

// §五 表「地圖探索 I～V」：60,000／150,000／360,000／900,000／2,160,000（每張圖每次刷新僅一次）。
const MAP_EXPLORATION_BY_TIER: TierValues = {
  1: 60_000,
  2: 150_000,
  3: 360_000,
  4: 900_000,
  5: 2_160_000,
};

// 製造：§五 第 1 條點名「鍛造、裁縫、工藝與製藥」使用「成品製造」欄。
const PRODUCT_CRAFTING_MASTERY_LOCALS: readonly string[] = [
  'smithing',
  'tailoring',
  'handicraft',
  'alchemy',
];

const craftingAwardRules: readonly Authored<ExperienceAwardRuleDefinition>[] =
  PRODUCT_CRAFTING_MASTERY_LOCALS.flatMap((local) =>
    tieredAwardRules(`craft-${local}`, local, CRAFTING_BY_TIER),
  );

// 廚藝：文件只說「依食譜階級給料理 MXP」，沒點名用哪一欄。
// **第一版方案（待討論）**：與其他製造同欄（那是全文唯一的「製造一件成品」欄）。
// 廚藝不花世界日，所以它的節流靠材料與 FoodStatus，不靠壓低 MXP；真要壓低就改這裡。
//
// 自製與餐館**共用同一筆規則**：餐館「固定為同級自製的 1/3」那個 1/3 已經是
// `CuisineRecipeDefinition.restaurantExperienceMultiplier`（crafting 契約，隨食譜走＝文化內容），
// 並由 `CuisineConsumed.experienceMultiplier` 原樣傳給 progression。這裡再開一組「餐館版」規則
// 會讓 1/3 被套兩次。
const cuisineAwardRules = tieredAwardRules('cuisine', 'cooking', CRAFTING_BY_TIER);

const gatheringAwardRules = tieredAwardRules('gathering', 'gathering', GATHERING_BY_TIER);

// 交流：文件把購物與聊天併成一欄（§五「一次購物／聊天」，同值），但兩者是**分開計數**的來源
// （每日分別最多 6 筆交易、合計 6 次對話；非玩家成員每個城市自由日固定各得一次）。
// 三筆分別對上三個既有的消費欄位，各自一個 ID：
//   * `NonPlayerMemberDailySocialPracticeRuleDefinition.conversationExperienceRuleId`
//   * `NonPlayerMemberDailySocialPracticeRuleDefinition.commerceExperienceRuleId`
//     ／`PlayerCommercePracticeRuleDefinition.commerceExperienceRuleId`（city 契約）
//   * `PlayerConversationRuleDefinition.experienceAwardRuleId`（social 契約）
//
// **刻意不做階級展開**：上面每一個欄位都只吃**一個** ID，沒有任何欄位能選階級，
// 所以階級 II～V 的那四格（400／960／2,400／5,760）目前沒有任何內容選得到它們。
// 發出去只會變成永遠讀不到的死列。取階級 I 的 160（§三 定義階級 I 為「起始地、一般材料、普通委託」，
// 也就是城內一般互動）。要讓高階城市給更多，得先在那三個定義加階級選擇——見回報的契約缺口。
//
// **local 名逐字對齊實際引用端，含 `-tier-1` 後綴與 `shopping`（不是 `commerce`）**：
//   * `social-conversation-tier-1` ← `team.ts` 的 `socialPracticeRule.conversationExperienceRuleId`
//                                   **並且** `economy-social-distribution.ts` 的
//                                   `playerConversationRule.experienceAwardRuleId`（兩端共用同一筆）
//   * `social-shopping-tier-1`     ← `team.ts` 的 `socialPracticeRule.commerceExperienceRuleId`
// 後綴用阿拉伯數字 `-tier-1` 而不是本檔其他來源的羅馬數字 `-tier-i`，唯一理由是引用端已經這樣寫；
// 兩個引用端都對不上比命名一致重要。玩家對話與非玩家每日練習共用同一筆，也是引用端已經選好的
// 形狀——先前這裡另發一筆 `player-conversation` 沒有任何人引用（死資料），已移除。
const socialAwardRules: readonly Authored<ExperienceAwardRuleDefinition>[] = [
  awardRule('social-conversation-tier-1', 'social', SOCIAL_BY_TIER[1]),
  awardRule('social-shopping-tier-1', 'social', SOCIAL_BY_TIER[1]),
];

// 旅行：§五「世界旅行」每段城市間旅程 趕路 3,000／正常 6,000／慢行 12,000；
// 非玩家隊伍每趟固定 6,000（time_and_mastery_progression.md §一）。
// 旅行**不設階級衰減**（§一 最後一條），所以它不走 tier 展開。
//
// 基數一律取「正常」的 6,000：三種模式的差別已經是
// `PlayerTravelModeDefinition.travelExperienceMultiplier`（team 契約，0.5／1／2），
// 非玩家隊伍的 `NpcTravelRuleDefinition.travelExperienceMultiplier` 是契約字面值 1。
// 若把模式折進基數，倍率會被套兩次（趕路變成 3,000 × 0.5 = 1,500）。
//
// **兩筆而不是一筆，local 名逐字對齊實際引用端**（`content-source/core/team.ts`）：
//   * `travel-normal`   ← `travelMode()` 三個模式共用的基數（team.ts 的 `TRAVEL_EXPERIENCE_BASE_RULE`）
//   * `travel-npc-team` ← `npcTravelRule`（team.ts 的 `TRAVEL_EXPERIENCE_NPC_RULE`）
// team.ts 刻意讓 NPC 指向自己那條而不與玩家共用（「共用 ID 會讓兩者無法分開調」），所以這裡
// 也必須是兩筆。值相同不是重複資料，是兩個可分別調整的旋鈕。
// 先前這裡只發一筆 local 名 `travel`，兩個引用端都對不上——Compiler **不驗跨定義引用**
// （`scripts/lib/content-compiler.ts` 只檢查 id/kind/唯一性/declaredKinds），
// 所以那會是「載入成功、執行期讀不到」。
const travelAwardRules: readonly Authored<ExperienceAwardRuleDefinition>[] = [
  awardRule('travel-normal', 'travel', 6_000),
  awardRule('travel-npc-team', 'travel', 6_000),
];

const mapExplorationAwardRules = tieredAwardRules(
  'map-exploration',
  'map-exploration',
  MAP_EXPLORATION_BY_TIER,
);

// 委託：§五「任務熟練度」＝該階級「一般群體攻擊 MXP」×類型倍率。
// 一般群體攻擊 MXP（§四）：I 320、II 800、III 1,920、IV 4,800、V 11,520。
// 倍率：購買 ×0.5、送貨 ×1.0、護衛 ×1.25、救援 ×1.5、探索 ×1.5、鎮壓 ×2.0、討伐 ×2.5。
// 下面逐筆寫出乘完的數值（不在資料裡做乘法），階級 I 一欄與文件「階級 I 完成 MXP」逐格相符。
const QUEST_AWARDS: readonly Readonly<{ masteryLocal: string; byTier: TierValues }>[] = [
  // ×0.5
  { masteryLocal: 'quest-purchase', byTier: { 1: 160, 2: 400, 3: 960, 4: 2_400, 5: 5_760 } },
  // ×1.0
  { masteryLocal: 'quest-delivery', byTier: { 1: 320, 2: 800, 3: 1_920, 4: 4_800, 5: 11_520 } },
  // ×1.25
  { masteryLocal: 'quest-escort', byTier: { 1: 400, 2: 1_000, 3: 2_400, 4: 6_000, 5: 14_400 } },
  // ×1.5
  { masteryLocal: 'quest-rescue', byTier: { 1: 480, 2: 1_200, 3: 2_880, 4: 7_200, 5: 17_280 } },
  // ×1.5
  { masteryLocal: 'quest-exploration', byTier: { 1: 480, 2: 1_200, 3: 2_880, 4: 7_200, 5: 17_280 } },
  // ×2.0
  { masteryLocal: 'quest-suppression', byTier: { 1: 640, 2: 1_600, 3: 3_840, 4: 9_600, 5: 23_040 } },
  // ×2.5
  { masteryLocal: 'quest-subjugation', byTier: { 1: 800, 2: 2_000, 3: 4_800, 4: 12_000, 5: 28_800 } },
];

// 委託的階級 I 那一筆用**無後綴**的 local 名（`quest-purchase`…`quest-subjugation`），
// 其餘四筆維持 `-tier-ii`…`-tier-v`。這個不對稱是引用端與契約逼出來的，不是筆誤：
//
//   * `content-source/core/quest-crafting-sequence.ts` 的 `rewardRules` 為七種委託各鑄一筆
//     `QuestRewardRuleDefinition`，其 `masteryExperienceRuleId` 指向**無後綴**的
//     `experience-award-rule.core.quest-<kind>`。先前這裡只發 `-tier-i`～`-tier-v`，
//     七筆引用全部落空。
//   * `QuestRewardRuleDefinition`（`src/contracts/quest/index.ts:71-75`）是
//     `{ currencyRewardRuleId?, masteryExperienceRuleId, reputationEffectIds? }`——
//     **沒有階級欄位**；整個 `src/contracts/quest/index.ts` 沒有出現過 tier／階級。
//     委託的 reward rule 是「一種委託類型一筆」，選不到階級。
//
// 也就是說文件 §五「任務熟練度」說「任務階級使用第三章的內容階級」，但契約沒有落點。
// 因此**目前只有無後綴那七筆讀得到**；`-tier-ii`…`-tier-v` 共 28 筆是文件數值的保存，
// 尚無任何引用端選得到它們。整合者要二選一：替 `QuestRewardRuleDefinition`（或委託本身）
// 加階級欄位，然後把無後綴那筆改回 `-tier-i`；或刪掉那 28 筆。見交付回報。
const questAwardRules: readonly Authored<ExperienceAwardRuleDefinition>[] = QUEST_AWARDS.flatMap(
  (row) => [
    // 階級 I：無後綴，對齊 quest-crafting-sequence.ts 實際引用的 local 名。
    awardRule(row.masteryLocal, row.masteryLocal, row.byTier[1]),
    ...CONTENT_TIERS.filter((tier) => tier !== 1).map((tier) =>
      awardRule(
        `${row.masteryLocal}-tier-${TIER_LABEL[tier]}`,
        row.masteryLocal,
        row.byTier[tier],
      ),
    ),
  ],
);

// ── 匯出 ────────────────────────────────────────────────────────────────────

export const progressionRulesDomain: AuthoredDomain = {
  domain: 'progression-rules',
  definitions: [
    teachingRule,
    ageExperienceRule,
    childEducationRule,
    defenseMasteryRoutingRule,
    ...soleSourceAttackRules,
    ...dualSourceAttackRules,
    ...supportAwardRules,
    ...craftingAwardRules,
    ...cuisineAwardRules,
    ...gatheringAwardRules,
    ...socialAwardRules,
    ...travelAwardRules,
    ...mapExplorationAwardRules,
    ...questAwardRules,
  ],
};

// 供整合者填進 core pack 的 `declaredKinds`（本檔實際出現的 kind，逐字）。
export const PROGRESSION_RULES_DECLARED_KINDS: readonly string[] = [
  KIND_TEACHING_RULE,
  KIND_EXPERIENCE_AWARD_RULE,
  KIND_ATTACK_AWARD_RULE,
  KIND_DEFENSE_ROUTING_RULE,
  KIND_SUPPORT_AWARD_RULE,
  KIND_AGE_EXPERIENCE_RULE,
  KIND_CHILD_EDUCATION_RULE,
];

// 供整合者填進 core pack 的 `requiredResolverIds`。少了它，用到未註冊 Resolver 的 pack 會一路
// 載入成功，直到玩家打完第一場戰鬥才炸。
export const PROGRESSION_RULES_REQUIRED_RESOLVER_IDS: readonly ResolverId[] = [
  DEFENSE_ROUTING_RESOLVER_ID,
];
