// modules/economy/queries.ts
// EconomyQuery 在 Slice 快照上的純函式實作（doc §4）。
//
// Quote 是**可重建、不可存檔**的 DTO：它綁定價格來源的 Revision 與相關 Pricing Epoch，
// 成交前必須重新比對（isPriceQuoteCurrent）。這個檔案裡沒有任何價格、稅率、匯率或折扣：
//
//   基礎價值   ← EconomyPriceSourcePort（city 的 ShopOffer / item 的 intrinsicValue / 服務定義）
//   套哪些修正 ← PriceRuleDefinition.buyModifierIds / sellModifierIds
//   每筆修正值 ← PriceModifierRuleDefinition.resolverId → EconomyPriceModifierResolverPort
//   疊加方式   ← PriceModifierRuleDefinition.stackPolicy（程式只實作三種疊加**形狀**）
//   進位與底價 ← PriceRuleDefinition.roundingPolicy / minimumPrice
//
// 程式裡唯一的數值是乘法單位元 1（判斷 multiply／strongest 修正離「不改變價格」多遠）與
// 加法單位元 0，兩者都不是可調參數。
//
// 缺資料的處理：Quote 的回傳型別是**非選填**的 PriceQuote，所以「產不出價格」只能明確失敗。
// 這裡一律拋出可定位的錯誤，不回一個看起來合理的價格——後者換一份 Content Pack 也不會改變。

import type {
  AssetDistributionId,
  CharacterId,
  CityId,
  CurrencyId,
  DefinitionId,
  EconomyAccountId,
  ItemInstanceId,
  PriceModifierRuleId,
  PriceQuoteId,
  PriceRuleId,
  ResolverId,
  Revision,
  ShopOfferId,
} from '../../contracts/core';
import type {
  EconomyDefinitionReader,
  EconomyQuery,
  EconomyState,
  PriceModifierBreakdown,
  PriceQuote,
  PriceRuleDefinition,
  PriceScopeKey,
  PurchaseQuoteInput,
  SellQuoteInput,
  ServiceQuoteInput,
} from '../../contracts/economy';

import {
  citySettlementScope,
  epochOf,
  epochSnapshotFor,
  findAssetDistributionAccountId,
  findCharacterAccountId,
  requireAccount,
  type PriceScope,
} from './state';

// ──────────────────────────────────────────────────────────────────────────
// 注入 Port（本地宣告；實作由 Composition 注入）
// ──────────────────────────────────────────────────────────────────────────

// 價格來源。Economy **不擁有**商品實體、貨架 Offer 或服務定義（doc §1.2），因此基礎價值與
// 「用哪一條 Price Rule」都必須從擁有者取得：
//   * 購買 ← city 的 `ShopOffer.priceRuleId` + 該 Offer 指向 Item 的價值來源
//   * 販售 ← 該 Item 的 `intrinsicValue` + 城市商店規則指定的 Price Rule
//   * 服務 ← 服務定義自己的基礎價格與 Price Rule
// `sourceRevision` 是來源實體目前的 Revision；Quote 綁它，成交前重新比對（doc §4、§8.5）。
export type PriceSourceView = Readonly<{
  priceRuleId: PriceRuleId;
  currencyId: CurrencyId;
  // 最小貨幣單位的非負整數。實際數字全部來自內容（Item intrinsicValue／Offer 固定價／服務定義）。
  baseValue: number;
  sourceRevision: Revision;
}>;

export interface EconomyPriceSourcePort {
  tryGetPurchaseSource(offerId: ShopOfferId): PriceSourceView | undefined;
  tryGetSellSource(
    input: Readonly<{ itemSourceId: ItemInstanceId; cityId: CityId }>,
  ): PriceSourceView | undefined;
  tryGetServiceSource(
    input: Readonly<{
      serviceKind: ServiceQuoteInput['serviceKind'];
      serviceDefinitionId: DefinitionId;
      providerCharacterId: CharacterId;
    }>,
  ): PriceSourceView | undefined;
}

// progression 的事實：交流熟練度的個人買賣加成。
// doc §2.2：「每筆角色個人買入／賣出 Quote 必須把
// ProgressionQuery.getSocialMasteryBenefits(characterId).personalTradeBonus 納入資料指定的
// Price Modifier Resolver」。加成**依付款／收款角色本人**計算，Team 沒有買賣加成，所以同隊
// 不同角色付款時各自重算自己的 Quote（見 buildQuote 的 subjectCharacterId）。
// Economy 不讀 progression 的 State，只收這個窄化 Port。
export interface EconomyTradeBonusPort {
  getPersonalTradeBonus(characterId: CharacterId): number;
}

