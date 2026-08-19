// data-runtime/content-pack.ts
// 內容包型別、JSON 載入器與唯讀 Definition Registry。
// 對應 docs/00_core/architecture/13_data_runtime.md §1、§2、§5、§9。
//
// 無平台 I/O：載入器只接收「已 parse 的 JSON 物件」，不讀寫檔案或 network。
// 呼叫端（ContentRepository Platform Port）負責把 bytes → JsonValue，再交給這裡編譯。

import type {
  ContentPackId,
  DefinitionId,
  JsonValue,
  ResolverId,
} from '../contracts/core';
import type { DataDiagnostic } from './validation';

// ── 基礎 JSON 形狀 ────────────────────────────────────────────────────────

export type JsonObject = Readonly<{ [key: string]: JsonValue }>;

// ── Manifest（§1.1）───────────────────────────────────────────────────────

export type ContentPackDependency = Readonly<{
  packId: ContentPackId;
  version: string;
}>;

export type ContentPackReference = Readonly<{
  packId: ContentPackId;
  version: string;
  requiredPacks: readonly ContentPackDependency[];
  optional: boolean;
  contentRoot: string;
}>;

export type LocalizationBundleReference = Readonly<{
  bundleId: string;
  locale: string;
  contentRoot: string;
}>;

export type RawContentManifest = Readonly<{
  manifestVersion: string;
  packs: readonly ContentPackReference[];
  loadOrder: readonly ContentPackId[];
  localizationBundles: readonly LocalizationBundleReference[];
}>;

// ── Raw pack / raw definition ─────────────────────────────────────────────

// 作者資料檔的原始物件；必須帶 id / kind / schemaVersion / packId / enabled。
// 可選 `sourcePath` 讓 diagnostics 精準定位到來源檔。
export type RawContentDefinition = JsonObject;

// Runtime 自己的資料契約身分。**這不是內容**——它是「這一版程式能吃哪一版 pack」的宣告，
// 屬規範 §4 允許的程式身分（同 Module ID / Schema kind）。Content Pack 不得覆寫它。
// 升 packSchemaVersion 的同時必須提供 Migration（§7 第 4 步），不得只改數字。
export const RUNTIME_DATA_CONTRACT = {
  runtimeVersion: '0.1.0',
  packSchemaVersion: 1,
} as const;

// Pack 宣告它相容哪些 Runtime（§8「相容的 Runtime 版本」）。
export type PackRuntimeCompatibility = Readonly<{
  minRuntimeVersion: string;
  maxRuntimeVersion?: string;
}>;

// Pack 的文化與功能範圍（§8）。base pack 的 cultureIds 為空＝不綁文化。
export type PackScope = Readonly<{
  cultureIds: readonly string[];
  features: readonly string[];
}>;

// §8 的 pack 標頭。原本只有 packId / version / definitions 三個欄位，缺了規範 §8 明列的
// schemaVersion、Definition kind 清單、必要 Resolver 清單、文化與功能範圍、Runtime 相容版本。
// 缺這些不只是不方便——Bootstrap Gate（§11 第 2／6／7 步）因此驗不了三件事：
//   * 這份 pack 用到的 Resolver 是否全部已註冊（§11 要求「未註冊 Resolver 無法啟動」）；
//   * 這份 pack 裝進來的 kind 是否就是它自己宣告的那些（否則新 kind 可以無聲滲入）；
//   * 這份 pack 配不配這一版 Runtime（否則舊 pack 會以錯誤語意被讀進來）。
//
// **`definitionFiles` 刻意不在這裡。** 13_data_runtime.md §1 明定「編譯器可產生索引，不要求作者
// 手動維護巨大總表」，所以檔案清單由 ContentRepository 列舉檔案時導出（每筆 definition 自帶
// sourcePath），不是作者手寫的欄位。手寫總表只會變成另一個會跟真實檔案漂移的複本。
export type RawContentPack = Readonly<{
  packId: ContentPackId;
  version: string;
  schemaVersion: number;
  runtimeCompatibility: PackRuntimeCompatibility;
  scope: PackScope;
  // 本 pack 允許出現的 Definition kind。宣告了卻沒有任何定義，或出現未宣告的 kind，皆為 error。
  declaredKinds: readonly string[];
  // 本 pack 的資料引用到的 Resolver。Bootstrap 必須確認它們都已註冊才能啟動。
  requiredResolverIds: readonly ResolverId[];
  definitions: readonly RawContentDefinition[];
}>;

