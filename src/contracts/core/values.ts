// contracts/core/values.ts
// 在地化文字與通知。對應 00_shared_contracts.md §2.2。

import type { JsonScalar, LocalizationKey } from './primitives';
import type {
  ContentEventDefinitionId,
  ContentEventInstanceId,
  EventId,
  NotificationId,
  RngStreamId,
} from './ids';

// core 型別：Definition、Event、Rejection、Notification 與 ViewModel 皆引用它；UI 邊界才依語系解析。
export type LocalizedTextRef = Readonly<{
  key: LocalizationKey;
  params?: Readonly<Record<string, JsonScalar>>;
}>;

export type NotificationTone = 'info' | 'success' | 'warning' | 'error';

// Core／Engine 產出的語意通知。UI 顯示模型 UiNotice 由 Application 投影，定義於 UI 契約。
export type Notification = Readonly<{
  id: NotificationId;
  sourceEventId?: EventId;
  message: LocalizedTextRef;
  tone: NotificationTone;
  dedupeKey?: string;
}>;

// ModuleResult 只回傳 Draft；Runner 配發 NotificationId 後才成為正式 Notification。
export type NotificationDraft = Readonly<Omit<Notification, 'id'>>;

// ── 內容事件實例 ────────────────────────────────────────────────────────────
//
// 內容事件（地牢事件房、旅行事件…）在世界裡被實體化後的最小身分。
//
// 這個型別原本在 **contracts/dungeon 與 contracts/team 各有一份**：dungeon 那份自己標著
// `[EXTERNAL PLACEHOLDER] 由內容/事件模組擁有`，team 那份標著「擁有者待定」。兩份形狀還不一樣
// （team 那份少了 definitionId）——正是 check-contract-duplicates 在防的影子型別：同一個概念
// 兩個宣告，跨模組傳遞時編譯器看不出不匹配。
//
// 放在 core 而不是挑一個模組當擁有者，是因為**沒有**模組擁有它：dungeon 用它表示事件房的 Pending
// 互動、team 用它表示旅行事件，兩邊都只是消費者。它的 ID 家族（ContentEventInstanceId /
// ContentEventDefinitionId）本來就住在 core，實例的形狀跟著回來是一致的。
export type ContentEventInstance = Readonly<{
  instanceId: ContentEventInstanceId;
  definitionId: ContentEventDefinitionId;
  // 該實例專屬的 RNG stream：同一個事件定義在不同實例上必須能得到不同結果，且可重播。
  rngStreamId: RngStreamId;
}>;
