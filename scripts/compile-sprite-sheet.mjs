/** Authoring only: emit crop/pivot metadata without modifying source image pixels. */
import {readFileSync, writeFileSync, existsSync} from 'node:fs';
import {resolve, dirname} from 'node:path';
import {createHash} from 'node:crypto';

export function compileSheet({path, actions, label, scale, baselines, facing, width, attackMotion, portrait, appearanceId, motionFamilyId, modelId, contactFrame}) {
  const png = readFileSync(path);
  if (png.toString('hex', 0, 8) !== '89504e470d0a1a0a') throw new Error(`Not PNG: ${path}`);
  const w = png.readUInt32BE(16), h = png.readUInt32BE(20);
  if (baselines.length !== actions.length) throw new Error(`Missing baseline: ${path}`);
  const cropPath=resolve(dirname(path),'crops.json');
  const stamp=JSON.parse(readFileSync(resolve(dirname(path),'sampling-source.json'),'utf8'));
  if(stamp.sha256!==createHash('sha256').update(png).digest('hex')) throw new Error(`Stale sampling metadata: ${path}`);
  if (!existsSync(cropPath)) throw new Error(`Missing reviewed sampling metadata: ${cropPath}`);
  const crops=JSON.parse(readFileSync(cropPath,'utf8'));
  if (crops.length !== actions.length || crops.some(row=>row.length !== 6)) throw new Error(`Invalid sampling metadata: ${cropPath}`);
  const names = {idle:'待機',attack:'攻擊',hit:'受擊',guard:'格擋',dodge:'閃避',defeat:'倒地'};
  const rows = actions.map((id,row) => ({
    id, label:names[id], description:`${label} · ${names[id]}`, file:'sequence.png', width:w,height:h,scale,
    frames:Array.from({length:6},(_,col)=>{
      const x=Math.round(col*w/6), y=Math.round(row*h/actions.length);
      const cw=Math.round((col+1)*w/6)-x,ch=Math.round((row+1)*h/actions.length)-y;
      return {rect:{x,y,width:cw,height:ch},pivot:{x:cw/2,y:baselines[row]*ch},polygon:[],cutouts:[],...crops[row][col],durationMs:id==='idle'?180:[140,140,140,90,170,220][col]};
    }),
  }));
  const clips=[];
  for(const row of rows){
    const previous=clips.find(c=>c.id===row.id);
    if(previous)previous.frames.push(...row.frames);else clips.push(row);
  }
  const profile={label,facing,width,attackMotion,portrait,appearanceId,motionFamilyId,modelId,contactFrame,clips};
  writeFileSync(resolve(dirname(path),'profile.json'),JSON.stringify(profile,null,2)+'\n');
  return profile;
}
