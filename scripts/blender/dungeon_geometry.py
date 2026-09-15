"""Editable canal cutaway, built against the shipped room/link topology.
blender --background --python-exit-code 1 --python scripts/blender/build-dungeon.py
Geometry and dressing are presentation only; no generated gameplay contents.
"""
import bpy, math, json, random, hashlib
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'app/assets/dungeons'
OUT.mkdir(parents=True,exist_ok=True)
DATA=json.loads((ROOT/'content/yunhua/maps.json').read_text(encoding='utf-8'))
T=next(x for x in DATA if x.get('id')=='map-template.yunhua.old-canal-sunken-store')
random.seed(37)
bpy.context.preferences.filepaths.save_version=0
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
scene=bpy.context.scene
scene.render.engine='CYCLES';scene.cycles.samples=24;scene.cycles.use_denoising=True
scene.render.resolution_x=1600;scene.render.resolution_y=1000;scene.render.resolution_percentage=100
scene.world.use_nodes=True
scene.world.node_tree.nodes['Background'].inputs[0].default_value=(.12,.22,.25,1)
scene.world.node_tree.nodes['Background'].inputs[1].default_value=.55
scene.view_settings.view_transform='AgX'
atlas=bpy.data.images.load(str(OUT/'canal-atlas.png'));atlas.pack()
def material(name,color,rough=.8,metal=0,emission=0,cell=None):
 m=bpy.data.materials.new(name);m.diffuse_color=(*color,1);m.use_nodes=True
 p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(*color,1);p.inputs['Roughness'].default_value=rough;p.inputs['Metallic'].default_value=metal
 if emission:p.inputs['Emission Color'].default_value=(*color,1);p.inputs['Emission Strength'].default_value=emission
 if cell is not None:
  tex=m.node_tree.nodes.new('ShaderNodeTexImage');tex.image=atlas;m.node_tree.links.new(tex.outputs['Color'],p.inputs['Base Color']);m['atlasCell']=cell
 return m
stone=material('Wet hand-cut canal masonry',(1,1,1),.78,cell=0)
paving=material('Fine worn limestone',(1,1,1),.83,cell=1)
wood=material('Water-aged cedar',(1,1,1),.85,cell=2)
bronze=material('Oxidised sluice bronze',(1,1,1),.4,.65,cell=3)
water=material('Deep jade water',(.025,.18,.17),.18,.35)
edge=material('Pale worn stone edges',(.36,.40,.33))
iron=material('Forged iron',(.075,.10,.105),.4,.75)
clay=material('Unglazed grain jars',(.33,.19,.085))
light=material('Amber lantern glass',(1,.37,.07),.3,emission=3)
rope=material('Woven hemp',(.35,.28,.15))
moss=material('Algae at the waterline',(.12,.22,.10))
# Bake surface relief into a real tangent-space normal map used by GLB as well.
normal_path=OUT/'canal-normal.png'
if not normal_path.exists():
 bake=material('Atlas normal bake',(1,1,1));n=bake.node_tree.nodes;l=bake.node_tree.links
 tex=n.new('ShaderNodeTexImage');tex.image=atlas
 bump=n.new('ShaderNodeBump');bump.inputs['Distance'].default_value=.025;l.new(tex.outputs['Color'],bump.inputs['Height']);l.new(bump.outputs['Normal'],n.get('Principled BSDF').inputs['Normal'])
 image=bpy.data.images.new('Canal tangent relief',1024,1024);target=n.new('ShaderNodeTexImage');target.image=image;n.active=target
 bpy.ops.mesh.primitive_plane_add(size=2);obj=bpy.context.object;obj.data.materials.append(bake)
 scene.render.bake.margin=8;bpy.ops.object.bake(type='NORMAL');image.filepath_raw=str(normal_path);image.file_format='PNG';image.save();bpy.data.objects.remove(obj,do_unlink=True)
