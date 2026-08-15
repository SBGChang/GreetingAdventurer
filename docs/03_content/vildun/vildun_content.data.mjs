import { balanceModel as sharedBalanceModel } from '../yunhua/yunhua_content.data.mjs';
import { wildernessLayout, twoFloorLayout, nationalDungeonLayout } from '../shared/standard_layouts.mjs';
import { validateMapLayouts } from '../shared/map_model.mjs';

export const cultureMeta = {
  id: 'culture.vildun',
  name: '維爾冬',
  direction: '北方',
  pillars: ['氏族與誓盟', '寒地狩獵', '木鐵與海岸器作', '刻石與長歌'],
  cities: ['霜灣', '杉脊堡'],
  scope: 'Tier I～II 第一版可玩內容；Tier III～V 鎖定命名、裝備路線與內容語法。',
  version: '2026-08-14',
};

export const balanceModel = {
  ...sharedBalanceModel,
  title: '維爾冬第一輪共用平衡基準',
  scope: '沿用雲華已確立的跨文化 HP、主屬、CTB、命中、減傷、控制抗性與 Mastery 基準；文化只改變內容組合與合法效果。',
  statusRules: [
    ['霜痕', '負面', '降低迴避與預判 raw', '2 目標行動', 'refresh'],
    ['獵痕', '負面', '降低迴避；滿足追獵技能條件', '2 目標行動', 'refresh'],
    ['膽裂', '負面', '降低命中與格擋 raw', '2 目標行動', 'refresh'],
    ['刻甲', '正面', '提高一般／魔法減傷 raw', '2 目標行動', 'strongest'],
    ['昂志', '正面', '提高命中與格擋 raw', '2 目標行動', 'strongest'],
  ],
};

const tierMeta = [
  { tier: 'I', rarity: '一般', scale: 1, priceScale: 1 },
  { tier: 'II', rarity: '精品', scale: 1.30, priceScale: 2.6 },
  { tier: 'III', rarity: '史詩', scale: 1.75, priceScale: 7 },
  { tier: 'IV', rarity: '傳說', scale: 2.25, priceScale: 22 },
  { tier: 'V', rarity: '神話', scale: 2.95, priceScale: 75 },
];

const round = value => Math.round(value * 100) / 100;
const makeEquipmentLine = blueprint => tierMeta.map((meta, index) => ({
  id: `equipment.vildun.${blueprint.id}.${meta.tier.toLowerCase()}`,
  cultureId: cultureMeta.id,
  tier: meta.tier,
  rarity: meta.rarity,
  type: blueprint.type,
  requirement: blueprint.requirement,
  name: blueprint.names[index],
  weight: blueprint.weights[index],
  value: Math.round(blueprint.baseValue * meta.priceScale),
  coefficients: Object.fromEntries(Object.entries(blueprint.coefficients).map(([key, value]) => [key, round(value * meta.scale)])),
  ability: blueprint.abilities[index],
}));

const ability = (condition, effect, limit) => ({ condition, effect, limit });
const repeatAbility = (condition, effects, limit) => effects.map(effect => ability(condition, effect, limit));

