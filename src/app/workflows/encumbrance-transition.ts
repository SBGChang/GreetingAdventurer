// app/workflows/encumbrance-transition.ts
// 超載重算的觸發（05_inventory_module.md §2.2、§3.3）。
//
// 為什麼需要它：`EvaluateTeamEncumbrance` 有 Handler、有註冊、有測試——但**沒有任何送出端**。
// 它是一筆「已註冊、可路由、從未執行」的命令，所以超載從遊戲開始到現在從來沒有被評估過。
//
// inventory 自己的註解把責任講得很清楚（createItemInstance 與 moveItemToTeamQuestCargo 兩處）：
//
//     此觸發由 encumbrance-transition-workflow 及各建立來源 Workflow 負責，
//     Inventory 不自建第二套重算。
//
// 那個判斷是對的——超載是**隊伍層**的事實（要看全隊成員的攜帶總量），inventory 只擁有物品實體，
// 它沒有隊伍組成這個事實。但那個 Workflow 一直不存在，於是「責任在別處」實際等於「沒人做」。
// 這支檔案就是那個別處。
//
// 觸發時機：物品**進入或離開角色的攜帶範圍**時。判準只有一個——`ItemLocation` 是不是
// `characterBag`。裝備（equipped）不算：它由 EquipmentChanged 走自己的能力上限重算路徑；
// 城市庫存、店面貨架、任務保管、地圖內容都不在任何角色身上。
//
// Workflow 不擁有 Slice：只送 Internal Command，重算本身由 inventory 的 Handler 做。

import type {
  CharacterId,
  ModuleId,
  TeamId,
  TransactionMessageDraft,
} from '../../contracts/core';
import type { ItemLocation } from '../../contracts/inventory';
import * as team from '../../modules/team/public';
import type { GameState } from '../composition/state';
import type { WorkflowSubscriberDispatch } from './player-travel-event';
import {
  ENCUMBRANCE_ON_ITEM_CREATED_WORKFLOW,
  ENCUMBRANCE_ON_ITEM_MOVED_WORKFLOW,
} from '../composition/manifest';

// 這個位置是否落在某個角色的攜帶範圍內。回傳該角色，否則 undefined。
//
// 只認 `characterBag`。這是刻意的窄判準：把 equipped 也算進來會與裝備變更的能力上限重算重複
// 觸發，而 doc §3.3 的超載算的是**背負重量**，不是穿在身上的裝備。
function carrierOf(location: ItemLocation): CharacterId | undefined {
  return location.kind === 'characterBag' ? location.characterId : undefined;
}

function evaluate(teamId: TeamId): TransactionMessageDraft {
  return {
    targetModule: 'inventory' as ModuleId,
    command: { type: 'EvaluateTeamEncumbrance', teamId },
  };
}

// 把「受影響的角色們」收斂成「要重算的隊伍們」。
//
// 去重是必要的而不是最佳化：同一筆交易裡若有多個角色同隊（例如整隊分到戰利品），逐角色各送一次
// 會讓 inventory 對同一支隊伍重算多次。重算是冪等的，所以那不會算錯，但它會讓同一筆交易的
// outgoing 數量隨隊伍人數膨脹，而交易有訊息上限（kernel 的安全上限）。
function evaluateTeamsOf(
  characterIds: readonly (CharacterId | undefined)[],
  state: GameState,
): readonly TransactionMessageDraft[] {
  const teamIds = new Set<string>();
  const drafts: TransactionMessageDraft[] = [];
  for (const characterId of characterIds) {
    if (characterId === undefined) continue;
    const teamId = team.createTeamQuery(state.team).findTeamForMember(characterId);
    // 不屬於任何隊伍的角色（世界 NPC、未入隊的暫時角色）沒有隊伍超載可算。這不是缺資料——
    // 那些角色本來就不在任何隊伍的攜帶總量裡。
    if (teamId === undefined) continue;
    if (teamIds.has(String(teamId))) continue;
    teamIds.add(String(teamId));
    drafts.push(evaluate(teamId));
  }
  return drafts;
}

// ItemInstanceCreated → 若落在角色背包，重算該角色所屬隊伍。
export const onItemInstanceCreated: WorkflowSubscriberDispatch = (e, s) => {
  const event = e as { location: ItemLocation };
  return { outgoing: evaluateTeamsOf([carrierOf(event.location)], s) };
};

// InventoryTransferred → 來源與目的**兩邊**都可能改變超載狀態，所以兩邊都要算。
//
// 只算目的地是不夠的：物品從 A 的背包移到城市庫存時，A 的隊伍會從超載變成不超載，而那筆變化
// 只有在來源側才看得到。
export const onInventoryTransferred: WorkflowSubscriberDispatch = (e, s) => {
  const event = e as { from: ItemLocation; to: ItemLocation };
  return { outgoing: evaluateTeamsOf([carrierOf(event.from), carrierOf(event.to)], s) };
};

export const WORKFLOW_SUBSCRIBERS: Readonly<Record<string, WorkflowSubscriberDispatch>> = {
  [`ItemInstanceCreated::${String(ENCUMBRANCE_ON_ITEM_CREATED_WORKFLOW)}`]: onItemInstanceCreated,
  [`InventoryTransferred::${String(ENCUMBRANCE_ON_ITEM_MOVED_WORKFLOW)}`]: onInventoryTransferred,
};
