import { parentPort } from 'node:worker_threads';
import { pngMetadata } from './png-metadata';

if (!parentPort) throw new Error('Image metadata must run in a worker.');
parentPort.on('message', (bytes: ArrayBuffer | { command: 'shutdown' }) => {
  if (!(bytes instanceof ArrayBuffer)) {
    if (bytes.command === 'shutdown') parentPort!.close();
    return;
  }
  try { parentPort!.postMessage({ ok: true, metadata: pngMetadata(Buffer.from(bytes)) }); }
  catch (error) { parentPort!.postMessage({ ok: false, error: error instanceof Error ? error.message : '无法解析 PNG 图片。' }); }
});
