import { projectGraphs } from './project-resources';
import { uiHierarchyProblems } from './ui-hierarchy';
import { uiAnimationClipProblems } from './ui-animation-clips';
import { uiComponentSchema } from './model';
import { assetFiles, characterFeatureActions, effectiveCharacter, effectiveUiComponents, effectiveUiTheme, targets, type Asset, type Condition, type Diagnostic, type Project, type StageAction, type UiComponent, type Variable } from './model';
import { textCommandAction } from './text-script';
import { validateBlueprints } from './blueprint-validation';
import { blueprintInputTarget, savedBlueprintAction, rawSavedBlueprintAction } from './blueprint-authoring';
import { applyVisualInputs, visualInputFields } from './visual-object';
import { visualAssetKind } from './visual-parameters';
import { materializeVisualCompositions } from './visual-composition';
import { validPlayerPreference } from './preferences';
import { parameterSets, parameterRange, settingsParameters, validParameterSetting } from './parameter-sets';
import { characterDisplayPreset } from './character-presets';

export function validateProject(project: Project): Diagnostic[] {
  const out: Diagnostic[] = [];
  const add = (message: string, nodeId?: string, lineId?: string, severity: Diagnostic['severity'] = 'error') => out.push({ severity, message, nodeId, lineId });
  const ids = new Set<string>();
  const unique = (id: string, name: string, nodeId?: string) => { if (ids.has(id)) add(`标识重复：${name}`, nodeId); ids.add(id); };
  for(const clip of project.ui.animations ?? []) { unique(clip.id, clip.name); for(const message of uiAnimationClipProblems(project,clip)) add('界面动画“'+clip.name+'”：'+message); }
  const nodes = new Map(project.nodes.map(n => [n.id, n]));
  const assets = new Map(project.assets.map(a => [a.id, a]));
  for (const item of project.assets) {
    if (item.kind === 'spine' && (!item.spine || !/^4\.2\./.test(item.spine.version))) add(`骨骼素材“${item.name}”缺少 Spine 4.2 导入信息，请重新导入。`);
    for (const relative of assetFiles(item).slice(1)) if (/^[a-zA-Z]:|^[\\/]|\0/.test(relative) || relative.replaceAll('\\', '/').split('/').some(part => part === '..' || part.includes(':'))) add(`素材“${item.name}”的配套文件必须位于项目目录。`);
  }
  const characters = new Map(project.characters.map(c => [c.id, c]));
  for (const [key, value] of Object.entries(project.playerDefaults ?? {})) if (!validPlayerPreference(key, value)) add('玩家初始设置的值无效，请在界面主题中检查。');
  const variables = new Map(project.variables.map(v => [v.id, v]));
  const scenes = new Set(project.scenes.map(s => s.id));
  const chapters = new Set(project.chapters.map(c => c.id));
  const asset = (assetId: string, kind: Asset['kind'] | undefined, nodeId?: string, lineId?: string) => {
    const found = assets.get(assetId);
    if (!found || (kind !== undefined && found.kind !== kind)) add(`素材不存在或格式不匹配：${found?.name ?? assetId}`, nodeId, lineId);
  };
  const variableValue = (variable: Variable, input: unknown, nodeId?: string) => {
    if (typeof input !== variable.type) add(`“${variable.name}”需要${{ number: '数值', boolean: '开关', string: '文字' }[variable.type]}。`, nodeId);
  };
  const condition = (test: Condition, nodeId?: string, depth = 0): void => {
    if (depth > 32) { add('条件嵌套超过 32 层，请拆分为多个条件节点。', nodeId); return; }
    if (test.kind === 'compare') {
      const v = variables.get(test.variableId);
      if (!v) { add('条件引用的状态已不存在。', nodeId); return; }
      variableValue(v, test.value, nodeId);
      if (v.type !== 'number' && !['eq', 'ne'].includes(test.operator)) add('文字和开关只支持等于或不等于比较。', nodeId);
    } else if (test.kind === 'not') condition(test.condition, nodeId, depth + 1);
    else {
      if (test.conditions.length === 0) add('条件组为空，请添加条件。', nodeId);
      test.conditions.forEach(c => condition(c, nodeId, depth + 1));
    }
  };
  const action = (a: StageAction, nodeId?: string, lineId?: string, effectStack = new Set<string>(), boundAssets = new Set<string>(), visualPath: (string | number)[] = []): void => {
    if (a.kind === 'visual') {
      if (a.persistent && a.wait) add('持续显示的对象不能等待结束；请指定时长或关闭等待。', nodeId, lineId);
      if (a.compositionId) {
        try { const expanded = applyVisualInputs(materializeVisualCompositions(project, a), {}); delete expanded.compositionId; action(expanded, nodeId, lineId, effectStack); }
        catch (error) { add(error instanceof Error ? error.message : String(error), nodeId, lineId); }
        return;
      }
      const bound = (...tail: string[]) => boundAssets.has(JSON.stringify([...visualPath, ...tail]));
      if (a.content === 'image' && !bound('assetId')) { if (a.assetId) asset(a.assetId, 'image', nodeId, lineId); else add('图片对象尚未选择图片。', nodeId, lineId); }
      if (a.content === 'video' && !bound('assetId')) { if (a.assetId) asset(a.assetId, 'video', nodeId, lineId); else add('视频对象尚未选择视频。', nodeId, lineId); }
      if (a.fontAssetId && !bound('fontAssetId')) asset(a.fontAssetId, 'font', nodeId, lineId);
      if (a.maskAssetId && !bound('maskAssetId')) asset(a.maskAssetId, 'image', nodeId, lineId);
      if (a.content === 'particles' && !a.particles && !a.glyphParticles) add('粒子对象尚未配置粒子参数。', nodeId, lineId);
      if (a.glyphParticles && a.glyphParticles.source !== 'text' && !bound('glyphParticles', 'assetId')) {
        if (a.glyphParticles.assetId) asset(a.glyphParticles.assetId, 'image', nodeId, lineId);
        else add('字形粒子尚未选择来源图片。', nodeId, lineId);
      }
      if (a.content === 'group') (a.children ?? []).forEach((child, index) => action(child, nodeId, lineId, effectStack, boundAssets, [...visualPath, 'children', index]));
    }
    if (a.kind === 'background') asset(a.assetId, 'image', nodeId, lineId);
    if (a.kind === 'unlock' && !assets.has(a.assetId)) add('要解锁的素材已不存在。', nodeId, lineId);
    if (a.kind === 'audioClip' || a.kind === 'music' || a.kind === 'sound') asset(a.assetId, 'audio', nodeId, lineId);
    if (a.kind === 'show' && a.characterId || a.kind === 'hide' || a.kind === 'animate') {
      const c = characters.get(a.characterId);
      if (!c) add('演出引用的角色已不存在。', nodeId, lineId);
      else if (a.kind === 'show' && a.expressionId && !effectiveCharacter(project, a.characterId)?.expressions.some(e => e.id === a.expressionId || e.name === a.expressionId)) add(`找不到“${c.name}”的表情。`, nodeId, lineId);
      if (c && a.kind === 'show' && a.presetId && !characterDisplayPreset(project, c.id, a.presetId)) add(`找不到“${c.name}”的站位预设。`, nodeId, lineId);
    }
    if (a.kind === 'characterFeature') {
      const character = effectiveCharacter(project, a.characterId);
      const feature = character?.features?.find(item => item.id === a.featureId);
      if (!character) add('角色功能引用的角色已不存在。', nodeId, lineId);
      else if (!feature) add(`找不到“${character.name}”的角色功能。`, nodeId, lineId);
      else {
        const key = `feature:${a.characterId}:${a.featureId}`;
        if (effectStack.has(key)) { add(`角色功能存在循环调用：${character.name} / ${feature.name}`, nodeId, lineId); return; }
        const nextStack = new Set(effectStack).add(key);
        characterFeatureActions(project, a.characterId, a.featureId).forEach(nested => action(nested, nodeId, lineId, nextStack));
      }
    }
    if (a.kind === 'animate' && a.repeat && !a.keyframes.some(frame => frame.duration > 0)) add('循环动画至少需要一个非零时长关键帧。', nodeId, lineId);
    if (a.kind === 'effect') {
      const effect = project.effects.find(item => item.id === a.effectId);
      if (!effect) { add('调用的效果实例不存在。', nodeId, lineId); return; }
      if (effectStack.has(effect.id)) { add(`效果实例存在循环调用：${effect.name}`, nodeId, lineId); return; }
      const nextStack = new Set(effectStack).add(effect.id);
      for (const nested of effect.actions ?? []) action(nested, nodeId, lineId, nextStack);
      for (const command of effect.commands) {
        const nested = textCommandAction(project, command);
        if (!nested) add(`效果“${effect.name}”中存在无效指令：${command}`, nodeId, lineId);
        else action(nested, nodeId, lineId, nextStack);
      }
    }
    if (a.kind === 'chapter') { if (a.backgroundId) asset(a.backgroundId, 'image', nodeId, lineId); if (a.titleImageId) asset(a.titleImageId, 'image', nodeId, lineId); if (a.soundId) asset(a.soundId, 'audio', nodeId, lineId); }
    if (a.kind === 'blueprint') {
      const graph = projectGraphs(project).find(graph => graph.id === a.blueprintId);
      if (!graph) { add('调用的通用蓝图不存在。', nodeId, lineId); return; }
      for (const key of Object.keys(a.inputs ?? {})) if (!graph.exposedInputs.some(pin => pin.id === key)) add(`蓝图“${graph.name}”已移除一个调用参数，请重新选择参数。`, nodeId, lineId);
      for (const pin of graph.exposedInputs) {
        const value = a.inputs?.[pin.id] ?? pin.defaultValue;
        if (value === undefined || value === '') { if (pin.required) add(`请填写蓝图“${graph.name}”的“${pin.name}”。`, nodeId, lineId); continue; }
        if (['number', 'boolean', 'string'].includes(pin.dataType) && typeof value !== pin.dataType) add(`蓝图“${graph.name}”的“${pin.name}”类型不正确。`, nodeId, lineId);
        if (pin.dataType === 'asset') {
          const target = blueprintInputTarget(graph, pin.id, project), visual = target.node && rawSavedBlueprintAction(target.node);
          const field = visual?.kind === 'visual' ? visualInputFields(visual).find(field => 'object_' + field.key === target.pinId) : undefined;
          const kind = visual?.kind === 'visual' && field ? visualAssetKind(visual, field.path) : undefined;
          // Unconnected asset inputs have no media constraint, including retained
          // wrapper inputs after a child timeline switches to its own default.
          const expectedKind = kind ?? (target.pinId === 'clip_assetId' || target.pinId === 'soundId' || ['playMusic', 'playSound'].includes(target.node?.type ?? '') ? 'audio'
            : ['showBackground', 'showChapter'].includes(target.node?.type ?? '') ? 'image' : undefined);
          asset(String(value), expectedKind, nodeId, lineId);
        }
        if (pin.dataType === 'character' && !characters.has(String(value))) add(`蓝图“${graph.name}”的“${pin.name}”引用的角色不存在。`, nodeId, lineId);
        if (pin.dataType === 'scene' && !scenes.has(String(value))) add(`蓝图“${graph.name}”的“${pin.name}”引用的场景不存在。`, nodeId, lineId);
      }
    }
  };

  for (const a of project.assets) {
    unique(a.id, a.name);
    if (a.kind === 'script' && !/^scripts\/.+\.rpy$/i.test(a.path.replaceAll('\\', '/'))) out.push({ severity: 'error', message: `脚本素材必须是 scripts 目录中的 .rpy 文件：${a.name}`, assetId: a.id });
    if (/^[a-zA-Z]:|^[\\/]|\0/.test(a.path) || a.path.replaceAll('\\', '/').split('/').some(p => p === '..' || p.includes(':'))) {
      out.push({ severity: 'error', message: `素材路径必须位于项目内：${a.name}`, assetId: a.id });
    }
  }
  for (const c of project.characters) {
    unique(c.id, c.name);
    if (!characterDisplayPreset(project, c.id)) add(`角色“${c.name}”的默认站位预设不存在。`);
    const presetIds = new Set<string>();
    for (const preset of c.displayPresets ?? []) {
      if (preset.id === 'default' || presetIds.has(preset.id)) add(`角色站位预设标识重复或使用了保留名称：${c.name} / ${preset.name}`);
      presetIds.add(preset.id);
    }
    const base = c.baseCharacterId ? characters.get(c.baseCharacterId) : undefined;
    if (c.baseCharacterId && !base) add(`角色“${c.name}”继承的基础角色不存在。`);
    if (c.blueprintId && !projectGraphs(project)?.some(graph => graph.id === c.blueprintId)) add(`角色“${c.name}”绑定的蓝图不存在。`);
    if (base) {
      const chain = new Set<string>([c.id]);
      let current = c.baseCharacterId;
      while (current) {
        if (chain.has(current)) { add(`角色“${c.name}”存在循环继承。`); break; }
        chain.add(current);
        current = characters.get(current)?.baseCharacterId ?? '';
      }
    }
    const inherited = base ? effectiveCharacter(project, base.id) : undefined;
    const members = new Set<string>();
    for (const e of c.expressions) {
      if (members.has(e.id)) add(`角色表情标识重复：${c.name} / ${e.name}`);
      members.add(e.id);
      if (!inherited?.expressions.some(item => item.id === e.id)) unique(e.id, `${c.name} / ${e.name}`);
      asset(e.assetId, 'image');
    }
    for (const feature of c.features ?? []) {
      if (members.has(feature.id)) add(`角色功能标识重复：${c.name} / ${feature.name}`);
      members.add(feature.id);
      if (!inherited?.features?.some(item => item.id === feature.id)) unique(feature.id, `${c.name} / ${feature.name}`);
      action({ kind: 'characterFeature', characterId: c.id, featureId: feature.id });
    }
  }
  for (const v of project.variables) { unique(v.id, v.name); variableValue(v, v.initial); }
  const parameterGroups = parameterSets(project);
  for (const group of project.parameterSets ?? []) unique(group.id, group.name);
  for (const variable of project.variables) if (variable.parameterSetId && !parameterGroups.some(group => group.id === variable.parameterSetId)) add('参数“' + variable.name + '”所属参数集不存在。');
  for (const variable of settingsParameters(project)) {
    if (variable.type === 'number' && parameterRange(variable).max <= parameterRange(variable).min) add('设置“' + variable.name + '”的滑条最大值必须大于最小值。');
    if (!validParameterSetting(variable, variable.initial)) add('设置“' + variable.name + '”的初始值不在设置范围或选项中。');
  }
  for (const effect of project.effects) unique(effect.id, effect.name);
  for (const graph of projectGraphs(project) ?? []) {
    unique(graph.id, `蓝图 ${graph.name}`);
    for (const node of graph.nodes) {
      unique(node.id, `蓝图节点 ${graph.name}/${node.name}`, node.id);
      if (node.type === 'sceneAction') {
        const command = textCommandAction(project, String(node.properties.command ?? ''));
        if (command) action(command, node.id);
      }
      if (node.type === 'effect' && typeof node.properties.effectId === 'string') action({ kind: 'effect', effectId: node.properties.effectId }, node.id);
      if (node.type === 'savedAction') {
        const stored = savedBlueprintAction(node);
        // Connected asset fields are supplied at invocation; an empty template
        // default is not a missing image. Calls validate their supplied assets.
        const linked = new Set(graph.links.filter(link => link.toNodeId === node.id).map(link => link.toPinId));
        const bound = new Set(stored?.kind === 'visual' ? visualInputFields(stored).filter(field => field.type === 'asset' && linked.has('object_' + field.key)).map(field => JSON.stringify(field.path)) : []);
        if (stored) action(stored, node.id, undefined, new Set(), bound);
      }
    }
  }
  out.push(...validateBlueprints(project));
  for (const c of project.chapters) unique(c.id, c.name);
  for (const s of project.scenes) {
    unique(s.id, s.name);
    if (!chapters.has(s.chapterId)) add(`场景“${s.name}”所属章节不存在。`);
    if (s.blueprintId && !projectGraphs(project)?.some(graph => graph.id === s.blueprintId)) add(`场景“${s.name}”绑定的蓝图不存在。`);
    for (const item of s.entryActions ?? []) action(item);
    if (s.baseSceneId) {
      if (!project.scenes.some(base => base.id === s.baseSceneId)) add(`场景“${s.name}”继承的基础场景不存在。`);
      else {
        const chain = new Set<string>([s.id]);
        let current = s.baseSceneId;
        while (current) {
          if (chain.has(current)) { add(`场景“${s.name}”存在循环继承。`); break; }
          chain.add(current);
          current = project.scenes.find(scene => scene.id === current)?.baseSceneId ?? '';
        }
      }
    }
  }
  if (!nodes.has(project.entryId)) out.push({ severity: 'error', code: 'missing-entry', setting: 'entry', message: '故事入口指向的段落已不存在。', help: '在「作品设置 → 故事入口」选择开始游戏时播放的段落。入口可以是任意剧情段落，无需额外添加 @开始。' });
  if (project.scenes.length === 0) add('项目至少需要一个场景。');
  for (const node of project.nodes) {
    unique(node.id, node.name, node.id);
    if (!scenes.has(node.sceneId)) add('节点所属场景不存在。', node.id);
    for (const edge of targets(node)) {
      if (!edge.target && ((node.kind === 'interaction' && (edge.port === 'cancel' || (edge.port === 'timeout' && node.timeoutSeconds === 0))) || (node.kind === 'minigame' && edge.port === 'cancel'))) continue;
      if (!edge.target) add(`“${node.name}”有未连接的出口。`, node.id);
      else if (!nodes.has(edge.target)) add(`“${node.name}”连接的节点已不存在。`, node.id);
    }
    switch (node.kind) {
      case 'jump': {
        const transition = node.sceneTransition;
        if (transition?.fromSceneId && !scenes.has(transition.fromSceneId)) add('转场源场景不存在。', node.id);
        if (transition?.toSceneId && !scenes.has(transition.toSceneId)) add('转场目标场景不存在。', node.id);
        if (transition?.fromSceneId && transition.fromSceneId !== node.sceneId) add('转场源场景必须与跳转节点所属场景一致。', node.id);
        const targetSceneId = node.target ? nodes.get(node.target)?.sceneId : undefined;
        if (transition?.toSceneId && targetSceneId && transition.toSceneId !== targetSceneId) add('转场目标场景必须与跳转目标节点一致。', node.id);
        break;
      }
      case 'passage':
        for (const line of node.lines) {
          unique(line.id, '对白', node.id);
          if (line.speakerId && !characters.has(line.speakerId)) add('对白角色不存在。', node.id, line.id);
          if (line.voiceId) asset(line.voiceId, 'audio', node.id, line.id);
          line.actions.forEach(a => action(a, node.id, line.id));
        }
        break;
      case 'choice':
        if (node.choices.length === 0) add('选择至少需要一个选项。', node.id);
        for (const option of node.choices) {
          unique(option.id, '选项', node.id);
          if (!option.text.trim()) add('选项文字不能为空。', node.id);
          if (option.condition) condition(option.condition, node.id);
        }
        if (node.choices.length && node.choices.every(c => c.condition)) add('所有选项都带条件，请确认始终有可用选项。', node.id, undefined, 'warning');
        break;
      case 'condition': condition(node.condition, node.id); break;
      case 'interaction':
        for (const hotspot of node.hotspots) {
          unique(hotspot.id, '互动区域', node.id);
          if (!hotspot.name.trim()) add('互动区域名称不能为空。', node.id);
          if (hotspot.x + hotspot.width > 1.001 || hotspot.y + hotspot.height > 1.001) add('互动区域超出了画面边界。', node.id);
          if (hotspot.characterId && !characters.has(hotspot.characterId)) add('互动区域关联的角色不存在。', node.id);
          if (hotspot.condition) condition(hotspot.condition, node.id);
        }
        break;
      case 'minigame':
        if (node.template === 'password' && !node.password.length) add('密码锁的密码不能为空。', node.id);
        if (node.template === 'custom' && !node.minigameId) add('自定义小游戏需要绑定一个小游戏定义。', node.id);
        else if (node.template === 'custom' && !project.minigames?.some(game => game.id === node.minigameId)) add('自定义小游戏绑定的定义已不存在。', node.id);
        break;
      case 'chapterTitle':
        if (!node.title.trim()) add('章节标题不能为空。', node.id);
        if (node.backgroundId) asset(node.backgroundId, 'image', node.id);
        if (node.titleImageId) asset(node.titleImageId, 'image', node.id);
        if (node.soundId) asset(node.soundId, 'audio', node.id);
        break;
      case 'set': {
        if (node.when) condition(node.when, node.id);
        const v = variables.get(node.variableId);
        if (!v) add('修改状态节点引用的状态不存在。', node.id);
        else {
          variableValue(v, node.value, node.id);
          if (node.operation === 'add' && v.type !== 'number') add('只有数值状态支持增加。', node.id);
        }
        break;
      }
    }
  }
  if (project.ui.menuBackgroundId) asset(project.ui.menuBackgroundId, 'image');
  if (project.ui.menuMusicId) asset(project.ui.menuMusicId, 'audio');
  if (project.ui.hoverSoundId) asset(project.ui.hoverSoundId, 'audio');
  if (project.ui.chapterTransition?.overlayId) asset(project.ui.chapterTransition.overlayId, 'image');
  if (project.ui.chapterTransition?.maskId) asset(project.ui.chapterTransition.maskId, 'image');
  if (project.ui.chapterTransition?.dissolveId) asset(project.ui.chapterTransition.dissolveId, 'image');
  if (project.ui.fontAssetId) asset(project.ui.fontAssetId, 'font');
  if (project.ui.continueIndicatorId) asset(project.ui.continueIndicatorId, 'image');
  for (const theme of [project.ui, ...(project.ui.instances ?? [])]) {
    for (const page of Object.values(theme.pages ?? {})) if (page.backgroundId) asset(page.backgroundId, 'image');
  }
  for (const style of project.ui.flowStyles ?? []) {
    unique(style.id, style.name);
    for (const state of ['idle', 'hover', 'pressed', 'selected', 'disabled'] as const) if (style.skin?.[state]) asset(style.skin[state], 'image');
    if (style.style?.fontAssetId) asset(style.style.fontAssetId, 'font');
  }
  for (const item of [...project.chapters, ...project.scenes, ...project.nodes]) if (item.flowchart?.styleId && !project.ui.flowStyles?.some(s => s.id === item.flowchart?.styleId)) add('流程图样式已不存在：' + item.name, project.nodes.some(n => n.id === item.id) ? item.id : undefined);
  for (const components of [project.ui.components, ...(project.ui.instances ?? []).map(i => effectiveUiComponents({ ...project.ui, activeInstanceId: i.id })), ...project.ui.customPages.map(p => p.components)]) for (const problem of uiHierarchyProblems(components)) add('界面子对象：' + problem.message);
  const clickSources = new Set(projectGraphs(project).flatMap(graph => graph.nodes.filter(node => node.type === 'eventClick').map(node => node.properties.componentId)));
  const uiComponent = (c: UiComponent, owner: Pick<NonNullable<Diagnostic['ui']>, 'instanceId' | 'customPageId'> = {}) => {
    const firstIssue = out.length;
    const complete = uiComponentSchema.safeParse(c);
    if (!complete.success) for (const issue of complete.error.issues) if (issue.code === 'custom') add(issue.message);
    if (c.kind === 'image') { if (!c.assetId) add('界面图片组件尚未选择素材。'); else asset(c.assetId, 'image'); }
    if (c.kind === 'video') { if (!c.assetId) add('界面视频组件尚未选择素材。'); else asset(c.assetId, 'video'); }
    if (c.kind === 'spine') {
      if (!c.assetId) add('骨骼动画组件尚未选择素材。'); else asset(c.assetId, 'spine');
      const data = assets.get(c.assetId ?? '')?.spine;
      if (c.spine?.animation && data && !data.animations.some(animation => animation.name === c.spine?.animation)) add(`骨骼素材没有动画“${c.spine.animation}”。`);
      if (c.spine?.skin && data && !data.skins.includes(c.spine.skin)) add(`骨骼素材没有皮肤“${c.spine.skin}”。`);
    }
    if (c.posterId) asset(c.posterId, 'image');
    if (c.hoverSoundId) asset(c.hoverSoundId, 'audio');
    for (const skin of [c.skin, c.slider?.thumb, c.selector?.itemSkin, c.list?.voiceReplaySkin, c.list?.voiceFavoriteSkin, c.list?.pageSkin, c.list?.flowEndSkin, c.list?.flowChapterSkin, c.list?.flowScrollbar?.thumb, c.list?.slotActionSkin, c.list?.slotSaveSkin, c.list?.autoSlotSkin, c.list?.numberSkin]) for (const state of ['idle', 'hover', 'pressed', 'selected', 'disabled'] as const) if (skin?.[state]) asset(skin[state], 'image');
    for (const id of [c.slider?.trackId, c.slider?.fillId, c.selector?.popupBackgroundId, c.selector?.arrowId]) if (id) asset(id, 'image');
    if (c.preferenceCharacterId && !characters.has(c.preferenceCharacterId)) add('玩家设置引用的配音角色不存在。');
    if (c.parameterId && !variables.has(c.parameterId)) add('控件绑定的参数已不存在，请在组件设置中重新选择。');
    if (c.style?.fontAssetId) asset(c.style.fontAssetId, 'font');
    if (c.list?.lockedAssetId) asset(c.list.lockedAssetId, 'image');
    if (c.list?.pageFontAssetId) asset(c.list.pageFontAssetId, 'font');
    if (c.list?.emptyAssetId) asset(c.list.emptyAssetId, 'image');
    if (c.list?.hoverOverlayId) asset(c.list.hoverOverlayId, 'image');
    if (c.list?.thumbnailFrame?.assetId) asset(c.list.thumbnailFrame.assetId, 'image');
    if (c.list?.flowLineAssetId) asset(c.list.flowLineAssetId, 'image');
    if (c.list?.flowVerticalLineAssetId) asset(c.list.flowVerticalLineAssetId, 'image');
    if (c.list?.flowCurrentMarker) asset(c.list.flowCurrentMarker.assetId, 'image');
    if (c.list?.flowScrollbar?.trackId) asset(c.list.flowScrollbar.trackId, 'image');
    for (const id of c.list?.assetIds ?? []) asset(id, ['musicTrackList', 'voiceCollection'].includes(c.kind) ? 'audio' : 'image');
    for (const group of c.list?.galleryGroups ?? []) {
      if (group.thumbnailAssetId) asset(group.thumbnailAssetId, 'image');
      for (const id of group.assetIds) asset(id, 'image');
      if (group.unlockWhen) condition(group.unlockWhen);
      for (const [id, test] of Object.entries(group.variantUnlockWhen ?? {})) { asset(id, 'image'); condition(test); if (!group.assetIds.includes(id)) add('分镜解锁条件引用的图片不在该图鉴分组中。'); }
      if (!group.assetIds.length) out.push({ severity: 'warning', code: 'ui.gallery.emptyGroup', message: `图鉴分组“${group.name}”还没有分镜。` });
    }
    for (const [id, test] of Object.entries(c.list?.galleryUnlockWhen ?? {})) { asset(id, 'image'); condition(test); }
    if (c.visibleWhen) condition(c.visibleWhen);
    if (c.enabledWhen) condition(c.enabledWhen);
    if (c.selectedWhen) condition(c.selectedWhen);
    if (c.kind === 'button' && !c.action && !c.events?.onClick && !clickSources.has(c.id)) out.push({
      severity: 'warning', code: 'ui.button.unbound', message: `按钮“${c.name || c.text || c.id}”尚未绑定点击行为。`,
      help: '点击“定位控件”会打开所属页面、选中层级中的按钮并显示属性。在“点击行为”中选择操作，或在“点击事件蓝图”中选择蓝图；也可以在蓝图中添加“点击控件时”节点并选择此按钮。装饰用元素可改用图片或文字控件。',
    });
    if (c.action === 'blueprint' && c.blueprintId && !projectGraphs(project)?.some(graph => graph.id === c.blueprintId)) add('界面按钮调用的蓝图不存在。');
    if (c.events?.onClick && !projectGraphs(project)?.some(graph => graph.id === c.events?.onClick)) add('界面组件的点击事件蓝图不存在。');
    if (c.events?.onShow && !projectGraphs(project)?.some(graph => graph.id === c.events?.onShow)) add('界面组件的显示事件蓝图不存在。');
    if (c.action?.startsWith('minigame') && c.page !== 'custom') add('结束小游戏动作只能用于自定义交互页面。');
    for (let index = firstIssue; index < out.length; index++) {
      out[index].ui = { page: c.page, componentId: c.id, ...owner };
      out[index].help ??= '点击“定位控件”打开所属页面，在选中控件的属性中检查提示提到的素材、状态条件或事件蓝图。';
    }
  };
  for (const c of project.ui.components) {
    unique(c.id, '界面组件');
    if (c.page === 'custom') add('自定义页面组件必须保存在具体的自定义页面中。');
    uiComponent(c);
  }
  for (const instance of project.ui.instances ?? []) {
    unique(instance.id, `界面实例 ${instance.name}`);
    if (instance.blueprintId && !projectGraphs(project)?.some(graph => graph.id === instance.blueprintId)) add(`界面实例“${instance.name}”绑定的蓝图不存在。`);
    if (instance.baseUiId && !project.ui.instances?.some(base => base.id === instance.baseUiId)) add(`界面实例“${instance.name}”继承的实例不存在。`);
    if (instance.baseUiId) {
      const chain = new Set<string>([instance.id]);
      let current = instance.baseUiId;
      while (current) {
        if (chain.has(current)) { add(`界面实例“${instance.name}”存在循环继承。`); break; }
        chain.add(current);
        current = project.ui.instances?.find(item => item.id === current)?.baseUiId ?? '';
      }
    }
    const inherited = effectiveUiComponents({ ...project.ui, activeInstanceId: instance.baseUiId });
    const members = new Set<string>();
    for (const component of instance.components) {
      if (members.has(component.id)) add(`界面实例“${instance.name}”内的组件标识重复。`);
      members.add(component.id);
      if (!inherited.some(item => item.id === component.id)) unique(component.id, `界面实例 ${instance.name} / 组件`);
      uiComponent(component, { instanceId: instance.id });
      if (component.page === 'custom') add(`界面实例“${instance.name}”不能包含自定义页面组件。`);
    }
  }
  for (const page of project.ui.customPages ?? []) {
    unique(page.id, `自定义页面 ${page.name}`);
    if (page.backgroundId) asset(page.backgroundId, 'image');
    if (page.onShowBlueprintId && !projectGraphs(project)?.some(graph => graph.id === page.onShowBlueprintId)) add(`自定义页面“${page.name}”的显示事件蓝图不存在。`);
    for (const component of page.components) {
      unique(component.id, `自定义页面 ${page.name} / 组件`);
      if (component.page !== 'custom') add(`自定义页面“${page.name}”包含了错误页面类型的组件。`);
      uiComponent(component, { customPageId: page.id });
    }
    const eventBlueprintIds = [page.onShowBlueprintId, ...page.components.flatMap(component => [component.blueprintId, component.events?.onClick, component.events?.onShow])].filter((id): id is string => !!id);
    const hasBlueprintExit = eventBlueprintIds.some(id => projectGraphs(project)?.find(graph => graph.id === id)?.nodes.some(node => node.type === 'finishMinigame')) || projectGraphs(project).some(graph => graph.nodes.some(node => node.type === 'closeUiPage' && node.properties.pageId === page.id));
    const hasDirectExit = page.components.some(component => ['minigameSuccess', 'minigameFailure', 'minigameCancel'].includes(component.action ?? ''));
    if (!hasDirectExit && !hasBlueprintExit && project.minigames.some(game => game.uiPageId === page.id)) add(`小游戏页面“${page.name}”没有结束按钮或关闭界面节点；可添加关闭操作。`, undefined, undefined, 'warning');
  }
  for (const game of project.minigames ?? []) {
    unique(game.id, `小游戏 ${game.name}`);
    if (!project.ui.customPages?.some(page => page.id === game.uiPageId)) add(`小游戏“${game.name}”绑定的自定义页面不存在。`);
    if (game.mode === 'blueprint') {
      const graph = projectGraphs(project)?.find(item => item.id === game.blueprintId);
      if (!graph) add(`小游戏“${game.name}”绑定的逻辑蓝图不存在。`);
      else if (graph.kind !== 'minigame') add(`小游戏“${game.name}”应绑定“小游戏逻辑”用途的蓝图。`);
    } else {
      const script = assets.get(game.script?.assetId ?? '');
      if (!script || script.kind !== 'script') add(`小游戏“${game.name}”绑定的 Ren'Py 脚本不存在。`);
      if (!game.script?.entry) add(`小游戏“${game.name}”尚未填写脚本入口 Label。`);
    }
  }
  if (project.ui.activeInstanceId && !project.ui.instances?.some(instance => instance.id === project.ui.activeInstanceId)) add('当前界面实例不存在。');
  const effectiveUi = effectiveUiTheme(project.ui);
  const effectiveComponents = effectiveUiComponents(project.ui);
  if (effectiveUi.fontAssetId) asset(effectiveUi.fontAssetId, 'font');
  if (effectiveUi.menuMusicId) asset(effectiveUi.menuMusicId, 'audio');
  if (effectiveUi.hoverSoundId) asset(effectiveUi.hoverSoundId, 'audio');
  if (effectiveUi.continueIndicatorId) asset(effectiveUi.continueIndicatorId, 'image');
  if (effectiveUi.pages?.say?.layout === 'custom' && !effectiveComponents.some(c => c.page === 'say' && c.binding === 'dialogue')) add('自定义对话页需要“当前对白”文字组件。');
  if (effectiveUi.pages?.choice?.layout === 'custom' && !effectiveComponents.some(c => c.page === 'choice' && c.kind === 'choiceList')) add('自定义选项页需要“选项列表”组件。');
  if (effectiveUi.pages?.messageBox?.layout === 'custom') {
    const messages = effectiveComponents.filter(c => c.page === 'messageBox');
    if (!messages.some(c => c.binding === 'confirmation')) add('自定义消息框需要“确认提示”文字组件。');
    for (const action of ['confirmYes', 'confirmNo'] as const) if (!messages.some(c => c.action === action)) add(`自定义消息框需要“${action === 'confirmYes' ? '确认' : '取消'}”按钮。`);
  }
  const reachable = new Set<string>();
  const pending = [project.entryId];
  while (pending.length) {
    const current = pending.pop()!;
    if (reachable.has(current)) continue;
    reachable.add(current);
    const node = nodes.get(current);
    if (node) for (const edge of targets(node)) if (edge.target) pending.push(edge.target);
  }
  if (nodes.has(project.entryId)) for (const node of project.nodes) if (!reachable.has(node.id)) out.push({
    severity: 'warning', code: 'unreachable-node', nodeId: node.id,
    message: `从故事入口无法到达“${node.name}”。`,
    help: `当前故事入口是“${nodes.get(project.entryId)!.name}”。沿现有剧情连接无法走到这里。请检查前一段的 @跳转、选项去向或蓝图连线，也可以在作品设置中更换故事入口。备用内容可以保留；这条提醒不阻止试玩。`,
  });

  // Only unconditional, noninteractive cycles are certainly nonterminating.
  const instantaneous = new Set(project.nodes.filter(n => !['condition', 'choice', 'interaction', 'minigame', 'end', 'return'].includes(n.kind) && !(n.kind === 'passage' && n.lines.some(l => l.text.trim() || l.actions.some(a => a.kind === 'pause' && a.seconds > 0)))).map(n => n.id));
  const indegree = new Map([...instantaneous].map(id => [id, 0]));
  for (const id of instantaneous) for (const edge of targets(nodes.get(id)!)) if (edge.target && instantaneous.has(edge.target)) indegree.set(edge.target, indegree.get(edge.target)! + 1);
  const ready = [...instantaneous].filter(id => indegree.get(id) === 0);
  while (ready.length) {
    const id = ready.pop()!;
    instantaneous.delete(id);
    for (const edge of targets(nodes.get(id)!)) if (edge.target && instantaneous.has(edge.target)) {
      const count = indegree.get(edge.target)! - 1;
      indegree.set(edge.target, count);
      if (!count) ready.push(edge.target);
    }
  }
  for (const id of instantaneous) add('存在没有等待或退出条件的循环，请连接到对白、选择或条件判断。', id);
  return out;
}
