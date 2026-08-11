// app/content/reader-adapter.ts
// 把 data-runtime 的通用 DefinitionRegistry 接成各模組**手寫的領域 Reader 介面**的共用膠水。
//
// data-runtime 只提供一個泛型 createDefinitionReader（依 ownedKinds 窄化 + mapView 投影）；各模組
// 契約的 XxxDefinitionReader（如 DungeonDefinitionReader）卻是「一種 kind 一個具名 getter」的手寫
// 介面，回傳 `DefinitionHeader & {…}`。兩者之間需要一層 adapter：本檔提供那層的通用件，
// 各模組的 reader（dungeon-reader.ts…）以它為樣板組裝。

import type { DefinitionReaderId } from '../../contracts/core';
import {
  createDefinitionReader,
  type ContentDefinition,
  type DefinitionReader,
  type DefinitionRegistry,
} from '../../data-runtime';

// 把一筆原始 ContentDefinition 投影成領域 `DefinitionHeader & {…}` View。
// Header 欄位（id/schemaVersion/packId/enabled）以 Registry 為權威放最後，蓋掉 data 內可能過期的
// header 複本；領域欄位取自作者資料 `data`。這對「DefinitionHeader & TExtra」形狀的定義通用。
export function domainDefinitionView<TView>(def: Readonly<ContentDefinition>): TView {
  return {
    ...(def.data as Record<string, unknown>),
    id: def.id,
    schemaVersion: def.schemaVersion,
    packId: def.packId,
    enabled: def.enabled,
  } as TView;
}

// 對單一 kind 家族建一個窄化 Reader，並套上領域投影。readerId 需跨版本穩定、全域唯一。
export function narrowedDomainReader<TView>(
  registry: DefinitionRegistry,
  readerId: string,
  ownedKinds: readonly string[],
): DefinitionReader<TView> {
  return createDefinitionReader<TView>(registry, {
    readerId: readerId as DefinitionReaderId,
    ownedKinds,
    mapView: (def) => domainDefinitionView<TView>(def),
  });
}
