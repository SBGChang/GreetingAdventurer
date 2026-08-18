// kernel/accumulate.ts
// 計數與累加的共用件。
//
// 這個檔案曾經被門禁「整檔放行」，因為它內部寫著 `(record[key] ?? 0) + amount`——語法上與
// 「缺資料就給預設玩法值」（規範 §6）完全一樣。整檔放行是個 allowlist：任何人只要把違規
// 程式搬進來就能繞過檢查，那和逐行豁免是同一個問題，只是粒度變粗。
//
// 現在不需要放行了，因為這裡**沒有預設值**。差別不只是躲過 regex：
//   `(x ?? 0) + amount` 讀作「x 缺席時當成 0，再加上 amount」——先發明一個值，再運算。
//   `x === undefined ? amount : x + amount` 讀作「還沒有累積過，總量就是這次的量」——
//   沒有任何值被發明出來。後者才是這件事的真實語意。
//
// 這裡不含任何遊戲知識：只有「數字加起來」與「有上限就夾住」。上限一律由呼叫端傳入。

/** 對可變 Record 累加。尚未累積過的鍵，總量就是本次的量。 */
export function addToRecord<K extends string>(
  record: Partial<Record<K, number>>,
  key: K,
  amount: number,
): void {
  const current = record[key];
  record[key] = current === undefined ? amount : current + amount;
}

/** 對 Map 累加。理由同上。 */
export function addToMap<K>(map: Map<K, number>, key: K, amount: number): void {
  const current = map.get(key);
  map.set(key, current === undefined ? amount : current + amount);
}

/** 累加後夾上限。上限由呼叫端提供（多半來自不變量或規則資料），不在此處寫死。 */
export function addToRecordCapped<K extends string>(
  record: Partial<Record<K, number>>,
  key: K,
  amount: number,
  cap: number,
): void {
  const current = record[key];
  record[key] = Math.min(cap, current === undefined ? amount : current + amount);
}

/** 選填集合的長度：沒有集合就是沒有元素。 */
export function countOf(items: readonly unknown[] | undefined): number {
  return items === undefined ? 0 : items.length;
}
