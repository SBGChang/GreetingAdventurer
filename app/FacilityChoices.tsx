import {Children,isValidElement,useState,useEffect,type ReactNode,type ButtonHTMLAttributes,type ReactElement} from 'react';
import {useDragScroll} from './useDragScroll';
import {createPortal} from 'react-dom';
import {t,type UiLocale} from './i18n';
import {UiArt,type ArtKind} from './UiArt';
import {useReception,ReceptionActions} from './FacilityReception';

type ChoiceButton=ReactElement<ButtonHTMLAttributes<HTMLButtonElement>&{'data-action-label'?:string}>;
type Group={id:string;label:string;items:ReactNode};
const guildCategoryArt:Record<string,ArtKind>={accepted:'guild',delivery:'supplies',purchase:'gold',rescue:'quest',hunt:'weapon',suppression:'armor'};
function guildCategoryIcon(id:string){const art=guildCategoryArt[id];return art===undefined?null:<UiArt kind={art}/>}
const textOf=(node:ReactNode):string=>Children.toArray(node).map(n=>typeof n==='string'||typeof n==='number'?String(n):isValidElement<{children?:ReactNode}>(n)?textOf(n.props.children):'').join(' ');

/** Inspects the existing formal command. Only the dialogue confirmation submits it. */
export function FacilityChoices({groups,action,locale,theme}:{groups:Group[];action:string;locale:UiLocale;theme?:'guild'}){
 const reception=useReception();
 const [groupId,setGroup]=useState(groups.find(g=>Children.count(g.items)>0)?.id??groups[0]?.id),[selected,setSelected]=useState<string>();
 const group=groups.find(g=>g.id===groupId)??groups[0];
 const entries=Children.toArray(group?.items).filter((n):n is ChoiceButton=>isValidElement(n)&&n.type==='button').map(button=>{const parts=Children.toArray(button.props.children);return {id:String(button.key),button,icon:parts[0],name:textOf(parts[1])}});
 const picked=entries.find(e=>e.id===selected);
 const dragScroll=useDragScroll(group?.id);
 useEffect(()=>{if(!entries.length)reception?.inspect('empty')},[entries.length,group?.id]);
 const categories=<nav className="facility-categories" aria-label={t(locale,'ui.facility.categories')}>{groups.map(g=><button key={g.id} aria-pressed={g.id===group?.id} onClick={()=>{setGroup(g.id);setSelected(undefined);reception?.inspect('welcome')}}>{theme==='guild'&&guildCategoryIcon(g.id)}<span>{g.label}</span><small>{Children.toArray(g.items).length}</small></button>)}</nav>;
 return <section className="facility-browser" data-art-theme={theme} aria-label={t(locale,'ui.facility.choices')}>
  {reception?.profile&&reception.categories?createPortal(categories,reception.categories):categories}
  <div className="facility-columns">
   <div className="facility-list-pane"><div {...dragScroll} className="facility-choices" role="group" tabIndex={0} aria-label={group?.label}>
    {entries.map(e=><button key={e.id} className="facility-choice" data-facility-choice aria-pressed={e.id===picked?.id} onClick={()=>{setSelected(e.id);reception?.inspect(e.button.props.disabled?'unavailable':'selected',e.name)}}>{e.icon}<strong>{e.name}</strong><span aria-hidden>›</span></button>)}
    {!entries.length&&<p className="facility-empty">{t(locale,'ui.facility.empty')}</p>}
   </div></div>
   <article className="facility-detail" aria-label={t(locale,'ui.facility.details')}>
    {picked?<><div className="facility-detail-body" tabIndex={0}>{picked.button.props.children}</div><ReceptionActions><footer className="facility-action-footer"><button data-facility-confirm disabled={picked.button.props.disabled} onClick={picked.button.props.onClick}>{picked.button.props['data-action-label']??action}</button></footer></ReceptionActions></>:<div className="facility-empty-detail"><UiArt kind={theme==='guild'?'guild':'quest'}/><p>{t(locale,'ui.facility.select')}</p></div>}
   </article>
  </div>
 </section>;
}
