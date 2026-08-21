// scripts/verify-runtime-discipline.ts
// 正式 Runtime 紀律門禁（規範 §14）。
//
// 這支腳本擋的是**測試抓不到的那一類問題**：測試資料滲進正式路徑、內容 ID 寫死在 Handler、
// 用型別轉換掩蓋契約缺口、以及缺資料時偷偷給預設值。這四類的共同點是它們**不會讓任何測試失敗**——
// 功能照跑、型別照過，要等到換上真內容才會發現行為根本沒變。所以只能靠靜態門禁擋。
//
// 執行：`npx tsx scripts/verify-runtime-discipline.ts`
// 任一檢查失敗即以非零結束碼退出，CI 不得產生正式 Build。
//
// 設計原則：每一筆違規都要能直接動手修——依賴圖違規印出**完整 import 鏈**，其餘印出檔案:行號與原文。
// 只說「有問題」而不說「在哪、怎麼來的」的門禁，會被當成雜訊繞過。

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

import {
  createProgram,
  findHardcodedContentIds,
  findNamedNumericConstants,
} from './lib/ast-gates';

const ROOT = resolve(import.meta.dirname, '..');
const SRC = join(ROOT, 'src');

// 型別導向的檢查需要一個完整的 Program（帶 type checker）。建一次共用。
const program = createProgram(join(ROOT, 'tsconfig.json'));

// ──────────────────────────────────────────────────────────────────────────
// 什麼算「測試／Bring-up」——規範 §13 的清單
// ──────────────────────────────────────────────────────────────────────────
//
// 這份判斷刻意以**檔名慣例**為準而不是靠人工標註：慣例可以被工具檢查，標註會忘記加。
// 新增測試專用檔時請沿用這些名稱，否則它會被當成正式檔而繞過本門禁。
const TEST_ONLY_PATTERNS: readonly { pattern: RegExp; why: string }[] = [
  { pattern: /\.test\.ts$/, why: '測試檔' },
  { pattern: /(^|[/\\])fixtures\.ts$/, why: '模組測試 Fixture' },
  { pattern: /fixture[^/\\]*\.ts$/, why: '測試 Fixture' },
  { pattern: /(^|[/\\])testing[/\\]/, why: '測試專用目錄' },
  // 這裡曾經有一筆 `/bootstrap\.ts$/`，把 bring-up bootstrap 以**檔名**排除在四項檢查之外。
  // 那是個陷阱：正式 NewGameBootstrapper 最自然的落點就叫 bootstrap.ts，寫上去的那天它會安靜地
  // 免檢——而 Bootstrap 正是最該受檢的地方（§1.1 要派生屬性、驗內容、排生命週期 Job）。
  // Bring-up 版本已改名並移入 src/testing/，靠**位置**排除；檔名 bootstrap.ts 現在是受檢的。
];

function testOnlyReason(file: string): string | undefined {
  const rel = relative(ROOT, file);
  return TEST_ONLY_PATTERNS.find((p) => p.pattern.test(rel))?.why;
}

