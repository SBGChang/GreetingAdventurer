import {useEffect,useRef,useState,useMemo} from 'react';
import {CombatSpriteArena} from './CombatSpriteArena';
import {resolveSpriteBattle} from './combat-sprite-catalog';
import type {AppearanceSelections} from './combat-appearances';
import {CombatArena} from './CombatArena';
import {CombatCommandMenu} from './CombatCommandMenu';
import {CombatHud} from './CombatHud';
import type {CombatView,CombatFrame,CombatMenuAction} from './engine/game-facade';
import type {LocalizedTextRef} from '../src/contracts/core';
import {t,type UiLocale} from './i18n';
import presentation from './assets/combat/presentation.json';
import hudLayout from './assets/combat/hud/layout.json';
import {hasCtbCountdown,ctbPlaybackView} from './combat-ctb-playback';
import {resolveCombatGround,type CombatEnvironment} from './combat-ground';

export type CombatChoice={kind:'skill';skillId:string;weaponSetId:string;targetId:string}|{kind:'rest'};
export type CombatResponse={accepted:true;frames:readonly CombatFrame[];complete:()=>void}|{accepted:false;code:string};
export function CombatScreen({environment,combat,locale,text,act,appearanceSelections}:{environment:CombatEnvironment;combat:CombatView;locale:UiLocale;text:(ref:LocalizedTextRef)=>string;act:(choice:CombatChoice,receive:(result:CombatResponse)=>void)=>void;appearanceSelections?:AppearanceSelections}){
 const ground=useMemo(()=>resolveCombatGround(environment),[environment.kind,environment.id]);
 const [groundReady,setGroundReady]=useState(false),[groundError,setGroundError]=useState<string>();
 useEffect(()=>{let disposed=false;setGroundReady(false);setGroundError(undefined);const image=new Image();image.onload=()=>{if(!disposed)setGroundReady(true)};image.onerror=()=>{if(!disposed)setGroundError(`無法載入戰場地塊：${ground.id}`)};image.src=ground.image;return()=>{disposed=true}},[ground]);
 const sprite=useMemo(()=>resolveSpriteBattle(combat,appearanceSelections),[combat,appearanceSelections]);
 const Arena=sprite?CombatSpriteArena:CombatArena;
 const durationMs=sprite?.scene.turnDurationMs??presentation.turnDurationMs;
 const impactProgress=sprite?.scene.impactProgress??.42;
 const sampleFps=sprite?.scene.sampleFps??60;
 const className=sprite?'sprite-combat':'';
 const [ready,setReady]=useState(false),[hudReady,setHudReady]=useState(false),[highlightedId,setHighlightedId]=useState<string>();
 const [picked,setPicked]=useState<CombatMenuAction>(),[error,setError]=useState<string>(),[playback,setPlayback]=useState<{frames:readonly CombatFrame[];complete:()=>void}>();
 const [commandsOpen,setCommandsOpen]=useState(true);
 const [index,setIndex]=useState(0),[elapsed,setElapsed]=useState(0),lock=useRef(false);
 const frame=playback?.frames[index],finished=!!playback&&index>=playback.frames.length;
 const progress=Math.min(1,elapsed/durationMs);
 const countdownMs=frame&&hasCtbCountdown(frame)?hudLayout.countdownMs:0;
 const counting=!!frame&&countdownMs>0&&elapsed>=durationMs;
 const countdownProgress=countdownMs>0?Math.max(0,Math.min(1,(elapsed-durationMs)/countdownMs)):progress===1?1:0;
 const shown=frame?(progress<impactProgress?frame.before:frame.after):playback?.frames.at(-1)?.after??combat;
 const hudView=frame&&progress>=impactProgress?ctbPlaybackView(frame,countdownProgress):shown;
 const resolved=finished&&shown.state==='resolved',won=resolved&&shown.combatants.filter(u=>u.side==='enemy').every(u=>u.state==='dead');
 const label=(u:CombatView['combatants'][number])=>u.nameRef?text(u.nameRef):t(locale,'ui.combat.member',{n:shown.combatants.filter(c=>c.side==='player').indexOf(u)+1});
 const canCommand=ready&&hudReady&&groundReady&&!playback&&combat.combatants.some(u=>u.isCurrentActor&&u.side==='player'&&u.state!=='dead');
 const closeCommands=()=>{setCommandsOpen(false);setPicked(undefined);setError(undefined);};
 useEffect(()=>{
  if(!commandsOpen)return;
  const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();if(picked)setPicked(undefined);else closeCommands();}};
  window.addEventListener('keydown',escape,true);return()=>window.removeEventListener('keydown',escape,true);
 },[commandsOpen,picked]);
 useEffect(()=>{
  if(!playback||finished)return;
  let id=0,lastSample=-1;const start=performance.now(),total=durationMs+countdownMs,duration=window.matchMedia('(prefers-reduced-motion: reduce)').matches?50:total;
  const tick=(now:number)=>{const p=Math.max(0,Math.min(1,(now-start)/duration));const sample=Math.floor(Math.max(0,now-start)*sampleFps/1000);if(sample!==lastSample||p===1){setElapsed(p*total);lastSample=sample;}if(p<1)id=requestAnimationFrame(tick);else{setElapsed(0);setIndex(i=>i+1);}};id=requestAnimationFrame(tick);return()=>cancelAnimationFrame(id);
 },[playback,index,finished,durationMs,countdownMs,sampleFps]);
 useEffect(()=>{if(finished&&!resolved){playback!.complete();setPlayback(undefined);setCommandsOpen(true);lock.current=false;}},[finished,resolved,playback]);
 const submit=(choice:CombatChoice)=>{
  if(lock.current||!ready||!hudReady||!groundReady)return;lock.current=true;setError(undefined);
  act(choice,result=>{if(!result.accepted){setError(result.code);lock.current=false;return;}setCommandsOpen(false);setPicked(undefined);setIndex(0);setElapsed(0);setPlayback({frames:result.frames,complete:result.complete});});
 };
 return <section className={`combat-screen ${className}`} data-presentation={sprite?'sprite':'model'} data-encounter-id={combat.encounterId} data-ground-ready={groundReady} data-ground-id={ground.id} data-playing={!!playback&&!finished} data-ctb-counting={counting} data-ctb-phase={counting?'countdown':frame&&progress>=impactProgress?'recovery':'idle'}>
  <div className="combat-frost" aria-hidden="true"/>
  {!groundReady&&<div className="combat-loading" role="status">{groundError??t(locale,'ui.combat.loading')}</div>}
  <Arena ground={ground} highlightedId={highlightedId} spritePresentation={sprite} view={hudView} frame={counting?undefined:frame} progress={progress} selecting={!!picked&&!playback} validTargetIds={picked?.validTargetIds??[]} label={label} actionLabel={action=>action.nameRef?text(action.nameRef):action.skillId??t(locale,'ui.combat.rest')} onReady={setReady} loadingLabel={t(locale,'ui.combat.loading')} onTarget={targetId=>{if(picked?.validTargetIds.includes(targetId))submit({kind:'skill',skillId:picked.skillId,weaponSetId:picked.weaponSetId,targetId});}}/>
  <CombatHud view={hudView} sprite={sprite} locale={locale} label={label} selecting={!!picked&&!playback} validTargetIds={picked?.validTargetIds??[]} onTarget={targetId=>{if(picked?.validTargetIds.includes(targetId))submit({kind:'skill',skillId:picked.skillId,weaponSetId:picked.weaponSetId,targetId});}} onHover={setHighlightedId} onReady={setHudReady} canCommand={canCommand} commandsOpen={commandsOpen} onCommand={()=>{setCommandsOpen(open=>!open);setError(undefined);}}
   />
  {commandsOpen&&canCommand&&!picked&&<CombatCommandMenu combat={combat} locale={locale} text={text} onSkill={setPicked} onRest={()=>submit({kind:'rest'})} onClose={closeCommands} error={error}/>}
  {picked&&canCommand&&<div className="combat-target-prompt"><span>{t(locale,'ui.combat.pickTarget')}</span><button onClick={()=>{setPicked(undefined);setError(undefined);}}>{t(locale,'ui.combat.cancelTarget')}</button>{error&&<p role="alert">{error}</p>}</div>}
  {resolved&&<div className="combat-result" role="status"><h2>{t(locale,won?'ui.combat.victoryTitle':'ui.combat.defeat')}</h2><p>{t(locale,'ui.combat.resultSaved')}</p><button onClick={()=>{playback!.complete();setPlayback(undefined);lock.current=false;}}>{t(locale,'ui.combat.continue')}</button></div>}
 </section>;
}
