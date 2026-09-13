"""Build an editable, person-free Yunhua diorama and export its fixed-camera preview.
Run: blender --background --python scripts/blender/build-town.py
All dimensions and colors here are visual authoring data, not gameplay rules.
"""
import bpy
import math
import random
import json
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'app/assets/town3d'
OUT.mkdir(parents=True, exist_ok=True)
random.seed(42)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
bpy.context.preferences.filepaths.save_version = 0
scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.samples = 48
scene.cycles.use_denoising = True
scene.render.resolution_x = 1600
scene.render.resolution_y = 1000
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = 'PNG'
scene.world.color = (0.28, 0.32, 0.31)
scene.world.use_nodes = True
scene.world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.60, 0.70, 0.72, 1)
scene.world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.45
scene.view_settings.view_transform = 'AgX'

def mat(name, color, rough=0.65, metal=0, emission=0):
    m = bpy.data.materials.new(name)
    m.diffuse_color = (*color, 1)
    m.use_nodes = True
    p = m.node_tree.nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value = (*color, 1)
    p.inputs['Roughness'].default_value = rough
    p.inputs['Metallic'].default_value = metal
    if emission:
        p.inputs['Emission Color'].default_value = (*color, 1)
        p.inputs['Emission Strength'].default_value = emission
    return m

plaster = mat('Warm ivory limewash', (0.67, 0.54, 0.36))
wood = mat('Oiled cedar', (0.19, 0.075, 0.035))
timber = mat('Sunlit timber edges', (0.37, 0.19, 0.075))
gold = mat('Aged bronze', (0.65, 0.39, 0.10), .38, .55)
red = mat('Vermilion lacquer', (0.40, 0.055, 0.025))
roofm = [mat('Jade ceramic tile '+str(i), (0.075+i*.014, 0.15+i*.016, 0.145+i*.015), .38) for i in range(4)]
roofedge = mat('Glazed roof ridges', (0.16, .25, .23), .3)
stone = [mat('Sandstone '+str(i), (.41+i*.025, .38+i*.024, .29+i*.023)) for i in range(5)]
darkstone = mat('Quay dark foundation', (.18,.24,.23))
water = mat('Canal jade water', (.025,.24,.245), .20, .30)
foam = mat('Water reflected light', (.31,.57,.53), .28)
window = mat('Amber paper windows', (.84,.48,.15), .55, emission=.25)
lanternmat = mat('Silk lantern light', (1,.22,.025), .5, emission=1.2)
leafm = [mat('Foliage '+str(i), c) for i,c in enumerate([(.28,.37,.10),(.43,.49,.15),(.57,.44,.10),(.62,.20,.045),(.17,.30,.16)])]
soil = mat('Garden earth', (.17,.14,.075))
backdrop = mat('Studio sand', (.24,.29,.27))
rope = mat('Hemp', (.49,.37,.20))
quietroof = [mat('Residential slate '+str(i), (.16+i*.012,.19+i*.012,.18+i*.012)) for i in range(4)]
copperroof = [mat('Forge copper tile '+str(i), (.30+i*.025,.12+i*.012,.055+i*.008), .48) for i in range(4)]
bluetile = [mat('Library blue tile '+str(i), (.065+i*.012,.13+i*.012,.24+i*.016), .38) for i in range(4)]
teatile = [mat('Teahouse clay tile '+str(i), (.32+i*.022,.085+i*.009,.045+i*.008)) for i in range(4)]
parent = None
roots = []

def group(name, facility=None):
    global parent
    print('MODELING',name,flush=True)
    obj = bpy.data.objects.new(name, None)
    scene.collection.objects.link(obj)
    if facility:
        obj['facility'] = facility
    parent = obj
    roots.append(obj)
    return obj

def discard_unused_geometry():
    # Joining objects and rebuilding cities leaves unused mesh datablocks behind.
    # Keep cached materials for the next city, but never save dead geometry.
    for blocks in [bpy.data.meshes,bpy.data.curves]:
        for block in list(blocks):
            if block.users==0:blocks.remove(block)

def prune_unused_uvs():
    # Procedural cylinders contribute a default UVMap even when every material
    # uses Craft UV. Keep actual material bindings; omit unused per-vertex data.
    for obj in scene.objects:
        if obj.type!='MESH':continue
        active=obj.data.uv_layers.active.name if obj.data.uv_layers.active else None
        required=set()
        for material in obj.data.materials:
            if not material or not material.use_nodes:continue
            for node in material.node_tree.nodes:
                if node.type=='UVMAP':required.add(node.uv_map or active)
                if node.type=='TEX_IMAGE' and not node.inputs['Vector'].is_linked:required.add(active)
                if node.type=='TEX_COORD' and node.outputs['UV'].is_linked:required.add(active)
        for layer in list(obj.data.uv_layers):
            if layer.name not in required:obj.data.uv_layers.remove(layer)

def finish(obj, name, material):
    obj.name = name
    obj.parent = parent
    if material:
        obj.data.materials.append(material)
    return obj

