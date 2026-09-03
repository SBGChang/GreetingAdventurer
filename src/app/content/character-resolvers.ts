// app/content/character-resolvers.ts
// 世界冒險者生成的 Resolver shape（04_character_module.md §2.2）。
//
// 文件明文禁止 Character 自行假設 50／50 性別、固定年齡或跨文化共用原型——所以這四件事全部
// 交給 Resolver，而 Resolver 的可調量全部住在 params（Content Pack）。本檔只提供**形狀**：
//
//   * `character:weighted-choice`  一組加權選項裡抽一個（性別、原型）
//   * `character:integer-range`    一個閉區間裡抽一個整數（起始年齡，單位是**日**）
//   * `character:weighted-draw`    一組加權選項裡抽 N 個不重複（初始天賦）
//
// 三個 shape 都不含任何數字：權重、區間、抽幾個，全都從 params 讀。

import type { ResolverBinding, SchemaId } from '../../contracts/core';
import type {
  AnyResolverRegistration,
  ResolverContext,
  ResolverRegistration,
} from '../../data-runtime';

const CHOICE_INPUT_SCHEMA = 'schema:character-choice-input' as SchemaId;
const STRING_RESULT_SCHEMA = 'schema:string-result' as SchemaId;
const NUMBER_RESULT_SCHEMA = 'schema:number-result' as SchemaId;
const STRING_LIST_RESULT_SCHEMA = 'schema:string-list-result' as SchemaId;

// ── params 形狀 ────────────────────────────────────────────────────────────

export type WeightedOption = Readonly<{ value: string; weight: number }>;

export type WeightedChoiceParams = Readonly<{ options: readonly WeightedOption[] }>;
export type IntegerRangeParams = Readonly<{ min: number; max: number }>;
export type WeightedDrawParams = Readonly<{ count: number; options: readonly WeightedOption[] }>;

// Resolver 執行期讀 params 的窄門（由 character context 在呼叫時提供）。
export type CharacterGenerationDefinitions = Readonly<{
  getWeightedChoiceParams(id: string): WeightedChoiceParams;
  getIntegerRangeParams(id: string): IntegerRangeParams;
  getWeightedDrawParams(id: string): WeightedDrawParams;
}>;

// 呼叫端可以把選項**收窄**到一組候選（例如原型只能從生成規則的 allowedArchetypeIds 挑）。
// 候選在 params 裡沒有權重時明確拋錯：那代表內容宣告了一個沒人替它定權重的選項，
// 補一個預設權重會讓那筆遺漏永遠不被發現。
export type WeightedChoiceInput = Readonly<{ candidates?: readonly string[] }>;

function requireRng(ctx: ResolverContext): Readonly<{
  rng: NonNullable<ResolverContext['rng']>;
  rngContext: NonNullable<ResolverContext['rngContext']>;
}> {
  if (ctx.rng === undefined || ctx.rngContext === undefined) {
    throw new Error('character-resolvers：生成型 Resolver 需要 rng/rngContext，但 ResolverContext 沒有注入');
  }
  return { rng: ctx.rng, rngContext: ctx.rngContext };
}

function narrow(
  options: readonly WeightedOption[],
  candidates: readonly string[] | undefined,
  resolverId: string,
): readonly WeightedOption[] {
  if (candidates === undefined) return options;
  return candidates.map((value) => {
    const option = options.find((o) => o.value === value);
    if (option === undefined) {
      throw new Error(
        `character-resolvers：Resolver "${resolverId}" 的候選 "${value}" 在 params 裡沒有權重——` +
          `內容宣告了這個選項卻沒說它多常出現。`,
      );
    }
    return option;
  });
}

// 加權抽一個。以 [0, total) 的一次抽取落在累積區間裡——決定性、順序穩定（依 options 的宣告順序）。
function pickWeighted(
  options: readonly WeightedOption[],
  roll: number,
  resolverId: string,
): WeightedOption {
  const total = options.reduce((sum, o) => sum + Math.max(0, o.weight), 0);
  if (total <= 0) {
    throw new Error(
      `character-resolvers：Resolver "${resolverId}" 的選項權重總和為 ${total}——抽不出任何結果。`,
    );
  }
  let cursor = roll * total;
  for (const option of options) {
    cursor -= Math.max(0, option.weight);
    if (cursor < 0) return option;
  }
  // 浮點數誤差讓 cursor 剛好停在最後一格外緣時，取最後一個合法選項。
  const last = options[options.length - 1];
  if (last === undefined) {
    throw new Error(`character-resolvers：Resolver "${resolverId}" 沒有任何選項。`);
  }
  return last;
}

