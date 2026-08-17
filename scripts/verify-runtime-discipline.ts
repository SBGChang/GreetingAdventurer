// scripts/verify-runtime-discipline.ts
// 正式 Runtime 紀律門禁（規範 §14）。
//
// 這支腳本擋的是**測試抓不到的那一類問題**：測試資料滲進正式路徑、內容 ID 寫死在 Handler、
// 用型別轉換掩蓋契約缺口、以及缺資料時偷偷給預設值。這四類的共同點是它們**不會讓任何測試失敗**——
// 功能照跑、型別照過，要等到換上真內容才會發現行為根本沒變。所以只能靠靜態門禁擋。
//
// 執行：`npx tsx scripts/verify-runtime-discipline.ts`
// 任一檢查失敗即以非零結束碼退出，CI 不得產生正式 Build。
//
// 設計原則：每一筆違規都要能直接動手修——依賴圖違規印出**完整 import 鏈**，其餘印出檔案:行號與原文。
// 只說「有問題」而不說「在哪、怎麼來的」的門禁，會被當成雜訊繞過。

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const SRC = join(ROOT, 'src');

// ──────────────────────────────────────────────────────────────────────────
// 什麼算「測試／Bring-up」——規範 §13 的清單
// ──────────────────────────────────────────────────────────────────────────
//
// 這份判斷刻意以**檔名慣例**為準而不是靠人工標註：慣例可以被工具檢查，標註會忘記加。
// 新增測試專用檔時請沿用這些名稱，否則它會被當成正式檔而繞過本門禁。
const TEST_ONLY_PATTERNS: readonly { pattern: RegExp; why: string }[] = [
  { pattern: /\.test\.ts$/, why: '測試檔' },
  { pattern: /(^|[/\\])fixtures\.ts$/, why: '模組測試 Fixture' },
  { pattern: /fixture[^/\\]*\.ts$/, why: '測試 Fixture' },
  { pattern: /(^|[/\\])testing[/\\]/, why: '測試專用目錄' },
  // 這裡曾經有一筆 `/bootstrap\.ts$/`，把 bring-up bootstrap 以**檔名**排除在四項檢查之外。
  // 那是個陷阱：正式 NewGameBootstrapper 最自然的落點就叫 bootstrap.ts，寫上去的那天它會安靜地
  // 免檢——而 Bootstrap 正是最該受檢的地方（§1.1 要派生屬性、驗內容、排生命週期 Job）。
  // Bring-up 版本已改名並移入 src/testing/，靠**位置**排除；檔名 bootstrap.ts 現在是受檢的。
];

function testOnlyReason(file: string): string | undefined {
  const rel = relative(ROOT, file);
  return TEST_ONLY_PATTERNS.find((p) => p.pattern.test(rel))?.why;
}

// ──────────────────────────────────────────────────────────────────────────
// 正式路徑的根
// ──────────────────────────────────────────────────────────────────────────
//
// 目前還沒有 React／Electron 主程式，所以「正式路徑」以**未來的產品進入點會用到什麼**來定義：
// 引擎 Session、啟動驗證、路由、各模組對外面、內容 adapter、Workflow、kernel、data-runtime。
// 這份清單就是規範 §2 適用範圍的具體化；產品進入點建立後應改由它單一為根。
const PRODUCTION_ROOTS: readonly string[] = [
  'src/app/composition/session.ts',
  'src/app/composition/registry.ts',
  'src/app/composition/router.ts',
  'src/app/composition/manifest.ts',
  'src/app/composition/messages.ts',
  'src/app/composition/state.ts',
  'src/modules/character/public.ts',
  'src/modules/inventory/public.ts',
  'src/modules/progression/public.ts',
  'src/modules/map/public.ts',
  'src/modules/dungeon/public.ts',
  'src/modules/combat/public.ts',
  'src/modules/team/public.ts',
  'src/app/workflows/player-travel-event.ts',
  'src/app/workflows/weapon-set-configuration.ts',
  'src/kernel/index.ts',
  'src/data-runtime/index.ts',
];

// ──────────────────────────────────────────────────────────────────────────
// 工具
// ──────────────────────────────────────────────────────────────────────────

function walkFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walkFiles(full, out);
    else if (entry.endsWith('.ts')) out.push(full);
  }
  return out;
}

