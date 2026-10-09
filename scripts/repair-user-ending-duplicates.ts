// One-time, evidence-specific repair. Ordinary authored repetitions are never deduplicated by the editor.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { assetFiles, projectSchema } from '../src/core/model';
import { currentScriptText } from '../src/core/script-text';
import { applyTextScript } from '../src/core/text-script';
import { compileProject } from '../src/runtime/compiler';
import { loadProject, saveProject } from '../src/desktop/project-store';

const original = 'C:/Users/LiuXiangdong/OneDrive/文档/Visual Novel Studio/我的视觉小说1/project.vns.json';
const snapshotRoot = path.resolve('artifacts/text-ending-freeze/2026-10-04T18-15-05Z');
const output = path.resolve('artifacts/text-ending-freeze/repair');
await fs.mkdir(output, { recursive: true });
const bytes = await fs.readFile(path.join(snapshotRoot, 'project.vns.json.autosave'));
const recovery = JSON.parse(bytes.toString('utf8'));
const before = projectSchema.parse(recovery.project);
const source = before.scriptText!.content;
const boundary = source.indexOf('\n@结局演出\n');
assert.ok(boundary > 0);
const prefix = source.slice(0, boundary), tail = source.slice(boundary);
const duplicate = '@结局演出\n@独立演出：结局演出\n';
const removed = tail.split(duplicate).length - 1;
assert.equal(removed, 11, 'This repair is restricted to the inspected snapshot');
const content = prefix + tail.replaceAll(duplicate, '');
assert.equal((content.match(/^@结局演出/gm) ?? []).length, 1);
assert.ok(content.includes('@节点标记：故事结束【txt_node_6sjr9h】\n@对白标记：txt_node_6sjr9h_performance\n@结局演出【builtin_ending_performance】：文字【caption】=未完待续'));
assert.equal(content.slice(0, boundary), prefix);

const draftBefore = applyTextScript(before, source);
const parsed = applyTextScript(before, content);
assert.deepEqual(draftBefore.issues, []); assert.deepEqual(parsed.issues, []);
const repaired = parsed.project;
repaired.scriptText = currentScriptText(content, before.scriptText!.sourceName);
const dialogue = (project: typeof before) => project.nodes.flatMap(node => node.kind === 'passage' ? node.lines.filter(line => !line.silent) : []);
assert.deepEqual(dialogue(repaired), dialogue(draftBefore.project), 'All latest dialogue IDs, text, voices and actions must survive');
for (const key of Object.keys(before) as (keyof typeof before)[]) {
  if (!['nodes', 'scriptText', 'chapters', 'scenes', 'entryId'].includes(key)) assert.deepEqual(repaired[key], before[key], key);
}
assert.deepEqual(repaired.chapters, draftBefore.project.chapters);
assert.deepEqual(repaired.scenes, draftBefore.project.scenes);
assert.equal(repaired.entryId, draftBefore.project.entryId);
const ending = repaired.nodes.find(node => node.id === 'txt_node_6sjr9h');
assert.ok(ending?.kind === 'passage');
assert.equal(ending.lines[0].id, 'txt_node_6sjr9h_performance');
assert.deepEqual(ending.lines[0].actions, [{ kind: 'blueprint', blueprintId: 'builtin_ending_performance', inputs: { caption: '未完待续' } }]);
assert.equal(ending.next, 'txt_node_6sjr9h_return_title');
assert.equal(repaired.nodes.find(node => node.id === ending.next)?.kind, 'end');
const lastPassage = repaired.nodes.find(node => node.id === 'txt_node_19jpmvw');
assert.ok(lastPassage?.kind === 'passage');
assert.equal(lastPassage.next, ending.id);
assert.deepEqual(compileProject(repaired).diagnostics.filter(issue => issue.severity === 'error'), []);
const candidate = path.join(output, 'project.vns.json');
await fs.writeFile(candidate, JSON.stringify(repaired, null, 2) + '\n');
await fs.writeFile(path.join(output, 'ending-before.txt'), tail);
await fs.writeFile(path.join(output, 'ending-after.txt'), content.slice(boundary));
const report: Record<string, unknown> = { source: path.join(snapshotRoot, 'project.vns.json.autosave'), recoverySavedAt: new Date(recovery.savedAt).toISOString(), candidate,
  removedDuplicatePairs: removed, remainingEndingCalls: 1, dialogueLines: dialogue(repaired).length,
  assets: repaired.assets.length, assetFiles: repaired.assets.flatMap(assetFiles).length,
  nodesBeforeInText: draftBefore.project.nodes.length, nodesAfter: repaired.nodes.length,
  preserved: ['all preceding source byte for byte', 'latest dialogue IDs, text, speakers, voices and actions', 'assets and folders', 'blueprints', 'UI and hover sounds', 'ending anchor, caption and title return'],
};
if (process.argv.includes('--apply')) {
  const processes = execFileSync('powershell.exe', ['-NoProfile', '-Command', "Get-CimInstance Win32_Process | Where-Object { ($_.Name -eq 'electron.exe' -and $_.ExecutablePath -like '*visual-novel-studio*') -or $_.Name -eq 'Visual Novel Studio.exe' } | Select-Object ProcessId,Name | ConvertTo-Json -Compress"], { encoding: 'utf8' }).trim();
  assert.equal(processes, '', 'Close the actual editor before applying the verified repair');
  const suffixes = ['', '.autosave', '.previous'];
  const originals = new Map<string, Buffer>();
  for (const suffix of suffixes) {
    const data = await fs.readFile(original + suffix);
    const captured = await fs.readFile(path.join(snapshotRoot, 'project.vns.json' + suffix));
    if (suffix === '.autosave') {
      // Closing the editor refreshed only the recovery timestamp after capture.
      // Require every project field and all other envelope data to match exactly.
      const latest = JSON.parse(data.toString('utf8')), saved = JSON.parse(captured.toString('utf8'));
      assert.deepEqual(latest, { ...saved, savedAt: latest.savedAt }, 'Recovery content changed since snapshot');
      report.recoverySavedAt = new Date(latest.savedAt).toISOString();
    } else assert.ok(data.equals(captured), 'Project changed since snapshot: ' + suffix);
    originals.set(suffix, data);
  }
  const backup = path.join(path.dirname(original), '修复前备份-结局重复-' + new Date().toISOString().replaceAll(':', '-'));
  await fs.mkdir(backup);
  for (const [suffix, data] of originals) await fs.writeFile(path.join(backup, 'project.vns.json' + suffix), data, { flag: 'wx' });
  const saved = await saveProject(original, repaired);
  assert.deepEqual(saved.project, repaired);
  const loaded = await loadProject(original);
  assert.equal(loaded.recovered, false);
  assert.deepEqual(loaded.project, repaired);
  report.applied = { original, backup, sha256: createHash('sha256').update(await fs.readFile(original)).digest('hex') };
}
await fs.writeFile(path.join(output, process.argv.includes('--apply') ? 'applied-report.json' : 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
