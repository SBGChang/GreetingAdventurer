import roster from './assets/combat/sprites/appearances.json';
import {appearanceStorageKey,type SaveStorage} from './engine/save-storage';
export {appearanceStorageKey} from './engine/save-storage';
export const appearances=roster as readonly Readonly<{id:string;culture:string;sex:'male'|'female';style:string;label:string;skins:Readonly<Record<string,string>>}>[];
export type AppearanceSelections=Readonly<Record<string,string>>;
/** Cosmetic preferences never alter Character.sex or game rules. */
export function readAppearanceSelections(storage:SaveStorage):AppearanceSelections{
 const raw=storage.getItem(appearanceStorageKey);
 if(raw===null)return {};
 const parsed:unknown=JSON.parse(raw);
 if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw new Error('外觀設定格式錯誤');
 const result:Record<string,string>={};
 for(const [characterId,id] of Object.entries(parsed)){
  if(typeof id!=='string'||!appearances.some(a=>a.id===id))throw new Error(`外觀設定含未登記造型：${String(id)}`);
  result[characterId]=id;
 }
 return result;
}
export function selectAppearance(current:AppearanceSelections,characterId:string,sex:string,id:string):AppearanceSelections{
 const appearance=appearances.find(a=>a.id===id);
 if(!appearance||appearance.sex!==sex)throw new Error('外觀與角色性別不相容');
 return {...current,[characterId]:id};
}
