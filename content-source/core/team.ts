// content-source/core/team.ts
// 隊伍的旅行模式、大動作時長、個人自由行動、留隊／招募／配置規則。**文化無關**——
// 「趕路 3／正常 6／慢行 9 日」「NPC 固定 6 日」「入隊 60 日才骰離隊」「九宮格預設站位」
// 都是遊戲結構的一部分，四國共用同一份；四國各自不同的是路上會遇到什麼事件、酒館裡有誰，
// 那些屬文化 pack。
//
// 來源（逐筆對照見本檔各段註解，以及回報的「逐筆來源表」）：
//   * 旅行日數／段落／經驗倍率：`docs/00_core/game_design_document.md`「一天的結構」
//   * 旅行 MXP 基數：`docs/02_systems/mastery_experience_economy_v1.md`「旅行、地圖探索與傳授」
//   * 自由行動種類與日數：GDD「一天的結構」＋`docs/00_core/architecture/02_team_module.md` §2.3
//   * 留隊／招募／配置：02_team_module.md §2.3、§3.1、§6.1、§7.6
//   * 非玩家成員每日交流練習：mastery_experience_economy_v1.md「製造、採集與交流」第 118 行
//
// 本檔**不含**的東西與理由（詳見回報）：
//   * `cityFree` / `cityTravel` / `escortTravel` / `npcDungeonExploration` 的 team-plan-rule：
//     這四個大動作的時長各有別的擁有者（NPC 強制自由期是 2～7 日的**區間**、旅行是旅行模式的
//     日數、地牢是 Run 的結算時點）。在這裡再寫一個 `durationDays` 會是第二個真相，而且對旅行
//     那兩筆一定是錯的（同一筆規則說不出 3／6／9）。缺一筆規則 → Handler typed rejection，
//     那是規範允許的出口；寫一個錯數字不是。

import type {
  FreeActionRuleDefinition,
  FreeActionRuleId,
  MemberRetentionRuleDefinition,
  NonPlayerMemberDailySocialPracticeRuleDefinition,
  NpcTravelRuleDefinition,
  PlayerTravelEventWeightProfileId,
  PlayerTravelModeDefinition,
  RecentActivityRuleDefinition,
  RecentActivityRuleId,
  RecruitmentRuleDefinition,
  TeamFormationRuleDefinition,
  TeamPlanKind,
  TeamPlanRuleDefinition,
} from '../../src/contracts/team';
import type { FacilityKind } from '../../src/contracts/city';
import type { LogisticCurveParams } from '../../src/data-runtime';
import type {
  ExperienceAwardRuleId,
  MemberRetentionRuleId,
  NonPlayerMemberDailySocialPracticeRuleId,
  NpcMarriageRuleId,
  NpcTravelRuleId,
  RecruitmentRuleId,
  DefinitionHeader,
  ModuleId,
  ResolverBinding,
  ResolverId,
  TeamFormationRuleId,
  TeamPlanRuleId,
  TravelModeId,
} from '../../src/contracts/core';
import {
  cultureIds,
  textKeyFor,
  type Authored,
  type AuthoredDomain,
  type LocalizedName,
} from '../authoring';
import {
  COMBAT_MAGIC_MASTERY_LOCALS,
  LIFE_CRAFT_MASTERY_LOCALS,
  MASTERY_IDS,
  SMITH_TAILOR_MASTERY_LOCALS,
} from './progression';

const core = cultureIds('core');
const TEAM_MODULE = 'team' as ModuleId;

// ── Resolver ID ─────────────────────────────────────────────────────────────
//
// `authoring.ts` 的 `definitionId` 只造 `DefinitionId`；ResolverId 是另一個 brand 家族
// （`Brand<string,'resolver'>`，沒有 `definition:` 前綴、也**沒有文化段**——Resolver 由模組擁有，
// 不由文化擁有），所以本檔自備一個同形狀的小工具。
//
// 字串形狀採既有落地寫法 `resolver:<module>.<name>`（`src/data-runtime/content-pack.test.ts` 的
// `resolver:team.recruitment-success`、`src/app/content/resolvers.test.ts` 的
// `resolver:test.logistic-roll`，以及同一輪 `content-source/core/economy-social-distribution.ts`）。
// 這裡**只寫 ID**：Resolver 的實作與 kernel params 都不屬內容作者層（見回報「需要註冊的 resolverId」）。
function resolverId(local: string): ResolverId {
  return `resolver:team.${local}` as ResolverId;
}

