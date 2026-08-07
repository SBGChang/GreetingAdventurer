# NPC Behavior 模組契約

> **模組 ID：** `npc-behavior`
>
> **依賴：** [共用核心契約](00_shared_contracts.md)、Team／Quest／City／World／Map／Dungeon／Inventory／Economy／Character／Crafting 的公開 Query，以及 Combat Power 純計算服務。
>
> **責任：** 管理非玩家冒險者（包含單人與多人隊伍）的下一個意圖、動作串、任務承諾，以及所有非玩家主角正式成員的城市生活選擇。它決定「NPC 接下來想做什麼」；不執行旅行、地牢、交易、製作、訓練、婚姻或委託本身。

---

## 1. 核心模型

### 1.1 獨立冒險者不是另一種系統

遊戲裡不存在脫離 Team 的「單人角色」。所謂獨立冒險者一律是 `memberIds.length === 1`、`leaderId === memberIds[0]` 的 `control: 'npc'` Team；多人冒險者則是同一個 Team 的多名正式成員。兩者使用完全相同的決策、任務、地牢與資產規則，不建立 `SoloAdventurerState`。

因此「整個隊伍」是 NPC 的策略單位：旅行、接取任務、下冒險地與回公會都由隊伍共同決定；處於 `cityFree` 時，正式成員才各自執行生活行為。

### 1.2 意圖、動作串與執行 Plan 的分界

```text
Lifecycle Intent / ActionChain  ──決定與鎖定──>  TeamPlan / MemberFreeAction
     「為何、下一步是什麼」                        「正在花時間做什麼」
```

- **Intent：** 一次抽選的高階意圖，例如「自由活動」、「前往別城」、「接當地任務」、「下當地冒險地」。
- **ActionChain：** 為完成 Intent 所建立的有序**邏輯節點**。自由活動、下當地冒險地、接當地任務與移動至別城在抽取時都先是單節點 Chain；目前只有「任務已接取後」materialize 的任務 Chain 會有多個邏輯節點。
- **Team Plan／Free Action：** 由 Team 模組執行的一段實際行程或個人生活行為。Lifecycle 不直接改 Team State。
- **鎖定：** 接取與地牢有關的任務後，Lifecycle 停止抽取新的 Intent；只推進該任務 Chain，直到任務結案、到期、已無法完成或資料化退出規則成立。

ActionChain 不是把完整地圖路徑、完整商店資料或實體物品複製進 State；只保存 Runtime ID、節點狀態及重播所需 RNG stream。每一節執行前都重新用公開 Query 驗證世界現在仍合法。

---

## 2. 靜態資料契約

```ts
interface NpcBehaviorDefinitionReader {
  getDecisionPolicy(id: AdventurerDecisionPolicyId): AdventurerDecisionPolicyDefinition;
  getActionChainTemplate(id: ActionChainTemplateId): ActionChainTemplateDefinition;
  getMarketPolicy(id: NpcMarketPolicyId): NpcMarketPolicyDefinition;
  getFreeActionRule(id: FreeActionRuleId): FreeActionRuleDefinition;
}

type AdventurerDecisionPolicyDefinition = DefinitionHeader & {
  reviewIntervalDays: number;
  candidates: NpcIntentCandidateRule[];
  memberFreeActionCandidates: NpcMemberFreeActionCandidateRule[];
  fallbackChainTemplateId: ActionChainTemplateId;
  forcedFreeDurationDays: { min: 2; max: 7 };
  npcTravelRuleId: NpcTravelRuleId;
  marketPolicyId: NpcMarketPolicyId;
};

type NpcIntentKind =
  | 'enterNearbyAdventureMap'
  | 'acceptNearbyQuest'
  | 'travelToCity';

type NpcIntentCandidateRule = {
  intentKind: NpcIntentKind;
  chainTemplateId: ActionChainTemplateId;
  conditionId: ConditionId;
  weightResolverId: ResolverId;
};

type NpcMemberFreeActionCandidateRule = {
  actionKind: 'craft' | 'train' | 'trade' | 'proposeToTeammate' | 'rest';
  freeActionRuleId: FreeActionRuleId;
  conditionId: ConditionId;
  weightResolverId: ResolverId;
};
```

