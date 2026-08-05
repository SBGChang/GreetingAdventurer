# 共用核心契約

> **範圍：** 本文件是所有領域模組的共同語言。它只定義 ID、時間、資料 Reader、訊息信封、交易、排程與模組註冊規則；各模組自行擁有自己的 State、Command、Job 與 Event payload。
>
> **非範圍：** 不定義某個玩法的細節資料；那些由各模組文件負責。

---

## 1. 契約演進規則

1. 共用契約優先追求**明確、可序列化、向後相容**，而非泛化。
2. 新增 Command、Job、Event 時，只修改擁有模組的契約；完整聯集只在 `app/composition/game-contracts.ts` 組合。
3. 已公開欄位不得隨意改名或改變語意；必要時新增欄位並提供 migration。
4. 資料檔只能引用已公開的 ID 與 Resolver；不能以文字約定隱含行為。
5. 所有公共值都必須是 JSON 可表示的資料；不可放函式、Class、`Date`、`Map`、`Set` 或 DOM 物件。
6. 公開契約放在 `contracts/<module>/`；領域實作不可成為其他模組的型別來源。

---

## 2. 基本型別與 ID

以下以 pseudo-TypeScript 描述；實作時所有 `string` ID 必須以 branded type 防止誤用。

```ts
type WorldDay = number;              // 非負整數；世界日曆唯一權威
type DungeonMinute = number;         // 非負整數；玩家迷宮內局部時間
type Revision = number;              // 實體狀態變動時遞增
type Seed = string;
type JsonScalar = string | number | boolean | null;
type JsonValue = JsonScalar | JsonValue[] | { [key: string]: JsonValue };
type LocalizationKey = string;

type GameId = string;
type ModuleId = string;
type WorkflowId = string;
type MessageSourceId = ModuleId | WorkflowId;
type ContentPackId = string;
type NationId = string;
type CultureId = string;
type RegionId = string;
type CityId = string;
type RouteId = string;
type MapTemplateId = string;
type MapInstanceId = string;
type ContentInstanceId = string;
type RoomId = string;
type RoomLinkId = string;
type FixedTrapId = string;
type PlayerMapKnowledgeId = string;
type TrapDefinitionId = DefinitionId;
type TeamId = string;
type CharacterId = string;
type QuestId = string;
type ContentEventDefinitionId = DefinitionId;
type ConditionDefinitionId = DefinitionId;
type EffectDefinitionId = DefinitionId;
type PlayerTravelEventPoolId = DefinitionId;
type PlayerTravelEventDefinitionId = DefinitionId;
type PlayerTravelEventWeightProfileId = DefinitionId;
type PlayerTravelEventBindingRuleId = DefinitionId;
type PlayerTravelEventInstanceId = string;
type ContentEventInstanceId = string;
type ItemInstanceId = string;
type AssetDistributionId = string;
type ActivityRecordId = string;
type EconomyAccountId = string;
type EconomyTransferId = string;
type ShopOfferId = string;
type PlayerConversationUsageId = string;
type PlayerCommerceUsageId = string;
type EncounterId = string;
type EncounterPoolId = DefinitionId;
type CraftingAttemptId = string;
type EncumbranceResolutionId = string;
type CraftingRecipeId = DefinitionId;
type CuisineRecipeId = DefinitionId;
type MaterialAffixId = DefinitionId;
type MaterialTagId = DefinitionId;
type ItemTagId = DefinitionId;
type SkillTagId = DefinitionId;
type FoodAffixId = DefinitionId;
type CraftQualityRuleId = DefinitionId;
type RestaurantMenuId = DefinitionId;
type RestaurantMealVariantId = DefinitionId;
type NpcCuisineDecisionRuleId = DefinitionId;
type CraftQuality = 'plain' | 'fine' | 'excellent' | 'perfect' | 'peerless' | 'demonGod';
type ExperienceAwardRuleId = DefinitionId;
type PlayerConversationRuleId = DefinitionId;
type PlayerAffinityRuleId = DefinitionId;
type NpcMarriageRuleId = DefinitionId;
type WorldAdventurerGenerationRuleId = DefinitionId;
type PlayerCommerceDailyLimitId = DefinitionId;
type PlayerCommercePracticeRuleId = DefinitionId;
type NonPlayerMemberDailySocialPracticeRuleId = DefinitionId;
type RecruitmentRuleId = DefinitionId;
type TeamFormationRuleId = DefinitionId;
type NpcTravelRuleId = DefinitionId;
type SupportMasteryAwardRuleId = DefinitionId;
type ChildEducationRuleId = DefinitionId;
type ChildStudySessionId = string;
type HomeTeachingPostId = string;
type DefinitionId = string;
type JobId = string;
type EventId = string;
type CommandId = string;
type InteractionId = string;
type TransactionId = string;
type CorrelationId = string;
type RngStreamId = string;
type ContentEventContext = 'playerTravel' | 'dungeon' | 'city';

type PlayerTravelEscortQuestRef = {
  questId: QuestId;
  targetCharacterId: CharacterId;
  actualEndDeadline: WorldDay;
  revision: Revision;
};
```

### 2.1 ID 不變量

- ID 在其種類內永久唯一，不因刷新、轉移或到期重用。
- 靜態 Definition ID 由資料檔作者指定；Runtime Instance ID 由核心 ID 產生器依世界 seed 與序號建立。
- 任何跨模組關係只儲存 ID；不可將另一模組的完整 Runtime Entity 嵌入本模組 State。

---

## 3. 根狀態與時間

```ts
type SaveMeta = {
  saveSchemaVersion: number;
  moduleVersions: Record<ModuleId, number>;
  contentManifestVersion: string;
  contentManifestHash: string;
};

type CoreState = {
  worldDay: WorldDay;
  worldSeed: Seed;
  nextRuntimeSequence: number;
  scheduler: SchedulerState;
};

type ModuleStateRegistry = {
  character: CharacterState;
  map: MapState;
  team: TeamState;
  adventurerLifecycle: AdventurerLifecycleState;
  dungeon: DungeonState;
  city: CityState;
  inventory: InventoryState;
  quest: QuestState;
  progression: ProgressionState;
  combat: CombatState;
  combatSequence: CombatSequenceState;
  world: WorldState;
  economy: EconomyState;
  distribution: AssetDistributionState;
  crafting: CraftingState;
  social: SocialState;
};

type GameState = {
  meta: SaveMeta;
  core: CoreState;
} & ModuleStateRegistry;
```

