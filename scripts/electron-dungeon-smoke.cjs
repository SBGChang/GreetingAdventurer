const {app,BrowserWindow}=require('electron');
const {mkdtempSync,writeFileSync,readFileSync}=require('node:fs');
const {tmpdir}=require('node:os');
const path=require('node:path');
const assert=require('node:assert/strict');
app.setPath('userData',mkdtempSync(path.join(tmpdir(),'ga-dungeon-')));
const timer=setTimeout(()=>app.exit(1),240000);
app.whenReady().then(async()=>{
 const win=new BrowserWindow({show:false,width:1440,height:900,webPreferences:{offscreen:true}});
 win.webContents.setBackgroundThrottling(false);
 const run=code=>win.webContents.executeJavaScript(code,true);
 const errors=[];win.webContents.on('console-message',d=>{if(d.level==='error')errors.push(d.message)});
 const wait=async code=>{for(let i=0;i<300;i++){if(await run(code))return;await new Promise(r=>setTimeout(r,50))}throw Error('Timeout: '+code)};
 const click=async label=>{const code=`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes(${JSON.stringify(label)})&&!b.disabled)`;await wait(`Boolean(${code})`);await run(`(${code}).click()`)};
 const capture=async name=>{await new Promise(r=>setTimeout(r,800));win.webContents.invalidate();writeFileSync(path.resolve('dist/'+name),(await win.webContents.capturePage()).toPNG())};
 await win.loadFile(path.resolve('dist/renderer/dungeon-3d.html'));
 await wait(`document.querySelector('.dungeon-model')?.dataset.ready==='true'`);
 assert.equal(await run(`document.querySelector('.dungeon-model').dataset.roomCount`),'6');
 await capture('dungeon-upper-preview.png');
 await click('地下蓄水層');await wait(`document.querySelector('.dungeon-model')?.dataset.ready==='true'&&document.querySelector('.dungeon-model').dataset.roomCount==='8'`);
 await capture('dungeon-lower-preview.png');await click('蓄水池');await capture('dungeon-pool-close.png');
 assert.equal(await run(`localStorage.length`),0,'art preview must not create saves');
 await win.loadFile(path.resolve('dist/renderer/index.html'));
 await wait(`Boolean(document.querySelector('.welcome form'))`);
 await run(`document.querySelector('.welcome form').requestSubmit()`);
 await click('冒險者關卡');await click('舊漕渠與沉倉');
 await wait(`document.querySelector('.dungeon-model')?.dataset.ready==='true'`);
 await run(`window.__dungeonCanvas=document.querySelector('.dungeon-model canvas')`);
 const definitions=JSON.parse(readFileSync('content/yunhua/maps.json','utf8'));
 const template=definitions.find(d=>d.id==='map-template.yunhua.old-canal-sunken-store');
 const nav=JSON.parse(readFileSync('app/assets/dungeons/navigation.json','utf8'));
 const walk=require('./lib/dungeon-keyboard.cjs').createDungeonKeyboard(run,template,nav);
 await wait(`document.querySelector('[data-minimap-view]')?.dataset.ready==='true'`);
 assert.deepEqual(await run(`JSON.parse(document.querySelector('[data-minimap-view]').dataset.rooms)`),['f1.水道入口'],'unseen rooms have no minimap elements');
 assert.equal(await run(`JSON.parse(document.querySelector('[data-minimap-view]').dataset.links).length`),0,'unknown links are absent');
 const move=async part=>{
  const actor=await run(`JSON.parse(document.querySelector('.walk-scene').dataset.actor)`);
  const room=template.rooms.find(r=>r.roomId.includes(part));assert(room,'target room exists');
  const link=template.links.find(l=>l.fromRoomId===actor.roomId && l.toRoomId===room.roomId || l.toRoomId===actor.roomId && l.fromRoomId===room.roomId);assert(link,'formal link exists');
  const code=`document.querySelector('[data-move-room="${room.roomId}"]')`;
  const from=link.fromRoomId===actor.roomId?link.fromCell:link.toCell,to=link.toRoomId===actor.roomId?link.fromCell:link.toCell;
  if(await run(`Boolean(${code})`)){
   const target=await run(`({x:Number((${code}).dataset.worldX),z:Number((${code}).dataset.worldZ)})`);
   await walk([actor.roomId],target,from.floor,1.35);await wait(`!(${code}).disabled`);
   if(await run(`(${code}).dataset.interaction==='openDoor'`)){await run(`(${code}).click()`);await wait(`!(${code}) || (${code}).dataset.interaction!=='openDoor'`);}
  }
  if(from.floor!==to.floor){
   await wait(`!(${code}).disabled`);
   assert.equal(await run(`(${code}).dataset.interaction`),to.floor>from.floor?'stairsUp':'stairsDown');
   await run(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'e'}));window.dispatchEvent(new KeyboardEvent('keyup',{key:'e'}))`);
   await wait(`document.querySelector('.walk-scene')?.dataset.ready==='true' && JSON.parse(document.querySelector('.walk-scene').dataset.actor||'{}').roomId==='${room.roomId}'`);return;
  }
  await walk([actor.roomId,room.roomId],{x:(to.col-3)*6,z:(to.row-3)*6},from.floor);
  await wait(`document.querySelector('h2[data-current-room]').dataset.currentRoom==='${room.roomId}'`);
 };
 await move('西側倉房');
 await wait(`JSON.parse(document.querySelector('.dungeon-model').dataset.litRooms||'[]')[0]==='f1.西側倉房'`);
 assert.deepEqual(await run(`JSON.parse(document.querySelector('.dungeon-model').dataset.litRooms)`),['f1.西側倉房'],'formal exploration lights only the current room');
 assert(await run(`document.querySelector('.dungeon-model canvas')===window.__dungeonCanvas`),'opening a door and moving within floor retain canvas');
 const beforeMenu=await run(`JSON.parse(document.querySelector('.walk-scene').dataset.actor)`);
 await run(`document.querySelector('[data-player-menu]').click()`);await wait(`document.querySelector('.dungeon-adventure').hidden`);
 await run(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'d'}))`);await new Promise(r=>setTimeout(r,200));await run(`window.dispatchEvent(new KeyboardEvent('keyup',{key:'d'}))`);
 await run(`document.querySelector('[data-player-menu]').click()`);await wait(`!document.querySelector('.dungeon-adventure').hidden`);
 assert(await run(`document.querySelector('.walk-scene canvas')===window.__dungeonCanvas`),'inventory retains scene');
 const afterMenu=await run(`JSON.parse(document.querySelector('.walk-scene').dataset.actor)`);
 assert(Math.hypot(afterMenu.x-beforeMenu.x,afterMenu.z-beforeMenu.z)<.01,'hidden scene cannot move');
 const beforeReload=await run(`document.querySelector('h2[data-current-room]').dataset.currentRoom`);
 win.webContents.reload();await click('繼續');await wait(`document.querySelector('.walk-scene')?.dataset.ready==='true'&&document.querySelector('.walk-scene').dataset.actor`);
 assert.equal(await run(`JSON.parse(document.querySelector('.walk-scene').dataset.actor).roomId`),beforeReload,'save reload resumes authoritative room');
 await run(`window.__dungeonCanvas=document.querySelector('.dungeon-model canvas')`);
 await capture('dungeon-gameplay.png');
 await move('引水走廊');await move('西側下行梯');await move('西側上行梯');
 await wait(`document.querySelector('.dungeon-model')?.dataset.ready==='true'&&document.querySelector('.dungeon-model').dataset.roomCount==='8'`);
 assert(await run(`document.querySelector('.dungeon-model canvas')!==window.__dungeonCanvas`),'changing floor loads correct scene');
 await move('西側下行梯');await move('西側上行梯');
 await move('蓄水池');await capture('dungeon-lower-gameplay.png');
 assert(await run(`(()=>{const boxes=[...document.querySelectorAll('[data-minimap-anchor]')].filter(e=>!e.hidden).map(e=>e.getBoundingClientRect());return boxes.every((a,i)=>boxes.slice(i+1).every(b=>a.right<=b.left||b.right<=a.left||a.bottom<=b.top||b.bottom<=a.top))})()`),'nearby door and stair badges must not overlap in the scaled formal viewport');
 await move('中段水閘');await move('西側沉貨區');await move('水門出口');
 await click('離開');await wait(`!document.querySelector('.dungeon-model')`);
 // Clear both persistent slots via the actual management UI.
 await run(`document.querySelector('.save-tools').open=true`);
 await click('清除存檔與備份');await click('永久清除');
 await wait(`Boolean(document.querySelector('.welcome form'))`);
 assert(await run(`localStorage.getItem('greeting-adventurer.save.v1')===null&&localStorage.getItem('greeting-adventurer.save.v1.backup')===null`));
 assert.equal(errors.length,0,errors.join('\n'));console.log('DUNGEON PASSED: both models, room/door movement, retained canvas, stairs, exit, save clearing, read-only art preview');clearTimeout(timer);app.exit(0);
}).catch(e=>{console.error(e);app.exit(1)});
