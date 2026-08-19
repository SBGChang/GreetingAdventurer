// app/content/distribution-reader.test.ts
// 證明 data-runtime → AssetDistributionDefinitionReader 的 adapter 路徑：
//   1. 由記憶體內 content pack 建 DefinitionRegistry → createAssetDistributionDefinitionReader，
//      getRule 投影出領域定義（header 取 registry 權威值 + 領域欄位取作者資料）。
//   2. 未知 id / 跨 kind 存取明確拋錯（不靜默回 undefined）。
//   3. 端到端：真 reader 換進 distribution 的 Handler，跑 Start→Append→Finalize→Resolve；
//      流標直售價 80（= floor(100 × 0.8)）的 0.8 完全來自 registry 裡的定義資料。
//      換掉倍率就換掉結果——這是「公式住程式、調校住資料」的實證。

import type { ContentPackId, DefinitionId, TransactionMessageDraft } from '../../contracts/core';
import {
  createDefinitionRegistry,
  type ContentDefinition,
  type ContentManifestIdentity,
  type DefinitionRegistry,
} from '../../data-runtime';

import type { AssetDistributionDomainEvent } from '../../contracts/distribution';
import {
  ALLY_A,
  ALLY_B,
  DISTRIBUTION_ID,
  HERO,
  ITEM_1,
  MAP_ID,
  RULE_AUCTION,
  TEAM_ID,
  emptyState,
  makeContext,
} from '../../modules/distribution/fixtures';
import {
  handleAppendAssetDistributionResult,
  handleFinalizeAssetDistributionCollection,
  handleResolveLootAuctionRound,
  handleStartAssetDistribution,
  type AssetDistributionHandlerResult,
} from '../../modules/distribution/system';

import {
  createAssetDistributionDefinitionReader,
  DISTRIBUTION_DEFINITION_KINDS,
} from './distribution-reader';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function expectOk(r: AssetDistributionHandlerResult, label: string) {
  if (!r.ok) throw new Error(`${label}: expected accept, got reject ${r.rejection.code}`);
  return r.result;
}

const PACK = 'pack:distribution-bringup' as ContentPackId;
const NPC_RULE_ID = 'rule-npc-registry';
const OTHER_KIND_ID = 'gathering-rule-x';

function def(id: string, kind: string, data: Record<string, unknown>): ContentDefinition {
  return {
    id: id as DefinitionId,
    kind,
    schemaVersion: 1,
    packId: PACK,
    enabled: true,
    sourcePath: `mem://${kind}/${id}`,
    data: data as ContentDefinition['data'],
  };
}

// 對齊 distribution FIXTURE 的最小 bring-up 定義集。
function distributionDefinitions(): readonly ContentDefinition[] {
  return [
    def(RULE_AUCTION, DISTRIBUTION_DEFINITION_KINDS.assetDistributionRule, {
      sourceKind: 'dungeonLoot',
      controllerPolicy: 'playerAuction',
      currencyPolicy: 'equalSplit',
      itemPolicy: 'internalAuction',
      auction: {
        minimumBid: 'intrinsicValue',
        unclaimedSaleMultiplier: 0.8,
        companionBidResolverId: 'companion-bid',
        tieBreakPolicy: 'deterministicFromDistributionId',
      },
      remainderPolicy: 'deterministicRotation',
    }),
    // 同一個 reader 家族的第二筆：證明窄化 reader 依 id 取到正確那一筆。
    def(NPC_RULE_ID, DISTRIBUTION_DEFINITION_KINDS.assetDistributionRule, {
      sourceKind: 'dungeonLoot',
      controllerPolicy: 'npcRng',
      currencyPolicy: 'equalSplit',
      itemPolicy: 'rngPerItem',
      npcItemRecipientResolverId: 'npc-recipient',
      remainderPolicy: 'deterministicRotation',
    }),
    // 別的 kind：不屬本 reader 的 ownedKinds，跨 kind 存取必須拋錯。
    def(OTHER_KIND_ID, 'gathering-rule', { dungeonInteractionMinutes: 15 }),
  ];
}

const IDENTITY: ContentManifestIdentity = {
  manifestVersion: '0.0.0-bringup',
  manifestHash: 'bringup',
  packs: [{ packId: PACK, version: '0.0.0', hash: 'bringup' }],
};

function registry(): DefinitionRegistry {
  return createDefinitionRegistry(distributionDefinitions(), IDENTITY);
}

function ruleId(raw: string): typeof RULE_AUCTION {
  return raw as typeof RULE_AUCTION;
}

function eventsOf(messages: readonly TransactionMessageDraft[]): AssetDistributionDomainEvent[] {
  return messages
    .filter((m): m is { event: unknown } => 'event' in m)
    .map((m) => m.event as AssetDistributionDomainEvent);
}

export type ReaderTestResult = Readonly<{ name: string; pass: boolean; error?: string }>;

