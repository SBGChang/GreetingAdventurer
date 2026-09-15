import {CombatScreen} from './CombatScreen';
import {createCombatSandbox} from './testing/combat-sandbox';
import type {GameCommand} from '../src/app/composition/messages';
import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {DungeonAdventure} from './DungeonAdventure';
import {createAdventureFixture} from './testing/adventure-fixture';
import catalog from './assets/dungeons/catalog.json';
import './player.css';

function TestEntrance(){
 const query=new URLSearchParams(location.search).get('map');
 const initial=query===null?catalog[0]:catalog.find(m=>m.key===query);
 if(!initial)throw new Error(`Unknown test map: ${query}`);
 const [mapKey,setMapKey]=useState(initial.key),[floor,setFloor]=useState(initial.floors[0]!.floor);
 const [fixture,setFixture]=useState(()=>createAdventureFixture(initial.key,initial.floors[0]!.floor));
 const [revision,refresh]=useState(0),[run,setRun]=useState(0),[notice,setNotice]=useState('測試隊伍／關閉的紅門／真實回合戰鬥；不讀寫正式存檔');
 const [battle,setBattle]=useState(()=>createCombatSandbox());
 const [battleView,setBattleView]=useState(battle.view);
 const combatText=(ref:{key:string})=>ref.key.startsWith('test.')?fixture.text(ref):battle.text(ref);
 const combatModel=battleView.combat?.combatants.find(c=>c.side==='enemy');
 const dungeon={...fixture.view,roomContents:fixture.view.roomContents.map(c=>({...c,modelId:combatModel?.modelId??c.modelId,nameRef:combatModel?.nameRef??c.nameRef}))};
 const map=catalog.find(m=>m.key===mapKey)!;
 const reset=(key:string,f:number)=>{setMapKey(key);setFloor(f);setFixture(createAdventureFixture(key,f));setRun(v=>v+1);setNotice('已注入全新測試入口資料');const next=createCombatSandbox();setBattle(next);setBattleView(next.view);};
 const action=(call:()=>boolean)=>{const accepted=call();refresh(v=>v+1);setNotice(accepted?'測試狀態已更新':'測試指令已拒絕，位置與進度不變');return accepted;};
 return <main className="walk-demo" data-fixture-revision={revision}>
 {!fixture.exited && <DungeonAdventure key={`${mapKey}:${run}`} active={!fixture.fighting} backdrop={fixture.fighting} locale="zh-Hant" dungeon={dungeon} party={{leaderId:battleView.formation.actorCharacterId,memberIds:battleView.formation.members}} text={combatText}
  onMove={room=>action(()=>fixture.move(room))} onOpenDoor={link=>action(()=>fixture.open(link))} onFight={id=>{if(!action(()=>fixture.fight(id)))return false;const next=createCombatSandbox();setBattle(next);setBattleView(next.view);return true;}} onLeave={()=>action(()=>fixture.leave())}/>}
 {fixture.fighting&&battleView.combat&&<CombatScreen environment={{kind:'map',id:map.templateId}} combat={battleView.combat} locale="zh-Hant" text={battle.text} act={(choice,receive)=>{
  const c=battleView.combat!;
  const command:GameCommand=choice.kind==='rest'?{type:'combatRest',encounterId:c.encounterId as Extract<GameCommand,{type:'combatRest'}>['encounterId'],actorId:c.currentActorId as Extract<GameCommand,{type:'combatRest'}>['actorId']}:
   {type:'useCombatSkill',encounterId:c.encounterId as Extract<GameCommand,{type:'useCombatSkill'}>['encounterId'],actorId:c.currentActorId as Extract<GameCommand,{type:'useCombatSkill'}>['actorId'],weaponSetId:choice.weaponSetId as import('../src/contracts/core').WeaponSetId,skillId:choice.skillId as Extract<GameCommand,{type:'useCombatSkill'}>['skillId'],targetCombatantIds:[choice.targetId as Extract<GameCommand,{type:'useCombatSkill'}>['targetCombatantIds'][number]]};
  const result=battle.run(command);
  if(!result.accepted){receive({accepted:false,code:result.rejectionCode});return;}
  receive({accepted:true,frames:result.combatFrames,complete:()=>{setBattleView(result.view);if(!result.view.combat){if(result.view.leader?.lifeState==='alive')action(fixture.finishFight);else reset(mapKey,floor);}}});
 }}/>}
 <div className="walk-fixture-status"><strong>冒險測試入口 · 共用正式場景</strong><p role="status">{notice}</p>
 {fixture.fighting && <p>獨立測試隊伍 · 正式戰鬥引擎 · 不讀寫存檔</p>}
 {fixture.exited && <p>已離開測試冒險，場景已卸載。</p>}</div>
 <nav className="walk-toolbar" hidden={fixture.fighting}><select aria-label="選擇冒險地圖" value={mapKey} onChange={e=>{const next=catalog.find(m=>m.key===e.target.value)!;reset(next.key,next.floors[0]!.floor);e.target.blur();}}>{catalog.map(m=><option key={m.key} value={m.key}>{m.name}</option>)}</select>
 {map.floors.map(f=><button key={f.floor} onClick={()=>reset(mapKey,f.floor)} aria-pressed={fixture.view.floor.floor===f.floor}>{f.label}</button>)}
 <button onClick={()=>reset(mapKey,floor)}>回到入口</button><button onClick={()=>{fixture.rejectNext();setNotice('下一次跨房指令將被拒絕');}}>拒絕下次移動</button><a href={`./dungeon-3d.html?map=${mapKey}`}>美術總覽</a><a href="./combat-sprites.html">2D 序列試演</a></nav>
 </main>;
}
createRoot(document.getElementById('root')!).render(<TestEntrance/>);