// ──────────────────────────────────────────────────────────────────────────
// 正式路徑的根
// ──────────────────────────────────────────────────────────────────────────
//
// 目前還沒有 React／Electron 主程式，所以「正式路徑」以**未來的產品進入點會用到什麼**來定義：
// 引擎 Session、啟動驗證、路由、各模組對外面、內容 adapter、Workflow、kernel、data-runtime。
// 這份清單就是規範 §2 適用範圍的具體化；產品進入點建立後應改由它單一為根。
const PRODUCTION_ROOTS: readonly string[] = [
  'src/app/composition/session.ts',
  'src/app/composition/registry.ts',
  'src/app/composition/router.ts',
  'src/app/composition/manifest.ts',
  'src/app/composition/messages.ts',
  'src/app/composition/state.ts',
  'src/modules/character/public.ts',
  'src/modules/inventory/public.ts',
  'src/modules/progression/public.ts',
  'src/modules/map/public.ts',
  'src/modules/dungeon/public.ts',
  'src/modules/combat/public.ts',
  'src/modules/team/public.ts',
  'src/app/workflows/player-travel-event.ts',
  'src/app/workflows/weapon-set-configuration.ts',
  'src/kernel/index.ts',
  'src/data-runtime/index.ts',
  // Wave D：補齊的模組與純服務。加進正式根，依賴圖檢查（§13）才會涵蓋它們——
  // 在此之前它們只受「掃 src 下所有非測試檔」的那幾項檢查，測試資料滲入是驗不到的。
  'src/modules/city/public.ts',
  'src/modules/quest/public.ts',
  'src/modules/social/public.ts',
  'src/modules/economy/public.ts',
  'src/modules/world/public.ts',
  'src/modules/crafting/public.ts',
  'src/modules/distribution/public.ts',
  'src/modules/combat-sequence/public.ts',
  'src/modules/npc-behavior/public.ts',
  'src/domain-services/statistics/public.ts',
  'src/domain-services/gathering/public.ts',
  'src/domain-services/combat-power/public.ts',
  // ContentRepository Platform Port：正式路徑讀內容的唯一入口。它必須受檢——這裡是
  // 「缺檔就跳過」「壞 JSON 就給空陣列」最有誘因發生的地方。
  'src/platform/content-repository.ts',
];

// ──────────────────────────────────────────────────────────────────────────
// 工具
// ──────────────────────────────────────────────────────────────────────────

// 逐行檢查的共用讀取：**先去掉行尾的 CR**，再回傳行陣列。
//
// 為什麼需要這一步：本 repo 在 Windows 上是 CRLF checkout（.gitattributes 未指定，git 會轉換），
// 所以每一行都以 `\r` 結尾。而 JavaScript 正規表達式的 `.` **不匹配 line terminator**，而 `\r`
// 正是其中之一——於是 `line.replace(/\/\/.*$/, '')` 這個「去掉行註解」的動作在 CRLF 檔上
// 完全失效（`.*` 停在 `\r` 前，`$` 又要求字串結尾，整個 match 失敗）。
//
// 後果不是漏抓，而是**誤抓**：任何在註解裡「提到」被禁樣式的句子都會被當成違規。實測有兩筆——
// `src/contracts/crafting/index.ts` 用註解說明「不要寫 `effectId as unknown as statusId`」，
// 反而讓那份正確的說明變成一筆違規。門禁一旦開始誤報，下一步就是被繞過。
function codeLinesOf(file: string): readonly string[] {
  return readFileSync(file, 'utf8').split('\n').map((line) => line.replace(/\r$/, ''));
}

// 去掉行註解後的程式碼部分（不含區塊註解——那由 stripComments 處理整檔的情形）。
function codeOnly(line: string): string {
  return line.replace(/\/\/.*$/, '');
}

function walkFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walkFiles(full, out);
    else if (entry.endsWith('.ts')) out.push(full);
  }
  return out;
}

// 只取相對 import：套件 import 不在本門禁範圍（node_modules 不會是測試 fixture）。
const IMPORT_RE = /(?:from|import)\s*\(?\s*['"](\.[^'"]+)['"]/g;

// 註解裡出現 `import './fixtures'` 這種**說明文字**很常見（例如告訴讀者測試該從哪裡 import），
// 不先去掉註解就會把它當成真的 import——本門禁自己第一次跑就踩到了這個誤判。
// 會誤傷字串常值裡的 `//`（例如 URL），但本檔只用來抓 import 與樣式，那個代價可以接受。
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[^\n]*?\/\/[^\n]*$/gm, (line) => {
    const idx = line.indexOf('//');
    return line.slice(0, idx);
  });
}

function importsOf(file: string): string[] {
  const source = stripComments(readFileSync(file, 'utf8'));
  const specs: string[] = [];
  for (const m of source.matchAll(IMPORT_RE)) specs.push(m[1]!);
  return specs;
}

function resolveImport(fromFile: string, spec: string): string | undefined {
  const base = resolve(dirname(fromFile), spec);
  for (const candidate of [`${base}.ts`, join(base, 'index.ts')]) {
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      // 解析不到就換下一個候選；不是本門禁要報的問題（tsc 會抓）。
    }
  }
  return undefined;
}

type Failure = Readonly<{ check: string; detail: string }>;

