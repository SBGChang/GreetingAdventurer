"""Author sixteen-city atlas assets. Blender --background --python scripts/blender/build-geography.py
Geometry is presentation data. atlas.json does not grant travel or create runtime cities.
"""
from pathlib import Path
from mathutils.bvhtree import BVHTree
import sys
# Reuse the proven crafted Yunhua architectural primitives, not a second copy.
source = Path(__file__).with_name('build-town.py').read_text(encoding='utf-8')
exec(compile(source.split("group('Town foundations')")[0], str(Path(__file__).with_name('build-town.py')), 'exec'))
OUT = ROOT / 'app/assets/geography'
atlas = json.loads((OUT/'atlas.json').read_text(encoding='utf-8-sig'))

snow=mat('Blue white snow',(.75,.84,.84))
sand=mat('Warm desert sandstone',(.65,.43,.22))
clay=mat('Cinnabar rock',(.39,.14,.075))
grass=mat('Meadow green',(.27,.36,.16))
blue=mat('Cobalt glazed dome',(.025,.20,.32),.28,.25)
chalk=mat('Cathedral limestone',(.72,.69,.53))
slate=mat('Northern slate',(.12,.18,.21))
pinegreen=mat('Fir needles',(.06,.18,.12))
roadmat=mat('Road ochre',(.64,.49,.25))

# Low-poly, solid architectural forms: all editable meshes or curves.
def cone(name,x,y,z,r,h,material,vertices=12,top=0):
    bpy.ops.mesh.primitive_cone_add(vertices=vertices,radius1=r,radius2=top,depth=h,location=(x,y,z+h/2))
    return finish(bpy.context.object,name,material)

def pine(x,y,z=0,s=1):
    box('Fir trunk',(x,y,z+s),(s*.18,s*.18,s*2),wood,0)
    for level in range(3):cone('Fir crown',x,y,z+s*(.8+level*.8),s*(1.1-level*.2),s*1.8,pinegreen,7)

def palm(x,y,z=0,s=1):
    if globals().get('detail_city')=='redsail':return redsail_palm(x,y,z,s)
    line('Palm trunk',[(x,y,z),(x+.3*s,y,z+3*s)],.14*s,timber)
    for i in range(7):
        a=i*math.tau/7
        mesh('Palm frond',[(x+.3*s,y,z+3*s),(x+math.cos(a)*2*s,y+math.sin(a)*2*s,z+2.4*s),(x+math.cos(a+.3)*1.3*s,y+math.sin(a+.3)*1.3*s,z+3.25*s)],[(0,1,2)],pinegreen)

def rock(x,y,z,s,material):ball('Rock escarpment',(x,y,z),(s,s*.7,s*.8),material,1)

