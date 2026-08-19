// modules/combat-sequence/system.ts
// Combat Sequence 的純函式 Handler / Subscriber / Resolver / Allocator。
// 對應 docs/00_core/architecture/21_combat_sequence_module.md §4–§9。
//
// 全部函式為 deterministic pure：只讀 (state, payload, ctx)，回傳新的 slice 與待送訊息；
// 不做 I/O、不改動輸入、不呼叫其他模組的 Handler。RNG 只走注入的 DeterministicRng + 顯式 cursor。
//
// 兩個跨模組原則決定了本檔的形狀：
//   1. **沒有同步回傳 Port。** 補品重骰不是「呼叫 inventory 拿結果」，而是
//      ResolveNext → 送 ConsumeCombatSequenceRetrySupply → inventory 發
//      CombatSequenceRetrySupplyConsumed → 本模組訂閱者重骰（doc §6.3 要求同一 Engine Transaction）。
//      因此 RNG 只可能在「補品確實已消耗」之後才前進——doc §10 驗收 4 由結構保證，不靠檢查。
//   2. **不寫別人的 State。** 熟練度只以已分配好的成長來源事件公告，由 progression 套用。

import type {
  CharacterId,
  DomainEventDraft,
  InternalCommandDraft,
  ItemInstanceId,
  MasteryId,
  ModuleId,
  ModuleOutcome,
  ModuleResult,
  Revision,
  RngContext,
  RngCursor,
  DeterministicRng,
  SkillDefinitionId,
  TransactionMessageDraft,
  WorldDay,
} from '../../contracts/core';
import { GRID_MAX, GRID_MIN, MAX_FORMAL_MEMBERS } from '../../contracts/core';
import type {
  AcceptedCombatSequenceChallengeExperience,
  CombatSequenceAllocationSnapshot,
  CombatSequenceChallengeId,
  CombatSequenceChallengeResolutionInput,
  CombatSequenceChallengeResolver,
  CombatSequenceChallengeResult,
  CombatSequenceChallengeResultId,
  CombatSequenceChallengeRetryInput,
  CombatSequenceChallengeSnapshot,
  CombatSequenceDefinitionReader,
  CombatSequenceDomainEvent,
  CombatSequenceMasteryAllocation,
  CombatSequenceMasteryAllocationInput,
  CombatSequenceMasteryAllocator,
  CombatSequenceMemberSnapshot,
  CombatSequenceRollResult,
  CombatSequenceRuleDefinition,
  CombatSequenceSuccessChanceInput,
  CombatSequenceSuccessChanceResult,
  CombatSequenceSupplyQuery,
  CombatSequenceTerminationReason,
  CommitCombatSequenceSourceResults,
  InvalidateCombatSequence,
  MasteryExperienceAmount,
  MasteryRatio,
  ReleaseCombatSequence,
  ResolveNextCombatSequenceChallenge,
  RetrySupplyCandidate,
  RetrySupplyPolicyDefinition,
  SkipNextCombatSequenceChallenge,
  StartCombatSequence,
  StopCombatSequence,
} from '../../contracts/combat-sequence';
// 外送命令引用**接收模組**契約的真實型別（HANDOFF 慣例）；inventory 是 ConsumeCombatSequenceRetrySupply
// 的唯一處理者。注意它的 payload 與 doc §6.3 不同（沒有 itemId／quantity）——見實作回報的依賴清單。
import type { ConsumeCombatSequenceRetrySupply } from '../../contracts/inventory';

import type {
  CombatSequenceAggregate,
  CombatSequenceModuleState,
  CombatSequencePendingRetry,
  CombatSequenceSettlementRecord,
} from './state';
import {
  bumpRevision,
  clearPendingRetry,
  currentChallengeOf,
  findInFlightSequenceForTeam,
  indexChallenges,
  listResults,
  listSuccessfulResults,
  removeSequence,
  tryGetSequence,
  upsertSequence,
} from './state';

export const COMBAT_SEQUENCE_MODULE_ID = 'combat-sequence' as ModuleId;
const INVENTORY_MODULE_ID = 'inventory' as ModuleId;

// ──────────────────────────────────────────────────────────────────────────
// 注入的 Port（§7.1 慣例：模組宣告本地 port 型別，實作由 composition 注入）
// ──────────────────────────────────────────────────────────────────────────

// 成功率公式：形狀在 kernel（logisticCurve），調校在 Definition。本模組只把
// rule 的 resolverId + paramsId 與結構性輸入交出去，自己不持有任何機率常數。
export interface CombatSequenceSuccessChancePort {
  resolveSuccessChance(
    input: Readonly<{
      resolverId: CombatSequenceRuleDefinition['successChanceResolverId'];
      paramsDefId: CombatSequenceRuleDefinition['successChanceParamsId'];
      chance: CombatSequenceSuccessChanceInput;
    }>,
  ): CombatSequenceSuccessChanceResult;
}

export type CombatSequenceContext = Readonly<{
  reader: CombatSequenceDefinitionReader;
  // 補品候選來自參戰者個人背包（doc §6.2「隊伍沒有共用背包」）；由 inventory 支撐的 adapter 注入。
  supply: CombatSequenceSupplyQuery;
  resolver: CombatSequenceChallengeResolver;
  allocator: CombatSequenceMasteryAllocator;
  worldDay: WorldDay;
  nextChallengeResultId: () => CombatSequenceChallengeResultId;
}>;

// ──────────────────────────────────────────────────────────────────────────
// ModuleResult / message 工具
// ──────────────────────────────────────────────────────────────────────────

function event(payload: CombatSequenceDomainEvent): DomainEventDraft<CombatSequenceDomainEvent> {
  return { event: payload };
}

function internal(
  command: ConsumeCombatSequenceRetrySupply,
): InternalCommandDraft<ConsumeCombatSequenceRetrySupply> {
  return { targetModule: INVENTORY_MODULE_ID, command };
}

function moduleResult(
  nextSlice: CombatSequenceModuleState,
  outgoingMessages: readonly TransactionMessageDraft[] = [],
): ModuleResult<CombatSequenceModuleState> {
  return { nextSlice, outgoingMessages, scheduledJobs: [] };
}

export type CombatSequenceHandlerResult = ModuleOutcome<CombatSequenceModuleState>;

function accept(
  nextSlice: CombatSequenceModuleState,
  outgoingMessages: readonly TransactionMessageDraft[] = [],
): CombatSequenceHandlerResult {
  return { ok: true, result: moduleResult(nextSlice, outgoingMessages) };
}

function reject(
  code: string,
  details?: Readonly<Record<string, string | number | boolean>>,
): CombatSequenceHandlerResult {
  return {
    ok: false,
    rejection: {
      code,
      source: COMBAT_SEQUENCE_MODULE_ID,
      ...(details !== undefined ? { details } : {}),
    },
  };
}

