// modules/economy/system.ts
// Economy 模組的純函式 Internal Command Handler 與 Domain Event Subscriber
// （對應 docs/00_core/architecture/08_economy_module.md §5–§6、§8）。
//
// 設計原則：
//   * 全部為決定性純函式：不做 I/O、不呼叫 Math.random / Date.now；世界日與交易 ID 由 ctx 取得。
//   * Internal Command Handler 簽章 (command, state, ctx) → EconomyHandlerResult：
//       - 接受：ModuleResult<EconomyState>（只含自己 Slice 的 nextSlice 與外送訊息）。
//       - 拒絕：具型別 CommandRejection。餘額不足、幣別不符、金額非法一律是拒絕，**不是**夾到 0。
//   * Event Subscriber 回 ModuleResult（已發生的事實不可拒絕）。
//
// 這個檔案裡沒有任何價格、稅率、匯率或獎勵金額：
//   * GrantCurrency 的金額來自 RewardRuleDefinition.resolverId → EconomyRewardResolverPort。
//   * 買賣價格完全不在 Handler 裡，在 queries.ts 的 Quote 產生器（同樣由 Resolver 供給修正值）。
// 唯一寫在程式裡的量是結構不變量：金額為最小貨幣單位的正整數、餘額不得為負（doc §8.1／§8.2）。

import type {
  CommandRejection,
  CurrencyId,
  DomainEventDraft,
  EconomyAccountId,
  EconomyTransferId,
  EntitySourceRef,
  ModuleId,
  ModuleOutcome,
  ModuleResult,
  ResolverId,
  TransactionId,
  WorldDay,
} from '../../contracts/core';
import type {
  CreateEconomyAccountCommand,
  CurrencyTransferred,
  EconomyAccountCreated,
  EconomyAccountOwner,
  EconomyDefinitionReader,
  EconomyDomainEvent,
  EconomyState,
  EconomyTransferReason,
  EconomyTransferRecord,
  GrantCurrencyCommand,
  MoneyValue,
  PriceQuoteInvalidated,
  RemoveCurrencyCommand,
  RewardRuleId,
  TransferCurrencyCommand,
} from '../../contracts/economy';

// 跨模組引用（僅型別 import）：訂閱的事件一律引用**來源模組契約的真實型別**，不自行複寫欄位。
import type { MarketPressureChanged } from '../../contracts/world';
import type { CharacterReputationChangedEvent } from '../../contracts/character';
import type { PlayerAffinityChangedPayload } from '../../contracts/social';

import {
  bumpEpoch,
  createEmptyAccount,
  findAccountIdByOwner,
  priceScopeKeyFor,
  recordTransfer,
  tryGetAccount,
  tryGetTransfer,
  upsertAccount,
  withBalanceDelta,
  type PriceScope,
} from './state';

// ──────────────────────────────────────────────────────────────────────────
// 模組常數（模組身分——規範明列的合法程式常數）
// ──────────────────────────────────────────────────────────────────────────

export const ECONOMY_MODULE_ID = 'economy' as ModuleId<'economy'>;

// ──────────────────────────────────────────────────────────────────────────
// 注入 Port：讓 Handler 保持純函式。真實組合由 Composition 注入；測試注入決定性 stub。
// ──────────────────────────────────────────────────────────────────────────

// 交易私有的 ID 配發器（背後由 Kernel RuntimeIdGenerator + cursor 提供）。
// Economy 只鑄自己擁有的實體 ID；EconomyTransferId 由**呼叫端**帶入命令當冪等鍵，不在此鑄造。
export interface EconomyIdAllocator {
  nextEconomyAccountId(): EconomyAccountId;
}

// GrantCurrency 的金額。命令本身**沒有** amount 欄位（契約如此）——發放多少錢是內容，
// 由 RewardRuleDefinition.resolverId 指向的資料化 Resolver 決定；Economy 只驗證與落帳。
// 回傳 undefined 表示該 Reward Rule 在目前輸入下產不出金額：Handler 明確拒絕，不補任何預設值。
export type RewardAmountResolverInput = Readonly<{
  resolverId: ResolverId;
  rewardRuleId: RewardRuleId;
  toAccountId: EconomyAccountId;
  targetCurrencyId: CurrencyId;
  reason: EconomyTransferReason;
  sourceId: EntitySourceRef;
  worldDay: WorldDay;
}>;

export interface EconomyRewardResolverPort {
  resolveRewardAmount(input: RewardAmountResolverInput): MoneyValue | undefined;
}