function weightedChoiceRegistration(
  binding: ResolverBinding,
): ResolverRegistration<WeightedChoiceInput, string> {
  const paramsDefId = requireParams(binding, 'character:weighted-choice', 'weighted-choice-params');
  return {
    resolverId: binding.resolverId,
    ownerModule: binding.ownerModule,
    inputSchemaId: CHOICE_INPUT_SCHEMA,
    resultSchemaId: STRING_RESULT_SCHEMA,
    resolve: (input, ctx) => {
      const defs = ctx.definitions as CharacterGenerationDefinitions;
      const params = defs.getWeightedChoiceParams(String(paramsDefId));
      const { rng, rngContext } = requireRng(ctx);
      const step = rng.nextFloat(rngContext);
      const options = narrow(params.options, input.candidates, String(binding.resolverId));
      return {
        value: pickWeighted(options, step.value, String(binding.resolverId)).value,
        nextRngCursor: step.nextCursor,
      };
    },
  };
}

function integerRangeRegistration(binding: ResolverBinding): ResolverRegistration<object, number> {
  const paramsDefId = requireParams(binding, 'character:integer-range', 'integer-range-params');
  return {
    resolverId: binding.resolverId,
    ownerModule: binding.ownerModule,
    inputSchemaId: CHOICE_INPUT_SCHEMA,
    resultSchemaId: NUMBER_RESULT_SCHEMA,
    resolve: (_input, ctx) => {
      const defs = ctx.definitions as CharacterGenerationDefinitions;
      const params = defs.getIntegerRangeParams(String(paramsDefId));
      if (params.max < params.min) {
        throw new Error(
          `character-resolvers：Resolver "${String(binding.resolverId)}" 的區間 [${params.min}, ${params.max}] 是空的。`,
        );
      }
      const { rng, rngContext } = requireRng(ctx);
      const step = rng.nextInt({ ...rngContext, minInclusive: params.min, maxInclusive: params.max });
      return { value: step.value, nextRngCursor: step.nextCursor };
    },
  };
}

function weightedDrawRegistration(
  binding: ResolverBinding,
): ResolverRegistration<object, readonly string[]> {
  const paramsDefId = requireParams(binding, 'character:weighted-draw', 'weighted-draw-params');
  return {
    resolverId: binding.resolverId,
    ownerModule: binding.ownerModule,
    inputSchemaId: CHOICE_INPUT_SCHEMA,
    resultSchemaId: STRING_LIST_RESULT_SCHEMA,
    resolve: (_input, ctx) => {
      const defs = ctx.definitions as CharacterGenerationDefinitions;
      const params = defs.getWeightedDrawParams(String(paramsDefId));
      const { rng, rngContext } = requireRng(ctx);
      // count 0（或選項為空）＝這份內容不給任何一筆。那是一句宣告，不是失敗。
      // 游標原樣回傳：一次都沒抽就不該前進，但**必須**回傳，否則呼叫端無從續接。
      if (params.count <= 0 || params.options.length === 0) {
        return { value: [], nextRngCursor: rngContext.cursor };
      }
      const drawn: string[] = [];
      let remaining = params.options;
      let cursor = rngContext.cursor;
      for (let i = 0; i < params.count && remaining.length > 0; i += 1) {
        const step = rng.nextFloat({ ...rngContext, cursor });
        const picked = pickWeighted(remaining, step.value, String(binding.resolverId));
        drawn.push(picked.value);
        remaining = remaining.filter((o) => o.value !== picked.value);
        cursor = step.nextCursor;
      }
      return { value: drawn, nextRngCursor: cursor };
    },
  };
}

function requireParams(binding: ResolverBinding, shape: string, kind: string): string {
  const paramsDefId = binding.paramsDefId;
  if (paramsDefId === undefined) {
    throw new Error(
      `${shape} 綁定缺 paramsDefId（Resolver ${String(binding.resolverId)}）——` +
        `可調量住在一筆 ${kind}，binding 必須指向它。`,
    );
  }
  return String(paramsDefId);
}

export const CHARACTER_GENERATION_SHAPE_BUILDERS: Readonly<
  Record<string, (binding: ResolverBinding) => AnyResolverRegistration>
> = {
  'character:weighted-choice': weightedChoiceRegistration,
  'character:integer-range': integerRangeRegistration,
  'character:weighted-draw': weightedDrawRegistration,
};
