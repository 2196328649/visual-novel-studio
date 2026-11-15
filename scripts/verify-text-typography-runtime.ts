import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import type { StoryLine, TextPresentation, TextSpanStyle } from '../src/core/model';
import { dialogueLayout } from '../src/core/ui';
import { buildProject, runRenpy } from '../src/runtime/service';
import { isolateRenpySaves } from './lib/renpy-saves';
import { cleanVerificationDirectories } from './lib/verification-cleanup';
import { assertGlyphChange, findScreenshot, preserveRenpyScreenshots, sha256, textInk, typographyFixture, typographyWords } from './lib/text-typography';

// The real say screen, including native/custom layouts and retained screen text.
// Validate both style properties and ink locations; text_align without min_width
// can look correct in style data while a one-line caption never actually moves.
const root = path.resolve('.'), sdk = path.join(root, 'resources/runtime');
const at = process.argv.indexOf('--source'), source = path.resolve(at < 0 ? 'resources/templates/aihong/project.vns.json' : process.argv[at + 1]);
const output = path.resolve(process.env.VNS_ARTIFACT_ROOT ?? 'artifacts', 'text-typography-runtime', new Date().toISOString().replaceAll(':', '-'));
const directory = path.join(output, 'project');
const fixture = await typographyFixture(source, directory);
await isolateRenpySaves(output);
const evidence: Record<string, unknown> = {}, checks: string[] = [];
let phase = 'prepare';
try {
  for (const custom of [false, true]) {
    const mode = custom ? 'custom' : 'native', project = structuredClone(fixture.project);
    if (!custom) project.ui.components = [];
    const cases: { line: StoryLine; align?: 'left' | 'center' | 'right'; screen: boolean; key: string }[] = [];
    const add = (key: string, look: TextPresentation, text = typographyWords, span?: TextSpanStyle) => {
      const line: StoryLine = { id: key, text, actions: [], textPresentation: { speed: 'instant', ...look }, ...(span ? { textSpans: [{ start: 0, end: 2, style: span }] } : {}) };
      cases.push({ key, line, align: look.align, screen: look.placement === 'screen' });
    };
    if (custom) add('inherited', {});
    for (const placement of ['dialogue', 'screen'] as const) for (const align of ['left', 'center', 'right'] as const) {
      add(`${placement}_${align}`, { placement, align, fontAssetId: fixture.regular?.id });
      add(`${placement}_${align}_multiline`, { placement, align, fontAssetId: fixture.regular?.id }, '春江花月夜\nAa');
    }
    for (const asset of project.assets) {
      for (const kind of ['plain', 'bold', 'italic'] as const) add(`${asset.id}_${kind}`, { align: 'left', fontAssetId: asset.id, ...(kind === 'plain' ? {} : { [kind]: true }) });
    }
    add('partial_plain', { align: 'left', fontAssetId: fixture.regular?.id });
    add('partial_bold', { align: 'left', fontAssetId: fixture.regular?.id }, typographyWords, { bold: true });
    add('partial_italic', { align: 'left', fontAssetId: fixture.regular?.id }, typographyWords, { italic: true });
    add('done', {}, '验收完成。');
    project.nodes.find(node => node.kind === 'passage')!.lines = cases.map(item => item.line);
    const game = path.join(output, mode), pictures = path.join(output, 'screenshots', mode);
    await fs.writeFile(path.join(output, mode + '-project.json'), JSON.stringify(project, null, 2));
    phase = mode + ' build';
    const built = await buildProject({ project, projectDir: directory, outputDir: game, sdkRoot: sdk });
    await fs.writeFile(path.join(output, mode + '-build.json'), JSON.stringify(built, null, 2));
    assert.equal(built.ok, true, JSON.stringify(built));
    const what = 'renpy.get_widget("say", "what")';
    const steps = cases.map((item, index) => {
      const look = item.line.textPresentation!;
      const width = item.screen ? Math.round(project.width * .8) : custom ? Math.round(project.width * .8) : dialogueLayout(project.width, project.height, project.ui).contentWidth;
      const expectedAlign = item.align ? { left: 0, center: .5, right: 1 }[item.align] : item.screen ? .5 : custom ? 1 : 0;
      return `    ${index ? 'click' : 'run Start()'}
    pause until eval vn_current_line == ${JSON.stringify(item.key)}
    pause .15
    assert eval ${what}.style.text_align == ${expectedAlign}
    assert eval ${what}.style.min_width == ${width}
    assert eval bool(${what}.style.bold) == ${look.bold ? 'True' : 'False'} and bool(${what}.style.italic) == ${look.italic ? 'True' : 'False'}
    screenshot ${JSON.stringify(item.key + '.png')}`;
    }).join('\n');
    const tests = `init -999 python:
    import renpy as _engine
    _engine.safe_mode_checked = True
testsuite global:
    before testcase:
        $ _test.timeout = 20.0
        $ _test.screenshot_directory = "tests/screenshots"
        $ preferences.text_cps = 0
        $ preferences.transitions = 0
    teardown:
        exit
testcase typography:
${steps}
`;
    await fs.writeFile(path.join(game, 'game/testcases.rpy'), tests);
    await fs.writeFile(path.join(output, mode + '-testcases.rpy'), tests);
    phase = mode + ' play';
    const result = await runRenpy(sdk, game, ['test', '--report-detailed'], { savedir: path.join(output, 'saves', mode), timeoutMs: 180000, env: { RENPY_RENDERER: 'gl2' } });
    await fs.writeFile(path.join(output, mode + '-runtime.log'), result.log);
    await preserveRenpyScreenshots(game, pictures);
    assert.equal(result.code, 0, result.log.slice(-6000));
    assert.match(result.log, /Status: PASSED/);
    const images = new Map<string, PNG>();
    for (const item of cases) {
      const file = await findScreenshot(pictures, item.key + '.png'); assert.ok(file, item.key);
      const image = PNG.sync.read(await fs.readFile(file)); images.set(item.key, image);
      if (!item.align) continue;
      const ink = textInk(image), scale = image.width / project.width;
      const left = (item.screen || custom ? project.width * .1 : dialogueLayout(project.width, project.height, project.ui).margin) * scale;
      const right = image.width - left;
      assert.ok(ink.pixels > 40);
      if (item.key.includes('multiline')) assert.equal(ink.bands.length, 2, item.key + ': expected two lines');
      for (const line of ink.bands) {
        const gap = item.align === 'left' ? line.minX - left : item.align === 'right' ? right - line.maxX - 1 : (line.minX + line.maxX + 1 - left - right) / 2;
        assert.ok(Math.abs(gap) < 10 * scale, mode + ':' + item.key + ': ' + JSON.stringify({ gap, left, right, ink }));
      }
      evidence[mode + '-' + item.key] = ink;
    }
    for (const asset of project.assets) for (const kind of ['bold', 'italic'] as const) {
      evidence[mode + '-' + asset.id + '-' + kind] = assertGlyphChange(images.get(asset.id + '_plain')!, images.get(asset.id + '_' + kind)!, kind, mode + ':' + asset.name);
    }
    for (const kind of ['bold', 'italic'] as const) evidence[mode + '-partial-' + kind] = assertGlyphChange(images.get('partial_plain')!, images.get('partial_' + kind)!, kind, mode + ':partial');
    checks.push(`${mode}：单行、多行、画面文字的左中右像素位置；全部项目字体粗斜体与局部字形；${cases.length * 3}项运行时断言`);
  }
  assert.equal(sha256(await fs.readFile(source)), fixture.originalHash);
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'passed', source, sourceHash: fixture.originalHash, checks, evidence }, null, 2));
} catch (error) {
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'failed', phase, error: String(error), checks, evidence }, null, 2));
  throw error;
} finally {
  for (const mode of ['native', 'custom']) await preserveRenpyScreenshots(path.join(output, mode), path.join(output, 'screenshots', mode));
  const cleanup = await cleanVerificationDirectories(output, ['project', 'native', 'custom', 'saves', 'renpy-saves']);
  assert.deepEqual(cleanup.errors, []);
  console.log(output);
}
