// app/composition/manifest.ts
// ExecutionOrderManifest：跨模組執行順序的**唯一真相**（12_engine_runtime.md §5.2、§6.2）。
//
// 模組只註冊「自己能執行哪些 Job Type / Subscription Handler」，不得自行決定 Job Phase、
// 訂閱哪個事件或跨模組順序。此檔即那份唯一宣告；kernel 只把它編譯成內部索引。
//
// 順序完全由陣列位置決定：不得依 bundler、檔名、import 順序、subscriber 名稱或模組自填數字。

import type {
  EventSubscriptionId,
  JobPhase,
  ModuleId,
  WorkflowId,
  MessageSourceId,
} from '../../contracts/core';
import type { GameCommandType, GameDomainEventType, GameInternalCommandType } from './messages';
import type { GameJobType } from './state';

// ──────────────────────────────────────────────────────────────────────────
// Job 相位（§6.2）
// ──────────────────────────────────────────────────────────────────────────

// 每個已註冊 Job Type 必須在此恰好出現一次；缺漏或重複由 kernel createScheduler 於啟動時 throw。
export const JOB_TYPE_ORDER_BY_PHASE: Readonly<Record<JobPhase, readonly GameJobType[]>> = {
  // 既有行動完成：玩家旅行段落、NPC 抵達、自由活動、NPC 地牢日。
  completeAction: ['teamPlanDue', 'freeActionDue', 'npcDungeonDay'],
  // 接受期限／實際結束期限／鎖定到期。（quest 的 questDeadline 於其 Wave 併入。）
  closeDeadline: [],
  // 固定日曆批次：地圖刷新、商店、護衛候選。
  worldCadence: ['mapRefreshCheck', 'nonPlayerMemberCityFreeDayTick'],
  // 必須延到當日排程、且不是交易內即時因果的反應。
  worldReaction: ['characterLifecycleDue'],
  // NPC 決策與下一輪行動。（npc-behavior 的 Job 於其 Wave 併入。）
  scheduleNext: [],
};

// ──────────────────────────────────────────────────────────────────────────
// Workflow 定義（§5.1）
//
// Workflow 反應事件、送出後續 Internal Command，但**不擁有 Slice**（其 EventSubscriber 無 mutation）。
// 訂閱與模組**共用**下方唯一的 EVENT_SUBSCRIPTIONS_BY_TYPE（subscriber 為 ModuleId | WorkflowId），故
// 「模組先或 Workflow 先」由該表陣列位置單一決定，不再拆成第二張真相。此處僅宣告 Workflow 身分與其
// 起始事件（startsFrom），啟動驗證會確認 startsFrom 真的有對應訂閱。實際反應邏輯住在 app/workflows/。
// ──────────────────────────────────────────────────────────────────────────

// WorkflowId 用 core 的品牌型別（`workflow:${K}`）——不再本地重宣告一個不相容的型別。
export const TRAVEL_EVENT_WORKFLOW = 'workflow:travel-event' as WorkflowId;

// 12_engine_runtime.md §「WorkflowDefinition」：startsFrom 是四種正式訊息中已註冊的 Game Command /
// Scheduled Job / Domain Event（不能是任意 DTO）；steps 每步是一個有明確模組 handler 的 Internal Command，
// 帶 required/optional 與 onAccepted/onRejected 轉移。
export type WorkflowTransition =
  | Readonly<{ kind: 'next'; stepIndex: number }>
  | Readonly<{ kind: 'complete' }>
  | Readonly<{ kind: 'reject'; code: string }>;

export type WorkflowStepDefinition = Readonly<{
  internalCommandType: GameInternalCommandType;
  requirement: 'required' | 'optional';
  onAccepted: WorkflowTransition;
  onRejected: WorkflowTransition;
}>;

export type WorkflowDefinition = Readonly<{
  workflowId: WorkflowId;
  // 啟動訊息；若為 Domain Event，必須出現在 EVENT_SUBSCRIPTIONS_BY_TYPE 中該 workflowId 的訂閱裡（且只此一種）。
  startsFrom: GameCommandType | GameJobType | GameDomainEventType;
  steps: readonly WorkflowStepDefinition[];
}>;

export const REGISTERED_WORKFLOWS: readonly WorkflowDefinition[] = [
  {
    workflowId: TRAVEL_EVENT_WORKFLOW,
    startsFrom: 'TravelSegmentReached',
    // 第一版：抵達一段 → 送一個 required Internal Command 推進，之後結束。接上 event-weight resolver 後，
    // 命中事件會改走 OpenPlayerTravelInteraction 分支（屆時擴充為多步）。onRejected 也結束（plan 已變等
    // 情況 no-op，不擋整條旅行）。
    steps: [
      {
        internalCommandType: 'CompletePlayerTravelSegmentWithoutEvent',
        requirement: 'required',
        onAccepted: { kind: 'complete' },
        onRejected: { kind: 'complete' },
      },
    ],
  },
];

