import {createWalkController} from '../app/walk-controller';
import {dungeonWalkSpace} from '../app/dungeon-walk-data';
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
 const armor=offers.find((o:any)=>o.equipmentKind==='armor' && o.affordable);
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

 // Exercise the production walking boundary with actual commands, saves, traps and combat.
 let walking:ReturnType<typeof createWalkController>|undefined,walkingKey='';
 const getWalker=()=>{
  const d=v.dungeon;assert(d);
  const key=`${d.explorationId}:${d.mapVersion}:${d.floor.floor}`;
  if(key!==walkingKey){
   const space=dungeonWalkSpace(d.templateId,d.floor.floor,d.floor.cells.map((c:any)=>({...c,floor:d.floor.floor})));
   walking=createWalkController(space,d,roomId=>{run({type:'moveDungeonRoom',targetRoomId:roomId});return true;});walkingKey=key;
  }else walking!.sync(d);
  return walking!;
 };
 const walkTo=(targetRoomId:string)=>{
  const d=v.dungeon,c=getWalker(),link=d.links.find((l:any)=>l.fromRoomId===d.currentRoomId && l.toRoomId===targetRoomId || l.toRoomId===d.currentRoomId && l.fromRoomId===targetRoomId);assert(link?.open);
  const to=link.fromRoomId===d.currentRoomId?link.toCell:link.fromCell;
  if(to.floor!==d.floor.floor){run({type:'moveDungeonRoom',targetRoomId});getWalker();return;}
  const space=dungeonWalkSpace(d.templateId,d.floor.floor,d.floor.cells.map((cell:any)=>({...cell,floor:d.floor.floor}))),nav=space.navigation,size=nav.size;
  const encode=(x:number,z:number)=>Math.round((z-nav.origin)/nav.step)*size+Math.round((x-nav.origin)/nav.step);
  const start=encode(c.position.x,c.position.z),end=encode((to.col-3)*6,(to.row-3)*6),q=[start],prev=new Map([[start,-1]]);
  const allowed=new Set(space.cells.filter(cell=>cell.roomId===d.currentRoomId||cell.roomId===targetRoomId).map(cell=>`${cell.row},${cell.col}`));
  for(let i=0;i<q.length&&!prev.has(end);i++){
   const at=q[i]!,row=Math.floor(at/size),col=at%size;
   for(const [r,k] of [[row-1,col],[row+1,col],[row,col-1],[row,col+1]]){
    const x=nav.origin+k!*nav.step,z=nav.origin+r!*nav.step,n=r!*size+k!;
    if(r!<0||k!<0||r!>=size||k!>=size||nav.rows[r!]?.[k!]!=='1'||!allowed.has(`${Math.floor((z+15)/6)+1},${Math.floor((x+15)/6)+1}`)||prev.has(n))continue;
    prev.set(n,at);q.push(n);
   }
  }
  assert(prev.has(end),'actual walking mask must connect the formal route');
  const path:number[]=[];for(let n=end;n!==-1;n=prev.get(n)!)path.unshift(n);
  for(const n of path){
   const pos=c.position;c.move(nav.origin+(n%size)*nav.step-pos.x,nav.origin+Math.floor(n/size)*nav.step-pos.z);c.sync(v.dungeon);
   if(!v.dungeon.canMove)break;
  }
  assert.equal(v.dungeon.currentRoomId,targetRoomId);assert.equal(c.position.roomId,targetRoomId);
  const resumed=createGame({},game.serialize()).view.dungeon;
  assert.deepEqual(resumed.entryCell,v.dungeon.entryCell,'walking commits the authoritative entry cell to saves');
 };
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
  if(content && fights===0){
   const c=getWalker(),before=c.position;run({type:'interactDungeonContent',contentId:content.contentId});
   assert.equal(v.dungeon.canMove,false);c.sync(v.dungeon);c.move(5,5);assert.deepEqual(c.position,before,'real combat freezes walking');continue;
  }
  visited.add(d.currentRoomId);
  const next=d.moves.find((m:any)=>!visited.has(m.roomId));
  if(next){stack.push(d.currentRoomId); if(!next.open)run({type:'openDungeonDoor',linkId:next.linkId});walkTo(next.roomId);}
  else {const previous=stack.pop();assert(previous,'No exploration route');const move=d.moves.find((m:any)=>m.roomId===previous);if(!move.open)run({type:'openDungeonDoor',linkId:move.linkId});walkTo(previous);}
 }
 assert(lootRounds > 0, 'No real monster loot reached the player');
 assert(fights>0); assert.equal(v.location.kind,'city');
 const completed=v.city.guild.accepted.filter((q:any)=>q.status==='completed'&&!q.settled); assert(completed.length,'No completed quest');
 for(const q of completed){const before=v.balance;run({type:'settleQuest',questId:q.questId});assert.equal(v.balance,before+q.reward);assert(JSON.parse(JSON.parse(game.serialize()).payload).state.progression.masteryLedger[`quest:${q.questId}`], 'quest XP must be credited');const saved=game.serialize();assert.equal(game.runCommand({type:'settleQuest',questId:q.questId}).accepted,false);assert.equal(game.serialize(),saved);}
 assert.deepEqual(createGame({},game.serialize()).view,v);
 console.log('PLAYTHROUGH PASSED');
}finally{await server.close()}
