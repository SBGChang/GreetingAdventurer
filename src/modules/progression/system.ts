// modules/progression/system.ts
// Progression 純函式 handler／subscriber 與成長核心。
// 對應 docs/00_core/architecture/06_progression_module.md §5、§6、§7。
//
// 所有函式皆為 deterministic pure：只讀入參數（state / payload / reader），
// 回傳新的 slice 與待送訊息，不做 I/O、不改動輸入。
// 每個 handler 回傳 ModuleResult<ProgressionModuleState>；其 nextSlice 結構性
// 即滿足契約 ProgressionState（見 state.ts 說明）。

import type {
  CharacterId,
  MasteryId,
  DefinitionId,
  Revision,
  ModuleResult,
  TransactionMessageDraft,
  DomainEventDraft,
} from '../../contracts/core';
import type {
  ProgressionDefinitionReader,
  MasteryDefinition,
  MasteryCurveDefinition,
  CharacterProgression,
  MasteryProgress,
  PrimaryAttributeId,
  PrimaryAttributes,
  MasterySource,
} from '../../contracts/progression';
import type { GrantGatheringMasteryExperience } from '../../contracts/gathering';
// mastery-earned payloads 由 combat-sequence 擁有（combat 與 combat-sequence 都發此事件）；從擁有者引用。
import type {
  CombatAttackMasteryEarnedPayload,
  CombatDefenseMasteryEarnedPayload,
  CombatSupportMasteryEarnedPayload,
  CombatMasterySource,
} from '../../contracts/combat-sequence';
import type { CraftingCompletedEvent } from '../../contracts/crafting';

import type { ProgressionModuleState } from './state';
import {
  createCharacterProgression,
  createMasteryProgress,
  gatheringGrantKey,
} from './state';

// ──────────────────────────────────────────────────────────────────────────
// 主屬鍵集合與零值
// ──────────────────────────────────────────────────────────────────────────

const PRIMARY_ATTRIBUTE_IDS: readonly PrimaryAttributeId[] = [
  'muscle',
  'intelligence',
  'reaction',
  'coordination',
  'charisma',
];

const MAX_LEVEL = 10;
const MAX_ATTRIBUTE = 100;

function zeroAttributes(): PrimaryAttributes {
  return { muscle: 0, intelligence: 0, reaction: 0, coordination: 0, charisma: 0 };
}

// ──────────────────────────────────────────────────────────────────────────
// 純計算：等級、主屬貢獻、主屬推導
// ──────────────────────────────────────────────────────────────────────────

// 由 curve + experience 解析等級：最大的 i 使 thresholds[i] <= experience，夾在 0..maxLevel。
// 不變量 §3.5.1：level 必須可由 curve + experience 驗證。
export function resolveLevel(curve: MasteryCurveDefinition, experience: number): number {
  const thresholds = curve.cumulativeExperienceThresholds;
  let level = 0;
  for (let i = 0; i < thresholds.length && i <= MAX_LEVEL; i += 1) {
    const threshold = thresholds[i];
    if (threshold !== undefined && experience >= threshold) {
      level = i;
    } else {
      break;
    }
  }
  return level;
}

// 某 Mastery 在目前等級對各主屬的貢獻：各級新增值由 Lv.0 累加到目前等級（doc §2.2「各級新增值累加」）。
export function masteryAttributeContribution(
  def: MasteryDefinition,
  level: number,
): PrimaryAttributes {
  const out = zeroAttributes();
  const gainsByLevel = def.primaryAttributeGainsByLevel;
  const upTo = Math.min(level, gainsByLevel.length - 1);
  for (let i = 0; i <= upTo; i += 1) {
    const gains = gainsByLevel[i];
    if (gains === undefined) continue;
    for (const attr of PRIMARY_ATTRIBUTE_IDS) {
      const g = gains[attr];
      if (g !== undefined) out[attr] += g;
    }
  }
  return out;
}

