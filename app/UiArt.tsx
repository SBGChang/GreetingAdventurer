import type { CSSProperties } from 'react';
import type { FacilityView } from './engine/game-facade';
import './ui-art.css';

const CELLS = {
  inn: 0, tavern: 1, guild: 2, supplies: 3,
  forge: 4, training: 5, books: 6, adventure: 7,
  gate: 8, home: 9, gold: 10, portrait: 11,
  weapon: 12, armor: 13, quest: 14, compass: 15,
} as const;
export type ArtKind = keyof typeof CELLS;
export const FACILITY_ART: Record<FacilityView['kind'], ArtKind> = {
  inn: 'inn', tavern: 'tavern', adventurerGuild: 'guild', itemShop: 'supplies',
  equipmentShop: 'forge', trainingGround: 'training', bookstore: 'books',
  adventureCheckpoint: 'adventure', cityGate: 'gate', home: 'home',
};

/** Painted category emblems, not literal portraits or individual item depictions. */
export function UiArt({ kind, className = '' }: { kind: ArtKind; className?: string }) {
  const cell = CELLS[kind];
  return <span className={`ui-art ${className}`} data-art={kind} aria-hidden="true"
    style={{ '--art-x': `${cell % 4 * 100 / 3}%`, '--art-y': `${Math.floor(cell / 4) * 100 / 3}%` } as CSSProperties} />;
}

export const SCREEN_ART: Record<string, ArtKind> = {
  shop: 'forge', guild: 'guild', tavern: 'tavern', training: 'training', home: 'home',
  sheet: 'guild', adventure: 'adventure', worldMap: 'compass',
};
