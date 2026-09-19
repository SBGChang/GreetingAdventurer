import { renderCharacterName, type CharacterNameDisplay } from '../src/contracts/character/names';
import {FacilityChoices} from './FacilityChoices';
import {ReceptionProvider,ReceptionAside,ReceptionActions,ReceptionOptions,receptionStyle} from './FacilityReception';
import {facilityPresentation,type ReceptionEvent} from './facility-presentation';
import {CombatScreen} from './CombatScreen';
import {AppearancePicker} from './AppearancePicker';
import {readAppearanceSelections,selectAppearance,appearanceStorageKey,type AppearanceSelections} from './combat-appearances';
import {combatEnvironment} from './combat-ground';
import { WorldMap } from './WorldMap';
import { DungeonAdventure } from './DungeonAdventure';
import { MenuTabs, FormationBoard, type MenuTab } from './PlayerMenu';
import { UiArt, SCREEN_ART, FACILITY_ART } from './UiArt';
import { PLAYER_SCENARIO } from '../content-source/player-scenario';
import { PlayerShell, Welcome, CityScene } from './PlayerShell';
import { useState, useRef, useEffect } from 'react';
import { readSave, writeSave, restoreSave, clearSave } from './engine/save-storage';
import {
  createGame,
  CAPABILITIES,
  type GameHandle,
  type FacilityAction,
  type CommandOutcome,
  type MoveOptionView,
  type GameView,
  type FacilityView,
} from './engine/game-facade';
import { t, UI_LOCALES, UI_TEXT, type UiLocale, type UiTextKey } from './i18n';
import type { CityId, LocalizedTextRef } from '../src/contracts/core';
import type { NewGameConfig } from '../src/app/composition/new-game-bootstrap';
import type { GameCommand } from '../src/app/composition/messages';
import './facilities.css';


const DEFAULT_CONFIG = PLAYER_SCENARIO;

type Screen = 'rest' | 'city' | 'worldMap' | 'adventure' | 'shop' | 'home' | 'training' | 'tavern' | 'guild' | 'sheet';

// 日誌條目存**引用**，不存已翻譯字串（15_ui_application.md §10 的同一條理由：把翻譯結果存進
// state，切語系時就換不掉了）。內容名稱以 LocalizedTextRef 帶著，render 當下才解析。
type LogEntry =
  | { kind: 'questCargoHandedIn' }
  | { kind: 'formationSaved' }
  | { kind: 'combatWon' }
  | { kind: 'sold'; item: string; price: number }
  | Readonly<{ kind: 'newGame' }>
  | Readonly<{ kind: 'questSettled' }>
  | Readonly<{ kind: 'lootResolved' }>
  | Readonly<{ kind: 'travelStarted'; place: LocalizedTextRef }>
  | Readonly<{ kind: 'arrived'; place: LocalizedTextRef }>
  | Readonly<{ kind: 'rested'; place: LocalizedTextRef }>
  | Readonly<{ kind: 'daysPassed'; days: number; day: number }>
  | Readonly<{ kind: 'settleBlocked'; code: string }>
  | Readonly<{ kind: 'actionRejected'; action: string; code: string }>
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
  | Readonly<{ kind: 'recruitSucceeded'; who: CharacterNameDisplay }>
  | Readonly<{ kind: 'recruitFailed'; who: CharacterNameDisplay }>
  | Readonly<{ kind: 'questAccepted'; quest: string }>
  | Readonly<{ kind: 'usedSkill'; skill: string }>
  | Readonly<{ kind: 'combatRested' }>
  | Readonly<{ kind: 'equipped'; item: string }>
  | Readonly<{ kind: 'combatStarted'; who: string }>
  | Readonly<{ kind: 'skillSet'; skill: string; n: number }>;

type LogLine = Readonly<{ id: number; entry: LogEntry; tone: 'info' | 'ok' | 'warn' }>;

const C = {
  ink: '#293b36',
  dim: '#78816e',
  line: '#dce0d2',
  panel: '#faf9f2',
  accent: '#365e49',
  warn: '#b45309',
};

