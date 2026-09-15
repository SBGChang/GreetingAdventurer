import {cellPosition,type WalkSpace,type WalkLink} from './walk-types';
import type {InteractionPresentation} from './walk-interactions';

export type MinimapLandmark = Readonly<{
  linkId:string; kind:'door'|'stairsUp'|'stairsDown'; open:boolean; x:number; z:number;
}>;

/** Known-side entrances are visible without disclosing the destination room or floor. */
export function minimapLandmarks(space:WalkSpace,links:readonly WalkLink[],knownRoomIds:readonly string[],presentation:InteractionPresentation):MinimapLandmark[]{
  const known=new Set(knownRoomIds);
  return links.flatMap<MinimapLandmark>(link=>{
    const fromKnown=link.fromCell.floor===space.floor&&known.has(link.fromRoomId);
    const toKnown=link.toCell.floor===space.floor&&known.has(link.toRoomId);
    if(!fromKnown&&!toKnown)return [];
    const here=fromKnown?link.fromCell:link.toCell,there=fromKnown?link.toCell:link.fromCell;
    const a=cellPosition(space,here),b=cellPosition(space,there);
    if(here.floor===there.floor)return [{linkId:link.linkId,kind:'door',open:link.open,x:(a.x+b.x)/2,z:(a.z+b.z)/2}];
    return [{linkId:link.linkId,kind:there.floor>here.floor?'stairsUp':'stairsDown',open:link.open,
      x:a.x+presentation.stairsLandingOffset.x,z:a.z+presentation.stairsLandingOffset.z}];
  });
}
