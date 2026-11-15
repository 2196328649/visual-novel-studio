import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createProject, projectSchema, type StoryNode, type UiComponent } from '../src/core/model';
import { createScreens, playerFlowRuntimeData } from '../src/runtime/screens';
import { createStoryMenuRuntime } from '../src/runtime/story-menu-runtime';
import { createSpatialUiWidgets } from '../src/runtime/spatial-ui-widgets';
import { createUiRuntime } from '../src/runtime/ui-runtime';

// A bounded logic check, never a substitute for a native window/click/render test.
// Python executes selected AST definitions only: no SDK import or game startup.
const output = path.resolve(process.env.VNS_ARTIFACT_ROOT ?? 'artifacts/player-flow-fixes-2026-11-13', 'validation-main');
const titles = [
  '普通中文章节', '单方括号 [qa_missing_name]', '重复方括号 [[qa_missing_name]]',
  '未闭合方括号 [qa_missing_name', '末尾单字符 [', '花括号 {b}原样{/b}',
  '重复花括号 {{原样}}', '未闭合花括号 {color=red', '混合 [qa_missing_name!q] {color=red} [[方括号]] {{花括号}}',
  '多行\n第二行 [不存在] {b}', '引号 "双引号" \'单引号\' \\ 路径 ] }',
];
const project = createProject('无GUI剧情图运行时逻辑验证');
project.chapters = [{ id: 'boot_chapter', name: '开场', flowchart: { visible: false } },
  ...titles.map((name, index) => ({ id: `chapter_${index}`, name })),
  { id: 'edge_chapter', name: '连线测试', flowchart: { visible: false } }];
project.scenes = project.chapters.map(chapter => ({ id: 'scene_' + chapter.id, chapterId: chapter.id, name: '位置' }));
project.entryId = 'boot';
const passage = (id: string, name: string, sceneId = 'scene_edge_chapter'): StoryNode => ({ id, name, sceneId, kind: 'passage', x: 0, y: 0, lines: [], next: 'end' });
project.nodes = [passage('boot', '开场', 'scene_boot_chapter'),
  ...titles.map((title, index) => passage(`title_${index}`, title, `scene_chapter_${index}`)),
  ...Array.from({ length: 9 }, (_, index): StoryNode => ({ id: `source_${index}`, name: `来源${index}`, kind: 'choice', sceneId: 'scene_edge_chapter', x: 0, y: 0, prompt: '',
    choices: [{ id: `joint_${index}`, text: '共同目标', target: 'joint' }, { id: `member_${index}`, text: '成员目标', target: `target_${index}` }] })),
  ...Array.from({ length: 9 }, (_, index) => passage(`target_${index}`, `目标${index}`)),
  passage('joint', '共同目标'), passage('source_unrelated', '无关来源'), passage('target_unrelated', '无关目标'),
  { id: 'end', name: '结束', kind: 'end', sceneId: 'scene_edge_chapter', x: 0, y: 0 }];
const makeMap = (id: string, layout: 'flow' | 'grid'): UiComponent => ({ id, kind: 'flowchart', page: 'flowchart', text: '', x: 0, y: 0, width: 1, height: 1, list: { layout, lockUnread: true, confirmJump: true } });
const components = (['script', 'custom'] as const).flatMap(mode => (['flow', 'grid'] as const).map(layout => {
  const component = makeMap(`${mode}_${layout}`, layout);
  component.list!.flowContent = mode === 'script' ? { mode } : { mode, custom: { entries: titles.map((name, index) => ({ nodeId: `title_${index}`, name })) } };
  return component;
}));
project.ui.components = components;
const loaded = projectSchema.parse(JSON.parse(JSON.stringify(project)));
const sources = [...Array.from({ length: 9 }, (_, index) => `source_${index}`), 'source_unrelated'];
const targets = [...Array.from({ length: 9 }, (_, index) => `target_${index}`), 'target_unrelated'];
const edgeMap = makeMap('edges', 'flow');
edgeMap.list = { ...edgeMap.list, flowLockedNode: 'hide', flowLockedLine: 'dim', flowContent: { mode: 'custom', custom: {
  entries: [...sources, 'joint', ...targets].map(nodeId => ({ nodeId })),
  groups: [{ id: 'sources', name: '来源组', nodeIds: sources }, { id: 'targets', name: '目标组', nodeIds: targets }],
} } };
const screens = createScreens(loaded), spatial = createSpatialUiWidgets(), story = createStoryMenuRuntime(loaded), ui = createUiRuntime(loaded);

