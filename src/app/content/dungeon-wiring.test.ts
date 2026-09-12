// app/content/dungeon-wiring.test.ts
// F3 整合塊·地牢探索迴圈端到端：真實 Content Pack（core + yunhua）＋ NewGameBootstrapper 的真實
// 開局狀態 → 正式 ContextAssembler → 玩家真的走完「進圖 → 探索 → 移動 → 出口 → 返城」。
//
// 這條路徑要證的是「每一步都有真實來源」：
//   1. Bootstrap 依 adventure-site 建出 MapInstance（九座據點各一），據點 → 圖解析得到。
//   2. enterAdventureMap 經 team.world 的 getAdventureSiteMapInstance 解析成功，1 日後真的入圖。
//   3. startPlayerExploration 由 DungeonMapPort 取得入口房間與入口小格。
//   4. moveDungeonRoom 的距離由房內 BFS ＋ 連線算出，乘上內容的 traversalMinutesPerCell 成為分鐘。
//   5. 走到出口房、useDungeonExit → 返城 Plan → 回到據點所屬城市。
//
// 手搭 fixture 會把要證的東西全部繞過去，所以一律用真實 pack 與 bootstrap 狀態。

import { resolve } from 'node:path';

import type { AdventureSiteId, CityId, RoomId, TeamId } from '../../contracts/core';
import type { CityNodeDefinition } from '../../contracts/world';
import type { MapTemplateDefinition } from '../../contracts/map';
import { loadContentFromDisk } from '../../platform/content-repository';
import { createNewGame, type NewGameConfig } from '../composition/new-game-bootstrap';
import { runGameCommand, runDueJob, settleWorld, type ContextAssembler } from '../composition/session';
import type { GameState } from '../composition/state';
import { createProductionContextAssembler } from './context-assembler';
import { createProductionResolverRegistry } from './resolver-registrations';

const CONTENT_ROOT = resolve(import.meta.dirname, '../../../content');
const NL = String.fromCharCode(10);

type Case = Readonly<{ name: string; run: () => void }>;

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

const START_CITY = 'city-node.yunhua.yunjing' as CityId;

const CONFIG: NewGameConfig = {
  worldSeed: 'dungeon-wiring-test',
  startDay: 14600,
  startingArchetypeId: 'character-archetype.core.player-lineage' as never,
  startCityId: START_CITY,
  leaderSex: 'female',
  leaderBirthDay: 5475,
  startingMoney: 500,
};

const loaded = loadContentFromDisk(CONTENT_ROOT);
if (!loaded.success) {
  throw new Error(`地牢接線測試前置失敗：${loaded.diagnostics.map((d) => d.code).join(', ')}`);
}
const registry = loaded.registry;
const resolvers = createProductionResolverRegistry(loaded.resolverBindings);
const assembler: ContextAssembler = createProductionContextAssembler(registry, resolvers);

function newGame(): Readonly<{ state: GameState; teamId: TeamId }> {
  const started = createNewGame(CONFIG, registry, resolvers);
  if (!started.success) throw new Error(`開新遊戲失敗：${started.diagnostics.map((d) => d.code).join(', ')}`);
  return { state: started.state, teamId: started.playerTeamId };
}

function dispatch(state: GameState, teamId: TeamId, command: unknown): GameState {
  const r = runGameCommand(state, { actorTeamId: teamId, command } as never, assembler);
  if (!r.accepted) throw new Error(`指令被拒：${r.rejection.code}`);
  return r.state;
}

// 與正式 UI 一樣，把行動結算至下一個玩家決策點。
function advance(state: GameState): GameState {
  const r = settleWorld(state, state.team.playerTeamId, assembler);
  if (r.blocked !== undefined) throw new Error(`世界結算被拒：${r.blocked}`);
  return r.state;
}

const locationOf = (state: GameState, teamId: TeamId): GameState['team']['teams'][TeamId]['location'] =>
  state.team.teams[teamId]!.location;

