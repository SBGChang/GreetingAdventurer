// app/App.tsx — 問候冒險者 可玩外殼。
//
// 三個畫面，都跑在真實引擎上：
//   主城      設施選單（內容宣告的十種設施）＋ 隊伍狀態
//   世界地圖  出城 → 鄰近城市拓樸 → 選行進方式 → 真的走過去（3/6/9 日，分段推進）
//   選冒險地  去冒險 → 本城的冒險據點清單
//
// 所有動作都經 `runGameCommand(state, request, assembler)` 這唯一入口，UI 不碰模組 Handler
// 或 Slice（f3_work_packages.md P11 的接法要求）。
//
// 顯示文字一律由 `LocalizedTextRef` 經 `resolveText()` 解析，UI 自己的介面字走 `app/i18n.ts`。
// 這裡沒有任何寫死的遊戲名詞——城市、設施、據點的名字全部來自 Content Pack。

import { useMemo, useState } from 'react';
import {
  createGame,
  CAPABILITIES,
  type GameHandle,
  type FacilityAction,
  type GameView,
  type FacilityView,
} from './engine/game-facade';
import { t, UI_LOCALES, UI_TEXT, type UiLocale, type UiTextKey } from './i18n';
import type { CityId, LocalizedTextRef } from '../src/contracts/core';
import type { NewGameConfig } from '../src/app/composition/new-game-bootstrap';
import type { GameCommand } from '../src/app/composition/messages';

// 開新遊戲的預設選擇（未來由開新遊戲畫面提供）：雲華主角、首都雲京、開局 25 歲。
//
// `startDay` 是**世界曆的第幾天**，不是「世界剛開始」。它有一條硬下界：開局生成的世界冒險者
// 最大 35 歲（見 content-source/core/character.ts 的起始年齡 params），而沒有人能在第 0 日
// 之前出生——所以 startDay 必須 ≥ 35 × 365 = 12775。取 40 年（14600）留下餘裕。
const DEFAULT_CONFIG: NewGameConfig = {
  worldSeed: 'greeting-adventurer-v1',
  startDay: 14600,
  startingArchetypeId: 'character-archetype.core.player-lineage' as never,
  startCityId: 'city-node.yunhua.yunjing' as CityId,
  leaderSex: 'female',
  leaderBirthDay: 5475,
  // 開局金錢。500 只夠買雜貨——買不起最小的房子（4000），而委託結算（唯一的收入來源）
  // 還沒接線，於是「家」這一格看得到卻永遠摸不到。5000 讓十格全部都真的走得完，同時
  // 4／6 格的房子（12000／28000）仍然是目標。收入一接上就該把這個數字調回去。
  startingMoney: 5000,
};

type Screen = 'city' | 'worldMap' | 'adventure' | 'shop' | 'home' | 'training' | 'tavern' | 'guild';

// 日誌條目存**引用**，不存已翻譯字串（15_ui_application.md §10 的同一條理由：把翻譯結果存進
// state，切語系時就換不掉了）。內容名稱以 LocalizedTextRef 帶著，render 當下才解析。
type LogEntry =
  | Readonly<{ kind: 'newGame' }>
  | Readonly<{ kind: 'travelStarted'; place: LocalizedTextRef }>
  | Readonly<{ kind: 'arrived'; place: LocalizedTextRef }>
  | Readonly<{ kind: 'rested'; place: LocalizedTextRef }>
  | Readonly<{ kind: 'daysPassed'; days: number; day: number }>
  | Readonly<{ kind: 'settleBlocked'; code: string }>
  | Readonly<{ kind: 'actionRejected'; action: LocalizedTextRef; code: string }>
  | Readonly<{ kind: 'jobBlocked'; code: string }>
  | Readonly<{ kind: 'enteredSite'; place: LocalizedTextRef }>
  | Readonly<{ kind: 'exploreStarted'; place: LocalizedTextRef }>
  | Readonly<{ kind: 'movedPlain'; room: string }>
  | Readonly<{ kind: 'doorOpened' }>
  | Readonly<{ kind: 'leftDungeon' }>
  | Readonly<{ kind: 'bought'; item: string; price: number }>
  | Readonly<{ kind: 'homeBought'; place: LocalizedTextRef; slots: number; price: number }>
  | Readonly<{ kind: 'freePeriodBegan' }>
  | Readonly<{ kind: 'trainingStarted'; mastery: string; days: number }>
  | Readonly<{ kind: 'recruitSucceeded'; who: string }>
  | Readonly<{ kind: 'recruitFailed'; who: string }>
  | Readonly<{ kind: 'questAccepted'; quest: string }>;

type LogLine = Readonly<{ id: number; entry: LogEntry; tone: 'info' | 'ok' | 'warn' }>;

const C = {
  ink: '#1f2328',
  dim: '#6b7280',
  line: '#e2e5e9',
  panel: '#fbfbfc',
  accent: '#3a6ea5',
  warn: '#b45309',
};

