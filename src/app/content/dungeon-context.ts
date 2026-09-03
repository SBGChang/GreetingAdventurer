// app/content/dungeon-context.ts
// `DungeonContext` 與 `TeamWorldReader` 的正式組裝（f3_work_packages.md P3）。
//
// 這一檔把「地牢跑得起來」需要的四種東西接在一起：
//   * Definition Reader（互動規則、NPC 探索規則、戰利品分配規則）
//   * 跨模組 Query Port（map 的地形與內容、team 的位置與成員）
//   * Resolver（陷阱判定；公式在資料，不在 Handler）
//   * ID 配發器（交易私有 cursor）
//
// 規則 ID 一律**從內容選出**，不寫死字面值：唯一一筆的用 `requireSingle`，多筆的用資料欄位
// 判別（見 `requireDungeonLootRuleId`）。

import type {
  AdventureSiteId,
  AssetDistributionId,
  CityId,
  DefinitionId,
  InteractionId,
  MapInstanceId,
  NpcDungeonRunId,
  PlayerMapKnowledgeId,
  RngContext,
  WorldDay,
} from '../../contracts/core';
import type {
  AssetDistributionRuleDefinition,
  AssetDistributionRuleId,
} from '../../contracts/distribution';
import type {
  CombatSequenceId,
  CombatSequenceSourceCommitId,
} from '../../contracts/combat-sequence';
import type { MapDefinitionReader, MapQuery } from '../../contracts/map';
import type { WorldDefinitionReader } from '../../contracts/world';
import type { DefinitionRegistry, ResolverRegistry } from '../../data-runtime';
import type { MapState } from '../../modules/map/public';
import type { TeamState } from '../../modules/team/public';
import type { TeamWorldReader } from '../../modules/team/public';
import type {
  DungeonContext,
  DungeonMapPort,
  DungeonResolverPort,
} from '../../modules/dungeon/public';
import type {
  AssetDistributionHandlerContext,
  AssetDistributionIdAllocator,
  DistributionResolverPort,
} from '../../modules/distribution/public';
import type { EconomyState } from '../../modules/economy/public';
import type { InventoryState } from '../../modules/inventory/public';
import type { ItemDefinitionReader } from '../../contracts/inventory';
import { createAssetDistributionDefinitionReader } from './distribution-reader';
import { createDungeonDefinitionReader } from './dungeon-reader';
import { createDungeonTeamPort } from './cross-module-ports';
import { createDungeonMapPort } from './dungeon-map-port';
import { narrowedDomainReader } from './reader-adapter';

