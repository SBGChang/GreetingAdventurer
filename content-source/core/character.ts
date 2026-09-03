// content-source/core/character.ts
// 角色原型、生命週期規則、角色暫時狀態、生育規則、任務暫時角色規則、世界冒險者生成規則。
// **文化無關**——這六個 kind 在 core 放的是四國共用的「結構角色」與「共用生命週期」，不含任何一國的
// 人名、稱號、家世或專屬狀態。帶文化色彩的原型（04_character_module.md §1.3 舉的富商、貴族、
// 雲華冒險者）與由該國技能／道具／陷阱定義的專屬暫時狀態，都屬各自的 culture pack。
//
// 來源（逐筆對照見每一段的註解）：
//   * 生命週期年齡：`docs/00_core/game_design_document.md`「六、角色生命週期」「七、傳承系統」，
//     以及 `docs/02_systems/time_and_mastery_progression.md`「世代定位」的 15～55 歲養成期。
//   * 年→日換算：同上「一、時間尺度」的「在家休息一年 365 日」。
//   * 生育規則天數：`docs/00_core/architecture/04_character_module.md` §2.4（`requiredRestDays`
//     本版為 365）＋ GDD「在家休息一年消耗 365 日，主要用途為取得生育機率」。
//   * 角色暫時狀態清單：GDD「十、恢復與暫時狀態」點名的流血、恐懼、昏沉三項，以及「旅館以
//     『恢復狀態』為唯一定位……恢復生命、魔力，以及可由休息解除的暫時狀態」。
//   * 原型的身份標籤：GDD「一、世界模擬系統／NPC模型」的「身份標籤（商人、衛兵、冒險者、平民等）」。
//   * 護衛／救援暫時角色的兩種 kind：04_character_module.md §1.3、§7.1。
//   * 世界冒險者生成：GDD「十一、人口系統」＋ 04_character_module.md §2.2 最後三條。
//
// 本檔沒有任何規則邏輯：所有可變決定（退休、自然死亡、生育資格與結果、生成原型／性別／起始年齡／
// 天賦）都只**指名** Resolver，係數與曲線由該 Resolver 自己的 params 定義帶（§7.1「形狀＝程式、
// 調校＝資料」）。本檔用到但目前還沒有登記的 Resolver 一覽見檔尾的 `CHARACTER_RESOLVER_IDS`。

import type {
  BirthRuleDefinition,
  CharacterArchetypeDefinition,
  CharacterRoleTag,
  LifecycleRuleDefinition,
  StatusDefinition,
  TemporaryCharacterRuleDefinition,
  TemporaryCharacterRuleId,
} from '../../src/contracts/character';
import type { WorldAdventurerGenerationRuleDefinition } from '../../src/contracts/character';
import type {
  AgeModifierRuleId,
  BirthRuleId,
  CharacterArchetypeId,
  CharacterStatusDefinitionId,
  DefinitionHeader,
  LifecycleRuleId,
  ModuleId,
  ResolverBinding,
  ResolverId,
  WorldAdventurerGenerationRuleId,
} from '../../src/contracts/core';
import type {
  IntegerRangeParams,
  WeightedChoiceParams,
  WeightedDrawParams,
} from '../../src/app/content/character-resolvers';
import { cultureIds, type Authored, type AuthoredDomain } from '../authoring';

const core = cultureIds('core');
const CHARACTER_MODULE = 'character' as ModuleId;

// ── Resolver ID ─────────────────────────────────────────────────────────────
//
// `ResolverId` 是 `Brand<string, 'resolver'>`，**不是** `DefinitionId`，所以用不到 authoring 的
// `definitionId()`（它的型別參數限定在 DefinitionId 家族）。字串形狀沿用既有慣例
// `resolver:<擁有模組>.<用途>`（見 `src/domain-services/statistics` 與 `combat-power` 的宣告）。
// 這裡列出的每一個都必須在 Bootstrap 前註冊，否則 pack 會載入成功而在玩家觸發時才失敗（§11）。
function characterResolver(local: string): ResolverId {
  return `resolver:character.${local}` as ResolverId;
}