// ── 跨 domain 引用（本檔不擁有這些定義，只引用它們的 ID）────────────────────
//
// 依 ID 規約 `<kind 前綴>.<culture>.<local>` 自行拼字串。整合者必須確認提供端用同一個 ID；
// 兩邊對不上的後果是「載入成功、執行期讀不到」——`scripts/lib/content-compiler.ts` 只檢查
// id/kind/唯一性/declaredKinds，**不驗跨定義引用**，所以這裡對錯一個字沒有任何門禁會擋。
//
// ⚠ 本節每一筆都已用「把所有 content-source domain 的 id 收成一個集合，再逐筆比對」的方式
// 對帳過（複核當時的實測結果：以下五筆全部命中提供端）。加新引用時請重做這件事，
// 不要只靠註解宣稱「已存在」。

// progression：旅行 MXP。經濟表（mastery_experience_economy_v1.md 第 153 行）把「世界旅行」列成
// 趕路 3,000／正常 6,000／慢行 12,000 三個值，而 GDD 第 191 行把 ×0.5／×1／×2 歸給旅行模式——
// 同一件事被表達了兩次，只能挑一種模型；挑錯會讓倍率被套兩次（3,000 × 0.5 = 1,500）。
//
// 採用的模型：**基數 6,000 由一條規則提供，三個模式以倍率分出 3,000／6,000／12,000。**
// 理由是契約把 `NpcTravelRuleDefinition.travelExperienceMultiplier` 寫成字面型別 `1`，而 NPC 每趟
// 固定 6,000——所以「基數 = 6,000、倍率 = 模式差異」是契約自己已經釘住的那一組解；而且 GDD 把
// ×0.5／×1／×2 明確歸給**旅行模式**（team 的定義），基數才屬 progression。
//
// 提供端同一個模型、同一個 local 名：`content-source/core/progression-rules.ts` 的
// `travelAwardRules` 發 `travel-normal`(6,000) 與 `travel-npc-team`(6,000) 兩筆，
// 其註解逐字寫「若把模式折進基數，倍率會被套兩次（趕路變成 3,000 × 0.5 = 1,500）」。
// 兩邊模型一致，不需要裁決。
const TRAVEL_EXPERIENCE_BASE_RULE = core.id<ExperienceAwardRuleId>(
  'experience-award-rule',
  'travel-normal',
);

// NPC 隊伍每趟固定 6,000 且倍率為契約字面值 1，所以它指向自己那條規則（基數已是 6,000），
// 不與玩家共用——共用 ID 會讓兩者無法分開調。提供端已按此發第二筆 `travel-npc-team`。
const TRAVEL_EXPERIENCE_NPC_RULE = core.id<ExperienceAwardRuleId>(
  'experience-award-rule',
  'travel-npc-team',
);

// progression：非玩家主角正式成員每個完整城市自由日固定各得一次「聊天」與一次「購物」的交流 MXP。
//
// 經濟表把「一次購物／聊天」列成階級 I～V（160／400／960／2,400／5,760），但**沒有任何欄位選得到
// 階級**——本檔這兩個欄位各只吃一個 ID。所以提供端 `progression-rules.ts` 的 `socialAwardRules`
// 只發兩筆非階級展開的規則，都取階級 I 的 160，local 名帶 `-tier-1` 後綴：
// `social-conversation-tier-1` 與 `social-shopping-tier-1`（後者用 shopping，不是 commerce）。
//
// **第一版方案（待討論）**：取階級 I（160）這個選擇本身是設計值——文件沒有為「被動、免費、
// 每天發放的練習」指定階級。值住在 progression（那裡也標了同一句待討論），本檔只指名用哪兩條。
// 理由：給高階級等於讓一支隊伍只要停在城裡就以最高效率刷交流。
const SOCIAL_CONVERSATION_EXPERIENCE_RULE = core.id<ExperienceAwardRuleId>(
  'experience-award-rule',
  'social-conversation-tier-1',
);
const SOCIAL_COMMERCE_EXPERIENCE_RULE = core.id<ExperienceAwardRuleId>(
  'experience-award-rule',
  'social-shopping-tier-1',
);

