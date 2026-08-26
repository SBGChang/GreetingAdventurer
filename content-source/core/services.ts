// content-source/core/services.ts
// 三個**純服務**的規則：statistics（衍生能力）、combat-power（戰力聚合）、gathering（採集）。
// **文化無關**——這三個服務都是「同一份公式套用到四國」的東西：
//   * 副屬性清單與它們走哪些主屬，是 GDD「五、成長系統」的全域定義，不是某一國的設定。
//   * 戰力規則若因國而異，四國的戰力就不可比較。**這一步是推論，不是引文**：CP §1 明文禁止的是
//     「另寫任務戰力／NPC 換裝分數／掃蕩戰力公式」（依呼叫端分岔），§7.7 明文禁止的是
//     「不可比較的陣營專用倍率」。把「陣營」讀成「文化 pack」是本檔的裁決，待整合者確認。
//   * 採集的「成果歸向政策」是 19_gathering_service.md §5／§6.2 對第一版全流程的固定裁決。
// 反之，凡是需要引用**具體物品／技能／怪物 ID** 的採集規則都不在這裡（見檔尾說明）。
//
// ── 來源（逐筆對照見各段註解；縮寫如下）────────────────────────────────────────
//   GDD      = docs/00_core/game_design_document.md「五、成長系統」（副屬性／副屬性公式／
//              副屬性對應主屬性）與「九、戰鬥系統」「六、角色生命週期」
//   DS       = docs/00_core/architecture/16_derived_statistics.md
//   CP       = docs/00_core/architecture/22_combat_power_service.md
//   GA       = docs/00_core/architecture/19_gathering_service.md
//   BM       = docs/03_content/yunhua/yunhua_content.data.mjs 的 `balanceModel`（只讀不改）。
//              它放在雲華目錄下，但「跨文化」是它自己與其他三國宣告的，不是本檔的假設：
//              vildun_content.data.mjs 的 balanceModel.scope 寫「沿用雲華已確立的**跨文化** HP、
//              主屬、CTB、命中、減傷、控制抗性與 Mastery 基準；文化只改變內容組合與合法效果」；
//              aurelien_content.md／safir_content.md §「命名與共用」也寫「數值公式、CTB、命中、
//              減傷與 Mastery 規則沿用共用平衡模型」。本檔只用到這些被點名為跨文化的那幾條。
//
// **未採用**：docs/02_systems/equipment_balance.md。該檔首行自述「歷史草稿，暫不作為現行規格或
// 實作依據……本文件中的數值範例……均不應直接沿用」，所以本檔不引用它的任何數字，只沿用它與
// GDD 一致的結構觀念（「裝備係數只是一層；副屬性只再乘持握係數與對應熟練度係數」）。
//
// 凡設計文件沒有給的數值，一律標「**第一版方案（待討論）**」並寫出設計理由。它們全部落在
// Definition 的欄位裡（不是程式常數），所以調整平衡只需改這個檔。

import type {
  AgeModifierRuleDefinition,
  CarryCapacityRuleDefinition,
  GripRuleDefinition,
  SecondaryAttributeRuleDefinition,
  StatisticsRuleDefinition,
} from '../../src/contracts/statistics';
import type {
  CombatPowerFeatureId,
  CombatPowerFeatureRuleDefinition,
  CombatPowerFeatureRuleId,
  CombatPowerFeatureSource,
  CombatPowerFeasibilityRuleDefinition,
  CombatPowerFeasibilityRuleId,
  CombatPowerRiskBandThreshold,
  CombatPowerRuleDefinition,
  CombatPowerRuleId,
} from '../../src/contracts/combat-power';
import type { GatheringDestinationPolicyDefinition } from '../../src/contracts/gathering';
import type { EquipmentCoefficientChannelId } from '../../src/contracts/inventory';
import type { PrimaryAttributeId } from '../../src/contracts/progression';
import type {
  AgeModifierRuleId,
  CarryCapacityRuleId,
  GatheringDestinationPolicyId,
  GripRuleId,
  ResolverId,
  SecondaryAttributeId,
  StatisticsRuleId,
} from '../../src/contracts/core';
import { cultureIds, type Authored, type AuthoredDomain } from '../authoring';

const core = cultureIds('core');

// ── Resolver ID ─────────────────────────────────────────────────────────────
//
// Definition 只能指名「用哪一條 Resolver」；那條 Resolver 的**調校量**（曲線點、係數、門檻）
// 住在它自己的 params 定義裡，而 params 的 Definition kind（`app/content/resolvers.ts` 的
// `weighted-product-params` / `logistic-roll-params`）目前**沒有登記進 definition-kinds.ts**，
// 因此本輪還寫不出來——見檔尾「交接」段與回報的「契約缺口」。
//
// 這不是「先給預設值」：pack 的 `requiredResolverIds` 會列出這些 ID，Bootstrap 必須確認它們全部
// 已註冊才啟動（authoring.ts 的說明、規範 §11）。少一個就是世界建不起來，不是靜默退化。
//
// 命名沿用既有慣例 `resolver:<服務>.<角色>`。字串組合是純資料工具，不是規則邏輯。
function resolverId(local: string): ResolverId {
  return `resolver:${local}` as ResolverId;
}

