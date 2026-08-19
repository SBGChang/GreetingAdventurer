// modules/distribution/fixtures.ts
// 最小 Fixture：三種 Policy 的 AssetDistributionRuleDefinition（playerAuction / npcRng /
// equalCurrencyOnly）+ 決定性 stub Port（Definition Reader、economy／inventory／team Query、
// Resolver、ID 配發器）與一站式 AssetDistributionHandlerContext。
//
// 所有 stub 皆為決定性（無真 RNG／時間）：Resolver 依腳本回答，並把收到的 cursor 記錄下來，
// 讓測試可以斷言 cursor 逐次前進而不是重用同一個。

import type {
  AssetDistributionId,
  CharacterId,
  ContentPackId,
  CurrencyId,
  EconomyAccountId,
  EconomyTransferId,
  InteractionId,
  ItemInstanceId,
  MapInstanceId,
  QuestId,
  ResolverId,
  Revision,
  RngContext,
  RngCursor,
  RngStreamId,
  Seed,
  TeamId,
  WorldDay,
} from '../../contracts/core';
import type {
  AssetDistribution,
  AssetDistributionDefinitionReader,
  AssetDistributionRuleDefinition,
  AssetDistributionRuleId,
  MoneyValue,
} from '../../contracts/distribution';
import type {
  AssetDistributionHandlerContext,
  AssetDistributionIdAllocator,
  CompanionBidDecision,
  DistributionEconomyQuery,
  DistributionInventoryQuery,
  DistributionResolverPort,
  DistributionTeamQuery,
  EconomySystemAccountPurpose,
} from './system';
import { createAssetDistributionState, type AssetDistributionModuleState } from './state';

// ── ID 常數 ──────────────────────────────────────────────────────────────────
const PACK_ID = 'pack-test' as ContentPackId;

export const DISTRIBUTION_ID = 'dist-1' as AssetDistributionId;
export const OTHER_DISTRIBUTION_ID = 'dist-2' as AssetDistributionId;
export const TEAM_ID = 'team-1' as TeamId;
export const OTHER_TEAM_ID = 'team-2' as TeamId;

export const HERO = 'char-hero' as CharacterId; // 玩家控制的角色
export const ALLY_A = 'char-ally-a' as CharacterId;
export const ALLY_B = 'char-ally-b' as CharacterId;
export const OUTSIDER = 'char-outsider' as CharacterId;

export const ITEM_1 = 'item-1' as ItemInstanceId;
export const ITEM_2 = 'item-2' as ItemInstanceId;
export const ITEM_UNPRICED = 'item-unpriced' as ItemInstanceId;

export const COIN = 'currency-coin' as CurrencyId;

export const MAP_ID = 'map-1' as MapInstanceId;
export const QUEST_ID = 'quest-1' as QuestId;

export const RULE_AUCTION = 'rule-auction' as AssetDistributionRuleId;
export const RULE_NPC_RNG = 'rule-npc-rng' as AssetDistributionRuleId;
export const RULE_CURRENCY_ONLY = 'rule-currency-only' as AssetDistributionRuleId;
export const RULE_DISABLED = 'rule-disabled' as AssetDistributionRuleId;
export const RULE_AUCTION_NO_CONFIG = 'rule-auction-no-config' as AssetDistributionRuleId;
export const RULE_NPC_NO_RESOLVER = 'rule-npc-no-resolver' as AssetDistributionRuleId;
export const RULE_QUEST_AUCTION = 'rule-quest-auction' as AssetDistributionRuleId;

const COMPANION_BID_RESOLVER = 'companion-bid' as ResolverId;
const NPC_RECIPIENT_RESOLVER = 'npc-recipient' as ResolverId;

export const ESCROW_ACCOUNT = 'acct-escrow' as EconomyAccountId;
export const HERO_ACCOUNT = 'acct-hero' as EconomyAccountId;
export const ALLY_A_ACCOUNT = 'acct-ally-a' as EconomyAccountId;
export const ALLY_B_ACCOUNT = 'acct-ally-b' as EconomyAccountId;
export const DUNGEON_GOLD_ACCOUNT = 'acct-dungeon-gold' as EconomyAccountId;
export const QUEST_REWARD_ACCOUNT = 'acct-quest-rewards' as EconomyAccountId;
export const DIRECT_SALE_ACCOUNT = 'acct-direct-sale' as EconomyAccountId;

export const WORLD_DAY = 10 as WorldDay;

// ── Rule Definitions ────────────────────────────────────────────────────────

