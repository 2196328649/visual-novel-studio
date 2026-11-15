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


test('startup and title telemetry carries variables without inventing a story location', () => {
  assert.deepEqual(runtimePosition('VNS_EVENT:{"nodeId":null,"lineId":null,"variables":{"visits":1,"enabled":false,"name":"title"}}'), {
    kind: 'position', message: '', nodeId: undefined, lineId: undefined,
    variables: { visits: 1, enabled: false, name: 'title' },
  });
  const story = runtimePosition('VNS_EVENT:{"nodeId":"passage_1","lineId":"line_1","variables":{"visits":1}}');
  const title = runtimePosition('VNS_EVENT:{"nodeId":null,"lineId":null,"variables":{"visits":2}}');
  assert.equal(story?.nodeId, 'passage_1');
  assert.equal(title?.nodeId, undefined);
  assert.equal(title?.lineId, undefined);
  assert.equal(title?.variables?.visits, 2);
});

test('non-story telemetry still rejects malformed payloads and invalid locations', () => {
  for (const value of [null, [], {}, { variables: { visits: 1 } }, { nodeId: 0 }, { nodeId: false }, { nodeId: '' }, { nodeId: 'unknown/path' }]) {
    assert.equal(runtimePosition('VNS_EVENT:' + JSON.stringify(value)), undefined);
  }
  assert.deepEqual(runtimePosition('VNS_EVENT:{"nodeId":null,"lineId":"old_line","variables":{"ok":2,"bad":null,"array":[],"object":{},"infinite":1e999}}'), {
    kind: 'position', message: '', nodeId: undefined, lineId: undefined, variables: { ok: 2 },
  });
});