const equipmentBlueprints = [
  {
    id: 'hand-axe', type: '單手物理', requirement: '手斧／單手武器', baseValue: 82,
    names: ['松柄手斧', '黑鐵鬍斧', '霜鋒戰斧', '裂誓金斧', '冬王斷環'], weights: [7, 8, 9, 10, 12],
    coefficients: { physicalDamageMuscle: 1.45, physicalDamageCoordination: 0.72, hitReaction: 0.18, hitCoordination: 0.18, blockAbsorbMuscle: 0.04 },
    abilities: [
      ability('[hew] 命中守勢目標。', '破綻 1 行動。', '每名目標每 2 次自身行動 1 次。'),
      ability('使用「鉤盾斧」命中。', '格擋吸收削減 raw +10。', '只作用於本次技能。'),
      ability('生命低於 50% 使用 [hew]。', '傷害威力 +0.10。', '每次行動 1 次。'),
      ability('使用「負傷奮戰」。', '同時獲得昂志。', '每場 2 次。'),
      ability('「斷環反擊」成功。', '反擊威力 +0.22；中斷讀條。', '每場 2 次。'),
    ],
  },
  {
    id: 'hunting-knife', type: '單手物理', requirement: '短刃／單手武器', baseValue: 70,
    names: ['獵人短刃', '鹿骨長匕', '白銀獵刀', '無聲霜刃', '長夜收歌'], weights: [3, 3, 4, 4, 5],
    coefficients: { physicalDamageMuscle: 0.78, physicalDamageCoordination: 1.38, hitReaction: 0.34, hitCoordination: 0.30, evasionReaction: 0.10 },
    abilities: [
      ability('[hew] 命中。', '獵痕 1 行動。', '每名目標 1 次。'),
      ability('攻擊帶獵痕目標。', '本次命中 raw +10。', '不疊加。'),
      ability('使用「獵痕收尾」。', '傷害威力 +0.14。', '目標須帶獵痕。'),
      ability('使用 [counter] 成功。', '自身 CTB −6。', '最低 0；每場 2 次。'),
      ability('使用「無聲收歌」命中。', '解除目標獵痕並提高威力 +0.28。', '每場對同一目標 1 次。'),
    ],
  },
  {
    id: 'hunting-spear', type: '雙手物理', requirement: '獵矛／雙手武器', baseValue: 106,
    names: ['白杉獵矛', '熊牙長矛', '寒銀穿槍', '逐風重矛', '極夜長牙'], weights: [10, 11, 12, 14, 15],
    coefficients: { physicalDamageMuscle: 1.62, physicalDamageCoordination: 1.12, hitReaction: 0.30, hitCoordination: 0.27, blockReaction: 0.08 },
    abilities: [
      ability('[thrust] 命中。', '獵痕 2 行動。', '每名目標 1 次。'),
      ability('攻擊帶獵痕目標。', '目標 +8 CTB。', '每次技能 1 次。'),
      ability('[counter] 成功。', '反擊威力 +0.14。', '只對近戰。'),
      ability('使用「逐痕穿刺」。', '威力 +0.18。', '目標須帶獵痕。'),
      ability('使用「極夜守獵」成功反擊。', '目標 +22 CTB。', '每場對同一目標 2 次。'),
    ],
  },
  {
    id: 'great-axe', type: '雙手物理', requirement: '長柄戰斧／雙手武器', baseValue: 124,
    names: ['伐木長斧', '長柄戰斧', '裂谷雙手斧', '斷峰巨斧', '冬冠天斧'], weights: [15, 17, 19, 22, 25],
    coefficients: { physicalDamageMuscle: 2.18, physicalDamageCoordination: 0.92, hitReaction: 0.14, hitCoordination: 0.16, normalDrMuscle: 0.06 },
    abilities: [
      ability('[cleave] 命中 2 名以上。', '自身 CTB −6。', '最低 0；每次技能 1 次。'),
      ability('[heavy] 命中。', '膽裂 1 行動。', '每名目標 1 次。'),
      ability('使用「蓄力斷甲」。', '額外 +14 CTB。', '每場對同一目標 2 次。'),
      ability('使用「風暴劈斬」。', '第二名起的範圍衰減減少 0.05。', '仍受最低衰減限制。'),
      ability('使用「冬冠斷峰」。', '威力 +0.24；中斷讀條。', '每場 1 次。'),
    ],
  },
  {
    id: 'javelin', type: '投擲與射擊', requirement: '投槍／投擲武器', baseValue: 76,
    names: ['短投槍', '狼牙投槍', '追風獵槍', '霜尾重槍', '天獵星槍'], weights: [4, 5, 6, 7, 8],
    coefficients: { physicalDamageMuscle: 1.05, physicalDamageCoordination: 1.22, hitReaction: 0.31, hitCoordination: 0.27, predictionReaction: 0.08 },
    abilities: [
      ability('[throw] 命中。', '獵痕 1 行動。', '每名目標 1 次。'),
      ability('攻擊帶獵痕目標。', '命中 raw +10。', '本次技能。'),
      ability('使用「追獵連投」。', '第二次傷害威力 +0.12。', '兩次均需合法。'),
      ability('使用「破甲重槍」。', '破綻 2 行動。', '每名目標 1 次。'),
      ability('使用「天獵貫星」。', '對獵痕目標威力 +0.24。', '每場 1 次。'),
    ],
  },
  {
    id: 'throwing-axe', type: '投擲與射擊', requirement: '飛斧／投擲武器', baseValue: 74,
    names: ['配重飛斧', '雙月飛斧', '回聲輪斧', '斷歌飛斧', '九環風斧'], weights: [4, 5, 6, 7, 8],
    coefficients: { physicalDamageMuscle: 1.18, physicalDamageCoordination: 0.98, hitReaction: 0.35, hitCoordination: 0.25, blockAbsorbMuscle: 0.03 },
    abilities: [
      ability('[throw] 命中讀條目標。', '中斷讀條。', '每場對同一目標 2 次。'),
      ability('使用迅捷 [throw] 命中。', '目標 +8 CTB。', '每次技能 1 次。'),
      ability('使用「回環雙斧」。', '第二斧命中 raw +10。', '第一斧命中才生效。'),
      ability('使用「裂膽輪斧」。', '膽裂強度 +10 raw。', '只對本次套用。'),
      ability('使用「九環風暴」。', '每多命中一名目標，自身 CTB −4。', '最多 −12，最低 0。'),
    ],
  },
  {
    id: 'hunting-bow', type: '投擲與射擊', requirement: '獵弓／射擊武器', baseValue: 88,
    names: ['骨哨獵弓', '鹿筋反曲弓', '白杉獵弓', '風徑角弓', '千里霜弦'], weights: [4, 5, 6, 7, 8],
    coefficients: { physicalDamageMuscle: 0.62, physicalDamageCoordination: 1.68, hitReaction: 0.42, hitCoordination: 0.34, predictionReaction: 0.12 },
    abilities: [
      ability('[shot] 命中。', '獵痕 2 行動。', '每名目標 1 次。'),
      ability('攻擊帶獵痕目標。', '命中 raw +8。', '本次技能。'),
      ability('使用「雪徑瞄準」。', '昂志額外 +8 命中 raw。', '只對自身。'),
      ability('使用「追痕三矢」。', '第三箭威力 +0.16。', '前兩箭均合法。'),
      ability('使用「千里定獵」。', '無視 20% 格擋吸收 raw。', '不無視一般減傷。'),
    ],
  },
  {
    id: 'longbow', type: '投擲與射擊', requirement: '長弓／射擊武器', baseValue: 110,
    names: ['杉木長弓', '雙手狩弓', '角背戰弓', '穿雪重弓', '冬穹大弓'], weights: [7, 9, 11, 13, 15],
    coefficients: { physicalDamageMuscle: 0.92, physicalDamageCoordination: 1.88, hitReaction: 0.31, hitCoordination: 0.28, predictionReaction: 0.10 },
    abilities: [
      ability('[shot] 命中守勢目標。', '破綻 1 行動。', '每名目標 1 次。'),
      ability('使用 [heavy] 射擊。', '威力 +0.10。', '不適用迅捷技能。'),
      ability('使用「冰脊貫射」。', '目標 +14 CTB。', '每場對同一目標 2 次。'),
      ability('使用「風雪箭幕」。', '範圍衰減減少 0.05。', '仍受最低衰減限制。'),
      ability('使用「冬穹一矢」。', '威力 +0.24；命中 raw +12。', '每場 1 次。'),
    ],
  },
  {
    id: 'one-hand-staff', type: '法杖與樂器', requirement: '刻杖／單手法杖', baseValue: 84,
    names: ['河石刻杖', '誓環短杖', '鳴石符杖', '冬紋權杖', '九誓刻杖'], weights: [3, 4, 4, 5, 6],
    coefficients: { magicDamageIntelligence: 2.35, magicHitIntelligence: 0.25, magicHitReaction: 0.22, magicDrIntelligence: 0.06, predictionIntelligence: 0.10 },
    abilities: repeatAbility('使用單體 [carving]。', ['魔法命中 raw +8。', '刻甲強度 +8 raw。', '霜痕持續 +1 行動。', '解除自身一個膽裂。', '中斷延遲額外 +8 CTB。'], '每次施術 1 次；同類效果只取最高。'),
  },
  {
    id: 'two-hand-staff', type: '法杖與樂器', requirement: '長刻杖／雙手法杖', baseValue: 116,
    names: ['白杉長杖', '鹿角刻杖', '風碑儀杖', '長夜石杖', '冬冠大杖'], weights: [8, 10, 12, 14, 16],
    coefficients: { magicDamageIntelligence: 2.90, magicHitIntelligence: 0.34, magicHitReaction: 0.22, magicDrIntelligence: 0.09, predictionIntelligence: 0.14 },
    abilities: repeatAbility('使用範圍 [carving]／[ward]。', ['傷害威力 +0.08。', '刻甲強度 +12 raw。', '第二名起衰減減少 0.05。', '刻甲持續 +1 行動。', '對霜痕目標威力 +0.20。'], '只取最高雙手法杖效果。'),
  },
  {
    id: 'war-horn', type: '法杖與樂器', requirement: '戰角／管樂器', baseValue: 78,
    names: ['骨哨', '集獵戰角', '霜銅號角', '誓盟長角', '萬聲冬角'], weights: [2, 3, 4, 5, 6],
    coefficients: { instrumentDamageIntelligence: 0.32, instrumentDamageCoordination: 0.24, instrumentDamageCharisma: 0.62, hitReaction: 0.18, magicDrIntelligence: 0.04 },
    abilities: repeatAbility('使用 [perform]。', ['昂志命中 raw +8。', '解除膽裂後 CTB −6。', '第二名目標不衰減。', '中斷後目標 +8 CTB。', '全隊昂志強度 +12 raw。'], '每次演奏 1 次；只取最高戰角效果。'),
  },
  {
    id: 'bowed-lyre', type: '法杖與樂器', requirement: '弓琴／弦樂器', baseValue: 90,
    names: ['木框弓琴', '鹿角弦琴', '白銀歌琴', '長夜弓琴', '無盡誓弦'], weights: [4, 5, 6, 7, 8],
    coefficients: { instrumentDamageIntelligence: 0.38, instrumentDamageCoordination: 0.28, instrumentDamageCharisma: 0.58, predictionReaction: 0.15, magicDrIntelligence: 0.07 },
    abilities: repeatAbility('使用 [perform]。', ['刻甲 +8 raw。', '解除霜痕後預判 +6 raw。', '昂志與刻甲各 +6 raw。', '膽裂強度 +10 raw。', '全隊刻甲不因多目標衰減。'], '每次演奏 1 次；只取最高弓琴效果。'),
  },
  {
    id: 'cloth', type: '防具與盾牌', requirement: '布甲', baseValue: 54,
    names: ['厚麻冬衣', '羊毛刻袍', '雪紋長袍', '長歌禮衣', '極夜法衣'], weights: [4, 5, 6, 7, 8],
    coefficients: { evasionReaction: 0.24, evasionCoordination: 0.14, magicDrIntelligence: 0.13, predictionIntelligence: 0.10 },
    abilities: repeatAbility('持有法杖或樂器。', ['魔法減傷 raw +6。', '刻甲 +8 raw。', '受魔傷時再 −4%。', '解除負面時 CTB −6。', '高級刻甲／長歌持續 +1 行動。'], '同類效果只取最高。'),
  },
  {
    id: 'light-armor', type: '防具與盾牌', requirement: '輕甲', baseValue: 68,
    names: ['毛皮獵衣', '鉚釘皮甲', '白鬃輕甲', '逐風獵鎧', '冬狼輕裝'], weights: [7, 8, 9, 10, 11],
    coefficients: { evasionReaction: 0.36, evasionCoordination: 0.27, hitReaction: 0.10, hitCoordination: 0.12, normalDrMuscle: 0.06 },
    abilities: repeatAbility('使用 [shot]／[throw] 或成功閃避。', ['CTB −6。', '獲得昂志。', '命中 raw +10。', '傷害威力 +0.10。', '解除自身獵痕。'], '每 2 次自身行動最多 1 次。'),
  },
  {
    id: 'medium-armor', type: '防具與盾牌', requirement: '中甲', baseValue: 92,
    names: ['皮襯環甲', '鐵環鎖衣', '鱗環戰甲', '誓環中鎧', '冬灣戰衣'], weights: [14, 16, 18, 20, 22],
    coefficients: { normalDrMuscle: 0.14, blockAbsorbMuscle: 0.17, blockReaction: 0.10, blockCoordination: 0.08, evasionReaction: 0.07 },
    abilities: repeatAbility('成功格擋或使用 [guard]。', ['CTB −4。', '格擋吸收 raw +10。', '對攻擊者施加膽裂。', '帶刻甲時物傷 −5%。', '格擋 Boss 技能後獲得昂志。'], '每次守勢 1 次。'),
  },
  {
    id: 'heavy-armor', type: '防具與盾牌', requirement: '重甲', baseValue: 128,
    names: ['厚鐵環甲', '霜灣重鎧', '黑岩札鎧', '冬王全甲', '長夜玄鎧'], weights: [22, 26, 30, 35, 41],
    coefficients: { normalDrMuscle: 0.23, blockAbsorbMuscle: 0.24, magicDrIntelligence: 0.05, evasionReaction: -0.06, evasionCoordination: -0.04 },
    abilities: repeatAbility('受物理傷害或使用重甲守勢。', ['本次傷害 −4%。', '成功格擋後刻甲 +8 raw。', '低生命時一般減傷 +16 raw。', 'Boss 物傷再 −8%。', '「長夜不退」使前排一般減傷 +12 raw。'], '同類固定減傷不重複。'),
  },
  {
    id: 'one-hand-shield', type: '防具與盾牌', requirement: '單手盾', baseValue: 74,
    names: ['木面圓盾', '鐵緣圓盾', '誓環戰盾', '冬狼吞口盾', '九誓寶盾'], weights: [6, 8, 10, 12, 14],
    coefficients: { blockReaction: 0.29, blockCoordination: 0.22, blockAbsorbMuscle: 0.18, normalDrMuscle: 0.04 },
    abilities: repeatAbility('使用 [guard]。', ['格擋 raw +10。', '格擋後 CTB −8。', '盾擊套用膽裂。', '掩護者獲得刻甲。', '反擊威力 +0.20。'], '每次守勢 1 次。'),
  },
  {
    id: 'two-hand-shield', type: '防具與盾牌', requirement: '雙手盾', baseValue: 110,
    names: ['船板大盾', '長屋門盾', '岩壁塔盾', '霜牆巨盾', '冬門神盾'], weights: [17, 21, 26, 32, 39],
    coefficients: { blockReaction: 0.37, blockCoordination: 0.28, blockAbsorbMuscle: 0.29, normalDrMuscle: 0.10, magicDrIntelligence: 0.06 },
    abilities: repeatAbility('使用 [guard]。', ['格擋 raw +16。', '自身刻甲 +14 raw。', '前排刻甲 +10 raw。', '盾擊使目標 +14 CTB。', '全隊刻甲與一般減傷 +12 raw。'], '主手武器技能不可用。'),
  },
];

