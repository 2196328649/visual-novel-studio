import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { PNG } from 'pngjs';
import { pngMetadata } from '../src/desktop/png-metadata';
import { pngMetadataAsync, disposeImageMetadataWorkers } from '../src/desktop/image-metadata-worker-pool';

after(() => disposeImageMetadataWorkers());

function picture(width: number, height: number, x: number) {
  const png = new PNG({ width, height }); png.data.fill(0);
  png.data[(width + x) * 4 + 3] = 255;
  return PNG.sync.write(png);
}

test('background PNG analysis agrees with the original algorithm without detaching input', async () => {
  const bytes = picture(32, 24, 4), original = Buffer.from(bytes);
  assert.deepEqual(await pngMetadataAsync(bytes), pngMetadata(bytes));
  assert.deepEqual(bytes, original);
});

test('queued images retain their own results and corrupt inputs do not poison the worker', async () => {
  const images = Array.from({ length: 8 }, (_, index) => picture(20 + index, 18 + index, index));
  const results = await Promise.all(images.map(pngMetadataAsync));
  assert.deepEqual(results, images.map(pngMetadata));
  await assert.rejects(pngMetadataAsync(Buffer.from('not a PNG')));
  assert.deepEqual(await pngMetadataAsync(images[0]), pngMetadata(images[0]));
});

test('disposing a pool rejects outstanding work and subsequent calls can start fresh workers', async () => {
  const bytes = picture(40, 30, 3);
  const pending = Array.from({ length: 5 }, () => pngMetadataAsync(bytes));
  const outcomes = Promise.allSettled(pending);
  disposeImageMetadataWorkers();
  assert.ok((await outcomes).every(result => result.status === 'rejected'));
  assert.deepEqual(await pngMetadataAsync(bytes), pngMetadata(bytes));
});

test('repeated startup cancellation drains workers and allows immediate replacement requests', { timeout: 20000 }, async () => {
  const bytes = picture(96, 64, 5), expected = pngMetadata(bytes);
  for (let round = 0; round < 12; round++) {
    const pending = Array.from({ length: 6 }, () => pngMetadataAsync(bytes));
    const outcomes = Promise.allSettled(pending);
    const closed = disposeImageMetadataWorkers();
    const replacement = pngMetadataAsync(bytes);
    assert.ok((await outcomes).every(result => result.status === 'rejected'));
    await closed;
    assert.deepEqual(await replacement, expected);
    await disposeImageMetadataWorkers();
  }
});
