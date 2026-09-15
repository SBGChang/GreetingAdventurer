import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { DungeonView } from './engine/game-facade';
import { t, type UiLocale } from './i18n';
export { dungeonArt } from './dungeon-art';

type Props = {
  modelUrl: string;
  locale: UiLocale;
  currentRoomId: string;
  revealedRoomIds: readonly string[];
  moves: DungeonView['moves'];
  onMove: (roomId: string) => void;
  onOpenDoor: (linkId: string) => void;
  overview?: boolean;
};
/** Art supplies geometry; only current GameView moves authorize interaction. */
export function DungeonModel(props: Props) {
  const host = useRef<HTMLDivElement>(null), latest = useRef(props); latest.current = props;
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [attempt, setAttempt] = useState(0);
  const [hover, setHover] = useState('');
  useEffect(() => {
    const el = host.current; if (!el) return;
    setState('loading'); setHover(''); el.dataset.ready = 'false';
    let disposed = false, model: THREE.Group | undefined, renderer: THREE.WebGLRenderer | undefined;
    let frame = 0, current = '', picked = '', drag: { x: number; y: number; moved: boolean; id: number } | undefined;
    let overview = props.overview;
    const scene = new THREE.Scene(); scene.background = new THREE.Color('#16272a');
    const camera = new THREE.OrthographicCamera(-20,20,15,-15,.1,200);
    const target = new THREE.Vector3(), smooth = new THREE.Vector3(), pan = new THREE.Vector3(), center = new THREE.Vector3();
    let overviewHeight=37;
    const offset = new THREE.Vector3(20,32,28);
    const rooms = new Map<string, THREE.Object3D>(), anchors = new Map<string, THREE.Vector3>(), doors = new Map<string, THREE.Object3D>();
    const focuses = new Map<string, THREE.Vector3>();
    const roomMaterials=new Map<string,{material:THREE.MeshStandardMaterial;color:THREE.Color;emission:THREE.Color;intensity:number}[]>();
    const roomContents=new Map<string,THREE.Object3D[]>();
    let lightingState='';
    const raycaster = new THREE.Raycaster(), pointer = new THREE.Vector2();
    const marker = new THREE.Mesh(new THREE.RingGeometry(.48,.62,48),new THREE.MeshBasicMaterial({color:'#f4d48b',side:THREE.DoubleSide}));
    marker.rotation.x=-Math.PI/2; scene.add(marker);
    const hoverRing = new THREE.Mesh(new THREE.RingGeometry(.7,.77,48),new THREE.MeshBasicMaterial({color:'#86e4cb',side:THREE.DoubleSide}));
    hoverRing.rotation.x=-Math.PI/2;hoverRing.visible=false;scene.add(hoverRing);
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>(), textures = new Set<THREE.Texture>();
    const disposeObject = (object: THREE.Object3D) => object.traverse(o => {
      if (!(o instanceof THREE.Mesh)) return;
      geometries.add(o.geometry);
      for (const mat of Array.isArray(o.material)?o.material:[o.material]) {
        materials.add(mat);
        for(const value of Object.values(mat)) if(value instanceof THREE.Texture) textures.add(value);
      }
    });
    const release = () => { geometries.forEach(x=>x.dispose());materials.forEach(x=>x.dispose());textures.forEach(x=>x.dispose()); };
    const resize = () => {
      if (!renderer || !el.clientWidth || !el.clientHeight) return;
      const aspect = el.clientWidth/el.clientHeight, height = latest.current.overview ? overviewHeight : 21;
      camera.left=-height*aspect/2;camera.right=height*aspect/2;camera.top=height/2;camera.bottom=-height/2;camera.updateProjectionMatrix();
      renderer.setSize(el.clientWidth,el.clientHeight);
    };
    const hit = (event: PointerEvent): string => {
      if(!model)return '';
      const rect=el.getBoundingClientRect();pointer.set((event.clientX-rect.left)/rect.width*2-1,1-(event.clientY-rect.top)/rect.height*2);
      raycaster.setFromCamera(pointer,camera);
      const first=raycaster.intersectObject(model,true).find(hit=>{let o:THREE.Object3D|null=hit.object;while(o){if(!o.visible)return false;o=o.parent;}return true;});
      let o:THREE.Object3D|null=first?.object??null;
      while(o){if(typeof o.userData.roomId==='string')return o.userData.roomId;o=o.parent;}
      return '';
    };
    const move = (event: PointerEvent) => {
      if(drag){
        const dx=event.clientX-drag.x,dy=event.clientY-drag.y;
        if(Math.abs(dx)+Math.abs(dy)>3)drag.moved=true;
        if(drag.moved){
          const rect=el.getBoundingClientRect(),scale=(camera.top-camera.bottom)/rect.height;
          const right=new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld,0),up=new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld,1);
          pan.addScaledVector(right,-dx*scale).addScaledVector(up,dy*scale);pan.y=0;pan.clamp(new THREE.Vector3(-18,0,-18),new THREE.Vector3(18,0,18));
          drag.x=event.clientX;drag.y=event.clientY;
        }
        return;
      }
      picked=hit(event); const allowed=latest.current.moves.some(m=>m.roomId===picked);
      el.style.cursor=allowed?'pointer':'grab';setHover(allowed?picked:'');
    };
    const down=(e:PointerEvent)=>{if(e.button!==0&&e.button!==2)return;drag={x:e.clientX,y:e.clientY,moved:false,id:e.pointerId};el.setPointerCapture(e.pointerId);};
    const up=(e:PointerEvent)=>{
      if(!drag)return;const moved=drag.moved;drag=undefined;if(el.hasPointerCapture(e.pointerId))el.releasePointerCapture(e.pointerId);
      if(moved)return;const rid=hit(e),option=latest.current.moves.find(m=>m.roomId===rid);
      if(option)option.open?latest.current.onMove(rid):latest.current.onOpenDoor(option.linkId);
    };
    const cancel=()=>{drag=undefined;picked='';setHover('');};
    const leave=()=>{if(!drag){picked='';setHover('');}};
    const context=(e:MouseEvent)=>e.preventDefault();
    const fail=(error:unknown)=>{if(disposed)return;console.error('Dungeon model unavailable',error);setState('error');el.dataset.ready='error';};
    const observer=new ResizeObserver(resize);
    try {
      renderer=new THREE.WebGLRenderer({antialias:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
      renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.25;
      el.appendChild(renderer.domElement);observer.observe(el);resize();
      scene.add(new THREE.HemisphereLight('#b0d8de','#283730',2.0));
      const sun=new THREE.DirectionalLight('#ffdfa3',3);sun.position.set(-12,30,12);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);
      Object.assign(sun.shadow.camera,{left:-24,right:24,top:24,bottom:-24,near:.5,far:85});sun.shadow.bias=-.0004;sun.shadow.normalBias=.04;scene.add(sun);
      const fill=new THREE.DirectionalLight('#72c5d0',1.4);fill.position.set(12,12,-15);scene.add(fill);
      new GLTFLoader().loadAsync(props.modelUrl).then(gltf=>{
        if(disposed){disposeObject(gltf.scene);release();return;}
        model=gltf.scene;model.traverse(o=>{
          if(typeof o.userData.roomId==='string'){
            rooms.set(o.userData.roomId,o);
            const a=o.userData.anchor;
            if(!Array.isArray(a)||a.length!==3)throw new Error('Dungeon art lacks room anchor');
            anchors.set(o.userData.roomId,new THREE.Vector3(a[0],a[1],a[2]));
            focuses.set(o.userData.roomId,new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3()).setY(0));
          }
          if(typeof o.userData.linkId==='string')doors.set(o.userData.linkId,o);
          let owner:THREE.Object3D|null=o;while(owner&&!owner.userData.roomId)owner=owner.parent;
          if(owner&&o.userData.visualRole==='contents'){const id=String(owner.userData.roomId);roomContents.set(id,[...(roomContents.get(id)??[]),o]);}
          if(owner&&o instanceof THREE.Mesh){
            const id=String(owner.userData.roomId),entries=roomMaterials.get(id)??[];
            const clone=(mat:THREE.Material)=>{materials.add(mat);if(!(mat instanceof THREE.MeshStandardMaterial))return mat;const copy=mat.clone();entries.push({material:copy,color:copy.color.clone(),emission:copy.emissive.clone(),intensity:copy.emissiveIntensity});return copy;};
            o.material=Array.isArray(o.material)?o.material.map(clone):clone(o.material);roomMaterials.set(id,entries);
          }
          if(o instanceof THREE.Mesh){o.castShadow=true;o.receiveShadow=true;for(const m of Array.isArray(o.material)?o.material:[o.material])for(const value of Object.values(m))if(value instanceof THREE.Texture)value.anisotropy=renderer!.capabilities.getMaxAnisotropy();}
        });
        const bounds=new THREE.Box3().setFromObject(model),size=bounds.getSize(new THREE.Vector3());bounds.getCenter(center);center.y=0;
        overviewHeight=Math.max(37,(size.x+size.z)*.7);resize();
        lightingState='';scene.add(model);setState('ready');el.dataset.ready='true';el.dataset.roomCount=String(rooms.size);
      }).catch(fail);
      const tick=()=>{
        if(disposed)return;frame=requestAnimationFrame(tick);if(document.hidden)return;
        const p=latest.current;
        if (overview !== p.overview) { overview=p.overview; current=''; resize(); }
        if(current!==p.currentRoomId&&anchors.has(p.currentRoomId)){
          current=p.currentRoomId;target.copy(focuses.get(current)!);if(!el.dataset.currentRoom)smooth.copy(target);pan.set(0,0,0);el.dataset.currentRoom=current;
        }
        const lightKey=`${p.currentRoomId}:${!!p.overview}`;
        if(lightingState!==lightKey){
          lightingState=lightKey;
          for(const [id,entries] of roomMaterials){const lit=!!p.overview||id===p.currentRoomId;for(const f of entries){f.material.color.copy(f.color).multiplyScalar(lit?1:.045);f.material.emissive.copy(f.emission);f.material.emissiveIntensity=lit?f.intensity:0;}}
          for(const [id,groups] of roomContents)for(const group of groups)group.visible=!!p.overview||id===p.currentRoomId;
          el.dataset.litRooms=JSON.stringify(p.overview?[...rooms.keys()]:[p.currentRoomId]);
        }
        for(const [id,door] of doors){const option=p.moves.find(m=>m.linkId===id);if(option)door.visible=!option.open;}
        if(p.overview)target.copy(center);
        smooth.lerp(target,reduced.matches?1:.09);camera.position.copy(smooth).add(pan).add(offset);camera.lookAt(smooth.clone().add(pan));
        const anchor=anchors.get(current);marker.visible=!!anchor&&!p.overview;if(anchor)marker.position.copy(anchor).add(new THREE.Vector3(0,.26,0));
        const hoverAnchor=anchors.get(picked);hoverRing.visible=!!hoverAnchor&&p.moves.some(m=>m.roomId===picked);
        if(hoverAnchor)hoverRing.position.copy(hoverAnchor).add(new THREE.Vector3(0,.28,0));
        renderer!.render(scene,camera);
        const projected:Record<string,{x:number;y:number}>={};for(const [id,a] of anchors){const v=a.clone().project(camera);projected[id]={x:(v.x+1)/2,y:(1-v.y)/2};}
        el.dataset.rooms=JSON.stringify(projected);el.dataset.camera=JSON.stringify(pan.toArray());
      };tick();
      el.addEventListener('pointermove',move);el.addEventListener('pointerdown',down);el.addEventListener('pointerup',up);el.addEventListener('pointercancel',cancel);el.addEventListener('pointerleave',leave);el.addEventListener('contextmenu',context);
    } catch(error){fail(error);}
    return ()=>{disposed=true;cancelAnimationFrame(frame);observer.disconnect();el.removeEventListener('pointermove',move);el.removeEventListener('pointerdown',down);el.removeEventListener('pointerup',up);el.removeEventListener('pointercancel',cancel);el.removeEventListener('pointerleave',leave);el.removeEventListener('contextmenu',context);disposeObject(scene);release();renderer?.dispose();renderer?.domElement.remove();};
  },[props.modelUrl,attempt]);
  return <div className="dungeon-model-wrap">
    <div ref={host} className="dungeon-model" aria-label={t(props.locale,'ui.dungeon.scene')} />
    {state!=='ready'&&<div className="dungeon-model-status" role="status">{t(props.locale,state==='loading'?'ui.dungeon.loading':'ui.dungeon.modelError')}{state==='error'&&<button onClick={()=>setAttempt(n=>n+1)}>{t(props.locale,'ui.dungeon.retry')}</button>}</div>}
    {hover&&<div className="dungeon-model-hover">{hover.replace(/^[^.]+\./,'')}</div>}
    <span className="dungeon-model-hint">{t(props.locale,'ui.dungeon.cameraHint')}</span>
  </div>;
}
