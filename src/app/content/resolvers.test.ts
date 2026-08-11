// app/content/resolvers.test.ts
// 證明 data-runtime → 資料調校 Resolver 的 adapter 路徑（reader 半邊的 resolver 對應物）：
//   1. logisticRollResolver：從 params 定義讀 LogisticCurveParams、以注入 RNG 擲骰、回傳 boolean +
//      nextRngCursor；決定性（同 context → 同結果）；bias=±1000 使機率夾成 1/0 得保證布林。
//   2. weightedProductResolver：讀 WeightedLinearProductParams、回傳數值（無 RNG，不回 cursor）。
//   3. 通用 runResolver 橋接 + registry.require 未註冊拋錯 + 重複註冊拋錯。
//   4. 模組 ResolverPort bridge 微樣板：一個「回傳 boolean」的 port 方法如何橋到 registry。

import type { ContentPackId, DefinitionId, ModuleId, ResolverId, RngContext } from '../../contracts/core';
import { deterministicRng } from '../../kernel';
import {
  createDefinitionRegistry,
  createResolverRegistry,
  type ContentDefinition,
  type ContentManifestIdentity,
  type LogisticCurveParams,
  type WeightedLinearProductParams,
} from '../../data-runtime';

import { narrowedDomainReader } from './reader-adapter';
import { runResolver, resolverContext } from './resolver-adapter';
import {
  logisticRollResolver,
  weightedProductResolver,
  RESOLVER_PARAMS_KINDS,
  type KernelResolverInput,
} from './resolvers';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const PACK = 'pack:resolvers-test' as ContentPackId;
const IDENTITY: ContentManifestIdentity = {
  manifestVersion: '0.0.0-test',
  manifestHash: 'test',
  packs: [{ packId: PACK, version: '0.0.0', hash: 'test' }],
};

function paramDef(id: string, kind: string, data: object): ContentDefinition {
  return {
    id: id as DefinitionId,
    kind,
    schemaVersion: 1,
    packId: PACK,
    enabled: true,
    sourcePath: `mem://${kind}/${id}`,
    data: data as ContentDefinition['data'],
  };
}

// params 定義（data 即對應 kernel 的 params 形狀）。
const ALWAYS_TRUE = 'definition:logistic-roll-params:always-true' as DefinitionId;
const ALWAYS_FALSE = 'definition:logistic-roll-params:always-false' as DefinitionId;
const SUM = 'definition:weighted-product-params:sum' as DefinitionId;

function definitionRegistry() {
  const alwaysTrue: LogisticCurveParams = { bias: 1000, terms: [] }; // 1/(1+e^-1000)=1.0 → 恆 true
  const alwaysFalse: LogisticCurveParams = { bias: -1000, terms: [] }; // 機率 0 → 恆 false
  const sum: WeightedLinearProductParams = {
    mode: 'linear',
    terms: [
      { weight: 1, inputKey: 'a' },
      { weight: 1, inputKey: 'b' },
    ],
  };
  return createDefinitionRegistry(
    [
      paramDef(ALWAYS_TRUE, RESOLVER_PARAMS_KINDS.logisticRoll, alwaysTrue),
      paramDef(ALWAYS_FALSE, RESOLVER_PARAMS_KINDS.logisticRoll, alwaysFalse),
      paramDef(SUM, RESOLVER_PARAMS_KINDS.weightedProduct, sum),
    ],
    IDENTITY,
  );
}

const ROLL_RESOLVER = 'resolver:test.logistic-roll' as ResolverId;
const PRODUCT_RESOLVER = 'resolver:test.weighted-product' as ResolverId;
const OWNER = 'team' as ModuleId;

function resolverRegistry() {
  return createResolverRegistry([
    logisticRollResolver(ROLL_RESOLVER, OWNER),
    weightedProductResolver(PRODUCT_RESOLVER, OWNER),
  ]);
}

function rngCtx(cursor = 0): RngContext {
  return { worldSeed: 'seed:resolver-test' as never, streamId: 'rng:test' as never, cursor: cursor as never };
}

// resolver 期望 ctx.definitions 是**窄化 Reader**（`.get` 回傳投影後、bias/terms 在頂層），不是原始
// Registry（其 `.get` 回 ContentDefinition，params 埋在 .data）。一個 reader 同時擁有兩種 param kind。
function paramsReader() {
  return narrowedDomainReader<LogisticCurveParams>(definitionRegistry(), 'reader:test.params', [
    RESOLVER_PARAMS_KINDS.logisticRoll,
    RESOLVER_PARAMS_KINDS.weightedProduct,
  ]);
}

export type ResolversTestResult = Readonly<{ name: string; pass: boolean; error?: string }>;

