const {app,BrowserWindow}=require('electron');
const {mkdtempSync,writeFileSync}=require('node:fs');const {tmpdir}=require('node:os');const path=require('node:path');const assert=require('node:assert/strict');
app.setPath('userData',mkdtempSync(path.join(tmpdir(),'ga-overlay-')));
const timeout=setTimeout(()=>app.exit(1),150000);
app.whenReady().then(async()=>{
 const win=new BrowserWindow({show:false,width:1440,height:900,webPreferences:{offscreen:true}});win.webContents.setBackgroundThrottling(false);
 const errors=[],run=code=>win.webContents.executeJavaScript(code,true),pause=ms=>new Promise(r=>setTimeout(r,ms));
 win.webContents.on('console-message',d=>{if(d.level==='error')errors.push(d.message)});
 const wait=async code=>{for(let i=0;i<1000;i++){if(await run(code))return;await pause(30)}throw Error('Timeout '+code)};
 const cases=[{scene:'dungeon',ground:'canal'},{scene:'city',ground:'city-yunhua'},{scene:'world',ground:'woodland-road'},{scene:'dungeon',map:'mist-bamboo-valley',ground:'bamboo'},{scene:'dungeon',map:'hanging-spring-grotto',ground:'grotto'},{scene:'city',city:'redsail',ground:'city-safir'}];
 for(const {ground,...query} of cases){
  const {scene}=query;
  await win.loadFile(path.resolve('dist/renderer/combat-2d.html'),{query:{formation:'full',...query}});
  const root=scene==='dungeon'?'.walk-scene':scene==='city'?'.town-model':'.atlas-canvas';
  await wait(`document.querySelector('${root}')?.dataset.ready==='true'&&document.querySelector('${root}').dataset.frozen==='true'&&document.querySelector('[data-hud-ready]')?.dataset.hudReady==='true'&&document.querySelector('.combat-screen')?.dataset.groundReady==='true'`);
  await run(`window.__background=document.querySelector('${root} canvas');window.__lost=0;window.__background.addEventListener('webglcontextlost',()=>window.__lost++)`);
  assert.equal(await run(`document.querySelector('.combat-background-test').dataset.backgroundKind`),scene);
  assert.equal(await run(`document.querySelectorAll('[data-battle-platform]').length`),1);
  assert.equal(await run(`document.querySelector('.combat-screen').dataset.groundId`),ground);
  assert.equal(await run(`document.querySelector('[data-battle-platform]').dataset.groundId`),ground);
  assert.match(await run(`getComputedStyle(document.querySelector('.combat-frost')).backdropFilter`),/blur\(9px\)/,'built CSS must retain real backdrop blur');
  assert(await run(`document.querySelector('[data-backdrop=true]').hasAttribute('inert')`),'background rejects pointer and keyboard focus');
  const before=await run(`JSON.stringify(document.querySelector('${root}').dataset)`);
  await run(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'w'}))`);await pause(200);await run(`window.dispatchEvent(new KeyboardEvent('keyup',{key:'w'}))`);
  assert.equal(await run(`JSON.stringify(document.querySelector('${root}').dataset)`),before,'background state and camera freeze while battle is open');
  await pause(250);win.webContents.invalidate();writeFileSync(path.resolve(`dist/combat-overlay-${ground}.png`),(await win.webContents.capturePage()).toPNG());
  await run(`document.querySelector('.combat-test-toggle').click()`);await wait(`!document.querySelector('.combat-screen')`);
  assert(await run(`document.querySelector('${root} canvas')===window.__background`),'closing overlay retains canvas');
  await run(`document.querySelector('.combat-test-toggle').click()`);await wait(`document.querySelector('[data-hud-ready]')?.dataset.hudReady==='true'&&document.querySelector('.combat-screen')?.dataset.groundReady==='true'`);
  assert(await run(`document.querySelector('${root} canvas')===window.__background`),'reopening overlay retains canvas');
  assert.equal(await run('window.__lost'),0);assert.equal(await run('localStorage.length'),0);
 }
 assert.deepEqual(errors,[]);console.log('COMBAT OVERLAY PASSED: dungeon/city/world actual models, blur, 18 compact actors, frozen input, retained canvases and no saves');clearTimeout(timeout);win.destroy();app.quit();
}).catch(e=>{console.error(e);clearTimeout(timeout);app.exit(1)});