const RESOLVERS = {
  // ── statistics ──
  // 年齡修正（DS §7 不變量 7：角色面板與 Combat 共用同一條）。params 要表達 GDD「年紀與屬性」：
  // 1～18 歲持續上升、25 歲後逐年下降；例外「樂器減傷隨年紀增加」由 instrument-mitigation
  // 那條 final resolver 處理，不在這裡。
  ageModifier: resolverId('statistics.age-modifier'),
  // 聲望貢獻。GDD「聲望」與 DS §7 不變量 5：聲望**不併入魅力**——服務對回傳帶 charisma 的
  // delta 會直接失敗，所以這條 Resolver 的 params 不得產生 charisma 項。
  reputationContribution: resolverId('statistics.reputation-contribution'),
  // 對應熟練度係數。params = BM `masteryMultipliers`（Lv.0～10：1.00／1.03／1.07／1.12／1.18／
  // 1.25／1.33／1.42／1.52／1.63／1.75），輸入是裝備宣告的 relatedMasteryIds 的等級。
  masteryCoefficient: resolverId('statistics.mastery-coefficient'),
  // 副屬最終值。一個 resolverId = 一組 params（Port 只以 resolverId 定址，拿不到 paramsDefId），
  // 所以「幾種最終形狀」就要幾個 ID。
  finalIdentity: resolverId('statistics.final.identity'), // 分數直出（命中／傷害／預判／格擋分數）
  finalMitigation: resolverId('statistics.final.mitigation'), // BM：safeRaw / (safeRaw + 120)
  finalBlockAbsorption: resolverId('statistics.final.block-absorption'), // BM：safeRaw / (safeRaw + 80)
  finalMaxHealth: resolverId('statistics.final.max-health'), // BM：200 + 肌 × 20（＋裝備 safeRaw）
  finalMaxMana: resolverId('statistics.final.max-mana'), // BM：120 + 智 × 14（＋裝備 safeRaw）
  finalInstrumentMitigation: resolverId('statistics.final.instrument-mitigation'), // 裝備重量＋年紀

  // ── combat-power ──
  // 加權後的 Feature 量 → 單位戰力（CP §2.2）。第一版形狀是相加。
  unitAggregation: resolverId('combat-power.unit-aggregation'),
  // 站位 + 成員戰力加總 → 陣形係數（CP §3.2「先加總成員，再套用同一 Formation Resolver」）。
  teamFormation: resolverId('combat-power.team-formation'),
  // (隊伍戰力, 對抗戰力) → 期望成功率 0..1（CP §4）。
  expectedSuccess: resolverId('combat-power.expected-success'),
} as const;

// ══════════════════════════════════════════════════════════════════════════
// statistics
// ══════════════════════════════════════════════════════════════════════════

// ── 裝備係數通道 ────────────────────────────────────────────────────────────
//
// 通道是「裝備的某一列係數餵給哪個副屬」的唯一接點：裝備側宣告
// `secondaryAttributeCoefficients: [{ channelId, coefficient }]`，副屬側宣告
// `equipmentCoefficientChannelIds`。兩邊對不上，那件裝備就對那個副屬沒有貢獻——而且**不會報錯**
// （加總單位元 0 是合法的「這把劍不影響魔法減傷」）。
//
// 所以通道 ID 是**跨 domain 契約**：inventory 的裝備內容必須用這裡的同一組 ID。通道自己沒有
// Definition kind（`EquipmentCoefficientChannelId` 只是 ID 家族），因此沒有任何載入期檢查會抓到
// 打錯字——這一點列入回報的契約缺口。
//
// 一副屬一通道（而不是「命中／預判共用一條」）：通道分得細，作者才表達得出「這把武器命中高但
// 預判平庸」；要讓兩個副屬吃同一列係數，只要在兩邊都列同一個通道即可，反過來拆不開。
function channel(local: string): EquipmentCoefficientChannelId {
  return core.id<EquipmentCoefficientChannelId>('equipment-coefficient-channel', local);
}

// ── 副屬性 ──────────────────────────────────────────────────────────────────
//
// 清單來自 GDD「副屬性」（物理系 7、魔法系 3、樂器系 2）＋ DS §2 要求第一版必須能定義的
// 「最大生命、最大魔力」。**攜帶重量上限不在這裡**：DS §7 不變量 9 規定它只由 Carry Capacity
// Rule 與有效肌力決定，契約也把它做成 `carryingCapacity` 而不是副屬之一。
//
// `primaryCoefficients` 的語意是**方向向量**（GDD 副屬性公式的「武器/防具權重配方」那一項裡，
// 屬於「這個副屬走哪些主屬、相對權重多少」的部分）。絕對量級由裝備的
// `primaryAttributeCoefficients` 提供，兩者相乘。
//
// 為什麼方向必須放在這裡而不是裝備上：裝備契約只有**一份** `primaryAttributeCoefficients`，
// 對它宣告的所有通道共用。所以同一把武器的「物理傷害走肌＋協」與「命中走反＋協＋智」這件事，
// 只能由副屬規則的方向向量表達。（這也是一個契約缺口，見回報。）
//
// 有比例可引的照文件比例，沒有的一律標第一版方案。