// social 的事實：玩家對該冒險者的好感所產生的家教價格修正（doc §4）。
// Economy 不保存第二份好感值（不變量 13）。
export interface EconomyAffinityPort {
  getHomeTutorPriceModifier(adventurerId: CharacterId): number;
}

// 一筆 Price Modifier 的資料化計算。回傳值的語意由該規則的 stackPolicy 決定：
//   * add        → 加到目前價格上的絕對量（最小貨幣單位）
//   * multiply   → 乘上目前價格的係數
//   * strongest  → 係數，但同組只有「離 1 最遠」的一筆生效
// 回傳 undefined 表示該 Resolver 在目前輸入下算不出修正：Quote 明確失敗，不當成「沒有修正」。
export type PriceModifierResolverInput = Readonly<{
  resolverId: ResolverId;
  modifierRuleId: PriceModifierRuleId;
  stackPolicy: PriceRuleModifierStackPolicy;
  direction: PriceDirection;
  currencyId: CurrencyId;
  baseValue: number;
  // 付款／收款角色本人（doc §2.2）。
  subjectCharacterId: CharacterId;
  personalTradeBonus: number;
  // 只有 homeTutor 服務報價會帶；一般買賣不套用好感修正（doc §4：NPC 彼此沒有好感）。
  homeTutorPriceModifier?: number;
  cityId?: CityId;
}>;

export type PriceDirection = 'buy' | 'sell';
export type PriceRuleModifierStackPolicy = ReturnType<
  EconomyDefinitionReader['getPriceModifierRule']
>['stackPolicy'];

export interface EconomyPriceModifierResolverPort {
  resolvePriceModifier(input: PriceModifierResolverInput): number | undefined;
}

export type EconomyQueryContext = Readonly<{
  definitions: EconomyDefinitionReader;
  priceSources: EconomyPriceSourcePort;
  progression: EconomyTradeBonusPort;
  social: EconomyAffinityPort;
  resolvers: EconomyPriceModifierResolverPort;
}>;

// ──────────────────────────────────────────────────────────────────────────
// Quote 產生
// ──────────────────────────────────────────────────────────────────────────

type QuoteRequest = Readonly<{
  // 只用於 quoteId 的決定性派生；不是內容 ID。
  kind: 'purchase' | 'sell' | 'service';
  sourceRef: string;
  source: PriceSourceView;
  direction: PriceDirection;
  subjectCharacterId: CharacterId;
  expectedSourceRevision: Revision;
  scopes: readonly PriceScope[];
  cityId?: CityId;
  homeTutorPriceModifier?: number;
}>;

function requireNonNegativeInteger(value: number, what: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`EconomyQuery: ${what} must be a non-negative integer in the smallest currency unit (got ${value})`);
  }
  return value;
}

function roundToSmallestUnit(value: number, policy: PriceRuleDefinition['roundingPolicy']): number {
  switch (policy) {
    case 'floor':
      return Math.floor(value);
    case 'ceil':
      return Math.ceil(value);
    case 'nearest':
      return Math.round(value);
  }
}

type ResolvedModifier = Readonly<{
  modifierRuleId: PriceModifierRuleId;
  stackPolicy: PriceRuleModifierStackPolicy;
  value: number;
}>;

// stackPolicy 的三種**形狀**由程式實作；哪一條規則用哪個形狀、係數多少都是資料。
//   1. 先把所有修正各自解析出來（輸入一律用 baseValue，因此結果與宣告順序無關 → 決定性）。
//   2. strongest 組只留「離乘法單位元最遠」的一筆；同距離時取宣告順序較前者。
//   3. 依宣告順序套用，逐筆記錄實際造成的價格變化量，讓 UI 解釋得出價格。
function applyModifiers(
  baseValue: number,
  resolved: readonly ResolvedModifier[],
): Readonly<{ value: number; breakdown: readonly PriceModifierBreakdown[] }> {
  let strongestIndex: number | undefined;
  let strongestDistance = 0;
  resolved.forEach((modifier, index) => {
    if (modifier.stackPolicy !== 'strongest') return;
    const distance = Math.abs(modifier.value - 1);
    if (strongestIndex === undefined || distance > strongestDistance) {
      strongestIndex = index;
      strongestDistance = distance;
    }
  });

  let running = baseValue;
  const breakdown: PriceModifierBreakdown[] = [];
  resolved.forEach((modifier, index) => {
    const before = running;
    if (modifier.stackPolicy === 'add') {
      running = before + modifier.value;
    } else if (modifier.stackPolicy === 'multiply') {
      running = before * modifier.value;
    } else if (index === strongestIndex) {
      running = before * modifier.value;
    }
    // 被同組較強者壓下的 strongest 修正仍列進明細（appliedAmount = 0），
    // 這樣 UI 說得出「這條規則存在但沒生效」，而不是整條消失。
    breakdown.push({ modifierRuleId: modifier.modifierRuleId, appliedAmount: running - before });
  });

  return { value: running, breakdown };
}

