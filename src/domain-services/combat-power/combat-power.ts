// domain-services/combat-power/combat-power.ts
// 對應 docs/00_core/architecture/22_combat_power_service.md 與 src/contracts/combat-power/index.ts。
//
// 這是**聚合評估**服務，不是傷害計算器：它把 Statistics 算好的能力、合法技能配置、生效裝備效果與
// 陣形，依同一份資料規則壓成可比較的角色／隊伍／敵方戰力，供 NPC 決策、任務評估與 UI 比較使用。
// 實際戰鬥判定走 combat 模組的 CombatResolverPort，與本服務無關（兩者只共用同一份能力來源）。
//
// 三條硬性紀律，讀這個檔時請一路對照：
//
//  1. **沒有 State、沒有 I/O、沒有 RNG、沒有時鐘。** 全部是純函式；同一組 Input + Rule + Revision
//     必得逐位相同的結果。
//  2. **權重全是資料。** 本檔沒有任何倍率、門檻或係數字面值——連藏在算式裡的都沒有。
//     Feature 係數來自 CombatPowerFeatureRuleDefinition.coefficient，加權形狀走 §7.1 的
//     weightedLinearProduct kernel；聚合、陣形、轉換、能力縮放與期望成功率全部走資料指定的 Resolver。
//     哪些「特徵」存在（治療能力、控場、AOE…）也是內容列舉的：程式只做「收集貢獻 → 依 rule 聚合」，
//     所以換一份 Pack 必然改變戰力排序。
//  3. **缺資料明確失敗。** Definition 缺失由 Reader 拋錯；世界事實缺失由注入的 Port 回 undefined，
//     本檔轉成 CombatPowerRejection（帶錯誤碼）。沒有任何一處用預設值把缺口補平。
//
// 副屬性、最大生命與最大魔力**不在這裡算**：CombatUnitStatisticsSnapshot 是輸入，由 statistics
// 純服務（contracts/statistics）算好交進來。本服務不得自行推導任何副屬性。

import {
  MAX_FORMAL_MEMBERS,
  type CharacterId,
  type ContentPackId,
  type DefinitionHeader,
  type DefinitionId,
  type EquipmentEffectDefinitionId,
  type MonsterDefinitionId,
  type Revision,
  type ResolverId,
  type SkillDefinitionId,
  type StatisticsRuleId,
  type TeamId,
  type WeaponRequirementId,
  type WeaponSetId,
} from '../../contracts/core';
import type {
  CombatCapabilityId,
  CombatPowerCalculator,
  CombatPowerCapabilityContribution,
  CombatPowerDefinitionReader,
  CombatPowerEquipmentEffectView,
  CombatPowerFeatureAmount,
  CombatPowerFeatureRuleDefinition,
  CombatPowerFeatureId,
  CombatPowerFeatureSource,
  CombatPowerFeasibilityRuleDefinition,
  CombatPowerFormationMember,
  CombatPowerQuery,
  CombatPowerRiskBand,
  CombatPowerRuleDefinition,
  CombatPowerSkillDefinitionView,
  CombatPowerUnitInput,
  CombatPowerUnitSnapshot,
  CombatUnitStatisticsSnapshot,
  CharacterCombatPowerQueryInput,
  EncounterCombatPowerCalculationInput,
  EncounterCombatPowerQueryInput,
  EncounterCombatPowerSnapshot,
  EquipmentLoadoutCandidateId,
  EquipmentLoadoutPowerComparisonInput,
  EquipmentLoadoutPowerComparisonResult,
  NpcQuestFeasibility,
  NpcQuestFeasibilityInput,
  TeamCombatPowerCalculationInput,
  TeamCombatPowerInput,
  TeamCombatPowerSnapshot,
} from '../../contracts/combat-power';
import type { EncounterGroupDefinitionId } from '../../contracts/core';
import type { CharacterEquipmentLoadoutView } from '../../contracts/inventory';
import type { GridCell } from '../../contracts/map';
import type { QuestObjectiveView } from '../../contracts/quest';
import { weightedLinearProduct } from '../../data-runtime';

// ══════════════════════════════════════════════════════════════════════════
// 拒絕分類
// ══════════════════════════════════════════════════════════════════════════
//
// 本服務是唯讀 Query／純 Calculator，沒有 ModuleOutcome 可用（那是 Handler 的形狀），但拒絕仍必須
// 是**分類過、可呈現**的，不能只是一句字串。錯誤碼本身是程式身分（規範明列的合法字面值），
// 不是內容資料。呼叫端以 code 判斷，不解析訊息文字。

export const CombatPowerRejectionCode = {
  /** 內容或 Resolver 產生了不成立的值（非有限數、機率出界、風險帶查不到）。 */
  InvalidContent: 'combat-power/invalid-content',
  /** 同一條 Rule 內出現重複 Feature ID（§7.2）。 */
  DuplicateFeature: 'combat-power/duplicate-feature',
  /** Rule 之間不相符：Feasibility Rule 綁的不是被評估的那條 Combat Power Rule。 */
  RuleMismatch: 'combat-power/rule-mismatch',
  /** 陣形不成立：占格為空、anchor 不在占格內、或兩個單位占同一格。 */
  InvalidFormation: 'combat-power/invalid-formation',
  /** 單位種類放錯邊：隊伍收到 Monster，或 Encounter 收到 Character。 */
  InvalidUnitKind: 'combat-power/invalid-unit-kind',
  /** 隊伍人數不在 1～9，或成員重複。 */
  InvalidTeamSize: 'combat-power/invalid-team-size',
  /** 角色當下不可參戰（死亡、非正式成員、任務性臨時角色）。 */
  CharacterNotBattleReady: 'combat-power/character-not-battle-ready',
  /** 要求評估的技能不在該武器組的合法配置內（未學會／武器需求不符／超過上限）。 */
  SkillNotConfigured: 'combat-power/skill-not-configured',
  /** Statistics 服務取不到該角色在該 Statistics Rule 下的快照。 */
  StatisticsUnavailable: 'combat-power/statistics-unavailable',
  /** 武器組不存在、未持有或裝備位置不合法。 */
  WeaponSetUnavailable: 'combat-power/weapon-set-unavailable',
  /** Team Query 取不到該隊伍的正式成員與陣形。 */
  TeamCompositionUnavailable: 'combat-power/team-composition-unavailable',
  /** 正式成員集合與傳入的武器組清單不完全相等（§7.8）。 */
  TeamMemberSetMismatch: 'combat-power/team-member-set-mismatch',
  /** 傳入的 formationRevision 與 Team Query 當下的陣形版本不同（快照過期）。 */
  FormationRevisionMismatch: 'combat-power/formation-revision-mismatch',
  /** 取不到該 Encounter Group 的編組與站位。 */
  EncounterCompositionUnavailable: 'combat-power/encounter-composition-unavailable',
  /** Loadout 候選重複的 candidateId（穩定排序的前提）。 */
  DuplicateLoadoutCandidate: 'combat-power/duplicate-loadout-candidate',
} as const;