type SecondaryRow = Readonly<{
  local: string;
  // GDD「副屬性對應主屬性」的主屬集合 + 相對權重。
  primaries: Partial<Record<PrimaryAttributeId, number>>;
  // 吃哪些裝備通道。空陣列＝這個副屬不由裝備係數驅動（不是「忘了填」）。
  channelLocals: readonly string[];
  // 是否再乘「對應熟練度係數」（GDD 副屬性公式的第三個乘項）。
  masteryStage: boolean;
  finalResolverId: ResolverId;
  // 這個副屬在 combat-power 裡的權重（見下面 combat-power 段的校準說明）。
  // 放同一張表是為了讓「副屬清單」與「戰力 Feature 清單」不可能漂移——CP §7.1 要求 Feature
  // 引用的副屬都必須存在。
  //
  // 省略＝這個副屬**不**自己成為一個 secondaryAttribute Feature。目前只有生命／魔力上限省略：
  // 它們在 Snapshot 裡同時是 `secondaryAttributes[...]` 與 `maxHealth`／`maxMana`（同一個數字，
  // 見 Calculator 的 requireComputedSecondary），而 CP §2.2 為它們準備了專用的 `maximumResource`
  // 來源。兩邊都給就是同一個值計兩次。
  combatPowerCoefficient?: number;
}>;

const SECONDARY_ROWS: readonly SecondaryRow[] = [
  // 物理傷害：GDD 肌＋協。相對權重取 BM「怪物物理傷害基礎 = 肌 × 1.20 + 協 × 0.45」
  // 正規化為 肌 1.00 / 協 0.375——BM 是現行平衡基準，且該式明說人類快速模擬共用同一 Profile。
  {
    local: 'physical-damage',
    primaries: { muscle: 1, coordination: 0.375 },
    channelLocals: ['physical-damage'],
    masteryStage: true,
    finalResolverId: RESOLVERS.finalIdentity,
    combatPowerCoefficient: 0.05,
  },
  // 魔法傷害：GDD 智（只有智）。BM 的怪物魔法傷害另含 協 × 0.20，但 GDD 的對應表是副屬方向的
  // 權威，此處以 GDD 為準；兩者差異列入回報。
  {
    local: 'magic-damage',
    primaries: { intelligence: 1 },
    channelLocals: ['magic-damage'],
    masteryStage: true,
    finalResolverId: RESOLVERS.finalIdentity,
    combatPowerCoefficient: 0.05,
  },
  // 樂器傷害：GDD 的副屬清單有它，但「副屬性對應主屬性」表沒有它的列。BM 只說「樂器傷害用智、
  // 協、魅」。相對權重取 GDD「熟練度→主屬性成長配比」裡兩種樂器熟練度的配比方向
  // （管樂器 智2/魅3、弦樂器 智1/協2/魅3 → 魅為主軸）：魅 1.00 / 智 0.60 / 協 0.50。
  // **第一版方案（待討論）**——文件只給了主屬集合，沒給權重。
  {
    local: 'instrument-damage',
    primaries: { intelligence: 0.6, coordination: 0.5, charisma: 1 },
    channelLocals: ['instrument-damage'],
    masteryStage: true,
    finalResolverId: RESOLVERS.finalIdentity,
    combatPowerCoefficient: 0.05,
  },
  // 命中：GDD 反＋協＋智。相對權重取 BM「怪物命中分數 = 反 × 0.40 + 協 × 0.55 + 智 × 0.10」
  // 正規化為 協 1.00 / 反 0.73 / 智 0.18。
  {
    local: 'accuracy',
    primaries: { reaction: 0.73, coordination: 1, intelligence: 0.18 },
    channelLocals: ['accuracy'],
    masteryStage: true,
    finalResolverId: RESOLVERS.finalIdentity,
    combatPowerCoefficient: 0.27,
  },
  // 魔法命中：GDD 的副屬清單有它，對應表沒有。BM 的命中式註記「只有魔法與遠距技能使用智通道」，
  // 所以這裡把智提為主軸、反／協沿用 BM 的 0.40／0.55。**第一版方案（待討論）**。
  {
    local: 'magic-accuracy',
    primaries: { intelligence: 1, reaction: 0.4, coordination: 0.55 },
    channelLocals: ['magic-accuracy'],
    masteryStage: true,
    finalResolverId: RESOLVERS.finalIdentity,
    combatPowerCoefficient: 0.13,
  },
  // 迴避：GDD 反＋協＋智，與命中同一組主屬。沿用命中的權重向量。
  // **第一版方案（待討論）**——文件沒給迴避自己的權重。
  {
    local: 'evasion',
    primaries: { reaction: 0.73, coordination: 1, intelligence: 0.18 },
    channelLocals: ['evasion'],
    masteryStage: true,
    finalResolverId: RESOLVERS.finalIdentity,
    combatPowerCoefficient: 0.27,
  },
  // 預判：GDD 智＋反。無權重來源，兩項等重。**第一版方案（待討論）**。
  {
    local: 'anticipation',
    primaries: { intelligence: 1, reaction: 1 },
    channelLocals: ['anticipation'],
    masteryStage: true,
    finalResolverId: RESOLVERS.finalIdentity,
    combatPowerCoefficient: 0.13,
  },
  // 格擋成功率：GDD 反＋協。BM「格擋成功率 = clamp(0, 75, 格擋分數 × 0.25)」——轉成機率是
  // combat 的事，本服務輸出的是**分數**，所以 final 用 identity。權重兩項等重為第一版方案。
  {
    local: 'block-chance',
    primaries: { reaction: 1, coordination: 1 },
    channelLocals: ['block-chance'],
    masteryStage: true,
    finalResolverId: RESOLVERS.finalIdentity,
    combatPowerCoefficient: 0.17,
  },
  // 格擋吸收（GDD 副屬清單寫「格擋減傷」，對應表寫「格擋吸收」，同一項）：GDD 肌。
  // BM：safeRaw / (safeRaw + 80)，只在成功格擋時生效。
  {
    local: 'block-absorption',
    primaries: { muscle: 1 },
    channelLocals: ['block-absorption'],
    masteryStage: true,
    finalResolverId: RESOLVERS.finalBlockAbsorption,
    combatPowerCoefficient: 62.5,
  },
  // 一般減傷：GDD 肌＋防具（防具＝裝備通道）。BM：safeRaw / (safeRaw + 120)。
  {
    local: 'general-damage-reduction',
    primaries: { muscle: 1 },
    channelLocals: ['general-mitigation'],
    masteryStage: true,
    finalResolverId: RESOLVERS.finalMitigation,
    combatPowerCoefficient: 154,
  },
  // 魔法減傷：GDD 智＋魔法熟練度＋裝備——三項在契約裡分別是 primaryCoefficients、
  // masteryCoefficientResolverId、equipmentCoefficientChannelIds。BM 與一般減傷同一條遞減曲線。
  {
    local: 'magic-damage-reduction',
    primaries: { intelligence: 1 },
    channelLocals: ['magic-mitigation'],
    masteryStage: true,
    finalResolverId: RESOLVERS.finalMitigation,
    combatPowerCoefficient: 123,
  },
  // 樂器減傷：GDD「頭盔重量＋年紀」——**沒有主屬項、也沒有裝備係數項**。
  // DS §4 明說這條走專用 Secondary Rule 讀裝備重量與年齡，而契約把重量與 ageDays 直接餵給
  // finalResolver，所以整條公式住在那條 Resolver 的 params 裡：primaries 與 channels 都是空的
  // （＝「這個副屬不走這兩條管道」，不是漏填）。
  // 注意：契約給的是**全身裝備總重**，GDD 要的是頭盔重量——差異列入回報的契約缺口。
  {
    local: 'instrument-damage-reduction',
    primaries: {},
    channelLocals: [],
    masteryStage: false,
    finalResolverId: RESOLVERS.finalInstrumentMitigation,
    combatPowerCoefficient: 31,
  },
  // 生命上限：GDD 對應表「生命值＝肌力」；BM「生命上限 = 200 + 肌 × 20」。基礎項 200 與每點 20
  // 是 finalResolver 的 params；這裡的通道讓裝備還能再加一份（safeRaw 進同一條 params）。
  // 戰力權重在 RESOURCE_FEATURE_ROWS（`maximumResource`），這裡不重複給。
  {
    local: 'max-health',
    primaries: { muscle: 1 },
    channelLocals: ['max-health'],
    masteryStage: true,
    finalResolverId: RESOLVERS.finalMaxHealth,
  },
  // 魔力上限：BM「魔力上限 = 120 + 智 × 14」。GDD 的對應表沒有這一列，主屬取智（與公式一致）。
  {
    local: 'max-mana',
    primaries: { intelligence: 1 },
    channelLocals: ['max-mana'],
    masteryStage: true,
    finalResolverId: RESOLVERS.finalMaxMana,
  },
];

