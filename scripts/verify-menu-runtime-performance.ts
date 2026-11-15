import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build as bundle, type Plugin } from 'esbuild';
import { PNG } from 'pngjs';
import { effectiveUiTheme, projectSchema, type Project } from '../src/core/model';
import { normalizeChapterCompositions } from '../src/core/chapter-composition';
import { timelinePlaybackLayout } from '../src/core/performance-timeline';
import { interleaveProjectTimelines } from '../src/core/timeline-interleave';
import { uiPageHostScreens } from '../src/core/ui-pages';
import { createUiLayoutRuntime } from '../src/runtime/ui-layout-runtime';
import { createUiVideoRuntime } from '../src/runtime/ui-video-runtime';
import { createUiImageRuntime } from '../src/runtime/ui-image-runtime';
import { createUiControlRuntime } from '../src/runtime/ui-control-runtime';
import { createUiRuntime } from '../src/runtime/ui-runtime';
import { createScreens } from '../src/runtime/screens';
import { buildProject, runRenpy } from '../src/runtime/service';
import { withPortraitMetadata } from '../src/desktop/image-metadata';
import { pythonLiteral as q } from '../src/runtime/literals';
import { cleanVerificationDirectories } from './lib/verification-cleanup';
import { isolateRenpySaves } from './lib/renpy-saves';
import { auditMenuInputTrace, menuPerformanceInputRuntime, type MenuInputAction, type MenuInputEvent, type MenuInputFrame, type MenuInputLatency } from './lib/menu-performance-input';

// Run only after the complete product change. Both players use one read-only
// author snapshot and the same assets. Old code is applied to the isolated
// baseline player; the working source tree is never rolled back.
const root = path.resolve('.');
const sdk = process.env.VNS_RENPY_SDK ?? path.join(root, 'resources/runtime');
const authorFile = path.resolve(process.env.VNS_AUTHOR_PROJECT ?? '../我的视觉小说1/project.vns.json');
const option = (name: string) => {
  const inline = process.argv.find(argument => argument.startsWith(name + '='));
  const position = process.argv.indexOf(name);
  const value = inline?.slice(name.length + 1) ?? (position < 0 ? undefined : process.argv[position + 1]);
  if (inline !== undefined || position >= 0) assert.ok(value && !value.startsWith('--'), name + ' requires a value.');
  return value;
};
const baselineRoot = path.resolve(option('--baseline-root') ?? 'artifacts/editor-refinements-2026-11-10/baseline-source');
const artifactRoot = path.resolve(option('--artifact-root') ?? 'artifacts/editor-refinements-2026-11-10');
const legacyBaseline = baselineRoot.toLowerCase() === path.resolve('artifacts/game-flow-transitions-2026-11-09/baseline-source').toLowerCase();
const baselineModules = (option('--baseline-modules') ?? 'src/runtime/ui-control-runtime.ts,src/runtime/ui-runtime.ts').split(',').map(value => value.trim());
assert.ok(baselineModules.length > 0 && baselineModules.every(value => /^src\/runtime\/[a-z0-9-]+\.ts$/.test(value)), '--baseline-modules accepts explicit src/runtime/*.ts files only.');
assert.equal(new Set(baselineModules).size, baselineModules.length, 'Baseline modules must be unique.');
const profileAfter = process.argv.includes('--profile-after');
const referenceOption = option('--reference-report');
const output = path.join(artifactRoot, (profileAfter ? 'menu-profile-' : 'menu-performance-') + new Date().toISOString().replaceAll(':', '-') + '-' + randomUUID().slice(0, 8));
const source = path.join(output, 'source');
const players = { baseline: path.join(output, 'baseline-game'), after: path.join(output, 'after-game') };
const previousSaveRoot = process.env.RENPY_PATH_TO_SAVES;
const sha256 = (data: Buffer | string) => createHash('sha256').update(data).digest('hex');
const report: Record<string, unknown> = { status: 'preparing', mode: profileAfter ? 'profile-after' : 'abba', authorFile, baselineRoot, artifactRoot, baselineMode: legacyBaseline ? '2026-11-09-fragments' : 'selected-runtime-generators', inputTraceVersion: 2, checks: [], runs: [], observations: [
  '真实工程的界面、Spine、素材与布局保持一致；仅隔离工程ID和测试起始偏好固定。',
  profileAfter ? '仅运行当前after；三个交互阶段单独cProfile，含显著观测开销，不作为ABBA性能改善证据。' : 'ABBA顺序运行两轮，以降低先后次序和操作系统缓存造成的偏差。',
  '真实draw_screen帧与实际鼠标事件；截图、布局正确性检查和JSON写盘均在计时段外。',
  profileAfter ? '历史通过且工程哈希相同的ABBA仅作参数、素材、几何和截图参照，不比较新旧计时。' : '计数及perf_counter包装只存在于生成的验收工程，两组完全相同；不以测试数据替代产品结果。',
  '静态设置页面无连续重绘要求，静止期间绘制间隔不等于动画帧率。',
  '两组使用运行时默认绘制节奏；记录实际渲染器与偏好，不强制降低或声称锁定帧率。',
  '两组同样计数pgrender.load_image的实际解码请求；首次打开设置的click→首帧已单独保存在open_preferences。',
  '每个实际SDL按下／移动／释放事件都有独立编号和发出时刻；回调用事件对象上的编号关联，旧lastMove等待不参与本轮统计。',
  '每个滑条回调保留修改前后真实数值、来源值、处理入口／返回、首个可用绘制及数值是否仍被呈现；同值回调、合并事件、未呈现与被新值覆盖的记录均保留。',
  '两组执行相同只读值探针，并单列其开销；没有更改事件合并规则、增加重绘或强制帧率。首开与返回各两次样本只报告原值及范围。',
  '中位数在偶数样本时取中央两值平均；p95使用经验分位数第ceil(0.95×N)项。',
] };
let failure: unknown, beforeHash = '';
const save = () => fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
const saveRun = async (name: string, value: { code: number; log: string }) => {
  const logPath = path.join(output, name + '.log');
  await fs.writeFile(logPath, value.log);
  (report.checks as unknown[]).push({ name, code: value.code, logPath }); await save();
  assert.equal(value.code, 0, name + ': ' + value.log.slice(-9000));
};

