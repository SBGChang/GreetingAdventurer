// content-source/yunhua/maps.ts
// 雲華四城九迷宮的地圖模板與地圖內容定義。**這一檔是「映射」，不是「發明」**：
// 房間拓樸整份取自設計來源 `docs/03_content/yunhua/yunhua_content.data.mjs` 的
// `firstMapLayouts`（`mapFloor`/`mapRoom`/`mapConnection` 模型，形狀定義在
// `docs/03_content/shared/map_model.mjs`），逐張圖的 Tier／型別／素材池取自同檔的
// `firstMapConfigs`。
//
// ── 為什麼拓樸是機械抄錄，以及怎麼複核 ────────────────────────────────────────
//
// 九張圖 18 個樓層、171 個房間、170 條同層連線（＋本檔補出的 10 條跨層樓梯）。手打一定會錯，
// 而錯掉的那一格不會有任何門禁抓到（房間 ID 是 `TemplateLocalId`，打錯只是「連線接到不存在的
// 房間」，Content Compiler 不驗）。所以下面
// `TOPOLOGY` 的每一筆字面值都是從設計來源**機械抄錄**的，抄錄程式的邏輯只有三件事：
//   1. `mapCell('r,c')` → `[r, c]`；
//   2. `mapConnection(..., 'door')` → `kind: 'redDoor'`，`'open'` → `'passage'`；
//   3. 紅門的 `guards` = 兩側房間 marks ∩ {treasure→chest, event→event, large→largeEnemy}。
// 複核方式：把 `firstMapLayouts` 與本檔的 `TOPOLOGY` 各自攤平成
// `(floorKey, roomId, cells)`／`(floorKey, from, to, fromCell, toCell, kind)` 兩個集合逐筆比對。
// **散文不由抄錄程式推論**——樓層編號、跨層樓梯配對、Tier、`templateKind`、刷新偏移全部寫在
// 下面的 `PROFILES` 與「散文判讀」段，是逐張圖人工讀 note/label/configuration 後手填的。
//
// ── 本檔刻意**沒有**的三個 kind（都不是漏掉）────────────────────────────────
//
// 1. `npc-sequence-rule`：core 已有 `npc-sequence-rule.core.shared`
//    （`content-source/core/world-map-dungeon-npc.ts`），它的 `groupPriority` 已涵蓋全部七個
//    目標家族，且該檔明講「NPC 先處理哪一類目標是四國共用的結構性偏好」。每張圖各造一筆會讓
//    同一個事實有九個擁有者。→ **引用它，不重造。**
// 2. `map-gathering-rule`：**結構上不可能存在**。`map-reader.ts` 以 kind `'map-gathering-rule'`
//    讀取，但 `MapDefinitionReader.getGatheringMapView(id)` 的參數是 `GatheringRuleId`
//    ——它期待同一個 ID 上同時掛著 `'gathering-rule'`（gathering 服務擁有、dungeon 也讀）與
//    `'map-gathering-rule'` 兩個 kind，而一筆定義只有一個 kind、同 pack 內 ID 又必須唯一。
//    這是要收斂的契約缺口（`world-map-dungeon-npc.ts` 檔尾缺口 5 已記載同一件事），不是待寫的內容。
// 3. `gathering-rule`（因此 `gatheringNodes` 全部為空）：見下方「未啟用：固定採集點」。
//
// ── 未啟用：固定採集點（`gatheringNodes: []`，九張圖皆然）──────────────────────
//
// 設計來源在九張圖上共標了 **22 個 `marks: ['resource']` 房間**（清單見交接回報），
// `yunhua_content.md` §11.2 也明講「正式 `roomId`／`cell` 已隨九張格圖定義」。但
// `GatheringNodeDefinition.gatheringRuleId` 必填，而雲華的 `gathering-rule` 定義**不存在、
// 本輪也不可能寫得出來**：
//   * §11.2 只為 22 個節點命名了 **4 條**規則（`mist-herb`／`bamboo-grove`／`waterway-reed`／
//     `seal-rubble`），而且**沒有給任何節點→規則的對應**（它給的是「藥泉邊或山谷棚架」這種
//     空間語意散文，對不上實際的 `roomId`）。
//   * 同節又明文把剩下的必填欄位全部推遲：「正式數量、採集 MXP、迷宮互動分鐘、各素材的
//     Map Weight 與各 Mastery Lv.0～10 的產物 Resolver 是**平衡資料**；本表只固定文化來源、
//     Tier 與使用場景」——而 `GatheringRuleDefinition` 的 `yieldParams.distinctEntryCount` /
//     `quantityPerEntry` / `pool` 三欄全部必填。
// 兩條路都不合法：填一個「看起來合理」的產量表是發明平衡資料；讓 `gatheringNodes` 指向
// 不存在的 `gathering-rule.yunhua.*` 會被本輪新增的跨引用門禁擋下（而且只有 4 個 local 名，
// 另外 18 個要我自己編）。因此**這項能力本版不啟用**（規範五個合法出口的第 3 項），
// 22 個節點的完整清單（圖／樓層／roomId／cell）在交接回報裡，等 `gathering-rule` 落地即可補上。
//
// ── 未啟用：固定陷阱（`fixedTraps: []`，九張圖皆然）──────────────────────────
//
// 設計來源標了 **13 個 `marks: ['trap']` 房間**（清單見回報），但
// `FixedTrapDefinition.trapDefinitionId` 是 `DefinitionId<'trap'>`，而 **`trap` 這個 kind
// 沒有登記擁有模組**（不在 `ALL_DEFINITION_KINDS` 的 119 筆裡），也沒有 `TrapDefinition` 契約
// ——任何人現在都寫不出一筆陷阱定義。
// 更關鍵的是：因為 kind 未登記，跨引用門禁的判準（第一段必須是已登記 kind）**不會**檢查
// `trap.yunhua.*`。也就是說填一個成形的 ID 會「編譯過、載入過、執行期讀不到」——正是規範點名
// 的偽裝。所以本版不啟用固定陷阱；那 13 個房間仍以 1×1 房間的身分留在 `rooms` 裡（位置與形狀
// 沒有遺失），只是沒有登記為固定陷阱。
//
// ── 已知會在載入期失敗的一筆：`map-spawn-rule` 的三個池 ID ────────────────────
//
// `MapSpawnRuleDefinition` 的 `localCultureContentRuleId` / `humanCultureContentRuleId` /
// `chestPoolId` / `mapEventPoolId` 四欄必填，而它們的 kind（`culture-content-rule`、
// `chest-pool`、`map-event-pool`）**都沒有登記擁有模組**。而 `MapTemplateDefinition.spawnRuleId`
// 也是必填，且 `map-spawn-rule` **是**已登記 kind——不寫 spawn rule，跨引用門禁會直接擋掉九張
// 模板。因此這裡採 `content-source/core/world-map-dungeon-npc.ts` 對 `npc-stop-policy` /
// `outcome-rule` 的同一種處理：**填依規約成形的 ID，讓缺口在載入／驗證階段大聲失敗**
// （合法出口第 2 項），而不是省略欄位或讓整個生成規則消失。
// `map-reader.ts` 檔頭已明講「這兩張表在正式 Content Pack 尚未建立；未建立前 map 的刷新流程
// 不可啟用」——本檔不改變那個結論。
//
// ── 設計來源本身的不一致（**如實抄錄，未自行修正**）──────────────────────────
//
// 這四筆都在設計來源裡，不是抄錄錯誤。內容側的裁決不屬本檔（`docs/**` 是別人的 scope），
// 逐筆列進交接回報：
//
// 1. **三張雙層圖的出口在地上，但 `configuration` 說在地下。** 懸泉石窟／鹽井封窖／古窯火道的
//    `firstMapConfigs[].entryExit` 分別寫「地下石門出口」「地下排水門出口」「地下排煙道出口」，
//    但它們的拓樸來自 `standard_layouts.mjs` 的共用骨架 `twoFloorLayout`，`exit` 房間在**地上層**
//    (5,5)、地下層完全沒有出口。本檔採**拓樸**（結構化資料）而不是 `entryExit`（散文）。
//    舊漕渠與沉倉沒有這個問題：它有雲華自己的拓樸，出口確實在地下 (5,3)。
// 2. **五張圖沒有雲華自己的拓樸。** 司曆殘院／潮生蘆洲／朱砂斷嶺共用 `wildernessLayout`，
//    懸泉石窟／鹽井封窖／古窯火道共用 `twoFloorLayout`——那是 `standard_layouts.mjs` 檔頭自述
//    「維爾冬／奧瑞恩／薩菲爾共用的三種版型骨架」。後果是這五張圖的房間 local 名是別國語彙
//    （`iceCrack` 冰裂、`beastRange`、`riteClearing`、`northSpring`…），而且三張 8×8 圖的拓樸
//    **完全相同**（171 個房間裡有 51 個是同一份骨架複製三次）。`yunhua_content.md` §4.1 已為
//    九張圖各寫了「主路徑骨架／支線與紅門用途／資源與遭遇節奏」，並註明「重畫時不得只替換名稱、
//    素材池或房間標記」——也就是設計來源自己知道這五張還沒畫。本檔照抄現況。
// 3. **天衡印塔塔 1F 有一扇不合 §96 的紅門。** `入塔前室 → 下行封門梯`（(5,2)→(4,2)）兩側都沒有
//    treasure／event／large 偏好，違反「每扇紅門至少一側房間應具有寶箱、事件或大型體型敵人的
//    內容偏好」。22 扇紅門只有這一扇。本檔對它**不填** `guardedPreferenceKinds`（欄位是選填的，
//    填一個假的偏好才是造假），其餘 21 扇都由兩側 marks 導出。
// 4. **`configuration` 說觀印台是 2×2，實際是 2×4。** 天衡印塔的 `configuration` 寫「大型體型敵人
//    的合法偏好房只在塔 4F 的 2×2 觀印台」，但 `towerFour` 的 `觀印台` 是 `mapRect(3,2,4,5)`＝
//    2 列×4 欄 8 格（樓層 note 自己也寫「觀印台是 2×4」）。§99 只要求「至少 2×2」，所以 2×4 合法；
//    衝突的是 `configuration` 那句話。本檔照抄拓樸。

import type {
  ChestPoolId,
  CultureContentRuleId,
  DefinitionId,
  ExperienceAwardRuleId,
  MapEventPoolId,
  MapSpawnRuleId,
  MapTemplateId,
  RoomId,
  RoomLinkId,
} from '../../src/contracts/core';
import type { MonsterSpeciesKind, MonsterThreatRank } from '../../src/contracts/combat';
import type {
  CultureContentRuleDefinition,
  FloorDefinition,
  GridCell,
  MapContentDefinition,
  MapContentKind,
  MapContentNpcPolicy,
  MapSpawnRuleDefinition,
  MapTemplateDefinition,
  RoomDefinition,
  RoomLinkDefinition,
  SpawnBudgetDefinition,
} from '../../src/contracts/map';
import { cultureIds, type Authored, type AuthoredDomain } from '../authoring';
import {
  YUNHUA_HUMAN_CANDIDATES,
  YUNHUA_NON_HUMAN_CANDIDATES,
  type YunhuaContentCandidate,
} from './monsters';
import {
  NPC_DUNGEON_TARGET_RESOLVER_IDS,
  NPC_SEQUENCE_RULE_ID,
} from '../core/world-map-dungeon-npc';

const yunhua = cultureIds('yunhua');

// ── 跨 domain／跨 pack 引用（本檔不擁有這些定義，只指名既存的 ID）──────────────
//
// `NPC_SEQUENCE_RULE_ID` 與 `NPC_DUNGEON_TARGET_RESOLVER_IDS` 直接從 core 那一檔 import，
// 不重打字串：那個檔案的註解明講這兩份匯出「供文化 pack 的 map-content 填 npcPolicy.resolverId
// 時引用，不必自己拼字串」。手抄一份就是把「打錯一個字」重新變成可能。
//
// 地圖探索 MXP：`content-source/core/progression-rules.ts` 的
// `tieredAwardRules('map-exploration', 'map-exploration', …)` 發出五筆
// `experience-award-rule.core.map-exploration-tier-{i,ii,iii,iv,v}`（經濟表「地圖探索 I～V」
// 60,000／150,000／360,000／900,000／2,160,000，每張圖每次刷新僅一次）。本檔只按 Tier 指名用哪一筆。
const TIER_LABEL: Readonly<Record<1 | 2, 'i' | 'ii'>> = { 1: 'i', 2: 'ii' };

