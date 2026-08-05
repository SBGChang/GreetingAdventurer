# Economy 模組契約

> **模組 ID：** `economy`
>
> **依賴：** [共用核心契約](00_shared_contracts.md)、World／Character／Progression／Social 的公開 Query。
>
> **責任：** 管理貨幣帳戶、餘額、原子轉帳、任務報酬付款、商店報價與可重播帳本。Economy 是所有金錢數值的唯一真相來源。
>
> **非責任：** 不擁有商品實體、商店貨架、委託狀態、角色聲望、玩家好感、世界戰爭或物品價格 Definition。

---

## 1. 邊界與所有權

### 1.1 Economy 唯一可寫的 State

```ts
type EconomyState = {
  accounts: Record<EconomyAccountId, EconomyAccount>;
  transfers: Record<EconomyTransferId, EconomyTransferRecord>;
  pricingEpochs: Record<PriceScopeKey, Revision>;
};
```

### 1.2 Economy 不擁有的事

| 事實 | 所有者 | Economy 的角色 |
|---|---|---|
| 角色擁有哪些物品 | inventory | 只處理購買所需的金錢步驟。 |
| 貨架 Offer 是否存在、是否保留 | city | 依 Offer、買家與市場狀態產生 Quote。 |
| 委託是否完成、獎勵規則 | quest | 接收已驗證的付款命令。 |
| 角色聲望 | character | 只讀取報價所需的公開數值。 |
| 冒險者對玩家好感 | social | 家教服務 Quote 只讀好感修正，不保存副本或建立關係網。 |
| 戰爭、市場壓力與地區控制 | world | 讀取目前有效的 Price Modifier。 |
| 資產繼承對象 | character／app workflow | 只執行已驗證的帳戶移轉。 |

貨幣不是 ItemInstance；不得把金錢塞進 Inventory 的一般物品堆疊。

---

## 2. 靜態資料契約

### 2.1 EconomyDefinitionReader

```ts
interface EconomyDefinitionReader {
  getCurrency(id: CurrencyId): CurrencyDefinition;
  getPriceRule(id: PriceRuleId): PriceRuleDefinition;
  getPriceModifierRule(id: PriceModifierRuleId): PriceModifierRuleDefinition;
  getRewardRule(id: RewardRuleId): RewardRuleDefinition;
}
```

### 2.2 貨幣與報價規則

```ts
type CurrencyDefinition = DefinitionHeader & {
  smallestUnit: number;
  display: CurrencyDisplayDefinition;
};

type MoneyValue = {
  currencyId: CurrencyId;
  amount: number;
};

type PriceRuleDefinition = DefinitionHeader & {
  baseValueSource: 'itemDefinition' | 'offerFixedValue' | 'rewardDefinition' | 'serviceDefinition';
  buyModifierIds: PriceModifierRuleId[];
  sellModifierIds: PriceModifierRuleId[];
  roundingPolicy: 'floor' | 'ceil' | 'nearest';
  minimumPrice: number;
};

type PriceModifierRuleDefinition = DefinitionHeader & {
  resolverId: ResolverId;
  stackPolicy: 'multiply' | 'add' | 'strongest';
};
```

實際價格公式尚未定案時，以資料規則留空，不在 Economy Handler 內自行假設物價、稅率、戰爭倍率或關係折扣。

每筆角色個人買入／賣出 Quote 必須把 `ProgressionQuery.getSocialMasteryBenefits(characterId).personalTradeBonus` 納入資料指定的 Price Modifier Resolver。Team 沒有買賣加成；同一隊不同角色付款時，必須各自重算自己的 Quote。

---

## 3. Runtime State

### 3.1 帳戶

```ts
type EconomyAccount = {
  accountId: EconomyAccountId;
  owner:
    | { kind: 'character'; characterId: CharacterId }
    | { kind: 'city'; cityId: CityId }
    | { kind: 'assetDistribution'; distributionId: AssetDistributionId }
    | {
        kind: 'system';
        purpose:
          | 'questRewards'
          | 'shopSink'
          | 'dungeonGoldSource'
          | 'lootDirectSaleSource'
          | 'inheritanceEscrow';
      };
  currencyId: CurrencyId;
  balance: number;
  revision: Revision;
};
```

第一版可只有一種貨幣，但 Runtime 與契約不把貨幣 ID 寫死。

