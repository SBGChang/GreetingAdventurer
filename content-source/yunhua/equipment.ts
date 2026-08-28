// content-source/yunhua/equipment.ts
// 雲華的裝備：18 條底模線 × 五個品級 = 90 筆 `equipment` 定義。
//
// ── 這個檔案在做什麼 ────────────────────────────────────────────────────────
//
// **映射，不是發明。** 設計來源 `docs/03_content/yunhua/yunhua_content.data.mjs` 的
// `equipmentCatalog` 已經是結構化資料：每條線一個 blueprint（`{id, requirement, baseValue,
// names[5], weights[5], baseRows, abilities[5]}`），由 `makeEquipmentLine` 依 `tierMeta`
// 展開成五個品級。本檔把它逐欄對應到 `EquipmentDefinition`，並把設計來源的展開算式
// （`scale` / `priceScale` / `round`）一比一重寫成純資料展開——那是 authoring.ts 明文允許的
// 「同一條武器線的五個品級」那類工具，不是規則邏輯。
//
// 設計來源**只讀不改**（它屬別的 scope，且 verify:content-sync 會抓）。
//
// ── 逐欄來源 ────────────────────────────────────────────────────────────────
//
//   id / rarity / unitWeight / intrinsicValue.amount / secondaryAttributeCoefficients
//        ← `makeEquipmentLine` 的 id / tierMeta.rarity / weights[i] / baseValue×priceScale /
//          baseRows×scale。全部是結構化數字，**沒有一個是從散文剖出來的**。
//   equipmentKind / relatedMasteryIds / occupiedSlots / handSlots
//        ← `requirement` 散文（如 `'環首刀／單手武器'`）的**逐筆人工判讀**。判讀結果與依據
//          逐條寫在下面 `BLUEPRINTS` 的註解裡，並在回報的「散文判讀清單」列出。
//   originCultureId ← `cultureMeta.id`（`culture.yunhua`）。
//   unresolvedMapDisposition ← `yunhua_content.md` §11.6 的表（裝備 → `toCityPermanentStock`）。
//   display.nameRef ← 只放 key；設計來源的中文名見下面 `YUNHUA_EQUIPMENT_DISPLAY_NAMES`
//          與回報的契約缺口 4。
//   skillEffectRefs ← **一律空陣列**。設計來源每格都有 `ability {condition, effect, limit}`
//          三段散文，但那些是 combat 的 `equipment-effect` 定義（`{triggerResolverId, effectIds}`），
//          由 combat domain 的作者擁有。填一個還沒有人定義的 ID 會是懸空引用，而且
//          `equipment-effect.yunhua.<local>.<tier>` 是**四段式**、跳不進 Compiler 的三段式引用
//          檢查——那會是「安靜的懸空引用」，比留空更糟。見回報的「跨定義引用」第 3 項。
//
// ── 這一輪動過的契約（唯一一處，已被授權）────────────────────────────────────
//
// 設計來源的 `coefficients` 是「**每個副屬各有自己的主屬方向向量**」：環首刀對物理傷害是
// `{muscle: 1.25, coordination: 0.95}`、對命中是 `{reaction: 0.22, coordination: 0.18}`。
// 舊的 `SecondaryAttributeCoefficients` 是「一份共用主屬向量 × 每通道一個純量」——純量只能縮放
// 不能轉向，所以那個形狀無論怎麼填都至少有一個通道方向是錯的。已把它改成逐通道帶向量
// （`src/contracts/inventory/index.ts`，就地寫明理由），並讓
// `src/domain-services/statistics/statistics.ts` 逐通道讀；`EquipmentDefinition.primaryAttributeCoefficients`
// 因此失去消費者，改成選填並標記待刪（刪除會動到 `src/modules/inventory/fixtures.ts`，不在範圍內）。
// `npx tsx scripts/verify-modules.ts` 全綠，statistics 的期望值一個都沒有改。
//
// ⚠ **改完之後浮出一個跨模組的重複真相（整合者必須裁決，本檔不自行決定）**：
// `content-source/core/services.ts` 的 `SecondaryAttributeRuleDefinition.primaryCoefficients` 也是
// 一份方向向量（它的註解明說那是因為「裝備契約只有一份 primaryAttributeCoefficients」才擺在那裡）。
// 兩份相乘的結果是設計來源的係數被再縮放一次：
//   物理傷害規則 {muscle: 1, coordination: 0.375} × 環首刀 {muscle: 1.25, coordination: 0.95}
//   = {muscle: 1.25, coordination: 0.356}
// 而設計來源的平衡式是「Σ(主屬 × 裝備係數)」，沒有第二個方向因子。**主屬集合兩邊完全一致**
// （逐條核對過，見回報），差的只有量級。兩個可能的收斂方向都不在本檔的權限內：
//   (a) core 的副屬規則把 `primaryCoefficients` 改成「有列＝走這項，權重一律 1」（方向歸裝備）；
//   (b) statistics 在裝備有逐通道向量時不再乘規則方向。
// 在裁決之前，本檔的數字是設計來源的原值——那是唯一有來源的一組。

