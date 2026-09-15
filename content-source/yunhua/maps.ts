// 雲華九張地牢的正式模板、遭遇預算與文化池。
// 拓樸與平衡契約：docs/03_content/yunhua/yunhua_content.md §4、§7.4。
import type {
  ChestPoolId,
  CharacterArchetypeId,
  CultureContentRuleId,
  DefinitionId,
  ExperienceAwardRuleId,
  MapEventPoolId,
  MapSpawnRuleId,
  MapTemplateId,
  RoomId,
  RoomLinkId,
} from '../../src/contracts/core';
import type { MonsterSpeciesKind, MonsterThreatRank } from '../../src/contracts/combat';
import type {
  CultureContentRuleDefinition,
  FloorDefinition,
  GridCell,
  MapContentDefinition,
  MapContentKind,
  MapContentNpcPolicy,
  MapSpawnRuleDefinition,
  MapTemplateDefinition,
  RoomDefinition,
  RoomLinkDefinition,
  SpawnBudgetDefinition,
} from '../../src/contracts/map';
import { cultureIds, type Authored, type AuthoredDomain } from '../authoring';
import {
  YUNHUA_HUMAN_CANDIDATES,
  YUNHUA_NON_HUMAN_CANDIDATES,
  type YunhuaContentCandidate,
} from './monsters';
import {
  NPC_DUNGEON_TARGET_RESOLVER_IDS,
  NPC_SEQUENCE_RULE_ID,
} from '../core/world-map-dungeon-npc';

const yunhua = cultureIds('yunhua');

const TIER_LABEL: Readonly<Record<1 | 2, 'i' | 'ii'>> = { 1: 'i', 2: 'ii' };

function explorationExperienceRuleId(tier: 1 | 2): ExperienceAwardRuleId {
  return `experience-award-rule.core.map-exploration-tier-${TIER_LABEL[tier]}` as ExperienceAwardRuleId;
}

type Cell = readonly [row: number, col: number];

type FloorRow = Readonly<{ key: string; floor: number; rows: number; cols: number }>;
type RoomRow = Readonly<{ f: string; id: string; cells: readonly Cell[] }>;
type LinkRow = Readonly<{
  f: string;
  from: string;
  to: string;
  fromCell: Cell;
  toCell: Cell;
  door?: true;
  guards?: readonly ('chest' | 'event' | 'largeEnemy')[];
  toFloorKey?: string;
}>;

type TopologyRow = Readonly<{
  local: MapLocal;
  sourceName: string;
  floors: readonly FloorRow[];
  rooms: readonly RoomRow[];
  links: readonly LinkRow[];
  entrances: readonly (readonly [string, string])[];
  exits: readonly (readonly [string, string])[];
}>;

type MapLocal =
  | 'old-canal-sunken-store' // 舊漕渠與沉倉（線索：pool 樹的 `waterway`、§11.2 `waterway-reed`）
  | 'calendar-court-ruin' // 司曆殘院（無線索）
  | 'seal-tower' // 天衡印塔（線索：pool 樹的 `seal-tower`、§11.2 `seal-rubble`）
  | 'mist-bamboo-valley' // 霧篁藥谷（線索：pool 樹的 `mist`、§11.2 `mist-herb`）
  | 'hanging-spring-grotto' // 懸泉石窟（無線索）
  | 'tidal-reed-isle' // 潮生蘆洲（無線索）
  | 'salt-well-cellar' // 鹽井封窖（無線索）
  | 'cinnabar-ridge' // 朱砂斷嶺（無線索）
  | 'old-kiln-flue'; // 古窯火道（無線索）

type MapProfile = Readonly<{
  templateKind: 'outdoor' | 'interior';
  nationalDungeonForm?: 'building';
  tier: 1 | 2;
  refreshOffsetDays: number;
  spawnBudgets: readonly SpawnBudgetDefinition[];
}>;

function budget(contentKind: MapContentKind, count: number): SpawnBudgetDefinition {
  return { contentKind, minCount: count, maxCount: count };
}

const PROFILES: Readonly<Record<MapLocal, MapProfile>> = {
  'old-canal-sunken-store': {
    templateKind: 'interior',
    tier: 1,
    refreshOffsetDays: 0,
    spawnBudgets: [budget('monsterGroup', 3), budget('kidnap', 1)],
  },
  'calendar-court-ruin': {
    templateKind: 'outdoor',
    tier: 2,
    refreshOffsetDays: 1,
    spawnBudgets: [budget('monsterGroup', 4)],
  },
  'seal-tower': {
    templateKind: 'interior',
    nationalDungeonForm: 'building',
    tier: 2,
    refreshOffsetDays: 2,
    spawnBudgets: [budget('monsterGroup', 5), budget('boss', 1)],
  },
  'mist-bamboo-valley': {
    templateKind: 'outdoor',
    tier: 1,
    refreshOffsetDays: 3,
    spawnBudgets: [budget('monsterGroup', 3), budget('boss', 1), budget('kidnap', 1)],
  },
  'hanging-spring-grotto': {
    templateKind: 'interior',
    tier: 2,
    refreshOffsetDays: 4,
    spawnBudgets: [budget('monsterGroup', 4)],
  },
  'tidal-reed-isle': {
    templateKind: 'outdoor',
    tier: 1,
    refreshOffsetDays: 5,
    spawnBudgets: [budget('monsterGroup', 3)],
  },
  'salt-well-cellar': {
    templateKind: 'interior',
    tier: 2,
    refreshOffsetDays: 6,
    spawnBudgets: [budget('monsterGroup', 4), budget('kidnap', 1)],
  },
  'cinnabar-ridge': {
    templateKind: 'outdoor',
    tier: 1,
    refreshOffsetDays: 7,
    spawnBudgets: [budget('monsterGroup', 3)],
  },
  'old-kiln-flue': {
    templateKind: 'interior',
    tier: 2,
    refreshOffsetDays: 8,
    spawnBudgets: [budget('monsterGroup', 4), budget('kidnap', 1)],
  },
};


