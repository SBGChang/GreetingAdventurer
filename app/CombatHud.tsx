import {useEffect,useRef,useState,type CSSProperties} from 'react';
import type {CombatView} from './engine/game-facade';
import type {SpriteBattlePresentation} from './combat-sprite-catalog';
import {loadSpriteArt, profiles} from './combat-sprite-art';
import {composeSpriteAtlas} from './sprite-compositor';
import frameUrl from './assets/combat/hud/portrait-frame.png';
import gaugeUrl from './assets/combat/hud/gauges.png';
import layout from './assets/combat/hud/layout.json';
import {t,type UiLocale} from './i18n';
import './combat-hud.css';

type Art={gauge:string;portraits:Record<string,string>};
let cached:Promise<string>|undefined;
async function loadHud(skins:readonly string[]){
 const load=(src:string)=>new Promise<HTMLImageElement>((resolve,reject)=>{const im=new Image();im.onload=()=>resolve(im);im.onerror=()=>reject(new Error('無法載入戰鬥介面美術'));im.src=src});
 cached??=Promise.all([load(gaugeUrl),load(frameUrl)]).then(([gauge])=>composeSpriteAtlas(gauge).toDataURL()).catch(e=>{cached=undefined;throw e});
 const [gauge,atlases]=await Promise.all([cached,loadSpriteArt(skins)]);
 return {gauge,portraits:Object.fromEntries(Object.entries(atlases).filter(([key])=>key.endsWith('/idle')).map(([key,canvas])=>[key.split('/')[0]!,canvas.toDataURL()]))};
}
function Slice({src,rect}:{src:string;rect:readonly number[]}){return <svg viewBox={rect.join(' ')} preserveAspectRatio="none" aria-hidden="true"><image href={src} width={layout.atlasWidth} height={layout.atlasHeight}/></svg>}
function Portrait({skin,art,name}:{skin:string|undefined;art:Art|undefined;name:string}){
 const profile=skin?profiles[skin]:undefined;
 const rect=skin?((layout.portraits as Record<string,number[]>)[skin]??profile?.portrait):undefined;
 const idle=profile?.clips.find(c=>c.id==='idle');
 return <span className="hud-portrait">{skin&&rect&&art?.portraits[skin]&&idle?<span className="hud-face"><svg viewBox={rect.join(' ')} preserveAspectRatio="xMidYMid slice" aria-hidden="true"><image href={art.portraits[skin]} width={idle.width} height={idle.height}/></svg></span>:<span className="hud-monogram">{name.slice(0,1)}</span>}<img src={frameUrl} alt=""/></span>;
}
function Gauge({kind,value,max,art}:{kind:'health'|'mana'|'ctb';value:number;max:number;art:Art|undefined}){
 const fraction=max>0?Math.min(1,Math.max(0,value/max)):0;
 return <span className={`hud-gauge hud-gauge-${kind}`} data-resource={kind} data-value={value} data-max={max} role="meter" aria-label={kind==='health'?'HP':kind==='mana'?'MP':'CTB'} aria-valuemin={0} aria-valuemax={max>0?max:1} aria-valuenow={max>0?Math.min(max,Math.max(0,value)):0} aria-valuetext={kind==='ctb'?`CTB ${value}`:`${value} / ${max}`}>
  {art&&<><Slice src={art.gauge} rect={layout.gauge.frame}/><span className="hud-gauge-well"><span className="hud-gauge-liquid" style={{clipPath:`inset(0 ${(1-fraction)*100}% 0 0)`}}><Slice src={art.gauge} rect={layout.gauge[kind]}/></span></span></>}
 </span>;
}