候選池只包含三種**非自由**工作：下附近冒險地、接附近任務、移動至別城。自由活動不在抽選池中。權重、隊伍偏好、合法委託篩選與目的城市選擇都由 JSON Rule／既有 Condition 與 Resolver 表達；不得在 Handler 寫死「某類 NPC 必然愛打怪」。無可用候選時，強制套用資料指定的非自由 `fallbackChainTemplateId`；資料驗證禁止它指向 `cityFree`。

NPC 的節奏固定是：`自由活動 → 一次非自由工作 Chain → 強制自由活動 2～7 日 → 下一次非自由抽選`。一個救援或討伐等多節點任務 Chain 整體仍只算一次非自由工作；中間不可插入自由活動。

### 2.1 動作串模板

```ts
type ActionChainTemplateDefinition = DefinitionHeader & {
  purpose: 'free' | 'travel' | 'localAdventure' | 'quest';
  nodes: ActionChainNodeTemplate[];
};

type ActionChainNodeTemplate =
  | { kind: 'cityFree' }
  | { kind: 'travelToCity'; destinationResolverId: ResolverId }
  | { kind: 'executeNearbyAdventure'; mapResolverId: ResolverId; stopPolicyId: NpcStopPolicyId }
  | { kind: 'acceptNearbyQuest'; questSelectorId: ResolverId }
  | { kind: 'travelToQuestTarget'; destinationResolverId: ResolverId }
  | { kind: 'enterQuestMap' }
  | { kind: 'startNpcDungeonRun'; objectiveStopPolicyId: NpcStopPolicyId }
  | { kind: 'returnFromQuestMap' }
  | { kind: 'settleAtPostingGuild' }
  | { kind: 'complete' };
```

`cityFree` 是非自由工作結束後由系統建立的強制休整期，不是抽選候選；它的 TeamPlan 固定有資料化的 2～7 日期限。`travelToCity`、`executeNearbyAdventure` 與尚未接取成功的 `acceptNearbyQuest` 都各自是一節完成的 Chain。`executeNearbyAdventure` 的執行過程可依時間規則啟動「進圖 1 日 → NPC Dungeon Run → 回城 1 日」等 Team Plan，但那是**同一節點的執行階段**，不是 Lifecycle 的多節點 ActionChain。這樣既不犧牲既有時間規則，也維持「現在只有任務會有多節點動作串」的設計。

NPC 節點只解析目的地與路線，不解析玩家的 3／6／9 日旅行模式。Lifecycle 以 Decision Policy 的 `npcTravelRuleId` 要求 Team 建立固定 6 日直達 Plan；這個 Plan 不含前／中／後段落、事件池、事件 RNG、護衛刺殺候選或 Pending Interaction。

任務模板可在接取後依 `QuestKind` materialize 成實際節點：

| 任務 | 必要節點（概念） |
|---|---|
| 購買 | 接取 → 取得指定物品 → 回原公會結案。 |
| 送貨 | 接取／釋放任務貨物 → 前往指定設施交付 → 回原公會結案。 |
| 護衛 | 接取／建立暫時角色 → 前往目的城 → 自動完成 → 回原公會結案。 |
| 救援／探索 | 接取 → 前往目標城 → 進地圖 → NPC 地牢 Run → 出圖 → 回原公會結案。 |
| 鎮壓／討伐 | 接取 → 前往目標城 → 進地圖 → NPC 地牢 Run → 出圖 → 回原公會結案。 |

「完成」在這裡包含回**原接取公會**結案：依既定規則，任務 Objective 完成但到期前未回報仍會到期，而不是成功。探索型任務的地牢節點由 Dungeon 依有序內容序列日結算，非玩家不逐格走圖。

