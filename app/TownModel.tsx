import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { OutlinePass } from 'three/addons/postprocessing/OutlinePass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

import { t, type UiLocale } from './i18n';

type Props = {
  modelUrl: string;
  overview?: boolean;
  locale: UiLocale;
  active?: string;
  facilities: readonly { kind: string; name: string }[];
  onHover: (kind?: string) => void;
  onVisit: (kind: string) => void;
};

/** The GLB contains presentation geometry; available actions come exclusively from the game view. */
export function TownModel(props: Props) {
  const host = useRef<HTMLDivElement>(null);
  const label = useRef<HTMLDivElement>(null);
  const latest = useRef(props);
  latest.current = props;
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const container = host.current;
    if (!container) return;
    setStatus('loading');
    container.dataset.ready = 'false';
    let disposed = false;
    let renderer: THREE.WebGLRenderer | undefined;
    let composer: EffectComposer | undefined;
    let outline: OutlinePass | undefined;
    let camera: THREE.OrthographicCamera | undefined;
    let model: THREE.Group | undefined;
    let selected: string | undefined;
    const buildings = new Map<string, THREE.Object3D>();
    const baseHeight = new Map<THREE.Object3D, number>();
    const scene = new THREE.Scene();
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const bounds = new THREE.Box3();
    const center = new THREE.Vector3();
    const cameraHome = new THREE.Vector3();
    const cameraRight = new THREE.Vector3();
    const cameraUp = new THREE.Vector3();
    const pan = new THREE.Vector2(), panTarget = new THREE.Vector2();
    let drag: { id: number; x: number; y: number; origin: THREE.Vector2; moved: boolean } | undefined;
    let suppressClick = false;
    let focusAt = 0;
    let pointerKind: string | undefined;
    const clampPan = () => { panTarget.x = THREE.MathUtils.clamp(panTarget.x, -29, 29); panTarget.y = THREE.MathUtils.clamp(panTarget.y, -23, 23); };
    const projectLandmarks = () => {
      if (!camera) return;
      const points: Record<string, { x: number; y: number }> = {};
      for (const [kind, root] of buildings) {
        bounds.setFromObject(root).getCenter(center).project(camera);
        points[kind] = { x: (center.x + 1) / 2, y: (1 - center.y) / 2 };
      }
      container.dataset.landmarks = JSON.stringify(points);
      container.dataset.camera = JSON.stringify({ x: pan.x, y: pan.y, height: camera.top - camera.bottom, rotation: camera.quaternion.toArray() });
      container.dataset.cameraMoving = String(Boolean(focusAt) || pan.distanceTo(panTarget) > .025);
    };
    const releaseModel = (object: THREE.Object3D) => object.traverse(child => {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        for (const material of Array.isArray(child.material) ? child.material : [child.material]) material.dispose();
      }
    });
    const fail = (error: unknown) => {
      if (disposed) return;
      console.error('Town model unavailable', error);
      renderer?.setAnimationLoop(null);
      container.dataset.ready = 'false';
      latest.current.onHover(undefined);
      setStatus('error');
    };
    const resize = () => {
      const w = container.clientWidth, h = container.clientHeight;
      if (!w || !h || !renderer) return;
      renderer.setSize(w, h);
      if (!camera || !composer) return;
      const aspect = w / h, height = props.overview ? Math.max(66, 107 / aspect) : Math.max(30, 52 / aspect);
      Object.assign(camera, { top: height / 2, bottom: -height / 2, left: -height * aspect / 2 + 5, right: height * aspect / 2 + 5 });
      camera.updateProjectionMatrix();
      composer.setSize(w, h);
      // Projected landmarks let desktop verification target the real canvas, including stage scaling.
      projectLandmarks();
    };
    const hit = (event: PointerEvent | MouseEvent): string | undefined => {
      if (!model || !camera || !renderer) return;
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
      raycaster.setFromCamera(pointer, camera);
      let object: THREE.Object3D | null | undefined = raycaster.intersectObject(model, true)[0]?.object;
      while (object && typeof object.userData.facility !== 'string') object = object.parent;
      const kind: unknown = object?.userData.facility;
      return typeof kind === 'string' && latest.current.facilities.some(f => f.kind === kind) ? kind : undefined;
    };
    const move = (event: PointerEvent) => {
      if (drag && camera && renderer) {
        const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
        if (Math.hypot(dx, dy) > 6) drag.moved = true;
        if (drag.moved) {
          const rect = renderer.domElement.getBoundingClientRect();
          panTarget.set(drag.origin.x - dx / rect.width * (camera.right - camera.left), drag.origin.y + dy / rect.height * (camera.top - camera.bottom));
          clampPan(); pan.copy(panTarget); latest.current.onHover(undefined); focusAt = 0;
        }
        return;
      }
      pointerKind = hit(event); latest.current.onHover(pointerKind);
    };
    const leave = (event: PointerEvent) => {
      if (drag) return;
      pointerKind = undefined;
      // React dispatches sidebar enter from pointerout, before this native pointerleave.
      // Do not erase the sidebar's newer selection when crossing from canvas to a tab.
      if (event.relatedTarget instanceof Element && event.relatedTarget.closest('[data-building-tab]')) return;
      latest.current.onHover(undefined);
    };
    const down = (event: PointerEvent) => {
      if (props.overview || (event.button !== 0 && event.button !== 2) || !renderer) return;
      panTarget.copy(pan); focusAt = 0; suppressClick = false;
      container.dataset.cameraFocus = '';
      drag = { id: event.pointerId, x: event.clientX, y: event.clientY, origin: pan.clone(), moved: false };
      renderer.domElement.setPointerCapture(event.pointerId);
    };
    const up = (event: PointerEvent) => {
      if (!drag || event.pointerId !== drag.id) return;
      suppressClick = drag.moved || event.type === 'pointercancel'; drag = undefined;
      if (renderer?.domElement.hasPointerCapture(event.pointerId)) renderer.domElement.releasePointerCapture(event.pointerId);
    };
    const contextMenu = (event: Event) => event.preventDefault();
    const click = (event: MouseEvent) => { if (suppressClick) { suppressClick = false; return; } const kind = hit(event); if (kind) latest.current.onVisit(kind); };
    const lost = (event: Event) => { event.preventDefault(); fail(new Error('WebGL context lost')); };
    const observer = new ResizeObserver(resize);
    setStatus('loading');
    container.dataset.ready = 'false';
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.15;
      container.prepend(renderer.domElement);
      renderer.domElement.addEventListener('pointermove', move);
      renderer.domElement.addEventListener('pointerleave', leave);
      renderer.domElement.addEventListener('click', click);
      renderer.domElement.addEventListener('pointerdown', down);
      renderer.domElement.addEventListener('pointerup', up);
      renderer.domElement.addEventListener('pointercancel', up);
      renderer.domElement.addEventListener('lostpointercapture', up);
      renderer.domElement.addEventListener('contextmenu', contextMenu);
      renderer.domElement.addEventListener('webglcontextlost', lost);
      scene.background = new THREE.Color('#56635d');
      scene.add(new THREE.HemisphereLight('#d9e7eb', '#8e7952', 1.15));
      const sun = new THREE.DirectionalLight('#ffe0ac', 2.8);
      sun.position.set(-30, 55, 26);
      sun.castShadow = true;
      sun.shadow.mapSize.set(4096, 4096);
      Object.assign(sun.shadow.camera, { left: -48, right: 48, top: 43, bottom: -43, near: 1, far: 160 });
      sun.shadow.normalBias = .16;
      sun.shadow.bias = -.001;
      scene.add(sun);
      const fill = new THREE.DirectionalLight('#a8cdd9', .45);
      fill.position.set(20, 12, -12); scene.add(fill);
      observer.observe(container); resize();
      new GLTFLoader().load(props.modelUrl, gltf => {
        if (disposed) { releaseModel(gltf.scene); return; }
        model = gltf.scene;
        try {
          const authoredCamera = gltf.cameras[0];
          if (!(authoredCamera instanceof THREE.OrthographicCamera)) throw new Error('Town requires an orthographic camera');
          camera = authoredCamera;
          cameraHome.copy(camera.position);
          cameraRight.set(1, 0, 0).applyQuaternion(camera.quaternion);
          cameraUp.set(0, 1, 0).applyQuaternion(camera.quaternion);
          let scenery = 0;
          model.traverse(object => {
            if (object.userData.scenery) scenery++;
            if (typeof object.userData.facility === 'string') {
              if (buildings.has(object.userData.facility)) throw new Error('Duplicate town landmark');
              buildings.set(object.userData.facility, object);
              baseHeight.set(object, object.position.y);
            }
            if (object instanceof THREE.Mesh) {
              object.castShadow = true; object.receiveShadow = true;
              for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
                if (material instanceof THREE.MeshStandardMaterial && material.map) material.map.anisotropy = Math.min(8, renderer!.capabilities.getMaxAnisotropy());
              }
            }
          });
          for (const f of latest.current.facilities) if (!buildings.has(f.kind)) throw new Error(`Missing town landmark: ${f.kind}`);
          scene.add(model);
          if (!renderer) return;
          composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(container.clientWidth, container.clientHeight, { type: THREE.HalfFloatType, samples: 4 }));
          composer.addPass(new RenderPass(scene, camera));
          outline = new OutlinePass(new THREE.Vector2(container.clientWidth, container.clientHeight), scene, camera);
          outline.edgeStrength = 2; outline.edgeGlow = 1.1; outline.edgeThickness = 2;
          outline.visibleEdgeColor.set('#ffdda0'); outline.hiddenEdgeColor.set('#443c21');
          composer.addPass(outline); composer.addPass(new OutputPass());
          scene.updateMatrixWorld(true); camera.updateMatrixWorld(true); resize();
          container.dataset.sceneryCount = String(scenery);
          container.dataset.ready = 'true'; setStatus('ready');
          let lastTime = performance.now();
          renderer.setAnimationLoop(time => {
            if (!renderer || !camera || !composer || !outline || document.hidden) return;
            const dt = Math.min((time - lastTime) / 1000, .05); lastTime = time;
            const active = latest.current.active;
            const root = active ? buildings.get(active) : undefined;
            if (active !== selected) { selected = active; outline.selectedObjects = root ? [root] : []; focusAt = root && !props.overview && !drag ? time + 180 : 0; }
            if (root && focusAt && time >= focusAt && !drag) {
              bounds.setFromObject(root).getCenter(center);
              const desired = center.clone().sub(cameraHome);
              const destination = new THREE.Vector2(desired.dot(cameraRight), desired.dot(cameraUp));
              // Canvas hover makes a gentle follow; sidebar/keyboard focus brings distant buildings into view.
              panTarget.copy(pan).lerp(destination, active === pointerKind ? .45 : 1);
              clampPan(); focusAt = 0;
              container.dataset.cameraFocus = active;
            }
            if (!drag) {
              if (reducedMotion.matches) pan.copy(panTarget);
              else { pan.x = THREE.MathUtils.damp(pan.x, panTarget.x, 5, dt); pan.y = THREE.MathUtils.damp(pan.y, panTarget.y, 5, dt); }
            }
            camera.position.copy(cameraHome).addScaledVector(cameraRight, pan.x).addScaledVector(cameraUp, pan.y);
            camera.updateMatrixWorld(true);
            projectLandmarks();
            outline.pulsePeriod = reducedMotion.matches ? 0 : 3;
            for (const [kind, building] of buildings) {
              const base = baseHeight.get(building);
              if (base === undefined) continue;
              const target = base + (kind === active && !reducedMotion.matches ? .65 : 0);
              building.position.y = THREE.MathUtils.damp(building.position.y, target, 9, dt);
            }
            container.dataset.hovered = active ?? '';
            renderer.domElement.style.cursor = drag?.moved ? 'grabbing' : root ? 'pointer' : props.overview ? 'default' : 'grab';
            if (root && label.current) {
              bounds.setFromObject(root).getCenter(center); center.y = bounds.max.y + .35; center.project(camera);
              label.current.style.left = `${THREE.MathUtils.clamp((center.x + 1) * .5 * container.clientWidth, 100, container.clientWidth - 100)}px`;
              label.current.style.top = `${Math.max(30, (1 - center.y) * .5 * container.clientHeight)}px`;
            }
            composer.render();
          });
        } catch (error) { fail(error); }
      }, undefined, fail);
    } catch (error) { fail(error); }
    return () => {
      disposed = true; observer.disconnect(); renderer?.setAnimationLoop(null);
      if (renderer) {
        const canvas = renderer.domElement;
        canvas.removeEventListener('pointermove', move); canvas.removeEventListener('pointerleave', leave);
        canvas.removeEventListener('click', click); canvas.removeEventListener('webglcontextlost', lost);
        canvas.removeEventListener('pointerdown', down); canvas.removeEventListener('pointerup', up);
        canvas.removeEventListener('pointercancel', up); canvas.removeEventListener('lostpointercapture', up);
        canvas.removeEventListener('contextmenu', contextMenu);
        canvas.remove();
      }
      for (const pass of composer?.passes ?? []) pass.dispose();
      composer?.dispose();
      if (model) releaseModel(model);
      scene.traverse(object => { if (object instanceof THREE.DirectionalLight) object.shadow.dispose(); });
      renderer?.dispose(); renderer?.forceContextLoss();
    };
  }, [attempt, props.modelUrl, props.overview]);

  const name = props.facilities.find(f => f.kind === props.active)?.name;
  return <div ref={host} className="town-model" aria-label={t(props.locale, 'ui.scene.buildings')}>
    {status !== 'ready' && <div className="town-model-status" role={status === 'error' ? 'alert' : 'status'}>
      <p>{t(props.locale, status === 'error' ? 'ui.scene.modelError' : 'ui.scene.modelLoading')}</p>
      {status === 'error' && <button onClick={() => setAttempt(n => n + 1)}>{t(props.locale, 'ui.scene.modelRetry')}</button>}
    </div>}
    <div ref={label} className="building-label" hidden={!name || status !== 'ready'} aria-hidden>{name}</div>
  </div>;
}