const RETIREMENT_RESOLVER = characterResolver('retirement-check');
const NATURAL_DEATH_RESOLVER = characterResolver('natural-death-check');
const BIRTH_ELIGIBILITY_RESOLVER = characterResolver('birth-eligibility');
const BIRTH_OUTCOME_RESOLVER = characterResolver('birth-outcome');
const WORLD_ADVENTURER_ARCHETYPE_WEIGHT_RESOLVER = characterResolver('world-adventurer-archetype-weight');
const WORLD_ADVENTURER_SEX_WEIGHT_RESOLVER = characterResolver('world-adventurer-sex-weight');
const WORLD_ADVENTURER_STARTING_AGE_RESOLVER = characterResolver('world-adventurer-starting-age');
const WORLD_ADVENTURER_INNATE_TRAIT_RESOLVER = characterResolver('world-adventurer-innate-trait');
// 護衛與救援共用同一組：兩者的性別分布與天賦來源在設計文件裡沒有被區分開，而「兩個 kind 各給一個
// 只差名字的 Resolver」會讓註冊表多兩筆卻沒有任何一筆能說出自己為什麼不同。真的要分開調校時，
// 分的是 Resolver 而不是這兩筆規則的其他欄位——那時只需改這兩行。
const TEMPORARY_SEX_WEIGHT_RESOLVER = characterResolver('temporary-sex-weight');
const TEMPORARY_INNATE_TRAIT_RESOLVER = characterResolver('temporary-innate-trait');

// ── 生命週期規則 ────────────────────────────────────────────────────────────
//
// 世界日曆沒有月份與閏年，一年就是 365 日（time_and_mastery_progression.md「一、時間尺度」的
// 「在家休息一年 365 日」；GDD「在家休息一年消耗 365 日」）。年→日只是把設計文件的年齡寫成
// 契約要求的天數單位，不是公式。
const DAYS_PER_YEAR = 365;

const LIFECYCLE_RULE_ID = core.id<LifecycleRuleId>('lifecycle-rule', 'standard');

// `age-modifier-rule` 由 statistics（Derived Statistics）擁有，不是本 domain 的定義。
//
// local 名必須是 **`shared`**，不是 `standard`：擁有者那一筆寫在
// `content-source/core/services.ts`（`servicesDomain`）——
//   const AGE_MODIFIER_RULE_ID = core.id<AgeModifierRuleId>('age-modifier-rule', 'shared');
// 它叫 `shared` 是因為契約上只有一條年齡修正曲線，角色面板與 Combat 必然共用同一條
// （DS §7 不變量 7）。先前這裡寫 `standard`，指向一筆不存在的定義。
//
// **`tsc` 抓不到這種錯**：`AgeModifierRuleId` 是 branded string，`core.id()` 對任何 local 名都
// 產得出合法型別，兩邊要到 Compiler 解析跨 domain 引用（或執行期 `getAgeModifierRule`）才會炸。
// 所以這一行改名時必須跟著 services.ts 改——這是唯一的防線。
const AGE_MODIFIER_RULE_ID = core.id<AgeModifierRuleId>('age-modifier-rule', 'shared');