const S = {
  page: {
    fontFamily: '"Segoe UI", "Microsoft JhengHei", system-ui, sans-serif',
    maxWidth: 860,
    margin: '0 auto',
    padding: '24px 24px 40px',
    color: C.ink,
  } as const,
  head: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 } as const,
  h1: { fontSize: 22, margin: '0 0 2px' } as const,
  sub: { color: C.dim, fontSize: 13, margin: 0 } as const,
  card: { border: `1px solid ${C.line}`, borderRadius: 10, padding: 16, marginBottom: 16, background: C.panel } as const,
  row: { display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: `1px solid ${C.line}` } as const,
  label: { color: C.dim } as const,
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 10 } as const,
  tile: {
    textAlign: 'left' as const,
    border: `1px solid ${C.line}`,
    borderRadius: 10,
    padding: '12px 14px',
    background: '#fff',
    cursor: 'pointer',
    font: 'inherit',
    color: C.ink,
  },
  tileOff: {
    textAlign: 'left' as const,
    border: `1px dashed ${C.line}`,
    borderRadius: 10,
    padding: '12px 14px',
    background: '#f4f5f7',
    color: C.dim,
    font: 'inherit',
    cursor: 'not-allowed',
  },
  tileName: { fontSize: 15, fontWeight: 600, display: 'block', marginBottom: 2 } as const,
  tileNote: { fontSize: 11, display: 'block' } as const,
  btn: {
    padding: '9px 15px',
    borderRadius: 8,
    border: `1px solid ${C.accent}`,
    background: C.accent,
    color: '#fff',
    cursor: 'pointer',
    fontSize: 14,
    font: 'inherit',
  } as const,
  btnGhost: {
    padding: '9px 15px',
    borderRadius: 8,
    border: `1px solid ${C.line}`,
    background: '#fff',
    color: C.ink,
    cursor: 'pointer',
    fontSize: 14,
    font: 'inherit',
  } as const,
  btnRow: { display: 'flex', gap: 10, flexWrap: 'wrap' as const, marginBottom: 16 },
  log: {
    fontFamily: 'Consolas, monospace',
    fontSize: 12,
    background: '#14171a',
    color: '#dde',
    borderRadius: 8,
    padding: 12,
    height: 150,
    overflowY: 'auto' as const,
  },
  err: { border: '1px solid #c33', background: '#fdecea', color: '#a00', borderRadius: 10, padding: 16 } as const,
  chip: { fontSize: 11, color: C.warn, border: `1px solid ${C.warn}33`, background: '#fff7ed', borderRadius: 999, padding: '1px 7px' } as const,
};

