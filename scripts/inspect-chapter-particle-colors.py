"""Read native SetInfo color constants without changing the original game."""
import hashlib
import json
from pathlib import Path
import struct
import sys

sys.path.insert(0, str(Path('artifacts/unity-inspect-python').resolve()))
import UnityPy

source = Path('E:/Game/GAMES/GameAssembly.dll')
binary = source.read_bytes()
pe = struct.unpack_from('<I', binary, 0x3c)[0]
count = struct.unpack_from('<H', binary, pe + 6)[0]
optional_size = struct.unpack_from('<H', binary, pe + 20)[0]
sections = [struct.unpack_from('<IIII', binary, pe + 24 + optional_size + i * 40 + 8) for i in range(count)]

def rgba(rva):
    for size, va, raw_size, offset in sections:
        if va <= rva and rva + 16 <= va + raw_size:
            return list(struct.unpack_from('<4f', binary, offset + rva - va))
    raise ValueError(hex(rva))

# RIP-relative MOVAPS operands in the archived SetInfo disassembly.
branches = [('Liang', 0x437723, 0x1962796), ('Sui', 0x43771a, 0x196278f),
            ('BadEnd', 0x437711, 0x1962648), ('NormalEnd', 0x437708, 0x19626b1),
            ('TrueEnd/default', 0x4376ff, 0x196230a)]
settings_path = Path('E:/Game/GAMES/TheLamentingGeese_Data/globalgamemanagers')
settings = next(o.read_typetree() for o in UnityPy.load(str(settings_path)).objects if o.type.name == 'PlayerSettings')
scenario = json.loads(Path('artifacts/original-visual-2026-09-30/scenario-strings.json').read_text(encoding='utf8'))
first_chapter = [entry for entry in scenario if 13296 <= entry['offset'] <= 13376]
assert [entry['text'] for entry in first_chapter] == ['ChapterAnimation', 'BG_Ji_1', 'chapter_bg_J', 'chapter_title_J1', 'Liang', '265']
def shader_rgb(value):
    return 12.923210 * value if value <= .003131 else 1.055 * abs(value) ** .416667 - .055
result = {
    'source': str(source), 'sha256': hashlib.sha256(binary).hexdigest(),
    'materialChain': 'prefab shader_particle=493 -> field 0x40 -> Material ctor 0x4376af -> particle Renderer.SetMaterial 0x4376df -> Material.set_color 0x437742',
    'colors': [{'type': name, 'instruction': hex(pc), 'constantRva': hex(pc + 7 + displacement),
                'rgba': rgba(pc + 7 + displacement)} for name, pc, displacement in branches],
    'firstChapterScenario': first_chapter,
    'playerSettings': {'file': str(settings_path), 'sha256': hashlib.sha256(settings_path.read_bytes()).hexdigest(), 'm_ActiveColorSpace': settings['m_ActiveColorSpace']},
    'liangShaderRgbForGammaProject': [shader_rgb(v) for v in rgba(0x1d99ec0)[:3]],
    'limitation': 'Gamma project (color space 0), shader explicitly converts input RGB. This establishes source color arithmetic, not a screenshot match or particle timing.',
}
target = Path('artifacts/original-chapter-comparison/2026-10-01/particle-material.json')
target.write_text(json.dumps(result, indent=2) + '\n', encoding='utf8')
print(json.dumps(result, indent=2))
