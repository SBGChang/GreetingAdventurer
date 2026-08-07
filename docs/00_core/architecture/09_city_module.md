# City 模組契約

> **模組 ID：** `city`
>
> **依賴：** [共用核心契約](00_shared_contracts.md)、World／Team／Character／Inventory／Economy 的公開 Query。
>
> **責任：** 管理城市設施狀態、商店 Offer 與刷新政策、酒館情報、護衛候選、房屋與城市生活行動。City 決定「這座城市目前提供什麼」，但不擁有物品實體、金錢或委託。

---

## 1. 邊界與所有權

### 1.1 City 唯一可寫的 State

```ts
type CityState = {
  cities: Record<CityId, CityRuntimeState>;
  shopOffers: Record<ShopOfferId, ShopOffer>;
  intelLeads: Record<IntelLeadId, IntelLead>;
  escortCandidates: Record<EscortCandidateId, EscortCandidate>;
  homes: Record<HomeId, HomeInstance>;
  homeTeachingPosts: Record<HomeTeachingPostId, HomeTeachingPost>;
  playerCommerceUsage?: PlayerDailyCommerceUsage;
};
```

### 1.2 City 不擁有的事

| 事實 | 所有者 | City 的角色 |
|---|---|---|
| 物品實體、個人 Owner、永久庫存成員與 ItemLocation | inventory | Offer 只引用 ItemInstanceId；以 Query 列出永久庫存。 |
| 角色帳戶餘額與最終報價 | economy | Offer 引用 Price Rule；買方／賣方都必須是明確 Character。 |
| 委託、兩期限、四狀態與結案 | quest | 公會設施只提供入口與位置驗證。 |
| 隊伍位置與耗時行動 | team | 驗證城市位置；完成結果由事件回傳。 |
| 角色狀態與熟練度 | character／progression | 設施提供環境，不直接恢復或加 MXP。 |
| 地區控制、戰爭與通行 | world | 依公開事件調整設施／Offer 規則。 |
| 地圖內容 | map | 只保存可被打聽的 IntelLead 引用。 |
| 玩家每日對話與對冒險者好感 | social | City Intel Workflow 分別命令 City 揭露情報、Social 消耗一次共用對話額度；City 不讀寫 Social State。 |

City 的「永久庫存」是 Inventory 中 `location.kind = cityPermanentStock` 的 Query 結果，不在 CityState 再保存 Item ID 清單。

---

## 2. 靜態資料契約

### 2.1 CityDefinitionReader

```ts
interface CityDefinitionReader {
  getCity(id: CityId): CityDefinition;
  getFacility(id: FacilityDefinitionId): FacilityDefinition;
  getShopRule(id: ShopRuleId): ShopRuleDefinition;
  getIntelRule(id: IntelRuleId): IntelRuleDefinition;
  getEscortGenerationRule(id: EscortGenerationRuleId): EscortGenerationRuleDefinition;
  getHomeRule(id: HomeRuleId): HomeRuleDefinition;
  getHomeUpgrade(id: HomeUpgradeDefinitionId): HomeUpgradeDefinition;
  getCityActionRule(id: CityActionRuleId): CityActionRuleDefinition;
  getPopulationSupplyRule(id: PopulationSupplyRuleId): PopulationSupplyRuleDefinition;
  getPlayerCommerceDailyLimit(id: PlayerCommerceDailyLimitId): PlayerCommerceDailyLimitDefinition;
  getPlayerCommercePracticeRule(id: PlayerCommercePracticeRuleId): PlayerCommercePracticeRuleDefinition;
}
```

### 2.2 城市與固定設施

```ts
type CityDefinition = DefinitionHeader & {
  worldCityId: CityId;
  facilityIds: FacilityDefinitionId[];
  shopRuleIds: ShopRuleId[];
  intelRuleId: IntelRuleId;
  escortGenerationRuleId: EscortGenerationRuleId;
  homeRuleId: HomeRuleId;
  populationSupplyRuleId: PopulationSupplyRuleId;
  playerCommerceDailyLimitId: PlayerCommerceDailyLimitId;
  playerCommercePracticeRuleId: PlayerCommercePracticeRuleId;
};

type FacilityKind =
  | 'inn'
  | 'tavern'
  | 'adventurerGuild'
  | 'itemShop'
  | 'equipmentShop'
  | 'trainingGround'
  | 'bookstore'
  | 'adventureCheckpoint'
  | 'cityGate'
  | 'home';

type FacilityDefinition = DefinitionHeader & {
  kind: FacilityKind;
  actionRuleIds: CityActionRuleId[];
  teacherMasteryLevel?: number; // 城鎮教師第一版固定為 5
};
```

