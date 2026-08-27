// app/content/combat-resolvers.ts
// combat 模組的 Resolver shape → 實作建構子表（目前：§2.4 目標形狀）。
//
// 這裡是「Resolver ID 住內容、src/ 只認 shape」的 src/ 側落點：內容標頭的每筆 ResolverBinding 帶
// `{ resolverId, ownerModule, shape }`，組裝時以 shape 代碼鍵查本表、拿到一個「吃該 binding → 產出
// ResolverRegistration」的建構子。resolverId 從 binding 帶入（資料），本檔**不出現任何 Resolver ID
// 字面值**——因此避開「硬編碼內容 ID」門禁，同時保有「換一份 Pack 就換一組綁定」。
//
// 目標形狀的實際格陣邏輯在 src/modules/combat/target-shapes.ts（純函式、逐案測試）。本檔只做橋接：
// 把 CombatSkillTargetInput 拆成 TargetShapeInput 餵給對應形狀，包成 registry 的 ResolverRegistration。

import type { CombatantId, ResolverBinding, SchemaId } from '../../contracts/core';
import type { AnyResolverRegistration, ResolverRegistration } from '../../data-runtime';
import type { CombatSkillTargetInput } from '../../modules/combat/system';
import {
  PURE_TARGET_SHAPES,
  type PureTargetLocal,
  type TargetShapeFn,
} from '../../modules/combat/target-shapes';

// 占位 Schema ID（binding 驗證用；正式 schema 軌另立）。與 resolvers.ts 的占位同層級。
const TARGET_INPUT_SCHEMA = 'schema:combat-skill-target-input' as SchemaId;
const TARGET_RESULT_SCHEMA = 'schema:combatant-id-list' as SchemaId;

// 一個目標形狀 → 一筆 ResolverRegistration。resolverId／ownerModule 來自 binding（資料）；
// 目標解析無 RNG、不讀 Definition，故 resolve 只回 value、不回 nextRngCursor。
function targetShapeRegistration(
  fn: TargetShapeFn,
  binding: ResolverBinding,
): ResolverRegistration<CombatSkillTargetInput, readonly CombatantId[]> {
  return {
    resolverId: binding.resolverId,
    ownerModule: binding.ownerModule,
    inputSchemaId: TARGET_INPUT_SCHEMA,
    resultSchemaId: TARGET_RESULT_SCHEMA,
    // CombatSkillTargetInput 是 TargetShapeInput 的超集（多一個 resolverId），結構上直接可餵。
    resolve: (input) => ({ value: fn(input) }),
  };
}

// shape 代碼鍵 `combat-target:<local>` → 建構子。鍵由已實作的 PureTargetLocal 程式化產生，
// 與 content-source/core/resolver-ids.ts 綁定時用的 `combat-target:${local}` 對齊。
function buildCombatTargetBuilders(): Record<
  string,
  (binding: ResolverBinding) => AnyResolverRegistration
> {
  const out: Record<string, (binding: ResolverBinding) => AnyResolverRegistration> = {};
  for (const local of Object.keys(PURE_TARGET_SHAPES) as PureTargetLocal[]) {
    const fn = PURE_TARGET_SHAPES[local];
    out[`combat-target:${local}`] = (binding) => targetShapeRegistration(fn, binding);
  }
  return out;
}

export const COMBAT_TARGET_SHAPE_BUILDERS: Readonly<
  Record<string, (binding: ResolverBinding) => AnyResolverRegistration>
> = buildCombatTargetBuilders();
