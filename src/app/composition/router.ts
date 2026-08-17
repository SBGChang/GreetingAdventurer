// app/composition/router.ts
// 把 kernel 的泛型 TransactionRunner 接到真實模組 Handler（12_engine_runtime.md §5.1）。
//
// 這裡是三種形狀差異的收斂點：
//   1. 參數順序：character/map 是 (command, state, ctx)；inventory/dungeon/combat/team 是
//      (state, command, ctx)；progression 的 subscriber 是 (state, payload, reader)。
//   2. 回傳形狀：可拒絕的 Handler 回 ModuleOutcome，其餘回 ModuleResult。
//   3. Slice 歸屬：kernel 只認 sliceName 字串，由此處補上。
// 模組本身不需要為了被組裝而改寫；轉接一律在 composition 完成。

import type {
  CharacterId,
  CombatantId,
  CommandRejection,
  EncounterId,
  GameCommandEnvelope,
  ModuleId,
  TeamId,
  TransactionMessageDraft,
} from '../../contracts/core';
import type {
  EventSubscriber,
  HandlerAccepted,
  HandlerRejected,
  InternalCommandHandler,
  RootHandler,
  SliceMutation,
  TransactionRunnerConfig,
} from '../../kernel';

import * as character from '../../modules/character/public';
import * as inventory from '../../modules/inventory/public';
import * as progression from '../../modules/progression/public';
import * as map from '../../modules/map/public';
import * as dungeon from '../../modules/dungeon/public';
import * as combat from '../../modules/combat/public';
import * as team from '../../modules/team/public';

import type { ProgressionDefinitionReader } from '../../contracts/progression';
import { KERNEL_REJECTION_SOURCE } from '../../contracts/core';
import { UNAVAILABLE_CAPABILITIES, FEATURE_NOT_AVAILABLE } from './manifest';
import type { ConfigureWeaponSet } from '../../contracts/inventory';
import {
  validateWeaponSetSkills,
  WEAPON_SET_CONFIGURATION_WORKFLOW,
} from '../workflows/weapon-set-configuration';
import {
  applyMutation,
  type GameJobType,
  type GameScheduledJob,
  type GameSliceName,
  type GameState,
} from './state';
import {
  GAME_COMMAND_ENTRY,
  GAME_COMMAND_OWNER,
  INTERNAL_COMMAND_OWNER,
  requireMessageType,
  WORKFLOW_ENTRY,
  type GameCommand,
  type GameCommandType,
  type GameInternalCommandType,
} from './messages';
import {
  EXECUTION_ORDER_MANIFEST,
  JOB_TYPE_ORDER_BY_PHASE,
  type ExecutionOrderManifest,
} from './manifest';
import { WORKFLOW_SUBSCRIBERS } from '../workflows/player-travel-event';

// ──────────────────────────────────────────────────────────────────────────
// 注入：各模組的 Context bag
// ──────────────────────────────────────────────────────────────────────────

export type ModuleContexts = Readonly<{
  character: character.CharacterHandlerContext;
  inventory: inventory.InventoryDeps;
  map: map.MapHandlerContext;
  dungeon: dungeon.DungeonContext;
  combat: combat.CombatHandlerContext;
  team: team.TeamHandlerContext;
  // progression 的 handler 直接吃 Reader（沒有 context bag）。
  progression: ProgressionDefinitionReader;
}>;

// 跨模組 Query 只吃 State 快照（各 createXxxQuery 都是 (state) => Query），因此 Context 必須用
// 「當前 workingState」重建，否則後段 Handler 讀到的是交易開始時的過期 slice（違反 §3.1 rule 3：
// Handler 只看得到最新 workingState）。故 router 不吃固定 contexts，而吃一個「以 state 產生 contexts」
// 的工廠；ID cursor / RNG 這類需跨呼叫延續的狀態，由工廠自身的閉包（GameSession 提供）保存。
export type ModuleContextFactory = (state: GameState) => ModuleContexts;

// ──────────────────────────────────────────────────────────────────────────
// ModuleResult / ModuleOutcome → kernel 的 Accepted | Rejected
// ──────────────────────────────────────────────────────────────────────────

// 直接用 kernel 匯出的型別，不自行複寫形狀（B.5 的教訓：複寫的宣告一定會漂移）。
type Accepted = HandlerAccepted;
type Rejected = HandlerRejected;

type AnyModuleResult = Readonly<{
  nextSlice: unknown;
  outgoingMessages: readonly TransactionMessageDraft[];
  scheduledJobs: readonly unknown[];
  cancelledJobIds?: readonly unknown[];
  notifications?: readonly unknown[];
  kernelRequests?: readonly unknown[];
}>;

