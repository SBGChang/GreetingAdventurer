"""Validate authored spatial clearance; stamp the exact exported assets checked.
Run Blender --background --python-exit-code 1 --python scripts/blender/verify-clearance.py.
Architectural joints within one building and foundations touching their own terrain
are intentional. Check independent buildings and external scenery instead.
"""
import bpy,json,hashlib,math
from mathutils import Vector
from pathlib import Path
from mathutils.bvhtree import BVHTree
ROOT=Path(__file__).resolve().parents[2];folder=ROOT/'app/assets/geography'
atlas=json.loads((folder/'atlas.json').read_text());issues=[];assets=[]
infrastructure={'bridges':0,'gates':0,'harborBuildings':0,'canyonApproaches':0}
street_audits=[]
def tree(root):
    vertices=[];faces=[]
    for obj in root.children:
        if obj.type!='MESH':continue
        off=len(vertices);vertices.extend(obj.matrix_world @ v.co for v in obj.data.vertices)
        faces.extend(tuple(v+off for v in p.vertices) for p in obj.data.polygons)
    return BVHTree.FromPolygons(vertices,faces) if faces else None
def stamp(path):
    assets.append({'path':path.relative_to(ROOT).as_posix(),'sha256':hashlib.sha256(path.read_bytes()).hexdigest()})

def surface_tree(root,water=False):
    vertices=[];faces=[]
    for obj in root.children:
        if obj.type!='MESH':continue
        off=len(vertices);vertices.extend(obj.matrix_world @ v.co for v in obj.data.vertices)
        for p in obj.data.polygons:
            material=obj.data.materials[p.material_index] if obj.data.materials else None
            wet=material and material.name.startswith('Canal jade water')
            if bool(wet)==water:faces.append(tuple(v+off for v in p.vertices))
    return BVHTree.FromPolygons(vertices,faces) if faces else None

def surface_z(geometry,x,y):
    hit=geometry.ray_cast(Vector((x,y,30)),Vector((0,0,-1)),60)[0] if geometry else None
    return hit.z if hit else None

