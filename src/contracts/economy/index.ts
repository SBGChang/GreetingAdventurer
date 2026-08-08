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
} from '../core';

// ── Economy 擁有但未列於 contracts/core 的型別 ─────────────────────────────
export type RewardRuleId = DefinitionId<'reward-rule'>;

// pricingEpochs 的 key：某城市／地區／角色相關報價 scope 的序列化鍵。
export type PriceScopeKey = Brand<string, 'price-scope-key'>;

// 轉帳原因；doc 未列舉完整值，以字串佔位待資料規則收斂。
export type EconomyTransferReason = string;

// 貨幣顯示資料為 UI 投影，契約未指定完整形狀；最小佔位。
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
  baseValueSource: 'itemDefinition' | 'offerFixedValue' | 'rewardDefinition' | 'serviceDefinition';
  buyModifierIds: PriceModifierRuleId[];
  sellModifierIds: PriceModifierRuleId[];
  roundingPolicy: 'floor' | 'ceil' | 'nearest';
  minimumPrice: number;
};

export type PriceModifierRuleDefinition = DefinitionHeader<PriceModifierRuleId> & {
  resolverId: ResolverId;
  stackPolicy: 'multiply' | 'add' | 'strongest';
};

// getRewardRule 回傳；doc 未指定形狀，僅保留 Definition 標頭佔位。
export type RewardRuleDefinition = DefinitionHeader<RewardRuleId> & {
  resolverId: ResolverId;
};

export interface EconomyDefinitionReader {
  getCurrency(id: CurrencyId): CurrencyDefinition;
  getPriceRule(id: PriceRuleId): PriceRuleDefinition;
  getPriceModifierRule(id: PriceModifierRuleId): PriceModifierRuleDefinition;
  getRewardRule(id: RewardRuleId): RewardRuleDefinition;
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

export type ServiceQuoteInput = {
  serviceKind: 'homeTutor';
  serviceDefinitionId: DefinitionId;
  providerCharacterId: CharacterId;
  buyerCharacterId: CharacterId;
  sourceRevision: Revision;
};

// PurchaseQuoteInput／SellQuoteInput doc 未指定形狀；依購買／販售 Workflow 語意最小推定。
export type PurchaseQuoteInput = {
  offerId: EntitySourceRef;
  buyerCharacterId: CharacterId;
  sourceRevision: Revision;
};

export type SellQuoteInput = {
  itemSourceId: EntitySourceRef;
  sellerCharacterId: CharacterId;
  cityId: CityId;
  sourceRevision: Revision;
};

// 報價修正明細；doc 未指定完整形狀，最小可解釋欄位佔位。
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
