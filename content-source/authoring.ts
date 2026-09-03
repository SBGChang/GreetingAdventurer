// content-source/authoring.ts
// 內容作者層的型別與工具。**這一層是建置期（design-time）的，不是 Runtime。**
//
// ── 這個目錄為什麼存在 ────────────────────────────────────────────────────────
//
// 規範要求兩件看起來衝突的事：
//   (a) 正式 Runtime 的內容必須是**純資料 Content Pack**（不得夾帶可執行腳本、不得有 expression DSL）。
//   (b) 資料必須**對得上 Definition Schema**——欄位少一個、ID 家族錯一個，都要在啟動前被擋下。
//
// 只寫手工 JSON 能滿足 (a) 但滿足不了 (b)：JSON 沒有型別，錯誤要等到執行期才浮現，而那時候
// 「缺欄位」和「內容就是這樣」長得一模一樣。
//
// 這裡的作法是把兩者分開：
//   * `content-source/**`（本目錄）是**作者層**，用 TypeScript 撰寫並以真實 Definition 型別標註，
//     因此 `tsc` 就是內容的 Schema 驗證器——欄位錯、ID 家族錯、聯集值不合法，全部編譯失敗。
//   * `content/**` 是 Content Compiler 的**產物**，純 JSON、零邏輯，正式 Runtime 只讀它。
//
// 所以：
//   * 正式 Runtime **永不** import 本目錄（紀律門禁的依賴圖檢查會擋下任何嘗試）。
//   * 本目錄裡出現內容 ID 字面值是**正常且必要**的——這裡就是內容 ID 合法的地方。
//     （門禁掃 `src/`，本目錄在 `src/` 外，因此天然不受「硬編碼內容 ID」檢查。這不是豁免：
//     那項檢查的用意是「Handler 不得自己決定內容」，而這裡就是內容本身。）
//   * 反之，本目錄**不得**出現任何遊戲規則邏輯。只能有資料、ID 常數，以及為了避免逐筆重打而存在的
//     純資料展開工具（例如「同一條武器線的五個品級」）。判準：這裡寫的每一行，換一份 Pack 都會改。

import type { ContentPackId, CultureId, DefinitionId, ResolverBinding, ResolverId } from '../src/contracts/core';
import type { DefinitionHeader } from '../src/contracts/core';

// ── 作者層的一筆定義 ────────────────────────────────────────────────────────
//
// 作者提供 `id` + `kind` + 領域欄位；`schemaVersion` / `packId` / `enabled` 由 Compiler 蓋上
// （version 取自 kind 登記表，packId 取自所在 pack）。作者不重打這三個——重打就會漂移。
//
// `enabled` 可由作者顯式關掉：那是「這筆內容存在但本版不啟用」的正式表達（§1.1），
// 與「還沒做」不同——還沒做的東西根本不該出現在 pack 裡。
export type Authored<TDefinition extends DefinitionHeader> = Readonly<{
  kind: string;
  enabled?: false;
}> &
  Omit<TDefinition, 'schemaVersion' | 'packId' | 'enabled'>;

// ── 本地化（作者層）──────────────────────────────────────────────────────
//
// 本遊戲出貨的語系。加一個語系 = 在這裡加一筆，然後 `LocalizedName` 會**強制**每一個既有名稱
// 都補上該語系——漏翻譯是編譯錯誤，不是執行期的空白畫面。
export const SUPPORTED_LOCALES = ['zh-Hant', 'en'] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

// 一個名稱的全語系寫法。刻意用**非 optional 的具名欄位**而不是 `Record<string, string>`：
// 後者可以只填一半而編譯器不會說話，那正是規範 §「一個 Func 一張表」要避免的「不適用與忘了填
// 分不出來」。這裡兩個欄位都必填，所以「加了中文忘了英文」在 tsc 就爆。
export type LocalizedName = Readonly<Record<SupportedLocale, string>>;

// 作者層的一筆文字。`key` 是 Definition 的 `nameRef.key`，由 `textKeyFor()` 產生。
export type AuthoredText = Readonly<{
  key: string;
  name: LocalizedName;
}>;

// nameRef key 的唯一產生方式。機械式從 Definition ID 導出，因此 Compiler 能反過來驗證
// 「每一個 nameRef 都有對應文字、每一筆文字都有人引用」——手打 key 就沒有這個保證。
export function textKeyFor(definitionId: string): string {
  return `text.${definitionId}.name`;
}

