import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { assetResponse } from '../src/desktop/asset-response';

test('SVG project assets have an image media type so the browser can decode them',async t=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'vns-svg-response-'));
 t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 const file=path.join(directory,'card.SVG'),svg='<svg xmlns="http://www.w3.org/2000/svg" width="32" height="24"><rect width="32" height="24" fill="green"/></svg>';
 await fs.writeFile(file,svg);const response=await assetResponse(file,new Request('https://local/asset'));
 assert.equal(response.headers.get('content-type'),'image/svg+xml');assert.equal(await response.text(),svg);
});

test('local media responses support full, bounded, open and suffix byte reads', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'vns-media-range-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'audio.opus');
  const bytes = Buffer.from('OggS0123456789abcdefghijk');
  await fs.writeFile(file, bytes);
  for (const [range, start, end] of [[undefined, 0, bytes.length - 1], ['bytes=4-9', 4, 9], ['bytes=10-', 10, bytes.length - 1], ['bytes=-5', bytes.length - 5, bytes.length - 1]] as const) {
    const response = await assetResponse(file, new Request('https://local/asset', { headers: range ? { Range: range } : {} }));
    assert.equal(response.status, range ? 206 : 200);
    assert.equal(response.headers.get('content-type'), 'audio/ogg');
    assert.equal(response.headers.get('accept-ranges'), 'bytes');
    assert.equal(response.headers.get('content-length'), String(end - start + 1));
    if (range) assert.equal(response.headers.get('content-range'), `bytes ${start}-${end}/${bytes.length}`);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes.subarray(start, end + 1));
  }
  const head = await assetResponse(file, new Request('https://local/asset', { method: 'HEAD' }));
  assert.equal(head.headers.get('content-length'), String(bytes.length));
  assert.equal((await head.arrayBuffer()).byteLength, 0);
});

test('invalid and unsupported media ranges return 416 without streaming a body', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'vns-media-invalid-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'audio.wav');
  await fs.writeFile(file, 'RIFF0000WAVEdata');
  for (const range of ['bytes=99-', 'bytes=5-2', 'bytes=-0', 'bytes=-', 'bytes=0-1,3-4', 'items=0-1']) {
    const response = await assetResponse(file, new Request('https://local/asset', { headers: { Range: range } }));
    assert.equal(response.status, 416, range);
    assert.equal(response.headers.get('content-type'), 'audio/wav');
    assert.equal(response.headers.get('content-range'), 'bytes */16');
    assert.equal((await response.arrayBuffer()).byteLength, 0);
  }
});
