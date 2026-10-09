import assert from 'node:assert/strict';

/** Read PE resources from the distributed EXE, rather than trusting a sidecar ICO. */
export function executableIcons(bytes: Buffer): { id: number; data: Buffer }[] {
  const pe = bytes.readUInt32LE(0x3c); assert.equal(bytes.toString('ascii', pe, pe + 4), 'PE\0\0');
  const count = bytes.readUInt16LE(pe + 6), optionalSize = bytes.readUInt16LE(pe + 20), optional = pe + 24;
  const directory = optional + (bytes.readUInt16LE(optional) === 0x20b ? 112 : 96);
  const resourceRva = bytes.readUInt32LE(directory + 16);
  const sections = Array.from({ length: count }, (_, i) => {
    const at = optional + optionalSize + i * 40;
    return { rva: bytes.readUInt32LE(at + 12), size: Math.max(bytes.readUInt32LE(at + 8), bytes.readUInt32LE(at + 16)), raw: bytes.readUInt32LE(at + 20) };
  });
  const offset = (rva: number) => { const section = sections.find(s => rva >= s.rva && rva < s.rva + s.size); assert.ok(section); return section.raw + rva - section.rva; };
  const root = offset(resourceRva), images: { id: number; data: Buffer }[] = [];
  const walk = (relative: number, ids: number[]) => {
    assert.ok(ids.length <= 3);
    const at = root + relative, entries = bytes.readUInt16LE(at + 12) + bytes.readUInt16LE(at + 14);
    for (let i = 0; i < entries; i++) {
      const e = at + 16 + i * 8, id = bytes.readUInt32LE(e), value = bytes.readUInt32LE(e + 4), next = [...ids, id];
      if (value & 0x80000000) walk(value & 0x7fffffff, next);
      else if (next[0] === 3) { const data = root + value, start = offset(bytes.readUInt32LE(data)); images.push({ id: next[1], data: bytes.subarray(start, start + bytes.readUInt32LE(data + 4)) }); }
    }
  };
  walk(0, []); assert.ok(images.length); return images;
}

export function verifyExecutableIcon(executable: Buffer, ico: Buffer) {
  const images = executableIcons(executable), entries = ico.readUInt16LE(4), sizes: number[] = [];
  for (let i = 0; i < entries; i++) {
    const at = 6 + i * 16, size = ico.readUInt32LE(at + 8), offset = ico.readUInt32LE(at + 12);
    assert.ok(images.some(image => image.data.equals(ico.subarray(offset, offset + size))), `EXE is missing the authored ${ico[at] || 256}px icon`);
    sizes.push(ico[at] || 256);
  }
  return { sizes, largest: images.sort((a, b) => b.data.length - a.data.length)[0].data };
}
