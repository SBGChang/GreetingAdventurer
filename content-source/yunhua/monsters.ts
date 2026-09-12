// content-source/yunhua/monsters.ts
// 雲華的怪物池與遭遇編組。**這是文化內容**：換一份文化 pack，這一整檔都會換掉。
//
// ── 設計來源（只讀，逐筆對照）──────────────────────────────────────────────────
//   * `docs/03_content/yunhua/yunhua_content.data.mjs` 的 `monsterCatalog`
//       - `monsterCatalog.nonHuman`（15 筆）  → speciesKind: 'nonHuman'
//       - `monsterCatalog.humanYunhua`（5 筆）→ speciesKind: 'human'
//       - 每筆的 `stats`（生／肌／智／反／協／魅）→ MonsterDefinition.attributes（逐數字照抄）
//   * `docs/03_content/yunhua/yunhua_content.md`
//       - §7.1 階級基準表（Tier × 威脅 → 生命帶、招數）
//       - §7.2 非人類怪物池、§7.3 人類敵人池（與 data.mjs 同一組數字，互為校對）
//       - §7.4 代表迷宮的 Encounter 槽位預算（決定編組的成員數）
//       - §7.5 怪物資料必測項（決定「8 隻而不是 9 隻」，見下方 SWARM_SIZE 的理由）
//       - §5 ID 規約：「每個 Encounter 明列 memberDefinitionIds 與九宮格初始配置；
//         八至九隻小怪是同一 Encounter 的成員，不是把同一隻怪的經驗重複乘八至九次。」
//   * `docs/00_core/game_design_document.md`「雙方九宮格與敵人體型」（第 485～494 行）
//       - 小型／人類 1×1、中型 2×2、大型 3×3；大型占滿陣地、不與其他敵人同場佔格
//       - BOSS 必為大型；體型與威脅等級分離
//
// ── 這一檔**沒有**寫進資料的設計來源欄位（全部是契約缺口，見回報）────────────────
//   * `drops`（20 筆怪物各有一串素材）——`MonsterDefinition` 完全沒有掉落欄位。
//   * `skills`（41 招怪物技能，含通道／倍率／效果／次數上限）——那是 `skill` kind，
//     屬 skills domain worker；本檔 `skillIds` 一律留空（見下方 MONSTER_SKILL_IDS 的說明）。
//   * `name`／`role`（怪物名與內容定位）——契約無欄位；只留在本檔註解裡。
//   * `tier`（I／II）——契約無欄位；只能經 `experienceProfileId` 的 local 名間接表達。
//   * `attackProfile.physicalBase` / `magicBase` / `hitScore` 與 `threatMultiplier`
//     （1.00／1.18／1.42）——`MonsterNaturalAttackProfileDefinition` 只有三個 resolverId，
//     沒有數值欄位；而該 kind 目前根本沒有登記（見 NATURAL_ATTACK_PROFILE 的說明）。

import type {
  EncounterGroupDefinition,
  EnemyPlacementDefinition,
  MonsterBodySize,
  MonsterDefinition,
  MonsterSpeciesKind,
  MonsterThreatRank,
} from '../../src/contracts/combat';
import type { GridCell } from '../../src/contracts/map';
import type {
  CombatAiPolicyId,
  CombatControlResistanceProfileId,
  EncounterExperienceBudgetId,
  EncounterGroupDefinitionId,
  MonsterDefinitionId,
  MonsterExperienceProfileId,
  MonsterNaturalAttackProfileId,
  ResolverId,
  SkillDefinitionId,
} from '../../src/contracts/core';
import { cultureIds, textKeyFor, type Authored, type AuthoredDomain } from '../authoring';
// 怪物共通招式由 core 擁有（四國共用），文化包只引用它的 ID。
import { MONSTER_COMMON_SKILL_ID } from '../core/combat-rules';

const yunhua = cultureIds('yunhua');
const core = cultureIds('core');

// kind 字串的權威來源是 `src/app/content/combat-reader.ts` 的 `COMBAT_DEFINITION_KINDS`
// （`monster: 'monster'`、`encounterGroup: 'encounter-group'`）。逐字對照抄寫；打錯字會在
// `requireDefinitionSchemaVersion(kind)` 立刻失敗，不會靜默變成「讀不到這筆定義」。
const KIND = {
  monster: 'monster',
  encounterGroup: 'encounter-group',
};

// ── 跨 domain 引用：core 的四種規則檔 ──────────────────────────────────────────
//
// 怪物本身是文化內容，但它掛的四種規則檔全部在 core（`content-source/core/combat-rules.ts`）：
// 控制抗性、AI 策略、經驗帶、遭遇經驗預算。依 ID 規約 `<kind>.core.<local>` 拼字串引用；
// Wave F2 起 Content Compiler 會逐筆檢查「三段式且第一段是已登記 kind」的字串是否指到真實定義，
// 所以這一節打錯 local 名會是編譯錯誤，不再是「載入成功、執行期讀不到」。
//
// local 名逐筆對照 `content-source/core/combat-rules.ts`：
//   CONTROL_ROWS      → normal / elite / boss
//   AI_ROWS           → single-skill-aggressor / elite-threat-focus / boss-rotation
//   EXPERIENCE_ROWS   → tier{1,2}-{normal,elite,boss}
//   ENCOUNTER_EXPERIENCE_BUDGET_ID → standard