export const equipmentCatalog = Object.entries(Object.groupBy(equipmentBlueprints, entry => entry.type)).map(([title, entries]) => ({
  title,
  lines: entries.map(makeEquipmentLine),
}));

const delayKey = { 迅捷: 'quick', 標準: 'standard', 沉重: 'heavy', 施法: 'cast', 演奏: 'perform', 架勢: 'stance' };
const stages = ['L0 自動', 'L3 自動', '基礎書 Lv.3', '高級書 Lv.6', '極品書 Lv.10'];
const stageIds = ['l0', 'l3', 'basic', 'advanced', 'master'];
const supportMxp = [48, 48, 72, 120, 200];
const routeIds = {
  手斧: 'hand-axe', 短刃: 'hunting-knife', 獵矛: 'hunting-spear', 長柄戰斧: 'great-axe',
  投槍: 'javelin', 飛斧: 'throwing-axe', 獵弓: 'hunting-bow', 長弓: 'longbow',
  單手盾: 'one-hand-shield', 雙手盾: 'two-hand-shield', 戰角: 'war-horn', 弓琴: 'bowed-lyre',
  攻擊刻術: 'attack-carving', 防禦刻術: 'defense-carving', 祝福刻術: 'blessing-carving', 詛咒刻術: 'curse-carving',
};
const damage = (multiplier, channel = 'physical') => ({ kind: 'damage', multiplier, channel });
const counter = multiplier => ({ kind: 'counter', multiplier, channel: 'physical' });
const heal = multiplier => ({ kind: 'heal', multiplier, channel: 'healing' });
const support = { kind: 'none', multiplier: null, channel: null };
const skillRoute = (route, requirement, entries) => entries.map((entry, index) => {
  const [name, type, delayLabel, resolution, effect, limit = '無。'] = entry;
  const isDamage = resolution.kind === 'damage' || resolution.kind === 'counter';
  return {
    id: `skill.vildun.${routeIds[route]}.${stageIds[index]}`,
    cultureId: cultureMeta.id,
    route,
    requirement,
    stage: stages[index],
    name,
    type,
    actionKind: delayLabel === '施法' ? 'cast' : delayLabel === '演奏' ? 'perform' : type.includes('守勢') ? 'guard' : isDamage ? 'attack' : 'support',
    delay: balanceModel.delayProfiles[delayKey[delayLabel]],
    resolution,
    power: resolution.multiplier === null ? '無傷害' : `${resolution.kind === 'heal' ? '治療' : resolution.kind === 'counter' ? '反擊' : '傷害'}威力 ×${resolution.multiplier.toFixed(2)}`,
    effect,
    limit,
    masteryExperienceMode: isDamage ? 'damage' : 'fixedSupport',
    experience: isDamage ? `有效傷害比例 → ${route} Mastery` : `固定支援 MXP ${supportMxp[index]}`,
  };
});