export function CombatHud({view,sprite,locale,label,selecting,onTarget,onHover,onReady,canCommand,commandsOpen,onCommand,validTargetIds}:{view:CombatView;sprite:SpriteBattlePresentation|undefined;locale:UiLocale;label:(u:CombatView['combatants'][number])=>string;selecting:boolean;onTarget:(id:string)=>void;onHover:(id:string|undefined)=>void;onReady:(ready:boolean)=>void;canCommand:boolean;commandsOpen:boolean;onCommand:()=>void;validTargetIds:readonly string[]}){
 const host=useRef<HTMLDivElement>(null),[scale,setScale]=useState(1),[art,setArt]=useState<Art>(),[error,setError]=useState('');
 const skinKey=JSON.stringify([...new Set([...Object.values(sprite?.skins??{}),...Object.values(sprite?.weaponSetSkins??{}).flatMap(sets=>Object.values(sets))])].sort());
 useEffect(()=>{let disposed=false;onReady(false);setError('');loadHud(JSON.parse(skinKey) as string[]).then(a=>{if(!disposed){setArt(a);onReady(true)}}).catch(e=>{if(!disposed)setError(String(e))});return()=>{disposed=true}},[onReady,skinKey]);
 useEffect(()=>{const e=host.current!;const resize=()=>setScale(Math.min(e.clientWidth/layout.width,e.clientHeight/layout.height));const observer=new ResizeObserver(resize);observer.observe(e);resize();return()=>observer.disconnect()},[]);
 const ordered=view.order.map(id=>view.combatants.find(u=>u.combatantId===id)!).filter(u=>u.state!=='dead');
 const details=(u:CombatView['combatants'][number])=>`${label(u)} · HP ${u.health}/${u.maxHealth} · MP ${u.mana}/${u.maxMana} · CTB ${Number(u.ctb.toFixed(2))}`;
 return <div ref={host} className="combat-hud" data-hud-ready={!!art}>
 <div className="combat-hud-stage" style={{transform:`translate(-50%,-50%) scale(${scale})`,'--hud-transition':`${layout.transitionMs}ms`,'--ctb-recovery':`${layout.recoveryMs}ms`,'--squad-width':`${layout.squads.width}px`,'--squad-height':`${layout.squads.height}px`,'--squad-top':`${layout.squads.y}px`,'--player-left':`${layout.squads.playerX}px`,'--enemy-left':`${layout.squads.enemyX}px`,'--squad-portrait':`${layout.squads.portrait}px`,'--squad-gauge':`${layout.squads.gaugeHeight}px`} as CSSProperties}>
 {view.state!=='resolved'&&<aside className="hud-delay" aria-label={t(locale,'ui.combat.delayTitle')} data-combat-delay style={{left:layout.delay.x,top:layout.delay.y,width:layout.delay.width,height:layout.delay.height,'--delay-step':`${Math.min(layout.delay.maxStep,layout.delay.height/Math.max(1,ordered.length))}px`} as CSSProperties}>
  {ordered.map((u,index)=><div key={u.combatantId} className="hud-delay-unit" data-delay-id={u.combatantId} data-ctb={u.ctb} data-current={u.isCurrentActor} data-side={u.side} data-incapacitated={u.state==='incapacitated'} style={{transform:`translateY(calc(var(--delay-step) * ${index}))`}} title={details(u)} onPointerEnter={()=>onHover(u.combatantId)} onPointerLeave={()=>onHover(undefined)}>
   <Portrait skin={sprite?.skins[u.combatantId]} art={art} name={label(u)}/><Gauge kind="ctb" value={u.ctb} max={100} art={art}/>
  </div>)}
 </aside>}
 {(['player','enemy'] as const).map(side=><section key={side} className={`hud-squad hud-squad-${side}`} data-squad={side} aria-label={side==='player'?'我方隊形':'敵方隊形'}>
  {Array.from({length:9},(_,index)=>{const col=Math.floor(index/3)+1,row=side==='player'?3-index%3:index%3+1;const occupants=view.combatants.filter(u=>u.side===side&&u.row===row&&u.col===col);const u=occupants.find(u=>u.state!=='dead')??occupants[0];return <div className="hud-squad-cell" key={`${row}:${col}`} data-cell-row={row} data-cell-col={col}>
   {u&&<button className="hud-squad-unit" data-combatant-id={u.combatantId} data-combat-side={side} data-alive={u.state!=='dead'} data-current-actor={u.isCurrentActor} data-target-ready={selecting&&validTargetIds.includes(u.combatantId)} data-command-trigger={canCommand&&u.isCurrentActor&&side==='player'} aria-expanded={canCommand&&u.isCurrentActor&&side==='player'?commandsOpen:undefined} disabled={(selecting&&!validTargetIds.includes(u.combatantId))||(!selecting&&!(canCommand&&u.isCurrentActor&&side==='player'))||u.state==='dead'||!art} aria-label={details(u)} title={canCommand&&u.isCurrentActor?`${details(u)} · ${t(locale,'ui.combat.commands')}`:details(u)} onClick={()=>{if(selecting)onTarget(u.combatantId);else if(canCommand&&u.isCurrentActor&&side==='player')onCommand();}} onPointerEnter={()=>onHover(u.combatantId)} onPointerLeave={()=>onHover(undefined)} onFocus={()=>onHover(u.combatantId)} onBlur={()=>onHover(undefined)}>
    <Portrait skin={sprite?.skins[u.combatantId]} art={art} name={label(u)}/><span className="hud-vitals"><Gauge kind="health" value={u.health} max={u.maxHealth} art={art}/><Gauge kind="mana" value={u.mana} max={u.maxMana} art={art}/></span>
   {canCommand&&u.isCurrentActor&&!selecting&&<span className="hud-command-mark" aria-hidden="true">⋯</span>}
   </button>}
  </div>})}
 </section>)}
 </div>{error&&<p className="combat-error" role="alert">{error}</p>}
 </div>;
}
