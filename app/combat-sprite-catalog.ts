import type {CombatView} from './engine/game-facade';
import scene from './assets/combat/sprites/stage.json';
import bindings from './assets/combat/sprites/bindings.json';

export type SpriteBattlePresentation = {scene: typeof scene; skins: Readonly<Record<string, string>>};
/** Both entrances select art using the same projected game facts. No fixture imports. */
export function resolveSpriteBattle(view: CombatView): SpriteBattlePresentation | undefined {
  const skins: Record<string, string> = {};
  for (const unit of view.combatants) {
    if (unit.row < 1 || unit.row > 3 || unit.col < 1 || unit.col > 3) throw new Error('Invalid combat formation');
    const identity = unit.artIdentity;
    const character = identity && bindings.characters.find(c => c.archetypeId === identity.archetypeId && c.sex === identity.sex && identity.weapons.length > 0 && identity.weapons.every(w => {
      const family = bindings.weaponFamilies.find(f => f.id === c.weaponFamilyId);
      return family && w.mainHand !== undefined && w.offHand === undefined && family.equipmentIds.includes(w.mainHand) && w.skillIds.every(id => family.skillIds.includes(id));
    }));
    const skin = identity ? character?.skinId : (bindings.monsters as Record<string, string>)[unit.modelId];
    if (!skin) return undefined;
    skins[unit.combatantId] = skin;
  }
  return {scene, skins};
}

export function spriteFormation(unit: CombatView['combatants'][number], scene: SpriteBattlePresentation['scene']) {
  const f = scene.formation;
  return {x: (unit.side === 'player' ? f.playerX - (unit.row - 1) * f.rowSpacing : f.enemyX + (unit.row - 1) * f.rowSpacing) + (unit.col - 2) * (unit.side === 'player' ? f.playerDepthX : f.enemyDepthX), y: f.y + (unit.col - 2) * f.colSpacing};
}