def hall(culture,name,facility,x,y,w,d,h):
    if globals().get('detail_city')=='redsail':return redsail_hall(name,facility,x,y,w,d,h)
    if culture=='yunhua':
        root=building(name,facility,x,y,w,d,h,2 if h>4.5 else 1)
        palette={'equipmentShop':copperroof,'bookstore':bluetile,'tavern':teatile}.get(facility)
        if not facility:palette=quietroof
        if palette:
            for child in root.children:
                for slot in child.material_slots:
                    if slot.material in roofm:slot.material=palette[roofm.index(slot.material)]
        return root
    root=group(name,facility)
    material=wood if culture=='vildun' else chalk if culture=='aurelien' else sand
    box('Foundation',(x,y,.2),(w+.6,d+.6,.4),darkstone)
    box('Walls',(x,y,.4+h/2),(w,d,h),material)
    if culture in ['vildun','aurelien']:
        peak=h*.65
        mesh('Steep pitched roof',[(x-w/2-.5,y-d/2-.6,h+.4),(x+w/2+.5,y-d/2-.6,h+.4),(x,y-d/2-.6,h+peak+.4),(x-w/2-.5,y+d/2+.6,h+.4),(x+w/2+.5,y+d/2+.6,h+.4),(x,y+d/2+.6,h+peak+.4)],[(0,2,1),(3,4,5),(0,3,5,2),(1,2,5,4)],slate if culture=='vildun' else blue)
        for xx in [x-w/2,x,x+w/2]:box('Exposed beam',(xx,y-d/2-.06,h/2+.4),(.15,.15,h),timber)
        for zz in [1,h*.65,h+.3]:box('Wall belt',(x,y-d/2-.12,zz),(w,.14,.14),timber if culture=='vildun' else gold)
        if culture=='vildun':
            line('Carved roof ridge',[(x,y-d/2-1,h+peak+1),(x,y-d/2,h+peak+.45),(x,y+d/2,h+peak+.45),(x,y+d/2+1,h+peak+1)],.12,timber)
            for k in range(5):box('Roof rib',(x,y-d/2+k*d/4,h+peak+.45),(.18,.14,.18),gold)
    else:
        box('Roof parapet',(x,y,h+.5),(w+.25,d+.25,.35),chalk)
        ball('Glazed dome',(x,y,h+.5),(w*.48,d*.48,w*.43),blue,2)
        cone('Dome finial',x,y,h+w*.43+.5,.10,.65,gold,8)
    # Roof seams and timber/stone structure give each culture a tactile silhouette.
    if culture in ['vildun','aurelien']:
        for k in range(9):
            yy=y-d/2+k*d/8
            for sign in [-1,1]:line('Raised roof seam',[(x,yy,h+peak+.44),(x+sign*(w/2+.5),yy,h+.44)],.035,timber if culture=='vildun' else gold)
    if culture=='aurelien':
        for xx in [x-w/2,x+w/2]:
            box('Stone buttress',(xx,y-d/2-.35,h*.4),(.45,.6,h*.8),chalk)
        for xx in [x-w*.3,x+w*.3]:
            line('Pointed window arch',[(xx-w*.12,y-d/2-.2,h*.7),(xx,y-d/2-.2,h*.9),(xx+w*.12,y-d/2-.2,h*.7)],.065,gold)
    if culture=='vildun':
        for zz in [.8,1.2,1.6,2,2.4]:box('Timber wall course',(x,y-d/2-.04,zz),(w,.12,.07),timber)
    # Distinct windows, thresholds and door frame.
    for xx in [x-w*.3,x+w*.3]:
        window_panel(xx,y-d/2-.12,h*.6+.4,w*.2,h*.35)
    box('Door',(x,y-d/2-.10,1.2),(1.1,.15,1.8),wood)
    for xx in [x-.65,x+.65]:box('Door jamb',(xx,y-d/2-.2,1.35),(.13,.22,2.1),gold)
    if facility:
        for xx in [x-w*.45,x+w*.45]:
            line('Standard pole',[(xx,y-d/2-.6,.2),(xx,y-d/2-.6,h+1.2)],.07,gold)
            box('Standard',(xx+.28,y-d/2-.6,h+.3),(.55,.06,1.5),red)
    return root

def save_scene(key,world=False):
    global parent
    for root in roots:
        children=[o for o in list(root.children) if o.type in {'MESH','CURVE'}]
        if not children:continue
        bpy.ops.object.select_all(action='DESELECT')
        for o in children:o.select_set(True)
        bpy.context.view_layer.objects.active=children[0]
        bpy.ops.object.convert(target='MESH');bpy.ops.object.join();bpy.context.object.name=root.name+' geometry'
    parent=None
    bpy.ops.object.camera_add(location=(70,-220,270) if world else (49,-74,60))
    cam=bpy.context.object;cam.name='Atlas camera' if world else 'Locked town camera'
    target=Vector((0,0,0 if world else 1.2));cam.rotation_euler=(target-cam.location).to_track_quat('-Z','Y').to_euler()
    cam.data.type='ORTHO';cam.data.ortho_scale=620 if world else 100;scene.camera=cam
    bpy.ops.object.light_add(type='SUN');sun=bpy.context.object;sun.rotation_euler=(.45,-.4,-.5);sun.data.energy=2.4;sun.data.angle=.12
    bpy.ops.object.light_add(type='AREA',location=(-30,-30,60));light=bpy.context.object;light.data.energy=3500;light.data.size=35
    scene.render.engine='CYCLES';scene.cycles.samples=16
    scene.render.resolution_x=1400;scene.render.resolution_y=950;scene.render.resolution_percentage=100
    scene.render.filepath=str(OUT/(key+'.png'))
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT/(key+'.blend')))
    bpy.ops.export_scene.gltf(filepath=str(OUT/(key+'.glb')),export_format='GLB',export_cameras=True,export_extras=True,export_lights=False)
    bpy.ops.render.render(write_still=True)
    print('SAVED',key,flush=True)

