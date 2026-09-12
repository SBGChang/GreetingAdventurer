"""Redsail-only architectural detail and packed UV atlas. Loaded by build-geography."""
texture=bpy.data.images.load(str(OUT/'redsail-material-atlas.png'),check_existing=True)
texture.pack()
def rs_material(name,cell,roughness):
    m=mat('Redsail '+name,(1,1,1),roughness)
    m['atlas_cell']=cell
    nodes=m.node_tree.nodes;tex=nodes.new('ShaderNodeTexImage');tex.image=texture
    uv=nodes.new('ShaderNodeUVMap');uv.uv_map='Craft UV'
    m.node_tree.links.new(uv.outputs['UV'],tex.inputs['Vector'])
    m.node_tree.links.new(tex.outputs['Color'],nodes.get('Principled BSDF').inputs['Base Color'])
    return m
rs_stone=rs_material('dressed sandstone',0,.84)
rs_tile=rs_material('star glazed ceramic',1,.28)
rs_cloth=rs_material('embroidered sail',2,.92)
rs_plaster=rs_material('lime plaster',3,.88)
rs_shadow=mat('Redsail recessed cedar',(.075,.04,.025),.85)
exec(compile(Path(__file__).with_name('world-surface.py').read_text(encoding='utf-8').split('def uv_project')[0],str(Path(__file__).with_name('world-surface.py')),'exec'),globals())
rs_floor=texture_material('Redsail fine limestone paving','redsail-paving-albedo.png',.86)
rs_glaze=texture_material('Redsail fine dome mosaic','redsail-glaze-albedo.png',.3)
for material in [rs_floor,rs_glaze]:
    uv=material.node_tree.nodes.new('ShaderNodeUVMap');uv.uv_map='Craft UV'
    albedo=next(n for n in material.node_tree.nodes if n.type=='TEX_IMAGE')
    material.node_tree.links.new(uv.outputs['UV'],albedo.inputs['Vector'])
bake_normal(rs_glaze,'redsail-glaze-normal',.01,'Craft UV',2048)
bake_normal(rs_floor,'redsail-paving-normal',.018,'Craft UV',2048)
bake_normal(rs_stone,'redsail-craft-normal',.008,'Craft UV',2048)
normal_image=bpy.data.images.get('redsail-craft-normal')
for material in [rs_tile,rs_cloth,rs_plaster]:
    nodes=material.node_tree.nodes;links=material.node_tree.links
    uv=nodes.new('ShaderNodeUVMap');uv.uv_map='Craft UV'
    tex=nodes.new('ShaderNodeTexImage');tex.image=normal_image;links.new(uv.outputs['UV'],tex.inputs['Vector'])
    normal=nodes.new('ShaderNodeNormalMap');normal.uv_map='Craft UV';normal.inputs['Strength'].default_value=.24 if material==rs_tile else .45
    links.new(tex.outputs['Color'],normal.inputs['Color']);links.new(normal.outputs['Normal'],nodes.get('Principled BSDF').inputs['Normal'])

