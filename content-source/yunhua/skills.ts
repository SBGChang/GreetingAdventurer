// content-source/yunhua/skills.ts
// 雲華的 80 招戰鬥技能，兩側各一筆定義：
//
//   * `combat-skill`（combat 擁有）—— 戰鬥中怎麼作用：啟動手、武器需求、行為類型、技術分類、
//     目標、延遲 Rule、效果、反擊架勢。
//   * `skill`（progression 擁有）—— 怎麼取得：熟練度門檻 + 自動／書籍。
//
// 另外附帶兩族 MXP 分配規則（見下方「為什麼這個檔案裡有 progression 的 kind」）。
//
// ── 來源（逐筆對照）────────────────────────────────────────────────────────────
//   * `docs/03_content/yunhua/yunhua_content.data.mjs`（只讀）
//       - `skillCatalog`（經 `skillSeries` 展開，16 路線 × 5 階＝80 招）：名稱、kind、actionKind、
//         requirement、delay profile、resolution（威力與通道）、condition（目標）、effect、limit。
//       - `acquisitionStages` = ['L0 自動','L3 自動','基礎書 Lv.3','高級書 Lv.6','極品書 Lv.10']
//         → `SkillDefinition.acquisition` 與 `requiredMasteries[0].minLevel`。
//       - `supportMxpByStage` = [48, 48, 72, 120, 200] → `SupportMasteryAwardRuleDefinition
//         .fixedExperiencePerUse`（同一組數字也寫在 `balanceModel.experience` 最後一列）。
//       - `balanceModel.delayProfiles` 的 profile key → core 的 `action-delay-rule.core.<同名>`。
//   * `docs/03_content/yunhua/yunhua_content.md`
//       - §5「每個技能明列 actionKind、activationHand、武器需求、目標、延遲 Rule、效果與
//         Mastery Experience Routing」＝本檔要填的欄位清單。
//       - §6.1 狀態對照（瘴息／破綻／印痕／護印／定息）→ core 的五個 apply／三個 remove 效果。
//       - §6.2 技術分類的封閉清單 → `techniqueIds`。
//       - §8.1 知識取得梯度（自動 Lv.0／自動 Lv.3／基礎 Lv.3／高級 Lv.6／極品 Lv.10）。
//       - §8.2「Weapon Requirement／Mastery」表 → 武器需求 local ↔ 熟練度的對照。
//       - §8.3／§8.4 逐招意圖、支援技拆分、符術的法杖＋魔法 50／50。
//   * `docs/02_systems/combat_skill_effect_spec.md`：技能資料欄位表；反擊技「主動建立、條件結算」。
//
// ── 為什麼這個檔案裡有 progression 的 kind ──────────────────────────────────────
//
// `support-mastery-award-rule` 與 `attack-mastery-award-rule` 是 progression 的 kind，core 也已經
// 各發了一批。但 core 那批**表達不出雲華的設計**，兩處都對不上：
//
//   1. 固定支援 MXP：core 依**內容階級**發 20／50／120／300／720（其註解自稱第一版方案，取自
//      `mastery_experience_economy_v1.md` 的「遭遇防禦 MXP ÷4」）；雲華依**技能取得階層**發
//      48／48／72／120／200。兩個模型的鍵不同（階級 vs 階層），沒有任何欄位能把它們對起來。
//   2. 分割：core 的支援規則一律「單一熟練度 100%」；雲華 §8.4 明文「法杖與對應魔法各 50%」，
//      §8.3 明文「無傷害技能的 SupportMasteryAwardRule 必須依其實際 Routing 拆分」。
//   3. core 的攻擊規則沒有 `one-hand-shield` / `two-hand-shield` 兩筆，而雲華有兩招盾牌傷害技
//      （盾緣擊、鎮門擊），其 MXP 依設計來源的 `masteryExperience()` 走「傷害比例 → 單手盾／
//      雙手盾 Mastery」。
//
// 所以這 36 筆規則只能由雲華 pack 自己發。引用 core 那批會安靜地發錯 MXP（值錯、受益熟練度也錯），
// 那是規範點名的「拿看起來合理的值蓋住缺口」。整合者若判定它們該搬到別的 domain 檔，
// 搬走即可——本檔的技能只透過 ID 引用它們。**這一項務必在回報中先看。**

import type {
  CombatActionKind,
  CombatActivationHand,
  CombatSkillDefinitionView,
} from '../../src/contracts/combat';
import type {
  AttackMasteryAwardRuleId,
  CombatEffectDefinitionId,
  DefinitionHeader,
  MasteryId,
  ResolverId,
  SkillDefinitionId,
  SupportMasteryAwardRuleId,
  TechniqueId,
  WeaponRequirementId,
} from '../../src/contracts/core';
import { combatCounterConditionResolverId, combatTargetResolverId } from '../core/resolver-ids';
import type {
  AttackMasteryAwardRuleDefinition,
  MasterySplit,
  SkillDefinition,
  SupportMasteryAwardRuleDefinition,
} from '../../src/contracts/progression';
import { cultureIds, type Authored, type AuthoredDomain } from '../authoring';
import { MASTERY_IDS } from '../core/progression';
import { RESOLVER, ACTION_DELAY_RULE_IDS, COMBAT_EFFECT_IDS, COUNTER_DELAY_RULE_ID } from '../core/combat-rules';

const yunhua = cultureIds('yunhua');
const core = cultureIds('core');

// kind 字串的權威來源：`src/app/content/combat-reader.ts` 的 `COMBAT_DEFINITION_KINDS.skill`
// 與 `src/app/content/progression-reader.ts` 的 `PROGRESSION_DEFINITION_KINDS`。逐字對照抄寫
// （作者層只 import 型別，不 import src 的執行期值）；打錯字會在編譯期被 kind 登記檢查擋下。
const KIND = {
  combatSkill: 'combat-skill',
  skill: 'skill',
  attackAwardRule: 'attack-mastery-award-rule',
  supportAwardRule: 'support-mastery-award-rule',
};

// ── combat 側缺少 Definition 型別，作者層自行組出 ──────────────────────────────
//
// combat 契約只有 `CombatSkillDefinitionView`（以 `skillId` 為鍵、不帶 DefinitionHeader），
// **沒有** `CombatSkillDefinition`。而 `combat-reader.ts` 的投影是
// `{ ...def.data, skillId: def.id }`——也就是「作者資料原樣攤開，再把 id 換名成 skillId」。
// 因此作者側該寫的形狀就是：DefinitionHeader + View 去掉 skillId。
//
// 這一行是從真實契約型別推導出來的（沒有 `as any`、沒有 `Record<string, unknown>`），但**沒有任何
// 門禁保證它與 Reader 的 mapView 保持一致**：契約改了 View、這裡不會被通知。列入回報的契約缺口。
type CombatSkillDefinition = DefinitionHeader<SkillDefinitionId> &
  Omit<CombatSkillDefinitionView, 'skillId'>;

// ── 純資料查表工具 ──────────────────────────────────────────────────────────
//
// `noUncheckedIndexedAccess` 讓 `X[local]` 的型別帶 undefined。這三個小工具只做查表 + 查不到就
// 立刻爆，沒有任何規則判斷。爆掉是刻意的：打錯一個 local 名要在編譯內容的那一刻就知道，
// 而不是產出一個指向不存在定義的字串（那要等 Compiler 的跨定義引用檢查才會被抓到）。
function requireId<T>(table: Readonly<Record<string, T>>, local: string, what: string): T {
  const id = table[local];
  if (id === undefined) {
    throw new Error(`content-source/yunhua/skills.ts：${what} 沒有 local="${local}" 這一筆`);
  }
  return id;
}

const masteryId = (local: string): MasteryId => requireId(MASTERY_IDS, local, 'MASTERY_IDS');
const delayRuleId = (local: string) => requireId(ACTION_DELAY_RULE_IDS, local, 'ACTION_DELAY_RULE_IDS');
const effectId = (local: string): CombatEffectDefinitionId =>
  requireId(COMBAT_EFFECT_IDS, local, 'COMBAT_EFFECT_IDS');

// ── 武器需求與技術分類 ──────────────────────────────────────────────────────
//
// 兩個 kind（`weapon-requirement` / `technique`）**都還沒登記擁有模組**，所以現在沒有任何人寫得出
// 這兩族定義（Compiler 會拒收）。此處只能鑄 ID：見回報的契約缺口第 2、3 條。
//
// local 名沿用設計來源的既有名字，不另創一套：
//   * 武器需求 = `equipmentCatalog` 的 blueprint id（`ring-saber` / `iron-fan` / …），
//     那也是 `equipment.yunhua.<blueprint>.<tier>` 的中段，裝備側一定會用同一組名字。
//   * 技術分類 = `yunhua_content.md` §6.2 的英文 tag（該節明列「首批雲華僅登錄以下可組合分類」）。
const weaponRequirementId = (local: string): WeaponRequirementId =>
  yunhua.id<WeaponRequirementId>('weapon-requirement', local);
