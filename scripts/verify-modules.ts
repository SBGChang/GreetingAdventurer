// Runs every implemented module's pure unit tests. `npx tsx scripts/verify-modules.ts`
import { runTests as character } from '../src/modules/character/character.test';
import { runTests as inventory } from '../src/modules/inventory/inventory.test';
import { runTests as progression, allTestsPass as progressionPass } from '../src/modules/progression/system.test';
import { runTests as map } from '../src/modules/map/map.test';
import { runTests as dungeon } from '../src/modules/dungeon/dungeon.test';
import { runTests as combat } from '../src/modules/combat/combat.test';
import { runTests as team } from '../src/modules/team/team.test';

// These throw on any failing case.
const throwing: ReadonlyArray<readonly [string, () => void]> = [
  ['character', character],
  ['inventory', inventory],
  ['map', map],
  ['dungeon', dungeon],
  ['combat', combat],
  ['team', team],
];

for (const [name, run] of throwing) {
  run();
  console.log(`${name}: pass`);
}

// progression's runTests returns results rather than throwing.
progression();
if (!progressionPass()) throw new Error('progression tests failed');
console.log('progression: pass');

console.log('ALL MODULE TESTS PASS (7 modules)');
