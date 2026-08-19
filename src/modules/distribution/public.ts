// modules/distribution/public.ts
// Asset Distribution 模組對外唯一入口：re-export 執行期 API + 公開契約 + ModuleContract 宣告。
// Composition 只從這裡取得工廠、Handler、Query 與 ModuleContract；不得深入 import 內部檔案。

import type {
  ModuleContract,
  ModuleId,
  StateSliceName,
  ReaderPortId,
  InvariantId,
} from '../../contracts/core';

// 公開契約（型別）——原樣轉出，讓消費者只從模組入口取用。
export type * from '../../contracts/distribution';

// ── State ─────────────────────────────────────────────────────────────────––
export {
  emptyAssetDistributionState,
  createInitialAssetDistributionState,
  createAssetDistributionState,
  tryGetDistribution,
  requireDistribution,
  upsertDistribution,
  listDistributionIds,
  currentAuctionRound,
  currentItemId,
  hasSettledItem,
  isParticipant,
  bidTieBreakKey,
  remainderRotationOrder,
} from './state';
export type { AssetDistributionModuleState } from './state';

// ── Query ─────────────────────────────────────────────────────────────────––
export { createAssetDistributionQuery, isAwaitingPlayerBid } from './queries';

// ── System（Game Command + Internal Command Handler + Deps）─────────────────
export {
  DISTRIBUTION_MODULE_ID,
  // Game Command handlers（doc §5.1）
  handleSubmitLootBid,
  handlePassLootItem,
  handleResolveLootAuctionRound,
  // Internal Command handlers（doc §5.2）
  handleStartAssetDistribution,
  handleAppendAssetDistributionResult,
  handleFinalizeAssetDistributionCollection,
} from './system';
export type {
  AssetDistributionHandlerContext,
  AssetDistributionHandlerResult,
  AssetDistributionIdAllocator,
  DistributionEconomyQuery,
  DistributionInventoryQuery,
  DistributionTeamQuery,
  DistributionResolverPort,
  CompanionBidDecision,
  EconomySystemAccountPurpose,
} from './system';

// ── ModuleContract 宣告（doc §9 交接清單對照）─────────────────────────────────
// 事件綁定與執行順序由 Composition Manifest 唯一擁有；此處只宣告本模組可提供的 Handler。
export const distributionModuleContract: ModuleContract = {
  id: 'distribution' as ModuleId<'distribution'>,
  owns: 'distribution' as StateSliceName,
  reads: [
    'reader:distribution-definition' as ReaderPortId,
    'reader:economy-query' as ReaderPortId,
    'reader:inventory-query' as ReaderPortId,
    'reader:team-query' as ReaderPortId,
  ],
  handlesGameCommands: ['submitLootBid', 'passLootItem', 'resolveLootAuctionRound'],
  handlesInternalCommands: [
    'StartAssetDistribution',
    'AppendAssetDistributionResult',
    'FinalizeAssetDistributionCollection',
  ],
  handlesJobs: [],
  sendsInternalCommands: [
    'CreateEconomyAccount',
    'TransferCurrency',
    'TransferItem',
    'RemoveItemInstance',
  ],
  // 本模組不訂閱任何事件：清算帳戶 ID 走 economy Query Port 解析（同一交易內也讀得到），
  // 不需要靠 EconomyAccountCreated 回填。
  subscriptionHandlerIds: [],
  emits: [
    'AssetDistributionStarted',
    'AssetDistributionResultAppended',
    'LootAuctionRoundOpened',
    'PlayerInteractionOpened',
    'LootItemAwarded',
    'LootItemDirectSold',
    'AssetDistributionCompleted',
  ],
  invariants: [
    'distribution.participantSnapshotNonEmpty' as InvariantId,
    'distribution.itemSettledAtMostOnce' as InvariantId,
    'distribution.awaitingPlayerBidHasExactlyOnePendingInteraction' as InvariantId,
    'distribution.escrowEmptyOnCompletion' as InvariantId,
    'distribution.deterministicTieBreakAndRemainder' as InvariantId,
    'distribution.awardsOnlyToCharacters' as InvariantId,
  ],
};

// ── Fixtures／Tests 不由 public.ts 對外 ───────────────────────────────────────
// public.ts 是模組的**正式對外面**。從這裡再匯出 fixtures 或 test runner，等於讓正式依賴圖
// 可以走到測試資料——規範 §13 的判準是「只要正式程式**可以**引用就算違反」。
// 測試請直接 import './fixtures' 與 './distribution.test'。