import type {
  EquipmentDefinition,
  EquipmentCoefficientChannelId,
  EquipmentHandSlots,
  EquipmentKind,
  EquipmentSlotId,
  PrimaryAttributeId,
  SecondaryAttributeCoefficients,
} from '../../src/contracts/inventory';
import type { CurrencyId, EquipmentDefinitionId, MasteryId } from '../../src/contracts/core';
import { cultureIds, type Authored, type AuthoredDomain } from '../authoring';
import { MASTERY_IDS } from '../core/progression';

const yunhua = cultureIds('yunhua');
// core 的 ID：熟練度、貨幣、係數通道與裝備位置都屬遊戲結構，四國共用（見 packs.ts 的分包原則）。
const core = cultureIds('core');

// ── 跨 domain 引用（本檔不擁有這些定義，只引用它們的 ID）────────────────────

// 貨幣。`content-source/core/economy-social-distribution.ts` 的 `currency` 定的是 `standard`
// （四國同一種貨幣，該檔逐字寫明理由）。三段式 + 已登記 kind ⇒ Compiler 的跨定義引用檢查會驗它。
const CURRENCY_ID = core.id<CurrencyId>('currency', 'standard');

// 熟練度。`MASTERY_IDS` 是 `content-source/core/progression.ts` 為了「裝備的 relatedMasteryIds」
// 明文匯出的對照表，所以這裡引用它而不是自己拼字串：progression 改了 local 名，這裡就取不到。
//
// 這個 throw 是**建置期驗證**（規範五個合法出口的第 2 項「Content Pack 驗證失敗」的作者層前哨），
// 不是遊戲規則；與 authoring.ts 的 `definitionId` 對空字串 throw 同類。
function masteryId(local: string): MasteryId {
  const id = MASTERY_IDS[local];
  if (id === undefined) {
    throw new Error(
      `裝備引用了 progression 沒有的熟練度 local 名 "${local}"——` +
        `對照 content-source/core/progression.ts 的熟練度清單`,
    );
  }
  return id;
}

// 裝備係數通道。擁有者是 `content-source/core/services.ts` 的 `channel()`，local 名逐字取自
// 該檔的 `SECONDARY_ROWS[].channelLocals`。
//
// ⚠ `equipment-coefficient-channel` **不是已登記的 Definition kind**，所以通道沒有任何定義、
// 也不會被 Compiler 的跨定義引用檢查驗到——打錯一個字的後果是「這件裝備對那個副屬安靜地沒有
// 貢獻」。services.ts 已把這件事列為契約缺口；本檔把通道 local 收成一個字面聯集，讓打錯字至少
// 在**本檔內**是編譯錯誤。
type ChannelLocal =
  | 'physical-damage'
  | 'magic-damage'
  | 'instrument-damage'
  | 'accuracy'
  | 'evasion'
  | 'anticipation'
  | 'block-chance'
  | 'block-absorption'
  | 'general-mitigation'
  | 'magic-mitigation';

function channelId(local: ChannelLocal): EquipmentCoefficientChannelId {
  return core.id<EquipmentCoefficientChannelId>('equipment-coefficient-channel', local);
}

// 裝備位置。`equipment-slot` 也不是已登記的 kind（同上，沒有定義、沒有檢查）。
// local 名取自既有落地用法（`src/modules/inventory/fixtures.ts`、
// `src/domain-services/statistics/fixtures.ts` 的 mainHand / offHand / body / head）。
// 雲華第一版沒有任何頭部裝備（設計來源的防具表一列一件全身甲，沒有頭盔線），所以 `head` 不出現。
function slotId(local: 'main-hand' | 'off-hand' | 'body'): EquipmentSlotId {
  return core.id<EquipmentSlotId>('equipment-slot', local);
}

const MAIN_HAND = slotId('main-hand');
const OFF_HAND = slotId('off-hand');
const BODY = slotId('body');