// core 只有一條生命週期規則，而它同時涵蓋 `characterLifecycleDue` 的三種 token：
//   * `adulthood`        ← `adulthoodAgeDays`（出生後排在 birthDay + 這個值）
//   * `retirementCheck`  ← `retirementResolverId` 存在才排，排在 birthDay + `playableAgeEndDays`
//   * `naturalDeathCheck`← `naturalDeathResolverId`，排在 birthDay + `naturalLifeEndAgeDays`
// 三個門檻各自獨立，缺任何一個都會讓對應那條 lane 整個消失（`retirementResolverId` 是選填的，
// 不給就等於「這種角色不退休」——那必須是刻意的內容決定，所以這裡明確給了）。
//
// 逐欄位來源：
//   adulthoodAgeDays     15 歲。GDD「七、傳承系統／血脈傳承」：「15歲前只能待在家裡，不能加入
//                        隊伍」「15歲成年後成為正式冒險者」。
//   playableAgeStartDays 同 15 歲。成年即是可入隊起點（同上兩句是同一件事的兩面），本版不設
//                        「成年了但還不能當冒險者」的中間期。
//                        **注意：目前沒有任何模組讀這一欄**（`src/modules/character/system.ts`
//                        只讀 adulthoodAgeDays、playableAgeEndDays、naturalLifeEndAgeDays）。
//                        它是契約必填欄位，值必須誠實，但別假設它現在擋得住任何入隊行為——
//                        「未成年不得入隊」目前實際靠的是 adulthoodAgeDays。
//   playableAgeEndDays   55 歲。time_and_mastery_progression.md「世代定位」：「遊戲人生的主要
//                        養成期為 15～55 歲」。退休檢查排在這一天，之後每次由 Resolver 決定
//                        退休或排下一次明確檢查。
//   naturalLifeEndAgeDays 80 歲＝**第一版方案（待討論）**。GDD「六、角色生命週期／老化與死亡」
//                        只寫「角色最終會老死」，沒有給年齡。取 80 的理由：養成期在 55 歲結束後
//                        仍需要一段能當老師、傳授、看著子女成年的期間（GDD 七、八兩節的師徒傳承
//                        與小孩教育都依賴長輩還活著），而 15 歲成年、80 歲自然壽命終點給出 65 年
//                        的一代長度，恰好容得下「子女 15 歲成年時父母 40 歲上下」的兩代重疊。
//                        這是首次檢查的排程點，不是死亡年齡上限——實際是否死亡由 Resolver 決定。
const standardLifecycle: Authored<LifecycleRuleDefinition> = {
  kind: 'lifecycle-rule',
  id: LIFECYCLE_RULE_ID,
  adulthoodAgeDays: 15 * DAYS_PER_YEAR,
  playableAgeStartDays: 15 * DAYS_PER_YEAR,
  playableAgeEndDays: 55 * DAYS_PER_YEAR,
  naturalLifeEndAgeDays: 80 * DAYS_PER_YEAR,
  ageModifierRuleId: AGE_MODIFIER_RULE_ID,
  retirementResolverId: RETIREMENT_RESOLVER,
  naturalDeathResolverId: NATURAL_DEATH_RESOLVER,
};

// ── 角色原型 ────────────────────────────────────────────────────────────────
//
// core 放的是**結構性角色**：四國都需要、而且被引擎或別的模組的資料欄位直接指名的那幾種。
// `CharacterArchetypeDefinition` 沒有名字或稱號欄位，文化差異靠 `cultureId` 與 `innateTraitPoolId`
// 表達——所以 core 版本一律不帶 `cultureId`（base pack 不綁文化，authoring.ts 的 scope 說明），
// 一國要自己的原型就在該國 pack 新增一筆並填上 `cultureId`。
//
// `innateTraitPoolId` 一律省略：`character-trait-pool` 這個 kind 沒有登記擁有模組，也沒有窄化
// Reader，所以天賦池在任何 pack 裡都寫不出來（見回報的契約缺口）。省略是選填欄位的正確用法；
// 填一個指向不存在定義的 ID 才是把缺口藏起來。
//
// `roleTags` 取自 GDD「一、世界模擬系統／NPC模型」的身份標籤（商人、衛兵、冒險者、平民等）。
// 目前沒有任何模組讀這一欄，所以它只是分類鍵；即使如此也不寫成空陣列——空陣列的意思是「這個原型
// 沒有身份」，那對冒險者原型是假的。
const PLAYER_LINEAGE_ARCHETYPE_ID = core.id<CharacterArchetypeId>('character-archetype', 'player-lineage');
const WORLD_ADVENTURER_ARCHETYPE_ID = core.id<CharacterArchetypeId>('character-archetype', 'world-adventurer');
const ESCORT_MERCHANT_ARCHETYPE_ID = core.id<CharacterArchetypeId>('character-archetype', 'escort-merchant');
const ESCORT_COMMONER_ARCHETYPE_ID = core.id<CharacterArchetypeId>('character-archetype', 'escort-commoner');
const RESCUE_CAPTIVE_ARCHETYPE_ID = core.id<CharacterArchetypeId>('character-archetype', 'rescue-captive');

