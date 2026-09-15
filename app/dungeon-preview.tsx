import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { DungeonModel, dungeonArt } from './DungeonModel';
import catalog from './assets/dungeons/catalog.json';
import './player.css';
function Preview() {
 const initial=catalog.find(m=>m.key===new URLSearchParams(location.search).get('map'))??catalog[0]!;
 const [mapKey,setMapKey]=useState(initial.key),[floor,setFloor]=useState(initial.floors[0]!.floor),[room,setRoom]=useState(initial.floors[0]!.roomIds[0]!),[overview,setOverview]=useState(true);
 const map=catalog.find(m=>m.key===mapKey)!;
 const entry=map.floors.find(f=>f.floor===floor)!;
 return <main className="dungeon-art-preview" style={{position:'fixed',inset:0,background:'#16272a',color:'#eeddb7',fontFamily:'serif'}}>
  <DungeonModel modelUrl={dungeonArt(map.templateId,floor)!} locale="zh-Hant" currentRoomId={room} revealedRoomIds={entry.roomIds} moves={[]} onMove={setRoom} onOpenDoor={()=>{}} overview={overview}/>
  <header style={{position:'absolute',left:30,top:20,textShadow:'0 2px 8px #000'}}><small>雲華 · 地牢場景</small><h1 style={{margin:'8px 0'}}>{map.name}</h1><p>{entry.label}</p></header>
  <nav style={{position:'absolute',right:25,top:25,display:'flex',flexWrap:'wrap',justifyContent:'flex-end',maxWidth:'60%',gap:8}}>
   <select aria-label="選擇冒險地圖" value={mapKey} onChange={e=>{const next=catalog.find(m=>m.key===e.target.value)!;setMapKey(next.key);setFloor(next.floors[0]!.floor);setRoom(next.floors[0]!.roomIds[0]!);setOverview(true)}}>{catalog.map(m=><option key={m.key} value={m.key}>{m.name}</option>)}</select>
   {map.floors.map(f=><button key={f.floor} onClick={()=>{setFloor(f.floor);setRoom(f.roomIds[0]!);setOverview(true)}}>{f.label}</button>)}
   <button onClick={()=>setOverview(v=>!v)}>{overview?'拉近查看':'全層總覽'}</button><a href={`./dungeon-walk.html?map=${mapKey}`} style={{color:'#eeddb7',padding:8}}>冒險測試入口</a><a href="./index.html" style={{color:'#eeddb7',padding:8}}>返回遊戲</a>
  </nav>
  <aside style={{position:'absolute',right:25,top:140,bottom:90,overflowY:'auto',scrollbarWidth:'none',display:'flex',flexDirection:'column',gap:8}}>{entry.roomIds.map(id=><button key={id} onClick={()=>{setRoom(id);setOverview(false)}}>{id.replace(/^[^.]+\./,'')}</button>)}</aside>
  <p style={{position:'absolute',left:30,bottom:35,fontSize:13,color:'#c2d4ca'}}>場景美術預覽 · 不讀寫遊戲存檔</p>
 </main>;
}
createRoot(document.getElementById('root')!).render(<Preview/>);
