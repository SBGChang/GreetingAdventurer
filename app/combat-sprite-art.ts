import type {SpriteClip} from './SpriteSequence';
import {composeSpriteAtlas} from './sprite-compositor';
import hero from './assets/combat/sprites/yunhua-male-martial/sample.json';
import heroDefeat from './assets/combat/sprites/yunhua-male-martial/defeat.json';
import crab from './assets/combat/sprites/tide-shell-crab/sample.json';
export const profiles: Record<string, {clips: SpriteClip[]}> = {
  'yunhua-male-martial': {clips: [...hero.clips, ...heroDefeat.clips]},
  'tide-shell-crab': crab,
};
const urls = import.meta.glob('./assets/combat/sprites/*/*.png', {eager: true, query: '?url', import: 'default'}) as Record<string, string>;
type Atlases = Record<string, HTMLCanvasElement>;
let prepared: Promise<Atlases> | undefined;
export function loadSpriteArt(): Promise<Atlases> {
  if (prepared) return prepared;
  const loadImage = (url: string) => new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image(); image.onload = () => resolve(image); image.onerror = () => reject(new Error('無法載入 2D 戰鬥素材')); image.src = url;
  });
  prepared = Promise.all(Object.entries(profiles).flatMap(([skin, profile]) => profile.clips.map(async clip => {
    const url = urls[`./assets/combat/sprites/${skin}/${clip.file}`];
    if (!url) throw new Error(`缺少動作圖集：${skin}/${clip.file}`);
    const image = await loadImage(url);
    if (image.width !== clip.width || image.height !== clip.height) throw new Error(`動作圖集尺寸錯誤：${skin}/${clip.id}`);
    return [`${skin}/${clip.id}`, composeSpriteAtlas(image)] as const;
  }))).then(entries => Object.fromEntries(entries)).catch(error => { prepared = undefined; throw error; });
  return prepared;
}