// 設計來源自己就把控制抗性檔按威脅等級分派（`monster()` 內：
// `rule.yunhua.control-resistance.${threat === 'Boss' ? 'boss' : threat === '菁英' ? 'elite' : 'normal'}`），
// 所以這個對應是**設計來源指定的**，不是本檔的判讀。只有 ID 形狀不同：設計來源寫
// `rule.yunhua.control-resistance.*`（自創的四段式、掛在 yunhua），引擎規約是
// `<kind>.<culture>.<local>` 且擁有者是 core。見回報「ID 形狀落差」。
function controlResistanceProfileId(threat: MonsterThreatRank): CombatControlResistanceProfileId {
  return core.id<CombatControlResistanceProfileId>('combat-control-resistance-profile', threat);
}

// **第一版方案（待討論）**：AI 策略檔依威脅等級分派。
//
// core 的三檔是**按招數上限**分的（該檔註解：single-skill-aggressor = 只有一招；
// elite-threat-focus = 2～3 招；boss-rotation = 3～4 招），設計來源沒有「哪隻怪用哪個策略」的表。
// 本檔按威脅等級分派，理由是這 20 筆的招數與威脅等級**完全同步**（逐筆招數見下方每一列的註解）：
//   一般 10 筆 → 全部 1 招     ；菁英 7 筆 → 2～3 招     ；Boss 3 筆 → 3～4 招。
// 所以「按威脅分」與「按招數分」在這份資料上是同一個結果；哪天出現「菁英只有 1 招」就必須改成
// 逐筆指定，而那是改這張表的資料，不是改程式。
const AI_POLICY_LOCAL: Readonly<Record<MonsterThreatRank, string>> = {
  normal: 'single-skill-aggressor',
  elite: 'elite-threat-focus',
  boss: 'boss-rotation',
};

function aiPolicyId(threat: MonsterThreatRank): CombatAiPolicyId {
  return core.id<CombatAiPolicyId>('combat-ai-policy', AI_POLICY_LOCAL[threat]);
}

// 經驗帶：Tier × 威脅。這個鍵是設計來源自己的鍵——`balanceModel.experience` 的五列與
// `yunhua_content.md` §7.4 的槽位預算都以「Tier I／II × 一般群／菁英／Boss」列出，
// core 的 EXPERIENCE_ROWS 也照這個鍵發了六筆。
type Tier = 1 | 2;

function experienceProfileId(tier: Tier, threat: MonsterThreatRank): MonsterExperienceProfileId {
  return core.id<MonsterExperienceProfileId>(
    'monster-experience-profile',
    `tier${tier}-${threat}`,
  );
}

// 遭遇經驗預算：core 只有一筆 `standard`（aggregation: 'sumMemberProfiles'、groupModifier: 1），
// 所以 20 筆編組全部指它。真正的預算差異來自成員清單的加總，不是這個 ID。
const EXPERIENCE_BUDGET_ID = core.id<EncounterExperienceBudgetId>(
  'encounter-experience-budget',
  'standard',
);

// ── 天生攻擊檔：**引用得到、但目前不可能存在的定義** ────────────────────────────
//
// `MonsterDefinition.naturalAttackProfileId` 是必填。但：
//   1. `monster-natural-attack-profile` **不在** `ALL_DEFINITION_KINDS`（119 筆）裡，所以沒有任何
//      人（core 或文化包）寫得出這筆定義——Compiler 會以「未登記的 kind」拒收。
//   2. `CombatDefinitionReader` 也沒有 `getNaturalAttackProfile` getter，所以就算寫出來也讀不到。
//   3. 於是 Compiler 的「跨定義引用必須解析得到」也**抓不到**這一筆：那道檢查只認第一段是已登記
//      kind 的三段式字串，而這個 kind 沒登記。**編譯會過，但這是一筆懸空引用。**
// 這三件事只能由契約側修（登記 kind + 補 Reader getter + 在 core 發三筆定義），內容側補不了。
// 見回報「契約缺口」第 1 項。本檔照規約填上正確的 ID，讓那筆定義一被建立就自動接上。
//
// **第一版方案（待討論）**：按威脅等級分三檔（normal／elite／boss）。
// 理由：設計來源的攻擊檔是**由公式算出來的**——
//   physicalBase = (肌 × 1.20 + 協 × 0.45) × 威脅倍率
//   magicBase    = (智 × 1.25 + 協 × 0.20) × 威脅倍率
//   hitScore     = 反 × 0.40 + 協 × 0.55 + 智 × 0.10
// 三個輸入裡，屬性由 Resolver 從 `MonsterDefinition.attributes` 讀得到，公式係數屬 core 的
// balanceModel，**唯一逐怪不同又讀不到的是威脅倍率（1.00／1.18／1.42）**。所以「一個威脅等級
// 一個檔」是目前唯一能把那個倍率放進資料的形狀（同 core 既有的「一個調校值一個 Resolver ID」）。
// 設計來源自己只發一個 `rule.yunhua.monster-attack.standard`（單一檔），把倍率折進了預算出來的
// 數值——但那三個數值在契約裡沒有欄位可放，所以照抄那個形狀會讓倍率整個消失。
function naturalAttackProfileId(threat: MonsterThreatRank): MonsterNaturalAttackProfileId {
  return core.id<MonsterNaturalAttackProfileId>('monster-natural-attack-profile', threat);
}

