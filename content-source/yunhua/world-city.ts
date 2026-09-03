// content-source/yunhua/world-city.ts
// 雲華的**世界節點與城市**：文化、國度、地區、四座城市節點、城際路線、九座冒險點，
// 以及每座城市的十種設施、商店刷新、情報、護衛生成、人口補充、房屋與城市耗時行動。
//
// ── 這一檔的來源分成三層，註解逐筆標明是哪一層 ──────────────────────────────
//
//  【明文】設計來源直接寫出來的事實，照抄：
//     * `docs/03_content/yunhua/yunhua_content.data.mjs` 的 `cultureMeta`
//       （id / name / capital / cities）與 `firstMapConfigs`（每張迷宮的 city、citySlot、
//       isNationalDungeon）。
//     * `docs/03_content/yunhua/yunhua_content.md` §4「雲華四城九迷宮的內容邊界」。
//     * `docs/00_core/game_design_document.md`「十二、城市與國度系統」的城市固定功能表
//       （十種場所，與 `FacilityKind` 的十個值一一對應）、「護衛委託的生成」、
//       「一天的結構」、「八、房子系統」、「十一、人口系統」。
//     * `docs/00_core/architecture/09_city_module.md` §2.2～§2.6 的第一版資料驗證條款。
//
//  【判讀】設計來源以中文散文或表格描述、由我對應到具名欄位的。**逐筆在註解寫出我從哪句讀到
//     什麼**，並列進回報的「散文判讀清單」。這一檔沒有任何 regex 剖析散文——九座迷宮的歸屬
//     與國家迷宮旗標都取自 `firstMapConfigs` 的**結構化欄位**（`city` / `citySlot` /
//     `isNationalDungeon`），不是從 `name` 或 `configuration` 字串猜的。
//
//  【第一版方案（待討論）】設計來源沒有、由我決定的。每一筆都寫出推導理由與待裁決的問題。
//     這一檔是本輪「設計來源最少、判讀最多」的 domain：城市名字、首都、迷宮歸屬是明文，
//     但**地區劃分、城際路線拓樸、商店刷新週期、房屋價格、情報與護衛的判定**全都沒有明文。
//
// ── 刻意**不**寫的東西 ──────────────────────────────────────────────────────
//
//  * `conflict-rule` / `world-fact` / `passage-policy`：core 已經擁有 passage-policy 兩筆
//    （`content-source/core/world-map-dungeon-npc.ts`），本檔只引用；conflict-rule 與 world-fact
//    在 core 被刻意留空並附理由，雲華這邊沒有新資訊可加。
//  * `map-template`：屬 maps domain（本輪另一個 worker）。本檔只**引用**它的 ID，見下方
//    `MAP_TEMPLATE_IDS` 的協調說明。
//  * `content-pool` / `item-pool` / `player-travel-event-pool`：**這三個 kind 都沒有登記**
//    （不在 `ALL_DEFINITION_KINDS` 的 119 筆裡），所以現在沒有任何人寫得出這三種定義。
//    處理方式逐筆見下方；一律列進回報的「契約缺口」。
//  * 六種可擴充功能間（教育間／鍛造間／練藥房／會客室／陳列室／演奏廳）：GDD 十三與
//    09_city_module §2.6 明文把「房間形狀、家具、功能間與升級規則」列為**尚未定案的獨立議題**，
//    且「正式定案前不得由目前欄位反推玩法」。那是「還沒做」而不是「本版不啟用」，
//    依 `authoring.ts` 的說明，還沒做的東西不該出現在 pack 裡。故只寫 room 與 storage 兩筆
//    （GDD 八「初始配置：房間、倉庫」是明文）。

import type {
  AdventureSiteDefinition,
  CityNodeDefinition,
  CultureDefinition,
  NationDefinition,
  PassagePolicyId,
  PlayerTravelEventPoolId,
  RegionDefinition,
  RouteDefinition,
} from '../../src/contracts/world';
import type {
  CityActionRuleDefinition,
  CityDefinition,
  EscortGenerationRuleDefinition,
  FacilityDefinition,
  FacilityKind,
  HomeRuleDefinition,
  HomeUpgradeDefinition,
  IntelRuleDefinition,
  PlayerCommerceDailyLimitDefinition,
  PlayerCommercePracticeRuleDefinition,
  PopulationSupplyRuleDefinition,
  ShopKind,
  ShopRuleDefinition,
} from '../../src/contracts/city';
import type {
  AdventureSiteId,
  CharacterArchetypeId,
  CityActionRuleId,
  CityId,
  EscortGenerationRuleId,
  ExperienceAwardRuleId,
  FacilityDefinitionId,
  HomeRuleId,
  HomeUpgradeDefinitionId,
  IntelRuleId,
  MapTemplateId,
  NationId,
  PlayerCommerceDailyLimitId,
  PlayerCommercePracticeRuleId,
  PopulationSupplyRuleId,
  PriceRuleId,
  PriceModifierRuleId,
  CurrencyId,
  RegionId,
  ResolverId,
  RouteId,
  ShopRuleId,
  WorldAdventurerGenerationRuleId,
} from '../../src/contracts/core';
import {
  cultureIds,
  textKeyFor,
  type Authored,
  type AuthoredDomain,
  type AuthoredText,
  type LocalizedName,
} from '../authoring';
import type { PriceRuleDefinition } from '../../src/contracts/economy';
import { CHARACTER_ARCHETYPE_IDS } from '../core/character';

const yunhua = cultureIds('yunhua');
const core = cultureIds('core');

// ── Resolver ID ─────────────────────────────────────────────────────────────
//
// `ResolverId` 是 `Brand<string,'resolver'>`，**不是** `DefinitionId`：Resolver 由模組擁有、
// 不由文化擁有，所以它沒有文化段，也不走三段內容 ID 規約。格式沿用 repo 既有的
// `resolver:<module>.<local>`（`content-source/core/team.ts`、`core/world-map-dungeon-npc.ts`）。
//
// 這裡出現的每一個都必須列進 `packs.ts` 的 `requiredResolverIds`（整合者的檔），
// 並在回報逐筆列出——漏了會讓「引用未註冊 Resolver」的 pack 一路載入成功，直到玩家觸發它。
function resolverId(local: string): ResolverId {
  return `resolver:city.${local}` as ResolverId;
}

// ════════════════════════════════════════════════════════════════════════════
// 跨定義引用（本檔不擁有這些定義，只引用它們的 ID）
// ════════════════════════════════════════════════════════════════════════════

// core 的通行政策。`content-source/core/world-map-dungeon-npc.ts` 第 80～103 行實測存在這兩筆。
//
// `national-border` 給 Nation：GDD「國度設定」明文「國度間有通行證制度」。
// `domestic-open` 給國內 Route：core 那一筆的註解把「留空＝可通行」與「顯式指向 domestic-open」
// 列為**待裁決的兩種表達**，並說「有了這一筆，國內 Route 可以指向它，把那個決定寫回內容」。
// 本檔選**顯式指向**：雲華四城全在同一國內，六條路線都不需要通行證，而「不需要」是一個內容決定，
// 不該由判定端從 undefined 推出來。若整合者裁定「留空＝可通行」才是既定語意，
// 這六個欄位一併刪掉即可（見回報）。
const PASSAGE_POLICY_NATIONAL_BORDER = core.id<PassagePolicyId>(
  'passage-policy',
  'national-border',
);
const PASSAGE_POLICY_DOMESTIC_OPEN = core.id<PassagePolicyId>('passage-policy', 'domestic-open');

// core 的商店價格規則。`content-source/core/economy-social-distribution.ts` 第 171 行實測存在。
// 三種商店（道具／裝備／書）共用它：`baseValueSource: 'itemDefinition'` 就是「商品的價值來自
// 物品定義」，而三種店賣的都是物品。書店與其他兩店的差別在**目錄**（見下方 baseCatalogPoolId
// 的契約缺口），不在定價方式。
const PRICE_RULE_SHOP_ITEM = core.id<PriceRuleId>('price-rule', 'shop-item');

// core 的交流 MXP 規則。`content-source/core/progression-rules.ts` 第 399 行實測存在，
// 而且那一檔第 380 行的註解**逐字指名**本檔要填的欄位：
// 「`PlayerCommercePracticeRuleDefinition.commerceExperienceRuleId`（city 契約）」。
// local 名帶 `-tier-1` 後綴、用 `shopping` 不是 `commerce`，是提供端定的（同檔第 389 行）。
const COMMERCE_EXPERIENCE_RULE = core.id<ExperienceAwardRuleId>(
  'experience-award-rule',
  'social-shopping-tier-1',
);

// core 的世界冒險者生成規則。`content-source/core/character.ts` 第 306 行實測存在。
// 那一檔第 302 行寫明：「core 這筆是四國都能用的通用版本……一國要讓自己的酒館出現該國原型時，
// 在該國 pack 新增一筆生成規則（列出自己的 archetype），並在該國城市資料的
// `PopulationSupplyRuleDefinition` 指向它」。
//
// 雲華目前**沒有**自己的 `character-archetype`（archetype 不在本輪任何 yunhua domain 的指派裡），
// 所以四座城市都指向 core 的通用版本。要讓雲京酒館出現雲華專屬原型，得先有人擁有
// `character-archetype.yunhua.*`——那是 character domain 的事，不是本檔能補的。
const WORLD_ADVENTURER_GENERATION_RULE = core.id<WorldAdventurerGenerationRuleId>(
  'world-adventurer-generation-rule',
  'standard',
);

