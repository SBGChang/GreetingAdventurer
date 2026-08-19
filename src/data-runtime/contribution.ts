// data-runtime/contribution.ts
// §8 Schema Contribution：每個模組宣告「我擁有哪些 Definition kind、它們怎麼驗、我需要哪些 Resolver」。
// 對應 docs/00_core/architecture/13_data_runtime.md §8。
//
// 為什麼需要這一層（而不是各模組各自呼叫 runValidationPipeline）：
//
//   1. **所有權**（規範 §12）。一個 Definition kind 只能有一個擁有模組。沒有這一層，兩個模組可以
//      各自登記同一個 kind 的 validator，於是「這筆資料的規則是什麼」變成看誰先跑——而所有權
//      正是這份架構最不能含糊的東西。這裡直接把重複擁有變成啟動期錯誤。
//
//   2. **完整性**。`runValidationPipeline` 的 errorOnUnknownKind 會擋下「沒有 validator 的 kind」，
//      但那是資料出現時才發現。這裡在**註冊面**就比對：模組宣告擁有某個 kind，卻沒交出對應的
//      SchemaValidator，是註冊錯誤——否則那個 kind 的資料等於沒驗過就進 Registry。
//
//   3. **必要 Resolver 的匯總**。pack 宣告它用到哪些 Resolver（RawContentPack.requiredResolverIds），
//      模組宣告它的規則需要哪些 Resolver；Bootstrap Gate（§11 第 6 步）要拿兩邊與 ResolverRegistry
//      交叉比對。三份清單各自散落時沒有人能做這件事。
//
// 這個檔**不含任何內容值**：它只組裝與比對宣告，實際的欄位規則住在各模組的 validator 裡。

import type { DefinitionId, JsonValue, ModuleId, ResolverId } from '../contracts/core';
import type { ContentDefinition, JsonObject } from './content-pack';
import {
  diagnosticFor,
  type DataDiagnostic,
  type DataDiagnosticCode,
  type ReferenceRule,
  type RuleValidator,
  type SchemaValidator,
} from './validation';

// ── §8 ModuleDataContribution ─────────────────────────────────────────────

export type ModuleDataContribution = Readonly<{
  moduleId: ModuleId;
  // 本模組擁有的 Definition kind。權威來源：必須與 pack 的 declaredKinds 對得上。
  ownedKinds: readonly string[];
  // 每個 ownedKind 恰好一個 SchemaValidator（缺少即註冊錯誤）。
  definitionSchemas: readonly SchemaValidator[];
  // 本模組資料的對外引用規則（Pass 2）。
  referenceRules: readonly ReferenceRule[];
  // 跨檔硬規則（Pass 3）。
  ruleValidators: readonly RuleValidator[];
  // 本模組的規則資料會引用到的 Resolver。
  requiredResolverIds: readonly ResolverId[];
}>;

export type CollectedContributions = Readonly<{
  schemaValidators: readonly SchemaValidator[];
  referenceRules: readonly ReferenceRule[];
  ruleValidators: readonly RuleValidator[];
  // kind → 擁有模組。Bootstrap 用它比對 pack.declaredKinds 是否都有主人。
  ownerByKind: Readonly<Record<string, ModuleId>>;
  requiredResolverIds: readonly ResolverId[];
}>;

export const ContributionCode = {
  DuplicateKindOwner: 'data.contribution.duplicateKindOwner',
  MissingSchemaForOwnedKind: 'data.contribution.missingSchemaForOwnedKind',
  SchemaForUnownedKind: 'data.contribution.schemaForUnownedKind',
} as const;

export type ContributionError = Readonly<{
  code: DataDiagnosticCode;
  moduleId: ModuleId;
  kind: string;
  details?: Readonly<Record<string, JsonValue>>;
}>;

export type CollectContributionsResult =
  | Readonly<{ ok: true; collected: CollectedContributions }>
  | Readonly<{ ok: false; errors: readonly ContributionError[] }>;