// ── 遭遇獎勵 Resolver ───────────────────────────────────────────────────────
//
// `EncounterGroupDefinition.rewardResolverId` 是必填，但它**目前零消費者**：`src/modules/combat`
// 全檔沒有任何地方讀它（只有 `encounterBudgets()` 讀 experienceBudgetId）。
//
// **第一版方案（待討論）**：按威脅等級分三個 Resolver。理由是設計來源唯一給出的掉落**分層**
// 依據是威脅等級：`yunhua_content.md` §11.5「極品書｜正式來源：Boss 掉落」、
// 「高級書｜寶箱、探索物品、地圖事件」。逐怪的素材掉落（設計來源 20 筆 `drops` 字串）在契約裡
// 沒有任何落點，所以這三個 ID 表達不了「掉什麼」，只表達「哪一層」。見回報「契約缺口」第 2 項。
function rewardResolverId(threat: MonsterThreatRank): ResolverId {
  return `resolver:combat.encounter-reward.${threat}` as ResolverId;
}

// ── 怪物技能：**刻意留空** ──────────────────────────────────────────────────
//
// 設計來源有 41 招怪物技能（20 隻怪的 `skills` 陣列加總，招名各不重複），每一招都已經是可解析的
// 資料（傷害通道、數值倍率、延遲檔、狀態效果、次數上限）——但它們是 `skill` kind，屬 skills
// domain worker 的範圍，本檔不擁有那些 ID。
//
// 而 `skill` **是**已登記的 kind，所以 Compiler 的跨定義引用檢查會逐筆檢查 `skill.yunhua.<local>`：
// 猜一組 local 名的後果不是「將來對不上」，而是**整個 pack 立刻編譯失敗**（連帶擋住同波其他
// domain）。所以這裡留空，由整合者在 skills domain 落地後一次接上。
//
// ⚠ 留空的代價要講清楚，不要當成「已處理」：`yunhua_content.md` §7.5 的第一條必測項
// 「一般敵人剛好一招；菁英／Boss 二至四招」在 skillIds 全空時對 20 筆全部失敗，而且怪物在
// Detailed Combat 裡選不到任何行動。**這 20 筆怪物在 skillIds 接上之前不是可玩內容。**
// 逐怪的招數與招名見下方每一列的註解，以及回報的「怪物技能對照表」。
// 【設計決定】所有怪物共用 core 的一招「撞擊」（`combat-skill.core.monster-slam`）。
// 上面那段記載的缺口——41 招怪物技能屬 skills domain、尚未授權——由這個共通招關掉：
// 怪物在 Detailed Combat 裡選得到行動了，而且不必先發明 41 招的數值。
// 日後個別怪物要有自己的招式時，把該怪的這一欄換成它自己的技能即可，共通招留給其餘怪物。
const COMMON_SKILLS: readonly SkillDefinitionId[] = [MONSTER_COMMON_SKILL_ID];

// ── 九宮格座標 ──────────────────────────────────────────────────────────────
//
// `EnemyPlacementDefinition.anchorCell` 的型別是 map 的 `GridCell`（`{ floor, row, col }`），
// 而戰鬥九宮格沒有樓層概念——這是 combat 重用 map 型別造成的多餘欄位（見回報「契約缺口」第 3 項）。
// `floor: 0` 不是本檔挑的值：`src/modules/combat/state.ts` 的 `localCell(row, col)` 就是
// `{ floor: 0, row, col }`，那是引擎對戰鬥格的既有寫法。
//
// row 1 是前排（`backfillSide()` 以 `occupiedRows.has(1)` 判斷「第 1 排仍有占格單位」），
// col 1～3 由左至右；anchor 是 footprint 的左上角（`coveredCells()` 由 anchor 往 row+／col+ 展開）。
function combatCell(row: number, col: number): GridCell {
  return { floor: 0, row, col };
}

// ── 編組形狀 ────────────────────────────────────────────────────────────────
//
// 只有兩種形狀。**這兩種形狀是設計來源的 `encounter` 欄位講的**（那是中文散文，逐筆判讀結果見
// 每一列的註解與回報的「散文判讀清單」）：
//   swarm —— '8～9 隻為一個一般群。'
//   lone  —— 'Tier I 菁英。' / 'Tier I Boss；單獨出場。' / '一般敵人可為中型。'
type GroupShape = 'swarm' | 'lone';

// **第一版方案（待討論）：取 8 隻，不是 9 隻。**
//
// 設計來源給的是區間（'8～9 隻'），但 `yunhua_content.md` §7.5 把總額講成硬要求：「小怪群以
// 8～9 隻填滿或接近填滿敵方九宮格時，其 `MonsterExperienceProfile` 加總與 Encounter Budget
// **完全一致**。」而 core 的逐隻 Profile 是定值（tier1-normal 40／10、tier2-normal 100／25），
// Budget 的 groupModifier 是 1，aggregation 是 sumMemberProfiles——
//   8 隻 → 320／80、800／200，與 §7.4 的槽位預算**完全一致** ✅
//   9 隻 → 360／90、900／225，超出 12.5% ✗
// 所以 8 是這個契約形狀下唯一能通過那條必測項的隻數。core 的 combat-rules.ts 已經把同一件事
// 記成「必須整合者裁決」的三條出路；在裁決之前，本檔選能通過必測項的那一邊。
const SWARM_SIZE = 8;

