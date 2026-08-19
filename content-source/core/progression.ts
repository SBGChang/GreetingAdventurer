// content-source/core/progression.ts
// 熟練度、升級曲線與交流熟練度效益。**文化無關**——這是遊戲結構的一部分，四國共用同一份。
//
// 來源（逐筆對照，見 content-source/PROVENANCE.md 的 progression 段）：
//   * 熟練度清單：`docs/00_core/game_design_document.md`「熟練度清單」（33 項，六大類）
//   * 主屬成長配比：同文件「熟練度→主屬性成長配比（草稿）」的四張表
//   * 累積 MXP 門檻：`docs/02_systems/mastery_experience_economy_v1.md`「二、共用升級門檻」
//   * 交流熟練度效益：`MasteryDefinition` 姊妹型別 `SocialMasteryBenefitDefinition` 的欄位型別
//     已把三條每級加成寫成固定 tuple（契約層的結構不變量），此處只需指定 masteryId。

import type {
  MasteryCurveDefinition,
  MasteryDefinition,
  PrimaryAttributeGains,
  SocialMasteryBenefitDefinition,
} from '../../src/contracts/progression';
import type { MasteryCurveId, MasteryId } from '../../src/contracts/core';
import { cultureIds, type Authored, type AuthoredDomain } from '../authoring';

const core = cultureIds('core');

const CURVE_ID = core.id<MasteryCurveId>('mastery-curve', 'shared');

// ── 升級曲線 ────────────────────────────────────────────────────────────────
//
// `cumulativeExperienceThresholds` 是 Lv.0…Lv.10 共 11 筆的**累積**值（Lv.0 為 0）。
// 數字取自 mastery_experience_economy_v1.md 的「累積 MXP」欄，逐列照抄。
const masteryCurve: Authored<MasteryCurveDefinition> = {
  kind: 'mastery-curve',
  id: CURVE_ID,
  maxLevel: 10,
  cumulativeExperienceThresholds: [
    0, 200_000, 500_000, 1_000_000, 1_700_000, 2_700_000, 4_200_000, 6_400_000, 10_000_000,
    15_600_000, 24_000_000,
  ],
};

// ── 主屬成長配比 ────────────────────────────────────────────────────────────
//
// GDD 的表以「×N」表示，語意是**每升一級**該主屬 +N。`primaryAttributeGainsByLevel` 是「到達第 i 級
// 時新增多少」的陣列（index 0 = Lv.0，模組會由 0 累加到目前等級），所以 ×N 展開成 index 1…10 各 N。
// 這個展開是純資料重複的消除，不是規則：改成非線性成長只要改這裡的資料形狀。
type Gains = Readonly<{
  muscle?: number;
  intelligence?: number;
  reaction?: number;
  coordination?: number;
  charisma?: number;
}>;

const LEVEL_COUNT = 11; // Lv.0…Lv.10，與 curve 的門檻筆數相同。

function perLevel(gains: Gains): readonly PrimaryAttributeGains[] {
  // Lv.0 不給成長（角色一開始就有的等級不該憑空加屬性）；Lv.1…Lv.10 各給一份。
  return Array.from({ length: LEVEL_COUNT }, (_, level) => (level === 0 ? {} : gains));
}

type MasteryRow = Readonly<{ local: string; gains: Gains }>;

// 六大類的熟練度。local 名是 ID 的第三段（`mastery.core.<local>`）。
//
// **兩處 GDD 未發表配比**（見 PROVENANCE.md）：
//   1. 單手盾／雙手盾：清單有、四張配比表沒有它們的列。
//   2. 任務熟練度 7 項與行動熟練度 2 項：配比表只涵蓋武器／防具／生活／魔法四類。
// 兩者一律給**空 gains**（不加任何主屬），理由是配比表的四個分類恰好是「以身體或技藝反覆訓練」
// 的類別，而任務與行動熟練度在 mastery_experience_economy_v1.md 是以**買賣加成、邀請成功率、
// 離隊抗性**等效益表現，不走主屬管道。這是判讀，不是文件明文——要改只需改這張表的資料。
const WEAPON_MASTERIES: readonly MasteryRow[] = [
  { local: 'one-hand-weapon', gains: { muscle: 2, reaction: 1, coordination: 2 } },
  { local: 'two-hand-weapon', gains: { muscle: 4, reaction: 1, coordination: 1 } },
  { local: 'throwing-weapon', gains: { muscle: 1, reaction: 3, coordination: 2 } },
  { local: 'shooting-weapon', gains: { intelligence: 1, reaction: 2, coordination: 2 } },
  { local: 'one-hand-staff', gains: { intelligence: 3, reaction: 1, coordination: 1 } },
  { local: 'two-hand-staff', gains: { intelligence: 4, coordination: 1 } },
  { local: 'wind-instrument', gains: { intelligence: 2, charisma: 3 } },
  { local: 'string-instrument', gains: { intelligence: 1, coordination: 2, charisma: 3 } },
];

