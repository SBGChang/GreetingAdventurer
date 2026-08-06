// 雲華 V2 的「閱讀版與平衡審閱」資料來源。
// 這不是遊戲 Runtime JSON；正式實作時應依 docs/00_core/architecture/13_data_runtime.md
// 將每筆資料拆成對應的 Definition JSON。本檔只保證閱讀版與平衡數字有唯一來源。

const attributes = ['肌', '智', '反', '協', '魅'];
const round = value => Math.round(value * 100) / 100;
const vector = (muscle = 0, intelligence = 0, reaction = 0, coordination = 0, charisma = 0) => ({ muscle, intelligence, reaction, coordination, charisma });
const scaleVector = (value, scale) => Object.fromEntries(Object.entries(value).map(([key, amount]) => [key, round(amount * scale)]));
const row = (secondary, values) => ({ secondary, values });

export const balanceModel = {
  title: '雲華 V2｜數值平衡基準',
  version: '2026-08-06 / first playable balance pass',
  scope: '這份數值以雲華第一版兩城三圖為可玩基準，並以 Tier III～V 的成長比例延伸。它取代舊版 Bar、疲勞、位移與行動效率假設。',
  formulas: [
    ['生命上限', '200 + 肌 × 20', '肌 30／60／100 時為 800／1,400／2,200；讓第一代前期仍有容錯，後期不超過 GDD 目標。'],
    ['魔力上限', '120 + 智 × 14', '智 30／60／100 時為 540／960／1,520。'],
    ['熟練度係數', '依目前武器／防具／法杖／樂器 Mastery 等級套用', 'Lv.0～10 為 1.00／1.03／1.07／1.12／1.18／1.25／1.33／1.42／1.52／1.63／1.75。'],
    ['物理／魔法／樂器傷害', 'Σ(主屬 × 裝備係數) × 對應熟練度係數 × 技能威力', '物傷只引用肌、協；魔傷只引用智；樂器傷害用智、協、魅。'],
    ['命中率', 'clamp(15, 95, 70 + (命中分數 − 迴避分數) × 0.25)', '命中與迴避是分數，不是百分比。'],
    ['格擋成功率', 'clamp(0, 75, 格擋分數 × 0.25)', '格擋仍須由守勢／技能條件允許；不是常駐免傷。'],
    ['一般／魔法減傷', 'safeRaw = max(0, raw)；safeRaw / (safeRaw + 120)', 'raw 低於 0 時以 0 計；60／120／180 時約為 33%／50%／60%，避免負減傷與 −120 奇異點。'],
    ['格擋吸收', 'safeRaw = max(0, raw)；safeRaw / (safeRaw + 80)', 'raw 低於 0 時以 0 計；80／160／240 時約為 50%／67%／75%，只在成功格擋時生效。'],
    ['開場 CTB', 'max(22, 70 − 反 × 0.35 − 協 × 0.15)', '所有單位共用基礎 70；早期常見約 55，中期約 40，極限最低 22。'],
    ['單體期望傷害／CTB', '(傷害基礎 × Mastery × 技能威力 × 命中率) / 實際使用 CTB', '平衡夾具採可重複的 L0 傷害技能、單一目標與同一防禦 Profile；不是把 CTB 當成真實秒數。'],
    ['怪物物理傷害基礎', '(肌 × 1.20 + 協 × 0.45) × 威脅倍率', '一般／菁英／Boss 威脅倍率為 1.00／1.18／1.42；再乘技能威力。'],
    ['怪物魔法傷害基礎', '(智 × 1.25 + 協 × 0.20) × 威脅倍率', '非人類不需虛構武器係數；人類快速模擬也共用此 Profile。'],
    ['怪物命中分數', '反 × 0.40 + 協 × 0.55 + 智 × 0.10', '只有魔法與遠距技能使用智通道；最終命中仍走共用命中率公式。'],
  ],
  masteryMultipliers: [1.00, 1.03, 1.07, 1.12, 1.18, 1.25, 1.33, 1.42, 1.52, 1.63, 1.75],
  primaryBrackets: [
    ['Tier I', 'Lv.0～4', '相關主屬 25～40', '單手標準技能約 55～110；生命約 700～1,000。', '霧篁藥谷、舊漕渠與沉倉。'],
    ['Tier II', 'Lv.4～6', '相關主屬 40～60', '專精技能約 160～420；生命約 1,000～1,400。', '天衡印塔。'],
    ['Tier III', 'Lv.6～7', '相關主屬 60～75', '專精技能約 420～750；生命約 1,400～1,700。', '後續地區。'],
    ['Tier IV', 'Lv.7～8', '相關主屬 75～90', '專精技能約 900～1,450；生命約 1,700～2,000。', '國家深層。'],
    ['Tier V', 'Lv.8～10', '相關主屬 90～100', '雙手／雙手法杖主力單體約 1,900～2,500。', '世界級內容。'],
  ],
  delayProfiles: {
    quick: { id: 'rule.yunhua.delay.quick', label: '迅捷', base: 28, reductions: '反 −0.10／點、協 −0.06／點', reductionValues: { reaction: 0.10, coordination: 0.06 }, minimum: 14 },
    standard: { id: 'rule.yunhua.delay.standard', label: '標準', base: 36, reductions: '反 −0.10／點、協 −0.05／點', reductionValues: { reaction: 0.10, coordination: 0.05 }, minimum: 18 },
    heavy: { id: 'rule.yunhua.delay.heavy', label: '沉重', base: 48, reductions: '反 −0.08／點、協 −0.04／點', reductionValues: { reaction: 0.08, coordination: 0.04 }, minimum: 24 },
    cast: { id: 'rule.yunhua.delay.cast', label: '施術', base: 42, reductions: '智 −0.05／點、反 −0.06／點', reductionValues: { intelligence: 0.05, reaction: 0.06 }, minimum: 22 },
    perform: { id: 'rule.yunhua.delay.perform', label: '演奏', base: 40, reductions: '魅 −0.06／點、協 −0.05／點', reductionValues: { charisma: 0.06, coordination: 0.05 }, minimum: 20 },
    stance: { id: 'rule.yunhua.delay.stance', label: '架勢', base: 32, reductions: '反 −0.10／點、協 −0.05／點', reductionValues: { reaction: 0.10, coordination: 0.05 }, minimum: 16 },
  },
  statusRules: [
    ['瘴息', '負面', '命中、魔法命中 raw −18', '2 次目標行動', 'refresh'],
    ['破綻', '負面', '格擋與格擋吸收 raw −24', '2 次目標行動', 'refresh'],
    ['印痕', '負面', '魔法減傷 raw −30；減傷計算前最低夾在 0', '2 次目標行動', 'refresh'],
    ['護印', '正面', '魔法減傷 raw +36、預判 raw +14', '2 次目標行動', 'strongest'],
    ['定息', '正面', '命中 raw +18、格擋 raw +12', '2 次目標行動', 'strongest'],
  ],
  ctbAdjustments: [
    ['輕', '+8 CTB', '飛針、雷紙符、低階干擾。'],
    ['標準', '+14 CTB', '盾擊、長槍、鎖紋符。'],
    ['重', '+22 CTB', 'Boss 重擊、鎖鏈鏢、沉重符術。'],
    ['中斷', '取消讀條並 +16 CTB', '僅對正在 cast／perform 的目標。'],
  ],
  controlResistanceRules: [
    ['一般', '100%', '無額外限制。'],
    ['菁英', '75%', '單次 CTB 增加向下取整；同一次行動仍只採最強同類效果。'],
    ['Boss', '50%', '兩次自身行動之間，外來 CTB 增加合計最多 18；成功被中斷一次後，到完成下一次行動前免疫再次中斷。'],
  ],
  experience: [
    ['Tier I 一般群', '攻擊 320／防禦 80', '8～9 隻小型怪物加總後仍只是一筆 Encounter 預算。'],
    ['Tier I 菁英／Boss', '960／240；2,880／720', '分別是一般群 ×3、Boss ×9。'],
    ['Tier II 一般群', '800／200', '天衡印塔的普通遭遇。'],
    ['Tier II 菁英／Boss', '2,400／600；7,200／1,800', '第一版的最高戰鬥 MXP 來源。'],
    ['固定支援技能', '48／72／120／200 MXP', '依 L0／L3／高級／極品的技能層級；同技能每場最多 3 次。'],
  ],
};

const tierMeta = [
  { tier: 'I', rarity: '一般', scale: 1, priceScale: 1 },
  { tier: 'II', rarity: '精品', scale: 1.30, priceScale: 2.6 },
  { tier: 'III', rarity: '史詩', scale: 1.75, priceScale: 7 },
  { tier: 'IV', rarity: '傳說', scale: 2.25, priceScale: 22 },
  { tier: 'V', rarity: '神話', scale: 2.95, priceScale: 75 },
];

const makeEquipmentLine = (blueprint) => tierMeta.map((meta, index) => ({
  id: `equipment.yunhua.${blueprint.id}.${meta.tier.toLowerCase()}`,
  tier: meta.tier,
  rarity: meta.rarity,
  name: blueprint.names[index],
  requirement: blueprint.requirement,
  weight: blueprint.weights[index],
  value: Math.round(blueprint.baseValue * meta.priceScale),
  coefficients: blueprint.baseRows.map(entry => row(entry.secondary, scaleVector(entry.values, meta.scale))),
  ability: blueprint.abilities[index],
}));

const physical = (muscle, coordination) => row('物理傷害', vector(muscle, 0, 0, coordination));
const magic = intelligence => row('魔法傷害', vector(0, intelligence));
const instrument = (intelligence, coordination, charisma) => row('樂器傷害', vector(0, intelligence, 0, coordination, charisma));
const hit = (intelligence, reaction, coordination) => row('命中', vector(0, intelligence, reaction, coordination));
const evade = (intelligence, reaction, coordination) => row('迴避', vector(0, intelligence, reaction, coordination));
const predict = (intelligence, reaction) => row('預判', vector(0, intelligence, reaction));
const block = (reaction, coordination) => row('格擋', vector(0, 0, reaction, coordination));
const normalDr = muscle => row('一般減傷 raw', vector(muscle));
const magicDr = intelligence => row('魔法減傷 raw', vector(0, intelligence));
const blockAbsorb = muscle => row('格擋吸收 raw', vector(muscle));

const ability = (condition, effect, limit) => ({ condition, effect, limit });