### 2.2 NPC 任務抽取：鄰城範圍、可行性與意向標記

抽到 `acceptNearbyQuest` 時，Lifecycle 只從「目前所在城市 + 城市圖上直接相鄰的一格城市」的公會 Posting 池抽取。它不是任意距離搜尋，也不以直線座標猜測相鄰關係；必須使用 `WorldQuery.listCitiesWithinHops(originCityId, 1)`。

候選任務必須同時符合：

1. `unaccepted`，且在**預定抵達發佈城市當日**仍早於 `acceptDeadline`。
2. 尚未被另一支 NPC Team 的任務意向標記；玩家不受此限制。
3. 路線與該任務所需目的地仍可合法抵達。
4. `CombatPowerQuery.assessQuestFeasibility` 回傳可嘗試，並依其成功機率／風險權重排序抽選。

抽中後，Lifecycle 先要求 Quest 建立 `NpcQuestClaim`，成功才建立「到目標城市 → 嘗試接取」的 ActionChain。這個標記只排除其他 NPC 的抽樣，**不是委託保留**：玩家仍可照常接取；被標記的 NPC 也沒有提前取得任務物、地圖保護或報酬權利。

若玩家或另一個已合法接取者在 NPC 抵達前接走任務，Quest 發出 `QuestAccepted` 並清除 Claim。Lifecycle 將原 Chain 設為 `targetUnavailable`，但絕不取消已開始的旅行或讓隊伍掉頭；隊伍照常抵達目標城市後，此 Chain 直接結束，隔日重新抽選。若尚未開始旅行，則在下一個 Chain Advance 直接結束並重抽。

抽到 `enterNearbyAdventureMap` 時也使用同樣的本城＋相鄰一格城市範圍，從其對應冒險地中依戰力可行性與資料權重選取一張圖；必要時先旅行至對應城市。只要任一已接取的救援／探索／鎮壓／討伐 Quest 指向該冒險地，`QuestQuery.isMapReservedForAcceptedQuest(mapId)` 即令它排除在其他 NPC Team 的**自主下地牢抽樣**之外。這不是玩家進圖禁令，也不影響已接取該任務的隊伍。

自主冒險地 Run 一旦首次骰定失敗，或依有序內容序列骰完所有可處理內容，即視為該非自由工作完成；不另選第二張圖。Lifecycle 接著登記強制自由活動期，而非立刻再抽下一個工作。

### 2.3 NPC 城市生活與市場偏好

```ts
type FreeActionRuleDefinition = DefinitionHeader & {
  kind: 'craft' | 'train' | 'trade' | 'proposeToTeammate' | 'rest';
  requiredFreeDays?: number;
  completionResolverId?: ResolverId;
  requiresCityFacilityKind?: FacilityKind;
  npcMarriageRuleId?: NpcMarriageRuleId;
};

type NpcMarketPolicyDefinition = DefinitionHeader & {
  budgetReserveRuleId: ResolverId;
  purchaseNeedRules: NpcPurchaseNeedRule[];
  sellRules: NpcSellRule[];
  homePurchaseRuleId?: ResolverId;
  maxTransactionsPerFreeCycle: number;
};

type NpcPurchaseNeedRule = {
  target: 'equipment' | 'combatConsumable' | 'nonCombatConsumable';
  needResolverId: ResolverId;
  offerSelectorId: ResolverId;
};

type NpcSellRule = {
  itemSelectorId: ResolverId;
  sellWhenResolverId: ResolverId;
};

```

自由活動可抽取的個人行為為**製作、鍛鍊、買賣、向同隊成員求婚、休息**。`trade` 的挑選可依個人需求與金錢選擇賣裝備／物品、買裝備／補品，並可在資料規則滿足時購入房屋；不新增疲勞值或隱藏的 NPC 專屬資源。

`kind: proposeToTeammate` 的 Free Action Rule 必須提供 `npcMarriageRuleId`，其他 kind 不得提供。Lifecycle 只以穩定 RNG 從通過硬條件的候選中固定一人，不另做第二套候選偏好公式；Marriage Workflow 才使用該 Rule 進行接受判定。

