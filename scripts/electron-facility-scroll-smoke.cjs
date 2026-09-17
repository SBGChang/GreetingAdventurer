const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
app.setPath('userData',fs.mkdtempSync(path.join(os.tmpdir(),'ga-scroll-')));
const deadline=setTimeout(()=>app.exit(1),60000);
app.whenReady().then(async()=>{
 const win=new BrowserWindow({show:false,width:1440,height:900,webPreferences:{offscreen:true}});
 win.webContents.setBackgroundThrottling(false);
 const run=code=>win.webContents.executeJavaScript(code,true),pause=ms=>new Promise(r=>setTimeout(r,ms));
 const errors=[];win.webContents.on('console-message',d=>{if(d.level==='error')errors.push(d.message)});
 await win.loadFile(path.resolve('dist/renderer/facility-art.html'));
 for(let i=0;i<100&&!await run(`Boolean(document.querySelector('.facility-choices'))`);i++)await pause(30);
 const selected=()=>run(`document.querySelector('.facility-choice[aria-pressed=true]')?.textContent??null`);
 const top=()=>run(`document.querySelector('.facility-choices').scrollTop`);
 for(const width of [1440,800]){
  win.setSize(width,width===800?600:900);await pause(150);
  await run(`document.querySelector('.facility-choices').scrollTop=0;document.querySelector('.facility-choice').click()`);
  const before=await selected();
  assert.equal(await run(`document.querySelectorAll('.facility-choice').length`),12,'all fixture items are in one list');
  assert.equal(await run(`Boolean(document.querySelector('.facility-pagination'))`),false);
  assert.equal(await run(`getComputedStyle(document.querySelector('.facility-choices')).scrollbarWidth`),'none');
  const rect=await run(`(()=>{const e=document.querySelector('.facility-choices'),r=e.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,scale:e.clientHeight/r.height}})()`);
  const x=Math.round(rect.x+rect.w/2),y=Math.round(rect.y+rect.h*.65),distance=Math.round(rect.h*.4);
  win.webContents.sendInputEvent({type:'mouseDown',button:'left',x,y,clickCount:1});await pause(220);
  for(let step=1;step<=10;step++){win.webContents.sendInputEvent({type:'mouseMove',x,y:y-Math.round(distance*step/10)});await pause(12)}
  win.webContents.sendInputEvent({type:'mouseUp',button:'left',x,y:y-distance,clickCount:1});await pause(100);
  assert(Math.abs(await top()-distance*rect.scale)<5,'drag follows pointer at stage scale '+width);
  assert.equal(await selected(),before,'dragging across buttons never selects them');
  assert.equal(await run(`Boolean(document.querySelector('.facility-choices[data-dragging]'))`),false,'release ends drag');
  // A fresh short click still inspects, without confirming the fixture action.
  const target=await run(`(()=>{const l=document.querySelector('.facility-choices').getBoundingClientRect();const b=[...document.querySelectorAll('.facility-choice')].find(e=>{const r=e.getBoundingClientRect();return r.top>l.top&&r.bottom<l.bottom});const r=b.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2),name:b.textContent}})()`);
  win.webContents.sendInputEvent({type:'mouseDown',button:'left',x:target.x,y:target.y,clickCount:1});
  win.webContents.sendInputEvent({type:'mouseUp',button:'left',x:target.x,y:target.y,clickCount:1});await pause(100);
  assert.equal(await selected(),target.name,'short click after drag selects the intended entry');
  const beforeWheel=await top();win.webContents.sendInputEvent({type:'mouseWheel',x,y,deltaY:-90,deltaX:0,canScroll:true});await pause(250);
  assert(await top()>beforeWheel,'wheel also scrolls the same list');
  await run(`document.querySelector('.facility-choices').focus()`);
  win.webContents.sendInputEvent({type:'keyDown',keyCode:'End'});win.webContents.sendInputEvent({type:'keyUp',keyCode:'End'});await pause(350);
  assert(await run(`(()=>{const l=document.querySelector('.facility-choices'),r=l.getBoundingClientRect(),last=l.lastElementChild.getBoundingClientRect();return last.bottom<=r.bottom+1&&last.top>=r.top})()`),'keyboard can reach the final item');
  await run(`document.querySelector('.facility-choices').scrollTop=0`);
  win.webContents.sendInputEvent({type:'mouseDown',button:'left',x,y,clickCount:1});
  win.webContents.sendInputEvent({type:'mouseMove',x,y:y-distance});await pause(40);
  await run(`window.dispatchEvent(new Event('blur'))`);
  const atBlur=await top();win.webContents.sendInputEvent({type:'mouseMove',x,y:y-distance-20});await pause(40);
  assert.equal(await top(),atBlur,'window blur cancels dragging');
  win.webContents.sendInputEvent({type:'mouseUp',button:'left',x,y:y-distance-20,clickCount:1});
  fs.writeFileSync('dist/facility-scroll-'+width+'.png',(await win.webContents.capturePage()).toPNG());
 }
 assert.equal(await run('localStorage.length'),0);assert.deepEqual(errors,[]);
 console.log('FACILITY SCROLL PASSED: 800/1440 drag, no accidental selection, short click, wheel, keyboard end, blur cleanup and isolated preview');
 clearTimeout(deadline);win.destroy();app.quit();
}).catch(error=>{console.error(error);clearTimeout(deadline);app.exit(1)});
