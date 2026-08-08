// contracts/gathering — public contract transcribed from docs/00_core/architecture/19_gathering_service.md
// 技術元件：domain-services/gathering。純計算 Resolver + Host Workflow DTO；無持久 State。

import type {
  GatheringRuleId,
  GatheringDestinationPolicyId,
  MasteryId,
  ResolverId,
  ExperienceAwardRuleId,
  MapInstanceId,
  GatheringNodeId,
  ContentEventInstanceId,
  EncounterId,
  ItemDefinitionId,
  GatheringResolutionId,
  AssetDistributionId,
  TeamId,
  CharacterId,
  DefinitionId,
  RngContext,
  RngStep,
  DeterministicRng,
  DefinitionHeader,
} from '../core';

// ── core 未列出的共用型別（於此定義；見交接報告）────────────────────────
// RewardSourceId 屬共用核心契約（00_shared_contracts.md），但 core .ts 尚未匯出。
export type RewardSourceId = DefinitionId<'reward-source'>;
// MasteryLevel 概念上屬 progression（等級 0..10）；doc 具名但未匯出，於此以 number 別名承載。
export type MasteryLevel = number;

// ── §2 靜態資料契約 ─────────────────────────────────────────────────────
export interface GatheringDefinitionReader {
  getGatheringRule(id: GatheringRuleId): GatheringRuleDefinition;
}

export type GatheringNpcPolicy =
  | { eligible: false }
  | {
      eligible: true;
      pointCost: number; // 必須 > 0
      resolverId: ResolverId;
    };

export type GatheringRuleDefinition = DefinitionHeader & {
  masteryId: MasteryId; // 第一版指向採集熟練度
  sourceTier: 'I' | 'II' | 'III' | 'IV' | 'V';
  yieldResolverId: ResolverId; // 依等級決定種類與數量
  experienceAwardRuleId: ExperienceAwardRuleId;
  dungeonInteractionMinutes?: number; // 地圖採集點必填
  npcPolicy?: GatheringNpcPolicy;
};

export type GatheringSourceRef =
  | {
      kind: 'mapNode';
      mapId: MapInstanceId;
      mapVersion: number;
      nodeId: GatheringNodeId;
    }
  | {
      kind: 'travelResource';
      contentEventInstanceId: ContentEventInstanceId;
      gatheringRuleId: GatheringRuleId;
    }
  | {
      kind: 'enemyDrop';
      encounterId: EncounterId;
      rewardSourceId: RewardSourceId;
      gatheringRuleId: GatheringRuleId;
    };

export type GatheringYieldEntry = {
  itemDefinitionId: ItemDefinitionId;
  quantity: number;
};

export type GatheringResolution = {
  resolutionId: GatheringResolutionId;
  source: GatheringSourceRef;
  teamId: TeamId;
  participantCharacterIds: CharacterId[];
  contributorCharacterId: CharacterId;
  gatheringRuleId: GatheringRuleId;
  masteryId: MasteryId;
  masteryLevelUsed: MasteryLevel;
  experienceAwardRuleId: ExperienceAwardRuleId;
  yields: GatheringYieldEntry[];
  individualYields?: Array<{
    recipientCharacterId: CharacterId;
    yields: GatheringYieldEntry[];
  }>;
};

// ── §3 純計算 Port（Resolver 輸入 / 輸出）───────────────────────────────
export interface GatheringResolver {
  resolve(input: GatheringResolverInput, rng: DeterministicRng): RngStep<GatheringResolution>;
}

export type GatheringResolverInput = {
  resolutionId: GatheringResolutionId; // 由 Host Workflow 在交易內先配發
  source: GatheringSourceRef;
  teamId: TeamId;
  participantCharacterIds: CharacterId[];
  rule: GatheringRuleDefinition;
  masteryLevels: Record<CharacterId, MasteryLevel>;
  rngContext: RngContext; // gathering:<resolutionId> + cursor 0 的一次性 Context
};

// ── §4.1 Host Workflow 內部正規化 DTO（非訊息 / 非 Job / 非事件）────────
export type GatheringResolutionRequest = {
  resolutionId: GatheringResolutionId;
  source: GatheringSourceRef;
  teamId: TeamId;
  participantCharacterIds: CharacterId[];
  destinationPolicyId: GatheringDestinationPolicyId;
  destination: GatheringDestinationRef;
};

export type GatheringDestinationRef =
  | { kind: 'assetDistribution'; distributionId: AssetDistributionId }
  | { kind: 'characterBag'; characterId: CharacterId }
  | { kind: 'participantCharacterBags'; characterIds: CharacterId[] };

// ── §4.2 輸出 Internal Command payload（唯一處理者為 progression）───────
export type GrantGatheringMasteryExperience = Readonly<{
  resolutionId: GatheringResolutionId;
  contributorCharacterId: CharacterId;
  masteryId: MasteryId;
  experienceAwardRuleId: ExperienceAwardRuleId;
}>;