// 8 隻 1×1 的九宮格：前排優先填滿，空的一格留在最後排最右。
// 「前排優先」不是美感選擇——`backfillSide()` 只在第 1 排全空時整側前移，把空格留在後排可以
// 避免開場就觸發補位（那會讓「初始配置」與實際開場站位不一致）。
const SWARM_CELLS: readonly (readonly [number, number])[] = [
  [1, 1],
  [1, 2],
  [1, 3],
  [2, 1],
  [2, 2],
  [2, 3],
  [3, 1],
  [3, 2],
];

// 單隻出場的 anchor。**第一版方案（待討論）**：設計來源沒有給任何座標。
//   * 2×2 與 3×3 的 anchor 只能是 (1,1)：3×3 陣地裡 2×2 放在 (1,2) 或 (2,1) 都會讓它離開前排或
//     超出邊界，3×3 更是只有 (1,1) 一個合法解。所以這兩種其實沒有選擇餘地。
//   * 1×1 單隻取前排正中 (1,2)：唯一的自由度，取中間是為了讓左右都在射程對稱位置。
const LONE_BLOCK_ANCHOR: readonly [number, number] = [1, 1];
const LONE_SMALL_ANCHOR: readonly [number, number] = [1, 2];

// ── 怪物表 ──────────────────────────────────────────────────────────────────
//
// 每一列的六個數字依設計來源的順序（生／肌／智／反／協／魅）逐筆照抄，方便與
// `yunhua_content.md` §7.2／§7.3 的表格對讀。
//
// `size` 與 `threat` 是從設計來源的中文字串判讀出來的（'小型 1×1' → 'small'、'菁英' → 'elite'，
// 逐筆見回報的「散文判讀清單」）。兩者都是**封閉的三值集合**，不是自由散文，而且 md 的
// 「威脅／體型」欄與 data.mjs 的 `threat`／`size` 互為校對——兩邊不一致的話就不會有一致的判讀。
type MonsterRow = Readonly<{
  local: string;
  // 顯示名。中文逐字取自設計來源的怪物表；英文是這一輪授權的翻譯。兩個語系都在 Row 上，
  // 所以「新增一隻怪卻只寫一種語言」是編譯錯誤，而不是切到英文才看見一個 slug。
  nameZh: string;
  nameEn: string;
  speciesKind: MonsterSpeciesKind;
  tier: Tier;
  threat: MonsterThreatRank;
  size: MonsterBodySize;
  health: number;
  muscle: number;
  intelligence: number;
  reaction: number;
  coordination: number;
  charisma: number;
  groupShape: GroupShape;
}>;