// 只取相對 import：套件 import 不在本門禁範圍（node_modules 不會是測試 fixture）。
const IMPORT_RE = /(?:from|import)\s*\(?\s*['"](\.[^'"]+)['"]/g;

// 註解裡出現 `import './fixtures'` 這種**說明文字**很常見（例如告訴讀者測試該從哪裡 import），
// 不先去掉註解就會把它當成真的 import——本門禁自己第一次跑就踩到了這個誤判。
// 會誤傷字串常值裡的 `//`（例如 URL），但本檔只用來抓 import 與樣式，那個代價可以接受。
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[^\n]*?\/\/[^\n]*$/gm, (line) => {
    const idx = line.indexOf('//');
    return line.slice(0, idx);
  });
}

function importsOf(file: string): string[] {
  const source = stripComments(readFileSync(file, 'utf8'));
  const specs: string[] = [];
  for (const m of source.matchAll(IMPORT_RE)) specs.push(m[1]!);
  return specs;
}

function resolveImport(fromFile: string, spec: string): string | undefined {
  const base = resolve(dirname(fromFile), spec);
  for (const candidate of [`${base}.ts`, join(base, 'index.ts')]) {
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      // 解析不到就換下一個候選；不是本門禁要報的問題（tsc 會抓）。
    }
  }
  return undefined;
}

type Failure = Readonly<{ check: string; detail: string }>;

// ──────────────────────────────────────────────────────────────────────────
// 豁免機制（§14）
// ──────────────────────────────────────────────────────────────────────────
//
// 為什麼豁免必須帶理由：門禁清零最省力的路徑永遠是灑一排註解，而那正是規範點名的
// 「用 TODO 註解把未完成行為合理化」。要求理由把「順手繞過」變成「寫得出來才准過」，
// 而理由寫不出來的那一刻，通常就是發現它其實是真違規的那一刻。
//
// 為什麼還要 ratchet：單靠「有理由」擋不住理由愈寫愈廉價。總數只能往下，等同宣告
// 豁免是**債**不是設計選項——與 `check-contract-duplicates.ts` 的基準線同一個道理。
//
// 格式：`runtime-discipline-allow: <理由>`，寫在**該行或其上一行**。允許上一行是因為一個講得清楚的
// 理由通常比程式碼本身長，硬擠同一行只會逼人把理由縮短成「這樣沒問題」——那就退回沒有理由的狀態了。
const ALLOW_RE = /runtime-discipline-allow:[ \t]*(\S[^\n]*?)[ \t]*$/;
const ALLOW_MARKER = 'runtime-discipline-allow';

// 豁免總數基準線。**只能往下改。**調降時一併更新這行的日期與 commit，
// 讓後來的人看得出它確實在收斂而不是被人偷偷調上去。
// 6 筆的組成（2026-08-17 清零時定案）：
//   combat/system.ts ×3   —— addToRecord / addToMap / addToRecordCapped 的累加起點。
//                            這三個工具的存在目的就是把原本散在八個呼叫點的 `?? 0` 收成三處。
//   kernel/transaction.ts —— 沒有 notifications 陣列＝零則通知（kernel 記帳）。
//   progression/queries.ts —— 沒練過＝Lv.0；Mastery Lv.0～10 是規範明列的結構不變量。
//   data-runtime/content-pack.ts —— 壞資料的診斷標籤，不是內容值。
const EXEMPTION_BASELINE = 6; // 2026-08-17 起算

function allowanceReason(line: string): string | undefined {
  return ALLOW_RE.exec(line)?.[1];
}

/** 第 index 行是否被豁免：該行或上一行帶著附理由的標記。 */
function isExempt(lines: readonly string[], index: number): boolean {
  if (allowanceReason(lines[index] ?? '') !== undefined) return true;
  return index > 0 && allowanceReason(lines[index - 1] ?? '') !== undefined;
}

/** 帶標記卻沒寫理由 = 沒有豁免。原本的違規照樣會報，這裡再多報一筆格式錯誤。 */
function checkAllowancesHaveReasons(productionFiles: readonly string[]): Failure[] {
  const failures: Failure[] = [];
  for (const file of productionFiles) {
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (!line.includes(ALLOW_MARKER)) return;
      if (allowanceReason(line) !== undefined) return;
      failures.push({
        check: 'allowance-without-reason',
        detail:
          `${relative(ROOT, file).replace(/\\/g, '/')}:${i + 1} 豁免沒有理由\n` +
          `        ${line.trim()}\n` +
          `        格式須為 \`${ALLOW_MARKER}: <理由>\`——說明它為什麼不是暫代行為`,
      });
    });
  }
  return failures;
}

