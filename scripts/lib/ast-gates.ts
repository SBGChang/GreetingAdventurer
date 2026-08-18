// scripts/lib/ast-gates.ts
// 以 TypeScript compiler API + type checker 實作的門禁檢查。
//
// 為什麼要型別導向而不是 regex：原本的硬編碼 ID 檢查只認四個字串前綴
// （'definition:' / 'runtime:' / 'template-local:' / 'resolver:'），所以
//
//     const COMBAT_RULE_ID = 'combat-rule-standard' as CombatRuleId;
//
// 完全抓不到——字串本身沒有前綴，前綴在**型別**裡。regex 檢查的是「我挑的語法」，
// 不是「準則要求的性質」。改由 checker 回答「這個字面值的型別是不是內容 ID」之後，
// ID 長什麼樣就不重要了。

import ts from 'typescript';

export type AstFinding = Readonly<{
  file: string;
  line: number;
  text: string;
  detail: string;
}>;

// ──────────────────────────────────────────────────────────────────────────
// Program
// ──────────────────────────────────────────────────────────────────────────

export function createProgram(tsconfigPath: string): ts.Program {
  const configFile = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
  if (configFile.error !== undefined) {
    throw new Error(ts.flattenDiagnosticMessageText(configFile.error.messageText, '\n'));
  }
  const parsed = ts.parseJsonConfigFileContent(
    configFile.config,
    ts.sys,
    tsconfigPath.replace(/[/\\][^/\\]+$/, ''),
  );
  return ts.createProgram({ options: parsed.options, rootNames: parsed.fileNames });
}

// 一律明確帶入 SourceFile：node.getSourceFile() / getStart() 依賴 parent 指標，
// 而 ts.createProgram 預設不建立它們——只在某些呼叫路徑下碰巧可用，換個入口就會炸。
function positionOf(sf: ts.SourceFile, node: ts.Node): number {
  return sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
}

function lineTextOf(sf: ts.SourceFile, node: ts.Node): string {
  const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
  return sf.text.split('\n')[line]?.trim() ?? '';
}

// ──────────────────────────────────────────────────────────────────────────
// branded ID 的辨識
// ──────────────────────────────────────────────────────────────────────────
//
// `Brand<T, K> = T & { readonly __brand: K }`，所以 branded 字串型別是「交集 + __brand 屬性
// 且該屬性是字串字面值型別」。tag 的內容就是分類依據：
//
//   內容定址（正式路徑不得出現字面值）——這些東西的名字屬於 Content Pack：
//     definition:… / runtime:… / ephemeral:… / template-local:… / resolver / content-pack
//
//   程式身分（正式路徑本來就該寫字面值）——模組必須宣告自己是誰：
//     module:… / workflow:… / schema / definition-reader / event-subscription / …
const CONTENT_BRAND_PREFIXES = ['definition:', 'runtime:', 'ephemeral:', 'template-local:'];
const CONTENT_BRAND_EXACT = ['resolver', 'content-pack'];

function brandTagsOf(type: ts.Type, checker: ts.TypeChecker): string[] {
  const tags: string[] = [];
  const visit = (t: ts.Type): void => {
    if (t.isUnion() || t.isIntersection()) {
      for (const part of t.types) visit(part);
    }
    const brand = checker.getPropertyOfType(t, '__brand');
    if (brand === undefined) return;
    const declared = checker.getTypeOfSymbol(brand);
    for (const candidate of declared.isUnion() ? declared.types : [declared]) {
      if (candidate.isStringLiteral()) tags.push(candidate.value);
    }
  };
  visit(type);
  return tags;
}

function contentBrandTag(type: ts.Type, checker: ts.TypeChecker): string | undefined {
  return brandTagsOf(type, checker).find(
    (tag) =>
      CONTENT_BRAND_PREFIXES.some((p) => tag.startsWith(p)) || CONTENT_BRAND_EXACT.includes(tag),
  );
}

// 字面值「要被當成什麼型別用」：優先看明寫的斷言，其次看上下文（參數、屬性、回傳）。
function targetTypeOf(node: ts.Node, checker: ts.TypeChecker): ts.Type | undefined {
  const parent = node.parent;
  if (
    parent !== undefined &&
    (ts.isAsExpression(parent) || ts.isTypeAssertionExpression(parent)) &&
    parent.expression === node
  ) {
    return checker.getTypeFromTypeNode(parent.type);
  }
  return checker.getContextualType(node as ts.Expression);
}

// ──────────────────────────────────────────────────────────────────────────
// 檢查：正式路徑不得出現內容 ID 字面值（§5）
// ──────────────────────────────────────────────────────────────────────────