function pythonBlocks(source: string) {
  const blocks: string[] = [];
  const lines = source.split('\n');
  for (let index = 0; index < lines.length; index++) if (/^init(?: -?\d+)? python:\s*$/.test(lines[index])) {
    const block: string[] = [];
    for (index++; index < lines.length && (!lines[index].trim() || lines[index].startsWith('    ')); index++) block.push(lines[index].slice(4));
    blocks.push(block.join('\n')); index--;
  }
  return blocks;
}
function generatedCall(line: string, name: string) {
  const start = line.indexOf(name + '(');
  if (start < 0) throw Error('Missing generated action ' + name);
  let depth = 0, quote = '';
  for (let cursor = start + name.length; cursor < line.length; cursor++) {
    const character = line[cursor];
    if (quote) { if (character === '\\') cursor++; else if (character === quote) quote = ''; }
    else if (character === '"' || character === "'") quote = character;
    else if (character === '(') depth++;
    else if (character === ')' && --depth === 0) return line.slice(start, cursor + 1);
  }
  throw Error('Unclosed generated action ' + name);
}
const findLine = (text: string, includes: string) => {
  const line = text.split('\n').find(candidate => candidate.includes(includes));
  if (!line) throw Error('Missing generated line ' + includes);
  return line;
};
const sdkPath = path.resolve('resources/runtime/renpy/substitutions.py');
const input = {
  titles, storyBlocks: pythonBlocks(story), spatialBlocks: pythonBlocks(spatial), uiBlocks: pythonBlocks(ui), screenBlocks: pythonBlocks(screens),
  sdkPath, sdkSource: await fs.readFile(sdkPath, 'utf8'),
  maps: Object.fromEntries(loaded.ui.components.map(component => [component.id, { ...component.list, ...playerFlowRuntimeData(loaded, component) }])),
  edgeOptions: { ...edgeMap.list, ...playerFlowRuntimeData(loaded, edgeMap) },
  actions: {
    branch: generatedCall(findLine(spatial, 'use vn_styled_button(node_text, VnFlowEntry('), 'VnFlowEntry'),
    collection: findLine(screens, '$ entry_action = VnFlowEntry(').trim().slice('$ entry_action = '.length),
    nativeChapter: generatedCall(findLine(screens, 'action VnStoryStart("chapterList"'), 'VnStoryStart'),
    nativeFlow: generatedCall(findLine(screens, 'textbutton vn_ui_literal(node_name)'), 'VnStoryStart'),
  },
};