`proposeToTeammate` 只為非玩家主角角色建立候選。目標池限同隊正式成員、成年、存活、未婚、異性且不是玩家主角；Lifecycle 以穩定 RNG 固定一名目標後交給 Marriage Workflow。判定只讀 `currentDay - max(雙方 memberJoinedOnDay)` 與同一 Combat Power Service 的雙方戰力接近程度，不建立 NPC 彼此好感或 pairwise 共隊天數 State。抽中只是進行一次判定，不保證結婚；成功與拒絕都算本次零日自由子步驟已完成，下一筆最早次日再抽。

`craft` 被抽中時不建立市場需求或利潤動機：Lifecycle 只向 Crafting 的公開 Query 取得該角色目前能做的配方池並固定 RNG 抽取。成品裝備的自動換裝只比較最終 Combat Power；未換裝成品留給日後 `trade` 出售。

一旦角色抽到有 `requiredFreeDays` 的自由行動，該行動就會跨越後續多段 `cityFree` 持續存在。每一個完整自由日只扣除一天剩餘需求；非自由工作只凍結進度，不取消、不重抽也不歸零。只有累積日數達標並收到 `FreeActionCompleted` 後，Lifecycle 才為該角色抽下一件自由行動。

市場交易是 `cityFree` 中的**零日子步驟**：它遵守城內買賣本來就不花世界時間的規則，但一次自由活動循環至多執行 `maxTransactionsPerFreeCycle` 筆，且完成後下一筆自由行動最早次日才可開始。它不會形成「同一天無限重骰、無限買賣」的迴圈。NPC 與玩家隊友都不使用玩家主角的每日 6 次交易／6 次聊天計數；其交流成長由 Team 在每個完整自由日固定發出的練習事件處理，實際 `NpcMarketIntent` 成功與否不額外給交流 MXP。這只改變交流熟練度來源。

`budgetReserveRuleId` 必須在報價後保留最低現金；所有購買、販售、買房都以角色個人帳戶和個人物品進行。需求規則只能讀取 Character／Inventory／Economy／City 的公開 View，不可修改它們。

---

## 3. Runtime State 與公開 Query

```ts
type NpcBehaviorState = {
  controllers: Record<TeamId, NpcAdventurerController>;
  chains: Record<ActionChainId, NpcActionChain>;
  marketIntents: Record<NpcMarketIntentId, NpcMarketIntent>;
};

type NpcAdventurerController = {
  teamId: TeamId;
  policyId: AdventurerDecisionPolicyId;
  activeChainId?: ActionChainId;
  nextDecisionOnDay: WorldDay;
  revision: Revision;
};

type NpcActionChain = {
  chainId: ActionChainId;
  teamId: TeamId;
  source: 'autonomous' | 'acceptedQuest';
  templateId: ActionChainTemplateId;
  questId?: QuestId;
  status: 'active' | 'completed' | 'aborted';
  currentNodeIndex: number;
  nodes: NpcActionChainNode[];
  targetUnavailableOnDay?: WorldDay;
  rngStreamId: RngStreamId;
  revision: Revision;
};

type NpcActionChainNode = {
  nodeId: ActionChainNodeId;
  kind: ActionChainNodeTemplate['kind'];
  status: 'waiting' | 'running' | 'completed' | 'skipped' | 'failed';
  linkedPlanId?: TeamPlanId;
  payload: Record<string, JsonValue>; // 只存 ID、選定結果與 Resolver 快照
};

type StartNpcTravelPlanPayload = {
  teamId: TeamId;
  chainId: ActionChainId;
  nodeId: ActionChainNodeId;
  fromCityId: CityId;
  toCityId: CityId;
  routeId: RouteId;
  npcTravelRuleId: NpcTravelRuleId;
};

type NpcMarketIntent = {
  intentId: NpcMarketIntentId;
  teamId: TeamId;
  memberId: CharacterId;
  kind: 'buyOffer' | 'sellItem' | 'buyHome';
  cityId: CityId;
  offerId?: ShopOfferId;
  itemId?: ItemInstanceId;
  homeRuleId?: HomeRuleId;
  createdOnDay: WorldDay;
  state: 'pending' | 'completed' | 'invalid';
  revision: Revision;
};

```

