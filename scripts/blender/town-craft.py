"""Shared close-view craftsmanship with culture-specific silhouettes and trades.
Loaded into the Blender authoring namespace; no game state or content definitions.
"""
CRAFT_DIR=ROOT/'app/assets/geography'

def craft_materials():
    global craft_mats,craft_floor,craft_cloth,craft_cream,craft_rock,craft_ground,craft_material_version
    if globals().get('craft_material_version')==2:return
    atlas_image=bpy.data.images.load(str(CRAFT_DIR/'town-craft-atlas.png'),check_existing=True);atlas_image.pack()
    craft_mats=[]
    for cell,name in enumerate(['cedar joinery','dressed limestone','jade roof tiles','slate shingles']):
        m=mat('Town craft '+name,(1,1,1),.82 if cell<2 else .52)
        m['craftCell']=cell
        nodes=m.node_tree.nodes;links=m.node_tree.links
        uv=nodes.new('ShaderNodeUVMap');uv.uv_map='Craft UV'
        tex=nodes.new('ShaderNodeTexImage');tex.image=atlas_image
        links.new(uv.outputs['UV'],tex.inputs['Vector']);links.new(tex.outputs['Color'],nodes.get('Principled BSDF').inputs['Base Color'])
        craft_mats.append(m)
    normal_path=CRAFT_DIR/'town-craft-normal.png'
    if normal_path.exists():
        normal_image=bpy.data.images.load(str(normal_path),check_existing=True);normal_image.colorspace_settings.name='Non-Color';normal_image.pack()
        for m in craft_mats:
            nodes=m.node_tree.nodes;links=m.node_tree.links
            uv=nodes.new('ShaderNodeUVMap');uv.uv_map='Craft UV'
            tex=nodes.new('ShaderNodeTexImage');tex.image=normal_image;links.new(uv.outputs['UV'],tex.inputs['Vector'])
            normal=nodes.new('ShaderNodeNormalMap');normal.uv_map='Craft UV';normal.inputs['Strength'].default_value=.45
            links.new(tex.outputs['Color'],normal.inputs['Color']);links.new(normal.outputs['Normal'],nodes.get('Principled BSDF').inputs['Normal'])
    craft_floor=mat('Town craft close limestone pavement',(1,1,1),.9)
    nodes=craft_floor.node_tree.nodes;links=craft_floor.node_tree.links
    tex=nodes.new('ShaderNodeTexImage');tex.image=bpy.data.images.load(str(CRAFT_DIR/'redsail-paving-albedo.png'),check_existing=True);tex.image.pack()
    uv=nodes.new('ShaderNodeUVMap');uv.uv_map='Craft UV';links.new(uv.outputs['UV'],tex.inputs['Vector']);links.new(tex.outputs['Color'],nodes.get('Principled BSDF').inputs['Base Color'])
    craft_ground={}
    for kind in ['meadow','snow','rock','sand']:
        m=mat('Town craft '+kind+' ground',(1,1,1),.96);nodes=m.node_tree.nodes;links=m.node_tree.links
        uv=nodes.new('ShaderNodeUVMap');uv.uv_map='Craft UV'
        tex=nodes.new('ShaderNodeTexImage');tex.image=bpy.data.images.load(str(CRAFT_DIR/(kind+'-albedo.png')),check_existing=True);tex.image.pack()
        links.new(uv.outputs['UV'],tex.inputs['Vector']);links.new(tex.outputs['Color'],nodes.get('Principled BSDF').inputs['Base Color'])
        normal=nodes.new('ShaderNodeNormalMap');normal.uv_map='Craft UV';normal.inputs['Strength'].default_value=.3
        nt=nodes.new('ShaderNodeTexImage');nt.image=bpy.data.images.load(str(CRAFT_DIR/(kind+'-normal.png')),check_existing=True);nt.image.colorspace_settings.name='Non-Color';nt.image.pack()
        links.new(uv.outputs['UV'],nt.inputs['Vector']);links.new(nt.outputs['Color'],normal.inputs['Color']);links.new(normal.outputs['Normal'],nodes.get('Principled BSDF').inputs['Normal'])
        craft_ground[kind]=m
    nodes=craft_floor.node_tree.nodes;links=craft_floor.node_tree.links;uv=next(n for n in nodes if n.type=='UVMAP')
    normal=nodes.new('ShaderNodeNormalMap');normal.uv_map='Craft UV';normal.inputs['Strength'].default_value=.4
    nt=nodes.new('ShaderNodeTexImage');nt.image=bpy.data.images.load(str(CRAFT_DIR/'redsail-paving-normal.png'),check_existing=True);nt.image.colorspace_settings.name='Non-Color';nt.image.pack()
    links.new(uv.outputs['UV'],nt.inputs['Vector']);links.new(nt.outputs['Color'],normal.inputs['Color']);links.new(normal.outputs['Normal'],nodes.get('Principled BSDF').inputs['Normal'])
    craft_cloth=mat('Town craft dyed linen',(.18,.32,.33),.96)
    craft_cream=mat('Town craft unbleached canvas',(.75,.65,.44),.98)
    craft_rock=mat('Town craft regional rock',(1,1,1),.94)
    nodes=craft_rock.node_tree.nodes;links=craft_rock.node_tree.links
    tex=nodes.new('ShaderNodeTexImage');tex.image=bpy.data.images.load(str(CRAFT_DIR/'rock-albedo.png'),check_existing=True);tex.image.pack()
    uv=nodes.new('ShaderNodeUVMap');uv.uv_map='Craft UV';links.new(uv.outputs['UV'],tex.inputs['Vector']);links.new(tex.outputs['Color'],nodes.get('Principled BSDF').inputs['Base Color'])
    craft_material_version=2