const TOPOLOGY: readonly TopologyRow[] = [
  {
    local: 'old-canal-sunken-store',
    sourceName: '舊漕渠與沉倉',
    floors: [
      { key: 'f1', floor: 1, rows: 5, cols: 5 },
      { key: 'b1', floor: -1, rows: 5, cols: 5 },
    ],
    rooms: [
      { f: 'f1', id: '水道入口', cells: [[1, 1]] }, // entry
      { f: 'f1', id: '西側倉房', cells: [[1, 2], [1, 3], [2, 2], [2, 3], [2, 4], [3, 2], [3, 3]] }, // marks=treasure
      { f: 'f1', id: '引水走廊', cells: [[3, 4], [4, 2], [4, 3], [4, 4], [5, 3]] }, // marks=resource
      { f: 'f1', id: '西側下行梯', cells: [[4, 5]] }, // stair↓
      { f: 'f1', id: '東側沉倉', cells: [[1, 4], [1, 5]] }, // marks=event
      { f: 'f1', id: '東側下行梯', cells: [[2, 5]] }, // stair↓
      { f: 'b1', id: '東側上行梯', cells: [[2, 5]] }, // stair↑
      { f: 'b1', id: '東側導渠', cells: [[3, 5]] }, // marks=resource
      { f: 'b1', id: '蓄水池', cells: [[3, 3], [3, 4], [4, 3], [4, 4]] }, // marks=large
      { f: 'b1', id: '西側上行梯', cells: [[4, 5]] }, // stair↑
      { f: 'b1', id: '中段水閘', cells: [[1, 2], [1, 3], [2, 2], [2, 3], [2, 4]] }, // marks=event
      { f: 'b1', id: '西側沉貨區', cells: [[3, 2], [4, 2], [5, 2]] }, // marks=treasure
      { f: 'b1', id: '水門出口', cells: [[5, 3]] }, // exit
      { f: 'b1', id: '沉木陷阱', cells: [[5, 4]] }, // marks=trap
    ],
    links: [
      { f: 'f1', from: '水道入口', to: '西側倉房', fromCell: [1, 1], toCell: [1, 2], door: true, guards: ['chest'] },
      { f: 'f1', from: '西側倉房', to: '引水走廊', fromCell: [3, 3], toCell: [3, 4] },
      { f: 'f1', from: '引水走廊', to: '西側下行梯', fromCell: [4, 4], toCell: [4, 5] },
      { f: 'f1', from: '東側沉倉', to: '東側下行梯', fromCell: [1, 5], toCell: [2, 5] },
      { f: 'b1', from: '東側上行梯', to: '東側導渠', fromCell: [2, 5], toCell: [3, 5] },
      { f: 'b1', from: '東側導渠', to: '蓄水池', fromCell: [3, 5], toCell: [3, 4] },
      { f: 'b1', from: '蓄水池', to: '西側上行梯', fromCell: [4, 4], toCell: [4, 5] },
      { f: 'b1', from: '蓄水池', to: '沉木陷阱', fromCell: [4, 4], toCell: [5, 4] },
      { f: 'b1', from: '水門出口', to: '西側沉貨區', fromCell: [5, 3], toCell: [5, 2] },
      { f: 'b1', from: '西側沉貨區', to: '中段水閘', fromCell: [3, 2], toCell: [2, 2] },
      { f: 'b1', from: '中段水閘', to: '蓄水池', fromCell: [2, 4], toCell: [3, 4], door: true, guards: ['event', 'largeEnemy'] },
      { f: 'f1', from: '西側下行梯', to: '西側上行梯', toFloorKey: 'b1', fromCell: [4, 5], toCell: [4, 5] },
      { f: 'f1', from: '東側下行梯', to: '東側上行梯', toFloorKey: 'b1', fromCell: [2, 5], toCell: [2, 5] },
    ],
    entrances: [['f1', '水道入口']],
    exits: [['b1', '水門出口']],
  },
  {
    local: 'calendar-court-ruin',
    sourceName: '司曆殘院',
    floors: [
      { key: 'f1', floor: 1, rows: 8, cols: 8 },
    ],
    rooms: [
      { f: 'f1', id: 'entry', cells: [[1, 3]] }, // entry
      { f: 'f1', id: 'northRidge', cells: [[1, 4], [1, 5], [2, 4], [2, 5]] },
      { f: 'f1', id: 'northSpring', cells: [[2, 6]] }, // marks=resource
      { f: 'f1', id: 'westSlope', cells: [[2, 2], [2, 3], [3, 1], [3, 2], [3, 3]] }, // marks=treasure
      { f: 'f1', id: 'westQuarry', cells: [[4, 1], [4, 2]] }, // marks=resource
      { f: 'f1', id: 'eastCliff', cells: [[3, 6], [3, 7], [3, 8]] },
      { f: 'f1', id: 'beastRange', cells: [[4, 7], [4, 8], [5, 8]] }, // marks=large
      { f: 'f1', id: 'centralField', cells: [[4, 3], [4, 4], [4, 5], [4, 6], [5, 4], [5, 5]] },
      { f: 'f1', id: 'iceCrack', cells: [[5, 3]] }, // marks=trap
      { f: 'f1', id: 'westVale', cells: [[5, 1], [5, 2], [6, 1], [6, 2]] },
      { f: 'f1', id: 'riteClearing', cells: [[6, 3], [6, 4], [6, 5]] }, // marks=event
      { f: 'f1', id: 'eastTrail', cells: [[6, 6], [6, 7], [7, 7], [7, 8]] },
      { f: 'f1', id: 'cache', cells: [[7, 4]] }, // marks=treasure
      { f: 'f1', id: 'southTrailWest', cells: [[7, 2], [7, 3]] },
      { f: 'f1', id: 'southTrailEast', cells: [[7, 5], [7, 6]] },
      { f: 'f1', id: 'exitPass', cells: [[8, 4], [8, 5], [8, 6]] },
      { f: 'f1', id: 'exit', cells: [[8, 7]] }, // exit
    ],
    links: [
      { f: 'f1', from: 'entry', to: 'northRidge', fromCell: [1, 3], toCell: [1, 4] },
      { f: 'f1', from: 'northRidge', to: 'westSlope', fromCell: [2, 4], toCell: [2, 3] },
      { f: 'f1', from: 'northRidge', to: 'northSpring', fromCell: [2, 5], toCell: [2, 6] },
      { f: 'f1', from: 'northSpring', to: 'eastCliff', fromCell: [2, 6], toCell: [3, 6] },
      { f: 'f1', from: 'westSlope', to: 'westQuarry', fromCell: [3, 1], toCell: [4, 1] },
      { f: 'f1', from: 'westSlope', to: 'centralField', fromCell: [3, 3], toCell: [4, 3], door: true, guards: ['chest'] },
      { f: 'f1', from: 'westQuarry', to: 'centralField', fromCell: [4, 2], toCell: [4, 3] },
      { f: 'f1', from: 'eastCliff', to: 'beastRange', fromCell: [3, 7], toCell: [4, 7] },
      { f: 'f1', from: 'beastRange', to: 'centralField', fromCell: [4, 7], toCell: [4, 6] },
      { f: 'f1', from: 'centralField', to: 'iceCrack', fromCell: [5, 4], toCell: [5, 3] },
      { f: 'f1', from: 'centralField', to: 'riteClearing', fromCell: [5, 4], toCell: [6, 4] },
      { f: 'f1', from: 'iceCrack', to: 'westVale', fromCell: [5, 3], toCell: [5, 2] },
      { f: 'f1', from: 'westVale', to: 'southTrailWest', fromCell: [6, 2], toCell: [7, 2] },
      { f: 'f1', from: 'riteClearing', to: 'eastTrail', fromCell: [6, 5], toCell: [6, 6] },
      { f: 'f1', from: 'southTrailWest', to: 'cache', fromCell: [7, 3], toCell: [7, 4] },
      { f: 'f1', from: 'cache', to: 'southTrailEast', fromCell: [7, 4], toCell: [7, 5] },
      { f: 'f1', from: 'southTrailEast', to: 'eastTrail', fromCell: [7, 6], toCell: [7, 7] },
      { f: 'f1', from: 'cache', to: 'exitPass', fromCell: [7, 4], toCell: [8, 4], door: true, guards: ['chest'] },
      { f: 'f1', from: 'eastTrail', to: 'exit', fromCell: [7, 7], toCell: [8, 7] },
      { f: 'f1', from: 'exitPass', to: 'exit', fromCell: [8, 6], toCell: [8, 7] },
    ],
    entrances: [['f1', 'entry']],
    exits: [['f1', 'exit']],
  },
  {
    local: 'seal-tower',
    sourceName: '天衡印塔',
    floors: [
      { key: 'f1', floor: 1, rows: 6, cols: 6 },
      { key: 'f2', floor: 2, rows: 6, cols: 6 },
      { key: 'f3', floor: 3, rows: 6, cols: 6 },
      { key: 'f4', floor: 4, rows: 6, cols: 6 },
      { key: 'b1', floor: -1, rows: 6, cols: 6 },
      { key: 'b2', floor: -2, rows: 6, cols: 6 },
    ],
    rooms: [
      { f: 'f1', id: '入塔入口', cells: [[6, 1]] }, // entry
      { f: 'f1', id: '入塔前室', cells: [[5, 1], [5, 2], [6, 2]] },
      { f: 'f1', id: '下行封門梯', cells: [[4, 2]] }, // stair↓
      { f: 'f1', id: '正印前庭', cells: [[4, 3], [4, 4], [5, 3], [5, 4]] }, // marks=event
      { f: 'f1', id: '上行校印廳', cells: [[2, 3], [3, 3], [3, 4]] },
      { f: 'f1', id: '上行校印梯', cells: [[2, 4]] }, // stair↑
      { f: 'f1', id: '側庫', cells: [[2, 5], [3, 5]] }, // marks=treasure
      { f: 'f1', id: '符紙火陷', cells: [[1, 4]] }, // marks=trap
      { f: 'f1', id: '北側環廊', cells: [[1, 5]] }, // marks=resource
      { f: 'f2', id: '下行校印廳', cells: [[1, 3], [1, 4], [2, 3]] },
      { f: 'f2', id: '下行校印梯', cells: [[2, 4]] }, // stair↓
      { f: 'f2', id: '中段校印室', cells: [[3, 2], [4, 2], [4, 3]] }, // marks=event
      { f: 'f2', id: '上行校印梯', cells: [[3, 3]] }, // stair↑
      { f: 'f2', id: '東側書庫', cells: [[3, 5], [3, 6], [4, 5], [4, 6]] }, // marks=treasure
      { f: 'f2', id: '下層迴廊', cells: [[5, 3], [5, 4], [6, 3], [6, 4]] }, // marks=resource
      { f: 'f2', id: '碎印陷阱', cells: [[6, 5]] }, // marks=trap
      { f: 'f2', id: '東向短廊', cells: [[3, 4]] },
      { f: 'f3', id: '下行藏卷室', cells: [[3, 2], [4, 2], [4, 3]] },
      { f: 'f3', id: '下行藏卷梯', cells: [[3, 3]] }, // stair↓
      { f: 'f3', id: '上行藏卷室', cells: [[1, 3], [1, 4], [2, 3]] }, // marks=resource
      { f: 'f3', id: '上行藏卷梯', cells: [[2, 4]] }, // stair↑
      { f: 'f3', id: '東側典藏庫', cells: [[3, 5], [3, 6], [4, 5], [4, 6]] }, // marks=event
      { f: 'f3', id: '南側卷軸庫', cells: [[5, 4], [6, 4]] }, // marks=treasure
      { f: 'f3', id: '折角短廊', cells: [[3, 4], [4, 4]] },
      { f: 'f3', id: '落卷陷阱', cells: [[5, 5]] }, // marks=trap
      { f: 'f4', id: '塔外出口', cells: [[1, 3]] }, // exit
      { f: 'f4', id: '觀印前室', cells: [[1, 4]] }, // marks=resource
      { f: 'f4', id: '下行觀印梯', cells: [[2, 4]] }, // stair↓
      { f: 'f4', id: '北側符銘室', cells: [[1, 5], [1, 6], [2, 5]] }, // marks=event
      { f: 'f4', id: '觀印台', cells: [[3, 2], [3, 3], [3, 4], [3, 5], [4, 2], [4, 3], [4, 4], [4, 5]] }, // marks=large
      { f: 'f4', id: '東側儀器庫', cells: [[3, 6], [4, 6]] }, // marks=treasure
      { f: 'b1', id: '上行封門梯', cells: [[4, 2]] }, // stair↑
      { f: 'b1', id: '封門前廳', cells: [[4, 1], [5, 1], [5, 2], [5, 3]] }, // marks=resource
      { f: 'b1', id: '中段封印室', cells: [[3, 3], [3, 4], [4, 3], [4, 4]] }, // marks=event
      { f: 'b1', id: '下行地脈梯', cells: [[2, 5]] }, // stair↓
      { f: 'b1', id: '地脈前廳', cells: [[1, 5], [1, 6], [2, 6]] },
      { f: 'b1', id: '封存架', cells: [[5, 4], [5, 5], [6, 4], [6, 5]] }, // marks=treasure
      { f: 'b1', id: '地脈短廊', cells: [[3, 5]] }, // marks=trap
      { f: 'b2', id: '上行地脈梯', cells: [[2, 5]] }, // stair↑
      { f: 'b2', id: '地脈前廳', cells: [[1, 5], [1, 6], [2, 6]] }, // marks=resource
      { f: 'b2', id: '地脈主室', cells: [[3, 2], [3, 3], [3, 4], [3, 5], [4, 2], [4, 3], [4, 4], [4, 5], [5, 2], [5, 3], [5, 4], [5, 5]] }, // marks=event
      { f: 'b2', id: '地脈側庫', cells: [[6, 2], [6, 3]] }, // marks=treasure
    ],
    links: [
      { f: 'f1', from: '入塔入口', to: '入塔前室', fromCell: [6, 1], toCell: [6, 2] },
      { f: 'f1', from: '入塔前室', to: '下行封門梯', fromCell: [5, 2], toCell: [4, 2], door: true },
      { f: 'f1', from: '入塔前室', to: '正印前庭', fromCell: [5, 2], toCell: [5, 3] },
      { f: 'f1', from: '正印前庭', to: '上行校印廳', fromCell: [4, 3], toCell: [3, 3] },
      { f: 'f1', from: '上行校印廳', to: '上行校印梯', fromCell: [2, 3], toCell: [2, 4] },
      { f: 'f1', from: '上行校印廳', to: '側庫', fromCell: [3, 4], toCell: [3, 5], door: true, guards: ['chest'] },
      { f: 'f1', from: '上行校印梯', to: '符紙火陷', fromCell: [2, 4], toCell: [1, 4] },
      { f: 'f1', from: '符紙火陷', to: '北側環廊', fromCell: [1, 4], toCell: [1, 5] },
      { f: 'f2', from: '下行校印廳', to: '下行校印梯', fromCell: [2, 3], toCell: [2, 4] },
      { f: 'f2', from: '下行校印廳', to: '上行校印梯', fromCell: [2, 3], toCell: [3, 3] },
      { f: 'f2', from: '上行校印梯', to: '中段校印室', fromCell: [3, 3], toCell: [4, 3] },
      { f: 'f2', from: '上行校印梯', to: '東向短廊', fromCell: [3, 3], toCell: [3, 4] },
      { f: 'f2', from: '東向短廊', to: '東側書庫', fromCell: [3, 4], toCell: [3, 5], door: true, guards: ['chest'] },
      { f: 'f2', from: '中段校印室', to: '下層迴廊', fromCell: [4, 3], toCell: [5, 3] },
      { f: 'f2', from: '下層迴廊', to: '碎印陷阱', fromCell: [6, 4], toCell: [6, 5] },
      { f: 'f3', from: '下行藏卷室', to: '下行藏卷梯', fromCell: [4, 3], toCell: [3, 3] },
      { f: 'f3', from: '下行藏卷梯', to: '折角短廊', fromCell: [3, 3], toCell: [3, 4] },
      { f: 'f3', from: '折角短廊', to: '東側典藏庫', fromCell: [3, 4], toCell: [3, 5], door: true, guards: ['event'] },
      { f: 'f3', from: '折角短廊', to: '上行藏卷梯', fromCell: [3, 4], toCell: [2, 4] },
      { f: 'f3', from: '上行藏卷梯', to: '上行藏卷室', fromCell: [2, 4], toCell: [2, 3] },
      { f: 'f3', from: '折角短廊', to: '南側卷軸庫', fromCell: [4, 4], toCell: [5, 4] },
      { f: 'f3', from: '南側卷軸庫', to: '落卷陷阱', fromCell: [5, 4], toCell: [5, 5] },
      { f: 'f4', from: '塔外出口', to: '觀印前室', fromCell: [1, 3], toCell: [1, 4] },
      { f: 'f4', from: '觀印前室', to: '下行觀印梯', fromCell: [1, 4], toCell: [2, 4] },
      { f: 'f4', from: '觀印前室', to: '北側符銘室', fromCell: [1, 4], toCell: [1, 5] },
      { f: 'f4', from: '下行觀印梯', to: '觀印台', fromCell: [2, 4], toCell: [3, 4], door: true, guards: ['largeEnemy'] },
      { f: 'f4', from: '觀印台', to: '東側儀器庫', fromCell: [3, 5], toCell: [3, 6] },
      { f: 'b1', from: '上行封門梯', to: '封門前廳', fromCell: [4, 2], toCell: [4, 1] },
      { f: 'b1', from: '封門前廳', to: '中段封印室', fromCell: [5, 3], toCell: [4, 3], door: true, guards: ['event'] },
      { f: 'b1', from: '中段封印室', to: '地脈短廊', fromCell: [3, 4], toCell: [3, 5] },
      { f: 'b1', from: '地脈短廊', to: '下行地脈梯', fromCell: [3, 5], toCell: [2, 5] },
      { f: 'b1', from: '下行地脈梯', to: '地脈前廳', fromCell: [2, 5], toCell: [2, 6] },
      { f: 'b1', from: '中段封印室', to: '封存架', fromCell: [4, 4], toCell: [5, 4] },
      { f: 'b2', from: '上行地脈梯', to: '地脈前廳', fromCell: [2, 5], toCell: [2, 6] },
      { f: 'b2', from: '上行地脈梯', to: '地脈主室', fromCell: [2, 5], toCell: [3, 5], door: true, guards: ['event'] },
      { f: 'b2', from: '地脈主室', to: '地脈側庫', fromCell: [5, 2], toCell: [6, 2] },
      { f: 'f2', from: '下行校印梯', to: '上行校印梯', toFloorKey: 'f1', fromCell: [2, 4], toCell: [2, 4] },
      { f: 'f3', from: '下行藏卷梯', to: '上行校印梯', toFloorKey: 'f2', fromCell: [3, 3], toCell: [3, 3] },
      { f: 'f4', from: '下行觀印梯', to: '上行藏卷梯', toFloorKey: 'f3', fromCell: [2, 4], toCell: [2, 4] },
      { f: 'f1', from: '下行封門梯', to: '上行封門梯', toFloorKey: 'b1', fromCell: [4, 2], toCell: [4, 2] },
      { f: 'b1', from: '下行地脈梯', to: '上行地脈梯', toFloorKey: 'b2', fromCell: [2, 5], toCell: [2, 5] },
    ],
    entrances: [['f1', '入塔入口']],
    exits: [['f4', '塔外出口']],
  },
  {
    local: 'mist-bamboo-valley',
    sourceName: '霧篁藥谷',
    floors: [
      { key: 'f1', floor: 1, rows: 8, cols: 8 },
    ],
    rooms: [
      { f: 'f1', id: '入口竹徑', cells: [[8, 1]] }, // entry
      { f: 'f1', id: '南側山徑', cells: [[8, 2], [8, 3], [7, 2], [7, 3]] }, // marks=resource
      { f: 'f1', id: '瘴氣裂縫', cells: [[7, 4]] }, // marks=trap
      { f: 'f1', id: '西側竹叢', cells: [[6, 2], [6, 3], [5, 2], [5, 3], [5, 4]] }, // marks=treasure
      { f: 'f1', id: '採藥台地', cells: [[4, 3], [4, 4], [3, 3], [3, 4]] }, // marks=event
      { f: 'f1', id: '中央空地', cells: [[4, 5], [4, 6], [5, 5], [5, 6]] }, // marks=large
      { f: 'f1', id: '東側棧道', cells: [[5, 7], [4, 7], [3, 7], [3, 8], [2, 8]] }, // marks=resource
      { f: 'f1', id: '崩裂棧板', cells: [[2, 7]] }, // marks=trap
      { f: 'f1', id: '北側藥棚', cells: [[3, 5], [2, 4], [2, 5], [2, 6], [1, 5], [1, 6]] }, // marks=treasure/event
      { f: 'f1', id: '北口', cells: [[1, 7]] }, // exit
    ],
    links: [
      { f: 'f1', from: '入口竹徑', to: '南側山徑', fromCell: [8, 1], toCell: [8, 2] },
      { f: 'f1', from: '南側山徑', to: '西側竹叢', fromCell: [7, 3], toCell: [6, 3] },
      { f: 'f1', from: '南側山徑', to: '瘴氣裂縫', fromCell: [7, 3], toCell: [7, 4] },
      { f: 'f1', from: '西側竹叢', to: '採藥台地', fromCell: [5, 4], toCell: [4, 4] },
      { f: 'f1', from: '採藥台地', to: '中央空地', fromCell: [4, 4], toCell: [4, 5] },
      { f: 'f1', from: '中央空地', to: '東側棧道', fromCell: [4, 6], toCell: [4, 7], door: true, guards: ['largeEnemy'] },
      { f: 'f1', from: '東側棧道', to: '崩裂棧板', fromCell: [2, 8], toCell: [2, 7] },
      { f: 'f1', from: '崩裂棧板', to: '北側藥棚', fromCell: [2, 7], toCell: [2, 6] },
      { f: 'f1', from: '北側藥棚', to: '北口', fromCell: [1, 6], toCell: [1, 7] },
    ],
    entrances: [['f1', '入口竹徑']],
    exits: [['f1', '北口']],
  },
  {
    local: 'hanging-spring-grotto',
    sourceName: '懸泉石窟',
    floors: [
      { key: 'f1', floor: 1, rows: 5, cols: 5 },
      { key: 'b1', floor: -1, rows: 5, cols: 5 },
    ],
    rooms: [
      { f: 'f1', id: 'entry', cells: [[1, 2]] }, // entry
      { f: 'f1', id: 'foreHall', cells: [[1, 3], [2, 2], [2, 3]] },
      { f: 'f1', id: 'westHold', cells: [[2, 1], [3, 1]] },
      { f: 'f1', id: 'surfaceVein', cells: [[2, 4]] }, // marks=resource
      { f: 'f1', id: 'collapsedDeck', cells: [[3, 2]] }, // marks=trap
      { f: 'f1', id: 'stairDown', cells: [[3, 3]] }, // stair↓
      { f: 'f1', id: 'eastGangway', cells: [[3, 4], [3, 5], [4, 5]] },
      { f: 'f1', id: 'holdChamber', cells: [[4, 3], [4, 4]] }, // marks=treasure
      { f: 'f1', id: 'westStep', cells: [[4, 2]] },
      { f: 'f1', id: 'southWalk', cells: [[5, 3], [5, 4]] },
      { f: 'f1', id: 'exit', cells: [[5, 5]] }, // exit
      { f: 'b1', id: 'upperCave', cells: [[1, 3], [2, 2], [2, 3], [2, 4]] },
      { f: 'b1', id: 'westDrift', cells: [[3, 1]] },
      { f: 'b1', id: 'deepVein', cells: [[3, 2]] }, // marks=resource
      { f: 'b1', id: 'stairUp', cells: [[3, 3]] }, // stair↑
      { f: 'b1', id: 'eastDrift', cells: [[3, 4], [3, 5]] },
      { f: 'b1', id: 'beastDen', cells: [[4, 1], [4, 2], [5, 2]] }, // marks=large
      { f: 'b1', id: 'sunkenCargo', cells: [[4, 3], [4, 4]] }, // marks=event
    ],
    links: [
      { f: 'f1', from: 'entry', to: 'foreHall', fromCell: [1, 2], toCell: [1, 3] },
      { f: 'f1', from: 'foreHall', to: 'westHold', fromCell: [2, 2], toCell: [2, 1] },
      { f: 'f1', from: 'foreHall', to: 'surfaceVein', fromCell: [2, 3], toCell: [2, 4] },
      { f: 'f1', from: 'westHold', to: 'collapsedDeck', fromCell: [3, 1], toCell: [3, 2] },
      { f: 'f1', from: 'collapsedDeck', to: 'stairDown', fromCell: [3, 2], toCell: [3, 3] },
      { f: 'f1', from: 'stairDown', to: 'eastGangway', fromCell: [3, 3], toCell: [3, 4] },
      { f: 'f1', from: 'eastGangway', to: 'holdChamber', fromCell: [4, 5], toCell: [4, 4], door: true, guards: ['chest'] },
      { f: 'f1', from: 'holdChamber', to: 'westStep', fromCell: [4, 3], toCell: [4, 2] },
      { f: 'f1', from: 'holdChamber', to: 'southWalk', fromCell: [4, 3], toCell: [5, 3] },
      { f: 'f1', from: 'southWalk', to: 'exit', fromCell: [5, 4], toCell: [5, 5] },
      { f: 'b1', from: 'upperCave', to: 'deepVein', fromCell: [2, 2], toCell: [3, 2] },
      { f: 'b1', from: 'upperCave', to: 'stairUp', fromCell: [2, 3], toCell: [3, 3] },
      { f: 'b1', from: 'upperCave', to: 'eastDrift', fromCell: [2, 4], toCell: [3, 4] },
      { f: 'b1', from: 'stairUp', to: 'eastDrift', fromCell: [3, 3], toCell: [3, 4] },
      { f: 'b1', from: 'deepVein', to: 'westDrift', fromCell: [3, 2], toCell: [3, 1] },
      { f: 'b1', from: 'westDrift', to: 'beastDen', fromCell: [3, 1], toCell: [4, 1] },
      { f: 'b1', from: 'beastDen', to: 'sunkenCargo', fromCell: [4, 2], toCell: [4, 3], door: true, guards: ['largeEnemy', 'event'] },
      { f: 'b1', from: 'eastDrift', to: 'sunkenCargo', fromCell: [3, 4], toCell: [4, 4] },
      { f: 'f1', from: 'stairDown', to: 'stairUp', toFloorKey: 'b1', fromCell: [3, 3], toCell: [3, 3] },
    ],
    entrances: [['f1', 'entry']],
    exits: [['f1', 'exit']],
  },
  {
    local: 'tidal-reed-isle',
    sourceName: '潮生蘆洲',
    floors: [
      { key: 'f1', floor: 1, rows: 8, cols: 8 },
    ],
    rooms: [
      { f: 'f1', id: 'entry', cells: [[1, 3]] }, // entry
      { f: 'f1', id: 'northRidge', cells: [[1, 4], [1, 5], [2, 4], [2, 5]] },
      { f: 'f1', id: 'northSpring', cells: [[2, 6]] }, // marks=resource
      { f: 'f1', id: 'westSlope', cells: [[2, 2], [2, 3], [3, 1], [3, 2], [3, 3]] }, // marks=treasure
      { f: 'f1', id: 'westQuarry', cells: [[4, 1], [4, 2]] }, // marks=resource
      { f: 'f1', id: 'eastCliff', cells: [[3, 6], [3, 7], [3, 8]] },
      { f: 'f1', id: 'beastRange', cells: [[4, 7], [4, 8], [5, 8]] }, // marks=large
      { f: 'f1', id: 'centralField', cells: [[4, 3], [4, 4], [4, 5], [4, 6], [5, 4], [5, 5]] },
      { f: 'f1', id: 'iceCrack', cells: [[5, 3]] }, // marks=trap
      { f: 'f1', id: 'westVale', cells: [[5, 1], [5, 2], [6, 1], [6, 2]] },
      { f: 'f1', id: 'riteClearing', cells: [[6, 3], [6, 4], [6, 5]] }, // marks=event
      { f: 'f1', id: 'eastTrail', cells: [[6, 6], [6, 7], [7, 7], [7, 8]] },
      { f: 'f1', id: 'cache', cells: [[7, 4]] }, // marks=treasure
      { f: 'f1', id: 'southTrailWest', cells: [[7, 2], [7, 3]] },
      { f: 'f1', id: 'southTrailEast', cells: [[7, 5], [7, 6]] },
      { f: 'f1', id: 'exitPass', cells: [[8, 4], [8, 5], [8, 6]] },
      { f: 'f1', id: 'exit', cells: [[8, 7]] }, // exit
    ],
    links: [
      { f: 'f1', from: 'entry', to: 'northRidge', fromCell: [1, 3], toCell: [1, 4] },
      { f: 'f1', from: 'northRidge', to: 'westSlope', fromCell: [2, 4], toCell: [2, 3] },
      { f: 'f1', from: 'northRidge', to: 'northSpring', fromCell: [2, 5], toCell: [2, 6] },
      { f: 'f1', from: 'northSpring', to: 'eastCliff', fromCell: [2, 6], toCell: [3, 6] },
      { f: 'f1', from: 'westSlope', to: 'westQuarry', fromCell: [3, 1], toCell: [4, 1] },
      { f: 'f1', from: 'westSlope', to: 'centralField', fromCell: [3, 3], toCell: [4, 3], door: true, guards: ['chest'] },
      { f: 'f1', from: 'westQuarry', to: 'centralField', fromCell: [4, 2], toCell: [4, 3] },
      { f: 'f1', from: 'eastCliff', to: 'beastRange', fromCell: [3, 7], toCell: [4, 7] },
      { f: 'f1', from: 'beastRange', to: 'centralField', fromCell: [4, 7], toCell: [4, 6] },
      { f: 'f1', from: 'centralField', to: 'iceCrack', fromCell: [5, 4], toCell: [5, 3] },
      { f: 'f1', from: 'centralField', to: 'riteClearing', fromCell: [5, 4], toCell: [6, 4] },
      { f: 'f1', from: 'iceCrack', to: 'westVale', fromCell: [5, 3], toCell: [5, 2] },
      { f: 'f1', from: 'westVale', to: 'southTrailWest', fromCell: [6, 2], toCell: [7, 2] },
      { f: 'f1', from: 'riteClearing', to: 'eastTrail', fromCell: [6, 5], toCell: [6, 6] },
      { f: 'f1', from: 'southTrailWest', to: 'cache', fromCell: [7, 3], toCell: [7, 4] },
      { f: 'f1', from: 'cache', to: 'southTrailEast', fromCell: [7, 4], toCell: [7, 5] },
      { f: 'f1', from: 'southTrailEast', to: 'eastTrail', fromCell: [7, 6], toCell: [7, 7] },
      { f: 'f1', from: 'cache', to: 'exitPass', fromCell: [7, 4], toCell: [8, 4], door: true, guards: ['chest'] },
      { f: 'f1', from: 'eastTrail', to: 'exit', fromCell: [7, 7], toCell: [8, 7] },
      { f: 'f1', from: 'exitPass', to: 'exit', fromCell: [8, 6], toCell: [8, 7] },
    ],
    entrances: [['f1', 'entry']],
    exits: [['f1', 'exit']],
  },
  {
    local: 'salt-well-cellar',
    sourceName: '鹽井封窖',
    floors: [
      { key: 'f1', floor: 1, rows: 5, cols: 5 },
      { key: 'b1', floor: -1, rows: 5, cols: 5 },
    ],
    rooms: [
      { f: 'f1', id: 'entry', cells: [[1, 2]] }, // entry
      { f: 'f1', id: 'foreHall', cells: [[1, 3], [2, 2], [2, 3]] },
      { f: 'f1', id: 'westHold', cells: [[2, 1], [3, 1]] },
      { f: 'f1', id: 'surfaceVein', cells: [[2, 4]] }, // marks=resource
      { f: 'f1', id: 'collapsedDeck', cells: [[3, 2]] }, // marks=trap
      { f: 'f1', id: 'stairDown', cells: [[3, 3]] }, // stair↓
      { f: 'f1', id: 'eastGangway', cells: [[3, 4], [3, 5], [4, 5]] },
      { f: 'f1', id: 'holdChamber', cells: [[4, 3], [4, 4]] }, // marks=treasure
      { f: 'f1', id: 'westStep', cells: [[4, 2]] },
      { f: 'f1', id: 'southWalk', cells: [[5, 3], [5, 4]] },
      { f: 'f1', id: 'exit', cells: [[5, 5]] }, // exit
      { f: 'b1', id: 'upperCave', cells: [[1, 3], [2, 2], [2, 3], [2, 4]] },
      { f: 'b1', id: 'westDrift', cells: [[3, 1]] },
      { f: 'b1', id: 'deepVein', cells: [[3, 2]] }, // marks=resource
      { f: 'b1', id: 'stairUp', cells: [[3, 3]] }, // stair↑
      { f: 'b1', id: 'eastDrift', cells: [[3, 4], [3, 5]] },
      { f: 'b1', id: 'beastDen', cells: [[4, 1], [4, 2], [5, 2]] }, // marks=large
      { f: 'b1', id: 'sunkenCargo', cells: [[4, 3], [4, 4]] }, // marks=event
    ],
    links: [
      { f: 'f1', from: 'entry', to: 'foreHall', fromCell: [1, 2], toCell: [1, 3] },
      { f: 'f1', from: 'foreHall', to: 'westHold', fromCell: [2, 2], toCell: [2, 1] },
      { f: 'f1', from: 'foreHall', to: 'surfaceVein', fromCell: [2, 3], toCell: [2, 4] },
      { f: 'f1', from: 'westHold', to: 'collapsedDeck', fromCell: [3, 1], toCell: [3, 2] },
      { f: 'f1', from: 'collapsedDeck', to: 'stairDown', fromCell: [3, 2], toCell: [3, 3] },
      { f: 'f1', from: 'stairDown', to: 'eastGangway', fromCell: [3, 3], toCell: [3, 4] },
      { f: 'f1', from: 'eastGangway', to: 'holdChamber', fromCell: [4, 5], toCell: [4, 4], door: true, guards: ['chest'] },
      { f: 'f1', from: 'holdChamber', to: 'westStep', fromCell: [4, 3], toCell: [4, 2] },
      { f: 'f1', from: 'holdChamber', to: 'southWalk', fromCell: [4, 3], toCell: [5, 3] },
      { f: 'f1', from: 'southWalk', to: 'exit', fromCell: [5, 4], toCell: [5, 5] },
      { f: 'b1', from: 'upperCave', to: 'deepVein', fromCell: [2, 2], toCell: [3, 2] },
      { f: 'b1', from: 'upperCave', to: 'stairUp', fromCell: [2, 3], toCell: [3, 3] },
      { f: 'b1', from: 'upperCave', to: 'eastDrift', fromCell: [2, 4], toCell: [3, 4] },
      { f: 'b1', from: 'stairUp', to: 'eastDrift', fromCell: [3, 3], toCell: [3, 4] },
      { f: 'b1', from: 'deepVein', to: 'westDrift', fromCell: [3, 2], toCell: [3, 1] },
      { f: 'b1', from: 'westDrift', to: 'beastDen', fromCell: [3, 1], toCell: [4, 1] },
      { f: 'b1', from: 'beastDen', to: 'sunkenCargo', fromCell: [4, 2], toCell: [4, 3], door: true, guards: ['largeEnemy', 'event'] },
      { f: 'b1', from: 'eastDrift', to: 'sunkenCargo', fromCell: [3, 4], toCell: [4, 4] },
      { f: 'f1', from: 'stairDown', to: 'stairUp', toFloorKey: 'b1', fromCell: [3, 3], toCell: [3, 3] },
    ],
    entrances: [['f1', 'entry']],
    exits: [['f1', 'exit']],
  },
  {
    local: 'cinnabar-ridge',
    sourceName: '朱砂斷嶺',
    floors: [
      { key: 'f1', floor: 1, rows: 8, cols: 8 },
    ],
    rooms: [
      { f: 'f1', id: 'entry', cells: [[1, 3]] }, // entry
      { f: 'f1', id: 'northRidge', cells: [[1, 4], [1, 5], [2, 4], [2, 5]] },
      { f: 'f1', id: 'northSpring', cells: [[2, 6]] }, // marks=resource
      { f: 'f1', id: 'westSlope', cells: [[2, 2], [2, 3], [3, 1], [3, 2], [3, 3]] }, // marks=treasure
      { f: 'f1', id: 'westQuarry', cells: [[4, 1], [4, 2]] }, // marks=resource
      { f: 'f1', id: 'eastCliff', cells: [[3, 6], [3, 7], [3, 8]] },
      { f: 'f1', id: 'beastRange', cells: [[4, 7], [4, 8], [5, 8]] }, // marks=large
      { f: 'f1', id: 'centralField', cells: [[4, 3], [4, 4], [4, 5], [4, 6], [5, 4], [5, 5]] },
      { f: 'f1', id: 'iceCrack', cells: [[5, 3]] }, // marks=trap
      { f: 'f1', id: 'westVale', cells: [[5, 1], [5, 2], [6, 1], [6, 2]] },
      { f: 'f1', id: 'riteClearing', cells: [[6, 3], [6, 4], [6, 5]] }, // marks=event
      { f: 'f1', id: 'eastTrail', cells: [[6, 6], [6, 7], [7, 7], [7, 8]] },
      { f: 'f1', id: 'cache', cells: [[7, 4]] }, // marks=treasure
      { f: 'f1', id: 'southTrailWest', cells: [[7, 2], [7, 3]] },
      { f: 'f1', id: 'southTrailEast', cells: [[7, 5], [7, 6]] },
      { f: 'f1', id: 'exitPass', cells: [[8, 4], [8, 5], [8, 6]] },
      { f: 'f1', id: 'exit', cells: [[8, 7]] }, // exit
    ],
    links: [
      { f: 'f1', from: 'entry', to: 'northRidge', fromCell: [1, 3], toCell: [1, 4] },
      { f: 'f1', from: 'northRidge', to: 'westSlope', fromCell: [2, 4], toCell: [2, 3] },
      { f: 'f1', from: 'northRidge', to: 'northSpring', fromCell: [2, 5], toCell: [2, 6] },
      { f: 'f1', from: 'northSpring', to: 'eastCliff', fromCell: [2, 6], toCell: [3, 6] },
      { f: 'f1', from: 'westSlope', to: 'westQuarry', fromCell: [3, 1], toCell: [4, 1] },
      { f: 'f1', from: 'westSlope', to: 'centralField', fromCell: [3, 3], toCell: [4, 3], door: true, guards: ['chest'] },
      { f: 'f1', from: 'westQuarry', to: 'centralField', fromCell: [4, 2], toCell: [4, 3] },
      { f: 'f1', from: 'eastCliff', to: 'beastRange', fromCell: [3, 7], toCell: [4, 7] },
      { f: 'f1', from: 'beastRange', to: 'centralField', fromCell: [4, 7], toCell: [4, 6] },
      { f: 'f1', from: 'centralField', to: 'iceCrack', fromCell: [5, 4], toCell: [5, 3] },
      { f: 'f1', from: 'centralField', to: 'riteClearing', fromCell: [5, 4], toCell: [6, 4] },
      { f: 'f1', from: 'iceCrack', to: 'westVale', fromCell: [5, 3], toCell: [5, 2] },
      { f: 'f1', from: 'westVale', to: 'southTrailWest', fromCell: [6, 2], toCell: [7, 2] },
      { f: 'f1', from: 'riteClearing', to: 'eastTrail', fromCell: [6, 5], toCell: [6, 6] },
      { f: 'f1', from: 'southTrailWest', to: 'cache', fromCell: [7, 3], toCell: [7, 4] },
      { f: 'f1', from: 'cache', to: 'southTrailEast', fromCell: [7, 4], toCell: [7, 5] },
      { f: 'f1', from: 'southTrailEast', to: 'eastTrail', fromCell: [7, 6], toCell: [7, 7] },
      { f: 'f1', from: 'cache', to: 'exitPass', fromCell: [7, 4], toCell: [8, 4], door: true, guards: ['chest'] },
      { f: 'f1', from: 'eastTrail', to: 'exit', fromCell: [7, 7], toCell: [8, 7] },
      { f: 'f1', from: 'exitPass', to: 'exit', fromCell: [8, 6], toCell: [8, 7] },
    ],
    entrances: [['f1', 'entry']],
    exits: [['f1', 'exit']],
  },
  {
    local: 'old-kiln-flue',
    sourceName: '古窯火道',
    floors: [
      { key: 'f1', floor: 1, rows: 5, cols: 5 },
      { key: 'b1', floor: -1, rows: 5, cols: 5 },
    ],
    rooms: [
      { f: 'f1', id: 'entry', cells: [[1, 2]] }, // entry
      { f: 'f1', id: 'foreHall', cells: [[1, 3], [2, 2], [2, 3]] },
      { f: 'f1', id: 'westHold', cells: [[2, 1], [3, 1]] },
      { f: 'f1', id: 'surfaceVein', cells: [[2, 4]] }, // marks=resource
      { f: 'f1', id: 'collapsedDeck', cells: [[3, 2]] }, // marks=trap
      { f: 'f1', id: 'stairDown', cells: [[3, 3]] }, // stair↓
      { f: 'f1', id: 'eastGangway', cells: [[3, 4], [3, 5], [4, 5]] },
      { f: 'f1', id: 'holdChamber', cells: [[4, 3], [4, 4]] }, // marks=treasure
      { f: 'f1', id: 'westStep', cells: [[4, 2]] },
      { f: 'f1', id: 'southWalk', cells: [[5, 3], [5, 4]] },
      { f: 'f1', id: 'exit', cells: [[5, 5]] }, // exit
      { f: 'b1', id: 'upperCave', cells: [[1, 3], [2, 2], [2, 3], [2, 4]] },
      { f: 'b1', id: 'westDrift', cells: [[3, 1]] },
      { f: 'b1', id: 'deepVein', cells: [[3, 2]] }, // marks=resource
      { f: 'b1', id: 'stairUp', cells: [[3, 3]] }, // stair↑
      { f: 'b1', id: 'eastDrift', cells: [[3, 4], [3, 5]] },
      { f: 'b1', id: 'beastDen', cells: [[4, 1], [4, 2], [5, 2]] }, // marks=large
      { f: 'b1', id: 'sunkenCargo', cells: [[4, 3], [4, 4]] }, // marks=event
    ],
    links: [
      { f: 'f1', from: 'entry', to: 'foreHall', fromCell: [1, 2], toCell: [1, 3] },
      { f: 'f1', from: 'foreHall', to: 'westHold', fromCell: [2, 2], toCell: [2, 1] },
      { f: 'f1', from: 'foreHall', to: 'surfaceVein', fromCell: [2, 3], toCell: [2, 4] },
      { f: 'f1', from: 'westHold', to: 'collapsedDeck', fromCell: [3, 1], toCell: [3, 2] },
      { f: 'f1', from: 'collapsedDeck', to: 'stairDown', fromCell: [3, 2], toCell: [3, 3] },
      { f: 'f1', from: 'stairDown', to: 'eastGangway', fromCell: [3, 3], toCell: [3, 4] },
      { f: 'f1', from: 'eastGangway', to: 'holdChamber', fromCell: [4, 5], toCell: [4, 4], door: true, guards: ['chest'] },
      { f: 'f1', from: 'holdChamber', to: 'westStep', fromCell: [4, 3], toCell: [4, 2] },
      { f: 'f1', from: 'holdChamber', to: 'southWalk', fromCell: [4, 3], toCell: [5, 3] },
      { f: 'f1', from: 'southWalk', to: 'exit', fromCell: [5, 4], toCell: [5, 5] },
      { f: 'b1', from: 'upperCave', to: 'deepVein', fromCell: [2, 2], toCell: [3, 2] },
      { f: 'b1', from: 'upperCave', to: 'stairUp', fromCell: [2, 3], toCell: [3, 3] },
      { f: 'b1', from: 'upperCave', to: 'eastDrift', fromCell: [2, 4], toCell: [3, 4] },
      { f: 'b1', from: 'stairUp', to: 'eastDrift', fromCell: [3, 3], toCell: [3, 4] },
      { f: 'b1', from: 'deepVein', to: 'westDrift', fromCell: [3, 2], toCell: [3, 1] },
      { f: 'b1', from: 'westDrift', to: 'beastDen', fromCell: [3, 1], toCell: [4, 1] },
      { f: 'b1', from: 'beastDen', to: 'sunkenCargo', fromCell: [4, 2], toCell: [4, 3], door: true, guards: ['largeEnemy', 'event'] },
      { f: 'b1', from: 'eastDrift', to: 'sunkenCargo', fromCell: [3, 4], toCell: [4, 4] },
      { f: 'f1', from: 'stairDown', to: 'stairUp', toFloorKey: 'b1', fromCell: [3, 3], toCell: [3, 3] },
    ],
    entrances: [['f1', 'entry']],
    exits: [['f1', 'exit']],
  },
];

