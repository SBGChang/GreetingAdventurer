// domain-services/gathering/gathering.ts
// 純計算 GatheringResolver（docs/00_core/architecture/19_gathering_service.md §3）。
//
// 這個服務**沒有 State Slice**、不是模組、不擁有 Domain Event。它只回答一個問題：
// 「給定合法來源、參與者的採集熟練度、一條 Gathering Rule 與一次性 RNG Context，
//   這次採集的採集者是誰、產出什麼、RNG cursor 走到哪裡。」
//
// 三條紀律在本檔的具體樣貌：
//  1. 零數值常數、零素材 ID：種類數與產量是 Mastery 分段查表（kernel thresholdTable + Definition
//     params），素材是加權抽選（權重來自 GatheringYieldParams.pool）。本檔沒有任何倍率、機率或 Item ID。
//  2. 缺資料明確失敗：資料不完整一律回 GatheringRejection，不給預設產量、不回空產物假裝成功。
//     （空產物只有在資料真的說「這個等級抽 0 種」時才出現，那是內容的決定，不是本檔的。）
//  3. RNG 顯式串接：抽選走注入的 DeterministicRng + 傳入的 RngContext，逐次前進 cursor，
//     最終 cursor 由 RngStep.nextCursor 回傳；本檔不持有可變狀態、不呼叫 Math.random／Date.now。

import { MAX_MASTERY_LEVEL, MIN_MASTERY_LEVEL } from '../../contracts/core';
import type {
  CharacterId,
  DeterministicRng,
  RngContext,
  RngCursor,
  RngStep,
  RngStreamId,
} from '../../contracts/core';
import { GatheringRejectionCode } from '../../contracts/gathering';
import type {
  GatheringMasteryThresholdTable,
  GatheringMaterialPoolEntry,
  GatheringDestinationPolicyDefinition,
  GatheringRejection,
  GatheringResolution,
  GatheringResolutionRequest,
  GatheringResolveOutcome,
  GatheringResolver,
  GatheringResolverInput,
  GatheringRuleDefinition,
  GatheringYieldEntry,
  GrantGatheringMasteryExperience,
  MasteryLevel,
} from '../../contracts/gathering';
import { thresholdTable, type ThresholdTableParams } from '../../data-runtime';

// KernelInputs 的鍵名——結構性識別字，不是可調量（kernel 以 inputKey 定址輸入）。
const MASTERY_LEVEL_INPUT = 'masteryLevel';

// ──────────────────────────────────────────────────────────────────────────
// 小工具
// ──────────────────────────────────────────────────────────────────────────

function reject(
  code: GatheringRejection['code'],
  details: GatheringRejection['details'],
): Readonly<{ ok: false; rejection: GatheringRejection }> {
  return { ok: false, rejection: { code, details } };
}

