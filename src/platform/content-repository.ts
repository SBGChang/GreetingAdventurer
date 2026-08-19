// platform/content-repository.ts
// ContentRepository Platform Port：把 `content/**` 的 JSON 檔案讀成 `loadContent` 的輸入。
// 對應 13_data_runtime.md §1、§2（「載入器只接收已 parse 的 JSON；bytes → JsonValue 由 Platform Port 負責」）。
//
// 這是**唯一**做內容 I/O 的檔案。data-runtime 的 `loadContent` 保持純函式，因此：
//   * 測試可以完全不碰檔案系統（直接餵記憶體 pack）。
//   * 換平台（Electron 主行程、瀏覽器 fetch、打包進 asar）只換這一層。
//
// 紀律要點：
//   * **pack 的載入順序**由 `manifest.json` 的 `loadOrder` 明講，不依檔案系統（§1.1）。
//     但**一個 pack 內部有哪些定義檔**是由列舉該 pack 目錄取得——13_data_runtime.md §1 明定
//     「編譯器可產生索引，不要求作者手動維護巨大總表」。列舉結果依路徑排序後才使用，
//     所以同一份內容在不同平台上的載入順序仍然一致（決定性重播的前提）。
//   * 缺檔、壞 JSON、形狀不符一律**明確失敗**，不跳過、不給空陣列。少一個檔就是內容不完整，
//     那正是規範第 2 個合法出口（Content Pack 驗證失敗）該擋下的情況。
//   * 不讀 `content-source/**`（作者層）與 `docs/03_content/**`（設計來源）——正式 Runtime 只認產物。

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, posix, relative, sep } from 'node:path';

import type { ContentPackId, JsonValue, ResolverId } from '../contracts/core';
import type {
  CompileContentResult,
  ContentPackDependency,
  RawContentDefinition,
  RawContentManifest,
  RawContentPack,
} from '../data-runtime';
import { loadContent } from '../data-runtime';

// 每個 pack 目錄下的 `pack.json`：§8 的 pack 標頭。定義檔是同目錄的其餘 `*.json`。
const PACK_HEADER_FILE = 'pack.json';

type PackHeader = Omit<RawContentPack, 'definitions'>;

// ── JSON → 型別：逐欄讀取，不用 `as unknown as` ──────────────────────────────
//
// 這裡原本是兩行 `json as unknown as RawContentManifest`。那個轉型的問題不是風格：磁碟上的
// JSON 是**外部輸入**，型別斷言等於宣稱「我相信它長對」，於是少一個欄位就變成執行期
// undefined 沿著呼叫鏈飄下去——實測結果是 runtimeSatisfies 讀 minRuntimeVersion 時才炸，
// 錯誤訊息與真正的原因（pack.json 缺欄位）差了三層。
//
// 逐欄讀取讓「內容不完整」在**讀進來的那一刻**就變成可定位的錯誤，符合規範第 2 個合法出口。

type JsonRecord = Readonly<Record<string, JsonValue>>;

function fieldError(path: string, field: string, expected: string, actual: JsonValue | undefined): Error {
  const got = actual === undefined ? '缺少' : `${typeof actual}（${JSON.stringify(actual).slice(0, 60)}）`;
  return new Error(`ContentRepository："${path}" 的 ${field} 應為 ${expected}，實得 ${got}`);
}

// `Array.isArray` 會把陣列窄化成 `any[]`，無法從 JsonValue 聯集裡把 readonly 陣列排除（TS 已知限制），
// 所以 else 分支仍帶著陣列型別而不能當成 Record 用。具名述詞讓兩個分支都真的窄化——
// 這與 `data-runtime/content-pack.ts` 的 `isJsonArray` 是同一個作法，理由也相同。
function isJsonArray(value: JsonValue): value is readonly JsonValue[] {
  return Array.isArray(value);
}

function asRecord(value: JsonValue, path: string, what: string): JsonRecord {
  if (value === null || typeof value !== 'object' || isJsonArray(value)) {
    const actual = value === null ? 'null' : isJsonArray(value) ? 'array' : typeof value;
    throw new Error(`ContentRepository："${path}" 的 ${what} 應為物件，實得 ${actual}`);
  }
  return value;
}

