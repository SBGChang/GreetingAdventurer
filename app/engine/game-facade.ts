// app/engine/game-facade.ts
// UI 與引擎之間的窄門面。UI 只認這裡的東西：開新遊戲、下指令、把 GameState + Definition 投影成
// 畫面用的 ViewModel、以及依語系解析文字。引擎的型別細節不外洩到 React 元件。
//
// 這一層跑在 renderer（瀏覽器），所以只用**純函式**引擎面（loadBundledContent / createNewGame /
// runGameCommand / createProductionContextAssembler）——不碰 node:fs。
//
// ── 顯示文字的規矩（15_ui_application.md §10）──────────────────────────────
//
// ViewModel 一律帶 `LocalizedTextRef`，**不帶已翻譯字串**。翻譯發生在 React 元件呼叫
// `resolveText()` 的那一刻。這樣同一份 ViewModel 在切換語系時不需要重新投影，也保證了
// 「核心 State 不保存已翻譯文字」。

import type { DefinitionRegistry, LocalizationCatalog, ResolverRegistry } from '../../src/data-runtime';
import { makeProgressionQuery } from '../../src/modules/progression/public';
import { createProgressionDefinitionReader } from '../../src/app/content/progression-reader';
import { createProductionContextAssembler } from '../../src/app/content/context-assembler';
import { createProductionResolverRegistry } from '../../src/app/content/resolver-registrations';
import { createNewGame, type NewGameConfig } from '../../src/app/composition/new-game-bootstrap';
import { createTeamQuery } from '../../src/modules/team/public';
import { makeCombatQuery } from '../../src/modules/combat/public';
import { createCombatDefinitionReader } from '../../src/app/content/combat-reader';
import { createStatisticsDefinitionReader } from '../../src/app/content/statistics-reader';
import { createStatisticsResolverPort } from '../../src/app/content/statistics-resolver-bridge';
import {
  createCharacterStatsQuery,
  createCombatLoadoutQuery,
} from '../../src/app/content/cross-module-ports';
import type { EquipmentDefinition } from '../../src/contracts/inventory';
import type { DefinitionId, StatisticsRuleId } from '../../src/contracts/core';
import { MAX_FORMAL_MEMBERS } from '../../src/contracts/core';

// 世界曆一年的日數。沒有月份、沒有閏年（GDD「在家休息一年 365 日」；同一個數字在
// content-source/core/character.ts 把年齡寫成日）。這裡只用來把日數顯示成歲數。
const DAYS_PER_YEAR = 365;
import {
  runGameCommand,
  settleCombat,
  settleWorld,
  type ContextAssembler,
  type SettleStep,
} from '../../src/app/composition/session';
import type { GameState } from '../../src/app/composition/state';
import type { GameCommand } from '../../src/app/composition/messages';
import type { GameCommandRequest, LocalizedTextRef } from '../../src/contracts/core';
import type { CityNodeDefinition, AdventureSiteDefinition, RouteDefinition } from '../../src/contracts/world';
import type {
  CityDefinition,
  FacilityDefinition,
  FacilityKind,
  HomeRuleDefinition,
  HomeUpgradeDefinition,
} from '../../src/contracts/city';
import type { FreeActionRuleDefinition, PlayerTravelModeDefinition } from '../../src/contracts/team';
import type {
  CombatSkillDefinitionView,
  EncounterGroupDefinition,
  MonsterDefinition,
} from '../../src/contracts/combat';
import type { MasteryDefinition } from '../../src/contracts/progression';
import type { MapTemplateDefinition } from '../../src/contracts/map';
import type { ItemDefinitionReader } from '../../src/contracts/inventory';
import { createProductionEconomyQuery } from '../../src/app/content/city-context';
import { createItemDefinitionReader } from '../../src/app/content/inventory-reader';
import { UI_LOCALES, type UiLocale, type UiTextKey } from '../i18n';
import { loadBundledContent } from './content-browser';

// ──────────────────────────────────────────────────────────────────────────
// 已接線能力表
// ──────────────────────────────────────────────────────────────────────────
//
// UI 唯一的「這個按鈕能不能按」判準。**不是猜的**：每一筆都對應
// `src/app/content/context-assembler.ts` 裡真的組得出 context 的模組；標成 false 的，
// 其 context 目前是 `pending()`（一被存取就拋，指名是誰）。
//
// 為什麼要有這張表而不是讓玩家按下去踩錯誤：規範 §10「沒閉合的 Capability 不要等玩家按下去
// 才拋『尚未實作』」。這裡的作法是**顯示設施但不提供操作**，並明說原因——城市裡確實有酒館
// （那是內容事實），只是它的模組還沒接線（那是實作事實）。兩件事分開陳述，不互相偽裝。
//
// 這張表只能往 true 的方向改，而且改的同時必須有對應的 context 接線。
// `blockedBy` 是 UI 文字 key 而非字串：這行字會顯示給玩家看，所以它跟其他介面文字一樣要翻譯。
export type WiredCapability = Readonly<{ wired: boolean; blockedBy?: UiTextKey }>;

export const CAPABILITIES = {
  // team context 已接：rest / startCityTravel 走 plan 規則，不觸及 world / combat 子 port。
  rest: { wired: true },
  startCityTravel: { wired: true },
  // team.world 子 port 是 pending()：enterAdventureMap 要 getAdventureSiteMapInstance，
  // 而正式實作不存在（全 repo 只有 fixtures 有），且 bootstrap 不建 map instance。
  // 已接：Bootstrap 建出 MapInstance、team.world 解析得到它、DungeonMapPort 供給地形。
  enterAdventureMap: { wired: true },
  startPlayerExploration: { wired: true },
  moveDungeonRoom: { wired: true },
  openDungeonDoor: { wired: true },
  useDungeonExit: { wired: true },
  // city context 是 pending()，且 city slice 開局沒有任何商品。
  // 已接：city context ＋ 經濟報價鏈（價格來源／交易加成／修正 resolver）＋ 開局上架。
  buyShopOffer: { wired: true },
  // 已接：MapContentGenerated → QuestReactionRule → 貼在公會的委託實例（開局即有）。
  acceptQuest: { wired: true },
  // 已接：文化池（§7.2／§7.3）＋ Tier／威脅篩選 ＋ 一房一內容，開局即依 §7.4 的槽位預算生成。
  mapContentSpawn: { wired: true },
  // 已接：開局生成世界冒險者（character 生成 Resolver）＋ tavernVisit 自由行動 ＋ 招募擲骰曲線。
  recruitTavernAdventurer: { wired: true },
  // 已接：chooseCityFreeAction ＋ freeActionDue Job ＋ progression 的 28 日訓練訂閱。
  chooseCityFreeAction: { wired: true },
  // 已接：PriceRule 直接報價（`baseValueSource: 'ruleFixedAmount'`）＋ 雲華三種坪數的房價。
  buyOrUpgradeHome: { wired: true },
} as const satisfies Readonly<Record<string, WiredCapability>>;

// 設施 → 它在主城畫面上提供什麼操作。`none` 代表這個設施本版沒有對應操作。
export type FacilityAction =
  | 'rest'
  | 'leaveCity'
  | 'goAdventure'
  | 'shop'
  | 'home'
  | 'train'
  | 'tavern'
  | 'guild'
  | 'none';

const FACILITY_ACTION: Readonly<Record<FacilityKind, FacilityAction>> = {
  inn: 'rest',
  cityGate: 'leaveCity',
  adventureCheckpoint: 'goAdventure',
  tavern: 'tavern',
  adventurerGuild: 'guild',
  itemShop: 'shop',
  equipmentShop: 'shop',
  trainingGround: 'train',
  bookstore: 'shop',
  home: 'home',
};