type AnyModuleOutcome =
  | Readonly<{ ok: true; result: AnyModuleResult }>
  | Readonly<{ ok: false; rejection: CommandRejection }>;

// ModuleResult 的四個輸出通道全部搬到 kernel 的 SliceMutation 上；漏接任何一個都會讓
// 對應功能靜默失效（排程 Job 不會排、通知不會出、跨午夜不會推進）。
function toMutation(slice: GameSliceName, result: AnyModuleResult): SliceMutation {
  return {
    sliceName: slice,
    nextSlice: result.nextSlice,
    ...(result.notifications ? { notifications: result.notifications as never } : {}),
    ...(result.scheduledJobs.length > 0 ? { scheduledJobs: result.scheduledJobs as never } : {}),
    ...(result.cancelledJobIds ? { cancelledJobIds: result.cancelledJobIds as never } : {}),
    ...(result.kernelRequests ? { kernelRequests: result.kernelRequests as never } : {}),
  };
}

function acceptResult(slice: GameSliceName, result: AnyModuleResult): Accepted {
  return {
    accepted: true,
    mutation: toMutation(slice, result),
    ...(result.outgoingMessages.length > 0 ? { outgoing: result.outgoingMessages } : {}),
  };
}

function fromOutcome(slice: GameSliceName, outcome: AnyModuleOutcome): Accepted | Rejected {
  return outcome.ok
    ? acceptResult(slice, outcome.result)
    : { accepted: false, rejection: outcome.rejection };
}

// ──────────────────────────────────────────────────────────────────────────
// Internal Command 分派表
//
// 只登記**真的有實作**的 Handler。模組 ModuleContract 宣告了但 Wave B 沒寫的，
// 列在 PENDING_INTERNAL_COMMANDS，讓「缺口」是一張明確清單而不是執行期驚喜。
// ──────────────────────────────────────────────────────────────────────────

type Dispatch = (command: unknown, state: GameState, ctxs: ModuleContexts) => Accepted | Rejected;

