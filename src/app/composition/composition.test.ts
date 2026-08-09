// app/composition/composition.test.ts
// Composition 層的啟動驗證測試（12_engine_runtime.md §11 第 10 項：
// 「Module Registry 對重複 Handler、缺少 Handler、重複 Slice owner 於啟動時失敗」）。
//
// 這是第一個**跨模組**的驗證：Wave B 的每個模組只測自己 + 自己的 stub，沒有人比對過
// 「A 宣告會發的訊息，B 真的有註冊處理嗎」。註冊面漂移在這裡被擋下。
//
// 自足式：無外部框架、無 node/DOM 全域。

import { validateRegistry, MODULE_CONTRACTS } from './registry';
import { EXECUTION_ORDER_MANIFEST, validateManifest } from './manifest';
import { GAME_COMMAND_ENTRY, WORKFLOW_ENTRY, INTERNAL_COMMAND_OWNER } from './messages';
import { applyMutation, createEmptyGameState, IMPLEMENTED_SLICES, SLICE_OWNER } from './state';
import type { GameState } from './state';
import { createTeamState } from '../../modules/team/public';
import type { TeamId } from '../../contracts/core';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const PLAYER_TEAM = 'runtime:team~test~0' as TeamId;

function emptyState(): GameState {
  return createEmptyGameState({
    worldSeed: 'composition-test',
    // 只需要一個能通過型別的最小 team slice；本檔測的是註冊面，不是隊伍規則。
    team: createTeamState({ playerTeamId: PLAYER_TEAM }),
  });
}

export type CompositionTestResult = Readonly<{ name: string; pass: boolean; error?: string }>;

const CASES: readonly Readonly<{ name: string; run: () => void }>[] = [
  {
    name: 'registry 與 manifest 完全自洽（0 診斷）',
    run: () => {
      const diagnostics = validateRegistry();
      assert(
        diagnostics.length === 0,
        `啟動驗證應無診斷，實得 ${diagnostics.length} 筆:\n` +
          diagnostics.map((d) => `  [${d.code}] ${d.detail}`).join('\n'),
      );
    },
  },
  {
    name: '每個 Slice 恰好一個 owner，且與模組宣告一致',
    run: () => {
      const owners = new Set(MODULE_CONTRACTS.map((c) => c.owns as string));
      assert(
        owners.size === MODULE_CONTRACTS.length,
        'Slice owner 有重複（模組數與相異 Slice 數不符）',
      );
      for (const slice of IMPLEMENTED_SLICES) {
        const owner = SLICE_OWNER[slice];
        const contract = MODULE_CONTRACTS.find((c) => c.id === owner);
        assert(contract !== undefined, `Slice "${slice}" 的 owner "${owner}" 沒有註冊 ModuleContract`);
        assert(
          (contract!.owns as string) === slice,
          `模組 "${owner}" 宣告擁有 "${contract!.owns}"，與 SLICE_OWNER 的 "${slice}" 不符`,
        );
      }
    },
  },
  {
    name: '每個 Game Command 恰好一個入口（模組 Handler 或 Workflow，不可兼有）',
    run: () => {
      for (const [type, entry] of Object.entries(GAME_COMMAND_ENTRY)) {
        if (entry === WORKFLOW_ENTRY) {
          const claimed = MODULE_CONTRACTS.filter((c) =>
            (c.handlesGameCommands as readonly string[]).includes(type),
          );
          assert(
            claimed.length === 0,
            `"${type}" 入口是 Workflow，但模組 ${claimed.map((c) => c.id).join('/')} 也註冊了它（§5.1 禁止兼有）`,
          );
          continue;
        }
        const claimed = MODULE_CONTRACTS.filter((c) =>
          (c.handlesGameCommands as readonly string[]).includes(type),
        );
        assert(claimed.length === 1, `"${type}" 應恰好一個模組註冊，實得 ${claimed.length}`);
        assert(claimed[0]!.id === entry, `"${type}" 的入口表是 "${entry}"，實際註冊者是 "${claimed[0]!.id}"`);
      }
    },
  },
  {
    name: '每筆 Internal Command 恰好一個 Handler',
    run: () => {
      for (const [type, owner] of Object.entries(INTERNAL_COMMAND_OWNER)) {
        const claimed = MODULE_CONTRACTS.filter((c) =>
          (c.handlesInternalCommands as readonly string[]).includes(type),
        );
        assert(claimed.length === 1, `"${type}" 應恰好一個 Handler，實得 ${claimed.length}`);
        assert(claimed[0]!.id === owner, `"${type}" owner 表為 "${owner}"，實際為 "${claimed[0]!.id}"`);
      }
    },
  },
  {
    name: 'manifest 偵測得到重複 Job type',
    run: () => {
      const broken = {
        ...EXECUTION_ORDER_MANIFEST,
        jobTypeOrderByPhase: {
          ...EXECUTION_ORDER_MANIFEST.jobTypeOrderByPhase,
          // 故意讓 teamPlanDue 同時出現在兩個 phase。
          closeDeadline: ['teamPlanDue'] as const,
        },
      } as typeof EXECUTION_ORDER_MANIFEST;
      const diagnostics = validateManifest(broken, ['teamPlanDue']);
      assert(
        diagnostics.some((d) => d.code === 'manifest.jobType.duplicate'),
        '重複 Job type 應被偵測',
      );
    },
  },
  {
    name: 'applyMutation 拒絕寫入 core',
    run: () => {
      let threw = false;
      try {
        applyMutation(emptyState(), { sliceName: 'core', nextSlice: {} });
      } catch {
        threw = true;
      }
      assert(threw, 'core 由 Kernel 獨占寫入，applyMutation 必須拒絕');
    },
  },
  {
    name: 'applyMutation 拒絕未註冊的 Slice',
    run: () => {
      let threw = false;
      try {
        applyMutation(emptyState(), { sliceName: 'economy', nextSlice: {} });
      } catch {
        threw = true;
      }
      assert(threw, '未註冊 Slice 必須丟錯，不得靜默忽略');
    },
  },
  {
    name: 'applyMutation 只替換目標 Slice，其餘保持同一參照',
    run: () => {
      const s0 = emptyState();
      const nextCombat = { encounters: {} };
      const s1 = applyMutation(s0, { sliceName: 'combat', nextSlice: nextCombat });
      assert(s1.combat === nextCombat, 'combat 應被替換');
      assert(s1.character === s0.character, 'character 不應被動到');
      assert(s1.core === s0.core, 'core 不應被動到');
      assert(s1 !== s0, '應回傳新物件（不可就地修改）');
    },
  },
];

export function runTestResults(): readonly CompositionTestResult[] {
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
    throw new Error(`composition tests failed (${failed.length}/${results.length}):\n${lines}`);
  }
}