function countExemptions(productionFiles: readonly string[]): number {
  let count = 0;
  for (const file of productionFiles) {
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      if (allowanceReason(line) !== undefined) count += 1;
    }
  }
  return count;
}

function checkExemptionRatchet(productionFiles: readonly string[]): Failure[] {
  const actual = countExemptions(productionFiles);
  if (actual <= EXEMPTION_BASELINE) return [];
  return [
    {
      check: 'exemption-ratchet',
      detail:
        `豁免數 ${actual} > 基準線 ${EXEMPTION_BASELINE}\n` +
        `        新增豁免前請先確認它不是真違規；確定要留就連同理由一起把基準線調高，\n` +
        `        並在 commit message 說明為什麼這筆債值得欠。`,
    },
  ];
}

// ──────────────────────────────────────────────────────────────────────────
// 檢查 1：正式依賴圖不得含測試／Bring-up（§13）
// ──────────────────────────────────────────────────────────────────────────
//
// 為什麼要走**傳遞**依賴而不是只看直接 import：`public.ts` 對外再匯出 fixtures 時，正式檔案看起來
// 只是 import 了 `public.ts`，很正常；但 fixture 已經在正式依賴圖裡了。規範 §13 的判準是
// 「只要正式程式**可以**引用」，不是「有沒有真的用到」。
function checkProductionDependencyGraph(): Failure[] {
  const failures: Failure[] = [];
  // 記錄抵達每個檔案的路徑，讓違規能印出完整 import 鏈。
  const cameFrom = new Map<string, string | undefined>();
  const queue: string[] = [];

  for (const rel of PRODUCTION_ROOTS) {
    const full = join(ROOT, rel);
    try {
      statSync(full);
    } catch {
      failures.push({
        check: 'production-graph',
        detail: `PRODUCTION_ROOTS 列出的 "${rel}" 不存在——根清單過期了，請更新本腳本`,
      });
      continue;
    }
    if (!cameFrom.has(full)) {
      cameFrom.set(full, undefined);
      queue.push(full);
    }
  }

  const chainOf = (file: string): string => {
    const chain: string[] = [];
    let cur: string | undefined = file;
    while (cur !== undefined) {
      chain.unshift(relative(ROOT, cur).replace(/\\/g, '/'));
      cur = cameFrom.get(cur);
    }
    return chain.join('\n        → ');
  };

  while (queue.length > 0) {
    const file = queue.shift()!;
    const reason = testOnlyReason(file);
    // 根本身若是測試檔，代表根清單寫錯；非根則是真正的違規。
    if (reason !== undefined && cameFrom.get(file) !== undefined) {
      failures.push({
        check: 'production-graph',
        detail: `正式依賴圖含${reason}：\n        ${chainOf(file)}`,
      });
      continue; // 不再往下走，避免同一個 fixture 的下游噴出一堆重複訊息
    }
    for (const spec of importsOf(file)) {
      const target = resolveImport(file, spec);
      if (target === undefined || cameFrom.has(target)) continue;
      cameFrom.set(target, file);
      queue.push(target);
    }
  }
  return failures;
}

// ──────────────────────────────────────────────────────────────────────────
// 檢查 2：正式路徑不得寫死內容 ID（§5）
// ──────────────────────────────────────────────────────────────────────────
//
// 判斷依據是專案的 ID 命名慣例：`definition:` / `runtime:` / `template-local:` / `resolver:` 前綴。
// 內容 ID 必須來自 Definition、Command 或 Query，寫在 Handler 裡代表換 Pack 不會變。
//
// **本檢查刻意不支援豁免。** §7／§6 有語法上分不出來的合法情形（去品牌、計數起點），所以需要
// 明示豁免；§5 沒有——規範的五個合法出口裡沒有「把 ID 寫在 Handler 裡並附上理由」這一項。
// 留了豁免路徑，`resolver:dungeon-default` 這種佔位就會用一行註解「修掉」而不是補契約。
// ID 的形狀是「前綴 + 冒號分隔的 kebab／英數片段」，不含空白或中日韓文字。若不限制形狀，
// 以 `resolver:` 開頭的**錯誤訊息**也會被當成 ID（本門禁第一次跑就誤判了一筆）。
const CONTENT_ID_RE = /'((?:definition|runtime|template-local|resolver):[A-Za-z0-9._-]+(?::[A-Za-z0-9._-]+)*)'/g;