// social：NPC 之間的求婚判定規則（共隊天數、戰力接近程度、一次資料化機率）。
// 只允許出現在 `freeActionKind: 'proposeToTeammate'`（02_team_module.md §2.3、§3.3）。
//
// ⚠ **這個 local 名不由本檔決定。** `npc-marriage-rule` 是 social 的 kind，提供端
// `content-source/core/economy-social-distribution.ts` 的 `npcMarriageRule` 才是擁有者，
// 它定的是 `standard`。本輪兩邊曾在 `teammate`／`standard` 之間各改過一次、且兩邊註解都寫
// 「對齊對方」——那是會永遠交錯的迴圈（某一刻各自都自稱已對齊，實際永遠差一步）。
// 定案：**擁有者定名、消費端跟隨**。要改就從 economy-social-distribution.ts 改起，本檔跟。
const NPC_MARRIAGE_RULE = core.id<NpcMarriageRuleId>('npc-marriage-rule', 'standard');

// 旅行事件權重檔。三種模式各一份：趕路提高負面權重、正常為基準、慢行提高正面權重（GDD）。
// **注意**：`player-travel-event-weight-profile` 這個 kind 目前沒有登記擁有模組，所以現在
// 沒有任何人寫得出這三筆定義（Compiler 會拒收）。這裡只能填 ID；見回報「契約缺口」。
const TRAVEL_EVENT_PROFILE_HURRIED = core.id<PlayerTravelEventWeightProfileId>(
  'player-travel-event-weight-profile',
  'hurried',
);
const TRAVEL_EVENT_PROFILE_NORMAL = core.id<PlayerTravelEventWeightProfileId>(
  'player-travel-event-weight-profile',
  'normal',
);
const TRAVEL_EVENT_PROFILE_SLOW = core.id<PlayerTravelEventWeightProfileId>(
  'player-travel-event-weight-profile',
  'slow',
);

// ── 玩家旅行模式 ────────────────────────────────────────────────────────────
//
// GDD「一天的結構」：「城市間移動有趕路 3 日、正常 6 日、慢行 9 日三種選擇。每趟固定切成前、中、
// 後三段…三種模式分別採 1／1／1、2／2／2、3／3／3 日的三段長度。趕路提高負面事件權重且旅行經驗
// ×0.5；正常採基準權重與旅行經驗 ×1；慢行提高正面事件權重且旅行經驗 ×2。」
//
// 段落長度逐筆照抄而不是由 durationDays 除三——文件把它列成三張明表，抄下來的東西改起來也是資料。
type TravelModeRow = Readonly<{
  local: string;
  name: LocalizedName;
  durationDays: 3 | 6 | 9;
  segments: [number, number, number];
  experienceMultiplier: number;
  eventProfileId: PlayerTravelEventWeightProfileId;
}>;

const TRAVEL_MODE_ROWS: readonly TravelModeRow[] = [
  {
    local: 'hurried',
    name: { 'zh-Hant': '趕路', en: 'Hurried' },
    durationDays: 3,
    segments: [1, 1, 1],
    experienceMultiplier: 0.5,
    eventProfileId: TRAVEL_EVENT_PROFILE_HURRIED,
  },
  {
    local: 'normal',
    name: { 'zh-Hant': '正常', en: 'Normal' },
    durationDays: 6,
    segments: [2, 2, 2],
    experienceMultiplier: 1,
    eventProfileId: TRAVEL_EVENT_PROFILE_NORMAL,
  },
  {
    local: 'slow',
    name: { 'zh-Hant': '慢行', en: 'Slow' },
    durationDays: 9,
    segments: [3, 3, 3],
    experienceMultiplier: 2,
    eventProfileId: TRAVEL_EVENT_PROFILE_SLOW,
  },
];

function travelMode(row: TravelModeRow): Authored<PlayerTravelModeDefinition> {
  return {
    kind: 'player-travel-mode',
    id: core.id<TravelModeId>('player-travel-mode', row.local),
    display: { nameRef: { key: textKeyFor(core.id<TravelModeId>('player-travel-mode', row.local)) } },
    durationDays: row.durationDays,
    segments: row.segments,
    travelExperienceRuleId: TRAVEL_EXPERIENCE_BASE_RULE,
    travelExperienceMultiplier: row.experienceMultiplier,
    travelEventWeightProfileId: row.eventProfileId,
  };
}

