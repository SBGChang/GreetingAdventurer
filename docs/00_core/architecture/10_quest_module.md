# Quest 模組契約

> **模組 ID：** `quest`
>
> **依賴：** [共用核心契約](00_shared_contracts.md)、World／City／Map／Team／Character／Inventory／Economy／Asset Distribution 的公開 Query。
>
> **責任：** 將已存在的世界內容轉成委託，管理委託類型、兩個絕對期限、四種狀態、接取者、目標實體、完成判定與原公會結案。Quest 不是物品、怪物、綁架或護衛需求的起點。

---

## 1. 邊界與所有權

### 1.1 Quest 唯一可寫的 State

```ts
type QuestState = {
  quests: Record<QuestId, QuestInstance>;
  guildPostingIndex: Record<CityId, QuestId[]>;
  sourceContentIndex: Record<GameId, QuestId[]>;
  npcClaims: Record<QuestId, NpcQuestClaim>;
};
```

### 1.2 Quest 不擁有的事

| 事實 | 所有者 | Quest 的角色 |
|---|---|---|
| 地圖怪物、Boss、綁架與物品內容 | map | 以 Content ID 綁定目標並要求保護／鎖定。 |
| ItemInstance、位置、保留與回收 | inventory | 保存目標 Item ID，生命週期以 Internal Command 處理。 |
| 商店 Offer | city | 保存 Offer ID，要求保留或解除。 |
| 隊伍位置與成員 | team | 用事件判定抵達、離圖與可結案地點。 |
| 護衛／救援的暫時角色 | character | 保存 Character ID；建立與回收由 Character 執行。 |
| 報酬金錢 | economy | 保存 Reward Rule；結案 Workflow 才發放。 |
| 任務報酬均分與逾期任務物資分配 | distribution | Quest 保存參與者快照並決定何時開始分配，不自行移轉資產。 |
| 任務熟練度 | progression | 只在 `QuestSettled` 後發放。 |

---

## 2. 靜態資料契約

### 2.1 QuestDefinitionReader

```ts
interface QuestDefinitionReader {
  getQuestReactionRule(id: QuestReactionRuleId): QuestReactionRuleDefinition;
  getQuestDeadlineRule(id: QuestDeadlineRuleId): QuestDeadlineRuleDefinition;
  getQuestRewardRule(id: QuestRewardRuleId): QuestRewardRuleDefinition;
  getQuestObjectiveRule(id: QuestObjectiveRuleId): QuestObjectiveRuleDefinition;
}
```

### 2.2 委託類型

```ts
type QuestKind =
  | 'purchase'
  | 'delivery'
  | 'escort'
  | 'rescue'
  | 'exploration'
  | 'suppression'
  | 'hunt';
```

每筆 Quest 生成時固定一個 `kind`，並對應同名任務熟練度；不得在完成後依玩家實際打法改類型。

### 2.3 內容反應規則

```ts
type QuestReactionRuleDefinition = DefinitionHeader & {
  sourceKind:
    | 'monsterGroup'
    | 'boss'
    | 'kidnap'
    | 'mapItem'
    | 'cityStockItem'
    | 'escortCandidate';
  questKind: QuestKind;
  creationChance: number;
  guildResolverId: ResolverId;
  deadlineRuleId: QuestDeadlineRuleId;
  objectiveRuleId: QuestObjectiveRuleId;
  rewardRuleId: QuestRewardRuleId;
};
```

既定基準：

- 怪物／控制類內容：當地居民 100% 在當地公會形成處理委託。
- Boss：形成討伐委託。
- 綁架：隨機一座合法城市 100% 形成救援委託。
- 地圖或城市庫存物品：依資料機率形成探索、購買或送貨委託；未形成時可只留下情報。
- EscortCandidate：形成護衛委託，但候選本身不是 Character。

### 2.4 期限規則

```ts
type QuestDeadlineRuleDefinition = DefinitionHeader & {
  acceptDurationDays: number;
  actualEndResolverId: ResolverId;
  maxCityGapCount?: number;
};
```

第一版已定規則：

| 類型 | 接受期限 | 實際結束期限 |
|---|---:|---|
| 購買／送貨 | 生成日 + 14 | 生成日 + 14 + 每個城市距離格各自 RNG 9～15 日；最多相隔 2 城。 |
| 救援／探索 | 生成日 + 7 | 生成日 + 7 + 每個城市距離格各自 RNG 9～15 日。 |
| 鎮壓／討伐 | 生成時固定 | 生成日 + 41 日（三個 14 日刷新期減 1 日）。 |
| 護衛 | 尚未定案 | Deadline Resolver 未啟用前不得生成。 |

