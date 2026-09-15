import type {CombatEnvironment} from '../combat-ground';
import type {createCombatSandbox} from './combat-sandbox';
import maps from '../assets/dungeons/catalog.json';
import atlas from '../assets/geography/atlas.json';

/** Only this test entrance translates URL controls into the formal presentation contract. */
export function combatTestEnvironment(battle:ReturnType<typeof createCombatSandbox>):CombatEnvironment{
 const query=new URLSearchParams(location.search),scene=query.get('scene')??'dungeon';
 if(scene==='dungeon'){
  const key=query.get('map');const map=key===null?maps.find(m=>m.templateId===battle.view.combat?.mapTemplateId):maps.find(m=>m.key===key);
  if(!map)throw new Error(`Unknown ground test map: ${key}`);
  return {kind:'map',id:map.templateId};
 }
 if(scene==='city'){
  const key=query.get('city');const city=key===null?atlas.cities.find(c=>battle.origin.location.kind==='city'&&c.cityId===battle.origin.location.cityId):atlas.cities.find(c=>c.key===key);
  if(!city)throw new Error(`Unknown ground test city: ${key}`);
  return {kind:'city',id:city.cityId};
 }
 if(scene==='world'){
  const id=query.get('route');const road=id===null?atlas.roads.find(r=>r.ends.some(key=>atlas.cities.find(c=>c.key===key)?.cityId===(battle.origin.location.kind==='city'?battle.origin.location.cityId:undefined))):atlas.roads.find(r=>r.routeId===id);
  if(!road)throw new Error(`Unknown ground test route: ${id}`);
  return {kind:'world',id:road.routeId};
 }
 throw new Error(`Unknown background test scene: ${scene}`);
}