export const equipmentCatalog = [
  {
    title: '武器｜單手物理',
    description: '單手武器可搭配副手盾、扇或第二把單手武器；雙持仍遵守左手 ×0.5、右手 ×0.35 的既定持握係數。',
    lines: [
      makeEquipmentLine({
        id: 'ring-saber', requirement: '環首刀／單手武器', baseValue: 80,
        names: ['環首短刀', '雲紋佩刀', '銀環柳葉刀', '斷潮佩刀', '御紋長刀'], weights: [6, 7, 8, 9, 10],
        baseRows: [physical(1.25, 0.95), hit(0, 0.22, 0.18), predict(0.08, 0.10)],
        abilities: [
          ability('使用 [slash] 命中。', '對目標施加破綻 2 行動。', '每名目標每 2 次自身行動最多 1 次。'),
          ability('使用 [counter] 且成功格擋。', '反擊傷害威力 +0.12。', '不適用副手技能。'),
          ability('使用 [slash] 命中帶破綻目標。', '額外 +8 CTB。', '每次技能僅 1 次。'),
          ability('使用「破綻追擊」命中。', '該次傷害威力 +0.20。', '只對帶破綻目標。'),
          ability('使用「斷流反擊」成功格擋。', '中斷讀條後追加 +8 CTB。', '每場對同一目標最多 2 次。'),
        ],
      }),
      makeEquipmentLine({
        id: 'iron-fan', requirement: '鐵骨扇／單手武器', baseValue: 70,
        names: ['鐵骨折扇', '漆紋鐵扇', '青玉開山扇', '鎮風羽扇', '百頁玄扇'], weights: [3, 3, 4, 4, 5],
        baseRows: [physical(0.85, 0.72), hit(0.10, 0.25, 0.22), predict(0.14, 0.16), magicDr(0.05)],
        abilities: [
          ability('使用 [guard]。', '自身定息強度 +8 raw。', '每次守勢僅一次。'),
          ability('使用 [slash] 命中。', '對目標施加破綻 1 行動。', '不疊加，改 refresh。'),
          ability('對隊友套用護印。', '護印額外 +10 魔法減傷 raw。', '只取最高扇類效果。'),
          ability('使用「扇影回護」。', '同時解除自身一個印痕。', '每場 2 次。'),
          ability('使用「百頁回環」成功反擊。', '中斷讀條後自身 CTB −10。', '最低 0；每場 2 次。'),
        ],
      }),
    ],
  },
  {
    title: '武器｜雙手物理',
    description: '長槍與偃刀共用雙手武器 Mastery，但透過 Weapon Requirement 與技能拆成精準突刺／範圍重擊兩條路線。偃刀是雙手重刃定位：失去副手與雙持彈性、命中係數低於單手刀，但可重複單體輸出／CTB 必須為物理武器最高。',
    lines: [
      makeEquipmentLine({
        id: 'spear', requirement: '長槍／雙手武器', baseValue: 105,
        names: ['棗木長槍', '青鐵長槍', '流雲槍', '鎖陣槍', '玄衡龍槍'], weights: [11, 12, 13, 14, 15],
        baseRows: [physical(1.70, 1.00), hit(0, 0.32, 0.24), predict(0.10, 0.18), block(0.08, 0.06)],
        abilities: [
          ability('使用 [thrust] 命中。', '目標 +8 CTB。', '每次技能僅 1 次。'),
          ability('使用 [counter] 成功格擋。', '反擊威力 +0.15。', '只對近戰技能。'),
          ability('使用 [thrust] 命中格擋目標。', '對目標施加破綻 2 行動。', '每名目標最多 1 層。'),
          ability('使用「穿陣突刺」命中。', '最後一名合法目標額外 +14 CTB。', '同欄每名只觸發 1 次。'),
          ability('使用「鎖陣槍勢」成功反擊。', '目標 +22 CTB。', '每場對同一目標最多 2 次。'),
        ],
      }),
      makeEquipmentLine({
        id: 'glaive', requirement: '偃刀／雙手武器', baseValue: 120,
        names: ['木柄偃刀', '月牙偃刀', '鐵脊偃刀', '斷岳偃刀', '九環大偃'], weights: [14, 16, 18, 20, 23],
        baseRows: [physical(2.05, 1.05), hit(0, 0.16, 0.18), normalDr(0.06), blockAbsorb(0.05)],
        abilities: [
          ability('使用 [sweep] 命中 2 名以上。', '自身 CTB −6。', '最低 0；每次技能 1 次。'),
          ability('使用 [heavy] 技能命中。', '對目標施加破綻 1 行動。', '每名目標 1 次。'),
          ability('使用「蓄勢斬」命中。', '額外 +14 CTB。', '每場對同一目標最多 2 次。'),
          ability('使用「斷甲橫掃」命中。', '破綻持續 +1 目標行動。', '不超過 3 行動。'),
          ability('使用「鎮關偃勢」成功反擊。', '反擊威力 +0.24 並中斷讀條。', '每場 2 次。'),
        ],
      }),
    ],
  },
  {
    title: '武器｜投擲與射擊',
    description: '投擲裝備與射擊裝備不消耗武器本體；消耗的是技能的 CTB 與必要時的戰鬥道具。它們不使用「彈藥耐久」系統。',
    lines: [
      makeEquipmentLine({
        id: 'needle', requirement: '飛針／投擲武器', baseValue: 68,
        names: ['飛針囊', '銅尾飛針', '鎖線飛鏢', '照影流星', '天羅鏢匣'], weights: [2, 2, 3, 3, 4],
        baseRows: [physical(0.55, 1.45), hit(0.08, 0.38, 0.28), predict(0.05, 0.16)],
        abilities: [
          ability('使用 [throw] 命中。', '目標 +8 CTB。', '每名目標每 2 次自身行動最多 1 次。'),
          ability('使用 [throw] 命中帶負面狀態目標。', '命中 raw +12（本次技能）。', '不疊加。'),
          ability('使用「封脈針」命中。', '印痕持續 +1 目標行動。', '不超過 3 行動。'),
          ability('使用 [throw] 命中正在讀條目標。', '中斷後額外 +8 CTB。', '每場對同一目標 2 次。'),
          ability('使用「百針散華」。', '每多命中一名目標，本次傷害威力 +0.05。', '最多 +0.20。'),
        ],
      }),
      makeEquipmentLine({
        id: 'chain-weight', requirement: '蒺藜／鏈鏢／投擲武器', baseValue: 92,
        names: ['鐵蒺藜袋', '青鐵流星錘', '鎖鏈鏢', '萬鈞繩錘', '九節鎮鎖'], weights: [5, 7, 8, 10, 12],
        baseRows: [physical(1.35, 1.05), hit(0, 0.30, 0.22), blockAbsorb(0.04)],
        abilities: [
          ability('使用 [throw] 命中。', '對目標施加破綻 1 行動。', '每名目標 1 次。'),
          ability('命中正在讀條的目標。', '中斷讀條。', '不額外造成中斷以外的 CTB。'),
          ability('使用「鎖鏈重擊」命中。', '目標 +14 CTB。', '每場對同一目標最多 2 次。'),
          ability('使用 [heavy] 命中。', '傷害威力 +0.16。', '不適用迅捷技能。'),
          ability('使用「九節鎖勢」命中。', '目標 +22 CTB。', '每場對同一目標 1 次。'),
        ],
      }),
      makeEquipmentLine({
        id: 'bamboo-bow', requirement: '竹弓／射擊武器', baseValue: 86,
        names: ['竹弓', '漆背角弓', '穿雲長弓', '鎮關鐵胎弓', '望舒神弓'], weights: [4, 5, 6, 7, 8],
        baseRows: [physical(0.60, 1.65), hit(0.12, 0.42, 0.32), predict(0.08, 0.16)],
        abilities: [
          ability('使用 [shot] 命中。', '本次對遠距目標命中 raw +8。', '不適用近距離。'),
          ability('使用「凝息瞄準」。', '定息額外 +8 命中 raw。', '只對自身。'),
          ability('使用「破甲箭」命中。', '對目標施加破綻 2 行動。', '每名目標 1 次。'),
          ability('使用「連珠三矢」同一目標命中 2 次。', '第三箭威力 +0.18。', '需三箭均合法。'),
          ability('使用「穿雲一箭」命中。', '無視目標 20% 格擋吸收 raw。', '不無視一般減傷。'),
        ],
      }),
      makeEquipmentLine({
        id: 'repeating-crossbow', requirement: '連珠弩／射擊武器', baseValue: 105,
        names: ['手弩', '連珠弩', '機簧重弩', '破城臂張弩', '天機重弩'], weights: [6, 8, 10, 13, 16],
        baseRows: [physical(0.85, 1.70), hit(0.08, 0.36, 0.30), predict(0.06, 0.12)],
        abilities: [
          ability('使用 [shot] 命中。', '目標 +8 CTB。', '每名目標每 2 次自身行動最多 1 次。'),
          ability('使用「急簧」命中。', '自身下一個射擊 CTB −6。', '最低 0；每 2 次自身行動 1 次。'),
          ability('使用「鎮弩射」命中。', '目標 +14 CTB。', '不與其他標準 CTB 效果重複。'),
          ability('使用「貫甲弩矢」命中。', '破綻強度 +10 raw。', '只對本次套用的破綻。'),
          ability('使用「天機齊發」。', '每命中一名不同目標，自身 CTB −4。', '最多 −12，最低 0。'),
        ],
      }),
    ],
  },
  {
    title: '武器｜法杖與樂器',
    description: '法杖技能與攻擊／防禦／祝福／詛咒魔法共用資料化 Routing；樂器傷害絕對命中且不吃一般減傷，支援演奏則走固定 MXP。',
    lines: [
      makeEquipmentLine({
        id: 'one-hand-staff', requirement: '桃木短杖／單手法杖', baseValue: 84,
        names: ['桃木短杖', '朱砂令杖', '墨玉符杖', '鎮紙玉杖', '司印權杖'], weights: [3, 4, 4, 5, 6],
        baseRows: [magic(2.35), hit(0.25, 0.22, 0.08), magicDr(0.06), predict(0.10, 0.08)],
        abilities: [
          ability('使用 [talisman] 單體技能。', '本次魔法命中 raw +8。', '不適用範圍符術。'),
          ability('使用 [ward]。', '護印額外 +8 魔法減傷 raw。', '只取最高單手法杖效果。'),
          ability('使用 [curse] 命中。', '印痕持續 +1 目標行動。', '不超過 3 行動。'),
          ability('使用「四角護印」。', '選定隊友同時獲得 +8 預判 raw。', '每場 2 次。'),
          ability('使用「封詔符」中斷讀條。', '中斷延遲額外 +8 CTB。', '每場對同一目標 2 次。'),
        ],
      }),
      makeEquipmentLine({
        id: 'two-hand-staff', requirement: '銅鈴長杖／雙手法杖', baseValue: 116,
        names: ['桑木長杖', '銅鈴長杖', '四象陣杖', '萬籙儀杖', '天衡法杖'], weights: [8, 10, 12, 14, 16],
        baseRows: [magic(2.90), hit(0.34, 0.22, 0.10), magicDr(0.09), predict(0.14, 0.10)],
        abilities: [
          ability('使用範圍 [talisman]。', '傷害威力 +0.08。', '不適用單體符術。'),
          ability('使用 [ward]。', '護印額外 +12 魔法減傷 raw。', '只取最高雙手法杖效果。'),
          ability('使用「連環火符」。', '第二名以後目標傷害衰減降低 0.05。', '最低仍保留資料定義的衰減。'),
          ability('使用「鎮界符」。', '全隊護印持續 +1 目標行動。', '不超過 3 行動。'),
          ability('使用「天衡落印」命中。', '對帶印痕目標傷害威力 +0.20。', '不重複計算印痕來源。'),
        ],
      }),
      makeEquipmentLine({
        id: 'bamboo-flute', requirement: '竹笛／管樂器', baseValue: 78,
        names: ['竹笛', '銅節簫', '清商玉笛', '鳳鳴長簫', '九霄龍笛'], weights: [2, 2, 3, 3, 4],
        baseRows: [instrument(0.42, 0.24, 0.50), hit(0.10, 0.18, 0.12), magicDr(0.04)],
        abilities: [
          ability('使用 [perform] 支援。', '定息額外 +8 命中 raw。', '只取最高管樂效果。'),
          ability('解除瘴息。', '額外扣減目標 CTB 6。', '最低 0；每名目標每場 2 次。'),
          ability('使用「和聲」。', '第二名目標的定息不衰減。', '不增加目標數。'),
          ability('使用「破音」中斷。', '中斷後目標 +8 CTB。', '每場對同一目標 2 次。'),
          ability('使用「回春長調」。', '治療威力 +0.16。', '不適用餐館／料理。'),
        ],
      }),
      makeEquipmentLine({
        id: 'seven-string', requirement: '七弦琴／弦樂器', baseValue: 88,
        names: ['桐木短琴', '漆面七弦', '雲水古琴', '斷金瑤琴', '大音無弦'], weights: [4, 5, 6, 7, 8],
        baseRows: [instrument(0.36, 0.30, 0.56), predict(0.12, 0.16), magicDr(0.07)],
        abilities: [
          ability('使用 [perform] 支援。', '護印額外 +8 魔法減傷 raw。', '只取最高弦樂效果。'),
          ability('解除印痕。', '同時自身獲得 +6 預判 raw。', '每場 2 次。'),
          ability('使用「迴紋曲」。', '定息與護印皆 +6 raw。', '不增加持續。'),
          ability('使用「離調」命中。', '印痕強度 +10 raw。', '只對本次套用。'),
          ability('使用「雲和止息」。', '全隊護印不因多目標衰減。', '每場 1 次。'),
        ],
      }),
    ],
  },
  {
    title: '防具與盾牌',
    description: '防具不直接提供大量傷害；重甲的防護優勢以迴避與命中向係數取捨，盾牌的主動效果只由盾牌技能觸發。',
    lines: [
      makeEquipmentLine({
        id: 'cloth', requirement: '布甲', baseValue: 54,
        names: ['青岑布衣', '素紋罩袍', '雲紗術袍', '五色道袍', '萬象法衣'], weights: [3, 4, 5, 5, 6],
        baseRows: [evade(0.10, 0.26, 0.12), magicDr(0.12), predict(0.08, 0.12)],
        abilities: [ability('持有法杖或樂器。', '魔法減傷 raw +6。', '持有其他主手時不生效。'), ability('使用 [ward]。', '護印 +8 raw。', '每次施放 1 次。'), ability('帶護印時受到魔法傷害。', '本次傷害再 −4%。', '每次受擊 1 次。'), ability('解除負面狀態。', '自身 CTB −6。', '最低 0；每場 2 次。'), ability('使用「雲和止息」或「鎮界符」。', '持續 +1 目標行動。', '不超過 3 行動。')],
      }),
      makeEquipmentLine({
        id: 'light-armor', requirement: '輕甲', baseValue: 68,
        names: ['竹面皮甲', '魚鱗輕甲', '雲紋皮札', '風羽鱗衣', '天游輕鎧'], weights: [7, 8, 9, 10, 11],
        baseRows: [evade(0.05, 0.34, 0.28), hit(0, 0.10, 0.12), normalDr(0.06)],
        abilities: [ability('成功閃避。', '自身 CTB −6。', '最低 0；每 2 次自身行動 1 次。'), ability('成功閃避。', '自身定息 +8 raw。', '每次閃避 1 次。'), ability('使用 [shot] 或 [throw]。', '本次命中 raw +10。', '不適用近戰。'), ability('帶定息時使用攻擊技能。', '本次傷害威力 +0.10。', '每次行動 1 次。'), ability('成功閃避後。', '解除自身破綻。', '每場 2 次。')],
      }),
      makeEquipmentLine({
        id: 'medium-armor', requirement: '中甲', baseValue: 90,
        names: ['皮襯札甲', '青鐵札甲', '鎖片明光甲', '虎紋山文甲', '玄衡中鎧'], weights: [13, 15, 17, 19, 21],
        baseRows: [normalDr(0.14), blockAbsorb(0.16), block(0.10, 0.08), evade(0, 0.08, 0.08)],
        abilities: [ability('成功格擋。', '自身 CTB −4。', '最低 0；每次守勢 1 次。'), ability('使用 [guard]。', '格擋吸收 raw +10。', '只在本次守勢。'), ability('成功格擋近戰技能。', '對攻擊者施加破綻 1 行動。', '每次守勢 1 次。'), ability('帶護印時受物理傷害。', '本次傷害 −5%。', '每次受擊 1 次。'), ability('成功格擋 Boss 技能。', '自身獲得定息。', '每場 2 次。')],
      }),
      makeEquipmentLine({
        id: 'heavy-armor', requirement: '重甲', baseValue: 125,
        names: ['鐵葉重札', '鎮關重鎧', '玄鱗重甲', '龍紋步人甲', '天衡玄甲'], weights: [21, 25, 29, 34, 40],
        baseRows: [normalDr(0.22), blockAbsorb(0.24), magicDr(0.05), evade(0, -0.06, -0.04)],
        abilities: [ability('受物理傷害。', '本次傷害 −4%。', '不與其他同類固定減傷重複。'), ability('成功格擋。', '自身護印 +8 raw。', '每次守勢 1 次。'), ability('生命低於 50%。', '一般減傷 raw +16。', '每場持續 1 次自身行動。'), ability('受 Boss 物理傷害。', '本次傷害再 −8%。', '每次受擊 1 次。'), ability('使用「不動如嶽」。', '己方前排獲得 +12 一般減傷 raw。', '每場 1 次。')],
      }),
      makeEquipmentLine({
        id: 'one-hand-shield', requirement: '單手盾', baseValue: 72,
        names: ['藤編小盾', '圓木鐵緣盾', '鐵面圓盾', '雲獸吞口盾', '玄龜寶盾'], weights: [5, 7, 9, 11, 13],
        baseRows: [block(0.28, 0.22), blockAbsorb(0.18), normalDr(0.04)],
        abilities: [ability('使用 [guard]。', '格擋 raw +10。', '只在本次守勢。'), ability('使用「卸勢」成功格擋。', '自身 CTB −8。', '最低 0；每次守勢 1 次。'), ability('使用「盾緣擊」命中。', '破綻強度 +10 raw。', '每名目標 1 次。'), ability('使用「掩護」。', '被掩護者獲得護印。', '每場 2 次。'), ability('使用「回盾反擊」成功。', '反擊威力 +0.20。', '每場 2 次。')],
      }),
      makeEquipmentLine({
        id: 'two-hand-shield', requirement: '雙手盾', baseValue: 108,
        names: ['木骨大牌', '漕關門盾', '鎮門塔盾', '岳紋方盾', '天柱巨盾'], weights: [16, 20, 25, 31, 38],
        baseRows: [block(0.36, 0.28), blockAbsorb(0.28), normalDr(0.10), magicDr(0.06)],
        abilities: [ability('使用 [guard]。', '格擋 raw +16、格擋吸收 raw +12。', '主手武器技能不可用。'), ability('使用「守線」。', '自身護印 +14 raw。', '每場 2 次。'), ability('使用「壁勢」。', '己方前排護印 +10 raw。', '每場 2 次。'), ability('使用「鎮門擊」命中。', '目標 +14 CTB。', '每名目標每場 2 次。'), ability('使用「不動如嶽」。', '全隊一般減傷 raw +12。', '每場 1 次。')],
      }),
    ],
  },
];

