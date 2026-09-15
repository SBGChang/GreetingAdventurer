import type {GameView} from './engine/game-facade';
import catalog from './assets/combat/grounds/catalog.json';

export type CombatEnvironment=Readonly<{kind:'map'|'city'|'world';id:string}>;
export type CombatGround=Readonly<{id:string;image:string;tint:string;edge:string;glow:string}>;
const images=import.meta.glob('./assets/combat/grounds/*.png',{eager:true,query:'?url',import:'default'}) as Record<string,string>;

/** Entrance facts select authored art; no URL, combat rule or fixture belongs here. */
export function combatEnvironment(view:GameView):CombatEnvironment{
 if(view.combat?.mapTemplateId)return {kind:'map',id:view.combat.mapTemplateId};
 if(view.location.kind==='city')return {kind:'city',id:view.location.cityId};
 if(view.location.kind==='travelling')return {kind:'world',id:view.location.routeId};
 throw new Error('Combat entrance has no supported environment');
}
export function resolveCombatGround(environment:CombatEnvironment):CombatGround{
 const id=(catalog.bindings[environment.kind] as Record<string,string>)[environment.id];
 const profile=id&&(catalog.profiles as Record<string,{image:string;tint:string;edge:string;glow:string}>)[id];
 if(!profile)throw new Error(`Missing battle ground binding: ${environment.kind}/${environment.id}`);
 const image=images[`./assets/combat/grounds/${profile.image}`];
 if(!image)throw new Error(`Missing battle ground image: ${profile.image}`);
 return {id,...profile,image};
}
