// modules/distribution/queries.ts
// AssetDistributionQuery 在 Slice 上的純函式實作（doc §4）。
//
// 註：View 是 Runtime State 的投影，**不含** rngContext 與 settlementAccountIds——前者是決定論內部
// 狀態，後者是 economy 的帳戶身分；Query 公開它們只會讓 UI／其他模組據以行動。
// getPendingPlayerDistribution 讓 UI 知道「現在等哪個角色出價」（doc §5.1 的 Pending Interaction）。

import type { AssetDistributionId, TeamId } from '../../contracts/core';
import type {
  AssetDistribution,
  AssetDistributionQuery,
  AssetDistributionView,
  LootAuctionRoundView,
  LootBidView,
  PendingAssetDistributionInteractionView,
  PlayerAssetDistributionView,
} from '../../contracts/distribution';
import type { AssetDistributionModuleState } from './state';
import { currentAuctionRound, listDistributionIds, requireDistribution, tryGetDistribution } from './state';

function bidView(bid: Readonly<LootBidView>): LootBidView {
  return {
    bidderCharacterId: bid.bidderCharacterId,
    amount: bid.amount,
    source: bid.source,
  };
}

function roundView(round: Readonly<LootAuctionRoundView>): LootAuctionRoundView {
  return {
    itemId: round.itemId,
    intrinsicValue: round.intrinsicValue,
    bids: round.bids.map(bidView),
    state: round.state,
    ...(round.winnerCharacterId === undefined ? {} : { winnerCharacterId: round.winnerCharacterId }),
    ...(round.winningBid === undefined ? {} : { winningBid: round.winningBid }),
  };
}

function pendingView(
  pending: Readonly<PendingAssetDistributionInteractionView>,
): PendingAssetDistributionInteractionView {
  return {
    interactionId: pending.interactionId,
    kind: pending.kind,
    itemId: pending.itemId,
    openedOnDay: pending.openedOnDay,
    revision: pending.revision,
  };
}

function distributionView(distribution: AssetDistribution): AssetDistributionView {
  return {
    distributionId: distribution.distributionId,
    source: distribution.source,
    teamId: distribution.teamId,
    participantCharacterIds: [...distribution.participantCharacterIds],
    ruleId: distribution.ruleId,
    itemIds: [...distribution.itemIds],
    currencyInputs: distribution.currencyInputs.map((m) => ({ ...m })),
    currentItemIndex: distribution.currentItemIndex,
    status: distribution.status,
    ...(distribution.pendingInteraction === undefined
      ? {}
      : { pendingInteraction: pendingView(distribution.pendingInteraction) }),
    revision: distribution.revision,
  };
}

function playerView(distribution: AssetDistribution): PlayerAssetDistributionView {
  const round = currentAuctionRound(distribution);
  return {
    distributionId: distribution.distributionId,
    teamId: distribution.teamId,
    participantCharacterIds: [...distribution.participantCharacterIds],
    ...(round === undefined ? {} : { currentRound: roundView(round) }),
    ...(distribution.pendingInteraction === undefined
      ? {}
      : { pendingInteraction: pendingView(distribution.pendingInteraction) }),
    status: distribution.status,
  };
}

export function createAssetDistributionQuery(
  state: AssetDistributionModuleState,
): AssetDistributionQuery {
  return {
    getDistribution(id: AssetDistributionId): AssetDistributionView {
      return distributionView(requireDistribution(state, id));
    },

    // 一支隊伍同時只該有一筆等待玩家出價的分配（doc §5.1：未完成前不能返城／旅行／招募）。
    // 若真的出現多筆，依 distributionId 字典序取第一筆——順序必須是決定性的，不能靠 Record 鍵序。
    getPendingPlayerDistribution(teamId: TeamId): PlayerAssetDistributionView | undefined {
      for (const id of listDistributionIds(state)) {
        const distribution = state.distributions[id];
        if (distribution === undefined) continue;
        if (distribution.teamId !== teamId) continue;
        if (distribution.status !== 'awaitingPlayerBid') continue;
        return playerView(distribution);
      }
      return undefined;
    },

    getCurrentAuctionRound(id: AssetDistributionId): LootAuctionRoundView | undefined {
      const distribution = tryGetDistribution(state, id);
      if (distribution === undefined) return undefined;
      const round = currentAuctionRound(distribution);
      return round === undefined ? undefined : roundView(round);
    },
  };
}

// 「這筆分配還在等玩家」的單點判斷（Router／Workflow 要擋返城與快轉時用）。
export function isAwaitingPlayerBid(
  state: AssetDistributionModuleState,
  id: AssetDistributionId,
): boolean {
  return tryGetDistribution(state, id)?.status === 'awaitingPlayerBid';
}
