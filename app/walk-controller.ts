import { cellPosition, type WalkPosition, type WalkSpace, type WalkState } from './walk-types';

/** Geometry constrains steps; only supplied authoritative state permits a room change. */
export function createWalkController(space: WalkSpace, initial: WalkState, requestMove: (roomId: string) => boolean) {
  const nav = space.navigation;
  const cells = new Map(space.cells.map(c => [`${c.row},${c.col}`, c.roomId]));
  const cellAt = (x: number, z: number) => ({
    row: Math.floor((z - space.firstCellCenter + space.cellSize / 2) / space.cellSize) + 1,
    col: Math.floor((x - space.firstCellCenter + space.cellSize / 2) / space.cellSize) + 1,
    floor: space.floor,
  });
  const roomAt = (x: number, z: number) => { const c = cellAt(x, z); return cells.get(`${c.row},${c.col}`); };
  const canStand = (x: number, z: number) => {
    const row = Math.round((z - nav.origin) / nav.step), col = Math.round((x - nav.origin) / nav.step);
    return row >= 0 && col >= 0 && row < nav.size && col < nav.size && nav.rows[row]?.[col] === '1' && roomAt(x, z) !== undefined;
  };
  let state = initial;
  let { x, z } = cellPosition(space, initial.entryCell);
  let pending: WalkPosition | undefined;
  let attempted = false;
  const validateSpawn = () => {
    if (state.entryCell.floor !== space.floor || !canStand(x, z) || roomAt(x, z) !== state.currentRoomId) throw new Error('Invalid adventure entrance: room, floor or navigation mismatch');
  };
  validateSpawn();
  const matches = (a: { row: number; col: number }, b: { row: number; col: number }) => a.row === b.row && a.col === b.col;
  const step = (nextX: number, nextZ: number) => {
    if (!canStand(nextX, nextZ)) return;
    // Stop the body before a closed door, not after its centre has crossed the mesh.
    for (const link of state.links) {
      if (link.open || link.fromCell.floor !== space.floor || link.toCell.floor !== space.floor) continue;
      const a = cellPosition(space, link.fromCell), b = cellPosition(space, link.toCell);
      const midX = (a.x + b.x) / 2, midZ = (a.z + b.z) / 2;
      const normal = a.x !== b.x ? Math.abs(nextX - midX) : Math.abs(nextZ - midZ);
      const lateral = a.x !== b.x ? Math.abs(nextZ - midZ) : Math.abs(nextX - midX);
      if (normal < nav.actorRadius && lateral < space.cellSize / 2) return;
    }
    const nextRoom = roomAt(nextX, nextZ)!;
    if (nextRoom !== state.currentRoomId) {
      const from = cellAt(x, z), to = cellAt(nextX, nextZ);
      const link = state.links.find(l => l.open && l.fromCell.floor === space.floor && l.toCell.floor === space.floor && (
        l.fromRoomId === state.currentRoomId && l.toRoomId === nextRoom && matches(l.fromCell, from) && matches(l.toCell, to) ||
        l.toRoomId === state.currentRoomId && l.fromRoomId === nextRoom && matches(l.toCell, from) && matches(l.fromCell, to)
      ));
      if (!link) return;
      attempted = true;
      pending = { x: nextX, z: nextZ, roomId: nextRoom };
      if (!requestMove(nextRoom)) pending = undefined;
      return;
    }
    x = nextX; z = nextZ;
  };
  return {
    get position(): WalkPosition { return { x, z, roomId: state.currentRoomId }; }, canStand,
    sync(next: WalkState) {
      if (next === state) return;
      if (next.currentRoomId !== state.currentRoomId) {
        const at = pending?.roomId === next.currentRoomId ? pending : cellPosition(space, next.entryCell);
        x = at.x; z = at.z;
      }
      state = next; pending = undefined;
      validateSpawn();
    },
    move(dx: number, dz: number) {
      if (!state.canMove || pending || !Number.isFinite(dx) || !Number.isFinite(dz)) return;
      // Substeps prevent tunnelling; one boundary request at most per move.
      attempted = false;
      const n = Math.max(1, Math.ceil(Math.hypot(dx, dz) / Math.min(.06, nav.step / 2)));
      for (let i = 0; i < n; i++) {
        step(x + dx / n, z); if (attempted) break;
        step(x, z + dz / n); if (attempted) break;
      }
    },
    reset() { ({ x, z } = cellPosition(space, state.entryCell)); pending = undefined; validateSpawn(); },
  };
}