// ──────────────────────────────────────────────────────────────────────────
// TeamWorldReader：team 需要的三個世界事實
// ──────────────────────────────────────────────────────────────────────────
//
// 三者都是**投影**，沒有任何「找不到就補一個」的分支：
//   * 據點 → 所屬城市：world Definition 的 `accessCityId`。
//   * 據點 → MapInstance：map Slice 裡 `adventureSiteId` 等於它的那一筆（Bootstrap 建立時寫入）。
//   * MapInstance → 出口城市：先回到據點，再取它的城市。
//
// `getAdventureSiteMapInstance` 回 undefined 代表世界裡真的沒有這張圖，team 會當場拒絕
// `enterAdventureMap`——那正是這個 Query 存在的理由（見 team/system.ts 的說明）。
export function createTeamWorldReader(
  deps: Readonly<{ world: WorldDefinitionReader; mapState: MapState }>,
): TeamWorldReader {
  const { world, mapState } = deps;

  const siteOfMap = (mapId: MapInstanceId): AdventureSiteId | undefined =>
    mapState.instances[mapId]?.adventureSiteId;

  return {
    getAdventureSiteCity: (siteId) => world.getAdventureSite(siteId as AdventureSiteId).accessCityId,

    getMapExitCity: (mapId): CityId => {
      const siteId = siteOfMap(mapId);
      if (siteId === undefined) {
        // 隊伍位於一個 map 模組不認識的實例上——那是狀態損壞，不是「這張圖沒有出口」。
        throw new Error(`dungeon-context：地圖實例 "${String(mapId)}" 不存在於 map Slice`);
      }
      return world.getAdventureSite(siteId).accessCityId;
    },

    getAdventureSiteMapInstance: (siteId) =>
      Object.values(mapState.instances).find((i) => i.adventureSiteId === siteId)?.mapId,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// 規則 ID 的選取
// ──────────────────────────────────────────────────────────────────────────

function requireSingle(registry: DefinitionRegistry, kind: string, readerId: string): DefinitionId {
  const found = narrowedDomainReader<{ id: DefinitionId }>(registry, readerId, [kind]).list();
  if (found.length !== 1) {
    throw new Error(`dungeon-context：期望恰好一筆 ${kind}，實得 ${found.length}`);
  }
  return found[0]!.id;
}

// 玩家地牢戰利品的分配規則。內容裡有五筆 asset-distribution-rule，所以不能用「唯一一筆」；
// 用**資料欄位**判別（sourceKind=dungeonLoot 且 controllerPolicy=playerAuction），
// 而不是寫死 `asset-distribution-rule.core.player-dungeon-loot`——後者換一份 Pack 就失效。
export function requireDungeonLootRuleId(registry: DefinitionRegistry): AssetDistributionRuleId {
  const rules = narrowedDomainReader<AssetDistributionRuleDefinition>(
    registry,
    'reader:dungeon.loot-rule',
    ['asset-distribution-rule'],
  ).list();
  const matched = rules.filter(
    (r) => r.sourceKind === 'dungeonLoot' && r.controllerPolicy === 'playerAuction',
  );
  if (matched.length !== 1) {
    throw new Error(
      `dungeon-context：期望恰好一筆「玩家地牢戰利品」分配規則` +
        `（sourceKind=dungeonLoot／controllerPolicy=playerAuction），實得 ${matched.length}`,
    );
  }
  return matched[0]!.id;
}

// ──────────────────────────────────────────────────────────────────────────
// DungeonContext
// ──────────────────────────────────────────────────────────────────────────

// 尚未接線的子 port：一被存取就拋，並指名是誰。與 context-assembler 的 `pending()` 同一個作法
// ——比回一個「什麼都不做」的假實作好，因為假實作會讓流程看起來跑完了。
function pendingPort<T>(path: string): T {
  const handler: ProxyHandler<object> = {
    get: (_t, prop) => {
      throw new Error(
        `DungeonContext："${path}" 尚未接線（存取 .${String(prop)}）——` +
          `NPC 地牢流程需要 CombatSequenceSnapshotAssembler，見 contracts/dungeon 的說明。`,
      );
    },
  };
  return new Proxy({}, handler) as T;
}

export type DungeonContextDeps = Readonly<{
  registry: DefinitionRegistry;
  mapQuery: MapQuery;
  mapDefinitions: MapDefinitionReader;
  teamState: TeamState;
  worldDay: WorldDay;
  rng: RngContext;
  resolvers: DungeonResolverPort;
  ids: Readonly<{
    nextInteractionId: () => InteractionId;
    nextKnowledgeId: () => PlayerMapKnowledgeId;
    nextRunId: () => NpcDungeonRunId;
    nextDistributionId: () => AssetDistributionId;
    nextCombatSequenceId: () => CombatSequenceId;
    nextCombatSequenceSourceCommitId: () => CombatSequenceSourceCommitId;
  }>;
}>;

export function createDungeonContext(deps: DungeonContextDeps): DungeonContext {
  const map: DungeonMapPort = createDungeonMapPort({
    query: deps.mapQuery,
    definitions: deps.mapDefinitions,
  });

  return {
    reader: createDungeonDefinitionReader(deps.registry),
    map,
    team: createDungeonTeamPort(deps.teamState),
    worldDay: deps.worldDay,
    interactionRuleId: requireSingle(
      deps.registry,
      'dungeon-interaction-rule',
      'reader:dungeon.interaction-rule',
    ) as DungeonContext['interactionRuleId'],
    lootDistributionRuleId: requireDungeonLootRuleId(deps.registry),
    npcExplorationRuleId: requireSingle(
      deps.registry,
      'npc-exploration-rule',
      'reader:dungeon.npc-exploration-rule',
    ) as DungeonContext['npcExplorationRuleId'],
    rng: deps.rng,
    resolvers: deps.resolvers,
    // NPC 地牢流程專用。玩家路徑（探索／移動／開門／互動／離場）完全不觸及它。
    combatSequence: pendingPort<DungeonContext['combatSequence']>('dungeon.combatSequence'),
    nextInteractionId: deps.ids.nextInteractionId,
    nextKnowledgeId: deps.ids.nextKnowledgeId,
    nextRunId: deps.ids.nextRunId,
    nextDistributionId: deps.ids.nextDistributionId,
    nextCombatSequenceId: deps.ids.nextCombatSequenceId,
    nextCombatSequenceSourceCommitId: deps.ids.nextCombatSequenceSourceCommitId,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// DungeonResolverPort
// ──────────────────────────────────────────────────────────────────────────
//
// 目前**不接**，理由是內容側沒有任何東西會呼叫到它：
//   * `resolveTrap` 只在 `resolveRoomTraps` 發現房內有 armed 固定陷阱時呼叫，而雲華九張地圖的
//     `fixedTraps` 全為空陣列（見 content/yunhua/maps.json）。
//   * `resolveNpcTargetOutcome` 只在 NPC 地牢流程用，而 NPC 隊伍的 enterAdventureMap 在
//     `handleStartNpcTeamPlan` 就被拒絕。
//
// 兩者都不是「玩家路徑會踩到但我先跳過」——玩家探索、移動、開門、離場完全不經過這個 port。
// 所以這裡給 pending proxy 而不是一個回固定結果的假實作：**一旦有作者放了陷阱**，
// 它會立刻指名「trap resolver 尚未接線」，而不是讓陷阱靜默失效（規範 §5 明文禁止
// 「Resolver 不在就用固定結果」）。
//
// 接它需要：一個 `dungeon:trap` resolver shape ＋ 它的 params 內容 ＋ 在 core pack 宣告
// `resolver:dungeon.trap.standard` 的 binding（目前 pack 的 resolverBindings 沒有這一筆，
// 而 dungeon-interaction-rule 已經引用了它——那是既有的「宣告 ≠ 實作」缺口）。
export function createPendingDungeonResolverPort(): DungeonResolverPort {
  return pendingPort<DungeonResolverPort>('dungeon.resolvers');
}

// ──────────────────────────────────────────────────────────────────────────
// AssetDistributionHandlerContext
// ──────────────────────────────────────────────────────────────────────────
//
// 為什麼地牢接線要一併接 distribution：`startPlayerExploration` 一開場就送
// `StartAssetDistribution`（doc §5.1：以成員快照建立 collecting 的戰利品分配）。distribution 的
// context 若是 pending proxy，它的 `try { ctx.definitions.getRule() } catch` 會把 proxy 的例外
// **吞成** `distribution.start.ruleDefinitionMissing`——一個 pending port 就這樣偽裝成「內容缺規則」。
// 那正是規範 §6 點名的偽裝，所以這裡把它接成真的。
//
// 三個 Query 都是唯讀投影，缺就回 undefined（契約明文：「回 undefined 而不是編造帳戶 ID」）：
// 開局 economy slice 是空的，所以帳戶查詢本來就查不到——那是事實，不是錯誤。
export function createDistributionContext(
  deps: Readonly<{
    registry: DefinitionRegistry;
    economyState: EconomyState;
    inventoryState: InventoryState;
    itemReader: ItemDefinitionReader;
    teamState: TeamState;
    worldDay: WorldDay;
    rngContext: RngContext;
    ids: AssetDistributionIdAllocator;
  }>,
): AssetDistributionHandlerContext {
  const accounts = () => Object.values(deps.economyState.accounts);

  return {
    worldDay: deps.worldDay,
    definitions: createAssetDistributionDefinitionReader(deps.registry),
    economy: {
      findSettlementAccount: (distributionId, currencyId) =>
        accounts().find(
          (a) =>
            a.currencyId === currencyId &&
            a.owner.kind === 'assetDistribution' &&
            a.owner.distributionId === distributionId,
        )?.accountId,
      findCharacterAccount: (characterId, currencyId) =>
        accounts().find(
          (a) =>
            a.currencyId === currencyId &&
            a.owner.kind === 'character' &&
            a.owner.characterId === characterId,
        )?.accountId,
      findSystemAccount: (purpose, currencyId) =>
        accounts().find(
          (a) =>
            a.currencyId === currencyId &&
            a.owner.kind === 'system' &&
            a.owner.purpose === purpose,
        )?.accountId,
      // 幣別的最小單位是 economy 擁有的**內容**事實（CurrencyDefinition），不是 State。
      findCurrencySmallestUnit: (currencyId) => {
        const def = deps.registry.get(currencyId as never);
        const smallestUnit = (def?.data as { smallestUnit?: unknown } | undefined)?.smallestUnit;
        return typeof smallestUnit === 'number' ? smallestUnit : undefined;
      },
      canAfford: (accountId, amount) => {
        const account = deps.economyState.accounts[accountId];
        return account !== undefined && account.balance >= amount;
      },
    },
    inventory: {
      // 物品原價值來自它的 **Definition**（內容），不是實例——實例只帶 definitionId。
      findIntrinsicValue: (itemId) => {
        const instance = deps.inventoryState.items[itemId];
        if (instance === undefined) return undefined;
        return deps.itemReader.getItem(instance.definitionId).intrinsicValue;
      },
    },
    team: {
      // 玩家實際控制的角色＝玩家隊伍的隊長（只有他能送 submitLootBid／passLootItem）。
      findPlayerControlledCharacterId: () =>
        deps.teamState.teams[deps.teamState.playerTeamId]?.leaderId,
    },
    ids: deps.ids,
    // 競拍決策 Resolver：只在收集關閉後的拍賣輪才會用到，探索開場不觸及。
    // 兩個 shape（companion-bid／npc-item-recipient）尚未實作，接上前明確標記。
    resolvers: pendingPort<DistributionResolverPort>('distribution.resolvers'),
    rngContext: deps.rngContext,
  };
}
