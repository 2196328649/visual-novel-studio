import { promises as fs } from 'node:fs';
import { Readable } from 'node:stream';
import path from 'node:path';

function contentType(header: Buffer, file: string): string {
  if (header.subarray(0, 4).equals(Buffer.from([0, 1, 0, 0]))) return 'font/ttf';
  if (header.toString('ascii', 0, 4) === 'OTTO') return 'font/otf';
  if (header.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) return 'video/webm';
  if (header.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (header[0] === 255 && header[1] === 216 && header[2] === 255) return 'image/jpeg';
  if (header.toString('ascii', 0, 4) === 'RIFF') {
    if (header.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
    if (header.toString('ascii', 8, 12) === 'WAVE') return 'audio/wav';
  }
  if (header.toString('ascii', 4, 8) === 'ftyp' && /avif|avis/.test(header.toString('ascii', 8))) return 'image/avif';
  if (header.toString('ascii', 4, 8) === 'ftyp') return 'video/mp4';
  if (header.toString('ascii', 0, 4) === 'OggS') return 'audio/ogg';
  if (header.toString('ascii', 0, 4) === 'fLaC') return 'audio/flac';
  if (header.toString('ascii', 0, 3) === 'ID3' || (header[0] === 255 && (header[1] & 224) === 224)) return 'audio/mpeg';
  if (path.extname(file).toLowerCase() === '.svg') return 'image/svg+xml';
  return 'application/octet-stream';
}

export async function assetResponse(file: string, request: Request): Promise<Response> {
  const handle = await fs.open(file, 'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error('The asset is not a file.');
    const header = Buffer.alloc(Math.min(64, stat.size));
    await handle.read(header, 0, header.length, 0);
    const headers = new Headers({
      'Content-Type': contentType(header, file),
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Expose-Headers': 'Accept-Ranges, Content-Length, Content-Range',
    });
    let start = 0;
    let end = stat.size - 1;
    const range = request.headers.get('range');
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
      const suffix = match && !match[1] ? Number(match[2]) : undefined;
      start = suffix !== undefined ? Math.max(0, stat.size - suffix) : Number(match?.[1]);
      end = suffix !== undefined || !match?.[2] ? stat.size - 1 : Math.min(Number(match[2]), stat.size - 1);
      if (!match || (!match[1] && !match[2]) || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || start >= stat.size || suffix === 0) {
        headers.set('Content-Range', `bytes */${stat.size}`);
        headers.set('Content-Length', '0');
        await handle.close();
        return new Response(null, { status: 416, headers });
      }
      headers.set('Content-Range', `bytes ${start}-${end}/${stat.size}`);
    }
    headers.set('Content-Length', String(Math.max(0, end - start + 1)));
    if (request.method === 'HEAD' || stat.size === 0) {
      await handle.close();
      return new Response(null, { status: range ? 206 : 200, headers });
    }
    // FileHandle's stream closes the descriptor when playback completes or cancels.
    const body = Readable.toWeb(handle.createReadStream({ start, end, autoClose: true })) as ReadableStream<Uint8Array>;
    return new Response(body, { status: range ? 206 : 200, headers });
  } catch (error) {
    await handle.close();
    throw error;
  }
}
