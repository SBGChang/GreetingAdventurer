import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'vite';
const records=['content/yunhua/world-city.json','content/world/world-city.json'].flatMap(p=>JSON.parse(readFileSync(p,'utf8')));
const nodes=records.filter(d=>d.kind==='city-node');
const routes=records.filter(d=>d.kind==='route');
assert.equal(nodes.length,16);
const server=await createServer({server:{middlewareMode:true},appType:'custom'});
try{
  const {createGame}=await server.ssrLoadModule('/engine/game-facade.ts');
  const config={worldSeed:'world-travel-regression',startDay:14600,startingArchetypeId:'character-archetype.core.player-lineage',startCityId:'city-node.yunhua.yunjing',leaderSex:'female',leaderBirthDay:5475,startingMoney:5000};
  let game=createGame(config);let view=game.view;const visited=new Set([config.startCityId]);let trips=0;const initialName=view.sheet.name;
  function path(from:string,to:string):string[]{
    const queue=[[from]];const seen=new Set([from]);
    for(const p of queue){const last=p[p.length-1];if(last===to)return p.slice(1);
      for(const r of routes.filter(r=>r.fromCityId===last||r.toCityId===last)){
        const next=r.fromCityId===last?r.toCityId:r.fromCityId;if(seen.has(next))continue;seen.add(next);queue.push([...p,next]);
      }
    }throw new Error('Unreachable city '+to);
  }
  // First trip must actually cross the lake from Yunhua into Safir.
  const targets=['city-node.safir.starwell',...nodes.map(n=>n.id),config.startCityId];
  for(const target of targets){
    for(const next of path(view.location.cityId,target)){
      const link=view.city.neighbours.find((n:{toCityId:string})=>n.toCityId===next);assert(link,'formal view must expose the route');
      const mode=view.city.travelModes[0];const beforeDay=view.worldDay;
      const result=game.runCommand({type:'startCityTravel',routeId:link.routeId,toCityId:next,modeId:mode.modeId});
      assert(result.accepted,JSON.stringify(result));assert.equal(result.blocked,undefined);view=result.view;
      assert.deepEqual(view.sheet.name,initialName,'travel never renames a character');assert.equal(view.location.kind,'city');assert.equal(view.location.cityId,next);
      assert.equal(view.worldDay,beforeDay+mode.durationDays);
      assert(view.city.facilities.some((f:{kind:string})=>f.kind==='cityGate'));
      assert(view.city.facilities.some((f:{kind:string})=>f.kind==='inn'));
      const saved=game.serialize();game=createGame(config,saved);assert.equal(game.serialize(),saved,'arrival must survive save/reload');assert.deepEqual(game.view,view);
      const rest=game.runCommand({type:'rest',planKind:'cityFacilityAction'});assert(rest.accepted);assert.equal(rest.blocked,undefined);view=rest.view;assert.equal(view.worldDay,beforeDay+mode.durationDays+1);
      visited.add(next);trips++;
    }
  }
  assert.equal(visited.size,16);assert.equal(view.location.cityId,config.startCityId);
  console.log(`WORLD TRAVEL PASSED: ${visited.size} cities, ${trips} real trips, lake crossing, lodging, world days and save/reload`);
}finally{await server.close();}