const skillRoutes = [
  ['手斧', '主手・手斧', [
    ['切木斬', '物理攻擊', '標準', damage(0.98), '物理傷害。'],
    ['鉤盾斧', '物理攻擊', '標準', damage(0.90), '物理傷害；對守勢目標施加破綻。'],
    ['熊式架勢', '守勢／反擊', '架勢', counter(0.90), '建立格擋反擊架勢。', '只對近戰成功格擋觸發。'],
    ['負傷奮戰', '物理攻擊', '沉重', damage(1.28), '高物理傷害；生命低於 50% 時昂志。'],
    ['斷環反擊', '守勢／反擊', '架勢', counter(1.38), '成功反擊時中斷讀條。', '每次架勢 1 次。'],
  ]],
  ['短刃', '主手・短刃', [
    ['掠皮刺', '物理攻擊', '迅捷', damage(0.78), '迅捷物理傷害。'],
    ['雪下伏刃', '物理攻擊', '迅捷', damage(0.70), '物理傷害；獵痕 1 行動。'],
    ['獵痕收尾', '物理攻擊', '標準', damage(1.08), '對獵痕目標提高威力。', '目標須帶獵痕。'],
    ['靜息反握', '守勢／反擊', '架勢', counter(1.02), '建立低格擋反擊架勢。'],
    ['無聲收歌', '物理攻擊', '標準', damage(1.42), '解除目標獵痕並造成高傷害。', '每場對同一目標 1 次。'],
  ]],
  ['獵矛', '雙手・獵矛', [
    ['守距刺', '物理攻擊', '標準', damage(0.96), '中距物理傷害。'],
    ['投影定標', '物理攻擊', '標準', damage(0.84), '物理傷害；獵痕 2 行動。'],
    ['架矛迎擊', '守勢／反擊', '架勢', counter(0.92), '建立近戰反擊架勢。'],
    ['逐痕穿刺', '物理攻擊', '標準', damage(1.22), '物理傷害；獵痕目標 +8 CTB。'],
    ['極夜守獵', '守勢／反擊', '架勢', counter(1.30), '反擊並使目標 +22 CTB。', '每次架勢 1 次。'],
  ]],
  ['長柄戰斧', '雙手・長柄戰斧', [
    ['起肩重落', '物理攻擊', '標準', damage(1.08), '高肌力物理傷害。'],
    ['裂谷橫掃', '物理攻擊', '沉重', damage(0.88), '最多 3 名近距目標。', '每多一名衰減 10%。'],
    ['蓄力斷甲', '物理攻擊', '沉重', damage(1.36), '高物理傷害；+14 CTB。'],
    ['風暴劈斬', '物理攻擊', '沉重', damage(1.20), '最多 3 名目標；膽裂 2 行動。'],
    ['冬冠斷峰', '物理攻擊', '沉重', damage(1.62), '極高單體傷害；中斷讀條。', '每場 1 次。'],
  ]],
  ['投槍', '主手・投槍', [
    ['投矛', '物理攻擊', '標準', damage(0.92), '遠距物理傷害。'],
    ['釘痕槍', '物理攻擊', '標準', damage(0.82), '物理傷害；獵痕 2 行動。'],
    ['追獵連投', '物理攻擊', '沉重', damage(0.70), '對同一目標兩次獨立傷害。'],
    ['破甲重槍', '物理攻擊', '沉重', damage(1.25), '高物理傷害；破綻 2 行動。'],
    ['天獵貫星', '物理攻擊', '沉重', damage(1.50), '對獵痕目標威力提高。', '每場 1 次。'],
  ]],
  ['飛斧', '主手・飛斧', [
    ['旋柄投', '物理攻擊', '迅捷', damage(0.74), '迅捷遠距物理傷害。'],
    ['斷讀飛斧', '物理攻擊', '迅捷', damage(0.62), '命中讀條目標時中斷。'],
    ['回環雙斧', '物理攻擊', '標準', damage(0.68), '兩次獨立物理傷害。'],
    ['裂膽輪斧', '物理攻擊', '標準', damage(1.02), '物理傷害；膽裂 2 行動。'],
    ['九環風暴', '物理攻擊', '沉重', damage(1.14), '最多 3 名遠距目標。', '每多一名衰減 12%。'],
  ]],
  ['獵弓', '雙手・獵弓', [
    ['平弦獵射', '物理攻擊', '標準', damage(0.92), '遠距物理傷害。'],
    ['骨哨標獵', '物理攻擊', '標準', damage(0.80), '物理傷害；獵痕 2 行動。'],
    ['雪徑瞄準', '支援', '架勢', support, '自身昂志。'],
    ['追痕三矢', '物理攻擊', '沉重', damage(0.62), '三次獨立射擊；第三箭威力提高。'],
    ['千里定獵', '物理攻擊', '沉重', damage(1.48), '高命中物理傷害；無視部分格擋吸收。'],
  ]],
  ['長弓', '雙手・長弓', [
    ['滿弦重箭', '物理攻擊', '標準', damage(1.02), '遠距物理傷害。'],
    ['穿盾箭', '物理攻擊', '標準', damage(0.95), '物理傷害；破綻 1 行動。'],
    ['冰脊貫射', '物理攻擊', '沉重', damage(1.24), '高物理傷害；+14 CTB。'],
    ['風雪箭幕', '物理攻擊', '沉重', damage(1.12), '最多 3 名遠距目標。'],
    ['冬穹一矢', '物理攻擊', '沉重', damage(1.58), '極高命中單體傷害。', '每場 1 次。'],
  ]],
  ['單手盾', '副手・單手盾', [
    ['舉圓盾', '守勢', '架勢', support, '建立格擋守勢。'],
    ['盾緣回擊', '物理攻擊', '標準', damage(0.68), '成功格擋後攻擊；膽裂 1 行動。'],
    ['同肩掩護', '支援', '架勢', support, '一名隊友獲得刻甲。'],
    ['誓環反擊', '守勢／反擊', '架勢', counter(1.10), '建立格擋反擊架勢。'],
    ['九誓守望', '支援', '沉重', support, '最多 3 名隊友獲得刻甲與昂志。', '每場 1 次。'],
  ]],
  ['雙手盾', '雙手・大盾', [
    ['立大盾', '守勢', '架勢', support, '建立高格擋守勢。'],
    ['長屋守線', '支援', '架勢', support, '自身刻甲。'],
    ['霜牆同守', '支援', '架勢', support, '己方前排刻甲。'],
    ['岩門鎮擊', '物理攻擊', '沉重', damage(0.74), '格擋後攻擊；目標 +14 CTB。'],
    ['長夜不退', '支援', '沉重', support, '全隊刻甲與一般減傷 raw +12。', '每場 1 次。'],
  ]],
  ['戰角', '雙手・戰角／管樂器', [
    ['集獵短音', '支援演奏', '演奏', support, '一名隊友昂志。'],
    ['驅怯號', '支援演奏', '演奏', support, '解除一名隊友膽裂；CTB −6。'],
    ['破音震膽', '樂器攻擊', '演奏', damage(0.78, 'instrument'), '樂器傷害；膽裂 2 行動。'],
    ['誓盟合角', '支援演奏', '演奏', support, '最多 3 名隊友昂志。'],
    ['萬聲集結', '支援演奏', '演奏', support, '全隊昂志並解除膽裂。', '每場 1 次。'],
  ]],
  ['弓琴', '雙手・弓琴／弦樂器', [
    ['火塘小調', '支援演奏', '演奏', support, '一名隊友刻甲。'],
    ['安魂短歌', '支援演奏', '演奏', support, '解除一名隊友霜痕。'],
    ['長夜和弦', '支援演奏', '演奏', support, '兩名隊友刻甲與昂志。'],
    ['刻甲長歌', '支援演奏', '演奏', support, '最多 3 名隊友刻甲。'],
    ['誓歌不息', '支援演奏', '演奏', heal(1.08), '全隊治療並獲得刻甲。', '每場 1 次。'],
  ]],
  ['攻擊刻術', '單手或雙手・法杖', [
    ['霜刺刻', '魔法攻擊', '施法', damage(0.95, 'magic'), '魔法傷害。', '可被中斷。'],
    ['碎石紋', '魔法攻擊', '施法', damage(0.88, 'magic'), '魔法傷害；膽裂 1 行動。'],
    ['雷鳴刻印', '魔法攻擊', '施法', damage(0.92, 'magic'), '魔法傷害；+8 CTB。'],
    ['冰脊連刻', '魔法攻擊', '施法', damage(1.12, 'magic'), '最多 3 名目標；霜痕 2 行動。'],
    ['九石冬雷', '魔法攻擊', '施法', damage(1.55, 'magic'), '最多 3 名目標；霜痕目標威力提高。', '每場 1 次。'],
  ]],
  ['防禦刻術', '單手或雙手・法杖', [
    ['暖石符', '支援魔法', '施法', support, '自身刻甲。'],
    ['刻甲紋', '支援魔法', '施法', support, '一名隊友刻甲。'],
    ['石根護刻', '支援魔法', '施法', support, '刻甲並解除霜痕。'],
    ['三環石甲', '支援魔法', '施法', support, '最多 3 名隊友刻甲。'],
    ['冬門大刻', '支援魔法', '施法', support, '全隊刻甲並解除一個霜痕。', '每場 1 次。'],
  ]],
  ['祝福刻術', '單手或雙手・法杖', [
    ['獵途符', '支援魔法', '施法', support, '一名隊友昂志。'],
    ['熊心短句', '支援魔法', '施法', support, '解除一名隊友膽裂。'],
    ['長夜明視', '支援魔法', '施法', support, '一名隊友昂志與預判 raw +8。'],
    ['誓盟祝詞', '支援魔法', '施法', support, '最多 3 名隊友昂志。'],
    ['火塘長明', '支援魔法', '施法', heal(1.05), '全隊治療並獲得昂志。', '每場 1 次。'],
  ]],
  ['詛咒刻術', '單手或雙手・法杖', [
    ['怯步符', '詛咒魔法', '施法', support, '單體膽裂 2 行動。'],
    ['獵痕刻', '詛咒魔法', '施法', support, '單體獵痕 2 行動。'],
    ['裂膽咒', '詛咒魔法', '施法', support, '單體膽裂並 +8 CTB。'],
    ['霜痕連文', '詛咒魔法', '施法', support, '最多 3 名目標霜痕 2 行動。'],
    ['無聲冬印', '詛咒魔法', '施法', support, '最多 3 名目標霜痕；命中讀條則中斷。', '每場 1 次。'],
  ]],
];