function header(id: AssetDistributionRuleId, enabled = true) {
  return { id, schemaVersion: 1, packId: PACK_ID, enabled };
}

export const AUCTION_RULE: AssetDistributionRuleDefinition = {
  ...header(RULE_AUCTION),
  sourceKind: 'dungeonLoot',
  controllerPolicy: 'playerAuction',
  currencyPolicy: 'equalSplit',
  itemPolicy: 'internalAuction',
  auction: {
    minimumBid: 'intrinsicValue',
    unclaimedSaleMultiplier: 0.8,
    companionBidResolverId: COMPANION_BID_RESOLVER,
    tieBreakPolicy: 'deterministicFromDistributionId',
  },
  remainderPolicy: 'deterministicRotation',
};

export const QUEST_AUCTION_RULE: AssetDistributionRuleDefinition = {
  ...AUCTION_RULE,
  ...header(RULE_QUEST_AUCTION),
  sourceKind: 'expiredQuestCargo',
};

export const NPC_RNG_RULE: AssetDistributionRuleDefinition = {
  ...header(RULE_NPC_RNG),
  sourceKind: 'dungeonLoot',
  controllerPolicy: 'npcRng',
  currencyPolicy: 'equalSplit',
  itemPolicy: 'rngPerItem',
  npcItemRecipientResolverId: NPC_RECIPIENT_RESOLVER,
  remainderPolicy: 'deterministicRotation',
};

export const CURRENCY_ONLY_RULE: AssetDistributionRuleDefinition = {
  ...header(RULE_CURRENCY_ONLY),
  sourceKind: 'questReward',
  controllerPolicy: 'equalCurrencyOnly',
  currencyPolicy: 'equalSplit',
  itemPolicy: 'none',
  remainderPolicy: 'deterministicRotation',
};

export const DISABLED_RULE: AssetDistributionRuleDefinition = {
  ...NPC_RNG_RULE,
  ...header(RULE_DISABLED, false),
};

// controllerPolicy: playerAuction 卻沒有 auction 區塊——啟動時就該被擋下。
export const AUCTION_RULE_WITHOUT_CONFIG: AssetDistributionRuleDefinition = {
  ...header(RULE_AUCTION_NO_CONFIG),
  sourceKind: 'dungeonLoot',
  controllerPolicy: 'playerAuction',
  currencyPolicy: 'equalSplit',
  itemPolicy: 'internalAuction',
  remainderPolicy: 'deterministicRotation',
};

// itemPolicy: rngPerItem 卻沒有 npcItemRecipientResolverId。
export const NPC_RULE_WITHOUT_RESOLVER: AssetDistributionRuleDefinition = {
  ...header(RULE_NPC_NO_RESOLVER),
  sourceKind: 'dungeonLoot',
  controllerPolicy: 'npcRng',
  currencyPolicy: 'equalSplit',
  itemPolicy: 'rngPerItem',
  remainderPolicy: 'deterministicRotation',
};

const ALL_RULES: readonly AssetDistributionRuleDefinition[] = [
  AUCTION_RULE,
  QUEST_AUCTION_RULE,
  NPC_RNG_RULE,
  CURRENCY_ONLY_RULE,
  DISABLED_RULE,
  AUCTION_RULE_WITHOUT_CONFIG,
  NPC_RULE_WITHOUT_RESOLVER,
];

export function stubDefinitionReader(
  rules: readonly AssetDistributionRuleDefinition[] = ALL_RULES,
): AssetDistributionDefinitionReader {
  return {
    getRule(id: AssetDistributionRuleId): AssetDistributionRuleDefinition {
      const found = rules.find((r) => r.id === id);
      if (found === undefined) throw new Error(`stub reader: unknown rule "${String(id)}"`);
      return found;
    },
  };
}

// ── economy stub ────────────────────────────────────────────────────────────

export type EconomyStubOptions = Readonly<{
  balances?: Readonly<Record<string, number>>;
  // 未列出的 (distribution, currency) 視為「清算帳戶還沒建立」。
  settlementAccounts?: readonly Readonly<{
    distributionId: AssetDistributionId;
    currencyId: CurrencyId;
    accountId: EconomyAccountId;
  }>[];
  characterAccounts?: readonly Readonly<{
    characterId: CharacterId;
    currencyId: CurrencyId;
    accountId: EconomyAccountId;
  }>[];
  systemAccounts?: readonly Readonly<{
    purpose: EconomySystemAccountPurpose;
    currencyId: CurrencyId;
    accountId: EconomyAccountId;
  }>[];
  smallestUnits?: Readonly<Record<string, number>>;
}>;