// core 的護衛對象原型。直接 import 常數而不是重打字串：`core/character.ts` 第 320 行
// 就是為此匯出的（「供其他 domain 與各國 pack 引用，不必重打字串：city 的
// `EscortGenerationRuleDefinition.allowedArchetypeIds` → escortMerchant / escortCommoner」）。
//
// ⚠ **但這裡刻意只取 escortMerchant，不取 escortCommoner，因為 GDD 與 core 的註解衝突。**
// GDD「護衛委託的生成」第一條逐字寫：「生成資料僅有身分原型，例如富商、貴族等，沒有名字…
// **平民不進入護衛候選池**。」而 `character-archetype.core.escort-commoner` 的 `roleTags` 正是
// `['commoner']`＝平民。把它填進來會直接違反 GDD 的明文。
//
// 於是候選池只剩一筆（富商），而 GDD 舉的第二個例子「貴族」在 core 沒有對應原型。
// 這是 core character domain 的缺口，不是本檔能補的（archetype 不屬本檔）。見回報。
const ESCORT_ARCHETYPE_IDS: readonly CharacterArchetypeId[] = [CHARACTER_ARCHETYPE_IDS.escortMerchant];

// ── 未登記 kind 的引用：`player-travel-event-pool` ──────────────────────────
//
// `RouteDefinition.playerTravelEventPoolId` 是**必填**，型別是
// `DefinitionId<'player-travel-event-pool'>`——而 `player-travel-event-pool` **不在**
// `ALL_DEFINITION_KINDS` 裡（`src/contracts/world/index.ts` 第 41 行自己標了
// 「contracts/core 尚未提供；此處為 provisional 本地宣告」）。
//
// 後果：沒有人寫得出這筆定義，所以這個欄位一定指向不存在的東西。三個選項都不好：
//   (a) 不寫 route          → 四城之間沒有任何連線，`getCityGapCount` 全部 undefined，
//                             城門口與護衛委託整條玩不到。
//   (b) route 標 enabled:false → `listRoutesFrom` 會過濾掉，等於 (a)，但多了一份假資料。
//   (c) 填 ID 並明講它懸空 → 城市網路（地區、鄰接、距離）成立，只有旅行事件池那一個葉節點缺。
// 取 (c)。編譯期的跨引用檢查**不會**抓到它（那道檢查只認第一段是已登記 kind 的字串），
// 所以這件事只有靠這段註解與回報被看見——這正是為什麼它要寫在這裡。
//
// 同一個形狀 core 已經有前例：`core/team.ts` 的 `player-travel-event-weight-profile`
// 也是「填了 ID，但 kind 未登記所以永遠讀不到」，並列進了該檔的契約缺口。
//
// 三種旅行模式各自有自己的權重檔（core/team.ts），但**事件池**只有一份：GDD「一天的結構」說
// 三種模式改變的是「事件權重」，不是可抽到的事件清單。所以雲華國內一份池，不分模式、不分路線。
const YUNHUA_TRAVEL_EVENT_POOL = yunhua.id<PlayerTravelEventPoolId>(
  'player-travel-event-pool',
  'domestic',
);

// ── 本檔的九筆 local 名已對齊 maps domain（整合者裁定）───────────────────────
// 編譯期的跨引用檢查抓到 7 筆對不上（seal-tower 與 cinnabar-ridge 兩邊剛好同名）。
// 依本檔上方自己寫下的原則「擁有者定名、消費端跟隨」——`map-template` 的擁有者是 maps domain——
// 改的是這一邊。對照：waterway→old-canal-sunken-store、calendar-court→calendar-court-ruin、
// mist→mist-bamboo-valley、spring-grotto→hanging-spring-grotto、tidal-marsh→tidal-reed-isle、
// salt-well→salt-well-cellar、kiln-flue→old-kiln-flue。
// `adventure-site` 與 `map-template` 共用同一個 local，所以兩者一起改，仍然成對。
// ── 跨 domain 引用：maps domain 的 map-template ──────────────────────────────
//
// `AdventureSiteDefinition.mapTemplateId` 是必填，而 `map-template` **是**已登記 kind，
// 所以這九筆會被編譯期的跨引用檢查逐筆比對：maps domain 的 local 名對不上，編譯就會指名哪一筆。
// 也就是說這裡「填了但對不上」不會靜默通過——這是我敢在協調完成前就填的唯一理由。
//
// local 名的取法（設計來源沒有給九座迷宮的英文 slug，這是本檔提出的共用詞彙）：
//   * `waterway`  ← 設計來源自己的字。`yunhua_content.md` §5 列 `pool.yunhua.waterway`，
//                   §11.2 列 `gathering.yunhua.waterway-reed` 並標明它屬「舊漕渠與沉倉」。
//   * `seal-tower`← 設計來源自己的字。§5 列 `pool.yunhua.seal-tower`；
//                   `yunhua_content.data.mjs` 有 `monster.yunhua.seal-tower-deserter`（守印逃卒）。
//   * `mist`      ← 設計來源自己的字。§5 列 `pool.yunhua.mist`，§11.2 的
//                   `gathering.yunhua.mist-herb` 標明它屬「霧篁藥谷」。
//   * 其餘六筆設計來源沒有英文字，由迷宮名的**主體名詞**譯出（逐筆見下方 SITE_ROWS 的註解）。
//
// ⚠ **整合者請注意**：maps domain 若用了別的 local 名，正確的修法是**二選一定案**，不是兩邊各改
// 一次（`core/team.ts` 的 `npc-marriage-rule` 就吃過「兩邊都寫『對齊對方』於是永遠差一步」的
// 迴圈）。定案原則：**擁有者定名、消費端跟隨** → `map-template` 的擁有者是 maps domain，
// 所以以 maps domain 為準，改本檔。為了讓 maps domain 可以直接 import 而不重打，
// 下方 `MAP_TEMPLATE_IDS` 匯出這九筆。
function mapTemplateId(local: string): MapTemplateId {
  return yunhua.id<MapTemplateId>('map-template', local);
}

// ════════════════════════════════════════════════════════════════════════════
// 城市（world 側的節點身分）
// ════════════════════════════════════════════════════════════════════════════
//
// 【明文】`cultureMeta.cities = ['雲京','青岑城','澄浦城','赤嶺城']`、`capital: '雲京'`。
// 順序照抄設計來源的陣列順序——下面所有「城市索引」都以它為準，不另排序。
//
// local 名用**拼音**：設計來源自己的 `cultureMeta.id = 'culture.yunhua'` 就是「雲華」的拼音，
// 所以拼音是設計來源已經在用的羅馬化慣例，不是我新發明的。城名是專有地名，音譯比意譯穩定
// （「赤嶺」譯成 red-ridge 會與素材「朱砂」的 cinnabar 混在一起）。
type CityRow = Readonly<{
  /** 設計來源 `cultureMeta.cities` 的原字。只出現在註解與這張表，不進定義。 */
  readonly name: LocalizedName;
  readonly local: string;
  readonly isCapital: boolean;
}>;

const CITY_ROWS: readonly CityRow[] = [
  { name: { 'zh-Hant': '雲京', en: 'Yunjing' }, local: 'yunjing', isCapital: true },
  { name: { 'zh-Hant': '青岑城', en: 'Qingcen' }, local: 'qingcen', isCapital: false },
  { name: { 'zh-Hant': '澄浦城', en: 'Chengpu' }, local: 'chengpu', isCapital: false },
  { name: { 'zh-Hant': '赤嶺城', en: 'Chiling' }, local: 'chiling', isCapital: false },
];

// `city-node` 的定義 id 與 `city` 的定義 id 是**兩個不同的 ID**（`src/app/content/city-reader.ts`
// 第 85 行：「getCity 以 worldCityId 定址，而 Registry 以 definition id 定址；兩者不必相同」）。
// 兩者都遵守 `<kind>.<culture>.<local>`：world 側是 `city-node.yunhua.<local>`，
// city 側是 `city.yunhua.<local>`，而 `CityDefinition.worldCityId` 指回前者。
//
// 型別上兩者都是 `CityId = DefinitionId<'city'>`（`CityNodeDefinition = DefinitionHeader<CityId>`），
// 所以 tsc 分不出來——只有 id 字串的第一段分得出來，而那一段必須等於該筆的 `kind`。
function cityNodeId(local: string): CityId {
  return yunhua.id<CityId>('city-node', local);
}

const CITY_NODE_IDS: Readonly<Record<string, CityId>> = Object.fromEntries(
  CITY_ROWS.map((row) => [row.local, cityNodeId(row.local)]),
);

function cityNodeIdOf(local: string): CityId {
  const found = CITY_NODE_IDS[local];
  if (found === undefined) {
    throw new Error(`world-city：未知的城市 local 名 "${local}"`);
  }
  return found;
}

