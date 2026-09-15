"""Author one shipped adventure map. Pass -- <profile key>; canal has its own builder.
Boundaries follow actual topology. Scenery occupies shallow edge strips; no encounter data.
"""
import sys, json, math, random, hashlib
import bpy
from mathutils import Vector, Matrix
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
import dungeon_geometry as g

key=sys.argv[sys.argv.index('--')+1]
p=next(p for p in json.loads((g.ROOT/'scripts/blender/dungeon-profiles.json').read_text(encoding='utf-8')) if p['key']==key)
g.T=next(t for t in g.DATA if t.get('id')=='map-template.yunhua.'+key)
theme=p['theme'];outdoor=theme in ['bamboo','reed','ridge','court'];natural=theme in ['bamboo','reed','ridge','grotto']
random.seed(key)
ground=g.material(key+' ground',p['tint'])
rock=g.material(key+' strata',p['tint'])
leaf=g.material('Bamboo jade foliage',(.18,.34,.15))
stalk=g.material('Jointed bamboo',(.30,.40,.16))
salt=g.material('Translucent salt crystals',(.82,.91,.86),.3)
red=g.material('Cinnabar ore and lacquer',(.48,.09,.035),.65)
paper=g.material('Aged scroll paper',(.76,.64,.39))
ash=g.material('Kiln charcoal',(.10,.085,.065))
materials=[g.stone,g.paving,g.wood,g.bronze,g.water,g.edge,g.iron,g.clay,g.light,g.rope,g.moss,ground,rock,leaf,stalk,salt,red,paper,ash]
# Reuse authored geology textures at a stable physical scale with packed tangent normals.
def surface(mat,source):
 n=mat.node_tree.nodes;l=mat.node_tree.links;bs=n.get('Principled BSDF')
 tex=n.new('ShaderNodeTexImage');tex.image=bpy.data.images.load(str(g.ROOT/'app/assets/geography'/f'{source}-albedo.png'));tex.image.pack()
 tint=n.new('ShaderNodeMix');tint.data_type='RGBA';tint.blend_type='MULTIPLY';tint.inputs[0].default_value=1;tint.inputs[7].default_value=(*p['tint'],1);l.new(tex.outputs['Color'],tint.inputs[6]);l.new(tint.outputs[2],bs.inputs['Base Color'])
 tex=n.new('ShaderNodeTexImage');tex.image=bpy.data.images.load(str(g.ROOT/'app/assets/geography'/f'{source}-normal.png'));tex.image.colorspace_settings.name='Non-Color';tex.image.pack()
 nm=n.new('ShaderNodeNormalMap');nm.inputs['Strength'].default_value=.5;l.new(tex.outputs['Color'],nm.inputs['Color']);l.new(nm.outputs[0],bs.inputs['Normal'])
surface(rock,'rock')
if theme=='bamboo':surface(ground,'meadow')
else:
 # Fine walkable surfaces use their own atlas, never the jagged cliff texture.
 indoor=theme in ['court','tower']
 tex_image=g.atlas if indoor else bpy.data.images.load(str(g.OUT/'ground-atlas.png'))
 tex_image.pack();ground['atlasCell']=1 if indoor else {'grotto':1,'salt':2,'ridge':3,'kiln':3,'reed':0}[theme]
 n=ground.node_tree.nodes;l=ground.node_tree.links;bs=n.get('Principled BSDF')
 tex=n.new('ShaderNodeTexImage');tex.image=tex_image;l.new(tex.outputs['Color'],bs.inputs['Base Color'])
 normal=g.normal if indoor else bpy.data.images.load(str(g.OUT/'ground-normal.png'))
 normal.colorspace_settings.name='Non-Color';normal.pack();tex=n.new('ShaderNodeTexImage');tex.image=normal
 nm=n.new('ShaderNodeNormalMap');nm.inputs['Strength'].default_value=.35;l.new(tex.outputs['Color'],nm.inputs[1]);l.new(nm.outputs[0],bs.inputs['Normal'])

def boulder(x,y,z,sx,sy,sz,mat=rock):
 bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2,radius=1,location=(x,y,z));o=bpy.context.object;o.scale=(sx,sy,sz)
 o.rotation_euler.z=random.random()*math.tau;g.finish(o,'Weathered irregular outcrop',mat)
 # Explicit spherical UV for authored image surfaces.
 uv=o.data.uv_layers.new(name='Rock UV')
 for poly in o.data.polygons:
  for i in poly.loop_indices:
   v=o.data.vertices[o.data.loops[i].vertex_index].co;uv.data[i].uv=(.5+math.atan2(v.y,v.x)/math.tau,.5+math.asin(max(-1,min(1,v.z)))/math.pi)

