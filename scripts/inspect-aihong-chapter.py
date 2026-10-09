"""Read the original chapter prefab, particles, materials and animation curves."""
from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path('artifacts/unity-inspect-python').resolve()))
import UnityPy

source = Path('E:/Game/GAMES/TheLamentingGeese_Data')
output = Path('artifacts/aihong-chapter-source') / datetime.now(timezone.utc).strftime('%Y-%m-%dT%H-%M-%SZ')
output.mkdir(parents=True, exist_ok=True)
environment = UnityPy.load(*(str(source / name) for name in ('globalgamemanagers.assets', 'level0', 'sharedassets0.assets', 'resources.assets')))
records = []
for obj in environment.objects:
    if obj.type.name not in {'ParticleSystem', 'ParticleSystemRenderer', 'Material', 'Shader', 'AnimationClip', 'Animator', 'AnimatorController', 'Transform'}:
        continue
    data = obj.read_typetree()
    record = {'file': Path(obj.assets_file.name).name, 'pathId': obj.path_id, 'type': obj.type.name, 'data': data}
    records.append(record)
    if obj.type.name == 'Shader':
        record['data'] = {k: v for k, v in data.items() if k not in {'compressedBlob', 'm_SubProgramBlob'}}

existing = json.loads(Path('artifacts/aihong-ui-inspection/2026-09-10-layout/objects.json').read_text(encoding='utf-8'))
by_id = {(r['file'], r['pathId']): r for r in existing + records}
prefab = []
def collect(rect_id, parent=''):
    rect = by_id[('sharedassets0.assets', rect_id)]
    go = by_id[('sharedassets0.assets', rect['data']['m_GameObject']['m_PathID'])]
    name = parent + '/' + go['data']['m_Name']
    components = [by_id.get(('sharedassets0.assets', c['component']['m_PathID'])) for c in go['data']['m_Component']]
    prefab.append({'path': name, 'gameObject': go['pathId'], 'components': [c for c in components if c]})
    for child in rect['data'].get('m_Children', []):
        collect(child['m_PathID'], name)
collect(1550)
(output / 'prefab.json').write_text(json.dumps(prefab, ensure_ascii=False, indent=2, default=str), encoding='utf-8')
(output / 'effects.json').write_text(json.dumps(records, ensure_ascii=False, indent=2, default=str), encoding='utf-8')
info = {'source': str(source), 'unityVersion': next(iter(environment.objects)).assets_file.unity_version,
        'output': str(output.resolve()), 'prefab': [{'path': n['path'], 'components': [{'id': c['pathId'], 'type': c.get('class') or c['type']} for c in n['components']]} for n in prefab],
        'effects': [{'file': r['file'], 'id': r['pathId'], 'type': r['type'], 'name': r['data'].get('m_Name', r['data'].get('m_ParsedForm', {}).get('m_Name'))} for r in records if r['type'] != 'Transform']}
(output / 'report.json').write_text(json.dumps(info, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps(info, ensure_ascii=False, indent=2))
