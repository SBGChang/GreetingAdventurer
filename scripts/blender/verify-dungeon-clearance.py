"""Check actual exported floor geometry with a one-unit actor footprint.
Run in Blender after build-dungeon.py; does not alter gameplay navigation.
"""
import bpy,json,hashlib,math,sys
from pathlib import Path
from mathutils import Vector
from mathutils.bvhtree import BVHTree
ROOT=Path(__file__).resolve().parents[2];OUT=ROOT/'app/assets/dungeons'
key=sys.argv[sys.argv.index('--')+1] if '--' in sys.argv else 'canal'
a=json.loads((OUT/(key+'.json')).read_text(encoding='utf-8'))
t=next(v for v in json.loads((ROOT/'content/yunhua/maps.json').read_text(encoding='utf-8')) if v.get('id')==a['templateId'])
result={'actorDiameter':1.0,'files':{},'floors':[]}
extent=max(max(f['cols'],f['rows']) for f in t['floors'])*6
navigation={'step':.2,'origin':-15,'size':round(extent/.2)+1,'actorRadius':.32,'floors':[]}
for entry in a['floors']:
 bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
 bpy.ops.import_scene.gltf(filepath=str(OUT/entry['model']))
 vertices=[];faces=[]
 for o in bpy.context.scene.objects:
  if o.type!='MESH':continue
  ancestor=o;door=False
  while ancestor:
   if 'linkId' in ancestor:door=True
   ancestor=ancestor.parent
  if door:continue # Check open-door traversability; runtime owns the door state.
  start=len(vertices);vertices.extend(o.matrix_world@v.co for v in o.data.vertices)
  faces.extend(tuple(start+i for i in p.vertices) for p in o.data.polygons)
 tree=BVHTree.FromPolygons(vertices,faces)
 def dry(x,y):
  hit=tree.ray_cast(Vector((x,y,1.6)),Vector((0,0,-1)),3)[0]
  return hit is not None and abs(hit.z-.05)<.06
 def actor(x,y,label):
  for dx in [-.5,0,.5]:
   for dy in [-.5,0,.5]:
    assert dry(x+dx,y+dy),f'Blocked actor footprint {label}: {x+dx:.2f},{y+dy:.2f}'
 def xy(c):return ((c['col']-3)*6,(3-c['row'])*6)
 rooms=[r for r in t['rooms'] if r['floor']==entry['floor']];checked=0;dry_count=0;count=0
 for r in rooms:
  for c in r['cells']:
   x,y=xy(c);actor(x,y,r['roomId']);checked+=1
   for i in range(11):
    for j in range(11):dry_count+=dry(x-2.3+i*.46,y-2.3+j*.46);count+=1
   # Every internal cell seam must also have room for a body, not only a point.
   for d in r['cells']:
    if abs(c['row']-d['row'])+abs(c['col']-d['col'])!=1:continue
    tx,ty=xy(d)
    for i in range(13):actor(x+(tx-x)*i/12,y+(ty-y)*i/12,r['roomId']+' internal lane');checked+=1
 for link in t['links']:
  if link['fromCell']['floor']!=entry['floor'] or link['toCell']['floor']!=entry['floor']:continue
  x,y=xy(link['fromCell']);tx,ty=xy(link['toCell'])
  for i in range(25):actor(x+(tx-x)*i/24,y+(ty-y)*i/24,link['linkId']);checked+=1
 # Large room centers must remain open, independent of cell count or decoration count.
 for r in rooms:
  if len(r['cells'])<4:continue
  for c in r['cells']:
   x,y=xy(c)
   for dx in [-.8,0,.8]:
    for dy in [-.8,0,.8]:actor(x+dx,y+dy,r['roomId']+' encounter area');checked+=1
 stair_cells={(l[side]['row'],l[side]['col']) for l in t['links'] if l['fromCell']['floor']!=l['toCell']['floor'] for side in ['fromCell','toCell'] if l[side]['floor']==entry['floor']}
 for row,col in stair_cells:
  x,y=xy({'row':row,'col':col});sx=x-1.95;sy=y+1.65
  for i in range(8):
   hit=tree.ray_cast(Vector((sx,sy-.875+i*.25,1.6)),Vector((0,0,-1)),3)[0]
   assert hit is not None and abs(hit.z-(.04-i*.11))<.035,'Stair tread obstructed'
 ratio=dry_count/count;assert ratio>.82,f'Insufficient open dry floor: {ratio}'
 result['floors'].append({'floor':entry['floor'],'footprintChecks':checked,'openDrySampleRatio':round(ratio,3)})
 result['files'][entry['model']]=hashlib.sha256((OUT/entry['model']).read_bytes()).hexdigest()
 # Conservative footprint includes grid rounding allowance; generated from exported meshes.
 rows=[]
 for row in range(navigation['size']):
  z=navigation['origin']+row*navigation['step'];line=''
  for col in range(navigation['size']):
   x=navigation['origin']+col*navigation['step']
   line+='1' if all(dry(x+dx,-z+dy) for dx in [-.48,0,.48] for dy in [-.48,0,.48]) else '0'
  rows.append(line)
 navigation['floors'].append({'floor':entry['floor'],'rows':rows})
blend='old-canal.blend' if key=='canal' else key+'.blend'
result['files'][blend]=hashlib.sha256((OUT/blend).read_bytes()).hexdigest()
navfile='navigation.json' if key=='canal' else key+'-navigation.json'
reportfile='clearance.json' if key=='canal' else key+'-clearance.json'
(OUT/navfile).write_text(json.dumps(navigation,separators=(',',':'))+'\n',encoding='utf-8')
result['files'][navfile]=hashlib.sha256((OUT/navfile).read_bytes()).hexdigest()
(OUT/reportfile).write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')
print('WALKABLE GEOMETRY PASSED',result,flush=True)
