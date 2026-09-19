import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const catalog=JSON.parse(fs.readFileSync('content/presentation/facilities.json','utf8').replace(/^\uFEFF/,''));
const cultures=['culture.yunhua','culture.vildun','culture.aurelien','culture.safir'];
const kinds=['inn','tavern','adventurerGuild','itemShop','equipmentShop','trainingGround','bookstore','adventureCheckpoint','cityGate','home'];
assert.equal(catalog.facilities.length,40);
const portraits=new Set(),identities=new Set(),detailCells=new Set(),detailAtlases=new Set();
for(const culture of cultures)for(const kind of kinds){
 const rows=catalog.facilities.filter(p=>p.cultureId===culture&&p.kind===kind);assert.equal(rows.length,1,`${culture}/${kind}`);const p=rows[0];
 for(const locale of ['zh-Hant','en']){assert(p.name[locale]);assert(p.host.name[locale]);for(const expression of ['normal','happy','angry','sad'])assert(p.dialogue[expression][locale]);}
 assert(!/[\u3400-\u9fff]/.test(p.host.name.en),`${p.id}: English name must have an authored spelling`);
 const file=fs.readFileSync(path.join('app/assets/facilities',p.host.portrait));assert(file.subarray(1,4).toString()==='PNG');assert.equal(file.readUInt32BE(16),file.readUInt32BE(20),'expression sheet is square');assert(file.readUInt32BE(16)>=1024,'portrait source resolution');
 assert.equal(file[25],2,`${p.id}: receptionist sheets must be opaque RGB PNGs, not fading RGBA sprites`);
 portraits.add(createHash('sha256').update(file).digest('hex'));identities.add(p.host.description);
 assert(fs.existsSync(path.join('app/assets/facilities',p.theme.atlas)));assert(p.theme.cell>=0&&p.theme.cell<10);
 const dialogue=p.theme.dialogue;assert(dialogue,'dialogue art is mandatory');
 const dialogueFile=fs.readFileSync(path.join('app/assets/facilities',dialogue.image));
 assert.equal(dialogueFile.subarray(1,4).toString(),'PNG');assert.equal(dialogueFile.readUInt32BE(16),dialogueFile.readUInt32BE(20),'dialogue frame is square');
 assert(dialogue.slicePercent>0&&dialogue.slicePercent<50);for(const color of [dialogue.fill,dialogue.ink,dialogue.edge])assert(/^#[0-9a-f]{6}$/i.test(color));
 if(p.theme.frame){
  const frame=p.theme.frame,source=fs.readFileSync(path.join('app/assets/facilities',frame.image));
  assert.equal(source.subarray(1,4).toString(),'PNG');assert.equal(source.readUInt32BE(16),source.readUInt32BE(20),'nine-slice source is compact and square');
  assert(frame.slicePercent>0&&frame.slicePercent<50&&frame.width>0);assert(/^#[0-9a-f]{6}$/i.test(frame.fill),'stretchable center is a single color');
 }
 const detail=p.theme.detail;assert(detail,'detail art is mandatory');
 const detailFile=fs.readFileSync(path.join('app/assets/facilities',detail.atlas));
 assert.equal(detailFile.subarray(1,4).toString(),'PNG');assert.equal(detailFile[25],2,'detail panels are opaque RGB');
 const [x,y,w,h]=detail.rect;assert(x>=0&&y>=0&&w>0&&h>0&&x+w<=1.001&&y+h<=1.001,'detail sample fits atlas');
 assert.equal(detail.inset.length,4);assert(detail.inset.every(n=>n>=0&&n<50));
 assert(detail.inset[0]+detail.inset[2]<75&&detail.inset[1]+detail.inset[3]<55,'detail has readable safe area');
 detailCells.add(detail.atlas+JSON.stringify(detail.rect));detailAtlases.add(createHash('sha256').update(detailFile).digest('hex'));
}
assert.equal(detailCells.size,40,'all cultural professions have distinct detail art cells');assert.equal(detailAtlases.size,4,'four independent detail atlases');
assert.equal(portraits.size,40,'every cultural facility has its own portrait art');assert.equal(identities.size,40,'forty independently authored identities');
for(const kind of kinds)assert.equal(new Set(catalog.facilities.filter(p=>p.kind===kind).map(p=>p.name['zh-Hant'])).size,4,'cultural facility names differ');
console.log('RECEPTION ART PASSED: 40 cultural facilities, 40 distinct character sheets, 160 expression slots, localized names/dialogue, all art present');