const python = String.raw`
import ast, copy, json, re, string, sys, traceback, types
d = json.load(sys.stdin)
checks = []
raw_actions = []
examples = []
def equal(actual, expected, label, group):
    if actual != expected:
        raise AssertionError(label + ': ' + repr(actual) + ' != ' + repr(expected))
    checks.append(dict(group=group, label=label))
def selected(blocks, names, assignments=()):
    result = []
    found = set()
    for block in blocks:
        for node in ast.parse(block).body:
            if isinstance(node, (ast.FunctionDef, ast.ClassDef)) and node.name in names:
                result.append(node); found.add(node.name)
            elif isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name) and node.targets[0].id in assignments:
                result.append(node); found.add(node.targets[0].id)
    missing = set(names).union(assignments) - found
    if missing:
        raise AssertionError('Missing actual source definitions: ' + repr(missing))
    return ast.fix_missing_locations(ast.Module(body=result, type_ignores=[]))
class Action: pass
class DictEquality: pass
class Result:
    def __init__(self, kind, **values):
        self.kind, self.values = kind, values
def Start(label): return Result('start', label=label)
def Function(function, *args, **kwargs): return Result('function', function=function, args=args, kwargs=kwargs)
def Confirm(message, action): return Result('confirm', message=message, action=action)
def Show(screen, **kwargs): return Result('show', screen=screen, kwargs=kwargs)
def SetLocalVariable(name, value): return Result('local', name=name, value=value)
def no_restart(**kwargs): raise AssertionError('A full restart must never execute in this logic check.')
def no_expression(*args): raise AssertionError('A literal title reached expression evaluation.')
def run(action):
    if isinstance(action, VnStoryStart):
        raw_actions.append(action.caption)
    return action() if isinstance(action, Action) else action
renpy = types.SimpleNamespace(pure=lambda value: value, full_restart=no_restart,
    display=types.SimpleNamespace(behavior=types.SimpleNamespace(run=run)),
    config=types.SimpleNamespace(interpolate_exprs=True), python=types.SimpleNamespace(py_eval=no_expression))
persistent = types.SimpleNamespace(vn_seen_nodes=[], vn_seen_chapters=[])
main_menu, vn_current_node = False, 'boot'

def perform():
    global main_menu, vn_current_node
    equal(sys.dont_write_bytecode, True, 'Python bytecode disabled', 'isolation')
    exec(compile(selected(d['storyBlocks'], {'vn_story_unlocked', 'vn_story_caption', 'VnStoryStart', 'VnFlowEntry'}, {'vn_story_nodes', 'vn_story_entry', 'vn_story_first_chapter'}), '<product-story>', 'exec'), globals())
    exec(compile(selected(d['spatialBlocks'], {'vn_flow_entry', 'vn_flow_members', 'vn_flow_locked', 'vn_flow_current', 'vn_flow_caption', 'vn_flow_edge_alpha', 'vn_flow_markup', 'vn_flow_parts'}), '<product-flow>', 'exec'), globals())
    exec(compile(selected(d['uiBlocks'], {'vn_ui_literal'}), '<product-literal>', 'exec'), globals())
    exec(compile(selected(d['screenBlocks'], set(), {'vn_chapter_entries', 'vn_flow_entries'}), '<product-directories>', 'exec'), globals())
    exec(compile(selected([d['sdkSource']], {'parse', 'interpolate', 'convert'}, {'flags', 'formatter', 'SIMPLE_NAME'}), '<sdk-substitutions-selected-ast>', 'exec'), globals())
    equal(list(parse('[qa_missing_name]'))[0][1], 'qa_missing_name', 'unescaped control really parses as an expression', 'sdk-interpolation')
    persistent.vn_seen_nodes = ['title_' + str(index) for index in range(len(d['titles']))]
    persistent.vn_seen_chapters = ['chapter_' + str(index) for index in range(len(d['titles']))]
    persistent_before = (list(persistent.vn_seen_nodes), list(persistent.vn_seen_chapters))
    chapter_entries = {entry[0]: entry for entry in vn_chapter_entries}
    flow_entries = {entry[0]: entry for entry in vn_flow_entries}
    compiled_actions = {name: compile(ast.parse(source, mode='eval'), '<generated-' + name + '>', 'eval') for name, source in d['actions'].items()}
    fake_adjustment = types.SimpleNamespace(change=lambda value: None)
    def action_for(source, index, options=None):
        node_id, chapter_id = 'title_' + str(index), 'chapter_' + str(index)
        title = d['titles'][index]
        if source in d['maps']:
            options = options if options is not None else d['maps'][source]
            context = dict(options=options, node=vn_flow_entry(node_id, options), graph=options.get('flowGraph', {}), flow_x=fake_adjustment, flow_y=fake_adjustment)
            if source.endswith('_flow'):
                return eval(compiled_actions['branch'], globals(), context)
            context.update(kind='flowchart', entry_id=node_id, entry_path=vn_story_nodes[node_id]['label'], caption=title, entry_node=context['node'], flow_locations={})
            return eval(compiled_actions['collection'], globals(), context)
        if source == 'chapter_collection':
            entry = chapter_entries[chapter_id]
            return eval(compiled_actions['collection'], globals(), dict(kind='chapterList', entry_id=entry[0], caption=entry[1], entry_path=entry[2], options={}))
        if source == 'native_chapter':
            entry = chapter_entries[chapter_id]
            return eval(compiled_actions['nativeChapter'], globals(), dict(chapter_id=entry[0], chapter_name=entry[1], chapter_label=entry[2]))
        entry = flow_entries[node_id]
        return eval(compiled_actions['nativeFlow'], globals(), dict(node_id=entry[0], node_name=entry[1], node_label=entry[2]))
    for index, title in enumerate(d['titles']):
        node_id = 'title_' + str(index)
        for name, options in d['maps'].items():
            equal(next(entry[1] for entry in options['flowEntries'] if entry[0] == node_id), title, name + ': raw entry ' + str(index), 'raw-titles')
            equal(vn_flow_entry(node_id, options)['name'], title, name + ': raw look ' + str(index), 'raw-titles')
        equal(chapter_entries['chapter_' + str(index)][1], title, 'raw chapter directory ' + str(index), 'raw-titles')
        equal(flow_entries[node_id][1], title, 'raw flow directory ' + str(index), 'raw-titles')
        for name in list(d['maps']) + ['chapter_collection', 'native_chapter', 'native_flow']:
            raw_actions.clear()
            action = run(action_for(name, index))
            label = name + ': punctuation case ' + str(index)
            equal(action.kind, 'confirm', label + ': confirm action', 'literal-confirm')
            equal(raw_actions, [title], label + ': raw action boundary', 'literal-confirm')
            raw_prompt = '从「' + title + '」重新开始？当前未保存的进度将丢失。'
            expected_prompt = raw_prompt.replace('{', '{{').replace('[', '[[')
            equal(action.values['message'], expected_prompt, label + ': escaped once', 'literal-confirm')
            tokens = list(parse(action.values['message']))
            equal(all(expression is None for literal, expression, conversion, fmt in tokens), True, label + ': no interpolation expressions', 'sdk-interpolation')
            interpolated = interpolate(action.values['message'], {})
            equal(interpolated, raw_prompt.replace('{', '{{'), label + ': exact SDK interpolation', 'sdk-interpolation')
            equal(interpolated.replace('{{', '{'), raw_prompt, label + ': reversible literal braces', 'sdk-interpolation')
            if name == 'custom_grid':
                examples.append(dict(raw=title, confirmation=action.values['message'], sdkInterpolated=interpolated))
    equal((persistent.vn_seen_nodes, persistent.vn_seen_chapters), persistent_before, 'confirmation checks never mutate progress', 'action-modes')
    for name in d['maps']:
        for at_menu in (False, True):
            for confirm in (False, True):
                main_menu = at_menu
                options = dict(d['maps'][name], confirmJump=confirm)
                raw_actions.clear()
                result = run(action_for(name, 8, options))
                expected_kind = 'start' if at_menu else 'confirm' if confirm else 'function'
                label = name + ': main=' + str(at_menu) + ' confirm=' + str(confirm)
                equal(result.kind, expected_kind, label + ': action mode', 'action-modes')
                equal(raw_actions, [d['titles'][8]], label + ': caption remains raw', 'action-modes')
                target = result.values['action'] if result.kind == 'confirm' else result
                equal(target.values['label'] if target.kind == 'start' else target.values['kwargs']['label'], 'vn_node_title_8', label + ': replay target', 'action-modes')
    main_menu = False
    persistent.vn_seen_nodes = []
    equal(vn_story_unlocked('flowchart', 'boot', True), True, 'entry always unlocked', 'progress')
    equal(vn_story_unlocked('flowchart', 'title_0', True), False, 'unread node locked', 'progress')
    equal(vn_story_unlocked('flowchart', 'title_0', False), True, 'lock disabled', 'progress')
    equal(run(action_for('custom_grid', 0)), None, 'locked node cannot replay', 'progress')
    opts = d['edgeOptions']
    edges = {edge['to']: edge for edge in opts['flowGraph']['edges'] if edge['from'] == 'sources'}
    for name in ('joint', 'targets'):
        equal(len(edges[name]['endpoints']), 9, name + ': complete endpoint count', 'edge-data')
        equal(len(edges[name]['paths']), 8, name + ': bounded explanation count', 'edge-data')
        equal(any(pair['from'] == 'source_8' for pair in edges[name]['endpoints']), True, name + ': ninth endpoint retained', 'edge-data')
        equal(any(route['nodeIds'][0] == 'source_8' for route in edges[name]['paths']), False, name + ': ninth explanation omitted', 'edge-data')
    for seen, joint_alpha, group_alpha, label in [
        (['source_8', 'joint', 'target_8'], 1.0, 1.0, 'ninth matching route'),
        (['source_unrelated', 'joint', 'target_unrelated'], 0.0, 0.0, 'unrelated members only'),
        (['source_8', 'joint', 'target_7'], 1.0, 0.0, 'mismatched endpoint pair'),
        ([], 0.0, 0.0, 'all unread'),
    ]:
        persistent.vn_seen_nodes = seen
        for name, expected in (('joint', joint_alpha), ('targets', group_alpha)):
            equal(vn_flow_edge_alpha(edges[name], opts), expected, label + ': hide ' + name, 'edge-states')
            equal(vn_flow_edge_alpha(edges[name], dict(opts, flowLockedNode='show')), 1.0 if expected else .35, label + ': dim ' + name, 'edge-states')
            equal(vn_flow_edge_alpha(edges[name], dict(opts, flowLockedNode='show', flowLockedLine='hide')), expected, label + ': hide line ' + name, 'edge-states')
            equal(vn_flow_edge_alpha(edges[name], dict(opts, lockUnread=False)), 1.0, label + ': unrestricted ' + name, 'edge-states')
    persistent.vn_seen_nodes = ['source_8', 'joint', 'target_8']
    equal(vn_flow_locked('sources', opts), False, 'reached member opens source group', 'progress')
    equal(vn_flow_locked('targets', opts), False, 'reached member opens target group', 'progress')
    equal(vn_flow_locked('source_0', opts), True, 'opening a group does not reach other members', 'progress')
    equal(vn_flow_edge_alpha(dict(edges['joint'], endpoints=[]), opts), 0.0, 'empty complete endpoints do not fall through', 'edge-compatibility')
    equal(vn_flow_edge_alpha(dict(edges['joint'], endpoints=[]), dict(opts, lockUnread=False)), 0.0, 'empty endpoints remain invalid when unlocked', 'edge-compatibility')
    equal(vn_flow_edge_alpha(dict(edges['joint'], **{'from': 'unread_display'}), opts), 0.0, 'display source protection survives unlocked real endpoints', 'edge-compatibility')
    equal(vn_flow_edge_alpha(dict(edges['joint'], to='unread_display'), opts), 0.0, 'display target protection survives unlocked real endpoints', 'edge-compatibility')
    old = {key: value for key, value in edges['joint'].items() if key != 'endpoints'}
    equal(vn_flow_edge_alpha(old, opts), 0.0, 'legacy paths use their retained endpoints', 'edge-compatibility')
    persistent.vn_seen_nodes = ['source_0', 'joint']
    equal(vn_flow_edge_alpha(old, opts), 1.0, 'legacy reached path opens edge', 'edge-compatibility')
    no_paths = dict(old, **{'from': 'source_0', 'paths': []})
    equal(vn_flow_edge_alpha(no_paths, opts), 1.0, 'legacy no paths uses display ends', 'edge-compatibility')
    equal(vn_flow_edge_alpha(dict(no_paths, paths=[{'nodeIds': []}]), opts), 1.0, 'legacy empty routes use display ends', 'edge-compatibility')
    equal(vn_flow_edge_alpha(dict(no_paths, paths=[{'nodeIds': []}, {'nodeIds': ['source_8', 'joint']}]), opts), 0.0, 'legacy nonempty unread route blocks fallback', 'edge-compatibility')
    equal('renpy' in sys.modules, False, 'SDK module was never imported', 'isolation')

report = dict(kind='no-gui-runtime-logic', limitations=[
    'No RenPy process, SDK module import, window, screenshot, input event, save or persistent file was used.',
    'Actions were captured by minimal in-memory stubs; real native confirmation clicks and rendering remain unverified.',
    'SDK parse/interpolate ran from their actual AST; literal brace reversibility is not a glyph-rendering test.',
])
try:
    perform()
    report['status'] = 'passed'
except Exception:
    report['status'] = 'failed'
    report['error'] = traceback.format_exc()
report.update(assertions=len(checks), checks=checks, examples=examples, bytecodeDisabled=sys.dont_write_bytecode)
report['groups'] = {group: sum(check['group'] == group for check in checks) for group in sorted({check['group'] for check in checks})}
print(json.dumps(report, ensure_ascii=False))
sys.exit(0 if report['status'] == 'passed' else 1)
`;

