"""Authored street frontage and inhabited architectural volumes for the town scenes.

This is visual authoring data, not runtime city content. A district owns a street
spine, a mix of buildings and a public space. Lots face that spine; footprint
clearance and a connected pedestrian network are solved before exporting.
"""
import heapq

# Street spines deliberately follow each city's industry, landform and civic sites.
# Their bends, lengths and household mixtures are part of the composition.
neighbourhoods={
 'qingcen': [('lower herb traders',[(-25,-20),(-16,-23),(-3,-22)],2),('spring hillside',[(-25,3),(-15,8),(-7,10)],0),('scholars terrace',[(5,22),(14,25),(24,22)],3),('bamboo artisans',[(25,-19),(25,-1),(26,9)],6)],
 'chengpu': [('quayside chandlers',[(-5,-12),(9,-10),(25,-11)],7),('merchant courtyard',[(-24,25),(-12,23),(0,23)],4),('fishing families',[(-28,-12),(-27,6),(-18,10)],0),('eastern freight lane',[(26,24),(25,12),(18,7)],6)],
 'chiling': [('potters crescent',[(-26,23),(-14,22),(-10,13)],6),('kiln workers',[(24,18),(27,5),(24,-19),(13,-24)],0),('glaze merchants',[(-26,-18),(-14,-25),(1,-23)],3),('craft court',[(-13,3),(-5,-4),(7,-6)],2)],
 'frostbay': [('fishers strand',[(-8,-13),(5,-11),(21,-12)],7),('upper longhouse ward',[(-27,23),(-16,24),(-9,8)],0),('shipwright lane',[(26,23),(25,9),(20,-1)],6),('hearth square',[(-27,-14),(-17,-9),(-7,-4)],4)],
 'cedarkeep': [('rune clearing',[(-22,22),(-10,18),(-7,9)],0),('sawmill quarter',[(23,23),(24,11),(22,2)],7),('foresters hamlet',[(-25,-15),(-19,-22),(-6,-23)],6),('trappers lane',[(5,-26),(20,-24),(25,-13)],2)],
 'icechisel': [('quarry road',[(23,25),(26,15),(27,5)],7),('icecutters homes',[(-26,23),(-14,24),(-13,12)],0),('ropewalk',[(-25,-18),(-15,-23),(0,-25)],6),('winter shelters',[(12,-25),(26,-23),(26,-13)],4)],
 'emberforge': [('foundry workers',[(24,24),(27,17),(27,-1)],6),('ironmongers',[(-27,11),(-15,10),(-11,0)],3),('ash gardens',[(-26,-16),(-22,-24),(-9,-24)],0),('smiths close',[(4,-13),(15,-15),(25,-23)],7)],
 'dawncrown': [('cathedral close',[(-24,24),(-14,24),(-9,17)],4),('booksellers bend',[(10,25),(23,22),(26,10)],3),('fountain merchants',[(-24,-18),(-14,-23),(-2,-23)],2),('garden residences',[(15,-24),(26,-19),(26,-1)],0)],
 'greyshield': [('garrison families',[(-26,23),(-26,7),(-26,-10)],0),('armourers court',[(24,25),(26,14),(25,4)],6),('supply quarter',[(-24,-22),(-13,-25),(1,-25)],7),('citizens crescent',[(9,-25),(23,-22),(24,-14)],3)],
 'windharvest': [('millers lane',[(-23,23),(-13,25),(-8,11)],7),('orchard cottages',[(-26,-5),(-28,-12),(-18,-23)],0),('grain merchants',[(15,25),(24,14),(27,3)],3),('harvest court',[(0,-17),(16,-14),(26,-22)],6)],
 'whitecliff': [('sailmakers',[(-25,23),(-14,23),(-10,11)],6),('cliff merchants',[(11,24),(17,17),(26,1)],4),('dockside tenements',[(-25,-9),(-14,-8),(-4,-13)],3),('beacon lane',[(3,-16),(17,-16),(26,-17)],7)],
 'starwell': [('astronomers gardens',[(-26,24),(-14,27),(1,27)],4),('shaded souk',[(-27,3),(-19,-3),(-18,-17)],3),('water carriers',[(15,25),(26,24),(28,10)],0),('caravan residences',[(0,-27),(17,-26),(27,-17)],2)],
 'saltmirror': [('salt merchants',[(-27,23),(-17,23),(-13,15)],4),('pan workers',[(-26,4),(-23,-3),(-20,-18)],6),('ceramic reservoirs',[(13,25),(25,25),(28,10)],7),('salt road homes',[(-2,-25),(15,-25),(26,-20)],0)],
 'ochrestep': [('west cliff ward',[(-25,15),(-28,-7),(-15,-21),(-3,-25),(6,-25)],0),('east caravanserai',[(-13,25),(-3,24),(13,25),(25,25),(26,12)],4),('bridge traders',[(15,8),(24,7),(27,-3)],3),('terrace potters',[(12,-24),(25,-23),(25,-13)],6)],
 'redsail': [('caravan homes',[(8,-8),(25,-8)],4),('weavers close',[(8,-14),(25,-14)],2),('potters lane',[(8,-20),(25,-20)],6)],
 'yunjing': [('north scholarly ward',[(-27,22),(23,23)],4),('canal shopfronts',[(-25,5),(24,6)],3),('west craft ward',[(-26,-10),(-10,-23)],6),('east waterside homes',[(8,-8),(26,-23)],0)],
}

