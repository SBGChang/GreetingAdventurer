const { app } = require('electron');
const { createWindow } = require('../electron/window.cjs');
const { mkdtempSync, writeFileSync, readFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const assert = require('node:assert/strict');
const atlas=JSON.parse(readFileSync('app/assets/geography/atlas.json','utf8').replace(/^\uFEFF/,''));
app.setPath('userData',mkdtempSync(join(tmpdir(),'ga-atlas-')));
const timeout=setTimeout(()=>{console.error('Atlas smoke timed out');app.exit(1);},240000);
app.whenReady().then(async()=>{
 const {win,ready}=createWindow({show:false,offscreen:true,devUrl:''});await ready;
 win.webContents.setBackgroundThrottling(false);
 const errors=[];win.webContents.on('console-message',d=>{if(d.level==='error')errors.push(d.message);});
 const run=code=>win.webContents.executeJavaScript(code,true);
 const wait=async expression=>{for(let i=0;i<600;i++){if(await run(expression))return;await new Promise(r=>setTimeout(r,50));}console.error('Renderer errors',errors);writeFileSync(resolve('dist/atlas-failure.png'),(await win.webContents.capturePage()).toPNG());throw new Error('Missing '+expression);};
 const click=async selector=>{await wait(`Boolean(document.querySelector(${JSON.stringify(selector)}))`);await run(`document.querySelector(${JSON.stringify(selector)}).click()`);};
 const capture=async name=>{await new Promise(r=>setTimeout(r,450));win.webContents.invalidate();await new Promise(r=>setTimeout(r,150));writeFileSync(resolve('dist/'+name+'.png'),(await win.webContents.capturePage()).toPNG());};
 await wait(`Boolean(document.querySelector('.welcome form'))`);
 await run(`document.querySelector('.welcome form').requestSubmit()`);
 await wait(`document.querySelector('.town-model')?.dataset.ready==='true'`);
 await click('[data-building-tab=cityGate]');
 await wait(`document.querySelector('.atlas-canvas')?.dataset.ready==='true'`);
 assert.equal(await run(`document.querySelectorAll('[data-city-marker]').length`),16);
 await wait(`Boolean(document.querySelector('.atlas-canvas')?.dataset.landmarks)`);
 assert.equal(await run(`Number(document.querySelector('.atlas-canvas').dataset.zoom)`),atlas.camera.localZoom);
 const visible=await run(`document.querySelectorAll('[data-city-marker]:not([hidden])').length`);
 assert(visible>=1&&visible<=4,'local view should only show nearby cities');
 await capture('world-local-smoke');
 const panStart=await run(`document.querySelector('.atlas-canvas').dataset.landmarks`);
 const panPoint=await run(`(()=>{const r=document.querySelector('.atlas-canvas canvas').getBoundingClientRect();return {x:Math.round(r.x+r.width*.5),y:Math.round(r.y+r.height*.7)};})()`);
 win.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...panPoint});
 win.webContents.sendInputEvent({type:'mouseMove',x:panPoint.x-80,y:panPoint.y+25});
 win.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,x:panPoint.x-80,y:panPoint.y+25});
 await wait(`document.querySelector('.atlas-canvas').dataset.landmarks!==${JSON.stringify(panStart)}`);
 await click('.atlas-reset');
 await click('.atlas-overview');
 await wait(`document.querySelectorAll('[data-city-marker]:not([hidden])').length===16`);
 await capture('world-overview-smoke');
 const mapPoint=await run(`(()=>{const h=document.querySelector('.atlas-canvas'),p=JSON.parse(h.dataset.landmarks).chengpu,r=h.querySelector('canvas').getBoundingClientRect();return {x:Math.round(r.x+p.x*r.width),y:Math.round(r.y+p.y*r.height)};})()`);
 win.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...mapPoint});
 win.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...mapPoint});
 await wait(`document.querySelector('[data-atlas-city=chengpu]').getAttribute('aria-pressed')==='true'`);
 await wait(`Math.abs(JSON.parse(document.querySelector('.atlas-canvas').dataset.landmarks).chengpu.x-.5)<.03`);
 const zoom=await run(`document.querySelector('.atlas-canvas').dataset.zoom`);
 win.webContents.sendInputEvent({type:'mouseWheel',...mapPoint,deltaY:120,deltaX:0});
 await wait(`document.querySelector('.atlas-canvas').dataset.zoom!==${JSON.stringify(zoom)}`);
 await run(`(()=>{const c=document.querySelector('.atlas-canvas canvas');for(let i=0;i<16;i++)c.dispatchEvent(new WheelEvent('wheel',{deltaY:-100,bubbles:true,cancelable:true}));})()`);
 await wait(`Number(document.querySelector('.atlas-canvas').dataset.zoom)>1.5`);
 await capture('world-material-detail-smoke');
 await click('.atlas-reset');
 await click('[data-atlas-city=yunjing]');
 await capture('world-atlas-smoke');
 // Select every model through the real game menu. Preview does not mutate player location.
 const opening=await run(`localStorage.getItem('greeting-adventurer.save.v1')`);
 for(const city of atlas.cities){
   await click(`[data-atlas-city=${city.key}]`);await click('[data-city-preview]');
   await wait(`document.querySelector('[data-preview-city=${city.key}] .town-model')?.dataset.ready==='true'`);
   assert.equal(await run(`Object.keys(JSON.parse(document.querySelector('.town-model').dataset.landmarks)).length`),10);
   if(!city.cityId)assert.equal(await run(`Boolean(document.querySelector('[data-atlas-travel]'))`),false);
   await capture('city-'+city.key+'-smoke');
   assert.equal(await run(`localStorage.getItem('greeting-adventurer.save.v1')`),opening);
 }
 // Travel to all three other playable cities; test every facility ray against the new geometry.
 const layouts=new Set();
 for(const key of ['qingcen','chengpu','chiling']){
   await click(`[data-atlas-city=${key}]`);await click('[data-atlas-travel]');
   await wait(`document.querySelector('.city-scene .town-model')?.dataset.ready==='true'`);
   assert(await run(`document.querySelector('.location-plaque').textContent.includes(${JSON.stringify(atlas.cities.find(c=>c.key===key).name)})`));
   layouts.add(await run(`document.querySelector('.town-model').dataset.landmarks`));
   const kinds=await run(`Array.from(document.querySelectorAll('[data-building-tab]')).map(b=>b.dataset.buildingTab)`);
   for(const kind of kinds){
     const tabPoint=await run(`(()=>{const r=document.querySelector('[data-building-tab=${kind}]').getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};})()`);
     win.webContents.sendInputEvent({type:'mouseMove',x:5,y:5});
     await new Promise(r=>setTimeout(r,80));
     win.webContents.sendInputEvent({type:'mouseMove',...tabPoint});
     await wait(`document.querySelector('.town-model').dataset.cameraFocus==='${kind}' && document.querySelector('.town-model').dataset.cameraMoving==='false'`);
     const pt=await run(`(()=>{const h=document.querySelector('.town-model'),p=JSON.parse(h.dataset.landmarks)[${JSON.stringify(kind)}],r=h.querySelector('canvas').getBoundingClientRect();return {x:Math.round(r.x+p.x*r.width),y:Math.round(r.y+p.y*r.height)};})()`);
     win.webContents.sendInputEvent({type:'mouseMove',...pt});
     await wait(`document.querySelector('[data-building-tab=${kind}]')?.dataset.active==='true'`);
   }
   await capture('travel-'+key+'-smoke');
   await click('[data-building-tab=cityGate]');await wait(`document.querySelector('.atlas-canvas')?.dataset.ready==='true'`);
 }
 assert.equal(layouts.size,3,'travel must load three distinct city layouts');
 win.reload();await wait(`Boolean(document.querySelector('.welcome .continue'))`);await click('.welcome .continue');await wait(`document.querySelector('.city-scene .town-model')?.dataset.ready==='true'`);
 assert(await run(`document.querySelector('.location-plaque').textContent.includes('赤嶺城')`));
 assert(layouts.has(await run(`document.querySelector('.town-model').dataset.landmarks`)));
 // Cross borders through the real map controls and enter every additional city.
 let current='chiling';const reached=new Set(['yunjing','qingcen','chengpu','chiling']);
 function steps(from,to){const queue=[[from]],seen=new Set([from]);for(const p of queue){const last=p[p.length-1];if(last===to)return p.slice(1);for(const r of atlas.roads.filter(r=>r.ends.includes(last))){const next=r.ends.find(k=>k!==last);if(seen.has(next))continue;seen.add(next);queue.push([...p,next]);}}throw new Error('No route to '+to);}
 await click('[data-building-tab=cityGate]');await wait(`document.querySelector('.atlas-canvas')?.dataset.ready==='true'`);
 for(const target of ['yunjing','starwell',...atlas.cities.filter(c=>c.culture!=='yunhua').map(c=>c.key),'yunjing']){
  for(const next of steps(current,target)){
   await click(`[data-atlas-city=${next}]`);
   if(current==='yunjing'&&next==='starwell')assert(await run(`Boolean(document.querySelector('[data-ferry-route]'))`));
   await click('[data-atlas-travel]');await wait(`document.querySelector('.city-scene .town-model')?.dataset.ready==='true'`);
   const destination=atlas.cities.find(c=>c.key===next);
   assert(await run(`document.querySelector('.location-plaque').textContent.includes(${JSON.stringify(destination.name)})`));
   assert(await run(`Boolean(document.querySelector('[data-building-tab=inn]'))`));
   reached.add(next);current=next;
   if(next==='redsail'){
    await capture('redsail-close-arrival');
    const initialCamera=await run(`JSON.parse(document.querySelector('.town-model').dataset.camera)`);
    assert(initialCamera.height<34,'street camera must frame the central district with most walls outside the viewport');
    for(const kind of ['inn','cityGate']){
     const tabPoint=await run(`(()=>{const r=document.querySelector('[data-building-tab=${kind}]').getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};})()`);
     win.webContents.sendInputEvent({type:'mouseMove',x:5,y:5});
     await new Promise(r=>setTimeout(r,80));
     win.webContents.sendInputEvent({type:'mouseMove',...tabPoint});
     await wait(`document.querySelector('.town-model').dataset.cameraFocus==='${kind}' && document.querySelector('.town-model').dataset.cameraMoving==='false'`);
     const pt=await run(`(()=>{const h=document.querySelector('.town-model'),p=JSON.parse(h.dataset.landmarks)[${JSON.stringify(kind)}],r=h.querySelector('canvas').getBoundingClientRect();return {x:Math.round(r.x+p.x*r.width),y:Math.round(r.y+p.y*r.height)};})()`);
     win.webContents.sendInputEvent({type:'mouseMove',...pt});
     await wait(`document.querySelector('[data-building-tab=${kind}]')?.dataset.active==='true'`);
    }
    await capture('redsail-detail-arrival');
    const focusedCamera=await run(`JSON.parse(document.querySelector('.town-model').dataset.camera)`);
    assert(Math.hypot(focusedCamera.x-initialCamera.x,focusedCamera.y-initialCamera.y)>2,'hover must focus the selected building');
    const canvas=await run(`(()=>{const r=document.querySelector('.town-model canvas').getBoundingClientRect();return {x:Math.round(r.x+r.width*.42),y:Math.round(r.y+r.height*.5)};})()`);
    for(const button of ['left','right']){
     const direction=button==='left'?1:-1;
     const before=await run(`JSON.parse(document.querySelector('.town-model').dataset.camera)`);
     win.webContents.sendInputEvent({type:'mouseMove',...canvas});
     win.webContents.sendInputEvent({type:'mouseDown',button,clickCount:1,...canvas});
     win.webContents.sendInputEvent({type:'mouseMove',x:canvas.x+95*direction,y:canvas.y+55*direction});
     win.webContents.sendInputEvent({type:'mouseUp',button,clickCount:1,x:canvas.x+95*direction,y:canvas.y+55*direction});
     await wait(`document.querySelector('.town-model')?.dataset.cameraMoving==='false'`);
     await new Promise(r=>setTimeout(r,100));
     assert(await run(`Boolean(document.querySelector('.city-scene'))`),'drag must not visit a building');
     const after=await run(`JSON.parse(document.querySelector('.town-model').dataset.camera)`);
     assert(Math.abs(after.x-before.x)>1 && Math.abs(after.y-before.y)>1,'both mouse buttons pan horizontally and vertically');
     assert.equal(after.height,before.height);assert.deepEqual(after.rotation,before.rotation,'drag must not rotate');
    }
    const beforeWheel=await run(`document.querySelector('.town-model').dataset.camera`);
    win.webContents.sendInputEvent({type:'mouseWheel',...canvas,deltaX:0,deltaY:120});
    await new Promise(r=>setTimeout(r,150));
    assert.equal(await run(`document.querySelector('.town-model').dataset.camera`),beforeWheel,'wheel must not zoom or move the town camera');
    await capture('redsail-close-drag');
   }
   if(next==='starwell'){await capture('lake-arrival-starwell');win.reload();await wait(`Boolean(document.querySelector('.welcome .continue'))`);await click('.welcome .continue');await wait(`document.querySelector('.city-scene .town-model')?.dataset.ready==='true'`);assert(await run(`document.querySelector('.location-plaque').textContent.includes('星井城')`));}
   await click('[data-building-tab=cityGate]');await wait(`document.querySelector('.atlas-canvas')?.dataset.ready==='true'`);
  }
 }
 assert.equal(reached.size,16);assert.equal(current,'yunjing');
 assert.deepEqual(errors,[]);console.log('ATLAS PASSED: sixteen actual city arrivals, lake ferry, cross-border roads, save/reload, previews, local/overview cameras and facility raycasts');
 clearTimeout(timeout);app.exit(0);
}).catch(error=>{console.error(error);clearTimeout(timeout);app.exit(1);});