def craft_uv(obj,cell=None,scale=5):
    if not obj.data.vertices:return
    uv=obj.data.uv_layers.get('Craft UV') or obj.data.uv_layers.new(name='Craft UV')
    points=[v.co for v in obj.data.vertices];lo=[min(p[k] for p in points) for k in range(3)];hi=[max(p[k] for p in points) for k in range(3)]
    for face in obj.data.polygons:
        axes=[i for i in range(3) if i!=max(range(3),key=lambda k:abs(face.normal[k]))]
        for li in face.loop_indices:
            v=points[obj.data.loops[li].vertex_index]
            if cell is None:
                p=obj.matrix_world @ v;uv.data[li].uv=(p[axes[0]]/scale,p[axes[1]]/scale)
            else:
                a,b=[(v[k]-lo[k])/max(.001,hi[k]-lo[k]) for k in axes]
                uv.data[li].uv=(cell%2*.5+.014+a*.472,(1-cell//2)*.5+.014+b*.472)

def craft_cone(name,x,y,z,r,h,m,n=24,top=0):
    bpy.ops.mesh.primitive_cone_add(vertices=n,radius1=r,radius2=top,depth=h,location=(x,y,z+h/2))
    return finish(bpy.context.object,name,m)

def craft_roof(x,y,z,w,d,rise,culture,variant=0):
    # Curved tiled Chinese eaves, steep northern gables, and masonry-town slate.
    m=craft_mats[2 if culture=='yunhua' else 3]
    if culture=='yunhua':
        for sign in [-1,1]:
            vv=[];ff=[]
            for j in range(13):
                v=j/12
                for i in range(17):
                    u=i/16;zz=z+rise*(1-u)**1.55+.19*u**7+.12*abs(v*2-1)**5*u
                    vv.append((x+sign*w/2*u,y+(v-.5)*d,zz))
            for j in range(12):
                for i in range(16):k=j*17+i;ff.append((k,k+1,k+18,k+17))
            o=mesh('Curved glazed tile field',vv,ff,m);craft_uv(o,2)
            for j in range(13):line('Ceramic roll cap',[vv[j*17+i] for i in range(17)],.023,roofedge)
            line('Swept eave moulding',[vv[j*17+16] for j in range(13)],.07,roofedge)
        line('Carved tile ridge',[(x,y-d/2-.08,z+rise+.12),(x,y,z+rise+.04),(x,y+d/2+.08,z+rise+.12)],.095,gold)
    else:
        vv=[(x-w/2,y-d/2,z),(x+w/2,y-d/2,z),(x,y-d/2,z+rise),(x-w/2,y+d/2,z),(x+w/2,y+d/2,z),(x,y+d/2,z+rise)]
        o=mesh('Crafted steep roof',vv,[(0,2,1),(3,4,5),(0,3,5,2),(1,2,5,4)],m);craft_uv(o,3)
        for yy in [y-d/2,y+d/2]:line('Carved gable verge',[(x-w/2,yy,z),(x,yy,z+rise),(x+w/2,yy,z)],.085,timber if culture=='vildun' else stone[3])
        for j in range(1,9):
            t=j/9
            for sign in [-1,1]:line('Overlapping shingle course',[(x+sign*w/2*t,y-d/2,z+rise*(1-t)+.015),(x+sign*w/2*t,y+d/2,z+rise*(1-t)+.015)],.018,roofedge)
        line('Ridge weather cap',[(x,y-d/2-.1,z+rise+.03),(x,y+d/2+.1,z+rise+.03)],.08,timber)
        if culture=='vildun':
            for yy,sign in [(y-d/2,-1),(y+d/2,1)]:line('Northern carved ridge tip',[(x,yy,z+rise),(x,yy+sign*.25,z+rise+.35),(x,yy+sign*.35,z+rise+.55)],.07,timber)

def craft_window(x,y,z,w,h,culture):
    if culture=='aurelien':
        vv=[(x-w/2,y,z),(x+w/2,y,z),(x+w/2,y,z+h*.7),(x,y,z+h),(x-w/2,y,z+h*.7)]
        mesh('Recessed lancet window',vv,[(0,1,2,3,4)],wood)
        line('Dressed pointed archivolt',vv+[vv[0]],.07,stone[4])
        for dx in [-w*.18,w*.18]:line('Stone window mullion',[(x+dx,y-.035,z),(x+dx,y-.035,z+h*.77)],.027,gold)
    else:
        box('Window recess',(x,y,z+h/2),(w,.07,h),wood,.015)
        for dx in [-w/2,w/2]:box('Window carved jamb',(x+dx,y-.06,z+h/2),(.09,.12,h+.15),timber,.015)
        for zz in [z,z+h]:box('Window sill',(x,y-.08,zz),(w+.2,.22,.12),timber,.02)
        for i in range(1,5):box('Window lattice',(x-w/2+i*w/5,y-.07,z+h/2),(.028,.05,h),gold if culture=='yunhua' else timber,.004)
        for j in [1,2]:box('Window crossbar',(x,y-.08,z+j*h/3),(w,.04,.03),timber,0)

def craft_pot(x,y,z=0,s=1,m=None):
    m=m or teatile[1];n=20
    profile=[(.17,0),(.28,.09),(.32,.37),(.25,.56),(.15,.68),(.18,.74),(.13,.74),(.12,.64)]
    vv=[(x+r*s*math.cos(i*math.tau/n),y+r*s*math.sin(i*math.tau/n),z+zz*s) for r,zz in profile for i in range(n)]
    ff=[(j*n+i,j*n+(i+1)%n,(j+1)*n+(i+1)%n,(j+1)*n+i) for j in range(len(profile)-1) for i in range(n)]
    o=mesh('Wheel thrown ceramic vessel',vv,ff,m)
    for p in o.data.polygons:p.use_smooth=True

def craft_box(x,y,z,w=.7,d=.55,h=.55):
    box('Storage box floor',(x,y,z+.05),(w,d,.1),wood,.01)
    for xx in [x-w/2,x+w/2]:
        for yy in [y-d/2,y+d/2]:box('Box corner stile',(xx,yy,z+h/2),(.07,.07,h),timber,.01)
    for j in range(3):
        for yy in [y-d/2,y+d/2]:box('Slatted box board',(x,yy,z+.12+j*h*.25),(w,.045,h*.20),craft_mats[0],.008)

def craft_household(culture,x,y,w,d,h,variant):
    yy=y-d/2-.3
    if variant%3==0:
        craft_pot(x-w*.31,yy,0,.65)
        for i in range(5):
            a=i*math.tau/5
            line('Doorstep herb stem',[(x-w*.31,yy,.42),(x-w*.31+.16*math.cos(a),yy+.16*math.sin(a),.95)],.015,leafm[0])
            ball('Potted herb leaf',(x-w*.31+.16*math.cos(a),yy+.16*math.sin(a),.8),(.13,.08,.10),leafm[1],1)
    elif variant%3==1:
        craft_box(x+w*.30,yy,0,.6,.4,.5)
        for i in range(3):ball('Stored household provisions',(x+w*.3-.16+i*.16,yy,.53),(.10,.11,.1),leafm[2],1)
    else:
        for i in range(3):craft_pot(x-w*.32+i*.22,yy,0,.35+i*.09)
    if variant%2==0:
        line('Laundry cord',[(x-w*.34,y-d/2-.20,h*.74),(x+w*.34,y-d/2-.20,h*.74)],.013,rope)
        for i in range(3):
            xx=x-w*.22+i*w*.22
            mesh('Hanging family laundry',[(xx-.12,yy,h*.74),(xx+.12,yy,h*.74),(xx+.14,yy-.03,h*.74-.38),(xx-.11,yy+.02,h*.74-.40)],[(0,1,2,3)],craft_cream if i%2 else craft_cloth)
    if culture=='vildun':
        for j in range(3):
            for i in range(3-j):
                o=craft_cone('Stacked firewood',x-w*.32+i*.16,yy,.12+j*.14,.075,.5,timber,12,top=.075);o.rotation_euler.x=math.pi/2
    if culture=='aurelien' and variant%2:
        box('Street shop sign bracket',(x-w*.4,yy,2.1),(.07,.45,.07),gold,.01)
        box('Painted trade sign',(x-w*.4,yy-.18,1.8),(.42,.10,.48),craft_cloth,.035)

craft_trades={
 'canal':['tea','books','cloth','produce'], 'terrace':['herbs','tea','pottery','produce'],
 'harbor':['fish','salt','rope','grain'], 'kiln':['pottery','tools','wood','produce'],
 'fjord':['fish','wood','tools','cloth'], 'forest':['wood','herbs','cloth','tools'],
 'cathedral':['books','cloth','produce','pottery'], 'citadel':['tools','grain','wood','cloth'],
 'oasis':['herbs','books','cloth','pottery'], 'glacier':['tools','wood','grain','fish'],
 'volcanic':['tools','pottery','wood','grain'], 'farmland':['grain','produce','cloth','pottery'],
 'chalkport':['fish','salt','books','rope'], 'saltlake':['salt','pottery','cloth','grain'],
 'canyon':['pottery','tools','herbs','cloth'],
}
craft_market_origins={'terrace':(-9,-3),'harbor':(-16,5),'kiln':(-10,-6),'fjord':(-7,-9),'forest':(-7,1),'cathedral':(-9,5),'citadel':(-7,-3),'oasis':(-17,-3),'glacier':(-15,-3),'volcanic':(-10,-5),'farmland':(-9,10),'chalkport':(-10,-4),'saltlake':(-16,-2),'canyon':(14,10)}

def craft_goods(trade,x,y,z,s=1):
    if trade in ['pottery','tea','herbs']:
        for i in range(4):
            xx=x+(-.75+i*.5)*s;craft_pot(xx,y,z,(.45+i%2*.2)*s)
            if trade=='herbs':
                for j in range(4):a=j*math.tau/4;line('Herb bundle',[(xx,y,z+.3*s),(xx+.14*s*math.cos(a),y+.14*s*math.sin(a),z+.7*s)],.022,leafm[0])
    elif trade in ['books','cloth']:
        for i in range(4):
            for j in range(2+i%2):box('Bound books' if trade=='books' else 'Folded textiles',(x+(-.75+i*.5)*s,y,z+(.055+j*.11)*s),(.4*s,.5*s,.1*s),[red,craft_cloth,craft_cream,roofedge][i],.012)
    elif trade in ['wood','tools','rope']:
        for i in range(5):
            xx=x+(-.8+i*.4)*s
            if trade=='wood':box('Sawn timber stack',(xx,y,z+.12*s),(.25*s,.7*s,.24*s),craft_mats[0],.018)
            elif trade=='tools':
                line('Tool ash handle',[(xx,y-.3*s,z+.05),(xx,y+.3*s,z+.1)],.028,timber)
                box('Forged tool head',(xx,y+.23*s,z+.13),(.27*s,.16*s,.12*s),gold,.025)
            else:
                for j in range(3):line('Coiled dock rope',[(xx+.15*s*math.cos(k*math.tau/20),y+.15*s*math.sin(k*math.tau/20),z+.04+j*.035) for k in range(21)],.022,rope)
    elif trade=='fish':
        for i in range(4):
            xx=x+(-.7+i*.47)*s
            ball('Fresh fish body',(xx,y,z+.1),(.13*s,.30*s,.09*s),stone[4],2)
            mesh('Fish tail',[(xx,y+.2*s,z+.1),(xx-.14*s,y+.4*s,z+.1),(xx+.14*s,y+.4*s,z+.1)],[(0,1,2)],roofedge)
            ball('Fish eye',(xx+.08*s,y-.16*s,z+.16),(.022,.022,.022),wood,1)
    elif trade=='grain':
        for i in range(4):
            xx=x+(-.75+i*.5)*s;ball('Tied grain sack',(xx,y,z+.22*s),(.21*s,.26*s,.3*s),rope,2)
            line('Sack tie',[(xx-.08,y,z+.47*s),(xx+.08,y,z+.47*s)],.03,wood)
    else:
        for i in range(5):
            for j in range(2):ball('Salt crystal' if trade=='salt' else 'Fresh fruit',(x+(-.8+i*.4)*s,y+(-.15+j*.3)*s,z+.12*s),(.15*s,.14*s,.13*s),stone[4] if trade=='salt' else leafm[(i+j)%3],1)

def craft_stall(x,y,trade,variant=0,s=1,culture='yunhua'):
    w=[3.3,2.4,3.0,2.2][variant%4]*s;d=[1.8,2.8,2.1,1.6][variant%4]*s;h=[2.4,2.1,1.8,2.2][variant%4]*s
    for dx in [-w/2,w/2]:
        for dy in [-d/2,d/2]:box('Stall mortised upright',(x+dx,y+dy,h/2),(.085*s,.085*s,h),timber,.01)
    box('Trade counter',(x,y-.35*s,.80*s),(w*.94,d*.55,.14*s),craft_mats[0],.02)
    for dx in [-w*.38,w*.38]:box('Counter trestle',(x+dx,y-.35*s,.40*s),(.12*s,.8*s,.8*s),wood,.015)
    if variant%4!=3:
        vv=[];ff=[]
        for j in range(9):
            v=j/8
            for i in range(13):
                u=i/12;rise=(.65*math.sin(u*math.pi) if variant%4==1 else .35*v)-.13*math.sin(v*math.pi)
                vv.append((x+(u-.5)*(w+.18),y+(v-.5)*(d+.15),h+rise*s))
        for j in range(8):
            for i in range(12):k=j*13+i;ff.append((k,k+1,k+14,k+13))
        palette={'yunhua':[craft_cloth,red,craft_cream],'vildun':[rope,craft_cloth,craft_cream],'aurelien':[craft_cloth,craft_cream,craft_cream],'safir':[red,craft_cloth,craft_cream]}[culture]
        mesh('Draped trade awning',vv,ff,palette[variant%3])
        line('Stitched front hem',vv[:13],.025,rope)
        if variant%4==0:
            for i in range(7):box('Shade frame lath',(x,y-d*.42+i*d*.14,h+.25),(w+.25,.07,.07),timber,.01)
    else:
        box('Merchant upper shelf',(x,y+.75*s,1.6*s),(w*.85,.45*s,.1*s),wood,.015)
        craft_goods(trade,x,y+.75*s,1.66*s,.8*s)
    craft_goods(trade,x,y-.35*s,.88*s,.85*s)
    craft_box(x-w*.28,y+.48*s,0,.62*s,.48*s,.5*s)
    if variant%2:craft_pot(x+w*.30,y+.45*s,0,.65*s)
    if culture=='yunhua':
        if variant%4==0:craft_roof(x,y,h+.35,w+.3,d+.3,.55*s,culture)
        for dx in [-w*.43,w*.43]:
            ball('Market silk lantern',(x+dx,y-d*.48,h-.3*s),(.10*s,.10*s,.17*s),lanternmat,2)
    elif culture=='vildun':
        for dx in [-w/2,w/2]:
            line('Carved northern stall finial',[(x+dx,y+d/2,h),(x+dx,y+d/2,h+.35*s),(x+dx+.16*s,y+d/2,h+.46*s)],.045,timber)
            for z in [.35,1.15]:box('Iron frame binding',(x+dx,y-d/2,z*s),(.13*s,.12*s,.06*s),gold,.01)
    elif culture=='aurelien':
        for dx in [-w/2,w/2]:box('Market carved pier base',(x+dx,y-d/2,.18*s),(.24*s,.24*s,.36*s),stone[4],.035)
        line('Arched stall sign bracket',[(x-w*.3,y-d*.5,h),(x,y-d*.5,h+.18*s),(x+w*.3,y-d*.5,h)],.035,gold)
    else:
        for i in range(9):
            xx=x-w*.42+i*w*.105
            line('Sail tassel',[(xx,y-d*.52,h),(xx,y-d*.52,h-.18*s)],.017,rope)

def craft_markets(city):
    global parent
    theme=city['theme'];ox,oy=craft_market_origins[theme]
    bpy.context.view_layer.update()
    obstacles=[geometry_tree(r.children) for r in roots if r.get('facility') or r.get('publicSpace') or r.name in ['Town identity landmarks','Local craft and landscape','Scenic ridges','Streets and courtyards']]
    # Nearby candidate plots keep the trading quarter together while clearing local landmarks.
    candidates=[(ox+dx,oy+dy) for dy in [0,4,-4,8,-8] for dx in [0,4,-4,8,-8]]
    count=0
    for x,y in candidates:
        if count==4:break
        if abs(x)>28 or abs(y)>25:continue
        if theme in ['harbor','fjord','chalkport'] and y<-14:continue
        root=group('Market '+craft_trades[theme][count]);root['marketStall']=craft_trades[theme][count];root['district']='trade-quarter'
        craft_stall(x,y,craft_trades[theme][count],count,culture=city['culture'])
        if theme=='terrace':root.location.z=3.5 if y+1.2>=14.5 else 1.6 if y+1.2>=1.5 else 0
        bpy.context.view_layer.update();shape=geometry_tree(root.children)
        if any(t and shape.overlap(t) for t in obstacles):
            for o in list(root.children):bpy.data.objects.remove(o,do_unlink=True)
            roots.remove(root);bpy.data.objects.remove(root,do_unlink=True);continue
        obstacles.append(shape);count+=1
    if count!=4:raise RuntimeError(city['key']+' cannot fit its four authored market trades')

def craft_finish(city):
    global parent
    culture=city['culture']
    original_roots=list(roots)
    detail_root=group('Masonry surface detail');detail_root['surfaceDetail']=True
    # Small scale real masonry and joinery supplement UV surface detail.
    for root in original_roots:
        parent=root
        if root.name=='Town identity landmarks' and city['theme']=='farmland':
            for o in list(root.children):
                if o.name.startswith(('Windmill sail','Mill cap')):bpy.data.objects.remove(o,do_unlink=True)
            for x,y in [(-27,24),(26,24),(-27,-22)]:
                craft_roof(x,y,6,3.6,3.6,1.6,'aurelien')
                for k in range(4):
                    a=k*math.pi/2;dx,dz=math.cos(a),math.sin(a)
                    line('Windmill sail spar',[(x,y-1.8,5),(x+dx*4,y-1.8,5+dz*4)],.09,timber)
                    for j in range(7):
                        t=1+j*.45
                        line('Windmill lattice sail',[(x+dx*t-dz*.33,y-1.8,5+dz*t+dx*.33),(x+dx*t+dz*.33,y-1.8,5+dz*t-dx*.33)],.045,rope)
                    for sign in [-1,1]:line('Windmill sail edge',[(x+dx-dz*.33*sign,y-1.8,5+dz+dx*.33*sign),(x+dx*3.7-dz*.33*sign,y-1.8,5+dz*3.7+dx*.33*sign)],.035,timber)
            vv=[];ff=[]
            for row in range(9):
                y=-3.6+row*.9
                for col in range(36):
                    x=-5.7+col*.32;h=.5+.15*math.sin(row+col*1.7);k=len(vv)
                    vv.extend([(x-.016,y,.09),(x+.016,y,.09),(x+.05,y,h),(x+.13,y,h+.20),(x+.045,y,h+.30),(x-.035,y,h+.12)])
                    ff.extend([(k,k+1,k+2),(k+2,k+3,k+4,k+5)])
            mesh('Standing grain crop',vv,ff,gold)
        if root.name=='Scenic ridges':
            for o in list(root.children):bpy.data.objects.remove(o,do_unlink=True)
            passes=[r['passageCenter'][0] for r in original_roots if r.get('passageAxis')=='y' and r['passageCenter'][1]>0]
            vv=[];ff=[];nx=72;ny=8
            for j in range(ny+1):
                t=j/ny
                for i in range(nx+1):
                    x=-36+i;peaks=4.8+2.1*math.sin(x*.23)+1.3*math.cos(x*.49)
                    clearance=min([min(1,max(0,(abs(x-gx)-2)/3)) for gx in passes],default=1)
                    vv.append((x,32.5+t*13,-.4+math.sin(t*math.pi)**.85*peaks*clearance))
            for j in range(ny):
                for i in range(nx):k=j*(nx+1)+i;ff.extend([(k,k+1,k+nx+1),(k+1,k+nx+2,k+nx+1)])
            ridge=mesh('Continuous weathered ridge',vv,ff,craft_rock);craft_uv(ridge,None,12)
            for gx in passes:
                road=box('Mountain gate approach',(gx,37.9,-.25),(2.6,15.2,.3),craft_floor,.015);craft_uv(road,None)
            if city['theme']=='fjord':
                ridge.data.materials.append(snow)
                for face in ridge.data.polygons:
                    if sum(ridge.data.vertices[i].co.z for i in face.vertices)/3>5.2:face.material_index=1
        for o in list(root.children):
            if o.type!='MESH':continue
            name=o.name
            if name.startswith(('Tower roof','Capital crown','Gate turret')) and culture!='safir':
                x,y=o.location.x,o.location.y;bottom=o.location.z+min(v.co.z for v in o.data.vertices)
                radius=max(math.hypot(v.co.x,v.co.y) for v in o.data.vertices);height=max(v.co.z for v in o.data.vertices)-min(v.co.z for v in o.data.vertices)
                bpy.data.objects.remove(o,do_unlink=True)
                craft_roof(x,y,bottom,radius*2,radius*2,height,culture)
                continue
            if name.startswith(('Watchtower','Capital bastion')) and culture!='safir':
                x,y=o.location.x,o.location.y;bottom=o.location.z+min(v.co.z for v in o.data.vertices)
                radius=max(math.hypot(v.co.x,v.co.y) for v in o.data.vertices);height=max(v.co.z for v in o.data.vertices)-min(v.co.z for v in o.data.vertices)
                bpy.data.objects.remove(o,do_unlink=True)
                shell=craft_cone('Dressed guard tower',x,y,bottom,radius,height,craft_mats[0 if culture=='vildun' else 1],32,top=radius*.98)
                craft_uv(shell,0 if culture=='vildun' else 1)
                for z in [.1,height*.48,height-.15]:craft_cone('Tower structural collar',x,y,bottom+z,radius+.12,.16,timber if culture=='vildun' else stone[4],32,top=radius+.12)
                craft_window(x,y-radius-.035,bottom+height*.5,.40,height*.27,culture)
                continue
            if name.startswith(('Side wall','Back wall','Front cutaway','Northern rampart','Side rampart','Front cutaway wall','Inner curtain wall')):
                parent=detail_root
                center=o.location;dims=o.dimensions
                # Unapplied procedural boxes report zero dimensions until evaluated.
                lo=[min(v.co[k] for v in o.data.vertices) for k in range(3)];hi=[max(v.co[k] for v in o.data.vertices) for k in range(3)]
                dims=[hi[k]-lo[k] for k in range(3)]
                axis=0 if dims[0]>dims[1] else 1;length=dims[axis];height=dims[2]
                n=max(1,math.ceil(length/1.7));rows=max(2,math.ceil(height/.48))
                for row in range(rows):
                    for i in range(n):
                        p=[center.x,center.y,center.z-height/2+(row+.5)*height/rows]
                        p[axis]+=(-length/2+(i+.5)*length/n)
                        p[1-axis]-=dims[1-axis]/2+.025
                        size=[length/n-.04,.055,height/rows-.035] if axis==0 else [.055,length/n-.04,height/rows-.035]
                        cell=0 if culture=='vildun' else 1
                        block=box('Wall dressed face stone',p,size,craft_mats[cell],.015);craft_uv(block,cell)
                        if cell==1:
                            for uv in block.data.uv_layers.active.data:uv.uv=(.56+(uv.uv.x-.514)*.12,.87+(uv.uv.y-.514)*.16)
                for i in range(n):
                    p=[center.x,center.y,center.z+height/2+.08];p[axis]+=-length/2+(i+.5)*length/n
                    size=[length/n-.03,dims[1]+.18,.16] if axis==0 else [dims[0]+.18,length/n-.03,.16]
                    box('Wall coping stone',p,size,stone[3],.025)
                parent=root
            # Give plain original structures and furniture a packed material and named UV.
            for slot in o.material_slots:
                if slot.material in [wood,timber]:slot.material=craft_mats[0]
                elif slot.material in stone:slot.material=craft_mats[1]
                elif slot.material in roofm:slot.material=craft_mats[2]
                elif slot.material in quietroof:slot.material=craft_mats[3]
                elif culture!='safir' and slot.material==globals().get('blue'):slot.material=craft_mats[3]
            if name.startswith(('Town ground','Unified paved streets','Retaining terrace','Terrace footing','Residential retaining base','North bank','Southwest bank','Southeast bank','Courtyard flagstone','Street flagstone','Riverside promenade')) and city['theme'] not in ['fjord','glacier','volcanic','forest','farmland']:
                o.data.materials.clear();o.data.materials.append(craft_floor);craft_uv(o,None)
            if name.startswith('Unified paved streets'):
                o.data.materials.clear();o.data.materials.append(craft_floor);craft_uv(o,None)
            if name.startswith(('Western working quay','Quarry upper landing','Quarry access stair')):
                o.data.materials.clear();o.data.materials.append(craft_floor);craft_uv(o,None)
            if name.startswith('Town ground') and city['theme'] in ['fjord','glacier','volcanic','forest','farmland']:
                key='snow' if city['theme'] in ['fjord','glacier'] else 'rock' if city['theme']=='volcanic' else 'meadow'
                o.data.materials.clear();o.data.materials.append(craft_ground[key]);craft_uv(o,None,8)
    for o in list(scene.objects):
        if o.type!='MESH' or 'Craft UV' in o.data.uv_layers:continue
        cells=[m.get('craftCell') for m in o.data.materials if m and m.get('craftCell') is not None]
        if cells:craft_uv(o,cells[0])
    for root in roots:
        if root.get('facility') or root.get('scenery'):root['craftVersion']=1

craft_materials()