// ──────────────────────────────────────────────────────────────────────────
// 事件訂閱（§5.2）——模組與 Workflow 共用的唯一有序表
// ──────────────────────────────────────────────────────────────────────────

// subscriptionId 由 Composition 作者指定、跨版本穩定，命名 `subscription.<eventType>.<subscriber>`。
// 它不是 Runtime ID、不進存檔，也不得依陣列 index 或 import 順序動態生成。
export type EventSubscription = Readonly<{
  eventType: GameDomainEventType;
  // ModuleId 或 WorkflowId：兩者共用同一張有序表（§5.2 唯一真相）。是否為 Workflow 由 registry 成員
  // 判定（router 以 dispatch 表歸屬區分；validateManifest 以 REGISTERED_WORKFLOWS 判定）。
  subscriber: MessageSourceId;
  subscriptionId: EventSubscriptionId;
}>;

function sub(eventType: GameDomainEventType, subscriberModule: string): EventSubscription {
  return {
    eventType,
    subscriber: subscriberModule as ModuleId,
    subscriptionId: `subscription.${eventType}.${subscriberModule}` as EventSubscriptionId,
  };
}

function workflowSub(eventType: GameDomainEventType, workflowId: WorkflowId): EventSubscription {
  return {
    eventType,
    subscriber: workflowId,
    subscriptionId: `subscription.${eventType}.${String(workflowId)}` as EventSubscriptionId,
  };
}

// 只登記「已實作模組且該 Handler 真的存在」的訂閱。
//
// 刻意不登記的（模組 ModuleContract 宣告了 subscriptionHandlerIds，但 Wave B 沒有實作對應
// Handler，登記了會在啟動驗證時失敗）：
//   - character: FacilityRestCompleted / HomeYearRestCompleted / QuestStateChanged 需 city/quest 模組
//   - combat: 全部 5 筆（CombatItemUseCommitted / EquipmentChanged / KnowledgeLearned /
//             CharacterDied / CharacterAvailabilityChanged）尚無 subscriber 實作
//   - dungeon: combat-sequence 相關 4 筆需 combat-sequence 模組
//   - team: QuestSettled / RouteAccessChanged 需 quest/world 模組
export const EVENT_SUBSCRIPTIONS_BY_TYPE: Readonly<
  Partial<Record<GameDomainEventType, readonly EventSubscription[]>>
> = {
  // 隊伍位置改變 → map 更新佔用。
  // dungeon 的 ModuleContract 也宣告過這筆訂閱，但 Wave B 沒有寫對應函式，故不綁定。
  TeamLocationChanged: [sub('TeamLocationChanged', 'map')],

  // 戰鬥結束 → dungeon 收斂（回復 Session、對勝利內容發 ResolvePlayerMapContent）。
  CombatEncounterResolved: [sub('CombatEncounterResolved', 'dungeon')],

  // NPC 地城結算套用完成 → dungeon 記錄三方結算之一。
  NpcDungeonSettlementApplied: [sub('NpcDungeonSettlementApplied', 'dungeon')],

  // 戰鬥成長事件 → progression 發放 MXP。
  CombatAttackMasteryEarned: [sub('CombatAttackMasteryEarned', 'progression')],
  CombatDefenseMasteryEarned: [sub('CombatDefenseMasteryEarned', 'progression')],
  CombatSupportMasteryEarned: [sub('CombatSupportMasteryEarned', 'progression')],

  // 角色出生 → progression 建立成長檔。
  CharacterBorn: [sub('CharacterBorn', 'progression')],

  // 能力上限改變 → character 夾住當前 HP/MP。
  ProgressionCapacityChanged: [sub('ProgressionCapacityChanged', 'character')],
  EquipmentChanged: [sub('EquipmentChanged', 'character')],

  // 玩家旅行推進由**旅行事件 Workflow** 決定（不是 dueCityTravel 自行推進）：team 發 TravelSegmentReached
  // 後停下，此 Workflow 訂閱者收到 → 送 CompletePlayerTravelSegmentWithoutEvent 推進下一段/抵達。與模組
  // 訂閱共用這張有序表，故若某事件同時有模組與 Workflow 訂閱，其先後由此處陣列位置單一決定（§5.2）。
  // 端到端已通（travel-integration.test 以引擎自驅驗至抵達）。**待內容**：event weights + resolver 命中
  // 事件時改送 OpenPlayerTravelInteraction（Pending 互動分支）。反應邏輯：app/workflows/player-travel-event。
  TravelSegmentReached: [workflowSub('TravelSegmentReached', TRAVEL_EVENT_WORKFLOW)],
};

export type ExecutionOrderManifest = Readonly<{
  jobTypeOrderByPhase: typeof JOB_TYPE_ORDER_BY_PHASE;
  eventSubscriptionsByType: typeof EVENT_SUBSCRIPTIONS_BY_TYPE;
}>;

export const EXECUTION_ORDER_MANIFEST: ExecutionOrderManifest = {
  jobTypeOrderByPhase: JOB_TYPE_ORDER_BY_PHASE,
  eventSubscriptionsByType: EVENT_SUBSCRIPTIONS_BY_TYPE,
};

