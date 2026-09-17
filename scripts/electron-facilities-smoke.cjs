const {app,BrowserWindow}=require('electron');
const {mkdtempSync,writeFileSync}=require('node:fs'),{tmpdir}=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
app.setPath('userData',mkdtempSync(path.join(tmpdir(),'ga-facilities-')));
const deadline=setTimeout(()=>app.exit(1),150000);
app.whenReady().then(async()=>{
 const win=new BrowserWindow({show:false,width:1440,height:900,webPreferences:{offscreen:true}});win.webContents.setBackgroundThrottling(false);
 const run=code=>win.webContents.executeJavaScript(code,true).catch(error=>{console.error('Failed browser check:',code);throw error}),pause=ms=>new Promise(r=>setTimeout(r,ms)),errors=[];
 win.webContents.on('console-message',d=>{if(d.level==='error')errors.push(d.message)});
 const wait=async code=>{for(let i=0;i<700;i++){if(await run(code))return;await pause(30)}throw Error('Timeout '+code+' '+await run('document.body.innerText'))};
 const shot=async name=>{await pause(100);win.webContents.invalidate();writeFileSync(path.resolve('dist/facility-'+name+'.png'),(await win.webContents.capturePage()).toPNG())};
 const layout=async()=>{
  const overflow=await run(`(()=>{const selectors=['.window-surface','.surface-content','.facility-browser','.facility-columns','.facility-detail','.facility-detail-body','.facility-choices'];return selectors.flatMap(s=>[...document.querySelectorAll(s)].filter(e=>e.getBoundingClientRect().width>0&&e.scrollWidth>e.clientWidth+2).map(e=>({s,w:e.clientWidth,scroll:e.scrollWidth})))})()`);
  assert.deepEqual(overflow,[],'facility panes never overflow horizontally');
  assert(await run(`(()=>{const list=document.querySelector('.facility-choices');return !list||(getComputedStyle(list).scrollbarWidth==='none'&&list.clientHeight>0)})()`),'list has a bounded viewport and hidden scrollbar');
  assert(await run(`(()=>{const b=document.querySelector('.window-back').getBoundingClientRect(),w=document.querySelector('.window-surface').getBoundingClientRect();return b.left>=w.left&&b.right<=w.right&&b.top>=w.top-b.height/2-1&&b.bottom<=w.bottom})()`),'back button straddles the upper-right frame corner');
  if(await run(`Boolean(document.querySelector('[data-facility-confirm]'))`))assert(await run(`(()=>{const b=document.querySelector('[data-facility-confirm]').getBoundingClientRect(),w=(document.querySelector('.reception-confirmation')??document.querySelector('.facility-detail')).getBoundingClientRect();return b.bottom<=w.bottom+1&&b.right<=w.right+1&&b.top>=w.top})()`),'confirmation remains visible inside details');
 };
 await win.loadFile(path.resolve('dist/renderer/index.html'));
 await wait(`Boolean(document.querySelector('.welcome form'))`);
 await run(`document.querySelector('input[name=seed]').value='ui-regression';document.querySelector('.welcome form').requestSubmit()`);
 await wait(`document.querySelector('.town-model')?.dataset.ready==='true'`);
 const tabs=await run(`Array.from(document.querySelectorAll('[data-building-tab]')).map(e=>e.dataset.buildingTab)`);console.log('FACILITIES',tabs);
 for(const kind of tabs.filter(k=>k!=='cityGate')){
  await run(`document.querySelector('[data-building-tab="${kind}"]').click()`);
  await wait(`Boolean(document.querySelector('.window-surface'))`);
  if(await run(`Boolean(document.querySelector('[data-facility-choice]'))`)){
   const before=await run(`localStorage.getItem('greeting-adventurer.save.v1')`);
   await run(`document.querySelector('[data-facility-choice]').click()`);await wait(`Boolean(document.querySelector('[data-facility-confirm]'))`);
   assert.equal(await run(`localStorage.getItem('greeting-adventurer.save.v1')`),before,'inspect entry does not execute a command');
  }
  assert.equal(await run(`Boolean(document.querySelector('.facility-tools input'))`),false,'search removed');
  assert.equal(await run(`Boolean(document.querySelector('.facility-pagination'))`),false,'pagination removed');
  assert(await run(`(()=>{const p=document.querySelector('.reception-title').getBoundingClientRect(),w=document.querySelector('.window-surface').getBoundingClientRect();return Math.abs((p.top+p.bottom)/2-w.top)<2&&Math.abs((p.left+p.right-w.left-w.right)/2)<2})()`),'title plaque centered halfway across top edge');
  await layout();await shot(kind);
  if(kind==='adventurerGuild'){
   assert(await run(`Boolean(document.querySelector('[data-art-theme=guild]'))`),'guild uses the illustrated presentation');
   const surfaces=await run(`(()=>{const selectors=['.window-surface','.facility-detail','.facility-categories button','.facility-choice','[data-facility-confirm]','.window-back button'];return selectors.map(s=>({selector:s,url:getComputedStyle(document.querySelector(s)).backgroundImage}))})()`);
   for(const surface of surfaces){assert(surface.url.includes('url('),'painted surface '+surface.selector);assert(await run(`new Promise(resolve=>{const img=new Image();img.onload=()=>resolve(img.naturalWidth>0);img.onerror=()=>resolve(false);img.src=${JSON.stringify(surface.url.match(/url\("([^"]+)"\)/)[1])}})`),'art asset loads '+surface.selector)}
   assert.equal(await run(`getComputedStyle(document.querySelector('[data-facility-confirm]')).color`),'rgb(255, 240, 209)','action text stays light on dark lacquer');
   await run(`document.querySelector('.facility-categories button').click()`);await wait(`document.querySelector('.facility-reception')?.dataset.expression==='sad'`);await layout();await shot('guild-empty');
   await run(`document.querySelector('.facility-categories button:last-child').click()`);await wait(`Boolean(document.querySelector('[data-facility-choice]'))`);
   await run(`document.querySelector('[data-facility-choice]').click()`);await layout();await shot('guild-full-page');
   await run(`document.querySelector('.facility-choices').scrollTop=document.querySelector('.facility-choices').scrollHeight`);await layout();await shot('guild-scrolled');
  }
  win.setSize(800,600);await pause(100);await layout();win.setSize(1440,900);await pause(100);
  await run(`document.querySelector('.window-back button').click()`);
 }
 await run(`document.querySelector('[data-building-tab=equipmentShop]').click()`);
 await run(`Array.from(document.querySelectorAll('[data-facility-choice]')).find(b=>b.textContent.includes('環首短刀')).scrollIntoView({block:'nearest'})`);
 await run(`Array.from(document.querySelectorAll('[data-facility-choice]')).find(b=>b.textContent.includes('環首短刀')).click()`);
 const beforeBuy=await run(`localStorage.getItem('greeting-adventurer.save.v1')`);
 await run(`document.querySelector('[data-facility-confirm]').click()`);
 await wait(`!document.querySelector('[data-facility-confirm]')`);
 assert.notEqual(await run(`localStorage.getItem('greeting-adventurer.save.v1')`),beforeBuy,'explicit purchase commits a real transaction');
 await run(`Array.from(document.querySelectorAll('.facility-categories button')).find(b=>b.textContent.includes('出售')).click()`);
 await wait(`Boolean(document.querySelector('[data-facility-choice]'))`);
 await run(`document.querySelector('[data-facility-choice]').click()`);
 const beforeSell=await run(`localStorage.getItem('greeting-adventurer.save.v1')`);
 await run(`document.querySelector('[data-facility-confirm]').click()`);
 await wait(`!document.querySelector('[data-facility-confirm]')`);
 assert.notEqual(await run(`localStorage.getItem('greeting-adventurer.save.v1')`),beforeSell,'sell uses a separate explicit transaction');
 await run(`document.querySelector('.window-back button').click();document.querySelector('[data-building-tab=inn]').click()`);
 const beforeRest=await run(`localStorage.getItem('greeting-adventurer.save.v1')`);
 await run(`document.querySelector('[data-reception-rest]').click()`);
 await wait(`document.querySelector('.facility-reception')?.dataset.expression==='happy'`);
 assert.notEqual(await run(`localStorage.getItem('greeting-adventurer.save.v1')`),beforeRest,'confirmed inn rest advances the real game');
 await run(`document.querySelector('.window-back button').click()`);
 await wait(`!document.querySelector('.facility-reception')`);
 await run(`document.querySelector('[data-building-tab=inn]').click()`);
 await wait(`document.querySelector('.facility-reception')?.dataset.expression==='normal'`);
 await run(`document.querySelector('.window-back button').click();document.querySelector('[data-building-tab=adventurerGuild]').click()`);
 await wait(`Boolean(document.querySelector('[data-facility-choice]'))`);
 await run(`document.querySelector('[data-facility-choice]').click()`);
 const beforeQuest=await run(`localStorage.getItem('greeting-adventurer.save.v1')`);
 await run(`document.querySelector('[data-facility-confirm]').click()`);
 assert.notEqual(await run(`localStorage.getItem('greeting-adventurer.save.v1')`),beforeQuest,'quest acceptance is explicitly confirmed');
 await wait(`document.querySelector('.facility-reception')?.dataset.expression==='happy'`);
 assert.deepEqual(errors,[]);console.log('FACILITY UI PASSED: nine facility windows, inspect before action, 800/1440 layout, purchase, sale, rest and quest acceptance');
 clearTimeout(deadline);win.destroy();app.quit();
}).catch(e=>{console.error(e);clearTimeout(deadline);app.exit(1)});


