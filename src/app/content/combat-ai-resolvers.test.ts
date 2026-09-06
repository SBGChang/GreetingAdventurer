// app/content/combat-ai-resolvers.test.ts
// F3 P1 驗收：用**真實 Content Pack** 證明一隻真怪在一場真遭遇裡選得出合法招式與合法目標，
// 而且決定性（同 seed 同結果）。工作單指定的驗收條件。
//
// 「合法」的定義逐條對應工作單的陷阱：
//   * 目標必須是敵對側、活著、在**有效射程**內（射程過濾重用 filterByReach，不自己算距離）。
//   * 沒有合法行動要回 `undefined`（Handler 視為休息），不得回一個假招式。

import { resolve } from 'node:path';

import type {
  CombatantId,
  EncounterId,
  MonsterDefinitionId,
  Revision,
  RngCursor,
  RngStreamId,
  Seed,
  TeamId,
} from '../../contracts/core';
import type { CombatAiParamsDefinition, CombatCounterConditionParamsDefinition } from '../../contracts/combat';
import { loadContentFromDisk } from '../../platform/content-repository';
import { deterministicRng } from '../../kernel/rng';
import { narrowedDomainReader } from './reader-adapter';
import { createCombatDefinitionReader, COMBAT_DEFINITION_KINDS } from './combat-reader';
import { createProgressionDefinitionReader } from './progression-reader';
import { createCombatResolverPort } from './combat-resolver-bridge';
import { createProductionResolverRegistry } from './resolver-registrations';
import type { CombatEncounter, CombatantState } from '../../modules/combat/state';

const CONTENT_ROOT = resolve(import.meta.dirname, '../../../content');
const NL = String.fromCharCode(10);

type Case = Readonly<{ name: string; run: () => void }>;
function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

const loaded = loadContentFromDisk(CONTENT_ROOT);
if (!loaded.success) {
  throw new Error(`AI resolver 測試前置失敗：${loaded.diagnostics.map((d) => d.code).join(', ')}`);
}
const registry = loaded.registry;
const combatDefs = createCombatDefinitionReader(registry);

const aiParamsReader = narrowedDomainReader<CombatAiParamsDefinition>(
  registry,
  'test:combat-ai-params',
  [COMBAT_DEFINITION_KINDS.aiParams],
);
const counterParamsReader = narrowedDomainReader<CombatCounterConditionParamsDefinition>(
  registry,
  'test:combat-counter-params',
  [COMBAT_DEFINITION_KINDS.counterConditionParams],
);

function makeBridge(): ReturnType<typeof createCombatResolverPort> {
  return createCombatResolverPort({
    registry: createProductionResolverRegistry(loaded.success ? loaded.resolverBindings : []),
    combatDefs,
    progressionDefs: createProgressionDefinitionReader(registry),
    powerParams: {
      getPowerParams: () => {
        throw new Error('本測試不應觸及 power params');
      },
    },
    aiParams: {
      getAiParams: (id) => aiParamsReader.get(id),
      getCounterParams: (id) => counterParamsReader.get(id),
    },
    progression: {
      getPrimaryAttributes: () => {
        throw new Error('本測試不應觸及 progression');
      },
    } as never,
    loadout: {} as never,
    // 本測試不觸及防禦 MXP 路由：沒有裝備定義可查（回 undefined ＝「沒有可歸屬的防具」）。
    equipmentOf: () => undefined,
    rng: deterministicRng,
    rngContextFor: (tag: string) => ({
      worldSeed: 'ai-test-seed' as Seed,
      streamId: tag as RngStreamId,
      cursor: 0 as RngCursor,
    }),
  });
}

