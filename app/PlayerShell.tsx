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

export function CityScene({ cityId, visible, backdrop = false, facilities, place, locale, text, visit }: {
  cityId: string; visible: boolean; backdrop?: boolean; facilities: readonly FacilityView[]; place: string; locale: UiLocale;
  text: (ref: LocalizedTextRef) => string; visit: (facility: FacilityView) => void;
}) {
  const [hovered, setHovered] = useState<string>();
  const [focused, setFocused] = useState<string>();
  useEffect(() => {
    if (!visible) { setHovered(undefined); setFocused(undefined); }
  }, [visible]);
  const activeId = hovered ?? focused;
  const available = facilities.filter(f => f.action !== 'none');
  const activeIndex = available.findIndex(f => f.facilityId === activeId);
  const active = available.find(f => f.facilityId === activeId);
  const modelUrl = modelForCity(cityId);
  return <section className="city-scene" data-backdrop={backdrop} ref={e=>e?.toggleAttribute("inert",backdrop)} hidden={!visible} aria-label={place}>
    {modelUrl ? <TownModel modelUrl={modelUrl} visible={visible} paused={backdrop} locale={locale} active={visible ? active?.kind : undefined}
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
