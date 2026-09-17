"""Read-only PNG analysis. Writes sampling metadata ONLY; never changes or saves images.

Requires Pillow, numpy, opencv-python-headless. The resulting crop/mask coordinates
are consumed by the shared canvas player; six original frames remain six frames.
"""
import json
import sys
import hashlib
from pathlib import Path
import numpy as np
from PIL import Image
sys.path.insert(0, str(Path('dist/sprite-analysis-deps').resolve()))
import cv2

catalog=json.loads(Path('content-source/combat-sprite-sheets.json').read_text(encoding='utf8'))
failed=[]
for sheet in catalog['sheets']:
    folder=Path('app/assets/combat/sprites')/sheet['skin']
    digest=hashlib.sha256((folder/'sequence.png').read_bytes()).hexdigest()
    stamp=folder/'sampling-source.json'
    if stamp.exists() and (folder/'crops.json').exists():
        previous=json.loads(stamp.read_text(encoding='utf8'))
        if previous.get('sha256')==digest and previous.get('actions')==sheet['actions'] and previous.get('analyzerVersion')==2:
            continue
    rgb=np.asarray(Image.open(folder/'sequence.png').convert('RGBA')).astype(np.int16)
    if np.any(rgb[:,:,3] < 255):
        failed.append(sheet['skin']); print('REQUIRES OPAQUE REDRAW:',sheet['skin']); continue
    h,w=rgb.shape[:2]; rows=len(sheet['actions']); cw=w/6; ch=h/rows
    mask=((np.minimum(rgb[:,:,0],rgb[:,:,2])-rgb[:,:,1]<72)&(rgb[:,:,3]>128)).astype(np.uint8)
    count,labels,stats,centers=cv2.connectedComponentsWithStats(mask,8)
    roots={}
    for i in range(1,count):
        x,y=centers[i]; cell=(min(rows-1,int(y/ch)),min(5,int(x/cw)))
        if cell not in roots or stats[i,4]>stats[roots[cell],4]: roots[cell]=i
    if len(roots)!=rows*6 or any(stats[i,4]<800 for i in roots.values()):
        failed.append(sheet['skin']); print('REQUIRES REDRAW:',sheet['skin']); continue
    groups={cell:[root] for cell,root in roots.items()}; root_ids=set(roots.values())
    for i in range(1,count):
        if i in root_ids or stats[i,4]<7: continue
        # Sheets use a fixed six-column grid. A forward effect can be closer to
        # the next actor than its owner, so nearest-body assignment is incorrect.
        x,y=centers[i]
        cell=(min(rows-1,int(y/ch)),min(5,int(x/cw)))
        groups[cell].append(i)
    baselines={r:float(np.median([stats[roots[(r,c)],1]+stats[roots[(r,c)],3] for c in range(6)])) for r in range(rows)}
    frames=[]
    for r in range(rows):
        row=[]
        for c in range(6):
            region=np.isin(labels,groups[(r,c)]).astype(np.uint8)
            region=cv2.dilate(region,np.ones((3,3),np.uint8))
            contours,_=cv2.findContours(region,cv2.RETR_EXTERNAL,cv2.CHAIN_APPROX_SIMPLE)
            polygons=[cv2.approxPolyDP(p,.65,True).reshape(-1,2) for p in contours if cv2.contourArea(p)>4]
            points=np.concatenate(polygons)
            x,y=points.min(axis=0); right,bottom=points.max(axis=0)+1
            row.append({'rect':{'x':int(x),'y':int(y),'width':int(right-x),'height':int(bottom-y)},
                        'pivot':{'x':round((c+.5)*cw-x,2),'y':round(baselines[r]-y,2)},
                        'regions':[[{'x':int(px-x),'y':int(py-y)} for px,py in p] for p in polygons]})
        frames.append(row)
    (folder/'crops.json').write_text(json.dumps(frames,separators=(',',':'))+'\n',encoding='utf8')
    stamp.write_text(json.dumps({'sha256':digest,'actions':sheet['actions'],'width':w,'height':h,'analyzerVersion':2})+'\n',encoding='utf8')
    print(sheet['skin'],rows*6,'source frames analyzed; image unmodified')
if failed: raise SystemExit('Connected/missing poses require imagegen redraw: '+', '.join(failed))
