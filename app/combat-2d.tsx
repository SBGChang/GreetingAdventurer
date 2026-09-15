import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {CombatScreen} from './CombatScreen';
import {CombatTestScene} from './testing/CombatTestScene';
import {combatTestEnvironment} from './testing/combat-environment';
import {createCombatSandbox} from './testing/combat-sandbox';
import {createCombatFormationFixture} from './testing/combat-formation-fixture';
import type {GameCommand} from '../src/app/composition/messages';
import type {EncounterId, CombatantId, SkillDefinitionId} from '../src/contracts/core';
import './player.css';
import './combat-2d.css';

function BattleTrial() {
  const [battle, setBattle] = useState(() => createCombatSandbox(new URLSearchParams(location.search).get('weapons')==='alternate'));
  const [view, setView] = useState(battle.view);
  const [environment]=useState(()=>combatTestEnvironment(battle));
  const [round,setRound]=useState(0);
  const restart = () => {setRound(n=>n+1);const next = createCombatSandbox(new URLSearchParams(location.search).get('weapons')==='alternate');setBattle(next);setView(next.view);};
  return <main className="battle2d-demo">
    <CombatTestScene environment={environment} key={round} battle={battle} paused={!!view.combat}/>
    {view.combat ? <CombatScreen environment={environment} key={view.combat.encounterId} combat={view.combat} locale="zh-Hant" text={battle.text} act={(choice, receive) => {
      const combat = view.combat!;
      const command: GameCommand = choice.kind === 'rest' ? {type: 'combatRest', encounterId: combat.encounterId as EncounterId, actorId: combat.currentActorId as CombatantId} :
        {type:'useCombatSkill',encounterId:combat.encounterId as EncounterId,actorId:combat.currentActorId as CombatantId,weaponSetId:choice.weaponSetId as import('../src/contracts/core').WeaponSetId,skillId:choice.skillId as SkillDefinitionId,targetCombatantIds:[choice.targetId as CombatantId]};
      const result = battle.run(command);
      if (!result.accepted) {receive({accepted:false,code:result.rejectionCode});return;}
      receive({accepted:true,frames:result.combatFrames,complete:()=>setView(result.view)});
    }}/> : <div className="battle2d-finished"><h1>{view.leader?.lifeState === 'alive' ? '戰鬥勝利' : '隊伍戰敗'}</h1><p>本場試演已由正式引擎結算。</p><button onClick={restart}>再戰一次</button><a href="./dungeon-walk.html?map=canal">進入地牢探索</a></div>}
    <a className="battle2d-exit" href="./combat-sprites.html">返回動作圖卷</a>
  </main>;
}
function FormationTrial() {
  const [battle] = useState(() => createCombatSandbox(new URLSearchParams(location.search).get('weapons')==='alternate'));
  const [environment]=useState(()=>combatTestEnvironment(battle));
  const [combat] = useState(() => createCombatFormationFixture(battle.view.combat!));
  const [shown,setShown]=useState(true);
  return <main className="battle2d-demo"><CombatTestScene environment={environment} battle={battle} paused={shown}/>{shown&&<CombatScreen environment={environment} combat={combat} locale="zh-Hant" text={battle.text} act={(choice, receive) => receive({accepted:false,code:choice.kind === 'skill' ? `已選取 ${choice.targetId}；此入口僅檢查滿編站位，未執行戰鬥。` : '滿編站位檢查不結算回合。'})}/>}<button className="combat-test-toggle" onClick={()=>setShown(v=>!v)}>{shown?'查看背景':'返回戰鬥'}</button><a className="battle2d-exit" href="./combat-2d.html">雙方 3×3 容量檢查 · 返回實戰</a></main>;
}
createRoot(document.getElementById('root')!).render(new URLSearchParams(location.search).get('formation') === 'full' ? <FormationTrial/> : <BattleTrial/>);