def torus(name,pos,r,t,mat,rotation=(0,0,0)):
 bpy.ops.mesh.primitive_torus_add(major_radius=r,minor_radius=t,major_segments=32,minor_segments=6,location=pos,rotation=rotation);return g.finish(bpy.context.object,name,mat)

def twig(name,a,b,r,mat):
 d=Vector(b)-Vector(a);bpy.ops.mesh.primitive_cylinder_add(vertices=8,radius=r,depth=d.length,location=(Vector(a)+Vector(b))/2)
 o=bpy.context.object;o.rotation_euler=d.to_track_quat('Z','Y').to_euler();return g.finish(o,name,mat)

def bamboo(x,y,reed=False):
 for i in range(4 if reed else 3):
  xx=x+random.uniform(-.23,.23);yy=y+random.uniform(-.18,.18);h=random.uniform(1.1,1.8) if reed else random.uniform(2.2,3.7)
  twig('Reed stem' if reed else 'Bamboo culm',(xx,yy,.08),(xx+.1,yy,h),.023 if reed else .065,stalk)
  if reed:twig('Reed seed plume',(xx+.1,yy,h-.15),(xx+.1,yy,h+.15),.065,g.rope)
  else:
   for z in [.6,1.2,1.8]:twig('Raised bamboo node',(xx+.1*z/h,yy,z-.022),(xx+.1*z/h,yy,z+.022),.079,stalk)
  for j in range(3):
   z=h-.2-j*.22;angle=j*2.4+i*.7
   for k in range(3):
    a=angle+(k-1)*.55;length=random.uniform(.45,.75);origin=Vector((xx+.1,yy,z));direction=Vector((math.cos(a),math.sin(a),-.25));side=Vector((-math.sin(a),math.cos(a),0))
    verts=[origin,origin+direction*length*.4+side*.10,origin+direction*length*.7+side*.065,origin+direction*length,origin+direction*length*.55-side*.08]
    mesh=bpy.data.meshes.new('Lanceolate bamboo leaf');mesh.from_pydata(verts,[],[(0,1,2),(0,2,3),(0,3,4)]);mesh.update();o=bpy.data.objects.new('Fine tapered leaf',mesh);g.scene.collection.objects.link(o);g.finish(o,'Fine tapered leaf',leaf)
    uv=mesh.uv_layers.new(name='Leaf UV')
    for poly in mesh.polygons:
     for li in poly.loop_indices:uv.data[li].uv=(mesh.loops[li].vertex_index/4,li%2)

def scrolls():
 for x in [-1.2,1.2]:g.box('Lacquer bookcase upright',(x,0,1.15),(.14,.6,2.3),red)
 for z in [.22,.9,1.6,2.3]:
  g.box('Library shelf',(0,0,z),(2.6,.65,.10),g.wood)
  if z<2:
   for i in range(7):
    o=g.cyl('Bound vertical scroll',(-1+i*.32,0,z+.27),.11,.44,paper,12)
    torus('Scroll binding',(-1+i*.32,0,z+.28),.114,.012,red)

def apparatus():
 g.cyl('Astronomical plinth',(0,0,.23),.65,.36,g.stone)
 g.cyl('Bronze instrument column',(0,0,.72),.13,.75,g.bronze)
 torus('Armillary equator',(0,0,1.4),.55,.035,g.bronze)
 torus('Armillary meridian',(0,0,1.4),.55,.035,g.bronze,(math.pi/2,.3,0))
 g.beam('Gnomon axis',(-.4,0,1),( .4,0,1.8),.025,g.bronze)

def kiln():
 # Dome segments wrap around a small opening facing the room; real firebox, no painted door.
 for j in range(4):
  radius=.72-j*.10;z=.22+j*.25
  for i in range(12):
   a=math.tau*i/12
   if j<2 and i in [8,9,10]:continue
   o=g.box('Radial kiln brick',(math.cos(a)*radius,math.sin(a)*radius*.52,z),(.35,.24,.22),g.clay,.035);o.rotation_euler.z=a+math.pi/2
 g.cyl('Kiln chimney',(0,.1,1.38),.18,.7,ash,16)
 g.box('Kiln hearth',(0,0,.11),(1.5,.8,.1),ash)