function checkNoHardcodedContentIds(productionFiles: readonly string[]): Failure[] {
  const failures: Failure[] = [];
  for (const file of productionFiles) {
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      // 註解與說明文字裡出現 ID 是合理的（用於解釋），只看實際程式碼。
      const code = line.replace(/\/\/.*$/, '');
      for (const m of code.matchAll(CONTENT_ID_RE)) {
        failures.push({
          check: 'hardcoded-content-id',
          detail: `${relative(ROOT, file).replace(/\\/g, '/')}:${i + 1} 寫死內容 ID '${m[1]}'\n        ${line.trim()}`,
        });
      }
    });
  }
  return failures;
}

// ──────────────────────────────────────────────────────────────────────────
// 檢查 3：正式路徑不得用 `as unknown as` 跨語意轉型（§7）
// ──────────────────────────────────────────────────────────────────────────
//
// `as unknown as` 幾乎總是在說「這兩個型別其實對不起來，但我需要它過」。真正缺的是契約——
// 對照表、欄位、或 Reader getter。這裡不區分「無害的去品牌」與「危險的跨語意」，因為兩者從語法
// 上分不出來；要保留就必須在同一行寫 `runtime-discipline-allow` 並說明理由，讓它變成一個**明示的
// 決定**而不是順手寫下的東西。
function checkNoCrossSemanticCasts(productionFiles: readonly string[]): Failure[] {
  const failures: Failure[] = [];
  for (const file of productionFiles) {
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      const code = line.replace(/\/\/.*$/, '');
      if (!code.includes('as unknown as')) return;
      if (isExempt(lines, i)) return;
      failures.push({
        check: 'cross-semantic-cast',
        detail: `${relative(ROOT, file).replace(/\\/g, '/')}:${i + 1} 使用 as unknown as（缺契約？）\n        ${line.trim()}`,
      });
    });
  }
  return failures;
}

// ──────────────────────────────────────────────────────────────────────────
// 檢查 4：正式路徑不得對玩法數值給預設（§6）
// ──────────────────────────────────────────────────────────────────────────
//
// `?? 5`、`?? 1`、`?? 'female'` 這類寫法把「缺資料」變成「有一個看起來合理的值」，是規範點名的
// 方便性 fallback。從語法分不出「計數從 0 起」與「傷害預設 0」，所以純量一律要明示豁免。
const SCALAR_FALLBACK_RE = /\?\?\s*(-?\d+(?:\.\d+)?|'[^']*'|"[^"]*")/g;

// 空集合預設（`?? []`、`?? {}`）另計，理由見下方 checkEmptyCollectionRatchet。
const EMPTY_COLLECTION_FALLBACK_RE = /\?\?\s*(\[\s*\]|\{\s*\})/g;

function checkNoValueFallbacks(productionFiles: readonly string[]): Failure[] {
  const failures: Failure[] = [];
  for (const file of productionFiles) {
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      const code = line.replace(/\/\/.*$/, '');
      if (isExempt(lines, i)) return;
      for (const m of code.matchAll(SCALAR_FALLBACK_RE)) {
        failures.push({
          check: 'value-fallback',
          detail: `${relative(ROOT, file).replace(/\\/g, '/')}:${i + 1} 對缺值給了預設 \`?? ${m[1]}\`\n        ${line.trim()}`,
        });
      }
    });
  }
  return failures;
}