type ArchetypeRow = Readonly<{
  id: CharacterArchetypeId;
  roleTags: readonly CharacterRoleTag[];
  canBecomeAdventurer: boolean;
  temporaryOnly: boolean;
}>;

// 五筆的存在理由逐一對得上一個消費端：
//   player-lineage    Bootstrap 建立初代玩家角色，以及 Birth Rule 生下的子女（GDD 七：子女成年後
//                     成為正式冒險者，未被選為主角的成為 NPC 冒險者——同一個原型即可）。
//   world-adventurer  `WorldAdventurerGenerationRuleDefinition.allowedArchetypeIds`（下方）；
//                     GDD 十一「暴力補齊機制，定期補充新冒險者」。
//   escort-merchant   city 的 `EscortGenerationRuleDefinition.allowedArchetypeIds`。護衛委託對象是
//   escort-commoner   time_and_mastery_progression.md 說的「想移動的非冒險者」，所以
//                     `canBecomeAdventurer: false`；接取後才建立實體，所以 `temporaryOnly: true`
//                     （04_character_module.md §7.1）。分成商人與平民兩筆，是為了讓城市那條生成
//                     規則有一個可加權的池而不是單一結果；兩個標籤都出自 GDD 的身份標籤清單。
//   rescue-captive    map 的 `captiveArchetypeId`。救援目標在地圖上只是 Map Content，救出時才建立
//                     實體，救出後可作為任務暫時隊員隨隊離圖，但不是可招募冒險者
//                     （04_character_module.md §1.3）。
const ARCHETYPE_ROWS: readonly ArchetypeRow[] = [
  { id: PLAYER_LINEAGE_ARCHETYPE_ID, roleTags: ['adventurer'], canBecomeAdventurer: true, temporaryOnly: false },
  { id: WORLD_ADVENTURER_ARCHETYPE_ID, roleTags: ['adventurer'], canBecomeAdventurer: true, temporaryOnly: false },
  { id: ESCORT_MERCHANT_ARCHETYPE_ID, roleTags: ['merchant'], canBecomeAdventurer: false, temporaryOnly: true },
  { id: ESCORT_COMMONER_ARCHETYPE_ID, roleTags: ['commoner'], canBecomeAdventurer: false, temporaryOnly: true },
  { id: RESCUE_CAPTIVE_ARCHETYPE_ID, roleTags: ['commoner'], canBecomeAdventurer: false, temporaryOnly: true },
];

// 五筆原型共用同一條生命週期規則。對三種暫時角色原型來說這不是省事：暫時角色的
// `availability` 是 `temporary`，建立時完全不排生命週期 Job，所以三個門檻對它們一個也不會被讀到；
// 唯一會被讀的是婚姻硬條件的成年判定（`isAdult` 走 archetype → lifecycle → adulthoodAgeDays），
// 而暫時角色的 `birthDay` 是建立當天，因此以標準門檻判定就是「未成年、不得結婚」——正確結果。
// 給它們另一條數字相同的規則只會多一筆沒有任何欄位不同的定義。
function archetype(row: ArchetypeRow): Authored<CharacterArchetypeDefinition> {
  return {
    kind: 'character-archetype',
    id: row.id,
    roleTags: row.roleTags,
    lifecycleRuleId: LIFECYCLE_RULE_ID,
    canBecomeAdventurer: row.canBecomeAdventurer,
    temporaryOnly: row.temporaryOnly,
  };
}

