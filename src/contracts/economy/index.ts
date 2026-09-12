// contracts/economy — Economy 模組公開契約（純型別）。
// 來源：docs/00_core/architecture/08_economy_module.md
// 僅含型別／介面：Definition、Query port、Internal Command、DomainEvent payload。

import type {
  Brand,
  DefinitionId,
  DefinitionHeader,
  LocalizedTextRef,
  WorldDay,
  Revision,
  ResolverId,
  CurrencyId,
  PriceRuleId,
  PriceModifierRuleId,
  PriceQuoteId,
  EconomyAccountId,
  EconomyTransferId,
  CharacterId,
  CityId,
  AssetDistributionId,
  TransactionId,
  EntitySourceRef,
  ItemInstanceId,
  ShopOfferId,
} from '../core';

// ── Economy 擁有但未列於 contracts/core 的型別 ─────────────────────────────
export type RewardRuleId = DefinitionId<'reward-rule'>;

// pricingEpochs 的 key：某城市／地區／角色相關報價 scope 的序列化鍵。
export type PriceScopeKey = Brand<string, 'price-scope-key'>;

// 轉帳原因（doc §3.2 的 `EconomyTransferRecord.reason`）。
//
// 它**是冪等鍵的一部分**（見 system.ts 的 transfer identity 比對：transferId + from + to + amount
// + reason）。所以裸 `string` 不只是型別鬆——一個打錯字的 reason 會構成**不同的**轉帳身分，讓本該
// 被冪等擋下的重送真的再扣一次錢。改成 branded：任意字串再也指派不進來。
//
// 值集刻意**不在這裡列舉**。已落地的送出端用的是 `<module>.<flow>` 命名（city 已在用
// `city.shopPurchase` / `city.shopSale` / `city.homePurchase` / `city.homeUpgrade`），而流程屬於
// **送出模組**。economy 若把每個模組的流程列成聯集，就變成 economy 反向依賴 city／dungeon／quest
// ——正好是模組邊界要避免的方向。新增流程時由該模組宣告自己的 reason 常數。
export type EconomyTransferReason = Brand<string, 'economy-transfer-reason'>;

// 貨幣顯示資料（08_economy_module.md §2 的 `CurrencyDefinition.display`）。名稱走本地化引用，
// 不放已翻譯字串——否則同一份 pack 沒辦法支援多語。
export type CurrencyDisplayDefinition = Readonly<{ nameRef: LocalizedTextRef }>;

// ── §2 靜態資料契約 ────────────────────────────────────────────────────────

export type CurrencyDefinition = DefinitionHeader<CurrencyId> & {
  smallestUnit: number;
  display: CurrencyDisplayDefinition;
};

export type MoneyValue = {
  currencyId: CurrencyId;
  amount: number;
};

export type PriceRuleDefinition = DefinitionHeader<PriceRuleId> & {
  // 基礎價值從哪裡來。
  //
  // `ruleFixedAmount` 是為「資產」補的第五種（F3：家園）。`content-source/yunhua/world-city.ts`
  // 記載了為什麼原本四種都裝不下房價：一棟房子不是物品（填 itemDefinition 會讓它進得了背包）、
  // 不是商店 Offer、不是委託報酬、也不是勞務服務（那是家教費的形狀）。而 GDD §八
  // 「買房時決定 Slot 數量（越大越貴）」要的正是「slot 數 → 價格」這條對應。
  //
  // 補法是讓價格**住在規則自己身上**：一個 slot 數一條 Price Rule，各自帶自己的 `baseAmount`。
  // 這樣「越大越貴」是內容的宣告，不是程式的公式。
  baseValueSource:
    | 'itemDefinition'
    | 'offerFixedValue'
    | 'rewardDefinition'
    | 'serviceDefinition'
    | 'ruleFixedAmount';
  // 只有 `ruleFixedAmount` 有這一欄；其餘來源的基礎價值由該來源提供，缺席＝不適用。
  baseAmount?: MoneyValue;
  buyModifierIds: PriceModifierRuleId[];
  sellModifierIds: PriceModifierRuleId[];
  roundingPolicy: 'floor' | 'ceil' | 'nearest';
  minimumPrice: number;
};

export type PriceModifierRuleDefinition = DefinitionHeader<PriceModifierRuleId> & {
  resolverId: ResolverId;
  stackPolicy: 'multiply' | 'add' | 'strongest';
};