// 每個 `none` 設施被什麼擋住（顯示給玩家看，避免「為什麼這個不能按」變成謎）。
// 十種設施現在全部都有對應操作，所以這張「被什麼擋住」的表是空的。
// 保留它（而不是刪掉）是因為它是**誠實表**：日後新增設施而還沒接線時，這裡就是說明的落點。
const FACILITY_BLOCKED_BY: Readonly<Partial<Record<FacilityKind, UiTextKey>>> = {};

// ──────────────────────────────────────────────────────────────────────────
// ViewModel
// ──────────────────────────────────────────────────────────────────────────

export type FacilityView = Readonly<{
  facilityId: string;
  kind: FacilityKind;
  nameRef: LocalizedTextRef;
  action: FacilityAction;
  blockedBy: UiTextKey | undefined;
}>;

export type NeighbourView = Readonly<{
  routeId: string;
  toCityId: string;
  nameRef: LocalizedTextRef;
  isCapital: boolean;
}>;

export type SiteView = Readonly<{
  siteId: string;
  nameRef: LocalizedTextRef;
  isNationalDungeon: boolean;
}>;

// 地牢畫面。房間名直接用 template-local 的 roomId：它們是**模板內的區域識別碼**
// （`RoomDefinition.roomId`），不是 Definition，所以沒有 nameRef 可掛。雲華的作者把它們
// 寫成中文（`f1.水道入口`），所以讀得懂；但切到英文時不會翻譯——這是已知的本地化缺口，
// 補它要在 RoomDefinition 上加 display 並為九張圖的每個房間授權名稱。
export type RoomExitView = Readonly<{
  roomId: string;
  linkId: string;
  kind: 'passage' | 'redDoor';
  state: 'open' | 'closed';
  revealed: boolean;
}>;

// 房間裡的一筆動態內容（怪群／Boss／寶箱／事件）。名稱走 encounter group 的 id：它是
// template-local 之外的內容 ID，目前沒有 nameRef（怪物顯示名屬 L1 文字欠債，見 cleanup-backlog）。
export type RoomContentView = Readonly<{
  contentId: string;
  kind: string;
  // 怪群／Boss 的名字＝編組第一名成員的怪物名。寶箱與事件沒有對應的怪物，所以是 undefined，
  // 由 UI 只顯示種類（不編一個名字出來）。
  nameRef: LocalizedTextRef | undefined;
  available: boolean;
}>;

// 一間店的貨架。價格是**當下報價**（走完整條報價鏈），不是物品原價。
export type ShopOfferView = Readonly<{
  offerId: string;
  itemDefinitionId: string;
  nameRef: LocalizedTextRef;
  price: number;
  affordable: boolean;
}>;

export type ShopView = Readonly<{
  facilityId: string;
  nameRef: LocalizedTextRef;
  offers: readonly ShopOfferView[];
  balance: number;
}>;

// 家園。買房是**資產**取得，不是買一件商品：價格住在 Price Rule 自己身上
// （`baseValueSource: 'ruleFixedAmount'`），一種坪數一條規則，所以「越大越貴」是內容的宣告。
export type HomeOptionView = Readonly<{
  slotCount: number;
  price: number;
  affordable: boolean;
}>;

export type OwnedHomeView = Readonly<{
  homeId: string;
  slotCapacity: number;
  usedSlots: number;
  installedUpgradeIds: readonly string[];
}>;

export type HomeView = Readonly<{
  facilityId: string;
  nameRef: LocalizedTextRef;
  balance: number;
  // 已在本城擁有的房子（GDD §八：一座城市限一間）。
  owned: OwnedHomeView | undefined;
  // 尚未擁有時可購買的坪數；已擁有時為空陣列（不是「還沒接線」）。
  options: readonly HomeOptionView[];
}>;

// 28 日鍛鍊。一個設施一筆，選項來自**規則自己列出**的 trainableMasteryIds
// （見 contracts/team），所以換一份 Content Pack 就換一組可練項目，這裡不必改。
export type TrainingOptionView = Readonly<{
  masteryId: string;
  nameRef: LocalizedTextRef;
  level: number;
  experience: number;
}>;

export type TrainingView = Readonly<{
  facilityId: string;
  nameRef: LocalizedTextRef;
  ruleId: string;
  requiredDays: number;
  options: readonly TrainingOptionView[];
}>;

// 酒館名單。「誰在酒館」的唯一真相是 team：正式成員、位於本城、且持有進行中的 `tavernVisit`
// 自由行動（team/state.ts 的 `listTavernVisitorsInCity`）。這裡只投影，不另存可見性旗標。
export type TavernVisitorView = Readonly<{
  characterId: string;
  label: string;
  sex: string;
  ageYears: number;
}>;

export type TavernView = Readonly<{
  facilityId: string;
  nameRef: LocalizedTextRef;
  visitors: readonly TavernVisitorView[];
  // 玩家隊已滿時招募一定失敗，先讓畫面說出來（Handler 仍會擋，這只是不給註定被拒的按鈕）。
  teamIsFull: boolean;
}>;

// 公會委託板。「可接」＝尚未被接取、且還在接取期限內（`QuestStatus` 沒有 'open' 這個值，
// 開放與否是這兩個條件合起來說的）。
export type QuestOfferView = Readonly<{
  questId: string;
  kind: string;
  acceptDeadline: number;
  actualEndDeadline: number;
  // 目標所在地：肅清／狩獵／救援是冒險據點，採買是這座城，送貨是目的城。
  siteNameRef: LocalizedTextRef | undefined;
  // 目標本身：肅清／狩獵是怪物名，採買／送貨是物品名。沒有這一欄時，板上十筆「肅清」
  // 長得一模一樣——玩家沒有任何依據挑選，那不是隨機性，是資訊沒有畫出來。
  targetNameRef: LocalizedTextRef | undefined;
  // 目標房間（肅清／狩獵／救援才有）。同一張圖的不同怪群靠它區分。
  roomId: string | undefined;
  targetCount: number;
}>;

export type GuildView = Readonly<{
  facilityId: string;
  nameRef: LocalizedTextRef;
  offers: readonly QuestOfferView[];
  // 已接取、進行中的委託（同一塊板子上看得到自己接了什麼）。
  accepted: readonly QuestOfferView[];
}>;

// ── 地牢小地圖 ───────────────────────────────────────────────────────────────
//
// 一層樓的平面圖。房間佔的格子來自 Template（`RoomDefinition.cells`），玩家看得見哪些房間
// 來自 dungeon 的 `PlayerMapKnowledge`。兩個真相各自回答自己的部分，這一層只組合。
//
// 「未探索」不畫成空白：畫成一格灰底，讓玩家看得出「那邊還有地方」，但不透露裡面有什麼——
// 這與 `revealedRoomIds` 的語意一致（知道有路，不知道內容）。
export type MapCellView = Readonly<{
  row: number;
  col: number;
  roomId: string;
  revealed: boolean;
  isCurrent: boolean;
  isExit: boolean;
  // 這一格所屬房間裡還有幾筆未處理的內容（只在已探索的房間有意義）。
  contentCount: number;
}>;

export type MapFloorView = Readonly<{
  floor: number;
  rows: number;
  cols: number;
  cells: readonly MapCellView[];
}>;

// 四方向移動。`direction` 由兩個房間的**格座標**決定，不是靠連線順序猜的。
export type MoveOptionView = Readonly<{
  direction: 'north' | 'south' | 'west' | 'east';
  roomId: string;
  linkId: string;
  kind: string;
  open: boolean;
  revealed: boolean;
}>;

// ── 戰鬥 ─────────────────────────────────────────────────────────────────────

export type CombatantView2 = Readonly<{
  combatantId: string;
  side: 'player' | 'enemy';
  nameRef: LocalizedTextRef | undefined;
  // 角色沒有授權顯示名（L1 文字欠債），所以玩家側用執行期 ID 末段；怪物側有 nameRef。
  fallbackLabel: string;
  row: number;
  col: number;
  health: number;
  maxHealth: number;
  mana: number;
  maxMana: number;
  ctb: number;
  state: string;
  isCurrentActor: boolean;
}>;