// 一隻怪 vs 一名玩家戰鬥員的最小遭遇。
//
// 站位預設**雙方都在前排（row 1）**：`combatDistance` 是「攻方離前排 ＋ 守方離前排 ＋ 1」
//（見 modules/combat/state.ts），所以前排對前排＝1，是全場最近的距離——近戰招式打得到。
//
// 格座標 **1 起算**（GRID_MIN=1；11_combat_module.md §3.3「以第 1 排為前排、第 3 排為後排」）。
// 本檔第一版寫成 0 起算，是因為當時 `GRID_MIN` 誤設為 0——那個常數已訂正，這裡跟著回到 1。
function encounterWith(
  monsterId: MonsterDefinitionId,
  opts: Readonly<{ playerAlive?: boolean; playerRow?: number }> = {},
): Readonly<{ encounter: CombatEncounter; monsterId: CombatantId; playerId: CombatantId }> {
  const monsterCombatantId = 'combatant:monster' as CombatantId;
  const playerCombatantId = 'combatant:player' as CombatantId;
  const base = {
    footprint: { width: 1, height: 1 },
    health: 100,
    maxHealth: 100,
    mana: 100,
    maxMana: 100,
    startHealth: 100,
    startMana: 100,
    currentCtb: 0,
    externalCtbIncreaseSinceOwnAction: 0,
    interruptionImmuneUntilOwnAction: false,
    activeStatuses: [],
    revision: 0 as Revision,
  };
  const monster: CombatantState = {
    ...base,
    combatantId: monsterCombatantId,
    source: { kind: 'monster', monsterDefinitionId: monsterId, runtimeEnemyId: 'enemy:1' as never },
    side: 'enemy',
    anchorCell: { floor: 0, row: 1, col: 1 },
    state: 'ready',
  } as CombatantState;
  const player: CombatantState = {
    ...base,
    combatantId: playerCombatantId,
    source: { kind: 'character', characterId: 'character:1' as never },
    side: 'player',
    anchorCell: { floor: 0, row: opts.playerRow ?? 1, col: 1 },
    state: opts.playerAlive === false ? 'dead' : 'ready',
  } as CombatantState;

  const encounter = {
    encounterId: 'encounter:1' as EncounterId,
    source: { kind: 'dungeon' } as never,
    playerTeamId: 'team:1' as TeamId,
    playerFormationRevision: 0 as Revision,
    combatants: { [monsterCombatantId]: monster, [playerCombatantId]: player },
    playerGrid: {} as never,
    enemyGrid: {} as never,
    state: 'active',
    currentActorId: monsterCombatantId,
    readyQueue: [],
    supportMasteryUseCounts: {},
    rngContext: { worldSeed: 'ai-test-seed' as Seed, streamId: 'x' as RngStreamId, cursor: 0 as RngCursor },
    revision: 0 as Revision,
    participantCharacterIds: [],
    defenseFormationRows: [],
    attackDamageByCharacter: {},
  } as unknown as CombatEncounter;

  return { encounter, monsterId: monsterCombatantId, playerId: playerCombatantId };
}

// 每一種 AI Policy 至少要有一隻真怪掛著它，否則這個測試證不到那條分支。
function monstersByPolicyLocal(): ReadonlyMap<string, MonsterDefinitionId> {
  const out = new Map<string, MonsterDefinitionId>();
  for (const def of registry.list({ kinds: [COMBAT_DEFINITION_KINDS.monster] })) {
    const monster = def.data as unknown as { aiPolicyId: string };
    const local = monster.aiPolicyId.split('.').slice(2).join('.');
    if (!out.has(local)) out.set(local, def.id as MonsterDefinitionId);
  }
  return out;
}

