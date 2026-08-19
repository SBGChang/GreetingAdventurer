// modules/npc-behavior/state.ts
// NPC Behavior 唯一可寫 Slice 的初始工廠與純結構 helper。
// Slice 型別權威在 contracts/npc-behavior；此處不重新定義，只 re-export + 提供 immutable helper。
//
// 設計原則：
//   * 全部為決定性純函式；不 mutate 傳入 Slice，一律回傳新物件。
//   * 這個檔案不知道任何內容資料：節點要不要啟動、權重多少、抽到什麼，全在 system.ts 由
//     Definition + Resolver + RNG 決定。這裡只負責「怎麼把結果放進 Slice」。

import type {
  ActionChainId,
  ActionChainNodeId,
  ActionChainTemplateId,
  Revision,
  RngContext,
  TeamId,
  WorldDay,
} from '../../contracts/core';
import type {
  ActionChainNodeKind,
  NpcActionChain,
  NpcActionChainNode,
  NpcAdventurerController,
  NpcBehaviorState,
  NpcChainSource,
  NpcMarketIntent,
} from '../../contracts/npc-behavior';

export type { NpcBehaviorState };

// 空 Slice（新世界或測試起點）。
export const emptyNpcBehaviorState: NpcBehaviorState = Object.freeze({
  controllers: Object.freeze({}),
  chains: Object.freeze({}),
  marketIntents: Object.freeze({}),
}) as NpcBehaviorState;

// 由既有實體集合建構 Slice（Bootstrap／存檔載入／fixture）。
export function createNpcBehaviorState(
  input: Readonly<{
    controllers?: readonly NpcAdventurerController[];
    chains?: readonly NpcActionChain[];
    marketIntents?: readonly NpcMarketIntent[];
  }> = {},
): NpcBehaviorState {
  const controllers: Record<TeamId, NpcAdventurerController> = {};
  for (const c of input.controllers ?? []) controllers[c.teamId] = c;

  const chains: Record<ActionChainId, NpcActionChain> = {};
  for (const chain of input.chains ?? []) chains[chain.chainId] = chain;

  const marketIntents: NpcBehaviorState['marketIntents'] = Object.fromEntries(
    (input.marketIntents ?? []).map((i) => [i.intentId, i]),
  );

  return { controllers, chains, marketIntents };
}

// ── Revision／世界日小工具 ───────────────────────────────────────────────────

export function bump(revision: Revision): Revision {
  return (revision + 1) as Revision;
}

// 「新行為最早次日開始」是 doc §4.1 的結構規則（每日結算邊界），不是可調節奏：
// 節點完成當日不啟動下一節，一律登記次日。天數本身沒有第二種取值，因此不是資料。
export function nextDay(worldDay: WorldDay): WorldDay {
  return (worldDay + 1) as WorldDay;
}

export function addDays(worldDay: WorldDay, days: number): WorldDay {
  return (worldDay + days) as WorldDay;
}

// ── Controller 純函式讀寫 ────────────────────────────────────────────────────

export function tryGetController(
  state: NpcBehaviorState,
  teamId: TeamId,
): NpcAdventurerController | undefined {
  return state.controllers[teamId];
}

export function upsertController(
  state: NpcBehaviorState,
  next: NpcAdventurerController,
): NpcBehaviorState {
  return { ...state, controllers: { ...state.controllers, [next.teamId]: next } };
}

export function createController(
  input: Readonly<{
    teamId: TeamId;
    policyId: NpcAdventurerController['policyId'];
    nextDecisionOnDay: WorldDay;
  }>,
): NpcAdventurerController {
  return {
    teamId: input.teamId,
    policyId: input.policyId,
    nextDecisionOnDay: input.nextDecisionOnDay,
    revision: 0 as Revision,
  };
}

// ── Chain 純函式讀寫 ─────────────────────────────────────────────────────────

export function tryGetChain(
  state: NpcBehaviorState,
  chainId: ActionChainId,
): NpcActionChain | undefined {
  return state.chains[chainId];
}

export function upsertChain(state: NpcBehaviorState, next: NpcActionChain): NpcBehaviorState {
  return { ...state, chains: { ...state.chains, [next.chainId]: next } };
}

// 不變量 1：每支 NPC Team 至多一個 active Chain——因此「找 active Chain」只需經過 Controller，
// 不掃全表。Controller 指到的 Chain 若已非 active，視為沒有 active Chain（推進路徑負責清指標）。
export function activeChainForTeam(
  state: NpcBehaviorState,
  teamId: TeamId,
): NpcActionChain | undefined {
  const chainId = tryGetController(state, teamId)?.activeChainId;
  if (chainId === undefined) return undefined;
  const chain = state.chains[chainId];
  if (chain === undefined || chain.status !== 'active') return undefined;
  return chain;
}

// 依模板節點 kind 序列建立全新 Chain：所有節點 `waiting` + `pending` payload，游標指向 0。
// 節點的**實際啟動**（送誰的 Internal Command、解析哪個 Resolver）不在此處。
export function createChain(
  input: Readonly<{
    chainId: ActionChainId;
    teamId: TeamId;
    source: NpcChainSource;
    templateId: ActionChainTemplateId;
    nodeKinds: readonly ActionChainNodeKind[];
    nodeIds: readonly ActionChainNodeId[];
    rngContext: RngContext;
  }>,
): NpcActionChain {
  const nodes: NpcActionChainNode[] = [];
  input.nodeKinds.forEach((kind, index) => {
    const nodeId = input.nodeIds[index];
    if (nodeId === undefined) {
      throw new Error(
        `createChain: nodeIds 少於 nodeKinds（index ${index}）——ID 配發與模板節點數必須一致`,
      );
    }
    nodes.push({ nodeId, kind, status: 'waiting', payload: { kind: 'pending' } });
  });

  return {
    chainId: input.chainId,
    teamId: input.teamId,
    source: input.source,
    templateId: input.templateId,
    status: 'active',
    currentNodeIndex: 0,
    nodes,
    rngContext: input.rngContext,
    revision: 0 as Revision,
  };
}

export function nodeAt(chain: NpcActionChain, index: number): NpcActionChainNode | undefined {
  return chain.nodes[index];
}

// 以 index 取代單一節點（其餘節點原樣保留）。
export function withNode(
  chain: NpcActionChain,
  index: number,
  next: NpcActionChainNode,
): NpcActionChain {
  const nodes = chain.nodes.map((n, i) => (i === index ? next : n));
  return { ...chain, nodes, revision: bump(chain.revision) };
}

// ── Market Intent 純函式讀寫 ─────────────────────────────────────────────────

export function upsertMarketIntent(
  state: NpcBehaviorState,
  next: NpcMarketIntent,
): NpcBehaviorState {
  return { ...state, marketIntents: { ...state.marketIntents, [next.intentId]: next } };
}

export function listMarketIntentsForTeam(
  state: NpcBehaviorState,
  teamId: TeamId,
): readonly NpcMarketIntent[] {
  return Object.keys(state.marketIntents)
    .map((key) => state.marketIntents[key as keyof typeof state.marketIntents])
    .filter((i): i is NpcMarketIntent => i !== undefined && i.teamId === teamId);
}
