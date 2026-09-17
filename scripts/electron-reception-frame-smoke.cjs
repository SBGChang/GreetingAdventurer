const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
app.setPath('userData',fs.mkdtempSync(path.join(os.tmpdir(),'ga-frame-')));
const deadline=setTimeout(()=>app.exit(1),60000);
app.whenReady().then(async()=>{
 const win=new BrowserWindow({show:false,width:1440,height:900,webPreferences:{offscreen:true}});win.webContents.setBackgroundThrottling(false);
 const run=code=>win.webContents.executeJavaScript(code,true),pause=ms=>new Promise(r=>setTimeout(r,ms));
 await win.loadFile(path.resolve('dist/renderer/facility-art.html'),{query:{facility:'yunhua-home'}});
 for(let i=0;i<100&&!await run(`Boolean(document.querySelector('.reception-frame'))`);i++)await pause(30);
 for(const [name,width,height] of [['default',1300,634],['wide',1350,530],['tall',1080,670]]){
  await run(`(()=>{const e=document.querySelector('.reception-window');e.style.setProperty('width','${width}px','important');e.style.setProperty('height','${height}px','important')})()`);await pause(100);
  const frame=await run(`(()=>{const e=document.querySelector('.reception-frame'),s=getComputedStyle(e),r=e.getBoundingClientRect();return {slice:s.borderImageSlice,width:s.borderImageWidth,background:s.backgroundImage,fill:s.backgroundColor,w:r.width,h:r.height,source:s.borderImageSource,repeat:s.borderImageRepeat}})()`);
  assert.equal(frame.slice,'20%','the center is not filled by the source image');
  assert.equal(frame.width,'72px','corner size is invariant across aspect ratios');
  assert.equal(frame.repeat,'round','ornamental edge strips repeat instead of stretching across the entire frame');
  assert.equal(frame.background,'none');assert.equal(frame.fill,'rgb(222, 205, 173)');
  assert(frame.source.includes('yunhua-home-frame'));assert.equal(Math.round(frame.w),width);assert.equal(Math.round(frame.h),height);
  assert(await run(`new Promise(resolve=>{const im=new Image();im.onload=()=>resolve(im.naturalWidth===im.naturalHeight);im.onerror=()=>resolve(false);im.src=${JSON.stringify(frame.source.slice(5,-2))}})`));
  fs.writeFileSync('dist/reception-frame-'+name+'.png',(await win.webContents.capturePage()).toPNG());
 }
 await run(`(()=>{const e=document.querySelector('select');e.value='vildun-home';e.dispatchEvent(new Event('change',{bubbles:true}))})()`);await pause(50);
 assert.equal(await run(`Boolean(document.querySelector('.reception-frame'))`),false,'prototype is scoped to Yunhua home');
 assert.equal(await run('localStorage.length'),0);
 clearTimeout(deadline);win.destroy();app.quit();console.log('NINE SLICE PASSED: three aspect ratios, fixed corners, flat center, scoped fixture');
}).catch(error=>{console.error(error);clearTimeout(deadline);app.exit(1)});
