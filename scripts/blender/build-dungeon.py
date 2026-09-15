"""Rebuild the approved canal scene. Shared primitives live in dungeon_geometry.py."""
import bpy, json, hashlib
from mathutils import Vector
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
import dungeon_geometry as g
manifest={'templateId':g.T['id'],'cellSize':6,'floors':[]}
for floor in g.T['floors']:
 f=floor['floor'];roots=[];rooms=[r for r in g.T['rooms'] if r['floor']==f];occupancy={(c['row'],c['col']):r['roomId'] for r in rooms for c in r['cells']}
 for room in rooms:
  rid=room['roomId'];g.parent=bpy.data.objects.new(rid,None);g.scene.collection.objects.link(g.parent);g.parent['roomId']=rid;roots.append(g.parent)
  waterroom=any(s in rid for s in ['引水','導渠','蓄水','水閘','沉貨','陷阱'])
  stair='行梯' in rid
  for ci,c in enumerate(room['cells']):
   x=(c['col']-3)*6;y=(3-c['row'])*6
   g.box('Carved rock foundation',(x,y,-1.75 if stair else -1.25),(6,6,1),g.stone,.09)
   if stair:g.stairs(x,y)
   else:g.box('Continuous dry floor',(x,y,-.2),(6,6,.5),g.paving,.035)
   # Boundary masonry, full back walls and cutaway foreground parapets.
   for dr,dc in [(-1,0),(0,-1),(1,0),(0,1)]:
    if occupancy.get((c['row']+dr,c['col']+dc))==rid:continue
    linked=next((l for l in g.T['links'] if l['fromCell']['floor']==f and l['toCell']['floor']==f and { (l['fromCell']['row'],l['fromCell']['col']),(l['toCell']['row'],l['toCell']['col']) }=={(c['row'],c['col']),(c['row']+dr,c['col']+dc)}),None)
    # Shared partition authored once; root stays with one room.
    neighbor=occupancy.get((c['row']+dr,c['col']+dc))
    if neighbor and neighbor<rid:continue
    wx=x+dc*2.84;wy=y-dr*2.84;horizontal=bool(dr);height=2.45 if dr==-1 or dc==-1 else .65
    if linked:
     g.arch(wx,wy,'x' if horizontal else 'y')
     if linked['kind']=='redDoor':
      door=bpy.data.objects.new('Door '+linked['linkId'],None);g.scene.collection.objects.link(door);door.parent=g.parent;door['linkId']=linked['linkId'];old=g.parent;g.parent=door
      g.box('Bronze banded door',(wx,wy,1.0),(1.8,.15,2.0) if horizontal else (.15,1.8,2.0),g.wood)
      for z in [.3,1.5]:g.box('Door strap',(wx,wy,z),(1.9,.19,.12) if horizontal else (.19,1.9,.12),g.bronze)
      g.parent=old
    sections=[(-2.0,1.55),(2.0,1.55)] if linked else [(0,5.7)]
    for off,length in sections:
     px=wx+off if horizontal else wx;py=wy if horizontal else wy+off
     g.box('Damp masonry wall',(px,py,height/2),(length,.38,height) if horizontal else (.38,length,height),g.stone)
     g.box('Wall coping',(px,py,height+.04),(length+.08,.52,.15) if horizontal else (.52,length+.08,.15),g.edge)
     # Buttresses give real silhouette and scale to the masonry.
     for u in [-length*.4,length*.4]:g.box('Wall buttress',(px+u if horizontal else px,py if horizontal else py+u,height*.45),(.48,.55,height*.9),g.stone)
   # Lighting is also attached to a real back wall, not repeated inside a hall.
   if occupancy.get((c['row']-1,c['col']))!=rid:g.lantern(x-2.1,y+2.5)
  if not stair and '入口' not in rid:g.wall_dressing(room,occupancy,f)
  # Metadata marker is placed on traversable floor, never inferred from prop bounds.
  anchor=room['cells'][0];g.parent['anchor']=[(anchor['col']-3)*6,.12,(anchor['row']-3)*6]
  # Reduce draw calls while preserving separately operable doors and room roots.
  for mat in [g.stone,g.paving,g.wood,g.bronze,g.water,g.edge,g.iron,g.clay,g.light,g.rope,g.moss]:
   parts=[o for o in g.parent.children_recursive if o.type=='MESH' and o.parent==g.parent and o.data.materials[0]==mat]
   if not parts:continue
   bpy.ops.object.select_all(action='DESELECT')
   for o in parts:o.select_set(True)
   bpy.context.view_layer.objects.active=parts[0];bpy.ops.object.join()
 g.parent=None
 key='canal-upper' if f==1 else 'canal-lower'
 bpy.ops.object.select_all(action='DESELECT')
 for root in roots:
  root.select_set(True)
  for o in root.children_recursive:o.select_set(True)
 bpy.ops.export_scene.gltf(filepath=str(g.OUT/(key+'.glb')),export_format='GLB',use_selection=True,export_extras=True,export_yup=True)
 manifest['floors'].append({'floor':f,'model':key+'.glb','roomIds':[r['roomId'] for r in rooms],'rooms':rooms})
 # Offline lit preview of each full floor.
 for o in g.scene.objects:o.hide_render=not(o in roots or any(p in roots for p in [o.parent,o.parent.parent if o.parent else None]))
 bpy.ops.object.camera_add(location=(29,-38,38));camera=bpy.context.object;camera.rotation_euler=(Vector((0,0,0))-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.type='ORTHO';camera.data.ortho_scale=46;g.scene.camera=camera
 for pos,power,size,color in [((0,-8,20),4500,14,(.68,.85,1)),((-8,5,15),3200,12,(1,.73,.4))]:
  bpy.ops.object.light_add(type='AREA',location=pos);lamp=bpy.context.object;lamp.data.energy=power;lamp.data.shape='DISK';lamp.data.size=size;lamp.data.color=color;lamp.rotation_euler=(Vector((0,0,0))-lamp.location).to_track_quat('-Z','Y').to_euler()
 g.scene.render.filepath=str(g.OUT/(key+'.png'));bpy.ops.render.render(write_still=True)
 for o in list(g.scene.objects):
  if o.type in ['LIGHT','CAMERA']:bpy.data.objects.remove(o,do_unlink=True)
 for root in roots:
  for o in list(root.children_recursive):bpy.data.objects.remove(o,do_unlink=True)
  root.hide_render=True
 # Retain geometry in the editable file by importing the packed exported GLB after both floors.
for o in list(g.scene.objects):bpy.data.objects.remove(o,do_unlink=True)
for entry in manifest['floors']:
 bpy.ops.import_scene.gltf(filepath=str(g.OUT/entry['model']))
 for o in bpy.context.selected_objects:
  if not o.parent:o.location.z=0 if entry['floor']==1 else -7
bpy.ops.wm.save_as_mainfile(filepath=str(g.OUT/'old-canal.blend'))
manifest['topologyHash']=hashlib.sha256(json.dumps({'rooms':g.T['rooms'],'links':g.T['links']},ensure_ascii=False,sort_keys=True).encode()).hexdigest()
(g.OUT/'canal.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print('CANAL COMPLETE',flush=True)