// 組裝全部模組的貢獻。註冊面不一致一律回 errors——不得挑能用的部分繼續。
export function collectContributions(
  contributions: readonly ModuleDataContribution[],
): CollectContributionsResult {
  const errors: ContributionError[] = [];
  const ownerByKind: Record<string, ModuleId> = {};

  // 1) 一個 kind 只能一個擁有模組（§12）。
  for (const c of contributions) {
    for (const kind of c.ownedKinds) {
      const existing = ownerByKind[kind];
      if (existing !== undefined) {
        errors.push({
          code: ContributionCode.DuplicateKindOwner,
          moduleId: c.moduleId,
          kind,
          details: { firstOwner: String(existing), secondOwner: String(c.moduleId) },
        });
        continue;
      }
      ownerByKind[kind] = c.moduleId;
    }
  }

  // 2) 每個 ownedKind 必須有 SchemaValidator；validator 也不得驗自己不擁有的 kind。
  for (const c of contributions) {
    const schemaKinds = new Set(c.definitionSchemas.map((v) => v.kind));
    for (const kind of c.ownedKinds) {
      if (schemaKinds.has(kind)) continue;
      errors.push({
        code: ContributionCode.MissingSchemaForOwnedKind,
        moduleId: c.moduleId,
        kind,
      });
    }
    for (const kind of schemaKinds) {
      if (c.ownedKinds.includes(kind)) continue;
      // 這個 kind 的真正擁有者（若有）是有用的線索，但「沒有擁有者」與「擁有者是某模組」是
      // 兩件不同的事，不能用一個假字串把它們併成一種。缺就不放這個欄位。
      const declaredOwner = ownerByKind[kind];
      errors.push({
        code: ContributionCode.SchemaForUnownedKind,
        moduleId: c.moduleId,
        kind,
        ...(declaredOwner === undefined ? {} : { details: { declaredOwner: String(declaredOwner) } }),
      });
    }
  }

  if (errors.length > 0) return { ok: false, errors };

  const requiredResolverIds = [
    ...new Set(contributions.flatMap((c) => c.requiredResolverIds.map((r) => String(r)))),
  ].map((r) => r as ResolverId);

  return {
    ok: true,
    collected: {
      schemaValidators: contributions.flatMap((c) => [...c.definitionSchemas]),
      referenceRules: contributions.flatMap((c) => [...c.referenceRules]),
      ruleValidators: contributions.flatMap((c) => [...c.ruleValidators]),
      ownerByKind,
      requiredResolverIds,
    },
  };
}

// ── 欄位檢查組件 ───────────────────────────────────────────────────────────
//
// 57 個 kind 各寫一套「讀欄位 + 判型別 + 造 diagnostic」會產生 57 種錯誤格式，而且每一份都有機會
// 順手寫成「缺欄位就給個預設值」。這組 helper 讓合法寫法只有一種：**讀不到就回 undefined 並留下
// 一筆可定位的 diagnostic**，呼叫端拿 undefined 只能放棄該筆，不可能就地補值。
//
// 這裡的邊界檢查（例如 durationDays 必須是正整數）是**結構有效性**，不是平衡：天數為 0 或負數不是
// 「另一種平衡」而是不成立的資料。validator 不得寫下任何具體平衡值（例如「必須是 365」）。

export type FieldChecker = Readonly<{
  string(field: string): string | undefined;
  finiteNumber(field: string): number | undefined;
  integer(field: string, bounds?: Readonly<{ min?: number; max?: number }>): number | undefined;
  boolean(field: string): boolean | undefined;
  object(field: string): JsonObject | undefined;
  array(field: string): readonly JsonValue[] | undefined;
  stringArray(field: string): readonly string[] | undefined;
  oneOf<T extends string>(field: string, allowed: readonly T[]): T | undefined;
  // Definition 引用：只確認它是字串並轉成 DefinitionId；存在性與 kind 由 Pass 2 的 ReferenceRule 驗。
  definitionRef(field: string): DefinitionId | undefined;
  optional<T>(read: () => T | undefined): T | undefined;
  diagnostics(): readonly DataDiagnostic[];
}>;

