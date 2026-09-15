import { useMemo, useRef } from 'react';
import { WalkScene } from './WalkScene';
import { dungeonArt } from './dungeon-art';
import { dungeonWalkSpace } from './dungeon-walk-data';
import { t, type UiLocale } from './i18n';
import type { GameView } from './engine/game-facade';
import type { LocalizedTextRef } from '../src/contracts/core';
import type { WalkParty } from './walk-types';
import {minimapLandmarks,type MinimapLandmark} from './minimap-landmarks';
import presentation from './assets/dungeons/walk-presentation.json';

/** One adventure surface, with real or test state supplied only by its entrance adapter. */
export function DungeonAdventure(props: {
  active: boolean;
  backdrop?: boolean;
  party: WalkParty;
  locale: UiLocale;
  dungeon: NonNullable<GameView['dungeon']>;
  text: (ref: LocalizedTextRef) => string;
  onOpenDoor: (linkId: string) => boolean;
  onMove: (roomId: string) => boolean;
  onLeave: () => boolean;
  onFight: (contentId: string, label: string) => boolean;
}): JSX.Element {
  const { active, backdrop = false, party, locale, dungeon, text, onOpenDoor, onMove, onLeave, onFight } = props;
  const geometry = useMemo(() => {
    try {
      const modelUrl = dungeonArt(dungeon.templateId, dungeon.floor.floor);
      if (!modelUrl) throw new Error(`Missing dungeon model: ${dungeon.templateId}`);
      return { modelUrl, space: dungeonWalkSpace(dungeon.templateId, dungeon.floor.floor, dungeon.floor.cells.map(c=>({...c, floor:dungeon.floor.floor}))) };
    } catch(error) { return { error: error instanceof Error ? error.message : String(error) }; }
  }, [dungeon.templateId, dungeon.floor.floor, dungeon.mapVersion]);
  const walkState = useMemo(() => ({currentRoomId:dungeon.currentRoomId, entryCell:dungeon.entryCell, links:dungeon.links, canMove:dungeon.canMove}), [dungeon]);
  const minimap=useRef<HTMLDivElement>(null);
  const knownRooms=useMemo(()=>[...new Set(dungeon.floor.cells.filter(c=>c.revealed).map(c=>c.roomId))],[dungeon.floor]);
  const landmarkGroups=useMemo(()=>{
    const groups=new Map<string,MinimapLandmark[]>();
    if(geometry.space)for(const mark of minimapLandmarks(geometry.space,dungeon.links,knownRooms,presentation.interaction)){
      const key=`${mark.x},${mark.z}`;groups.set(key,[...(groups.get(key)??[]),mark]);
    }
    return [...groups];
  },[geometry,dungeon.links,knownRooms]);
  const encounters=useMemo(()=>dungeon.roomContents.filter(c=>(c.kind==='monsterGroup'||c.kind==='boss')&&c.available).map(c=>{
    if(!c.modelId)throw new Error(`Missing encounter model: ${c.contentId}`);
    return {contentId:c.contentId,modelId:c.modelId,label:c.nameRef?text(c.nameRef):t(locale,'ui.dungeon.encounter')};
  }),[dungeon.roomContents,locale,text]);
  const landmarkLabel=(mark:Pick<MinimapLandmark,'kind'|'open'>)=>t(locale,mark.kind==='door'?(mark.open?'ui.dungeon.doorOpened':'ui.dungeon.doorClosed'):mark.kind==='stairsUp'?'ui.dungeon.stairsUp':'ui.dungeon.stairsDown');
  return <section className="dungeon-adventure" data-backdrop={backdrop} hidden={!active && !backdrop} ref={e=>e?.toggleAttribute("inert",!active)}>
    <div className="dungeon-caption"><span>{text(dungeon.siteNameRef)} · {t(locale,'ui.dungeon.floor',{n:dungeon.floor.floor})}</span>
      <h2 data-current-room={dungeon.currentRoomId}>{dungeon.currentRoomId.replace(/^f\d+\./,'')}</h2>
      <p>{t(locale,'ui.dungeon.rooms',{a:dungeon.revealedRoomCount,b:dungeon.totalRoomCount})} · {t(locale,'ui.dungeon.minutes',{n:dungeon.elapsedMinutes})}</p>
    </div>
    {geometry.modelUrl && geometry.space ? <WalkScene sceneId={`${dungeon.explorationId}:${dungeon.mapVersion}:${dungeon.floor.floor}`}
      locale={locale} modelUrl={geometry.modelUrl} space={geometry.space} state={walkState} party={party} active={active} backdrop={backdrop} minimap={minimap} revealedRoomIds={knownRooms} encounters={encounters} onFight={onFight} onMove={onMove} onOpenDoor={onOpenDoor} /> : <p className="walk-status" role="alert">{geometry.error}</p>}
    <div className="dungeon-model-hint">{t(locale,'ui.dungeon.walkHint')} · {t(locale,'ui.dungeon.party',{n:party.memberIds.length})}</div>
    <section className="aerial-minimap" aria-label={t(locale,'ui.dungeon.map')}>
      <header><span>{t(locale,'ui.dungeon.aerial')}</span><span aria-label={t(locale,'ui.dir.north')}>N ↑</span></header>
      <div ref={minimap} className="aerial-minimap-view" data-minimap-view>
        {landmarkGroups.map(([key,marks])=><div key={`${dungeon.floor.floor}:${key}`} className="minimap-landmarks" data-minimap-anchor data-world-x={marks[0]!.x} data-world-z={marks[0]!.z} hidden>
          <svg className="minimap-leader" aria-hidden="true"><line/></svg>
          {marks.map(mark=><span key={mark.linkId} className="minimap-symbol" data-minimap-kind={mark.kind} data-minimap-link={mark.linkId} data-open={mark.open} role="img" aria-label={landmarkLabel(mark)}>
            <MinimapSymbol kind={mark.kind} open={mark.open}/>
          </span>)}
        </div>)}
        <div className="minimap-party" data-minimap-player hidden aria-label={t(locale,'ui.dungeon.ourPosition')}>
          <span className="minimap-party-halo"/><svg viewBox="-14 -14 28 28" aria-hidden="true"><path d="M0-10 8 9 0 5-8 9Z"/></svg>
        </div>
      </div>
      <footer className="minimap-legend"><span><b className="minimap-party-key">▲</b> {t(locale,'ui.dungeon.ourPosition')}</span>
        {([{kind:'door',open:false},{kind:'door',open:true},{kind:'stairsUp',open:true},{kind:'stairsDown',open:true}] as const).map(mark=><span key={`${mark.kind}:${mark.open}`}>
          <i className="minimap-symbol" data-minimap-kind={mark.kind} data-open={mark.open}><MinimapSymbol {...mark}/></i>{landmarkLabel(mark)}
        </span>)}
      </footer>
    </section>
    <aside className="dungeon-room-panel"><p>{t(locale, 'ui.dungeon.encountersRemaining', { n: dungeon.remainingEncounters })}</p><h3>{t(locale,'ui.dungeon.roomContents')}</h3>
      {dungeon.isExitRoom && <button className="primary" disabled={!dungeon.canMove} onClick={onLeave}>{t(locale,'ui.dungeon.leave')} ↗</button>}
      {dungeon.roomContents.length===0 && <p>{t(locale,'ui.dungeon.roomEmpty')}</p>}
      {dungeon.roomContents.map(content=><button key={content.contentId} data-encounter={content.kind==='monsterGroup'||content.kind==='boss'} disabled={!dungeon.canMove || !content.available || (content.guardsRemaining ?? 0) > 0} className="dungeon-content" onClick={()=>onFight(content.contentId,content.nameRef?text(content.nameRef):'')}>
        <span className="dungeon-action-name">{content.kind === 'kidnap' ? t(locale, 'ui.dungeon.captive') : content.nameRef?text(content.nameRef):t(locale,'ui.dungeon.kind.other')}</span>
        {content.guardsRemaining !== undefined && <span className="dungeon-action-note">{t(locale, 'ui.dungeon.guardsRemaining', { n: content.guardsRemaining })}</span>}
        <span className="dungeon-action-note">{t(locale,content.kind==='monsterGroup'||content.kind==='boss'?'ui.dungeon.fight':'ui.dungeon.open')} →</span>
      </button>)}
    </aside>

  </section>;
}

function MinimapSymbol({kind,open}:Pick<MinimapLandmark,'kind'|'open'>){
  return <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    {kind==='door'?<><path d="M5 21V3h14v18M3 21h18"/>{open?<path d="M7 4v15l7-3V6ZM17 12h1"/>:<><path d="M8 6h8v15H8Z"/><path d="M13 13h.2"/></>}</>:<><path d="M3 20h5v-4h5v-4h5V8h3"/><path d={kind==='stairsUp'?'M8 11V3M4 7l4-4 4 4':'M8 3v8M4 7l4 4 4-4'}/></>}
  </svg>;
}
