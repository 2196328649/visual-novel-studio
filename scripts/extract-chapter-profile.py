"""Copy the chapter effect's measured data into the engine-neutral profile."""
import hashlib
import json
from pathlib import Path

folder = Path('artifacts/aihong-chapter-source/2026-09-26T18-36-36Z')
records = json.loads((folder / 'effects.json').read_text(encoding='utf8'))
particle = next(r['data'] for r in records if r['file'] == 'sharedassets0.assets' and r['pathId'] == 1430)
initial, noise = particle['InitialModule'], particle['NoiseModule']
gradient = particle['ColorModule']['gradient']['maxGradient']
profile = {
    'source': {
        'game': 'TheLamentingGeese', 'unity': '2022.3.62f2c1',
        'assets': 'sharedassets0.assets', 'prefabPathId': 1402, 'particlePathId': 1430,
        'assetsSha256': hashlib.sha256(Path('E:/Game/GAMES/TheLamentingGeese_Data/sharedassets0.assets').read_bytes()).hexdigest(),
        'assemblySha256': json.loads((folder / 'native-source.json').read_text(encoding='utf8'))['sha256'],
        'methods': {'setInfo': '0x437490', 'startParticles': '0x4350a0', 'defaultEase': '0x588555'},
    },
    # Copied from SetInfo and its callback. All seconds are before speedUpRate=2.
    'timing': {'duration': 7, 'move': 2, 'holdTitle': .5, 'disappear': 2, 'fadeIn': 2, 'holdBackground': 3, 'fadeOut': 2, 'fadeTarget': 1.100000023841858, 'ease': 'outQuad', 'simulationSpeed': 1.5},
    'projection': {'referenceWidth': 1920, 'referenceHeight': 1080, 'cameraOrthographicSize': 5.400000095367432, 'spritePixelsPerUnit': 100},
    'particle': {
        'emissionDuration': particle['lengthInSec'], 'rate': particle['EmissionModule']['rateOverTime']['scalar'],
        'lifetime': initial['startLifetime']['scalar'], 'speedZ': initial['startSpeed']['scalar'],
        'size': [initial['startSize']['minScalar'], initial['startSize']['scalar']],
        'alpha': [[gradient['atime'+str(i)] / 65535, gradient['key'+str(i)]['a']] for i in range(gradient['m_NumAlphaKeys'])],
        'force': {axis: {'multiplier': particle['ForceModule'][axis]['scalar'], **{kind: particle['ForceModule'][axis][kind + 'Curve']['m_Curve'] for kind in ['min', 'max']}} for axis in ['x', 'y']},
        'noise': {'strength': noise['strength']['scalar'], 'frequency': noise['frequency'], 'damping': noise['damping'], 'octaves': noise['octaves']},
    },
    # TitleDisappear DXBC: saturate(gradientNoise(uv * _Scale) + .5) + _Strength.
    # TitleParticle DXBC ignores vertex alpha and uses a radial falloff instead.
    'shaders': {'title': {'pathId': 492, 'scale': .5, 'strengthFrom': 1, 'strengthTo': -1}, 'particle': {'pathId': 493, 'vertexAlpha': False, 'falloff': '1 - 2 * length(uv - .5)'}, 'ripple': {'pathId': 491, 'strength': .029999999329447746, 'speed': .05000000074505806, 'noiseScales': [5.7, 2.85, 1.425], 'noiseWeights': [.125, .25, .5], 'hash': [12.9898, 78.233002, 43758.546875]}},
}
target = Path('src/core/chapter-source.json')
target.write_text(json.dumps(profile, indent=2) + '\n', encoding='utf8')
print(str(target))