所有城市使用相同十種場所種類；城市差異由資料目錄、教師項目、情報、Offer、互動角色與對應冒險地形成，不新增隱藏的城市專屬系統入口。

```ts
type PlayerCommerceDailyLimitDefinition = DefinitionHeader & {
  maxCommerceInteractionsPerDay: 6;
};

type PlayerCommercePracticeRuleDefinition = DefinitionHeader & {
  commerceExperienceRuleId: ExperienceAwardRuleId;
};
```

這是玩家主角本人專用的交易上限，不是整個玩家隊伍共用，也不是每名隊員各有六次；買入或賣出各算一筆。資料驗證必須固定上限為 6，避免各城市以資料意外放大可刷交流熟練度的次數。玩家每日對話與其交流 Experience Rule 由 Social 統一擁有；City 不得為酒館或情報建立第二份計數。

### 2.3 商店刷新

```ts
type ShopRuleDefinition = DefinitionHeader & {
  shopKind: 'item' | 'equipment' | 'book';
  refreshCadenceDays: number;
  refreshOffsetDays: number;
  permanentStockOfferCount: { min: number; max: number }; // 第一版 1..2
  baseCatalogPoolId?: ItemPoolId;
  priceRuleId: PriceRuleId;
  clearPlayerSoldOnRefresh: boolean;
};
```

書店的 `baseCatalogPoolId` 只能包含基礎技能書與基礎製作書。Schema／Rule Validation 必須拒絕高級書與極品書進入一般販售池。

### 2.4 護衛生成

```ts
type EscortGenerationRuleDefinition = DefinitionHeader & {
  cadenceDays: 7;
  cityOffsetDays: number; // 0..6
  candidateCount: { min: 0; max: 5 };
  allowedArchetypeIds: CharacterArchetypeId[];
  destinationResolverId: ResolverId;
  deadlineResolverId?: ResolverId;
};
```

目的地與期限仍未定案時，`deadlineResolverId` 可以缺省；此時資料驗證允許載入，但不得啟用護衛候選生成。

```ts
type PopulationSupplyRuleDefinition = DefinitionHeader & {
  cadenceDays: number;
  cityOffsetDays: number;
  targetCountResolverId: ResolverId;
  batchLimit: number;
  adventurerGenerationRuleId: WorldAdventurerGenerationRuleId;
};
```

人口補充只在固定批次比較目前冒險者供給、繁榮與安全，缺多少才發出多少需求；不為每名居民建立每日模擬。

### 2.5 城市耗時行動

```ts
type CityActionRuleDefinition = DefinitionHeader & {
  kind: 'innRest' | 'masteryTraining' | 'homeRest' | 'homeYearRest';
  scope: 'member' | 'team';
  durationDays: number;
  requiredFacilityKind: FacilityKind;
  completionResolverId: ResolverId;
};
```

第一版資料驗證：

- 住宿至少 1 日。
- 裝備、消耗品與工藝品製作由 Crafting 模組的配方處理，至少 1 日；City 只提供設施可用性。
- 城鎮熟練度訓練固定 28 日，教師等級固定 5。
- 年度休息固定 365 日。
- 買賣、接／回報委託、聊天與探聽等沒有另行指定耗時的城內互動為 0 日，不建立假 TeamPlan。

### 2.6 房屋與功能間

```ts
type HomeRuleDefinition = DefinitionHeader & {
  purchasableSlotCounts: number[];
  purchasePriceRuleIds: Record<number, PriceRuleId>;
  initialUpgradeIds: HomeUpgradeDefinitionId[]; // 房間、倉庫
  allowedUpgradeIds: HomeUpgradeDefinitionId[];
};

type HomeUpgradeDefinition = DefinitionHeader & {
  kind:
    | 'room'
    | 'storage'
    | 'educationRoom'
    | 'forge'
    | 'medicineRoom'
    | 'receptionRoom'
    | 'displayRoom'
    | 'musicHall';
  slotCost: number;
  actionRuleIds: CityActionRuleId[];
  priceRuleId?: PriceRuleId;
};
```

