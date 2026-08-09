// app/composition/router.ts
// 把 kernel 的泛型 TransactionRunner 接到真實模組 Handler（12_engine_runtime.md §5.1）。
//
// 這裡是三種形狀差異的收斂點：
//   1. 參數順序：character/map 是 (command, state, ctx)；inventory/dungeon/combat/team 是
//      (state, command, ctx)；progression 的 subscriber 是 (state, payload, reader)。
//   2. 回傳形狀：可拒絕的 Handler 回 ModuleOutcome，其餘回 ModuleResult。
//   3. Slice 歸屬：kernel 只認 sliceName 字串，由此處補上。
// 模組本身不需要為了被組裝而改寫；轉接一律在 composition 完成。

import type { CommandRejection, ModuleId, TransactionMessageDraft } from '../../contracts/core';
import type {
  EventSubscriber,
  HandlerAccepted,
  HandlerRejected,
  InternalCommandHandler,
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
import { applyMutation, type GameSliceName, type GameState } from './state';
import { INTERNAL_COMMAND_OWNER, requireMessageType, type GameInternalCommandType } from './messages';
import { EXECUTION_ORDER_MANIFEST, type ExecutionOrderManifest } from './manifest';

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
    acceptResult('combat', combat.handleStartCombatEncounter(s.combat, c as never, x.combat)),

  // ── team：(state, payload, ctx) → ModuleOutcome ──────────────────────────
  StartReturnFromDungeon: (c, s, x) =>
    fromOutcome('team', team.handleStartReturnFromDungeon(s.team, c as never, x.team)),
  StartNpcTeamPlan: (c, s, x) =>
    fromOutcome('team', team.handleStartNpcTeamPlan(s.team, c as never, x.team)),
};

// 契約宣告會處理、但 Wave B 沒有實作的 Internal Command。
// 這不是「可以忽略」的清單：路由到這些型別會直接丟錯，不會靜默成功。
export const PENDING_INTERNAL_COMMANDS: readonly GameInternalCommandType[] = (
  Object.keys(INTERNAL_COMMAND_OWNER) as GameInternalCommandType[]
).filter((type) => INTERNAL_COMMAND_HANDLERS[type] === undefined);

// ──────────────────────────────────────────────────────────────────────────
// 事件訂閱分派表（key = `${eventType}::${subscriber}`，對齊 Manifest 的綁定）
// ──────────────────────────────────────────────────────────────────────────

type SubscriberDispatch = (
  event: unknown,
  state: GameState,
  ctxs: ModuleContexts,
) => Readonly<{ mutation: SliceMutation }>;

const EVENT_SUBSCRIBERS: Readonly<Record<string, SubscriberDispatch>> = {
  'TeamLocationChanged::map': (e, s, x) => ({
    mutation: toMutation('map', map.onTeamLocationChanged(e as never, s.map, x.map)),
  }),
  'CombatEncounterResolved::dungeon': (e, s) => ({
    mutation: toMutation('dungeon', dungeon.handleCombatEncounterResolved(s.dungeon, e as never)),
  }),
  'NpcDungeonSettlementApplied::dungeon': (e, s) => ({
    mutation: toMutation('dungeon', dungeon.handleNpcDungeonSettlementApplied(s.dungeon, e as never)),
  }),
  'CombatAttackMasteryEarned::progression': (e, s, x) => ({
    mutation: toMutation(
      'progression',
      progression.handleCombatAttackMasteryEarned(s.progression, e as never, x.progression),
    ),
  }),
  'CombatDefenseMasteryEarned::progression': (e, s, x) => ({
    mutation: toMutation(
      'progression',
      progression.handleCombatDefenseMasteryEarned(s.progression, e as never, x.progression),
    ),
  }),
  'CombatSupportMasteryEarned::progression': (e, s, x) => ({
    mutation: toMutation(
      'progression',
      progression.handleCombatSupportMasteryEarned(s.progression, e as never, x.progression),
    ),
  }),
  'CharacterBorn::progression': (e, s) => ({
    mutation: toMutation(
      'progression',
      progression.handleCharacterBorn(s.progression, (e as { characterId: never }).characterId),
    ),
  }),
  'ProgressionCapacityChanged::character': (e, s, x) => ({
    mutation: toMutation(
      'character',
      character.onStatsCapacityChanged(e as never, s.character, x.character),
    ),
  }),
  'EquipmentChanged::character': (e, s, x) => ({
    mutation: toMutation(
      'character',
      character.onStatsCapacityChanged(e as never, s.character, x.character),
    ),
  }),
};

// ──────────────────────────────────────────────────────────────────────────
// TransactionRunnerConfig 組裝
// ──────────────────────────────────────────────────────────────────────────

export type CreateTransactionConfigInput = Readonly<{
  contexts: ModuleContexts;
  manifest?: ExecutionOrderManifest;
  // 提交時把累積的排程異動寫入 core.scheduler（JobId 由呼叫者的 cursor 配發）。
  applyScheduling: TransactionRunnerConfig<GameState>['applyScheduling'];
}>;

export function createTransactionConfig(
  input: CreateTransactionConfigInput,
): TransactionRunnerConfig<GameState> {
  const manifest = input.manifest ?? EXECUTION_ORDER_MANIFEST;
  const { contexts } = input;

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
      return (command, ctx) => dispatch(command, ctx.workingState, contexts);
    },

    routeEventSubscribers: (draft): readonly EventSubscriber<GameState>[] => {
      const type = requireMessageType(draft.event, 'routeEventSubscribers');
      const bindings =
        manifest.eventSubscriptionsByType[type as keyof typeof manifest.eventSubscriptionsByType];
      if (bindings === undefined || bindings.length === 0) return [];
      return bindings.map((binding) => {
        const key = `${binding.eventType}::${binding.subscriber}`;
        const dispatch = EVENT_SUBSCRIBERS[key];
        if (dispatch === undefined) {
          throw new Error(`routeEventSubscribers: Manifest 綁定 "${key}" 沒有對應的 Subscriber 實作`);
        }
        return (event, ctx) => dispatch(event, ctx.workingState, contexts);
      });
    },
  };
}
