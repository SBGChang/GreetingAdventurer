// scripts/verify-content-scope.mjs
// 工作範圍門禁：一項工作只能修改它宣告的 scope 允許的路徑。
//
// 這支腳本擋的東西，跟 verify-runtime-discipline 擋的完全不同。後者看**檔案內容**，這支看
// **哪些檔案被動過**。文化內容工作順手改掉 Builder 或 Shared Factory，內容照樣驗證通過、
// 型別照樣過、測試照樣綠——因為那個改動本身可能完全正確。錯的是它把一國的內容需求變成了
// 四國共用的行為改動，而沒有人在審那件事。
//
// 執行：
//   node scripts/verify-content-scope.mjs --scope=culture:yunhua --range=origin/main..HEAD
//   node scripts/verify-content-scope.mjs                       # scope 由分支名推斷，range 預設 origin/main..HEAD
//
// scope 決定順序：--scope 參數 → CONTENT_SCOPE 環境變數 → 分支名稱 content/<culture>/… → 設定檔 default。

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const CONFIG_PATH = join(HERE, 'content-scope.json');

// ──────────────────────────────────────────────────────────────────────────
// 參數
// ──────────────────────────────────────────────────────────────────────────

function arg(name) {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return hit === undefined ? undefined : hit.slice(name.length + 3);
}

function git(...args) {
  // -c core.quotepath=false：否則 git 會把非 ASCII 路徑加引號並八進位轉義，glob 永遠對不上。
    return execFileSync('git', ['-c', 'core.quotepath=false', '-c', 'core.safecrlf=false', ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 1 << 28,
  }).trim();
}

function currentBranch() {
  try {
    return git('rev-parse', '--abbrev-ref', 'HEAD');
  } catch {
    return '';
  }
}

// content/<culture>/… → culture:<culture>。分支名是**看得見**的宣告，比註解可靠。
function scopeFromBranch(branch, scopes) {
  const m = /^content\/([^/]+)\//.exec(branch);
  if (m === null) return undefined;
  const candidate = `culture:${m[1]}`;
  return candidate in scopes ? candidate : undefined;
}

// ──────────────────────────────────────────────────────────────────────────
// glob（只支援 ** 與 *，夠用且不需要相依套件）
// ──────────────────────────────────────────────────────────────────────────

function globToRegExp(glob) {
  let out = '^';
  for (let i = 0; i < glob.length; i += 1) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        // `**/` 吃掉任意層目錄（含零層）；結尾的 `**` 吃掉剩下全部。
        if (glob[i + 2] === '/') {
          out += '(?:[^/]+/)*';
          i += 2;
        } else {
          out += '.*';
          i += 1;
        }
      } else {
        out += '[^/]*';
      }
      continue;
    }
    out += /[a-zA-Z0-9/_-]/.test(c) ? c : `\\${c}`;
  }
  return new RegExp(`${out}$`);
}

function matchesAny(path, globs) {
  return globs.some((g) => globToRegExp(g).test(path));
}

// ──────────────────────────────────────────────────────────────────────────
// 主程序
// ──────────────────────────────────────────────────────────────────────────

const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
const scopes = config.scopes;

const branch = currentBranch();
const scopeName =
  arg('scope') ??
  process.env.CONTENT_SCOPE ??
  scopeFromBranch(branch, scopes) ??
  config.default;

const scope = scopes[scopeName];
if (scope === undefined) {
  console.error(`未知的 scope "${scopeName}"。可用：${Object.keys(scopes).join(', ')}`);
  process.exit(2);
}

// 本機預設檢查工作樹；CI 指定 PR／push 的提交範圍。
const range = arg('range') ?? process.env.CONTENT_SCOPE_RANGE;

let changed;
try {
  changed = range === undefined
    ? [...new Set([...git('diff', '--name-only', 'HEAD').split('\n'), ...git('ls-files', '--others', '--exclude-standard').split('\n')])].filter(Boolean)
    : git('diff', '--name-only', range).split('\n').filter(Boolean);
} catch (err) {
  console.error(`無法取得 git diff（range="${range}"）：${err instanceof Error ? err.message : err}`);
  console.error('CI 請確保有抓到比較基準（actions/checkout 需要 fetch-depth: 0）。');
  process.exit(2);
}

console.log(`scope：${scopeName}（${scope.why}）`);
console.log(`比較範圍：${range ?? '工作樹（含未追蹤檔案）'}`);
console.log(`變更檔案：${changed.length} 筆`);

// Engine documentation maintenance may fix comments in shared rendering code, but may not alter its executable output.
function sharedCommentOnly(file) {
  if (!['engine','world-atlas'].includes(scopeName) || !file.startsWith('docs/03_content/shared/') || !file.endsWith('.mjs')) return false;
  try {
    const refs = range?.split('..');
    if (refs !== undefined && (refs.length !== 2 || !refs[0] || !refs[1] || refs[1].startsWith('.'))) return false;
    const before = git('show', `${refs?.[0] ?? 'HEAD'}:${file}`);
    const after = refs === undefined ? readFileSync(join(ROOT, file), 'utf8') : git('show', `${refs[1]}:${file}`);
    const compile = source => ts.transpileModule(source, {
      fileName: file, compilerOptions: { allowJs: true, removeComments: true, target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext },
    }).outputText;
    return compile(before) === compile(after);
  } catch { return false; }
}
const violations = changed.filter((f) => !matchesAny(f, scope.allow) && !sharedCommentOnly(f));

if (violations.length === 0) {
  console.log('');
  console.log('CONTENT SCOPE PASSED');
  process.exit(0);
}

console.log('');
console.log(`✗ 超出 scope 允許範圍：${violations.length} 筆`);
for (const v of violations) console.log(`    - ${v}`);
console.log('');
console.log(`scope "${scopeName}" 只允許：`);
for (const a of scope.allow) console.log(`    ${a}`);
console.log('');
console.log('這些改動屬於別的 scope。要嘛拆成獨立的工作，要嘛改用正確的 scope 送審——');
console.log('不要把共用檔的改動夾帶在單一文化的內容工作裡。');
console.log('CONTENT SCOPE FAILED');
process.exit(1);