const inputJson = JSON.stringify(input, null, 2);
await fs.mkdir(output, { recursive: true });
// These are retained evidence for reproducing the exact checked code and data.
await fs.writeFile(path.join(output, 'runtime-logic-input.json'), inputJson);
await fs.writeFile(path.join(output, 'runtime-logic-check.py'), python);
const result = spawnSync('python', ['-B', '-X', 'utf8', '-c', python], { input: inputJson, encoding: 'utf8', windowsHide: true,
  env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' }, timeout: 30000, maxBuffer: 16 * 1024 * 1024 });
let report: Record<string, unknown>;
try { report = JSON.parse(result.stdout); }
catch { report = { status: 'failed', kind: 'no-gui-runtime-logic', error: result.error?.message ?? result.stderr ?? 'Python did not produce a JSON report.' }; }
report = { ...report, generatedAt: new Date().toISOString(), exitCode: result.status, stderr: result.stderr, output,
  evidence: { input: path.join(output, 'runtime-logic-input.json'), checker: path.join(output, 'runtime-logic-check.py'),
    inputSha256: createHash('sha256').update(inputJson).digest('hex'), checkerSha256: createHash('sha256').update(python).digest('hex'),
    sdkSource: sdkPath, sdkSha256: createHash('sha256').update(input.sdkSource).digest('hex') } };
await fs.writeFile(path.join(output, 'runtime-logic.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ status: report.status, assertions: report.assertions, groups: report.groups, report: path.join(output, 'runtime-logic.json') }, null, 2));
if (result.status !== 0 || report.status !== 'passed') throw Error(String(report.error ?? result.error?.message ?? result.stderr));
