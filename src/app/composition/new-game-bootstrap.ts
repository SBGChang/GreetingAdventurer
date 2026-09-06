// app/composition/new-game-bootstrap.ts
// NewGameBootstrapper（12_engine_runtime.md §1.1）：從**真實 Content Pack** 開一個新遊戲。
//
// 與 `src/testing/composition/bring-up-bootstrap.ts` 的差別（後者刻意住在 testing/ 且不受依賴圖檢查）：
//   * bring-up 用假 archetype（`definition:character-archetype:founder`）、固定 HP/MP、不驗內容。
//   * 這一支是**正式路徑**：起始 archetype 與城市必須真的存在於 Content Pack，否則**不開新遊戲**
//     （規範五個合法出口的第 2 項：Content Pack 驗證失敗），而不是靜默給預設。
//
// 設計要點：
//   * **不硬編碼「玩家從哪個 archetype／哪座城開始」**——那是 new-game 設定，屬呼叫端（F4 的開新遊戲
//     畫面，或未來的 starting-scenario 定義）的選擇。本函式收 `NewGameConfig` 參數，只負責驗證 +
//     組裝。因此本檔沒有任何內容 ID 字面值。
//   * 初始主屬性**不由 archetype 帶值**：主屬性是 mastery 的推導值（progression.derivePrimaryAttributes），
//     新角色 masteries 為空 → 全 0。這與 GDD「主屬性是推導值」一致，不是缺資料。
//   * archetype 的 `lifecycleRuleId` 決定成年／退休／自然死亡的規則；lifecycle Job 的排程在
//     下一個增量補（需接上 scheduler；bring-up 也還沒排，引擎仍能跑）。

import type {
  CharacterArchetypeId,
  CityId,
  ItemInstanceId,
  CurrencyId,
  Revision,
  RngCursor,
  RngStreamId,
  RuntimeIdCursor,
  Seed,
  TeamId,
  WorldDay,
} from '../../contracts/core';
import type { DefinitionRegistry } from '../../data-runtime';
import type { Character, Sex } from '../../modules/character/public';
import { createCharacterState, handleCreateWorldAdventurerBatch } from '../../modules/character/public';
import type { CharacterStatsQuery } from '../../contracts/character';
import type { StatisticsRuleId } from '../../contracts/core';
import { createCharacterStatsQuery } from '../content/cross-module-ports';
import { createProgressionDefinitionReader } from '../content/progression-reader';
import { createStatisticsDefinitionReader } from '../content/statistics-reader';
import { createStatisticsResolverPort } from '../content/statistics-resolver-bridge';
import {
  emptyQuestState,
  onCityStockItemAvailable,
  onMapContentGenerated,
} from '../../modules/quest/public';
import type { CityDomainEvent, CityStockItemAvailable } from '../../contracts/city';
import { createQuestGenerationContext } from '../content/cross-module-ports';
import { createQuestDefinitionReader } from '../content/quest-reader';
import type { ContentInstanceId, MapInstanceId } from '../../contracts/core';
import type { CharacterState } from '../../modules/character/public';
import type { CreateWorldAdventurerBatch } from '../../contracts/character';
import type { FreeActionRuleDefinition, FreeActionRuleId } from '../../contracts/team';
import type { MemberFreeAction } from '../../modules/team/public';
import type { CharacterId } from '../../contracts/core';
import { createCharacterResolverPort } from '../content/character-context';
import type { ResolverRegistry } from '../../data-runtime';
import { createInitialProgressionState, handleCharacterBorn } from '../../modules/progression/public';
import type { Team, TeamCombatFormation } from '../../modules/team/public';
import { createTeamState } from '../../modules/team/public';
import { createCharacterDefinitionReader } from '../content/character-reader';
import { createWorldDefinitionReader } from '../content/world-reader';
import { createMapDefinitionReader } from '../content/map-reader';
import { createMapState, buildSpatialRuntime, refreshMapInstance } from '../../modules/map/public';
import type { MapInstance, MapState, TeamPresenceQuery } from '../../modules/map/public';
import { createMapContext } from '../content/map-context';
import { createMapDefinitionReader as createMapReader } from '../content/map-reader';
import { createCityDefinitionReader } from '../content/city-reader';
import { createItemDefinitionReader } from '../content/inventory-reader';
import { createInventoryQuery } from '../../modules/inventory/public';
import { handleShopRefresh } from '../../modules/city/public';
import type { CityDefinition, CityHandlerContext } from '../../modules/city/public';
import type { CurrencyDefinition } from '../../contracts/economy';
import { narrowedDomainReader } from '../content/reader-adapter';
import { createCityState } from '../../modules/city/public';
import type { CityRuntimeState, FacilityRuntimeState } from '../../modules/city/public';
import { createEconomyState } from '../../modules/economy/public';
import type { EconomyAccount } from '../../modules/economy/public';
import { createInitialLoadout, createInventoryState } from '../../modules/inventory/public';
import type { ItemInstance } from '../../modules/inventory/public';