export const skillCatalog = skillRoutes.map(([route, requirement, entries]) => ({ route, rows: skillRoute(route, requirement, entries) }));

const attackProfile = (stats, threat) => {
  const threatMultiplier = { 一般: 1, 菁英: 1.18, Boss: 1.42 }[threat];
  return {
    physicalBase: round((stats.muscle * 1.2 + stats.coordination * 0.45) * threatMultiplier),
    magicBase: round((stats.intelligence * 1.25 + stats.coordination * 0.2) * threatMultiplier),
    hitScore: round(stats.reaction * 0.4 + stats.coordination * 0.55 + stats.intelligence * 0.1),
  };
};
const monsterSkill = (name, channel, multiplier, delay, effect) => ({ name, channel, multiplier, delay, effect });
const monster = (id, tier, threat, size, name, stats, role, skills, drops) => ({
  id: `monster.vildun.${id}`, cultureId: cultureMeta.id, tier, threat, size, name, stats, role, skills, drops, attackProfile: attackProfile(stats, threat),
});
const stats = (health, muscle, intelligence, reaction, coordination, charisma = 0) => ({ health, muscle, intelligence, reaction, coordination, charisma });

export const monsterCatalog = {
  nonHuman: [
    monster('snow-tuft-hare', 'I', '一般', '小型', '雪簇穴兔', stats(125, 6, 2, 31, 24), '高迴避群體', [monsterSkill('凍土蹬咬', 'physical', 0.82, 'quick', '迅捷物理傷害。')], '雪兔皮、兔肉'),
    monster('resin-antler-young', 'I', '一般', '小型', '脂角幼鹿', stats(165, 28, 3, 22, 18), '標記壓力', [monsterSkill('短角頂撞', 'physical', 0.90, 'standard', '物理傷害；獵痕。')], '幼角、鹿皮、鹿肉'),
    monster('tide-claw-crawler', 'I', '一般', '小型', '潮爪伏獸', stats(175, 30, 4, 15, 19), '船塚前排', [monsterSkill('礁縫鉗咬', 'physical', 0.92, 'standard', '物理傷害；霜痕。')], '潮甲片、鹽腺'),
    monster('rime-mote', 'I', '一般', '小型', '霜屑浮靈', stats(130, 2, 30, 25, 15), '魔防檢查', [monsterSkill('霜屑噴吐', 'magic', 0.86, 'cast', '魔法傷害；霜痕。')], '霜晶屑、冷凝露'),
    monster('white-mane-packwolf', 'I', '菁英', '中型', '白鬃獵狼', stats(440, 48, 5, 43, 31), '獵痕與反應壓力', [monsterSkill('裂齒追咬', 'physical', 1.08, 'standard', '獵痕目標威力提高。'), monsterSkill('獵群長嚎', 'support', null, 'perform', '最多 3 個友軍昂志。'), monsterSkill('伏身待撲', 'counter', 0.86, 'stance', '建立反擊架勢。')], '白鬃皮、狼牙、狼肉'),
    monster('ice-shell-bear', 'I', '菁英', '中型', '冰殼穴熊', stats(510, 57, 8, 20, 25), '高生命與刻甲', [monsterSkill('重掌拍落', 'physical', 1.18, 'heavy', '沉重物理傷害。'), monsterSkill('冰殼伏守', 'support', null, 'stance', '自身刻甲。')], '穴熊皮、熊脂、熊肉'),
    monster('carved-stone-sentry', 'I', '菁英', '小型', '刻痕石衛', stats(470, 49, 35, 17, 24), '物魔混合', [monsterSkill('石斧重落', 'physical', 1.10, 'heavy', '物理傷害。'), monsterSkill('護刻回聲', 'support', null, 'stance', '自身刻甲。'), monsterSkill('碎字震響', 'magic', 0.82, 'cast', '魔法傷害；膽裂。')], '刻石片、古炭鐵'),
    monster('split-antler-elk', 'I', 'Boss', '大型 3×3', '裂角巨麋', stats(2450, 80, 12, 73, 39), '獵原 Boss', [monsterSkill('裂角橫掃', 'physical', 1.12, 'heavy', '最多 3 名目標。'), monsterSkill('踏雪震鳴', 'magic', 0.76, 'perform', '魔法傷害；膽裂。'), monsterSkill('霜鬃伏守', 'support', null, 'stance', '自身刻甲。')], '巨麋硬角、厚鹿皮、首領肉材'),
    monster('deep-tide-whale-lizard', 'I', 'Boss', '大型 3×3', '深潮鯨蜥', stats(2650, 74, 31, 61, 42), '船塚 Boss', [monsterSkill('沉潮咬壓', 'physical', 1.16, 'heavy', '沉重物理傷害。'), monsterSkill('鹽霜噴流', 'magic', 0.92, 'cast', '最多 3 名目標；霜痕。'), monsterSkill('潮甲護身', 'support', null, 'stance', '自身刻甲。'), monsterSkill('礁鳴震波', 'magic', 0.78, 'perform', '魔法傷害；+14 CTB。')], '鯨蜥皮、潮骨、沉船器件'),
    monster('grave-lamp-moth', 'II', '一般', '小型', '塚燈寒蛾', stats(275, 2, 50, 34, 23), '誓塚施術者', [monsterSkill('寒燈撲粉', 'magic', 0.92, 'cast', '魔法傷害；霜痕。')], '寒蛾粉、燈翼膜'),
    monster('iron-beak-cave-raven', 'II', '一般', '小型', '鐵喙穴鴉', stats(300, 35, 9, 47, 31), '高命中追獵', [monsterSkill('鐵喙啄裂', 'physical', 0.96, 'quick', '物理傷害；獵痕。')], '穴鴉羽、鐵喙片'),
    monster('broken-stele-beast', 'II', '一般', '中型', '碎碑石獸', stats(355, 53, 17, 16, 28), '中型前排', [monsterSkill('碑背橫撞', 'physical', 1.00, 'standard', '物理傷害。')], '誓石片、碑獸石芯'),
    monster('oath-barrow-warden', 'II', '菁英', '中型', '誓塚持盾者', stats(840, 72, 34, 29, 44), '格擋與刻甲', [monsterSkill('盾角重擊', 'physical', 1.12, 'heavy', '物理傷害；膽裂。'), monsterSkill('誓刻守勢', 'support', null, 'stance', '自身刻甲。'), monsterSkill('斷歌震擊', 'magic', 0.84, 'perform', '魔法傷害；中斷讀條。')], '古盾環、寒銀砂、守塚石芯'),
    monster('longsong-echo', 'II', '菁英', '小型', '長歌殘響', stats(730, 8, 74, 40, 31, 55), '高智魅支援', [monsterSkill('裂音短句', 'instrument', 0.98, 'perform', '樂器傷害；膽裂。'), monsterSkill('長夜低吟', 'support', null, 'perform', '最多 3 個友軍昂志。'), monsterSkill('回聲刻甲', 'support', null, 'cast', '最多 3 個友軍刻甲。')], '鳴石、舊琴弦、歌紋石片'),
    monster('winter-crown-colossus', 'II', 'Boss', '大型 3×3', '冬冠石王', stats(5250, 96, 66, 72, 56, 20), '誓塚 Boss', [monsterSkill('冬冠巨斧', 'physical', 1.28, 'heavy', '高物理傷害。'), monsterSkill('九石霜刻', 'magic', 1.02, 'cast', '最多 3 名目標；霜痕。'), monsterSkill('王塚回護', 'support', null, 'stance', '自身刻甲並解除膽裂。'), monsterSkill('長夜震歌', 'instrument', 0.92, 'perform', '全體樂器傷害；膽裂。')], '冬冠誓石、王塚炭鐵、極品書池'),
  ],
  humanEncounters: [
    { id: 'encounter.vildun.road-poachers', tier: 'I', threat: '一般群', name: '雪路盜獵隊', members: '6 短刃獵手＋3 骨哨弓手', role: '獵痕、迅捷收尾、低階射擊', drops: '肉乾、獵弓、皮料、基礎書' },
    { id: 'encounter.vildun.shore-raiders', tier: 'I', threat: '一般群', name: '岩岸掠貨者', members: '5 手斧戰士＋3 飛斧手', role: '破勢、飛斧中斷', drops: '船釘、焦油木、手斧、貨物' },
    { id: 'encounter.vildun.oathbreak-guard', tier: 'I', threat: '菁英', name: '破誓守衛', members: '1 圓盾守衛＋2 投槍獵手', role: '守勢、反擊、獵痕', drops: '盾環、投槍、護具與高價貨' },
    { id: 'encounter.vildun.barrow-delvers', tier: 'II', threat: '一般群', name: '誓塚私掘隊', members: '4 盾手＋3 刻術師＋2 弓手', role: '刻甲、霜痕、盾線與射擊', drops: '誓石片、寒銀砂、高級書' },
    { id: 'encounter.vildun.exiled-songthane', tier: 'II', threat: '菁英', name: '逐歌首領', members: '1 長柄斧首領＋1 戰角手＋1 刻術師', role: '沉重爆發、昂志、膽裂', drops: '精品裝備、鳴石、Boss 書池前置' },
  ],
};

