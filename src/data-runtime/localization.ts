// data-runtime/localization.ts
// 本地化 bundle 的載入形狀與唯讀查詢目錄（13_data_runtime.md §2 的 `RawLocalizationBundle`
// ＋ 15_ui_application.md §10「核心 State 不保存已翻譯文字，UI 邊界依語系解析」）。
//
// ── 為什麼文字要走這一層，而不是在 UI 寫中文 ────────────────────────────────
//
// 名稱是**內容**：換一份 Content Pack，城市就該換名字；換一個語系，同一份 Pack 也該換名字。
// 這兩個維度互相獨立，所以文字不能住在 Definition 裡（那樣一份 Pack 只能有一種語言），
// 也不能住在 UI 程式裡（那樣換 Pack 不會變）。它住在「Pack 宣告 key、bundle 依語系提供文字」
// 的交叉點上：Definition 帶 `LocalizedTextRef`，bundle 把 key 對到該語系的字。
//
// ── 缺字的處理（規範 §「五個合法出口」）────────────────────────────────────
//
// `resolve()` 缺 key 時回 `undefined`，**不**回 key 本身、不回空字串、不回另一個語系的字。
// 那三種都是「把缺內容偽裝成有內容」：畫面看起來正常，於是沒有人會發現少了翻譯。
// 由呼叫端（UI 邊界）決定怎麼呈現缺字，而缺字本身則由下面的 `diffLocaleCoverage()`
// 在**建置期**就變成硬錯誤——這才是真正擋住漏翻譯的地方。
//
// 語系之間必須**覆蓋完全相同的 key 集合**。只加了繁中沒加英文 = 編譯失敗，不是執行期才發現。

import type { JsonScalar, LocalizationKey, LocalizedTextRef } from '../contracts/core';

// 語系代碼（BCP 47，例：`zh-Hant`、`en`）。它是資料身分，不是列舉——新增語系不該要改程式。
export type LocaleId = string;

// 一份 bundle：某個語系、某個來源檔的 key → 文字。
export type RawLocalizationBundle = Readonly<{
  bundleId: string;
  locale: LocaleId;
  entries: Readonly<Record<LocalizationKey, string>>;
}>;

export type LocalizationDiagnostic = Readonly<{
  code: string;
  detail: string;
}>;

// ── 參數插值 ────────────────────────────────────────────────────────────────
//
// `LocalizedTextRef.params` 的唯一用途是把數字/名稱插進句子（「第 {day} 日」）。
// 這**不是** expression DSL：只做具名佔位符的字面替換，沒有運算、沒有條件、沒有函式。
// 未提供的佔位符原樣保留——那是缺參數的證據，不該被抹平成空字串。
const PLACEHOLDER = /\{([a-zA-Z][a-zA-Z0-9_]*)\}/g;

function interpolate(template: string, params: Readonly<Record<string, JsonScalar>> | undefined): string {
  if (params === undefined) return template;
  return template.replace(PLACEHOLDER, (whole, name: string) => {
    const value = params[name];
    return value === undefined || value === null ? whole : String(value);
  });
}

// ── 目錄 ────────────────────────────────────────────────────────────────────

export interface LocalizationCatalog {
  // 本目錄實際載到的語系，依字典序。
  readonly locales: readonly LocaleId[];
  has(locale: LocaleId, key: LocalizationKey): boolean;
  // 缺語系或缺 key 一律回 undefined——呼叫端負責呈現，本層不代為決定文字。
  resolve(locale: LocaleId, ref: LocalizedTextRef): string | undefined;
  // 某語系的全部 key（覆蓋率檢查與測試用）。
  keysOf(locale: LocaleId): readonly LocalizationKey[];
}

export function createLocalizationCatalog(
  bundles: readonly RawLocalizationBundle[],
): LocalizationCatalog {
  // locale → (key → text)。同一語系可由多份 bundle（core / 各文化 pack）合併而成。
  const byLocale = new Map<LocaleId, Map<LocalizationKey, string>>();
  for (const bundle of bundles) {
    let table = byLocale.get(bundle.locale);
    if (table === undefined) {
      table = new Map<LocalizationKey, string>();
      byLocale.set(bundle.locale, table);
    }
    for (const [key, text] of Object.entries(bundle.entries)) {
      // 後蓋前是靜默覆寫，與 §1.1「相同 Definition ID 不可默默後蓋前」同一個理由：
      // 兩個 pack 都定義同一句話時，沒有任何一方是「對的」，必須由作者解決。
      if (table.has(key)) {
        throw new Error(
          `LocalizationCatalog：語系 "${bundle.locale}" 的 key "${key}" 被重複定義` +
            `（後一筆來自 bundle "${bundle.bundleId}"）——重複的文字必須由作者消除，不得後蓋前`,
        );
      }
      table.set(key, text);
    }
  }

  const locales = [...byLocale.keys()].sort();

  return {
    locales,
    has: (locale, key) => byLocale.get(locale)?.has(key) ?? false,
    resolve: (locale, ref) => {
      const text = byLocale.get(locale)?.get(ref.key);
      return text === undefined ? undefined : interpolate(text, ref.params);
    },
    keysOf: (locale) => [...(byLocale.get(locale)?.keys() ?? [])].sort(),
  };
}

// ── 覆蓋率檢查（建置期硬錯誤）───────────────────────────────────────────────
//
// 「繁中有、英文沒有」必須在編譯時就爆掉。如果放到執行期才發現，玩家看到的會是一個
// 缺字的畫面，而開發者看到的是綠色的 CI。
export function diffLocaleCoverage(catalog: LocalizationCatalog): readonly LocalizationDiagnostic[] {
  const out: LocalizationDiagnostic[] = [];
  if (catalog.locales.length === 0) return out;

  const union = new Set<LocalizationKey>();
  for (const locale of catalog.locales) for (const key of catalog.keysOf(locale)) union.add(key);

  for (const locale of catalog.locales) {
    const missing = [...union].filter((key) => !catalog.has(locale, key)).sort();
    if (missing.length > 0) {
      out.push({
        code: 'localization/missing-keys',
        detail:
          `語系 "${locale}" 缺 ${missing.length} 個 key：` +
          `${missing.slice(0, 10).join(', ')}${missing.length > 10 ? ' …' : ''}`,
      });
    }
  }
  return out;
}

// 內容宣告了 `nameRef` 卻沒有任何語系提供文字——這是「Definition 指向不存在的文字」，
// 與引用不存在的 Definition ID 同級的錯誤。
export function findUnresolvedKeys(
  catalog: LocalizationCatalog,
  referencedKeys: readonly LocalizationKey[],
): readonly LocalizationDiagnostic[] {
  const out: LocalizationDiagnostic[] = [];
  for (const locale of catalog.locales) {
    const missing = referencedKeys.filter((key) => !catalog.has(locale, key)).sort();
    if (missing.length > 0) {
      out.push({
        code: 'localization/unresolved-reference',
        detail:
          `語系 "${locale}" 沒有內容引用到的 ${missing.length} 個 key：` +
          `${missing.slice(0, 10).join(', ')}${missing.length > 10 ? ' …' : ''}`,
      });
    }
  }
  return out;
}
