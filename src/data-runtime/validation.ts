// data-runtime/validation.ts
// 三段驗證管線骨架：Schema → Reference → Rule。
// 對應 docs/00_core/architecture/13_data_runtime.md §3、§4、§7.1（三條紀律）。
//
// 原則：
//  - 只回報「可定位」的 diagnostics（Pack／檔案／Definition／欄位）。
//  - 永不靜默替換或刪除資料（§9）。管線是純函式，不 mutate registry。
//  - 三段各自蒐集 diagnostics；即使前段已有 error 也照跑，回傳完整報告。
//  - 存在任一 severity='error' 即 ok=false。

import type {
  ContentPackId,
  DefinitionId,
  JsonValue,
} from '../contracts/core';
import type { ContentDefinition, DefinitionRegistry } from './content-pack';

// ── Diagnostic（§4）─────────────────────────────────────────────────────────

export type DataDiagnosticSeverity = 'error' | 'warning';
export type DataDiagnosticCode = string;

export type DataDiagnostic = Readonly<{
  severity: DataDiagnosticSeverity;
  code: DataDiagnosticCode;
  packId: ContentPackId;
  filePath: string;
  definitionId?: DefinitionId;
  fieldPath?: string;
  messageKey: string;
  details?: Readonly<Record<string, JsonValue>>;
}>;

// diagnostic 建構輔助：自動帶入 def 的 pack／檔案／id 定位資訊。
export function diagnosticFor(
  def: Readonly<ContentDefinition>,
  init: Readonly<{
    severity: DataDiagnosticSeverity;
    code: DataDiagnosticCode;
    messageKey: string;
    fieldPath?: string;
    details?: Readonly<Record<string, JsonValue>>;
  }>,
): DataDiagnostic {
  return {
    severity: init.severity,
    code: init.code,
    packId: def.packId,
    filePath: def.sourcePath,
    definitionId: def.id,
    fieldPath: init.fieldPath,
    messageKey: init.messageKey,
    details: init.details,
  };
}

// ── Pass 1：Schema 驗證 ─────────────────────────────────────────────────────
// 每個 kind 由其擁有模組貢獻一個 validator（§8 ModuleDataContribution.definitionSchemas）。
// 引擎依 def.kind 派發；未登記 kind 由 unknownKindDiagnostic 標記。

export type SchemaValidationContext = Readonly<{
  registry: DefinitionRegistry;
}>;

export type SchemaValidator = Readonly<{
  // 此 validator 負責的 definition kind。
  kind: string;
  validate(
    def: Readonly<ContentDefinition>,
    ctx: SchemaValidationContext,
  ): readonly DataDiagnostic[];
}>;

// ── Pass 2：Reference 驗證 ──────────────────────────────────────────────────
// 「所有被引用的 ID 必須存在，且 kind 相符」（§3.2）。

export type ReferenceValidationContext = Readonly<{
  registry: DefinitionRegistry;
  has(id: DefinitionId): boolean;
  kindOf(id: DefinitionId): string | undefined;
}>;

export type ReferenceRule = Readonly<{
  code: DataDiagnosticCode;
  // 針對每筆（已啟用）definition 檢查其對外引用。
  validate(
    def: Readonly<ContentDefinition>,
    ctx: ReferenceValidationContext,
  ): readonly DataDiagnostic[];
}>;

// 可重用輔助：檢查某引用 ID 是否存在且 kind 落在允許集合內。
export function checkReference(
  def: Readonly<ContentDefinition>,
  ctx: ReferenceValidationContext,
  args: Readonly<{
    fieldPath: string;
    referencedId: DefinitionId | undefined;
    allowedKinds?: readonly string[];
    code: DataDiagnosticCode;
    required?: boolean;
  }>,
): DataDiagnostic[] {
  const out: DataDiagnostic[] = [];
  if (args.referencedId === undefined) {
    if (args.required === true) {
      out.push(
        diagnosticFor(def, {
          severity: 'error',
          code: args.code,
          messageKey: 'data.ref.missingRequired',
          fieldPath: args.fieldPath,
        }),
      );
    }
    return out;
  }
  if (!ctx.has(args.referencedId)) {
    out.push(
      diagnosticFor(def, {
        severity: 'error',
        code: args.code,
        messageKey: 'data.ref.unknownId',
        fieldPath: args.fieldPath,
        details: { referencedId: args.referencedId },
      }),
    );
    return out;
  }
  if (args.allowedKinds !== undefined) {
    const actual = ctx.kindOf(args.referencedId);
    if (actual === undefined || !args.allowedKinds.includes(actual)) {
      out.push(
        diagnosticFor(def, {
          severity: 'error',
          code: args.code,
          messageKey: 'data.ref.kindMismatch',
          fieldPath: args.fieldPath,
          details: {
            referencedId: args.referencedId,
            expectedKinds: [...args.allowedKinds],
            actualKind: actual ?? null,
          },
        }),
      );
    }
  }
  return out;
}