export type CombatActionView = Readonly<{
  skillId: string;
  nameRef: LocalizedTextRef | undefined;
  actionKind: string;
  available: boolean;
}>;

export type CombatView = Readonly<{
  encounterId: string;
  state: string;
  // 目前輪到誰。`undefined` ＝ 這場已經結束。
  currentActorId: string | undefined;
  // 目前行動者是玩家側時才有可選行動；敵方回合由引擎自己推進（settleCombat）。
  actions: readonly CombatActionView[];
  combatants: readonly CombatantView2[];
  // 出手順序（CTB 升冪）。玩家看得到「下一個是誰」。
  order: readonly string[];
}>;

// ── 人物 ─────────────────────────────────────────────────────────────────────

export type EquippedSlotView = Readonly<{
  slotId: string;
  itemId: string | undefined;
  nameRef: LocalizedTextRef | undefined;
}>;

export type WeaponSetView = Readonly<{
  weaponSetId: string;
  index: number;
  isActive: boolean;
  mainHand: EquippedSlotView;
  offHand: EquippedSlotView;
  // 三個招式欄位。`undefined` ＝ 這一格沒配招（不是「沒有招式可配」）。
  skills: readonly (CombatActionView | undefined)[];
}>;

export type MasteryLevelView = Readonly<{
  masteryId: string;
  nameRef: LocalizedTextRef;
  level: number;
  experience: number;
}>;

export type CharacterSheetView = Readonly<{
  characterId: string;
  archetypeNameRef: LocalizedTextRef | undefined;
  sex: string;
  ageYears: number;
  health: number;
  maxHealth: number;
  mana: number;
  maxMana: number;
  // 主屬性。它們是**熟練度的推導值**（GDD），不是可獨立配點的數字——UI 因此只顯示、不編輯。
  primary: Readonly<Record<string, number>>;
  armorSlots: readonly EquippedSlotView[];
  weaponSets: readonly WeaponSetView[];
  // 背包裡可以裝備的東西（依可裝的格位分組由 UI 決定）。
  equipable: readonly Readonly<{
    itemId: string;
    nameRef: LocalizedTextRef;
    equipmentKind: string;
    slotIds: readonly string[];
  }>[];
  // 已練過的熟練度（等級或經驗大於 0）。全 0 的不列，避免 34 行全是 Lv.0。
  masteries: readonly MasteryLevelView[];
  // 可以配進武器組的招式：角色**已學會**（知識那一筆在 learnedKnowledgeIds 裡）且有對應的
  // 戰鬥招式定義。配得進去不代表用得出來——啟動手是否有裝備由 configureWeaponSet 那條
  // Workflow 驗（見 weapon-set-configuration.ts），這裡不預先過濾，否則會有兩份規則。
  assignableSkills: readonly CombatActionView[];
}>;

export type DungeonView = Readonly<{
  mapId: string;
  siteNameRef: LocalizedTextRef;
  currentRoomId: string;
  isExitRoom: boolean;
  elapsedMinutes: number;
  revealedRoomCount: number;
  totalRoomCount: number;
  exits: readonly RoomExitView[];
  // 目前房間裡的內容（空陣列＝這一房沒有東西，不是「還沒接線」）。
  roomContents: readonly RoomContentView[];
  // 這張圖本版本還剩幾筆未處理的內容。
  remainingContentCount: number;
  // 目前所在樓層的平面圖。
  floor: MapFloorView;
  // 四方向可走的鄰接房間（由格座標判方位，不是由連線順序）。
  moves: readonly MoveOptionView[];
}>;

export type TravelModeView = Readonly<{
  modeId: string;
  nameRef: LocalizedTextRef;
  durationDays: number;
}>;

export type LeaderView = Readonly<{
  id: string;
  archetypeId: string;
  sex: string;
  health: number;
  mana: number;
}>;

// 隊伍位置：城市 / 旅行中 / 冒險地。UI 依此決定顯示哪一個畫面。
export type LocationView =
  | Readonly<{ kind: 'city'; cityId: string; nameRef: LocalizedTextRef }>
  | Readonly<{ kind: 'travelling'; routeId: string; segmentIndex: number }>
  | Readonly<{ kind: 'adventureMap'; mapId: string; siteNameRef: LocalizedTextRef }>
  | Readonly<{ kind: 'home'; homeId: string }>;

export type GameView = Readonly<{
  worldDay: number;
  // 隊伍目前的大動作種類（undefined＝沒有進行中的 Plan）。UI 用它決定要不要先開自由活動期：
  // 個人自由行動（鍛鍊）只在 `cityFree` 期間才收得下（doc §3.5 不變量 1）。
  activePlanKind: string | undefined;
  location: LocationView;
  leader: LeaderView | undefined;
  memberCount: number;
  scheduledJobs: number;
  // 只有位於城市時才有主城畫面資料。
  city:
    | Readonly<{
        isCapital: boolean;
        facilities: readonly FacilityView[];
        neighbours: readonly NeighbourView[];
        sites: readonly SiteView[];
        travelModes: readonly TravelModeView[];
        shops: readonly ShopView[];
        home: HomeView | undefined;
        trainings: readonly TrainingView[];
        tavern: TavernView | undefined;
        guild: GuildView | undefined;
      }>
    | undefined;
  // 只有隊伍在冒險地圖且已開始探索時才有。
  dungeon: DungeonView | undefined;
  // 只有進行中的遭遇才有。有值時 UI 一律顯示戰鬥畫面（戰鬥期間不能做別的事）。
  combat: CombatView | undefined;
  // 隊長的人物頁。隨時可看，所以不綁在任何位置上。
  sheet: CharacterSheetView | undefined;
}>;

// ──────────────────────────────────────────────────────────────────────────
// Definition 讀取小工具
// ──────────────────────────────────────────────────────────────────────────
//
// Registry 以 `{ id, kind, …, data }` 包裝；領域欄位在 `data` 底下。
// 讀不到就拋——UI 拿到一個「城市不存在」的畫面沒有任何意義，那是內容壞掉（§出口 2 已在載入期
// 擋過一次，能走到這裡代表引用本身有問題）。
function requireData<T>(registry: DefinitionRegistry, id: string, what: string): T {
  const def = registry.get(id as never);
  if (def === undefined) throw new Error(`game-facade：找不到${what} "${id}"`);
  return def.data as unknown as T;
}

function projectCity(
  registry: DefinitionRegistry,
  cityId: string,
  shops: readonly ShopView[],
  home: HomeView | undefined,
  trainings: readonly TrainingView[],
  tavern: TavernView | undefined,
  guild: GuildView | undefined,
): GameView['city'] {
  const node = requireData<CityNodeDefinition>(registry, cityId, '城市節點');

  const cityDef = registry
    .list({ kinds: ['city'] })
    .map((d) => d.data as unknown as CityDefinition)
    .find((c) => String(c.worldCityId) === cityId);
  if (cityDef === undefined) throw new Error(`game-facade：城市節點 "${cityId}" 沒有對應的 city 定義`);

  const facilities: FacilityView[] = cityDef.facilityIds.map((fid) => {
    const facility = requireData<FacilityDefinition>(registry, String(fid), '設施');
    const action = FACILITY_ACTION[facility.facilityKind];
    return {
      facilityId: String(fid),
      kind: facility.facilityKind,
      nameRef: facility.display.nameRef,
      action,
      blockedBy: action === 'none' ? FACILITY_BLOCKED_BY[facility.facilityKind] : undefined,
    };
  });

  const neighbours: NeighbourView[] = node.adjacentRouteIds.map((rid) => {
    const route = requireData<RouteDefinition>(registry, String(rid), '路線');
    const toCityId = String(route.fromCityId) === cityId ? String(route.toCityId) : String(route.fromCityId);
    const other = requireData<CityNodeDefinition>(registry, toCityId, '鄰近城市');
    return { routeId: String(rid), toCityId, nameRef: other.display.nameRef, isCapital: other.isCapital };
  });

  const sites: SiteView[] = node.adventureSiteIds.map((sid) => {
    const site = requireData<AdventureSiteDefinition>(registry, String(sid), '冒險據點');
    return { siteId: String(sid), nameRef: site.display.nameRef, isNationalDungeon: site.isNationalDungeon };
  });

  const travelModes: TravelModeView[] = registry
    .list({ kinds: ['player-travel-mode'] })
    .map((d) => ({ id: String(d.id), data: d.data as unknown as PlayerTravelModeDefinition }))
    .map((m) => ({
      modeId: m.id,
      nameRef: m.data.display.nameRef,
      durationDays: m.data.durationDays,
    }))
    .sort((a, b) => a.durationDays - b.durationDays);

  return { isCapital: node.isCapital, facilities, neighbours, sites, travelModes, shops, home, trainings, tavern, guild };
}

