import {useState} from 'react';
import {DungeonAdventure} from '../DungeonAdventure';
import {CityScene} from '../PlayerShell';
import {WorldMap} from '../WorldMap';
import type {CombatEnvironment} from '../combat-ground';
import {createAdventureFixture} from './adventure-fixture';
import maps from '../assets/dungeons/catalog.json';
import atlas from '../assets/geography/atlas.json';
import type {createCombatSandbox} from './combat-sandbox';

/** Test-only entrance data selects a real model; it does not create new city/world encounters. */
export function CombatTestScene({environment,battle,paused}:{environment:CombatEnvironment;battle:ReturnType<typeof createCombatSandbox>;paused:boolean}){
 const [entry]=useState(battle.view);
 const place=environment.kind==='map'?'dungeon':environment.kind;
 const [dungeon]=useState(()=>{if(environment.kind!=='map'||environment.id===entry.combat?.mapTemplateId)return entry.dungeon;const map=maps.find(m=>m.templateId===environment.id);if(!map)throw new Error('Missing test dungeon');return createAdventureFixture(map.key,map.floors[0]!.floor).view});
 const cityId=environment.kind==='city'?environment.id:environment.kind==='world'?atlas.cities.find(c=>c.key===atlas.roads.find(r=>r.routeId===environment.id)?.ends[0])?.cityId:undefined;
 const origin=battle.origin;
 if(!entry.dungeon||!origin.city||origin.location.kind!=='city')throw new Error('Missing combat entrance scene data');
 return <div className="combat-background-test" data-background-kind={place}>
  {place==='dungeon'?<DungeonAdventure active={false} backdrop party={{leaderId:entry.formation.actorCharacterId,memberIds:entry.formation.members}} locale="zh-Hant" dungeon={dungeon!} text={battle.text} onMove={()=>false} onOpenDoor={()=>false} onFight={()=>false} onLeave={()=>false}/>:
   place==='city'?<CityScene cityId={cityId!} visible backdrop={paused} facilities={cityId===origin.location.cityId?origin.city.facilities:[]} place={atlas.cities.find(c=>c.cityId===cityId)!.name} locale="zh-Hant" text={battle.text} visit={()=>{}}/>:
   <WorldMap city={origin.city} currentCityId={cityId!} locale="zh-Hant" text={battle.text} paused={paused} onTravel={()=>{}}/>}
 </div>;
}
