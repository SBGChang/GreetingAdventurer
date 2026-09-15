import maps from '../../content/yunhua/maps.json';
import catalog from '../assets/dungeons/catalog.json';
import type { DungeonView, MoveOptionView } from '../engine/game-facade';
import type { WalkParty } from '../walk-types';

/** TEST ENTRANCE ONLY. Reuses shipped geometry, supplies invented runtime/party/encounter data. */
export function createAdventureFixture(mapKey: string, floor: number) {
  const art = catalog.find(m => m.key === mapKey);
  const definition = maps.find(m => m.id === art?.templateId);
  if (!art || !definition?.rooms || !definition.links || !definition.exitRoomIds) throw new Error(`Unknown test map: ${mapKey}`);
  const template = {id:definition.id, rooms:definition.rooms, exitRoomIds:definition.exitRoomIds,
    links:definition.links.map(l=>{if(l.kind!=='redDoor' && l.kind!=='passage')throw new Error('Unsupported fixture link');return {...l,kind:l.kind as 'passage' | 'redDoor'};})};
  const entrance = template.rooms.find(r => r.floor === floor);
  if (!entrance?.cells[0]) throw new Error(`Unknown test floor: ${floor}`);
  let current = entrance.roomId, entryCell = entrance.cells[0], elapsed = 0;
  const opened = new Set<string>(), revealed = new Set<string>([current]);
  const encounterRoom = template.rooms.find(r => r.floor === floor && r.roomId !== current)?.roomId;
  let encounterAvailable = encounterRoom !== undefined, fighting = false, exited = false;
  let rejectNextMove = false;
  const party: WalkParty = {leaderId:'test.leader', memberIds:['test.leader','test.companion']};
  const links = () => template.links.map(l => ({...l, open:l.kind === 'passage' || opened.has(l.linkId)}));
  const getView = (): DungeonView => {
    const rooms = template.rooms.filter(r => r.floor === entryCell.floor);
    const neighbours = links().filter(l => l.fromRoomId === current || l.toRoomId === current);
    const moves: MoveOptionView[] = neighbours.map(l => {
      const from = l.fromRoomId === current ? l.fromCell : l.toCell;
      const to = l.fromRoomId === current ? l.toCell : l.fromCell;
      const roomId = l.fromRoomId === current ? l.toRoomId : l.fromRoomId;
      const direction = to.floor !== from.floor ? (to.floor > from.floor ? 'up' : 'down') : to.row !== from.row ? (to.row > from.row ? 'south' : 'north') : (to.col > from.col ? 'east' : 'west');
      return {direction,roomId,linkId:l.linkId,kind:l.kind,open:l.open,revealed:revealed.has(roomId)};
    });
    return {
      templateId:template.id, explorationId:`test.exploration.${mapKey}.${floor}`, mapId:`test.map.${mapKey}`,mapVersion:1,
      siteNameRef:{key:'test.site'},currentRoomId:current,entryCell,canMove:!fighting && !exited,links:links(),
      remainingEncounters:encounterAvailable ? 1 : 0, remainingContentCount:encounterAvailable ? 1 : 0,
      isExitRoom:template.exitRoomIds.includes(current),elapsedMinutes:elapsed,revealedRoomCount:revealed.size,totalRoomCount:template.rooms.length,
      exits:neighbours.map(l=>({roomId:l.fromRoomId===current?l.toRoomId:l.fromRoomId,linkId:l.linkId,kind:l.kind,state:l.open?'open':'closed',revealed:revealed.has(l.fromRoomId===current?l.toRoomId:l.fromRoomId)})),moves,
      roomContents:current === encounterRoom && encounterAvailable ? [{contentId:'test.encounter',modelId:'monster.yunhua.river-cutthroat',kind:'monsterGroup',nameRef:{key:'test.encounter'},available:true}] : [],
      floor:{floor:entryCell.floor,rows:Math.max(...rooms.flatMap(r=>r.cells.map(c=>c.row))),cols:Math.max(...rooms.flatMap(r=>r.cells.map(c=>c.col))),
        cells:rooms.flatMap(r=>r.cells.map(c=>({...c,roomId:r.roomId,isCurrent:r.roomId===current,isExit:template.exitRoomIds.includes(r.roomId),revealed:revealed.has(r.roomId),contentCount:encounterAvailable && r.roomId===encounterRoom ? 1 : 0})))},
    };
  };
  return {
    party, get view() {return getView();}, get fighting(){return fighting;}, get exited(){return exited;},
    text(ref:{key:string}){if(ref.key==='test.site')return `${art.name}（測試資料）`;if(ref.key==='test.encounter')return '測試守衛';throw new Error(`Missing fixture text: ${ref.key}`);},
    rejectNext(){rejectNextMove=true;},
    move(roomId:string){
      if(rejectNextMove){rejectNextMove=false;return false;}
      if(!getView().canMove)return false;
      const l=links().find(l=>l.open && (l.fromRoomId===current && l.toRoomId===roomId || l.toRoomId===current && l.fromRoomId===roomId));
      if(!l)return false;
      entryCell=l.fromRoomId===current?l.toCell:l.fromCell;current=l.fromRoomId===current?l.toRoomId:l.fromRoomId;revealed.add(current);elapsed++;return true;
    },
    open(linkId:string){
      if(!getView().canMove)return false;
      const l=template.links.find(l=>l.linkId===linkId && (l.fromRoomId===current || l.toRoomId===current));
      if(!l || l.kind!=='redDoor' || opened.has(linkId))return false;
      opened.add(linkId);revealed.add(l.fromRoomId===current?l.toRoomId:l.fromRoomId);elapsed++;return true;
    },
    fight(contentId:string){if(!getView().canMove || current!==encounterRoom || !encounterAvailable || contentId!=='test.encounter')return false;fighting=true;return true;},
    finishFight(){if(!fighting)return false;fighting=false;encounterAvailable=false;return true;},
    leave(){if(!getView().canMove || !template.exitRoomIds.includes(current))return false;exited=true;return true;},
  };
}