const INTERNAL_COMMAND_HANDLERS: Readonly<Partial<Record<GameInternalCommandType, Dispatch>>> = {
  // ── character：(command, state, ctx) → ModuleResult ──────────────────────
  ApplyCombatCondition: (c, s, x) =>
    acceptResult('character', character.handleApplyCombatCondition(c as never, s.character, x.character)),
  ApplyCharacterReputationEffect: (c, s, x) =>
    acceptResult('character', character.handleApplyCharacterReputationEffect(c as never, s.character, x.character)),
  CreatePartnerFamilyLink: (c, s, x) =>
    acceptResult('character', character.handleCreatePartnerFamilyLink(c as never, s.character, x.character)),
  OpenCharacterRelationshipFact: (c, s, x) =>
    acceptResult('character', character.handleOpenCharacterRelationshipFact(c as never, s.character, x.character)),
  ResolveCharacterRelationshipFact: (c, s, x) =>
    acceptResult('character', character.handleResolveCharacterRelationshipFact(c as never, s.character, x.character)),
  CreateQuestTemporaryCharacter: (c, s, x) =>
    acceptResult('character', character.handleCreateQuestTemporaryCharacter(c as never, s.character, x.character)),
  CreateWorldAdventurerBatch: (c, s, x) =>
    acceptResult('character', character.handleCreateWorldAdventurerBatch(c as never, s.character, x.character)),
  ApplyContentEventStatus: (c, s, x) =>
    acceptResult('character', character.handleApplyContentEventStatus(c as never, s.character, x.character)),
  ApplyFoodStatusEffects: (c, s, x) =>
    acceptResult('character', character.handleApplyFoodStatusEffects(c as never, s.character, x.character)),

  // ── inventory：(state, cmd, deps) → ModuleOutcome ────────────────────────
  CreateItemInstance: (c, s, x) =>
    fromOutcome('inventory', inventory.createItemInstance(s.inventory, c as never, x.inventory)),
  TransferItem: (c, s, x) =>
    fromOutcome('inventory', inventory.transferItem(s.inventory, c as never, x.inventory)),
  RemoveItemInstance: (c, s, x) =>
    fromOutcome('inventory', inventory.removeItemInstance(s.inventory, c as never, x.inventory)),
  ReserveQuestItem: (c, s, x) =>
    fromOutcome('inventory', inventory.reserveQuestItem(s.inventory, c as never, x.inventory)),
  ReserveCraftingInputs: (c, s, x) =>
    fromOutcome('inventory', inventory.reserveCraftingInputs(s.inventory, c as never, x.inventory)),
  MoveItemToTeamQuestCargo: (c, s, x) =>
    fromOutcome('inventory', inventory.moveItemToTeamQuestCargo(s.inventory, c as never, x.inventory)),
  CommitCombatItemUse: (c, s, x) =>
    fromOutcome('inventory', inventory.commitCombatItemUse(s.inventory, c as never, x.inventory)),
  EvaluateTeamEncumbrance: (c, s, x) =>
    fromOutcome('inventory', inventory.evaluateTeamEncumbrance(s.inventory, c as never, x.inventory)),

  // ── map：(command, state, ctx) → ModuleOutcome ───────────────────────────
  SetMapRefreshLock: (c, s, x) =>
    fromOutcome('map', map.handleSetMapRefreshLock(c as never, s.map, x.map)),
  ProtectMapContent: (c, s, x) =>
    fromOutcome('map', map.handleProtectMapContent(c as never, s.map, x.map)),
  ResolvePlayerMapContent: (c, s, x) =>
    fromOutcome('map', map.handleResolvePlayerMapContent(c as never, s.map, x.map)),
  ApplyNpcDungeonSettlement: (c, s, x) =>
    fromOutcome('map', map.handleApplyNpcDungeonSettlement(c as never, s.map, x.map)),
  OpenMapDoor: (c, s, x) => fromOutcome('map', map.handleOpenMapDoor(c as never, s.map, x.map)),
  ResolveMapTrap: (c, s, x) =>
    fromOutcome('map', map.handleResolveMapTrap(c as never, s.map, x.map)),
  HarvestMapGatheringNode: (c, s, x) =>
    fromOutcome('map', map.handleHarvestMapGatheringNode(c as never, s.map, x.map)),

  // ── dungeon：(state, cmd, ctx) → ModuleOutcome ───────────────────────────
  StartNpcDungeonRun: (c, s, x) =>
    fromOutcome('dungeon', dungeon.startNpcDungeonRun(s.dungeon, c as never, x.dungeon)),
  ConsumeDungeonGatheringAction: (c, s, x) =>
    fromOutcome('dungeon', dungeon.consumeDungeonGatheringAction(s.dungeon, c as never, x.dungeon)),

  // ── combat：(state, cmd, ctx) → ModuleResult ─────────────────────────────
  StartCombatEncounter: (c, s, x) =>
    fromOutcome('combat', combat.handleStartCombatEncounter(s.combat, c as never, x.combat)),

  // ── team：(state, payload, ctx) → ModuleOutcome ──────────────────────────
  StartReturnFromDungeon: (c, s, x) =>
    fromOutcome('team', team.handleStartReturnFromDungeon(s.team, c as never, x.team)),
  StartNpcTeamPlan: (c, s, x) =>
    fromOutcome('team', team.handleStartNpcTeamPlan(s.team, c as never, x.team)),
  CompletePlayerTravelSegmentWithoutEvent: (c, s, x) =>
    fromOutcome('team', team.handleCompletePlayerTravelSegmentWithoutEvent(s.team, c as never, x.team)),
};

// 契約宣告會處理、但 Wave B 沒有實作的 Internal Command。
// 這不是「可以忽略」的清單：路由到這些型別會直接丟錯，不會靜默成功。
export const PENDING_INTERNAL_COMMANDS: readonly GameInternalCommandType[] = (
  Object.keys(INTERNAL_COMMAND_OWNER) as GameInternalCommandType[]
).filter((type) => INTERNAL_COMMAND_HANDLERS[type] === undefined);

// ──────────────────────────────────────────────────────────────────────────
// Game Command（Root）分派表
//
// Game Command 是玩家/UI 的動作，由 runTransaction 的 rootHandler 入口執行（§5.1：每個
// Game Command 恰好一個入口——模組 Handler 或 Workflow）。與 Internal Command 的兩點差異：
//   1. 入口可能是 Workflow（gatherDungeonNode）——此時沒有模組 Handler，交由 Workflow Wave。
//   2. 玩家的「操作對象」是 GameCommandEnvelope.actorTeamId，不在 command payload 內。
//      dungeon 的玩家 Handler 簽章是 (state, teamId, cmd?, ctx)，teamId 由此處自 envelope 帶入。
// ──────────────────────────────────────────────────────────────────────────

type RootDispatch = (
  command: unknown,
  actorTeamId: TeamId,
  state: GameState,
  ctxs: ModuleContexts,
) => Accepted | Rejected;

