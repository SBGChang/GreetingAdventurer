// content-source/packs.ts
// Content Pack 宣告：有哪些 pack、版本、相依、載入順序，以及每個 pack 由哪些 domain 檔組成。
//
// 分包原則（這是「同一套 Runtime 載入不同文化 Pack 就產生不同遊戲」的落實點）：
//   * `pack:core` —— **文化無關**的規則與結構：熟練度清單與曲線、生命週期規則、貨幣、
//     戰鬥規則骨架、通用 Resolver 調校。四國共用，不含任何一國的物件、怪物、地圖或城市。
//   * `pack:<culture>` —— 一國的內容：裝備、技能、怪物、遭遇、物品、素材、配方、地圖、城市、
//     委託、世界節點。每一國都 `requiredPacks: [core]`。
//
// 抽換文化 = 換掉 loadOrder 裡的文化 pack；core 不動。若某個數值換文化會改變，它就屬文化 pack；
// 若四國都相同且屬遊戲結構，才放 core。判不出來的一律放文化 pack——猜錯的代價不對稱
// （放文化包只是多複製一份；放 core 會讓該國永遠改不動它）。

import type { ContentPackId } from '../src/contracts/core';
import type { AuthoredManifest, AuthoredPack } from './authoring';

import { progressionDomain } from './core/progression';

const CORE_PACK_ID = 'pack:core' as ContentPackId;

const corePack: AuthoredPack = {
  packId: CORE_PACK_ID,
  version: '1.0.0',
  contentRoot: 'core',
  requiredPacks: [],
  optional: false,
  // base pack 不綁文化：cultureIds 為空（§8）。
  scope: { cultureIds: [], features: ['progression'] },
  // 目前 core 的內容沒有任何 Resolver 引用。有了就必須在這裡列出來——
  // Bootstrap 以此確認「pack 用到的 Resolver 全部已註冊」才啟動。
  requiredResolverIds: [],
  runtimeCompatibility: { minRuntimeVersion: '0.1.0' },
  declaredKinds: ['mastery', 'mastery-curve', 'social-mastery-benefit'],
  domains: [progressionDomain],
};

// 文化 pack 一律相依 core 的同一版本；版本不合就不得啟動（§1.1）。
const CORE_DEPENDENCY = [{ packId: CORE_PACK_ID, version: corePack.version }] as const;
export { CORE_DEPENDENCY, CORE_PACK_ID };

export const AUTHORED_MANIFEST: AuthoredManifest = {
  manifestVersion: '1.0.0',
  // core 先載入：文化 pack 引用它的熟練度、貨幣與規則 ID。
  loadOrder: [CORE_PACK_ID],
  packs: [corePack],
};