// ──────────────────────────────────────────────────────────────────────────
// ──────────────────────────────────────────────────────────────────────────
// 沒有豁免，也沒有放行清單
// ──────────────────────────────────────────────────────────────────────────
//
// 演化過三代，每一代都被同一個問題打回：
//   1. `runtime-discipline-allow: <理由>` 逐行註解——一扇對任何一行都開的門。
//   2. 整檔放行（invariants.ts / accumulate.ts）——粒度變粗，但仍是 allowlist：
//      把違規程式搬進那兩個檔就能繞過。
//   3. 現在：**兩者都沒有。** 合法語意靠**改寫成不需要豁免的形狀**來成立。
//
// 具體怎麼做到的：
//   結構不變量集中在 contracts/core/invariants.ts——而數值常數檢查的範圍本來就只涵蓋
//     src/modules 與 src/app，contracts 不在其中，所以不需要任何特例。
//   計數起點在 kernel/accumulate.ts——該檔已改寫成 `x === undefined ? amount : x + amount`，
//     完全沒有預設值可言，因此也不需要特例。
//
// 判準因此變成：如果一段程式需要豁免才能過，那不是門禁太嚴，是那段程式還沒寫成正確的形狀。

// ──────────────────────────────────────────────────────────────────────────
// 檢查 1：正式依賴圖不得含測試／Bring-up（§13）
// ──────────────────────────────────────────────────────────────────────────
//
// 為什麼要走**傳遞**依賴而不是只看直接 import：`public.ts` 對外再匯出 fixtures 時，正式檔案看起來
// 只是 import 了 `public.ts`，很正常；但 fixture 已經在正式依賴圖裡了。規範 §13 的判準是
// 「只要正式程式**可以**引用」，不是「有沒有真的用到」。
function checkProductionDependencyGraph(): Failure[] {
  const failures: Failure[] = [];
  // 記錄抵達每個檔案的路徑，讓違規能印出完整 import 鏈。
  const cameFrom = new Map<string, string | undefined>();
  const queue: string[] = [];

  for (const rel of PRODUCTION_ROOTS) {
    const full = join(ROOT, rel);
    try {
      statSync(full);
    } catch {
      failures.push({
        check: 'production-graph',
        detail: `PRODUCTION_ROOTS 列出的 "${rel}" 不存在——根清單過期了，請更新本腳本`,
      });
      continue;
    }
    if (!cameFrom.has(full)) {
      cameFrom.set(full, undefined);
      queue.push(full);
    }
  }

  const chainOf = (file: string): string => {
    const chain: string[] = [];
    let cur: string | undefined = file;
    while (cur !== undefined) {
      chain.unshift(relative(ROOT, cur).replace(/\\/g, '/'));
      cur = cameFrom.get(cur);
    }
    return chain.join('\n        → ');
  };

  while (queue.length > 0) {
    const file = queue.shift()!;
    const reason = testOnlyReason(file);
    // 根本身若是測試檔，代表根清單寫錯；非根則是真正的違規。
    if (reason !== undefined && cameFrom.get(file) !== undefined) {
      failures.push({
        check: 'production-graph',
        detail: `正式依賴圖含${reason}：\n        ${chainOf(file)}`,
      });
      continue; // 不再往下走，避免同一個 fixture 的下游噴出一堆重複訊息
    }
    for (const spec of importsOf(file)) {
      const target = resolveImport(file, spec);
      if (target === undefined || cameFrom.has(target)) continue;
      cameFrom.set(target, file);
      queue.push(target);
    }
  }
  return failures;
}

