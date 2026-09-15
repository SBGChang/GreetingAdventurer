import {useEffect, useRef, useState, type CSSProperties} from 'react';
import type {CombatArenaProps} from './combat-presentation-types';
import {SpriteSequence, type SpriteClip} from './SpriteSequence';
import {profiles, loadSpriteArt} from './combat-sprite-art';
type Atlases = Awaited<ReturnType<typeof loadSpriteArt>>;
import {spriteFormation} from './combat-sprite-catalog';
import {CombatGround} from './CombatGround';
import './combat-2d.css';

const clamp = (n: number) => Math.max(0, Math.min(1, n));
function loopPose(clip: SpriteClip, time: number) {
  let remaining = time % clip.frames.reduce((sum, f) => sum + f.durationMs, 0);
  for (let i = 0; i < clip.frames.length; i++) { remaining -= clip.frames[i]!.durationMs; if (remaining < 0) return i; }
  return clip.frames.length - 1;
}

/** Shared renderer: all encounter-specific art is supplied by the entrance contract. */
export function CombatSpriteArena({ground,view, frame, progress, selecting, validTargetIds, onTarget, label, actionLabel, loadingLabel, onReady, spritePresentation, highlightedId}: CombatArenaProps) {
  if (!spritePresentation) throw new Error('Missing sprite battle presentation');
  const {scene, skins} = spritePresentation;
  const widths: Record<string, number> = scene.skinWidths;
  const host = useRef<HTMLDivElement>(null);
  const [atlases, setAtlases] = useState<Atlases>(), [error, setError] = useState('');
  const [scale, setScale] = useState(1), [clock, setClock] = useState(0), [hovered, setHovered] = useState<string>();
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  useEffect(() => {
    let cancelled = false; onReady?.(false);
    const invalid = view.combatants.find(u => !profiles[skins[u.combatantId]!]);
    if (invalid) { setError(`尚無此參戰者的 2D 美術：${invalid.modelId}`); return; }
    loadSpriteArt().then(loaded => { if (!cancelled) { setAtlases(loaded); onReady?.(true); } }).catch((e: Error) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; onReady?.(false); };
  }, [view.encounterId, onReady]);
  useEffect(() => {
    const el = host.current!;
    const resize = () => setScale(Math.min(el.clientWidth / scene.width, el.clientHeight / scene.height));
    const observer = new ResizeObserver(resize); observer.observe(el); resize();
    let raf = 0, last = 0;
    const tick = (time: number) => { if (!document.hidden && !reduced && time - last >= 1000 / scene.sampleFps) { setClock(time); last = time - (time - last) % (1000 / scene.sampleFps); } raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => { observer.disconnect(); cancelAnimationFrame(raf); };
  }, [reduced, scene]);

  const formation = (unit: typeof view.combatants[number]) => {
    const stable = frame && progress < scene.returnEnd ? frame.before.combatants.find(u => u.combatantId === unit.combatantId)! : unit;
    return spriteFormation(stable, scene);
  };
  const units = view.combatants.map((unit, i) => {
    const skin = skins[unit.combatantId], profile = skin && profiles[skin];
    if (!skin || !profile) return undefined;
    const before = frame?.before.combatants.find(u => u.combatantId === unit.combatantId);
    const action = frame?.actions.find(a => a.actorId === unit.combatantId);
    const results = frame?.actions.flatMap(a => a.results) ?? [];
    const hurt = results.some(r => r.kind === 'dealDamage' && r.targetId === unit.combatantId && r.amount > 0);
    const dead = unit.state === 'dead', newDeath = dead && before?.state !== 'dead';
    const attack = !!action?.skillId && action.results.some(r => r.kind === 'dealDamage');
    const stance = !!action?.results.some(r => r.kind === 'counterStanceEstablished');
    const pose = dead ? 'defeat' : hurt && progress >= scene.impactProgress ? 'hit' : attack ? 'attack' : stance ? 'guard' : 'idle';
    const clip = profile.clips.find(c => c.id === pose);
    if (!clip) throw new Error(`缺少動作：${skin}/${pose}`);
    const count = clip.frames.length;
    const poseIndex = pose === 'idle' ? loopPose(clip, clock + i * 170) : dead && (!frame || !newDeath) ? count - 1 : pose === 'hit' || pose === 'defeat' ? Math.min(count - 1, Math.floor(clamp((progress - scene.impactProgress) / (1 - scene.impactProgress)) * count)) : Math.min(count - 1, progress < scene.impactProgress ? Math.floor(progress / scene.impactProgress * 3) : 3 + Math.floor((progress - scene.impactProgress) / (1 - scene.impactProgress) * 3));
    const base = formation(unit), position = {...base};
    const damage = action?.results.find(r => r.kind === 'dealDamage' && r.targetId !== unit.combatantId);
    const target = damage?.kind === 'dealDamage' ? view.combatants.find(u => u.combatantId === damage.targetId) : undefined;
    if (attack && target && !reduced) {
      const aim = formation(target);
      const reach = progress < scene.returnStart ? clamp((progress - scene.approachStart) / (scene.approachEnd - scene.approachStart)) : 1 - clamp((progress - scene.returnStart) / (scene.returnEnd - scene.returnStart));
      const ease = reach * reach * (3 - 2 * reach);
      position.x += (aim.x + (unit.side === 'player' ? -scene.contactDistance : scene.contactDistance) - base.x) * ease;
      position.y += (aim.y - base.y) * ease;
    }
    return {unit, skin, clip, pose, poseIndex, position, base, delta: before ? unit.health - before.health : 0, moving: attack && progress > scene.approachStart && progress < scene.returnEnd};
  }).filter((u): u is NonNullable<typeof u> => u !== undefined);

  useEffect(() => {
    const el = host.current; if (!el || !atlases) return;
    const outer = el.getBoundingClientRect();
    el.dataset.targets = JSON.stringify(units.filter(u => u.unit.state !== 'dead').map(u => {
      const r = el.querySelector<HTMLElement>(`[data-sprite-unit="${u.unit.combatantId}"] canvas`)!.getBoundingClientRect();
      const f = u.clip.frames[u.poseIndex]!;
      if (!f) throw new Error(`Invalid sprite frame: ${u.skin}/${u.pose} index=${u.poseIndex} progress=${progress}`);
      return {id: u.unit.combatantId, x: (r.left - outer.left + r.width / 2 + (f.rect.width / 2 - f.pivot.x) * u.clip.scale * r.width / 600) * el.clientWidth / outer.width,
        y: (r.top - outer.top + r.height * .84 + (f.rect.height / 2 - f.pivot.y) * u.clip.scale * r.width / 600) * el.clientHeight / outer.height};
    }));
  }, [units, atlases, scale]);
  const pick = (x: number, y: number) => {
    if (!selecting || !atlases) return;
    const candidates = [...units].sort((a, b) => (b.moving ? 2000 : b.position.y) - (a.moving ? 2000 : a.position.y));
    for (const u of candidates) {
      if (u.unit.state === 'dead'||!validTargetIds.includes(u.unit.combatantId)) continue;
      const canvas = host.current?.querySelector<HTMLCanvasElement>(`[data-sprite-unit="${u.unit.combatantId}"] canvas`);
      if (!canvas) continue;
      const rect = canvas.getBoundingClientRect(), px = Math.floor((x - rect.left) / rect.width * canvas.width), py = Math.floor((y - rect.top) / rect.height * canvas.height);
      if (px >= 0 && py >= 0 && px < canvas.width && py < canvas.height && canvas.getContext('2d')!.getImageData(px, py, 1, 1).data[3]! > 50) return u.unit.combatantId;
    }
  };
  const activeAction = frame?.actions.find(a => a.actorId === frame.actorId);
  return <div ref={host} className="combat-arena combat-sprite-arena" data-sample-fps={scene.sampleFps} data-ready={error ? 'error' : atlases ? 'true' : 'false'}>
    <div className="sprite-battle-stage" style={{width: scene.width, height: scene.height, transform: `translate(-50%,-50%) scale(${scale})`}}
      onPointerMove={e => setHovered(pick(e.clientX, e.clientY))} onPointerLeave={() => setHovered(undefined)} onClick={e => { const id = pick(e.clientX, e.clientY); if (id) onTarget(id); }}>
      <CombatGround scene={scene} ground={ground}/>
      {atlases && units.map(u => <div key={u.unit.combatantId} className="sprite-battle-unit" data-sprite-unit={u.unit.combatantId} data-pose={u.pose}
        data-targetable={selecting&&validTargetIds.includes(u.unit.combatantId)} data-target-dimmed={selecting&&!validTargetIds.includes(u.unit.combatantId)} data-hovered={hovered === u.unit.combatantId || highlightedId === u.unit.combatantId} data-side={u.unit.side} style={{left: u.position.x, top: u.position.y, zIndex: Math.round(u.moving ? 2000 : u.position.y), '--sprite-width': `${widths[u.skin]}px`} as CSSProperties}>
        <i className="sprite-contact-shadow"/>
        <div className="sprite-battle-figure"><SpriteSequence image={atlases[`${u.skin}/${u.clip.id}`]!} clip={u.clip} frame={u.poseIndex}/></div>
        {u.delta !== 0 && progress >= scene.impactProgress && <strong className={`sprite-damage ${u.delta > 0 ? 'healing' : ''}`}>{u.delta > 0 ? '+' : ''}{u.delta}</strong>}
      </div>)}
      {activeAction && <div className="sprite-action-name" key={`${frame!.actorId}:${frame!.before.combatants.map(u => u.ctb).join('-')}`}>{actionLabel(activeAction)}</div>}
    </div>
    {!atlases && !error && <div className="combat-loading" role="status">{loadingLabel}</div>}
    {error && <p className="combat-error" role="alert">{error}</p>}
  </div>;
}