// 這是一個可重複執行的「單體傷害／CTB」夾具，不是完整 Encounter 模擬。
// 它只比較每條物理武器路線的可重複 L0 傷害技能，讓雙手重刃的高輸出定位
// 能被數字驗證；範圍命中、反擊、狀態、CTB 干擾與防禦效益留給 Encounter 試算。
const weaponDpsScenario = {
  label: 'Tier II 中期均衡單體',
  attributes: { muscle: 60, intelligence: 60, reaction: 60, coordination: 60, charisma: 0 },
  masteryLevel: 6,
  equipmentTier: 'II',
  targetEvasionScore: 100,
  targetDamageReductionRaw: 0,
  targetIsBlocking: false,
};

const fixtureWeaponRoutes = [
  ['ring-saber', '單手刀', '引環斬', 0.95, 'standard'],
  ['iron-fan', '鐵骨扇', '扇脊點打', 0.78, 'quick'],
  ['spear', '長槍', '守距突刺', 0.95, 'standard'],
  ['glaive', '雙手重刃（偃刀）', '起月斬', 1.05, 'standard'],
  ['needle', '飛針', '飛針', 0.72, 'quick'],
  ['chain-weight', '鏈鏢', '擲蒺藜', 0.88, 'standard'],
  ['bamboo-bow', '竹弓', '平射', 0.92, 'standard'],
  ['repeating-crossbow', '連珠弩', '弩矢射', 0.92, 'standard'],
];

const fixtureSum = values => Object.entries(values ?? {}).reduce((sum, [attribute, coefficient]) => sum + weaponDpsScenario.attributes[attribute] * coefficient, 0);
const fixtureDelay = delayRule => Math.max(delayRule.minimum, delayRule.base - Object.entries(delayRule.reductionValues).reduce((sum, [attribute, reduction]) => sum + weaponDpsScenario.attributes[attribute] * reduction, 0));
const fixtureWeapon = id => equipmentCatalog.flatMap(category => category.lines.flat()).find(item => item.id === `equipment.yunhua.${id}.${weaponDpsScenario.equipmentTier.toLowerCase()}`);
const fixtureCoefficient = (weapon, secondary) => weapon.coefficients.find(entry => entry.secondary === secondary)?.values ?? {};
const fixtureHitRate = (hitScore, targetEvasionScore) => Math.max(15, Math.min(95, 70 + (hitScore - targetEvasionScore) * 0.25));
const fixtureMastery = balanceModel.masteryMultipliers[weaponDpsScenario.masteryLevel];

const makeDpsRows = targetEvasionScore => fixtureWeaponRoutes.map(([id, route, repeatableSkill, skillPower, delayProfile]) => {
  const weapon = fixtureWeapon(id);
  if (!weapon) throw new Error(`武器 DPS 夾具找不到 Tier ${weaponDpsScenario.equipmentTier} 武器：${id}`);
  const rawDamage = fixtureSum(fixtureCoefficient(weapon, '物理傷害'));
  const hitScore = fixtureSum(fixtureCoefficient(weapon, '命中'));
  const hitRate = fixtureHitRate(hitScore, targetEvasionScore);
  const actionDelay = fixtureDelay(balanceModel.delayProfiles[delayProfile]);
  const expectedDamage = rawDamage * fixtureMastery * skillPower * (hitRate / 100);
  return {
    id,
    route,
    name: weapon.name,
    repeatableSkill,
    skillPower,
    rawDamage: round(rawDamage),
    hitScore: round(hitScore),
    hitRate: round(hitRate),
    actionDelay: round(actionDelay),
    expectedDamage: round(expectedDamage),
    expectedDamagePerCtb: round(expectedDamage / actionDelay),
  };
}).sort((left, right) => right.expectedDamagePerCtb - left.expectedDamagePerCtb);

const dpsRows = makeDpsRows(weaponDpsScenario.targetEvasionScore);

const oneHandDps = dpsRows.find(entry => entry.id === 'ring-saber');
const twoHandBladeDps = dpsRows.find(entry => entry.id === 'glaive');
if (!oneHandDps || !twoHandBladeDps || dpsRows[0]?.id !== 'glaive' || twoHandBladeDps.hitScore >= oneHandDps.hitScore) {
  throw new Error('DPS 夾具不符合雙手重刃：單體輸出最高且命中係數低於單手刀的設計不變量');
}

export const weaponDpsReview = {
  title: '武器單體期望輸出／CTB',
  scenario: weaponDpsScenario,
  rows: dpsRows.map(entry => ({ ...entry, versusOneHandPercent: round((entry.expectedDamagePerCtb / oneHandDps.expectedDamagePerCtb) * 100) })),
  evasionScenarios: [60, 100, 180].map(targetEvasionScore => ({
    targetEvasionScore,
    ranking: makeDpsRows(targetEvasionScore).map(entry => ({ name: entry.name, route: entry.route, expectedDamagePerCtb: entry.expectedDamagePerCtb })),
  })),
  invariant: {
    highestRoute: twoHandBladeDps.route,
    highestName: twoHandBladeDps.name,
    versusOneHandPercent: round((twoHandBladeDps.expectedDamagePerCtb / oneHandDps.expectedDamagePerCtb) * 100),
    explanation: '雙手重刃失去副手與雙持彈性，且命中分數低於單手刀；在可重複單體傷害的期望輸出／CTB 夾具中，仍必須是所有物理武器的第一名。',
  },
};

const delay = (profileKey) => balanceModel.delayProfiles[profileKey];
const acquisitionStages = ['L0 自動', 'L3 自動', '基礎書 Lv.3', '高級書 Lv.6', '極品書 Lv.10'];
const supportMxpByStage = [48, 48, 72, 120, 200];
const output = (kind, multiplier = null, channel = null) => ({ kind, multiplier, channel });
const powerText = value => {
  if (value.kind === 'none') return '無傷害';
  const labels = { damage: '傷害威力', counter: '反擊威力', heal: '治療威力' };
  return `${labels[value.kind]} ×${value.multiplier.toFixed(2)}`;
};
const actionKind = (kind, profileKey, resolvedOutput) => {
  if (profileKey === 'cast') return 'cast';
  if (profileKey === 'perform') return 'perform';
  if (kind.includes('守勢')) return 'guard';
  if (resolvedOutput.kind === 'damage') return 'attack';
  return 'support';
};
const masteryExperience = (route, resolvedOutput, stageIndex) => {
  if (resolvedOutput.kind === 'damage' || resolvedOutput.kind === 'counter') {
    if (resolvedOutput.channel === 'magic') return '傷害比例：法杖／攻擊魔法各 50%';
    return `傷害比例 → ${route} Mastery`;
  }
  return `固定支援 MXP ${supportMxpByStage[stageIndex]}`;
};
const skillSeries = (route, requirement, entries) => entries.map((entry, index) => {
  const [name, kind, profileKey, resolvedOutput, condition, effect, limit] = entry;
  return {
    route,
    stage: acquisitionStages[index],
    name,
    kind,
    actionKind: actionKind(kind, profileKey, resolvedOutput),
    requirement,
    delay: delay(profileKey),
    resolution: resolvedOutput,
    power: powerText(resolvedOutput),
    condition,
    effect,
    limit,
    masteryExperienceMode: resolvedOutput.kind === 'damage' || resolvedOutput.kind === 'counter' ? 'damage' : 'fixedSupport',
    experience: masteryExperience(route, resolvedOutput, index),
  };
});

const noPower = output('none');
const physicalDamage = multiplier => output('damage', multiplier, 'physical');
const magicDamage = multiplier => output('damage', multiplier, 'magic');
const instrumentDamage = multiplier => output('damage', multiplier, 'instrument');
const counterDamage = multiplier => output('counter', multiplier, 'physical');
const healing = multiplier => output('heal', multiplier, 'healing');