export type EconomyHandlerContext = Readonly<{
  worldDay: WorldDay;
  // EconomyTransferRecord.transactionId 是契約必填欄位（可重播帳本要指回開啟它的那筆交易）。
  transactionId: TransactionId;
  definitions: EconomyDefinitionReader;
  ids: EconomyIdAllocator;
  resolvers: EconomyRewardResolverPort;
}>;

// ──────────────────────────────────────────────────────────────────────────
// Handler 回傳型別（接受／拒絕）
// ──────────────────────────────────────────────────────────────────────────

export type EconomyHandlerResult = ModuleOutcome<EconomyState>;

// ──────────────────────────────────────────────────────────────────────────
// 小工具
// ──────────────────────────────────────────────────────────────────────────

function emit(event: EconomyDomainEvent): DomainEventDraft<unknown> {
  return { event };
}

function makeResult(
  nextSlice: EconomyState,
  outgoingMessages: readonly DomainEventDraft<unknown>[] = [],
): ModuleResult<EconomyState> {
  return { nextSlice, outgoingMessages, scheduledJobs: [] };
}

function accept(
  nextSlice: EconomyState,
  outgoingMessages: readonly DomainEventDraft<unknown>[] = [],
): EconomyHandlerResult {
  return { ok: true, result: makeResult(nextSlice, outgoingMessages) };
}

function reject(
  code: string,
  details?: Readonly<Record<string, string | number | boolean>>,
): EconomyHandlerResult {
  const rejection: CommandRejection =
    details === undefined
      ? { code, source: ECONOMY_MODULE_ID }
      : { code, source: ECONOMY_MODULE_ID, details };
  return { ok: false, rejection };
}

// 金額的結構性合法範圍（doc §8.1：餘額與金額皆為最小貨幣單位整數）。
// 「多少錢」是內容；「必須是正整數」是結構。
function amountRejectionCode(amount: number): string | undefined {
  if (!Number.isSafeInteger(amount)) return 'economy/amount-not-integer';
  if (amount <= 0) return 'economy/amount-not-positive';
  return undefined;
}

// 冪等重送的身分比對：只比對**由命令直接決定**的欄位。
// GrantCurrency 的 amount／currency 來自 Resolver 而非命令，所以那條路徑不比對這兩項
// （見 handleGrantCurrency：冪等檢查刻意在呼叫 Resolver **之前**）。
type TransferIdentity = Readonly<{
  fromAccountId?: EconomyAccountId;
  toAccountId?: EconomyAccountId;
  currencyId?: CurrencyId;
  amount?: number;
  reason: EconomyTransferReason;
  sourceId: EntitySourceRef;
}>;

function sameOptional<T>(expected: T | undefined, actual: T | undefined): boolean {
  return expected === undefined ? true : expected === actual;
}

function matchesRecord(record: EconomyTransferRecord, identity: TransferIdentity): boolean {
  return (
    record.fromAccountId === identity.fromAccountId &&
    record.toAccountId === identity.toAccountId &&
    sameOptional(identity.currencyId, record.currencyId) &&
    sameOptional(identity.amount, record.amount) &&
    record.reason === identity.reason &&
    record.sourceId === identity.sourceId
  );
}

// 契約明訂的冪等（doc §3.2：「同一 Transfer ID 重送時只能回傳既有結果，不得再次增減餘額」）。
//   * 資料齊全時這裡**仍然**會 no-op ——因為這件事已經發生過了，不是因為還沒實作。
//   * 不重發 CurrencyTransferred：事件已在第一次提交時公告過，再發一次會讓 city／quest 重複反應。
//   * transferId 被拿去帶不同的內容時**不是**冪等，而是呼叫端搞錯了冪等鍵：明確拒絕。
function replayOrConflict(
  state: EconomyState,
  transferId: EconomyTransferId,
  identity: TransferIdentity,
): EconomyHandlerResult | undefined {
  const existing = tryGetTransfer(state, transferId);
  if (existing === undefined) return undefined;
  if (!matchesRecord(existing, identity)) {
    return reject('economy/transfer-id-conflict', { transferId: String(transferId) });
  }
  return accept(state);
}

function transferredEvent(
  input: Readonly<{
    transferId: EconomyTransferId;
    from?: EconomyAccountId;
    to?: EconomyAccountId;
    amount: number;
    reason: EconomyTransferReason;
  }>,
): CurrencyTransferred {
  return {
    type: 'CurrencyTransferred',
    transferId: input.transferId,
    ...(input.from === undefined ? {} : { from: input.from }),
    ...(input.to === undefined ? {} : { to: input.to }),
    amount: input.amount,
    reason: input.reason,
  };
}