// ── 角色暫時狀態 ────────────────────────────────────────────────────────────
//
// 這是 **`character-status`**（角色身上以世界日計時、可由休息解除的暫時狀態），與 combat 擁有的
// `combat-status`（以行動數計時、只存在於一場 Encounter 內）是兩個 kind、兩個擁有者。同一個中文詞
// 可能兩邊各有一筆，那不是衝突：一筆管戰鬥內的 CTB 與傷害，一筆管戰鬥後留在角色身上的那個狀態。
//
// 清單來源：GDD「十、恢復與暫時狀態」明列「暫時狀態的具體清單（如流血、恐懼、昏沉）」。這三個詞
// 出現在核心系統章節而不是任一國的內容文件，而且是生理／心理狀況而非文化產物，四國一致——所以放
// core，讓四國的技能、道具、事件與地圖陷阱都能引用同一組狀態。一國專屬的狀態（例如某國詛咒魔法
// 特有的狀態）放該國 pack。
//
// **禁止**在此新增 fatigue／stamina／endurance 或任何等價的累積型資源：04_character_module.md
// §2.3 與 GDD 十都明文排除，GDD 十三也把疲勞列在第一版不包含的清單裡。角色的可恢復狀態只有生命、
// 魔力，以及這裡定義的暫時狀態。
//
// `clearByRest` 三筆都是 true：GDD 十「旅館以『恢復狀態』為唯一定位：住宿至少 1 日，恢復生命、
// 魔力，以及可由休息解除的暫時狀態」，而這三項正是它舉的例子。core 沒有 false 的那一側不代表
// 這個欄位不是資料——料理帶來的 FoodStatus 之類「休息不會消失、到期才消失」的狀態屬內容 pack。
//
// `stackPolicy` 三筆各不相同，全部是**第一版方案（待討論）**：設計文件沒有給疊加政策。理由寫在
// 各列後面。改政策只需要改這張表的一格。
//
// `effects: []` 是刻意寫下的空，不是讀不到資料的預設：`StatusDefinition.effects` 的型別是
// `EffectDefinition[]`（整筆定義內嵌，含 header 三欄），而作者層不得自己蓋 `schemaVersion` /
// `packId` / `enabled`，所以這一欄目前在任何 pack 裡都填不出非空值；引擎也沒有任何地方讀它。
// 正確形狀應是 `effectIds: EffectDefinitionId[]`（比照 `ContentEventOptionDefinition.effectIds`）。
// 見回報的契約缺口。狀態本身不因此失效：套用／移除、疊加政策與休息清除都由已接上的欄位驅動。
const BLEEDING_STATUS_ID = core.id<CharacterStatusDefinitionId>('character-status', 'bleeding');
const FEAR_STATUS_ID = core.id<CharacterStatusDefinitionId>('character-status', 'fear');
const DAZE_STATUS_ID = core.id<CharacterStatusDefinitionId>('character-status', 'daze');

type StatusRow = Readonly<{
  id: CharacterStatusDefinitionId;
  clearByRest: boolean;
  stackPolicy: StatusDefinition['stackPolicy'];
}>;

const STATUS_ROWS: readonly StatusRow[] = [
  // 流血：傷口是可數的，多個來源應該各記一層，所以 `stack`。
  { id: BLEEDING_STATUS_ID, clearByRest: true, stackPolicy: 'stack' },
  // 恐懼：同一時間只有一份恐懼，較晚的來源整筆取代較早的（含層數與到期日），所以 `replace`。
  { id: FEAR_STATUS_ID, clearByRest: true, stackPolicy: 'replace' },
  // 昏沉：反覆受擊延長昏沉時間但不加重程度，所以 `refresh`（只延到期日，層數不動）。
  { id: DAZE_STATUS_ID, clearByRest: true, stackPolicy: 'refresh' },
];

