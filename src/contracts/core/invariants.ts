// contracts/core/invariants.ts
// 系統結構不變量——**唯一**允許在程式裡寫下數值的地方。
//
// 為什麼要集中：分散在各模組的 `const MAX_LEVEL = 10`、`const GRID_MAX = 2` 與
// `const HOME_YEAR_REST_DAYS = 365` 在語法上完全一樣，但前兩者改了就不是這個遊戲的結構，
// 第三個改了只是節奏不同。看不出差別的東西不能靠自律區分，只能靠位置：
// 放進這個檔＝有人主張它是不變量；沒放進來的數值一律視為可調內容，必須由 Definition／Rule 提供。
//
// 門禁 `verify-runtime-discipline` 的「無具名數值常數」檢查只放行這個檔。
// 想在 modules/app 底下新增一個 SCREAMING_CASE 數值常數，只有兩條路：
// 把它搬進來（並在下面寫清楚為什麼它是結構），或把它變成資料。
//
// 判準（規範）：改了就不是這個遊戲的**結構**，而不是「改了會比較好玩」。
// 「目前不打算調整」不是不變量的理由。

// ── 戰鬥 ────────────────────────────────────────────────────────────────────

/**
 * 戰鬥場地 3×3。格座標 row/col ∈ [GRID_MIN, GRID_MAX]，**1 起算**。
 *
 * 11_combat_module.md §3.3 逐字：「雙方各自的局部座標都以第 1 排為前排、第 3 排為後排」。
 * 這兩個常數原本是 0／2，與文件、與所有實際撫位（Bootstrap 的隊長站位、雲華編組的
 * `combatCell(1..3, 1..3)`）以及 combat 自己的 `backfillSide()`（以字面 1 判斷「第 1 排仍有人」）
 * 全部相反：`rowsFromFront(row) = row - GRID_MIN` 會把前排算成「離前排 1 排」，整個排距偏一格。
 *
 * 這裡只管**座標標籤**。玩家感受到的「距離」是 **0 起算**的（自己那一格＝0，
 * 所以射程 1 的近戰站前排可以打到敵方第 1、2 排），由 `rowsFromFront()` 與 `combatDistance()`
 * 負責換算——見 modules/combat/state.ts §2.4。
 */
export const GRID_MIN = 1;
export const GRID_MAX = 3;

/** 同角色、同支援技能，每場戰鬥最多記 3 次熟練（doc §3.2 / §8.6）。 */
export const SUPPORT_USE_CAP = 3;

// ── 隊伍 ────────────────────────────────────────────────────────────────────

/** 正式隊員上限 9（＝3×3 每格一人）。與 GRID 尺寸互為同一條結構。 */
export const MAX_FORMAL_MEMBERS = 9;

// ── 成長 ────────────────────────────────────────────────────────────────────

/** Mastery 等級域 Lv.0～10。等級**數量**是結構；每一級要多少經驗是 curve 資料。 */
export const MIN_MASTERY_LEVEL = 0;
export const MAX_MASTERY_LEVEL = 10;

/** 主屬性上限 100。上限是結構；成長速度與分布是資料。 */
export const MAX_PRIMARY_ATTRIBUTE = 100;

// ── Engine 安全上限 ─────────────────────────────────────────────────────────

/** 敵方連續回合的執行安全上限；不決定行動速度或玩法數值。 */
export const MAX_SETTLE_STEPS = 64;

/** World cadence adds many jobs during 28-day training or 365-day rest. This bounds execution work, not elapsed game time. */
export const MAX_WORLD_SETTLE_STEPS = 4096;