`ModuleStateRegistry` 與 `GameState` 屬於 `app/composition`，不是 `contracts/core`。新增模組時只新增該模組自己的 State contribution，再由組裝層納入 Registry；領域模組不得 import 完整 `GameState`。

### 3.1 時間規則

- `worldDay` 只由核心時間推進器變更。
- 城內零時間互動不變更 `worldDay`。
- 玩家迷宮的 `DungeonMinute` 屬於 dungeon 模組；一旦跨越午夜，dungeon 要求核心將世界推進至下一日。
- 非玩家隊伍不使用分鐘制；它們只在每日 Job 中推進。
- `advanceWorldToDay` 可略過沒有 Job 的日期，但在可觀察結果上必須等同逐日推進。

---

## 4. 靜態資料讀取契約

### 4.1 資料生命週期

```text
ContentRepository
  → RawContentManifest / RawContentPack
  → Schema Validation
  → Reference Validation
  → Rule Validation
  → DefinitionRegistry
  → 窄化 Definition Reader
  → 領域模組
```

```ts
interface ContentRepository {
  loadManifest(): RawContentManifest;
  loadPack(packId: ContentPackId): RawContentPack;
}

interface DefinitionRegistry {
  contentVersion(): ContentVersion;
  getDefinition<T extends Definition>(id: DefinitionId): T;
}
```

`ContentRepository` 屬 platform／app；`DefinitionRegistry` 屬 data-runtime。領域模組只能接收為自己窄化後的 Reader，例如 `MapDefinitionReader`、`TeamDefinitionReader`。

### 4.2 Definition 共通欄位

```ts
type DefinitionHeader = {
  id: DefinitionId;
  schemaVersion: number;
  packId: ContentPackId;
  enabled: boolean;
};
```

- 所有 JSON Definition 都必須含有這些欄位。
- `enabled: false` 的內容可被資料載入器讀到，但不得進入新遊戲生成池。
- 跨檔引用只能以 Definition ID 表達；不得以顯示名稱或檔名引用。
- Manifest 必須宣告 Pack 載入順序與相依版本；相同 Definition ID 不可默默覆蓋。
- 除非 Manifest 明確宣告相容替代，缺少存檔引用中的 Definition ID 必須中止載入並提供可定位錯誤。
- 所有生成池在驗證後使用固定排序；不得依檔案系統列舉順序影響 RNG 結果。

### 4.3 合法的資料驅動範圍

資料可指定：數值、權重、條件組、效果組、生成池、引用關係、Resolver ID 與 UI 顯示資料。

資料不可指定：任意程式碼、函式名稱字串後再動態執行、檔案路徑操作、平台 API 呼叫。

```ts
type EffectTarget =
  | { kind: 'actor' }
  | { kind: 'allFormalTeamMembers' };
```

完整的 Condition／Effect union 由 Data Runtime 契約唯一維護；共用層只提供跨模組都會使用的目標種類。新增 `kind` 才需要修改程式與 Schema；新增一筆使用既有 `kind` 的內容只需資料檔。

---

## 5. 四類訊息契約

架構只允許四種訊息；名稱與處理語意不可混用。

| 類型 | 語意 | 處理者 | 可以拒絕 | 可以有多個訂閱者 |
|---|---|---:|---:|---:|
| `GameCommand` | 玩家／UI 想做某事。 | 恰好一個入口模組 | 是 | 否 |
| `InternalCommand` | 某模組要求另一模組執行明確能力。 | 恰好一個目標模組 | 是 | 否 |
| `DomainEvent` | 某件事已經發生。 | 零到多個訂閱者 | 否 | 是 |
| `ScheduledJob` | 指定世界日執行某個模組工作。 | 恰好一個擁有模組 | 可因失效安全跳過 | 否 |

`Requested`、`Try`、`Authorize` 這類尚未完成的請求不得宣告成 `DomainEvent`。事件使用過去式或完成式，例如 `ItemTransferred`、`KnowledgeLearned`。

### 5.1 玩家命令

```ts
type GameCommandEnvelope<TCommand> = {
  commandId: CommandId;
  issuedAtWorldDay: WorldDay;
  actorTeamId: TeamId;
  command: TCommand;
};

type CommandRejection = {
  code: string;
  sourceModule: ModuleId;
  details?: Record<string, string | number | boolean>;
};

type GameCommandResult<TResult> =
  | { accepted: true; result: TResult }
  | { accepted: false; rejection: CommandRejection };
```

- View 只建立 `GameCommandEnvelope`；不可直接建立 Internal Command、Job 或 Event。
- View 不可先行修改背包、日期、任務或角色狀態。
- 每種 Game Command 只有一個入口 Handler；入口 Handler 可啟動 Internal Command 鏈。

### 5.2 內部命令

```ts
type InternalCommandEnvelope<TCommand> = {
  commandId: CommandId;
  transactionId: TransactionId;
  correlationId: CorrelationId;
  causationId: CommandId | EventId | JobId;
  source: MessageSourceId;
  targetModule: ModuleId;
  command: TCommand;
};

type InternalCommandResult<TResult> =
  | { accepted: true; commandId: CommandId; result: TResult }
  | { accepted: false; commandId: CommandId; rejection: CommandRejection };
```

- Internal Command 必須有唯一 Handler，並可回覆具型別的拒絕原因。
- Rejected Handler 不得修改 Slice、產生 Job、Event 或後續 Internal Command。
- 發送者只能依賴目標模組的公開 Command 契約，不能呼叫其 reducer、repository 或內部 service。
- 需要另一模組「做事」時使用 Internal Command；不能以 Event 偽裝請求。

### 5.3 組合型別的位置

各模組在自己的 contract package 公開局部聯集：

```ts
type MapGameCommand = EnterAdventureMapCommand | ...;
type MapInternalCommand = ApplyNpcDungeonSettlementCommand | ...;
type MapScheduledJob = MapRefreshCheckJob;
type MapDomainEvent = MapRefreshedEvent | MapContentResolvedEvent | ...;
```

只有組裝層可以建立全遊戲聯集：

```ts
type GameCommand = MapGameCommand | TeamGameCommand | ...;
type GameInternalCommand = MapInternalCommand | InventoryInternalCommand | ...;
type GameScheduledJob = MapScheduledJob | TeamScheduledJob | ...;
type GameDomainEvent = MapDomainEvent | TeamDomainEvent | ...;

type TransactionMessage =
  | InternalCommandEnvelope<GameInternalCommand>
  | DomainEventEnvelope<GameDomainEvent>;

type TransactionMessageDraft =
  | InternalCommandDraft<GameInternalCommand>
  | DomainEventDraft<GameDomainEvent>;
```

