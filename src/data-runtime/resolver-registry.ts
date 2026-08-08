// data-runtime/resolver-registry.ts
// Resolver Registry（§7，硬化後版）。
//
// 某些規則需要程式實作，但資料只能引用穩定 Resolver ID。
// ResolverContext 是「能力受限的唯讀 Context」：不暴露完整 EngineContext／GameState，
// 只給宣告過的窄化 Definition View、Query Port，以及「成對出現」的無狀態 RNG／RngContext。
// Resolver 不得把 cursor 藏在 closure 或 RNG 物件內；RNG 一律以顯式 cursor 串接，
// 並在結果回傳最終 nextRngCursor。

import type {
  DeterministicRng,
  ModuleId,
  ResolverId,
  RngContext,
  RngCursor,
  SchemaId,
} from '../contracts/core';
import type { DataDiagnostic } from './validation';

// ── 執行結果 ────────────────────────────────────────────────────────────────

export type ResolverExecutionResult<TResult> = Readonly<{
  value: TResult;
  // 只有使用 RNG 的 Resolver 才回傳；必須是 context.rngContext 對應的最終 cursor。
  nextRngCursor?: RngCursor;
}>;

// ── 能力受限 Context ────────────────────────────────────────────────────────

// RNG 能力成對出現：要嘛兩者皆無，要嘛 rng 與 rngContext 同時注入。
export type ResolverRngCapability =
  | Readonly<{ rng?: never; rngContext?: never }>
  | Readonly<{
      rng: DeterministicRng; // 無狀態取值基元
      rngContext: RngContext; // cursor 由呼叫者擁有，成功提交後才寫回
    }>;

export type ResolverContext<
  TDefinitions extends object = object,
  TQueries extends object = object,
> = Readonly<{
  readonly definitions: TDefinitions; // 只注入該 Resolver 宣告需要的窄化 Definition View
  readonly queries: TQueries; // 只注入宣告需要的 Query Port
}> &
  ResolverRngCapability;

// ── 登記契約 ────────────────────────────────────────────────────────────────

export type ResolverRegistration<TInput, TResult> = Readonly<{
  resolverId: ResolverId;
  ownerModule: ModuleId;
  inputSchemaId: SchemaId;
  resultSchemaId: SchemaId;
  resolve(
    input: Readonly<TInput>,
    context: ResolverContext,
  ): ResolverExecutionResult<TResult>;
}>;

export type AnyResolverRegistration = ResolverRegistration<unknown, unknown>;

// ── Registry ────────────────────────────────────────────────────────────────

export interface ResolverRegistry {
  register(registration: AnyResolverRegistration): void;
  has(id: ResolverId): boolean;
  get(id: ResolverId): AnyResolverRegistration | undefined;
  require(id: ResolverId): AnyResolverRegistration;
  list(): readonly AnyResolverRegistration[];
}

class ResolverRegistryImpl implements ResolverRegistry {
  private readonly byId = new Map<ResolverId, AnyResolverRegistration>();

  register(registration: AnyResolverRegistration): void {
    if (this.byId.has(registration.resolverId)) {
      // 不得默默後蓋前（比照 Definition ID 規則）。
      throw new Error(`ResolverRegistry: duplicate resolverId "${registration.resolverId}"`);
    }
    this.byId.set(registration.resolverId, registration);
  }

  has(id: ResolverId): boolean {
    return this.byId.has(id);
  }

  get(id: ResolverId): AnyResolverRegistration | undefined {
    return this.byId.get(id);
  }

  require(id: ResolverId): AnyResolverRegistration {
    const found = this.byId.get(id);
    if (found === undefined) {
      throw new Error(`ResolverRegistry: resolver "${id}" is not registered`);
    }
    return found;
  }

  list(): readonly AnyResolverRegistration[] {
    return [...this.byId.values()];
  }
}

export function createResolverRegistry(
  registrations: readonly AnyResolverRegistration[] = [],
): ResolverRegistry {
  const registry = new ResolverRegistryImpl();
  for (const r of registrations) registry.register(r);
  return registry;
}

// ── 編譯期綁定驗證（§7 末：所有 Resolver ID 已註冊，且 owner／input schema 相符）──

export type ResolverBindingCheck = Readonly<{
  resolverId: ResolverId;
  // 定位資訊，讓 diagnostic 可回指到引用該 Resolver 的規則 Definition。
  packId: DataDiagnostic['packId'];
  filePath: string;
  definitionId?: DataDiagnostic['definitionId'];
  fieldPath?: string;
  expectedOwner?: ModuleId;
  expectedInputSchemaId?: SchemaId;
  expectedResultSchemaId?: SchemaId;
}>;

export const ResolverBindingCode = {
  Unregistered: 'data.resolver.unregistered',
  OwnerMismatch: 'data.resolver.ownerMismatch',
  InputSchemaMismatch: 'data.resolver.inputSchemaMismatch',
  ResultSchemaMismatch: 'data.resolver.resultSchemaMismatch',
} as const;

export function validateResolverBinding(
  registry: ResolverRegistry,
  check: ResolverBindingCheck,
): DataDiagnostic[] {
  const out: DataDiagnostic[] = [];
  const reg = registry.get(check.resolverId);
  const base = {
    packId: check.packId,
    filePath: check.filePath,
    definitionId: check.definitionId,
    fieldPath: check.fieldPath,
  } as const;

  if (reg === undefined) {
    out.push({
      severity: 'error',
      code: ResolverBindingCode.Unregistered,
      ...base,
      messageKey: 'data.resolver.unregistered',
      details: { resolverId: check.resolverId },
    });
    return out;
  }
  if (check.expectedOwner !== undefined && reg.ownerModule !== check.expectedOwner) {
    out.push({
      severity: 'error',
      code: ResolverBindingCode.OwnerMismatch,
      ...base,
      messageKey: 'data.resolver.ownerMismatch',
      details: { resolverId: check.resolverId, expected: check.expectedOwner, actual: reg.ownerModule },
    });
  }
  if (check.expectedInputSchemaId !== undefined && reg.inputSchemaId !== check.expectedInputSchemaId) {
    out.push({
      severity: 'error',
      code: ResolverBindingCode.InputSchemaMismatch,
      ...base,
      messageKey: 'data.resolver.inputSchemaMismatch',
      details: { resolverId: check.resolverId, expected: check.expectedInputSchemaId, actual: reg.inputSchemaId },
    });
  }
  if (check.expectedResultSchemaId !== undefined && reg.resultSchemaId !== check.expectedResultSchemaId) {
    out.push({
      severity: 'error',
      code: ResolverBindingCode.ResultSchemaMismatch,
      ...base,
      messageKey: 'data.resolver.resultSchemaMismatch',
      details: { resolverId: check.resolverId, expected: check.expectedResultSchemaId, actual: reg.resultSchemaId },
    });
  }
  return out;
}
