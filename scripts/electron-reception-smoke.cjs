const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const catalog=JSON.parse(fs.readFileSync('content/presentation/facilities.json','utf8').replace(/^\uFEFF/,''));
app.setPath('userData',fs.mkdtempSync(path.join(os.tmpdir(),'ga-reception-')));
const deadline=setTimeout(()=>app.exit(1),180000);
app.whenReady().then(async()=>{
 const win=new BrowserWindow({show:false,width:1440,height:900,webPreferences:{offscreen:true}});win.webContents.setBackgroundThrottling(false);const errors=[];
 win.webContents.on('console-message',d=>{if(d.level==='error')errors.push(d.message)});
 const run=code=>win.webContents.executeJavaScript(code,true).catch(error=>{console.error('FAILED EXPRESSION',code,errors);throw error}),pause=ms=>new Promise(r=>setTimeout(r,ms));
 const wait=async code=>{for(let i=0;i<400;i++){if(await run(code))return;await pause(25)}throw Error('Timeout: '+code)};
 const shot=async name=>{await pause(75);win.webContents.invalidate();fs.writeFileSync('dist/reception-'+name+'.png',(await win.webContents.capturePage()).toPNG())};
 await win.loadFile(path.resolve('dist/renderer/facility-art.html'));await wait(`Boolean(document.querySelector('.reception-portrait'))`);
 assert.equal(await run('localStorage.length'),0);
 for(const p of catalog.facilities){
  await run(`(()=>{const e=document.querySelector('select');e.value=${JSON.stringify(p.id)};e.dispatchEvent(new Event('change',{bubbles:true}))})()`);
  await wait(`document.querySelector('[data-reception]')?.dataset.reception===${JSON.stringify(p.id)}`);
  if(p.kind==='home')await shot(p.id+'-empty');
  await run(`document.querySelector('[data-facility-choice]').click()`);
  const detailUrl=await run(`getComputedStyle(document.querySelector('.facility-detail')).backgroundImage.slice(5,-2)`);
  assert(detailUrl.includes('-details'),'facility uses a dedicated painted detail atlas '+p.id);
  assert(await run(`new Promise(resolve=>{const image=new Image();image.onload=()=>resolve(image.naturalWidth>0);image.onerror=()=>resolve(false);image.src=${JSON.stringify(detailUrl)}})`),'detail atlas loads '+p.id);
  assert(await run(`(()=>{const b=document.querySelector('.facility-detail-body').getBoundingClientRect(),p=document.querySelector('.facility-detail').getBoundingClientRect();return b.left>p.left&&b.right<p.right&&b.top>p.top&&b.bottom<p.bottom&&b.width>150&&b.height>120})()`),'live content stays within the art safe area '+p.id);
  const artUrl=await run(`getComputedStyle(document.querySelector('.reception-portrait')).backgroundImage.slice(5,-2)`);
  assert(await run(`new Promise(resolve=>{const image=new Image();image.onload=()=>resolve(image.naturalWidth>=1024);image.onerror=()=>resolve(false);image.src=${JSON.stringify(artUrl)}})`),'portrait loads '+p.id);
  for(const [event,expression] of [['welcome','normal'],['accepted','happy'],['rejected','angry'],['failed','sad']]){
   await run(`document.querySelector('[data-preview-expression=${event}]').click()`);
   await wait(`document.querySelector('.facility-reception').dataset.expression==='${expression}'`);
   if(p.kind==='adventurerGuild')await shot(p.id+'-'+expression);
  }
  assert(await run(`getComputedStyle(document.querySelector('[data-facility-choice]')).backgroundImage.includes('service-button')`),'all cultures use the neutral button asset');
  const dialogueUrl=await run(`getComputedStyle(document.querySelector('.reception-dialogue'),'::before').borderImageSource.slice(5,-2)`);
  assert(dialogueUrl.includes(p.cultureId.split('.')[1]+'-dialogue'),'cultural dialogue frame '+p.id);
  assert(await run(`new Promise(resolve=>{const image=new Image();image.onload=()=>resolve(image.naturalWidth>0);image.onerror=()=>resolve(false);image.src=${JSON.stringify(dialogueUrl)}})`),'dialogue frame loads');
  assert(await run(`(()=>{const d=document.querySelector('.reception-dialogue').getBoundingClientRect(),b=document.querySelector('.reception-dialogue-body').getBoundingClientRect(),o=document.querySelector('.reception-options').getBoundingClientRect();return b.left>d.left&&b.right<d.right&&b.top>d.top&&b.bottom<d.bottom&&d.bottom<=o.top+1})()`),'dialogue stays inside its frame and above options '+p.id);

  const overlap=await run(`(()=>{const host=document.querySelector('.facility-reception').getBoundingClientRect(),content=document.querySelector('.surface-content').getBoundingClientRect(),button=document.querySelector('[data-facility-confirm]').getBoundingClientRect();return host.right>content.left||button.bottom>host.bottom+1||button.left<host.left-1||button.right>host.right+1})()`);
  assert.equal(overlap,false,'host and commands fit beside content '+p.id);
  assert(await run(`(()=>{const elements=['.facility-categories','.facility-reception','.facility-detail','.facility-columns'];return elements.every(s=>{const e=document.querySelector(s);return e.scrollWidth<=e.clientWidth+2})})()`),'no horizontal overflow '+p.id);
  if(p.kind==='inn'||p.kind==='equipmentShop'||p.kind==='cityGate'||p.kind==='home')await shot(p.id);
  console.log('RECEPTION CHECKED',p.id);
 }
 win.setSize(800,600);await pause(150);await shot('800');assert(await run(`document.querySelector('.game-stage').getBoundingClientRect().right<=innerWidth+1`));
 // Exercise a long dialogue at the smallest supported viewport using real pointer input.
 await run(`document.querySelector('.reception-dialogue-body p').textContent='長篇接待對話，內容應在框內捲動，不遮擋玩家選項。'.repeat(30)`);
 const d=await run(`(()=>{const e=document.querySelector('.reception-dialogue-body'),r=e.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.bottom-5),distance:Math.round(r.height*.6)}})()`);
 win.webContents.sendInputEvent({type:'mouseDown',button:'left',x:d.x,y:d.y,clickCount:1});await pause(200);
 win.webContents.sendInputEvent({type:'mouseMove',x:d.x,y:d.y-d.distance});await pause(50);
 win.webContents.sendInputEvent({type:'mouseUp',button:'left',x:d.x,y:d.y-d.distance,clickCount:1});await pause(50);
 assert(await run(`document.querySelector('.reception-dialogue-body').scrollTop>0`),'long dialogue can be dragged');
 assert.equal(await run(`getComputedStyle(document.querySelector('.reception-dialogue-body')).scrollbarWidth`),'none');
 await run(`document.querySelector('[data-preview-expression=accepted]').click()`);await pause(80);
 assert.equal(await run(`document.querySelector('.reception-dialogue-body').scrollTop`),0,'new dialogue starts from top');
 // Contact sheets are browser-rendered galleries of original assets, not modified image files.
 win.setSize(1440,900);
 for(const culture of ['yunhua','vildun','aurelien','safir']){
  const people=catalog.facilities.filter(p=>p.cultureId==='culture.'+culture);
  const urls=[];for(const p of people){await run(`(()=>{const e=document.querySelector('select');e.value=${JSON.stringify(p.id)};e.dispatchEvent(new Event('change',{bubbles:true}))})()`);await pause(30);urls.push(await run(`getComputedStyle(document.querySelector('.reception-portrait')).backgroundImage`));}
  await run(`(()=>{const layer=document.createElement('div');layer.id='gallery';Object.assign(layer.style,{position:'fixed',inset:'0',zIndex:'9999',background:'#172522',display:'grid',gridTemplateColumns:'repeat(5,1fr)',gap:'12px',padding:'24px'});const people=${JSON.stringify(people.map(p=>({name:p.name['zh-Hant'],host:p.host.name['zh-Hant']})))};const urls=${JSON.stringify(urls)};people.forEach((p,i)=>{const tile=document.createElement('div');const image=document.createElement('div');Object.assign(image.style,{height:'290px',backgroundImage:urls[i],backgroundSize:'200% 200%',backgroundPosition:'0% 0%'});const title=document.createElement('p');title.textContent=p.name+' · '+p.host;Object.assign(title.style,{color:'#ffe8b9',fontSize:'18px',textAlign:'center'});tile.append(image,title);layer.append(tile)});document.body.append(layer)})()`);for(const [expression,position] of [['normal','0% 0%'],['happy','100% 0%'],['angry','0% 100%'],['sad','100% 100%']]){await run(`document.querySelectorAll('#gallery > div > div').forEach(e=>e.style.backgroundPosition=${JSON.stringify(position)})`);await shot('gallery-'+culture+'-'+expression)}await run(`document.querySelectorAll('#gallery > div > div').forEach(e=>{e.style.backgroundSize='100% 100%';e.style.backgroundPosition='0% 0%'})`);await shot('sheets-'+culture);await run(`document.getElementById('gallery').remove()`);
 }
 assert.equal(await run('localStorage.length'),0,'preview never touches player saves');assert.deepEqual(errors,[]);console.log('RECEPTION UI PASSED: 40 distinct facilities, 160 expression transitions, dialogue confirmation, 800/1440 layout, isolated preview');clearTimeout(deadline);win.destroy();app.quit();
}).catch(error=>{console.error(error);clearTimeout(deadline);app.exit(1)});

