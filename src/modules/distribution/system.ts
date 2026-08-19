// modules/distribution/system.ts
// Asset Distribution 的純函式 Handler（對應 docs/00_core/architecture/17_asset_distribution.md §5–8）。
//
// 設計原則：
//   * 全部為決定性純函式：不做 I/O、不呼叫 Math.random / Date.now。
//   * 需要「當前世界日」「規則資料」「economy／inventory／team 的事實」「新 ID」「Resolver 結果」時，
//     一律經由注入的 AssetDistributionHandlerContext 取得；RNG 只以顯式 cursor 串接。
//   * Internal Command Handler 簽章 (command, state, ctx)（同 modules/map）；
//     Game Command 簽章 (state, teamId, cmd, ctx)（同 modules/dungeon）。
//   * 可拒絕的 Handler 一律回傳 ModuleOutcome<AssetDistributionModuleState>。
//   * 本模組**不**直接改 Inventory Owner 或 Economy Balance（doc §1）：物品與貨幣的實際移轉全部
//     以 required Internal Command 送給擁有者，並引用該模組契約的真實命令型別。
//   * 競拍規則全部來自 AssetDistributionRuleDefinition：最低出價政策、流標直售倍率、平手政策、
//     餘數政策、Companion／NPC Resolver。本檔沒有任何可調的量。

import type {
  AssetDistributionId,
  CharacterId,
  CommandRejection,
  CurrencyId,
  DomainEventDraft,
  EconomyAccountId,
  EconomyTransferId,
  EntitySourceRef,
  InteractionId,
  InternalCommandDraft,
  ItemInstanceId,
  ModuleId,
  ModuleOutcome,
  ModuleResult,
  ResolverId,
  Revision,
  RngContext,
  RngStep,
  TeamId,
  TransactionMessageDraft,
  WorldDay,
} from '../../contracts/core';
import type {
  AppendAssetDistributionResultCommand,
  AssetDistribution,
  AssetDistributionDefinitionReader,
  AssetDistributionDomainEvent,
  AssetDistributionRuleDefinition,
  AssetDistributionSource,
  CurrencyAward,
  FinalizeAssetDistributionCollectionCommand,
  LootAuctionRound,
  LootBid,
  LootItemAward,
  MoneyValue,
  PassLootItemCommand,
  PendingAssetDistributionInteraction,
  ResolveLootAuctionRoundCommand,
  StartAssetDistributionCommand,
  SubmitLootBidCommand,
} from '../../contracts/distribution';

// 跨模組引用（僅型別 import）；外送命令一律用接收模組契約的真實型別。
import type {
  CreateEconomyAccountCommand,
  EconomyAccountOwner,
  EconomyTransferReason,
  TransferCurrencyCommand,
} from '../../contracts/economy';
import type { ItemRemovalReason, RemoveItemInstance, TransferItem } from '../../contracts/inventory';

import type { AssetDistributionModuleState } from './state';
import {
  appendedResultKey,
  bidTieBreakKey,
  bumpRevision,
  currentAuctionRound,
  currentItemId,
  isParticipant,
  isResultApplied,
  isSettlementAccountRequested,
  markResultApplied,
  markSettlementAccountRequested,
  remainderRotationOrder,
  settlementAccountRequestKey,
  tryGetDistribution,
  upsertDistribution,
  withBid,
  withRoundAt,
  withoutBid,
} from './state';

// ──────────────────────────────────────────────────────────────────────────
// 模組身分與外送目標
// ──────────────────────────────────────────────────────────────────────────

export const DISTRIBUTION_MODULE_ID = 'distribution' as ModuleId<'distribution'>;
const ECONOMY_MODULE_ID = 'economy' as ModuleId<'economy'>;
const INVENTORY_MODULE_ID = 'inventory' as ModuleId<'inventory'>;

// 轉帳／移轉原因（EconomyTransferReason 與 TransferItem.reason 都是 string；這些是本模組的
// 語意標籤，不是可調的量）。
const REASON_CURRENCY_INPUT: EconomyTransferReason = 'assetDistribution.currencyInput';
const REASON_AUCTION_PAYMENT: EconomyTransferReason = 'assetDistribution.auctionPayment';
const REASON_DIRECT_SALE: EconomyTransferReason = 'assetDistribution.directSaleProceeds';
const REASON_EQUAL_SPLIT: EconomyTransferReason = 'assetDistribution.equalSplit';
const REASON_ITEM_AWARD = 'assetDistribution.itemAward';
const DIRECT_SALE_REMOVAL_REASON: ItemRemovalReason = 'transferredOut';

// ──────────────────────────────────────────────────────────────────────────
// 注入 Port：讓 Handler 保持純函式。真實組合由 Composition 注入；測試注入決定性 stub。
// ──────────────────────────────────────────────────────────────────────────

// 交易私有的 ID 配發器。interactionId 是本模組擁有的實體；economyTransferId 是 economy 命令
// 契約**要求發送端提供**的冪等鍵（TransferCurrencyCommand.transferId），故也由此配發。
export interface AssetDistributionIdAllocator {
  nextInteractionId(): InteractionId;
  nextEconomyTransferId(): EconomyTransferId;
}

// economy 的 system 帳戶用途（直接取自 economy 契約的 EconomyAccountOwner，不另行複寫字面聯集）。
export type EconomySystemAccountPurpose = Extract<
  EconomyAccountOwner,
  Readonly<{ kind: 'system' }>
>['purpose'];

// economy 擁有的事實。全部回 `| undefined`：帳戶或幣別定義不存在時 Handler 要能回 typed rejection，
// 而不是拿到一個編造出來的帳戶 ID。
export interface DistributionEconomyQuery {
  findSettlementAccount(
    distributionId: AssetDistributionId,
    currencyId: CurrencyId,
  ): EconomyAccountId | undefined;
  findCharacterAccount(
    characterId: CharacterId,
    currencyId: CurrencyId,
  ): EconomyAccountId | undefined;
  findSystemAccount(
    purpose: EconomySystemAccountPurpose,
    currencyId: CurrencyId,
  ): EconomyAccountId | undefined;
  // CurrencyDefinition.smallestUnit（economy 擁有的內容事實）：餘數輪替的步長。
  findCurrencySmallestUnit(currencyId: CurrencyId): number | undefined;
  canAfford(accountId: EconomyAccountId, amount: number): boolean;
}

// inventory 擁有的事實：物品原價值（最低出價與流標直售價的來源，doc §2）。
export interface DistributionInventoryQuery {
  findIntrinsicValue(itemId: ItemInstanceId): MoneyValue | undefined;
}

// team 擁有的事實：玩家實際控制的角色（只有他能送 submitLootBid／passLootItem）。
export interface DistributionTeamQuery {
  findPlayerControlledCharacterId(): CharacterId | undefined;
}

