// modules/economy/state.ts
// Economy 唯一可寫 Slice 的初始工廠與純函式讀寫小工具。
// Slice 型別權威在 contracts/economy；此處不重新定義，只 re-export + 提供 immutable helper。
//
// 設計原則：
//   * 全部為決定性純函式；不 mutate 傳入 Slice，一律回傳新物件。
//   * 這個檔案裡沒有任何金額、稅率、匯率或倍率。價格與獎勵金額全部由 Definition／Resolver 提供
//     （見 system.ts 的 EconomyRewardResolverPort 與 queries.ts 的 EconomyPriceModifierResolverPort）。
//   * 帳戶餘額為「最小貨幣單位的非負整數」——那是 doc §8.1／§8.2 的結構不變量，寫在程式裡；
//     但**起始餘額**是內容：新帳戶一律以空帳戶（加法單位元）建立，任何初始資金都必須另外走
//     GrantCurrency + RewardRuleDefinition，才能換一份 Content Pack 就改變開局現金。

import type {
  CharacterId,
  CityId,
  CurrencyId,
  AssetDistributionId,
  EconomyAccountId,
  EconomyTransferId,
  Revision,
} from '../../contracts/core';
import type { MarketScope } from '../../contracts/world';
import type {
  EconomyState,
  EconomyAccount,
  EconomyAccountOwner,
  EconomyTransferRecord,
  PriceScopeKey,
} from '../../contracts/economy';

export type { EconomyState };

// 空 Slice（新世界或測試起點）。
export const emptyEconomyState: EconomyState = Object.freeze({
  accounts: Object.freeze({}),
  transfers: Object.freeze({}),
  pricingEpochs: Object.freeze({}),
}) as EconomyState;

// 由既有實體集合建構 Slice（fixture／存檔載入）。
export function createEconomyState(
  input: Readonly<{
    accounts?: readonly EconomyAccount[];
    transfers?: readonly EconomyTransferRecord[];
    pricingEpochs?: Readonly<Record<PriceScopeKey, Revision>>;
  }> = {},
): EconomyState {
  const accounts: Record<EconomyAccountId, EconomyAccount> = {};
  for (const account of input.accounts ?? []) accounts[account.accountId] = account;

  const transfers: Record<EconomyTransferId, EconomyTransferRecord> = {};
  for (const transfer of input.transfers ?? []) transfers[transfer.transferId] = transfer;

  const pricingEpochs: Record<PriceScopeKey, Revision> = { ...input.pricingEpochs };

  return { accounts, transfers, pricingEpochs };
}

// ── Owner（判別聯集，不是裸字串）─────────────────────────────────────────────

// 擁有者的比較鍵。判別聯集的每個變體有不同的識別欄位，所以「同一個擁有者」不能用裸字串比對——
// 這個函式是**唯一**的序列化點，新增 owner kind 時 tsc 會在此逼出對應分支。
export function economyOwnerKey(owner: EconomyAccountOwner): string {
  switch (owner.kind) {
    case 'character':
      return `character:${String(owner.characterId)}`;
    case 'city':
      return `city:${String(owner.cityId)}`;
    case 'assetDistribution':
      return `assetDistribution:${String(owner.distributionId)}`;
    case 'system':
      return `system:${owner.purpose}`;
  }
}

export function sameEconomyOwner(a: EconomyAccountOwner, b: EconomyAccountOwner): boolean {
  return economyOwnerKey(a) === economyOwnerKey(b);
}

// ── Account 純函式讀寫 ───────────────────────────────────────────────────────

export function tryGetAccount(
  state: EconomyState,
  accountId: EconomyAccountId,
): EconomyAccount | undefined {
  return state.accounts[accountId];
}

export function requireAccount(state: EconomyState, accountId: EconomyAccountId): EconomyAccount {
  const found = state.accounts[accountId];
  if (found === undefined) {
    throw new Error(`EconomyState: unknown accountId "${String(accountId)}"`);
  }
  return found;
}

export function upsertAccount(state: EconomyState, next: EconomyAccount): EconomyState {
  return {
    ...state,
    accounts: { ...state.accounts, [next.accountId]: next },
  };
}

// （owner, currency）唯一定位一個帳戶（doc §3.1：每名真實角色各自持有個人帳戶）。
// 掃描順序即 Record 插入順序，決定性；Slice 不另存索引，避免 State Schema 多一份可能不同步的真相。
export function findAccountIdByOwner(
  state: EconomyState,
  owner: EconomyAccountOwner,
  currencyId: CurrencyId,
): EconomyAccountId | undefined {
  const wanted = economyOwnerKey(owner);
  for (const account of Object.values(state.accounts)) {
    if (account.currencyId !== currencyId) continue;
    if (economyOwnerKey(account.owner) === wanted) return account.accountId;
  }
  return undefined;
}

