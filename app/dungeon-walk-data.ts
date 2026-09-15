import catalog from './assets/dungeons/catalog.json';
import presentation from './assets/dungeons/walk-presentation.json';
import { dungeonNavigation } from './dungeon-navigation';
import type { WalkCell, WalkSpace } from './walk-types';

/** Attach exported collision geometry to supplied formal topology. Never substitute another map. */
export function dungeonWalkSpace(templateId: string, floor: number, cells: readonly (WalkCell & {roomId: string})[]): WalkSpace {
  const map = catalog.find(m => m.templateId === templateId);
  const art = map?.floors.find(f => f.floor === floor);
  const navigation = map && dungeonNavigation[map.key];
  const grid = navigation?.floors.find(f => f.floor === floor);
  if (!map || !art || !navigation || !grid) throw new Error(`Missing walking assets: ${templateId}, floor ${floor}`);
  const signature = (input: typeof cells) => input.map(c => `${c.floor}:${c.row},${c.col}:${c.roomId}`).sort().join('|');
  if (map.cellSize !== presentation.cellSize || signature(cells) !== signature(art.rooms.flatMap(r => r.cells.map(c => ({...c, roomId:r.roomId}))))) throw new Error(`Walking geometry differs from map definition: ${templateId}`);
  return { floor, cells, cellSize: presentation.cellSize, firstCellCenter: presentation.firstCellCenter,
    navigation: {origin:navigation.origin, step:navigation.step, size:navigation.size, actorRadius:navigation.actorRadius, rows:grid.rows} };
}