Draft 不含 `commandId / eventId / transactionId / correlationId / causationId / occurredOnDay`；Transaction Runner 依當前因果來源統一補上，模組不得自行偽造信封欄位。

核心路由只依賴共通信封與 Module Registry；不要求每個領域模組修改同一份巨型 union。

---

## 6. 排程 Job 契約

```ts
type JobPhase =
  | 'completeAction'   // A：已花完時間的行動完成
  | 'closeDeadline'    // B：期限與鎖定
  | 'worldCadence'     // C：固定世界週期
  | 'worldReaction'    // D：事實後續反應
  | 'scheduleNext';    // E：排下一輪

type ScheduledJobBase<
  TType extends string,
  TOwner extends ModuleId,
  TTarget extends GameId,
  TPayload
> = {
  jobId: JobId;
  type: TType;
  dueDay: WorldDay;
  phase: JobPhase;
  priority: number;
  ownerModule: TOwner;
  targetId: TTarget;
  expectedRevision?: Revision;
  rngStreamId?: string;
  payload: TPayload;
};
```

`expectedRevision` 用於使舊 Job 失效。例如隊伍改變大動作後，舊的 `teamPlanDue` 不需要從 Scheduler 實體刪除；到期時 revision 不符便跳過。

### 6.1 模組自己的 Job

```ts
type QuestDeadlineJob = ScheduledJobBase<
  'questDeadline',
  'quest',
  QuestId,
  {
  deadlineKind: 'accept' | 'actualEnd';
  }
>;

type MapRefreshCheckJob = ScheduledJobBase<
  'mapRefreshCheck',
  'map',
  MapInstanceId,
  {
  reason: 'regular' | 'pending';
  }
>;

type TeamPlanDueJob = ScheduledJobBase<
  'teamPlanDue',
  'team',
  TeamId,
  {
  planId: TeamPlanId;
  }
>;

type NpcDungeonDayJob = ScheduledJobBase<
  'npcDungeonDay',
  'dungeon',
  NpcDungeonRunId,
  {}
>;

type FoodStatusExpiryJob = ScheduledJobBase<
  'foodStatusExpiry',
  'crafting',
  CharacterId,
  { foodStatusRevision: Revision }
>;

type NpcCuisineDecisionDueJob = ScheduledJobBase<
  'npcCuisineDecisionDue',
  'crafting',
  CharacterId,
  {}
>;
```

每種 Job 的玩法欄位只放入 payload；擁有模組與目標 ID 型別由 Base 泛型固定。完整 payload 由擁有模組定義，再於組裝層形成 `GameScheduledJob`。

### 6.2 Scheduler 規則

1. Scheduler 以 `dueDay → phase → priority → jobId` 排序。
2. 同一天新建立的 Job，若屬於新的角色行動，最早 `dueDay = currentDay + 1`。
3. 處理器發現 target 不存在、已到期或 revision 不符時，記錄可選 debug event 後跳過，不得拋出未處理例外。
4. Pending 地圖離開時只建立次日的 `mapRefreshCheck(reason: pending)`，不得立即刷新。
5. Scheduler 是 Runtime State 的可重建快取；存檔可保存它以加速載入，但讀檔後必須能由各 Slice 驗證／重建。
6. 一筆 Job 只開啟一筆交易；該交易產生的事件鏈全部結束後，才處理同日下一筆 Job。
7. 交易中新增同日 Job 時，只能排入尚未執行的較後相位；不得回排較早相位或形成同日無限迴圈。

---

## 7. DomainEvent 契約

### 7.1 共通信封

```ts
type DomainEventBase = {
  eventId: EventId;
  transactionId: TransactionId;
  occurredOnDay: WorldDay;
  sourceModule: ModuleId;
  correlationId: CorrelationId;
  causationId: CommandId | EventId | JobId;
};

type DomainEventEnvelope<TEvent> = DomainEventBase & {
  event: TEvent;
};
```

### 7.2 事件處理規則

1. 模組只能修改自己的 Slice，然後 emit `DomainEvent`。
2. 其他模組訂閱公開事件後修改自己的 Slice；不可反向呼叫來源模組內部函式。
3. Event Router 以固定訂閱順序執行；順序是架構資料，不依 import 順序決定。
4. 「世界事實的後續反應」是同一處理交易中的事件鏈，不是每日掃描或另一個模糊的 `WorldFactChanged` Job。
5. 事件是已發生的結果，不是可取消的命令。
6. Event Subscriber 不可用業務理由拒絕已發生事件；若反應需要可能失敗的操作，必須發出 Internal Command。
7. 事件名稱以事實為主，不使用 `Requested`。Debug／UI 可記錄事件，但只能在交易提交後觀察。

### 7.3 第一版跨模組 Internal Command

以下是跨模組「要求做事」的基準名稱；詳細 payload 由目標模組契約擁有。

