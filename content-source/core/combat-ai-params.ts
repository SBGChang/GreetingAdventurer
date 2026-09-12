// content-source/core/combat-ai-params.ts
// 敵方 AI 與反擊條件的參數（docs/00_core/technical_architecture.md 的內容側）。
//
// ── 為什麼這些是內容而不是程式 ────────────────────────────────────────────
//
// `src/app/content/combat-ai-resolvers.ts` 只實作**有限幾種策略**（選招三種、選目標三種、
// 反擊述詞一種）。「雜兵用哪一種、菁英用哪一種」是可調的玩法決定——換一份 Pack 就該能換掉，
// 所以它住在這裡。程式那側完全沒有「if 是雜兵就…」這種分支。
//
// ── resolverId 不得自己發明 ──────────────────────────────────────────────
//
// 下面五個 ID **必須恰好是內容既有的那五個**（`combat-ai-policy.behaviorResolverId` 三筆、
// 技能 `counterStance.conditionResolverId` 兩筆）。工作單明講「已從 content/ 抓出，不要自己發明」，
// 而且 Content Compiler 的跨引用檢查會擋下指不到的 ID。

import type { ResolverBinding, ResolverId } from '../../src/contracts/core';
import type {
  CombatAiParamsDefinition,
  CombatCounterConditionParamsDefinition,
} from '../../src/contracts/combat';
import type { ModuleId } from '../../src/contracts/core';
import { cultureIds, type Authored, type AuthoredDomain } from '../authoring';

const core = cultureIds('core');
const COMBAT_MODULE = 'combat' as ModuleId;

const KIND_AI = 'combat-ai-params';
const KIND_COUNTER = 'combat-counter-condition-params';

// ── AI 行為參數 ─────────────────────────────────────────────────────────────
//
// 【第一版方案（待討論）】三筆的策略對應是本輪判讀，不是設計來源的明文：
//   * `single-skill-aggressor`：§7.5「一般敵人剛好一招」→ `onlySkill` 是被資料釘住的，不是選擇。
//     目標偏好取 `randomInReach`——雜兵沒有理由挑人，隨機是最不加碼的讀法。
//   * `elite-threat-focus`：名稱裡的「threat focus」沒有對應的威脅欄位（契約沒有 threat 這個量）。
//     取 `lowestHealthInReach`：在現有事實裡，「集中火力收掉快死的」是最接近「聚焦」語意且
//     完全由 encounter 算得出來的偏好。若設計後來定義了威脅值，改這一欄即可，程式不動。
//   * `boss-rotation`：名稱明講輪替 → `rotateByEncounterRevision`。首領招式多，目標取
//     `highestHealthInReach`（先啃硬的），與菁英的收尾偏好形成對比。
//
// 這三行是**可調的玩法決定**，不是公式：改它們不需要動任何程式。
type AiRow = Readonly<{
  local: string;
  skillSelection: CombatAiParamsDefinition['skillSelection'];
  targetPreference: CombatAiParamsDefinition['targetPreference'];
}>;

const AI_ROWS: readonly AiRow[] = [
  { local: 'single-skill-aggressor', skillSelection: 'onlySkill', targetPreference: 'randomInReach' },
  { local: 'elite-threat-focus', skillSelection: 'randomAffordable', targetPreference: 'lowestHealthInReach' },
  {
    local: 'boss-rotation',
    skillSelection: 'rotateByEncounterRevision',
    targetPreference: 'highestHealthInReach',
  },
];

function aiParams(row: AiRow): Authored<CombatAiParamsDefinition> {
  return {
    kind: KIND_AI,
    id: core.id(KIND_AI, row.local),
    skillSelection: row.skillSelection,
    targetPreference: row.targetPreference,
  };
}

// ── 反擊條件參數 ────────────────────────────────────────────────────────────
//
// 兩筆對應內容既有的兩個 conditionResolverId：
//   * `counter-condition-block`：不限距離的格擋反擊——任何造成傷害的來襲動作都觸發。
//   * `counter-condition-melee-block`：只有近戰（攻方排距 ≤ 1）才觸發。
//
// 【第一版方案（待討論）】「哪些 actionKind 算造成傷害」取 attack／cast／perform 三種：
// `CombatActionKind` 的另外兩種是 guard（架勢本身）與 support（支援），兩者不是來襲攻擊。
type CounterRow = Readonly<{
  local: string;
  triggeringActionKinds: CombatCounterConditionParamsDefinition['triggeringActionKinds'];
  maxAttackerDistanceCells?: number;
}>;

const COUNTER_ROWS: readonly CounterRow[] = [
  { local: 'counter-condition-block', triggeringActionKinds: ['attack', 'cast', 'perform'] },
  {
    local: 'counter-condition-melee-block',
    triggeringActionKinds: ['attack'],
    // 近戰＝攻守同排或相鄰一排。
    maxAttackerDistanceCells: 1,
  },
];

function counterParams(row: CounterRow): Authored<CombatCounterConditionParamsDefinition> {
  const base = {
    kind: KIND_COUNTER,
    id: core.id(KIND_COUNTER, row.local),
    triggeringActionKinds: [...row.triggeringActionKinds],
  };
  // 缺席＝不限距離，所以不寫成 `maxAttackerDistanceCells: undefined`。
  return row.maxAttackerDistanceCells === undefined
    ? base
    : { ...base, maxAttackerDistanceCells: row.maxAttackerDistanceCells };
}

// ── 綁定 ────────────────────────────────────────────────────────────────────
//
// resolverId 是**內容既有**的五個（見檔頭）；shape 是 src/ 實作的兩個；paramsDefId 指向上面的定義。
export function combatAiBindings(): readonly ResolverBinding[] {
  return [
    ...AI_ROWS.map((row) => ({
      resolverId: `resolver:combat.ai-behavior.${row.local}` as ResolverId,
      ownerModule: COMBAT_MODULE,
      shape: 'combat-ai:policy-driven',
      paramsDefId: core.id(KIND_AI, row.local),
    })),
    ...COUNTER_ROWS.map((row) => ({
      resolverId: `resolver:combat.${row.local}` as ResolverId,
      ownerModule: COMBAT_MODULE,
      shape: 'combat-counter:incoming-action',
      paramsDefId: core.id(KIND_COUNTER, row.local),
    })),
  ];
}

export const combatAiParamsDomain: AuthoredDomain = {
  domain: 'combat-ai-params',
  definitions: [...AI_ROWS.map(aiParams), ...COUNTER_ROWS.map(counterParams)],
};

export const COMBAT_AI_DECLARED_KINDS: readonly string[] = [KIND_AI, KIND_COUNTER];
