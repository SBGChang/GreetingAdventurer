// contracts/distribution — public contract transcribed from docs/00_core/architecture/17_asset_distribution.md

import type {
  DefinitionHeader,
  DefinitionId,
  RuntimeId,
  WorldDay,
  Revision,
  RngContext,
  ResolverId,
  AssetDistributionId,
  QuestId,
  MapInstanceId,
  NpcDungeonRunId,
  TeamId,
  CharacterId,
  ItemInstanceId,
  CurrencyId,
  EconomyAccountId,
  GatheringResolutionId,
  InteractionId,
} from '../core';

// ── Invented placeholders：core 未定義的 ID／值型別 ──
export type AssetDistributionRuleId = DefinitionId<'asset-distribution-rule'>;
export type AssetDistributionSourceResultId = RuntimeId<'asset-distribution-source-result'>;

// economy 模組擁有的貨幣值（invented 最小形狀）
export type MoneyValue = Readonly<{
  currencyId: CurrencyId;
  amount: number;
}>;

// ── 來源（runtime state 與 event payload 共用） ──────────────────────────
export type AssetDistributionSource =
  | Readonly<{ kind: 'questReward'; questId: QuestId }>
  | Readonly<{ kind: 'dungeonLoot'; mapId: MapInstanceId; runId?: NpcDungeonRunId }>
  | Readonly<{ kind: 'expiredQuestCargo'; questId: QuestId }>;

// ── 2. 資料契約 ─────────────────────────────────────────────────────────

export type AssetDistributionRuleDefinition = DefinitionHeader<AssetDistributionRuleId> &
  Readonly<{
    sourceKind: 'questReward' | 'dungeonLoot' | 'expiredQuestCargo';
    controllerPolicy: 'playerAuction' | 'npcRng' | 'equalCurrencyOnly';
    currencyPolicy: 'equalSplit';
    itemPolicy: 'internalAuction' | 'rngPerItem' | 'none';
    auction?: Readonly<{
      minimumBid: 'intrinsicValue';
      unclaimedSaleMultiplier: 0.8;
      companionBidResolverId: ResolverId;
      tieBreakPolicy: 'deterministicFromDistributionId';
    }>;
    npcItemRecipientResolverId?: ResolverId;
    remainderPolicy: 'deterministicRotation';
  }>;

export interface AssetDistributionDefinitionReader {
  getRule(id: AssetDistributionRuleId): AssetDistributionRuleDefinition;
}

// ── 1./3. State 與 Runtime State（doc §1、§3） ───────────────────────────
export type AssetDistributionState = {
  distributions: Record<AssetDistributionId, AssetDistribution>;
};