// ──────────────────────────────────────────────────────────────────────────
// 檢查 5：空集合預設的 ratchet（§6 附註）
// ──────────────────────────────────────────────────────────────────────────
//
// 為什麼跟純量分開算，而不是同一份豁免帳：
//
// 建立本檢查時逐筆看過當時全部 31 筆，**沒有一筆是從內容讀出來的**。全是兩種形狀——選填建構參數
// （`createTeamState({ teams?: Team[] })` 的 `input.teams ?? []`）與查無此鍵的集合（`edges.get(n) ?? []`、
// `state.recentActivities[id] ?? []`）。這兩種的「空」是集合的單位元，不是替代缺失內容的假值：沒有任何
// Content Pack 會讓「未指定的隊伍」變成三支預設隊伍。
//
// 但真正該擋的形狀是存在的——`skillView.effects ?? []` 會把壞掉的內容引用變成「這個技能沒有效果」。
// 它跟上面那 31 筆語法完全相同。所以檢查留著，只是換成計數式 ratchet（同 check-contract-duplicates
// 的 9 筆基準線）：既有的不必逐筆寫幾乎一樣的理由去淹掉純量那 6 筆真債，新增的一律讓建置失敗、逼人看一眼。
//
// 基準線只能往下。要新增就先問自己：左邊那個東西是內容嗎？
const EMPTY_COLLECTION_BASELINE = 31; // 2026-08-17 起算

function collectEmptyCollectionFallbacks(productionFiles: readonly string[]): string[] {
  const found: string[] = [];
  for (const file of productionFiles) {
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      const code = line.replace(/\/\/.*$/, '');
      if (isExempt(lines, i)) return;
      for (const _ of code.matchAll(EMPTY_COLLECTION_FALLBACK_RE)) {
        found.push(`${relative(ROOT, file).replace(/\\/g, '/')}:${i + 1}\n        ${line.trim()}`);
      }
    });
  }
  return found;
}

function checkEmptyCollectionRatchet(productionFiles: readonly string[]): Failure[] {
  const found = collectEmptyCollectionFallbacks(productionFiles);
  if (found.length <= EMPTY_COLLECTION_BASELINE) return [];
  return [
    {
      check: 'empty-collection-ratchet',
      detail:
        `空集合預設 ${found.length} 筆 > 基準線 ${EMPTY_COLLECTION_BASELINE}\n` +
        `        新增的那筆左邊是內容嗎？是就補契約，不是就連同理由把基準線調高。全部位置：\n        ` +
        found.join('\n        '),
    },
  ];
}

// ──────────────────────────────────────────────────────────────────────────
// 主程序
// ──────────────────────────────────────────────────────────────────────────

// 檢查 2～4 的對象：src 底下所有**非**測試／Bring-up 的檔案。
// 用「全部非測試檔」而不是「依賴圖可達的檔案」，是為了讓還沒被任何根引用到的正式檔也受檢——
// 否則新寫的 Handler 在接上路由之前是免檢的，那正是最容易寫進暫代行為的時候。
const productionFiles = walkFiles(SRC).filter((f) => testOnlyReason(f) === undefined);

const checks: readonly { name: string; run: () => Failure[] }[] = [
  { name: '正式依賴圖不含測試／Bring-up（§13）', run: checkProductionDependencyGraph },
  { name: '無硬編碼內容 ID（§5）', run: () => checkNoHardcodedContentIds(productionFiles) },
  { name: '無跨語意強制轉型（§7）', run: () => checkNoCrossSemanticCasts(productionFiles) },
  { name: '無玩法數值 fallback（§6）', run: () => checkNoValueFallbacks(productionFiles) },
  { name: '空集合預設未超過基準線（§6 附註）', run: () => checkEmptyCollectionRatchet(productionFiles) },
  { name: '豁免皆附理由（§14）', run: () => checkAllowancesHaveReasons(productionFiles) },
  { name: '豁免數未超過基準線（§14）', run: () => checkExemptionRatchet(productionFiles) },
];

let total = 0;
for (const check of checks) {
  const failures = check.run();
  total += failures.length;
  if (failures.length === 0) {
    console.log(`✓ ${check.name}`);
    continue;
  }
  console.log(`✗ ${check.name}：${failures.length} 筆`);
  for (const f of failures) console.log(`    - ${f.detail}`);
}

console.log('');
console.log(`受檢正式檔案：${productionFiles.length}`);
console.log(`豁免：${countExemptions(productionFiles)} / 基準線 ${EXEMPTION_BASELINE}`);
console.log(
  `空集合預設：${collectEmptyCollectionFallbacks(productionFiles).length} / 基準線 ${EMPTY_COLLECTION_BASELINE}`,
);
if (total > 0) {
  console.log(`RUNTIME DISCIPLINE FAILED：共 ${total} 筆違規`);
  process.exit(1);
}
console.log('RUNTIME DISCIPLINE PASSED');