export const skillCatalog = [
  {
    title: '武技、盾技與演奏',
    description: '「傷害比例」表示依有效傷害分配怪物攻擊 MXP；固定支援 MXP 只有無傷害技能使用，並受同角色同技能每場最多三次限制。',
    rows: [
      ...skillSeries('環首刀', '主手・環首刀', [
        ['引環斬', '物理攻擊', 'standard', physicalDamage(0.95), '近距離單體。', '物理傷害。', '無。'],
        ['挑腕', '物理攻擊', 'quick', physicalDamage(0.82), '近距離單體。', '物理傷害；破綻 2 行動。', '每名目標 1 次。'],
        ['迎風架', '守勢／反擊', 'stance', counterDamage(0.85), '自身。', '建立格擋／反擊架勢。', '只對近戰成功格擋觸發。'],
        ['破綻追擊', '物理攻擊', 'standard', physicalDamage(1.22), '目標帶破綻。', '高物理傷害；額外 +8 CTB。', '未帶破綻不可用。'],
        ['斷流反擊', '守勢／反擊', 'stance', counterDamage(1.35), '自身。', '建立反擊架勢；成功時中斷讀條。', '架勢結束；每次架勢 1 次。'],
      ]),
      ...skillSeries('鐵骨扇', '主手・鐵骨扇', [
        ['扇脊點打', '物理攻擊', 'quick', physicalDamage(0.78), '近距離單體。', '低物理傷害。', '無。'],
        ['回風守勢', '支援', 'stance', noPower, '自身。', '定息。', '無傷害。'],
        ['拆式擊', '物理攻擊', 'standard', physicalDamage(0.90), '近距離單體。', '物理傷害；破綻 1 行動。', '無。'],
        ['扇影回護', '支援', 'standard', noPower, '自身或一名隊友。', '護印。', '無傷害。'],
        ['百頁回環', '守勢／反擊', 'stance', counterDamage(1.15), '自身。', '建立反擊架勢；成功時中斷讀條。', '只對近戰成功格擋。'],
      ]),
      ...skillSeries('長槍', '雙手・長槍', [
        ['守距突刺', '物理攻擊', 'standard', physicalDamage(0.95), '中距離單體。', '物理傷害；+8 CTB。', '近距離傷害 −20%。'],
        ['架槍迎擊', '守勢／反擊', 'stance', counterDamage(0.90), '自身。', '建立反擊架勢。', '只對近戰成功格擋。'],
        ['穿勢刺', '物理攻擊', 'standard', physicalDamage(1.08), '格擋中的單體。', '物理傷害；破綻 2 行動。', '目標未在守勢仍可傷害但不套破綻。'],
        ['穿陣突刺', '物理攻擊', 'heavy', physicalDamage(1.18), '同欄合法目標。', '沉重物理傷害。', '每名目標只命中 1 次。'],
        ['鎖陣槍勢', '守勢／反擊', 'stance', counterDamage(1.28), '自身。', '建立架勢；成功反擊 +22 CTB。', '每次架勢 1 次。'],
      ]),
      ...skillSeries('偃刀', '雙手・偃刀', [
        ['起月斬', '物理攻擊', 'standard', physicalDamage(1.05), '近距離單體。', '高肌力物理傷害。', '無。'],
        ['橫月掃', '物理攻擊', 'heavy', physicalDamage(0.85), '近距離最多 3 目標。', '範圍物理傷害。', '每多一目標傷害衰減 10%。'],
        ['蓄勢斬', '物理攻擊', 'heavy', physicalDamage(1.32), '近距離單體。', '高物理傷害；+14 CTB。', '沉重。'],
        ['斷甲橫掃', '物理攻擊', 'heavy', physicalDamage(1.18), '近距離最多 3 目標。', '物理傷害；破綻 2 行動。', '每名目標 1 次。'],
        ['鎮關偃勢', '守勢／反擊', 'stance', counterDamage(1.40), '自身。', '建立反擊架勢；成功時中斷讀條。', '每次架勢 1 次。'],
      ]),
      ...skillSeries('飛針', '主手・飛針', [
        ['飛針', '物理攻擊', 'quick', physicalDamage(0.72), '遠距單體。', '迅捷物理傷害。', '無。'],
        ['縛線針', '物理攻擊', 'quick', physicalDamage(0.62), '遠距單體。', '低傷害；+8 CTB。', '無。'],
        ['追影針', '物理攻擊', 'quick', physicalDamage(0.85), '帶負面狀態單體。', '命中 raw +12 的物理傷害。', '目標無負面時不可用。'],
        ['封脈針', '物理攻擊', 'standard', physicalDamage(1.02), '遠距單體。', '物理傷害；印痕 2 行動。', '無。'],
        ['百針散華', '物理攻擊', 'heavy', physicalDamage(1.12), '最多 3 名遠距目標。', '沉重投擲傷害。', '每多一目標傷害衰減 12%。'],
      ]),
      ...skillSeries('鏈鏢', '主手・鏈鏢', [
        ['擲蒺藜', '物理攻擊', 'standard', physicalDamage(0.88), '遠距單體。', '物理傷害。', '無。'],
        ['纏腕鏢', '物理攻擊', 'standard', physicalDamage(0.75), '遠距單體。', '物理傷害；破綻 1 行動。', '無。'],
        ['流星斷讀', '支援', 'quick', noPower, '正在讀條的遠距單體。', '中斷讀條。', '讀條外不可用。'],
        ['鎖鏈重擊', '物理攻擊', 'heavy', physicalDamage(1.25), '遠距單體。', '重物理傷害；+14 CTB。', '無。'],
        ['九節鎖勢', '物理攻擊', 'heavy', physicalDamage(1.42), '遠距單體。', '高物理傷害；+22 CTB。', '每場對同一目標 1 次。'],
      ]),
      ...skillSeries('竹弓', '雙手・竹弓', [
        ['平射', '物理攻擊', 'standard', physicalDamage(0.92), '遠距單體。', '物理傷害。', '無。'],
        ['凝息瞄準', '支援', 'stance', noPower, '自身。', '定息。', '無傷害。'],
        ['破甲箭', '物理攻擊', 'standard', physicalDamage(1.05), '遠距單體。', '物理傷害；破綻 2 行動。', '無。'],
        ['連珠三矢', '物理攻擊', 'heavy', physicalDamage(0.62), '遠距單體。', '三次獨立傷害。', '每次命中獨立判定。'],
        ['穿雲一箭', '物理攻擊', 'heavy', physicalDamage(1.48), '遠距單體。', '高命中高物理傷害。', '沉重。'],
      ]),
      ...skillSeries('連珠弩', '雙手・連珠弩', [
        ['弩矢射', '物理攻擊', 'standard', physicalDamage(0.92), '遠距單體。', '物理傷害。', '無。'],
        ['急簧', '物理攻擊', 'quick', physicalDamage(0.72), '遠距單體。', '迅捷物理傷害；命中後自身下一個射擊 CTB −6。', '最低 0；每 2 次自身行動 1 次。'],
        ['鎮弩射', '物理攻擊', 'standard', physicalDamage(0.90), '遠距單體。', '物理傷害；+14 CTB。', '無。'],
        ['貫甲弩矢', '物理攻擊', 'heavy', physicalDamage(1.18), '遠距單體。', '物理傷害；破綻 2 行動。', '無。'],
        ['天機齊發', '物理攻擊', 'heavy', physicalDamage(1.15), '最多 3 名遠距目標。', '沉重射擊傷害。', '每多一目標傷害衰減 12%。'],
      ]),
      ...skillSeries('單手盾', '副手・單手盾', [
        ['舉盾', '守勢', 'stance', noPower, '自身。', '建立格擋守勢。', '無傷害。'],
        ['卸勢', '支援', 'quick', noPower, '舉盾成功格擋後。', '自身 CTB −8。', '最低 0；每次守勢 1 次。'],
        ['盾緣擊', '物理攻擊', 'standard', physicalDamage(0.68), '舉盾成功格擋後的近距目標。', '低物理傷害；破綻 1 行動。', '每次守勢 1 次。'],
        ['掩護', '支援', 'stance', noPower, '一名隊友。', '套用護印。', '無傷害。'],
        ['回盾反擊', '守勢／反擊', 'stance', counterDamage(1.08), '自身。', '建立反擊架勢。', '成功格擋後觸發；每次架勢 1 次。'],
      ]),
      ...skillSeries('雙手盾', '雙手・大盾', [
        ['立盾', '守勢', 'stance', noPower, '自身。', '建立高格擋守勢。', '主手武器技能不可用。'],
        ['守線', '支援', 'stance', noPower, '自身。', '護印。', '無傷害。'],
        ['壁勢', '支援', 'stance', noPower, '己方前排。', '護印。', '無傷害。'],
        ['鎮門擊', '物理攻擊', 'heavy', physicalDamage(0.72), '成功格擋後近距目標。', '低物理傷害；+14 CTB。', '每次守勢 1 次。'],
        ['不動如嶽', '支援', 'heavy', noPower, '全隊。', '護印與一般減傷 raw +12。', '每場 1 次。'],
      ]),
      ...skillSeries('管樂器', '雙手・竹笛／管樂器', [
        ['定息調', '支援演奏', 'perform', noPower, '一名隊友。', '定息。', '無傷害。'],
        ['清瘴音', '支援演奏', 'perform', noPower, '一名隊友。', '解除瘴息；目標 CTB −6。', '無傷害；最低 0。'],
        ['和聲', '支援演奏', 'perform', noPower, '兩名隊友。', '定息。', '無傷害。'],
        ['破音', '樂器攻擊', 'perform', instrumentDamage(0.80), '正在讀條的敵方單體。', '樂器傷害；中斷讀條。', '無。'],
        ['回春長調', '支援演奏', 'perform', healing(1.15), '最多 3 名隊友。', '治療。', '無傷害。'],
      ]),
      ...skillSeries('弦樂器', '雙手・七弦琴／弦樂器', [
        ['安弦曲', '支援演奏', 'perform', noPower, '一名隊友。', '護印。', '無傷害。'],
        ['鎮心曲', '支援演奏', 'perform', noPower, '一名隊友。', '解除印痕。', '無傷害。'],
        ['迴紋曲', '支援演奏', 'perform', noPower, '一名隊友。', '護印與定息。', '無傷害。'],
        ['離調', '樂器攻擊', 'perform', instrumentDamage(0.72), '敵方單體。', '樂器傷害；印痕 2 行動。', '無。'],
        ['雲和止息', '支援演奏', 'perform', noPower, '全隊。', '護印。', '無傷害；每場 1 次。'],
      ]),
    ],
  },
  {
    title: '符術',
    description: '攻擊符術以法杖／攻擊魔法 50／50 分攻擊 MXP；無傷害符術以法杖／對應魔法 50／50 分固定支援 MXP。',
    rows: [
      ...skillSeries('攻擊魔法', '單手或雙手・法杖', [
        ['火符', '魔法攻擊', 'cast', magicDamage(0.95), '單體。', '魔法傷害。', '可被中斷。'],
        ['碎印符', '魔法攻擊', 'cast', magicDamage(0.88), '單體。', '魔法傷害；印痕 2 行動。', '可被中斷。'],
        ['雷紙符', '魔法攻擊', 'cast', magicDamage(0.92), '單體。', '魔法傷害；+8 CTB。', '可被中斷。'],
        ['連環火符', '魔法攻擊', 'cast', magicDamage(1.12), '最多 3 名目標。', '魔法傷害；每多一目標衰減 12%。', '雙手法杖；可被中斷。'],
        ['天衡落印', '魔法攻擊', 'cast', magicDamage(1.55), '最多 3 名目標。', '魔法傷害；帶印痕目標威力 +0.20。', '雙手法杖；每場 1 次；可被中斷。'],
      ]),
      ...skillSeries('防禦魔法', '單手或雙手・法杖', [
        ['小護符', '支援魔法', 'cast', noPower, '自身。', '護印。', '可被中斷。'],
        ['結界符', '支援魔法', 'cast', noPower, '一名隊友。', '護印。', '可被中斷。'],
        ['回元符', '支援魔法', 'cast', healing(0.85), '一名隊友。', '治療。', '可被中斷。'],
        ['四角護印', '支援魔法', 'cast', noPower, '最多 3 名隊友。', '護印。', '雙手法杖；可被中斷。'],
        ['鎮界符', '支援魔法', 'cast', noPower, '全隊。', '護印並解除一個印痕。', '雙手法杖；每場 1 次；可被中斷。'],
      ]),
      ...skillSeries('祝福魔法', '單手或雙手・法杖', [
        ['定息符', '支援魔法', 'cast', noPower, '一名隊友。', '定息。', '可被中斷。'],
        ['安神符', '支援魔法', 'cast', noPower, '一名隊友。', '解除瘴息。', '可被中斷。'],
        ['回春香符', '支援魔法', 'cast', healing(0.72), '一名隊友。', '治療；定息。', '可被中斷。'],
        ['同調符', '支援魔法', 'cast', noPower, '最多 3 名隊友。', '定息。', '可被中斷。'],
        ['長明祝符', '支援魔法', 'cast', healing(1.05), '全隊。', '治療；護印。', '每場 1 次；可被中斷。'],
      ]),
      ...skillSeries('詛咒魔法', '單手或雙手・法杖', [
        ['鎖紋符', '詛咒魔法', 'cast', noPower, '單體。', '印痕 2 行動。', '可被中斷。'],
        ['破綻符', '詛咒魔法', 'cast', noPower, '單體。', '破綻 2 行動。', '可被中斷。'],
        ['遲行符', '詛咒魔法', 'cast', noPower, '單體。', '+14 CTB。', '可被中斷。'],
        ['雙印連符', '詛咒魔法', 'cast', noPower, '單體。', '印痕與破綻各 2 行動。', '可被中斷。'],
        ['封詔符', '詛咒魔法', 'cast', noPower, '最多 3 名目標。', '印痕 2 行動；命中讀條則中斷。', '雙手法杖；每場 1 次；可被中斷。'],
      ]),
    ],
  },
];

const parseMonsterPower = power => {
  const match = /^(物傷|魔傷) ×([0-9.]+)$/.exec(power);
  if (!match) return noPower;
  return output('damage', Number(match[2]), match[1] === '物傷' ? 'physical' : 'magic');
};
const monsterSkill = (name, kind, profileKey, power, effect, limit) => ({
  name,
  kind,
  actionKind: profileKey === 'cast' ? 'cast' : kind === '守勢' ? 'guard' : kind === '支援' ? 'support' : 'attack',
  delay: delay(profileKey),
  resolution: parseMonsterPower(power),
  power,
  effect,
  limit,
});
const threatMultiplier = { 一般: 1, 菁英: 1.18, Boss: 1.42 };
const monsterAttackProfile = (stats, threat) => ({
  ruleId: 'rule.yunhua.monster-attack.standard',
  physicalBase: round((stats.muscle * 1.20 + stats.coordination * 0.45) * threatMultiplier[threat]),
  magicBase: round((stats.intelligence * 1.25 + stats.coordination * 0.20) * threatMultiplier[threat]),
  hitScore: round(stats.reaction * 0.40 + stats.coordination * 0.55 + stats.intelligence * 0.10),
});
const monster = (id, tier, threat, size, name, stats, role, skills, drops, encounter) => {
  const attackProfile = monsterAttackProfile(stats, threat);
  return {
    id,
    tier,
    threat,
    size,
    name,
    stats,
    role,
    attackProfile,
    controlResistanceProfileId: `rule.yunhua.control-resistance.${threat === 'Boss' ? 'boss' : threat === '菁英' ? 'elite' : 'normal'}`,
    skills: skills.map(entry => ({
      ...entry,
      estimatedRawDamage: entry.resolution.kind === 'damage'
        ? round((entry.resolution.channel === 'physical' ? attackProfile.physicalBase : attackProfile.magicBase) * entry.resolution.multiplier)
        : null,
    })),
    drops,
    encounter,
  };
};

