import atlas from './assets/geography/atlas.json';
// All paths are a closed build-time asset catalogue; never runtime imports from content strings.
const models = import.meta.glob('./assets/{geography,town3d}/*.glb', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
export const atlasCities = atlas.cities;
export const atlasCamera = atlas.camera;
export const atlasRoutes = atlas.roads;
export type AtlasCity = typeof atlasCities[number];
export function cityModel(city: AtlasCity): string {
  const path = city.model.startsWith('../') ? `./assets/${city.model.slice(3)}` : `./assets/geography/${city.model}`;
  const url = models[path];
  if (!url) throw new Error(`City art missing: ${city.key}`);
  return url;
}
export function modelForCity(cityId: string): string | undefined {
  const city = atlasCities.find(city => city.cityId === cityId);
  return city && cityModel(city);
}

const renders = import.meta.glob('./assets/{geography,town3d}/*.png', { eager: true, query: '?url', import: 'default' }) as Record<string,string>;
export function renderForCity(cityId: string): string | undefined {
  const city=atlasCities.find(c=>c.cityId===cityId);
  if(!city)return undefined;
  const path=city.model.startsWith('../')?`./assets/${city.model.slice(3).replace('.glb','-render.png')}`:`./assets/geography/${city.key}.png`;
  return renders[path];
}