// ── Pass 3：Rule 驗證 ───────────────────────────────────────────────────────
// 跨檔硬規則（§3.3）與 §7.1 三條紀律。以整個 registry 為輸入，不限單筆 definition。

export type RuleValidationContext = Readonly<{
  registry: DefinitionRegistry;
  has(id: DefinitionId): boolean;
  kindOf(id: DefinitionId): string | undefined;
}>;

export type RuleValidator = Readonly<{
  code: DataDiagnosticCode;
  validate(ctx: RuleValidationContext): readonly DataDiagnostic[];
}>;

// ── 管線 ────────────────────────────────────────────────────────────────────

export type ValidationInput = Readonly<{
  registry: DefinitionRegistry;
  schemaValidators?: readonly SchemaValidator[];
  referenceRules?: readonly ReferenceRule[];
  ruleValidators?: readonly RuleValidator[];
  // 未登記 schema 的 kind 是否視為 error（預設 true：Schema 必須明確登記）。
  errorOnUnknownKind?: boolean;
}>;

export type ValidationReport = Readonly<{
  ok: boolean;
  diagnostics: readonly DataDiagnostic[];
  errorCount: number;
  warningCount: number;
}>;

const UNKNOWN_KIND_CODE = 'data.schema.unknownKind';

export function runValidationPipeline(input: ValidationInput): ValidationReport {
  const registry = input.registry;
  const schemaValidators = input.schemaValidators ?? [];
  const referenceRules = input.referenceRules ?? [];
  const ruleValidators = input.ruleValidators ?? [];
  const errorOnUnknownKind = input.errorOnUnknownKind ?? true;

  const diagnostics: DataDiagnostic[] = [];

  const schemaByKind = new Map<string, SchemaValidator>();
  for (const v of schemaValidators) schemaByKind.set(v.kind, v);

  const allDefs = registry.list({ includeDisabled: true });

  // Pass 1：Schema
  const schemaCtx: SchemaValidationContext = { registry };
  for (const def of allDefs) {
    const validator = schemaByKind.get(def.kind);
    if (validator === undefined) {
      if (errorOnUnknownKind) {
        diagnostics.push(
          diagnosticFor(def, {
            severity: 'error',
            code: UNKNOWN_KIND_CODE,
            messageKey: 'data.schema.unknownKind',
            fieldPath: 'kind',
            details: { kind: def.kind },
          }),
        );
      }
      continue;
    }
    for (const d of validator.validate(def, schemaCtx)) diagnostics.push(d);
  }

  // Pass 2：Reference（只檢查啟用內容；停用內容由 warning 另處理）
  const refCtx: ReferenceValidationContext = {
    registry,
    has: (id) => registry.has(id),
    kindOf: (id) => registry.kindOf(id),
  };
  for (const def of allDefs) {
    if (!def.enabled) continue;
    for (const rule of referenceRules) {
      for (const d of rule.validate(def, refCtx)) diagnostics.push(d);
    }
  }

  // Pass 3：Rule（跨檔）
  const ruleCtx: RuleValidationContext = {
    registry,
    has: (id) => registry.has(id),
    kindOf: (id) => registry.kindOf(id),
  };
  for (const rule of ruleValidators) {
    for (const d of rule.validate(ruleCtx)) diagnostics.push(d);
  }

  let errorCount = 0;
  let warningCount = 0;
  for (const d of diagnostics) {
    if (d.severity === 'error') errorCount += 1;
    else warningCount += 1;
  }

  return {
    ok: errorCount === 0,
    diagnostics,
    errorCount,
    warningCount,
  };
}