export const monsterCatalog = {
  nonHuman: [
    monster('monster.yunhua.mistwing-moth', 'I', '一般', '小型 1×1', '瘴翅蛾', { health: 130, muscle: 3, intelligence: 22, reaction: 29, coordination: 13, charisma: 0 }, '群體遠程干擾', [monsterSkill('瘴粉撲翼', '魔法／遠距', 'quick', '魔傷 ×0.82', '瘴息 2 行動。', '一般敵人固定 1 招。')], '瘴翅粉、薄翅膜', '8～9 隻為一個一般群。'),
    monster('monster.yunhua.bamboo-back-badger', 'I', '一般', '小型 1×1', '竹背獾', { health: 170, muscle: 29, intelligence: 3, reaction: 18, coordination: 19, charisma: 0 }, '群體近戰壓力', [monsterSkill('掠地撲咬', '物理／近距', 'standard', '物傷 ×0.96', '物理傷害。', '一般敵人固定 1 招。')], '竹背皮、獾肉、獾腺囊', '8～9 隻為一個一般群。'),
    monster('monster.yunhua.tide-shell-crab', 'I', '一般', '小型 1×1', '潮殼蟹', { health: 160, muscle: 27, intelligence: 2, reaction: 12, coordination: 17, charisma: 0 }, '水道前排壓力', [monsterSkill('鉗殼夾擊', '物理／近距', 'standard', '物傷 ×0.90', '破綻 2 行動。', '一般敵人固定 1 招。')], '潮殼、蟹鉗', '8～9 隻為一個一般群。'),
    monster('monster.yunhua.scrap-sigil-doll', 'I', '一般', '小型 1×1', '殘頁符偶', { health: 125, muscle: 4, intelligence: 31, reaction: 19, coordination: 15, charisma: 0 }, '符術／魔防檢查', [monsterSkill('碎印射流', '魔法／遠距', 'cast', '魔傷 ×0.76', '印痕 2 行動。', '可被中斷。')], '殘符紙、舊朱砂', '8～9 隻為一個一般群。'),
    monster('monster.yunhua.miasma-pouch-badger', 'I', '菁英', '中型 2×2', '瘴囊獾母', { health: 460, muscle: 50, intelligence: 19, reaction: 24, coordination: 27, charisma: 0 }, '近戰與瘴息', [
      monsterSkill('肩背衝頂', '物理／近距', 'standard', '物傷 ×1.05', '+14 CTB。', '無。'),
      monsterSkill('瘴囊噴霧', '魔法／範圍', 'cast', '魔傷 ×0.72', '所有合法目標瘴息 2 行動。', '可被中斷。'),
      monsterSkill('伏背守毛', '守勢', 'stance', '無傷害', '自身一般減傷 raw +28。', '每 2 次自身行動最多 1 次。'),
    ], '完整獾腺、韌皮、獾肉', 'Tier I 菁英。'),
    monster('monster.yunhua.gatewater-salamander', 'I', '菁英', '中型 2×2', '閘水母螈', { health: 430, muscle: 38, intelligence: 25, reaction: 32, coordination: 24, charisma: 0 }, '單體 CTB 壓力', [
      monsterSkill('水閘躍咬', '物理／近距', 'standard', '物傷 ×1.00', '物理傷害。', '無。'),
      monsterSkill('冷水噴壓', '魔法／遠距', 'cast', '魔傷 ×0.80', '+14 CTB。', '可被中斷。'),
    ], '潮腺、濕鱗、沉水草', 'Tier I 菁英。'),
    monster('monster.yunhua.armored-pottery-guard', 'I', '菁英', '小型 1×1', '披甲陶衛', { health: 500, muscle: 55, intelligence: 15, reaction: 18, coordination: 26, charisma: 0 }, '守勢與破綻', [
      monsterSkill('陶戈重擊', '物理／近距', 'heavy', '物傷 ×1.12', '破綻 2 行動。', '無。'),
      monsterSkill('護印立勢', '守勢', 'stance', '無傷害', '自身護印。', '每 2 次自身行動最多 1 次。'),
      monsterSkill('鎖紋敲擊', '魔法／近距', 'standard', '魔傷 ×0.68', '印痕 2 行動。', '無。'),
    ], '陶衛甲片、窯印、銅扣', 'Tier I 菁英。'),
    monster('monster.yunhua.mist-bamboo-king', 'I', 'Boss', '大型 3×3', '霧篁獾王', { health: 2400, muscle: 78, intelligence: 20, reaction: 70, coordination: 36, charisma: 0 }, '藥谷 Boss', [
      monsterSkill('裂土前爪', '物理／近距', 'heavy', '物傷 ×1.32', '物理傷害。', '無。'),
      monsterSkill('瘴鳴嘶吼', '魔法／範圍', 'cast', '魔傷 ×0.70', '瘴息 2 行動。', '可被中斷。'),
      monsterSkill('鐵背伏守', '守勢', 'stance', '無傷害', '自身一般減傷 raw +42。', '每 2 次自身行動最多 1 次。'),
    ], '獾王硬皮、巨型腺囊、藥谷寶材', 'Tier I Boss；單獨出場。'),
    monster('monster.yunhua.sunken-weir-beast', 'I', 'Boss', '大型 3×3', '沉閘巨螈', { health: 2600, muscle: 72, intelligence: 28, reaction: 66, coordination: 39, charisma: 0 }, '水道 Boss', [
      monsterSkill('沉水咬壓', '物理／近距', 'heavy', '物傷 ×1.25', '+14 CTB。', '無。'),
      monsterSkill('濁浪噴壓', '魔法／範圍', 'cast', '魔傷 ×0.78', '+14 CTB。', '可被中斷。'),
      monsterSkill('潮鱗護體', '守勢', 'stance', '無傷害', '自身護印與一般減傷 raw +24。', '每 2 次自身行動最多 1 次。'),
      monsterSkill('閘鳴震波', '物理／範圍', 'heavy', '物傷 ×0.72', '所有近距目標 +14 CTB。', '每 3 次自身行動最多 1 次。'),
    ], '巨螈鱗、閘骨、沉貨殘件', 'Tier I Boss；單獨出場。'),
    monster('monster.yunhua.frayed-seal-wisp', 'II', '一般', '小型 1×1', '斷符游靈', { health: 270, muscle: 2, intelligence: 49, reaction: 35, coordination: 22, charisma: 0 }, '印塔群體施術', [monsterSkill('裂印飛白', '魔法／遠距', 'cast', '魔傷 ×0.88', '印痕 2 行動。', '一般敵人固定 1 招；可被中斷。')], '斷符墨、靈紙纖維', '8～9 隻為一個一般群。'),
    monster('monster.yunhua.bell-mandible-beetle', 'II', '一般', '小型 1×1', '銅鈴顎蟲', { health: 340, muscle: 50, intelligence: 7, reaction: 20, coordination: 26, charisma: 0 }, '高協調前排', [monsterSkill('鳴顎鉗擊', '物理／近距', 'standard', '物傷 ×1.03', '+8 CTB。', '一般敵人固定 1 招。')], '鈴殼、銅質顎片', '8～9 隻為一個一般群。'),
    monster('monster.yunhua.tower-stone-lizard', 'II', '一般', '中型 2×2', '塔脊石蜥', { health: 350, muscle: 52, intelligence: 12, reaction: 17, coordination: 29, charisma: 0 }, '中型單招敵人', [monsterSkill('石脊甩尾', '物理／近距', 'heavy', '物傷 ×1.08', '物理傷害。', '一般敵人固定 1 招。')], '石蜥脊片、印塔石粉', '一般敵人可為中型。'),
    monster('monster.yunhua.seal-halberd-warden', 'II', '菁英', '中型 2×2', '鎖印陶將', { health: 820, muscle: 74, intelligence: 31, reaction: 26, coordination: 43, charisma: 0 }, '破綻與護印', [
      monsterSkill('鎖戈直刺', '物理／近距', 'heavy', '物傷 ×1.18', '破綻 2 行動。', '無。'),
      monsterSkill('鎮印護身', '守勢', 'stance', '無傷害', '自身護印。', '每 2 次自身行動最多 1 次。'),
      monsterSkill('斷紋震擊', '魔法／近距', 'cast', '魔傷 ×0.82', '印痕 2 行動。', '可被中斷。'),
    ], '鎖印陶芯、陶將戈刃、銅鈴座', 'Tier II 菁英。'),
    monster('monster.yunhua.broken-edict-scribe', 'II', '菁英', '小型 1×1', '殘詔書吏', { health: 740, muscle: 13, intelligence: 76, reaction: 38, coordination: 34, charisma: 0 }, '高智詛咒', [
      monsterSkill('硃批穿符', '魔法／遠距', 'cast', '魔傷 ×1.00', '魔法傷害。', '可被中斷。'),
      monsterSkill('敕令鎖紋', '詛咒／遠距', 'cast', '無傷害', '+14 CTB；印痕 2 行動。', '可被中斷。'),
      monsterSkill('封卷護印', '守勢', 'stance', '無傷害', '自身護印。', '每 2 次自身行動最多 1 次。'),
    ], '古詔殘頁、官朱砂、封卷線', 'Tier II 菁英。'),
    monster('monster.yunhua.balance-seal-colossus', 'II', 'Boss', '大型 3×3', '天衡印俑', { health: 5200, muscle: 95, intelligence: 68, reaction: 74, coordination: 55, charisma: 0 }, '印塔 Boss', [
      monsterSkill('鎮印巨槌', '物理／近距', 'heavy', '物傷 ×1.40', '+22 CTB。', '無。'),
      monsterSkill('四方鎖符', '魔法／範圍', 'cast', '魔傷 ×0.90', '印痕 2 行動。', '可被中斷。'),
      monsterSkill('石甲回印', '守勢', 'stance', '無傷害', '自身一般減傷 raw +48、護印。', '每 2 次自身行動最多 1 次。'),
      monsterSkill('衡令震鳴', '魔法／範圍', 'heavy', '魔傷 ×0.68', '所有合法目標 +14 CTB。', '每 3 次自身行動最多 1 次。'),
    ], '天衡印石、鎮符銅心、極品書池', 'Tier II Boss；單獨出場。'),
  ],
  humanYunhua: [
    monster('monster.yunhua.river-cutthroat', 'I', '一般', '小型 1×1', '漕幫刀客', { health: 145, muscle: 27, intelligence: 7, reaction: 22, coordination: 21, charisma: 10 }, '單手近戰', [monsterSkill('撩刀斬', '物理／近距', 'standard', '物傷 ×0.95', '物理傷害。', '一般敵人固定 1 招。')], '環首刀零件、舊皮甲、漕運票根', '人類 Encounter 候選。'),
    monster('monster.yunhua.privateer-crossbow', 'I', '一般', '小型 1×1', '私運弩手', { health: 125, muscle: 10, intelligence: 10, reaction: 27, coordination: 28, charisma: 8 }, '遠程射擊', [monsterSkill('短弩急射', '物理／遠距', 'standard', '物傷 ×0.88', '命中讀條時中斷。', '一般敵人固定 1 招。')], '竹弩件、短矢、私運貨單', '人類 Encounter 候選。'),
    monster('monster.yunhua.salt-route-leader', 'I', '菁英', '小型 1×1', '鹽路頭目', { health: 470, muscle: 45, intelligence: 16, reaction: 28, coordination: 30, charisma: 20 }, '單手與支援', [
      monsterSkill('雙環斬', '物理／近距', 'standard', '物傷 ×1.10', '+14 CTB。', '無。'),
      monsterSkill('煙丸散布', '干擾／範圍', 'quick', '無傷害', '所有合法目標瘴息 2 行動。', '每場 2 次。'),
      monsterSkill('喝令定息', '支援', 'stance', '無傷害', '其他人類敵人定息。', '場上無其他人類敵人不可用。'),
    ], '精品單手武器候選、青鐵件、貨單', 'Tier I 人類菁英。'),
    monster('monster.yunhua.seal-tower-deserter', 'II', '一般', '小型 1×1', '守印逃卒', { health: 300, muscle: 52, intelligence: 18, reaction: 25, coordination: 30, charisma: 10 }, '制式長槍', [monsterSkill('制式槍刺', '物理／中距', 'standard', '物傷 ×1.04', '+8 CTB。', '一般敵人固定 1 招。')], '札甲件、制式槍頭、印塔通行牌', 'Tier II 人類 Encounter 候選。'),
    monster('monster.yunhua.false-seal-officer', 'II', '菁英', '小型 1×1', '偽印校尉', { health: 800, muscle: 68, intelligence: 36, reaction: 31, coordination: 40, charisma: 24 }, '刀術與護印', [
      monsterSkill('印刀斷勢', '物理／近距', 'heavy', '物傷 ×1.18', '破綻 2 行動。', '無。'),
      monsterSkill('官符護印', '守勢', 'stance', '無傷害', '自身護印。', '每 2 次自身行動最多 1 次。'),
      monsterSkill('追責符', '詛咒／遠距', 'cast', '無傷害', '+14 CTB。', '可被中斷。'),
    ], '史詩武器候選、官印銅件、古紙', 'Tier II 人類菁英。'),
  ],
};

