import {useEffect,useRef,type PointerEvent,type MouseEvent} from 'react';

/** Screen coordinates are converted to the scaled game stage's scroll coordinates. */
export function useDragScroll(resetKey:string|undefined){
 const ref=useRef<HTMLDivElement>(null);
 const gesture=useRef<{id:number;x:number;y:number;top:number;scale:number;dragged:boolean}>();
 const suppressClick=useRef(false);
 const finish=()=>{
  const node=ref.current,current=gesture.current;
  gesture.current=undefined;
  if(node){delete node.dataset.dragging;if(current&&node.hasPointerCapture(current.id))node.releasePointerCapture(current.id)}
 };
 useEffect(()=>{
  finish();suppressClick.current=false;if(ref.current)ref.current.scrollTop=0;
 },[resetKey]);
 useEffect(()=>{window.addEventListener('blur',finish);return()=>{window.removeEventListener('blur',finish);finish()}},[]);
 return {
  ref,
  onPointerDown:(e:PointerEvent<HTMLDivElement>)=>{
   if(!e.isPrimary||e.button!==0||gesture.current)return;
   suppressClick.current=false;
   const node=e.currentTarget;
   gesture.current={id:e.pointerId,x:e.clientX,y:e.clientY,top:node.scrollTop,scale:node.clientHeight/node.getBoundingClientRect().height,dragged:false};
  },
  onPointerMove:(e:PointerEvent<HTMLDivElement>)=>{
   const current=gesture.current;if(!current||current.id!==e.pointerId)return;
   if(!current.dragged&&Math.hypot(e.clientX-current.x,e.clientY-current.y)<6)return;
   current.dragged=true;suppressClick.current=true;
   e.currentTarget.dataset.dragging='true';
   e.currentTarget.setPointerCapture(e.pointerId);
   e.currentTarget.scrollTop=current.top+(current.y-e.clientY)*current.scale;
   e.preventDefault();
  },
  onPointerUp:(e:PointerEvent<HTMLDivElement>)=>{if(gesture.current?.id===e.pointerId)finish()},
  onPointerCancel:(e:PointerEvent<HTMLDivElement>)=>{if(gesture.current?.id===e.pointerId){suppressClick.current=true;finish()}},
  onLostPointerCapture:()=>finish(),
  onPointerLeave:()=>{if(!gesture.current?.dragged)finish()},
  onClickCapture:(e:MouseEvent<HTMLDivElement>)=>{if(suppressClick.current&&e.detail!==0){e.preventDefault();e.stopPropagation()}},
  onDragStart:(e:MouseEvent<HTMLDivElement>)=>e.preventDefault(),
 };
}