| Internal Command | 發送者 | 唯一處理者 | 目的 |
|---|---|---|---|
| `CreateItemInstance` | map、city、workflow | inventory | 依已驗證的內容結果，在指定初始位置建立物品實體。 |
| `RemoveItemInstance` | city、quest、distribution、content-event workflow | inventory | 依明確原因永久移除指定實體。 |
| `TransferItem` | map、city、quest、distribution、workflow | inventory | 將指定實體移往明確位置並指定合法個人 Owner／Escrow。 |
| `SetMapRefreshLock` | quest | map | 建立或解除鎮壓／討伐刷新鎖。 |
| `ProtectMapContent` | quest | map | 建立或解除委託內容保護。 |
| `StartNpcDungeonRun` | team | dungeon | NPC 隊伍抵達冒險地後建立 Run。 |
| `StartNpcTeamPlan` | adventurer-lifecycle | team | 依已保存的 ActionChain 節點啟動 NPC 旅行、進圖、返城或城市自由活動 Plan。 |
| `AssignNpcMemberFreeAction` | adventurer-lifecycle | team | 在合法 `cityFree` Plan 中為指定非玩家主角正式成員建立一筆資料化個人自由行動。 |
| `RecordTeamWorkSettlementValue` | quest／dungeon／travel workflow | team | 以冪等 Entry 記錄留隊結算所需的任務／地牢收入或旅費；不得計入裝備購買支出。 |
| `StartChildStudyPlan` | progression／child-study workflow | team | 為位於家中的單人 Child Team 建立 14 日學習 Plan。 |
| `ApplyNpcDungeonSettlement` | dungeon | map | 原子套用 NPC 暫存探索結果；命令必須攜帶對應 Distribution ID。 |
| `ResolvePlayerMapContent` | dungeon | map | Combat 結果回到 Dungeon 後，正式處理玩家已完成的地圖內容；命令必須攜帶目前 Session 的 Distribution ID。 |
| `OpenMapDoor` | dungeon | map | 將目前 Map Version 的指定紅門設為已開啟；同版本重複要求必須冪等。 |
| `ResolveMapTrap` | dungeon | map | 將目前 Map Version 的固定陷阱設為已觸發或已解除。 |
| `HarvestMapGatheringNode` | gathering workflow | map | 將目前 Map Version 的指定固定採集點，以唯一 Resolution 標記為已採集。 |
| `ResolveGatheringSource` | dungeon、travel／reward workflow | gathering workflow | 選出最高採集等級參與者，解析產物並原子提交來源、物品與成果。 |
| `StartReturnFromDungeon` | dungeon | team | 玩家使用出口後建立返城大動作。 |
| `StartTimedCityAction` | city、progression、crafting | team | 建立隊伍級城市行動或成員自由行動。 |
| `CreateNpcTeam` | population workflow | team | 將已建立的世界冒險者組成 NPC 隊伍並排首次決策。 |
| `AttachQuestTemporaryMember` | quest workflow | team | 將已救出的救援任務暫時角色加入接取隊伍；護衛角色永遠不加入隊伍。 |
| `ReserveQuestItem` | quest | inventory | 將指定實體保留給委託。 |
| `ReserveCraftingInputs` | crafting | inventory | 以 Crafting Attempt 原子保留完整輸入素材；任一素材不合法時整批拒絕。 |
| `ApplyQuestItemLifecycle` | quest | inventory | 回收、釋放或保留指定任務物品。 |
| `MoveItemToTeamQuestCargo` | quest、city、map workflow | inventory | 將購買／送貨／探索指定品鎖進該 Quest 的任務物資空間。 |
| `ReleaseExpiredQuestCargo` | quest workflow | inventory | 將 expired Quest 仍鎖定的物品移入指定 Asset Distribution Escrow。 |
| `ConsumeBookForLearning` | progression | inventory | 驗證並依書籍政策消耗／保留書籍。 |
| `TransformCraftingItems` | crafting | inventory | 驗證已預留材料、消耗輸入並建立成品。 |
| `ConsumeCuisineIngredients` | crafting | inventory | 驗證自製料理所需食材的持有、數量與未保留狀態後原子消耗；料理不建立 Inventory 產物。 |
| `EvaluateTeamEncumbrance` | inventory／statistics workflow | inventory | 以最新 Carry Capacity Snapshot 檢查玩家隊，建立、延後或解除強制超載處理。 |
| `CommitCombatItemUse` | combat | inventory | 驗證並在同一交易提交戰鬥道具消耗與使用資料。 |
| `ConsumeCombatSequenceRetrySupply` | combat-sequence | inventory | 依 Retry Supply Policy 從本次參與者的個人背包原子消耗一份合法補品，成功後才允許重骰。 |
| `OpenPlayerTravelInteraction` | player-travel-event workflow | team | 將已擲定的玩家旅行事件實例寫入玩家隊 Pending；NPC Team 一律拒絕。 |
| `CompletePlayerTravelSegmentWithoutEvent` | player-travel-event workflow | team | 提交已擲定的 no-event 結果，完成玩家目前段落並安排下一段／抵達；不得建立空白 Pending。 |
| `MarkPlayerTravelInteractionAwaitingCombat` | player-travel-event workflow | team | 記錄事件已選定戰鬥分支及其 Encounter ID，旅行保持暫停。 |
| `CompletePlayerTravelInteraction` | player-travel-event workflow | team | 以已提交的選項／戰鬥結果清除 Pending，依隊伍可否繼續安排下一段或結束旅行。 |
| `CreateQuestTemporaryCharacter` | quest | character | 接取護衛或救出人物時建立任務暫時角色。 |
| `CreateWorldAdventurerBatch` | population workflow | character | 依城市文化、數量、World Adventurer Generation Rule 與 RNG Context 建立真實冒險者。 |
| `ApplyCharacterReputationEffect` | quest、workflow | character | 套用已驗證的聲望效果。 |
| `CreatePartnerFamilyLink` | marriage workflow | character | 驗證雙方成年、存活、異性且未婚後，原子建立唯一 active 伴侶關係。 |
| `ApplyContentEventStatus` | content-event workflow | character | 依已驗證 Event Instance／Effect 對明確角色套用暫時狀態。 |
| `OpenCharacterRelationshipFact` | quest、content-event workflow | character | 建立角色與人物／組織間的未了結事項。 |
| `ResolveCharacterRelationshipFact` | quest、content-event workflow | character | 解決一筆既有的關係事項。 |
| `ApplyCombatCondition` | combat | character | 套用戰鬥後生命、魔力與狀態。 |
| `ApplyFoodStatusEffects` | crafting workflow | character | 依 FoodStatus 原子套用或移除其來源明確的暫時效果。 |
| `ReserveShopOfferForQuest` | quest | city | 將指定貨架商品綁定任務。 |
| `ReleaseQuestShopOffer` | quest | city | 依任務結果釋放或清理貨架商品。 |
| `RevealTavernIntel` | city-intel workflow | city | 驗證酒館、隊伍與情報後標記揭露；與 Social 對話額度在同一交易提交。 |
| `SetFacilityAvailability` | world／content-event workflow | city | 依已驗證的世界或內容效果改變城市設施可用狀態。 |
| `InterruptHomeTeachingPost` | child-study workflow | city | 教師死亡、退休、離隊或不可用時中斷家教 Post，讓既有學習週期先做部分結算再重抽。 |
| `ExecuteNpcMarketIntent` | adventurer-lifecycle | city workflow | 以已保存的單筆 NPC Intent 重用既有買入、賣出或買房流程；拒絕時不得重抽目標。 |
| `TransferCurrency` | city、distribution、workflow | economy | 在兩個帳戶間原子移轉貨幣。 |
| `GrantCurrency` | distribution、workflow | economy | 從 system source 發放已驗證報酬或直售款。 |
| `RemoveCurrency` | city、distribution、workflow | economy | 將已驗證費用移往 system sink。 |
| `GrantContentEventMasteryExperience` | content-event workflow | progression | 依 Event Instance、Effect 與 Experience Award Rule 對明確角色發放一次冪等 MXP。 |
| `CreateEconomyAccount` | character、distribution、workflow | economy | 為新角色、城市或暫時資產分配建立帳戶；Team 不得擁有帳戶。 |
| `StartAssetDistribution` | quest、dungeon、workflow | distribution | 建立參與者快照、規則與清算帳戶。 |
| `AppendAssetDistributionResult` | quest、dungeon、map／gathering workflow | distribution | 在 collecting 階段加入已正式取得的物品與貨幣。 |
| `FinalizeAssetDistributionCollection` | quest、dungeon | distribution | 關閉收集並依玩家競拍、NPC RNG 或純貨幣均分開始結算。 |
| `ClaimQuestForNpcTeam` | adventurer-lifecycle | quest | 對仍可接取且未被其他 NPC 標記的 Quest 建立不阻擋玩家的 NPC 意向 Claim。 |
| `ReleaseNpcQuestClaim` | adventurer-lifecycle | quest | ActionChain 結束、目標失效或正式接取後移除 NPC 意向 Claim。 |
| `AcceptQuestForNpcTeam` | adventurer-lifecycle | quest | 以 active ActionChain 在發佈公會重用正式接取驗證與保護流程。 |
| `SettleQuestForNpcTeam` | adventurer-lifecycle | quest | 以 active Quest Chain 在原接取公會重用正式結案流程。 |
| `ChangeRegionControl` | world workflow | world | 改變地區控制國。 |
| `SetRouteAccess` | world workflow | world | 改變路線開放狀態。 |
| `ApplyMarketPressure` | world workflow | world | 建立或解除市場壓力。 |
| `ApplyEventWeightModifier` | world、content-event workflow | world | 建立或解除內容事件權重修正。 |
| `SetWorldFact` | content-event、quest、world workflow | world | 更新已註冊且型別合法的世界旗標。 |
| `StartCombatEncounter` | dungeon、map／player-travel-event workflow | combat | 依地圖內容或已擲定的玩家旅行事件建立 detailed 戰鬥遭遇。 |
| `StartCombatSequence` | dungeon／single-battle-sweep workflow | combat-sequence | 以固定參與者、配置、戰力、Challenge 與 RNG Snapshot 建立可跨日的簡易戰鬥串。 |
| `ResolveNextCombatSequenceChallenge` | dungeon／single-battle-sweep workflow | combat-sequence | 只解析目前游標指向的下一個 Challenge，並依資料化補品政策處理至多一次重骰。 |
| `SkipNextCombatSequenceChallenge` | dungeon | combat-sequence | 來源內容在嘗試前已失效時，不耗 RNG、不給經驗並同步推進戰鬥串游標。 |
| `StopCombatSequence` | host workflow | combat-sequence | 停止解析後續節點並轉入等待來源正式提交的階段。 |
| `CommitCombatSequenceSourceResults` | dungeon settlement／single-battle source workflow | combat-sequence | 只接受來源正式採納的成功 Result ID，完成唯一一次成長分配與結算。 |
| `InvalidateCombatSequence` | dungeon、team、save migration | combat-sequence | 來源、隊伍或快照失效時終止戰鬥串，且不得發放成長。 |
| `ReleaseCombatSequence` | host workflow | combat-sequence | Host 不再引用後，移除已 settled／invalid 的戰鬥串 Runtime Aggregate。 |
| `TransferHomeOwnership` | inheritance workflow | city | 將房屋移轉給已選定的合法繼承人。 |
| `ApplyCityMetricEffect` | world、quest、content-event workflow | city | 調整已驗證的繁榮／安全數值。 |
| `ProvisionPlayerAffinity` | new-game／character-provisioning／adulthood workflow | social | 對新建立或剛取得冒險者身分的非玩家真實冒險者建立唯一一筆對玩家好感初值；重送必須冪等。 |
| `ConsumePlayerConversationAllowance` | city-intel workflow | social | 在情報揭露的同一交易中消耗玩家當日一次對話額度並建立交流成長事實。 |
| `ResolveNpcMarriageProposal` | adventurer-lifecycle | marriage workflow | 以已固定的提案者、目標、Team 與規則重驗資格，讀取共隊天數與同一 Combat Power 後執行一次可重播判定；成功時要求 Character 建立伴侶 FamilyLink。 |

