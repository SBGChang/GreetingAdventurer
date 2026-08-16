// modules/combat/queries.ts
// Combat 公開 Query port（文件 §4）。純讀取：以目前 slice + Reader 推導 View，不改動 state、不消費 RNG。

import type { EncounterId, CombatantId, WeaponSetId, SkillDefinitionId } from '../../contracts/core';
import type {
  CombatQuery,
  CombatEncounterView,
  CombatantView,
  CombatActionOption,
} from '../../contracts/combat';

import type { CombatState, CombatEncounter, CombatantState } from './state';
import { requireEncounter, tryGetEncounter } from './state';
import type { CombatHandlerContext } from './system';

// Reader 對未註冊的 Definition 會拋錯（窄化 reader 的 `.get()` 契約）。Query 不得因為一筆失效引用
// 就整個失敗，故在此收斂為 undefined 由呼叫端跳過。
function tryGetSkillView(
  deps: QueryDeps,
  skillId: SkillDefinitionId,
): ReturnType<CombatHandlerContext['definitions']['getSkillView']> | undefined {
  try {
    return deps.definitions.getSkillView(skillId);
  } catch {
    return undefined;
  }
}

function toCombatantView(c: CombatantState): CombatantView {
  return {
    combatantId: c.combatantId,
    source: c.source,
    side: c.side,
    footprint: c.footprint,
    anchorCell: c.anchorCell,
    health: c.health,
    mana: c.mana,
    currentCtb: c.currentCtb,
    ...(c.activeWeaponSetId !== undefined ? { activeWeaponSetId: c.activeWeaponSetId } : {}),
    activeStatuses: c.activeStatuses,
    state: c.state,
    revision: c.revision,
  };
}

function toEncounterView(encounter: CombatEncounter): CombatEncounterView {
  const combatants = (Object.keys(encounter.combatants) as CombatantId[])
    .map((id) => encounter.combatants[id])
    .filter((c): c is CombatantState => c !== undefined)
    .map(toCombatantView);
  return {
    encounterId: encounter.encounterId,
    source: encounter.source,
    playerTeamId: encounter.playerTeamId,
    playerFormationRevision: encounter.playerFormationRevision,
    state: encounter.state,
    ...(encounter.currentActorId !== undefined ? { currentActorId: encounter.currentActorId } : {}),
    readyQueue: encounter.readyQueue,
    combatants,
    revision: encounter.revision,
  };
}

// 依賴 loadout / definitions 推導可用技能選項；純讀取。
// progression 也是 Query 的依賴：戰鬥選單必須先確認角色**學會**該技能，才去取 Skill Definition
//（見 getAvailableActions 的防禦性讀取）。
type QueryDeps = Pick<CombatHandlerContext, 'definitions' | 'loadout' | 'progression'>;

export function makeCombatQuery(state: CombatState, deps: QueryDeps): CombatQuery {
  return {
    getEncounter(id: EncounterId): CombatEncounterView {
      return toEncounterView(requireEncounter(state, id));
    },

    getCombatant(id: CombatantId): CombatantView {
      // CombatantId 全域唯一；掃描所有 Encounter 找到該單位。
      for (const encounterId of Object.keys(state.encounters) as EncounterId[]) {
        const encounter = state.encounters[encounterId];
        const c = encounter?.combatants[id];
        if (c !== undefined) return toCombatantView(c);
      }
      throw new Error(`missing combatant ${String(id)}`);
    },

    // 不消費 RNG：以 (currentCtb 升冪, 玩家側優先, combatantId) 決定性排序（不變量 12）。
    getCtbOrder(encounterId: EncounterId): CombatantId[] {
      const encounter = tryGetEncounter(state, encounterId);
      if (encounter === undefined) return [];
      return (Object.keys(encounter.combatants) as CombatantId[])
        .map((id) => encounter.combatants[id])
        .filter((c): c is CombatantState => c !== undefined && c.state !== 'dead')
        .sort((a, b) => {
          if (a.currentCtb !== b.currentCtb) return a.currentCtb - b.currentCtb;
          if (a.side !== b.side) return a.side === 'player' ? -1 : 1;
          return a.combatantId < b.combatantId ? -1 : a.combatantId > b.combatantId ? 1 : 0;
        })
        .map((c) => c.combatantId);
    },

    getAvailableActions(encounterId: EncounterId, actorId: CombatantId): CombatActionOption[] {
      const encounter = tryGetEncounter(state, encounterId);
      const actor = encounter?.combatants[actorId];
      if (encounter === undefined || actor === undefined) return [];
      if (actor.source.kind !== 'character') return []; // 敵方由 AI 驅動，不列玩家選項

      const loadout = deps.loadout.getEquipmentLoadout(actor.source.characterId);
      const options: CombatActionOption[] = [];
      for (const set of loadout.weaponSets) {
        for (const skillId of set.selectedSkillIds) {
          if (skillId === undefined) continue;
          // 防禦性讀取：武器組裡可能存著失效的技能引用——舊存檔、被移除的內容、或未載入的內容包。
          // 直接 getSkillView 會讓**整個戰鬥選單 Query 拋錯**，而不是把那一項當成不可用
          //（複審 R14 #1）。同 handleUseCombatSkill 的作法：先 knows() 擋掉未學／偽造的 ID，
          // 再對取不到 Definition 的情況跳過該技能。
          if (!deps.progression.knows(actor.source.characterId, skillId as SkillDefinitionId)) continue;
          const view = tryGetSkillView(deps, skillId as SkillDefinitionId);
          if (view === undefined) continue;
          const requiresSwitch = actor.activeWeaponSetId !== set.weaponSetId;
          options.push({
            skillId: view.skillId,
            actionKind: view.actionKind,
            activationHand: view.activationHand,
            ...(requiresSwitch ? { requiresWeaponSetId: set.weaponSetId as WeaponSetId } : {}),
            // 第一版可用性只看「是否為當前行動者」；資源 / 目標合法性於 Resolver 再驗。
            available: encounter.currentActorId === actorId && actor.state !== 'dead',
          });
        }
      }
      return options;
    },
  };
}
