"""Compare the recovered Sprite triangle area with current alpha sampling."""
import json
import struct
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw

folder = Path('artifacts/original-chapter-comparison/2026-10-01-gray')
source = json.loads((folder / 'title-sprite-source.json').read_text(encoding='utf8'))
d = source['data']
v = d['m_RD']['m_VertexData']
assert v['m_Channels'][0] == {'stream': 0, 'offset': 0, 'format': 0, 'dimension': 3}
raw = bytes.fromhex(v['m_DataSize']['hex'])
positions = np.array([struct.unpack_from('<3f', raw, i * 12)[:2] for i in range(v['m_VertexCount'])])
w, h = int(d['m_Rect']['width']), int(d['m_Rect']['height'])
positions[:, 0] = positions[:, 0] * d['m_PixelsToUnits'] + w * d['m_Pivot']['x']
positions[:, 1] = h * (1 - d['m_Pivot']['y']) - positions[:, 1] * d['m_PixelsToUnits']
indices = np.frombuffer(bytes(d['m_RD']['m_IndexBuffer']), dtype='<u2').reshape(-1, 3)
assert indices.max() < len(positions)
assert np.isfinite(positions).all()
normalized = positions / np.array([w, h])
(folder / 'emission-mesh.json').write_text(json.dumps({
    'sourceSpritePathId': source['pathId'],
    'texturePixelsSha256': source['matchedTemplateTexturePixelsSha256'],
    'width': w, 'height': h,
    'vertices': normalized.tolist(), 'triangles': indices.tolist(),
}, indent=2) + '\n', encoding='utf8')
y, x = np.mgrid[0:h, 0:w]
pixels = np.stack((x + .5, y + .5), axis=-1)
mesh = np.zeros((h, w), dtype=bool)
area = 0.
for tri in indices:
    a, b, c = positions[tri]
    cross = lambda u, v: u[..., 0] * v[..., 1] - u[..., 1] * v[..., 0]
    signed = cross(b - a, c - a)
    area += abs(signed) / 2
    if abs(signed) < 1e-9:
        continue
    e = [cross(b - a, pixels - a), cross(c - b, pixels - b), cross(a - c, pixels - c)]
    mesh |= np.logical_and.reduce([value >= -1e-5 if signed > 0 else value <= 1e-5 for value in e])
im = Image.open('resources/templates/aihong/assets/ai_presentation_title_one.png').convert('RGBA')
assert im.size == (w, h)
alpha = np.array(im)[:, :, 3] > 80
rgb = np.full((h, w, 3), 25, dtype=np.uint8)
rgb[mesh & alpha] = [230, 230, 230]
rgb[mesh & ~alpha] = [255, 145, 45]
rgb[alpha & ~mesh] = [60, 170, 255]
canvas = Image.new('RGB', (w, h * 2 + 64), '#191919')
canvas.paste(Image.alpha_composite(Image.new('RGBA', im.size, '#eeeeee'), im).convert('RGB'), (0, 22))
canvas.paste(Image.fromarray(rgb), (0, h + 48))
draw = ImageDraw.Draw(canvas)
draw.text((5, 4), 'Original title texture', fill='white')
draw.text((5, h + 28), 'White: both | Orange: mesh only | Blue: alpha only', fill='white')
canvas.save(folder / 'emission-regions.png')
report = {'spritePathId': source['pathId'], 'vertices': len(positions), 'triangles': len(indices),
          'triangleAreaPixels': area, 'meshPixelCenters': int(mesh.sum()), 'alphaAbove80Pixels': int(alpha.sum()),
          'meshOnlyPixels': int((mesh & ~alpha).sum()), 'alphaOnlyPixels': int((alpha & ~mesh).sum()),
          'limitation': 'Compares triangle area and texture alpha, not Unity random sampling or exact runtime emission. Sprite placementMode must be interpreted before selecting a sampler.'}
(folder / 'emission-regions.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf8')
print(json.dumps(report, indent=2))