const GAME_COMMAND_HANDLERS: Readonly<Partial<Record<GameCommandType, RootDispatch>>> = {
  // ── dungeon：(state, teamId, cmd?, ctx) → ModuleOutcome。teamId ← envelope.actorTeamId ──
  startPlayerExploration: (_c, t, s, x) =>
    fromOutcome('dungeon', dungeon.startPlayerExploration(s.dungeon, t, x.dungeon)),
  moveDungeonRoom: (c, t, s, x) =>
    fromOutcome('dungeon', dungeon.moveDungeonRoom(s.dungeon, t, c as never, x.dungeon)),
  openDungeonDoor: (c, t, s, x) =>
    fromOutcome('dungeon', dungeon.openDungeonDoor(s.dungeon, t, c as never, x.dungeon)),
  interactDungeonContent: (c, t, s, x) =>
    fromOutcome('dungeon', dungeon.interactDungeonContent(s.dungeon, t, c as never, x.dungeon)),
  resolveDungeonInteraction: (c, t, s, x) =>
    fromOutcome('dungeon', dungeon.resolveDungeonInteraction(s.dungeon, t, c as never, x.dungeon)),
  useDungeonExit: (c, t, s, x) =>
    fromOutcome('dungeon', dungeon.useDungeonExit(s.dungeon, t, c as never, x.dungeon)),

  // ── combat：(state, cmd, ctx) → ModuleResult。combat 尚未轉 ModuleOutcome，非法輸入以
  //    「回傳未變 slice」表示（HANDOFF 已列為待逐點判讀）；此處一律 acceptResult。 ──
  useCombatSkill: (c, _t, s, x) =>
    fromOutcome('combat', combat.handleUseCombatSkill(s.combat, c as never, x.combat)),
  useCombatItem: (c, _t, s, x) =>
    fromOutcome('combat', combat.handleUseCombatItem(s.combat, c as never, x.combat)),
  commandAlly: (c, _t, s, x) =>
    fromOutcome('combat', combat.handleCommandAlly(s.combat, c as never, x.combat)),
  combatRest: (c, _t, s, x) =>
    fromOutcome('combat', combat.handleCombatRest(s.combat, c as never, x.combat)),

  // ── inventory：(state, cmd, deps) → ModuleOutcome ──
  equipItem: (c, _t, s, x) =>
    fromOutcome('inventory', inventory.equipItem(s.inventory, c as never, x.inventory)),

  // ── team：(state, cmd, ctx) → ModuleOutcome（beginCityFreePeriod 無 cmd）──
  startCityTravel: (c, _t, s, x) =>
    fromOutcome('team', team.handleStartCityTravel(s.team, c as never, x.team)),
  enterAdventureMap: (c, _t, s, x) =>
    fromOutcome('team', team.handleEnterAdventureMap(s.team, c as never, x.team)),
  returnToCity: (c, _t, s, x) =>
    fromOutcome('team', team.handleReturnToCity(s.team, c as never, x.team)),
  rest: (c, _t, s, x) => fromOutcome('team', team.handleRest(s.team, c as never, x.team)),
  configureCombatFormation: (c, _t, s, x) =>
    fromOutcome('team', team.handleConfigureCombatFormation(s.team, c as never, x.team)),
  recruitTavernAdventurer: (c, _t, s, x) =>
    fromOutcome('team', team.handleRecruitTavernAdventurer(s.team, c as never, x.team)),
  selectPlayerSuccessor: (c, _t, s, x) =>
    fromOutcome('team', team.handleSelectPlayerSuccessor(s.team, c as never, x.team)),
  beginCityFreePeriod: (_c, _t, s, x) =>
    fromOutcome('team', team.handleBeginCityFreePeriod(s.team, x.team)),
};

// 入口為 WORKFLOW 的 Game Command：先由 Workflow 做跨模組驗證，通過後才委派給擁有 Slice 的模組
// Handler（Workflow 不擁有 Slice）。驗證失敗即拒絕整筆交易，Slice 完全不動。
const WORKFLOW_GAME_COMMAND_HANDLERS: Readonly<Partial<Record<GameCommandType, RootDispatch>>> = {
  configureWeaponSet: (c, _t, s, x) => {
    const cmd = c as ConfigureWeaponSet;
    const rejection = validateWeaponSetSkills(cmd, {
      knows: (characterId, skillId) => x.combat.progression.knows(characterId, skillId),
      // 「不存在」由 Reader 契約直接回答；不攔例外——攔了會把 Reader 內部的程式錯誤也一併
      // 誤判成「技能不存在」（規範 §6）。
      tryGetSkill: (skillId) => x.combat.definitions.trySkillView(skillId),
    });
    if (rejection !== undefined) {
      return {
        accepted: false,
        rejection: {
          code: rejection.code,
          source: WEAPON_SET_CONFIGURATION_WORKFLOW,
          details: rejection.details,
        },
      };
    }
    return fromOutcome('inventory', inventory.configureWeaponSet(s.inventory, cmd as never, x.inventory));
  },
};