def box(name, loc, dims, material, bevel=0.035):
    dx,dy,dz=[v/2 for v in dims]
    verts=[(sx*dx,sy*dy,sz*dz) for sx,sy,sz in [(-1,-1,-1),(-1,-1,1),(-1,1,-1),(-1,1,1),(1,-1,-1),(1,-1,1),(1,1,-1),(1,1,1)]]
    faces=[(0,4,6,2),(1,3,7,5),(0,1,5,4),(2,6,7,3),(0,2,3,1),(4,5,7,6)]
    o=mesh(name,verts,[tuple(reversed(face)) for face in faces],material)
    o.location=loc
    if bevel:
        m = o.modifiers.new('Soft crafted edges', 'BEVEL')
        m.width = bevel
        m.segments = 2
    return o

def mesh(name, vertices, faces, material):
    data = bpy.data.meshes.new(name)
    data.from_pydata(vertices, [], faces)
    data.update()
    obj = bpy.data.objects.new(name, data)
    scene.collection.objects.link(obj)
    return finish(obj, name, material)

def line(name, points, radius, material):
    data = bpy.data.curves.new(name, 'CURVE')
    data.dimensions = '3D'
    data.resolution_u = 1
    data.bevel_depth = radius
    data.bevel_resolution = 1
    sp = data.splines.new('POLY')
    sp.points.add(len(points)-1)
    for p, co in zip(sp.points, points):
        p.co = (*co, 1)
    obj = bpy.data.objects.new(name, data)
    scene.collection.objects.link(obj)
    return finish(obj, name, material)

def ball(name, loc, scale, material, detail=1):
    segments=10 if detail>1 else 8
    rings=6 if detail>1 else 4
    verts=[]
    for j in range(rings+1):
        phi=math.pi*j/rings
        for i in range(segments):
            theta=math.tau*(i+(j%2)*.25)/segments
            verts.append((math.sin(phi)*math.cos(theta)*scale[0],math.sin(phi)*math.sin(theta)*scale[1],math.cos(phi)*scale[2]))
    faces=[]
    for j in range(rings):
        for i in range(segments):
            a=j*segments+i;b=j*segments+(i+1)%segments
            faces.append((a,b,b+segments,a+segments))
    obj=mesh(name,verts,[tuple(reversed(face)) for face in faces],material);obj.location=loc
    return obj


def lantern(x,y,z):
    line('Lantern hanger', [(x,y,z+.5),(x,y,z+.2)], .022, gold)
    ball('Silk lantern', (x,y,z), (.19,.19,.28), lanternmat, 2)
    for dz in [-.25,.25]:
        box('Lantern cap',(x,y,z+dz),(.28,.28,.05),gold)
    line('Lantern tassel', [(x,y,z-.3),(x,y,z-.56)], .03, red)

def roof(x,y,z,w,d,h):
    # Curved tiled hip roof: a short central ridge, flared eaves and raised corners.
    for side in [-1,1]:
        verts=[]; faces=[]
        def surface(u,t):
            xx = u*w/2*(.72+.28*t)
            zz = z+h*(1-t)**1.65 + .32*t**7 + .27*abs(u)**8*t**3
            return (x+xx,y+side*t*d/2,zz)
        nx,ny=24,12
        for j in range(ny+1):
            for i in range(nx+1): verts.append(surface(-1+2*i/nx,j/ny))
        for j in range(ny):
            for i in range(nx):
                a=j*(nx+1)+i; faces.append((a,a+1,a+nx+2,a+nx+1))
        if side < 0: faces=[tuple(reversed(face)) for face in faces]
        ob=mesh('Curved tiled roof',verts,faces,roofm[0])
        for m in roofm[1:]: ob.data.materials.append(m)
        for p in ob.data.polygons: p.material_index=random.randrange(4)
        for i in range(25):
            line('Ceramic tile seam',[surface(-1+2*i/24,j/12) for j in range(13)],.025,roofedge)
        line('Sweeping gold eave',[surface(-1+2*i/24,1) for i in range(25)],.065,gold)
        for edge in [-1,1]: line('Hip ridge',[surface(edge,j/12) for j in range(13)],.075,roofedge)
    # Triangular hip ends close the roof volume.
    for side in [-1,1]:
        verts=[(x+side*w*.36,y,z+h),(x+side*w*.5,y-d/2,z+.59),(x+side*w*.5,y+d/2,z+.59)]
        mesh('Hip end',verts,[(0,1,2)],roofm[1])
    line('Ridge beam',[(x-w*.40,y,z+h+.24),(x-w*.36,y,z+h+.08),(x+w*.36,y,z+h+.08),(x+w*.40,y,z+h+.24)],.10,gold)
    for s in [-1,1]:
        ball('Ridge finial',(x+s*w*.39,y,z+h+.37),(.10,.10,.20),gold,2)

