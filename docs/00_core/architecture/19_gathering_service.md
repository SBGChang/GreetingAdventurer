# Gathering Resolver 與採集 Workflow 契約

> **技術元件：** `domain-services/gathering`，以及各來源的 Host Workflow（例如 `app/workflows/dungeon-gathering`）
>
> **依賴：** 共用核心契約、Team／Progression／Map／Inventory／Asset Distribution 的公開契約，以及 Gathering Definition Reader。
>
> **責任：** 從合法採集來源選出實際採集者、依採集熟練度與資料規則解析產物，並以單一原子交易提交來源消耗、物品建立、成果收集與採集經驗事實。
>
> **非責任：** 不擁有 GameState Slice、不保存地圖節點狀態、不直接增加熟練度、不決定地牢時間，也不自行分配隊伍戰利品。

---

## 1. 邊界與所有權

採集沒有自己的持久 State，也不向 `ModuleStateRegistry`／`GameState` 貢獻 gathering slice。

| 事實 | 唯一所有者 | Gathering 的角色 |
|---|---|---|
| 固定採集點位置、目前版本是否可採 | map | 讀取並要求 Map 原子標記已採集。 |
| 玩家所在房間、採集互動分鐘 | dungeon | Dungeon 驗證位置並先計入資料指定分鐘。 |
| 正式成員與探索參與者快照 | team／distribution | 只從公開 Query 取得候選名單。 |
| 採集熟練度與 MXP | progression | 唯讀比較等級；完成後由 Workflow 送 `GrantGatheringMasteryExperience` 給 progression。 |
| 物品實體與位置 | inventory | 以 Required Internal Command 建立正式 Item Instance。 |
| 玩家競拍／NPC RNG 分配 | distribution | 採集產物只追加到既有成果收集，不自行指定個人 Owner。 |
| 玩家旅行資源事件與敵人採集型掉落 | 來源 Workflow | 提供合法 Source Ref 與成果目的政策；NPC 旅行沒有事件來源。 |

精確產物在採集成功時才解析並建立 Item Instance。未採集的地圖節點只有「可採集來源」而沒有預先存在的隱藏 Item Instance，因此地圖刷新時不會把未採集資源移入城市永久庫存。

---

## 2. 靜態資料契約

```ts
interface GatheringDefinitionReader {
  getGatheringRule(id: GatheringRuleId): GatheringRuleDefinition;
}

type GatheringRuleDefinition = DefinitionHeader & {
  masteryId: MasteryId;                         // 第一版指向採集熟練度
  sourceTier: 'I' | 'II' | 'III' | 'IV' | 'V';
  yieldResolverId: ResolverId;                  // 依等級決定種類與數量
  experienceAwardRuleId: ExperienceAwardRuleId;
  dungeonInteractionMinutes?: number;           // 地圖採集點必填
  npcPolicy?:
    | { eligible: false }
    | {
        eligible: true;
        pointCost: number;                      // 必須 > 0
        resolverId: ResolverId;
      };
};
```

```ts
type GatheringSourceRef =
  | {
      kind: 'mapNode';
      mapId: MapInstanceId;
      mapVersion: number;
      nodeId: GatheringNodeId;
    }
  | {
      kind: 'travelResource';
      contentEventInstanceId: ContentEventInstanceId;
      gatheringRuleId: GatheringRuleId;
    }
  | {
      kind: 'enemyDrop';
      encounterId: EncounterId;
      rewardSourceId: RewardSourceId;
      gatheringRuleId: GatheringRuleId;
    };

type GatheringYieldEntry = {
  itemDefinitionId: ItemDefinitionId;
  quantity: number;
};

type GatheringResolution = {
  resolutionId: GatheringResolutionId;
  source: GatheringSourceRef;
  teamId: TeamId;
  participantCharacterIds: CharacterId[];
  contributorCharacterId: CharacterId;
  gatheringRuleId: GatheringRuleId;
  masteryId: MasteryId;
  masteryLevelUsed: MasteryLevel;
  experienceAwardRuleId: ExperienceAwardRuleId;
  yields: GatheringYieldEntry[];
  individualYields?: Array<{
    recipientCharacterId: CharacterId;
    yields: GatheringYieldEntry[];
  }>;
};
```

資料驗證必須保證：

1. 地圖採集 Rule 的 `dungeonInteractionMinutes` 為正整數。
2. `yieldResolverId` 對 Lv.0～10 都能回傳有限、非負整數數量，且只引用合法 Item Definition。
3. `experienceAwardRuleId` 與 `sourceTier` 一致，不得由 UI 或 TypeScript 特例重算經驗。
4. NPC 可採時必須有正數 `pointCost` 與合法 `resolverId`；不可採時不得進入 NPC 序列。

---

## 3. 純計算 Port