const cases: readonly Case[] = [
  {
    name: '三個 AI Policy 都有真怪掛著，且都在真實內容裡綁到 shape',
    run: () => {
      const byPolicy = monstersByPolicyLocal();
      for (const local of ['single-skill-aggressor', 'elite-threat-focus', 'boss-rotation']) {
        assert(byPolicy.has(local), `沒有任何怪掛 AI Policy "${local}"——這條分支證不到`);
      }
      const bound = new Set(loaded.success ? loaded.resolverBindings.map((b) => String(b.resolverId)) : []);
      for (const local of ['single-skill-aggressor', 'elite-threat-focus', 'boss-rotation']) {
        assert(
          bound.has(`resolver:combat.ai-behavior.${local}`),
          `resolver:combat.ai-behavior.${local} 沒有綁定`,
        );
      }
    },
  },
  {
    name: '每一種 Policy 的真怪都選得出合法招式與合法目標',
    run: () => {
      const bridge = makeBridge();
      for (const [local, monsterId] of monstersByPolicyLocal()) {
        const { encounter, monsterId: actorId, playerId } = encounterWith(monsterId);
        const choice = bridge.chooseEnemyAction({ encounter, actorId });
        assert(choice !== undefined, `${local}（${String(monsterId)}）選不出行動`);
        // 招式必須是這隻怪真的有的一招（現在是 core 的共通招「撞擊」）。
        const monster = combatDefs.getMonster(monsterId);
        assert(
          monster.skillIds.map(String).includes(String(choice!.skillId)),
          `${local}：選了一招不屬於這隻怪的技能 ${String(choice!.skillId)}`,
        );
        // 目標必須是敵對側且存活。
        assert(
          choice!.targetCombatantIds.length === 1 && String(choice!.targetCombatantIds[0]) === String(playerId),
          `${local}：目標不是唯一存活的敵對單位`,
        );
      }
    },
  },
  {
    name: '每一隻怪都掛著共通招「撞擊」，且它引用的定義全部存在',
    run: () => {
      const monsters = registry
        .list({ kinds: [COMBAT_DEFINITION_KINDS.monster] })
        .map((d) => ({ id: d.id, data: d.data as unknown as { skillIds: readonly string[] } }));
      assert(monsters.length > 0, '沒有任何怪物定義');
      for (const m of monsters) {
        assert(m.data.skillIds.length > 0, `${String(m.id)} 沒有任何技能——怪物在戰鬥裡選不到行動`);
        for (const skillId of m.data.skillIds) {
          const view = combatDefs.trySkillView(skillId as never);
          assert(view !== undefined, `${String(m.id)} 引用了不存在的技能 ${skillId}`);
          // 這一招要真的打得出傷害：必須帶至少一個效果，且目標 resolver 已綁定。
          assert(view!.effectIds.length > 0, `技能 ${skillId} 沒有任何效果，打不出傷害`);
          const bound = new Set(loaded.success ? loaded.resolverBindings.map((b) => String(b.resolverId)) : []);
          assert(
            bound.has(String(view!.targeting.targetResolverId)),
            `技能 ${skillId} 的目標 resolver ${String(view!.targeting.targetResolverId)} 沒有綁定`,
          );
        }
      }
    },
  },
  {
    name: '決定性：同一 seed 同一遭遇，重複呼叫得到同一結果',
    run: () => {
      const byPolicy = monstersByPolicyLocal();
      for (const monsterId of byPolicy.values()) {
        const a = makeBridge();
        const b = makeBridge();
        const { encounter, monsterId: actorId } = encounterWith(monsterId);
        const x = a.chooseEnemyAction({ encounter, actorId });
        const y = b.chooseEnemyAction({ encounter, actorId });
        assert(JSON.stringify(x) === JSON.stringify(y), `${String(monsterId)}：同 seed 兩次結果不同`);
      }
    },
  },
  {
    name: '沒有合法目標時回 undefined（不回假招式）',
    run: () => {
      const bridge = makeBridge();
      for (const monsterId of monstersByPolicyLocal().values()) {
        // 唯一的敵對單位已死 → 沒有合法目標。
        const { encounter, monsterId: actorId } = encounterWith(monsterId, { playerAlive: false });
        const choice = bridge.chooseEnemyAction({ encounter, actorId });
        assert(choice === undefined, `${String(monsterId)}：目標全滅時仍回了一個行動`);
      }
    },
  },
  {
    name: '反擊述詞：依來襲動作種類與距離判定，兩筆規則行為不同',
    run: () => {
      const bridge = makeBridge();
      const anyMonster = [...monstersByPolicyLocal().values()][0]!;

      const evaluate = (
        conditionLocal: string,
        incomingActionKind: 'attack' | 'support',
        playerRow: number,
      ): boolean => {
        const { encounter, monsterId: defenderId, playerId } = encounterWith(anyMonster, { playerRow });
        const withStance = {
          ...encounter,
          combatants: {
            ...encounter.combatants,
            [defenderId]: {
              ...encounter.combatants[defenderId]!,
              counterStance: {
                conditionResolverId: `resolver:combat.${conditionLocal}`,
                counterDelayRuleId: 'x',
              },
            },
          },
        } as unknown as CombatEncounter;
        return bridge.evaluateCounterStance({
          encounter: withStance,
          defenderId,
          attackerId: playerId,
          incomingActionKind,
        });
      };

      // 不限距離的格擋反擊：攻擊觸發、支援不觸發（距離不參與判定）。
      assert(evaluate('counter-condition-block', 'attack', 1), 'block：攻擊應觸發');
      assert(!evaluate('counter-condition-block', 'support', 1), 'block：支援不應觸發');
      // 近戰限定（≤1）：前排對前排（row 1）＝距離 1 → 觸發；守方退到 row 3 → 距離 3 → 不觸發。
      assert(evaluate('counter-condition-melee-block', 'attack', 1), 'melee：前排對前排應觸發');
      assert(!evaluate('counter-condition-melee-block', 'attack', 3), 'melee：後排攻擊不應觸發');
    },
  },
];

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
    throw new Error(`combat-ai-resolvers: ${failures.length}/${results.length} test(s) failed${NL}${lines.join(NL)}`);
  }
}