// 推導五主屬：Σ 所有 Mastery 依目前等級的該屬貢獻，各自 min(100)。
// doc §3.2：主屬是推導值；溢出不轉給其他屬性。charisma 只由 mastery 帶來（不折入 reputation）。
export function derivePrimaryAttributes(
  progression: CharacterProgression,
  reader: ProgressionDefinitionReader,
): PrimaryAttributes {
  const total = zeroAttributes();
  for (const masteryId of Object.keys(progression.masteries) as MasteryId[]) {
    const mp = progression.masteries[masteryId];
    if (mp === undefined) continue;
    const def = reader.getMastery(masteryId);
    const contribution = masteryAttributeContribution(def, mp.level);
    for (const attr of PRIMARY_ATTRIBUTE_IDS) {
      total[attr] += contribution[attr];
    }
  }
  for (const attr of PRIMARY_ATTRIBUTE_IDS) {
    total[attr] = Math.min(MAX_ATTRIBUTE, total[attr]);
  }
  return total;
}

// ──────────────────────────────────────────────────────────────────────────
// ModuleResult 工具
// ──────────────────────────────────────────────────────────────────────────

function eventDraft<T>(event: T): DomainEventDraft<T> {
  return { event };
}

function emptyResult(state: ProgressionModuleState): ModuleResult<ProgressionModuleState> {
  return { nextSlice: state, outgoingMessages: [], scheduledJobs: [] };
}

// ──────────────────────────────────────────────────────────────────────────
// 成長核心：對單一角色單一 Mastery 施加 MXP，重算等級、主屬、自動解鎖
// ──────────────────────────────────────────────────────────────────────────

export type ApplyMasteryExperienceInput = Readonly<{
  characterId: CharacterId;
  masteryId: MasteryId;
  amount: number; // 已完成年齡倍率／規則換算後的最終 MXP
  source: MasterySource;
}>;

// 純函式：回傳新的角色成長 + 本次要送的事件 draft。
function applyOne(
  progression: CharacterProgression,
  input: ApplyMasteryExperienceInput,
  reader: ProgressionDefinitionReader,
): Readonly<{ next: CharacterProgression; messages: TransactionMessageDraft[] }> {
  const messages: TransactionMessageDraft[] = [];
  const existing = progression.masteries[input.masteryId] ?? createMasteryProgress(input.masteryId);

  const def = reader.getMastery(input.masteryId);
  const curve = reader.getMasteryCurve(def.curveId);

  const oldLevel = existing.level;
  const oldAttributes = derivePrimaryAttributes(progression, reader);

  const newExperience = existing.experience + input.amount;
  const newLevel = resolveLevel(curve, newExperience);

  const nextMastery: MasteryProgress = {
    masteryId: input.masteryId,
    experience: newExperience,
    level: newLevel,
    revision: (existing.revision + 1) as Revision,
  };

  const nextMasteries: Record<MasteryId, MasteryProgress> = {
    ...progression.masteries,
    [input.masteryId]: nextMastery,
  };

  // 自動知識解鎖：升級跨越的 atLevel 一律解鎖並寫入 learnedKnowledgeIds（doc §7.2）。
  const unlockedKnowledgeIds: DefinitionId[] = [];
  if (newLevel > oldLevel) {
    for (const unlock of def.automaticKnowledgeUnlocks) {
      if (unlock.atLevel > oldLevel && unlock.atLevel <= newLevel) {
        if (!progression.learnedKnowledgeIds.includes(unlock.knowledgeId)) {
          unlockedKnowledgeIds.push(unlock.knowledgeId);
        }
      }
    }
  }

  const next: CharacterProgression = {
    ...progression,
    masteries: nextMasteries,
    learnedKnowledgeIds:
      unlockedKnowledgeIds.length > 0
        ? [...progression.learnedKnowledgeIds, ...unlockedKnowledgeIds]
        : progression.learnedKnowledgeIds,
    revision: (progression.revision + 1) as Revision,
  };

  // §8 輸出事件（tagged draft：core union 由 composition 收斂，此處以 unknown 承載）。
  messages.push(
    eventDraft({
      type: 'MasteryExperienceGranted',
      characterId: input.characterId,
      masteryId: input.masteryId,
      amount: input.amount,
      source: input.source,
    }),
  );

  if (newLevel !== oldLevel) {
    messages.push(
      eventDraft({
        type: 'MasteryLevelChanged',
        characterId: input.characterId,
        masteryId: input.masteryId,
        oldLevel,
        newLevel,
      }),
    );

    const newAttributes = derivePrimaryAttributes(next, reader);
    if (!attributesEqual(oldAttributes, newAttributes)) {
      messages.push(
        eventDraft({
          type: 'PrimaryAttributesChanged',
          characterId: input.characterId,
          attributes: newAttributes,
        }),
      );
      messages.push(
        eventDraft({ type: 'ProgressionCapacityChanged', characterId: input.characterId }),
      );
    }

    for (const knowledgeId of unlockedKnowledgeIds) {
      messages.push(
        eventDraft({
          type: 'AutomaticKnowledgeUnlocked',
          characterId: input.characterId,
          knowledgeId,
        }),
      );
    }
  }

  return { next, messages };
}