type Phase = { name: string; wallSeconds: number; layoutCalls: number; layoutRows: number; layoutGlobalCalls: number; layoutMs: number; layoutSizes: Record<string, number>; imagePolls: number; imagePollMs: number; decodeCalls: number; decodeFiles: Record<string, number>; spinePolls: number; spinePollMs: number; unpresentedInputs: number; inputEventIds: number[]; actionIds: number[]; frames: MenuInputFrame[]; inputLatencies: MenuInputLatency[]; spineSamples: { sourceSequence: number; time: number; speed: number; status: string }[] };
type Metrics = { run: string; renderer: unknown; renderPreferences: unknown; profiling?: unknown; inputTraceVersion?: number; inputEvents?: MenuInputEvent[]; phases: Phase[]; controls: Record<string, number>; guards: Record<string, unknown>; actions: MenuInputAction[] };
const summary = (values: number[]) => {
  const ordered = [...values].sort((a, b) => a - b);
  return { count: ordered.length, min: ordered[0] ?? null, median: ordered.length ? (ordered[Math.floor((ordered.length - 1) / 2)] + ordered[Math.floor(ordered.length / 2)]) / 2 : null, p95: ordered.length ? ordered[Math.ceil(ordered.length * .95) - 1] : null, max: ordered.at(-1) ?? null, over50: ordered.filter(value => value > 50).length };
};
type RunLatency = MenuInputLatency & { run: string };
const responseSummary = (inputs: RunLatency[]) => ({
  all: summary(inputs.map(input => input.toFrameMs)),
  valueChanged: summary(inputs.filter(input => input.kind === 'slider' && input.valueChanged && input.presented).map(input => input.toFrameMs)),
  sameValue: summary(inputs.filter(input => input.kind === 'slider' && !input.valueChanged && input.presented).map(input => input.toFrameMs)),
  byEventType: Object.fromEntries(['down', 'move', 'up'].map(type => [type, summary(inputs.filter(input => input.eventType === type).map(input => input.toFrameMs))])),
  notPresentedAtFirstFrame: inputs.filter(input => !input.presented).map(input => ({ run: input.run, eventId: input.eventId, actionId: input.actionId, frameId: input.frameId })),
});
const smallSampleResponses = (inputs: RunLatency[]) => ({ count: inputs.length, samples: inputs.map(input => ({ run: input.run, eventId: input.eventId, frameId: input.frameId, ms: input.toFrameMs })), rangeMs: inputs.length ? [Math.min(...inputs.map(input => input.toFrameMs)), Math.max(...inputs.map(input => input.toFrameMs))] : [] });
const summarize = (metrics: Metrics) => metrics.phases.map(phase => ({ name: phase.name, wallSeconds: phase.wallSeconds,
  layout: { calls: phase.layoutCalls, globalCalls: phase.layoutGlobalCalls, controlsProcessed: phase.layoutRows, controlsPerCall: phase.layoutCalls ? phase.layoutRows / phase.layoutCalls : 0, ms: phase.layoutMs, msPerSecond: phase.layoutMs / phase.wallSeconds, sizes: phase.layoutSizes },
  image: { calls: phase.imagePolls, ms: phase.imagePollMs, callsPerSecond: phase.imagePolls / phase.wallSeconds },
  decoder: { calls: phase.decodeCalls, files: phase.decodeFiles },
  spine: { calls: phase.spinePolls, ms: phase.spinePollMs, samples: phase.spineSamples.length },
  frames: phase.frames.length, drawMs: summary(phase.frames.map(frame => frame.drawMs)), frameMs: summary(phase.frames.flatMap(frame => frame.frameMs === null ? [] : [frame.frameMs])),
  inputToHandlerMs: summary(phase.inputLatencies.flatMap(input => input.toHandlerMs === undefined ? [] : [input.toHandlerMs])),
  inputToFrameMs: ['open_preferences', 'return_title'].includes(phase.name) ? smallSampleResponses(phase.inputLatencies.map(input => ({ ...input, run: metrics.run }))) : responseSummary(phase.inputLatencies.map(input => ({ ...input, run: metrics.run }))),
  handlerMs: summary(phase.inputLatencies.flatMap(input => input.handlerMs === undefined ? [] : [input.handlerMs])),
  handlerReturnToDrawMs: summary(phase.inputLatencies.flatMap(input => input.handlerReturnToDrawMs === undefined ? [] : [input.handlerReturnToDrawMs])),
  readbackProbeMs: summary(metrics.actions.filter(action => action.phase === phase.name).map(action => action.probeBeforeMs + action.probeAfterMs)), frameInputProbeMs: summary(phase.frames.map(frame => frame.inputProbeMs)), unpresentedInputs: phase.unpresentedInputs,
}));

async function oldGenerator(relative: string, exported: string): Promise<(project: Project, pageScreens: Parameters<typeof createUiControlRuntime>[1]) => string> {
  const original = await fs.readFile(path.join(baselineRoot, relative), 'utf8');
  const generated = await bundle({ stdin: { contents: original, resolveDir: path.dirname(path.join(root, relative)), sourcefile: relative, loader: 'ts' }, bundle: true, platform: 'node', format: 'esm', target: 'node22', write: false, logLevel: 'silent' });
  const destination = path.join(output, 'baseline-modules', path.basename(relative, '.ts') + '.mjs');
  await fs.mkdir(path.dirname(destination), { recursive: true }); await fs.writeFile(destination, generated.outputFiles[0].contents);
  const module = await import(pathToFileURL(destination).href);
  assert.equal(typeof module[exported], 'function'); return module[exported];
}

