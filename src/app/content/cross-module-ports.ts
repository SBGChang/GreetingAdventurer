// app/content/cross-module-ports.ts
// 真實跨模組 Query Port adapter（HANDOFF「跨模組 Query ← 各模組 createXxxQuery」）。
//
// 各模組 Handler 吃的是**窄化的消費者 Port**（DungeonTeamPort、CombatLoadoutQuery…），不是別的模組
// 的完整 Query。這層把「擁有模組的公開 Query（讀真實 sibling Slice）」轉接成消費者要的窄形狀——
// 取代 session ContextAssembler 目前用的 fixture stub。內容無關：只讀 sibling Slice，不碰 content。
//
// 已可乾淨轉接的（本檔）：
//   - DungeonTeamPort ← TeamQuery（team Slice）
//   - CombatLoadoutQuery ← InventoryQuery（inventory Slice）
//   - CharacterStatsQuery ← 派生統計服務（character + progression + inventory Slice ＋ statistics Reader/Resolver）
//   - CombatFormationQuery ← team formation ＋ character HP/MP ＋ CharacterStatsQuery（maxHP/MP）＋ inventory 武器組
// 尚需更多來源、暫緩（見檔尾註）：DungeonMapPort（需 map 空間內部：getRoomTraversal/getEntranceRoom…）。

import type { DungeonTeamPort } from '../../modules/dungeon/public';
import { createTeamQuery, type TeamState } from '../../modules/team/public';
import {
  createCharacterQuery,
  type CharacterState,
  type CharacterStatsQuery,
} from '../../modules/character/public';
import { makeProgressionQuery, type ProgressionModuleState } from '../../modules/progression/public';
import type { ProgressionDefinitionReader } from '../../contracts/progression';
import type {
  CombatLoadoutQuery,
  CombatFormationQuery,
  CombatFormationMember,
} from '../../modules/combat/public';
import {
  createInventoryQuery,
  type InventoryState,
  type InventoryDeps,
} from '../../modules/inventory/public';
import { createCharacterStatisticsCalculator, type StatisticsResolverPort } from '../../domain-services/statistics/public';
import type {
  CarryCapacitySnapshot,
  CharacterEquipmentLoadoutView,
  ItemDefinitionReader,
} from '../../contracts/inventory';
import type {
  CharacterStatisticsInput,
  EquippedEquipmentView,
  StatisticsDefinitionReader,
} from '../../contracts/statistics';
import type {
  CharacterId,
  EncumbranceResolutionId,
  ItemInstanceId,
  MasteryId,
  StatisticsRuleId,
  WeaponSetId,
  WorldDay,
} from '../../contracts/core';

// Dungeon 讀 team 的窄化 Port：以 TeamQuery（讀真實 team Slice）實作。
export function createDungeonTeamPort(teamState: TeamState): DungeonTeamPort {
  const query = createTeamQuery(teamState);
  return {
    getAdventureMap: (teamId) => {
      const location = query.getLocation(teamId);
      return location.kind === 'adventureMap' ? location.mapId : undefined;
    },
    isTeamInMap: (teamId, mapId) => {
      const location = query.getLocation(teamId);
      return location.kind === 'adventureMap' && location.mapId === mapId;
    },
    getMembers: (teamId) => query.listFormalMembers(teamId),
  };
}

// Combat 開場讀武器組配置的窄化 Port：窄化 InventoryQuery.getEquipmentLoadout（讀真實 inventory Slice）。
export function createCombatLoadoutQuery(
  inventoryState: InventoryState,
  itemReader: ItemDefinitionReader,
): CombatLoadoutQuery {
  const query = createInventoryQuery(inventoryState, itemReader);
  return {
    getEquipmentLoadout: (characterId) => query.getEquipmentLoadout(characterId),
    // §2.4 主手武器射程：該武器組主手 item → EquipmentDefinition.reachCells。無主手武器回 undefined
    //（由 Handler 明確拒絕，不預設）。護甲/盾/飾品沒有 reachCells，取到＝undefined 同理。
    getActiveWeaponReachCells: (characterId, weaponSetId) => {
      const set = query
        .getEquipmentLoadout(characterId)
        .weaponSets.find((w) => w.weaponSetId === weaponSetId);
      const itemId = set?.mainHandItemId;
      if (itemId === undefined) return undefined;
      const instance = inventoryState.items[itemId];
      if (instance === undefined) return undefined;
      return itemReader.getEquipment(instance.definitionId).reachCells;
    },
  };
}