def check_infrastructure(city):
    objects=list(bpy.context.scene.objects)
    foundation=next(r for r in objects if r.name==('Town foundations' if city['key']=='yunjing' else 'Terrain foundation'))
    dry=surface_tree(foundation);wet=surface_tree(foundation,True)
    bridges=[r for r in objects if r.get('crossing')]
    if city['key']=='yunjing' and len(bridges)!=3:issues.append([city['key'],'three permanent crossings required'])
    for root in bridges:
        a=Vector(root['landingA']);b=Vector(root['landingB']);geometry=tree(root)
        for p in [a,b]:
            ground=surface_z(dry,p.x,p.y);water=surface_z(wet,p.x,p.y)
            if ground is None or abs(ground-p.z)>.22 or (water is not None and ground<water+.1):issues.append([city['key'],root.name,'landing is not on the dry bank'])
        heights=[]
        for i in range(1,80):
            p=a.lerp(b,i/80);height=surface_z(geometry,p.x,p.y)
            if height is None:
                # Millimetre plank joints are walkable; an actual missing span is not.
                delta=(b-a).normalized()*.025
                near=[surface_z(geometry,p.x+s*delta.x,p.y+s*delta.y) for s in [-1,1]]
                height=max((z for z in near if z is not None),default=None)
            if height is None:issues.append([city['key'],root.name,'broken walking surface']);break
            heights.append(height)
        if any(abs(a-b)>.22 for a,b in zip(heights,heights[1:])):issues.append([city['key'],root.name,'discontinuous deck'])
        infrastructure['bridges']+=1
    obstacles=[tree(r) for r in objects if r.type=='EMPTY' and r!=foundation and r.name not in ['Streets and courtyards','Street paving and market stalls']]
    for root in [r for r in objects if r.get('facility') in ['cityGate','adventureCheckpoint']]:
        # Older files have no passage metadata and must be rebuilt, not silently skipped.
        if not root.get('passageAxis'):issues.append([city['key'],root.name,'missing authored gate passage']);continue
        x,y=root['passageCenter'];axis=0 if root['passageAxis']=='x' else 1;sign=1 if [x,y][axis]>0 else -1
        start=Vector((x,y,root.location.z+1.1));start[axis]-=sign*2
        direction=Vector((0,0,0));direction[axis]=sign
        if any(t and t.ray_cast(start,direction,7)[0] is not None for t in obstacles):issues.append([city['key'],root.name,'gate passage is obstructed'])
        infrastructure['gates']+=1
    if city['theme'] in ['harbor','fjord']:
        # Probe actual civic footing bounds on the horizontal plane, including corners.
        for root in [r for r in objects if r.get('facility') not in [None,'cityGate','adventureCheckpoint']]:
            points=[o.matrix_world @ v.co for o in root.children if o.type=='MESH' for v in o.data.vertices]
            bottom=min(p.z for p in points);foot=[p for p in points if p.z<bottom+.25]
            for x in [min(p.x for p in foot),sum(p.x for p in foot)/len(foot),max(p.x for p in foot)]:
                for y in [min(p.y for p in foot),sum(p.y for p in foot)/len(foot),max(p.y for p in foot)]:
                    ground=surface_z(dry,x,y);water=surface_z(wet,x,y)
                    if ground is None or (water is not None and water>ground):issues.append([city['key'],root.name,'building footing enters harbor water'])
            infrastructure['harborBuildings']+=1
    if city['key']=='ochrestep':
        geometry=tree(next(r for r in objects if r.name=='Town identity landmarks'));last=None
        for i in range(169):
            x=-16.8+i*.2;z=surface_z(geometry,x,0)
            if z is None:z=surface_z(dry,x,0)
            if z is None or (last is not None and abs(z-last)>.24):issues.append([city['key'],'canyon bridge requires continuous stair approaches']);break
            last=z
        infrastructure['canyonApproaches']+=1
    if city['key']=='qingcen':
        for start,end,base,top in [(-1.5,1.5,-.15,1.45),(11,14.5,1.45,3.35)]:
            last=base
            for i in range(61):
                z=surface_z(dry,3,start+(end-start)*i/60)
                if z is None or z<last-.04 or z-last>.18:issues.append([city['key'],'terrace stair lacks continuous support']);break
                last=z
            if abs(last-top)>.1:issues.append([city['key'],'terrace stair misses upper landing'])

def check_streets(city):
    if city['key'] in ['yunjing','redsail']:return
    street=next(r for r in bpy.context.scene.objects if r.name=='Streets and courtyards')
    surfaces=[]
    for obj in street.children:
        if obj.type!='MESH':continue
        for face in obj.data.polygons:
            material=obj.data.materials[face.material_index]
            if not material.name.startswith('Town craft close limestone pavement'):continue
            points=[obj.matrix_world @ obj.data.vertices[i].co for i in face.vertices]
            if max(p.z for p in points)-min(p.z for p in points)>.02:continue
            surfaces.append(sum(points,Vector())/len(points))
    buildings=[r for r in bpy.context.scene.objects if r.get('facility') or r.get('scenery') or r.get('marketStall')]
    if not surfaces:issues.append([city['key'],'missing actual street pavement']);return
    # Probe the mesh rather than trusting the exported streetConnected flag.
    streets=tree(street);maximum=0
    for building in buildings:
        if not building.get('frontage'):continue
        x,y=building['frontage']
        distance=min(math.hypot(p.x-x,p.y-y) for p in surfaces);maximum=max(maximum,distance)
        if distance>2.3:issues.append([city['key'],building.name,'frontage too far from paved street',round(distance,2)])
    obstacles=[(r.name,tree(r)) for r in buildings]
    hits=[]
    for p in surfaces:
        if any(t and t.ray_cast(p+Vector((0,0,.12)),Vector((0,0,1)),1.5)[0] is not None for _,t in obstacles):hits.append([round(p.x,2),round(p.y,2)])
    if hits:issues.append([city['key'],'street walking surface blocked by building',hits[:5]])
    street_audits.append({'city':city['key'],'pavementSamples':len(surfaces),'frontages':len(buildings),'maximumDoorDistance':round(maximum,3),'blockedSamples':len(hits)})