export const itemCatalog = {
  combat: [
    ['I', '松脂膏', '0.3／28', '迅捷', '小量治療', '基礎店貨、製藥書'],
    ['I', '暖石藥酒', '0.4／34', '迅捷', '解除霜痕', '道具店、白杉素材'],
    ['I', '熊膽苦露', '0.3／40', '標準', '解除膽裂', '獵人貨架、怪物材料'],
    ['II', '霜苔敷料', '0.4／92', '標準', '中量治療', '高級製藥書'],
    ['II', '護刻石膏', '0.5／118', '沉重', '自身刻甲', '誓塚素材配方'],
    ['III', '追獵強湯', '0.5／300', '標準', '治療並昂志', '探索配方'],
    ['IV', '長夜靈藥', '0.6／940', '沉重', '高量治療；解除霜痕或膽裂', 'Boss 素材'],
    ['V', '火塘誓飲', '0.8／3100', '沉重', '大量治療、解除一負面、刻甲', '終局配方'],
  ],
  nonCombat: [
    ['雪地火種', 'Tier I／0.3／24', '迷宮分鐘', '資料化暖身狀態', '無疲勞回復；無 Handler 時 disabled'],
    ['狼脂燈油', 'Tier I／0.4／30', '迷宮分鐘', '延長既有照明狀態', '不揭露整張地圖'],
    ['冰鑿攀繩組', 'Tier II／2.0／120', '迷宮分鐘', '減少一次合法障礙互動分鐘', '不建立攀爬或位移系統'],
    ['氏族路標石', 'Tier II／1.2／160', 'Team Plan', '既有旅行事件權重修正', '無 Workflow 時 disabled'],
  ],
  general: [
    { title: '獵產與補給', rows: [['鹽漬肉乾', 'I', '0.6', '22', '補給／送貨'], ['鹿皮卷', 'I', '4.0', '85', '裁縫／送貨'], ['白鬃毛束', 'I', '1.5', '110', '工藝／探索'], ['霜苔包', 'I', '0.4', '36', '製藥／補貨']] },
    { title: '海岸貨物', rows: [['船釘木匣', 'I', '8.0', '150', '鍛造／送貨'], ['鯨脂燈磚', 'I', '1.2', '68', '照明／貨物'], ['焦油繩卷', 'I', '6.0', '125', '工藝／送貨'], ['鹽藻束', 'I', '1.0', '32', '料理／補貨']] },
    { title: '氏族器物', rows: [['誓環銅扣', 'II', '0.5', '180', '工藝／收藏'], ['火塘鐵架', 'I', '12.0', '190', '家具／送貨'], ['雕木酒杯', 'I', '0.4', '44', '工藝／購買'], ['圓盾掛架', 'I', '7.0', '135', '家具／送貨']] },
    { title: '家具與長歌', rows: [['白杉長凳', 'I', '18.0', '210', '家具／送貨'], ['厚毯木箱', 'I', '14.0', '240', '家具／購買'], ['誓詞拓片', 'II', '0.2', '220', '探索／書籍事件'], ['長歌抄本', 'II', '0.4', '310', '探索／購買']] },
    { title: '珍藏與器件', rows: [['冬冠石片', 'V', '1.8', '6200', '收藏／工藝'], ['古戰角口', 'II', '0.8', '420', '樂器／收藏'], ['銀弦軫', 'III', '0.4', '760', '樂器／收藏'], ['王塚盾環', 'IV', '3.0', '2800', '盾牌／收藏']] },
  ],
};

