import * as THREE from 'three';
import profiles from './assets/combat/models.json';
import {createWalker} from './Walker';

/** Authored visual mapping only; monster identity and all combat values come from the engine. */
export function createCombatModel(modelId:string){
 const profile=profiles[modelId as keyof typeof profiles];
 if(!profile)throw new Error(`Missing combat model: ${modelId}`);
 if(profile.body==='human'){
  const actor=createWalker(profile.color);actor.root.scale.setScalar(profile.scale);
  return {root:actor.root,animate(dt:number,attack:number){actor.animate(dt,false);actor.strike(attack);}};
 }
 const root=new THREE.Group(),body=new THREE.Group();root.add(body);root.scale.setScalar(profile.scale);
 const shell=new THREE.MeshStandardMaterial({color:profile.color,roughness:.55,metalness:.12});
 const trim=new THREE.MeshStandardMaterial({color:profile.accent,roughness:.6});
 const dark=new THREE.MeshStandardMaterial({color:'#152529',roughness:.7});
 const eye=new THREE.MeshStandardMaterial({color:'#ffe3a7',emissive:'#e8b350',emissiveIntensity:.65});
 const add=(g:THREE.BufferGeometry,m:THREE.Material,p:number[],s:number[]=[1,1,1],parent:THREE.Object3D=body)=>{
  const mesh=new THREE.Mesh(g,m);mesh.position.set(p[0]!,p[1]!,p[2]!);mesh.scale.set(s[0]!,s[1]!,s[2]!);mesh.castShadow=true;mesh.receiveShadow=true;parent.add(mesh);return mesh;
 };
 const orb=(p:number[],s:number[],m:THREE.Material=shell)=>add(new THREE.SphereGeometry(1,20,12),m,p,s);
 const bone=(a:number[],b:number[],radius:number,m:THREE.Material=shell)=>{
  const start=new THREE.Vector3(a[0],a[1],a[2]),end=new THREE.Vector3(b[0],b[1],b[2]),d=end.clone().sub(start);
  const mesh=add(new THREE.CylinderGeometry(radius*.8,radius,d.length(),10),m,start.clone().add(end).multiplyScalar(.5).toArray());mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),d.normalize());return mesh;
 };
 const legs:THREE.Object3D[]=[],wings:THREE.Object3D[]=[];
 if(profile.body==='crab'||profile.body==='beetle'){
  orb([0,.62,0],[.66,.4,.72]);orb([0,.71,-.05],[.57,.34,.57],trim);
  for(const sign of [-1,1]){
   for(let i=0;i<3;i++){const z=-.45+i*.38;legs.push(bone([sign*.45,.6,z],[sign*.95,.24,z-.2],.06));bone([sign*.95,.24,z-.2],[sign*1.1,.04,z+.03],.045,dark);}
   bone([sign*.32,.63,.55],[sign*.52,.5,.98],.12);
   orb([sign*.53,.52,1.02],[.22,.2,.31],trim);
   const claw=add(new THREE.ConeGeometry(.12,.35,10),shell,[sign*.62,.55,1.22]);claw.rotation.x=Math.PI/2;
   orb([sign*.23,.88,.56],[.065,.065,.07],eye);
  }
  if(profile.body==='beetle')bone([0,.78,.5],[0,1.2,1.15],.09,trim);
 }else if(profile.body==='badger'||profile.body==='lizard'){
  orb([0,.66,0],[.46,.48,.77]);orb([0,.74,.68],[.39,.35,.42]);orb([0,.64,1],[.28,.16,.24],trim);orb([0,.7,1.19],[.1,.08,.05],dark);
  for(const sign of [-1,1]){
   orb([sign*.28,.85,.93],[.048,.055,.045],eye);
   for(const z of [-.43,.46]){legs.push(bone([sign*.32,.6,z],[sign*.42,.16,z+.08],.14));orb([sign*.43,.12,z+.17],[.19,.1,.25],dark);}
   if(profile.body==='badger')orb([sign*.26,1.03,.62],[.13,.17,.1],trim);
  }
  for(let i=0;i<5;i++)add(new THREE.ConeGeometry(.09,.26,8),trim,[0,1.1-i*.025,.45-i*.24]);
  bone([0,.6,-.65],[0,.4,-1.3],profile.body==='lizard'?.18:.11);bone([0,.4,-1.3],[.32,.13,-1.8],.09);
 }else if(profile.body==='moth'){
  orb([0,1,0],[.2,.24,.55]);orb([0,1.12,.48],[.25,.24,.23],trim);
  for(const sign of [-1,1]){
   const wing=orb([sign*.62,1.06,-.08],[.7,.055,.62]);wings.push(wing);
   orb([sign*.6,1.12,.04],[.18,.025,.22],trim);orb([sign*.12,1.19,.66],[.055,.07,.035],eye);
   bone([sign*.12,1.25,.55],[sign*.4,1.65,.63],.025,dark);
  }
 }else if(profile.body==='wisp'){
  orb([0,1.1,0],[.4,.55,.4]);orb([0,1.25,.35],[.19,.22,.06],eye);
  for(let i=0;i<5;i++){const ribbon=add(new THREE.BoxGeometry(.12,.65,.035),trim,[Math.sin(i*1.3)*.36,.65,Math.cos(i*1.3)*.35]);ribbon.rotation.z=Math.sin(i)*.4;}
 }else if(profile.body==='golem'){
  add(new THREE.BoxGeometry(.8,.75,.5),shell,[0,1.08,0]);add(new THREE.BoxGeometry(.55,.5,.5),trim,[0,1.7,0]);
  for(const sign of [-1,1]){
   legs.push(bone([sign*.23,.8,0],[sign*.26,.18,.03],.17));add(new THREE.BoxGeometry(.33,.18,.45),dark,[sign*.26,.1,.12]);
   orb([sign*.56,1.3,0],[.23,.24,.25],trim);bone([sign*.57,1.22,0],[sign*.67,.7,.1],.15);orb([sign*.68,.66,.14],[.18,.18,.18]);
   orb([sign*.13,1.77,.26],[.055,.045,.035],eye);
  }
  add(new THREE.BoxGeometry(.21,.44,.025),trim,[0,1.12,.27]);
 }else throw new Error(`Unsupported combat body: ${profile.body}`);
 let time=0;
 return {root,animate(dt:number,attack:number){time+=dt;body.position.y=Math.sin(time*2)*.025;body.rotation.x=-attack*.25;wings.forEach((wing,i)=>{wing.rotation.z=Math.sin(time*12)*.3*(i===0?1:-1);});legs.forEach((leg,i)=>{leg.rotation.z+=Math.sin(time*2+i)*dt*.025;});}};
}
