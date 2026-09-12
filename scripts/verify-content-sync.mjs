// HTML 同步：預設檢查工作樹；--ref=<commit> 可稽核指定提交。
// 在暫存目錄重建後比對，從不覆蓋原始工作檔。

import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const CULTURES = ['yunhua', 'vildun', 'aurelien', 'safir'];

function arg(name) {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return hit === undefined ? undefined : hit.slice(name.length + 3);
}

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 1 << 28 });
}

const ref = arg('ref');
const work = mkdtempSync(join(tmpdir(), 'ga-content-sync-'));
let failures = 0;

try {
  if (ref !== undefined) {
    git(ROOT, 'worktree', 'add', '--detach', '--quiet', work, ref);
  } else {
    cpSync(join(ROOT, 'docs', '03_content'), join(work, 'docs', '03_content'), { recursive: true });
    for (const culture of CULTURES) {
      cpSync(join(ROOT, `build_${culture}_content_html.mjs`), join(work, `build_${culture}_content_html.mjs`));
    }
  }

  for (const culture of CULTURES) {
    const builder = `build_${culture}_content_html.mjs`;
    const relPath = `docs/03_content/${culture}/${culture}_content.html`;

    // Builder 自帶內容驗證：非零結束碼代表資料本身不合規，那也是同步門禁該擋的。
    try {
      execFileSync('node', [builder], { cwd: work, encoding: 'utf8', maxBuffer: 1 << 28 });
    } catch (err) {
      failures += 1;
      const out = err && typeof err === 'object' && 'stdout' in err ? String(err.stdout ?? '') : '';
      const errOut = err && typeof err === 'object' && 'stderr' in err ? String(err.stderr ?? '') : '';
      console.log(`✗ ${culture}：Builder 失敗（資料未通過內容驗證）`);
      for (const line of `${out}${errOut}`.split('\n').filter((l) => l.trim().length > 0).slice(-8)) {
        console.log(`    ${line}`);
      }
      continue;
    }

    // 以 byte 比對，避開任何字串編碼與換行的干擾。
    const rebuilt = readFileSync(join(work, relPath));
    const committed = ref === undefined ? readFileSync(join(ROOT, relPath)) : execFileSync('git', ['show', `${ref}:${relPath}`], {
      cwd: ROOT,
      maxBuffer: 1 << 28,
    });

    if (rebuilt.equals(committed)) {
      console.log(`✓ ${culture}`);
      continue;
    }

    failures += 1;
    const a = committed.toString('utf8').split('\n');
    const b = rebuilt.toString('utf8').split('\n');
    console.log(`✗ ${culture}：committed 的 HTML 與資料重建結果不一致`);
    for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
      const x = a[i] ?? '';
      const y = b[i] ?? '';
      if (x === y) continue;
      let j = 0;
      while (j < Math.min(x.length, y.length) && x[j] === y[j]) j += 1;
      const from = Math.max(0, j - 40);
      console.log(`    第 ${i + 1} 行、第 ${j} 字元起：`);
      console.log(`      committed: …${x.slice(from, j + 50)}`);
      console.log(`      重建結果  : …${y.slice(from, j + 50)}`);
      break;
    }
    console.log(`    修法：node ${builder} 後提交產物。`);
  }
} finally {
  try {
    if (ref !== undefined) git(ROOT, 'worktree', 'remove', '--force', work);
    else rmSync(work, { recursive: true, force: true });
  } catch {
    rmSync(work, { recursive: true, force: true });
  }
}

console.log('');
if (failures > 0) {
  console.log(`CONTENT SYNC FAILED：${failures} / ${CULTURES.length} 國產物與資料不同步`);
  process.exit(1);
}
console.log('CONTENT SYNC PASSED');