```ts
interface GatheringResolver {
  resolve(input: GatheringResolverInput, rng: DeterministicRng): RngStep<GatheringResolution>;
}

type GatheringResolverInput = {
  resolutionId: GatheringResolutionId; // 由 Host Workflow 在交易內先配發；Resolver 不自行產生 ID
  source: GatheringSourceRef;
  teamId: TeamId;
  participantCharacterIds: CharacterId[];
  rule: GatheringRuleDefinition;
  masteryLevels: Record<CharacterId, MasteryLevel>;
  rngContext: RngContext; // Host 依 worldSeed + `gathering:<resolutionId>` + cursor 0 建立的一次性 Context
};
```

採集者選擇是固定規則：

1. 只比較本次來源提供的 `participantCharacterIds`。
2. 選擇採集熟練度最高者。
3. 同級時以穩定 `CharacterId` 排序選出一人，不消耗 RNG。
4. 該角色的等級決定 `yieldResolverId` 的種類與數量，且只有該角色取得採集 MXP。

Resolver 是純函式：相同 Rule、參與者等級、Source Ref 與 RNG Context 必須得到完全相同結果。所有來源的一次採集都使用由 `gathering:<resolutionId>` 推導的一次性 Stream、cursor 從 `0` 開始；`RngStep.nextCursor` 只供該次解析內串接抽取，不寫回 Map、Encounter、Content Event 或 Dungeon Run。交易回滾時 Resolution ID 與結果都不會外洩；同一成功提交也不得再次解析。

---

## 4. 輸入與輸出契約

### 4.1 Host Workflow 內部正規化資料

```ts
type GatheringResolutionRequest = {
  resolutionId: GatheringResolutionId;
  source: GatheringSourceRef;
  teamId: TeamId;
  participantCharacterIds: CharacterId[];
  destinationPolicyId: GatheringDestinationPolicyId;
  destination: GatheringDestinationRef;
};

type GatheringDestinationRef =
  | { kind: 'assetDistribution'; distributionId: AssetDistributionId }
  | { kind: 'characterBag'; characterId: CharacterId }
  | { kind: 'participantCharacterBags'; characterIds: CharacterId[] };
```

`GatheringResolutionRequest` 只是 Host Workflow 呼叫純 Resolver 時使用的本地 DTO，**不是** Game Command、Internal Command、Scheduled Job、Domain Event，也不進 Router 或 `WorkflowDefinition.startsFrom`。各來源必須以現有正式訊息啟動自己的 Host Workflow：固定地圖採集點使用 `gatherDungeonNode` Game Command；旅行資源使用既有旅行內容事件流程；敵人掉落使用既有戰鬥獎勵流程；NPC 地牢則在 Dungeon Settlement 內解析。來源擁有模組負責自己的位置、時間與資格規則，Host Workflow 重新查詢目前 State，不能相信 UI 傳入的等級、產物或採集者。

第一版 Composition 必須把 `gatherDungeonNode` 只路由給 `dungeon-gathering-workflow`，不得同時註冊 Dungeon Game Command Handler。該 Workflow 的 required steps 固定為 `ConsumeDungeonGatheringAction → HarvestMapGatheringNode → CreateItemInstance（每筆產物）→ AppendAssetDistributionResult → GrantGatheringMasteryExperience`；純 `GatheringResolver` 在第一與第二個命令之間執行。任一步驟拒絕都回滾時間、cursor 與全部下游結果。

固定地圖採集點與敵人掉落第一版只能送入既有 `assetDistribution`。旅行資源固定使用 `participantCharacterBags`：先取隊內最高採集等級（同級取穩定 CharacterId）作為全隊的 RNG 等級基準，再讓每位本次正式參與者各自抽取一份種類與數量，直接進自己的背包。各角色的一次性子 Stream 固定由 `gathering:<resolutionId>:<characterId>` 推導、cursor 從 `0` 開始；它們不進存檔，也不共享或推進採集的基礎 Stream。最高採集者仍是本次 `contributorCharacterId`，只由其取得採集 MXP。若未來增加其他 Escrow，必須先擴充 `ItemLocation` 與此 union，不能把任意字串當位置。

### 4.2 完成（無複合事件；改由各擁有模組事件表達）

Gathering 沒有 State、不是模組，**不擁有 Domain Event**，因此不發 `GatheringResolved` 複合事件。來源 Host Workflow 在同一交易內以有模組所有者的命令完成各步驟，各步驟由其擁有模組發出真實事件，並以 `transactionId` 與 `GatheringResolutionId` 關聯：

| 步驟 | 命令（擁有模組） | 該模組事件 |
|---|---|---|
| 標記採集點 | `HarvestMapGatheringNode`（map） | `MapGatheringNodeHarvested` |
| 建立產物 | `CreateItemInstance`（inventory） | `ItemInstanceCreated` |
| 加入成果 | `AppendAssetDistributionResult`（distribution） | `AssetDistributionResultAppended` |
| 發放採集 MXP | `GrantGatheringMasteryExperience`（progression） | `MasteryExperienceGranted` |

```ts
type GrantGatheringMasteryExperience = Readonly<{
  resolutionId: GatheringResolutionId;
  contributorCharacterId: CharacterId;
  masteryId: MasteryId;
  experienceAwardRuleId: ExperienceAwardRuleId;
}>;
```

