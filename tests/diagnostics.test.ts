import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diagnosticsFromLog, runtimePosition } from '../src/runtime/diagnostics';

test('RenPy traceback links back to the authored line and deduplicates repeated frames', () => {
  const map = { 'story.rpy:40': { nodeId: 'scene_a', lineId: 'line_b' }, 'game/story.rpy:10': { nodeId: 'start' } };
  const log = 'File "game/story.rpy", line 10, in script\nFile "C:\\games\\demo\\game\\story.rpy", line 40, in script\nFile "game/story.rpy", line 40, in script\nException: Could not load image.';
  assert.deepEqual(diagnosticsFromLog(log, map), [
    { severity: 'error', nodeId: 'scene_a', lineId: 'line_b', message: 'Exception: Could not load image.' },
    { severity: 'error', nodeId: 'start', message: 'Exception: Could not load image.' },
  ]);
});

test('runtime state uses explicit JSON events and ignores unrelated output', () => {
  assert.equal(runtimePosition('RenPy started'), undefined);
  assert.equal(runtimePosition('VNS_EVENT:not json'), undefined);
  assert.deepEqual(runtimePosition('VNS_EVENT:{"nodeId":"passage_1","lineId":"line_1","variables":{"affection":2,"met":true,"bad":{}}}'), {
    kind: 'position', message: '', nodeId: 'passage_1', lineId: 'line_1', variables: { affection: 2, met: true },
  });
});