normal=bpy.data.images.load(str(normal_path));normal.colorspace_settings.name='Non-Color';normal.pack()
for m in [stone,paving,wood,bronze]:
 n=m.node_tree.nodes;l=m.node_tree.links;tex=n.new('ShaderNodeTexImage');tex.image=normal;nm=n.new('ShaderNodeNormalMap');nm.inputs['Strength'].default_value=.55;l.new(tex.outputs['Color'],nm.inputs['Color']);l.new(nm.outputs['Normal'],n.get('Principled BSDF').inputs['Normal'])
parent=None

def finish(o,name,mat,bevel=0):
 o.name=name;o.parent=parent;o.data.materials.append(mat)
 bpy.context.view_layer.update()
 # Physical projection, quadrant-inset per face. Small masonry units do not contain entire brick walls.
 if 'atlasCell' in mat:
  uv=o.data.uv_layers.active or o.data.uv_layers.new(name='Canal UV');cell=mat['atlasCell'];ox=(cell%2)*.5;oy=.5 if cell<2 else 0
  for poly in o.data.polygons:
   axes=[a for a in range(3) if a!=max(range(3),key=lambda k:abs(poly.normal[k]))]
   coords=[o.data.vertices[o.data.loops[i].vertex_index].co for i in poly.loop_indices]
   lo=[min(v[a] for v in coords) for a in axes];hi=[max(v[a] for v in coords) for a in axes]
   for i in poly.loop_indices:
    v=o.data.vertices[o.data.loops[i].vertex_index].co
    uv.data[i].uv=(ox+.015+.47*(v[axes[0]]-lo[0])/max(.001,hi[0]-lo[0]),oy+.015+.47*(v[axes[1]]-lo[1])/max(.001,hi[1]-lo[1]))
 if bevel:
  mod=o.modifiers.new('Soft chipped edges','BEVEL');mod.width=bevel;mod.segments=2
  bpy.context.view_layer.objects.active=o;bpy.ops.object.modifier_apply(modifier=mod.name)
 return o

def box(name,p,s,mat,bevel=.035):
 bpy.ops.mesh.primitive_cube_add(size=1,location=p);o=bpy.context.object;o.scale=s;bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);return finish(o,name,mat,bevel)
def cyl(name,p,r,h,mat,vertices=24):
 bpy.ops.mesh.primitive_cylinder_add(vertices=vertices,radius=r,depth=h,location=p);return finish(bpy.context.object,name,mat,.02)
def beam(name,a,b,r,mat):
 d=Vector(b)-Vector(a);o=cyl(name,(Vector(a)+Vector(b))/2,r,d.length,mat,12);o.rotation_euler=d.to_track_quat('Z','Y').to_euler();return o

def arch(x,y,along):
 # True voussoirs around an unobstructed opening, no solid cube across doorway.
 def point(u,z):return (x+u if along=='x' else x,y if along=='x' else y+u,z)
 for side in [-1,1]:
  p=point(side*1.1,.85);box('Arch pier',p,(.4,.65,1.7) if along=='x' else (.65,.4,1.7),stone)
 for i in range(15):
  a=math.pi*i/15;b=math.pi*(i+1)/15
  verts=[]
  for depth in [-.32,.32]:
   for radius,t in [(1,a),(1,b),(1.35,b),(1.35,a)]:
    u=math.cos(t)*radius;z=1.65+math.sin(t)*radius
    verts.append((x+u,y+depth,z) if along=='x' else (x+depth,y+u,z))
  mesh=bpy.data.meshes.new('Arch wedge');mesh.from_pydata(verts,[],[(0,1,2,3),(4,7,6,5),(0,4,5,1),(1,5,6,2),(2,6,7,3),(3,7,4,0)]);mesh.update();o=bpy.data.objects.new('Radial arch stone',mesh);scene.collection.objects.link(o);finish(o,'Radial arch stone',edge)

def lantern(x,y):
 beam('Lantern bracket',(x,y,1.85),(x+.5,y,1.85),.045,iron)
 cyl('Lantern amber heart',(x+.48,y,1.48),.16,.46,light)
 for z in [1.23,1.72]:box('Lantern cap',(x+.48,y,z),(.43,.43,.08),bronze)
 for a in range(4):
  t=a*math.pi/2;beam('Lantern cage',(x+.48+math.cos(t)*.17,y+math.sin(t)*.17,1.23),(x+.48+math.cos(t)*.17,y+math.sin(t)*.17,1.74),.022,iron)