// 起始城的第一座據點（雲京·舊漕渠與沉倉）。
const startNode = registry.get(START_CITY as never)!.data as unknown as CityNodeDefinition;
const FIRST_SITE = startNode.adventureSiteIds[0]! as AdventureSiteId;

// 走一步：兩房之間若只有紅門相連且門還關著，先 openDungeonDoor 再 moveDungeonRoom。
// 這正是設計要的順序——紅門不是裝飾，它讓「開門」成為一個要花時間的決定。
function stepTo(
  state: GameState,
  teamId: TeamId,
  template: MapTemplateDefinition,
  fromRoomId: string,
  targetRoomId: string,
): GameState {
  const links = template.links.filter(
    (l) =>
      (String(l.fromRoomId) === fromRoomId && String(l.toRoomId) === targetRoomId) ||
      (String(l.toRoomId) === fromRoomId && String(l.fromRoomId) === targetRoomId),
  );
  let next = state;
  if (links.every((l) => l.kind === 'redDoor')) {
    const door = links[0]!;
    next = dispatch(next, teamId, { type: 'openDungeonDoor', linkId: door.linkId });
  }
  return dispatch(next, teamId, { type: 'moveDungeonRoom', targetRoomId: targetRoomId as RoomId });
}

// 下指令 → 世界自己結算到下一個決策點（正式路徑；UI 走的是同一支）。
function act(state: GameState, teamId: TeamId, command: unknown): GameState {
  const r = runGameCommand(state, { actorTeamId: teamId, command } as never, assembler);
  if (!r.accepted) throw new Error(`指令被拒：${r.rejection.code}`);
  const settled = settleWorld(r.state, teamId, assembler);
  if (settled.blocked !== undefined) throw new Error(`世界結算中止：${settled.blocked}`);
  return settled.state;
}

