// app/composition/manifest.ts
// ExecutionOrderManifest：跨模組執行順序的**唯一真相**（12_engine_runtime.md §5.2、§6.2）。
//
// 模組只註冊「自己能執行哪些 Job Type / Subscription Handler」，不得自行決定 Job Phase、
// 訂閱哪個事件或跨模組順序。此檔即那份唯一宣告；kernel 只把它編譯成內部索引。
//
// 順序完全由陣列位置決定：不得依 bundler、檔名、import 順序、subscriber 名稱或模組自填數字。

import type { EventSubscriptionId, JobPhase, ModuleId } from '../../contracts/core';
import type { GameDomainEventType } from './messages';
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
// 事件訂閱（§5.2）
// ──────────────────────────────────────────────────────────────────────────

// subscriptionId 由 Composition 作者指定、跨版本穩定，命名 `subscription.<eventType>.<subscriber>`。
// 它不是 Runtime ID、不進存檔，也不得依陣列 index 或 import 順序動態生成。
export type EventSubscription = Readonly<{
  eventType: GameDomainEventType;
  subscriber: ModuleId;
  subscriptionId: EventSubscriptionId;
}>;

function sub(eventType: GameDomainEventType, subscriber: string): EventSubscription {
  return {
    eventType,
    subscriber: subscriber as ModuleId,
    subscriptionId: `subscription.${eventType}.${subscriber}` as EventSubscriptionId,
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

// 檢查：每個 Job Type 恰好出現一次且只屬一個 Phase；每個 subscriptionId 全域唯一；
// 每筆 EventSubscription.eventType 等於所在 Record Key。
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

  const seenSubscriptionIds = new Set<string>();
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
    }
  }

  return out;
}