const CASES: readonly Readonly<{ name: string; run: () => void }>[] = [
  {
    name: 'logisticRollResolver：讀 params(bias=1000→機率1)→ 擲骰恆 true，且回傳 nextRngCursor',
    run: () => {
      const defs = paramsReader();
      const reg = resolverRegistry();
      const ctx = resolverContext({ definitions: defs, rng: deterministicRng, rngContext: rngCtx(0) });
      const input: KernelResolverInput = { paramsDefId: ALWAYS_TRUE, inputs: {} };
      const out = runResolver<boolean>(reg, ROLL_RESOLVER, input, ctx);
      assert(out.value === true, `bias=1000 應恆 true（實得 ${out.value}）`);
      assert(out.nextRngCursor === (1 as never), `roll 應前進 cursor 一格（實得 ${out.nextRngCursor}）`);
    },
  },
  {
    name: 'logisticRollResolver：bias=-1000→機率0→恆 false',
    run: () => {
      const out = runResolver<boolean>(
        resolverRegistry(),
        ROLL_RESOLVER,
        { paramsDefId: ALWAYS_FALSE, inputs: {} },
        resolverContext({ definitions: paramsReader(), rng: deterministicRng, rngContext: rngCtx(0) }),
      );
      assert(out.value === false, `bias=-1000 應恆 false（實得 ${out.value}）`);
    },
  },
  {
    name: '決定論：同 params + 同 rngContext → 同結果',
    run: () => {
      const defs = paramsReader();
      const reg = resolverRegistry();
      const call = () =>
        runResolver<boolean>(reg, ROLL_RESOLVER, { paramsDefId: ALWAYS_TRUE, inputs: {} },
          resolverContext({ definitions: defs, rng: deterministicRng, rngContext: rngCtx(7) }));
      const a = call();
      const b = call();
      assert(a.value === b.value && a.nextRngCursor === b.nextRngCursor, '同輸入應得同結果');
    },
  },
  {
    name: 'weightedProductResolver：linear(a+b) → 數值，無 nextRngCursor',
    run: () => {
      const out = runResolver<number>(
        resolverRegistry(),
        PRODUCT_RESOLVER,
        { paramsDefId: SUM, inputs: { a: 3, b: 4 } },
        resolverContext({ definitions: paramsReader() }), // 無 RNG
      );
      assert(out.value === 7, `linear a+b 應為 7（實得 ${out.value}）`);
      assert(out.nextRngCursor === undefined, '無 RNG 的 resolver 不應回 nextRngCursor');
    },
  },
  {
    name: 'runResolver：未註冊 resolverId 明確拋錯',
    run: () => {
      let threw = false;
      try {
        runResolver<number>(resolverRegistry(), 'resolver:test.absent' as ResolverId, {}, resolverContext({}));
      } catch {
        threw = true;
      }
      assert(threw, '未註冊 resolver 應由 registry.require 拋錯');
    },
  },
  {
    name: '重複註冊同 resolverId → 明確拋錯（不默默後蓋前）',
    run: () => {
      let threw = false;
      try {
        createResolverRegistry([
          logisticRollResolver(ROLL_RESOLVER, OWNER),
          logisticRollResolver(ROLL_RESOLVER, OWNER),
        ]);
      } catch {
        threw = true;
      }
      assert(threw, '重複 resolverId 應拋錯');
    },
  },
  {
    name: '模組 ResolverPort bridge 微樣板：boolean 方法橋到 registry（如 resolveRecruitmentSuccess）',
    run: () => {
      const defs = paramsReader();
      const reg = resolverRegistry();
      // 模擬一個模組 port 方法：外部只看到「輸入 → boolean」，cursor 於一次性 invocation stream 內丟棄。
      const resolveRecruitment = (currentFormalCount: number): boolean =>
        runResolver<boolean>(
          reg,
          ROLL_RESOLVER,
          { paramsDefId: ALWAYS_TRUE, inputs: { currentFormalCount } } satisfies KernelResolverInput,
          resolverContext({ definitions: defs, rng: deterministicRng, rngContext: rngCtx(0) }),
        ).value;
      assert(resolveRecruitment(2) === true, 'bridge 應回傳 resolver 的 boolean 結果');
    },
  },
];

export function runTestResults(): readonly ResolversTestResult[] {
  return CASES.map((c) => {
    try {
      c.run();
      return { name: c.name, pass: true };
    } catch (e) {
      return { name: c.name, pass: false, error: e instanceof Error ? e.message : String(e) };
    }
  });
}

export function runTests(): void {
  const results = runTestResults();
  const failed = results.filter((r) => !r.pass);
  if (failed.length > 0) {
    const lines = failed.map((r) => `  - ${r.name}: ${r.error ?? ''}`).join('\n');
    throw new Error(`resolvers tests failed (${failed.length}/${results.length}):\n${lines}`);
  }
}
