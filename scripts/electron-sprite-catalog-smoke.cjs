const {app,BrowserWindow}=require('electron');
const {readFileSync,mkdtempSync,writeFileSync}=require('node:fs');
const {tmpdir}=require('node:os');
const path=require('node:path');
const assert=require('node:assert/strict');
const sheets=JSON.parse(readFileSync('content-source/combat-sprite-sheets.json','utf8')).sheets;
app.setPath('userData',mkdtempSync(path.join(tmpdir(),'ga-sprite-catalog-')));
const timeout=setTimeout(()=>{console.error('Sprite catalog timed out');app.exit(1)},Math.max(180000,sheets.length*5000));
app.whenReady().then(async()=>{
 const win=new BrowserWindow({show:false,width:1440,height:1000,webPreferences:{offscreen:true}});
 win.webContents.setBackgroundThrottling(false);
 const errors=[];win.webContents.on('console-message',d=>{if(d.level==='error')errors.push(d.message)});
 const run=c=>win.webContents.executeJavaScript(c,true);
 const pause=ms=>new Promise(r=>setTimeout(r,ms));
 const wait=async code=>{for(let i=0;i<200;i++){if(await run(code))return;await pause(25)}throw Error('Timeout '+code)};
 let frames=0;
 for(const sheet of sheets){
  await win.loadFile(path.resolve('dist/renderer/combat-sprites.html'),{query:{skin:sheet.skin}});
  await wait("document.querySelector('main')?.dataset.ready==='true'");
  const profile=JSON.parse(readFileSync(`app/assets/combat/sprites/${sheet.skin}/profile.json`,'utf8'));
  for(const {id:action,frames:poses} of profile.clips){
   await run(`document.querySelector('[data-action="${action}"]').click()`);
   const hashes=[];
   for(let i=0;i<poses.length;i++){
    await run(`document.querySelector('[data-pose="${i}"]').click()`);
    await wait(`document.querySelector('[data-sprite-frame]')?.dataset.spriteFrame==='${i}'`);
    const stats=await run(`(()=>{const c=document.querySelector('.sprite-actor'),p=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let solid=0,clear=0,magenta=0,hash=0;for(let i=0;i<p.length;i+=4){if(p[i+3]===0)clear++;if(p[i+3]>200){solid++;if(p[i]>220&&p[i+2]>220&&p[i+1]<65)magenta++}hash=(Math.imul(hash,31)+p[i]+p[i+1]+p[i+2]+p[i+3])|0}return {solid,clear,magenta,hash}})()`);
    assert(stats.solid>10000,`${sheet.skin}/${action}/${i}: invisible sprite`);
    assert(stats.clear>500000,'transparent surround');
    assert(stats.magenta<40,'magenta backdrop removed');
    hashes.push(stats.hash);frames++;
   }
   assert(new Set(hashes).size>=4,`${sheet.skin}/${action}: insufficient distinct frames`);
  }
  await run("document.querySelector('[data-action=attack]').click();document.querySelector('[data-pose=\"3\"]').click()");
  await pause(50);win.webContents.invalidate();
  writeFileSync(path.resolve(`dist/sprite-review-${sheet.skin}.png`),(await win.webContents.capturePage()).toPNG());
  assert.equal(await run('localStorage.length'),0);
 }
 assert.deepEqual(errors,[]);
 console.log(`SPRITE CATALOG PASSED: ${sheets.length} profiles, ${frames} frames, chroma compositing, distinct poses, isolated preview.`);
 clearTimeout(timeout);win.destroy();app.quit();
}).catch(e=>{console.error(e);clearTimeout(timeout);app.exit(1)});