// 入口為 WORKFLOW 但其 Workflow 尚未實作者（gatherDungeonNode）。
const WORKFLOW_ENTRY_SET: ReadonlySet<GameCommandType> = new Set(
  (Object.keys(GAME_COMMAND_ENTRY) as GameCommandType[]).filter(
    (type) => GAME_COMMAND_ENTRY[type] === WORKFLOW_ENTRY,
  ),
);

// 契約宣告由模組接收、但 Wave B 尚未實作的 Game Command（對照 GAME_COMMAND_OWNER，即扣掉
// Workflow 入口後仍缺 Handler 者）。與 PENDING_INTERNAL_COMMANDS 同理：明確清單，不靜默成功。
// 兩種入口都要掃：模組入口缺 Handler、Workflow 入口缺 Workflow dispatch。原本只掃 GAME_COMMAND_OWNER
// （即扣掉 Workflow 入口者），所以 `gatherDungeonNode` 這種「宣告 Workflow 入口但沒有 Workflow」
// 根本不會出現在清單裡（複審 R15 P1-4）。
export const PENDING_GAME_COMMANDS: readonly GameCommandType[] = (
  Object.keys(GAME_COMMAND_ENTRY) as GameCommandType[]
).filter((type) =>
  GAME_COMMAND_ENTRY[type] === WORKFLOW_ENTRY
    ? WORKFLOW_GAME_COMMAND_HANDLERS[type] === undefined
    : GAME_COMMAND_HANDLERS[type] === undefined,
);


// ──────────────────────────────────────────────────────────────────────────
// 授權：玩家命令只能作用在 actorTeamId 擁有的資料
//
// Handler 各自驗自己的領域前置，但「這筆命令的目標是否屬於發令的隊伍」是跨切面的：Game Command
// 的 payload 由玩家/UI 提供，若不檢查 actorTeamId，玩家可在 payload 填入別隊角色或別隊 Encounter
// 直接操作不屬於自己的資料。此處在 dispatch **之前**擋下：
//   - 全域：玩家只能以自己控制的（玩家）隊伍行動（actorTeamId === team.playerTeamId）。
//   - 帶 teamId 的命令：teamId === actorTeamId。
//   - 帶 characterId 的命令：該角色須為 actorTeamId 的（正式或臨時）成員。
//   - 帶 encounterId 的戰鬥命令：該 Encounter 的 playerTeamId === actorTeamId。
// ──────────────────────────────────────────────────────────────────────────

function isMemberOf(state: GameState, teamId: TeamId, characterId: CharacterId): boolean {
  const t = team.tryGetTeam(state.team, teamId);
  if (t === undefined) return false;
  return t.memberIds.includes(characterId) || t.temporaryMemberIds.includes(characterId);
}

function authorizeGameCommand(
  command: GameCommand,
  actorTeamId: TeamId,
  state: GameState,
): CommandRejection | undefined {
  const owner = (GAME_COMMAND_ENTRY[command.type] ?? ('composition' as ModuleId)) as ModuleId;
  const deny = (reason: string): CommandRejection => ({
    code: `authorization.${command.type}.${reason}`,
    source: owner,
    details: { actorTeamId: String(actorTeamId) },
  });

  // 全域：玩家只能以自己控制的隊伍行動。
  if (actorTeamId !== state.team.playerTeamId) return deny('actorNotPlayerTeam');

  // 戰鬥命令：Encounter 須屬玩家隊，且指定的戰鬥員（actorId/allyId）須為**玩家方**——否則玩家可在
  // 敵人正要行動時送出敵人的技能/休息命令，操作不屬於自己的戰鬥員。
  const combatantOwned = (encounterId: EncounterId, combatantId: CombatantId): CommandRejection | undefined => {
    const encounter = combat.tryGetEncounter(state.combat, encounterId);
    if (encounter === undefined || encounter.playerTeamId !== actorTeamId) return deny('encounterNotOwnedByActor');
    const combatant = encounter.combatants[combatantId];
    if (combatant === undefined || combatant.side !== 'player') return deny('combatantNotPlayerSide');
    return undefined;
  };

  switch (command.type) {
    case 'returnToCity':
    case 'configureCombatFormation':
      return command.teamId === actorTeamId ? undefined : deny('teamNotOwnedByActor');
    case 'equipItem':
    case 'unequipItem':
    case 'configureWeaponSet':
      return isMemberOf(state, actorTeamId, command.characterId)
        ? undefined
        : deny('characterNotInActorTeam');
    case 'commandAlly':
      return combatantOwned(command.encounterId, command.allyId);
    case 'useCombatSkill':
    case 'useCombatItem':
    case 'combatRest':
      return combatantOwned(command.encounterId, command.actorId);
    default:
      // 其餘玩家隊隱含命令（rest / startCityTravel / beginCityFreePeriod …）本就以 state.playerTeamId
      // 作用，已由上面全域檢查涵蓋。
      return undefined;
  }
}

