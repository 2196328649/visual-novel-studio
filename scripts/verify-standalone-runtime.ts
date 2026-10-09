import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createProject } from '../src/core/model';
import { blueprintFromPerformance } from '../src/core/blueprint-authoring';
import { applyTextScript } from '../src/core/text-script';
import { arrangePerformanceTimeline, performanceTimeline } from '../src/core/performance-timeline';
import { buildProject, runRenpy } from '../src/runtime/service';

const root = path.resolve('.'), output = path.join(root, 'artifacts/standalone-runtime', new Date().toISOString().replaceAll(':', '-'));
const game = path.join(output, 'game'), sdk = path.join(root, 'resources/runtime');
const base = createProject('独立演出运行验收');
const graph = blueprintFromPerformance(base, [{ kind: 'chapter', title: '第一章 · 酒醒城破', subtitle: '独立演出', duration: 7, effect: 'fade' }], '章节进场');
graph.performanceKind = 'standalone';
const timeline = performanceTimeline(base, graph); arrangePerformanceTimeline(base, graph, timeline.clips, timeline.tracks);
base.blueprints.push(graph);
const parsed = applyTextScript(base, '# 段落：开场\n@章节标题：第一章 · 酒醒城破｜文本自动生成的独立演出｜7\n@章节配乐\n旁白：演出前。\n@章节进场\n@独立演出：章节进场模块\n旁白：独立演出结束后。\n@等待：0.2\n旁白：台词演出结束后。');
assert.deepEqual(parsed.issues, []);
await fs.mkdir(output, { recursive: true });
await fs.writeFile(path.join(output, 'authored-project.json'), JSON.stringify(parsed.project, null, 2));
const built = await buildProject({ project: parsed.project, outputDir: game, sdkRoot: sdk });
assert.equal(built.ok, true, JSON.stringify(built));
await fs.writeFile(path.join(game, 'game/testcases.rpy'), `# Keep typing on another monitor from activating the Shift startup shortcut.
init -999 python:
    import renpy as _runtime_engine
    _runtime_engine.safe_mode_checked = True

testsuite global:
    before testcase:
        $ _test.timeout = 20.0
        $ _test.screenshot_directory = "tests/screenshots"
        $ preferences.text_cps = 0
        $ preferences.afm_enable = False
    teardown:
        exit

testcase standalone_chapter_then_dialogue:
    click id "vn_main_start"
    pause until screen "vn_chapter_title"
    assert not screen "say"
    pause 2.0
    assert screen "vn_chapter_title"
    screenshot "00-text-chapter.png"
    pause until "演出前。"
    assert screen "say"
    click pos (640, 500)
    pause until screen "vn_chapter_title"
    assert not screen "say"
    pause 2.0
    assert screen "vn_chapter_title"
    assert not screen "say"
    screenshot "01-standalone.png"
    pause until "独立演出结束后。"
    assert not screen "vn_chapter_title"
    assert screen "say"
    screenshot "02-following-dialogue.png"
    click pos (640, 500)
    pause until "台词演出结束后。"
    assert screen "say"
`);
const result = await runRenpy(sdk, game, ['test', '--report-detailed'], { savedir: path.join(output, 'saves'), onData: text => process.stdout.write(text), env: { RENPY_RENDERER: 'gl2' } });
await fs.writeFile(path.join(output, 'run.log'), result.log);
await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: result.code === 0 ? 'passed' : 'failed', code: result.code, duration: 7 }, null, 2));
console.log(output); console.log(result.log.slice(-3500)); assert.equal(result.code, 0);
