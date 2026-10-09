"""Read the original Texture table and export lossless gallery assets, without changing the game."""
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
import struct
import sys
import UnityPy
from PIL import Image

sys.stdout.reconfigure(encoding='utf-8')
game = Path('E:/Game/GAMES/TheLamentingGeese_Data')
output = Path('artifacts/aihong-gallery-source')
output.mkdir(parents=True, exist_ok=True)
(output / 'assets').mkdir(exist_ok=True)
env = UnityPy.load(str(game / 'sharedassets0.assets'), str(game / 'globalgamemanagers'), str(game / 'resources.assets'))
chapter = next(o for o in env.objects if o.path_id == 1621 and Path(o.assets_file.name).name == 'sharedassets0.assets')
raw = chapter.get_raw_data()
columns = ['', 'Label', 'Type', 'X', 'Y', 'Z', 'Pivot', 'Scale', 'Conditional', 'FileName', 'FileType', 'SubFileName', 'Animation', 'RenderTexture', 'RenderRect', 'Thumbnail', 'CgCategolly']

def encoded(value):
    b = value.encode('utf-8')
    return struct.pack('<i', len(b)) + b + b'\x00' * ((-len(b)) % 4)

signature = b''.join(encoded(c) for c in columns)
start = raw.find(signature)
assert start >= 12 and raw.find(signature, start + 1) == -1, 'Texture header must be unique'
pos = start - 12
grid_start = pos

def integer():
    global pos
    value = struct.unpack_from('<i', raw, pos)[0]
    pos += 4
    return value

def string():
    global pos
    count = integer()
    assert 0 <= count <= 100000 and pos + count <= len(raw), 'Invalid serialized string'
    value = raw[pos:pos + count].decode('utf-8')
    pos = (pos + count + 3) // 4 * 4
    return value

# StringGridRow serializes an index, string array, and two individually aligned flags.
# The IL2CPP-generated type tree incorrectly reports string[] as a scalar string.
count = integer()
assert 1 <= count <= 10000
rows = []
for index in range(count):
    row_index, cell_count = integer(), integer()
    assert row_index == index and 0 <= cell_count <= len(columns)
    cells = [string() for _ in range(cell_count)]
    empty, comment = integer(), integer()
    assert empty in (0, 1) and comment in (0, 1)
    rows.append(dict(rowIndex=row_index, strings=cells, isEmpty=bool(empty), isCommentOut=bool(comment)))
name = string()
assert name == 'Assets/Starveling/Starveling.xlsx:Texture' and rows[0]['strings'] == columns
(output / 'texture-grid.json').write_text(json.dumps(dict(source=str(game / 'sharedassets0.assets'), pathId=1621, offset=grid_start, name=name, rows=rows, endOffset=pos), ensure_ascii=False, indent=2), encoding='utf-8')
records = [dict(zip(columns, r['strings'])) for r in rows[1:] if not r['isEmpty'] and not r['isCommentOut']]
records = [r for r in records if r.get('Type') == 'Event' and r.get('Thumbnail')]
manager = next(o for o in env.objects if o.type.name == 'ResourceManager')
container = manager.read_typetree()['m_Container']
external = [Path(e.path.replace('\\', '/')).name for e in manager.assets_file.externals]
textures = {o.path_id: o for o in env.objects if o.type.name == 'Texture2D' and Path(o.assets_file.name).name == 'resources.assets'}
assets, groups, sources = {}, {}, {}

def reference(resource_path, label):
    resource_path = resource_path.lower()
    ids = list(dict.fromkeys(ref['m_PathID'] for key, ref in container if key == resource_path and ref['m_FileID'] and external[ref['m_FileID'] - 1] == 'resources.assets' and ref['m_PathID'] in textures))
    assert ids, f'Missing texture: {resource_path}'
    candidates = []
    for path_id in ids:
        identity = 'ai_cg_' + hashlib.sha256(f'{resource_path}:{path_id}'.encode()).hexdigest()[:16]
        assets[identity] = dict(id=identity, name=label, kind='image', category='scene', path=f'assets/{identity}.webp', resourcePath=resource_path, sourcePathId=path_id)
        candidates.append(identity)
        sources[identity] = textures[path_id]
    return dict(resourcePath=resource_path, candidates=candidates)

for record in records:
    thumb = record['Thumbnail']
    if thumb not in groups:
        groups[thumb] = dict(id='cg_' + hashlib.sha256(thumb.encode()).hexdigest()[:16], name=record['Label'], thumbnail=reference('starveling/texture/thumbnail/' + thumb, thumb + ' · 缩略图'), variants=[])
    groups[thumb]['variants'].append(dict(label=record['Label'], **reference('starveling/texture/event/' + record['FileName'], record['Label'])))

def save_image(asset, image):
    file = output / asset['path']
    pixels = hashlib.sha256(image.tobytes()).hexdigest()
    if file.exists():
        with Image.open(file) as existing:
            valid = existing.size == image.size and hashlib.sha256(existing.convert('RGBA').tobytes()).hexdigest() == pixels
    else:
        valid = False
    if not valid:
        image.save(file, 'WEBP', lossless=True, exact=True, method=3)
    with Image.open(file) as saved:
        assert hashlib.sha256(saved.convert('RGBA').tobytes()).hexdigest() == pixels, file
    return dict(asset, width=image.width, height=image.height, pixelSha256=pixels, bytes=file.stat().st_size)

exported, pending = [], []
with ThreadPoolExecutor(max_workers=3) as pool:
    for identity, asset in assets.items():
        pending.append(pool.submit(save_image, asset, sources[identity].parse_as_object().image.convert('RGBA')))
        if len(pending) >= 4:
            exported.append(pending.pop(0).result())
            if len(exported) % 25 == 0:
                print(f'Exported and pixel-verified {len(exported)} / {len(assets)}', flush=True)
    exported.extend(f.result() for f in pending)
manifest = dict(source=str(game), sourceTable=name, groupCount=len(groups), variantCount=len(records), assets=exported, groups=list(groups.values()),
    unresolved=[dict(groupId=g['id'], **ref) for g in groups.values() for ref in [g['thumbnail'], *g['variants']] if len(ref['candidates']) > 1])
(output / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps(dict(groups=len(groups), variants=len(records), assets=len(exported), bytes=sum(a['bytes'] for a in exported), unresolved=len(manifest['unresolved'])), ensure_ascii=False), flush=True)
