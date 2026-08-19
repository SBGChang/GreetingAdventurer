// modules/npc-behavior/public.ts
// NPC Behavior 模組對外唯一入口：re-export 執行期 API + 公開契約 + ModuleContract 宣告。
// Composition 只從這裡取得工廠、Handler、Query 與 ModuleContract；不得深入 import 內部檔案。

import type {
  ModuleContract,
  ModuleId,
  StateSliceName,
  ReaderPortId,
  EventSubscriptionId,
  InvariantId,
} from '../../contracts/core';

import {
  NPC_BEHAVIOR_SUBSCRIPTION_TEAM_MEMBER_DEPARTED,
  NPC_BEHAVIOR_SUBSCRIPTION_TEAM_PLAN_COMPLETED,
} from './system';

// 公開契約（型別）——原樣轉出，讓消費者只從模組入口取用。
export type * from '../../contracts/npc-behavior';

// ── State ─────────────────────────────────────────────────────────────────––
export {
  emptyNpcBehaviorState,
  createNpcBehaviorState,
  createController,
  createChain,
  tryGetController,
  upsertController,
  tryGetChain,
  upsertChain,
  activeChainForTeam,
  upsertMarketIntent,
  listMarketIntentsForTeam,
  nodeAt,
  withNode,
  nextDay,
  addDays,
  bump,
} from './state';
export type { NpcBehaviorState } from './state';

// ── Query ─────────────────────────────────────────────────────────────────––
export { createNpcBehaviorQuery } from './queries';

// ── System（Job + Subscriber + Job draft + Deps）────────────────────────────
export {
  NPC_BEHAVIOR_MODULE_ID,
  NPC_BEHAVIOR_SUBSCRIPTION_TEAM_PLAN_COMPLETED,
  NPC_BEHAVIOR_SUBSCRIPTION_TEAM_MEMBER_DEPARTED,
  // Job handler
  npcDecisionDue,
  npcChainAdvance,
  // Event subscriber
  onTeamPlanCompleted,
  onTeamMemberDeparted,
  // Job draft 建構（Bootstrap 為每個新 Controller 排第一筆 npcDecisionDue 時使用，
  // 讓 payload／ownerModule／rngContext 的形狀只有一個來源）
  decisionJobDraft,
  chainAdvanceJobDraft,
} from './system';
export type {
  NpcBehaviorContext,
  NpcBehaviorHandlerResult,
  NpcBehaviorTeamPort,
  NpcBehaviorWorldPort,
  NpcBehaviorConditionPort,
  NpcBehaviorResolverPort,
  NpcBehaviorIdAllocator,
  NpcDecisionSubject,
  NpcResolvedValue,
} from './system';

// ── ModuleContract 宣告（doc §7 交接清單對照）────────────────────────────────
//
// 只宣告**閉合**的能力。以下能力刻意不出現在這份契約裡，理由都是同一種：它們的執行者
// （接收 Internal Command 的模組）目前不存在或不註冊該命令，宣告送出一個沒人收的命令
// 等於保證那條流程跑不完（registry 的「送出端 → Owner」交叉驗證也會直接失敗）：
//
//   * 接任務／任務鎖定／任務結案（ClaimQuestForNpcTeam／AcceptQuestForNpcTeam／
//     ReleaseNpcQuestClaim／SettleQuestForNpcTeam）—— quest 模組不存在，
//     `QuestQuery.listNpcClaimablePostings`／`isMapReservedForAcceptedQuest` 也拿不到。
//   * NPC 地牢 Run（StartNpcDungeonRun）—— dungeon 的 handlesInternalCommands 為空。
//   * 城市自由活動的個別成員行為與市場 Intent（AssignNpcMemberFreeAction）——
//     team 宣告不接收該命令，且 NPC Market Workflow 不存在。
//
// 因此 `executeNearbyAdventure`／`acceptNearbyQuest` 等節點 kind 的啟動路徑會回明確 rejection，
// 由 Chain 以 `aborted` + 理由碼收斂（見 system.ts 的 startNode）；不會假裝節點跑掉了。
export const npcBehaviorModuleContract: ModuleContract = {
  id: 'npc-behavior' as ModuleId<'npc-behavior'>,
  owns: 'npcBehavior' as StateSliceName,
  reads: [
    'reader:npc-behavior-definition' as ReaderPortId,
    'reader:team-query' as ReaderPortId,
    'reader:world-query' as ReaderPortId,
    'reader:npc-condition' as ReaderPortId,
    'reader:npc-decision-resolver' as ReaderPortId,
  ],
  handlesGameCommands: [],
  handlesInternalCommands: [],
  handlesJobs: ['npcDecisionDue', 'npcChainAdvance'],
  sendsInternalCommands: ['StartNpcTeamPlan'],
  subscriptionHandlerIds: [
    NPC_BEHAVIOR_SUBSCRIPTION_TEAM_PLAN_COMPLETED as EventSubscriptionId,
    NPC_BEHAVIOR_SUBSCRIPTION_TEAM_MEMBER_DEPARTED as EventSubscriptionId,
  ],
  emits: ['NpcIntentSelected', 'NpcActionChainChanged'],
  invariants: [
    // 不變量 1：每支 NPC Team 至多一個 active Chain；玩家 Team 不可持有 Controller。
    'npcBehavior.oneActiveChainPerTeam' as InvariantId,
    'npcBehavior.controllerOnlyForNpcTeams' as InvariantId,
    // 不變量 4：每一節都有完成／中止路徑，不允許永久 waiting。
    'npcBehavior.nodeHasTerminalPath' as InvariantId,
    // 不變量 10：非自由 Chain 完成後必定先進入資料化的強制自由期。
    'npcBehavior.forcedFreePeriodAfterNonFreeChain' as InvariantId,
    // 不變量 11：NPC 旅行 Plan 不得出現玩家旅行模式或事件資料。
    'npcBehavior.npcTravelCarriesNoPlayerTravelData' as InvariantId,
    // 排程不變量：npcDecisionDue 的每一條返回路徑都恰好重排一筆（Controller 存在時），
    // 否則該 NPC 從此停止思考。
    'npcBehavior.decisionJobAlwaysRearmed' as InvariantId,
  ],
};

// ── Fixtures／Tests 不由 public.ts 對外 ───────────────────────────────────────
// public.ts 是模組的**正式對外面**。從這裡再匯出 fixtures 或 test runner，等於讓正式依賴圖
// 可以走到測試資料。測試請直接 import './fixtures' 與 './npc-behavior.test'。