// ── NPC 旅行規則 ────────────────────────────────────────────────────────────
//
// GDD：「所有非玩家隊伍的城市間移動固定為 6 日，沒有前／中／後段落、旅行事件池、事件骰、事件互動
// 或刺殺事件。第 6 日直接抵達，旅行經驗每趟發一次且倍率固定 ×1。」
// 契約已把 `durationDays: 6` / `travelExperienceMultiplier: 1` / `eventPolicy: 'none'` 寫成字面型別，
// 所以這一筆的三個欄位是型別強制的，不是我挑的值。全遊戲只需要這一筆（NPC 不分任務或隊伍規模）。
const npcTravelRule: Authored<NpcTravelRuleDefinition> = {
  kind: 'npc-travel-rule',
  id: core.id<NpcTravelRuleId>('npc-travel-rule', 'standard'),
  durationDays: 6,
  travelExperienceRuleId: TRAVEL_EXPERIENCE_NPC_RULE,
  travelExperienceMultiplier: 1,
  eventPolicy: 'none',
};

// ── 個人自由行動規則 ────────────────────────────────────────────────────────
//
// 七個 `FreeActionKind` 各一筆。每一筆只填**本規則真正擁有**的欄位：
//
//   * `craft` 不填 `requiredFreeDays` 也不填 `requiresCityFacilityKind`——那兩件事由配方擁有
//     （`CraftingRecipeDefinition.craftingDurationDays` / `.requiredFacilityKind`），一件物品要幾天、
//     要在哪個店做，逐配方不同。在這裡再寫一個數字就是第二個真相，而且對絕大多數配方是錯的。
//   * `train` 展開成**三筆**（見下面的 `TRAIN_RULES`）：「戰鬥與魔法在訓練所、生活技藝在道具店、
//     鍛冶與裁縫在裝備店」一筆通用規則說不出來，但三筆各自說得出來——每一筆同時帶著自己的
//     設施門檻與可鍛鍊項目清單，兩者是同一句宣告的兩半。
//     （`CityActionRuleDefinition` 的 `actionKind: 'masteryTraining'` 是**同一件事的另一個表達**，
//      為耗時城市行動而設；玩家入口走自由行動，見 02_team_module.md §4 的 `chooseCityFreeAction`。）
//   * `trade` / `proposeToTeammate` 的 `requiredFreeDays` 是 **0**（文件明講「零日子步驟」），
//     `tavernVisit` / `rest` 則**不填**（文件明講是「可持續的被動選項」，不必每天建立完成 Job）。
//     0 與缺席在這裡是兩件不同的事；契約沒有把這個差別寫下來，見回報「契約缺口」。
// GDD 第 194 行：「熟練度傳授／訓練每次消耗 28 日。」train 與 teach 共用同一個明文。
//
// ⚠ **重複的真相（第四處，整合者必須裁決）**：這個 28 在 progression 已經有兩個持有者——
// `content-source/core/progression-rules.ts` 第 128 行 `TeachingRuleDefinition.durationDays: 28`
// （契約註解「第一版為 28」），以及第 149 行 `ChildEducationRuleDefinition.teacherMinimumPostDays: 28`
// （契約 `src/contracts/progression/index.ts` 第 222 行是**字面值型別** `28`，所以那個才是權威）。
// 本檔下面 `team-plan-rule.core.home-teaching-post` 的 `durationDays: 28` 是第三份拷貝。
// 三份現在數值一致，但改一處不會連動另兩處。正解是讓 Team 讀 TeachingRule 的天數
// （或由 `StartTimedCityAction` / `StartHomeTeachingPost` payload 帶天數），不是三邊各存一份。
const TRAINING_DAYS = 28;

const craftRule: Authored<FreeActionRuleDefinition> = {
  kind: 'free-action-rule',
  id: core.id<FreeActionRuleId>('free-action-rule', 'craft'),
  freeActionKind: 'craft',
  completionResolverId: resolverId('free-action-craft-completion'),
};