### 7.4 第一版跨模組 Domain Event

| Event | 來源 | 典型訂閱者 | 目的 |
|---|---|---|---|
| `MapRefreshed` | map | dungeon、quest、city、ui/app | 地圖已建立新版本。 |
| `MapContentGenerated` | map | quest、city | 依新內容建立委託、情報或庫存反應。 |
| `MapContentResolved` | map | player-content workflow、quest、progression | 內容正式被處理後建立一般成果、任務指定品與成長後果。 |
| `MapRefreshPendingRegistered` | map | ui/app、debug | 固定刷新因地圖仍有人而改排下一日檢查；不代表已經刷新。 |
| `MapRefreshLockChanged` | map | quest、ui/app | 刷新鎖已正式建立或解除。 |
| `MapDoorOpened` | map | dungeon、ui/app | 紅門已在目前 Map Version 開啟。 |
| `MapTrapResolved` | map | dungeon、ui/app | 固定陷阱已在目前 Map Version 觸發或解除；角色效果已由同一 Workflow 提交。 |
| `MapGatheringNodeHarvested` | map | dungeon、ui/app | 固定採集點已在目前 Map Version 由唯一採集 Resolution 消耗。 |
| `TeamLocationChanged` | team | map、dungeon、quest | 更新地圖進入人數、探索／護衛條件。 |
| `TeamPlanChanged` | team | dungeon | 抵達／離開冒險地時建立或關閉 Run。 |
| `TeamPlanCompleted` | team | city、character、progression、quest | 耗時大動作的時間條件已達成。 |
| `TeamMemberJoined` | team | city、quest、ui/app | 真實冒險者已成為一支隊伍的正式成員。 |
| `TeamMemberDeparted` | team | city、quest、ui/app | 正式成員已因招募、解雇或不可用而離隊。 |
| `TeamCombatFormationChanged` | team | combat、ui/app | 下一場 Encounter 使用的持久九宮格配置已被原子替換；不改寫 active Combat。 |
| `AdventurerActivityRecorded` | team | city、ui/app | 一名真實冒險者的近期行動紀錄已更新。 |
| `FreeActionCompleted` | team | progression、city | 城鎮自由行動的時間條件已達成；物品操作仍由後續 Internal Command 執行。 |
| `FreeActionChanged` | team | ui/app | 成員自由行動的狀態或累積進度已改變。 |
| `TeamWorkSettlementChanged` | team | ui/app、debug | 留隊檢定使用的工作收支視窗已新增一筆冪等項目。 |
| `TravelSegmentReached` | team | player-travel-event workflow | **玩家隊伍**旅行前／中／後段已到期，應依資料解析一次旅行事件；NPC 永不發布。 |
| `PlayerTravelEventResolved` | team | ui/app、debug | 玩家旅行事件已完成或 no-event 結果已提交；只供紀錄／投影，成長與 Quest 後果已由正式 Effect／Combat／位置事件處理。 |
| `NpcDungeonSettlementApplied` | map | npc-dungeon-settlement workflow、dungeon、quest | 回傳實際成功套用的內容結果；Dungeon 再把其中 accepted 戰鬥 Result 提交給 Combat Sequence，Progression 不直接平均分配。 |
| `PlayerDungeonSessionStarted` | dungeon | ui/app | 玩家隊已對特定 Map Version 建立探索 Session。 |
| `PlayerDungeonTimeAdvanced` | dungeon | kernel、ui/app | 玩家地牢分鐘已增加，必要時要求核心處理跨日。 |
| `NpcDungeonRunProgressed` | dungeon | ui/app、debug | NPC Run 已消耗本日點數並推進有序內容游標。 |
| `NpcDungeonRunClosed` | dungeon | team、ui/app | NPC 地牢 Run 已完成或結束。 |
| `InventoryTransferred` | inventory | quest | 檢查購買／探索等持有條件。 |
| `ItemInstanceCreated` | inventory | map、city、quest | 新實體物品已建立。 |
| `ItemReservationChanged` | inventory | quest | 委託或製造保留狀態已變更。 |
| `ItemConsumed` | inventory | quest、ui/app | 指定實體物品已消耗；專用流程另有更精確事件。 |
| `ItemRemoved` | inventory | city、quest、map、ui/app | 指定實體已依明確生命週期原因永久移除。 |
| `EquipmentChanged` | inventory | character、combat、ui/app | 角色裝備位置已改變。 |
| `WeaponSetConfigured` | inventory | combat、ui/app | 三組武器之一的裝備與技能引用已更新。 |
| `CombatItemUseCommitted` | inventory | combat | 戰鬥道具已在本交易消耗，並提供延遲／效果資料。 |
| `CombatSequenceRetrySupplyConsumed` | inventory | combat-sequence | 一份合法補品已由明確參與者背包原子消耗，戰鬥串才可進行該次重骰。 |
| `BookUseCommittedForLearning` | inventory | progression | 指定書籍已依政策消耗或確認保留。 |
| `CraftingItemsTransformed` | inventory | crafting workflow、ui/app | 製作材料與成品實體已完成轉換。 |
| `QuestStateChanged` | quest | team、ui/app | 更新護衛對象、通知與可交付狀態。 |
| `QuestCreated` | quest | map、city、ui/app | 世界內容已轉成一筆具絕對期限的委託。 |
| `QuestAccepted` | quest | city、character、ui/app | 隊伍已在期限前接取委託。 |
| `NpcQuestClaimChanged` | quest | adventurer-lifecycle、ui/app | NPC ActionChain 的非排他意向 Claim 已建立或釋放；玩家仍可接取。 |
| `QuestObjectiveCompleted` | quest | city、ui/app | 目標已達成但仍須回原公會結案。 |
| `QuestSettled` | quest | progression、team、city、ui/app | 已在原接取公會正式結案並可發放成長、記錄冒險者近期行動。 |
| `CharacterAvailabilityChanged` | character | team | 角色死亡、離隊或恢復可用時更新隊伍。 |
| `CharacterCreated` | character | character-provisioning workflow、team、ui/app | 世界、子女或暫時角色已建立；真實冒險者由 Workflow 建立個人帳戶與初始 Inventory 容器。 |
| `CharacterConditionChanged` | character | combat、ui/app | 角色生命、魔力或暫時狀態已變更。 |
| `CharacterReputationChanged` | character | economy、quest、ui/app | 角色聲望已改變，依賴聲望的報價需要失效。 |
| `CharacterDied` | character | team、quest、progression | 角色死亡後的清理與繼承處理入口。 |
| `CharacterBorn` | character | progression、ui/app | 年度休息成功產生子女。 |
| `CharacterBecameAdult` | character | team、progression、population workflow、ui/app | 子女已到成年門檻，可依規則成為冒險者。 |
| `CharacterRetired` | character | team、inheritance workflow、ui/app | 角色已退休並退出活動身份。 |
| `CharacterRelationshipChanged` | character | city、quest、content-event workflow、ui/app | 一筆角色關係事項已建立或解決。 |
| `FamilyLinkChanged` | character | social、team、progression、ui/app | 伴侶、監護或收養關係已建立或終止；婚姻成功以 `kind=partner` 表示。 |
| `TemporaryCharacterRecovered` | character | team、quest | 任務暫時角色已回收；Quest 解除關聯，Team 僅在救援角色確實曾加入 `temporaryMemberIds` 時移除成員。 |
| `RegionControlChanged` | world | map、city、combat、ui/app | 地區控制國已改變。 |
| `HumanEnemyCultureChanged` | world | map、combat | 占領改變後，新生成的人類敵人改讀目前控制文化。 |
| `RouteAccessChanged` | world | team、quest、ui/app | 城市路線通行狀態已改變。 |
| `ConflictStarted` | world | city、quest、ui/app | 國家衝突已正式開始。 |
| `ConflictResolved` | world | city、quest、ui/app | 國家衝突已正式結束並帶有結果。 |
| `MarketPressureChanged` | world | economy、city、ui/app | 世界市場修正已改變。 |
| `EventWeightModifierChanged` | world | team、map、city、content-event workflow | 旅行／地圖／城市事件權重修正已改變。 |
| `WorldFactChanged` | world | content-event workflow、quest、city、ui/app | 已註冊的世界旗標值已改變。 |
| `CurrencyTransferred` | economy | city、quest、ui/app | 帳戶餘額已原子移轉。 |
| `EconomyAccountCreated` | economy | character-provisioning workflow、distribution、ui/app | 角色或暫時清算帳戶已建立。 |
| `PriceQuoteInvalidated` | economy | city、ui/app | 報價依賴的市場、聲望、好感或內容 revision 已改變，舊 Quote 不可提交。 |
| `AssetDistributionStarted` | distribution | dungeon、quest、ui/app | 已建立固定參與者的共同成果分配。 |
| `LootAuctionRoundOpened` | distribution | ui/app | 玩家隊有一件物品進入內部出價回合；阻塞語意另由標準 `PlayerInteractionOpened` 表示。 |
| `LootItemAwarded` | distribution | dungeon、quest、ui/app | 指定物品已成為一名正式參與角色的個人財產。 |
| `LootItemDirectSold` | distribution | dungeon、quest、ui/app | 流標物已依原價值 80% 直售並把款項放入清算帳戶。 |
| `AssetDistributionCompleted` | distribution | dungeon、quest、team、ui/app | 全部物品與貨幣已成為個人財產，清算帳戶與 Escrow 已清空。 |
| `ShopRefreshed` | city | quest、ui/app | 商店已完成本期貨架刷新。 |
| `ShopOfferCreated` | city | quest、ui/app | 真實 Item 已成為可購買 Offer。 |
| `ShopOfferSold` | city | quest、ui/app | 指定 Offer 的 Item 已售出。 |
| `CityStockItemAvailable` | city | quest、ui/app | 一件永久庫存物品已可成為需求來源。 |
| `EscortCandidatesGenerated` | city | quest | 本期匿名護衛候選已生成。 |
| `IntelRevealed` | city | ui/app | 一筆城市情報已在合法酒館互動中揭露。 |
| `HomeChanged` | city | character、inventory、ui/app | 房屋所有權或基礎狀態已改變。 |
| `HomeTeachingPostChanged` | city | team、progression、ui/app | 家教 Post 已建立、釋放或中斷。 |
| `AdventurerSupplyDemanded` | city | character／team population workflow | 城市人口批次要求建立指定數量的真實冒險者。 |
| `CityTrainingCompleted` | city | progression | 城鎮教師訓練已完成。 |
| `CraftingCompleted` | crafting | progression、ui/app | 耗時製作已完成；成功時成品與品質、失敗時素材去向都已原子提交，兩者使用同一食譜 MXP Rule。 |
| `CuisineConsumed` | crafting | progression、ui/app | 自製或餐館料理已立即套用 FoodStatus，可發放料理 MXP。 |
| `FoodStatusChanged` | crafting | character、ui/app | 角色料理狀態已套用或到期。 |
| `CityMetricsChanged` | city | population／content-event workflow、ui/app | 城市繁榮或安全已改變。 |
| `CombatEncounterResolved` | combat | dungeon、team、map、quest、player-travel-event workflow | 玩家戰鬥遭遇已完成；具型別 Source 決定由地圖或同源旅行事件續接，Quest 以明確 `outcome` 處理護衛戰敗。 |
| `CombatEncounterStarted` | combat | dungeon、player-travel-event workflow、ui/app | 玩家戰鬥遭遇快照已建立並帶有具型別 Source。 |
| `CombatActionResolved` | combat | ui/app | 一次技能、道具或其他合法戰鬥動作已解析。 |
| `CombatTeamOutcome` | combat | team | 隊伍行動能力因戰鬥結果改變。 |
| `CombatSequenceSettled` | combat-sequence | dungeon、team、ui/app | 一條單場／多場簡易戰鬥串已依來源 accepted Result 完成一次結算。 |
| `CombatSequenceInvalidated` | combat-sequence | dungeon、team、ui/app | 戰鬥串來源或隊伍快照失效，且不得發放成長。 |
| `CombatSequenceChallengeResolved` | combat-sequence | dungeon、single-battle-sweep workflow、quest | 一個簡易戰鬥節點已完成唯一一次最終成功／失敗判定；Quest 對失敗隊伍套用相同護衛終止規則。 |
| `EncumbranceResolutionOpened` | inventory | ui/app | 玩家隊至少一名角色超載，或旅行中的延後檢查已於抵達後轉為強制處理。 |
| `EncumbranceResolutionClosed` | inventory | ui/app | 玩家隊全部角色均已回到重量上限內，可解除阻塞畫面。 |
| `CombatSequenceReadyForSourceCommit` | combat-sequence | dungeon、single-battle-sweep workflow | 戰鬥串已無後續節點可解析，等待來源正式接受成功結果。 |
| `CombatAttackMasteryEarned` | combat／combat-sequence | progression | Detailed 已按實際傷害、Sequence 已按整串六分制權重分配攻擊成長來源。 |
| `CombatDefenseMasteryEarned` | combat／combat-sequence | progression | 已按來源開始時的 3／2／1 有人排規則分配防禦成長來源。 |
| `CombatSupportMasteryEarned` | combat／combat-sequence | progression | Detailed 的真實使用或 Sequence 的正式成功場次已轉成固定 Mastery MXP 來源。 |
| `GatheringResolved` | gathering workflow | progression、ui/app | 來源消耗與產物 Item 已原子提交；採集者依隊內最高採集等級決定，可正式發放採集 MXP。 |
| `CommerceInteractionCompleted` | city | progression、ui/app | 一筆買入或賣出已原子完成，可發放交流成長。 |
| `PlayerConversationCompleted` | social | progression、ui/app | 玩家完成一次隊友交流、酒館聊天或情報互動；三者共用每日六次。 |
| `PlayerAffinityChanged` | social | economy、ui/app | 一名真實冒險者對玩家的唯一好感值已改變。 |
| `NpcIntentSelected` | adventurer-lifecycle | ui/app、debug | NPC Team 已選定下一個非自由意圖與 ActionChain。 |
| `NpcActionChainChanged` | adventurer-lifecycle | ui/app、debug | NPC ActionChain 的節點或狀態已改變。 |
| `NpcMarketIntentCreated` | adventurer-lifecycle | city workflow、ui/app、debug | 非玩家主角角色已固定一筆待執行的買入、賣出或買房意圖。 |
| `NpcMarketIntentResolved` | adventurer-lifecycle | ui/app、debug | 已保存的 NPC 市場意圖已成功、拒絕或失效。 |
| `NonPlayerMemberFreeDaySocialPractice` | team | progression、ui/app | 非玩家主角的正式隊員在城市自由日得到的固定一次聊天與一次購物交流來源；包含玩家隊友與 NPC，不是實際交易或聊天。 |
| `TravelCompleted` | team | progression、quest | 一趟旅行已結束；玩家帶 3／6／9 日模式倍率，NPC 固定 6 日與 ×1。 |
| `MapExplorationCompleted` | dungeon | progression、quest | 玩家對某地圖版本的探索單位已完成，並附資料化 Experience Rule。 |
| `FacilityRestCompleted` | city | character | 住宿或家中一般休息已完成。 |
| `HomeYearRestCompleted` | team | character | 365 日年度休息已完成，Character 可執行生育判定。 |
| `MasteryExperienceGranted` | progression | ui/app、debug | 熟練度經驗已正式寫入。 |
| `MasteryLevelChanged` | progression | combat、ui/app | 熟練度等級已變更。 |
| `PrimaryAttributesChanged` | progression | combat、ui/app | 五項主屬推導結果已變更。 |
| `ProgressionCapacityChanged` | progression | character | 主屬推導結果可能使最大生命／魔力改變。 |
| `KnowledgeLearned` | progression | combat、city、ui/app | 技能、魔法或製作知識已正式學會。 |
| `AutomaticKnowledgeUnlocked` | progression | ui/app | 熟練度到達門檻後已自動取得基礎知識。 |
| `TeachingSessionChanged` | progression | team、ui/app | 成人傳授或子女學習 Session 的狀態與本次收益已改變。 |
| `PlayerSuccessorSelected` | team | inheritance workflow、ui/app | 玩家已選定新的隊伍 Leader，可開始資產繼承。 |
| `PlayerInteractionOpened` | 擁有互動的領域模組 | engine session、ui/app | 可存檔的玩家選擇已建立，世界快轉必須暫停。 |

