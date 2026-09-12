"""World-only art builder, executed in build-geography.py's authoring context.
One continent and an enclosed inland lake with regional relief, tiled UV albedo/normal maps,
and sixteen complete settlement LODs. No gameplay geometry.
"""
from mathutils import Matrix
from mathutils.bvhtree import BVHTree

def texture_material(name, image_path, roughness=.9):
    m=mat(name,(1,1,1),roughness)
    image=bpy.data.images.load(str(OUT/image_path),check_existing=True);image.pack()
    node=m.node_tree.nodes.new('ShaderNodeTexImage');node.image=image
    m.node_tree.links.new(node.outputs['Color'],m.node_tree.nodes['Principled BSDF'].inputs['Base Color'])
    return m

def bake_normal(material,key,distance,uv_name=None,resolution=1024):
    # Standard Blender material baking; high-frequency shading stays in a texture.
    global parent
    parent=None
    bpy.ops.mesh.primitive_plane_add(size=2)
    plane=bpy.context.object;plane.name='Material bake surface';plane.data.materials.append(material)
    if uv_name:plane.data.uv_layers.active.name=uv_name
    nodes=material.node_tree.nodes;links=material.node_tree.links;p=nodes.get('Principled BSDF')
    albedo=next(n for n in nodes if n.type=='TEX_IMAGE')
    bump=nodes.new('ShaderNodeBump');bump.inputs['Distance'].default_value=distance;bump.inputs['Strength'].default_value=.35
    links.new(albedo.outputs['Color'],bump.inputs['Height']);links.new(bump.outputs['Normal'],p.inputs['Normal'])
    output=bpy.data.images.new(key,width=resolution,height=resolution);output.colorspace_settings.name='Non-Color'
    target=nodes.new('ShaderNodeTexImage');target.image=output;nodes.active=target
    bpy.ops.object.select_all(action='DESELECT');plane.select_set(True);bpy.context.view_layer.objects.active=plane
    scene.render.engine='CYCLES';scene.cycles.samples=8;scene.render.bake.margin=8
    bpy.ops.object.bake(type='NORMAL')
    output.filepath_raw=str(OUT/(key+'.png'));output.file_format='PNG';output.save();output.pack()
    nodes.remove(bump)
    normal=nodes.new('ShaderNodeNormalMap');normal.inputs['Strength'].default_value=.65
    if uv_name:
        normal.uv_map=uv_name
        uv=nodes.new('ShaderNodeUVMap');uv.uv_map=uv_name;links.new(uv.outputs['UV'],target.inputs['Vector'])
    links.new(target.outputs['Color'],normal.inputs['Color']);links.new(normal.outputs['Normal'],p.inputs['Normal'])
    bpy.data.objects.remove(plane,do_unlink=True)

def uv_project(obj,scale=1,global_uv=False):
    uv=obj.data.uv_layers.new(name='Surface UV')
    for poly in obj.data.polygons:
        poly.use_smooth=True
        for li in poly.loop_indices:
            v=obj.data.vertices[obj.data.loops[li].vertex_index].co
            uv.data[li].uv=((v.x+102)/204,(v.y+95)/190) if global_uv else (v.x/scale,v.y/scale+v.z/(scale*.7))