`NpcActionChain` 與 `NpcMarketIntent` 是唯一可存檔的 NPC 決策快照；它們不可存函式、完整 Query DTO、React callback 或未固定的隨機結果。

旅行節點的 `payload` 只能保存目的城市、已選 Route、`npcTravelRuleId` 與必要 revision；Schema 明確禁止 `modeId`、`segmentIndex`、事件池、事件實例及任何事件隨機結果。NPC 接了護衛任務也只會走相同契約。

```ts
interface NpcBehaviorQuery {
  getActiveChain(teamId: TeamId): NpcActionChainView | undefined;
  getNextDecisionOnDay(teamId: TeamId): WorldDay | undefined;
  listMarketIntents(teamId: TeamId): NpcMarketIntentView[];
}
```

其他模組通常不需要讀取這個 Query；它主要供 UI／debug Projection 顯示 NPC 真正的下一步，而不是顯示捏造的活動描述。

---

## 4. 輸入、輸出與邊界

### 4.1 Scheduled Job

| Job | 行為 |
|---|---|
| `npcDecisionDue` | 僅處理沒有 active Chain 的 NPC Team；抽選下一個高階 Intent，建立並推進第一個節點。 |
| `npcChainAdvance` | 由已完成的 Team Plan、任務狀態或地牢結果登記為**次日**處理；重新驗證並推進一個可立即啟動的節點。 |

兩種 Job 都不掃描所有 NPC。`NpcActionChain` 節點完成時只登記 `dueDay = currentDay + 1` 的下一步，保持每日結算與「新行為最早次日開始」原則。

### 4.2 訂閱 Domain Event

| Event | Lifecycle 的反應 |
|---|---|
| `TeamPlanCompleted`／`TeamLocationChanged` | 找到 linked node，標為完成，登記次日 `npcChainAdvance`。 |
| `FreeActionCompleted` | 對 craft／train 走既有完成流程；對 `trade` 建立一筆資料化 `NpcMarketIntent`（發 `NpcMarketIntentCreated`，由 NPC Market Workflow 承接，流程結束以 `FinalizeNpcMarketIntent` 回寫）。`proposeToTeammate` **不再由 Lifecycle 送命令**：改由 NPC Marriage Workflow 直接訂閱 `FreeActionCompleted(kind=proposeToTeammate)` 承接。結果都不在 Lifecycle 直接寫入。 |
| `QuestAccepted` | 若為 Lifecycle 正在執行的 `acceptNearbyQuest` 節點，materialize 對應 Quest Chain 並鎖定。 |
| `NpcQuestClaimChanged` | 自己建立的 Claim 被釋放或被他人接取時，更新目標節點；已開始旅行只在抵達目標城市後結束，未出發則於下一次 Advance 結束。 |
| `QuestStateChanged`／`QuestSettled` | 目標完成、逾期或已結案時推進／中止 Quest Chain；已結案才解除鎖定。 |
| `NpcDungeonRunClosed` | 依成功、失敗或目標未達成更新地牢節點，次日決定返城或繼續任務節點。 |
| `CharacterAvailabilityChanged`／`TeamMemberDeparted` | 重新驗證隊伍可否繼續；無合法正式成員時中止 Chain 並取消後續 Job。 |
| `ShopOfferSold`／`ShopRefreshed`／`InventoryTransferred` | 使已不合法的 `NpcMarketIntent` 標記 invalid；不重抽交易。 |

### 4.3 輸出 Internal Command

