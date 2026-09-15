import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const dir='app/assets/dungeons/';
const catalog=JSON.parse(readFileSync(dir+'catalog.json','utf8'));
const templates=JSON.parse(readFileSync('content/yunhua/maps.json','utf8')).filter(t=>t.kind==='map-template');
const profiles=JSON.parse(readFileSync('scripts/blender/dungeon-profiles.json','utf8'));
assert.deepEqual(catalog.map(m=>m.templateId).sort(),templates.map(t=>t.id).sort(),'all shipped maps have art');
const stable=v=>Array.isArray(v)?'['+v.map(stable).join(', ')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+': '+stable(v[k])).join(', ')+'}':JSON.stringify(v);
for(const art of catalog){
const template=templates.find(x=>x.id===art.templateId);
assert.equal(art.topologyHash,createHash('sha256').update(stable({rooms:template.rooms,links:template.links})).digest('hex'),'art topology must match current content');
assert.deepEqual(art.floors.map(f=>f.floor),template.floors.map(f=>f.floor));
const clearance=JSON.parse(readFileSync(dir+(art.key==='canal'?'clearance':art.key+'-clearance')+'.json','utf8'));
for(const [file,hash] of Object.entries(clearance.files)) assert.equal(createHash('sha256').update(readFileSync(dir+file)).digest('hex'),hash,`Recheck geometry clearance after modifying ${file}`);
assert(clearance.floors.length===art.floors.length && clearance.floors.every(f=>f.openDrySampleRatio>.82 && f.footprintChecks>100));
const allDoors=[];
for(const floor of art.floors){
 assert.deepEqual(floor.rooms,template.rooms.filter(r=>r.floor===floor.floor));
 const bytes=readFileSync(dir+floor.model);assert.equal(bytes.toString('utf8',0,4),'glTF');
 const gltf=JSON.parse(bytes.toString('utf8',20,20+bytes.readUInt32LE(12)).trim());
 const rooms=gltf.nodes.filter(n=>n.extras?.roomId);
 assert.deepEqual(rooms.map(n=>n.extras.roomId).sort(),template.rooms.filter(r=>r.floor===floor.floor).map(r=>r.roomId).sort());
 assert.deepEqual([...floor.roomIds].sort(),rooms.map(n=>n.extras.roomId).sort());
 assert(rooms.every(n=>Array.isArray(n.extras.anchor)&&n.extras.anchor.length===3));
 allDoors.push(...gltf.nodes.filter(n=>n.extras?.linkId).map(n=>n.extras.linkId));
 let triangles=0;
 for(const mesh of gltf.meshes)for(const p of mesh.primitives){assert(p.attributes.TEXCOORD_0!==undefined,'meshes have UV');assert(p.attributes.NORMAL!==undefined);triangles+=gltf.accessors[p.indices].count/3;}
 assert(triangles>10000&&triangles<150000,'moderate detailed mesh budget');
 if(art.key!=='canal'){
  const profile=profiles.find(p=>p.key===art.key),material=gltf.materials.find(m=>m.name.startsWith(art.key+' strata'));
  assert(material?.pbrMetallicRoughness?.baseColorFactor,'geology tint survives GLB export');
  profile.tint.forEach((v,i)=>assert(Math.abs(material.pbrMetallicRoughness.baseColorFactor[i]-v)<.00001));
 }
 assert(gltf.materials.some(m=>m.normalTexture),'normal maps packaged');
 assert(gltf.images.every(i=>i.bufferView!==undefined),'all textures embedded');
 console.log(floor.model,rooms.length+' rooms',triangles+' triangles');
}
assert.deepEqual(allDoors.sort(),template.links.filter(l=>l.kind==='redDoor').map(l=>l.linkId).sort());
}
console.log('DUNGEON ART PASSED: shipped room topology, operable doors, embedded UV materials, mesh budget');
