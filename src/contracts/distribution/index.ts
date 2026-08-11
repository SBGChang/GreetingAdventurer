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

// B.5 慣例：外送 Internal Command 一律引用**接收模組**契約的真實型別，不在此重宣告 placeholder
// （原本各自宣告的 shape 與擁有者對不上，跨模組接線時會錯誤縮窄或被迫轉型）。
import type { CreateEconomyAccountCommand, GrantCurrencyCommand, TransferCurrencyCommand } from '../economy';
import type { TransferItem, RemoveItemInstance } from '../inventory';
// PlayerInteractionOpened 事件由 team 擁有（單一聯集，三個模組共發）。
import type { PlayerInteractionOpenedEvent } from '../team';

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

// §7.4 Expired Quest Cargo 的 `ReleaseExpiredQuestCargo` 由 **inventory** 處理（quest workflow 送出，
// 將仍鎖定的任務物移入指定 assetDistributionEscrow；見 00_shared_contracts §5.4 表、10_quest §301、
// 05_inventory §370）。distribution 不是此命令的 handler，故不在此宣告/接收。
export type AssetDistributionInboundInternalCommand =
  | StartAssetDistributionCommand
  | AppendAssetDistributionResultCommand
  | FinalizeAssetDistributionCollectionCommand;

// ── 5.3 輸出 Internal Command（handler 屬 economy／inventory）──
// 一律引用**接收模組**的真實命令型別（見檔首 import）；不再宣告 placeholder。distribution 的
// handler（實作時）負責填齊接收端要求的完整欄位（economy 的 transferId/rewardRuleId/sourceId、
// inventory 的 to: ItemLocation / reason 等）。
export type AssetDistributionOutboundInternalCommand =
  | CreateEconomyAccountCommand // economy
  | GrantCurrencyCommand // economy
  | TransferCurrencyCommand // economy
  | TransferItem // inventory
  | RemoveItemInstance; // inventory

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

// PlayerInteractionOpened 由 team 擁有（見檔首 import）；distribution 以 kind: 'lootAuction' 發此事件。

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
