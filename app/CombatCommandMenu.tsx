import {useEffect,useRef,useState,type CSSProperties} from 'react';
import type {CombatView,CombatMenuAction} from './engine/game-facade';
import type {LocalizedTextRef} from '../src/contracts/core';
import {UiArt} from './UiArt';
import {t,type UiLocale} from './i18n';
import medallion from './assets/combat/commands/weapon-medallion.png';
import skillFrame from './assets/combat/commands/skill-frame.png';
import utility from './assets/combat/commands/utility-icons.png';
import './combat-commands.css';

/** Three equipped sets and their real slots; this menu never equips or resolves a skill. */
export function CombatCommandMenu({combat,locale,text,onSkill,onRest,onClose,error}:{combat:CombatView;locale:UiLocale;text:(ref:LocalizedTextRef)=>string;onSkill:(skill:CombatMenuAction)=>void;onRest:()=>void;onClose:()=>void;error:string|undefined}){
 const host=useRef<HTMLDivElement>(null),[scale,setScale]=useState(1),[ready,setReady]=useState(false),[failure,setFailure]=useState(''),[guardsOnly,setGuardsOnly]=useState(false);
 useEffect(()=>{const e=host.current!;const resize=()=>setScale(Math.min(e.clientWidth/1600,e.clientHeight/900));const observer=new ResizeObserver(resize);observer.observe(e);resize();return()=>observer.disconnect()},[]);
 useEffect(()=>{let disposed=false;Promise.all([medallion,skillFrame,utility].map(src=>new Promise<void>((resolve,reject)=>{const image=new Image();image.onload=()=>resolve();image.onerror=()=>reject(new Error('Command artwork unavailable'));image.src=src;}))).then(()=>{if(!disposed)setReady(true)}).catch(e=>{if(!disposed)setFailure(String(e))});return()=>{disposed=true}},[]);
 useEffect(()=>{if(ready)(host.current?.querySelector<HTMLButtonElement>('[data-skill-id]:enabled')??host.current?.querySelector<HTMLButtonElement>('button:enabled'))?.focus()},[ready]);
 const guards=combat.actions.filter(a=>a.actionKind==='guard'&&a.available);
 const unavailable=(action:CombatMenuAction)=>action.unavailableReason==='resources'?t(locale,'ui.combat.resourceUnavailable'):action.unavailableReason==='weapon'?t(locale,'ui.combat.weaponUnavailable'):t(locale,'ui.combat.targetUnavailable');
 return <div className="combat-command-overlay" ref={host} role="dialog" aria-modal="true" aria-label={t(locale,'ui.combat.commands')} data-command-ready={ready} onKeyDown={event=>{
  if(event.key!=='Tab')return;
  const buttons=[...host.current!.querySelectorAll<HTMLButtonElement>('button:enabled')];const first=buttons[0],last=buttons.at(-1);
  if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
 }}>
  <div className="combat-command-stage" style={{transform:`translate(-50%,-50%) scale(${scale})`,'--weapon-medallion':`url("${medallion}")`,'--skill-frame':`url("${skillFrame}")`,'--utility-icons':`url("${utility}")`} as CSSProperties}>
   <button className="combat-command-close" onClick={onClose} aria-label={t(locale,'ui.combat.closeCommands')}>×</button>
   <div className="combat-weapon-rows">
    {combat.weaponSets.map(set=><section className="combat-weapon-row" key={set.weaponSetId} data-weapon-set={set.weaponSetId} data-active-set={set.isActive}>
     <div className="combat-weapon-medallion" title={[set.mainHand&&text(set.mainHand),set.offHand&&text(set.offHand)].filter(Boolean).join(' / ')}>
      {set.mainHand&&<UiArt kind="weapon"/>}<span className="combat-weapon-number">{set.index+1}</span>
      {set.isActive&&<b className="combat-equipped-label">{t(locale,'ui.combat.activeSet')}</b>}
      <strong>{set.mainHand?text(set.mainHand):t(locale,'ui.combat.emptyWeapon')}{set.offHand&&<small>＋{text(set.offHand)}</small>}</strong>
     </div>
     <div className="combat-skill-slots">{set.skills.map((action,index)=><button key={index} className="combat-skill-tile" data-skill-slot={index} data-skill-id={action?.skillId} data-weapon-set-id={set.weaponSetId} disabled={!ready||!action?.available||guardsOnly&&action.actionKind!=='guard'} onClick={()=>action&&onSkill(action)} title={action?`${action.nameRef?text(action.nameRef):action.skillId}${!action.available?' · '+unavailable(action):''}`:t(locale,'ui.combat.emptySkill')}>
      {action?<><UiArt kind={action.actionKind==='guard'?'armor':action.actionKind==='cast'?'books':action.actionKind==='support'?'training':'weapon'}/><strong>{action.nameRef?text(action.nameRef):action.skillId}</strong><small>{action.costs?.map(c=>`${c.resource==='health'?'HP':'MP'} ${c.amount}`).join(' · ')||t(locale,'ui.combat.noCost')}</small>{!set.isActive&&<em>{t(locale,'ui.combat.switchOnUse')}</em>}</>:<span className="combat-empty-skill">{t(locale,'ui.combat.emptySkill')}</span>}
     </button>)}</div>
    </section>)}
   </div>
   <aside className="combat-command-utilities">
    <button className="combat-utility" data-utility="guard" disabled={!ready||guards.length===0} aria-pressed={guardsOnly} onClick={()=>setGuardsOnly(v=>!v)}><i style={{backgroundPosition:'0% 50%'}}/><strong>{t(locale,'ui.combat.defend')}</strong><small>{guards.length?t(locale,guardsOnly?'ui.combat.showAllSkills':'ui.combat.showGuardSkills'):t(locale,'ui.combat.noGuardSkill')}</small></button>
    <button className="combat-utility" data-combat-rest disabled={!ready} onClick={onRest}><i style={{backgroundPosition:'50% 50%'}}/><strong>{t(locale,'ui.combat.restShort')}</strong></button>
    <div className="combat-utility combat-utility-unavailable" aria-disabled="true" title={t(locale,'ui.combat.itemsUnavailable')}><i style={{backgroundPosition:'100% 50%'}}/><strong>{t(locale,'ui.combat.useItems')}</strong><small>{t(locale,'ui.combat.itemsUnavailable')}</small></div>
   </aside>
   {(failure||error)&&<p className="combat-command-feedback" role="alert">{failure||error}</p>}
   {!ready&&!failure&&<p className="combat-command-feedback" role="status">{t(locale,'ui.combat.loading')}</p>}
  </div>
 </div>;
}
