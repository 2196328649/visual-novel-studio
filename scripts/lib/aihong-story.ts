import { blueprintNodeDefaults, connectBlueprintPins, createBlueprintGraph, synchronizeBlueprintSignatures, type BlueprintNodeType } from '../../src/core/blueprint';
import { type Project, type StageAction, type StoryNode, type VariableValue } from '../../src/core/model';
import { endingPerformanceNodes } from '../../src/core/ending-migration';

/** A small adaptation of the supplied manuscript, not a reconstruction of all original routes. */
export const aihongStoryAssets = [
  { id: 'ai_story_banquet', name: '王家大院 · 夜宴', source: 'texture/bg/王家大院街道夜.png', kind: 'image' as const },
  { id: 'ai_story_memory', name: '旧忆 · 花魁小间', source: 'texture/bg/花魁房间开夜.png', kind: 'image' as const },
  { id: 'ai_story_market', name: '城破 · 雨中集市', source: 'texture/bg/集市雨.png', kind: 'image' as const },
  { id: 'ai_story_gate', name: '城破 · 战火城门', source: 'texture/bg/城门战火.png', kind: 'image' as const },
  { id: 'ai_story_home', name: '方院 · 雨天', source: 'texture/bg/方院雨天.png', kind: 'image' as const },
  { id: 'ai_story_street', name: '方院外 · 雨中街道', source: 'texture/bg/方院外街道雨.png', kind: 'image' as const },
  { id: 'ai_story_shelter', name: '方院 · 夜色', source: 'texture/bg/方院夜.png', kind: 'image' as const },
  { id: 'ai_story_boat', name: '远舟 · 船窗', source: 'texture/bg/船窗.png', kind: 'image' as const },
  { id: 'ai_story_music_wine', name: '花街柳巷', source: 'sound/BGM/花街柳巷.ogg', kind: 'audio' as const },
  { id: 'ai_story_music_memory', name: '青梅竹马', source: 'sound/BGM/青梅竹马.ogg', kind: 'audio' as const },
  { id: 'ai_story_music_city', name: '妖兵入城', source: 'sound/BGM/妖兵入城.ogg', kind: 'audio' as const },
  { id: 'ai_story_music_rain', name: '孤风凄雨', source: 'sound/BGM/孤风凄雨.ogg', kind: 'audio' as const },
];