// Companion 的出價決策（doc §7.1「依個人偏好與個人餘額決定 Bid／Pass」）。
export type CompanionBidDecision =
  | Readonly<{ kind: 'bid'; amount: number }>
  | Readonly<{ kind: 'pass' }>;

export interface DistributionResolverPort {
  resolveCompanionBid(
    input: Readonly<{
      resolverId: ResolverId;
      distributionId: AssetDistributionId;
      itemId: ItemInstanceId;
      bidderCharacterId: CharacterId;
      intrinsicValue: MoneyValue;
      minimumBid: number;
      rng: RngContext;
    }>,
  ): RngStep<CompanionBidDecision>;

  resolveNpcItemRecipient(
    input: Readonly<{
      resolverId: ResolverId;
      distributionId: AssetDistributionId;
      itemId: ItemInstanceId;
      participantCharacterIds: readonly CharacterId[];
      rng: RngContext;
    }>,
  ): RngStep<CharacterId>;
}

export type AssetDistributionHandlerContext = Readonly<{
  worldDay: WorldDay;
  definitions: AssetDistributionDefinitionReader;
  economy: DistributionEconomyQuery;
  inventory: DistributionInventoryQuery;
  team: DistributionTeamQuery;
  ids: AssetDistributionIdAllocator;
  resolvers: DistributionResolverPort;
  // 本筆分配建立時的 RNG 起點；建立後串接的 cursor 存在 AssetDistribution.rngContext。
  rngContext: RngContext;
}>;

export type AssetDistributionHandlerResult = ModuleOutcome<AssetDistributionModuleState>;

// ──────────────────────────────────────────────────────────────────────────
// 小工具
// ──────────────────────────────────────────────────────────────────────────

function event(e: AssetDistributionDomainEvent): DomainEventDraft<unknown> {
  return { event: e };
}

function internal(
  targetModule: ModuleId,
  command:
    | CreateEconomyAccountCommand
    | TransferCurrencyCommand
    | TransferItem
    | RemoveItemInstance,
): InternalCommandDraft<unknown> {
  return { targetModule, command };
}

function makeResult(
  nextSlice: AssetDistributionModuleState,
  outgoingMessages: readonly TransactionMessageDraft[] = [],
): ModuleResult<AssetDistributionModuleState> {
  return { nextSlice, outgoingMessages, scheduledJobs: [] };
}

function accept(
  nextSlice: AssetDistributionModuleState,
  outgoingMessages: readonly TransactionMessageDraft[] = [],
): AssetDistributionHandlerResult {
  return { ok: true, result: makeResult(nextSlice, outgoingMessages) };
}

function reject(
  code: string,
  details?: Readonly<Record<string, string | number | boolean>>,
): AssetDistributionHandlerResult {
  return { ok: false, rejection: { code, source: DISTRIBUTION_MODULE_ID, details } };
}

// 內部流程的中繼結果（讓多段流程可以串接而不重複寫 ok/rejection 判斷）。
type Step =
  | Readonly<{
      ok: true;
      state: AssetDistributionModuleState;
      messages: readonly TransactionMessageDraft[];
    }>
  | Readonly<{ ok: false; rejection: CommandRejection }>;

function stepOk(
  state: AssetDistributionModuleState,
  messages: readonly TransactionMessageDraft[] = [],
): Step {
  return { ok: true, state, messages };
}

function stepReject(
  code: string,
  details?: Readonly<Record<string, string | number | boolean>>,
): Step {
  return { ok: false, rejection: { code, source: DISTRIBUTION_MODULE_ID, details } };
}

function fromStep(step: Step, prefix: readonly TransactionMessageDraft[] = []): AssetDistributionHandlerResult {
  if (!step.ok) return { ok: false, rejection: step.rejection };
  return accept(step.state, [...prefix, ...step.messages]);
}

// Reader 對未註冊定義會拋；Handler 不得讓壞內容變成交易崩潰，一律轉 typed rejection。
function tryGetRule(
  ctx: AssetDistributionHandlerContext,
  distribution: AssetDistribution,
): AssetDistributionRuleDefinition | undefined {
  try {
    return ctx.definitions.getRule(distribution.ruleId);
  } catch {
    return undefined;
  }
}

// 每筆 economy／inventory 命令的來源實體。EntitySourceRef 不含 AssetDistributionId，
// 故取分配來源本身（questId／mapId）——那也是這批資產真正的來源。
function sourceRefOf(source: AssetDistributionSource): EntitySourceRef {
  switch (source.kind) {
    case 'questReward':
      return source.questId;
    case 'dungeonLoot':
      return source.mapId;
    case 'expiredQuestCargo':
      return source.questId;
  }
}

// currencyInputs 進清算帳戶的資金來源（economy 的 system 帳戶用途）。
// expiredQuestCargo 沒有對應的鑄幣來源——doc §7.4 的到期任務物資只有 Item，沒有貨幣。
function currencyInputSourcePurpose(
  source: AssetDistributionSource,
): EconomySystemAccountPurpose | undefined {
  switch (source.kind) {
    case 'questReward':
      return 'questRewards';
    case 'dungeonLoot':
      return 'dungeonGoldSource';
    case 'expiredQuestCargo':
      return undefined;
  }
}

const DIRECT_SALE_SOURCE_PURPOSE: EconomySystemAccountPurpose = 'lootDirectSaleSource';

function transferCurrency(
  input: Readonly<{
    transferId: EconomyTransferId;
    fromAccountId: EconomyAccountId;
    toAccountId: EconomyAccountId;
    currencyId: CurrencyId;
    amount: number;
    reason: EconomyTransferReason;
    sourceId: EntitySourceRef;
  }>,
): InternalCommandDraft<unknown> {
  return internal(ECONOMY_MODULE_ID, { type: 'TransferCurrency', ...input });
}

// 依幣別最小單位向下對齊（doc §8 不變量 5 的 floor，推廣到 smallestUnit 不為 1 的幣別）。
function floorToUnit(amount: number, unit: number): number {
  return Math.floor(amount / unit) * unit;
}

// ──────────────────────────────────────────────────────────────────────────
// 清算帳戶：economy 鑄 ID，本模組只請求建立並在解析得到後把 ID 快取進 Slice
// ──────────────────────────────────────────────────────────────────────────