所有距離 RNG 在 Quest 建立時一次確定並寫入 State；接取不重抽、不延長。

期限採半開區間：`currentDay < deadline` 才合法。Scheduler 在 `currentDay === deadline` 的 `closeDeadline` phase 關閉任務；同日較早的 `completeAction` phase 可以先完成已花完時間的行動，但玩家不能在期限日結算完成後再接取或回報。

### 2.5 報酬規則

```ts
type QuestRewardRuleDefinition = DefinitionHeader & {
  currencyRewardRuleId?: RewardRuleId;                 // economy
  masteryExperienceRuleId: ExperienceAwardRuleId;      // progression
  reputationEffectIds?: EffectDefinitionId[];           // character
};
```

Quest 只選擇這筆委託引用哪個報酬組合；金額、任務熟練度與聲望效果各由擁有模組的 Definition／Resolver 處理。Quest Handler 不自行算錢或 MXP。

---

## 3. Runtime State

### 3.1 QuestInstance

```ts
type QuestStatus = 'unaccepted' | 'incomplete' | 'completed' | 'expired';

type QuestInstance = {
  questId: QuestId;
  kind: QuestKind;
  sourceRuleId: QuestReactionRuleId;
  sourceId: GameId;
  postingGuildCityId: CityId;

  createdOnDay: WorldDay;
  acceptDeadline: WorldDay;
  actualEndDeadline: WorldDay;
  deadlineRolls: number[];

  status: QuestStatus;
  acceptedByTeamId?: TeamId;
  acceptedOnDay?: WorldDay;
  participantCharacterIds: CharacterId[]; // 接取時的正式成員快照；不含任務暫時角色
  completedOnDay?: WorldDay;
  settlement?: QuestSettlement;

  objective: QuestObjective;
  rewardRuleId: QuestRewardRuleId;
  revision: Revision;
};

type NpcQuestClaim = {
  questId: QuestId;
  teamId: TeamId;
  chainId: ActionChainId;
  claimedOnDay: WorldDay;
  revision: Revision;
};
```

一筆 `unaccepted` Quest 最多有一筆 Claim；Claim 的 Team 不因此取得任何優先接取權。任何角色送出合法 `acceptQuest` 都可成功，Quest 必須在同一交易中移除舊 Claim 並發出 `NpcQuestClaimChanged(state=released)`。同理，任務到期、Chain 主動放棄或接取成功都不得留下孤兒 Claim。

### 3.2 四種狀態與結案

```ts
type QuestSettlement = {
  settledOnDay: WorldDay;
  settledAtCityId: CityId;
  settledByTeamId: TeamId;
  beneficiaryCharacterIds: CharacterId[];
  rewardDistributionId: AssetDistributionId;
};
```

`settlement` 不是第五種 QuestStatus。結案後 Quest 從 active posting／journal Query 移除並保留歸檔資料；最後狀態仍為 `completed`。

狀態轉換固定為：

```text
unaccepted → incomplete → completed
unaccepted → expired
incomplete → expired
completed  → expired（期限前未回公會結案）
```

沒有 `failed`、`succeeded`、`turnedIn` 等額外公開狀態。

### 3.3 Objective

```ts
type QuestObjective =
  | { kind: 'purchase'; itemId: ItemInstanceId; shopOfferId: ShopOfferId }
  | { kind: 'delivery'; itemId: ItemInstanceId; destinationCityId: CityId; facilityId: FacilityDefinitionId }
  | { kind: 'escort'; candidateId: EscortCandidateId; characterId?: CharacterId; destinationCityId: CityId }
  | { kind: 'rescue'; contentId: ContentInstanceId; characterId?: CharacterId; mapId: MapInstanceId }
  | { kind: 'exploration'; itemId: ItemInstanceId; contentId: ContentInstanceId }
  | { kind: 'suppression'; mapId: MapInstanceId; targetContentIds: ContentInstanceId[] }
  | { kind: 'hunt'; mapId: MapInstanceId; bossContentIds: ContentInstanceId[] };
```

委託一律綁定 Runtime Instance ID；不可用顯示名稱或任意同 Definition 物品替代。

---

## 4. 公開 Query