function attributesEqual(a: PrimaryAttributes, b: PrimaryAttributes): boolean {
  for (const attr of PRIMARY_ATTRIBUTE_IDS) {
    if (a[attr] !== b[attr]) return false;
  }
  return true;
}

// state 層包裝：確保角色成長存在，套用 applyOne，寫回 characterProgress。
export function awardMasteryExperience(
  state: ProgressionModuleState,
  input: ApplyMasteryExperienceInput,
  reader: ProgressionDefinitionReader,
): ModuleResult<ProgressionModuleState> {
  if (input.amount <= 0) {
    // 非正向來源不改變 state（例如城市教師不高於學員 → 原始 MXP 0）。
    return emptyResult(state);
  }

  const current =
    state.characterProgress[input.characterId] ?? createCharacterProgression(input.characterId);
  const { next, messages } = applyOne(current, input, reader);

  const nextState: ProgressionModuleState = {
    ...state,
    characterProgress: {
      ...state.characterProgress,
      [input.characterId]: next,
    },
  };

  return { nextSlice: nextState, outgoingMessages: messages, scheduledJobs: [] };
}

// ──────────────────────────────────────────────────────────────────────────
// 年齡倍率（doc §2.4）
// ──────────────────────────────────────────────────────────────────────────

// TODO: 年齡倍率需讀 Character 年齡階段 + AgeExperienceRule stages。
// 第一版主路徑以 1.0 計；成年前較快成長由呼叫端傳入 ageMultiplier 覆寫。
function resolveBaseExperience(
  reader: ProgressionDefinitionReader,
  experienceAwardRuleId: Parameters<ProgressionDefinitionReader['getExperienceAwardRule']>[0],
  ageMultiplier: number,
): Readonly<{ masteryId: MasteryId; amount: number }> {
  const rule = reader.getExperienceAwardRule(experienceAwardRuleId);
  return { masteryId: rule.masteryId, amount: rule.baseExperience * ageMultiplier };
}

// ──────────────────────────────────────────────────────────────────────────
// §5.2 InternalCommand：GrantGatheringMasteryExperience（採集，冪等）
// ──────────────────────────────────────────────────────────────────────────

// doc §7.1：冪等來源 = resolutionId + contributorCharacterId + masteryId。
// 該命令已選出唯一最高採集者；Progression 不重選、不平均、不依產量重複發放。
export function handleGrantGatheringMasteryExperience(
  state: ProgressionModuleState,
  command: GrantGatheringMasteryExperience,
  reader: ProgressionDefinitionReader,
  ageMultiplier = 1,
): ModuleResult<ProgressionModuleState> {
  const key = gatheringGrantKey(
    command.resolutionId,
    command.contributorCharacterId,
    command.masteryId,
  );

  // 已處理過同一 (resolution, contributor, mastery)：安全跳過，state 不變。
  if (state.grantLedger[key] === true) {
    return emptyResult(state);
  }

  const base = resolveBaseExperience(reader, command.experienceAwardRuleId, ageMultiplier);
  // 命令 payload 的 masteryId 為受益 Mastery（與規則一致）。
  const result = awardMasteryExperience(
    state,
    {
      characterId: command.contributorCharacterId,
      masteryId: command.masteryId,
      amount: base.amount,
      source: 'gathering',
    },
    reader,
  );

  // 寫入冪等帳本。
  const nextState: ProgressionModuleState = {
    ...result.nextSlice,
    grantLedger: { ...result.nextSlice.grantLedger, [key]: true },
  };
  return { ...result, nextSlice: nextState };
}