// 對尚無帳戶、也尚未請求過的幣別送出 CreateEconomyAccount。
// 帳戶 ID 由 economy 鑄造，本模組**不**在此假設任何 ID；下一次需要用它時再以 Query 解析。
function requestSettlementAccounts(
  state: AssetDistributionModuleState,
  distribution: AssetDistribution,
  currencyIds: readonly CurrencyId[],
  ctx: AssetDistributionHandlerContext,
): Step {
  let nextState = state;
  const messages: TransactionMessageDraft[] = [];
  const seen = new Set<string>();

  for (const currencyId of currencyIds) {
    if (seen.has(String(currencyId))) continue;
    seen.add(String(currencyId));
    if (distribution.settlementAccountIds[currencyId] !== undefined) continue;
    const key = settlementAccountRequestKey(distribution.distributionId, currencyId);
    if (isSettlementAccountRequested(nextState, key)) continue;
    if (ctx.economy.findSettlementAccount(distribution.distributionId, currencyId) !== undefined) {
      continue;
    }
    nextState = markSettlementAccountRequested(nextState, key);
    const command: CreateEconomyAccountCommand = {
      type: 'CreateEconomyAccount',
      owner: { kind: 'assetDistribution', distributionId: distribution.distributionId },
      currencyId,
      sourceId: sourceRefOf(distribution.source),
    };
    messages.push(internal(ECONOMY_MODULE_ID, command));
  }

  return stepOk(nextState, messages);
}

// 解析清算帳戶並把它快取進 Slice（settlementAccountIds 是 economy 權威值的投影，不是自鑄）。
type AccountLookup =
  | Readonly<{ ok: true; distribution: AssetDistribution; accountId: EconomyAccountId }>
  | Readonly<{ ok: false; rejection: CommandRejection }>;

function resolveSettlementAccount(
  distribution: AssetDistribution,
  currencyId: CurrencyId,
  ctx: AssetDistributionHandlerContext,
): AccountLookup {
  const cached = distribution.settlementAccountIds[currencyId];
  if (cached !== undefined) return { ok: true, distribution, accountId: cached };
  const found = ctx.economy.findSettlementAccount(distribution.distributionId, currencyId);
  if (found === undefined) {
    return {
      ok: false,
      rejection: {
        code: 'distribution.settle.settlementAccountMissing',
        source: DISTRIBUTION_MODULE_ID,
        details: { distributionId: String(distribution.distributionId), currencyId: String(currencyId) },
      },
    };
  }
  return {
    ok: true,
    accountId: found,
    distribution: {
      ...distribution,
      settlementAccountIds: { ...distribution.settlementAccountIds, [currencyId]: found },
    },
  };
}

// ──────────────────────────────────────────────────────────────────────────
// 5.2 Internal Command：StartAssetDistribution
// ──────────────────────────────────────────────────────────────────────────

export function handleStartAssetDistribution(
  command: StartAssetDistributionCommand,
  state: AssetDistributionModuleState,
  ctx: AssetDistributionHandlerContext,
): AssetDistributionHandlerResult {
  if (tryGetDistribution(state, command.distributionId) !== undefined) {
    return reject('distribution.start.alreadyExists', {
      distributionId: String(command.distributionId),
    });
  }

  // doc §3／§8 不變量 11：參與者快照不可為空，且同一角色不得重複。
  if (command.participantCharacterIds.length === 0) {
    return reject('distribution.start.participantsEmpty', {
      distributionId: String(command.distributionId),
    });
  }
  if (new Set(command.participantCharacterIds.map(String)).size !== command.participantCharacterIds.length) {
    return reject('distribution.start.participantsDuplicated', {
      distributionId: String(command.distributionId),
    });
  }

  let rule: AssetDistributionRuleDefinition;
  try {
    rule = ctx.definitions.getRule(command.ruleId);
  } catch {
    return reject('distribution.start.ruleDefinitionMissing', { ruleId: String(command.ruleId) });
  }
  if (!rule.enabled) {
    return reject('distribution.start.ruleDisabled', { ruleId: String(command.ruleId) });
  }
  if (rule.sourceKind !== command.source.kind) {
    return reject('distribution.start.ruleSourceKindMismatch', {
      ruleId: String(command.ruleId),
      ruleSourceKind: rule.sourceKind,
      commandSourceKind: command.source.kind,
    });
  }
  if (rule.controllerPolicy === 'playerAuction' && rule.auction === undefined) {
    return reject('distribution.start.auctionConfigMissing', { ruleId: String(command.ruleId) });
  }
  if (rule.itemPolicy === 'rngPerItem' && rule.npcItemRecipientResolverId === undefined) {
    return reject('distribution.start.npcRecipientResolverMissing', {
      ruleId: String(command.ruleId),
    });
  }

  const distribution: AssetDistribution = {
    distributionId: command.distributionId,
    source: command.source,
    teamId: command.teamId,
    participantCharacterIds: [...command.participantCharacterIds],
    ruleId: command.ruleId,
    itemIds: [],
    currencyInputs: [],
    settlementAccountIds: {},
    currentItemIndex: 0,
    auctionRounds: [],
    status: 'collecting',
    revision: 0 as Revision,
    rngContext: ctx.rngContext,
  };

  return accept(upsertDistribution(state, distribution), [
    event({
      type: 'AssetDistributionStarted',
      distributionId: distribution.distributionId,
      source: distribution.source,
      participantCharacterIds: distribution.participantCharacterIds,
    }),
  ]);
}

// ──────────────────────────────────────────────────────────────────────────
// 5.2 Internal Command：AppendAssetDistributionResult
// ──────────────────────────────────────────────────────────────────────────