def reset(seed):
    global roots,parent
    bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
    roots=[];parent=None;random.seed(seed)

facilities=['adventurerGuild','inn','tavern','bookstore','equipmentShop','itemShop','home','trainingGround','cityGate','adventureCheckpoint']
# Different plans, not random renames of one town. Coordinates are authored composition.
plans={
 'terrace':[(-5,17),(-21,9),(-22,-7),(12,18),(20,-8),(-10,-12),(9,-17),(16,4),(0,-28),(28,14)],
 'harbor':[(-11,12),(-24,0),(-7,-2),(-23,19),(12,18),(9,1),(-18,-16),(21,5),(3,28),(28,-8)],
 'kiln':[(0,15),(-21,15),(-21,-6),(-7,2),(19,13),(4,-14),(-13,-19),(19,-9),(0,28),(29,2)],
 'fjord':[(-9,16),(-23,7),(-22,-8),(3,22),(17,16),(12,3),(-15,-20),(25,-9),(0,30),(30,8)],
 'forest':[(0,18),(-18,12),(-21,-4),(13,14),(22,-4),(-12,-14),(4,-19),(13,-7),(0,30),(28,5)],
 'cathedral':[(0,17),(-20,11),(-21,-9),(17,14),(23,-6),(-8,-11),(7,-20),(13,1),(0,29),(-29,0)],
 'citadel':[(0,20),(-20,13),(-20,-4),(17,19),(20,1),(-10,-13),(9,-18),(7,3),(0,30),(29,-10)],
 'oasis':[(-4,20),(-21,9),(-23,-9),(18,17),(25,-4),(-10,-18),(8,-21),(17,-12),(0,30),(-29,0)],
 'glacier':[(-7,18),(-22,12),(-23,-8),(15,19),(21,2),(-9,-13),(8,-19),(17,-11),(0,29),(29,11)],
 'volcanic':[(9,17),(-19,18),(-23,-1),(-5,7),(23,9),(-15,-16),(8,-21),(20,-9),(0,29),(-29,8)],
 'farmland':[(-6,19),(-22,9),(-18,-12),(17,18),(22,-3),(-3,-9),(10,-22),(12,4),(0,29),(-29,-1)],
 'chalkport':[(7,18),(-19,14),(-22,-1),(23,10),(-5,6),(12,-7),(-17,-14),(24,-10),(0,29),(-29,8)],
 'saltlake':[(0,22),(-23,15),(-24,-9),(21,17),(25,-2),(-11,-19),(9,-22),(19,-13),(0,30),(-29,0)],
 'canyon':[(-17,18),(-23,3),(-19,-13),(17,19),(22,2),(15,-14),(-7,-22),(-23,-22),(0,30),(29,-10)]}

def paving(city):
    if city['key']=='redsail':return redsail_streets()
    # One non-overlapping mesh avoids coplanar road surfaces at intersections.
    positions=plans[city['theme']];vertices=[];faces=[]
    for row in range(124):
        y=-31+row*.5
        for col in range(132):
            x=-33+col*.5
            onroad=(abs(x+.25)<.9 and -29<y<25) or any(abs(y+.25-(yy-5))<.8 and min(0,xx)-.5<x<max(0,xx)+.5 for xx,yy in positions)
            if not onroad:continue
            if city['theme'] in ['harbor','fjord'] and y<-17:continue
            if city['theme']=='oasis' and (x/9)**2+(y/8)**2<1:continue
            z=-.10
            if city['theme']=='terrace':z=3.4 if y>=14.5 else 1.5 if y>=1.5 else -.10
            start=len(vertices);vertices.extend([(x,y,z),(x+.5,y,z),(x+.5,y+.5,z),(x,y+.5,z)])
            faces.append((start,start+1,start+2,start+3))
    mesh('Unified paved streets',vertices,faces,roadmat)

