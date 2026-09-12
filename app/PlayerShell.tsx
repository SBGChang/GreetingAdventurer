import { useEffect, useState, type ReactNode } from 'react';
import type { GameView, FacilityView } from './engine/game-facade';
import type { LocalizedTextRef } from '../src/contracts/core';
import { t, type UiLocale } from './i18n';
import { UiArt, FACILITY_ART } from './UiArt';
import { modelForCity, renderForCity } from './geography';
import { TownModel } from './TownModel';
import './player.css';

/** One landscape composition, uniformly fitted without scrolling the desktop. */
export function GameViewport({ children }: { children: ReactNode }) {
  const [scale, setScale] = useState(() => Math.min(window.innerWidth / 1440, window.innerHeight / 810));
  useEffect(() => {
    const resize = () => setScale(Math.min(window.innerWidth / 1440, window.innerHeight / 810));
    window.addEventListener('resize', resize); resize();
    return () => window.removeEventListener('resize', resize);
  }, []);
  return <div className="game-viewport"><div className="game-stage" style={{ transform: `translate(-50%, -50%) scale(${scale})` }}>{children}</div></div>;
}

export function PlayerShell({ children, locale, view, place, screen, navigate }: {
  children: ReactNode; locale: UiLocale; view: GameView; place: string; screen: string;
  navigate: (screen: 'city' | 'adventure' | 'worldMap' | 'guild' | 'sheet') => void;
}) {
  const locked = !!view.combat || !!view.loot;
  const mode = view.combat ? 'combat' : view.dungeon ? 'dungeon' : 'town';
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !locked) navigate('city');
    };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, [locked, navigate]);
  const backdrop=view.location.kind === 'city' ? renderForCity(view.location.cityId) : undefined;
  return <GameViewport><div className={`game-shell scene-${mode}`}>
    <div className="scene-backdrop" style={backdrop ? { backgroundImage: `url(${backdrop})` } : undefined} aria-hidden />
    <header className="player-hud" data-culture={view.cultureId}>
      <strong className="location-plaque">{place}</strong>
      <span className="date-plaque">{t(locale, 'ui.status.worldDay')} · {view.worldDay.toLocaleString()}</span>
    </header>
    <main className="game-main" data-screen={screen}>{children}</main>
    <footer className="game-bottom"><nav aria-label={t(locale, 'ui.menu.open')}>
      <button data-player-menu aria-current={screen === 'sheet' ? 'page' : undefined} disabled={locked}
        onClick={() => navigate(screen === 'sheet' ? 'city' : 'sheet')}><UiArt kind="supplies" /><span className="nav-caption">{t(locale, 'ui.menu.open')}</span></button>
    </nav></footer>
  </div></GameViewport>;
}

export function CityScene({ cityId, facilities, place, locale, text, visit }: {
  cityId: string; facilities: readonly FacilityView[]; place: string; locale: UiLocale;
  text: (ref: LocalizedTextRef) => string; visit: (facility: FacilityView) => void;
}) {
  const [hovered, setHovered] = useState<string>();
  const [focused, setFocused] = useState<string>();
  const activeId = hovered ?? focused;
  const available = facilities.filter(f => f.action !== 'none');
  const activeIndex = available.findIndex(f => f.facilityId === activeId);
  const active = available.find(f => f.facilityId === activeId);
  const modelUrl = modelForCity(cityId);
  return <section className="city-scene" aria-label={place}>
    {modelUrl ? <TownModel modelUrl={modelUrl} locale={locale} active={active?.kind}
      facilities={available.map(f => ({ kind: f.kind, name: text(f.nameRef) }))}
      onHover={kind => setHovered(available.find(f => f.kind === kind)?.facilityId)}
      onVisit={kind => { const facility = available.find(f => f.kind === kind); if (facility) visit(facility); }} /> : <p role="alert">{t(locale,'ui.scene.modelError')}</p>}
    <aside className="building-sidebar">
      <nav data-expanded={activeIndex >= 0} aria-label={t(locale,'ui.scene.buildings')}>
        {available.map((f,index) => <button key={f.facilityId} data-building-tab={f.kind}
          data-active={activeId === f.facilityId} data-neighbor={activeIndex >= 0 && Math.abs(index - activeIndex) === 1}
          onPointerEnter={() => setHovered(f.facilityId)} onPointerLeave={() => setHovered(undefined)}
          onFocus={() => { setHovered(undefined); setFocused(f.facilityId); }} onBlur={() => setFocused(undefined)} onClick={() => visit(f)}>
          <UiArt kind={FACILITY_ART[f.kind]} /><span className="building-caption">{text(f.nameRef)}</span>
        </button>)}
      </nav>
    </aside>
  </section>;
}