// 28 日鍛鍊。**三筆**而不是一筆：GDD §建築表把訓練分給三個設施，而「在哪練」與「練得到什麼」
// 是同一句宣告的兩半——拆成一筆通用規則就得在別處再補一張「設施→項目」表，那是第二份真相。
//
// `trainableMasteryIds` 讓 `chooseCityFreeAction` 當場擋掉不可鍛鍊的項目（例如委託類熟練度），
// 不必等 28 日後才在 progression 炸開。訓練給多少 MXP 不在這裡：那是
// `TeachingRuleDefinition`（Lv.5 教師、差額 × 0.15%），由 progression 在完成時算。
function trainRuleFor(
  local: string,
  facilityKind: FacilityKind,
  masteryLocals: readonly string[],
): Authored<FreeActionRuleDefinition> {
  return {
    kind: 'free-action-rule',
    id: core.id<FreeActionRuleId>('free-action-rule', `train-${local}`),
    freeActionKind: 'train',
    requiredFreeDays: TRAINING_DAYS,
    completionResolverId: resolverId('free-action-train-completion'),
    requiresCityFacilityKind: facilityKind,
    trainableMasteryIds: masteryLocals.map((m) => {
      const id = MASTERY_IDS[m];
      if (id === undefined) throw new Error(`content-source/core/team：未知的熟練度 local "${m}"`);
      return id;
    }),
  };
}

const TRAIN_RULES: readonly Authored<FreeActionRuleDefinition>[] = [
  trainRuleFor('combat-magic', 'trainingGround', COMBAT_MAGIC_MASTERY_LOCALS),
  trainRuleFor('life-craft', 'itemShop', LIFE_CRAFT_MASTERY_LOCALS),
  trainRuleFor('smith-tailor', 'equipmentShop', SMITH_TAILOR_MASTERY_LOCALS),
];

// 傳授在家中進行（GDD 建築表：「家｜家族、子女教育、熟練度傳授、休息與休息一年」）。
// `home` 是 city 的 FacilityKind 之一，所以這條設施門檻表達得出來，而且沒有別的擁有者。
const teachRule: Authored<FreeActionRuleDefinition> = {
  kind: 'free-action-rule',
  id: core.id<FreeActionRuleId>('free-action-rule', 'teach'),
  freeActionKind: 'teach',
  requiredFreeDays: TRAINING_DAYS,
  completionResolverId: resolverId('free-action-teach-completion'),
  requiresCityFacilityKind: 'home',
};

const tradeRule: Authored<FreeActionRuleDefinition> = {
  kind: 'free-action-rule',
  id: core.id<FreeActionRuleId>('free-action-rule', 'trade'),
  freeActionKind: 'trade',
  // 02_team_module.md §7.2：「交易本身是由 NPC Behavior／City Workflow 完成的零日子步驟。」
  requiredFreeDays: 0,
};

// 招募路徑的資料側入口：選 tavernVisit 的 NPC 正式成員才會出現在同城酒館名單
// （02_team_module.md §2.3、§7.6）。沒有這一筆，酒館永遠是空的，招募整條玩不到。
//
// ⚠ 但這一筆**目前選不到**：`NpcMemberFreeActionKind`（`src/contracts/npc-behavior/index.ts`
// 第 54～59 行）只有 craft／train／trade／proposeToTeammate／rest——`tavernVisit` 與 `teach`
// 都不在候選池型別裡，`02_team_module.md` 第 469 行的 `AssignNpcMemberFreeAction` 也只列這五種。
// 於是 `listTavernVisitorIds` 永遠是空的。這是招募路徑真正的斷點，補內容補不了。
const tavernVisitRule: Authored<FreeActionRuleDefinition> = {
  kind: 'free-action-rule',
  id: core.id<FreeActionRuleId>('free-action-rule', 'tavern-visit'),
  freeActionKind: 'tavernVisit',
  requiresCityFacilityKind: 'tavern',
};

const proposeToTeammateRule: Authored<FreeActionRuleDefinition> = {
  kind: 'free-action-rule',
  id: core.id<FreeActionRuleId>('free-action-rule', 'propose-to-teammate'),
  freeActionKind: 'proposeToTeammate',
  // 02_team_module.md §3.3：「proposeToTeammate 是 NPC／非玩家主角成員的零日自由子步驟。」
  requiredFreeDays: 0,
  npcMarriageRuleId: NPC_MARRIAGE_RULE,
};

const restRule: Authored<FreeActionRuleDefinition> = {
  kind: 'free-action-rule',
  id: core.id<FreeActionRuleId>('free-action-rule', 'rest'),
  freeActionKind: 'rest',
};