def crate(x,y,z=0,size=.85):
 box('Cargo crate',(x,y,z+size/2),(size,size*.8,size),wood)
 for yy in [-.41,.41]:
  for xx in [-.38,.38]:box('Crate binding',(x+xx*size,y+yy*size,z+size/2),(.07,.045,size+.08),iron,.01)
 beam('Crate diagonal',(x-size*.4,y-size*.42,z+.08),(x+size*.4,y-size*.42,z+size-.08),.035,wood)
def barrel(x,y):
 # Turned profile gives shoulders, staves and hoop silhouette.
 verts=[];faces=[];profile=[(0,.32),(.1,.37),(.4,.43),(.78,.39),(.9,.32)]
 for z,r in profile:
  for i in range(24):a=math.tau*i/24;verts.append((x+math.cos(a)*r,y+math.sin(a)*r,z))
 for j in range(4):
  for i in range(24):k=j*24+i;l=j*24+(i+1)%24;faces.append((k,l,l+24,k+24))
 faces.extend([tuple(reversed(range(24))),tuple(range(96,120))]);mesh=bpy.data.meshes.new('Barrel staves');mesh.from_pydata(verts,[],faces);mesh.update();o=bpy.data.objects.new('Coopered barrel',mesh);scene.collection.objects.link(o);finish(o,'Coopered barrel',wood)
 for z,r in [(.12,.38),(.72,.405)]:
  bpy.ops.mesh.primitive_torus_add(major_radius=r,minor_radius=.035,major_segments=24,minor_segments=6,location=(x,y,z));finish(bpy.context.object,'Iron barrel hoop',iron)

def shelving(x,y):
 for dx in [-.9,.9]:
  for dy in [-.35,.35]:box('Shelf upright',(x+dx,y+dy,1.05),(.12,.12,2.1),wood)
 for z in [.25,1,1.8]:
  box('Storage shelf',(x,y,z),(2,.85,.10),wood)
  for j in range(3):
   cyl('Earthen jar belly',(x-.62+j*.61,y,z+.31),.22,.46,clay)
   cyl('Jar narrow neck',(x-.62+j*.61,y,z+.57),.13,.10,clay)
   bpy.ops.mesh.primitive_torus_add(major_radius=.13,minor_radius=.025,major_segments=20,minor_segments=6,location=(x-.62+j*.61,y,z+.63));finish(bpy.context.object,'Jar open rim',clay)

def cart(x,y):
 box('Porter handcart',(x,y,.48),(1.4,1.65,.16),wood)
 for side in [-1,1]:
  for z in [.72,1.0]:box('Cart side board',(x+side*.67,y,z),(.09,1.6,.15),wood)
  beam('Cart handle',(x+side*.5,y-.8,.48),(x+side*.5,y-1.7,.82),.055,wood)
  bpy.ops.mesh.primitive_torus_add(major_radius=.34,minor_radius=.065,major_segments=24,minor_segments=8,location=(x+side*.8,y,.35),rotation=(0,math.pi/2,0));finish(bpy.context.object,'Cart wheel',wood)
  for j in range(6):
   a=j*math.tau/6;beam('Wheel spoke',(x+side*.8,y,.35),(x+side*.8,y+math.cos(a)*.34,.35+math.sin(a)*.34),.025,wood)
 crate(x,y,.58,.62)

def stairs(x,y):
 # 1.4 x 2.0 corner stair; upper landing faces the open room, descent toward wall.
 sx=x-1.95;sy=y+1.65
 xmin,xmax=sx-.70,sx+.70;ymin,ymax=sy-1.0,sy+1.0
 for xa,xb,ya,yb in [(x-3,xmin,y-3,y+3),(xmax,x+3,y-3,y+3),(xmin,xmax,y-3,ymin),(xmin,xmax,ymax,y+3)]:
  box('Stair bypass landing',((xa+xb)/2,(ya+yb)/2,-.2),(xb-xa,yb-ya,.5),paving)
 box('Stair well bottom',(sx,sy,-1.05),(1.4,2.0,.2),stone)
 for i in range(8):box('Compact descending tread',(sx,sy-.875+i*.25,-.06-i*.11),(1.12,.27,.2),paving,.018)
 for dx in [-.65,.65]:
  beam('Compact stair rail',(sx+dx,sy-.9,.87),(sx+dx,sy+.9,.03),.04,iron)
  for i in [0,3,7]:beam('Compact rail post',(sx+dx,sy-.875+i*.25,.04-i*.11),(sx+dx,sy-.875+i*.25,.87-i*.11),.035,iron)

