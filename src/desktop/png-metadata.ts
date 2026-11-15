import { PNG } from 'pngjs';
import { visibleImageBounds } from '../core/image-bounds';

/** Some exported PNGs append metadata after IEND. Keep the original asset bytes,
 * but give the decoder only the complete PNG stream; CRC checks still apply. */
function pngStream(bytes: Buffer) {
  for (let offset = 8; offset + 12 <= bytes.length;) {
    const length = bytes.readUInt32BE(offset), end = offset + length + 12;
    if (end > bytes.length) break;
    if (length === 0 && bytes.toString('ascii', offset + 4, offset + 8) === 'IEND') return bytes.subarray(0, end);
    offset = end;
  }
  return bytes;
}

export function pngMetadata(bytes: Buffer) {
  const png = PNG.sync.read(pngStream(bytes));
  return { width: png.width, height: png.height, visibleBounds: visibleImageBounds(png.data, png.width, png.height) };
}

export type PngMetadata = ReturnType<typeof pngMetadata>;