// ──────────────────────────────────────────────────────────────────────────
// 檢查 2：正式路徑不得寫死內容 ID（§5）——型別導向
// ──────────────────────────────────────────────────────────────────────────
//
// 早期版本用 regex 找 `'definition:…'` / `'runtime:…'` / `'resolver:…'` 這幾個字串前綴。那漏掉了
// 整整一類：
//
//     const COMBAT_RULE_ID = 'combat-rule-standard' as CombatRuleId;
//
// 字串本身沒有前綴，前綴在**型別**（`CombatRuleId = DefinitionId<'combat-rule'>`）裡。regex 檢查的是
// 「我挑的語法」，不是「準則要求的性質」——而準則要問的是「這個東西的名字屬不屬於 Content Pack」。
//
// 現在由 type checker 回答：任何字面值，只要它被當成 brand tag 為 `definition:` / `runtime:` /
// `ephemeral:` / `template-local:` / `resolver` / `content-pack` 的型別在用，就是違規。ID 字面上長
// 什麼樣不再重要。`module:` / `workflow:` / `definition-reader` 等**程式身分** brand 不在此列——
// 模組本來就必須在程式裡宣告自己是誰。
//
// **本檢查刻意不支援豁免。** §7／§6 有語法上分不出來的合法情形，所以需要明示豁免；§5 沒有——
// 規範的五個合法出口裡沒有「把 ID 寫在 Handler 裡並附上理由」這一項。
// 內容作者層（`content-source/**`）。**這裡是內容 ID 唯一合法的地方**——它就是內容本身。
//
// 這不是豁免機制的回歸。§5 檢查的用意是「Handler 不得自行決定內容」；判斷依據是**位置**，
// 與 `contracts/core/invariants.ts` 持有結構不變量、`kernel/accumulate.ts` 持有計數起點完全同型：
// 要主張某個語意合法，做法是把它搬到那個具名位置，而不是在原地寫一行註解放行自己。
//
// 作者層寫下 `'pack:core' as ContentPackId` 是它的**職責**：Content Pack 的身分只能由內容宣告。
// 反過來說，正式 Runtime 一旦 import 這個目錄就是違規——那由上方的依賴圖檢查（§13）擋，
// 兩道檢查合起來才完整：內容 ID 只准出現在內容裡，而內容不准被程式讀進正式路徑。
const CONTENT_AUTHORING_ROOT = 'content-source/';

function isContentAuthoring(file: string): boolean {
  return relative(ROOT, file).replace(/\\/g, '/').startsWith(CONTENT_AUTHORING_ROOT);
}

function checkNoHardcodedContentIds(): Failure[] {
  return findHardcodedContentIds(
    program,
    (f) => testOnlyReason(f) === undefined && !isContentAuthoring(f),
  ).map((f) => ({
    check: 'hardcoded-content-id',
    detail: `${relative(ROOT, f.file).replace(/\\/g, '/')}:${f.line} ${f.detail}\n        ${f.text}`,
  }));
}

// ──────────────────────────────────────────────────────────────────────────
// 檢查 3：正式路徑不得用 `as unknown as` 跨語意轉型（§7）
// ──────────────────────────────────────────────────────────────────────────
//
// `as unknown as` 幾乎總是在說「這兩個型別其實對不起來，但我需要它過」。真正缺的是契約——
// 對照表、欄位、或 Reader getter。這裡不區分「無害的去品牌」與「危險的跨語意」，因為兩者從語法
// 上分不出來；要保留就必須在同一行寫 `runtime-discipline-allow` 並說明理由，讓它變成一個**明示的
// 決定**而不是順手寫下的東西。
function checkNoCrossSemanticCasts(productionFiles: readonly string[]): Failure[] {
  const failures: Failure[] = [];
  for (const file of productionFiles) {
    const lines = codeLinesOf(file);
    lines.forEach((line, i) => {
      const code = codeOnly(line);
      if (!code.includes('as unknown as')) return;
      failures.push({
        check: 'cross-semantic-cast',
        detail: `${relative(ROOT, file).replace(/\\/g, '/')}:${i + 1} 使用 as unknown as（缺契約？）\n        ${line.trim()}`,
      });
    });
  }
  return failures;
}

// ──────────────────────────────────────────────────────────────────────────
// 檢查 4：正式路徑不得對玩法數值給預設（§6）
// ──────────────────────────────────────────────────────────────────────────
//
// `?? 5`、`?? 1`、`?? 'female'` 這類寫法把「缺資料」變成「有一個看起來合理的值」，是規範點名的
// 方便性 fallback。從語法分不出「計數從 0 起」與「傷害預設 0」——所以合法的計數起點一律集中在
// kernel/accumulate.ts，由該檔的**位置**放行（見上方「合法語意的認定」）。其餘一律違規。
const SCALAR_FALLBACK_RE = /\?\?\s*(-?\d+(?:\.\d+)?|'[^']*'|"[^"]*")/g;