const cases: readonly Case[] = [
  {
    name: '時間是動作的後果：旅行 3／6／9 日由內容決定，一個指令走完（不需手動推進）',
    run: () => {
      const modes = registry.list({ kinds: ['player-travel-mode'] });
      assert(modes.length === 3, `應有三種行進方式，實得 ${modes.length}`);
      const route = registry.get(startNode.adjacentRouteIds[0]! as never)!.data as unknown as {
        id: string;
        toCityId: string;
      };
      for (const mode of modes) {
        const g = newGame();
        const durationDays = (mode.data as unknown as { durationDays: number }).durationDays;
        const after = act(g.state, g.teamId, {
          type: 'startCityTravel',
          toCityId: route.toCityId,
          routeId: route.id,
          modeId: mode.id,
        });
        assert(
          after.core.worldDay === g.state.core.worldDay + durationDays,
          `${String(mode.id)}：應恰好過 ${durationDays} 日，實得 ${after.core.worldDay - g.state.core.worldDay}`,
        );
        const location = locationOf(after, g.teamId);
        assert(location.kind === 'city', '一個指令之後就該抵達，不需要再推一次');
        assert(
          location.kind === 'city' && String(location.cityId) === String(route.toCityId),
          '應抵達目的城',
        );
        // 結算完畢＝玩家自由：沒有殘留的 activePlan。
        assert(after.team.teams[g.teamId]!.activePlanId === undefined, '抵達後不該還有進行中的 Plan');
      }
    },
  },
  {
    name: '時間是動作的後果：城市 → 冒險點固定 1 日；城裡不推進日期',
    run: () => {
      const g = newGame();
      // 城內免費操作（開始自由期）不推進世界日（設計文件：城內免費操作不推進世界日期）。
      const free = act(g.state, g.teamId, { type: 'beginCityFreePeriod' });
      assert(
        free.core.worldDay === g.state.core.worldDay,
        `城內自由行動不該推進日期，實得 +${free.core.worldDay - g.state.core.worldDay}`,
      );

      const entered = act(g.state, g.teamId, { type: 'enterAdventureMap', adventureSiteId: FIRST_SITE });
      assert(
        entered.core.worldDay === g.state.core.worldDay + 1,
        `去冒險點應恰好 1 日，實得 +${entered.core.worldDay - g.state.core.worldDay}`,
      );
      assert(locationOf(entered, g.teamId).kind === 'adventureMap', '一個指令之後就該在冒險地');
    },
  },
  {
    name: '地圖內容：依 §7.4 的槽位預算生成，且候選全部來自文化池並受 Tier 限制',
    run: () => {
      const { state } = newGame();
      const pools = registry.list({ kinds: ['culture-content-rule'] }).map(
        (d) => d.data as unknown as { candidates: readonly { encounterGroupId: string; tier: number }[] },
      );
      assert(pools.length === 2, `文化池應為兩筆（人類／非人類），實得 ${pools.length}`);
      const tierOf = new Map<string, number>();
      for (const p of pools) for (const c of p.candidates) tierOf.set(String(c.encounterGroupId), c.tier);

      let totalContents = 0;
      for (const instance of Object.values(state.map.instances)) {
        const template = registry.get(instance.templateId as never)!.data as unknown as MapTemplateDefinition;
        const spawnRule = registry.get(template.spawnRuleId as never)!.data as unknown as {
          contentTier: number;
          spawnBudgets: readonly { contentKind: string; minCount: number; maxCount: number }[];
        };
        const ids = state.map.contentIdsByMap[instance.mapId] ?? [];
        const contents = ids.map((id) => state.map.contents[id]!);
        totalContents += contents.length;

        // 數量＝預算總和（minCount===maxCount，§7.4 是「正式槽位」＝確定數）。
        const budgeted = spawnRule.spawnBudgets.reduce((n, b) => n + b.minCount, 0);
        assert(
          contents.length === budgeted,
          `${String(instance.templateId)}：預算 ${budgeted} 筆，實生 ${contents.length} 筆`,
        );

        for (const content of contents) {
          const payload = content.payload as { kind: string; encounterGroupId?: string };
          const groupId = String(payload.encounterGroupId);
          // 候選必須來自文化池——不得憑空生出一個 encounter group。
          const tier = tierOf.get(groupId);
          assert(tier !== undefined, `生成的 "${groupId}" 不在任何文化池裡`);
          // §7.4「地圖只限制 Tier」：不得超過該圖的 contentTier。
          assert(
            tier! <= spawnRule.contentTier,
            `${String(instance.templateId)}（Tier ${spawnRule.contentTier}）出現 Tier ${tier!} 的 "${groupId}"`,
          );
          // 一房一內容（不變量 3）。
        }
        const rooms = new Set(contents.map((c) => String(c.position.roomId)));
        assert(rooms.size === contents.length, `${String(instance.templateId)}：同一房間放了多筆內容`);
      }
      assert(totalContents > 0, '九張圖合計應至少生成一筆內容');
    },
  },
  {
    name: '地圖內容：同一 worldSeed 決定性；不同槽位不會全部抽到同一隻',
    run: () => {
      const a = createNewGame(CONFIG, registry, resolvers);
      const b = createNewGame(CONFIG, registry, resolvers);
      if (!a.success || !b.success) throw new Error('開新遊戲失敗');
      const groupsOf = (s: GameState): string =>
        Object.values(s.map.contents)
          .map((c) => `${String(c.mapId)}|${String((c.payload as { encounterGroupId?: string }).encounterGroupId)}`)
          .sort()
          .join(',');
      assert(groupsOf(a.state) === groupsOf(b.state), '同一 worldSeed 應生成完全相同的內容');

      // 槽位最多的那張圖必須抽到一種以上的編組——全部相同代表 RNG cursor 沒有隨槽位推進
      //（`SpawnDraft` 沒有 nextCursor，所以 Resolver 必須用 `index` 區分同批抽取）。
      const biggest = Object.values(a.state.map.instances)
        .map((i) => (a.state.map.contentIdsByMap[i.mapId] ?? []).map((id) => a.state.map.contents[id]!))
        .reduce((best, cur) => (cur.length > best.length ? cur : best), []);
      assert(biggest.length >= 3, '應有一張圖至少 3 個槽位可供檢查');
      const distinct = new Set(
        biggest.map((c) => String((c.payload as { encounterGroupId?: string }).encounterGroupId)),
      );
      assert(distinct.size > 1, `${biggest.length} 個槽位全部抽到同一個編組——RNG 沒有隨槽位推進`);
    },
  },
  {
    name: 'Bootstrap 為每一座冒險據點建出 MapInstance',
    run: () => {
      const { state } = newGame();
      const sites = registry.list({ kinds: ['adventure-site'] });
      const instances = Object.values(state.map.instances);
      assert(
        instances.length === sites.length,
        `據點 ${sites.length} 座，MapInstance ${instances.length} 個——應一一對應`,
      );
      // 每個實例都指回一個真實據點，且 templateId 與該據點宣告的一致。
      for (const instance of instances) {
        const site = registry.get(instance.adventureSiteId as never);
        assert(site !== undefined, `MapInstance 指向不存在的據點 ${String(instance.adventureSiteId)}`);
        const siteData = site!.data as unknown as { mapTemplateId: string };
        assert(
          String(instance.templateId) === siteData.mapTemplateId,
          `MapInstance 的 template 與據點宣告不一致：${String(instance.templateId)}`,
        );
        assert(instance.currentVersion === 1, '初版版本應為 1');
      }
    },
  },
  {
    name: '紅門開局全關、通道沒有門狀態（buildSpatialRuntime 依 Template 重建）',
    run: () => {
      const { state } = newGame();
      const instance = Object.values(state.map.instances).find(
        (i) => i.adventureSiteId === FIRST_SITE,
      )!;
      const template = registry.get(instance.templateId as never)!.data as unknown as MapTemplateDefinition;
      const redDoors = template.links.filter((l) => l.kind === 'redDoor');
      const doorStates = Object.values(instance.spatialRuntime.doorStates);
      assert(
        doorStates.length === redDoors.length,
        `紅門 ${redDoors.length} 扇，門狀態 ${doorStates.length} 筆——通道不該有門狀態`,
      );
      assert(doorStates.every((d) => d.state === 'closed'), '開局紅門應全關');
    },
  },
  {
    name: '去冒險：enterAdventureMap 經 team.world 解析出圖，1 日後真的入圖',
    run: () => {
      const g = newGame();
      let state = dispatch(g.state, g.teamId, {
        type: 'enterAdventureMap',
        adventureSiteId: FIRST_SITE,
      });
      assert(locationOf(state, g.teamId).kind === 'city', '下令當下仍在城裡（1 日 Plan）');
      state = advance(state);
      const location = locationOf(state, g.teamId);
      assert(location.kind === 'adventureMap', `入圖後位置應為 adventureMap，實得 ${location.kind}`);
      const expected = Object.values(state.map.instances).find((i) => i.adventureSiteId === FIRST_SITE)!;
      assert(
        location.kind === 'adventureMap' && String(location.mapId) === String(expected.mapId),
        '隊伍所在的 mapId 必須是 map 模組認得的那一個（不得由 team 自鑄）',
      );
    },
  },
  {
    name: '下圖：startPlayerExploration 由 DungeonMapPort 取得入口房間，並立即揭露',
    run: () => {
      const g = newGame();
      let state = dispatch(g.state, g.teamId, { type: 'enterAdventureMap', adventureSiteId: FIRST_SITE });
      state = advance(state);
      state = dispatch(state, g.teamId, { type: 'startPlayerExploration' });

      const session = state.dungeon.playerSessions[g.teamId];
      assert(session !== undefined, '應建立玩家探索 Session');
      const instance = Object.values(state.map.instances).find((i) => i.adventureSiteId === FIRST_SITE)!;
      const template = registry.get(instance.templateId as never)!.data as unknown as MapTemplateDefinition;
      assert(
        String(session!.currentRoomId) === String(template.entranceRoomIds[0]),
        `起始房間應為 Template 的入口房，實得 ${String(session!.currentRoomId)}`,
      );
      assert(session!.status === 'exploring', 'Session 狀態應為 exploring');
      // 入口房立即揭露（doc §3.2.3）。
      const knowledge = Object.values(state.dungeon.playerMapKnowledge).find(
        (k) => k.teamId === g.teamId && k.mapId === instance.mapId,
      );
      assert(
        knowledge !== undefined && knowledge.revealedRoomIds.includes(session!.currentRoomId),
        '入口房間應已揭露',
      );
    },
  },
  {
    name: '走動：移動到相鄰房間，分鐘數＝房內 BFS 步數 × 內容的 traversalMinutesPerCell',
    run: () => {
      const g = newGame();
      let state = dispatch(g.state, g.teamId, { type: 'enterAdventureMap', adventureSiteId: FIRST_SITE });
      state = advance(state);
      state = dispatch(state, g.teamId, { type: 'startPlayerExploration' });

      const before = state.dungeon.playerSessions[g.teamId]!;
      const instance = Object.values(state.map.instances).find((i) => i.adventureSiteId === FIRST_SITE)!;
      const template = registry.get(instance.templateId as never)!.data as unknown as MapTemplateDefinition;

      // 入口房的第一個鄰居（雲華首圖是紅門，所以這一步也證了「先開門才走得過去」）。
      const link = template.links.find(
        (l) => l.fromRoomId === before.currentRoomId || l.toRoomId === before.currentRoomId,
      );
      assert(link !== undefined, '入口房應至少有一條連線');
      const target = (link!.fromRoomId === before.currentRoomId ? link!.toRoomId : link!.fromRoomId) as RoomId;

      // 門還關著時直接移動必須被拒（getRoomTraversal 回 undefined）。
      if (link!.kind === 'redDoor') {
        const blocked = runGameCommand(
          state,
          { actorTeamId: g.teamId, command: { type: 'moveDungeonRoom', targetRoomId: target } } as never,
          assembler,
        );
        assert(!blocked.accepted, '紅門未開時不該可以穿過去');
      }

      state = stepTo(state, g.teamId, template, String(before.currentRoomId), String(target));
      const after = state.dungeon.playerSessions[g.teamId]!;
      assert(String(after.currentRoomId) === String(target), `應移動到 ${String(target)}`);
      assert(
        after.elapsedDungeonMinutes > before.elapsedDungeonMinutes,
        '移動必須消耗迷宮分鐘（距離 × 每格分鐘）',
      );
      // 分鐘數必須是每格分鐘的整數倍——證明它來自「步數 × 內容參數」，不是某個寫死值。
      const rule = registry.get('dungeon-interaction-rule.core.standard' as never)!.data as unknown as {
        traversalMinutesPerCell: number;
      };
      const spent = after.elapsedDungeonMinutes - before.elapsedDungeonMinutes;
      assert(
        spent % rule.traversalMinutesPerCell === 0,
        `消耗 ${spent} 分應為每格 ${rule.traversalMinutesPerCell} 分的整數倍`,
      );
      // 新房間也被揭露。
      const knowledge = Object.values(state.dungeon.playerMapKnowledge).find(
        (k) => k.teamId === g.teamId && k.mapId === instance.mapId,
      )!;
      assert(knowledge.revealedRoomIds.includes(target), '移入的房間應被揭露');
    },
  },
  {
    name: '不相鄰的房間不可通行（getRoomTraversal 回 undefined → 拒絕）',
    run: () => {
      const g = newGame();
      let state = dispatch(g.state, g.teamId, { type: 'enterAdventureMap', adventureSiteId: FIRST_SITE });
      state = advance(state);
      state = dispatch(state, g.teamId, { type: 'startPlayerExploration' });

      const session = state.dungeon.playerSessions[g.teamId]!;
      const instance = Object.values(state.map.instances).find((i) => i.adventureSiteId === FIRST_SITE)!;
      const template = registry.get(instance.templateId as never)!.data as unknown as MapTemplateDefinition;
      const neighbours = new Set(
        template.links
          .filter((l) => l.fromRoomId === session.currentRoomId || l.toRoomId === session.currentRoomId)
          .flatMap((l) => [String(l.fromRoomId), String(l.toRoomId)]),
      );
      const far = template.rooms.find((r) => !neighbours.has(String(r.roomId)));
      assert(far !== undefined, '應存在一個與入口房不相鄰的房間');

      const r = runGameCommand(
        state,
        { actorTeamId: g.teamId, command: { type: 'moveDungeonRoom', targetRoomId: far!.roomId } } as never,
        assembler,
      );
      assert(!r.accepted, '不相鄰的房間不該可以直接移動過去');
    },
  },
  {
    name: '離場：走到出口房 → useDungeonExit → 返城，回到據點所屬城市',
    run: () => {
      const g = newGame();
      let state = dispatch(g.state, g.teamId, { type: 'enterAdventureMap', adventureSiteId: FIRST_SITE });
      state = advance(state);
      state = dispatch(state, g.teamId, { type: 'startPlayerExploration' });

      const instance = Object.values(state.map.instances).find((i) => i.adventureSiteId === FIRST_SITE)!;
      const template = registry.get(instance.templateId as never)!.data as unknown as MapTemplateDefinition;
      const exitRoomId = template.exitRoomIds[0]!;

      // 入口房就是出口房時直接離場；否則沿著通道 BFS 找一條路走過去。
      const session = state.dungeon.playerSessions[g.teamId]!;
      if (String(session.currentRoomId) !== String(exitRoomId)) {
        const path = roomPath(template, String(session.currentRoomId), String(exitRoomId));
        assert(path !== undefined, '入口房到出口房應存在一條路徑');
        let at = String(session.currentRoomId);
        for (const step of path!) {
          state = stepTo(state, g.teamId, template, at, step);
          at = step;
        }
      }
      assert(
        String(state.dungeon.playerSessions[g.teamId]!.currentRoomId) === String(exitRoomId),
        '應已抵達出口房',
      );

      state = dispatch(state, g.teamId, { type: 'useDungeonExit', exitRoomId });
      // 離場後 Session 轉 leaving；返城 Plan 由 StartReturnFromDungeon 建立，1 日後抵達。
      state = advance(state);
      const location = locationOf(state, g.teamId);
      assert(
        location.kind === 'city' && String(location.cityId) === String(START_CITY),
        `返城後應回到據點所屬城市，實得 ${JSON.stringify(location)}`,
      );
    },
  },
];