// ── 手別與位置的三種形狀 ────────────────────────────────────────────────────
//
// 規則出自 `src/contracts/inventory/index.ts` 的 `EquipmentHandSlots` 註解與
// `docs/00_core/architecture/05_inventory_module.md` §123～124：
//   * 單手武器：`occupiedSlots` 只有主手那一格，`handSlots` **兩手皆列**——GDD §511 要求同組可
//     混搭兩把武器，所以「這把刀現在在副手」是配置決定的，不是定義決定的。
//     （反樣式：用 `handSlots: { mainHand }` 表達「不准放副手」，那會禁掉雙持。）
//   * 雙手裝備：兩手皆列，且 `occupiedSlots.length > 1` 表示必須**同時**占滿兩手。
//   * 盾（單手）：只列 `offHand`。
//   * 鎧甲：`handSlots` 為空物件。
const ONE_HAND_HELD = {
  occupiedSlots: [MAIN_HAND],
  handSlots: { mainHand: MAIN_HAND, offHand: OFF_HAND },
} as const;

const TWO_HAND_HELD = {
  occupiedSlots: [MAIN_HAND, OFF_HAND],
  handSlots: { mainHand: MAIN_HAND, offHand: OFF_HAND },
} as const;

const OFF_HAND_ONLY = {
  occupiedSlots: [OFF_HAND],
  handSlots: { offHand: OFF_HAND },
} as const;

const BODY_WORN = {
  occupiedSlots: [BODY],
  handSlots: {},
} as const;

// ── 品級 ────────────────────────────────────────────────────────────────────
//
// 逐欄照抄設計來源的 `tierMeta`。`rarity` 是中文→契約聯集的對照：
// 一般→common、精品→fine、史詩→epic、傳說→legendary、神話→mythic
// （`EquipmentDefinition.rarity` 的聯集順序與 tierMeta 完全一致，逐一對位無歧義）。
type TierMeta = Readonly<{
  // ID 第四段與 nameRef key 用的品級代號；設計來源用 `meta.tier.toLowerCase()`。
  tier: 'i' | 'ii' | 'iii' | 'iv' | 'v';
  rarity: EquipmentDefinition['rarity'];
  // 係數倍率與價格倍率。
  scale: number;
  priceScale: number;
}>;

const TIER_META: readonly [TierMeta, TierMeta, TierMeta, TierMeta, TierMeta] = [
  { tier: 'i', rarity: 'common', scale: 1, priceScale: 1 },
  { tier: 'ii', rarity: 'fine', scale: 1.3, priceScale: 2.6 },
  { tier: 'iii', rarity: 'epic', scale: 1.75, priceScale: 7 },
  { tier: 'iv', rarity: 'legendary', scale: 2.25, priceScale: 22 },
  { tier: 'v', rarity: 'mythic', scale: 2.95, priceScale: 75 },
];

// 品級索引寫成字面聯集，`weights[index]` / `names[index]` 才會是 `number` / `string` 而不是
// `… | undefined`（tsconfig 開了 noUncheckedIndexedAccess）。這不是型別技巧，是「五格就是五格」。
const TIER_INDEXES = [0, 1, 2, 3, 4] as const;
type TierIndex = (typeof TIER_INDEXES)[number];
type Quintuple<T> = readonly [T, T, T, T, T];

// 設計來源的 `round = value => Math.round(value * 100) / 100`。逐字重寫：換一份平衡資料，
// 這裡的每一個輸出都會變，所以它是資料展開而不是規則。
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

// ── 係數列 ──────────────────────────────────────────────────────────────────
//
// 下面十個 helper 與設計來源的同名 helper **簽章、參數順序、通道對應完全一致**，這樣
// `BLUEPRINTS` 的每一行 `baseRows` 都能與設計來源逐字對照（不是重新推導）。
//
// 設計來源的 `vector(muscle=0, intelligence=0, reaction=0, coordination=0, charisma=0)` 會把五個
// 主屬都填成 0 再 scale，所以它的每一列都帶五個 key。本檔**只保留該 helper 具名的主屬**，其餘
// （恆為 0）省略：契約的 `Partial` 語意是「未列出的主屬不成項」，加總的單位元是 0，兩者數值等價。
// 具名但傳 0 的（例如 `hit(0, 0.22, 0.18)` 的智、`evade(0, -0.06, -0.04)` 的智）**保留**，
// 因為那是設計來源顯式寫出的 0。
type PrimaryVector = Partial<Record<PrimaryAttributeId, number>>;
type CoefficientRow = Readonly<{ channel: ChannelLocal; values: PrimaryVector }>;