function projectGuild(
  state: GameState,
  registry: DefinitionRegistry,
  cityId: string,
): GuildView | undefined {
  const cityDef = registry
    .list({ kinds: ['city'] })
    .map((d) => d.data as unknown as CityDefinition)
    .find((c) => String(c.worldCityId) === cityId);
  if (cityDef === undefined) return undefined;
  const facilityId = cityDef.facilityIds.find(
    (fid) =>
      requireData<FacilityDefinition>(registry, String(fid), '設施').facilityKind ===
      'adventurerGuild',
  );
  if (facilityId === undefined) return undefined;

  const teamId = state.team.playerTeamId;
  const toView = (quest: (typeof state.quest.quests)[keyof typeof state.quest.quests]): QuestOfferView => {
    // 目標所在的據點名：委託的 objective 綁的是地圖實例，實例綁的是據點。
    const mapId =
      quest.objective.kind === 'suppression' ||
      quest.objective.kind === 'hunt' ||
      quest.objective.kind === 'rescue'
        ? quest.objective.mapId
        : undefined;
    const instance = mapId === undefined ? undefined : state.map.instances[mapId];
    const site =
      instance === undefined
        ? undefined
        : requireData<AdventureSiteDefinition>(
            registry,
            String(instance.adventureSiteId),
            '冒險據點',
          );
    const targets =
      quest.objective.kind === 'suppression'
        ? quest.objective.targetContentIds.length
        : quest.objective.kind === 'hunt'
          ? quest.objective.bossContentIds.length
          : 1;

    // 目標內容（怪群／Boss／被擄者）：取第一筆，由它反查怪物名與所在房間。
    const contentId =
      quest.objective.kind === 'suppression'
        ? quest.objective.targetContentIds[0]
        : quest.objective.kind === 'hunt'
          ? quest.objective.bossContentIds[0]
          : quest.objective.kind === 'rescue'
            ? quest.objective.contentId
            : undefined;
    const content = contentId === undefined ? undefined : state.map.contents[contentId];

    // 採買／送貨的目標是一件貨。送貨還要說「送去哪」——那是目的城，不是據點。
    const itemId =
      quest.objective.kind === 'purchase' || quest.objective.kind === 'delivery'
        ? quest.objective.itemId
        : undefined;
    const item = itemId === undefined ? undefined : state.inventory.items[itemId];
    const destination =
      quest.objective.kind === 'delivery'
        ? requireData<CityNodeDefinition>(
            registry,
            String(quest.objective.destinationCityId),
            '目的城市',
          ).display.nameRef
        : undefined;

    return {
      questId: String(quest.questId),
      kind: quest.kind,
      acceptDeadline: Number(quest.acceptDeadline),
      actualEndDeadline: Number(quest.actualEndDeadline),
      siteNameRef: destination ?? site?.display.nameRef,
      targetNameRef:
        content !== undefined
          ? monsterNameRefOf(registry, content)
          : item !== undefined
            ? createItemDefinitionReader(registry).getItem(item.definitionId).display.nameRef
            : undefined,
      roomId: content === undefined ? undefined : String(content.position.roomId),
      targetCount: targets,
    };
  };

  const here = Object.values(state.quest.quests).filter(
    (q) => String(q.postingGuildCityId) === cityId,
  );
  return {
    facilityId: String(facilityId),
    nameRef: requireData<FacilityDefinition>(registry, String(facilityId), '設施').display.nameRef,
    offers: here
      .filter((q) => q.status === 'unaccepted' && Number(q.acceptDeadline) >= state.core.worldDay)
      .map(toView),
    accepted: here.filter((q) => q.status === 'incomplete' && q.acceptedByTeamId === teamId).map(toView),
  };
}

function projectTavern(
  state: GameState,
  registry: DefinitionRegistry,
  cityId: string,
): TavernView | undefined {
  const cityDef = registry
    .list({ kinds: ['city'] })
    .map((d) => d.data as unknown as CityDefinition)
    .find((c) => String(c.worldCityId) === cityId);
  if (cityDef === undefined) return undefined;
  const facilityId = cityDef.facilityIds.find(
    (fid) => requireData<FacilityDefinition>(registry, String(fid), '設施').facilityKind === 'tavern',
  );
  if (facilityId === undefined) return undefined;

  const team = state.team.teams[state.team.playerTeamId];
  const visitors: TavernVisitorView[] = createTeamQuery(state.team)
    .listTavernVisitorIds(cityId as never)
    .map((id): TavernVisitorView | undefined => {
      const character = state.character.characters[id];
      if (character === undefined) return undefined;
      return {
        characterId: String(id),
        // 角色顯示名尚未授權（L1 文字欠債）：顯示執行期 ID 的末段，不編造名字。
        label: String(id).split('~').slice(-1)[0] ?? String(id),
        sex: character.sex,
        // 年齡是「世界日 − 出生日」除以一年的日數。一年 365 日是這個世界的曆法
        // （content-source/core/character.ts 的 DAYS_PER_YEAR），沒有月份與閏年。
        ageYears: Math.floor((state.core.worldDay - Number(character.birthDay)) / DAYS_PER_YEAR),
      };
    })
    .filter((v): v is TavernVisitorView => v !== undefined);

  return {
    facilityId: String(facilityId),
    nameRef: requireData<FacilityDefinition>(registry, String(facilityId), '設施').display.nameRef,
    visitors,
    teamIsFull: (team?.memberIds.length ?? 0) >= MAX_FORMAL_MEMBERS,
  };
}

// 訓練投影。哪個設施能練哪幾項**完全由內容決定**：掃所有 `free-action-rule`，取
// `freeActionKind === 'train'` 且 `requiresCityFacilityKind` 等於本城某間設施的種類者。
// 沒有任何硬編的「訓練所＝戰鬥魔法」對照表——那張表住在 Content Pack 裡（core/team.ts）。
function projectTrainings(
  state: GameState,
  registry: DefinitionRegistry,
  cityId: string,
): readonly TrainingView[] {
  const team = state.team.teams[state.team.playerTeamId];
  const leaderId = team?.leaderId;
  if (leaderId === undefined) return [];

  const cityDef = registry
    .list({ kinds: ['city'] })
    .map((d) => d.data as unknown as CityDefinition)
    .find((c) => String(c.worldCityId) === cityId);
  if (cityDef === undefined) return [];

  const rules = registry
    .list({ kinds: ['free-action-rule'] })
    .map((d) => ({ id: String(d.id), data: d.data as unknown as FreeActionRuleDefinition }))
    .filter((r) => r.data.freeActionKind === 'train' && r.data.requiresCityFacilityKind !== undefined);

  const progress = state.progression.characterProgress[leaderId];
  const views: TrainingView[] = [];
  for (const fid of cityDef.facilityIds) {
    const facility = requireData<FacilityDefinition>(registry, String(fid), '設施');
    const rule = rules.find((r) => r.data.requiresCityFacilityKind === facility.facilityKind);
    if (rule === undefined) continue;
    const required = rule.data.requiredFreeDays;
    if (required === undefined) continue;
    const options: TrainingOptionView[] = (rule.data.trainableMasteryIds ?? []).map((mid) => {
      const current = progress?.masteries[mid];
      return {
        masteryId: String(mid),
        nameRef: requireData<MasteryDefinition>(registry, String(mid), '熟練度').display.nameRef,
        level: current?.level ?? 0,
        experience: current?.experience ?? 0,
      };
    });
    if (options.length === 0) continue;
    views.push({
      facilityId: String(fid),
      nameRef: facility.display.nameRef,
      ruleId: rule.id,
      requiredDays: required,
      options,
    });
  }
  return views;
}

