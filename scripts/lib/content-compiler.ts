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
import { SUPPORTED_LOCALES } from '../../content-source/authoring';

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

type CompiledDomain = Readonly<{
  packId: string;
  domain: string;
  definitions: readonly Record<string, unknown>[];
}>;

function compilePack(
  pack: AuthoredPack,
  errors: CompileError[],
  compiledOut: CompiledDomain[],
): readonly CompiledFile[] {
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
    compiledOut.push({
      packId: String(pack.packId),
      domain: domain.domain,
      definitions: compiled.filter((d): d is Record<string, unknown> => d !== undefined),
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
      // Resolver shape 綁定，依 resolverId 決定性排序（產物穩定、diff 乾淨）。
      resolverBindings: [...pack.resolverBindings].sort((a, b) =>
        String(a.resolverId) < String(b.resolverId) ? -1 : String(a.resolverId) > String(b.resolverId) ? 1 : 0,
      ),
    }),
  });

  return files;
}


// ── 本地化 bundle 的產出與雙向完整性檢查 ────────────────────────────────────
//
// 兩個方向都要檢查，因為它們漏掉的是不同的東西：
//   * nameRef → 文字：Definition 指了一個不存在的 key ＝ 畫面上會有一個沒有名字的東西。
//   * 文字 → nameRef：宣告了沒有人引用的文字 ＝ 改了名字卻沒有生效（或是刪定義忘了刪文字）。
// 只做前者的話，第二種會安靜地累積成一堆騙人的翻譯。
function collectNameRefKeys(value: unknown, out: Set<string>): void {
  if (Array.isArray(value)) {
    for (const item of value) collectNameRefKeys(item, out);
    return;
  }
  if (typeof value !== 'object' || value === null) return;
  const record = value as Record<string, unknown>;
  const nameRef = record['nameRef'];
  if (typeof nameRef === 'object' && nameRef !== null) {
    const key = (nameRef as Record<string, unknown>)['key'];
    if (typeof key === 'string') out.add(key);
  }
  for (const child of Object.values(record)) collectNameRefKeys(child, out);
}