const techniqueId = (local: string): TechniqueId => yunhua.id<TechniqueId>('technique', local);

// §6.2 的封閉清單 + 同節末的「傷害型演奏另帶 `damage`」。
// 只用這一組；設計來源的裝備能力文字另外出現過 `[heavy]` 與 `[curse]`，兩者都**不在** §6.2，
// 判讀見回報的「散文判讀清單」。
type TechniqueLocal =
  | 'slash'
  | 'thrust'
  | 'sweep'
  | 'shot'
  | 'throw'
  | 'guard'
  | 'counter'
  | 'talisman'
  | 'ward'
  | 'perform'
  | 'damage';

// ── 目標解析 Resolver ────────────────────────────────────────────────────────
//
// `TargetingDefinition` 只有一個 `targetResolverId`，所以「哪些格位是合法目標」整件事都在 Resolver
// 後面。設計來源的 `condition` 欄位是中文散文，這張表把它**逐字**對到一個 resolver local——
// 一個 local 一個形狀，key 就是 local 名，value 是它代表的設計來源原文（不只一種寫法時列出全部）。
//
// 這是人工判讀，不是字串剖析：新增一種寫法必須在這裡新增一列，不會有「措辭改了就悄悄變成另一種
// 目標」的可能。合併過的兩組（`single-hostile` 與 `blocked-melee-attacker`）在下方註記理由。
//
// ✔ ID 形狀定案：採**模組擁有**的 `resolver:combat.target-<local>`（建構子在
// `content-source/core/resolver-ids.ts`，與 core 標頭的 shape 綁定共用同一組字面值）。原 F2a 作者
// 列入回報的「文化擁有 vs 模組擁有」已定為後者——目標邏輯是純格陣規則、四國共用、與文化無關。
const TARGET_SHAPES = {
  self: ['自身。'],
  // 卸勢：條件是「自身，但只有在舉盾成功格擋之後」。目標是自己，可用性條件在 Resolver 內。
  'self-after-block': ['舉盾成功格擋後。'],
  'single-ally': ['一名隊友。'],
  'self-or-single-ally': ['自身或一名隊友。'],
  'two-allies': ['兩名隊友。'],
  'up-to-three-allies': ['最多 3 名隊友。'],
  'whole-party': ['全隊。'],
  'own-front-row': ['己方前排。'],
  // 合併：符術表寫「單體。」、樂器表寫「敵方單體。」，兩者都是「不限距離的單一敵方目標」，
  // 沒有任何欄位或說明把它們區分開。合併成一個形狀而不是造兩個同義 Resolver。
  'single-hostile': ['單體。', '敵方單體。'],
  'single-hostile-melee': ['近距離單體。'],
  'single-hostile-mid': ['中距離單體。'],
  'single-hostile-ranged': ['遠距單體。'],
  'single-hostile-guarding': ['格擋中的單體。'],
  'single-hostile-with-guard-down': ['目標帶破綻。'],
  'single-hostile-with-negative-status': ['帶負面狀態單體。'],
  'single-hostile-casting': ['正在讀條的敵方單體。'],
  'single-hostile-casting-ranged': ['正在讀條的遠距單體。'],
  'up-to-three-hostiles': ['最多 3 名目標。'],
  'up-to-three-hostiles-melee': ['近距離最多 3 目標。'],
  'up-to-three-hostiles-ranged': ['最多 3 名遠距目標。'],
  'same-column-hostiles': ['同欄合法目標。'],
  // 合併：單手盾寫「舉盾成功格擋後的近距目標。」、雙手盾寫「成功格擋後近距目標。」——
  // 差別只在有沒有重述觸發技能名，形狀相同（剛剛被格擋下來的那名近戰攻擊者）。
  'blocked-melee-attacker': ['舉盾成功格擋後的近距目標。', '成功格擋後近距目標。'],
} as const satisfies Readonly<Record<string, readonly string[]>>;

type TargetLocal = keyof typeof TARGET_SHAPES;

// 委派到 core 的共用建構子（模組擁有）；本地保留型別安全包裝，讓 TargetLocal 的窮舉性不流失。
const targetResolverId = (local: TargetLocal): ResolverId => combatTargetResolverId(local);

// ── 反擊架勢的條件 Resolver ──────────────────────────────────────────────────
//
// `CounterStanceDefinition` 只有 `conditionResolverId` + `counterDelayRuleId`。設計來源的 `limit`
// 欄位把條件分成兩種寫法（逐筆判讀見回報）：
//   * 明講「只對近戰」的 → melee-block
//   * 只講「成功格擋／成功反擊」的 → block
const COUNTER_CONDITIONS = {
  // '只對近戰成功格擋觸發。' / '只對近戰成功格擋。'
  'melee-block': '只對近戰成功格擋',
  // '成功格擋後觸發；每次架勢 1 次。' / '架勢結束；每次架勢 1 次。' / '每次架勢 1 次。'
  block: '成功格擋（設計來源未限制攻擊距離）',
} as const satisfies Readonly<Record<string, string>>;

type CounterConditionLocal = keyof typeof COUNTER_CONDITIONS;

const counterConditionResolverId = (local: CounterConditionLocal): ResolverId =>
  combatCounterConditionResolverId(local);

// §2.4 招式額外距離：魔法（cast）與支援／治療（support）招式一律 +6，使其全場可及（最遠排距為 5）；
// 攻擊／演奏／守勢不加（射程走武器格數）。第一版數值，待討論（見設計帳本）。
const MAGIC_HEAL_EXTRA_REACH_CELLS = 6;
function extraReachCellsFor(actionKind: CombatActionKind): number | undefined {
  return actionKind === 'cast' || actionKind === 'support' ? MAGIC_HEAL_EXTRA_REACH_CELLS : undefined;
}

// ── 取得階層（§8.1 / acquisitionStages）─────────────────────────────────────
type StageLocal = 'l0' | 'l3' | 'basic' | 'advanced' | 'supreme';

type StageRow = Readonly<{
  // 設計來源 `acquisitionStages` 的逐字原文，供對帳。
  sourceLabel: string;
  minMasteryLevel: number;
  acquisition: SkillDefinition['acquisition'];
  // 設計來源 `supportMxpByStage` 的同 index 值。
  supportMxp: number;
}>;

const STAGES: Readonly<Record<StageLocal, StageRow>> = {
  l0: { sourceLabel: 'L0 自動', minMasteryLevel: 0, acquisition: { kind: 'automatic' }, supportMxp: 48 },
  l3: { sourceLabel: 'L3 自動', minMasteryLevel: 3, acquisition: { kind: 'automatic' }, supportMxp: 48 },
  basic: {
    sourceLabel: '基礎書 Lv.3',
    minMasteryLevel: 3,
    acquisition: { kind: 'book', acceptedTiers: ['basic'] },
    supportMxp: 72,
  },
  advanced: {
    sourceLabel: '高級書 Lv.6',
    minMasteryLevel: 6,
    acquisition: { kind: 'book', acceptedTiers: ['advanced'] },
    supportMxp: 120,
  },
  supreme: {
    sourceLabel: '極品書 Lv.10',
    minMasteryLevel: 10,
    acquisition: { kind: 'book', acceptedTiers: ['supreme'] },
    supportMxp: 200,
  },
};

const STAGE_ORDER: readonly StageLocal[] = ['l0', 'l3', 'basic', 'advanced', 'supreme'];

// ── 雲華自己的 MXP 分配規則 ─────────────────────────────────────────────────
//
// 盾牌傷害技的兩筆攻擊規則（core 沒有）。形狀比照 core 的「單一來源 100%」。
const SHIELD_ATTACK_MASTERY_LOCALS: readonly string[] = ['one-hand-shield', 'two-hand-shield'];

const shieldAttackAwardRules: readonly Authored<AttackMasteryAwardRuleDefinition>[] =
  SHIELD_ATTACK_MASTERY_LOCALS.map((local) => ({
    kind: KIND.attackAwardRule,
    id: yunhua.id<AttackMasteryAwardRuleId>(KIND.attackAwardRule, local),
    masterySplits: [{ masteryId: masteryId(local), ratio: 1 }],
  }));

const yunhuaAttackAwardRuleId = (local: string): AttackMasteryAwardRuleId =>
  yunhua.id<AttackMasteryAwardRuleId>(KIND.attackAwardRule, local);

const coreAttackAwardRuleId = (local: string): AttackMasteryAwardRuleId =>
  core.id<AttackMasteryAwardRuleId>(KIND.attackAwardRule, local);

