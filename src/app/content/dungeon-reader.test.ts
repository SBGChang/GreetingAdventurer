// app/content/dungeon-reader.test.ts
// 證明 data-runtime → 領域 Reader 的 adapter 路徑：
//   1. 單元層——由記憶體內 content pack 建 DefinitionRegistry → createDungeonDefinitionReader，
//      各 getter 回傳正確定義；未知 id / 跨 kind 存取明確拋錯。
//   2. 端到端——把這個**真** reader 換進引擎 Session 的 assembler，跑 openDungeonDoor：真 reader
//      在一筆真交易裡供給 redDoorOpenMinutes，門仍被開。證明 adapter 不只型別對，還能真的驅動。
//
// 這是 data-runtime 的第一個真實消費者（在此之前零消費者）。之後其餘模組 reader 依同樣式擴充，
// 內容 JSON 一落地就能接上，不用改 Session。

import type { ContentPackId, DefinitionId } from '../../contracts/core';
import {
  createDefinitionRegistry,
  type ContentDefinition,
  type ContentManifestIdentity,
  type DefinitionRegistry,
} from '../../data-runtime';

import { FIXTURE } from '../../modules/dungeon/fixtures';
import { requireInstance } from '../../modules/map/public';

import { runGameCommand } from '../composition/session';
import { baseState, makeAssembler, openRedDoor } from '../../testing/composition/session-fixture';

import { createDungeonDefinitionReader, DUNGEON_DEFINITION_KINDS } from './dungeon-reader';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const PACK = 'pack:dungeon-bringup' as ContentPackId;

function def(id: string, kind: string, data: Record<string, unknown>): ContentDefinition {
  return {
    id: id as DefinitionId,
    kind,
    schemaVersion: 1,
    packId: PACK,
    enabled: true,
    sourcePath: `mem://${kind}/${id}`,
    data: data as ContentDefinition['data'],
  };
}

// 對齊 dungeon FIXTURE 的最小 bring-up 定義集（與 fixtures.createFixtureReader 同值）。
function dungeonDefinitions(): readonly ContentDefinition[] {
  return [
    def(FIXTURE.interactionRuleId, DUNGEON_DEFINITION_KINDS.interactionRule, {
      traversalMinutesPerCell: 30,
      redDoorOpenMinutes: 20,
      trapResolverId: FIXTURE.trapResolverId,
    }),
    def(FIXTURE.npcExplorationRuleId, DUNGEON_DEFINITION_KINDS.npcExplorationRule, {
      dailyPointBudget: 10,
      stopPolicyId: 'definition:npc-stop-policy:first-failure',
    }),
    def(FIXTURE.resolverId, DUNGEON_DEFINITION_KINDS.npcTargetResolver, {
      supportedTargetKinds: [{ kind: 'gatheringNode' }],
      outcomeRuleId: 'definition:outcome-rule:always-success',
      successBehavior: 'continue',
    }),
    def(FIXTURE.gatheringRulePlayer, DUNGEON_DEFINITION_KINDS.gatheringRule, {
      dungeonInteractionMinutes: 15,
    }),
    def(FIXTURE.gatheringRuleNpc, DUNGEON_DEFINITION_KINDS.gatheringRule, {
      dungeonInteractionMinutes: 10,
    }),
  ];
}

const IDENTITY: ContentManifestIdentity = {
  manifestVersion: '0.0.0-bringup',
  manifestHash: 'bringup',
  packs: [{ packId: PACK, version: '0.0.0', hash: 'bringup' }],
};

function registry(): DefinitionRegistry {
  return createDefinitionRegistry(dungeonDefinitions(), IDENTITY);
}

export type ReaderTestResult = Readonly<{ name: string; pass: boolean; error?: string }>;