export const consumables = {
  combat: [
    ['Tier I', '金瘡散', '重量 1／價值 24', '基礎 34；反 −0.10／點、協 −0.06／點；最低 18', '治療 120。', '基礎店貨與基礎製藥配方。'],
    ['Tier I', '清瘴丸', '重量 1／價值 28', '基礎 30；反 −0.10／點、協 −0.06／點；使用 CTB −4；最低 16', '解除瘴息。', '霧篁素材配方。'],
    ['Tier I', '醒神香', '重量 1／價值 36', '基礎 38；智 −0.05／點、反 −0.08／點；最低 20', '解除印痕。', '藥店與漕渠寶箱。'],
    ['Tier II', '回元膏', '重量 1／價值 110', '基礎 42；反 −0.08／點、協 −0.05／點；最低 24', '治療 240。', '高級製藥書。'],
    ['Tier II', '護印香丸', '重量 1／價值 135', '基礎 44；智 −0.06／點、反 −0.05／點；最低 26', '自身護印 2 行動。', '印塔素材配方。'],
    ['Tier III', '五草湯劑', '重量 1／價值 420', '基礎 48；智 −0.06／點、反 −0.06／點；最低 28', '治療 380；解除瘴息或印痕。', '探索配方，不進基礎店貨。'],
    ['Tier IV', '鎮心靈膏', '重量 1／價值 1,320', '基礎 42；智 −0.07／點、反 −0.06／點；最低 24', '治療 520；定息 2 行動。', 'Boss 素材與極品配方。'],
    ['Tier V', '回天膏', '重量 1／價值 4,600', '基礎 52；智 −0.07／點、反 −0.06／點；最低 30', '治療 720；解除一個負面；護印 2 行動。', '終局素材與 Boss 配方。'],
  ],
  nonCombat: [
    ['驅瘴香', 'Tier I／重量 1／價值 22', '零時間；地城非戰鬥', '解除一名角色的瘴霧環境狀態。', '只處理 Character 狀態；不改地圖內容或怪物。'],
    ['祛濕膏', 'Tier I／重量 1／價值 20', '零時間；地城非戰鬥', '解除一名角色的潮濕環境狀態。', '只處理 Character 狀態。'],
  ],
  general: [
    { title: '藥材與商貨', rows: [
      ['赤參根', 'Tier I', '1', '28', '購買、送貨、探索、城市永久庫存。'],
      ['霧篁茶磚', 'Tier I', '4', '46', '購買、送貨、酒館情報。'],
      ['沉水草束', 'Tier I', '1', '20', '探索、製藥與購買委託。'],
      ['藥竹筒', 'Tier I', '2', '34', '送貨、探索與工藝材料。'],
    ] },
    { title: '漕運貨物', rows: [
      ['漕運貨單', 'Tier I', '1', '38', '送貨、酒館情報。'],
      ['封蠟木匣', 'Tier I', '8', '120', '送貨、購買委託。'],
      ['青銅秤砣', 'Tier I', '5', '75', '探索、購買委託。'],
      ['濕損布卷', 'Tier I', '6', '90', '送貨、工藝加工與購買委託。'],
    ] },
    { title: '陶器與文物', rows: [
      ['侍從陶俑', 'Tier II', '12', '720', '探索、收藏、購買委託。'],
      ['青玉酒壺', 'Tier II', '4', '360', '探索、收藏與購買委託。'],
      ['窯印陶片', 'Tier I', '2', '85', '探索、工藝研究。'],
      ['銅燈架', 'Tier I', '7', '130', '探索、購買與住家布置。'],
    ] },
    { title: '家具', rows: [
      ['漆木書架', 'Tier I', '18', '220', '運送、購買與住家布置。'],
      ['藥材櫃', 'Tier II', '22', '460', '運送、購買與住家布置。'],
      ['竹編屏風', 'Tier I', '12', '250', '運送、購買與住家布置。'],
      ['矮案', 'Tier I', '14', '310', '運送、購買與住家布置。'],
    ] },
    { title: '紙本與文書', rows: [
      ['雲紋宣紙', 'Tier I', '1', '18', '購買、送貨、製符。'],
      ['古詔殘頁', 'Tier II', '1', '150', '探索、書籍事件與收藏。'],
      ['印塔抄本', 'Tier II', '2', '240', '探索、書籍事件與購買委託。'],
      ['書院帳冊', 'Tier I', '3', '180', '送貨、購買與酒館情報。'],
    ] },
  ],
};

export const craftingCatalog = {
  economyRules: [
    ['商店收購', '標示價值 ×50%', '所有工藝品使用同一基準；城市或事件修正另以 Price Modifier 處理。'],
    ['Tier I 工藝設施費', '每次 12', '目標淨利約 35～55／製作日。'],
    ['Tier II 工藝設施費', '每次 30', '目標淨利約 50～80／製作日；失敗仍消耗實際材料與日數。'],
  ],
  materials: [
    { title: '武器與工藝材料', rows: [
      ['青鐵錠', 'Tier I', '重量 2／價值 34', '勁直：物理傷害偏肌力', '鍛造刀、槍、偃刀、盾。'],
      ['霧篁藥竹', 'Tier I', '重量 1／價值 26', '快手：命中與迅捷技能', '弓、笛、輕甲、竹器。'],
    ] },
    { title: '防具與盾牌材料', rows: [
      ['竹背皮', 'Tier I', '重量 2／價值 32', '輕步：迴避與定息', '布甲、輕甲。'],
      ['潮殼', 'Tier I', '重量 2／價值 30', '定守：格擋與格擋吸收', '盾、中甲。'],
      ['鎖印陶芯', 'Tier II', '重量 3／價值 135', '不屈：一般減傷與守勢', '中重甲、雙手盾。'],
    ] },
    { title: '符術材料', rows: [
      ['印塔石', 'Tier II', '重量 3／價值 90', '刻印：符術命中與印痕', '法杖、符具、工藝品。'],
      ['官朱砂', 'Tier II', '重量 1／價值 110', '護印：護印與魔法減傷', '符杖、護印香丸。'],
      ['斷符墨', 'Tier II', '重量 1／價值 96', '破印：詛咒符與破綻方向', '符紙、單手扇。'],
    ] },
    { title: '樂器材料', rows: [
      ['鈴殼', 'Tier II', '重量 2／價值 100', '清音：樂器治療與解除方向', '樂器、藥香器。'],
    ] },
    { title: '製藥材料', rows: [
      ['瘴翅粉', 'Tier I', '重量 1／價值 18', '無詞條', '清瘴丸、驅瘴香。'],
      ['常見藥草', 'Tier I', '重量 1／價值 12', '無詞條', '金瘡散、清瘴丸、基礎料理。'],
      ['赤參根', 'Tier I', '重量 1／價值 28', '暖食：料理治療方向', '金瘡散、Tier I～II 料理。'],
      ['沉水草', 'Tier I', '重量 1／價值 20', '冷食：料理解除／護印方向', '膏藥、Tier I 料理。'],
    ] },
    { title: '料理材料', rows: [
      ['獾肉', 'Tier I', '重量 2／價值 24', '暖食：料理治療方向', 'Tier I～II 料理。'],
      ['穀物', 'Tier I', '重量 1／價值 8', '飽足：一般防護方向', '粥、湯餅與餐館基礎料理。'],
      ['魚材', 'Tier I', '重量 2／價值 16', '鮮味：命中方向', '魚羹與蒸魚。'],
      ['香草', 'Tier I', '重量 1／價值 14', '清香：定息與解除方向', '湯飲與蒸魚。'],
      ['藥泉薑根', 'Tier II', '重量 1／價值 74', '護食：料理護印方向', 'Tier II 料理、回元膏。'],
      ['獾王肉材', 'Tier II', '重量 4／價值 110', '雄健：高量治療與一般防護方向', 'Tier II Boss 料理。'],
    ] },
  ],
  affixes: [
    ['勁直', '青鐵錠', '武器／盾牌', '物理傷害係數向肌力傾斜。'],
    ['快手', '霧篁藥竹', '弓、笛、輕甲、竹器', '命中係數與迅捷型技能效果方向。'],
    ['輕步', '竹背皮', '布甲／輕甲', '迴避係數與定息方向。'],
    ['定守', '潮殼', '盾牌／中甲', '格擋與格擋吸收 raw 方向。'],
    ['不屈', '鎖印陶芯', '中重甲／雙手盾', '一般減傷 raw 與守勢方向。'],
    ['刻印', '印塔石', '法杖／符具／工藝品', '符術命中與印痕方向。'],
    ['護印', '官朱砂', '符杖／藥香器', '護印與魔法減傷 raw 方向。'],
    ['破印', '斷符墨', '符紙／單手扇', '詛咒符與破綻方向。'],
    ['清音', '鈴殼', '竹笛／七弦琴／藥香器', '演奏治療、解除與定息方向。'],
    ['暖食', '赤參根／獾肉', '料理', '治療與一般防護方向。'],
    ['飽足', '穀物', '料理', '一般防護方向。'],
    ['鮮味', '魚材', '料理', '命中方向。'],
    ['清香', '香草', '料理', '定息與解除方向。'],
    ['冷食', '沉水草', '料理／膏藥', '護印與解除負面方向。'],
    ['護食', '藥泉薑根', '料理／膏藥', '護印與印痕解除方向。'],
    ['雄健', '獾王肉材', '料理', '高量治療與一般防護方向。'],
  ],
  recipes: [
    { title: '裝備製作｜Tier I 一般', rows: [
      ['環首短刀', '一般／1 日／MXP 400', '青鐵錠 ×1', '裝備；品質決定 0～1 條詞條。'],
      ['鐵骨折扇', '一般／1 日／MXP 400', '青鐵錠 ×1', '裝備；品質決定 0～1 條詞條。'],
      ['棗木長槍', '一般／1 日／MXP 400', '霧篁藥竹 ×1', '裝備；品質決定 0～1 條詞條。'],
      ['木柄偃刀', '一般／1 日／MXP 400', '青鐵錠 ×1', '裝備；品質決定 0～1 條詞條。'],
      ['飛針囊', '一般／1 日／MXP 400', '青鐵錠 ×1', '裝備；品質決定 0～1 條詞條。'],
      ['鐵蒺藜袋', '一般／1 日／MXP 400', '青鐵錠 ×1', '裝備；品質決定 0～1 條詞條。'],
      ['竹弓', '一般／1 日／MXP 400', '霧篁藥竹 ×1', '裝備；品質決定 0～1 條詞條。'],
      ['手弩', '一般／1 日／MXP 400', '霧篁藥竹 ×1', '裝備；品質決定 0～1 條詞條。'],
      ['桃木短杖', '一般／1 日／MXP 400', '霧篁藥竹 ×1', '裝備；品質決定 0～1 條詞條。'],
      ['桑木長杖', '一般／1 日／MXP 400', '霧篁藥竹 ×1', '裝備；品質決定 0～1 條詞條。'],
      ['竹笛', '一般／1 日／MXP 400', '霧篁藥竹 ×1', '裝備；品質決定 0～1 條詞條。'],
      ['桐木短琴', '一般／1 日／MXP 400', '霧篁藥竹 ×1', '裝備；品質決定 0～1 條詞條。'],
      ['青岑布衣', '一般／1 日／MXP 400', '竹背皮 ×1', '裝備；品質決定 0～1 條詞條。'],
      ['竹面皮甲', '一般／1 日／MXP 400', '竹背皮 ×1', '裝備；品質決定 0～1 條詞條。'],
      ['皮襯札甲', '一般／1 日／MXP 400', '潮殼 ×1', '裝備；品質決定 0～1 條詞條。'],
      ['鐵葉重札', '一般／1 日／MXP 400', '青鐵錠 ×1', '裝備；品質決定 0～1 條詞條。'],
      ['藤編小盾', '一般／1 日／MXP 400', '霧篁藥竹 ×1', '裝備；品質決定 0～1 條詞條。'],
      ['木骨大牌', '一般／1 日／MXP 400', '霧篁藥竹 ×1', '裝備；品質決定 0～1 條詞條。'],
    ] },
    { title: '裝備製作｜Tier II 精品', rows: [
      ['雲紋佩刀', '精品／2 日／MXP 1,000', '青鐵錠 ×1、潮殼 ×1', '裝備；品質決定 0～2 條詞條。'],
      ['漆紋鐵扇', '精品／2 日／MXP 1,000', '青鐵錠 ×1、斷符墨 ×1', '裝備；品質決定 0～2 條詞條。'],
      ['青鐵長槍', '精品／2 日／MXP 1,000', '青鐵錠 ×1、霧篁藥竹 ×1', '裝備；品質決定 0～2 條詞條。'],
      ['月牙偃刀', '精品／2 日／MXP 1,000', '青鐵錠 ×1、印塔石 ×1', '裝備；品質決定 0～2 條詞條。'],
      ['銅尾飛針', '精品／2 日／MXP 1,000', '青鐵錠 ×1、斷符墨 ×1', '裝備；品質決定 0～2 條詞條。'],
      ['青鐵流星錘', '精品／2 日／MXP 1,000', '青鐵錠 ×1、潮殼 ×1', '裝備；品質決定 0～2 條詞條。'],
      ['漆背角弓', '精品／2 日／MXP 1,000', '霧篁藥竹 ×1、竹背皮 ×1', '裝備；品質決定 0～2 條詞條。'],
      ['連珠弩', '精品／2 日／MXP 1,000', '霧篁藥竹 ×1、青鐵錠 ×1', '裝備；品質決定 0～2 條詞條。'],
      ['朱砂令杖', '精品／2 日／MXP 1,000', '霧篁藥竹 ×1、官朱砂 ×1', '裝備；品質決定 0～2 條詞條。'],
      ['銅鈴長杖', '精品／2 日／MXP 1,000', '霧篁藥竹 ×1、鈴殼 ×1', '裝備；品質決定 0～2 條詞條。'],
      ['銅節簫', '精品／2 日／MXP 1,000', '霧篁藥竹 ×1、鈴殼 ×1', '裝備；品質決定 0～2 條詞條。'],
      ['漆面七弦', '精品／2 日／MXP 1,000', '霧篁藥竹 ×1、鈴殼 ×1', '裝備；品質決定 0～2 條詞條。'],
      ['素紋罩袍', '精品／2 日／MXP 1,000', '竹背皮 ×1、官朱砂 ×1', '裝備；品質決定 0～2 條詞條。'],
      ['魚鱗輕甲', '精品／2 日／MXP 1,000', '竹背皮 ×1、潮殼 ×1', '裝備；品質決定 0～2 條詞條。'],
      ['青鐵札甲', '精品／2 日／MXP 1,000', '青鐵錠 ×1、竹背皮 ×1', '裝備；品質決定 0～2 條詞條。'],
      ['鎮關重鎧', '精品／2 日／MXP 1,000', '青鐵錠 ×1、鎖印陶芯 ×1', '裝備；品質決定 0～2 條詞條。'],
      ['圓木鐵緣盾', '精品／2 日／MXP 1,000', '霧篁藥竹 ×1、青鐵錠 ×1', '裝備；品質決定 0～2 條詞條。'],
      ['漕關門盾', '精品／2 日／MXP 1,000', '霧篁藥竹 ×1、潮殼 ×1', '裝備；品質決定 0～2 條詞條。'],
    ] },
    { title: '製藥', rows: [
      ['金瘡散', 'Tier I／1 日／MXP 400', '赤參根 ×1、常見藥草 ×1', '消耗品；成功產量 2，製藥 Lv.4 起每 2 級 +1。'],
      ['清瘴丸', 'Tier I／1 日／MXP 400', '瘴翅粉 ×1、常見藥草 ×1', '消耗品；成功產量 2，製藥 Lv.4 起每 2 級 +1。'],
      ['回元膏', 'Tier II／2 日／MXP 1,000', '赤參根 ×1、沉水草 ×1、藥泉薑根 ×1', '消耗品；成功產量 2，製藥 Lv.4 起每 2 級 +1。'],
    ] },
    { title: '工藝', rows: [
      ['漆木書架', 'Tier I／1 日／MXP 400／設施費 12', '霧篁藥竹 ×2', 'Trade Good；基準收購 110，成功時基準淨利 46／日；品質只改出售倍率。'],
      ['侍從陶俑', 'Tier II／2 日／MXP 1,000／設施費 30', '鎖印陶芯 ×1、印塔石 ×1', 'Trade Good；基準收購 360，成功時基準淨利 52.5／日；品質只改出售倍率。'],
    ] },
  ],
  cuisine: [
    ['竹筍肉湯', 'Tier I／MXP 400／維持 3 日', '霧篁藥竹＋獾肉', '定息、一般防護方向', '青岑餐館版本：所有詞條 Tier 1，MXP 133。'],
    ['赤參粥', 'Tier I／MXP 400／維持 3 日', '赤參根＋穀物', '治療、定息方向', '青岑餐館版本：所有詞條 Tier 1，MXP 133。'],
    ['漕河魚羹', 'Tier I／MXP 400／維持 3 日', '沉水草＋魚材', '護印、解除方向', '雲京餐館版本：所有詞條 Tier 1，MXP 133。'],
    ['藥泉燉肉', 'Tier II／MXP 1,000／維持 6 日', '獾王肉材＋赤參根', '一般防護、治療方向', '只能自製。'],
    ['藥泉薑湯', 'Tier II／MXP 1,000／維持 6 日', '藥泉薑根＋香草', '護印、印痕解除方向', '只能自製。'],
    ['清音蒸魚', 'Tier II／MXP 1,000／維持 6 日', '香草＋魚材＋藥泉薑根', '命中、定息與護印方向', '只能自製。'],
  ],
  books: {
    skill: [
      { title: '基礎', rows: [
        ['《環首刀譜・入門》', 'Lv.3', '書店', '環首刀基礎技能。'],
        ['《鐵扇拆式》', 'Lv.3', '書店', '鐵骨扇基礎技能。'],
        ['《長槍守距》', 'Lv.3', '書店', '長槍基礎技能。'],
        ['《偃月起勢》', 'Lv.3', '書店', '偃刀基礎技能。'],
        ['《飛針照影》', 'Lv.3', '書店', '飛針基礎技能。'],
        ['《鏈鏢斷讀》', 'Lv.3', '書店', '鏈鏢基礎技能。'],
        ['《竹弓破甲》', 'Lv.3', '書店', '竹弓基礎技能。'],
        ['《連珠鎮簧》', 'Lv.3', '書店', '連珠弩基礎技能。'],
        ['《藤盾反手》', 'Lv.3', '書店', '單手盾基礎技能。'],
        ['《大牌壁勢》', 'Lv.3', '書店', '雙手盾基礎技能。'],
        ['《青岑符法》', 'Lv.3', '書店', '基礎攻擊／防禦符術。'],
        ['《祝詛符要》', 'Lv.3', '書店', '基礎祝福／詛咒符術。'],
        ['《竹笛小調》', 'Lv.3', '書店', '管樂器基礎演奏。'],
        ['《七弦迴紋》', 'Lv.3', '書店', '弦樂器基礎演奏。'],
      ] },
      { title: '高級', rows: [
        ['《斷潮刀訣》', 'Lv.6', '探索寶箱', '環首刀高級技能。'],
        ['《扇影護式》', 'Lv.6', '探索寶箱', '鐵骨扇高級技能。'],
        ['《穿陣槍卷》', 'Lv.6', '探索寶箱', '長槍高級技能。'],
        ['《斷甲偃譜》', 'Lv.6', '探索寶箱', '偃刀高級技能。'],
        ['《封脈針錄》', 'Lv.6', '探索寶箱', '飛針高級技能。'],
        ['《鎖鏈重擊譜》', 'Lv.6', '探索寶箱', '鏈鏢高級技能。'],
        ['《連珠箭訣》', 'Lv.6', '探索寶箱', '竹弓高級技能。'],
        ['《漕關盾術》', 'Lv.6', '探索寶箱', '單手／雙手盾高級技能。'],
        ['《印塔殘卷》', 'Lv.6', '探索寶箱', '高級符術。'],
        ['《連珠機簧錄》', 'Lv.6', '探索寶箱', '連珠弩高級技能。'],
        ['《清商長調》', 'Lv.6', '探索寶箱', '管樂器高級演奏。'],
        ['《雲水琴譜》', 'Lv.6', '探索寶箱', '弦樂器高級演奏。'],
      ] },
      { title: '極品', rows: [
        ['《天衡印譜》', 'Lv.10', 'Boss', '極品符術。'],
        ['《斷流反擊要訣》', 'Lv.10', 'Boss', '環首刀極品反擊。'],
        ['《百頁回環》', 'Lv.10', 'Boss', '鐵骨扇極品反擊。'],
        ['《鎖陣槍勢》', 'Lv.10', 'Boss', '長槍極品反擊。'],
        ['《鎮關偃勢》', 'Lv.10', 'Boss', '偃刀極品反擊。'],
        ['《百針散華》', 'Lv.10', 'Boss', '飛針極品技能。'],
        ['《九節鎮鎖》', 'Lv.10', 'Boss', '鏈鏢極品技能。'],
        ['《穿雲一箭》', 'Lv.10', 'Boss', '竹弓極品技能。'],
        ['《天機齊發》', 'Lv.10', 'Boss', '連珠弩極品技能。'],
        ['《回盾反擊》', 'Lv.10', 'Boss', '單手盾極品反擊。'],
        ['《不動如嶽》', 'Lv.10', 'Boss', '雙手盾極品守勢。'],
        ['《回春長調》', 'Lv.10', 'Boss', '管樂器極品演奏。'],
        ['《大音無弦》', 'Lv.10', 'Boss', '弦樂器極品演奏。'],
      ] },
    ],
    crafting: [
      { title: '基礎', rows: [
        ['《青鐵鍛作》', 'Lv.3', '書店', 'Tier I 鍛造配方。'],
        ['《竹紙製符》', 'Lv.3', '書店', 'Tier I 製符／製藥配方。'],
        ['《山藥散方》', 'Lv.3', '書店', 'Tier I 製藥配方。'],
        ['《家常湯餅》', 'Lv.3', '書店', 'Tier I 料理配方。'],
      ] },
      { title: '高級', rows: [
        ['《沉倉藥錄》', 'Lv.6', '探索寶箱', 'Tier II 製藥配方。'],
        ['《鎖印陶作》', 'Lv.6', '探索寶箱', 'Tier II 鍛造／工藝配方。'],
        ['《藥泉食單》', 'Lv.6', '探索寶箱', 'Tier II～III 料理配方。'],
      ] },
      { title: '極品', rows: [
        ['《五材百器》', 'Lv.10', 'Boss', 'Tier IV～V 裝備／工藝配方。'],
        ['《天衡宴錄》', 'Lv.10', 'Boss', 'Tier IV～V 料理配方。'],
      ] },
    ],
  },
};