Team 是行動共同體，不能成為 Economy Account Owner。每名真實角色各自持有個人帳戶；招募、轉隊與解雇不轉移帳戶或餘額。`assetDistribution` 是一次任務均分、地牢分配或到期任務物資分配的暫存清算帳戶，結算完成後餘額必須為 0。

### 3.2 轉帳紀錄

```ts
type EconomyTransferRecord = {
  transferId: EconomyTransferId;
  transactionId: TransactionId;
  fromAccountId?: EconomyAccountId; // system mint 可沒有來源
  toAccountId?: EconomyAccountId;   // system sink 可沒有目的地
  currencyId: CurrencyId;
  amount: number;
  reason: EconomyTransferReason;
  sourceId: GameId;
  appliedOnDay: WorldDay;
};
```

`transferId` 是冪等鍵。同一 Transfer ID 重送時只能回傳既有結果，不得再次增減餘額。

### 3.3 報價 Epoch

`pricingEpochs` 只記錄某城市／地區／角色相關報價規則最後失效的 Revision，不保存每次 UI 查詢產生的 Quote。市場壓力或聲望改變時遞增對應 Epoch；Quote 同時綁定 Offer Revision 與這些 Epoch，成交前重新比對。

---

## 4. 公開 Query

```ts
interface EconomyQuery {
  getBalance(accountId: EconomyAccountId): number;
  getCharacterAccount(characterId: CharacterId, currencyId: CurrencyId): EconomyAccountId;
  getAssetDistributionAccount(distributionId: AssetDistributionId, currencyId: CurrencyId): EconomyAccountId;
  canAfford(accountId: EconomyAccountId, amount: number): boolean;
  getPurchaseQuote(input: PurchaseQuoteInput): PriceQuote;
  getSellQuote(input: SellQuoteInput): PriceQuote;
  getServiceQuote(input: ServiceQuoteInput): PriceQuote;
}

type ServiceQuoteInput = {
  serviceKind: 'homeTutor';
  serviceDefinitionId: DefinitionId;
  providerCharacterId: CharacterId;
  buyerCharacterId: CharacterId;
  sourceRevision: Revision;
};

type PriceQuote = {
  quoteId: PriceQuoteId;
  currencyId: CurrencyId;
  amount: number;
  priceRuleId: PriceRuleId;
  modifierBreakdown: PriceModifierBreakdown[];
  validFor: {
    sourceRevision: Revision;
    pricingEpochs: Record<PriceScopeKey, Revision>;
  };
};
```

Quote 是可重建、不可存檔的 DTO。它必須綁定 Offer／Item／Service 等價格來源與相關 State Revision；任一來源在提交前改變時，舊 Quote 失效並重新計算。

`serviceKind: homeTutor` 必須由資料指定基礎價格，再把 `SocialQuery.getHomeTutorPriceModifier(providerCharacterId)` 作為一筆可解釋的 Modifier 納入 Quote。這只影響玩家向該冒險者請求擔任家教的價格；NPC 彼此沒有好感，因此不得套用這條修正。


---

## 5. 輸入契約

### 5.1 Internal Command

| Internal Command | Economy 的反應 |
|---|---|
| `TransferCurrency` | 驗證來源餘額、貨幣與 Transfer ID 後原子移轉。 |
| `GrantCurrency` | 依已驗證 Reward Rule 從 system source 發放。 |
| `RemoveCurrency` | 依已驗證費用、罰金或 system sink 扣除。 |
| `CreateEconomyAccount` | 為新角色、城市、Asset Distribution 清算或必要系統用途建立帳戶。 |

所有命令都必須帶 `sourceId` 與原因；UI 不可直接傳入任意 `GrantCurrency`。

### 5.2 訂閱 DomainEvent

| Event | Economy 的反應 |
|---|---|
| `MarketPressureChanged` | 不複製 World State；使受影響 Quote revision 失效。 |
| `CharacterReputationChanged` | 使使用該角色聲望的 Quote 失效。 |
| `PlayerAffinityChanged` | 只使該冒險者作為家教提供者的 Service Quote 失效；不複製好感值。 |

---

## 6. 輸出事件

