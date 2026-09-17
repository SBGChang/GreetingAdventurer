import {useEffect, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {SpriteSequence, type SpriteClip} from './SpriteSequence';
import {profiles, loadSpriteArt} from './combat-sprite-art';
import './combat-sprites.css';

function SpritePreview() {
  const [skin, setSkin] = useState(() => new URLSearchParams(location.search).get('skin') ?? 'yunhua-male-martial');
  const profile = profiles[skin];
  if (!profile) throw new Error(`未登記的序列素材：${skin}`);
  const clips: SpriteClip[] = profile.clips;
  const [loadedSkin, setLoadedSkin] = useState('');
  const [images, setImages] = useState<Record<string, HTMLCanvasElement>>({});
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(0);
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(() => !matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [speed, setSpeed] = useState(1);
  const [loop, setLoop] = useState(true);
  const [replay, setReplay] = useState(0);
  const [light, setLight] = useState(false);
  const clip = clips[Math.min(selected, clips.length - 1)]!;
  const ready = loadedSkin === skin;
  useEffect(() => {
    let cancelled = false;
    setError(''); setSelected(0); setFrame(0);
    loadSpriteArt([skin]).then(atlases => { if (!cancelled) {
      setImages(Object.fromEntries(profiles[skin]!.clips.map(c => [c.id, atlases[`${skin}/${c.id}`]!])));
      setLoadedSkin(skin);
    } })
      .catch((e: Error) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [skin]);
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
    <header className="sprite-heading"><div><span className="sprite-eyebrow">戰鬥序列圖鑑</span><h1>{profile.label}</h1><label>檢視素材 <select aria-label="檢視素材" value={skin} onChange={e => { setPlaying(false); setFrame(0); setSelected(0); setSkin(e.target.value); }} style={{maxWidth:'100%'}}>{Object.entries(profiles).map(([id,p]) => <option key={id} value={id}>{p.label}</option>)}</select></label></div><a href="./combat-2d.html">進入 2D 實戰 →</a><a href="./dungeon-walk.html?map=canal">返回地牢</a></header>
    <section className="sprite-stage" aria-label="角色動作舞台">
      <div className="sprite-seal" aria-hidden="true">序<br/>列</div><div className="sprite-ground"/>
      {error ? <p role="alert">{error}<button onClick={() => location.reload()}>重新載入</button></p> : !ready ? <p role="status">正在展開動作圖卷…</p> : <SpriteSequence image={images[clip.id]!} clip={clip} frame={frame}/>}
      <div className="sprite-caption"><span>{clip?.label}</span><p>{clip?.description}</p></div>
      <nav className="sprite-actions" aria-label="選擇角色動作">{clips.map((c, i) => <button key={c.id} data-action={c.id} aria-pressed={i === selected} disabled={!ready} onClick={() => choose(i)}><span>0{i + 1}</span>{c.label}<small>{c.frames.length} 格</small></button>)}</nav>
    </section>
    <section className="sprite-edit" aria-label="序列播放控制">
      <div className="sprite-controls"><button data-control="play" disabled={!ready} onClick={() => {
        if (!playing && frame === clip.frames.length - 1) setFrame(0);
        setPlaying(v => !v);
      }}>{playing ? '暫停' : '播放'}</button>
        <button disabled={!ready} onClick={() => seek(frame - 1)}>上一格</button><button data-control="next" disabled={!ready} onClick={() => seek(frame + 1)}>下一格</button>
        <span className="sprite-count">{String(frame + 1).padStart(2, '0')} / {String(clip?.frames.length??0).padStart(2, '0')}</span>
        <label>速度 <select aria-label="播放速度" value={speed} onChange={e => setSpeed(Number(e.target.value))}><option value={.25}>¼ 倍</option><option value={.5}>½ 倍</option><option value={1}>正常</option><option value={1.5}>1.5 倍</option></select></label>
        <button data-control="loop" aria-pressed={loop} onClick={() => setLoop(v => !v)}>循環</button>
        <button aria-pressed={light} onClick={() => setLight(v => !v)}>切換明暗底色</button>
      </div>
      <div className="sprite-filmstrip">{ready && clip.frames.map((_, i) => <button key={i} data-pose={i} aria-label={`查看第 ${i + 1} 格`} aria-pressed={frame === i} onClick={() => seek(i)}><SpriteSequence image={images[clip.id]!} clip={clip} frame={i} thumbnail/><span>{String(i + 1).padStart(2, '0')}</span></button>)}</div>
    </section>
    <footer>與正式戰鬥共用圖集、裁切與播放器 · 逐格檢視不讀寫存檔</footer>
  </main>;
}
function SpriteGallery(){
 const query=new URLSearchParams(location.search),group=query.get('catalog'),motion=query.get('motion'),page=Number(query.get('page')??0),action=query.get('action')??'attack';
 const all=Object.entries(profiles).filter(([,p])=>group==='monsters'?!p.appearanceId:!!p.appearanceId&&(!motion||p.motionFamilyId===motion));
 const entries=all.slice(page*16,page*16+16),key=JSON.stringify(entries.map(([id])=>id));
 const motions=[...new Map(Object.values(profiles).filter(p=>p.motionFamilyId).map(p=>[p.motionFamilyId!,p.label.split(' · ').at(-1)!])).entries()];
 const pageLink=(next:number)=>{const q=new URLSearchParams(query);q.set('page',String(next));return `?${q}`};
 const [art,setArt]=useState<Awaited<ReturnType<typeof loadSpriteArt>>>(),[error,setError]=useState('');
 useEffect(()=>{let disposed=false;loadSpriteArt(JSON.parse(key) as string[]).then(a=>{if(!disposed)setArt(a)}).catch(e=>{if(!disposed)setError(String(e))});return()=>{disposed=true}},[key]);
 return <main className="sprite-catalog-gallery" data-ready={error?'error':art?'true':'false'} style={{background:'#182322',color:'#eeddbc',minHeight:'100vh',padding:20,boxSizing:'border-box'}}>
  <header style={{display:'flex',justifyContent:'space-between'}}><b>序列圖鑑 · {action} · {page+1}/{Math.ceil(all.length/16)}</b><a href="./combat-sprites.html">逐格播放</a></header>
  <nav aria-label="圖鑑分類" style={{display:'flex',gap:16,alignItems:'center',margin:'12px 0',flexWrap:'wrap'}}>
   <a href="?catalog=characters&motion=blade">人物</a><a href="?catalog=monsters">怪物</a>
   {group==='characters'&&<select aria-label="武器動作種類" value={motion??''} onChange={e=>{location.search=`?catalog=characters&motion=${e.target.value}`}}><option value="">全部武器</option>{motions.map(([id,name])=><option key={id} value={id}>{name}</option>)}</select>}
   {page>0&&<a href={pageLink(page-1)}>上一組</a>}{(page+1)*16<all.length&&<a href={pageLink(page+1)}>下一組</a>}
  </nav>
  {error&&<p role="alert">{error}</p>}
  <div style={{display:'grid',gridTemplateColumns:'repeat(4,minmax(0,1fr))',gap:12}}>{entries.map(([id,p])=>{const clip=p.clips.find(c=>c.id===action)!;return <a key={id} href={`?skin=${id}`} style={{color:'inherit',textDecoration:'none',border:'1px solid #716548',height:210,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center'}}>
   {art&&<div style={{width:205,height:178}}><SpriteSequence image={art[`${id}/${action}`]!} clip={clip} frame={action === 'attack' ? (p.contactFrame ?? Math.floor(clip.frames.length/2)) : Math.floor(clip.frames.length/2)} thumbnail/></div>}<span>{p.label}</span>
  </a>})}</div>
 </main>;
}
createRoot(document.getElementById('root')!).render(new URLSearchParams(location.search).has('catalog')?<SpriteGallery/>:<SpritePreview/>);
