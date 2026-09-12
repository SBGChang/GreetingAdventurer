import { PLAYER_SCENARIO } from '../content-source/player-scenario';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
const server=await createServer({server:{middlewareMode:true},appType:'custom'});
try {
 const {createGame}=await server.ssrLoadModule('/engine/game-facade.ts');
 const game=createGame({...PLAYER_SCENARIO,worldSeed:'ui-regression'});
 let v=game.view;
 const run=(c:any)=>{const r=game.runCommand(c);assert(r.accepted, JSON.stringify({c,rejection:r.rejectionCode}));assert(!r.blocked,`blocked ${r.blocked}`); v=r.view;return v;};
 const formationCommand = {type:'configureCombatFormation',teamId:v.formation.teamId,actorCharacterId:v.formation.actorCharacterId,placements:{...v.formation.placements,[v.leader.id]:{floor:0,row:1,col:2}}};
 const formationDay = v.worldDay;
 run(formationCommand);
 assert.equal(v.worldDay,formationDay);
 assert.equal(v.formation.placements[v.leader.id].col,2);
 assert.deepEqual(createGame({},game.serialize()).view.formation,v.formation);
 const offers=v.city.shops.flatMap((s:any)=>s.offers);
 const weapon=offers.find((o:any)=>o.itemDefinitionId==='equipment.yunhua.ring-saber.i');
 run({type:'buyShopOffer',offerId:weapon.offerId,payerCharacterId:v.leader.id,quantity:1});
 const item=v.sheet.equipable.find((i:any)=>i.equipmentKind!=='armor');
 const set=v.sheet.weaponSets[0];
 run({type:'equipItem',characterId:v.leader.id,itemId:item.itemId,slotId:item.slotIds[0],weaponSetId:set.weaponSetId});
 run({type:'configureWeaponSet',characterId:v.leader.id,weaponSetId:set.weaponSetId,mainHandItemId:item.itemId,selectedSkillIds:['combat-skill.yunhua.ring-saber-l0',undefined,undefined]});
 const armor=offers.find((o:any)=>o.itemDefinitionId==='equipment.yunhua.medium-armor.iii');
 run({type:'buyShopOffer',offerId:armor.offerId,payerCharacterId:v.leader.id,quantity:1});
 const armorItem=v.sheet.equipable.find((i:any)=>i.equipmentKind==='armor');
 run({type:'equipItem',characterId:v.leader.id,itemId:armorItem.itemId,slotId:armorItem.slotIds[0]});
 const resaleGame = createGame({},game.serialize());
 const resaleBuy = resaleGame.runCommand({type:'buyShopOffer',offerId:v.city.shops.flatMap((s:any)=>s.offers).find((o:any)=>o.itemDefinitionId.startsWith('equipment.') && o.affordable).offerId,payerCharacterId:v.leader.id});
 assert(resaleBuy.accepted);
 const resaleShop = resaleBuy.view.city.shops.find((s:any)=>s.sellable.length > 0);
 const resaleItem = resaleShop.sellable[0]; const beforeSale=resaleBuy.view.balance;
 const sold = resaleGame.runCommand({type:'sellItemToShop',itemId:resaleItem.itemId,sellerCharacterId:v.leader.id,cityId:resaleBuy.view.location.cityId,facilityId:resaleShop.facilityId});
 assert(sold.accepted); assert.equal(sold.view.balance,beforeSale+resaleItem.price);
 const site=v.city.sites[0];
 const quests=v.city.guild.offers.filter((q:any)=>q.siteNameRef?.key===site.nameRef.key);
 for(const q of quests)run({type:'acceptQuest',questId:q.questId});
 run({type:'enterAdventureMap',adventureSiteId:site.siteId});run({type:'startPlayerExploration'});

 const visited=new Set<string>();const stack:string[]=[];let fights=0; let lootRounds=0; let resumedCombat=false;
 for(let turn=0;turn<400;turn++){
  if(v.combat){
   const c=v.combat;const skill=c.actions.find((a:any)=>a.available&&a.actionKind==='attack');const target=c.combatants.find((x:any)=>x.side==='enemy'&&x.state!=='dead'&&x.health>0);
   assert(skill, 'No usable combat skill: '+JSON.stringify(c.actions));
   if (!resumedCombat) {
     const lockedSnapshot = game.serialize();
     const locked = game.runCommand(formationCommand);
     assert.equal(locked.accepted,false);
     assert.equal(locked.rejectionCode,'team/formation-active-combat');
     assert.equal(game.serialize(),lockedSnapshot);
     assert.equal(c.combatants.find((unit:any)=>unit.side==='player').col,2);

     const command = {type:'useCombatSkill',encounterId:c.encounterId,actorId:c.currentActorId,skillId:skill.skillId,targetCombatantIds:[target.combatantId]};
     const snapshot = game.serialize();
     assert.deepEqual(createGame({},snapshot).runCommand(command), createGame({},snapshot).runCommand(command), 'combat save must replay identically');
     resumedCombat = true;
   }
   run({type:'useCombatSkill',encounterId:c.encounterId,actorId:c.currentActorId,skillId:skill.skillId,targetCombatantIds:[target.combatantId]});
   if(!v.combat) fights++;
   continue;
  }
  if(v.loot){
   const loot = v.loot; const balance = v.balance;
   const bidder = createGame({}, game.serialize());
   assert(bidder.runCommand({type:'submitLootBid',distributionId:loot.distributionId,itemId:loot.itemId,bidderCharacterId:v.leader.id,amount:loot.minimumBid}).accepted);
   const claimed = bidder.runCommand({type:'resolveLootAuctionRound',distributionId:loot.distributionId,itemId:loot.itemId});
   assert(claimed.accepted && !claimed.view.loot, 'winning bid must finish the round');
   const owned = JSON.parse(JSON.parse(bidder.serialize()).payload).state.inventory.items[loot.itemId];
   assert(owned && owned.location.kind !== 'assetDistributionEscrow', 'winning bidder must receive item');
   lootRounds++;run({type:'passLootItem',distributionId:v.loot.distributionId,bidderCharacterId:v.leader.id,itemId:v.loot.itemId});run({type:'resolveLootAuctionRound',distributionId:v.loot.distributionId,itemId:v.loot.itemId});assert(v.balance > balance, 'direct sale must add real money');continue;}
  if(v.location.kind==='city')break;
  const d=v.dungeon;assert(d,'dungeon disappeared');
  if(fights>0&&d.isExitRoom){run({type:'useDungeonExit',exitRoomId:d.currentRoomId});continue;}
  const content=d.roomContents.find((c:any)=>(c.kind==='monsterGroup'||c.kind==='boss')&&c.available);
  if(content && fights===0){run({type:'interactDungeonContent',contentId:content.contentId});continue;}
  visited.add(d.currentRoomId);
  const next=d.moves.find((m:any)=>!visited.has(m.roomId));
  if(next){stack.push(d.currentRoomId); if(!next.open)run({type:'openDungeonDoor',linkId:next.linkId});run({type:'moveDungeonRoom',targetRoomId:next.roomId});}
  else {const previous=stack.pop();assert(previous,'No exploration route');const move=d.moves.find((m:any)=>m.roomId===previous);if(!move.open)run({type:'openDungeonDoor',linkId:move.linkId});run({type:'moveDungeonRoom',targetRoomId:previous});}
 }
 assert(lootRounds > 0, 'No real monster loot reached the player');
 assert(fights>0); assert.equal(v.location.kind,'city');
 const completed=v.city.guild.accepted.filter((q:any)=>q.status==='completed'&&!q.settled); assert(completed.length,'No completed quest');
 for(const q of completed){const before=v.balance;run({type:'settleQuest',questId:q.questId});assert.equal(v.balance,before+q.reward);assert(JSON.parse(JSON.parse(game.serialize()).payload).state.progression.masteryLedger[`quest:${q.questId}`], 'quest XP must be credited');const saved=game.serialize();assert.equal(game.runCommand({type:'settleQuest',questId:q.questId}).accepted,false);assert.equal(game.serialize(),saved);}
 assert.deepEqual(createGame({},game.serialize()).view,v);
 console.log('PLAYTHROUGH PASSED');
}finally{await server.close()}
