// content-source/yunhua/quests-events.ts
// 雲華的**地牢內容事件**（`content-event`）與它們的選項效果（`effect`）。
//
// ── 這個 domain 為什麼只有這兩個 kind ──────────────────────────────────────────
//
// 派工單要求兩件事：`content-event`，以及「雲華專屬的 quest 生成資料」。第二件在讀完契約後
// **一筆也寫不出來**，理由不是設計來源缺內容，而是契約沒有承載它的欄位：
//
//   `QuestReactionRuleDefinition`（`src/contracts/quest/index.ts` 第 55～63 行）的全部欄位是
//   `sourceKind` / `questKind` / `creationChance` / `guildResolverId` / `deadlineRuleId` /
//   `objectiveRuleId` / `rewardRuleId`。**沒有任何欄位指向文化、內容池、地圖或城市。**
//
// 也就是說「同一種 sourceKind 在雲華要用不同機率或不同報酬」這件事，資料側說不出來。而
// `content-source/core/quest-crafting-sequence.ts` 已經按 sourceKind 發了 6 筆（monsterGroup /
// boss / kidnap / mapItem / cityStockItem×2），涵蓋 doc §2.3 的全部既定基準。在這裡再發一筆
// `quest-reaction-rule.yunhua.*` 只會產生第二筆「同一個 sourceKind 的規則」，而 Quest 是以
// `getQuestReactionRule(id)` 單筆定址的——誰挑哪一筆沒有任何資料決定，於是那筆新規則永遠不會被
// 選到（或更糟：由某個 Handler 自行挑一筆，正是規範禁止的事）。故本檔不發 quest 系列定義，
// 缺口逐筆寫進回報。
//
// ── 來源 ────────────────────────────────────────────────────────────────────
//
//   * 事件的位置與主題：`docs/03_content/yunhua/yunhua_content.md` §4／§4.1，以及
//     `yunhua_content.data.mjs` 的 `firstMapConfigs[].configuration` 與九張格圖裡
//     `marks: ['event']` 的房間名。
//   * 事件的「風險換材料」骨架：§4.1 逐圖的「資源／遭遇節奏」欄（例如霧篁藥谷
//     「藥徑增加陷阱與採集，讓玩家以風險交換材料」）。
//   * 選項獎勵的物品／素材：§10.1／§10.2 的「製作／取得定位」欄與 §11.1 的「取得方向」欄——
//     **只採那些明文把該物品綁到本事件所在迷宮的列**（逐筆對照見各事件註解）。
//   * 事件選項能表達什麼：`docs/00_core/architecture/13_data_runtime.md` §6.1 的
//     `ContentEventDefinition` / `ContentEventOptionDefinition` / `EffectDefinition`。
//   * 委託：GDD「三、委託系統」＋`docs/00_core/architecture/10_quest_module.md` §2.1～§2.5。
//
// ── 只用三種 Effect 變體，不是為了保守 ──────────────────────────────────────────
//
// `EffectDefinition` 有八個變體，但 `src/app/workflows/content-event-resolution.ts` 的
// `TRANSLATORS` 目前只翻得出三種：`grantItem`（且 `target` 必須是 `'actor'`）、
// `applyStatus`（同樣只有 `'actor'`）、`setWorldFact`。其餘五種一律回
// `workflow/content-event-effect-not-wired`，也就是**玩家選了會被拒絕**。
// 寫一個會被拒絕的選項不是「先放著」，是把未完成偽裝成內容，所以本檔一個也不寫。
// 想要而寫不出來的效果逐筆列在回報。
//
// `setWorldFact` 雖然翻得出來，本檔也**不用**：它需要一筆 `world-fact` 定義（valueKind、
// defaultValue、allowedSourceKinds），而整個 repo 沒有任何地方**讀**世界旗標——
// `ConditionDefinition` 的 `worldFact` 變體在 `src/contracts/**` 根本不存在（見回報的契約缺口），
// `WorldQuery.getWorldFact` 也沒有任何消費者。寫進去只是一個沒人讀的旗標，
// 而且會與 `ResolvePlayerMapContent`（map 已經記錄「這筆內容被解掉了」）成為第二個真相。
//
// ── 三個條件陣列全部是空的，這是刻意的 ────────────────────────────────────────
//
// `triggerConditionIds` / `visibilityConditionIds` / `eligibilityConditionIds` 吃
// `ConditionDefinitionId`（`condition` 家族）。**那個家族寫不出來**：`condition` 不在
// `ALL_DEFINITION_KINDS` 裡，而且 `ConditionDefinition` 這個型別在 `src/contracts/**` 里
// 完全不存在（只有 `ConditionDefinitionId` 這個 ID 別名）。所以填任何值都是懸空引用，
// 而且沒有任何程式會去評估它——`src/modules/dungeon/system.ts` 的 `resolveDungeonInteraction`
// 只檢查 optionId 是否在 `listContentEventOptionIds` 裡。空陣列是「本版沒有條件」的明確表達。