const SECONDARY_IDS: Readonly<Record<string, SecondaryAttributeId>> = Object.fromEntries(
  SECONDARY_ROWS.map((row) => [row.local, core.id<SecondaryAttributeId>('secondary-attribute', row.local)]),
);

function secondaryId(local: string): SecondaryAttributeId {
  return core.id<SecondaryAttributeId>('secondary-attribute', local);
}

function secondaryAttributeRule(row: SecondaryRow): Authored<SecondaryAttributeRuleDefinition> {
  const id = secondaryId(row.local);
  return {
    kind: 'secondary-attribute',
    id,
    output: id,
    primaryCoefficients: row.primaries,
    equipmentCoefficientChannelIds: row.channelLocals.map(channel),
    // 選填欄位：沒有熟練度階段的副屬就**不寫**這個欄位（少一個乘項），不是填一個等於 1 的係數。
    ...(row.masteryStage ? { masteryCoefficientResolverId: RESOLVERS.masteryCoefficient } : {}),
    finalResolverId: row.finalResolverId,
  };
}

// ── 持握規則 ────────────────────────────────────────────────────────────────
//
// GDD「副屬性公式／持握係數」：單手 1.0、雙手 1.0、雙持左手 0.5、雙持右手 0.35，雙持總輸出＝
// 兩手相加。契約的欄位是**主手／副手**（`CharacterEquipmentLoadoutView` 只表達得出 mainHand /
// offHand），依契約註解的裁決「0.5 / 0.35 依大小對應主手 / 副手」。
const GRIP_RULE_ID = core.id<GripRuleId>('grip-rule', 'shared');

const gripRule: Authored<GripRuleDefinition> = {
  kind: 'grip-rule',
  id: GRIP_RULE_ID,
  singleHandMultiplier: 1,
  twoHandMultiplier: 1,
  dualWieldMainHandMultiplier: 0.5,
  dualWieldOffHandMultiplier: 0.35,
};