---

## 8. 原子交易契約

每一個 Game Command 或到期 Job 都開啟一筆 `EngineTransaction`。Internal Command 與 DomainEvent 只在該交易內傳遞，直到訊息佇列清空。

```ts
type EngineTransaction = {
  transactionId: TransactionId;
  correlationId: CorrelationId;
  startedBy: CommandId | JobId;
  baseState: GameState;
  workingState: GameState;
  pendingMessages: TransactionMessage[];
  committedEventDrafts: GameDomainEventDraft[];
  scheduledJobDrafts: GameScheduledJobDraft[];
  status: 'running' | 'committed' | 'rejected';
};
```

交易規則：

1. 模組 Handler 只能產生自己的下一版 Slice；Router 將它放回 `workingState`。
2. Internal Command 被拒絕時，由啟動它的 Workflow 決定替代路徑；若該步驟標記為 `required`，整筆交易拒絕。
3. DomainEvent 已是事實，不能再以業務條件拒絕；訂閱者不變量失敗視為程式錯誤並中止交易。
4. 只有訊息佇列清空且全部不變量通過後，`workingState` 才一次取代 `baseState`。
5. UI Notification、存檔、音效與 Steam／平台副作用只讀取**已提交**的事件 Outbox。
6. 交易拒絕時，不提交 State、Job、Event 或平台副作用。
7. Handler 的 `outgoingMessages` 保留宣告順序，並插入既有待處理訊息之前；直接因果先完整處理，再回到呼叫者較後的訊息。
8. 一筆 Event 必須先依固定順序執行全部 Subscriber；所有 Subscriber 的輸出收集完成後，才進入下一層訊息。
9. Transaction Runner 必須設置最大訊息數與最大因果深度，防止命令／事件循環。

