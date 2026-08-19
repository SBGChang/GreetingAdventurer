// modules/distribution/distribution.test.ts
// 自足式單元測試（無 node:test / console / DOM 全域）。
// runTests() 執行全部案例；任一失敗即 throw，供最外層 harness 判定。
//
// 覆蓋重點：
//   * 三個 Game Command 與三個 Internal Command 各至少一個 accept。
//   * 每一種 typed rejection 至少一個案例。
//   * 收斂閉合：collection finalize 後才開競拍；全部品項處置完才發 AssetDistributionCompleted
//     （dungeon 的返城屏障就掛在這個事件上）。
//   * 冪等：帶來源鍵的 Append 重放、玩家重複 pass。
//   * RNG：同 cursor 同結果 + cursor 逐次前進（不重用 cursor 0）。

import type {
  AssetDistributionId,
  CharacterId,
  CurrencyId,
  GatheringResolutionId,
  InteractionId,
  InternalCommandDraft,
  ItemInstanceId,
  Revision,
  TransactionMessageDraft,
} from '../../contracts/core';
import type {
  AppendAssetDistributionResultCommand,
  AssetDistribution,
  AssetDistributionDomainEvent,
  FinalizeAssetDistributionCollectionCommand,
  StartAssetDistributionCommand,
} from '../../contracts/distribution';
import type { DungeonOutboundInternalCommand } from '../../contracts/dungeon';
import type { CreateEconomyAccountCommand, TransferCurrencyCommand } from '../../contracts/economy';
import type { RemoveItemInstance, TransferItem } from '../../contracts/inventory';

import type { AssetDistributionHandlerResult, AssetDistributionHandlerContext } from './system';
import {
  DISTRIBUTION_MODULE_ID,
  handleAppendAssetDistributionResult,
  handleFinalizeAssetDistributionCollection,
  handlePassLootItem,
  handleResolveLootAuctionRound,
  handleStartAssetDistribution,
  handleSubmitLootBid,
} from './system';
import { createAssetDistributionQuery, isAwaitingPlayerBid } from './queries';
import type { AssetDistributionModuleState } from './state';
import { tryGetDistribution } from './state';
import {
  ALLY_A,
  ALLY_A_ACCOUNT,
  ALLY_B,
  ALLY_B_ACCOUNT,
  AUCTION_RULE,
  COIN,
  DEFAULT_BALANCES,
  DEFAULT_CHARACTER_ACCOUNTS,
  DEFAULT_SYSTEM_ACCOUNTS,
  DIRECT_SALE_ACCOUNT,
  DISTRIBUTION_ID,
  DUNGEON_GOLD_ACCOUNT,
  ESCROW_ACCOUNT,
  HERO,
  HERO_ACCOUNT,
  ITEM_1,
  ITEM_2,
  ITEM_UNPRICED,
  MAP_ID,
  OTHER_DISTRIBUTION_ID,
  OTHER_TEAM_ID,
  OUTSIDER,
  QUEST_ID,
  QUEST_REWARD_ACCOUNT,
  RULE_AUCTION,
  RULE_AUCTION_NO_CONFIG,
  RULE_CURRENCY_ONLY,
  RULE_DISABLED,
  RULE_NPC_NO_RESOLVER,
  RULE_NPC_RNG,
  RULE_QUEST_AUCTION,
  TEAM_ID,
  WORLD_DAY,
  emptyState,
  fixtureRngContext,
  makeContext,
  makeDistribution,
  stateWith,
  stubDefinitionReader,
  stubEconomy,
  stubIds,
  stubInventory,
  stubResolvers,
  stubTeam,
  TEAM_WITHOUT_CONTROLLER,
} from './fixtures';

// ── 迷你斷言工具 ─────────────────────────────────────────────────────────────
function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

function expectOk(r: AssetDistributionHandlerResult, label: string) {
  if (!r.ok) throw new Error(`${label}: expected accept, got reject ${r.rejection.code}`);
  return r.result;
}

function expectReject(r: AssetDistributionHandlerResult, code: string, label: string): void {
  if (r.ok) throw new Error(`${label}: expected reject '${code}', got accept`);
  assert(
    r.rejection.code === code,
    `${label}: expected code '${code}', got '${r.rejection.code}'`,
  );
  assert(
    r.rejection.source === DISTRIBUTION_MODULE_ID,
    `${label}: rejection.source 應為 distribution，實得 ${String(r.rejection.source)}`,
  );
}

function eventsOf(messages: readonly TransactionMessageDraft[]): AssetDistributionDomainEvent[] {
  return messages
    .filter((m): m is { event: unknown } => 'event' in m)
    .map((m) => m.event as AssetDistributionDomainEvent);
}

type AnyOutbound =
  | CreateEconomyAccountCommand
  | TransferCurrencyCommand
  | TransferItem
  | RemoveItemInstance;

function commandsOf(messages: readonly TransactionMessageDraft[]): AnyOutbound[] {
  return messages
    .filter((m): m is InternalCommandDraft<unknown> => 'command' in m)
    .map((m) => m.command as AnyOutbound);
}

function findEvent<K extends AssetDistributionDomainEvent['type']>(
  events: readonly AssetDistributionDomainEvent[],
  type: K,
): Extract<AssetDistributionDomainEvent, { type: K }> | undefined {
  return events.find((e) => e.type === type) as
    | Extract<AssetDistributionDomainEvent, { type: K }>
    | undefined;
}

function transfersOf(messages: readonly TransactionMessageDraft[]): TransferCurrencyCommand[] {
  return commandsOf(messages).filter(
    (c): c is TransferCurrencyCommand => c.type === 'TransferCurrency',
  );
}

function requireDist(
  state: AssetDistributionModuleState,
  id: AssetDistributionId = DISTRIBUTION_ID,
): AssetDistribution {
  const found = tryGetDistribution(state, id);
  if (found === undefined) throw new Error(`distribution ${String(id)} 不存在`);
  return found;
}

// ── 常用命令 ─────────────────────────────────────────────────────────────────

function startCommand(
  overrides: Partial<StartAssetDistributionCommand> = {},
): StartAssetDistributionCommand {
  return {
    type: 'StartAssetDistribution',
    distributionId: DISTRIBUTION_ID,
    source: { kind: 'dungeonLoot', mapId: MAP_ID },
    teamId: TEAM_ID,
    participantCharacterIds: [HERO, ALLY_A, ALLY_B],
    ruleId: RULE_AUCTION,
    ...overrides,
  };
}

function appendCommand(
  overrides: Partial<AppendAssetDistributionResultCommand> = {},
): AppendAssetDistributionResultCommand {
  return {
    type: 'AppendAssetDistributionResult',
    distributionId: DISTRIBUTION_ID,
    itemIds: [],
    currencyInputs: [],
    ...overrides,
  };
}

const FINALIZE: FinalizeAssetDistributionCollectionCommand = {
  type: 'FinalizeAssetDistributionCollection',
  distributionId: DISTRIBUTION_ID,
};

// 走完 Start → Append → Finalize 的完整前置流程，回傳 state 與最後一步的訊息。
function drive(
  input: Readonly<{
    ctx?: AssetDistributionHandlerContext;
    start?: Partial<StartAssetDistributionCommand>;
    append?: Partial<AppendAssetDistributionResultCommand>;
    finalize?: boolean;
  }> = {},
): Readonly<{
  state: AssetDistributionModuleState;
  ctx: AssetDistributionHandlerContext;
  messages: readonly TransactionMessageDraft[];
}> {
  const ctx = input.ctx ?? makeContext();
  let state = emptyState();
  state = expectOk(
    handleStartAssetDistribution(startCommand(input.start), state, ctx),
    'drive/start',
  ).nextSlice;
  let messages: readonly TransactionMessageDraft[] = [];
  if (input.append !== undefined) {
    const r = expectOk(
      handleAppendAssetDistributionResult(appendCommand(input.append), state, ctx),
      'drive/append',
    );
    state = r.nextSlice;
    messages = r.outgoingMessages;
  }
  if (input.finalize === true) {
    const r = expectOk(
      handleFinalizeAssetDistributionCollection(FINALIZE, state, ctx),
      'drive/finalize',
    );
    state = r.nextSlice;
    messages = r.outgoingMessages;
  }
  return { state, ctx, messages };
}

// ── dungeon → distribution 的接點（由 tsc 保證）────────────────────────────
// dungeon 的 DungeonOutboundInternalCommand 已直接引用本模組契約的真實命令型別，所以
// 「dungeon 送的 payload 我的 handler 吃不吃得下」是編譯期問題。這兩個包裝函式把該保證
// 具體化：任一端改了欄位，這裡先編譯失敗，而不是等執行期在交易裡才發現。
function acceptDungeonStart(
  command: Extract<DungeonOutboundInternalCommand, { type: 'StartAssetDistribution' }>,
  state: AssetDistributionModuleState,
  ctx: AssetDistributionHandlerContext,
): AssetDistributionHandlerResult {
  return handleStartAssetDistribution(command, state, ctx);
}

function acceptDungeonFinalize(
  command: Extract<DungeonOutboundInternalCommand, { type: 'FinalizeAssetDistributionCollection' }>,
  state: AssetDistributionModuleState,
  ctx: AssetDistributionHandlerContext,
): AssetDistributionHandlerResult {
  return handleFinalizeAssetDistributionCollection(command, state, ctx);
}

// ── 案例 ─────────────────────────────────────────────────────────────────────