```ts
interface QuestQuery {
  getQuest(id: QuestId): QuestView;
  listGuildPostings(cityId: CityId): QuestView[];
  listTeamActiveQuests(teamId: TeamId): QuestView[];
  listTeamCompletedUnsettled(teamId: TeamId): QuestView[];
  listNpcClaimablePostings(cityId: CityId, onDay: WorldDay): QuestView[];
  getNpcClaim(questId: QuestId): NpcQuestClaimView | undefined;
  isMapReservedForAcceptedQuest(mapId: MapInstanceId): boolean;
  isContentProtected(contentId: ContentInstanceId): boolean;
  getQuestIdsForSource(sourceId: GameId): QuestId[];
  canSettle(questId: QuestId, teamId: TeamId, cityId: CityId, onDay: WorldDay): boolean;
}
```

UI 不自行重算完成、期限或結案資格。

---

## 5. 輸入契約

### 5.1 玩家 Game Command

| Command | 前置條件 | Quest 的責任 |
|---|---|---|
| `acceptQuest` | Quest 未接取、接受期限未到、隊伍在發布公會。 | 綁定 Team、保存正式成員快照，啟動目標物／角色／地圖保護 Workflow。 |
| `settleQuest` | Quest 已完成、實際期限未到、隊伍在原發布公會。 | 啟動同步的任務報酬 Distribution；均分、任務物回收與效果全部成功後才建立 settlement 並發出 `QuestSettled`。 |

接取與結案都是城內零時間 Command。

### 5.1.1 NPC Internal Command

| Command | 前置條件 | Quest 的責任 |
|---|---|---|
| `AcceptQuestForNpcTeam` | 與 `acceptQuest` 完全相同，且來源必須是 Adventurer Lifecycle 的 active ActionChain。 | 重用接取驗證與保護 Workflow，發出同一種 `QuestAccepted`；不可建立第二套 NPC 任務狀態。 |
| `SettleQuestForNpcTeam` | 與 `settleQuest` 完全相同，且來源必須是該 NPC Team 的 active Quest Chain。 | 重用原公會結案 Workflow，發出同一種 `QuestSettled`。 |
| `ClaimQuestForNpcTeam` | Quest 未接取、尚未到接受期限，且不存在其他 NPC Team 的 Claim。 | 建立只供 NPC 抽樣排他的 `NpcQuestClaim`；不得阻止玩家 `acceptQuest`。 |
| `ReleaseNpcQuestClaim` | Claim 的 team／chain 與來源相符，或 Quest 已不再 unaccepted。 | 清除意向標記；不得改寫 Quest 期限、目標或狀態。 |

NPC 接取與結案也都是零時間；差別僅在命令由已存檔的 ActionChain 發出，而不是 React UI 發出。

### 5.2 ScheduledJob

| Job | Quest 的反應 |
|---|---|
| `questDeadline(kind: accept)` | 尚未接取者轉 expired、撤下並處理來源實體。 |
| `questDeadline(kind: actualEnd)` | 尚未合法結案者一律轉 expired；完成但未回報亦同。 |

期限 Job 使用 Quest Revision；接取不修改兩個 deadline。

### 5.3 訂閱 DomainEvent

| Event | Quest 的反應 |
|---|---|
| `MapContentGenerated` | 依 Reaction Rule 建立委託；來源內容仍先於 Quest。 |
| `CityStockItemAvailable` | 依機率建立購買／送貨需求。 |
| `EscortCandidatesGenerated` | 將合法候選轉為護衛委託。 |
| `InventoryTransferred`／`ItemInstanceCreated` | 判定購買／探索指定物是否已進入正確 `teamQuestCargo`，以及送貨交付條件。 |
| `TeamLocationChanged` | 判定護衛抵達、救援離圖與公會位置。 |
| `CharacterDied` | 護衛／救援對象死亡時立即轉為 `expired`，原因記為 `targetDied`，並執行與期限到期相同的清理流程。 |
| `MapContentResolved`／`NpcDungeonSettlementApplied` | 判定鎮壓、討伐、救援與探索目標。 |
| `ShopOfferSold` | 更新 purchase 目標實體仍位於何處；不憑空替換目標。 |

玩家事件可在 Command 交易當下更新 Quest；NPC 結果只在其每日／地牢結算 Event 到達時更新，不做即時背景掃描。

---

## 6. 輸出 Internal Command

