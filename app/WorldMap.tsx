import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import worldUrl from './assets/geography/world.glb?url';
import { atlasCities, atlasCamera, atlasRoutes, cityModel } from './geography';
import { TownModel } from './TownModel';
import type { GameView } from './engine/game-facade';
import type { LocalizedTextRef } from '../src/contracts/core';
import { t, type UiLocale } from './i18n';
import './world-atlas.css';
import {ReceptionActions,useReception} from './FacilityReception';

function AtlasCanvas({ locale, selected, current, select, paused }: { paused: boolean; locale: UiLocale; selected: string; current: string; select: (key: string) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const markers = useRef(new Map<string, HTMLButtonElement>());
  const latest = useRef({ selected, select, paused }); latest.current = { selected, select, paused };
  const resetCamera = useRef<() => void>(() => {});
  const overviewCamera = useRef<() => void>(() => {});
  const focusCity = useRef<(key: string) => void>(() => {});
  useEffect(()=>{focusCity.current(selected);},[selected]);
  const [status, setStatus] = useState('loading');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const container = host.current;
    if (!container) return;
    setStatus('loading');container.dataset.ready='false';
    let disposed = false, frozenDrawn = false;
    let renderer: THREE.WebGLRenderer | undefined;
    let controls: OrbitControls | undefined;
    let model: THREE.Group | undefined;
    let camera: THREE.OrthographicCamera | undefined;
    const scene = new THREE.Scene();
    const cities = new Map<string, THREE.Object3D>();
    const position = new THREE.Vector3();
    const ray = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const release = (root: THREE.Object3D) => {
      const textures=new Set<THREE.Texture>();const materials=new Set<THREE.Material>();
      root.traverse(o=>{if(o instanceof THREE.Mesh){o.geometry.dispose();for(const material of Array.isArray(o.material)?o.material:[o.material])materials.add(material);}});
      for(const material of materials){for(const value of Object.values(material))if(value instanceof THREE.Texture)textures.add(value);material.dispose();}
      for(const texture of textures){texture.dispose();if(typeof ImageBitmap!=='undefined' && texture.image instanceof ImageBitmap)texture.image.close();}
    };
    const fail = (error: unknown) => { if(disposed)return;console.error('Atlas unavailable',error);container.dataset.ready='false';setStatus('error');renderer?.setAnimationLoop(null); };
    const resize = () => {
      frozenDrawn = false;
      if(!renderer || !camera)return;
      const w=container.clientWidth,h=container.clientHeight;
      if(!w||!h)return;
      renderer.setSize(w,h);
      const span=196;camera.left=-span*w/h/2;camera.right=span*w/h/2;camera.top=span/2;camera.bottom=-span/2;camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    let press: {x:number;y:number}|undefined;
    const down=(event:PointerEvent)=>{if(latest.current.paused)return;press={x:event.clientX,y:event.clientY};};
    const click=(event:MouseEvent)=>{
      if(latest.current.paused||!camera||!model||!press||Math.hypot(event.clientX-press.x,event.clientY-press.y)>5)return;
      const r=renderer!.domElement.getBoundingClientRect();pointer.set((event.clientX-r.left)/r.width*2-1,1-(event.clientY-r.top)/r.height*2);
      ray.setFromCamera(pointer,camera);let object=ray.intersectObject(model,true)[0]?.object;
      while(object){if(typeof object.userData.cityKey==='string'){latest.current.select(object.userData.cityKey);break;}object=object.parent??undefined;}
    };
    const lost=(event:Event)=>{event.preventDefault();fail(new Error('WebGL context lost'));};
    try {
      renderer=new THREE.WebGLRenderer({antialias:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.05;renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
      container.prepend(renderer.domElement);scene.background=new THREE.Color('#172e35');
      scene.add(new THREE.HemisphereLight('#d8ecf1','#87633c',1.1));
      const sun=new THREE.DirectionalLight('#ffe9c8',2.6);sun.position.set(-60,120,50);sun.castShadow=true;sun.shadow.mapSize.set(4096,4096);Object.assign(sun.shadow.camera,{left:-125,right:125,top:115,bottom:-115,near:1,far:300});sun.shadow.normalBias=.12;scene.add(sun);
      renderer.domElement.addEventListener('pointerdown',down);renderer.domElement.addEventListener('click',click);renderer.domElement.addEventListener('webglcontextlost',lost);
      new GLTFLoader().load(worldUrl,gltf=>{
        if(disposed){release(gltf.scene);return;}
        try{
          model=gltf.scene;scene.add(model);
          const authored=gltf.cameras[0];if(!(authored instanceof THREE.OrthographicCamera))throw new Error('Atlas camera missing');camera=authored;
          model.traverse(o=>{
            if(typeof o.userData.cityKey==='string')cities.set(o.userData.cityKey,o);
            if(o instanceof THREE.Mesh){o.castShadow=true;o.receiveShadow=true;for(const material of Array.isArray(o.material)?o.material:[o.material]){for(const value of Object.values(material))if(value instanceof THREE.Texture)value.anisotropy=Math.min(8,renderer!.capabilities.getMaxAnisotropy());}}
          });
          if(cities.size!==atlasCities.length)throw new Error('Atlas cities incomplete');
          controls=new OrbitControls(camera!,renderer!.domElement);controls.enableDamping=true;controls.minZoom=atlasCamera.minZoom;controls.maxZoom=atlasCamera.maxZoom;controls.minPolarAngle=.25;controls.maxPolarAngle=1.05;
          controls.mouseButtons={LEFT:THREE.MOUSE.PAN,MIDDLE:THREE.MOUSE.DOLLY,RIGHT:THREE.MOUSE.ROTATE};
          scene.add(sun.target);
          const frame=(target:THREE.Vector3,zoom:number)=>{
            if(!controls||!camera)return;
            camera.position.copy(target).add(new THREE.Vector3(35,95,85));controls.target.copy(target);camera.zoom=zoom;camera.updateProjectionMatrix();controls.update();
            const extent=zoom<1?350:120;sun.position.copy(target).add(new THREE.Vector3(-180,450,220));sun.target.position.copy(target);Object.assign(sun.shadow.camera,{left:-extent,right:extent,top:extent,bottom:-extent,far:1000});sun.shadow.camera.updateProjectionMatrix();
          };
          focusCity.current=key=>{const root=cities.get(key);if(root)frame(new THREE.Box3().setFromObject(root).getCenter(new THREE.Vector3()),atlasCamera.localZoom);};
          resetCamera.current=()=>focusCity.current(current);
          overviewCamera.current=()=>frame(new THREE.Vector3(),atlasCamera.overviewZoom);
          focusCity.current(latest.current.selected);
          observer.observe(container);resize();setStatus('ready');container.dataset.ready='true';
          renderer!.setAnimationLoop(()=>{
            if(!renderer||!camera||!controls||document.hidden)return;
            controls.enabled=!latest.current.paused;container.dataset.frozen=String(latest.current.paused);
            if(latest.current.paused){if(!frozenDrawn){renderer.render(scene,camera);frozenDrawn=true;}return;}
            frozenDrawn=false;controls.update();camera.updateMatrixWorld();
            const points: Record<string,{x:number;y:number}> = {};
            for(const [key,root] of cities){
              const marker=markers.current.get(key);if(!marker)continue;
              new THREE.Box3().setFromObject(root).getCenter(position);
              const hit=position.clone().project(camera);points[key]={x:(hit.x+1)/2,y:(1-hit.y)/2};
              position.y+=3;position.project(camera);
              marker.style.left=`${(position.x+1)/2*container.clientWidth}px`;marker.style.top=`${(1-position.y)/2*container.clientHeight}px`;
              marker.hidden=Math.abs(position.x)>1 || Math.abs(position.y)>1;
            }
            container.dataset.landmarks=JSON.stringify(points);
            container.dataset.zoom=String(camera.zoom);
            renderer.render(scene,camera);
          });
        }catch(error){fail(error);}
      },undefined,fail);
    }catch(error){fail(error);}
    return()=>{
      disposed=true;observer.disconnect();controls?.dispose();renderer?.setAnimationLoop(null);
      if(renderer){renderer.domElement.removeEventListener('pointerdown',down);renderer.domElement.removeEventListener('click',click);renderer.domElement.removeEventListener('webglcontextlost',lost);renderer.domElement.remove();}
      if(model)release(model);scene.traverse(o=>{if(o instanceof THREE.DirectionalLight)o.shadow.dispose();});renderer?.dispose();renderer?.forceContextLoss();resetCamera.current=()=>{};overviewCamera.current=()=>{};focusCity.current=()=>{};
    };
  },[attempt]);
  return <div className="atlas-canvas" ref={host}>
    {status==='ready' && atlasCities.map(city=><button key={city.key} className="atlas-marker" data-city-marker={city.key} data-rank={city.rank} data-selected={selected===city.key}
      ref={node=>{if(node)markers.current.set(city.key,node);else markers.current.delete(city.key);}}
      onClick={()=>select(city.key)}>{city.rank==='capital'?'◆ ':''}{locale==='en'?city.en:city.name}</button>)}
    {status!=='ready'&&<div className="atlas-status" role="status">{t(locale,status==='error'?'ui.scene.modelError':'ui.scene.modelLoading')}{status==='error'&&<button onClick={()=>setAttempt(n=>n+1)}>{t(locale,'ui.scene.modelRetry')}</button>}</div>}
    <div className="atlas-navigation"><button className="atlas-overview" onClick={()=>overviewCamera.current()}>{t(locale,'ui.atlas.overview')}</button><button className="atlas-reset" onClick={()=>resetCamera.current()}>{t(locale,'ui.atlas.reset')}</button></div>
  </div>;
}

export function WorldMap({ locale,city,currentCityId,text,onTravel,paused=false }: {
  paused?: boolean; locale: UiLocale; city: NonNullable<GameView['city']>; currentCityId: string;
  text: (ref: LocalizedTextRef) => string;
  onTravel:(routeId:string,toCityId:string,modeId:string,placeRef:LocalizedTextRef)=>void;
}) {
  const [selected,setSelected]=useState(()=>atlasCities.find(c=>c.cityId===currentCityId)?.key??atlasCities[0]!.key);
  const [preview,setPreview]=useState(false);
  const [modeId,setModeId]=useState(city.travelModes[1]?.modeId??city.travelModes[0]?.modeId??'');
  const target=atlasCities.find(c=>c.key===selected)!;
  const route=city.neighbours.find(n=>n.toCityId===target.cityId);
  const reception=useReception();
  const choose=(key:string)=>{setSelected(key);setPreview(false);const place=atlasCities.find(c=>c.key===key);if(place)reception?.inspect(place.cityId===currentCityId||city.neighbours.some(n=>n.toCityId===place.cityId)?'selected':'unavailable',locale==='en'?place.en:place.name)};
  return <section className="world-atlas" data-backdrop={paused} ref={e=>e?.toggleAttribute("inert",paused)} aria-label={t(locale,'ui.screen.worldMap')}>
    {preview?<div className="atlas-town-preview" data-preview-city={target.key}><TownModel overview paused={paused} key={target.key} modelUrl={cityModel(target)} locale={locale} facilities={[]} onHover={()=>{}} onVisit={()=>{}} /></div>
      :<AtlasCanvas paused={paused} locale={locale} selected={selected} current={atlasCities.find(c=>c.cityId===currentCityId)!.key} select={choose}/>}
    <aside className="atlas-detail">
      <small>{t(locale,'ui.atlas.title')} · {t(locale,target.rank==='capital'?'ui.atlas.capital':'ui.atlas.town')}</small><h2>{locale==='en'?target.en:target.name}</h2>
      <p>{locale==='en'?target.enDescription:target.description}</p>
      <button data-city-preview onClick={()=>setPreview(!preview)}>{t(locale,preview?'ui.atlas.back':'ui.atlas.inspect')}</button>
      {target.cityId===currentCityId?<p className="atlas-current">◆ {t(locale,'ui.worldMap.current')}</p>:route?<>
        {atlasRoutes.find(r=>r.routeId===route.routeId)?.kind==='ferry'&&<p data-ferry-route>{t(locale,'ui.atlas.ferry')}</p>}
        <ReceptionActions><div className="atlas-travel-modes">{city.travelModes.map(mode=><button key={mode.modeId} aria-pressed={modeId===mode.modeId} onClick={()=>setModeId(mode.modeId)}>{text(mode.nameRef)} · {t(locale,'ui.worldMap.days',{days:mode.durationDays})}</button>)}</div>
        <button data-atlas-travel disabled={!modeId} onClick={()=>onTravel(route.routeId,route.toCityId,modeId,route.nameRef)}>{t(locale,'ui.action.travelHere')} →</button></ReceptionActions>
      </>:<p>{t(locale,'ui.atlas.unavailable')}</p>}
      <small>{t(locale,'ui.atlas.direct')}</small>
      <div className="atlas-city-index atlas-direct">{city.neighbours.map(n=>{const c=atlasCities.find(c=>c.cityId===n.toCityId);return c&&<button key={n.routeId} data-direct-city={c.key} onClick={()=>choose(c.key)}>{text(n.nameRef)} →</button>;})}</div>
      <div className="atlas-city-index">{atlasCities.map(c=><button key={c.key} data-atlas-city={c.key} aria-pressed={selected===c.key} onClick={()=>choose(c.key)}>{locale==='en'?c.en:c.name}</button>)}</div>
      <p className="atlas-help">{t(locale,'ui.atlas.help')}</p>
    </aside>
  </section>;
}