// ── 一招的資料列 ────────────────────────────────────────────────────────────
//
// `sourceName` / `sourceEffect` / `sourceLimit` 是設計來源的逐字原文，只作註解與對帳用，
// **不會**進到定義裡（Compiler 會把作者物件原樣攤成 JSON，所以非契約欄位絕不能出現在
// 定義物件上）。`unexpressed` 同理：它記錄「設計來源要求、但目前的契約或已存在的 core 定義
// 表達不出來」的那些效果，由下方彙總成一份可清點的清單。
type SkillRow = Readonly<{
  local: StageLocal;
  sourceName: string;
  damage?: Readonly<{ channel: 'physical' | 'magic' | 'instrument'; multiplier: number; hits: number }>;
  actionKind: CombatActionKind;
  delayLocal: 'quick' | 'standard' | 'heavy' | 'cast' | 'perform' | 'stance';
  target: TargetLocal;
  techniques: readonly TechniqueLocal[];
  // 只放**已經存在**的 core 效果。缺的一律進 `unexpressed`，不填近似值、不留懸空引用。
  effectLocals: readonly string[];
  // 有反擊結算的架勢技才填。
  counterCondition?: CounterConditionLocal;
  // 覆寫路線預設（目前只有「雙手法杖限定」的五招符術用得到）。
  activationHand?: CombatActivationHand;
  weaponRequirementLocals?: readonly string[];
  attackAwardRuleId?: AttackMasteryAwardRuleId;
  supportSplitLocals?: readonly (readonly [string, number])[];
  unexpressed?: readonly string[];
}>;

type RouteRow = Readonly<{
  local: string;
  // 設計來源 `skillSeries` 的 route 與 requirement 原文。
  sourceRoute: string;
  sourceRequirement: string;
  // §8.2「Weapon Requirement／Mastery」表右半：這條路線的熟練度。
  masteryLocal: string;
  activationHand: CombatActivationHand;
  weaponRequirementLocals: readonly string[];
  // damage／counter 技能的攻擊 MXP 規則（設計來源 `masteryExperience()` 的「傷害比例 → …」）。
  attackAwardRuleId: AttackMasteryAwardRuleId;
  // fixedSupport 技能的受益熟練度分割（設計來源只給「必須依實際 Routing 拆分」＋符術的 50／50）。
  supportSplitLocals: readonly (readonly [string, number])[];
  entries: readonly SkillRow[];
}>;

// 純武器路線的支援分割：100% 進該路線自己的熟練度（沒有魔法成分可拆）。
const soleSplit = (local: string): readonly (readonly [string, number])[] => [[local, 1]];
// 樂器與符術：兩半各 50%（§8.4 明文「首批同樣採 50／50」）。
const halfSplit = (a: string, b: string): readonly (readonly [string, number])[] => [
  [a, 0.5],
  [b, 0.5],
];