// Subscriber 專用：已發生的事實不可拒絕（12_engine_runtime.md §7.2 rule 6）。
function subscriberNoop(
  state: CombatSequenceModuleState,
): ModuleResult<CombatSequenceModuleState> {
  return moduleResult(state);
}

// ──────────────────────────────────────────────────────────────────────────
// 拒絕碼（每一個都在下方 Handler 有觸發路徑，且在 combat-sequence.test 有案例）
// ──────────────────────────────────────────────────────────────────────────

export const COMBAT_SEQUENCE_REJECTIONS = {
  startSequenceExists: 'combat-sequence.start.sequenceExists',
  startTeamBusy: 'combat-sequence.start.teamBusy',
  startRuleInvalid: 'combat-sequence.start.ruleInvalid',
  startChallengeSequenceInvalid: 'combat-sequence.start.challengeSequenceInvalid',
  startChallengeDefinitionMismatch: 'combat-sequence.start.challengeDefinitionMismatch',
  startTeamPowerMismatch: 'combat-sequence.start.teamPowerMismatch',
  startAllocationSnapshotInvalid: 'combat-sequence.start.allocationSnapshotInvalid',
  sequenceNotFound: 'combat-sequence.sequenceNotFound',
  notActive: 'combat-sequence.notActive',
  retryPending: 'combat-sequence.retryPending',
  challengeMismatch: 'combat-sequence.challengeMismatch',
  stopAlreadyTerminal: 'combat-sequence.stop.alreadyTerminal',
  stopReasonConflict: 'combat-sequence.stop.reasonConflict',
  invalidateAlreadySettled: 'combat-sequence.invalidate.alreadySettled',
  commitNotAwaiting: 'combat-sequence.commit.notAwaitingSourceCommit',
  commitIdConflict: 'combat-sequence.commit.commitIdConflict',
  commitResultNotAccepted: 'combat-sequence.commit.resultNotAccepted',
  releaseNotReleasable: 'combat-sequence.release.notReleasable',
  releaseRevisionMismatch: 'combat-sequence.release.revisionMismatch',
} as const;

// ──────────────────────────────────────────────────────────────────────────
// Challenge Resolver（doc §5：無 State、無 I/O 的純函式；只吃明確 RNG cursor）
// ──────────────────────────────────────────────────────────────────────────

function rollOnce(
  rng: DeterministicRng,
  rngContext: RngContext,
  probability: number,
  attemptIndex: number,
  rngDrawIndex: number,
): CombatSequenceRollResult {
  if (!Number.isFinite(probability) || probability < 0 || probability > 1) {
    // 機率不在 0..1 是壞內容／壞 Resolver。Resolver 是純函式，沒有 rejection 通道，
    // 也絕不可夾限成「看起來合理的值」（規範 §6）——明確失敗讓交易整筆回滾。
    throw new Error(
      `combat-sequence resolver: successChance 必須落在 0..1，實得 ${String(probability)}`,
    );
  }
  const step = rng.nextFloat({
    worldSeed: rngContext.worldSeed,
    streamId: rngContext.streamId,
    cursor: rngContext.cursor,
  });
  return {
    attemptIndex,
    rngDrawIndex,
    successProbability: probability,
    roll: step.value,
    success: step.value < probability,
  };
}