const CASES: readonly Readonly<{ name: string; run: () => void }>[] = [
  {
    name: 'getRule 由 registry 投影出領域定義（header + 競拍調校欄位）',
    run: () => {
      const rule = createAssetDistributionDefinitionReader(registry()).getRule(RULE_AUCTION);
      assert(String(rule.id) === String(RULE_AUCTION), 'id 應為 registry 權威值');
      assert(rule.enabled === true, 'enabled 應取自 registry header');
      assert(String(rule.packId) === String(PACK), 'packId 應取自 registry header');
      assert(rule.sourceKind === 'dungeonLoot', `sourceKind（實得 ${rule.sourceKind}）`);
      assert(rule.controllerPolicy === 'playerAuction', `controllerPolicy（實得 ${rule.controllerPolicy}）`);
      assert(rule.itemPolicy === 'internalAuction', `itemPolicy（實得 ${rule.itemPolicy}）`);
      assert(rule.remainderPolicy === 'deterministicRotation', 'remainderPolicy 應取自 data');
      const auction = rule.auction;
      assert(auction !== undefined, 'auction 區塊應存在');
      if (auction === undefined) return;
      assert(auction.minimumBid === 'intrinsicValue', '底價政策應取自 data');
      assert(auction.unclaimedSaleMultiplier === 0.8, '流標倍率應取自 data');
      assert(String(auction.companionBidResolverId) === 'companion-bid', 'Companion Resolver 應取自 data');
      assert(auction.tieBreakPolicy === 'deterministicFromDistributionId', '平手政策應取自 data');
    },
  },
  {
    name: '同 kind 的第二筆規則各自取到自己的 policy（npcRng / rngPerItem）',
    run: () => {
      const rule = createAssetDistributionDefinitionReader(registry()).getRule(ruleId(NPC_RULE_ID));
      assert(rule.controllerPolicy === 'npcRng', `controllerPolicy（實得 ${rule.controllerPolicy}）`);
      assert(rule.itemPolicy === 'rngPerItem', `itemPolicy（實得 ${rule.itemPolicy}）`);
      assert(rule.npcItemRecipientResolverId !== undefined, 'NPC 收受者 Resolver 應存在');
      assert(rule.auction === undefined, 'npcRng 沒有 auction 區塊');
    },
  },
  {
    name: '未知 id 明確拋錯（不靜默回 undefined）',
    run: () => {
      const reader = createAssetDistributionDefinitionReader(registry());
      let threw = false;
      try {
        reader.getRule(ruleId('definition:asset-distribution-rule:absent'));
      } catch {
        threw = true;
      }
      assert(threw, '未知 id 應拋錯');
    },
  },
  {
    name: '跨 kind 存取明確拋錯（distribution reader 不得取到 gathering 定義）',
    run: () => {
      const reader = createAssetDistributionDefinitionReader(registry());
      let threw = false;
      try {
        reader.getRule(ruleId(OTHER_KIND_ID));
      } catch {
        threw = true;
      }
      assert(threw, '跨 kind 存取應拋錯');
    },
  },
  {
    name: '端到端：真 reader 驅動一輪流標直售，直售價 80 完全來自 registry 的 0.8',
    run: () => {
      const ctx = makeContext({
        definitions: createAssetDistributionDefinitionReader(registry()),
      });
      let state = expectOk(
        handleStartAssetDistribution(
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
        'start',
      ).nextSlice;
      state = expectOk(
        handleAppendAssetDistributionResult(
          {
            type: 'AppendAssetDistributionResult',
            distributionId: DISTRIBUTION_ID,
            itemIds: [ITEM_1],
            currencyInputs: [],
          },
          state,
          ctx,
        ),
        'append',
      ).nextSlice;
      state = expectOk(
        handleFinalizeAssetDistributionCollection(
          { type: 'FinalizeAssetDistributionCollection', distributionId: DISTRIBUTION_ID },
          state,
          ctx,
        ),
        'finalize',
      ).nextSlice;
      const resolved = expectOk(
        handleResolveLootAuctionRound(
          state,
          TEAM_ID,
          { type: 'resolveLootAuctionRound', distributionId: DISTRIBUTION_ID, itemId: ITEM_1 },
          ctx,
        ),
        'resolveLootAuctionRound',
      );

      const events = eventsOf(resolved.outgoingMessages);
      const sold = events.find((e) => e.type === 'LootItemDirectSold');
      assert(sold !== undefined, '無人出價應直售');
      assert(
        sold !== undefined && sold.type === 'LootItemDirectSold' && sold.saleValue.amount === 80,
        '直售價應為 floor(100 × 0.8) = 80（倍率來自 registry）',
      );
      assert(
        events.some((e) => e.type === 'AssetDistributionCompleted'),
        '全部品項處置完應發 AssetDistributionCompleted（地牢返城屏障掛在此事件）',
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
    throw new Error(`distribution-reader tests failed (${failed.length}/${results.length}):\n${lines}`);
  }
}
