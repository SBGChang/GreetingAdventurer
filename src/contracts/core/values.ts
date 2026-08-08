// contracts/core/values.ts
// 在地化文字與通知。對應 00_shared_contracts.md §2.2。

import type { JsonScalar, LocalizationKey } from './primitives';
import type { EventId, NotificationId } from './ids';

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