def window_panel(x,y,z,w,h):
    box('Paper window',(x,y,z),(w,.10,h),window)
    for i in range(5): box('Window lattice',(x-w/2+i*w/4,y-.075,z),(.045,.07,h+.08),wood,.01)
    for k in [-.5,0,.5]: box('Window lattice',(x,y-.075,z+k*h),(w+.08,.07,.045),wood,.01)

def building(name,facility,x,y,w,d,h,storeys=1):
    root=group(name,facility)
    box('Stone plinth',(x,y,.35),(w+.65,d+.6,.7),stone[3],.09)
    box('Plaster walls',(x,y,.7+h/2),(w,d,h),plaster,.07)
    yf=y-d/2-.09
    bays=max(3,round(w/1.6))
    for i in range(bays+1):
        xx=x-w/2+i*w/bays
        box('Cedar column',(xx,yf,.7+h/2),(.18,.23,h+.14),red)
        for z in [.86,.7+h-.2]: box('Column collar',(xx,yf,z),(.29,.3,.10),gold)
    for level in range(storeys):
        z=.7+(level+.5)*h/storeys
        for i in range(bays):
            xx=x-w/2+(i+.5)*w/bays
            if i==bays//2 and level==0:
                box('Dark doorway',(xx,yf-.025,1.6),(w/bays*.72,.08,1.8),wood)
                box('Door split',(xx,yf-.09,1.6),(.04,.06,1.8),gold,.01)
            else: window_panel(xx,yf-.10,z,w/bays*.70,h/storeys*.53)
        if level:
            box('Balcony',(x,yf-.48,.7+level*h/storeys),(w+.45,1,.15),timber)
            for k in range(bays*3+1):
                xx=x-w/2+k*w/(bays*3)
                box('Balcony spindle',(xx,yf-.94,1.12+level*h/storeys),(.045,.045,.74),wood,.01)
            box('Balcony rail',(x,yf-.94,1.5+level*h/storeys),(w+.2,.09,.10),gold)
    for z in [.75,.7+h]: box('Facade lintel',(x,yf,z),(w+.35,.28,.20),timber)
    # Side wall framing is visible from the locked camera.
    for yy in [-d/2,0,d/2]: box('Side upright',(x+w/2+.04,y+yy,.7+h/2),(.16,.16,h),wood)
    for z in [1.1,h*.6]: box('Side crossbeam',(x+w/2+.07,y,z),(.15,d,.14),timber)
    roof(x,y,.7+h,w+1.6,d+1.8,1.45 if w<7 else 1.8)
    if facility:
        box('Signboard',(x,yf-.20,.7+h-.55),(min(2.5,w*.45),.15,.6),wood)
        box('Signboard gold inset',(x,yf-.29,.7+h-.55),(min(2.25,w*.4),.035,.035),gold,.01)
        for xx in [x-w*.38,x+w*.38]: lantern(xx,yf-.40,2.55)
    for i in range(3): box('Entry stair',(x,yf-.40-i*.32,.5-i*.14),(2.3,.46,.18),stone[4])
    return root

group('Town foundations')
craft_source=Path(__file__).with_name('town-craft.py')
exec(compile(craft_source.read_text(encoding='utf-8'),str(craft_source),'exec'),globals())
district_source=Path(__file__).with_name('town-neighbourhoods.py')
exec(compile(district_source.read_text(encoding='utf-8'),str(district_source),'exec'),globals())
infra_source=Path(__file__).with_name('town-infrastructure.py')
exec(compile(infra_source.read_text(encoding='utf-8'),str(infra_source),'exec'),globals())
box('Diorama bed',(0,0,-1.30),(68,60,1.9),darkstone,.35)
# The river crosses the town and turns toward the foreground.
box('North bank',(0,12.5,-.13),(64,30,.40),stone[2])
box('Southwest bank',(-16.6,-16.45,-.13),(30.8,22.1,.40),stone[1])
box('Southeast bank',(18.1,-16.45,-.13),(27.8,22.1,.40),stone[2])
box('Canal',(0,0,-.32),(64.7,57.5,.10),water,.02)
for y in [-5.4,-2.5]:
    for x in range(-32,32):
        if y==-5.4 and -1.7<x+.5<4.7:continue
        box('Quay ashlar',(x+.5,y,-.08),(.97,.35,.56),random.choice(stone),.04)
for x in [-1.2,4.2]:
    for y in range(-27,-5): box('Quay ashlar',(x,y+.5,-.08),(.35,.97,.56),random.choice(stone),.04)
for j in range(8):
    for i in range(11):
        box('Courtyard flagstone',(-7+i*1.4,1+j*1.35,.105),(1.34,1.29,.05),random.choice(stone),.025)
for i in range(75):
    x=random.uniform(-31,31); y=random.uniform(-5.1,-2.8)
    line('River glint',[(x,y,-.25),(x+random.uniform(.15,.8),y,-.25)],.009,foam)

