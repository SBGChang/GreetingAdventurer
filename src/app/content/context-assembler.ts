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
import { createProgressionDefinitionReader } from './progression-reader';
import { createEffectDefinitionReader } from './effect-reader';
// ── combat 接線：Reader 工廠、resolver bridge、跨模組 Query adapter ──
import { createCombatDefinitionReader, COMBAT_DEFINITION_KINDS } from './combat-reader';
import { createItemDefinitionReader } from './inventory-reader';
import { createStatisticsDefinitionReader, STATISTICS_DEFINITION_KINDS } from './statistics-reader';
import { createStatisticsResolverPort } from './statistics-resolver-bridge';
import { createCombatResolverPort } from './combat-resolver-bridge';
import {
  createCharacterStatsQuery,
  createCombatFormationQuery,
  createCombatLoadoutQuery,
  createInventoryContext,
  createQuestContext,
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
  const effectsReader = createEffectDefinitionReader(registry);

  // ── combat 接線：建置時取好一次的 Reader / 規則 id / params 窄門（每次 dispatch 不變）──
  const combatDefinitions = createCombatDefinitionReader(registry);
  const itemReader = createItemDefinitionReader(registry);
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
      combatDefs: combatDefinitions,
      progressionDefs: progressionReader,
      powerParams: { getPowerParams: (id) => combatPowerParams.get(id) },
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

    return {
      // ── 已接：team（rest / startCityTravel 等只讀 plan 規則的指令）─────────────
      team: {
        worldDay: runtime.worldDay,
        definitions: teamDefinitions,
        memberRetentionRuleId,
        teamPlanRuleIdByKind,
        ids: runtime.ids.team,
        // 以下三個 port 這批已接的指令不會觸及；接上前以 pending 明確標記（碰到就拋、指名是誰）。
        world: pending('team.world'),
        combat: pending('team.combat'),
        resolvers: pending('team.resolvers'),
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

      character: pending('character'),
      map: pending('map'),
      dungeon: pending('dungeon'),
      progression: progressionReader,
      city: pending('city'),
      social: pending('social'),
      economy: pending('economy'),
      world: pending('world'),
      crafting: pending('crafting'),
      distribution: pending('distribution'),
      combatSequence: pending('combatSequence'),
      npcBehavior: pending('npcBehavior'),
      effects: effectsReader,
    };
  };
}