import type {
  CharacterStatusDefinitionId,
  ContentEventDefinition,
  ContentEventDefinitionId,
  ContentEventOptionDefinition,
  ContentEventOptionId,
  DefinitionHeader,
  EffectDefinition,
  EffectDefinitionId,
  ItemDefinitionId,
} from '../../src/contracts/core';
import { cultureIds, type Authored, type AuthoredDomain } from '../authoring';

const yunhua = cultureIds('yunhua');
const core = cultureIds('core');

// ── 作者層型別：`Authored<T>` 對判別聯集會塌掉，這裡把它逐變體展開 ──────────────
//
// `Authored<T>` 是 `Readonly<{kind; enabled?}> & Omit<T, 'schemaVersion'|'packId'|'enabled'>`。
// 當 `T` 是 `DefinitionHeader & (V1 | … | V8)`（`EffectDefinition` 正是這個形狀）時，
// `keyof T` 只拿得到**全部變體的共同鍵**——對 Effect 來說只有 `effectKind`。於是
// `Authored<EffectDefinition>` 實際等於 `{ kind; id; effectKind }`，`itemDefinitionId`、
// `statusId`、`amount` 這些欄位全部消失，寫上去會被 excess property check 拒絕：
//
//     error TS2353: 'target' does not exist in type 'Authored<EffectDefinition>'
//
// 所以「用 `Authored<EffectDefinition>` 標註」這個要求目前**無法滿足**（實測結果附在回報）。
// 這裡不改 `authoring.ts`（不是本檔的 scope），改用一個 distributive conditional 把同一個
// `Authored<>` 套到聯集的**每一個變體**上。結果比 `Authored<EffectDefinition>` 更嚴格，
// 不是更鬆：少填一個變體的必填欄位、或把 `statusId` 填進 `grantItem` 都是編譯錯誤（已實測）。
// 沒有任何轉型。
type AuthoredVariant<TDefinition extends DefinitionHeader> = TDefinition extends DefinitionHeader
  ? Authored<TDefinition>
  : never;

// `ContentEventOptionId` 是 `TemplateLocalId`，不是 `DefinitionId`，所以 `cultureIds().id`
// （只產生三段式定義 ID）造不出它。它的唯一性要求是「在所屬 ContentEventDefinition 內唯一」
// （13_data_runtime.md §6.1 的內嵌註解、`contracts/core/values.ts` 第 116 行），因此正確形狀就是
// 一個短的本地名，不帶 kind 或文化段——加了反而會讓人誤以為它可以被全域定址。
function optionId(local: string): ContentEventOptionId {
  return local as ContentEventOptionId;
}

// ════════════════════════════════════════════════════════════════════════════
// 跨定義引用
// ════════════════════════════════════════════════════════════════════════════

