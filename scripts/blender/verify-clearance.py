"""Validate authored spatial clearance; stamp the exact exported assets checked.
Run Blender --background --python-exit-code 1 --python scripts/blender/verify-clearance.py.
Architectural joints within one building and foundations touching their own terrain
are intentional. Check independent buildings and external scenery instead.
"""
import bpy,json,hashlib
from pathlib import Path
from mathutils.bvhtree import BVHTree
ROOT=Path(__file__).resolve().parents[2];folder=ROOT/'app/assets/geography'
atlas=json.loads((folder/'atlas.json').read_text());issues=[];assets=[]
def tree(root):
    vertices=[];faces=[]
    for obj in root.children:
        if obj.type!='MESH':continue
        off=len(vertices);vertices.extend(obj.matrix_world @ v.co for v in obj.data.vertices)
        faces.extend(tuple(v+off for v in p.vertices) for p in obj.data.polygons)
    return BVHTree.FromPolygons(vertices,faces) if faces else None
def stamp(path):
    assets.append({'path':path.relative_to(ROOT).as_posix(),'sha256':hashlib.sha256(path.read_bytes()).hexdigest()})
for city in atlas['cities']:
    path=(folder/city['model']).resolve();blend=path.with_suffix('.blend')
    bpy.ops.wm.open_mainfile(filepath=str(blend));bpy.context.view_layer.update()
    roots=[r for r in bpy.context.scene.objects if r.get('facility') or r.get('scenery') or r.name in ['Market stalls','Scenic ridges','Town identity landmarks','Local craft and landscape','Gardens and quay furniture','Neighbourhood gardens','Street paving and market stalls','Canal boat']]
    trees=[tree(r) for r in roots]
    for i,a in enumerate(roots):
        for j,b in enumerate(roots[:i]):
            if trees[i] and trees[j] and trees[i].overlap(trees[j]):issues.append([city['key'],a.name,b.name])
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
(folder/'geometry-clearance.json').write_text(json.dumps({'assets':assets,'issues':issues,'topology':topology},indent=2),encoding='utf-8')
if issues:raise RuntimeError('Independent meshes intersect: '+json.dumps(issues,ensure_ascii=False))
print('CLEARANCE PASSED: 16 towns and world city/terrain/road/water/vegetation separation',flush=True)