export type CombatPowerRejectionCodeValue =
  (typeof CombatPowerRejectionCode)[keyof typeof CombatPowerRejectionCode];

export type CombatPowerRejectionDetails = Readonly<Record<string, string | number>>;

export class CombatPowerRejection extends Error {
  readonly code: CombatPowerRejectionCodeValue;
  readonly details: CombatPowerRejectionDetails;

  constructor(code: CombatPowerRejectionCodeValue, details: CombatPowerRejectionDetails) {
    super(`${code} ${JSON.stringify(details)}`);
    this.name = 'CombatPowerRejection';
    this.code = code;
    this.details = details;
  }
}

function reject(
  code: CombatPowerRejectionCodeValue,
  details: CombatPowerRejectionDetails,
): never {
  throw new CombatPowerRejection(code, details);
}

function requireFinite(value: number, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    reject(CombatPowerRejectionCode.InvalidContent, { field, actual: String(value) });
  }
  return value;
}

// ══════════════════════════════════════════════════════════════════════════
// Resolver Port（§7.1 慣例：在此宣告本地 port 型別，實作由整合者注入）
// ══════════════════════════════════════════════════════════════════════════
//
// 每個 Resolver 角色一個**固定的** Input／Result Schema（doc §7.3）。本檔只宣告形狀並呼叫；
// 實際查表與執行走 data-runtime 的 ResolverRegistry（app/content/resolver-adapter.ts）。
// 五個角色都必須是純的：無 RNG、無 Clock、無 I/O、無 State（doc §7.3）。

/** Feature 原始量 → 轉換後的量（例：對最大生命取次線性）。 */
export type CombatPowerFeatureTransformResolverInput = Readonly<{
  featureId: CombatPowerFeatureId;
  rawAmount: number;
}>;

/** Capability 貢獻的基礎值 → 依單位能力縮放後的值。 */
export type CombatPowerCapabilityScalingResolverInput = Readonly<{
  capabilityId: CombatCapabilityId;
  baseValue: number;
  statistics: CombatUnitStatisticsSnapshot;
}>;

/** 全部加權後的 Feature 量 → 單位戰力（rounding 與 minimumPower 由本檔在最終輸出套用）。 */
export type CombatPowerUnitAggregationResolverInput = Readonly<{
  featureAmounts: readonly CombatPowerFeatureAmount[];
}>;

/** 站位 + 成員戰力加總 → 陣形係數。 */
export type CombatPowerFormationResolverInput = Readonly<{
  placements: readonly Readonly<{
    power: number;
    anchorCell: GridCell;
    occupiedCells: readonly GridCell[];
  }>[];
  summedMemberPower: number;
}>;

/** 隊伍戰力與對抗戰力 → 期望成功率（0..1）。 */
export type CombatPowerExpectedSuccessResolverInput = Readonly<{
  teamPower: number;
  opposingPower: number;
}>;

export interface CombatPowerResolverPort {
  transformFeatureAmount(
    resolverId: ResolverId,
    input: CombatPowerFeatureTransformResolverInput,
  ): number;
  scaleCapabilityContribution(
    resolverId: ResolverId,
    input: CombatPowerCapabilityScalingResolverInput,
  ): number;
  aggregateUnitFeatures(
    resolverId: ResolverId,
    input: CombatPowerUnitAggregationResolverInput,
  ): number;
  resolveFormationModifier(
    resolverId: ResolverId,
    input: CombatPowerFormationResolverInput,
  ): number;
  resolveExpectedSuccess(
    resolverId: ResolverId,
    input: CombatPowerExpectedSuccessResolverInput,
  ): number;
}

// ══════════════════════════════════════════════════════════════════════════
// Revision Key（doc §5）
// ══════════════════════════════════════════════════════════════════════════
//
// Application Cache Key 必須包含完整 Query Input 與所有相關 Revision；任一項改變即丟棄舊值。
// 本服務不持有 Cache，但它產生的 sourceRevisionKey 就是那把鑰匙的內容面：把「呼叫端帶進來的
// Revision 片段」與「本服務實際讀到的 Definition 版本」串起來，讓上層無需知道公式細節也能失效。
//
// Content Manifest Identity 由組 Input 的一方（Query Facade 的注入 Port）帶進 sourceRevisionKey；
// 本檔只負責把片段接起來，不自行決定內容身分。

const REVISION_PART_SEPARATOR = '|';
const REVISION_FIELD_SEPARATOR = '@';

function joinRevisionParts(parts: readonly string[]): string {
  return parts.join(REVISION_PART_SEPARATOR);
}

/**
 * 一筆 Definition 的版本片段。`DefinitionHeader` 沒有 revision 欄位，能唯一標定「同一份作者資料的
 * 這一版」的就是 id + schemaVersion + packId（pack 的 version／hash 由 Manifest Identity 那一段涵蓋）。
 * 匯出是為了讓 Definition Reader 的窄化 View（Skill／Equipment Effect）用**同一個格式**產生
 * sourceRevisionKey——格式只能有一份，否則兩邊各拼一套，Cache 失效條件就對不起來了。
 */
export function combatPowerDefinitionRevisionKey(
  source: Readonly<{ id: DefinitionId; schemaVersion: number; packId: ContentPackId }>,
): string {
  return [String(source.id), String(source.schemaVersion), String(source.packId)].join(
    REVISION_FIELD_SEPARATOR,
  );
}

function definitionRevisionPart(header: DefinitionHeader<DefinitionId>): string {
  return combatPowerDefinitionRevisionKey(header);
}

// ══════════════════════════════════════════════════════════════════════════
// 站位與單位種類的結構檢查
// ══════════════════════════════════════════════════════════════════════════

function cellKey(cell: GridCell): string {
  return [cell.floor, cell.row, cell.col].map(String).join(REVISION_FIELD_SEPARATOR);
}

