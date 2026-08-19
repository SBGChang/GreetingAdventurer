// scripts/lib/content-compiler.ts
// Content Compiler：作者層（`content-source/**`，TypeScript）→ 正式 Content Pack（`content/**`，純 JSON）。
//
// 規範 §2 把 Content Compiler 列入「正式執行路徑」的適用範圍，所以這支腳本自己也受紀律約束：
//   * 缺 kind 登記、缺 header 欄位、ID 重複 → **編譯失敗**，不產出檔案、不給預設值。
//   * 不做任何內容判斷（不補預設值、不猜 kind、不修 ID）。它只做機械的 header 蓋章與結構檢查。
//   * 產物是決定性的：同一份作者資料永遠產生位元相同的 JSON（key 排序 + 固定縮排 + LF）。
//     決定性是 `verify:content-packs` 能成立的前提——產物不決定性，同步門禁就只會製造雜訊。

import { requireDefinitionSchemaVersion, isRegisteredDefinitionKind } from '../../src/app/content/definition-kinds';
import { RUNTIME_DATA_CONTRACT } from '../../src/data-runtime';
import type { AuthoredManifest, AuthoredPack } from '../../content-source/authoring';

// ── 產物形狀 ────────────────────────────────────────────────────────────────
//
// 刻意與 `src/data-runtime/content-pack.ts` 的 `RawContentManifest` / `RawContentPack` 對齊：
// Platform Port 讀進來後可以直接餵給 `loadContent`，中間不需要第二層轉換。

export type CompiledFile = Readonly<{
  // 相對於 `content/` 的路徑。
  path: string;
  // 已序列化的 JSON 文本（含尾端換行）。
  text: string;
}>;

export type CompileResult = Readonly<{
  files: readonly CompiledFile[];
  definitionCount: number;
  packCount: number;
}>;

// ── 決定性序列化 ────────────────────────────────────────────────────────────

// key 依字典序排序後輸出。`JSON.stringify` 保留插入順序，而作者檔的欄位順序會隨編輯漂移——
// 那會讓同步門禁在資料完全沒變的情況下失敗。
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value === null || typeof value !== 'object') return value;
  const entries = Object.entries(value as Record<string, unknown>)
    // undefined 欄位不進 JSON：選填欄位「沒給」與「給了 undefined」在 JSON 裡是同一件事，
    // 但 JSON.stringify 對物件會直接省略它——先明確濾掉，避免 key 排序被幽靈欄位影響。
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const out: Record<string, unknown> = {};
  for (const [k, v] of entries) out[k] = canonicalize(v);
  return out;
}

function serialize(value: unknown): string {
  return `${JSON.stringify(canonicalize(value), null, 2)}\n`;
}

// ── 編譯 ────────────────────────────────────────────────────────────────────

type CompileError = Readonly<{ where: string; message: string }>;