// ── CharacterStatsQuery ← 派生統計服務 ────────────────────────────────────────
//
// character 的消費 Port（getStats → maxHP/MP），由 Composition 以派生統計服務落地（見 character/queries.ts
// 檔頭與 contracts/character 的宣告）。這裡把三個 Slice（character／progression／inventory）＋ statistics
// Reader/Resolver 組成一次 CharacterStatisticsInput，交給唯一的公式服務算出快照，只取出 maxHP/MP。
//
// 「每個輸入欄位的真相各有其擁有模組」是本轉接的重點：主屬來自 progression（derivePrimaryAttributes 的
// 投影 getPrimaryAttributes）、年齡/聲望來自 character、裝備來自 inventory、係數與上下限來自 statistics
// 內容。沒有任何一個數字寫在這裡。

// 一次裝上的所有裝備（三組武器 + 護甲）→ 定義 View。calculator 只查它實際用到的件（採用組的持握件
// ＋護甲），多給的 View 無害（viewIndex 只是索引）。裝備欄指向不存在的實例＝略過，讓 calculator 的
// requireView 在真的用到時明確報缺（不在這裡吞掉或補假件）。
function collectEquippedEquipmentViews(
  loadout: CharacterEquipmentLoadoutView,
  inventoryState: InventoryState,
  itemReader: ItemDefinitionReader,
): EquippedEquipmentView[] {
  const seen = new Set<ItemInstanceId>();
  const views: EquippedEquipmentView[] = [];
  const add = (itemId: ItemInstanceId | undefined): void => {
    if (itemId === undefined || seen.has(itemId)) return;
    seen.add(itemId);
    const instance = inventoryState.items[itemId];
    if (instance === undefined) return;
    views.push({ itemInstanceId: itemId, definition: itemReader.getEquipment(instance.definitionId) });
  };
  for (const set of loadout.weaponSets) {
    add(set.mainHandItemId);
    add(set.offHandItemId);
  }
  for (const itemId of Object.values(loadout.armorSlots)) add(itemId);
  return views;
}

// 已裝備各件宣告的對應熟練度聯集（去重）。calculator 對「採用組持握件 ＋ 護甲」的每一個 relatedMasteryId
// 都要一筆快照；多備幾筆無害（未練過的由 getMastery 回等級域下界的空進度）。
function relatedMasteryIdsOf(views: readonly EquippedEquipmentView[]): MasteryId[] {
  const seen = new Set<string>();
  const ids: MasteryId[] = [];
  for (const view of views) {
    for (const masteryId of view.definition.relatedMasteryIds) {
      if (seen.has(String(masteryId))) continue;
      seen.add(String(masteryId));
      ids.push(masteryId);
    }
  }
  return ids;
}

// 第一版：採用「第一組」武器組。哪一組為「當前組」是一項尚未落到 Loadout State 的執行期事實
//（見 first_version_design_ledger），到位前一律取第一組——與 CombatFormationMember.activeWeaponSetId 同源。
// 未鑄 Loadout 的角色 query 會回三組占位組，所以 [0] 恆在；仍以結構守門明確失敗，不補預設。
function firstWeaponSetId(loadout: CharacterEquipmentLoadoutView): WeaponSetId {
  const first = loadout.weaponSets[0];
  if (first === undefined) {
    throw new Error(`cross-module-ports: 角色 ${String(loadout.characterId)} 的 Loadout 無任何武器組`);
  }
  return first.weaponSetId;
}