// 非人類池（`monsterCatalog.nonHuman`，15 筆）。
// 「怪物本身屬於雲華文化池；Map Spawn Rule 只決定怪群槽位、威脅與體型合法性，不選擇地圖專屬
// 怪種」（§7.2）——所以這 15 筆沒有任何地圖歸屬欄位，也不該有。
const NON_HUMAN_ROWS: readonly MonsterRow[] = [
  // 瘴翅蛾｜群體遠程干擾｜1 招：瘴粉撲翼（魔傷 ×0.82、瘴息 2 行動）
  // 掉落（無欄位）：瘴翅粉、薄翅膜
  {
    local: 'mistwing-moth',
    nameZh: '瘴翅蛾',
    nameEn: 'Mistwing Moth',
    speciesKind: 'nonHuman',
    tier: 1,
    threat: 'normal',
    size: 'small',
    health: 130,
    muscle: 3,
    intelligence: 22,
    reaction: 29,
    coordination: 13,
    charisma: 0,
    groupShape: 'swarm',
  },
  // 竹背獾｜群體近戰壓力｜1 招：掠地撲咬（物傷 ×0.96）
  // 掉落（無欄位）：竹背皮、獾肉、獾腺囊
  {
    local: 'bamboo-back-badger',
    nameZh: '竹背獾',
    nameEn: 'Bamboo-Back Badger',
    speciesKind: 'nonHuman',
    tier: 1,
    threat: 'normal',
    size: 'small',
    health: 170,
    muscle: 29,
    intelligence: 3,
    reaction: 18,
    coordination: 19,
    charisma: 0,
    groupShape: 'swarm',
  },
  // 潮殼蟹｜水道前排壓力｜1 招：鉗殼夾擊（物傷 ×0.90、破綻 2 行動）
  // 掉落（無欄位）：潮殼、蟹鉗
  {
    local: 'tide-shell-crab',
    nameZh: '潮殼蟹',
    nameEn: 'Tide-Shell Crab',
    speciesKind: 'nonHuman',
    tier: 1,
    threat: 'normal',
    size: 'small',
    health: 160,
    muscle: 27,
    intelligence: 2,
    reaction: 12,
    coordination: 17,
    charisma: 0,
    groupShape: 'swarm',
  },
  // 殘頁符偶｜符術／魔防檢查｜1 招：碎印射流（魔傷 ×0.76、印痕 2 行動、可被中斷）
  // 掉落（無欄位）：殘符紙、舊朱砂
  {
    local: 'scrap-sigil-doll',
    nameZh: '殘頁符偶',
    nameEn: 'Scrap-Sigil Poppet',
    speciesKind: 'nonHuman',
    tier: 1,
    threat: 'normal',
    size: 'small',
    health: 125,
    muscle: 4,
    intelligence: 31,
    reaction: 19,
    coordination: 15,
    charisma: 0,
    groupShape: 'swarm',
  },
  // 瘴囊獾母｜近戰與瘴息｜3 招：肩背衝頂、瘴囊噴霧、伏背守毛
  // 掉落（無欄位）：完整獾腺、韌皮、獾肉
  {
    local: 'miasma-pouch-badger',
    nameZh: '瘴囊獾母',
    nameEn: 'Miasma-Pouch Badger Sow',
    speciesKind: 'nonHuman',
    tier: 1,
    threat: 'elite',
    size: 'medium',
    health: 460,
    muscle: 50,
    intelligence: 19,
    reaction: 24,
    coordination: 27,
    charisma: 0,
    groupShape: 'lone',
  },
  // 閘水母螈｜單體 CTB 壓力｜2 招：水閘躍咬、冷水噴壓
  // 掉落（無欄位）：潮腺、濕鱗、沉水草
  {
    local: 'gatewater-salamander',
    nameZh: '閘水母螈',
    nameEn: 'Gatewater Salamander',
    speciesKind: 'nonHuman',
    tier: 1,
    threat: 'elite',
    size: 'medium',
    health: 430,
    muscle: 38,
    intelligence: 25,
    reaction: 32,
    coordination: 24,
    charisma: 0,
    groupShape: 'lone',
  },
  // 披甲陶衛｜守勢與破綻｜3 招：陶戈重擊、護印立勢、鎖紋敲擊
  // 掉落（無欄位）：陶衛甲片、窯印、銅扣
  {
    local: 'armored-pottery-guard',
    nameZh: '披甲陶衛',
    nameEn: 'Armored Pottery Guard',
    speciesKind: 'nonHuman',
    tier: 1,
    threat: 'elite',
    size: 'small',
    health: 500,
    muscle: 55,
    intelligence: 15,
    reaction: 18,
    coordination: 26,
    charisma: 0,
    groupShape: 'lone',
  },
  // 霧篁獾王｜藥谷 Boss｜3 招：裂土前爪、瘴鳴嘶吼、鐵背伏守
  // 掉落（無欄位）：獾王硬皮、巨型腺囊、藥谷寶材
  {
    local: 'mist-bamboo-king',
    nameZh: '霧篁獾王',
    nameEn: 'Mistbamboo Badger King',
    speciesKind: 'nonHuman',
    tier: 1,
    threat: 'boss',
    size: 'large',
    health: 2_400,
    muscle: 78,
    intelligence: 20,
    reaction: 70,
    coordination: 36,
    charisma: 0,
    groupShape: 'lone',
  },
  // 沉閘巨螈｜水道 Boss｜4 招：沉水咬壓、濁浪噴壓、潮鱗護體、閘鳴震波
  // 掉落（無欄位）：巨螈鱗、閘骨、沉貨殘件
  {
    local: 'sunken-weir-beast',
    nameZh: '沉閘巨螈',
    nameEn: 'Sunken-Weir Salamander',
    speciesKind: 'nonHuman',
    tier: 1,
    threat: 'boss',
    size: 'large',
    health: 2_600,
    muscle: 72,
    intelligence: 28,
    reaction: 66,
    coordination: 39,
    charisma: 0,
    groupShape: 'lone',
  },
  // 斷符游靈｜印塔群體施術｜1 招：裂印飛白（魔傷 ×0.88、印痕 2 行動、可被中斷）
  // 掉落（無欄位）：斷符墨、靈紙纖維
  {
    local: 'frayed-seal-wisp',
    nameZh: '斷符游靈',
    nameEn: 'Frayed-Seal Wisp',
    speciesKind: 'nonHuman',
    tier: 2,
    threat: 'normal',
    size: 'small',
    health: 270,
    muscle: 2,
    intelligence: 49,
    reaction: 35,
    coordination: 22,
    charisma: 0,
    groupShape: 'swarm',
  },
  // 銅鈴顎蟲｜高協調前排｜1 招：鳴顎鉗擊（物傷 ×1.03、+8 CTB）
  // 掉落（無欄位）：鈴殼、銅質顎片
  {
    local: 'bell-mandible-beetle',
    nameZh: '銅鈴顎蟲',
    nameEn: 'Bell-Mandible Beetle',
    speciesKind: 'nonHuman',
    tier: 2,
    threat: 'normal',
    size: 'small',
    health: 340,
    muscle: 50,
    intelligence: 7,
    reaction: 20,
    coordination: 26,
    charisma: 0,
    groupShape: 'swarm',
  },
  // 塔脊石蜥｜中型單招敵人｜1 招：石脊甩尾（物傷 ×1.08）
  // 掉落（無欄位）：石蜥脊片、印塔石粉
  //
  // ⚠ 這一筆的 groupShape 是 'lone'，而它是 Tier II **一般**——設計來源的 `encounter` 欄位對它
  // 寫的是「一般敵人可為中型。」，**沒有**寫「8～9 隻為一個一般群」（同 Tier 的另兩筆一般怪都有）。
  // 幾何上也放不下更多：3×3 陣地裡 2×2 只塞得進一隻。
  // 後果是 Tier II 一般槽位由它填時預算只有 100／25，是 §7.4 的 800／200 的 12.5%。
  // 這是契約形狀的問題（逐怪定值 Profile 表達不出「隻數改變分配、總額不變」），見回報。
  {
    local: 'tower-stone-lizard',
    nameZh: '塔脊石蜥',
    nameEn: 'Tower-Ridge Stone Lizard',
    speciesKind: 'nonHuman',
    tier: 2,
    threat: 'normal',
    size: 'medium',
    health: 350,
    muscle: 52,
    intelligence: 12,
    reaction: 17,
    coordination: 29,
    charisma: 0,
    groupShape: 'lone',
  },
  // 鎖印陶將｜破綻與護印｜3 招：鎖戈直刺、鎮印護身、斷紋震擊
  // 掉落（無欄位）：鎖印陶芯、陶將戈刃、銅鈴座
  {
    local: 'seal-halberd-warden',
    nameZh: '鎖印陶將',
    nameEn: 'Sealbound Pottery Warden',
    speciesKind: 'nonHuman',
    tier: 2,
    threat: 'elite',
    size: 'medium',
    health: 820,
    muscle: 74,
    intelligence: 31,
    reaction: 26,
    coordination: 43,
    charisma: 0,
    groupShape: 'lone',
  },
  // 殘詔書吏｜高智詛咒｜3 招：硃批穿符、敕令鎖紋、封卷護印
  // 掉落（無欄位）：古詔殘頁、官朱砂、封卷線
  {
    local: 'broken-edict-scribe',
    nameZh: '殘詔書吏',
    nameEn: 'Broken-Edict Scribe',
    speciesKind: 'nonHuman',
    tier: 2,
    threat: 'elite',
    size: 'small',
    health: 740,
    muscle: 13,
    intelligence: 76,
    reaction: 38,
    coordination: 34,
    charisma: 0,
    groupShape: 'lone',
  },
  // 天衡印俑｜印塔 Boss｜4 招：鎮印巨槌、四方鎖符、石甲回印、衡令震鳴
  // 掉落（無欄位）：天衡印石、鎮符銅心、極品書池
  {
    local: 'balance-seal-colossus',
    nameZh: '天衡印俑',
    nameEn: 'Tianheng Seal Colossus',
    speciesKind: 'nonHuman',
    tier: 2,
    threat: 'boss',
    size: 'large',
    health: 5_200,
    muscle: 95,
    intelligence: 68,
    reaction: 74,
    coordination: 55,
    charisma: 0,
    groupShape: 'lone',
  },
];

