export interface WaveformData {
  duration: number;
  peaksPerSecond: number;
  peaks: Float32Array;
  maximum: number;
}

const MAX_PEAKS = 262144;

/** Keep transients from every channel, including stereo channels in opposite phase. */
export function audioWaveformPeaks(channels: readonly Float32Array[], sampleRate: number): WaveformData {
  const length = channels[0]?.length ?? 0;
  const samplesPerPeak = Math.max(128, Math.ceil(length / MAX_PEAKS));
  const peaks = new Float32Array(Math.ceil(length / samplesPerPeak));
  let maximum = 0;
  for (const channel of channels) {
    for (let index = 0; index < peaks.length; index++) {
      const end = Math.min(channel.length, (index + 1) * samplesPerPeak);
      let peak = peaks[index];
      for (let sample = index * samplesPerPeak; sample < end; sample++) peak = Math.max(peak, Math.abs(channel[sample]));
      peaks[index] = peak;
      maximum = Math.max(maximum, peak);
    }
  }
  return { duration: length / sampleRate, peaksPerSecond: sampleRate / samplesPerPeak, peaks, maximum };
}

/** Times refer to the source file, so trimming changes the range, never its scale. */
export function waveformPeakBetween(data: WaveformData, from: number, to: number): number {
  if (to <= 0 || from >= data.duration || to <= from) return 0;
  const first = Math.max(0, Math.floor(from * data.peaksPerSecond));
  const end = Math.min(data.peaks.length, Math.ceil(to * data.peaksPerSecond));
  let peak = 0;
  for (let index = first; index < end; index++) peak = Math.max(peak, data.peaks[index]);
  return peak;
}

type CacheEntry = {
  controller: AbortController;
  users: number;
  data?: WaveformData;
  promise: Promise<WaveformData>;
};
const cache = new Map<string, CacheEntry>();
let decodeQueue: Promise<unknown> = Promise.resolve();

function pruneCache() {
  let bytes = [...cache.values()].reduce((sum, entry) => sum + (entry.data?.peaks.byteLength ?? 0), 0);
  for (const [url, entry] of cache) {
    if (cache.size <= 24 && bytes <= 16 * 1024 * 1024) break;
    if (entry.users || !entry.data) continue;
    bytes -= entry.data.peaks.byteLength;
    cache.delete(url);
  }
}

/** Share work for repeated clips; serialize decodes and retain only small peak arrays. */
export function acquireAudioWaveform(url: string) {
  let entry = cache.get(url);
  if (!entry) {
    const controller = new AbortController();
    const promise = decodeQueue.then(async () => {
      if (controller.signal.aborted) throw new DOMException('波形读取已取消', 'AbortError');
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) throw new Error('无法读取音频素材。');
      const bytes = await response.arrayBuffer();
      if (controller.signal.aborted) throw new DOMException('波形读取已取消', 'AbortError');
      // An offline context never opens an audio output or starts playback.
      const context = new OfflineAudioContext(1, 1, 22050);
      const buffer = await context.decodeAudioData(bytes);
      if (controller.signal.aborted) throw new DOMException('波形读取已取消', 'AbortError');
      return audioWaveformPeaks(Array.from({ length: buffer.numberOfChannels }, (_, channel) => buffer.getChannelData(channel)), buffer.sampleRate);
    });
    entry = { controller, users: 0, promise };
    const created = entry;
    decodeQueue = promise.then(() => undefined, () => undefined);
    void promise.then(data => {
      created.data = data;
      pruneCache();
    }, () => { if (cache.get(url) === created) cache.delete(url); });
  }
  cache.delete(url);
  cache.set(url, entry);
  entry.users++;
  const acquired = entry;
  let released = false;
  return {
    promise: entry.promise,
    release: () => {
      if (released) return;
      released = true;
      acquired.users--;
      if (!acquired.users && !acquired.data) {
        acquired.controller.abort();
        if (cache.get(url) === acquired) cache.delete(url);
      }
      pruneCache();
    },
  };
}
