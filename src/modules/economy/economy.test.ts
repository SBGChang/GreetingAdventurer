// modules/economy/economy.test.ts
// 自足式單元測試（無 node:test / console / DOM 全域）。
// runTests() 執行全部案例；任一失敗即 throw，供最外層 harness 判定。
//
// 覆蓋要求：每個登記進 ModuleContract 的 Handler 至少一個 accept；每一種 typed rejection 至少一個
// 案例；每一條宣稱的不變量至少一個案例；契約明訂的冪等 no-op 有測試釘住它是冪等而非碰巧沒變。
// Economy 沒有 RNG 路徑（餘數分配屬 distribution 模組），故無 RNG 決定性案例。

import type {
  CharacterId,
  EconomyAccountId,
  Revision,
  TransactionMessageDraft,
} from '../../contracts/core';
import type {
  CreateEconomyAccountCommand,
  EconomyDomainEvent,
  EconomyState,
  GrantCurrencyCommand,
  PriceQuote,
  RemoveCurrencyCommand,
  TransferCurrencyCommand,
} from '../../contracts/economy';
import type { MarketPressureChanged } from '../../contracts/world';
import type { CharacterReputationChangedEvent } from '../../contracts/character';
import type { PlayerAffinityChangedPayload } from '../../contracts/social';

import type { EconomyHandlerResult } from './system';
import {
  ECONOMY_MODULE_ID,
  handleCreateEconomyAccount,
  handleGrantCurrency,
  handleRemoveCurrency,
  handleTransferCurrency,
  onCharacterReputationChanged,
  onMarketPressureChanged,
  onPlayerAffinityChanged,
  systemAccountOwner,
} from './system';
import { createEconomyQuery, isPriceQuoteCurrent } from './queries';
import {
  epochOf,
  findCharacterAccountId,
  priceScopeKeyFor,
  requireAccount,
  tryGetAccount,
  tryGetTransfer,
} from './state';
import {
  ACC_ABSENT,
  ACC_BUYER,
  ACC_CITY,
  ACC_DISTRIBUTION,
  ACC_DUNGEON_SOURCE,
  ACC_NEW,
  ACC_POOR,
  ACC_SELLER,
  ACC_SILVER,
  BASE_VALUE,
  BUYER,
  BUYER_START_BALANCE,
  CITY,
  DISABLED_CURRENCY,
  DISTRIBUTION,
  GOLD,
  GRANT_1,
  HOME_TUTOR_MODIFIER,
  ITEM,
  ITEM_REVISION,
  MINIMUM_PRICE_FLOOR,
  MOD_AFFINITY,
  MOD_STRONGEST_BIG,
  MOD_STRONGEST_SMALL,
  MOD_TRADE_BONUS,
  MOD_WAR_SURCHARGE,
  OFFER,
  OFFER_ABSENT,
  OFFER_MINIMUM,
  OFFER_REVISION,
  OFFER_STRONGEST,
  OFFER_UNRESOLVABLE,
  POOR,
  REMOVE_1,
  REWARD_DISABLED,
  REWARD_DUNGEON_GOLD,
  REWARD_GOLD_AMOUNT,
  REWARD_NON_INTEGER,
  REWARD_UNRESOLVABLE,
  REWARD_WRONG_CURRENCY,
  SELLER,
  SELLER_START_BALANCE,
  SERVICE_BASE_VALUE,
  SERVICE_DEF,
  SERVICE_REVISION,
  SILVER,
  SOURCE_REF,
  STRANGER,
  STRONGEST_BASE_VALUE,
  TRADE_BONUS_BUYER,
  TRADE_BONUS_SELLER,
  TRANSFER_1,
  TRANSFER_2,
  TUTOR,
  UNKNOWN_CURRENCY,
  UNKNOWN_REWARD_RULE,
  WORLD_DAY,
  fixtureEconomyState,
  makeHandlerContext,
  makeQueryContext,
} from './fixtures';

// ── 迷你斷言工具 ─────────────────────────────────────────────────────────────

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

function eventsOf(messages: readonly TransactionMessageDraft[]): EconomyDomainEvent[] {
  return messages
    .filter((m): m is { event: unknown } => 'event' in m)
    .map((m) => m.event as EconomyDomainEvent);
}

function findEvent<K extends EconomyDomainEvent['type']>(
  events: readonly EconomyDomainEvent[],
  type: K,
): Extract<EconomyDomainEvent, { type: K }> | undefined {
  return events.find((e) => e.type === type) as Extract<EconomyDomainEvent, { type: K }> | undefined;
}

function expectOk(r: EconomyHandlerResult, label: string) {
  if (!r.ok) throw new Error(`${label}: expected accept, got reject '${r.rejection.code}'`);
  return r.result;
}

function expectReject(r: EconomyHandlerResult, code: string, label: string) {
  if (r.ok) throw new Error(`${label}: expected reject '${code}', got accept`);
  assert(
    r.rejection.code === code,
    `${label}: expected code '${code}', got '${r.rejection.code}'`,
  );
  assert(
    r.rejection.source === ECONOMY_MODULE_ID,
    `${label}: rejection source should be the economy module`,
  );
}