| Internal Command | 唯一處理者 | 用途 |
|---|---|---|
| `StartNpcTeamPlan` | team | 啟動旅行、進圖、返城或城市自由活動的實際 Plan；旅行 payload 固定使用 Policy 的 `npcTravelRuleId`。 |
| `AssignNpcMemberFreeAction` | team | 在 `cityFree` 中為個別正式成員建立 craft／train／trade／proposeToTeammate／rest；提案 payload 必須固定目標。 |
| `AcceptQuestForNpcTeam` | quest | 驗證 NPC 位於發佈公會城市且 Quest 仍可接取。 |
| `ClaimQuestForNpcTeam` | quest | 將經過可行性篩選的未接任務標記給目前 Chain，排除其他 NPC 的任務抽樣。 |
| `ReleaseNpcQuestClaim` | quest | Chain 結束、目標失效或接取成功後移除 NPC 意向標記。 |
| `StartNpcDungeonRun` | dungeon | 開始目標對應的簡易地牢 Run；Dungeon 同時建立其多節點 Combat Sequence。 |
| `SettleQuestForNpcTeam` | quest | 在原接取公會對已完成任務結案。 |

NPC 市場交易不是第二套商業規則：`trade` 完成時 Lifecycle 只建立資料化 `NpcMarketIntent` 並發 `NpcMarketIntentCreated`，由 **NPC Market Workflow** 承接、重用玩家的買 Offer／賣物品／買房流程（無 React 輸入）；流程結束以 `FinalizeNpcMarketIntent` 回到 Lifecycle 更新 Intent 並發 `NpcMarketIntentResolved`。Lifecycle 不再送 `ExecuteNpcMarketIntent`。

### 4.4 輸出事件

| Event | 最少 payload |
|---|---|
| `NpcIntentSelected` | `teamId`、`intentKind`、`chainId`、`onDay` |
| `NpcActionChainChanged` | `teamId`、`chainId`、`currentNodeIndex`、`status` |
| `NpcMarketIntentCreated` | `intentId`、`teamId`、`memberId`、`kind` |
| `NpcMarketIntentResolved` | `intentId`、`state`、`reason?` |

---

## 5. 主要流程

### 5.1 一般自主循環

```text
npcDecisionDue（只抽非自由工作）
  → 以資料化候選與固定 RNG 抽選 Intent
  → 建立 ActionChain
  → 啟動第一個非自由 TeamPlan
  → Plan／Free Action／地牢結果完成
  → 登記次日 npcChainAdvance
  → 非自由 Chain 完成後，建立 2～7 日強制 cityFree
  → cityFree 結束後，才排下一個 npcDecisionDue
```

`enterNearbyAdventureMap`（對應模板的 `executeNearbyAdventure`）是一節邏輯節點：必要時先以固定 6 日 NPC 旅行至附近目標城，再進入對應冒險地、啟動 NPC Dungeon Run、離開地圖，最後完成該節。Run 首次失敗或有序序列完成後便結束，接著強制進入自由活動。`travelToCity` 也只包含一段固定 6 日城市旅行；抵達後同樣先進入強制自由活動，不能直接重抽。

### 5.2 接取任務與鎖定

```text
acceptNearbyQuest
  → WorldQuery 取得本城 + 相鄰一格城市，QuestQuery 篩出可標記項
  → CombatPowerQuery.assessQuestFeasibility 排除不可行項並依預期成功權重抽選
  → ClaimQuestForNpcTeam → 必要時旅行至發佈城市 → AcceptQuestForNpcTeam
  → 依 QuestKind materialize Quest Chain
  → 直到 QuestSettled / expired / impossible 都不抽新 Intent
  → Chain 結束，次日才恢復一般 npcDecisionDue
```

所有接取都只能在**當地**冒險者公會進行。若在接取交易間 Quest 被其他隊接走、到期、物品被買走或路徑失效，`AcceptQuestForNpcTeam` 拒絕，原 Chain 以明確理由中止，次日重新抽選；不得悄悄改接另一筆任務。

