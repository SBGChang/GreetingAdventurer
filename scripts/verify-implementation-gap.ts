// scripts/verify-implementation-gap.ts
// 實作缺口報告：正式路徑裡「作者自己標記為未完成」的地方還有多少。
//
// 這支與 verify-runtime-discipline 量的是**不同的東西**，所以刻意分開：
//
//   紀律門禁（阻擋）：已經寫下來的程式，寫得對不對。可以要求隨時為真，因此進 CI。
//   缺口報告（不阻擋）：還有多少沒寫。建立當日 101 筆——地牢事件選項、NPC 戰鬥、控制抗性、
//                       Distribution 模組……那是這個專案剩下的開發工作本身。
//
// 混在一起會有兩個後果：CI 在遊戲完成前永遠是紅的（而永遠紅的門禁只會被繞過），
// 以及「紀律綠燈」失去意義——它應該代表「已完成的部分沒有偷工」，不是「遊戲做完了」。
//
// 缺口清到 0 的那天，把 checkNoUnfinishedMarkers 移進 verify-runtime-discipline 的 checks 陣列，
// 這支腳本就可以刪掉。在那之前，這個數字只能往下——它是專案進度最誠實的一個指標。
//
// 執行：npm run verify:gap

import { checkNoUnfinishedMarkers, productionFiles } from './verify-runtime-discipline';

const failures = checkNoUnfinishedMarkers(productionFiles);

const byFile = new Map<string, number>();
for (const f of failures) {
  const file = f.detail.split(':')[0] ?? '?';
  byFile.set(file, (byFile.get(file) ?? 0) + 1);
}

for (const f of failures) console.log(`  - ${f.detail}`);

console.log('');
console.log('── 依檔案 ──');
for (const [file, n] of [...byFile].sort((a, b) => b[1] - a[1])) {
  console.log(`${String(n).padStart(4)}  ${file}`);
}
console.log('');
console.log(`實作缺口：${failures.length} 筆（受檢正式檔案 ${productionFiles.length}）`);
console.log('這個數字不阻擋建置，但只能往下。清到 0 就把該檢查移進紀律門禁。');
