// Runs every implemented module's pure unit tests + the composition startup validation.
// `npx tsx scripts/verify-modules.ts`
import { runTests as character } from '../src/modules/character/character.test';
import { runTests as inventory } from '../src/modules/inventory/inventory.test';
import { runTests as progression, allTestsPass as progressionPass } from '../src/modules/progression/system.test';
import { runTests as map } from '../src/modules/map/map.test';
import { runTests as dungeon } from '../src/modules/dungeon/dungeon.test';
import { runTests as combat } from '../src/modules/combat/combat.test';
import { runTests as team } from '../src/modules/team/team.test';
import { runTests as composition } from '../src/app/composition/composition.test';
import { runTests as transactionWiring } from '../src/app/composition/transaction.test';
import { runTests as engineSession } from '../src/app/composition/session.test';
import { runTests as dungeonReader } from '../src/app/content/dungeon-reader.test';
import { runTests as moduleReaders } from '../src/app/content/readers.test';
import { runTests as resolvers } from '../src/app/content/resolvers.test';
// 地基層測試自 Wave A 起就存在，但從未被這支腳本跑過。
import { runKernelTests } from '../src/kernel/kernel.test';
import { runKernelTests as dataKernels, allKernelTestsPass } from '../src/data-runtime/kernels.test';
// 契約重複宣告的 ratchet：不准再長出新的影子型別。
import { runTests as contractDuplicates, remainingDuplicateCount } from './check-contract-duplicates';

// These throw on any failing case.
const throwing: ReadonlyArray<readonly [string, () => void]> = [
  ['contract-duplicates (ratchet)', contractDuplicates],
  ['kernel', () => void runKernelTests()],
  [
    'data-runtime kernels',
    () => {
      dataKernels();
      if (!allKernelTestsPass()) throw new Error('data-runtime kernel tests failed');
    },
  ],
  ['character', character],
  ['inventory', inventory],
  ['map', map],
  ['dungeon', dungeon],
  ['combat', combat],
  ['team', team],
  // composition：跨模組註冊面驗證（重複/缺少 Handler、Slice owner、Manifest 綁定）。
  ['composition', composition],
  // transaction：kernel Runner 與真實模組 Handler 的接線。
  ['transaction-wiring', transactionWiring],
  // session：引擎 Session 端到端——玩家命令 → §7.2 runtime-id → 跨模組級聯改真實 Slice。
  ['engine-session', engineSession],
  // content：data-runtime → 領域 Reader 的 adapter（dungeon 樣板 + 真交易端到端）。
  ['dungeon-reader', dungeonReader],
  // content：其餘 6 個模組 reader adapter（header 投影 + 特殊 getter + 跨 kind 防呆）。
  ['module-readers', moduleReaders],
  // content：資料調校 Resolver adapter（§7.1 kernel + params-from-definition + RNG 紀律）。
  ['resolvers', resolvers],
];

for (const [name, run] of throwing) {
  run();
  console.log(`${name}: pass`);
}

// progression's runTests returns results rather than throwing.
progression();
if (!progressionPass()) throw new Error('progression tests failed');
console.log('progression: pass');

console.log(
  'ALL TESTS PASS (kernel + data-runtime + 7 modules + composition + transaction wiring + engine session + content reader)',
);
console.log(`NOTE: 契約重複宣告尚餘 ${remainingDuplicateCount()} 筆待收斂（見 scripts/check-contract-duplicates.ts）`);