export function handleAppendAssetDistributionResult(
  command: AppendAssetDistributionResultCommand,
  state: AssetDistributionModuleState,
  ctx: AssetDistributionHandlerContext,
): AssetDistributionHandlerResult {
  const distribution = tryGetDistribution(state, command.distributionId);
  if (distribution === undefined) {
    return reject('distribution.append.distributionNotFound', {
      distributionId: String(command.distributionId),
    });
  }
  if (distribution.status !== 'collecting') {
    return reject('distribution.append.collectionClosed', {
      distributionId: String(command.distributionId),
      status: distribution.status,
    });
  }

  // doc §5.2：帶來源鍵的整筆結果冪等。資料齊全時同一鍵仍然只套用一次，故此 no-op 是冪等而非缺口。
  const sourceKeyRaw = command.sourceResultId ?? command.sourceGatheringResolutionId;
  const ledgerKey =
    sourceKeyRaw === undefined
      ? undefined
      : appendedResultKey(command.distributionId, String(sourceKeyRaw));
  if (ledgerKey !== undefined && isResultApplied(state, ledgerKey)) {
    return accept(state);
  }

  // 不變量 4：同一件 Item 在一筆 Distribution 中至多結算一次——重複加入直接拒絕。
  const existing = new Set(distribution.itemIds.map(String));
  for (const itemId of command.itemIds) {
    if (existing.has(String(itemId))) {
      return reject('distribution.append.itemAlreadyCollected', {
        distributionId: String(command.distributionId),
        itemId: String(itemId),
      });
    }
    existing.add(String(itemId));
  }

  const inputPurpose = currencyInputSourcePurpose(distribution.source);
  if (command.currencyInputs.length > 0 && inputPurpose === undefined) {
    return reject('distribution.append.currencyNotSupportedForSource', {
      distributionId: String(command.distributionId),
      sourceKind: distribution.source.kind,
    });
  }
  for (const money of command.currencyInputs) {
    if (money.amount < 0) {
      return reject('distribution.append.negativeCurrencyAmount', {
        distributionId: String(command.distributionId),
        currencyId: String(money.currencyId),
        amount: money.amount,
      });
    }
    const unit = ctx.economy.findCurrencySmallestUnit(money.currencyId);
    if (unit === undefined) {
      return reject('distribution.append.currencyDefinitionMissing', {
        currencyId: String(money.currencyId),
      });
    }
    if (money.amount % unit !== 0) {
      return reject('distribution.append.currencyNotUnitAligned', {
        currencyId: String(money.currencyId),
        amount: money.amount,
        smallestUnit: unit,
      });
    }
  }

  const merged = mergeCurrencyInputs(distribution.currencyInputs, command.currencyInputs);
  const nextDistribution: AssetDistribution = {
    ...distribution,
    itemIds: [...distribution.itemIds, ...command.itemIds],
    currencyInputs: merged,
    revision: bumpRevision(distribution.revision),
  };

  let nextState = upsertDistribution(state, nextDistribution);
  if (ledgerKey !== undefined) nextState = markResultApplied(nextState, ledgerKey);

  // 清算帳戶要在「settle 那筆交易之前」就存在：economy 鑄 ID，本模組隨後以 Query 解析。
  const request = requestSettlementAccounts(
    nextState,
    nextDistribution,
    command.currencyInputs.map((m) => m.currencyId),
    ctx,
  );
  if (!request.ok) return { ok: false, rejection: request.rejection };

  return accept(request.state, [
    ...request.messages,
    event({
      type: 'AssetDistributionResultAppended',
      distributionId: command.distributionId,
      itemIds: command.itemIds,
      currencyInputs: command.currencyInputs,
      ...(command.sourceGatheringResolutionId === undefined
        ? {}
        : { sourceGatheringResolutionId: command.sourceGatheringResolutionId }),
    }),
  ]);
}

function mergeCurrencyInputs(
  current: readonly MoneyValue[],
  added: readonly MoneyValue[],
): MoneyValue[] {
  const merged: MoneyValue[] = current.map((m) => ({ ...m }));
  for (const money of added) {
    const index = merged.findIndex((m) => m.currencyId === money.currencyId);
    if (index < 0) merged.push({ ...money });
    else merged[index] = { currencyId: money.currencyId, amount: merged[index]!.amount + money.amount };
  }
  return merged;
}

// ──────────────────────────────────────────────────────────────────────────
// 5.2 Internal Command：FinalizeAssetDistributionCollection
// ──────────────────────────────────────────────────────────────────────────

export function handleFinalizeAssetDistributionCollection(
  command: FinalizeAssetDistributionCollectionCommand,
  state: AssetDistributionModuleState,
  ctx: AssetDistributionHandlerContext,
): AssetDistributionHandlerResult {
  const distribution = tryGetDistribution(state, command.distributionId);
  if (distribution === undefined) {
    return reject('distribution.finalize.distributionNotFound', {
      distributionId: String(command.distributionId),
    });
  }
  if (distribution.status !== 'collecting') {
    return reject('distribution.finalize.collectionAlreadyClosed', {
      distributionId: String(command.distributionId),
      status: distribution.status,
    });
  }
  const rule = tryGetRule(ctx, distribution);
  if (rule === undefined) {
    return reject('distribution.finalize.ruleDefinitionMissing', {
      ruleId: String(distribution.ruleId),
    });
  }

  return fromStep(beginDisposition(state, distribution, rule, ctx));
}

// 收集關閉後的處置分派（doc §7）。
function beginDisposition(
  state: AssetDistributionModuleState,
  distribution: AssetDistribution,
  rule: AssetDistributionRuleDefinition,
  ctx: AssetDistributionHandlerContext,
): Step {
  switch (rule.itemPolicy) {
    case 'internalAuction': {
      if (distribution.itemIds.length === 0) {
        return settleCurrency({ ...distribution, status: 'settling' }, state, rule, ctx, []);
      }
      // 競拍款與流標直售款都會進清算帳戶：先請求這些物品原價值幣別的帳戶。
      const currencies: CurrencyId[] = [];
      for (const itemId of distribution.itemIds) {
        const value = ctx.inventory.findIntrinsicValue(itemId);
        if (value === undefined) {
          return stepReject('distribution.finalize.itemIntrinsicValueMissing', {
            itemId: String(itemId),
          });
        }
        currencies.push(value.currencyId);
      }
      const request = requestSettlementAccounts(state, distribution, currencies, ctx);
      if (!request.ok) return request;
      const opened = openAuctionRound(request.state, distribution, rule, ctx);
      if (!opened.ok) return opened;
      return stepOk(opened.state, [...request.messages, ...opened.messages]);
    }
    case 'rngPerItem':
      return awardAllByNpcRng(state, distribution, rule, ctx);
    case 'none': {
      if (distribution.itemIds.length > 0) {
        return stepReject('distribution.finalize.itemsNotAllowedByPolicy', {
          ruleId: String(rule.id),
          itemCount: distribution.itemIds.length,
        });
      }
      return settleCurrency({ ...distribution, status: 'settling' }, state, rule, ctx, []);
    }
  }
}

// ──────────────────────────────────────────────────────────────────────────
// 7.1 玩家內部競拍：開回合
// ──────────────────────────────────────────────────────────────────────────