// doc §8.4：同一 Boss 無論占 3×3 或以一個 anchor 表示都只計一個 Unit。
// 占格是「這個單位有多大」，不是「這裡有幾個單位」——所以這裡只檢查站位互斥，加總一律按單位數。
function requireDisjointPlacement(members: readonly CombatPowerFormationMember[]): void {
  const occupied = new Set<string>();
  members.forEach((member, index) => {
    if (member.occupiedCells.length === 0) {
      reject(CombatPowerRejectionCode.InvalidFormation, { reason: 'emptyOccupiedCells', index });
    }
    const anchor = cellKey(member.anchorCell);
    if (!member.occupiedCells.some((cell) => cellKey(cell) === anchor)) {
      reject(CombatPowerRejectionCode.InvalidFormation, {
        reason: 'anchorOutsideOccupiedCells',
        index,
        anchor,
      });
    }
    for (const cell of member.occupiedCells) {
      const key = cellKey(cell);
      if (occupied.has(key)) {
        reject(CombatPowerRejectionCode.InvalidFormation, { reason: 'cellOccupiedTwice', cell: key });
      }
      occupied.add(key);
    }
  });
}

function requireCharacterMembers(
  members: readonly CombatPowerFormationMember[],
): readonly CharacterId[] {
  const characterIds: CharacterId[] = [];
  const seen = new Set<string>();
  members.forEach((member, index) => {
    const ref = member.unit.unitRef;
    if (ref.kind !== 'character') {
      reject(CombatPowerRejectionCode.InvalidUnitKind, {
        expected: 'character',
        actual: ref.kind,
        index,
      });
    }
    if (seen.has(String(ref.characterId))) {
      reject(CombatPowerRejectionCode.InvalidTeamSize, {
        reason: 'duplicateMember',
        characterId: String(ref.characterId),
      });
    }
    seen.add(String(ref.characterId));
    characterIds.push(ref.characterId);
  });
  return characterIds;
}

function requireMonsterMembers(members: readonly CombatPowerFormationMember[]): void {
  const seen = new Set<string>();
  members.forEach((member, index) => {
    const ref = member.unit.unitRef;
    if (ref.kind !== 'monster') {
      reject(CombatPowerRejectionCode.InvalidUnitKind, {
        expected: 'monster',
        actual: ref.kind,
        index,
      });
    }
    // memberIndex 的存在理由就是「同一 Definition 在 Encounter 中重複出現時仍有穩定識別」，
    // 所以 (definitionId, memberIndex) 必須唯一，否則兩個單位在快照裡分不開。
    const key = [String(ref.monsterDefinitionId), String(ref.memberIndex)].join(
      REVISION_FIELD_SEPARATOR,
    );
    if (seen.has(key)) {
      reject(CombatPowerRejectionCode.InvalidUnitKind, { reason: 'duplicateMemberIndex', key });
    }
    seen.add(key);
  });
}

// ══════════════════════════════════════════════════════════════════════════
// 資格判定（doc §2.3、§7.5、§8.3）
// ══════════════════════════════════════════════════════════════════════════
//
// 「有配置」不等於「算得進戰力」。兩層條件：
//   * 技能：武器需求。weaponRequirementIds 是**並列的可接受配置**（滿足其中任一即可使用）；
//     空清單代表這招沒有武器需求，任何配置都能用。
//   * 裝備效果：alwaysWhileEquipped 直接生效；configuredSkillCompatible 必須存在一個
//     **可用的**技能，其 Tag 集合涵蓋 requiredSkillTagIds 全部（「required」是全都要）。
//     用「可用的」而不是「有配置的」：一招用不出來就不會觸發它的裝備效果（§7.5 要求這件事
//     必須能由已選武器組與已配置技能完全判定）。

function eligibleSkills(
  input: Readonly<CombatPowerUnitInput>,
): readonly CombatPowerSkillDefinitionView[] {
  const satisfied = new Set(input.satisfiedWeaponRequirementIds.map(String));
  return input.configuredSkills.filter(
    (skill) =>
      skill.weaponRequirementIds.length === 0 ||
      skill.weaponRequirementIds.some((requirementId) => satisfied.has(String(requirementId))),
  );
}

function eligibleEquipmentEffects(
  input: Readonly<CombatPowerUnitInput>,
  usableSkills: readonly CombatPowerSkillDefinitionView[],
): readonly CombatPowerEquipmentEffectView[] {
  return input.activeEquipmentEffects.filter((effect) => {
    if (effect.triggerEligibility === 'alwaysWhileEquipped') return true;
    return usableSkills.some((skill) => {
      const tags = new Set(skill.skillTagIds.map(String));
      return effect.requiredSkillTagIds.every((tagId) => tags.has(String(tagId)));
    });
  });
}

// ══════════════════════════════════════════════════════════════════════════
// Calculator
// ══════════════════════════════════════════════════════════════════════════

export type CombatPowerCalculatorDeps = Readonly<{
  // 窄化 Reader：Feature Rule 由 rule.featureRuleIds 逐筆讀出。Calculator 的契約簽章只吃
  // (input, rule)，所以 Feature Rule 只能經注入的 Reader 取得——不是自己編一份預設清單。
  definitions: CombatPowerDefinitionReader;
  resolvers: CombatPowerResolverPort;
}>;

// weightedLinearProduct 的 KernelInputs 鍵。結構性鍵名，不是調校量。
const FEATURE_AMOUNT_INPUT_KEY = 'featureAmount';

