import catalog from './assets/dungeons/catalog.json';
const models = import.meta.glob('./assets/dungeons/*.glb', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
export function dungeonArt(templateId: string, floor: number): string | undefined {
  const entry = catalog.find(map => map.templateId === templateId)?.floors.find(entry => entry.floor === floor);
  return entry && models[`./assets/dungeons/${entry.model}`];
}