function openAuctionRound(
  state: AssetDistributionModuleState,
  distribution: AssetDistribution,
  rule: AssetDistributionRuleDefinition,
  ctx: AssetDistributionHandlerContext,
): Step {
  const auction = rule.auction;
  if (auction === undefined) {
    return stepReject('distribution.auction.configMissing', { ruleId: String(rule.id) });
  }
  const itemId = currentItemId(distribution);
  if (itemId === undefined) {
    return stepReject('distribution.auction.noItemAtIndex', {
      distributionId: String(distribution.distributionId),
      currentItemIndex: distribution.currentItemIndex,
    });
  }
  const intrinsicValue = ctx.inventory.findIntrinsicValue(itemId);
  if (intrinsicValue === undefined) {
    return stepReject('distribution.auction.itemIntrinsicValueMissing', { itemId: String(itemId) });
  }
  const unit = ctx.economy.findCurrencySmallestUnit(intrinsicValue.currencyId);
  if (unit === undefined) {
    return stepReject('distribution.auction.currencyDefinitionMissing', {
      currencyId: String(intrinsicValue.currencyId),
    });
  }
  // minimumBid 政策目前只有 'intrinsicValue'（doc §2）：底價即原價值。
  const minimumBid = minimumBidOf(auction.minimumBid, intrinsicValue);

  const controller = ctx.team.findPlayerControlledCharacterId();
  if (controller === undefined) {
    return stepReject('distribution.auction.playerControlledCharacterMissing', {
      distributionId: String(distribution.distributionId),
    });
  }
  if (!isParticipant(distribution, controller)) {
    return stepReject('distribution.auction.controllerNotParticipant', {
      distributionId: String(distribution.distributionId),
      characterId: String(controller),
    });
  }

  // Companion 出價：依參與者快照順序逐名串接 RNG cursor（不重用 cursor）。
  let rngContext = distribution.rngContext;
  const bids: LootBid[] = [];
  for (const characterId of distribution.participantCharacterIds) {
    if (characterId === controller) continue;
    const step = ctx.resolvers.resolveCompanionBid({
      resolverId: auction.companionBidResolverId,
      distributionId: distribution.distributionId,
      itemId,
      bidderCharacterId: characterId,
      intrinsicValue,
      minimumBid,
      rng: rngContext,
    });
    rngContext = { ...rngContext, cursor: step.nextCursor };
    if (step.value.kind === 'pass') continue;
    if (step.value.amount < minimumBid || step.value.amount % unit !== 0) {
      return stepReject('distribution.auction.companionBidInvalid', {
        characterId: String(characterId),
        amount: step.value.amount,
        minimumBid,
        smallestUnit: unit,
      });
    }
    bids.push({ bidderCharacterId: characterId, amount: step.value.amount, source: 'companionResolver' });
  }

  const round: LootAuctionRound = { itemId, intrinsicValue, bids, state: 'open' };
  const pendingInteraction: PendingAssetDistributionInteraction = {
    interactionId: ctx.ids.nextInteractionId(),
    kind: 'lootAuction',
    itemId,
    openedOnDay: ctx.worldDay,
    revision: 0 as Revision,
  };

  const nextDistribution: AssetDistribution = {
    ...distribution,
    rngContext,
    auctionRounds: withRoundAt(distribution, distribution.currentItemIndex, round),
    pendingInteraction,
    status: 'awaitingPlayerBid',
    revision: bumpRevision(distribution.revision),
  };

  return stepOk(upsertDistribution(state, nextDistribution), [
    event({
      type: 'LootAuctionRoundOpened',
      distributionId: nextDistribution.distributionId,
      itemId,
      intrinsicValue,
    }),
    event({
      type: 'PlayerInteractionOpened',
      interactionId: pendingInteraction.interactionId,
      teamId: nextDistribution.teamId,
      kind: 'lootAuction',
    }),
  ]);
}

function minimumBidOf(
  policy: NonNullable<AssetDistributionRuleDefinition['auction']>['minimumBid'],
  intrinsicValue: MoneyValue,
): number {
  switch (policy) {
    case 'intrinsicValue':
      return intrinsicValue.amount;
  }
}

// ──────────────────────────────────────────────────────────────────────────
// 5.1 玩家 Command：submitLootBid / passLootItem / resolveLootAuctionRound
// ──────────────────────────────────────────────────────────────────────────

type AuctionConfig = NonNullable<AssetDistributionRuleDefinition['auction']>;

type OpenRoundContext = Readonly<{
  distribution: AssetDistribution;
  rule: AssetDistributionRuleDefinition;
  auction: AuctionConfig;
  round: LootAuctionRound;
}>;

type OpenRoundLookup =
  | Readonly<{ ok: true; value: OpenRoundContext }>
  | Readonly<{ ok: false; rejection: CommandRejection }>;

function requireOpenRound(
  state: AssetDistributionModuleState,
  teamId: TeamId,
  distributionId: AssetDistributionId,
  itemId: ItemInstanceId,
  ctx: AssetDistributionHandlerContext,
  codePrefix: string,
): OpenRoundLookup {
  const fail = (
    code: string,
    details?: Readonly<Record<string, string | number | boolean>>,
  ): OpenRoundLookup => ({
    ok: false,
    rejection: { code: `${codePrefix}.${code}`, source: DISTRIBUTION_MODULE_ID, details },
  });

  const distribution = tryGetDistribution(state, distributionId);
  if (distribution === undefined) {
    return fail('distributionNotFound', { distributionId: String(distributionId) });
  }
  // Router 的授權只看 teamId/characterId/encounterId 目標；distributionId 的歸屬由本模組驗。
  if (distribution.teamId !== teamId) {
    return fail('notOwnedByActorTeam', {
      distributionId: String(distributionId),
      teamId: String(teamId),
    });
  }
  if (distribution.status !== 'awaitingPlayerBid') {
    return fail('notAwaitingPlayerBid', {
      distributionId: String(distributionId),
      status: distribution.status,
    });
  }
  const round = currentAuctionRound(distribution);
  if (round === undefined || round.state !== 'open') {
    return fail('noOpenRound', { distributionId: String(distributionId) });
  }
  if (round.itemId !== itemId) {
    return fail('notCurrentItem', {
      distributionId: String(distributionId),
      itemId: String(itemId),
      currentItemId: String(round.itemId),
    });
  }
  const rule = tryGetRule(ctx, distribution);
  if (rule === undefined) {
    return fail('ruleDefinitionMissing', { ruleId: String(distribution.ruleId) });
  }
  const auction = rule.auction;
  if (auction === undefined) {
    return fail('auctionConfigMissing', { ruleId: String(rule.id) });
  }
  return { ok: true, value: { distribution, rule, auction, round } };
}