function compileLocalization(
  manifest: AuthoredManifest,
  compiledDomains: readonly CompiledDomain[],
  errors: CompileError[],
): Readonly<{ files: readonly CompiledFile[]; bundles: readonly Record<string, unknown>[] }> {
  const files: CompiledFile[] = [];
  const bundles: Record<string, unknown>[] = [];

  // 全部 pack 的定義實際引用到的 key。
  const referenced = new Set<string>();
  for (const domain of compiledDomains) collectNameRefKeys(domain.definitions, referenced);

  const declared = new Set<string>();
  for (const pack of manifest.packs) {
    const texts = pack.domains.flatMap((d) => d.texts ?? []);
    if (texts.length === 0) continue;

    const seen = new Map<string, string>();
    for (const text of texts) {
      const first = seen.get(text.key);
      if (first !== undefined) {
        errors.push({
          where: `${String(pack.packId)}/locale`,
          message: `文字 key "${text.key}" 重複宣告（先前於 ${first}）——重複必須由作者消除，不得後蓋前`,
        });
        continue;
      }
      seen.set(text.key, `${String(pack.packId)}`);
      declared.add(text.key);
    }

    for (const locale of SUPPORTED_LOCALES) {
      const entries: Record<string, string> = {};
      for (const text of texts) entries[text.key] = text.name[locale];
      const bundleId = `bundle.${String(pack.packId).replace(/^pack:/, '')}.${locale}`;
      const contentRoot = `locale/${locale}`;
      files.push({
        path: `${contentRoot}/${String(pack.packId).replace(/^pack:/, '')}.json`,
        text: serialize({ bundleId, locale, entries }),
      });
      bundles.push({ bundleId, locale, contentRoot });
    }
  }

  // ── 未授權文字的棘輪 ──────────────────────────────────────────────────
  //
  // 裝備／道具／素材／貨幣的 `nameRef` 曾經在本地化管線存在**之前**就寫進內容，指向的 key
  // 沒有人提供文字。那筆欠債用這個棘輪逐步清掉（每個 kind 的欠債數只能減少），現在**已經清完**：
  // 表是空的，於是任何一筆沒有文字的 nameRef 都直接是編譯錯誤。
  //
  // 表留著而不是刪掉函式：日後若真的必須帶著一筆新欠債落地（例如內容軌與在地化軌分開發包），
  // 這裡就是唯一的登記處，而且登記完就會被強迫還清——空表本身是最強的狀態，不要為了方便而重開。
  const TEXT_DEBT_RATCHET: Readonly<Record<string, number>> = {};

  const danglingByKind = new Map<string, string[]>();
  for (const key of [...referenced].sort()) {
    if (declared.has(key)) continue;
    const kind = key.split('.')[0] ?? key;
    const bucket = danglingByKind.get(kind);
    if (bucket === undefined) danglingByKind.set(kind, [key]);
    else bucket.push(key);
  }

  for (const [kind, keys] of [...danglingByKind].sort()) {
    const allowed = TEXT_DEBT_RATCHET[kind];
    if (allowed === undefined) {
      errors.push({
        where: 'locale',
        message:
          `${keys.length} 筆 "${kind}" 的 nameRef 沒有對應文字（例：${keys[0]}）。` +
          `新內容必須連同文字一起提供——不得新增沒有名字的定義。`,
      });
      continue;
    }
    if (keys.length > allowed) {
      errors.push({
        where: 'locale',
        message:
          `"${kind}" 缺文字的 nameRef 從 ${allowed} 增加到 ${keys.length} 筆——欠債只能減少。` +
          `新增的例子：${keys[allowed] ?? keys[0]}`,
      });
    } else if (keys.length < allowed) {
      errors.push({
        where: 'locale',
        message:
          `"${kind}" 缺文字的 nameRef 已降到 ${keys.length} 筆（宣告值 ${allowed}）——` +
          `請把 TEXT_DEBT_RATCHET 的 ${kind} 改成 ${keys.length}，讓進度鎖住。`,
      });
    }
  }
  for (const kind of Object.keys(TEXT_DEBT_RATCHET)) {
    if (!danglingByKind.has(kind)) {
      errors.push({
        where: 'locale',
        message: `"${kind}" 已經沒有缺文字的 nameRef——請把它從 TEXT_DEBT_RATCHET 刪掉。`,
      });
    }
  }
  for (const key of [...declared].sort()) {
    if (!referenced.has(key)) {
      errors.push({
        where: 'locale',
        message: `文字 "${key}" 沒有任何 Definition 引用——改名不會生效，或是定義已刪除而文字沒刪`,
      });
    }
  }

  return { files, bundles };
}

// ── 跨定義引用必須解析得到（Wave F1 複核建議）────────────────────────────────
//
// 內容 ID 是 branded string，所以 `tsc` 擋得住**家族錯誤**（把 MasteryId 填進 CurveId 欄位），
// 但擋不住**local 名打錯**：`age-modifier-rule.core.standard` 與真正存在的
// `age-modifier-rule.core.shared` 在型別上完全等價。實測就發生過一次——一筆 lifecycle-rule 指向
// 一個不存在的定義，八個作者、八個複核者裡只有一個人用人工枚舉抓到。
//
// 到了文化 pack，這種引用會有數千筆（裝備→熟練度、技能→熟練度、怪物→技能、遭遇→怪物…），
// 人工比對不可能可靠。這道檢查把它變成編譯期錯誤。
//
// 判準刻意保守，只認「一定是定義引用」的字串：三段式 `<kind>.<culture>.<local>`，
// **而且第一段是已登記的 definition kind**。所以：
//   * `resolver.core.xxx` 不檢查——resolver 是 registry 項目，不是 Definition。
//   * `culture.yunhua` 不檢查——兩段式，是文化自己的 ID 形狀。
//   * 隨手寫的說明文字不會誤中，因為第一段必須剛好是登記過的 kind。
//
// 檢查範圍是**全部 pack 的聯集**：文化 pack 引用 core 的 ID 是正常且必要的。
const DEFINITION_REFERENCE_SHAPE = /^([a-z][a-z0-9-]*)\.([a-z][a-z0-9-]*)\.([a-z0-9][a-z0-9-]*)$/;

