// modules/distribution/state.ts
// Asset Distribution 唯一可寫 Slice 的初始工廠與純函式讀寫 helper。
// Slice 型別權威在 contracts/distribution；此處不重新定義，只 re-export + 提供 immutable helper。
//
// 設計原則：
//   * 全部為決定性純函式；不 mutate 傳入 Slice，一律回傳新物件。
//   * 兩份模組私有帳本（見 AssetDistributionModuleState）住在這裡而不是契約，理由同
//     progression 的 ProgressionModuleState：它們是「這件事已經做過了」的紀錄，不是公開投影。

import type {
  AssetDistributionId,
  CharacterId,
  CurrencyId,
  ItemInstanceId,
  Revision,
} from '../../contracts/core';
import type {
  AssetDistributionState,
  AssetDistribution,
  LootAuctionRound,
  LootBid,
} from '../../contracts/distribution';

export type { AssetDistributionState };

// AppendAssetDistributionResult 的冪等鍵（doc §5.2：sourceResultId／sourceGatheringResolutionId
// 供「採集整筆結果冪等與追蹤」）。key = `${distributionId}|${sourceKey}`。
export type AppendedResultKey = string;

// 已對 economy 送出過 CreateEconomyAccount 的 (distribution, currency) 組合。
// CreateEconomyAccountCommand 沒有冪等鍵，重送會產生第二個清算帳戶，故由本模組記帳避免重送。
export type SettlementAccountRequestKey = string;

export type AssetDistributionModuleState = AssetDistributionState &
  Readonly<{
    appliedResultKeys: Readonly<Record<AppendedResultKey, true>>;
    requestedSettlementCurrencies: Readonly<Record<SettlementAccountRequestKey, true>>;
  }>;

// 空 Slice（新世界或測試起點）。
export const emptyAssetDistributionState: AssetDistributionModuleState = Object.freeze({
  distributions: Object.freeze({}),
  appliedResultKeys: Object.freeze({}),
  requestedSettlementCurrencies: Object.freeze({}),
}) as AssetDistributionModuleState;

export function createInitialAssetDistributionState(): AssetDistributionModuleState {
  return { distributions: {}, appliedResultKeys: {}, requestedSettlementCurrencies: {} };
}

// 由既有實體集合建構 Slice（fixture／存檔載入）。
export function createAssetDistributionState(
  input: Readonly<{
    distributions?: readonly AssetDistribution[];
    appliedResultKeys?: readonly AppendedResultKey[];
    requestedSettlementCurrencies?: readonly SettlementAccountRequestKey[];
  }> = {},
): AssetDistributionModuleState {
  const distributions: Record<AssetDistributionId, AssetDistribution> = {};
  for (const d of input.distributions ?? []) distributions[d.distributionId] = d;

  const appliedResultKeys: Record<AppendedResultKey, true> = {};
  for (const k of input.appliedResultKeys ?? []) appliedResultKeys[k] = true;

  const requestedSettlementCurrencies: Record<SettlementAccountRequestKey, true> = {};
  for (const k of input.requestedSettlementCurrencies ?? []) requestedSettlementCurrencies[k] = true;

  return { distributions, appliedResultKeys, requestedSettlementCurrencies };
}

// ── Distribution 純函式讀寫 ──────────────────────────────────────────────────

export function tryGetDistribution(
  state: AssetDistributionModuleState,
  id: AssetDistributionId,
): AssetDistribution | undefined {
  return state.distributions[id];
}

export function requireDistribution(
  state: AssetDistributionModuleState,
  id: AssetDistributionId,
): AssetDistribution {
  const found = state.distributions[id];
  if (found === undefined) {
    throw new Error(`AssetDistributionState: unknown distributionId "${String(id)}"`);
  }
  return found;
}

export function upsertDistribution(
  state: AssetDistributionModuleState,
  next: AssetDistribution,
): AssetDistributionModuleState {
  return {
    ...state,
    distributions: { ...state.distributions, [next.distributionId]: next },
  };
}

// 依 distributionId 字典序列舉：Record 的鍵順序在存讀檔往返後不保證，Query 要決定性就得自己排序。
export function listDistributionIds(
  state: AssetDistributionModuleState,
): readonly AssetDistributionId[] {
  return (Object.keys(state.distributions) as AssetDistributionId[]).sort((a, b) =>
    String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0,
  );
}