function roomId(floorKey: string, sourceRoomId: string): RoomId {
  return `${floorKey}.${sourceRoomId}` as RoomId;
}

function linkId(floorKey: string, from: string, to: string): RoomLinkId {
  return `${floorKey}.${from}~${to}` as RoomLinkId;
}

function floorNumber(row: TopologyRow, floorKey: string): number {
  const found = row.floors.find((f) => f.key === floorKey);
  if (found === undefined) {
    throw new Error(`maps.ts：地圖 "${row.local}" 沒有樓層 "${floorKey}"`);
  }
  return found.floor;
}

function gridCell(floor: number, cell: Cell): GridCell {
  return { floor, row: cell[0], col: cell[1] };
}

function mapTemplateId(local: MapLocal): MapTemplateId {
  return yunhua.id<MapTemplateId>('map-template', local);
}

function mapSpawnRuleId(local: MapLocal): MapSpawnRuleId {
  return yunhua.id<MapSpawnRuleId>('map-spawn-rule', local);
}

function mapTemplate(row: TopologyRow): Authored<MapTemplateDefinition> {
  const profile = PROFILES[row.local];
  const floors: readonly FloorDefinition[] = row.floors.map((f) => ({
    floor: f.floor,
    rows: f.rows,
    cols: f.cols,
  }));
  const rooms: readonly RoomDefinition[] = row.rooms.map((r) => {
    const floor = floorNumber(row, r.f);
    return {
      roomId: roomId(r.f, r.id),
      floor,
      cells: r.cells.map((c) => gridCell(floor, c)),
    };
  });
  const links: readonly RoomLinkDefinition[] = row.links.map((l) => {
    const toFloorKey = l.toFloorKey === undefined ? l.f : l.toFloorKey;
    const fromFloor = floorNumber(row, l.f);
    const toFloor = floorNumber(row, toFloorKey);
    return {
      linkId: linkId(l.f, l.from, l.to),
      fromRoomId: roomId(l.f, l.from),
      toRoomId: roomId(toFloorKey, l.to),
      fromCell: gridCell(fromFloor, l.fromCell),
      toCell: gridCell(toFloor, l.toCell),
      kind: l.door === true ? 'redDoor' : 'passage',
      ...(l.guards === undefined ? {} : { guardedPreferenceKinds: l.guards }),
    };
  });
  return {
    kind: 'map-template',
    id: mapTemplateId(row.local),
    templateKind: profile.templateKind,
    ...(profile.nationalDungeonForm === undefined
      ? {}
      : { nationalDungeonForm: profile.nationalDungeonForm }),
    refreshOffsetDays: profile.refreshOffsetDays,
    refreshCadenceDays: 14,
    floors,
    rooms,
    links,
    fixedTraps: [],
    gatheringNodes: [],
    entranceRoomIds: row.entrances.map(([f, id]) => roomId(f, id)),
    exitRoomIds: row.exits.map(([f, id]) => roomId(f, id)),
    spawnRuleId: mapSpawnRuleId(row.local),
    explorationExperienceRuleId: explorationExperienceRuleId(profile.tier),
  };
}