| Event | 最少 payload | 訂閱者 |
|---|---|---|
| `CurrencyTransferred` | `transferId`、`from?`、`to?`、`amount`、`reason` | city、quest、ui/app。 |
| `EconomyAccountCreated` | `accountId`、`owner`、`currencyId` | character、distribution、ui/app。 |
| `PriceQuoteInvalidated` | `scope`、`reason` | city、ui/app。 |

Internal Command 餘額不足使用 typed rejection，不發出 `CurrencyTransferRejected` Event。

---

## 7. 核心 Workflow

### 7.1 商店購買

```text
BuyShopOffer GameCommand
  → City 驗證 Offer、地點、保留與 revision
  → Economy 重新驗證 Quote
  → TransferCurrency（required）
  → Inventory TransferItem（required）
  → City 將 Offer 標記 sold
  → ShopOfferSold + CurrencyTransferred + InventoryTransferred
  → 全部成功才提交
```

任何一步失敗都不得扣款、移物或關閉 Offer。

### 7.2 販售

```text
SellItem GameCommand
  → Inventory 驗證實體可交易
  → Economy 產生 Sell Quote
  → Inventory TransferItem 到 shopShelf（required）
  → TransferCurrency 給賣方（required）
  → City 建立 source=playerSold 的 Offer／刷新清理標記
```

### 7.3 委託結案與繼承

- Quest 只有在原接取公會合法結案時，才能建立 `equalCurrencyOnly` Asset Distribution；Distribution 將已驗證報酬放入清算帳戶並平均發給 Quest 保存的正式參與角色，不經 Team Account。
- 任務到期、只完成未結案、或在錯誤公會，不得發放金錢。
- 角色死亡後由繼承 Workflow 決定目標帳戶；Economy 只執行已驗證的 `TransferCurrency`。

### 7.4 地牢內部競拍與均分

```text
建立 Player Asset Distribution
  → CreateEconomyAccount(owner=assetDistribution)
  → 地牢金幣由 dungeonGoldSource GrantCurrency 到清算帳戶

每件實物：
  有人得標
    → 得標者個人帳戶 TransferCurrency 到清算帳戶
  無人出價
    → lootDirectSaleSource 依 intrinsicValue × 0.8 GrantCurrency 到清算帳戶

全部物品結束
  → 清算帳戶總額按正式參與成員數平均
  → 逐人 TransferCurrency 到個人帳戶
  → 最小貨幣單位的餘數依 distributionId 導出的 deterministic 順序逐一分配
  → 清算帳戶必須歸零
```

內部競拍使用 Item Definition 的 `intrinsicValue` 作為最低出價，不套用商店、戰爭、聲望、城市或關係修正。得標者支付的款項也進入共同清算池，因此最後會和其他正式參與者一起取得自己的均分份額。

---

## 8. 不變量與測試

1. 餘額與金額皆為最小貨幣單位整數。
2. 除非未來明確加入信用規則，任何帳戶餘額不得低於 0。
3. 同一 `transferId` 只能套用一次。
4. Transfer 的幣別必須與兩端帳戶一致。
5. Quote Revision 過期時不能成交。
6. 購買任一步驟失敗，餘額、ItemLocation 與 Offer 全部不變。
7. 戰爭／市場壓力只使 Quote 變化，不直接修改既有帳戶。
8. 相同 State、Definition、Quote Input 得到相同價格。
9. 不存在 Team Account；角色轉隊前後的個人 Account ID 與餘額完全不變。
10. 玩家地牢結算完成時，清算帳戶必須為 0，競拍款、八折直售款與地牢金幣的流入總額必須等於成員所得總額。
11. 內部競拍只能使用 `intrinsicValue`，不得取得或套用一般 Shop Quote。
12. 均分餘數的分配順序必須 deterministic，快轉、存讀檔與重播結果一致。
13. 家教 Quote 的好感修正只能來自 Social Query；Economy State、City State 與 Quote Cache 都不得保存第二份好感值。

---

## 9. Economy 模組交接清單

- [ ] Currency、Price Rule、Modifier、Reward JSON Schema。
- [ ] Account、Transfer Record、Quote DTO。
- [ ] `EconomyQuery` 與報價 Resolver。
- [ ] Currency Internal Command Handler 與冪等。
- [ ] 購買、販售、好感修正家教 Quote、委託均分、地牢競拍／均分、繼承 Workflow 契約測試。