// 把一筆 Game Command Envelope 轉為 runTransaction 的 rootHandler。
// 找不到入口/未實作/落在 Workflow 入口一律明確報錯，讓「送了指令卻沒反應」不會變成隱形 bug。
export function routeGameCommand(
  envelope: GameCommandEnvelope<GameCommand>,
  contextFactory: ModuleContextFactory,
): RootHandler<GameState> {
  const type = requireMessageType(envelope.command, 'routeGameCommand') as GameCommandType;
  const entry = GAME_COMMAND_ENTRY[type];
  if (entry === undefined) {
    throw new Error(`routeGameCommand: "${type}" 不在 GAME_COMMAND_ENTRY（未註冊的 Game Command）`);
  }
  // 已宣告但尚未閉合的能力：回傳**型別化拒絕**，不是拋例外。UI 因此能顯示可呈現的結果，而不是撞上
  // 執行期例外；同時也不會被誤當成成功 no-op（複審 R15 P1-4）。
  const capabilityGap = UNAVAILABLE_CAPABILITIES.gameCommands[type];
  if (capabilityGap !== undefined) {
    return () => ({
      accepted: false,
      rejection: {
        code: FEATURE_NOT_AVAILABLE,
        source: KERNEL_REJECTION_SOURCE,
        details: { commandType: type, reason: capabilityGap },
      },
    });
  }
  if (WORKFLOW_ENTRY_SET.has(type)) {
    const workflowDispatch = WORKFLOW_GAME_COMMAND_HANDLERS[type];
    if (workflowDispatch === undefined) {
      // 走到這裡代表既沒有 Workflow、也沒有列入 UNAVAILABLE_CAPABILITIES——啟動驗證本該先擋下
      // （manifest.workflow.missingForCommandEntry）。
      throw new Error(
        `routeGameCommand: "${type}" 的入口是 Workflow，但該 Workflow 尚未實作，` +
          `且未列入 UNAVAILABLE_CAPABILITIES（啟動驗證應已擋下）`,
      );
    }
    return (ctx) => {
      const denied = authorizeGameCommand(envelope.command, envelope.actorTeamId, ctx.workingState);
      if (denied !== undefined) return { accepted: false, rejection: denied };
      return workflowDispatch(
        envelope.command,
        envelope.actorTeamId,
        ctx.workingState,
        contextFactory(ctx.workingState),
      );
    };
  }
  const dispatch = GAME_COMMAND_HANDLERS[type];
  if (dispatch === undefined) {
    // 同上：未列入 UNAVAILABLE_CAPABILITIES 卻缺 Handler，是註冊錯誤而非執行期狀況。
    throw new Error(
      `routeGameCommand: "${type}" 由 "${entry}" 宣告接收，但未實作 Handler，` +
        `且未列入 UNAVAILABLE_CAPABILITIES（啟動驗證應已擋下）`,
    );
  }
  return (ctx) => {
    // 授權在 dispatch 之前；不通過即拒絕整筆交易（不動任何 Slice）。
    const denied = authorizeGameCommand(envelope.command, envelope.actorTeamId, ctx.workingState);
    if (denied !== undefined) return { accepted: false, rejection: denied };
    return dispatch(envelope.command, envelope.actorTeamId, ctx.workingState, contextFactory(ctx.workingState));
  };
}

// ──────────────────────────────────────────────────────────────────────────
// 到期 Job（Root）分派表
//
// 到期 Job 也是交易 root（§6.2）。Job 已由 Scheduler 存為具型別的 GameScheduledJob，故依
// job.type 分派。與 Command 的兩點差異：Job 無 actorTeam（作用對象在 job.targetId/payload）；
// 過期/失效 Job 由各模組 Handler 自行「安靜跳過」（回傳未變 slice），不是拒絕。
//   - character/map/team 回 ModuleResult；dungeon 的 npcDungeonDay 回 ModuleOutcome。
//   - dungeon.npcDungeonDay 簽章是 (state, runId, ctx)，runId ← job.targetId。
// ──────────────────────────────────────────────────────────────────────────