for city in atlas['cities']:
    path=(folder/city['model']).resolve();blend=path.with_suffix('.blend')
    bpy.ops.wm.open_mainfile(filepath=str(blend));bpy.context.view_layer.update()
    roots=[r for r in bpy.context.scene.objects if r.get('facility') or r.get('scenery') or r.get('marketStall') or r.get('crossing') or r.get('publicSpace') or r.name in ['Scenic ridges','Town identity landmarks','Local craft and landscape','Gardens and quay furniture','Neighbourhood gardens','Street paving and market stalls','Canal boat']]
    trees=[tree(r) for r in roots]
    for i,a in enumerate(roots):
        for j,b in enumerate(roots[:i]):
            if trees[i] and trees[j] and trees[i].overlap(trees[j]):issues.append([city['key'],a.name,b.name])
    check_infrastructure(city)
    check_streets(city)
    stamp(path);stamp(blend)
bpy.ops.wm.open_mainfile(filepath=str(folder/'world.blend'));bpy.context.view_layer.update()
cities=[r for r in bpy.context.scene.objects if r.get('cityKey')]
obstacles=[r for r in bpy.context.scene.objects if r.get('regionKey') or r.name.startswith('Road ') or r.name.startswith('River ') or r.name in ['Regional vegetation','Inland lake','Coast and lake banks']]
obstacles=[(r.name,tree(r)) for r in obstacles]
vegetation=next(t for name,t in obstacles if name=='Regional vegetation')
for name,obstacle in obstacles:
    if name.startswith(('Road ','River ')) and vegetation and obstacle and vegetation.overlap(obstacle):issues.append(['world','vegetation',name])
for city in cities:
    geometry=tree(city)
    for name,obstacle in obstacles:
        if geometry and obstacle and geometry.overlap(obstacle):issues.append(['world',city['cityKey'],name])
stamp(folder/'world.glb');stamp(folder/'world.blend')
# Read actual terrain topology: exactly one connected land surface, whose two
# boundary loops are the external coast and the enclosed lake shore.
edges={};adj={}
for root in bpy.context.scene.objects:
    if not root.get('regionKey'):continue
    for obj in root.children:
        if obj.type!='MESH':continue
        points=[tuple(round(c,4) for c in (obj.matrix_world @ v.co)[:2]) for v in obj.data.vertices]
        for poly in obj.data.polygons:
            vv=[points[i] for i in poly.vertices]
            for a,b in zip(vv,vv[1:]+vv[:1]):
                if a==b:continue
                key=tuple(sorted([a,b]));edges[key]=edges.get(key,0)+1
                adj.setdefault(a,set()).add(b);adj.setdefault(b,set()).add(a)
def components(graph):
    remaining=set(graph);count=0
    while remaining:
        count+=1;queue=[remaining.pop()]
        while queue:
            for key in graph[queue.pop()]:
                if key in remaining:remaining.remove(key);queue.append(key)
    return count
shore={}
for (a,b),count in edges.items():
    if count==1:shore.setdefault(a,set()).add(b);shore.setdefault(b,set()).add(a)
topology={'landComponents':components(adj),'shoreLoops':components(shore)}
if topology!={'landComponents':1,'shoreLoops':2}:issues.append(['world','terrain topology',topology])
if any(len(v)!=2 for v in shore.values()):issues.append(['world','non-manifold shoreline'])
(folder/'geometry-clearance.json').write_text(json.dumps({'assets':assets,'issues':issues,'topology':topology,'infrastructure':infrastructure,'streets':street_audits},indent=2),encoding='utf-8')
if issues:raise RuntimeError('Town/world spatial validation failed: '+json.dumps(issues,ensure_ascii=False))
print('CLEARANCE PASSED: 16 towns, bridge landings/decks, gate passages, harbor footings, canyon stairs and world separation',flush=True)