// ── 編譯後的 Definition（Registry 儲存單位）─────────────────────────────────

export type ContentDefinition = Readonly<{
  id: DefinitionId;
  kind: string;
  schemaVersion: number;
  packId: ContentPackId;
  enabled: boolean;
  sourcePath: string;
  // 完整原始 payload（含 header 欄位）；窄化 Reader 依此編譯各自的 View，不複製作者資料。
  data: JsonObject;
}>;

// ── Manifest Identity（§9，存檔相容比對用）─────────────────────────────────

export type ContentManifestIdentity = Readonly<{
  manifestVersion: string;
  manifestHash: string;
  packs: readonly Readonly<{ packId: ContentPackId; version: string; hash: string }>[];
}>;

// ── Query ─────────────────────────────────────────────────────────────────

export type DefinitionQuery = Readonly<{
  kinds?: readonly string[];
  packId?: ContentPackId;
  includeDisabled?: boolean; // 預設 false：list 不回傳 enabled=false 的內容
}>;

// ── Registry 介面 ───────────────────────────────────────────────────────────
// §5 的「窄化 Reader」語意由 readers.ts 提供；這裡是規範層的唯讀權威儲存。
// Registry 只回傳 readonly ContentDefinition，永不 mutate、永不靜默替換／刪除。

export interface DefinitionRegistry {
  has(id: DefinitionId): boolean;
  get(id: DefinitionId): Readonly<ContentDefinition> | undefined;
  require(id: DefinitionId): Readonly<ContentDefinition>;
  list(query?: DefinitionQuery): readonly Readonly<ContentDefinition>[];
  kindOf(id: DefinitionId): string | undefined;
  getManifestIdentity(): ContentManifestIdentity;
  readonly size: number;
}

// ── 編譯結果（§2）───────────────────────────────────────────────────────────

export type CompileReport = Readonly<{
  definitionCount: number;
  packCount: number;
  warnings: readonly DataDiagnostic[];
}>;

export type CompileContentResult =
  | Readonly<{ success: true; registry: DefinitionRegistry; report: CompileReport }>
  | Readonly<{ success: false; diagnostics: readonly DataDiagnostic[] }>;

export type LoadContentInput = Readonly<{
  manifest: RawContentManifest;
  packs: readonly RawContentPack[];
}>;

// ── Diagnostic codes（載入階段）─────────────────────────────────────────────

export const DataLoadCode = {
  MissingPack: 'data.load.missingPack',
  MissingLoadOrderEntry: 'data.load.missingLoadOrderEntry',
  CyclicPackDependency: 'data.load.cyclicPackDependency',
  MissingRequiredPack: 'data.load.missingRequiredPack',
  MalformedDefinition: 'data.load.malformedDefinition',
  DuplicateDefinitionId: 'data.load.duplicateDefinitionId',
  PackIdMismatch: 'data.load.packIdMismatch',
  // §8 pack 標頭檢查。
  PackSchemaVersionUnsupported: 'data.load.packSchemaVersionUnsupported',
  RuntimeVersionIncompatible: 'data.load.runtimeVersionIncompatible',
  UndeclaredDefinitionKind: 'data.load.undeclaredDefinitionKind',
  DeclaredKindWithoutDefinitions: 'data.load.declaredKindWithoutDefinitions',
} as const;

// 診斷訊息在指涉一筆「連 kind/id 都缺」的定義時所用的占位字。它是錯誤訊息的一部分，
// 不是任何內容值——沒有 Content Pack 會讓這個字改變意思。
const MISSING_FIELD_LABEL = 'unknown';

