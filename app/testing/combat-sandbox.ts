import {createGame} from '../engine/game-facade';
import {PLAYER_SCENARIO} from '../../content-source/player-scenario';
import type {GameCommand} from '../../src/app/composition/messages';

/** Isolated test entrance: real combat engine, deterministic invented world, no Storage access. */
export function createCombatSandbox(configureAlternateSet=false){
 const handle=createGame({...PLAYER_SCENARIO,leaderSex:'male',worldSeed:'ui-regression'});let view=handle.view;
 const run=(command:GameCommand)=>{const result=handle.runCommand(command);if(!result.accepted)throw new Error(`Combat test entrance: ${result.rejectionCode}`);if(result.blocked)throw new Error(result.blocked);view=result.view;return result;};
 const offer=view.city?.shops.flatMap(s=>s.offers).find(o=>o.itemDefinitionId==='equipment.yunhua.ring-saber.i');
 if(!offer||!view.leader)throw new Error('Missing combat test equipment');
 run({type:'buyShopOffer',offerId:offer.offerId,payerCharacterId:view.leader.id} as Extract<GameCommand,{type:'buyShopOffer'}>);
 const item=view.sheet?.equipable.find(i=>i.equipmentKind!=='armor'),set=view.sheet?.weaponSets[0];
 if(!item||!set)throw new Error('Combat test loadout unavailable');
 run({type:'equipItem',characterId:view.leader!.id,itemId:item.itemId,slotId:item.slotIds[0],weaponSetId:set.weaponSetId} as Extract<GameCommand,{type:'equipItem'}>);
 run({type:'configureWeaponSet',characterId:view.leader!.id as import('../../src/contracts/core').CharacterId,weaponSetId:set.weaponSetId as import('../../src/contracts/core').WeaponSetId,mainHandItemId:item.itemId as import('../../src/contracts/core').ItemInstanceId,selectedSkillIds:['combat-skill.yunhua.ring-saber-l0' as import('../../src/contracts/core').SkillDefinitionId,undefined,undefined]} as Extract<GameCommand,{type:'configureWeaponSet'}>);
 if(configureAlternateSet){
  const alternate=view.sheet!.weaponSets[1]!;
  run({type:'configureWeaponSet',characterId:view.leader!.id as import('../../src/contracts/core').CharacterId,weaponSetId:alternate.weaponSetId as import('../../src/contracts/core').WeaponSetId,mainHandItemId:item.itemId as import('../../src/contracts/core').ItemInstanceId,selectedSkillIds:['combat-skill.yunhua.ring-saber-l0' as import('../../src/contracts/core').SkillDefinitionId,undefined,undefined]} as Extract<GameCommand,{type:'configureWeaponSet'}>);
 }
 const armor=view.city?.shops.flatMap(s=>s.offers).find(o=>o.equipmentKind==='armor'&&o.affordable);
 if(!armor)throw new Error('Missing test armor');
 run({type:'buyShopOffer',offerId:armor.offerId,payerCharacterId:view.leader!.id} as Extract<GameCommand,{type:'buyShopOffer'}>);
 const armorItem=view.sheet!.equipable.find(i=>i.equipmentKind==='armor')!;
 run({type:'equipItem',characterId:view.leader!.id,itemId:armorItem.itemId,slotId:armorItem.slotIds[0]} as Extract<GameCommand,{type:'equipItem'}>);
 const site=view.city?.sites.find(s=>s.nameRef.key.includes('old-canal'));
 if(!site)throw new Error('Missing combat test site');
 const origin=view;
 run({type:'enterAdventureMap',adventureSiteId:site.siteId} as Extract<GameCommand,{type:'enterAdventureMap'}>);run({type:'startPlayerExploration'});
 const visited=new Set<string>(),back:string[]=[];
 for(let guard=0;guard<50;guard++){
  const dungeon=view.dungeon;if(!dungeon)throw new Error('Missing test dungeon');
  const content=dungeon.roomContents.find(c=>(c.kind==='monsterGroup'||c.kind==='boss')&&c.available);
  if(content){run({type:'interactDungeonContent',contentId:content.contentId} as Extract<GameCommand,{type:'interactDungeonContent'}>);break;}
  visited.add(dungeon.currentRoomId);let next=dungeon.moves.find(m=>!visited.has(m.roomId));
  if(next)back.push(dungeon.currentRoomId);else{const previous=back.pop();next=dungeon.moves.find(m=>m.roomId===previous);}
  if(!next)throw new Error('Combat test has no encounter route');
  if(!next.open)run({type:'openDungeonDoor',linkId:next.linkId} as Extract<GameCommand,{type:'openDungeonDoor'}>);
  run({type:'moveDungeonRoom',targetRoomId:next.roomId} as Extract<GameCommand,{type:'moveDungeonRoom'}>);
 }
 if(!view.combat)throw new Error('No combat in test entrance');
 return {origin,get view(){return view;},run:(command:GameCommand)=>{const result=handle.runCommand(command);if(result.accepted)view=result.view;return result;},text:(ref:{key:string})=>handle.resolveText('zh-Hant',ref)??ref.key};
}