### 5.3 城市自由活動與買賣

```text
cityFree
  → 非玩家主角正式成員各自抽 craft / train / trade / proposeToTeammate / rest
  → trade 完成時形成最多一筆 NpcMarketIntent
  → proposeToTeammate 完成時，以共隊天數與戰力接近度做一次 NPC 婚姻判定
  → City workflow 驗證報價、商品、餘額、所有權與房屋名額
  → 成功：更新個人資產；失敗：intent = invalid
  → 該成員下一筆生活行為最早次日抽取
```

NPC 不能把隊友金錢當作共同荷包，也不能出售隊友、任務貨物、已保留物或不在自己背包中的物品。購買補品／裝備與賣出多餘物品均遵守商店即時庫存；買房必須走 City 的同城唯一性、slot 與個人付款規則。

---

## 6. 不變量與驗收

1. 每支 `control: 'npc'` Team 至多有一個 active ActionChain；玩家 Team 不可持有 NPC Controller。
2. 任一 active Quest Chain 必須引用一筆由同 Team 接取、尚未結案的 Quest；任務鎖定期間不可抽一般 Intent。
3. Lifecycle 不可直接寫 Team、Quest、City、Inventory、Economy 或 Dungeon State。
4. 行動 Chain 的每一節都必須有完整的完成／中止路徑；不允許永久 `waiting`。
5. 獨立冒險者與多人隊伍使用同一份 Decision Policy 與相同的 Chain 驗收測試。
6. 交易 Intent 每個自由活動循環不超過資料上限；無效交易不可在同日重骰。
7. `advanceWorldToDay(day + N)` 與逐日 N 次處理得到相同 Chain、交易與角色資產結果。
8. 任務完成但未回原公會結案，在 actual end deadline 到期後仍必須到期，而不是視作成功。
9. 任務與自主冒險地只可從本城加相鄰一格城市選取；有已接取地圖任務的圖不得被其他 NPC 自主抽中。
10. 每個非自由 Chain 完成後必定先進入 2～7 日強制自由期；自由期不在 NPC 抽選池。
11. 所有 NPC 旅行恰好在開始後第 6 日抵達；ActionChain、TeamPlan、Scheduler 與 RNG State 均不得出現玩家旅行模式或事件資料。
12. NPC 接取護衛任務後仍不建立刺殺事件或任何旅行 Pending；護衛成敗只依抵達、戰敗與 Quest 期限等正式事實判定。
13. NPC 求婚不得讀取或建立好感度；候選與結果只能由同隊資格、共隊天數、Combat Power、資料 Rule 與該行動的 deterministic RNG 決定。
14. 玩家隊中的非玩家隊友與 NPC Team 成員共用同一套個人自由行動候選；只有玩家主角由玩家輸入決定，不進入自動求婚池。

---

## 7. 交接清單

- [ ] `NpcBehaviorState`、ActionChain、MarketIntent schema。
- [ ] Decision Policy、Chain Template、Market Policy JSON Schema 與 Rule Validation。
- [ ] `npcDecisionDue`／`npcChainAdvance` Job Handler，以及 deterministic RNG fixture。
- [ ] Team／Quest／Dungeon 完成事件到 Chain 節點的契約測試。
- [ ] NPC 接購買、送貨、護衛、救援、探索、鎮壓、討伐各一條測試流程。
- [ ] 單人 NPC 與多人 NPC 同行為、城市自由行動分歧、交易上限、任務鎖定與到期未結案測試。
- [ ] 本城／鄰城任務與冒險地範圍、Claim 排他但玩家可搶接、目標失效後抵達才結束、地牢成功／首次失敗後強制自由期的測試。
- [ ] NPC 固定 6 日直達、完全沒有旅行事件資料，且護衛任務不改變旅行流程的契約測試。
- [ ] 玩家隊友／NPC 隊員抽中求婚、固定目標、無好感判定、共隊日與戰力接近判定，以及競爭同一未婚目標的穩定順序測試。