const YUNHUA_NONHUMAN_CONTENT_RULE = yunhua.id<CultureContentRuleId>(
  'culture-content-rule',
  'nonhuman',
);
const YUNHUA_HUMAN_CONTENT_RULE = yunhua.id<CultureContentRuleId>('culture-content-rule', 'human');

function cultureContentRule(
  local: 'nonhuman' | 'human',
  speciesKind: MonsterSpeciesKind,
  candidates: readonly YunhuaContentCandidate[],
): Authored<CultureContentRuleDefinition> {
  return {
    kind: 'culture-content-rule',
    id: yunhua.id<CultureContentRuleId>('culture-content-rule', local),
    cultureId: yunhua.cultureId,
    speciesKind,
    candidates: candidates.map((c) => ({
      encounterGroupId: c.encounterGroupId,
      tier: c.tier,
      threatRank: c.threatRank,
    })),
  };
}

const CULTURE_CONTENT_RULES: readonly Authored<CultureContentRuleDefinition>[] = [
  cultureContentRule('nonhuman', 'nonHuman', YUNHUA_NON_HUMAN_CANDIDATES),
  cultureContentRule('human', 'human', YUNHUA_HUMAN_CANDIDATES),
];

function mapSpawnRule(row: TopologyRow): Authored<MapSpawnRuleDefinition> {
  const profile = PROFILES[row.local];
  return {
    kind: 'map-spawn-rule',
    id: mapSpawnRuleId(row.local),
    contentTier: profile.tier,
    localCultureContentRuleId: YUNHUA_NONHUMAN_CONTENT_RULE,
    humanCultureContentRuleId: YUNHUA_HUMAN_CONTENT_RULE,
    chestPoolId: yunhua.id<ChestPoolId>('chest-pool', row.local),
    mapEventPoolId: yunhua.id<MapEventPoolId>('map-event-pool', row.local),
    spawnBudgets: profile.spawnBudgets,
    npcSequenceRuleId: NPC_SEQUENCE_RULE_ID,
  };
}