// 價格修正係數的調校量（F3：economy 報價鏈）。
//
// 程式只實作**一種形狀**：`係數 = base + weight × 來源值`。三個來源是封閉集合，
// 「哪一條修正用哪個來源、係數怎麼配」全部是內容。設計來源目前只寫「最終公式另行定案」
//（GDD §隊員交流），所以實際數字是第一版方案，改它不需要動程式。
//
// 三個欄位對每一種 source 都必填且語意相同（fixed 時 weight 為 0），符合「共用表只放
// 所有 Func 都必填且同義的欄位」。
export type PriceModifierSource =
  // 付款／收款角色本人的交流熟練買賣加成（doc §2.2 要求必須納入）。
  | 'personalTradeBonus'
  // 玩家對該冒險者的好感所產生的家教價格修正（doc §4）。只有 homeTutor 服務會帶。
  | 'homeTutorPriceModifier'
  // 不看任何來源的固定係數（例如商店買回率）。
  | 'fixed';

export type PriceModifierParamsDefinition = DefinitionHeader & {
  source: PriceModifierSource;
  base: number;
  weight: number;
};

// `EconomyDefinitionReader.getRewardRule` 的回傳（doc §2 只給簽章沒給形狀）。報酬金額本身是可調
// 內容，所以規則只指名算它的 Resolver，數值在該 Resolver 的 params——這正是 §7.1「形狀＝程式、
// 調校＝資料」。規則不直接帶金額，否則報酬平衡會需要改契約。
export type RewardRuleDefinition = DefinitionHeader<RewardRuleId> & {
  resolverId: ResolverId;
  /** 固定報酬的作者參數；缺席時必須由指定 Resolver 解析。 */
  fixedAmount?: MoneyValue;
  itemValueMultiplier?: number;
};

export interface EconomyDefinitionReader {
  getCurrency(id: CurrencyId): CurrencyDefinition;
  getPriceRule(id: PriceRuleId): PriceRuleDefinition;
  getPriceModifierRule(id: PriceModifierRuleId): PriceModifierRuleDefinition;
  getRewardRule(id: RewardRuleId): RewardRuleDefinition;

  // 非拋出版：Internal Command 的 currencyId / rewardRuleId 由**呼叫端**（city、distribution、
  // workflow）帶入，不是內容之間的引用，因此 Content Pack 的 reference 驗證擋不到它。Handler 必須
  // 能對「命令引用了不存在的定義」回 typed rejection（規範五個合法出口的第 4 項），而只有拋出版
  // getter 的話，唯一寫法是 try/catch 包住 Reader 例外——那正是規範 §6 點名的樣式。
  // 內容→內容的引用（PriceRule 的 buy/sellModifierIds）仍只用拋出版：那種缺漏是壞內容，該炸。
  tryGetCurrency(id: CurrencyId): CurrencyDefinition | undefined;
  tryGetRewardRule(id: RewardRuleId): RewardRuleDefinition | undefined;
}

// ── §3 Runtime State ───────────────────────────────────────────────────────

export type EconomyAccountOwner =
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

export type EconomyAccount = {
  accountId: EconomyAccountId;
  owner: EconomyAccountOwner;
  currencyId: CurrencyId;
  balance: number;
  revision: Revision;
};

export type EconomyTransferRecord = {
  transferId: EconomyTransferId;
  transactionId: TransactionId;
  fromAccountId?: EconomyAccountId; // system mint 可沒有來源
  toAccountId?: EconomyAccountId; // system sink 可沒有目的地
  currencyId: CurrencyId;
  amount: number;
  reason: EconomyTransferReason;
  sourceId: EntitySourceRef;
  appliedOnDay: WorldDay;
};

export type EconomyState = {
  accounts: Record<EconomyAccountId, EconomyAccount>;
  transfers: Record<EconomyTransferId, EconomyTransferRecord>;
  pricingEpochs: Record<PriceScopeKey, Revision>;
};

// ── §4 公開 Query ──────────────────────────────────────────────────────────

// 以 Price Rule 直接報價（資產購買：房屋與功能間升級）。
//
// 前四種來源都裝不下房價（見 PriceRuleDefinition.baseValueSource 的說明），所以資產的價格
// **住在規則自己身上**：一個 slot 數一條 Price Rule，各自帶 `baseAmount`。
export type PriceRuleQuoteInput = {
  priceRuleId: PriceRuleId;
  buyerCharacterId: CharacterId;
  cityId: CityId;
  sourceRevision: Revision;
};

export type ServiceQuoteInput = {
  serviceKind: 'homeTutor';
  serviceDefinitionId: DefinitionId;
  providerCharacterId: CharacterId;
  buyerCharacterId: CharacterId;
  sourceRevision: Revision;
};

