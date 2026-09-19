import { CHARACTER_NAME_KINDS } from './character-name-reader';
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
import { CITY_DEFINITION_KINDS } from './city-reader';
import { QUEST_DEFINITION_KINDS } from './quest-reader';
import { SOCIAL_DEFINITION_KINDS } from './social-reader';
import { ECONOMY_DEFINITION_KINDS } from './economy-reader';
import { WORLD_DEFINITION_KINDS } from './world-reader';
import { CRAFTING_DEFINITION_KINDS } from './crafting-reader';
import { DISTRIBUTION_DEFINITION_KINDS } from './distribution-reader';
import { COMBAT_SEQUENCE_DEFINITION_KINDS } from './combat-sequence-reader';
import { NPC_BEHAVIOR_DEFINITION_KINDS } from './npc-behavior-reader';
import { STATISTICS_DEFINITION_KINDS } from './statistics-reader';
import { COMBAT_POWER_DEFINITION_KINDS } from './combat-power-reader';
import { GATHERING_DEFINITION_KINDS } from './gathering-reader';
// 通用 kernel resolver 的 params 家族（§7.1「形狀＝程式、調校＝資料」的資料側）。
import { RESOLVER_PARAMS_KINDS } from './resolvers';


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


// ── 「一個 kind 一個擁有者，但可以有多個 Reader」 ──────────────────────────────
//
// `data-runtime/readers.ts` 明確允許同一筆 Definition 被多個窄化 Reader 以**不同 View** 讀取
// （例如 map 只投影 `npcPolicy`、dungeon 只投影 `dungeonInteractionMinutes`）。那是合法且必要的：
// 讀取面可以多個，**擁有面只能一個**（§12：不擁有這個事實的地方不得決定它）。
//
// 但各模組的 `XXX_DEFINITION_KINDS` 只表達「我這個 Reader 認得哪些 kind」，表達不出「這個 kind
// 是不是我的」。若直接把每個模組宣告的 kind 都當成它擁有的，就會出現同一個 kind 兩個 owner——
// 實測有 5 筆。下表把「我只是讀，不擁有」明講出來，於是擁有權維持唯一，而多 Reader 關係
// 也在這裡留下記錄，不會變成默契。
const CONSUMED_NOT_OWNED: Readonly<Record<string, readonly string[]>> = {
  // 戰力服務讀裝備效果與技能來評估，但兩者的定義分別屬 combat 與 progression。
  'combat-power': ['equipment-effect', 'skill'],
  // NPC 行為讀自由行動與旅行規則來決定下一步；兩者都是 team 的定義。
  'npc-behavior': ['free-action-rule', 'npc-travel-rule'],
  // 地牢讀採集規則取互動分鐘數；採集規則本身屬 gathering 服務（`GatheringRuleDefinition`）。
  dungeon: ['gathering-rule'],
};

// 一個模組的全部 kind 一次登記。schemaVersion 逐 kind 可覆寫（某個定義單獨改形狀時只推它自己）。
function own(
  owner: string,
  kinds: readonly string[],
  versions: Readonly<Record<string, number>> = {},
): readonly DefinitionKindRegistration[] {
  const consumedOnly = new Set(CONSUMED_NOT_OWNED[owner] ?? []);
  return kinds
    .filter((kind) => !consumedOnly.has(kind))
    .map((kind) => ({
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
  ...own('character', [...kindsOf(CHARACTER_DEFINITION_KINDS), ...kindsOf(CHARACTER_NAME_KINDS)]),
  ...own('combat', kindsOf(COMBAT_DEFINITION_KINDS), { 'combat-skill': 2, 'combat-damage-rule': 2, 'encounter-group': 2 }),
  ...own('dungeon', kindsOf(DUNGEON_DEFINITION_KINDS)),
  ...own('inventory', kindsOf(INVENTORY_DEFINITION_KINDS)),
  ...own('map', kindsOf(MAP_DEFINITION_KINDS), { 'map-template': 2 }),
  ...own('progression', kindsOf(PROGRESSION_DEFINITION_KINDS)),
  ...own('team', kindsOf(TEAM_DEFINITION_KINDS)),
  // Wave D 的九個模組與三個純服務。它們的 reader adapter 早就存在，但 kind 一直沒有登記進這張表——
  // 後果是**內容一寫就被 Compiler 拒收**（`kind 沒有登記擁有模組`），所以城市、委託、世界、製作、
  // 分配、戰鬥串、NPC 行為的內容根本沒辦法開始寫。純服務沒有 ModuleId，以其服務名登記擁有者。
  ...own('city', kindsOf(CITY_DEFINITION_KINDS)),
  ...own('quest', kindsOf(QUEST_DEFINITION_KINDS)),
  ...own('social', kindsOf(SOCIAL_DEFINITION_KINDS)),
  ...own('economy', kindsOf(ECONOMY_DEFINITION_KINDS), { 'reward-rule': 2 }),
  ...own('world', kindsOf(WORLD_DEFINITION_KINDS)),
  ...own('crafting', kindsOf(CRAFTING_DEFINITION_KINDS)),
  ...own('distribution', kindsOf(DISTRIBUTION_DEFINITION_KINDS), { 'asset-distribution-rule': 2 }),
  ...own('combat-sequence', kindsOf(COMBAT_SEQUENCE_DEFINITION_KINDS)),
  ...own('npc-behavior', kindsOf(NPC_BEHAVIOR_DEFINITION_KINDS)),
  ...own('statistics', kindsOf(STATISTICS_DEFINITION_KINDS)),
  ...own('combat-power', kindsOf(COMBAT_POWER_DEFINITION_KINDS)),
  ...own('gathering', kindsOf(GATHERING_DEFINITION_KINDS)),

  // ── 通用 kernel resolver 的 params ────────────────────────────────────────
  //
  // `resolvers.ts` 的 `logisticRollResolver` / `weightedProductResolver` 是**形狀**：它們從
  // `input.paramsDefId` 指名的定義讀出 params，再餵給 §7.1 的 kernel。也就是說調校量住在
  // Content Pack 裡——這正是「換一份 Pack 就換一套平衡」的落實點。
  //
  // 但這兩個 kind **從來沒有登記**，所以任何 params 定義都會被 Compiler 以「kind 沒有登記擁有
  // 模組」拒收：曲線調校在資料側根本寫不下去。（F1 的 character 複核者實地確認過這個卡點。）
  //
  // 擁有者記為 `data-runtime`：它們不屬任何領域模組，是 kernel 的參數形狀，跨模組共用。
  // 這與「一個 kind 一個擁有者」不衝突——擁有者就是提供那個 kernel 的那一層。
  ...own('data-runtime', kindsOf(RESOLVER_PARAMS_KINDS)),
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