export function createCombatPowerCalculator(
  deps: CombatPowerCalculatorDeps,
): CombatPowerCalculator {
  function readCapabilitySum(
    contributions: readonly CombatPowerCapabilityContribution[],
    capabilityId: CombatCapabilityId,
    statistics: CombatUnitStatisticsSnapshot,
  ): number {
    // 加總的起點是加法單位元（沒有貢獻＝沒有這項能力），不是替代缺資料的假值。
    let total = 0;
    for (const contribution of contributions) {
      if (String(contribution.capabilityId) !== String(capabilityId)) continue;
      const baseValue = requireFinite(contribution.baseValue, 'capabilityContribution.baseValue');
      const scalingResolverId = contribution.scalingResolverId;
      total +=
        scalingResolverId === undefined
          ? baseValue
          : requireFinite(
              deps.resolvers.scaleCapabilityContribution(scalingResolverId, {
                capabilityId,
                baseValue,
                statistics,
              }),
              'capabilityScalingResolver.result',
            );
    }
    return total;
  }

  function readFeatureSource(
    source: CombatPowerFeatureSource,
    input: Readonly<CombatPowerUnitInput>,
    usableSkills: readonly CombatPowerSkillDefinitionView[],
    usableEffects: readonly CombatPowerEquipmentEffectView[],
  ): number {
    const statistics = input.statistics;
    switch (source.kind) {
      case 'primaryAttribute':
        return requireFinite(
          statistics.effectivePrimaryAttributes[source.attributeId],
          `effectivePrimaryAttributes.${source.attributeId}`,
        );
      case 'secondaryAttribute': {
        const value = statistics.secondaryAttributes[source.attributeId];
        if (value === undefined) {
          // Statistics 快照沒有這項副屬性，代表 Combat Power Rule 與 Statistics Rule 對不上
          // （§7.1 要求引用都必須存在）。缺就是缺，不補 0。
          reject(CombatPowerRejectionCode.InvalidContent, {
            field: 'secondaryAttributes',
            missingAttributeId: String(source.attributeId),
          });
        }
        return requireFinite(value, `secondaryAttributes.${source.attributeId}`);
      }
      case 'maximumResource':
        return source.resource === 'health'
          ? requireFinite(statistics.maxHealth, 'maxHealth')
          : requireFinite(statistics.maxMana, 'maxMana');
      case 'skillCapability':
        return readCapabilitySum(
          usableSkills.flatMap((skill) => skill.capabilityContributions),
          source.capabilityId,
          statistics,
        );
      case 'equipmentEffectCapability':
        return readCapabilitySum(
          usableEffects.flatMap((effect) => effect.capabilityContributions),
          source.capabilityId,
          statistics,
        );
    }
  }

  // 最終輸出：先套資料指定的最小戰力（§7.6），再套資料指定的 rounding（doc §3.3）。
  // 中間值（Feature 量、轉換、聚合）全程保留完整精度，只有這裡取整。
  function finalizePower(rawPower: number, rule: Readonly<CombatPowerRuleDefinition>): number {
    const floored = Math.max(
      requireFinite(rawPower, 'aggregatedPower'),
      requireFinite(rule.minimumPower, 'rule.minimumPower'),
    );
    switch (rule.rounding) {
      case 'roundHalfUpAtFinalOutput':
        // Math.round 就是「.5 進位到較大值」；戰力經 minimumPower（非負）夾過後非負，
        // 所以不需要處理負數方向的差異。
        return Math.round(floored);
    }
  }

  function calculateUnit(
    input: Readonly<CombatPowerUnitInput>,
    rule: Readonly<CombatPowerRuleDefinition>,
  ): CombatPowerUnitSnapshot {
    const usableSkills = eligibleSkills(input);
    const usableEffects = eligibleEquipmentEffects(input, usableSkills);

    const seenFeatureIds = new Set<string>();
    const featureBreakdown: CombatPowerFeatureAmount[] = [];
    const featureRuleParts: string[] = [];

    for (const featureRuleId of rule.featureRuleIds) {
      // Reader 對未知 id / 跨 kind 一律拋錯——缺 Definition 在這裡就是明確失敗。
      const featureRule: CombatPowerFeatureRuleDefinition =
        deps.definitions.getFeatureRule(featureRuleId);
      const featureKey = String(featureRule.featureId);
      if (seenFeatureIds.has(featureKey)) {
        reject(CombatPowerRejectionCode.DuplicateFeature, {
          ruleId: String(rule.id),
          featureId: featureKey,
        });
      }
      seenFeatureIds.add(featureKey);
      featureRuleParts.push(definitionRevisionPart(featureRule));

      const rawAmount = readFeatureSource(featureRule.source, input, usableSkills, usableEffects);
      const transformResolverId = featureRule.transformResolverId;
      const amountBeforeCoefficient =
        transformResolverId === undefined
          ? rawAmount
          : requireFinite(
              deps.resolvers.transformFeatureAmount(transformResolverId, {
                featureId: featureRule.featureId,
                rawAmount,
              }),
              'featureTransformResolver.result',
            );

      // 加權形狀走 §7.1 kernel；係數是資料。kernel 自己會擋非有限的係數與輸入。
      const weightedAmount = weightedLinearProduct(
        {
          mode: 'linear',
          terms: [{ inputKey: FEATURE_AMOUNT_INPUT_KEY, weight: featureRule.coefficient }],
        },
        { [FEATURE_AMOUNT_INPUT_KEY]: amountBeforeCoefficient },
      );

      featureBreakdown.push({
        featureId: featureRule.featureId,
        amountBeforeCoefficient,
        coefficient: featureRule.coefficient,
        weightedAmount,
      });
    }

    const aggregated = requireFinite(
      deps.resolvers.aggregateUnitFeatures(rule.unitAggregationResolverId, {
        featureAmounts: featureBreakdown,
      }),
      'unitAggregationResolver.result',
    );

    return {
      unitRef: input.unitRef,
      combatPowerRuleId: rule.id,
      totalPower: finalizePower(aggregated, rule),
      featureBreakdown,
      sourceRevisionKey: joinRevisionParts([
        input.sourceRevisionKey,
        input.statistics.sourceRevisionKey,
        definitionRevisionPart(rule),
        ...featureRuleParts,
        ...input.configuredSkills.map((skill) => skill.sourceRevisionKey),
        ...input.activeEquipmentEffects.map((effect) => effect.sourceRevisionKey),
      ]),
    };
  }

  // 隊伍與 Encounter 的第一版聚合完全相同（teamAggregation === encounterAggregation ===
  // 'sumMembersThenFormation'）：先按單位加總，再套同一條 Formation Resolver。
  function aggregateFormation(
    members: readonly CombatPowerFormationMember[],
    rule: Readonly<CombatPowerRuleDefinition>,
  ): Readonly<{
    memberPowers: readonly CombatPowerUnitSnapshot[];
    formationModifier: number;
    totalPower: number;
  }> {
    requireDisjointPlacement(members);
    const memberPowers = members.map((member) => calculateUnit(member.unit, rule));
    const summedMemberPower = memberPowers.reduce((sum, snapshot) => sum + snapshot.totalPower, 0);
    const placements = memberPowers.map((snapshot, index) => {
      const member = members[index];
      if (member === undefined) {
        reject(CombatPowerRejectionCode.InvalidFormation, { reason: 'missingPlacement', index });
      }
      return {
        power: snapshot.totalPower,
        anchorCell: member.anchorCell,
        occupiedCells: member.occupiedCells,
      };
    });
    const formationModifier = requireFinite(
      deps.resolvers.resolveFormationModifier(rule.teamFormationResolverId, {
        placements,
        summedMemberPower,
      }),
      'teamFormationResolver.result',
    );
    return {
      memberPowers,
      formationModifier,
      totalPower: finalizePower(summedMemberPower * formationModifier, rule),
    };
  }

  function requireRuleMatch(ruleId: DefinitionId, rule: Readonly<CombatPowerRuleDefinition>): void {
    if (String(ruleId) !== String(rule.id)) {
      reject(CombatPowerRejectionCode.RuleMismatch, {
        inputRuleId: String(ruleId),
        ruleId: String(rule.id),
      });
    }
  }

  return {
    calculateUnit,

    calculateTeam(
      input: Readonly<TeamCombatPowerCalculationInput>,
      rule: Readonly<CombatPowerRuleDefinition>,
    ): TeamCombatPowerSnapshot {
      requireRuleMatch(input.ruleId, rule);
      if (input.members.length === 0 || input.members.length > MAX_FORMAL_MEMBERS) {
        reject(CombatPowerRejectionCode.InvalidTeamSize, {
          memberCount: input.members.length,
          maximum: MAX_FORMAL_MEMBERS,
        });
      }
      const participantCharacterIds = requireCharacterMembers(input.members);
      const aggregate = aggregateFormation(input.members, rule);
      return {
        teamId: input.teamId,
        participantCharacterIds: [...participantCharacterIds],
        combatPowerRuleId: rule.id,
        memberPowers: [...aggregate.memberPowers],
        formationModifier: aggregate.formationModifier,
        totalPower: aggregate.totalPower,
        sourceRevisionKey: joinRevisionParts([
          input.sourceRevisionKey,
          String(input.formationRevision),
          definitionRevisionPart(rule),
          ...aggregate.memberPowers.map((snapshot) => snapshot.sourceRevisionKey),
        ]),
      };
    },

    calculateEncounter(
      input: Readonly<EncounterCombatPowerCalculationInput>,
      rule: Readonly<CombatPowerRuleDefinition>,
    ): EncounterCombatPowerSnapshot {
      requireRuleMatch(input.ruleId, rule);
      if (input.members.length === 0) {
        reject(CombatPowerRejectionCode.InvalidTeamSize, { memberCount: 0, maximum: MAX_FORMAL_MEMBERS });
      }
      requireMonsterMembers(input.members);
      const aggregate = aggregateFormation(input.members, rule);
      return {
        encounterGroupId: input.encounterGroupId,
        combatPowerRuleId: rule.id,
        memberPowers: [...aggregate.memberPowers],
        formationModifier: aggregate.formationModifier,
        totalPower: aggregate.totalPower,
        sourceRevisionKey: joinRevisionParts([
          input.encounterDefinitionRevisionKey,
          definitionRevisionPart(rule),
          ...aggregate.memberPowers.map((snapshot) => snapshot.sourceRevisionKey),
        ]),
      };
    },
  };
}