// 空集合預設（`?? []`、`?? {}`）另有針對性檢查，理由見 checkNoContentEmptyFallbacks。
const EMPTY_COLLECTION_FALLBACK_RE = /\?\?\s*(\[\s*\]|\{\s*\})/g;

function checkNoValueFallbacks(productionFiles: readonly string[]): Failure[] {
  const failures: Failure[] = [];
  for (const file of productionFiles) {
    const lines = codeLinesOf(file);
    lines.forEach((line, i) => {
      const code = codeOnly(line);
      for (const m of code.matchAll(SCALAR_FALLBACK_RE)) {
        failures.push({
          check: 'value-fallback',
          detail: `${relative(ROOT, file).replace(/\\/g, '/')}:${i + 1} 對缺值給了預設 \`?? ${m[1]}\`\n        ${line.trim()}`,
        });
      }
    });
  }
  return failures;
}

// ──────────────────────────────────────────────────────────────────────────
// 檢查 5：空集合預設的 ratchet（§6 附註）
// ──────────────────────────────────────────────────────────────────────────
// 為什麼不是「所有 `?? []` 都違規」，也不是計數式 ratchet：
//
// 建立本檢查時逐筆看過全部 31 筆，**沒有一筆是從內容讀出來的**。全是兩種形狀——選填建構參數
// （`createTeamState({ teams?: Team[] })` 的 `input.teams ?? []`）與查無此鍵的集合（`edges.get(n) ?? []`）。
// 那兩種的「空」是集合的單位元，不是替代缺失內容的假值：沒有任何 Content Pack 會讓「未指定的隊伍」
// 變成三支預設隊伍。全部報成違規只會製造 29 筆雜訊，而基準線又只是換個名字的豁免帳。
//
// 真正該擋的是**從內容讀出來卻預設成空**：`skillView.effectIds ?? []` 會把壞掉的內容引用悄悄變成
// 「這個技能沒有效果」。所以檢查改成只看這一種——左側是 Definition／View 的讀取，或 Reader 的 getter。
// 目前為 0 筆；它擋的是還沒發生的那一類，不是既有的那 29 筆。
const CONTENT_READ_LHS = /(?:\.definitions\.|\.reader\.|\bget[A-Z]\w*\(|\bView\b|Definition\b)/;

function collectContentEmptyFallbacks(productionFiles: readonly string[]): string[] {
  const found: string[] = [];
  for (const file of productionFiles) {
    const lines = codeLinesOf(file);
    lines.forEach((line, i) => {
      const code = codeOnly(line);
      for (const m of code.matchAll(EMPTY_COLLECTION_FALLBACK_RE)) {
        const lhs = code.slice(0, m.index ?? 0);
        if (!CONTENT_READ_LHS.test(lhs)) continue;
        found.push(`${relative(ROOT, file).replace(/\\\\/g, '/')}:${i + 1}\n        ${line.trim()}`);
      }
    });
  }
  return found;
}

function checkNoContentEmptyFallbacks(productionFiles: readonly string[]): Failure[] {
  return collectContentEmptyFallbacks(productionFiles).map((detail) => ({
    check: 'content-empty-fallback',
    detail: `${detail}\n        內容讀取不得預設成空集合——缺內容要明確失敗，不是「這個東西沒有子項」。`,
  }));
}
// ──────────────────────────────────────────────────────────────────────────
// 檢查 6：正式路徑不得有未完成標記（§5「用 TODO 註解把未完成行為合理化」）
// ──────────────────────────────────────────────────────────────────────────
//
// 前面五項檢查都在看**語法形狀**，但規範真正要擋的一大類是「固定行為」——事件選項一律成功、
// 控制抗性一律 1 倍、旅行一律無事件。那些程式碼在語法上完全正常，沒有 `??`、沒有轉型、
// 沒有寫死 ID，靜態掃描抓不到。
//
// 唯一可靠的線索是**作者自己留下的字**：寫這段程式的人幾乎都知道它沒做完，並且會寫下來。
// 所以這裡直接把那些字列為違規。這不是靠關鍵字猜測品質，而是承認一件事——
// 「我知道這裡沒做完」與「這裡可以進正式 Runtime」不能同時成立。
//
// 要移除標記只有兩條路：把它做完，或把該 Capability 關掉。改寫註解措辭不算。
//
// **為什麼這一項不在阻擋清單裡，而是獨立的 `npm run verify:gap`：**
// 前面幾項量的是「已經寫下來的程式寫得對不對」——那是可以要求隨時為真的。這一項量的是
// 「還有多少沒寫」：建立當下 101 筆，內容是地牢事件選項、NPC 戰鬥、控制抗性、Distribution 模組……
// 也就是這個專案剩下的開發工作本身。把它接進阻擋門禁，等於在遊戲做完之前 CI 永遠是紅的，
// 而永遠紅的門禁只會訓練所有人忽略它——那比沒有門禁更糟。
//
// 兩者混在一起還會毀掉一個更重要的訊號：紀律門禁綠燈的意思應該是「已完成的部分沒有偷工」，
// 而不是「遊戲做完了」。分開之後兩個數字各自誠實：紀律 0，缺口 101。
// 缺口清到 0 時，把它移進上面的 checks 陣列即可。
// 判準：這裡收的必須是**作者用來標記「這段沒做完」的記號**，而不是「碰巧出現在領域敘述裡的
// 普通詞彙」。兩者混在一起時，門禁會開始懲罰正確的工作——做對事情反而讓數字上升。
//
// 曾經收過 `暫時` 與 `暫定`，兩者都不符合上面的判準：
//   * 「暫時角色」是設計文件的一級術語（`origin: 'questTemporary'`，04_character_module.md §7.1
//     整節在講它）、「暫時狀態」同理（Character 的責任之一）。談到它們的每一行都會被計為缺口，
//     於是把 TemporaryCharacterRuleDefinition 從 Record<string, unknown> 收成真 Schema 這種
//     **清除**缺口的改動，反而讓計數上升 4 筆。
//   * 「同交易前段的暫定變更可被觀察」是 kernel 對交易語意的正確描述（transaction.ts）。
//   * 「角色可能暫時保留高於新上限的 HP」只是普通副詞（inventory）。
// `暫代` 保留：它在這個 repo 裡只有一種用法——「暫時頂替的實作」，正是要抓的東西。
//
// 同理補上先前漏掉的**真記號**：作者確實在用 [MISMATCH]／[INFERRED]，以及「待做」「仍缺」
// 這兩個與已收錄的「待接／待補」同義的寫法。漏收它們的代價是實際缺口被低估。
const UNFINISHED_MARKERS: readonly { pattern: RegExp; why: string }[] = [
  { pattern: /\bTODO\b/, why: 'TODO' },
  { pattern: /\bFIXME\b/, why: 'FIXME' },
  { pattern: /\bHACK\b/, why: 'HACK' },
  { pattern: /\bXXX\b/, why: 'XXX' },
  { pattern: /\[DATA\]/, why: '[DATA]' },
  { pattern: /\[INVENTED\]/, why: '[INVENTED]' },
  { pattern: /\[INFERRED\]/, why: '[INFERRED]' },
  { pattern: /\[MISMATCH\]/, why: '[MISMATCH]' },
  { pattern: /\[AMBIGUITY\]|\(AMBIGUITY\)/, why: 'AMBIGUITY' },
  { pattern: /佔位/, why: '佔位' },
  { pattern: /待接|待補|待實作|待資料|待內容|待做/, why: '待接／待補' },
  { pattern: /仍缺|尚缺/, why: '仍缺' },
  { pattern: /第一版(?:固定|僅|只|暫)/, why: '第一版固定／暫代' },
  { pattern: /尚未實作|未實作/, why: '尚未實作' },
  { pattern: /暫代/, why: '暫代' },
];

export function checkNoUnfinishedMarkers(productionFiles: readonly string[]): Failure[] {
  const failures: Failure[] = [];
  for (const file of productionFiles) {
    const lines = codeLinesOf(file);
    lines.forEach((line, i) => {
      const lineNo = i + 1;
      const hit = UNFINISHED_MARKERS.find((m) => m.pattern.test(line));
      if (hit === undefined) return;
      failures.push({
        check: 'unfinished-marker',
        detail: `${relative(ROOT, file).replace(/\\/g, '/')}:${lineNo} 未完成標記（${hit.why}）\n        ${line.trim()}`,
      });
    });
  }
  return failures;
}

// ──────────────────────────────────────────────────────────────────────────
// 檢查 7：正式 Handler 檔不得自帶字面值常數（§6）
// ──────────────────────────────────────────────────────────────────────────
//
// `const RESTORE = 5;`、`const HOME_YEAR_REST_DAYS = 365;`——不是 `??` 形狀，前面的檢查看不到。
// 模組層級具名常數這個形狀本身就在宣告一個可調參數，而可調參數屬於 Definition／Rule。
// 真正的結構不變量集中在 `contracts/core/invariants.ts`，由該檔單一持有；合法寫法只有「從那裡匯入」。
const LITERAL_CONST_SCOPE = /[/\\]src[/\\](?:modules|app)[/\\]/;

function checkNoNamedNumericConstants(): Failure[] {
  return findNamedNumericConstants(
    program,
    (f) => testOnlyReason(f) === undefined,
    (f) => LITERAL_CONST_SCOPE.test(f),
  ).map((f) => ({
    check: 'named-numeric-constant',
    detail: `${relative(ROOT, f.file).replace(/\\/g, '/')}:${f.line} ${f.detail}\n        ${f.text}`,
  }));
}

// ──────────────────────────────────────────────────────────────────────────
// 主程序
// ──────────────────────────────────────────────────────────────────────────

// 檢查 2～4 的對象：src 底下所有**非**測試／Bring-up 的檔案。
// 用「全部非測試檔」而不是「依賴圖可達的檔案」，是為了讓還沒被任何根引用到的正式檔也受檢——
// 否則新寫的 Handler 在接上路由之前是免檢的，那正是最容易寫進暫代行為的時候。
export const productionFiles = walkFiles(SRC).filter((f) => testOnlyReason(f) === undefined);

// 只有被直接執行時才跑主程序：verify-implementation-gap.ts 會 import 本檔取用
// checkNoUnfinishedMarkers 與 productionFiles，不該連帶把整套門禁跑一遍。
const isEntryPoint = process.argv[1]?.replace(/\\/g, '/').endsWith('verify-runtime-discipline.ts') ?? false;
if (!isEntryPoint) {
  // 供 gap 報告 import；不執行任何檢查。
} else {

const checks: readonly { name: string; run: () => Failure[] }[] = [
  { name: '正式依賴圖不含測試／Bring-up（§13）', run: checkProductionDependencyGraph },
  { name: '無硬編碼內容 ID（§5，型別導向）', run: checkNoHardcodedContentIds },
  { name: '無跨語意強制轉型（§7）', run: () => checkNoCrossSemanticCasts(productionFiles) },
  { name: '無玩法數值 fallback（§6）', run: () => checkNoValueFallbacks(productionFiles) },
  { name: '內容讀取不得預設成空集合（§6）', run: () => checkNoContentEmptyFallbacks(productionFiles) },
  { name: '無具名數值常數（§6）', run: checkNoNamedNumericConstants },
];

let total = 0;
for (const check of checks) {
  const failures = check.run();
  total += failures.length;
  if (failures.length === 0) {
    console.log(`✓ ${check.name}`);
    continue;
  }
  console.log(`✗ ${check.name}：${failures.length} 筆`);
  for (const f of failures) console.log(`    - ${f.detail}`);
}

console.log('');
console.log(`受檢正式檔案：${productionFiles.length}`);
if (total > 0) {
  console.log(`RUNTIME DISCIPLINE FAILED：共 ${total} 筆違規`);
  process.exit(1);
}
console.log('RUNTIME DISCIPLINE PASSED');
console.log('（實作缺口另計，不阻擋建置：npm run verify:gap）');

} // isEntryPoint
