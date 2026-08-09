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
// 地基層測試自 Wave A 起就存在，但從未被這支腳本跑過。
import { runKernelTests } from '../src/kernel/kernel.test';
import { runKernelTests as dataKernels, allKernelTestsPass } from '../src/data-runtime/kernels.test';

// These throw on any failing case.
const throwing: ReadonlyArray<readonly [string, () => void]> = [
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
];

for (const [name, run] of throwing) {
  run();
  console.log(`${name}: pass`);
}

// progression's runTests returns results rather than throwing.
progression();
if (!progressionPass()) throw new Error('progression tests failed');
console.log('progression: pass');

console.log('ALL TESTS PASS (kernel + data-runtime + 7 modules + composition + transaction wiring)');
