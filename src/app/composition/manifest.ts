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
// 由 Game Command 啟動的 Workflow（身分宣告在其實作檔，此處引用以維持單一真相）。
import { WEAPON_SET_CONFIGURATION_WORKFLOW } from '../workflows/weapon-set-configuration';
import { GAME_COMMAND_ENTRY, WORKFLOW_ENTRY } from './messages';

// ──────────────────────────────────────────────────────────────────────────
// Feature Capability：宣告了路由但**尚未閉合**的公開能力（複審 R15 P1-4）
// ──────────────────────────────────────────────────────────────────────────
//
// 契約宣告 ≠ 有實作。這份清單把「已宣告但還不能用」變成**明示**狀態，取代兩種壞行為：
//   1. 啟動驗證全綠、玩家送出後才 throw。
//   2. 靜默成功 no-op。
// 列在此處的命令：啟動驗證不會抱怨它缺 Handler／Workflow，但 Router 一律回傳型別化的
// `engine/feature-not-available` 拒絕（不是例外）。UI 應據此隱藏或停用對應功能頁。
//
// **這份清單只能變短。** 實作完成就把該項移除；移除後若仍缺 Handler，啟動驗證會立刻失敗。
// 每一項都必須附**理由**。理由欄位不是註解裝飾：它是「為什麼還不能用」的唯一紀錄，也讓下一個人知道
// 移除它需要先完成什麼。
export type CapabilityGap = Readonly<Record<string, string>>;

export const UNAVAILABLE_CAPABILITIES: Readonly<{
  gameCommands: CapabilityGap;
  internalCommands: CapabilityGap;
  jobs: CapabilityGap;
}> = {
  gameCommands: {
    gatherDungeonNode: '入口宣告為 Workflow，但 dungeon gathering workflow 尚未實作',
    unequipItem: 'Wave B 未實作 Handler',
    useItem: 'Wave B 未實作 Handler',
    splitStack: 'Wave B 未實作 Handler',
    transferItemForEncumbrance: 'Wave B 未實作 Handler（超載處理四命令）',
    storeItemForEncumbrance: 'Wave B 未實作 Handler（超載處理四命令）',
    abandonItemForEncumbrance: 'Wave B 未實作 Handler（超載處理四命令）',
    reassignQuestCargoCarrierForEncumbrance: 'Wave B 未實作 Handler（超載處理四命令）',
    learnFromBook: 'Wave B 未實作 Handler',
    startTeaching: 'Wave B 未實作 Handler',
    chooseCityFreeAction: 'Wave B 未實作 Handler',
    dismissMember: 'Wave B 未實作 Handler',
    // 注意：這一項**有** Router dispatch，但 Handler 明確仍是 no-op。「有 dispatch」不等於「已完成」，
    // 所以本清單以人工維護的理由為準，不從 dispatch 存在與否反推（複審 R15 P1-6）。
    commandAlly: 'Router 有 dispatch，但 Handler 明確仍是 no-op，尚未實作指揮隊友',
  },
  internalCommands: {
    ApplyQuestItemLifecycle: 'inventory 宣告接收，Wave B 未實作',
    ReleaseExpiredQuestCargo: 'inventory 宣告接收，Wave B 未實作',
    ConsumeBookForLearning: 'inventory 宣告接收，Wave B 未實作',
    TransformCraftingItems: 'inventory 宣告接收，Wave B 未實作；消耗端須比對保留的 craftingAttemptId',
    ConsumeCuisineIngredients: 'inventory 宣告接收，Wave B 未實作',
    ConsumeCombatSequenceRetrySupply: 'inventory 宣告接收，Wave B 未實作',
    StartTimedCityAction: 'team 宣告接收，Wave B 未實作',
    StartChildStudyPlan: 'team 宣告接收，Wave B 未實作',
    CreateNpcTeam: 'team 宣告接收，Wave B 未實作',
    OpenPlayerTravelInteraction: 'team 宣告接收，Wave B 未實作（旅行事件 Pending 互動分支）',
    MarkPlayerTravelInteractionAwaitingCombat: 'team 宣告接收，Wave B 未實作',
    CompletePlayerTravelInteraction: 'team 宣告接收，Wave B 未實作',
    AssignNpcMemberFreeAction: 'team 宣告接收，Wave B 未實作',
    RecordTeamWorkSettlementValue: 'team 宣告接收，Wave B 未實作',
    AttachQuestTemporaryMember: 'team 宣告接收，Wave B 未實作',
  },
  jobs: {
    freeActionDue: 'team 宣告處理，Wave B 未實作',
    nonPlayerMemberCityFreeDayTick: 'team 宣告處理，Wave B 未實作',
  },
};

export const FEATURE_NOT_AVAILABLE = 'engine/feature-not-available';

export { WEAPON_SET_CONFIGURATION_WORKFLOW };

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

// Workflow 的啟動來源分三種。原本 `startsFrom` 是三種字串的裸聯集，`validateManifest()` 只能假設
// 「所有 Workflow 都由 Domain Event 啟動」並要求它出現在事件訂閱表——由 Game Command 或 Job 啟動的
// Workflow 根本表達不出來（複審 R15 P1-3）。改成判別聯集後，驗證才能依種類分流。
export type WorkflowStart =
  | Readonly<{ kind: 'domainEvent'; eventType: GameDomainEventType }>
  | Readonly<{ kind: 'gameCommand'; commandType: GameCommandType }>
  | Readonly<{ kind: 'job'; jobType: GameJobType }>;