def ribbon(name,points,width,material,raise_z=.055,dashed=False,surface_kind=None):
    # Catmull-Rom bends keep surveyed endpoints while removing ruler-straight corners.
    curved=[]
    for i in range(len(points)-1):
        p0=points[max(0,i-1)];p1=points[i];p2=points[i+1];p3=points[min(len(points)-1,i+2)]
        for j in range(8):
            t=j/8
            curved.append(tuple(.5*((2*p1[k])+(-p0[k]+p2[k])*t+(2*p0[k]-5*p1[k]+4*p2[k]-p3[k])*t*t+(-p0[k]+3*p1[k]-3*p2[k]+p3[k])*t*t*t) for k in [0,1]))
    points=curved+[points[-1]]
    vertices=[];faces=[]
    dash_index=0
    for a,b in zip(points,points[1:]):
        dx,dy=b[0]-a[0],b[1]-a[1];length=math.hypot(dx,dy)
        nx,ny=-dy/length*width/2,dx/length*width/2
        steps=max(2,int(length*1.5))
        for j in range(steps):
            dash_index+=1
            if dashed and dash_index%8>4:continue
            x=a[0]+dx*j/steps;y=a[1]+dy*j/steps;xx=a[0]+dx*(j+1)/steps;yy=a[1]+dy*(j+1)/steps
            if any(max(abs((x+xx)/2-c['position'][0]),abs((y+yy)/2-c['position'][1])) < (14 if c['rank']=='capital' else 11)+width/2 for c in atlas['cities']):continue
            on_land=elevation((x+xx)/2,(y+yy)/2)>=0
            if surface_kind=='land' and not on_land:continue
            if surface_kind=='water' and on_land:continue
            corridors.append((x,y,xx,yy,width/2))
            n=len(vertices)
            vertices.extend([(x+nx,y+ny,elevation(x+nx,y+ny)+raise_z),(x-nx,y-ny,elevation(x-nx,y-ny)+raise_z),(xx-nx,yy-ny,elevation(xx-nx,yy-ny)+raise_z),(xx+nx,yy+ny,elevation(xx+nx,yy+ny)+raise_z)])
            faces.append((n,n+1,n+2,n+3))
    obj=mesh(name,vertices,faces,material);uv_project(obj,12);return obj

def miniature(city,root):
    # Retain the whole authored settlement plan: walls, districts, canals and civic
    # landmarks share one transform, instead of rearranging eight sample buildings.
    path=(OUT/city['model']).with_suffix('.blend')
    with bpy.data.libraries.load(str(path),link=False) as (src,dst):dst.objects=src.objects
    imported=[o for o in dst.objects if o]
    # Linked objects need a dependency-graph update before matrix_world includes
    # their authored parent transforms. Unlinked library objects collapse at origin.
    for obj in imported:scene.collection.objects.link(obj)
    bpy.context.view_layer.update()
    selected=[o for o in imported if o.type=='MESH' and o.name!='Studio floor']
    bounds=[o.matrix_world @ Vector(corner) for o in selected for corner in o.bound_box]
    lo=Vector(tuple(min(v[i] for v in bounds) for i in range(3)))
    hi=Vector(tuple(max(v[i] for v in bounds) for i in range(3)))
    scale=(26 if city['rank']=='capital' else 20)/max(hi.x-lo.x,hi.y-lo.y)
    center=Vector(((lo.x+hi.x)/2,(lo.y+hi.y)/2,lo.z))
    ratio=min(1,18000/sum(sum(len(p.vertices)-2 for p in o.data.polygons) for o in selected))
    x,y=city['position'];z=elevation(x,y)+.2
    transform=Matrix.Translation(Vector((x,y,z))) @ Matrix.Scale(scale,4) @ Matrix.Translation(-center)
    for source in selected:
        obj=bpy.data.objects.new('Map building '+source.name,source.data.copy());scene.collection.objects.link(obj)
        obj.data.transform(transform @ source.matrix_world);obj.parent=root
        bpy.ops.object.select_all(action='DESELECT');obj.select_set(True);bpy.context.view_layer.objects.active=obj
        structural=source.parent and source.parent.name in ['Town foundations','Terrain foundation','Streets and courtyards','Defensive perimeter']
        if len(obj.data.polygons)>300 and not structural:
            weld=obj.modifiers.new('Merge subpixel seams','WELD');weld.merge_threshold=.035
            bpy.ops.object.modifier_apply(modifier=weld.name)
            decimate=obj.modifiers.new('Atlas building LOD','DECIMATE');decimate.ratio=ratio
            bpy.ops.object.modifier_apply(modifier=decimate.name)
    for obj in imported:bpy.data.objects.remove(obj,do_unlink=True)

