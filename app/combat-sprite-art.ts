import type {SpriteClip} from './SpriteSequence';
import {composeSpriteAtlas} from './sprite-compositor';
import hero from './assets/combat/sprites/yunhua-male-martial/sample.json';
import heroDefeat from './assets/combat/sprites/yunhua-male-martial/defeat.json';
import crab from './assets/combat/sprites/tide-shell-crab/sample.json';
import catalog from './assets/combat/sprites/catalog.json';
export type SpriteProfile = {label: string; facing: 'left' | 'right'; width: number; portrait: number[]; attackMotion: 'contact' | 'stationary'; appearanceId?: string; motionFamilyId?: string; modelId?: string; contactFrame?: number; clips: SpriteClip[]};
const authored = import.meta.glob('./assets/combat/sprites/*/profile.json', {import: 'default'}) as Record<string, () => Promise<SpriteProfile>>;
const pendingProfiles = new Map<string, Promise<void>>();
export const profiles: Record<string, SpriteProfile> = {
  'yunhua-male-martial': {label:'雲華男性偏武 · 環首刀', appearanceId:'yunhua-male-martial', motionFamilyId:'blade', facing:'right', width:255, portrait:[180,20,150,150], attackMotion:'contact', clips: [...hero.clips, ...heroDefeat.clips]},
  'tide-shell-crab': {label:'潮殼蟹', facing:'left', width:202.5, portrait:[80,180,180,180], attackMotion:'contact', ...crab},
  ...Object.fromEntries(Object.entries(catalog).map(([skin, metadata]) => [skin, {...metadata, clips: []} as SpriteProfile])),
};
const urls = import.meta.glob('./assets/combat/sprites/*/*.png', {eager: true, query: '?url', import: 'default'}) as Record<string, string>;
type Atlases = Record<string, HTMLCanvasElement>;
const prepared = new Map<string, Promise<HTMLCanvasElement>>();
// Eviction drops cache ownership only. Mounted scenes keep their live canvas references.
const cacheAtlasLimit = 24;
/** Only the participating skins are loaded; repeated clips on one atlas share one canvas. */
export async function loadSpriteArt(skins: readonly string[]): Promise<Atlases> {
  await Promise.all([...new Set(skins)].map(skin => {
    if (!profiles[skin]) throw new Error(`缺少角色圖集：${skin}`);
    if (profiles[skin].clips.length) return;
    let pending = pendingProfiles.get(skin);
    if (!pending) {
      const load = authored[`./assets/combat/sprites/${skin}/profile.json`];
      if (!load) throw new Error(`缺少角色動作資料：${skin}`);
      pending = load().then(profile => { profiles[skin] = profile; }).catch(error => {pendingProfiles.delete(skin); throw error;});
      pendingProfiles.set(skin, pending);
    }
    return pending;
  }));
  const loadImage = (url: string) => new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image(); image.onload = () => resolve(image); image.onerror = () => reject(new Error('無法載入 2D 戰鬥素材')); image.src = url;
  });
  const requested = new Set([...new Set(skins)].flatMap(skin => {
    const profile = profiles[skin];
    if (!profile) throw new Error(`缺少角色圖集：${skin}`);
    return profile.clips.map(clip => `${urls[`./assets/combat/sprites/${skin}/${clip.file}`]}:${clip.width}x${clip.height}`);
  }));
  for (const key of prepared.keys()) {
    if (prepared.size <= cacheAtlasLimit) break;
    if (!requested.has(key)) prepared.delete(key);
  }
  return Promise.all([...new Set(skins)].flatMap(skin => {
    const profile = profiles[skin];
    if (!profile) throw new Error(`缺少角色圖集：${skin}`);
    return profile.clips.map(async clip => {
    const url = urls[`./assets/combat/sprites/${skin}/${clip.file}`];
    if (!url) throw new Error(`缺少動作圖集：${skin}/${clip.file}`);
    const key = `${url}:${clip.width}x${clip.height}`;
    let atlas = prepared.get(key);
    if (atlas) { prepared.delete(key); prepared.set(key, atlas); }
    if (!atlas) {
      atlas = loadImage(url).then(image => {
        if (image.width !== clip.width || image.height !== clip.height) throw new Error(`動作圖集尺寸錯誤：${skin}/${clip.id}`);
        return composeSpriteAtlas(image);
      }).catch(error => { prepared.delete(key); throw error; });
      prepared.set(key, atlas);
    }
    return [`${skin}/${clip.id}`, await atlas] as const;
  });})).then(entries => Object.fromEntries(entries));
}
