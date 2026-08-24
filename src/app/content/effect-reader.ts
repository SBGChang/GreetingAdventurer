// app/content/effect-reader.ts
// 通用 Effect Definition Reader（13_data_runtime.md §6.1 的封閉 tagged variant）。
//
// 為什麼是一個獨立的 reader 而不是掛在某個模組上：Effect 是**共用內容家族**——戰鬥效果、內容事件
// 選項效果、料理效果都用同一個 `effect` kind 與同一個 `EffectDefinitionId` 家族。沒有模組擁有它，
// 所以 `EffectDefinition` 住在 contracts/core，讀它的 adapter 住在這裡。
//
// 關於 kind 所有權：`definition-kinds.ts` 把 `effect` 這個 kind 登記給 crafting。**那沒有問題，也
// 不需要改**——該登記表管的是「誰宣告這個 kind 與它的 schemaVersion」，不是「誰可以讀」。§5 的窄化
// Reader 本來就允許同一個 kind 有多個投影：crafting narrow 出料理專用的 FoodEffectDefinition，
// 這裡 narrow 出通用的 EffectDefinition。兩者讀同一批資料、各取所需。
//
// 這個 reader 刻意**不**提供「找不到就回 undefined」的版本：Effect 引用來自 Content Pack，而
// reference 驗證應在載入期擋下懸空引用。執行期讀不到就是壞資料，窄化 Reader 拋錯是正確行為
//（規範 §6 禁止「捕捉 Definition Reader 例外後繼續」）。

import type { EffectDefinition, EffectDefinitionId } from '../../contracts/core';
import type { DefinitionRegistry } from '../../data-runtime';

import { narrowedDomainReader } from './reader-adapter';

// `effect` kind 的字串常值只出現在這一處與 crafting-reader，兩邊必須一致；登記表以
// crafting 的 CRAFTING_DEFINITION_KINDS.effect 為權威（見上方說明）。
const EFFECT_KIND = 'effect';

export interface EffectDefinitionReader {
  getEffect(id: EffectDefinitionId): EffectDefinition;
}

export function createEffectDefinitionReader(registry: DefinitionRegistry): EffectDefinitionReader {
  const effect = narrowedDomainReader<EffectDefinition>(registry, 'reader:core.effect', [
    EFFECT_KIND,
  ]);
  return { getEffect: (id) => effect.get(id) };
}