| Internal Command | 唯一處理者 | 用途 |
|---|---|---|
| `SetMapRefreshLock` | map | 鎮壓／討伐生成時建立 41 日鎖。 |
| `ProtectMapContent` | map | 救援／探索接取後保護目標，結束後解除。 |
| `ReserveQuestItem` | inventory | 綁定指定實體。 |
| `ApplyQuestItemLifecycle` | inventory | 移除、回收、釋放或保留任務 Item。 |
| `MoveItemToTeamQuestCargo` | inventory | 將 purchase／delivery／exploration 的指定實體移入不可自由使用的隊伍任務物資空間。 |
| `ReleaseExpiredQuestCargo` | inventory | Quest expired 時將仍未交付的任務物移入指定 Asset Distribution Escrow。 |
| `ReserveShopOfferForQuest` | city | purchase 目標在期限內保留／標示。 |
| `ReleaseQuestShopOffer` | city | 到期、完成或解除時清理。 |
| `CreateQuestTemporaryCharacter` | character | 接取護衛或救出人物時建立暫時角色。 |
| `AttachQuestTemporaryMember` | team | 將已建立的護衛／救援角色加入接取隊伍。 |
| `StartAssetDistribution` | distribution | 原公會結案時建立 `equalCurrencyOnly` 報酬分配；或 expired 時建立玩家競拍／NPC RNG 的任務物資分配。 |
| `AppendAssetDistributionResult` | distribution | 加入已解析的任務貨幣報酬，或加入移出 Cargo 的 Item ID。 |
| `FinalizeAssetDistributionCollection` | distribution | 關閉收集；貨幣報酬同步均分，expired 物資依玩家／NPC Policy 處理。 |
| `ApplyCharacterReputationEffect` | character | 結案時套用報酬組合內已驗證的聲望效果。 |

---

## 7. 輸出事件

| Event | 最少 payload | 訂閱者 |
|---|---|---|
| `QuestCreated` | `questId`、`kind`、`sourceId`、`deadlines` | map、city、ui/app。 |
| `QuestAccepted` | `questId`、`teamId`、`acceptedOnDay` | city、character、ui/app。 |
| `NpcQuestClaimChanged` | `questId`、`teamId?`、`chainId?`、`state: claimed \| released` | adventurer-lifecycle、ui/app。 |
| `QuestStateChanged` | `questId`、`oldStatus`、`newStatus`、`reason` | map、city、team、character、ui/app。 |
| `QuestObjectiveCompleted` | `questId`、`completedOnDay` | city、ui/app。 |
| `QuestSettled` | `questId`、`teamId`、`beneficiaryCharacterIds`、`guildCityId`、`kind`、`masteryExperienceRuleId` | progression、team、city、ui/app。 |

到期只使用 `QuestStateChanged(newStatus=expired)`，不發出 `QuestFailed`。

任務貨幣分配的參與者很少且沒有物品選擇，`equalCurrencyOnly` 必須在 `settleQuest` 的同一 `EngineTransaction` 內同步完成。若 Distribution、Inventory、Economy、聲望或 Quest 歸檔任一步驟失敗，整筆結案回滾，不會留下已領錢但未結案的狀態。

---

## 8. 各類完成規則

| 類型 | 轉 completed 的唯一條件 |
|---|---|
| 護衛 | 帶著存活目標進入目的城市；同交易發出可投影為感謝對話的完成事件。 |
| 送貨 | 指定 ItemInstance 從 `teamQuestCargo` 在目的城市指定設施自動交付。 |
| 購買 | 指定 ItemInstance 已進入該 Quest 的 `teamQuestCargo`。 |
| 探索 | 指定 ItemInstance 已進入該 Quest 的 `teamQuestCargo`。 |
| 鎮壓 | `targetContentIds` 對應的全部怪群已 resolved。 |
| 討伐 | 指定全部 Boss 內容已 resolved；單 Boss 任務即一隻。 |
| 救援 | 指定人物已救出且 TeamLocationChanged 顯示離開該 Map。 |

送貨目標在目的設施完成時立即交付回收。購買／探索目標在變成 completed 後仍鎖於 `teamQuestCargo`，直到回原公會結案才正式交付回收；若 completed 但逾期未結案，仍視為 expired 並轉入全隊分配。

---

## 9. 物品與地圖生命週期

### 9.1 庫存類