function expectThrows(run: () => unknown, label: string): void {
  let threw = false;
  try {
    run();
  } catch {
    threw = true;
  }
  assert(threw, `${label}: expected a thrown error`);
}

function balanceOf(state: EconomyState, accountId: EconomyAccountId): number {
  return requireAccount(state, accountId).balance;
}

// ── 命令建構輔助 ─────────────────────────────────────────────────────────────

function transfer(
  overrides: Partial<TransferCurrencyCommand> = {},
): TransferCurrencyCommand {
  return {
    type: 'TransferCurrency',
    transferId: TRANSFER_1,
    fromAccountId: ACC_BUYER,
    toAccountId: ACC_SELLER,
    currencyId: GOLD,
    amount: 100,
    reason: 'shopPurchase',
    sourceId: SOURCE_REF,
    ...overrides,
  };
}

function grant(overrides: Partial<GrantCurrencyCommand> = {}): GrantCurrencyCommand {
  return {
    type: 'GrantCurrency',
    transferId: GRANT_1,
    toAccountId: ACC_DISTRIBUTION,
    rewardRuleId: REWARD_DUNGEON_GOLD,
    reason: 'dungeonGold',
    sourceId: SOURCE_REF,
    ...overrides,
  };
}

function remove(overrides: Partial<RemoveCurrencyCommand> = {}): RemoveCurrencyCommand {
  return {
    type: 'RemoveCurrency',
    transferId: REMOVE_1,
    fromAccountId: ACC_BUYER,
    currencyId: GOLD,
    amount: 60,
    reason: 'facilityFee',
    sourceId: SOURCE_REF,
    ...overrides,
  };
}

function createAccount(
  overrides: Partial<CreateEconomyAccountCommand> = {},
): CreateEconomyAccountCommand {
  return {
    type: 'CreateEconomyAccount',
    owner: { kind: 'character', characterId: STRANGER },
    currencyId: GOLD,
    sourceId: SOURCE_REF,
    ...overrides,
  };
}

function quoteFor(state: EconomyState): ReturnType<typeof createEconomyQuery> {
  return createEconomyQuery(state, makeQueryContext());
}

function purchase(state: EconomyState, offerId = OFFER, buyer: CharacterId = BUYER): PriceQuote {
  return quoteFor(state).getPurchaseQuote({
    offerId,
    buyerCharacterId: buyer,
    sourceRevision: OFFER_REVISION,
  });
}

// ── 測試案例 ─────────────────────────────────────────────────────────────────

type Case = Readonly<{ name: string; run: () => void }>;