// ════════════════════════════════════════════════════════════════════════════
// 文化
// ════════════════════════════════════════════════════════════════════════════
//
// 【明文】`cultureMeta.id = 'culture.yunhua'`。`authoring.ts` 的 `cultureIds()` 產出的
// `cultureId` 就是這個兩段形狀（該檔第 108 行明講「設計來源的 cultureMeta.id 已是這個形狀」）。
//
// ⚠ 五個池欄位全部空陣列，這是**契約缺口**而不是「雲華沒有內容池」：
// `ContentPoolId = DefinitionId<'content-pool'>`，而 `content-pool` **不在** 119 個已登記 kind 裡
// （契約自己第 41～43 行標了「contracts/core 尚未提供；此處為 provisional 本地宣告」）。
// 沒有人寫得出 `content-pool.*` 定義，所以：
//   * 填 ID → 五個欄位全部懸空，而且跨引用檢查抓不到（kind 未登記），會是五筆看不見的壞資料。
//   * 留空 → 讀得到、內容為「沒有宣告任何池」，而這句話在「池這個 kind 還不存在」的當下是真的。
// 取留空（指派原文：「寧可留空也不要懸空」）。
//
// 雲華真正的怪物／技能／裝備／物品清單存在於本輪其他 domain 的**具體定義**裡
// （`monster.yunhua.*`、`skill.yunhua.*`…）。缺的只是「把它們收成池」這一層間接，
// 而那一層目前在引擎裡沒有任何讀取路徑（`grep itemPoolIds src/` 只命中契約宣告與一個測試）。
const culture: Authored<CultureDefinition> = {
  kind: 'culture',
  id: yunhua.cultureId,
  itemPoolIds: [],
  nonHumanMonsterPoolIds: [],
  humanEnemyPoolIds: [],
  equipmentPoolIds: [],
  skillPoolIds: [],
};

// ════════════════════════════════════════════════════════════════════════════
// 國度
// ════════════════════════════════════════════════════════════════════════════
//
// 【明文】國名「雲華」（`cultureMeta.name`）；「國度間有通行證制度」（GDD 十二「國度設定」）。
//
// `display.nameRef` 是 `LocalizedTextRef`（`{ key, params? }`），契約註解明訂「名稱一律走本地化
// 引用，不放已翻譯字串」——所以這裡放 key，不放「雲華」。
//
// key 刻意寫成**四段** `text.nation.yunhua.name`：三段式且第一段是已登記 kind 的字串會被
// 跨引用檢查誤判成定義引用（`nation` 正是已登記 kind），`nation.yunhua.name` 會編譯失敗。
// 這是本檔唯一一處需要為了避開那道檢查而選字串形狀的地方。
const nation: Authored<NationDefinition> = {
  kind: 'nation',
  id: yunhua.id<NationId>('nation', 'yunhua'),
  cultureId: yunhua.cultureId,
  passagePolicyId: PASSAGE_POLICY_NATIONAL_BORDER,
  display: { nameRef: { key: 'text.nation.yunhua.name' } },
};

// ════════════════════════════════════════════════════════════════════════════
// 地區
// ════════════════════════════════════════════════════════════════════════════
//
// 【第一版方案（待討論）】**設計來源完全沒有「地區」這一層。** `cultureMeta` 只有國、首都、
// 四城；`worldbuilding.md` §4 明文禁止自己記錄「城市與迷宮的正式數量、名稱、配置」；
// `national_content_catalog.md` 被 `worldbuilding.md` §5 標為「早期發想稿，不是現行內容依據」，
// 所以不採用。
//
// 但 `CityNodeDefinition.regionId` 與 `AdventureSiteDefinition.regionId` 都是必填，所以至少要一筆。
//
// 選「整個雲華一個地區」而不是「每城一個地區」的理由：
//   1. `yunhua_content.md` §4 逐字寫「雲華內容池**不被城市名稱硬切開**」。四個地區會讓
//      `getNativeCulture(regionId)` 有四個入口說同一件事，卻讓人以為它們可以不同。
//   2. 每城一個地區要憑空造四個地區名——那是四筆發明；一個地區只需要沿用國名。
//   3. `RegionControlState` 的用途是戰爭易手（`RegionControlChanged` → 人類敵人池換成佔領國）。
//      §4 只說「人類敵人內容池由目前佔領國選定」，沒有說雲華可以被部分佔領。
//
// 待裁決：若戰爭設計需要「只丟掉邊境一城」，就要拆成多個地區，而拆法（哪幾城一組）是新的
// 設計決定，本檔不預先猜。拆的時候只有這一筆與四筆 city-node 的 regionId 要改。
const REGION_ID = yunhua.id<RegionId>('region', 'yunhua');

// ════════════════════════════════════════════════════════════════════════════
// 冒險點（九座迷宮）
// ════════════════════════════════════════════════════════════════════════════
//
// 【明文】全部取自 `firstMapConfigs` 的**結構化欄位**，不碰散文：
//   * `city`             → `accessCityId`（哪座城通往它）
//   * `citySlot`         → 只用來核對「雲京 3／其餘各 2」，不進定義
//   * `isNationalDungeon`→ `isNationalDungeon`（設計來源只有天衡印塔帶這個欄位，其餘缺席＝false）
// 與 `yunhua_content.md` §4 的表格（「雲京 1／舊漕渠與沉倉」…）一致，兩份來源互相對得上。
//
// local 名見上方 `mapTemplateId` 的說明。`adventure-site` 與 `map-template` 用**同一個 local**：
// 一座冒險點恰對一張地圖版型，兩個 kind 各自加自己的前綴就已經分得開，再各取一套名字只會多一份
// 要對帳的東西。
type SiteRow = Readonly<{
  /** 設計來源 `firstMapConfigs[].name`。只出現在註解與這張表。 */
  readonly name: LocalizedName;
  readonly local: string;
  readonly cityLocal: string;
  readonly citySlot: 1 | 2 | 3;
  readonly isNationalDungeon: boolean;
}>;

const SITE_ROWS: readonly SiteRow[] = [
  // 雲京 1。設計來源已有英文字 `waterway`（§5 的 pool、§11.2 的 gathering rule）。
  { name: { 'zh-Hant': '舊漕渠與沉倉', en: 'Old Canal and Sunken Store' }, local: 'old-canal-sunken-store', cityLocal: 'yunjing', citySlot: 1, isNationalDungeon: false },
  // 雲京 2。設計來源無英文字。「司曆」是掌曆的官署、「殘院」是廢棄院落 → calendar-court。
  { name: { 'zh-Hant': '司曆殘院', en: 'Calendar Court Ruin' }, local: 'calendar-court-ruin', cityLocal: 'yunjing', citySlot: 2, isNationalDungeon: false },
  // 雲京 3，國家迷宮。設計來源已有英文字 `seal-tower`（§5 的 pool、`monster.yunhua.seal-tower-deserter`）。
  { name: { 'zh-Hant': '天衡印塔', en: 'Tianheng Seal Tower' }, local: 'seal-tower', cityLocal: 'yunjing', citySlot: 3, isNationalDungeon: true },
  // 青岑 1。設計來源已有英文字 `mist`（§5 的 pool、§11.2 的 `gathering.yunhua.mist-herb`）。
  { name: { 'zh-Hant': '霧篁藥谷', en: 'Mist Bamboo Herb Valley' }, local: 'mist-bamboo-valley', cityLocal: 'qingcen', citySlot: 1, isNationalDungeon: false },
  // 青岑 2。設計來源無英文字。「懸泉」是懸掛而下的泉、「石窟」是洞窟 → spring-grotto。
  { name: { 'zh-Hant': '懸泉石窟', en: 'Hanging Spring Grotto' }, local: 'hanging-spring-grotto', cityLocal: 'qingcen', citySlot: 2, isNationalDungeon: false },
  // 澄浦 1。設計來源無英文字。§4 把它的類型寫成「水澤型迷宮」、主題「潮溝、蘆島」→ tidal-marsh。
  { name: { 'zh-Hant': '潮生蘆洲', en: 'Tidal Reed Isle' }, local: 'tidal-reed-isle', cityLocal: 'chengpu', citySlot: 1, isNationalDungeon: false },
  // 澄浦 2。設計來源無英文字。「鹽井」是取滷的井 → salt-well。
  { name: { 'zh-Hant': '鹽井封窖', en: 'Sealed Salt Well Cellar' }, local: 'salt-well-cellar', cityLocal: 'chengpu', citySlot: 2, isNationalDungeon: false },
  // 赤嶺 1。設計來源無英文字。「朱砂」是 cinnabar（素材「官朱砂」同字）、「斷嶺」是斷裂的山脊。
  { name: { 'zh-Hant': '朱砂斷嶺', en: 'Cinnabar Ridge' }, local: 'cinnabar-ridge', cityLocal: 'chiling', citySlot: 1, isNationalDungeon: false },
  // 赤嶺 2。設計來源無英文字。「古窯」是廢棄窯場、「火道」是排煙火道 → kiln-flue。
  { name: { 'zh-Hant': '古窯火道', en: 'Old Kiln Flue' }, local: 'old-kiln-flue', cityLocal: 'chiling', citySlot: 2, isNationalDungeon: false },
];