function compilePack(pack: AuthoredPack, errors: CompileError[]): readonly CompiledFile[] {
  const files: CompiledFile[] = [];
  const seenDomains = new Set<string>();
  const presentKinds = new Set<string>();
  // ID 唯一性以 pack 為範圍檢查；跨 pack 的重複由 `loadContent` 以 loadOrder 為準另行報錯。
  const seenIds = new Map<string, string>();

  for (const domain of pack.domains) {
    const where = `${String(pack.packId)}/${domain.domain}`;
    if (seenDomains.has(domain.domain)) {
      errors.push({ where, message: `domain 名稱重複——同一個 pack 內的 domain 必須唯一（產物會互相覆蓋）` });
      continue;
    }
    seenDomains.add(domain.domain);

    if (domain.definitions.length === 0) {
      // 空 domain 不是錯，但它會產生一個空陣列檔案，讀起來像「這裡沒有內容」而不是「這個檔忘了寫」。
      // 明確報錯比留下一個沉默的空檔好。
      errors.push({ where, message: `definitions 為空——不要提交空 domain 檔；沒有內容就不要宣告這個 domain` });
      continue;
    }

    const compiled = domain.definitions.map((authored, index) => {
      const at = `${where}[${index}]`;
      const raw = authored as unknown as Record<string, unknown>;
      const id = raw['id'];
      const kind = raw['kind'];

      if (typeof id !== 'string' || id.length === 0) {
        errors.push({ where: at, message: `缺 id（或不是字串）` });
        return undefined;
      }
      if (typeof kind !== 'string' || kind.length === 0) {
        errors.push({ where: at, message: `id="${id}" 缺 kind（或不是字串）` });
        return undefined;
      }
      if (!isRegisteredDefinitionKind(kind)) {
        errors.push({
          where: at,
          message:
            `id="${id}" 的 kind="${kind}" 沒有登記擁有模組。` +
            `未登記的 kind 會讓這筆定義被所有窄化 Reader 忽略——載入成功，但永遠讀不到。`,
        });
        return undefined;
      }

      const firstSeenAt = seenIds.get(id);
      if (firstSeenAt !== undefined) {
        errors.push({ where: at, message: `id="${id}" 與 ${firstSeenAt} 重複（同一 pack 內 ID 必須唯一）` });
        return undefined;
      }
      seenIds.set(id, at);

      // `enabled` 只允許作者顯式關掉；沒寫就是啟用。
      const authoredEnabled = raw['enabled'];
      if (authoredEnabled !== undefined && authoredEnabled !== false) {
        errors.push({
          where: at,
          message: `id="${id}" 的 enabled 只能省略（＝啟用）或寫成 false。寫 true 是多餘的重述。`,
        });
        return undefined;
      }

      return {
        ...raw,
        // header 四欄由 Compiler 蓋章，蓋在最後以確保作者不會意外覆寫它們。
        id,
        kind,
        schemaVersion: requireDefinitionSchemaVersion(kind),
        packId: pack.packId,
        enabled: authoredEnabled !== false,
        // diagnostics 要能定位回產物檔；作者不需要（也不該）自己維護這個字串。
        sourcePath: `${pack.contentRoot}/${domain.domain}.json#${id}`,
      };
    });

    if (compiled.some((d) => d === undefined)) continue;

    for (const def of compiled) {
      if (def !== undefined) presentKinds.add(String(def['kind']));
    }

    files.push({
      path: `${pack.contentRoot}/${domain.domain}.json`,
      text: serialize(compiled),
    });
  }

  // 作者宣告的 declaredKinds 與實際內容交叉比對。載入器也會查一次（§8），但那時只知道
  // 「不一致」；在這裡查得到的是「多了哪些、少了哪些」，而且在產出檔案之前就擋下來。
  const declared = new Set(pack.declaredKinds);
  const undeclared = [...presentKinds].filter((k) => !declared.has(k)).sort();
  const unused = [...declared].filter((k) => !presentKinds.has(k)).sort();
  if (undeclared.length > 0) {
    errors.push({
      where: String(pack.packId),
      message:
        `內容出現未宣告的 kind：${undeclared.join(', ')}。` +
        `請加進該 pack 的 declaredKinds（宣告是刻意手寫的——見 authoring.ts 的說明）。`,
    });
  }
  if (unused.length > 0) {
    errors.push({
      where: String(pack.packId),
      message: `declaredKinds 宣告了但沒有任何定義的 kind：${unused.join(', ')}。宣告必須反映實際內容。`,
    });
  }

  // Pack 標頭（§8）。與 domain 檔分開存放，讓 ContentRepository 讀得到 pack 身分而不必解析定義。
  files.push({
    path: `${pack.contentRoot}/pack.json`,
    text: serialize({
      packId: pack.packId,
      version: pack.version,
      schemaVersion: RUNTIME_DATA_CONTRACT.packSchemaVersion,
      runtimeCompatibility: pack.runtimeCompatibility,
      scope: pack.scope,
      declaredKinds: [...pack.declaredKinds].sort(),
      requiredResolverIds: [...pack.requiredResolverIds].sort(),
    }),
  });

  return files;
}

export function compileContentSource(manifest: AuthoredManifest): CompileResult {
  const errors: CompileError[] = [];
  const files: CompiledFile[] = [];

  const declared = new Set(manifest.packs.map((p) => String(p.packId)));
  for (const packId of manifest.loadOrder) {
    if (!declared.has(String(packId))) {
      errors.push({ where: 'manifest', message: `loadOrder 含未宣告的 pack "${String(packId)}"` });
    }
  }
  for (const pack of manifest.packs) {
    if (!manifest.loadOrder.some((p) => String(p) === String(pack.packId))) {
      errors.push({
        where: 'manifest',
        message: `pack "${String(pack.packId)}" 不在 loadOrder 內——載入順序必須明確宣告，不依檔案系統列舉`,
      });
    }
  }

  let definitionCount = 0;
  for (const pack of manifest.packs) {
    const packFiles = compilePack(pack, errors);
    files.push(...packFiles);
    definitionCount += pack.domains.reduce((sum, d) => sum + d.definitions.length, 0);
  }

  // Runtime manifest：與 `RawContentManifest` **逐欄相同**，Platform Port 讀進來即可直接使用。
  // 這裡刻意不列 domain 檔名：13_data_runtime.md §1 明定「編譯器可產生索引，不要求作者手動維護
  // 巨大總表」，pack 內的檔案由 ContentRepository 列舉該 pack 目錄取得（每筆定義自帶 sourcePath）。
  // 手寫檔案總表只會變成另一個會與真實檔案漂移的複本。
  const runtimeManifest = {
    manifestVersion: manifest.manifestVersion,
    loadOrder: manifest.loadOrder,
    packs: manifest.packs.map((p) => ({
      packId: p.packId,
      version: p.version,
      requiredPacks: p.requiredPacks,
      optional: p.optional,
      contentRoot: p.contentRoot,
    })),
    // 本地化 bundle 尚未有任何內容；宣告為空陣列而不是省略欄位，讓載入器看到的是「明確地沒有」。
    localizationBundles: [],
  };
  files.push({ path: 'manifest.json', text: serialize(runtimeManifest) });

  if (errors.length > 0) {
    const lines = errors.map((e) => `  ${e.where}: ${e.message}`).join('\n');
    throw new Error(`CONTENT COMPILE FAILED（${errors.length} 筆）：\n${lines}`);
  }

  return { files, definitionCount, packCount: manifest.packs.length };
}