async function replaceSelectedRuntimeGenerators(project: Project) {
  const manifestPath = path.join(path.dirname(baselineRoot), 'validation-main/baseline-source.json');
  const manifestBytes = await fs.readFile(manifestPath);
  const manifest: { file: string; sha256: string }[] = JSON.parse(manifestBytes.toString('utf8'));
  assert.equal(new Set(manifest.map(entry => entry.file)).size, manifest.length, 'Frozen manifest paths must be unique.');
  report.baselineManifest = { path: manifestPath, sha256: sha256(manifestBytes) };
  const snapshots = new Map<string, string>();
  const sources = await Promise.all(baselineModules.map(async relative => {
    const before = await fs.readFile(path.join(baselineRoot, relative), 'utf8');
    const after = await fs.readFile(path.join(root, relative), 'utf8');
    const expected = manifest.find(entry => entry.file === relative);
    assert.ok(expected, 'Every selected baseline module must be in the frozen manifest: ' + relative);
    assert.equal(sha256(before), expected.sha256, 'Frozen source must match its recorded pre-implementation hash: ' + relative);
    let input = before;
    let scope = 'complete frozen module';
    let assignmentHashes: { beforeSha256: string; afterSha256: string } | undefined;
    if (relative === 'src/runtime/ui-runtime.ts') {
      // Other work in this round also touches page/media lifecycle here. Keep
      // that common to A/B; revert exactly the performance metadata change.
      const assignment = /^    vn_ui_allowed_properties = .*$/gm;
      const oldLines = before.match(assignment), currentLines = after.match(assignment);
      assert.equal(oldLines?.length, 1, 'Frozen property metadata assignment must be unique.');
      assert.equal(currentLines?.length, 1, 'Current property metadata assignment must be unique.');
      input = after.replace(currentLines![0], () => oldLines![0]);
      scope = 'only vn_ui_allowed_properties assignment from snapshot; other current ui-runtime changes shared by A/B';
      assignmentHashes = { beforeSha256: sha256(oldLines![0]), afterSha256: sha256(currentLines![0]) };
    }
    snapshots.set(path.resolve(root, relative).toLowerCase(), input);
    return { relative, scope, beforeSourceSha256: sha256(before), afterSourceSha256: sha256(after), baselineGeneratorInputSha256: sha256(input), assignmentHashes, changed: input !== after };
  }));
  const used = new Set<string>();
  const overrides: Plugin = { name: 'frozen-menu-performance-baseline', setup(build) {
    build.onLoad({ filter: /[\\/]src[\\/]runtime[\\/][^\\/]+\.ts$/ }, args => {
      const contents = snapshots.get(path.resolve(args.path).toLowerCase());
      if (contents === undefined) return;
      used.add(path.relative(root, args.path).replaceAll('\\', '/'));
      return { contents, loader: 'ts', resolveDir: path.dirname(args.path) };
    });
  } };
  const generated: Record<string, unknown> = {};
  for (const [relative, exported, filename, currentGenerator] of [
    ['src/runtime/ui-runtime.ts', 'createUiRuntime', 'game/00-vn-ui.rpy', createUiRuntime],
    ['src/runtime/screens.ts', 'createScreens', 'game/screens.rpy', createScreens],
  ] as const) {
    const compiled = await bundle({ entryPoints: [path.join(root, relative)], bundle: true, platform: 'node', format: 'esm', target: 'node22', write: false, logLevel: 'silent', plugins: [overrides] });
    const destination = path.join(output, 'baseline-modules', path.basename(relative, '.ts') + '.mjs');
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, compiled.outputFiles[0].contents);
    const module = await import(pathToFileURL(destination).href);
    assert.equal(typeof module[exported], 'function');
    const currentCode = currentGenerator(project), oldCode = module[exported](project) as string;
    const currentFile = await fs.readFile(path.join(players.after, filename), 'utf8');
    assert.equal(currentFile, currentCode, 'The current generator must reproduce the complete compiled file: ' + filename);
    await fs.writeFile(path.join(players.baseline, filename), oldCode);
    generated[filename] = { beforeSha256: sha256(oldCode), afterSha256: sha256(currentCode), changed: oldCode !== currentCode };
  }
  for (const relative of baselineModules) assert.ok(used.has(relative), 'Every selected baseline module must be reachable from the two generators: ' + relative);
  assert.ok(sources.some(source => source.changed), 'The selected baseline must predate at least one product implementation.');
  assert.ok(Object.values(generated).some(value => (value as { changed: boolean }).changed), 'The real fixture must exercise changed generated code.');
  report.baselinePatches = sources;
  report.baselineModules = baselineModules;
  report.generatedSha256 = generated;
  report.baselineScope = 'Only the explicit performance module scopes and their generated UI/screens output differ; ui-runtime replaces only its allowed-properties metadata assignment. Imports outside the allowlist, other runtime work, assets and fixture are current and identical in both players.';
}

async function profileReference(authorHash: string): Promise<{ reportPath: string; directory: string; run: string; metrics: Metrics }> {
  assert.ok(referenceOption && !referenceOption.startsWith('--'), '--profile-after requires --reference-report=<passed ABBA report path>.');
  const reportPath = path.resolve(referenceOption);
  const prior: { status?: string; mode?: string; authorSha256Before?: string; authorSha256After?: string; comparisons?: unknown; runs?: { variant: string; run: string }[] } = JSON.parse(await fs.readFile(reportPath, 'utf8'));
  assert.ok(prior.status === 'passed' && prior.mode !== 'profile-after' && prior.comparisons && prior.authorSha256Before === authorHash && prior.authorSha256After === authorHash, 'Profile reference must be a passed ABBA with an identical author project hash.');
  const baseline = prior.runs?.find(run => run.variant === 'baseline');
  assert.ok(baseline, 'A passed ABBA must include the historical baseline.');
  const directory = path.dirname(reportPath);
  const metrics: Metrics = JSON.parse(await fs.readFile(path.join(directory, 'metrics-' + baseline.run + '.json'), 'utf8'));
  return { reportPath, directory, run: baseline.run, metrics };
}