const FREE_ACTION_RULES: readonly Authored<FreeActionRuleDefinition>[] = [
  craftRule,
  ...TRAIN_RULES,
  teachRule,
  tradeRule,
  tavernVisitRule,
  proposeToTeammateRule,
  restRule,
];

// ── 隊伍大動作時長 ──────────────────────────────────────────────────────────
//
// `planKind`（不是 `kind`）是領域變體欄位；`kind` 固定為 registry 家族 `'team-plan-rule'`。
// 一筆 JSON 只有一個 `kind`，兩者混用會讓內容一接上就讀不到。
//
// 逐 kind 一筆，但**只寫時長真正歸這裡的那些 kind**（檔頭已列出四個刻意不寫的與理由）。
type PlanRuleRow = Readonly<{ local: string; planKind: TeamPlanKind; durationDays: number }>;

const PLAN_RULE_ROWS: readonly PlanRuleRow[] = [
  // GDD「一天的結構」：「在家休息一年消耗 365 日，主要用途為取得生育機率。」
  // 這是 `HomeYearRestCompleted.elapsedDays` 的唯一來源（事件不重述天數，由
  // dueOnDay − startedOnDay 導出），所以改這個數字就會改事件的值。
  { local: 'home-year-rest', planKind: 'homeRest', durationDays: 365 },
  // GDD 第 194 行：「住宿至少消耗 1 日」——**是「至少」，不是「固定」**；1 是這句話的下界，
  // 不是文件給的定值。目前 `rest` Command 的 cityFacilityAction 分支就是旅館住宿
  // （payload 固定 facilityKind: 'inn'）。
  // ⚠ 重複的真相：`CityActionRuleDefinition`（`actionKind: 'innRest'`，city 契約第 154～160 行）
  // 也有 `durationDays` + `requiredFacilityKind`，那才是旅館住宿天數的自然擁有者。
  // 目前 content-source 還沒有任何 city-action-rule 內容，所以衝突是潛在的、還沒撞上。
  { local: 'inn-stay', planKind: 'cityFacilityAction', durationDays: 1 },
  // GDD 第 193 行：「城市前往其對應冒險點固定消耗 1 日；離開冒險點返回城市也固定消耗 1 日。」
  // ⚠ 這兩筆目前**沒有任何人讀**：`src/modules/team/system.ts` 第 375、426 行直接寫
  // `(ctx.worldDay + 1) as WorldDay`，沒有走 `ctx.teamPlanRuleIdByKind` 查表。
  { local: 'enter-adventure-map', planKind: 'enterAdventureMap', durationDays: 1 },
  { local: 'return-to-city', planKind: 'returnToCity', durationDays: 1 },
  // GDD 第 194 行：「熟練度傳授／訓練每次消耗 28 日。」隊伍級的家中授課席位同一個明文。
  // ⚠ 與上面 TRAINING_DAYS 的註解同一件事：這是那個 28 的第三份拷貝。
  { local: 'home-teaching-post', planKind: 'homeTeachingPost', durationDays: 28 },
  // 02_team_module.md §5.4：「建立 14 日 `childStudy` Plan」，與 progression 契約的
  // `ChildEducationRuleDefinition.childStudyCycleDays: 14` 一致（該欄位才是權威擁有者——
  // 這一筆是**重複的真相**，見回報「契約缺口」）。
  { local: 'child-study', planKind: 'childStudy', durationDays: 14 },
];

function planRule(row: PlanRuleRow): Authored<TeamPlanRuleDefinition> {
  return {
    kind: 'team-plan-rule',
    id: core.id<TeamPlanRuleId>('team-plan-rule', row.local),
    planKind: row.planKind,
    durationDays: row.durationDays,
  };
}

// ── 近期行動紀錄上限 ────────────────────────────────────────────────────────
//
// **第一版方案（待討論）**：設計文件只說「Team 只保存資料規則指定數量的近期紀錄；超過上限時
// 移除最舊項」，沒有給數字。取 10 的理由：這份紀錄的唯一用途是酒館聊天要說出「目前／最近在做
// 什麼」（02_team_module.md §3.4、§7.6）。一段 NPC 強制自由期是 2～7 日、每日最多完成一筆自由
// 行動，所以 10 筆足以蓋滿一次完整自由期，再加上前一趟旅行、一次地牢與一兩場戰鬥的摘要；
// 再多就只是讓聊天翻出玩家早已忘記的往事。
const recentActivityRule: Authored<RecentActivityRuleDefinition> = {
  kind: 'recent-activity-rule',
  id: core.id<RecentActivityRuleId>('recent-activity-rule', 'standard'),
  maxRecordsPerCharacter: 10,
};

