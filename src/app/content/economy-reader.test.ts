// app/content/economy-reader.test.ts
// 證明 data-runtime → EconomyDefinitionReader 的 adapter 路徑：
//   1. 單元層——由記憶體內 content pack 建 DefinitionRegistry → createEconomyDefinitionReader，
//      四個 getter 回傳正確定義；未知 id / 跨 kind 存取明確拋錯；tryGet* 回 undefined 而不拋。
//   2. 真消費者——把這個**真** reader 換進 Economy 的 Handler 與 Query：
//      GrantCurrency 的金額從 registry 讀出的 Reward Rule → Resolver 取得；
//      購買 Quote 的修正清單、疊加方式、進位與底價全部從 registry 讀出的 Definition 取得。
//      證明 adapter 不只型別對，還能真的驅動記帳與報價。
//
// （Economy 尚未接進引擎 Session——那是整合者的接線工作，會動到 composition 共用檔——所以這裡
//   的第 2 組以模組 Handler／Query 直接驅動，不碰 session-fixture。）

import type { ContentPackId, DefinitionId, Revision } from '../../contracts/core';
import {
  createDefinitionRegistry,
  type ContentDefinition,
  type ContentManifestIdentity,
  type DefinitionRegistry,
} from '../../data-runtime';

import {
  ACC_DISTRIBUTION,
  BASE_VALUE,
  BUYER,
  GOLD,
  MOD_DISABLED,
  MOD_TRADE_BONUS,
  MOD_WAR_SURCHARGE,
  OFFER,
  OFFER_REVISION,
  RESOLVER_DISABLED,
  RESOLVER_REWARD_GOLD,
  RESOLVER_TRADE_BONUS,
  RESOLVER_WAR,
  REWARD_DUNGEON_GOLD,
  REWARD_GOLD_AMOUNT,
  SHOP_PRICE_RULE,
  TRADE_BONUS_BUYER,
  fixtureEconomyState,
  makeHandlerContext,
  makeQueryContext,
} from '../../modules/economy/fixtures';
import { handleGrantCurrency } from '../../modules/economy/system';
import { createEconomyQuery } from '../../modules/economy/queries';
import { requireAccount } from '../../modules/economy/state';

import { createEconomyDefinitionReader, ECONOMY_DEFINITION_KINDS } from './economy-reader';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const PACK = 'pack:economy-bringup' as ContentPackId;

function def(
  id: string,
  kind: string,
  data: Record<string, unknown>,
  enabled = true,
): ContentDefinition {
  return {
    id: id as DefinitionId,
    kind,
    schemaVersion: 1,
    packId: PACK,
    enabled,
    sourcePath: `mem://${kind}/${id}`,
    data: data as ContentDefinition['data'],
  };
}

// 對齊 economy FIXTURE 的最小 bring-up 定義集（與 fixtures.stubDefinitionReader 同值）。
function economyDefinitions(): readonly ContentDefinition[] {
  return [
    def(GOLD, ECONOMY_DEFINITION_KINDS.currency, {
      smallestUnit: 1,
      display: { nameRef: { key: 'currency.gold' } },
    }),
    def(SHOP_PRICE_RULE, ECONOMY_DEFINITION_KINDS.priceRule, {
      baseValueSource: 'itemDefinition',
      buyModifierIds: [MOD_TRADE_BONUS, MOD_WAR_SURCHARGE, MOD_DISABLED],
      sellModifierIds: [MOD_TRADE_BONUS],
      roundingPolicy: 'floor',
      minimumPrice: 5,
    }),
    def(MOD_TRADE_BONUS, ECONOMY_DEFINITION_KINDS.priceModifierRule, {
      resolverId: RESOLVER_TRADE_BONUS,
      stackPolicy: 'multiply',
    }),
    def(MOD_WAR_SURCHARGE, ECONOMY_DEFINITION_KINDS.priceModifierRule, {
      resolverId: RESOLVER_WAR,
      stackPolicy: 'add',
    }),
    // enabled=false 由 **registry header** 決定；Reader 投影時以 registry 為權威。
    def(
      MOD_DISABLED,
      ECONOMY_DEFINITION_KINDS.priceModifierRule,
      { resolverId: RESOLVER_DISABLED, stackPolicy: 'multiply' },
      false,
    ),
    def(REWARD_DUNGEON_GOLD, ECONOMY_DEFINITION_KINDS.rewardRule, {
      resolverId: RESOLVER_REWARD_GOLD,
    }),
  ];
}

const IDENTITY: ContentManifestIdentity = {
  manifestVersion: '0.0.0-bringup',
  manifestHash: 'bringup',
  packs: [{ packId: PACK, version: '0.0.0', hash: 'bringup' }],
};

function registry(): DefinitionRegistry {
  return createDefinitionRegistry(economyDefinitions(), IDENTITY);
}

export type ReaderTestResult = Readonly<{ name: string; pass: boolean; error?: string }>;