function isJsonArray(value: JsonValue): value is readonly JsonValue[] {
  return Array.isArray(value);
}

function isJsonObject(value: JsonValue): value is JsonObject {
  return typeof value === 'object' && value !== null && !isJsonArray(value);
}

export function fieldChecker(
  def: Readonly<ContentDefinition>,
  code: DataDiagnosticCode,
): FieldChecker {
  const out: DataDiagnostic[] = [];
  // optional() 期間暫存 diagnostics：選填欄位「不存在」不該留下錯誤，但「存在卻型別錯」要留。
  let suppressMissing = false;

  const fail = (field: string, messageKey: string, details?: Readonly<Record<string, JsonValue>>): undefined => {
    out.push({ ...diagnosticFor(def, { severity: 'error', code, messageKey, fieldPath: field, details }) });
    return undefined;
  };

  const read = (field: string): JsonValue | undefined => {
    const value = def.data[field];
    if (value === undefined && !suppressMissing) {
      return fail(field, 'data.schema.missingField');
    }
    return value;
  };

  const checker: FieldChecker = {
    string: (field) => {
      const value = read(field);
      if (value === undefined) return undefined;
      if (typeof value !== 'string') return fail(field, 'data.schema.expectedString', { actual: typeof value });
      if (value.length === 0) return fail(field, 'data.schema.expectedNonEmptyString');
      return value;
    },
    finiteNumber: (field) => {
      const value = read(field);
      if (value === undefined) return undefined;
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        return fail(field, 'data.schema.expectedFiniteNumber', { actual: typeof value });
      }
      return value;
    },
    integer: (field, bounds) => {
      const value = checker.finiteNumber(field);
      if (value === undefined) return undefined;
      if (!Number.isInteger(value)) return fail(field, 'data.schema.expectedInteger', { actual: value });
      if (bounds?.min !== undefined && value < bounds.min) {
        return fail(field, 'data.schema.belowMinimum', { actual: value, minimum: bounds.min });
      }
      if (bounds?.max !== undefined && value > bounds.max) {
        return fail(field, 'data.schema.aboveMaximum', { actual: value, maximum: bounds.max });
      }
      return value;
    },
    boolean: (field) => {
      const value = read(field);
      if (value === undefined) return undefined;
      if (typeof value !== 'boolean') return fail(field, 'data.schema.expectedBoolean', { actual: typeof value });
      return value;
    },
    object: (field) => {
      const value = read(field);
      if (value === undefined) return undefined;
      if (!isJsonObject(value)) return fail(field, 'data.schema.expectedObject', { actual: typeof value });
      return value;
    },
    array: (field) => {
      const value = read(field);
      if (value === undefined) return undefined;
      if (!isJsonArray(value)) return fail(field, 'data.schema.expectedArray', { actual: typeof value });
      return value;
    },
    stringArray: (field) => {
      const value = checker.array(field);
      if (value === undefined) return undefined;
      const bad = value.findIndex((entry) => typeof entry !== 'string');
      if (bad >= 0) return fail(`${field}[${bad}]`, 'data.schema.expectedString');
      return value.filter((entry): entry is string => typeof entry === 'string');
    },
    oneOf: <T extends string>(field: string, allowed: readonly T[]): T | undefined => {
      const value = checker.string(field);
      if (value === undefined) return undefined;
      const hit = allowed.find((a) => a === value);
      if (hit === undefined) {
        return fail(field, 'data.schema.notInAllowedSet', { actual: value, allowed: [...allowed] });
      }
      return hit;
    },
    definitionRef: (field) => {
      const value = checker.string(field);
      if (value === undefined) return undefined;
      return value as DefinitionId;
    },
    // 選填欄位：欄位不存在不報錯（回 undefined），存在但型別錯仍照報。
    optional: <T,>(readValue: () => T | undefined): T | undefined => {
      const previous = suppressMissing;
      suppressMissing = true;
      try {
        return readValue();
      } finally {
        suppressMissing = previous;
      }
    },
    diagnostics: () => out,
  };

  return checker;
}