const physical = (muscle: number, coordination: number): CoefficientRow => ({
  channel: 'physical-damage',
  values: { muscle, coordination },
});
const magic = (intelligence: number): CoefficientRow => ({
  channel: 'magic-damage',
  values: { intelligence },
});
const instrument = (
  intelligence: number,
  coordination: number,
  charisma: number,
): CoefficientRow => ({
  channel: 'instrument-damage',
  values: { intelligence, coordination, charisma },
});
const hit = (intelligence: number, reaction: number, coordination: number): CoefficientRow => ({
  channel: 'accuracy',
  values: { intelligence, reaction, coordination },
});
const evade = (intelligence: number, reaction: number, coordination: number): CoefficientRow => ({
  channel: 'evasion',
  values: { intelligence, reaction, coordination },
});
const predict = (intelligence: number, reaction: number): CoefficientRow => ({
  channel: 'anticipation',
  values: { intelligence, reaction },
});
const block = (reaction: number, coordination: number): CoefficientRow => ({
  channel: 'block-chance',
  values: { reaction, coordination },
});
const normalDr = (muscle: number): CoefficientRow => ({
  channel: 'general-mitigation',
  values: { muscle },
});
const magicDr = (intelligence: number): CoefficientRow => ({
  channel: 'magic-mitigation',
  values: { intelligence },
});
const blockAbsorb = (muscle: number): CoefficientRow => ({
  channel: 'block-absorption',
  values: { muscle },
});

// ── 底模 ────────────────────────────────────────────────────────────────────

type Blueprint = Readonly<{
  // 設計來源 blueprint 的 `id`，直接當 ID 的 local 前半段（`equipment.yunhua.<local>.<tier>`）。
  local: string;
  // 設計來源的 `requirement` 散文，逐字保存供對照；**不進產物**。
  requirement: string;
  equipmentKind: EquipmentKind;
  masteryLocals: readonly string[];
  placement: Readonly<{
    occupiedSlots: readonly EquipmentSlotId[];
    handSlots: EquipmentHandSlots;
  }>;
  baseValue: number;
  names: Quintuple<string>;
  weights: Quintuple<number>;
  baseRows: readonly CoefficientRow[];
}>;

