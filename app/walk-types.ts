/** Presentation-only entrance contract. The scene never creates gameplay facts or reads saves. */
export type WalkCell = Readonly<{ row: number; col: number; floor: number }>;
export type WalkLink = Readonly<{
  linkId: string; fromRoomId: string; toRoomId: string;
  fromCell: WalkCell; toCell: WalkCell; open: boolean;
}>;
export type WalkSpace = Readonly<{
  floor: number;
  cells: readonly (WalkCell & { roomId: string })[];
  cellSize: number;
  firstCellCenter: number;
  navigation: Readonly<{ origin: number; step: number; size: number; actorRadius: number; rows: readonly string[] }>;
}>;
export type WalkState = Readonly<{
  currentRoomId: string;
  entryCell: WalkCell;
  links: readonly WalkLink[];
  canMove: boolean;
}>;
export type WalkParty = Readonly<{ leaderId: string; memberIds: readonly string[] }>;
export type WalkPosition = Readonly<{ x: number; z: number; roomId: string }>;

export function cellPosition(space: Pick<WalkSpace, 'cellSize' | 'firstCellCenter'>, cell: WalkCell) {
  return { x: space.firstCellCenter + (cell.col - 1) * space.cellSize, z: space.firstCellCenter + (cell.row - 1) * space.cellSize };
}
