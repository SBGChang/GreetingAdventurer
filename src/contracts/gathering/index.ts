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
  // doc §6.2「其他目的地必須由 GatheringDestinationPolicyId 明確指定；未定義目的政策的資料不得啟用」——
  // 政策既然由 ID 定址且決定成果歸向（共同 Distribution 或個人背包），它就是一筆 Definition，
  // 必須有 getter 才拿得到。缺這個 getter 時「共同或個人」只能寫成程式分支（例如依 source.kind 判斷
  // travelResource → 個人背包），那條規則就從資料搬進了 TypeScript。
  getGatheringDestinationPolicy(
    id: GatheringDestinationPolicyId,
  ): GatheringDestinationPolicyDefinition;
}

export type GatheringNpcPolicy =
  | { eligible: false }
  | {
      eligible: true;
      pointCost: number; // 必須 > 0
      resolverId: ResolverId;
    };

// 依 Mastery 等級分段查表的調校資料（doc §11.2「各 Mastery Lv.0～10 的產物 Resolver 是平衡資料」）。
// 形狀對應 data-runtime kernel `thresholdTable`：entries 依 maxMasteryLevel 升冪，取第一個
// masteryLevel <= maxMasteryLevel 的 value；全部不符時取 aboveMaxValue。
export type GatheringMasteryThresholdEntry = Readonly<{
  maxMasteryLevel: MasteryLevel;
  value: number;
}>;

export type GatheringMasteryThresholdTable = Readonly<{
  entries: readonly GatheringMasteryThresholdEntry[];
  aboveMaxValue: number;
}>;

// 素材池一筆權重（doc §11.2「套用 Map Configuration 的 gathering 權重」，各池合計自成一份資料）。
export type GatheringMaterialPoolEntry = Readonly<{
  itemDefinitionId: ItemDefinitionId;
  weight: number; // 必須 > 0；相對權重，不要求合計為特定值
}>;

// yieldResolverId 指名的是「用哪一種產物形狀」；形狀要吃的調校量在此。分開的理由與 kernel params
// 一樣：形狀＝程式、調校＝資料。缺這份 params 時 Resolver 只能自己內建種類數與產量，那正是規範
// 點名的「把內容搬進程式」。
export type GatheringYieldParams = Readonly<{
  distinctEntryCount: GatheringMasteryThresholdTable; // 本次抽出幾**種**素材
  quantityPerEntry: GatheringMasteryThresholdTable; // 每種素材幾個
  pool: readonly GatheringMaterialPoolEntry[]; // 加權抽選的素材池
}>;

export type GatheringRuleDefinition = DefinitionHeader<GatheringRuleId> & {
  masteryId: MasteryId; // 第一版指向採集熟練度
  sourceTier: 'I' | 'II' | 'III' | 'IV' | 'V';
  yieldResolverId: ResolverId; // 依等級決定種類與數量
  yieldParams: GatheringYieldParams; // yieldResolverId 那個形狀的調校量
  experienceAwardRuleId: ExperienceAwardRuleId;
  dungeonInteractionMinutes?: number; // 地圖採集點必填
  npcPolicy?: GatheringNpcPolicy;
};

// 成果歸向：共同成果收集（地圖節點、敵人掉落）或每位參與者各自抽取進個人背包（旅行資源）。
export type GatheringYieldScope = 'sharedResult' | 'perParticipant';

export type GatheringDestinationPolicyDefinition = DefinitionHeader<GatheringDestinationPolicyId> & {
  yieldScope: GatheringYieldScope;
  destinationKind: GatheringDestinationRef['kind'];
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
  // yields = 進入 `GatheringDestinationRef` 的**共同**成果。
  // individualYields 只在 destinationPolicy.yieldScope='perParticipant' 時出現，此時共同成果為空
  // 陣列（成果全數歸個人背包），Host Workflow 依 individualYields 逐一 CreateItemInstance。
  // 兩者刻意不重疊，否則 Host 同時走兩份就會把產物建立兩次。
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
  // Host Workflow 以 GatheringResolutionRequest.destinationPolicyId 經 GatheringDefinitionReader
  // 讀出後傳入（與 rule 同樣是「已讀好的 Definition」，Resolver 本身不持 Reader、保持純函式）。
  destinationPolicy: GatheringDestinationPolicyDefinition;
  masteryLevels: Record<CharacterId, MasteryLevel>;
  rngContext: RngContext; // gathering:<resolutionId> + cursor 0 的一次性 Context
};

// ── 解析失敗的分類（資料不足／不一致一律明確失敗，不得給預設產量）────────────
// Resolver 是純函式、沒有 ModuleOutcome 通道，所以拒絕以本型別回傳給 Host Workflow，
// 由 Host 轉成該筆 Game Command 的 CommandRejection（source 由 Host 的 WorkflowId 填）。
export const GatheringRejectionCode = {
  RuleDisabled: 'gathering.ruleDisabled',
  DestinationPolicyDisabled: 'gathering.destinationPolicyDisabled',
  DestinationPolicyMismatch: 'gathering.destinationPolicyMismatch',
  DestinationPolicyIdMismatch: 'gathering.destinationPolicyIdMismatch',
  DestinationKindMismatch: 'gathering.destinationKindMismatch',
  DestinationRecipientsMismatch: 'gathering.destinationRecipientsMismatch',
  NoParticipants: 'gathering.noParticipants',
  MasteryLevelMissing: 'gathering.masteryLevelMissing',
  MasteryLevelOutOfRange: 'gathering.masteryLevelOutOfRange',
  SourceRuleMismatch: 'gathering.sourceRuleMismatch',
  MapInteractionMinutesMissing: 'gathering.mapInteractionMinutesMissing',
  NpcPolicyInvalid: 'gathering.npcPolicyInvalid',
  MaterialPoolEmpty: 'gathering.materialPoolEmpty',
  MaterialPoolWeightInvalid: 'gathering.materialPoolWeightInvalid',
  DistinctEntryCountInvalid: 'gathering.distinctEntryCountInvalid',
  QuantityInvalid: 'gathering.quantityInvalid',
} as const;

export type GatheringRejectionCode =
  (typeof GatheringRejectionCode)[keyof typeof GatheringRejectionCode];

export type GatheringRejection = Readonly<{
  code: GatheringRejectionCode;
  details: Readonly<Record<string, string | number | boolean>>;
}>;

export type GatheringResolveOutcome =
  | Readonly<{ ok: true; step: RngStep<GatheringResolution> }>
  | Readonly<{ ok: false; rejection: GatheringRejection }>;

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