const ROUTES: readonly RouteRow[] = [
  // ── 武技（單手物理）──────────────────────────────────────────────────────
  {
    local: 'ring-saber',
    sourceRoute: '環首刀',
    sourceRequirement: '主手・環首刀',
    masteryLocal: 'one-hand-weapon',
    activationHand: 'mainHand',
    weaponRequirementLocals: ['ring-saber'],
    attackAwardRuleId: coreAttackAwardRuleId('one-hand-weapon'),
    supportSplitLocals: soleSplit('one-hand-weapon'),
    entries: [
      {
        local: 'l0',
        sourceName: '引環斬',
        actionKind: 'attack',
        delayLocal: 'standard',
        target: 'single-hostile-melee',
        techniques: ['slash'],
        effectLocals: [],
        damage: { channel: 'physical', multiplier: 0.95, hits: 1 },
        unexpressed: [],
      },
      {
        local: 'l3',
        sourceName: '挑腕',
        actionKind: 'attack',
        delayLocal: 'quick',
        target: 'single-hostile-melee',
        techniques: ['slash'],
        effectLocals: ['apply-guard-down'],
        damage: { channel: 'physical', multiplier: 0.82, hits: 1 },
        unexpressed: ['「每名目標 1 次」的使用次數上限'],
      },
      {
        local: 'basic',
        sourceName: '迎風架',
        actionKind: 'guard',
        delayLocal: 'stance',
        target: 'self',
        techniques: ['guard', 'counter'],
        effectLocals: [],
        counterCondition: 'melee-block',
        damage: { channel: 'physical', multiplier: 0.85, hits: 1 },
        unexpressed: [],
      },
      {
        local: 'advanced',
        sourceName: '破綻追擊',
        actionKind: 'attack',
        delayLocal: 'standard',
        target: 'single-hostile-with-guard-down',
        techniques: ['slash'],
        effectLocals: ['ctb-light'],
        damage: { channel: 'physical', multiplier: 1.22, hits: 1 },
        unexpressed: [],
      },
      {
        local: 'supreme',
        sourceName: '斷流反擊',
        actionKind: 'guard',
        delayLocal: 'stance',
        target: 'self',
        techniques: ['guard', 'counter'],
        effectLocals: [],
        counterCondition: 'block',
        damage: { channel: 'physical', multiplier: 1.35, hits: 1 },
        unexpressed: [
          '反擊追加 interruptCasting',
          '「每次架勢 1 次」的使用次數上限',
        ],
      },
    ],
  },
  {
    local: 'iron-fan',
    sourceRoute: '鐵骨扇',
    sourceRequirement: '主手・鐵骨扇',
    masteryLocal: 'one-hand-weapon',
    activationHand: 'mainHand',
    weaponRequirementLocals: ['iron-fan'],
    attackAwardRuleId: coreAttackAwardRuleId('one-hand-weapon'),
    supportSplitLocals: soleSplit('one-hand-weapon'),
    entries: [
      {
        local: 'l0',
        sourceName: '扇脊點打',
        actionKind: 'attack',
        delayLocal: 'quick',
        target: 'single-hostile-melee',
        techniques: ['slash'],
        effectLocals: [],
        damage: { channel: 'physical', multiplier: 0.78, hits: 1 },
        unexpressed: [],
      },
      {
        local: 'l3',
        sourceName: '回風守勢',
        actionKind: 'support',
        delayLocal: 'stance',
        target: 'self',
        // 帶 guard：設計來源的鐵骨扇 Tier I 能力是「使用 [guard]。自身定息強度 +8 raw。」，
        // 那個能力唯一可能觸發的扇技就是這一招。
        techniques: ['guard'],
        effectLocals: ['apply-accuracy-up'],
      },
      {
        local: 'basic',
        sourceName: '拆式擊',
        actionKind: 'attack',
        delayLocal: 'standard',
        target: 'single-hostile-melee',
        techniques: ['slash'],
        effectLocals: [],
        damage: { channel: 'physical', multiplier: 0.90, hits: 1 },
        unexpressed: [
          'applyStatus 破綻 **1** 目標行動（core 只有 2 行動版 apply-guard-down）',
        ],
      },
      {
        local: 'advanced',
        sourceName: '扇影回護',
        actionKind: 'support',
        delayLocal: 'standard',
        target: 'self-or-single-ally',
        techniques: [],
        effectLocals: ['apply-magic-defense-up'],
      },
      {
        local: 'supreme',
        sourceName: '百頁回環',
        actionKind: 'guard',
        delayLocal: 'stance',
        target: 'self',
        techniques: ['guard', 'counter'],
        effectLocals: [],
        counterCondition: 'melee-block',
        damage: { channel: 'physical', multiplier: 1.15, hits: 1 },
        unexpressed: [
          '反擊追加 interruptCasting',
        ],
      },
    ],
  },
  // ── 武技（雙手物理）──────────────────────────────────────────────────────
  {
    local: 'spear',
    sourceRoute: '長槍',
    sourceRequirement: '雙手・長槍',
    masteryLocal: 'two-hand-weapon',
    activationHand: 'bothHands',
    weaponRequirementLocals: ['spear'],
    attackAwardRuleId: coreAttackAwardRuleId('two-hand-weapon'),
    supportSplitLocals: soleSplit('two-hand-weapon'),
    entries: [
      {
        local: 'l0',
        sourceName: '守距突刺',
        actionKind: 'attack',
        delayLocal: 'standard',
        target: 'single-hostile-mid',
        techniques: ['thrust'],
        effectLocals: ['ctb-light'],
        damage: { channel: 'physical', multiplier: 0.95, hits: 1 },
        unexpressed: ['「近距離傷害 −20%」的距離修正'],
      },
      {
        local: 'l3',
        sourceName: '架槍迎擊',
        actionKind: 'guard',
        delayLocal: 'stance',
        target: 'self',
        techniques: ['guard', 'counter'],
        effectLocals: [],
        counterCondition: 'melee-block',
        damage: { channel: 'physical', multiplier: 0.90, hits: 1 },
        unexpressed: [],
      },
      {
        local: 'basic',
        sourceName: '穿勢刺',
        actionKind: 'attack',
        delayLocal: 'standard',
        target: 'single-hostile-guarding',
        techniques: ['thrust'],
        effectLocals: ['apply-guard-down'],
        damage: { channel: 'physical', multiplier: 1.08, hits: 1 },
        unexpressed: [
          '「目標未在守勢仍可傷害但不套破綻」的條件式效果（效果清單無條件欄位）',
        ],
      },
      {
        local: 'advanced',
        sourceName: '穿陣突刺',
        actionKind: 'attack',
        delayLocal: 'heavy',
        target: 'same-column-hostiles',
        techniques: ['thrust', 'sweep'],
        effectLocals: [],
        damage: { channel: 'physical', multiplier: 1.18, hits: 1 },
        unexpressed: ['「每名目標只命中 1 次」的使用次數上限'],
      },
      {
        local: 'supreme',
        sourceName: '鎖陣槍勢',
        actionKind: 'guard',
        delayLocal: 'stance',
        target: 'self',
        techniques: ['guard', 'counter'],
        effectLocals: [],
        counterCondition: 'block',
        damage: { channel: 'physical', multiplier: 1.28, hits: 1 },
        unexpressed: [
          '反擊 dealDamage 物理 ×1.28 與目標 +22 CTB（CounterStanceDefinition 沒有 effectIds）',
        ],
      },
    ],
  },
  {
    local: 'glaive',
    sourceRoute: '偃刀',
    sourceRequirement: '雙手・偃刀',
    masteryLocal: 'two-hand-weapon',
    activationHand: 'bothHands',
    weaponRequirementLocals: ['glaive'],
    attackAwardRuleId: coreAttackAwardRuleId('two-hand-weapon'),
    supportSplitLocals: soleSplit('two-hand-weapon'),
    entries: [
      {
        local: 'l0',
        sourceName: '起月斬',
        actionKind: 'attack',
        delayLocal: 'standard',
        target: 'single-hostile-melee',
        techniques: ['slash'],
        effectLocals: [],
        damage: { channel: 'physical', multiplier: 1.05, hits: 1 },
        unexpressed: [],
      },
      {
        local: 'l3',
        sourceName: '橫月掃',
        actionKind: 'attack',
        delayLocal: 'heavy',
        target: 'up-to-three-hostiles-melee',
        techniques: ['sweep'],
        effectLocals: [],
        damage: { channel: 'physical', multiplier: 0.85, hits: 1 },
        unexpressed: ['「每多一目標傷害衰減 10%」的多目標衰減'],
      },
      {
        local: 'basic',
        sourceName: '蓄勢斬',
        actionKind: 'attack',
        delayLocal: 'heavy',
        target: 'single-hostile-melee',
        techniques: ['slash'],
        effectLocals: ['ctb-standard'],
        damage: { channel: 'physical', multiplier: 1.32, hits: 1 },
        unexpressed: [],
      },
      {
        local: 'advanced',
        sourceName: '斷甲橫掃',
        actionKind: 'attack',
        delayLocal: 'heavy',
        target: 'up-to-three-hostiles-melee',
        techniques: ['sweep'],
        effectLocals: ['apply-guard-down'],
        damage: { channel: 'physical', multiplier: 1.18, hits: 1 },
        unexpressed: ['「每名目標 1 次」的使用次數上限'],
      },
      {
        local: 'supreme',
        sourceName: '鎮關偃勢',
        actionKind: 'guard',
        delayLocal: 'stance',
        target: 'self',
        techniques: ['guard', 'counter'],
        effectLocals: [],
        counterCondition: 'block',
        damage: { channel: 'physical', multiplier: 1.40, hits: 1 },
        unexpressed: [
          '反擊追加 interruptCasting',
        ],
      },
    ],
  },
  // ── 武技（投擲）─────────────────────────────────────────────────────────
  {
    local: 'needle',
    sourceRoute: '飛針',
    sourceRequirement: '主手・飛針',
    masteryLocal: 'throwing-weapon',
    activationHand: 'mainHand',
    weaponRequirementLocals: ['needle'],
    attackAwardRuleId: coreAttackAwardRuleId('throwing-weapon'),
    supportSplitLocals: soleSplit('throwing-weapon'),
    entries: [
      {
        local: 'l0',
        sourceName: '飛針',
        actionKind: 'attack',
        delayLocal: 'quick',
        target: 'single-hostile-ranged',
        techniques: ['throw'],
        effectLocals: [],
        damage: { channel: 'physical', multiplier: 0.72, hits: 1 },
        unexpressed: [],
      },
      {
        local: 'l3',
        sourceName: '縛線針',
        actionKind: 'attack',
        delayLocal: 'quick',
        target: 'single-hostile-ranged',
        techniques: ['throw'],
        effectLocals: ['ctb-light'],
        damage: { channel: 'physical', multiplier: 0.62, hits: 1 },
        unexpressed: [],
      },
      {
        local: 'basic',
        sourceName: '追影針',
        actionKind: 'attack',
        delayLocal: 'quick',
        target: 'single-hostile-with-negative-status',
        techniques: ['throw'],
        effectLocals: [],
        damage: { channel: 'physical', multiplier: 0.85, hits: 1 },
        unexpressed: ['「命中 raw +12」的單次命中加成'],
      },
      {
        local: 'advanced',
        sourceName: '封脈針',
        actionKind: 'attack',
        delayLocal: 'standard',
        target: 'single-hostile-ranged',
        techniques: ['throw'],
        effectLocals: ['apply-magic-defense-down'],
        damage: { channel: 'physical', multiplier: 1.02, hits: 1 },
        unexpressed: [],
      },
      {
        local: 'supreme',
        sourceName: '百針散華',
        actionKind: 'attack',
        delayLocal: 'heavy',
        target: 'up-to-three-hostiles-ranged',
        techniques: ['throw'],
        effectLocals: [],
        damage: { channel: 'physical', multiplier: 1.12, hits: 1 },
        unexpressed: ['「每多一目標傷害衰減 12%」的多目標衰減'],
      },
    ],
  },
  {
    local: 'chain-weight',
    sourceRoute: '鏈鏢',
    sourceRequirement: '主手・鏈鏢',
    masteryLocal: 'throwing-weapon',
    activationHand: 'mainHand',
    weaponRequirementLocals: ['chain-weight'],
    attackAwardRuleId: coreAttackAwardRuleId('throwing-weapon'),
    supportSplitLocals: soleSplit('throwing-weapon'),
    entries: [
      {
        local: 'l0',
        sourceName: '擲蒺藜',
        actionKind: 'attack',
        delayLocal: 'standard',
        target: 'single-hostile-ranged',
        techniques: ['throw'],
        effectLocals: [],
        damage: { channel: 'physical', multiplier: 0.88, hits: 1 },
        unexpressed: [],
      },
      {
        local: 'l3',
        sourceName: '纏腕鏢',
        actionKind: 'attack',
        delayLocal: 'standard',
        target: 'single-hostile-ranged',
        techniques: ['throw'],
        effectLocals: [],
        damage: { channel: 'physical', multiplier: 0.75, hits: 1 },
        unexpressed: [
          'applyStatus 破綻 **1** 目標行動（core 只有 2 行動版 apply-guard-down）',
        ],
      },
      {
        local: 'basic',
        sourceName: '流星斷讀',
        actionKind: 'support',
        delayLocal: 'quick',
        target: 'single-hostile-casting-ranged',
        techniques: ['throw'],
        effectLocals: ['interrupt-casting'],
      },
      {
        local: 'advanced',
        sourceName: '鎖鏈重擊',
        actionKind: 'attack',
        delayLocal: 'heavy',
        target: 'single-hostile-ranged',
        techniques: ['throw'],
        effectLocals: ['ctb-standard'],
        damage: { channel: 'physical', multiplier: 1.25, hits: 1 },
        unexpressed: [],
      },
      {
        local: 'supreme',
        sourceName: '九節鎖勢',
        actionKind: 'attack',
        delayLocal: 'heavy',
        target: 'single-hostile-ranged',
        techniques: ['throw'],
        effectLocals: ['ctb-heavy'],
        damage: { channel: 'physical', multiplier: 1.42, hits: 1 },
        unexpressed: ['「每場對同一目標 1 次」的使用次數上限'],
      },
    ],
  },
  // ── 武技（射擊）─────────────────────────────────────────────────────────
  {
    local: 'bamboo-bow',
    sourceRoute: '竹弓',
    sourceRequirement: '雙手・竹弓',
    masteryLocal: 'shooting-weapon',
    activationHand: 'bothHands',
    weaponRequirementLocals: ['bamboo-bow'],
    attackAwardRuleId: coreAttackAwardRuleId('shooting-weapon'),
    supportSplitLocals: soleSplit('shooting-weapon'),
    entries: [
      {
        local: 'l0',
        sourceName: '平射',
        actionKind: 'attack',
        delayLocal: 'standard',
        target: 'single-hostile-ranged',
        techniques: ['shot'],
        effectLocals: [],
        damage: { channel: 'physical', multiplier: 0.92, hits: 1 },
        unexpressed: [],
      },
      {
        local: 'l3',
        sourceName: '凝息瞄準',
        actionKind: 'support',
        delayLocal: 'stance',
        target: 'self',
        techniques: [],
        effectLocals: ['apply-accuracy-up'],
      },
      {
        local: 'basic',
        sourceName: '破甲箭',
        actionKind: 'attack',
        delayLocal: 'standard',
        target: 'single-hostile-ranged',
        techniques: ['shot'],
        effectLocals: ['apply-guard-down'],
        damage: { channel: 'physical', multiplier: 1.05, hits: 1 },
        unexpressed: [],
      },
      {
        local: 'advanced',
        sourceName: '連珠三矢',
        actionKind: 'attack',
        delayLocal: 'heavy',
        target: 'single-hostile-ranged',
        techniques: ['shot'],
        effectLocals: [],
        damage: { channel: 'physical', multiplier: 0.62, hits: 3 },
        unexpressed: [
        ],
      },
      {
        local: 'supreme',
        sourceName: '穿雲一箭',
        actionKind: 'attack',
        delayLocal: 'heavy',
        target: 'single-hostile-ranged',
        techniques: ['shot'],
        effectLocals: [],
        damage: { channel: 'physical', multiplier: 1.48, hits: 1 },
        unexpressed: ['「高命中」的單次命中加成'],
      },
    ],
  },
  {
    local: 'repeating-crossbow',
    sourceRoute: '連珠弩',
    sourceRequirement: '雙手・連珠弩',
    masteryLocal: 'shooting-weapon',
    activationHand: 'bothHands',
    weaponRequirementLocals: ['repeating-crossbow'],
    attackAwardRuleId: coreAttackAwardRuleId('shooting-weapon'),
    supportSplitLocals: soleSplit('shooting-weapon'),
    entries: [
      {
        local: 'l0',
        sourceName: '弩矢射',
        actionKind: 'attack',
        delayLocal: 'standard',
        target: 'single-hostile-ranged',
        techniques: ['shot'],
        effectLocals: [],
        damage: { channel: 'physical', multiplier: 0.92, hits: 1 },
        unexpressed: [],
      },
      {
        local: 'l3',
        sourceName: '急簧',
        actionKind: 'attack',
        delayLocal: 'quick',
        target: 'single-hostile-ranged',
        techniques: ['shot'],
        effectLocals: [],
        damage: { channel: 'physical', multiplier: 0.72, hits: 1 },
        unexpressed: [
          '「命中後自身下一個射擊 CTB −6」（core 的 adjustCtb 效果只有 +8／+14／+22 三筆正值）',
          '「每 2 次自身行動 1 次」的使用次數上限',
        ],
      },
      {
        local: 'basic',
        sourceName: '鎮弩射',
        actionKind: 'attack',
        delayLocal: 'standard',
        target: 'single-hostile-ranged',
        techniques: ['shot'],
        effectLocals: ['ctb-standard'],
        damage: { channel: 'physical', multiplier: 0.90, hits: 1 },
        unexpressed: [],
      },
      {
        local: 'advanced',
        sourceName: '貫甲弩矢',
        actionKind: 'attack',
        delayLocal: 'heavy',
        target: 'single-hostile-ranged',
        techniques: ['shot'],
        effectLocals: ['apply-guard-down'],
        damage: { channel: 'physical', multiplier: 1.18, hits: 1 },
        unexpressed: [],
      },
      {
        local: 'supreme',
        sourceName: '天機齊發',
        actionKind: 'attack',
        delayLocal: 'heavy',
        target: 'up-to-three-hostiles-ranged',
        techniques: ['shot'],
        effectLocals: [],
        damage: { channel: 'physical', multiplier: 1.15, hits: 1 },
        unexpressed: ['「每多一目標傷害衰減 12%」的多目標衰減'],
      },
    ],
  },
  // ── 盾技 ────────────────────────────────────────────────────────────────
  {
    local: 'one-hand-shield',
    sourceRoute: '單手盾',
    sourceRequirement: '副手・單手盾',
    masteryLocal: 'one-hand-shield',
    activationHand: 'offHand',
    weaponRequirementLocals: ['one-hand-shield'],
    attackAwardRuleId: yunhuaAttackAwardRuleId('one-hand-shield'),
    supportSplitLocals: soleSplit('one-hand-shield'),
    entries: [
      {
        local: 'l0',
        sourceName: '舉盾',
        actionKind: 'guard',
        delayLocal: 'stance',
        target: 'self',
        techniques: ['guard'],
        effectLocals: [],
        unexpressed: ['「建立格擋守勢」——守勢本身沒有任何強度或持續欄位可填'],
      },
      {
        local: 'l3',
        sourceName: '卸勢',
        actionKind: 'support',
        delayLocal: 'quick',
        target: 'self-after-block',
        techniques: ['guard'],
        effectLocals: [],
        unexpressed: [
          '「自身 CTB −8」（core 的 adjustCtb 效果只有 +8／+14／+22 三筆正值）',
          '「每次守勢 1 次」的使用次數上限',
        ],
      },
      {
        local: 'basic',
        sourceName: '盾緣擊',
        actionKind: 'attack',
        delayLocal: 'standard',
        target: 'blocked-melee-attacker',
        techniques: ['guard'],
        effectLocals: [],
        damage: { channel: 'physical', multiplier: 0.68, hits: 1 },
        unexpressed: [
          'applyStatus 破綻 **1** 目標行動（core 只有 2 行動版 apply-guard-down）',
          '「每次守勢 1 次」的使用次數上限',
        ],
      },
      {
        local: 'advanced',
        sourceName: '掩護',
        actionKind: 'support',
        delayLocal: 'stance',
        target: 'single-ally',
        techniques: ['guard'],
        effectLocals: ['apply-magic-defense-up'],
      },
      {
        local: 'supreme',
        sourceName: '回盾反擊',
        actionKind: 'guard',
        delayLocal: 'stance',
        target: 'self',
        techniques: ['guard', 'counter'],
        effectLocals: [],
        counterCondition: 'block',
        damage: { channel: 'physical', multiplier: 1.08, hits: 1 },
        unexpressed: [],
      },
    ],
  },
  {
    local: 'two-hand-shield',
    sourceRoute: '雙手盾',
    sourceRequirement: '雙手・大盾',
    masteryLocal: 'two-hand-shield',
    activationHand: 'bothHands',
    weaponRequirementLocals: ['two-hand-shield'],
    attackAwardRuleId: yunhuaAttackAwardRuleId('two-hand-shield'),
    supportSplitLocals: soleSplit('two-hand-shield'),
    entries: [
      {
        local: 'l0',
        sourceName: '立盾',
        actionKind: 'guard',
        delayLocal: 'stance',
        target: 'self',
        techniques: ['guard'],
        effectLocals: [],
        unexpressed: [
          '「建立**高**格擋守勢」——守勢沒有強度欄位，與單手盾的「舉盾」在資料上完全相同',
          '「主手武器技能不可用」的互斥限制',
        ],
      },
      {
        local: 'l3',
        sourceName: '守線',
        actionKind: 'support',
        delayLocal: 'stance',
        target: 'self',
        techniques: ['guard'],
        effectLocals: ['apply-magic-defense-up'],
      },
      {
        local: 'basic',
        sourceName: '壁勢',
        actionKind: 'support',
        delayLocal: 'stance',
        target: 'own-front-row',
        techniques: ['guard'],
        effectLocals: ['apply-magic-defense-up'],
      },
      {
        local: 'advanced',
        sourceName: '鎮門擊',
        actionKind: 'attack',
        delayLocal: 'heavy',
        target: 'blocked-melee-attacker',
        techniques: ['guard'],
        effectLocals: ['ctb-standard'],
        damage: { channel: 'physical', multiplier: 0.72, hits: 1 },
        unexpressed: ['「每次守勢 1 次」的使用次數上限'],
      },
      {
        local: 'supreme',
        sourceName: '不動如嶽',
        actionKind: 'support',
        delayLocal: 'heavy',
        target: 'whole-party',
        techniques: ['guard'],
        effectLocals: ['apply-magic-defense-up'],
        unexpressed: [
          '「一般減傷 raw +12」——core 的五個狀態沒有一般減傷方向，也沒有對應 applyStatus 效果',
          '「每場 1 次」的使用次數上限',
        ],
      },
    ],
  },
  // ── 演奏 ────────────────────────────────────────────────────────────────
  {
    local: 'bamboo-flute',
    sourceRoute: '管樂器',
    sourceRequirement: '雙手・竹笛／管樂器',
    masteryLocal: 'wind-instrument',
    activationHand: 'bothHands',
    weaponRequirementLocals: ['bamboo-flute'],
    attackAwardRuleId: coreAttackAwardRuleId('wind-instrument'),
    // §8.3：「管樂祝福技可拆至管樂器＋祝福魔法」。四招支援演奏全是定息／解除瘴息／治療，
    // 對應符術表裡的祝福魔法（定息符、安神符、回春香符）。
    supportSplitLocals: halfSplit('wind-instrument', 'blessing-magic'),
    entries: [
      {
        local: 'l0',
        sourceName: '定息調',
        actionKind: 'perform',
        delayLocal: 'perform',
        target: 'single-ally',
        techniques: ['perform'],
        effectLocals: ['apply-accuracy-up'],
      },
      {
        local: 'l3',
        sourceName: '清瘴音',
        actionKind: 'perform',
        delayLocal: 'perform',
        target: 'single-ally',
        techniques: ['perform'],
        effectLocals: ['remove-accuracy-down'],
        unexpressed: ['「目標 CTB −6」（core 的 adjustCtb 效果只有正值）'],
      },
      {
        local: 'basic',
        sourceName: '和聲',
        actionKind: 'perform',
        delayLocal: 'perform',
        target: 'two-allies',
        techniques: ['perform'],
        effectLocals: ['apply-accuracy-up'],
      },
      {
        local: 'advanced',
        sourceName: '破音',
        actionKind: 'perform',
        delayLocal: 'perform',
        target: 'single-hostile-casting',
        // §6.2 末：「傷害型演奏另帶 `damage`」。
        techniques: ['perform', 'damage'],
        effectLocals: ['interrupt-casting'],
        damage: { channel: 'instrument', multiplier: 0.80, hits: 1 },
        unexpressed: [],
      },
      {
        local: 'supreme',
        sourceName: '回春長調',
        actionKind: 'perform',
        delayLocal: 'perform',
        target: 'up-to-three-allies',
        techniques: ['perform'],
        effectLocals: [],
        unexpressed: ['heal ×1.15'],
      },
    ],
  },
  {
    local: 'seven-string',
    sourceRoute: '弦樂器',
    sourceRequirement: '雙手・七弦琴／弦樂器',
    masteryLocal: 'string-instrument',
    activationHand: 'bothHands',
    weaponRequirementLocals: ['seven-string'],
    attackAwardRuleId: coreAttackAwardRuleId('string-instrument'),
    // 四招支援演奏全是護印／解除印痕，對應符術表裡的防禦魔法（小護符、結界符、鎮界符）。
    supportSplitLocals: halfSplit('string-instrument', 'defense-magic'),
    entries: [
      {
        local: 'l0',
        sourceName: '安弦曲',
        actionKind: 'perform',
        delayLocal: 'perform',
        target: 'single-ally',
        techniques: ['perform'],
        effectLocals: ['apply-magic-defense-up'],
      },
      {
        local: 'l3',
        sourceName: '鎮心曲',
        actionKind: 'perform',
        delayLocal: 'perform',
        target: 'single-ally',
        techniques: ['perform'],
        effectLocals: ['remove-magic-defense-down'],
      },
      {
        local: 'basic',
        sourceName: '迴紋曲',
        actionKind: 'perform',
        delayLocal: 'perform',
        target: 'single-ally',
        techniques: ['perform'],
        effectLocals: ['apply-magic-defense-up', 'apply-accuracy-up'],
      },
      {
        local: 'advanced',
        sourceName: '離調',
        actionKind: 'perform',
        delayLocal: 'perform',
        target: 'single-hostile',
        techniques: ['perform', 'damage'],
        effectLocals: ['apply-magic-defense-down'],
        damage: { channel: 'instrument', multiplier: 0.72, hits: 1 },
        unexpressed: [],
      },
      {
        local: 'supreme',
        sourceName: '雲和止息',
        actionKind: 'perform',
        delayLocal: 'perform',
        target: 'whole-party',
        techniques: ['perform'],
        effectLocals: ['apply-magic-defense-up'],
        unexpressed: ['「每場 1 次」的使用次數上限'],
      },
    ],
  },
  // ── 符術 ────────────────────────────────────────────────────────────────
  //
  // 四條符術路線的武器需求都是「單手或雙手・法杖」，但 `activationHand` 只能填一個值。
  // 路線預設 `mainHand` + 兩種法杖都接受（`weaponRequirementIds` 是並列的可接受配置，滿足其一即可，
  // 而雙手法杖同時占滿主手與副手兩個 slot，所以 mainHand 對兩種法杖都成立）；
  // 設計來源 `limit` 欄位明講「雙手法杖」的五招則逐筆覆寫成 `bothHands` + 只接受雙手法杖。
  // 這個取捨是第一版方案，見回報。
  {
    local: 'attack-magic',
    sourceRoute: '攻擊魔法',
    sourceRequirement: '單手或雙手・法杖',
    masteryLocal: 'attack-magic',
    activationHand: 'mainHand',
    weaponRequirementLocals: ['one-hand-staff', 'two-hand-staff'],
    // §8.4：「以法杖施放攻擊符術時，Attack Mastery Rule 依資料分配法杖與攻擊魔法經驗；
    // 首批雲華基準採 50／50。」core 已把這一族發成 `<法杖>-and-attack-magic` 兩筆。
    attackAwardRuleId: coreAttackAwardRuleId('one-hand-staff-and-attack-magic'),
    supportSplitLocals: halfSplit('one-hand-staff', 'attack-magic'),
    entries: [
      {
        local: 'l0',
        sourceName: '火符',
        actionKind: 'cast',
        delayLocal: 'cast',
        target: 'single-hostile',
        techniques: ['talisman'],
        effectLocals: [],
        damage: { channel: 'magic', multiplier: 0.95, hits: 1 },
        unexpressed: [],
      },
      {
        local: 'l3',
        sourceName: '碎印符',
        actionKind: 'cast',
        delayLocal: 'cast',
        target: 'single-hostile',
        techniques: ['talisman'],
        effectLocals: ['apply-magic-defense-down'],
        damage: { channel: 'magic', multiplier: 0.88, hits: 1 },
        unexpressed: [],
      },
      {
        local: 'basic',
        sourceName: '雷紙符',
        actionKind: 'cast',
        delayLocal: 'cast',
        target: 'single-hostile',
        techniques: ['talisman'],
        effectLocals: ['ctb-light'],
        damage: { channel: 'magic', multiplier: 0.92, hits: 1 },
        unexpressed: [],
      },
      {
        local: 'advanced',
        sourceName: '連環火符',
        actionKind: 'cast',
        delayLocal: 'cast',
        target: 'up-to-three-hostiles',
        techniques: ['talisman'],
        effectLocals: [],
        activationHand: 'bothHands',
        weaponRequirementLocals: ['two-hand-staff'],
        attackAwardRuleId: coreAttackAwardRuleId('two-hand-staff-and-attack-magic'),
        damage: { channel: 'magic', multiplier: 1.12, hits: 1 },
        unexpressed: ['「每多一目標衰減 12%」的多目標衰減'],
      },
      {
        local: 'supreme',
        sourceName: '天衡落印',
        actionKind: 'cast',
        delayLocal: 'cast',
        target: 'up-to-three-hostiles',
        techniques: ['talisman'],
        effectLocals: [],
        activationHand: 'bothHands',
        weaponRequirementLocals: ['two-hand-staff'],
        attackAwardRuleId: coreAttackAwardRuleId('two-hand-staff-and-attack-magic'),
        damage: { channel: 'magic', multiplier: 1.55, hits: 1 },
        unexpressed: [
          '「帶印痕目標威力 +0.20」的條件式威力加成',
          '「每場 1 次」的使用次數上限',
        ],
      },
    ],
  },
  {
    local: 'defense-magic',
    sourceRoute: '防禦魔法',
    sourceRequirement: '單手或雙手・法杖',
    masteryLocal: 'defense-magic',
    activationHand: 'mainHand',
    weaponRequirementLocals: ['one-hand-staff', 'two-hand-staff'],
    // 這條路線沒有傷害技，但 damage 技能的欄位是選填、路線層仍需要一個值；填最貼近的一筆
    // （單手法杖＋攻擊魔法）不會被任何一招引用——見下方 `combatSkill()`：只有 damage 模式才填。
    attackAwardRuleId: coreAttackAwardRuleId('one-hand-staff-and-attack-magic'),
    supportSplitLocals: halfSplit('one-hand-staff', 'defense-magic'),
    entries: [
      {
        local: 'l0',
        sourceName: '小護符',
        actionKind: 'cast',
        delayLocal: 'cast',
        target: 'self',
        techniques: ['ward'],
        effectLocals: ['apply-magic-defense-up'],
      },
      {
        local: 'l3',
        sourceName: '結界符',
        actionKind: 'cast',
        delayLocal: 'cast',
        target: 'single-ally',
        techniques: ['ward'],
        effectLocals: ['apply-magic-defense-up'],
      },
      {
        local: 'basic',
        sourceName: '回元符',
        actionKind: 'cast',
        delayLocal: 'cast',
        target: 'single-ally',
        techniques: ['ward'],
        effectLocals: [],
        unexpressed: ['heal ×0.85'],
      },
      {
        local: 'advanced',
        sourceName: '四角護印',
        actionKind: 'cast',
        delayLocal: 'cast',
        target: 'up-to-three-allies',
        techniques: ['ward'],
        effectLocals: ['apply-magic-defense-up'],
        activationHand: 'bothHands',
        weaponRequirementLocals: ['two-hand-staff'],
        supportSplitLocals: halfSplit('two-hand-staff', 'defense-magic'),
      },
      {
        local: 'supreme',
        sourceName: '鎮界符',
        actionKind: 'cast',
        delayLocal: 'cast',
        target: 'whole-party',
        techniques: ['ward'],
        effectLocals: ['apply-magic-defense-up', 'remove-magic-defense-down'],
        activationHand: 'bothHands',
        weaponRequirementLocals: ['two-hand-staff'],
        supportSplitLocals: halfSplit('two-hand-staff', 'defense-magic'),
        unexpressed: ['「每場 1 次」的使用次數上限'],
      },
    ],
  },
  {
    local: 'blessing-magic',
    sourceRoute: '祝福魔法',
    sourceRequirement: '單手或雙手・法杖',
    masteryLocal: 'blessing-magic',
    activationHand: 'mainHand',
    weaponRequirementLocals: ['one-hand-staff', 'two-hand-staff'],
    attackAwardRuleId: coreAttackAwardRuleId('one-hand-staff-and-attack-magic'),
    supportSplitLocals: halfSplit('one-hand-staff', 'blessing-magic'),
    entries: [
      {
        local: 'l0',
        sourceName: '定息符',
        actionKind: 'cast',
        delayLocal: 'cast',
        target: 'single-ally',
        techniques: ['ward'],
        effectLocals: ['apply-accuracy-up'],
      },
      {
        local: 'l3',
        sourceName: '安神符',
        actionKind: 'cast',
        delayLocal: 'cast',
        target: 'single-ally',
        techniques: ['ward'],
        effectLocals: ['remove-accuracy-down'],
      },
      {
        local: 'basic',
        sourceName: '回春香符',
        actionKind: 'cast',
        delayLocal: 'cast',
        target: 'single-ally',
        techniques: ['ward'],
        effectLocals: ['apply-accuracy-up'],
        unexpressed: ['heal ×0.72'],
      },
      {
        local: 'advanced',
        sourceName: '同調符',
        actionKind: 'cast',
        delayLocal: 'cast',
        target: 'up-to-three-allies',
        techniques: ['ward'],
        effectLocals: ['apply-accuracy-up'],
      },
      {
        local: 'supreme',
        sourceName: '長明祝符',
        actionKind: 'cast',
        delayLocal: 'cast',
        target: 'whole-party',
        techniques: ['ward'],
        effectLocals: ['apply-magic-defense-up'],
        unexpressed: ['heal ×1.05', '「每場 1 次」的使用次數上限'],
      },
    ],
  },
  {
    local: 'curse-magic',
    sourceRoute: '詛咒魔法',
    sourceRequirement: '單手或雙手・法杖',
    masteryLocal: 'curse-magic',
    activationHand: 'mainHand',
    weaponRequirementLocals: ['one-hand-staff', 'two-hand-staff'],
    attackAwardRuleId: coreAttackAwardRuleId('one-hand-staff-and-attack-magic'),
    supportSplitLocals: halfSplit('one-hand-staff', 'curse-magic'),
    entries: [
      {
        local: 'l0',
        sourceName: '鎖紋符',
        actionKind: 'cast',
        delayLocal: 'cast',
        target: 'single-hostile',
        techniques: ['talisman'],
        effectLocals: ['apply-magic-defense-down'],
      },
      {
        local: 'l3',
        sourceName: '破綻符',
        actionKind: 'cast',
        delayLocal: 'cast',
        target: 'single-hostile',
        techniques: ['talisman'],
        effectLocals: ['apply-guard-down'],
      },
      {
        local: 'basic',
        sourceName: '遲行符',
        actionKind: 'cast',
        delayLocal: 'cast',
        target: 'single-hostile',
        techniques: ['talisman'],
        effectLocals: ['ctb-standard'],
      },
      {
        local: 'advanced',
        sourceName: '雙印連符',
        actionKind: 'cast',
        delayLocal: 'cast',
        target: 'single-hostile',
        techniques: ['talisman'],
        effectLocals: ['apply-magic-defense-down', 'apply-guard-down'],
      },
      {
        local: 'supreme',
        sourceName: '封詔符',
        actionKind: 'cast',
        delayLocal: 'cast',
        target: 'up-to-three-hostiles',
        techniques: ['talisman'],
        effectLocals: ['apply-magic-defense-down', 'interrupt-casting'],
        activationHand: 'bothHands',
        weaponRequirementLocals: ['two-hand-staff'],
        supportSplitLocals: halfSplit('two-hand-staff', 'curse-magic'),
        unexpressed: ['「每場 1 次」的使用次數上限'],
      },
    ],
  },
];