// ── 成員留隊規則 ────────────────────────────────────────────────────────────
//
// 02_team_module.md §3.5 不變量 8 與 §6.1：「入隊未滿 60 日、隊長與任務暫時角色一律不參與離隊骰定。」
// 三張 kind 清單是契約的字面 tuple（結算式 `workNet = 任務獲得 + 地牢獲得 − 旅費 − 已消耗道具價值`，
// 裝備支出明確排除），型別即不變量，這裡只是把它填上。
//
// 兩個 Resolver 的形狀（都還沒註冊，見回報）：
//   * expectedNetSettlement：依成員／隊伍資料給出「這段工作**應該**賺到多少」。
//   * departureChance：必須同時接收「低於預期的缺口」與隊長的 `memberDepartureResistance`，
//     並隨缺口單調不減、隨抵抗值單調不增——那正是 `monotonicAdjust` kernel 的形狀。
//     kernel params 屬 Resolver 那一側的定義，不在本檔（`logistic-roll-params` /
//     `weighted-product-params` 這兩個 kind 目前也還沒登記擁有模組）。
const memberRetentionRule: Authored<MemberRetentionRuleDefinition> = {
  kind: 'member-retention-rule',
  id: core.id<MemberRetentionRuleId>('member-retention-rule', 'standard'),
  activationDaysAfterJoin: 60,
  expectedNetSettlementResolverId: resolverId('member-expected-net-settlement'),
  departureChanceResolverId: resolverId('member-departure-chance'),
  excludedExpenseKinds: ['equipmentPurchase'],
  countedIncomeKinds: ['questReward', 'dungeonReward'],
  countedExpenseKinds: ['travelExpense', 'consumableUse'],
};

// ── 招募規則 ────────────────────────────────────────────────────────────────
//
// 02_team_module.md §2.3：「`successChanceResolverId` 至少接收招募者、目標、玩家隊目前正式人數，
// 以及招募者的 `inviteSuccessBonus`；只有 Resolver 擲骰成功才轉移成員。」→ `logisticCurve` 形狀。
// 「重試間隔由 `retryEligibilityResolverId` 定義，正式公式與間隔尚未定案時不得以 UI 重複送出
// Command 取代規則。」→ 間隔是 `thresholdTable` 形狀的調校量，住在 Resolver 的 params，不在本檔。
const recruitmentRule: Authored<RecruitmentRuleDefinition> = {
  kind: 'recruitment-rule',
  id: core.id<RecruitmentRuleId>('recruitment-rule', 'standard'),
  successChanceResolverId: resolverId('recruitment-success'),
  retryEligibilityResolverId: resolverId('recruitment-retry-eligibility'),
};

// ── 擲骰曲線的 params（kernel logistic）──────────────────────────────────────
//
// `logistic-roll-params` 這個 kind 的擁有者是 data-runtime（見 app/content/definition-kinds.ts）：
// 它不是任何領域的資料，是 kernel 的曲線形狀。這裡授權**兩條曲線**的係數。
//
// 【第一版方案（待討論）】招募成功率：p = 1 / (1 + e^-z)，z = 1.4 − 0.35 × 目前正式人數。
//   1 人時 z=1.05 → p≈74%；5 人時 z=−0.35 → p≈41%；9 人（隊伍上限）時 z=−1.75 → p≈15%。
//   取這組數字的理由只有一個：讓「隊伍越大越難招人」這句設計語言在整個 1～9 的區間裡都看得見，
//   而且兩端都不極端（不會 99% 也不會 1%）。設計定案時只改這兩個數字，程式不動。
//
//   ⚠ 契約 §2.3 還要求納入招募者的 `inviteSuccessBonus`（交流熟練效益）。它**沒有**進這條曲線，
//   因為 `TeamResolverPort.resolveRecruitmentSuccess` 的輸入沒有那個欄位——補它要先改 Port 形狀
//   與 team context 的 progression 投影。缺口記在此，不用一個假的預設值蓋掉。
//
// 【第一版方案（待討論）】離隊機率：z = −2.2 − 0.0006 × workNet。
//   workNet 是「任務＋地牢收入 − 旅費 − 消耗品」。收支平衡（0）時 z=−2.2 → p≈10%；
//   淨賺 3000 時 p≈2%；淨虧 3000 時 p≈33%。負號的方向就是設計語言：賺得越多越留得住人。
//   同樣缺隊長的 `memberDepartureResistance`（Port 輸入沒有），理由同上。
type LogisticRollParamsDef = DefinitionHeader & LogisticCurveParams;