// ── core：角色暫時狀態（可驗證：提供端已落地）───────────────────────────────
//
// `EffectDefinition.applyStatus.statusId` 吃 `CharacterStatusDefinitionId`，也就是
// **`character-status`** 家族（以世界日計時、可由休息解除），不是 combat 的 `combat-status`。
// 提供端是 `content-source/core/character.ts`（`STATUS_ROWS`），三筆：bleeding／fear／daze。
//
// ⚠ 這件事對雲華有具體後果：`yunhua_content.md` §6.1 的五個雲華狀態（瘴息／破綻／印痕／護印／
// 定息）**用不到這裡**——它們的持續時間是「2 次目標行動」（`yunhua_content.data.mjs` 的
// `statusRules`），那是 `combat-status` 的計時單位，而 `applyStatus` 只吃 character-status。
// 所以地牢事件造成的「沾了瘴霧」只能落在 core 這三個生理狀態上，逐事件的對應理由寫在各事件註解。
// 這是**第一版方案（待討論）**：把雲華狀態接到事件上需要 §6.1 那五筆同時存在 character-status
// 版本（設計來源沒有這樣說），或需要一個「戰鬥外套用 combat-status」的效果變體（不存在）。
const STATUS_BLEEDING = core.id<CharacterStatusDefinitionId>('character-status', 'bleeding');
const STATUS_FEAR = core.id<CharacterStatusDefinitionId>('character-status', 'fear');
const STATUS_DAZE = core.id<CharacterStatusDefinitionId>('character-status', 'daze');

// ── yunhua：物品與素材（**提供端尚未落地，無法在本輪對帳**）────────────────────
//
// 下面每一個 ID 都是 `yunhua_content.md` 表格裡的**字面 ID**，不是我推導的 local 名：
//   * §10.1 戰鬥消耗品表的第一欄就寫著 `item.yunhua.clear-miasma-pill` 這種完整 ID。
//   * §10.2 非戰鬥消耗品表同樣格式。
//   * §11.1 素材表同樣格式（`material.yunhua.*`）。
// 所以這裡是「沿用設計來源的 local 名」，不是另創一套。
//
// ⚠ 但 `content-source/yunhua/` 目前只有本檔，物品／素材那兩個 domain 還沒有人交件，所以
// **我無法用「把所有 domain 的 id 收成集合再逐筆比對」的方式對帳**（core/team.ts 檔頭要求的做法）。
// 我能保證的只有「與設計來源的字面 ID 逐字相同」。若提供端改了 local 名，Compiler 的跨引用檢查
// 會逐筆指名，不會靜默通過——這是本輪能得到的最強保證，逐筆清單寫進回報。
//
// 注意 `material.yunhua.*` 的型別是 `ItemDefinitionId`（= `DefinitionId<'item'>`）：素材是
// `ItemKind` 之一（`src/app/content/inventory-reader.ts` 的 `ITEM_KINDS`），所以它由 item reader
// 解析；但 ID 前綴依設計來源 §5／§11.1 的規約是 `material`。前綴與 brand tag 不同名是既有規約
// 的形狀，不是筆誤（回報的契約缺口有記一筆）。
const ITEM_SOBER_INCENSE = yunhua.id<ItemDefinitionId>('item', 'sober-incense');
const ITEM_DRY_SALVE = yunhua.id<ItemDefinitionId>('item', 'dry-salve');
const ITEM_CLEAR_MIASMA_PILL = yunhua.id<ItemDefinitionId>('item', 'clear-miasma-pill');
const ITEM_MIASMA_REPELLING_INCENSE = yunhua.id<ItemDefinitionId>(
  'item',
  'miasma-repelling-incense',
);
const ITEM_WARD_INCENSE_PILL = yunhua.id<ItemDefinitionId>('item', 'ward-incense-pill');
const MATERIAL_SPRING_GINGER = yunhua.id<ItemDefinitionId>('material', 'spring-ginger');
const MATERIAL_FRAYED_SEAL_INK = yunhua.id<ItemDefinitionId>('material', 'frayed-seal-ink');