// ──────────────────────────────────────────────────────────────────────────
// §5.1 DomainEvent 訂閱：戰鬥攻擊／防禦 MXP（已由 Combat 分配）
// ──────────────────────────────────────────────────────────────────────────

// doc §5.1：依已分配的 characterAwards 逐筆發放；Progression 不重算傷害／權重。冪等由 applyMasteryOnce
// 於呼叫端以 CombatMasterySource 把關（此函式本身不記帳）。
function applyCharacterAwards(
  state: ProgressionModuleState,
  awards: readonly Readonly<{ characterId: CharacterId; masteryId: MasteryId; amount: number }>[],
  source: MasterySource,
  reader: ProgressionDefinitionReader,
): ModuleResult<ProgressionModuleState> {
  let acc = state;
  const messages: TransactionMessageDraft[] = [];
  for (const award of awards) {
    const r = awardMasteryExperience(
      acc,
      { characterId: award.characterId, masteryId: award.masteryId, amount: award.amount, source },
      reader,
    );
    acc = r.nextSlice;
    messages.push(...r.outgoingMessages);
  }
  return { nextSlice: acc, outgoingMessages: messages, scheduledJobs: [] };
}

// 冪等 key：awardKind + CombatMasterySource（encounter/sequence）。attack/defense/support 各自成 key，
// 故同一 encounter 的三種發放不互擋，但同一種重放會被擋。
function masterySourceKey(awardKind: MasterySource, source: CombatMasterySource): string {
  const src =
    source.kind === 'encounter' ? `encounter:${source.encounterId}` : `combatSequence:${source.sequenceId}`;
  return `${awardKind}:${src}`;
}

// 依 CombatMasterySource 冪等套用（doc §7.5）：已記帳的來源重放 → no-op（不重複發放、不再 emit 事件）；
// 否則套用 awards 並把 key 寫進 masteryLedger。
function applyMasteryOnce(
  state: ProgressionModuleState,
  awardKind: MasterySource,
  source: CombatMasterySource,
  awards: readonly Readonly<{ characterId: CharacterId; masteryId: MasteryId; amount: number }>[],
  reader: ProgressionDefinitionReader,
): ModuleResult<ProgressionModuleState> {
  const key = masterySourceKey(awardKind, source);
  if (state.masteryLedger[key]) return { nextSlice: state, outgoingMessages: [], scheduledJobs: [] };
  const r = applyCharacterAwards(state, awards, awardKind, reader);
  return {
    ...r,
    nextSlice: { ...r.nextSlice, masteryLedger: { ...r.nextSlice.masteryLedger, [key]: true } },
  };
}

export function handleCombatAttackMasteryEarned(
  state: ProgressionModuleState,
  payload: CombatAttackMasteryEarnedPayload,
  reader: ProgressionDefinitionReader,
): ModuleResult<ProgressionModuleState> {
  return applyMasteryOnce(state, 'combat:attack', payload.source, payload.characterAwards, reader);
}

export function handleCombatDefenseMasteryEarned(
  state: ProgressionModuleState,
  payload: CombatDefenseMasteryEarnedPayload,
  reader: ProgressionDefinitionReader,
): ModuleResult<ProgressionModuleState> {
  return applyMasteryOnce(state, 'combat:defense', payload.source, payload.characterAwards, reader);
}

// 支援技能：固定 MXP 依 masterySplits 分配（ratio 總和恰為 1）。
export function handleCombatSupportMasteryEarned(
  state: ProgressionModuleState,
  payload: CombatSupportMasteryEarnedPayload,
  reader: ProgressionDefinitionReader,
): ModuleResult<ProgressionModuleState> {
  // TODO: encounter 來源 creditedUseCount 必須為 0..3；combat-sequence 來源可等於成功場次。
  // 此處信任 payload.creditedUseCount 已由 Combat/Sequence 依規則收斂。
  const rule = reader.getSupportMasteryAwardRule(payload.supportMasteryAwardRuleId);
  const totalFixed = rule.fixedExperiencePerUse * payload.creditedUseCount;
  const awards = rule.masterySplits.map((split) => ({
    characterId: payload.characterId,
    masteryId: split.masteryId,
    amount: totalFixed * split.ratio,
  }));
  return applyMasteryOnce(state, 'combat:support', payload.source, awards, reader);
}