function status(row: StatusRow): Authored<StatusDefinition> {
  return {
    kind: 'character-status',
    id: row.id,
    category: 'temporaryCondition',
    clearByRest: row.clearByRest,
    stackPolicy: row.stackPolicy,
    effects: [],
  };
}

// ── 生育規則 ────────────────────────────────────────────────────────────────
//
// 年度休息只是「檢查生育可能」的入口；伴侶條件、機率、子女原型、初始天賦與繼承細節全部由
// 兩個 Resolver 決定（04_character_module.md §2.4 明文禁止 Team 或 UI 偷塞這段邏輯）。
//
// `requiredRestDays: 365` —— 04_character_module.md §2.4 直接寫在欄位註解上（本版為 365），並與
// time_and_mastery_progression.md「一、時間尺度」的「在家休息一年 365 日」、GDD「在家休息一年
// 消耗 365 日，主要用途為取得生育機率」三處一致。寫成 `DAYS_PER_YEAR` 而不是字面 365，是因為它
// 就是「一年」這件事，不是一個恰好等於 365 的獨立數字。
const homeYearRestBirthRule: Authored<BirthRuleDefinition> = {
  kind: 'birth-rule',
  id: core.id<BirthRuleId>('birth-rule', 'home-year-rest'),
  requiredRestDays: DAYS_PER_YEAR,
  eligibilityResolverId: BIRTH_ELIGIBILITY_RESOLVER,
  birthResolverId: BIRTH_OUTCOME_RESOLVER,
};

// ── 任務暫時角色規則 ────────────────────────────────────────────────────────
//
// 兩筆，對應 `TemporaryCharacterOrigin` 的兩個變體（04_character_module.md §3.1、§7.1）：
//   escort  護衛委託對象；接取時建立，抵達／死亡／Quest 到期／護送隊伍戰敗後回收。
//   rescue  救援委託對象；玩家實際救出時才建立，離圖／死亡／Quest 到期後回收。
// 規則本身只指名「性別」與「初始天賦」兩個可變決定由誰負責——原型不在此列，它由 Quest 在
// `CreateQuestTemporaryCharacter` 裡指定（§7.1「護衛資料在任務生成時只有身分原型」）。
const escortTemporaryRule: Authored<TemporaryCharacterRuleDefinition> = {
  kind: 'temporary-character-rule',
  id: core.id<TemporaryCharacterRuleId>('temporary-character-rule', 'escort'),
  temporaryKind: 'escort',
  sexWeightResolverId: TEMPORARY_SEX_WEIGHT_RESOLVER,
  innateTraitResolverId: TEMPORARY_INNATE_TRAIT_RESOLVER,
};

const rescueTemporaryRule: Authored<TemporaryCharacterRuleDefinition> = {
  kind: 'temporary-character-rule',
  id: core.id<TemporaryCharacterRuleId>('temporary-character-rule', 'rescue'),
  temporaryKind: 'rescue',
  sexWeightResolverId: TEMPORARY_SEX_WEIGHT_RESOLVER,
  innateTraitResolverId: TEMPORARY_INNATE_TRAIT_RESOLVER,
};