def geometry_tree(objects):
    vertices=[];faces=[]
    for obj in objects:
        if obj.type not in {'MESH','CURVE'}:continue
        evaluated=obj.evaluated_get(bpy.context.evaluated_depsgraph_get());data=evaluated.to_mesh()
        off=len(vertices);vertices.extend(obj.matrix_world @ v.co for v in data.vertices)
        faces.extend(tuple(v+off for v in p.vertices) for p in data.polygons);evaluated.to_mesh_clear()
    return BVHTree.FromPolygons(vertices,faces) if faces else None

def civic_tree():
    bpy.context.view_layer.update()
    return geometry_tree([o for r in roots if r.get('facility') for o in r.children])

def town_plant(x,y,s=1,palmtree=False):
    before=set(parent.children)
    base=(3.5 if y>=14.5 else 1.6 if y>=1.5 else 0) if town_theme=='terrace' else 0
    palm(x,y,base,s=s) if palmtree else pine(x,y,base,s=s)
    bpy.context.view_layer.update();created=set(parent.children)-before
    plant=geometry_tree(created);buildings=town_civics
    if plant and buildings and plant.overlap(buildings):
        for obj in created:bpy.data.objects.remove(obj,do_unlink=True)

def populate_homes(city):
    if city['key']=='redsail':return redsail_homes()
    global parent
    theme=city['theme'];culture=city['culture'];positions=plans[theme]
    bpy.context.view_layer.update()
    blockers=[geometry_tree(r.children) for r in roots if r.get('facility') or r.name in ['Scenic ridges','Town identity landmarks','Local craft and landscape','Market stalls']]
    candidates=[(x,y) for y in [-22,-13,-4,5,14,23] for x in [-27,-18,-9,9,18,27]]
    candidates+= [(x,y) for y in [-22,-16,-10,-4,2,8,14,20,25] for x in [-27,-21,-15,-9,-3,3,9,15,21,27] if (x,y) not in candidates]
    count=0
    for x,y in candidates:
        if count>=18:break
        if any(abs(x-xx)<7 and abs(y-yy)<7 for xx,yy in positions):continue
        if theme in ['harbor','fjord','chalkport'] and y<-15:continue
        if theme in ['oasis','caravan','saltlake','canyon'] and abs(x)<13 and abs(y)<12:continue
        root=hall(culture,'Residential ward '+str(count),None,x,y,3.6,3.1,2.4);root['scenery']=True
        if theme=='terrace':root.location.z=3.5 if y+1.8>=14.5 else 1.6 if y+1.8>=1.5 else 0
        bpy.context.view_layer.update();candidate=geometry_tree(root.children)
        if candidate and any(t and candidate.overlap(t) for t in blockers):
            for obj in list(root.children):bpy.data.objects.remove(obj,do_unlink=True)
            roots.remove(root);bpy.data.objects.remove(root,do_unlink=True);continue
        blockers.append(candidate);count+=1
        if theme=='terrace' and root.location.z:
            group('Raised residential footing')
            box('Residential retaining base',(x,y,(root.location.z-.15)/2),(4.3,3.8,root.location.z+.15),stone[1],.03)
    if count<9:raise RuntimeError(city['key']+' has fewer than nine clear residential lots: '+str(count))

def verify_city_clearance(city):
    bpy.context.view_layer.update()
    candidates=[r for r in roots if r.get('facility') or r.get('scenery') or r.name in ['Scenic ridges','Town identity landmarks','Local craft and landscape','Market stalls']]
    trees=[geometry_tree(r.children) for r in candidates]
    collisions=[]
    for i,a in enumerate(candidates):
        for j,b in enumerate(candidates[:i]):
            if trees[i] and trees[j] and trees[i].overlap(trees[j]):collisions.append((a.name,b.name))
    if collisions:raise RuntimeError(city['key']+' intersects: '+str(collisions))