| 狀況 | Item 處理 |
|---|---|
| 未在接受期限前接取，且 Item 仍在任務保留位置／指定店面 | `ApplyQuestItemLifecycle(remove)`。 |
| 未接取前 Item 已被任何角色買走或合法移出指定店面 | Quest expired；`releaseAndKeep`，不得從現持有者身上回收。 |
| Delivery 接取 | 指定 Item 直接進入 `teamQuestCargo(teamId, questId)`。 |
| Purchase 買下／Exploration 取得 | 指定 Item 直接進入 `teamQuestCargo`、清除個人 Owner，Quest 轉 completed。 |
| Delivery 到目的設施 | 從 `teamQuestCargo` 自動交付並 `reclaim`，Quest 轉 completed。 |
| Purchase／Exploration 回原公會結案 | 從 `teamQuestCargo` 正式交付並 `reclaim`。 |
| 已接取 Quest expired，且 Item 仍在 `teamQuestCargo` | `ReleaseExpiredQuestCargo`，交由玩家內部競拍或 NPC RNG 分配，不回永久庫存。 |

送貨 Item 在 Quest 接取時才從保留位置移入任務物資空間。Purchase 目標在指定商店形成真實 Offer；接取後由某位正式成員的個人帳戶付款，但 Item 不成為付款者私產，而是直接進入該 Quest 的 `teamQuestCargo`。若 Purchase 在任務接取前已被其他人合法買走，仍追蹤同一 ItemInstance、不生成替代品，任務未接取到期時也不沒收買家物品。

```text
已接取的 Purchase／Delivery／Exploration 到期
  → Quest 先轉 expired 並建立 Asset Distribution
  → ReleaseExpiredQuestCargo(distributionId)
  → Inventory 將仍在該 Quest Cargo 的物品全部移入 distribution escrow
  → AppendAssetDistributionResult(itemIds)
  → FinalizeAssetDistributionCollection
  → 玩家隊：逐件競拍；NPC 隊：逐件 RNG
  → 分配完成後每件物品都有個人 Owner，Cargo 為空
```

Quest 到期不等待玩家競拍完成才成為 `expired`；分配流程是到期後獨立且可存檔的 Pending Interaction。它只負責處理已解除任務鎖定的財產，不會令 Quest 復活或發放任務報酬。

### 9.2 救援／探索

- 未接取到接受期限：綁定內容可移除，指定任務實體依規則消失。
- 已接取且未到實際期限：人物、控制者與必要場景跨一般刷新保留。
- 已到期：解除保護；後續刷新才可移除。

### 9.3 鎮壓／討伐

- Quest 生成時立刻建立 41 日刷新鎖，不論是否接取。
- 鎖定期間跳過固定刷新，不設 Pending、不累積補刷。
- 到期解除後等待地圖自己的下一個固定刷新日。

---

## 10. 不變量與測試

1. QuestStatus 只能是四種既定值。
2. `acceptDeadline`、`actualEndDeadline` 與距離 RNG 建立後不可修改。
3. `actualEndDeadline >= acceptDeadline`。
4. 完成但未在期限前回原公會結案，一樣 expired 且無獎勵／任務 MXP。
5. Quest settlement 最多一次，且發布城市必須相同。
6. 目標 Item、Content、Character 皆綁定 Runtime ID。
7. 未接取 Quest 不建立護衛 Character。
8. 鎮壓／討伐鎖不因接取與否改變期限。
9. 任務到期不使用「失敗」狀態或 Event。
10. 物品、報酬、MXP、Quest 歸檔在同一結案交易，任一步驟失敗全部回滾。
11. `participantCharacterIds` 只在接取時保存正式成員，不含護衛／救援暫時角色；貨幣報酬以此清單平均發放。
12. Purchase、Delivery、Exploration 的任務指定品進入 `teamQuestCargo` 後，不得被任何個人使用、出售或據為己有。
13. Purchase／Exploration 只有原公會結案才回收任務物；expired 時仍在 Cargo 的物品必須全部進入團隊分配 Settlement。
14. Delivery 在目的設施完成交付後已無 Cargo 物可分；完成但未回公會而 expired 不得重新生成同一物品。
15. expired Cargo 分配沿用接取時的 `participantCharacterIds`；之後招募、解雇或任務暫時角色都不能改變分配名單。
16. `equalCurrencyOnly` 完成前不可寫入 `QuestSettlement` 或發出 `QuestSettled`。

---

## 11. Quest 模組交接清單

- [ ] Reaction、Deadline、Objective、Reward JSON Schema。
- [ ] QuestInstance、Objective、Settlement 與三個索引。
- [ ] 七種 Quest 完成判定與四狀態 reducer。
- [ ] 兩期限 Job、地圖保護／鎖、物品與暫時角色 Workflow。
- [ ] 原公會結案、報酬與任務 MXP 原子交易。
- [ ] 任務物資空間、貨幣均分與 expired 後全隊物資分配 Workflow。
- [ ] 各類期限、未接／已接、完成未回報、NPC 結算測試。