export function App(): JSX.Element {
  const init = useMemo(() => {
    try {
      return { handle: createGame(DEFAULT_CONFIG), error: undefined as string | undefined };
    } catch (e) {
      return { handle: undefined as GameHandle | undefined, error: e instanceof Error ? e.message : String(e) };
    }
  }, []);

  const [locale, setLocale] = useState<UiLocale>('zh-Hant');
  const [screen, setScreen] = useState<Screen>('city');
  const [shopFacilityId, setShopFacilityId] = useState<string | undefined>(undefined);
  const [trainFacilityId, setTrainFacilityId] = useState<string | undefined>(undefined);
  const [view, setView] = useState<GameView | undefined>(init.handle?.view);
  const [log, setLog] = useState<readonly LogLine[]>([]);
  const nextId = useState({ n: 1 })[0];
  // 同一次點擊可能連送兩個指令（例如「去冒險」＝入圖＋開始探索）。React 的 `view` 在那之間
  // 還沒重繪，所以「過了幾天／到了哪裡」必須跟著 handle 的實際狀態走，不能讀 state 的舊值。
  const progress = useState({
    day: init.handle?.view.worldDay ?? 0,
    cityId: init.handle?.view.location.kind === 'city' ? init.handle.view.location.cityId : undefined as string | undefined,
  })[0];

  const append = (entry: LogEntry, tone: LogLine['tone']): void =>
    setLog((prev) => [...prev.slice(-40), { id: nextId.n++, entry, tone }]);

  if (init.error !== undefined || init.handle === undefined || view === undefined) {
    return (
      <div style={S.page}>
        <h1 style={S.h1}>{t(locale, 'ui.app.title')}</h1>
        <div style={S.err}>
          <strong>{t(locale, 'ui.error.cannotStart')}</strong>
          <div style={{ marginTop: 8, fontFamily: 'Consolas, monospace', fontSize: 12 }}>{init.error}</div>
        </div>
      </div>
    );
  }
  const handle = init.handle;

  // 缺字時顯示明確的缺字標記，不顯示 key 本身也不留空——空白會讓「漏翻譯」看起來像設計。
  const text = (ref: LocalizedTextRef): string =>
    handle.resolveText(locale, ref) ?? t(locale, 'ui.error.missingText', { key: ref.key });

  // 成功與失敗各自帶自己的條目形狀：成功要說「做了什麼」，失敗要說「哪個動作、被什麼擋住」。
  //
  // 指令被接受後，世界已經在 facade 裡結算完畢（時間是動作的後果，不是另一個按鈕）。
  // 這裡只把「過了幾天」敘述出來——玩家看到的是日子流逝，不是 scheduler。
  // `onAccepted` 可以是**一個函式**：擲骰型的指令（招募）不論成敗都會被接受，「發生了什麼」
  // 只能從結果狀態看出來，所以敘述要在拿到新 view 之後才決定。
  const dispatch = (
    command: GameCommand,
    onAccepted: LogEntry | ((view: GameView) => LogEntry),
    subject: LocalizedTextRef,
  ): boolean => {
    const before = progress.day;
    const wasCity = progress.cityId;
    const r = handle.runCommand(command);
    setView(r.view);
    if (!r.accepted) {
      append({ kind: 'actionRejected', action: subject, code: r.rejectionCode }, 'warn');
      return false;
    }
    append(typeof onAccepted === 'function' ? onAccepted(r.view) : onAccepted, 'ok');
    const elapsed = r.view.worldDay - before;
    if (elapsed > 0) {
      append({ kind: 'daysPassed', days: elapsed, day: r.view.worldDay }, 'info');
    }
    // 抵達：旅行現在整段在同一個指令裡走完，所以「之前也在城市」不代表沒有移動——
    // 必須比對是不是**同一座**城市。
    if (r.view.location.kind === 'city' && r.view.location.cityId !== wasCity) {
      append({ kind: 'arrived', place: r.view.location.nameRef }, 'info');
    }
    progress.day = r.view.worldDay;
    progress.cityId = r.view.location.kind === 'city' ? r.view.location.cityId : undefined;
    if (r.blocked !== undefined) append({ kind: 'settleBlocked', code: r.blocked }, 'warn');
    return true;
  };


  // 設施 → 按下去發生什麼。非 Partial 的 Record：facade 新增一種 FacilityAction 而這裡沒接，
  // 就是編譯錯誤，而不是「按了沒反應」——後者正是這份表原本是 if/else 串時發生過的事。
  const FACILITY_HANDLER: Readonly<Record<FacilityAction, (f: FacilityView) => void>> = {
    rest: (f) =>
      void dispatch(
        { type: 'rest', planKind: 'cityFacilityAction' } as GameCommand,
        { kind: 'rested', place: f.nameRef },
        f.nameRef,
      ),
    leaveCity: () => setScreen('worldMap'),
    goAdventure: () => setScreen('adventure'),
    shop: (f) => {
      setShopFacilityId(f.facilityId);
      setScreen('shop');
    },
    home: () => setScreen('home'),
    tavern: () => setScreen('tavern'),
    guild: () => setScreen('guild'),
    train: (f) => {
      setTrainFacilityId(f.facilityId);
      setScreen('training');
    },
    // `none` 是「這個設施本版沒有操作」——按鈕本來就是 disabled，走不到這裡。
    none: () => undefined,
  };

  const onFacility = (f: FacilityView): void => FACILITY_HANDLER[f.action](f);

  // 日誌條目 → 當下語系的字。這是唯一把 LogEntry 變成文字的地方。
  const renderLog = (entry: LogEntry): string => {
    switch (entry.kind) {
      case 'newGame':
        return t(locale, 'ui.log.newGame');
      case 'travelStarted':
        return t(locale, 'ui.log.travelStarted', { place: text(entry.place) });
      case 'arrived':
        return t(locale, 'ui.log.arrived', { place: text(entry.place) });
      case 'rested':
        return t(locale, 'ui.log.rested', { place: text(entry.place) });
      case 'daysPassed':
        return entry.days === 1
          ? t(locale, 'ui.log.oneDayPassed', { day: entry.day })
          : t(locale, 'ui.log.daysPassed', { days: entry.days, day: entry.day });
      case 'settleBlocked':
        return t(locale, 'ui.log.settleBlocked', { code: entry.code });
      case 'actionRejected':
        return t(locale, 'ui.log.actionRejected', { action: text(entry.action), code: entry.code });
      case 'jobBlocked':
        return t(locale, 'ui.log.jobBlocked', { code: entry.code });
      case 'enteredSite':
        return t(locale, 'ui.log.enteredSite', { place: text(entry.place) });
      case 'exploreStarted':
        return t(locale, 'ui.log.exploreStarted', { place: text(entry.place) });
      case 'movedPlain':
        return t(locale, 'ui.log.moved', { place: entry.room });
      case 'doorOpened':
        return t(locale, 'ui.log.doorOpened');
      case 'leftDungeon':
        return t(locale, 'ui.log.leftDungeon');
      case 'questAccepted':
        return t(locale, 'ui.log.questAccepted', { quest: entry.quest });
      case 'recruitSucceeded':
        return t(locale, 'ui.log.recruitSucceeded', { who: entry.who });
      case 'recruitFailed':
        return t(locale, 'ui.log.recruitFailed', { who: entry.who });
      case 'freePeriodBegan':
        return t(locale, 'ui.log.freePeriodBegan');
      case 'trainingStarted':
        return t(locale, 'ui.log.trainingStarted', { mastery: entry.mastery, days: entry.days });
      case 'homeBought':
        return t(locale, 'ui.log.homeBought', {
          place: text(entry.place),
          slots: entry.slots,
          price: entry.price,
        });
      case 'bought':
        return t(locale, 'ui.log.bought', { item: entry.item, price: entry.price });
    }
  };

  const city = view.city;
  // 先把「在冒險地」這個分支窄化出來：在 callback 裡再讀 view.location 會失去判別。
  const atMap = view.location.kind === 'adventureMap' ? view.location : undefined;
  const locationLabel =
    view.location.kind === 'city'
      ? text(view.location.nameRef)
      : view.location.kind === 'travelling'
        ? `${t(locale, 'ui.status.travelling')} (${view.location.segmentIndex + 1}/3)`
        : view.location.kind === 'adventureMap'
          ? text(view.location.siteNameRef)
          : view.location.homeId;

  return (
    <div style={S.page}>
      <div style={S.head}>
        <div>
          <h1 style={S.h1}>{t(locale, 'ui.app.title')}</h1>
          <p style={S.sub}>{t(locale, 'ui.app.subtitle')}</p>
        </div>
        <label style={{ fontSize: 12, color: C.dim }}>
          {t(locale, 'ui.locale.label')}{' '}
          <select
            value={locale}
            onChange={(e) => setLocale(e.target.value as UiLocale)}
            style={{ font: 'inherit', padding: '3px 6px', borderRadius: 6, border: `1px solid ${C.line}` }}
          >
            {UI_LOCALES.map((l) => (
              <option key={l} value={l}>
                {l === 'zh-Hant' ? '繁體中文' : 'English'}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div style={{ ...S.card, marginTop: 16 }}>
        <div style={S.row}>
          <span style={S.label}>{t(locale, 'ui.status.worldDay')}</span>
          <span>{t(locale, 'ui.status.day', { day: view.worldDay })}</span>
        </div>
        <div style={S.row}>
          <span style={S.label}>{t(locale, 'ui.status.location')}</span>
          <span>
            {locationLabel}
            {city?.isCapital === true ? <span style={{ ...S.chip, marginLeft: 6 }}>{t(locale, 'ui.worldMap.capital')}</span> : null}
          </span>
        </div>
        <div style={S.row}>
          <span style={S.label}>{t(locale, 'ui.status.health')}</span>
          <span>{view.leader ? `${view.leader.health} / ${view.leader.mana}` : '—'}</span>
        </div>
        <div style={{ ...S.row, borderBottom: 'none' }}>
          <span style={S.label}>{t(locale, 'ui.status.busy')}</span>
          <span>{t(locale, 'ui.status.free')}</span>
        </div>
      </div>

      {screen !== 'city' ? (
        <div style={S.btnRow}>
          <button style={S.btnGhost} onClick={() => setScreen('city')}>
            {t(locale, 'ui.action.back')}
          </button>
        </div>
      ) : null}

      {/* ── 主城 ─────────────────────────────────────────────── */}
      {screen === 'city' && city !== undefined ? (
        <>
          <h2 style={{ fontSize: 15, margin: '0 0 10px' }}>{t(locale, 'ui.screen.city')}</h2>
          <div style={S.grid}>
            {city.facilities.map((f) =>
              f.action === 'none' ? (
                <div key={f.facilityId} style={S.tileOff} title={t(locale, 'ui.facility.unavailableHint')}>
                  <span style={S.tileName}>{text(f.nameRef)}</span>
                  <span style={S.tileNote}>
                    {t(locale, 'ui.facility.unavailable')}
                    {f.blockedBy === undefined ? '' : ` · ${t(locale, f.blockedBy)}`}
                  </span>
                </div>
              ) : (
                <button key={f.facilityId} style={S.tile} onClick={() => onFacility(f)}>
                  <span style={S.tileName}>{text(f.nameRef)}</span>
                  <span style={{ ...S.tileNote, color: C.accent }}>
                    {f.action === 'rest'
                      ? t(locale, 'ui.action.rest')
                      : f.action === 'leaveCity'
                        ? t(locale, 'ui.action.leaveCity')
                        : f.action === 'goAdventure'
                          ? t(locale, 'ui.action.goAdventure')
                          : f.action === 'guild'
                            ? t(locale, 'ui.action.guild')
                            : f.action === 'tavern'
                            ? t(locale, 'ui.action.tavern')
                            : f.action === 'train'
                            ? t(locale, 'ui.action.train')
                            : f.action === 'home'
                            ? t(locale, 'ui.action.home')
                            : t(locale, 'ui.action.shop')}
                  </span>
                </button>
              ),
            )}
          </div>
        </>
      ) : null}

      {/* ── 世界地圖 ──────────────────────────────────────────── */}
      {screen === 'worldMap' && city !== undefined ? (
        <WorldMap
          locale={locale}
          city={city}
          currentName={locationLabel}
          text={text}
          onTravel={(routeId, toCityId, modeId, placeRef) => {
            const ok = dispatch(
              { type: 'startCityTravel', toCityId, routeId, modeId } as unknown as GameCommand,
              { kind: 'travelStarted', place: placeRef },
              placeRef,
            );
            if (ok) setScreen('city');
          }}
        />
      ) : null}

      {/* ── 選冒險地 ──────────────────────────────────────────── */}
      {screen === 'adventure' && city !== undefined ? (
        <>
          <h2 style={{ fontSize: 15, margin: '0 0 10px' }}>{t(locale, 'ui.screen.adventure')}</h2>
          {city.sites.length === 0 ? (
            <p style={S.sub}>{t(locale, 'ui.adventure.none')}</p>
          ) : (
            <div style={S.grid}>
              {city.sites.map((site) => (
                <button
                  key={site.siteId}
                  style={S.tile}
                  onClick={() => {
                    // 「去冒險」在設計上是一個意圖：去程 1 日 ＋ 迷宮分鐘 ＋ 回程 1 日
                    //（time_and_mastery_progression.md §一）。中間沒有「要不要進去」這個節拍，
                    // 所以抵達後直接開始探索，不讓玩家多按一次。
                    const ok = dispatch(
                      { type: 'enterAdventureMap', adventureSiteId: site.siteId } as unknown as GameCommand,
                      { kind: 'enteredSite', place: site.nameRef },
                      site.nameRef,
                    );
                    if (!ok) return;
                    dispatch(
                      { type: 'startPlayerExploration' } as unknown as GameCommand,
                      { kind: 'exploreStarted', place: site.nameRef },
                      site.nameRef,
                    );
                    setScreen('city');
                  }}
                >
                  <span style={S.tileName}>{text(site.nameRef)}</span>
                  <span style={{ ...S.tileNote, color: C.accent }}>
                    {site.isNationalDungeon ? `${t(locale, 'ui.adventure.national')} · ` : ''}
                    {t(locale, 'ui.action.descend')} →
                  </span>
                </button>
              ))}
            </div>
          )}
        </>
      ) : null}

      {/* ── 商店 ─────────────────────────────────────────────── */}
      {screen === 'shop' && city !== undefined ? (
        (() => {
          const shop = city.shops.find((sh) => sh.facilityId === shopFacilityId);
          if (shop === undefined) {
            return (
              <>
                <h2 style={{ fontSize: 15, margin: '0 0 10px' }}>{t(locale, 'ui.screen.shop')}</h2>
                <p style={S.sub}>{t(locale, 'ui.shop.empty')}</p>
              </>
            );
          }
          return (
            <>
              <h2 style={{ fontSize: 15, margin: '0 0 10px' }}>
                {t(locale, 'ui.screen.shop')} · {text(shop.nameRef)}
              </h2>
              <div style={{ ...S.card, marginBottom: 12 }}>
                <div style={{ ...S.row, borderBottom: 'none' }}>
                  <span style={S.label}>{t(locale, 'ui.shop.balance')}</span>
                  <span style={{ fontWeight: 600 }}>{shop.balance}</span>
                </div>
              </div>
              {city.trainings.some((tr) => tr.facilityId === shop.facilityId) ? (
                <button
                  style={{ ...S.btnGhost, marginBottom: 12 }}
                  onClick={() => {
                    setTrainFacilityId(shop.facilityId);
                    setScreen('training');
                  }}
                >
                  {t(locale, 'ui.training.here')} →
                </button>
              ) : null}
              <div style={S.grid}>
                {shop.offers.map((o) => (
                  <button
                    key={o.offerId}
                    style={o.affordable ? S.tile : S.tileOff}
                    disabled={!o.affordable}
                    onClick={() =>
                      dispatch(
                        {
                          type: 'buyShopOffer',
                          offerId: o.offerId,
                          payerCharacterId: view.leader?.id,
                          quantity: 1,
                        } as unknown as GameCommand,
                        { kind: 'bought', item: o.label, price: o.price },
                        shop.nameRef,
                      )
                    }
                  >
                    <span style={S.tileName}>{o.label}</span>
                    <span
                      style={{ ...S.tileNote, color: o.affordable ? C.accent : C.dim }}
                    >
                      {o.price} ·{' '}
                      {o.affordable ? t(locale, 'ui.shop.buy') : t(locale, 'ui.shop.tooExpensive')}
                    </span>
                  </button>
                ))}
              </div>
            </>
          );
        })()
      ) : null}

      {/* ── 冒險者公會 ───────────────────────────────────────── */}
      {screen === 'guild' && city?.guild !== undefined ? (
        (() => {
          const guild = city.guild;
          const questKindText = (kind: string): string => {
            const key = `ui.quest.kind.${kind}` as UiTextKey;
            return key in UI_TEXT ? t(locale, key) : kind;
          };
          const questTile = (q: (typeof guild.offers)[number], acceptable: boolean) => (
            <button
              key={q.questId}
              style={acceptable ? S.tile : S.tileOff}
              disabled={!acceptable}
              onClick={
                acceptable
                  ? () =>
                      dispatch(
                        { type: 'acceptQuest', questId: q.questId } as unknown as GameCommand,
                        { kind: 'questAccepted', quest: questKindText(q.kind) },
                        guild.nameRef,
                      )
                  : undefined
              }
            >
              <span style={S.tileName}>
                {questKindText(q.kind)}
                {q.siteNameRef !== undefined ? ` · ${text(q.siteNameRef)}` : ''}
              </span>
              <span style={{ ...S.tileNote, color: acceptable ? C.accent : C.dim }}>
                {t(locale, 'ui.guild.targets', { n: q.targetCount })} ·{' '}
                {acceptable
                  ? t(locale, 'ui.guild.deadline', { day: q.acceptDeadline })
                  : t(locale, 'ui.guild.endBy', { day: q.actualEndDeadline })}
              </span>
            </button>
          );
          return (
            <>
              <h2 style={{ fontSize: 15, margin: '0 0 10px' }}>
                {t(locale, 'ui.screen.guild')} · {text(guild.nameRef)}
              </h2>
              {guild.accepted.length > 0 ? (
                <>
                  <p style={{ ...S.label, margin: '0 0 6px' }}>{t(locale, 'ui.guild.accepted')}</p>
                  <div style={{ ...S.grid, marginBottom: 14 }}>
                    {guild.accepted.map((q) => questTile(q, false))}
                  </div>
                </>
              ) : null}
              <p style={{ ...S.label, margin: '0 0 6px' }}>{t(locale, 'ui.guild.board')}</p>
              {guild.offers.length === 0 ? (
                <p style={S.sub}>{t(locale, 'ui.guild.empty')}</p>
              ) : (
                <div style={S.grid}>{guild.offers.map((q) => questTile(q, true))}</div>
              )}
            </>
          );
        })()
      ) : null}

      {/* ── 酒館 ─────────────────────────────────────────────── */}
      {screen === 'tavern' && city?.tavern !== undefined ? (
        (() => {
          const tavern = city.tavern;
          return (
            <>
              <h2 style={{ fontSize: 15, margin: '0 0 10px' }}>
                {t(locale, 'ui.screen.tavern')} · {text(tavern.nameRef)}
              </h2>
              <p style={{ ...S.sub, margin: '0 0 10px' }}>{t(locale, 'ui.tavern.intro')}</p>
              {tavern.visitors.length === 0 ? (
                <p style={S.sub}>{t(locale, 'ui.tavern.empty')}</p>
              ) : (
                <div style={S.grid}>
                  {tavern.visitors.map((v) => (
                    <button
                      key={v.characterId}
                      style={tavern.teamIsFull ? S.tileOff : S.tile}
                      disabled={tavern.teamIsFull}
                      onClick={() =>
                        dispatch(
                          {
                            type: 'recruitTavernAdventurer',
                            targetCharacterId: v.characterId,
                          } as unknown as GameCommand,
                          // 招募是擲骰：指令一定被接受，成敗看那個人有沒有真的進隊。
                          (next) =>
                            next.memberCount > view.memberCount
                              ? { kind: 'recruitSucceeded', who: v.label }
                              : { kind: 'recruitFailed', who: v.label },
                          tavern.nameRef,
                        )
                      }
                    >
                      <span style={S.tileName}>{v.label}</span>
                      <span style={{ ...S.tileNote, color: tavern.teamIsFull ? C.dim : C.accent }}>
                        {t(locale, 'ui.tavern.who', {
                          sex: t(locale, v.sex === 'female' ? 'ui.sex.female' : 'ui.sex.male'),
                          age: v.ageYears,
                        })}{' '}
                        ·{' '}
                        {tavern.teamIsFull
                          ? t(locale, 'ui.tavern.teamFull')
                          : t(locale, 'ui.tavern.recruit')}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </>
          );
        })()
      ) : null}

      {/* ── 訓練 ─────────────────────────────────────────────── */}
      {screen === 'training' && city !== undefined ? (
        (() => {
          const training = city.trainings.find((tr) => tr.facilityId === trainFacilityId);
          if (training === undefined) return null;
          // 個人自由行動只在 cityFree 期間收得下（doc §3.5 不變量 1）。玩家不必知道這件事，
          // 所以還沒在自由期時先替他開一段——但**照樣寫進日誌**，因為那是世界裡真的發生的事。
          const startTraining = (o: (typeof training.options)[number]): void => {
            if (view.activePlanKind !== 'cityFree') {
              const opened = dispatch(
                { type: 'beginCityFreePeriod' } as GameCommand,
                { kind: 'freePeriodBegan' },
                training.nameRef,
              );
              if (!opened) return;
            }
            dispatch(
              {
                type: 'chooseCityFreeAction',
                memberId: view.leader?.id,
                ruleId: training.ruleId,
                payload: { kind: 'train', masteryId: o.masteryId },
              } as unknown as GameCommand,
              { kind: 'trainingStarted', mastery: o.label, days: training.requiredDays },
              training.nameRef,
            );
            setScreen('city');
          };
          return (
            <>
              <h2 style={{ fontSize: 15, margin: '0 0 10px' }}>
                {t(locale, 'ui.screen.training')} · {text(training.nameRef)}
              </h2>
              <p style={{ ...S.sub, margin: '0 0 10px' }}>
                {t(locale, 'ui.training.intro', { days: training.requiredDays })}
              </p>
              <div style={S.grid}>
                {training.options.map((o) => (
                  <button key={o.masteryId} style={S.tile} onClick={() => startTraining(o)}>
                    <span style={S.tileName}>{o.label}</span>
                    <span style={{ ...S.tileNote, color: C.accent }}>
                      {t(locale, 'ui.training.level', { n: o.level })} ·{' '}
                      {t(locale, 'ui.training.exp', { n: o.experience })}
                    </span>
                  </button>
                ))}
              </div>
            </>
          );
        })()
      ) : null}

      {/* ── 家 ───────────────────────────────────────────────── */}
      {screen === 'home' && city?.home !== undefined ? (
        (() => {
          const home = city.home;
          return (
            <>
              <h2 style={{ fontSize: 15, margin: '0 0 10px' }}>
                {t(locale, 'ui.screen.home')} · {text(home.nameRef)}
              </h2>
              <div style={{ ...S.card, marginBottom: 12 }}>
                <div style={{ ...S.row, borderBottom: 'none' }}>
                  <span style={S.label}>{t(locale, 'ui.shop.balance')}</span>
                  <span style={{ fontWeight: 600 }}>{home.balance}</span>
                </div>
              </div>
              {home.owned !== undefined ? (
                <div style={S.card}>
                  <div style={S.row}>
                    <span style={S.label}>{t(locale, 'ui.home.owned')}</span>
                    <span style={{ fontWeight: 600 }}>
                      {t(locale, 'ui.home.used', {
                        used: home.owned.usedSlots,
                        total: home.owned.slotCapacity,
                      })}
                    </span>
                  </div>
                  <div style={{ ...S.row, borderBottom: 'none' }}>
                    <span style={S.label}>{t(locale, 'ui.home.upgrades')}</span>
                    <span style={S.sub}>
                      {home.owned.installedUpgradeIds
                        .map((id) => id.split('.').slice(2).join('.'))
                        .join('、')}
                    </span>
                  </div>
                </div>
              ) : (
                <>
                  <p style={{ ...S.sub, margin: '0 0 10px' }}>{t(locale, 'ui.home.notOwned')}</p>
                  <div style={S.grid}>
                    {home.options.map((o) => (
                      <button
                        key={o.slotCount}
                        style={o.affordable ? S.tile : S.tileOff}
                        disabled={!o.affordable}
                        onClick={() =>
                          dispatch(
                            {
                              type: 'buyOrUpgradeHome',
                              cityId: view.location.kind === 'city' ? view.location.cityId : '',
                              payerCharacterId: view.leader?.id,
                              slotCount: o.slotCount,
                            } as unknown as GameCommand,
                            {
                              kind: 'homeBought',
                              place: home.nameRef,
                              slots: o.slotCount,
                              price: o.price,
                            },
                            home.nameRef,
                          )
                        }
                      >
                        <span style={S.tileName}>
                          {t(locale, 'ui.home.slots', { n: o.slotCount })}
                        </span>
                        <span style={{ ...S.tileNote, color: o.affordable ? C.accent : C.dim }}>
                          {o.price} ·{' '}
                          {o.affordable
                            ? t(locale, 'ui.home.buy')
                            : t(locale, 'ui.shop.tooExpensive')}
                        </span>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </>
          );
        })()
      ) : null}

      {/* ── 地城 ─────────────────────────────────────────────── */}
      {atMap !== undefined ? (
        view.dungeon === undefined ? (
          <>
            <h2 style={{ fontSize: 15, margin: '0 0 10px' }}>{t(locale, 'ui.dungeon.title')}</h2>
            <p style={S.sub}>{t(locale, 'ui.dungeon.notStarted')}</p>
            <div style={{ ...S.btnRow, marginTop: 12 }}>
              <button
                style={S.btn}
                onClick={() =>
                  dispatch(
                    { type: 'startPlayerExploration' } as unknown as GameCommand,
                    { kind: 'exploreStarted', place: atMap.siteNameRef },
                    atMap.siteNameRef,
                  )
                }
              >
                {t(locale, 'ui.dungeon.enter')}
              </button>
            </div>
          </>
        ) : (
          <Dungeon
            locale={locale}
            dungeon={view.dungeon}
            text={text}
            onOpenDoor={(linkId) =>
              dispatch(
                { type: 'openDungeonDoor', linkId } as unknown as GameCommand,
                { kind: 'doorOpened' },
                view.dungeon!.siteNameRef,
              )
            }
            onMove={(roomId) =>
              dispatch(
                { type: 'moveDungeonRoom', targetRoomId: roomId } as unknown as GameCommand,
                { kind: 'movedPlain', room: roomId },
                view.dungeon!.siteNameRef,
              )
            }
            onLeave={() =>
              dispatch(
                {
                  type: 'useDungeonExit',
                  exitRoomId: view.dungeon!.currentRoomId,
                } as unknown as GameCommand,
                { kind: 'leftDungeon' },
                view.dungeon!.siteNameRef,
              )
            }
          />
        )
      ) : null}

      <div style={S.log}>
        {log.map((l) => (
          <div key={l.id} style={{ color: l.tone === 'ok' ? '#8fdf8f' : l.tone === 'warn' ? '#f0b46a' : '#ccd' }}>
            {renderLog(l.entry)}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── 世界地圖畫面 ──────────────────────────────────────────────────────────
//
// 拓樸來自內容：`city-node.adjacentRouteIds` → route → 對側城市。行進方式來自 core pack 的
// `player-travel-mode`（3/6/9 日）。兩者都不是 UI 決定的。
function WorldMap(props: {
  locale: UiLocale;
  city: NonNullable<GameView['city']>;
  currentName: string;
  text: (ref: LocalizedTextRef) => string;
  onTravel: (routeId: string, toCityId: string, modeId: string, placeRef: LocalizedTextRef) => void;
}): JSX.Element {
  const { locale, city, currentName, text, onTravel } = props;
  const [modeId, setModeId] = useState<string>(city.travelModes[1]?.modeId ?? city.travelModes[0]?.modeId ?? '');

  return (
    <>
      <h2 style={{ fontSize: 15, margin: '0 0 10px' }}>{t(locale, 'ui.screen.worldMap')}</h2>

      <div style={{ ...S.card, marginBottom: 12 }}>
        <div style={{ fontSize: 12, color: C.dim, marginBottom: 8 }}>{t(locale, 'ui.worldMap.chooseMode')}</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {city.travelModes.map((m) => (
            <button
              key={m.modeId}
              onClick={() => setModeId(m.modeId)}
              style={{
                ...S.btnGhost,
                borderColor: m.modeId === modeId ? C.accent : C.line,
                color: m.modeId === modeId ? C.accent : C.ink,
                fontWeight: m.modeId === modeId ? 600 : 400,
              }}
            >
              {text(m.nameRef)} · {t(locale, 'ui.worldMap.days', { days: m.durationDays })}
            </button>
          ))}
        </div>
      </div>

      <div style={{ fontSize: 12, color: C.dim, margin: '0 0 8px' }}>
        {t(locale, 'ui.worldMap.current')}：<strong style={{ color: C.ink }}>{currentName}</strong>
      </div>
      <div style={{ fontSize: 12, color: C.dim, margin: '0 0 8px' }}>{t(locale, 'ui.worldMap.neighbours')}</div>
      <div style={S.grid}>
        {city.neighbours.map((n) => (
          <button
            key={n.routeId}
            style={S.tile}
            disabled={modeId === ''}
            onClick={() => onTravel(n.routeId, n.toCityId, modeId, n.nameRef)}
          >
            <span style={S.tileName}>
              {text(n.nameRef)}
              {n.isCapital ? <span style={{ ...S.chip, marginLeft: 6 }}>{t(locale, 'ui.worldMap.capital')}</span> : null}
            </span>
            <span style={{ ...S.tileNote, color: C.accent }}>{t(locale, 'ui.action.travelHere')} →</span>
          </button>
        ))}
      </div>
    </>
  );
}

// ── 地城畫面 ──────────────────────────────────────────────────────────────
//
// 房間拓樸來自 Template、門的開關來自 map Slice、已揭露來自 dungeon Slice——三者都由 facade
// 投影好，這裡只負責畫與送指令。紅門關著時先顯示「開門」，開了才顯示「前往」：那個順序是
// 內容決定的（紅門要花 redDoorOpenMinutes），不是 UI 的裝飾。
function Dungeon(props: {
  locale: UiLocale;
  dungeon: NonNullable<GameView['dungeon']>;
  text: (ref: LocalizedTextRef) => string;
  onOpenDoor: (linkId: string) => void;
  onMove: (roomId: string) => void;
  onLeave: () => void;
}): JSX.Element {
  const { locale, dungeon, text, onOpenDoor, onMove, onLeave } = props;
  return (
    <>
      <h2 style={{ fontSize: 15, margin: '0 0 10px' }}>
        {t(locale, 'ui.dungeon.title')} · {text(dungeon.siteNameRef)}
      </h2>

      <div style={S.card}>
        <div style={S.row}>
          <span style={S.label}>{t(locale, 'ui.dungeon.currentRoom')}</span>
          <span style={{ fontWeight: 600 }}>{dungeon.currentRoomId}</span>
        </div>
        <div style={S.row}>
          <span style={S.label}>{t(locale, 'ui.dungeon.explored')}</span>
          <span>
            {t(locale, 'ui.dungeon.rooms', { a: dungeon.revealedRoomCount, b: dungeon.totalRoomCount })}
          </span>
        </div>
        <div style={S.row}>
          <span style={S.label}>{t(locale, 'ui.dungeon.elapsed')}</span>
          <span>{t(locale, 'ui.dungeon.minutes', { n: dungeon.elapsedMinutes })}</span>
        </div>
        <div style={{ ...S.row, borderBottom: 'none' }}>
          <span style={S.label}>{t(locale, 'ui.dungeon.remaining')}</span>
          <span>{t(locale, 'ui.dungeon.count', { n: dungeon.remainingContentCount })}</span>
        </div>
      </div>

      {dungeon.isExitRoom ? (
        <div style={{ ...S.card, borderColor: C.accent }}>
          <div style={{ fontSize: 13, marginBottom: 10 }}>{t(locale, 'ui.dungeon.atExit')}</div>
          <button style={S.btn} onClick={onLeave}>
            {t(locale, 'ui.dungeon.leave')}
          </button>
        </div>
      ) : null}

      <div style={{ fontSize: 12, color: C.dim, margin: '0 0 8px' }}>
        {t(locale, 'ui.dungeon.roomContents')}
      </div>
      {dungeon.roomContents.length === 0 ? (
        <p style={{ ...S.sub, marginBottom: 16 }}>{t(locale, 'ui.dungeon.roomEmpty')}</p>
      ) : (
        <div style={{ ...S.grid, marginBottom: 16 }}>
          {dungeon.roomContents.map((c) => (
            <div key={c.contentId} style={S.tileOff} title={t(locale, 'ui.dungeon.combatPending')}>
              <span style={S.tileName}>
                {c.kind === 'boss' ? '★ ' : ''}
                {t(
                  locale,
                  c.kind === 'monsterGroup'
                    ? 'ui.dungeon.kind.monsterGroup'
                    : c.kind === 'boss'
                      ? 'ui.dungeon.kind.boss'
                      : c.kind === 'chest'
                        ? 'ui.dungeon.kind.chest'
                        : c.kind === 'mapEvent'
                          ? 'ui.dungeon.kind.mapEvent'
                          : 'ui.dungeon.kind.other',
                )}
              </span>
              <span style={S.tileNote}>{c.label}</span>
            </div>
          ))}
        </div>
      )}

      <div style={{ fontSize: 12, color: C.dim, margin: '0 0 8px' }}>{t(locale, 'ui.dungeon.exits')}</div>
      <div style={S.grid}>
        {dungeon.exits.map((exit) => {
          const blocked = exit.kind === 'redDoor' && exit.state === 'closed';
          const kindLabel = blocked
            ? t(locale, 'ui.dungeon.redDoorClosed')
            : exit.kind === 'redDoor'
              ? t(locale, 'ui.dungeon.redDoorOpen')
              : t(locale, 'ui.dungeon.passage');
          return (
            <button
              key={exit.linkId}
              style={S.tile}
              onClick={() => (blocked ? onOpenDoor(exit.linkId) : onMove(exit.roomId))}
            >
              <span style={S.tileName}>
                {exit.revealed ? exit.roomId : `? ${t(locale, 'ui.dungeon.unexplored')}`}
              </span>
              <span style={{ ...S.tileNote, color: blocked ? C.warn : C.accent }}>
                {kindLabel} · {blocked ? t(locale, 'ui.dungeon.openDoor') : t(locale, 'ui.action.travelHere')} →
              </span>
            </button>
          );
        })}
      </div>
    </>
  );
}