// ══════════════════════════════════════════════════════════════════════════
// Query Facade 需要的 Port（世界事實；實作不在本服務）
// ══════════════════════════════════════════════════════════════════════════
//
// doc §4 說 CombatPowerQuery 住在 app/composition，用窄化 Query 取得 Snapshot 並組 Calculator Input。
// 這裡把它寫成「吃注入 Port 的工廠」：組裝邏輯（誰該被拒絕、Input 怎麼拼、Revision Key 怎麼串）
// 屬於本服務且必須可測；Port 的實作屬 composition。整合者把工廠掛上去即可，不需重寫組裝規則。

/** statistics 純服務算好的快照。本服務不自算任何副屬性。 */
export interface CombatPowerStatisticsPort {
  getCharacterStatistics(
    input: Readonly<{ characterId: CharacterId; statisticsRuleId: StatisticsRuleId }>,
  ): CombatUnitStatisticsSnapshot | undefined;
  /** 候選裝備下的重算結果（NPC 換裝與 UI 預覽用）。 */
  getStatisticsForCandidateLoadout(
    input: Readonly<{
      characterId: CharacterId;
      statisticsRuleId: StatisticsRuleId;
      equipmentLoadout: CharacterEquipmentLoadoutView;
      selectedWeaponSetId: WeaponSetId;
    }>,
  ): CombatUnitStatisticsSnapshot | undefined;
}

/**
 * inventory + character 的合成事實：某角色在某武器組下的合法配置。
 * `undefined` 代表武器組不存在／未持有／裝備位置不合法（doc §4 的拒絕清單第 2 條）。
 */
export type CombatPowerWeaponSetConfigurationView = Readonly<{
  characterId: CharacterId;
  selectedWeaponSetId: WeaponSetId;
  /** 該武器組下**合法**的已配置技能（已通過已學會、武器需求與配置上限檢查）。 */
  configuredSkillIds: readonly SkillDefinitionId[];
  /** 該武器組滿足哪些武器需求。 */
  satisfiedWeaponRequirementIds: readonly WeaponRequirementId[];
  /** 已裝備且位置合法、因此可能生效的裝備效果（Tag 條件仍由本服務判定）。 */
  activeEquipmentEffectIds: readonly EquipmentEffectDefinitionId[];
  /** 角色當下是否可參戰（存活、正式成員、非護衛／救援等任務性臨時角色）。 */
  battleReady: boolean;
  /** 角色／Mastery／Condition／Item Instance／Affix／武器組與技能配置的 Revision 片段。 */
  sourceRevisionKey: string;
}>;

export interface CombatPowerLoadoutPort {
  getWeaponSetConfiguration(
    input: Readonly<{ characterId: CharacterId; selectedWeaponSetId: WeaponSetId }>,
  ): CombatPowerWeaponSetConfigurationView | undefined;
  getCandidateWeaponSetConfiguration(
    input: Readonly<{
      characterId: CharacterId;
      equipmentLoadout: CharacterEquipmentLoadoutView;
      selectedWeaponSetId: WeaponSetId;
      configuredSkillIds: readonly SkillDefinitionId[];
    }>,
  ): CombatPowerWeaponSetConfigurationView | undefined;
}

export type CombatPowerTeamMemberView = Readonly<{
  characterId: CharacterId;
  anchorCell: GridCell;
  occupiedCells: readonly GridCell[];
  /** 該成員目前選用的武器組（任務評估用當下配置；預覽類查詢由呼叫端指定）。 */
  selectedWeaponSetId: WeaponSetId;
}>;

/**
 * Team Query 的正式成員與持久配置。**恰好**該隊當下全部 1～9 名正式成員各一次；
 * 候補、留城與護衛／救援等任務性臨時角色不在其中（doc §3.2）。
 */
export type CombatPowerTeamCompositionView = Readonly<{
  teamId: TeamId;
  formationRevision: Revision;
  formalMembers: readonly CombatPowerTeamMemberView[];
  sourceRevisionKey: string;
}>;

export interface CombatPowerTeamPort {
  getComposition(teamId: TeamId): CombatPowerTeamCompositionView | undefined;
}

export type CombatPowerEncounterMemberView = Readonly<{
  monsterDefinitionId: MonsterDefinitionId;
  memberIndex: number;
  /** Monster 由 Combat Definition Compiler 產生與角色**相同形狀**的快照（doc §3.1）。 */
  statistics: CombatUnitStatisticsSnapshot;
  configuredSkillIds: readonly SkillDefinitionId[];
  satisfiedWeaponRequirementIds: readonly WeaponRequirementId[];
  activeEquipmentEffectIds: readonly EquipmentEffectDefinitionId[];
  anchorCell: GridCell;
  occupiedCells: readonly GridCell[];
  sourceRevisionKey: string;
}>;