def rs_uv(obj,cell):
    uv=obj.data.uv_layers.new(name='Craft UV') if not obj.data.uv_layers else obj.data.uv_layers.active
    uv.name='Craft UV'
    # Box projection per face; domes and cloth supply continuous coordinates separately.
    coords=[v.co for v in obj.data.vertices]
    lo=[min(v[k] for v in coords) for k in range(3)];hi=[max(v[k] for v in coords) for k in range(3)]
    for p in obj.data.polygons:
        axis=max(range(3),key=lambda k:abs(p.normal[k]));axes=[k for k in range(3) if k!=axis]
        for li in p.loop_indices:
            v=coords[obj.data.loops[li].vertex_index]
            a,b=[(v[k]-lo[k])/max(.001,hi[k]-lo[k]) for k in axes]
            uv.data[li].uv=((cell%2)*.5+.012+a*.476,(1-cell//2)*.5+.012+b*.476)

def rs_dome(x,y,z,rx,ry,height):
    verts=[];faces=[];n=64;rings=24
    for j in range(rings+1):
        t=j/rings;radius=math.cos(t*math.pi/2)*(1+.12*math.sin(t*math.pi))
        for i in range(n+1):
            a=i/n*math.tau;verts.append((x+rx*radius*math.cos(a),y+ry*radius*math.sin(a),z+height*t))
    for j in range(rings):
        for i in range(n):
            k=j*(n+1)+i;faces.append((k,k+1,k+n+2,k+n+1))
    o=mesh('Redsail ribbed ceramic cupola',verts,faces,rs_glaze)
    uv=o.data.uv_layers.new(name='Craft UV')
    for p in o.data.polygons:
        p.use_smooth=True
        for li in p.loop_indices:
            k=o.data.loops[li].vertex_index;uv.data[li].uv=((k%(n+1))/n*2,(k//(n+1))/rings)
    for i in range(12):
        a=i*math.tau/12;points=[]
        for j in range(17):
            t=j/16;r=math.cos(t*math.pi/2)*(1+.12*math.sin(t*math.pi))
            points.append((x+(rx+.025)*r*math.cos(a),y+(ry+.025)*r*math.sin(a),z+height*t+.025))
        line('Gilt dome rib',points,.024,gold)
    cone('Finial stem',x,y,z+height,.055,.65,gold,16)
    ball('Finial pearl',(x,y,z+height+.38),(.15,.15,.15),gold,2)

def rs_arch(x,y,z,w,h,material=rs_stone):
    # Raised voussoirs and recessed arched insert; no boolean cuts or coplanar decals.
    r=w/2;spring=z+h-r
    points=[(x-r,y,z),(x-r,y,spring)]
    points += [(x+r*math.cos(math.pi-i*math.pi/16),y,spring+r*math.sin(math.pi-i*math.pi/16)) for i in range(17)]
    points.append((x+r,y,z))
    mesh('Recessed arched opening',points,[tuple(range(len(points)))],rs_shadow)
    if z<.5:
        for i in range(6):
            left=-r+i*w/6+.016;right=-r+(i+1)*w/6-.016
            top=spring+math.sqrt(max(0,r*r-max(abs(left),abs(right))**2))-.08
            box('Individual cedar door plank',(x+(left+right)/2,y-.035,(z+top)/2),(right-left,.045,top-z),wood,.012)
        for zz in [z+.25,z+.95]:
            box('Forged door strap',(x,y-.072,zz),(w-.15,.045,.08),gold,.012)
            for dx in [-w*.32,w*.32]:ball('Hand forged rivet',(x+dx,y-.11,zz),(.032,.025,.032),gold,1)
        for dx in [-w*.13,w*.13]:line('Bronze ring door pull',[(x+dx+.075*math.cos(i*math.tau/16),y-.12,z+.68+.09*math.sin(i*math.tau/16)) for i in range(17)],.018,gold)
    line('Carved archivolt',[(a,b-.07,c) for a,b,c in points],.10,material)
    for dx in [-r,r]:
        box('Arch impost',(x+dx,y-.08,spring),(.29,.24,.15),gold,.02)
    for i in range(1,5):
        xx=x-r+i*w/5
        top=spring+math.sqrt(max(0,r*r-(xx-x)**2))-.08
        line('Cedar lattice upright',[(xx,y-.04,z+.08),(xx,y-.04,top)],.025,timber)
    for zz in [z+.35,z+.7,z+1.05]:
        if zz<spring:line('Lattice cross rail',[(x-r+.08,y-.05,zz),(x+r-.08,y-.05,zz)],.022,gold)

def redsail_hall(name,facility,x,y,w,d,h):
    root=group(name,facility)
    box('Stepped sandstone footing',(x,y,.16),(w+.55,d+.55,.32),rs_stone,.08)
    box('Limewashed residence',(x,y,.4+h/2),(w,d,h),rs_plaster,.08)
    for z,expand,height in [(.53,.12,.35),(h+.12,.18,.22),(h+.4,.38,.25)]:
        box('Moulded cornice',(x,y,z),(w+expand,d+expand,height),rs_stone,.055)
    for xx in [x-w/2+.12,x+w/2-.12]:
        box('Carved corner pilaster',(xx,y-d/2-.08,h/2+.4),(.25,.26,h),rs_stone,.03)
    box('Ceramic frieze',(x,y-d/2-.035,h-.25),(w-.35,.08,.47),rs_tile,.01)
    for xx in [x-w*.3,x+w*.3]:rs_arch(xx,y-d/2-.10,h*.48,w*.19,h*.38)
    from mathutils import Matrix
    for yy in [y-d*.23,y+d*.23]:
        before=set(scene.objects)
        rs_arch(0,0,h*.47,d*.22,h*.36)
        transform=Matrix.Translation((x+w/2+.12,yy,0)) @ Matrix.Rotation(math.pi/2,4,'Z')
        for o in set(scene.objects)-before:o.matrix_world=transform @ o.matrix_world
    for i in range(7 if facility else 4):
        xx=x-w*.42+i*w*.84/(6 if facility else 3)
        box('Carved cornice corbel',(xx,y-d/2-.12,h-.04),(.18,.30,.32),rs_stone,.025)
    rs_arch(x,y-d/2-.12,.34,1.25 if facility else .85,2.35 if facility else 1.65)
    for i in range(3):box('Entry stair',(x,y-d/2-.22-i*.22,.28-i*.07),(1.65,.3,.14),rs_stone,.02)
    # Smaller residences have roof terraces; public buildings keep prominent ceramic crowns.
    if facility or int(name.split()[-1])%3==0:
        cone('Cupola drum',x,y,h+.51,min(w,d)*.43,.35,rs_stone,40,top=min(w,d)*.43)
        rs_dome(x,y,h+.8,w*.43,d*.43,w*.36)
    else:
        for xx in [x-w/2,x+w/2]:box('Terrace parapet',(xx,y,h+.8),(.18,d,.6),rs_stone,.03)
        box('Terrace parapet',(x,y+d/2,h+.8),(w,.18,.6),rs_stone,.03)
        box('Roof carpet',(x,y,h+.54),(w*.6,d*.6,.025),rs_cloth,0)
    if facility:
        for xx in [x-w*.43,x+w*.43]:
            for zz in [h*.3,h*.6,h*.9]:box('Pilaster carved collar',(xx,y-d/2-.15,zz),(.38,.28,.14),rs_stone,.02)
        if facility=='inn':
            box('Inn balcony',(x,y-d/2-.6,h*.58),(w-.4,1.1,.22),rs_stone,.04)
            for i in range(11):box('Balcony spindle',(x-w*.43+i*w*.086,y-d/2-1,h*.58+.42),(.06,.06,.72),timber,.01)
            box('Balcony rail',(x,y-d/2-1,h*.58+.8),(w-.3,.12,.12),timber,.02)
    return root

def redsail_finish():
    global parent
    redsail_masonry()
    for o in list(scene.objects):
        if o.type=='MESH' and (o.name.startswith('Town ground') or any(m==roadmat for m in o.data.materials)):
            o.data.materials.clear();o.data.materials.append(rs_floor)
            uv=o.data.uv_layers.new(name='Craft UV')
            for p in o.data.polygons:
                for li in p.loop_indices:
                    v=o.matrix_world @ o.data.vertices[o.data.loops[li].vertex_index].co
                    uv.data[li].uv=(v.x/6,v.y/6)
    for o in list(scene.objects):
        if o.type!='MESH':continue
        if o.name.startswith(('Gate turret','Tower roof')):
            parent=o.parent;loc=o.location.copy();radius=max(v.co.x for v in o.data.vertices);bottom=min(v.co.z for v in o.data.vertices);top=max(v.co.z for v in o.data.vertices)
            bpy.data.objects.remove(o,do_unlink=True)
            rs_dome(loc.x,loc.y,loc.z+bottom,radius,radius,top-bottom)
        elif o.name.startswith('Red sail canopy'):
            parent=o.parent;vs=[v.co for v in o.data.vertices];x=sum(v.x for v in vs)/5;y=sum(v.y for v in vs)/5
            bpy.data.objects.remove(o,do_unlink=True)
            verts=[];faces=[];nx=16;ny=12
            for j in range(ny+1):
                v=j/ny
                for i in range(nx+1):
                    u=i/nx;z=2.65+1.7*(1-abs(2*u-1))-.4*math.sin(v*math.pi)+.1*math.sin(u*math.pi*8)*abs(2*v-1)
                    verts.append((x-4+u*8,y-3+v*6,z))
            for j in range(ny):
                for i in range(nx):
                    k=j*(nx+1)+i;faces.append((k,k+1,k+nx+2,k+nx+1))
            cloth=mesh('Curved embroidered market sail',verts,faces,rs_cloth)
            uv=cloth.data.uv_layers.new(name='Craft UV')
            for p in cloth.data.polygons:
                p.use_smooth=True
                for li in p.loop_indices:
                    k=cloth.data.loops[li].vertex_index;uv.data[li].uv=(.012+k%(nx+1)/nx*.476,.012+k//(nx+1)/ny*.476)
            for j in [0,ny]:line('Sail edge binding',[verts[j*(nx+1)+i] for i in range(nx+1)],.045,gold)
            for dx in [-4,4]:
                for dy in [-3,3]:line('Market corner pole',[(x+dx,y+dy,.02),(x+dx,y+dy,2.8)],.075,timber)
            box('Merchant counter',(x,y+1,.7),(5,1,.25),timber,.04)
            for i in range(5):cone('Market ceramic vessel',x-2+i,y+1,.85,.25,.55,rs_tile,16,top=.17)
        else:
            for slot in o.material_slots:
                if slot.material==sand and not o.name.startswith('Town ground'):slot.material=rs_stone
                elif slot.material==blue:slot.material=rs_tile
                elif slot.material==red:slot.material=rs_cloth
    parent=bpy.data.objects.get('Defensive perimeter')
    for o in list(scene.objects):
        if o.type=='MESH' and 'Craft UV' not in o.data.uv_layers:
            cells=[m.get('atlas_cell') for m in o.data.materials if m and 'atlas_cell' in m]
            if cells:rs_uv(o,cells[0])

def redsail_palm(x,y,z=0,s=1):
    crown=(x+.3*s,y,z+3*s)
    line('Ringed palm trunk',[(x,y,z),(x+.06*s,y,z+s),(x+.2*s,y,z+2*s),crown],.14*s,timber)
    for i in range(10):
        a=i*math.tau/10;points=[]
        for j in range(9):
            t=j/8;points.append((crown[0]+math.cos(a)*2.1*s*t,crown[1]+math.sin(a)*2.1*s*t,crown[2]+s*(.65*math.sin(t*math.pi)-.55*t)))
        line('Palm curved rachis',points,.021*s,pinegreen)
        for j in range(1,8):
            p=Vector(points[j]);q=Vector(points[j+1]);width=.36*s*math.sin(j/8*math.pi)
            for sign in [-1,1]:
                tip=p+Vector((-math.sin(a)*width*sign+math.cos(a)*.25*s,math.cos(a)*width*sign+math.sin(a)*.25*s,-.14*s))
                mesh('Palm pinna',[p,q,tip],[(0,1,2)],pinegreen)

def rs_ashlar(name,loc,dims):
    o=box(name,loc,dims,rs_stone,.025)
    for m in o.modifiers:
        if m.type=='BEVEL':m.segments=1
    rs_uv(o,0)
    for uv in o.data.uv_layers.active.data:
        # Sample a single stone from the atlas, not an entire masonry sheet on every block.
        uv.uv=(.02+(uv.uv.x-.012)*.30,.85+(uv.uv.y-.512)*.25)
    return o

def redsail_masonry():
    global parent
    for kind in ['cityGate','adventureCheckpoint']:
        parent=bpy.data.objects.get(kind)
        piers=[o for o in parent.children if o.name.startswith('Gate pier')]
        for pier in piers:
            x,y= pier.location.x,pier.location.y
            bpy.data.objects.remove(pier,do_unlink=True)
            for row in range(8):rs_ashlar('Gate dressed course',(x,y,row*.5+.25),(1.6,3,.475))
            for z in [.12,3.18]:rs_ashlar('Gate impost moulding',(x,y,z),(1.74,3.10,.20))
        for o in list(parent.children):
            if o.name.startswith('Gate lintel'):
                x,y=o.location.x,o.location.y
                o.data.materials.clear();o.data.materials.append(rs_stone)
                box('Gate glazed dedication band',(x,y-1.51,3.75),(3.5,.08,.32),rs_tile,.01)
                points=[(x-1.78,y-1.52,1.65)]+[(x+1.78*math.cos(math.pi-i*math.pi/24),y-1.52,1.65+1.78*math.sin(math.pi-i*math.pi/24)) for i in range(25)]
                line('Gate carved horseshoe arch',points,.14,rs_stone)
    parent=bpy.data.objects.get('Defensive perimeter')
    for o in list(parent.children):
        if o.name.startswith(('Side wall','Back wall','Front cutaway','Watchtower')):bpy.data.objects.remove(o,do_unlink=True)
    def curtain(cx,cy,length,side=False,low=False):
        height=.84 if low else 2.4;depth=1.1
        def block(name,u,z,width,h,thickness=depth):
            rs_ashlar(name,(cx if side else cx+u,cy+u if side else cy,z),(thickness,width,h) if side else (width,thickness,h))
        rows=2 if low else 5;course=height/rows
        count=math.ceil(length/1.8);step=length/count
        for row in range(rows):
            cuts=[-length/2]+[-length/2+i*step+(step/2 if row%2 else 0) for i in range(count+1) if -length/2<-length/2+i*step+(step/2 if row%2 else 0)<length/2]+[length/2]
            for left,right in zip(cuts,cuts[1:]):block('Staggered sandstone course',(left+right)/2,(row+.5)*course,right-left-.035,course-.025)
        for i in range(count):
            u=-length/2+(i+.5)*step
            block('Chamfered coping',u,height+.10,step-.02,.2,1.3)
            if not low and i%2==0:
                block('Merlon plinth',u,height+.29,.96,.20,1.18)
                block('Carved merlon',u,height+.56,.75,.36,1.08)
                block('Merlon crown',u,height+.8,.88,.12,1.20)
    curtain(32,1,55,side=True)
    for y,length in [(-15,23),(16,25)]:curtain(-32,y,length,side=True)
    for x in [-17,17]:curtain(x,30,26)
    for x in [-19,19]:curtain(x,-30,26,low=True)
    for x in [-32,32]:
        for y in [-29,29]:
            # Layered cylindrical guard tower with dressed joints, slit openings and glazed crown band.
            cone('Tower masonry core',x,y,0,1.88,4,rs_plaster,32,top=1.88)
            for row in range(8):
                for i in range(16):
                    a=(i+(row%2)*.5)*math.tau/16;b=a+math.tau/16-.014
                    verts=[]
                    for z in [row*.5+.015,(row+1)*.5-.015]:
                        for r in [1.85,1.96]:
                            for angle in [a,b]:verts.append((x+r*math.cos(angle),y+r*math.sin(angle),z))
                    o=mesh('Tower curved ashlar',verts,[(0,1,3,2),(4,6,7,5),(2,3,7,6),(0,4,5,1),(0,2,6,4),(1,5,7,3)],rs_stone);rs_uv(o,0)
                    for uv in o.data.uv_layers.active.data:uv.uv=(.02+(uv.uv.x-.012)*.3,.85+(uv.uv.y-.512)*.25)
            for z,r,h,m in [(.05,2.08,.22,rs_stone),(3.35,2.03,.18,rs_stone),(3.53,1.99,.25,rs_tile),(3.82,2.16,.18,rs_stone)]:cone('Tower carved collar',x,y,z,r,h,m,40,top=r)
            for dx in [-.52,.52]:rs_arch(x+dx,y-1.97,2.15,.32,.86)

# Authored districts replace the old generic vacant-lot scatter for this city.
redsail_plan=[(-8,23),(23,16),(-13,14),(10,17),(-24,-17),(-23,14),(-6,-21),(-14,-17),(0,29),(-29,0)]
redsail_house_lots=[(x,y) for y in [0,-8,-16,-24] for x in [13,18,23,28]]

def redsail_streets():
    # Continuous gate spine, bazaar cross street, and narrower residential lanes.
    strips=[(-2.3,2.3,-29,28),(-29,30,-11,-9),(8.4,10.8,-28,10),
            (-25,27,7.75,9.25),(-29,-7,-1.5,.5),(-16,-14.5,-10,9),
            (-20,-18,-25,-10)]
    strips += [(9,30,y-1,y+1) for y in [-3.5,-11.5,-19.5,-27.5]]
    vv=[];ff=[]
    for row in range(124):
        y=-31+row*.5
        for col in range(132):
            x=-33+col*.5
            if not any(a<=x+.25<=b and c<=y+.25<=d for a,b,c,d in strips):continue
            k=len(vv);vv.extend([(x,y,-.09),(x+.5,y,-.09),(x+.5,y+.5,-.09),(x,y+.5,-.09)]);ff.append((k,k+1,k+2,k+3))
    mesh('District street network',vv,ff,roadmat)
    for x in [-2.6,2.6]:
        for y in list(range(10,27,2))+list(range(-28,-8,2)):
            rs_ashlar('Main avenue kerbstone',(x,y,-.015),(.22,1.9,.20))
    for y in range(-27,8,2):
        if any(abs(y-lane)<1.5 for lane in [-3.5,-11.5,-19.5,-27.5,-10]):continue
        rs_ashlar('Residential lane threshold',(9.25,y,-.015),(.20,1.7,.20))

def redsail_square():
    global parent
    parent['district']='civic-square'
    # A clear gathering space, with circulation around a central cistern.
    for x in [-7,7]:
        for y in range(-6,9,2):rs_ashlar('Square border',(x,y,-.015),(.22,1.9,.20))
    for y in [-7,9]:
        for x in [-6,-4,4,6]:rs_ashlar('Square entrance paving',(x,y,-.015),(1.9,.22,.20))
    cone('Cistern octagonal footing',0,2,-.04,2.2,.20,rs_stone,8,top=2.2)
    cone('Still cistern water',0,2,.17,1.80,.04,water,48,top=1.80)
    for i in range(8):
        a=i*math.tau/8;b=(i+1)*math.tau/8
        line('Carved cistern rim',[(2*math.cos(a),2+2*math.sin(a),.35),(2*math.cos(b),2+2*math.sin(b),.35)],.17,rs_stone)
    cone('Fountain pedestal',0,2,.20,.30,.8,rs_stone,16,top=.22)
    cone('Fountain bowl',0,2,.92,.75,.18,rs_tile,32,top=.85)
    for x in [-5,5]:
        box('Square cedar bench',(x,-3,.58),(2.4,.65,.16),timber,.035)
        for dx in [-.8,.8]:box('Bench stone leg',(x+dx,-3,.26),(.23,.55,.50),rs_stone,.025)
    for x in [-5,6]:redsail_palm(x,6,s=.8)
    cone('Neighbourhood water well',9,-13,0,.72,.60,rs_stone,16,top=.72)
    cone('Neighbourhood well water',9,-13,.61,.54,.02,water,32,top=.54)

def redsail_homes():
    global parent
    blockers=[geometry_tree(r.children) for r in roots if r.get('facility') or r.name in ['Town identity landmarks','Local craft and landscape','Market stalls']]
    for index,(x,y) in enumerate(redsail_house_lots):
        root=redsail_hall('Residential ward '+str(index),None,x,y,3.6,3.1,2.4)
        root['scenery']=True;root['district']='residential';root['streetRow']=index//4
        bpy.context.view_layer.update();shape=geometry_tree(root.children)
        if any(t and shape.overlap(t) for t in blockers):raise RuntimeError('Authored Redsail residential lot intersects: '+str((x,y)))
        blockers.append(shape)
    for kind in ['itemShop','tavern']:bpy.data.objects.get(kind)['district']='bazaar'
    for kind in ['equipmentShop','trainingGround']:bpy.data.objects.get(kind)['district']='workshops'
    for kind in ['adventurerGuild','bookstore','inn']:bpy.data.objects.get(kind)['district']='civic-quarter'
    bpy.data.objects.get('Market stalls')['district']='bazaar'
