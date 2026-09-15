import {cellPosition, type WalkSpace, type WalkState, type WalkPosition} from './walk-types';

export type WalkInteraction = Readonly<{
  linkId: string; roomId: string; kind: 'openDoor' | 'stairsUp' | 'stairsDown';
  x: number; z: number;
}>;
export type InteractionPresentation = Readonly<{reach:number; stairsLandingOffset:Readonly<{x:number;z:number}>;labelHeight:number}>;

/** Anchors use the actual link cells and the exported stair landing convention. */
export function walkInteractions(space:WalkSpace, state:WalkState, presentation:InteractionPresentation): WalkInteraction[] {
  return state.links.flatMap(link=>{
    if(link.fromRoomId!==state.currentRoomId && link.toRoomId!==state.currentRoomId)return [];
    const here=link.fromRoomId===state.currentRoomId?link.fromCell:link.toCell;
    const there=link.fromRoomId===state.currentRoomId?link.toCell:link.fromCell;
    if(here.floor!==space.floor)return [];
    const stairs=here.floor!==there.floor;
    if(!stairs && link.open)return [];
    const a=cellPosition(space,here),b=cellPosition(space,there);
    return [{linkId:link.linkId,roomId:link.fromRoomId===state.currentRoomId?link.toRoomId:link.fromRoomId,
      kind:!link.open?'openDoor':there.floor>here.floor?'stairsUp':'stairsDown',
      x:stairs?a.x+presentation.stairsLandingOffset.x:(a.x+b.x)/2,
      z:stairs?a.z+presentation.stairsLandingOffset.z:(a.z+b.z)/2}];
  });
}
export function canUseWalkInteraction(target:WalkInteraction, position:WalkPosition, state:WalkState, reach:number):boolean {
  return state.canMove && position.roomId===state.currentRoomId && Math.hypot(position.x-target.x,position.z-target.z)<=reach;
}