// ── 攜帶重量上限 ────────────────────────────────────────────────────────────
//
// DS §7 不變量 9：只由本規則與有效肌力決定。**兩個數值都是第一版方案（待討論）**——GDD 與 BM
// 都沒有負重公式，但 inventory 的負重驗證已經在用 `deps.getCarryCapacity`，沒有這筆資料負重就
// 算不出來（缺這筆＝該功能不能啟用，不是「先給個大數字」）。
//
// 尺度理由：物品重量的量級由裝備 `unitWeight` 決定（一把單手刀約 6）。基礎 30 + 肌 × 1.5 讓
// 起步角色（肌 25～40，BM Tier I）有 67～90、滿肌（100）有 180，約等於 30 把單手刀或一套重甲
// 加補品與素材——夠背完一趟地牢，但塞不進第二套完整配裝。
const CARRY_CAPACITY_RULE_ID = core.id<CarryCapacityRuleId>('carry-capacity-rule', 'shared');

const carryCapacityRule: Authored<CarryCapacityRuleDefinition> = {
  kind: 'carry-capacity-rule',
  id: CARRY_CAPACITY_RULE_ID,
  baseWeightCapacity: 30,
  strengthCapacityPerPoint: 1.5,
};

// ── 年齡修正 ────────────────────────────────────────────────────────────────
//
// 契約只有一個欄位：指名 Resolver。老化曲線（GDD「年紀與屬性」：1～18 歲上升、25 歲後逐年下降）
// 整條住在那條 Resolver 的 params 裡，因此角色面板與 Combat 必然共用同一條（DS §7 不變量 7）。
const AGE_MODIFIER_RULE_ID = core.id<AgeModifierRuleId>('age-modifier-rule', 'shared');

const ageModifierRule: Authored<AgeModifierRuleDefinition> = {
  kind: 'age-modifier-rule',
  id: AGE_MODIFIER_RULE_ID,
  resolverId: RESOLVERS.ageModifier,
};

// ── 統計規則（把上面全部綁成一份） ──────────────────────────────────────────
const STATISTICS_RULE_ID = core.id<StatisticsRuleId>('statistics-rule', 'shared');

const statisticsRule: Authored<StatisticsRuleDefinition> = {
  kind: 'statistics-rule',
  id: STATISTICS_RULE_ID,
  // GDD「五項主屬各自上限為 100」；契約把它做成字面型別 100（結構不變量，仍由資料重述一次）。
  primaryAttributeCap: 100,
  secondaryRuleIds: SECONDARY_ROWS.map((row) => secondaryId(row.local)),
  // maxHealth／maxMana 是 Snapshot 的獨立欄位，值則是副屬之一；這兩個欄位就是那條對照
  // （沒有它們，Calculator 只能在程式裡寫死 'secondary.max-health'）。
  maxHealthSecondaryId: secondaryId('max-health'),
  maxManaSecondaryId: secondaryId('max-mana'),
  gripRuleId: GRIP_RULE_ID,
  carryCapacityRuleId: CARRY_CAPACITY_RULE_ID,
  ageModifierRuleId: AGE_MODIFIER_RULE_ID,
  reputationContributionRuleId: RESOLVERS.reputationContribution,
};

// ══════════════════════════════════════════════════════════════════════════
// combat-power
// ══════════════════════════════════════════════════════════════════════════