building('Adventurers guild','adventurerGuild',0,10,9,5.8,4.1)
roof(0,10,5.9,6.4,4.0,1.4)
for x in [-4.6,4.6]:
    box('Guild banner pole',(x,6.8,3.5),(.09,.09,5),gold)
    box('Guild silk banner',(x,6.8,3.55),(.65,.055,2.0),red)
    box('Banner motif',(x,6.755,3.55),(.06,.03,1.4),gold)
building('Canal inn','inn',-12,7,6.0,5.0,5.0,2)
building('Teahouse tavern','tavern',-15,0,4.2,3.3,2.6)
building('Bookshop','bookstore',-12,-11,6,4.8,3.2)
for k in range(6):
    box('Books on stand',(-13.8+k*.46,-13.9,.8),(.35,.55,.18),random.choice([red,plaster,roofm[2]]))
building('Smithy','equipmentShop',12,7,6.8,5.3,3.6)
box('Chimney',(14.1,8.0,5.4),(.70,.8,4.1),darkstone)
box('Chimney crown',(14.1,8,7.48),(.95,1.05,.18),stone[2])
box('Forge opening',(13.3,4.28,1.65),(1.25,.1,1.7),wood)
ball('Forge glow',(13.3,4.12,1.1),(.47,.22,.22),lanternmat,2)
for i in range(4):
    xx=10.2+i*.55
    line('Spear rack weapon',[(xx,3.65,.4),(xx,3.65,2.6)],.035,timber)
    mesh('Spear head',[(xx-.1,3.65,2.4),(xx,3.65,2.9),(xx+.1,3.65,2.4)],[(0,1,2)],gold)
building('Provision shop','itemShop',9,0.5,4,3.1,2.4)
for i in range(4): box('Shop crate',(8+i*.65,-1.55,.5),(.58,.55,.78),timber)
building('Canal residence','home',0,-12.2,4.4,3.3,2.5)

group('Training courtyard','trainingGround')
box('Training sand',(12,-10,.10),(10,8,.18),plaster,.08)
for x in [7,17]:
    for y in range(-14,-5,2): box('Fence post',(x,y,.85),(.17,.17,1.6),wood)
    for z in [.55,1.20]: box('Fence rail',(x,-10,z),(.12,8,.12),timber)
for y in [-14,-6]:
    for x in range(7,18,2): box('Fence post',(x,y,.85),(.17,.17,1.6),wood)
    for z in [.55,1.20]: box('Fence rail',(12,y,z),(10,.12,.12),timber)
for x in [9,12,15]:
    line('Target stand',[(x,-8,.2),(x,-8,2.1)],.10,wood)
    for radius,material in [(.65,rope),(.43,plaster),(.20,red)]:
        bpy.ops.mesh.primitive_cylinder_add(vertices=32,radius=radius,depth=.055,location=(x,-8-.1-(.65-radius)*.12,1.8),rotation=(math.pi/2,0,0))
        finish(bpy.context.object,'Archery target',material)

stone_crossing('Civic canal bridge',-4.5,-3.95,6.3,3.2)
timber_crossing('West ward footbridge',-23,-3.95,5.9,1.8)
timber_crossing('South branch footbridge',1.5,-12,7.8,1.8,axis='x')

group('City perimeter and water gates')
# The front wall is a low cutaway so the fixed camera can see into the city.
for x,w in [(-13,38),(23,18)]: box('Northern rampart',(x,28,1.6),(w,1.4,3.4),stone[0],.10)
for x in range(-32,33):
    if 5<x<12: continue
    box('Northern crenellation',(x,28,3.65),(.56,1.5,.80),stone[x%5])
for x in [-32,32]:
    segments=[(-1.9,1.4),(14.7,26.6),(-17,22)] if x==32 else [(12.7,30.6),(-17,22)]
    for y,depth in segments:
        box('Side rampart',(x,y,1.4),(1.4,depth,3),stone[0],.10)
    for y in range(-27,29):
        if -6<y<-2:continue
        if x==32 and abs(y)<=1:continue
        box('Side crenellation',(x,y,3.15),(1.5,.56,.70),stone[y%5])
    box('Canal watergate lintel',(x,-4,2.9),(1.5,4.5,.7),stone[2])
for x,w in [(-17,29),(18,27)]:
    box('Front cutaway wall',(x,-28,.55),(w,1.0,1.3),stone[1],.08)
    for xx in range(round(x-w/2),round(x+w/2),2):box('Front parapet',(xx,-28,1.4),(.65,1,.45),stone[3])
for x in [-32,32]:
    for y in [-28,28]:
        box('Corner tower',(x,y,2.05),(3.5,3.5,4.3),stone[2],.1)
        roof(x,y,4.25,4.8,4.8,1.0)
group('North gatehouse','cityGate')
for x in [5.5,11.5]: box('Gate tower',(x,28,2.1),(2,2.5,4.4),stone[1])
box('Gate lintel',(8.5,28,3.85),(4.1,2.5,1.0),stone[2])
roof(8.5,28,4.4,8,4.1,1.2)
group('East checkpoint','adventureCheckpoint')
for x in [28.1,30]: box('Checkpoint post',(x,0,1.9),(.24,.24,3.8),red)
box('Checkpoint lintel',(29.05,0,3.2),(2.8,.36,.45),wood)
roof(29.05,0,3.65,3.5,2,0.6)