// ── 世界冒險者生成規則 ──────────────────────────────────────────────────────
//
// GDD「十一、人口系統」：暴力補齊機制，定期補充新冒險者，補齊數量與城市繁榮度／安全度掛鉤。
// 「補幾個」屬 city 的 `PopulationSupplyRuleDefinition`（cadence、batchLimit、targetCountResolverId），
// 它以 `adventurerGenerationRuleId` 指向本筆；「補出來的人長什麼樣」才是這裡。
//
// 04_character_module.md §2.2 最後一條要求輸出必須固定原型、`male | female`、**已成年**的起始年齡
// 與初始天賦，並明文禁止 Character 自行假設 50／50 性別、固定年齡或跨文化共用原型。所以四項全部
// 交給 Resolver，本檔一個數字都不放；起始年齡的下界（成年門檻）由上面那條生命週期規則提供，
// 由 `startingAgeResolverId` 的 params 引用。
//
// `allowedArchetypeIds` 只放 core 的 world-adventurer 一筆。一國要讓自己的酒館出現該國原型時，
// 在該國 pack 新增一筆生成規則（列出自己的 archetype），並在該國城市資料的
// `PopulationSupplyRuleDefinition` 指向它——core 這筆是四國都能用的通用版本，不是唯一版本。
const worldAdventurerGeneration: Authored<WorldAdventurerGenerationRuleDefinition> = {
  kind: 'world-adventurer-generation-rule',
  id: core.id<WorldAdventurerGenerationRuleId>('world-adventurer-generation-rule', 'standard'),
  allowedArchetypeIds: [WORLD_ADVENTURER_ARCHETYPE_ID],
  archetypeWeightResolverId: WORLD_ADVENTURER_ARCHETYPE_WEIGHT_RESOLVER,
  sexWeightResolverId: WORLD_ADVENTURER_SEX_WEIGHT_RESOLVER,
  startingAgeResolverId: WORLD_ADVENTURER_STARTING_AGE_RESOLVER,
  innateTraitResolverId: WORLD_ADVENTURER_INNATE_TRAIT_RESOLVER,
};

// ── 對外引用 ────────────────────────────────────────────────────────────────
//
// 供其他 domain 與各國 pack 引用，不必重打字串：
//   * city 的 `EscortGenerationRuleDefinition.allowedArchetypeIds` → escortMerchant / escortCommoner
//   * map 的 `captiveArchetypeId` → rescueCaptive
//   * quest／content-event 的 `applyStatus` Effect → CHARACTER_STATUS_IDS
export const CHARACTER_ARCHETYPE_IDS = {
  playerLineage: PLAYER_LINEAGE_ARCHETYPE_ID,
  worldAdventurer: WORLD_ADVENTURER_ARCHETYPE_ID,
  escortMerchant: ESCORT_MERCHANT_ARCHETYPE_ID,
  escortCommoner: ESCORT_COMMONER_ARCHETYPE_ID,
  rescueCaptive: RESCUE_CAPTIVE_ARCHETYPE_ID,
} as const;

export const CHARACTER_STATUS_IDS = {
  bleeding: BLEEDING_STATUS_ID,
  fear: FEAR_STATUS_ID,
  daze: DAZE_STATUS_ID,
} as const;

export const CHARACTER_LIFECYCLE_RULE_ID = LIFECYCLE_RULE_ID;

// 本 domain 的資料引用到的 Resolver。pack 的 `requiredResolverIds` 必須包含這幾筆，Bootstrap 才
// 擋得住「pack 用到未註冊的 Resolver」（authoring.ts：漏了會一路載入成功到玩家觸發它為止）。
export const CHARACTER_RESOLVER_IDS: readonly ResolverId[] = [
  RETIREMENT_RESOLVER,
  NATURAL_DEATH_RESOLVER,
  BIRTH_ELIGIBILITY_RESOLVER,
  BIRTH_OUTCOME_RESOLVER,
  WORLD_ADVENTURER_ARCHETYPE_WEIGHT_RESOLVER,
  WORLD_ADVENTURER_SEX_WEIGHT_RESOLVER,
  WORLD_ADVENTURER_STARTING_AGE_RESOLVER,
  WORLD_ADVENTURER_INNATE_TRAIT_RESOLVER,
  TEMPORARY_SEX_WEIGHT_RESOLVER,
  TEMPORARY_INNATE_TRAIT_RESOLVER,
];