def dressing(variant,index):
 if variant=='bamboo':
  for x in [-1.2,-.35,.7,1.4]:bamboo(x,0)
  if index%2==0:
   g.box('Herb drying table',(0,-.1,.62),(1.8,.65,.08),g.wood)
   for x in [-.7,.7]:g.box('Drying rack leg',(x,0,.3),(.08,.08,.6),g.wood)
 elif variant=='reed':
  g.box('Tidal margin',(0,0,.08),(3.7,.7,.09),g.water,0)
  for x in [-1.5,-.7,.3,1.4]:bamboo(x,0,True)
  if index%2:
   for x in [-.6,.6]:g.box('Fish drying pole',(x,-.15,.75),(.06,.06,1.5),g.wood)
   twig('Net drying line',(-.6,-.15,1.3),(.6,-.15,1.3),.018,g.rope)
   for i in range(7):twig('Hanging net cord',(-.6+i*.2,-.15,.4),(-.6+i*.2,-.15,1.3),.009,g.rope)
 elif variant=='grotto':
  g.box('Spring edge pool',(0,0,.08),(3.4,.7,.06),g.water,0)
  for x in [-1.3,-.6,.65,1.35]:
   h=random.uniform(.5,1.5);bpy.ops.mesh.primitive_cone_add(vertices=16,radius1=.22,radius2=.05,depth=h,location=(x,.05,h/2+.1));g.finish(bpy.context.object,'Calcite stalagmite',salt)
 elif variant=='ridge':
  for x in [-1.3,-.4,.8]:boulder(x,0,.38,.42,.30,random.uniform(.35,.8),red if index%2 else rock)
  if index%2==0:
   g.crate(1.5,0,size=.55);g.beam('Miner pick haft',(-.9,-.2,.12),(.1,-.2,.2),.03,g.wood);g.beam('Miner pick head',(.05,-.4,.2),(.15,.1,.2),.035,g.iron)
 elif variant=='salt':
  for x in [-.9,0,.9]:
   g.cyl('Brine evaporating pan',(x,0,.35),.4,.15,g.bronze)
   for dx in [-.18,.18]:
    bpy.ops.mesh.primitive_cone_add(vertices=5,radius1=.16,radius2=.08,depth=.28,location=(x+dx,0,.52));g.finish(bpy.context.object,'Salt crystal cluster',salt)
 elif variant=='kiln':
  if index%2==0:kiln();g.cyl('Unfired pot',(1.3,0,.4),.25,.7,g.clay)
  else:g.shelving(0,0)
 elif variant=='tower':
  if index%3==0:apparatus()
  elif index%3==1:scrolls()
  else:
   g.box('Seal carvers workbench',(0,0,.7),(2.4,.7,.18),g.wood)
   for x in [-.9,.9]:g.box('Bench trestle',(x,0,.35),(.12,.5,.7),g.wood)
   for x in [-.7,0,.7]:g.box('Carved seal stone',(x,0,.92),(.3,.3,.26),red)
 elif variant=='court':
  if index%3==0:apparatus()
  elif index%3==1:
   for x,h in [(-1,1.9),(1,.8)]:
    g.cyl('Broken column base',(x,0,.15),.42,.22,g.stone)
    g.cyl('Fluted surviving column',(x,0,h/2),.24,h,g.stone,16)
    g.box('Column capital',(x,0,h),(.65,.6,.16),g.edge)
  else:
   g.box('Fallen inscription stele',(0,0,.7),(1.3,.45,1.35),g.stone)
   for z in [.4,.7,1.0]:
    for x in [-.35,0,.35]:g.box('Carved calendar mark',(x,-.238,z),(.12,.012,.13),g.bronze,.005)

