import {useEffect, useRef} from 'react';

export interface SpriteFrame {
  rect: {x: number; y: number; width: number; height: number};
  pivot: {x: number; y: number};
  polygon: {x: number; y: number}[];
  regions?: {x: number; y: number}[][];
  cutouts: {x: number; y: number; width: number; height: number}[];
  durationMs: number;
}
export interface SpriteClip {
  id: string;
  label: string;
  description: string;
  file: string;
  width: number;
  height: number;
  scale: number;
  frames: SpriteFrame[];
}

/** Source pixels and foot pivots are authored art data. No skeletal deformation or pose interpolation. */
export function SpriteSequence({image, clip, frame, thumbnail = false, flipX = false}: {
  image: HTMLCanvasElement; clip: SpriteClip; frame: number; thumbnail?: boolean; flipX?: boolean;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const el = canvas.current;
    const pose = clip.frames[frame];
    if (!el || !pose) return;
    const ctx = el.getContext('2d');
    if (!ctx) throw new Error('Cannot create sprite preview canvas');
    ctx.clearRect(0, 0, el.width, el.height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    const {rect, pivot} = pose;
    const ratio = el.width / 600;
    const scale = clip.scale * ratio;
    const dx = el.width / 2 - pivot.x * scale, dy = el.height * .84 - pivot.y * scale;
    ctx.save();
    if (flipX) { ctx.translate(el.width, 0); ctx.scale(-1, 1); }
    if (pose.regions?.length) {
      ctx.beginPath();
      for (const region of pose.regions) {
        region.forEach((p,i)=>{if(i===0)ctx.moveTo(dx+p.x*scale,dy+p.y*scale);else ctx.lineTo(dx+p.x*scale,dy+p.y*scale)});
        ctx.closePath();
      }
      ctx.clip();
    }
    if (pose.polygon.length) {
      ctx.beginPath();
      pose.polygon.forEach((p, i) => { if (i === 0) ctx.moveTo(dx + p.x * scale, dy + p.y * scale); else ctx.lineTo(dx + p.x * scale, dy + p.y * scale); });
      ctx.closePath(); ctx.clip();
    }
    if (pose.cutouts.length) {
      ctx.beginPath(); ctx.rect(0, 0, el.width, el.height);
      pose.cutouts.forEach(r => ctx.rect(dx + r.x * scale, dy + r.y * scale, r.width * scale, r.height * scale));
      ctx.clip('evenodd');
    }
    ctx.drawImage(image, rect.x, rect.y, rect.width, rect.height, dx, dy,
      rect.width * scale, rect.height * scale);
    ctx.restore();
  }, [image, clip, frame, thumbnail, flipX]);
  return <canvas ref={canvas} width={thumbnail ? 240 : 1200} height={thumbnail ? 208 : 1040}
    className={thumbnail ? 'sprite-thumbnail' : 'sprite-actor'} aria-label={`${clip.label}，第 ${frame + 1} 格`}
    data-sprite-frame={thumbnail ? undefined : frame} data-sprite-action={thumbnail ? undefined : clip.id}/>;
}
