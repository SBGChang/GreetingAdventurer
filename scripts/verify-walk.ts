import {minimapLandmarks} from '../app/minimap-landmarks';
import {walkInteractions,canUseWalkInteraction} from '../app/walk-interactions';
import presentation from '../app/assets/dungeons/walk-presentation.json';
import assert from 'node:assert/strict';
import {createWalkController} from '../app/walk-controller';
import catalog from '../app/assets/dungeons/catalog.json';
import {dungeonNavigation} from '../app/dungeon-navigation';
import definitions from '../content/yunhua/maps.json';
import {dungeonWalkSpace} from '../app/dungeon-walk-data';
import {createAdventureFixture} from '../app/testing/adventure-fixture';
import type {WalkState} from '../app/walk-types';
function controllerFor(floor:number,mapKey='canal') {
 const fixture=createAdventureFixture(mapKey,floor),view=fixture.view;
 const space=dungeonWalkSpace(view.templateId,floor,view.floor.cells.map(c=>({...c,floor})));
 let state:WalkState={...view,links:view.links.map(l=>({...l,open:true}))};
 const c=createWalkController(space,state,roomId=>{
  const link=state.links.find(l=>l.fromRoomId===state.currentRoomId && l.toRoomId===roomId || l.toRoomId===state.currentRoomId && l.fromRoomId===roomId)!;
  state={...state,currentRoomId:roomId,entryCell:link.fromRoomId===state.currentRoomId?link.toCell:link.fromCell};return true;
 });
 return {get position(){return c.position;},canStand:c.canStand,reset:c.reset,move(dx:number,dz:number){c.move(dx,dz);c.sync(state);}};
}

for(const map of catalog)for(const floor of map.floors){
 const c=controllerFor(floor.floor,map.key),nav=dungeonNavigation[map.key]!;
 const grid=nav.floors.find(f=>f.floor===floor.floor)!;
 const template=definitions.find(t=>t.id===map.templateId)!;
 const start=c.position,visited=new Set<number>(),queue:number[]=[];
 const encode=(x:number,z:number)=>Math.round((z-nav.origin)/nav.step)*nav.size+Math.round((x-nav.origin)/nav.step);
 queue.push(encode(start.x,start.z));visited.add(queue[0]!);
 for(let i=0;i<queue.length;i++){
  const at=queue[i]!,row=Math.floor(at/nav.size),col=at%nav.size;
  for(const [r,k] of [[row-1,col],[row+1,col],[row,col-1],[row,col+1]]){
   if(r!<0||k!<0||r!>=nav.size||k!>=nav.size||grid.rows[r!]?.[k!]!=='1')continue;
   const next=r!*nav.size+k!;if(!visited.has(next)){visited.add(next);queue.push(next);}
  }
 }
 // Compare mesh connectivity to the actual same-floor graph (some floors connect via stairs).
 const expected=new Set([start.roomId]);let changed=true;
 while(changed){changed=false;for(const link of template.links!){
  if(link.fromCell.floor!==floor.floor||link.toCell.floor!==floor.floor)continue;
  if(expected.has(link.fromRoomId)||expected.has(link.toRoomId))for(const id of [link.fromRoomId,link.toRoomId])if(!expected.has(id)){expected.add(id);changed=true;}
 }}
 for(const room of floor.rooms)for(const cell of room.cells){
  const x=(cell.col-3)*6,z=(cell.row-3)*6;
  assert(c.canStand(x,z),`${map.name}: ${room.roomId} cell center blocked`);
  if(expected.has(room.roomId))assert(visited.has(encode(x,z)),`${map.name}: ${room.roomId} disconnected in actual navigation mesh`);
 }
 console.log('WALK FLOOR',map.name,floor.label,expected.size,'connected rooms');
}
for(const floor of [1,-1]){
 const c=controllerFor(floor),start=c.position;
 c.move(-100,0);assert(c.position.x>-14.6,'walls block long movements');
 c.reset();assert.deepEqual(c.position,start);
 if(floor===1){
  c.move(6,0);assert.equal(c.position.roomId,'f1.西側倉房','walk through actual doorway');
  c.move(-6,0);assert.equal(c.position.roomId,'f1.水道入口','return through doorway');
  c.reset();c.move(0,-1.8);c.move(6,0);assert.equal(c.position.roomId,'f1.水道入口','cannot pass wall beside door');
 }
 assert(c.canStand(c.position.x,c.position.z));
}
console.log('WALK CONTROLLER PASSED: walls, doors, return, no tunnelling, valid spawns');

