import {useEffect,useRef,useState} from 'react';
import * as THREE from 'three';
import {createCombatModel} from './CombatModels';
import type {CombatView,CombatFrame} from './engine/game-facade';
import presentation from './assets/combat/presentation.json';
import type {CombatArenaProps} from './combat-presentation-types';

export function CombatArena({ground,view,frame,progress,onTarget,selecting,validTargetIds,label,loadingLabel,highlightedId,onReady}:CombatArenaProps){
 const host=useRef<HTMLDivElement>(null),labels=useRef<HTMLDivElement>(null),latest=useRef({view,frame,progress,selecting,validTargetIds,onTarget,highlightedId});latest.current={view,frame,progress,selecting,validTargetIds,onTarget,highlightedId};
 const [error,setError]=useState<string>(),[loading,setLoading]=useState(true);
 useEffect(()=>{
  const el=host.current!;let raf=0,disposed=false,renderer:THREE.WebGLRenderer|undefined;
  const scene=new THREE.Scene();scene.background=null;
  const camera=new THREE.OrthographicCamera(-14,14,8,-8,.1,100);
  camera.position.set(presentation.camera.x,presentation.camera.y,presentation.camera.z);camera.lookAt(0,0,0);camera.updateMatrixWorld();
  const models=new Map<string,{model:ReturnType<typeof createCombatModel>;base:THREE.Vector3;ring:THREE.Mesh}>();
  const textures:THREE.Texture[]=[];
  const raycaster=new THREE.Raycaster();let hovered:string|undefined;
  const pick=(event:MouseEvent)=>{
   if(!latest.current.selecting)return undefined;
   const rect=el.getBoundingClientRect();raycaster.setFromCamera(new THREE.Vector2((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1),camera);
   let object=raycaster.intersectObjects([...models.values()].map(m=>m.model.root),true)[0]?.object;
   while(object&&!object.userData.combatantId)object=object.parent??undefined;
   return latest.current.view.combatants.find(u=>u.combatantId===object?.userData.combatantId&&u.state!=='dead'&&latest.current.validTargetIds.includes(u.combatantId))?.combatantId;
  };
  let pendingTextures=1,failed=false;el.dataset.ready='false';setLoading(true);setError(undefined);onReady?.(false);
  const resize=()=>{if(!renderer)return;const h=presentation.camera.halfHeight;camera.left=-h*el.clientWidth/el.clientHeight;camera.right=-camera.left;camera.top=h;camera.bottom=-h;camera.updateProjectionMatrix();renderer.setSize(el.clientWidth,el.clientHeight);};
  const observer=new ResizeObserver(resize);
  try{
   renderer=new THREE.WebGLRenderer({antialias:true,alpha:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;renderer.toneMapping=THREE.ACESFilmicToneMapping;
   el.appendChild(renderer.domElement);observer.observe(el);resize();
   renderer.domElement.addEventListener('click',event=>{const id=pick(event);if(id)latest.current.onTarget(id);});
   renderer.domElement.addEventListener('mousemove',event=>{hovered=pick(event);renderer!.domElement.style.cursor=hovered?'crosshair':'default';});
   scene.add(new THREE.HemisphereLight('#dcebe5','#253a40',2.2));
   const sun=new THREE.DirectionalLight('#ffe4bc',3.2);sun.position.set(-8,18,8);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);Object.assign(sun.shadow.camera,{left:-18,right:18,top:14,bottom:-14});sun.shadow.normalBias=.04;scene.add(sun);
   const texture=(url:string,color:boolean)=>{const tex=new THREE.TextureLoader().load(url,()=>{if(!disposed&&!failed&&--pendingTextures===0){el.dataset.ready='true';setLoading(false);onReady?.(true);}},undefined,()=>{if(!disposed){failed=true;setError('Battle ground texture unavailable');setLoading(false);el.dataset.ready='error';}});tex.anisotropy=renderer!.capabilities.getMaxAnisotropy();if(color)tex.colorSpace=THREE.SRGBColorSpace;textures.push(tex);return tex;};
   const groundMap=texture(ground.image,true);
   const pad=presentation.platform;
   const edge=new THREE.Mesh(new THREE.BoxGeometry(pad.width,pad.thickness,pad.depth),new THREE.MeshStandardMaterial({color:ground.edge,roughness:1}));edge.position.y=-pad.thickness/2-.035;edge.receiveShadow=true;scene.add(edge);
   const surface=new THREE.Mesh(new THREE.PlaneGeometry(pad.width,pad.depth),new THREE.MeshStandardMaterial({color:ground.tint,roughness:.96,map:groundMap}));surface.rotation.x=-Math.PI/2;surface.position.y=-.03;surface.receiveShadow=true;scene.add(surface);
   el.dataset.groundId=ground.id;el.dataset.battlePlatform='shared';
   for(const unit of view.combatants){
    const model=createCombatModel(unit.modelId),sign=unit.side==='player'?-1:1;
    const base=new THREE.Vector3(sign*(presentation.formation.frontX+(unit.row-1)*presentation.formation.rowSpacing),0,(unit.col-2)*presentation.formation.colSpacing);
    model.root.position.copy(base);model.root.rotation.y=-sign*Math.PI/2;scene.add(model.root);
    model.root.userData.combatantId=unit.combatantId;
    const ring=new THREE.Mesh(new THREE.RingGeometry(.62,.72,48),new THREE.MeshBasicMaterial({color:unit.side==='player'?'#75dccc':'#ea9b82',transparent:true,opacity:.5,side:THREE.DoubleSide}));ring.rotation.x=-Math.PI/2;ring.position.copy(base).setY(.015);scene.add(ring);models.set(unit.combatantId,{model,base,ring});
   }
   let last=performance.now();
   const tick=(now:number)=>{
    if(disposed)return;raf=requestAnimationFrame(tick);const dt=Math.min((now-last)/1000,.04);last=now;
    const current=latest.current;
    const targets:{id:string;x:number;y:number}[]=[];
    for(const unit of current.view.combatants){
     const actor=models.get(unit.combatantId)!;const hit=current.frame?.before.combatants.find(u=>u.combatantId===unit.combatantId);
     actor.base.set((unit.side==='player'?-1:1)*(presentation.formation.frontX+(unit.row-1)*presentation.formation.rowSpacing),0,(unit.col-2)*presentation.formation.colSpacing);actor.ring.position.copy(actor.base).setY(.015);
     const attacking=current.frame?.actorId===unit.combatantId,pulse=attacking?Math.sin(Math.PI*Math.min(1,current.progress/.65)):0;
     actor.model.animate(dt,pulse);actor.model.root.position.x=actor.base.x+(unit.side==='player'?1:-1)*pulse*.8;
     actor.model.root.rotation.z=unit.state==='dead'?Math.PI/2:0;actor.model.root.position.y=unit.state==='dead'?.25:0;
     const hurt=hit&&unit.health<hit.health&&current.progress>.4&&current.progress<.85;
     actor.model.root.position.z=actor.base.z+(hurt?Math.sin(now*.055)*.075:0);
     actor.ring.visible=unit.state!=='dead';(actor.ring.material as THREE.MeshBasicMaterial).opacity=unit.isCurrentActor||current.highlightedId===unit.combatantId||current.selecting&&current.validTargetIds.includes(unit.combatantId)||current.selecting&&hovered===unit.combatantId?.8:.28;
     const screen=actor.base.clone().setY(.1).project(camera),tag=labels.current?.querySelector<HTMLElement>(`[data-unit-index="${current.view.combatants.indexOf(unit)}"]`);
     if(tag){tag.style.left=`${(screen.x*.5+.5)*el.clientWidth}px`;tag.style.top=`${(-screen.y*.5+.5)*el.clientHeight+12}px`;}
     if(unit.state!=='dead'){const center=actor.model.root.position.clone().add(new THREE.Vector3(0,.6,0)).project(camera);targets.push({id:unit.combatantId,x:(center.x*.5+.5)*el.clientWidth,y:(-center.y*.5+.5)*el.clientHeight});}
    }
    el.dataset.targets=JSON.stringify(targets);
    renderer!.render(scene,camera);
   };raf=requestAnimationFrame(tick);
  }catch(e){failed=true;setError(e instanceof Error?e.message:String(e));setLoading(false);el.dataset.ready='error';}
  return()=>{disposed=true;onReady?.(false);cancelAnimationFrame(raf);observer.disconnect();const geometries=new Set<THREE.BufferGeometry>(),materials=new Set<THREE.Material>();scene.traverse(o=>{if(o instanceof THREE.Mesh){geometries.add(o.geometry);for(const m of Array.isArray(o.material)?o.material:[o.material])materials.add(m);}});geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());textures.forEach(t=>t.dispose());renderer?.dispose();renderer?.domElement.remove();};
 },[view.encounterId,ground,onReady]);
 return <><div ref={host} className="combat-arena"/>{loading&&<div className="combat-loading" role="status">{loadingLabel}</div>}{error&&<p className="combat-error" role="alert">{error}</p>}
 <div ref={labels} className="combat-labels">{view.combatants.map((unit,i)=>{
  const before=frame?.before.combatants.find(u=>u.combatantId===unit.combatantId),delta=before?unit.health-before.health:0;
  return <span key={unit.combatantId} data-unit-index={i} className="combat-damage-anchor">
   {delta!==0&&<strong className={`combat-float ${delta>0?'healing':''}`}>{delta>0?'+':''}{delta}</strong>}
  </span>;
 })}</div></>;
}