// 一個 domain 檔案的匯出形狀。Compiler 逐檔讀 `definitions` 與 `texts`。
export type AuthoredDomain = Readonly<{
  // 產物檔名（`content/<culture>/<domain>.json`）。同一個 pack 內不得重複。
  domain: string;
  definitions: readonly Authored<DefinitionHeader>[];
  // 本 domain 宣告的顯示文字。Compiler 依語系拆成 `content/locale/<locale>/<pack>.json`。
  texts?: readonly AuthoredText[];
}>;

// ── Pack 宣告 ──────────────────────────────────────────────────────────────

export type AuthoredPack = Readonly<{
  packId: ContentPackId;
  version: string;
  // 內容根目錄（產物與 diagnostics 的路徑前綴）。
  contentRoot: string;
  // 本 pack 必要的相依 pack；缺了就不得啟動（§1.1）。
  requiredPacks: readonly Readonly<{ packId: ContentPackId; version: string }>[];
  optional: boolean;
  // 本 pack 的文化與功能範圍（§8）。base pack 的 cultureIds 為空＝不綁文化。
  scope: Readonly<{ cultureIds: readonly string[]; features: readonly string[] }>;
  // 本 pack 的資料引用到的 Resolver。Bootstrap 必須確認它們都已註冊才能啟動（§11）。
  // 作者必須明講：漏了會讓「用到未註冊 Resolver」的 pack 一路載入成功，直到玩家觸發它。
  requiredResolverIds: readonly ResolverId[];
  // 本 pack **宣告並提供** shape 綁定的 Resolver（§11）：每筆把一個 Resolver ID 對到一個程式側
  // shape 代碼鍵。組裝 ResolverRegistry 時據此註冊實作。Resolver 由模組擁有、不由文化擁有，所以
  // 通常宣告在 core（例 combat 的目標形狀），文化 pack 只在自己的規則裡**引用**這些 ID。
  resolverBindings: readonly ResolverBinding[];
  // 這一版 Runtime 相容性宣告（§8）。
  runtimeCompatibility: Readonly<{ minRuntimeVersion: string; maxRuntimeVersion?: string }>;
  // 本 pack 允許出現的 Definition kind。
  //
  // 這一欄**故意**要作者手寫，而不是由 Compiler 從內容推導。推導出來的宣告永遠等於內容，
  // 於是載入器的「出現未宣告的 kind」檢查就永遠通過——一個永遠通過的檢查等於沒有檢查。
  // 作者宣告 + 引擎交叉比對，才擋得住「新 kind 無聲滲入某個 pack」。
  // Compiler 會在編譯期就比對這份宣告與實際內容，並指出多出／少掉哪些 kind。
  declaredKinds: readonly string[];
  domains: readonly AuthoredDomain[];
}>;

export type AuthoredManifest = Readonly<{
  manifestVersion: string;
  // 明確的載入順序；不依檔案系統列舉（§1.1）。
  loadOrder: readonly ContentPackId[];
  packs: readonly AuthoredPack[];
}>;

// ── 型別化的 ID 工具 ────────────────────────────────────────────────────────
//
// 內容 ID 的字串形狀是**規約**（`docs/03_content/yunhua/yunhua_content.md` §5），
// 不是隨手拼的：`<kind 前綴>.<culture>.<local>`。以工具產生而不是逐筆手打字串，
// 可以讓「打錯一個字導致引用失效」變成編譯期或至少是集中一處的問題。
export function definitionId<TId extends DefinitionId>(
  prefix: string,
  culture: string,
  local: string,
): TId {
  if (prefix.length === 0 || culture.length === 0 || local.length === 0) {
    throw new Error(`definitionId：三段皆不得為空（prefix="${prefix}" culture="${culture}" local="${local}"）`);
  }
  return `${prefix}.${culture}.${local}` as TId;
}

// 一個文化的 ID 工廠：把 culture 段固定下來，作者只寫 kind 前綴與 local 名。
export type CultureIds = Readonly<{
  cultureId: CultureId;
  culture: string;
  id: <TId extends DefinitionId>(prefix: string, local: string) => TId;
}>;

export function cultureIds(culture: string): CultureIds {
  return {
    // 文化本身的 ID 只有兩段（`culture.yunhua`）——它就是那個 culture 段，不需要 local 名。
    // 設計來源的 `cultureMeta.id` 已是這個形狀，維持一致。
    cultureId: `culture.${culture}` as CultureId,
    culture,
    id: <TId extends DefinitionId>(prefix: string, local: string): TId =>
      definitionId<TId>(prefix, culture, local),
  };
}