// 家園畫面投影。房價走 `getPriceRuleQuote`——跟商店一樣是**當下報價**，所以畫面上的數字
// 就是實際會付的數字。已擁有房子時不列可購坪數：同城唯一性由 Handler 把關（doc §3.6），
// 這裡只是不給玩家一個註定被拒的按鈕。
function projectHome(
  state: GameState,
  registry: DefinitionRegistry,
  cityId: string,
  economyQuery: ReturnType<typeof createProductionEconomyQuery>,
): HomeView | undefined {
  const team = state.team.teams[state.team.playerTeamId];
  const buyerId = team?.leaderId;
  if (buyerId === undefined) return undefined;

  const cityDef = registry
    .list({ kinds: ['city'] })
    .map((d) => d.data as unknown as CityDefinition)
    .find((c) => String(c.worldCityId) === cityId);
  if (cityDef === undefined) return undefined;

  const facilityId = cityDef.facilityIds.find(
    (fid) => requireData<FacilityDefinition>(registry, String(fid), '設施').facilityKind === 'home',
  );
  if (facilityId === undefined) return undefined;

  const city = state.city.cities[cityId as never];
  if (city === undefined) return undefined;

  const balance = Object.values(state.economy.accounts)
    .filter((a) => a.owner.kind === 'character' && a.owner.characterId === buyerId)
    .reduce((sum, a) => sum + a.balance, 0);

  const homeRule = requireData<HomeRuleDefinition>(
    registry,
    String(cityDef.homeRuleId),
    '家園規則',
  );

  const ownedInstance = Object.values(state.city.homes).find(
    (h) => String(h.cityId) === cityId && h.ownerCharacterId === buyerId && h.state === 'owned',
  );
  const owned: OwnedHomeView | undefined =
    ownedInstance === undefined
      ? undefined
      : {
          homeId: String(ownedInstance.homeId),
          slotCapacity: ownedInstance.slotCapacity,
          usedSlots: ownedInstance.installedUpgradeIds.reduce(
            (sum, id) =>
              sum +
              requireData<HomeUpgradeDefinition>(registry, String(id), '家園升級').slotCost,
            0,
          ),
          installedUpgradeIds: ownedInstance.installedUpgradeIds.map(String),
        };

  const options: HomeOptionView[] =
    owned !== undefined
      ? []
      : homeRule.purchasableSlotCounts
          .map((slotCount) => {
            const priceRuleId = homeRule.purchasePriceRuleIds[slotCount];
            if (priceRuleId === undefined) return undefined;
            const quote = economyQuery.getPriceRuleQuote({
              priceRuleId,
              buyerCharacterId: buyerId,
              cityId: cityId as never,
              sourceRevision: city.revision,
            });
            return { slotCount, price: quote.amount, affordable: balance >= quote.amount };
          })
          .filter((o): o is HomeOptionView => o !== undefined)
          .sort((a, b) => a.slotCount - b.slotCount);

  return {
    facilityId: String(facilityId),
    nameRef: requireData<FacilityDefinition>(registry, String(facilityId), '設施').display.nameRef,
    balance,
    owned,
    options,
  };
}

// 一筆地圖內容的「怪物名」。內容的 payload 指向 EncounterGroup，編組的第一名成員就是這一群的
// 代表怪（swarm 是同一隻重複 8 次，boss 只有一隻）。編組本身沒有 display——它是「幾隻、站哪裡」
// 的編排，名字屬於怪物，所以這裡投影怪物的 nameRef，不另外替編組發明一個名字。
function monsterNameRefOf(
  registry: DefinitionRegistry,
  content: Readonly<{ payload: unknown }>,
): LocalizedTextRef | undefined {
  const payload = content.payload as { encounterGroupId?: unknown };
  const groupId = payload.encounterGroupId;
  if (typeof groupId !== 'string') return undefined;
  const group = registry.get(groupId as never);
  if (group === undefined) return undefined;
  const memberIds = (group.data as unknown as EncounterGroupDefinition).memberDefinitionIds;
  const first = memberIds[0];
  if (first === undefined) return undefined;
  const monster = registry.get(first as never);
  if (monster === undefined) return undefined;
  return (monster.data as unknown as MonsterDefinition).display.nameRef;
}

// 地牢畫面投影。地形來自 Template（房間與連線）、門的開關來自 map Slice、已揭露房間來自
// dungeon Slice——三個真相來源各自回答自己的部分，這一層只組合，不決定。
// 一層樓的平面圖 ＋ 四方向出口。
//
// 房間佔哪些格子是 Template 的事實（`RoomDefinition.cells`）；哪些房間看得見是 dungeon 的事實
// （`PlayerMapKnowledge.revealedRoomIds`）。方位由**格座標**算：兩個房間的代表格誰在上下左右。
// 用座標而不是用連線的宣告順序，換一張圖也不會把「北」畫成「西」。
function projectFloor(
  template: MapTemplateDefinition,
  floorNo: number,
  currentRoomId: string,
  revealed: ReadonlySet<string>,
  exitRoomIds: ReadonlySet<string>,
  contentCountByRoom: ReadonlyMap<string, number>,
): MapFloorView {
  const cells: MapCellView[] = [];
  let maxRow = 0;
  let maxCol = 0;
  for (const room of template.rooms) {
    if (room.floor !== floorNo) continue;
    const roomId = String(room.roomId);
    for (const cell of room.cells) {
      maxRow = Math.max(maxRow, cell.row);
      maxCol = Math.max(maxCol, cell.col);
      cells.push({
        row: cell.row,
        col: cell.col,
        roomId,
        revealed: revealed.has(roomId),
        isCurrent: roomId === currentRoomId,
        isExit: exitRoomIds.has(roomId),
        contentCount: contentCountByRoom.get(roomId) ?? 0,
      });
    }
  }
  return { floor: floorNo, rows: maxRow, cols: maxCol, cells };
}

// 房間的代表格：取最小 (row, col)。L 形／凹形房間也因此有一個穩定的錨點。
function roomAnchor(
  template: MapTemplateDefinition,
  roomId: string,
): Readonly<{ row: number; col: number }> | undefined {
  const room = template.rooms.find((r) => String(r.roomId) === roomId);
  if (room === undefined) return undefined;
  let best: { row: number; col: number } | undefined;
  for (const cell of room.cells) {
    if (best === undefined || cell.row < best.row || (cell.row === best.row && cell.col < best.col)) {
      best = { row: cell.row, col: cell.col };
    }
  }
  return best;
}

// 兩個房間的相對方位。row 往下增（南），col 往右增（東）——與 `cells` 的座標一致。
// 同列同欄（跨樓層的樓梯）不是四方向之一，回 undefined 由呼叫端排除。
function directionOf(
  from: Readonly<{ row: number; col: number }>,
  to: Readonly<{ row: number; col: number }>,
): MoveOptionView['direction'] | undefined {
  const dRow = to.row - from.row;
  const dCol = to.col - from.col;
  if (dRow === 0 && dCol === 0) return undefined;
  // 主要位移的那一軸決定方位；相等時以垂直優先（任一選擇都可，重點是決定性）。
  if (Math.abs(dRow) >= Math.abs(dCol)) return dRow < 0 ? 'north' : 'south';
  return dCol < 0 ? 'west' : 'east';
}

// ── 戰鬥投影 ─────────────────────────────────────────────────────────────────