export type CombatPowerEncounterCompositionView = Readonly<{
  encounterGroupId: EncounterGroupDefinitionId;
  members: readonly CombatPowerEncounterMemberView[];
  /** Encounter、Monster 與 Placement 的 Revision 片段（doc §5）。 */
  encounterDefinitionRevisionKey: string;
}>;

export interface CombatPowerEncounterPort {
  getComposition(
    encounterGroupId: EncounterGroupDefinitionId,
  ): CombatPowerEncounterCompositionView | undefined;
}

/**
 * 任務目標 → 對抗編組。`undefined` 代表這個目標沒有戰力對抗面（採購、運送…），
 * 本服務因此無從評估 → NpcQuestFeasibility.reason = 'unsupportedObjective'。
 * 空陣列不是合法回答（有對抗面卻沒有編組是壞內容）。
 */
export interface CombatPowerQuestOppositionPort {
  listOpposingEncounterGroupIds(
    objective: QuestObjectiveView,
  ): readonly EncounterGroupDefinitionId[] | undefined;
}

export type CombatPowerQueryDeps = Readonly<{
  definitions: CombatPowerDefinitionReader;
  calculator: CombatPowerCalculator;
  resolvers: CombatPowerResolverPort;
  statistics: CombatPowerStatisticsPort;
  loadout: CombatPowerLoadoutPort;
  team: CombatPowerTeamPort;
  encounter: CombatPowerEncounterPort;
  questOpposition: CombatPowerQuestOppositionPort;
}>;

// ══════════════════════════════════════════════════════════════════════════
// Query Facade
// ══════════════════════════════════════════════════════════════════════════