// Injected only for --profile-after. The ordinary ABBA receives none of these
// imports, callbacks or wrappers, preserving the measured execution path.
const profileRuntime = () => `    import cProfile as qa_cprofile, pstats as qa_pstats
    qa_profiles = qa_builtins.dict(active=None, records=qa_builtins.list(), hooks=qa_builtins.dict())
    qa_profile_phases = ("title_hover", "open_preferences", "preferences_slider")
    qa_profile_root = ${q(path.join(output, 'profiles'))}

    def qa_profile_hook(owner, attribute, name):
        try:
            original = getattr(owner, attribute)
            def measured(*args, **kwargs):
                active = qa_profiles["active"]
                if active is None: return original(*args, **kwargs)
                start = qa_time.perf_counter()
                try: return original(*args, **kwargs)
                finally:
                    elapsed = (qa_time.perf_counter() - start) * 1000
                    row = active["wall"].setdefault(name, qa_builtins.dict(calls=0, ms=0.0, maxMs=0.0))
                    row["calls"] += 1
                    row["ms"] += elapsed
                    row["maxMs"] = max(row["maxMs"], elapsed)
            setattr(owner, attribute, measured)
            qa_profiles["hooks"][name] = "available"
        except (AttributeError, TypeError) as error:
            # Some SDK renderer methods are immutable C-extension attributes.
            # Keep exact Interface/render timings and report the missing split.
            qa_profiles["hooks"][name] = "unavailable: " + str(error)

    def qa_profile_begin(name):
        if name not in qa_profile_phases: return
        if qa_profiles["active"] is not None: raise Exception("Unclosed diagnostic profile")
        if not qa_profiles["hooks"]:
            qa_profile_hook(renpy.display.render, "render_screen", "renderTree")
            qa_profile_hook(renpy.display.render, "mark_sweep", "renderCleanup")
            qa_profile_hook(renpy.display.draw, "draw_screen", "rendererDraw")
        profiler = qa_cprofile.Profile(timer=qa_time.perf_counter)
        qa_profiles["active"] = qa_builtins.dict(name=name, profiler=profiler, wall=qa_builtins.dict())
        profiler.enable()

    def qa_profile_end():
        active = qa_profiles["active"]
        if active is None: return
        active["profiler"].disable()
        qa_profiles["active"] = None
        qa_profiles["records"].append(active)

    def qa_profile_write():
        qa_profile_end()
        qa_os.makedirs(qa_profile_root, exist_ok=True)
        evidence = qa_builtins.list()
        for record in qa_profiles["records"]:
            stem = qa_os.path.join(qa_profile_root, qa_run + "-" + record["name"])
            record["profiler"].dump_stats(stem + ".pstats")
            with open(stem + ".txt", "w", encoding="utf-8") as stream:
                stream.write("DIAGNOSTIC ONLY: cProfile and wall hooks add overhead; timings are not an ABBA performance comparison.\\n")
                stats = qa_pstats.Stats(record["profiler"], stream=stream)
                stream.write("\\nCUMULATIVE TIME\\n")
                stats.sort_stats("cumulative").print_stats(100)
                stream.write("\\nSELF TIME\\n")
                stats.sort_stats("tottime").print_stats(100)
                stream.write("\\nCALLERS OF UI AND RENDER HOTSPOTS\\n")
                stats.sort_stats("cumulative").print_callers("vn_ui_|VnUiImage|VnSkin|load_surface|render_screen|draw_screen|mark_sweep|Transform|Layout|slast|layout.py|im.py", 120)
            evidence.append(qa_builtins.dict(name=record["name"], stats=stem + ".pstats", text=stem + ".txt", wall=record["wall"]))
        return qa_builtins.dict(diagnosticOnly=True, timingComparable=False, hooks=qa_profiles["hooks"], phases=evidence)

`;