// ── Feature 權重的校準 ──────────────────────────────────────────────────────
//
// **整段是第一版方案（待討論）**：CP 只說「coefficient、Feature 組合與 Resolver 都在內容裡」，
// 沒有給任何數字。但少了它戰力就算不出來，所以這裡給一份**可解釋、可重算**的第一版。
//
// 校準方法：每個 Feature 的 coefficient = 目標占比 × 1000 ÷ 該副屬在 BM Tier V 的天花板值。
// 於是一名「各項都頂到 Tier V 天花板」的角色，14 個統計類 Feature 合計約 1000 點；實際角色只會
// 頂到自己那一路（物理或魔法或樂器），所以真實戰力遠低於 1000，而不同流派彼此可比。
//
// 用到的天花板。**只有最後一項是 BM 直接算得出來的；其餘四項都是本檔選的切點**（下面逐項標明
// 哪一半是引文、哪一半是裁決）。四項都不引用 equipment_balance。
//   * 物理／魔法傷害分數 2400 —— **第一版方案（待討論）**。BM primaryBrackets Tier V 寫的是
//     「雙手／雙手法杖主力單體約 1,900～2,500」，而那一欄是**技能傷害輸出**（BM 傷害公式已乘過
//     Mastery 與技能威力），不是本 Feature 讀的**傷害分數**。所以 2400 既不是那個區間的上緣
//     （上緣是 2500），也不是同一個量——它只是「拿 Tier V 輸出帶當量級錨點，取一個整數」。
//     真正的傷害分數天花板要等裝備係數表定案才算得出來，屆時這一項必須重算。
//   * 樂器傷害分數 1200 —— **第一版方案（待討論）**。樂器是輔助路線，取主武器的一半。
//   * 命中／迴避／預判／格擋分數 300 —— **第一版方案（待討論）**，但 BM 給了一個硬邊界：
//     「格擋成功率 = clamp(0,75, 格擋分數 × 0.25)」在 300 分**正好**推到夾限 75%（引文＋算術）。
//     命中側只是同族沿用，並**不**剛好跨滿 15～95：BM「命中率 = clamp(15,95, 70 + (命中−迴避)
//     × 0.25)」的區間寬 80，跨滿需要差 320 分，300 分只跨 75。
//   * 一般／魔法／樂器減傷 0.65、格擋吸收 0.80 —— **第一版方案（待討論）**。曲線是引文
//     （BM「safeRaw/(safeRaw+120)」「safeRaw/(safeRaw+80)」），代入也是算術（raw ≈ 223 → 0.65；
//     raw ≈ 320 → 0.80），但**切在哪裡是本檔選的**：BM 自己的註記只列到 180 → 約 60% 與
//     240 → 約 75%，0.65／0.80 都在它列舉的點之外。
//   * 生命 2200、魔力 1520 —— **引文＋算術**：BM「200 + 肌 × 20」「120 + 智 × 14」在主屬 100
//     （GDD「五項主屬各自上限為 100」）時的值。這一項不含裁決。
//
// 目標占比（第一版方案）：攻擊 30%（物理 12 / 魔法 12 / 樂器 6）、命中族 16%（命中 8 / 魔法命中 4
// / 預判 4）、防禦族 38%（迴避 8 / 格擋成功 5 / 格擋吸收 5 / 一般減傷 10 / 魔法減傷 8 / 樂器減傷 2）、
// 資源 16%（生命 12 / 魔力 4）＝ 100%。進攻面（攻擊＋命中）46% 對生存面（防禦＋資源）54%，
// 大致對半——在「掃蕩以固定隊伍戰力對敵方戰力擲骰」（GDD 九、戰鬥系統）下最不偏袒任一流派。
// 實際係數是「占比 × 1000 ÷ 天花板」四捨五入到可讀位數，所以合計為 1002 而非恰好 1000。
//
// 每個副屬的 coefficient 就寫在上面 SECONDARY_ROWS 的 combatPowerCoefficient 欄——同一張表，
// 所以新增副屬時那一欄就在眼前。但它是**選填**（生命／魔力上限必須省略，見該欄註解），
// 所以「忘了填」在型別上仍然合法，只會安靜地少一個 Feature。這一點沒有編譯期防線，
// 唯一的防線是本檔的一致性自檢（Feature 天花板合計應在 1000 附近）。

const COMBAT_POWER_RULE_ID = core.id<CombatPowerRuleId>('combat-power-rule', 'shared');
const FEASIBILITY_RULE_ID = core.id<CombatPowerFeasibilityRuleId>(
  'combat-power-feasibility-rule',
  'shared',
);

type FeatureRow = Readonly<{
  local: string;
  source: CombatPowerFeatureSource;
  coefficient: number;
}>;

// 副屬類 Feature：逐筆對應 SECONDARY_ROWS 裡**給了**戰力權重的那些（生命／魔力上限走下面的
// maximumResource，不在此重複計分）。
const SECONDARY_FEATURE_ROWS: readonly FeatureRow[] = SECONDARY_ROWS.flatMap((row) =>
  row.combatPowerCoefficient === undefined
    ? []
    : [
        {
          local: row.local,
          source: { kind: 'secondaryAttribute', attributeId: secondaryId(row.local) },
          coefficient: row.combatPowerCoefficient,
        } satisfies FeatureRow,
      ],
);

// 資源類 Feature：CP §2.2 的 `maximumResource`。
//
// 為什麼不另外做 primaryAttribute 類 Feature：五項主屬已經全部經由副屬計入（每個副屬都是主屬的
// 線性組合），再直接加一次就是重複計分。GDD「敵人六屬性卡」顯示主屬是為了讓玩家看得懂敵人，
// 不是第二條計分管道。魅力目前沒有任何副屬引用（樂器傷害除外），所以它只透過技能 Capability
// 影響戰力——與 GDD「魅力對非人類敵人……沒有相關技能時可為 0」一致。
const RESOURCE_FEATURE_ROWS: readonly FeatureRow[] = [
  {
    local: 'maximum-health',
    source: { kind: 'maximumResource', resource: 'health' },
    coefficient: 0.055,
  },
  {
    local: 'maximum-mana',
    source: { kind: 'maximumResource', resource: 'mana' },
    coefficient: 0.026,
  },
];

// ── 戰鬥 Capability ────────────────────────────────────────────────────────
//
// CP §2.3：「只有無法由 Statistics 表達的技能覆蓋、支援、控制與裝備條件效果，才進 Capability
// Contribution」。那句話直接給出第一版的分類——三種能力，兩種來源（技能／裝備效果）。
//
// Capability ID 沒有自己的 Definition kind（`CombatCapabilityId` 只是 ID 家族），所以這也是一份
// **跨 domain 契約**：文化 pack 的技能與裝備效果必須用這裡的 ID。
//
// `baseValue` 的尺度約定（第一版方案）：技能／裝備效果側填 **0..1 的正規化強度**（「這一招在這
// 個能力上有多強」），量級由本檔的 coefficient 決定。反過來（core 填 1、量級交給技能）會讓權重
// 散進四國的技能表，四國就再也不可比較——CP §7.7 禁止的正是這件事。
function capability(local: string): CombatPowerFeatureSource {
  return {
    kind: 'skillCapability',
    capabilityId: core.id('combat-capability', local),
  };
}