public_spaces={
 'qingcen':(-2,-9,3.0,'herbal exchange'), 'chengpu':(3,9,3.6,'quay auction'),
 'chiling':(9,4,3.4,'potters exchange'), 'frostbay':(1,4,3.5,'harbour assembly'),
 'cedarkeep':(1,2,4.2,'forest moot'), 'icechisel':(-15,3,2.5,'quarry pay court'),
 'emberforge':(5,3,3.2,'iron exchange'), 'dawncrown':(0,2,5.0,'cathedral fountain'),
 'greyshield':(-1,-3,3.7,'muster square'), 'windharvest':(-10,3,2.8,'harvest exchange'),
 'whitecliff':(5,1,3.6,'harbour exchange'), 'starwell':(0,-14,3.0,'water market'),
 'saltmirror':(0,-14,3.0,'salt exchange'), 'ochrestep':(-18,8,2.8,'bridge exchange'),
 'redsail':(0,0,4.5,'caravan fountain'), 'yunjing':(-3,15,3.0,'guild forecourt'),
}

urban_forms=['longhouse','open-courtyard','workshop-yard','paired-shopfronts','tower-residence','arcaded-gallery','split-level-house','raised-granary','garden-cottage']

def urban_roof(culture,x,y,z,w,d,h,style):
    if culture=='safir':
        box('Roof terrace slab',(x,y,z+.07),(w+.16,d+.16,.14),rs_stone,.025)
        for xx in [x-w/2,x+w/2]:box('Terrace parapet',(xx,y,z+.30),(.12,d,.40),rs_plaster,.02)
        box('Rear terrace parapet',(x,y+d/2,z+.30),(w,.12,.40),rs_plaster,.02)
        if style%3==0:rs_dome(x,y,z+.16,w*.42,d*.42,min(w,d)*.39)
        elif style%3==1:rs_pergola(x,y,z+.14,w*.70,d*.65,.95)
        else:rs_windcatcher(x+w*.24,y+d*.16,z+.16,min(.7,w*.28),1.1)
    else:craft_roof(x,y,z,w+.35,d+.35,min(w*.43,h*.50),culture,style)