function transferRecord(
  input: Readonly<{
    transferId: EconomyTransferId;
    transactionId: TransactionId;
    fromAccountId?: EconomyAccountId;
    toAccountId?: EconomyAccountId;
    currencyId: CurrencyId;
    amount: number;
    reason: EconomyTransferReason;
    sourceId: EntitySourceRef;
    appliedOnDay: WorldDay;
  }>,
): EconomyTransferRecord {
  return {
    transferId: input.transferId,
    transactionId: input.transactionId,
    ...(input.fromAccountId === undefined ? {} : { fromAccountId: input.fromAccountId }),
    ...(input.toAccountId === undefined ? {} : { toAccountId: input.toAccountId }),
    currencyId: input.currencyId,
    amount: input.amount,
    reason: input.reason,
    sourceId: input.sourceId,
    appliedOnDay: input.appliedOnDay,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// §5.1 Internal Command：CreateEconomyAccount
// ──────────────────────────────────────────────────────────────────────────
//
// 為新角色、城市、Asset Distribution 清算或必要系統用途建立帳戶。
// Team 不可能出現在這裡：EconomyAccountOwner 的判別聯集沒有 team 變體（doc §3.1），
// 所以「不存在 Team Account」是型別層的結構不變量，不需要執行期檢查。
export function handleCreateEconomyAccount(
  command: CreateEconomyAccountCommand,
  state: EconomyState,
  ctx: EconomyHandlerContext,
): EconomyHandlerResult {
  // currencyId 由呼叫端帶入，不是內容之間的引用——Content Pack 的 reference 驗證擋不到它。
  const currency = ctx.definitions.tryGetCurrency(command.currencyId);
  if (currency === undefined) {
    return reject('economy/currency-definition-missing', {
      currencyId: String(command.currencyId),
    });
  }
  if (!currency.enabled) {
    return reject('economy/currency-disabled', { currencyId: String(command.currencyId) });
  }

  // （owner, currency）已有帳戶：契約明訂每個擁有者每種貨幣**一個**帳戶（doc §3.1），
  // 所以重送是「這件事已經發生過了」，不是缺實作。不重發 EconomyAccountCreated。
  const existing = findAccountIdByOwner(state, command.owner, command.currencyId);
  if (existing !== undefined) return accept(state);

  const accountId = ctx.ids.nextEconomyAccountId();
  const account = createEmptyAccount(accountId, command.owner, command.currencyId);
  const created: EconomyAccountCreated = {
    type: 'EconomyAccountCreated',
    accountId,
    owner: command.owner,
    currencyId: command.currencyId,
  };
  return accept(upsertAccount(state, account), [emit(created)]);
}

// ──────────────────────────────────────────────────────────────────────────
// §5.1 Internal Command：TransferCurrency
// ──────────────────────────────────────────────────────────────────────────
//
// 驗證來源餘額、貨幣與 Transfer ID 後原子移轉。任一驗證不過即整筆拒絕：
// 呼叫端（購買／販售／繼承 Workflow）以此讓整筆交易回滾，不會出現「扣了款但沒給物」。
export function handleTransferCurrency(
  command: TransferCurrencyCommand,
  state: EconomyState,
  ctx: EconomyHandlerContext,
): EconomyHandlerResult {
  const identity: TransferIdentity = {
    fromAccountId: command.fromAccountId,
    toAccountId: command.toAccountId,
    currencyId: command.currencyId,
    amount: command.amount,
    reason: command.reason,
    sourceId: command.sourceId,
  };
  const replay = replayOrConflict(state, command.transferId, identity);
  if (replay !== undefined) return replay;

  const amountCode = amountRejectionCode(command.amount);
  if (amountCode !== undefined) return reject(amountCode, { amount: command.amount });

  if (command.fromAccountId === command.toAccountId) {
    return reject('economy/same-account', { accountId: String(command.fromAccountId) });
  }

  const from = tryGetAccount(state, command.fromAccountId);
  if (from === undefined) {
    return reject('economy/unknown-account', { accountId: String(command.fromAccountId) });
  }
  const to = tryGetAccount(state, command.toAccountId);
  if (to === undefined) {
    return reject('economy/unknown-account', { accountId: String(command.toAccountId) });
  }

  // doc §8.4：Transfer 的幣別必須與兩端帳戶一致。Economy 不做匯率換算——換算是另一條規則，
  // 沒有資料契約前不得在此發明。
  if (from.currencyId !== command.currencyId || to.currencyId !== command.currencyId) {
    return reject('economy/currency-mismatch', {
      commandCurrencyId: String(command.currencyId),
      fromCurrencyId: String(from.currencyId),
      toCurrencyId: String(to.currencyId),
    });
  }

  // doc §8.2：餘額不得低於 0。這裡是拒絕，不是夾限。
  if (from.balance < command.amount) {
    return reject('economy/insufficient-balance', {
      accountId: String(from.accountId),
      balance: from.balance,
      required: command.amount,
    });
  }

  const debited = withBalanceDelta(from, -command.amount);
  const credited = withBalanceDelta(to, command.amount);
  const next = recordTransfer(
    upsertAccount(upsertAccount(state, debited), credited),
    transferRecord({
      transferId: command.transferId,
      transactionId: ctx.transactionId,
      fromAccountId: command.fromAccountId,
      toAccountId: command.toAccountId,
      currencyId: command.currencyId,
      amount: command.amount,
      reason: command.reason,
      sourceId: command.sourceId,
      appliedOnDay: ctx.worldDay,
    }),
  );

  return accept(next, [
    emit(
      transferredEvent({
        transferId: command.transferId,
        from: command.fromAccountId,
        to: command.toAccountId,
        amount: command.amount,
        reason: command.reason,
      }),
    ),
  ]);
}

// ──────────────────────────────────────────────────────────────────────────
// §5.1 Internal Command：GrantCurrency
// ──────────────────────────────────────────────────────────────────────────
//
// 依已驗證 Reward Rule 從 system source 發放（沒有來源帳戶 → EconomyTransferRecord.fromAccountId 缺席）。
// 金額不在命令裡也不在程式裡：RewardRuleDefinition.resolverId → EconomyRewardResolverPort。
export function handleGrantCurrency(
  command: GrantCurrencyCommand,
  state: EconomyState,
  ctx: EconomyHandlerContext,
): EconomyHandlerResult {
  // 冪等檢查刻意在呼叫 Resolver **之前**：重送不該再跑一次資料規則，比對也只能用命令自己帶的欄位。
  const replay = replayOrConflict(state, command.transferId, {
    toAccountId: command.toAccountId,
    reason: command.reason,
    sourceId: command.sourceId,
  });
  if (replay !== undefined) return replay;

  const to = tryGetAccount(state, command.toAccountId);
  if (to === undefined) {
    return reject('economy/unknown-account', { accountId: String(command.toAccountId) });
  }

  const rule = ctx.definitions.tryGetRewardRule(command.rewardRuleId);
  if (rule === undefined) {
    return reject('economy/reward-rule-definition-missing', {
      rewardRuleId: String(command.rewardRuleId),
    });
  }
  if (!rule.enabled) {
    return reject('economy/reward-rule-disabled', { rewardRuleId: String(command.rewardRuleId) });
  }

  const money = ctx.resolvers.resolveRewardAmount({
    resolverId: rule.resolverId,
    rewardRuleId: rule.id,
    toAccountId: command.toAccountId,
    targetCurrencyId: to.currencyId,
    reason: command.reason,
    sourceId: command.sourceId,
    worldDay: ctx.worldDay,
  });
  if (money === undefined) {
    return reject('economy/reward-amount-unresolved', {
      rewardRuleId: String(command.rewardRuleId),
      resolverId: String(rule.resolverId),
    });
  }

  const amountCode = amountRejectionCode(money.amount);
  if (amountCode !== undefined) return reject(amountCode, { amount: money.amount });

  if (money.currencyId !== to.currencyId) {
    return reject('economy/currency-mismatch', {
      rewardCurrencyId: String(money.currencyId),
      toCurrencyId: String(to.currencyId),
    });
  }

  const credited = withBalanceDelta(to, money.amount);
  const next = recordTransfer(
    upsertAccount(state, credited),
    transferRecord({
      transferId: command.transferId,
      transactionId: ctx.transactionId,
      toAccountId: command.toAccountId,
      currencyId: money.currencyId,
      amount: money.amount,
      reason: command.reason,
      sourceId: command.sourceId,
      appliedOnDay: ctx.worldDay,
    }),
  );

  return accept(next, [
    emit(
      transferredEvent({
        transferId: command.transferId,
        to: command.toAccountId,
        amount: money.amount,
        reason: command.reason,
      }),
    ),
  ]);
}

// ──────────────────────────────────────────────────────────────────────────
// §5.1 Internal Command：RemoveCurrency
// ──────────────────────────────────────────────────────────────────────────
//
// 依已驗證費用、罰金或 system sink 扣除（沒有目的帳戶 → toAccountId 缺席）。
// 「該收多少費」由呼叫端依自己的規則資料算出並帶進命令；Economy 只驗證幣別、餘額與冪等。
export function handleRemoveCurrency(
  command: RemoveCurrencyCommand,
  state: EconomyState,
  ctx: EconomyHandlerContext,
): EconomyHandlerResult {
  const replay = replayOrConflict(state, command.transferId, {
    fromAccountId: command.fromAccountId,
    currencyId: command.currencyId,
    amount: command.amount,
    reason: command.reason,
    sourceId: command.sourceId,
  });
  if (replay !== undefined) return replay;

  const amountCode = amountRejectionCode(command.amount);
  if (amountCode !== undefined) return reject(amountCode, { amount: command.amount });

  const from = tryGetAccount(state, command.fromAccountId);
  if (from === undefined) {
    return reject('economy/unknown-account', { accountId: String(command.fromAccountId) });
  }
  if (from.currencyId !== command.currencyId) {
    return reject('economy/currency-mismatch', {
      commandCurrencyId: String(command.currencyId),
      fromCurrencyId: String(from.currencyId),
    });
  }
  if (from.balance < command.amount) {
    return reject('economy/insufficient-balance', {
      accountId: String(from.accountId),
      balance: from.balance,
      required: command.amount,
    });
  }

  const debited = withBalanceDelta(from, -command.amount);
  const next = recordTransfer(
    upsertAccount(state, debited),
    transferRecord({
      transferId: command.transferId,
      transactionId: ctx.transactionId,
      fromAccountId: command.fromAccountId,
      currencyId: command.currencyId,
      amount: command.amount,
      reason: command.reason,
      sourceId: command.sourceId,
      appliedOnDay: ctx.worldDay,
    }),
  );

  return accept(next, [
    emit(
      transferredEvent({
        transferId: command.transferId,
        from: command.fromAccountId,
        amount: command.amount,
        reason: command.reason,
      }),
    ),
  ]);
}

// ──────────────────────────────────────────────────────────────────────────
// §5.2 Domain Event Subscriber：報價失效
// ──────────────────────────────────────────────────────────────────────────
//
// 三個訂閱的共同語意（doc §5.2）：**不複製別的模組的 State**，只把對應報價 scope 的 Epoch 遞增，
// 使綁定舊 Epoch 的 Quote 在成交前比對失敗。Economy 因此不會保存第二份市場壓力／聲望／好感值。
// `reason` 帶來源事件的訊息種類（訊息種類是結構不變量，不是內容）。
function invalidate(
  state: EconomyState,
  scope: PriceScope,
  reason: PriceQuoteInvalidated['reason'],
): ModuleResult<EconomyState> {
  const key = priceScopeKeyFor(scope);
  const invalidated: PriceQuoteInvalidated = { type: 'PriceQuoteInvalidated', scope: key, reason };
  return makeResult(bumpEpoch(state, key), [emit(invalidated)]);
}

// world：市場壓力改變 → 該 nation／region／city 範圍的報價失效。
export function onMarketPressureChanged(
  event: MarketPressureChanged,
  state: EconomyState,
): ModuleResult<EconomyState> {
  return invalidate(state, { kind: 'market', market: event.scope }, event.type);
}

// character：聲望改變 → 使用該角色聲望的報價失效。
export function onCharacterReputationChanged(
  event: CharacterReputationChangedEvent,
  state: EconomyState,
): ModuleResult<EconomyState> {
  return invalidate(state, { kind: 'characterReputation', characterId: event.characterId }, event.type);
}

// social：好感改變 → 只使「該冒險者作為家教提供者」的 Service Quote 失效（doc §4）。
// NPC 彼此沒有好感，所以這條 scope 只綁該冒險者本人，不擴散到一般買賣報價。
export function onPlayerAffinityChanged(
  event: PlayerAffinityChangedPayload,
  state: EconomyState,
): ModuleResult<EconomyState> {
  return invalidate(state, { kind: 'adventurerAffinity', adventurerId: event.adventurerId }, event.type);
}

// ──────────────────────────────────────────────────────────────────────────
// Owner 建構輔助（供呼叫端組 CreateEconomyAccount；不含任何內容知識）
// ──────────────────────────────────────────────────────────────────────────

export function systemAccountOwner(
  purpose: Extract<EconomyAccountOwner, { kind: 'system' }>['purpose'],
): EconomyAccountOwner {
  return { kind: 'system', purpose };
}
