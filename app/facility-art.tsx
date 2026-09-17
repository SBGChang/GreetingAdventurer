import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {GameViewport} from './PlayerShell';
import {ReceptionProvider,ReceptionAside,receptionStyle} from './FacilityReception';
import {FacilityChoices} from './FacilityChoices';
import {receptionProfiles,type ReceptionEvent} from './facility-presentation';
import {UiArt} from './UiArt';
import './facilities.css';
import './reception.css';

/** Isolated presentation fixture. Never creates an engine or accesses a player save. */
function FacilityArtPreview(){
 const query=new URLSearchParams(location.search),[id,setId]=useState(query.get('facility')??'yunhua-adventurerGuild'),[event,setEvent]=useState<ReceptionEvent>('welcome'),[revision,setRevision]=useState(0);
 const profile=receptionProfiles.find(p=>p.id===id);if(!profile)throw new Error('Unknown reception preview: '+id);
 const select=(value:string)=>{setId(value);setEvent('welcome');setRevision(n=>n+1)};
 const signal=(value:ReceptionEvent)=>{setEvent(value);setRevision(n=>n+1)};
 return <ReceptionProvider profile={profile} locale="zh-Hant" result={{id:revision,event,detail:''}}><GameViewport><div className="game-shell scene-town">
  <div style={{position:'absolute',bottom:22,left:70,right:70,display:'flex',gap:12,alignItems:'center',color:'#f6e7c7',zIndex:50}}><strong>設施美術檢視 · 假資料入口</strong><select aria-label="文化與設施" value={id} onChange={e=>select(e.target.value)}>{receptionProfiles.map(p=><option key={p.id} value={p.id}>{p.cultureId.replace('culture.','')} · {p.name['zh-Hant']}</option>)}</select>{(['welcome','accepted','rejected','failed'] as const).map((e,i)=><button data-preview-expression={e} key={e} onClick={()=>signal(e)}>{['一般','開心','生氣','沮喪'][i]}</button>)}</div>
  <main className="game-main" data-screen="preview"><div className="play-surface window-surface reception-window" data-reception={profile.id} data-reception-culture={profile.cultureId} style={receptionStyle(profile)}>
   <ReceptionAside/><h2 className="reception-title">{profile.name['zh-Hant']}</h2><div className="window-back"><button className="reception-return" aria-label="返回檢視初始狀態" onClick={()=>signal('welcome')}/></div>
   <section className="surface-content"><FacilityChoices key={id} locale="zh-Hant" action="測試確認" groups={[{id:'main',label:'服務示例',items:Array.from({length:12},(_,index)=>index+1).map(i=><button key={i} disabled={i===4} onClick={()=>signal('accepted')}><UiArt kind="quest"/><span>美術檢視項目 {i}</span><span>此頁僅檢查排版與表情，不執行遊戲交易。</span></button>)}]}/></section>
  </div></main>
 </div></GameViewport></ReceptionProvider>
}
createRoot(document.getElementById('root')!).render(<FacilityArtPreview/>);
