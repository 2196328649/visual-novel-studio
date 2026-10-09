"""Annotate native title animation code using a fresh local IL2CPP method map."""
import bisect
import hashlib
import json
import math
from pathlib import Path
import struct
import sys

sys.path.insert(0, str(Path('artifacts/chapter-analysis-python').resolve()))
from capstone import Cs, CS_ARCH_X86, CS_MODE_64, x86_const

folder = Path('artifacts/aihong-chapter-source/2026-09-26T18-36-36Z')
data = json.loads((folder / 'dumper/script.json').read_text(encoding='utf-8-sig'))
source = Path('E:/Game/GAMES/GameAssembly.dll')
binary = source.read_bytes()
pe = struct.unpack_from('<I', binary, 0x3c)[0]
count, opt_size = struct.unpack_from('<H', binary, pe + 6)[0], struct.unpack_from('<H', binary, pe + 20)[0]
base = struct.unpack_from('<Q', binary, pe + 24 + 24)[0]
sections = [struct.unpack_from('<IIII', binary, pe + 24 + opt_size + i * 40 + 8) for i in range(count)]
def read(rva, length):
    for size, va, raw_size, offset in sections:
        if va <= rva < va + max(size, raw_size):
            return binary[offset + rva - va:offset + rva - va + length]
    return b''

names = {}
for item in data.get('ScriptMethod', []): names.setdefault(item['Address'], []).append(item['Name'])
symbols = {item['Address']: item.get('Name', item.get('Value', '')) for key in ['ScriptMetadata', 'ScriptMetadataMethod', 'ScriptString'] for item in data.get(key, []) if 'Address' in item}
addresses = sorted(names)
decoder = Cs(CS_ARCH_X86, CS_MODE_64)
decoder.detail = True
selected = [item for item in data['ScriptMethod'] if 'UI_TitleAnimation' in item['Name']]
if len(sys.argv) > 1:
    selected += [item for item in data['ScriptMethod'] if any(term in item['Name'] for term in sys.argv[1:])]
result = []
for item in selected:
    address = item['Address']
    after = bisect.bisect_right(addresses, address)
    end = addresses[after] if after < len(addresses) else address + 4096
    result.append('\n' + item['Name'] + ' ' + hex(address))
    for ins in decoder.disasm(read(address, min(end - address, 65536)), base + address):
        notes = []
        for operand in ins.operands:
            if operand.type == x86_const.X86_OP_IMM and ins.mnemonic in ['call', 'jmp']:
                aliases = names.get(operand.imm - base, [])
                notes.extend(name[:180] for name in aliases[:3])
                if len(aliases) > 3: notes.append(f'({len(aliases)} shared aliases)')
            if operand.type == x86_const.X86_OP_MEM and operand.mem.base == x86_const.X86_REG_RIP:
                target = ins.address + ins.size + operand.mem.disp - base
                if target in symbols: notes.append(str(symbols[target])[:200])
                value = read(target, 4)
                if len(value) == 4:
                    number = struct.unpack('<f', value)[0]
                    if number == 0 or 0.00001 <= abs(number) < 100000: notes.append('float=' + str(number))
        result.append(f'{ins.address-base:08x}  {ins.mnemonic:8} {ins.op_str:54}' + (' ; ' + ' | '.join(notes) if notes else ''))
(folder / 'title-disassembly.txt').write_text('\n'.join(result), encoding='utf-8')
(folder / 'native-source.json').write_text(json.dumps({'file': str(source), 'sha256': hashlib.sha256(binary).hexdigest(), 'methods': selected}, indent=2), encoding='utf-8')
print(str(folder / 'title-disassembly.txt'))