// ── 展開 ────────────────────────────────────────────────────────────────────
//
// 一招 → 三筆定義（damage 技能兩筆）：
//   combat-skill.yunhua.<route>-<stage>   戰鬥側
//   skill.yunhua.<route>-<stage>          取得側
//   support-mastery-award-rule.yunhua.<route>-<stage>   只有 fixedSupport 技能有
//
// ⚠ **combat 側與 progression 側是兩個不同的 ID。** 同一個 pack 內 ID 必須唯一，而一筆定義只有
// 一個 kind，所以「一份技能兩個投影」在目前的資料模型下寫不出來。後果見回報的契約缺口第 1 條
// （`combat-reader.ts` 自己的 TODO 也正是這一題）。

const skillLocal = (route: RouteRow, entry: SkillRow): string => `${route.local}-${entry.local}`;

// 設計來源 `skillSeries` 的 `masteryExperienceMode`：resolution 是 damage／counter 就是 'damage'，
// 其餘（none／heal）都是 'fixedSupport'。本檔改以 `unexpressed` 之外的可判斷資料重述：
// 有 attack routing 的招（物理／魔法／樂器傷害與反擊）為 damage，其餘為 fixedSupport。
// 逐招的模式直接由下面這張表決定，避免從中文 kind 字串反推。
const DAMAGE_MODE_SKILL_LOCALS: ReadonlySet<string> = new Set([
  // 環首刀
  'ring-saber-l0', 'ring-saber-l3', 'ring-saber-basic', 'ring-saber-advanced', 'ring-saber-supreme',
  // 鐵骨扇（回風守勢 l3、扇影回護 advanced 為支援）
  'iron-fan-l0', 'iron-fan-basic', 'iron-fan-supreme',
  // 長槍
  'spear-l0', 'spear-l3', 'spear-basic', 'spear-advanced', 'spear-supreme',
  // 偃刀
  'glaive-l0', 'glaive-l3', 'glaive-basic', 'glaive-advanced', 'glaive-supreme',
  // 飛針
  'needle-l0', 'needle-l3', 'needle-basic', 'needle-advanced', 'needle-supreme',
  // 鏈鏢（流星斷讀 basic 為支援）
  'chain-weight-l0', 'chain-weight-l3', 'chain-weight-advanced', 'chain-weight-supreme',
  // 竹弓（凝息瞄準 l3 為支援）
  'bamboo-bow-l0', 'bamboo-bow-basic', 'bamboo-bow-advanced', 'bamboo-bow-supreme',
  // 連珠弩
  'repeating-crossbow-l0', 'repeating-crossbow-l3', 'repeating-crossbow-basic',
  'repeating-crossbow-advanced', 'repeating-crossbow-supreme',
  // 單手盾（舉盾 l0、卸勢 l3、掩護 advanced 為支援）
  'one-hand-shield-basic', 'one-hand-shield-supreme',
  // 雙手盾（立盾 l0、守線 l3、壁勢 basic、不動如嶽 supreme 為支援）
  'two-hand-shield-advanced',
  // 樂器攻擊
  'bamboo-flute-advanced', 'seven-string-advanced',
  // 攻擊魔法五招全為傷害
  'attack-magic-l0', 'attack-magic-l3', 'attack-magic-basic', 'attack-magic-advanced',
  'attack-magic-supreme',
]);