export type CharacterStatsQueryDeps = Readonly<{
  characterState: CharacterState;
  progressionState: ProgressionModuleState;
  inventoryState: InventoryState;
  itemReader: ItemDefinitionReader;
  progressionReader: ProgressionDefinitionReader;
  statisticsDefinitions: StatisticsDefinitionReader;
  statisticsResolvers: StatisticsResolverPort;
  // 目前生效的統計規則 id（內容裡唯一一筆 statistics-rule）；由 assembler 於建置時取好。
  statisticsRuleId: StatisticsRuleId;
  // 當前世界日：年齡＝(worldDay − birthDay)。getStats 無 day 參數，故於建置時由 runtime.worldDay 帶入
  //（assembler 每次 dispatch 重建 context，帶入當下的 worldDay）。
  worldDay: WorldDay;
}>;

export function createCharacterStatsQuery(deps: CharacterStatsQueryDeps): CharacterStatsQuery {
  const characterQuery = createCharacterQuery(deps.characterState);
  const progressionQuery = makeProgressionQuery(deps.progressionState, deps.progressionReader);
  const inventoryQuery = createInventoryQuery(deps.inventoryState, deps.itemReader);
  const calculator = createCharacterStatisticsCalculator({
    definitions: deps.statisticsDefinitions,
    resolvers: deps.statisticsResolvers,
  });

  return {
    getStats: (id: CharacterId) => {
      const character = characterQuery.getCharacter(id);
      const loadout = inventoryQuery.getEquipmentLoadout(id);
      const equipmentDefinitionViews = collectEquippedEquipmentViews(
        loadout,
        deps.inventoryState,
        deps.itemReader,
      );
      const masterySnapshots = relatedMasteryIdsOf(equipmentDefinitionViews).map((masteryId) =>
        progressionQuery.getMastery(id, masteryId),
      );
      const input: CharacterStatisticsInput = {
        characterId: id,
        characterRevision: character.revision,
        ageDays: characterQuery.getAgeDays(id, deps.worldDay),
        reputation: character.reputation,
        // 主屬真相在 progression（由熟練度推導）；getPrimaryAttributes 已含「無進度 → 全 0」的投影。
        primaryAttributesFromMastery: progressionQuery.getPrimaryAttributes(id),
        masterySnapshots,
        // 第一版：character.condition.statuses 尚未對應到「影響主屬的 EffectDefinition」——該對應管線未建，
        // statistics 服務也還沒有 effect reader。目前內容的狀態不改主屬，故傳空。一旦狀態能改主屬，這裡
        // 要把對應 EffectDefinitionId 帶入（屆時服務需要 effect reader；見 statistics.ts 的失敗出口）。
        conditionModifierRefs: [],
        equipmentLoadout: loadout,
        equipmentDefinitionViews,
        selectedWeaponSetId: firstWeaponSetId(loadout),
        statisticsRuleId: deps.statisticsRuleId,
      };
      const snapshot = calculator.calculate(input);
      return { maxHealth: snapshot.maxHealth, maxMana: snapshot.maxMana };
    },
  };
}

// ── CombatFormationQuery ← team formation ＋ character HP/MP ＋ CharacterStatsQuery ──────────
//
// Combat 開場讀一次的隊伍站位快照。站位（誰在哪一格、revision）由 team 擁有；進戰當下 HP/MP 由
// character 擁有；上限 HP/MP 由派生統計（CharacterStatsQuery）算；採用武器組取第一組（同 firstWeaponSetId）。
export type CombatFormationQueryDeps = Readonly<{
  teamState: TeamState;
  characterState: CharacterState;
  inventoryState: InventoryState;
  itemReader: ItemDefinitionReader;
  stats: CharacterStatsQuery;
}>;

export function createCombatFormationQuery(deps: CombatFormationQueryDeps): CombatFormationQuery {
  const teamQuery = createTeamQuery(deps.teamState);
  const characterQuery = createCharacterQuery(deps.characterState);
  const inventoryQuery = createInventoryQuery(deps.inventoryState, deps.itemReader);

  return {
    getPlayerFormation: (teamId) => {
      const formation = teamQuery.getCombatFormation(teamId);
      // Object.entries 的 value 已是 GridCell；只有 key 丟失了 Record 的 branded 型別，依 placements
      // 的宣告把它收斂回 CharacterId（同族純量窄化，與 inventory queries 的 `key as ItemInstanceId` 同）。
      const members: CombatFormationMember[] = Object.entries(formation.placements).map(([key, cell]) => {
        const characterId = key as CharacterId;
        const condition = characterQuery.getCondition(characterId);
        const stats = deps.stats.getStats(characterId);
        const loadout = inventoryQuery.getEquipmentLoadout(characterId);
        return {
          characterId,
          cell,
          activeWeaponSetId: firstWeaponSetId(loadout),
          maxHealth: stats.maxHealth,
          maxMana: stats.maxMana,
          startHealth: condition.health,
          startMana: condition.mana,
        };
      });
      return { teamId, formationRevision: formation.revision, members };
    },
  };
}

