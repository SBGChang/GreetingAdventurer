import {readFileSync,writeFileSync} from 'node:fs';
const dir='app/assets/dungeons/';
const profiles=JSON.parse(readFileSync('scripts/blender/dungeon-profiles.json','utf8'));
const templates=JSON.parse(readFileSync('content/yunhua/maps.json','utf8')).filter(t=>t.kind==='map-template');
const maps=[{key:'canal',name:'舊漕渠與沉倉',floors:['上層倉區','地下蓄水層']},...profiles].map(p=>{
 const a=JSON.parse(readFileSync(dir+p.key+'.json','utf8')),t=templates.find(t=>t.id===a.templateId);
 if(!t)throw Error('Unshipped map '+a.templateId);
 return {...a,key:p.key,name:p.name,floors:a.floors.map((f,i)=>({...f,label:p.floors[i],rows:t.floors.find(v=>v.floor===f.floor).rows,cols:t.floors.find(v=>v.floor===f.floor).cols}))};
});
if(maps.length!==templates.length)throw Error('Missing map art');
writeFileSync(dir+'catalog.json',JSON.stringify(maps,null,2)+'\n');
console.log('Dungeon catalogue:',maps.length,'maps,',maps.reduce((n,m)=>n+m.floors.length,0),'floors');