// 人類池（`monsterCatalog.humanYunhua`，5 筆）。
// §7.3：「此池只在該 Region 目前由雲華控制時，供 `humanCultureContentRuleId` 使用；被他國佔領後
// 整池替換，非人類怪物與雲華物品不受影響。」那個切換是 map／world 的規則，不是這裡的欄位——
// `MonsterDefinition` 只帶 `speciesKind: 'human'` 與 `cultureId`，占領切換由讀取端依這兩者選池。
//
// GDD 第 492 行：「小型敵人與人類敵人佔 1×1」——所以五筆全部 small，與設計來源的 '小型 1×1' 一致。
const HUMAN_ROWS: readonly MonsterRow[] = [
  // 漕幫刀客｜單手近戰｜1 招：撩刀斬（物傷 ×0.95）
  // 掉落（無欄位）：環首刀零件、舊皮甲、漕運票根
  {
    local: 'river-cutthroat',
    nameZh: '漕幫刀客',
    nameEn: 'Canal-Gang Cutthroat',
    speciesKind: 'human',
    tier: 1,
    threat: 'normal',
    size: 'small',
    health: 145,
    muscle: 27,
    intelligence: 7,
    reaction: 22,
    coordination: 21,
    charisma: 10,
    groupShape: 'swarm',
  },
  // 私運弩手｜遠程射擊｜1 招：短弩急射（物傷 ×0.88、命中讀條時中斷）
  // 掉落（無欄位）：竹弩件、短矢、私運貨單
  {
    local: 'privateer-crossbow',
    nameZh: '私運弩手',
    nameEn: 'Smuggler Crossbowman',
    speciesKind: 'human',
    tier: 1,
    threat: 'normal',
    size: 'small',
    health: 125,
    muscle: 10,
    intelligence: 10,
    reaction: 27,
    coordination: 28,
    charisma: 8,
    groupShape: 'swarm',
  },
  // 鹽路頭目｜單手與支援｜3 招：雙環斬、煙丸散布、喝令定息
  // 掉落（無欄位）：精品單手武器候選、青鐵件、貨單
  //
  // ⚠ **待討論**：'喝令定息' 的次數限制是「場上無其他人類敵人不可用」，也就是設計來源預設這隻
  // 菁英會**帶隊**出場。但設計來源沒有給編組成員，而任何隨扈都會讓遭遇預算離開 §7.4 的菁英槽位
  // 值（960／240 = 剛好一筆 tier1-elite Profile；加 4 名一般人類就變成 1,120／280，+16.7%）。
  // 憑空指定「頭目 + 4 名刀客」是發明內容，所以本檔照預算發**單隻**編組，並把這個矛盾留在檯面上：
  // 在編組補上隨扈之前，這一招永遠不可用。見回報「第一版方案（待討論）」第 4 項。
  {
    local: 'salt-route-leader',
    nameZh: '鹽路頭目',
    nameEn: 'Salt-Route Chieftain',
    speciesKind: 'human',
    tier: 1,
    threat: 'elite',
    size: 'small',
    health: 470,
    muscle: 45,
    intelligence: 16,
    reaction: 28,
    coordination: 30,
    charisma: 20,
    groupShape: 'lone',
  },
  // 守印逃卒｜制式長槍｜1 招：制式槍刺（物傷 ×1.04、+8 CTB）
  // 掉落（無欄位）：札甲件、制式槍頭、印塔通行牌
  {
    local: 'seal-tower-deserter',
    nameZh: '守印逃卒',
    nameEn: 'Seal-Tower Deserter',
    speciesKind: 'human',
    tier: 2,
    threat: 'normal',
    size: 'small',
    health: 300,
    muscle: 52,
    intelligence: 18,
    reaction: 25,
    coordination: 30,
    charisma: 10,
    groupShape: 'swarm',
  },
  // 偽印校尉｜刀術與護印｜3 招：印刀斷勢、官符護印、追責符
  // 掉落（無欄位）：史詩武器候選、官印銅件、古紙
  // 三招都不依賴其他人類敵人在場，所以單隻編組不會讓任何一招失效（與鹽路頭目相反）。
  {
    local: 'false-seal-officer',
    nameZh: '偽印校尉',
    nameEn: 'False-Seal Officer',
    speciesKind: 'human',
    tier: 2,
    threat: 'elite',
    size: 'small',
    health: 800,
    muscle: 68,
    intelligence: 36,
    reaction: 31,
    coordination: 40,
    charisma: 24,
    groupShape: 'lone',
  },
];