// ── 純函式 hash（決定性、同步、無 I/O）─────────────────────────────────────

// `Array.isArray` narrows 成 `any[]`，無法把 readonly 陣列從 JsonValue 聯集裡排除（TS 已知限制），
// 於是 else 分支仍帶著陣列型別、無法以 string 索引。具名述詞讓兩個分支都真的窄化。
function isJsonArray(value: JsonValue): value is readonly JsonValue[] {
  return Array.isArray(value);
}

// 針對 JsonValue 做 key 排序的 canonical 序列化，確保「檔案列舉順序」不影響 hash（§11.1）。
export function canonicalJson(value: JsonValue): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (isJsonArray(value)) {
    return `[${value.map((v) => canonicalJson(v)).join(',')}]`;
  }
  const keys = Object.keys(value).sort();
  const parts = keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k]!)}`);
  return `{${parts.join(',')}}`;
}

// FNV-1a 32-bit → 8 位 hex。純計算、可重播。
export function stableHash(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    // 32-bit FNV prime 乘法（以 Math.imul 保持 32-bit 語意）
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

// ── 具體 Registry 實作 ──────────────────────────────────────────────────────

class DefinitionRegistryImpl implements DefinitionRegistry {
  // 以 Map 保存主索引；以插入順序陣列保存決定性 list 順序（依 loadOrder + 檔內順序）。
  private readonly byId: ReadonlyMap<DefinitionId, ContentDefinition>;
  private readonly ordered: readonly ContentDefinition[];
  private readonly identity: ContentManifestIdentity;

  constructor(
    ordered: readonly ContentDefinition[],
    byId: ReadonlyMap<DefinitionId, ContentDefinition>,
    identity: ContentManifestIdentity,
  ) {
    this.ordered = ordered;
    this.byId = byId;
    this.identity = identity;
  }

  get size(): number {
    return this.ordered.length;
  }

  has(id: DefinitionId): boolean {
    return this.byId.has(id);
  }

  get(id: DefinitionId): Readonly<ContentDefinition> | undefined {
    return this.byId.get(id);
  }

  require(id: DefinitionId): Readonly<ContentDefinition> {
    const found = this.byId.get(id);
    if (found === undefined) {
      throw new Error(`DefinitionRegistry: unknown definition id "${id}"`);
    }
    return found;
  }

  kindOf(id: DefinitionId): string | undefined {
    return this.byId.get(id)?.kind;
  }

  getManifestIdentity(): ContentManifestIdentity {
    return this.identity;
  }

  list(query?: DefinitionQuery): readonly Readonly<ContentDefinition>[] {
    const includeDisabled = query?.includeDisabled ?? false;
    const kinds = query?.kinds;
    const packId = query?.packId;
    const result: ContentDefinition[] = [];
    for (const def of this.ordered) {
      if (!includeDisabled && !def.enabled) continue;
      if (kinds !== undefined && !kinds.includes(def.kind)) continue;
      if (packId !== undefined && def.packId !== packId) continue;
      result.push(def);
    }
    return result;
  }
}

// 測試用：直接由記憶體 Definition 建立 Registry（§11.8 最小記憶體 Reader）。
export function createDefinitionRegistry(
  definitions: readonly ContentDefinition[],
  identity: ContentManifestIdentity,
): DefinitionRegistry {
  const byId = new Map<DefinitionId, ContentDefinition>();
  for (const def of definitions) {
    byId.set(def.id, def);
  }
  return new DefinitionRegistryImpl([...definitions], byId, identity);
}

// ── Header 解析（載入階段的最小結構檢查）─────────────────────────────────────

function readString(obj: JsonObject, key: string): string | undefined {
  const v = obj[key];
  return typeof v === 'string' ? v : undefined;
}

function readNumber(obj: JsonObject, key: string): number | undefined {
  const v = obj[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function readBoolean(obj: JsonObject, key: string): boolean | undefined {
  const v = obj[key];
  return typeof v === 'boolean' ? v : undefined;
}

// ── Runtime 版本相容（§8）──────────────────────────────────────────────────
//
// 刻意只實作 `major.minor.patch` 的數值比較，不引入 semver 套件也不支援 prerelease／range 語法：
// pack 只需要表達「這版之後／之前」，而少一種語法就少一種解析歧異。欄位形狀不合法時回 false
// （＝不相容）而不是「當成沒限制」——那會讓打錯的版本字串變成靜默放行。
// 逐段解析成三元 tuple。不用 map + `as [number, number, number]`：那個轉型會讓長度不變量只存在於
// 註解裡，而下游一旦以索引讀取就又需要 `?? 0` 之類的預設值。明確取出三段、三段都驗過才回傳，
// tuple 的長度因此是型別上的事實，比較函式不再需要任何預設值。
function parseVersionSegment(text: string): number | undefined {
  return /^\d+$/.test(text) ? Number(text) : undefined;
}

function parseVersion(text: string): readonly [number, number, number] | undefined {
  const parts = text.split('.');
  if (parts.length !== 3) return undefined;
  const [rawMajor, rawMinor, rawPatch] = parts;
  if (rawMajor === undefined || rawMinor === undefined || rawPatch === undefined) return undefined;
  const major = parseVersionSegment(rawMajor);
  const minor = parseVersionSegment(rawMinor);
  const patch = parseVersionSegment(rawPatch);
  if (major === undefined || minor === undefined || patch === undefined) return undefined;
  return [major, minor, patch];
}

function compareVersions(a: readonly [number, number, number], b: readonly [number, number, number]): number {
  const [aMajor, aMinor, aPatch] = a;
  const [bMajor, bMinor, bPatch] = b;
  if (aMajor !== bMajor) return aMajor < bMajor ? -1 : 1;
  if (aMinor !== bMinor) return aMinor < bMinor ? -1 : 1;
  if (aPatch !== bPatch) return aPatch < bPatch ? -1 : 1;
  return 0;
}

export function runtimeSatisfies(
  runtimeVersion: string,
  compatibility: PackRuntimeCompatibility,
): boolean {
  const runtime = parseVersion(runtimeVersion);
  const min = parseVersion(compatibility.minRuntimeVersion);
  if (runtime === undefined || min === undefined) return false;
  if (compareVersions(runtime, min) < 0) return false;
  if (compatibility.maxRuntimeVersion === undefined) return true;
  const max = parseVersion(compatibility.maxRuntimeVersion);
  if (max === undefined) return false;
  return compareVersions(runtime, max) <= 0;
}

// ── 相依循環偵測（§1.1：Pack 相依必須無循環）───────────────────────────────

// 回傳型別以**非空 tuple** 表達「有循環就一定至少一個節點」。原本是 `readonly ContentPackId[]`，
// 於是呼叫端讀 `nodes[0]` 時型別上可能是 undefined，只好寫 `?? ('' as ContentPackId)`——
// 一個假的 ContentPackId，永遠不會發生卻永遠留在那裡。把不變量寫進型別就不需要那個預設值。
type NonEmpty<T> = readonly [T, ...T[]];

function detectCycle(
  packs: readonly ContentPackReference[],
): { cyclic: true; nodes: NonEmpty<ContentPackId> } | { cyclic: false } {
  const edges = new Map<ContentPackId, readonly ContentPackId[]>();
  for (const p of packs) {
    edges.set(
      p.packId,
      p.requiredPacks.map((d) => d.packId),
    );
  }
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<ContentPackId, number>();
  for (const p of packs) color.set(p.packId, WHITE);

  const stack: ContentPackId[] = [];

  // 回傳找到的循環而不是 boolean + 外層可變變數：非空性因此隨著值一起傳出去，
  // 呼叫端不必再補一個「理論上不會發生」的預設值。
  const visit = (node: ContentPackId): NonEmpty<ContentPackId> | undefined => {
    color.set(node, GRAY);
    stack.push(node);
    const outgoing = edges.get(node);
    if (outgoing !== undefined) {
      for (const next of outgoing) {
        const c = color.get(next);
        if (c === undefined) continue; // 缺 Pack 另行報 MissingRequiredPack
        if (c === GRAY) {
          const from = Math.max(0, stack.indexOf(next));
          const head = stack[from];
          // head 必存在（stack 至少含 node 本身），但用實際檢查而不是斷言取得它。
          if (head !== undefined) return [head, ...stack.slice(from + 1)];
        }
        if (c === WHITE) {
          const found = visit(next);
          if (found !== undefined) return found;
        }
      }
    }
    stack.pop();
    color.set(node, BLACK);
    return undefined;
  };

  for (const p of packs) {
    if (color.get(p.packId) !== WHITE) continue;
    const nodes = visit(p.packId);
    if (nodes !== undefined) return { cyclic: true, nodes };
  }
  return { cyclic: false };
}

// ── 主載入器 ────────────────────────────────────────────────────────────────
//
// 責任（§3 前半 + §1.1）：
//  - loadOrder 必須明確且覆蓋所有 pack；不依檔案系統列舉。
//  - Pack 相依必須無循環，且必要相依存在。
//  - 相同 Definition ID 不可默默後蓋前 → 直接 error。
//  - 缺 header 欄位或型別錯誤 → 可定位的 malformed error。
//  - 任一 error 皆使整體編譯失敗（§3 末：Error 不得啟動遊戲）。
//
// 深度 Schema／Reference／Rule 驗證交給 validation.ts；載入器只做結構完整性。
export function loadContent(input: LoadContentInput): CompileContentResult {
  const { manifest, packs } = input;
  const diagnostics: DataDiagnostic[] = [];
  const warnings: DataDiagnostic[] = [];

  const packById = new Map<ContentPackId, RawContentPack>();
  for (const p of packs) packById.set(p.packId, p);

  const refById = new Map<ContentPackId, ContentPackReference>();
  for (const r of manifest.packs) refById.set(r.packId, r);

  // 1) loadOrder 完整性
  for (const packId of manifest.loadOrder) {
    if (!refById.has(packId)) {
      diagnostics.push({
        severity: 'error',
        code: DataLoadCode.MissingLoadOrderEntry,
        packId,
        filePath: 'manifest.json',
        messageKey: 'data.load.missingLoadOrderEntry',
        details: { packId },
      });
    }
    if (!packById.has(packId)) {
      const ref = refById.get(packId);
      const optional = ref?.optional ?? false;
      const diag: DataDiagnostic = {
        severity: optional ? 'warning' : 'error',
        code: DataLoadCode.MissingPack,
        packId,
        filePath: 'manifest.json',
        messageKey: 'data.load.missingPack',
        details: { packId, optional },
      };
      if (optional) warnings.push(diag);
      else diagnostics.push(diag);
    }
  }

  // 2) 相依循環 + 必要相依存在
  const cycle = detectCycle(manifest.packs);
  if (cycle.cyclic) {
    diagnostics.push({
      severity: 'error',
      code: DataLoadCode.CyclicPackDependency,
      packId: cycle.nodes[0],
      filePath: 'manifest.json',
      messageKey: 'data.load.cyclicPackDependency',
      details: { cycle: [...cycle.nodes] },
    });
  }
  for (const ref of manifest.packs) {
    for (const dep of ref.requiredPacks) {
      if (!refById.has(dep.packId)) {
        diagnostics.push({
          severity: 'error',
          code: DataLoadCode.MissingRequiredPack,
          packId: ref.packId,
          filePath: 'manifest.json',
          messageKey: 'data.load.missingRequiredPack',
          details: { packId: ref.packId, requires: dep.packId },
        });
      }
    }
  }

  // 2.5) Pack 標頭（§8）：schemaVersion 與 Runtime 相容性。
  //
  // 這一關擺在收集 definition **之前**：pack 的 schemaVersion 不對，代表它每一筆定義的欄位語意
  // 都可能不同，繼續解析只會產生一堆看起來合理但意思錯了的資料。寧可整份拒絕。
  for (const packId of manifest.loadOrder) {
    const pack = packById.get(packId);
    if (pack === undefined) continue; // 已於步驟 1 報過
    if (pack.schemaVersion !== RUNTIME_DATA_CONTRACT.packSchemaVersion) {
      diagnostics.push({
        severity: 'error',
        code: DataLoadCode.PackSchemaVersionUnsupported,
        packId,
        filePath: `${pack.packId}/pack.json`,
        fieldPath: 'schemaVersion',
        messageKey: 'data.load.packSchemaVersionUnsupported',
        details: { declared: pack.schemaVersion, supported: RUNTIME_DATA_CONTRACT.packSchemaVersion },
      });
    }
    if (!runtimeSatisfies(RUNTIME_DATA_CONTRACT.runtimeVersion, pack.runtimeCompatibility)) {
      diagnostics.push({
        severity: 'error',
        code: DataLoadCode.RuntimeVersionIncompatible,
        packId,
        filePath: `${pack.packId}/pack.json`,
        fieldPath: 'runtimeCompatibility',
        messageKey: 'data.load.runtimeVersionIncompatible',
        details: {
          runtimeVersion: RUNTIME_DATA_CONTRACT.runtimeVersion,
          minRuntimeVersion: pack.runtimeCompatibility.minRuntimeVersion,
          maxRuntimeVersion: pack.runtimeCompatibility.maxRuntimeVersion ?? null,
        },
      });
    }
  }

  // 3) 依 loadOrder + 檔內順序收集 definition；偵測重複 ID
  const ordered: ContentDefinition[] = [];
  const byId = new Map<DefinitionId, ContentDefinition>();
  // 每個 pack 實際出現過的 kind，用於比對 declaredKinds（兩個方向都要對）。
  const seenKindsByPack = new Map<ContentPackId, Set<string>>();

  for (const packId of manifest.loadOrder) {
    const pack = packById.get(packId);
    if (pack === undefined) continue; // 已於步驟 1 報過
    const ref = refById.get(packId);
    const contentRoot = ref?.contentRoot ?? packId;

    pack.definitions.forEach((raw, index) => {
      const id = readString(raw, 'id') as DefinitionId | undefined;
      const kind = readString(raw, 'kind');
      const schemaVersion = readNumber(raw, 'schemaVersion');
      const enabled = readBoolean(raw, 'enabled');
      const declaredPackId = readString(raw, 'packId') as ContentPackId | undefined;
      // 壞資料的診斷標籤，不是內容值——下面幾行正要把 kind/id 缺失報成錯誤，
      // 標籤本來就得描述得出「缺了欄位的那一筆定義」是哪一筆。缺項以具名占位字表示。
      const sourcePath =
        readString(raw, 'sourcePath') ??
        `${contentRoot}/${kind ?? MISSING_FIELD_LABEL}/${id ?? `#${index}`}.json`;

      const missing: string[] = [];
      if (id === undefined) missing.push('id');
      if (kind === undefined) missing.push('kind');
      if (schemaVersion === undefined) missing.push('schemaVersion');
      if (enabled === undefined) missing.push('enabled');
      if (declaredPackId === undefined) missing.push('packId');

      if (
        id === undefined ||
        kind === undefined ||
        schemaVersion === undefined ||
        enabled === undefined ||
        declaredPackId === undefined
      ) {
        diagnostics.push({
          severity: 'error',
          code: DataLoadCode.MalformedDefinition,
          packId,
          filePath: sourcePath,
          definitionId: id,
          messageKey: 'data.load.malformedDefinition',
          details: { missingOrInvalidFields: missing },
        });
        return;
      }

      if (declaredPackId !== packId) {
        diagnostics.push({
          severity: 'error',
          code: DataLoadCode.PackIdMismatch,
          packId,
          filePath: sourcePath,
          definitionId: id,
          fieldPath: 'packId',
          messageKey: 'data.load.packIdMismatch',
          details: { declared: declaredPackId, actual: packId },
        });
        return;
      }

      // 未宣告的 kind 不得無聲進入 registry：pack.json 的 declaredKinds 是這份 pack 的
      // 內容範圍宣告，資料多長出一種 kind 代表宣告與內容已經不一致。
      if (!pack.declaredKinds.includes(kind)) {
        diagnostics.push({
          severity: 'error',
          code: DataLoadCode.UndeclaredDefinitionKind,
          packId,
          filePath: sourcePath,
          definitionId: id,
          fieldPath: 'kind',
          messageKey: 'data.load.undeclaredDefinitionKind',
          details: { kind, declaredKinds: [...pack.declaredKinds] },
        });
        return;
      }
      const seenKinds = seenKindsByPack.get(packId) ?? new Set<string>();
      seenKinds.add(kind);
      seenKindsByPack.set(packId, seenKinds);

      const existing = byId.get(id);
      if (existing !== undefined) {
        // §1.1：相同 Definition ID 不可默默後蓋前 → error，保留前者不覆蓋。
        diagnostics.push({
          severity: 'error',
          code: DataLoadCode.DuplicateDefinitionId,
          packId,
          filePath: sourcePath,
          definitionId: id,
          messageKey: 'data.load.duplicateDefinitionId',
          details: { firstPack: existing.packId, firstPath: existing.sourcePath, secondPack: packId },
        });
        return;
      }

      const def: ContentDefinition = {
        id,
        kind,
        schemaVersion,
        packId,
        enabled,
        sourcePath,
        data: raw,
      };
      byId.set(id, def);
      ordered.push(def);
    });
  }

  // 3.5) 宣告了 kind 卻沒有任何定義 → error。
  //
  // 這個方向同樣重要：`declaredKinds` 是 Bootstrap 判斷「這個 Capability 的內容到齊了嗎」的依據。
  // 宣告一個 kind 再讓它空著，等於在宣告面上假裝內容存在，而 Reader 要到執行期才會發現讀不到。
  for (const packId of manifest.loadOrder) {
    const pack = packById.get(packId);
    if (pack === undefined) continue;
    const seen = seenKindsByPack.get(packId) ?? new Set<string>();
    for (const kind of pack.declaredKinds) {
      if (seen.has(kind)) continue;
      diagnostics.push({
        severity: 'error',
        code: DataLoadCode.DeclaredKindWithoutDefinitions,
        packId,
        filePath: `${pack.packId}/pack.json`,
        fieldPath: 'declaredKinds',
        messageKey: 'data.load.declaredKindWithoutDefinitions',
        details: { kind },
      });
    }
  }

  if (diagnostics.length > 0) {
    return { success: false, diagnostics };
  }

  // 4) Manifest identity（存檔相容）
  const identity: ContentManifestIdentity = {
    manifestVersion: manifest.manifestVersion,
    manifestHash: stableHash(canonicalJson(toJsonManifest(manifest))),
    packs: manifest.loadOrder
      .map((packId) => {
        const pack = packById.get(packId);
        const ref = refById.get(packId);
        if (pack === undefined || ref === undefined) return undefined;
        return {
          packId,
          version: ref.version,
          hash: stableHash(canonicalJson(toJsonPack(pack))),
        };
      })
      .filter((x): x is Readonly<{ packId: ContentPackId; version: string; hash: string }> => x !== undefined),
  };

  const registry = new DefinitionRegistryImpl(ordered, byId, identity);
  return {
    success: true,
    registry,
    report: {
      definitionCount: ordered.length,
      packCount: identity.packs.length,
      warnings,
    },
  };
}

// manifest / pack → JsonValue（供 canonical hash 使用；型別已是 JSON 可表示形狀）。
function toJsonManifest(manifest: RawContentManifest): JsonValue {
  return manifest as JsonValue;
}
function toJsonPack(pack: RawContentPack): JsonValue {
  return pack as JsonValue;
}
