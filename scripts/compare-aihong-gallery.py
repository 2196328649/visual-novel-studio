"""Compare saved evidence; never captures or controls the original game."""
import json
from pathlib import Path
from PIL import Image, ImageDraw, ImageChops, ImageStat

root = sorted(p for p in Path('artifacts/aihong-gallery-page').iterdir() if (p / 'report.json').exists())[-1]
original = Path('artifacts/original-gallery-2026-10-02')
rendered = root / 'game/tests/screenshots'
rows = ['page-01.png', 'group-01-variant-01.png', 'group-01-variant-02.png', 'group-01-variant-03.png']
canvas = Image.new('RGB', (1920, len(rows) * 564), (28, 28, 28))
draw = ImageDraw.Draw(canvas)
metrics = []
for index, name in enumerate(rows):
    left = Image.open(original / name).convert('RGB').crop((1, 30, 1537, 894)).resize((960, 540), Image.Resampling.LANCZOS)
    right = Image.open(rendered / name).convert('RGB').resize((960, 540), Image.Resampling.LANCZOS)
    canvas.paste(left, (0, index * 564 + 24))
    canvas.paste(right, (960, index * 564 + 24))
    draw.text((8, index * 564 + 5), 'Original / ' + name, fill='white')
    draw.text((968, index * 564 + 5), 'Generated / ' + name, fill='white')
    metrics.append(dict(image=name, meanAbsoluteRgbError=sum(ImageStat.Stat(ImageChops.difference(left, right)).mean) / 3))
canvas.save(root / 'comparison.png')
idle = Image.open(rendered / 'page-01.png').convert('RGB')
hover = Image.open(rendered / 'hover-first-card.png').convert('RGB')
# An inset of the first thumbnail avoids frame edges and the test mouse cursor.
box = (int(idle.width * .08), int(idle.height * .37), int(idle.width * .17), int(idle.height * .44))
idle_mean = sum(ImageStat.Stat(idle.crop(box)).mean) / 3
hover_mean = sum(ImageStat.Stat(hover.crop(box)).mean) / 3
assert hover_mean > idle_mean * 1.2, (idle_mean, hover_mean)
report = dict(normalization='Original client crop (1,30,1537,894), both resized to 960x540; original cursor remains', metrics=metrics,
              hoverBrightnessRatio=hover_mean / idle_mean, limitation='Pixel metrics describe these saved views, not full-game equivalence.')
(root / 'comparison-metrics.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
print(json.dumps(dict(output=str(root), **report), indent=2))
