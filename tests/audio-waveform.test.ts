import assert from 'node:assert/strict';
import test from 'node:test';
import { audioWaveformPeaks, waveformPeakBetween } from '../src/renderer/audio-waveform';

test('waveform retains silence, relative levels and a single-sample transient', () => {
  const samples = new Float32Array(128 * 5);
  samples.fill(.125, 128, 256);
  samples[128 * 2 + 37] = -.875;
  samples.fill(.5, 384, 512);
  const data = audioWaveformPeaks([samples], 128);
  assert.equal(data.duration, 5);
  assert.equal(data.maximum, .875);
  assert.deepEqual([...data.peaks], [0, .125, .875, .5, 0]);
  assert.equal(waveformPeakBetween(data, .1, .9), 0);
  assert.equal(waveformPeakBetween(data, 1.1, 1.9), .125);
  assert.equal(waveformPeakBetween(data, 2.1, 2.9), .875);
});

test('waveform source windows stay aligned after a trim and do not stretch beyond EOF', () => {
  const samples = new Float32Array(128 * 4);
  samples.fill(.25, 128, 256);
  samples.fill(.75, 256, 384);
  const data = audioWaveformPeaks([samples], 128);
  assert.equal(waveformPeakBetween(data, 1.2, 1.8), .25);
  assert.equal(waveformPeakBetween(data, 2.2, 2.8), .75);
  assert.equal(waveformPeakBetween(data, 3.2, 5), 0);
  assert.equal(waveformPeakBetween(data, 4, 8), 0);
  assert.equal(waveformPeakBetween(data, -.5, -.1), 0);
  assert.equal(waveformPeakBetween(data, 1, 1), 0);
  assert.equal(data.maximum, .75, 'A quiet trim keeps the original normalization scale');
});

test('stereo waveforms include every channel without phase cancellation', () => {
  const left = new Float32Array(256).fill(.5, 0, 128);
  const right = new Float32Array(256).fill(-.5, 0, 128).fill(.875, 128);
  const data = audioWaveformPeaks([left, right], 128);
  assert.deepEqual([...data.peaks], [.5, .875]);
  assert.equal(data.maximum, .875);
});