function projectCombat(
  state: GameState,
  registry: DefinitionRegistry,
  resolvers: ResolverRegistry,
  teamId: GameState['team']['playerTeamId'],
): CombatView | undefined {
  // 這支隊伍進行中的遭遇。結算完成（resolved）的不再顯示——那時該回到地牢畫面。
  const encounter = Object.values(state.combat.encounters).find(
    (e) => String(e.playerTeamId) === String(teamId) && e.state !== 'resolved',
  );
  if (encounter === undefined) return undefined;

  const itemReader = createItemDefinitionReader(registry);
  const combatDefinitions = createCombatDefinitionReader(registry);
  const query = makeCombatQuery(state.combat, {
    definitions: combatDefinitions,
    loadout: createCombatLoadoutQuery(state.inventory, itemReader),
    progression: makeProgressionQuery(state.progression, createProgressionDefinitionReader(registry)),
  });

  const currentActorId = encounter.currentActorId;
  const actorIsPlayer =
    currentActorId !== undefined && encounter.combatants[currentActorId]?.side === 'player';

  const actions: CombatActionView[] =
    currentActorId === undefined || !actorIsPlayer
      ? []
      : query.getAvailableActions(encounter.encounterId, currentActorId).map((o) => ({
          skillId: String(o.skillId),
          nameRef: skillNameRefOf(registry, String(o.skillId)),
          actionKind: o.actionKind,
          available: o.available,
        }));

  const combatants: CombatantView2[] = Object.values(encounter.combatants).map((c) => ({
    combatantId: String(c.combatantId),
    side: c.side,
    nameRef:
      c.source.kind === 'monster'
        ? requireData<MonsterDefinition>(registry, String(c.source.monsterDefinitionId), '怪物')
            .display.nameRef
        : undefined,
    // 角色顯示名尚未授權（L1 文字欠債）：顯示執行期 ID 末段，不編造名字。
    fallbackLabel: String(c.combatantId).split('~').slice(-1)[0] ?? String(c.combatantId),
    row: c.anchorCell.row,
    col: c.anchorCell.col,
    health: c.health,
    maxHealth: c.maxHealth,
    mana: c.mana,
    maxMana: c.maxMana,
    ctb: c.currentCtb,
    state: c.state,
    isCurrentActor: String(c.combatantId) === String(currentActorId),
  }));

  return {
    encounterId: String(encounter.encounterId),
    state: encounter.state,
    currentActorId: currentActorId === undefined ? undefined : String(currentActorId),
    actions,
    combatants,
    order: query.getCtbOrder(encounter.encounterId).map(String),
  };
}

// 戰鬥招式的顯示名：`combat-skill.*` 沒有 display，名字住在它連到的**知識**那一筆
// （`skill.*` 也沒有 display）——兩族都還沒授權文字，所以這裡回 undefined，由 UI 顯示 local 名。
// 這是已知的 L1 文字欠債（161 筆技能），不是這一層可以就地補的。
function skillNameRefOf(registry: DefinitionRegistry, skillId: string): LocalizedTextRef | undefined {
  const def = registry.get(skillId as never);
  if (def === undefined) return undefined;
  const display = (def.data as { display?: { nameRef?: LocalizedTextRef } }).display;
  return display?.nameRef;
}

// ── 人物頁投影 ───────────────────────────────────────────────────────────────

function projectSheet(
  state: GameState,
  registry: DefinitionRegistry,
  resolvers: ResolverRegistry,
  teamId: GameState['team']['playerTeamId'],
): CharacterSheetView | undefined {
  const team = state.team.teams[teamId];
  const characterId = team?.leaderId;
  if (characterId === undefined) return undefined;
  const character = state.character.characters[characterId];
  if (character === undefined) return undefined;

  const itemReader = createItemDefinitionReader(registry);
  const loadout = state.inventory.equipmentLoadouts[characterId];
  const progress = state.progression.characterProgress[characterId];

  const nameRefOfItem = (itemId: string | undefined): LocalizedTextRef | undefined => {
    if (itemId === undefined) return undefined;
    const item = state.inventory.items[itemId as never];
    if (item === undefined) return undefined;
    return itemReader.getItem(item.definitionId).display.nameRef;
  };
  const slot = (slotId: string, itemId: string | undefined): EquippedSlotView => ({
    slotId,
    itemId,
    nameRef: nameRefOfItem(itemId),
  });

  // 防具格：以**內容宣告過的格位**為準（所有裝備的 occupiedSlots 聯集扣掉雙手），
  // 而不是在這裡列一份寫死的格位清單——換一份 Pack 就換一組格位。
  const handSlotIds = new Set<string>();
  const armorSlotIds = new Set<string>();
  for (const d of registry.list({ kinds: ['equipment'] })) {
    const eq = d.data as unknown as EquipmentDefinition;
    if (eq.equipmentKind === 'armor') for (const sid of eq.occupiedSlots) armorSlotIds.add(String(sid));
    else for (const sid of eq.occupiedSlots) handSlotIds.add(String(sid));
  }
  const armorSlots = [...armorSlotIds]
    .sort()
    .map((sid) => slot(sid, loadout === undefined ? undefined : String(loadout.armorSlots[sid as never] ?? '') || undefined));

  const weaponSets: WeaponSetView[] = (loadout?.weaponSets ?? []).map((ws, index) => ({
    weaponSetId: String(ws.weaponSetId),
    index,
    // 「目前生效」由 character 的戰鬥快照決定，而戰鬥外沒有生效組——第一組即預設。
    isActive: index === 0,
    mainHand: slot('mainHand', ws.mainHandItemId === undefined ? undefined : String(ws.mainHandItemId)),
    offHand: slot('offHand', ws.offHandItemId === undefined ? undefined : String(ws.offHandItemId)),
    skills: ws.selectedSkillIds.map((sid) =>
      sid === undefined
        ? undefined
        : {
            skillId: String(sid),
            nameRef: skillNameRefOf(registry, String(sid)),
            actionKind: '',
            available: true,
          },
    ),
  }));

  const equipable = Object.values(state.inventory.items)
    .filter(
      (i) => i.location.kind === 'characterBag' && String(i.location.characterId) === String(characterId),
    )
    .map((i) => ({ item: i, def: itemReader.getItem(i.definitionId) }))
    .filter((x) => x.def.kind === 'equipment')
    .map(({ item, def }) => {
      const eq = itemReader.getEquipment(item.definitionId);
      return {
        itemId: String(item.itemId),
        nameRef: def.display.nameRef,
        equipmentKind: eq.equipmentKind,
        slotIds: eq.occupiedSlots.map(String),
      };
    })
    .sort((a, b) => a.itemId.localeCompare(b.itemId));

  const masteries: MasteryLevelView[] = Object.values(progress?.masteries ?? {})
    .filter((m) => m.experience > 0 || m.level > 0)
    .map((m) => ({
      masteryId: String(m.masteryId),
      nameRef: requireData<MasteryDefinition>(registry, String(m.masteryId), '熟練度').display.nameRef,
      level: m.level,
      experience: m.experience,
    }))
    .sort((a, b) => b.experience - a.experience);

  const stats = createCharacterStatsQuery({
    characterState: state.character,
    progressionState: state.progression,
    inventoryState: state.inventory,
    itemReader,
    progressionReader: createProgressionDefinitionReader(registry),
    statisticsDefinitions: createStatisticsDefinitionReader(registry),
    statisticsResolvers: createStatisticsResolverPort(resolvers, registry),
    // 內容裡恰好一筆 statistics-rule（同 Bootstrap 的判準）。
    statisticsRuleId: onlyDefinitionId(registry, 'statistics-rule') as StatisticsRuleId,
    worldDay: state.core.worldDay,
  }).getStats(characterId);

  return {
    characterId: String(characterId),
    archetypeNameRef: undefined,
    sex: character.sex,
    ageYears: Math.floor((state.core.worldDay - Number(character.birthDay)) / DAYS_PER_YEAR),
    health: character.condition.health,
    maxHealth: stats.maxHealth,
    mana: character.condition.mana,
    maxMana: stats.maxMana,
    primary: makeProgressionQuery(
      state.progression,
      createProgressionDefinitionReader(registry),
    ).getPrimaryAttributes(characterId) as unknown as Readonly<Record<string, number>>,
    armorSlots,
    weaponSets,
    equipable,
    masteries,
    assignableSkills: assignableSkillsOf(registry, progress?.learnedKnowledgeIds ?? []),
  };
}

