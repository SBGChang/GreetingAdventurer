"""Authored crossings and open wall passages; shared by town scene builders."""

def stone_crossing(name,cx,cy,length,width,axis='y',base=.13,rise=1.55):
    root=group(name);root['crossing']=True
    def point(u,v,z):return (cx+v,cy+u,z) if axis=='y' else (cx+u,cy+v,z)
    root['landingA']=point(-length/2,0,base);root['landingB']=point(length/2,0,base)
    n=40
    def height(t):return base+rise*math.sin(math.pi*t)**1.25
    # Closed masonry vault: a continuous deck and soffit, not floating treads.
    vv=[];ff=[]
    for j in range(n+1):
        t=j/n;u=(t-.5)*length;z=height(t)
        vv.extend([point(u,-width/2,z),point(u,width/2,z),point(u,width/2,z-.40),point(u,-width/2,z-.40)])
    for j in range(n):
        for k in range(4):a=j*4+k;b=j*4+(k+1)%4;ff.append((a,b,b+4,a+4))
    ff.extend([(3,2,1,0),(n*4,n*4+1,n*4+2,n*4+3)])
    mesh('Continuous stone bridge vault',vv,ff,stone[2])
    # Level stone treads make the arched span a usable stair, not a steep ramp.
    steps=24
    for j in range(steps):
        t=(j+.5)/steps;u=(t-.5)*length
        bottom=min(height(j/steps),height((j+1)/steps))-.015
        top=max(height(j/steps),height((j+1)/steps))+.025
        box('Level bridge stair tread',point(u,0,(top+bottom)/2),(width-.28,length/steps-.006,top-bottom) if axis=='y' else (length/steps-.006,width-.28,top-bottom),stone[j%5],.006)
    for s in [-1,1]:
        for j in range(11):
            t=j/10;u=(t-.5)*length;z=height(t)
            box('Bridge baluster',point(u,s*(width/2-.1),z+.45),(.16,.16,.9),stone[3],.02)
            ball('Bridge cap',point(u,s*(width/2-.1),z+.94),(.13,.13,.13),stone[4],2)
        line('Continuous bridge handrail',[point((j/n-.5)*length,s*(width/2-.1),height(j/n)+.83) for j in range(n+1)],.07,stone[4])
        # Abutments sit on the dry bank and carry the vault haunches.
        u=s*(length/2-.65);z=height((u+length/2)/length)-.4
        box('Bridge bank abutment',point(u,0,(z-.32)/2), (width,.8,z+.32) if axis=='y' else (.8,width,z+.32),stone[1],.025)
    return root

def timber_crossing(name,cx,cy,length,width,axis='y'):
    root=group(name);root['crossing']=True
    def point(u,v,z):return (cx+v,cy+u,z) if axis=='y' else (cx+u,cy+v,z)
    root['landingA']=point(-length/2,0,.14);root['landingB']=point(length/2,0,.14)
    def height(t):return .14+.85*math.sin(math.pi*t)**1.25
    n=32
    for j in range(n):
        t=(j+.5)/n;u=(t-.5)*length;z=height(t)
        box('Crossing deck plank',point(u,0,z-.055),(width,length/n-.012,.11) if axis=='y' else (length/n-.012,width,.11),timber,.008)
    for side in [-1,1]:
        points=[point((j/n-.5)*length,side*(width/2-.1),height(j/n)-.15) for j in range(n+1)]
        line('Continuous timber bearer',points,.10,wood)
        for j in range(9):
            t=j/8;u=(t-.5)*length;z=height(t)
            box('Crossing railing post',point(u,side*(width/2-.07),z+.43),(.13,.13,.86),wood,.01)
        line('Crossing top rail',[point((j/n-.5)*length,side*(width/2-.07),height(j/n)+.81) for j in range(n+1)],.055,timber)
    for end in [-1,1]:
        u=end*(length/2-.35);z=height((u+length/2)/length)
        for side in [-1,1]:box('Bank bearing pile',point(u,side*(width/2-.15),(z-.65)/2),(.22,.22,z+.65),wood,.01)
    return root

def wall_segments(start,end,openings):
    cursor=start
    for a,b in sorted(openings):
        if a>cursor:yield cursor,min(a,end)
        cursor=max(cursor,b)
    if cursor<end:yield cursor,end

def canyon_arch(material):
    # Masonry spandrels and a real arch opening carry the long stone deck.
    vertices=[];faces=[];n=48
    for j in range(n+1):
        x=-6.1+j*12.2/n;soffit=.18+1.8*math.sqrt(max(0,1-(x/6.1)**2))
        vertices.extend([(x,-1.4,soffit),(x,1.4,soffit),(x,1.4,2.27),(x,-1.4,2.27)])
    for j in range(n):
        for k in range(4):a=j*4+k;b=j*4+(k+1)%4;faces.append((a,b,b+4,a+4))
    faces.extend([(3,2,1,0),(n*4,n*4+1,n*4+2,n*4+3)])
    return mesh('Canyon load bearing masonry arch',vertices,faces,material)

def orient_gate(root,x,y):
    # Local piers originally span X. Side gates must span Y to face the exterior.
    if abs(x)>abs(y):
        root.rotation_euler.z=math.pi/2;root.location.x=x+y;root.location.y=y-x
    axis='x' if abs(x)>abs(y) else 'y'
    root['passageAxis']=axis;root['passageCenter']=[x,y]

def town_perimeter(city,positions):
    culture=city['culture'];theme=city['theme'];openings={'left':[],'right':[],'back':[],'front':[]}
    for kind,(x,y) in zip(facilities,positions):
        if kind not in ['cityGate','adventureCheckpoint']:continue
        wall=('right' if x>0 else 'left') if abs(x)>abs(y) else ('back' if y>0 else 'front')
        c=y if wall in ['left','right'] else x;openings[wall].append((c-2.1,c+2.1))
    for side,x in [('left',-32),('right',32)]:
        for a,b in wall_segments(-28,30,openings[side]):box('Side wall',(x,(a+b)/2,1),(1,b-a,2),stone[0] if culture!='vildun' else wood)
    for a,b in wall_segments(-31.5,31.5,openings['back']):box('Back wall',((a+b)/2,30,1),(b-a,1.2,2),stone[0] if culture!='vildun' else wood)
    if theme not in ['harbor','fjord','chalkport']:
        for a,b in wall_segments(-32,32,[(-6,6),*openings['front']]):box('Front cutaway',((a+b)/2,-30,.4),(b-a,1,.8),stone[1])