// ──────────────────────────────────────────────────────────────────────────
// 啟動驗證（§5.2 末段的 Bootstrap 必檢項）
// ──────────────────────────────────────────────────────────────────────────

export type ManifestDiagnostic = Readonly<{ code: string; detail: string }>;

// 檢查：每個 Job Type 恰好出現一次且只屬一個 Phase；每個 subscriptionId 全域唯一；每筆
// EventSubscription.eventType 等於所在 Record Key；Workflow 訂閱者須已註冊；每個註冊 Workflow 的
// startsFrom 真的有對應訂閱。
export function validateManifest(
  manifest: ExecutionOrderManifest,
  registeredJobTypes: readonly GameJobType[],
): readonly ManifestDiagnostic[] {
  const out: ManifestDiagnostic[] = [];

  const seenJobTypes = new Map<string, JobPhase>();
  for (const [phase, types] of Object.entries(manifest.jobTypeOrderByPhase)) {
    for (const type of types) {
      const previous = seenJobTypes.get(type);
      if (previous !== undefined) {
        out.push({
          code: 'manifest.jobType.duplicate',
          detail: `Job type "${type}" 同時出現在 phase "${previous}" 與 "${phase}"`,
        });
        continue;
      }
      seenJobTypes.set(type, phase as JobPhase);
    }
  }
  for (const type of registeredJobTypes) {
    if (!seenJobTypes.has(type)) {
      out.push({
        code: 'manifest.jobType.missing',
        detail: `已註冊的 Job type "${type}" 未出現在 jobTypeOrderByPhase`,
      });
    }
  }
  for (const type of seenJobTypes.keys()) {
    if (!(registeredJobTypes as readonly string[]).includes(type)) {
      out.push({
        code: 'manifest.jobType.unregistered',
        detail: `jobTypeOrderByPhase 列出的 "${type}" 沒有任何模組註冊處理`,
      });
    }
  }

  const registeredWorkflowIds = new Set<string>(REGISTERED_WORKFLOWS.map((w) => String(w.workflowId)));
  const seenSubscriptionIds = new Set<string>();
  // 記錄每個 Workflow 實際訂閱了哪些 eventType（供 startsFrom 檢查）。
  const workflowSubscribedEvents = new Map<string, Set<string>>();

  for (const [eventType, subs] of Object.entries(manifest.eventSubscriptionsByType)) {
    for (const s of subs ?? []) {
      if (s.eventType !== eventType) {
        out.push({
          code: 'manifest.subscription.eventTypeMismatch',
          detail: `subscriptionId "${s.subscriptionId}" 的 eventType 是 "${s.eventType}"，但掛在 key "${eventType}" 下`,
        });
      }
      if (seenSubscriptionIds.has(s.subscriptionId)) {
        out.push({
          code: 'manifest.subscription.duplicateId',
          detail: `subscriptionId "${s.subscriptionId}" 重複`,
        });
      }
      seenSubscriptionIds.add(s.subscriptionId);

      const subscriberStr = String(s.subscriber);
      if (registeredWorkflowIds.has(subscriberStr)) {
        const events = workflowSubscribedEvents.get(subscriberStr) ?? new Set<string>();
        events.add(String(s.eventType));
        workflowSubscribedEvents.set(subscriberStr, events);
      } else if (subscriberStr.startsWith('workflow:')) {
        // 品牌前綴看似 Workflow，卻不在 REGISTERED_WORKFLOWS。
        out.push({
          code: 'manifest.subscription.unknownWorkflow',
          detail: `subscription "${s.subscriptionId}" 指向未註冊的 Workflow "${subscriberStr}"`,
        });
      }
      // 其餘視為模組訂閱：其 Handler 存在性由 registry 對 ModuleContract.subscriptionHandlerIds 交叉驗證。
    }
  }

  // 每個註冊 Workflow：startsFrom 必須有對應訂閱（否則永不啟動），且**只能**訂閱 startsFrom 一種事件——
  // Workflow 由單一 startsFrom 啟動，對其他事件的反應是 steps（Internal Command），不是額外事件訂閱。
  for (const w of REGISTERED_WORKFLOWS) {
    const events = workflowSubscribedEvents.get(String(w.workflowId));
    if (events === undefined || !events.has(String(w.startsFrom))) {
      out.push({
        code: 'manifest.workflow.startsFromNotSubscribed',
        detail: `Workflow "${String(w.workflowId)}" 宣告 startsFrom "${w.startsFrom}"，但未在 eventSubscriptionsByType 找到對應訂閱`,
      });
    }
    for (const ev of events ?? []) {
      if (ev !== String(w.startsFrom)) {
        out.push({
          code: 'manifest.workflow.extraSubscription',
          detail: `Workflow "${String(w.workflowId)}" 額外訂閱了非 startsFrom 的事件 "${ev}"（startsFrom="${String(w.startsFrom)}"）；跨事件反應應為 steps 而非訂閱`,
        });
      }
    }
  }

  return out;
}