def urban_room(culture,x,y,w,d,h,style,z=0,door=True):
    material=rs_plaster if culture=='safir' else plaster if culture=='yunhua' else craft_mats[0 if culture=='vildun' else 1]
    body=box('Habitable wing',(x,y,z+h/2+.20),(w,d,h),material,.035)
    if culture=='safir':rs_uv(body,3)
    elif culture!='yunhua':craft_uv(body,0 if culture=='vildun' else 1)
    box('Wing dressed foundation',(x,y,z+.14),(w+.16,d+.16,.28),stone[2],.025)
    trim=timber if culture in ['yunhua','vildun'] else stone[4]
    for yy in [y-d/2-.03,y+d/2+.03]:
        for xx in [x-w/2+.04,x+w/2-.04]:box('Structural corner post',(xx,yy,z+h/2+.2),(.14,.14,h),trim,.015)
        for zz in [z+.42,z+h+.17]:box('Continuous storey sill',(x,yy,zz),(w+.14,.13,.12),trim,.015)
        for dx in [-.28,.28] if w>2.2 else [0]:
            if culture=='safir':rs_arch(x+dx*w,yy-.035,z+h*.43,w*.20,min(1.15,h*.35))
            else:craft_window(x+dx*w,yy-.055,z+h*.42,min(.66,w*.25),min(1,h*.33),culture)
    if culture=='vildun':
        for level in range(int(h/.36)):
            for xx in [x-w/2,x+w/2]:box('Exposed log end',(xx,y-d/2-.06,z+.43+level*.36),(.18,.23,.18),timber,.025)
    if culture in ['yunhua','aurelien'] and h>3:
        box('Upper storey belt',(x,y-d/2-.09,z+h*.55),(w,.18,.16),trim,.02)
        for dx in [-.35,.35]:
            line('Diagonal framed upper bay',[(x+dx*w-w*.08,y-d/2-.10,z+h*.58),(x+dx*w+w*.08,y-d/2-.10,z+h-.1)],.04,timber)
    # Side shutters on both elevations avoid blank boxes while the camera pans.
    for xx in [x-w/2-.035,x+w/2+.035]:
        for yy in [y-d*.24,y+d*.24]:
            box('Side window shadow',(xx,yy,z+h*.56),(.06,d*.23,min(.85,h*.31)),wood,.01)
            for j in range(4):box('Side shutter slat',(xx,yy-d*.09+j*d*.06,z+h*.56),(.10,.04,min(.85,h*.31)),trim,.005)
    if door:
        yy=y-d/2-.10
        box('Entrance recess',(x,yy,z+.97),(.72,.09,1.48),wood,.025)
        for j in range(5):box('Cedar entrance plank',(x-.28+j*.14,yy-.06,z+.96),(.125,.06,1.44),timber,.008)
        for zz in [.49,1.3]:box('Forged door hinge',(x,yy-.105,z+zz),(.68,.04,.045),gold,.006)
        box('Entrance threshold',(x,yy-.12,z+.13),(1.05,.37,.20),stone[4],.025)
    urban_roof(culture,x,y,z+h+.22,w,d,h,style)

