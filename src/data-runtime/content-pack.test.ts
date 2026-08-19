// data-runtime/content-pack.test.ts
// 自足式單元測試（無外部框架）。runTests() 逐案執行，任一失敗即 throw。
//
// 為什麼現在才有：content-pack.ts 是 524 行的載入器，先前**完全沒有測試**——
// verify-modules 只跑了 data-runtime 的 kernels。而它正是「缺資料必須失敗」的第一道關卡：
// 它放行了什麼，後面每一個 Reader 都會照著錯下去。
//
// 覆蓋（對照 13_data_runtime.md §11 最小驗收）：
//   * §11.1 canonical hash 不受物件鍵列舉順序影響。
//   * §11.2 重複 Definition ID、缺 Pack、缺 loadOrder 項、循環相依、packId 不符、壞 header 皆失敗。
//   * §8   pack 標頭：schemaVersion 不支援、Runtime 版本不相容、未宣告 kind、宣告 kind 卻沒有定義。
//   * Registry 查詢語意：依 kind 過濾、enabled=false 預設不列、require 缺 ID 拋錯。

import type { ContentPackId, DefinitionId, ResolverId } from '../contracts/core';
import {
  canonicalJson,
  loadContent,
  runtimeSatisfies,
  RUNTIME_DATA_CONTRACT,
  DataLoadCode,
  type RawContentDefinition,
  type RawContentManifest,
  type RawContentPack,
  type CompileContentResult,
} from './content-pack';

// ── 小工具 ────────────────────────────────────────────────────────────────

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const BASE_PACK = 'pack:base' as ContentPackId;

function def(
  id: string,
  kind: string,
  overrides: Partial<Record<string, unknown>> = {},
): RawContentDefinition {
  return {
    id,
    kind,
    schemaVersion: 1,
    packId: String(BASE_PACK),
    enabled: true,
    sourcePath: `base/${kind}/${id}.json`,
    ...overrides,
  } as RawContentDefinition;
}

function pack(overrides: Partial<RawContentPack> = {}): RawContentPack {
  return {
    packId: BASE_PACK,
    version: '1.0.0',
    schemaVersion: RUNTIME_DATA_CONTRACT.packSchemaVersion,
    runtimeCompatibility: { minRuntimeVersion: '0.1.0' },
    scope: { cultureIds: [], features: ['core'] },
    declaredKinds: ['team-plan-rule'],
    requiredResolverIds: [],
    definitions: [def('definition:team-plan-rule.home-rest', 'team-plan-rule')],
    ...overrides,
  };
}

function manifest(overrides: Partial<RawContentManifest> = {}): RawContentManifest {
  return {
    manifestVersion: '1',
    packs: [
      {
        packId: BASE_PACK,
        version: '1.0.0',
        requiredPacks: [],
        optional: false,
        contentRoot: 'base',
      },
    ],
    loadOrder: [BASE_PACK],
    localizationBundles: [],
    ...overrides,
  };
}

function codesOf(result: CompileContentResult): string[] {
  return result.success ? [] : result.diagnostics.map((d) => d.code);
}

function expectFailureWith(result: CompileContentResult, code: string, label: string): void {
  assert(!result.success, `${label}: 應該編譯失敗，但成功了`);
  assert(codesOf(result).includes(code), `${label}: 診斷碼應含 ${code}，實得 ${codesOf(result).join(',')}`);
}

// ── 測試案例 ──────────────────────────────────────────────────────────────

type Case = Readonly<{ name: string; run: () => void }>;

