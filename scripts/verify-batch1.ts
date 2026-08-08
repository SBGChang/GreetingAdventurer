// Runs the pure unit tests for Wave B batch 1 modules. `npx tsx scripts/verify-batch1.ts`
import { runTests as runCharacter } from '../src/modules/character/character.test';
import { runTests as runInventory } from '../src/modules/inventory/inventory.test';
import { runTests as runProgression, allTestsPass as progressionPass } from '../src/modules/progression/system.test';

runCharacter();
console.log('character: pass');

runInventory();
console.log('inventory: pass');

const progressionResults = runProgression();
if (!progressionPass()) {
  console.error('progression FAILED:', progressionResults);
  throw new Error('progression tests failed');
}
console.log(`progression: pass (${progressionResults.length} cases)`);

console.log('ALL BATCH-1 MODULE TESTS PASS');
