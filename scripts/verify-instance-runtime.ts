import { endingPerformanceNodes } from '../src/core/ending-migration';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createProject, projectSchema, type Project, type StoryNode, type StageAction } from '../src/core/model';
import { buildProject, runRenpy } from '../src/runtime/service';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sdkRoot = path.join(appRoot, 'resources', 'runtime');
const exampleDir = path.join(appRoot, 'resources', 'example');
const outputRoot = path.join(appRoot, 'artifacts', 'instance-runtime-verification');
const runId = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
const runDir = path.join(outputRoot, runId);
const projectDir = path.join(runDir, 'project');
const screenshotDirectory = `tests/screenshots/${runId}`;

type Step = { name: string; code: number; logPath: string };
const report: {
  runId: string;
  runtime: string;
  project: string;
  screenshotDirectory: string;
  status: 'running' | 'passed' | 'failed';
  steps: Step[];
  checks: Record<string, boolean>;
  screenshots: string[];
  error?: string;
} = {
  runId,
  runtime: sdkRoot,
  project: projectDir,
  screenshotDirectory: path.join(projectDir, screenshotDirectory),
  status: 'running',
  steps: [],
  checks: {},
  screenshots: [],
};

async function writeReport(): Promise<void> {
  await fs.mkdir(runDir, { recursive: true });
  await fs.writeFile(path.join(runDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await fs.writeFile(path.join(outputRoot, 'verification-report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

async function recordStep(name: string, code: number, log: string): Promise<void> {
  const logPath = path.join(runDir, `${name}.log`);
  await fs.writeFile(logPath, log, 'utf8');
  report.steps.push({ name, code, logPath });
  await writeReport();
  console.log(`${name}: ${code === 0 ? 'PASS' : 'FAIL'} (${logPath})`);
  if (code !== 0) throw new Error(`${name} failed with status ${code}.\n${log.slice(-8000)}`);
}

function actionBase(action: StageAction): StageAction {
  return action;
}

function makeProject(sample: Project): Project {
  const project = createProject('实例运行时验收');
  project.id = 'instance_runtime_verification';
  project.width = 1280;
  project.height = 720;

  const background = sample.assets.find(asset => asset.id === 'asset_f1198e9a72940a65bfded78c')!;
  const library = sample.assets.find(asset => asset.id === 'asset_d8f477d6022ec8d409985e6d')!;
  const meadow = sample.assets.find(asset => asset.id === 'asset_c6d77eb070edb21658d66d5d')!;
  const portrait = sample.assets.find(asset => asset.id === 'asset_724f120436c899c75101b627')!;
  const music = sample.assets.find(asset => asset.id === 'asset_71ef3afe95a5b8e39c6c97ff')!;
  project.assets = [background, library, meadow, portrait, music];
  project.chapters = [{ id: 'chapter', name: '实例验收章' }];
  project.variables = [{ id: 'visited', name: '已访问', type: 'boolean', initial: false, persistent: false }];

  const baseFeatureActions: StageAction[] = [
      // The feature belongs to the base blueprint. Calling it from the derived
      // character must remap the authored base-character target to char_child.
      { kind: 'animate', characterId: 'char_base', wait: false, repeat: false, keyframes: [
      { x: 0.58, y: 1, scale: 0.72, rotation: 0, opacity: 1, duration: 0, easing: 'linear' },
      { x: 0.62, y: 1, scale: 0.72, rotation: 2, opacity: 1, duration: 0.15, easing: 'easeout' },
    ] },
    { kind: 'camera', x: 0.01, y: 0, zoom: 1.02, rotation: 0, duration: 0.15, easing: 'easeout', wait: false },
    { kind: 'music', assetId: music.id, loop: true, fade: 0 },
  ];
  project.characters = [
    {
      id: 'char_base', name: '基础角色', color: '#55aa88',
      expressions: [{ id: 'expression_base', name: '平静', assetId: portrait.id }],
      features: [{ id: 'feature_stage', name: '入场演出', actions: baseFeatureActions }],
    },
    {
      id: 'char_child', name: '子角色', color: '#aa6688', baseCharacterId: 'char_base',
      expressions: [], features: [],
    },
  ];

  project.scenes = [
    {
      id: 'scene_base', name: '基础场景', chapterId: 'chapter', parameters: { weather: 'clear', mood: 'calm' },
      entryActions: [
        actionBase({ kind: 'background', assetId: background.id, transition: 'none' }),
        actionBase({ kind: 'show', characterId: 'char_child', expressionId: 'expression_base', x: 0.58, y: 1, scale: 0.72, layer: 1, transition: 'none' }),
      ],
    },
    {
      id: 'scene_child', name: '继承场景', chapterId: 'chapter', baseSceneId: 'scene_base', parameters: { weather: 'rain' },
    },
    {
      id: 'scene_grand', name: '覆盖场景', chapterId: 'chapter', baseSceneId: 'scene_child', parameters: { time: 'night' },
      entryActions: [actionBase({ kind: 'background', assetId: meadow.id, transition: 'none' })],
    },
    {
      id: 'scene_plain', name: '无转场场景', chapterId: 'chapter', parameters: { weather: 'clear', time: 'day' },
      entryActions: [actionBase({ kind: 'background', assetId: library.id, transition: 'none' })],
    },
  ];

  const base = (id: string, sceneId: string) => ({ id, sceneId, name: id, x: 0, y: 0 });
  project.entryId = 'start';
  project.nodes = [
    { ...base('start', 'scene_base'), kind: 'start', next: 'base_passage' },
    { ...base('base_passage', 'scene_base'), kind: 'passage', lines: [{ id: 'line_base', text: '基础场景已进入。', actions: [] }], next: 'jump_fade' },
    {
      ...base('jump_fade', 'scene_base'), kind: 'jump', target: 'child_passage',
      sceneTransition: { mode: 'fade', duration: 0.2, color: '#112233', fromSceneId: 'scene_base', toSceneId: 'scene_child', parameters: { transitionTag: 'fade' } },
    },
    {
      ...base('child_passage', 'scene_child'), kind: 'passage', lines: [{
        id: 'line_child', text: '淡入淡出后，子场景继承参数并调用子角色功能。',
        actions: [actionBase({ kind: 'characterFeature', characterId: 'char_child', featureId: 'feature_stage' })],
      }], next: 'jump_dissolve',
    },
    {
      ...base('jump_dissolve', 'scene_child'), kind: 'jump', target: 'grand_passage',
      sceneTransition: { mode: 'dissolve', duration: 0.15, color: '#000000', fromSceneId: 'scene_child', toSceneId: 'scene_grand', parameters: { transitionTag: 'dissolve' } },
    },
    { ...base('grand_passage', 'scene_grand'), kind: 'passage', lines: [{ id: 'line_grand', text: '溶解后，覆盖场景替换入场背景。', actions: [] }], next: 'jump_none' },
    {
      ...base('jump_none', 'scene_grand'), kind: 'jump', target: 'plain_passage',
      sceneTransition: { mode: 'none', duration: 0, color: '#000000', fromSceneId: 'scene_grand', toSceneId: 'scene_plain', parameters: { transitionTag: 'none' } },
    },
    { ...base('plain_passage', 'scene_plain'), kind: 'passage', lines: [{ id: 'line_plain', text: '无转场直接切换完成。', actions: [] }], next: 'finish' },
    ...endingPerformanceNodes(project, base('finish', 'scene_plain'), '实例运行时验收结束。'),
  ] satisfies StoryNode[];

  const sharedBase = {
    id: 'shared_title', page: 'main' as const, kind: 'text' as const, binding: undefined, assetId: undefined,
    text: '基础界面标题', x: 0.05, y: 0.06, width: 0.42, height: 0.1,
    style: { fontSize: 30, textColor: '#ff6666' },
  };
  project.ui.instances = [
    { id: 'ui_base', name: '基础界面', components: [sharedBase] },
    { id: 'ui_child', name: '子界面', baseUiId: 'ui_base', components: [{ ...sharedBase, text: '子界面覆盖标题', style: { fontSize: 30, textColor: '#66ff99' } }] },
  ];
  project.ui.activeInstanceId = 'ui_child';
  return projectSchema.parse(project);
}

function testcases(): string {
  return `# Runtime verification for scene, character and UI instances.
testsuite global:
    before testcase:
        $ _test.timeout = 12.0
        $ _test.transition_timeout = 0.05
        $ _test.screenshot_directory = ${JSON.stringify(screenshotDirectory)}
        $ preferences.text_cps = 0
        $ preferences.afm_enable = False
        if not screen "main_menu":
            run MainMenu(confirm=False)
    teardown:
        exit

testcase inherited_scene_transitions_and_save_load:
    screenshot "instance-main-menu.png"
    assert eval (renpy.get_widget("main_menu", "vn_component_shared_title") is not None)
    click id "vn_main_start"
    advance until "基础场景已进入。"
    assert eval (vn_current_scene == "scene_base" and vn_scene_parameters["weather"] == "clear")
    assert eval renpy.showing("vn_background_asset_f1198e9a72940a65bfded78c")
    screenshot "scene-base.png"

    advance until "淡入淡出后，子场景继承参数并调用子角色功能。"
    assert eval (vn_current_scene == "scene_child" and vn_pending_scene_transition is None)
    assert eval (vn_scene_parameters["weather"] == "rain" and vn_scene_parameters["mood"] == "calm" and vn_scene_parameters["transitionTag"] == "fade")
    assert eval renpy.showing("vn_background_asset_f1198e9a72940a65bfded78c")
    assert eval renpy.showing("vn_actor_char_child")
    assert eval bool(renpy.music.get_playing(channel="music"))
    screenshot "scene-child-fade-character-feature.png"
    run FileSave("instance_state", confirm=False, slot=True)
    assert eval renpy.can_load("instance_state")

    advance until "溶解后，覆盖场景替换入场背景。"
    assert eval (vn_current_scene == "scene_grand" and vn_pending_scene_transition is None)
    assert eval (vn_scene_parameters["weather"] == "rain" and vn_scene_parameters["time"] == "night" and vn_scene_parameters["transitionTag"] == "dissolve")
    assert eval renpy.showing("vn_background_asset_c6d77eb070edb21658d66d5d")
    screenshot "scene-grand-dissolve-override.png"

    advance until "无转场直接切换完成。"
    assert eval (vn_current_scene == "scene_plain" and vn_pending_scene_transition is None)
    assert eval (vn_scene_parameters["transitionTag"] == "none")
    assert eval renpy.showing("vn_background_asset_d8f477d6022ec8d409985e6d")
    screenshot "scene-plain-none.png"

    run FileLoad("instance_state", confirm=False, slot=True)
    pause until "淡入淡出后，子场景继承参数并调用子角色功能。"
    assert eval (vn_current_scene == "scene_child" and vn_pending_scene_transition is None)
    assert eval (vn_scene_parameters["weather"] == "rain" and vn_scene_parameters["mood"] == "calm" and vn_scene_parameters["transitionTag"] == "fade")
    assert eval renpy.showing("vn_actor_char_child")
    screenshot "scene-child-after-load.png"
    advance until screen "main_menu"
`;
}

async function collectScreenshots(): Promise<void> {
  const root = path.join(projectDir, screenshotDirectory);
  const found: string[] = [];
  async function visit(directory: string): Promise<void> {
    for (const entry of await fs.readdir(directory, { withFileTypes: true }).catch(() => [])) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(full);
      else if (/\.(png|jpg|jpeg)$/i.test(entry.name)) found.push(full);
    }
  }
  await visit(root);
  report.screenshots = found;
}

async function main(): Promise<void> {
  await fs.mkdir(runDir, { recursive: true });
  await writeReport();
  const sample = projectSchema.parse(JSON.parse(await fs.readFile(path.join(exampleDir, 'project.vns.json'), 'utf8')));
  const project = makeProject(sample);
  await fs.writeFile(path.join(runDir, 'authored-project.json'), `${JSON.stringify(project, null, 2)}\n`, 'utf8');

  const build = await buildProject({ project, projectDir: exampleDir, sdkRoot, outputDir: projectDir, development: true });
  await recordStep('compile', build.ok ? 0 : 1, build.log + '\n' + JSON.stringify(build.diagnostics));
  const story = await fs.readFile(path.join(projectDir, 'game', 'story.rpy'), 'utf8');
  const screens = await fs.readFile(path.join(projectDir, 'game', 'screens.rpy'), 'utf8');
  const music = project.assets.find(asset => asset.id === 'asset_71ef3afe95a5b8e39c6c97ff');
  report.checks.fadeTransitionCompiled = story.includes('"mode": "fade"') && story.includes('Fade(duration / 2.0');
  report.checks.dissolveTransitionCompiled = story.includes('"mode": "dissolve"') && story.includes('Dissolve(duration)');
  report.checks.noneTransitionCompiled = story.includes('"mode": "none"');
  report.checks.uiChildOverrideCompiled = screens.includes('子界面覆盖标题') && screens.includes('#66ff99');
  report.checks.characterFeatureRemappedCompiled = /show vn_actor_char_child at vn_animate_/.test(story);
  report.checks.characterFeatureCameraCompiled = /show layer master at vn_camera_/.test(story);
  report.checks.characterFeatureMusicCompiled = Boolean(music && story.includes(`play music "${music.path}"`));
  if (!Object.values(report.checks).every(Boolean)) throw new Error(`Compiler output missed instance checks: ${JSON.stringify(report.checks)}`);
  await fs.writeFile(path.join(projectDir, 'game', 'testcases.rpy'), testcases(), 'utf8');

  const lint = await runRenpy(sdkRoot, projectDir, ['lint']);
  await recordStep('lint', lint.code, lint.log);
  const tested = await runRenpy(sdkRoot, projectDir, ['test', '--report-detailed', '--report-skipped'], {
    savedir: path.join(runDir, 'saves'), timeoutMs: 180_000, onData: text => process.stdout.write(text),
  });
  await recordStep('runtime', tested.code, tested.log);
  if (tested.code !== 0 || !/Test cases\s*:\s*1\s*\|\s*1 passed/.test(tested.log)) {
    throw new Error('Instance runtime testcase did not pass.');
  }
  await collectScreenshots();
  if (report.screenshots.length < 5) throw new Error(`Expected at least five runtime screenshots, found ${report.screenshots.length}.`);
  report.status = 'passed';
  await writeReport();
  console.log(JSON.stringify(report, null, 2));
}

try {
  await main();
} catch (error) {
  report.status = 'failed';
  report.error = error instanceof Error ? error.message : String(error);
  await writeReport();
  console.error(report.error);
  process.exitCode = 1;
}
