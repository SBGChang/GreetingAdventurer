// app/content/context-assembler.ts
// 正式 ContextAssembler（session.ts 的 ContextAssembler 型別的正式實作）。
//
// session.ts 是內容無關的：它只知道「給我一個 (runtime, state) => ModuleContexts」。這裡是那個
// 工廠的正式版——把真實 Content Pack（DefinitionRegistry）＋ Resolver Registry 接成各模組的
// HandlerContext。測試用的 `session-fixture.ts` 只接 dungeon、其餘 unusedContext；這一支逐模組
// 接上真實的 Definition Reader / 跨模組 Query / id allocator / Resolver bridge。
//
// **F3 逐模組接線，分多個增量。** 尚未接上的模組，其 context 以 `pending()` 提供：一個一被存取
// 就明確拋錯的 Proxy。這與「靜默回 undefined 然後行為錯掉」相反——它讓「這條路碰到了還沒接線的
// 模組」當場現形、指名是誰。只要**已註冊且可達的 Game Command** 不碰未接模組，引擎就跑得動；
// 碰到了就是一個清楚的「尚未接線」錯誤，不是難查的靜默失敗。
//
// 目前已接：team（足以跑 rest / startCityTravel 這類只讀 plan 規則的指令）。
// 待接：其餘模組與 team 自己的 world / combat / resolvers 子 port（見 pending 標記）。

import type {
  CombatRuleId,
  DefinitionId,
  MemberRetentionRuleId,
  StatisticsRuleId,
  TeamPlanRuleId,
  TeachingRuleId,
  ItemInstanceId,
} from '../../contracts/core';
import type {
  MemberRetentionRuleDefinition,
  TeamPlanKind,
  TeamPlanRuleDefinition,
} from '../../contracts/team';
import type { DefinitionRegistry, ResolverRegistry, WeightedLinearProductParams } from '../../data-runtime';
import type { ContextAssembler, EngineRuntime } from '../composition/session';
import type { ModuleContexts } from '../composition/router';
import type { GameState } from '../composition/state';
import { narrowedDomainReader } from './reader-adapter';
import { createTeamDefinitionReader, TEAM_DEFINITION_KINDS } from './team-reader';
// ── 地牢接線：map Query、world Reader、DungeonContext、team 的 world 子 port ──
import { createWorldDefinitionReader } from './world-reader';
import { createMapQuery } from '../../modules/map/public';
import { createTeamPresenceQuery } from '../../modules/team/public';
import { createMapContext } from './map-context';
import { createCityContext } from './city-context';
import { createEconomyDefinitionReader } from './economy-reader';
import { createWorldQueryForCity } from './city-context';
import {
  createDungeonContext,
  createDistributionContext,
  createTeamWorldReader,
  createPendingDungeonResolverPort,
} from './dungeon-context';
import { createProgressionDefinitionReader } from './progression-reader';
import { createEffectDefinitionReader } from './effect-reader';
// ── combat 接線：Reader 工廠、resolver bridge、跨模組 Query adapter ──
import { createCombatDefinitionReader, COMBAT_DEFINITION_KINDS } from './combat-reader';
import type {
  CombatAiParamsDefinition,
  CombatCounterConditionParamsDefinition,
} from '../../contracts/combat';
import { createItemDefinitionReader } from './inventory-reader';
import { createCityDefinitionReader } from './city-reader';
import { createTeamResolverPort } from './team-resolver-port';
import { createCharacterResolverPort } from './character-context';
import { createCharacterDefinitionReader } from './character-reader';
import { findFacilityIdByKind } from '../../modules/city/public';
import { createStatisticsDefinitionReader, STATISTICS_DEFINITION_KINDS } from './statistics-reader';
import { createStatisticsResolverPort } from './statistics-resolver-bridge';
import { createCombatResolverPort } from './combat-resolver-bridge';
import {
  createCharacterStatsQuery,
  createCombatFormationQuery,
  createCombatLoadoutQuery,
  createInventoryContext,
  createQuestContext,
  createQuestGenerationContext,
} from './cross-module-ports';
import { createMapDefinitionReader } from './map-reader';
import { createQuestDefinitionReader } from './quest-reader';
import { RESOLVER_PARAMS_KINDS } from './resolvers';
import { makeProgressionQuery } from '../../modules/progression/public';

