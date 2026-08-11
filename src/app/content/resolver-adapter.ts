// app/content/resolver-adapter.ts
// data-runtime ResolverRegistry 的通用呼叫膠水（reader-adapter.ts 的 resolver 版）。
//
// 模組的領域 ResolverPort（CombatResolverPort.resolvePower、TeamResolverPort.resolveRecruitmentSuccess…）
// 每個方法都橋接到「registry.require(resolverId).resolve(input, context)」。這裡提供兩件通用件：
//   - runResolver：查表 + 呼叫，回傳具型別的結果（含可能前進的 RNG cursor）。
//   - resolverContext：組出「能力受限」的 ResolverContext（definitions / queries / 成對 RNG）。
// 各模組的 port bridge 以這兩件為基礎，只需決定「哪個方法用哪個 resolverId、input 怎麼對應」。

import type { DeterministicRng, ResolverId, RngContext } from '../../contracts/core';
import type {
  ResolverContext,
  ResolverExecutionResult,
  ResolverRegistry,
} from '../../data-runtime';

// 查表並執行一個已註冊的 Resolver。未註冊 → registry.require 明確拋錯（不靜默回 undefined）。
export function runResolver<TResult>(
  registry: ResolverRegistry,
  resolverId: ResolverId,
  input: unknown,
  context: ResolverContext,
): ResolverExecutionResult<TResult> {
  return registry.require(resolverId).resolve(input as never, context) as ResolverExecutionResult<TResult>;
}

// 組出 ResolverContext。RNG 能力成對出現（§7）：要嘛都不給，要嘛 rng + rngContext 同時給。
export function resolverContext(
  parts: Readonly<{
    definitions?: object;
    queries?: object;
    rng?: DeterministicRng;
    rngContext?: RngContext;
  }>,
): ResolverContext {
  const base = { definitions: parts.definitions ?? {}, queries: parts.queries ?? {} };
  return parts.rng !== undefined && parts.rngContext !== undefined
    ? { ...base, rng: parts.rng, rngContext: parts.rngContext }
    : base;
}
