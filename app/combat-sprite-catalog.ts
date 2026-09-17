import type {CombatView} from './engine/game-facade';
import scene from './assets/combat/sprites/stage.json';
import bindings from './assets/combat/sprites/bindings.json';
import {appearances,type AppearanceSelections} from './combat-appearances';

export type SpriteBattlePresentation = {scene: typeof scene; skins: Readonly<Record<string, string>>; weaponSetSkins: Readonly<Record<string, Readonly<Record<string,string>>>>};
/** Both entrances select art using the same projected game facts. No fixture imports. */
export function resolveSpriteBattle(view: CombatView, selections: AppearanceSelections = {}): SpriteBattlePresentation | undefined {
  const skins: Record<string, string> = {};
  const weaponSetSkins: Record<string, Record<string,string>> = {};
  for (const unit of view.combatants) {
    if (unit.row < 1 || unit.row > 3 || unit.col < 1 || unit.col > 3) throw new Error('Invalid combat formation');
    const identity = unit.artIdentity;
    if (identity) {
      if (!identity.weapons.length || !identity.activeWeaponSetId) return undefined;
      const chosen=selections[identity.characterId];
      const appearanceId=chosen===undefined?bindings.defaultAppearances.find(a=>a.archetypeId===identity.archetypeId&&a.sex===identity.sex)?.appearanceId:chosen;
      const appearance=appearances.find(a=>a.id===appearanceId&&a.sex===identity.sex);
      if(!appearance)return undefined;
      const sets: Record<string,string> = {};
      for (const weapon of identity.weapons) {
        const equipment=bindings.equipment as Readonly<Record<string,string>>;
        const main=weapon.mainHand===undefined?undefined:equipment[weapon.mainHand];
        const off=weapon.offHand===undefined?undefined:equipment[weapon.offHand];
        if((weapon.mainHand!==undefined&&!main)||(weapon.offHand!==undefined&&!off))return undefined;
        const motion=main===undefined?(off??'unarmed'):off===undefined||weapon.twoHanded?main:bindings.combinations.find(c=>c.main===main&&c.off===off)?.motion;
        const skin=motion===undefined?undefined:appearance.skins[motion];
        if(!skin)return undefined;
        sets[weapon.weaponSetId] = skin;
      }
      weaponSetSkins[unit.combatantId] = sets;
    }
    const skin = identity ? weaponSetSkins[unit.combatantId]?.[identity.activeWeaponSetId!] : (bindings.monsters as Record<string, string>)[unit.modelId];
    if (!skin) return undefined;
    skins[unit.combatantId] = skin;
  }
  return {scene, skins, weaponSetSkins};
}

export function spriteFormation(unit: CombatView['combatants'][number], scene: SpriteBattlePresentation['scene']) {
  const f = scene.formation;
  const row=unit.row+(unit.footprint.height-1)/2, col=unit.col+(unit.footprint.width-1)/2;
  return {x: (unit.side === 'player' ? f.playerX - (row - 1) * f.rowSpacing : f.enemyX + (row - 1) * f.rowSpacing) + (col - 2) * (unit.side === 'player' ? f.playerDepthX : f.enemyDepthX), y: f.y + (col - 2) * f.colSpacing};
}
