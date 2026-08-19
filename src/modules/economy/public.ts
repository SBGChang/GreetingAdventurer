// modules/economy/public.ts
// Economy 模組對外唯一入口：re-export 執行期 API + 公開契約 + ModuleContract 宣告。
// Composition 只從這裡取得工廠、Handler、Query 與 ModuleContract；不得深入 import 內部檔案。

import type {
  ModuleContract,
  ModuleId,
  StateSliceName,
  ReaderPortId,
  EventSubscriptionId,
  InvariantId,
} from '../../contracts/core';

// 公開契約（型別）——原樣轉出，讓消費者只從模組入口取用。
export type * from '../../contracts/economy';

// ── State ─────────────────────────────────────────────────────────────────––
export {
  emptyEconomyState,
  createEconomyState,
  economyOwnerKey,
  sameEconomyOwner,
  tryGetAccount,
  requireAccount,
  upsertAccount,
  findAccountIdByOwner,
  findCharacterAccountId,
  findAssetDistributionAccountId,
  createEmptyAccount,
  withBalanceDelta,
  tryGetTransfer,
  recordTransfer,
  priceScopeKeyFor,
  citySettlementScope,
  epochOf,
  bumpEpoch,
  epochSnapshotFor,
} from './state';
export type { EconomyState, PriceScope } from './state';

// ── Query ─────────────────────────────────────────────────────────────────––
export { createEconomyQuery, isPriceQuoteCurrent } from './queries';
export type {
  EconomyQueryContext,
  EconomyPriceSourcePort,
  EconomyPriceModifierResolverPort,
  EconomyTradeBonusPort,
  EconomyAffinityPort,
  PriceSourceView,
  PriceModifierResolverInput,
  PriceDirection,
  PriceRuleModifierStackPolicy,
} from './queries';

// ── System（Internal Command Handler + Subscriber + Deps）────────────────────
export {
  ECONOMY_MODULE_ID,
  handleCreateEconomyAccount,
  handleTransferCurrency,
  handleGrantCurrency,
  handleRemoveCurrency,
  onMarketPressureChanged,
  onCharacterReputationChanged,
  onPlayerAffinityChanged,
  systemAccountOwner,
} from './system';
export type {
  EconomyHandlerContext,
  EconomyHandlerResult,
  EconomyIdAllocator,
  EconomyRewardResolverPort,
  RewardAmountResolverInput,
} from './system';

// ── ModuleContract 宣告（doc §9 交接清單對照）─────────────────────────────────
// 事件綁定與執行順序由 Composition Manifest 唯一擁有；此處只宣告本模組可提供的 Handler。
//
// handlesGameCommands 為空是**正確**的，不是遺漏：Economy 沒有玩家入口。購買（buyShopOffer）、
// 販售（sellItemToShop）的入口在 city／Workflow，Economy 只在該交易內收 Internal Command
// （doc §7.1／§7.2）。任何「UI 直接發 GrantCurrency」都被這一點擋住（doc §5.1 末）。
//
// sendsInternalCommands 為空同理：Economy 是終端的記帳模組，只回事實（Domain Event），
// 不指使別的模組做事。地牢均分／餘數順序、繼承對象等編排都在 distribution／Workflow。
export const economyModuleContract: ModuleContract = {
  id: 'economy' as ModuleId<'economy'>,
  owns: 'economy' as StateSliceName,
  reads: [
    'reader:economy-definition' as ReaderPortId,
    // 價格來源（city 的 ShopOffer／item 的 intrinsicValue／服務定義）與兩個跨模組事實。
    'reader:economy-price-source' as ReaderPortId,
    'reader:progression-social-mastery-benefits' as ReaderPortId,
    'reader:social-home-tutor-price-modifier' as ReaderPortId,
  ],
  handlesGameCommands: [],
  handlesInternalCommands: [
    'TransferCurrency',
    'GrantCurrency',
    'RemoveCurrency',
    'CreateEconomyAccount',
  ],
  handlesJobs: [],
  sendsInternalCommands: [],
  subscriptionHandlerIds: [
    'subscription.MarketPressureChanged.economy' as EventSubscriptionId,
    'subscription.CharacterReputationChanged.economy' as EventSubscriptionId,
    'subscription.PlayerAffinityChanged.economy' as EventSubscriptionId,
  ],
  emits: ['CurrencyTransferred', 'EconomyAccountCreated', 'PriceQuoteInvalidated'],
  invariants: [
    'economy.amountsAreSmallestUnitIntegers' as InvariantId,
    'economy.balanceNeverNegative' as InvariantId,
    'economy.transferIdAppliedOnce' as InvariantId,
    'economy.transferCurrencyMatchesBothAccounts' as InvariantId,
    'economy.noTeamAccount' as InvariantId,
    'economy.quoteDeterministicForSameInput' as InvariantId,
    'economy.quoteBindsSourceRevisionAndEpochs' as InvariantId,
  ],
};

// ── Fixtures／Tests 不由 public.ts 對外 ───────────────────────────────────────
// public.ts 是模組的**正式對外面**。從這裡再匯出 fixtures 或 test runner，等於讓正式依賴圖
// 可以走到測試資料——規範 §13 的判準是「只要正式程式**可以**引用就算違反」，不需要真的用到。
// 測試請直接 import './fixtures' 與 './economy.test'。門禁：scripts/verify-runtime-discipline.ts