// 房間圖上的最短路徑（通道與紅門都算連通；紅門由呼叫端在踏過去之前先開）。
// 回傳不含起點的房間序列。
function roomPath(
  template: MapTemplateDefinition,
  from: string,
  to: string,
): readonly string[] | undefined {
  const adjacency = new Map<string, string[]>();
  for (const link of template.links) {
    const a = String(link.fromRoomId);
    const b = String(link.toRoomId);
    (adjacency.get(a) ?? adjacency.set(a, []).get(a)!).push(b);
    (adjacency.get(b) ?? adjacency.set(b, []).get(b)!).push(a);
  }
  const previous = new Map<string, string>();
  const seen = new Set([from]);
  let frontier = [from];
  while (frontier.length > 0) {
    const next: string[] = [];
    for (const room of frontier) {
      for (const neighbour of adjacency.get(room) ?? []) {
        if (seen.has(neighbour)) continue;
        seen.add(neighbour);
        previous.set(neighbour, room);
        if (neighbour === to) {
          const path: string[] = [];
          for (let at = to; at !== from; at = previous.get(at)!) path.unshift(at);
          return path;
        }
        next.push(neighbour);
      }
    }
    frontier = next;
  }
  return undefined;
}

export function runTestResults(): readonly Readonly<{ name: string; passed: boolean; error?: string }>[] {
  return cases.map((c) => {
    try {
      c.run();
      return { name: c.name, passed: true };
    } catch (err) {
      return { name: c.name, passed: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
}

export function runTests(): void {
  const results = runTestResults();
  const failures = results.filter((r) => !r.passed);
  if (failures.length > 0) {
    const lines = failures.map((f) => `  ✗ ${f.name}: ${f.error ?? 'failed'}`);
    throw new Error(`dungeon-wiring: ${failures.length}/${results.length} test(s) failed${NL}${lines.join(NL)}`);
  }
}