// 十八條線，順序與設計來源的 `equipmentCatalog` 一致（五個分類）。
//
// 每一筆的 `equipmentKind` / `masteryLocals` / `placement` 都是 `requirement` 那句散文的判讀結果；
// 判讀依據寫在該筆的註解裡。`baseValue` / `names` / `weights` / `baseRows` 是結構化欄位，逐字照抄。
const BLUEPRINTS: readonly Blueprint[] = [
  // ── 武器｜單手物理 ────────────────────────────────────────────────────────
  // 分類敘述：「單手武器可搭配副手盾、扇或第二把單手武器；雙持仍遵守左手 ×0.5、右手 ×0.35 的
  // 既定持握係數。」→ 這兩條線是單手（`ONE_HAND_HELD`，兩手皆可放）。
  {
    local: 'ring-saber',
    // '環首刀／單手武器'：斜線前是武器需求（底模名），後是 Mastery 類別 → 單手武器。
    requirement: '環首刀／單手武器',
    equipmentKind: 'weapon',
    masteryLocals: ['one-hand-weapon'],
    placement: ONE_HAND_HELD,
    baseValue: 80,
    names: ['環首短刀', '雲紋佩刀', '銀環柳葉刀', '斷潮佩刀', '御紋長刀'],
    weights: [6, 7, 8, 9, 10],
    baseRows: [physical(1.25, 0.95), hit(0, 0.22, 0.18), predict(0.08, 0.1)],
  },
  {
    local: 'iron-fan',
    requirement: '鐵骨扇／單手武器',
    equipmentKind: 'weapon',
    masteryLocals: ['one-hand-weapon'],
    placement: ONE_HAND_HELD,
    baseValue: 70,
    names: ['鐵骨折扇', '漆紋鐵扇', '青玉開山扇', '鎮風羽扇', '百頁玄扇'],
    weights: [3, 3, 4, 4, 5],
    baseRows: [physical(0.85, 0.72), hit(0.1, 0.25, 0.22), predict(0.14, 0.16), magicDr(0.05)],
  },
  // ── 武器｜雙手物理 ────────────────────────────────────────────────────────
  // 分類敘述：「長槍與偃刀共用雙手武器 Mastery…偃刀是雙手重刃定位：失去副手與雙持彈性。」
  // →「失去副手」是明文，兩條線都 `TWO_HAND_HELD`（同時占滿兩手）。
  {
    local: 'spear',
    requirement: '長槍／雙手武器',
    equipmentKind: 'weapon',
    masteryLocals: ['two-hand-weapon'],
    placement: TWO_HAND_HELD,
    baseValue: 105,
    names: ['棗木長槍', '青鐵長槍', '流雲槍', '鎖陣槍', '玄衡龍槍'],
    weights: [11, 12, 13, 14, 15],
    baseRows: [physical(1.7, 1.0), hit(0, 0.32, 0.24), predict(0.1, 0.18), block(0.08, 0.06)],
  },
  {
    local: 'glaive',
    requirement: '偃刀／雙手武器',
    equipmentKind: 'weapon',
    masteryLocals: ['two-hand-weapon'],
    placement: TWO_HAND_HELD,
    baseValue: 120,
    names: ['木柄偃刀', '月牙偃刀', '鐵脊偃刀', '斷岳偃刀', '九環大偃'],
    weights: [14, 16, 18, 20, 23],
    baseRows: [physical(2.05, 1.05), hit(0, 0.16, 0.18), normalDr(0.06), blockAbsorb(0.05)],
  },
  // ── 武器｜投擲與射擊 ──────────────────────────────────────────────────────
  // 分類敘述只講「不消耗武器本體、不用彈藥耐久」，**沒有講手別**。
  // 判讀：投擲武器（飛針囊、鏢匣、蒺藜袋、繩錘）是單手投擲物 → `ONE_HAND_HELD`；
  // 射擊武器（弓、弩）雙手張弦 → `TWO_HAND_HELD`。兩者都列入「第一版方案（待討論）」。
  {
    local: 'needle',
    requirement: '飛針／投擲武器',
    equipmentKind: 'weapon',
    masteryLocals: ['throwing-weapon'],
    placement: ONE_HAND_HELD,
    baseValue: 68,
    names: ['飛針囊', '銅尾飛針', '鎖線飛鏢', '照影流星', '天羅鏢匣'],
    weights: [2, 2, 3, 3, 4],
    baseRows: [physical(0.55, 1.45), hit(0.08, 0.38, 0.28), predict(0.05, 0.16)],
  },
  {
    local: 'chain-weight',
    // '蒺藜／鏈鏢／投擲武器'：三段——兩個底模別名（蒺藜、鏈鏢）＋ Mastery 類別。
    // md §8.2 的表把這條線寫成「蒺藜／投擲武器」，同一條線。
    requirement: '蒺藜／鏈鏢／投擲武器',
    equipmentKind: 'weapon',
    masteryLocals: ['throwing-weapon'],
    placement: ONE_HAND_HELD,
    baseValue: 92,
    names: ['鐵蒺藜袋', '青鐵流星錘', '鎖鏈鏢', '萬鈞繩錘', '九節鎮鎖'],
    weights: [5, 7, 8, 10, 12],
    baseRows: [physical(1.35, 1.05), hit(0, 0.3, 0.22), blockAbsorb(0.04)],
  },
  {
    local: 'bamboo-bow',
    requirement: '竹弓／射擊武器',
    equipmentKind: 'weapon',
    masteryLocals: ['shooting-weapon'],
    placement: TWO_HAND_HELD,
    baseValue: 86,
    names: ['竹弓', '漆背角弓', '穿雲長弓', '鎮關鐵胎弓', '望舒神弓'],
    weights: [4, 5, 6, 7, 8],
    baseRows: [physical(0.6, 1.65), hit(0.12, 0.42, 0.32), predict(0.08, 0.16)],
  },
  {
    local: 'repeating-crossbow',
    requirement: '連珠弩／射擊武器',
    equipmentKind: 'weapon',
    masteryLocals: ['shooting-weapon'],
    placement: TWO_HAND_HELD,
    baseValue: 105,
    names: ['手弩', '連珠弩', '機簧重弩', '破城臂張弩', '天機重弩'],
    weights: [6, 8, 10, 13, 16],
    baseRows: [physical(0.85, 1.7), hit(0.08, 0.36, 0.3), predict(0.06, 0.12)],
  },
  // ── 武器｜法杖與樂器 ──────────────────────────────────────────────────────
  {
    local: 'one-hand-staff',
    // '桃木短杖／單手法杖'。md §8.2 玩法取向逐字寫「單手符術，可搭配副手盾或扇」——手別是明文。
    requirement: '桃木短杖／單手法杖',
    equipmentKind: 'weapon',
    masteryLocals: ['one-hand-staff'],
    placement: ONE_HAND_HELD,
    baseValue: 84,
    names: ['桃木短杖', '朱砂令杖', '墨玉符杖', '鎮紙玉杖', '司印權杖'],
    weights: [3, 4, 4, 5, 6],
    baseRows: [magic(2.35), hit(0.25, 0.22, 0.08), magicDr(0.06), predict(0.1, 0.08)],
  },
  {
    local: 'two-hand-staff',
    requirement: '銅鈴長杖／雙手法杖',
    equipmentKind: 'weapon',
    masteryLocals: ['two-hand-staff'],
    placement: TWO_HAND_HELD,
    baseValue: 116,
    names: ['桑木長杖', '銅鈴長杖', '四象陣杖', '萬籙儀杖', '天衡法杖'],
    weights: [8, 10, 12, 14, 16],
    baseRows: [magic(2.9), hit(0.34, 0.22, 0.1), magicDr(0.09), predict(0.14, 0.1)],
  },
  {
    local: 'bamboo-flute',
    // '竹笛／管樂器'。**手別是判讀**：設計來源對武器、法杖、盾一律標「單手／雙手」，唯獨兩種
    // 樂器沒有標，熟練度清單也只有 wind-instrument / string-instrument（沒有單手／雙手變體），
    // 所以「單手樂器」這個概念在設計裡不存在 → 取雙手（吹奏／彈奏都用兩手）。
    // 取雙手而不是單手，是因為兩種錯的代價不對稱：多禁一個組合看得見，多開一個
    // 「笛＋刀雙持、副手吃樂器傷害通道」的組合不會有任何測試失敗。列入待討論。
    requirement: '竹笛／管樂器',
    equipmentKind: 'weapon',
    masteryLocals: ['wind-instrument'],
    placement: TWO_HAND_HELD,
    baseValue: 78,
    names: ['竹笛', '銅節簫', '清商玉笛', '鳳鳴長簫', '九霄龍笛'],
    weights: [2, 2, 3, 3, 4],
    baseRows: [instrument(0.42, 0.24, 0.5), hit(0.1, 0.18, 0.12), magicDr(0.04)],
  },
  {
    local: 'seven-string',
    requirement: '七弦琴／弦樂器',
    equipmentKind: 'weapon',
    masteryLocals: ['string-instrument'],
    placement: TWO_HAND_HELD,
    baseValue: 88,
    names: ['桐木短琴', '漆面七弦', '雲水古琴', '斷金瑤琴', '大音無弦'],
    weights: [4, 5, 6, 7, 8],
    baseRows: [instrument(0.36, 0.3, 0.56), predict(0.12, 0.16), magicDr(0.07)],
  },
  // ── 防具與盾牌 ────────────────────────────────────────────────────────────
  // 四條甲線的 `requirement` 只有兩個字（'布甲' / '輕甲' / '中甲' / '重甲'），對應
  // md §9 的「防具 Mastery」欄，也正好是 progression 的四個防具熟練度 local。
  //
  // `occupiedSlots: [body]`（不含 head）是判讀：設計來源每個 Mastery 每個品級只有**一件**防具，
  // 沒有任何頭盔／頭部線。宣稱占用 head 會讓未來新增頭盔線時無聲衝突。
  // 副作用：GDD 的「樂器減傷＝頭盔重量＋年紀」在雲華第一版沒有頭盔可讀（見回報）。
  {
    local: 'cloth',
    requirement: '布甲',
    equipmentKind: 'armor',
    masteryLocals: ['cloth-armor'],
    placement: BODY_WORN,
    baseValue: 54,
    names: ['青岑布衣', '素紋罩袍', '雲紗術袍', '五色道袍', '萬象法衣'],
    weights: [3, 4, 5, 5, 6],
    baseRows: [evade(0.1, 0.26, 0.12), magicDr(0.12), predict(0.08, 0.12)],
  },
  {
    local: 'light-armor',
    requirement: '輕甲',
    equipmentKind: 'armor',
    masteryLocals: ['light-armor'],
    placement: BODY_WORN,
    baseValue: 68,
    names: ['竹面皮甲', '魚鱗輕甲', '雲紋皮札', '風羽鱗衣', '天游輕鎧'],
    weights: [7, 8, 9, 10, 11],
    baseRows: [evade(0.05, 0.34, 0.28), hit(0, 0.1, 0.12), normalDr(0.06)],
  },
  {
    local: 'medium-armor',
    requirement: '中甲',
    equipmentKind: 'armor',
    masteryLocals: ['medium-armor'],
    placement: BODY_WORN,
    baseValue: 90,
    names: ['皮襯札甲', '青鐵札甲', '鎖片明光甲', '虎紋山文甲', '玄衡中鎧'],
    weights: [13, 15, 17, 19, 21],
    baseRows: [normalDr(0.14), blockAbsorb(0.16), block(0.1, 0.08), evade(0, 0.08, 0.08)],
  },
  {
    local: 'heavy-armor',
    requirement: '重甲',
    equipmentKind: 'armor',
    masteryLocals: ['heavy-armor'],
    placement: BODY_WORN,
    baseValue: 125,
    // 迴避是**負值**（md §9「最高一般減傷、明確犧牲迴避與命中向係數」）。負係數是設計意圖，
    // 不是資料錯誤；statistics 的 safeRaw = max(0, raw) 只夾最終 raw，不夾單件係數。
    names: ['鐵葉重札', '鎮關重鎧', '玄鱗重甲', '龍紋步人甲', '天衡玄甲'],
    weights: [21, 25, 29, 34, 40],
    baseRows: [normalDr(0.22), blockAbsorb(0.24), magicDr(0.05), evade(0, -0.06, -0.04)],
  },
  {
    local: 'one-hand-shield',
    // '單手盾'：契約註解明文「盾只列 offHand」。
    requirement: '單手盾',
    equipmentKind: 'shield',
    masteryLocals: ['one-hand-shield'],
    placement: OFF_HAND_ONLY,
    baseValue: 72,
    names: ['藤編小盾', '圓木鐵緣盾', '鐵面圓盾', '雲獸吞口盾', '玄龜寶盾'],
    weights: [5, 7, 9, 11, 13],
    baseRows: [block(0.28, 0.22), blockAbsorb(0.18), normalDr(0.04)],
  },
  {
    local: 'two-hand-shield',
    // '雙手盾'。md §9 的定位欄寫「高格擋、己方前排防護、**限制主手**」，而 Tier I 的 ability
    // limit 欄寫「主手武器技能不可用」。兩種讀法：
    //   (a) 占滿兩手（`TWO_HAND_HELD`）——契約對雙手裝備的既定表達，「主手武器技能不可用」是結果。
    //   (b) 只占副手，另用一個 equipment-effect 禁掉主手武器技能。
    // 取 (a)：契約與 05_inventory_module.md 對「必須同時占滿兩手」只有 occupiedSlots 這一種表達，
    // 而 (b) 需要一個還不存在的 effect 才成立——用「還沒有的東西」表達已知限制就是把限制寫進空氣。
    // 副作用：Tier I 的 limit 句在 (a) 下恆真而顯得多餘。列入待討論。
    requirement: '雙手盾',
    equipmentKind: 'shield',
    masteryLocals: ['two-hand-shield'],
    placement: TWO_HAND_HELD,
    baseValue: 108,
    names: ['木骨大牌', '漕關門盾', '鎮門塔盾', '岳紋方盾', '天柱巨盾'],
    weights: [16, 20, 25, 31, 38],
    baseRows: [block(0.36, 0.28), blockAbsorb(0.28), normalDr(0.1), magicDr(0.06)],
  },
];