const CASES: readonly Readonly<{ name: string; run: () => void }>[] = [
  {
    name: 'getDungeonInteractionRule 由 registry 投影出領域定義（header + 領域欄位）',
    run: () => {
      const reader = createDungeonDefinitionReader(registry());
      const rule = reader.getDungeonInteractionRule(FIXTURE.interactionRuleId);
      assert(rule.id === (FIXTURE.interactionRuleId as unknown), 'id 應為 registry 權威值');
      assert(rule.enabled === true, 'enabled 應取自 registry header');
      assert(rule.traversalMinutesPerCell === 30, `traversalMinutesPerCell（實得 ${rule.traversalMinutesPerCell}）`);
      assert(rule.redDoorOpenMinutes === 20, `redDoorOpenMinutes（實得 ${rule.redDoorOpenMinutes}）`);
      assert(String(rule.trapResolverId) === String(FIXTURE.trapResolverId), 'trapResolverId 應取自 data');
    },
  },
  {
    name: 'getNpcExplorationRule / getNpcResolver 各自窄化到自己的 kind',
    run: () => {
      const reader = createDungeonDefinitionReader(registry());
      const expl = reader.getNpcExplorationRule(FIXTURE.npcExplorationRuleId);
      assert(expl.dailyPointBudget === 10, `dailyPointBudget（實得 ${expl.dailyPointBudget}）`);
      const res = reader.getNpcResolver(FIXTURE.resolverId);
      assert(res.successBehavior === 'continue', `successBehavior（實得 ${res.successBehavior}）`);
      assert(res.supportedTargetKinds.length === 1, '應有 1 個 supportedTargetKind');
    },
  },
  {
    name: 'getGatheringInteractionView 投影出 { ruleId, dungeonInteractionMinutes }',
    run: () => {
      const reader = createDungeonDefinitionReader(registry());
      const player = reader.getGatheringInteractionView(FIXTURE.gatheringRulePlayer);
      assert(player.dungeonInteractionMinutes === 15, `玩家採集分鐘（實得 ${player.dungeonInteractionMinutes}）`);
      assert(String(player.ruleId) === String(FIXTURE.gatheringRulePlayer), 'ruleId 應原樣帶回');
      const npc = reader.getGatheringInteractionView(FIXTURE.gatheringRuleNpc);
      assert(npc.dungeonInteractionMinutes === 10, `NPC 採集分鐘（實得 ${npc.dungeonInteractionMinutes}）`);
    },
  },
  {
    name: '未知 id 明確拋錯（不靜默回 undefined）',
    run: () => {
      const reader = createDungeonDefinitionReader(registry());
      let threw = false;
      try {
        reader.getDungeonInteractionRule('definition:interaction-rule:absent' as never);
      } catch {
        threw = true;
      }
      assert(threw, '未知 id 應拋錯');
    },
  },
  {
    name: '跨 kind 存取明確拋錯（interaction reader 不得取到 gathering 定義）',
    run: () => {
      const reader = createDungeonDefinitionReader(registry());
      let threw = false;
      try {
        // gatheringRulePlayer 的 kind 是 gathering-rule，不屬 interaction reader 的 ownedKinds。
        reader.getDungeonInteractionRule(FIXTURE.gatheringRulePlayer as never);
      } catch {
        threw = true;
      }
      assert(threw, '跨 kind 存取應拋錯');
    },
  },
  {
    name: '端到端：真 reader 換進 Session，openDungeonDoor 仍開門（真交易裡供給 redDoorOpenMinutes）',
    run: () => {
      const assembler = makeAssembler({ dungeonReader: createDungeonDefinitionReader(registry()) });
      const result = runGameCommand(baseState(), openRedDoor, assembler);
      assert(result.accepted, `交易應被接受（實得 ${result.accepted ? 'accepted' : 'rejected'}）`);
      if (!result.accepted) return;
      const door = requireInstance(result.state.map, FIXTURE.mapId).spatialRuntime.doorStates[
        FIXTURE.redDoorLink
      ]!;
      assert(door.state === 'open', `紅門應被開啟（實得 ${door.state}）`);
      // redDoorOpenMinutes=20 來自真 reader → Session 前進 20 分鐘。
      const session = result.state.dungeon.playerSessions[FIXTURE.teamId]!;
      assert(session.elapsedDungeonMinutes === 20, `Session 應前進 20 分鐘（實得 ${session.elapsedDungeonMinutes}）`);
    },
  },
];

export function runTestResults(): readonly ReaderTestResult[] {
  return CASES.map((c) => {
    try {
      c.run();
      return { name: c.name, pass: true };
    } catch (e) {
      return { name: c.name, pass: false, error: e instanceof Error ? e.message : String(e) };
    }
  });
}

export function runTests(): void {
  const results = runTestResults();
  const failed = results.filter((r) => !r.pass);
  if (failed.length > 0) {
    const lines = failed.map((r) => `  - ${r.name}: ${r.error ?? ''}`).join('\n');
    throw new Error(`dungeon-reader tests failed (${failed.length}/${results.length}):\n${lines}`);
  }
}