**房屋是第一版必須完成骨架的系統，不延後為純裝飾內容。**第一版已定範圍只有：房屋所有權、可供超載處理使用的家中倉庫、年度休息與生育入口、手動 28 日傳授，以及繼承時的唯一所有權移轉。

`purchasableSlotCounts`、`HomeUpgradeDefinition` 與功能間種類目前只是隔離未來擴充的 provisional 資料邊界，不代表房間玩法已定案。房間形狀、家具安放、Slot 意義、功能間容量、升級與常駐規則必須另案討論；正式定案前不得由目前欄位反推玩法、建立預設房間或寫死 UI。

---

## 3. Runtime State

### 3.1 城市

```ts
type CityRuntimeState = {
  cityId: CityId;
  facilityStates: Record<FacilityDefinitionId, FacilityRuntimeState>;
  prosperity: number;
  safety: number;
  revision: Revision;
};

type FacilityRuntimeState = {
  facilityId: FacilityDefinitionId;
  availability: 'open' | 'restricted' | 'closed';
  restrictionReason?: string;
  revision: Revision;
};
```

繁榮與安全可供未來人口補充、Offer 權重與事件規則使用；第一版沒有數值來源時，不自行建立每日漂移公式。

### 3.2 ShopOffer

```ts
type ShopOffer = {
  offerId: ShopOfferId;
  cityId: CityId;
  facilityId: FacilityDefinitionId;
  itemId: ItemInstanceId;
  source:
    | 'permanentStock'
    | 'baseCatalog'
    | 'playerSold';
  priceRuleId: PriceRuleId;
  state: 'available' | 'sold' | 'expired';
  sourceQuestId?: QuestId;
  createdOnDay: WorldDay;
  expiresOnDay?: WorldDay;
  revision: Revision;
};
```

每個可購買 Offer 必須引用真實 ItemInstance。City 不建立「只有商品名稱、成交後才憑空生成」的假 Offer。

### 3.3 IntelLead

```ts
type IntelLead = {
  intelId: IntelLeadId;
  cityId: CityId;
  sourceContentId: ContentInstanceId;
  kind: 'mapItem' | 'kidnap' | 'boss' | 'monsterControl' | 'other';
  state: 'available' | 'revealed' | 'obsolete';
  revealedToTeamIds: TeamId[];
  revision: Revision;
};
```

情報只是「玩家知道了」的狀態，不建立第二份地圖內容。來源內容失效後，Lead 必須轉為 obsolete。

### 3.4 EscortCandidate

```ts
type EscortCandidate = {
  candidateId: EscortCandidateId;
  originCityId: CityId;
  destinationCityId: CityId;
  archetypeId: CharacterArchetypeId;
  generatedOnDay: WorldDay;
  acceptDeadline: WorldDay;
  actualEndDeadline: WorldDay;
  state: 'available' | 'convertedToQuest' | 'expired';
  revision: Revision;
};
```

EscortCandidate 不是 Character，沒有名字、生命或隊伍位置。只有 Quest 接取後才要求 Character 建立暫時角色。

### 3.5 HomeInstance

```ts
type HomeInstance = {
  homeId: HomeId;
  cityId: CityId;
  ownerCharacterId: CharacterId;
  slotCapacity: number;
  installedUpgradeIds: HomeUpgradeDefinitionId[];
  state: 'owned' | 'inheritancePending' | 'transferred';
  revision: Revision;
};

type HomeTeachingPost = {
  postId: HomeTeachingPostId;
  homeId: HomeId;
  teacherCharacterId: CharacterId;
  startedOnDay: WorldDay;
  minimumReleaseOnDay: WorldDay; // started + 28
  state: 'active' | 'released' | 'interrupted';
  revision: Revision;
};
```

### 3.6 玩家每日交易用量

```ts
type PlayerDailyCommerceUsage = {
  usageId: PlayerCommerceUsageId;
  playerCharacterId: CharacterId;
  worldDay: WorldDay;
  commerceInteractionCount: number;
  revision: Revision;
};
```

`playerCommerceUsage` 只保留玩家目前控制主角在目前世界日的一筆資料；第一版此人就是 `TeamState.playerTeamId` 所指 Team 的 `leaderId`。玩家主角或世界日改變時直接替換，因而跨日自然歸零，不需要日結算器額外重設或累積歷史。玩家隊友與 NPC 市場 Intent 不得建立或寫入此 State。

同一角色可在多座城市各有一間房；同一城市對同一所有者最多一間。房屋內的實體物品仍由 Inventory 的 `homeStorage` Location 管理。