// 穩定排序：CharacterId 以位元組序比較（不用 localeCompare——locale 會讓結果隨環境變動，
// 而 doc §7.5 要求同級時「穩定選出相同 Character」）。
function compareCharacterIds(a: CharacterId, b: CharacterId): number {
  const left = String(a);
  const right = String(b);
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function isNonNegativeInteger(value: number): boolean {
  return Number.isInteger(value) && value >= 0;
}

// Mastery 分段查表 → kernel thresholdTable 的 params 形狀。
function masteryTableParams(table: GatheringMasteryThresholdTable): ThresholdTableParams {
  return {
    inputKey: MASTERY_LEVEL_INPUT,
    entries: table.entries.map((entry) => ({
      maxInclusive: entry.maxMasteryLevel,
      value: entry.value,
    })),
    defaultValue: table.aboveMaxValue,
  };
}

function evaluateMasteryTable(
  table: GatheringMasteryThresholdTable,
  masteryLevel: MasteryLevel,
): number {
  return thresholdTable(masteryTableParams(table), { [MASTERY_LEVEL_INPUT]: masteryLevel });
}

// doc §4.1：旅行資源的各角色一次性子 Stream = `gathering:<resolutionId>:<characterId>`。
// 前綴不在本檔重寫——基礎 streamId 由 Host 依 worldSeed + `gathering:<resolutionId>` 建好後傳入，
// 這裡只在其後追加 characterId，避免兩處各自拼一份而漂移。
export function participantSubStreamId(
  baseStreamId: RngStreamId,
  characterId: CharacterId,
): RngStreamId {
  return `${String(baseStreamId)}:${String(characterId)}` as RngStreamId;
}

// 子 Stream 一律從 cursor 0 起（doc §4.1），且不推進基礎 Stream。
function subStreamContext(base: RngContext, characterId: CharacterId): RngContext {
  return {
    worldSeed: base.worldSeed,
    streamId: participantSubStreamId(base.streamId, characterId),
    cursor: 0 as RngCursor,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// 採集者選擇（doc §3：固定規則，不消耗 RNG）
// ──────────────────────────────────────────────────────────────────────────

export type GatheringParticipantLevel = Readonly<{
  characterId: CharacterId;
  masteryLevel: MasteryLevel;
}>;

// 只比較本次來源提供的參與者；取熟練度最高者，同級以 CharacterId 穩定排序取第一人。
// 傳入的 participants 必須已通過等級驗證（見 validateGatheringInput）。
export function selectGatheringContributor(
  participants: readonly GatheringParticipantLevel[],
): GatheringParticipantLevel | undefined {
  let best: GatheringParticipantLevel | undefined;
  for (const candidate of participants) {
    if (best === undefined) {
      best = candidate;
      continue;
    }
    if (candidate.masteryLevel > best.masteryLevel) {
      best = candidate;
      continue;
    }
    if (
      candidate.masteryLevel === best.masteryLevel &&
      compareCharacterIds(candidate.characterId, best.characterId) < 0
    ) {
      best = candidate;
    }
  }
  return best;
}

// ──────────────────────────────────────────────────────────────────────────
// 輸入驗證（規範：缺資料只能明確失敗）
// ──────────────────────────────────────────────────────────────────────────

export type GatheringInputValidation =
  | Readonly<{ ok: true; participants: readonly GatheringParticipantLevel[] }>
  | Readonly<{ ok: false; rejection: GatheringRejection }>;

// 回傳「已排序且等級齊備」的參與者清單，或第一個違規的 typed rejection。
// 這支是純函式，Host Workflow 可以在配發 ResolutionId 之前先驗一次，把拒絕呈現給玩家。
export function validateGatheringInput(input: GatheringResolverInput): GatheringInputValidation {
  const rule = input.rule;

  if (!rule.enabled) {
    return reject(GatheringRejectionCode.RuleDisabled, { gatheringRuleId: String(rule.id) });
  }
  if (!input.destinationPolicy.enabled) {
    return reject(GatheringRejectionCode.DestinationPolicyDisabled, {
      destinationPolicyId: String(input.destinationPolicy.id),
    });
  }

  // 目的政策自我一致：逐人抽取只能落到參與者背包；共同成果不得宣告成逐人背包。
  const perParticipant = input.destinationPolicy.yieldScope === 'perParticipant';
  const bagsKind = input.destinationPolicy.destinationKind === 'participantCharacterBags';
  if (perParticipant !== bagsKind) {
    return reject(GatheringRejectionCode.DestinationPolicyMismatch, {
      destinationPolicyId: String(input.destinationPolicy.id),
      yieldScope: input.destinationPolicy.yieldScope,
      destinationKind: input.destinationPolicy.destinationKind,
    });
  }

  // 來源自帶 gatheringRuleId 的兩種（旅行資源、敵人掉落）必須與傳入的 Rule 同一筆，
  // 否則 Host 讀錯了規則——不是「以傳入的為準」可以蓋過去的事。
  if (input.source.kind !== 'mapNode' && String(input.source.gatheringRuleId) !== String(rule.id)) {
    return reject(GatheringRejectionCode.SourceRuleMismatch, {
      sourceKind: input.source.kind,
      sourceGatheringRuleId: String(input.source.gatheringRuleId),
      ruleId: String(rule.id),
    });
  }

  // doc §2 資料驗證 1：地圖採集 Rule 的 dungeonInteractionMinutes 為正整數。
  if (input.source.kind === 'mapNode') {
    const minutes = rule.dungeonInteractionMinutes;
    if (minutes === undefined || !Number.isInteger(minutes) || minutes <= 0) {
      return reject(GatheringRejectionCode.MapInteractionMinutesMissing, {
        gatheringRuleId: String(rule.id),
      });
    }
  }

  // doc §2 資料驗證 4：NPC 可採時必須有正數 pointCost 與合法 resolverId。
  const npcPolicy = rule.npcPolicy;
  if (npcPolicy !== undefined && npcPolicy.eligible) {
    const badCost = !Number.isInteger(npcPolicy.pointCost) || npcPolicy.pointCost <= 0;
    const badResolver = String(npcPolicy.resolverId).length === 0;
    if (badCost || badResolver) {
      return reject(GatheringRejectionCode.NpcPolicyInvalid, {
        gatheringRuleId: String(rule.id),
        pointCost: npcPolicy.pointCost,
      });
    }
  }

  if (input.participantCharacterIds.length === 0) {
    return reject(GatheringRejectionCode.NoParticipants, { teamId: String(input.teamId) });
  }

  const sorted = [...input.participantCharacterIds].sort(compareCharacterIds);
  const participants: GatheringParticipantLevel[] = [];
  for (const characterId of sorted) {
    const masteryLevel = input.masteryLevels[characterId];
    if (masteryLevel === undefined) {
      // 熟練度是 progression 的事實；缺一位參與者的等級代表 Host 沒查齊，不能當 0 級補上。
      return reject(GatheringRejectionCode.MasteryLevelMissing, {
        characterId: String(characterId),
        masteryId: String(rule.masteryId),
      });
    }
    if (
      !Number.isInteger(masteryLevel) ||
      masteryLevel < MIN_MASTERY_LEVEL ||
      masteryLevel > MAX_MASTERY_LEVEL
    ) {
      return reject(GatheringRejectionCode.MasteryLevelOutOfRange, {
        characterId: String(characterId),
        masteryLevel,
      });
    }
    participants.push({ characterId, masteryLevel });
  }

  const poolCheck = validateMaterialPool(rule);
  if (poolCheck !== undefined) return { ok: false, rejection: poolCheck };

  return { ok: true, participants };
}

function validateMaterialPool(rule: GatheringRuleDefinition): GatheringRejection | undefined {
  const pool = rule.yieldParams.pool;
  if (pool.length === 0) {
    return { code: GatheringRejectionCode.MaterialPoolEmpty, details: { ruleId: String(rule.id) } };
  }
  for (const entry of pool) {
    if (!Number.isFinite(entry.weight) || entry.weight <= 0) {
      return {
        code: GatheringRejectionCode.MaterialPoolWeightInvalid,
        details: {
          ruleId: String(rule.id),
          itemDefinitionId: String(entry.itemDefinitionId),
          weight: entry.weight,
        },
      };
    }
  }
  return undefined;
}

// ──────────────────────────────────────────────────────────────────────────
// 目的地檢查（doc §4.1 的 Host DTO；成果歸向必須與政策一致）
// ──────────────────────────────────────────────────────────────────────────

// GatheringResolutionRequest 是 Host Workflow 的本地 DTO，它同時帶著「政策 ID」與「實際目的地」。
// 兩者對不上時不能以任一方為準——那會讓成果落到政策沒授權的位置。純函式，供 Host 在配發
// CreateItemInstance / AppendAssetDistributionResult 之前先檢查。
export function validateGatheringDestination(
  request: GatheringResolutionRequest,
  policy: GatheringDestinationPolicyDefinition,
): GatheringRejection | undefined {
  if (String(request.destinationPolicyId) !== String(policy.id)) {
    return {
      code: GatheringRejectionCode.DestinationPolicyIdMismatch,
      details: {
        requestPolicyId: String(request.destinationPolicyId),
        policyId: String(policy.id),
      },
    };
  }
  if (request.destination.kind !== policy.destinationKind) {
    return {
      code: GatheringRejectionCode.DestinationKindMismatch,
      details: {
        destinationKind: request.destination.kind,
        policyDestinationKind: policy.destinationKind,
      },
    };
  }
  if (request.destination.kind === 'participantCharacterBags') {
    const declared = [...request.destination.characterIds].sort(compareCharacterIds).map(String);
    const participants = [...request.participantCharacterIds].sort(compareCharacterIds).map(String);
    if (declared.join(',') !== participants.join(',')) {
      return {
        code: GatheringRejectionCode.DestinationRecipientsMismatch,
        details: { declared: declared.join(','), participants: participants.join(',') },
      };
    }
  }
  return undefined;
}

// ──────────────────────────────────────────────────────────────────────────
// 加權抽選 + 產量（形狀）
// ──────────────────────────────────────────────────────────────────────────

// 依權重抽一筆。權重全為正、total > 0 由 validateMaterialPool 保證。
// entries 為空時回 undefined——不編一筆素材出來，由呼叫端轉成 rejection。
function weightedPick(
  entries: readonly GatheringMaterialPoolEntry[],
  rng: DeterministicRng,
  context: RngContext,
): Readonly<{ entry: GatheringMaterialPoolEntry; index: number; nextCursor: RngCursor }> | undefined {
  let total = 0;
  for (const entry of entries) total += entry.weight;
  const step = rng.nextFloat({
    worldSeed: context.worldSeed,
    streamId: context.streamId,
    cursor: context.cursor,
  });
  const target = step.value * total;
  let acc = 0;
  let last: Readonly<{ entry: GatheringMaterialPoolEntry; index: number }> | undefined;
  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i];
    if (entry === undefined) continue; // noUncheckedIndexedAccess
    last = { entry, index: i };
    acc += entry.weight;
    if (target < acc) return { entry, index: i, nextCursor: step.nextCursor };
  }
  // target < total 且權重皆為正 → 迴圈必定命中；浮點累加誤差時歸最後一筆。
  return last === undefined ? undefined : { ...last, nextCursor: step.nextCursor };
}

type YieldDraw =
  | Readonly<{ ok: true; yields: GatheringYieldEntry[]; nextCursor: RngCursor }>
  | Readonly<{ ok: false; rejection: GatheringRejection }>;

// 一份產物：抽 distinctEntryCount 種**不重複**素材，每種給 quantityPerEntry 個。
// 兩個數字都由 Mastery 等級查表得到（資料）；本函式只負責「抽選與計數」這個形狀。
function drawYields(
  rule: GatheringRuleDefinition,
  masteryLevel: MasteryLevel,
  rng: DeterministicRng,
  context: RngContext,
): YieldDraw {
  const pool = rule.yieldParams.pool;
  const distinctCount = evaluateMasteryTable(rule.yieldParams.distinctEntryCount, masteryLevel);
  if (!isNonNegativeInteger(distinctCount) || distinctCount > pool.length) {
    return reject(GatheringRejectionCode.DistinctEntryCountInvalid, {
      ruleId: String(rule.id),
      masteryLevel,
      distinctCount,
      poolSize: pool.length,
    });
  }

  const quantity = evaluateMasteryTable(rule.yieldParams.quantityPerEntry, masteryLevel);
  if (!isNonNegativeInteger(quantity) || (distinctCount > 0 && quantity === 0)) {
    return reject(GatheringRejectionCode.QuantityInvalid, {
      ruleId: String(rule.id),
      masteryLevel,
      quantity,
    });
  }

  const remaining = [...pool];
  const yields: GatheringYieldEntry[] = [];
  let cursor = context.cursor;
  for (let i = 0; i < distinctCount; i += 1) {
    const pick = weightedPick(remaining, rng, { ...context, cursor });
    if (pick === undefined) {
      // 抽到一半沒素材可抽＝資料要求的種類數超過池子能提供的。不得少給幾筆當成功。
      return reject(GatheringRejectionCode.MaterialPoolEmpty, {
        ruleId: String(rule.id),
        drawIndex: i,
        distinctCount,
      });
    }
    cursor = pick.nextCursor;
    remaining.splice(pick.index, 1);
    yields.push({ itemDefinitionId: pick.entry.itemDefinitionId, quantity });
  }
  return { ok: true, yields, nextCursor: cursor };
}

// ──────────────────────────────────────────────────────────────────────────
// 解析入口
// ──────────────────────────────────────────────────────────────────────────

// Host Workflow 用的完整入口：拒絕以 GatheringRejection 回傳（不丟例外）。
export function resolveGathering(
  input: GatheringResolverInput,
  rng: DeterministicRng,
): GatheringResolveOutcome {
  const validation = validateGatheringInput(input);
  if (!validation.ok) return validation;

  const contributor = selectGatheringContributor(validation.participants);
  if (contributor === undefined) {
    // participants 非空由 validateGatheringInput 保證，此處僅為型別收斂。
    return reject(GatheringRejectionCode.NoParticipants, { teamId: String(input.teamId) });
  }

  const rule = input.rule;
  const base: Omit<GatheringResolution, 'yields' | 'individualYields'> = {
    resolutionId: input.resolutionId,
    source: input.source,
    teamId: input.teamId,
    participantCharacterIds: [...input.participantCharacterIds],
    contributorCharacterId: contributor.characterId,
    gatheringRuleId: sourceGatheringRuleId(input),
    masteryId: rule.masteryId,
    masteryLevelUsed: contributor.masteryLevel,
    experienceAwardRuleId: rule.experienceAwardRuleId,
  };

  if (input.destinationPolicy.yieldScope === 'perParticipant') {
    // doc §4.1：以全隊最高採集等級為基準，每位參與者各自在自己的一次性子 Stream 抽一份，
    // 直接進個人背包；子 Stream 不共享也不推進基礎 Stream，故 nextCursor 維持傳入值。
    const individualYields: NonNullable<GatheringResolution['individualYields']> = [];
    for (const participant of validation.participants) {
      const draw = drawYields(
        rule,
        contributor.masteryLevel,
        rng,
        subStreamContext(input.rngContext, participant.characterId),
      );
      if (!draw.ok) return draw;
      individualYields.push({
        recipientCharacterId: participant.characterId,
        yields: draw.yields,
      });
    }
    const resolution: GatheringResolution = { ...base, yields: [], individualYields };
    return { ok: true, step: { value: resolution, nextCursor: input.rngContext.cursor } };
  }

  const draw = drawYields(rule, contributor.masteryLevel, rng, input.rngContext);
  if (!draw.ok) return draw;
  const resolution: GatheringResolution = { ...base, yields: draw.yields };
  return { ok: true, step: { value: resolution, nextCursor: draw.nextCursor } };
}

// GatheringResolution.gatheringRuleId 一律取自來源自帶的 ID（旅行／敵人掉落），
// 地圖節點來源沒有自帶 ID，改取傳入 Rule 的 ID。兩者已由 validateGatheringInput 確認一致。
function sourceGatheringRuleId(input: GatheringResolverInput): GatheringResolution['gatheringRuleId'] {
  return input.source.kind === 'mapNode' ? input.rule.id : input.source.gatheringRuleId;
}

// 契約介面 GatheringResolver 的實作：resolve 沒有拒絕通道，故資料不合法時明確拋錯。
// Host Workflow 應改用 resolveGathering 取得 typed rejection；本工廠供「已驗過資料」的呼叫端使用。
export class GatheringResolutionError extends Error {
  readonly rejection: GatheringRejection;

  constructor(rejection: GatheringRejection) {
    super(`gathering: ${rejection.code} ${JSON.stringify(rejection.details)}`);
    this.name = 'GatheringResolutionError';
    this.rejection = rejection;
  }
}

export function createGatheringResolver(): GatheringResolver {
  return {
    resolve(input: GatheringResolverInput, rng: DeterministicRng): RngStep<GatheringResolution> {
      const outcome = resolveGathering(input, rng);
      if (!outcome.ok) throw new GatheringResolutionError(outcome.rejection);
      return outcome.step;
    },
  };
}

// ──────────────────────────────────────────────────────────────────────────
// 輸出 Internal Command payload（doc §4.2；唯一處理者為 progression）
// ──────────────────────────────────────────────────────────────────────────

// 只有 contributorCharacterId 取得採集 MXP（doc §7 不變量 6）：即使 individualYields 有多位收件者，
// 本函式仍只產出一筆。冪等來源 = resolutionId + contributorCharacterId + masteryId，三者都取自
// Resolution，而 Resolution 對同一 resolutionId 是決定性的 → 重播得到同一把 key，
// progression 的 grantLedger 因此不會重複發放。
export function toGrantGatheringMasteryExperience(
  resolution: GatheringResolution,
): GrantGatheringMasteryExperience {
  return {
    resolutionId: resolution.resolutionId,
    contributorCharacterId: resolution.contributorCharacterId,
    masteryId: resolution.masteryId,
    experienceAwardRuleId: resolution.experienceAwardRuleId,
  };
}