// 一被存取就拋錯的 Proxy，代表「這個 port／context 在本次建置尚未接線」。回傳 never 以便賦值給
// 任何欄位型別（never 可賦值給一切）。不是 `as unknown as`——單一轉型，且語意是「觸發即錯」。
function pending(path: string): never {
  const handler: ProxyHandler<object> = {
    get(_target, prop) {
      throw new Error(
        `ContextAssembler: "${path}" 尚未接線（存取 .${String(prop)}）——F3 逐模組接上中，` +
          `這條指令路徑碰到了還沒接的模組`,
      );
    },
    apply() {
      throw new Error(`ContextAssembler: "${path}" 尚未接線（被當成函式呼叫）`);
    },
  };
  return new Proxy(function pendingCallable(): void {}, handler) as never;
}

// team-plan-rule 定義 → planKind → 規則 id 的對照（composition 由內容供給，見 TeamHandlerContext）。
// 走**窄化 Reader** 而不是 raw registry：Reader 的 View 是 TeamPlanRuleDefinition，其 id 已是
// TeamPlanRuleId、planKind 已是 TeamPlanKind——不需要任何 `as` 轉型（原本用 `as unknown as` 被門禁擋）。
function buildTeamPlanRuleIdByKind(
  registry: DefinitionRegistry,
): Readonly<Partial<Record<TeamPlanKind, TeamPlanRuleId>>> {
  const reader = narrowedDomainReader<TeamPlanRuleDefinition>(registry, 'assembler:team.team-plan-rule', [
    TEAM_DEFINITION_KINDS.teamPlanRule,
  ]);
  const out: Partial<Record<TeamPlanKind, TeamPlanRuleId>> = {};
  // 窄化 Reader 讀出的是 TeamPlanRuleDefinition，但它用 bare DefinitionHeader（id 是泛型
  // DefinitionId）。我們已依 kind 過濾，所以把它收斂成 TeamPlanRuleId 是安全的單一轉型
  // （不是 `as unknown as`——那是被禁的跨語意轉型；這是同族的 kind 收斂）。
  for (const def of reader.list()) out[def.planKind] = def.id as TeamPlanRuleId;
  return out;
}

// 取內容裡唯一一筆 member-retention-rule 的**型別化 id**。缺或重複 → 明確失敗（缺內容不啟動），不給預設。
function requireMemberRetentionRuleId(registry: DefinitionRegistry): MemberRetentionRuleId {
  const reader = narrowedDomainReader<MemberRetentionRuleDefinition>(
    registry,
    'assembler:team.member-retention-rule',
    [TEAM_DEFINITION_KINDS.memberRetentionRule],
  );
  const found = reader.list();
  if (found.length !== 1) {
    throw new Error(`ContextAssembler: 期望恰好一筆 member-retention-rule，實得 ${found.length}`);
  }
  return found[0]!.id as MemberRetentionRuleId;
}

// 取某個 kind 內容裡唯一一筆的 Definition id（缺或重複 → 明確失敗，不給預設）。回傳泛型 DefinitionId，
// 呼叫端以同族單一轉型收斂成該規則的具名 id（與 requireMemberRetentionRuleId／buildTeamPlanRuleIdByKind 同慣例）。
function requireSingleDefinitionId(
  registry: DefinitionRegistry,
  kind: string,
  readerId: string,
): DefinitionId {
  const reader = narrowedDomainReader<{ id: DefinitionId }>(registry, readerId, [kind]);
  const found = reader.list();
  if (found.length !== 1) {
    throw new Error(`ContextAssembler: 期望恰好一筆 ${kind}，實得 ${found.length}`);
  }
  return found[0]!.id;
}