group('Gardens and quay furniture')
decoration_serial=0
def decoration_batch(before):
    global decoration_serial
    decoration_serial+=1
    for obj in set(parent.children)-before:obj['decorationBatch']=decoration_serial

def tree(x,y,scale=1,autumn=False):
    before=set(parent.children)
    box('Tree planter',(x,y,.25),(1.6*scale,1.6*scale,.55),stone[0],.15)
    box('Planter earth',(x,y,.54),(1.4*scale,1.4*scale,.05),soil)
    line('Tree trunk',[(x,y,.5),(x-.15*scale,y,2*scale),(x+.1*scale,y,3.5*scale)],.15*scale,timber)
    for i in range(9):
        a=random.uniform(0,math.tau); r=random.uniform(.1,1.1)*scale
        px=x+math.cos(a)*r; py=y+math.sin(a)*r; pz=random.uniform(2.9,4.1)*scale
        line('Branch',[(x,y,2.2*scale),(px,py,pz)],.055*scale,timber)
        ball('Leaf cluster',(px,py,pz),(random.uniform(.6,1.0)*scale,.75*scale,.68*scale),leafm[3] if autumn else random.choice(leafm[:3]),2)
    decoration_batch(before)
for x,y,s in [(-7,10,1.0),(6,12,1.2),(-17,12,1.1),(17,9,1),(-8,0,.8),(5,1,.8),(-6,-10,.85),(6,-15,.8),(-18,-10,1.0),(17,-2,.8),(-8,16,1.0)]:
    tree(x,y,s,x in [6,-7])
for x,y in [(-7,-1.8),(5,-1.8),(-17,-5.8),(8,-5.8)]:
    before=set(parent.children)
    line('Lantern street pole',[(x,y,.2),(x,y,3.5),(x+.6,y,3.5)],.065,wood)
    lantern(x+.6,y,3.1)
    decoration_batch(before)
for x,y in [(-7,-7.2),(4.8,-8.5)]:
    before=set(parent.children)
    for j in range(7): box('Dock board',(x,y+j*.24,.03),(2,.22,.16),timber)
    for xx in [x-.85,x+.85]: box('Mooring post',(xx,y,.4),(.18,.18,1.4),wood)
    decoration_batch(before)
# An empty boat, with a curved hull and awning; no people.
group('Canal boat')
verts=[(-9,-4.8,-.17),(-6,-4.8,-.17),(-5.5,-4.15,.05),(-6,-3.5,-.17),(-9,-3.5,-.17),(-9.6,-4.15,.05),(-8.8,-4.65,.25),(-6.2,-4.65,.25),(-6.2,-3.65,.25),(-8.8,-3.65,.25)]
mesh('Wooden hull',verts,[(0,1,2,3,4,5),(0,6,7,1),(1,7,2),(2,7,8,3),(3,8,9,4),(4,9,5),(5,9,6,0)],timber)
for i in range(8): box('Boat deck',(-8.8+i*.37,-4.15,.1),(.32,.85,.06),wood)
for x in [-8.4,-7.8,-7.2]:
    line('Canopy rib',[(x,-4.65,.2),(x,-4.6,.7),(x,-4.15,1),(x,-3.7,.7),(x,-3.65,.2)],.025,timber)
mesh('Woven boat awning',[(-8.5,-4.65,.3),(-8.5,-4.15,1.03),(-8.5,-3.65,.3),(-7.1,-4.65,.3),(-7.1,-4.15,1.03),(-7.1,-3.65,.3)],[(0,3,4,1),(1,4,5,2)],rope)
parent.location.x=-3

# Permanent architectural landmarks remain readable without hover or interface labels.
facilities={r['facility']:r for r in roots if 'facility' in r}
def landmark(kind):
    global parent
    parent=facilities[kind]

def banner(x,y,height=4.8):
    box('Landmark standard',(x,y,height/2),(.12,.12,height),gold)
    box('Long silk standard',(x+.4,y,height-.95),(.8,.08,1.8),red)
    box('Standard gold stripe',(x+.4,y-.05,height-.95),(.08,.04,1.45),gold)

landmark('adventurerGuild')
box('Guild upper hall',(0,10,5.6),(5.0,3.0,1.7),plaster)
for x in [-1.45,0,1.45]:window_panel(x,8.43,5.65,1.0,1.0)
# A large shield and crossed blades identify the guild from the main avenue.
mesh('Guild bronze shield',[(-.65,6.91,3.7),(.65,6.91,3.7),(.58,6.91,2.95),(0,6.91,2.55),(-.58,6.91,2.95)],[(0,1,2,3,4)],gold)
for s in [-1,1]:line('Guild crossed blade',[(s*.6,6.80,2.9),(-s*.6,6.80,3.65)],.06,stone[4])

