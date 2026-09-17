import {readFileSync,writeFileSync} from 'node:fs';
import {compileSheet} from './compile-sprite-sheet.mjs';
const read=p=>JSON.parse(readFileSync(p,'utf8'));
const manifest=read('content-source/combat-sprite-sheets.json');
const {appearances}=read('content-source/combat-appearances.json');
const {families}=read('content-source/combat-motion-families.json');
const authored=read('content-source/combat-sprite-bindings.json');
const output='app/assets/combat/sprites';
const compiled=new Set(['yunhua-male-martial','tide-shell-crab']);
const catalog={};
for(const sheet of manifest.sheets){const {clips,...metadata}=compileSheet({...sheet,path:`${output}/${sheet.skin}/sequence.png`});catalog[sheet.skin]=metadata;compiled.add(sheet.skin);}
writeFileSync(`${output}/catalog.json`,JSON.stringify(catalog,null,2)+'\n');
const roster=appearances.map(({description,...a})=>({...a,skins:Object.fromEntries(families.flatMap(f=>{
 const skin=a.id==='yunhua-male-martial'&&f.id==='blade'?a.id:`${a.id}--${f.id}`;
 return compiled.has(skin)?[[f.id,skin]]:[];
}))}));
writeFileSync(`${output}/appearances.json`,JSON.stringify(roster,null,2)+'\n');
const equipment=Object.fromEntries(Object.entries(authored.equipmentLines).flatMap(([culture,lines])=>Object.entries(lines).flatMap(([line,family])=>['i','ii','iii','iv','v'].map(tier=>[`equipment.${culture}.${line}.${tier}`,family]))));
const monsters={'monster.yunhua.tide-shell-crab':'tide-shell-crab',...Object.fromEntries(manifest.sheets.filter(s=>s.modelId).map(s=>[s.modelId,s.skin]))};
writeFileSync(`${output}/bindings.json`,JSON.stringify({defaultAppearances:authored.defaultAppearances,equipment,combinations:authored.combinations,monsters},null,2)+'\n');
console.log(`Compiled ${manifest.sheets.length} original sprite sheets, ${roster.length} appearances and ${Object.keys(monsters).length} monster bindings.`);
