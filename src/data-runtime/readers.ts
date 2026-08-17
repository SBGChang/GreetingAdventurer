// data-runtime/readers.ts
// 窄化 DefinitionReader Factory（§5）。
//
// 完整 Registry 只存在 Data Runtime／Composition；領域模組只能收到窄化 Reader，
// 每個 Reader 依 DefinitionReaderId 只看得到「它擁有的 kind」。
// 模組不得使用泛型 getAnyDefinition()：Reader 對非擁有 kind 一律當作不存在。
//
// 同一原始 Definition 可被不同 Reader 以不同 mapView 編譯成不同 View（例如 Skill 的
// Progression／Combat View），但共享同一 Definition ID 與版本來源，不複製作者資料。

import type { ContentPackId, DefinitionId, DefinitionReaderId } from '../contracts/core';
import type { ContentDefinition, DefinitionRegistry } from './content-pack';

export type ReaderQuery = Readonly<{
  packId?: ContentPackId;
  includeDisabled?: boolean;
}>;

// 窄化 Reader：kinds 固定由 ownedKinds 決定，模組無法擴大可見範圍。
export interface DefinitionReader<TView = Readonly<ContentDefinition>> {
  readonly readerId: DefinitionReaderId;
  readonly ownedKinds: readonly string[];
  has(id: DefinitionId): boolean;
  tryGet(id: DefinitionId): TView | undefined;
  get(id: DefinitionId): TView;
  list(query?: ReaderQuery): readonly TView[];
}

// View 編譯器：把唯讀 ContentDefinition 投影為模組 View。預設為 identity。
export type DefinitionViewMapper<TView> = (def: Readonly<ContentDefinition>) => TView;

export type DefinitionReaderSpec<TView = Readonly<ContentDefinition>> = Readonly<{
  readerId: DefinitionReaderId;
  ownedKinds: readonly string[];
  // 必填。曾經選填，缺省時以 `def as unknown as TView` 恆等投影帶過——但那個恆等只有在
  // TView 真的是 ContentDefinition 時才成立，而型別系統攔不住 `createDefinitionReader<SomeView>`
  // 忘記給投影：讀出來的東西會頂著 SomeView 的型別、實際上是原始 Definition，錯誤要到欄位讀成
  // undefined 才浮現。改成必填後那個轉型沒有存在理由。不做投影的呼叫端傳 identityDefinitionView。
  mapView: DefinitionViewMapper<TView>;
}>;

// TView = Readonly<ContentDefinition> 時的投影。型別上就是恆等函式，不需要任何轉型。
export const identityDefinitionView: DefinitionViewMapper<Readonly<ContentDefinition>> = (def) => def;

class NarrowedReader<TView> implements DefinitionReader<TView> {
  readonly readerId: DefinitionReaderId;
  readonly ownedKinds: readonly string[];
  private readonly registry: DefinitionRegistry;
  private readonly ownedSet: ReadonlySet<string>;
  private readonly mapView: DefinitionViewMapper<TView>;

  constructor(registry: DefinitionRegistry, spec: DefinitionReaderSpec<TView>) {
    this.registry = registry;
    this.readerId = spec.readerId;
    this.ownedKinds = [...spec.ownedKinds];
    this.ownedSet = new Set(spec.ownedKinds);
    this.mapView = spec.mapView;
  }

  private owns(def: Readonly<ContentDefinition> | undefined): def is Readonly<ContentDefinition> {
    return def !== undefined && this.ownedSet.has(def.kind);
  }

  has(id: DefinitionId): boolean {
    return this.owns(this.registry.get(id));
  }

  tryGet(id: DefinitionId): TView | undefined {
    const def = this.registry.get(id);
    if (!this.owns(def)) return undefined;
    return this.mapView(def);
  }

  get(id: DefinitionId): TView {
    const def = this.registry.get(id);
    if (def === undefined) {
      throw new Error(`DefinitionReader "${this.readerId}": unknown definition id "${id}"`);
    }
    if (!this.ownedSet.has(def.kind)) {
      // 明確拒絕跨 kind 存取，避免模組繞過所有權邊界。
      throw new Error(
        `DefinitionReader "${this.readerId}": definition "${id}" (kind="${def.kind}") is not owned by this reader`,
      );
    }
    return this.mapView(def);
  }

  list(query?: ReaderQuery): readonly TView[] {
    const defs = this.registry.list({
      kinds: this.ownedKinds,
      packId: query?.packId,
      includeDisabled: query?.includeDisabled,
    });
    return defs.map((def) => this.mapView(def));
  }
}

// Factory：給定完整 Registry，產生窄化的 per-module Reader。
export function createDefinitionReader<TView = Readonly<ContentDefinition>>(
  registry: DefinitionRegistry,
  spec: DefinitionReaderSpec<TView>,
): DefinitionReader<TView> {
  return new NarrowedReader<TView>(registry, spec);
}