// ── 冪等帳本 ────────────────────────────────────────────────────────────────

export function appendedResultKey(
  distributionId: AssetDistributionId,
  sourceKey: string,
): AppendedResultKey {
  return `${String(distributionId)}|${sourceKey}`;
}

export function isResultApplied(
  state: AssetDistributionModuleState,
  key: AppendedResultKey,
): boolean {
  return state.appliedResultKeys[key] === true;
}

export function markResultApplied(
  state: AssetDistributionModuleState,
  key: AppendedResultKey,
): AssetDistributionModuleState {
  return { ...state, appliedResultKeys: { ...state.appliedResultKeys, [key]: true } };
}

export function settlementAccountRequestKey(
  distributionId: AssetDistributionId,
  currencyId: CurrencyId,
): SettlementAccountRequestKey {
  return `${String(distributionId)}|${String(currencyId)}`;
}

export function isSettlementAccountRequested(
  state: AssetDistributionModuleState,
  key: SettlementAccountRequestKey,
): boolean {
  return state.requestedSettlementCurrencies[key] === true;
}

export function markSettlementAccountRequested(
  state: AssetDistributionModuleState,
  key: SettlementAccountRequestKey,
): AssetDistributionModuleState {
  return {
    ...state,
    requestedSettlementCurrencies: { ...state.requestedSettlementCurrencies, [key]: true },
  };
}

// ── 分配內部的純結構 helper ─────────────────────────────────────────────────

export function bumpRevision(revision: Revision): Revision {
  return (revision + 1) as Revision;
}

// auctionRounds[i] 對應 itemIds[i]；currentItemIndex 指向「正在處置」的那一件。
export function currentAuctionRound(
  distribution: AssetDistribution,
): LootAuctionRound | undefined {
  return distribution.auctionRounds[distribution.currentItemIndex];
}

export function currentItemId(distribution: AssetDistribution): ItemInstanceId | undefined {
  return distribution.itemIds[distribution.currentItemIndex];
}

export function hasSettledItem(
  distribution: AssetDistribution,
  itemId: ItemInstanceId,
): boolean {
  return distribution.auctionRounds.some((r) => r.itemId === itemId && r.state !== 'open');
}

export function isParticipant(
  distribution: AssetDistribution,
  characterId: CharacterId,
): boolean {
  return distribution.participantCharacterIds.includes(characterId);
}

// 同額最高 Bid 的固定排序鍵（doc §7.1：distributionId + itemId + characterId，不重骰）。
export function bidTieBreakKey(
  distributionId: AssetDistributionId,
  itemId: ItemInstanceId,
  characterId: CharacterId,
): string {
  return `${String(distributionId)}|${String(itemId)}|${String(characterId)}`;
}

// 餘數輪替順序（doc §7.3 remainderPolicy: deterministicRotation）：由 distributionId 與 characterId
// 導出的固定字典序。不用雜湊也不用 RNG——存讀檔／快轉重播必得同一順序。
export function remainderRotationOrder(
  distribution: AssetDistribution,
): readonly CharacterId[] {
  return [...distribution.participantCharacterIds].sort((a, b) => {
    const ka = `${String(distribution.distributionId)}|${String(a)}`;
    const kb = `${String(distribution.distributionId)}|${String(b)}`;
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
}

// 取代／新增某角色本回合的出價（同一角色同回合只留一筆；提高出價即覆蓋）。
export function withBid(round: LootAuctionRound, bid: LootBid): LootAuctionRound {
  const others = round.bids.filter((b) => b.bidderCharacterId !== bid.bidderCharacterId);
  return { ...round, bids: [...others, bid] };
}

export function withoutBid(
  round: LootAuctionRound,
  bidderCharacterId: CharacterId,
  source: LootBid['source'],
): LootAuctionRound {
  return {
    ...round,
    bids: round.bids.filter(
      (b) => !(b.bidderCharacterId === bidderCharacterId && b.source === source),
    ),
  };
}

export function withRoundAt(
  distribution: AssetDistribution,
  index: number,
  round: LootAuctionRound,
): LootAuctionRound[] {
  const next = [...distribution.auctionRounds];
  next[index] = round;
  return next;
}