// 已學知識 → 對應的戰鬥招式。連結的方向是 `combat-skill → skill`
// （`CombatSkillDefinitionView.acquisition.knowledgeSkillId`），所以反查要掃一次戰鬥招式。
// 依 ID 排序，讓清單順序在重播中固定。
function assignableSkillsOf(
  registry: DefinitionRegistry,
  learned: readonly DefinitionId[],
): readonly CombatActionView[] {
  const known = new Set(learned.map(String));
  return registry
    .list({ kinds: ['combat-skill'] })
    .map((d) => ({ id: String(d.id), view: d.data as unknown as CombatSkillDefinitionView }))
    .filter(({ view }) => view.acquisition.kind === 'learned' && known.has(String(view.acquisition.knowledgeSkillId)))
    .map(({ id, view }) => ({
      skillId: id,
      nameRef: skillNameRefOf(registry, id),
      actionKind: view.actionKind,
      available: true,
    }))
    .sort((a, b) => a.skillId.localeCompare(b.skillId));
}

// 某個 kind 裡**恰好一筆**定義的 id。缺或重複都是內容錯，明確拋——不挑第一筆。
function onlyDefinitionId(registry: DefinitionRegistry, kind: string): string {
  const found = registry.list({ kinds: [kind] });
  if (found.length !== 1) {
    throw new Error(`game-facade：期望恰好一筆 "${kind}"，實得 ${found.length}`);
  }
  return String(found[0]!.id);
}

function projectDungeon(
  state: GameState,
  registry: DefinitionRegistry,
  teamId: GameState['team']['playerTeamId'],
  mapId: string,
): DungeonView | undefined {
  const session = state.dungeon.playerSessions[teamId as never];
  if (session === undefined) return undefined;

  const instance = state.map.instances[mapId as never];
  if (instance === undefined) return undefined;
  const template = requireData<MapTemplateDefinition>(registry, String(instance.templateId), '地圖模板');
  const site = requireData<AdventureSiteDefinition>(registry, String(instance.adventureSiteId), '冒險據點');

  const knowledge = Object.values(state.dungeon.playerMapKnowledge).find(
    (k) => String(k.teamId) === String(teamId) && String(k.mapId) === mapId,
  );
  const revealed = new Set((knowledge?.revealedRoomIds ?? []).map(String));
  const current = String(session.currentRoomId);

  const exits: RoomExitView[] = template.links
    .filter((l) => String(l.fromRoomId) === current || String(l.toRoomId) === current)
    .map((l) => {
      const other = String(l.fromRoomId) === current ? String(l.toRoomId) : String(l.fromRoomId);
      // 通道沒有 Door State（buildSpatialRuntime 只為 redDoor 建），永遠是開的。
      const doorState =
        l.kind === 'redDoor'
          ? (instance.spatialRuntime.doorStates[l.linkId]?.state ?? 'closed')
          : 'open';
      return {
        roomId: other,
        linkId: String(l.linkId),
        kind: l.kind,
        state: doorState === 'open' ? ('open' as const) : ('closed' as const),
        revealed: revealed.has(other),
      };
    });

  // 本版本的內容（舊版本的 removedByRefresh 不算）。
  const liveContents = (state.map.contentIdsByMap[mapId as never] ?? [])
    .map((id) => state.map.contents[id])
    .filter((c): c is NonNullable<typeof c> => c !== undefined)
    .filter((c) => c.mapVersion === instance.currentVersion && c.state === 'available');

  const roomContents: RoomContentView[] = liveContents
    .filter((c) => String(c.position.roomId) === current)
    .map((c) => {
      return {
        contentId: String(c.contentId),
        kind: c.kind,
        nameRef: monsterNameRefOf(registry, c),
        available: c.state === 'available',
      };
    });

  // 每個房間還剩幾筆內容（小地圖上顯示為一個小數字）。
  const contentCountByRoom = new Map<string, number>();
  for (const c of liveContents) {
    const rid = String(c.position.roomId);
    contentCountByRoom.set(rid, (contentCountByRoom.get(rid) ?? 0) + 1);
  }

  const currentFloor =
    template.rooms.find((r) => String(r.roomId) === current)?.floor ?? template.rooms[0]?.floor ?? 1;
  const floor = projectFloor(
    template,
    currentFloor,
    current,
    revealed,
    new Set(template.exitRoomIds.map(String)),
    contentCountByRoom,
  );

  // 四方向出口：由格座標判方位。同一方向有兩條路時保留先宣告的那一條（決定性）。
  const here = roomAnchor(template, current);
  const moves: MoveOptionView[] = [];
  const takenDirections = new Set<MoveOptionView['direction']>();
  for (const exit of exits) {
    const there = roomAnchor(template, exit.roomId);
    if (here === undefined || there === undefined) continue;
    const direction = directionOf(here, there);
    if (direction === undefined || takenDirections.has(direction)) continue;
    takenDirections.add(direction);
    moves.push({
      direction,
      roomId: exit.roomId,
      linkId: exit.linkId,
      kind: exit.kind,
      open: exit.state === 'open',
      revealed: exit.revealed,
    });
  }

  return {
    mapId,
    siteNameRef: site.display.nameRef,
    currentRoomId: current,
    roomContents,
    remainingContentCount: liveContents.length,
    isExitRoom: template.exitRoomIds.map(String).includes(current),
    elapsedMinutes: session.elapsedDungeonMinutes,
    revealedRoomCount: revealed.size,
    totalRoomCount: template.rooms.length,
    exits,
    floor,
    moves,
  };
}

// 一座城裡每一間店的貨架。價格由**正式報價鏈**算出（與按下購買時走的是同一支），
// 所以畫面上看到的數字就是實際會付的數字。
function projectShops(
  state: GameState,
  registry: DefinitionRegistry,
  cityId: string,
  economyQuery: ReturnType<typeof createProductionEconomyQuery>,
  itemReader: ItemDefinitionReader,
): readonly ShopView[] {
  const team = state.team.teams[state.team.playerTeamId];
  const buyerId = team?.leaderId;
  if (buyerId === undefined) return [];

  const balance = Object.values(state.economy.accounts)
    .filter((a) => a.owner.kind === 'character' && a.owner.characterId === buyerId)
    .reduce((sum, a) => sum + a.balance, 0);

  const byFacility = new Map<string, ShopOfferView[]>();
  for (const offer of Object.values(state.city.shopOffers)) {
    if (String(offer.cityId) !== cityId || offer.state !== 'available') continue;
    const item = state.inventory.items[offer.itemId];
    if (item === undefined) continue;
    const definition = itemReader.getItem(item.definitionId);
    const quote = economyQuery.getPurchaseQuote({
      offerId: offer.offerId,
      buyerCharacterId: buyerId,
      sourceRevision: offer.revision,
    });
    const list = byFacility.get(String(offer.facilityId)) ?? [];
    list.push({
      offerId: String(offer.offerId),
      itemDefinitionId: String(item.definitionId),
      nameRef: definition.display.nameRef,
      price: quote.amount,
      affordable: balance >= quote.amount,
    });
    byFacility.set(String(offer.facilityId), list);
  }

  const cityDef = registry
    .list({ kinds: ['city'] })
    .map((d) => d.data as unknown as CityDefinition)
    .find((c) => String(c.worldCityId) === cityId);
  if (cityDef === undefined) return [];

  return cityDef.facilityIds
    .map((fid) => ({ fid: String(fid), offers: byFacility.get(String(fid)) ?? [] }))
    .filter((x) => x.offers.length > 0)
    .map(({ fid, offers }) => ({
      facilityId: fid,
      nameRef: requireData<FacilityDefinition>(registry, fid, '設施').display.nameRef,
      offers: offers.sort((a, b) => a.price - b.price),
      balance,
    }));
}

