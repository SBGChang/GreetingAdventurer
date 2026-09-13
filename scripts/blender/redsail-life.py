"""Authored Redsail trades and household silhouettes; visual details, not game items.

Loaded into redsail-detail's Blender authoring namespace. Every house stays within
its street lot, and every stall is independently checked for geometric clearance.
"""
rs_linen=rs_material('woven flax canvas',3,.96)
rs_indigo=rs_material('indigo patterned fabric',1,.94)
rs_terracotta=mat('Redsail fired clay',(.46,.18,.075),.88)
rs_ochre=mat('Redsail ochre limewash',(.67,.40,.19),.9)
rs_sage=mat('Redsail faded sage shutters',(.19,.32,.26),.85)
rs_dates=mat('Redsail dates',(.20,.065,.027),.72)
rs_citrus=mat('Redsail citrus',(.94,.43,.035),.7)

def rs_ring(name,x,y,z,r,material=rope,thickness=.025):
    return line(name,[(x+r*math.cos(i*math.tau/24),y+r*math.sin(i*math.tau/24),z) for i in range(25)],thickness,material)

def rs_vessel(x,y,z,r=.3,h=.7,material=None):
    # Hollow lip, shoulder and neck: readable ceramic silhouettes at street distance.
    material=material or rs_terracotta
    profile=[(.54,0),(.77,.06),(1,.28),(.93,.62),(.53,.82),(.48,.96),(.59,1),(.42,1),(.36,.90)]
    vv=[(x+r*a*math.cos(i*math.tau/24),y+r*a*math.sin(i*math.tau/24),z+h*b) for a,b in profile for i in range(24)]
    ff=[]
    for j in range(len(profile)-1):
        for i in range(24):k=j*24+i;ff.append((k,j*24+(i+1)%24,(j+1)*24+(i+1)%24,k+24))
    o=mesh('Hand thrown pottery',vv,ff,material)
    for p in o.data.polygons:p.use_smooth=True
    if material.get('atlas_cell') is not None:rs_uv(o,material['atlas_cell'])
    cone('Dark vessel interior',x,y,z+h*.87,r*.37,.02,rs_shadow,24,top=r*.37)
    return o

def rs_crate(x,y,z,w=1,d=.7,h=.65):
    box('Crate floor',(x,y,z+.06),(w,d,.12),wood,.012)
    for xx in [x-w/2+.055,x+w/2-.055]:
        for yy in [y-d/2+.055,y+d/2-.055]:box('Crate corner post',(xx,yy,z+h/2),(.11,.11,h),timber,.015)
    for level in range(3):
        zz=z+.15+level*(h-.18)/3
        for yy in [y-d/2,y+d/2]:box('Separated crate slat',(x,yy,zz),(w,.065,(h-.18)/3-.035),timber,.012)
        for xx in [x-w/2,x+w/2]:box('Crate end slat',(xx,y,zz),(.065,d,(h-.18)/3-.035),wood,.012)

def rs_planter(x,y,z=0,s=1):
    rs_vessel(x,y,z,.23*s,.40*s)
    for i in range(7):
        a=i*math.tau/7
        p=(x,y,z+.36*s);q=(x+.24*s*math.cos(a),y+.24*s*math.sin(a),z+.85*s)
        line('Herb stem',[p,q],.013*s,pinegreen)
        tip=(q[0]+.12*s*math.cos(a),q[1]+.12*s*math.sin(a),q[2]-.14*s)
        mesh('Herb lanceolate leaf',[p,(q[0]-.06*s*math.sin(a),q[1]+.06*s*math.cos(a),q[2]),tip,(q[0]+.06*s*math.sin(a),q[1]-.06*s*math.cos(a),q[2])],[(0,1,2,3)],leafm[i%2])