export const DEFAULT_SETTLEMENT_ACCOUNTS = [
  { distributionId: DISTRIBUTION_ID, currencyId: COIN, accountId: ESCROW_ACCOUNT },
] as const;

export const DEFAULT_CHARACTER_ACCOUNTS = [
  { characterId: HERO, currencyId: COIN, accountId: HERO_ACCOUNT },
  { characterId: ALLY_A, currencyId: COIN, accountId: ALLY_A_ACCOUNT },
  { characterId: ALLY_B, currencyId: COIN, accountId: ALLY_B_ACCOUNT },
] as const;

export const DEFAULT_SYSTEM_ACCOUNTS = [
  { purpose: 'dungeonGoldSource', currencyId: COIN, accountId: DUNGEON_GOLD_ACCOUNT },
  { purpose: 'questRewards', currencyId: COIN, accountId: QUEST_REWARD_ACCOUNT },
  { purpose: 'lootDirectSaleSource', currencyId: COIN, accountId: DIRECT_SALE_ACCOUNT },
] as const;

export const DEFAULT_BALANCES: Readonly<Record<string, number>> = {
  [String(HERO_ACCOUNT)]: 1000,
  [String(ALLY_A_ACCOUNT)]: 1000,
  [String(ALLY_B_ACCOUNT)]: 1000,
  [String(ESCROW_ACCOUNT)]: 0,
  [String(DUNGEON_GOLD_ACCOUNT)]: 1_000_000,
  [String(QUEST_REWARD_ACCOUNT)]: 1_000_000,
  [String(DIRECT_SALE_ACCOUNT)]: 1_000_000,
};

export function stubEconomy(options: EconomyStubOptions = {}): DistributionEconomyQuery {
  const balances = options.balances ?? DEFAULT_BALANCES;
  const settlement = options.settlementAccounts ?? DEFAULT_SETTLEMENT_ACCOUNTS;
  const characters = options.characterAccounts ?? DEFAULT_CHARACTER_ACCOUNTS;
  const systems = options.systemAccounts ?? DEFAULT_SYSTEM_ACCOUNTS;
  const units = options.smallestUnits ?? { [String(COIN)]: 1 };

  return {
    findSettlementAccount(distributionId, currencyId) {
      return settlement.find(
        (a) => a.distributionId === distributionId && a.currencyId === currencyId,
      )?.accountId;
    },
    findCharacterAccount(characterId, currencyId) {
      return characters.find((a) => a.characterId === characterId && a.currencyId === currencyId)
        ?.accountId;
    },
    findSystemAccount(purpose, currencyId) {
      return systems.find((a) => a.purpose === purpose && a.currencyId === currencyId)?.accountId;
    },
    findCurrencySmallestUnit(currencyId) {
      return units[String(currencyId)];
    },
    canAfford(accountId, amount) {
      const balance = balances[String(accountId)];
      if (balance === undefined) return false;
      return balance >= amount;
    },
  };
}

// ── inventory stub ──────────────────────────────────────────────────────────

export const DEFAULT_INTRINSIC_VALUES: readonly Readonly<{
  itemId: ItemInstanceId;
  value: MoneyValue;
}>[] = [
  { itemId: ITEM_1, value: { currencyId: COIN, amount: 100 } },
  { itemId: ITEM_2, value: { currencyId: COIN, amount: 50 } },
];

export function stubInventory(
  values: readonly Readonly<{ itemId: ItemInstanceId; value: MoneyValue }>[] = DEFAULT_INTRINSIC_VALUES,
): DistributionInventoryQuery {
  return {
    findIntrinsicValue(itemId) {
      return values.find((v) => v.itemId === itemId)?.value;
    },
  };
}

// ── team stub ───────────────────────────────────────────────────────────────

export function stubTeam(controller: CharacterId = HERO): DistributionTeamQuery {
  return { findPlayerControlledCharacterId: () => controller };
}

// team 查不到玩家控制角色（壞存檔／NPC 隊誤走玩家競拍）。
// 刻意獨立成常數：`stubTeam(undefined)` 會觸發預設參數而回到 HERO，那個陷阱踩過一次。
export const TEAM_WITHOUT_CONTROLLER: DistributionTeamQuery = {
  findPlayerControlledCharacterId: () => undefined,
};

// ── Resolver stub（決定性 + cursor 記錄）─────────────────────────────────────

export type ResolverStub = Readonly<{
  port: DistributionResolverPort;
  companionCursors: number[];
  npcCursors: number[];
}>;