export function findCharacterAccountId(
  state: EconomyState,
  characterId: CharacterId,
  currencyId: CurrencyId,
): EconomyAccountId | undefined {
  return findAccountIdByOwner(state, { kind: 'character', characterId }, currencyId);
}

export function findAssetDistributionAccountId(
  state: EconomyState,
  distributionId: AssetDistributionId,
  currencyId: CurrencyId,
): EconomyAccountId | undefined {
  return findAccountIdByOwner(state, { kind: 'assetDistribution', distributionId }, currencyId);
}

// 新帳戶：空帳戶。餘額起點是加法單位元，不是「預設現金」——初始資金走 GrantCurrency + RewardRule。
export function createEmptyAccount(
  accountId: EconomyAccountId,
  owner: EconomyAccountOwner,
  currencyId: CurrencyId,
): EconomyAccount {
  return { accountId, owner, currencyId, balance: 0, revision: 0 as Revision };
}

// 餘額增減。**不夾限**：餘額不得為負是結構不變量，越界代表呼叫端沒先驗過，必須由 Handler 以
// typed rejection 擋在前面（見 system.ts 的 insufficient-balance）。在這裡夾到 0 會把「錢不夠」
// 悄悄變成「付了一部分」。
export function withBalanceDelta(account: EconomyAccount, delta: number): EconomyAccount {
  const next = account.balance + delta;
  if (!Number.isSafeInteger(next)) {
    throw new Error(`EconomyState: balance must stay a safe integer (account "${String(account.accountId)}")`);
  }
  if (next < 0) {
    throw new Error(`EconomyState: balance must not go below zero (account "${String(account.accountId)}")`);
  }
  return { ...account, balance: next, revision: (account.revision + 1) as Revision };
}

// ── Transfer 帳本 ────────────────────────────────────────────────────────────

export function tryGetTransfer(
  state: EconomyState,
  transferId: EconomyTransferId,
): EconomyTransferRecord | undefined {
  return state.transfers[transferId];
}

export function recordTransfer(state: EconomyState, record: EconomyTransferRecord): EconomyState {
  return {
    ...state,
    transfers: { ...state.transfers, [record.transferId]: record },
  };
}

// ── Pricing Epoch ────────────────────────────────────────────────────────────

// 報價 scope。`pricingEpochs` 的 key 是這個聯集的序列化結果（契約：「某城市／地區／角色相關報價
// scope 的序列化鍵」），所以 scope 的形狀與 key 的產生都由 Economy 擁有。
//   * market            ← world 的 MarketPressureChanged（引用 world 契約的真實 MarketScope）
//   * characterReputation ← character 的 CharacterReputationChanged
//   * adventurerAffinity  ← social 的 PlayerAffinityChanged（只影響該冒險者作為家教提供者的報價）
export type PriceScope =
  | Readonly<{ kind: 'market'; market: MarketScope }>
  | Readonly<{ kind: 'characterReputation'; characterId: CharacterId }>
  | Readonly<{ kind: 'adventurerAffinity'; adventurerId: CharacterId }>;

export function priceScopeKeyFor(scope: PriceScope): PriceScopeKey {
  switch (scope.kind) {
    case 'market':
      return `market:${scope.market.kind}:${String(scope.market.id)}` as PriceScopeKey;
    case 'characterReputation':
      return `characterReputation:${String(scope.characterId)}` as PriceScopeKey;
    case 'adventurerAffinity':
      return `adventurerAffinity:${String(scope.adventurerId)}` as PriceScopeKey;
  }
}

export function citySettlementScope(cityId: CityId): PriceScope {
  return { kind: 'market', market: { kind: 'city', id: cityId } };
}

// 尚未失效過的 scope 沒有 entry。這裡不是「缺資料給預設」——Revision 的起點就是 0，
// 「從未失效」與「失效過 0 次」是同一件事。
export function epochOf(state: EconomyState, key: PriceScopeKey): Revision {
  const found = state.pricingEpochs[key];
  return found === undefined ? (0 as Revision) : found;
}

export function bumpEpoch(state: EconomyState, key: PriceScopeKey): EconomyState {
  return {
    ...state,
    pricingEpochs: { ...state.pricingEpochs, [key]: (epochOf(state, key) + 1) as Revision },
  };
}

// Quote 綁定的 epoch 快照：只含該 Quote 真正依賴的 scope，成交前逐鍵重新比對。
export function epochSnapshotFor(
  state: EconomyState,
  scopes: readonly PriceScope[],
): Record<PriceScopeKey, Revision> {
  const snapshot: Record<PriceScopeKey, Revision> = {};
  for (const scope of scopes) {
    const key = priceScopeKeyFor(scope);
    snapshot[key] = epochOf(state, key);
  }
  return snapshot;
}