type JobDispatch = (job: GameScheduledJob, state: GameState, ctxs: ModuleContexts) => Accepted | Rejected;

const JOB_HANDLERS: Readonly<Partial<Record<GameJobType, JobDispatch>>> = {
  characterLifecycleDue: (j, s, x) =>
    acceptResult('character', character.handleCharacterLifecycleJob(j as never, s.character, x.character)),
  mapRefreshCheck: (j, s, x) =>
    acceptResult('map', map.handleMapRefreshCheck(j as never, s.map, x.map)),
  npcDungeonDay: (j, s, x) =>
    fromOutcome('dungeon', dungeon.npcDungeonDay(s.dungeon, (j as GameScheduledJob).targetId as never, x.dungeon)),
  teamPlanDue: (j, s, x) =>
    acceptResult('team', team.handleTeamPlanDueJob(s.team, j as never, x.team)),
};

// Manifest 註冊了 Phase 順序、但 Wave B 未實作 Handler 的 Job（team 的 freeActionDue /
// nonPlayerMemberCityFreeDayTick）。路由到這些會明確報錯，不靜默丟棄一個到期的 Job。
export const PENDING_JOBS: readonly GameJobType[] = (
  Object.values(JOB_TYPE_ORDER_BY_PHASE).flat() as GameJobType[]
).filter((type) => JOB_HANDLERS[type] === undefined);

// 把一筆到期 Job 轉為 runTransaction 的 rootHandler。
export function routeJob(
  job: GameScheduledJob,
  contextFactory: ModuleContextFactory,
): RootHandler<GameState> {
  const dispatch = JOB_HANDLERS[job.type];
  if (dispatch === undefined) {
    throw new Error(
      `routeJob: Job type "${job.type}" 已在 Manifest 註冊，但 Wave B 未實作對應 Handler` +
        `（見 router.ts 的 PENDING_JOBS）`,
    );
  }
  return (ctx) => dispatch(job, ctx.workingState, contextFactory(ctx.workingState));
}

// ──────────────────────────────────────────────────────────────────────────
// 事件訂閱分派表（key = `${eventType}::${subscriber}`，對齊 Manifest 的綁定）
// ──────────────────────────────────────────────────────────────────────────

type SubscriberDispatch = (
  event: unknown,
  state: GameState,
  ctxs: ModuleContexts,
) => Readonly<{ mutation: SliceMutation; outgoing?: readonly TransactionMessageDraft[] }>;

// 事件 Subscriber 的結果轉換：**同時**帶 mutation 與 outgoing（後續 Internal Command / Event）。先前只回
// mutation，導致 Subscriber 發出的次級訊息（如 dungeon 收到 CombatEncounterResolved 後送 ResolvePlayerMapContent）
// 被 Router 靜默丟棄，交易只跑原始一個事件。kernel EventSubscriber 本就支援 outgoing。
function subscriberResult(
  slice: GameSliceName,
  result: AnyModuleResult,
): Readonly<{ mutation: SliceMutation; outgoing?: readonly TransactionMessageDraft[] }> {
  return {
    mutation: toMutation(slice, result),
    ...(result.outgoingMessages.length > 0 ? { outgoing: result.outgoingMessages } : {}),
  };
}

const EVENT_SUBSCRIBERS: Readonly<Record<string, SubscriberDispatch>> = {
  'TeamLocationChanged::map': (e, s, x) =>
    subscriberResult('map', map.onTeamLocationChanged(e as never, s.map, x.map)),
  'CombatEncounterResolved::dungeon': (e, s) =>
    subscriberResult('dungeon', dungeon.handleCombatEncounterResolved(s.dungeon, e as never)),
  'NpcDungeonSettlementApplied::dungeon': (e, s) =>
    subscriberResult('dungeon', dungeon.handleNpcDungeonSettlementApplied(s.dungeon, e as never)),
  'CombatAttackMasteryEarned::progression': (e, s, x) =>
    subscriberResult(
      'progression',
      progression.handleCombatAttackMasteryEarned(s.progression, e as never, x.progression),
    ),
  'CombatDefenseMasteryEarned::progression': (e, s, x) =>
    subscriberResult(
      'progression',
      progression.handleCombatDefenseMasteryEarned(s.progression, e as never, x.progression),
    ),
  'CombatSupportMasteryEarned::progression': (e, s, x) =>
    subscriberResult(
      'progression',
      progression.handleCombatSupportMasteryEarned(s.progression, e as never, x.progression),
    ),
  'CharacterBorn::progression': (e, s) =>
    subscriberResult(
      'progression',
      progression.handleCharacterBorn(s.progression, (e as { characterId: never }).characterId),
    ),
  'ProgressionCapacityChanged::character': (e, s, x) =>
    subscriberResult('character', character.onStatsCapacityChanged(e as never, s.character, x.character)),
  'EquipmentChanged::character': (e, s, x) =>
    subscriberResult('character', character.onStatsCapacityChanged(e as never, s.character, x.character)),
};