function explorationExperienceRuleId(tier: 1 | 2): ExperienceAwardRuleId {
  // 這裡的 culture 段是 `core`，不是 `yunhua`——經驗規則屬 core pack。
  return `experience-award-rule.core.map-exploration-tier-${TIER_LABEL[tier]}` as ExperienceAwardRuleId;
}

// ── 作者層的中介形狀（純資料，不含規則）──────────────────────────────────────
//
// `Cell` 是設計來源 `mapCell(row, column)` 的直接對應。設計來源把它編碼成字串 `'8,1'`；
// 這裡改成 tuple，因為 `GridCell` 需要三個欄位（樓層是座標的一部分），而樓層在設計來源裡
// 只存在於 `label` 散文中（見「散文判讀」）。
type Cell = readonly [row: number, col: number];

type FloorRow = Readonly<{ key: string; floor: number; rows: number; cols: number }>;
type RoomRow = Readonly<{ f: string; id: string; cells: readonly Cell[] }>;
type LinkRow = Readonly<{
  f: string;
  from: string;
  to: string;
  fromCell: Cell;
  toCell: Cell;
  // 只有紅門會帶這兩欄；通道兩欄皆無。`door` 對應設計來源 `mapConnection(..., 'door')`。
  door?: true;
  guards?: readonly ('chest' | 'event' | 'largeEnemy')[];
  // 跨層樓梯：`to` 房間在另一個樓層。同層連線不帶這一欄。
  toFloorKey?: string;
}>;

type TopologyRow = Readonly<{
  local: MapLocal;
  sourceName: string;
  floors: readonly FloorRow[];
  rooms: readonly RoomRow[];
  links: readonly LinkRow[];
  entrances: readonly (readonly [string, string])[];
  exits: readonly (readonly [string, string])[];
}>;

// 九張圖的 local 名。用字面值聯集而不是 `string`，是為了讓下面的 `PROFILES` 在兩個方向都被
// 編譯器檢查：新增一張圖卻沒給 profile → 少 key，編譯失敗；profile 拼錯 local → 多 key，編譯失敗。
//
// 【第一版方案（待討論）】**local 名有六個是我取的。** 設計來源只在
// `yunhua_content.md` §5 的檔案樹裡給了三個線索（`pool.yunhua.{mist|waterway|seal-tower|...}`）
// 與 §11.2 的四條採集規則 local（`mist-herb` / `bamboo-grove` / `waterway-reed` / `seal-rubble`），
// 沒有給九張圖自己的 local 名。這一組名字是**跨 domain 契約**：
// `AdventureSiteDefinition.mapTemplateId`（world 擁有）必須指到這九個 ID，寫 world domain 的人
// 對不上就是「載入成功、執行期讀不到」。清單已列進交接回報，請以本檔為準或一次改兩邊。
type MapLocal =
  | 'old-canal-sunken-store' // 舊漕渠與沉倉（線索：pool 樹的 `waterway`、§11.2 `waterway-reed`）
  | 'calendar-court-ruin' // 司曆殘院（無線索）
  | 'seal-tower' // 天衡印塔（線索：pool 樹的 `seal-tower`、§11.2 `seal-rubble`）
  | 'mist-bamboo-valley' // 霧篁藥谷（線索：pool 樹的 `mist`、§11.2 `mist-herb`）
  | 'hanging-spring-grotto' // 懸泉石窟（無線索）
  | 'tidal-reed-isle' // 潮生蘆洲（無線索）
  | 'salt-well-cellar' // 鹽井封窖（無線索）
  | 'cinnabar-ridge' // 朱砂斷嶺（無線索）
  | 'old-kiln-flue'; // 古窯火道（無線索）

// ── 逐張圖的「非拓樸」欄位（人工判讀後手填）────────────────────────────────
//
// `templateKind` 不是憑印象填的，是被 `01_map_module.md` §2.1 的尺寸規則**釘住**的：
//   「一般野外固定單層 8×8；一般內部圖每層為 4×4 或 5×5」
//   「國家迷宮建築型每層固定 6×6，最多地上 4 層、地下 2 層」
// 所以四張 8×8 單層圖只能是 `outdoor`（interior 不允許 8×8），四張 5×5 雙層圖只能是
// `interior`，6×6 六層的天衡印塔只能是 `interior` + `nationalDungeonForm: 'building'`
// （設計來源 `isNationalDungeon: true`、`kind: '建築型國家迷宮／符印塔'`、
// `layout: '6×6；塔 1～4F＋地下 1～2F'` 三者一致）。
//
// ⚠ 設計來源的「迷宮型別」中文標籤（水道型／官署型／藥谷型／石窟型／水澤型／井窖型／山嶺型／
// 窯場型）在契約裡**沒有任何欄位裝得下**——`MapTemplateDefinition` 只有 outdoor/interior 兩值。
// 於是「官署型」與「山嶺型」在引擎裡完全同型。見回報「契約缺口」。
type MapProfile = Readonly<{
  templateKind: 'outdoor' | 'interior';
  nationalDungeonForm?: 'building';
  tier: 1 | 2;
  refreshOffsetDays: number;
  spawnBudgets: readonly SpawnBudgetDefinition[];
}>;

// `spawnBudgets`：**只有三張圖有來源。**
// `yunhua_content.md` §7.4「代表迷宮的 Encounter 槽位預算」逐字給了三筆「正式遭遇槽位」：
//   霧篁藥谷（I）  2 一般群、1 菁英、1 Boss
//   舊漕渠與沉倉（I）2 一般群、1 菁英
//   天衡印塔（II） 3 一般群、2 菁英、1 Boss
// 判讀（逐筆寫在下面各 profile 的註解）：
//   * 「一般群」與「菁英」都是 `contentKind: 'monsterGroup'`——`MapContentKind` 沒有 elite 這一值，
//     而 `SpawnBudgetDefinition` 只按 `contentKind` 給數量。所以兩者只能相加成一個 monsterGroup
//     預算，**菁英與一般群的比例在資料裡表達不出來**（契約缺口，見回報）。
//   * 這三筆是「正式槽位」＝確定數，不是區間，所以 `minCount === maxCount`。
//   * 「Boss」→ `contentKind: 'boss'`。
// 其餘六張圖與所有圖的 `chest` / `mapEvent` / `kidnap` / `control` **設計來源沒有任何數量**。
// 憑房間 marks 的個數反推一個「看起來合理」的區間就是發明平衡資料，所以不寫；不寫的後果是
// 那一類內容不生成，這件事必須被看見，不該被一個猜出來的數字蓋掉。
function budget(contentKind: MapContentKind, count: number): SpawnBudgetDefinition {
  return { contentKind, minCount: count, maxCount: count };
}

const PROFILES: Readonly<Record<MapLocal, MapProfile>> = {
  // 5×5、地上 1 層＋地下 1 層 → interior。Tier I。
  // §7.4：「2 一般群、1 菁英」→ monsterGroup 3；該列沒有 Boss，所以不給 boss 預算。
  'old-canal-sunken-store': {
    templateKind: 'interior',
    tier: 1,
    refreshOffsetDays: 0,
    spawnBudgets: [budget('monsterGroup', 3)],
  },
  // 8×8 單層 → outdoor（§2.1 尺寸規則；interior 不允許 8×8）。Tier II。§7.4 未列 → 無預算。
  'calendar-court-ruin': {
    templateKind: 'outdoor',
    tier: 2,
    refreshOffsetDays: 1,
    spawnBudgets: [],
  },
  // 6×6、塔 1～4F ＋地下 1～2F、`isNationalDungeon: true` → interior + building。Tier II。
  // §7.4：「3 一般群、2 菁英、1 Boss」→ monsterGroup 5、boss 1。
  'seal-tower': {
    templateKind: 'interior',
    nationalDungeonForm: 'building',
    tier: 2,
    refreshOffsetDays: 2,
    spawnBudgets: [budget('monsterGroup', 5), budget('boss', 1)],
  },
  // 8×8 單層 → outdoor。Tier I。§7.4：「2 一般群、1 菁英、1 Boss」→ monsterGroup 3、boss 1。
  'mist-bamboo-valley': {
    templateKind: 'outdoor',
    tier: 1,
    refreshOffsetDays: 3,
    spawnBudgets: [budget('monsterGroup', 3), budget('boss', 1)],
  },
  'hanging-spring-grotto': {
    templateKind: 'interior',
    tier: 2,
    refreshOffsetDays: 4,
    spawnBudgets: [],
  },
  'tidal-reed-isle': {
    templateKind: 'outdoor',
    tier: 1,
    refreshOffsetDays: 5,
    spawnBudgets: [],
  },
  'salt-well-cellar': {
    templateKind: 'interior',
    tier: 2,
    refreshOffsetDays: 6,
    spawnBudgets: [],
  },
  'cinnabar-ridge': {
    templateKind: 'outdoor',
    tier: 1,
    refreshOffsetDays: 7,
    spawnBudgets: [],
  },
  'old-kiln-flue': {
    templateKind: 'interior',
    tier: 2,
    refreshOffsetDays: 8,
    spawnBudgets: [],
  },
};

// ── 散文判讀清單（本檔所有「從中文字串人工讀出來的值」）──────────────────────
//
// 這一段是規則要求的逐筆交代。設計來源把三件事只寫在中文字串裡，程式不得 regex 剖析它們，
// 所以我逐筆讀完再手填進 `PROFILES` 與 `TOPOLOGY` 的 `floors[].floor` / 樓梯連線。
//
// (1) **樓層編號**（`FloorDefinition.floor` 與每個 `GridCell.floor`）。
//     設計來源只有 `label` 字串，沒有數字樓層。逐筆判讀：
//       '地上 1F｜沉倉入口'   → floor  1     '地下 1F｜蓄水池'     → floor -1
//       '單層｜漏刻庭與殘院'   → floor  1     '單層｜野外 8×8'       → floor  1
//       '塔 1F｜入塔廳'       → floor  1     '塔 2F｜校印廊'        → floor  2
//       '塔 3F｜藏卷層'       → floor  3     '塔 4F｜觀印台'        → floor  4
//       '塔 地下 1F｜封印庫'  → floor -1     '塔 地下 2F｜地脈室'   → floor -2
//       '地上 1F｜懸泉藥棚'   → floor  1     '地下 1F｜石窟泉眼'    → floor -1
//       '單層｜潮溝與蘆島'     → floor  1
//       '地上 1F｜鹽棚封院'   → floor  1     '地下 1F｜滷井暗窖'    → floor -1
//       '單層｜朱砂採面與斷棧' → floor  1
//       '地上 1F｜古窯作場'   → floor  1     '地下 1F｜排煙火室'    → floor -1
//     規則是「地上／塔 → 正數，地下 → 負數，單層 → 1」，但**沒有寫成程式**：上表是十四筆手填值。
//     附帶結論：設計來源的 `floors` 陣列順序**不是**高度順序（天衡印塔是 1F,2F,3F,4F,B1,B2），
//     所以 `map_model.mjs` 那支依陣列相鄰配對樓梯的驗證器對天衡印塔會報 5 筆錯——那是驗證器的
//     假設不成立，不是資料錯。引擎這一側用「樓層數字 + 同 row/col」表達樓梯，不受陣列順序影響。
//
// (2) **跨層樓梯配對**。設計來源沒有跨層連線資料，只有 note 字串。**不能只靠座標配對**：
//     天衡印塔的 (2,4) 同時是 1F 的 ↑、2F 的 ↓、3F 的 ↑、4F 的 ↓，純座標比對有兩種解。
//     逐筆判讀（左邊是 note 原文）：
//       '↑（2,4）接塔 2F；↓（4,2）接地下 1F'  → 1F↑(2,4)↔2F↓(2,4)、1F↓(4,2)↔B1↑(4,2)
//       '↑（3,3）接塔 3F；↓（2,4）接塔 1F'    → 2F↑(3,3)↔3F↓(3,3)
//       '↑（2,4）接塔 4F；↓（3,3）接塔 2F'    → 3F↑(2,4)↔4F↓(2,4)
//       '↓（2,4）接塔 3F'                     → （同上，反向確認）
//       '↑（4,2）接塔 1F；↓（2,5）接地下 2F'  → B1↓(2,5)↔B2↑(2,5)
//       '↑（2,5）接地下 1F'                   → （同上，反向確認）
//       '兩座上行梯分別和地上兩座下行梯同座標對齊'（舊漕渠）→ (4,5) 與 (2,5) 各一對
//     抄錄程式會斷言每一對的 row/col 相等（§97）與方向正確（上層必須是 ↓、下層必須是 ↑）；
//     實測九張圖全數通過。
//
// (3) **Tier**。`firstMapConfigs[].tier` 是 `'Tier I'` / `'Tier II'` 兩個字串。
//     判讀：'Tier I' → 1、'Tier II' → 2，用來選 `explorationExperienceRuleId`。
//     九筆與 `yunhua_content.md` §4 的表格逐列相符（I、II、II、I、II、I、II、I、II）。
//
// (4) **`spawnBudgets`**。來源是 §7.4 的中文表格列（「2 一般群、1 菁英、1 Boss」），逐筆判讀
//     結果已寫在上面各 profile 的註解裡。
//
// 【第一版方案（待討論）】**`refreshOffsetDays` 九筆全部沒有來源。** 設計來源一個字都沒提。
// 契約要求 0..13（14 日刷新節奏的相位）。取值：依設計來源 `firstMapConfigs` 的宣告順序
// （雲京 1/2/3 → 青岑 1/2 → 澄浦 1/2 → 赤嶺 1/2）給 0..8。
// 理由：這個欄位存在的唯一目的就是錯開相位；九張圖全填 0 會讓整個雲華在同一個世界日一起刷新，
// 玩家只要等一天就能一次收割九座迷宮。0..8 是「相鄰城市槽位不同日」最保守的填法，也留下 9..13
// 給日後新增的地圖。**這是設計決定，不是文件值**，要調就整批調。

