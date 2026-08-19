// modules/social/public.ts
// Social 模組對外唯一入口：re-export 執行期 API + 公開契約 + ModuleContract 宣告。
// Composition 只從這裡取得工廠、Handler、Query 與 ModuleContract；不得深入 import 內部檔案。

import type {
  ModuleContract,
  ModuleId,
  StateSliceName,
  ReaderPortId,
  InvariantId,
} from '../../contracts/core';

// 公開契約（型別）——原樣轉出，讓消費者只從模組入口取用。
export type * from '../../contracts/social';

// ── State ────────────────────────────────────────────────────────────────────
export {
  createInitialSocialState,
  createSocialState,
  tryGetAffinity,
  upsertAffinity,
  listAffinities,
  clampAffinity,
  usageForDay,
  completedCountForDay,
  isInteractionApplied,
  setConversationUsage,
  bump,
} from './state';
export type { SocialState, PlayerAffinityState, PlayerConversationDailyUsage } from './state';

// ── Query ────────────────────────────────────────────────────────────────────
export { createSocialQuery } from './queries';
export type { SocialQueryDeps } from './queries';

// ── System（Handler + Ports）─────────────────────────────────────────────────
export {
  SOCIAL_MODULE_ID,
  // Game Command handlers
  handleInteractWithAdventurer,
  handleProposeMarriageToTeamMember,
  // Internal Command handlers
  handleProvisionPlayerAffinity,
  handleConsumePlayerConversationAllowance,
} from './system';
export type {
  SocialHandlerContext,
  SocialHandlerResult,
  SocialIdAllocator,
  SocialTeamQuery,
  SocialResolverPort,
  SocialDeterministicResolverPort,
} from './system';

// ── ModuleContract 宣告（doc §8 交接清單對照）────────────────────────────────
// 事件綁定與執行順序由 Composition Manifest 唯一擁有；此處只宣告本模組可提供的 Handler。
//
// 沒有 Job：doc §1 明訂每日用量的重置點由世界日推導（世界日或玩家主角改變即整筆替換），
// 因此不需要午夜歸零 Job；也沒有訂閱者——PlayerConversationCompleted 與 PlayerAffinityChanged
// 的訂閱端是 progression／economy／ui，不是 social 自己。
export const socialModuleContract: ModuleContract = {
  id: 'social' as ModuleId<'social'>,
  owns: 'social' as StateSliceName,
  reads: [
    'reader:social-definition' as ReaderPortId,
    'reader:team-query' as ReaderPortId,
  ],
  handlesGameCommands: ['interactWithAdventurer', 'proposeMarriageToTeamMember'],
  handlesInternalCommands: ['ProvisionPlayerAffinity', 'ConsumePlayerConversationAllowance'],
  handlesJobs: [],
  // 婚姻成功只能透過 character 的 CreatePartnerFamilyLink 建立（doc 不變量 6）。
  sendsInternalCommands: ['CreatePartnerFamilyLink'],
  subscriptionHandlerIds: [],
  emits: ['PlayerConversationCompleted', 'PlayerAffinityChanged'],
  invariants: [
    'social.oneAffinityPerAdventurer' as InvariantId,
    'social.affinityClampedToRule' as InvariantId,
    'social.singleDailyConversationUsage' as InvariantId,
    'social.interactionAppliedAtMostOnce' as InvariantId,
    'social.playerProposalUsesNoRng' as InvariantId,
    'social.rejectedInteractionConsumesNothing' as InvariantId,
    'social.playerCharacterHasNoUsableAffinity' as InvariantId,
  ],
};

// ── Fixtures／Tests 不由 public.ts 對外 ──────────────────────────────────────
// public.ts 是模組的**正式對外面**。從這裡再匯出 fixtures 或 test runner，等於讓正式依賴圖
// 可以走到測試資料。測試請直接 import './fixtures' 與 './social.test'。