export function populateAihongStory(project: Project) {
  project.name = '哀鸿 · 两章分支示例';
  project.assets = project.assets.filter(asset => !asset.id.startsWith('asset_') && !asset.id.startsWith('ai_story_'));
  project.assets.push(...aihongStoryAssets.map(asset => ({ id: asset.id, name: asset.name, kind: asset.kind, path: `assets/${asset.id}.${asset.kind === 'image' ? 'png' : 'ogg'}` })));
  // These original voice-setting rows remain addressable, without the old unrelated demo portraits.
  project.characters = project.characters.map(character => ['char_yu', 'char_xia'].includes(character.id) ? { ...character, expressions: [] } : character);
  const cast = [
    ['ai_voice_fangzhiyou', '方知宥', '#cfc5a4'], ['ai_voice_wangsheng', '王生', '#b4c7a3'],
    ['ai_voice_sulianyan_2', '苏怜烟', '#dab5ae'], ['ai_voice_sulianyan_1', '小雁儿', '#cab7df'],
    ['ai_voice_liang', '良', '#b8c8cc'], ['ai_story_yang', '杨军爷', '#c6a379'],
  ];
  for (const [id, name, color] of cast) if (!project.characters.some(character => character.id === id)) project.characters.push({ id, name, color, expressions: [] });
  project.variables = [
    { id: 'ai_caution', name: '谨慎', type: 'number', initial: 0, persistent: false },
    { id: 'ai_route_known', name: '记得避兵小路', type: 'boolean', initial: false, persistent: false },
  ];
  project.effects = []; project.minigames = []; delete project.scriptText;
  project.chapters = [{ id: 'ai_chapter_one', name: '第一章 · 酒醒城破' }, { id: 'ai_chapter_two', name: '第二章 · 方院抉择' }];
  project.scenes = [
    { id: 'ai_scene_banquet', name: '夜宴 · 女儿红', chapterId: 'ai_chapter_one' },
    { id: 'ai_scene_memory', name: '旧忆 · 狮驼国', chapterId: 'ai_chapter_one' },
    { id: 'ai_scene_city', name: '城破 · 归路', chapterId: 'ai_chapter_one' },
    { id: 'ai_scene_home', name: '方院 · 左屋与右屋', chapterId: 'ai_chapter_two' },
    { id: 'ai_scene_child', name: '酒缸 · 旧人', chapterId: 'ai_chapter_two' },
    { id: 'ai_scene_endings', name: '余波 · 三种归宿', chapterId: 'ai_chapter_two' },
  ];
  project.blueprints = project.blueprints.filter(graph => !graph.id.startsWith('ai_bp_'));
  const sequence = (id: string, name: string, steps: [BlueprintNodeType, Record<string, VariableValue>][], kind: 'function' | 'macro' = 'function') => {
    const graph = createBlueprintGraph(kind, name); graph.id = id;
    graph.nodes[0].id = `${id}_entry`; graph.nodes[0].x = 60; graph.nodes[0].y = 90;
    for (const [type, properties] of [...steps, ['return', {}]] as [BlueprintNodeType, Record<string, VariableValue>][]) {
      const node = blueprintNodeDefaults(type); node.id = `${id}_n${graph.nodes.length}`; node.properties = { ...node.properties, ...properties }; node.x = 60 + graph.nodes.length * 330; node.y = 90;
      const previous = graph.nodes.at(-1)!; graph.nodes.push(node);
      connectBlueprintPins(graph, previous.id, previous.type === 'event' ? 'exec' : 'exec_out', node.id, 'exec_in');
      graph.links.at(-1)!.id = `${id}_l${graph.links.length}`;
    }
    project.blueprints.push(graph);
    return id;
  };
  sequence('ai_bp_banquet', '夜宴 · 音乐淡入', [['playMusic', { assetId: 'ai_story_music_wine', fade: 0.6, loop: true }], ['delay', { seconds: 0.2 }]]);
  sequence('ai_bp_memory', '旧忆 · 换景与配乐', [['showBackground', { assetId: 'ai_story_memory', transition: 'dissolve' }], ['playMusic', { assetId: 'ai_story_music_memory', fade: 0.8, loop: true }]]);
  sequence('ai_bp_city', '城破 · 战火与急雨', [['showBackground', { assetId: 'ai_story_gate', transition: 'fade' }], ['playMusic', { assetId: 'ai_story_music_city', fade: 0.5, loop: true }]]);
  sequence('ai_bp_end', '收束 · 音乐淡出', [['stopMusic', { channel: 'music', fade: 1 }]], 'macro');

  // A connected, typed data-flow example used by the right-room passage.
  const cautious = createBlueprintGraph('function', '窥窗 · 按谨慎调整停顿'); cautious.id = 'ai_bp_caution';
  const event = cautious.nodes[0]; event.id = 'ai_bp_caution_entry'; event.x = 70; event.y = 70;
  const get = blueprintNodeDefaults('getVariable'); get.id = 'ai_bp_caution_get'; get.properties.variableId = 'ai_caution'; get.pins[0].dataType = 'number'; get.x = 70; get.y = 300;
  const compare = blueprintNodeDefaults('compare'); compare.id = 'ai_bp_caution_compare'; compare.properties = { operator: 'gte', b: 1 }; compare.x = 400; compare.y = 280;
  const branch = blueprintNodeDefaults('branch'); branch.id = 'ai_bp_caution_branch'; branch.x = 730; branch.y = 70;
  const slow = blueprintNodeDefaults('delay'); slow.id = 'ai_bp_caution_slow'; slow.properties.seconds = 0.35; slow.name = '稳住呼吸'; slow.x = 1060; slow.y = 70;
  const fast = blueprintNodeDefaults('delay'); fast.id = 'ai_bp_caution_fast'; fast.properties.seconds = 0.05; fast.name = '仓促一瞥'; fast.x = 1060; fast.y = 300;
  const back = blueprintNodeDefaults('return'); back.id = 'ai_bp_caution_return'; back.x = 1390; back.y = 180;
  cautious.nodes.push(get, compare, branch, slow, fast, back);
  for (const [from, pin, to, input] of [[event.id, 'exec', branch.id, 'exec_in'], [get.id, 'value', compare.id, 'a'], [compare.id, 'result', branch.id, 'condition'], [branch.id, 'true', slow.id, 'exec_in'], [branch.id, 'false', fast.id, 'exec_in'], [slow.id, 'exec_out', back.id, 'exec_in'], [fast.id, 'exec_out', back.id, 'exec_in']]) {
    const error = connectBlueprintPins(cautious, from, pin, to, input); if (error) throw new Error(error); cautious.links.at(-1)!.id = `ai_bp_caution_l${cautious.links.length}`;
  }
  project.blueprints.push(cautious); synchronizeBlueprintSignatures(project);
  const F = 'ai_voice_fangzhiyou', W = 'ai_voice_wangsheng', S = 'ai_voice_sulianyan_2', Y = 'ai_voice_sulianyan_1', L = 'ai_voice_liang';
  const banquet = 'ai_scene_banquet', memory = 'ai_scene_memory', city = 'ai_scene_city', home = 'ai_scene_home', child = 'ai_scene_child', endings = 'ai_scene_endings';
  const base = (id: string, name: string, sceneId: string, x = 60, y = 100) => ({ id, name, sceneId, x, y });
  const nodes: StoryNode[] = [];
  const add = (node: StoryNode) => { nodes.push(node); return node; };
  const passage = (id: string, name: string, scene: string, text: (string | [string, string])[], next: string, x: number, y: number, actions: StageAction[] = []) => add({ ...base(id, name, scene, x, y), kind: 'passage', next, lines: text.map((line, i) => ({ id: `${id}_line_${i + 1}`, text: typeof line === 'string' ? line : line[1], speakerId: typeof line === 'string' ? undefined : line[0], actions: i === 0 ? actions : [] })) });
  const choice = (id: string, name: string, scene: string, prompt: string, options: [string, string][], x: number, y: number) => add({ ...base(id, name, scene, x, y), kind: 'choice', prompt, choices: options.map(([text, target], i) => ({ id: `${id}_option_${i + 1}`, text, target })) });
  const background = (assetId: string): StageAction => ({ kind: 'background', assetId, transition: 'dissolve' });
  const blueprint = (blueprintId: string): StageAction => ({ kind: 'blueprint', blueprintId });
  add({ ...base('start', '开始', banquet, 50, 100), kind: 'start', next: 'ai_title_one' }); project.entryId = 'start';
  add({ ...base('ai_title_one', '第一章', banquet, 350, 100), kind: 'chapterTitle', title: '第一章 · 酒醒城破', subtitle: '据原剧情「记·第一回」「忆·第一回」节选改编', duration: 2.2, next: 'opening' });
  passage('opening', '兽视与夜宴', banquet, [
    '我患了一种病。此病名为“兽视”，是极稀少的怪病。三年前初患此病，我便将人视作走兽。',
    [W, '杨军爷好酒量！来！学生再敬您一杯。'],
    '江南的傍晚从不寂静。我身着布衣，倚墙半躺，拎着酒坛子，微眯着眼望向不远处。',
    ['ai_story_yang', '这酒真不赖！方才你说这是什么酒来着？'],
    [W, '军爷，此乃绍兴女儿红，万历四十二年的陈酿。'],
    '他们桌上那坛，哪是什么三十载陈酿，不过是王生几日前从客栈收的便宜货罢了。',
    [W, '兵爷们连日索钱，昨日竟索千文……还望军爷分说一二。'],
    '酒桌上的笑声未歇，城外的消息却一日紧过一日。王生趁添酒时，低声劝我早些回家。',
  ], 'ai_choice_wine', 660, 100, [background('ai_story_banquet'), blueprint('ai_bp_banquet')]);
  choice('ai_choice_wine', '这一杯酒', banquet, '杯中倒映着灯火。我该如何回应王生的劝告？', [['记下劝告，放下酒坛', 'ai_gain_caution'], ['借酒压下心事', 'ai_wine_dream']], 990, 100);
  add({ ...base('ai_gain_caution', '谨慎 +1', banquet, 1320, 20), kind: 'set', variableId: 'ai_caution', operation: 'add', value: 1, next: 'ai_wine_dream' });
  passage('ai_wine_dream', '一个名字', banquet, [
    ['ai_story_yang', '广陵可有一位唤作“苏怜烟”的名妓？咱听闻此女琵琶妙绝。'],
    '苏怜烟……闻得此名，我心口骤然一紧。王生苦笑着瞥我一眼，话到了嘴边，又咽了回去。',
    '席上的灯火渐渐模糊。恍惚中，那些被我遗失的旧事又近了。',
  ], 'ai_memory', 1640, 100);
  passage('ai_memory', '不该如此', memory, [
    '她倚坐桌畔，眸光流连于香炉、香盒和香丸。小间内只有我们二人。',
    [S, '“狮驼国”？'], [F, '正是。我想写的书便叫《狮驼国》。'],
    [S, '你是想把世间的人，写成披着人皮的走兽？'],
    [F, '我欲以鲜血、野蛮、残暴，写尽世人悲苦……欲借污秽、混沌、黑暗，映照良善之光。'],
    [S, '我觉得不该如此。'],
    '她合上炉盖，淡然一笑。我愣愣地望着她，咀嚼着“不该如此”这几个字。',
    [S, '不过，现在写了多少了？'], [F, '只字未落。'],
    '她以袖掩唇，轻笑出声。那时我以为来日方长，以为总有时间把书写完。',
    [S, '“才子封笔时，佳人赠物日。”'],
    '她又卖了个关子。翠色屏风渐远，香气也散进了雨里。',
  ], 'ai_city', 100, 100, [blueprint('ai_bp_memory')]);
  passage('ai_city', '炮声惊醒', city, [
    '——轰！城北传来炮声，一声紧似一声。天飘细雨，阴云低沉，已分不清梦与醒。',
    [F, '我不知道这里究竟是广陵，还是那可怕的狮驼国。'],
    '昨日还有人售卖粮米的市集，如今只剩凌乱摊位。聚在街口的人，脸上都是惊惶。',
    '城墙上涌出黄、白、蓝、红的影子。在我眼里，它们都化作了形貌各异的群妖。',
    '人群忽然向南奔逃。我被推搡着向前，耳边只剩一句话：回家，快回家！',
  ], 'ai_choice_route', 100, 100, [blueprint('ai_bp_city')]);
  choice('ai_choice_route', '记住归路', city, '熟悉的街道也变得陌生。穿过市集前，我决定——', [['沿墙慢行，辨认废井旁的小路', 'ai_remember_route'], ['随人流奔逃，先离开街口', 'ai_return_home']], 430, 100);
  add({ ...base('ai_remember_route', '记住避兵小路', city, 760, 20), kind: 'set', variableId: 'ai_route_known', operation: 'set', value: true, next: 'ai_route_note' });
  passage('ai_route_note', '井旁的转角', city, ['我抹去眼前的雨水，认出了废井旁的窄巷。沿墙的这条路不显眼，却能绕开大街。', [F, '记住这里。若再有变故，总得知道往哪里走。']], 'ai_return_home', 1090, 20, [background('ai_story_market')]);
  add({ ...base('ai_return_home', '进入第二章', city, 1430, 100), kind: 'jump', target: 'ai_title_two', sceneTransition: { mode: 'fade', duration: 0.6, color: '#000000' } });
  add({ ...base('ai_title_two', '第二章', home, 60, 100), kind: 'chapterTitle', title: '第二章 · 方院抉择', subtitle: '据原剧情「记·第二回」「忆·第二回」节选改编', duration: 2.2, next: 'ai_home' });
  passage('ai_home', '虚挂的铜锁', home, [
    '穿过几个街区，绕过废井，我终于找到了方院。无论是在广陵，还是在狮驼国，这都是我住的地方。',
    '铜锁虚挂着。想来是昨日赴宴前忘了锁门。我推门进去，院里静得只剩雨声。',
    '左屋是我平日歇息的地方。右屋堆满旧书、木箱和多年未理的杂物，从小窗正好能看见东城区的大街。',
    [F, '安分一点躲起来，还是去看看街上到底怎样了？'],
  ], 'ai_choice_room', 390, 100, [background('ai_story_home'), { kind: 'music', assetId: 'ai_story_music_rain', fade: 0.6, loop: true }]);
  choice('ai_choice_room', '左屋与右屋', home, '屋外雨势渐急。', [['入左屋，安分守己', 'ai_left_room'], ['入右屋，窥视街道', 'ai_right_room']], 720, 100);
  passage('ai_left_room', '雨声中的轻咳', home, ['我藏进左屋，屏息听着街上的动静。越想要避开，那些模糊的声音便越是钻进耳里。', '忽然，隔壁传来一声轻咳。我独居多年，这院里本不该有第二个人。', [F, '是谁？……莫怕，我过来了。']], 'ai_child', 1050, 20);
  passage('ai_right_room', '小窗外的队列', home, [
    '我踩上木箱，双手扒着小窗。街道绵延数百步，由南向北。远处，密密麻麻的黑影正在靠近。',
    '先是白甲，其后是红甲、蓝甲。马蹄踏过积水，队列缓缓往前。我的手心开始冒汗。',
    [F, '一、二、三……先稳住呼吸。'],
  ], 'ai_check_caution', 1050, 280, [background('ai_story_street'), blueprint('ai_bp_caution')]);
  add({ ...base('ai_check_caution', '谨慎能否避开目光', home, 1380, 280), kind: 'condition', condition: { kind: 'compare', variableId: 'ai_caution', operator: 'gte', value: 1 }, yes: 'ai_scout_route', no: 'ai_bad_prelude' });
  add({ ...base('ai_scout_route', '记下队列间隙', home, 1710, 180), kind: 'set', variableId: 'ai_route_known', operation: 'set', value: true, next: 'ai_scout_safe' });
  passage('ai_scout_safe', '及时低头', home, ['我在一名骑兵抬眼之前退下木箱。只看见几眼，已足够认出队列的方向。', '不是所有巷口都被堵住。方才的观察，也许能替我留下一线生路。', '角落里，忽然传出一声很轻的咳嗽。那声音来自一只酒缸。'], 'ai_child', 2040, 180);
  passage('ai_child', '酒缸里的小雁儿', child, [
    '我一点点接近酒缸，脚步停在缸前。里面蜷缩着一个瘦小的女娃，抱着双膝，抬头凝望着我。',
    [Y, '好冷。'],
    '一滴酒渍贴在她额前的发丝上。紫色飘带、烟云纹样，还有那双灵动的眼睛……我认识她。',
    [F, '雁儿姐？'],
    '我与她相识在十三年前。晋地盐池的一家客栈里，九岁的我哭着要爹娘，谁的话也听不进去。',
    '她比我大两岁。那一天，我哭得很厉害，她却没有哭。',
    [Y, '先别哭，路还长着呢。'],
    '旧日的声音与眼前的轻咳叠在一起。我分不清这是不是又一场幻梦，却还是拿来了干布。',
    [F, '先暖一暖。外头不太平，别出声。'],
  ], 'ai_choice_future', 100, 100, [background('ai_story_home')]);
  choice('ai_choice_future', '这一夜之后', child, '我攥紧了铜钥匙。身后是旧日，门外是未知的明天。', [['收好盘缠，寻找避兵的小路', 'ai_check_route'], ['关好院门，先让她暖过来', 'ai_shelter']], 460, 100);
  add({ ...base('ai_check_route', '是否记得小路', child, 790, 30), kind: 'condition', condition: { kind: 'compare', variableId: 'ai_route_known', operator: 'eq', value: true }, yes: 'ai_boat', no: 'ai_no_route' });
  passage('ai_no_route', '不再莽撞', child, ['我走到院门前，却想不起哪条巷子能避开大街。门外传来马蹄声，我最终停下了手。', [F, '等一等。总得先活过这一夜。']], 'ai_shelter', 1120, 280);
  passage('ai_shelter', '灯火暂安', endings, ['我抵住院门，把干布放在酒缸旁，点亮一盏小灯。', '城里的雨还没有停。明日会怎样，我不知道；至少此刻，我没有把那声轻咳留在黑暗里。', [F, '先活着。等天亮，再想下一步。']], 'ai_ending_shelter', 100, 100, [background('ai_story_shelter'), blueprint('ai_bp_end')]);
  endingPerformanceNodes(project, base('ai_ending_shelter', '示例结局 · 灯火暂安', endings, 460, 100), '灯火暂安\n小小方院容下了一夜风雨，也容下了尚未写完的故事。\n（两章示例的阶段结局）', ['ai_story_shelter']).forEach(add);
  passage('ai_bad_prelude', '惊梦', endings, ['我看得太久，竟忘了压低身子。木箱发出一声脆响，街上的一道目光转向小窗。', '我仓皇后退。雨声、马蹄声、自己急促的呼吸，顷刻混成一片。', '这一次，我没有来得及把窗合上。'], 'ai_ending_dream', 100, 380, [background('ai_story_street'), blueprint('ai_bp_end')]);
  endingPerformanceNodes(project, base('ai_ending_dream', '示例结局 · 惊梦未醒', endings, 460, 380), '惊梦未醒\n仓促的一瞥，断送了最后的隐蔽。\n重来时，或许可以记住酒席上的劝告。\n（两章示例结束）', ['ai_story_street']).forEach(add);
  passage('ai_boat', '远舟的方向', endings, [
    '我记得那条巷子，也记得队列驶过的方向。等马蹄声远去，我收紧衣襟，踏入了雨中。',
    '……日子在奔逃中过去。几番辗转，许多张熟悉的面孔永远留在了广陵。',
    '许多天后，我随良叔沿江而下，到了杭州。港口停着一艘海船，一名灰蓝衣裙的女子正在等他。',
    '见到旧友重逢，我由衷替他们欣喜，心底却仍不可抑制地觉得落寞。',
    [L, '知幼，过来吧！'],
    '恍惚间，我看见那些过去认识的人也在船上向我招手。一阵微风吹过，幻影消失，只留下海船、港口和一望无际的远方。',
    [F, '来了！'],
    '我深深吸了一口气，昂首挺胸，迈开脚步走了出去。我走向等待着我的远舟，走向蕴含着无限可能的将来。',
  ], 'ai_ending_boat', 100, 670, [background('ai_story_boat'), { kind: 'music', assetId: 'ai_story_music_memory', fade: 0.8, loop: true }]);
  endingPerformanceNodes(project, base('ai_ending_boat', '示例结局 · 远舟', endings, 460, 670), '远舟\n旧事留在岸上，前路在水天之间。\n据原作「结局·远舟」节选改编；此示例压缩了抵达结局前的篇章。', ['ai_story_boat']).forEach(add);
  project.nodes = nodes;
  for (const component of project.ui.components) if (component.kind === 'galleryGrid' && component.list) component.list.assetIds = aihongStoryAssets.filter(asset => asset.kind === 'image').map(asset => asset.id);
  project.contentBrowser = { folders: [
    { id: 'ai_folder_story', name: '01 剧情' }, { id: 'ai_folder_ch1', name: '第一章 酒醒城破', parentId: 'ai_folder_story' }, { id: 'ai_folder_ch2', name: '第二章 方院抉择', parentId: 'ai_folder_story' },
    { id: 'ai_folder_blueprints', name: '02 蓝图' }, { id: 'ai_folder_performances', name: '剧情演出', parentId: 'ai_folder_blueprints' }, { id: 'ai_folder_title', name: '标题与界面', parentId: 'ai_folder_blueprints' },
    { id: 'ai_folder_art', name: '03 美术' }, { id: 'ai_folder_backgrounds', name: '场景背景', parentId: 'ai_folder_art' }, { id: 'ai_folder_ui', name: '界面皮肤', parentId: 'ai_folder_art' },
    { id: 'ai_folder_audio', name: '04 音乐' }, { id: 'ai_folder_cast', name: '05 角色与状态' }, { id: 'ai_folder_fonts', name: '06 字体与骨骼' },
  ], assignments: {}, favorites: ['blueprint:ai_bp_caution', 'scene:ai_scene_banquet', 'scene:ai_scene_home', 'asset:ai_story_home'] };
  const assignments = project.contentBrowser.assignments;
  for (const asset of project.assets) assignments[`asset:${asset.id}`] = asset.kind === 'audio' ? 'ai_folder_audio' : ['font', 'spine'].includes(asset.kind) ? 'ai_folder_fonts' : asset.id.startsWith('ai_story_') ? 'ai_folder_backgrounds' : 'ai_folder_ui';
  for (const graph of project.blueprints) assignments[`blueprint:${graph.id}`] = graph.id.startsWith('ai_bp_') ? 'ai_folder_performances' : 'ai_folder_title';
  for (const scene of project.scenes) assignments[`scene:${scene.id}`] = scene.chapterId === 'ai_chapter_one' ? 'ai_folder_ch1' : 'ai_folder_ch2';
  for (const character of project.characters) assignments[`character:${character.id}`] = 'ai_folder_cast';
  for (const variable of project.variables) assignments[`variable:${variable.id}`] = 'ai_folder_cast';
}