// ── 房間拓樸（機械抄錄自設計來源 `firstMapLayouts`；複核方式見檔頭）─────────────
//
// 每一列的 `// entry` / `// exit` / `// stair↑↓` / `// marks=…` 註解是設計來源該房間的旗標與
// 內容偏好，**原樣保留**。其中 `marks` 目前在 `MapTemplateDefinition` 裡**沒有欄位可放**
// （`RoomDefinition` 只有 roomId/floor/cells）——treasure／event／large／resource 四種偏好全部
// 表達不出來，只有紅門那一側靠 `guardedPreferenceKinds` 保住一部分。這是本輪最大的契約缺口，
// 詳見回報；註解留著，是為了補上欄位那天能逐列對回去，而不是重新讀一次設計來源。
const TOPOLOGY: readonly TopologyRow[] = [
  {
    local: 'old-canal-sunken-store',
    sourceName: '舊漕渠與沉倉',
    // 設計來源 firstMapConfigs[0]：city=雲京 citySlot=1 tier=Tier I kind=水道型迷宮 layout=5×5；地上 1 層＋地下 1 層
    floors: [
      // 地上 1F｜沉倉入口（5×5）── note: 東側沉倉與入口區沒有同層連線；引水走廊是固定素材點。
      { key: 'f1', floor: 1, rows: 5, cols: 5 },
      // 地下 1F｜蓄水池（5×5）── note: 兩座上行梯分別和地上兩座下行梯同座標對齊；東側導渠是固定素材點。
      { key: 'b1', floor: -1, rows: 5, cols: 5 },
    ],
    rooms: [
      // ── 地上 1F｜沉倉入口 ──
      { f: 'f1', id: '水道入口', cells: [[1, 1]] }, // entry
      { f: 'f1', id: '西側倉房', cells: [[1, 2], [1, 3], [2, 2], [2, 3], [2, 4], [3, 2], [3, 3]] }, // marks=treasure
      { f: 'f1', id: '引水走廊', cells: [[3, 4], [4, 2], [4, 3], [4, 4], [5, 3]] }, // marks=resource
      { f: 'f1', id: '西側下行梯', cells: [[4, 5]] }, // stair↓
      { f: 'f1', id: '東側沉倉', cells: [[1, 4], [1, 5]] }, // marks=event
      { f: 'f1', id: '東側下行梯', cells: [[2, 5]] }, // stair↓
      // ── 地下 1F｜蓄水池 ──
      { f: 'b1', id: '東側上行梯', cells: [[2, 5]] }, // stair↑
      { f: 'b1', id: '東側導渠', cells: [[3, 5]] }, // marks=resource
      { f: 'b1', id: '蓄水池', cells: [[3, 3], [3, 4], [4, 3], [4, 4]] }, // marks=large
      { f: 'b1', id: '西側上行梯', cells: [[4, 5]] }, // stair↑
      { f: 'b1', id: '中段水閘', cells: [[1, 2], [1, 3], [2, 2], [2, 3], [2, 4]] }, // marks=event
      { f: 'b1', id: '西側沉貨區', cells: [[3, 2], [4, 2], [5, 2]] }, // marks=treasure
      { f: 'b1', id: '水門出口', cells: [[5, 3]] }, // exit
      { f: 'b1', id: '沉木陷阱', cells: [[5, 4]] }, // marks=trap
    ],
    links: [
      // ── 地上 1F｜沉倉入口 ──
      { f: 'f1', from: '水道入口', to: '西側倉房', fromCell: [1, 1], toCell: [1, 2], door: true, guards: ['chest'] },
      { f: 'f1', from: '西側倉房', to: '引水走廊', fromCell: [3, 3], toCell: [3, 4] },
      { f: 'f1', from: '引水走廊', to: '西側下行梯', fromCell: [4, 4], toCell: [4, 5] },
      { f: 'f1', from: '東側沉倉', to: '東側下行梯', fromCell: [1, 5], toCell: [2, 5] },
      // ── 地下 1F｜蓄水池 ──
      { f: 'b1', from: '東側上行梯', to: '東側導渠', fromCell: [2, 5], toCell: [3, 5] },
      { f: 'b1', from: '東側導渠', to: '蓄水池', fromCell: [3, 5], toCell: [3, 4] },
      { f: 'b1', from: '蓄水池', to: '西側上行梯', fromCell: [4, 4], toCell: [4, 5] },
      { f: 'b1', from: '蓄水池', to: '沉木陷阱', fromCell: [4, 4], toCell: [5, 4] },
      { f: 'b1', from: '水門出口', to: '西側沉貨區', fromCell: [5, 3], toCell: [5, 2] },
      { f: 'b1', from: '西側沉貨區', to: '中段水閘', fromCell: [3, 2], toCell: [2, 2] },
      { f: 'b1', from: '中段水閘', to: '蓄水池', fromCell: [2, 4], toCell: [3, 4], door: true, guards: ['event', 'largeEnemy'] },
      // ── 跨層樓梯（設計來源以 note 的「↑（r,c）接…」文字表達；逐筆判讀見檔頭）──
      { f: 'f1', from: '西側下行梯', to: '西側上行梯', toFloorKey: 'b1', fromCell: [4, 5], toCell: [4, 5] },
      { f: 'f1', from: '東側下行梯', to: '東側上行梯', toFloorKey: 'b1', fromCell: [2, 5], toCell: [2, 5] },
    ],
    entrances: [['f1', '水道入口']],
    exits: [['b1', '水門出口']],
  },
  {
    local: 'calendar-court-ruin',
    sourceName: '司曆殘院',
    // 設計來源 firstMapConfigs[1]：city=雲京 citySlot=2 tier=Tier II kind=官署型迷宮 layout=8×8 單層
    floors: [
      // 單層｜漏刻庭與殘院（8×8）── note: 廢棄官署、漏刻水庭與封閉卷庫構成正式迷宮；兩道紅門各守一條支線。
      { key: 'f1', floor: 1, rows: 8, cols: 8 },
    ],
    rooms: [
      // ── 單層｜漏刻庭與殘院 ──
      { f: 'f1', id: 'entry', cells: [[1, 3]] }, // entry
      { f: 'f1', id: 'northRidge', cells: [[1, 4], [1, 5], [2, 4], [2, 5]] },
      { f: 'f1', id: 'northSpring', cells: [[2, 6]] }, // marks=resource
      { f: 'f1', id: 'westSlope', cells: [[2, 2], [2, 3], [3, 1], [3, 2], [3, 3]] }, // marks=treasure
      { f: 'f1', id: 'westQuarry', cells: [[4, 1], [4, 2]] }, // marks=resource
      { f: 'f1', id: 'eastCliff', cells: [[3, 6], [3, 7], [3, 8]] },
      { f: 'f1', id: 'beastRange', cells: [[4, 7], [4, 8], [5, 8]] }, // marks=large
      { f: 'f1', id: 'centralField', cells: [[4, 3], [4, 4], [4, 5], [4, 6], [5, 4], [5, 5]] },
      { f: 'f1', id: 'iceCrack', cells: [[5, 3]] }, // marks=trap
      { f: 'f1', id: 'westVale', cells: [[5, 1], [5, 2], [6, 1], [6, 2]] },
      { f: 'f1', id: 'riteClearing', cells: [[6, 3], [6, 4], [6, 5]] }, // marks=event
      { f: 'f1', id: 'eastTrail', cells: [[6, 6], [6, 7], [7, 7], [7, 8]] },
      { f: 'f1', id: 'cache', cells: [[7, 4]] }, // marks=treasure
      { f: 'f1', id: 'southTrailWest', cells: [[7, 2], [7, 3]] },
      { f: 'f1', id: 'southTrailEast', cells: [[7, 5], [7, 6]] },
      { f: 'f1', id: 'exitPass', cells: [[8, 4], [8, 5], [8, 6]] },
      { f: 'f1', id: 'exit', cells: [[8, 7]] }, // exit
    ],
    links: [
      // ── 單層｜漏刻庭與殘院 ──
      { f: 'f1', from: 'entry', to: 'northRidge', fromCell: [1, 3], toCell: [1, 4] },
      { f: 'f1', from: 'northRidge', to: 'westSlope', fromCell: [2, 4], toCell: [2, 3] },
      { f: 'f1', from: 'northRidge', to: 'northSpring', fromCell: [2, 5], toCell: [2, 6] },
      { f: 'f1', from: 'northSpring', to: 'eastCliff', fromCell: [2, 6], toCell: [3, 6] },
      { f: 'f1', from: 'westSlope', to: 'westQuarry', fromCell: [3, 1], toCell: [4, 1] },
      { f: 'f1', from: 'westSlope', to: 'centralField', fromCell: [3, 3], toCell: [4, 3], door: true, guards: ['chest'] },
      { f: 'f1', from: 'westQuarry', to: 'centralField', fromCell: [4, 2], toCell: [4, 3] },
      { f: 'f1', from: 'eastCliff', to: 'beastRange', fromCell: [3, 7], toCell: [4, 7] },
      { f: 'f1', from: 'beastRange', to: 'centralField', fromCell: [4, 7], toCell: [4, 6] },
      { f: 'f1', from: 'centralField', to: 'iceCrack', fromCell: [5, 4], toCell: [5, 3] },
      { f: 'f1', from: 'centralField', to: 'riteClearing', fromCell: [5, 4], toCell: [6, 4] },
      { f: 'f1', from: 'iceCrack', to: 'westVale', fromCell: [5, 3], toCell: [5, 2] },
      { f: 'f1', from: 'westVale', to: 'southTrailWest', fromCell: [6, 2], toCell: [7, 2] },
      { f: 'f1', from: 'riteClearing', to: 'eastTrail', fromCell: [6, 5], toCell: [6, 6] },
      { f: 'f1', from: 'southTrailWest', to: 'cache', fromCell: [7, 3], toCell: [7, 4] },
      { f: 'f1', from: 'cache', to: 'southTrailEast', fromCell: [7, 4], toCell: [7, 5] },
      { f: 'f1', from: 'southTrailEast', to: 'eastTrail', fromCell: [7, 6], toCell: [7, 7] },
      { f: 'f1', from: 'cache', to: 'exitPass', fromCell: [7, 4], toCell: [8, 4], door: true, guards: ['chest'] },
      { f: 'f1', from: 'eastTrail', to: 'exit', fromCell: [7, 7], toCell: [8, 7] },
      { f: 'f1', from: 'exitPass', to: 'exit', fromCell: [8, 6], toCell: [8, 7] },
    ],
    entrances: [['f1', 'entry']],
    exits: [['f1', 'exit']],
  },
  {
    local: 'seal-tower',
    sourceName: '天衡印塔',
    // 設計來源 firstMapConfigs[2]：city=雲京 citySlot=3 tier=Tier II kind=建築型國家迷宮／符印塔 layout=6×6；塔 1～4F＋地下 1～2F
    floors: [
      // 塔 1F｜入塔廳（6×6）── note: ↑（2,4）接塔 2F；↓（4,2）接地下 1F；北側環廊是固定素材點。
      { key: 'f1', floor: 1, rows: 6, cols: 6 },
      // 塔 2F｜校印廊（6×6）── note: ↑（3,3）接塔 3F；↓（2,4）接塔 1F；下層迴廊是固定素材點。
      { key: 'f2', floor: 2, rows: 6, cols: 6 },
      // 塔 3F｜藏卷層（6×6）── note: ↑（2,4）接塔 4F；↓（3,3）接塔 2F；上行藏卷室是固定素材點。
      { key: 'f3', floor: 3, rows: 6, cols: 6 },
      // 塔 4F｜觀印台（6×6）── note: ↓（2,4）接塔 3F；觀印台是 2×4 大型體型敵人偏好房；觀印前室是固定素材點。
      { key: 'f4', floor: 4, rows: 6, cols: 6 },
      // 塔 地下 1F｜封印庫（6×6）── note: ↑（4,2）接塔 1F；↓（2,5）接地下 2F；封門前廳是固定素材點。
      { key: 'b1', floor: -1, rows: 6, cols: 6 },
      // 塔 地下 2F｜地脈室（6×6）── note: ↑（2,5）接地下 1F；地脈前廳是固定素材點。
      { key: 'b2', floor: -2, rows: 6, cols: 6 },
    ],
    rooms: [
      // ── 塔 1F｜入塔廳 ──
      { f: 'f1', id: '入塔入口', cells: [[6, 1]] }, // entry
      { f: 'f1', id: '入塔前室', cells: [[5, 1], [5, 2], [6, 2]] },
      { f: 'f1', id: '下行封門梯', cells: [[4, 2]] }, // stair↓
      { f: 'f1', id: '正印前庭', cells: [[4, 3], [4, 4], [5, 3], [5, 4]] }, // marks=event
      { f: 'f1', id: '上行校印廳', cells: [[2, 3], [3, 3], [3, 4]] },
      { f: 'f1', id: '上行校印梯', cells: [[2, 4]] }, // stair↑
      { f: 'f1', id: '側庫', cells: [[2, 5], [3, 5]] }, // marks=treasure
      { f: 'f1', id: '符紙火陷', cells: [[1, 4]] }, // marks=trap
      { f: 'f1', id: '北側環廊', cells: [[1, 5]] }, // marks=resource
      // ── 塔 2F｜校印廊 ──
      { f: 'f2', id: '下行校印廳', cells: [[1, 3], [1, 4], [2, 3]] },
      { f: 'f2', id: '下行校印梯', cells: [[2, 4]] }, // stair↓
      { f: 'f2', id: '中段校印室', cells: [[3, 2], [4, 2], [4, 3]] }, // marks=event
      { f: 'f2', id: '上行校印梯', cells: [[3, 3]] }, // stair↑
      { f: 'f2', id: '東側書庫', cells: [[3, 5], [3, 6], [4, 5], [4, 6]] }, // marks=treasure
      { f: 'f2', id: '下層迴廊', cells: [[5, 3], [5, 4], [6, 3], [6, 4]] }, // marks=resource
      { f: 'f2', id: '碎印陷阱', cells: [[6, 5]] }, // marks=trap
      { f: 'f2', id: '東向短廊', cells: [[3, 4]] },
      // ── 塔 3F｜藏卷層 ──
      { f: 'f3', id: '下行藏卷室', cells: [[3, 2], [4, 2], [4, 3]] },
      { f: 'f3', id: '下行藏卷梯', cells: [[3, 3]] }, // stair↓
      { f: 'f3', id: '上行藏卷室', cells: [[1, 3], [1, 4], [2, 3]] }, // marks=resource
      { f: 'f3', id: '上行藏卷梯', cells: [[2, 4]] }, // stair↑
      { f: 'f3', id: '東側典藏庫', cells: [[3, 5], [3, 6], [4, 5], [4, 6]] }, // marks=event
      { f: 'f3', id: '南側卷軸庫', cells: [[5, 4], [6, 4]] }, // marks=treasure
      { f: 'f3', id: '折角短廊', cells: [[3, 4], [4, 4]] },
      { f: 'f3', id: '落卷陷阱', cells: [[5, 5]] }, // marks=trap
      // ── 塔 4F｜觀印台 ──
      { f: 'f4', id: '塔外出口', cells: [[1, 3]] }, // exit
      { f: 'f4', id: '觀印前室', cells: [[1, 4]] }, // marks=resource
      { f: 'f4', id: '下行觀印梯', cells: [[2, 4]] }, // stair↓
      { f: 'f4', id: '北側符銘室', cells: [[1, 5], [1, 6], [2, 5]] }, // marks=event
      { f: 'f4', id: '觀印台', cells: [[3, 2], [3, 3], [3, 4], [3, 5], [4, 2], [4, 3], [4, 4], [4, 5]] }, // marks=large
      { f: 'f4', id: '東側儀器庫', cells: [[3, 6], [4, 6]] }, // marks=treasure
      // ── 塔 地下 1F｜封印庫 ──
      { f: 'b1', id: '上行封門梯', cells: [[4, 2]] }, // stair↑
      { f: 'b1', id: '封門前廳', cells: [[4, 1], [5, 1], [5, 2], [5, 3]] }, // marks=resource
      { f: 'b1', id: '中段封印室', cells: [[3, 3], [3, 4], [4, 3], [4, 4]] }, // marks=event
      { f: 'b1', id: '下行地脈梯', cells: [[2, 5]] }, // stair↓
      { f: 'b1', id: '地脈前廳', cells: [[1, 5], [1, 6], [2, 6]] },
      { f: 'b1', id: '封存架', cells: [[5, 4], [5, 5], [6, 4], [6, 5]] }, // marks=treasure
      { f: 'b1', id: '地脈短廊', cells: [[3, 5]] }, // marks=trap
      // ── 塔 地下 2F｜地脈室 ──
      { f: 'b2', id: '上行地脈梯', cells: [[2, 5]] }, // stair↑
      { f: 'b2', id: '地脈前廳', cells: [[1, 5], [1, 6], [2, 6]] }, // marks=resource
      { f: 'b2', id: '地脈主室', cells: [[3, 2], [3, 3], [3, 4], [3, 5], [4, 2], [4, 3], [4, 4], [4, 5], [5, 2], [5, 3], [5, 4], [5, 5]] }, // marks=event
      { f: 'b2', id: '地脈側庫', cells: [[6, 2], [6, 3]] }, // marks=treasure
    ],
    links: [
      // ── 塔 1F｜入塔廳 ──
      { f: 'f1', from: '入塔入口', to: '入塔前室', fromCell: [6, 1], toCell: [6, 2] },
      { f: 'f1', from: '入塔前室', to: '下行封門梯', fromCell: [5, 2], toCell: [4, 2], door: true },
      { f: 'f1', from: '入塔前室', to: '正印前庭', fromCell: [5, 2], toCell: [5, 3] },
      { f: 'f1', from: '正印前庭', to: '上行校印廳', fromCell: [4, 3], toCell: [3, 3] },
      { f: 'f1', from: '上行校印廳', to: '上行校印梯', fromCell: [2, 3], toCell: [2, 4] },
      { f: 'f1', from: '上行校印廳', to: '側庫', fromCell: [3, 4], toCell: [3, 5], door: true, guards: ['chest'] },
      { f: 'f1', from: '上行校印梯', to: '符紙火陷', fromCell: [2, 4], toCell: [1, 4] },
      { f: 'f1', from: '符紙火陷', to: '北側環廊', fromCell: [1, 4], toCell: [1, 5] },
      // ── 塔 2F｜校印廊 ──
      { f: 'f2', from: '下行校印廳', to: '下行校印梯', fromCell: [2, 3], toCell: [2, 4] },
      { f: 'f2', from: '下行校印廳', to: '上行校印梯', fromCell: [2, 3], toCell: [3, 3] },
      { f: 'f2', from: '上行校印梯', to: '中段校印室', fromCell: [3, 3], toCell: [4, 3] },
      { f: 'f2', from: '上行校印梯', to: '東向短廊', fromCell: [3, 3], toCell: [3, 4] },
      { f: 'f2', from: '東向短廊', to: '東側書庫', fromCell: [3, 4], toCell: [3, 5], door: true, guards: ['chest'] },
      { f: 'f2', from: '中段校印室', to: '下層迴廊', fromCell: [4, 3], toCell: [5, 3] },
      { f: 'f2', from: '下層迴廊', to: '碎印陷阱', fromCell: [6, 4], toCell: [6, 5] },
      // ── 塔 3F｜藏卷層 ──
      { f: 'f3', from: '下行藏卷室', to: '下行藏卷梯', fromCell: [4, 3], toCell: [3, 3] },
      { f: 'f3', from: '下行藏卷梯', to: '折角短廊', fromCell: [3, 3], toCell: [3, 4] },
      { f: 'f3', from: '折角短廊', to: '東側典藏庫', fromCell: [3, 4], toCell: [3, 5], door: true, guards: ['event'] },
      { f: 'f3', from: '折角短廊', to: '上行藏卷梯', fromCell: [3, 4], toCell: [2, 4] },
      { f: 'f3', from: '上行藏卷梯', to: '上行藏卷室', fromCell: [2, 4], toCell: [2, 3] },
      { f: 'f3', from: '折角短廊', to: '南側卷軸庫', fromCell: [4, 4], toCell: [5, 4] },
      { f: 'f3', from: '南側卷軸庫', to: '落卷陷阱', fromCell: [5, 4], toCell: [5, 5] },
      // ── 塔 4F｜觀印台 ──
      { f: 'f4', from: '塔外出口', to: '觀印前室', fromCell: [1, 3], toCell: [1, 4] },
      { f: 'f4', from: '觀印前室', to: '下行觀印梯', fromCell: [1, 4], toCell: [2, 4] },
      { f: 'f4', from: '觀印前室', to: '北側符銘室', fromCell: [1, 4], toCell: [1, 5] },
      { f: 'f4', from: '下行觀印梯', to: '觀印台', fromCell: [2, 4], toCell: [3, 4], door: true, guards: ['largeEnemy'] },
      { f: 'f4', from: '觀印台', to: '東側儀器庫', fromCell: [3, 5], toCell: [3, 6] },
      // ── 塔 地下 1F｜封印庫 ──
      { f: 'b1', from: '上行封門梯', to: '封門前廳', fromCell: [4, 2], toCell: [4, 1] },
      { f: 'b1', from: '封門前廳', to: '中段封印室', fromCell: [5, 3], toCell: [4, 3], door: true, guards: ['event'] },
      { f: 'b1', from: '中段封印室', to: '地脈短廊', fromCell: [3, 4], toCell: [3, 5] },
      { f: 'b1', from: '地脈短廊', to: '下行地脈梯', fromCell: [3, 5], toCell: [2, 5] },
      { f: 'b1', from: '下行地脈梯', to: '地脈前廳', fromCell: [2, 5], toCell: [2, 6] },
      { f: 'b1', from: '中段封印室', to: '封存架', fromCell: [4, 4], toCell: [5, 4] },
      // ── 塔 地下 2F｜地脈室 ──
      { f: 'b2', from: '上行地脈梯', to: '地脈前廳', fromCell: [2, 5], toCell: [2, 6] },
      { f: 'b2', from: '上行地脈梯', to: '地脈主室', fromCell: [2, 5], toCell: [3, 5], door: true, guards: ['event'] },
      { f: 'b2', from: '地脈主室', to: '地脈側庫', fromCell: [5, 2], toCell: [6, 2] },
      // ── 跨層樓梯（設計來源以 note 的「↑（r,c）接…」文字表達；逐筆判讀見檔頭）──
      { f: 'f2', from: '下行校印梯', to: '上行校印梯', toFloorKey: 'f1', fromCell: [2, 4], toCell: [2, 4] },
      { f: 'f3', from: '下行藏卷梯', to: '上行校印梯', toFloorKey: 'f2', fromCell: [3, 3], toCell: [3, 3] },
      { f: 'f4', from: '下行觀印梯', to: '上行藏卷梯', toFloorKey: 'f3', fromCell: [2, 4], toCell: [2, 4] },
      { f: 'f1', from: '下行封門梯', to: '上行封門梯', toFloorKey: 'b1', fromCell: [4, 2], toCell: [4, 2] },
      { f: 'b1', from: '下行地脈梯', to: '上行地脈梯', toFloorKey: 'b2', fromCell: [2, 5], toCell: [2, 5] },
    ],
    entrances: [['f1', '入塔入口']],
    exits: [['f4', '塔外出口']],
  },
  {
    local: 'mist-bamboo-valley',
    sourceName: '霧篁藥谷',
    // 設計來源 firstMapConfigs[3]：city=青岑城 citySlot=1 tier=Tier I kind=藥谷型迷宮 layout=固定單層 8×8
    floors: [
      // 單層｜野外 8×8（8×8）── note: 入口、出口與兩處陷阱皆為單格功能房；南側山徑與東側棧道是固定素材點。
      { key: 'f1', floor: 1, rows: 8, cols: 8 },
    ],
    rooms: [
      // ── 單層｜野外 8×8 ──
      { f: 'f1', id: '入口竹徑', cells: [[8, 1]] }, // entry
      { f: 'f1', id: '南側山徑', cells: [[8, 2], [8, 3], [7, 2], [7, 3]] }, // marks=resource
      { f: 'f1', id: '瘴氣裂縫', cells: [[7, 4]] }, // marks=trap
      { f: 'f1', id: '西側竹叢', cells: [[6, 2], [6, 3], [5, 2], [5, 3], [5, 4]] }, // marks=treasure
      { f: 'f1', id: '採藥台地', cells: [[4, 3], [4, 4], [3, 3], [3, 4]] }, // marks=event
      { f: 'f1', id: '中央空地', cells: [[4, 5], [4, 6], [5, 5], [5, 6]] }, // marks=large
      { f: 'f1', id: '東側棧道', cells: [[5, 7], [4, 7], [3, 7], [3, 8], [2, 8]] }, // marks=resource
      { f: 'f1', id: '崩裂棧板', cells: [[2, 7]] }, // marks=trap
      { f: 'f1', id: '北側藥棚', cells: [[3, 5], [2, 4], [2, 5], [2, 6], [1, 5], [1, 6]] }, // marks=treasure/event
      { f: 'f1', id: '北口', cells: [[1, 7]] }, // exit
    ],
    links: [
      // ── 單層｜野外 8×8 ──
      { f: 'f1', from: '入口竹徑', to: '南側山徑', fromCell: [8, 1], toCell: [8, 2] },
      { f: 'f1', from: '南側山徑', to: '西側竹叢', fromCell: [7, 3], toCell: [6, 3] },
      { f: 'f1', from: '南側山徑', to: '瘴氣裂縫', fromCell: [7, 3], toCell: [7, 4] },
      { f: 'f1', from: '西側竹叢', to: '採藥台地', fromCell: [5, 4], toCell: [4, 4] },
      { f: 'f1', from: '採藥台地', to: '中央空地', fromCell: [4, 4], toCell: [4, 5] },
      { f: 'f1', from: '中央空地', to: '東側棧道', fromCell: [4, 6], toCell: [4, 7], door: true, guards: ['largeEnemy'] },
      { f: 'f1', from: '東側棧道', to: '崩裂棧板', fromCell: [2, 8], toCell: [2, 7] },
      { f: 'f1', from: '崩裂棧板', to: '北側藥棚', fromCell: [2, 7], toCell: [2, 6] },
      { f: 'f1', from: '北側藥棚', to: '北口', fromCell: [1, 6], toCell: [1, 7] },
    ],
    entrances: [['f1', '入口竹徑']],
    exits: [['f1', '北口']],
  },
  {
    local: 'hanging-spring-grotto',
    sourceName: '懸泉石窟',
    // 設計來源 firstMapConfigs[4]：city=青岑城 citySlot=2 tier=Tier II kind=石窟型迷宮 layout=5×5；地上／地下
    floors: [
      // 地上 1F｜懸泉藥棚（5×5）── note: 泉亭、藥棚與封閉庫房圍繞中央石梯。
      { key: 'f1', floor: 1, rows: 5, cols: 5 },
      // 地下 1F｜石窟泉眼（5×5）── note: 泉眼採集點、大型敵人房與事件房分置地下支線。
      { key: 'b1', floor: -1, rows: 5, cols: 5 },
    ],
    rooms: [
      // ── 地上 1F｜懸泉藥棚 ──
      { f: 'f1', id: 'entry', cells: [[1, 2]] }, // entry
      { f: 'f1', id: 'foreHall', cells: [[1, 3], [2, 2], [2, 3]] },
      { f: 'f1', id: 'westHold', cells: [[2, 1], [3, 1]] },
      { f: 'f1', id: 'surfaceVein', cells: [[2, 4]] }, // marks=resource
      { f: 'f1', id: 'collapsedDeck', cells: [[3, 2]] }, // marks=trap
      { f: 'f1', id: 'stairDown', cells: [[3, 3]] }, // stair↓
      { f: 'f1', id: 'eastGangway', cells: [[3, 4], [3, 5], [4, 5]] },
      { f: 'f1', id: 'holdChamber', cells: [[4, 3], [4, 4]] }, // marks=treasure
      { f: 'f1', id: 'westStep', cells: [[4, 2]] },
      { f: 'f1', id: 'southWalk', cells: [[5, 3], [5, 4]] },
      { f: 'f1', id: 'exit', cells: [[5, 5]] }, // exit
      // ── 地下 1F｜石窟泉眼 ──
      { f: 'b1', id: 'upperCave', cells: [[1, 3], [2, 2], [2, 3], [2, 4]] },
      { f: 'b1', id: 'westDrift', cells: [[3, 1]] },
      { f: 'b1', id: 'deepVein', cells: [[3, 2]] }, // marks=resource
      { f: 'b1', id: 'stairUp', cells: [[3, 3]] }, // stair↑
      { f: 'b1', id: 'eastDrift', cells: [[3, 4], [3, 5]] },
      { f: 'b1', id: 'beastDen', cells: [[4, 1], [4, 2], [5, 2]] }, // marks=large
      { f: 'b1', id: 'sunkenCargo', cells: [[4, 3], [4, 4]] }, // marks=event
    ],
    links: [
      // ── 地上 1F｜懸泉藥棚 ──
      { f: 'f1', from: 'entry', to: 'foreHall', fromCell: [1, 2], toCell: [1, 3] },
      { f: 'f1', from: 'foreHall', to: 'westHold', fromCell: [2, 2], toCell: [2, 1] },
      { f: 'f1', from: 'foreHall', to: 'surfaceVein', fromCell: [2, 3], toCell: [2, 4] },
      { f: 'f1', from: 'westHold', to: 'collapsedDeck', fromCell: [3, 1], toCell: [3, 2] },
      { f: 'f1', from: 'collapsedDeck', to: 'stairDown', fromCell: [3, 2], toCell: [3, 3] },
      { f: 'f1', from: 'stairDown', to: 'eastGangway', fromCell: [3, 3], toCell: [3, 4] },
      { f: 'f1', from: 'eastGangway', to: 'holdChamber', fromCell: [4, 5], toCell: [4, 4], door: true, guards: ['chest'] },
      { f: 'f1', from: 'holdChamber', to: 'westStep', fromCell: [4, 3], toCell: [4, 2] },
      { f: 'f1', from: 'holdChamber', to: 'southWalk', fromCell: [4, 3], toCell: [5, 3] },
      { f: 'f1', from: 'southWalk', to: 'exit', fromCell: [5, 4], toCell: [5, 5] },
      // ── 地下 1F｜石窟泉眼 ──
      { f: 'b1', from: 'upperCave', to: 'deepVein', fromCell: [2, 2], toCell: [3, 2] },
      { f: 'b1', from: 'upperCave', to: 'stairUp', fromCell: [2, 3], toCell: [3, 3] },
      { f: 'b1', from: 'upperCave', to: 'eastDrift', fromCell: [2, 4], toCell: [3, 4] },
      { f: 'b1', from: 'stairUp', to: 'eastDrift', fromCell: [3, 3], toCell: [3, 4] },
      { f: 'b1', from: 'deepVein', to: 'westDrift', fromCell: [3, 2], toCell: [3, 1] },
      { f: 'b1', from: 'westDrift', to: 'beastDen', fromCell: [3, 1], toCell: [4, 1] },
      { f: 'b1', from: 'beastDen', to: 'sunkenCargo', fromCell: [4, 2], toCell: [4, 3], door: true, guards: ['largeEnemy', 'event'] },
      { f: 'b1', from: 'eastDrift', to: 'sunkenCargo', fromCell: [3, 4], toCell: [4, 4] },
      // ── 跨層樓梯（設計來源以 note 的「↑（r,c）接…」文字表達；逐筆判讀見檔頭）──
      { f: 'f1', from: 'stairDown', to: 'stairUp', toFloorKey: 'b1', fromCell: [3, 3], toCell: [3, 3] },
    ],
    entrances: [['f1', 'entry']],
    exits: [['f1', 'exit']],
  },
  {
    local: 'tidal-reed-isle',
    sourceName: '潮生蘆洲',
    // 設計來源 firstMapConfigs[5]：city=澄浦城 citySlot=1 tier=Tier I kind=水澤型迷宮 layout=8×8 單層
    floors: [
      // 單層｜潮溝與蘆島（8×8）── note: 潮溝、蘆島與棄置網棚組成正式迷宮，紅門代表封閉水閘。
      { key: 'f1', floor: 1, rows: 8, cols: 8 },
    ],
    rooms: [
      // ── 單層｜潮溝與蘆島 ──
      { f: 'f1', id: 'entry', cells: [[1, 3]] }, // entry
      { f: 'f1', id: 'northRidge', cells: [[1, 4], [1, 5], [2, 4], [2, 5]] },
      { f: 'f1', id: 'northSpring', cells: [[2, 6]] }, // marks=resource
      { f: 'f1', id: 'westSlope', cells: [[2, 2], [2, 3], [3, 1], [3, 2], [3, 3]] }, // marks=treasure
      { f: 'f1', id: 'westQuarry', cells: [[4, 1], [4, 2]] }, // marks=resource
      { f: 'f1', id: 'eastCliff', cells: [[3, 6], [3, 7], [3, 8]] },
      { f: 'f1', id: 'beastRange', cells: [[4, 7], [4, 8], [5, 8]] }, // marks=large
      { f: 'f1', id: 'centralField', cells: [[4, 3], [4, 4], [4, 5], [4, 6], [5, 4], [5, 5]] },
      { f: 'f1', id: 'iceCrack', cells: [[5, 3]] }, // marks=trap
      { f: 'f1', id: 'westVale', cells: [[5, 1], [5, 2], [6, 1], [6, 2]] },
      { f: 'f1', id: 'riteClearing', cells: [[6, 3], [6, 4], [6, 5]] }, // marks=event
      { f: 'f1', id: 'eastTrail', cells: [[6, 6], [6, 7], [7, 7], [7, 8]] },
      { f: 'f1', id: 'cache', cells: [[7, 4]] }, // marks=treasure
      { f: 'f1', id: 'southTrailWest', cells: [[7, 2], [7, 3]] },
      { f: 'f1', id: 'southTrailEast', cells: [[7, 5], [7, 6]] },
      { f: 'f1', id: 'exitPass', cells: [[8, 4], [8, 5], [8, 6]] },
      { f: 'f1', id: 'exit', cells: [[8, 7]] }, // exit
    ],
    links: [
      // ── 單層｜潮溝與蘆島 ──
      { f: 'f1', from: 'entry', to: 'northRidge', fromCell: [1, 3], toCell: [1, 4] },
      { f: 'f1', from: 'northRidge', to: 'westSlope', fromCell: [2, 4], toCell: [2, 3] },
      { f: 'f1', from: 'northRidge', to: 'northSpring', fromCell: [2, 5], toCell: [2, 6] },
      { f: 'f1', from: 'northSpring', to: 'eastCliff', fromCell: [2, 6], toCell: [3, 6] },
      { f: 'f1', from: 'westSlope', to: 'westQuarry', fromCell: [3, 1], toCell: [4, 1] },
      { f: 'f1', from: 'westSlope', to: 'centralField', fromCell: [3, 3], toCell: [4, 3], door: true, guards: ['chest'] },
      { f: 'f1', from: 'westQuarry', to: 'centralField', fromCell: [4, 2], toCell: [4, 3] },
      { f: 'f1', from: 'eastCliff', to: 'beastRange', fromCell: [3, 7], toCell: [4, 7] },
      { f: 'f1', from: 'beastRange', to: 'centralField', fromCell: [4, 7], toCell: [4, 6] },
      { f: 'f1', from: 'centralField', to: 'iceCrack', fromCell: [5, 4], toCell: [5, 3] },
      { f: 'f1', from: 'centralField', to: 'riteClearing', fromCell: [5, 4], toCell: [6, 4] },
      { f: 'f1', from: 'iceCrack', to: 'westVale', fromCell: [5, 3], toCell: [5, 2] },
      { f: 'f1', from: 'westVale', to: 'southTrailWest', fromCell: [6, 2], toCell: [7, 2] },
      { f: 'f1', from: 'riteClearing', to: 'eastTrail', fromCell: [6, 5], toCell: [6, 6] },
      { f: 'f1', from: 'southTrailWest', to: 'cache', fromCell: [7, 3], toCell: [7, 4] },
      { f: 'f1', from: 'cache', to: 'southTrailEast', fromCell: [7, 4], toCell: [7, 5] },
      { f: 'f1', from: 'southTrailEast', to: 'eastTrail', fromCell: [7, 6], toCell: [7, 7] },
      { f: 'f1', from: 'cache', to: 'exitPass', fromCell: [7, 4], toCell: [8, 4], door: true, guards: ['chest'] },
      { f: 'f1', from: 'eastTrail', to: 'exit', fromCell: [7, 7], toCell: [8, 7] },
      { f: 'f1', from: 'exitPass', to: 'exit', fromCell: [8, 6], toCell: [8, 7] },
    ],
    entrances: [['f1', 'entry']],
    exits: [['f1', 'exit']],
  },
  {
    local: 'salt-well-cellar',
    sourceName: '鹽井封窖',
    // 設計來源 firstMapConfigs[6]：city=澄浦城 citySlot=2 tier=Tier II kind=井窖型迷宮 layout=5×5；地上／地下
    floors: [
      // 地上 1F｜鹽棚封院（5×5）── note: 鹽棚、秤房與中央井梯形成地上探索。
      { key: 'f1', floor: 1, rows: 5, cols: 5 },
      // 地下 1F｜滷井暗窖（5×5）── note: 滷井採集點、封存貨物與大型敵人房彼此分離。
      { key: 'b1', floor: -1, rows: 5, cols: 5 },
    ],
    rooms: [
      // ── 地上 1F｜鹽棚封院 ──
      { f: 'f1', id: 'entry', cells: [[1, 2]] }, // entry
      { f: 'f1', id: 'foreHall', cells: [[1, 3], [2, 2], [2, 3]] },
      { f: 'f1', id: 'westHold', cells: [[2, 1], [3, 1]] },
      { f: 'f1', id: 'surfaceVein', cells: [[2, 4]] }, // marks=resource
      { f: 'f1', id: 'collapsedDeck', cells: [[3, 2]] }, // marks=trap
      { f: 'f1', id: 'stairDown', cells: [[3, 3]] }, // stair↓
      { f: 'f1', id: 'eastGangway', cells: [[3, 4], [3, 5], [4, 5]] },
      { f: 'f1', id: 'holdChamber', cells: [[4, 3], [4, 4]] }, // marks=treasure
      { f: 'f1', id: 'westStep', cells: [[4, 2]] },
      { f: 'f1', id: 'southWalk', cells: [[5, 3], [5, 4]] },
      { f: 'f1', id: 'exit', cells: [[5, 5]] }, // exit
      // ── 地下 1F｜滷井暗窖 ──
      { f: 'b1', id: 'upperCave', cells: [[1, 3], [2, 2], [2, 3], [2, 4]] },
      { f: 'b1', id: 'westDrift', cells: [[3, 1]] },
      { f: 'b1', id: 'deepVein', cells: [[3, 2]] }, // marks=resource
      { f: 'b1', id: 'stairUp', cells: [[3, 3]] }, // stair↑
      { f: 'b1', id: 'eastDrift', cells: [[3, 4], [3, 5]] },
      { f: 'b1', id: 'beastDen', cells: [[4, 1], [4, 2], [5, 2]] }, // marks=large
      { f: 'b1', id: 'sunkenCargo', cells: [[4, 3], [4, 4]] }, // marks=event
    ],
    links: [
      // ── 地上 1F｜鹽棚封院 ──
      { f: 'f1', from: 'entry', to: 'foreHall', fromCell: [1, 2], toCell: [1, 3] },
      { f: 'f1', from: 'foreHall', to: 'westHold', fromCell: [2, 2], toCell: [2, 1] },
      { f: 'f1', from: 'foreHall', to: 'surfaceVein', fromCell: [2, 3], toCell: [2, 4] },
      { f: 'f1', from: 'westHold', to: 'collapsedDeck', fromCell: [3, 1], toCell: [3, 2] },
      { f: 'f1', from: 'collapsedDeck', to: 'stairDown', fromCell: [3, 2], toCell: [3, 3] },
      { f: 'f1', from: 'stairDown', to: 'eastGangway', fromCell: [3, 3], toCell: [3, 4] },
      { f: 'f1', from: 'eastGangway', to: 'holdChamber', fromCell: [4, 5], toCell: [4, 4], door: true, guards: ['chest'] },
      { f: 'f1', from: 'holdChamber', to: 'westStep', fromCell: [4, 3], toCell: [4, 2] },
      { f: 'f1', from: 'holdChamber', to: 'southWalk', fromCell: [4, 3], toCell: [5, 3] },
      { f: 'f1', from: 'southWalk', to: 'exit', fromCell: [5, 4], toCell: [5, 5] },
      // ── 地下 1F｜滷井暗窖 ──
      { f: 'b1', from: 'upperCave', to: 'deepVein', fromCell: [2, 2], toCell: [3, 2] },
      { f: 'b1', from: 'upperCave', to: 'stairUp', fromCell: [2, 3], toCell: [3, 3] },
      { f: 'b1', from: 'upperCave', to: 'eastDrift', fromCell: [2, 4], toCell: [3, 4] },
      { f: 'b1', from: 'stairUp', to: 'eastDrift', fromCell: [3, 3], toCell: [3, 4] },
      { f: 'b1', from: 'deepVein', to: 'westDrift', fromCell: [3, 2], toCell: [3, 1] },
      { f: 'b1', from: 'westDrift', to: 'beastDen', fromCell: [3, 1], toCell: [4, 1] },
      { f: 'b1', from: 'beastDen', to: 'sunkenCargo', fromCell: [4, 2], toCell: [4, 3], door: true, guards: ['largeEnemy', 'event'] },
      { f: 'b1', from: 'eastDrift', to: 'sunkenCargo', fromCell: [3, 4], toCell: [4, 4] },
      // ── 跨層樓梯（設計來源以 note 的「↑（r,c）接…」文字表達；逐筆判讀見檔頭）──
      { f: 'f1', from: 'stairDown', to: 'stairUp', toFloorKey: 'b1', fromCell: [3, 3], toCell: [3, 3] },
    ],
    entrances: [['f1', 'entry']],
    exits: [['f1', 'exit']],
  },
  {
    local: 'cinnabar-ridge',
    sourceName: '朱砂斷嶺',
    // 設計來源 firstMapConfigs[7]：city=赤嶺城 citySlot=1 tier=Tier I kind=山嶺型迷宮 layout=8×8 單層
    floors: [
      // 單層｜朱砂採面與斷棧（8×8）── note: 斷嶺棧道、朱砂採面與廢棄守臺構成正式迷宮。
      { key: 'f1', floor: 1, rows: 8, cols: 8 },
    ],
    rooms: [
      // ── 單層｜朱砂採面與斷棧 ──
      { f: 'f1', id: 'entry', cells: [[1, 3]] }, // entry
      { f: 'f1', id: 'northRidge', cells: [[1, 4], [1, 5], [2, 4], [2, 5]] },
      { f: 'f1', id: 'northSpring', cells: [[2, 6]] }, // marks=resource
      { f: 'f1', id: 'westSlope', cells: [[2, 2], [2, 3], [3, 1], [3, 2], [3, 3]] }, // marks=treasure
      { f: 'f1', id: 'westQuarry', cells: [[4, 1], [4, 2]] }, // marks=resource
      { f: 'f1', id: 'eastCliff', cells: [[3, 6], [3, 7], [3, 8]] },
      { f: 'f1', id: 'beastRange', cells: [[4, 7], [4, 8], [5, 8]] }, // marks=large
      { f: 'f1', id: 'centralField', cells: [[4, 3], [4, 4], [4, 5], [4, 6], [5, 4], [5, 5]] },
      { f: 'f1', id: 'iceCrack', cells: [[5, 3]] }, // marks=trap
      { f: 'f1', id: 'westVale', cells: [[5, 1], [5, 2], [6, 1], [6, 2]] },
      { f: 'f1', id: 'riteClearing', cells: [[6, 3], [6, 4], [6, 5]] }, // marks=event
      { f: 'f1', id: 'eastTrail', cells: [[6, 6], [6, 7], [7, 7], [7, 8]] },
      { f: 'f1', id: 'cache', cells: [[7, 4]] }, // marks=treasure
      { f: 'f1', id: 'southTrailWest', cells: [[7, 2], [7, 3]] },
      { f: 'f1', id: 'southTrailEast', cells: [[7, 5], [7, 6]] },
      { f: 'f1', id: 'exitPass', cells: [[8, 4], [8, 5], [8, 6]] },
      { f: 'f1', id: 'exit', cells: [[8, 7]] }, // exit
    ],
    links: [
      // ── 單層｜朱砂採面與斷棧 ──
      { f: 'f1', from: 'entry', to: 'northRidge', fromCell: [1, 3], toCell: [1, 4] },
      { f: 'f1', from: 'northRidge', to: 'westSlope', fromCell: [2, 4], toCell: [2, 3] },
      { f: 'f1', from: 'northRidge', to: 'northSpring', fromCell: [2, 5], toCell: [2, 6] },
      { f: 'f1', from: 'northSpring', to: 'eastCliff', fromCell: [2, 6], toCell: [3, 6] },
      { f: 'f1', from: 'westSlope', to: 'westQuarry', fromCell: [3, 1], toCell: [4, 1] },
      { f: 'f1', from: 'westSlope', to: 'centralField', fromCell: [3, 3], toCell: [4, 3], door: true, guards: ['chest'] },
      { f: 'f1', from: 'westQuarry', to: 'centralField', fromCell: [4, 2], toCell: [4, 3] },
      { f: 'f1', from: 'eastCliff', to: 'beastRange', fromCell: [3, 7], toCell: [4, 7] },
      { f: 'f1', from: 'beastRange', to: 'centralField', fromCell: [4, 7], toCell: [4, 6] },
      { f: 'f1', from: 'centralField', to: 'iceCrack', fromCell: [5, 4], toCell: [5, 3] },
      { f: 'f1', from: 'centralField', to: 'riteClearing', fromCell: [5, 4], toCell: [6, 4] },
      { f: 'f1', from: 'iceCrack', to: 'westVale', fromCell: [5, 3], toCell: [5, 2] },
      { f: 'f1', from: 'westVale', to: 'southTrailWest', fromCell: [6, 2], toCell: [7, 2] },
      { f: 'f1', from: 'riteClearing', to: 'eastTrail', fromCell: [6, 5], toCell: [6, 6] },
      { f: 'f1', from: 'southTrailWest', to: 'cache', fromCell: [7, 3], toCell: [7, 4] },
      { f: 'f1', from: 'cache', to: 'southTrailEast', fromCell: [7, 4], toCell: [7, 5] },
      { f: 'f1', from: 'southTrailEast', to: 'eastTrail', fromCell: [7, 6], toCell: [7, 7] },
      { f: 'f1', from: 'cache', to: 'exitPass', fromCell: [7, 4], toCell: [8, 4], door: true, guards: ['chest'] },
      { f: 'f1', from: 'eastTrail', to: 'exit', fromCell: [7, 7], toCell: [8, 7] },
      { f: 'f1', from: 'exitPass', to: 'exit', fromCell: [8, 6], toCell: [8, 7] },
    ],
    entrances: [['f1', 'entry']],
    exits: [['f1', 'exit']],
  },
  {
    local: 'old-kiln-flue',
    sourceName: '古窯火道',
    // 設計來源 firstMapConfigs[8]：city=赤嶺城 citySlot=2 tier=Tier II kind=窯場型迷宮 layout=5×5；地上／地下
    floors: [
      // 地上 1F｜古窯作場（5×5）── note: 廢窯、陶庫與中央火道梯形成地上層。
      { key: 'f1', floor: 1, rows: 5, cols: 5 },
      // 地下 1F｜排煙火室（5×5）── note: 地下火室、鎖印陶芯採集點與大型敵人房以紅門分隔。
      { key: 'b1', floor: -1, rows: 5, cols: 5 },
    ],
    rooms: [
      // ── 地上 1F｜古窯作場 ──
      { f: 'f1', id: 'entry', cells: [[1, 2]] }, // entry
      { f: 'f1', id: 'foreHall', cells: [[1, 3], [2, 2], [2, 3]] },
      { f: 'f1', id: 'westHold', cells: [[2, 1], [3, 1]] },
      { f: 'f1', id: 'surfaceVein', cells: [[2, 4]] }, // marks=resource
      { f: 'f1', id: 'collapsedDeck', cells: [[3, 2]] }, // marks=trap
      { f: 'f1', id: 'stairDown', cells: [[3, 3]] }, // stair↓
      { f: 'f1', id: 'eastGangway', cells: [[3, 4], [3, 5], [4, 5]] },
      { f: 'f1', id: 'holdChamber', cells: [[4, 3], [4, 4]] }, // marks=treasure
      { f: 'f1', id: 'westStep', cells: [[4, 2]] },
      { f: 'f1', id: 'southWalk', cells: [[5, 3], [5, 4]] },
      { f: 'f1', id: 'exit', cells: [[5, 5]] }, // exit
      // ── 地下 1F｜排煙火室 ──
      { f: 'b1', id: 'upperCave', cells: [[1, 3], [2, 2], [2, 3], [2, 4]] },
      { f: 'b1', id: 'westDrift', cells: [[3, 1]] },
      { f: 'b1', id: 'deepVein', cells: [[3, 2]] }, // marks=resource
      { f: 'b1', id: 'stairUp', cells: [[3, 3]] }, // stair↑
      { f: 'b1', id: 'eastDrift', cells: [[3, 4], [3, 5]] },
      { f: 'b1', id: 'beastDen', cells: [[4, 1], [4, 2], [5, 2]] }, // marks=large
      { f: 'b1', id: 'sunkenCargo', cells: [[4, 3], [4, 4]] }, // marks=event
    ],
    links: [
      // ── 地上 1F｜古窯作場 ──
      { f: 'f1', from: 'entry', to: 'foreHall', fromCell: [1, 2], toCell: [1, 3] },
      { f: 'f1', from: 'foreHall', to: 'westHold', fromCell: [2, 2], toCell: [2, 1] },
      { f: 'f1', from: 'foreHall', to: 'surfaceVein', fromCell: [2, 3], toCell: [2, 4] },
      { f: 'f1', from: 'westHold', to: 'collapsedDeck', fromCell: [3, 1], toCell: [3, 2] },
      { f: 'f1', from: 'collapsedDeck', to: 'stairDown', fromCell: [3, 2], toCell: [3, 3] },
      { f: 'f1', from: 'stairDown', to: 'eastGangway', fromCell: [3, 3], toCell: [3, 4] },
      { f: 'f1', from: 'eastGangway', to: 'holdChamber', fromCell: [4, 5], toCell: [4, 4], door: true, guards: ['chest'] },
      { f: 'f1', from: 'holdChamber', to: 'westStep', fromCell: [4, 3], toCell: [4, 2] },
      { f: 'f1', from: 'holdChamber', to: 'southWalk', fromCell: [4, 3], toCell: [5, 3] },
      { f: 'f1', from: 'southWalk', to: 'exit', fromCell: [5, 4], toCell: [5, 5] },
      // ── 地下 1F｜排煙火室 ──
      { f: 'b1', from: 'upperCave', to: 'deepVein', fromCell: [2, 2], toCell: [3, 2] },
      { f: 'b1', from: 'upperCave', to: 'stairUp', fromCell: [2, 3], toCell: [3, 3] },
      { f: 'b1', from: 'upperCave', to: 'eastDrift', fromCell: [2, 4], toCell: [3, 4] },
      { f: 'b1', from: 'stairUp', to: 'eastDrift', fromCell: [3, 3], toCell: [3, 4] },
      { f: 'b1', from: 'deepVein', to: 'westDrift', fromCell: [3, 2], toCell: [3, 1] },
      { f: 'b1', from: 'westDrift', to: 'beastDen', fromCell: [3, 1], toCell: [4, 1] },
      { f: 'b1', from: 'beastDen', to: 'sunkenCargo', fromCell: [4, 2], toCell: [4, 3], door: true, guards: ['largeEnemy', 'event'] },
      { f: 'b1', from: 'eastDrift', to: 'sunkenCargo', fromCell: [3, 4], toCell: [4, 4] },
      // ── 跨層樓梯（設計來源以 note 的「↑（r,c）接…」文字表達；逐筆判讀見檔頭）──
      { f: 'f1', from: 'stairDown', to: 'stairUp', toFloorKey: 'b1', fromCell: [3, 3], toCell: [3, 3] },
    ],
    entrances: [['f1', 'entry']],
    exits: [['f1', 'exit']],
  },
];