export function handleSubmitLootBid(
  state: AssetDistributionModuleState,
  teamId: TeamId,
  cmd: SubmitLootBidCommand,
  ctx: AssetDistributionHandlerContext,
): AssetDistributionHandlerResult {
  const found = requireOpenRound(state, teamId, cmd.distributionId, cmd.itemId, ctx, 'distribution.bid');
  if (!found.ok) return { ok: false, rejection: found.rejection };
  const { distribution, auction, round } = found.value;

  if (!isParticipant(distribution, cmd.bidderCharacterId)) {
    return reject('distribution.bid.bidderNotParticipant', {
      characterId: String(cmd.bidderCharacterId),
    });
  }
  const controller = ctx.team.findPlayerControlledCharacterId();
  if (controller === undefined) {
    return reject('distribution.bid.playerControlledCharacterMissing');
  }
  if (controller !== cmd.bidderCharacterId) {
    return reject('distribution.bid.bidderNotPlayerControlled', {
      characterId: String(cmd.bidderCharacterId),
      controllerCharacterId: String(controller),
    });
  }

  const minimumBid = minimumBidOf(auction.minimumBid, round.intrinsicValue);
  if (cmd.amount < minimumBid) {
    return reject('distribution.bid.belowMinimum', { amount: cmd.amount, minimumBid });
  }
  const unit = ctx.economy.findCurrencySmallestUnit(round.intrinsicValue.currencyId);
  if (unit === undefined) {
    return reject('distribution.bid.currencyDefinitionMissing', {
      currencyId: String(round.intrinsicValue.currencyId),
    });
  }
  if (cmd.amount % unit !== 0) {
    return reject('distribution.bid.amountNotUnitAligned', {
      amount: cmd.amount,
      smallestUnit: unit,
    });
  }
  const bidderAccount = ctx.economy.findCharacterAccount(
    cmd.bidderCharacterId,
    round.intrinsicValue.currencyId,
  );
  if (bidderAccount === undefined) {
    return reject('distribution.bid.bidderAccountMissing', {
      characterId: String(cmd.bidderCharacterId),
      currencyId: String(round.intrinsicValue.currencyId),
    });
  }
  if (!ctx.economy.canAfford(bidderAccount, cmd.amount)) {
    return reject('distribution.bid.insufficientFunds', {
      characterId: String(cmd.bidderCharacterId),
      amount: cmd.amount,
    });
  }

  const nextRound = withBid(round, {
    bidderCharacterId: cmd.bidderCharacterId,
    amount: cmd.amount,
    source: 'player',
  });
  const nextDistribution: AssetDistribution = {
    ...distribution,
    auctionRounds: withRoundAt(distribution, distribution.currentItemIndex, nextRound),
    pendingInteraction:
      distribution.pendingInteraction === undefined
        ? undefined
        : {
            ...distribution.pendingInteraction,
            revision: bumpRevision(distribution.pendingInteraction.revision),
          },
    revision: bumpRevision(distribution.revision),
  };

  return accept(upsertDistribution(state, nextDistribution));
}

export function handlePassLootItem(
  state: AssetDistributionModuleState,
  teamId: TeamId,
  cmd: PassLootItemCommand,
  ctx: AssetDistributionHandlerContext,
): AssetDistributionHandlerResult {
  const found = requireOpenRound(state, teamId, cmd.distributionId, cmd.itemId, ctx, 'distribution.pass');
  if (!found.ok) return { ok: false, rejection: found.rejection };
  const { distribution, round } = found.value;

  if (!isParticipant(distribution, cmd.bidderCharacterId)) {
    return reject('distribution.pass.bidderNotParticipant', {
      characterId: String(cmd.bidderCharacterId),
    });
  }
  const controller = ctx.team.findPlayerControlledCharacterId();
  if (controller === undefined) {
    return reject('distribution.pass.playerControlledCharacterMissing');
  }
  if (controller !== cmd.bidderCharacterId) {
    return reject('distribution.pass.bidderNotPlayerControlled', {
      characterId: String(cmd.bidderCharacterId),
      controllerCharacterId: String(controller),
    });
  }

  // 只撤掉玩家自己的出價；同回合 Companion Resolver 出價仍有效（doc §5.1）。
  // 沒有可撤的出價時本呼叫是冪等的：「玩家放棄」這件事已經成立（未出價＝未爭取）。
  const nextRound = withoutBid(round, cmd.bidderCharacterId, 'player');
  const nextDistribution: AssetDistribution = {
    ...distribution,
    auctionRounds: withRoundAt(distribution, distribution.currentItemIndex, nextRound),
    revision: bumpRevision(distribution.revision),
  };
  return accept(upsertDistribution(state, nextDistribution));
}

export function handleResolveLootAuctionRound(
  state: AssetDistributionModuleState,
  teamId: TeamId,
  cmd: ResolveLootAuctionRoundCommand,
  ctx: AssetDistributionHandlerContext,
): AssetDistributionHandlerResult {
  const found = requireOpenRound(
    state,
    teamId,
    cmd.distributionId,
    cmd.itemId,
    ctx,
    'distribution.resolveRound',
  );
  if (!found.ok) return { ok: false, rejection: found.rejection };
  const { distribution, rule, auction, round } = found.value;

  const unit = ctx.economy.findCurrencySmallestUnit(round.intrinsicValue.currencyId);
  if (unit === undefined) {
    return reject('distribution.resolveRound.currencyDefinitionMissing', {
      currencyId: String(round.intrinsicValue.currencyId),
    });
  }

  const escrow = resolveSettlementAccount(distribution, round.intrinsicValue.currencyId, ctx);
  if (!escrow.ok) return { ok: false, rejection: escrow.rejection };
  let working = escrow.distribution;
  const escrowAccountId = escrow.accountId;

  const messages: TransactionMessageDraft[] = [];
  const winner = pickWinningBid(working, round, ctx);

  let settledRound: LootAuctionRound;
  if (winner !== undefined) {
    const winnerAccount = ctx.economy.findCharacterAccount(
      winner.bidderCharacterId,
      round.intrinsicValue.currencyId,
    );
    if (winnerAccount === undefined) {
      return reject('distribution.resolveRound.winnerAccountMissing', {
        characterId: String(winner.bidderCharacterId),
      });
    }
    settledRound = {
      ...round,
      state: 'awarded',
      winnerCharacterId: winner.bidderCharacterId,
      winningBid: winner.amount,
    };
    // 得標付款 → 清算帳戶；Item Owner 轉為得標者並進入其背包（doc §7.1，同一交易原子提交）。
    messages.push(
      transferCurrency({
        transferId: ctx.ids.nextEconomyTransferId(),
        fromAccountId: winnerAccount,
        toAccountId: escrowAccountId,
        currencyId: round.intrinsicValue.currencyId,
        amount: winner.amount,
        reason: REASON_AUCTION_PAYMENT,
        sourceId: sourceRefOf(working.source),
      }),
    );
    const transfer: TransferItem = {
      type: 'TransferItem',
      itemId: round.itemId,
      to: { kind: 'characterBag', characterId: winner.bidderCharacterId },
      newOwnerCharacterId: winner.bidderCharacterId,
      reason: REASON_ITEM_AWARD,
    };
    messages.push(internal(INVENTORY_MODULE_ID, transfer));
    messages.push(
      event({
        type: 'LootItemAwarded',
        distributionId: working.distributionId,
        itemId: round.itemId,
        winnerCharacterId: winner.bidderCharacterId,
        winningBid: winner.amount,
      }),
    );
  } else {
    const saleValue = directSaleValue(round, auction.unclaimedSaleMultiplier, unit);
    const saleSource = ctx.economy.findSystemAccount(
      DIRECT_SALE_SOURCE_PURPOSE,
      round.intrinsicValue.currencyId,
    );
    if (saleSource === undefined) {
      return reject('distribution.resolveRound.directSaleSourceAccountMissing', {
        currencyId: String(round.intrinsicValue.currencyId),
        purpose: DIRECT_SALE_SOURCE_PURPOSE,
      });
    }
    settledRound = { ...round, state: 'directSold' };
    messages.push(
      transferCurrency({
        transferId: ctx.ids.nextEconomyTransferId(),
        fromAccountId: saleSource,
        toAccountId: escrowAccountId,
        currencyId: saleValue.currencyId,
        amount: saleValue.amount,
        reason: REASON_DIRECT_SALE,
        sourceId: sourceRefOf(working.source),
      }),
    );
    const removal: RemoveItemInstance = {
      type: 'RemoveItemInstance',
      itemId: round.itemId,
      reason: DIRECT_SALE_REMOVAL_REASON,
    };
    messages.push(internal(INVENTORY_MODULE_ID, removal));
    messages.push(
      event({
        type: 'LootItemDirectSold',
        distributionId: working.distributionId,
        itemId: round.itemId,
        saleValue,
      }),
    );
  }

  working = {
    ...working,
    auctionRounds: withRoundAt(working, working.currentItemIndex, settledRound),
    currentItemIndex: working.currentItemIndex + 1,
    pendingInteraction: undefined,
    revision: bumpRevision(working.revision),
  };

  // 還有物品 → 開下一回合；全部處置完 → 貨幣均分並完成（AssetDistributionCompleted）。
  if (working.currentItemIndex < working.itemIds.length) {
    const opened = openAuctionRound(upsertDistribution(state, working), working, rule, ctx);
    return fromStep(opened, messages);
  }
  const settled = settleCurrency(
    { ...working, status: 'settling' },
    upsertDistribution(state, working),
    rule,
    ctx,
    messages,
  );
  return fromStep(settled);
}

