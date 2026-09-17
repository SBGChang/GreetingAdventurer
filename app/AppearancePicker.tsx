import {useEffect,useState} from 'react';
import {appearances} from './combat-appearances';
import {profiles,loadSpriteArt} from './combat-sprite-art';
import {SpriteSequence} from './SpriteSequence';
import type {UiLocale} from './i18n';
import './appearances.css';
export function AppearancePicker({sex,selected,choose,locale}:{sex:string;selected:string|undefined;choose:(id:string)=>void;locale:UiLocale}){
 const [open,setOpen]=useState(false),[art,setArt]=useState<Awaited<ReturnType<typeof loadSpriteArt>>>(),[error,setError]=useState('');
 const options=appearances.filter(a=>a.sex===sex);
 const skins=options.map(a=>a.skins.blade).filter((s):s is string=>s!==undefined);
 const key=JSON.stringify(skins);
 useEffect(()=>{if(!open)return;let cancelled=false;setError('');loadSpriteArt(JSON.parse(key) as string[]).then(a=>{if(!cancelled)setArt(a)}).catch(e=>{if(!cancelled)setError(String(e))});return()=>{cancelled=true;setArt(undefined)}},[open,key]);
 return <section className="appearance-picker">
  <button className="appearance-toggle" onClick={()=>setOpen(v=>!v)} aria-expanded={open}>{locale==='zh-Hant'?'角色造型':'Appearance'} · {appearances.find(a=>a.id===selected)?.label??(locale==='zh-Hant'?'預設造型':'Default')}</button>
  {open&&<><p>{locale==='zh-Hant'?'選擇衣著與氣質，能力和性別保持不變。':'Choose an outfit and style. Attributes and sex stay the same.'}</p>{error&&<p role="alert">{error}</p>}<div className="appearance-options">{options.map(a=>{
   const skin=a.skins.blade,profile=skin===undefined?undefined:profiles[skin],clip=profile?.clips.find(c=>c.id==='idle');
   return <button key={a.id} disabled={!skin||!art?.[`${skin}/idle`]} aria-pressed={selected===a.id} onClick={()=>choose(a.id)}>{skin&&clip&&art?.[`${skin}/idle`]&&<SpriteSequence image={art[`${skin}/idle`]!} clip={clip} frame={0} thumbnail/>}<span>{a.label}</span></button>;
  })}</div></>}
 </section>;
}