// ──────────────────────────────────────────────────────────────────────────
// §5.1 DomainEvent 訂閱：CraftingCompleted（生活技藝 MXP）
// ──────────────────────────────────────────────────────────────────────────

// doc §5.1：依配方 Experience Rule 發放；成功／資料定義的失敗結果用同一 Rule。
export function handleCraftingCompleted(
  state: ProgressionModuleState,
  event: CraftingCompletedEvent,
  reader: ProgressionDefinitionReader,
): ModuleResult<ProgressionModuleState> {
  const base = resolveBaseExperience(reader, event.experienceRuleId, 1);
  return awardMasteryExperience(
    state,
    {
      characterId: event.characterId,
      masteryId: base.masteryId,
      amount: base.amount,
      source: 'crafting',
    },
    reader,
  );
}

// ──────────────────────────────────────────────────────────────────────────
// §6 傳授完成公式（純計算；wiring 見 TODO）
// ──────────────────────────────────────────────────────────────────────────

// doc §6.2：
//   原始 MXP = max(0, 教師MXP − 學員目前MXP) × 年齡對應比例
//   本次上限 = 起始等級 N 的「進入 N+2 門檻 − 1」（Lv.10 為最大值）
//   實際 MXP = min(學員目前MXP + 原始MXP, 本次上限)
// 回傳學員傳授後應達到的「累積經驗值」。
export function computeTeachingResult(
  curve: MasteryCurveDefinition,
  learnerCurrentExperience: number,
  learnerEntryLevel: number,
  teacherExperience: number,
  ageDifferenceRate: number,
): number {
  const rawGain = Math.max(0, teacherExperience - learnerCurrentExperience) * ageDifferenceRate;
  const thresholds = curve.cumulativeExperienceThresholds;
  const capLevelIndex = learnerEntryLevel + 2;
  let cap: number;
  if (capLevelIndex <= MAX_LEVEL) {
    const t = thresholds[capLevelIndex];
    // 進入 N+2 門檻 − 1（剛好卡在 N+1 級的 99.99%）。
    cap = t !== undefined ? t - 1 : (thresholds[thresholds.length - 1] ?? learnerCurrentExperience);
  } else {
    cap = thresholds[thresholds.length - 1] ?? learnerCurrentExperience;
  }
  return Math.min(learnerCurrentExperience + rawGain, cap);
}

// ──────────────────────────────────────────────────────────────────────────
// §5.1 CharacterBorn：為新生兒建立全 0 成長
// ──────────────────────────────────────────────────────────────────────────

export function handleCharacterBorn(
  state: ProgressionModuleState,
  characterId: CharacterId,
): ModuleResult<ProgressionModuleState> {
  if (state.characterProgress[characterId] !== undefined) {
    return emptyResult(state); // 已存在：不重建（不因父母熟練度贈送等級）。
  }
  const nextState: ProgressionModuleState = {
    ...state,
    characterProgress: {
      ...state.characterProgress,
      [characterId]: createCharacterProgression(characterId),
    },
  };
  return emptyResult(nextState);
}

// ──────────────────────────────────────────────────────────────────────────
// 其餘來源訂閱（doc §5.1）：主路徑框架備妥，內容規則待接。
// TODO: CuisineConsumed（餐館 ×1/3 倍率）、CommerceInteractionCompleted /
//   PlayerConversationCompleted（走 dailyUsage 上限）、TravelCompleted（每趟一次 + 模式倍率）、
//   MapExplorationCompleted（claimedExplorationRewards 去重）、QuestSettled、
//   BookUseCommittedForLearning（寫入 learnedKnowledgeIds）、傳授 / 子女學習 Cycle。