/**
 * 九座冒險點對應的 `map-template` ID。**供 maps domain import**，避免兩邊各打一次字串。
 * key 是 `SiteRow.local`。
 */
export const MAP_TEMPLATE_IDS: Readonly<Record<string, MapTemplateId>> = Object.fromEntries(
  SITE_ROWS.map((row) => [row.local, mapTemplateId(row.local)]),
);

function adventureSiteId(local: string): AdventureSiteId {
  return yunhua.id<AdventureSiteId>('adventure-site', local);
}

function adventureSite(row: SiteRow): Authored<AdventureSiteDefinition> {
  return {
    kind: 'adventure-site',
    id: adventureSiteId(row.local),
    regionId: REGION_ID,
    accessCityId: cityNodeIdOf(row.cityLocal),
    mapTemplateId: mapTemplateId(row.local),
    isNationalDungeon: row.isNationalDungeon,
    display: { nameRef: { key: textKeyFor(adventureSiteId(row.local)) } },
  };
}

const ADVENTURE_SITES: readonly Authored<AdventureSiteDefinition>[] = SITE_ROWS.map(adventureSite);

function siteIdsOfCity(cityLocal: string): readonly AdventureSiteId[] {
  return SITE_ROWS.filter((row) => row.cityLocal === cityLocal).map((row) =>
    adventureSiteId(row.local),
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 城際路線
// ════════════════════════════════════════════════════════════════════════════
//
// 【第一版方案（待討論）】**設計來源沒有任何地理或鄰接資訊**——四座城之間誰接誰、誰在邊境，
// `cultureMeta`、§4 與 `worldbuilding.md` 都沒寫（後者還明文禁止自己記錄城市配置）。
//
// 取**完全圖**（四城兩兩相連，6 條）。理由是設計文件的兩條明文互相支持這個讀法：
//   1. GDD「一天的結構」：玩家旅行是「趕路 3／正常 6／慢行 9 日」——**與距離無關的定額**。
//      如果城市網路要靠多跳才到得了，那 2 跳的「正常」是 6 日還是 12 日？文件從未提過累加，
//      所以定額日數本身就在說「任兩城之間是一趟」。
//   2. GDD 城市固定功能表：「城門口｜選擇趕路、正常或慢行**前往其他城市**」——是「其他城市」，
//      沒有「相鄰城市」這個限定。
// 相對地，星狀（全部經首都）或環狀都必須額外發明「哪兩城不相鄰」，那是設計來源沒有的事實。
//
// 代價寫清楚：完全圖讓 `getCityGapCount` 在雲華境內恆為 1、`listCitiesWithinHops(x,1)` 等於全境。
// 若日後要讓「距離」有意義（例如護衛委託依距離給報酬），就要同時決定拓樸與日數是否隨距離改變——
// 那是一個設計決定，不是補一條路線。
//
// 路線是**無向的一筆**，不是兩筆：`src/modules/world/state.ts` 第 149 行逐字寫
// 「城市網路視為無向：CityNodeDefinition.adjacentRouteIds 兩端都會列出同一條 Route」。
// 所以 6 條路線、每條被兩座城的 `adjacentRouteIds` 各列一次。
type RoutePair = Readonly<{ readonly from: string; readonly to: string }>;

// 兩兩組合，順序照 CITY_ROWS（首都在前）。這是純資料展開，不是規則。
const ROUTE_PAIRS: readonly RoutePair[] = CITY_ROWS.flatMap((a, i) =>
  CITY_ROWS.slice(i + 1).map((b) => ({ from: a.local, to: b.local })),
);

function routeLocal(pair: RoutePair): string {
  return `${pair.from}-${pair.to}`;
}

function routeId(pair: RoutePair): RouteId {
  return yunhua.id<RouteId>('route', routeLocal(pair));
}

function route(pair: RoutePair): Authored<RouteDefinition> {
  return {
    kind: 'route',
    id: routeId(pair),
    fromCityId: cityNodeIdOf(pair.from),
    toCityId: cityNodeIdOf(pair.to),
    // 見上方 YUNHUA_TRAVEL_EVENT_POOL 的說明：kind 未登記，這是已知的懸空引用。
    playerTravelEventPoolId: YUNHUA_TRAVEL_EVENT_POOL,
    passagePolicyId: PASSAGE_POLICY_DOMESTIC_OPEN,
    // 六條國內路線都預設開放。戰爭封路是 `RouteRuntimeState.accessState` 的執行期事實
    // （`SetRouteAccess`），不是內容預設值。
    enabledByDefault: true,
  };
}

const ROUTES: readonly Authored<RouteDefinition>[] = ROUTE_PAIRS.map(route);

function routeIdsOfCity(cityLocal: string): readonly RouteId[] {
  return ROUTE_PAIRS.filter((pair) => pair.from === cityLocal || pair.to === cityLocal).map(routeId);
}

// ════════════════════════════════════════════════════════════════════════════
// 城市節點
// ════════════════════════════════════════════════════════════════════════════
//
// 【明文】`isCapital` 取 `cultureMeta.capital`；`adventureSiteIds` 取 `firstMapConfigs[].city`
// （雲京 3 座、其餘各 2 座，與 §4 的表格一致）。`adjacentRouteIds` 是上面那個拓樸決定的結果。
function cityNode(row: CityRow): Authored<CityNodeDefinition> {
  return {
    kind: 'city-node',
    id: cityNodeIdOf(row.local),
    regionId: REGION_ID,
    adjacentRouteIds: routeIdsOfCity(row.local),
    adventureSiteIds: siteIdsOfCity(row.local),
    isCapital: row.isCapital,
    display: { nameRef: { key: textKeyFor(cityNodeIdOf(row.local)) } },
  };
}

const CITY_NODES: readonly Authored<CityNodeDefinition>[] = CITY_ROWS.map(cityNode);

// 地區：四城與九座冒險點全在其中（見上方「地區」段的單一地區決定）。
const region: Authored<RegionDefinition> = {
  kind: 'region',
  id: REGION_ID,
  nativeNationId: nation.id,
  nativeCultureId: yunhua.cultureId,
  cityIds: CITY_ROWS.map((row) => cityNodeIdOf(row.local)),
  adventureSiteIds: SITE_ROWS.map((row) => adventureSiteId(row.local)),
};

// ════════════════════════════════════════════════════════════════════════════
// 城市耗時行動（`city-action-rule`）
// ════════════════════════════════════════════════════════════════════════════
//
// ⚠ **這個 kind 不在本 domain 的指派清單裡**，但指派同時說「以 `city-reader.ts` 的 KINDS 為準」
// （那裡有 11 個 kind，清單列了 10 個），而且說「`city` 的各種 ruleId 引用 core 已有的通用規則時
// 去讀真實 ID；**core 沒有的才自己建**」。core 目前**沒有任何** city-action-rule
// （`grep "city-action-rule" content-source/core/` 無命中，`packs.ts` 的 declaredKinds 也沒有它），
// 而 `FacilityDefinition.actionRuleIds` 與 `HomeUpgradeDefinition.actionRuleIds` 都是必填。
// 兩個選擇：全部給 `[]`（旅館住宿、城鎮訓練、家中休息三條路一起關掉），或把三個**已有明文天數**
// 的規則寫下來。取後者。
//
// ⚠ 但這三條規則的**天數是文化無關的**（GDD 的全域條款，四國一樣），所以正確的歸屬是 core，
// 不是 yunhua pack。放這裡只是因為現在沒有別人擁有它、而設施必須指得到。**整合者請裁決**：
// 搬進 core 之後本檔改成引用即可（見回報）。
//
// 【明文】天數與教師等級全部有出處：
//   * 「住宿至少消耗 1 日」（GDD 一天的結構）＋「住宿至少 1 日」（09_city §2.5 第一版資料驗證）。
//     **是「至少」不是「固定」**——1 是這句話的下界。core/team.ts 的 `inn-stay` team-plan-rule
//     也取 1，兩邊一致。
//   * 「熟練度傳授／訓練每次消耗 28 日」（GDD 一天的結構）＋「城鎮熟練度訓練固定 28 日，教師等級
//     固定 5」（09_city §2.5）。
//   * 「年度休息固定 365 日」（09_city §2.5）＋「在家休息一年消耗 365 日」（GDD 一天的結構）。
//
// ⚠ **`actionKind: 'homeRest'` 刻意不寫。** GDD 城市固定功能表把家的功能列為「家族、子女教育、
// 熟練度傳授、**休息與休息一年**」——「休息」與「休息一年」是兩件事，但**只有後者有天數**
// （365）。前者的天數在 GDD、09_city_module 與 `time_and_mastery_progression.md` 都查不到。
// 給它一個「看起來合理」的 1 日就是發明玩法（家中休息與旅館住宿誰划算，是平衡決定）。
// 缺一筆規則 → 玩家按不到那個入口，那是規範的合法出口；寫個猜的數字不是。
//
// ── masteryTraining 為什麼是三筆而不是一筆 ──────────────────────────────────
//
// `requiredFacilityKind` 是**單一** FacilityKind，而 GDD 城市固定功能表把訓練拆給三種場所：
//   * 訓練所：「提供戰鬥與魔法熟練度訓練；不傳授技能」
//   * 道具店：「買賣道具、提供相關製作環境與**生活熟練度訓練**」
//   * 裝備店：「買賣裝備、提供**鍛造／裁縫**相關製作環境與熟練度訓練」
// 一筆規則說不出三個設施，所以是三筆——這與 `core/team.ts` 的 `trainRule` 刻意不填
// `requiresCityFacilityKind` 的理由是同一件事（那一檔的註解明講設施門檻歸這裡）。
//
// ⚠ **但「哪些熟練度在哪一間」表達不出來**：`CityActionRuleDefinition` 沒有 masteryId 欄位。
// 所以這三筆只說得出「在哪裡、幾天」，說不出「教什麼」。見回報的契約缺口。
const INN_REST_RULE_ID = yunhua.id<CityActionRuleId>('city-action-rule', 'inn-rest');
const HOME_YEAR_REST_RULE_ID = yunhua.id<CityActionRuleId>('city-action-rule', 'home-year-rest');

const MASTERY_TRAINING_DAYS = 28;

type TrainingRow = Readonly<{ readonly local: string; readonly facilityKind: FacilityKind }>;

const TRAINING_ROWS: readonly TrainingRow[] = [
  { local: 'training-combat-magic', facilityKind: 'trainingGround' },
  { local: 'training-life-craft', facilityKind: 'itemShop' },
  { local: 'training-smith-tailor', facilityKind: 'equipmentShop' },
];

function trainingRuleId(local: string): CityActionRuleId {
  return yunhua.id<CityActionRuleId>('city-action-rule', local);
}

// 三筆訓練共用同一條完成 Resolver：完成語意相同（28 日後依教師等級 5 結算 MXP），
// 不同的只有設施。給三個 Resolver 會讓「同一件事」有三個可以各自漂移的實作。
const TRAINING_COMPLETION_RESOLVER = resolverId('mastery-training-completion');

function trainingRule(row: TrainingRow): Authored<CityActionRuleDefinition> {
  return {
    kind: 'city-action-rule',
    id: trainingRuleId(row.local),
    actionKind: 'masteryTraining',
    // 受訓的是**一名**成員（GDD：訓練改變該角色的熟練度 MXP），不是整隊。
    scope: 'member',
    durationDays: MASTERY_TRAINING_DAYS,
    requiredFacilityKind: row.facilityKind,
    completionResolverId: TRAINING_COMPLETION_RESOLVER,
  };
}

const innRestRule: Authored<CityActionRuleDefinition> = {
  kind: 'city-action-rule',
  id: INN_REST_RULE_ID,
  actionKind: 'innRest',
  // 【判讀】住宿推進世界日，整隊一起過夜：`core/team.ts` 把 `inn-stay` 掛在
  // `planKind: 'cityFacilityAction'`（TeamPlan＝隊伍級），而 `FacilityRestCompleted` 帶的是
  // `characterIds` 複數。兩者一致指向 team scope。
  scope: 'team',
  durationDays: 1,
  requiredFacilityKind: 'inn',
  completionResolverId: resolverId('inn-rest-completion'),
};

const homeYearRestRule: Authored<CityActionRuleDefinition> = {
  kind: 'city-action-rule',
  id: HOME_YEAR_REST_RULE_ID,
  actionKind: 'homeYearRest',
  // 【判讀】GDD：「在家休息一年消耗 365 日，主要用途為取得生育機率」——生育需要伴侶雙方，
  // 而 `core/team.ts` 的 `home-year-rest` 也是 planKind `homeRest` 的 TeamPlan。故 team scope。
  scope: 'team',
  durationDays: 365,
  requiredFacilityKind: 'home',
  completionResolverId: resolverId('home-year-rest-completion'),
};

const CITY_ACTION_RULES: readonly Authored<CityActionRuleDefinition>[] = [
  innRestRule,
  ...TRAINING_ROWS.map(trainingRule),
  homeYearRestRule,
];

// ════════════════════════════════════════════════════════════════════════════
// 房屋
// ════════════════════════════════════════════════════════════════════════════
//
// 【明文】GDD 八「初始配置：房間（休息、生育）、倉庫」——這正是 `initialUpgradeIds` 的契約註解
// 寫的「房間、倉庫」。所以只有這兩筆 home-upgrade。
//
// 【第一版方案（待討論）】`slotCost` 兩筆都取 1。設計來源沒有任何 slot 數字，而 09_city §2.6
// 明文「Slot 意義……必須另案討論；正式定案前不得由目前欄位反推玩法」。取 1 的理由是它是
// 「每個功能間佔一格」這個最小、不編碼任何相對成本的說法——給倉庫 2、房間 1 就等於宣稱了一個
// 還沒定案的相對價目表。
const HOME_UPGRADE_ROOM_ID = yunhua.id<HomeUpgradeDefinitionId>('home-upgrade', 'room');
const HOME_UPGRADE_STORAGE_ID = yunhua.id<HomeUpgradeDefinitionId>('home-upgrade', 'storage');

const homeRoomUpgrade: Authored<HomeUpgradeDefinition> = {
  kind: 'home-upgrade',
  id: HOME_UPGRADE_ROOM_ID,
  // `upgradeKind`（不是 `kind`）才是領域變體欄位；`kind` 是 registry 家族宣告。
  // 契約第 169 行逐字寫了這顆雷：「`'room'` 作為一個全遊戲唯一的 Definition kind 顯然不對」。
  upgradeKind: 'room',
  slotCost: 1,
  // 房間承載「休息一年（生育）」。GDD 八：「房間（休息、生育）」。
  // 一般「休息」沒有天數（見上方 city-action-rule 段的說明），所以這裡只有 365 日那一筆。
  actionRuleIds: [HOME_YEAR_REST_RULE_ID],
  // 初始配置隨房屋附帶，沒有單獨售價 → 不填 priceRuleId（它是選填）。
};

const homeStorageUpgrade: Authored<HomeUpgradeDefinition> = {
  kind: 'home-upgrade',
  id: HOME_UPGRADE_STORAGE_ID,
  upgradeKind: 'storage',
  slotCost: 1,
  // 倉庫是「可供超載處理使用的家中倉庫」（09_city §2.6），存取物品不消耗世界日
  // （GDD：城內互動不消耗時間），所以沒有耗時行動。空陣列在這裡是「這個功能間不含耗時行動」，
  // 不是「忘了填」。
  actionRuleIds: [],
};

// ── 買房 ────────────────────────────────────────────────────────────────────
//
// 這裡原本刻意留空（「買房本版不啟用」），理由是契約表達不出房價：`PriceRuleDefinition.baseValueSource`
// 只有物品／Offer／報酬／服務四種，一棟房子哪一種都不是，而 GDD §八「買房時決定 Slot 數量
// （**越大越貴**）」要的正是「slot 數 → 價格」這條對應。
//
// **缺口已補**：契約新增第五種來源 `ruleFixedAmount`，價格住在 Price Rule 自己的 `baseAmount` 上，
// 一個 slot 數一條規則。於是「越大越貴」是內容的宣告，不是程式的公式。
//
// 【第一版方案（待討論）】slot 數與價格 GDD 都沒有給數字（§十二明講房間形狀、家具、功能間與
// 升級規則「屬獨立大議題，尚未定案」）。下面三檔是可玩的第一版：2／4／6 格，價格線性偏陡，
// 讓「要不要買大的」是一個真的取捨。改它們不需要動任何程式。
// 跨 domain 引用：貨幣與個人交易加成修正都由 core 擁有（見 content-source/core）。
const CORE_CURRENCY_ID = 'currency.core.standard' as CurrencyId;
const PERSONAL_TRADE_BONUS_BUY_ID =
  'price-modifier-rule.core.personal-trade-bonus-buy' as PriceModifierRuleId;

type HomeSizeRow = Readonly<{ slotCount: number; price: number }>;

const HOME_SIZE_ROWS: readonly HomeSizeRow[] = [
  { slotCount: 2, price: 4000 },
  { slotCount: 4, price: 12000 },
  { slotCount: 6, price: 28000 },
];

function homePriceRuleId(slotCount: number): PriceRuleId {
  return yunhua.id<PriceRuleId>('price-rule', `home-slot-${slotCount}`);
}

const HOME_PRICE_RULES: readonly Authored<PriceRuleDefinition>[] = HOME_SIZE_ROWS.map((row) => ({
  kind: 'price-rule',
  id: homePriceRuleId(row.slotCount),
  // 資產：價格住在規則自己身上（見契約說明）。
  baseValueSource: 'ruleFixedAmount',
  baseAmount: { currencyId: CORE_CURRENCY_ID, amount: row.price },
  // 買房套用與商店同一條個人交易加成；賣房本版不開放，所以沒有 sell 修正。
  buyModifierIds: [PERSONAL_TRADE_BONUS_BUY_ID],
  sellModifierIds: [],
  roundingPolicy: 'nearest',
  minimumPrice: 1,
}));

const homeRule: Authored<HomeRuleDefinition> = {
  kind: 'home-rule',
  id: yunhua.id<HomeRuleId>('home-rule', 'standard'),
  purchasableSlotCounts: HOME_SIZE_ROWS.map((row) => row.slotCount),
  purchasePriceRuleIds: Object.fromEntries(
    HOME_SIZE_ROWS.map((row) => [row.slotCount, homePriceRuleId(row.slotCount)]),
  ),
  initialUpgradeIds: [HOME_UPGRADE_ROOM_ID, HOME_UPGRADE_STORAGE_ID],
  // `allowedUpgradeIds` 仍為空：六種功能間是**還沒設計**（GDD §十二明列為未定案），
  // 不是本版關閉。與買房不同，這一項沒有契約缺口可補。
  allowedUpgradeIds: [],
};

// ════════════════════════════════════════════════════════════════════════════
// 玩家買賣上限與交流練習
// ════════════════════════════════════════════════════════════════════════════
//
// 【明文】「玩家主角每日另有最多 6 次**買賣**上限……成功提交的商店買入／賣出各計一次」
// （GDD 十二「隊員交流、好感與婚姻」）；09_city §2.2「資料驗證必須固定上限為 6，避免各城市以
// 資料意外放大可刷交流熟練度的次數」。契約也把它寫成字面型別 `6`，所以這個值是型別強制的。
//
// 兩筆都是**全域一份、四城共用**：上限是「每玩家每日」而不是「每城市」（09_city §2.2 逐字：
// 「這是玩家主角本人專用的交易上限，不是整個玩家隊伍共用，也不是每名隊員各有六次」）。
// 每城各發一筆會讓四份定義看起來可以不同，而那正是那條驗證要防的事。
const commerceDailyLimit: Authored<PlayerCommerceDailyLimitDefinition> = {
  kind: 'player-commerce-daily-limit',
  id: yunhua.id<PlayerCommerceDailyLimitId>('player-commerce-daily-limit', 'standard'),
  maxCommerceInteractionsPerDay: 6,
};

const commercePracticeRule: Authored<PlayerCommercePracticeRuleDefinition> = {
  kind: 'player-commerce-practice-rule',
  id: yunhua.id<PlayerCommercePracticeRuleId>('player-commerce-practice-rule', 'standard'),
  commerceExperienceRuleId: COMMERCE_EXPERIENCE_RULE,
};

// ════════════════════════════════════════════════════════════════════════════
// 情報
// ════════════════════════════════════════════════════════════════════════════
//
// `IntelRuleDefinition` 只有一個欄位 `resolverId`（契約第 201 行：「doc 只說明 Intel Rule 由
// reader 引用，未給欄位；以『揭露判定交給 Resolver』的最小形狀宣告」）。
//
// 四城共用一筆：規則本身只說「用哪個判定」，而各城的情報**內容**是 `IntelLead` 執行期實體
// （來源是 `ContentInstanceId`），不是這條規則。四筆內容相同的定義只會讓人以為它們可以不同。
const intelRule: Authored<IntelRuleDefinition> = {
  kind: 'intel-rule',
  id: yunhua.id<IntelRuleId>('intel-rule', 'standard'),
  resolverId: resolverId('intel-reveal'),
};

// ════════════════════════════════════════════════════════════════════════════
// 每城一份的規則：商店刷新、護衛生成、人口補充
// ════════════════════════════════════════════════════════════════════════════
//
// 這三種規則都帶「城市偏移日」，所以**必須每城一筆**——四城共用一筆就等於四城同一天結算，
// 而 GDD 明文要求錯開。
//
// 城市索引 = `CITY_ROWS` 的順序（＝設計來源 `cultureMeta.cities` 的順序）。這是設計來源唯一提供
// 的城市排序事實；任何別的排法都是額外發明。
const CITY_INDEX: Readonly<Record<string, number>> = Object.fromEntries(
  CITY_ROWS.map((row, index) => [row.local, index]),
);

function cityIndexOf(cityLocal: string): number {
  const found = CITY_INDEX[cityLocal];
  if (found === undefined) {
    throw new Error(`world-city：未知的城市 local 名 "${cityLocal}"`);
  }
  return found;
}

// 【明文】週期 7 日、每城一個 0～6 日偏移：GDD「護衛委託的生成」逐字寫「每座城市各自分配一個
// 0～6 日的週期偏移；每 7 日只在自己的固定日結算一次護衛候選，**避免所有城市在同一天生成與
// 運算**」。契約也把 `cadenceDays` 寫成字面型別 `7`。
//
// 【第一版方案（待討論）】具體偏移值 = 城市索引 × 2（0／2／4／6）。文件只給值域與目的，沒給值。
// 取 ×2 而不是 ×1 的理由就是那句「避免所有城市在同一天」：四座城在 7 日窗內取 0/2/4/6 是最大
// 間隔，取 0/1/2/3 會讓四城擠在前四天、後三天全空。
function escortOffsetDays(cityLocal: string): number {
  return cityIndexOf(cityLocal) * 2;
}

// 【明文】`candidateCount` 0～5：GDD「每次結算隨機產生 0～5 名想移動的非冒險者；目前 `5` 是基礎
// 上限」。契約寫成字面型別 `{ min: 0; max: 5 }`，所以這兩個值是型別強制的。
//
// ⚠ `deadlineResolverId` **刻意不填**。GDD「護衛委託的生成」最後一條逐字寫：
// 「目的地選擇、接受期限與實際結束期限**尚未定義，不自行假設**。」
// 而 09_city §2.4 明文給了這個狀態的正式表達：「目的地與期限仍未定案時，`deadlineResolverId`
// 可以缺省；此時資料驗證允許載入，但**不得啟用護衛候選生成**。」
// 這正是規範五個合法出口的第 3 項，而且是文件自己指定的表達方式，所以缺席是正確資料而不是漏填。
//
// `destinationResolverId` 是必填，所以還是得指名一個——目的地規則同樣「尚未定義」，
// 那個未定義住在 Resolver 的實作與 params 裡，不在本檔。它未註冊，所以護衛生成無論如何都不會啟用。
function escortRule(cityLocal: string): Authored<EscortGenerationRuleDefinition> {
  return {
    kind: 'escort-generation-rule',
    id: yunhua.id<EscortGenerationRuleId>('escort-generation-rule', cityLocal),
    cadenceDays: 7,
    cityOffsetDays: escortOffsetDays(cityLocal),
    candidateCount: { min: 0, max: 5 },
    allowedArchetypeIds: [...ESCORT_ARCHETYPE_IDS],
    destinationResolverId: resolverId('escort-destination'),
  };
}

// ── 商店刷新 ────────────────────────────────────────────────────────────────
//
// 【明文】`permanentStockOfferCount` 取 `{ min: 1, max: 2 }`：09_city §2.3 的契約註解逐字寫
// 「// 第一版 1..2」。三種 `ShopKind`（item／equipment／book）對應 GDD 城市固定功能表的
// 道具店／裝備店／書店。
//
// 【第一版方案（待討論）】`refreshCadenceDays: 7`。設計來源沒有商店刷新週期。取 7 的理由：
// 這份契約裡**唯一被文件釘住的週期**就是護衛生成的 7 日（`cadenceDays: 7` 是字面型別），
// 世界只需要一個節奏；另立一個 10 日或 30 日等於發明第二個曆。
//
// 【第一版方案（待討論）】`refreshOffsetDays` = 城市索引 × 2，與該城的護衛偏移**同日**。
// 理由：偏移的目的是錯開城市之間，不是錯開同一城內的設施。同城三店同日刷新＝那座城有一個
// 「市日」，是玩家記得住的節奏；讓三店各自錯開只會多兩個沒有來源的數字。
//
// 【第一版方案（待討論）】`clearPlayerSoldOnRefresh: true`。設計來源沒有明文，但契約自己指向這個
// 答案：`CityOutboundInternalCommand` 列了 `RemoveItemInstance` 並註明用途是「清除**到期的**
// playerSold 實體」，`ShopOffer.state` 也有 `'expired'`。若 playerSold 永不清除，這兩者都沒有觸發
// 時機，而每間店會變成無上限的寄賣倉。相對地 permanentStock 明文「未售出的 permanentStock Offer
// 刷新後回到永久庫存，不得消失」（09_city §8.1），兩者處置不同是文件本來就分開的。
//
// ⚠ `baseCatalogPoolId` **刻意不填**（它是選填）。`ItemPoolId = DefinitionId<'item-pool'>`，
// 而 `item-pool` **不在** 119 個已登記 kind 裡（契約第 55 行自己標了「contracts/core 尚未提供，
// 本地宣告」）。填進去就是一筆跨引用檢查抓不到的懸空引用。
// 代價：三間店本版只有 1～2 筆永久庫存 Offer，沒有目錄商品；書店因此賣不出任何基礎書
// （09_city §2.3 的「書店的 baseCatalogPoolId 只能包含基礎技能書與基礎製作書」目前無處可寫）。
// 這是本檔最大的功能缺口，見回報。
const SHOP_KINDS: readonly ShopKind[] = ['item', 'equipment', 'book'];

// 三種 ShopKind 開在哪一種設施。GDD 城市固定功能表的明文對應：
// 道具店「買賣道具」／裝備店「買賣裝備」／書店「販售技能與鍛造／製作內容的基礎書籍」。
const SHOP_FACILITY_KIND: Readonly<Record<ShopKind, FacilityKind>> = {
  item: 'itemShop',
  equipment: 'equipmentShop',
  book: 'bookstore',
};

// ── 人口補充 ────────────────────────────────────────────────────────────────
//
// 【明文】GDD 十一：「採用暴力補齊機制，定期補充新冒險者」「補齊數量與城市繁榮度/安全度掛鉤」。
// 「掛鉤」的算法是 `targetCountResolverId` 的事（09_city §2.4：「只在固定批次比較目前冒險者供給、
// 繁榮與安全，缺多少才發出多少需求」），不是本檔的數字。
//
// 【第一版方案（待討論）】`cadenceDays: 28`。文件只說「定期」。取 28 而不是 7 的理由：
// 這條規則產出的是**長期存在的世界實體**（一名冒險者會活幾十年），與每週到期重抽的 Offer／護衛
// 候選不是同一類節奏。用同樣的 7 日去產生永久居民，會讓世界人口以四倍於任何既有節奏的速度堆積。
// 28 是這個專案已有的最長週期性單位（訓練／傳授 28 日），一年 13 次／城。
//
// 【第一版方案（待討論）】`cityOffsetDays` = 城市索引 × 7（0／7／14／21）。在 28 日窗內把四城
// 分到四個不同的星期，每週恰有一座城結算——同一條「錯開結算」的理由，換成 28 日的窗。
//
// 【第一版方案（待討論）】`batchLimit: 5`。文件沒有給批次上限。取 5 是為了不引進第二個量級：
// 契約已經把同類的「每城每批人數」釘在 0～5（護衛候選的字面型別 `{ min: 0; max: 5 }`），
// 讓人口補充落在同一個量級是最小的假設。這個值是最該被平衡討論的一筆：它直接決定酒館可招募
// 人數的上限成長速度。
const POPULATION_CADENCE_DAYS = 28;
const POPULATION_BATCH_LIMIT = 5;

function populationRule(cityLocal: string): Authored<PopulationSupplyRuleDefinition> {
  return {
    kind: 'population-supply-rule',
    id: yunhua.id<PopulationSupplyRuleId>('population-supply-rule', cityLocal),
    cadenceDays: POPULATION_CADENCE_DAYS,
    cityOffsetDays: cityIndexOf(cityLocal) * 7,
    targetCountResolverId: resolverId('population-target-count'),
    batchLimit: POPULATION_BATCH_LIMIT,
    adventurerGenerationRuleId: WORLD_ADVENTURER_GENERATION_RULE,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// 設施（每城十種）
// ════════════════════════════════════════════════════════════════════════════
//
// 【明文】十種場所與各自的功能全部取自 GDD 十二「城市固定功能（第一版）」的表格，並且
// 09_city_module 第 98 行逐字重述：「**所有城市使用相同十種場所種類**；城市差異由資料目錄、
// 教師項目、情報、Offer、互動角色與對應冒險地形成，不新增隱藏的城市專屬系統入口。」
// 所以「每座城有哪些設施」**不是判讀**——是明文，而且恰好等於 `FacilityKind` 的十個值。
//
// 設施定義是**每城一筆**（`CityDefinition.facilityIds` 逐城列出，`FacilityRuntimeState` 也以
// `FacilityDefinitionId` 為 key），所以 4 城 × 10 種 = 40 筆。
//
// 【明文】`teacherMasteryLevel: 5`：GDD 十二「城鎮教師的對應熟練度固定為 Lv.5」；
// 09_city §2.5「城鎮熟練度訓練固定 28 日，教師等級固定 5」；`CityTrainingCompleted.teacherLevel`
// 更是字面型別 `5`。只有**提供訓練的三種設施**有教師：訓練所、道具店、裝備店。
// 其餘七種不填——契約註解明訂「缺了代表『這個設施沒有教師』，不是『教師等級未知』」。
// 書店特別要注意：GDD「書店不提供技能傳授」，所以它**沒有**教師。
//
// `actionRuleIds` 為空的五種（酒館、冒險者公會、書店、冒險者關卡、城門口）也是明文而非漏填：
// 09_city §2.5 第一版資料驗證最後一條逐字寫「買賣、接／回報委託、聊天與探聽等沒有另行指定耗時的
// 城內互動為 0 日，**不建立假 TeamPlan**」。冒險者關卡與城門口的 1 日／3-6-9 日則歸 team
// （`team-plan-rule.core.enter-adventure-map` / `return-to-city` / `player-travel-mode.*`），
// 不是城市耗時行動。
type FacilityRow = Readonly<{
  readonly facilityKind: FacilityKind;
  /** 設施名稱。四座城共用同一個 nameRef（酒館就叫「酒館」），故 key 依 facilityKind 而非 facilityId。 */
  readonly name: LocalizedName;
  /** ID 的第三段用的 kebab 名。 */
  readonly local: string;
  /** 這座設施承載哪些城市耗時行動。 */
  readonly actionRuleIds: readonly CityActionRuleId[];
  /** 有常駐教師的設施才有值（GDD：固定 Lv.5）。 */
  readonly teacherMasteryLevel?: 5;
}>;

const FACILITY_ROWS: readonly FacilityRow[] = [
  // 旅館：「住宿至少 1 日，恢復生命、魔力與可由休息解除的暫時狀態。」
  { facilityKind: 'inn', local: 'inn', name: { 'zh-Hant': '旅館', en: "Inn" }, actionRuleIds: [INN_REST_RULE_ID] },
  // 酒館：「探聽情報、遇見與互動冒險者。」聊天與探聽不消耗時間。
  { facilityKind: 'tavern', local: 'tavern', name: { 'zh-Hant': '酒館', en: "Tavern" }, actionRuleIds: [] },
  // 冒險者公會：「接取與交付委託。」不消耗時間。
  { facilityKind: 'adventurerGuild', local: 'adventurer-guild', name: { 'zh-Hant': '冒險者公會', en: "Adventurer's Guild" }, actionRuleIds: [] },
  // 道具店：「買賣道具、提供相關製作環境與生活熟練度訓練。」
  {
    facilityKind: 'itemShop',
    local: 'item-shop',
    name: { 'zh-Hant': '道具店', en: "Item Shop" },
    actionRuleIds: [trainingRuleId('training-life-craft')],
    teacherMasteryLevel: 5,
  },
  // 裝備店：「買賣裝備、提供鍛造／裁縫相關製作環境與熟練度訓練。」
  {
    facilityKind: 'equipmentShop',
    local: 'equipment-shop',
    name: { 'zh-Hant': '裝備店', en: "Equipment Shop" },
    actionRuleIds: [trainingRuleId('training-smith-tailor')],
    teacherMasteryLevel: 5,
  },
  // 訓練所：「提供戰鬥與魔法熟練度訓練；不傳授技能。」
  {
    facilityKind: 'trainingGround',
    local: 'training-ground',
    name: { 'zh-Hant': '訓練所', en: "Training Ground" },
    actionRuleIds: [trainingRuleId('training-combat-magic')],
    teacherMasteryLevel: 5,
  },
  // 書店：「販售技能與鍛造／製作內容的基礎書籍。」不提供傳授 → 無教師、無耗時行動。
  { facilityKind: 'bookstore', local: 'bookstore', name: { 'zh-Hant': '書店', en: "Bookstore" }, actionRuleIds: [] },
  // 冒險者關卡：「前往或返回本城對應的冒險地圖。」1 日／1 日歸 team-plan-rule。
  { facilityKind: 'adventureCheckpoint', local: 'adventure-checkpoint', name: { 'zh-Hant': '冒險者關卡', en: "Adventure Checkpoint" }, actionRuleIds: [] },
  // 城門口：「選擇趕路、正常或慢行前往其他城市。」3／6／9 日歸 player-travel-mode。
  { facilityKind: 'cityGate', local: 'city-gate', name: { 'zh-Hant': '城門口', en: "City Gate" }, actionRuleIds: [] },
  // 家：「家族、子女教育、熟練度傳授、休息與休息一年。」
  // 熟練度傳授是**個人自由行動**（`free-action-rule.core.teach`，requiresCityFacilityKind: 'home'）
  // 與隊伍教學崗位（`team-plan-rule.core.home-teaching-post`），不是 city-action-rule；
  // 子女教育是 `child-study` TeamPlan。所以家在 city 側只承載 365 日的年度休息。
  { facilityKind: 'home', local: 'home', name: { 'zh-Hant': '家', en: "Home" }, actionRuleIds: [HOME_YEAR_REST_RULE_ID] },
];

// 設施名稱的 key 以 facilityKind 為單位（見 facility() 的說明）。
function facilityKindTextKey(row: FacilityRow): string {
  return textKeyFor(`facility-kind.${yunhua.culture}.${row.local}`);
}

function facilityId(cityLocal: string, facilityLocal: string): FacilityDefinitionId {
  return yunhua.id<FacilityDefinitionId>('facility', `${cityLocal}-${facilityLocal}`);
}

function facility(cityLocal: string, row: FacilityRow): Authored<FacilityDefinition> {
  const base = {
    kind: 'facility' as const,
    id: facilityId(cityLocal, row.local),
    // `facilityKind`（不是 `kind`）才是領域變體欄位。契約第 95 行記錄了這顆雷的歷史：
    // 「原本這裡是 `kind: FacilityKind`，於是一筆設施定義同時被要求是 `'facility'`（給 Reader
    // 窄化）和 `'inn'`（給領域判斷）——JSON 裡只有一個 kind 欄位，兩者不可能同時成立。」
    facilityKind: row.facilityKind,
    actionRuleIds: [...row.actionRuleIds],
    // 名稱掛在 facilityKind 而非個別設施：雲華四城的酒館都叫「酒館」，四筆定義共用一個 key。
    // 要讓某城的酒館有專名，就給那一筆自己的 key——那是內容的選擇，不需要改程式。
    display: { nameRef: { key: facilityKindTextKey(row) } },
  };
  // 沒有教師的設施**不帶**這個欄位（缺席＝沒有教師），所以不能寫成 `teacherMasteryLevel: undefined`。
  return row.teacherMasteryLevel === undefined
    ? base
    : { ...base, teacherMasteryLevel: row.teacherMasteryLevel };
}

function shopRuleId(cityLocal: string, shopKind: ShopKind): ShopRuleId {
  return yunhua.id<ShopRuleId>('shop-rule', `${cityLocal}-${shopKind}`);
}

function shopRule(cityLocal: string, shopKind: ShopKind): Authored<ShopRuleDefinition> {
  const facilityRow = FACILITY_ROWS.find(
    (row) => row.facilityKind === SHOP_FACILITY_KIND[shopKind],
  );
  if (facilityRow === undefined) {
    throw new Error(`world-city：ShopKind "${shopKind}" 找不到對應設施`);
  }
  return {
    kind: 'shop-rule',
    id: shopRuleId(cityLocal, shopKind),
    shopKind,
    // 這條規則管的是**哪一間店面**（契約第 121 行：少了這個欄位就只能在 Handler 裡寫一張
    // shopKind → FacilityKind 對照表，而跨資料對照屬於資料）。對照表在上面的
    // `SHOP_FACILITY_KIND`，是內容資料的一部分。
    facilityId: facilityId(cityLocal, facilityRow.local),
    refreshCadenceDays: 7,
    refreshOffsetDays: cityIndexOf(cityLocal) * 2,
    permanentStockOfferCount: { min: 1, max: 2 },
    priceRuleId: PRICE_RULE_SHOP_ITEM,
    clearPlayerSoldOnRefresh: true,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// 城市定義
// ════════════════════════════════════════════════════════════════════════════
//
// `id` 是 `city.yunhua.<local>`，`worldCityId` 是 `city-node.yunhua.<local>`——**兩個不同的 ID**
// （見上方 `cityNodeId` 的說明）。`getCity` 以後者定址，重複的 worldCityId 會在建立 Reader 的當下
// （＝Bootstrap）就拋錯，所以每城恰好一筆。
function city(row: CityRow): Authored<CityDefinition> {
  return {
    kind: 'city',
    id: yunhua.id('city', row.local),
    worldCityId: cityNodeIdOf(row.local),
    facilityIds: FACILITY_ROWS.map((facilityRow) => facilityId(row.local, facilityRow.local)),
    shopRuleIds: SHOP_KINDS.map((shopKind) => shopRuleId(row.local, shopKind)),
    intelRuleId: intelRule.id,
    escortGenerationRuleId: yunhua.id<EscortGenerationRuleId>(
      'escort-generation-rule',
      row.local,
    ),
    homeRuleId: homeRule.id,
    populationSupplyRuleId: yunhua.id<PopulationSupplyRuleId>(
      'population-supply-rule',
      row.local,
    ),
    playerCommerceDailyLimitId: commerceDailyLimit.id,
    playerCommercePracticeRuleId: commercePracticeRule.id,
    // `ApplyCityMetricEffect` 只帶 EffectDefinitionId，沒帶「怎麼把該 Effect 換成繁榮／安全數值」。
    // 那個換算（含資料上下限）由 Resolver 提供，由哪一個提供則是城市資料的宣告（契約第 84 行）。
    // 四城共用一個：換算方式是引擎行為，不是城市差異。
    // 【第一版方案（待討論）】繁榮／安全起始值。設計來源沒有給數字（`09_city_module.md` §3.1
    // 只禁止自創每日漂移公式，沒有給起始值）。這裡照 §5 的城市定位分兩級：首都較高、其餘同級。
    // 值域與上下限由 cityMetricEffect Resolver 的 params 決定，不是這裡。
    initialProsperity: row.isCapital ? 70 : 50,
    initialSafety: row.isCapital ? 70 : 50,
    cityMetricEffectResolverId: resolverId('metric-effect'),
  };
}

const FACILITIES: readonly Authored<FacilityDefinition>[] = CITY_ROWS.flatMap((row) =>
  FACILITY_ROWS.map((facilityRow) => facility(row.local, facilityRow)),
);

const SHOP_RULES: readonly Authored<ShopRuleDefinition>[] = CITY_ROWS.flatMap((row) =>
  SHOP_KINDS.map((shopKind) => shopRule(row.local, shopKind)),
);

const ESCORT_RULES: readonly Authored<EscortGenerationRuleDefinition>[] = CITY_ROWS.map((row) =>
  escortRule(row.local),
);

const POPULATION_RULES: readonly Authored<PopulationSupplyRuleDefinition>[] = CITY_ROWS.map((row) =>
  populationRule(row.local),
);

const CITIES: readonly Authored<CityDefinition>[] = CITY_ROWS.map(city);

// ════════════════════════════════════════════════════════════════════════════
// 匯出
// ════════════════════════════════════════════════════════════════════════════

/** 本 domain 實際產出的 kind 聯集，供 `packs.ts` 的 `declaredKinds` 使用（整合者的檔）。 */
export const WORLD_CITY_DECLARED_KINDS: readonly string[] = [
  'adventure-site',
  'city',
  'city-action-rule',
  'city-node',
  'culture',
  'escort-generation-rule',
  'facility',
  'home-rule',
  'price-rule',
  'home-upgrade',
  'intel-rule',
  'nation',
  'player-commerce-daily-limit',
  'player-commerce-practice-rule',
  'population-supply-rule',
  'region',
  'route',
  'shop-rule',
];

/** 本 domain 引用的 Resolver，供 `packs.ts` 的 `requiredResolverIds` 使用（整合者的檔）。 */
export const WORLD_CITY_REQUIRED_RESOLVER_IDS: readonly ResolverId[] = [
  resolverId('inn-rest-completion'),
  resolverId('mastery-training-completion'),
  resolverId('home-year-rest-completion'),
  resolverId('intel-reveal'),
  resolverId('escort-destination'),
  resolverId('population-target-count'),
  resolverId('metric-effect'),
];

// ════════════════════════════════════════════════════════════════════════════
// 顯示文字（全語系）
// ════════════════════════════════════════════════════════════════════════════
//
// 每一筆名稱都必須同時寫出 `SUPPORTED_LOCALES` 的所有語系（`LocalizedName` 是非 optional 的
// 具名欄位），所以「加了繁中忘了英文」是 tsc 錯誤而不是執行期的空白。
// Compiler 另外雙向驗證：每個 nameRef 都有文字、每筆文字都有人引用。
const WORLD_CITY_TEXTS: readonly AuthoredText[] = [
  // 國度。key 沿用上面 `nation` 那筆刻意選定的字串形狀（見該處說明）。
  { key: 'text.nation.yunhua.name', name: { 'zh-Hant': '雲華', en: 'Yunhua' } },
  // 四座城市。
  ...CITY_ROWS.map((row) => ({ key: textKeyFor(cityNodeIdOf(row.local)), name: row.name })),
  // 九座冒險據點。
  ...SITE_ROWS.map((row) => ({ key: textKeyFor(adventureSiteId(row.local)), name: row.name })),
  // 十種設施（四城共用，故以 facilityKind 為單位宣告一次）。
  ...FACILITY_ROWS.map((row) => ({ key: facilityKindTextKey(row), name: row.name })),
];

export const yunhuaWorldCityDomain: AuthoredDomain = {
  domain: 'world-city',
  texts: WORLD_CITY_TEXTS,
  definitions: [
    // world
    culture,
    nation,
    region,
    ...CITY_NODES,
    ...ROUTES,
    ...ADVENTURE_SITES,
    // city
    ...CITIES,
    ...FACILITIES,
    ...SHOP_RULES,
    ...CITY_ACTION_RULES,
    homeRule,
    ...HOME_PRICE_RULES,
    homeRoomUpgrade,
    homeStorageUpgrade,
    intelRule,
    ...ESCORT_RULES,
    ...POPULATION_RULES,
    commerceDailyLimit,
    commercePracticeRule,
  ],
};