// quoteId 的決定性派生。
//
// 為什麼不由 ID 產生器配發：Quote 不進 State、不進存檔、不進 Job／Event（doc §4「可重建、不可存檔」），
// 而 Query 拿到的是唯讀快照，沒有交易私有 cursor 可推進。改為由 Quote 的完整識別輸入派生，
// 順帶把不變量 8（相同 State／Definition／Quote Input → 相同價格）延伸到 ID 上：同輸入同 ID。
function derivePriceQuoteId(
  request: QuoteRequest,
  epochs: Readonly<Record<PriceScopeKey, Revision>>,
  amount: number,
): PriceQuoteId {
  const epochSignature = Object.entries(epochs)
    .map(([key, revision]) => `${key}=${String(revision)}`)
    .sort()
    .join(',');
  return `price-quote:${request.kind}:${request.sourceRef}:${String(request.subjectCharacterId)}:${String(request.source.sourceRevision)}:${epochSignature}:${String(amount)}` as PriceQuoteId;
}

function buildQuote(
  state: EconomyState,
  ctx: EconomyQueryContext,
  request: QuoteRequest,
): PriceQuote {
  // doc §4／不變量 5：Quote 綁定價格來源的 Revision。呼叫端帶進來的 Revision 與來源目前值不符時，
  // 它看到的世界已經變了——這裡明確失敗，不悄悄用新價格覆蓋它以為的舊價格。
  if (request.source.sourceRevision !== request.expectedSourceRevision) {
    throw new Error(
      `EconomyQuery: price source revision changed (expected ${String(request.expectedSourceRevision)}, current ${String(request.source.sourceRevision)})`,
    );
  }

  const baseValue = requireNonNegativeInteger(request.source.baseValue, 'price source baseValue');
  const rule = ctx.definitions.getPriceRule(request.source.priceRuleId);
  const modifierIds = request.direction === 'buy' ? rule.buyModifierIds : rule.sellModifierIds;
  const personalTradeBonus = ctx.progression.getPersonalTradeBonus(request.subjectCharacterId);

  const resolved: ResolvedModifier[] = [];
  for (const modifierRuleId of modifierIds) {
    // 內容→內容的引用：PriceRule 指到不存在的 Modifier Rule 是壞內容，Reader 直接拋。
    const modifierRule = ctx.definitions.getPriceModifierRule(modifierRuleId);
    if (!modifierRule.enabled) continue;
    const value = ctx.resolvers.resolvePriceModifier({
      resolverId: modifierRule.resolverId,
      modifierRuleId,
      stackPolicy: modifierRule.stackPolicy,
      direction: request.direction,
      currencyId: request.source.currencyId,
      baseValue,
      subjectCharacterId: request.subjectCharacterId,
      personalTradeBonus,
      ...(request.homeTutorPriceModifier === undefined
        ? {}
        : { homeTutorPriceModifier: request.homeTutorPriceModifier }),
      ...(request.cityId === undefined ? {} : { cityId: request.cityId }),
    });
    if (value === undefined) {
      throw new Error(
        `EconomyQuery: price modifier resolver "${String(modifierRule.resolverId)}" produced no value for rule "${String(modifierRuleId)}"`,
      );
    }
    if (!Number.isFinite(value)) {
      throw new Error(
        `EconomyQuery: price modifier rule "${String(modifierRuleId)}" produced a non-finite value`,
      );
    }
    resolved.push({ modifierRuleId, stackPolicy: modifierRule.stackPolicy, value });
  }

  const applied = applyModifiers(baseValue, resolved);
  const minimumPrice = requireNonNegativeInteger(rule.minimumPrice, 'PriceRuleDefinition.minimumPrice');
  const amount = Math.max(roundToSmallestUnit(applied.value, rule.roundingPolicy), minimumPrice);

  const pricingEpochs = epochSnapshotFor(state, request.scopes);
  return {
    quoteId: derivePriceQuoteId(request, pricingEpochs, amount),
    currencyId: request.source.currencyId,
    amount,
    priceRuleId: request.source.priceRuleId,
    modifierBreakdown: [...applied.breakdown],
    validFor: { sourceRevision: request.source.sourceRevision, pricingEpochs },
  };
}

// ──────────────────────────────────────────────────────────────────────────
// EconomyQuery
// ──────────────────────────────────────────────────────────────────────────