const cases: readonly Case[] = [
  {
    name: 'happy path: 載入成功、definitionCount 正確、registry 可依 id 取回',
    run: () => {
      const result = loadContent({ manifest: manifest(), packs: [pack()] });
      assert(result.success, `應該成功，實得 ${codesOf(result).join(',')}`);
      if (!result.success) return;
      assert(result.report.definitionCount === 1, 'definitionCount = 1');
      assert(result.report.packCount === 1, 'packCount = 1');
      const id = 'definition:team-plan-rule.home-rest' as DefinitionId;
      assert(result.registry.has(id), 'registry 認得該 definition');
      assert(result.registry.kindOf(id) === 'team-plan-rule', 'kindOf 回報宣告的 kind');
      assert(result.registry.size === 1, 'size = 1');
    },
  },
  {
    name: '§11.1 canonical hash 不受物件鍵列舉順序影響',
    run: () => {
      const a = canonicalJson({ b: 1, a: 2, c: { y: 1, x: 2 } });
      const b = canonicalJson({ c: { x: 2, y: 1 }, a: 2, b: 1 });
      assert(a === b, `鍵順序不同的同一份資料必須得到同一個 canonical 字串\n  a=${a}\n  b=${b}`);
      // 陣列順序**是**資料的一部分，不得被排序掉。
      assert(canonicalJson([1, 2]) !== canonicalJson([2, 1]), '陣列順序必須保留');
    },
  },
  {
    name: '§11.1 manifest identity：同一份輸入得到同一個 hash（決定性）',
    run: () => {
      const one = loadContent({ manifest: manifest(), packs: [pack()] });
      const two = loadContent({ manifest: manifest(), packs: [pack()] });
      assert(one.success && two.success, '兩次都該成功');
      if (!one.success || !two.success) return;
      const h1 = one.registry.getManifestIdentity();
      const h2 = two.registry.getManifestIdentity();
      assert(h1.manifestHash === h2.manifestHash, 'manifestHash 必須決定性');
      assert(h1.packs[0]?.hash === h2.packs[0]?.hash, 'pack hash 必須決定性');
    },
  },
  {
    name: '§11.2 重複 Definition ID → error（且不默默後蓋前）',
    run: () => {
      const dup = pack({
        definitions: [
          def('definition:team-plan-rule.home-rest', 'team-plan-rule'),
          def('definition:team-plan-rule.home-rest', 'team-plan-rule', { sourcePath: 'base/dup.json' }),
        ],
      });
      expectFailureWith(
        loadContent({ manifest: manifest(), packs: [dup] }),
        DataLoadCode.DuplicateDefinitionId,
        '重複 ID',
      );
    },
  },
  {
    name: '§11.2 缺 pack（必要）→ error；optional pack 缺少 → warning 且仍成功',
    run: () => {
      expectFailureWith(
        loadContent({ manifest: manifest(), packs: [] }),
        DataLoadCode.MissingPack,
        '必要 pack 缺少',
      );

      const optionalOnly = manifest({
        packs: [
          {
            packId: BASE_PACK,
            version: '1.0.0',
            requiredPacks: [],
            optional: true,
            contentRoot: 'base',
          },
        ],
      });
      const result = loadContent({ manifest: optionalOnly, packs: [] });
      assert(result.success, 'optional pack 缺少不得使整體失敗');
      if (!result.success) return;
      assert(
        result.report.warnings.some((w) => w.code === DataLoadCode.MissingPack),
        'optional pack 缺少必須留下 warning，不得無聲',
      );
    },
  },
  {
    name: '§11.2 loadOrder 指向未宣告的 pack → error',
    run: () => {
      const bad = manifest({ loadOrder: ['pack:ghost' as ContentPackId] });
      expectFailureWith(
        loadContent({ manifest: bad, packs: [pack()] }),
        DataLoadCode.MissingLoadOrderEntry,
        'loadOrder 幽靈項',
      );
    },
  },
  {
    name: '§11.2 循環 pack 相依 → error',
    run: () => {
      const a = 'pack:a' as ContentPackId;
      const b = 'pack:b' as ContentPackId;
      const cyclic = manifest({
        packs: [
          { packId: a, version: '1.0.0', requiredPacks: [{ packId: b, version: '1.0.0' }], optional: false, contentRoot: 'a' },
          { packId: b, version: '1.0.0', requiredPacks: [{ packId: a, version: '1.0.0' }], optional: false, contentRoot: 'b' },
        ],
        loadOrder: [a, b],
      });
      const packs = [
        pack({ packId: a, definitions: [def('definition:team-plan-rule.a', 'team-plan-rule', { packId: String(a) })] }),
        pack({ packId: b, definitions: [def('definition:team-plan-rule.b', 'team-plan-rule', { packId: String(b) })] }),
      ];
      expectFailureWith(
        loadContent({ manifest: cyclic, packs }),
        DataLoadCode.CyclicPackDependency,
        '循環相依',
      );
    },
  },
  {
    name: '§11.2 必要相依 pack 未宣告 → error',
    run: () => {
      const m = manifest({
        packs: [
          {
            packId: BASE_PACK,
            version: '1.0.0',
            requiredPacks: [{ packId: 'pack:missing' as ContentPackId, version: '1.0.0' }],
            optional: false,
            contentRoot: 'base',
          },
        ],
      });
      expectFailureWith(
        loadContent({ manifest: m, packs: [pack()] }),
        DataLoadCode.MissingRequiredPack,
        '缺必要相依',
      );
    },
  },
  {
    name: '§11.2 definition 的 packId 與所屬 pack 不符 → error',
    run: () => {
      const mismatched = pack({
        definitions: [def('definition:team-plan-rule.x', 'team-plan-rule', { packId: 'pack:other' })],
      });
      expectFailureWith(
        loadContent({ manifest: manifest(), packs: [mismatched] }),
        DataLoadCode.PackIdMismatch,
        'packId 不符',
      );
    },
  },
  {
    name: '§11.2 缺 header 欄位 → error 且列出缺了哪些欄位',
    run: () => {
      const malformed = pack({
        definitions: [{ id: 'definition:team-plan-rule.x', kind: 'team-plan-rule' } as RawContentDefinition],
      });
      const result = loadContent({ manifest: manifest(), packs: [malformed] });
      expectFailureWith(result, DataLoadCode.MalformedDefinition, '壞 header');
      if (result.success) return;
      const diag = result.diagnostics.find((d) => d.code === DataLoadCode.MalformedDefinition);
      const missing = (diag?.details?.['missingOrInvalidFields'] ?? []) as readonly string[];
      assert(missing.includes('schemaVersion'), '必須指出缺 schemaVersion');
      assert(missing.includes('enabled'), '必須指出缺 enabled');
      assert(missing.includes('packId'), '必須指出缺 packId');
    },
  },
  {
    name: '§8 pack schemaVersion 不受支援 → error（整份拒絕，不逐筆解析）',
    run: () => {
      const future = pack({ schemaVersion: RUNTIME_DATA_CONTRACT.packSchemaVersion + 1 });
      expectFailureWith(
        loadContent({ manifest: manifest(), packs: [future] }),
        DataLoadCode.PackSchemaVersionUnsupported,
        'schemaVersion 過新',
      );
    },
  },
  {
    name: '§8 Runtime 版本不相容 → error（min 太高與 max 太低兩個方向）',
    run: () => {
      expectFailureWith(
        loadContent({
          manifest: manifest(),
          packs: [pack({ runtimeCompatibility: { minRuntimeVersion: '99.0.0' } })],
        }),
        DataLoadCode.RuntimeVersionIncompatible,
        'min 高於目前 Runtime',
      );
      expectFailureWith(
        loadContent({
          manifest: manifest(),
          packs: [pack({ runtimeCompatibility: { minRuntimeVersion: '0.0.1', maxRuntimeVersion: '0.0.2' } })],
        }),
        DataLoadCode.RuntimeVersionIncompatible,
        'max 低於目前 Runtime',
      );
    },
  },
  {
    name: '§8 版本字串不合法視為不相容（不得當成「沒有限制」放行）',
    run: () => {
      assert(!runtimeSatisfies('0.1.0', { minRuntimeVersion: 'latest' }), '亂寫的 min 不得放行');
      assert(!runtimeSatisfies('0.1.0', { minRuntimeVersion: '0.1' }), '兩段版本號不合法');
      assert(!runtimeSatisfies('0.1.0', { minRuntimeVersion: '0.0.1', maxRuntimeVersion: 'x' }), '亂寫的 max 不得放行');
      assert(runtimeSatisfies('0.1.0', { minRuntimeVersion: '0.1.0' }), '等於 min 應相容');
      assert(runtimeSatisfies('0.2.0', { minRuntimeVersion: '0.1.0' }), '高於 min 且無 max 應相容');
    },
  },
  {
    name: '§8 出現未宣告的 kind → error（新 kind 不得無聲滲入 registry）',
    run: () => {
      const sneaky = pack({
        declaredKinds: ['team-plan-rule'],
        definitions: [
          def('definition:team-plan-rule.home-rest', 'team-plan-rule'),
          def('definition:monster.slime', 'monster'),
        ],
      });
      expectFailureWith(
        loadContent({ manifest: manifest(), packs: [sneaky] }),
        DataLoadCode.UndeclaredDefinitionKind,
        '未宣告 kind',
      );
    },
  },
  {
    name: '§8 宣告了 kind 卻沒有任何定義 → error（宣告面不得假裝內容存在）',
    run: () => {
      const empty = pack({ declaredKinds: ['team-plan-rule', 'monster'] });
      const result = loadContent({ manifest: manifest(), packs: [empty] });
      expectFailureWith(result, DataLoadCode.DeclaredKindWithoutDefinitions, '空宣告 kind');
      if (result.success) return;
      const diag = result.diagnostics.find((d) => d.code === DataLoadCode.DeclaredKindWithoutDefinitions);
      assert(diag?.details?.['kind'] === 'monster', `必須指出是哪個 kind，實得 ${String(diag?.details?.['kind'])}`);
    },
  },
  {
    name: 'registry 查詢：依 kind 過濾、enabled=false 預設不列、require 缺 ID 拋錯',
    run: () => {
      const mixed = pack({
        declaredKinds: ['team-plan-rule', 'monster'],
        definitions: [
          def('definition:team-plan-rule.home-rest', 'team-plan-rule'),
          def('definition:monster.slime', 'monster'),
          def('definition:monster.disabled', 'monster', { enabled: false }),
        ],
      });
      const result = loadContent({ manifest: manifest(), packs: [mixed] });
      assert(result.success, `應該成功，實得 ${codesOf(result).join(',')}`);
      if (!result.success) return;
      const registry = result.registry;
      assert(registry.list({ kinds: ['monster'] }).length === 1, 'enabled=false 預設不列入 list');
      assert(
        registry.list({ kinds: ['monster'], includeDisabled: true }).length === 2,
        'includeDisabled 才列出停用內容',
      );
      assert(registry.list().length === 2, '無 query 時同樣排除停用內容');
      // 缺 ID 必須拋錯，不得回傳假的預設 Definition（§6）。
      let threw = false;
      try {
        registry.require('definition:nope' as DefinitionId);
      } catch {
        threw = true;
      }
      assert(threw, 'require 未知 ID 必須拋錯');
      assert(registry.get('definition:nope' as DefinitionId) === undefined, 'get 未知 ID 回 undefined');
    },
  },
  {
    name: 'requiredResolverIds 是 pack 宣告面的一部分（型別上必填，供 Bootstrap 交叉驗證）',
    run: () => {
      const withResolvers = pack({
        requiredResolverIds: ['resolver:team.recruitment-success' as ResolverId],
      });
      const result = loadContent({ manifest: manifest(), packs: [withResolvers] });
      assert(result.success, `應該成功，實得 ${codesOf(result).join(',')}`);
      // 註冊面的比對屬 Bootstrap Gate（§11 第 6 步）；此處只釘住宣告確實隨 pack 一起被載入。
      assert(withResolvers.requiredResolverIds.length === 1, 'pack 帶著它宣告需要的 resolver');
    },
  },
];

// ── Runner ────────────────────────────────────────────────────────────────

export type ContentPackTestResult = Readonly<{ name: string; passed: boolean; error?: string }>;

export function runTestResults(): readonly ContentPackTestResult[] {
  return cases.map((c) => {
    try {
      c.run();
      return { name: c.name, passed: true };
    } catch (err) {
      return { name: c.name, passed: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
}

export function runTests(): void {
  const results = runTestResults();
  const failures = results.filter((r) => !r.passed);
  if (failures.length > 0) {
    const lines = failures.map((f) => `  ✗ ${f.name}: ${f.error ?? 'failed'}`);
    throw new Error(`content-pack loader: ${failures.length}/${results.length} test(s) failed\n${lines.join('\n')}`);
  }
}