---

## 4. 公開 Query

```ts
interface CityQuery {
  getCity(cityId: CityId): CityView;
  isFacilityAvailable(cityId: CityId, kind: FacilityKind): boolean;
  getFacility(cityId: CityId, kind: FacilityKind): FacilityView;
  listShopOffers(cityId: CityId, shopKind: ShopKind): ShopOfferView[];
  getOffer(offerId: ShopOfferId): ShopOfferView;
  listAvailableIntel(cityId: CityId, teamId: TeamId): IntelLeadView[];
  canUseTavern(cityId: CityId, teamId: TeamId): boolean;
  getPlayerCommerceUsage(playerCharacterId: CharacterId, worldDay: WorldDay): PlayerDailyCommerceUsageView;
  getHome(cityId: CityId, ownerId: CharacterId): HomeView | undefined;
  canUseRestaurant(cityId: CityId, characterId: CharacterId): boolean; // 第一版由 inn 提供基礎餐點入口
}

type PlayerDailyCommerceUsageView = {
  playerCharacterId: CharacterId;
  worldDay: WorldDay;
  commerceInteractionCount: number;
  remainingCount: number;
};
```

公會的任務清單由 City Screen Projection 組合 `QuestQuery` 提供；`CityState` 與 `CityQuery` 都不保存或轉送 Quest 清單。

酒館冒險者清單同樣不是 City State。`TavernAdventurerView` 由 `app/read-models/` 組合 City 的酒館可用性、Team 的 `listTavernVisitorIds`／近期行動，以及 Character 的公開身分資料。

---

## 5. 輸入契約

### 5.1 玩家 Game Command

| Command | 前置條件 | City 的責任 |
|---|---|---|
| `buyShopOffer` | 隊伍在城市、設施開放、Offer 可用，指定付款 Character 為正式成員；若付款者是玩家主角，當日交易未滿 6 次。 | 以付款者個人帳戶購買；一般商品 Owner 轉給該角色，Quest 指定品則直接進 `teamQuestCargo`；只有玩家主角的原子交易成功後才將交易計數 +1。 |
| `sellItemToShop` | 隊伍在城市、設施開放、指定 Character 是 Item Owner 且 Item 可交易；若賣方是玩家主角，當日交易未滿 6 次。 | 以賣方個人帳戶收款並解除 Item 的角色 Owner；只有玩家主角的原子交易成功後才將交易計數 +1。 |
| `askTavernIntel`（Application Workflow） | 隊伍在城市、酒館開放，且玩家當日仍有 Social 對話額度。 | Workflow 分別送出 required `RevealTavernIntel` 與 `ConsumePlayerConversationAllowance`；兩者在同一交易一起提交。城內時間為 0。 |
| `startFacilityAction` | 地點、設施、角色與規則合法。 | 要求 Team 建立住宿、訓練等 City 耗時行動；製作由 Crafting Command 進入。 |
| `buyOrUpgradeHome` | 地點、所有權與付款合法。 | 啟動房屋購買／升級 Workflow。 |
| `assignHomeTeacher` | 玩家角色位於自己的房屋、指定成年人可擔任教師，且沒有衝突 Plan；若向非玩家冒險者提出家教服務，Economy 的含 Social 好感修正 Quote 與付款必須合法。 | 付款與 Post 建立同成同敗；建立至少 28 日的 `HomeTeachingPost` 與教師 Team Plan，玩家主角自己擔任教師時也受相同時間限制。 |
| `releaseHomeTeacher` | 指定 Post 已達最短 28 日，且教師仍可用。 | 結束 Post；受其教導的 Child Study Session 於當日依已投入時間結算並重抽。 |

公會的接取／結案 Command 由 Quest 擁有；City 只提供 Guild Facility Query。

玩家主角的買入、賣出與打聽情報皆為零時間 Command；同一世界日最多完成 6 筆交易，而情報與 Social 的隊友／酒館聊天共用每日 6 次對話。超額時回傳對應 typed rejection，不得先扣錢、轉移物品、揭露情報或發放 MXP。玩家隊友的買賣不使用額度，也不從這些互動取得交流 MXP；他們和一般 NPC 一樣只從完整自由日取得固定交流經驗。酒館聊天由 Social 的 `interactWithAdventurer` 擁有，招募則由 Team 擁有；City 只提供酒館是否開放與玩家是否位於同城的 Query。