唯一處理者為 progression，冪等來源為 `resolutionId + contributorCharacterId + masteryId`。各步驟皆為 required：任一失敗則整筆交易回滾（不會留下「節點已採、物品不存在」的半成品）。NPC Settlement 另以 `NpcDungeonSettlementApplied` 表達。

---

## 5. 地圖採集點原子流程

```text
玩家在採集點所屬房間送出 gatherDungeonNode
  → dungeon-gathering-workflow（startsFrom = gatherDungeonNode）
      → 以交易 Runtime ID cursor 配發唯一 GatheringResolutionId
      → required ConsumeDungeonGatheringAction
          → Dungeon 重新驗證 Session、房間、Map Version、無戰鬥／Pending Interaction
          → Dungeon 增加 Gathering Rule 指定的迷宮分鐘
      → 重新驗證節點 available
      → 從探索開始時的正式參與者快照選出最高採集者
      → GatheringResolver 解析種類與數量並回傳 nextCursor
      → required HarvestMapGatheringNode(resolutionId)
      → required CreateItemInstance(location = assetDistributionEscrow)
      → required AppendAssetDistributionResult(sourceGatheringResolutionId)
      → required GrantGatheringMasteryExperience
  → 任一步驟失敗：分鐘、節點、物品、成果與 MXP 全部回滾
```

- 地牢採集物是本次共同探索成果，沿用玩家競拍／NPC RNG 分配；不直接放進採集者個人背包。
- 採集者只決定產物解析與採集 MXP，不因此自動取得物品所有權。
- 同一 Map Version 的節點只能成功一次；另一隊伍競爭失敗時整筆命令拒絕，不扣分鐘。
- 正式刷新把節點恢復為 `available`，但已建立並進入 Distribution／角色背包的物品不受刷新影響。

---

## 6. NPC、旅行與敵人來源

### 6.1 NPC 地牢

`npcPolicy.eligible=true` 的採集點會以 `gatheringNode` Entry 進入 Map 的有序 NPC 序列。Dungeon 依 `pointCost` 扣除當日 10 點，並把完整 deterministic `GatheringResolution` 暫存在 Run；只有 `ApplyNpcDungeonSettlement` 實際套用成功後，才標記節點、建立物品並送 `GrantGatheringMasteryExperience`。被玩家搶先採集時列入 `skippedResults`，不發物品或 MXP；Settlement 日也不得重骰採集者或產物。

NPC 的候選人必須使用 Run 開始時的正式參與者快照，不能在結算日改用已變動的隊伍名單。

### 6.2 旅行資源與敵人採集型掉落

兩者共用同一 Resolver、最高等級採集者規則與完成事件，但來源擁有者仍不同：

- 玩家旅行 Content Event 決定來源是否成立與採集是否耗用事件選項；非玩家隊伍固定 6 日直達，永遠不建立 `travelResource` Source。
- Combat／Reward Workflow 決定敵人掉落來源是否已正式達成。
- 敵人採集型掉落仍進本次短期 Distribution；旅行資源則固定讓每位正式參與者依全隊最高採集等級各自獨立抽取並進個人背包。地圖固定採集點仍進共同 Distribution。其他目的地必須由 `GatheringDestinationPolicyId` 明確指定；未定義目的政策的資料不得啟用。

---

## 7. 不變量與測試

1. Gathering 不得建立持久 State Slice。
2. 每筆 `GatheringResolutionId` 只能成功提交一次。
3. 地圖節點 `available → harvested` 與 Item Instance 建立必須在同一 Engine Transaction。
4. 採集者必須屬於來源提供的正式參與者快照。
5. 最高等級同分時穩定選出相同 Character，不消耗 RNG。
6. 只有 `GrantGatheringMasteryExperience` 的 `contributorCharacterId` 取得一次採集 MXP；旅行資源的其他獨立抽取者不重複取得 MXP。
7. 地牢採集產物在離場分配前沒有個人 Owner。
8. 玩家與 NPC 競爭同一節點時至多一方成功；失敗方不扣時間、點數或取得 MXP。
9. Map 刷新只重設節點，不刪除已採得物品，也不清除玩家已揭露的採集點位置。
10. 快轉 NPC Run 與逐日處理得到相同的採集者、產物與節點結果。

---

## 8. 交接清單

- [ ] Gathering Rule／Source／Resolution Schema 與 JSON Schema。
- [ ] GatheringDefinitionReader 與純 GatheringResolver。
- [ ] `dungeon-gathering-workflow` 與旅行／戰鬥獎勵／NPC 地牢三種既有 Host Workflow 的 Gathering Resolver Adapter。
- [ ] Map Node、Inventory、Distribution、Progression 的原子交易測試。
- [ ] 玩家／NPC 競爭、存讀檔、刷新與 deterministic RNG 測試。
- [ ] 第一版採集內容資料與 NPC 採集 Point Cost／Sequence 資料。
