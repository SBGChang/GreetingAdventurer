// scripts/report-content-coverage.ts
// 內容覆蓋率報告：**已登記的 Definition kind** vs **正式 Content Pack 裡真的有資料的 kind**。
//
// 執行：`npx tsx scripts/report-content-coverage.ts`（或 `npm run report:content`）
//
// 為什麼需要它：`verify:content-packs` 只保證「產物與作者層同步、而且載得進來」——一份只有
// 36 筆定義的 pack 同樣會全綠。它答不出「這個遊戲的內容做了幾成」。
// 這支報告答那一題，而且刻意**不阻擋建置**：內容缺口是待做的工作，不是已完成程式碼的偷工。
//
// 判準：一個 kind 有登記（程式讀得懂它）卻**零資料**，代表引擎有那個能力但遊戲沒有那個內容。
// 那正是「企畫寫了、資料沒有」的可量化形式。

import {
  ALL_DEFINITION_KINDS,
  definitionKindOwner,
} from '../src/app/content/definition-kinds';
import { loadContentFromDisk } from '../src/platform/content-repository';

const loaded = loadContentFromDisk('content');
if (!loaded.success) {
  console.error('CONTENT LOAD FAILED：');
  for (const d of loaded.diagnostics) {
    console.error(`  [${d.code}] ${d.filePath} ${d.messageKey} ${JSON.stringify(d.details ?? {})}`);
  }
  process.exit(1);
}

const definitions = loaded.registry.list({ includeDisabled: true });

const countByKind = new Map<string, number>();
for (const def of definitions) {
  countByKind.set(def.kind, (countByKind.get(def.kind) ?? 0) + 1);
}

// 依擁有模組分組，讓「哪個模組整片沒有內容」一眼看得出來。
const byOwner = new Map<string, { kind: string; count: number }[]>();
for (const kind of ALL_DEFINITION_KINDS) {
  const owner = String(definitionKindOwner(kind) ?? '(未登記擁有者)');
  const row = { kind, count: countByKind.get(kind) ?? 0 };
  const list = byOwner.get(owner);
  if (list === undefined) byOwner.set(owner, [row]);
  else list.push(row);
}

const packs = loaded.registry.getManifestIdentity().packs;
console.log('內容覆蓋率報告');
console.log('='.repeat(64));
console.log(`Content Pack：${packs.length} 個（${packs.map((p) => String(p.packId)).join(', ')}）`);
console.log(`Definition 總數：${definitions.length}`);
console.log('');

let withData = 0;
let withoutData = 0;

for (const owner of [...byOwner.keys()].sort()) {
  const rows = byOwner.get(owner) ?? [];
  const have = rows.filter((r) => r.count > 0);
  const missing = rows.filter((r) => r.count === 0);
  withData += have.length;
  withoutData += missing.length;

  const status = have.length === 0 ? '整片無內容' : `${have.length}/${rows.length}`;
  console.log(`── ${owner}（${status}）`);
  for (const r of have) console.log(`   ✓ ${r.kind}：${r.count} 筆`);
  if (missing.length > 0) console.log(`   ✗ 零資料：${missing.map((r) => r.kind).join(', ')}`);
  console.log('');
}

const total = withData + withoutData;
const pct = total === 0 ? 0 : Math.round((withData / total) * 100);
console.log('='.repeat(64));
console.log(`有資料的 kind：${withData} / ${total}（${pct}%）`);
console.log(`零資料的 kind：${withoutData}`);
console.log('');
console.log('這個數字不阻擋建置。它衡量的是「引擎讀得懂的內容種類，遊戲實際做了幾種」——');
console.log('零資料的 kind 代表程式有那個能力、但玩不到那部分遊戲。');