const CASES: readonly Readonly<{ name: string; run: () => void }>[] = [
  {
    name: 'getCurrency 由 registry 投影出領域定義（header + 領域欄位）',
    run: () => {
      const reader = createEconomyDefinitionReader(registry());
      const currency = reader.getCurrency(GOLD);
      assert(String(currency.id) === String(GOLD), 'id 應為 registry 權威值');
      assert(currency.enabled, 'enabled 應取自 registry header');
      assert(currency.packId === PACK, 'packId 應取自 registry header');
      assert(currency.smallestUnit === 1, `smallestUnit（實得 ${currency.smallestUnit}）`);
      assert(currency.display.nameRef.key === 'currency.gold', 'display 應取自 data');
    },
  },
  {
    name: 'getPriceRule 投影出修正清單、進位政策與底價',
    run: () => {
      const rule = createEconomyDefinitionReader(registry()).getPriceRule(SHOP_PRICE_RULE);
      assert(rule.baseValueSource === 'itemDefinition', 'baseValueSource');
      assert(rule.buyModifierIds.length === 3, `buyModifierIds（實得 ${rule.buyModifierIds.length}）`);
      assert(rule.sellModifierIds.length === 1, 'sellModifierIds');
      assert(rule.roundingPolicy === 'floor', 'roundingPolicy');
      assert(rule.minimumPrice === 5, `minimumPrice（實得 ${rule.minimumPrice}）`);
    },
  },
  {
    name: 'getPriceModifierRule / getRewardRule 各自窄化到自己的 kind',
    run: () => {
      const reader = createEconomyDefinitionReader(registry());
      const mod = reader.getPriceModifierRule(MOD_WAR_SURCHARGE);
      assert(mod.stackPolicy === 'add', `stackPolicy（實得 ${mod.stackPolicy}）`);
      assert(String(mod.resolverId) === String(RESOLVER_WAR), 'resolverId 應取自 data');
      const reward = reader.getRewardRule(REWARD_DUNGEON_GOLD);
      assert(String(reward.resolverId) === String(RESOLVER_REWARD_GOLD), 'reward resolverId');
      const disabled = reader.getPriceModifierRule(MOD_DISABLED);
      assert(!disabled.enabled, 'enabled=false 應由 registry header 帶出');
    },
  },
  {
    name: '未知 id：get* 明確拋錯，tryGet* 回 undefined（供 Handler 回 typed rejection）',
    run: () => {
      const reader = createEconomyDefinitionReader(registry());
      let threw = false;
      try {
        reader.getCurrency('definition:currency:absent' as never);
      } catch {
        threw = true;
      }
      assert(threw, '未知 currency id 應拋錯');
      assert(
        reader.tryGetCurrency('definition:currency:absent' as never) === undefined,
        'tryGetCurrency 應回 undefined',
      );
      assert(
        reader.tryGetRewardRule('definition:reward-rule:absent' as never) === undefined,
        'tryGetRewardRule 應回 undefined',
      );
    },
  },
  {
    name: '跨 kind 存取明確拋錯（currency reader 不得取到 price-rule 定義）',
    run: () => {
      const reader = createEconomyDefinitionReader(registry());
      let threw = false;
      try {
        reader.getCurrency(SHOP_PRICE_RULE as never);
      } catch {
        threw = true;
      }
      assert(threw, '跨 kind 存取應拋錯');
      assert(
        reader.tryGetCurrency(SHOP_PRICE_RULE as never) === undefined,
        'tryGetCurrency 跨 kind 應回 undefined，不得回別的 kind 的定義',
      );
    },
  },
  {
    name: '真 reader 驅動真 Handler：GrantCurrency 的金額來自 registry 讀出的 Reward Rule',
    run: () => {
      const reader = createEconomyDefinitionReader(registry());
      const result = handleGrantCurrency(
        {
          type: 'GrantCurrency',
          transferId: 'transfer-reader-grant' as never,
          toAccountId: ACC_DISTRIBUTION,
          rewardRuleId: REWARD_DUNGEON_GOLD,
          reason: 'dungeonGold',
          sourceId: BUYER,
        },
        fixtureEconomyState(),
        makeHandlerContext({ definitions: reader }),
      );
      assert(result.ok, `命令應被接受（實得 ${result.ok ? 'accept' : result.rejection.code}）`);
      if (!result.ok) return;
      const balance = requireAccount(result.result.nextSlice, ACC_DISTRIBUTION).balance;
      assert(balance === REWARD_GOLD_AMOUNT, `清算帳戶應入帳 ${REWARD_GOLD_AMOUNT}（實得 ${balance}）`);
    },
  },
  {
    name: '真 reader 驅動真 Query：購買 Quote 的修正、疊加、進位與底價全部來自 registry',
    run: () => {
      const reader = createEconomyDefinitionReader(registry());
      const state = fixtureEconomyState();
      const query = createEconomyQuery(state, makeQueryContext({ definitions: reader }));
      const quote = query.getPurchaseQuote({
        offerId: OFFER,
        buyerCharacterId: BUYER,
        sourceRevision: OFFER_REVISION,
      });
      const expected = Math.floor(BASE_VALUE * (1 - TRADE_BONUS_BUYER / 100) + 10);
      assert(quote.amount === expected, `買價應為 ${expected}（實得 ${quote.amount}）`);
      assert(
        quote.modifierBreakdown.length === 2,
        `registry 標記 enabled=false 的修正不得列入明細（實得 ${quote.modifierBreakdown.length} 筆）`,
      );
      assert(
        String(quote.priceRuleId) === String(SHOP_PRICE_RULE),
        'Quote 應指名它用的 Price Rule',
      );
      assert(
        quote.validFor.sourceRevision === (OFFER_REVISION as Revision),
        'Quote 應綁定價格來源 Revision',
      );
    },
  },
];

export function runTestResults(): readonly ReaderTestResult[] {
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
    throw new Error(`economy-reader tests failed (${failed.length}/${results.length}):\n${lines}`);
  }
}