// 建立正式 ContextAssembler。`resolvers` 目前只有 team 的（未接時不會被 rest 觸及）需要它；
// 保留參數是為了下一個增量接 Resolver bridge 時不改簽章。
export function createProductionContextAssembler(
  registry: DefinitionRegistry,
  resolvers: ResolverRegistry,
): ContextAssembler {
  // 這些「目前生效的規則 id」在建立 assembler 時就從內容取好（每次 dispatch 不變）。
  const teamPlanRuleIdByKind = buildTeamPlanRuleIdByKind(registry);
  const memberRetentionRuleId = requireMemberRetentionRuleId(registry);
  const teamDefinitions = createTeamDefinitionReader(registry);
  // progression 與 effects 是純 Definition Reader（前者無 context bag，見 router），直接接真實的。
  const progressionReader = createProgressionDefinitionReader(registry);
  // 目前生效的傳授規則（28 日、成人 0.15%、城鎮教師 Lv.5）。與 member-retention 同慣例：
  // 內容裡恰好一筆，缺或重複都是明確失敗。
  const teachingRuleId = requireSingleDefinitionId(
    registry,
    'teaching-rule',
    'assembler:progression.teaching-rule',
  ) as TeachingRuleId;
  // 世界 Definition Reader（據點 → 城市）在建立 assembler 時取好；mapDefinitions 見下方 combat 段。
  const worldDefinitions = createWorldDefinitionReader(registry);
  const effectsReader = createEffectDefinitionReader(registry);

  // ── combat 接線：建置時取好一次的 Reader / 規則 id / params 窄門（每次 dispatch 不變）──
  const combatDefinitions = createCombatDefinitionReader(registry);
  // P1：AI 行為與反擊述詞的 params 窄門（shape 只實作策略，選哪一種住內容）。
  const combatAiParams = narrowedDomainReader<CombatAiParamsDefinition>(
    registry,
    'reader:combat.ai-params',
    [COMBAT_DEFINITION_KINDS.aiParams],
  );
  const combatCounterParams = narrowedDomainReader<CombatCounterConditionParamsDefinition>(
    registry,
    'reader:combat.counter-condition-params',
    [COMBAT_DEFINITION_KINDS.counterConditionParams],
  );
  const itemReader = createItemDefinitionReader(registry);
  const cityDefinitions = createCityDefinitionReader(registry);
  const mapDefinitions = createMapDefinitionReader(registry);
  const questDefinitions = createQuestDefinitionReader(registry);
  const statisticsDefinitions = createStatisticsDefinitionReader(registry);
  const statisticsResolvers = createStatisticsResolverPort(resolvers, registry);
  // 內容裡唯一一筆 combat-rule / statistics-rule 的具名 id（同族單一轉型；缺或重複則不啟動）。
  const combatRuleId = requireSingleDefinitionId(
    registry,
    COMBAT_DEFINITION_KINDS.combatRule,
    'assembler:combat.combat-rule',
  ) as CombatRuleId;
  const statisticsRuleId = requireSingleDefinitionId(
    registry,
    STATISTICS_DEFINITION_KINDS.statisticsRule,
    'assembler:statistics.statistics-rule',
  ) as StatisticsRuleId;
  // 傷害/治療/CTB 的 weighted-power 讀 params 的窄門（weighted-product-params reader）。
  const combatPowerParams = narrowedDomainReader<WeightedLinearProductParams>(
    registry,
    'assembler:combat-power-params',
    [RESOLVER_PARAMS_KINDS.weightedProduct],
  );

  return (runtime: EngineRuntime, state: GameState): ModuleContexts => {
    // combat context 依賴當前 state 的多個 Slice（character/progression/inventory/team），每次
    // dispatch 依當下 state 與 worldDay 重建——與 team context 由 runtime 帶入的 worldDay 同一節奏。
    const combatProgression = makeProgressionQuery(state.progression, progressionReader);
    const combatLoadout = createCombatLoadoutQuery(state.inventory, itemReader);
    const stats = createCharacterStatsQuery({
      characterState: state.character,
      progressionState: state.progression,
      inventoryState: state.inventory,
      itemReader,
      progressionReader,
      statisticsDefinitions,
      statisticsResolvers,
      statisticsRuleId,
      worldDay: runtime.worldDay,
    });
    const combatFormation = createCombatFormationQuery({
      teamState: state.team,
      characterState: state.character,
      inventoryState: state.inventory,
      itemReader,
      stats,
    });
    const combatResolvers = createCombatResolverPort({
      registry: resolvers,
      // 防禦 MXP 路由要由裝備實體反查它的定義（equipmentKind ＋ relatedMasteryIds）。
      equipmentOf: (itemId: ItemInstanceId) => {
        const item = state.inventory.items[itemId];
        if (item === undefined) return undefined;
        // 只有裝備才有 equipmentKind／relatedMasteryIds；一般物品不是防具，回 undefined。
        if (itemReader.getItem(item.definitionId).kind !== 'equipment') return undefined;
        return itemReader.getEquipment(item.definitionId);
      },
      combatDefs: combatDefinitions,
      progressionDefs: progressionReader,
      powerParams: { getPowerParams: (id) => combatPowerParams.get(id) },
      aiParams: {
        getAiParams: (id) => combatAiParams.get(id),
        getCounterParams: (id) => combatCounterParams.get(id),
      },
      progression: combatProgression,
      loadout: combatLoadout,
      rng: runtime.rng,
      rngContextFor: runtime.rngContextFor,
    });

    // inventory context：reader/ids/worldDay 直供；team 成員/旅行狀態與派生統計負重上限轉接真實 sibling Slice。
    const inventoryContext = createInventoryContext({
      inventoryState: state.inventory,
      teamState: state.team,
      characterState: state.character,
      progressionState: state.progression,
      itemReader,
      progressionReader,
      statisticsDefinitions,
      statisticsResolvers,
      statisticsRuleId,
      worldDay: runtime.worldDay,
      ids: runtime.ids.inventory,
    });

    // quest context：acceptQuest 只讀前置與快照，三個 Port 皆唯讀轉接真實 sibling Slice。
    const questContext = createQuestContext({
      questDefinitions,
      teamState: state.team,
      mapState: state.map,
      mapDefinitions,
      characterState: state.character,
      worldDay: runtime.worldDay,
    });

    const questGenerationContext = createQuestGenerationContext({
      questDefinitions,
      teamState: state.team,
      mapState: state.map,
      mapDefinitions,
      characterState: state.character,
      worldDay: runtime.worldDay,
      registry,
      resolvers,
      world: worldDefinitions,
      ids: runtime.ids.quest,
      rng: runtime.rng,
      rngContext: runtime.rngContextFor('quest-generation'),
    });

    // map Query 與 DungeonContext 都依當下 state 重建（與 combat／inventory context 同節奏）：
    // 地形與內容的真相住在 map Slice，隊伍位置住在 team Slice，兩者每筆交易都可能變。
    const mapQuery = createMapQuery(state.map, mapDefinitions);
    const teamWorld = createTeamWorldReader({ world: worldDefinitions, mapState: state.map });
    const dungeonContext = createDungeonContext({
      registry,
      mapQuery,
      mapDefinitions,
      teamState: state.team,
      worldDay: runtime.worldDay,
      rng: runtime.rngContextFor('dungeon'),
      resolvers: createPendingDungeonResolverPort(),
      ids: runtime.ids.dungeon,
    });
    // distribution 必須跟著地牢一起接：startPlayerExploration 一開場就送 StartAssetDistribution，
    // 而 pending proxy 的例外會被該 Handler 的 try/catch 吞成「內容缺規則」（見 dungeon-context）。
    const distributionContext = createDistributionContext({
      registry,
      economyState: state.economy,
      inventoryState: state.inventory,
      itemReader,
      teamState: state.team,
      worldDay: runtime.worldDay,
      rngContext: runtime.rngContextFor('distribution'),
      ids: {
        nextInteractionId: runtime.ids.dungeon.nextInteractionId,
        nextEconomyTransferId: runtime.ids.economy.nextEconomyTransferId,
      },
    });
    // map context：地圖刷新（`mapRefreshCheck` Job）與開門／陷阱／採集／內容結算的內部命令。
    // world Port 在 map 模組裡從未被讀取（逐行確認過）；接上前以 pending 明確標記。
    const mapContext = createMapContext({
      registry,
      definitions: mapDefinitions,
      world: pending('map.world'),
      presence: createTeamPresenceQuery(state.team),
      ids: runtime.ids.map,
      rng: runtime.rng,
      rngContext: runtime.rngContextFor('map'),
      worldDay: runtime.worldDay,
    });

    // city context：買賣走完整報價鏈（見 city-context.ts 的鏈條圖）。
    const cityContext = createCityContext({
      registry,
      resolvers,
      economyState: state.economy,
      cityState: state.city,
      inventoryState: state.inventory,
      itemReader,
      teamState: state.team,
      progression: makeProgressionQuery(state.progression, progressionReader),
      worldDay: runtime.worldDay,
      rng: runtime.rng,
      rngContext: runtime.rngContextFor('city'),
      ids: runtime.ids.city,
      nextTransferId: runtime.ids.economy.nextEconomyTransferId,
      // 護送生成／人口批次／情報揭露／城市指標的 Resolver 尚未接線；買賣路徑完全不觸及它們。
      cityResolvers: pending('city.resolvers'),
      world: createWorldQueryForCity(worldDefinitions),
      // 冒險者供給量：目前以「該城裡的 NPC 隊伍成員數」計。人口批次尚未開放，
      // 所以這個數字只在 cityPopulationReview 用得到，而那條 Job 本版沒有排。
      supply: {
        countAdventurerSupply: (cityId) =>
          Object.values(state.team.teams)
            .filter((t) => t.control === 'npc' && t.location.kind === 'city' && t.location.cityId === cityId)
            .reduce((n, t) => n + t.memberIds.length, 0),
      },
    });

    return {
      // ── 已接：team（rest / startCityTravel 等只讀 plan 規則的指令）─────────────
      team: {
        worldDay: runtime.worldDay,
        definitions: teamDefinitions,
        memberRetentionRuleId,
        teamPlanRuleIdByKind,
        ids: runtime.ids.team,
        // world 子 port 已接：據點 → MapInstance／出口城市，由 world Definition ＋ map Slice 投影。
        // 這是 enterAdventureMap 與 returnToCity 能運作的前提。
        world: teamWorld,
        // 城市設施（city 擁有的事實）。自由行動的設施門檻要問它：這座城有沒有一間**營業中**
        // 的該種設施。定義端說有哪些設施，Runtime State 說它今天開不開，兩個都要成立。
        city: {
          hasOpenFacilityKind: (cityId, kind) => {
            const facilityId = findFacilityIdByKind(cityDefinitions, cityId, kind);
            if (facilityId === undefined) return false;
            const runtimeCity = state.city.cities[cityId];
            if (runtimeCity === undefined) return false;
            return runtimeCity.facilityStates[facilityId]?.availability === 'open';
          },
        },
        // 這個 port 這批已接的指令不會觸及；接上前以 pending 明確標記（碰到就拋、指名是誰）。
        combat: pending('team.combat'),
        // 招募擲骰／離隊擲骰／預設站位。三個 resolverId 都由內容的規則定義指名（見該檔）。
        resolvers: createTeamResolverPort({
          registry,
          resolvers,
          rng: runtime.rng,
          rngContext: runtime.rngContextFor('team'),
        }),
      },

      // ── 已接：combat（StartCombatEncounter / useCombatSkill / combatRest）─────────
      combat: {
        definitions: combatDefinitions,
        combatRuleId,
        progression: combatProgression,
        loadout: combatLoadout,
        formation: combatFormation,
        resolvers: combatResolvers,
        ids: runtime.ids.combat,
        rng: runtime.rng,
      },

      // ── 已接：inventory（equipItem / configureWeaponSet 及 EvaluateTeamEncumbrance 內部命令）──
      inventory: inventoryContext,

      // ── 待接：其餘模組與服務（F3 後續增量逐一換成真實 context）─────────────────
      // ── 已接：quest（acceptQuest；team/map/character 唯讀投影）──
      quest: questContext,
      // ── 已接：quest 生成（地圖刷新出內容 → 依 QuestReactionRule 貼委託）──
      questGeneration: questGenerationContext,

      // ── 已接：character（裝備變動夾住 HP/MP 上限、世界冒險者生成）──────────────
      //
      // `resolvers` 只接了世界冒險者生成那一支；退休／自然死亡／生育／任務暫時角色四支仍是
      // 「一被呼叫就拋並指名是誰」（見 character-context.ts）。那是能力最小化，不是缺口掩蓋：
      // 走到那四條路的 Job 與 Command 目前都沒有註冊。
      character: {
        worldDay: runtime.worldDay,
        definitions: createCharacterDefinitionReader(registry),
        stats,
        ids: runtime.ids.character,
        resolvers: createCharacterResolverPort({ registry, resolvers, rng: runtime.rng }),
      },

      // ── 已接：map（刷新生成、開門、陷阱、採集、內容結算）───────────────────────
      map: mapContext,

      // ── 已接：dungeon（探索／移動／開門／互動／離場的玩家路徑）─────────────────
      dungeon: dungeonContext,
      progression: { definitions: progressionReader, teachingRuleId },
      // ── 已接：city（商店買賣、家園、設施可用性、商店刷新）───────────────────
      city: cityContext,
      social: pending('social'),
      // ── 已接：economy（轉帳／帳戶；買賣的金錢移轉走這裡）──────────────────────
      economy: {
        worldDay: runtime.worldDay,
        transactionId: runtime.transactionId,
        definitions: createEconomyDefinitionReader(registry),
        ids: runtime.ids.economy,
        // 報酬 Resolver（委託／戰利品直售的金額）尚未接線；買賣路徑不觸及它。
        resolvers: pending('economy.resolvers'),
      },
      world: pending('world'),
      crafting: pending('crafting'),
      // ── 已接：distribution（地牢戰利品分配的 collecting 開場；拍賣輪的 Resolver 仍待接）──
      distribution: distributionContext,
      combatSequence: pending('combatSequence'),
      npcBehavior: pending('npcBehavior'),
      effects: effectsReader,
    };
  };
}