export function createCombatPowerQuery(deps: CombatPowerQueryDeps): CombatPowerQuery {
  function unitFromConfiguration(
    configuration: CombatPowerWeaponSetConfigurationView,
    statistics: CombatUnitStatisticsSnapshot,
    requestedSkillIds: readonly SkillDefinitionId[],
  ): CombatPowerUnitInput {
    if (!configuration.battleReady) {
      reject(CombatPowerRejectionCode.CharacterNotBattleReady, {
        characterId: String(configuration.characterId),
      });
    }
    // doc §4 的拒絕清單第 3 條：未學會、武器需求不符或超過配置上限的技能。
    // Port 回報的是該武器組下**合法**的配置；要求評估的技能不在其中即拒絕，不默默跳過。
    const legal = new Set(configuration.configuredSkillIds.map(String));
    for (const skillId of requestedSkillIds) {
      if (legal.has(String(skillId))) continue;
      reject(CombatPowerRejectionCode.SkillNotConfigured, {
        characterId: String(configuration.characterId),
        weaponSetId: String(configuration.selectedWeaponSetId),
        skillId: String(skillId),
      });
    }
    return {
      unitRef: { kind: 'character', characterId: configuration.characterId },
      statistics,
      selectedWeaponSetId: configuration.selectedWeaponSetId,
      satisfiedWeaponRequirementIds: [...configuration.satisfiedWeaponRequirementIds],
      configuredSkills: requestedSkillIds.map((skillId) => deps.definitions.getSkillView(skillId)),
      activeEquipmentEffects: configuration.activeEquipmentEffectIds.map((effectId) =>
        deps.definitions.getEquipmentEffectView(effectId),
      ),
      sourceRevisionKey: configuration.sourceRevisionKey,
    };
  }

  function characterUnit(
    rule: Readonly<CombatPowerRuleDefinition>,
    characterId: CharacterId,
    selectedWeaponSetId: WeaponSetId,
    requestedSkillIds: readonly SkillDefinitionId[],
  ): CombatPowerUnitInput {
    const configuration = deps.loadout.getWeaponSetConfiguration({ characterId, selectedWeaponSetId });
    if (configuration === undefined) {
      reject(CombatPowerRejectionCode.WeaponSetUnavailable, {
        characterId: String(characterId),
        weaponSetId: String(selectedWeaponSetId),
      });
    }
    const statistics = deps.statistics.getCharacterStatistics({
      characterId,
      statisticsRuleId: rule.statisticsRuleId,
    });
    if (statistics === undefined) {
      reject(CombatPowerRejectionCode.StatisticsUnavailable, {
        characterId: String(characterId),
        statisticsRuleId: String(rule.statisticsRuleId),
      });
    }
    return unitFromConfiguration(configuration, statistics, requestedSkillIds);
  }

  // 隊伍 Input 的組裝。ok:false 代表「這支隊伍當下沒有可用的正式成員」——那是世界狀態，
  // 不是壞內容：getTeamPower 轉成拒絕，任務評估轉成 reason='noUsableMembers'。
  type TeamAssembly =
    | Readonly<{ ok: true; input: TeamCombatPowerCalculationInput }>
    | Readonly<{ ok: false; unusableCharacterIds: readonly CharacterId[] }>;

  function assembleTeam(
    rule: Readonly<CombatPowerRuleDefinition>,
    composition: CombatPowerTeamCompositionView,
    weaponSetByCharacterId: Readonly<Record<string, WeaponSetId>>,
  ): TeamAssembly {
    const members: CombatPowerFormationMember[] = [];
    const unusableCharacterIds: CharacterId[] = [];

    if (composition.formalMembers.length === 0) {
      return { ok: false, unusableCharacterIds: [] };
    }

    for (const member of composition.formalMembers) {
      const selectedWeaponSetId = weaponSetByCharacterId[String(member.characterId)];
      if (selectedWeaponSetId === undefined) {
        reject(CombatPowerRejectionCode.TeamMemberSetMismatch, {
          teamId: String(composition.teamId),
          missingWeaponSetForCharacterId: String(member.characterId),
        });
      }
      const configuration = deps.loadout.getWeaponSetConfiguration({
        characterId: member.characterId,
        selectedWeaponSetId,
      });
      if (configuration === undefined) {
        reject(CombatPowerRejectionCode.WeaponSetUnavailable, {
          characterId: String(member.characterId),
          weaponSetId: String(selectedWeaponSetId),
        });
      }
      if (!configuration.battleReady) {
        unusableCharacterIds.push(member.characterId);
        continue;
      }
      const statistics = deps.statistics.getCharacterStatistics({
        characterId: member.characterId,
        statisticsRuleId: rule.statisticsRuleId,
      });
      if (statistics === undefined) {
        reject(CombatPowerRejectionCode.StatisticsUnavailable, {
          characterId: String(member.characterId),
          statisticsRuleId: String(rule.statisticsRuleId),
        });
      }
      members.push({
        unit: unitFromConfiguration(configuration, statistics, configuration.configuredSkillIds),
        anchorCell: member.anchorCell,
        occupiedCells: [...member.occupiedCells],
      });
    }

    if (unusableCharacterIds.length > 0) {
      // 不存在「只取部分隊員計算戰力」的路徑（doc §3.2）：少一個能打的就是這支隊伍不能打。
      return { ok: false, unusableCharacterIds };
    }

    return {
      ok: true,
      input: {
        teamId: composition.teamId,
        ruleId: rule.id,
        members,
        formationRevision: composition.formationRevision,
        sourceRevisionKey: composition.sourceRevisionKey,
      },
    };
  }

  function requireComposition(teamId: TeamId): CombatPowerTeamCompositionView {
    const composition = deps.team.getComposition(teamId);
    if (composition === undefined) {
      reject(CombatPowerRejectionCode.TeamCompositionUnavailable, { teamId: String(teamId) });
    }
    return composition;
  }

  function teamSnapshot(
    rule: Readonly<CombatPowerRuleDefinition>,
    composition: CombatPowerTeamCompositionView,
    weaponSetByCharacterId: Readonly<Record<string, WeaponSetId>>,
  ): TeamCombatPowerSnapshot {
    const assembly = assembleTeam(rule, composition, weaponSetByCharacterId);
    if (!assembly.ok) {
      reject(CombatPowerRejectionCode.CharacterNotBattleReady, {
        teamId: String(composition.teamId),
        unusableMemberCount: assembly.unusableCharacterIds.length,
      });
    }
    return deps.calculator.calculateTeam(assembly.input, rule);
  }

  function encounterSnapshot(
    rule: Readonly<CombatPowerRuleDefinition>,
    encounterGroupId: EncounterGroupDefinitionId,
  ): EncounterCombatPowerSnapshot {
    const composition = deps.encounter.getComposition(encounterGroupId);
    if (composition === undefined) {
      reject(CombatPowerRejectionCode.EncounterCompositionUnavailable, {
        encounterGroupId: String(encounterGroupId),
      });
    }
    const members: CombatPowerFormationMember[] = composition.members.map((member) => ({
      unit: {
        unitRef: {
          kind: 'monster',
          monsterDefinitionId: member.monsterDefinitionId,
          memberIndex: member.memberIndex,
        },
        statistics: member.statistics,
        satisfiedWeaponRequirementIds: [...member.satisfiedWeaponRequirementIds],
        configuredSkills: member.configuredSkillIds.map((skillId) =>
          deps.definitions.getSkillView(skillId),
        ),
        activeEquipmentEffects: member.activeEquipmentEffectIds.map((effectId) =>
          deps.definitions.getEquipmentEffectView(effectId),
        ),
        sourceRevisionKey: member.sourceRevisionKey,
      },
      anchorCell: member.anchorCell,
      occupiedCells: [...member.occupiedCells],
    }));
    const input: EncounterCombatPowerCalculationInput = {
      encounterGroupId: composition.encounterGroupId,
      ruleId: rule.id,
      members,
      encounterDefinitionRevisionKey: composition.encounterDefinitionRevisionKey,
    };
    return deps.calculator.calculateEncounter(input, rule);
  }

  function riskBandOf(
    expectedSuccess: number,
    feasibilityRule: Readonly<CombatPowerFeasibilityRuleDefinition>,
  ): CombatPowerRiskBand {
    let previousBound = Number.NEGATIVE_INFINITY;
    for (const threshold of feasibilityRule.riskBandThresholds) {
      const bound = requireFinite(threshold.maxExpectedSuccess, 'riskBandThresholds.maxExpectedSuccess');
      if (bound < previousBound) {
        reject(CombatPowerRejectionCode.InvalidContent, {
          field: 'riskBandThresholds',
          reason: 'notAscending',
          bound,
        });
      }
      previousBound = bound;
      if (expectedSuccess <= bound) return threshold.riskBand;
    }
    // 門檻表沒有涵蓋這個成功率——壞內容。不補一個「最接近」的風險帶。
    return reject(CombatPowerRejectionCode.InvalidContent, {
      field: 'riskBandThresholds',
      reason: 'uncoveredExpectedSuccess',
      expectedSuccess,
    });
  }

  function opposingPower(
    rule: Readonly<CombatPowerRuleDefinition>,
    feasibilityRule: Readonly<CombatPowerFeasibilityRuleDefinition>,
    encounterGroupIds: readonly EncounterGroupDefinitionId[],
  ): number {
    const powers = encounterGroupIds.map((groupId) => encounterSnapshot(rule, groupId).totalPower);
    switch (feasibilityRule.opposingAggregation) {
      case 'sumEncounterGroups':
        return powers.reduce((sum, power) => sum + power, 0);
      case 'strongestEncounterGroup': {
        // 沒有起始值可用：對抗編組為空時不編一個 0 出來，而是回報壞內容（上游已擋過一次）。
        let strongest: number | undefined;
        for (const power of powers) {
          strongest = strongest === undefined ? power : Math.max(strongest, power);
        }
        if (strongest === undefined) {
          reject(CombatPowerRejectionCode.InvalidContent, {
            field: 'opposingEncounterGroupIds',
            reason: 'emptyOpposition',
          });
        }
        return strongest;
      }
    }
  }

  return {
    getCharacterPower(input: CharacterCombatPowerQueryInput): CombatPowerUnitSnapshot {
      const rule = deps.definitions.getRule(input.combatPowerRuleId);
      const unit = characterUnit(
        rule,
        input.characterId,
        input.selectedWeaponSetId,
        input.configuredSkillIds,
      );
      return deps.calculator.calculateUnit(unit, rule);
    },

    getTeamPower(input: TeamCombatPowerInput): TeamCombatPowerSnapshot {
      const rule = deps.definitions.getRule(input.combatPowerRuleId);
      const composition = requireComposition(input.teamId);
      if (composition.formationRevision !== input.formationRevision) {
        reject(CombatPowerRejectionCode.FormationRevisionMismatch, {
          teamId: String(input.teamId),
          requested: input.formationRevision,
          current: composition.formationRevision,
        });
      }
      // §7.8：正式成員與所選武器組的 Character ID 集合必須**完全相等**。
      // 少一名、多一名護衛角色、或武器組清單不完整都在這裡被擋下。
      const memberIds = new Set(composition.formalMembers.map((member) => String(member.characterId)));
      const requestedIds = Object.keys(input.selectedWeaponSetIds);
      if (requestedIds.length !== memberIds.size) {
        reject(CombatPowerRejectionCode.TeamMemberSetMismatch, {
          teamId: String(input.teamId),
          formalMemberCount: memberIds.size,
          requestedCount: requestedIds.length,
        });
      }
      for (const requestedId of requestedIds) {
        if (memberIds.has(requestedId)) continue;
        reject(CombatPowerRejectionCode.TeamMemberSetMismatch, {
          teamId: String(input.teamId),
          nonMemberCharacterId: requestedId,
        });
      }
      return teamSnapshot(rule, composition, input.selectedWeaponSetIds);
    },

    getEncounterPower(input: EncounterCombatPowerQueryInput): EncounterCombatPowerSnapshot {
      const rule = deps.definitions.getRule(input.combatPowerRuleId);
      return encounterSnapshot(rule, input.encounterGroupId);
    },

    assessQuestFeasibility(input: NpcQuestFeasibilityInput): NpcQuestFeasibility {
      const rule = deps.definitions.getRule(input.combatPowerRuleId);
      const feasibilityRule = deps.definitions.getFeasibilityRule(rule.feasibilityRuleId);
      if (String(feasibilityRule.combatPowerRuleId) !== String(rule.id)) {
        reject(CombatPowerRejectionCode.RuleMismatch, {
          feasibilityRuleId: String(feasibilityRule.id),
          boundRuleId: String(feasibilityRule.combatPowerRuleId),
          assessedRuleId: String(rule.id),
        });
      }

      const composition = requireComposition(input.teamId);
      const assembly = assembleTeam(
        rule,
        composition,
        Object.fromEntries(
          composition.formalMembers.map((member) => [
            String(member.characterId),
            member.selectedWeaponSetId,
          ]),
        ),
      );
      // 可用成員集合為空 → 加總的單位元 0。這不是替代缺資料的假值：沒有任何成員能出戰，
      // 貢獻的總和就是 0，而後續的期望成功率仍完全由 Resolver 與門檻資料算出。
      const powerScore = assembly.ok
        ? deps.calculator.calculateTeam(assembly.input, rule).totalPower
        : 0;

      const opposingGroupIds = deps.questOpposition.listOpposingEncounterGroupIds(input.objective);
      if (opposingGroupIds === undefined) {
        // 沒有戰力對抗面的目標（採購、運送…）：本服務不評估，也不憑空給機率或風險帶。
        return { canAttempt: false, powerScore, reason: 'unsupportedObjective' };
      }
      if (opposingGroupIds.length === 0) {
        reject(CombatPowerRejectionCode.InvalidContent, {
          field: 'opposingEncounterGroupIds',
          reason: 'emptyOpposition',
          questId: String(input.questId),
        });
      }

      const expectedSuccess = requireFinite(
        deps.resolvers.resolveExpectedSuccess(feasibilityRule.expectedSuccessResolverId, {
          teamPower: powerScore,
          opposingPower: opposingPower(rule, feasibilityRule, opposingGroupIds),
        }),
        'expectedSuccessResolver.result',
      );
      if (expectedSuccess < 0 || expectedSuccess > 1) {
        reject(CombatPowerRejectionCode.InvalidContent, {
          field: 'expectedSuccessResolver.result',
          reason: 'outOfUnitRange',
          expectedSuccess,
        });
      }
      const riskBand = riskBandOf(expectedSuccess, feasibilityRule);

      if (!assembly.ok) {
        return { canAttempt: false, powerScore, expectedSuccess, riskBand, reason: 'noUsableMembers' };
      }
      // 安全邊際是資料：低於 minimumAttemptExpectedSuccess 就不嘗試。
      if (
        expectedSuccess <
        requireFinite(
          feasibilityRule.minimumAttemptExpectedSuccess,
          'feasibilityRule.minimumAttemptExpectedSuccess',
        )
      ) {
        return {
          canAttempt: false,
          powerScore,
          expectedSuccess,
          riskBand,
          reason: 'insufficientPower',
        };
      }
      return { canAttempt: true, powerScore, expectedSuccess, riskBand };
    },

    compareLoadouts(
      input: EquipmentLoadoutPowerComparisonInput,
    ): EquipmentLoadoutPowerComparisonResult {
      const rule = deps.definitions.getRule(input.combatPowerRuleId);
      const seenCandidateIds = new Set<string>();
      const candidates = input.candidates.map((candidate) => {
        const candidateKey = String(candidate.candidateId);
        if (seenCandidateIds.has(candidateKey)) {
          reject(CombatPowerRejectionCode.DuplicateLoadoutCandidate, { candidateId: candidateKey });
        }
        seenCandidateIds.add(candidateKey);

        const configuration = deps.loadout.getCandidateWeaponSetConfiguration({
          characterId: input.characterId,
          equipmentLoadout: candidate.equipmentLoadout,
          selectedWeaponSetId: candidate.selectedWeaponSetId,
          configuredSkillIds: candidate.configuredSkillIds,
        });
        if (configuration === undefined) {
          reject(CombatPowerRejectionCode.WeaponSetUnavailable, {
            characterId: String(input.characterId),
            weaponSetId: String(candidate.selectedWeaponSetId),
            candidateId: candidateKey,
          });
        }
        const statistics = deps.statistics.getStatisticsForCandidateLoadout({
          characterId: input.characterId,
          statisticsRuleId: rule.statisticsRuleId,
          equipmentLoadout: candidate.equipmentLoadout,
          selectedWeaponSetId: candidate.selectedWeaponSetId,
        });
        if (statistics === undefined) {
          reject(CombatPowerRejectionCode.StatisticsUnavailable, {
            characterId: String(input.characterId),
            statisticsRuleId: String(rule.statisticsRuleId),
            candidateId: candidateKey,
          });
        }
        const snapshot = deps.calculator.calculateUnit(
          unitFromConfiguration(configuration, statistics, candidate.configuredSkillIds),
          rule,
        );
        return {
          candidateId: candidate.candidateId,
          power: snapshot.totalPower,
          sourceRevisionKey: snapshot.sourceRevisionKey,
        };
      });

      // doc §4／§8.5：戰力高者勝，同分以 Candidate ID 穩定排序（升冪取第一個）。
      let best: Readonly<{ candidateId: EquipmentLoadoutCandidateId; power: number }> | undefined;
      for (const candidate of candidates) {
        if (best === undefined) {
          best = candidate;
          continue;
        }
        if (candidate.power > best.power) {
          best = candidate;
          continue;
        }
        if (candidate.power === best.power && String(candidate.candidateId) < String(best.candidateId)) {
          best = candidate;
        }
      }
      return best === undefined
        ? { candidates }
        : { candidates, highestPowerCandidateId: best.candidateId };
    },
  };
}