// ── InventoryDeps ← inventory Slice ＋ team Slice ＋ 派生統計（負重上限）─────────────────────
//
// inventory Handler 的 context bag。reader/ids/worldDay 直供；三個跨模組讀取轉接真實 sibling：
//   - getTeamMembers ← TeamQuery.listFormalMembers（team Slice）
//   - isTeamTravelling ← TeamQuery.getLocation().kind === 'travelling'
//   - getCarryCapacity ← 派生統計 calculateCarryCapacity（doc §7 不變量 9：只由 Carry Capacity Rule
//     與有效肌力決定）。負重上限的窄化輸入是 CharacterStatisticsInput 的子集（不需 Loadout／裝備 View）。
export type InventoryContextDeps = Readonly<{
  inventoryState: InventoryState;
  teamState: TeamState;
  characterState: CharacterState;
  progressionState: ProgressionModuleState;
  itemReader: ItemDefinitionReader;
  progressionReader: ProgressionDefinitionReader;
  statisticsDefinitions: StatisticsDefinitionReader;
  statisticsResolvers: StatisticsResolverPort;
  statisticsRuleId: StatisticsRuleId;
  worldDay: WorldDay;
  ids: Readonly<{
    nextItemInstanceId: () => ItemInstanceId;
    nextEncumbranceResolutionId: () => EncumbranceResolutionId;
    nextWeaponSetId: () => WeaponSetId;
  }>;
}>;

export function createInventoryContext(deps: InventoryContextDeps): InventoryDeps {
  const teamQuery = createTeamQuery(deps.teamState);
  const characterQuery = createCharacterQuery(deps.characterState);
  const progressionQuery = makeProgressionQuery(deps.progressionState, deps.progressionReader);
  const calculator = createCharacterStatisticsCalculator({
    definitions: deps.statisticsDefinitions,
    resolvers: deps.statisticsResolvers,
  });
  const manifestHash = deps.statisticsDefinitions.getDefinitionManifestHash();

  return {
    reader: deps.itemReader,
    nextItemInstanceId: deps.ids.nextItemInstanceId,
    nextEncumbranceResolutionId: deps.ids.nextEncumbranceResolutionId,
    nextWeaponSetId: deps.ids.nextWeaponSetId,
    worldDay: deps.worldDay,
    getTeamMembers: (teamId) => teamQuery.listFormalMembers(teamId),
    getCarryCapacity: (characterId: CharacterId): CarryCapacitySnapshot => {
      const character = characterQuery.getCharacter(characterId);
      const maximumWeight = calculator.calculateCarryCapacity({
        characterId,
        ageDays: characterQuery.getAgeDays(characterId, deps.worldDay),
        reputation: character.reputation,
        primaryAttributesFromMastery: progressionQuery.getPrimaryAttributes(characterId),
        // 第一版：狀態尚未接入派生統計（同 CharacterStatsQuery 的說明）。負重只吃有效肌力，目前內容
        // 的狀態不改主屬，故傳空。一旦狀態能改主屬，這裡與 CharacterStatsQuery 一併帶入對應 refs。
        conditionModifierRefs: [],
        statisticsRuleId: deps.statisticsRuleId,
      });
      return {
        characterId,
        maximumWeight,
        // 負重上限的來源身分：角色 revision ＋ 統計規則 ＋ Manifest（同輸入 → 同 key，doc §6 慣例）。
        sourceRevisionKey: `capacity|character=${String(characterId)}@${character.revision}|rule=${String(deps.statisticsRuleId)}|manifest=${manifestHash}`,
      };
    },
    isTeamTravelling: (teamId) => teamQuery.getLocation(teamId).kind === 'travelling',
  };
}
