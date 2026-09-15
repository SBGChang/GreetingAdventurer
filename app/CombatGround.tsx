import {useId,type CSSProperties} from 'react';
import type {SpriteBattlePresentation} from './combat-sprite-catalog';
import type {CombatGround as GroundArt} from './combat-ground';

/** One continuous textured surface shared by both formations. */
export function CombatGround({scene,ground}:{scene:SpriteBattlePresentation['scene'];ground:GroundArt}){
 const id=useId(),p=scene.platform;
 return <svg className="combat-platforms" viewBox={`0 0 ${scene.width} ${scene.height}`} aria-hidden="true">
  <defs><linearGradient id={`${id}-edge`} x2="0" y2="1"><stop stopColor={ground.edge}/><stop offset="1" stopColor="#141c19"/></linearGradient></defs>
  <g data-battle-platform="shared" data-ground-id={ground.id} className="combat-platform" style={{'--ground-glow':ground.glow} as CSSProperties}>
   <path d={`M${p.x+p.skew},${p.y+p.depth}h${p.width}v${p.thickness}h-${p.width}Z`} fill={`url(#${id}-edge)`}/>
   <path d={`M${p.x+p.width},${p.y}l${p.skew},${p.depth}v${p.thickness}l${-p.skew},${-p.depth}Z`} fill={ground.edge}/>
   <g transform={`matrix(1 0 ${p.skew/p.width} ${p.depth/p.width} ${p.x} ${p.y})`}>
    <image href={ground.image} width={p.width} height={p.width} preserveAspectRatio="none"/>
    <rect width={p.width} height={p.width} fill={ground.tint} style={{mixBlendMode:'multiply'}}/>
    <rect x="1" y="1" width={p.width-2} height={p.width-2} fill="none" stroke={ground.glow} strokeOpacity=".5" strokeWidth="2"/>
   </g>
  </g>
 </svg>;
}