export const firstMapConfigs = [
  {
    name: '霧篁藥谷', city: '青岑城', tier: 'Tier I', kind: '野外', layout: '固定單層 8×8',
    entryExit: '西南入口；東北出口。',
    configuration: '竹林岔道與架高棧道構成主路；兩條支線通往寶箱偏好房；中央 2×2 空地是大型體型敵人的合法偏好房；瘴氣與落穴為固定陷阱；紅門 1 扇。',
    materialPools: {
      gathering: [['霧篁藥竹', 32], ['常見藥草', 25], ['赤參根', 18], ['沉水草', 10], ['穀物', 8], ['香草', 7]],
      treasure: [['霧篁藥竹', 24], ['常見藥草', 18], ['赤參根', 16], ['青鐵錠', 14], ['竹背皮', 12], ['潮殼', 9], ['瘴翅粉', 7]],
    },
  },
  {
    name: '舊漕渠與沉倉', city: '雲京', tier: 'Tier I', kind: '水道／倉儲內部', layout: '5×5；地上 1 層＋地下 1 層',
    entryExit: '地上水道入口；地下水門出口。',
    configuration: '地上東側沉倉與入口區不在同層連通；必須從西側同座標樓梯下至地下蓄水池、橫越暗渠，再回到東側樓梯。倉架與沉貨區為寶箱偏好房，寬廣閘室才可為大型體型敵人偏好房；紅門 2 扇。',
    materialPools: {
      gathering: [['沉水草', 30], ['魚材', 24], ['常見藥草', 16], ['香草', 12], ['潮殼', 10], ['霧篁藥竹', 8]],
      treasure: [['青鐵錠', 26], ['潮殼', 22], ['霧篁藥竹', 15], ['赤參根', 12], ['竹背皮', 10], ['常見藥草', 8], ['瘴翅粉', 7]],
    },
  },
  {
    name: '天衡印塔', city: '雲京', tier: 'Tier II', kind: '建築型國家迷宮／符印塔', layout: '6×6；塔 1～4F＋地下 1～2F',
    entryExit: '塔 1F 入口；塔 4F 觀印台出口。',
    configuration: '六層的上下樓梯均採同座標對齊；地下兩層為封印庫與地脈室的可選支線，主路徑經校印廊、藏卷層抵達觀印台。大型體型敵人的合法偏好房只在塔 4F 的 2×2 觀印台；門與符印陷阱固定。',
    materialPools: {
      gathering: [['印塔石', 34], ['官朱砂', 28], ['斷符墨', 22], ['香草', 9], ['霧篁藥竹', 7]],
      treasure: [['印塔石', 25], ['官朱砂', 22], ['斷符墨', 18], ['鈴殼', 14], ['鎖印陶芯', 10], ['青鐵錠', 7], ['藥泉薑根', 4]],
    },
  },
];

// 格圖資料只描述 Map Template：怪物種類不在此處指定；◆ 素材點只讀 gathering，寶箱只讀 treasure，怪物掉落由 Monster Definition 擁有。
const mapCell = (row, column) => `${row},${column}`;
const mapRect = (rowStart, columnStart, rowEnd, columnEnd) => {
  const cells = [];
  for (let row = rowStart; row <= rowEnd; row += 1) for (let column = columnStart; column <= columnEnd; column += 1) cells.push(mapCell(row, column));
  return cells;
};
const mapRoom = (id, cells, options = {}) => ({ id, cells, marks: [], ...options });
const mapConnection = (from, to, fromCell, toCell, type = 'open') => ({ from, to, fromCell, toCell, type });
const mapFloor = (label, rows, columns, rooms, connections, note) => ({ label, rows, columns, rooms, connections, note });

const herbValley = mapFloor('單層｜野外 8×8', 8, 8, [
  mapRoom('入口竹徑', [mapCell(8, 1)], { entry: true }),
  mapRoom('南側山徑', [mapCell(8, 2), mapCell(8, 3), mapCell(7, 2), mapCell(7, 3)], { marks: ['resource'], anchor: mapCell(8, 3) }),
  mapRoom('瘴氣裂縫', [mapCell(7, 4)], { marks: ['trap'] }),
  mapRoom('西側竹叢', [mapCell(6, 2), mapCell(6, 3), mapCell(5, 2), mapCell(5, 3), mapCell(5, 4)], { marks: ['treasure'], anchor: mapCell(5, 3) }),
  mapRoom('採藥台地', [mapCell(4, 3), mapCell(4, 4), mapCell(3, 3), mapCell(3, 4)], { marks: ['event'], anchor: mapCell(4, 3) }),
  mapRoom('中央空地', mapRect(4, 5, 5, 6), { marks: ['large'], anchor: mapCell(4, 5) }),
  mapRoom('東側棧道', [mapCell(5, 7), mapCell(4, 7), mapCell(3, 7), mapCell(3, 8), mapCell(2, 8)], { marks: ['resource'], anchor: mapCell(4, 7) }),
  mapRoom('崩裂棧板', [mapCell(2, 7)], { marks: ['trap'] }),
  mapRoom('北側藥棚', [mapCell(3, 5), mapCell(2, 4), mapCell(2, 5), mapCell(2, 6), mapCell(1, 5), mapCell(1, 6)], { marks: ['treasure', 'event'], anchor: mapCell(2, 5) }),
  mapRoom('北口', [mapCell(1, 7)], { exit: true }),
], [
  mapConnection('入口竹徑', '南側山徑', mapCell(8, 1), mapCell(8, 2)),
  mapConnection('南側山徑', '西側竹叢', mapCell(7, 3), mapCell(6, 3)),
  mapConnection('南側山徑', '瘴氣裂縫', mapCell(7, 3), mapCell(7, 4)),
  mapConnection('西側竹叢', '採藥台地', mapCell(5, 4), mapCell(4, 4)),
  mapConnection('採藥台地', '中央空地', mapCell(4, 4), mapCell(4, 5)),
  mapConnection('中央空地', '東側棧道', mapCell(4, 6), mapCell(4, 7), 'door'),
  mapConnection('東側棧道', '崩裂棧板', mapCell(2, 8), mapCell(2, 7)),
  mapConnection('崩裂棧板', '北側藥棚', mapCell(2, 7), mapCell(2, 6)),
  mapConnection('北側藥棚', '北口', mapCell(1, 6), mapCell(1, 7)),
], '入口、出口與兩處陷阱皆為單格功能房；南側山徑與東側棧道是固定素材點。');

