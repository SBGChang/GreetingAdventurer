// app/workflows/player-travel-event.ts
// 旅行事件 Workflow 的反應邏輯（§5.1）。Workflow 反應事件、送出後續 Internal Command，但**不擁有 Slice**
// （回傳只有 outgoing、無 mutation）。身分與訂閱在 composition/manifest.ts 宣告（唯一真相）；此處只放
// 「收到事件後要送什麼命令」的邏輯，故 router 不再內嵌 Workflow 規則。
//
// 玩家每抵達一段旅程 → 決定是否觸發旅行事件。第一版（無內容 event weights）一律「無事件」→ 送
// CompletePlayerTravelSegmentWithoutEvent 推進下一段/抵達；之後接上 event-weight resolver 後，命中事件
// 改送 OpenPlayerTravelInteraction（開 Pending 互動）。推進走 Internal Command 的可攔截路徑，而非
// dueCityTravel 自行推進。

import type { ModuleId, TeamId, TransactionMessageDraft } from '../../contracts/core';
import * as team from '../../modules/team/public';
import type { GameState } from '../composition/state';
import { TRAVEL_EVENT_WORKFLOW } from '../composition/manifest';

// Workflow 訂閱者：反應事件、回傳後續 Internal Command（無 mutation）。
export type WorkflowSubscriberDispatch = (
  event: unknown,
  state: GameState,
) => Readonly<{ outgoing: readonly TransactionMessageDraft[] }>;

// TravelSegmentReached → 決定推進。無 active plan（旅行已被別的路徑收掉）時無事可推進。
export const onTravelSegmentReached: WorkflowSubscriberDispatch = (e, s) => {
  const event = e as { teamId: TeamId; segmentIndex: 0 | 1 | 2 };
  const activePlanId = team.tryGetTeam(s.team, event.teamId)?.activePlanId;
  if (activePlanId === undefined) return { outgoing: [] };
  const draft: TransactionMessageDraft = {
    targetModule: 'team' as ModuleId,
    command: {
      type: 'CompletePlayerTravelSegmentWithoutEvent',
      teamId: event.teamId,
      planId: activePlanId,
      segmentIndex: event.segmentIndex,
    },
  };
  return { outgoing: [draft] };
};

// Workflow 訂閱分派表：key = `${eventType}::${workflowId}`（與模組訂閱同一命名空間，供 router 查表）。
export const WORKFLOW_SUBSCRIBERS: Readonly<Record<string, WorkflowSubscriberDispatch>> = {
  [`TravelSegmentReached::${String(TRAVEL_EVENT_WORKFLOW)}`]: onTravelSegmentReached,
};