export function stubResolvers(
  options: Readonly<{
    companionDecisions?: Readonly<Record<string, CompanionBidDecision>>;
    npcRecipients?: readonly CharacterId[];
  }> = {},
): ResolverStub {
  const companionCursors: number[] = [];
  const npcCursors: number[] = [];
  const decisions = options.companionDecisions ?? {};
  const recipients = options.npcRecipients ?? [];
  let npcIndex = 0;

  const port: DistributionResolverPort = {
    resolveCompanionBid(input) {
      companionCursors.push(input.rng.cursor);
      const decision = decisions[String(input.bidderCharacterId)];
      return {
        value: decision === undefined ? { kind: 'pass' } : decision,
        nextCursor: (input.rng.cursor + 1) as RngCursor,
      };
    },
    resolveNpcItemRecipient(input) {
      npcCursors.push(input.rng.cursor);
      const picked = recipients[npcIndex] ?? input.participantCharacterIds[0];
      npcIndex += 1;
      if (picked === undefined) {
        throw new Error('stub resolver: no participant to award to');
      }
      return {
        value: picked,
        nextCursor: (input.rng.cursor + 1) as RngCursor,
      };
    },
  };

  return { port, companionCursors, npcCursors };
}

// ── ID 配發器 stub ──────────────────────────────────────────────────────────

export type IdAllocatorStub = Readonly<{
  allocator: AssetDistributionIdAllocator;
  interactionIds: InteractionId[];
  transferIds: EconomyTransferId[];
}>;

export function stubIds(): IdAllocatorStub {
  const interactionIds: InteractionId[] = [];
  const transferIds: EconomyTransferId[] = [];
  let interactionSeq = 0;
  let transferSeq = 0;
  return {
    interactionIds,
    transferIds,
    allocator: {
      nextInteractionId() {
        interactionSeq += 1;
        const id = `interaction-${interactionSeq}` as InteractionId;
        interactionIds.push(id);
        return id;
      },
      nextEconomyTransferId() {
        transferSeq += 1;
        const id = `transfer-${transferSeq}` as EconomyTransferId;
        transferIds.push(id);
        return id;
      },
    },
  };
}

// ── RngContext ──────────────────────────────────────────────────────────────

export function fixtureRngContext(cursor = 0): RngContext {
  return {
    worldSeed: 'seed-distribution-fixture' as Seed,
    streamId: 'stream-distribution' as RngStreamId,
    cursor: cursor as RngCursor,
  };
}

// ── 一站式 Context ──────────────────────────────────────────────────────────

export type ContextOverrides = Readonly<{
  worldDay?: WorldDay;
  definitions?: AssetDistributionDefinitionReader;
  economy?: DistributionEconomyQuery;
  inventory?: DistributionInventoryQuery;
  team?: DistributionTeamQuery;
  ids?: AssetDistributionIdAllocator;
  resolvers?: DistributionResolverPort;
  rngContext?: RngContext;
}>;

export function makeContext(overrides: ContextOverrides = {}): AssetDistributionHandlerContext {
  return {
    worldDay: overrides.worldDay ?? WORLD_DAY,
    definitions: overrides.definitions ?? stubDefinitionReader(),
    economy: overrides.economy ?? stubEconomy(),
    inventory: overrides.inventory ?? stubInventory(),
    team: overrides.team ?? stubTeam(),
    ids: overrides.ids ?? stubIds().allocator,
    resolvers: overrides.resolvers ?? stubResolvers().port,
    rngContext: overrides.rngContext ?? fixtureRngContext(),
  };
}

export function emptyState(): AssetDistributionModuleState {
  return createAssetDistributionState();
}

// ── 直接鑄造 Runtime State（測某些只有壞存檔／壞內容才會走到的分支）──────────
export function makeDistribution(
  overrides: Partial<AssetDistribution> = {},
): AssetDistribution {
  return {
    distributionId: DISTRIBUTION_ID,
    source: { kind: 'dungeonLoot', mapId: MAP_ID },
    teamId: TEAM_ID,
    participantCharacterIds: [HERO, ALLY_A, ALLY_B],
    ruleId: RULE_AUCTION,
    itemIds: [],
    currencyInputs: [],
    settlementAccountIds: {},
    currentItemIndex: 0,
    auctionRounds: [],
    status: 'collecting',
    revision: 0 as Revision,
    rngContext: fixtureRngContext(),
    ...overrides,
  };
}

export function stateWith(
  ...distributions: readonly AssetDistribution[]
): AssetDistributionModuleState {
  return createAssetDistributionState({ distributions });
}
