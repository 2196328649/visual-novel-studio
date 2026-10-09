"""Export referenced UI sprites/fonts from the user's local game, without changing it.

UnityPy handles atlas rotation and tight sprite meshes. Transparent trimmed
margins are restored to the logical sprite rectangle so button states line up.
This is a local template preparation tool, not a dependency of the editor.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import sys


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--game-data', type=Path, default=Path('E:/Game/GAMES/TheLamentingGeese_Data'))
    parser.add_argument('--metadata', type=Path, default=Path('artifacts/aihong-ui-inspection/2026-09-10-layout'))
    parser.add_argument('--dependencies', type=Path, default=Path('artifacts/unity-inspect-python'))
    parser.add_argument('--output', type=Path, default=Path('artifacts/aihong-ui-assets'))
    args = parser.parse_args()
    sys.stdout.reconfigure(encoding='utf-8')
    sys.path.insert(0, str(args.dependencies.resolve()))
    import UnityPy
    from PIL import Image, ImageDraw, ImageFont

    summary = json.loads((args.metadata / 'summary.json').read_text(encoding='utf-8'))
    records = json.loads((args.metadata / 'objects.json').read_text(encoding='utf-8'))
    pages = json.loads((args.metadata / 'ui-pages.json').read_text(encoding='utf-8'))
    by_id = {(r['file'], r['pathId']): r for r in records}

    def ref(file, ptr):
        if not isinstance(ptr, dict) or not ptr.get('m_PathID'):
            return None
        if ptr.get('m_FileID'):
            externals = summary['files'][file]['externals']
            index = ptr['m_FileID'] - 1
            if not 0 <= index < len(externals):
                return None
            file = externals[index].replace('\\', '/').split('/')[-1]
        return by_id.get((file, ptr['m_PathID']))

    needed = set()

    def add_refs(file, value):
        if isinstance(value, dict):
            if 'm_PathID' in value:
                target = ref(file, value)
                if target and target['type'] == 'Sprite':
                    needed.add((target['file'], target['pathId']))
            elif value.get('type') == 'Sprite' and 'pathId' in value:
                needed.add((value['file'], value['pathId']))
            else:
                for v in value.values():
                    add_refs(file, v)
        elif isinstance(value, list):
            for v in value:
                add_refs(file, v)

    for page in pages:
        for node in page['nodes']:
            add_refs(node['file'], node['components'])
    # Include the common gallery shell, selectors, and title background variants.
    # Some are referenced by a controller instead of the UI.Image itself.
    for record in records:
        # Sliders and dropdowns keep pressed/selected pictures on the controller,
        # not on the Image node included in the page summary.
        if record['type'] == 'MonoBehaviour':
            add_refs(record['file'], record['data'])
        if record['type'] == 'Sprite' and record['data'].get('m_Name', '').startswith(('extra_', 'title_', 'dialog_', 'save_', 'system_', 'config_', 'sys_')):
            needed.add((record['file'], record['pathId']))
        if record['type'] == 'Font' and record['data'].get('fontBytes', 0):
            needed.add((record['file'], record['pathId']))

    environment = UnityPy.load(*(str(args.game_data / file) for file in summary['files'] if (args.game_data / file).is_file()))
    readers = {(Path(o.assets_file.name).name, o.path_id): o for o in environment.objects}
    output = args.output.resolve()
    (output / 'assets').mkdir(parents=True, exist_ok=True)
    assets, errors = [], []
    for key in sorted(needed):
        record = by_id[key]
        name = record['data'].get('m_Name', '')
        asset_id = 'ai_ui_' + hashlib.sha256(f'{key[0]}:{key[1]}'.encode()).hexdigest()[:16]
        try:
            obj = readers[key].parse_as_object()
            entry = {'id': asset_id, 'name': name, 'source': {'file': key[0], 'pathId': key[1]}}
            if record['type'] == 'Font':
                raw = bytes(obj.m_FontData)
                suffix = '.otf' if raw[:4] == b'OTTO' else '.ttf'
                entry.update(kind='font', path=f'assets/{asset_id}{suffix}')
                (output / entry['path']).write_bytes(raw)
            else:
                sprite = obj.image.convert('RGBA')
                logical = (round(obj.m_Rect.width), round(obj.m_Rect.height))
                offset = obj.m_RD.textureRectOffset
                entry.update(kind='image', path=f'assets/{asset_id}.png', width=logical[0], height=logical[1])
                entry['source'].update(decodedSize=list(sprite.size), trimOffset=[offset.x, offset.y], border=record['data'].get('m_Border'))
                if sprite.size != logical:
                    left = round(offset.x)
                    top = logical[1] - round(offset.y) - sprite.height
                    if left < -1 or top < -1 or left + sprite.width > logical[0] + 1 or top + sprite.height > logical[1] + 1:
                        raise ValueError(f'Unexpected trimmed sprite bounds: {sprite.size} + {(left, top)} in {logical}')
                    padded = Image.new('RGBA', logical)
                    padded.paste(sprite, (left, top))
                    sprite = padded
                sprite.save(output / entry['path'])
            entry['sha256'] = hashlib.sha256((output / entry['path']).read_bytes()).hexdigest()
            assets.append(entry)
        except Exception as error:
            errors.append({'file': key[0], 'pathId': key[1], 'name': name, 'error': str(error)})

    manifest = {'source': str(args.game_data.resolve()), 'metadata': str(args.metadata.resolve()), 'assets': assets, 'errors': errors}
    (output / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
    selected = [a for a in assets if a['kind'] == 'image' and (a['name'].startswith(('title_button_', 'dialog_menu_button_')) or a['name'] in ('封面', 'title_logo_a', 'dialog_bg_yi'))]
    cell_w, cell_h, cols = 400, 150, 4
    sheet = Image.new('RGB', (cols * cell_w, ((len(selected) + cols - 1) // cols) * cell_h), '#d2cfbd')
    draw = ImageDraw.Draw(sheet)
    font = ImageFont.truetype('C:/Windows/Fonts/msyh.ttc', 15)
    for index, a in enumerate(selected):
        x, y = (index % cols) * cell_w, (index // cols) * cell_h
        im = Image.open(output / a['path']).convert('RGBA')
        im.thumbnail((cell_w - 20, cell_h - 42))
        sheet.paste(im, (x + (cell_w - im.width) // 2, y + 6), im)
        draw.text((x + 8, y + cell_h - 33), a['name'], font=font, fill='#151713')
        draw.text((x + 8, y + cell_h - 17), str(a['source']['pathId']), font=font, fill='#484b42')
    sheet.save(output / 'button-contact-sheet.png')
    print(json.dumps({'output': str(output), 'assets': len(assets), 'images': sum(a['kind'] == 'image' for a in assets), 'fonts': sum(a['kind'] == 'font' for a in assets), 'errors': errors}, ensure_ascii=False, indent=2))
    if errors:
        raise SystemExit(1)


if __name__ == '__main__':
    main()
