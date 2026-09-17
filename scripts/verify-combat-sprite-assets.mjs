import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
const read=p=>JSON.parse(readFileSync(p,'utf8'));
const base='app/assets/combat/sprites';
const {appearances}=read('content-source/combat-appearances.json');
const {families,actions}=read('content-source/combat-motion-families.json');
const {sheets}=read('content-source/combat-sprite-sheets.json');
const roster=read(`${base}/appearances.json`),bindings=read(`${base}/bindings.json`);
const catalog=read(`${base}/catalog.json`);
const complete=process.argv.includes('--complete');
const missing=[];
assert.equal(appearances.length,16);
assert.equal(new Set(appearances.map(a=>`${a.culture}/${a.sex}/${a.style}`)).size,16);
assert.equal(new Set(sheets.map(s=>s.skin)).size,sheets.length,'duplicate sprite identity');
for(const appearance of appearances){
 const compiled=roster.find(a=>a.id===appearance.id);assert(compiled,appearance.id);
 assert.equal(compiled.sex,appearance.sex);
 for(const family of families){
  const skin=compiled.skins[family.id];
  if(!skin){missing.push(`${appearance.id}/${family.id}`);continue;}
  if(skin==='yunhua-male-martial')continue;
  const profile=read(`${base}/${skin}/profile.json`);
  assert.equal(profile.appearanceId,appearance.id);
  assert.equal(profile.motionFamilyId,family.id);
  assert.deepEqual(profile.clips.map(c=>c.id),actions);
 }
}
for(const sheet of sheets){
 const folder=`${base}/${sheet.skin}`,png=readFileSync(`${folder}/sequence.png`),stamp=read(`${folder}/sampling-source.json`),profile=read(`${folder}/profile.json`);
 const {clips,...metadata}=profile;assert.deepEqual(catalog[sheet.skin],metadata,`stale lazy metadata: ${sheet.skin}`);
 assert.equal(stamp.sha256,createHash('sha256').update(png).digest('hex'),`stale sampling: ${sheet.skin}`);
 assert.deepEqual(stamp.actions,sheet.actions);
 assert.equal(stamp.analyzerVersion,2,`stale silhouette assignment: ${sheet.skin}`);
 assert.deepEqual(profile.clips.map(c=>c.id),[...new Set(sheet.actions)]);
 assert.equal(profile.facing,sheet.facing);assert.equal(profile.width,sheet.width);
 if(profile.contactFrame!==undefined)assert(Number.isInteger(profile.contactFrame)&&profile.contactFrame>0&&profile.contactFrame<profile.clips.find(c=>c.id==='attack').frames.length,`invalid contact pose: ${sheet.skin}`);
 for(const clip of profile.clips){
  assert.equal(clip.frames.length,sheet.actions.filter(a=>a===clip.id).length*6);
  assert.equal(clip.width,png.readUInt32BE(16));assert.equal(clip.height,png.readUInt32BE(20));
  for(const frame of clip.frames){
   const r=frame.rect;
   assert(r.x>=0&&r.y>=0&&r.width>0&&r.height>0&&r.x+r.width<=clip.width&&r.y+r.height<=clip.height,`${sheet.skin}/${clip.id}: out of atlas`);
   assert(frame.durationMs>0&&Number.isFinite(frame.pivot.x)&&Number.isFinite(frame.pivot.y));
   assert(frame.regions?.length>0,`${sheet.skin}: missing isolated silhouette`);
  }
 }
 if(sheet.modelId)assert.equal(bindings.monsters[sheet.modelId],sheet.skin);
}
const expectedMonsters=new Set(read('content/yunhua/monsters.json').filter(m=>m.kind==='monster').map(m=>m.id));
for(const culture of ['yunhua','vildun','aurelien','safir']){
 const doc=readFileSync(`docs/03_content/${culture}/${culture}_content.md`,'utf8');
 for(const match of doc.matchAll(/`(monster\.[a-z]+\.[a-z0-9-]+)`/g))expectedMonsters.add(match[1]);
}
for(const culture of ['vildun','aurelien','safir']){
 const {monsterCatalog,equipmentCatalog}=await import(`../docs/03_content/${culture}/${culture}_content.data.mjs`);
 for(const monster of monsterCatalog.nonHuman)expectedMonsters.add(monster.id.startsWith('monster.')?monster.id:`monster.${culture}.${monster.id}`);
 for(const group of equipmentCatalog)for(const line of group.lines)for(const item of line){
  if(/\.(cloth|light-armor|medium-armor|heavy-armor)\./.test(item.id))continue;
  assert(item.id in bindings.equipment,`unmapped authored weapon ${item.id}`);
 }
}
assert.equal(expectedMonsters.size,65,'all authored species and shipped human monsters must be checked');
for(const id of expectedMonsters){const skin=bindings.monsters[id];if(!skin)missing.push(id);else assert(existsSync(`${base}/${skin}`));}
const equipment=read('content/yunhua/equipment.json').filter(e=>e.kind==='equipment'&&e.equipmentKind!=='armor');
assert(equipment.length>0,'weapon coverage must inspect actual equipment definitions');
for(const item of equipment)assert(item.id in bindings.equipment,`unmapped weapon ${item.id}`);
if(complete)assert.deepEqual(missing,[],'art coverage is incomplete');
console.log(`SPRITE ASSETS: ${sheets.length} sampled sheets, ${expectedMonsters.size} monster definitions, ${appearances.length} appearances; ${missing.length} missing combinations.`);
