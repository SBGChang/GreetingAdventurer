// app/content/resolver-registrations.ts
// 正式 ResolverRegistry 的組裝點（§11）：把內容標頭宣告的 ResolverBinding 逐筆轉成 registry 註冊。
//
// 流程：內容（content-source 宣告 binding）→ 編譯進 pack.json → loadContent 匯總成
// `result.resolverBindings` → 本檔以每筆 binding 的 `shape` 查 src/ 的實作表 → 註冊
// `{ resolverId: binding.resolverId, resolve: <shape 實作> }`。src/ 全程只碰 shape 代碼鍵，
// 碰不到 Resolver ID 字面值。
//
// 這是「一個 Func 一張表」的 Resolver 版：shape 代碼鍵是封閉標籤，一個 shape 一個實作建構子，
// 查無此 shape **明確拋錯**（內容綁定了 src/ 沒實作的東西——Bootstrap 期就該炸，不是玩到才炸）。

import type { ResolverBinding } from '../../contracts/core';
import {
  createResolverRegistry,
  type AnyResolverRegistration,
  type ResolverRegistry,
} from '../../data-runtime';
import { COMBAT_TARGET_SHAPE_BUILDERS } from './combat-resolvers';
import { COMBAT_POWER_SHAPE_BUILDERS } from './combat-power-resolvers';
import { COMBAT_AI_SHAPE_BUILDERS } from './combat-ai-resolvers';
import { ECONOMY_PRICE_MODIFIER_SHAPE_BUILDERS } from './economy-resolvers';
import { STATISTICS_SHAPE_BUILDERS } from './statistics-resolvers';
import { TEAM_RESOLVER_SHAPE_BUILDERS } from './team-resolvers';
import { CHARACTER_GENERATION_SHAPE_BUILDERS } from './character-resolvers';
import { QUEST_GENERATION_SHAPE_BUILDERS } from './quest-resolvers';

export type ResolverShapeBuilder = (binding: ResolverBinding) => AnyResolverRegistration;
export type ResolverShapeTable = Readonly<Record<string, ResolverShapeBuilder>>;

// src/ 的全體 shape → 實作建構子表。key 是與內容無關的 shape 代碼鍵（不是 Resolver ID）。
// 新增一個 Resolver 家族（economy reward、social affinity、combat power…）就往這裡合併它的子表。
export const PRODUCTION_RESOLVER_SHAPES: ResolverShapeTable = {
  ...COMBAT_TARGET_SHAPE_BUILDERS,
  ...COMBAT_POWER_SHAPE_BUILDERS,
  ...COMBAT_AI_SHAPE_BUILDERS,
  ...ECONOMY_PRICE_MODIFIER_SHAPE_BUILDERS,
  ...STATISTICS_SHAPE_BUILDERS,
  ...TEAM_RESOLVER_SHAPE_BUILDERS,
  ...CHARACTER_GENERATION_SHAPE_BUILDERS,
  ...QUEST_GENERATION_SHAPE_BUILDERS,
};

// 依 binding 組裝 ResolverRegistry。重複 resolverId 由 createResolverRegistry 明確拋錯（不後蓋前）。
export function createProductionResolverRegistry(
  bindings: readonly ResolverBinding[],
  shapes: ResolverShapeTable = PRODUCTION_RESOLVER_SHAPES,
): ResolverRegistry {
  const registrations: AnyResolverRegistration[] = bindings.map((binding) => {
    const build = shapes[binding.shape];
    if (build === undefined) {
      throw new Error(
        `createProductionResolverRegistry：未知的 resolver shape "${binding.shape}"` +
          `（Resolver ${String(binding.resolverId)}，owner ${String(binding.ownerModule)}）——` +
          `內容綁定了一個 src/ 尚未實作的 shape。`,
      );
    }
    return build(binding);
  });
  return createResolverRegistry(registrations);
}