def town(city,index):
    global parent,town_theme,town_civics,detail_city
    detail_city=city['key']
    if detail_city=='redsail':
        source=Path(__file__).with_name('redsail-detail.py')
        exec(compile(source.read_text(encoding='utf-8'),str(source),'exec'),globals())
    reset(index+83);theme=city['theme'];culture=city['culture'];positions=redsail_plan if detail_city=='redsail' else plans[theme]
    town_theme=theme
    ground=snow if theme in ['fjord','glacier'] else darkstone if theme=='volcanic' else chalk if theme=='saltlake' else sand if culture=='safir' else clay if theme=='kiln' else grass if theme in ['forest','terrace','farmland'] else stone[2]
    group('Terrain foundation');box('Carved diorama base',(0,0,-1.6),(69,64,2.5),darkstone,.2)
    box('Town ground',(0,0,-.35),(67,62,.4),ground,.1)
    if theme in ['harbor','fjord']:
        box('Harbor water',(5,-24,-.02),(57,14,.2),water)
        for x in [0,13,26]:
            for y in range(-29,-13):box('Pier plank',(x,y,.25),(3,.85,.3),timber)
            for y in [-28,-22,-16]:box('Pier mooring',(x+1.3,y,.65),(.25,.25,1.5),wood)
            ball('Empty boat',(x+3,-25,.25),(1.4,4,.65),wood,2)
            line('Ship mast',[(x+3,-25,.3),(x+3,-25,5.5)],.09,timber)
            mesh('Furled sail',[(x+3,-25,2),(x+3,-25,5.1),(x+5,-25,4.4)],[(0,1,2)],rope)
    if theme=='terrace':
        for y,z in [(9,1.6),(22,3.5)]:box('Retaining terrace',(0,y,z/2-.15),(60,15,z),stone[1],.12)
        for i in range(18):box('Broad mountain stair',(-1,1+i*1.4,.12+i*.20),(4,1.5,.28),stone[4])
    if theme in ['terrace','kiln','fjord','forest','citadel']:
        group('Scenic ridges')
        for i in range(8):
            rock(-30+i*8,39,2,random.uniform(4,6),clay if theme=='kiln' else darkstone)
            if theme=='fjord':cone('Snow summit',-30+i*8,39,6,3,3,snow,5)
    # Roads align with civic entrances and leave districts open.
    group('Streets and courtyards')
    paving(city)
    if theme=='oasis':
        ball('Star well oasis',(0,0,.05),(8,7,.18),water,2)
        for i in range(12):
            a=i*math.tau/12;palm(math.cos(a)*10,math.sin(a)*9,s=.8)
    if theme=='caravan':
        group('Market stalls')
        for x in [-20,-10.5]:
            for y in [-5,4]:
                mesh('Red sail canopy',[(x-4,y-3,2.4),(x+4,y-3,2.4),(x+4,y+3,2.4),(x-4,y+3,2.4),(x,y,4.3)],[(0,1,4),(1,2,4),(2,3,4),(3,0,4)],red)
                for dx in [-4,4]:box('Canopy support',(x+dx,y,1.3),(.13,.13,2.6),wood)
    for i,(kind,(x,y)) in enumerate(zip(facilities,positions)):
        civic=kind=='adventurerGuild';w=8 if civic else 6;d=5.2 if civic else 4.5;h=5.8 if civic else 4.4
        if kind in ['cityGate','adventureCheckpoint']:
            root=group(kind,kind)
            for xx in [x-2.6,x+2.6]:box('Gate pier',(xx,y,2),(1.6,3,4),wood if culture=='vildun' else stone[2])
            box('Gate lintel',(x,y,3.7),(6.8,3,.8),timber)
            if culture=='yunhua':roof(x,y,4.1,8.5,4.7,1.5)
            else:
                for xx in [x-2.6,x+2.6]:cone('Gate turret',xx,y,4,1.5,2,slate if culture=='vildun' else blue,8)
        else:root=hall(culture,kind,kind,x,y,w,d,h)
        if theme=='terrace':
            root.location.z=3.5 if y+d/2>=14.5 else 1.6 if y+d/2>=1.5 else 0
            group('Raised civic footing');box('Terrace footing',(x,y,(root.location.z-.15)/2),(w+.7,d+.7,root.location.z+.15),stone[1],.04);parent=root
        if culture=='yunhua' and kind=='inn':
            box('Inn upper pavilion',(x,y,h+1.2),(3.2,2.6,1.7),plaster)
            roof(x,y,h+2,4.6,4,1.1)
            for xx in [x-2.5,x+2.5]:lantern(xx,y-3,3.5)
        if culture=='yunhua' and kind=='bookstore':
            for xx in [x-2.4,x+2.4]:
                box('Hanging scroll',(xx,y-2.6,2.4),(.6,.1,1.5),plaster)
                for zz in [1.7,3.2]:box('Scroll roller',(xx,y-2.7,zz),(.75,.15,.1),gold)
        if kind in ['itemShop','tavern']:
            for k in range(7):
                xx=x-3+k*.9
                mesh('Striped shop awning',[(xx,y-3,3),(xx+.9,y-3,3),(xx+.9,y-4.5,2.4),(xx,y-4.5,2.4)],[(0,1,2,3)],red if k%2 else rope)
                box('Merchant crate',(xx,y-3.4,.5),(.7,.7,.8),timber)
        if kind=='equipmentShop':
            for xx in [x-2,x+2]:cone('Forge chimney',xx,y+1,h-1,.6,4,darkstone,8)
        if kind=='trainingGround':
            for xx in [x-2,x,x+2]:
                box('Target post',(xx,y-4,1),(.12,.12,2),wood)
                ball('Practice target',(xx,y-4,1.6),(.55,.14,.55),rope,2)
        if kind=='bookstore' and culture!='yunhua':
            cone('Archive turret',x,y,h,1.3,3,chalk if culture=='aurelien' else gold,8)
        if kind=='adventurerGuild' and theme=='cathedral':
            for xx in [x-3,x+3]:
                cone('Cathedral bell tower',xx,y,h,1.35,5,chalk,8,top=1.35)
                cone('Cathedral spire',xx,y,h+5,1.65,4,blue,8)
        if kind=='adventurerGuild' and theme=='citadel':
            box('High keep',(x,y,h+1),(6,4,3),stone[0]);box('Keep parapet',(x,y,h+2.5),(6.5,4.5,.5),chalk)
        if kind=='adventurerGuild' and theme=='oasis':cone('Star observatory',x+4,y,0,1.4,11,sand,12,top=1.2);ball('Observatory dome',(x+4,y,11),(1.8,1.8,1.6),blue,2)
    town_civics=civic_tree()
    group('Town identity landmarks')
    if city.get('rank')=='capital':
        for xx in [-10,10]:
            cone('Capital bastion',xx,25,0,2.4,8,wood if culture=='vildun' else chalk,10,top=2.1)
            cone('Capital crown',xx,25,8,2.8,3,slate if culture=='vildun' else blue,10)
    if theme=='glacier':
        for k in range(4):box('Glacial quarry terrace',(0,39-k*2,1+k*.6),(24-k*3,3,1.5),snow)
        box('Glacier pool',(0,0,.03),(12,12,.15),water)
        for xx in [-9,9]:
            line('Quarry hoist',[(xx,0,0),(xx,0,8),(xx+5,0,8)],.22,timber)
            line('Hoist rope',[(xx+4,0,8),(xx+4,0,2)],.07,rope)
    if theme=='volcanic':
        for xx in [-8,0,8]:
            cone('Basalt furnace',xx,24,0,2.4,5,darkstone,8,top=1.5)
            cone('Forge stack',xx,24,5,.8,6,stone[0],8)
            box('Ember mouth',(xx,21.8,1.2),(1.3,.12,1.3),red)
        for yy in [-6,-4,-2]:box('Slag channel',(5,yy,.06),(6,.5,.15),clay)
    if theme=='farmland':
        for xx,yy in [(-27,24),(26,24),(-27,-22)]:
            cone('Windmill tower',xx,yy,0,1.6,6,chalk,12,top=1)
            cone('Mill cap',xx,yy,6,1.8,2,blue,8)
            for a in [0,math.pi/2]:line('Windmill sail',[(xx-4*math.cos(a),yy-1.8,5-4*math.sin(a)),(xx+4*math.cos(a),yy-1.8,5+4*math.sin(a))],.24,rope)
        for yy in [-3,0,3]:box('Grain field',(0,yy,.02),(12,1.8,.12),gold)
    if theme=='chalkport':
        box('Chalk harbor',(0,-25,.02),(47,9,.16),water)
        for xx in [-12,1,14]:box('Stone pier',(xx,-22,.3),(3,13,.5),chalk)
        cone('Lighthouse',26,25,0,2,11,chalk,12,top=1.3)
        ball('Beacon lantern',(26,25,11),(1.6,1.6,1.4),gold,2)
    if theme=='saltlake':
        for xx in [-6,0,6]:
            for yy in [-5,1,7]:
                box('Salt pan rim',(xx,yy,.15),(5.5,5.5,.4),chalk)
                box('Salt brine',(xx,yy,.37),(4.8,4.8,.04),water)
    if theme=='canyon':
        for xx in [-8,8]:box('Canyon escarpment',(xx,1,1.1),(4,30,2.4),clay)
        box('Canyon shadow',(0,0,.01),(9,36,.05),darkstone)
        for k in range(14):box('Cross canyon bridge',(-6.5+k,0,2.5),(1.05,3,.5),sand)
        for k in range(5):box('Sandstone step',(-27,24-k*2,k*.45),(10,2.3,.5),sand)
    if theme=='cathedral':
        # Radial forecourt and rose-window nave around the northern cathedral.
        cone('Central fountain',0,2,0,3,.3,chalk,24,top=3)
        cone('Fountain water',0,2,.31,2.6,.05,water,24,top=2.6)
        cone('Fountain column',0,2,.35,.3,3,chalk,12)
    if theme=='citadel':
        for x in [-12,12]:
            box('Inner curtain wall',(x,17,1.7),(1,19,3.4),stone[0])
            for y in range(8,27,2):box('Inner crenellation',(x,y,3.65),(1.2,.65,.55),chalk)
        for x in [-9,9]:box('Barracks annex',(x,24,1.2),(3,6,2.4),stone[0])
    if theme=='forest':
        for i in range(30):
            a=i*math.tau/30;x=29*math.cos(a);y=27*math.sin(a)
            if abs(x)<4 or abs(y)<4:continue
            town_plant(x,y,s=1.25)
    if theme=='caravan':
        redsail_square()
    group('Defensive perimeter')
    for x in [-32,32]:
        box('Side wall',(x,1,1),(1,58,2),stone[0] if culture!='vildun' else wood)
    box('Back wall',(0,30,1),(63,1.2,2),stone[0] if culture!='vildun' else wood)
    if theme not in ['harbor','fjord']:
        for x in [-19,19]:box('Front cutaway',(x,-30,.4),(26,1,.8),stone[1])
    for x in [-32,32]:
        for y in [-29,29]:
            cone('Watchtower',x,y,0,1.9,4,wood if culture=='vildun' else stone[1],8,top=1.9)
            if culture=='yunhua':roof(x,y,4,5,5,1.2)
            else:cone('Tower roof',x,y,4,2.6,2,slate if culture=='vildun' else blue,8)
    if theme=='forest':
        for y in range(-27,30,2):
            for x in [-31,31]:cone('Palisade stake',x,y,0,.22,3.7,timber,5,top=.1)
    bpy.context.view_layer.update()
    town_civics=geometry_tree([o for r in roots if r.get('facility') or r.name=='Town identity landmarks' for o in r.children])
    group('Local craft and landscape')
    landscape_lots=[(-28,25),(-27,-23),(26,24),(29,-19),(-12,27),(15,27)]
    if detail_city=='redsail':landscape_lots=[(-28,25),(-27,-25),(27,25),(-14,26),(14,26)]
    for x,y in landscape_lots:
        town_plant(x,y,s=1.1 if culture=='vildun' else .75,palmtree=culture=='safir')
    if theme=='kiln':
        for x in [9,15,21]:
            ball('Brick kiln',(x,24,1.5),(2.2,2,2.3),clay,2);cone('Kiln flue',x,24,3,.6,4,darkstone,8)
            box('Kiln firemouth',(x,21.98,.7),(.8,.08,1.1),wood)
    if theme=='harbor':
        for x in [-25,-19,-13]:box('Salt evaporation bed',(x,-24,.05),(4.8,7,.1),chalk)
    if theme=='terrace':
        for x,y in [(-26,19),(-20,22),(25,-21),(23,24),(-27,2)]:
            base=3.5 if y>=14.5 else 1.6 if y>=1.5 else 0
            for k in range(6):
                xx=x+k*.35;line('Bamboo stalk',[(xx,y,base),(xx+.2,y,base+5)],.055,pinegreen)
                for z in [1,2,3,4]:box('Bamboo node',(xx+.1,y,base+z),(.14,.14,.08),grass)
                for sign in [-1,1]:mesh('Bamboo leaves',[(xx,y,base+3),(xx+sign*1,y,base+4),(xx+sign*.7,y+.2,base+3.3)],[(0,1,2)],pinegreen)
        line('Hanging spring',[(25,29,6),(25,26,4),(26,23,1.8)],.35,water)
        for x in [-29,-12]:
            for y in [1,3,5]:box('Herb bed',(x,y,(1.6 if y>=1.5 else 0)+.05),(4,1,.3),pinegreen)
    if theme=='forest':
        for x in [-8,0,8]:cone('Standing rune stone',x,24,0,.75,3.5,stone[0],5,top=.35)
    populate_homes(city)
    if detail_city=='redsail':redsail_finish()
    verify_city_clearance(city)
    save_scene(city['key'])

