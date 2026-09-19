import { gunzipSync } from 'node:zlib';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'vite';
import { PLAYER_SCENARIO } from '../content-source/player-scenario';
const maps = JSON.parse(readFileSync('content/yunhua/maps.json','utf8'));
const world = JSON.parse(readFileSync('content/yunhua/world-city.json','utf8'));
const routes = world.filter((d:any)=>d.kind==='route');
const server=await createServer({server:{middlewareMode:true},appType:'custom'});
try {
 const {createGame}=await server.ssrLoadModule('/engine/game-facade.ts');
 const config={...PLAYER_SCENARIO,worldSeed:'ui-regression'};
 let game=createGame(config);let v=game.view;
 const state=()=>JSON.parse(JSON.parse(game.serialize()).payload).state;
 const run=(command:any)=>{const result=game.runCommand(command);assert(result.accepted,JSON.stringify({command,rejection:result.rejectionCode}));assert(!result.blocked,JSON.stringify(result.blocked));v=result.view;return v;};
 const resume=()=>{const saved=game.serialize();game=createGame(config,saved);v=game.view;assert.equal(game.serialize(),saved);};
 function path(from:string,to:string,edges:any[],fromKey:string,toKey:string):string[]{const queue=[[from]];const seen=new Set([from]);for(const p of queue){const last=p.at(-1)!;if(last===to)return p.slice(1);for(const edge of edges.filter(e=>e[fromKey]===last||e[toKey]===last)){const next=edge[fromKey]===last?edge[toKey]:edge[fromKey];if(!seen.has(next)){seen.add(next);queue.push([...p,next]);}}}throw Error('No path '+from+' -> '+to);}
 function travel(cityId:string){for(const next of path(v.location.cityId,cityId,routes,'fromCityId','toCityId')){const route=v.city.neighbours.find((n:any)=>n.toCityId===next);run({type:'startCityTravel',routeId:route.routeId,toCityId:next,modeId:v.city.travelModes[0].modeId});}}
 function settle(questId:string){const quest=v.city.guild.accepted.find((q:any)=>q.questId===questId);assert(quest.canSettle);const before=v.balance;run({type:'settleQuest',questId});assert.equal(v.balance,before+quest.reward);assert(state().progression.masteryLedger['quest:'+questId]);const saved=game.serialize();assert(!game.runCommand({type:'settleQuest',questId}).accepted);assert.equal(game.serialize(),saved);}
 const initial=game.serialize();
 const purchase=v.city.guild.offers.find((q:any)=>q.kind==='purchase');assert(purchase);
 const purchaseState=state().quest.quests[purchase.questId];
 const locked=game.runCommand({type:'buyShopOffer',offerId:purchaseState.objective.shopOfferId,payerCharacterId:v.leader.id});assert(!locked.accepted);assert.equal(game.serialize(),initial);
 run({type:'acceptQuest',questId:purchase.questId});
 assert(!game.runCommand({type:'handInQuestCargo',questId:purchase.questId}).accepted);
 run({type:'buyShopOffer',offerId:purchaseState.objective.shopOfferId,payerCharacterId:v.leader.id});resume();
 assert.equal(state().inventory.items[purchaseState.objective.itemId].location.kind,'teamQuestCargo');
 run({type:'handInQuestCargo',questId:purchase.questId});assert.equal(state().inventory.items[purchaseState.objective.itemId].state,'removed');settle(purchase.questId);
 console.log('PURCHASE PASSED: reserve, accept, buy, carry, save/reload, hand in, reward and XP, duplicate rejection');
 game=createGame(config,initial);v=game.view;
 const delivery=v.city.guild.offers.find((q:any)=>q.kind==='delivery');assert(delivery);
 const deliveryState=state().quest.quests[delivery.questId];const origin=v.location.cityId;
 const before=v.balance;run({type:'acceptQuest',questId:delivery.questId});assert.equal(v.balance,before);resume();
 assert.equal(state().inventory.items[deliveryState.objective.itemId].location.kind,'teamQuestCargo');
 assert(!game.runCommand({type:'handInQuestCargo',questId:delivery.questId}).accepted);
 travel(deliveryState.objective.destinationCityId);assert(v.city.guild.accepted.some((q:any)=>q.questId===delivery.questId&&q.canHandIn));
 run({type:'handInQuestCargo',questId:delivery.questId});assert(!game.runCommand({type:'settleQuest',questId:delivery.questId}).accepted);
 travel(origin);settle(delivery.questId);
 console.log('DELIVERY PASSED: real cargo, real road travel, destination hand-in, return to original guild');
 // Expiry returns unsold goods to ordinary commerce and sends collected goods through distribution.
 game=createGame(config,initial);v=game.view;
 const expiredOffer=state().city.shopOffers[purchaseState.objective.shopOfferId];
 while(v.worldDay < purchaseState.acceptDeadline)run({type:'rest',planKind:'cityFacilityAction'});
 assert.equal(state().quest.quests[purchase.questId].status,'expired');
 assert.equal(state().city.shopOffers[expiredOffer.offerId].sourceQuestId,undefined);
 assert.equal(state().inventory.items[purchaseState.objective.itemId].state,'active');
 game=createGame(config,initial);v=game.view;run({type:'acceptQuest',questId:delivery.questId});
 while(v.worldDay < deliveryState.actualEndDeadline)run({type:'rest',planKind:'cityFacilityAction'});
 assert.equal(state().quest.quests[delivery.questId].status,'expired');assert(v.loot, 'Expired cargo must reach the actual distribution UI');
 for(let n=0;v.loot&&n<30;n++){run({type:'passLootItem',distributionId:v.loot.distributionId,bidderCharacterId:v.leader.id,itemId:v.loot.itemId});run({type:'resolveLootAuctionRound',distributionId:v.loot.distributionId,itemId:v.loot.itemId});}
 assert(!v.loot);assert.notEqual(state().inventory.items[deliveryState.objective.itemId].location.kind,'teamQuestCargo');
 assert(!state().progression.masteryLedger['quest:'+delivery.questId]);resume();
 console.log('EXPIRY PASSED: unsold stock released; collected cargo distributed; no quest reward or stuck cargo');
 game=createGame(config,initial);v=game.view;
 const protectedQuest=v.city.guild.offers.find((q:any)=>q.kind==='rescue');run({type:'acceptQuest',questId:protectedQuest.questId});
 const protectedMapId=state().quest.quests[protectedQuest.questId].objective.mapId;
 const protectedVersion=state().map.instances[protectedMapId].currentVersion;
 for(let day=0;day<14;day++)run({type:'rest',planKind:'cityFacilityAction'});
 assert.equal(state().map.instances[protectedMapId].currentVersion,protectedVersion,'Accepted rescue and guards must survive scheduled refresh');
 console.log('TARGET PROTECTION PASSED: accepted rescue survives fourteen days of map refresh checks');
 game=createGame(config,initial);v=game.view;
 for(let day=0;day<35;day++)run({type:'rest',planKind:'cityFacilityAction'});
 const refreshedCargo=v.city.guild.offers.filter((q:any)=>q.kind==='purchase'||q.kind==='delivery');assert(refreshedCargo.length);
 for(const quest of refreshedCargo)run({type:'acceptQuest',questId:quest.questId});
 console.log('REFRESHED STOCK PASSED: cargo quests remain acceptable after thirty-five days and reused inventory');
 // All nine actual maps must have an accessible monster and expose it through the player facade.
 const opening=JSON.parse(JSON.parse(initial).payload).state;
 for(const instance of Object.values(opening.map.instances) as any[]){
  const template=maps.find((d:any)=>d.id===instance.templateId);assert(template);
  const site=world.find((d:any)=>d.id===instance.adventureSiteId);assert(site);
  game=createGame({...config,startCityId:site.accessCityId});v=game.view;
  run({type:'enterAdventureMap',adventureSiteId:site.id});run({type:'startPlayerExploration'});
  const contents=Object.values(state().map.contents) as any[];
  const monster=contents.find(c=>c.mapId===v.location.mapId&&(c.kind==='monsterGroup'||c.kind==='boss')&&c.state==='available');assert(monster);
  for(const next of path(v.dungeon.currentRoomId,monster.position.roomId,template.links,'fromRoomId','toRoomId')){const move=v.dungeon.moves.find((m:any)=>m.roomId===next);assert(move);if(!move.open)run({type:'openDungeonDoor',linkId:move.linkId});run({type:'moveDungeonRoom',targetRoomId:next});}
  assert(v.dungeon.roomContents.some((c:any)=>c.contentId===monster.contentId&&c.nameRef));
  run({type:'interactDungeonContent',contentId:monster.contentId});assert(v.combat?.combatants.some((c:any)=>c.side==='enemy'));
 }
 console.log('NINE DUNGEONS PASSED: navigate rooms and start real monster encounters in every map');
 game=createGame(config,initial);v=game.view;
 const rescue=v.city.guild.offers.find((q:any)=>q.kind==='rescue');assert(rescue);
 const rescueState=state().quest.quests[rescue.questId];const captive=state().map.contents[rescueState.objective.contentId];
 const instance=state().map.instances[rescueState.objective.mapId];const template=maps.find((d:any)=>d.id===instance.templateId);
 const weapon=v.city.shops.flatMap((s:any)=>s.offers).find((o:any)=>o.itemDefinitionId==='equipment.yunhua.ring-saber.i');assert(weapon);
 run({type:'buyShopOffer',offerId:weapon.offerId,payerCharacterId:v.leader.id});
 const item=v.sheet.equipable.find((i:any)=>i.equipmentKind==='weapon');const set=v.sheet.weaponSets[0];
 run({type:'equipItem',characterId:v.leader.id,itemId:item.itemId,slotId:item.slotIds[0],weaponSetId:set.weaponSetId});
 run({type:'configureWeaponSet',characterId:v.leader.id,weaponSetId:set.weaponSetId,mainHandItemId:item.itemId,selectedSkillIds:['combat-skill.yunhua.ring-saber-l0',undefined,undefined]});
 run({type:'acceptQuest',questId:rescue.questId});
 run({type:'enterAdventureMap',adventureSiteId:instance.adventureSiteId});run({type:'startPlayerExploration'});
 function walk(roomId:string){for(const next of path(v.dungeon.currentRoomId,roomId,template.links,'fromRoomId','toRoomId')){const move=v.dungeon.moves.find((m:any)=>m.roomId===next);if(!move.open)run({type:'openDungeonDoor',linkId:move.linkId});run({type:'moveDungeonRoom',targetRoomId:next});}}
 walk(captive.position.roomId);const blocked=game.runCommand({type:'interactDungeonContent',contentId:captive.contentId});assert(!blocked.accepted);assert.equal(blocked.rejectionCode,'dungeon.interactDungeonContent.guardsUnresolved');
 for(const guardId of captive.payload.controllerContentIds){walk(state().map.contents[guardId].position.roomId);run({type:'interactDungeonContent',contentId:guardId});for(let turn=0;v.combat&&turn<100;turn++){const c=v.combat;const skill=c.actions.find((a:any)=>a.available&&a.actionKind==='attack');const target=c.combatants.find((x:any)=>x.side==='enemy'&&x.state!=='dead'&&x.health>0);assert(skill&&target);run({type:'useCombatSkill',encounterId:c.encounterId,actorId:c.currentActorId,skillId:skill.skillId,targetCombatantIds:[target.combatantId]});}assert(!v.combat);assert.equal(state().map.contents[guardId].state,'resolved');}
 walk(captive.position.roomId);run({type:'interactDungeonContent',contentId:captive.contentId});resume();
 const temporary=state().quest.quests[rescue.questId].objective.characterId;assert(temporary);assert(state().team.teams[state().team.playerTeamId].temporaryMemberIds.includes(temporary));assert.equal(state().quest.quests[rescue.questId].status,'incomplete');
 walk(template.exitRoomIds[0]);run({type:'useDungeonExit',exitRoomId:v.dungeon.currentRoomId});
 for(let n=0;v.loot&&n<30;n++){run({type:'passLootItem',distributionId:v.loot.distributionId,bidderCharacterId:v.leader.id,itemId:v.loot.itemId});run({type:'resolveLootAuctionRound',distributionId:v.loot.distributionId,itemId:v.loot.itemId});}
 assert.equal(v.location.kind,'city');assert.equal(state().quest.quests[rescue.questId].status,'completed');assert(!state().team.teams[state().team.playerTeamId].temporaryMemberIds.includes(temporary));assert.equal(state().character.characters[temporary].availability,'unavailable');settle(rescue.questId);
 console.log('RESCUE PASSED: guards block rescue, real victory, captive joins, save/reload, exit, recovery and reward');
 // The predecessor fixture is captured from the previous production build, not a rewritten state.
 {const old=gunzipSync(readFileSync('src/testing/fixtures/pre-guild-upgrade.save.json.gz')).toString('utf8');const oldState=JSON.parse(JSON.parse(old).payload).state;game=createGame(config,old);v=game.view;const upgraded=state();assert.equal(upgraded.core.worldDay,oldState.core.worldDay);assert.deepEqual({...upgraded.character,characters:Object.fromEntries(Object.entries(upgraded.character.characters).map(([id,c]:[string,any])=>{const {name,...prior}=c;assert(name);return [id,prior];}))},oldState.character);assert.deepEqual(upgraded.team,oldState.team);assert.deepEqual(upgraded.economy,oldState.economy);for(const q of Object.values(oldState.quest.quests) as any[])assert.deepEqual(upgraded.quest.quests[q.questId],q);assert.equal(Object.values(upgraded.map.contents).filter((c:any)=>c.kind==='monsterGroup').length,33);assert(Object.values(upgraded.quest.quests).some((q:any)=>q.kind==='delivery'));resume();console.log('SAVE UPGRADE PASSED: day, team, characters, money and previous quests preserved; missing encounters and cargo quests added');}
}finally{await server.close();}
