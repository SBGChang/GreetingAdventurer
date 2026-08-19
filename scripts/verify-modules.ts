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
import { runTests as crossModulePorts } from '../src/app/content/cross-module-ports.test';
// 正式 Content Pack 端到端：磁碟 JSON → ContentRepository → Registry → 窄化 Reader → 模組純函式。
import { runTests as contentPackIntegration } from '../src/app/content/content-pack-integration.test';
import { runTests as bootstrap } from '../src/testing/composition/bring-up-bootstrap.test';
import { runTests as travelIntegration } from '../src/app/composition/travel-integration.test';
import { runTests as weaponSetWorkflow } from '../src/app/workflows/weapon-set-configuration.test';
// 地基層測試自 Wave A 起就存在，但從未被這支腳本跑過。
import { runKernelTests } from '../src/kernel/kernel.test';
import { runKernelTests as dataKernels, allKernelTestsPass } from '../src/data-runtime/kernels.test';
// content-pack 載入器：524 行、先前完全沒有測試，而它是「缺資料必須失敗」的第一道關卡。
import { runTests as contentPackLoader } from '../src/data-runtime/content-pack.test';

// Wave D：補齊的 9 個模組（各自 src/modules/<name>/<name>.test.ts）。
import { runTests as city } from '../src/modules/city/city.test';
import { runTests as quest } from '../src/modules/quest/quest.test';
import { runTests as social } from '../src/modules/social/social.test';
import { runTests as economy } from '../src/modules/economy/economy.test';
import { runTests as world } from '../src/modules/world/world.test';
import { runTests as crafting } from '../src/modules/crafting/crafting.test';
import { runTests as distribution } from '../src/modules/distribution/distribution.test';
import { runTests as combatSequence } from '../src/modules/combat-sequence/combat-sequence.test';
import { runTests as npcBehavior } from '../src/modules/npc-behavior/npc-behavior.test';
// Wave D：3 個純函式服務（無 State Slice，住 src/domain-services/）。
import { runTests as statistics } from '../src/domain-services/statistics/statistics.test';
import { runTests as gathering } from '../src/domain-services/gathering/gathering.test';
import { runTests as combatPower } from '../src/domain-services/combat-power/combat-power.test';
// Wave D：每個新單元的 data-runtime → 領域 Reader adapter。
import { runTests as cityReader } from '../src/app/content/city-reader.test';
import { runTests as questReader } from '../src/app/content/quest-reader.test';
import { runTests as socialReader } from '../src/app/content/social-reader.test';
import { runTests as economyReader } from '../src/app/content/economy-reader.test';
import { runTests as worldReader } from '../src/app/content/world-reader.test';
import { runTests as craftingReader } from '../src/app/content/crafting-reader.test';
import { runTests as distributionReader } from '../src/app/content/distribution-reader.test';
import { runTests as combatSequenceReader } from '../src/app/content/combat-sequence-reader.test';
import { runTests as npcBehaviorReader } from '../src/app/content/npc-behavior-reader.test';
import { runTests as statisticsReader } from '../src/app/content/statistics-reader.test';
import { runTests as gatheringReader } from '../src/app/content/gathering-reader.test';
import { runTests as combatPowerReader } from '../src/app/content/combat-power-reader.test';
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
  // data-runtime 載入器：Manifest／Pack 標頭（§8）、重複 ID、循環相依、壞 header 的失敗路徑。
  ['data-runtime content-pack', contentPackLoader],
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
  // content：真實跨模組 Query Port adapter（讀真實 sibling Slice，取代 fixture stub）。
  ['cross-module-ports', crossModulePorts],
  // Wave D：9 個補齊的模組。每一支都在自己的目錄內完成，測試由該模組自己持有。
  ['city', city],
  ['quest', quest],
  ['social', social],
  ['economy', economy],
  ['world', world],
  ['crafting', crafting],
  ['distribution', distribution],
  ['combat-sequence', combatSequence],
  ['npc-behavior', npcBehavior],
  // Wave D：3 個純服務。
  ['statistics', statistics],
  ['gathering', gathering],
  ['combat-power', combatPower],
  // Wave D：12 個 Reader adapter（registry → 領域 Reader 的窄化與投影）。
  ['reader:city', cityReader],
  ['reader:quest', questReader],
  ['reader:social', socialReader],
  ['reader:economy', economyReader],
  ['reader:world', worldReader],
  ['reader:crafting', craftingReader],
  ['reader:distribution', distributionReader],
  ['reader:combat-sequence', combatSequenceReader],
  ['reader:npc-behavior', npcBehaviorReader],
  ['reader:statistics', statisticsReader],
  ['reader:gathering', gatheringReader],
  ['reader:combat-power', combatPowerReader],
  // content：**正式** pack（content/**）驅動真實模組計算。前面的 reader 測試都用記憶體 fixture，
  // 只有這一支證明「作者寫下的數字真的算出了遊戲結果」。
  ['content-pack-integration', contentPackIntegration],
  // bootstrap：開機骨架端到端——NewGameBootstrapper → 玩家命令 → 提交 → golden 重播。
  ['bootstrap', bootstrap],
  // travel：玩家旅行端到端——引擎自驅（旅行事件 Workflow 訂閱者送 CompleteSegment），非手動扮演。
  ['travel-integration', travelIntegration],
  // workflow：武器組配置的跨模組技能驗證（Definition 存在／已學會／啟動手可用）。
  ['weapon-set-workflow', weaponSetWorkflow],
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
  'ALL TESTS PASS (kernel + data-runtime + 16 modules + 3 services + composition + transaction wiring + engine session + content adapters + content pack + bootstrap + travel workflow)',
);
console.log(`NOTE: 契約重複宣告尚餘 ${remainingDuplicateCount()} 筆待收斂（見 scripts/check-contract-duplicates.ts）`);