export const materialCatalog = [
  ['沼鐵錠', 'I', 'affix.vildun.heavy-hew', '斧、矛、盾、環甲'], ['白杉木', 'I', 'affix.vildun.true-shaft', '矛、弓、盾、家具'],
  ['鹿皮', 'I', 'affix.vildun.trail-light', '輕甲、弓具'], ['獵肉', 'I', 'affix.vildun.hearty-meal', '燉肉、肉湯'],
  ['寒地大麥', 'I', 'affix.vildun.satiety', '麥粥、燉湯'], ['冷水魚', 'I', 'affix.vildun.clear-meal', '魚湯、燻魚'],
  ['霜苔', 'I', 'affix.vildun.warming', '敷料、湯飲'], ['潮鐵', 'I', 'affix.vildun.steadfast-ring', '環甲、盾環、工具'],
  ['鹽藻', 'I', '無', '藥酒、魚湯、商貨'], ['焦油木', 'I', 'affix.vildun.weathered', '盾、長弓、家具'],
  ['白鬃皮', 'I', 'affix.vildun.pack-hunt', '輕甲、投槍'], ['熊脂', 'I', '無', '松脂膏、燈油、料理'],
  ['誓石片', 'II', 'affix.vildun.inscribed-oath', '法杖、盾、工藝'], ['寒銀砂', 'II', 'affix.vildun.frost-edge', '武器、刻杖'],
  ['鳴石', 'II', 'affix.vildun.resonant-heart', '戰角、弓琴'], ['古炭鐵', 'II', 'affix.vildun.unbroken-ring', '中重甲、雙手盾'],
  ['巨麋肉材', 'II', 'affix.vildun.feast-vigor', 'Tier II Boss 料理'], ['鯨蜥皮', 'II', 'affix.vildun.tide-ward', '輕中甲、盾'],
  ['風暴鐵', 'III', 'affix.vildun.storm-chaser', '高階斧、投擲、弓'], ['蒼白巨角', 'III', 'affix.vildun.long-song', '法杖、樂器、弓'],
  ['冬鋼', 'IV', 'affix.vildun.mountain-cleaver', '傳說斧、重甲'], ['夜刻石板', 'IV', 'affix.vildun.deep-carving', '傳說法杖、盾、弓琴'],
  ['冬冠石芯', 'V', 'affix.vildun.crown-oath', '神話盾、重甲、法杖'], ['墜星寒鐵', 'V', 'affix.vildun.sky-hunter', '神話斧、矛、弓、投擲'],
];

export const craftingCatalog = {
  equipmentRecipes: tierMeta.slice(0, 2).flatMap(meta => equipmentBlueprints.map(blueprint => ({
    id: `recipe.vildun.${blueprint.id}.${meta.tier.toLowerCase()}`,
    tier: meta.tier,
    output: `equipment.vildun.${blueprint.id}.${meta.tier.toLowerCase()}`,
    name: blueprint.names[meta.tier === 'I' ? 0 : 1],
    ingredientSlots: meta.tier === 'I' ? 1 : 2,
  }))),
  cuisine: [
    ['大麥肉湯', 'I', '大麥＋獵肉', '小幅一般防護', '杉脊獵人湯／基礎書'],
    ['霜苔魚湯', 'I', '霜苔＋冷水魚', '昂志與霜痕處理方向', '霜灣魚湯／基礎書'],
    ['獵人麥粥', 'I', '大麥＋鹿肉', '低量恢復與命中', '杉脊早粥／基礎書'],
    ['巨麋燉鍋', 'II', '巨麋肉＋霜苔＋大麥', '中量治療與刻甲', 'Boss／高級書'],
    ['鹽藻燻魚', 'II', '鹽藻＋冷水魚', '昂志與預判', '船塚高級書'],
    ['火塘濃湯', 'II', '熊脂＋獵肉＋大麥', '中量刻甲與治療', '誓塚高級書'],
  ],
  books: [
    ['基礎技能書', 'Lv.3', '霜灣、杉脊堡書店', '手斧與圓盾、白杉獵徑、火塘刻文、骨哨短調'],
    ['高級技能書', 'Lv.6', '寶箱、探索、地圖事件', '裂谷斧勢、誓塚刻錄、風雪箭譜、長夜和聲'],
    ['極品技能書', 'Lv.10', 'Boss 掉落', '冬冠斷峰、九誓守望、九石冬雷、誓歌不息'],
    ['基礎生活書', 'Lv.3', '城市書店', '沼鐵鍛作、白杉弓作、霜苔敷方、長屋湯鍋'],
    ['高級生活書', 'Lv.6', '探索內容', '潮鐵環甲、誓石器作、火塘食單'],
    ['極品生活書', 'Lv.10', 'Boss 掉落', '冬鋼百器、冬冠宴錄'],
  ],
};