manifest={'templateId':g.T['id'],'key':key,'name':p['name'],'cellSize':6,'floors':[]}
for fi,floor in enumerate(g.T['floors']):
 f=floor['floor'];rooms=[r for r in g.T['rooms'] if r['floor']==f];roots=[]
 occupancy={(c['row'],c['col']):r['roomId'] for r in rooms for c in r['cells']}
 link_edges={frozenset(((l['fromCell']['row'],l['fromCell']['col']),(l['toCell']['row'],l['toCell']['col']))):l for l in g.T['links'] if l['fromCell']['floor']==f and l['toCell']['floor']==f}
 for ri,room in enumerate(rooms):
  rid=room['roomId'];root=bpy.data.objects.new(rid,None);g.scene.collection.objects.link(root);root['roomId']=rid;g.parent=root;roots.append(root)
  stair_cells={(l[side]['row'],l[side]['col']) for l in g.T['links'] if l['fromCell']['floor']!=l['toCell']['floor'] for side in ['fromCell','toCell'] if l[side]['floor']==f and occupancy.get((l[side]['row'],l[side]['col']))==rid}
  edges=[]
  for c in room['cells']:
   row,col=c['row'],c['col'];x,y=(col-3)*6,(3-row)*6;stair=(row,col) in stair_cells
   g.box('Stratified foundation',(x,y,-1.75 if stair else -.55),(6,6,1 if stair else .7),rock,.04)
   if stair:g.stairs(x,y)
   else:
    tile=g.box('Continuous traversable ground',(x,y,-.2),(6,6,.5),ground,.015)
    if theme=='bamboo':
     # Use the entire grass image across six metres, not a stretched cube-atlas quarter.
     uv=tile.data.uv_layers.active
     for poly in tile.data.polygons:
      for li in poly.loop_indices:
       v=tile.data.vertices[tile.data.loops[li].vertex_index].co;uv.data[li].uv=((v.x+3)/6,(v.y+3)/6)
   for dr,dc in [(-1,0),(0,-1),(1,0),(0,1)]:
    neighbor=occupancy.get((row+dr,col+dc))
    if neighbor==rid:continue
    link=link_edges.get(frozenset(((row,col),(row+dr,col+dc))))
    if not link and not stair:edges.append((c,dr,dc))
    if neighbor and neighbor<rid:continue
    wx,wy=x+dc*2.84,y-dr*2.84;horizontal=bool(dr);h=(2.5 if dr==-1 or dc==-1 else .65)
    if link:
     if not natural:g.arch(wx,wy,'x' if horizontal else 'y')
     else:
      for u in [-1.18,1.18]:g.box('Passage marker',(wx+u if horizontal else wx,wy if horizontal else wy+u,.42),(.25,.25,.84),g.wood if theme in ['bamboo','reed'] else rock)
     if link['kind']=='redDoor':
      door=bpy.data.objects.new('Gate '+link['linkId'],None);g.scene.collection.objects.link(door);door.parent=root;door['linkId']=link['linkId'];g.parent=door
      g.box('Closable gate',(wx,wy,.85),(1.8,.15,1.7) if horizontal else (.15,1.8,1.7),g.wood);g.parent=root
    for off,length in ([(-2.0,1.55),(2.0,1.55)] if link else [(0,5.7)]):
     px,py=(wx+off,wy) if horizontal else (wx,wy+off)
     if natural:
      # Continuous low rim prevents an invisible collision wall between decorative outcrops.
      g.box('Natural boundary ledge',(px,py,.28),(length,.38,.56) if horizontal else (.38,length,.56),rock,.10)
      for j in range(max(1,round(length/1.1))):
       u=(j+.5)*length/max(1,round(length/1.1))-length/2
       boulder(px+u if horizontal else px,py if horizontal else py+u,h*.38,.52 if horizontal else .22,.22 if horizontal else .52,h*.48)
     else:
      mat=g.stone
      g.box('Coursed retaining masonry',(px,py,h/2),(length,.38,h) if horizontal else (.38,length,h),mat)
      for z in [.18,h*.52,h]:g.box('Masonry string course',(px,py,z),(length+.06,.48,.10) if horizontal else (.48,length+.06,.10),g.edge)
      for u in [-length*.4,length*.4]:g.box('Wall pilaster',(px+u if horizontal else px,py if horizontal else py+u,h/2),(.35,.48,h),mat)
   if not outdoor and occupancy.get((row-1,col))!=rid:g.lantern(x-2.1,y+2.5)
  # At most one shallow arrangement per edge cell; actual door and stair cells excluded.
  g.parent=bpy.data.objects.new('Room contents',None);g.scene.collection.objects.link(g.parent);g.parent.parent=root;g.parent['visualRole']='contents'
  edges.sort(key=lambda e:(0 if e[1]==-1 else 1 if e[2]==-1 else 2,e[0]['row'],e[0]['col']))
  used=set()
  for c,dr,dc in edges:
   cell=(c['row'],c['col'])
   if cell in used:continue
   if len(used)>=min(6,len(room['cells'])):break
   before=set(g.scene.objects);dressing(theme,ri+len(used));used.add(cell)
   angle=0 if dr==-1 else math.pi/2 if dc==-1 else math.pi if dr==1 else -math.pi/2
   matrix=Matrix.Translation(Vector(((c['col']-3)*6+dc*2.25,(3-c['row'])*6-dr*2.25,0)))@Matrix.Rotation(angle,4,'Z')
   for o in set(g.scene.objects)-before:o.matrix_world=matrix@o.matrix_world
  g.parent=root;c=room['cells'][0];root['anchor']=[(c['col']-3)*6,.12,(c['row']-3)*6]
  # Merge structural and content meshes independently, preserving visibility semantics.
  for group in [root]+[o for o in root.children if o.get('visualRole')=='contents']:
   for mat in materials:
    parts=[o for o in group.children if o.type=='MESH' and o.data.materials[0]==mat]
    if len(parts)<2:continue
    bpy.ops.object.select_all(action='DESELECT')
    for o in parts:o.select_set(True)
    bpy.context.view_layer.objects.active=parts[0];bpy.ops.object.join()
 # Detail budget applies only to movable dressing. Floors, walls, doors and stairs stay exact.
 meshes=[o for root in roots for o in root.children_recursive if o.type=='MESH']
 detail=[o for o in meshes if o.parent.get('visualRole')=='contents']
 tris=lambda o:sum(len(poly.vertices)-2 for poly in o.data.polygons)
 total=sum(tris(o) for o in meshes);detailed=sum(tris(o) for o in detail)
 if total>145000:
  ratio=(145000-(total-detailed))/detailed
  assert ratio>.15,'Structural geometry exceeds floor budget'
  for o in detail:
   mod=o.modifiers.new('Preserve silhouette detail budget','DECIMATE');mod.ratio=ratio
   bpy.context.view_layer.objects.active=o;bpy.ops.object.modifier_apply(modifier=mod.name)
 g.parent=None;model=f'{key}-{f}.glb'
 bpy.ops.object.select_all(action='DESELECT')
 for root in roots:
  root.select_set(True)
  for o in root.children_recursive:o.select_set(True)
 bpy.ops.export_scene.gltf(filepath=str(g.OUT/model),export_format='GLB',use_selection=True,export_extras=True,export_yup=True)
 manifest['floors'].append({'floor':f,'label':p['floors'][fi],'model':model,'roomIds':[r['roomId'] for r in rooms],'rooms':rooms,'rows':floor['rows'],'cols':floor['cols']})
 center=Vector(((floor['cols']-5)*3,(5-floor['rows'])*3,0))
 bpy.ops.object.camera_add(location=center+Vector((29,-38,38)));camera=bpy.context.object;camera.rotation_euler=(center-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.type='ORTHO';camera.data.ortho_scale=max(floor['rows'],floor['cols'])*9;g.scene.camera=camera
 for pos,power,color in [((0,-8,24),6500,(.8,.9,1)),((-8,5,20),5000,(1,.8,.55))]:
  bpy.ops.object.light_add(type='AREA',location=center+Vector(pos));lamp=bpy.context.object;lamp.data.energy=power;lamp.data.size=20;lamp.data.color=color;lamp.rotation_euler=(center-lamp.location).to_track_quat('-Z','Y').to_euler()
 g.scene.render.engine='CYCLES';g.scene.cycles.samples=8;g.scene.render.resolution_percentage=60
 g.scene.render.filepath=str(g.OUT/model.replace('.glb','.png'));bpy.ops.render.render(write_still=True)
 for o in list(g.scene.objects):bpy.data.objects.remove(o,do_unlink=True)
 print('FLOOR EXPORTED',model,flush=True)
for index,entry in enumerate(manifest['floors']):
 bpy.ops.import_scene.gltf(filepath=str(g.OUT/entry['model']))
 for o in bpy.context.selected_objects:
  if not o.parent:o.location.z=-index*8
bpy.ops.wm.save_as_mainfile(filepath=str(g.OUT/(key+'.blend')))
manifest['topologyHash']=hashlib.sha256(json.dumps({'rooms':g.T['rooms'],'links':g.T['links']},ensure_ascii=False,sort_keys=True).encode()).hexdigest()
(g.OUT/(key+'.json')).write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print('MAP COMPLETE',key,flush=True)
