// modules/npc-behavior/queries.ts
// NpcBehaviorQuery 在 Slice 快照上的純函式實作（doc §3）。
//
// 這個 Query 的用途是「顯示 NPC 真正的下一步」，而不是編造活動描述——所以它只投影 Slice 裡
// 實際存在的事實：目前的 Chain 與節點狀態、最早可再抽日、以及該隊伍的交易 Intent。
// 沒有 Chain 就回 undefined；沒有 Intent 就回空陣列（那是「這支隊伍沒有這些紀錄」的事實，
// 不是替代缺失內容的預設值）。

import type { TeamId, WorldDay } from '../../contracts/core';
import type {
  NpcActionChain,
  NpcActionChainNodeView,
  NpcActionChainView,
  NpcBehaviorQuery,
  NpcMarketIntentView,
} from '../../contracts/npc-behavior';

import type { NpcBehaviorState } from './state';
import { activeChainForTeam, listMarketIntentsForTeam, tryGetController } from './state';

function toChainView(chain: NpcActionChain): NpcActionChainView {
  const nodes: NpcActionChainNodeView[] = chain.nodes.map((node) => ({
    nodeId: node.nodeId,
    kind: node.kind,
    status: node.status,
    linkedPlanId: node.linkedPlanId,
  }));
  return {
    chainId: chain.chainId,
    teamId: chain.teamId,
    source: chain.source,
    templateId: chain.templateId,
    questId: chain.questId,
    status: chain.status,
    currentNodeIndex: chain.currentNodeIndex,
    nodes,
    targetUnavailableOnDay: chain.targetUnavailableOnDay,
    revision: chain.revision,
  };
}

export function createNpcBehaviorQuery(state: NpcBehaviorState): NpcBehaviorQuery {
  return {
    getActiveChain(teamId: TeamId): NpcActionChainView | undefined {
      const chain = activeChainForTeam(state, teamId);
      return chain === undefined ? undefined : toChainView(chain);
    },

    getNextDecisionOnDay(teamId: TeamId): WorldDay | undefined {
      return tryGetController(state, teamId)?.nextDecisionOnDay;
    },

    listMarketIntents(teamId: TeamId): NpcMarketIntentView[] {
      return listMarketIntentsForTeam(state, teamId).map((intent) => ({
        intentId: intent.intentId,
        teamId: intent.teamId,
        memberId: intent.memberId,
        kind: intent.kind,
        cityId: intent.cityId,
        offerId: intent.offerId,
        itemId: intent.itemId,
        homeRuleId: intent.homeRuleId,
        createdOnDay: intent.createdOnDay,
        state: intent.state,
        revision: intent.revision,
      }));
    },
  };
}