export const mapLegend = { '#': '不存在', '.': '房間／通道', E: '入口', X: '出口', S: '樓梯', R: '固定採集點', T: '寶箱偏好', '?': '事件偏好', '!': '固定陷阱', B: '大體型敵人偏好' };
export const firstMapLayouts = [
  wildernessLayout({
    name: '白杉獵原', city: '杉脊堡', type: '一般野外型｜8×8 單層',
    label: '單層｜白杉與凍溪',
    note: '入口在北側林徑，出口在南側獵道。西坡與藏匿處各有一道紅門；兩處採集點分別代表白杉林與凍溪。',
  }),
  twoFloorLayout({
    name: '沉潮船塚', city: '霜灣', type: '一般地牢型｜5×5 地上／地下',
    floors: [
      { label: '地上 1F｜退潮船骸', note: '中央樓梯 (3,3) 與地下同座標；貨艙以紅門封住，船骸外緣是潮鐵採集點。' },
      { label: '地下 1F｜海蝕潮洞', note: '中央樓梯 (3,3) 上返；西南獸窟是 2×2 大型敵人偏好，紅門另一側為沉貨事件房。' },
    ],
  }),
  nationalDungeonLayout({
    name: '長夜誓塚', city: '霜灣', type: '地牢型國家迷宮｜6×6 地上 1F＋地下 5F',
    floors: [
      { label: '地上 1F｜誓石門庭', note: '門庭建立入口、第一座誓石採集點與下行樓梯 (2,5)。' },
      { label: '地下 1F｜盾環廊', note: '上行 (2,5)、下行 (5,2)；環廊以陷阱與紅門後的寶箱教學為主。' },
      { label: '地下 2F｜刻文廳', note: '上行 (5,2)、下行 (2,5)；誓石採集點以紅門與大室分隔。' },
      { label: '地下 3F｜沉火塘', note: '上行 (2,5)、下行 (5,2)；舊火塘是事件偏好，不確認任何祖靈真相。' },
      { label: '地下 4F｜長歌室', note: '上行 (5,2)、下行 (2,5)；鳴石採集點與大型敵人偏好分離。' },
      { label: '地下 5F｜冬冠石座', note: '上行 (2,5)；最深層保留 2×2 Boss 石座與唯一正式出口。' },
    ],
  }),
];

export const firstMapConfigs = [
  {
    name: '白杉獵原', city: '杉脊堡', tier: 'I', kind: '一般野外型', layout: '8×8 單層',
    materialPools: { gathering: [['白杉木', 35], ['霜苔', 30], ['鹿皮', 20], ['冷水魚', 15]], treasure: [['沼鐵錠', 30], ['焦油木', 20], ['白鬃皮', 20], ['熊脂', 15], ['寒地大麥', 15]] },
  },
  {
    name: '沉潮船塚', city: '霜灣', tier: 'I', kind: '一般地牢型', layout: '5×5 地上／地下',
    materialPools: { gathering: [['潮鐵', 35], ['鹽藻', 30], ['焦油木', 25], ['冷水魚', 10]], treasure: [['沼鐵錠', 25], ['潮鐵', 25], ['焦油木', 20], ['鯨蜥皮', 10], ['白杉木', 20]] },
  },
  {
    name: '長夜誓塚', city: '霜灣', tier: 'II', kind: '地牢型國家迷宮', layout: '6×6；地上 1F＋地下 5F',
    materialPools: { gathering: [['誓石片', 35], ['寒銀砂', 25], ['古炭鐵', 25], ['鳴石', 15]], treasure: [['誓石片', 20], ['寒銀砂', 30], ['古炭鐵', 25], ['鳴石', 20], ['鯨蜥皮', 5]] },
  },
];

export const validationSummary = (() => {
  const equipmentLines = equipmentCatalog.flatMap(group => group.lines);
  const equipmentItems = equipmentLines.flat();
  const skills = skillCatalog.flatMap(route => route.rows);
  const mapPoolTotals = firstMapConfigs.flatMap(map => Object.entries(map.materialPools).map(([pool, rows]) => ({ map: map.name, pool, total: rows.reduce((sum, [, weight]) => sum + weight, 0) })));
  const errors = [];
  if (equipmentLines.length !== 18) errors.push(`裝備底模應為 18，實際 ${equipmentLines.length}`);
  if (equipmentItems.length !== 90) errors.push(`裝備條目應為 90，實際 ${equipmentItems.length}`);
  if (skills.length !== 80) errors.push(`技能應為 80，實際 ${skills.length}`);
  if (new Set(skills.map(skill => skill.id)).size !== skills.length) errors.push('技能 Definition ID 有重複');
  if (monsterCatalog.nonHuman.length !== 15) errors.push(`非人類怪物應為 15，實際 ${monsterCatalog.nonHuman.length}`);
  if (monsterCatalog.humanEncounters.length !== 5) errors.push(`人類 Encounter 應為 5，實際 ${monsterCatalog.humanEncounters.length}`);
  if (craftingCatalog.equipmentRecipes.filter(recipe => recipe.tier === 'I').length !== 18 || craftingCatalog.equipmentRecipes.filter(recipe => recipe.tier === 'II').length !== 18) errors.push('Tier I／II 裝備配方未各覆蓋 18 種底模');
  mapPoolTotals.filter(entry => entry.total !== 100).forEach(entry => errors.push(`${entry.map}／${entry.pool} 權重為 ${entry.total}`));
  errors.push(...validateMapLayouts(firstMapLayouts));
  return {
    ok: errors.length === 0,
    errors,
    counts: { equipmentLines: equipmentLines.length, equipmentItems: equipmentItems.length, skills: skills.length, nonHumanMonsters: monsterCatalog.nonHuman.length, humanEncounters: monsterCatalog.humanEncounters.length, maps: firstMapLayouts.length, floors: firstMapLayouts.reduce((sum, map) => sum + map.floors.length, 0), materials: materialCatalog.length },
    mapPoolTotals,
  };
})();

if (!validationSummary.ok) throw new Error(`維爾冬內容資料驗證失敗：\n${validationSummary.errors.join('\n')}`);
