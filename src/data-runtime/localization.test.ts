// data-runtime/localization.test.ts
// 釘住三件事：缺字回 undefined（不偽裝）、重複 key 直接拋（不後蓋前）、
// 語系覆蓋不齊會被 diffLocaleCoverage 抓到（建置期硬錯誤）。

import {
  createLocalizationCatalog,
  diffLocaleCoverage,
  findUnresolvedKeys,
  type RawLocalizationBundle,
} from './localization';

type Case = Readonly<{ name: string; run: () => void }>;

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

const zh: RawLocalizationBundle = {
  bundleId: 'test.zh',
  locale: 'zh-Hant',
  entries: { 'text.city.a.name': '雲京', 'text.day': '第 {day} 日' },
};
const en: RawLocalizationBundle = {
  bundleId: 'test.en',
  locale: 'en',
  entries: { 'text.city.a.name': 'Yunjing', 'text.day': 'Day {day}' },
};

const cases: readonly Case[] = [
  {
    name: 'resolve 依語系回對應文字',
    run: () => {
      const c = createLocalizationCatalog([zh, en]);
      assert(c.resolve('zh-Hant', { key: 'text.city.a.name' }) === '雲京', '繁中文字錯');
      assert(c.resolve('en', { key: 'text.city.a.name' }) === 'Yunjing', '英文文字錯');
      assert(c.locales.join(',') === 'en,zh-Hant', `locales 應排序：${c.locales.join(',')}`);
    },
  },
  {
    name: '缺 key 與缺語系一律回 undefined，不回 key 本身也不跨語系代打',
    run: () => {
      const c = createLocalizationCatalog([zh, en]);
      assert(c.resolve('zh-Hant', { key: 'text.missing' }) === undefined, '缺 key 應為 undefined');
      assert(c.resolve('ja', { key: 'text.city.a.name' }) === undefined, '缺語系應為 undefined');
      assert(!c.has('zh-Hant', 'text.missing'), 'has 應為 false');
    },
  },
  {
    name: 'params 具名插值；缺參數保留佔位符（不抹平成空字串）',
    run: () => {
      const c = createLocalizationCatalog([zh, en]);
      assert(c.resolve('zh-Hant', { key: 'text.day', params: { day: 8000 } }) === '第 8000 日', '插值錯');
      assert(c.resolve('en', { key: 'text.day', params: { day: 3 } }) === 'Day 3', '英文插值錯');
      assert(c.resolve('en', { key: 'text.day' }) === 'Day {day}', '缺參數應原樣保留佔位符');
    },
  },
  {
    name: '同語系重複 key 直接拋——不得後蓋前',
    run: () => {
      let threw = false;
      try {
        createLocalizationCatalog([zh, { ...zh, bundleId: 'test.zh.dup' }]);
      } catch {
        threw = true;
      }
      assert(threw, '重複 key 應該拋錯');
    },
  },
  {
    name: 'diffLocaleCoverage 抓出「繁中有、英文沒有」',
    run: () => {
      const partial: RawLocalizationBundle = { bundleId: 'p', locale: 'en', entries: { 'text.city.a.name': 'Yunjing' } };
      const diags = diffLocaleCoverage(createLocalizationCatalog([zh, partial]));
      assert(diags.length === 1, `應有 1 筆診斷，實得 ${diags.length}`);
      const first = diags[0];
      if (first === undefined) throw new Error('診斷不存在');
      assert(first.code === 'localization/missing-keys', `code 錯：${first.code}`);
      assert(first.detail.includes('text.day'), `應指名缺的 key：${first.detail}`);
      assert(diffLocaleCoverage(createLocalizationCatalog([zh, en])).length === 0, '齊全時不應有診斷');
    },
  },
  {
    name: 'findUnresolvedKeys 抓出「內容宣告了 nameRef 但沒有任何文字」',
    run: () => {
      const c = createLocalizationCatalog([zh, en]);
      assert(findUnresolvedKeys(c, ['text.city.a.name']).length === 0, '存在的 key 不該有診斷');
      const diags = findUnresolvedKeys(c, ['text.city.ghost.name']);
      assert(diags.length === 2, `兩個語系各一筆，實得 ${diags.length}`);
      const first = diags[0];
      if (first === undefined) throw new Error('診斷不存在');
      assert(first.code === 'localization/unresolved-reference', `code 錯：${first.code}`);
    },
  },
];

export function runTestResults(): readonly Readonly<{ name: string; passed: boolean; error?: string }>[] {
  return cases.map((c) => {
    try {
      c.run();
      return { name: c.name, passed: true };
    } catch (err) {
      return { name: c.name, passed: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
}

export function runTests(): void {
  const results = runTestResults();
  const failures = results.filter((r) => !r.passed);
  if (failures.length > 0) {
    const lines = failures.map((f) => `  ✗ ${f.name}: ${f.error ?? 'failed'}`);
    throw new Error(`localization: ${failures.length}/${results.length} test(s) failed\n${lines.join('\n')}`);
  }
}
