# Asset Distribution 模組契約

> **模組 ID：** `distribution`
>
> **依賴：** [共用核心契約](00_shared_contracts.md)、Team／Character／Inventory／Economy 的公開 Query。
>
> **責任：** 處理「沒有個人 Owner 的共同成果」如何正式變成個人財產。第一版來源包含任務貨幣報酬、玩家／NPC 地牢成果，以及 expired Quest 的任務物資。Team 只是參與者集合，不會因此取得帳戶或一般物品所有權。

---

## 1. State 與邊界

```ts
type AssetDistributionState = {
  distributions: Record<AssetDistributionId, AssetDistribution>;
};
```

Distribution 唯一可寫的是分配流程、競拍回合與參與者快照。它不直接改 Inventory Owner 或 Economy Balance；所有實際物品與貨幣變化都使用 required Internal Command。

---

## 2. 資料契約

```ts
interface AssetDistributionDefinitionReader {
  getRule(id: AssetDistributionRuleId): AssetDistributionRuleDefinition;
}

type AssetDistributionRuleDefinition = DefinitionHeader & {
  sourceKind: 'questReward' | 'dungeonLoot' | 'expiredQuestCargo';
  controllerPolicy: 'playerAuction' | 'npcRng' | 'equalCurrencyOnly';
  currencyPolicy: 'equalSplit';
  itemPolicy: 'internalAuction' | 'rngPerItem' | 'none';
  auction?: {
    minimumBid: 'intrinsicValue';
    unclaimedSaleMultiplier: 0.8;
    companionBidResolverId: ResolverId;
    tieBreakPolicy: 'deterministicFromDistributionId';
  };
  npcItemRecipientResolverId?: ResolverId;
  remainderPolicy: 'deterministicRotation';
};
```

第一版硬規則：

- 玩家地牢與玩家 expired Quest Cargo 使用 `internalAuction`。
- NPC 地牢與 NPC expired Quest Cargo 使用 `rngPerItem`，每件物品各自決定一名正式成員。
- 任務貨幣報酬使用 `equalCurrencyOnly`。
- 所有可分割貨幣最後都平均分給正式參與者。
- 玩家內部競拍的最低出價是 Item Definition 的原價值；流標物直售價固定為原價值 × 0.8。

---

## 3. Runtime State

```ts
type AssetDistribution = {
  distributionId: AssetDistributionId;
  source:
    | { kind: 'questReward'; questId: QuestId }
    | { kind: 'dungeonLoot'; mapId: MapInstanceId; runId?: NpcDungeonRunId }
    | { kind: 'expiredQuestCargo'; questId: QuestId };
  teamId: TeamId;
  participantCharacterIds: CharacterId[];
  ruleId: AssetDistributionRuleId;
  itemIds: ItemInstanceId[];
  currencyInputs: MoneyValue[];
  settlementAccountIds: Record<CurrencyId, EconomyAccountId>;
  currentItemIndex: number;
  auctionRounds: LootAuctionRound[];
  pendingInteraction?: PendingAssetDistributionInteraction;
  status: 'collecting' | 'awaitingPlayerBid' | 'settling' | 'completed' | 'invalid';
  revision: Revision;
  rngContext: RngContext;
};

type LootAuctionRound = {
  itemId: ItemInstanceId;
  intrinsicValue: MoneyValue;
  bids: LootBid[];
  state: 'open' | 'awarded' | 'directSold';
  winnerCharacterId?: CharacterId;
  winningBid?: number;
};

type LootBid = {
  bidderCharacterId: CharacterId;
  amount: number;
  source: 'player' | 'companionResolver';
};

type PendingAssetDistributionInteraction = {
  interactionId: InteractionId;
  kind: 'lootAuction';
  itemId: ItemInstanceId;
  openedOnDay: WorldDay;
  revision: Revision;
};
```

`participantCharacterIds` 在分配建立時固定且不可為空，必須等於來源行動開始時 Team 的全部正式成員；隊伍沒有候補或未參與的正式成員。護衛角色本來就不在 Team，救援等 `temporaryMemberIds` 也永遠排除。分配途中招募、解雇與開始新隊伍大動作都必須等待玩家分配互動結束。參與者之後離隊不喪失本次分配權；若角色已死亡，所得先進入其個人遺產，再由既有繼承 Workflow 處理。

---

## 4. 公開 Query

```ts
interface AssetDistributionQuery {
  getDistribution(id: AssetDistributionId): AssetDistributionView;
  getPendingPlayerDistribution(teamId: TeamId): PlayerAssetDistributionView | undefined;
  getCurrentAuctionRound(id: AssetDistributionId): LootAuctionRoundView | undefined;
}
```

---

## 5. 輸入契約

### 5.1 玩家 Command

| Command | 前置條件 | 結果 |
|---|---|---|
| `submitLootBid` | Distribution 等待玩家、Bidder 是正式參與者、金額不低於原價值且個人帳戶可支付。 | 寫入／提高該角色本回合出價；不立即扣款。 |
| `passLootItem` | Distribution 等待玩家，本回合尚未結束。 | 玩家控制的出價者放棄；同回合 Companion Resolver 出價仍有效。 |
| `resolveLootAuctionRound` | 所有本回合必要決定已齊。 | 依最高有效出價得標；無人出價則八折直售。 |

玩家分配是零世界時間的 Pending Interaction，可存檔；未完成前不能返城、旅行、招募、解雇或繼續長時間快轉。

### 5.2 Internal Command