const supportAwardRuleId = (local: string): SupportMasteryAwardRuleId =>
  yunhua.id<SupportMasteryAwardRuleId>(KIND.supportAwardRule, local);

function masterySplits(
  splits: readonly (readonly [string, number])[],
): readonly MasterySplit[] {
  return splits.map(([local, ratio]) => ({ masteryId: masteryId(local), ratio }));
}

function combatSkill(route: RouteRow, entry: SkillRow): Authored<CombatSkillDefinition> {
  const local = skillLocal(route, entry);
  const isDamage = DAMAGE_MODE_SKILL_LOCALS.has(local);
  const requirementLocals = entry.weaponRequirementLocals ?? route.weaponRequirementLocals;
  return {
    kind: KIND.combatSkill,
    id: yunhua.id<SkillDefinitionId>(KIND.combatSkill, local),
    display: { nameRef: { key: `text.combat-skill.yunhua.${local}.name` } },
    // 這 80 招都是角色學得會的。指向**同一個 local 名**的 progression 技能（門檻與取得方式
    // 住在那一筆）——兩張表是 1:1，所以連結由同一個 `skillLocal(route, entry)` 產生，
    // 不是各自手打一次字串。
    acquisition: {
      kind: 'learned',
      knowledgeSkillId: yunhua.id<SkillDefinitionId>(KIND.skill, local),
    },
    activationHand: entry.activationHand ?? route.activationHand,
    weaponRequirementIds: requirementLocals.map(weaponRequirementId),
    actionKind: entry.actionKind,
    masteryExperienceMode: isDamage ? 'damage' : 'fixedSupport',
    ...(isDamage
      ? { attackMasteryAwardRuleId: entry.attackAwardRuleId ?? route.attackAwardRuleId }
      : { supportMasteryAwardRuleId: supportAwardRuleId(local) }),
    techniqueIds: entry.techniques.map(techniqueId),
    targeting: {
      targetResolverId: targetResolverId(entry.target),
      // 魔法/治療招式 +6 額外距離；其餘省略（走武器射程）。
      ...(extraReachCellsFor(entry.actionKind) === undefined
        ? {}
        : { extraReachCells: extraReachCellsFor(entry.actionKind) }),
    },
    actionDelayRuleId: delayRuleId(entry.delayLocal),
    effectIds: [...(entry.damage ? Array.from({ length: entry.damage.hits }, () => yunhua.id<CombatEffectDefinitionId>('combat-effect', `${local}-damage`)) : []), ...entry.effectLocals.map(effectId)],
    ...(entry.counterCondition === undefined
      ? {}
      : {
          counterStance: {
            conditionResolverId: counterConditionResolverId(entry.counterCondition),
            // 反擊**解析後**支付的延遲。core 已有專屬一筆（`action-delay-rule.core.counter`），
            // 與建立架勢那一次付的 `stance` 是兩個不同的規則——combat_skill_effect_spec.md
            // 明列「預先花行動」與「反擊後的行動延遲代價」是兩項獨立的平衡來源。
            counterDelayRuleId: COUNTER_DELAY_RULE_ID,
          },
        }),
    // 設計來源沒有任何生命／魔力消耗欄位或數字（`balanceModel` 只給魔力上限公式，沒有招式成本）。
    // 空清單是「這份資料沒有宣告成本」的唯一寫法；不自行發明一個「看起來合理」的耗魔量。
    resourceCosts: [],
  };
}

