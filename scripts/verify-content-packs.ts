// scripts/verify-content-packs.ts
// 執行：`npx tsx scripts/verify-content-packs.ts`（或 `npm run verify:content-packs`）
//
// 兩道檢查：
//   1. **同步**：`content/**` 的產物必須等於「用目前的 `content-source/**` 重新編譯的結果」。
//      這道門禁與 `verify:content-sync`（閱讀頁 HTML vs 設計資料）是同一個形狀：手改產物、
//      或改了作者層忘記重編，都會讓正式 Runtime 讀到與作者意圖不同的內容，而且不會有任何測試失敗。
//   2. **可載入**：產物必須真的能被 Platform Port 讀進來並通過 `loadContent`
//      （loadOrder 完整、無循環相依、無重複 ID、header 齊全）。
//      「編得出來」不等於「載得進去」——ID 跨 pack 重複只有載入器看得到。

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { compileContentSource } from './lib/content-compiler';
import { AUTHORED_MANIFEST } from '../content-source/packs';
import { loadContentFromDisk } from '../src/platform/content-repository';

const ROOT = resolve(import.meta.dirname, '..');
const OUT = join(ROOT, 'content');

const result = compileContentSource(AUTHORED_MANIFEST);

const problems: string[] = [];

for (const file of result.files) {
  const absolute = join(OUT, file.path);
  if (!existsSync(absolute)) {
    problems.push(`缺少產物 content/${file.path}　修法：npm run content:packs 後提交產物。`);
    continue;
  }
  const committed = readFileSync(absolute, 'utf8');
  if (committed === file.text) continue;

  // 指出第一個差異點，而不是只說「不一致」——不然還得自己 diff 一份 30k 字元的 JSON。
  let at = 0;
  while (at < committed.length && at < file.text.length && committed[at] === file.text[at]) at += 1;
  const window = 90;
  const from = Math.max(0, at - 30);
  problems.push(
    `content/${file.path} 與作者層不同步（第 ${at} 字元起）\n` +
      `    committed: …${committed.slice(from, from + window)}\n` +
      `    重建結果  : …${file.text.slice(from, from + window)}\n` +
      `    修法：npm run content:packs 後提交產物。`,
  );
}

if (problems.length > 0) {
  console.error(`CONTENT PACK SYNC FAILED（${problems.length} 筆）：`);
  for (const p of problems) console.error(`  ✗ ${p}`);
  process.exit(1);
}

// 產物同步了，再證明它載得進去。
const loaded = loadContentFromDisk(OUT);
if (!loaded.success) {
  console.error(`CONTENT PACK LOAD FAILED（${loaded.diagnostics.length} 筆 diagnostic）：`);
  for (const d of loaded.diagnostics) {
    console.error(`  ✗ [${d.code}] ${d.filePath}${d.definitionId === undefined ? '' : ` #${d.definitionId}`}`);
    console.error(`      ${d.messageKey} ${JSON.stringify(d.details ?? {})}`);
  }
  process.exit(1);
}

console.log(
  `CONTENT PACKS OK：${result.files.length} 個產物同步、載入 ${loaded.registry.size} 筆 Definition` +
    `（${loaded.report.packCount} 個 pack${loaded.report.warnings.length > 0 ? `、${loaded.report.warnings.length} 筆 warning` : ''}）`,
);
