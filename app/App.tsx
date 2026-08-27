// app/App.tsx — 問候冒險者 第一版可玩畫面（雲華）。
//
// 這是 F4 的最小城市畫面：開一個真實的新遊戲（core + 雲華 pack），顯示隊長與所在城市，
// 讓玩家下「休息」指令、並「推進時間」讓計畫完成。每一個動作都真的經過
// NewGameBootstrapper → GameSession → 模組 Handler，用作者寫的內容算出結果。
//
// 目前只接了 team 層（rest / travel）。地城、戰鬥、委託等隨 F3 逐模組接上後會出現在這裡。

import { useMemo, useState } from 'react';
import {
  createGame,
  type GameHandle,
  type GameView,
} from './engine/game-facade';
import type { CityId } from '../src/contracts/core';
import type { NewGameConfig } from '../src/app/composition/new-game-bootstrap';
import type { GameCommand } from '../src/app/composition/messages';

// 開新遊戲的預設選擇（未來由開新遊戲畫面提供）：雲華主角、首都雲京、開局即成年。
const DEFAULT_CONFIG: NewGameConfig = {
  worldSeed: 'greeting-adventurer-v1',
  startDay: 8000,
  startingArchetypeId: 'character-archetype.core.player-lineage' as never,
  startCityId: 'city-node.yunhua.yunjing' as CityId,
  leaderSex: 'female',
  leaderBirthDay: 0,
};

type LogLine = Readonly<{ id: number; text: string; tone: 'info' | 'ok' | 'warn' }>;

const S = {
  page: { fontFamily: '"Segoe UI", "Microsoft JhengHei", system-ui, sans-serif', maxWidth: 720, margin: '0 auto', padding: 24, color: '#1a1a1a' } as const,
  h1: { fontSize: 22, margin: '0 0 2px' } as const,
  sub: { color: '#666', fontSize: 13, margin: '0 0 20px' } as const,
  card: { border: '1px solid #ddd', borderRadius: 10, padding: 16, marginBottom: 16, background: '#fafafa' } as const,
  row: { display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid #eee' } as const,
  label: { color: '#666' } as const,
  btnRow: { display: 'flex', gap: 10, flexWrap: 'wrap' as const, marginBottom: 16 },
  btn: { padding: '10px 16px', borderRadius: 8, border: '1px solid #3a6ea5', background: '#3a6ea5', color: '#fff', cursor: 'pointer', fontSize: 14 } as const,
  log: { fontFamily: 'Consolas, monospace', fontSize: 12, background: '#111', color: '#ddd', borderRadius: 8, padding: 12, height: 160, overflowY: 'auto' as const },
  err: { border: '1px solid #c33', background: '#fdecea', color: '#a00', borderRadius: 10, padding: 16 } as const,
};

export function App(): JSX.Element {
  // 開新遊戲一次；失敗（缺內容）就顯示診斷而不是白屏。
  const init = useMemo(() => {
    try {
      return { handle: createGame(DEFAULT_CONFIG), error: undefined as string | undefined };
    } catch (e) {
      return { handle: undefined as GameHandle | undefined, error: e instanceof Error ? e.message : String(e) };
    }
  }, []);

  const [view, setView] = useState<GameView | undefined>(init.handle?.view);
  const [log, setLog] = useState<readonly LogLine[]>(
    init.handle ? [{ id: 0, text: '新遊戲已開始（雲華 · 雲京）。', tone: 'info' }] : [],
  );
  const nextId = useState({ n: 1 })[0];
  const append = (text: string, tone: LogLine['tone']): void =>
    setLog((prev) => [...prev, { id: nextId.n++, text, tone }]);

  if (init.error !== undefined || init.handle === undefined || view === undefined) {
    return (
      <div style={S.page}>
        <h1 style={S.h1}>問候冒險者</h1>
        <div style={S.err}>
          <strong>無法開始遊戲。</strong>
          <div style={{ marginTop: 8, fontFamily: 'Consolas, monospace', fontSize: 12 }}>{init.error}</div>
        </div>
      </div>
    );
  }
  const handle = init.handle;

  const doCommand = (command: GameCommand, label: string): void => {
    const r = handle.runCommand(command);
    setView(r.view);
    if (r.accepted) append(`✓ ${label}`, 'ok');
    else append(`✗ ${label} 被拒：${r.rejectionCode}`, 'warn');
  };

  const doAdvance = (): void => {
    const r = handle.advanceTime();
    setView(r.view);
    if (r.advanced) append(`⏩ 時間推進到第 ${r.toDay} 日（${r.jobType} 完成）`, 'ok');
    else append(`⏸ ${r.reason}`, 'warn');
  };

  return (
    <div style={S.page}>
      <h1 style={S.h1}>問候冒險者 · Greeting Adventurer</h1>
      <p style={S.sub}>第一版可玩切片（雲華）· 資料驅動引擎在真實內容包上運行</p>

      <div style={S.card}>
        <div style={S.row}><span style={S.label}>世界日</span><span>第 {view.worldDay} 日</span></div>
        <div style={S.row}><span style={S.label}>所在城市</span><span>{view.cityId}</span></div>
        <div style={S.row}><span style={S.label}>隊長</span><span>{view.leader ? `${view.leader.archetypeId}（${view.leader.sex}）` : '—'}</span></div>
        <div style={S.row}><span style={S.label}>生命 / 魔力</span><span>{view.leader ? `${view.leader.health} / ${view.leader.mana}` : '—'}</span></div>
        <div style={S.row}><span style={S.label}>隊伍人數</span><span>{view.memberCount}</span></div>
        <div style={{ ...S.row, borderBottom: 'none' }}><span style={S.label}>排定中的事件</span><span>{view.scheduledJobs}</span></div>
      </div>

      <div style={S.btnRow}>
        <button style={S.btn} onClick={() => doCommand({ type: 'rest', planKind: 'cityFacilityAction' }, '在城裡休息')}>
          在城裡休息
        </button>
        <button style={S.btn} onClick={doAdvance}>推進時間 ⏩</button>
      </div>

      <div style={S.log}>
        {log.map((l) => (
          <div key={l.id} style={{ color: l.tone === 'ok' ? '#8f8' : l.tone === 'warn' ? '#fc8' : '#ddd' }}>
            {l.text}
          </div>
        ))}
      </div>

      <p style={{ ...S.sub, marginTop: 16 }}>
        目前已接：team 層（休息 / 城市旅行）。地城、戰鬥、委託、招募等隨引擎逐模組接線後會加入。
      </p>
    </div>
  );
}
