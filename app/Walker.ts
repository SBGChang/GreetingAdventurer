import * as THREE from 'three';

/** Presentation-only party marker with pivoted limbs; identity comes from the entrance. */
export function createWalker(coatColor='#315f60') {
 const root=new THREE.Group();
 const coat=new THREE.MeshStandardMaterial({color:coatColor,roughness:.87});
 const trim=new THREE.MeshStandardMaterial({color:'#be9c56',roughness:.55,metalness:.3});
 const skin=new THREE.MeshStandardMaterial({color:'#d6a17a',roughness:.8});
 const leather=new THREE.MeshStandardMaterial({color:'#382c28',roughness:.8});
 const hair=new THREE.MeshStandardMaterial({color:'#241e21',roughness:.95});
 const mesh=(geometry:THREE.BufferGeometry,material:THREE.Material,p:[number,number,number],parent:THREE.Object3D=root)=>{
  const o=new THREE.Mesh(geometry,material);o.position.set(...p);o.castShadow=true;o.receiveShadow=true;parent.add(o);return o;
 };
 mesh(new THREE.CylinderGeometry(.25,.32,.63,12),coat,[0,1.03,0]);
 mesh(new THREE.CylinderGeometry(.275,.275,.075,12),leather,[0,.8,0]);
 mesh(new THREE.BoxGeometry(.13,.10,.06),trim,[0,.8,.27]);
 mesh(new THREE.SphereGeometry(.24,20,16),skin,[0,1.58,0]);
 mesh(new THREE.SphereGeometry(.25,20,12,0,Math.PI*2,0,Math.PI*.57),hair,[0,1.62,-.02]);
 mesh(new THREE.SphereGeometry(.10,12,8),hair,[0,1.84,-.07]);
 for(const x of [-.085,.085])mesh(new THREE.SphereGeometry(.022,8,8),hair,[x,1.60,.225]);
 mesh(new THREE.ConeGeometry(.35,.50,12,1,true),coat,[0,.72,-.01]);
 mesh(new THREE.BoxGeometry(.30,.40,.18),leather,[0,1.06,-.28]);
 for(const x of [-.16,.16])mesh(new THREE.BoxGeometry(.035,.44,.04),trim,[x,1.1,-.38]);
 const legs:THREE.Group[]=[],arms:THREE.Group[]=[];
 for(const sign of [-1,1]){
  const leg=new THREE.Group();leg.position.set(sign*.14,.73,0);root.add(leg);legs.push(leg);
  mesh(new THREE.CapsuleGeometry(.09,.31,4,10),leather,[0,-.22,0],leg);
  mesh(new THREE.BoxGeometry(.19,.15,.29),leather,[0,-.58,.045],leg);
  const arm=new THREE.Group();arm.position.set(sign*.31,1.28,0);root.add(arm);arms.push(arm);
  mesh(new THREE.CapsuleGeometry(.095,.28,4,10),coat,[0,-.20,0],arm);
  mesh(new THREE.SphereGeometry(.09,12,10),skin,[0,-.43,.02],arm);
 }
 const glow=new THREE.MeshStandardMaterial({color:'#ffd080',emissive:'#ff940c',emissiveIntensity:1.3});
 mesh(new THREE.CylinderGeometry(.07,.08,.17,8),glow,[0,-.61,.03],arms[1]);
 mesh(new THREE.CylinderGeometry(.1,.1,.04,8),trim,[0,-.71,.03],arms[1]);
 mesh(new THREE.CylinderGeometry(.1,.1,.04,8),trim,[0,-.51,.03],arms[1]);
 let phase=0;
 return {root,strike(amount:number){arms[0]!.rotation.x=-amount*1.7;},animate(dt:number,moving:boolean){phase+=dt*(moving?9:2);const swing=moving?Math.sin(phase)*.48:0;legs[0]!.rotation.x=swing;legs[1]!.rotation.x=-swing;arms[0]!.rotation.x=-swing*.8;arms[1]!.rotation.x=swing*.35;root.position.y=.07+(moving?Math.abs(Math.sin(phase))*.035:0);}};
}
