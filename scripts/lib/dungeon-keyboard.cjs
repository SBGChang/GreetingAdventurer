const assert=require('node:assert/strict');
/** Test-side steering sends real keyboard events over the exported collision mask. */
exports.createDungeonKeyboard=(run,template,nav)=>async function walk(allowedRooms,goal,floor,reach=.05){
 const actor=await run(`JSON.parse(document.querySelector('.walk-scene').dataset.actor)`);
 const enemies=await run(`JSON.parse(document.querySelector('.walk-scene').dataset.encounterPositions||'[]')`);
 const grid=nav.floors.find(f=>f.floor===floor),size=nav.size;
 const encode=(x,z)=>Math.round((z-nav.origin)/nav.step)*size+Math.round((x-nav.origin)/nav.step);
 const start=encode(actor.x,actor.z),q=[start],prev=new Map([[start,-1]]);let end;
 const permitted=new Set(template.rooms.filter(r=>allowedRooms.includes(r.roomId)).flatMap(r=>r.cells.map(c=>`${c.row},${c.col}`)));
 for(let i=0;i<q.length;i++){
  const at=q[i],row=Math.floor(at/size),col=at%size;
  if(Math.hypot(nav.origin+col*nav.step-goal.x,nav.origin+row*nav.step-goal.z)<=reach){end=at;break;}
  for(const [r,c] of [[row-1,col],[row+1,col],[row,col-1],[row,col+1]]){
   const x=nav.origin+c*nav.step,z=nav.origin+r*nav.step,n=r*size+c;
   if(r<0||c<0||r>=size||c>=size||grid.rows[r][c]!=='1'||enemies.some(e=>Math.hypot(x-e.x,z-e.z)<e.radius+.2)||!permitted.has(`${Math.floor((z+15)/6)+1},${Math.floor((x+15)/6)+1}`)||prev.has(n))continue;
   prev.set(n,at);q.push(n);
  }
 }
 assert(end!==undefined,'keyboard route over actual navigation mask');
 const path=[];for(let n=end;n!==-1;n=prev.get(n))path.unshift({x:nav.origin+(n%size)*nav.step,z:nav.origin+Math.floor(n/size)*nav.step});
 const points=path.filter((p,i)=>i===0||i===path.length-1||(p.x-path[i-1].x)!==(path[i+1].x-p.x)||(p.z-path[i-1].z)!==(path[i+1].z-p.z));
 await run(`new Promise((resolve,reject)=>{
  const points=${JSON.stringify(points)},dirs=[['d'],['d','s'],['s'],['s','a'],['a'],['a','w'],['w'],['w','d']];let index=0,keys=[],start=performance.now();
  const release=()=>{for(const key of keys)window.dispatchEvent(new KeyboardEvent('keyup',{key}));keys=[];};
  const tick=()=>{
   const el=document.querySelector('.walk-scene');if(!el){release();reject(Error('Scene left while walking'));return;}
   const p=JSON.parse(el.dataset.actor),goal=points[index],dx=goal.x-p.x,dz=goal.z-p.z;
   if(Math.hypot(dx,dz)<.18){index++;if(index===points.length){release();resolve();return;}requestAnimationFrame(tick);return;}
   if(performance.now()-start>20000){release();reject(Error('Keyboard path stalled '+JSON.stringify({p,goal})));return;}
   let best,score=-Infinity;for(const candidate of dirs){const sx=Number(candidate.includes('d'))-Number(candidate.includes('a')),sy=Number(candidate.includes('w'))-Number(candidate.includes('s')),len=Math.hypot(sx,sy),dot=((28*sx-20*sy)*dx+(-20*sx-28*sy)*dz)/len;if(dot>score){score=dot;best=candidate;}}
   release();keys=best;for(const key of keys)window.dispatchEvent(new KeyboardEvent('keydown',{key}));requestAnimationFrame(tick);
  };requestAnimationFrame(tick);
 })`);
};