const fixture=createAdventureFixture('canal',1),v=fixture.view;
const space=dungeonWalkSpace(v.templateId,1,v.floor.cells.map(c=>({...c,floor:1})));
let requests=0;
const closed=createWalkController(space,v,()=>{requests++;return true;});
closed.move(6,0);assert.equal(requests,0,'closed door must block without dispatching movement');
assert(closed.position.x < -9.3,'body stops before the door plane');
const opened={...v,links:v.links.map(l=>({...l,open:true}))};
const rejected=createWalkController(space,opened,()=>{requests++;return false;});
rejected.move(20,0);assert.equal(requests,1,'one request, not a retry storm within a frame');
assert.equal(rejected.position.roomId,v.currentRoomId,'rejected move never reveals the target');
const pending=createWalkController(space,opened,()=>true);
pending.move(6,0);assert.equal(pending.position.roomId,v.currentRoomId,'accepted intent waits for authoritative projection');
const target=opened.links.find(l=>l.fromRoomId===v.currentRoomId && l.toRoomId==='f1.西側倉房')!;
pending.sync({...opened,currentRoomId:target.toRoomId,entryCell:target.toCell});
assert.equal(pending.position.roomId,target.toRoomId);assert(pending.position.x < -8.8,'crossing keeps position at doorway instead of teleporting to room centre');
const before=pending.position;pending.sync({...opened,currentRoomId:target.toRoomId,entryCell:target.toCell,canMove:false});pending.move(5,5);assert.deepEqual(pending.position,before,'combat/interaction blocks movement');
assert.throws(()=>createWalkController(space,{...v,entryCell:{floor:-1,row:1,col:1}},()=>true),/Invalid adventure entrance/);
assert.throws(()=>dungeonWalkSpace('missing-template',1,space.cells),/Missing walking assets/);
assert.throws(()=>dungeonWalkSpace(v.templateId,1,[]),/differs/);
console.log('WALK AUTHORITY PASSED: closed gates, exact links, rejection, pending confirmation, retained position, blocked state, invalid entrances');

// Every authored door/stair must have an approach reachable from its own room, not across a wall.
let interactionCount=0;
for(const map of catalog)for(const floor of map.floors){
 const view=createAdventureFixture(map.key,floor.floor).view;
 const space=dungeonWalkSpace(view.templateId,floor.floor,view.floor.cells.map(c=>({...c,floor:floor.floor})));
 for(const room of floor.rooms){
  const state={...view,currentRoomId:room.roomId,entryCell:room.cells[0]!};
  const marks=minimapLandmarks(space,state.links,[room.roomId],presentation.interaction);
  assert.deepEqual(marks.map(m=>m.linkId).sort(),state.links.filter(l=>l.fromRoomId===room.roomId||l.toRoomId===room.roomId).map(l=>l.linkId).sort(),'show every known-room entrance, without remote landmarks');
  assert.equal(minimapLandmarks(space,state.links,[],presentation.interaction).length,0,'unseen floors have no door/stair icons');
  const allMarks=minimapLandmarks(space,state.links,floor.roomIds,presentation.interaction);
  assert.equal(new Set(allMarks.map(m=>m.linkId)).size,allMarks.length,'shared door has one symbol');
  const closed=walkInteractions(space,state,presentation.interaction);
  const open=walkInteractions(space,{...state,links:state.links.map(l=>({...l,open:true}))},presentation.interaction);
  for(const target of [...closed,...open]){
   const mark=marks.find(m=>m.linkId===target.linkId)!;
   assert.equal(mark.x,target.x);assert.equal(mark.z,target.z,'minimap symbol matches actual interaction landing');
   if(target.kind!=='openDoor')assert.equal(mark.kind,target.kind,'stair direction uses destination floor, including negative floors');
   let reachable=false;
   const c=createWalkController(space,state,()=>false),nav=space.navigation,size=nav.size;
   const start=Math.round((c.position.z-nav.origin)/nav.step)*size+Math.round((c.position.x-nav.origin)/nav.step),queue=[start],seen=new Set([start]);
   const cells=new Set(room.cells.map(cell=>`${cell.row},${cell.col}`));
   for(let i=0;i<queue.length&&!reachable;i++){
    const at=queue[i]!,r=Math.floor(at/size),k=at%size,x=nav.origin+k*nav.step,z=nav.origin+r*nav.step;
    if(canUseWalkInteraction(target,{x,z,roomId:room.roomId},state,presentation.interaction.reach)){reachable=true;break;}
    for(const [nr,nc] of [[r-1,k],[r+1,k],[r,k-1],[r,k+1]]){
     const nx=nav.origin+nc!*nav.step,nz=nav.origin+nr!*nav.step,next=nr!*size+nc!;
     if(!seen.has(next)&&c.canStand(nx,nz)&&cells.has(`${Math.floor((nz+15)/6)+1},${Math.floor((nx+15)/6)+1}`)){seen.add(next);queue.push(next);}
    }
   }
   assert(reachable,`${map.key}/${room.roomId}: unreachable ${target.kind} ${target.linkId}`);interactionCount++;
   assert(!canUseWalkInteraction(target,{x:target.x,z:target.z,roomId:room.roomId},{...state,canMove:false},presentation.interaction.reach),'pending/combat cannot interact');
   assert(!canUseWalkInteraction(target,{x:target.x,z:target.z,roomId:'unrelated'},state,presentation.interaction.reach),'other room cannot interact');
  }
  assert(open.every(t=>t.kind!=='openDoor'),'opening removes door interaction; stairs remain');
 }
}
console.log('SPATIAL INTERACTIONS PASSED:',interactionCount,'reachable door/stair options across all nine maps');