export function createEconomyQuery(state: EconomyState, ctx: EconomyQueryContext): EconomyQuery {
  return {
    getBalance(accountId: EconomyAccountId): number {
      return requireAccount(state, accountId).balance;
    },

    getCharacterAccount(characterId: CharacterId, currencyId: CurrencyId): EconomyAccountId {
      const found = findCharacterAccountId(state, characterId, currencyId);
      if (found === undefined) {
        throw new Error(
          `EconomyQuery: character "${String(characterId)}" has no account in currency "${String(currencyId)}"`,
        );
      }
      return found;
    },

    getAssetDistributionAccount(
      distributionId: AssetDistributionId,
      currencyId: CurrencyId,
    ): EconomyAccountId {
      const found = findAssetDistributionAccountId(state, distributionId, currencyId);
      if (found === undefined) {
        throw new Error(
          `EconomyQuery: asset distribution "${String(distributionId)}" has no clearing account in currency "${String(currencyId)}"`,
        );
      }
      return found;
    },

    canAfford(accountId: EconomyAccountId, amount: number): boolean {
      return requireAccount(state, accountId).balance >= amount;
    },

    getPurchaseQuote(input: PurchaseQuoteInput): PriceQuote {
      const source = ctx.priceSources.tryGetPurchaseSource(input.offerId);
      if (source === undefined) {
        throw new Error(`EconomyQuery: no purchase price source for offer "${String(input.offerId)}"`);
      }
      return buildQuote(state, ctx, {
        kind: 'purchase',
        sourceRef: String(input.offerId),
        source,
        direction: 'buy',
        subjectCharacterId: input.buyerCharacterId,
        expectedSourceRevision: input.sourceRevision,
        scopes: [{ kind: 'characterReputation', characterId: input.buyerCharacterId }],
      });
    },

    getSellQuote(input: SellQuoteInput): PriceQuote {
      const source = ctx.priceSources.tryGetSellSource({
        itemSourceId: input.itemSourceId,
        cityId: input.cityId,
      });
      if (source === undefined) {
        throw new Error(
          `EconomyQuery: no sell price source for item "${String(input.itemSourceId)}" in city "${String(input.cityId)}"`,
        );
      }
      return buildQuote(state, ctx, {
        kind: 'sell',
        sourceRef: `${String(input.itemSourceId)}@${String(input.cityId)}`,
        source,
        direction: 'sell',
        subjectCharacterId: input.sellerCharacterId,
        expectedSourceRevision: input.sourceRevision,
        cityId: input.cityId,
        scopes: [
          citySettlementScope(input.cityId),
          { kind: 'characterReputation', characterId: input.sellerCharacterId },
        ],
      });
    },

    getServiceQuote(input: ServiceQuoteInput): PriceQuote {
      const source = ctx.priceSources.tryGetServiceSource({
        serviceKind: input.serviceKind,
        serviceDefinitionId: input.serviceDefinitionId,
        providerCharacterId: input.providerCharacterId,
      });
      if (source === undefined) {
        throw new Error(
          `EconomyQuery: no service price source for "${String(input.serviceDefinitionId)}" provided by "${String(input.providerCharacterId)}"`,
        );
      }
      // doc §4：家教 Quote 的好感修正只能來自 Social Query，且只影響玩家向該冒險者請求擔任家教的價格。
      // 它以 Resolver 輸入的形式進入某條 Price Modifier Rule，因此在 modifierBreakdown 裡是一筆可解釋的明細。
      return buildQuote(state, ctx, {
        kind: 'service',
        sourceRef: `${String(input.serviceDefinitionId)}@${String(input.providerCharacterId)}`,
        source,
        direction: 'buy',
        subjectCharacterId: input.buyerCharacterId,
        expectedSourceRevision: input.sourceRevision,
        homeTutorPriceModifier: ctx.social.getHomeTutorPriceModifier(input.providerCharacterId),
        scopes: [
          { kind: 'adventurerAffinity', adventurerId: input.providerCharacterId },
          { kind: 'characterReputation', characterId: input.providerCharacterId },
        ],
      });
    },
  };
}

// ──────────────────────────────────────────────────────────────────────────
// 成交前的 Quote 重新比對（不變量 5）
// ──────────────────────────────────────────────────────────────────────────
//
// `EconomyQuery` 契約沒有這個方法，但不變量 5「Quote Revision 過期時不能成交」必須有實作點：
// 購買／販售 Workflow 在 TransferCurrency 之前用它比對來源 Revision 與每一筆綁定的 Pricing Epoch。
// 以獨立純函式匯出（比照 map 的 isMapOccupied），不放進 Query 介面，避免動到跨模組型別。
export function isPriceQuoteCurrent(
  state: EconomyState,
  quote: PriceQuote,
  currentSourceRevision: Revision,
): boolean {
  if (quote.validFor.sourceRevision !== currentSourceRevision) return false;
  for (const [key, boundRevision] of Object.entries(quote.validFor.pricingEpochs)) {
    if (boundRevision !== epochOf(state, key as PriceScopeKey)) return false;
  }
  return true;
}