function progressionSkill(route: RouteRow, entry: SkillRow): Authored<SkillDefinition> {
  const stage = STAGES[entry.local];
  return {
    kind: KIND.skill,
    id: yunhua.id<SkillDefinitionId>(KIND.skill, skillLocal(route, entry)),
    // §8.1 的門檻只有一個熟練度（路線自己的）。符術的法杖需求是**武器需求**，不是熟練度門檻，
    // 所以不出現在這裡（§8.4：「必須同時列出所需魔法 Mastery，並要求單手法杖、雙手法杖…」——
    // 前半是 mastery、後半是 requirement）。
    requiredMasteries: [{ masteryId: masteryId(route.masteryLocal), minLevel: stage.minMasteryLevel }],
    acquisition: stage.acquisition,
    // `combatMetadata` 刻意不填：它與 combat 側的 `masteryExperienceMode` +
    // `attack/supportMasteryAwardRuleId` 是同一組事實的第二份拷貝，而 runtime 只讀 combat 那一側
    // （`src/modules/combat/system.ts` 送出事件時取 skillView 的欄位；`SkillDefinition.combatMetadata`
    // 目前沒有任何消費者）。填了就是兩份會各自漂移的真相。列入回報的契約缺口。
  };
}

function supportAwardRule(
  route: RouteRow,
  entry: SkillRow,
): Authored<SupportMasteryAwardRuleDefinition> {
  const local = skillLocal(route, entry);
  return {
    kind: KIND.supportAwardRule,
    id: supportAwardRuleId(local),
    // 設計來源 `supportMxpByStage` 的同 index 值（也是 `balanceModel.experience` 最後一列的
    // 「48／48／72／120／200 MXP，依 L0／L3／基礎書／高級書／極品的技能層級」）。
    fixedExperiencePerUse: STAGES[entry.local].supportMxp,
    masterySplits: masterySplits(entry.supportSplitLocals ?? route.supportSplitLocals),
  };
}