// ── 展開 ────────────────────────────────────────────────────────────────────

// 設計來源的 `scaleVector(value, scale)`：逐主屬乘 scale 後 round 到小數兩位。
function scaleRow(row: CoefficientRow, scale: number): SecondaryAttributeCoefficients {
  const values: PrimaryVector = {};
  for (const [attribute, amount] of Object.entries(row.values) as readonly [
    PrimaryAttributeId,
    number,
  ][]) {
    values[attribute] = round2(amount * scale);
  }
  return { channelId: channelId(row.channel), primaryAttributeCoefficients: values };
}

// nameRef 的 key。刻意用**五段式**（`equipment.yunhua.<local>.<tier>.name`）：Compiler 的跨定義
// 引用檢查只認三段式，五段式不會被誤判成一筆引用；而 `item.yunhua.<local>` 這種寫法反而會（`item`
// 是已登記的 kind），那會讓一個顯示用字串被當成懸空的定義引用。
function nameKey(local: string, tier: TierMeta['tier']): string {
  return `equipment.yunhua.${local}.${tier}.name`;
}

// §2.4 武器射程（格數）：依武器 Mastery 類別指派（第一版方案，待討論——見設計帳本）。
// 近戰1／雙手・長柄2／投擲3／射擊5（4-6 取中）／法杖1（魔法距離靠招式 +6）／樂器2。
// 只有 equipmentKind==='weapon' 有射程；護甲/盾/飾品回 undefined（省略欄位）。
// 對應不到＝內容錯（新武器類別忘了指派射程），明確拋錯、不預設。
const WEAPON_REACH_CELLS: Readonly<Record<string, number>> = {
  'one-hand-weapon': 1,
  'two-hand-weapon': 2,
  'throwing-weapon': 3,
  'shooting-weapon': 5,
  'one-hand-staff': 1,
  'two-hand-staff': 1,
  'wind-instrument': 2,
  'string-instrument': 2,
};
function weaponReachCells(blueprint: Blueprint): number | undefined {
  if (blueprint.equipmentKind !== 'weapon') return undefined;
  const key = blueprint.masteryLocals[0];
  const reach = key === undefined ? undefined : WEAPON_REACH_CELLS[key];
  if (reach === undefined) {
    throw new Error(`equipment：武器 ${blueprint.local} 的 Mastery 類別「${String(key)}」沒有射程對應`);
  }
  return reach;
}

