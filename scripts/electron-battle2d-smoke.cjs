const {openCombatCommands}=require('./lib/combat-commands.cjs');
const {app,BrowserWindow}=require('electron');
const {mkdtempSync,writeFileSync}=require('node:fs');const {tmpdir}=require('node:os');const path=require('node:path');const assert=require('node:assert/strict');
app.setPath('userData',mkdtempSync(path.join(tmpdir(),'ga-battle2d-')));
const timeout=setTimeout(()=>app.exit(1),180000);
app.whenReady().then(async()=>{
 const win=new BrowserWindow({show:false,width:1440,height:900,webPreferences:{offscreen:true}});win.webContents.setBackgroundThrottling(false);
 const errors=[],run=async code=>{try{return await win.webContents.executeJavaScript(code,true)}catch(e){console.error('FAILED SCRIPT',code);throw e}},pause=ms=>new Promise(r=>setTimeout(r,ms));
 win.webContents.on('console-message',d=>{if(d.level==='error'){errors.push(d.message);console.error('RENDERER',d.message)}});
 const wait=async code=>{for(let i=0;i<600;i++){if(await run(code))return;await pause(30)}throw Error('Timeout '+code+' '+await run('document.body.innerText'))};
 const capture=async name=>{win.webContents.invalidate();await pause(70);writeFileSync(path.resolve('dist/'+name+'.png'),(await win.webContents.capturePage()).toPNG())};
 await win.loadFile(path.resolve('dist/renderer/combat-2d.html'),{query:process.env.BATTLE_APPEARANCE?{appearance:process.env.BATTLE_APPEARANCE}:{}});
 await wait(`document.querySelector('.combat-sprite-arena')?.dataset.ready==='true'&&document.querySelector('[data-hud-ready]')?.dataset.hudReady==='true'&&document.querySelector('.combat-screen')?.dataset.groundReady==='true'`);
 assert.equal(await run(`document.querySelectorAll('[data-sprite-unit]').length`),4);
 await capture('battle2d-ready');
 const initialDelays=await run(`Array.from(document.querySelectorAll('[data-delay-id]')).map(e=>[e.dataset.delayId,e.dataset.ctb])`);
 let attacks=0;
 for(let turn=0;turn<35;turn++){
  await wait(`document.querySelector('.combat-screen')?.dataset.playing==='false'`);
  if(await run(`Boolean(document.querySelector('.combat-result'))`))break;
  await wait(`Boolean(document.querySelector('.combat-command-overlay'))`);
  assert.equal(await run(`document.querySelectorAll('[data-delay-id]').length`),await run(`document.querySelectorAll('[data-combat-side][data-alive=true]').length`),'all living combatants have CTB');
  assert(await run(`document.querySelector('[data-delay-id]')?.dataset.current==='true'`),'current actor leads the committed delay order');
  if(turn===1){
   await openCombatCommands(run,wait);await run(`document.querySelector('[data-combat-rest]').click()`);
   await wait(`document.querySelector('.combat-screen').dataset.playing==='true'`);await pause(200);
   assert.equal(await run(`document.querySelector('.sprite-battle-unit[data-side=player]').dataset.pose`),'idle','rest does not swing a weapon');
   await wait(`document.querySelector('.combat-screen').dataset.playing==='false'`);continue;
  }
  await openCombatCommands(run,wait);await run(`document.querySelector('.combat-skill-tile[data-skill-id]:enabled').click()`);
  if(turn===0){
   await run(`document.querySelector('[data-combat-side=player]').click()`);
   assert(await run(`document.querySelector('[data-combat-side=player]').disabled`),'illegal friendly targets cannot be selected');
   assert.equal(await run(`document.querySelector('.combat-screen').dataset.playing`),'false','invalid friendly target does not play');
   assert.deepEqual(await run(`Array.from(document.querySelectorAll('[data-delay-id]')).map(e=>[e.dataset.delayId,e.dataset.ctb])`),initialDelays,'rejected command preserves CTB');
  }
  const point=await run(`(()=>{const e=document.querySelector('.combat-arena'),r=e.getBoundingClientRect(),id=document.querySelector('[data-combat-side=enemy][data-alive=true]').dataset.combatantId,p=JSON.parse(e.dataset.targets).find(p=>p.id===id);return {x:Math.round(r.left+p.x),y:Math.round(r.top+p.y)}})()`);
  if(attacks===0)await run(`(()=>{window.ctbSamples=[];window.trackCtb=true;let previous=false,segment=0;const sample=()=>{const counting=document.querySelector('.combat-screen').dataset.ctbCounting==='true';if(counting&&!previous)segment++;if(counting)window.ctbSamples.push({segment,units:Array.from(document.querySelectorAll('[data-delay-id]')).map(e=>({id:e.dataset.delayId,value:Number(e.dataset.ctb),current:e.dataset.current,clip:getComputedStyle(e.querySelector('.hud-gauge-liquid')).clipPath})),disabled:!document.querySelector('[data-command-trigger=true]:enabled')&&!document.querySelector('.combat-command-overlay')});previous=counting;if(window.trackCtb)requestAnimationFrame(sample)};requestAnimationFrame(sample)})()`);
  win.webContents.sendInputEvent({type:'mouseMove',...point});win.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...point});win.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...point});
  await wait(`document.querySelector('.combat-screen').dataset.playing==='true'`);
  if(attacks===0){await pause(690);assert(await run(`Boolean(document.querySelector('.sprite-damage'))`));assert.notDeepEqual(await run(`Array.from(document.querySelectorAll('[data-delay-id]')).map(e=>[e.dataset.delayId,e.dataset.ctb])`),initialDelays,'committed attack updates CTB');assert(await run(`Array.from(document.querySelectorAll('.hud-gauge-liquid')).some(e=>e.getAnimations().length>0)`),'resource bars animate between committed values');assert(await run(`Array.from(document.querySelectorAll('.hud-delay-unit')).some(e=>e.getAnimations().length>0)`),'CTB portraits animate to the next committed order');await capture('battle2d-attack');}
  if(attacks===0){
   await wait(`document.querySelector('.combat-screen').dataset.ctbCounting==='true'`);await pause(100);await capture('battle2d-countdown');
   await wait(`document.querySelector('.combat-screen').dataset.playing==='false'`);
   const samples=await run(`(()=>{window.trackCtb=false;return window.ctbSamples})()`),segment=samples.filter(s=>s.segment===1);
   assert(segment.length>=3,'countdown is visible over multiple rendered frames');
   assert(samples.every(s=>s.disabled&&s.units.every(u=>u.current==='false')),'commands and next actor highlight wait for zero');
   const first=segment[0],last=segment.at(-1),moving=first.units.filter(u=>u.value>last.units.find(v=>v.id===u.id).value);
   assert(moving.length>0,'actual CTB values decrease during the timeline');
   const delta=moving[0].value-last.units.find(u=>u.id===moving[0].id).value;
   for(const unit of moving){
    const values=segment.map(s=>s.units.find(u=>u.id===unit.id).value);
    assert(new Set(values).size>=3&&values.every((v,i)=>v>=0&&(i===0||v<=values[i-1])),'CTB counts down through intermediate values');
    assert(Math.abs(unit.value-last.units.find(u=>u.id===unit.id).value-delta)<1e-7,'scheduled actors lose the same elapsed time');
   }
   assert(moving.some(u=>u.clip!==last.units.find(v=>v.id===u.id).clip),'painted bar clipping visibly changes');
   const idle=await run(`Array.from(document.querySelectorAll('[data-delay-id]')).map(e=>[e.dataset.delayId,e.dataset.ctb])`);
   assert.equal(await run(`Number(document.querySelector('[data-delay-id][data-current=true]').dataset.ctb)`),0);
   await pause(220);assert.deepEqual(await run(`Array.from(document.querySelectorAll('[data-delay-id]')).map(e=>[e.dataset.delayId,e.dataset.ctb])`),idle,'waiting for player input freezes the timeline');
  }
  attacks++;
 }
 await wait(`Boolean(document.querySelector('.combat-result'))`);
 assert(await run(`document.querySelector('.combat-result h2').textContent.includes('勝利')`));
 assert.equal(await run(`document.querySelectorAll('[data-combat-side=enemy][data-alive=false]').length`),3);
 assert.equal(await run(`document.querySelectorAll('.sprite-battle-unit[data-side=enemy][data-pose=defeat]').length`),3);
 await capture('battle2d-victory');
 assert.equal(await run(`document.querySelectorAll('[data-delay-id]').length`),0,'resolved battle removes delay UI');
 await run(`document.querySelector('.combat-result button').click()`);
 await wait(`Boolean(document.querySelector('.battle2d-finished'))`);
 assert.equal(await run('localStorage.length'),0);
 assert.deepEqual(errors,[]);
 console.log('2D BATTLE PASSED: real engine, automatic turn menu, legal-only body targeting, blocked friendly target, attacks, rest, damage, three defeated enemies, victory and no saves; attacks='+attacks);
 clearTimeout(timeout);win.destroy();app.quit();
}).catch(e=>{console.error(e);clearTimeout(timeout);app.exit(1)});