// PurchaseQuoteInput／SellQuoteInput doc 未指定形狀；依購買／販售 Workflow 語意最小推定。
//
// 兩個 ID 原本宣告為 `EntitySourceRef`，但那個 Union 是
// `CharacterId | TeamId | QuestId | CityId | MapInstanceId | ContentEventInstanceId | ItemInstanceId | EncounterId`
// ——**不含** `ShopOfferId`。也就是說 `offerId: EntitySourceRef` 型別上根本表達不出「一筆貨架 Offer」，
// 能塞進去的最接近的東西是 ItemInstanceId。價格來源 Port 必須依 Offer 定位 City 的
// `ShopOffer.priceRuleId`，用一個裝不下 ShopOfferId 的型別去接，等於把契約缺口留給實作端硬轉。
// 兩者改為各自的精確 ID（`ShopOfferId` 由 contracts/core 提供；販售的來源是具體 Item 實體，
// 對齊 city 的 `SellItemToShopCommand.itemId: ItemInstanceId`）。
export type PurchaseQuoteInput = {
  offerId: ShopOfferId;
  buyerCharacterId: CharacterId;
  sourceRevision: Revision;
};

export type SellQuoteInput = {
  itemSourceId: ItemInstanceId;
  sellerCharacterId: CharacterId;
  cityId: CityId;
  sourceRevision: Revision;
};

// 報價的逐項修正明細。doc §3.3 的 PriceQuote 只說有修正，未給明細形狀；這裡定形為「哪一條修正
// 規則、套了多少」，`label` 供 UI 顯示。有明細才能回答玩家「為什麼這個價」，也才能在平衡出錯時
// 指認是哪一條規則造成的。
export type PriceModifierBreakdown = {
  modifierRuleId: PriceModifierRuleId;
  label?: LocalizedTextRef;
  appliedAmount: number;
};

export type PriceQuote = {
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

export interface EconomyQuery {
  getBalance(accountId: EconomyAccountId): number;
  getCharacterAccount(characterId: CharacterId, currencyId: CurrencyId): EconomyAccountId;
  getAssetDistributionAccount(distributionId: AssetDistributionId, currencyId: CurrencyId): EconomyAccountId;
  canAfford(accountId: EconomyAccountId, amount: number): boolean;
  getPurchaseQuote(input: PurchaseQuoteInput): PriceQuote;
  getSellQuote(input: SellQuoteInput): PriceQuote;
  getServiceQuote(input: ServiceQuoteInput): PriceQuote;
  getPriceRuleQuote(input: PriceRuleQuoteInput): PriceQuote;
}

// ── §5.1 Internal Command ──────────────────────────────────────────────────
// 所有命令都必須帶 sourceId 與原因；UI 不可直接傳入任意 GrantCurrency。
export type TransferCurrencyCommand = Readonly<{
  type: 'TransferCurrency';
  transferId: EconomyTransferId; // 冪等鍵
  fromAccountId: EconomyAccountId;
  toAccountId: EconomyAccountId;
  currencyId: CurrencyId;
  amount: number;
  reason: EconomyTransferReason;
  sourceId: EntitySourceRef;
}>;

export type GrantCurrencyCommand = Readonly<{
  type: 'GrantCurrency';
  transferId: EconomyTransferId;
  toAccountId: EconomyAccountId;
  rewardRuleId: RewardRuleId;
  reason: EconomyTransferReason;
  sourceId: EntitySourceRef;
}>;

export type RemoveCurrencyCommand = Readonly<{
  type: 'RemoveCurrency';
  transferId: EconomyTransferId;
  fromAccountId: EconomyAccountId;
  currencyId: CurrencyId;
  amount: number;
  reason: EconomyTransferReason;
  sourceId: EntitySourceRef;
}>;

export type CreateEconomyAccountCommand = Readonly<{
  type: 'CreateEconomyAccount';
  owner: EconomyAccountOwner;
  currencyId: CurrencyId;
  sourceId: EntitySourceRef;
}>;

export type EconomyInternalCommand =
  | TransferCurrencyCommand
  | GrantCurrencyCommand
  | RemoveCurrencyCommand
  | CreateEconomyAccountCommand;

// ── §6 輸出事件（DomainEvent payload）──────────────────────────────────────
export type CurrencyTransferred = Readonly<{
  type: 'CurrencyTransferred';
  transferId: EconomyTransferId;
  from?: EconomyAccountId;
  to?: EconomyAccountId;
  amount: number;
  reason: EconomyTransferReason;
}>;

export type EconomyAccountCreated = Readonly<{
  type: 'EconomyAccountCreated';
  accountId: EconomyAccountId;
  owner: EconomyAccountOwner;
  currencyId: CurrencyId;
}>;

export type PriceQuoteInvalidated = Readonly<{
  type: 'PriceQuoteInvalidated';
  scope: PriceScopeKey;
  reason: string;
}>;

export type EconomyDomainEvent =
  | CurrencyTransferred
  | EconomyAccountCreated
  | PriceQuoteInvalidated;