// ════════════════════════════════════════════════════════════════════════════
// 選項效果（`effect`）
// ════════════════════════════════════════════════════════════════════════════
//
// 零跳（13_data_runtime.md §6.0 規矩三）：效果**就是**它那個變體的一列，事件選項直接指向它。
//
// 兩個共通的第一版決定：
//   * **數量一律 1**（`grantItem.amount`）。設計來源沒有為任何事件指定產出數量——§11.2 明說
//     「正式數量、採集 MXP…是平衡資料」，而那句話管的是採集點。事件產出連那句話都沒有。
//     取 1 的理由是它是唯一不需要另一個平衡決定的值；要調整只改這張表的一格。
//     **第一版方案（待討論）。**
//   * **`duration` 一律 1**（`applyStatus.duration`）。設計來源沒有給地牢事件狀態的持續時間。
//     取 1（世界日）的理由是 GDD 十把旅館定位成「住宿至少 1 日，恢復生命、魔力，以及可由休息
//     解除的暫時狀態」，而這三筆 core 狀態的 `clearByRest` 都是 true——所以「撐到下一次住宿」
//     就是 1 日的自然語意。**第一版方案（待討論）。**
//     ⚠ 而且這個欄位**目前是死的**：`content-event-resolution.ts` 送出的
//     `ApplyContentEventStatus` 沒有 duration 欄位（`src/contracts/character/index.ts`
//     第 325～331 行），`handleApplyContentEventStatus` 建的 `CharacterStatusInstance` 也沒有到期日。
//     填什麼值都不會改變行為。記進回報的契約缺口。

const GRANT_AMOUNT = 1;
const STATUS_DURATION_DAYS = 1;

type GrantRow = Readonly<{ local: string; itemDefinitionId: ItemDefinitionId }>;

// `target: 'actor'` 不是選擇：`TRANSLATORS.grantItem` 對 `'playerTeam'` 回
// `notWired("target='playerTeam' 的分配規則未定案")`，也就是執行期拒絕。
const GRANT_ROWS: readonly GrantRow[] = [
  { local: 'grant-sober-incense', itemDefinitionId: ITEM_SOBER_INCENSE },
  { local: 'grant-dry-salve', itemDefinitionId: ITEM_DRY_SALVE },
  { local: 'grant-clear-miasma-pill', itemDefinitionId: ITEM_CLEAR_MIASMA_PILL },
  { local: 'grant-miasma-repelling-incense', itemDefinitionId: ITEM_MIASMA_REPELLING_INCENSE },
  { local: 'grant-ward-incense-pill', itemDefinitionId: ITEM_WARD_INCENSE_PILL },
  { local: 'grant-spring-ginger', itemDefinitionId: MATERIAL_SPRING_GINGER },
  { local: 'grant-frayed-seal-ink', itemDefinitionId: MATERIAL_FRAYED_SEAL_INK },
];

function grantEffect(row: GrantRow): AuthoredVariant<EffectDefinition> {
  return {
    kind: 'effect',
    id: yunhua.id<EffectDefinitionId>('effect', `event-${row.local}`),
    effectKind: 'grantItem',
    target: 'actor',
    itemDefinitionId: row.itemDefinitionId,
    amount: GRANT_AMOUNT,
  };
}

type StatusRow = Readonly<{ local: string; statusId: CharacterStatusDefinitionId }>;

// 同樣只有 `'actor'` 可用（`TRANSLATORS.applyStatus` 對 `'playerTeam'` 回
// `notWired("target='playerTeam' 需要成員快照 Query")`）。
const STATUS_ROWS: readonly StatusRow[] = [
  // 吸入瘴霧／嗆水後的昏沉。雲華的「瘴息」是 combat-status（見上方說明），戰鬥外套用不了，
  // 所以映到 core 的昏沉。**第一版方案（待討論）**。
  { local: 'inflict-daze', statusId: STATUS_DAZE },
  // 棧道落穴、翻倒的架子造成的外傷。`firstMapConfigs` 霧篁藥谷：「瘴氣與落穴為固定陷阱」。
  { local: 'inflict-bleeding', statusId: STATUS_BLEEDING },
  // 封印／符銘異象。§4.1 天衡印塔「地下層才集中印材與首領壓力」。**第一版方案（待討論）**：
  // 設計來源沒說符印會讓人恐懼；這是三個 core 狀態裡唯一能表達「心理壓力」的一筆。
  { local: 'inflict-fear', statusId: STATUS_FEAR },
];