type ContentRow = Readonly<{
  local: string;
  contentKind: MapContentKind;
  pointCost: number;
  targetResolver: keyof typeof NPC_DUNGEON_TARGET_RESOLVER_IDS;
  threatRank?: MonsterThreatRank;
}>;

const CONTENT_ROWS: readonly ContentRow[] = [
  {
    local: 'monster-group-common',
    contentKind: 'monsterGroup',
    threatRank: 'normal',
    pointCost: 1,
    targetResolver: 'combat-target',
  },
  {
    local: 'monster-group-elite',
    contentKind: 'monsterGroup',
    threatRank: 'elite',
    pointCost: 2,
    targetResolver: 'combat-target',
  },
  { local: 'boss', contentKind: 'boss', threatRank: 'boss', pointCost: 4, targetResolver: 'combat-target' },
  { local: 'chest', contentKind: 'chest', pointCost: 1, targetResolver: 'chest' },
  { local: 'map-event', contentKind: 'mapEvent', pointCost: 1, targetResolver: 'map-event' },
];

function mapContent(row: ContentRow): Authored<MapContentDefinition> {
  const npcPolicy: MapContentNpcPolicy = {
    eligible: true,
    pointCost: row.pointCost,
    resolverId: NPC_DUNGEON_TARGET_RESOLVER_IDS[row.targetResolver],
  };
  return {
    kind: 'map-content',
    id: yunhua.id<DefinitionId>('map-content', row.local),
    contentKind: row.contentKind,
    ...(row.threatRank === undefined ? {} : { threatRank: row.threatRank }),
    npcPolicy,
  };
}


