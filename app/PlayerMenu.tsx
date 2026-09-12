import { useState } from 'react';
import { GRID_MIN, GRID_MAX } from '../src/contracts/core';
import type { CharacterId } from '../src/contracts/core';
import type { GridCell } from '../src/contracts/map';
import type { ConfigureCombatFormationCommand } from '../src/contracts/team';
import type { GameView } from './engine/game-facade';
import { t, type UiLocale } from './i18n';
import { UiArt } from './UiArt';

export type MenuTab = 'equipment' | 'formation' | 'quests' | 'items';
export function MenuTabs({ active, select, locale }: { active: MenuTab; select: (tab: MenuTab) => void; locale: UiLocale }) {
  const tabs = ['equipment', 'formation', 'quests', 'items'] as const;
  const art = { equipment: 'armor', formation: 'guild', quests: 'quest', items: 'supplies' } as const;
  return <nav className="player-menu-tabs" aria-label={t(locale, 'ui.menu.open')}>
    {tabs.map(tab => <button key={tab} data-menu-tab={tab} aria-pressed={active === tab} onClick={() => select(tab)}>
      <UiArt kind={art[tab]} />{t(locale, `ui.menu.${tab}`)}
    </button>)}
  </nav>;
}

export function FormationBoard({ formation, locale, save }: {
  formation: GameView['formation']; locale: UiLocale; save: (command: ConfigureCombatFormationCommand) => void;
}) {
  const [selected, setSelected] = useState<CharacterId>();
  const [draft, setDraft] = useState<Record<CharacterId, GridCell>>(() => ({ ...formation.placements }));
  const active = selected && formation.members.includes(selected) ? selected : formation.members[0];
  const memberLabel = (id: CharacterId) => t(locale, 'ui.menu.member', { n: formation.members.indexOf(id) + 1 });
  const move = (row: number, col: number) => {
    if (!active) return;
    const old = draft[active];
    const occupant = formation.members.find(id => draft[id]?.row === row && draft[id]?.col === col);
    if (occupant === active) return;
    if (occupant && !old) { setSelected(occupant); return; }
    const placements: Record<CharacterId, GridCell> = { ...draft, [active]: { floor: 0, row, col } };
    if (occupant && old) placements[occupant] = old;
    setDraft(placements);
  };
  const coordinates = Array.from({ length: GRID_MAX - GRID_MIN + 1 }, (_, index) => GRID_MIN + index);
  return <section className="formation-editor">
    <p>{t(locale, 'ui.menu.formationHint')}</p>
    <div className="formation-members">{formation.members.map(id => <button key={id} aria-pressed={active === id} onClick={() => setSelected(id)}>
      <UiArt kind="guild" />{memberLabel(id)}
    </button>)}</div>
    <p>{t(locale, 'ui.menu.front')}</p>
    <div className="formation-board">{coordinates.flatMap(row => coordinates.map(col => {
      const occupant = formation.members.find(id => draft[id]?.row === row && draft[id]?.col === col);
      return <button key={`${row}-${col}`} data-formation-cell={`${row}-${col}`} data-occupied={!!occupant}
        aria-label={`${row} / ${col} · ${occupant ? memberLabel(occupant) : t(locale, 'ui.menu.emptyCell')}`}
        onClick={() => move(row, col)}>
        {occupant ? <><UiArt kind="guild" /><b>{memberLabel(occupant)}</b></> : <span>◇</span>}
      </button>;
    }))}</div>
    <button data-save-formation disabled={!formation.members.every(id => draft[id])}
      onClick={() => save({ type: 'configureCombatFormation', teamId: formation.teamId, actorCharacterId: formation.actorCharacterId, placements: draft })}>
      {t(locale, 'ui.menu.saveFormation')}
    </button>
  </section>;
}
