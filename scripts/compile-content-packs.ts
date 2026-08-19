// scripts/compile-content-packs.ts
// 執行：`npx tsx scripts/compile-content-packs.ts`（或 `npm run content:packs`）
//
// 作者層 `content-source/**` → 正式 Content Pack `content/**`（純 JSON）。
// 產物必須提交進 repo：正式 Runtime 只讀產物，CI 以 `verify:content-packs` 保證產物與作者層同步。

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { compileContentSource } from './lib/content-compiler';
import { AUTHORED_MANIFEST } from '../content-source/packs';

const ROOT = resolve(import.meta.dirname, '..');
const OUT = join(ROOT, 'content');

const result = compileContentSource(AUTHORED_MANIFEST);

for (const file of result.files) {
  const absolute = join(OUT, file.path);
  mkdirSync(dirname(absolute), { recursive: true });
  // 明確寫 utf8 + 已含尾端換行的文本。不用 EOL 轉換：產物是 LF，跨平台一致才比對得起來。
  writeFileSync(absolute, file.text, { encoding: 'utf8' });
  console.log(`written: content/${file.path}`);
}

console.log(
  `CONTENT PACKS COMPILED：${result.packCount} 個 pack、${result.definitionCount} 筆 Definition、${result.files.length} 個檔案`,
);