// 會進城市永久庫存的物品家族。內容的 item kind 分六種（見 contracts/inventory 的 ItemKind），
// 這裡列出「商店會賣的」那幾種；不是清單挑選，而是家族篩選。
const ITEM_STOCK_KINDS: readonly string[] = [
  'generalItem',
  'combatConsumable',
  'nonCombatConsumable',
  'material',
  'equipment',
];
import { deterministicRng } from '../../kernel/rng';

import { createIdPortsForBootstrap } from './session';
import { createEmptyGameState, type GameState } from './state';

// 開新遊戲的設定：**由呼叫端提供**（開新遊戲畫面／scenario 定義），不是 Bootstrapper 自己決定。
export type NewGameConfig = Readonly<{
  worldSeed: string;
  // 世界從第幾天開始（曆法起點是內容，見 state.ts 的說明）。要讓隊長開局成年，startDay 需 ≥ 成年天數。
  startDay: number;
  // 玩家主角的起始 archetype 與所在城市——必須存在於 Content Pack。
  startingArchetypeId: CharacterArchetypeId;
  startCityId: CityId;
  leaderSex: Sex;
  // 隊長出生日。**必填**——隊長的起始年齡是開新遊戲的選擇，Bootstrapper 不替它發明預設
  // （原本寫 `?? 0`，被紀律門禁擋下：0 在這裡是猜的玩法值，不是結構不變量）。
  leaderBirthDay: number;
  // 隊長的起始金錢（最小貨幣單位）。與起始城市、起始 archetype 同性質：是**開新遊戲的選擇**，
  // 由呼叫端提供，Bootstrapper 不替它發明預設。
  startingMoney: number;
}>;

export type NewGameDiagnostic = Readonly<{ code: string; detail: string }>;

export type NewGameResult =
  | Readonly<{ success: true; state: GameState; playerTeamId: TeamId; leaderId: string }>
  | Readonly<{ success: false; diagnostics: readonly NewGameDiagnostic[] }>;

// `tavernVisit` 那一筆自由行動規則。以 `freeActionKind` 找、不寫死 ID：規則的 local 名屬內容。
// 恰好一筆才合法——沒有代表這份 Pack 沒有酒館這回事，多筆代表沒人說得出用哪一條。
function requireTavernVisitRuleId(registry: DefinitionRegistry): FreeActionRuleId {
  const found = narrowedDomainReader<FreeActionRuleDefinition>(
    registry,
    'reader:bootstrap.free-action-rule',
    ['free-action-rule'],
  )
    .list()
    .filter((rule) => rule.freeActionKind === 'tavernVisit');
  if (found.length !== 1) {
    throw new Error(
      `NewGameBootstrapper：期望恰好一筆 freeActionKind='tavernVisit' 的 free-action-rule，實得 ${found.length}`,
    );
  }
  return found[0]!.id as FreeActionRuleId;
}

function fail(diagnostics: readonly NewGameDiagnostic[]): NewGameResult {
  return { success: false, diagnostics };
}