def rs_cloth_sheet(name,x,y,z,w,d,material,shape='lean'):
    nx,ny=16,12;vv=[];ff=[]
    for j in range(ny+1):
        v=j/ny
        for i in range(nx+1):
            u=i/nx
            rise=(1-abs(2*u-1))*1.15 if shape=='ridge' else math.sin(u*math.pi)*.85 if shape=='arch' else v*.48
            sag=.19*math.sin(v*math.pi)+.07*math.sin(u*math.pi*6)*(1-v)
            vv.append((x+(u-.5)*w,y+(v-.5)*d,z+rise-sag))
    for j in range(ny):
        for i in range(nx):k=j*(nx+1)+i;ff.append((k,k+1,k+nx+2,k+nx+1))
    o=mesh(name,vv,ff,material);uv=o.data.uv_layers.new(name='Craft UV');cell=material['atlas_cell']
    for p in o.data.polygons:
        p.use_smooth=True
        for li in p.loop_indices:
            k=o.data.loops[li].vertex_index;uv.data[li].uv=((cell%2)*.5+.012+k%(nx+1)/nx*.476,(1-cell//2)*.5+.012+k//(nx+1)/ny*.476)
    for j in [0,ny]:line('Hand stitched canopy edge',[vv[j*(nx+1)+i] for i in range(nx+1)],.024,rope)
    return vv

def rs_pergola(x,y,z,w,d,h=1.6):
    for dx in [-w/2,w/2]:
        for dy in [-d/2,d/2]:box('Pergola carved post',(x+dx,y+dy,z+h/2),(.13,.13,h),timber,.018)
        box('Pergola bearer',(x+dx,y,z+h),(.17,d+.25,.17),wood,.02)
    for i in range(9):box('Spaced shade lath',(x,y-d/2+i*d/8,z+h+.1),(w+.25,.12,.12),timber,.015)

def rs_laundry(x,y,z,w):
    for xx in [x-w/2,x+w/2]:line('Laundry pole',[(xx,y,z),(xx,y,z+1.0)],.035,timber)
    line('Sagging clothesline',[(x-w/2,y,z+.95),(x,y,z+.81),(x+w/2,y,z+.95)],.013,rope)
    for i,(width,length,material) in enumerate([(.40,.60,rs_linen),(.34,.48,rs_indigo),(.46,.67,rs_linen)]):
        xx=x-w*.31+i*w*.31
        o=mesh('Hanging household linen',[(xx-width/2,y,z+.85),(xx+width/2,y,z+.85),(xx+width/2+.04,y+.04,z+.85-length),(xx-width/2,y-.06,z+.87-length)],[(0,1,2,3)],material);rs_uv(o,material['atlas_cell'])
        for dx in [-width*.3,width*.3]:box('Clothes peg',(xx+dx,y,z+.88),(.035,.06,.08),wood,0)

def rs_windcatcher(x,y,z,w=.9,h=1.7):
    box('Windcatcher tower',(x,y,z+h/2),(w,w,h),rs_plaster,.035)
    for yy in [y-w/2-.018,y+w/2+.018]:
        box('Windcatcher vent recess',(x,yy,z+h*.66),(w*.72,.025,h*.46),rs_shadow,.01)
        for xx in [-.23,0,.23]:box('Windcatcher vent blade',(x+xx*w,yy,z+h*.66),(.07,.10,h*.46),rs_stone,.01)
    box('Windcatcher cornice',(x,y,z+h),(w+.24,w+.24,.17),rs_stone,.03)

def rs_public_roof(kind,x,y,w,d,z):
    if kind=='inn':
        # Rooftop guest pavilion plus shaded dining terrace, offset from the balcony.
        box('Inn upper guest room',(x+w*.23,y+d*.16,z+.55),(w*.38,d*.55,1.1),rs_plaster,.05)
        rs_arch(x+w*.23,y-d*.115-.04,z+.12,w*.2,.85)
        rs_dome(x+w*.23,y+d*.16,z+1.12,w*.20,d*.29,.9)
        rs_pergola(x-w*.23,y,z,w*.40,d*.65,1.35)
        rs_planter(x-w*.35,y-d*.32,z,.8)
    elif kind=='tavern':
        rs_pergola(x,y,z,w*.80,d*.7,1.6)
        rs_cloth_sheet('Tavern roof shade',x,y,z+1.68,w*.86,d*.78,rs_linen)
        for xx in [-w*.25,w*.25]:
            cone('Low tea table',x+xx,y,z+.45,.50,.1,timber,24,top=.50)
            for yy in [-.55,.55]:box('Tea cushion',(x+xx,y+yy,z+.14),(.5,.42,.24),rs_indigo,.06)
    elif kind=='bookstore':
        rs_windcatcher(x+w*.27,y+d*.20,z,1.25,2.45)
        box('Archive rooftop room',(x-w*.20,y+d*.18,z+.7),(w*.46,d*.58,1.4),rs_plaster,.04)
        rs_arch(x-w*.20,y-d*.12-.06,z+.15,1.1,1.1)
        for i in range(3):box('Archive scroll chest',(x-w*.24+i*.8,y-d*.26,z+.22),(.65,.45,.44),timber,.025)
    elif kind=='equipmentShop':
        rs_pergola(x,y-d*.15,z,w*.65,d*.42,1.0)
        for i in range(4):box('Workshop timber stock',(x-w*.20+i*.35,y,z+.15),(.18,d*.75,.22),wood,.02)
    elif kind=='trainingGround':
        # An open training roof and fabric pennants distinguish it from commerce.
        for xx in [x-w*.37,x+w*.37]:
            line('Training pennant mast',[(xx,y+d*.3,z),(xx,y+d*.3,z+2.3)],.04,timber)
            o=mesh('Indigo training pennant',[(xx,y+d*.3,z+2.2),(xx+.65,y+d*.3,z+1.9),(xx,y+d*.3,z+1.6)],[(0,1,2)],rs_indigo);rs_uv(o,1)
        for i in range(4):box('Training practice mat',(x-1.2+i*.8,y,z+.035),(.6,1.5,.035),rs_linen,0)
    elif kind=='itemShop':
        rs_cloth_sheet('Merchant rooftop drying cloth',x,y,z+.07,w*.62,d*.55,rs_cloth)
        for i in range(4):rs_vessel(x-w*.3+i*w*.2,y+d*.32,z,.23,.55+i*.11)
    else:
        rs_pergola(x+w*.2,y,z,w*.4,d*.55,1.4)
        rs_laundry(x-w*.23,y,z,w*.38)
        rs_planter(x-w*.3,y-d*.25,z)

# Different dimensions, roof massing and everyday uses; ordered along the four lanes.
rs_house_specs=[
    ('windtower',2.9,3.0,4.15),('courtyard',3.7,3.0,2.4),('weaver',3.6,2.9,2.7),('dome',3.4,3.1,2.6),
    ('terrace',3.7,3.2,3.1),('potter',3.3,2.8,2.3),('windtower',2.8,3.0,3.8),('courtyard',3.6,3.1,2.2),
    ('weaver',3.5,3.0,3.15),('dome',3.2,2.9,2.45),('courtyard',3.8,3.0,2.3),('terrace',3.5,3.0,3.35),
    ('potter',3.6,3.1,2.1),('windtower',3.0,2.8,3.6),('terrace',3.6,3.0,2.8),('weaver',3.4,2.8,2.6),
]

def rs_lived_home(index,x,y):
    style,w,d,h=rs_house_specs[index]
    root=redsail_hall('Residential ward '+str(index),None,x,y,w,d,h,style)
    root['archetype']=style
    z=h+.54
    if style=='windtower':
        rs_windcatcher(x-w*.23,y+d*.18,z,.85,1.55)
        # Projecting screened upper window and painted shutters.
        yy=y-d/2-.24
        box('Projecting mashrabiya base',(x,yy,h*.66),(w*.73,.43,.16),wood,.025)
        for i in range(9):box('Mashrabiya cedar screen',(x-w*.33+i*w*.0825,yy-.16,h*.66+.48),(.045,.055,.85),rs_sage,.006)
        box('Mashrabiya timber hood',(x,yy,h*.66+.95),(w*.79,.50,.14),timber,.025)
        rs_laundry(x,y-d*.1,z,w*.7)
    elif style=='courtyard':
        # A roof court with an L-shaped enclosed wing; breaks the identical box silhouette.
        box('Courtyard rear upper wing',(x,y+d*.30,z+.55),(w-.2,d*.32,1.1),rs_plaster,.04)
        box('Courtyard side upper wing',(x-w*.34,y,z+.55),(w*.26,d*.65,1.1),rs_plaster,.04)
        rs_arch(x+w*.10,y+d*.14-.05,z+.1,.75,.80)
        rs_planter(x+w*.23,y-d*.15,z,1.1)
        box('Courtyard bench',(x,y-d*.28,z+.23),(w*.34,.42,.38),timber,.035)
        for zz in [.8,1.6]:
            box('Painted shutter',(x-w*.32,y-d/2-.19,zz),(.5,.08,.42),rs_sage,.015)
    elif style=='weaver':
        rs_pergola(x,y,z,w*.72,d*.64,1.25)
        rs_cloth_sheet('Weaver rooftop shade',x,y,z+1.34,w*.81,d*.73,rs_cloth if index%2 else rs_indigo)
        # Cloth draped over parapet with a visible crease, not a repeated roof carpet.
        xx=x+w*.15;yy=y-d/2-.13
        o=mesh('Overhanging woven rug',[(xx-.48,yy+.55,z+.08),(xx+.48,yy+.55,z+.08),(xx+.48,yy,z+.31),(xx+.48,yy-.05,z-.75),(xx-.48,yy-.07,z-.70),(xx-.48,yy,z+.31)],[(0,1,2,5),(5,2,3,4)],rs_cloth);rs_uv(o,2)
    elif style=='terrace':
        box('Set back upper room',(x-w*.2,y+d*.16,z+.6),(w*.48,d*.58,1.2),rs_plaster,.045)
        rs_arch(x-w*.2,y-d*.13-.06,z+.12,.7,.9)
        rs_laundry(x+w*.2,y-d*.15,z,w*.42)
        rs_planter(x+w*.28,y+d*.27,z)
        for step in range(6):box('Roof access steps',(x+w*.30,y+d*.32-step*d*.095,z+.1+step*.15),(w*.23,d*.105,.18),rs_stone,.018)
    elif style=='potter':
        # Flat working terrace with a small kiln and drying pottery.
        cone('Domestic clay kiln',x-w*.20,y+d*.15,z,.58,.72,rs_terracotta,24,top=.39)
        cone('Kiln flue',x-w*.20,y+d*.15,z+.7,.14,.7,rs_terracotta,16,top=.11)
        for i in range(4):rs_vessel(x-w*.32+i*w*.21,y-d*.24,z,.16,.32+i*.07,rs_tile if i%2 else rs_terracotta)
        rs_crate(x+w*.3,y-d/2-.38,0,.65,.5,.55)
    else:
        for xx in [-w*.30,w*.30]:rs_planter(x+xx,y-d/2-.35,0,.75)
    # Doorstep ownership and repaired plaster give each plot a human scale.
    if style!='dome':rs_planter(x-w*.32,y-d/2-.30,0,.72)
    for i in range(3):
        xx=x-w*.36+i*.25;yy=y-d/2-.046
        box('Exposed footing repair',(xx,yy,.60+i%2*.12),(.22,.055,.17),rs_ochre,.015)
    line('Exterior drain pipe',[(x+w*.45,y+d*.40,z),(x+w*.45,y+d*.40,.25)],.043,rs_terracotta)
    return root

def rs_cart(x,y):
    box('Caravan cart chassis',(x,y,.60),(1.7,2.5,.20),wood,.03)
    for xx in [-.88,.88]:
        box('Cart side board',(x+xx,y,.98),(.1,2.45,.55),timber,.02)
        for dy in [-.8,.8]:
            # Wheels stand in the YZ plane with spokes and an iron tyre.
            pts=[(x+xx*1.15,y+dy+.44*math.cos(i*math.tau/24),.46+.44*math.sin(i*math.tau/24)) for i in range(25)]
            line('Iron cart tyre',pts,.052,gold)
            for i in range(8):a=i*math.tau/8;line('Cart wheel spoke',[(x+xx*1.15,y+dy,.46),(x+xx*1.15,y+dy+.4*math.cos(a),.46+.4*math.sin(a))],.03,timber)
        line('Cart draw shaft',[(x+xx*.7,y-1,.5),(x+xx*.7,y-2.0,.72)],.06,wood)
    rs_crate(x,y+.35,.72,1.35,.8,.85)
    for dx in [-.43,.43]:ball('Tied caravan sack',(x+dx,y-.5,1.02),(.36,.45,.37),rope,2)

def redsail_market():
    # Occupied bounds remain inside the previous market lots, with distinct frames.
    for kind,x,y,w,d,z,material,shape in [
        ('textiles',-20,4,7.5,5.7,2.85,rs_cloth,'ridge'),
        ('pottery',-10.5,4,5.9,4.9,2.5,rs_indigo,'arch'),
        ('produce',-20,-5,6.7,4.8,2.4,rs_linen,'lean'),
        ('caravan',-10.5,-5,6.7,5.1,2.65,rs_cloth,'lean'),
    ]:
        root=group('Market '+kind);root['marketStall']=kind;root['district']='bazaar'
        if kind=='caravan':
            rs_pergola(x+.9,y+.4,0,3.7,3.8,z)
            rs_cloth_sheet('Half covered freight shade',x+1,y+.35,z+.10,3.8,3.7,material)
            rs_cart(x-1.7,y+.1)
            for i in range(3):rs_crate(x+.2+i*.78,y+.4,0,.68,.9,.85+i%2*.4)
            for i in range(3):rs_vessel(x+.2+i*.7,y-1.1,0,.29,.8+i*.15)
            continue
        rs_cloth_sheet('Trade canopy '+kind,x,y,z,w,d,material,shape)
        for dx in [-w/2,w/2]:
            for dy in [-d/2,d/2]:
                top=z+(.48 if shape=='lean' and dy>0 else 0)
                line('Bound timber stall post',[(x+dx,y+dy,.02),(x+dx,y+dy,top+.12)],.065,timber)
                for zz in [top-.14,top-.06]:rs_ring('Post rope binding',x+dx,y+dy,zz,.073)
        if kind=='textiles':
            box('Textile display bench',(x,y-.8,.8),(5.3,1.15,.16),timber,.025)
            for xx in [-2,2]:box('Trestle leg',(x+xx,y-.8,.40),(.18,.8,.8),wood,.025)
            for i in range(5):
                for k in range(2):box('Folded bolts of cloth',(x-1.8+i*.9,y-.8,.94+k*.13),(.74,.86,.12),rs_indigo if i%2 else rs_cloth,.03)
            line('Rug hanging beam',[(x-w*.4,y+1.5,2.25),(x+w*.4,y+1.5,2.25)],.055,timber)
            for i in range(3):
                xx=x-1.8+i*1.8
                o=mesh('Hanging bazaar rug',[(xx-.62,y+1.5,2.22),(xx+.62,y+1.5,2.22),(xx+.60,y+1.42,.6),(xx-.58,y+1.55,.6)],[(0,1,2,3)],rs_cloth if i!=1 else rs_indigo);rs_uv(o,2 if i!=1 else 1)
        elif kind=='pottery':
            for level in range(3):
                zz=.45+level*.63;box('Potter stepped display shelf',(x,y+.8,zz),(4.3,.80,.12),timber,.025)
                for i in range(6):rs_vessel(x-1.8+i*.70,y+.8,zz+.06,.17+(i%3)*.03,.40+(i%2)*.13,rs_tile if (i+level)%3==0 else rs_terracotta)
            for xx in [-2,2]:box('Potter shelf leg',(x+xx,y+.8,.9),(.13,.6,1.8),wood,.02)
            for i in range(3):rs_vessel(x-1.5+i*1.4,y-1,0,.42,.95+i*.2,rs_tile if i==1 else rs_terracotta)
        else:
            for i in range(4):
                xx=x-2.25+i*1.5;rs_crate(xx,y-.7,.35,1.25,1.2,.60)
                for j in range(3):
                    for k in range(3):
                        ball('Fresh market produce',(xx-.37+j*.36,y-1.08+k*.35,.92),(.17,.16,.16),rs_citrus if i%2==0 else leafm[0],2)
                box('Produce table leg',(xx,y-.7,.2),(.18,.75,.4),wood,.015)
            for xx in [-1,1]:
                rs_vessel(x+xx,y+1.1,0,.4,.6,rope)
                for i in range(9):a=i*math.tau/9;ball('Dates in basket',(x+xx+.15*math.cos(a),y+1.1+.15*math.sin(a),.53),(.08,.05,.045),rs_dates,1)
            # Uneven scalloped valance is geometry, independent of the linen texture.
            for i in range(14):
                xx=x-w/2+(i+.5)*w/14
                o=mesh('Scalloped canvas valance',[(xx-w/28,y-d/2,z),(xx+w/28,y-d/2,z),(xx+w/28,y-d/2-.02,z-.16),(xx,y-d/2-.04,z-.27),(xx-w/28,y-d/2-.02,z-.16)],[(0,1,2,3,4)],rs_linen);rs_uv(o,3)