landmark('inn')
box('Inn rooftop pavilion',(-12,7,6.4),(2.6,2.4,1.5),plaster)
window_panel(-12,5.75,6.45,1.7,.95)
roof(-12,7,7.1,4,3.5,1.0)
for x in [-14.6,-9.4]:
    line('Inn lantern arm',[(x,4.3,4.6),(x,3.6,4.6)],.08,wood)
    ball('Great inn lantern',(x,3.6,3.85),(.38,.38,.62),lanternmat,2)

landmark('tavern')
for x in [-17,-13]:box('Tea veranda post',(x,-2.5,1.4),(.16,.16,2.8),red)
roof(-15,-2.05,2.55,5.3,2.1,.55)
for x in [-16.4,-15.5,-14.6]:
    ball('Wine jar',(x,-3.05,.65),(.32,.32,.57),teatile[2],2)
    box('Wine jar cloth seal',(x,-3.05,1.17),(.35,.35,.1),red)

landmark('bookstore')
box('Library upper reading room',(-12,-11,4.7),(3.7,3,1.6),plaster)
window_panel(-12,-12.57,4.75,2.5,.9)
roof(-12,-11,5.5,5.4,4.2,1.15)
for x in [-14.6,-9.4]:
    box('Library hanging scroll',(x,-13.7,2.5),(.65,.08,1.6),plaster)
    for z in [1.7,3.3]:line('Scroll roller',[(x-.4,-13.8,z),(x+.4,-13.8,z)],.07,gold)
    for z in [2.1,2.4,2.7]:box('Scroll ink',(x,-13.76,z),(.30,.03,.06),wood)

landmark('equipmentShop')
box('Forge chimney extension',(14.1,8,8.1),(.72,.82,1.25),darkstone)
box('Forge chimney flared crown',(14.1,8,8.8),(1.15,1.2,.3),stone[2])
box('Anvil pedestal',(10.8,3.3,.55),(.8,.8,1.1),wood)
box('Anvil waist',(10.8,3.3,1.2),(.5,.5,.4),darkstone)
box('Anvil striking face',(10.8,3.3,1.45),(1.5,.65,.22),gold)
banner(8.5,5,5.5)

landmark('itemShop')
for x in [6.8,11.2]:box('Merchant canopy post',(x,-2,1.4),(.12,.12,2.8),wood)
for i in range(8):
    x=6.6+i*.6
    mesh('Striped provision awning',[(x,-2.5,2.5),(x+.6,-2.5,2.5),(x+.6,-.8,3.1),(x,-.8,3.1)],[(0,1,2,3)],red if i%2 else plaster)
    box('Awning valance',(x+.3,-2.5,2.38),(.6,.07,.28),red if i%2 else plaster)

landmark('home')
for x in [-2.7,2.7]:box('Residence garden wall',(x,-12.6,.65),(.25,5,1.3),plaster)
for x in [-1.05,1.05]:box('Residence entrance pillar',(x,-15,1.15),(.25,.3,2.3),stone[4])
roof(0,-15,2.15,3.3,1.5,.6)
tree(1.9,-13.9,.48,True)

landmark('trainingGround')
for x in [10.1,13.9]:box('Training ceremonial gate post',(x,-14,2),(.35,.35,4),red)
box('Training gate crossbeam',(12,-14,3.55),(5,.4,.55),gold)
roof(12,-14,3.8,5.8,2.1,.85)
for x in [7.5,16.5]:banner(x,-12,4.6)

landmark('cityGate')
box('Gate upper watch hall',(8.5,28,5.8),(4.5,2.1,1.8),plaster)
window_panel(8.5,26.9,5.8,3.2,1.1)
roof(8.5,28,6.7,6.4,3.6,1.15)
for x in [5.4,11.6]:banner(x,26.5,6)

landmark('adventureCheckpoint')
box('Checkpoint raised watch cabin',(29.05,0,4.5),(2.3,1.7,1.4),plaster)
window_panel(29.05,-.91,4.5,1.5,.8)
roof(29.05,0,5.2,3.7,2.6,.8)
banner(27.3,0,5.6)

# Spread the useful buildings across distinct quarters; decorative buildings have no facility ID.
relocations={
    'adventurerGuild':(0,6), 'inn':(-11,6), 'tavern':(5,-9),
    'bookstore':(-10,-9), 'equipmentShop':(11,3), 'itemShop':(4,-14),
    'home':(-5,-10), 'trainingGround':(10,-10),
}
for root in roots:
    delta=relocations.get(root.get('facility'))
    if delta: root.location.x,root.location.y=delta