export const yunhuaMapsDomain: AuthoredDomain = {
  domain: 'maps',
  definitions: [
    ...TOPOLOGY.map(mapTemplate),
    ...TOPOLOGY.map(mapSpawnRule),
    ...CONTENT_ROWS.map(mapContent),
    { kind: 'map-content', id: yunhua.id<DefinitionId>('map-content', 'guarded-captive'), contentKind: 'kidnap', npcPolicy: { eligible: false }, rescue: { captiveArchetypeId: 'character-archetype.core.rescue-captive' as CharacterArchetypeId, guardCount: 1 } } satisfies Authored<MapContentDefinition>,
    ...CULTURE_CONTENT_RULES,
  ],
};

export const YUNHUA_MAPS_DECLARED_KINDS: readonly string[] = [
  'map-template',
  'map-spawn-rule',
  'map-content',
  'culture-content-rule',
];


export const YUNHUA_MAP_TEMPLATE_IDS: Readonly<Record<MapLocal, MapTemplateId>> = {
  'old-canal-sunken-store': mapTemplateId('old-canal-sunken-store'),
  'calendar-court-ruin': mapTemplateId('calendar-court-ruin'),
  'seal-tower': mapTemplateId('seal-tower'),
  'mist-bamboo-valley': mapTemplateId('mist-bamboo-valley'),
  'hanging-spring-grotto': mapTemplateId('hanging-spring-grotto'),
  'tidal-reed-isle': mapTemplateId('tidal-reed-isle'),
  'salt-well-cellar': mapTemplateId('salt-well-cellar'),
  'cinnabar-ridge': mapTemplateId('cinnabar-ridge'),
  'old-kiln-flue': mapTemplateId('old-kiln-flue'),
};