const ALL_ROWS: readonly MonsterRow[] = [...NON_HUMAN_ROWS, ...HUMAN_ROWS];

// ── 純資料展開 ──────────────────────────────────────────────────────────────
//
// 以下兩個函式沒有任何規則判斷：一個把表格的一列攤成 MonsterDefinition 的欄位，另一個把
// 「形狀 + 體型」攤成九宮格座標清單。判準（authoring.ts）：這裡寫的每一行，換一份 pack 都會改。

function monsterId(local: string): MonsterDefinitionId {
  return yunhua.id<MonsterDefinitionId>(KIND.monster, local);
}

function monster(row: MonsterRow): Authored<MonsterDefinition> {
  return {
    kind: KIND.monster,
    id: monsterId(row.local),
    display: { nameRef: { key: textKeyFor(monsterId(row.local)) } },
    // `cultureMeta.id` 就是 'culture.yunhua'（文化 ID 只有兩段，見 authoring.ts 的 cultureIds）。
    cultureId: yunhua.cultureId,
    speciesKind: row.speciesKind,
    threatRank: row.threat,
    bodySize: row.size,
    attributes: {
      health: row.health,
      muscle: row.muscle,
      intelligence: row.intelligence,
      reaction: row.reaction,
      coordination: row.coordination,
      charisma: row.charisma,
    },
    // 刻意留空，見上方 NO_SKILLS 的說明。契約要求可變陣列，所以每筆展開成新陣列。
    skillIds: [...COMMON_SKILLS],
    naturalAttackProfileId: naturalAttackProfileId(row.threat),
    controlResistanceProfileId: controlResistanceProfileId(row.threat),
    aiPolicyId: aiPolicyId(row.threat),
    experienceProfileId: experienceProfileId(row.tier, row.threat),
    // §2.4 射程（格數）：第一版一律近戰 1（待討論）。目前怪物 skillIds 為空、尚無距離攻擊資料，
    // 故 reach 未被實戰運算；等怪物招式與遠距怪加入時，改由 row 帶入分型的射程。
    reachCells: 1,
  };
}

// 一筆編組的成員座標。體型決定 anchor 的自由度（見 LONE_* 常數的說明）：
//   swarm  —— 只用於 1×1（設計來源的 '8～9 隻' 全部是小型或人類），八格前排優先。
//   lone   —— 1×1 取前排正中；2×2 與 3×3 只有 (1,1) 一個合法 anchor。
function placementCells(shape: GroupShape, size: MonsterBodySize): readonly (readonly [number, number])[] {
  if (shape === 'swarm') return SWARM_CELLS;
  return size === 'small' ? [LONE_SMALL_ANCHOR] : [LONE_BLOCK_ANCHOR];
}