export type AssetDistribution = {
  distributionId: AssetDistributionId;
  source: AssetDistributionSource;
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

export type LootAuctionRound = {
  itemId: ItemInstanceId;
  intrinsicValue: MoneyValue;
  bids: LootBid[];
  state: 'open' | 'awarded' | 'directSold';
  winnerCharacterId?: CharacterId;
  winningBid?: number;
};

export type LootBid = {
  bidderCharacterId: CharacterId;
  amount: number;
  source: 'player' | 'companionResolver';
};

export type PendingAssetDistributionInteraction = {
  interactionId: InteractionId;
  kind: 'lootAuction';
  itemId: ItemInstanceId;
  openedOnDay: WorldDay;
  revision: Revision;
};

// ── 4. 公開 Query 與 View（derived: 由 Runtime State block 投影） ─────────

export type LootBidView = Readonly<{
  bidderCharacterId: CharacterId;
  amount: number;
  source: 'player' | 'companionResolver';
}>;

export type LootAuctionRoundView = Readonly<{
  itemId: ItemInstanceId;
  intrinsicValue: MoneyValue;
  bids: readonly LootBidView[];
  state: 'open' | 'awarded' | 'directSold';
  winnerCharacterId?: CharacterId;
  winningBid?: number;
}>;

export type PendingAssetDistributionInteractionView = Readonly<{
  interactionId: InteractionId;
  kind: 'lootAuction';
  itemId: ItemInstanceId;
  openedOnDay: WorldDay;
  revision: Revision;
}>;

export type AssetDistributionView = Readonly<{
  distributionId: AssetDistributionId;
  source: AssetDistributionSource;
  teamId: TeamId;
  participantCharacterIds: readonly CharacterId[];
  ruleId: AssetDistributionRuleId;
  itemIds: readonly ItemInstanceId[];
  currencyInputs: readonly MoneyValue[];
  currentItemIndex: number;
  status: 'collecting' | 'awaitingPlayerBid' | 'settling' | 'completed' | 'invalid';
  pendingInteraction?: PendingAssetDistributionInteractionView;
  revision: Revision;
}>;

export type PlayerAssetDistributionView = Readonly<{
  distributionId: AssetDistributionId;
  teamId: TeamId;
  participantCharacterIds: readonly CharacterId[];
  currentRound?: LootAuctionRoundView;
  pendingInteraction?: PendingAssetDistributionInteractionView;
  status: 'collecting' | 'awaitingPlayerBid' | 'settling' | 'completed' | 'invalid';
}>;

export interface AssetDistributionQuery {
  getDistribution(id: AssetDistributionId): AssetDistributionView;
  getPendingPlayerDistribution(teamId: TeamId): PlayerAssetDistributionView | undefined;
  getCurrentAuctionRound(id: AssetDistributionId): LootAuctionRoundView | undefined;
}

// ── 5.1 玩家 Command payloads ────────────────────────────────────────────

export type SubmitLootBidCommand = Readonly<{
  type: 'submitLootBid';
  distributionId: AssetDistributionId;
  bidderCharacterId: CharacterId;
  itemId: ItemInstanceId;
  amount: number;
}>;

export type PassLootItemCommand = Readonly<{
  type: 'passLootItem';
  distributionId: AssetDistributionId;
  bidderCharacterId: CharacterId;
  itemId: ItemInstanceId;
}>;

export type ResolveLootAuctionRoundCommand = Readonly<{
  type: 'resolveLootAuctionRound';
  distributionId: AssetDistributionId;
  itemId: ItemInstanceId;
}>;

export type AssetDistributionGameCommand =
  | SubmitLootBidCommand
  | PassLootItemCommand
  | ResolveLootAuctionRoundCommand;

// ── 5.2 收到的 Internal Command payloads（Distribution 為 Handler） ────────

export type StartAssetDistributionCommand = Readonly<{
  type: 'StartAssetDistribution';
  distributionId: AssetDistributionId;
  source: AssetDistributionSource;
  teamId: TeamId;
  participantCharacterIds: readonly CharacterId[];
  ruleId: AssetDistributionRuleId;
}>;

export type AppendAssetDistributionResultCommand = Readonly<{
  type: 'AppendAssetDistributionResult';
  distributionId: AssetDistributionId;
  itemIds: readonly ItemInstanceId[];
  currencyInputs: readonly MoneyValue[];
  sourceResultId?: AssetDistributionSourceResultId;
  sourceGatheringResolutionId?: GatheringResolutionId;
}>;

export type FinalizeAssetDistributionCollectionCommand = Readonly<{
  type: 'FinalizeAssetDistributionCollection';
  distributionId: AssetDistributionId;
}>;

// §7.4 Expired Quest Cargo：Quest 送出，將 Item 移入該筆 assetDistributionEscrow
export type ReleaseExpiredQuestCargoCommand = Readonly<{
  type: 'ReleaseExpiredQuestCargo';
  distributionId: AssetDistributionId;
}>;

export type AssetDistributionInboundInternalCommand =
  | StartAssetDistributionCommand
  | AppendAssetDistributionResultCommand
  | FinalizeAssetDistributionCollectionCommand
  | ReleaseExpiredQuestCargoCommand;

// ── 5.3 輸出 Internal Command payloads（handler 屬 economy／inventory；placeholder） ──

export type CreateEconomyAccountCommand = Readonly<{
  type: 'CreateEconomyAccount';
  owner: 'assetDistribution';
  distributionId: AssetDistributionId;
  currencyId: CurrencyId;
}>;

export type GrantCurrencyCommand = Readonly<{
  type: 'GrantCurrency';
  accountId: EconomyAccountId;
  amount: MoneyValue;
}>;

export type TransferCurrencyCommand = Readonly<{
  type: 'TransferCurrency';
  fromAccountId: EconomyAccountId;
  toAccountId: EconomyAccountId;
  amount: MoneyValue;
}>;

export type TransferItemCommand = Readonly<{
  type: 'TransferItem';
  itemId: ItemInstanceId;
  toCharacterId: CharacterId;
  location: 'characterBag';
}>;

export type RemoveItemInstanceCommand = Readonly<{
  type: 'RemoveItemInstance';
  itemId: ItemInstanceId;
}>;

export type AssetDistributionOutboundInternalCommand =
  | CreateEconomyAccountCommand
  | GrantCurrencyCommand
  | TransferCurrencyCommand
  | TransferItemCommand
  | RemoveItemInstanceCommand;

// ── 6. 輸出事件 payloads ─────────────────────────────────────────────────

// derived: AssetDistributionCompleted.itemAwards／currencyAwards 元素型別未在 doc 定義
export type LootItemAward = Readonly<{
  itemId: ItemInstanceId;
  winnerCharacterId: CharacterId;
  winningBid?: number;
}>;

export type CurrencyAward = Readonly<{
  characterId: CharacterId;
  amount: MoneyValue;
}>;

export type AssetDistributionStartedEvent = Readonly<{
  type: 'AssetDistributionStarted';
  distributionId: AssetDistributionId;
  source: AssetDistributionSource;
  participantCharacterIds: readonly CharacterId[];
}>;

export type AssetDistributionResultAppendedEvent = Readonly<{
  type: 'AssetDistributionResultAppended';
  distributionId: AssetDistributionId;
  itemIds: readonly ItemInstanceId[];
  currencyInputs: readonly MoneyValue[];
  sourceGatheringResolutionId?: GatheringResolutionId;
}>;

export type LootAuctionRoundOpenedEvent = Readonly<{
  type: 'LootAuctionRoundOpened';
  distributionId: AssetDistributionId;
  itemId: ItemInstanceId;
  intrinsicValue: MoneyValue;
}>;

export type PlayerInteractionOpenedEvent = Readonly<{
  type: 'PlayerInteractionOpened';
  interactionId: InteractionId;
  teamId: TeamId;
  kind: 'lootAuction';
}>;

export type LootItemAwardedEvent = Readonly<{
  type: 'LootItemAwarded';
  distributionId: AssetDistributionId;
  itemId: ItemInstanceId;
  winnerCharacterId: CharacterId;
  winningBid?: number;
}>;

export type LootItemDirectSoldEvent = Readonly<{
  type: 'LootItemDirectSold';
  distributionId: AssetDistributionId;
  itemId: ItemInstanceId;
  saleValue: MoneyValue;
}>;

export type AssetDistributionCompletedEvent = Readonly<{
  type: 'AssetDistributionCompleted';
  distributionId: AssetDistributionId;
  itemAwards: readonly LootItemAward[];
  currencyAwards: readonly CurrencyAward[];
}>;

export type AssetDistributionDomainEvent =
  | AssetDistributionStartedEvent
  | AssetDistributionResultAppendedEvent
  | LootAuctionRoundOpenedEvent
  | PlayerInteractionOpenedEvent
  | LootItemAwardedEvent
  | LootItemDirectSoldEvent
  | AssetDistributionCompletedEvent;
