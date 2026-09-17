import assert from 'node:assert/strict';
import {createServer} from 'vite';
import bindings from '../app/assets/combat/sprites/bindings.json';
import roster from '../app/assets/combat/sprites/appearances.json';
import type {CombatView} from '../app/engine/game-facade';
import {clearSave} from '../app/engine/save-storage';

const server=await createServer({server:{middlewareMode:true},appType:'custom'});
try{
 const {createCombatSandbox}=await server.ssrLoadModule('/testing/combat-sandbox.ts');
 const {resolveSpriteBattle:resolve}=await server.ssrLoadModule('/combat-sprite-catalog.ts') as typeof import('../app/combat-sprite-catalog');
 const {selectAppearance,readAppearanceSelections,appearanceStorageKey}=await server.ssrLoadModule('/combat-appearances.ts') as typeof import('../app/combat-appearances');
 const original=createCombatSandbox().view.combat as CombatView;
 const player=original.combatants.find(u=>u.artIdentity)!;
 const identity=player.artIdentity!,setId=identity.activeWeaponSetId!;
 const equipment=(family:string)=>Object.entries(bindings.equipment).find(([,f])=>f===family)?.[0];
 let cases=0;
 for(const appearance of roster){
  for(const [family,skin] of Object.entries(appearance.skins)){
   const combo=bindings.combinations.find(c=>c.motion===family);
   const weapon={weaponSetId:setId,mainHand:equipment(combo?.main??family),offHand:combo?equipment(combo.off):undefined,twoHanded:false,skillIds:[]};
   if(family!=='unarmed')assert(weapon.mainHand,`No equipment case for ${family}`);
   const view={...original,combatants:original.combatants.map(u=>u===player?{...u,artIdentity:{...identity,sex:appearance.sex,weapons:[weapon]}}:u)};
   const unchanged=JSON.stringify(view),selection={[identity.characterId]:appearance.id};
   assert.equal(resolve(view,selection)?.skins[player.combatantId],skin,`${appearance.id}/${family}`);
   assert.equal(JSON.stringify(view),unchanged,'cosmetics never mutate game facts');
   if(!combo&&weapon.mainHand){
    weapon.offHand=weapon.mainHand;weapon.twoHanded=true;
    assert.equal(resolve(view,selection)?.skins[player.combatantId],skin,'same two-handed item in both slots is not dual wielding');
   }
   cases++;
  }
 }
 for(const [modelId,skin] of Object.entries(bindings.monsters)){
  const view={...original,combatants:original.combatants.filter(u=>u.side==='enemy').slice(0,1).map(u=>({...u,modelId}))};
  assert.equal(resolve(view)?.skins[view.combatants[0]!.combatantId],skin,modelId);
 }
 const storage=new Map<string,string>(),adapter={getItem:(k:string)=>storage.get(k)??null,setItem:(k:string,v:string)=>{storage.set(k,v)},removeItem:(k:string)=>{storage.delete(k)}};
 assert.deepEqual(readAppearanceSelections(adapter),{});
 const picked=selectAppearance({},identity.characterId,'female','safir-female-scholarly');
 adapter.setItem(appearanceStorageKey,JSON.stringify(picked));assert.deepEqual(readAppearanceSelections(adapter),picked);
 assert.throws(()=>selectAppearance(picked,identity.characterId,'male','safir-female-scholarly'));
 adapter.setItem(appearanceStorageKey,'{"x":"unknown"}');assert.throws(()=>readAppearanceSelections(adapter));
 clearSave(adapter);assert.equal(storage.size,0,'clear save also clears cosmetic identity');
 const switching=createCombatSandbox(true).view.combat as CombatView;
 assert(resolve(switching),'active empty set uses unarmed while an equipped alternate set is preloaded');
 console.log(`SPRITE ROUTING PASSED: ${cases} appearance/weapon cases; ${Object.keys(bindings.monsters).length} monsters; two-handed identity; empty active set; cosmetic persistence.`);
}finally{await server.close();}
