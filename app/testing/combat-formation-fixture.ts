import type {CombatView} from '../engine/game-facade';

/** Capacity/selection data only. This fixture never invents combat resolution. */
export function createCombatFormationFixture(base: CombatView): CombatView {
  const delays = [0,12,25,45,70,95,100,125,180];
  const combatants = (['player', 'enemy'] as const).flatMap(side => {
    const source = base.combatants.find(u => u.side === side);
    if (!source) throw new Error('Formation fixture needs both sides');
    return Array.from({length: 9}, (_, index) => ({...source, ctb:delays[index]! + (side==='enemy'?8:0), combatantId: `fixture.${side}.${index}`, row: Math.floor(index / 3) + 1, col: index % 3 + 1, isCurrentActor: side === 'player' && index === 0}));
  });
  const actions=base.actions.map(a=>({...a,validTargetIds:combatants.filter(u=>u.side==='enemy').map(u=>u.combatantId)}));
  const weaponSets=base.weaponSets.map(set=>({...set,skills:set.skills.map(a=>a?actions.find(v=>v.skillId===a.skillId&&v.weaponSetId===a.weaponSetId):undefined)}));
  return {...base,actions,weaponSets, encounterId: 'fixture.formation.full', currentActorId: combatants[0]!.combatantId, combatants, order: [...combatants].sort((a,b)=>a.ctb-b.ctb).map(u => u.combatantId)};
}
