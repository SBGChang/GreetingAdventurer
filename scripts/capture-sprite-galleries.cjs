const {app,BrowserWindow}=require('electron');
const {mkdtempSync,writeFileSync}=require('node:fs');
const path=require('node:path'),{tmpdir}=require('node:os');
app.setPath('userData',mkdtempSync(path.join(tmpdir(),'ga-gallery-')));
app.whenReady().then(async()=>{
 const win=new BrowserWindow({show:false,width:1440,height:1000,webPreferences:{offscreen:true}});
 win.webContents.setBackgroundThrottling(false);
 const pause=ms=>new Promise(r=>setTimeout(r,ms));
 const jobs=[...Array.from({length:5},(_,page)=>({catalog:'monsters',page:String(page)})),...['blade','polearm','heavyblade','throwing','bow','crossbow','wand','staff','wind','strings','percussion','sword-shield','tower-shield','dual','unarmed','shield'].map(motion=>({catalog:'characters',motion}))];
 for(const query of jobs){
  await win.loadFile(path.resolve('dist/renderer/combat-sprites.html'),{query});
  for(let n=0;n<200;n++){if(await win.webContents.executeJavaScript("document.querySelector('main')?.dataset.ready==='true'"))break;if(n===199)throw Error(JSON.stringify(query));await pause(25)}
  win.webContents.invalidate();await pause(120);
  writeFileSync(path.resolve(`dist/sprite-gallery-${query.catalog}-${query.motion??query.page}.png`),(await win.webContents.capturePage()).toPNG());
 }
 win.destroy();app.quit();
}).catch(e=>{console.error(e);app.exit(1)});
