"""Locate chapter animation commands in the original serialized scenario, read only."""
import json
from pathlib import Path
import sys
import struct

sys.path.insert(0, str(Path('artifacts/unity-inspect-python').resolve()))
import UnityPy

source = Path('E:/Game/GAMES/TheLamentingGeese_Data/sharedassets0.assets')
env = UnityPy.load(str(source))
results = []
for obj in env.objects:
    if obj.path_id not in (1621, 1626, 1627):
        continue
    raw = obj.get_raw_data()
    if obj.path_id == 1626:
        strings = []
        for pos in range(0, len(raw)-4, 4):
            size = struct.unpack_from('<I', raw, pos)[0]
            if not 1 <= size <= 2000 or pos+4+size > len(raw):
                continue
            try:
                value = raw[pos+4:pos+4+size].decode('utf-8')
                if all(c.isprintable() or c in '\n\r\t' for c in value):
                    strings.append({'offset': pos, 'text': value})
            except UnicodeDecodeError:
                pass
        Path('artifacts/original-visual-2026-09-30/scenario-strings.json').write_text(json.dumps(strings, ensure_ascii=False), encoding='utf-8')
    matches = []
    for term in ('TitleAnimation', '我患了一种病', '醉梦'):
        needle = term.encode('utf-8')
        offset = 0
        while (offset := raw.find(needle, offset)) >= 0:
            matches.append({'term': term, 'offset': offset, 'context': raw[max(0, offset-180):offset+360].decode('utf-8', errors='replace')})
            offset += len(needle)
    results.append({'id': obj.path_id, 'bytes': len(raw), 'matches': matches})
output = Path('artifacts/original-visual-2026-09-30/scenario-trigger-search.json')
output.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps([{'id': r['id'], 'bytes': r['bytes'], 'matches': len(r['matches'])} for r in results]))
print(output)
