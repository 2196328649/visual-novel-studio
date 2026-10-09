import test from 'node:test';
import assert from 'node:assert/strict';
import { revealExportResult } from '../src/desktop/export-result';
import type { RunResult } from '../src/core/bridge';

test('only a completed export opens its exact output folder once', async () => {
  const opened: string[] = [], open = async (directory: string) => { opened.push(directory); return ''; };
  const success: RunResult = { ok: true, diagnostics: [], log: 'exported', outputPath: 'E:\\作品\\我的游戏', buildPath: 'E:\\temporary-build' };
  assert.equal(await revealExportResult(success, open), success);
  assert.deepEqual(opened, [success.outputPath]);
  for (const result of [{ ...success, ok: false }, { ...success, cancelled: true }, { ...success, outputPath: undefined }]) assert.equal(await revealExportResult(result, open), result);
  assert.equal(opened.length, 1);
});

test('an Explorer error preserves the exported game and gives a manual recovery instruction', async () => {
  const success: RunResult = { ok: true, diagnostics: [], log: 'exported', outputPath: 'E:\\作品' };
  for (const open of [async () => 'Explorer unavailable', async () => { throw new Error('Explorer unavailable'); }]) {
    const result = await revealExportResult(success, open);
    assert.equal(result.ok, true); assert.equal(result.outputPath, success.outputPath);
    assert.equal(result.diagnostics.length, 1); assert.equal(result.diagnostics[0].severity, 'warning');
    assert.match(result.log, /游戏已导出.*打开位置/);
    assert.deepEqual(success.diagnostics, []);
  }
});