export function CombatFigure({ enemy, crab }: { enemy: boolean; crab: boolean }) {
  return <svg className="combat-figure" viewBox="0 0 140 170" aria-hidden="true">
    <ellipse cx="70" cy="155" rx="42" ry="10" fill="#000" opacity=".3" />
    {crab ? <g stroke="#302322" strokeWidth="3"><path d="M39 120 13 132 8 110 29 94M101 120 128 131 134 110 112 94M38 85 19 63 14 41 34 53 41 73M102 85 121 63 128 42 108 52 99 73" fill="none" stroke="#a46645" strokeWidth="9"/><path d="M32 99Q29 64 70 63Q111 64 108 100L98 128Q70 148 42 128Z" fill="#855b41"/><path d="M43 97 70 80 97 97 88 121 52 121Z" fill="#bc9564"/><path d="M46 84 48 66M94 84 92 66" stroke="#e9c993" strokeWidth="7"/><circle cx="49" cy="65" r="5" fill="#f3d672"/><circle cx="92" cy="65" r="5" fill="#f3d672"/></g>
      : <g stroke="#2c302b" strokeWidth="3"><path d="M50 119 46 153H61L71 116M79 117 83 153H99L93 116" fill="#3b3730"/><path d="M47 72 27 129 59 141 74 107 100 138 114 119 95 71Z" fill={enemy ? "#703e34" : "#344f48"}/><path d="M59 69 50 113 87 121 87 70Z" fill="#9c835b"/><path d="m51 79-19 23 9 10 20-18m28-14 23 23-7 11-27-22" fill="#59684e"/><path d="m105 106 27-39-14 53" fill="#d0d8cc"/><path d="M58 44Q57 27 73 25Q95 29 89 52L81 69H65Z" fill="#cda97e"/><path d="M51 41 92 42 85 25 61 27Z" fill="#2c3733"/><path d="M64 32Q55 5 74 15L79 30" fill="#2c3733"/><path d="M51 104 92 106" stroke="#ddb465" strokeWidth="6"/></g>}
  </svg>;
}

export function Welcome({ locale, hasSave, onContinue, onStart, error }: {
  locale: UiLocale; hasSave: boolean; error?: string; onContinue: () => void;
  onStart: (seed: string, sex: 'female' | 'male') => void;
}) {
  return <GameViewport><main className="welcome">
    <div className="title-shade" /><div className="title-emblem">✦</div>
    <section className="welcome-panel"><span className="eyebrow">GREETING ADVENTURER</span>
      <h1>{t(locale, 'ui.app.title')}</h1><p className="welcome-lead">{t(locale, 'ui.play.tagline')}</p>
      {error && <p role="alert">{error}</p>}
      {hasSave && <button className="primary continue" onClick={onContinue}>{t(locale, 'ui.play.continue')} →</button>}
      <details open={!hasSave}><summary>{t(locale, 'ui.play.new')}</summary>
        <form onSubmit={event => {event.preventDefault(); const data = new FormData(event.currentTarget);
          onStart(String(data.get('seed')).trim(), data.get('sex') === 'male' ? 'male' : 'female');}}>
          <label>{t(locale, 'ui.play.seed')}<input name="seed" required maxLength={100} defaultValue="my-adventure" /></label>
          <label>{t(locale, 'ui.play.sex')}<select name="sex"><option value="female">{t(locale, 'ui.sex.female')}</option><option value="male">{t(locale, 'ui.sex.male')}</option></select></label>
          <button className="primary" type="submit">{t(locale, 'ui.play.begin')} ↗</button>
        </form>
      </details>
      <ol className="field-guide">{(['ui.play.step1','ui.play.step2','ui.play.step3','ui.play.step4'] as const).map(key => <li key={key}>{t(locale,key)}</li>)}</ol>
    </section><span className="title-edition">雲華篇 · THE YUNHUA CHRONICLES</span>
  </main></GameViewport>;
}
