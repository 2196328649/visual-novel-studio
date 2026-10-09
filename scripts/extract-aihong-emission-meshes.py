"""Read original Sprite geometry, requiring an exact template texture match (Python 3.12)."""
import hashlib
import json
from pathlib import Path
import struct
import sys

sys.path.insert(0, str(Path('artifacts/unity-inspect-python').resolve()))
import UnityPy
from PIL import Image

source = Path('E:/Game/GAMES/TheLamentingGeese_Data/resources.assets')
env = UnityPy.load(str(source))
objects = {obj.path_id: obj for obj in env.objects}
results = []
for suffix, sprite, filename in [('one', 'chapter_title_J1', 'aihong-title-mesh.json'), ('two', 'chapter_title_J2', 'aihong-title-two-mesh.json')]:
    asset_id = 'ai_presentation_title_' + suffix
    image = Image.open(f'resources/templates/aihong/assets/{asset_id}.png').convert('RGBA')
    matches = []
    for obj in env.objects:
        if obj.type.name != 'Sprite':
            continue
        data = obj.read_typetree()
        if data.get('m_Name') != sprite:
            continue
        texture = objects[data['m_RD']['texture']['m_PathID']].read().image.convert('RGBA')
        if texture.size == image.size and texture.tobytes() == image.tobytes():
            matches.append((obj.path_id, data))
    assert len(matches) == 1, (asset_id, len(matches))
    path_id, data = matches[0]
    w, h = image.size
    assert data['m_Rect'] == {'x': 0., 'y': 0., 'width': float(w), 'height': float(h)}
    vertex = data['m_RD']['m_VertexData']
    assert vertex['m_Channels'][0] == {'stream': 0, 'offset': 0, 'format': 0, 'dimension': 3}
    points = [struct.unpack_from('<3f', vertex['m_DataSize'], i * 12) for i in range(vertex['m_VertexCount'])]
    vertices = [[x * data['m_PixelsToUnits'] / w + data['m_Pivot']['x'], 1 - data['m_Pivot']['y'] - y * data['m_PixelsToUnits'] / h] for x, y, z in points]
    raw = bytes(data['m_RD']['m_IndexBuffer'])
    triangles = [list(struct.unpack_from('<3H', raw, i)) for i in range(0, len(raw), 6)]
    assert all(index < len(vertices) for triangle in triangles for index in triangle)
    mesh = {'vertices': vertices, 'triangles': triangles}
    Path('scripts/lib', filename).write_text(json.dumps(mesh, indent=2) + '\n', encoding='utf8')
    results.append({'assetId': asset_id, 'sprite': sprite, 'pathId': path_id, 'textureSize': [w, h], 'texturePixelsSha256': hashlib.sha256(image.tobytes()).hexdigest(), 'vertices': len(vertices), 'triangles': len(triangles)})
target = Path('artifacts/original-chapter-comparison/emission-mesh-extraction.json')
target.write_text(json.dumps({'source': str(source), 'sourceSha256': hashlib.sha256(source.read_bytes()).hexdigest(), 'matches': results}, indent=2) + '\n', encoding='utf8')
print(json.dumps(results, indent=2))
