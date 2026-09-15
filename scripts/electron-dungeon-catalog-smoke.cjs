const {app,BrowserWindow}=require('electron');
const {mkdtempSync,writeFileSync,readFileSync}=require('node:fs');
const {tmpdir}=require('node:os');const path=require('node:path');const assert=require('node:assert/strict');
const requested=process.argv.find(a=>a.startsWith('--maps='))?.slice(7).split(',');
const catalog=JSON.parse(readFileSync('app/assets/dungeons/catalog.json','utf8')).filter(m=>!requested||requested.includes(m.key));
assert(catalog.length>0,'at least one map selected');
app.setPath('userData',mkdtempSync(path.join(tmpdir(),'ga-dungeon-catalog-')));
const timer=setTimeout(()=>app.exit(1),300000);
app.whenReady().then(async()=>{
 const win=new BrowserWindow({show:false,width:1440,height:900,webPreferences:{offscreen:true}});win.webContents.setBackgroundThrottling(false);
 const run=code=>win.webContents.executeJavaScript(code,true),errors=[];
 win.webContents.on('console-message',d=>{if(d.level==='error')errors.push(d.message)});
 const pause=ms=>new Promise(r=>setTimeout(r,ms));
 const wait=async code=>{for(let i=0;i<400;i++){if(await run(code))return;await pause(50)}throw Error('Timeout '+code)};
 const capture=async file=>{await pause(300);win.webContents.invalidate();writeFileSync(path.resolve('dist/'+file),(await win.webContents.capturePage()).toPNG());};
 for(const map of catalog){
  await win.loadFile(path.resolve('dist/renderer/dungeon-walk.html'),{query:{map:map.key}});
  for(const floor of map.floors){
   await run(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent===${JSON.stringify(floor.label)}).click()`);
   await wait(`document.querySelector('.walk-scene')?.dataset.ready==='true'&&JSON.parse(document.querySelector('.walk-scene').dataset.actor||'{}').roomId===${JSON.stringify(floor.roomIds[0])}`);
   const state=await run(`JSON.parse(document.querySelector('.walk-scene').dataset.actor)`);
   assert.deepEqual(await run(`JSON.parse(document.querySelector('.walk-scene').dataset.litRooms)`),[state.roomId]);
   assert.equal(await run(`Number(document.querySelector('.walk-scene').dataset.darkRooms)`),floor.rooms.length-1);
   await run(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'d'}))`);await pause(450);await run(`window.dispatchEvent(new KeyboardEvent('keyup',{key:'d'}))`);
   const moved=await run(`JSON.parse(document.querySelector('.walk-scene').dataset.actor)`);
   assert(Math.hypot(moved.x-state.x,moved.z-state.z)>.05,`${map.name} ${floor.label}: character moves`);
   await capture(`walk-${map.key}-${floor.floor}.png`);
   assert(await run(`(()=>{const m=document.querySelector('[data-minimap-player]'),a=JSON.parse(document.querySelector('.walk-scene').dataset.actor);return !m.hidden&&m.dataset.roomId===a.roomId&&Math.hypot(Number(m.dataset.worldX)-a.x,Number(m.dataset.worldZ)-a.z)<.01})()`),'aerial marker matches exact party position');
   assert.deepEqual(await run(`JSON.parse(document.querySelector('[data-minimap-view]').dataset.rooms)`),[state.roomId],'unknown terrain is excluded from aerial render');
   assert.equal(await run('localStorage.length'),0);
   console.log('DEMO FLOOR PASSED',map.name,floor.label);
  }
  await win.loadFile(path.resolve('dist/renderer/dungeon-3d.html'),{query:{map:map.key}});
  await wait(`document.querySelector('.dungeon-model')?.dataset.ready==='true'`);
  assert.equal(await run(`Number(document.querySelector('.dungeon-model').dataset.roomCount)`),map.floors[0].rooms.length);
  await capture(`overview-${map.key}.png`);
 }
 assert.equal(errors.length,0,errors.join('\n'));console.log(`ALL ${catalog.length} MAPS / ${catalog.reduce((n,m)=>n+m.floors.length,0)} FLOORS PASSED: loading, keyboard, lighting, content masks, overview, isolated saves`);clearTimeout(timer);app.exit(0);
}).catch(e=>{console.error(e);app.exit(1)});
