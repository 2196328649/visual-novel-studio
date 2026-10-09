"""Recover the original title skeleton, atlas, and exact material texture."""
from pathlib import Path
import hashlib
import json
import sys

sys.stdout.reconfigure(encoding='utf-8')
sys.path.insert(0, str(Path('artifacts/unity-inspect-python').resolve()))
import UnityPy
from UnityPy.helpers.TypeTreeGenerator import TypeTreeGenerator

game = Path('E:/Game/GAMES/TheLamentingGeese_Data')
output = Path('artifacts/aihong-spine')
output.mkdir(parents=True, exist_ok=True)
env = UnityPy.load(str(game / 'sharedassets0.assets'))
generator = TypeTreeGenerator('2022.3.62f2c1', 'AssetsTools')
generator.load_local_game(str(game.parent))
assemblies = set(generator.get_loaded_dll_names())
get_nodes = generator.get_nodes
generator.get_nodes = lambda assembly, name: get_nodes(assembly.removesuffix('.dll') if assembly not in assemblies and assembly.removesuffix('.dll') in assemblies else assembly, name)
env.typetree_generator = generator
objects = {obj.path_id: obj for obj in env.objects if Path(obj.assets_file.name).name == 'sharedassets0.assets'}

def typed(path_id):
    obj = objects[path_id]
    return obj.read_typetree(nodes=obj.generate_monobehaviour_node())

def text(path_id):
    return objects[path_id].parse_as_object().m_Script

skeleton_data = typed(1620)
atlas_data = typed(skeleton_data['atlasAssets'][0]['m_PathID'])
skeleton = json.loads(text(skeleton_data['skeletonJSON']['m_PathID']))
atlas = text(atlas_data['atlasFile']['m_PathID'])
material = objects[atlas_data['materials'][0]['m_PathID']].read_typetree()
properties = material['m_SavedProperties']['m_TexEnvs']
main = next(value for key, value in properties if key == '_MainTex')
texture_id = main['m_Texture']['m_PathID']
texture = objects[texture_id].parse_as_object()
image = texture.image
image.save(output / '1.png')
# Export only relative artifact paths. The skeleton's source workstation path
# is not required to render its attachment names against the atlas.
skeleton['skeleton'].pop('images', None)
skeleton['skeleton'].pop('audio', None)
(output / 'skeleton.json').write_text(json.dumps(skeleton, ensure_ascii=False), encoding='utf-8')
(output / 'skeleton.atlas').write_text(atlas, encoding='utf-8')
pages = json.loads(Path('artifacts/aihong-ui-inspection/2026-09-10-layout/ui-pages.json').read_text(encoding='utf-8'))
node = next(node for page in pages if page['name'] == '标题' for node in page['nodes'] if node['path'].endswith('/BG/Spine'))
graphic = next(c['data'] for c in node['components'] if c.get('component') == 'Spine.Unity.SkeletonGraphic')
report = {'source': str(game), 'skeletonData': skeleton_data, 'skeletonGraphic': graphic, 'rectangle': node['rectangle'], 'spineVersion': skeleton['skeleton']['spine'], 'texture': {'file': 'sharedassets0.assets', 'pathId': texture_id, 'name': texture.m_Name, 'size': image.size}, 'animations': list(skeleton.get('animations', {})), 'files': {name: hashlib.sha256((output / name).read_bytes()).hexdigest() for name in ['1.png', 'skeleton.json', 'skeleton.atlas']}}
(output / 'source.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps({'output': str(output.resolve()), 'spineVersion': report['spineVersion'], 'texture': report['texture'], 'animations': report['animations'], 'graphic': {k: v for k, v in graphic.items() if any(word in k.lower() for word in ['scale', 'size', 'animation', 'pixel'])}}, ensure_ascii=False, indent=2))