function statusEffect(row: StatusRow): AuthoredVariant<EffectDefinition> {
  return {
    kind: 'effect',
    id: yunhua.id<EffectDefinitionId>('effect', `event-${row.local}`),
    effectKind: 'applyStatus',
    target: 'actor',
    statusId: row.statusId,
    duration: STATUS_DURATION_DAYS,
  };
}

const EFFECTS: readonly AuthoredVariant<EffectDefinition>[] = [
  ...GRANT_ROWS.map(grantEffect),
  ...STATUS_ROWS.map(statusEffect),
];

// 事件選項要引用效果 ID，而上面那張表用 local 名建 ID。這支只是把同一條規則寫一次，
// 避免逐筆重打字串（`authoring.ts` 允許的「純資料展開工具」）。
function effectRef(local: string): EffectDefinitionId {
  return yunhua.id<EffectDefinitionId>('effect', `event-${local}`);
}

// ════════════════════════════════════════════════════════════════════════════
// 地牢內容事件（`content-event`，`context: 'dungeon'`）
// ════════════════════════════════════════════════════════════════════════════
//
// 每一筆事件的骨架都是 §4.1 逐圖「資源／遭遇節奏」欄描述的同一件事：**一個取捨節點**——
// 承擔風險換取材料，或退開什麼都不拿。所以每個事件恰有兩個選項：
//
//   * 一個「處理」選項：拿到該迷宮明文綁定的物品／素材，並承受該迷宮明文寫下的環境代價。
//   * 一個「退開」選項：`effectIds: []`。這是**內容明確寫下的空**，不是讀不到資料的預設——
//     GDD「三、委託系統」核心原則「不是所有世界內容都會形成委託；物品尤其可能只作為可打聽、
//     可探索的情報存在」與 GDD「事件與地圖的關係」的「地城的特殊『當下狀態』可被玩家消耗
//     （清完、拿完就沒了）」都要求玩家可以選擇不消耗它。
//
// `autoResolutionRuleId` 一筆也不填：那個欄位在 `src/` 裡**沒有任何消費者**（全 repo 只有契約與
// 文件提到它），填了就是一個沒人讀的 ResolverId，而且 Resolver 本身也沒註冊。
//
// 事件**不逐房間發一筆**：房間是 Map Template 的內容槽，事件是池裡的候選（
// `MapSpawnRuleDefinition.mapEventPoolId` → `MapContentPayload.mapEvent.contentEventDefinitionId`）。
// 所以 local 名指主題與樓層，不指 roomId。
//
// ⚠ **這些事件目前抽不到**：`map-event-pool` 這個 kind 沒有登記（不在 `ALL_DEFINITION_KINDS`），
// 所以沒有人寫得出把它們放進哪一張圖的池。缺口在 map 那一側，不是這裡；記進回報。

type EventOptionRow = Readonly<{ local: string; effectLocals: readonly string[] }>;
type EventRow = Readonly<{ local: string; options: readonly EventOptionRow[] }>;

// 「退開」選項在每一筆事件裡都叫同一個名字：optionId 只需在事件內唯一，重名反而讓
// 「哪一個是不消耗內容的選項」在資料層一眼看得出來。
const WITHDRAW_OPTION: EventOptionRow = { local: 'withdraw', effectLocals: [] };