function equipmentCapability(local: string): CombatPowerFeatureSource {
  return {
    kind: 'equipmentEffectCapability',
    capabilityId: core.id('combat-capability', local),
  };
}

// 占比（第一版方案）：技能 support 40 / control 40 / coverage 20 = 100 點（＝統計類天花板的 10%）；
// 裝備效果各取一半（20 / 20 / 10 = 50），理由是裝備效果一律有觸發條件（CP §2.3「必須先通過武器組
// 與技能 Tag 條件」），期望貢獻低於常駐的技能配置。
const CAPABILITY_FEATURE_ROWS: readonly FeatureRow[] = [
  { local: 'skill-support', source: capability('support'), coefficient: 40 },
  { local: 'skill-control', source: capability('control'), coefficient: 40 },
  { local: 'skill-coverage', source: capability('coverage'), coefficient: 20 },
  { local: 'equipment-support', source: equipmentCapability('support'), coefficient: 20 },
  { local: 'equipment-control', source: equipmentCapability('control'), coefficient: 20 },
  { local: 'equipment-coverage', source: equipmentCapability('coverage'), coefficient: 10 },
];

const FEATURE_ROWS: readonly FeatureRow[] = [
  ...SECONDARY_FEATURE_ROWS,
  ...RESOURCE_FEATURE_ROWS,
  ...CAPABILITY_FEATURE_ROWS,
];

function featureRule(row: FeatureRow): Authored<CombatPowerFeatureRuleDefinition> {
  return {
    kind: 'combat-power-feature-rule',
    id: core.id<CombatPowerFeatureRuleId>('combat-power-feature-rule', row.local),
    featureId: core.id<CombatPowerFeatureId>('combat-power-feature', row.local),
    source: row.source,
    coefficient: row.coefficient,
    // transformResolverId 選填。第一版所有 Feature 都是線性的（CP 只舉了「對最大生命取次線性」
    // 當例子，沒有裁決），所以**不寫**這個欄位——少一個轉換步驟，不是套一條恆等轉換。
  };
}

const combatPowerRule: Authored<CombatPowerRuleDefinition> = {
  kind: 'combat-power-rule',
  id: COMBAT_POWER_RULE_ID,
  statisticsRuleId: STATISTICS_RULE_ID,
  featureRuleIds: FEATURE_ROWS.map((row) =>
    core.id<CombatPowerFeatureRuleId>('combat-power-feature-rule', row.local),
  ),
  feasibilityRuleId: FEASIBILITY_RULE_ID,
  unitAggregationResolverId: RESOLVERS.unitAggregation,
  teamFormationResolverId: RESOLVERS.teamFormation,
  // CP §3.2「第一版隊伍與 Encounter 都先加總成員，再套用同一 Formation Resolver」。
  teamAggregation: 'sumMembersThenFormation',
  encounterAggregation: 'sumMembersThenFormation',
  // CP §7.6「totalPower 必須為有限且不低於 minimumPower」。取 1（**第一版方案**）：期望成功率是
  // 兩邊戰力的比較，任一邊為 0 會讓比較失去意義；1 是「這個單位存在」的最小刻度。
  // 「可用成員為空」是另一條路徑（reason: 'noUsableMembers'），不靠這個值表達。
  minimumPower: 1,
  rounding: 'roundHalfUpAtFinalOutput',
};

// ── 任務可行性門檻 ──────────────────────────────────────────────────────────
//
// **整段第一版方案（待討論）**：CP §4 給了 riskBand 的字面值集合與 NpcQuestFeasibility 的形狀，
// 沒有給門檻。缺這筆資料 combat-power-rule 就綁不起來（feasibilityRuleId 必填），NPC 也評不了委託。
//
// 門檻語意（服務端實作）：升冪掃過 riskBandThresholds，取第一個 `expectedSuccess <= maxExpectedSuccess`
// 的帶；最後一筆必須涵蓋 1，否則高成功率會落在表外並被判為壞內容。
const RISK_BAND_THRESHOLDS: readonly CombatPowerRiskBandThreshold[] = [
  // 幾乎打不過：連補品重骰都救不回來。
  { maxExpectedSuccess: 0.1, riskBand: 'impossible' },
  // 明顯劣勢。
  { maxExpectedSuccess: 0.35, riskBand: 'dangerous' },
  // 勢均力敵。GDD「戰力相對差在 15% 內時，失敗可依資料規則消耗補品重骰」對應的正是這一帶。
  { maxExpectedSuccess: 0.65, riskBand: 'even' },
  // 優勢。
  { maxExpectedSuccess: 0.9, riskBand: 'favorable' },
  // 幾乎必勝。上界 1 是必要的：表沒涵蓋 1 就是壞內容。
  { maxExpectedSuccess: 1, riskBand: 'trivial' },
];

