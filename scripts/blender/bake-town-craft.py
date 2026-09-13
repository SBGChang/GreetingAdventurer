"""Bake the shared close-view atlas normal once before authoring the towns."""
from pathlib import Path
script=Path(__file__).with_name('build-town.py')
exec(compile(script.read_text(encoding='utf-8').split("group('Town foundations')")[0],str(script),'exec'))
OUT=ROOT/'app/assets/geography'
script=Path(__file__).with_name('world-surface.py')
exec(compile(script.read_text(encoding='utf-8').split('def uv_project')[0],str(script),'exec'))
script=Path(__file__).with_name('town-craft.py')
exec(compile(script.read_text(encoding='utf-8'),str(script),'exec'))
bake_normal(craft_mats[0],'town-craft-normal',.012,'Craft UV',2048)
