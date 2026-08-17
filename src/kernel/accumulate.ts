// kernel/accumulate.ts
// 計數與累加的共用件——**唯一**允許以 `?? 0` 表達「加法單位元」的地方。
//
// 為什麼要有這個檔：`(perChar[id] ?? 0) + amount` 與 `rule?.healthRestore ?? 5` 在語法上完全一樣，
// 一個是計數起點、一個是缺資料時偷給的玩法值（規範 §6）。門禁分不出來，人也分不出來。
//
// 早期版本靠逐行 `runtime-discipline-allow: <理由>` 註解放行——但那是一個可以替**任何**程式碼
// 開豁免的機制，理由寫得再好也擋不住下一個人拿它繞過真違規。改成：合法語意只能寫在這裡，
// 門禁依**位置**辨識。想在別處寫 `?? 0`，唯一的路是先問「這個 0 是不是計數起點」，
// 是就用這裡的函式，不是就補資料。
//
// 這裡不含任何遊戲知識：只有「數字加起來」與「有上限就夾住」。上限一律由呼叫端傳入。

/** 對可變 Record 累加。0 是加法單位元，不是缺資料時的預設值。 */
export function addToRecord<K extends string>(
  record: Partial<Record<K, number>>,
  key: K,
  amount: number,
): void {
  record[key] = (record[key] ?? 0) + amount;
}

/** 對 Map 累加。理由同上。 */
export function addToMap<K>(map: Map<K, number>, key: K, amount: number): void {
  map.set(key, (map.get(key) ?? 0) + amount);
}

/** 累加後夾上限。上限由呼叫端提供（多半來自不變量或規則資料），不在此處寫死。 */
export function addToRecordCapped<K extends string>(
  record: Partial<Record<K, number>>,
  key: K,
  amount: number,
  cap: number,
): void {
  record[key] = Math.min(cap, (record[key] ?? 0) + amount);
}

/** 選填集合的長度：沒有集合就是沒有元素。 */
export function countOf(items: readonly unknown[] | undefined): number {
  return items === undefined ? 0 : items.length;
}