def urban_house(culture,name,facility,x,y,w,d,h,variant=0,angle=0):
    global parent
    style=variant%9;root=group(name,facility);root['archetype']=urban_forms[style]
    pad=box('Private courtyard paving',(0,0,-.05),(w+.25,d+.28,.25),craft_floor,.025);craft_uv(pad,None)
    # Build in local coordinates. Separate wings enclose real open ground courts.
    if style==0:
        urban_room(culture,0,d*.12,w*.75,d*.76,h,variant)
        urban_room(culture,w*.29,-d*.27,w*.42,d*.38,h*.58,variant+1)
    elif style==1:
        urban_room(culture,0,d*.30,w,d*.36,h*.82,variant)
        for side in [-1,1]:urban_room(culture,side*w*.35,-d*.14,w*.28,d*.50,h*(.72 if side<0 else 1),variant+side,door=False)
        for side in [-1,1]:craft_pot(side*w*.20,-d*.32,0,.65)
        box('Courtyard sitting bench',(0,d*.02,.30),(w*.37,.40,.48),timber,.025)
    elif style==2:
        urban_room(culture,-w*.23,d*.08,w*.51,d*.80,h,variant)
        # Open work bay: posts, rafters, benches and actual trade stock.
        for xx in [0,w*.47]:
            for yy in [-d*.43,d*.43]:box('Workshop shed column',(xx,yy,h*.33),(.12,.12,h*.66),timber,.015)
        urban_roof(culture,w*.24,0,h*.67,w*.5,d*.9,h*.7,variant+1)
        box('Artisan work bench',(w*.25,-d*.13,.73),(w*.42,d*.30,.15),timber,.02)
        trade=craft_trades.get(globals().get('town_theme','canal'),['cloth'])[0]
        craft_goods(trade,w*.25,-d*.13,.82,.60)
        craft_cone('Workshop brick flue',-w*.29,d*.22,h,.22,1.7,stone[1],16,top=.18)
    elif style==3:
        urban_room(culture,-w*.255,d*.06,w*.47,d*.83,h,variant)
        urban_room(culture,w*.255,-d*.01,w*.47,d*.70,h*.77,variant+1)
        for side in [-1,1]:
            xx=side*w*.255;yy=-d*.46
            box('Street trade shutter counter',(xx,yy,.85),(w*.38,.42,.10),timber,.02)
            craft_goods('books' if side<0 else 'produce',xx,yy,.91,.47)
    elif style==4:
        urban_room(culture,-w*.16,d*.08,w*.62,d*.68,h*1.18,variant)
        urban_room(culture,w*.31,-d*.16,w*.32,d*.54,h*.53,variant+1)
        box('Projected upper bay',(0,-d*.33,h*.67),(w*.62,.36,.18),timber,.02)
        for j in range(7):box('Upper bay baluster',(-w*.28+j*w*.09,-d*.48,h*.67+.32),(.045,.045,.60),timber,.008)
        box('Upper bay handrail',(0,-d*.48,h*.67+.63),(w*.65,.08,.08),gold,.008)
    elif style==5:
        urban_room(culture,0,d*.12,w,d*.62,h*.61,variant,z=h*.35)
        for xx in [-w*.43,0,w*.43]:
            box('Arcade dressed pier',(xx,-d*.32,h*.18),(.23,.25,h*.36),stone[4],.035)
            line('Arcade knee braces',[(xx-w*.16,-d*.32,h*.32),(xx,-d*.32,h*.19),(xx+w*.16,-d*.32,h*.32)],.055,timber)
        box('Arcade rear support wall',(0,d*.36,h*.18),(w,.25,h*.36),stone[1],.025)
        # One enclosed side bay supports an accessible upstairs stair.
        box('Gallery stair enclosure',(-w*.38,0,h*.18),(w*.22,d*.60,h*.36),stone[1],.025)
        for i in range(8):box('Gallery access stair',(w*.35,-d*.34+i*d*.065,h*.35*(i+.5)/8),(w*.21,d*.071,h*.35*(i+1)/8),stone[4],.01)
    elif style==6:
        urban_room(culture,-w*.22,d*.12,w*.54,d*.73,h,variant)
        urban_room(culture,w*.27,-d*.12,w*.43,d*.69,h*.62,variant+1)
        for j in range(4):box('Seasoned boards',(w*.27,-d*.43,.13+j*.13),(w*.30,.15,.10),timber,.008)
    elif style==7:
        for xx in [-w*.35,w*.35]:
            for yy in [-d*.32,d*.32]:
                box('Granary vermin proof pier',(xx,yy,.36),(.32,.32,.72),stone[1],.025)
                box('Granary mushroom cap',(xx,yy,.72),(.56,.56,.13),stone[4],.035)
        urban_room(culture,0,0,w*.88,d*.85,h*.75,variant,z=.79)
        for j in range(5):box('Granary entry stair',(0,-d*.47-j*.15,.77-j*.15),(1,.17,.15),timber,.01)
    else:
        urban_room(culture,-w*.10,d*.17,w*.75,d*.59,h*.72,variant)
        for side in [-1,1]:
            box('Kitchen garden planter',(side*w*.30,-d*.28,.20),(w*.26,d*.26,.35),timber,.025)
            for j in range(4):ball('Kitchen garden greens',(side*w*.3+(j%2-.5)*w*.12,-d*.28+(j//2-.5)*d*.1,.48),(.19,.18,.20),leafm[j%3],1)
        for xx in [-w*.48,w*.48]:box('Low garden fence post',(xx,-d*.44,.46),(.09,.09,.92),timber,.01)
        for zz in [.25,.63]:box('Low garden fence rail',(0,-d*.44,zz),(w,.06,.08),timber,.01)
    if style not in [2,3,8]:craft_household(culture,0,0,w*.9,d*.8,h,variant)
    root.location=(x,y,0);root.rotation_euler.z=angle
    root['frontage']=[x+math.sin(angle)*(d/2+.7),y-math.cos(angle)*(d/2+.7)]
    root['urbanVersion']=2
    return root

def urban_bounds(root):
    bpy.context.view_layer.update()
    points=[o.matrix_world@Vector(p) for o in root.children if o.type in {'MESH','CURVE'} for p in o.bound_box]
    return [min(p.x for p in points),min(p.y for p in points),max(p.x for p in points),max(p.y for p in points)] if points else None

def urban_intersects(a,b,gap=.25):
    return a[0]<b[2]+gap and a[2]>b[0]-gap and a[1]<b[3]+gap and a[3]>b[1]-gap

def urban_delete(root):
    for o in list(root.children):bpy.data.objects.remove(o,do_unlink=True)
    roots.remove(root);bpy.data.objects.remove(root,do_unlink=True)

def urban_forbidden(city,bounds):
    x0,y0,x1,y1=bounds;theme=city['theme']
    if min(x0,y0)<-29 or x1>29 or y1>27.7:return True
    if theme in ['harbor','fjord','chalkport'] and y0<-15.1:return True
    limits={'oasis':(-11,-11,11,11),'glacier':(-11,-9,11,9),'farmland':(-7,-5,7,5),'saltlake':(-10,-10,10,11),'canyon':(-11,-17,11,17)}
    if theme in limits and urban_intersects(bounds,limits[theme],.4):return True
    if theme=='canyon' and urban_intersects(bounds,(-17,-2,17,2),.7):return True
    if theme=='terrace' and any(y0<step<y1 for step in [1.5,14.5]):return True
    px,py,r,_=public_spaces[city['key']]
    return urban_intersects(bounds,(px-r,py-r,px+r,py+r),.3)

def urban_homes(city):
    global parent
    key=city['key'];culture=city['culture'];districts=neighbourhoods[key]
    blockers=[geometry_tree(r.children) for r in roots if r.get('facility') or r.get('marketStall') or r.name in ['Scenic ridges','Town identity landmarks','Local craft and landscape','Streets and courtyards']]
    occupied=[urban_bounds(r) for r in roots if r.get('facility') or r.get('marketStall')]
    count=0;report=[]
    for di,(name,points,mix) in enumerate(districts):
        accepted=0;candidates=[]
        for a,b in zip(points,points[1:]):
            delta=Vector((b[0]-a[0],b[1]-a[1]));length=delta.length;tangent=delta.normalized();normal=Vector((-tangent.y,tangent.x))
            steps=max(1,round(length/3.8))
            for distance in [2.7,6.9,11.1]:
                for i in range(steps+1):
                    t=(i+(.15 if distance<4 else .65))/(steps+.8);p=Vector(a).lerp(Vector(b),t)
                    for side in [-1,1]:
                        q=p+normal*side*distance
                        # Back lanes add courtyard depth within the same district.
                        angle=math.atan2(-normal.x*side,normal.y*side)
                        candidates.append((q.x,q.y,angle))
        for ci,(x,y,angle) in enumerate(candidates):
            if accepted>=10:break
            variant=(ci+mix)%9;w=[3.7,4.5,4.1,4.2,3.3,4.3,3.8,3.5,4.1][variant];d=[3.3,3.8,3.6,3.2,3.2,3.4,3.5,3.7,3.5][variant];h=[2.8,2.7,2.9,3.6,3.8,4.1,3.3,3.0,2.8][variant]
            w*=.83;d*=.83;h*=.85
            # Quick conservative lot rejection avoids building hundreds of doomed meshes.
            rx=abs(math.cos(angle))*w/2+abs(math.sin(angle))*(d/2+.45);ry=abs(math.sin(angle))*w/2+abs(math.cos(angle))*(d/2+.45)
            footprint=[x-rx-.25,y-ry-.25,x+rx+.25,y+ry+.25]
            if urban_forbidden(city,footprint) or any(urban_intersects(footprint,b,.24) for b in occupied if b):continue
            root=urban_house(culture,name+' household '+str(accepted+1),None,x,y,w,d,h,variant,angle)
            root['scenery']=True;root['district']=name;root['districtIndex']=di
            if city['theme']=='terrace':root.location.z=3.5 if y>=14.5 else 1.6 if y>=1.5 else 0
            bpy.context.view_layer.update();shape=geometry_tree(root.children);bounds=urban_bounds(root)
            if urban_forbidden(city,bounds) or any(t and shape.overlap(t) for t in blockers):urban_delete(root);continue
            blockers.append(shape);occupied.append(bounds);count+=1;accepted+=1
        report.append((name,accepted))
    print('DISTRICTS',key,report,flush=True)
    if count<14:raise RuntimeError(key+' insufficient connected frontage homes: '+str(count))

def urban_public_space(city):
    global parent
    if city['key'] in ['redsail','yunjing']:return
    x,y,r,name=public_spaces[city['key']]
    root=group(name);root['publicSpace']=name;root['district']='public-square';root['urbanVersion']=2
    # Foundation of the open square stays below buildings; the centre is pedestrian space.
    base=3.5 if city['theme']=='terrace' and y-r>=14.5 else 1.6 if city['theme']=='terrace' and y-r>=1.5 else -.12
    material=craft_floor
    craft_cone('Public square radial pavement',x,y,base,r,.025,material,48,top=r)
    if city['key']!='dawncrown':
        craft_cone('Communal well curb',x,y,base+.04,.65,.55,stone[3],32,top=.65)
        craft_cone('Well dark opening',x,y,base+.60,.48,.015,wood,32,top=.48)
        for xx in [x-.78,x+.78]:box('Well lifting post',(xx,y,base+1.0),(.12,.12,2.0),timber,.02)
        line('Well lifting beam',[(x-.85,y,base+2),(x+.85,y,base+2)],.10,timber)
        line('Well bucket rope',[(x,y,base+2),(x,y,base+.7)],.025,rope)
    # Benches and shade define an edge, leaving the through route open.
    for sign in [-1,1]:
        xx=x+sign*r*.71;yy=y+r*.38
        box('Square bench seat',(xx,yy,base+.47),(1.25,.42,.13),timber,.025)
        for dx in [-.45,.45]:box('Bench stone support',(xx+dx,yy,base+.24),(.18,.35,.45),stone[1],.02)
        craft_pot(xx,yy+.52,base,.7)
    for o in root.children:
        if o.type=='MESH' and any(m==craft_floor for m in o.data.materials):craft_uv(o,None)

def urban_streets(city):
    """Connect actual doors, gates, market fronts and public courts on dry land.

    An occupancy grid is used only for pathfinding. The exported pavement is a
    single flat surface; no visible planning grid or repeated block template.
    """
    global parent
    key=city['key']
    if key in ['redsail','yunjing']:return
    root=next(r for r in roots if r.name=='Streets and courtyards');parent=root
    for o in list(root.children):
        if o.name.startswith('Unified paved streets'):bpy.data.objects.remove(o,do_unlink=True)
    N=128;step=.5
    def point(p):return (-32+(p[0]+.5)*step,-31+(p[1]+.5)*step)
    def cell(x,y):return (max(0,min(N-1,int((x+32)/step))),max(0,min(123,int((y+31)/step))))
    occupied=[urban_bounds(r) for r in roots if r.get('facility') not in [None,'cityGate','adventureCheckpoint'] or r.get('scenery') or r.get('marketStall')]
    obstacle={'oasis':(-9,-8,9,8),'glacier':(-6.8,-6.8,6.8,6.8),'farmland':(-6.6,-4.2,6.6,4.2),'saltlake':(-9.5,-8.1,9.5,10.1),'canyon':(-10.8,-16,10.8,16)}.get(city['theme'])
    def blocked(p):
        x,y=point(p)
        if abs(x)>30 or abs(y)>29:return True
        if city['theme'] in ['harbor','fjord'] and y<-15 and x>-10:return True
        if city['theme']=='chalkport' and y<-19:return True
        if city['theme']=='harbor' and -28<x<-10 and -28<y<-20.5:return True
        if city['theme']=='terrace' and any(abs(y-edge)<.6 for edge in [1.5,14.5]) and abs(x-3)>1.2:return True
        if obstacle and obstacle[0]<x<obstacle[2] and obstacle[1]<y<obstacle[3]:
            if city['theme']!='canyon' or abs(y)>1.15:return True
        return any(b[0]-.12<x<b[2]+.12 and b[1]-.12<y<b[3]+.12 for b in occupied if b)
    free={(i,j) for i in range(N) for j in range(124) if not blocked((i,j))}
    def nearest(p):return min(free,key=lambda q:(q[0]-p[0])**2+(q[1]-p[1])**2)
    px,py,r,_=public_spaces[key];start=nearest(cell(px+r*.8,py));network={start};paths=[];entrances=[]
    for building in roots:
        if building.get('facility') or building.get('scenery') or building.get('marketStall'):
            if building.get('passageCenter'):x,y=building['passageCenter']
            elif building.get('frontage'):x,y=building['frontage']
            else:
                b=urban_bounds(building);x=(b[0]+b[2])/2;y=b[1]-.45
            entrances.append((building,nearest(cell(x,y))))
    # Connect closest destinations first, so branches reuse streets rather than fan out.
    while entrances:
        index=min(range(len(entrances)),key=lambda i:min(abs(entrances[i][1][0]-p[0])+abs(entrances[i][1][1]-p[1]) for p in network))
        building,origin=entrances.pop(index);queue=[(0,origin)];cost={origin:0};came={};end=None
        while queue:
            _,p=heapq.heappop(queue)
            if p in network:end=p;break
            for q in [(p[0]+1,p[1]),(p[0]-1,p[1]),(p[0],p[1]+1),(p[0],p[1]-1)]:
                if q not in free:continue
                value=cost[p]+1
                if value<cost.get(q,1e9):cost[q]=value;came[q]=p;heapq.heappush(queue,(value,q))
        if end is None:raise RuntimeError(key+' unreachable street frontage '+building.name)
        path=[end]
        while path[-1]!=origin:path.append(came[path[-1]])
        network.update(path);paths.append(path);building['streetConnected']=True
    paved=set()
    for i,j in network:
        for di,dj in [(0,0),(1,0),(-1,0),(0,1),(0,-1),(1,1),(-1,-1)]:
            q=(i+di,j+dj)
            if q in free:paved.add(q)
    vertices=[];faces=[]
    for p in sorted(paved):
        x,y=point(p);z=-.105
        if city['theme']=='terrace':
            z=3.375 if y>=14.5 else 1.475 if y>=1.5 else -.105
            if abs(x-3)<1.5 and (-1.5<y<1.5 or 11<y<14.5):continue
        if city['theme']=='canyon' and abs(x)<16.5 and abs(y)<1.5:continue # existing raised stone crossing
        k=len(vertices);vertices.extend([(x-.25,y-.25,z),(x+.25,y-.25,z),(x+.25,y+.25,z),(x-.25,y+.25,z)]);faces.append((k,k+1,k+2,k+3))
    o=mesh('Connected neighbourhood paving',vertices,faces,craft_floor);craft_uv(o,None)
    root['urbanVersion']=2;root['connectedFrontages']=len(paths);root['districtCount']=len(neighbourhoods[key])
    print('STREETS',key,len(paths),'connected doors',len(paved),'paving cells',flush=True)

def urban_ground_finish(city):
    """Unpaved ground, private court and public street have different surfaces."""
    theme=city['theme']
    for obj in scene.objects:
        if obj.type!='MESH':continue
        if obj.name.startswith(('Town ground','North bank','Southwest bank','Southeast bank')):
            kind='snow' if theme in ['fjord','glacier'] else 'rock' if theme=='volcanic' else 'sand' if city['culture']=='safir' or theme in ['kiln','harbor','chalkport'] else 'meadow'
            obj.data.materials.clear();obj.data.materials.append(craft_ground[kind]);craft_uv(obj,None,6)
        elif obj.name.startswith('Retaining terrace'):
            # Upper terrace tops have earthy garden courts; masonry remains on sides.
            obj.data.materials.clear();obj.data.materials.append(craft_mats[1]);obj.data.materials.append(craft_ground['meadow'])
            for face in obj.data.polygons:face.material_index=1 if face.normal.z>.5 else 0
            craft_uv(obj,None,6)

def urban_limit_households(city):
    # Multi-wing courts combine curved roofs and carved openings. Bound small
    # household meshes while retaining UVs and the full civic architecture.
    if city['culture']!='safir' and city['key']!='yunjing':return
    budget=18000 if city['key']=='yunjing' else 10000
    for root in roots:
        if not root.get('scenery'):continue
        for obj in root.children:
            if obj.type!='MESH':continue
            triangles=sum(len(p.vertices)-2 for p in obj.data.polygons)
            if triangles<=budget:continue
            modifier=obj.modifiers.new('Near view household detail budget','DECIMATE');modifier.ratio=budget/triangles
            modifier.use_collapse_triangulate=True
            bpy.ops.object.select_all(action='DESELECT');obj.select_set(True);bpy.context.view_layer.objects.active=obj
            bpy.ops.object.modifier_apply(modifier=modifier.name)
