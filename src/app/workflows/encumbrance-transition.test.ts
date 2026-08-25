// app/workflows/encumbrance-transition.test.ts
// 自足式單元測試（無外部框架）。runTests() 逐案執行，任一失敗即 throw。
//
// 這支 Workflow 的存在理由本身就是「有 Handler 但沒人送命令」，所以它最不能重蹈的就是
// 「有 Workflow 但沒人驗證它真的送出命令」。

import type { CharacterId, TeamId, TransactionMessageDraft } from '../../contracts/core';
import type { GameState } from '../composition/state';
import { onInventoryTransferred, onItemInstanceCreated } from './encumbrance-transition';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const TEAM = 'runtime:team:player' as TeamId;
const MEMBER = 'runtime:character:hero' as CharacterId;
const TEMP_MEMBER = 'runtime:character:rescued' as CharacterId;
const OUTSIDER = 'runtime:character:world-npc' as CharacterId;

// 只建 workflow 真正會讀到的那一塊 state：team slice 的隊伍表。
function stateWithTeam(): GameState {
  return {
    team: {
      playerTeamId: TEAM,
      teams: {
        [TEAM]: {
          teamId: TEAM,
          control: 'player',
          memberIds: [MEMBER],
          temporaryMemberIds: [TEMP_MEMBER],
          leaderId: MEMBER,
          location: { kind: 'city', cityId: 'city-a' },
          revision: 0,
        },
      },
      plans: {},
      formations: {},
      retention: {},
      freeActions: {},
      recentActivity: {},
      pendingSuccession: undefined,
      pendingTravelInteractions: {},
    },
  } as unknown as GameState;
}

function commandsOf(outgoing: readonly TransactionMessageDraft[]): { type: string; teamId: string }[] {
  const out: { type: string; teamId: string }[] = [];
  for (const m of outgoing) {
    const cmd = (m as { command?: { type?: string; teamId?: string } }).command;
    if (cmd?.type !== undefined && cmd.teamId !== undefined) {
      out.push({ type: cmd.type, teamId: String(cmd.teamId) });
    }
  }
  return out;
}

const bag = (characterId: CharacterId) => ({ kind: 'characterBag' as const, characterId });
const cityStock = { kind: 'cityPermanentStock' as const, cityId: 'city-a' };

type Case = Readonly<{ name: string; run: () => void }>;

const cases: readonly Case[] = [
  {
    name: '物品建立在成員背包 → 送出該隊的 EvaluateTeamEncumbrance',
    run: () => {
      const out = onItemInstanceCreated({ location: bag(MEMBER) }, stateWithTeam());
      const cmds = commandsOf(out.outgoing);
      assert(cmds.length === 1, `should send exactly one command, got ${cmds.length}`);
      assert(cmds[0]!.type === 'EvaluateTeamEncumbrance', `wrong command: ${cmds[0]!.type}`);
      assert(cmds[0]!.teamId === String(TEAM), `wrong team: ${cmds[0]!.teamId}`);
    },
  },
  {
    // 暫時成員（救出後隨隊的救援角色）背的東西也算進隊伍攜帶總量。
    name: '暫時成員的背包同樣觸發重算',
    run: () => {
      const out = onItemInstanceCreated({ location: bag(TEMP_MEMBER) }, stateWithTeam());
      assert(commandsOf(out.outgoing).length === 1, 'temporary member should also trigger');
    },
  },
  {
    name: '不在任何隊伍的角色 → 不送（沒有隊伍超載可算，這不是缺資料）',
    run: () => {
      const out = onItemInstanceCreated({ location: bag(OUTSIDER) }, stateWithTeam());
      assert(commandsOf(out.outgoing).length === 0, 'outsider must not trigger a team evaluation');
    },
  },
  {
    name: '非角色背包的位置 → 不送（城市庫存不在任何人身上）',
    run: () => {
      const out = onItemInstanceCreated({ location: cityStock }, stateWithTeam());
      assert(commandsOf(out.outgoing).length === 0, 'city stock must not trigger');
    },
  },
  {
    // 只算目的地是不夠的：物品離開背包時，隊伍可能從超載變成不超載，而那筆變化只有來源側看得到。
    name: '移出背包（來源側）也要重算',
    run: () => {
      const out = onInventoryTransferred({ from: bag(MEMBER), to: cityStock }, stateWithTeam());
      const cmds = commandsOf(out.outgoing);
      assert(cmds.length === 1, `moving out must still evaluate, got ${cmds.length}`);
      assert(cmds[0]!.teamId === String(TEAM), 'should evaluate the source carrier team');
    },
  },
  {
    name: '同隊內部搬動 → 只送一筆（去重，不隨人數膨脹）',
    run: () => {
      const out = onInventoryTransferred(
        { from: bag(MEMBER), to: bag(TEMP_MEMBER) },
        stateWithTeam(),
      );
      const cmds = commandsOf(out.outgoing);
      assert(
        cmds.length === 1,
        `same team on both sides must dedupe to one command, got ${cmds.length}`,
      );
    },
  },
];

export type EncumbranceWorkflowTestResult = Readonly<{
  name: string;
  passed: boolean;
  error?: string;
}>;

export function runTestResults(): readonly EncumbranceWorkflowTestResult[] {
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
    throw new Error(
      `encumbrance-transition workflow: ${failures.length}/${results.length} test(s) failed\n${lines.join('\n')}`,
    );
  }
}