| Internal Command | 發送者 | Distribution 的反應 |
|---|---|---|
| `StartAssetDistribution` | quest、dungeon、workflow | 建立參與者快照與清算帳戶；依 Policy 立即分配或打開玩家競拍。 |
| `AppendAssetDistributionResult` | quest、dungeon、map／gathering workflow | 在 collecting 階段加入正式取得的 Item／Currency；地圖採集產物沿用目前 `dungeonLoot` Distribution。 |
| `FinalizeAssetDistributionCollection` | dungeon、quest | 關閉收集階段並開始分配。 |

### 5.3 輸出 Internal Command

| Internal Command | 唯一處理者 | 用途 |
|---|---|---|
| `CreateEconomyAccount` | economy | 建立 `owner: assetDistribution` 的暫存清算帳戶。 |
| `GrantCurrency` | economy | 將任務報酬、地牢金幣或八折直售款放入清算帳戶。 |
| `TransferCurrency` | economy | 得標者付款，或清算帳戶向每名角色均分。 |
| `TransferItem` | inventory | 將得標／RNG 分配物設為指定 Character Owner 並移入其背包。 |
| `RemoveItemInstance` | inventory | 流標八折直售後移除實體。 |

---

## 6. 輸出事件

| Event | 最少 payload | 訂閱者 |
|---|---|---|
| `AssetDistributionStarted` | `distributionId`、`source`、`participantCharacterIds` | dungeon、quest、ui/app。 |
| `LootAuctionRoundOpened` | `distributionId`、`itemId`、`intrinsicValue` | ui/app。 |
| `PlayerInteractionOpened` | `interactionId`、`teamId`、`kind: lootAuction` | engine session、ui/app。 |
| `LootItemAwarded` | `distributionId`、`itemId`、`winnerCharacterId`、`winningBid?` | inventory、ui/app。 |
| `LootItemDirectSold` | `distributionId`、`itemId`、`saleValue` | economy、ui/app。 |
| `AssetDistributionCompleted` | `distributionId`、`itemAwards`、`currencyAwards` | dungeon、quest、team、ui/app。 |

---

## 7. 核心流程

### 7.1 玩家內部競拍

```text
每件 Item
  → 讀 intrinsicValue，作為最低出價
  → Companion Resolver 依個人偏好與個人餘額決定 Bid／Pass
  → 玩家提交可控制角色的 Bid／Pass
  → 最高有效 Bid 得標
      → 得標者個人帳戶付款到清算帳戶
      → Item Owner 改為得標者並進入其 characterBag
  → 無有效 Bid
      → Item 以 intrinsicValue × 0.8 直售
      → 直售款進清算帳戶，Item removed
```

同額最高 Bid 依 `distributionId + itemId + characterId` 的固定排序決定，不重骰。若結算時最高出價者餘額已不足，該 Bid 失效並取下一筆有效出價；不得讓個人帳戶變成負數。

### 7.2 NPC RNG 分配

```text
每件 Item
  → npcItemRecipientResolverId 從正式參與者中選一人
  → required TransferItem(owner=recipient, location=characterBag)
全部 Item 完成
  → 可分割貨幣平均分配
  → Distribution completed
```

NPC 不建立玩家競拍互動，也不模擬逐口叫價。RNG Stream 必須綁定 Distribution ID，存讀檔與快轉結果一致。

### 7.3 貨幣均分

```text
總池 = 任務貨幣報酬
    或 地牢金幣 + 玩家競拍款 + 流標直售款

baseShare = floor(總池 / 正式參與人數)
remainder = 總池 - baseShare × 人數
```

每人先取得 `baseShare`；餘數依 Distribution ID 導出的成員輪替順序，每人追加一個最小貨幣單位，直到歸零。清算帳戶歸零與 Distribution completed 必須在同一交易提交。

### 7.4 Expired Quest Cargo

Quest 只使用既有 `expired` 狀態，不新增 failed。若 Purchase／Delivery／Exploration 到期時仍有 Item 位於 `teamQuestCargo`：

1. 以 Quest 保存的正式參與者建立 `expiredQuestCargo` Distribution。
2. Quest 送 `ReleaseExpiredQuestCargo(distributionId)`，將 Item 移入該筆 `assetDistributionEscrow`。
3. 玩家 Team 使用內部競拍；NPC Team 使用逐 Item RNG。
4. 分配完成後 Cargo 必須為空。

---

## 8. 不變量與測試

1. Team、Distribution 與 Quest 都不能成為一般 Item Owner；正式分配結果只可屬 Character。
2. Team 不能成為 Economy Account Owner；所有最終貨幣只進 Character Account。
3. 暫時任務角色不得出現在參與者清單。
4. 每件 Item 在一筆 Distribution 中至多結算一次。
5. 玩家流標價固定為 `floor(intrinsicValue × 0.8)`，不套用任何 Shop Modifier。
6. 得標付款、Item Owner 轉移與回合完成必須原子提交。
7. Distribution 完成時 Item Escrow 為空、所有幣別的 Currency Escrow 都為 0。
8. 任務均分、地牢均分與 Quest Cargo 到期分配使用同一餘數規則。
9. 快轉、逐日、存讀檔與重播得到相同 RNG Recipient、Tie Break 與 Remainder 結果。
10. `awaitingPlayerBid` 時必須恰有一筆可存檔的 `pendingInteraction`；完成或取消回合後必須清除。
11. 參與者快照不可為空；正式建立後不得因轉隊、解雇或死亡刪除成員，死亡者所得由遺產流程承接。

---

## 9. 交接清單

- [ ] Distribution Rule、Runtime State、Auction Round Schema。
- [ ] `AssetDistributionQuery` 與 Pending Interaction View。
- [ ] 玩家 Bid／Pass／Resolve Command Handler。
- [ ] NPC RNG、八折直售、貨幣均分 Resolver。
- [ ] Inventory／Economy required Internal Command Workflow。
- [ ] Dungeon、Quest Cargo、任務報酬 Fixture 與原子交易測試。
