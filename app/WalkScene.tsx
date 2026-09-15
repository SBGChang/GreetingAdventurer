import { useEffect,useRef,useState,type RefObject } from 'react';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {createWalker} from './Walker';
import {createCombatModel} from './CombatModels';
import {createWalkController} from './walk-controller';
import presentation from './assets/dungeons/walk-presentation.json';
import {t, type UiLocale} from './i18n';
import {walkInteractions,canUseWalkInteraction} from './walk-interactions';
import type { WalkSpace, WalkState, WalkParty } from './walk-types';

export type WalkSceneProps = {
 encounters:readonly {contentId:string;modelId:string;label:string}[];onFight:(id:string,label:string)=>boolean;
 minimap: RefObject<HTMLDivElement>; revealedRoomIds: readonly string[];
 sceneId: string; modelUrl: string; space: WalkSpace; state: WalkState; party: WalkParty;
 locale: UiLocale; active: boolean; backdrop?: boolean; onMove: (roomId: string) => boolean; onOpenDoor: (linkId: string) => boolean;
};
/** Shared production/test renderer. All gameplay state and commands arrive through props. */
export function WalkScene(props: WalkSceneProps){
 const {sceneId, modelUrl, space}=props;
 const markers=useRef<HTMLDivElement>(null),execute=useRef<(linkId:string)=>void>(()=>{}),preferred=useRef<string>();
 const targets=walkInteractions(space,props.state,presentation.interaction);
 const host=useRef<HTMLDivElement>(null),latest=useRef(props);latest.current=props;
 const [status,setStatus]=useState<'loading'|'ready'|'error'>('loading'),[attempt,setAttempt]=useState(0);
 const [interactionError,setInteractionError]=useState(false);
 useEffect(()=>{
  const el=host.current!;let disposed=false,frame=0,renderer:THREE.WebGLRenderer|undefined,model:THREE.Group|undefined;
  const minimapElement=latest.current.minimap.current;
  if(minimapElement){
   minimapElement.dataset.ready='false';minimapElement.dataset.rooms='[]';minimapElement.dataset.links='[]';
   const marker=minimapElement.querySelector<HTMLElement>('[data-minimap-player]');if(marker)marker.hidden=true;
  }
  const scene=new THREE.Scene();scene.background=new THREE.Color('#080f15');
  const camera=new THREE.OrthographicCamera(-12,12,8,-8,.1,130);
  const offset=new THREE.Vector3(presentation.cameraOffset.x,presentation.cameraOffset.y,presentation.cameraOffset.z),focus=new THREE.Vector3();
  let controller:ReturnType<typeof createWalkController>;
  const walker=createWalker();scene.add(walker.root);
  const keys=new Set<string>(),valid=new Set(['w','a','s','d','arrowup','arrowdown','arrowleft','arrowright']);
  const right=new THREE.Vector3(offset.z,0,-offset.x).normalize(),up=new THREE.Vector3(-offset.x,0,-offset.z).normalize();
  let last=performance.now(),room='',paused=false,failed=false,frozenDrawn=false,renderCount=0;
  const gates=new Map<string,THREE.Object3D[]>();
  const aerialCamera=new THREE.OrthographicCamera(-10,10,10,-10,.1,150);aerialCamera.up.set(0,0,-1);
  const aerialMeshes:{mesh:THREE.Mesh;roomId:string}[]=[];
  const aerialBackground=new THREE.Color('#0a1418');
  let lastLinks:WalkState['links']|undefined;
  let interactionState:WalkState|undefined,interacting:WalkState|undefined;
  const rings=new THREE.Group();scene.add(rings);
  const enemies=new THREE.Group();scene.add(enemies);
  let encounterKey='';const enemyActors:ReturnType<typeof createCombatModel>[]=[];
  const raycaster=new THREE.Raycaster();
  const encounterAt=(event:MouseEvent)=>{
   if(!latest.current.active||!latest.current.state.canMove||!model)return;
   const rect=el.getBoundingClientRect();raycaster.setFromCamera(new THREE.Vector2((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1),camera);
   let hit=raycaster.intersectObjects([model,...enemies.children],true)[0]?.object;
   while(hit&&!hit.userData.contentId)hit=hit.parent??undefined;
   return latest.current.encounters.find(e=>e.contentId===hit?.userData.contentId);
  };
  const fightClick=(event:MouseEvent)=>{const entry=encounterAt(event);if(entry){keys.clear();latest.current.onFight(entry.contentId,entry.label);}};
  const encounterHover=(event:MouseEvent)=>{const entry=encounterAt(event);el.title=entry?.label??'';if(renderer)renderer.domElement.style.cursor=entry?'crosshair':'default';};
  const available=()=>walkInteractions(space,latest.current.state,presentation.interaction);
  const nearby=()=>available().filter(target=>canUseWalkInteraction(target,controller.position,latest.current.state,presentation.interaction.reach)).sort((a,b)=>{
   if(a.linkId===preferred.current)return -1;if(b.linkId===preferred.current)return 1;
   const p=controller.position;return Math.hypot(a.x-p.x,a.z-p.z)-Math.hypot(b.x-p.x,b.z-p.z)||a.linkId.localeCompare(b.linkId);
  });
  const useTarget=(linkId:string)=>{
   if(!latest.current.active||failed||!model||interacting)return;
   const target=available().find(t=>t.linkId===linkId);
   if(!target||!canUseWalkInteraction(target,controller.position,latest.current.state,presentation.interaction.reach))return;
   keys.clear();interacting=latest.current.state;setInteractionError(false);
   const accepted=target.kind==='openDoor'?latest.current.onOpenDoor(target.linkId):latest.current.onMove(target.roomId);
   if(!accepted){interacting=undefined;setInteractionError(true);}
  };
  execute.current=useTarget;
  type Finish={material:THREE.MeshStandardMaterial;color:THREE.Color;emission:THREE.Color;intensity:number};
  const roomFinishes=new Map<string,Finish[]>(),contents=new Map<string,THREE.Object3D[]>();
  const ownedMaterials=new Set<THREE.Material>(),ownedTextures=new Set<THREE.Texture>(),ownedGeometry=new Set<THREE.BufferGeometry>();
  const remember=(object:THREE.Object3D)=>object.traverse(o=>{if(o instanceof THREE.Mesh){ownedGeometry.add(o.geometry);for(const m of Array.isArray(o.material)?o.material:[o.material]){ownedMaterials.add(m);for(const v of Object.values(m))if(v instanceof THREE.Texture)ownedTextures.add(v);}}});
  const free=()=>{ownedGeometry.forEach(g=>g.dispose());ownedMaterials.forEach(m=>m.dispose());ownedTextures.forEach(t=>t.dispose());};
  const clear=()=>{keys.clear();paused=true;};
  const keyDown=(e:KeyboardEvent)=>{if(!latest.current.active||!latest.current.state.canMove||e.target instanceof HTMLElement&&e.target.closest('select,input,textarea,[contenteditable=true],[role=dialog]'))return;if(e.key.toLowerCase()==='e'){e.preventDefault();if(!e.repeat && controller){const target=nearby()[0];if(target)useTarget(target.linkId);}return;}if(valid.has(e.key.toLowerCase())){e.preventDefault();keys.add(e.key.toLowerCase());paused=false;}};
  const keyUp=(e:KeyboardEvent)=>keys.delete(e.key.toLowerCase());
  const visibility=()=>{keys.clear();last=performance.now();};
  const resize=()=>{frozenDrawn=false;if(!renderer||!el.clientWidth||!el.clientHeight)return;const ratio=el.clientWidth/el.clientHeight;camera.left=-presentation.cameraHalfHeight*ratio;camera.right=presentation.cameraHalfHeight*ratio;camera.top=presentation.cameraHalfHeight;camera.bottom=-presentation.cameraHalfHeight;camera.updateProjectionMatrix();renderer.setSize(el.clientWidth,el.clientHeight);};
  const observer=new ResizeObserver(resize);
  setStatus('loading');setInteractionError(false);preferred.current=undefined;el.dataset.ready='false';
  try{
   if(!latest.current.party.memberIds.includes(latest.current.party.leaderId))throw new Error('Adventure entrance requires the actual party leader');
   controller=createWalkController(space,latest.current.state,roomId=>{
    const accepted=latest.current.onMove(roomId);
    if(!accepted)keys.clear();
    return accepted;
   });
   renderer=new THREE.WebGLRenderer({antialias:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.1;
   el.appendChild(renderer.domElement);observer.observe(el);resize();
   renderer.domElement.addEventListener('click',fightClick);
   renderer.domElement.addEventListener('mousemove',encounterHover);
   scene.add(new THREE.HemisphereLight('#bddbd5','#172b29',2.2));
   const sun=new THREE.DirectionalLight('#ffe4b2',3);sun.position.set(-12,30,15);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);Object.assign(sun.shadow.camera,{left:-25,right:25,top:25,bottom:-25,near:.1,far:80});sun.shadow.normalBias=.035;scene.add(sun);
   new GLTFLoader().loadAsync(modelUrl).then(gltf=>{
    if(disposed){remember(gltf.scene);free();return;}
    model=gltf.scene;remember(model);model.traverse(o=>{
     if(typeof o.userData.linkId==='string'){const id=o.userData.linkId;gates.set(id,[...(gates.get(id)??[]),o]);}
     if(o.userData.visualRole==='contents'){
      let parent=o.parent;while(parent&&!parent.userData.roomId)parent=parent.parent;
      if(!parent)throw new Error('Content group lacks room');
      const id=String(parent.userData.roomId);contents.set(id,[...(contents.get(id)??[]),o]);
     }
     if(!(o instanceof THREE.Mesh))return;
     let parent:THREE.Object3D|null=o;while(parent&&!parent.userData.roomId)parent=parent.parent;
     if(!parent)throw new Error('Mesh lacks room');
     const id=String(parent.userData.roomId);aerialMeshes.push({mesh:o,roomId:id});const finishes=roomFinishes.get(id)??[];
     const clone=(m:THREE.Material)=>{
      if(!(m instanceof THREE.MeshStandardMaterial))throw new Error('Unsupported dungeon material');
      const copy=m.clone();ownedMaterials.add(copy);finishes.push({material:copy,color:copy.color.clone(),emission:copy.emissive.clone(),intensity:copy.emissiveIntensity});return copy;
     };
     o.material=Array.isArray(o.material)?o.material.map(clone):clone(o.material);roomFinishes.set(id,finishes);o.castShadow=true;o.receiveShadow=true;
    });
    scene.add(model);el.dataset.ready='true';setStatus('ready');
    const p=controller.position;focus.set(p.x,0,p.z);walker.root.position.set(p.x,.07,p.z);
   }).catch(error=>{if(!disposed){failed=true;keys.clear();console.error(error);setStatus('error');el.dataset.ready='error';}});
   const tick=(now:number)=>{
    if(disposed)return;frame=requestAnimationFrame(tick);const dt=Math.min((now-last)/1000,.04);last=now;if(document.hidden||!model||failed)return;
    if(!latest.current.active||!latest.current.state.canMove){keys.clear();paused=true;}
    if(!latest.current.active&&(!latest.current.backdrop||frozenDrawn))return;
    const animationDt=latest.current.active?dt:0;
    try{controller.sync(latest.current.state);}catch(error){failed=true;keys.clear();console.error(error);setStatus('error');el.dataset.ready='error';return;}
    if(lastLinks!==latest.current.state.links){
     lastLinks=latest.current.state.links;
     for(const [id,nodes] of gates){const link=lastLinks.find(l=>l.linkId===id);if(!link){failed=true;console.error(`Missing door data: ${id}`);setStatus('error');el.dataset.ready='error';return;}for(const node of nodes)node.visible=!link.open;}
     el.dataset.closedDoors=JSON.stringify(lastLinks.filter(l=>!l.open).map(l=>l.linkId));
    }
    if(interacting && interacting!==latest.current.state)interacting=undefined;
    if(interactionState!==latest.current.state){
     interactionState=latest.current.state;
     for(const child of rings.children){if(child instanceof THREE.Mesh){child.geometry.dispose();(child.material as THREE.Material).dispose();}}rings.clear();
     const anchors=new Set<string>();
     for(const target of available()){
      const key=`${target.x},${target.z}`;if(anchors.has(key))continue;anchors.add(key);
      const ring=new THREE.Mesh(new THREE.RingGeometry(.43,.58,40),new THREE.MeshBasicMaterial({color:'#d8b867',transparent:true,opacity:.65,side:THREE.DoubleSide,depthWrite:false}));
      ring.rotation.x=-Math.PI/2;ring.position.set(target.x,.09,target.z);ring.userData.linkId=target.linkId;rings.add(ring);
     }
    }
    el.dataset.party=JSON.stringify(latest.current.party);
    let sx=Number(keys.has('d')||keys.has('arrowright'))-Number(keys.has('a')||keys.has('arrowleft'));
    let sy=Number(keys.has('w')||keys.has('arrowup'))-Number(keys.has('s')||keys.has('arrowdown'));
    const length=Math.hypot(sx,sy);if(length){sx/=length;sy/=length;}
    const direction=right.clone().multiplyScalar(sx).addScaledVector(up,sy),before=controller.position;
    if(!interacting&&latest.current.active){
     const x=before.x+direction.x*presentation.speed*dt,z=before.z+direction.z*presentation.speed*dt;
     const blockedByEnemy=enemyActors.some(actor=>Math.hypot(x-actor.root.position.x,z-actor.root.position.z)<presentation.encounterClearance&&Math.hypot(x-actor.root.position.x,z-actor.root.position.z)<Math.hypot(before.x-actor.root.position.x,before.z-actor.root.position.z));
     if(!blockedByEnemy)controller.move(direction.x*presentation.speed*dt,direction.z*presentation.speed*dt);
    }
    const p=controller.position,moving=Math.hypot(p.x-before.x,p.z-before.z)>.0001;
    const nextEncounterKey=JSON.stringify([p.roomId,latest.current.encounters.map(e=>[e.contentId,e.modelId])]);
    try{if(nextEncounterKey!==encounterKey){
     encounterKey=nextEncounterKey;
     const retiredGeometry=new Set<THREE.BufferGeometry>(),retiredMaterials=new Set<THREE.Material>();
     enemies.traverse(o=>{if(o instanceof THREE.Mesh){retiredGeometry.add(o.geometry);for(const m of Array.isArray(o.material)?o.material:[o.material])retiredMaterials.add(m);}});
     retiredGeometry.forEach(g=>{g.dispose();ownedGeometry.delete(g);});retiredMaterials.forEach(m=>{m.dispose();ownedMaterials.delete(m);});enemies.clear();enemyActors.length=0;
     const cells=space.cells.filter(c=>c.roomId===p.roomId),placed:THREE.Vector3[]=[];
     for(const [index,entry] of latest.current.encounters.entries()){
      const cell=cells[index%cells.length]!;const cx=space.firstCellCenter+(cell.col-1)*space.cellSize,cz=space.firstCellCenter+(cell.row-1)*space.cellSize;
      const options:THREE.Vector3[]=[];
      for(let dx=-1.5;dx<=1.5;dx+=.5)for(let dz=-1.5;dz<=1.5;dz+=.5){const candidate=new THREE.Vector3(cx+dx,0,cz+dz);if(controller.canStand(candidate.x,candidate.z)&&placed.every(v=>v.distanceTo(candidate)>1.3))options.push(candidate);}
      options.sort((a,b)=>a.distanceToSquared(new THREE.Vector3(cx+1.5,0,cz+1.5))-b.distanceToSquared(new THREE.Vector3(cx+1.5,0,cz+1.5)));
      const position=options[0];if(!position)throw new Error(`No monster display space: ${entry.contentId}`);
      const actor=createCombatModel(entry.modelId);actor.root.position.copy(position);actor.root.userData.contentId=entry.contentId;enemies.add(actor.root);enemyActors.push(actor);placed.push(position);remember(actor.root);
     }
     el.dataset.encounterModels=String(enemyActors.length);
     el.dataset.encounterPositions=JSON.stringify(enemyActors.map(a=>({x:a.root.position.x,z:a.root.position.z,radius:presentation.encounterClearance})));
    }
    }catch(error){failed=true;keys.clear();console.error(error);setStatus('error');el.dataset.ready='error';return;}
    for(const actor of enemyActors)actor.animate(animationDt,0);
    walker.root.position.x=p.x;walker.root.position.z=p.z;walker.animate(animationDt*presentation.animationRate,moving);
    if(length)walker.root.rotation.y=Math.atan2(direction.x,direction.z);
    if(room!==p.roomId){
     room=p.roomId;
     for(const [id,finishes] of roomFinishes)for(const f of finishes){f.material.color.copy(f.color).multiplyScalar(id===room?1:.045);f.material.emissive.copy(id===room?f.emission:new THREE.Color(0));f.material.emissiveIntensity=id===room?f.intensity:0;}
     for(const [id,groups] of contents)for(const group of groups)group.visible=id===room;
     el.dataset.litRooms=JSON.stringify([room]);el.dataset.visibleContents=JSON.stringify([...contents].filter(([id])=>id===room).map(([id])=>id));
    }
    focus.lerp(new THREE.Vector3(p.x,0,p.z),1-Math.exp(-presentation.cameraFollowRate*animationDt));camera.position.copy(focus).add(offset);camera.lookAt(focus);camera.updateMatrixWorld();
    el.dataset.encounterScreens=JSON.stringify(enemyActors.map(actor=>{const p=actor.root.position.clone().add(new THREE.Vector3(0,.7,0)).project(camera);return {id:actor.root.userData.contentId,x:(p.x*.5+.5)*el.clientWidth,y:(-p.y*.5+.5)*el.clientHeight};}));
    const nearest=nearby()[0], slots=new Map<string,number>();
    for(const target of available()){
     const button=Array.from(markers.current?.querySelectorAll<HTMLButtonElement>('button')??[]).find(b=>b.dataset.linkId===target.linkId);
     if(!button)continue;
     const screen=new THREE.Vector3(target.x,presentation.interaction.labelHeight,target.z).project(camera);
     const key=`${target.x},${target.z}`,slot=slots.get(key)??0;slots.set(key,slot+1);
     button.style.left=`${(screen.x*.5+.5)*el.clientWidth}px`;button.style.top=`${(-screen.y*.5+.5)*el.clientHeight-slot*58}px`;
     button.hidden=Math.abs(screen.x)>1||Math.abs(screen.y)>1||Math.abs(screen.z)>1;
     button.disabled=!!interacting||!canUseWalkInteraction(target,p,latest.current.state,presentation.interaction.reach);
     button.dataset.near=String(!button.disabled);button.dataset.preferred=String(nearest?.linkId===target.linkId);
    }
    for(const child of rings.children){if(child instanceof THREE.Mesh){const near=nearby().some(t=>t.linkId===child.userData.linkId);const m=child.material as THREE.MeshBasicMaterial;m.opacity=near?.7+.18*Math.sin(now*.003):.3;}}
    rings.visible=latest.current.active;
    renderer!.render(scene,camera);
    frozenDrawn=!latest.current.active;el.dataset.renderCount=String(++renderCount);el.dataset.frozen=String(frozenDrawn);
    const map=latest.current.minimap.current;
    if(map&&latest.current.active){
     const known=new Set(latest.current.revealedRoomIds),cells=space.cells.filter(c=>known.has(c.roomId));
     const bounds=map.getBoundingClientRect(),surface=el.getBoundingClientRect();
     if(cells.length && bounds.width>0 && bounds.height>0){
      const cellX=(col:number)=>space.firstCellCenter+(col-1)*space.cellSize;
      const minX=Math.min(...cells.map(c=>cellX(c.col)))-space.cellSize/2,maxX=Math.max(...cells.map(c=>cellX(c.col)))+space.cellSize/2;
      const minZ=Math.min(...cells.map(c=>cellX(c.row)))-space.cellSize/2,maxZ=Math.max(...cells.map(c=>cellX(c.row)))+space.cellSize/2;
      const aspect=bounds.width/bounds.height,halfHeight=Math.max(presentation.minimap.minimumSpan,maxZ-minZ+presentation.minimap.padding*2,(maxX-minX+presentation.minimap.padding*2)/aspect)/2;
      aerialCamera.left=-halfHeight*aspect;aerialCamera.right=halfHeight*aspect;aerialCamera.top=halfHeight;aerialCamera.bottom=-halfHeight;
      aerialCamera.position.set((minX+maxX)/2,80,(minZ+maxZ)/2);aerialCamera.lookAt((minX+maxX)/2,0,(minZ+maxZ)/2);aerialCamera.updateProjectionMatrix();aerialCamera.updateMatrixWorld();
      // A second viewport shares the loaded geometry. Unknown room meshes never enter this pass.
      const visibility=aerialMeshes.map(({mesh,roomId})=>{const was=mesh.visible;mesh.visible=was&&known.has(roomId);return was;});
      const gateVisibility: {node:THREE.Object3D;visible:boolean}[]=[];
      for(const [id,nodes] of gates){const link=latest.current.state.links.find(l=>l.linkId===id)!;for(const node of nodes){gateVisibility.push({node,visible:node.visible});node.visible=node.visible&&known.has(link.fromRoomId)&&known.has(link.toRoomId);}}
      for(const [id,finishes] of roomFinishes)if(known.has(id))for(const f of finishes)f.material.color.copy(f.color).multiplyScalar(id===room?1:.8);
      const walkerVisible=walker.root.visible,ringsVisible=rings.visible,background=scene.background,shadowUpdate=renderer!.shadowMap.autoUpdate;
      walker.root.visible=false;rings.visible=false;enemies.visible=false;scene.background=aerialBackground;renderer!.shadowMap.autoUpdate=false;
      const scaleX=el.clientWidth/surface.width,scaleY=el.clientHeight/surface.height;
      renderer!.setViewport((bounds.left-surface.left)*scaleX,(surface.bottom-bounds.bottom)*scaleY,bounds.width*scaleX,bounds.height*scaleY);
      renderer!.setScissor((bounds.left-surface.left)*scaleX,(surface.bottom-bounds.bottom)*scaleY,bounds.width*scaleX,bounds.height*scaleY);renderer!.setScissorTest(true);
      try{renderer!.render(scene,aerialCamera);}finally{
       renderer!.setScissorTest(false);renderer!.setViewport(0,0,el.clientWidth,el.clientHeight);renderer!.shadowMap.autoUpdate=shadowUpdate;scene.background=background;
       walker.root.visible=walkerVisible;rings.visible=ringsVisible;enemies.visible=true;
       gateVisibility.forEach(({node,visible})=>{node.visible=visible;});aerialMeshes.forEach(({mesh},i)=>{mesh.visible=visibility[i]!;});
       for(const [id,finishes] of roomFinishes)for(const f of finishes)f.material.color.copy(f.color).multiplyScalar(id===room?1:.045);
      }
      const point=new THREE.Vector3(p.x,0,p.z).project(aerialCamera),marker=map.querySelector<HTMLElement>('[data-minimap-player]');
      if(marker){marker.hidden=false;marker.style.left=`${(point.x*.5+.5)*100}%`;marker.style.top=`${(-point.y*.5+.5)*100}%`;
       const heading=180-walker.root.rotation.y*180/Math.PI;marker.querySelector('svg')!.style.transform=`rotate(${heading}deg)`;
       marker.dataset.worldX=String(p.x);marker.dataset.worldZ=String(p.z);marker.dataset.roomId=p.roomId;marker.dataset.heading=String(heading);
      }
      map.dataset.rooms=JSON.stringify([...known]);map.dataset.links=JSON.stringify(latest.current.state.links.filter(l=>l.fromCell.floor===space.floor&&l.toCell.floor===space.floor&&known.has(l.fromRoomId)&&known.has(l.toRoomId)).map(l=>l.linkId));
      map.dataset.ready='true';
      const placed:{x:number;y:number;w:number;h:number}[]=[];
      for(const anchor of map.querySelectorAll<HTMLElement>('[data-minimap-anchor]')){
       const at=new THREE.Vector3(Number(anchor.dataset.worldX),0,Number(anchor.dataset.worldZ)).project(aerialCamera);
       anchor.hidden=false;
       const x=(at.x*.5+.5)*map.clientWidth,y=(-at.y*.5+.5)*map.clientHeight,w=anchor.offsetWidth,h=anchor.offsetHeight;
       const baseX=Math.max(w/2+2,Math.min(map.clientWidth-w/2-2,x)),baseY=Math.max(h/2+2,Math.min(map.clientHeight-h/2-2,y));
       let px=baseX,py=baseY;
       // Keep close entrances legible; displaced badges retain a line to the real anchor.
       const candidates=[{x:baseX,y:baseY}];
       for(let ring=1;ring<=6;ring++)for(let dx=-ring;dx<=ring;dx++)for(let dy=-ring;dy<=ring;dy++)if(Math.max(Math.abs(dx),Math.abs(dy))===ring)candidates.push({x:baseX+dx*28,y:baseY+dy*28});
       candidates.sort((a,b)=>(a.x-x)**2+(a.y-y)**2-((b.x-x)**2+(b.y-y)**2));
       const spot=candidates.find(c=>c.x-w/2>=2&&c.x+w/2<=map.clientWidth-2&&c.y-h/2>=2&&c.y+h/2<=map.clientHeight-2&&!placed.some(b=>Math.abs(c.x-b.x)<(w+b.w)/2+3&&Math.abs(c.y-b.y)<(h+b.h)/2+3));
       if(spot){px=spot.x;py=spot.y;}placed.push({x:px,y:py,w,h});
       anchor.style.left=`${px}px`;anchor.style.top=`${py}px`;
       const line=anchor.querySelector('line')!;line.setAttribute('x1',String(w/2+x-px));line.setAttribute('y1',String(h/2+y-py));line.setAttribute('x2',String(w/2));line.setAttribute('y2',String(h/2));
      }
     }
    }
    el.dataset.actor=JSON.stringify({...p,moving,paused});el.dataset.currentRoom=room;el.dataset.roomCount=String(roomFinishes.size);el.dataset.darkRooms=String(roomFinishes.size-1);
   };frame=requestAnimationFrame(tick);
   window.addEventListener('keydown',keyDown);window.addEventListener('keyup',keyUp);window.addEventListener('blur',clear);document.addEventListener('visibilitychange',visibility);
  }catch(error){console.error(error);setStatus('error');el.dataset.ready='error';}
  return()=>{disposed=true;execute.current=()=>{};cancelAnimationFrame(frame);keys.clear();observer.disconnect();window.removeEventListener('keydown',keyDown);window.removeEventListener('keyup',keyUp);window.removeEventListener('blur',clear);document.removeEventListener('visibilitychange',visibility);remember(scene);free();renderer?.dispose();renderer?.domElement.remove();};
 },[sceneId,modelUrl,attempt]); // State/party updates retain the scene; entrance identity owns geometry lifetime.
 const labels={openDoor:'ui.dungeon.openDoor',stairsUp:'ui.dungeon.stairsUp',stairsDown:'ui.dungeon.stairsDown'} as const;
 return <><div ref={host} className="walk-scene dungeon-model" aria-label={t(props.locale,'ui.dungeon.title')} data-scene-id={sceneId}/>
 <div ref={markers} className="walk-interactions">{targets.map(target=><button key={target.linkId} className="walk-interaction" ref={button=>{if(button && button.dataset.near===undefined){button.disabled=true;button.hidden=true;}}}
   data-link-id={target.linkId} data-move-room={target.roomId} data-interaction={target.kind} data-door-open={target.kind!=='openDoor'} data-world-x={target.x} data-world-z={target.z}
   onPointerEnter={()=>{preferred.current=target.linkId}} onPointerLeave={()=>{preferred.current=undefined}} onFocus={()=>{preferred.current=target.linkId}}
   onClick={()=>execute.current(target.linkId)}>
   <span className="interaction-glyph" aria-hidden>{target.kind==='openDoor'?'▣':target.kind==='stairsUp'?'↥':'↧'}</span>
   <span>{t(props.locale,labels[target.kind])}<small className="interaction-near"><kbd>E</kbd> · {t(props.locale,'ui.dungeon.interact')}</small><small className="interaction-far">{t(props.locale,'ui.dungeon.approach')}</small></span>
 </button>)}</div>
 {interactionError&&<p className="walk-interaction-error" role="status">{t(props.locale,'ui.dungeon.interactRejected')}</p>}
 {status!=='ready'&&<div className="walk-status" role="status">{t(props.locale,status==='loading'?'ui.dungeon.loading':'ui.dungeon.modelError')}{status==='error'&&<button onClick={()=>setAttempt(v=>v+1)}>{t(props.locale,'ui.dungeon.retry')}</button>}</div>}</>;
}