### 5.2 ScheduledJob

| Job | City 的反應 |
|---|---|
| `shopRefresh` | 依 Shop Rule 清理、歸還、生成並建立新 Offer。 |
| `escortGeneration` | 在該城市的固定 7 日偏移批次生成 0～5 候選。 |
| `cityPopulationReview` | 依固定 cadence／offset 與繁榮、安全計算供給缺口，最多發出 `batchLimit` 的冒險者補充需求。 |

### 5.3 Internal Command

| Internal Command | City 的反應 |
|---|---|
| `ReserveShopOfferForQuest` | 寫入 `sourceQuestId` 使指定 Offer 不被一般刷新清理；Offer 仍可正常購買。 |
| `ReleaseQuestShopOffer` | 依任務結果釋放、到期或關閉 Offer。 |
| `SetFacilityAvailability` | 依 World／事件的合法來源改變設施開放狀態。 |
| `ApplyCityMetricEffect` | 依已驗證 Effect 調整繁榮／安全並套用資料上下限。 |
| `TransferHomeOwnership` | 驗證原所有者、繼承來源與同城唯一性後移轉房屋。 |
| `InterruptHomeTeachingPost` | 教師死亡、退休、離隊或不再可用時，將 Post 標為 interrupted，通知 Child Study Workflow 立即做部分結算。 |
| `RevealTavernIntel` | 只接受 City Intel Workflow；驗證酒館、隊伍與 Intel Lead 後標記揭露。若 Social 額度步驟拒絕，整筆交易回滾。 |

### 5.4 訂閱 DomainEvent

| Event | City 的反應 |
|---|---|
| `MapContentGenerated` | 依 Intel Rule 建立可打聽 Lead；不代表一定形成委託。 |
| `MapContentResolved`／`MapRefreshed` | 將失效來源情報標為 obsolete。 |
| `InventoryTransferred` | 若物品進入永久庫存或店面，建立索引反應／Offer 候選。 |
| `TeamPlanCompleted` | 完成住宿、訓練等 City Action 的設施端結果。 |
| `FreeActionCompleted` | 對成員級生活訓練驗證設施與 Action Rule，再發出 `CityTrainingCompleted`。製作結算由 Crafting 擁有。 |
| `MarketPressureChanged`／`RegionControlChanged` | 使受影響報價或設施規則失效並重算。 |
| `QuestStateChanged` | 更新有 `sourceQuestId` 的 Offer 顯示與刷新保留。 |

---

## 6. 輸出 Internal Command

| Internal Command | 唯一處理者 | 用途 |
|---|---|---|
| `CreateItemInstance` | inventory | 為 Base Catalog 建立真實商品實體。 |
| `TransferItem` | inventory | 永久庫存、貨架、買家與清除位置間移轉。 |
| `RemoveItemInstance` | inventory | 清除到期的 playerSold 或任務指定實體。 |
| `TransferCurrency` | economy | 購買、販售、房屋與設施費用。 |
| `StartTimedCityAction` | team | 建立住宿、訓練或房屋行動。 |

購買與販售由 Workflow 編排，不要求 City Handler 自行依序呼叫所有命令。

---

## 7. 輸出事件

| Event | 最少 payload | 訂閱者 |
|---|---|---|
| `ShopRefreshed` | `cityId`、`shopId`、`offerIds` | quest、ui/app。 |
| `ShopOfferCreated` | `offerId`、`itemId`、`source` | quest、ui/app。 |
| `ShopOfferSold` | `offerId`、`itemId`、`buyerCharacterId`、`buyerTeamId` | quest、ui/app。 |
| `CommerceInteractionCompleted` | `actorKind: playerCharacter`、`teamId`、`characterId`、`kind: buy \| sell`、`cityId`、`sourceId`、`experienceAwardRuleId` | progression、ui/app。 |
| `CityStockItemAvailable` | `cityId`、`itemId` | quest、ui/app。 |
| `IntelRevealed` | `intelId`、`teamId`、`sourceContentId` | ui/app。 |
| `EscortCandidatesGenerated` | `cityId`、`candidateIds` | quest。 |
| `FacilityRestCompleted` | `cityId`、`characterIds`、`ruleId` | character。 |
| `CityTrainingCompleted` | `characterId`、`masteryId`、`teacherLevel: 5` | progression。 |
| `HomeChanged` | `homeId`、`ownerId`、`change` | character、inventory、ui/app。 |
| `HomeTeachingPostChanged` | `postId`、`homeId`、`teacherCharacterId`、`state` | team、progression、ui/app。 |
| `CityMetricsChanged` | `cityId`、`prosperity`、`safety`、`sourceId` | population／content-event workflow、ui/app。 |
| `AdventurerSupplyDemanded` | `cityId`、`cultureId`、`count`、`adventurerGenerationRuleId`、`reason` | character／team population workflow。 |

