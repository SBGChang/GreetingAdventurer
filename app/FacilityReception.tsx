import {createContext,useContext,useState,useEffect,type ReactNode,type CSSProperties} from 'react';
import {createPortal} from 'react-dom';
import {receptionArt,receptionExpression,type ReceptionProfile,type ReceptionEvent} from './facility-presentation';
import {useDragScroll} from './useDragScroll';
import type {UiLocale} from './i18n';
import './reception.css';

type ReceptionContextValue={profile:ReceptionProfile|undefined;locale:UiLocale;event:ReceptionEvent;detail:string;inspect:(event:ReceptionEvent,detail?:string)=>void;categories:HTMLElement|null;confirmation:HTMLElement|null;setCategories:(node:HTMLElement|null)=>void;setConfirmation:(node:HTMLElement|null)=>void};
const ReceptionContext=createContext<ReceptionContextValue|undefined>(undefined);
export const useReception=()=>useContext(ReceptionContext);
export function ReceptionProvider({profile,locale,result,children}:{profile:ReceptionProfile|undefined;locale:UiLocale;result:{id:number;event:ReceptionEvent;detail:string}|undefined;children:ReactNode}){
 const [reaction,setReaction]=useState<{profileId:string|undefined;event:ReceptionEvent;detail:string}>({profileId:undefined,event:'welcome',detail:''}),[categories,setCategories]=useState<HTMLElement|null>(null),[confirmation,setConfirmation]=useState<HTMLElement|null>(null);
 useEffect(()=>{setReaction(current=>current.profileId===profile?.id?current:{profileId:profile?.id,event:'welcome',detail:''})},[profile?.id]);
 useEffect(()=>{if(result)setReaction({profileId:profile?.id,event:result.event,detail:result.detail})},[result?.id,result?.event,result?.detail]);
 const current=reaction.profileId===profile?.id?reaction:{event:'welcome' as const,detail:''};
 return <ReceptionContext.Provider value={{profile,locale,...current,inspect:(event,detail='')=>setReaction({profileId:profile?.id,event,detail}),categories,confirmation,setCategories,setConfirmation}}>{children}</ReceptionContext.Provider>;
}
export function ReceptionAside(){
 const ctx=useReception();if(!ctx?.profile)return null;
 const {profile,locale,event,detail}=ctx,expression=receptionExpression(event);
 const x=expression==='happy'||expression==='sad'?100:0,y=expression==='angry'||expression==='sad'?100:0;
 const frame='frame' in profile.theme?profile.theme.frame:undefined;
 return <>{frame&&<div className="reception-frame" aria-hidden="true" style={{borderImageSource:`url("${receptionArt(frame.image)}")`,borderImageSlice:`${frame.slicePercent}%`,borderImageWidth:`${frame.width}px`,borderWidth:frame.width,backgroundColor:frame.fill}}/>}<aside className="facility-reception" aria-label={profile.host.name[locale]} data-expression={expression}>
  <div className="reception-portrait" role="img" aria-label={`${profile.host.name[locale]} · ${expression}`} style={{backgroundImage:`url("${receptionArt(profile.host.portrait)}")`,backgroundPosition:`${x}% ${y}%`}}><strong>{profile.host.name[locale]}</strong></div>
  <ReceptionDialogue profile={profile} locale={locale} event={event} detail={detail}/>
  <div className="reception-options" ref={ctx.setCategories}/>
  <div className="reception-confirmation" ref={ctx.setConfirmation}/>
 </aside></>;
}
function ReceptionDialogue({profile,locale,event,detail}:{profile:ReceptionProfile;locale:UiLocale;event:ReceptionEvent;detail:string}){
 const drag=useDragScroll(`${profile.id}:${locale}:${event}:${detail}`),art=profile.theme.dialogue;
 const style={'--dialogue-art':`url("${receptionArt(art.image)}")`,'--dialogue-fill':art.fill,'--dialogue-ink':art.ink,'--dialogue-edge':art.edge,'--dialogue-slice':`${art.slicePercent}%`} as CSSProperties;
 return <section className="reception-dialogue" style={style} aria-live="polite"><div {...drag} className="reception-dialogue-body" tabIndex={0} role="region" aria-label={profile.host.name[locale]}><p>{profile.dialogue[receptionExpression(event)][locale]}</p>{detail&&<small>{detail}</small>}</div></section>;
}
export function ReceptionActions({children}:{children:ReactNode}){const ctx=useReception();return ctx?.profile&&ctx.confirmation?createPortal(children,ctx.confirmation):<>{children}</>}
export function ReceptionOptions({children}:{children:ReactNode}){const ctx=useReception();return ctx?.profile&&ctx.categories?createPortal(children,ctx.categories):<>{children}</>}
export function receptionStyle(profile:ReceptionProfile):CSSProperties{
 const [x,y,width,height]=profile.theme.rect;
 if(x===undefined||y===undefined||!width||!height)throw new Error('Invalid facility art rectangle: '+profile.id);
 const [dx,dy,dw,dh]=profile.theme.detail.rect;
 if(dx===undefined||dy===undefined||!dw||!dh)throw new Error('Invalid facility detail art rectangle: '+profile.id);
 return {'--reception-detail-inset':profile.theme.detail.inset.map(n=>`${n}%`).join(' '),'--reception-detail':`url("${receptionArt(profile.theme.detail.atlas)}")`,'--reception-detail-size':`${100/dw}% ${100/dh}%`,'--reception-detail-position':`${dx/(1-dw)*100}% ${dy/(1-dh)*100}%`,'--reception-panel':`url("${receptionArt(profile.theme.atlas)}")`,'--reception-size-x':`${100/width}%`,'--reception-size-y':`${100/height}%`,'--reception-panel-x':`${x/(1-width)*100}%`,'--reception-panel-y':`${y/(1-height)*100}%`,'--reception-return':`url("${receptionArt('return-icons.png')}")`,'--reception-return-x':`${profile.theme.returnCell%2*100}%`,'--reception-return-y':`${Math.floor(profile.theme.returnCell/2)*100}%`,'--reception-ink':profile.theme.light?'#413320':'#fff0d1','--reception-shadow':profile.theme.light?'0 1px 2px #fff9':'0 1px 3px #000'} as CSSProperties;
}