const recruitmentSuccessParams: Authored<LogisticRollParamsDef> = {
  kind: 'logistic-roll-params',
  id: core.id('logistic-roll-params', 'recruitment-success'),
  bias: 1.4,
  terms: [{ inputKey: 'currentFormalCount', weight: -0.35 }],
};

const memberDepartureParams: Authored<LogisticRollParamsDef> = {
  kind: 'logistic-roll-params',
  id: core.id('logistic-roll-params', 'member-departure'),
  bias: -2.2,
  terms: [{ inputKey: 'workNet', weight: -0.0006 }],
};

// 兩條曲線的 Resolver 綁定。兩件刻意不在這裡的事：
//   * `team-default-placement` 由 `core/resolver-ids.ts` 的 `teamPureBindings()` 擁有（純演算法，
//     沒有 params）。同一個 resolverId 綁兩次會被 `createResolverRegistry` 明確拒絕。
//   * `retryEligibilityResolverId`（重試間隔）沒有任何 Handler 讀它，綁一個沒人呼叫的 Resolver
//     只會讓註冊表看起來比實作完整。
export function teamResolverBindings(): readonly ResolverBinding[] {
  return [
    {
      resolverId: resolverId('recruitment-success'),
      ownerModule: TEAM_MODULE,
      shape: 'team:logistic-roll',
      paramsDefId: recruitmentSuccessParams.id,
    },
    {
      resolverId: resolverId('member-departure-chance'),
      ownerModule: TEAM_MODULE,
      shape: 'team:logistic-roll',
      paramsDefId: memberDepartureParams.id,
    },
  ];
}

// ── 戰鬥配置規則 ────────────────────────────────────────────────────────────
//
// 02_team_module.md §3.1：「新建隊伍或成功招募成員時，由 `defaultPlacementResolverId` 以目前配置
// 與全體正式成員產生合法預設位置；不得在 Handler 寫死格位順序。」
const teamFormationRule: Authored<TeamFormationRuleDefinition> = {
  kind: 'team-formation-rule',
  id: core.id<TeamFormationRuleId>('team-formation-rule', 'standard'),
  defaultPlacementResolverId: resolverId('team-default-placement'),
};

// ── 非玩家成員每日交流練習 ──────────────────────────────────────────────────
//
// mastery_experience_economy_v1.md：「每位非玩家主角正式成員每度過一個完整城市自由日，固定取得
// 一次聊天與一次購物的交流 MXP。實際 NPC 或玩家隊友的市場交易只改變資產，不會追加交流經驗。」
// 兩條規則的 MXP 基數住在 progression 的 ExperienceAwardRuleDefinition，這裡只指名用哪兩條。
const socialPracticeRule: Authored<NonPlayerMemberDailySocialPracticeRuleDefinition> = {
  kind: 'non-player-member-daily-social-practice-rule',
  id: core.id<NonPlayerMemberDailySocialPracticeRuleId>(
    'non-player-member-daily-social-practice-rule',
    'standard',
  ),
  conversationExperienceRuleId: SOCIAL_CONVERSATION_EXPERIENCE_RULE,
  commerceExperienceRuleId: SOCIAL_COMMERCE_EXPERIENCE_RULE,
};

export const teamDomain: AuthoredDomain = {
  domain: 'team',
  texts: TRAVEL_MODE_ROWS.map((row) => ({
    key: textKeyFor(core.id<TravelModeId>('player-travel-mode', row.local)),
    name: row.name,
  })),
  definitions: [
    ...TRAVEL_MODE_ROWS.map(travelMode),
    npcTravelRule,
    ...FREE_ACTION_RULES,
    ...PLAN_RULE_ROWS.map(planRule),
    recentActivityRule,
    memberRetentionRule,
    recruitmentRule,
    recruitmentSuccessParams,
    memberDepartureParams,
    teamFormationRule,
    socialPracticeRule,
  ],
};