def biome_materials():
    result={}
    for key,name in [('meadow','Continent UV albedo'),('snow','Snow UV albedo'),('sand','Sand UV albedo')]:
        material=texture_material(name,key+'-albedo.png',.94)
        bake_normal(material,key+'-normal',.035)
        result[key]=material
    return result

def vegetation_mesh(instances):
    # Copy prototype vertices into one mesh; avoid thousands of transient objects.
    prototypes={};materials=[]
    for kind,build in [('pine',pine),('palm',palm)]:
        before=set(parent.children);build(0,0,0,1);bpy.context.view_layer.update()
        objects=set(parent.children)-before;vertices=[];faces=[];indices=[]
        for obj in objects:
            data=obj.to_mesh();off=len(vertices);vertices.extend(obj.matrix_world @ v.co for v in data.vertices)
            for p in data.polygons:
                material=obj.data.materials[p.material_index]
                if material not in materials:materials.append(material)
                faces.append(tuple(v+off for v in p.vertices));indices.append(materials.index(material))
            obj.to_mesh_clear()
        prototypes[kind]=(vertices,faces,indices)
        for obj in objects:bpy.data.objects.remove(obj,do_unlink=True)
    vertices=[];faces=[];indices=[]
    for kind,x,y,z,scale in instances:
        vv,ff,ii=prototypes[kind];off=len(vertices)
        vertices.extend((v.x*scale+x,v.y*scale+y,v.z*scale+z) for v in vv)
        faces.extend(tuple(v+off for v in f) for f in ff);indices.extend(ii)
    obj=mesh('Batched regional trees',vertices,faces,materials[0])
    for material in materials[1:]:obj.data.materials.append(material)
    for p,index in zip(obj.data.polygons,indices):p.material_index=index

