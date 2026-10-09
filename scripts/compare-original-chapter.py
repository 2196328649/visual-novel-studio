"""Compare archived Unity captures with current native chapter samples; not a pass/fail gate."""
import argparse
import json
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw

parser = argparse.ArgumentParser()
parser.add_argument('native', type=Path)
parser.add_argument('output', type=Path)
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
original = root / 'artifacts/original-visual-2026-09-30'
args.output.mkdir(parents=True, exist_ok=True)
samples = json.loads((original / 'title-start-samples.json').read_text(encoding='utf-8-sig'))[:7]
native_report = json.loads((args.native / 'report.json').read_text(encoding='utf-8-sig'))
times = np.array([row['time'] for row in native_report['comparisons']])
size = (960, 540)
# Observed archived window bounds: title bar y=0..28, right/bottom border at 1097/646.
original_images = [Image.open(original / row['file']).convert('RGB').crop((0, 29, 1097, 646)).resize(size, Image.Resampling.LANCZOS) for row in samples]
native_images = [Image.open(args.native / f'game/tests/screenshots/{i}-composition.png').convert('RGB').resize(size, Image.Resampling.LANCZOS) for i in range(len(times))]
a = np.array(original_images, dtype=np.float32)
b = np.array(native_images, dtype=np.float32)
mask = np.ones((size[1], size[0]), dtype=bool)
mask[440:540, 105:235] = False  # Original cursor and its blue glow are not chapter content.
errors = np.array([[np.abs(left - right)[mask].mean() for right in b] for left in a])
offsets = []
for offset in np.arange(0, 3.001, .01):
    indices = [int(np.argmin(np.abs(times - (row['elapsed'] - offset)))) for row in samples]
    score = float(np.mean([errors[i, j] for i, j in enumerate(indices)]))
    offsets.append((score, float(offset), indices))
score, offset, indices = min(offsets, key=lambda row: row[0])
rows = []
for i, (sample, j) in enumerate(zip(samples, indices)):
    diff = np.abs(a[i] - b[j])
    rows.append({**sample, 'nativeTime': float(times[j]), 'estimatedInternalTime': round(sample['elapsed'] - offset, 3), 'meanChannelError': float(diff[mask].mean()), 'titleRegionError': float(diff[215:350, :520].mean()), 'backgroundRegionError': float(diff[60:500, 540:900].mean())})
selected = [1, 2, 3, 4, 5]
canvas = Image.new('RGB', (size[0] * 2, (size[1] + 30) * len(selected)), '#202020')
draw = ImageDraw.Draw(canvas)
for row, index in enumerate(selected):
    y = row * (size[1] + 30)
    draw.text((8, y + 7), f"Unity capture: {samples[index]['elapsed']:.3f}s after menu click", fill='white')
    draw.text((size[0] + 8, y + 7), f'RenPy composition: {times[indices[index]]:.2f}s internal time', fill='white')
    canvas.paste(original_images[index], (0, y + 30))
    canvas.paste(native_images[indices[index]], (size[0], y + 30))
canvas.save(args.output / 'comparison.png')
report = {'status': 'observational-comparison', 'original': str(original), 'native': str(args.native.resolve()), 'crop': [0, 29, 1097, 646], 'comparisonSize': size, 'estimatedClickToAnimationOffset': offset, 'meanChannelError': score, 'limitations': ['Offset is fitted to sparse frames, not a measured animation start.', 'Unity random seed, cursor and capture scaling differ.', 'No pixel-identity or full-game fidelity claim.'], 'frames': rows}
(args.output / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps(report, ensure_ascii=False, indent=2))