// ── 拓樸 → Definition 的純資料展開 ─────────────────────────────────────────
//
// 房間／連線的 local ID **一律加樓層前綴**。這不是美觀問題：設計來源在天衡印塔裡有兩組同名
// 房間（`上行校印梯` 同時在塔 1F 與塔 2F、`地脈前廳` 同時在地下 1F 與地下 2F），而
// `RoomId` 必須在整份 `MapTemplateDefinition` 內唯一（`01_map_module.md` §2.1）。不加前綴，
// 連線會靜默接到錯的樓層。加了前綴，唯一性就是結構保證而不是巧合。
//
// local ID 保留設計來源的房間名（含中文）而不轉成 ascii slug：`RoomId` 是 `TemplateLocalId`，
// 不走三段式內容 ID 規約，也不會被跨引用門禁掃到；保留原名讓「這一列對應設計來源哪一個房間」
// 零轉譯風險。（相對地，凡是真正的 `DefinitionId` 一律 ascii local——見 `MapLocal`。）
function roomId(floorKey: string, sourceRoomId: string): RoomId {
  return `${floorKey}.${sourceRoomId}` as RoomId;
}

function linkId(floorKey: string, from: string, to: string): RoomLinkId {
  return `${floorKey}.${from}~${to}` as RoomLinkId;
}