const S = {
  page: {
    fontFamily: '"Segoe UI", "Microsoft JhengHei", system-ui, sans-serif',
    maxWidth: 1200,
    margin: '0 auto',
    padding: '24px 24px 40px',
    color: C.ink,
  } as const,
  head: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 } as const,
  h1: { fontSize: 22, margin: '0 0 2px' } as const,
  sub: { color: '#76674e', fontSize: 13, margin: 0 } as const,
  card: { border: `1px solid ${C.line}`, borderRadius: 10, padding: 16, marginBottom: 16, background: '#f0e3c8c9' } as const,
  row: { display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: `1px solid ${C.line}` } as const,
  label: { color: C.dim } as const,
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))', gap: 10 } as const,
  tile: {
    textAlign: 'left' as const,
    border: `1px solid ${C.line}`,
    borderRadius: 10,
    padding: '12px 14px',
    background: '#f7ecd4',
    cursor: 'pointer',
    font: 'inherit',
    color: C.ink,
  },
  tileOff: {
    textAlign: 'left' as const,
    border: `1px dashed ${C.line}`,
    borderRadius: 10,
    padding: '12px 14px',
    background: '#ded1b8',
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
  barTrack: {
    display: 'inline-block',
    flex: 1,
    height: 8,
    borderRadius: 4,
    background: '#e9ecef',
    overflow: 'hidden',
  } as const,
  barFill: { display: 'block', height: '100%' } as const,
  mapCell: {
    width: 28,
    height: 28,
    borderRadius: 4,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 11,
    fontWeight: 600,
  } as const,
  btnGhost: {
    padding: '9px 15px',
    borderRadius: 8,
    border: `1px solid ${C.line}`,
    background: '#f7ecd4',
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
  const [init, setInit] = useState(() => {
    try {
      const saved = readSave(localStorage);
      return { hasSave: saved !== undefined, handle: createGame(DEFAULT_CONFIG, saved), error: undefined as string | undefined };
    } catch (e) {
      return { hasSave: false, handle: undefined as GameHandle | undefined, error: e instanceof Error ? e.message : String(e) };
    }
  });

  const [started, setStarted] = useState(false);
  const [lootBid, setLootBid] = useState('');
  const [locale, setLocale] = useState<UiLocale>('zh-Hant');
  const [storageError, setStorageError] = useState<string>();
  const [appearanceChoices,setAppearanceChoices]=useState<AppearanceSelections>({});
  useEffect(()=>{try{setAppearanceChoices(readAppearanceSelections(localStorage))}catch(e){setStorageError(e instanceof Error?e.message:String(e))}},[]);
  const [saveNotice, setSaveNotice] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [restFacility,setRestFacility]=useState<FacilityView>();
  const [receptionResult,setReceptionResult]=useState<{id:number;event:ReceptionEvent;entry:LogEntry}|undefined>();
  const saveCurrent = (game: GameHandle): void => {
    try {
      writeSave(localStorage, game.serialize());
      setStorageError(undefined);
      setSaveNotice(true);
    } catch (e) {
      setStorageError(e instanceof Error ? e.message : String(e));
    }
  };
  const recover = (backup: boolean): void => {
    try {
      if (!backup && !window.confirm(t(locale, 'ui.save.confirmNew'))) return;
      const saved = backup ? readSave(localStorage, true) : undefined;
      if (backup && saved === undefined) throw new Error('save/backup-missing');
      const game = createGame(DEFAULT_CONFIG, saved);
      if (backup) restoreSave(localStorage, game.serialize());
      else {writeSave(localStorage, game.serialize());localStorage.removeItem(appearanceStorageKey);}
      window.location.reload();
    } catch (e) { setStorageError(e instanceof Error ? e.message : String(e)); }
  };
  const [screen, setScreen] = useState<Screen>('city');
  const [menuTab, setMenuTab] = useState<MenuTab>('equipment');
  const [shopFacilityId, setShopFacilityId] = useState<string | undefined>(undefined);
  const [trainFacilityId, setTrainFacilityId] = useState<string | undefined>(undefined);
  // 戰鬥是兩段式選擇：先點招、再點目標。存在這裡而不是塞進 GameView——它是**畫面的**狀態，
  // 不是世界的狀態（重新載入後不該記得你剛剛點了哪一招）。
  // 裝備武器要指定裝到哪一組。玩家在人物頁點卡片切換；未選時用第一組（下面 view 就緒後才決定）。
  const [pickedSetRaw, setPickedSet] = useState<string | undefined>(undefined);
  const [view, setView] = useState<GameView | undefined>(init.handle?.view);
  const retainedCity = useRef<{ cityId: string; city: NonNullable<GameView['city']>; nameRef: LocalizedTextRef }>();
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
          <button onClick={() => recover(true)}>{t(locale, 'ui.save.backup')}</button>
          <button onClick={() => recover(false)}>{t(locale, 'ui.save.new')}</button>
          {storageError && <p role="alert">{storageError}</p>}
        </div>
      </div>
    );
  }
  const handle = init.handle;
  const pickedSet = pickedSetRaw ?? view.sheet?.weaponSets[0]?.weaponSetId ?? '';

  // 缺少文字引用的技能保留可辨識的 local ID。
  const skillLocal = (skillId: string): string => skillId.split('.').slice(2).join('.');

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
    // 「哪個動作被拒」的標籤。**純字串**而不是 LocalizedTextRef：有些動作的主體是內容
    // （設施名、物品名），有些是畫面本身（人物頁、戰鬥）——後者的字在 UI 文字表裡，
    // 用 `text()` 去解會得到「缺文字」。由呼叫端先解好再傳進來。
    subject: string,
    onResult?: (result:CommandOutcome)=>void,
  ): boolean => {
    const before = progress.day;
    const wasCity = progress.cityId;
    let r;
    try { r = handle.runCommand(command); }
    catch (e) {
      append({ kind: 'actionRejected', action: subject, code: e instanceof Error ? e.message : String(e) }, 'warn');
      setReceptionResult(prev=>({id:(prev?.id??0)+1,event:'failed',entry:{kind:'actionRejected',action:subject,code:e instanceof Error?e.message:String(e)}}));
      onResult?.({accepted:false,rejectionCode:e instanceof Error?e.message:String(e),view});
      return false;
    }
    if(onResult)onResult(r);else setView(r.view);
    if (!r.accepted) {
      append({ kind: 'actionRejected', action: subject, code: r.rejectionCode }, 'warn');
      setReceptionResult(prev=>({id:(prev?.id??0)+1,event:'rejected',entry:{kind:'actionRejected',action:subject,code:r.rejectionCode}}));
      return false;
    }
    const acceptedEntry=typeof onAccepted === 'function' ? onAccepted(r.view) : onAccepted;
    append(acceptedEntry, 'ok');
    setReceptionResult(prev=>({id:(prev?.id??0)+1,event:acceptedEntry.kind==='recruitFailed'?'failed':'accepted',entry:acceptedEntry}));
    const elapsed = r.view.worldDay - before;
    if (elapsed > 0) {
      append({ kind: 'daysPassed', days: elapsed, day: r.view.worldDay }, 'info');
    }
    // 抵達：旅行現在整段在同一個指令裡走完，所以「之前也在城市」不代表沒有移動——
    // 必須比對是不是**同一座**城市。
    if (r.view.location.kind === 'city' && r.view.location.cityId !== wasCity) {
      append({ kind: 'arrived', place: r.view.location.nameRef }, 'info');
    }
    if (view.combat && !r.view.combat && r.view.leader?.lifeState === 'alive') append({ kind: 'combatWon' }, 'ok');
    progress.day = r.view.worldDay;
    progress.cityId = r.view.location.kind === 'city' ? r.view.location.cityId : undefined;
    if (r.blocked !== undefined) append({ kind: 'settleBlocked', code: r.blocked }, 'warn');
    saveCurrent(handle);
    return true;
  };


  // 改一個武器組的某一格招式。`configureWeaponSet` 是**整組覆寫**，所以要把另外兩格原樣帶回去——
  // 只送一格會把其餘兩格清空。
  const setWeaponSetSkills = (
    set: NonNullable<GameView['sheet']>['weaponSets'][number],
    slot: number,
    skillId: string | undefined,
  ): void => {
    const next = set.skills.map((x, i) => (i === slot ? skillId : x?.skillId));
    const sheet = view.sheet;
    if (sheet === undefined) return;
    const label =
      skillId === undefined
        ? t(locale, 'ui.sheet.empty')
        : (() => {
            const found = sheet.assignableSkills.find((x) => x.skillId === skillId);
            return found?.nameRef !== undefined ? text(found.nameRef) : skillLocal(skillId);
          })();
    dispatch(
      {
        type: 'configureWeaponSet',
        characterId: sheet.characterId,
        weaponSetId: set.weaponSetId,
        mainHandItemId: set.mainHand.itemId,
        offHandItemId: set.offHand.itemId,
        selectedSkillIds: next,
      } as unknown as GameCommand,
      { kind: 'skillSet', skill: label, n: set.index + 1 },
      t(locale, 'ui.screen.sheet'),
    );
  };

  // 設施 → 按下去發生什麼。非 Partial 的 Record：facade 新增一種 FacilityAction 而這裡沒接，
  // 就是編譯錯誤，而不是「按了沒反應」——後者正是這份表原本是 if/else 串時發生過的事。
  const FACILITY_HANDLER: Readonly<Record<FacilityAction, (f: FacilityView) => void>> = {
    rest: (f) => {setRestFacility(f);setScreen('rest');},
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

  const onFacility = (f: FacilityView): void => {setReceptionResult(undefined);FACILITY_HANDLER[f.action](f)};

  // 日誌條目 → 當下語系的字。這是唯一把 LogEntry 變成文字的地方。
  const renderLog = (entry: LogEntry): string => {
    switch (entry.kind) {
      case 'formationSaved': return t(locale, 'ui.menu.formationSaved');
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
        return t(locale, 'ui.log.actionRejected', { action: entry.action, code: entry.code });
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
      case 'skillSet':
        return t(locale, 'ui.log.skillSet', { skill: entry.skill, n: entry.n });
      case 'combatStarted':
        return t(locale, 'ui.log.combatStarted', { who: entry.who });
      case 'usedSkill':
        return t(locale, 'ui.log.usedSkill', { skill: entry.skill });
      case 'combatRested':
        return t(locale, 'ui.log.combatRested');
      case 'equipped':
        return t(locale, 'ui.log.equipped', { item: entry.item });
      case 'combatWon': return t(locale, 'ui.combat.victory');
      case 'sold': return t(locale, 'ui.log.sold', { item: entry.item, price: entry.price });
      case 'questSettled': return t(locale, 'ui.log.questSettled');
      case 'lootResolved': return t(locale, 'ui.log.lootResolved');
      case 'questAccepted':
        return t(locale, 'ui.log.questAccepted', { quest: entry.quest });
      case 'recruitSucceeded':
        return t(locale, 'ui.log.recruitSucceeded', { who: renderCharacterName(entry.who, text) });
      case 'recruitFailed':
        return t(locale, 'ui.log.recruitFailed', { who: renderCharacterName(entry.who, text) });
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
      case 'questCargoHandedIn': return t(locale, 'ui.quest.handedIn');
      case 'bought':
        return t(locale, 'ui.log.bought', { item: entry.item, price: entry.price });
    }
  };

  const city = view.city;
  const receptionKinds:Partial<Record<Screen,FacilityView['kind']>>={rest:'inn',tavern:'tavern',guild:'adventurerGuild',home:'home',adventure:'adventureCheckpoint',worldMap:'cityGate'};
  const receptionKind=screen==='shop'?city?.facilities.find(f=>f.facilityId===shopFacilityId)?.kind:screen==='training'?city?.facilities.find(f=>f.facilityId===trainFacilityId)?.kind:receptionKinds[screen];
  const receptionProfile=city&&view.cultureId&&receptionKind&&!view.combat&&!view.dungeon&&!view.loot?facilityPresentation(view.cultureId,receptionKind):undefined;
  if (view.location.kind === 'city' && city) retainedCity.current = { cityId: view.location.cityId, city, nameRef: view.location.nameRef };
  else if (!view.combat && (view.location.kind === 'travelling' || view.location.kind === 'adventureMap')) retainedCity.current = undefined;
  const townScene = retainedCity.current;
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

  if (started && view.leader?.lifeState !== 'alive' && !view.combat) return <main className="journey-ended">
    <span className="eyebrow">GREETING ADVENTURER</span><h1>{t(locale, 'ui.play.ended')}</h1>
    <p>{t(locale, 'ui.play.endedHint')}</p><button className="primary" onClick={() => setStarted(false)}>{t(locale, 'ui.play.new')}</button>
  </main>;

  if (!started) return <Welcome locale={locale} hasSave={init.hasSave} error={storageError}
    onContinue={() => setStarted(true)} onStart={(seed, sex, leaderName) => {
      if (init.hasSave && !window.confirm(t(locale, 'ui.save.confirmNew'))) return;
      try {
        const game = createGame({ ...DEFAULT_CONFIG, worldSeed: seed, leaderSex: sex, leaderName });
        localStorage.removeItem(appearanceStorageKey); setAppearanceChoices({});
        setInit({ hasSave: true, handle: game, error: undefined }); setView(game.view); setScreen('city');
        progress.day = game.view.worldDay; progress.cityId = game.view.location.kind === 'city' ? game.view.location.cityId : undefined;
        setLog([]); saveCurrent(game); setStarted(true);
      } catch (error) { setStorageError(String(error)); }
    }} />;

  return (
    <ReceptionProvider profile={receptionProfile} locale={locale} result={receptionResult?{id:receptionResult.id,event:receptionResult.event,detail:renderLog(receptionResult.entry)}:undefined}>
    <PlayerShell locale={locale} view={view} place={locationLabel} screen={screen} navigate={setScreen}>
      <details className="save-tools"><summary>{t(locale, 'ui.play.saveMenu')}</summary>
      <div data-toolbar><label style={S.sub}>{t(locale, 'ui.locale.label')}{' '}
        <select value={locale} onChange={e => setLocale(e.target.value as UiLocale)}><option value="zh-Hant">繁體中文</option><option value="en">English</option></select>
      </label></div>

      <div style={S.btnRow}>
        <button style={S.btnGhost} onClick={() => saveCurrent(handle)}>{t(locale, 'ui.save.now')}</button>
        <button style={S.btnGhost} onClick={() => {
          try {
            const url = URL.createObjectURL(new Blob([handle.serialize()], { type: 'application/json' }));
            const link = document.createElement('a');
            link.href = url; link.download = 'greeting-adventurer.save.json'; link.click();
            window.setTimeout(() => URL.revokeObjectURL(url), 1000);
          } catch (e) { setStorageError(e instanceof Error ? e.message : String(e)); }
        }}>{t(locale, 'ui.save.export')}</button>
        <label style={{ ...S.btnGhost, cursor: 'pointer' }}>
          {t(locale, 'ui.save.import')}
          <input style={{ display: 'none' }} aria-label={t(locale, 'ui.save.import')} type="file" accept=".json,application/json" onChange={async (event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = '';
            if (!file) return;
            try {
              const game = createGame(DEFAULT_CONFIG, await file.text());
              if (!window.confirm(t(locale, 'ui.save.confirmImport'))) return;
              writeSave(localStorage, game.serialize());
              window.location.reload();
            } catch (e) { setStorageError(e instanceof Error ? e.message : String(e)); }
          }} />
        </label>
        <button style={S.btnGhost} onClick={() => recover(false)}>{t(locale, 'ui.save.new')}</button>
        <button style={S.btnGhost} onClick={() => {
          if (!confirmClear) { setConfirmClear(true); return; }
          try { clearSave(localStorage); window.location.reload(); }
          catch (error) { setStorageError(String(error)); }
        }}>{t(locale, confirmClear ? 'ui.save.confirmClear' : 'ui.save.clear')}</button>
        {saveNotice && !storageError && <span role="status">{t(locale, 'ui.save.saved')}</span>}
      </div>
      </details>
      {storageError && <p role="alert" style={S.err}>{t(locale, 'ui.save.failed')} {storageError}</p>}
      {log.length > 0 && <div className="action-feedback" role={log[log.length - 1]!.tone === 'warn' ? 'alert' : 'status'}>{renderLog(log[log.length - 1]!.entry)}</div>}
      {view.loot && <section className="loot-panel" aria-label={t(locale, 'ui.loot.title')}>
        <span className="eyebrow">SPOILS OF THE JOURNEY</span><h2>{t(locale, 'ui.loot.title')} · {text(view.loot.nameRef)}</h2>
        <p>{t(locale, 'ui.loot.hint')}</p>
        <p>{t(locale, 'ui.loot.minimum')} {view.loot.minimumBid} · {t(locale, 'ui.loot.highest')} {view.loot.highestBid} · {t(locale, 'ui.loot.remaining')} {view.loot.remaining}</p>
        <div className="loot-controls"><input aria-label={t(locale, 'ui.loot.bid')} type="number" min={view.loot.minimumBid} max={view.balance} step="1" value={lootBid} placeholder={String(view.loot.minimumBid)} onChange={e => setLootBid(e.target.value)} />
          <button className="primary" disabled={view.balance < view.loot.minimumBid} onClick={() => {
            const loot = view.loot!;
            if (dispatch({ type: 'submitLootBid', distributionId: loot.distributionId, itemId: loot.itemId, bidderCharacterId: view.leader?.id, amount: Number(lootBid || loot.minimumBid) } as unknown as GameCommand,
              { kind: 'lootResolved' }, t(locale,'ui.loot.title'))) {
              dispatch({ type: 'resolveLootAuctionRound', distributionId: loot.distributionId, itemId: loot.itemId } as unknown as GameCommand, { kind: 'lootResolved' }, t(locale,'ui.loot.title')); setLootBid('');
            }
          }}>{t(locale, 'ui.loot.bid')}</button>
          <button style={S.btnGhost} onClick={() => {
            const loot = view.loot!;
            if (dispatch({ type: 'passLootItem', distributionId: loot.distributionId, itemId: loot.itemId, bidderCharacterId: view.leader?.id } as unknown as GameCommand,
              { kind: 'lootResolved' }, t(locale,'ui.loot.title'))) dispatch({ type: 'resolveLootAuctionRound', distributionId: loot.distributionId, itemId: loot.itemId } as unknown as GameCommand, { kind: 'lootResolved' }, t(locale,'ui.loot.title'));
            setLootBid('');
          }}>{t(locale, 'ui.loot.pass')}</button>
        </div>
      </section>}
      <div data-reception={receptionProfile?.id} data-reception-culture={receptionProfile?.cultureId} style={receptionProfile?receptionStyle(receptionProfile):undefined} className={receptionProfile?'play-surface window-surface reception-window':view.combat ? 'play-surface battle-surface' : view.dungeon && screen !== 'sheet' ? 'play-surface dungeon-surface' : screen === 'worldMap' ? 'play-surface atlas-surface' : screen === 'city' ? 'play-surface scene-surface' : 'play-surface window-surface'}>
      {receptionProfile&&<><ReceptionAside/><h2 className="reception-title">{receptionProfile.name[locale]}</h2></>}
      {SCREEN_ART[screen] && !view.combat && (!view.dungeon || screen === 'sheet') && <UiArt className="window-emblem" kind={screen === 'shop' ? FACILITY_ART[city?.facilities.find(f => f.facilityId === shopFacilityId)?.kind ?? 'equipmentShop'] : SCREEN_ART[screen]} />}
      {screen !== 'city' && !view.combat && (!view.dungeon || screen === 'sheet') ? (
        <div className="window-back" style={S.btnRow}>
          <button className={receptionProfile ? 'reception-return' : undefined} style={S.btnGhost} aria-label={t(locale, view.dungeon ? 'ui.scene.backToMap' : 'ui.action.back')} title={t(locale, view.dungeon ? 'ui.scene.backToMap' : 'ui.action.back')} onClick={() => setScreen('city')}>
            {!receptionProfile && t(locale, view.dungeon ? 'ui.scene.backToMap' : 'ui.action.back')}
          </button>
        </div>
      ) : null}

      <section className="surface-content">
      {townScene !== undefined && <CityScene key={townScene.cityId} cityId={townScene.cityId} visible={screen === 'city' && !view.loot} backdrop={!!view.combat} facilities={townScene.city.facilities} place={text(townScene.nameRef)} locale={locale} text={text} visit={onFacility} />}

      {/* ── 世界地圖 ──────────────────────────────────────────── */}
      {screen === 'worldMap' && townScene !== undefined ? (
        <WorldMap
          locale={locale}
          city={townScene.city}
          paused={!!view.combat}
          currentCityId={townScene.cityId}
          text={text}
          onTravel={(routeId, toCityId, modeId, placeRef) => {
            const ok = dispatch(
              { type: 'startCityTravel', toCityId, routeId, modeId } as unknown as GameCommand,
              { kind: 'travelStarted', place: placeRef },
              text(placeRef),
            );
            if (ok) setScreen('city');
          }}
        />
      ) : null}

      {/* ── 選冒險地 ──────────────────────────────────────────── */}
      {view.combat === undefined && screen === 'adventure' && city !== undefined ? (
        <>
          <h2 style={{ fontSize: 15, margin: '0 0 10px' }}>{t(locale, 'ui.screen.adventure')}</h2>
          {city.sites.length === 0 ? (
            <p style={S.sub}>{t(locale, 'ui.adventure.none')}</p>
          ) : (
            <FacilityChoices locale={locale} action={t(locale,'ui.action.descend')} groups={[{id:"main",label:t(locale,'ui.screen.adventure'),items:city.sites.map((site) => (
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
                      text(site.nameRef),
                    );
                    if (!ok) return;
                    dispatch(
                      { type: 'startPlayerExploration' } as unknown as GameCommand,
                      { kind: 'exploreStarted', place: site.nameRef },
                      text(site.nameRef),
                    );
                    setScreen('city');
                  }}
                >
                  <UiArt kind="adventure" /><span style={S.tileName}>{text(site.nameRef)}</span>
                  <span style={{ ...S.tileNote, color: C.accent }}>
                    {site.isNationalDungeon ? `${t(locale, 'ui.adventure.national')} · ` : ''}
                    {t(locale, 'ui.action.descend')} →
                  </span>
                </button>
              ))}]}/>
          )}
        </>
      ) : null}

      {screen==='rest'&&!view.combat&&restFacility&&<>
        <h2>{text(restFacility.nameRef)}</h2><section className="rest-summary">
          <p>{t(locale,'ui.status.health')} · {view.sheet?.health} / {view.sheet?.maxHealth}</p>
          <p>MP · {view.sheet?.mana} / {view.sheet?.maxMana}</p>
          <p>{t(locale,'ui.shop.balance')} · {view.balance}</p>
          <p>{t(locale,'ui.facility.restHint')}</p>
          <ReceptionActions><button data-reception-rest onClick={()=>dispatch({type:'rest',planKind:'cityFacilityAction'},{kind:'rested',place:restFacility.nameRef},text(restFacility.nameRef))}>{t(locale,'ui.facility.rest')}</button></ReceptionActions>
        </section></>}

      {/* ── 商店 ─────────────────────────────────────────────── */}
      {view.combat === undefined && screen === 'shop' && city !== undefined ? (
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
                {text(shop.nameRef)}
              </h2>
              <div className="facility-summary"><span>{t(locale,'ui.shop.balance')} <strong>{shop.balance}</strong></span>
              {city.trainings.some((tr) => tr.facilityId === shop.facilityId) ? (
                <ReceptionOptions><button
                  style={{ ...S.btnGhost, marginBottom: 12 }}
                  onClick={() => {
                    setTrainFacilityId(shop.facilityId);
                    setScreen('training');
                  }}
                >
                  {t(locale, 'ui.training.here')} →
                </button></ReceptionOptions>
              ) : null}
              </div>
              <FacilityChoices key={shop.facilityId} locale={locale} action={t(locale,'ui.shop.buy')} groups={[
                {id:'buy',label:t(locale,'ui.shop.buy'),items:shop.offers.map((o) => (
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
                        { kind: 'bought', item: text(o.nameRef), price: o.price },
                        text(shop.nameRef),
                      )
                    }
                  >
                    <UiArt kind={o.equipmentKind === 'armor' ? 'armor' : o.equipmentKind === 'weapon' ? 'weapon' : o.equipmentKind === 'shield' ? 'guild' : o.itemKind === 'equipment' ? 'forge' : o.itemKind === 'book' ? 'books' : 'supplies'} /><span style={S.tileName}>{text(o.nameRef)}</span>
                    <span
                      style={{ ...S.tileNote, color: o.affordable ? C.accent : C.dim }}
                    >
                      {o.price} ·{' '}
                      {o.affordable ? t(locale, 'ui.shop.buy') : t(locale, 'ui.shop.tooExpensive')}
                    </span>
                  </button>
                ))},
                {id:'sell',label:t(locale,'ui.shop.sell'),items:shop.sellable.map(item => <button key={item.itemId} data-action-label={t(locale,'ui.shop.sell')} style={S.tile} onClick={() => dispatch({
                  type: 'sellItemToShop', itemId: item.itemId, sellerCharacterId: view.leader?.id,
                  cityId: view.location.kind === 'city' ? view.location.cityId : undefined, facilityId: shop.facilityId,
                } as unknown as GameCommand, { kind: 'sold', item: text(item.nameRef), price: item.price }, t(locale, 'ui.shop.sell'))}>
                  <UiArt kind="supplies" /><span style={S.tileName}>{text(item.nameRef)} × {item.quantity}</span><span style={S.tileNote}>+ {item.price}</span>
                </button>)}
              ]}/>

            </>
          );
        })()
      ) : null}

      {/* ── 冒險者公會 ───────────────────────────────────────── */}
      {view.combat === undefined && screen === 'guild' && city?.guild !== undefined ? (
        (() => {
          const guild = city.guild;
          const questKindText = (kind: string): string => {
            const key = `ui.quest.kind.${kind}` as UiTextKey;
            return key in UI_TEXT ? t(locale, key) : kind;
          };
          const questTile = (q: (typeof guild.offers)[number], acceptable: boolean) => (
            <button
              key={q.questId}
              data-action-label={acceptable?t(locale,'ui.quest.accept'):t(locale,q.canHandIn?'ui.quest.handIn':'ui.quest.settle')}
              style={acceptable || q.canSettle || q.canHandIn ? S.tile : S.card}
              disabled={q.settled || (!acceptable && !q.canSettle && !q.canHandIn)}
              onClick={
                acceptable
                  ? () =>
                      dispatch(
                        { type: 'acceptQuest', questId: q.questId } as unknown as GameCommand,
                        { kind: 'questAccepted', quest: questKindText(q.kind) },
                        text(guild.nameRef),
                      )
                  : () => dispatch({ type: q.canHandIn ? 'handInQuestCargo' : 'settleQuest', questId: q.questId } as unknown as GameCommand, { kind: q.canHandIn ? 'questCargoHandedIn' : 'questSettled' }, questKindText(q.kind))
              }
            >
              <UiArt kind="quest" /><span style={S.tileName}>
                {questKindText(q.kind)} · {q.settled ? t(locale, 'ui.quest.settled') : q.status === 'completed' ? t(locale, 'ui.quest.settle') : `${q.completedTargets} / ${q.targetCount}`}
                {q.canHandIn ? ` · ${t(locale, 'ui.quest.handIn')}` : q.kind === 'purchase' && q.status === 'incomplete' && !q.cargoCarried ? ` · ${t(locale, 'ui.quest.buyCargo')}` : q.kind === 'delivery' && q.cargoCarried ? ` · ${t(locale, 'ui.quest.deliverCargo')}` : ''}
                {q.targetNameRef !== undefined ? ` · ${text(q.targetNameRef)}` : ''}
              </span>
              <span style={{ ...S.tileNote, color: acceptable ? C.accent : C.dim }}>
                {[
                  `${t(locale, 'ui.quest.reward')} ${q.reward}`,
                  `${t(locale, 'ui.quest.postingGuild')} ${text(q.postingNameRef)}`,
                    q.siteNameRef === undefined ? undefined : text(q.siteNameRef),
                  q.targetCount > 1 ? t(locale, 'ui.guild.targets', { n: q.targetCount }) : undefined,
                  acceptable
                    ? t(locale, 'ui.guild.deadline', { day: q.acceptDeadline })
                    : t(locale, 'ui.guild.endBy', { day: q.actualEndDeadline }),
                ]
                  .filter((x): x is string => x !== undefined)
                  .map((value,index)=><span className="facility-fact" key={index}>{value}</span>)}
              </span>
            </button>
          );
          return (
            <>
              <h2 style={{ fontSize: 15, margin: '0 0 10px' }}>
                {text(guild.nameRef)}
              </h2>
              <FacilityChoices theme="guild" locale={locale} action={t(locale,'ui.facility.confirm')} groups={[
                {id:'accepted',label:t(locale,'ui.guild.accepted'),items:guild.accepted.map(q=>questTile(q,false))},
                ...(['delivery','purchase','rescue','hunt','suppression'] as const).map(kind=>({id:kind,label:questKindText(kind),items:guild.offers.filter(q=>q.kind===kind).map(q=>questTile(q,true))}))
              ]}/>
            </>
          );
        })()
      ) : null}

      {/* ── 酒館 ─────────────────────────────────────────────── */}
      {view.combat === undefined && screen === 'tavern' && city?.tavern !== undefined ? (
        (() => {
          const tavern = city.tavern;
          return (
            <>
              <h2 style={{ fontSize: 15, margin: '0 0 10px' }}>
                {text(tavern.nameRef)}
              </h2>
              <p style={{ ...S.sub, margin: '0 0 10px' }}>{t(locale, 'ui.tavern.intro')}</p>
              {tavern.visitors.length === 0 ? (
                <p style={S.sub}>{t(locale, 'ui.tavern.empty')}</p>
              ) : (
                <FacilityChoices locale={locale} action={t(locale,'ui.tavern.recruit')} groups={[{id:"main",label:t(locale,'ui.screen.tavern'),items:tavern.visitors.map((v) => (
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
                              ? { kind: 'recruitSucceeded', who: v.name }
                              : { kind: 'recruitFailed', who: v.name },
                          text(tavern.nameRef),
                        )
                      }
                    >
                      <UiArt kind="guild" /><span style={S.tileName}>{renderCharacterName(v.name, text)}</span>
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
                  ))}]}/>
              )}
            </>
          );
        })()
      ) : null}

      {/* ── 訓練 ─────────────────────────────────────────────── */}
      {view.combat === undefined && screen === 'training' && city !== undefined ? (
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
                text(training.nameRef),
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
              { kind: 'trainingStarted', mastery: text(o.nameRef), days: training.requiredDays },
              text(training.nameRef),
            );

          };
          return (
            <>
              <h2 style={{ fontSize: 15, margin: '0 0 10px' }}>
                {text(training.nameRef)}
              </h2>
              <p style={{ ...S.sub, margin: '0 0 10px' }}>
                {t(locale, 'ui.training.intro', { days: training.requiredDays })}
              </p>
              <FacilityChoices locale={locale} action={t(locale,'ui.facility.train')} groups={[{id:"main",label:t(locale,'ui.screen.training'),items:training.options.map((o) => (
                  <button key={o.masteryId} style={S.tile} onClick={() => startTraining(o)}>
                    <UiArt kind="training" /><span style={S.tileName}>{text(o.nameRef)}</span>
                    <span style={{ ...S.tileNote, color: C.accent }}>
                      {t(locale, 'ui.training.level', { n: o.level })} ·{' '}
                      {t(locale, 'ui.training.exp', { n: o.experience })}
                    </span>
                  </button>
                ))}]}/>
            </>
          );
        })()
      ) : null}

      {/* ── 家 ───────────────────────────────────────────────── */}
      {view.combat === undefined && screen === 'home' && city?.home !== undefined ? (
        (() => {
          const home = city.home;
          return (
            <>
              <h2 style={{ fontSize: 15, margin: '0 0 10px' }}>
                {text(home.nameRef)}
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
                  <FacilityChoices locale={locale} action={t(locale,'ui.home.buy')} groups={[{id:"main",label:t(locale,'ui.screen.home'),items:home.options.map((o) => (
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
                            text(home.nameRef),
                          )
                        }
                      >
                        <UiArt kind="home" /><span style={S.tileName}>
                          {t(locale, 'ui.home.slots', { n: o.slotCount })}
                        </span>
                        <span style={{ ...S.tileNote, color: o.affordable ? C.accent : C.dim }}>
                          {o.price} ·{' '}
                          {o.affordable
                            ? t(locale, 'ui.home.buy')
                            : t(locale, 'ui.shop.tooExpensive')}
                        </span>
                      </button>
                    ))}]}/>
                </>
              )}
            </>
          );
        })()
      ) : null}

      {/* ── 人物 ─────────────────────────────────────────────── */}
      {view.combat === undefined && screen === 'sheet' && view.sheet !== undefined ? (
        (() => {
          const sh = view.sheet;
          const ATTRS = [
            ['muscle', 'ui.attr.muscle'],
            ['intelligence', 'ui.attr.intelligence'],
            ['reaction', 'ui.attr.reaction'],
            ['coordination', 'ui.attr.coordination'],
            ['charisma', 'ui.attr.charisma'],
          ] as const;
          const slotName = (slotId: string): string => slotId.endsWith('.body') ? t(locale, 'ui.sheet.body') : slotId.split('.').slice(2).join('.') || slotId;
          return (
            <>
              <h2>{t(locale, 'ui.menu.open')}</h2>
              <MenuTabs active={menuTab} select={setMenuTab} locale={locale} />
              {menuTab === 'formation' && <FormationBoard key={`${view.formation.revision}-${view.formation.members.join()}`} formation={view.formation} locale={locale} text={text}
                save={command => dispatch(command, { kind: 'formationSaved' }, t(locale, 'ui.menu.formation'))} />}
              {menuTab === 'quests' && <section className="quest-status-list">
                {view.quests.length === 0 && <p>{t(locale, 'ui.menu.noQuests')}</p>}
                {view.quests.map(q => <article key={q.questId}><UiArt kind="quest" /><div>
                  <h3>{t(locale, `ui.quest.kind.${q.kind}` as UiTextKey)} · {q.targetNameRef ? text(q.targetNameRef) : q.siteNameRef ? text(q.siteNameRef) : ''}</h3>
                  <p>{q.completedTargets} / {q.targetCount} · {q.settled ? t(locale, 'ui.quest.settled') : q.status === 'completed' ? t(locale, 'ui.quest.settle') : t(locale, q.status === 'expired' ? 'ui.menu.expired' : 'ui.menu.incomplete')}</p>
                  <p>{q.siteNameRef && text(q.siteNameRef)} · {t(locale, 'ui.quest.reward')} {q.reward} · {t(locale, 'ui.guild.endBy', { day: q.actualEndDeadline })}</p>
                </div></article>)}
              </section>}
              {menuTab === 'items' && <section>
                <p>{t(locale, 'ui.menu.itemsHint')}</p>
                <h3>{t(locale, 'ui.sheet.inventory')} · {sh.bag.reduce((sum, item) => sum + item.weight, 0).toFixed(1)} / {sh.carryingCapacity.toFixed(1)}</h3>
                <div className="inventory-list">{sh.bag.map(item => <div key={item.itemId}><UiArt kind="supplies" /><span>{text(item.nameRef)}</span><b>× {item.quantity}</b><small>{item.weight.toFixed(1)}</small></div>)}</div>
              </section>}
              <section hidden={menuTab !== 'equipment'}>
              <h3 className="character-sheet-name">{renderCharacterName(sh.name, text)}</h3>
              <AppearancePicker sex={sh.sex} selected={appearanceChoices[sh.characterId]} locale={locale} choose={id=>{
                try{const next=selectAppearance(appearanceChoices,sh.characterId,sh.sex,id);localStorage.setItem(appearanceStorageKey,JSON.stringify(next));setAppearanceChoices(next);setStorageError(undefined)}catch(e){setStorageError(e instanceof Error?e.message:String(e))}
              }}/>


              <div style={S.card}>
                <div style={S.row}>
                  <span style={S.label}>{t(locale, 'ui.status.health')}</span>
                  <span style={{ fontWeight: 600 }}>
                    {sh.health}/{sh.maxHealth} · {sh.mana}/{sh.maxMana}
                  </span>
                </div>
                <div style={{ ...S.row, borderBottom: 'none' }}>
                  <span style={S.label}>{t(locale, 'ui.tavern.who', {
                    sex: t(locale, sh.sex === 'female' ? 'ui.sex.female' : 'ui.sex.male'),
                    age: sh.ageYears,
                  })}</span>

                </div>
              </div>

              <p style={{ ...S.label, margin: '0 0 6px' }}>{t(locale, 'ui.sheet.attributes')}</p>
              <div style={{ ...S.card, display: 'flex', gap: 18, flexWrap: 'wrap' }}>
                {ATTRS.map(([key, textKey]) => (
                  <span key={key}>
                    <span style={S.label}>{t(locale, textKey)} </span>
                    <span style={{ fontWeight: 600 }}>{sh.primary[key] ?? 0}</span>
                  </span>
                ))}
              </div>
              <p style={{ ...S.sub, margin: '-10px 0 14px' }}>{t(locale, 'ui.sheet.attributesNote')}</p>

              <p style={{ ...S.label, margin: '0 0 6px' }}>{t(locale, 'ui.sheet.armor')}</p>
              <div style={{ ...S.grid, marginBottom: 14 }}>
                {sh.armorSlots.map((slot) => (
                  <div key={slot.slotId} style={S.tileOff}>
                    <UiArt kind="armor" /><span style={S.tileName}>{slotName(slot.slotId)}</span>
                    <span style={S.tileNote}>
                      {slot.nameRef !== undefined ? text(slot.nameRef) : t(locale, 'ui.sheet.empty')}
                    </span>
                  </div>
                ))}
              </div>

              <p style={{ ...S.label, margin: '0 0 6px' }}>{t(locale, 'ui.sheet.weaponSets')}</p>
              <div style={{ ...S.grid, marginBottom: 14 }}>
                {sh.weaponSets.map((ws) => (
                  <div
                    key={ws.weaponSetId}
                    style={{
                      ...S.card,
                      marginBottom: 0,
                      borderColor: ws.weaponSetId === pickedSet ? C.accent : C.line,
                      cursor: 'pointer',
                    }}
                    onClick={() => setPickedSet(ws.weaponSetId)}
                  >
                    <UiArt kind="weapon" /><div style={{ fontWeight: 600, marginBottom: 6 }}>
                      {t(locale, 'ui.sheet.weaponSet', { n: ws.index + 1 })}
                      {ws.weaponSetId === pickedSet ? ' ✓' : ''}
                    </div>
                    <div style={S.row}>
                      <span style={S.label}>{t(locale, 'ui.sheet.mainHand')}</span>
                      <span>
                        {ws.mainHand.nameRef !== undefined
                          ? text(ws.mainHand.nameRef)
                          : t(locale, 'ui.sheet.empty')}
                      </span>
                    </div>
                    <div style={S.row}>
                      <span style={S.label}>{t(locale, 'ui.sheet.offHand')}</span>
                      <span>
                        {ws.offHand.nameRef !== undefined
                          ? text(ws.offHand.nameRef)
                          : t(locale, 'ui.sheet.empty')}
                      </span>
                    </div>
                    {ws.skills.map((sk, i) => (
                      <div
                        key={i}
                        style={i === ws.skills.length - 1 ? { ...S.row, borderBottom: 'none' } : S.row}
                      >
                        <span style={S.label}>{t(locale, 'ui.sheet.skillSlot', { n: i + 1 })}</span>
                        <span
                          style={sk === undefined ? undefined : { color: C.accent, cursor: 'pointer' }}
                          onClick={
                            sk === undefined
                              ? undefined
                              : (e) => {
                                  e.stopPropagation();
                                  setWeaponSetSkills(ws, i, undefined);
                                }
                          }
                        >
                          {sk === undefined
                            ? t(locale, 'ui.sheet.empty')
                            : sk.nameRef !== undefined
                              ? text(sk.nameRef)
                              : skillLocal(sk.skillId)}
                        </span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>

              <p style={{ ...S.label, margin: '0 0 6px' }}>{t(locale, 'ui.sheet.skills')}</p>
              {sh.assignableSkills.length === 0 ? (
                <p style={{ ...S.sub, marginBottom: 14 }}>{t(locale, 'ui.sheet.skillsEmpty')}</p>
              ) : (
                <div style={{ ...S.grid, marginBottom: 14 }}>
                  {sh.assignableSkills.map((sk) => {
                    const set = sh.weaponSets.find((w) => w.weaponSetId === pickedSet);
                    const already = set?.skills.some((x) => x?.skillId === sk.skillId) ?? false;
                    const label = sk.nameRef !== undefined ? text(sk.nameRef) : skillLocal(sk.skillId);
                    return (
                      <button
                        key={sk.skillId}
                        style={already ? S.tileOff : S.tile}
                        disabled={already || set === undefined || set.skills.every(x => x !== undefined)}
                        title={set?.skills.every(x => x !== undefined) ? t(locale, 'ui.sheet.slotsFull') : undefined}
                        onClick={() => {
                          if (set === undefined) return;
                          const slot = set.skills.findIndex((x) => x === undefined);
                          if (slot < 0) return; // 三格都滿了：先點掉一格再配
                          setWeaponSetSkills(set, slot, sk.skillId);
                        }}
                      >
                        <UiArt kind="weapon" /><span style={S.tileName}>{label}</span>
                        <span style={{ ...S.tileNote, color: already ? C.dim : C.accent }}>
                          {sk.actionKind} ·{' '}
                          {already
                            ? t(locale, 'ui.sheet.assigned')
                            : t(locale, 'ui.sheet.assignTo', { n: (sh.weaponSets.findIndex((w) => w.weaponSetId === pickedSet) + 1) })}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}

              <p style={{ ...S.label, margin: '16px 0 6px' }}>{t(locale, 'ui.sheet.bag')}</p>
              {sh.equipable.length === 0 ? (
                <p style={{ ...S.sub, marginBottom: 14 }}>{t(locale, 'ui.sheet.bagEmpty')}</p>
              ) : (
                <div style={{ ...S.grid, marginBottom: 14 }}>
                  {sh.equipable.map((e) => (
                    <button
                      key={e.itemId}
                      style={S.tile}
                      onClick={() =>
                        dispatch(
                          {
                            type: 'equipItem',
                            characterId: sh.characterId,
                            itemId: e.itemId,
                            slotId: e.slotIds[0],
                            ...(e.equipmentKind === 'armor' ? {} : { weaponSetId: pickedSet }),
                          } as unknown as GameCommand,
                          { kind: 'equipped', item: text(e.nameRef) },
                          text(e.nameRef),
                        )
                      }
                    >
                      <UiArt kind={e.equipmentKind === 'armor' ? 'armor' : 'weapon'} /><span style={S.tileName}>{text(e.nameRef)}</span>
                      <span style={{ ...S.tileNote, color: C.accent }}>
                        {e.equipmentKind} · {t(locale, 'ui.sheet.equip')} →
                      </span>
                    </button>
                  ))}
                </div>
              )}

              <p style={{ ...S.label, margin: '0 0 6px' }}>{t(locale, 'ui.sheet.masteries')}</p>
              {sh.masteries.length === 0 ? (
                <p style={S.sub}>{t(locale, 'ui.sheet.masteriesEmpty')}</p>
              ) : (
                <div style={S.grid}>
                  {sh.masteries.map((m) => (
                    <div key={m.masteryId} style={S.tileOff}>
                      <UiArt kind="training" /><span style={S.tileName}>{text(m.nameRef)}</span>
                      <span style={S.tileNote}>
                        {t(locale, 'ui.training.level', { n: m.level })} ·{' '}
                        {t(locale, 'ui.training.exp', { n: m.experience })}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              </section>
            </>
          );
        })()
      ) : null}

      {view.combat && <CombatScreen environment={combatEnvironment(view)} key={view.combat.encounterId} combat={view.combat} locale={locale} text={text} appearanceSelections={appearanceChoices}
        act={(choice,receive)=>{
          const combat=view.combat!;
          const command:GameCommand=choice.kind==='rest'?{
            type:'combatRest',encounterId:combat.encounterId as Extract<GameCommand,{type:'combatRest'}>['encounterId'],actorId:combat.currentActorId as Extract<GameCommand,{type:'combatRest'}>['actorId'],
          }:{type:'useCombatSkill',encounterId:combat.encounterId as Extract<GameCommand,{type:'useCombatSkill'}>['encounterId'],actorId:combat.currentActorId as Extract<GameCommand,{type:'useCombatSkill'}>['actorId'],weaponSetId:choice.weaponSetId as import('../src/contracts/core').WeaponSetId,skillId:choice.skillId as Extract<GameCommand,{type:'useCombatSkill'}>['skillId'],targetCombatantIds:[choice.targetId as Extract<GameCommand,{type:'useCombatSkill'}>['targetCombatantIds'][number]]};
          const skill=choice.kind==='skill'?combat.actions.find(a=>a.skillId===choice.skillId):undefined;
          dispatch(command,choice.kind==='rest'?{kind:'combatRested'}:{kind:'usedSkill',skill:skill?.nameRef?text(skill.nameRef):skillLocal(choice.skillId)},t(locale,'ui.screen.combat'),result=>{
            if(!result.accepted){receive({accepted:false,code:result.rejectionCode});return;}
            receive({accepted:true,frames:result.combatFrames,complete:()=>setView(result.view)});
          });
        }}/>}

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
                    text(atMap.siteNameRef),
                  )
                }
              >
                {t(locale, 'ui.dungeon.enter')}
              </button>
            </div>
          </>
        ) : (
          <DungeonAdventure
            active={view.combat === undefined && screen !== 'sheet' && !view.loot}
            backdrop={!!view.combat}
            party={{leaderId:view.formation.actorCharacterId, memberIds:view.formation.members}}
            locale={locale}
            dungeon={view.dungeon}
            text={text}
            onOpenDoor={(linkId) =>
              dispatch(
                { type: 'openDungeonDoor', linkId: linkId as Extract<GameCommand, {type:'openDungeonDoor'}>['linkId'] },
                { kind: 'doorOpened' },
                text(view.dungeon!.siteNameRef),
              )
            }
            onMove={(roomId) =>
              dispatch(
                { type: 'moveDungeonRoom', targetRoomId: roomId as Extract<GameCommand, {type:'moveDungeonRoom'}>['targetRoomId'] },
                { kind: 'movedPlain', room: roomId },
                text(view.dungeon!.siteNameRef),
              )
            }
            onLeave={() =>
              dispatch(
                {
                  type: 'useDungeonExit',
                  exitRoomId: view.dungeon!.currentRoomId as Extract<GameCommand, {type:'useDungeonExit'}>['exitRoomId'],
                },
                { kind: 'leftDungeon' },
                text(view.dungeon!.siteNameRef),
              )
            }
            onFight={(contentId, who) =>
              dispatch(
                { type: 'interactDungeonContent', contentId: contentId as Extract<GameCommand, {type:'interactDungeonContent'}>['contentId'] },
                { kind: 'combatStarted', who },
                text(view.dungeon!.siteNameRef),
              )
            }
          />
        )
      ) : null}

      </section></div>
      <details className="journal"><summary>{t(locale, 'ui.play.journal')}</summary><div role="log" aria-live="polite">
        {log.map((l) => (
          <div key={l.id} style={{ color: l.tone === 'ok' ? '#3e6047' : l.tone === 'warn' ? '#994b23' : '#657367' }}>
            {renderLog(l.entry)}
          </div>
        ))}
      </div></details>
    </PlayerShell></ReceptionProvider>
  );
}