function equipmentTier(blueprint: Blueprint, index: TierIndex): Authored<EquipmentDefinition> {
  const meta = TIER_META[index];
  const reachCells = weaponReachCells(blueprint);
  return {
    kind: 'equipment',
    // 設計來源的 `equipment.yunhua.${blueprint.id}.${meta.tier.toLowerCase()}`，逐字沿用。
    id: yunhua.id<EquipmentDefinitionId>('equipment', `${blueprint.local}.${meta.tier}`),
    originCultureId: yunhua.cultureId,
    // 設計來源沒有給裝備任何 tag（素材才有 `materialAffixId` 那條線）。空陣列＝沒有標籤，
    // 不是漏填；`item-tag` 也沒有登記 kind，填了也沒有東西可指。
    itemTagIds: [],
    // md §5 要求每個物品明列堆疊策略，但設計來源的 equipmentCatalog 沒有這一欄。
    // 取 'single'：契約的裝備模型是逐實例的（Loadout 的每個 slot 存一個 ItemInstanceId、
    // 製作品質 CraftQuality 掛在實例上），可堆疊的裝備在那個模型裡表達不出「哪一件被裝上」。
    // 這是契約已經釘住的那一組解，不是我挑的偏好。
    stackPolicy: 'single',
    unitWeight: blueprint.weights[index],
    // 裝備可買可賣：md §11.3 的配方表把裝備列為鍛造／裁縫的產出並指名「裝備店工坊」，
    // §11.6 說未處理的裝備轉入城市永久庫存（＝商店庫存），core 的 member-retention-rule
    // 也把 `equipmentPurchase` 列為支出種類。
    tradePolicy: { tradable: true },
    display: { nameRef: { key: nameKey(blueprint.local, meta.tier) } },
    // 設計來源的 `value: Math.round(blueprint.baseValue * meta.priceScale)`。
    intrinsicValue: {
      currencyId: CURRENCY_ID,
      amount: Math.round(blueprint.baseValue * meta.priceScale),
    },
    unresolvedMapDisposition: 'toCityPermanentStock',
    equipmentKind: blueprint.equipmentKind,
    rarity: meta.rarity,
    relatedMasteryIds: blueprint.masteryLocals.map(masteryId),
    occupiedSlots: blueprint.placement.occupiedSlots,
    handSlots: blueprint.placement.handSlots,
    secondaryAttributeCoefficients: blueprint.baseRows.map((row) => scaleRow(row, meta.scale)),
    // 見檔頭：ability 的三段散文屬 combat 的 `equipment-effect`，本檔不填懸空引用。
    skillEffectRefs: [],
    // §2.4 武器射程；非武器省略。
    ...(reachCells === undefined ? {} : { reachCells }),
  };
}

// ── 顯示名的過渡出口 ────────────────────────────────────────────────────────
//
// `ItemDisplayDefinition` 只能存一個 `LocalizedTextRef`（key + params），存不了設計來源的中文
// 顯示名，所以 90 個名字在產物 JSON 裡是**看不到**的（見回報的契約缺口 4）。這份對照表把它們
// 留在作者層並匯出，讓在地化表的作者不必回頭重讀 `.data.mjs`；它不是 Definition，不進 pack。
export const YUNHUA_EQUIPMENT_DISPLAY_NAMES: Readonly<Record<string, string>> = Object.fromEntries(
  BLUEPRINTS.flatMap((blueprint) =>
    TIER_INDEXES.map((index) => [
      nameKey(blueprint.local, TIER_META[index].tier),
      blueprint.names[index],
    ]),
  ),
);

export const yunhuaEquipmentDomain: AuthoredDomain = {
  domain: 'equipment',
  definitions: BLUEPRINTS.flatMap((blueprint) =>
    TIER_INDEXES.map((index) => equipmentTier(blueprint, index)),
  ),
};
