"""Apply profile colors to exported geology using glTF-supported color multiplication.
Fast palette adjustment without rebuilding meshes. Run clearance verification afterwards.
"""
import bpy,json,sys
from pathlib import Path
root=Path(__file__).resolve().parents[2];out=root/'app/assets/dungeons'
key=sys.argv[sys.argv.index('--')+1]
p=next(p for p in json.loads((root/'scripts/blender/dungeon-profiles.json').read_text(encoding='utf-8')) if p['key']==key)
manifest=json.loads((out/(key+'.json')).read_text(encoding='utf-8'))
bpy.context.preferences.filepaths.save_version=0
for floor in manifest['floors']:
 bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
 bpy.ops.import_scene.gltf(filepath=str(out/floor['model']))
 mats={m for o in bpy.context.scene.objects if o.type=='MESH' for m in o.data.materials}
 for mat in mats:
  if not(mat.name.startswith(key+' strata') or p['theme']=='bamboo' and mat.name.startswith(key+' ground')):continue
  n=mat.node_tree.nodes;l=mat.node_tree.links;bs=n.get('Principled BSDF')
  tex=next(node for node in n if node.type=='TEX_IMAGE' and node.image.colorspace_settings.name!='Non-Color')
  # Reapply a color factor to the base texture, avoiding stacked multiplications.
  mix=n.new('ShaderNodeMix');mix.data_type='RGBA';mix.blend_type='MULTIPLY';mix.inputs[0].default_value=1;mix.inputs[7].default_value=(*p['tint'],1)
  l.new(tex.outputs['Color'],mix.inputs[6]);l.new(mix.outputs[2],bs.inputs['Base Color'])
 bpy.ops.object.select_all(action='SELECT')
 bpy.ops.export_scene.gltf(filepath=str(out/floor['model']),export_format='GLB',use_selection=True,export_extras=True,export_yup=True)
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
for i,floor in enumerate(manifest['floors']):
 bpy.ops.import_scene.gltf(filepath=str(out/floor['model']))
 for o in bpy.context.selected_objects:
  if not o.parent:o.location.z=-i*8
bpy.ops.wm.save_as_mainfile(filepath=str(out/(key+'.blend')))
print('PALETTE REFRESHED',key,flush=True)