const EVENT_ROWS: readonly EventRow[] = [
  // ── 舊漕渠與沉倉（雲京 1／Tier I／水道型迷宮）────────────────────────────
  //
  // §4.1：「另一支線通往沉貨事件，不與主路重疊。」`firstMapConfigs` 的 configuration：
  // 「倉架與沉貨區為寶箱偏好房」；地上格圖有 `mapRoom('東側沉倉', …, { marks: ['event'] })`。
  //
  // 獎勵取 `item.yunhua.sober-incense`（醒神香）：§10.1 該列的「製作／取得定位」欄寫的是
  // **「藥店、漕渠寶箱」**——設計來源自己把這件道具綁在漕渠。
  // 代價取昏沉：沉貨要下水撈，§4.1 說這張圖「地下才放大型敵人與較高價寶箱，作為首張迷宮的
  // 風險選擇」，風險是這張圖的明文設計意圖。
  {
    local: 'canal-sunken-cargo',
    options: [
      { local: 'salvage', effectLocals: ['grant-sober-incense', 'inflict-daze'] },
      WITHDRAW_OPTION,
    ],
  },
  // 地下 1F｜蓄水池的暗渠水閘。格圖：`mapRoom('中段水閘', …, { marks: ['event'] })`；
  // configuration：「必須從西側同座標樓梯下至地下蓄水池、橫越暗渠，再回到東側樓梯」。
  //
  // 獎勵取 `item.yunhua.dry-salve`（祛濕膏）：§10.2 該列的「效果方向」欄寫的是
  // **「解除水道環境的既定負面狀態」**——它就是這張水道圖的對症道具。
  {
    local: 'canal-backflow-sluice',
    options: [
      { local: 'wade', effectLocals: ['grant-dry-salve', 'inflict-daze'] },
      WITHDRAW_OPTION,
    ],
  },

  // ── 霧篁藥谷（青岑城 1／Tier I／藥谷型迷宮）──────────────────────────────
  //
  // 格圖：`mapRoom('北側藥棚', …, { marks: ['treasure', 'event'] })`。
  // configuration：「瘴氣與落穴為固定陷阱」。
  //
  // 獎勵取兩件：`item.yunhua.clear-miasma-pill`（清瘴丸，§10.1「製作／取得定位」欄寫
  // **「藥店、霧篁素材配方」**）與 `item.yunhua.miasma-repelling-incense`（驅瘴香，§10.2
  // 「合法情境」欄寫 **「地城休整或房間互動」**——「房間互動」就是本事件這件事）。
  // 一個選項給兩件是因為兩件都由設計來源明文綁在這裡，沒有理由拆成兩個互斥選項。
  // 代價取昏沉：這張圖的固定陷阱之一是瘴氣。
  {
    local: 'herb-valley-drying-shed',
    options: [
      {
        local: 'search-shed',
        effectLocals: [
          'grant-clear-miasma-pill',
          'grant-miasma-repelling-incense',
          'inflict-daze',
        ],
      },
      WITHDRAW_OPTION,
    ],
  },
  // 格圖：`mapRoom('採藥台地', …, { marks: ['event'] })`。
  // §4.1：「藥徑增加陷阱與採集，讓玩家以風險交換材料。」
  //
  // 獎勵取 `material.yunhua.spring-ginger`（藥泉薑根）：§11.1 該列的「取得方向」欄寫
  // **「藥谷深處與高級商店庫存」**。代價取流血：另一個固定陷阱是落穴。
  {
    local: 'herb-valley-picking-terrace',
    options: [
      { local: 'pick', effectLocals: ['grant-spring-ginger', 'inflict-bleeding'] },
      WITHDRAW_OPTION,
    ],
  },

  // ── 天衡印塔（雲京 3／Tier II／建築型國家迷宮）──────────────────────────
  //
  // 塔 3F 藏卷層。格圖：`mapRoom('東側典藏庫', …, { marks: ['event'] })`。
  // §4.1：「中兩層提高事件與菁英密度。」
  //
  // 獎勵取 `material.yunhua.frayed-seal-ink`（斷符墨）：§11.1 該列的「取得方向」欄寫
  // **「斷符游靈、印塔書庫」**——典藏庫就是印塔書庫。代價取恐懼（見 STATUS_ROWS 的說明）。
  {
    local: 'seal-tower-scroll-stacks',
    options: [
      { local: 'handle-scrolls', effectLocals: ['grant-frayed-seal-ink', 'inflict-fear'] },
      WITHDRAW_OPTION,
    ],
  },
  // 塔 4F 觀印台層。格圖：`mapRoom('北側符銘室', …, { marks: ['event'] })`。
  //
  // 獎勵取 `item.yunhua.ward-incense-pill`（護印香丸）：§10.1 該列的「製作／取得定位」欄寫
  // **「高級製藥書、印塔材料」**。代價取恐懼。
  {
    local: 'seal-tower-ward-niche',
    options: [
      { local: 'take-ward-pill', effectLocals: ['grant-ward-incense-pill', 'inflict-fear'] },
      WITHDRAW_OPTION,
    ],
  },
];

