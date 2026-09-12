import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
const folder=resolve('app/assets/geography');
const atlas=JSON.parse(readFileSync(resolve(folder,'atlas.json'),'utf8').replace(/^\uFEFF/,''));
const clearance=JSON.parse(readFileSync(resolve(folder,'geometry-clearance.json'),'utf8'));
assert.deepEqual(clearance.issues,[],'independent scene geometry must not intersect');
assert.deepEqual(clearance.topology,{landComponents:1,shoreLoops:2},'one continent enclosing one inland lake');
const expectedAssets=[...atlas.cities.map(c=>resolve(folder,c.model)),resolve(folder,'world.glb')].flatMap(p=>[p,p.replace(/\.glb$/,'.blend')]);
assert.deepEqual(clearance.assets.map(a=>resolve(a.path)).sort(),expectedAssets.sort(),'clearance audit must cover every town and world');
for(const asset of clearance.assets)assert.equal(createHash('sha256').update(readFileSync(asset.path)).digest('hex'),asset.sha256,asset.path+': rebuild geometry clearance after exporting');
assert.equal(atlas.cities.length,16);
for(const region of atlas.regions){
 const cities=atlas.cities.filter(c=>c.culture===region.key);assert.equal(cities.length,4);
 assert.equal(cities.filter(c=>c.rank==='capital').length,1);
 if(region.key!=='yunhua'){
  const {cultureMeta}=await import(`../docs/03_content/${region.key}/${region.key}_content.data.mjs`);
  assert.deepEqual(cities.map(c=>c.name).sort(),[...cultureMeta.cities].sort(),'design and atlas city catalogue');
 }
}
for(const road of atlas.roads){
 const cities=road.ends.map(k=>atlas.cities.find(c=>c.key===k));assert(cities.every(Boolean));
 assert(['land','ferry'].includes(road.kind));assert.equal(road.playable,true);
}
function glb(path){const data=readFileSync(path);assert.equal(data.readUInt32LE(0),0x46546c67);assert.equal(data.readUInt32LE(4),2);return {doc:JSON.parse(data.subarray(20,20+data.readUInt32LE(12)).toString()),hash:createHash('sha256').update(data).digest('hex')};}
const hashes=new Set();
const kinds=['inn','tavern','adventurerGuild','itemShop','equipmentShop','trainingGround','bookstore','adventureCheckpoint','cityGate','home'].sort();
for(const city of atlas.cities){
 const {doc,hash}=glb(resolve(folder,city.model));assert(!hashes.has(hash),'cities must have distinct geometry files');hashes.add(hash);
 assert.deepEqual(doc.nodes.filter(n=>n.extras?.facility).map(n=>n.extras.facility).sort(),kinds,city.key);
 assert(doc.nodes.filter(n=>n.extras?.scenery).length>=9,city.key+' needs residential wards');
 assert.equal(doc.cameras[0].type,'orthographic');
 if(city.key==='redsail'){
  for(const name of ['dressed sandstone','star glazed ceramic','embroidered sail','lime plaster']){
   const materials=doc.materials.map((m,index)=>({m,index})).filter(({m})=>m.name==='Redsail '+name);
   assert(materials.length>0,'Redsail crafted material: '+name);
   for(const {m,index} of materials){
    const texture=m.pbrMetallicRoughness.baseColorTexture;assert(texture,'Redsail material must embed its atlas');
    const primitives=doc.meshes.flatMap(m=>m.primitives).filter(p=>p.material===index);
    assert(primitives.length>0);
    assert(primitives.every(p=>p.attributes['TEXCOORD_'+(texture.texCoord??0)]!==undefined),'export must preserve the UV channel used by each material');
   }
  }
  const triangles=doc.meshes.flatMap(m=>m.primitives).reduce((n,p)=>n+doc.accessors[p.indices].count/3,0);
  assert(triangles<360000,'Redsail street-view architecture and masonry triangle budget');
  for(const name of ['Redsail fine limestone paving','Redsail fine dome mosaic']){
   const entries=doc.materials.map((m,index)=>({m,index})).filter(({m})=>m.name===name);assert(entries.length>0,name);
   for(const {m,index} of entries){
    assert(m.normalTexture && m.pbrMetallicRoughness.baseColorTexture,'near-view materials need embedded albedo and tangent normals');
    for(const p of doc.meshes.flatMap(m=>m.primitives).filter(p=>p.material===index)){
     assert(p.attributes['TEXCOORD_'+(m.normalTexture.texCoord??0)]!==undefined,'normal UV survives mesh merging');
     assert(p.attributes['TEXCOORD_'+(m.pbrMetallicRoughness.baseColorTexture.texCoord??0)]!==undefined,'albedo UV survives mesh merging');
    }
   }
  }
 }
}
const world=glb(resolve(folder,'world.glb')).doc;
assert.equal(world.nodes.filter(n=>n.extras?.waterBody==='inland-lake').length,1);
assert.deepEqual(world.nodes.filter(n=>n.extras?.cityKey).map(n=>n.extras.cityKey).sort(),atlas.cities.map(c=>c.key).sort());
const detail=JSON.parse(readFileSync(resolve(folder,'world-mesh-info.json'),'utf8'));
assert(detail.terrainVertices<=24000,'one continent retains a moderate terrain budget');
assert.equal(world.nodes.filter(n=>n.extras?.regionKey).length,4);
// Read exported geometry, not authoring metadata: low density must retain relief.
function heightRange(name){
 const node=world.nodes.find(n=>n.name===name);assert(node?.mesh!==undefined,name);
 const positions=world.meshes[node.mesh].primitives.map(p=>world.accessors[p.attributes.POSITION]);
 return Math.max(...positions.map(a=>a.max[1]))-Math.min(...positions.map(a=>a.min[1]));
}
for(const r of atlas.regions)assert(heightRange('Land '+r.key+' geometry')>10,'regional relief must exist in the mesh');
assert(world.images.length>=8,'four base-color and tangent normal pairs must be embedded');
assert(!world.materials.some(m=>m.name==='Studio sand'),'studio floor must not enter world city LODs');
for(const name of ['Continent UV albedo','Snow UV albedo','Sand UV albedo','Stratified rock UV']){
 const index=world.materials.findIndex(m=>m.name===name);assert(index>=0,name);
 const material=world.materials[index];assert(material.pbrMetallicRoughness.baseColorTexture);assert(material.normalTexture);
 const primitives=world.meshes.flatMap(m=>m.primitives).filter(p=>p.material===index);
 assert(primitives.length>0);assert(primitives.every(p=>p.attributes.TEXCOORD_0!==undefined));
}
const triangles=world.meshes.flatMap(m=>m.primitives).reduce((sum,p)=>sum+(p.indices===undefined?world.accessors[p.attributes.POSITION].count:world.accessors[p.indices].count)/3,0);
assert(triangles<450000,'sixteen complete city LODs and continent triangle budget');
console.log(`WORLD SURFACE: ${detail.terrainVertices} terrain vertices, ${Math.round(triangles)} exported triangles, UV albedo + normals`);
const content=['content/yunhua/world-city.json','content/world/world-city.json'].flatMap(p=>JSON.parse(readFileSync(p,'utf8')));
const runtimeCities=content.filter(d=>d.kind==='city-node');
assert.deepEqual(atlas.cities.map(c=>c.cityId).sort(),runtimeCities.map(c=>c.id).sort());
const ends=road=>road.ends.map(key=>atlas.cities.find(c=>c.key===key).cityId).sort().join('|');
assert.deepEqual(atlas.roads.filter(r=>r.playable).map(ends).sort(),content.filter(d=>d.kind==='route').map(r=>[r.fromCityId,r.toCityId].sort().join('|')).sort());
for(const road of atlas.roads)assert(content.some(d=>d.kind==='route'&&d.id===road.routeId),'visual route must identify its formal route');
console.log('GEOGRAPHY PASSED: sixteen unique models, four capitals, one continent, inland lake and complete runtime routes');