export type WorkflowDefinition = Readonly<{
  workflowId: WorkflowId;
  startsFrom: WorkflowStart;
  steps: readonly WorkflowStepDefinition[];
}>;

export const REGISTERED_WORKFLOWS: readonly WorkflowDefinition[] = [
  {
    workflowId: TRAVEL_EVENT_WORKFLOW,
    startsFrom: { kind: 'domainEvent', eventType: 'TravelSegmentReached' },
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
  {
    workflowId: WEAPON_SET_CONFIGURATION_WORKFLOW,
    startsFrom: { kind: 'gameCommand', commandType: 'configureWeaponSet' },
    // 無 Internal Command 步驟：本 Workflow 的職責是**跨模組驗證**（技能 Definition 存在、角色已學會、
    // 啟動手可用），通過後直接委派擁有 Slice 的 Inventory Handler 寫入。驗證失敗即拒絕整筆交易。
    steps: [],
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

  // 每個註冊 Workflow 依 startsFrom **種類**分流驗證。原本一律當成事件啟動，Game Command／Job 啟動的
  // Workflow 會被誤判為「未訂閱」（複審 R15 P1-3）。
  for (const w of REGISTERED_WORKFLOWS) {
    const events = workflowSubscribedEvents.get(String(w.workflowId));

    if (w.startsFrom.kind === 'domainEvent') {
      // 事件啟動：必須有對應訂閱（否則永不啟動），且**只能**訂閱 startsFrom 一種事件——
      // 對其他事件的反應是 steps（Internal Command），不是額外事件訂閱。
      const eventType = String(w.startsFrom.eventType);
      if (events === undefined || !events.has(eventType)) {
        out.push({
          code: 'manifest.workflow.startsFromNotSubscribed',
          detail: `Workflow "${String(w.workflowId)}" 宣告由事件 "${eventType}" 啟動，但未在 eventSubscriptionsByType 找到對應訂閱`,
        });
      }
      for (const ev of events ?? []) {
        if (ev !== eventType) {
          out.push({
            code: 'manifest.workflow.extraSubscription',
            detail: `Workflow "${String(w.workflowId)}" 額外訂閱了非 startsFrom 的事件 "${ev}"（startsFrom="${eventType}"）；跨事件反應應為 steps 而非訂閱`,
          });
        }
      }
      continue;
    }

    // 非事件啟動的 Workflow 不得掛事件訂閱——那代表它有第二個入口。
    if (events !== undefined && events.size > 0) {
      out.push({
        code: 'manifest.workflow.unexpectedSubscription',
        detail: `Workflow "${String(w.workflowId)}" 由 ${w.startsFrom.kind} 啟動，卻另外訂閱了事件 ${[...events].join('、')}`,
      });
    }

    if (w.startsFrom.kind === 'gameCommand') {
      // Game Command 啟動：GAME_COMMAND_ENTRY 必須把該命令標為 Workflow 入口，否則入口宣告與 Workflow
      // 註冊互相矛盾（一個命令只能有一個入口，§5.1）。
      const commandType = w.startsFrom.commandType;
      if (GAME_COMMAND_ENTRY[commandType] !== WORKFLOW_ENTRY) {
        out.push({
          code: 'manifest.workflow.commandEntryMismatch',
          detail: `Workflow "${String(w.workflowId)}" 宣告由 Game Command "${commandType}" 啟動，但 GAME_COMMAND_ENTRY 沒有把它標為 Workflow 入口`,
        });
      }
    } else if (!(registeredJobTypes as readonly string[]).includes(w.startsFrom.jobType)) {
      out.push({
        code: 'manifest.workflow.unknownJobType',
        detail: `Workflow "${String(w.workflowId)}" 宣告由 Job "${w.startsFrom.jobType}" 啟動，但該 Job type 未註冊`,
      });
    }
  }

  // 反向：每一個標為 Workflow 入口的 Game Command 都必須有註冊的 Workflow。原本只檢查 Workflow → 入口，
  // 沒檢查入口 → Workflow，所以 `gatherDungeonNode` 這種「宣告了 Workflow 入口但沒有 Workflow」的狀態
  // 完全不會被啟動驗證發現，要等玩家送出才拋錯（複審 R15 P1-3／P1-4）。
  const workflowStartCommands = new Set<string>(
    REGISTERED_WORKFLOWS.filter((w) => w.startsFrom.kind === 'gameCommand').map((w) =>
      String((w.startsFrom as Extract<WorkflowStart, { kind: 'gameCommand' }>).commandType),
    ),
  );
  for (const [commandType, entry] of Object.entries(GAME_COMMAND_ENTRY)) {
    if (entry !== WORKFLOW_ENTRY) continue;
    if (workflowStartCommands.has(commandType)) continue;
    if (commandType in UNAVAILABLE_CAPABILITIES.gameCommands) continue;
    out.push({
      code: 'manifest.workflow.missingForCommandEntry',
      detail: `Game Command "${commandType}" 的入口宣告為 Workflow，但 REGISTERED_WORKFLOWS 沒有對應的 Workflow，且它不在 UNAVAILABLE_CAPABILITIES`,
    });
  }

  return out;
}