def wall_dressing(room, occupancy, floor):
 global parent
 room_root=parent
 parent=bpy.data.objects.new('Room contents',None);scene.collection.objects.link(parent);parent.parent=room_root;parent['visualRole']='contents'
 # Candidates are actual room boundaries, never internal cell seams; doors stay clear.
 candidates=[]
 for c in room['cells']:
  for dr,dc,angle in [(-1,0,0),(0,-1,math.pi/2),(1,0,math.pi),(0,1,-math.pi/2)]:
   if occupancy.get((c['row']+dr,c['col']+dc))==room['roomId']:continue
   edge_cells={(c['row'],c['col']),(c['row']+dr,c['col']+dc)}
   if any(l['fromCell']['floor']==floor and l['toCell']['floor']==floor and {(l['fromCell']['row'],l['fromCell']['col']),(l['toCell']['row'],l['toCell']['col'])}==edge_cells for l in T['links']):continue
   candidates.append((c,dr,dc,angle))
 candidates.sort(key=lambda c:(0 if c[1]==-1 else 1 if c[2]==-1 else 2,c[0]['row'],c[0]['col']))
 rid=room['roomId'];wet=any(w in rid for w in ['引水','導渠','蓄水','水閘','沉貨','陷阱'])
 used_cells=set()
 for index,(c,dr,dc,angle) in enumerate(candidates):
  key=(c['row'],c['col'])
  if key in used_cells:continue
  if len(used_cells)>=min(4,len(room['cells'])):break
  used_cells.add(key)
  # Build a local, shallow strip then rotate it to the chosen wall.
  before=set(scene.objects)
  if wet and len(used_cells)==1:
   box('Wall-side catch basin',(0,0,.10),(4.0,.85,.18),stone)
   box('Side-channel jade water',(0,0,.21),(3.8,.64,.035),water,0)
   for yy in [-.39,.39]:box('Basin rim',(0,yy,.25),(4.0,.09,.30),edge)
   for xx in [-1.95,1.95]:box('Basin end',(xx,0,.25),(.10,.75,.30),stone)
   if '水閘' in rid or '蓄水' in rid:
    for dx in [-.48,.48]:box('Sluice wall guide',(dx,.1,.85),(.13,.18,1.4),bronze)
    box('Wall-mounted sluice',(0,.13,.8),(.86,.15,1.1),bronze)
    beam('Gate screw',(0,.1,1.25),(0,.1,1.95),.06,iron)
    bpy.ops.mesh.primitive_torus_add(major_radius=.3,minor_radius=.04,major_segments=24,minor_segments=8,location=(0,.1,1.9));finish(bpy.context.object,'Sluice handwheel',bronze)
  elif '陷阱' in rid:
   for j in range(3):beam('Stored broken timber',(-1.5,-.15+j*.15,.17),(1.4,-.15+j*.15,.25),.10,wood)
  elif index%3==0:shelving(0,0)
  elif index%3==1:
   barrel(-.6,0);barrel(.45,0);crate(1.4,0,size=.6)
  else:crate(-.65,0,size=1);crate(-.65,0,1,.65);crate(.8,0,size=.8)
  # Prop transforms preserve a minimum 3.2-unit clear band across every cell.
  from mathutils import Matrix
  position=Vector(((c['col']-3)*6+dc*2.15,(3-c['row'])*6-dr*2.15,0))
  transform=Matrix.Translation(position) @ Matrix.Rotation(angle,4,'Z')
  for o in set(scene.objects)-before:o.matrix_world=transform @ o.matrix_world
 parent=room_root