def world():
    global detail_city
    detail_city=None
    source=Path(__file__).with_name('world-surface.py')
    exec(compile(source.read_text(encoding='utf-8-sig'),str(source),'exec'),globals())
    build_world()


def refresh_paving(city):
    global scene,roots,parent,roadmat
    import bmesh
    bpy.ops.wm.open_mainfile(filepath=str(OUT/(city['key']+'.blend')))
    scene=bpy.context.scene
    roadmat=bpy.data.materials.get('Road ochre')
    if roadmat is None:raise RuntimeError('Road material missing')
    root=bpy.data.objects.get('Streets and courtyards')
    if root is None:raise RuntimeError('Street root missing')
    for obj in list(root.children):
        if obj.type!='MESH':continue
        indices={i for i,m in enumerate(obj.data.materials) if m==roadmat}
        bm=bmesh.new();bm.from_mesh(obj.data)
        bmesh.ops.delete(bm,geom=[f for f in bm.faces if f.material_index in indices],context='FACES')
        bm.to_mesh(obj.data);bm.free()
    parent=root;paving(city)
    for obj in list(scene.objects):
        if obj.type in {'LIGHT','CAMERA'}:bpy.data.objects.remove(obj,do_unlink=True)
    roots=[o for o in scene.objects if o.type=='EMPTY']
    save_scene(city['key'])

args=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
if args and args[0]=='paving':
    for index,city in enumerate(atlas['cities']):
        if city['key'] in args[1:]:
            # Redsail streets share its bespoke material and district geometry.
            if city['key']=='redsail':town(city,index)
            else:refresh_paving(city)
    sys.exit(0)
for index,city in enumerate(atlas['cities']):
    if city['key']=='yunjing':continue
    if not args or city['key'] in args:town(city,index)
if not args or 'world' in args:world()