function floorNumber(row: TopologyRow, floorKey: string): number {
  const found = row.floors.find((f) => f.key === floorKey);
  if (found === undefined) {
    // 抄錄錯誤要在建置期就爆，不要變成一個樓層號碼錯掉的座標。
    throw new Error(`maps.ts：地圖 "${row.local}" 沒有樓層 "${floorKey}"`);
  }
  return found.floor;
}

function gridCell(floor: number, cell: Cell): GridCell {
  return { floor, row: cell[0], col: cell[1] };
}

function mapTemplateId(local: MapLocal): MapTemplateId {
  return yunhua.id<MapTemplateId>('map-template', local);
}

function mapSpawnRuleId(local: MapLocal): MapSpawnRuleId {
  return yunhua.id<MapSpawnRuleId>('map-spawn-rule', local);
}

function mapTemplate(row: TopologyRow): Authored<MapTemplateDefinition> {
  const profile = PROFILES[row.local];
  const floors: readonly FloorDefinition[] = row.floors.map((f) => ({
    floor: f.floor,
    rows: f.rows,
    cols: f.cols,
  }));
  const rooms: readonly RoomDefinition[] = row.rooms.map((r) => {
    const floor = floorNumber(row, r.f);
    return {
      roomId: roomId(r.f, r.id),
      floor,
      cells: r.cells.map((c) => gridCell(floor, c)),
    };
  });
  const links: readonly RoomLinkDefinition[] = row.links.map((l) => {
    // 同層連線省略 `toFloorKey`——那不是「缺資料」，那就是「同一層」的意思。
    // 跨層樓梯明確給對側樓層鍵，於是「上下樓梯同 row/col、不同 floor」在座標上就成立（§97）。
    const toFloorKey = l.toFloorKey === undefined ? l.f : l.toFloorKey;
    const fromFloor = floorNumber(row, l.f);
    const toFloor = floorNumber(row, toFloorKey);
    return {
      linkId: linkId(l.f, l.from, l.to),
      fromRoomId: roomId(l.f, l.from),
      toRoomId: roomId(toFloorKey, l.to),
      fromCell: gridCell(fromFloor, l.fromCell),
      toCell: gridCell(toFloor, l.toCell),
      kind: l.door === true ? 'redDoor' : 'passage',
      ...(l.guards === undefined ? {} : { guardedPreferenceKinds: l.guards }),
    };
  });
  return {
    kind: 'map-template',
    id: mapTemplateId(row.local),
    // `templateKind` 是領域變體欄位；`kind` 是 Content Pack 的家族宣告。兩者不可互換
    // （門禁檢查 7 會擋）。
    templateKind: profile.templateKind,
    ...(profile.nationalDungeonForm === undefined
      ? {}
      : { nationalDungeonForm: profile.nationalDungeonForm }),
    refreshOffsetDays: profile.refreshOffsetDays,
    refreshCadenceDays: 14,
    floors,
    rooms,
    links,
    // 見檔頭「未啟用」兩段：`trap` kind 未登記、雲華 `gathering-rule` 不存在且平衡資料未定。
    fixedTraps: [],
    gatheringNodes: [],
    entranceRoomIds: row.entrances.map(([f, id]) => roomId(f, id)),
    exitRoomIds: row.exits.map(([f, id]) => roomId(f, id)),
    spawnRuleId: mapSpawnRuleId(row.local),
    explorationExperienceRuleId: explorationExperienceRuleId(profile.tier),
  };
}