# Four residential quarters, including back lanes and quay warehouses.
# Explicit lots keep roofs away from the three north/south streets and the canal.
lots=[
    (-27,22,3.5,3.5,2.8),(-20,23,4.4,3.4,2.5),(-13,22,4.0,4.1,3.5),(-6,24,3.3,3.0,2.5),
    (1,24,3.5,3.0,2.6),(17,23,4.3,3.8,3.5),(25,23,4.0,3.7,2.8),
    (-13,14,4,3.5,2.7),(-7.9,14,2.0,2.5,2.1),(10,18,3.7,4,3.0),(18,17,4.0,3.4,2.5),(26,17,3.5,3.2,2.4),
    (-27,5,3.5,3.5,2.5),(-20,5,4.0,3.7,3.2),(-13,5,4.5,3.8,2.6),(-6,5,3.0,3.5,2.3),
    (8,6,3.5,3.7,2.8),(15,7,3.2,3.4,2.3),
    (-27,-10,3.5,3.5,2.7),(-20,-10,4.0,3.7,2.4),(-15.3,-17,3.0,3.7,2.5),
    (-28.6,-21,3.0,3.3,2.2),(-14,-24,3.5,3,2.1),(-10,-16,3.4,3.7,3.2),
    (7,-9,3.0,3.4,2.4),(22,-9,3.7,3.4,2.6),(28,-10,3.0,3.5,2.1),
    (7,-18,3,3.5,2.2),(12,-23,3.5,3.0,2.5),(30,-26,2.6,2.8,2.1),
]
for index,(x,y,w,d,h) in enumerate(lots):
    root=urban_house('yunhua','Canal household '+str(index+1),None,x,y,w,d,h,index)
    root['scenery']=True
    root['district']='scholarly courts' if y>12 else 'canal merchants' if y>0 else 'west artisans' if x<0 else 'east waterside families'
# Narrow row houses fill the merchant streets without competing with the civic landmarks.
for index,(x,y) in enumerate([(-26,-.5),(-20,-.5),(-14,-.5),(12,.3),(18,.3),(24,.3)]):
    root=urban_house('yunhua','Promenade shopfront '+str(index+1),None,x,y,3.4,2.4,2.2,index+3)
    root['scenery']=True;root['district']='canal merchants'

group('Street paving and market stalls')
for x in [-16,0,16]:
    for y in range(-1,26):
        # The guild plaza interrupts the central road, forming a civic forecourt.
        if x==0 and 12<=y<=20:continue
        box('Street flagstone',(x,y,.10),(2.5,.92,.045),stone[(y+2)%5],.015)
for x in range(-28,29):
    box('Riverside promenade',(x,-1.8,.105),(.94,1.0,.055),stone[x%5],.015)
for index,(x,y) in enumerate([(-6,8),(-3,8),(5,9),(8,11),(-20,-15),(-25,-15),(19,2),(24,2)]):
    before=set(parent.children)
    craft_stall(x,y,craft_trades['canal'][index%4],index,.68)
    decoration_batch(before)

# Dry-bank approaches join the fixed bridge landings to the promenade and wards.
for x,y,w,d in [(-4.5,-.35,3.2,1.1),(-2.3,.1,4.4,1.4),(-4.5,-7.7,3.2,1.2),(-23,-.5,1.8,1.1),(-23,-7.4,1.8,1.0),(-3,-12,1.2,1.8),(6,-12,1.2,1.8)]:
    box('Bridge approach paving',(x,y,.105),(w,d,.055),stone[2],.015)

group('Neighbourhood gardens')
for x,y in [(-29,16),(-17,19),(-9,19),(13,23),(29,21),(-25,-15),(-18,-24),(-7,-7),(5,-24),(18,-16),(28,-16),(3,8)]:
    tree(x,y,.65,autumn=x in [-9,18])

# Quiet slate roofs and plain timber distinguish ordinary homes from civic landmarks.
for root in roots:
    palette={'equipmentShop':copperroof,'bookstore':bluetile,'tavern':teatile}.get(root.get('facility'))
    replacements={roofm[i]:palette[i] for i in range(4)} if palette else {}
    if root.get('scenery'):
        replacements={roofm[i]:quietroof[i] for i in range(4)}
        replacements.update({gold:roofedge,red:timber})
    for child in root.children:
        for slot in child.material_slots:
            if slot.material in replacements:slot.material=replacements[slot.material]

# Scale around each authored building centre, keeping ground height and relocation stable.
# Footprints grow modestly; height provides most of the hierarchy without closing lanes.
landmark_sizes={
    'adventurerGuild':(0,10,1.12,1.15),'inn':(-12,7,1.12,1.12),
    'tavern':(-15,0,1.18,1.20),'bookstore':(-12,-11,1.10,1.15),
    'equipmentShop':(12,7,1.12,1.15),'itemShop':(9,.5,1.18,1.22),
    'home':(0,-12.2,1.12,1.18),'trainingGround':(12,-10,1.0,1.12),
    'cityGate':(8.5,28,1.0,1.18),'adventureCheckpoint':(29.05,0,1.08,1.12),
}
for kind,(x,y,footprint,height) in landmark_sizes.items():
    root=facilities[kind]
    root.scale=(footprint,footprint,height)
    root.location.x+=x*(1-footprint)
    root.location.y+=y*(1-footprint)