// ──────────────────────────────────────────────────────────────────────────
// TransactionRunnerConfig 組裝
// ──────────────────────────────────────────────────────────────────────────

export type CreateTransactionConfigInput = Readonly<{
  // 以「當前 workingState」產生跨模組 Context 的工廠（見 ModuleContextFactory）。
  contextFactory: ModuleContextFactory;
  manifest?: ExecutionOrderManifest;
  // 提交時把累積的排程異動寫入 core.scheduler（JobId 由呼叫者的 cursor 配發）。
  applyScheduling: TransactionRunnerConfig<GameState>['applyScheduling'];
}>;

export function createTransactionConfig(
  input: CreateTransactionConfigInput,
): TransactionRunnerConfig<GameState> {
  const manifest = input.manifest ?? EXECUTION_ORDER_MANIFEST;
  const { contextFactory } = input;

  return {
    applyMutation,
    applyScheduling: input.applyScheduling,

    routeInternalCommand: (draft): InternalCommandHandler<GameState> | undefined => {
      const type = requireMessageType(draft.command, 'routeInternalCommand') as GameInternalCommandType;
      const expectedOwner: ModuleId | undefined = INTERNAL_COMMAND_OWNER[type];
      if (expectedOwner === undefined) {
        throw new Error(`routeInternalCommand: "${type}" 不在 INTERNAL_COMMAND_OWNER（未註冊的訊息）`);
      }
      if (draft.targetModule !== expectedOwner) {
        // 送錯模組是註冊／發送端錯誤，不能靜默改投正確模組。
        throw new Error(
          `routeInternalCommand: "${type}" 應送往 "${expectedOwner}"，實際 targetModule 是 "${draft.targetModule}"`,
        );
      }
      const dispatch = INTERNAL_COMMAND_HANDLERS[type];
      if (dispatch === undefined) {
        throw new Error(
          `routeInternalCommand: "${type}" 由 "${expectedOwner}" 宣告處理，但 Wave B 未實作該 Handler` +
            `（見 router.ts 的 PENDING_INTERNAL_COMMANDS）`,
        );
      }
      return (command, ctx) => dispatch(command, ctx.workingState, contextFactory(ctx.workingState));
    },

    routeEventSubscribers: (draft): readonly EventSubscriber<GameState>[] => {
      const type = requireMessageType(draft.event, 'routeEventSubscribers');
      const subscribers: EventSubscriber<GameState>[] = [];

      // 模組與 Workflow 共用同一張有序表；先後完全由陣列位置決定（§5.2 唯一真相）。每筆綁定由 dispatch
      // 表歸屬區分：命中 WORKFLOW_SUBSCRIBERS → Workflow（無 mutation、只送 outgoing）；否則模組（有 mutation）。
      const bindings =
        manifest.eventSubscriptionsByType[type as keyof typeof manifest.eventSubscriptionsByType];
      for (const binding of bindings ?? []) {
        const key = `${binding.eventType}::${String(binding.subscriber)}`;
        const workflowDispatch = WORKFLOW_SUBSCRIBERS[key];
        if (workflowDispatch !== undefined) {
          subscribers.push((event, ctx) => workflowDispatch(event, ctx.workingState));
          continue;
        }
        const dispatch = EVENT_SUBSCRIBERS[key];
        if (dispatch === undefined) {
          throw new Error(`routeEventSubscribers: Manifest 綁定 "${key}" 沒有對應的 Subscriber 實作`);
        }
        subscribers.push((event, ctx) => dispatch(event, ctx.workingState, contextFactory(ctx.workingState)));
      }

      return subscribers;
    },
  };
}

// 供 Registry 交叉驗證用：Router **實際**有 dispatch 的路由。宣告表（ModuleContract）不能當成
// Handler 存在的證據——那正是「啟動驗證全綠、玩家走進去才拋錯」的根因（複審 R15 P1-4）。
export const IMPLEMENTED_ROUTES = {
  gameCommands: new Set<string>([
    ...Object.keys(GAME_COMMAND_HANDLERS),
    ...Object.keys(WORKFLOW_GAME_COMMAND_HANDLERS),
  ]),
  internalCommands: new Set<string>(Object.keys(INTERNAL_COMMAND_HANDLERS)),
  jobs: new Set<string>(Object.keys(JOB_HANDLERS)),
} as const;