def build_world():
    global parent,grass,water,elevation,corridors
    corridors=[]
    reset(771)
    biomes=biome_materials()
    rockmat=texture_material('Stratified rock UV','rock-albedo.png',.84)
    bake_normal(rockmat,'rock-normal',.10)
    water=mat('Open water',(.018,.16,.20),.26,.18)
    shallow=mat('Turquoise shoals',(.06,.37,.39),.3,.12)
    road=mat('Packed road',(.39,.32,.21),.95)
    seaborder=mat('Sea route',(.48,.77,.77),.6)
    group('Ocean');box('Ocean',(0,0,-1.4),(660,590,.6),water,.1)
    allv=[];allf=[];land_count=0;maxheight=0
    def regional_height(region,x,y):
        cx,cy=region['center'];rx,ry=region['radius'];u=(x-cx)/rx;v=(y-cy)/ry
        key=region['key']
        low=2+1.3*math.sin(x*.09+y*.03)+.65*math.sin(x*.23)*math.cos(y*.18)
        peaks=max(h*math.exp(-((x-px)/s)**2-((y-py)/(s*1.3))**2) for px,py,h,s in region['peaks'])
        branches=3*(.5+.5*math.sin(x*.27+y*.13))*math.exp(-((u+.15)/.7)**2)
        if key=='safir':
            low=2+1.2*math.sin(x*.16+y*.09)
            peaks=round(peaks/2)*2 # Broad sandstone benches, softened by vertex normals.
        if key=='aurelien':low+=3*math.exp(-((u+.2)/.65)**4-((v-.1)/.6)**4)
        return .55+max(.1,low+peaks+branches)
    def authored_height(region,x,y):
        z=regional_height(region,x,y)
        for c in atlas['cities']:
            if c['culture']!=region['key']:continue
            cx,cy=c['position'];d=max(abs(x-cx),abs(y-cy))
            t=max(0,min(1,(d-(17 if c['rank']=='capital' else 14))/7));t=t*t*(3-2*t)
            z=regional_height(region,cx,cy)*(1-t)+z*t
        return z
    continent=atlas['landscape']['continent'];lake=atlas['landscape']['lake']
    def boundary(shape,x,y,detail):
        cx,cy=shape['center'];rx,ry=shape['radius'];u=(x-cx)/rx;v=(y-cy)/ry;a=math.atan2(v,u)
        return 1+detail*(.65*math.sin(3*a)+.35*math.sin(7*a+1.4)) - math.hypot(u,v)
    def signed_land(x,y):return min(boundary(continent,x,y,.15),-boundary(lake,x,y,.075))
    def region_at(x,y):
        wx=x+10*math.sin(y*.035)+4*math.sin(y*.17);wy=y+12*math.sin(x*.025)+6*math.sin(x*.11+y*.07)
        return min(atlas['regions'],key=lambda r:((wx-r['center'][0])/r['radius'][0])**2+((wy-r['center'][1])/r['radius'][1])**2)
    def height(x,y):
        region=region_at(x,y);z=authored_height(region,x,y)
        shore=max(0,min(1,signed_land(x,y)*15));shore=shore*shore*(3-2*shore)
        return .55+(z-.55)*shore
    # Clip a moderate triangular grid to one coast and one lake shore. Shared
    # boundary vertices keep the four material regions physically connected.
    buckets={r['key']:[] for r in atlas['regions']}
    def clip(poly):
        out=[]
        for a,b in zip(poly,poly[1:]+poly[:1]):
            da=signed_land(*a);db=signed_land(*b)
            if da>=0:out.append(a)
            if (da>=0)!=(db>=0):
                t=da/(da-db);out.append((a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t))
        return out
    step=3.5
    for row in range(136):
        y=-238+row*step
        for col in range(160):
            x=-280+col*step;a=(x,y);b=(x+step,y);c=(x+step,y+step);d=(x,y+step)
            for tri in [[a,b,c],[a,c,d]]:
                poly=clip(tri)
                if len(poly)<3:continue
                cx=sum(v[0] for v in poly)/len(poly);cy=sum(v[1] for v in poly)/len(poly)
                for k in range(1,len(poly)-1):buckets[region_at(cx,cy)['key']].append([poly[0],poly[k],poly[k+1]])
    edges={}
    for region in atlas['regions']:
        root=group('Land '+region['key']);root['regionKey']=region['key']
        vertices=[];faces=[];lookup={}
        for tri in buckets[region['key']]:
            face=[]
            for x,y in tri:
                key=(round(x,6),round(y,6))
                if key not in lookup:lookup[key]=len(vertices);vertices.append((key[0],key[1],height(*key)))
                face.append(lookup[key])
            faces.append(tuple(face))
            for a,b in zip(tri,tri[1:]+tri[:1]):
                key=tuple(sorted([(round(a[0],6),round(a[1],6)),(round(b[0],6),round(b[1],6))]));edges[key]=edges.get(key,0)+1
        terrainmat=biomes['snow' if region['key']=='vildun' else 'sand' if region['key']=='safir' else 'meadow']
        obj=mesh('Sculpted '+region['key'],vertices,faces,terrainmat);obj.data.materials.append(rockmat);uv_project(obj,global_uv=True)
        for poly in obj.data.polygons:
            z=sum(vertices[v][2] for v in poly.vertices)/len(poly.vertices);poly.material_index=1 if z>11 and poly.normal.z<.91 else 0
            for li in poly.loop_indices:
                v=obj.data.vertices[obj.data.loops[li].vertex_index].co
                obj.data.uv_layers.active.data[li].uv=(v.x/17,(v.y+v.z)/17) if poly.material_index else (v.x/35,v.y/35)
        off=len(allv);allv.extend(vertices);allf.extend(tuple(v+off for v in f) for f in faces)
        land_count+=len(vertices);maxheight=max(maxheight,max(v[2] for v in vertices))
    group('Coast and lake banks');vv=[];ff=[]
    for (a,b),count in edges.items():
        if count!=1:continue
        n=len(vv);vv.extend([(a[0],a[1],height(*a)),(b[0],b[1],height(*b)),(b[0],b[1],-1.1),(a[0],a[1],-1.1)]);ff.append((n,n+1,n+2,n+3))
    cliff=mesh('Continuous shore banks',vv,ff,rockmat);uv_project(cliff,18)
    root=group('Inland lake');root['waterBody']='inland-lake'
    cx,cy=lake['center'];rx,ry=lake['radius'];vv=[(cx,cy,-.90)]
    for i in range(160):
        a=i*math.tau/160;wave=1+.075*(.65*math.sin(3*a)+.35*math.sin(7*a+1.4))
        vv.append((cx+rx*wave*math.cos(a),cy+ry*wave*math.sin(a),-.90))
    mesh('Yunxing lake water',vv,[(0,i+1,(i+1)%160+1) for i in range(160)],water)
    surface=BVHTree.FromPolygons(allv,allf)
    def ground_height(x,y):
        hit=surface.ray_cast(Vector((x,y,100)),Vector((0,0,-1)))[0]
        return hit.z if hit is not None else -.90 if boundary(lake,x,y,.075)>0 else -1.08
    elevation=ground_height
    for route in atlas['roads']:
        group('Road '+' to '.join(route['ends']))
        ribbon('Land road',route['points'],.9,road,.13,surface_kind='land')
        if route['kind']=='ferry':ribbon('Lake ferry',route['points'],.8,seaborder,.12,True,surface_kind='water')
    rivers={
      'yunhua':[(145,47),(161,33),(162,12),(175,-4),(205,-16),(235,-23)],
      'vildun':[(-8,183),(-20,167),(-34,153),(-49,133),(-71,111)],
      'aurelien':[(-143,49),(-158,35),(-181,16),(-204,7),(-238,-2)],
      'safir':[(-34,-110),(-27,-119),(-18,-127),(-11,-135)]}
    for key,points in rivers.items():
        group('River '+key);ribbon('River channel',points,1.8,shallow,.17,surface_kind='land')
    group('Regional vegetation')
    instances=[]
    def near_corridor(x,y):
        for ax,ay,bx,by,radius in corridors:
            dx,dy=bx-ax,by-ay
            t=max(0,min(1,((x-ax)*dx+(y-ay)*dy)/(dx*dx+dy*dy)))
            if (x-ax-t*dx)**2+(y-ay-t*dy)**2<(radius+1.8)**2:return True
        return False
    for region in atlas['regions']:
        cx,cy=region['center'];rx,ry=region['radius']
        for i in range(140):
            x=cx+random.uniform(-rx*.8,rx*.8);y=cy+random.uniform(-ry*.8,ry*.8);z=ground_height(x,y)
            if z<.5 or z>13 or any(max(abs(x-c['position'][0]),abs(y-c['position'][1]))<(17 if c['rank']=='capital' else 14) for c in atlas['cities']):continue
            if near_corridor(x,y):continue
            if region['key']=='safir':
                if i%12==0:instances.append(('palm',x,y,z,.8))
            else:instances.append(('pine',x,y,z,.6 if region['key']=='aurelien' else .8))
    vegetation_mesh(instances)
    for c in atlas['cities']:
        root=group('City '+c['key']);root['cityKey']=c['key'];root['cityRank']=c['rank']
        miniature(c,root)
    for image in bpy.data.images:
        if image.source=='FILE' and image.has_data and not image.packed_file:image.pack()
    (OUT/'world-mesh-info.json').write_text(json.dumps({'terrainVertices':land_count,'regions':4,'landmasses':1,'inlandLakes':1,'maxRelief':maxheight,'cityModels':len(atlas['cities']),'uvTextures':[key+'-'+kind+'.png' for key in ['meadow','snow','sand','rock'] for kind in ['albedo','normal']]},indent=2),encoding='utf-8')
    save_scene('world',True)
