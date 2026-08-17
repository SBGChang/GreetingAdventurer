// contracts/core/primitives.ts
// 基礎純量與 branded 型別家族。對應 docs/00_core/architecture/00_shared_contracts.md §2。
// 這裡不 import 任何遊戲模組、React、Electron 或平台程式（硬性依賴規則 1）。

export type WorldDay = number; // 非負整數；世界日曆唯一權威
export type DungeonMinute = number; // 非負整數；玩家迷宮內局部時間
export type Revision = number; // 實體狀態變動時遞增
export type Seed = string;
export type LocalizationKey = string;

export type JsonScalar = string | number | boolean | null;
// 陣列成員為 readonly：本專案的 JSON 一律是**讀進來的內容資料**，各處都以 `readonly T[]` 持有
// （如 RawContentManifest.packs）。原本宣告成可變 `JsonValue[]`，於是 readonly 資料轉不進 JsonValue，
// 而那個轉不進去被 `as unknown as` 蓋掉了——不是型別對不上，是 JsonValue 說不出自己資料的形狀。
// `T[]` 仍可指派給 `readonly T[]`，所以放寬只增加可指派性，不影響既有建構端。
export type JsonValue = JsonScalar | readonly JsonValue[] | { [key: string]: JsonValue };

// branded 別名基底；不得對已 branded 的 ID 再套第二層 Brand。
export type Brand<T, K extends string> = T & { readonly __brand: K };

// ID 家族：
// - DefinitionId<K>：靜態內容定義（資料檔作者指定）。
// - RuntimeId<K>：本局執行期產生的實例。
// - EphemeralId<K>：只存在單次純計算 Input／Result，不進 State、Save、Job 或 Event。
// - TemplateLocalId<K>：只要求在父模板內唯一；不由核心 ID 產生器配發。
export type DefinitionId<K extends string = string> = Brand<string, `definition:${K}`>;
export type RuntimeId<K extends string = string> = Brand<string, `runtime:${K}`>;
export type EphemeralId<K extends string = string> = Brand<string, `ephemeral:${K}`>;
export type TemplateLocalId<K extends string> = Brand<string, `template-local:${K}`>;
