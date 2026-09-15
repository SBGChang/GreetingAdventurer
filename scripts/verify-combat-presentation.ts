import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {createCombatModel} from '../app/CombatModels';
import models from '../app/assets/combat/models.json';
import monsters from '../content/yunhua/monsters.json';
import type {GameCommand} from '../src/app/composition/messages';
import type {createCombatSandbox} from '../app/testing/combat-sandbox';
import * as THREE from 'three';
import {hasCtbCountdown,ctbPlaybackView} from '../app/combat-ctb-playback';
import maps from '../app/assets/dungeons/catalog.json';
import atlas from '../app/assets/geography/atlas.json';
import stage from '../app/assets/combat/sprites/stage.json';

for(const monster of monsters.filter(m=>m.kind==='monster'))assert(monster.id in models,`Missing model ${monster.id}`);
for(const id of Object.keys(models)){
 const actor=createCombatModel(id);actor.animate(.016,.5);let count=0;
 actor.root.traverse(o=>{if(o instanceof THREE.Mesh){count++;o.geometry.dispose();for(const m of Array.isArray(o.material)?o.material:[o.material])m.dispose();}});assert(count>0);
}
assert.throws(()=>createCombatModel('missing'),/Missing combat model/);
const server=await createServer({server:{middlewareMode:true},appType:'custom'});
try{
 const module=await server.ssrLoadModule('/testing/combat-sandbox.ts');
 const create=module.createCombatSandbox as typeof createCombatSandbox;
 const game=create();let turns=0,frames=0,countdowns=0;const day=game.view.worldDay;
 const art=await server.ssrLoadModule('/combat-sprite-catalog.ts');
 const resolve=art.resolveSpriteBattle as typeof import('../app/combat-sprite-catalog').resolveSpriteBattle;
 const initial=game.view.combat!;
 assert.equal(initial.weaponSets.length,3);assert(initial.weaponSets.every(s=>s.skills.length===3));
 assert(initial.actions.every(a=>a.validTargetIds.every(id=>initial.combatants.find(u=>u.combatantId===id)?.side==='enemy')));
 const switching=create(true),switchCombat=switching.view.combat!,alternate=switchCombat.weaponSets.find(s=>!s.isActive&&s.skills[0]?.available)!;
 assert.equal(switchCombat.weaponSets.filter(s=>s.skills[0]?.available).length,1,'moving an owned weapon disables the unequipped set');
 assert(alternate,'second configured set has a usable action');
 const alternateSkill=alternate.skills[0]!;
 const switched=switching.run({type:'useCombatSkill',encounterId:switchCombat.encounterId,actorId:switchCombat.currentActorId,weaponSetId:alternate.weaponSetId,skillId:alternateSkill.skillId,targetCombatantIds:[alternateSkill.validTargetIds[0]!]} as Extract<GameCommand,{type:'useCombatSkill'}>);
 assert(switched.accepted);assert(switched.view.combat?.weaponSets.find(s=>s.weaponSetId===alternate.weaponSetId)?.isActive,'formal command commits weapon switch and the next player menu marks that set');

 const groundModule=await server.ssrLoadModule('/combat-ground.ts') as typeof import('../app/combat-ground');
 assert.deepEqual(groundModule.combatEnvironment(game.view),{kind:'map',id:initial.mapTemplateId});
 const images=new Set<string>();
 for(const [kind,ids] of [['map',maps.map(m=>m.templateId)],['city',atlas.cities.map(c=>c.cityId)],['world',atlas.roads.map(r=>r.routeId)]] as const){
  for(const id of ids){const art=groundModule.resolveCombatGround({kind,id});assert(art.image);images.add(art.image);}
 }
 assert.equal(images.size,5,'all shipped maps, cities and roads resolve one of five actual ground artworks');
 assert.throws(()=>groundModule.resolveCombatGround({kind:'map',id:'unknown'}),/Missing battle ground binding/);
 const p=stage.platform;
 for(const side of ['player','enemy'] as const)for(let row=1;row<=3;row++)for(let col=1;col<=3;col++){
  const {x,y}=art.spriteFormation({...initial.combatants[0]!,side,row,col},stage);
  const depth=(y-p.y)/p.depth,left=p.x+depth*p.skew;
  assert(depth>0&&depth<1&&x>left+25&&x<left+p.width-25,'all eighteen formation feet fit the single continuous ground');
 }
 assert(resolve(initial),'formal projected facts select the same sprite scene as the test entrance');
 assert.equal(initial.combatants.find(u=>u.side==='player')!.artIdentity!.sex,'male','test identity matches its art');
 assert(resolve({...initial,mapTemplateId:'another-location'}),'compatible character art is independent of the retained scene');
 assert(resolve({...initial,mapTemplateId:undefined}),'city or road encounters can use the same platform when art is compatible');
 const player=initial.combatants.find(u=>u.side==='player')!;
 for(const identity of [{...player.artIdentity!,sex:'female'},{...player.artIdentity!,weapons:[{mainHand:'unsupported-weapon',offHand:undefined,skillIds:[]}]}]){
  assert.equal(resolve({...initial,combatants:initial.combatants.map(u=>u===player?{...u,artIdentity:identity}:u)}),undefined,'incompatible appearances and weapon families do not reuse dao art');
 }
 while(game.view.combat&&turns++<80){
  const c=game.view.combat,skill=c.actions.find(a=>a.available&&a.actionKind==='attack'),enemy=c.combatants.find(u=>u.side==='enemy'&&u.state!=='dead');assert(skill&&enemy);
  const command={type:'useCombatSkill',encounterId:c.encounterId,actorId:c.currentActorId,skillId:skill.skillId,targetCombatantIds:[enemy.combatantId]} as Extract<GameCommand,{type:'useCombatSkill'}>;
  if(turns===1){
   const rejected=game.run({...command,targetCombatantIds:[c.currentActorId!] as typeof command.targetCombatantIds});assert(!rejected.accepted,'invalid friendly target is rejected');assert.deepEqual(game.view.combat,c,'rejection does not alter battle');
  }
  const result=game.run(command);assert(result.accepted);assert(!result.blocked);assert(result.combatFrames.length>0);
  assert.deepEqual(result.combatFrames[0]!.before,c);
  assert.equal(result.combatFrames[0]!.actorId,c.currentActorId);
  for(const frame of result.combatFrames){
   assert.equal(frame.ctbAfterAction.length,frame.after.combatants.length,'all committed timing endpoints are projected');
   const original=JSON.stringify(frame);
   assert.strictEqual(ctbPlaybackView(frame,1),frame.after,'countdown ends at the exact committed view');
   if(hasCtbCountdown(frame)){
    countdowns++;
    const samples=[0,.25,.5,.75,1].map(p=>ctbPlaybackView(frame,p));
    assert(samples.slice(0,-1).every(v=>v.currentActorId===undefined&&v.combatants.every(u=>!u.isCurrentActor)),'next actor lights only after time reaches zero');
    for(const start of frame.ctbAfterAction){
     const values=samples.map(v=>v.combatants.find(u=>u.combatantId===start.combatantId)!.ctb);
     assert.equal(values[0],start.ctb,'recover actual action delay before counting down');
     assert(values.every((v,i)=>v>=0&&(i===0||v<=values[i-1]!)),'sampled bars count down monotonically without going negative');
    }
    assert.equal(samples.at(-1)!.combatants.find(u=>u.isCurrentActor)!.ctb,0);
   }else if(frame.after.state==='resolved')assert.strictEqual(ctbPlaybackView(frame,0),frame.after,'victory does not invent more time');
   assert.equal(JSON.stringify(frame),original,'presentation never mutates committed facts');
   assert(frame.actions.length>0,'committed action facts accompany each playback frame');
   assert(frame.actions.some(a=>a.actorId===frame.actorId),'actor comes from the committed event');
   assert(frame.actions.every(a=>a.skillId!==undefined),'this sequence uses actual attack skills');
   assert(frame.actions.flatMap(a=>a.results).some(r=>r.kind==='dealDamage'),'damage is reported by the engine');
  }
  for(let i=1;i<result.combatFrames.length;i++)assert.deepEqual(result.combatFrames[i]!.before,result.combatFrames[i-1]!.after,'every enemy action follows the prior committed snapshot');
  const last=result.combatFrames.at(-1)!;
  if(game.view.combat)assert.deepEqual(last.after,game.view.combat);else{assert.equal(last.after.state,'resolved');assert(last.after.combatants.filter(u=>u.side==='enemy').every(u=>u.state==='dead'));}
  assert.equal(game.view.worldDay,day,'presentation does not advance world days');frames+=result.combatFrames.length;
 }
 assert(turns<80&&!game.view.combat&&game.view.leader?.lifeState==='alive');
 assert(frames>turns,'enemy turns have distinct playback frames');
 assert(countdowns>0,'real battle includes observable countdown segments');
 const resting=create(),restingCombat=resting.view.combat!;
 const rested=resting.run({type:'combatRest',encounterId:restingCombat.encounterId,actorId:restingCombat.currentActorId} as Extract<GameCommand,{type:'combatRest'}>);
 assert(rested.accepted);const restAction=rested.combatFrames[0]!.actions[0]!;
 assert.equal(restAction.skillId,undefined);assert(restAction.results.some(r=>r.kind==='rest'),'rest is not presented as an attack');
 console.log('COMBAT PRESENTATION PASSED:',Object.keys(models).length,'models;',turns,'player commands;',frames,'committed action frames; rejection, victory, unchanged world time');
}finally{await server.close();}