const ARMOR_MASTERIES: readonly MasteryRow[] = [
  { local: 'cloth-armor', gains: { reaction: 3, coordination: 1, charisma: 1 } },
  { local: 'light-armor', gains: { muscle: 1, reaction: 2, coordination: 2 } },
  { local: 'medium-armor', gains: { muscle: 2, reaction: 1, coordination: 2 } },
  { local: 'heavy-armor', gains: { muscle: 4, coordination: 1 } },
  { local: 'one-hand-shield', gains: {} },
  { local: 'two-hand-shield', gains: {} },
];

const LIFE_MASTERIES: readonly MasteryRow[] = [
  { local: 'smithing', gains: { muscle: 3, coordination: 2 } },
  { local: 'tailoring', gains: { intelligence: 2, coordination: 3 } },
  { local: 'handicraft', gains: { intelligence: 3, coordination: 2 } },
  { local: 'alchemy', gains: { intelligence: 4, coordination: 1 } },
  { local: 'cooking', gains: { intelligence: 2, coordination: 2, charisma: 1 } },
  { local: 'gathering', gains: { intelligence: 1, reaction: 2, coordination: 2 } },
  { local: 'social', gains: { intelligence: 1, charisma: 4 } },
];

const MAGIC_MASTERIES: readonly MasteryRow[] = [
  { local: 'attack-magic', gains: { intelligence: 4, reaction: 1 } },
  { local: 'defense-magic', gains: { intelligence: 3, coordination: 2 } },
  { local: 'blessing-magic', gains: { intelligence: 2, charisma: 3 } },
  { local: 'curse-magic', gains: { intelligence: 3, charisma: 2 } },
];

const QUEST_MASTERIES: readonly MasteryRow[] = [
  { local: 'quest-purchase', gains: {} },
  { local: 'quest-delivery', gains: {} },
  { local: 'quest-escort', gains: {} },
  { local: 'quest-rescue', gains: {} },
  { local: 'quest-exploration', gains: {} },
  { local: 'quest-suppression', gains: {} },
  { local: 'quest-subjugation', gains: {} },
];

const ACTION_MASTERIES: readonly MasteryRow[] = [
  { local: 'map-exploration', gains: {} },
  { local: 'travel', gains: {} },
];

const ALL_MASTERY_ROWS: readonly MasteryRow[] = [
  ...WEAPON_MASTERIES,
  ...ARMOR_MASTERIES,
  ...LIFE_MASTERIES,
  ...MAGIC_MASTERIES,
  ...QUEST_MASTERIES,
  ...ACTION_MASTERIES,
];

export const SOCIAL_MASTERY_ID = core.id<MasteryId>('mastery', 'social');

function mastery(row: MasteryRow): Authored<MasteryDefinition> {
  return {
    kind: 'mastery',
    id: core.id<MasteryId>('mastery', row.local),
    curveId: CURVE_ID,
    primaryAttributeGainsByLevel: perLevel(row.gains),
    // 技能的自動取得寫在**技能那一側**（`SkillDefinition.requiredMasteries` +
    // `acquisition: { kind: 'automatic' }`），而技能是文化內容。反向的
    // `MasteryDefinition.automaticKnowledgeUnlocks` 會把文化技能 ID 塞進文化無關的定義裡，
    // 所以這裡一律為空。（此欄位與 SkillDefinition 的重複，見 HANDOFF 的契約待收斂項。）
    automaticKnowledgeUnlocks: [],
  };
}

// 交流熟練度的三條每級加成在契約裡是固定 tuple（型別即不變量），這裡只指定它作用於哪個熟練度。
const socialMasteryBenefit: Authored<SocialMasteryBenefitDefinition> = {
  kind: 'social-mastery-benefit',
  id: core.id('social-mastery-benefit', 'social'),
  masteryId: SOCIAL_MASTERY_ID,
  personalTradeBonusGainsByLevel: [0.5, 0.5, 1, 1, 1.5, 1.5, 2, 3, 4, 5],
  inviteSuccessBonusGainsByLevel: [0.5, 0.5, 1, 1, 1.5, 1.5, 2, 2, 3, 3],
  memberDepartureResistanceGainsByLevel: [0.5, 0.5, 1, 1, 1.5, 1.5, 2, 2, 3, 3],
};

// 供其他 domain 引用熟練度 ID（例如裝備的 relatedMasteryIds、技能的 requiredMasteries）。
export const MASTERY_IDS: Readonly<Record<string, MasteryId>> = Object.fromEntries(
  ALL_MASTERY_ROWS.map((row) => [row.local, core.id<MasteryId>('mastery', row.local)]),
);

export const progressionDomain: AuthoredDomain = {
  domain: 'progression',
  definitions: [masteryCurve, ...ALL_MASTERY_ROWS.map(mastery), socialMasteryBenefit],
};