function str(obj: JsonRecord, field: string, path: string): string {
  const v = obj[field];
  if (typeof v !== 'string' || v.length === 0) throw fieldError(path, field, '非空字串', v);
  return v;
}

function optionalStr(obj: JsonRecord, field: string, path: string): string | undefined {
  const v = obj[field];
  if (v === undefined) return undefined;
  if (typeof v !== 'string' || v.length === 0) throw fieldError(path, field, '非空字串或省略', v);
  return v;
}

function num(obj: JsonRecord, field: string, path: string): number {
  const v = obj[field];
  if (typeof v !== 'number' || !Number.isFinite(v)) throw fieldError(path, field, '有限數字', v);
  return v;
}

function bool(obj: JsonRecord, field: string, path: string): boolean {
  const v = obj[field];
  if (typeof v !== 'boolean') throw fieldError(path, field, 'boolean', v);
  return v;
}

function arr(obj: JsonRecord, field: string, path: string): readonly JsonValue[] {
  const v = obj[field];
  if (v === undefined || !isJsonArray(v)) throw fieldError(path, field, '陣列', v);
  return v;
}

function strArray(obj: JsonRecord, field: string, path: string): readonly string[] {
  return arr(obj, field, path).map((item, i) => {
    if (typeof item !== 'string' || item.length === 0) {
      throw fieldError(path, `${field}[${i}]`, '非空字串', item);
    }
    return item;
  });
}

function readDependencies(obj: JsonRecord, field: string, path: string): readonly ContentPackDependency[] {
  return arr(obj, field, path).map((item, i) => {
    const dep = asRecord(item, path, `${field}[${i}]`);
    return {
      packId: str(dep, 'packId', path) as ContentPackId,
      version: str(dep, 'version', path),
    };
  });
}

function readManifest(value: JsonValue, path: string): RawContentManifest {
  const root = asRecord(value, path, '頂層');
  return {
    manifestVersion: str(root, 'manifestVersion', path),
    loadOrder: strArray(root, 'loadOrder', path).map((id) => id as ContentPackId),
    packs: arr(root, 'packs', path).map((item, i) => {
      const pack = asRecord(item, path, `packs[${i}]`);
      return {
        packId: str(pack, 'packId', path) as ContentPackId,
        version: str(pack, 'version', path),
        requiredPacks: readDependencies(pack, 'requiredPacks', path),
        optional: bool(pack, 'optional', path),
        contentRoot: str(pack, 'contentRoot', path),
      };
    }),
    localizationBundles: arr(root, 'localizationBundles', path).map((item, i) => {
      const bundle = asRecord(item, path, `localizationBundles[${i}]`);
      return {
        bundleId: str(bundle, 'bundleId', path),
        locale: str(bundle, 'locale', path),
        contentRoot: str(bundle, 'contentRoot', path),
      };
    }),
  };
}

function readPackHeader(value: JsonValue, path: string): PackHeader {
  const root = asRecord(value, path, '頂層（§8 pack 標頭）');
  const compatibility = asRecord(root['runtimeCompatibility'] ?? null, path, 'runtimeCompatibility');
  const scope = asRecord(root['scope'] ?? null, path, 'scope');
  const maxRuntimeVersion = optionalStr(compatibility, 'maxRuntimeVersion', path);
  return {
    packId: str(root, 'packId', path) as ContentPackId,
    version: str(root, 'version', path),
    schemaVersion: num(root, 'schemaVersion', path),
    runtimeCompatibility: {
      minRuntimeVersion: str(compatibility, 'minRuntimeVersion', path),
      // 選填欄位「沒宣告上限」與「宣告了空字串」是不同的事；只有前者才省略。
      ...(maxRuntimeVersion === undefined ? {} : { maxRuntimeVersion }),
    },
    scope: {
      cultureIds: strArray(scope, 'cultureIds', path),
      features: strArray(scope, 'features', path),
    },
    declaredKinds: strArray(root, 'declaredKinds', path),
    requiredResolverIds: strArray(root, 'requiredResolverIds', path).map((id) => id as ResolverId),
  };
}