const feasibilityRule: Authored<CombatPowerFeasibilityRuleDefinition> = {
  kind: 'combat-power-feasibility-rule',
  id: FEASIBILITY_RULE_ID,
  // 跨規則的戰力不可比較，所以門檻表只對這一條戰力規則有效。
  combatPowerRuleId: COMBAT_POWER_RULE_ID,
  expectedSuccessResolverId: RESOLVERS.expectedSuccess,
  riskBandThresholds: [...RISK_BAND_THRESHOLDS],
  // 安全邊際：期望成功率低於此值 NPC 就不嘗試。0.45 落在 'even' 帶的下半——NPC 願意接勢均力敵
  // 的委託，但不接明顯劣勢的。**第一版方案（待討論）**。
  minimumAttemptExpectedSuccess: 0.45,
  // 一個目標對到多個對抗編組時怎麼取對抗戰力。取「最強的一組」而不是加總：第一版沒有多編組同場
  // 戰鬥（GDD「戰鬥雙方各自使用一個 3×3 九宮格」），地牢掃蕩是把編組串成多節點**依序**打
  // （GDD「地牢掃蕩則把地牢中的怪物內容依順序組成多節點戰鬥串」），所以卡關的是最硬的那一組，
  // 不是全部之和。**第一版方案（待討論）**——加總會讓長地牢被高估成不可能。
  opposingAggregation: 'strongestEncounterGroup',
};

// ══════════════════════════════════════════════════════════════════════════
// gathering
// ══════════════════════════════════════════════════════════════════════════
//
// **這裡只有目的政策，沒有 `gathering-rule`。**
//
// 理由不是「還沒寫」，而是 `GatheringRuleDefinition.yieldParams.pool` 必填、且每一筆都指向具體的
// `itemDefinitionId`（雲華的藥草、瓦爾頓的礦石……）——那是文化內容。而且 Resolver 對空池是明確
// 拒絕（`gathering.materialPoolEmpty`），所以在 core 放一條「沒有素材池的通用採集規則」等於放一條
// **保證會被拒絕**的定義：那正是規範點名的「把未完成偽裝成可用」。
// 判準也很直接：換一份文化 pack，pool 一定會變 → 它屬文化 pack。
//
// 目的政策相反：19_gathering_service.md §5／§6.2 對第一版三種來源的成果歸向做了全域裁決
// （地圖固定採集點與敵人採集型掉落 → 共同 Distribution；旅行資源 → 每位參與者各自進背包），
// 四國一致，且不引用任何文化 ID。
//
// 服務端的一致性檢查：`yieldScope === 'perParticipant'` 必須恰好對上
// `destinationKind === 'participantCharacterBags'`，反之亦然。

type DestinationPolicyRow = Readonly<{
  local: string;
  definition: Omit<Authored<GatheringDestinationPolicyDefinition>, 'kind' | 'id'>;
}>;

const DESTINATION_POLICY_ROWS: readonly DestinationPolicyRow[] = [
  // GA §5「地牢採集物是本次共同探索成果，沿用玩家競拍／NPC RNG 分配」＋
  // §6.2「敵人採集型掉落仍進本次短期 Distribution；地圖固定採集點仍進共同 Distribution」。
  {
    local: 'shared-distribution',
    definition: { yieldScope: 'sharedResult', destinationKind: 'assetDistribution' },
  },
  // GA §4.1／§6.2「旅行資源固定使用 participantCharacterBags：……讓每位本次正式參與者各自抽取
  // 一份種類與數量，直接進自己的背包」。
  {
    local: 'participant-bags',
    definition: { yieldScope: 'perParticipant', destinationKind: 'participantCharacterBags' },
  },
  // 第三種 destinationKind（`characterBag`：單一角色的背包）刻意**不建立政策**。GA 第一版沒有
  // 任何來源走它，而憑空造一筆沒有來源會引用的政策，就是在 pack 裡放一筆假的可用性。
];

function destinationPolicy(row: DestinationPolicyRow): Authored<GatheringDestinationPolicyDefinition> {
  return {
    kind: 'gathering-destination-policy',
    id: core.id<GatheringDestinationPolicyId>('gathering-destination-policy', row.local),
    ...row.definition,
  };
}

// ══════════════════════════════════════════════════════════════════════════
// 匯出
// ══════════════════════════════════════════════════════════════════════════
//
// 供其他 domain 引用：
//   * `EQUIPMENT_COEFFICIENT_CHANNEL_IDS` —— **文化 pack 的裝備一定要用這一份**，否則那件裝備對
//     副屬沒有貢獻，而且不會有任何載入期錯誤（見上面通道那一段）。
//   * `SECONDARY_IDS` —— 怪物 stat block 與 UI 面板要指名副屬時用。
//   * 兩條規則 ID —— 文化 pack 的遭遇／怪物／掃蕩內容要指名「用哪一套規則」時用。
const EQUIPMENT_COEFFICIENT_CHANNEL_IDS: Readonly<Record<string, EquipmentCoefficientChannelId>> =
  Object.fromEntries(
    SECONDARY_ROWS.flatMap((row) => row.channelLocals).map((local) => [local, channel(local)]),
  );

export {
  EQUIPMENT_COEFFICIENT_CHANNEL_IDS,
  SECONDARY_IDS,
  STATISTICS_RULE_ID,
  COMBAT_POWER_RULE_ID,
};

export const servicesDomain: AuthoredDomain = {
  domain: 'services',
  definitions: [
    // statistics
    statisticsRule,
    ...SECONDARY_ROWS.map(secondaryAttributeRule),
    gripRule,
    carryCapacityRule,
    ageModifierRule,
    // combat-power
    combatPowerRule,
    ...FEATURE_ROWS.map(featureRule),
    feasibilityRule,
    // gathering
    ...DESTINATION_POLICY_ROWS.map(destinationPolicy),
  ],
};
