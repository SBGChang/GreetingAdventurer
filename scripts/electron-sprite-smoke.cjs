const {app, BrowserWindow} = require('electron');
const {mkdtempSync, writeFileSync} = require('node:fs');
const {tmpdir} = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
app.setPath('userData', mkdtempSync(path.join(tmpdir(), 'ga-sprites-')));
const timeout = setTimeout(() => app.exit(1), 60000);
app.whenReady().then(async () => {
  const win = new BrowserWindow({show: false, width: 1440, height: 900, webPreferences: {offscreen: true}});
  win.webContents.setBackgroundThrottling(false);
  const errors = [];
  win.webContents.on('console-message', detail => { if (detail.level === 'error') errors.push(detail.message); });
  const run = code => win.webContents.executeJavaScript(code, true);
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const wait = async code => { for (let i = 0; i < 200; i++) { if (await run(code)) return; await pause(30); } throw new Error('Timeout: ' + code); };
  const capture = async name => { win.webContents.invalidate(); await pause(80); writeFileSync(path.resolve('dist/' + name + '.png'), (await win.webContents.capturePage()).toPNG()); };
  await win.loadFile(path.resolve('dist/renderer/combat-sprites.html'));
  await wait(`document.querySelector('main')?.dataset.ready==='true'`);
  assert.equal(await run('localStorage.length'), 0);
  for (const action of ['idle', 'attack', 'hit', 'guard', 'dodge']) {
    await run(`document.querySelector('[data-action="${action}"]').click()`);
    await wait(`document.querySelector('[data-sprite-action]')?.dataset.spriteAction==='${action}'`);
    const hashes = [];
    for (let frame = 0; frame < 6; frame++) {
      await run(`document.querySelector('[data-pose="${frame}"]').click()`);
      await wait(`document.querySelector('[data-sprite-frame]').dataset.spriteFrame==='${frame}'`);
      const stats = await run(`(()=>{const c=document.querySelector('.sprite-actor'),p=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let clear=0,solid=0,magenta=0,hash=0;for(let i=0;i<p.length;i+=4){if(p[i+3]===0)clear++;if(p[i+3]>200){solid++;if(p[i]>220&&p[i+2]>220&&p[i+1]<65)magenta++;}hash=(Math.imul(hash,31)+p[i]+p[i+1]+p[i+2]+p[i+3])|0;}return {clear,solid,magenta,hash};})()`);
      assert(stats.clear > 600000, 'real transparent surroundings');
      assert(stats.solid > 80000, 'character pixels remain visible');
      assert(stats.magenta < 30, 'no opaque magenta backing');
      hashes.push(stats.hash);
      if (frame === 3) await capture('sprite-' + action);
    }
    assert.equal(new Set(hashes).size, 6, action + ' contains six different rendered poses');
    await pause(160); assert.equal(await run(`document.querySelector('[data-sprite-frame]').dataset.spriteFrame`), '5', 'paused frame stays still');
    await run(`document.querySelector('[data-control="next"]').click()`);
    await wait(`document.querySelector('[data-sprite-frame]').dataset.spriteFrame==='0'`);
    await run(`if(document.querySelector('[data-control="loop"]').getAttribute('aria-pressed')==='true')document.querySelector('[data-control="loop"]').click();document.querySelector('[data-control="play"]').click()`);
    await wait(`document.querySelector('[data-sprite-frame]').dataset.spriteFrame==='5'&&document.querySelector('[data-control="play"]').textContent==='播放'`);
  }
  await run(`document.querySelector('[data-action="attack"]').click();document.querySelector('[data-pose="3"]').click()`);
  await capture('sprite-preview');
  win.setContentSize(800, 700); await pause(150);
  assert(await run('document.documentElement.scrollWidth<=innerWidth'), 'no horizontal overflow at narrow desktop');
  assert.equal(await run('localStorage.length'), 0);
  assert.deepEqual(errors, []);
  console.log('SPRITE PREVIEW PASSED: five actions, thirty distinct frames, transparency, stepping, single playback, responsive layout, no saves');
  clearTimeout(timeout); win.destroy(); app.quit();
}).catch(error => { console.error(error); clearTimeout(timeout); app.exit(1); });