// ── map-spawn-rule ─────────────────────────────────────────────────────────
//
// 四個引用欄位的 kind（`culture-content-rule` / `chest-pool` / `map-event-pool`）**都沒有登記
// 擁有模組**，所以下面四個 ID 目前指不到任何真實定義（檔頭已交代為什麼仍要寫）。
//
// 粒度是逐筆判讀的，不是隨手選的：
//   * `localCultureContentRuleId` / `humanCultureContentRuleId` → **全文化各一筆，九張圖共用**。
//     `yunhua_content.md` §4 明文「地圖**不指定怪物種類偏好**。九張圖的非人類敵人都可由雲華文化池
//     選取」「不建立地圖專屬怪種 Pool」；§7.4 每一列也寫「非人類讀雲華全文化池；人類讀占領國
//     文化池」。逐圖各一筆會與這兩句直接衝突。
//     （§5 的檔案樹寫 `pools/pool.yunhua.{mist|waterway|seal-tower|...}.json` 看似逐圖，但那是
//     「素材／寶箱池」的檔名示意，不是怪種池——§4 那兩句才是明文規則。）
//   * `chestPoolId` → **逐圖一筆**。設計來源 `firstMapConfigs[].materialPools.treasure` 給了九份
//     互不相同的加權池（§11.2：「寶箱改讀獨立的 `treasure` 權重」），所以寶箱池的粒度就是一張圖一份。
//   * `mapEventPoolId` → **逐圖一筆**。【第一版方案（待討論）】設計來源沒有任何地圖事件池資料；
//     粒度取「與寶箱池一致」，理由是 §4.1 逐圖描述了事件節奏（「事件槽集中在司曆房」「中兩層提高
//     事件與菁英密度」），那只有逐圖池表達得出來。內容本身仍是空的。
const YUNHUA_NONHUMAN_CONTENT_RULE = yunhua.id<CultureContentRuleId>(
  'culture-content-rule',
  'nonhuman',
);
const YUNHUA_HUMAN_CONTENT_RULE = yunhua.id<CultureContentRuleId>('culture-content-rule', 'human');