---

## 8. 核心流程

### 8.1 每月商店刷新

```text
shopRefresh
  1. 找出 source=playerSold 的舊 Offer
  2. 送出 RemoveItemInstance；Quest 保留中的實體不可清
  3. source=permanentStock 且未售出的 Item 回到 cityPermanentStock
  4. 以 InventoryQuery 取得永久庫存候選
  5. 固定 RNG Stream 抽 1～2 件並移到 shopShelf
  6. 依 Base Catalog 建立需要的真實 ItemInstance
  7. 建立新 Offer，發出 ShopRefreshed
```

有 `sourceQuestId` 的 Offer 不受一般月刷新清除，但仍是 `state: available` 且可被任何合法買家購買；只由 Quest 的明確生命週期命令解除標記或清理。

### 8.2 酒館情報

未形成委託的地圖物品可以保留 `IntelLead.state = available`。玩家探聽時依固定規則揭露，City 不移動物品、不建立委託，也不保證來源尚未被其他冒險者處理；顯示前需重新驗證來源。

### 8.3 城鎮訓練與書店

- 道具店、裝備店、訓練所提供其資料允許的 28 日熟練度訓練。
- 城鎮教師對應熟練度固定 Lv.5。
- 訓練只給 MXP，不給技能。
- 書店只販售基礎書；學習資格與知識寫入由 Progression 處理。
- 高級書只由探索內容取得，極品書只由 Boss 內容取得。

---

## 9. 不變量與測試

1. 每個 ShopOffer 恰好引用一個 active ItemInstance。
2. CityState 不得保存第二份永久庫存 Item ID 清單。
3. 同一 ItemInstance 同時最多對應一個 available Offer。
4. playerSold Item 在下一次刷新清除；Quest 保留中的 Item 除外。
5. 未售出的 permanentStock Offer 刷新後回到永久庫存，不得消失。
6. 玩家主角每一世界日的 `commerceInteractionCount <= 6`；City State 不得保存任何對話計數或好感值。
7. 交易被拒絕、回滾或未成功完成時，交易計數與交流 MXP 都不得變動；情報揭露與 Social 額度消耗必須同成同敗。
8. 玩家隊友與 NPC 的市場交易及酒館出席不得寫入 `playerCommerceUsage`，也不得發出玩家交流完成事件。
9. 書店一般販售池不得包含高級／極品書。
10. EscortCandidate 不是 Character；只在 Quest 接取後生成角色。
11. 城鎮零時間互動不推進世界日。
12. 住宿、訓練必須透過 Team 耗時行動；製作的 FreeAction 由 Crafting 配方建立。
13. 購買任一步驟失敗，不扣款、不移物、不關閉 Offer。
14. 已定案的房屋所有權、倉庫內容、休息／傳授入口與跨代移轉必須保持一致；功能間 Slot 規則只有在房間系統另案定義並啟用後才驗證，不得把 provisional 欄位當成第一版完成規則。
15. 買賣只能使用明確角色的個人帳戶與物品 Owner；City 不得要求或建立 Team Account。
16. 酒館清單內的冒險者都可打開近期行動對話與發起招募；City 不自行保存第二份 NPC 名單。
17. NPC 市場交易只能使用其指定角色的個人帳戶與個人物品，且完全重用一般商店／房屋的庫存、報價與同城房屋唯一性規則。

---

## 10. City 模組交接清單

- [ ] City、Facility、Shop、Intel、Escort、Home JSON Schema。
- [ ] CityState、ShopOffer、IntelLead、EscortCandidate、HomeInstance、PlayerDailyCommerceUsage。
- [ ] `CityQuery` 與設施／Offer／情報 Query。
- [ ] 商店刷新、護衛生成與人口批次 Job。
- [ ] 購買、販售、設施行動、房屋 Workflow。
- [ ] 永久庫存、書籍層級、護衛非實體、玩家每日交易上限，以及情報與 Social 對話額度原子提交測試。