function collectReferenceViolations(
  files: readonly Readonly<{ packId: string; domain: string; definitions: readonly Record<string, unknown>[] }>[],
  knownIds: ReadonlySet<string>,
): readonly CompileError[] {
  const out: CompileError[] = [];

  const walk = (
    value: unknown,
    path: string,
    where: string,
    definitionId: string,
  ): void => {
    if (typeof value === 'string') {
      const m = DEFINITION_REFERENCE_SHAPE.exec(value);
      if (m === null) return;
      const kind = m[1];
      if (kind === undefined || !isRegisteredDefinitionKind(kind)) return;
      if (knownIds.has(value)) return;
      out.push({
        where,
        message:
          `id="${definitionId}" 的 ${path} 引用了不存在的定義 "${value}"。` +
          `第一段 "${kind}" 是已登記的 definition kind，所以這是一筆定義引用——` +
          `不是打錯 local 名，就是那筆定義還沒寫。branded string 讓 tsc 看不出這種錯。`,
      });
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item, i) => walk(item, `${path}[${i}]`, where, definitionId));
      return;
    }
    if (value !== null && typeof value === 'object') {
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        // `id` 是這筆定義自己的身分，不是引用。
        if (path === '' && k === 'id') continue;
        walk(v, path === '' ? k : `${path}.${k}`, where, definitionId);
      }
    }
  };

  for (const file of files) {
    for (const def of file.definitions) {
      const id = String(def['id'] ?? '(缺 id)');
      walk(def, '', `${file.packId}/${file.domain}`, id);
    }
  }
  return out;
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
  const compiledDomains: CompiledDomain[] = [];
  for (const pack of manifest.packs) {
    const packFiles = compilePack(pack, errors, compiledDomains);
    files.push(...packFiles);
    definitionCount += pack.domains.reduce((sum, d) => sum + d.definitions.length, 0);
  }

  // 跨定義引用檢查。只有在前面沒有結構性錯誤時才跑——否則會被一堆「因為那筆定義編譯失敗
  // 所以引用不到」的連帶錯誤淹沒，看不出真正的第一因。
  if (errors.length === 0) {
    const knownIds = new Set<string>();
    for (const d of compiledDomains) {
      for (const def of d.definitions) knownIds.add(String(def['id']));
    }
    errors.push(...collectReferenceViolations(compiledDomains, knownIds));
  }

  // 本地化 bundle。與定義引用同樣只在前面沒有結構性錯誤時才跑——否則「因為那筆定義沒編出來
  // 所以 nameRef 收集不到」會製造一堆假的缺字報告。
  const localization =
    errors.length === 0
      ? compileLocalization(manifest, compiledDomains, errors)
      : { files: [], bundles: [] };
  files.push(...localization.files);

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
    // 每個 pack × 每個出貨語系一份 bundle；由 `compileLocalization` 產生並交叉驗證過
    //（每個 nameRef 都有文字、每筆文字都有人引用）。
    localizationBundles: localization.bundles,
  };
  files.push({ path: 'manifest.json', text: serialize(runtimeManifest) });

  if (errors.length > 0) {
    const lines = errors.map((e) => `  ${e.where}: ${e.message}`).join('\n');
    throw new Error(`CONTENT COMPILE FAILED（${errors.length} 筆）：\n${lines}`);
  }

  return { files, definitionCount, packCount: manifest.packs.length };
}
