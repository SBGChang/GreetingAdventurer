import {useEffect, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {SpriteSequence, type SpriteClip} from './SpriteSequence';
import {composeSpriteAtlas} from './sprite-compositor';
import sample from './assets/combat/sprites/yunhua-male-martial/sample.json';
import './combat-sprites.css';

const urls = import.meta.glob('./assets/combat/sprites/yunhua-male-martial/*.png', {eager: true, query: '?url', import: 'default'}) as Record<string, string>;
const clips: SpriteClip[] = sample.clips;

function SpritePreview() {
  const [images, setImages] = useState<Record<string, HTMLCanvasElement>>({});
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(0);
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(() => !matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [speed, setSpeed] = useState(1);
  const [loop, setLoop] = useState(true);
  const [replay, setReplay] = useState(0);
  const [light, setLight] = useState(false);
  const clip = clips[selected]!;
  const ready = Object.keys(images).length === clips.length;
  useEffect(() => {
    let cancelled = false;
    Promise.all(clips.map(c => new Promise<[string, HTMLCanvasElement]>((resolve, reject) => {
      const url = urls[`./assets/combat/sprites/yunhua-male-martial/${c.file}`];
      if (!url) { reject(new Error(`找不到動作圖集：${c.file}`)); return; }
      const image = new Image();
      image.onload = () => {
        if (image.naturalWidth !== c.width || image.naturalHeight !== c.height) {
          reject(new Error(`圖集尺寸與資料不同：${c.file}`)); return;
        }
        try { resolve([c.id, composeSpriteAtlas(image)]); } catch (error) { reject(error); }
      };
      image.onerror = () => reject(new Error(`無法載入動作圖集：${c.file}`));
      image.src = url;
    }))).then(entries => { if (!cancelled) setImages(Object.fromEntries(entries)); })
      .catch((e: Error) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    if (!playing || !ready) return;
    const total = clip.frames.reduce((sum, f) => sum + f.durationMs, 0);
    let elapsed = clip.frames.slice(0, frame).reduce((sum, f) => sum + f.durationMs, 0);
    let last = performance.now(), raf = 0;
    const tick = (now: number) => {
      if (!document.hidden) elapsed += Math.min(now - last, 100) * speed;
      last = now;
      if (elapsed >= total && !loop) { setFrame(clip.frames.length - 1); setPlaying(false); return; }
      elapsed %= total;
      let boundary = 0;
      const index = clip.frames.findIndex(f => { boundary += f.durationMs; return elapsed < boundary; });
      setFrame(index);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // frame is the starting pose for this playback; animation updates do not restart its clock.
  }, [playing, ready, clip, speed, loop, replay]);

  const choose = (index: number) => {
    setSelected(index); setFrame(0); setLoop(index === 0); setPlaying(true); setReplay(v => v + 1);
  };
  const seek = (next: number) => { setPlaying(false); setFrame((next + clip.frames.length) % clip.frames.length); };
  return <main className={`sprite-preview ${light ? 'sprite-light' : ''}`} data-ready={error ? 'error' : ready ? 'true' : 'false'}>
    <header className="sprite-heading"><div><span className="sprite-eyebrow">序列美術試演 · 壹</span><h1>雲華刀客</h1><p>男性 · 偏武外觀 · 環首刀</p></div><a href="./combat-2d.html">進入 2D 實戰 →</a><a href="./dungeon-walk.html?map=canal">返回地牢</a></header>
    <section className="sprite-stage" aria-label="角色動作舞台">
      <div className="sprite-seal" aria-hidden="true">雲<br/>華</div><div className="sprite-ground"/>
      {error ? <p role="alert">{error}<button onClick={() => location.reload()}>重新載入</button></p> : !ready ? <p role="status">正在展開動作圖卷…</p> : <SpriteSequence image={images[clip.id]!} clip={clip} frame={frame}/>}
      <div className="sprite-caption"><span>{clip.label}</span><p>{clip.description}</p></div>
      <nav className="sprite-actions" aria-label="選擇角色動作">{clips.map((c, i) => <button key={c.id} data-action={c.id} aria-pressed={i === selected} disabled={!ready} onClick={() => choose(i)}><span>0{i + 1}</span>{c.label}<small>{c.frames.length} 格</small></button>)}</nav>
    </section>
    <section className="sprite-edit" aria-label="序列播放控制">
      <div className="sprite-controls"><button data-control="play" disabled={!ready} onClick={() => {
        if (!playing && frame === clip.frames.length - 1) setFrame(0);
        setPlaying(v => !v);
      }}>{playing ? '暫停' : '播放'}</button>
        <button disabled={!ready} onClick={() => seek(frame - 1)}>上一格</button><button data-control="next" disabled={!ready} onClick={() => seek(frame + 1)}>下一格</button>
        <span className="sprite-count">{String(frame + 1).padStart(2, '0')} / {String(clip.frames.length).padStart(2, '0')}</span>
        <label>速度 <select aria-label="播放速度" value={speed} onChange={e => setSpeed(Number(e.target.value))}><option value={.25}>¼ 倍</option><option value={.5}>½ 倍</option><option value={1}>正常</option><option value={1.5}>1.5 倍</option></select></label>
        <button data-control="loop" aria-pressed={loop} onClick={() => setLoop(v => !v)}>循環</button>
        <button aria-pressed={light} onClick={() => setLight(v => !v)}>切換明暗底色</button>
      </div>
      <div className="sprite-filmstrip">{ready && clip.frames.map((_, i) => <button key={i} data-pose={i} aria-label={`查看第 ${i + 1} 格`} aria-pressed={frame === i} onClick={() => seek(i)}><SpriteSequence image={images[clip.id]!} clip={clip} frame={i} thumbnail/><span>{String(i + 1).padStart(2, '0')}</span></button>)}</div>
    </section>
    <footer>獨立美術樣本 · 逐格序列播放 · 尚未替換正式戰鬥</footer>
  </main>;
}
createRoot(document.getElementById('root')!).render(<SpritePreview/>);