這使購買、學書、製作、委託物品移轉與地牢結算不會留下「一半成功」的世界狀態。

---

## 9. 模組註冊與回傳契約

```ts
type ModuleContract<TSlice> = {
  id: ModuleId;
  owns: StateSliceName;
  reads: readonly ReaderPortId[];
  handlesGameCommands: readonly string[];
  handlesInternalCommands: readonly string[];
  handlesJobs: readonly string[];
  subscribesTo: readonly string[];
  emits: readonly string[];
  invariants: readonly InvariantId[];
};

type ModuleResult<TSlice> = {
  nextSlice: TSlice;
  outgoingMessages: TransactionMessageDraft[];
  scheduledJobs: GameScheduledJobDraft[];
  cancelledJobIds?: JobId[];
  notifications?: Notification[];
};
```

- ModuleResult 不包含其他模組 Slice 的 patch。
- Handler 必須是 deterministic pure function；平台 I/O 在交易外透過 Port 執行。
- `app/composition` 只組合 ModuleContract、Definition Reader、Handler、Workflow 與 Projection；它不得放數值公式或玩法條件。
- 跨模組多步驟流程由 `app/workflows/` 的 Process Manager 編排；Workflow 只決定命令順序與失敗補償，不擁有領域 State 或玩法公式。