function testCode(project: Project): string {
  const main = project.ui.components.filter(component => component.page === 'main');
  const preferencesPage = project.ui.components.filter(component => component.page === 'preferences');
  const one = (candidates: typeof main, purpose: string) => {
    assert.equal(candidates.length, 1, `Expected one enabled ${purpose}; found: ${candidates.map(component => component.id).join(', ')}`);
    return candidates[0];
  };
  const rig = main.find(component => component.kind === 'spine');
  const settings = one(main.filter(component => component.kind === 'button' && component.disabled !== true && component.action === 'preferences'), 'title settings button');
  // The sample has disabled language arrows with a historical return action.
  // Select the real available return, never the first action-shaped placeholder.
  const back = one(preferencesPage.filter(component => component.kind === 'button' && component.disabled !== true && component.action === 'return'), 'settings return button');
  const slider = one(preferencesPage.filter(component => component.kind === 'preference' && component.disabled !== true && component.preference === 'musicVolume'), 'music slider');
  const choice = one(preferencesPage.filter(component => component.kind === 'button' && component.disabled !== true && component.action === 'setPlayerPreference' && component.preference === 'skipAll' && component.preferenceValue === true), 'skip-all button');
  assert.ok(rig && settings && back && slider && choice, 'The author snapshot must contain the real title Spine, settings entry, return, music slider and skip option.');
  const hoverButtons = main.filter(component => component.kind === 'button' && component.disabled !== true && component.width > .03 && component.height > .02).slice(0, 6);
  const hover = Array.from({ length: 2 }, () => hoverButtons.map(component => `    $ qa_expect_hover(${q(component.id)})\n    move id ${q('vn_component_' + component.id)}\n    pause .06`).join('\n')).join('\n');
  const drag = Array.from({ length: 2 }, (_, index) => `    drag id ${q('vn_component_' + slider.id + '_control')} pos (${index ? '.8' : '.2'}, .5) to id ${q('vn_component_' + slider.id + '_control')} pos (${index ? '.2' : '.8'}, .5) steps 20\n    pause .12`).join('\n');
  report.fixture = { sourceId: project.id, resolution: [project.width, project.height], mainControls: main.length, preferenceControls: preferencesPage.length, totalControls: project.ui.components.length, rig: rig.id, settings: settings.id, back: back.id, backText: back.text, slider: slider.id, choice: choice.id, hoverButtons: hoverButtons.map(component => component.id), excludedDisabledReturns: preferencesPage.filter(component => component.kind === 'button' && component.disabled === true && component.action === 'return').map(component => component.id) };
  return `init -999 python:
    import renpy as qa_engine
    qa_engine.safe_mode_checked = True

init 1000 python:
    import time as qa_time, json as qa_json, os as qa_os, builtins as qa_builtins
    qa_state = qa_builtins.dict(active=None, phases=qa_builtins.list(), actions=qa_builtins.list(), guards=qa_builtins.dict(), intent=None, lastFrame=None)
    qa_run = qa_os.environ.get("VNS_MENU_PROFILE_RUN", "unknown")
    qa_rig = ${q(rig.id)}
    qa_slider = ${q(slider.id)}
    qa_original_layout = vn_ui_layout_resolve
    qa_original_image_poll = vn_ui_image_poll
    qa_original_spine_poll = vns_spine.poll
    qa_original_draw = renpy.display.core.Interface.draw_screen
    qa_original_decode = renpy.display.pgrender.load_image

${menuPerformanceInputRuntime}${profileAfter ? profileRuntime() : ''}    def qa_layout(identities=None):
        phase = qa_state["active"]
        if phase is None: return qa_original_layout(identities)
        size = sum(len(items) for items in vn_ui_layout_pages.values()) if identities is None else len(identities)
        start = qa_time.perf_counter()
        try: return qa_original_layout(identities)
        finally:
            phase["layoutMs"] += (qa_time.perf_counter() - start) * 1000
            phase["layoutCalls"] += 1
            phase["layoutRows"] += size
            phase["layoutGlobalCalls"] += int(identities is None)
            sizes = phase["layoutSizes"]
            sizes[str(size)] = sizes.get(str(size), 0) + 1

    def qa_image_poll():
        phase = qa_state["active"]
        if phase is None: return qa_original_image_poll()
        start = qa_time.perf_counter()
        try: return qa_original_image_poll()
        finally:
            phase["imagePollMs"] += (qa_time.perf_counter() - start) * 1000
            phase["imagePolls"] += 1
    qa_image_poll.__dict__.update(qa_original_image_poll.__dict__)

    def qa_decode(filelike, filename, *args, **kwargs):
        phase = qa_state["active"]
        if phase is not None:
            phase["decodeCalls"] += 1
            phase["decodeFiles"][filename] = phase["decodeFiles"].get(filename, 0) + 1
        return qa_original_decode(filelike, filename, *args, **kwargs)

    def qa_spine_poll():
        phase = qa_state["active"]
        if phase is None: return qa_original_spine_poll()
        start = qa_time.perf_counter()
        try: return qa_original_spine_poll()
        finally:
            phase["spinePollMs"] += (qa_time.perf_counter() - start) * 1000
            phase["spinePolls"] += 1

    def qa_draw(self, widget, fullscreen_video, draw):
        phase = qa_state["active"]
        start = qa_time.perf_counter() if phase is not None and draw else None
        result = qa_original_draw(self, widget, fullscreen_video, draw)
        if start is None: return result
        now = qa_time.perf_counter()
        last = qa_state["lastFrame"]
        qa_input["nextFrame"] += 1
        frame = qa_builtins.dict(frameId=qa_input["nextFrame"], startedAt=start, completedAt=now, frameMs=(now-last)*1000 if last is not None else None, drawMs=(now-start)*1000)
        phase["frames"].append(frame)
        qa_state["lastFrame"] = now
        state = vn_spine_states.get(qa_rig)
        if state:
            phase["spineSamples"].append(qa_builtins.dict(sourceSequence=state["sourceSequence"], time=state["time"], speed=state["speed"], status=state["status"]))
        qa_input_frame(phase, frame)
        return result

    vn_ui_layout_resolve = qa_layout
    vn_ui_image_poll = qa_image_poll
    vns_spine.poll = qa_spine_poll
    renpy.display.core.Interface.draw_screen = qa_draw
    renpy.display.pgrender.load_image = qa_decode

    def qa_begin(name):
        if qa_state["active"] is not None: raise Exception("Unclosed measurement phase")
${profileAfter ? '        qa_profile_begin(name)\n' : ''}        qa_state["active"] = qa_builtins.dict(name=name, started=qa_time.perf_counter(), layoutCalls=0, layoutRows=0, layoutGlobalCalls=0, layoutMs=0.0, layoutSizes=qa_builtins.dict(), imagePolls=0, imagePollMs=0.0, decodeCalls=0, decodeFiles=qa_builtins.dict(), spinePolls=0, spinePollMs=0.0, unpresentedInputs=0, inputEventIds=qa_builtins.list(), actionIds=qa_builtins.list(), frames=qa_builtins.list(), inputLatencies=qa_builtins.list(), spineSamples=qa_builtins.list())
        qa_state["lastFrame"] = qa_state["intent"] = None

    def qa_end():
        phase = qa_state["active"]
        if phase is None: return
${profileAfter ? '        qa_profile_end()\n' : ''}        phase["wallSeconds"] = qa_time.perf_counter() - phase.pop("started")
        qa_input_end(phase)
        qa_state["active"] = qa_state["intent"] = None
        qa_state["phases"].append(phase)

    def qa_rows(page):
        rows = qa_original_layout(vn_ui_layout_pages[page])
        return {identity: {key: value[key] for key in ("width", "height", "visible", "bounds", "renderMatrix", "clippedOut")} for identity, value in rows.items()}

    def qa_capture_guards(label):
        rig = vn_spine_states.get(qa_rig)
        images = {identity: {key: value.get(key) for key in ("assetId", "status", "width", "height", "error")} for identity, value in vn_ui_image_loads.items()}
        qa_state["guards"][label] = qa_builtins.dict(rig={key: rig[key] for key in ("assetId", "animation", "sourceSequence", "speed", "status")} if rig else None, images=images, mainRows=qa_rows("ui:main"), preferenceRows=qa_rows("ui:preferences"), musicVolume=vn_preference_get("musicVolume"), skipAll=vn_preference_get("skipAll"), liveSpine=qa_builtins.list(vns_spine._live))

    def qa_live_geometry_guard():
        helper = globals().get("vn_ui_layout_for_components")
        if helper is None: return True
        expected = qa_original_layout(vn_ui_layout_pages["ui:main"])
        actual = helper((qa_rig, qa_rig))
        if actual != expected or helper(()) != {}: return False
        original = vn_ui_get(qa_rig, "width")
        before = actual[qa_rig]["width"]
        vn_ui_set(qa_rig, "width", original * .75)
        changed = helper((qa_rig,))[qa_rig]["width"]
        vn_ui_set(qa_rig, "width", original)
        restored = helper((qa_rig,))[qa_rig]["width"]
        qa_state["guards"]["liveGeometry"] = qa_builtins.dict(controls=len(actual), before=before, changed=changed, restored=restored)
        return abs(changed-before*.75) < .01 and abs(restored-before) < .01

    def qa_spine_continuous():
        frames = next(phase for phase in qa_state["phases"] if phase["name"] == "title_idle")["spineSamples"]
        return len(frames) >= 8 and len(set(frame["sourceSequence"] for frame in frames)) == 1 and len(set(round(frame["time"], 3) for frame in frames)) >= 5 and all(frame["speed"] == ${q(rig.spine?.speed ?? 1)} and frame["status"] not in ("failed", "completed") for frame in frames)

    def qa_write():
        qa_end()
        data = qa_builtins.dict(run=qa_run, inputTraceVersion=2, inputEvents=qa_input["events"], renderer=renpy.get_renderer_info(), renderPreferences=qa_builtins.dict(glFramerate=preferences.gl_framerate, fullscreen=preferences.fullscreen, physicalSize=renpy.get_physical_size()), phases=qa_state["phases"], controls={page: len(items) for page,items in vn_ui_layout_pages.items()}, guards=qa_state["guards"], actions=qa_state["actions"])
${profileAfter ? '        data["profiling"] = qa_profile_write()\n' : ''}        with open(config.basedir + "/metrics-" + qa_run + ".json", "w", encoding="utf-8") as stream: qa_json.dump(data, stream, indent=2)

testsuite global:
    before testcase:
        $ _test.timeout = 25.0
        $ _test.maximum_framerate = False
        $ _test.transition_timeout = .1
        $ _test.screenshot_directory = ${q(path.join(output, 'screenshots'))} + "/" + qa_run
        $ preferences.text_cps = 0
        $ vn_preference_set("musicVolume", .5)
        $ vn_preference_set("skipAll", False)
    after testcase:
        $ qa_write()
    teardown:
        $ qa_input_restore()
        $ renpy.display.pgrender.load_image = qa_original_decode
        exit

testcase real_title_and_preferences:
    pause until screen "main_menu"
    pause until eval vn_ui_get(qa_rig, "spinePlaying")
    move pos (8, 8)
    pause .6
    $ qa_capture_guards("titleBefore")
    $ qa_begin("title_idle")
    pause 3.0
    $ qa_end()
    assert eval qa_spine_continuous()
    assert eval not vn_ui_get(qa_rig, "spineError")
    screenshot "01-title-idle.png"
    assert eval all(vn_ui_component_available(identity) for identity in ${q([...new Set([...hoverButtons.map(component => component.id), settings.id])])})
    $ qa_begin("title_hover")
${hover}
    $ qa_end()
    assert eval len(next(phase for phase in qa_state["phases"] if phase["name"] == "title_hover")["inputLatencies"]) >= ${Math.max(3, hoverButtons.length)}
    $ qa_begin("open_preferences")
    $ qa_expect_screen("preferences", ${q(settings.id)})
    click id ${q('vn_component_' + settings.id)}
    pause until screen "preferences"
    pause .12
    $ qa_end()
    assert screen "preferences"
    assert eval len(next(phase for phase in qa_state["phases"] if phase["name"] == "open_preferences")["inputLatencies"]) >= 1
    move pos (8, 8)
    pause .6
    assert eval qa_rig not in vns_spine._live
    assert eval vn_ui_component_available(${q(back.id)}) and vn_ui_component_available(${q(choice.id)}) and vn_ui_control_available(${q(slider.id)})
    $ qa_capture_guards("preferencesBefore")
    $ qa_begin("preferences_idle")
    pause 2.0
    $ qa_end()
    assert eval not any(value.get("status") == "failed" for identity,value in vn_ui_image_loads.items() if vn_ui_component_pages.get(identity) == "ui:preferences")
    screenshot "02-preferences-idle.png"
    $ qa_begin("preferences_slider")
${drag}
    $ qa_end()
    assert eval len(qa_state["actions"]) >= 20
    assert eval len(next(phase for phase in qa_state["phases"] if phase["name"] == "preferences_slider")["inputLatencies"]) >= 20
    assert eval .05 < vn_preference_get("musicVolume") < .4
    assert eval abs(vn_ui_get(qa_slider, "numberValue") - vn_preference_get("musicVolume")) < .0001
    click id ${q('vn_component_' + choice.id)}
    assert eval vn_preference_get("skipAll") is True
    move pos (8, 8)
    pause .15
    $ qa_capture_guards("preferencesAfter")
    screenshot "03-preferences-after-drag.png"
    $ qa_begin("return_title")
    $ qa_expect_screen("main_menu", ${q(back.id)})
    click id ${q('vn_component_' + back.id)}
    pause until screen "main_menu"
    pause .2
    $ qa_end()
    assert eval len(next(phase for phase in qa_state["phases"] if phase["name"] == "return_title")["inputLatencies"]) >= 1
    pause until eval vn_ui_get(qa_rig, "spinePlaying")
    assert eval not vn_ui_get(qa_rig, "spineError")
    assert eval not any(vn_ui_component_pages.get(identity) == "ui:preferences" for identity in vn_ui_image_live())
    $ qa_capture_guards("titleAfter")
    $ qa_geometry_pass = qa_live_geometry_guard()
    assert eval qa_geometry_pass
    assert eval abs(vn_preference_get("musicVolume") - qa_state["guards"]["preferencesAfter"]["musicVolume"]) < .0001
    screenshot "04-title-returned.png"
`;
}