// 最高有效出價；同額依 distributionId+itemId+characterId 固定排序（不重骰）。
// 結算時餘額已不足者該筆失效，取下一筆（doc §7.1）。
function pickWinningBid(
  distribution: AssetDistribution,
  round: LootAuctionRound,
  ctx: AssetDistributionHandlerContext,
): LootBid | undefined {
  const ordered = [...round.bids].sort((a, b) => {
    if (a.amount !== b.amount) return b.amount - a.amount;
    const ka = bidTieBreakKey(distribution.distributionId, round.itemId, a.bidderCharacterId);
    const kb = bidTieBreakKey(distribution.distributionId, round.itemId, b.bidderCharacterId);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
  for (const bid of ordered) {
    const account = ctx.economy.findCharacterAccount(
      bid.bidderCharacterId,
      round.intrinsicValue.currencyId,
    );
    if (account === undefined) continue;
    if (!ctx.economy.canAfford(account, bid.amount)) continue;
    return bid;
  }
  return undefined;
}

// 流標直售價（doc §8 不變量 5：floor(原價值 × 倍率)，倍率取自 Rule）。
function directSaleValue(
  round: LootAuctionRound,
  multiplier: number,
  unit: number,
): MoneyValue {
  return {
    currencyId: round.intrinsicValue.currencyId,
    amount: floorToUnit(Math.floor(round.intrinsicValue.amount * multiplier), unit),
  };
}

// ──────────────────────────────────────────────────────────────────────────
// 7.2 NPC RNG 逐件分配
// ──────────────────────────────────────────────────────────────────────────

function awardAllByNpcRng(
  state: AssetDistributionModuleState,
  distribution: AssetDistribution,
  rule: AssetDistributionRuleDefinition,
  ctx: AssetDistributionHandlerContext,
): Step {
  const resolverId = rule.npcItemRecipientResolverId;
  if (resolverId === undefined) {
    return stepReject('distribution.npcAward.recipientResolverMissing', { ruleId: String(rule.id) });
  }

  let rngContext = distribution.rngContext;
  const rounds: LootAuctionRound[] = [];
  const messages: TransactionMessageDraft[] = [];

  for (const itemId of distribution.itemIds) {
    const intrinsicValue = ctx.inventory.findIntrinsicValue(itemId);
    if (intrinsicValue === undefined) {
      return stepReject('distribution.npcAward.itemIntrinsicValueMissing', { itemId: String(itemId) });
    }
    const step = ctx.resolvers.resolveNpcItemRecipient({
      resolverId,
      distributionId: distribution.distributionId,
      itemId,
      participantCharacterIds: distribution.participantCharacterIds,
      rng: rngContext,
    });
    rngContext = { ...rngContext, cursor: step.nextCursor };
    const recipient = step.value;
    if (!isParticipant(distribution, recipient)) {
      return stepReject('distribution.npcAward.recipientNotParticipant', {
        itemId: String(itemId),
        characterId: String(recipient),
      });
    }
    rounds.push({
      itemId,
      intrinsicValue,
      bids: [],
      state: 'awarded',
      winnerCharacterId: recipient,
    });
    const transfer: TransferItem = {
      type: 'TransferItem',
      itemId,
      to: { kind: 'characterBag', characterId: recipient },
      newOwnerCharacterId: recipient,
      reason: REASON_ITEM_AWARD,
    };
    messages.push(internal(INVENTORY_MODULE_ID, transfer));
    messages.push(
      event({
        type: 'LootItemAwarded',
        distributionId: distribution.distributionId,
        itemId,
        winnerCharacterId: recipient,
      }),
    );
  }

  const next: AssetDistribution = {
    ...distribution,
    rngContext,
    auctionRounds: rounds,
    currentItemIndex: distribution.itemIds.length,
    status: 'settling',
    revision: bumpRevision(distribution.revision),
  };

  return settleCurrency(next, upsertDistribution(state, next), rule, ctx, messages);
}

// ──────────────────────────────────────────────────────────────────────────
// 7.3 貨幣均分 + AssetDistributionCompleted
// ──────────────────────────────────────────────────────────────────────────

type CurrencyPoolEntry = Readonly<{ inputAmount: number; proceedsAmount: number }>;

function poolByCurrency(
  distribution: AssetDistribution,
  rule: AssetDistributionRuleDefinition,
  ctx: AssetDistributionHandlerContext,
): Readonly<{ ok: true; pool: ReadonlyMap<CurrencyId, CurrencyPoolEntry> }> | Readonly<{ ok: false; rejection: CommandRejection }> {
  const pool = new Map<CurrencyId, { inputAmount: number; proceedsAmount: number }>();
  const bucket = (currencyId: CurrencyId) => {
    const existing = pool.get(currencyId);
    if (existing !== undefined) return existing;
    const created = { inputAmount: 0, proceedsAmount: 0 };
    pool.set(currencyId, created);
    return created;
  };

  for (const money of distribution.currencyInputs) {
    bucket(money.currencyId).inputAmount += money.amount;
  }

  for (const round of distribution.auctionRounds) {
    if (round.state === 'awarded') {
      if (round.winningBid !== undefined) {
        bucket(round.intrinsicValue.currencyId).proceedsAmount += round.winningBid;
      }
      continue;
    }
    if (round.state !== 'directSold') continue;
    const auction = rule.auction;
    if (auction === undefined) {
      return {
        ok: false,
        rejection: {
          code: 'distribution.settle.auctionConfigMissing',
          source: DISTRIBUTION_MODULE_ID,
          details: { ruleId: String(rule.id) },
        },
      };
    }
    const unit = ctx.economy.findCurrencySmallestUnit(round.intrinsicValue.currencyId);
    if (unit === undefined) {
      return {
        ok: false,
        rejection: {
          code: 'distribution.settle.currencyDefinitionMissing',
          source: DISTRIBUTION_MODULE_ID,
          details: { currencyId: String(round.intrinsicValue.currencyId) },
        },
      };
    }
    const sale = directSaleValue(round, auction.unclaimedSaleMultiplier, unit);
    bucket(sale.currencyId).proceedsAmount += sale.amount;
  }

  return { ok: true, pool };
}

function settleCurrency(
  distribution: AssetDistribution,
  state: AssetDistributionModuleState,
  rule: AssetDistributionRuleDefinition,
  ctx: AssetDistributionHandlerContext,
  prefixMessages: readonly TransactionMessageDraft[],
): Step {
  const pooled = poolByCurrency(distribution, rule, ctx);
  if (!pooled.ok) return { ok: false, rejection: pooled.rejection };

  const participantCount = distribution.participantCharacterIds.length;
  if (participantCount === 0) {
    return stepReject('distribution.settle.participantsEmpty', {
      distributionId: String(distribution.distributionId),
    });
  }

  let working = distribution;
  const messages: TransactionMessageDraft[] = [...prefixMessages];
  const currencyAwards: CurrencyAward[] = [];
  const rotation = remainderRotationOrder(distribution);

  // 幣別順序決定性：依 currencyId 字典序。
  const currencyIds = [...pooled.pool.keys()].sort((a, b) =>
    String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0,
  );

  for (const currencyId of currencyIds) {
    const entry = pooled.pool.get(currencyId)!;
    const total = entry.inputAmount + entry.proceedsAmount;
    if (total === 0) continue;

    const unit = ctx.economy.findCurrencySmallestUnit(currencyId);
    if (unit === undefined) {
      return stepReject('distribution.settle.currencyDefinitionMissing', {
        currencyId: String(currencyId),
      });
    }
    if (total % unit !== 0) {
      return stepReject('distribution.settle.totalNotUnitAligned', {
        currencyId: String(currencyId),
        total,
        smallestUnit: unit,
      });
    }

    const escrow = resolveSettlementAccount(working, currencyId, ctx);
    if (!escrow.ok) return { ok: false, rejection: escrow.rejection };
    working = escrow.distribution;
    const escrowAccountId = escrow.accountId;

    // 收集階段記錄的貨幣此刻才實際入帳（清算帳戶歸零與 completed 必須同一交易，doc §7.3）。
    if (entry.inputAmount > 0) {
      const purpose = currencyInputSourcePurpose(working.source);
      if (purpose === undefined) {
        return stepReject('distribution.settle.currencyInputSourceUnsupported', {
          sourceKind: working.source.kind,
        });
      }
      const inputSource = ctx.economy.findSystemAccount(purpose, currencyId);
      if (inputSource === undefined) {
        return stepReject('distribution.settle.inputSourceAccountMissing', {
          currencyId: String(currencyId),
          purpose,
        });
      }
      messages.push(
        transferCurrency({
          transferId: ctx.ids.nextEconomyTransferId(),
          fromAccountId: inputSource,
          toAccountId: escrowAccountId,
          currencyId,
          amount: entry.inputAmount,
          reason: REASON_CURRENCY_INPUT,
          sourceId: sourceRefOf(working.source),
        }),
      );
    }

    const shares = equalSplitShares(total, unit, participantCount, rotation, rule.remainderPolicy);
    for (const characterId of rotation) {
      const amount = shares.get(characterId);
      if (amount === undefined || amount === 0) continue;
      const account = ctx.economy.findCharacterAccount(characterId, currencyId);
      if (account === undefined) {
        return stepReject('distribution.settle.characterAccountMissing', {
          characterId: String(characterId),
          currencyId: String(currencyId),
        });
      }
      messages.push(
        transferCurrency({
          transferId: ctx.ids.nextEconomyTransferId(),
          fromAccountId: escrowAccountId,
          toAccountId: account,
          currencyId,
          amount,
          reason: REASON_EQUAL_SPLIT,
          sourceId: sourceRefOf(working.source),
        }),
      );
      currencyAwards.push({ characterId, amount: { currencyId, amount } });
    }
  }

  const itemAwards: LootItemAward[] = [];
  for (const round of working.auctionRounds) {
    if (round.state !== 'awarded' || round.winnerCharacterId === undefined) continue;
    itemAwards.push({
      itemId: round.itemId,
      winnerCharacterId: round.winnerCharacterId,
      ...(round.winningBid === undefined ? {} : { winningBid: round.winningBid }),
    });
  }

  const completed: AssetDistribution = {
    ...working,
    pendingInteraction: undefined,
    status: 'completed',
    revision: bumpRevision(working.revision),
  };

  messages.push(
    event({
      type: 'AssetDistributionCompleted',
      distributionId: completed.distributionId,
      itemAwards,
      currencyAwards,
    }),
  );

  return stepOk(upsertDistribution(state, completed), messages);
}

// baseShare = floor(總池 / 人數)；餘數依輪替順序每人追加一個最小貨幣單位（doc §7.3）。
function equalSplitShares(
  total: number,
  unit: number,
  participantCount: number,
  rotation: readonly CharacterId[],
  policy: AssetDistributionRuleDefinition['remainderPolicy'],
): ReadonlyMap<CharacterId, number> {
  const shares = new Map<CharacterId, number>();
  const totalUnits = total / unit;
  const baseUnits = Math.floor(totalUnits / participantCount);
  let remainderUnits = totalUnits - baseUnits * participantCount;
  const base = baseUnits * unit;

  switch (policy) {
    case 'deterministicRotation': {
      for (const characterId of rotation) {
        const extra = remainderUnits > 0 ? unit : 0;
        if (remainderUnits > 0) remainderUnits -= 1;
        shares.set(characterId, base + extra);
      }
      return shares;
    }
  }
}
