import type {CombatFrame,CombatView} from './engine/game-facade';

// 只插值已提交的兩個端點；不推測行動成本、技能效果、排程資格或下一位人選。
export function hasCtbCountdown(frame:CombatFrame):boolean{
 return frame.after.state!=='resolved'&&frame.ctbAfterAction.some(start=>{
  const end=frame.after.combatants.find(u=>u.combatantId===start.combatantId);
  return end!==undefined&&end.state!=='dead'&&start.ctb>end.ctb;
 });
}

export function ctbPlaybackView(frame:CombatFrame,countdownProgress:number):CombatView{
 const p=Math.min(1,Math.max(0,countdownProgress));
 if(p===1||frame.after.state==='resolved')return frame.after;
 return {...frame.after,currentActorId:undefined,combatants:frame.after.combatants.map(unit=>{
  const start=frame.ctbAfterAction.find(u=>u.combatantId===unit.combatantId);
  if(!start)throw new Error(`Missing committed CTB endpoint: ${unit.combatantId}`);
  return {...unit,ctb:start.ctb+(unit.ctb-start.ctb)*p,isCurrentActor:false};
 })};
}