export function createNewGame(
  config: NewGameConfig,
  registry: DefinitionRegistry,
  resolvers: ResolverRegistry,
): NewGameResult {
  const diagnostics: NewGameDiagnostic[] = [];

  // ── 輸入結構驗證（非內容問題，是呼叫端傳錯）───────────────────────────────
  if (config.worldSeed.trim() === '') {
    diagnostics.push({ code: 'newGame/empty-seed', detail: 'worldSeed 不可為空' });
  }
  const birthDay = config.leaderBirthDay;
  if (!Number.isInteger(config.startDay) || config.startDay < 0) {
    diagnostics.push({ code: 'newGame/invalid-start-day', detail: `startDay 需為非負整數（實得 ${config.startDay}）` });
  }
  if (!Number.isInteger(birthDay) || birthDay < 0 || birthDay > config.startDay) {
    diagnostics.push({
      code: 'newGame/invalid-birth-day',
      detail: `leaderBirthDay(${birthDay}) 需為非負整數且不晚於 startDay(${config.startDay})`,
    });
  }
  if (diagnostics.length > 0) return fail(diagnostics);

  // ── 內容存在性驗證（缺 → 不開新遊戲，§出口 2）─────────────────────────────
  const characters = createCharacterDefinitionReader(registry);
  const world = createWorldDefinitionReader(registry);

  // archetype 必須存在、可成為冒險者、且非「僅限臨時角色」。窄化 Reader 對未註冊 id 會拋，
  // 所以先問 registry 是否有，再取型別化 View——不吞例外、也不假設它存在。
  if (!registry.has(config.startingArchetypeId)) {
    diagnostics.push({
      code: 'newGame/archetype-missing',
      detail: `起始 archetype "${String(config.startingArchetypeId)}" 不存在於 Content Pack`,
    });
  }
  if (!registry.has(config.startCityId)) {
    diagnostics.push({
      code: 'newGame/start-city-missing',
      detail: `起始城市 "${String(config.startCityId)}" 不存在於 Content Pack`,
    });
  }
  if (diagnostics.length > 0) return fail(diagnostics);

  const archetype = characters.getArchetype(config.startingArchetypeId);
  if (!archetype.canBecomeAdventurer) {
    diagnostics.push({
      code: 'newGame/archetype-not-playable',
      detail: `archetype "${String(config.startingArchetypeId)}" 的 canBecomeAdventurer 為 false，不能當玩家主角`,
    });
  }
  if (archetype.temporaryOnly) {
    diagnostics.push({
      code: 'newGame/archetype-temporary-only',
      detail: `archetype "${String(config.startingArchetypeId)}" 是 temporaryOnly，不能當玩家主角`,
    });
  }
  // archetype 指名的 lifecycle 規則也必須存在——它決定成年／退休／自然死亡，缺了開局就不完整。
  if (!registry.has(archetype.lifecycleRuleId)) {
    diagnostics.push({
      code: 'newGame/lifecycle-rule-missing',
      detail: `archetype 指名的 lifecycle 規則 "${String(archetype.lifecycleRuleId)}" 不存在`,
    });
  }
  // startCity 必須真的是一座城市節點（不是別的 kind 的 id 剛好同名）。
  if (registry.kindOf(config.startCityId) !== 'city-node') {
    diagnostics.push({
      code: 'newGame/start-city-not-city-node',
      detail: `"${String(config.startCityId)}" 不是 city-node（實得 kind ${String(registry.kindOf(config.startCityId))}）`,
    });
  }
  if (diagnostics.length > 0) return fail(diagnostics);

  // 用一次以確認 city-node 讀得出來（壞內容會在此拋，而不是留到執行期）。
  world.getCityNode(config.startCityId);

  // ── 組裝 State ──────────────────────────────────────────────────────────
  const worldSeed = config.worldSeed as Seed;
  const { ids, currentCursor } = createIdPortsForBootstrap(worldSeed, 0 as RuntimeIdCursor);
  const leaderId = ids.character.nextCharacterId();
  const playerTeamId = ids.team.nextTeamId();

  const leader: Character = {
    characterId: leaderId,
    archetypeId: config.startingArchetypeId,
    origin: 'playerLineage',
    sex: config.leaderSex,
    birthDay: birthDay as WorldDay,
    lifeState: 'alive',
    availability: 'available',
    parentIds: [],
    childIds: [],
    innateTraitIds: [],
    reputation: 0,
    // HP/MP 上限最終由 progression capacity 決定；開局先給非零起手值，capacity 事件會夾正。
    // HP/MP 由派生統計引擎算（下面 `fullCondition` 那一段）；這裡先放 0，建完角色後補上。
    // 不寫「先給 100/50」那種佔位值：那是把一個玩法數字寫進程式。
    condition: { health: 0, mana: 0, statuses: [] },
    revision: 0 as Revision,
    lifecycleRevisions: {
      adulthood: 0 as Revision,
      retirementCheck: 0 as Revision,
      naturalDeathCheck: 0 as Revision,
    },
  };

  const playerTeam: Team = {
    teamId: playerTeamId,
    control: 'player',
    memberIds: [leaderId],
    temporaryMemberIds: [],
    leaderId,
    location: { kind: 'city', cityId: config.startCityId },
    revision: 0 as Revision,
  };

  const formation: TeamCombatFormation = {
    teamId: playerTeamId,
    placements: { [leaderId]: { floor: 0, row: 1, col: 1 } },
    revision: 0 as Revision,
  };


  // ── 冒險地圖實例 ────────────────────────────────────────────────────────
  //
  // 世界裡每一個 `adventure-site` 對應一個 MapInstance。它們必須在開新遊戲時就存在：
  // `enterAdventureMap` 會在**下令當下**用 `getAdventureSiteMapInstance` 解析，缺了就當場拒絕
  // （見 team/system.ts 的說明）。沒有這一段，任何據點都進不去。
  //
  // 為什麼在 Bootstrap 建而不是進場時建：MapInstance 是**世界的一部分**（NPC 隊伍也會進同一張
  // 圖、刷新排程以它為單位），不是玩家動作的產物。進場才建會讓「玩家沒去過的圖不存在」，
  // 而世界模擬需要它們一直在。
  //
  // 版本從 1 起算、門全關、陷阱 armed、採集點 available（buildSpatialRuntime 依 Template 重建）。
  // 內容（怪物／寶箱／事件）**不在這裡生成**：那是 map 模組刷新流程的職責，需要 spawn resolver。
  const mapReader = createMapDefinitionReader(registry);
  const mapInstances: MapInstance[] = [];
  for (const siteDef of registry.list({ kinds: ['adventure-site'] })) {
    const site = world.getAdventureSite(siteDef.id as never);
    const template = mapReader.getMapTemplate(site.mapTemplateId);
    // 版本 0 ＝「尚未刷新過」。下面每張圖都會跑一次正式刷新流程，把它推到版本 1 並生成內容——
    // 刻意不另寫 bootstrap 專用的生成路徑（見 map/system.ts 的 refreshMapInstance 說明）。
    const preRefreshVersion = 0;
    mapInstances.push({
      mapId: ids.map.nextMapInstanceId(),
      adventureSiteId: site.id,
      templateId: site.mapTemplateId,
      currentVersion: preRefreshVersion,
      // 刷新節奏偏移由 Template 宣告（內容），不是這裡挑的。
      refresh: { offsetDays: template.refreshOffsetDays },
      spatialRuntime: buildSpatialRuntime(template, preRefreshVersion),
      revision: 0 as Revision,
    });
  }

  // 每張圖跑一次正式刷新 → 版本 1 ＋ 依 Spawn Budget 生成的動態內容（怪群／Boss）。
  // 開局沒有任何隊伍在圖內，所以 presence 一律回 0/false；world Port 在 map 模組裡從未被讀取
  // （已逐行確認），接上前以「一被存取就指名拋錯」的 proxy 標記。
  const bootstrapPresence: TeamPresenceQuery = {
    countTeamsInside: () => 0,
    isTeamInside: () => false,
  };
  const mapContext = createMapContext({
    registry,
    definitions: createMapReader(registry),
    world: new Proxy({}, {
      get: (_t, prop) => {
        throw new Error(
          `NewGameBootstrapper：map context 的 world Port 尚未接線（存取 .${String(prop)}）——` +
            `map 模組目前不讀它；會走到這裡代表刷新流程新增了世界查詢。`,
        );
      },
    }) as never,
    presence: bootstrapPresence,
    ids: ids.map,
    rng: deterministicRng,
    rngContext: {
      worldSeed,
      streamId: 'map-bootstrap-spawn' as RngStreamId,
      cursor: 0 as RngCursor,
    },
    worldDay: config.startDay as WorldDay,
  });

  let seededMapState: MapState = createMapState({ instances: mapInstances });
  // 刷新同時記下每張圖生成了哪些內容——委託是**對這些內容的反應**（見下面的委託生成段）。
  const generatedContentIdsByMap = new Map<string, readonly ContentInstanceId[]>();
  for (const instance of mapInstances) {
    // 生不出內容時 refreshMapInstance 會拋（候選池為空／定義對不上）。那是內容壞掉，
    // 不該讓遊戲帶著空地圖開起來——Bootstrap 的合法反應就是不開新遊戲（§出口 2）。
    const refreshed = refreshMapInstance(instance, seededMapState, mapContext);
    seededMapState = refreshed.nextSlice;
    generatedContentIdsByMap.set(
      String(instance.mapId),
      Object.values(seededMapState.contents)
        .filter((c) => c.mapId === instance.mapId && c.state === 'available')
        .map((c) => c.contentId),
    );
  }

  // ── 城市、金錢、商店庫存 ─────────────────────────────────────────────────
  //
  // city / economy / inventory 三個 Slice 開局都是空的，於是主城的每一間店都沒有「城市」可掛、
  // 沒有帳戶可付款、也沒有貨可賣。這一段把世界的這三件事建起來——全部由**內容**決定：
  //   * 哪些城市、哪些設施 → CityDefinition.facilityIds
  //   * 繁榮／安全起始值   → CityDefinition.initialProsperity / initialSafety
  //   * 城裡有哪些貨       → 該文化所有「可交易」的物品定義（不是這裡挑的清單）
  // 開局上架時發出的「貨上架了」事件，稍後交給委託生成（見下面的委託段）。
  const stockEvents: CityStockItemAvailable[] = [];

  const cityReader = createCityDefinitionReader(registry);
  const itemReader = createItemDefinitionReader(registry);
  // 幣別由窄化 Reader 取得（`CurrencyDefinition.id` 本來就是 CurrencyId，不需要轉型）。
  const currencies = narrowedDomainReader<CurrencyDefinition>(registry, 'reader:bootstrap.currency', [
    'currency',
  ]).list();
  const currency = currencies[0];
  if (currency === undefined) {
    return fail([{ code: 'newGame/currency-missing', detail: 'Content Pack 沒有任何 currency 定義' }]);
  }
  const currencyId = currency.id;

  const cityRuntimes: CityRuntimeState[] = [];
  const accounts: EconomyAccount[] = [];
  const stockItems: ItemInstance[] = [];

  // 玩家隊長的錢包。
  accounts.push({
    accountId: ids.economy.nextEconomyAccountId(),
    owner: { kind: 'character', characterId: leaderId },
    currencyId,
    balance: config.startingMoney,
    revision: 0 as Revision,
  });

  // 這個文化包裡所有「可交易」的物品定義——商店貨架就從這些實體抽。
  // 「哪些能賣」是內容的宣告（`tradePolicy.tradable`），不是這裡挑的名單。
  const tradableItemIds = registry
    .list({ kinds: ITEM_STOCK_KINDS })
    .filter((def) => itemReader.getItem(def.id as never).tradePolicy.tradable)
    .map((def) => def.id as never);

  const cityDefinitions = narrowedDomainReader<CityDefinition>(registry, 'reader:bootstrap.city', [
    'city',
  ]).list();
  for (const city of cityDefinitions) {
    const facilityStates: Record<string, FacilityRuntimeState> = {};
    for (const facilityId of city.facilityIds) {
      // 開局所有設施都開著。關閉是 `SetFacilityAvailability` 之後的事，不是起始狀態。
      facilityStates[String(facilityId)] = {
        facilityId,
        availability: 'open',
        revision: 0 as Revision,
      };
    }
    cityRuntimes.push({
      cityId: city.worldCityId,
      facilityStates: facilityStates as CityRuntimeState['facilityStates'],
      prosperity: city.initialProsperity,
      safety: city.initialSafety,
      revision: 0 as Revision,
    });

    // 城市商店的收付款帳戶。
    accounts.push({
      accountId: ids.economy.nextEconomyAccountId(),
      owner: { kind: 'city', cityId: city.worldCityId },
      currencyId,
      balance: 0,
      revision: 0 as Revision,
    });

    // 城市永久庫存：每種可交易物品各一件。`shopRefresh` 會從這裡抽
    // `permanentStockOfferCount` 件上架（數量是內容，不是這裡決定的）。
    for (const definitionId of tradableItemIds) {
      stockItems.push({
        itemId: ids.inventory.nextItemInstanceId(),
        definitionId,
        quantity: 1,
        location: { kind: 'cityPermanentStock', cityId: city.worldCityId },
        state: 'active',
        revision: 0 as Revision,
      });
    }
  }

  // 商店開局上架：直接跑一次**正式的** `shopRefresh`，與日後每一次刷新走同一支程式
  //（與地圖刷新同一個理由：不另寫 bootstrap 專用路徑）。
  //
  // `handleShopRefresh` 只讀 definitions／inventory／rng／ids——它建立的是「貨架上有哪幾件」，
  // 不算價格（價格是買的時候才報）。所以這裡只組它真的會碰的 port，其餘一律 pending：
  // 碰到就拋並指名，不會有假實作讓流程看起來跑完。
  let seededCityState = createCityState({ cities: cityRuntimes });
  const seededInventoryState = createInventoryState({ items: stockItems });
  const seededEconomyState = createEconomyState({ accounts });
  {
    const inventoryQuery = createInventoryQuery(seededInventoryState, itemReader);
    const notNeeded = (port: string): never =>
      new Proxy(
        {},
        {
          get: (_t, prop) => {
            throw new Error(
              `NewGameBootstrapper：開局上架不應觸及 city context 的 "${port}"（存取 .${String(prop)}）`,
            );
          },
        },
      ) as never;

    const shopCtx = {
      worldDay: config.startDay as WorldDay,
      definitions: cityReader,
      inventory: {
        getItem: inventoryQuery.getItem,
        listAtLocation: inventoryQuery.listAtLocation,
        characterOwnsItem: inventoryQuery.characterOwnsItem,
        isReserved: inventoryQuery.isReserved,
        getItemKind: (itemId: ItemInstanceId) => {
          const item = inventoryQuery.getItem(itemId);
          return item === undefined ? undefined : itemReader.getItem(item.definitionId).kind;
        },
        isTradable: (itemId: ItemInstanceId) => {
          const item = inventoryQuery.getItem(itemId);
          return item === undefined ? false : itemReader.getItem(item.definitionId).tradePolicy.tradable;
        },
      },
      ids: ids.city,
      rng: deterministicRng,
      rngContext: {
        worldSeed,
        streamId: 'city-bootstrap-shop' as RngStreamId,
        cursor: 0 as RngCursor,
      },
      team: notNeeded('team'),
      economy: notNeeded('economy'),
      world: notNeeded('world'),
      supply: notNeeded('supply'),
      resolvers: notNeeded('resolvers'),
    } as CityHandlerContext;

    for (const city of cityDefinitions) {
      for (const shopRuleId of city.shopRuleIds) {
        const outcome = handleShopRefresh(
          {
            type: 'shopRefresh',
            jobId: `bootstrap-shop-${String(shopRuleId)}` as never,
            dueDay: config.startDay as WorldDay,
            owner: 'city' as never,
            targetId: shopRuleId,
            payload: {},
          } as never,
          seededCityState,
          shopCtx,
        );
        // 被拒＝內容配置有問題（例如商店規則不屬任何城市）。開局就該擋下，不要帶著空店開局。
        if (!outcome.ok) {
          return fail([
            {
              code: 'newGame/shop-refresh-rejected',
              detail: `商店 "${String(shopRuleId)}" 開局上架被拒：${outcome.rejection.code}`,
            },
          ]);
        }
        seededCityState = outcome.result.nextSlice;
        // 上架同時記下「哪一件貨、哪一筆 Offer」——採買與送貨委託是**對貨架的反應**
        // （見下面的委託生成段）。平時這條路由 `CityStockItemAvailable` 訂閱驅動，
        // 但開局的上架是 Bootstrap 直接呼叫的，沒有事件匯流排。
        for (const message of outcome.result.outgoingMessages) {
          // `TransactionMessageDraft` 是 event / internal command 的聯集，事件本體以 unknown 承載
          // （core messages.ts 的約定）。這裡以判別欄位收窄到 city 的事件聯集，再挑出要的那一種
          // ——不是跨語意轉型，而是聯集的正常收窄：型別守衛保證只有真的是這個 type 才會通過。
          const event = (message as { event?: CityDomainEvent }).event;
          if (event === undefined || event.type !== 'CityStockItemAvailable') continue;
          stockEvents.push(event);
        }
      }
    }
  }

  // ── 世界冒險者（酒館名單）─────────────────────────────────────────────────
  //
  // 開局每座城放一批冒險者，數量由該城的 `PopulationSupplyRuleDefinition.batchLimit` 決定
  // ——那正是「一次補幾個」的內容宣告，不是這裡挑的數字。人長什麼樣由
  // `WorldAdventurerGenerationRuleDefinition` 指名的四個 Resolver 決定（原型／性別／年齡／天賦）。
  //
  // 為什麼在 Bootstrap 建而不是等 `cityPopulationReview` 跑：那條 Job 只在**缺口**出現時補人，
  // 而世界一開始是空的——第一批得先存在，否則玩家第 1 日走進酒館看到的是一個空房間，
  // 而那不是「還沒接線」，是世界根本沒有人。（同一個理由，商店的開局庫存也在這裡上架。）
  //
  // 每個人都是自己隊伍的隊長（單人 NPC Team）＋一筆 `tavernVisit` 自由行動：
  // `listTavernVisitorsInCity` 認的就是這兩件事（team/state.ts）。招募把人從那支一人隊伍
  // 轉進玩家隊，所以「酒館名單」與「隊伍歸屬」始終是同一份真相，沒有第二個可見性旗標。
  const tavernVisitRuleId = requireTavernVisitRuleId(registry);
  const progressionReader = createProgressionDefinitionReader(registry);
  // 派生統計引擎（與正式 ContextAssembler 同一支）。開局角色的 HP/MP 上限由它決定——
  // 寫死一組起手值等於把玩法數字搬進程式，而那個數字之後永遠不會跟著內容改。
  const statisticsRules = narrowedDomainReader<{ id: string }>(
    registry,
    'reader:bootstrap.statistics-rule',
    ['statistics-rule'],
  ).list();
  if (statisticsRules.length !== 1) {
    throw new Error(
      `NewGameBootstrapper：期望恰好一筆 statistics-rule，實得 ${statisticsRules.length}`,
    );
  }
  const statisticsRuleId = statisticsRules[0]!.id as StatisticsRuleId;
  const makeStatsQuery = (characterState: CharacterState): CharacterStatsQuery =>
    createCharacterStatsQuery({
      characterState,
      progressionState: createInitialProgressionState(),
      inventoryState: seededInventoryState,
      itemReader,
      progressionReader,
      statisticsDefinitions: createStatisticsDefinitionReader(registry),
      statisticsResolvers: createStatisticsResolverPort(resolvers, registry),
      statisticsRuleId,
      worldDay: config.startDay as WorldDay,
    });
  const adventurerResolvers = createCharacterResolverPort({
    registry,
    resolvers,
    rng: deterministicRng,
  });
  const npcTeams: Team[] = [];
  const npcFreeActions: MemberFreeAction[] = [];
  const npcFormations: TeamCombatFormation[] = [];
  let adventurerState: CharacterState = createCharacterState({ characters: [leader] });


  for (const [cityIndex, cityDef] of cityDefinitions.entries()) {
    const supplyRule = cityReader.getPopulationSupplyRule(cityDef.populationSupplyRuleId);
    const batch: CreateWorldAdventurerBatch = {
      type: 'CreateWorldAdventurerBatch',
      cityId: cityDef.worldCityId,
      cultureId: world.getRegion(world.getCityNode(cityDef.worldCityId).regionId)
        .nativeCultureId,
      count: supplyRule.batchLimit,
      generationRuleId: supplyRule.adventurerGenerationRuleId,
      rngContext: {
        worldSeed,
        streamId: 'character-bootstrap-adventurer' as RngStreamId,
        // 每座城從不同的區段起抽，否則四座城會生出同一批人。
        cursor: (cityIndex * supplyRule.batchLimit * 4) as RngCursor,
      },
    };
    const bootstrapStats = makeStatsQuery(adventurerState);
    const before = Object.keys(adventurerState.characters);
    const outcome = handleCreateWorldAdventurerBatch(batch, adventurerState, {
      worldDay: config.startDay as WorldDay,
      definitions: characters,
      // 上限由**派生統計引擎**算（BM：max-health = 200 + safeRaw×20 之類），不是這裡挑的數字。
      // 開局角色還沒有任何熟練度與裝備，所以算出來的就是這份內容給的基礎值。
      stats: bootstrapStats,
      ids: ids.character,
      resolvers: adventurerResolvers,
    });
    adventurerState = outcome.nextSlice;

    for (const characterId of Object.keys(adventurerState.characters)) {
      if (before.includes(characterId)) continue;
      const memberId = characterId as CharacterId;
      const teamId = ids.team.nextTeamId();
      npcTeams.push({
        teamId,
        control: 'npc',
        memberIds: [memberId],
        temporaryMemberIds: [],
        leaderId: memberId,
        location: { kind: 'city', cityId: cityDef.worldCityId },
        revision: 0 as Revision,
      });
      npcFormations.push({
        teamId,
        placements: { [memberId]: { floor: 0, row: 1, col: 1 } },
        revision: 0 as Revision,
      });
      npcFreeActions.push({
        freeActionId: ids.team.nextFreeActionId(),
        teamId,
        memberId,
        ruleId: tavernVisitRuleId,
        // `tavernVisit` 是可持續的被動選項：不累積自由日、不排到期 Job（doc §3.5 不變量 5）。
        status: 'resting',
        accumulatedFreeDays: 0,
        payload: { kind: 'tavernVisit' },
        revision: 0 as Revision,
      });

    }
  }

  // ── 委託（公會板）────────────────────────────────────────────────────────
  //
  // 委託是世界對自己的反應：地圖上出現一群怪 → 附近的公會貼出肅清委託（doc §2.1）。
  // 平時這條路由 `MapContentGenerated` 訂閱驅動，但開局的刷新是 Bootstrap 直接呼叫的
  // （沒有交易、沒有事件匯流排），所以這裡直接跑**同一支** Handler——與商店開局上架同一個作法，
  // 不另寫一條 bootstrap 專用的生成邏輯。
  const questGenerationDeps = {
    questDefinitions: createQuestDefinitionReader(registry),
    teamState: createTeamState({ playerTeamId, teams: [playerTeam, ...npcTeams] }),
    mapState: seededMapState,
    mapDefinitions: mapReader,
    characterState: adventurerState,
    worldDay: config.startDay as WorldDay,
    registry,
    resolvers,
    world,
    ids: ids.quest,
    rng: deterministicRng,
  };
  // 每一筆生成事件用**自己的** RNG 串流。
  //
  // 正式路徑上每個事件都是一筆交易，`rngContextFor()` 以訊息 ID 派生 stream，所以天然不同。
  // Bootstrap 直接呼叫 Handler，沒有交易也沒有訊息 ID——若整批共用一條 stream 與同一個起始
  // 游標，每一次 `creationChance` 都會抽到**同一個數**：0.3 的採買委託要嘛全生、要嘛一筆都沒有。
  // （症狀就是「委託幾乎都一樣」的其中一半。）
  const questContextFor = (tag: string) =>
    createQuestGenerationContext({
      ...questGenerationDeps,
      rngContext: {
        worldSeed,
        streamId: `quest-bootstrap-generation:${tag}` as RngStreamId,
        cursor: 0 as RngCursor,
      },
    });

  let seededQuestState = emptyQuestState;
  for (const [mapId, contentIds] of generatedContentIdsByMap) {
    seededQuestState = onMapContentGenerated(
      { type: 'MapContentGenerated', mapId: mapId as MapInstanceId, mapVersion: 1, contentIds },
      seededQuestState,
      questContextFor(`map:${mapId}`),
    ).nextSlice;
  }
  // 貨架委託（採買／送貨）。與地圖那一批走**同一支** Handler。
  for (const event of stockEvents) {
    seededQuestState = onCityStockItemAvailable(
      event,
      seededQuestState,
      questContextFor(`stock:${String(event.offerId)}`),
    ).nextSlice;
  }

  // 隊長的 HP/MP 也由同一支引擎補滿。放在這裡而不是建 leader 的當下：`createCharacterStatsQuery`
  // 要讀 character Slice，而那時 Slice 還不存在。
  {
    const leaderStats = makeStatsQuery(adventurerState).getStats(leaderId);
    const current = adventurerState.characters[leaderId];
    if (current === undefined) throw new Error('NewGameBootstrapper：隊長不在 character Slice 裡');
    adventurerState = {
      ...adventurerState,
      characters: {
        ...adventurerState.characters,
        [leaderId]: {
          ...current,
          condition: {
            ...current.condition,
            health: leaderStats.maxHealth,
            mana: leaderStats.maxMana,
          },
        },
      },
    };
  }

  // 每一位角色的裝備欄位（三個空武器組）。`createInitialLoadout` 是契約明訂的**單一**建立入口，
  // 而且必須在任何 equip／設定武器組／Query 之前就存在——`equipItem` 對沒有 Loadout 的角色一律
  // 回 `loadout-not-initialized`（不惰性建立，否則 Handler 與 Query 會各自鑄出不同的 WeaponSetId）。
  // 沒有這一段，開局角色連武器都裝不上，於是戰鬥永遠沒有可選行動。
  const loadouts: Record<CharacterId, ReturnType<typeof createInitialLoadout>> = {};
  for (const characterId of Object.keys(adventurerState.characters) as CharacterId[]) {
    loadouts[characterId] = createInitialLoadout(characterId, ids.inventory.nextWeaponSetId);
  }
  const inventoryWithLoadouts: typeof seededInventoryState = {
    ...seededInventoryState,
    equipmentLoadouts: loadouts,
  };

  // 每一位角色的初始成長：走**同一支** `handleCharacterBorn`，不是在這裡自己 new 一份。
  // 那支 Handler 除了建立空成長，還會解鎖「門檻 Lv.0 的自動技能」——自己 new 就會漏掉那一步，
  // 於是開局角色手上有武器卻一招都沒有（GDD §戰鬥「沒有普通攻擊」，選單會是空的）。
  let seededProgression = createInitialProgressionState();
  for (const characterId of Object.keys(adventurerState.characters) as CharacterId[]) {
    seededProgression = handleCharacterBorn(seededProgression, characterId, progressionReader).nextSlice;
  }

  const teamState = createTeamState({
    playerTeamId,
    teams: [playerTeam, ...npcTeams],
    combatFormations: [formation, ...npcFormations],
    freeActions: npcFreeActions,
  });

  const base = createEmptyGameState({ worldSeed: config.worldSeed, startDay: config.startDay, team: teamState });
  const state: GameState = {
    ...base,
    map: seededMapState,
    quest: seededQuestState,
    city: seededCityState,
    economy: seededEconomyState,
    inventory: inventoryWithLoadouts,
    character: adventurerState,
    progression: {
      ...base.progression,
      characterProgress: seededProgression.characterProgress,
    },
    core: { ...base.core, nextRuntimeSequence: currentCursor() },
  };

  return { success: true, state, playerTeamId, leaderId: String(leaderId) };
}