// ── 文化內容池（§7.2／§7.3）─────────────────────────────────────────────────
//
// 兩筆，九張圖共用——這是設計明文，不是省事：§4「地圖**不指定怪物種類偏好**。九張圖的非人類
// 敵人都可由雲華文化池選取」「不建立地圖專屬怪種 Pool」；§7.4 每一列「非人類讀雲華全文化池；
// 人類讀占領國文化池」。逐圖各一筆會與這兩句直接衝突。
//
// 候選清單由 `monsters.ts` 從同一份 MONSTER_ROWS 導出（見該檔 `YUNHUA_*_CANDIDATES`），
// 所以 Tier／威脅／人類與否在怪物定義與這裡不可能講出兩種答案。
//
// 人類池獨立成一筆的理由在 §7.3：「此池只在該 Region 目前由雲華控制時使用；被他國佔領後
// **整池替換**」——換池的粒度就是這一筆。
function cultureContentRule(
  local: 'nonhuman' | 'human',
  speciesKind: MonsterSpeciesKind,
  candidates: readonly YunhuaContentCandidate[],
): Authored<CultureContentRuleDefinition> {
  return {
    kind: 'culture-content-rule',
    id: yunhua.id<CultureContentRuleId>('culture-content-rule', local),
    cultureId: yunhua.cultureId,
    speciesKind,
    candidates: candidates.map((c) => ({
      encounterGroupId: c.encounterGroupId,
      tier: c.tier,
      threatRank: c.threatRank,
    })),
  };
}