export function projectView(
  state: GameState,
  registry: DefinitionRegistry,
  resolvers: ResolverRegistry,
): GameView {
  const playerTeamId = state.team.playerTeamId;
  const team = state.team.teams[playerTeamId];
  const leaderId = team?.leaderId;
  const leaderChar = leaderId === undefined ? undefined : state.character.characters[leaderId];
  const leader: LeaderView | undefined =
    leaderChar === undefined
      ? undefined
      : {
          id: String(leaderChar.characterId),
          archetypeId: String(leaderChar.archetypeId),
          sex: leaderChar.sex,
          health: leaderChar.condition.health,
          mana: leaderChar.condition.mana,
        };

  if (team === undefined) throw new Error('game-facade：GameState 沒有玩家隊伍');

  let location: LocationView;
  let city: GameView['city'];
  let dungeon: DungeonView | undefined;
  if (team.location.kind === 'city') {
    const cityId = String(team.location.cityId);
    const node = requireData<CityNodeDefinition>(registry, cityId, '城市節點');
    location = { kind: 'city', cityId, nameRef: node.display.nameRef };
    const itemReader = createItemDefinitionReader(registry);
    const economyQuery = createProductionEconomyQuery({
      registry,
      resolvers,
      economyState: state.economy,
      cityState: state.city,
      inventoryState: state.inventory,
      itemReader,
      progression: makeProgressionQuery(state.progression, createProgressionDefinitionReader(registry)),
    });
    city = projectCity(
      registry,
      cityId,
      projectShops(state, registry, cityId, economyQuery, itemReader),
      projectHome(state, registry, cityId, economyQuery),
      projectTrainings(state, registry, cityId),
      projectTavern(state, registry, cityId),
      projectGuild(state, registry, cityId),
    );
  } else if (team.location.kind === 'travelling') {
    const progress = team.location.progress;
    location = {
      kind: 'travelling',
      routeId: String(team.location.routeId),
      segmentIndex: progress.kind === 'playerSegments' ? progress.segmentIndex : 0,
    };
    city = undefined;
  } else if (team.location.kind === 'adventureMap') {
    const mapId = String(team.location.mapId);
    const instance = state.map.instances[mapId as never];
    if (instance === undefined) throw new Error(`game-facade：隊伍位於未知地圖實例 "${mapId}"`);
    const site = requireData<AdventureSiteDefinition>(
      registry,
      String(instance.adventureSiteId),
      '冒險據點',
    );
    location = { kind: 'adventureMap', mapId, siteNameRef: site.display.nameRef };
    city = undefined;
    dungeon = projectDungeon(state, registry, playerTeamId, mapId);
  } else {
    location = { kind: 'home', homeId: String(team.location.homeId) };
    city = undefined;
  }

  const activePlanId = team.activePlanId;
  const activePlan = activePlanId === undefined ? undefined : state.team.plans[activePlanId];

  return {
    worldDay: state.core.worldDay,
    activePlanKind: activePlan?.status === 'active' ? activePlan.kind : undefined,
    combat: projectCombat(state, registry, resolvers, playerTeamId),
    sheet: projectSheet(state, registry, resolvers, playerTeamId),
    location,
    leader,
    memberCount: team.memberIds.length,
    scheduledJobs: Object.keys(state.core.scheduler.jobsById).length,
    city,
    dungeon,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// 遊戲控制代
// ──────────────────────────────────────────────────────────────────────────

// 世界在一次指令之後自己走過的每一段（型別由引擎層提供；UI 只是轉出去給元件用）。
export type { SettleStep };

export type CommandOutcome =
  | Readonly<{ accepted: true; view: GameView; settled: readonly SettleStep[]; blocked?: string }>
  | Readonly<{ accepted: false; rejectionCode: string; view: GameView }>;

export type GameHandle = Readonly<{
  view: GameView;
  runCommand: (command: GameCommand) => CommandOutcome;
  // 依語系把 ViewModel 的 LocalizedTextRef 換成字。缺字回 undefined，由呼叫端呈現——
  // 本層不代為決定文字（見 data-runtime/localization.ts 的說明）。
  resolveText: (locale: UiLocale, ref: LocalizedTextRef) => string | undefined;
  locales: readonly string[];
}>;

// UI 與內容必須支援同一組語系。漂移（內容加了語系但 UI 沒加，或反過來）會讓畫面一半中文
// 一半英文——那是「缺內容卻看起來正常」的典型，所以在啟動時就明確失敗。
function assertLocaleParity(catalog: LocalizationCatalog): void {
  const missing = UI_LOCALES.filter((locale) => !catalog.locales.includes(locale));
  if (missing.length > 0) {
    throw new Error(
      `game-facade：UI 支援語系 ${UI_LOCALES.join('/')}，但內容缺少 ${missing.join('/')}——` +
        `介面與內容的語系必須一致，否則畫面會混語。`,
    );
  }
}

export function createGame(config: NewGameConfig): GameHandle {
  const loaded = loadBundledContent();
  if (!loaded.success) {
    throw new Error(`內容載入失敗：${loaded.diagnostics.map((d) => d.code).join(', ')}`);
  }
  const registry: DefinitionRegistry = loaded.registry;
  const catalog = loaded.localization;
  assertLocaleParity(catalog);

  const resolvers = createProductionResolverRegistry(loaded.resolverBindings);
  const assembler: ContextAssembler = createProductionContextAssembler(registry, resolvers);

  const started = createNewGame(config, registry, resolvers);
  if (!started.success) {
    throw new Error(`開新遊戲失敗：${started.diagnostics.map((d) => d.code).join(', ')}`);
  }

  let state: GameState = started.state;
  const playerTeamId = started.playerTeamId;

  // 把這支隊伍進行中的遭遇推進到「輪到玩家」為止。沒有進行中的遭遇時原樣回傳。
  const advanceCombat = (working: GameState): GameState => {
    const encounter = Object.values(working.combat.encounters).find(
      (e) => String(e.playerTeamId) === String(playerTeamId) && e.state !== 'resolved',
    );
    if (encounter === undefined) return working;
    return settleCombat(working, encounter.encounterId, assembler).state;
  };

  // 時間是動作的後果，不是玩家的一個指令——規則與理由見
  // `src/app/composition/session.ts` 的 `settleWorld`。這一層只負責把結果轉成 ViewModel。
  const runCommand = (command: GameCommand): CommandOutcome => {
    const request: GameCommandRequest<GameCommand> = { actorTeamId: playerTeamId, command };
    const result = runGameCommand(state, request, assembler);
    if (!result.accepted) {
      return { accepted: false, rejectionCode: result.rejection.code, view: projectView(state, registry, resolvers) };
    }
    // 指令接受後，先把**戰鬥**推進到輪回玩家（CTB 決定誰先動，常常是怪先），
    // 再讓世界結算到下一個決策點。順序不能反：戰鬥中的隊伍沒有 activePlan，
    // settleWorld 什麼都不會做，而怪的回合會停在那裡沒有人推。
    const afterCombat = advanceCombat(result.state);
    const settled = settleWorld(afterCombat, playerTeamId, assembler);
    state = settled.state;
    return {
      accepted: true,
      view: projectView(state, registry, resolvers),
      settled: settled.steps,
      blocked: settled.blocked,
    };
  };

  // 開局若已在戰鬥中（存讀檔情境）同樣要先推進到玩家回合。
  state = advanceCombat(state);

  return {
    view: projectView(state, registry, resolvers),
    runCommand,
    resolveText: (locale, ref) => catalog.resolve(locale, ref),
    locales: catalog.locales,
  };
}
