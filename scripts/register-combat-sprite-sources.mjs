/** Register saved original imagegen sources in the authoring catalog; never synthesizes missing art. */
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
const read=p=>JSON.parse(readFileSync(p,'utf8'));
const path='content-source/combat-sprite-sheets.json',catalog=read(path);
const {appearances}=read('content-source/combat-appearances.json');
const {actions,families}=read('content-source/combat-motion-families.json');
let added=0;
for(const appearance of appearances)for(const family of families){
 const skin=`${appearance.id}--${family.id}`;
 const folder=`app/assets/combat/sprites/${skin}`;
 if(!existsSync(`${folder}/sequence.png`)||!existsSync(`${folder}/source.json`))continue;
 const png=readFileSync(`${folder}/sequence.png`),w=png.readUInt32BE(16),h=png.readUInt32BE(20);
 // Normalize the atlas cell height once, never resize each pose independently.
 const spec={skin,appearanceId:appearance.id,motionFamilyId:family.id,label:`${appearance.label} · ${family.label}`,actions,scale:1.73*1254/h,baselines:[.97,1,.98,1,1,.98],facing:'right',width:255,attackMotion:family.attackMotion,portrait:[55*w/1254,0,105*w/1254,105*h/1254]};
 const i=catalog.sheets.findIndex(s=>s.skin===skin);
 if(i===-1){catalog.sheets.push(spec);added++;}else Object.assign(catalog.sheets[i],spec);
}
const medium=new Set(['miasma-pouch-badger','gatewater-salamander','tower-stone-lizard','seal-halberd-warden']);
for(const spec of read('content-source/combat-human-monster-sheets.json')){
 const folder=`app/assets/combat/sprites/${spec.skin}`;
 if(!existsSync(`${folder}/sequence.png`)||!existsSync(`${folder}/source.json`))continue;
 const i=catalog.sheets.findIndex(s=>s.skin===spec.skin);
 if(i===-1){catalog.sheets.push(spec);added++;}else Object.assign(catalog.sheets[i],spec);
}
for(const spec of catalog.sheets)if(medium.has(spec.skin))spec.width=330;
writeFileSync(path,JSON.stringify(catalog,null,2)+'\n');
console.log(`Registered ${added} saved character sources; ${catalog.sheets.length} source sheets total.`);