const cases: readonly Case[] = [
  // ── CreateEconomyAccount ────────────────────────────────────────────────
  {
    name: 'CreateEconomyAccount：新擁有者建立空帳戶並發 EconomyAccountCreated',
    run: () => {
      const state = fixtureEconomyState();
      const result = expectOk(
        handleCreateEconomyAccount(createAccount(), state, makeHandlerContext()),
        'createAccount',
      );
      const account = tryGetAccount(result.nextSlice, ACC_NEW);
      assert(account !== undefined, '新帳戶應存在');
      assert(account?.balance === 0, `新帳戶餘額應為空（實得 ${String(account?.balance)}）`);
      const created = findEvent(eventsOf(result.outgoingMessages), 'EconomyAccountCreated');
      assert(created !== undefined, '應發 EconomyAccountCreated');
      assert(created?.accountId === ACC_NEW, '事件應帶新帳戶 ID');
      assert(created?.owner.kind === 'character', 'owner 應為判別聯集的 character 變體');
    },
  },
  {
    name: 'CreateEconomyAccount：system 用途帳戶（判別聯集的 system 變體）',
    run: () => {
      const state = fixtureEconomyState();
      const result = expectOk(
        handleCreateEconomyAccount(
          createAccount({ owner: systemAccountOwner('questRewards') }),
          state,
          makeHandlerContext(),
        ),
        'createSystemAccount',
      );
      const account = tryGetAccount(result.nextSlice, ACC_NEW);
      assert(account?.owner.kind === 'system', 'owner 應為 system 變體');
    },
  },
  {
    name: 'CreateEconomyAccount：同 (owner, currency) 重送是冪等 no-op（資料齊全時仍 no-op）',
    run: () => {
      const state = fixtureEconomyState();
      const result = expectOk(
        handleCreateEconomyAccount(
          createAccount({ owner: { kind: 'character', characterId: BUYER } }),
          state,
          makeHandlerContext(),
        ),
        'createAccountReplay',
      );
      assert(result.nextSlice === state, '既有帳戶時 Slice 必須原樣返回（不是碰巧相等）');
      assert(result.outgoingMessages.length === 0, '不得重發 EconomyAccountCreated');
      // 同一角色的**另一種**貨幣不算重送：仍須建立。
      const other = expectOk(
        handleCreateEconomyAccount(
          createAccount({ owner: { kind: 'character', characterId: SELLER }, currencyId: SILVER }),
          state,
          makeHandlerContext(),
        ),
        'createAccountOtherCurrency',
      );
      assert(tryGetAccount(other.nextSlice, ACC_NEW) !== undefined, '不同貨幣應建立新帳戶');
    },
  },
  {
    name: 'CreateEconomyAccount：未知貨幣 → economy/currency-definition-missing',
    run: () => {
      expectReject(
        handleCreateEconomyAccount(
          createAccount({ currencyId: UNKNOWN_CURRENCY }),
          fixtureEconomyState(),
          makeHandlerContext(),
        ),
        'economy/currency-definition-missing',
        'createAccountUnknownCurrency',
      );
    },
  },

  {
    name: 'CreateEconomyAccount：enabled=false 的貨幣 → economy/currency-disabled',
    run: () => {
      expectReject(
        handleCreateEconomyAccount(
          createAccount({ currencyId: DISABLED_CURRENCY }),
          fixtureEconomyState(),
          makeHandlerContext(),
        ),
        'economy/currency-disabled',
        'createAccountDisabledCurrency',
      );
    },
  },

  // ── TransferCurrency ────────────────────────────────────────────────────
  {
    name: 'TransferCurrency：原子移轉、寫帳本、發 CurrencyTransferred',
    run: () => {
      const state = fixtureEconomyState();
      const result = expectOk(
        handleTransferCurrency(transfer(), state, makeHandlerContext()),
        'transfer',
      );
      assert(
        balanceOf(result.nextSlice, ACC_BUYER) === BUYER_START_BALANCE - 100,
        '付款方應扣款',
      );
      assert(
        balanceOf(result.nextSlice, ACC_SELLER) === SELLER_START_BALANCE + 100,
        '收款方應入帳',
      );
      const record = tryGetTransfer(result.nextSlice, TRANSFER_1);
      assert(record !== undefined, '應寫入 Transfer 帳本');
      assert(record?.appliedOnDay === WORLD_DAY, 'appliedOnDay 應取自 ctx 世界日');
      assert(record?.fromAccountId === ACC_BUYER && record?.toAccountId === ACC_SELLER, '帳本兩端');
      const event = findEvent(eventsOf(result.outgoingMessages), 'CurrencyTransferred');
      assert(event?.from === ACC_BUYER && event?.to === ACC_SELLER, '事件應帶兩端帳戶');
      assert(event?.amount === 100, '事件金額');
      // 總量守恆。
      const before = balanceOf(state, ACC_BUYER) + balanceOf(state, ACC_SELLER);
      const after = balanceOf(result.nextSlice, ACC_BUYER) + balanceOf(result.nextSlice, ACC_SELLER);
      assert(before === after, '移轉不得改變兩帳戶總額');
    },
  },
  {
    name: 'TransferCurrency：餘額不足是 typed rejection，不是夾到 0（不變量 2）',
    run: () => {
      const state = fixtureEconomyState();
      expectReject(
        handleTransferCurrency(
          transfer({ fromAccountId: ACC_POOR, amount: 1 }),
          state,
          makeHandlerContext(),
        ),
        'economy/insufficient-balance',
        'transferInsufficient',
      );
      assert(balanceOf(state, ACC_POOR) === 0, '拒絕不得動到餘額');
    },
  },
  {
    name: 'TransferCurrency：幣別不符 → economy/currency-mismatch（不變量 4）',
    run: () => {
      expectReject(
        handleTransferCurrency(
          transfer({ toAccountId: ACC_SILVER }),
          fixtureEconomyState(),
          makeHandlerContext(),
        ),
        'economy/currency-mismatch',
        'transferCurrencyMismatch',
      );
    },
  },
  {
    name: 'TransferCurrency：未知帳戶 → economy/unknown-account',
    run: () => {
      expectReject(
        handleTransferCurrency(
          transfer({ toAccountId: ACC_ABSENT }),
          fixtureEconomyState(),
          makeHandlerContext(),
        ),
        'economy/unknown-account',
        'transferUnknownAccount',
      );
    },
  },
  {
    name: 'TransferCurrency：同一帳戶兩端 → economy/same-account',
    run: () => {
      expectReject(
        handleTransferCurrency(
          transfer({ toAccountId: ACC_BUYER }),
          fixtureEconomyState(),
          makeHandlerContext(),
        ),
        'economy/same-account',
        'transferSameAccount',
      );
    },
  },
  {
    name: 'TransferCurrency：非整數金額 → economy/amount-not-integer（不變量 1）',
    run: () => {
      expectReject(
        handleTransferCurrency(
          transfer({ amount: 1.5 }),
          fixtureEconomyState(),
          makeHandlerContext(),
        ),
        'economy/amount-not-integer',
        'transferFractionalAmount',
      );
    },
  },
  {
    name: 'TransferCurrency：零或負金額 → economy/amount-not-positive',
    run: () => {
      expectReject(
        handleTransferCurrency(transfer({ amount: 0 }), fixtureEconomyState(), makeHandlerContext()),
        'economy/amount-not-positive',
        'transferZeroAmount',
      );
      expectReject(
        handleTransferCurrency(
          transfer({ amount: -5 }),
          fixtureEconomyState(),
          makeHandlerContext(),
        ),
        'economy/amount-not-positive',
        'transferNegativeAmount',
      );
    },
  },
  {
    name: 'TransferCurrency：同 transferId 重送只回既有結果（不變量 3 的冪等）',
    run: () => {
      const first = expectOk(
        handleTransferCurrency(transfer(), fixtureEconomyState(), makeHandlerContext()),
        'transferFirst',
      );
      const replay = expectOk(
        handleTransferCurrency(transfer(), first.nextSlice, makeHandlerContext()),
        'transferReplay',
      );
      assert(replay.nextSlice === first.nextSlice, '重送必須原樣返回同一個 Slice');
      assert(replay.outgoingMessages.length === 0, '重送不得重發 CurrencyTransferred');
      assert(
        balanceOf(replay.nextSlice, ACC_BUYER) === BUYER_START_BALANCE - 100,
        '重送不得再次扣款',
      );
    },
  },
  {
    name: 'TransferCurrency：transferId 被拿去帶不同內容 → economy/transfer-id-conflict',
    run: () => {
      const first = expectOk(
        handleTransferCurrency(transfer(), fixtureEconomyState(), makeHandlerContext()),
        'transferFirst',
      );
      expectReject(
        handleTransferCurrency(transfer({ amount: 7 }), first.nextSlice, makeHandlerContext()),
        'economy/transfer-id-conflict',
        'transferIdConflict',
      );
    },
  },
  {
    name: 'TransferCurrency：不同 transferId 可在同一交易連續移轉',
    run: () => {
      const first = expectOk(
        handleTransferCurrency(transfer(), fixtureEconomyState(), makeHandlerContext()),
        'transferFirst',
      );
      const second = expectOk(
        handleTransferCurrency(
          transfer({ transferId: TRANSFER_2, amount: 50 }),
          first.nextSlice,
          makeHandlerContext(),
        ),
        'transferSecond',
      );
      assert(
        balanceOf(second.nextSlice, ACC_BUYER) === BUYER_START_BALANCE - 150,
        '兩筆都應套用',
      );
    },
  },

  // ── GrantCurrency ───────────────────────────────────────────────────────
  {
    name: 'GrantCurrency：金額來自 Reward Rule 的 Resolver（不在命令也不在程式裡）',
    run: () => {
      const state = fixtureEconomyState();
      const result = expectOk(
        handleGrantCurrency(grant(), state, makeHandlerContext()),
        'grant',
      );
      assert(
        balanceOf(result.nextSlice, ACC_DISTRIBUTION) === REWARD_GOLD_AMOUNT,
        `清算帳戶應入帳 Resolver 給的金額（實得 ${balanceOf(result.nextSlice, ACC_DISTRIBUTION)}）`,
      );
      const record = tryGetTransfer(result.nextSlice, GRANT_1);
      assert(record?.fromAccountId === undefined, 'system mint 不得有來源帳戶');
      assert(record?.toAccountId === ACC_DISTRIBUTION, '帳本應帶目的帳戶');
      const event = findEvent(eventsOf(result.outgoingMessages), 'CurrencyTransferred');
      assert(event?.from === undefined, '事件不得有 from');
      assert(event?.amount === REWARD_GOLD_AMOUNT, '事件金額應與 Resolver 一致');
    },
  },
  {
    name: 'GrantCurrency：未知 Reward Rule → economy/reward-rule-definition-missing',
    run: () => {
      expectReject(
        handleGrantCurrency(
          grant({ rewardRuleId: UNKNOWN_REWARD_RULE }),
          fixtureEconomyState(),
          makeHandlerContext(),
        ),
        'economy/reward-rule-definition-missing',
        'grantUnknownRule',
      );
    },
  },
  {
    name: 'GrantCurrency：enabled=false 的 Reward Rule → economy/reward-rule-disabled',
    run: () => {
      expectReject(
        handleGrantCurrency(
          grant({ rewardRuleId: REWARD_DISABLED }),
          fixtureEconomyState(),
          makeHandlerContext(),
        ),
        'economy/reward-rule-disabled',
        'grantDisabledRule',
      );
    },
  },
  {
    name: 'GrantCurrency：Resolver 算不出金額 → economy/reward-amount-unresolved（不補預設）',
    run: () => {
      expectReject(
        handleGrantCurrency(
          grant({ rewardRuleId: REWARD_UNRESOLVABLE }),
          fixtureEconomyState(),
          makeHandlerContext(),
        ),
        'economy/reward-amount-unresolved',
        'grantUnresolved',
      );
    },
  },
  {
    name: 'GrantCurrency：Resolver 給的幣別與帳戶不符 → economy/currency-mismatch',
    run: () => {
      expectReject(
        handleGrantCurrency(
          grant({ rewardRuleId: REWARD_WRONG_CURRENCY }),
          fixtureEconomyState(),
          makeHandlerContext(),
        ),
        'economy/currency-mismatch',
        'grantCurrencyMismatch',
      );
    },
  },
  {
    name: 'GrantCurrency：Resolver 給非整數金額 → economy/amount-not-integer',
    run: () => {
      expectReject(
        handleGrantCurrency(
          grant({ rewardRuleId: REWARD_NON_INTEGER }),
          fixtureEconomyState(),
          makeHandlerContext(),
        ),
        'economy/amount-not-integer',
        'grantFractionalAmount',
      );
    },
  },
  {
    name: 'GrantCurrency：未知目的帳戶 → economy/unknown-account',
    run: () => {
      expectReject(
        handleGrantCurrency(
          grant({ toAccountId: ACC_ABSENT }),
          fixtureEconomyState(),
          makeHandlerContext(),
        ),
        'economy/unknown-account',
        'grantUnknownAccount',
      );
    },
  },
  {
    name: 'GrantCurrency：同 transferId 重送是冪等 no-op',
    run: () => {
      const first = expectOk(
        handleGrantCurrency(grant(), fixtureEconomyState(), makeHandlerContext()),
        'grantFirst',
      );
      const replay = expectOk(
        handleGrantCurrency(grant(), first.nextSlice, makeHandlerContext()),
        'grantReplay',
      );
      assert(replay.nextSlice === first.nextSlice, '重送必須原樣返回同一個 Slice');
      assert(replay.outgoingMessages.length === 0, '重送不得重發事件');
      assert(
        balanceOf(replay.nextSlice, ACC_DISTRIBUTION) === REWARD_GOLD_AMOUNT,
        '重送不得再次入帳',
      );
    },
  },

  // ── RemoveCurrency ──────────────────────────────────────────────────────
  {
    name: 'RemoveCurrency：扣款到 system sink（事件無 to）',
    run: () => {
      const result = expectOk(
        handleRemoveCurrency(remove(), fixtureEconomyState(), makeHandlerContext()),
        'remove',
      );
      assert(
        balanceOf(result.nextSlice, ACC_BUYER) === BUYER_START_BALANCE - 60,
        '應扣款',
      );
      const record = tryGetTransfer(result.nextSlice, REMOVE_1);
      assert(record?.toAccountId === undefined, 'system sink 不得有目的帳戶');
      const event = findEvent(eventsOf(result.outgoingMessages), 'CurrencyTransferred');
      assert(event?.to === undefined, '事件不得有 to');
      assert(event?.from === ACC_BUYER, '事件應帶來源帳戶');
    },
  },
  {
    name: 'RemoveCurrency：餘額不足 → economy/insufficient-balance',
    run: () => {
      expectReject(
        handleRemoveCurrency(
          remove({ fromAccountId: ACC_POOR, amount: 1 }),
          fixtureEconomyState(),
          makeHandlerContext(),
        ),
        'economy/insufficient-balance',
        'removeInsufficient',
      );
    },
  },
  {
    name: 'RemoveCurrency：幣別不符 / 未知帳戶 / 非法金額',
    run: () => {
      const state = fixtureEconomyState();
      expectReject(
        handleRemoveCurrency(remove({ currencyId: SILVER }), state, makeHandlerContext()),
        'economy/currency-mismatch',
        'removeCurrencyMismatch',
      );
      expectReject(
        handleRemoveCurrency(remove({ fromAccountId: ACC_ABSENT }), state, makeHandlerContext()),
        'economy/unknown-account',
        'removeUnknownAccount',
      );
      expectReject(
        handleRemoveCurrency(remove({ amount: 0 }), state, makeHandlerContext()),
        'economy/amount-not-positive',
        'removeZeroAmount',
      );
    },
  },
  {
    name: 'RemoveCurrency：同 transferId 重送是冪等 no-op',
    run: () => {
      const first = expectOk(
        handleRemoveCurrency(remove(), fixtureEconomyState(), makeHandlerContext()),
        'removeFirst',
      );
      const replay = expectOk(
        handleRemoveCurrency(remove(), first.nextSlice, makeHandlerContext()),
        'removeReplay',
      );
      assert(replay.nextSlice === first.nextSlice, '重送必須原樣返回同一個 Slice');
      assert(replay.outgoingMessages.length === 0, '重送不得重發事件');
    },
  },
  {
    name: '不變量：三個扣款路徑都不會讓餘額低於 0',
    run: () => {
      const state = fixtureEconomyState();
      const attempts: readonly EconomyHandlerResult[] = [
        handleTransferCurrency(
          transfer({ fromAccountId: ACC_SELLER, amount: SELLER_START_BALANCE + 1 }),
          state,
          makeHandlerContext(),
        ),
        handleRemoveCurrency(
          remove({ fromAccountId: ACC_SELLER, amount: SELLER_START_BALANCE + 1 }),
          state,
          makeHandlerContext(),
        ),
      ];
      for (const attempt of attempts) {
        assert(!attempt.ok, '超額扣款必須被拒絕');
      }
      for (const account of Object.values(state.accounts)) {
        assert(account.balance >= 0, '任何帳戶餘額不得低於 0');
      }
    },
  },
  {
    name: '不變量：不存在 Team Account（EconomyAccountOwner 聯集沒有 team 變體）',
    run: () => {
      const state = fixtureEconomyState();
      for (const account of Object.values(state.accounts)) {
        const kinds: readonly string[] = ['character', 'city', 'assetDistribution', 'system'];
        assert(kinds.includes(account.owner.kind), `未預期的 owner kind ${account.owner.kind}`);
      }
    },
  },

  // ── Domain Event Subscriber（報價失效）────────────────────────────────────
  {
    name: 'MarketPressureChanged：遞增 market scope Epoch 並發 PriceQuoteInvalidated',
    run: () => {
      const state = fixtureEconomyState();
      const event: MarketPressureChanged = {
        type: 'MarketPressureChanged',
        scope: { kind: 'city', id: CITY },
        modifierRuleId: MOD_WAR_SURCHARGE,
        active: true,
      };
      const result = onMarketPressureChanged(event, state);
      const key = priceScopeKeyFor({ kind: 'market', market: event.scope });
      assert(epochOf(result.nextSlice, key) === 1, 'Epoch 應遞增');
      const invalidated = findEvent(eventsOf(result.outgoingMessages), 'PriceQuoteInvalidated');
      assert(invalidated?.scope === key, '事件應帶同一個 scope key');
      assert(invalidated?.reason === 'MarketPressureChanged', 'reason 應為來源事件種類');
      // 不複製 World State：Slice 只多了一個 epoch entry，帳戶完全不動（不變量 7）。
      assert(
        Object.keys(result.nextSlice.accounts).length === Object.keys(state.accounts).length,
        '不得新增帳戶',
      );
      for (const account of Object.values(result.nextSlice.accounts)) {
        assert(
          account.balance === requireAccount(state, account.accountId).balance,
          '市場壓力不得直接改動既有帳戶餘額',
        );
      }
    },
  },
  {
    name: 'CharacterReputationChanged：遞增角色聲望 scope Epoch',
    run: () => {
      const event: CharacterReputationChangedEvent = {
        type: 'CharacterReputationChanged',
        characterId: BUYER,
        oldValue: 1,
        newValue: 2,
      };
      const result = onCharacterReputationChanged(event, fixtureEconomyState());
      const key = priceScopeKeyFor({ kind: 'characterReputation', characterId: BUYER });
      assert(epochOf(result.nextSlice, key) === 1, 'Epoch 應遞增');
      const invalidated = findEvent(eventsOf(result.outgoingMessages), 'PriceQuoteInvalidated');
      assert(invalidated?.reason === 'CharacterReputationChanged', 'reason 應為來源事件種類');
    },
  },
  {
    name: 'PlayerAffinityChanged：只遞增該冒險者的家教 scope，不動一般買賣 scope',
    run: () => {
      const event: PlayerAffinityChangedPayload = {
        type: 'PlayerAffinityChanged',
        adventurerId: TUTOR,
        newValue: 5,
        sourceId: 'interaction-1' as PlayerAffinityChangedPayload['sourceId'],
        reason: 'conversation',
      };
      const result = onPlayerAffinityChanged(event, fixtureEconomyState());
      const affinityKey = priceScopeKeyFor({ kind: 'adventurerAffinity', adventurerId: TUTOR });
      const reputationKey = priceScopeKeyFor({ kind: 'characterReputation', characterId: TUTOR });
      assert(epochOf(result.nextSlice, affinityKey) === 1, '家教 scope 應遞增');
      assert(epochOf(result.nextSlice, reputationKey) === 0, '一般買賣 scope 不得被牽動');
    },
  },

  // ── Query：帳戶 ─────────────────────────────────────────────────────────
  {
    name: 'Query：getBalance / getCharacterAccount / getAssetDistributionAccount / canAfford',
    run: () => {
      const state = fixtureEconomyState();
      const query = quoteFor(state);
      assert(query.getBalance(ACC_BUYER) === BUYER_START_BALANCE, 'getBalance');
      assert(query.getCharacterAccount(BUYER, GOLD) === ACC_BUYER, '角色金幣帳戶');
      assert(query.getCharacterAccount(BUYER, SILVER) === ACC_SILVER, '同角色不同貨幣是不同帳戶');
      assert(
        query.getAssetDistributionAccount(DISTRIBUTION, GOLD) === ACC_DISTRIBUTION,
        '清算帳戶',
      );
      assert(query.canAfford(ACC_BUYER, BUYER_START_BALANCE), '剛好夠付視為可負擔');
      assert(!query.canAfford(ACC_POOR, 1), '空帳戶不可負擔');
      assert(query.getBalance(ACC_CITY) >= 0, '城市帳戶存在');
      assert(query.getBalance(ACC_DUNGEON_SOURCE) === 0, 'system source 起始為空');
    },
  },
  {
    name: 'Query：查無帳戶明確拋錯（不回哨兵 ID、不回 0 餘額）',
    run: () => {
      const query = quoteFor(fixtureEconomyState());
      expectThrows(() => query.getCharacterAccount(POOR, SILVER), 'getCharacterAccount 缺帳戶');
      expectThrows(() => query.getBalance(ACC_ABSENT), 'getBalance 未知帳戶');
      expectThrows(() => query.canAfford(ACC_ABSENT, 1), 'canAfford 未知帳戶');
    },
  },
  {
    name: 'Query：轉隊不改變個人帳戶（不變量 9——帳戶只綁 characterId，不綁 teamId）',
    run: () => {
      const state = fixtureEconomyState();
      const before = findCharacterAccountId(state, BUYER, GOLD);
      // Economy 沒有任何以 teamId 為鍵的結構；任何隊伍變動都不經過本 Slice。
      const after = findCharacterAccountId(state, BUYER, GOLD);
      assert(before === after && before === ACC_BUYER, '個人帳戶 ID 不因隊伍變動而改變');
    },
  },

  // ── Query：Quote ────────────────────────────────────────────────────────
  {
    name: 'Quote（購買）：base × multiply → add，逐筆明細指名 Modifier Rule',
    run: () => {
      const quote = purchase(fixtureEconomyState());
      // 交流加成（multiply, 1 - 4/100）→ 96；戰爭加價（add, +10）→ 106；floor；底價 5 不生效。
      const afterBonus = BASE_VALUE * (1 - TRADE_BONUS_BUYER / 100);
      const expected = Math.max(Math.floor(afterBonus + 10), MINIMUM_PRICE_FLOOR);
      assert(quote.amount === expected, `買價應為 ${expected}（實得 ${quote.amount}）`);
      assert(quote.currencyId === GOLD, 'Quote 幣別來自價格來源');
      assert(quote.modifierBreakdown.length === 2, 'enabled=false 的 Modifier Rule 不列入明細');
      assert(
        quote.modifierBreakdown[0]?.modifierRuleId === MOD_TRADE_BONUS,
        '第一筆明細應指名交流加成規則',
      );
      assert(
        quote.modifierBreakdown[0]?.appliedAmount === afterBonus - BASE_VALUE,
        '明細金額應為該筆造成的價格變化量',
      );
      assert(
        quote.modifierBreakdown[1]?.modifierRuleId === MOD_WAR_SURCHARGE &&
          quote.modifierBreakdown[1]?.appliedAmount === 10,
        '第二筆明細應為戰爭加價',
      );
      assert(quote.validFor.sourceRevision === OFFER_REVISION, 'Quote 應綁定來源 Revision');
      assert(
        Object.keys(quote.validFor.pricingEpochs).length === 1,
        'Quote 應綁定它依賴的 Pricing Epoch',
      );
    },
  },
  {
    name: 'Quote（購買）：不同買家各自重算自己的加成（Team 沒有買賣加成）',
    run: () => {
      const state = fixtureEconomyState();
      const buyerQuote = purchase(state, OFFER, BUYER);
      const strangerQuote = purchase(state, OFFER, STRANGER);
      assert(
        buyerQuote.amount < strangerQuote.amount,
        `有交流加成的買家應更便宜（${buyerQuote.amount} vs ${strangerQuote.amount}）`,
      );
      assert(buyerQuote.quoteId !== strangerQuote.quoteId, '不同角色的 Quote 不共用 ID');
    },
  },
  {
    name: 'Quote：相同 State／Definition／Input → 相同價格與相同 quoteId（不變量 8）',
    run: () => {
      const state = fixtureEconomyState();
      const a = purchase(state);
      const b = purchase(state);
      assert(a.amount === b.amount, '同輸入應同價格');
      assert(a.quoteId === b.quoteId, '同輸入應同 quoteId');
      assert(
        JSON.stringify(a.modifierBreakdown) === JSON.stringify(b.modifierBreakdown),
        '同輸入應同明細',
      );
    },
  },
  {
    name: 'Quote：minimumPrice 是資料欄位且真的夾住結果',
    run: () => {
      const quote = purchase(fixtureEconomyState(), OFFER_MINIMUM);
      assert(
        quote.amount === MINIMUM_PRICE_FLOOR,
        `底價應夾住結果（實得 ${quote.amount}）`,
      );
    },
  },
  {
    name: 'Quote：stackPolicy=strongest 同組只有最強者生效，被壓下者仍列進明細',
    run: () => {
      const quote = purchase(fixtureEconomyState(), OFFER_STRONGEST);
      assert(
        quote.amount === Math.round(STRONGEST_BASE_VALUE * 1.5),
        `只應套用較強的係數（實得 ${quote.amount}）`,
      );
      assert(quote.modifierBreakdown.length === 2, '兩筆都要列出來');
      const small = quote.modifierBreakdown.find((b) => b.modifierRuleId === MOD_STRONGEST_SMALL);
      const big = quote.modifierBreakdown.find((b) => b.modifierRuleId === MOD_STRONGEST_BIG);
      assert(small?.appliedAmount === 0, '被壓下的那筆造成 0 變化');
      assert(
        big?.appliedAmount === STRONGEST_BASE_VALUE * 1.5 - STRONGEST_BASE_VALUE,
        '生效的那筆造成全部變化',
      );
    },
  },
  {
    name: 'Quote（販售）：走 sellModifierIds，加成依收款角色本人',
    run: () => {
      const state = fixtureEconomyState();
      const quote = createEconomyQuery(state, makeQueryContext()).getSellQuote({
        itemSourceId: ITEM,
        sellerCharacterId: SELLER,
        cityId: CITY,
        sourceRevision: ITEM_REVISION,
      });
      assert(
        quote.amount === Math.floor(BASE_VALUE * (1 + TRADE_BONUS_SELLER / 100)),
        `賣價應為加價後結果（實得 ${quote.amount}）`,
      );
      assert(quote.modifierBreakdown.length === 1, '賣出只套 sellModifierIds');
      assert(
        Object.keys(quote.validFor.pricingEpochs).length === 2,
        '賣價綁城市市場與賣方聲望兩個 scope',
      );
    },
  },
  {
    name: 'Quote（家教服務）：好感修正是一筆可解釋的明細，且只來自 Social Query',
    run: () => {
      const state = fixtureEconomyState();
      const quote = createEconomyQuery(state, makeQueryContext()).getServiceQuote({
        serviceKind: 'homeTutor',
        serviceDefinitionId: SERVICE_DEF,
        providerCharacterId: TUTOR,
        buyerCharacterId: BUYER,
        sourceRevision: SERVICE_REVISION,
      });
      assert(
        quote.amount === Math.ceil(SERVICE_BASE_VALUE * (1 - HOME_TUTOR_MODIFIER / 100)),
        `家教價應含好感修正（實得 ${quote.amount}）`,
      );
      assert(
        quote.modifierBreakdown.length === 1 &&
          quote.modifierBreakdown[0]?.modifierRuleId === MOD_AFFINITY,
        '好感修正應以指名的 Modifier Rule 出現在明細',
      );
      // Economy 不保存第二份好感值（不變量 13）：Slice 裡沒有任何好感欄位。
      assert(
        JSON.stringify(state) === JSON.stringify(fixtureEconomyState()),
        '產生 Quote 不得寫入 Economy State',
      );
    },
  },
  {
    name: 'Quote：家教好感修正不外洩到一般買賣（購買 Quote 沒有 homeTutorPriceModifier）',
    run: () => {
      // 一般買賣的 Resolver 輸入沒有 homeTutorPriceModifier；MOD_AFFINITY 的 stub 在缺它時回 undefined，
      // 因此若哪天有人把好感修正塞進購買路徑，這裡會從「拋錯」變成「有值」而被抓到。
      const state = fixtureEconomyState();
      const quote = purchase(state);
      assert(
        quote.modifierBreakdown.every((b) => b.modifierRuleId !== MOD_AFFINITY),
        '購買 Quote 不得含家教好感修正',
      );
    },
  },
  {
    name: 'Quote：來源 Revision 過期時明確失敗（不變量 5）',
    run: () => {
      const query = quoteFor(fixtureEconomyState());
      expectThrows(
        () =>
          query.getPurchaseQuote({
            offerId: OFFER,
            buyerCharacterId: BUYER,
            sourceRevision: (OFFER_REVISION - 1) as Revision,
          }),
        'stale source revision',
      );
    },
  },
  {
    name: 'Quote：價格來源不存在 / Modifier Resolver 算不出值 → 明確失敗，不回假價格',
    run: () => {
      const query = quoteFor(fixtureEconomyState());
      expectThrows(
        () =>
          query.getPurchaseQuote({
            offerId: OFFER_ABSENT,
            buyerCharacterId: BUYER,
            sourceRevision: OFFER_REVISION,
          }),
        'missing price source',
      );
      expectThrows(() => purchase(fixtureEconomyState(), OFFER_UNRESOLVABLE), 'unresolvable modifier');
    },
  },
  {
    name: 'isPriceQuoteCurrent：Epoch 或來源 Revision 改變後舊 Quote 不再有效',
    run: () => {
      const state = fixtureEconomyState();
      const quote = purchase(state);
      assert(isPriceQuoteCurrent(state, quote, OFFER_REVISION), '剛產生的 Quote 應有效');
      assert(
        !isPriceQuoteCurrent(state, quote, (OFFER_REVISION + 1) as Revision),
        '來源 Revision 變了就無效',
      );
      const afterReputation = onCharacterReputationChanged(
        { type: 'CharacterReputationChanged', characterId: BUYER, oldValue: 1, newValue: 2 },
        state,
      );
      assert(
        !isPriceQuoteCurrent(afterReputation.nextSlice, quote, OFFER_REVISION),
        '綁定的 Pricing Epoch 遞增後就無效',
      );
    },
  },
];

// ── Runner ───────────────────────────────────────────────────────────────────

export type EconomyTestResult = Readonly<{ name: string; pass: boolean; error?: string }>;

export function runTestResults(): readonly EconomyTestResult[] {
  return cases.map((c) => {
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
    throw new Error(`economy tests failed (${failed.length}/${results.length}):\n${lines}`);
  }
}
