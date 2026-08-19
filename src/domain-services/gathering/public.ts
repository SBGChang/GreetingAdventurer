// domain-services/gathering/public.ts
// Gathering 純服務的唯一對外面。
//
// **沒有 ModuleContract**：gathering 不擁有 GameState Slice、不接收 Command、不排 Job、
// 不訂閱事件、不發 Domain Event（doc §1 與 §4.2）。它只提供純計算，由各來源的 Host Workflow
// 在自己的交易內呼叫。因此本檔沒有 `owns` / `handles*` 可登記，也刻意不假造一份 contract。

export type {
  GatheringInputValidation,
  GatheringParticipantLevel,
} from './gathering';
export {
  GatheringResolutionError,
  createGatheringResolver,
  participantSubStreamId,
  resolveGathering,
  selectGatheringContributor,
  toGrantGatheringMasteryExperience,
  validateGatheringDestination,
  validateGatheringInput,
} from './gathering';

// 契約型別的轉出口，讓 Host Workflow 只需認識這一個入口。
export type {
  GatheringDefinitionReader,
  GatheringDestinationPolicyDefinition,
  GatheringDestinationRef,
  GatheringMasteryThresholdEntry,
  GatheringMasteryThresholdTable,
  GatheringMaterialPoolEntry,
  GatheringNpcPolicy,
  GatheringRejection,
  GatheringResolution,
  GatheringResolutionRequest,
  GatheringResolveOutcome,
  GatheringResolver,
  GatheringResolverInput,
  GatheringRuleDefinition,
  GatheringSourceRef,
  GatheringYieldEntry,
  GatheringYieldParams,
  GatheringYieldScope,
  GrantGatheringMasteryExperience,
  MasteryLevel,
  RewardSourceId,
} from '../../contracts/gathering';
export { GatheringRejectionCode } from '../../contracts/gathering';
