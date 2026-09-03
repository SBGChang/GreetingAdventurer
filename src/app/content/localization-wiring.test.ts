// app/content/localization-wiring.test.ts
// 本地化端到端：真實 Content Pack（core + yunhua）→ loadContent → LocalizationCatalog，
// 證明「同一份 Pack、換語系就換名字」在正式路徑上成立。
//
// 這條路徑要證的是三件互相獨立的事：
//   1. Definition 只帶 nameRef（不帶已翻譯字串），文字由 bundle 依語系提供。
//   2. 兩個語系覆蓋同一組 key——缺一半會在載入期就被擋下，不是畫面上才發現。
//   3. UI 真正會用到的三種東西（城市、設施、冒險據點）都解析得出來。

import { resolve } from 'node:path';

import { loadContentFromDisk } from '../../platform/content-repository';
import { diffLocaleCoverage } from '../../data-runtime';
import type { CityNodeDefinition, AdventureSiteDefinition } from '../../contracts/world';
import type { FacilityDefinition, CityDefinition } from '../../contracts/city';

const CONTENT_ROOT = resolve(import.meta.dirname, '../../../content');

type Case = Readonly<{ name: string; run: () => void }>;

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

const loaded = loadContentFromDisk(CONTENT_ROOT);
if (!loaded.success) {
  throw new Error(`本地化測試前置失敗：內容載入失敗 ${loaded.diagnostics.map((d) => d.code).join(', ')}`);
}
const { registry, localization } = loaded;

const START_CITY = 'city-node.yunhua.yunjing';

function dataOf<T>(id: string): T {
  const def = registry.get(id as never);
  if (def === undefined) throw new Error(`找不到定義 "${id}"`);
  return def.data as unknown as T;
}

const cases: readonly Case[] = [
  {
    name: '兩個語系都載入，且覆蓋完全一致',
    run: () => {
      assert(localization.locales.join(',') === 'en,zh-Hant', `語系應為 en,zh-Hant，實得 ${localization.locales.join(',')}`);
      const gaps = diffLocaleCoverage(localization);
      assert(gaps.length === 0, `語系覆蓋不齊：${gaps.map((g) => g.detail).join(' / ')}`);
      const zhCount = localization.keysOf('zh-Hant').length;
      assert(zhCount > 0, 'zh-Hant 沒有任何文字');
      assert(localization.keysOf('en').length === zhCount, '兩語系 key 數不同');
    },
  },
  {
    name: '城市名稱：同一份 Pack，換語系換名字',
    run: () => {
      const node = dataOf<CityNodeDefinition>(START_CITY);
      const zh = localization.resolve('zh-Hant', node.display.nameRef);
      const en = localization.resolve('en', node.display.nameRef);
      assert(zh === '雲京', `繁中城市名應為 雲京，實得 ${String(zh)}`);
      assert(en === 'Yunjing', `英文城市名應為 Yunjing，實得 ${String(en)}`);
    },
  },
  {
    name: 'Definition 本身不含已翻譯字串——只有 nameRef',
    run: () => {
      const node = dataOf<Record<string, unknown>>(START_CITY);
      const serialized = JSON.stringify(node);
      assert(!serialized.includes('雲京'), 'city-node 定義裡不該出現已翻譯的中文名');
      assert(!serialized.includes('Yunjing'), 'city-node 定義裡不該出現已翻譯的英文名');
      assert(serialized.includes('nameRef'), 'city-node 定義應帶 nameRef');
    },
  },
  {
    name: '主城十種設施在兩個語系都有名字',
    run: () => {
      const city = registry
        .list({ kinds: ['city'] })
        .map((d) => d.data as unknown as CityDefinition)
        .find((c) => String(c.worldCityId) === START_CITY);
      if (city === undefined) throw new Error('找不到起始城市的 city 定義');
      assert(city.facilityIds.length === 10, `雲京應有 10 個設施，實得 ${city.facilityIds.length}`);
      for (const fid of city.facilityIds) {
        const facility = dataOf<FacilityDefinition>(String(fid));
        for (const locale of localization.locales) {
          const text = localization.resolve(locale, facility.display.nameRef);
          assert(
            text !== undefined && text.length > 0,
            `設施 ${String(fid)} 在語系 ${locale} 沒有名字（key=${facility.display.nameRef.key}）`,
          );
        }
      }
      // 抽驗兩個具體字：公會與酒館。
      const guild = city.facilityIds
        .map((f) => dataOf<FacilityDefinition>(String(f)))
        .find((f) => f.facilityKind === 'adventurerGuild');
      if (guild === undefined) throw new Error('雲京沒有冒險者公會');
      assert(localization.resolve('zh-Hant', guild.display.nameRef) === '冒險者公會', '公會繁中名錯');
      assert(localization.resolve('en', guild.display.nameRef) === "Adventurer's Guild", '公會英文名錯');
    },
  },
  {
    name: '九座冒險據點在兩個語系都有名字',
    run: () => {
      const sites = registry.list({ kinds: ['adventure-site'] });
      assert(sites.length === 9, `應有 9 座據點，實得 ${sites.length}`);
      for (const def of sites) {
        const site = def.data as unknown as AdventureSiteDefinition;
        for (const locale of localization.locales) {
          const text = localization.resolve(locale, site.display.nameRef);
          assert(text !== undefined && text.length > 0, `據點 ${String(def.id)} 在 ${locale} 沒有名字`);
        }
      }
    },
  },
  {
    name: '缺 key 回 undefined——不回 key 本身、不跨語系代打',
    run: () => {
      assert(localization.resolve('zh-Hant', { key: 'text.does.not.exist' }) === undefined, '缺 key 應為 undefined');
      assert(localization.resolve('ja', { key: 'text.city-node.yunhua.yunjing.name' }) === undefined, '未載入語系應為 undefined');
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
    throw new Error(`localization-wiring: ${failures.length}/${results.length} test(s) failed\n${lines.join('\n')}`);
  }
}
