import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createProject, projectSchema, type Project } from '../src/core/model';
import { applyTextScript } from '../src/core/text-script';
import { validateProject } from '../src/core/validate';
import { readTextDocument } from '../src/desktop/text-import';

const sourcePath = process.argv[2] ? path.resolve(process.argv[2]) : undefined;
if (!sourcePath) throw new Error('请提供需要验证的 DOCX、TXT 或 Markdown 文件路径。');
const studio = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runId = new Date().toISOString().replaceAll(':', '-');
const output = path.join(studio, 'artifacts', 'text-import-verification', runId);
const checks: string[] = [];
const report: Record<string, unknown> = { createdAt: new Date().toISOString(), sourcePath, checks, passed: false };
const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const identities = (project: Project) => ({
  projectId: project.id,
  chapters: project.chapters.map(chapter => chapter.id),
  scenes: project.scenes.map(scene => scene.id),
  characters: project.characters.map(character => character.id),
  nodes: project.nodes.map(node => ({ id: node.id, lines: node.kind === 'passage' ? node.lines.map(line => line.id) : [] })),
});

await fs.mkdir(output, { recursive: true });
try {
  const sourceBytes = await fs.readFile(sourcePath);
  report.sourceBytes = sourceBytes.length;
  report.sourceSha256 = sha256(sourceBytes);
  report.implementationSha256 = Object.fromEntries(await Promise.all(['src/desktop/text-import.ts', 'src/core/text-script.ts'].map(async file => [file, sha256(await fs.readFile(path.join(studio, file)))])));
  const imported = await readTextDocument(sourcePath);
  assert.ok(imported.text.trim().length > 0);
  assert.ok(!imported.text.includes('\ufffd'), '正文不得出现编码替换字符');
  checks.push('读取实际文件并保留中文字符');
  report.text = {
    name: imported.name,
    codePoints: Array.from(imported.text).length,
    sourceLines: imported.text.split(/\r\n?|\n/).length,
    nonemptyLines: imported.text.split(/\r\n?|\n/).filter(line => line.trim()).length,
    firstLine: imported.text.split(/\r\n?|\n/).find(line => line.trim()),
    sha256: sha256(Buffer.from(imported.text)),
  };
  const original = createProject('实际文档导入验证');
  const parsed = applyTextScript(original, imported.text, imported.name);
  projectSchema.parse(parsed.project);
  report.parseIssues = parsed.issues;
  assert.deepEqual(parsed.issues, []);
  assert.equal(parsed.project.id, original.id);
  checks.push('中文正文解析通过且工程身份保留');
  const diagnostics = validateProject(parsed.project);
  report.projectDiagnostics = diagnostics;
  assert.deepEqual(diagnostics.filter(diagnostic => diagnostic.severity === 'error'), []);
  checks.push('导入后的工程通过结构与引用检查');
  const passages = parsed.project.nodes.filter(node => node.kind === 'passage');
  const lines = passages.flatMap(passage => passage.lines);
  report.project = {
    name: parsed.project.name,
    chapters: parsed.project.chapters.length,
    scenes: parsed.project.scenes.length,
    nodes: parsed.project.nodes.length,
    passages: passages.length,
    storyLines: lines.length,
    dialogueLines: lines.filter(line => line.speakerId).length,
    narrationLines: lines.filter(line => !line.speakerId).length,
    characters: parsed.project.characters.map(character => character.name),
  };
  const repeated = applyTextScript(parsed.project, imported.text, imported.name);
  assert.deepEqual(repeated.issues, []);
  assert.deepEqual(identities(repeated.project), identities(parsed.project));
  checks.push('重复导入保留章节、场景、角色、节点与对白 ID');
  const reopened = projectSchema.parse(JSON.parse(JSON.stringify(parsed.project)));
  assert.deepEqual(reopened, parsed.project);
  checks.push('工程 JSON 保存与重新读取不丢失数据');
  report.passed = true;
} catch (error) {
  report.error = error instanceof Error ? { message: error.message, stack: error.stack } : String(error);
  process.exitCode = 1;
} finally {
  const reportPath = path.join(output, 'report.json');
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ report: reportPath, ...report }, null, 2));
}
