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
  WorldDay,
  MasteryId,
  DefinitionId,
  Revision,
  ModuleResult,
  TransactionMessageDraft,
  DomainEventDraft,
  TeachingRuleId,
} from '../../contracts/core';
import {
  MAX_MASTERY_LEVEL,
  MAX_PRIMARY_ATTRIBUTE,
  MIN_MASTERY_LEVEL,
  SUPPORT_USE_CAP,
} from '../../contracts/core';
import type {
  ExperienceAwardRuleDefinition,
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
import type { FreeActionCompletedEvent } from '../../contracts/team';

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

// 兩者已移入 contracts/core/invariants.ts；此處保留本地別名以免動到大量使用點。
const MAX_LEVEL = MAX_MASTERY_LEVEL;
const MAX_ATTRIBUTE = MAX_PRIMARY_ATTRIBUTE;

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

  // 自動知識解鎖，兩個來源：
  //
  //   1. `MasteryDefinition.automaticKnowledgeUnlocks`（doc §7.2）——熟練度那一側的宣告。
  //   2. `SkillDefinition.acquisition.kind === 'automatic'` ＋ `requiredMasteries`——技能那一側。
  //
  // 只讀第一個來源時，`acquisition: 'automatic'` 的技能永遠學不會（雲華的內容全部走第二種，
  // 而熟練度那一側刻意留空，因為文化技能的 ID 不該塞進文化無關的熟練度定義裡）。症狀是
  // 角色手上有武器卻一招都沒有——戰鬥選單全空，而 GDD 明訂「沒有普通攻擊」。
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
  for (const skill of automaticSkillsNowMet({ ...progression, masteries: nextMasteries }, reader)) {
    if (progression.learnedKnowledgeIds.includes(skill)) continue;
    if (unlockedKnowledgeIds.includes(skill)) continue;
    unlockedKnowledgeIds.push(skill);
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

// 讀「角色現在幾歲」需要的最小 Query。年齡＝worldDay − birthDay，兩者 progression 都不擁有。
export interface CharacterAgeQuery {
  // 角色出生日。不存在該角色時回 undefined——呼叫端必須明確失敗，不得當成 0 歲。
  getBirthDay(characterId: CharacterId): WorldDay | undefined;
}

// 年齡倍率的解析輸入。
//
// 先前的形狀是 `resolveBaseExperience(reader, ruleId, ageMultiplier)`，倍率由呼叫端傳入且預設
// `= 1`。結果是全 repo **沒有任何呼叫端傳過別的值**——倍率永遠是 1，而
// `AgeExperienceRuleDefinition.stages` 與 `ExperienceAwardRuleDefinition.ageExperienceRuleId`
// 兩份資料從未被讀過。修法不是再加一個參數（那正是當初留下 `= 1` 的原因），而是把「算倍率需要
// 的東西」交給這個函式自己去讀。
export type AgeExperienceInput = Readonly<{
  definitions: ProgressionDefinitionReader;
  worldDay: WorldDay;
  characters: CharacterAgeQuery;
}>;

// 依角色年齡取倍率。
//
// `ageExperienceRuleId` 是**選填**的：沒有指名年齡規則，代表這筆獎勵不隨年齡縮放——那是規則的
// 一種合法形狀，不是缺資料，所以此時倍率就是 1（沒有折算這回事）。
// 指名了規則卻找不到對應年齡段，則是**壞資料**：明確拋錯，不夾到最近的一段，也不退回 1。
function ageMultiplierFor(
  rule: ExperienceAwardRuleDefinition,
  characterId: CharacterId,
  input: AgeExperienceInput,
): number {
  const ageRuleId = rule.ageExperienceRuleId;
  if (ageRuleId === undefined) return 1;

  const birthDay = input.characters.getBirthDay(characterId);
  if (birthDay === undefined) {
    throw new Error(
      `progression: 角色 ${String(characterId)} 沒有出生日，無法套用年齡經驗規則 ` +
        `${String(ageRuleId)}——不得當成 0 歲`,
    );
  }
  const ageDays = input.worldDay - birthDay;
  const ageRule = input.definitions.getAgeExperienceRule(ageRuleId);
  const stage = ageRule.stages.find(
    (s) => ageDays >= s.minAgeDays && (s.maxAgeDays === undefined || ageDays <= s.maxAgeDays),
  );
  if (stage === undefined) {
    throw new Error(
      `progression: 年齡規則 ${String(ageRuleId)} 沒有涵蓋 ${ageDays} 天的年齡段——` +
        `內容的 stages 必須覆蓋所有可能年齡（缺口不得由程式補）`,
    );
  }
  return stage.experienceMultiplier;
}

function resolveBaseExperience(
  experienceAwardRuleId: Parameters<ProgressionDefinitionReader['getExperienceAwardRule']>[0],
  characterId: CharacterId,
  input: AgeExperienceInput,
): Readonly<{ masteryId: MasteryId; amount: number }> {
  const rule = input.definitions.getExperienceAwardRule(experienceAwardRuleId);
  const multiplier = ageMultiplierFor(rule, characterId, input);
  return { masteryId: rule.masteryId, amount: rule.baseExperience * multiplier };
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
  age: AgeExperienceInput,
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

  const base = resolveBaseExperience(
    command.experienceAwardRuleId,
    command.contributorCharacterId,
    age,
  );
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

// 冪等 key：awardKind + CombatMasterySource（encounter/sequence）+ 可選的 discriminant。attack/defense 每場
// 只發一筆（characterAwards[] 聚合全隊）→ encounter 級 key 即可；**support 每名角色每個技能各發一筆**，故必須
// 加 `${characterId}:${skillId}` discriminant，否則同場第一筆入帳後其餘全被當成重放（其他支援者/技能拿不到）。
function masterySourceKey(
  awardKind: MasterySource,
  source: CombatMasterySource,
  discriminant?: string,
): string {
  const src =
    source.kind === 'encounter' ? `encounter:${source.encounterId}` : `combatSequence:${source.sequenceId}`;
  return discriminant !== undefined ? `${awardKind}:${src}:${discriminant}` : `${awardKind}:${src}`;
}

// 依 CombatMasterySource（+ discriminant）冪等套用（doc §7.5）：已記帳的 key 重放 → no-op（不重複發放、不再
// emit 事件）；否則套用 awards 並把 key 寫進 masteryLedger。
function applyMasteryOnce(
  state: ProgressionModuleState,
  awardKind: MasterySource,
  source: CombatMasterySource,
  awards: readonly Readonly<{ characterId: CharacterId; masteryId: MasteryId; amount: number }>[],
  reader: ProgressionDefinitionReader,
  discriminant?: string,
): ModuleResult<ProgressionModuleState> {
  const key = masterySourceKey(awardKind, source, discriminant);
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

// 支援技能計次的合法範圍守門。見 handleCombatSupportMasteryEarned 的說明。
function assertCreditedUseCountInRange(payload: CombatSupportMasteryEarnedPayload): void {
  const count = payload.creditedUseCount;
  const where = `character=${String(payload.characterId)} skill=${String(payload.skillId)}`;
  if (!Number.isInteger(count) || count < 0) {
    throw new Error(
      `progression: creditedUseCount 必須是非負整數（${where}，實得 ${String(count)}）`,
    );
  }
  if (payload.source.kind === 'encounter' && count > SUPPORT_USE_CAP) {
    throw new Error(
      `progression: 單場戰鬥的支援技能計次上限為 ${SUPPORT_USE_CAP}（${where}，實得 ${count}）——` +
        `送出端未依 doc §8.6 收斂`,
    );
  }
}

// 支援技能：固定 MXP 依 masterySplits 分配（ratio 總和恰為 1）。
export function handleCombatSupportMasteryEarned(
  state: ProgressionModuleState,
  payload: CombatSupportMasteryEarnedPayload,
  reader: ProgressionDefinitionReader,
): ModuleResult<ProgressionModuleState> {
  // 支援技能的計次上限依**來源種類**不同（doc §8.6）：
  //   * encounter      —— 同角色同技能每場戰鬥最多 SUPPORT_USE_CAP 次（結構不變量）。
  //   * combatSequence —— 一整串簡易戰鬥，計次可等於成功場次，沒有固定上限。
  // 先前這裡是「信任 payload 已由 Combat/Sequence 收斂」。信任的代價是：上游算錯時 MXP 會超發，
  // 而且沒有任何地方會失敗——超發的經驗直接進帳本，之後無從分辨是規則變更還是 bug。
  // 來源是 sibling 模組送來的事件（已發生的事實，Subscriber 不得拒絕），所以違規是**程式錯誤**
  // 而不是玩家輸入：明確拋錯，不夾值、不靜默略過。
  assertCreditedUseCountInRange(payload);

  const rule = reader.getSupportMasteryAwardRule(payload.supportMasteryAwardRuleId);
  const totalFixed = rule.fixedExperiencePerUse * payload.creditedUseCount;
  const awards = rule.masterySplits.map((split) => ({
    characterId: payload.characterId,
    masteryId: split.masteryId,
    amount: totalFixed * split.ratio,
  }));
  // support 每名角色每技能各一筆 → key 需帶 characterId:skillId，否則同場其他支援者/技能被誤當重放。
  return applyMasteryOnce(
    state,
    'combat:support',
    payload.source,
    awards,
    reader,
    `${payload.characterId}:${payload.skillId}`,
  );
}

// ──────────────────────────────────────────────────────────────────────────
// §5.1 DomainEvent 訂閱：CraftingCompleted（生活技藝 MXP）
// ──────────────────────────────────────────────────────────────────────────

// doc §5.1：依配方 Experience Rule 發放；成功／資料定義的失敗結果用同一 Rule。
export function handleCraftingCompleted(
  state: ProgressionModuleState,
  event: CraftingCompletedEvent,
  reader: ProgressionDefinitionReader,
  age: AgeExperienceInput,
): ModuleResult<ProgressionModuleState> {
  const base = resolveBaseExperience(event.experienceRuleId, event.characterId, age);
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
// §5.1 DomainEvent 訂閱：FreeActionCompleted（28 日城鎮訓練）
// ──────────────────────────────────────────────────────────────────────────

// mastery_experience_economy_v1.md §五「城鎮生活技藝訓練（28 日）」：
//   （Lv.5 教師 MXP − 學生 MXP）× 0.15%，並受「單次至多到 Lv.N+2 門檻 − 1」的跨級上限。
//
// 也就是說訓練**共用傳授的差額公式**，只是教師換成一位固定 Lv.5 的城鎮教師。所以這裡不另立
// experience-award-rule：那會變成同一件事的第二份真相，而且會和 TeachingRule 的率各走各的。
// 「Lv.5」與「0.15%」兩個數字都住在 `TeachingRuleDefinition`（cityTeacherMasteryLevel /
// adultDifferenceRate），本函式只把它們接起來。
//
// `train` 以外的自由行動種類在這裡**不動 state**：craft 的成品屬 crafting、tavernVisit 沒有成長。
// 那不是「跳過錯誤」，而是這個訂閱者只認領訓練這一種。
export function handleFreeActionCompleted(
  state: ProgressionModuleState,
  event: FreeActionCompletedEvent,
  reader: ProgressionDefinitionReader,
  teachingRuleId: TeachingRuleId,
): ModuleResult<ProgressionModuleState> {
  if (event.payload.kind !== 'train') return emptyResult(state);
  const masteryId = event.payload.masteryId;

  const teaching = reader.getTeachingRule(teachingRuleId);
  const mastery = reader.getMastery(masteryId);
  const curve = reader.getMasteryCurve(mastery.curveId);

  // 城鎮教師固定 Lv.5：他的 MXP ＝ 曲線上進入 Lv.5 的累積門檻。
  const teacherExperience = curve.cumulativeExperienceThresholds[teaching.cityTeacherMasteryLevel];
  if (teacherExperience === undefined) {
    throw new Error(
      `progression：熟練度曲線 "${String(mastery.curveId)}" 沒有 Lv.${teaching.cityTeacherMasteryLevel} 的累積門檻——` +
        `城鎮教師等級（TeachingRule.cityTeacherMasteryLevel）超出曲線範圍。`,
    );
  }

  // 還沒有這項熟練度的進度＝一筆全新的進度（工廠說了算），不是「補兩個 0」。
  // 與 applyOne 走同一條路：`?? createMasteryProgress(id)`。
  const progress = state.characterProgress[event.memberId];
  const current = progress?.masteries[masteryId] ?? createMasteryProgress(masteryId);
  const learnerExperience = current.experience;
  const learnerLevel = current.level;

  const target = computeTeachingResult(
    curve,
    learnerExperience,
    learnerLevel,
    teacherExperience,
    teaching.adultDifferenceRate,
  );
  // 學員已不低於 Lv.5 教師時差額為 0 → amount 0，awardMasteryExperience 不改變 state。
  const amount = target - learnerExperience;
  return awardMasteryExperience(
    state,
    { characterId: event.memberId, masteryId, amount, source: 'cityTraining' },
    reader,
  );
}

// ──────────────────────────────────────────────────────────────────────────
// §5.1 CharacterBorn：為新生兒建立全 0 成長
// ──────────────────────────────────────────────────────────────────────────

export function handleCharacterBorn(
  state: ProgressionModuleState,
  characterId: CharacterId,
  reader: ProgressionDefinitionReader,
): ModuleResult<ProgressionModuleState> {
  if (state.characterProgress[characterId] !== undefined) {
    return emptyResult(state); // 已存在：不重建（不因父母熟練度贈送等級）。
  }
  // 門檻是 Lv.0 的自動技能在**出生當下**就成立（每個熟練度都從 0 開始）。不在這裡解鎖的話，
  // 一個角色要等到第一次獲得任何 MXP 才學得會基礎招式——而基礎招式正是拿來賺那份 MXP 的。
  const fresh = createCharacterProgression(characterId);
  const nextState: ProgressionModuleState = {
    ...state,
    characterProgress: {
      ...state.characterProgress,
      [characterId]: { ...fresh, learnedKnowledgeIds: [...automaticSkillsNowMet(fresh, reader)] },
    },
  };
  return emptyResult(nextState);
}

// 目前熟練度已達門檻、且取得方式為「自動」的技能。純函式：不看已學清單（呼叫端負責去重），
// 也不看等級以外的條件——`requiredMasteries` 是契約給的唯一門檻。
function automaticSkillsNowMet(
  progression: CharacterProgression,
  reader: ProgressionDefinitionReader,
): readonly DefinitionId[] {
  return reader
    .listAutomaticSkills()
    .filter((skill) =>
      skill.requiredMasteries.every(
        (req) => (progression.masteries[req.masteryId]?.level ?? MIN_MASTERY_LEVEL) >= req.minLevel,
      ),
    )
    .map((skill) => skill.id as DefinitionId);
}

// ──────────────────────────────────────────────────────────────────────────
// 其餘來源訂閱（doc §5.1）：主路徑框架備妥，內容規則待接。
// TODO: CuisineConsumed（餐館 ×1/3 倍率）、CommerceInteractionCompleted /
//   PlayerConversationCompleted（走 dailyUsage 上限）、TravelCompleted（每趟一次 + 模式倍率）、
//   MapExplorationCompleted（claimedExplorationRewards 去重）、QuestSettled、
//   BookUseCommittedForLearning（寫入 learnedKnowledgeIds）、傳授 / 子女學習 Cycle。
