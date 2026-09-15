"""Bake the authored fine-ground albedo into a restrained tangent normal atlas."""
import bpy
from pathlib import Path
out=Path(__file__).resolve().parents[2]/'app/assets/dungeons'
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=1
mat=bpy.data.materials.new('Ground relief bake');mat.use_nodes=True;n=mat.node_tree.nodes;l=mat.node_tree.links
tex=n.new('ShaderNodeTexImage');tex.image=bpy.data.images.load(str(out/'ground-atlas.png'))
bump=n.new('ShaderNodeBump');bump.inputs['Distance'].default_value=.018;l.new(tex.outputs['Color'],bump.inputs['Height']);l.new(bump.outputs[0],n.get('Principled BSDF').inputs['Normal'])
image=bpy.data.images.new('Fine ground normal',1024,1024);target=n.new('ShaderNodeTexImage');target.image=image;n.active=target
bpy.ops.mesh.primitive_plane_add(size=2);bpy.context.object.data.materials.append(mat)
scene.render.bake.margin=8;bpy.ops.object.bake(type='NORMAL');image.filepath_raw=str(out/'ground-normal.png');image.file_format='PNG';image.save()
