// app/engine/content-browser.ts
// 瀏覽器端的內容載入：把編譯好的 `content/**` JSON 餵給 data-runtime 的**純函式** loadContent。
//
// 為什麼不能用 src/platform/content-repository：那支用 node:fs（readFileSync/readdirSync），
// 在 renderer（瀏覽器）跑不起來。F4 架構決定（見 HANDOFF）：renderer 不碰 node:fs。
// 這裡改用 Vite 的 import.meta.glob 在**打包時**把所有 content JSON 收進來，於執行期組成
// loadContent 需要的 { manifest, packs } 形狀——與 content-repository 讀檔組出的結構逐欄一致，
// 只是來源從檔案系統換成打包進 bundle 的物件。loadContent 本身完全共用，不分叉。

import {
  loadContent,
  type CompileContentResult,
  type RawContentDefinition,
  type RawContentManifest,
  type RawContentPack,
  type RawLocalizationBundle,
} from '../../src/data-runtime';

// 打包時把 content/ 底下所有 JSON 收成 { 相對路徑: 模組 } 的 map（eager：直接拿到內容，不是 loader）。
// 路徑相對於本檔：../../content/**（app/engine → repo 根 → content）。
const CONTENT_MODULES = import.meta.glob<{ default: unknown }>('../../content/**/*.json', {
  eager: true,
});

// 把 glob 的 key（`../../content/core/pack.json`）正規化成 content 根下的相對路徑（`core/pack.json`）。
function toContentRelative(globKey: string): string {
  const marker = '/content/';
  const at = globKey.indexOf(marker);
  return at >= 0 ? globKey.slice(at + marker.length) : globKey.replace(/^(\.\.\/)+content\//, '');
}

type JsonRecord = Readonly<Record<string, unknown>>;

function byPath(): ReadonlyMap<string, unknown> {
  const out = new Map<string, unknown>();
  for (const [key, mod] of Object.entries(CONTENT_MODULES)) {
    out.set(toContentRelative(key), (mod as { default: unknown }).default);
  }
  return out;
}

function requireJson(map: ReadonlyMap<string, unknown>, path: string): unknown {
  const found = map.get(path);
  if (found === undefined) throw new Error(`content-browser：找不到打包進來的內容檔 "${path}"`);
  return found;
}

// 從打包好的 JSON 組出 loadContent 的輸入。結構鏡射 content-repository.readContentFromDisk，
// 但列舉來源是 glob map 而非目錄。
export function loadBundledContent(): CompileContentResult {
  const files = byPath();
  const manifest = requireJson(files, 'manifest.json') as RawContentManifest;

  const packs: RawContentPack[] = [];
  for (const entry of manifest.packs) {
    const header = requireJson(files, `${entry.contentRoot}/pack.json`) as Omit<RawContentPack, 'definitions'>;
    // 該 pack 目錄下、除 pack.json 外的所有 JSON 都是定義檔（與 repository 的列舉規則一致），排序以求決定性。
    const prefix = `${entry.contentRoot}/`;
    const domainPaths = [...files.keys()]
      .filter((p) => p.startsWith(prefix) && p !== `${entry.contentRoot}/pack.json` && p.endsWith('.json'))
      .sort();
    const definitions: RawContentDefinition[] = [];
    for (const dp of domainPaths) {
      const arr = requireJson(files, dp);
      if (!Array.isArray(arr)) throw new Error(`content-browser："${dp}" 的頂層必須是定義陣列`);
      for (const def of arr) definitions.push(def as JsonRecord as RawContentDefinition);
    }
    packs.push({
      packId: header.packId,
      version: header.version,
      schemaVersion: header.schemaVersion,
      runtimeCompatibility: header.runtimeCompatibility,
      scope: header.scope,
      declaredKinds: header.declaredKinds,
      requiredResolverIds: header.requiredResolverIds,
      resolverBindings: header.resolverBindings,
      definitions,
    });
  }

  // 本地化 bundle：依 manifest 宣告取，不列舉目錄（與 pack 同一原則）。一個 locale 目錄下可以
  // 有多個 pack 的 bundle 檔，各自以 bundleId 認領自己那一份。
  const localizationBundles: RawLocalizationBundle[] = manifest.localizationBundles.map((ref) => {
    const prefix = `${ref.contentRoot}/`;
    const paths = [...files.keys()].filter((p) => p.startsWith(prefix) && p.endsWith('.json')).sort();
    const entries: Record<string, string> = {};
    for (const path of paths) {
      const raw = requireJson(files, path) as Readonly<{ bundleId?: unknown; entries?: unknown }>;
      if (raw.bundleId !== ref.bundleId) continue;
      const rawEntries = raw.entries;
      if (typeof rawEntries !== 'object' || rawEntries === null) {
        throw new Error(`content-browser："${path}" 缺 entries 物件`);
      }
      for (const [key, value] of Object.entries(rawEntries as Record<string, unknown>)) {
        if (typeof value !== 'string') throw new Error(`content-browser："${path}" 的 "${key}" 不是字串`);
        entries[key] = value;
      }
    }
    return { bundleId: ref.bundleId, locale: ref.locale, entries };
  });

  return loadContent({ manifest, packs, localizationBundles });
}