checkpoint=facilities['adventureCheckpoint']
checkpoint.rotation_euler.z=math.pi/2
checkpoint.location.x=29.05;checkpoint.location.y=-29.05*checkpoint.scale.x
checkpoint['passageAxis']='x';checkpoint['passageCenter']=[29.05,0]
facilities['cityGate']['passageAxis']='y';facilities['cityGate']['passageCenter']=[8.5,28]


# Resolve scenery against final relocated/scaled buildings before merging meshes.
from mathutils.bvhtree import BVHTree
def clearance_tree(objects):
    vertices=[];faces=[]
    for obj in objects:
        if obj.type not in {'MESH','CURVE'}:continue
        evaluated=obj.evaluated_get(bpy.context.evaluated_depsgraph_get());data=evaluated.to_mesh()
        off=len(vertices);vertices.extend(obj.matrix_world @ v.co for v in data.vertices)
        faces.extend(tuple(i+off for i in p.vertices) for p in data.polygons);evaluated.to_mesh_clear()
    return BVHTree.FromPolygons(vertices,faces) if faces else None
bpy.context.view_layer.update()
blockers=[clearance_tree(r.children) for r in roots if r.get('facility') or r.get('scenery') or r.get('crossing')]
for name in ['Gardens and quay furniture','Neighbourhood gardens','Street paving and market stalls']:
    root=next(r for r in roots if r.name==name);batches={}
    for obj in root.children:batches.setdefault(obj.get('decorationBatch',obj.name),[]).append(obj)
    for objects in batches.values():
        geometry=clearance_tree(objects)
        if geometry and any(t and geometry.overlap(t) for t in blockers):
            for obj in objects:bpy.data.objects.remove(obj,do_unlink=True)
        elif geometry:blockers.append(geometry)

craft_finish({'key':'yunjing','culture':'yunhua','theme':'canal'})
urban_ground_finish({'key':'yunjing','culture':'yunhua','theme':'canal'})

# Merge authored objects by building, preserving editable material slots and facility roots.
# This also keeps the GLB to tens of draw groups rather than thousands of objects.
for root in roots:
    print('MERGING',root.name,flush=True)
    children=[o for o in list(root.children) if o.type in {'MESH','CURVE'}]
    if not children:continue
    bpy.ops.object.select_all(action='DESELECT')
    for o in children:o.select_set(True)
    bpy.context.view_layer.objects.active=children[0]
    bpy.ops.object.convert(target='MESH');bpy.ops.object.join()
    bpy.context.object.name=root.name+' geometry';bpy.context.object.parent=root


urban_limit_households({'key':'yunjing','culture':'yunhua'})
parent=None
bpy.ops.object.camera_add(location=(49,-74,60))
camera=bpy.context.object
camera.name='Locked town camera'
target=Vector((0,0,1.2))
camera.rotation_euler=(target-camera.location).to_track_quat('-Z','Y').to_euler()
camera.data.type='ORTHO'
camera.data.ortho_scale=93
scene.camera=camera
bpy.ops.object.light_add(type='AREA',location=(-16,-12,28))
key=bpy.context.object;key.name='Golden afternoon softbox';key.data.energy=4800;key.data.shape='DISK';key.data.size=14;key.data.color=(1,.78,.49)
key.rotation_euler=(Vector((0,3,0))-key.location).to_track_quat('-Z','Y').to_euler()
bpy.ops.object.light_add(type='SUN',location=(0,0,20))
sun=bpy.context.object;sun.name='Late afternoon sun';sun.rotation_euler=(math.radians(27),math.radians(-24),math.radians(-25));sun.data.energy=2.2;sun.data.angle=.12;sun.data.color=(1,.86,.67)
box('Studio floor',(0,0,-2.45),(200,200,.2),backdrop,.0)

# Set a useful initial Blender viewport and persist the real scene before rendering.
for screen in bpy.data.screens:
    for area in screen.areas:
        if area.type=='VIEW_3D':
            area.spaces.active.region_3d.view_perspective='CAMERA'
            area.spaces.active.shading.type='MATERIAL'
scene.render.filepath=str(OUT/'yunhua-town-render.png')
prune_unused_uvs()
discard_unused_geometry()
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'yunhua-town.blend'),compress=True)
bpy.ops.export_scene.gltf(filepath=str(OUT/'yunhua-town.glb'),export_format='GLB',export_cameras=True,export_lights=False,export_extras=True)
(OUT/'scene-info.json').write_text(json.dumps({'camera':'Locked town camera','facilities':[r['facility'] for r in roots if 'facility' in r],'sceneryBuildings':len([r for r in roots if r.get('scenery')]),'meshObjects':len([o for o in scene.objects if o.type=='MESH']),'people':0},indent=2),encoding='utf-8')
print('TOWN MODEL SAVED',flush=True)
bpy.ops.render.render(write_still=True)
print('TOWN RENDER FINISHED',flush=True)
