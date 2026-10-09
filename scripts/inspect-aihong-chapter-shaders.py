"""Read the shipped Direct3D programs; keep disassembly as local provenance."""
import ctypes
import hashlib
import json
import struct
from pathlib import Path
import sys

sys.path.insert(0, str(Path('artifacts/unity-inspect-python').resolve()))
import UnityPy
from UnityPy.helpers import CompressionHelper

folder = Path('artifacts/aihong-chapter-source/2026-09-26T18-36-36Z')
source = Path('E:/Game/GAMES/TheLamentingGeese_Data/sharedassets0.assets')
env = UnityPy.load(str(source))
dll = ctypes.WinDLL('d3dcompiler_47.dll')
dll.D3DDisassemble.argtypes = [ctypes.c_void_p, ctypes.c_size_t, ctypes.c_uint, ctypes.c_char_p, ctypes.POINTER(ctypes.c_void_p)]
dll.D3DDisassemble.restype = ctypes.c_long

def disassemble(code):
    start = code.find(b'DXBC')
    if start < 0: return '// No DXBC program'
    code = code[start:start + struct.unpack_from('<I', code, start + 24)[0]]
    blob = ctypes.c_void_p()
    result = dll.D3DDisassemble(code, len(code), 0, None, ctypes.byref(blob))
    if result < 0:
        (folder / 'failed-program.dxbc').write_bytes(code)
        raise RuntimeError(f'{hex(result & 0xffffffff)}: {len(code)} bytes, header={code[:64].hex()}')
    table = ctypes.cast(blob, ctypes.POINTER(ctypes.POINTER(ctypes.c_void_p))).contents
    pointer = ctypes.WINFUNCTYPE(ctypes.c_void_p, ctypes.c_void_p)(table[3])(blob)
    size = ctypes.WINFUNCTYPE(ctypes.c_size_t, ctypes.c_void_p)(table[4])(blob)
    text = ctypes.string_at(pointer, size).decode('utf8').rstrip('\0')
    ctypes.WINFUNCTYPE(ctypes.c_ulong, ctypes.c_void_p)(table[2])(blob)
    return text

report = []
for obj in env.objects:
    if obj.type.name != 'Shader' or obj.path_id not in (491, 492, 493): continue
    shader = obj.read()
    name = shader.m_ParsedForm.m_Name.split('/')[-1]
    take = lambda values, i: values[i][0] if isinstance(values[i], list) else values[i]
    blob = bytes(shader.compressedBlob)
    programs = []
    for i, platform in enumerate(shader.platforms):
        if i >= len(shader.offsets): break
        offset, size = take(shader.offsets, i), take(shader.compressedLengths, i)
        raw = CompressionHelper.decompress_lz4(blob[offset:offset+size], take(shader.decompressedLengths, i))
        cursor = 0
        while True:
            start = raw.find(b'DXBC', cursor)
            if start < 0: break
            length = struct.unpack_from('<I', raw, start + 24)[0]
            code = raw[start:start + length]
            cursor = start + length
            if any(p['sha256'] == hashlib.sha256(code).hexdigest() for p in programs): continue
            filename = f'{name}-{platform}-offset{start}.txt'
            (folder / filename).write_text(disassemble(code), encoding='utf8')
            programs.append({'file': filename, 'offset': start, 'bytes': length, 'sha256': hashlib.sha256(code).hexdigest()})
    report.append({'name': name, 'pathId': obj.path_id, 'programs': programs})
(folder / 'shader-programs.json').write_text(json.dumps(report, indent=2), encoding='utf8')
print(json.dumps(report, indent=2))