const CASES: readonly Readonly<{ name: string; run: () => void }>[] = [
  // ── StartAssetDistribution ────────────────────────────────────────────────
  {
    name: 'Start：建立 collecting 分配 + 參與者快照 + AssetDistributionStarted',
    run: () => {
      const ctx = makeContext();
      const r = expectOk(handleStartAssetDistribution(startCommand(), emptyState(), ctx), 'start');
      const dist = requireDist(r.nextSlice);
      assert(dist.status === 'collecting', `status 應為 collecting，實得 ${dist.status}`);
      assert(dist.participantCharacterIds.length === 3, '參與者快照應有 3 人');
      assert(dist.itemIds.length === 0 && dist.currencyInputs.length === 0, '起始無資產');
      assert(dist.currentItemIndex === 0, 'currentItemIndex 應為 0');
      assert(dist.rngContext.cursor === fixtureRngContext().cursor, 'rngContext 取自 ctx');
      const started = findEvent(eventsOf(r.outgoingMessages), 'AssetDistributionStarted');
      assert(started !== undefined, '應發 AssetDistributionStarted');
      assert(started!.participantCharacterIds.length === 3, '事件應帶參與者快照');
    },
  },
  {
    name: 'Start：同一 distributionId 重複建立 → alreadyExists',
    run: () => {
      const ctx = makeContext();
      const first = expectOk(
        handleStartAssetDistribution(startCommand(), emptyState(), ctx),
        'start',
      );
      expectReject(
        handleStartAssetDistribution(startCommand(), first.nextSlice, ctx),
        'distribution.start.alreadyExists',
        'start again',
      );
    },
  },
  {
    name: 'Start：參與者快照不可為空 / 不可重複（不變量 11）',
    run: () => {
      const ctx = makeContext();
      expectReject(
        handleStartAssetDistribution(
          startCommand({ participantCharacterIds: [] }),
          emptyState(),
          ctx,
        ),
        'distribution.start.participantsEmpty',
        'empty participants',
      );
      expectReject(
        handleStartAssetDistribution(
          startCommand({ participantCharacterIds: [HERO, HERO] }),
          emptyState(),
          ctx,
        ),
        'distribution.start.participantsDuplicated',
        'duplicated participants',
      );
    },
  },
  {
    name: 'Start：規則不存在／未啟用／sourceKind 不符 → 各自 typed rejection',
    run: () => {
      const ctx = makeContext();
      expectReject(
        handleStartAssetDistribution(
          startCommand({ ruleId: 'rule-absent' as typeof RULE_AUCTION }),
          emptyState(),
          ctx,
        ),
        'distribution.start.ruleDefinitionMissing',
        'missing rule',
      );
      expectReject(
        handleStartAssetDistribution(startCommand({ ruleId: RULE_DISABLED }), emptyState(), ctx),
        'distribution.start.ruleDisabled',
        'disabled rule',
      );
      expectReject(
        handleStartAssetDistribution(
          startCommand({ ruleId: RULE_CURRENCY_ONLY }),
          emptyState(),
          ctx,
        ),
        'distribution.start.ruleSourceKindMismatch',
        'source kind mismatch',
      );
    },
  },
  {
    name: 'Start：playerAuction 缺 auction 設定 / rngPerItem 缺 resolver → 拒絕（Capability 不成立）',
    run: () => {
      const ctx = makeContext();
      expectReject(
        handleStartAssetDistribution(
          startCommand({ ruleId: RULE_AUCTION_NO_CONFIG }),
          emptyState(),
          ctx,
        ),
        'distribution.start.auctionConfigMissing',
        'auction config missing',
      );
      expectReject(
        handleStartAssetDistribution(
          startCommand({ ruleId: RULE_NPC_NO_RESOLVER }),
          emptyState(),
          ctx,
        ),
        'distribution.start.npcRecipientResolverMissing',
        'npc resolver missing',
      );
    },
  },

  {
    name: 'dungeon 接點：dungeon 實際送出的 Start / Finalize payload 被本模組接受並收斂到 Completed',
    run: () => {
      const ctx = makeContext();
      // 與 modules/dungeon/system.ts 的 startPlayerExploration 完全同形（source 只帶 mapId）。
      let state = expectOk(
        acceptDungeonStart(
          {
            type: 'StartAssetDistribution',
            distributionId: DISTRIBUTION_ID,
            source: { kind: 'dungeonLoot', mapId: MAP_ID },
            teamId: TEAM_ID,
            participantCharacterIds: [HERO, ALLY_A, ALLY_B],
            ruleId: RULE_AUCTION,
          },
          emptyState(),
          ctx,
        ),
        'dungeon start',
      ).nextSlice;
      // 與 useDungeonExit / handleCombatEncounterResolved（戰敗）送出的 payload 同形。
      const finalized = expectOk(
        acceptDungeonFinalize(
          { type: 'FinalizeAssetDistributionCollection', distributionId: DISTRIBUTION_ID },
          state,
          ctx,
        ),
        'dungeon finalize',
      );
      state = finalized.nextSlice;
      // 空手而歸（戰敗未取得任何戰利品）→ 當場完成，dungeon 的返城屏障立刻解除。
      assert(
        findEvent(eventsOf(finalized.outgoingMessages), 'AssetDistributionCompleted') !== undefined,
        'dungeon 等的 AssetDistributionCompleted 必須發出，否則 Session 永遠關不掉',
      );
      assert(requireDist(state).status === 'completed', 'status 應為 completed');
    },
  },

  // ── AppendAssetDistributionResult ─────────────────────────────────────────
  {
    name: 'Append：加入 Item 與 Currency、發 ResultAppended、對未建立的幣別送 CreateEconomyAccount',
    run: () => {
      // 清算帳戶「還沒建立」：economy stub 不列出 settlement account。
      const ctx = makeContext({ economy: stubEconomy({ settlementAccounts: [] }) });
      let state = expectOk(
        handleStartAssetDistribution(startCommand(), emptyState(), ctx),
        'start',
      ).nextSlice;
      const r = expectOk(
        handleAppendAssetDistributionResult(
          appendCommand({ itemIds: [ITEM_1], currencyInputs: [{ currencyId: COIN, amount: 30 }] }),
          state,
          ctx,
        ),
        'append',
      );
      state = r.nextSlice;
      const dist = requireDist(state);
      assert(dist.itemIds.length === 1, 'itemIds 應有 1 筆');
      assert(dist.currencyInputs[0]?.amount === 30, `currencyInputs 應為 30，實得 ${String(dist.currencyInputs[0]?.amount)}`);
      const created = commandsOf(r.outgoingMessages).filter(
        (c): c is CreateEconomyAccountCommand => c.type === 'CreateEconomyAccount',
      );
      assert(created.length === 1, `應送 1 筆 CreateEconomyAccount，實得 ${created.length}`);
      assert(
        created[0]!.owner.kind === 'assetDistribution',
        '清算帳戶 owner 必須是 assetDistribution',
      );
      assert(findEvent(eventsOf(r.outgoingMessages), 'AssetDistributionResultAppended') !== undefined,
        '應發 AssetDistributionResultAppended');
    },
  },
  {
    name: 'Append：清算帳戶已存在 → 不重送 CreateEconomyAccount',
    run: () => {
      const ctx = makeContext();
      const state = expectOk(
        handleStartAssetDistribution(startCommand(), emptyState(), ctx),
        'start',
      ).nextSlice;
      const r = expectOk(
        handleAppendAssetDistributionResult(
          appendCommand({ currencyInputs: [{ currencyId: COIN, amount: 30 }] }),
          state,
          ctx,
        ),
        'append',
      );
      assert(
        commandsOf(r.outgoingMessages).length === 0,
        '帳戶已存在時不應送任何 economy 命令',
      );
    },
  },
  {
    name: 'Append：同一 sourceGatheringResolutionId 重放 → 冪等（不重複加入、不重複發事件）',
    run: () => {
      const ctx = makeContext();
      const resolutionId = 'gathering-1' as GatheringResolutionId;
      let state = expectOk(
        handleStartAssetDistribution(startCommand(), emptyState(), ctx),
        'start',
      ).nextSlice;
      const cmd = appendCommand({
        itemIds: [ITEM_1],
        currencyInputs: [{ currencyId: COIN, amount: 30 }],
        sourceGatheringResolutionId: resolutionId,
      });
      state = expectOk(handleAppendAssetDistributionResult(cmd, state, ctx), 'append 1').nextSlice;
      const replay = expectOk(handleAppendAssetDistributionResult(cmd, state, ctx), 'append 2');
      assert(replay.nextSlice === state, '重放應回傳同一份 slice（冪等，非碰巧沒變）');
      assert(replay.outgoingMessages.length === 0, '重放不應再發事件或命令');
      const dist = requireDist(replay.nextSlice);
      assert(dist.itemIds.length === 1, '重放不應重複加入 Item');
      assert(dist.currencyInputs[0]?.amount === 30, '重放不應重複加入 Currency');
    },
  },
  {
    name: 'Append：不存在的分配 / 已關閉收集 / 重複 Item → 各自 typed rejection',
    run: () => {
      const ctx = makeContext();
      expectReject(
        handleAppendAssetDistributionResult(appendCommand(), emptyState(), ctx),
        'distribution.append.distributionNotFound',
        'append to nothing',
      );
      const closed = drive({ ctx, append: { itemIds: [ITEM_1] }, finalize: true });
      expectReject(
        handleAppendAssetDistributionResult(appendCommand({ itemIds: [ITEM_2] }), closed.state, ctx),
        'distribution.append.collectionClosed',
        'append after finalize',
      );
      const open = drive({ ctx, append: { itemIds: [ITEM_1] } });
      expectReject(
        handleAppendAssetDistributionResult(appendCommand({ itemIds: [ITEM_1] }), open.state, ctx),
        'distribution.append.itemAlreadyCollected',
        'duplicate item',
      );
    },
  },
  {
    name: 'Append：expiredQuestCargo 沒有貨幣鑄幣來源 → currencyNotSupportedForSource',
    run: () => {
      const ctx = makeContext();
      const state = expectOk(
        handleStartAssetDistribution(
          startCommand({
            ruleId: RULE_QUEST_AUCTION,
            source: { kind: 'expiredQuestCargo', questId: QUEST_ID },
          }),
          emptyState(),
          ctx,
        ),
        'start',
      ).nextSlice;
      expectReject(
        handleAppendAssetDistributionResult(
          appendCommand({ currencyInputs: [{ currencyId: COIN, amount: 10 }] }),
          state,
          ctx,
        ),
        'distribution.append.currencyNotSupportedForSource',
        'cargo currency',
      );
    },
  },
  {
    name: 'Append：負值 / 未知幣別 / 非最小單位倍數 → 各自 typed rejection',
    run: () => {
      const ctx = makeContext();
      const { state } = drive({ ctx });
      expectReject(
        handleAppendAssetDistributionResult(
          appendCommand({ currencyInputs: [{ currencyId: COIN, amount: -1 }] }),
          state,
          ctx,
        ),
        'distribution.append.negativeCurrencyAmount',
        'negative',
      );
      expectReject(
        handleAppendAssetDistributionResult(
          appendCommand({ currencyInputs: [{ currencyId: 'currency-unknown' as CurrencyId, amount: 5 }] }),
          state,
          ctx,
        ),
        'distribution.append.currencyDefinitionMissing',
        'unknown currency',
      );
      const coarse = makeContext({
        economy: stubEconomy({ smallestUnits: { [String(COIN)]: 10 } }),
      });
      expectReject(
        handleAppendAssetDistributionResult(
          appendCommand({ currencyInputs: [{ currencyId: COIN, amount: 5 }] }),
          state,
          coarse,
        ),
        'distribution.append.currencyNotUnitAligned',
        'not unit aligned',
      );
    },
  },

  // ── Finalize：三種 Policy 的處置 ───────────────────────────────────────────
  {
    name: 'Finalize（playerAuction）：關閉收集後才開競拍，狀態轉 awaitingPlayerBid + 恰一筆 pendingInteraction',
    run: () => {
      const resolvers = stubResolvers({ companionDecisions: { [String(ALLY_A)]: { kind: 'bid', amount: 120 } } });
      const ctx = makeContext({ resolvers: resolvers.port });
      // 收集期間不得有競拍回合（屏障：finalize 之前不開）。
      const collecting = drive({ ctx, append: { itemIds: [ITEM_1, ITEM_2] } });
      assert(
        requireDist(collecting.state).auctionRounds.length === 0,
        '收集階段不得先開競拍回合',
      );
      const r = expectOk(
        handleFinalizeAssetDistributionCollection(FINALIZE, collecting.state, ctx),
        'finalize',
      );
      const dist = requireDist(r.nextSlice);
      assert(dist.status === 'awaitingPlayerBid', `status 應為 awaitingPlayerBid，實得 ${dist.status}`);
      assert(dist.pendingInteraction !== undefined, '不變量 10：必須恰有一筆 pendingInteraction');
      assert(dist.pendingInteraction!.itemId === ITEM_1, 'pending 指向第一件物品');
      assert(dist.pendingInteraction!.openedOnDay === WORLD_DAY, 'openedOnDay 取自 ctx.worldDay');
      assert(dist.auctionRounds.length === 1, '只開當前那一回合');
      assert(dist.auctionRounds[0]!.bids.length === 1, 'Companion 出價應寫入本回合');
      assert(dist.auctionRounds[0]!.bids[0]!.source === 'companionResolver', 'source 應為 companionResolver');
      const events = eventsOf(r.outgoingMessages);
      assert(findEvent(events, 'LootAuctionRoundOpened') !== undefined, '應發 LootAuctionRoundOpened');
      const opened = findEvent(events, 'PlayerInteractionOpened');
      assert(opened !== undefined && opened.kind === 'lootAuction', '應發 PlayerInteractionOpened(lootAuction)');
      assert(findEvent(events, 'AssetDistributionCompleted') === undefined, '尚有品項未處置，不得發 Completed');
    },
  },
  {
    name: 'Finalize（playerAuction、零戰利品）：直接完成——地牢戰敗無收穫也能收斂',
    run: () => {
      const ctx = makeContext();
      const r = expectOk(
        handleFinalizeAssetDistributionCollection(FINALIZE, drive({ ctx }).state, ctx),
        'finalize',
      );
      const dist = requireDist(r.nextSlice);
      assert(dist.status === 'completed', `status 應為 completed，實得 ${dist.status}`);
      assert(dist.pendingInteraction === undefined, '完成後 pendingInteraction 必須清除');
      const completed = findEvent(eventsOf(r.outgoingMessages), 'AssetDistributionCompleted');
      assert(completed !== undefined, '應發 AssetDistributionCompleted');
      assert(completed!.itemAwards.length === 0 && completed!.currencyAwards.length === 0, '無資產可分');
      assert(transfersOf(r.outgoingMessages).length === 0, '無資產時不應有任何轉帳');
    },
  },
  {
    name: 'Finalize（equalCurrencyOnly）：貨幣均分 + 餘數輪替，清算帳戶收支相抵並發 Completed',
    run: () => {
      const ctx = makeContext({
        economy: stubEconomy({
          settlementAccounts: [
            { distributionId: DISTRIBUTION_ID, currencyId: COIN, accountId: ESCROW_ACCOUNT },
          ],
        }),
      });
      let state = expectOk(
        handleStartAssetDistribution(
          startCommand({
            ruleId: RULE_CURRENCY_ONLY,
            source: { kind: 'questReward', questId: QUEST_ID },
          }),
          emptyState(),
          ctx,
        ),
        'start',
      ).nextSlice;
      state = expectOk(
        handleAppendAssetDistributionResult(
          appendCommand({ currencyInputs: [{ currencyId: COIN, amount: 100 }] }),
          state,
          ctx,
        ),
        'append',
      ).nextSlice;
      const r = expectOk(handleFinalizeAssetDistributionCollection(FINALIZE, state, ctx), 'finalize');
      const transfers = transfersOf(r.outgoingMessages);
      // 1 筆入帳（questRewards → escrow）+ 3 筆出帳（escrow → 每人）。
      const inbound = transfers.filter((t) => t.toAccountId === ESCROW_ACCOUNT);
      const outbound = transfers.filter((t) => t.fromAccountId === ESCROW_ACCOUNT);
      assert(inbound.length === 1, `入帳應 1 筆，實得 ${inbound.length}`);
      assert(inbound[0]!.fromAccountId === QUEST_REWARD_ACCOUNT, '入帳來源應為 questRewards 系統帳戶');
      assert(inbound[0]!.amount === 100, '入帳金額應為 100');
      assert(outbound.length === 3, `出帳應 3 筆，實得 ${outbound.length}`);
      const total = outbound.reduce((sum, t) => sum + t.amount, 0);
      assert(total === 100, `不變量 7：清算帳戶必須歸零，出帳合計 ${total}`);
      // baseShare = floor(100/3) = 33，餘 1 由輪替順序第一人取得。
      const amounts = outbound.map((t) => t.amount).sort((a, b) => a - b);
      assert(
        amounts[0] === 33 && amounts[1] === 33 && amounts[2] === 34,
        `均分應為 33/33/34，實得 ${amounts.join('/')}`,
      );
      const completed = findEvent(eventsOf(r.outgoingMessages), 'AssetDistributionCompleted');
      assert(completed !== undefined, '應發 AssetDistributionCompleted');
      assert(completed!.currencyAwards.length === 3, 'currencyAwards 應為 3 筆');
      assert(requireDist(r.nextSlice).status === 'completed', 'status 應為 completed');
    },
  },
  {
    name: 'Finalize（rngPerItem）：逐件 RNG 指派收受者、送 TransferItem、cursor 逐次前進',
    run: () => {
      const resolvers = stubResolvers({ npcRecipients: [ALLY_A, ALLY_B] });
      const ctx = makeContext({ resolvers: resolvers.port });
      let state = expectOk(
        handleStartAssetDistribution(startCommand({ ruleId: RULE_NPC_RNG }), emptyState(), ctx),
        'start',
      ).nextSlice;
      state = expectOk(
        handleAppendAssetDistributionResult(
          appendCommand({ itemIds: [ITEM_1, ITEM_2] }),
          state,
          ctx,
        ),
        'append',
      ).nextSlice;
      const r = expectOk(handleFinalizeAssetDistributionCollection(FINALIZE, state, ctx), 'finalize');
      const transfers = commandsOf(r.outgoingMessages).filter(
        (c): c is TransferItem => c.type === 'TransferItem',
      );
      assert(transfers.length === 2, `應送 2 筆 TransferItem，實得 ${transfers.length}`);
      assert(
        transfers[0]!.newOwnerCharacterId === ALLY_A && transfers[1]!.newOwnerCharacterId === ALLY_B,
        '收受者應依 resolver 結果',
      );
      assert(
        transfers.every((t) => t.to.kind === 'characterBag'),
        '不變量 1：分配結果只可屬 Character（characterBag）',
      );
      assert(
        resolvers.npcCursors.length === 2 && resolvers.npcCursors[0] === 0 && resolvers.npcCursors[1] === 1,
        `cursor 應逐次前進 [0,1]，實得 [${resolvers.npcCursors.join(',')}]`,
      );
      const dist = requireDist(r.nextSlice);
      assert(dist.status === 'completed', 'NPC 分配應在同一交易完成');
      assert(dist.rngContext.cursor === 2, `rngContext.cursor 應前進到 2，實得 ${dist.rngContext.cursor}`);
      assert(
        findEvent(eventsOf(r.outgoingMessages), 'AssetDistributionCompleted') !== undefined,
        '應發 AssetDistributionCompleted',
      );
    },
  },
  {
    name: 'rngPerItem：同 cursor 同結果（決定性重播）',
    run: () => {
      const run = () => {
        const resolvers = stubResolvers({ npcRecipients: [ALLY_B, ALLY_A] });
        const ctx = makeContext({ resolvers: resolvers.port });
        let state = expectOk(
          handleStartAssetDistribution(startCommand({ ruleId: RULE_NPC_RNG }), emptyState(), ctx),
          'start',
        ).nextSlice;
        state = expectOk(
          handleAppendAssetDistributionResult(appendCommand({ itemIds: [ITEM_1, ITEM_2] }), state, ctx),
          'append',
        ).nextSlice;
        const r = expectOk(handleFinalizeAssetDistributionCollection(FINALIZE, state, ctx), 'finalize');
        return requireDist(r.nextSlice).auctionRounds.map((round) => String(round.winnerCharacterId));
      };
      const a = run();
      const b = run();
      assert(a.join('|') === b.join('|'), `同 cursor 應同結果：${a.join('|')} vs ${b.join('|')}`);
    },
  },
  {
    name: 'Finalize：不存在 / 重複 finalize / itemPolicy none 卻有物品 / 缺原價值 → 各自 typed rejection',
    run: () => {
      const ctx = makeContext();
      expectReject(
        handleFinalizeAssetDistributionCollection(FINALIZE, emptyState(), ctx),
        'distribution.finalize.distributionNotFound',
        'finalize nothing',
      );
      const once = drive({ ctx, finalize: true });
      expectReject(
        handleFinalizeAssetDistributionCollection(FINALIZE, once.state, ctx),
        'distribution.finalize.collectionAlreadyClosed',
        'finalize twice',
      );
      // itemPolicy 'none'（equalCurrencyOnly）卻收到物品。
      const noneState = stateWith(
        makeDistribution({ ruleId: RULE_CURRENCY_ONLY, source: { kind: 'questReward', questId: QUEST_ID }, itemIds: [ITEM_1] }),
      );
      expectReject(
        handleFinalizeAssetDistributionCollection(FINALIZE, noneState, ctx),
        'distribution.finalize.itemsNotAllowedByPolicy',
        'items with policy none',
      );
      // 物品沒有原價值 → 競拍底價無從決定。
      const unpriced = drive({ ctx, append: { itemIds: [ITEM_UNPRICED] } });
      expectReject(
        handleFinalizeAssetDistributionCollection(FINALIZE, unpriced.state, ctx),
        'distribution.finalize.itemIntrinsicValueMissing',
        'unpriced item',
      );
      // 規則定義消失（換內容包／壞存檔）。
      const noRuleCtx = makeContext({ definitions: stubDefinitionReader([]) });
      expectReject(
        handleFinalizeAssetDistributionCollection(FINALIZE, stateWith(makeDistribution()), noRuleCtx),
        'distribution.finalize.ruleDefinitionMissing',
        'rule vanished',
      );
    },
  },
  {
    name: 'Finalize（壞資料分支）：auction 設定消失 / 玩家角色不存在 / 控制者非參與者 / Companion 出價不合法',
    run: () => {
      const ctx = makeContext();
      expectReject(
        handleFinalizeAssetDistributionCollection(
          FINALIZE,
          stateWith(makeDistribution({ ruleId: RULE_AUCTION_NO_CONFIG, itemIds: [ITEM_1] })),
          ctx,
        ),
        'distribution.auction.configMissing',
        'auction config vanished',
      );
      expectReject(
        handleFinalizeAssetDistributionCollection(
          FINALIZE,
          stateWith(makeDistribution({ itemIds: [ITEM_1] })),
          makeContext({ team: TEAM_WITHOUT_CONTROLLER }),
        ),
        'distribution.auction.playerControlledCharacterMissing',
        'no controller',
      );
      expectReject(
        handleFinalizeAssetDistributionCollection(
          FINALIZE,
          stateWith(makeDistribution({ itemIds: [ITEM_1], participantCharacterIds: [ALLY_A, ALLY_B] })),
          ctx,
        ),
        'distribution.auction.controllerNotParticipant',
        'controller not participant',
      );
      expectReject(
        handleFinalizeAssetDistributionCollection(
          FINALIZE,
          stateWith(makeDistribution({ itemIds: [ITEM_1] })),
          makeContext({
            resolvers: stubResolvers({
              companionDecisions: { [String(ALLY_A)]: { kind: 'bid', amount: 1 } },
            }).port,
          }),
        ),
        'distribution.auction.companionBidInvalid',
        'companion bid below minimum',
      );
      // currentItemIndex 越界（壞存檔）。
      expectReject(
        handleFinalizeAssetDistributionCollection(
          FINALIZE,
          stateWith(makeDistribution({ itemIds: [ITEM_1], currentItemIndex: 5 })),
          ctx,
        ),
        'distribution.auction.noItemAtIndex',
        'index out of range',
      );
      // 幣別定義消失（開回合時要用最小單位驗出價）。
      expectReject(
        handleFinalizeAssetDistributionCollection(
          FINALIZE,
          stateWith(makeDistribution({ itemIds: [ITEM_1] })),
          makeContext({ economy: stubEconomy({ smallestUnits: {} }) }),
        ),
        'distribution.auction.currencyDefinitionMissing',
        'currency definition vanished',
      );
    },
  },
  {
    name: 'Finalize（rngPerItem 壞資料）：resolver 不見 / 缺原價值 / 收受者非參與者',
    run: () => {
      const npcDist = makeDistribution({ ruleId: RULE_NPC_RNG, itemIds: [ITEM_1] });
      expectReject(
        handleFinalizeAssetDistributionCollection(
          FINALIZE,
          stateWith(makeDistribution({ ruleId: RULE_NPC_NO_RESOLVER, itemIds: [ITEM_1] })),
          makeContext(),
        ),
        'distribution.npcAward.recipientResolverMissing',
        'npc resolver vanished',
      );
      expectReject(
        handleFinalizeAssetDistributionCollection(
          FINALIZE,
          stateWith(makeDistribution({ ruleId: RULE_NPC_RNG, itemIds: [ITEM_UNPRICED] })),
          makeContext(),
        ),
        'distribution.npcAward.itemIntrinsicValueMissing',
        'npc unpriced item',
      );
      expectReject(
        handleFinalizeAssetDistributionCollection(
          FINALIZE,
          stateWith(npcDist),
          makeContext({ resolvers: stubResolvers({ npcRecipients: [OUTSIDER] }).port }),
        ),
        'distribution.npcAward.recipientNotParticipant',
        'npc recipient outside snapshot',
      );
    },
  },

  // ── submitLootBid ─────────────────────────────────────────────────────────
  {
    name: 'submitLootBid：寫入玩家出價（不立即扣款），重複送則提高而不新增第二筆',
    run: () => {
      const ctx = makeContext();
      const { state } = drive({ ctx, append: { itemIds: [ITEM_1] }, finalize: true });
      const first = expectOk(
        handleSubmitLootBid(
          state,
          TEAM_ID,
          { type: 'submitLootBid', distributionId: DISTRIBUTION_ID, bidderCharacterId: HERO, itemId: ITEM_1, amount: 100 },
          ctx,
        ),
        'bid 1',
      );
      assert(first.outgoingMessages.length === 0, '出價不得立即扣款或發事件');
      const raised = expectOk(
        handleSubmitLootBid(
          first.nextSlice,
          TEAM_ID,
          { type: 'submitLootBid', distributionId: DISTRIBUTION_ID, bidderCharacterId: HERO, itemId: ITEM_1, amount: 150 },
          ctx,
        ),
        'bid 2',
      );
      const round = requireDist(raised.nextSlice).auctionRounds[0]!;
      const playerBids = round.bids.filter((b) => b.source === 'player');
      assert(playerBids.length === 1, `同角色同回合只留一筆，實得 ${playerBids.length}`);
      assert(playerBids[0]!.amount === 150, `應提高到 150，實得 ${playerBids[0]!.amount}`);
    },
  },
  {
    name: 'submitLootBid：分配／隊伍／狀態／品項的前置條件 → 各自 typed rejection',
    run: () => {
      const ctx = makeContext();
      const bid = (
        overrides: Partial<{ distributionId: AssetDistributionId; itemId: ItemInstanceId; bidderCharacterId: CharacterId; amount: number }> = {},
      ) => ({
        type: 'submitLootBid' as const,
        distributionId: DISTRIBUTION_ID,
        bidderCharacterId: HERO,
        itemId: ITEM_1,
        amount: 100,
        ...overrides,
      });
      expectReject(
        handleSubmitLootBid(emptyState(), TEAM_ID, bid(), ctx),
        'distribution.bid.distributionNotFound',
        'no distribution',
      );
      const auction = drive({ ctx, append: { itemIds: [ITEM_1] }, finalize: true });
      expectReject(
        handleSubmitLootBid(auction.state, OTHER_TEAM_ID, bid(), ctx),
        'distribution.bid.notOwnedByActorTeam',
        'wrong team',
      );
      const collecting = drive({ ctx, append: { itemIds: [ITEM_1] } });
      expectReject(
        handleSubmitLootBid(collecting.state, TEAM_ID, bid(), ctx),
        'distribution.bid.notAwaitingPlayerBid',
        'still collecting',
      );
      expectReject(
        handleSubmitLootBid(auction.state, TEAM_ID, bid({ itemId: ITEM_2 }), ctx),
        'distribution.bid.notCurrentItem',
        'not current item',
      );
      // 當前回合已結算（壞存檔：status 還停在 awaitingPlayerBid）。
      const settledRound = stateWith(
        makeDistribution({
          status: 'awaitingPlayerBid',
          itemIds: [ITEM_1],
          auctionRounds: [
            { itemId: ITEM_1, intrinsicValue: { currencyId: COIN, amount: 100 }, bids: [], state: 'awarded', winnerCharacterId: HERO },
          ],
        }),
      );
      expectReject(
        handleSubmitLootBid(settledRound, TEAM_ID, bid(), ctx),
        'distribution.bid.noOpenRound',
        'round already settled',
      );
      expectReject(
        handleSubmitLootBid(auction.state, TEAM_ID, bid(), makeContext({ definitions: stubDefinitionReader([]) })),
        'distribution.bid.ruleDefinitionMissing',
        'rule vanished',
      );
      expectReject(
        handleSubmitLootBid(
          auction.state,
          TEAM_ID,
          bid(),
          makeContext({ definitions: stubDefinitionReader([{ ...AUCTION_RULE, auction: undefined }]) }),
        ),
        'distribution.bid.auctionConfigMissing',
        'auction config vanished',
      );
    },
  },
  {
    name: 'submitLootBid：出價者資格與金額規則 → 各自 typed rejection',
    run: () => {
      const ctx = makeContext();
      const { state } = drive({ ctx, append: { itemIds: [ITEM_1] }, finalize: true });
      const bid = (
        overrides: Partial<{ bidderCharacterId: CharacterId; amount: number }> = {},
      ) => ({
        type: 'submitLootBid' as const,
        distributionId: DISTRIBUTION_ID,
        bidderCharacterId: HERO,
        itemId: ITEM_1,
        amount: 100,
        ...overrides,
      });
      expectReject(
        handleSubmitLootBid(state, TEAM_ID, bid({ bidderCharacterId: OUTSIDER }), ctx),
        'distribution.bid.bidderNotParticipant',
        'outsider',
      );
      expectReject(
        handleSubmitLootBid(state, TEAM_ID, bid({ bidderCharacterId: ALLY_A }), ctx),
        'distribution.bid.bidderNotPlayerControlled',
        'ally cannot be commanded directly',
      );
      expectReject(
        handleSubmitLootBid(state, TEAM_ID, bid(), makeContext({ team: TEAM_WITHOUT_CONTROLLER })),
        'distribution.bid.playerControlledCharacterMissing',
        'no controller',
      );
      expectReject(
        handleSubmitLootBid(state, TEAM_ID, bid({ amount: 99 }), ctx),
        'distribution.bid.belowMinimum',
        'below intrinsic value',
      );
      expectReject(
        handleSubmitLootBid(state, TEAM_ID, bid(), makeContext({ economy: stubEconomy({ smallestUnits: {} }) })),
        'distribution.bid.currencyDefinitionMissing',
        'currency definition vanished',
      );
      expectReject(
        handleSubmitLootBid(
          state,
          TEAM_ID,
          bid({ amount: 105 }),
          makeContext({ economy: stubEconomy({ smallestUnits: { [String(COIN)]: 10 } }) }),
        ),
        'distribution.bid.amountNotUnitAligned',
        'not unit aligned',
      );
      expectReject(
        handleSubmitLootBid(
          state,
          TEAM_ID,
          bid(),
          makeContext({ economy: stubEconomy({ characterAccounts: [] }) }),
        ),
        'distribution.bid.bidderAccountMissing',
        'no account',
      );
      expectReject(
        handleSubmitLootBid(
          state,
          TEAM_ID,
          bid({ amount: 900 }),
          makeContext({ economy: stubEconomy({ balances: { [String(HERO_ACCOUNT)]: 100 } }) }),
        ),
        'distribution.bid.insufficientFunds',
        'cannot afford',
      );
    },
  },

  // ── passLootItem ──────────────────────────────────────────────────────────
  {
    name: 'passLootItem：只撤玩家自己的出價，Companion 出價仍有效；重複 pass 冪等',
    run: () => {
      const resolvers = stubResolvers({ companionDecisions: { [String(ALLY_A)]: { kind: 'bid', amount: 120 } } });
      const ctx = makeContext({ resolvers: resolvers.port });
      const { state } = drive({ ctx, append: { itemIds: [ITEM_1] }, finalize: true });
      const bidded = expectOk(
        handleSubmitLootBid(
          state,
          TEAM_ID,
          { type: 'submitLootBid', distributionId: DISTRIBUTION_ID, bidderCharacterId: HERO, itemId: ITEM_1, amount: 200 },
          ctx,
        ),
        'bid',
      ).nextSlice;
      const passed = expectOk(
        handlePassLootItem(
          bidded,
          TEAM_ID,
          { type: 'passLootItem', distributionId: DISTRIBUTION_ID, bidderCharacterId: HERO, itemId: ITEM_1 },
          ctx,
        ),
        'pass',
      );
      const round = requireDist(passed.nextSlice).auctionRounds[0]!;
      assert(round.bids.length === 1, `應只剩 Companion 那一筆，實得 ${round.bids.length}`);
      assert(round.bids[0]!.source === 'companionResolver', 'Companion 出價應保留');
      // 再 pass 一次：沒有可撤的出價，出價集合不變（冪等，非碰巧）。
      const again = expectOk(
        handlePassLootItem(
          passed.nextSlice,
          TEAM_ID,
          { type: 'passLootItem', distributionId: DISTRIBUTION_ID, bidderCharacterId: HERO, itemId: ITEM_1 },
          ctx,
        ),
        'pass again',
      );
      const roundAgain = requireDist(again.nextSlice).auctionRounds[0]!;
      assert(roundAgain.bids.length === 1, '重複 pass 不應再改變出價集合');
      assert(again.outgoingMessages.length === 0, '重複 pass 不應產生訊息');
    },
  },
  {
    name: 'passLootItem：非參與者 / 非玩家控制角色 / 沒有玩家控制角色 → 各自 typed rejection',
    run: () => {
      const ctx = makeContext();
      const { state } = drive({ ctx, append: { itemIds: [ITEM_1] }, finalize: true });
      const pass = (bidderCharacterId: CharacterId) => ({
        type: 'passLootItem' as const,
        distributionId: DISTRIBUTION_ID,
        bidderCharacterId,
        itemId: ITEM_1,
      });
      expectReject(
        handlePassLootItem(state, TEAM_ID, pass(OUTSIDER), ctx),
        'distribution.pass.bidderNotParticipant',
        'outsider',
      );
      expectReject(
        handlePassLootItem(state, TEAM_ID, pass(ALLY_A), ctx),
        'distribution.pass.bidderNotPlayerControlled',
        'ally',
      );
      expectReject(
        handlePassLootItem(state, TEAM_ID, pass(HERO), makeContext({ team: TEAM_WITHOUT_CONTROLLER })),
        'distribution.pass.playerControlledCharacterMissing',
        'no controller',
      );
      expectReject(
        handlePassLootItem(emptyState(), TEAM_ID, pass(HERO), ctx),
        'distribution.pass.distributionNotFound',
        'no distribution',
      );
    },
  },

  // ── resolveLootAuctionRound ───────────────────────────────────────────────
  {
    name: 'resolveLootAuctionRound：最高出價得標 → 付款進清算帳戶 + Item 轉給得標者 + LootItemAwarded，並開下一回合',
    run: () => {
      const resolvers = stubResolvers({ companionDecisions: { [String(ALLY_A)]: { kind: 'bid', amount: 120 } } });
      const ctx = makeContext({ resolvers: resolvers.port });
      const { state } = drive({ ctx, append: { itemIds: [ITEM_1, ITEM_2] }, finalize: true });
      const bidded = expectOk(
        handleSubmitLootBid(
          state,
          TEAM_ID,
          { type: 'submitLootBid', distributionId: DISTRIBUTION_ID, bidderCharacterId: HERO, itemId: ITEM_1, amount: 200 },
          ctx,
        ),
        'bid',
      ).nextSlice;
      const r = expectOk(
        handleResolveLootAuctionRound(
          bidded,
          TEAM_ID,
          { type: 'resolveLootAuctionRound', distributionId: DISTRIBUTION_ID, itemId: ITEM_1 },
          ctx,
        ),
        'resolve',
      );
      const payment = transfersOf(r.outgoingMessages);
      assert(payment.length === 1, `應恰一筆付款，實得 ${payment.length}`);
      assert(
        payment[0]!.fromAccountId === HERO_ACCOUNT && payment[0]!.toAccountId === ESCROW_ACCOUNT,
        '得標者個人帳戶 → 清算帳戶',
      );
      assert(payment[0]!.amount === 200, '付款金額等於得標價');
      const item = commandsOf(r.outgoingMessages).filter((c): c is TransferItem => c.type === 'TransferItem');
      assert(item.length === 1 && item[0]!.newOwnerCharacterId === HERO, 'Item Owner 應改為得標者');
      const awarded = findEvent(eventsOf(r.outgoingMessages), 'LootItemAwarded');
      assert(awarded !== undefined && awarded.winningBid === 200, '應發 LootItemAwarded(200)');
      // 仍有第二件 → 開下一回合，尚未完成。
      const dist = requireDist(r.nextSlice);
      assert(dist.currentItemIndex === 1, `currentItemIndex 應為 1，實得 ${dist.currentItemIndex}`);
      assert(dist.status === 'awaitingPlayerBid', '仍應等待玩家（下一件）');
      assert(dist.pendingInteraction?.itemId === ITEM_2, 'pending 應指向第二件');
      assert(
        findEvent(eventsOf(r.outgoingMessages), 'AssetDistributionCompleted') === undefined,
        '尚未處置完所有品項，不得發 Completed',
      );
      assert(
        findEvent(eventsOf(r.outgoingMessages), 'LootAuctionRoundOpened') !== undefined,
        '應為下一件開新回合',
      );
    },
  },
  {
    name: 'resolveLootAuctionRound：無有效出價 → 八折直售、移除實體、款項進清算帳戶',
    run: () => {
      const ctx = makeContext();
      const { state } = drive({ ctx, append: { itemIds: [ITEM_1] }, finalize: true });
      const r = expectOk(
        handleResolveLootAuctionRound(
          state,
          TEAM_ID,
          { type: 'resolveLootAuctionRound', distributionId: DISTRIBUTION_ID, itemId: ITEM_1 },
          ctx,
        ),
        'resolve',
      );
      const sold = findEvent(eventsOf(r.outgoingMessages), 'LootItemDirectSold');
      // 不變量 5：floor(100 × 0.8) = 80，倍率取自 Rule。
      assert(sold !== undefined && sold.saleValue.amount === 80, `直售價應為 80，實得 ${String(sold?.saleValue.amount)}`);
      const removals = commandsOf(r.outgoingMessages).filter(
        (c): c is RemoveItemInstance => c.type === 'RemoveItemInstance',
      );
      assert(removals.length === 1 && removals[0]!.itemId === ITEM_1, '流標物應被移除');
      const inbound = transfersOf(r.outgoingMessages).filter((t) => t.toAccountId === ESCROW_ACCOUNT);
      assert(inbound.length === 1 && inbound[0]!.fromAccountId === DIRECT_SALE_ACCOUNT, '直售款來自 lootDirectSaleSource');
      assert(inbound[0]!.amount === 80, '直售款應為 80');
      // 最後一件 → 完成並均分。
      const completed = findEvent(eventsOf(r.outgoingMessages), 'AssetDistributionCompleted');
      assert(completed !== undefined, '最後一件處置完應發 AssetDistributionCompleted');
      const outbound = transfersOf(r.outgoingMessages).filter((t) => t.fromAccountId === ESCROW_ACCOUNT);
      const total = outbound.reduce((sum, t) => sum + t.amount, 0);
      assert(total === 80, `不變量 7：清算帳戶應歸零，實際出帳 ${total}`);
      const dist = requireDist(r.nextSlice);
      assert(dist.status === 'completed', 'status 應為 completed');
      assert(dist.pendingInteraction === undefined, '完成後 pendingInteraction 必須清除');
      assert(dist.auctionRounds.every((round) => round.state !== 'open'), '不變量 4：每件至多結算一次且不留 open');
    },
  },
  {
    name: 'resolveLootAuctionRound：同額最高依 distributionId+itemId+characterId 固定排序，不重骰',
    run: () => {
      const resolvers = stubResolvers({
        companionDecisions: {
          [String(ALLY_A)]: { kind: 'bid', amount: 150 },
          [String(ALLY_B)]: { kind: 'bid', amount: 150 },
        },
      });
      const ctx = makeContext({ resolvers: resolvers.port });
      const { state } = drive({ ctx, append: { itemIds: [ITEM_1] }, finalize: true });
      const r = expectOk(
        handleResolveLootAuctionRound(
          state,
          TEAM_ID,
          { type: 'resolveLootAuctionRound', distributionId: DISTRIBUTION_ID, itemId: ITEM_1 },
          ctx,
        ),
        'resolve',
      );
      const awarded = findEvent(eventsOf(r.outgoingMessages), 'LootItemAwarded');
      // key = `dist-1|item-1|char-ally-a` < `dist-1|item-1|char-ally-b`
      assert(
        awarded !== undefined && awarded.winnerCharacterId === ALLY_A,
        `平手應由固定排序決定（ALLY_A），實得 ${String(awarded?.winnerCharacterId)}`,
      );
      assert(
        resolvers.companionCursors.length === 2 &&
          resolvers.companionCursors[0] === 0 &&
          resolvers.companionCursors[1] === 1,
        `Companion cursor 應逐次前進 [0,1]，實得 [${resolvers.companionCursors.join(',')}]`,
      );
    },
  },
  {
    name: 'resolveLootAuctionRound：結算時最高出價者餘額不足 → 該筆失效，取下一筆有效出價',
    run: () => {
      const resolvers = stubResolvers({
        companionDecisions: {
          [String(ALLY_A)]: { kind: 'bid', amount: 500 },
          [String(ALLY_B)]: { kind: 'bid', amount: 120 },
        },
      });
      // ALLY_A 出 500 但只有 100：該筆失效。
      const ctx = makeContext({
        resolvers: resolvers.port,
        economy: stubEconomy({
          balances: { ...DEFAULT_BALANCES, [String(ALLY_A_ACCOUNT)]: 100 },
        }),
      });
      const { state } = drive({ ctx, append: { itemIds: [ITEM_1] }, finalize: true });
      const r = expectOk(
        handleResolveLootAuctionRound(
          state,
          TEAM_ID,
          { type: 'resolveLootAuctionRound', distributionId: DISTRIBUTION_ID, itemId: ITEM_1 },
          ctx,
        ),
        'resolve',
      );
      const awarded = findEvent(eventsOf(r.outgoingMessages), 'LootItemAwarded');
      assert(
        awarded !== undefined && awarded.winnerCharacterId === ALLY_B && awarded.winningBid === 120,
        `應由次高有效出價得標（ALLY_B/120），實得 ${String(awarded?.winnerCharacterId)}/${String(awarded?.winningBid)}`,
      );
      const payment = transfersOf(r.outgoingMessages).filter((t) => t.toAccountId === ESCROW_ACCOUNT);
      assert(payment[0]!.fromAccountId === ALLY_B_ACCOUNT, '付款應由實際得標者支出');
    },
  },
  {
    name: 'resolveLootAuctionRound：清算帳戶未建立 / 得標者無帳戶 / 直售來源帳戶不存在 / 幣別定義消失 → 各自 typed rejection',
    run: () => {
      const resolve = {
        type: 'resolveLootAuctionRound' as const,
        distributionId: DISTRIBUTION_ID,
        itemId: ITEM_1,
      };
      const baseCtx = makeContext();
      const { state } = drive({ ctx: baseCtx, append: { itemIds: [ITEM_1] }, finalize: true });

      expectReject(
        handleResolveLootAuctionRound(
          state,
          TEAM_ID,
          resolve,
          makeContext({ economy: stubEconomy({ smallestUnits: {} }) }),
        ),
        'distribution.resolveRound.currencyDefinitionMissing',
        'currency definition vanished',
      );
      expectReject(
        handleResolveLootAuctionRound(
          state,
          TEAM_ID,
          resolve,
          makeContext({ economy: stubEconomy({ settlementAccounts: [] }) }),
        ),
        'distribution.settle.settlementAccountMissing',
        'escrow not created yet',
      );
      expectReject(
        handleResolveLootAuctionRound(
          state,
          TEAM_ID,
          resolve,
          makeContext({
            economy: stubEconomy({
              systemAccounts: DEFAULT_SYSTEM_ACCOUNTS.filter((a) => a.purpose !== 'lootDirectSaleSource'),
            }),
          }),
        ),
        'distribution.resolveRound.directSaleSourceAccountMissing',
        'direct sale source missing',
      );
      // 得標者在結算時查不到帳戶：canAfford 用得到帳戶、findCharacterAccount 卻回 undefined 的
      // 情形只可能來自不一致的 economy 投影，這裡以「餘額表有、帳戶表無」模擬。
      const bidded = expectOk(
        handleSubmitLootBid(
          state,
          TEAM_ID,
          { type: 'submitLootBid', distributionId: DISTRIBUTION_ID, bidderCharacterId: HERO, itemId: ITEM_1, amount: 200 },
          baseCtx,
        ),
        'bid',
      ).nextSlice;
      const base = stubEconomy();
      let calls = 0;
      const inconsistent: ReturnType<typeof stubEconomy> = {
        ...base,
        findCharacterAccount(characterId: CharacterId, currencyId: CurrencyId) {
          // pickWinningBid 看得到帳戶（可負擔），winnerAccount 查詢卻查不到。
          calls += 1;
          if (calls > 1) return undefined;
          return base.findCharacterAccount(characterId, currencyId);
        },
      };
      expectReject(
        handleResolveLootAuctionRound(bidded, TEAM_ID, resolve, makeContext({ economy: inconsistent })),
        'distribution.resolveRound.winnerAccountMissing',
        'winner account vanished',
      );
    },
  },
  {
    name: 'resolveLootAuctionRound：前置條件（隊伍／狀態／品項／規則）→ 各自 typed rejection',
    run: () => {
      const ctx = makeContext();
      const resolve = (itemId: ItemInstanceId = ITEM_1) => ({
        type: 'resolveLootAuctionRound' as const,
        distributionId: DISTRIBUTION_ID,
        itemId,
      });
      const { state } = drive({ ctx, append: { itemIds: [ITEM_1] }, finalize: true });
      expectReject(
        handleResolveLootAuctionRound(emptyState(), TEAM_ID, resolve(), ctx),
        'distribution.resolveRound.distributionNotFound',
        'no distribution',
      );
      expectReject(
        handleResolveLootAuctionRound(state, OTHER_TEAM_ID, resolve(), ctx),
        'distribution.resolveRound.notOwnedByActorTeam',
        'wrong team',
      );
      expectReject(
        handleResolveLootAuctionRound(state, TEAM_ID, resolve(ITEM_2), ctx),
        'distribution.resolveRound.notCurrentItem',
        'not current item',
      );
      expectReject(
        handleResolveLootAuctionRound(
          drive({ ctx, append: { itemIds: [ITEM_1] } }).state,
          TEAM_ID,
          resolve(),
          ctx,
        ),
        'distribution.resolveRound.notAwaitingPlayerBid',
        'still collecting',
      );
      expectReject(
        handleResolveLootAuctionRound(
          state,
          TEAM_ID,
          resolve(),
          makeContext({ definitions: stubDefinitionReader([]) }),
        ),
        'distribution.resolveRound.ruleDefinitionMissing',
        'rule vanished',
      );
      expectReject(
        handleResolveLootAuctionRound(
          state,
          TEAM_ID,
          resolve(),
          makeContext({ definitions: stubDefinitionReader([{ ...AUCTION_RULE, auction: undefined }]) }),
        ),
        'distribution.resolveRound.auctionConfigMissing',
        'auction config vanished',
      );
      expectReject(
        handleResolveLootAuctionRound(
          stateWith(
            makeDistribution({
              status: 'awaitingPlayerBid',
              itemIds: [ITEM_1],
              auctionRounds: [
                { itemId: ITEM_1, intrinsicValue: { currencyId: COIN, amount: 100 }, bids: [], state: 'directSold' },
              ],
            }),
          ),
          TEAM_ID,
          resolve(),
          ctx,
        ),
        'distribution.resolveRound.noOpenRound',
        'round already settled',
      );
    },
  },

  {
    name: '三個玩家 Command 共用同一組前置檢查：各自帶自己的 code 前綴',
    run: () => {
      const ctx = makeContext();
      const auction = drive({ ctx, append: { itemIds: [ITEM_1] }, finalize: true });
      const collecting = drive({ ctx, append: { itemIds: [ITEM_1] } });
      const noRuleCtx = makeContext({ definitions: stubDefinitionReader([]) });
      const noAuctionCtx = makeContext({
        definitions: stubDefinitionReader([{ ...AUCTION_RULE, auction: undefined }]),
      });
      const settled = stateWith(
        makeDistribution({
          status: 'awaitingPlayerBid',
          itemIds: [ITEM_1],
          auctionRounds: [
            { itemId: ITEM_1, intrinsicValue: { currencyId: COIN, amount: 100 }, bids: [], state: 'awarded', winnerCharacterId: HERO },
          ],
        }),
      );

      const entries: readonly Readonly<{
        prefix: string;
        call: (
          state: AssetDistributionModuleState,
          teamId: typeof TEAM_ID,
          itemId: ItemInstanceId,
          c: AssetDistributionHandlerContext,
        ) => AssetDistributionHandlerResult;
      }>[] = [
        {
          prefix: 'distribution.bid',
          call: (s, t, itemId, c) =>
            handleSubmitLootBid(
              s,
              t,
              { type: 'submitLootBid', distributionId: DISTRIBUTION_ID, bidderCharacterId: HERO, itemId, amount: 100 },
              c,
            ),
        },
        {
          prefix: 'distribution.pass',
          call: (s, t, itemId, c) =>
            handlePassLootItem(
              s,
              t,
              { type: 'passLootItem', distributionId: DISTRIBUTION_ID, bidderCharacterId: HERO, itemId },
              c,
            ),
        },
        {
          prefix: 'distribution.resolveRound',
          call: (s, t, itemId, c) =>
            handleResolveLootAuctionRound(
              s,
              t,
              { type: 'resolveLootAuctionRound', distributionId: DISTRIBUTION_ID, itemId },
              c,
            ),
        },
      ];

      for (const entry of entries) {
        expectReject(entry.call(emptyState(), TEAM_ID, ITEM_1, ctx), `${entry.prefix}.distributionNotFound`, entry.prefix);
        expectReject(entry.call(auction.state, OTHER_TEAM_ID, ITEM_1, ctx), `${entry.prefix}.notOwnedByActorTeam`, entry.prefix);
        expectReject(entry.call(collecting.state, TEAM_ID, ITEM_1, ctx), `${entry.prefix}.notAwaitingPlayerBid`, entry.prefix);
        expectReject(entry.call(settled, TEAM_ID, ITEM_1, ctx), `${entry.prefix}.noOpenRound`, entry.prefix);
        expectReject(entry.call(auction.state, TEAM_ID, ITEM_2, ctx), `${entry.prefix}.notCurrentItem`, entry.prefix);
        expectReject(entry.call(auction.state, TEAM_ID, ITEM_1, noRuleCtx), `${entry.prefix}.ruleDefinitionMissing`, entry.prefix);
        expectReject(entry.call(auction.state, TEAM_ID, ITEM_1, noAuctionCtx), `${entry.prefix}.auctionConfigMissing`, entry.prefix);
      }
    },
  },
  {
    name: '開下一回合時物品原價值消失（換內容包）→ distribution.auction.itemIntrinsicValueMissing',
    run: () => {
      const ctx = makeContext();
      const { state } = drive({ ctx, append: { itemIds: [ITEM_1, ITEM_2] }, finalize: true });
      // 第二件的原價值在下一筆交易前消失：開下一回合時要明確拒絕，不能拿假底價開拍。
      const shrunk = makeContext({
        inventory: stubInventory([{ itemId: ITEM_1, value: { currencyId: COIN, amount: 100 } }]),
      });
      expectReject(
        handleResolveLootAuctionRound(
          state,
          TEAM_ID,
          { type: 'resolveLootAuctionRound', distributionId: DISTRIBUTION_ID, itemId: ITEM_1 },
          shrunk,
        ),
        'distribution.auction.itemIntrinsicValueMissing',
        'next round unpriced',
      );
    },
  },
  {
    name: 'ID 配發：每個競拍回合鑄一個 InteractionId，每筆轉帳鑄一個 EconomyTransferId',
    run: () => {
      const ids = stubIds();
      const ctx = makeContext({ ids: ids.allocator });
      const { state } = drive({
        ctx,
        append: { itemIds: [ITEM_1], currencyInputs: [{ currencyId: COIN, amount: 30 }] },
        finalize: true,
      });
      assert(ids.interactionIds.length === 1, `應鑄 1 個 InteractionId，實得 ${ids.interactionIds.length}`);
      assert(
        requireDist(state).pendingInteraction?.interactionId === ids.interactionIds[0],
        'pendingInteraction 應使用配發到的 InteractionId',
      );
      const r = expectOk(
        handleResolveLootAuctionRound(
          state,
          TEAM_ID,
          { type: 'resolveLootAuctionRound', distributionId: DISTRIBUTION_ID, itemId: ITEM_1 },
          ctx,
        ),
        'resolve',
      );
      const transfers = transfersOf(r.outgoingMessages);
      const unique = new Set(transfers.map((t) => String(t.transferId)));
      assert(unique.size === transfers.length, '每筆轉帳的冪等鍵必須各不相同');
      assert(transfers.length === ids.transferIds.length, '轉帳筆數應等於配發的 transferId 數');
    },
  },

  // ── 結算（settle）的壞資料分支 ────────────────────────────────────────────
  {
    name: 'settle：參與者為空 / 總額非最小單位倍數 / 幣別定義消失 / 角色無帳戶 / 入帳來源缺失 → 各自 typed rejection',
    run: () => {
      const currencyOnly = (overrides: Partial<AssetDistribution> = {}) =>
        stateWith(
          makeDistribution({
            ruleId: RULE_CURRENCY_ONLY,
            source: { kind: 'questReward', questId: QUEST_ID },
            currencyInputs: [{ currencyId: COIN, amount: 100 }],
            ...overrides,
          }),
        );
      expectReject(
        handleFinalizeAssetDistributionCollection(
          FINALIZE,
          currencyOnly({ participantCharacterIds: [] }),
          makeContext(),
        ),
        'distribution.settle.participantsEmpty',
        'empty snapshot from bad save',
      );
      expectReject(
        handleFinalizeAssetDistributionCollection(
          FINALIZE,
          currencyOnly(),
          makeContext({ economy: stubEconomy({ smallestUnits: {} }) }),
        ),
        'distribution.settle.currencyDefinitionMissing',
        'currency definition vanished',
      );
      expectReject(
        handleFinalizeAssetDistributionCollection(
          FINALIZE,
          currencyOnly({ currencyInputs: [{ currencyId: COIN, amount: 105 }] }),
          makeContext({ economy: stubEconomy({ smallestUnits: { [String(COIN)]: 10 } }) }),
        ),
        'distribution.settle.totalNotUnitAligned',
        'total not unit aligned',
      );
      expectReject(
        handleFinalizeAssetDistributionCollection(
          FINALIZE,
          currencyOnly(),
          makeContext({ economy: stubEconomy({ characterAccounts: [] }) }),
        ),
        'distribution.settle.characterAccountMissing',
        'character account missing',
      );
      expectReject(
        handleFinalizeAssetDistributionCollection(
          FINALIZE,
          currencyOnly(),
          makeContext({
            economy: stubEconomy({
              systemAccounts: DEFAULT_SYSTEM_ACCOUNTS.filter((a) => a.purpose !== 'questRewards'),
            }),
          }),
        ),
        'distribution.settle.inputSourceAccountMissing',
        'quest reward source missing',
      );
      // 壞存檔：expiredQuestCargo 卻帶著貨幣（Append 攔得住，載入的舊檔攔不住）。
      expectReject(
        handleFinalizeAssetDistributionCollection(
          FINALIZE,
          stateWith(
            makeDistribution({
              ruleId: RULE_QUEST_AUCTION,
              source: { kind: 'expiredQuestCargo', questId: QUEST_ID },
              currencyInputs: [{ currencyId: COIN, amount: 30 }],
            }),
          ),
          makeContext(),
        ),
        'distribution.settle.currencyInputSourceUnsupported',
        'cargo currency from bad save',
      );
      // 壞內容：已直售的回合，規則卻沒有 auction 區塊（直售價無從導出）。
      expectReject(
        handleFinalizeAssetDistributionCollection(
          FINALIZE,
          stateWith(
            makeDistribution({
              ruleId: RULE_CURRENCY_ONLY,
              source: { kind: 'questReward', questId: QUEST_ID },
              auctionRounds: [
                { itemId: ITEM_1, intrinsicValue: { currencyId: COIN, amount: 100 }, bids: [], state: 'directSold' },
              ],
            }),
          ),
          makeContext(),
        ),
        'distribution.settle.auctionConfigMissing',
        'direct sold without auction config',
      );
    },
  },

  // ── Query ─────────────────────────────────────────────────────────────────
  {
    name: 'Query：getDistribution 投影不含 rngContext／settlementAccountIds；pending 與當前回合可讀',
    run: () => {
      const resolvers = stubResolvers({ companionDecisions: { [String(ALLY_A)]: { kind: 'bid', amount: 120 } } });
      const ctx = makeContext({ resolvers: resolvers.port });
      const { state } = drive({ ctx, append: { itemIds: [ITEM_1, ITEM_2] }, finalize: true });
      const query = createAssetDistributionQuery(state);
      const view = query.getDistribution(DISTRIBUTION_ID);
      assert(!('rngContext' in view), 'View 不得公開 rngContext');
      assert(!('settlementAccountIds' in view), 'View 不得公開 settlementAccountIds');
      assert(view.status === 'awaitingPlayerBid', 'View 應反映狀態');
      assert(view.pendingInteraction?.itemId === ITEM_1, 'View 應帶 pendingInteraction');

      const pending = query.getPendingPlayerDistribution(TEAM_ID);
      assert(pending !== undefined, 'UI 應能取得「現在等玩家出價」的分配');
      assert(pending!.currentRound?.itemId === ITEM_1, 'currentRound 應為當前品項');
      assert(pending!.currentRound?.bids.length === 1, 'currentRound 應含 Companion 出價');
      assert(query.getPendingPlayerDistribution(OTHER_TEAM_ID) === undefined, '別的隊伍沒有待互動');

      const round = query.getCurrentAuctionRound(DISTRIBUTION_ID);
      assert(round?.itemId === ITEM_1, 'getCurrentAuctionRound 應為當前品項');
      assert(
        query.getCurrentAuctionRound(OTHER_DISTRIBUTION_ID) === undefined,
        '不存在的分配應回 undefined 而非拋錯',
      );
      assert(isAwaitingPlayerBid(state, DISTRIBUTION_ID), 'isAwaitingPlayerBid 應為 true');
      assert(!isAwaitingPlayerBid(state, OTHER_DISTRIBUTION_ID), '不存在的分配不算等待中');
    },
  },
  {
    name: 'Query：完成後不再有待玩家互動（返城屏障可以解除）',
    run: () => {
      const ctx = makeContext();
      const { state } = drive({ ctx, append: { itemIds: [ITEM_1] }, finalize: true });
      const resolved = expectOk(
        handleResolveLootAuctionRound(
          state,
          TEAM_ID,
          { type: 'resolveLootAuctionRound', distributionId: DISTRIBUTION_ID, itemId: ITEM_1 },
          ctx,
        ),
        'resolve',
      ).nextSlice;
      const query = createAssetDistributionQuery(resolved);
      assert(
        query.getPendingPlayerDistribution(TEAM_ID) === undefined,
        '完成後不得再有 pending 互動',
      );
      assert(query.getDistribution(DISTRIBUTION_ID).status === 'completed', 'status 應為 completed');
    },
  },
  {
    name: 'Query：多筆等待中的分配依 distributionId 字典序取第一筆（決定性）',
    run: () => {
      const pending = (id: AssetDistributionId): AssetDistribution =>
        makeDistribution({
          distributionId: id,
          status: 'awaitingPlayerBid',
          itemIds: [ITEM_1],
          auctionRounds: [
            {
              itemId: ITEM_1,
              intrinsicValue: { currencyId: COIN, amount: 100 },
              bids: [],
              state: 'open',
            },
          ],
          pendingInteraction: {
            interactionId: `interaction-${String(id)}` as InteractionId,
            kind: 'lootAuction',
            itemId: ITEM_1,
            openedOnDay: WORLD_DAY,
            revision: 0 as Revision,
          },
        });
      const state = stateWith(pending(OTHER_DISTRIBUTION_ID), pending(DISTRIBUTION_ID));
      const first = createAssetDistributionQuery(state).getPendingPlayerDistribution(TEAM_ID);
      assert(
        first?.distributionId === DISTRIBUTION_ID,
        `應取字典序第一筆（${String(DISTRIBUTION_ID)}），實得 ${String(first?.distributionId)}`,
      );
    },
  },
  {
    name: '不變量：地牢金幣 + 競拍款一起均分，清算帳戶收支相抵',
    run: () => {
      const ctx = makeContext();
      const { state } = drive({
        ctx,
        append: { itemIds: [ITEM_1], currencyInputs: [{ currencyId: COIN, amount: 61 }] },
        finalize: true,
      });
      const bidded = expectOk(
        handleSubmitLootBid(
          state,
          TEAM_ID,
          { type: 'submitLootBid', distributionId: DISTRIBUTION_ID, bidderCharacterId: HERO, itemId: ITEM_1, amount: 100 },
          ctx,
        ),
        'bid',
      ).nextSlice;
      const r = expectOk(
        handleResolveLootAuctionRound(
          bidded,
          TEAM_ID,
          { type: 'resolveLootAuctionRound', distributionId: DISTRIBUTION_ID, itemId: ITEM_1 },
          ctx,
        ),
        'resolve',
      );
      const transfers = transfersOf(r.outgoingMessages);
      const inbound = transfers.filter((t) => t.toAccountId === ESCROW_ACCOUNT);
      const outbound = transfers.filter((t) => t.fromAccountId === ESCROW_ACCOUNT);
      const inTotal = inbound.reduce((s, t) => s + t.amount, 0);
      const outTotal = outbound.reduce((s, t) => s + t.amount, 0);
      assert(inTotal === 161, `入帳應為 61 + 100 = 161，實得 ${inTotal}`);
      assert(outTotal === 161, `不變量 7：出帳必須等於入帳，實得 ${outTotal}`);
      assert(
        inbound.some((t) => t.fromAccountId === DUNGEON_GOLD_ACCOUNT && t.amount === 61),
        '地牢金幣應由 dungeonGoldSource 入帳',
      );
      const completed = findEvent(eventsOf(r.outgoingMessages), 'AssetDistributionCompleted');
      assert(completed !== undefined && completed.itemAwards.length === 1, 'itemAwards 應含得標紀錄');
      assert(
        completed!.currencyAwards.every((a) => DEFAULT_CHARACTER_ACCOUNTS.some((c) => c.characterId === a.characterId)),
        '不變量 2：所有最終貨幣只進 Character Account',
      );
    },
  },
];

export type DistributionTestResult = Readonly<{ name: string; pass: boolean; error?: string }>;

export function runTestResults(): readonly DistributionTestResult[] {
  return CASES.map((c) => {
    try {
      c.run();
      return { name: c.name, pass: true };
    } catch (e) {
      return { name: c.name, pass: false, error: e instanceof Error ? e.message : String(e) };
    }
  });
}

export function runTests(): void {
  const results = runTestResults();
  const failed = results.filter((r) => !r.pass);
  if (failed.length > 0) {
    const lines = failed.map((r) => `  - ${r.name}: ${r.error ?? ''}`).join('\n');
    throw new Error(`distribution tests failed (${failed.length}/${results.length}):\n${lines}`);
  }
}