// ── 生成 Resolver 的 params ────────────────────────────────────────────────
//
// 四個 Resolver 的可調量。形狀由 `app/content/character-resolvers.ts` 的三個 shape 提供，
// 這裡只給值——那正是「形狀＝程式、調校＝資料」。
//
// 【第一版方案（待討論）】性別 50／50。文件禁止**程式**假設 50／50，不禁止**內容**宣告它；
// 差別在於這一行改得動，寫在 Handler 裡的那個 0.5 改不動。雲華沒有性別偏斜的設定，所以先等權。
//
// 【第一版方案（待討論）】起始年齡 18～35 歲（以日為單位，與 lifecycleRule 同一個尺度）。
// 下界 18 而非成年門檻 15：GDD 說補進來的是「冒險者」，不是剛成年的孩子；上界 35 讓他們在
// 可遊玩年齡上限（55）之前還有二十年的職業生涯。兩個數字都純屬取捨，改這裡即可。
//
// 初始天賦：`character-trait` 這個 kind **沒有任何定義**（core 與雲華都沒有授權天賦），
// 所以 `count: 0`、選項為空——那是一句「這份內容不給天賦」的封閉宣告，不是漏填。
// 有人授權天賦時，把它們列進 options 並把 count 調上去即可，程式不動。
const worldAdventurerArchetypeWeights: Authored<DefinitionHeader & WeightedChoiceParams> = {
  kind: 'weighted-choice-params',
  id: core.id('weighted-choice-params', 'world-adventurer-archetype'),
  options: [{ value: String(WORLD_ADVENTURER_ARCHETYPE_ID), weight: 1 }],
};

const worldAdventurerSexWeights: Authored<DefinitionHeader & WeightedChoiceParams> = {
  kind: 'weighted-choice-params',
  id: core.id('weighted-choice-params', 'world-adventurer-sex'),
  options: [
    { value: 'female', weight: 1 },
    { value: 'male', weight: 1 },
  ],
};

const worldAdventurerStartingAge: Authored<DefinitionHeader & IntegerRangeParams> = {
  kind: 'integer-range-params',
  id: core.id('integer-range-params', 'world-adventurer-starting-age'),
  min: 18 * DAYS_PER_YEAR,
  max: 35 * DAYS_PER_YEAR,
};

const worldAdventurerInnateTraits: Authored<DefinitionHeader & WeightedDrawParams> = {
  kind: 'weighted-draw-params',
  id: core.id('weighted-draw-params', 'world-adventurer-innate-trait'),
  count: 0,
  options: [],
};

export function characterGenerationBindings(): readonly ResolverBinding[] {
  return [
    {
      resolverId: WORLD_ADVENTURER_ARCHETYPE_WEIGHT_RESOLVER,
      ownerModule: CHARACTER_MODULE,
      shape: 'character:weighted-choice',
      paramsDefId: worldAdventurerArchetypeWeights.id,
    },
    {
      resolverId: WORLD_ADVENTURER_SEX_WEIGHT_RESOLVER,
      ownerModule: CHARACTER_MODULE,
      shape: 'character:weighted-choice',
      paramsDefId: worldAdventurerSexWeights.id,
    },
    {
      resolverId: WORLD_ADVENTURER_STARTING_AGE_RESOLVER,
      ownerModule: CHARACTER_MODULE,
      shape: 'character:integer-range',
      paramsDefId: worldAdventurerStartingAge.id,
    },
    {
      resolverId: WORLD_ADVENTURER_INNATE_TRAIT_RESOLVER,
      ownerModule: CHARACTER_MODULE,
      shape: 'character:weighted-draw',
      paramsDefId: worldAdventurerInnateTraits.id,
    },
  ];
}

export const characterDomain: AuthoredDomain = {
  domain: 'character',
  definitions: [
    standardLifecycle,
    ...ARCHETYPE_ROWS.map(archetype),
    ...STATUS_ROWS.map(status),
    homeYearRestBirthRule,
    escortTemporaryRule,
    rescueTemporaryRule,
    worldAdventurerGeneration,
    worldAdventurerArchetypeWeights,
    worldAdventurerSexWeights,
    worldAdventurerStartingAge,
    worldAdventurerInnateTraits,
  ],
};