// 編組 local 名 = 怪物 local 名 + 形狀後綴。
//   `-swarm` = SWARM_SIZE 隻同種（GDD 第 494 行：「通常會以同種小怪填滿或接近填滿敵方 3×3 陣地」）
//   `-lone`  = 單隻
// **第一版方案（待討論）**：設計來源完全沒有列出 Encounter 定義（§5 只規定「每個 Encounter 明列
// memberDefinitionIds 與九宮格初始配置」的形式），所以「一隻怪一個標準編組」這個池的形狀是本檔
// 決定的。理由：§7.2「Map Spawn Rule 只決定怪群槽位、威脅與體型合法性，不選擇地圖專屬怪種」——
// 地圖挑的是「Tier × 威脅 × 體型」符合的編組，所以池裡每個合法怪種都必須有一個可被挑中的編組，
// 否則那隻怪永遠不會出現。混種編組（例如頭目帶隨扈）在設計來源裡沒有任何一筆，不予發明。
// 第一版方案（待討論）：有正式素材定義的怪物掉落一份素材，其餘尚無對應素材不虛構掉落。
const DROP_MATERIALS: Readonly<Record<string,string>> = { 'tide-shell-crab': 'tide-shell', 'bamboo-back-badger': 'bamboo-back-hide', 'privateer-crossbow': 'green-iron-ingot' };
function encounterGroup(row: MonsterRow): Authored<EncounterGroupDefinition> {
  // 第一版方案（待討論）：Tier I 小型怪群為三隻，讓單人旅者有可完成的初期委託；Tier II 保留大型群體。
  const count = row.groupShape === 'swarm' ? (row.tier === 1 ? 3 : SWARM_SIZE) : 1;
  const cells = placementCells(row.groupShape, row.size).slice(0, count);
  const id = monsterId(row.local);
  // memberDefinitionIds 逐**個體**列出（同一隻怪重複 8 次），不是去重的種類清單。
  // 這是 §5 那條規約的資料形狀，也是引擎的讀法：`encounterBudgets()`（src/modules/combat/system.ts
  // 第 1553 行）逐 memberDefinitionIds 加總各自的 MonsterExperienceProfile。去重會讓 8 隻的群體
  // 只發一隻的經驗。
  const memberDefinitionIds: MonsterDefinitionId[] = Array.from({ length: count }, () => id);
  const initialPlacements: EnemyPlacementDefinition[] = cells.map(([gridRow, col]) => ({
    monsterDefinitionId: id,
    anchorCell: combatCell(gridRow, col),
  }));
  return {
    kind: KIND.encounterGroup,
    id: yunhua.id<EncounterGroupDefinitionId>(
      KIND.encounterGroup,
      `${row.local}-${row.groupShape === 'swarm' ? 'swarm' : 'lone'}`,
    ),
    memberDefinitionIds,
    initialPlacements,
    experienceBudgetId: EXPERIENCE_BUDGET_ID,
    rewardResolverId: rewardResolverId(row.threat),
    itemRewards: DROP_MATERIALS[row.local] ? [{ itemDefinitionId: yunhua.id<import('../../src/contracts/core').ItemDefinitionId>('material', DROP_MATERIALS[row.local]!), quantity: 1 }] : [],
  };
}

// 供 map／dungeon domain 引用（地圖的 Spawn Rule 要挑編組，不是挑怪種）。
// 只匯出 ID，不匯出定義本體——引用方需要的是 ID。
export const YUNHUA_MONSTER_IDS: readonly MonsterDefinitionId[] = ALL_ROWS.map((row) =>
  monsterId(row.local),
);

// 文化內容池的候選項（`yunhua_content.md` §7.2／§7.3）。
//
// 從**同一份 `MONSTER_ROWS`** 導出，所以「這隻怪是 Tier 幾／什麼威脅／人不人類」在怪物定義與
// 文化池裡不可能講出兩種答案——手抄第二份一定會漂移。
// 地圖挑的是**編組**不是怪種，所以候選帶的是 encounterGroupId。
export type YunhuaContentCandidate = Readonly<{
  encounterGroupId: EncounterGroupDefinitionId;
  tier: Tier;
  threatRank: MonsterThreatRank;
  speciesKind: MonsterSpeciesKind;
}>;

function candidateOf(row: MonsterRow): YunhuaContentCandidate {
  return {
    encounterGroupId: yunhua.id<EncounterGroupDefinitionId>(
      KIND.encounterGroup,
      `${row.local}-${row.groupShape === 'swarm' ? 'swarm' : 'lone'}`,
    ),
    tier: row.tier,
    threatRank: row.threat,
    speciesKind: row.speciesKind,
  };
}

export const YUNHUA_NON_HUMAN_CANDIDATES: readonly YunhuaContentCandidate[] =
  NON_HUMAN_ROWS.map(candidateOf);
export const YUNHUA_HUMAN_CANDIDATES: readonly YunhuaContentCandidate[] =
  HUMAN_ROWS.map(candidateOf);

export const monstersDomain: AuthoredDomain = {
  domain: 'monsters',
  definitions: [...ALL_ROWS.map(monster), ...ALL_ROWS.map(encounterGroup)],
  texts: ALL_ROWS.map((row) => ({
    key: textKeyFor(monsterId(row.local)),
    name: { 'zh-Hant': row.nameZh, en: row.nameEn },
  })),
};