function option(row: EventOptionRow): ContentEventOptionDefinition {
  return {
    optionId: optionId(row.local),
    // 三個條件陣列都空——`condition` 家族寫不出來（檔頭已說明）。
    visibilityConditionIds: [],
    eligibilityConditionIds: [],
    effectIds: row.effectLocals.map(effectRef),
  };
}

function contentEvent(row: EventRow): AuthoredVariant<ContentEventDefinition> {
  return {
    kind: 'content-event',
    id: yunhua.id<ContentEventDefinitionId>('content-event', row.local),
    context: 'dungeon',
    triggerConditionIds: [],
    options: row.options.map(option),
  };
}

// ════════════════════════════════════════════════════════════════════════════
// 刻意不寫的內容（判準：設計來源沒有給 ID，或引擎收不下）
// ════════════════════════════════════════════════════════════════════════════
//
// 以下五個事件在設計來源裡**有明文的主題**，但本輪一筆也不寫，也不以 `enabled: false` 留下——
// `authoring.ts` 說得很清楚：「還沒做的東西根本不該出現在 pack 裡」。逐筆理由寫進回報：
//
//   * 司曆殘院｜查卷（§4.1「事件槽集中在司曆房，讓查卷與採集形成兩條清楚路線」）：
//     獎勵應是 §10.3「紙本與文書」那一列（古詔殘頁、印塔抄本，用途明寫「書籍事件」），
//     但 §10.3 與 `consumables.general` 只給中文名稱，**沒有一個 `item.yunhua.*` ID**。
//   * 天衡印塔｜地下封印庫與地脈室（格圖有 `中段封印室`、`地脈主室` 兩個 event 房）：
//     §4.1 說地下層「集中印材與首領壓力」，壓力的資料形狀是 `startDetailedCombat`，
//     而它需要 `encounterPoolId`——`encounter-pool` 這個 kind 沒有登記，而且該變體在
//     `TRANSLATORS` 裡就是 `notWired`。
//   * 懸泉石窟｜地上補給（§4.1「地上偏人類事件與補給」）：補給要付錢，
//     形狀是 `removeActorCurrency`，在 `TRANSLATORS` 裡是 `notWired`。
//   * 鹽井封窖｜帳庫判路（§4.1「地上提供判路與事件」）：獎勵應是 §10.3「漕運貨物」
//     （漕運貨單、封蠟木匣…），同樣**沒有 ID**。
//   * 古窯火道｜地下排煙壓力（§4.1「地下逐段提高大型敵人與事件壓力」）：同「首領壓力」，
//     需要 `startDetailedCombat`。
//
// 另外三類完全不在本檔：
//   * `context: 'playerTravel'` 的旅行事件：它們要進
//     `player-travel-event-pool`／`-weight-profile`／`-binding-rule` 才選得到，
//     這三個 kind **都沒有登記**（`content-source/core/team.ts` 已經為同一件事留下懸空 ID）。
//   * `context: 'city'`：`src/` 裡沒有任何城市事件的解析入口。
//   * 朱砂斷嶺與潮生蘆洲：§4.1 這兩列的「支線與紅門用途」與「資源／遭遇節奏」欄
//     一個字都沒提事件（前者講寶箱與高低路，後者講寶箱與捷徑）。沒有主題就不發明主題。

export const yunhuaQuestsEventsDomain: AuthoredDomain = {
  domain: 'quests-events',
  definitions: [...EVENT_ROWS.map(contentEvent), ...EFFECTS],
};
