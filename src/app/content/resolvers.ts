// app/content/resolvers.ts
// 資料調校 Resolver 的樣板（§7.1「data-tuned kernel」：公式=程式形狀 + Data 調校）。
//
// 一個 Resolver 服務多組 params：resolve() 依 input.paramsDefId 從 ctx.definitions 讀該筆定義的
// 調校量（bias/terms/weights…），把 input.inputs 當 KernelInputs 餵給 §7.1 kernel，回傳結果。
// 用 RNG 者（roll）遵守 §7 紀律：以注入的 rng + rngContext 顯式擲骰，並回傳最終 nextRngCursor。
//
// 這是所有真 Resolver 的樣板。真內容落地時：params 定義以 kind='<x>-params' 標注，一個 domain
// resolver（招募/傷害/自然死亡…）多半就是「挑一個 kernel + 指定 paramsDefId 來源」的薄包裝。

import type { DefinitionId, ModuleId, ResolverId, SchemaId } from '../../contracts/core';
import {
  logisticRoll,
  weightedLinearProduct,
  type DefinitionReader,
  type KernelInputs,
  type LogisticCurveParams,
  type ResolverContext,
  type ResolverRegistration,
  type WeightedLinearProductParams,
} from '../../data-runtime';

// 通用 kernel-resolver 的輸入：指向 params 定義 + 該次的 KernelInputs（結構性輸入，非調校量）。
export type KernelResolverInput = Readonly<{
  paramsDefId: DefinitionId;
  inputs: KernelInputs;
}>;

// params 定義以 kind 標注；一個 kind 家族的 data 即對應 kernel 的 params 形狀。
export const RESOLVER_PARAMS_KINDS = {
  logisticRoll: 'logistic-roll-params',
  weightedProduct: 'weighted-product-params',
} as const;

// 占位 Schema ID（binding 驗證用；真內容軌會給正式 schema）。
const KERNEL_INPUT_SCHEMA = 'schema:kernel-resolver-input' as SchemaId;
const BOOLEAN_RESULT_SCHEMA = 'schema:boolean-result' as SchemaId;
const NUMBER_RESULT_SCHEMA = 'schema:number-result' as SchemaId;

function requireRng(ctx: ResolverContext): { rng: NonNullable<ResolverContext['rng']>; rngContext: NonNullable<ResolverContext['rngContext']> } {
  if (ctx.rng === undefined || ctx.rngContext === undefined) {
    throw new Error('resolver: 此 Resolver 需要 RNG 能力，但 ResolverContext 未注入 rng/rngContext');
  }
  return { rng: ctx.rng, rngContext: ctx.rngContext };
}

// ── logistic roll（→ boolean）：招募/留隊/觸發類擲骰的樣板 ────────────────────
// params 定義的 data = LogisticCurveParams（bias + terms）。回傳 value + nextRngCursor。
export function logisticRollResolver(
  resolverId: ResolverId,
  ownerModule: ModuleId,
): ResolverRegistration<KernelResolverInput, boolean> {
  return {
    resolverId,
    ownerModule,
    inputSchemaId: KERNEL_INPUT_SCHEMA,
    resultSchemaId: BOOLEAN_RESULT_SCHEMA,
    resolve: (input, ctx) => {
      const params = (ctx.definitions as DefinitionReader<LogisticCurveParams>).get(input.paramsDefId);
      const { rng, rngContext } = requireRng(ctx);
      const step = logisticRoll(params, input.inputs, rng, rngContext);
      return { value: step.value, nextRngCursor: step.nextCursor };
    },
  };
}

// ── weighted product（→ number，無 RNG）：戰鬥力/傷害/治療類數值的樣板 ─────────
// params 定義的 data = WeightedLinearProductParams。純數值，不回傳 cursor。
export function weightedProductResolver(
  resolverId: ResolverId,
  ownerModule: ModuleId,
): ResolverRegistration<KernelResolverInput, number> {
  return {
    resolverId,
    ownerModule,
    inputSchemaId: KERNEL_INPUT_SCHEMA,
    resultSchemaId: NUMBER_RESULT_SCHEMA,
    resolve: (input, ctx) => {
      const params = (ctx.definitions as DefinitionReader<WeightedLinearProductParams>).get(
        input.paramsDefId,
      );
      return { value: weightedLinearProduct(params, input.inputs) };
    },
  };
}