function readJsonFile(absolutePath: string): JsonValue {
  let text: string;
  try {
    text = readFileSync(absolutePath, 'utf8');
  } catch (cause) {
    throw new Error(`ContentRepository：讀不到內容檔 "${absolutePath}"（manifest 登記了它，但檔案不存在或無法讀取）`, {
      cause,
    });
  }
  try {
    return JSON.parse(text) as JsonValue;
  } catch (cause) {
    throw new Error(`ContentRepository："${absolutePath}" 不是合法 JSON`, { cause });
  }
}

function requireArray(value: JsonValue, path: string): readonly JsonValue[] {
  if (!isJsonArray(value)) {
    throw new Error(`ContentRepository："${path}" 的頂層必須是 Definition 陣列（實得 ${typeof value}）`);
  }
  return value;
}

function requireObject(value: JsonValue, path: string, index: number): RawContentDefinition {
  if (value === null || typeof value !== 'object' || isJsonArray(value)) {
    throw new Error(`ContentRepository："${path}" 第 ${index} 筆不是物件`);
  }
  return value;
}

// 列舉一個 pack 目錄下的定義檔（遞迴，排除 pack 標頭）。回傳的是 posix 形式的相對路徑並**排序**——
// 檔案系統的列舉順序在不同平台上不同，而載入順序會影響「重複 ID 先看到誰」與 list() 的順序，
// 那都是決定性重播看得見的差異。
function listDefinitionFiles(packDir: string): readonly string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.endsWith('.json')) continue;
      const rel = relative(packDir, full).split(sep).join(posix.sep);
      if (rel === PACK_HEADER_FILE) continue;
      out.push(rel);
    }
  };
  walk(packDir);
  return out.sort();
}

// 讀 manifest 與其登記的每一個 domain 檔，組出 `loadContent` 的輸入。
export function readContentFromDisk(contentRoot: string): Readonly<{
  manifest: RawContentManifest;
  packs: readonly RawContentPack[];
}> {
  const manifestPath = join(contentRoot, 'manifest.json');
  const manifestFile = readManifest(readJsonFile(manifestPath), 'manifest.json');

  const packs: RawContentPack[] = [];
  for (const entry of manifestFile.packs) {
    const packDir = join(contentRoot, entry.contentRoot);
    const headerPath = `${entry.contentRoot}/${PACK_HEADER_FILE}`;
    const header = readPackHeader(readJsonFile(join(packDir, PACK_HEADER_FILE)), headerPath);

    const definitions: RawContentDefinition[] = [];
    for (const file of listDefinitionFiles(packDir)) {
      const relativePath = `${entry.contentRoot}/${file}`;
      const parsed = requireArray(readJsonFile(join(packDir, file)), relativePath);
      parsed.forEach((def, index) => definitions.push(requireObject(def, relativePath, index)));
    }
    if (definitions.length === 0) {
      throw new Error(
        `ContentRepository：pack "${String(entry.packId)}"（${entry.contentRoot}）沒有任何定義檔。` +
          `空 pack 不是合法內容——它會讓引用它的 pack 通過相依檢查卻拿不到任何定義。`,
      );
    }

    packs.push({
      packId: header.packId,
      version: header.version,
      schemaVersion: header.schemaVersion,
      runtimeCompatibility: header.runtimeCompatibility,
      scope: header.scope,
      declaredKinds: header.declaredKinds,
      requiredResolverIds: header.requiredResolverIds,
      definitions,
    });
  }

  return { manifest: manifestFile, packs };
}

// 讀檔 + 編譯成 Registry。失敗時回傳 diagnostics（不 throw）——呼叫端（Bootstrap）依規範
// 第 2 個合法出口決定「不啟動遊戲並呈現診斷」。
export function loadContentFromDisk(contentRoot: string): CompileContentResult {
  return loadContent(readContentFromDisk(contentRoot));
}
