// content-source/core/resolver-ids.ts
// combat 模組擁有的 Resolver ID 與其 shape 綁定的**單一來源**。
//
// 為什麼集中在這裡：Resolver 由模組擁有、不由文化擁有（見 content-source/core/team.ts 的說明），
// 所以同一個 combat Resolver ID 會被兩處用到——
//   * 文化 pack 的規則**引用**它（例 yunhua/skills.ts 的 `targeting.targetResolverId`）；
//   * core pack 的標頭**宣告**它的 shape 綁定（packs.ts 的 `resolverBindings`）。
// 兩處若各自拼字串，遲早對不上（引用了一個沒綁定的 ID／綁定了一個沒人用的 ID）。集中成一個
// 建構子 + 一份「已實作 shape」清單，就讓「引用」與「綁定」共用同一組字面值。
//
// ⚠ 命名定案（原 F2a 作者把兩種寫法列入回報）：採**模組擁有**的 `resolver:combat.<用途>`，
// 不採文化擁有的 `resolver.<culture>.<local>`。理由：目標／反擊條件的邏輯是純格陣規則，四國共用、
// 與文化無關（雲華的「單體」和維爾冬的「單體」是同一個 grid 形狀），所以它屬 combat 模組、歸 core。

import type { ModuleId, ResolverBinding, ResolverId } from '../../src/contracts/core';

const COMBAT_MODULE = 'combat' as ModuleId;

// ── Resolver ID 建構子（字串形狀＝既有落地慣例 `resolver:<module>.<用途>`）──────────
export function combatTargetResolverId(local: string): ResolverId {
  return `resolver:combat.target-${local}` as ResolverId;
}
export function combatCounterConditionResolverId(local: string): ResolverId {
  return `resolver:combat.counter-condition-${local}` as ResolverId;
}

// ── 目前 src/ 已實作的目標 shape（權威實作在 src/modules/combat/target-shapes.ts）───────
//
// 只列**已有實作**的 local；core 的 resolverBindings 只綁這些。其餘設計上存在、但尚未實作的目標
// 形狀（需武器 reach／守備狀態／status valence／反擊流程／可調上限，見 target-shapes.ts 檔頭）先不綁：
// 文化 pack 的技能仍可引用它們的 ID，但在對應 shape 實作+綁定之前，觸發該招會是「未註冊 Resolver」
// 的 typed 失敗（正確行為），而不是靜默錯算。實作一種就往這份清單加一筆、往 target-shapes.ts 加一個。
export const IMPLEMENTED_COMBAT_TARGET_LOCALS: readonly string[] = [
  'self',
  'single-ally',
  'self-or-single-ally',
  'whole-party',
  'own-front-row',
  'single-hostile',
  'single-hostile-casting',
  'same-column-hostiles',
];

// core 標頭要宣告的 combat 目標 shape 綁定：Resolver ID ↔ 程式側 shape 代碼鍵 `combat-target:<local>`。
// shape 鍵與 src/app/content/combat-resolvers.ts 的實作表對齊；ownerModule=combat。
export function combatTargetBindings(): readonly ResolverBinding[] {
  return IMPLEMENTED_COMBAT_TARGET_LOCALS.map((local) => ({
    resolverId: combatTargetResolverId(local),
    ownerModule: COMBAT_MODULE,
    shape: `combat-target:${local}`,
  }));
}