---

## 10. Query、Projection 與 ViewModel 契約

模組對外提供唯讀 Query；UI／Selector 可組合多個 Query，但不得持有可寫引用。

```ts
interface TeamQuery {
  getTeam(teamId: TeamId): TeamView;
  getPlayerTeamId(): TeamId;
  getPlayerCharacterId(): CharacterId;
}

interface MapQuery {
  getMapSummary(mapId: MapInstanceId): MapSummary;
  isTeamInside(mapId: MapInstanceId, teamId: TeamId): boolean;
}
```

需要同時組合多個模組的顯示結果時，使用 `app/read-models/` 的 Projection。會影響玩法的跨模組數值則交給已註冊的無 State Domain Service（例如 Derived Statistics），Projection 只能顯示其結果；任何來源模組都不能宣稱自己擁有完整結果。

ViewModel 屬 `ui/features/<feature>/selectors/` 或 `app/read-models/`，不屬任何領域模組。它可讀多個 Query，卻不能寫入 GameState 或執行 Job。

---

## 11. 最小測試契約

每一模組都必須提供：

1. 最小有效 Slice Fixture。
2. 最小有效 Definition Fixture。
3. 一個正常流程測試。
4. 一個拒絕／過期／失效 Job 測試。
5. 一個 Internal Command 拒絕測試。
6. 一個跨模組事件輸出測試。

核心必須額外提供：

```text
advanceWorldToDay(day + N)
等價於
重複 N 次逐日處理
```

的快轉一致性測試，以及：

- Required Internal Command 失敗時整筆 State 不變。
- Event 鏈完成前不會觀察到 UI／存檔／平台副作用。
- 同一輸入、Definition 與 RNG stream 必須產生完全相同的 State、Job 與 Event Outbox。
