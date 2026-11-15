import { Worker } from 'node:worker_threads';
import { availableParallelism } from 'node:os';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import type { PngMetadata } from './png-metadata';

export const imageMetadataConcurrency = Math.max(1, Math.min(2, availableParallelism() - 1));
interface Job { bytes: Buffer; resolve: (metadata: PngMetadata) => void; reject: (error: Error) => void }
interface Slot { worker: Worker; job?: Job; timer?: NodeJS.Timeout; deadline?: number; closed: Promise<void>; resolveClosed(): void }
const queue: Job[] = [], slots = new Set<Slot>(), closing = new Set<Slot>();

function createWorker() {
  const bundled = fileURLToPath(new URL('./image-metadata-worker.cjs', import.meta.url));
  // Node workers read a real file, including in a packaged Electron app.
  const unpacked = bundled.replace(/([\\/])app\.asar([\\/])/, '$1app.asar.unpacked$2');
  if (unpacked !== bundled || existsSync(bundled)) return new Worker(unpacked, { execArgv: [] });
  // Direct tsx-based tests and maintenance scripts use source workers. The
  // packaged application always uses the self-contained CJS worker above.
  const source = fileURLToPath(new URL('./image-metadata-worker.ts', import.meta.url));
  const loader = createRequire(import.meta.url).resolve('tsx/cjs/api');
  return new Worker(`require(${JSON.stringify(loader)}).register(); require(${JSON.stringify(source)});`, { eval: true, execArgv: [] });
}

function retire(slot: Slot, error = new Error('图片分析已取消。'), force = false) {
  if (!slots.delete(slot)) return;
  clearTimeout(slot.timer);
  const remaining = slot.deadline === undefined ? 60_000 : Math.max(1, slot.deadline - Date.now());
  slot.job?.reject(error); slot.job = undefined;
  closing.add(slot); slot.worker.ref();
  const terminate = () => { void slot.worker.terminate().catch(() => undefined); };
  if (force) { terminate(); return; }
  // Terminating during synchronous zlib initialization can abort Node itself.
  // Drain the in-flight decode and close at a message boundary instead. Retired
  // workers still count toward the pool limit until their actual exit event.
  slot.timer = setTimeout(terminate, remaining); slot.timer.unref();
  try { slot.worker.postMessage({ command: 'shutdown' }); }
  catch { terminate(); }
}

function drain() {
  while (queue.length) {
    let slot = [...slots].find(item => !item.job);
    if (!slot) {
      if (slots.size + closing.size >= imageMetadataConcurrency) return;
      try {
        const worker = createWorker();
        let resolveClosed!: () => void;
        const closed = new Promise<void>(resolve => { resolveClosed = resolve; });
        slot = { worker, closed, resolveClosed };
      }
      catch (error) { queue.shift()!.reject(error instanceof Error ? error : new Error(String(error))); continue; }
      slots.add(slot);
      const current = slot;
      current.worker.on('message', (result: { ok: boolean; metadata?: PngMetadata; error?: string }) => {
        if (!slots.has(current) || !current.job) return;
        clearTimeout(current.timer);
        const job = current.job; current.job = undefined; current.deadline = undefined;
        if (result.ok && result.metadata) job.resolve(result.metadata);
        else job.reject(new Error(result.error ?? '无法解析 PNG 图片。'));
        current.worker.unref();
        current.timer = setTimeout(() => retire(current), 10_000); current.timer.unref();
        drain();
      });
      current.worker.on('error', error => { retire(current, error, true); drain(); });
      current.worker.on('exit', code => {
        clearTimeout(current.timer);
        if (slots.delete(current)) current.job?.reject(new Error(`图片分析进程已退出（${code}）。`));
        current.job = undefined; closing.delete(current); current.resolveClosed(); drain();
      });
    }
    clearTimeout(slot.timer);
    slot.job = queue.shift()!; slot.worker.ref();
    const current = slot;
    current.deadline = Date.now() + 60_000;
    current.timer = setTimeout(() => { retire(current, new Error('图片分析超时。'), true); drain(); }, 60_000);
    try {
      // Transfer an owned copy; do not detach bytes the importer still owns.
      const bytes = new Uint8Array(slot.job.bytes);
      slot.worker.postMessage(bytes.buffer, [bytes.buffer]);
    } catch (error) { retire(slot, error instanceof Error ? error : new Error(String(error)), true); }
  }
}

export function pngMetadataAsync(bytes: Buffer): Promise<PngMetadata> {
  return new Promise((resolve, reject) => { queue.push({ bytes, resolve, reject }); drain(); });
}

export function disposeImageMetadataWorkers() {
  const error = new Error('图片分析已取消。');
  for (const job of queue.splice(0)) job.reject(error);
  for (const slot of slots) retire(slot, error);
  return Promise.all([...closing].map(slot => slot.closed)).then(() => undefined);
}