const ALL_ENTRIES: readonly Readonly<{ route: RouteRow; entry: SkillRow }>[] = ROUTES.flatMap(
  (route) => route.entries.map((entry) => ({ route, entry })),
);

const combatSkills = ALL_ENTRIES.map(({ route, entry }) => combatSkill(route, entry));
const progressionSkills = ALL_ENTRIES.map(({ route, entry }) => progressionSkill(route, entry));
const supportAwardRules = ALL_ENTRIES.filter(
  ({ route, entry }) => !DAMAGE_MODE_SKILL_LOCALS.has(skillLocal(route, entry)),
).map(({ route, entry }) => supportAwardRule(route, entry));

// ── 交付清單（供整合者，不進內容產物）────────────────────────────────────────

// 本 domain 引用到的 Resolver。pack 的 `requiredResolverIds` 必須包含它們，Bootstrap 才會在啟動時
// 擋下「用到未註冊 Resolver」；漏了會讓遊戲一路載入成功，直到玩家按下那一招。
export const YUNHUA_SKILL_REQUIRED_RESOLVER_IDS: readonly ResolverId[] = [
  ...(Object.keys(TARGET_SHAPES) as TargetLocal[]).map(targetResolverId),
  ...(Object.keys(COUNTER_CONDITIONS) as CounterConditionLocal[]).map(counterConditionResolverId),
];

// 本 domain 用到的 kind，供 pack 的 `declaredKinds` 對帳。
export const YUNHUA_SKILL_DECLARED_KINDS: readonly string[] = [
  'combat-effect',
  'combat-damage-rule',
  KIND.combatSkill,
  KIND.skill,
  KIND.attackAwardRule,
  KIND.supportAwardRule,
];

// 「設計來源要求、但契約或 core 現有定義表達不出來」的逐招清單。
// 這不是待辦註解，而是可清點的資料：`Object.keys(...).length` 就是還沒閉合的招數。
export const YUNHUA_SKILL_UNEXPRESSED: Readonly<Record<string, readonly string[]>> =
  Object.fromEntries(
    ALL_ENTRIES.filter(({ entry }) => entry.unexpressed !== undefined && entry.unexpressed.length > 0).map(({ route, entry }) => [
      `${skillLocal(route, entry)}（${entry.sourceName}）`,
      entry.unexpressed ?? [],
    ]),
  );


const skillDamageDefinitions = ALL_ENTRIES.flatMap(({ route, entry }) => {
  if (!entry.damage) return [];
  const local = skillLocal(route, entry);
  const damageId = yunhua.id<import('../../src/contracts/core').CombatDamageRuleId>('combat-damage-rule', local);
  const rule: Authored<import('../../src/contracts/combat').CombatDamageRuleDefinition> = {
    kind: 'combat-damage-rule', id: damageId, damageChannel: entry.damage.channel,
    powerResolverId: { physical: RESOLVER.damagePhysical, magic: RESOLVER.damageMagic, instrument: RESOLVER.damageInstrument }[entry.damage.channel],
    mitigationSecondaryId: core.id<import('../../src/contracts/core').SecondaryAttributeId>('secondary-attribute', `${entry.damage.channel === 'physical' ? 'general' : entry.damage.channel}-damage-reduction`),
    powerMultiplier: entry.damage.multiplier, canBeBlocked: entry.damage.channel === 'physical',
  };
  const effect: Authored<import('../../src/contracts/combat').CombatEffectDefinition> = {
    kind: 'combat-effect', id: yunhua.id<CombatEffectDefinitionId>('combat-effect', `${local}-damage`),
    operation: { kind: 'dealDamage', damageRuleId: damageId },
  };
  return [rule, effect];
});

export const yunhuaSkillsDomain: AuthoredDomain = {
  domain: 'skills',
  texts: ALL_ENTRIES.map(({ route, entry }) => ({ key: `text.combat-skill.yunhua.${skillLocal(route, entry)}.name`,
    name: { 'zh-Hant': entry.sourceName, en: `${route.local.split('-').map(x => x[0]!.toUpperCase() + x.slice(1)).join(' ')} · ${entry.local.toUpperCase()}` } })),
  definitions: [
    ...combatSkills,
    ...skillDamageDefinitions,
    ...progressionSkills,
    ...shieldAttackAwardRules,
    ...supportAwardRules,
  ],
};

// STAGE_ORDER 是取得階層的正式順序（`acquisitionStages` 的 index）。目前沒有欄位吃它——
// 但它是 `supportMxpByStage` 與 `minMasteryLevel` 的對齊依據，留著讓下一個人看得到那個對齊。
export { STAGE_ORDER };
