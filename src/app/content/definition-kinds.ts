// app/content/definition-kinds.ts
// 全遊戲 Definition kind 的權威登記表：kind 字串 → 擁有它的模組 + 目前 schemaVersion。
//
// 為什麼需要這一份：`kind` 是內容資料與引擎之間唯一的對齊點。窄化 Reader 以它決定「這筆定義是我的
// 嗎」，Content Pack 以它宣告「這筆定義是什麼」，驗證器以它派發 Schema validator。在這份表存在之前，
// kind 字串只散落在各模組的 `XXX_DEFINITION_KINDS` 常數裡，沒有任何地方能回答兩個問題：
//   1. 這個 kind 有人擁有嗎？（作者打錯字 → 定義永遠讀不到，載入卻成功）
//   2. 有兩個模組宣稱同一個 kind 嗎？（兩個窄化 Reader 都讀得到 → 所有權不明）
//
// 本檔以 import 各模組 reader 自己的常數來組表，**不重打 kind 字串**：改了 reader 的常數，這裡跟著改；
// 漏了登記，下面的啟動驗證會失敗。
//
// schemaVersion 的語意（13_data_runtime.md §1.1）：定義**形狀**的版本。契約改了欄位就要 +1，並提供
// 舊資料 Migration。它不是內容版本（那是 pack version）。

import type { ModuleId } from '../../contracts/core';
import { RUNTIME_DATA_CONTRACT } from '../../data-runtime';

import { CHARACTER_DEFINITION_KINDS } from './character-reader';
import { COMBAT_DEFINITION_KINDS } from './combat-reader';
import { DUNGEON_DEFINITION_KINDS } from './dungeon-reader';
import { INVENTORY_DEFINITION_KINDS } from './inventory-reader';
import { MAP_DEFINITION_KINDS } from './map-reader';
import { PROGRESSION_DEFINITION_KINDS } from './progression-reader';
import { TEAM_DEFINITION_KINDS } from './team-reader';

// ── kind 登記 ──────────────────────────────────────────────────────────────

export type DefinitionKindRegistration = Readonly<{
  kind: string;
  owner: ModuleId;
  schemaVersion: number;
}>;

// 預設版本不自己宣告一個數字：直接取 Runtime 的資料契約身分（§4 允許的「程式身分」，
// 與 Module ID／Schema kind 同類）。原本這裡寫 `const CURRENT_SCHEMA_VERSION = 1`，那是
// 第二個真相來源——`RUNTIME_DATA_CONTRACT.packSchemaVersion` 升版時它不會跟著動。
const CURRENT_SCHEMA_VERSION = RUNTIME_DATA_CONTRACT.packSchemaVersion;

// 一個模組的全部 kind 一次登記。schemaVersion 逐 kind 可覆寫（某個定義單獨改形狀時只推它自己）。
function own(
  owner: string,
  kinds: readonly string[],
  versions: Readonly<Record<string, number>> = {},
): readonly DefinitionKindRegistration[] {
  return kinds.map((kind) => ({
    kind,
    owner: owner as ModuleId,
    schemaVersion: versions[kind] ?? CURRENT_SCHEMA_VERSION,
  }));
}

// `Object.values` 對 `as const` 物件會給出字面值聯集陣列；itemKinds 是嵌套陣列，攤平處理。
function kindsOf(constants: Readonly<Record<string, string | readonly string[]>>): readonly string[] {
  return Object.values(constants).flatMap((v) => (typeof v === 'string' ? [v] : [...v]));
}

export const DEFINITION_KIND_REGISTRATIONS: readonly DefinitionKindRegistration[] = [
  ...own('character', kindsOf(CHARACTER_DEFINITION_KINDS)),
  ...own('combat', kindsOf(COMBAT_DEFINITION_KINDS)),
  ...own('dungeon', kindsOf(DUNGEON_DEFINITION_KINDS)),
  ...own('inventory', kindsOf(INVENTORY_DEFINITION_KINDS)),
  ...own('map', kindsOf(MAP_DEFINITION_KINDS)),
  ...own('progression', kindsOf(PROGRESSION_DEFINITION_KINDS)),
  ...own('team', kindsOf(TEAM_DEFINITION_KINDS)),
];

// ── 索引與啟動驗證 ─────────────────────────────────────────────────────────

// 兩個模組宣稱同一個 kind 就是所有權衝突：兩邊的窄化 Reader 都會讀到同一筆定義，而 §12 要求
// 「不擁有這個事實的地方不得決定它」。這裡在模組載入時就爆，不留到執行期。
//
// 例外：`equipment` 與 `book` 同時是 inventory 的獨立 kind 與 ItemKind 之一（裝備就是物品，
// 見 inventory-reader 的說明），它們由同一個模組登記兩次，值也相同——那不是衝突，去重即可。
function buildIndex(): ReadonlyMap<string, DefinitionKindRegistration> {
  const byKind = new Map<string, DefinitionKindRegistration>();
  for (const reg of DEFINITION_KIND_REGISTRATIONS) {
    const existing = byKind.get(reg.kind);
    if (existing !== undefined) {
      if (existing.owner === reg.owner && existing.schemaVersion === reg.schemaVersion) continue;
      throw new Error(
        `definition-kinds：kind "${reg.kind}" 被登記兩次且不一致` +
          `（${String(existing.owner)}@v${existing.schemaVersion} vs ${String(reg.owner)}@v${reg.schemaVersion}）。` +
          `一個 kind 只能有一個擁有模組。`,
      );
    }
    byKind.set(reg.kind, reg);
  }
  return byKind;
}

const BY_KIND = buildIndex();

export const ALL_DEFINITION_KINDS: readonly string[] = [...BY_KIND.keys()].sort();

export function isRegisteredDefinitionKind(kind: string): boolean {
  return BY_KIND.has(kind);
}

export function definitionKindOwner(kind: string): ModuleId | undefined {
  return BY_KIND.get(kind)?.owner;
}

// Content Compiler 蓋 header 用。**缺 kind 登記時不得給預設版本**——那會讓打錯字的 kind
// 帶著 schemaVersion 1 通過編譯，然後在 Reader 端變成「查不到這筆定義」。
export function requireDefinitionSchemaVersion(kind: string): number {
  const reg = BY_KIND.get(kind);
  if (reg === undefined) {
    throw new Error(
      `definition-kinds：kind "${kind}" 沒有登記擁有模組。` +
        `新增 Definition kind 時，先在對應模組的 XXX_DEFINITION_KINDS 宣告，再登記進 DEFINITION_KIND_REGISTRATIONS。` +
        `已登記的 kind：${ALL_DEFINITION_KINDS.join(', ')}`,
    );
  }
  return reg.schemaVersion;
}