export function findHardcodedContentIds(
  program: ts.Program,
  isProduction: (fileName: string) => boolean,
): AstFinding[] {
  const checker = program.getTypeChecker();
  const findings: AstFinding[] = [];

  for (const sf of program.getSourceFiles()) {
    if (sf.isDeclarationFile) continue;
    if (!isProduction(sf.fileName)) continue;

    const walk = (node: ts.Node): void => {
      if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
        const target = targetTypeOf(node, checker);
        if (target !== undefined) {
          const tag = contentBrandTag(target, checker);
          if (tag !== undefined) {
            findings.push({
              file: sf.fileName,
              line: positionOf(sf, node),
              text: lineTextOf(sf, node),
              detail: `字面值 '${node.text}' 被當成內容 ID 使用（brand: ${tag}）`,
            });
          }
        }
      }
      ts.forEachChild(node, walk);
    };
    walk(sf);
  }
  return findings;
}

// ──────────────────────────────────────────────────────────────────────────
// 檢查：正式 Handler 檔不得自帶字面值常數（§6）
// ──────────────────────────────────────────────────────────────────────────
//
// `const RESTORE = 5;`、`const HOME_YEAR_REST_DAYS = 365;` —— 這些不是 `??` 形狀，舊檢查完全看不到。
// 判準不是「數字不能出現」（迴圈索引、陣列長度當然可以），而是「模組層級的具名常數」：
// 那個形狀就是在宣告一個**可調參數**，而可調參數屬於 Definition／Rule，不屬於 Handler 檔。
//
// 真正的結構不變量（戰場 3×3、隊員上限 9、Mastery Lv.0～10…）集中在 contracts/core/invariants.ts，
// 由該檔單一持有並具名匯出。檢查因此不需要逐行豁免：合法的寫法只有「從 invariants 匯入」一種。
const INVARIANTS_MODULE = /[/\\]contracts[/\\]core[/\\]invariants\.ts$/;

// **只看數值**。第一版連字串常數一起抓，結果 33 筆裡多數是 `CHARACTER_MODULE_ID`、workflow id、
// 錯誤碼、schema id——那些正是規範明列的合法不變量（「Module ID、Schema kind、錯誤碼」），
// 模組本來就必須在程式裡宣告自己是誰。內容 ID 那一類則由型別導向的檢查 2 負責，不需要在這裡重複報。
//
// 剩下的數值才是這條規則真正的目標：`5`、`365`、`100`——它們不是身分，是**量**，
// 而量要嘛是結構不變量（集中於 invariants.ts），要嘛是可調內容（屬於 Definition/Rule）。
function numericLiteralOf(init: ts.Expression): boolean {
  if (ts.isNumericLiteral(init)) return true;
  if (ts.isPrefixUnaryExpression(init) && ts.isNumericLiteral(init.operand)) return true;
  if (ts.isAsExpression(init)) return numericLiteralOf(init.expression);
  return false;
}

/** 具名數值常數：不論在模組層級或函式內。`const RESTORE = 5` 住在 handler 裡也是同一個問題。 */
export function findNamedNumericConstants(
  program: ts.Program,
  isProduction: (fileName: string) => boolean,
  appliesTo: (fileName: string) => boolean,
): AstFinding[] {
  const findings: AstFinding[] = [];

  for (const sf of program.getSourceFiles()) {
    if (sf.isDeclarationFile) continue;
    if (!isProduction(sf.fileName)) continue;
    if (!appliesTo(sf.fileName)) continue;
    if (INVARIANTS_MODULE.test(sf.fileName)) continue;

    const walk = (node: ts.Node): void => {
      if (ts.isVariableDeclaration(node) && node.initializer !== undefined) {
        // 只看 SCREAMING_CASE：那是「這是一個具名的量」的宣告，與 `const i = 0` 這種區域計算不同。
        const name = ts.isIdentifier(node.name) ? node.name.text : '';
        if (/^[A-Z][A-Z0-9_]*$/.test(name) && numericLiteralOf(node.initializer)) {
          findings.push({
            file: sf.fileName,
            line: positionOf(sf, node),
            text: lineTextOf(sf, node),
            detail: `具名數值常數 ${name}——可調的量屬於 Definition/Rule，結構不變量屬於 contracts/core/invariants.ts`,
          });
        }
      }
      ts.forEachChild(node, walk);
    };
    walk(sf);
  }
  return findings;
}

// 這裡曾經有 sanctionedMarkerLineRanges()：把 UNAVAILABLE_CAPABILITIES 等「未完成清單」的行號
// 範圍整段排除在標記掃描之外。那份清單已經刪除（未完成能力不再進註冊表），所以這個特例
// 也一併移除——沒有任何宣告可以讓一段程式碼免於受檢。