try {
  await fs.mkdir(output, { recursive: true }); await fs.mkdir(source, { recursive: true }); await isolateRenpySaves(output);
  const raw = await fs.readFile(authorFile); beforeHash = sha256(raw); report.authorSha256Before = beforeHash;
  const reference = profileAfter ? await profileReference(beforeHash) : undefined;
  if (reference) report.reference = { reportPath: reference.reportPath, run: reference.run, purpose: 'Only semantic, asset, geometry and static screenshot guards; historical timings are not compared.' };
  const original = projectSchema.parse(JSON.parse(raw.toString('utf8')));
  const project = structuredClone(original); project.id = 'menu_performance_runtime';
  project.playerDefaults = { ...project.playerDefaults, fullscreen: false };
  await fs.writeFile(path.join(source, 'project.vns.json'), JSON.stringify(project, null, 2));
  const tests = testCode(project); await fs.writeFile(path.join(output, 'testcases.rpy'), tests);
  const compiledProject = await withPortraitMetadata(project, path.dirname(authorFile));
  const built = await buildProject({ project: compiledProject, projectDir: path.dirname(authorFile), sdkRoot: sdk, outputDir: players.after, development: true, preview: { flowStart: 'title' } });
  await saveRun('compile-after', { code: built.ok ? 0 : 1, log: built.log + '\n' + JSON.stringify(built.diagnostics) });
  if (!profileAfter) {
    await fs.cp(players.after, players.baseline, { recursive: true });
    const pipelineProject = projectSchema.parse(compiledProject); normalizeChapterCompositions(pipelineProject);
    const timed = interleaveProjectTimelines(timelinePlaybackLayout(pipelineProject));
    if (legacyBaseline) {
      const uiProject = { ...timed, ui: effectiveUiTheme(timed.ui) };
      const sourcePath = path.join(players.baseline, 'game/00-vn-ui.rpy'); let baselineUi = await fs.readFile(sourcePath, 'utf8');
      const sources = [
        ['src/runtime/ui-layout-runtime.ts', 'createUiLayoutRuntime', createUiLayoutRuntime],
        ['src/runtime/ui-video-runtime.ts', 'createUiVideoRuntime', createUiVideoRuntime],
        ['src/runtime/ui-image-runtime.ts', 'createUiImageRuntime', createUiImageRuntime],
        ['src/runtime/ui-control-runtime.ts', 'createUiControlRuntime', createUiControlRuntime],
      ] as const;
      const patches: unknown[] = [];
      for (const [relative, exported, currentGenerator] of sources) {
        const old = await oldGenerator(relative, exported), currentCode = currentGenerator(uiProject, uiPageHostScreens), oldCode = old(uiProject, uiPageHostScreens);
        const index = baselineUi.indexOf(currentCode);
        assert.ok(index >= 0 && baselineUi.indexOf(currentCode, index + 1) < 0, 'Generated code must match exactly once before baseline replacement: ' + relative);
        assert.notEqual(currentCode, oldCode, 'Baseline snapshot must predate this implementation: ' + relative);
        baselineUi = baselineUi.slice(0, index) + oldCode + baselineUi.slice(index + currentCode.length);
        patches.push({ relative, beforeSourceSha256: sha256(await fs.readFile(path.join(baselineRoot, relative))), afterSourceSha256: sha256(await fs.readFile(path.join(root, relative))), beforeGeneratedSha256: sha256(oldCode), afterGeneratedSha256: sha256(currentCode) });
      }
      await fs.writeFile(sourcePath, baselineUi);
      const oldSpine = await fs.readFile(path.join(baselineRoot, 'resources/spine/vns_spine.py'));
      await fs.writeFile(path.join(players.baseline, 'game/python-packages/vns_spine.py'), oldSpine);
      patches.push({ relative: 'resources/spine/vns_spine.py', beforeSourceSha256: sha256(oldSpine), afterSourceSha256: sha256(await fs.readFile(path.join(root, 'resources/spine/vns_spine.py'))) });
      report.baselinePatches = patches;
      const runtimePrefix = await fs.readFile(path.join(players.after, 'game/00-vn-ui.rpy'), 'utf8');
      report.generatedSha256 = { baseline: sha256(baselineUi), after: sha256(runtimePrefix) };
    } else {
      await replaceSelectedRuntimeGenerators(timed);
    }
  } else {
    report.generatedSha256 = { after: sha256(await fs.readFile(path.join(players.after, 'game/00-vn-ui.rpy'))) };
    report.profileSourceSha256 = Object.fromEntries(await Promise.all(['src/runtime/ui-runtime.ts', 'src/runtime/screens.ts', 'src/runtime/ui-widgets.ts', 'src/runtime/ui-control-runtime.ts', 'src/runtime/ui-layout-runtime.ts', 'src/runtime/ui-video-runtime.ts', 'src/runtime/ui-image-runtime.ts', 'resources/spine/vns_spine.py'].map(async relative => [relative, sha256(await fs.readFile(path.join(root, relative)))])));
  }
  for (const [variant, game] of Object.entries(profileAfter ? { after: players.after } : players)) {
    await fs.writeFile(path.join(game, 'game/testcases.rpy'), tests);
    await saveRun('lint-' + variant, await runRenpy(sdk, game, ['lint'], { savedir: path.join(output, 'saves', variant), timeoutMs: 120000 }));
  }
  report.status = 'running'; await save();
  const order = profileAfter ? ['after'] as const : ['baseline', 'after', 'after', 'baseline'] as const;
  const results: { variant: 'baseline' | 'after'; run: string; metrics: Metrics }[] = [];
  for (const [index, variant] of order.entries()) {
    const name = `${index + 1}-${variant}`, game = players[variant];
    const native = await runRenpy(sdk, game, ['test', '--report-detailed'], { savedir: path.join(output, 'saves', name), timeoutMs: 120000, onData: text => process.stdout.write(text), env: { RENPY_RENDERER: 'gl2', PYTHONUNBUFFERED: '1', VNS_MENU_PROFILE_RUN: name } });
    // Preserve metrics even when an assertion fails, before raising the result.
    const metricsPath = path.join(game, 'metrics-' + name + '.json');
    if (await fs.stat(metricsPath).catch(() => undefined)) await fs.copyFile(metricsPath, path.join(output, 'metrics-' + name + '.json'));
    await saveRun('runtime-' + name, native);
    assert.match(native.log, /Test cases\s*:\s*1\s*\|\s*1 passed/);
    const metrics: Metrics = JSON.parse(await fs.readFile(metricsPath, 'utf8'));
    const inputTrace = auditMenuInputTrace(metrics);
    results.push({ variant, run: name, metrics });
    (report.runs as unknown[]).push({ variant, run: name, cases: 1, assertions: Number(native.log.match(/Assertions\s*:\s*(\d+)/)?.[1]), renderer: metrics.renderer, renderPreferences: metrics.renderPreferences, profiling: metrics.profiling, inputTrace, phases: summarize(metrics), report: path.join(output, 'metrics-' + name + '.json') }); await save();
  }
  const baseline = reference ? [{ variant: 'baseline' as const, run: reference.run, metrics: reference.metrics }] : results.filter(result => result.variant === 'baseline'), after = results.filter(result => result.variant === 'after');
  for (const result of after) {
    const idle = result.metrics.phases.find(phase => phase.name === 'title_idle')!;
    assert.equal(idle.layoutGlobalCalls, 0, 'Visible title media must not parse all hidden pages.');
    assert.ok(idle.layoutCalls > 0 && idle.layoutRows / idle.layoutCalls <= result.metrics.controls['ui:main'], 'Title layout work is limited to the complete title page.');
    assert.deepEqual(result.metrics.guards.preferencesBefore, baseline[0].metrics.guards.preferencesBefore, 'Same initial UI geometry, assets, loaded state and settings.');
    assert.deepEqual(result.metrics.guards.preferencesAfter, baseline[0].metrics.guards.preferencesAfter, 'Actual drag/click produces identical UI geometry, assets and settings.');
  }
  if (!profileAfter) {
    if (legacyBaseline) {
      for (const result of baseline) assert.ok(result.metrics.phases.find(phase => phase.name === 'title_idle')!.layoutGlobalCalls > 0, 'The historical player must reproduce the global-layout hotspot.');
    } else {
      for (const result of baseline) assert.equal(result.metrics.phases.find(phase => phase.name === 'title_idle')!.layoutGlobalCalls, 0, 'The build08 baseline already contains the previous owner-page layout fix.');
    }
    const semantics = (metrics: Metrics) => metrics.actions.map(action => ({ phase: action.phase, eventType: action.eventType, source: action.source, ratio: action.ratio, reverse: action.reverse, valueBefore: action.valueBefore, valueAfter: action.valueAfter, sourceBefore: action.sourceBefore, sourceAfter: action.sourceAfter, normalizedBefore: action.normalizedBefore, normalizedAfter: action.normalizedAfter }));
    for (const result of results) {
      assert.deepEqual(semantics(result.metrics), semantics(baseline[0].metrics), 'Both variants must consume identical actual slider actions and read back identical values.');
      assert.deepEqual(result.metrics.renderPreferences, baseline[0].metrics.renderPreferences, 'Both variants must use the same native rendering preferences.');
    }
    const phaseAggregate = (variant: typeof baseline, name: string) => {
      const phases = variant.map(result => result.metrics.phases.find(phase => phase.name === name)!);
      const wall = phases.reduce((total, phase) => total + phase.wallSeconds, 0);
      const inputs = phases.flatMap((phase, index) => phase.inputLatencies.map(input => ({ ...input, run: variant[index].run })));
      const actions = variant.flatMap(result => result.metrics.actions.filter(action => action.phase === name));
      return {
        wallSeconds: wall,
        layoutCalls: phases.reduce((total, phase) => total + phase.layoutCalls, 0),
        layoutMs: phases.reduce((total, phase) => total + phase.layoutMs, 0),
        layoutMsPerSecond: phases.reduce((total, phase) => total + phase.layoutMs, 0) / wall,
        layoutControlsPerCall: phases.reduce((total, phase) => total + phase.layoutRows, 0) / Math.max(1, phases.reduce((total, phase) => total + phase.layoutCalls, 0)),
        imageCallsPerSecond: phases.reduce((total, phase) => total + phase.imagePolls, 0) / wall,
        actualDecodeCalls: phases.reduce((total, phase) => total + phase.decodeCalls, 0),
        frameMs: summary(phases.flatMap(phase => phase.frames.flatMap(frame => frame.frameMs === null ? [] : [frame.frameMs]))),
        drawMs: summary(phases.flatMap(phase => phase.frames.map(frame => frame.drawMs))),
        inputToFrameMs: ['open_preferences', 'return_title'].includes(name) ? smallSampleResponses(inputs) : responseSummary(inputs),
        handlerMs: summary(inputs.flatMap(input => input.handlerMs === undefined ? [] : [input.handlerMs])),
        handlerReturnToDrawMs: summary(inputs.flatMap(input => input.handlerReturnToDrawMs === undefined ? [] : [input.handlerReturnToDrawMs])),
        readbackProbeMs: summary(actions.map(action => action.probeBeforeMs + action.probeAfterMs)),
        frameInputProbeMs: summary(phases.flatMap(phase => phase.frames.map(frame => frame.inputProbeMs))),
        unpresentedInputs: phases.reduce((total, phase) => total + phase.unpresentedInputs, 0),
      };
    };
    const comparisons = ['title_idle', 'title_hover', 'open_preferences', 'preferences_idle', 'preferences_slider', 'return_title'].map(name => ({ name, baseline: phaseAggregate(baseline, name), after: phaseAggregate(after, name) }));
    if (legacyBaseline) assert.ok(comparisons[0].after.layoutControlsPerCall < comparisons[0].baseline.layoutControlsPerCall * .25, 'Title per-call layout scope must shrink substantially.');
    report.comparisons = comparisons;
  } else {
    for (const phase of ['title_hover', 'open_preferences', 'preferences_slider']) {
      for (const extension of ['pstats', 'txt']) assert.ok((await fs.stat(path.join(output, 'profiles', after[0].run + '-' + phase + '.' + extension))).size > 0, 'Profile evidence must exist for ' + phase);
    }
  }
  const readScreenshot = async (run: string, suffix: string, sourceRoot = output) => {
    const directory = path.join(sourceRoot, 'screenshots', run), files = await fs.readdir(directory);
    const name = files.find(file => file.endsWith(suffix)); assert.ok(name, 'Missing screenshot: ' + run + '/' + suffix);
    return PNG.sync.read(await fs.readFile(path.join(directory, name)));
  };
  const first = await readScreenshot(baseline[0].run, '02-preferences-idle.png', reference?.directory), second = await readScreenshot(after[0].run, '02-preferences-idle.png');
  assert.equal(first.width, second.width); assert.equal(first.height, second.height);
  let changedPixels = 0;
  for (let i = 0; i < first.data.length; i += 4) if (Math.max(...[0, 1, 2, 3].map(channel => Math.abs(first.data[i + channel] - second.data[i + channel]))) > 3) changedPixels++;
  report.preferencePixels = { width: first.width, height: first.height, changedPixels, fraction: changedPixels / (first.width * first.height), threshold: 3 };
  assert.ok(changedPixels / (first.width * first.height) < .005, 'Static preferences should retain its actual appearance.');
  report.status = 'passed';
} catch (error) { failure = error; report.status = 'failed'; report.error = String(error); process.exitCode = 1; }
finally {
  try {
    const afterHash = sha256(await fs.readFile(authorFile)); report.authorSha256After = afterHash;
    assert.equal(afterHash, beforeHash, 'The real author project must remain unchanged.');
  } catch (error) { failure ??= error; report.status = 'failed'; report.authorCheckError = String(error); process.exitCode = 1; }
  try {
    report.cleanup = await cleanVerificationDirectories(output, ['source', 'baseline-game', 'after-game', 'baseline-modules', 'saves', 'renpy-saves']);
    assert.equal((report.cleanup as { errors: unknown[] }).errors.length, 0, 'Isolated performance players must be cleaned.');
  } catch (error) { failure ??= error; report.status = 'failed'; report.cleanupError = String(error); process.exitCode = 1; }
  if (previousSaveRoot === undefined) delete process.env.RENPY_PATH_TO_SAVES; else process.env.RENPY_PATH_TO_SAVES = previousSaveRoot;
  await save(); console.log(path.join(output, 'report.json'));
  if (failure) console.error(failure);
}