const canalSurface = mapFloor('地上 1F｜沉倉入口', 5, 5, [
  mapRoom('水道入口', [mapCell(1, 1)], { entry: true }),
  mapRoom('西側倉房', [mapCell(1, 2), mapCell(1, 3), mapCell(2, 2), mapCell(2, 3), mapCell(2, 4), mapCell(3, 2), mapCell(3, 3)], { marks: ['treasure'], anchor: mapCell(2, 3) }),
  mapRoom('引水走廊', [mapCell(3, 4), mapCell(4, 2), mapCell(4, 3), mapCell(4, 4), mapCell(5, 3)], { marks: ['resource'], anchor: mapCell(4, 3) }),
  mapRoom('西側下行梯', [mapCell(4, 5)], { stair: '↓' }),
  mapRoom('東側沉倉', [mapCell(1, 4), mapCell(1, 5)], { marks: ['event'], anchor: mapCell(1, 5) }),
  mapRoom('東側下行梯', [mapCell(2, 5)], { stair: '↓' }),
], [
  mapConnection('水道入口', '西側倉房', mapCell(1, 1), mapCell(1, 2), 'door'),
  mapConnection('西側倉房', '引水走廊', mapCell(3, 3), mapCell(3, 4)),
  mapConnection('引水走廊', '西側下行梯', mapCell(4, 4), mapCell(4, 5)),
  mapConnection('東側沉倉', '東側下行梯', mapCell(1, 5), mapCell(2, 5)),
], '東側沉倉與入口區沒有同層連線；引水走廊是固定素材點。');

const canalBasement = mapFloor('地下 1F｜蓄水池', 5, 5, [
  mapRoom('東側上行梯', [mapCell(2, 5)], { stair: '↑' }),
  mapRoom('東側導渠', [mapCell(3, 5)], { marks: ['resource'] }),
  mapRoom('蓄水池', mapRect(3, 3, 4, 4), { marks: ['large'], anchor: mapCell(4, 4) }),
  mapRoom('西側上行梯', [mapCell(4, 5)], { stair: '↑' }),
  mapRoom('中段水閘', [mapCell(1, 2), mapCell(1, 3), mapCell(2, 2), mapCell(2, 3), mapCell(2, 4)], { marks: ['event'], anchor: mapCell(2, 3) }),
  mapRoom('西側沉貨區', [mapCell(3, 2), mapCell(4, 2), mapCell(5, 2)], { marks: ['treasure'], anchor: mapCell(4, 2) }),
  mapRoom('水門出口', [mapCell(5, 3)], { exit: true }),
  mapRoom('沉木陷阱', [mapCell(5, 4)], { marks: ['trap'] }),
], [
  mapConnection('東側上行梯', '東側導渠', mapCell(2, 5), mapCell(3, 5)),
  mapConnection('東側導渠', '蓄水池', mapCell(3, 5), mapCell(3, 4)),
  mapConnection('蓄水池', '西側上行梯', mapCell(4, 4), mapCell(4, 5)),
  mapConnection('蓄水池', '沉木陷阱', mapCell(4, 4), mapCell(5, 4)),
  mapConnection('水門出口', '西側沉貨區', mapCell(5, 3), mapCell(5, 2)),
  mapConnection('西側沉貨區', '中段水閘', mapCell(3, 2), mapCell(2, 2)),
  mapConnection('中段水閘', '蓄水池', mapCell(2, 4), mapCell(3, 4), 'door'),
], '兩座上行梯分別和地上兩座下行梯同座標對齊；東側導渠是固定素材點。');

const towerOne = mapFloor('塔 1F｜入塔廳', 6, 6, [
  mapRoom('入塔入口', [mapCell(6, 1)], { entry: true }), mapRoom('入塔前室', [mapCell(5, 1), mapCell(5, 2), mapCell(6, 2)]), mapRoom('下行封門梯', [mapCell(4, 2)], { stair: '↓' }),
  mapRoom('正印前庭', mapRect(4, 3, 5, 4), { marks: ['event'], anchor: mapCell(4, 3) }), mapRoom('上行校印廳', [mapCell(2, 3), mapCell(3, 3), mapCell(3, 4)]), mapRoom('上行校印梯', [mapCell(2, 4)], { stair: '↑' }),
  mapRoom('側庫', [mapCell(2, 5), mapCell(3, 5)], { marks: ['treasure'], anchor: mapCell(2, 5) }), mapRoom('符紙火陷', [mapCell(1, 4)], { marks: ['trap'] }), mapRoom('北側環廊', [mapCell(1, 5)], { marks: ['resource'] }),
], [
  mapConnection('入塔入口', '入塔前室', mapCell(6, 1), mapCell(6, 2)), mapConnection('入塔前室', '下行封門梯', mapCell(5, 2), mapCell(4, 2), 'door'), mapConnection('入塔前室', '正印前庭', mapCell(5, 2), mapCell(5, 3)), mapConnection('正印前庭', '上行校印廳', mapCell(4, 3), mapCell(3, 3)), mapConnection('上行校印廳', '上行校印梯', mapCell(2, 3), mapCell(2, 4)), mapConnection('上行校印廳', '側庫', mapCell(3, 4), mapCell(3, 5), 'door'), mapConnection('上行校印梯', '符紙火陷', mapCell(2, 4), mapCell(1, 4)), mapConnection('符紙火陷', '北側環廊', mapCell(1, 4), mapCell(1, 5)),
], '↑（2,4）接塔 2F；↓（4,2）接地下 1F；北側環廊是固定素材點。');

const towerTwo = mapFloor('塔 2F｜校印廊', 6, 6, [
  mapRoom('下行校印廳', [mapCell(1, 3), mapCell(1, 4), mapCell(2, 3)]), mapRoom('下行校印梯', [mapCell(2, 4)], { stair: '↓' }), mapRoom('中段校印室', [mapCell(3, 2), mapCell(4, 2), mapCell(4, 3)], { marks: ['event'], anchor: mapCell(4, 2) }), mapRoom('上行校印梯', [mapCell(3, 3)], { stair: '↑' }),
  mapRoom('東側書庫', mapRect(3, 5, 4, 6), { marks: ['treasure'], anchor: mapCell(3, 6) }), mapRoom('下層迴廊', mapRect(5, 3, 6, 4), { marks: ['resource'], anchor: mapCell(5, 3) }), mapRoom('碎印陷阱', [mapCell(6, 5)], { marks: ['trap'] }), mapRoom('東向短廊', [mapCell(3, 4)]),
], [
  mapConnection('下行校印廳', '下行校印梯', mapCell(2, 3), mapCell(2, 4)), mapConnection('下行校印廳', '上行校印梯', mapCell(2, 3), mapCell(3, 3)), mapConnection('上行校印梯', '中段校印室', mapCell(3, 3), mapCell(4, 3)), mapConnection('上行校印梯', '東向短廊', mapCell(3, 3), mapCell(3, 4)), mapConnection('東向短廊', '東側書庫', mapCell(3, 4), mapCell(3, 5), 'door'), mapConnection('中段校印室', '下層迴廊', mapCell(4, 3), mapCell(5, 3)), mapConnection('下層迴廊', '碎印陷阱', mapCell(6, 4), mapCell(6, 5)),
], '↑（3,3）接塔 3F；↓（2,4）接塔 1F；下層迴廊是固定素材點。');

const towerThree = mapFloor('塔 3F｜藏卷層', 6, 6, [
  mapRoom('下行藏卷室', [mapCell(3, 2), mapCell(4, 2), mapCell(4, 3)]), mapRoom('下行藏卷梯', [mapCell(3, 3)], { stair: '↓' }), mapRoom('上行藏卷室', [mapCell(1, 3), mapCell(1, 4), mapCell(2, 3)], { marks: ['resource'], anchor: mapCell(1, 3) }), mapRoom('上行藏卷梯', [mapCell(2, 4)], { stair: '↑' }),
  mapRoom('東側典藏庫', mapRect(3, 5, 4, 6), { marks: ['event'], anchor: mapCell(3, 5) }), mapRoom('南側卷軸庫', [mapCell(5, 4), mapCell(6, 4)], { marks: ['treasure'], anchor: mapCell(6, 4) }), mapRoom('折角短廊', [mapCell(3, 4), mapCell(4, 4)]), mapRoom('落卷陷阱', [mapCell(5, 5)], { marks: ['trap'] }),
], [
  mapConnection('下行藏卷室', '下行藏卷梯', mapCell(4, 3), mapCell(3, 3)), mapConnection('下行藏卷梯', '折角短廊', mapCell(3, 3), mapCell(3, 4)), mapConnection('折角短廊', '東側典藏庫', mapCell(3, 4), mapCell(3, 5), 'door'), mapConnection('折角短廊', '上行藏卷梯', mapCell(3, 4), mapCell(2, 4)), mapConnection('上行藏卷梯', '上行藏卷室', mapCell(2, 4), mapCell(2, 3)), mapConnection('折角短廊', '南側卷軸庫', mapCell(4, 4), mapCell(5, 4)), mapConnection('南側卷軸庫', '落卷陷阱', mapCell(5, 4), mapCell(5, 5)),
], '↑（2,4）接塔 4F；↓（3,3）接塔 2F；上行藏卷室是固定素材點。');

const towerFour = mapFloor('塔 4F｜觀印台', 6, 6, [
  mapRoom('塔外出口', [mapCell(1, 3)], { exit: true }), mapRoom('觀印前室', [mapCell(1, 4)], { marks: ['resource'] }), mapRoom('下行觀印梯', [mapCell(2, 4)], { stair: '↓' }), mapRoom('北側符銘室', [mapCell(1, 5), mapCell(1, 6), mapCell(2, 5)], { marks: ['event'], anchor: mapCell(1, 5) }), mapRoom('觀印台', mapRect(3, 2, 4, 5), { marks: ['large'], anchor: mapCell(3, 4) }), mapRoom('東側儀器庫', [mapCell(3, 6), mapCell(4, 6)], { marks: ['treasure'], anchor: mapCell(3, 6) }),
], [
  mapConnection('塔外出口', '觀印前室', mapCell(1, 3), mapCell(1, 4)), mapConnection('觀印前室', '下行觀印梯', mapCell(1, 4), mapCell(2, 4)), mapConnection('觀印前室', '北側符銘室', mapCell(1, 4), mapCell(1, 5)), mapConnection('下行觀印梯', '觀印台', mapCell(2, 4), mapCell(3, 4), 'door'), mapConnection('觀印台', '東側儀器庫', mapCell(3, 5), mapCell(3, 6)),
], '↓（2,4）接塔 3F；觀印台是 2×4 大型體型敵人偏好房；觀印前室是固定素材點。');

const towerBasementOne = mapFloor('塔 地下 1F｜封印庫', 6, 6, [
  mapRoom('上行封門梯', [mapCell(4, 2)], { stair: '↑' }), mapRoom('封門前廳', [mapCell(4, 1), mapCell(5, 1), mapCell(5, 2), mapCell(5, 3)], { marks: ['resource'], anchor: mapCell(5, 2) }), mapRoom('中段封印室', mapRect(3, 3, 4, 4), { marks: ['event'], anchor: mapCell(3, 3) }), mapRoom('下行地脈梯', [mapCell(2, 5)], { stair: '↓' }), mapRoom('地脈前廳', [mapCell(1, 5), mapCell(1, 6), mapCell(2, 6)]), mapRoom('封存架', mapRect(5, 4, 6, 5), { marks: ['treasure'], anchor: mapCell(6, 4) }), mapRoom('地脈短廊', [mapCell(3, 5)], { marks: ['trap'] }),
], [
  mapConnection('上行封門梯', '封門前廳', mapCell(4, 2), mapCell(4, 1)), mapConnection('封門前廳', '中段封印室', mapCell(5, 3), mapCell(4, 3), 'door'), mapConnection('中段封印室', '地脈短廊', mapCell(3, 4), mapCell(3, 5)), mapConnection('地脈短廊', '下行地脈梯', mapCell(3, 5), mapCell(2, 5)), mapConnection('下行地脈梯', '地脈前廳', mapCell(2, 5), mapCell(2, 6)), mapConnection('中段封印室', '封存架', mapCell(4, 4), mapCell(5, 4)),
], '↑（4,2）接塔 1F；↓（2,5）接地下 2F；封門前廳是固定素材點。');

const towerBasementTwo = mapFloor('塔 地下 2F｜地脈室', 6, 6, [
  mapRoom('上行地脈梯', [mapCell(2, 5)], { stair: '↑' }), mapRoom('地脈前廳', [mapCell(1, 5), mapCell(1, 6), mapCell(2, 6)], { marks: ['resource'], anchor: mapCell(1, 5) }), mapRoom('地脈主室', mapRect(3, 2, 5, 5), { marks: ['event'], anchor: mapCell(3, 4) }), mapRoom('地脈側庫', [mapCell(6, 2), mapCell(6, 3)], { marks: ['treasure'], anchor: mapCell(6, 2) }),
], [
  mapConnection('上行地脈梯', '地脈前廳', mapCell(2, 5), mapCell(2, 6)), mapConnection('上行地脈梯', '地脈主室', mapCell(2, 5), mapCell(3, 5), 'door'), mapConnection('地脈主室', '地脈側庫', mapCell(5, 2), mapCell(6, 2)),
], '↑（2,5）接地下 1F；地脈前廳是固定素材點。');

export const firstMapLayouts = [
  { name: '霧篁藥谷', city: '青岑城', type: '野外｜單層 8×8', floors: [herbValley] },
  { name: '舊漕渠與沉倉', city: '雲京', type: '內部｜5×5、地上 1 層＋地下 1 層', floors: [canalSurface, canalBasement] },
  { name: '天衡印塔', city: '雲京', type: '建築型國家迷宮｜6×6、塔 1～4F＋地下 1～2F', floors: [towerOne, towerTwo, towerThree, towerFour, towerBasementOne, towerBasementTwo] },
];

export { attributes };