const CULTURE_CONTENT_RULES: readonly Authored<CultureContentRuleDefinition>[] = [
  cultureContentRule('nonhuman', 'nonHuman', YUNHUA_NON_HUMAN_CANDIDATES),
  cultureContentRule('human', 'human', YUNHUA_HUMAN_CANDIDATES),
];

function mapSpawnRule(row: TopologyRow): Authored<MapSpawnRuleDefinition> {
  const profile = PROFILES[row.local];
  return {
    kind: 'map-spawn-rule',
    id: mapSpawnRuleId(row.local),
    // §7.4 逐圖給定的 Tier；Resolver 只從 tier ≤ 此值的候選裡挑
    //（§4「地圖只限制 Tier、威脅、體型與槽位」）。來源與 `MapProfile.tier` 同一欄，不另抄。
    contentTier: profile.tier,
    localCultureContentRuleId: YUNHUA_NONHUMAN_CONTENT_RULE,
    humanCultureContentRuleId: YUNHUA_HUMAN_CONTENT_RULE,
    chestPoolId: yunhua.id<ChestPoolId>('chest-pool', row.local),
    mapEventPoolId: yunhua.id<MapEventPoolId>('map-event-pool', row.local),
    spawnBudgets: profile.spawnBudgets,
    // core 的共用序列規則。四國 NPC 用同一套「先開寶箱、後打 Boss」的偏好，見檔頭第 1 點。
    npcSequenceRuleId: NPC_SEQUENCE_RULE_ID,
  };
}

// ── map-content ────────────────────────────────────────────────────────────
//
// ⚠ **所有權待裁決（整合者）**：這五筆的兩個欄位（`contentKind` + `npcPolicy`）**沒有任何
// 雲華專屬資料**——點數成本來自 `01_map_module.md` §3.3 不變量 5，Resolver 來自 core 的
// `npc-dungeon-target-resolver`。放在 yunhua pack 的結果是：第二個文化 pack 上線時會出現第二份
// 一模一樣的表。放 core 更合理；`content-source/core/world-map-dungeon-npc.ts` 沒有寫它
// （檔尾「未撰寫的 kind」也沒列它），所以本輪由文化側補上，但這是**位置待討論**，不是定案。
// 反面理由（也記著）：`npcPointCost` 是「這個文化的地牢有多硬」的旋鈕，若日後真要逐文化調，
// 它就該留在文化 pack。
//
// 逐欄位來源：
//   * `contentKind` —— `MapContentKind` 的封閉聯集。
//   * `npcPolicy.pointCost` —— §3.3 不變量 5 逐字：「`npcPointCost` 必須大於 0；小怪／寶箱通常為 1、
//     菁英為 2、大怪為 4，事件由 Definition 明確指定」。
//   * `npcPolicy.resolverId` —— core `NPC_DUNGEON_TARGET_RESOLVER_IDS`（按結算通道切成五筆）。
//
// **為什麼有兩筆 monsterGroup**：§7.4 把每張圖的遭遇槽位寫成「N 一般群、M 菁英」，而不變量 5
// 給了兩個不同的點數（1 與 2）。同一個 `contentKind` 需要兩筆定義才表達得出來。
// ⚠ 但目前**沒有任何東西選得到其中哪一筆**：`SpawnBudgetDefinition` 只按 `contentKind` 給數量，
// 生成端無從得知「這三筆 monsterGroup 裡有一筆該用 elite」。見回報「契約缺口」。
//
// **刻意不寫 `kidnap` 與 `control`**：雲華設計來源（`yunhua_content.data.mjs` 與
// `yunhua_content.md`）從頭到尾沒有綁架／控制內容，§7.4 的槽位表也沒有它們。憑空造兩筆會是
// 零引用內容，而且它們的點數成本沒有任何出處。要開這兩種內容時再一起補資料與預算。
type ContentRow = Readonly<{
  local: string;
  contentKind: MapContentKind;
  pointCost: number;
  targetResolver: keyof typeof NPC_DUNGEON_TARGET_RESOLVER_IDS;
  // 怪物類才有；寶箱與事件沒有威脅等級（缺席＝不適用，見契約說明）。
  threatRank?: MonsterThreatRank;
}>;

const CONTENT_ROWS: readonly ContentRow[] = [
  // 不變量 5：「小怪……為 1」。
  {
    local: 'monster-group-common',
    contentKind: 'monsterGroup',
    threatRank: 'normal',
    pointCost: 1,
    targetResolver: 'combat-target',
  },
  // 不變量 5：「菁英為 2」。§7.4 三張代表迷宮各列了菁英槽位。
  {
    local: 'monster-group-elite',
    contentKind: 'monsterGroup',
    threatRank: 'elite',
    pointCost: 2,
    targetResolver: 'combat-target',
  },
  // 不變量 5：「大怪為 4」。§7.5：「Boss 一律大型 3×3」。
  { local: 'boss', contentKind: 'boss', threatRank: 'boss', pointCost: 4, targetResolver: 'combat-target' },
  // 不變量 5：「……／寶箱通常為 1」。
  { local: 'chest', contentKind: 'chest', pointCost: 1, targetResolver: 'chest' },
  // 【第一版方案（待討論）】不變量 5 只說「事件由 Definition 明確指定」，**沒有給數字**。
  // 取 1 的理由：地圖事件對 NPC 是一次互動判定（與寶箱同一種形狀，只是結果由 Effect 決定），
  // 而 NPC 每日點數預算是 10（`npc-exploration-rule.core.standard`）；取 1 讓事件與寶箱在
  // 同一次探索裡都排得進去。取 2 以上會讓事件實際上被 NPC 跳過，那應該是明講的設計決定。
  { local: 'map-event', contentKind: 'mapEvent', pointCost: 1, targetResolver: 'map-event' },
];

function mapContent(row: ContentRow): Authored<MapContentDefinition> {
  // 全部 `eligible: true`：§2.2 明訂「啟用 NPC Policy 的固定採集點與動態 Map Content 一起取得
  // 唯一 `npcOrder`」，而 core 的 `groupPriority` 已為六種 contentKind 全部給了權重——若這裡把
  // 某一種標成 `eligible: false`，那份權重就永遠用不到，等於兩邊互相矛盾。
  const npcPolicy: MapContentNpcPolicy = {
    eligible: true,
    pointCost: row.pointCost,
    resolverId: NPC_DUNGEON_TARGET_RESOLVER_IDS[row.targetResolver],
  };
  return {
    kind: 'map-content',
    // `contentKind` 是領域變體欄位（Wave E 定形），`kind` 是家族宣告。
    id: yunhua.id<DefinitionId>('map-content', row.local),
    contentKind: row.contentKind,
    // 缺席代表「這種內容沒有威脅等級」，所以不寫成 `threatRank: undefined`。
    ...(row.threatRank === undefined ? {} : { threatRank: row.threatRank }),
    npcPolicy,
  };
}

// ── 匯出 ───────────────────────────────────────────────────────────────────

export const yunhuaMapsDomain: AuthoredDomain = {
  domain: 'maps',
  definitions: [
    ...TOPOLOGY.map(mapTemplate),
    ...TOPOLOGY.map(mapSpawnRule),
    ...CONTENT_ROWS.map(mapContent),
    ...CULTURE_CONTENT_RULES,
  ],
};

// 本 domain 產生的 kind。整合者併進 yunhua pack 的 `declaredKinds`（那一欄刻意手寫，
// 見 `authoring.ts`：推導出來的宣告等於沒有檢查）。
export const YUNHUA_MAPS_DECLARED_KINDS: readonly string[] = [
  'map-template',
  'map-spawn-rule',
  'map-content',
  'culture-content-rule',
];

// 本 domain **不引用任何 Resolver**：`MapTemplateDefinition` / `MapSpawnRuleDefinition` /
// `MapContentDefinition` 三張表裡沒有 `ResolverId` 欄位（`npcPolicy.resolverId` 是
// `NpcDungeonTargetResolverId`，那是內容 Definition 的 ID，不是 registry 的 Resolver）。
// 所以 `packs.ts` 的 `requiredResolverIds` 不需要因本檔增加任何一筆。

// 供 world domain 使用：`AdventureSiteDefinition.mapTemplateId` 必須指到這九個 ID 之一。
// 非 Partial 的 Record：新增一張圖卻沒進這張表就是編譯錯誤。
export const YUNHUA_MAP_TEMPLATE_IDS: Readonly<Record<MapLocal, MapTemplateId>> = {
  'old-canal-sunken-store': mapTemplateId('old-canal-sunken-store'),
  'calendar-court-ruin': mapTemplateId('calendar-court-ruin'),
  'seal-tower': mapTemplateId('seal-tower'),
  'mist-bamboo-valley': mapTemplateId('mist-bamboo-valley'),
  'hanging-spring-grotto': mapTemplateId('hanging-spring-grotto'),
  'tidal-reed-isle': mapTemplateId('tidal-reed-isle'),
  'salt-well-cellar': mapTemplateId('salt-well-cellar'),
  'cinnabar-ridge': mapTemplateId('cinnabar-ridge'),
  'old-kiln-flue': mapTemplateId('old-kiln-flue'),
};