export function createCombatSequenceChallengeResolver(
  deps: Readonly<{ rng: DeterministicRng; successChance: CombatSequenceSuccessChancePort }>,
): CombatSequenceChallengeResolver {
  const probabilityOf = (rule: CombatSequenceRuleDefinition, teamPower: number, enemyPower: number) =>
    deps.successChance.resolveSuccessChance({
      resolverId: rule.successChanceResolverId,
      paramsDefId: rule.successChanceParamsId,
      chance: { teamPower, enemyPower },
    }).probability;

  return {
    resolveInitial(input: CombatSequenceChallengeResolutionInput): CombatSequenceRollResult {
      return rollOnce(
        deps.rng,
        input.rngContext,
        probabilityOf(input.rule, input.teamPower, input.enemyPower),
        input.attemptIndex,
        input.rngDrawIndex,
      );
    },
    resolveRetry(input: CombatSequenceChallengeRetryInput): CombatSequenceRollResult {
      return rollOnce(
        deps.rng,
        input.rngContext,
        probabilityOf(input.rule, input.teamPower, input.enemyPower),
        input.attemptIndex,
        input.rngDrawIndex,
      );
    },
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Mastery Allocator（doc §7.2–§7.4）
// ──────────────────────────────────────────────────────────────────────────

type WeightedTarget = Readonly<{
  characterId: CharacterId;
  weight: number;
  splits: readonly MasteryRatio[];
}>;

type ExactShare = Readonly<{ characterId: CharacterId; masteryId: MasteryId; exact: number }>;

function stableCompare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

// 最大餘數法（doc §5「餘數同值時以 characterId、masteryId 的穩定順序分配」）。
// 預算為整數（Start 已驗），因此發放總量恰等於預算。
function largestRemainder(
  shares: readonly ExactShare[],
  budget: number,
): MasteryExperienceAmount[] {
  if (shares.length === 0) return [];
  const floored = shares.map((share) => {
    const base = Math.floor(share.exact);
    return { ...share, base, remainder: share.exact - base };
  });
  const assigned = floored.reduce((sum, entry) => sum + entry.base, 0);
  // 浮點誤差可能讓 Σexact 比 budget 差 ~1e-13；夾到 [0, n] 讓「多發」與「發成負」都不可能發生。
  const spare = Math.min(Math.max(Math.round(budget - assigned), 0), floored.length);
  const order = [...floored].sort(
    (a, b) =>
      b.remainder - a.remainder ||
      stableCompare(String(a.characterId), String(b.characterId)) ||
      stableCompare(String(a.masteryId), String(b.masteryId)),
  );
  const bonus = new Set(order.slice(0, spare).map((entry) => `${entry.characterId}|${entry.masteryId}`));
  return floored
    .map((entry) => ({
      characterId: entry.characterId,
      masteryId: entry.masteryId,
      amount: entry.base + (bonus.has(`${entry.characterId}|${entry.masteryId}`) ? 1 : 0),
    }))
    .filter((award) => award.amount > 0);
}

// 依權重把預算分給角色，再依該角色的 masterySplits 分到各 Mastery。
// 全體權重為 0 時不發放（doc §7.2「不得除以 0，也不得把預算改分給無攻擊技能角色」）。
//
// splits 以其自身總和正規化：正式內容的 ratio 總和恰為 1（doc §2.3，由 Content Pack 驗證器把關），
// 此時除以總和是恆等變換；這樣寫可以避免在程式裡塞一個浮點容差常數來比較「總和是不是 1」。
function distributeByWeight(
  targets: readonly WeightedTarget[],
  budget: number,
): MasteryExperienceAmount[] {
  const weightTotal = targets.reduce((sum, target) => sum + target.weight, 0);
  if (weightTotal <= 0 || budget <= 0) return [];
  const shares: ExactShare[] = [];
  for (const target of targets) {
    if (target.weight <= 0) continue;
    const characterShare = (budget * target.weight) / weightTotal;
    const ratioTotal = target.splits.reduce((sum, split) => sum + split.ratio, 0);
    if (ratioTotal <= 0) continue;
    for (const split of target.splits) {
      shares.push({
        characterId: target.characterId,
        masteryId: split.masteryId,
        exact: (characterShare * split.ratio) / ratioTotal,
      });
    }
  }
  return largestRemainder(shares, budget);
}

// doc §7.3：以開始時的 formationCell 排序，略過完全無人的排；
// 第一個有人排每人權重 3、第二個 2、第三個 1。
//
// 3／2／1 不是可調數值，而是 3×3 戰鬥場地這條結構不變量的直接後果：權重 =「共有幾排」− 排名。
// 因此它由 contracts/core/invariants.ts 的 GRID_MIN/GRID_MAX 導出，而不是寫成一個具名常數。
export function defenseRowWeightOf(
  members: readonly CombatSequenceMemberSnapshot[],
  member: CombatSequenceMemberSnapshot,
): number {
  const rowCount = GRID_MAX - GRID_MIN + 1;
  const occupiedRows = [...new Set(members.map((each) => each.formationCell.row))].sort(
    (a, b) => a - b,
  );
  const rank = occupiedRows.indexOf(member.formationCell.row);
  if (rank < 0) return 0; // 不屬於這份快照的成員沒有列權重。
  const weight = rowCount - rank;
  return weight > 0 ? weight : 0;
}

export function createCombatSequenceMasteryAllocator(): CombatSequenceMasteryAllocator {
  return {
    allocate(input: CombatSequenceMasteryAllocationInput): CombatSequenceMasteryAllocation {
      const members = input.allocationSnapshot.members;
      const totals = totalBudgets(input.acceptedChallenges);
      const successCount = input.acceptedChallenges.length;

      const attackAwards = distributeByWeight(
        members.map((member) => ({
          characterId: member.characterId,
          weight: member.attackWeightUnits,
          splits: member.attackMasterySplits,
        })),
        totals.attack,
      );

      const defenseAwards = distributeByWeight(
        members.map((member) => ({
          characterId: member.characterId,
          weight: defenseRowWeightOf(members, member),
          splits: member.defenseMasterySplits,
        })),
        totals.defense,
      );

      // doc §7.4：每個合法支援技能「每個正式成功 Challenge 記一次」。
      // 這裡**沒有** SUPPORT_USE_CAP——三次上限只屬 detailed Encounter 中同一技能的真實使用。
      const supportAwards = members.flatMap((member) =>
        member.supportSkills.map((skill) => ({
          characterId: member.characterId,
          skillId: skill.skillId,
          supportMasteryAwardRuleId: skill.awardRuleId,
          creditedUseCount: successCount,
        })),
      );

      return { attackAwards, defenseAwards, supportAwards };
    },
  };
}

function totalBudgets(
  accepted: readonly AcceptedCombatSequenceChallengeExperience[],
): Readonly<{ attack: number; defense: number }> {
  return {
    attack: accepted.reduce((sum, entry) => sum + entry.attackExperienceBudget, 0),
    defense: accepted.reduce((sum, entry) => sum + entry.defenseExperienceBudget, 0),
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Internal Command：StartCombatSequence（doc §6.1）
// ──────────────────────────────────────────────────────────────────────────

function isNonNegativeFinite(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

function validateRule(rule: CombatSequenceRuleDefinition): string | undefined {
  if (!isNonNegativeFinite(rule.retryRelativePowerGapMaximum)) return 'retryRelativePowerGapMaximum';
  if (!Number.isInteger(rule.maxRetryCountPerChallenge) || rule.maxRetryCountPerChallenge < 0) {
    return 'maxRetryCountPerChallenge';
  }
  if (!Number.isInteger(rule.attackWeightScale) || rule.attackWeightScale <= 0) {
    return 'attackWeightScale';
  }
  return undefined;
}

function validateChallengeSequence(
  cmd: StartCombatSequence,
): Readonly<{ reason: string; challengeId?: string }> | undefined {
  const challenges = cmd.challenges;
  if (challenges.length === 0) return { reason: 'empty' };
  if (cmd.source.kind === 'singleBattleSweep' && challenges.length !== 1) {
    return { reason: 'singleBattleRequiresExactlyOneChallenge' };
  }
  const seen = new Set<string>();
  for (let index = 0; index < challenges.length; index += 1) {
    const challenge = challenges[index];
    if (challenge === undefined) return { reason: 'sparseChallengeArray' };
    if (seen.has(String(challenge.challengeId))) {
      return { reason: 'duplicateChallengeId', challengeId: String(challenge.challengeId) };
    }
    seen.add(String(challenge.challengeId));
    if (challenge.order !== index) {
      return { reason: 'orderNotContiguous', challengeId: String(challenge.challengeId) };
    }
    if (!isNonNegativeFinite(challenge.enemyPower)) {
      return { reason: 'enemyPowerInvalid', challengeId: String(challenge.challengeId) };
    }
    // 預算必須是非負整數：最大餘數法要「總發放量等於原預算」，非整數預算做不到（doc §5）。
    if (
      !Number.isInteger(challenge.attackExperienceBudget) ||
      challenge.attackExperienceBudget < 0 ||
      !Number.isInteger(challenge.defenseExperienceBudget) ||
      challenge.defenseExperienceBudget < 0
    ) {
      return { reason: 'experienceBudgetInvalid', challengeId: String(challenge.challengeId) };
    }
    const sourceRefReason = validateSourceRef(cmd, challenge);
    if (sourceRefReason !== undefined) {
      return { reason: sourceRefReason, challengeId: String(challenge.challengeId) };
    }
  }
  return undefined;
}

function validateSourceRef(
  cmd: StartCombatSequence,
  challenge: CombatSequenceChallengeSnapshot,
): string | undefined {
  if (cmd.source.kind === 'singleBattleSweep') {
    if (challenge.sourceRef.kind !== 'singleBattle') return 'sourceRefKindMismatch';
    return challenge.sourceRef.sourceId === cmd.source.sourceId ? undefined : 'sourceRefIdMismatch';
  }
  if (challenge.sourceRef.kind !== 'mapContent') return 'sourceRefKindMismatch';
  if (challenge.sourceRef.mapId !== cmd.source.mapId) return 'sourceRefMapMismatch';
  return challenge.sourceRef.mapVersion === cmd.source.mapVersion
    ? undefined
    : 'sourceRefMapVersionMismatch';
}

function validateAllocationSnapshot(
  snapshot: CombatSequenceAllocationSnapshot,
  rule: CombatSequenceRuleDefinition,
  reader: CombatSequenceDefinitionReader,
): Readonly<{ reason: string; characterId?: string }> | undefined {
  const members = snapshot.members;
  if (members.length < 1 || members.length > MAX_FORMAL_MEMBERS) return { reason: 'memberCount' };
  const seenCharacters = new Set<string>();
  const seenCells = new Set<string>();
  for (const member of members) {
    const who = String(member.characterId);
    if (seenCharacters.has(who)) return { reason: 'duplicateMember', characterId: who };
    seenCharacters.add(who);

    const cell = member.formationCell;
    if (
      !Number.isInteger(cell.row) ||
      !Number.isInteger(cell.col) ||
      cell.row < GRID_MIN ||
      cell.row > GRID_MAX ||
      cell.col < GRID_MIN ||
      cell.col > GRID_MAX
    ) {
      return { reason: 'formationCellOutOfGrid', characterId: who };
    }
    const cellKey = `${cell.floor}|${cell.row}|${cell.col}`;
    if (seenCells.has(cellKey)) return { reason: 'duplicateFormationCell', characterId: who };
    seenCells.add(cellKey);

    const configured = member.configuredSkillIds;
    if (new Set(configured.map(String)).size !== configured.length) {
      return { reason: 'duplicateConfiguredSkill', characterId: who };
    }

    // 攻擊技能數與支援技能集合都由 Skill Definition 判定（damage / fixedSupport），
    // 不信任 Assembler 自報的數字（doc §2.3、§3.2）。
    const damageSkills: SkillDefinitionId[] = [];
    const supportSkills: SkillDefinitionId[] = [];
    for (const skillId of configured) {
      const view = reader.getSkillView(skillId);
      if (view.masteryExperienceMode === 'damage') damageSkills.push(skillId);
      else supportSkills.push(skillId);
    }
    if (member.attackSkillCount !== damageSkills.length) {
      return { reason: 'attackSkillCount', characterId: who };
    }
    // doc §3.2 的權重刻度：以整數算式表達，避免 (1/3)*6 的浮點殘差被偷偷四捨五入。
    const expectedWeight =
      configured.length === 0 ? 0 : (member.attackSkillCount * rule.attackWeightScale) / configured.length;
    if (!Number.isInteger(expectedWeight) || member.attackWeightUnits !== expectedWeight) {
      return { reason: 'attackWeightUnits', characterId: who };
    }

    const declaredSupport = member.supportSkills.map((skill) => String(skill.skillId)).sort();
    const definitionSupport = supportSkills.map(String).sort();
    if (declaredSupport.join(',') !== definitionSupport.join(',')) {
      return { reason: 'supportSkillSet', characterId: who };
    }
    for (const skill of member.supportSkills) {
      const view = reader.getSkillView(skill.skillId);
      if (view.supportMasteryAwardRuleId !== skill.awardRuleId) {
        return { reason: 'supportAwardRuleMismatch', characterId: who };
      }
    }

    const splitsReason = validateSplits(member.attackMasterySplits, member.attackWeightUnits > 0);
    if (splitsReason !== undefined) return { reason: `attack:${splitsReason}`, characterId: who };
    // 每位成員都會拿到防禦列權重（最低一排＝1），因此 defenseMasterySplits 必須永遠可用。
    const defenseReason = validateSplits(member.defenseMasterySplits, true);
    if (defenseReason !== undefined) return { reason: `defense:${defenseReason}`, characterId: who };
  }
  return undefined;
}

function validateSplits(splits: readonly MasteryRatio[], required: boolean): string | undefined {
  if (splits.length === 0) return required ? 'splitsMissing' : undefined;
  let total = 0;
  const seen = new Set<string>();
  for (const split of splits) {
    if (seen.has(String(split.masteryId))) return 'duplicateMastery';
    seen.add(String(split.masteryId));
    if (!isNonNegativeFinite(split.ratio)) return 'ratioInvalid';
    total += split.ratio;
  }
  return total > 0 ? undefined : 'ratioSumZero';
}

export function handleStartCombatSequence(
  state: CombatSequenceModuleState,
  cmd: StartCombatSequence,
  ctx: CombatSequenceContext,
): CombatSequenceHandlerResult {
  if (tryGetSequence(state, cmd.sequenceId) !== undefined) {
    return reject(COMBAT_SEQUENCE_REJECTIONS.startSequenceExists, {
      sequenceId: String(cmd.sequenceId),
    });
  }
  const inFlight = findInFlightSequenceForTeam(state, cmd.teamId);
  if (inFlight !== undefined) {
    return reject(COMBAT_SEQUENCE_REJECTIONS.startTeamBusy, {
      teamId: String(cmd.teamId),
      existingSequenceId: String(inFlight.sequenceId),
    });
  }

  const rule = ctx.reader.getRule(cmd.ruleId);
  const ruleReason = validateRule(rule);
  if (ruleReason !== undefined) {
    return reject(COMBAT_SEQUENCE_REJECTIONS.startRuleInvalid, {
      ruleId: String(cmd.ruleId),
      reason: ruleReason,
    });
  }

  const challengeReason = validateChallengeSequence(cmd);
  if (challengeReason !== undefined) {
    return reject(COMBAT_SEQUENCE_REJECTIONS.startChallengeSequenceInvalid, {
      reason: challengeReason.reason,
      ...(challengeReason.challengeId !== undefined
        ? { challengeId: challengeReason.challengeId }
        : {}),
    });
  }

  // 每個 Challenge 的快照必須與 Definition 一致：戰力公式相同（doc §3.1「禁止比較由不同公式產生的
  // 兩個分數」），經驗預算取自同一份定義（doc §2.3「不得建立第二份怪物經驗表」）。
  for (const challenge of cmd.challenges) {
    const view = ctx.reader.getEncounterView(challenge.encounterGroupId);
    if (view.combatPowerRuleId !== rule.combatPowerRuleId) {
      return reject(COMBAT_SEQUENCE_REJECTIONS.startChallengeDefinitionMismatch, {
        challengeId: String(challenge.challengeId),
        reason: 'combatPowerRuleId',
      });
    }
    if (
      view.attackExperienceBudget !== challenge.attackExperienceBudget ||
      view.defenseExperienceBudget !== challenge.defenseExperienceBudget
    ) {
      return reject(COMBAT_SEQUENCE_REJECTIONS.startChallengeDefinitionMismatch, {
        challengeId: String(challenge.challengeId),
        reason: 'experienceBudget',
      });
    }
  }

  const power = cmd.teamPowerSnapshot;
  if (power.teamId !== cmd.teamId) {
    return reject(COMBAT_SEQUENCE_REJECTIONS.startTeamPowerMismatch, { reason: 'teamId' });
  }
  if (power.combatPowerRuleId !== rule.combatPowerRuleId) {
    return reject(COMBAT_SEQUENCE_REJECTIONS.startTeamPowerMismatch, { reason: 'combatPowerRuleId' });
  }
  if (!isNonNegativeFinite(power.totalPower)) {
    return reject(COMBAT_SEQUENCE_REJECTIONS.startTeamPowerMismatch, { reason: 'totalPowerInvalid' });
  }
  if (cmd.allocationSnapshot.teamPowerRevisionKey !== power.sourceRevisionKey) {
    return reject(COMBAT_SEQUENCE_REJECTIONS.startTeamPowerMismatch, { reason: 'revisionKey' });
  }
  // doc §4.1 不變量 12：Team Power 的參與者集合必須與 Allocation Snapshot 完全相同。
  const memberIds = cmd.allocationSnapshot.members.map((member) => String(member.characterId)).sort();
  const participantIds = power.participantCharacterIds.map(String).sort();
  if (memberIds.join(',') !== participantIds.join(',')) {
    return reject(COMBAT_SEQUENCE_REJECTIONS.startTeamPowerMismatch, { reason: 'participants' });
  }

  const snapshotReason = validateAllocationSnapshot(cmd.allocationSnapshot, rule, ctx.reader);
  if (snapshotReason !== undefined) {
    return reject(COMBAT_SEQUENCE_REJECTIONS.startAllocationSnapshotInvalid, {
      reason: snapshotReason.reason,
      ...(snapshotReason.characterId !== undefined
        ? { characterId: snapshotReason.characterId }
        : {}),
    });
  }

  const sequence: CombatSequenceAggregate = {
    sequenceId: cmd.sequenceId,
    teamId: cmd.teamId,
    source: cmd.source,
    ruleId: cmd.ruleId,
    allocationSnapshot: cmd.allocationSnapshot,
    teamPower: power.totalPower,
    challengeOrder: cmd.challenges.map((challenge) => challenge.challengeId),
    challenges: indexChallenges(cmd.challenges),
    cursor: 0,
    results: {},
    status: 'active',
    startedOnDay: ctx.worldDay,
    rngContext: cmd.rngContext,
    rngDrawIndex: 0,
    revision: 0 as Revision,
  };
  return accept(upsertSequence(state, sequence));
}

// ──────────────────────────────────────────────────────────────────────────
// 單一 Challenge 狀態轉移（doc §6.4）
// ──────────────────────────────────────────────────────────────────────────

// 一個 roll 消耗一格 cursor（doc §4.1 不變量 10：只在 roll 隨交易提交時 +1）。
function advanceRng(
  sequence: CombatSequenceAggregate,
): Readonly<{ rngContext: RngContext; rngDrawIndex: number }> {
  return {
    rngContext: { ...sequence.rngContext, cursor: (sequence.rngContext.cursor + 1) as RngCursor },
    rngDrawIndex: sequence.rngDrawIndex + 1,
  };
}

type TerminalReason = Exclude<CombatSequenceTerminationReason, 'sourceInvalidated'>;

// 寫入最終 Result、前進 cursor、必要時轉 awaitingSourceCommit 並發事件。
function withFinalizedResult(
  sequence: CombatSequenceAggregate,
  result: CombatSequenceChallengeResult,
  rng: Readonly<{ rngContext: RngContext; rngDrawIndex: number }>,
): Readonly<{
  sequence: CombatSequenceAggregate;
  messages: readonly TransactionMessageDraft[];
}> {
  const challenge = sequence.challenges[result.challengeId];
  if (challenge === undefined) {
    throw new Error(
      `combat-sequence: 找不到 Challenge ${String(result.challengeId)}（Aggregate 不變量破損）`,
    );
  }
  const cursor = sequence.cursor + 1;
  // doc §4.1 不變量 7：Challenge 失敗後立即進入 awaitingSourceCommit，不得解析後續 Challenge。
  const failed = result.outcome === 'failure';
  const atEnd = cursor >= sequence.challengeOrder.length;
  const terminationReason: TerminalReason | undefined = failed
    ? 'challengeFailed'
    : atEnd
      ? 'allResolved'
      : undefined;

  const next = clearPendingRetry({
    ...sequence,
    results: { ...sequence.results, [result.challengeId]: result },
    cursor,
    rngContext: rng.rngContext,
    rngDrawIndex: rng.rngDrawIndex,
    status: terminationReason !== undefined ? 'awaitingSourceCommit' : 'active',
    ...(terminationReason !== undefined ? { terminationReason } : {}),
    revision: bumpRevision(sequence.revision),
  });

  const messages: TransactionMessageDraft[] = [
    event({
      type: 'CombatSequenceChallengeResolved',
      sequenceId: sequence.sequenceId,
      teamId: sequence.teamId,
      challengeId: result.challengeId,
      resultId: result.resultId,
      sourceRef: challenge.sourceRef,
      outcome: result.outcome,
    }),
  ];
  if (terminationReason !== undefined) {
    messages.push(
      event({
        type: 'CombatSequenceReadyForSourceCommit',
        sequenceId: sequence.sequenceId,
        teamId: sequence.teamId,
        terminationReason,
      }),
    );
  }
  return { sequence: next, messages };
}

// doc §6.2：門檻與上限皆為資料；補品選擇按 Policy 並以穩定 ID 破同值。
function selectRetrySupply(
  policy: RetrySupplyPolicyDefinition,
  candidates: readonly RetrySupplyCandidate[],
): RetrySupplyCandidate | undefined {
  // policy.selection 的唯一許可值是 'lowestValueThenStableId'（型別已窄化）。
  const eligible = candidates.filter(
    (candidate) => candidate.availableQuantity >= policy.quantityPerRetry,
  );
  return [...eligible].sort(
    (a, b) => a.unitValue - b.unitValue || stableCompare(String(a.itemId), String(b.itemId)),
  )[0];
}

type RetryDecision =
  | Readonly<{ kind: 'eligible'; candidate: RetrySupplyCandidate }>
  | Readonly<{ kind: 'ineligible'; reason: string }>;

function decideRetry(
  sequence: CombatSequenceAggregate,
  challenge: CombatSequenceChallengeSnapshot,
  rule: CombatSequenceRuleDefinition,
  attemptsSoFar: number,
  ctx: CombatSequenceContext,
): RetryDecision {
  const retriesUsed = attemptsSoFar - 1;
  if (retriesUsed >= rule.maxRetryCountPerChallenge) {
    return { kind: 'ineligible', reason: 'retryLimitReached' };
  }
  // doc §6.2：abs(teamPower - enemyPower) / max(enemyPower, 1) <= retryRelativePowerGapMaximum。
  // 分母的 1 是除零保護（結構），不是可調量。
  const relativeGap =
    Math.abs(sequence.teamPower - challenge.enemyPower) / Math.max(challenge.enemyPower, 1);
  if (relativeGap > rule.retryRelativePowerGapMaximum) {
    return { kind: 'ineligible', reason: 'powerGapTooLarge' };
  }
  const policy = ctx.reader.getRetrySupplyPolicy(rule.retrySupplyPolicyId);
  const candidate = selectRetrySupply(
    policy,
    ctx.supply.listEligibleRetrySupplies({
      teamId: sequence.teamId,
      participantCharacterIds: sequence.allocationSnapshot.members.map(
        (member) => member.characterId,
      ),
      policyId: rule.retrySupplyPolicyId,
    }),
  );
  if (candidate === undefined) return { kind: 'ineligible', reason: 'noEligibleSupply' };
  return { kind: 'eligible', candidate };
}

// 把「已擲過的骰」推進到下一步：成功／不可重骰 → 定案；可重骰 → 記 pendingRetry 並請 inventory 消耗補品。
function progressAfterRoll(
  sequence: CombatSequenceAggregate,
  challenge: CombatSequenceChallengeSnapshot,
  rule: CombatSequenceRuleDefinition,
  ctx: CombatSequenceContext,
  draft: Readonly<{
    resultId: CombatSequenceChallengeResultId;
    attemptedOnDay: WorldDay;
    attempts: readonly CombatSequenceRollResult[];
    consumedSupplyItemIds: readonly ItemInstanceId[];
  }>,
): Readonly<{
  sequence: CombatSequenceAggregate;
  messages: readonly TransactionMessageDraft[];
}> {
  const rng = advanceRng(sequence);
  const lastAttempt = draft.attempts[draft.attempts.length - 1];
  if (lastAttempt === undefined) {
    throw new Error('combat-sequence: progressAfterRoll 需要至少一次擲骰');
  }

  if (lastAttempt.success) {
    return withFinalizedResult(
      sequence,
      {
        resultId: draft.resultId,
        challengeId: challenge.challengeId,
        attemptedOnDay: draft.attemptedOnDay,
        outcome: 'success',
        attempts: [...draft.attempts],
        consumedSupplyItemIds: [...draft.consumedSupplyItemIds],
      },
      rng,
    );
  }

  const decision = decideRetry(sequence, challenge, rule, draft.attempts.length, ctx);
  if (decision.kind === 'ineligible') {
    return withFinalizedResult(
      sequence,
      {
        resultId: draft.resultId,
        challengeId: challenge.challengeId,
        attemptedOnDay: draft.attemptedOnDay,
        outcome: 'failure',
        attempts: [...draft.attempts],
        consumedSupplyItemIds: [...draft.consumedSupplyItemIds],
      },
      rng,
    );
  }

  // 重骰資格成立：先請 inventory 原子消耗一份補品，重骰在其 Domain Event 的訂閱者裡發生。
  // cursor 不前進、status 仍 active；RNG 只前進「已經擲出的那一顆」。
  const pendingRetry: CombatSequencePendingRetry = {
    challengeId: challenge.challengeId,
    resultId: draft.resultId,
    attemptedOnDay: draft.attemptedOnDay,
    attempts: [...draft.attempts],
    consumedSupplyItemIds: [...draft.consumedSupplyItemIds],
    requestedItemId: decision.candidate.itemId,
    requestedOwnerCharacterId: decision.candidate.ownerCharacterId,
  };
  const next: CombatSequenceAggregate = {
    ...sequence,
    rngContext: rng.rngContext,
    rngDrawIndex: rng.rngDrawIndex,
    pendingRetry,
    revision: bumpRevision(sequence.revision),
  };
  return {
    sequence: next,
    messages: [
      internal({
        type: 'ConsumeCombatSequenceRetrySupply',
        sequenceId: sequence.sequenceId,
        challengeId: challenge.challengeId,
        participantCharacterId: decision.candidate.ownerCharacterId,
      }),
    ],
  };
}

// 三個 Handler 共用的「拿到可解析的 Sequence + cursor 指向的 Challenge」守門。
type ActiveTarget = Readonly<{
  sequence: CombatSequenceAggregate;
  challenge: CombatSequenceChallengeSnapshot;
}>;

function requireResolvableTarget(
  state: CombatSequenceModuleState,
  sequenceId: CombatSequenceAggregate['sequenceId'],
  expectedChallengeId: CombatSequenceChallengeId,
): ActiveTarget | CombatSequenceHandlerResult {
  const sequence = tryGetSequence(state, sequenceId);
  if (sequence === undefined) {
    return reject(COMBAT_SEQUENCE_REJECTIONS.sequenceNotFound, { sequenceId: String(sequenceId) });
  }
  if (sequence.status !== 'active') {
    return reject(COMBAT_SEQUENCE_REJECTIONS.notActive, {
      sequenceId: String(sequenceId),
      status: sequence.status,
    });
  }
  if (sequence.pendingRetry !== undefined) {
    return reject(COMBAT_SEQUENCE_REJECTIONS.retryPending, {
      sequenceId: String(sequenceId),
      challengeId: String(sequence.pendingRetry.challengeId),
    });
  }
  const challenge = currentChallengeOf(sequence);
  if (challenge === undefined || challenge.challengeId !== expectedChallengeId) {
    return reject(COMBAT_SEQUENCE_REJECTIONS.challengeMismatch, {
      sequenceId: String(sequenceId),
      expectedChallengeId: String(expectedChallengeId),
      cursor: sequence.cursor,
    });
  }
  return { sequence, challenge };
}

function isRejection(
  value: ActiveTarget | CombatSequenceHandlerResult,
): value is CombatSequenceHandlerResult {
  return 'ok' in value;
}

export function handleResolveNextCombatSequenceChallenge(
  state: CombatSequenceModuleState,
  cmd: ResolveNextCombatSequenceChallenge,
  ctx: CombatSequenceContext,
): CombatSequenceHandlerResult {
  const target = requireResolvableTarget(state, cmd.sequenceId, cmd.expectedChallengeId);
  if (isRejection(target)) return target;
  const { sequence, challenge } = target;

  const rule = ctx.reader.getRule(sequence.ruleId);
  const attempt = ctx.resolver.resolveInitial({
    rule,
    teamPower: sequence.teamPower,
    enemyPower: challenge.enemyPower,
    attemptIndex: 0,
    rngContext: sequence.rngContext,
    rngDrawIndex: sequence.rngDrawIndex,
  });

  const progressed = progressAfterRoll(sequence, challenge, rule, ctx, {
    resultId: ctx.nextChallengeResultId(),
    attemptedOnDay: cmd.attemptedOnDay,
    attempts: [attempt],
    consumedSupplyItemIds: [],
  });
  return accept(upsertSequence(state, progressed.sequence), progressed.messages);
}

export function handleSkipNextCombatSequenceChallenge(
  state: CombatSequenceModuleState,
  cmd: SkipNextCombatSequenceChallenge,
  ctx: CombatSequenceContext,
): CombatSequenceHandlerResult {
  const target = requireResolvableTarget(state, cmd.sequenceId, cmd.expectedChallengeId);
  if (isRejection(target)) return target;
  const { sequence, challenge } = target;

  // doc §6.4：skip 不消耗 RNG、補品或經驗；attemptedOnDay 留空（沒有嘗試過）。
  const progressed = withFinalizedResult(
    sequence,
    {
      resultId: ctx.nextChallengeResultId(),
      challengeId: challenge.challengeId,
      outcome: 'skippedBeforeAttempt',
      attempts: [],
      consumedSupplyItemIds: [],
    },
    { rngContext: sequence.rngContext, rngDrawIndex: sequence.rngDrawIndex },
  );
  return accept(upsertSequence(state, progressed.sequence), progressed.messages);
}

// ──────────────────────────────────────────────────────────────────────────
// Domain Event Subscriber：CombatSequenceRetrySupplyConsumed（doc §6.2／§6.3）
// ──────────────────────────────────────────────────────────────────────────

// inventory 契約的事件 payload（消耗成功的事實）；此處只引用需要的欄位形狀。
export type CombatSequenceRetrySupplyConsumedPayload = Readonly<{
  type: 'CombatSequenceRetrySupplyConsumed';
  sequenceId: CombatSequenceAggregate['sequenceId'];
  challengeId: CombatSequenceChallengeId;
  itemId: ItemInstanceId;
  ownerCharacterId: CharacterId;
  quantity: 1;
}>;

export const COMBAT_SEQUENCE_RETRY_SUPPLY_SUBSCRIPTION =
  'subscription.CombatSequenceRetrySupplyConsumed.combat-sequence';

export function onCombatSequenceRetrySupplyConsumed(
  state: CombatSequenceModuleState,
  payload: CombatSequenceRetrySupplyConsumedPayload,
  ctx: CombatSequenceContext,
): ModuleResult<CombatSequenceModuleState> {
  const sequence = tryGetSequence(state, payload.sequenceId);
  if (sequence === undefined) return subscriberNoop(state);
  const pending = sequence.pendingRetry;
  // 冪等：這筆消耗對應的重骰已經做過（pendingRetry 已清），或事件屬於別的 Challenge。
  // 資料齊全時仍會 no-op，因為「該重骰已經發生」——不是掩蓋缺口。
  if (pending === undefined || pending.challengeId !== payload.challengeId) {
    return subscriberNoop(state);
  }
  const challenge = sequence.challenges[pending.challengeId];
  if (challenge === undefined) return subscriberNoop(state);

  const rule = ctx.reader.getRule(sequence.ruleId);
  const attempt = ctx.resolver.resolveRetry({
    rule,
    teamPower: sequence.teamPower,
    enemyPower: challenge.enemyPower,
    attemptIndex: pending.attempts.length,
    rngContext: sequence.rngContext,
    rngDrawIndex: sequence.rngDrawIndex,
    consumedSupplyItemId: payload.itemId,
  });

  // 記錄的是**實際被消耗**的道具（事件是事實），不是我們選中的那一筆。
  const progressed = progressAfterRoll(sequence, challenge, rule, ctx, {
    resultId: pending.resultId,
    attemptedOnDay: pending.attemptedOnDay,
    attempts: [...pending.attempts, attempt],
    consumedSupplyItemIds: [...pending.consumedSupplyItemIds, payload.itemId],
  });
  return moduleResult(upsertSequence(state, progressed.sequence), progressed.messages);
}

// ──────────────────────────────────────────────────────────────────────────
// Internal Command：StopCombatSequence（doc §6.1）
// ──────────────────────────────────────────────────────────────────────────

export function handleStopCombatSequence(
  state: CombatSequenceModuleState,
  cmd: StopCombatSequence,
  _ctx: CombatSequenceContext,
): CombatSequenceHandlerResult {
  const sequence = tryGetSequence(state, cmd.sequenceId);
  if (sequence === undefined) {
    return reject(COMBAT_SEQUENCE_REJECTIONS.sequenceNotFound, {
      sequenceId: String(cmd.sequenceId),
    });
  }
  if (sequence.status === 'settled' || sequence.status === 'invalid') {
    return reject(COMBAT_SEQUENCE_REJECTIONS.stopAlreadyTerminal, {
      sequenceId: String(cmd.sequenceId),
      status: sequence.status,
    });
  }
  if (sequence.status === 'awaitingSourceCommit') {
    // 冪等：已經停下且原因相同（Host 重送）。原因不同代表兩個呼叫端對事實有分歧，必須拒絕。
    if (sequence.terminationReason === cmd.reason) return accept(state);
    return reject(COMBAT_SEQUENCE_REJECTIONS.stopReasonConflict, {
      sequenceId: String(cmd.sequenceId),
      existingReason: String(sequence.terminationReason),
      requestedReason: cmd.reason,
    });
  }
  // active：不再解析後續節點，轉為等待來源提交。pendingRetry 一併作廢（補品消耗事件回來時會 no-op）。
  const next = clearPendingRetry({
    ...sequence,
    status: 'awaitingSourceCommit',
    terminationReason: cmd.reason,
    revision: bumpRevision(sequence.revision),
  });
  return accept(upsertSequence(state, next), [
    event({
      type: 'CombatSequenceReadyForSourceCommit',
      sequenceId: sequence.sequenceId,
      teamId: sequence.teamId,
      terminationReason: cmd.reason,
    }),
  ]);
}

// ──────────────────────────────────────────────────────────────────────────
// Internal Command：InvalidateCombatSequence（doc §6.1）
// ──────────────────────────────────────────────────────────────────────────

export function handleInvalidateCombatSequence(
  state: CombatSequenceModuleState,
  cmd: InvalidateCombatSequence,
  ctx: CombatSequenceContext,
): CombatSequenceHandlerResult {
  const sequence = tryGetSequence(state, cmd.sequenceId);
  if (sequence === undefined) {
    return reject(COMBAT_SEQUENCE_REJECTIONS.sequenceNotFound, {
      sequenceId: String(cmd.sequenceId),
    });
  }
  // doc §4.1 不變量 9：settled Sequence 已經發過成長來源，不得改寫成 invalid（否則等於撤回已發放的 MXP）。
  if (sequence.status === 'settled') {
    return reject(COMBAT_SEQUENCE_REJECTIONS.invalidateAlreadySettled, {
      sequenceId: String(cmd.sequenceId),
    });
  }
  // 冪等：已經 invalid。第一個原因是真正的成因，不被後續呼叫覆寫。
  if (sequence.status === 'invalid') return accept(state);

  const next = clearPendingRetry({
    ...sequence,
    status: 'invalid',
    terminationReason: 'sourceInvalidated',
    endedOnDay: ctx.worldDay,
    revision: bumpRevision(sequence.revision),
  });
  return accept(upsertSequence(state, next), [
    event({
      type: 'CombatSequenceInvalidated',
      sequenceId: sequence.sequenceId,
      teamId: sequence.teamId,
      reason: cmd.reason,
    }),
  ]);
}

// ──────────────────────────────────────────────────────────────────────────
// Internal Command：CommitCombatSequenceSourceResults（doc §7）
// ──────────────────────────────────────────────────────────────────────────

function requireTerminationReason(sequence: CombatSequenceAggregate): TerminalReason {
  const reason = sequence.terminationReason;
  if (reason === undefined || reason === 'sourceInvalidated') {
    // awaitingSourceCommit 一律由 withFinalizedResult / handleStop 設定非 sourceInvalidated 的原因；
    // 走到這裡代表 Aggregate 不變量破損，不是內容缺失，因此明確炸掉而不是回一個 rejection。
    throw new Error(
      `combat-sequence: ${String(sequence.sequenceId)} 處於 ${sequence.status} 卻沒有可提交的 terminationReason`,
    );
  }
  return reason;
}

export function handleCommitCombatSequenceSourceResults(
  state: CombatSequenceModuleState,
  cmd: CommitCombatSequenceSourceResults,
  ctx: CombatSequenceContext,
): CombatSequenceHandlerResult {
  const sequence = tryGetSequence(state, cmd.sequenceId);
  if (sequence === undefined) {
    return reject(COMBAT_SEQUENCE_REJECTIONS.sequenceNotFound, {
      sequenceId: String(cmd.sequenceId),
    });
  }
  // doc §4.1 不變量 11：相同 sourceCommitId 重送回傳既有結果、不再發事件；不同 ID 重送則拒絕。
  if (sequence.status === 'settled') {
    const settlement = sequence.settlement;
    if (settlement !== undefined && settlement.sourceCommitId === cmd.sourceCommitId) {
      return accept(state);
    }
    return reject(COMBAT_SEQUENCE_REJECTIONS.commitIdConflict, {
      sequenceId: String(cmd.sequenceId),
      requestedCommitId: String(cmd.sourceCommitId),
    });
  }
  if (sequence.status !== 'awaitingSourceCommit') {
    return reject(COMBAT_SEQUENCE_REJECTIONS.commitNotAwaiting, {
      sequenceId: String(cmd.sequenceId),
      status: sequence.status,
    });
  }

  const successfulById = new Map(
    listSuccessfulResults(sequence).map((result) => [String(result.resultId), result]),
  );
  const seen = new Set<string>();
  const acceptedChallenges: AcceptedCombatSequenceChallengeExperience[] = [];
  for (const resultId of cmd.acceptedSuccessfulResultIds) {
    const key = String(resultId);
    if (seen.has(key)) {
      return reject(COMBAT_SEQUENCE_REJECTIONS.commitResultNotAccepted, {
        resultId: key,
        reason: 'duplicate',
      });
    }
    seen.add(key);
    const result = successfulById.get(key);
    if (result === undefined) {
      return reject(COMBAT_SEQUENCE_REJECTIONS.commitResultNotAccepted, {
        resultId: key,
        reason: 'notASuccessfulResultOfThisSequence',
      });
    }
    const challenge = sequence.challenges[result.challengeId];
    if (challenge === undefined) {
      return reject(COMBAT_SEQUENCE_REJECTIONS.commitResultNotAccepted, {
        resultId: key,
        reason: 'challengeMissing',
      });
    }
    acceptedChallenges.push({
      resultId: result.resultId,
      attackExperienceBudget: challenge.attackExperienceBudget,
      defenseExperienceBudget: challenge.defenseExperienceBudget,
    });
  }

  const rule = ctx.reader.getRule(sequence.ruleId);
  const allocation = ctx.allocator.allocate({
    sequenceId: sequence.sequenceId,
    rule,
    allocationSnapshot: sequence.allocationSnapshot,
    acceptedChallenges,
  });
  const totals = totalBudgets(acceptedChallenges);
  const terminationReason = requireTerminationReason(sequence);

  const settlement: CombatSequenceSettlementRecord = {
    sourceCommitId: cmd.sourceCommitId,
    acceptedSuccessfulResultIds: [...cmd.acceptedSuccessfulResultIds],
    acceptedSuccessfulCount: acceptedChallenges.length,
    totalAttackExperienceBudget: totals.attack,
    totalDefenseExperienceBudget: totals.defense,
    settledOnDay: cmd.committedOnDay,
  };
  const next = clearPendingRetry({
    ...sequence,
    status: 'settled',
    settlement,
    endedOnDay: cmd.committedOnDay,
    revision: bumpRevision(sequence.revision),
  });

  const source = { kind: 'combatSequence', sequenceId: sequence.sequenceId } as const;
  const messages: TransactionMessageDraft[] = [
    event({
      type: 'CombatSequenceSettled',
      sequenceId: sequence.sequenceId,
      teamId: sequence.teamId,
      source: sequence.source,
      terminationReason,
      acceptedSuccessfulCount: settlement.acceptedSuccessfulCount,
      totalAttackExperienceBudget: totals.attack,
      totalDefenseExperienceBudget: totals.defense,
    }),
  ];
  if (allocation.attackAwards.length > 0) {
    messages.push(
      event({
        type: 'CombatAttackMasteryEarned',
        source,
        characterAwards: allocation.attackAwards,
      }),
    );
  }
  if (allocation.defenseAwards.length > 0) {
    messages.push(
      event({
        type: 'CombatDefenseMasteryEarned',
        source,
        characterAwards: allocation.defenseAwards,
      }),
    );
  }
  for (const award of allocation.supportAwards) {
    // creditedUseCount 為 0（來源一筆都沒被接受）時不發事件：沒有使用就沒有成長來源。
    if (award.creditedUseCount <= 0) continue;
    messages.push(event({ type: 'CombatSupportMasteryEarned', source, ...award }));
  }
  return accept(upsertSequence(state, next), messages);
}

// ──────────────────────────────────────────────────────────────────────────
// Internal Command：ReleaseCombatSequence（doc §6.1）
// ──────────────────────────────────────────────────────────────────────────

export function handleReleaseCombatSequence(
  state: CombatSequenceModuleState,
  cmd: ReleaseCombatSequence,
  _ctx: CombatSequenceContext,
): CombatSequenceHandlerResult {
  const sequence = tryGetSequence(state, cmd.sequenceId);
  if (sequence === undefined) {
    return reject(COMBAT_SEQUENCE_REJECTIONS.sequenceNotFound, {
      sequenceId: String(cmd.sequenceId),
    });
  }
  if (sequence.status !== 'settled' && sequence.status !== 'invalid') {
    return reject(COMBAT_SEQUENCE_REJECTIONS.releaseNotReleasable, {
      sequenceId: String(cmd.sequenceId),
      status: sequence.status,
    });
  }
  if (sequence.revision !== cmd.expectedRevision) {
    return reject(COMBAT_SEQUENCE_REJECTIONS.releaseRevisionMismatch, {
      sequenceId: String(cmd.sequenceId),
      actualRevision: sequence.revision,
      expectedRevision: cmd.expectedRevision,
    });
  }
  return accept(removeSequence(state, cmd.sequenceId));
}

// ── 診斷用純讀取（Query 不公開 roll／機率，doc §5；此處供測試與 debug adapter）─────
export function listChallengeResults(
  sequence: CombatSequenceAggregate,
): readonly CombatSequenceChallengeResult[] {
  return listResults(sequence);
}
