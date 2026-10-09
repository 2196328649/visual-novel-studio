import { projectGraphs } from '../core/project-resources';
import { timelinePlaybackLayout } from '../core/performance-timeline';
import { performancePlayback } from '../core/standalone-performance';
import { actionTiming } from '../core/performance-timing';
import { createActorTransitionsRuntime } from './actor-transitions';
import { createPerformancePlaybackRuntime } from './performance-playback';
import { earlyDialogueRuntime } from './early-dialogue';
import { createAudioClipRuntime } from './audio-clip-runtime';
import { audioClipFields } from '../core/audio-clip';
import { interleaveProjectTimelines } from '../core/timeline-interleave';
import { canLaunchTimeline } from '../core/timeline-launch';
import { nodeMoveOffsets, nodeAfterOffsets, afterOffsetDuration } from '../core/move-offsets';
import { applyVisualInputs, visualInputFields } from '../core/visual-object';
import { materializeVisualCompositions } from '../core/visual-composition';
import { actorAnimationDuration, actorCurveProperties } from '../core/actor-animation';
import { cameraAnimationDuration, cameraCurveProperties } from '../core/camera-animation';
import { normalizeChapterCompositions } from '../core/chapter-composition';
import { effectiveCharacter, effectiveScene, effectiveUiComponents, effectiveUiTheme, projectSchema, type BlueprintGraph, type BlueprintNode, type Condition, type Diagnostic, type Project, type StageAction, type VariableValue } from '../core/model';
import { savedBlueprintAction, rawSavedBlueprintAction } from '../core/blueprint-authoring';
import { validateProject } from '../core/validate';
import { createScreens, pythonLiteral, renpyText } from './screens';
import { expandStageAction, textCommandAction } from '../core/text-script';
import { blueprintInputValue } from '../core/blueprint';
import { createBlueprintRuntime } from './blueprint-runtime';
import { createUiRuntime } from './ui-runtime';
import { createSpineRuntime } from './spine-runtime';
import { createPreferencesRuntime } from './preferences-runtime';
import { createParameterRuntime } from './parameter-runtime';
import { createChapterRuntime } from './chapter-runtime';
import { createWindowRuntime } from './window-runtime';
import { resolveShowAction } from '../core/character-presets';
import { actorTag } from '../core/actor-instance';
import { createStoryMenuRuntime } from './story-menu-runtime';
import { voiceVisitKey } from '../core/story-menu';
import { conditionExpression, variableReference } from './expressions';
import { exportSettings } from '../core/export-settings';
export { conditionExpression, variableReference } from './expressions';

export interface CompileOptions {
  development?: boolean;
  preview?: { entryId?: string; variables?: Record<string, VariableValue> };
}

export interface CompileResult {
  files: Record<string, string>;
  sourceMap: Record<string, { nodeId: string; lineId?: string }>;
  diagnostics: Diagnostic[];
}

const nodeLabel = (id: string) => `vn_node_${id}`;
const appearanceTransition = (mode: string, duration: string) => mode === 'fade' ? `Fade((${duration}) / 2.0, 0.0, (${duration}) / 2.0)` : mode === 'move' ? `MoveTransition(${duration})` : `Dissolve(${duration})`;
function continueIndicator(project: Project): string {
  const ui = effectiveUiTheme(project.ui);
  const image = project.assets.find(asset => asset.id === ui.continueIndicatorId && asset.kind === 'image');
  if (!image) return '';
  const width = Math.round(ui.continueIndicatorWidth ?? image.width ?? 32);
  const height = Math.max(1, Math.round(width * (image.height ?? 32) / (image.width ?? 32)));
  return `, ctc=Transform(${pythonLiteral(image.path.replaceAll('\\', '/'))}, xysize=(${width}, ${height}), fit="contain"), ctc_position="nestled-close"`;
}
const lineLabel = (nodeId: string, lineId: string) => `vn_line_${nodeId}_${lineId}`;
// Ren'Py names easein/easeout opposite to the editor's slow-start/slow-end curves.
const atlEasing = (easing: string) => easing === 'easein' ? 'easeout' : easing === 'easeout' ? 'easein' : easing === 'outquad' ? 'warp (lambda t: 1 - (1 - t) ** 2)' : easing;
const transformName = (action: StageAction) => {
  const data = JSON.stringify(action);
  let hash = 2166136261;
  for (let index = 0; index < data.length; index++) hash = Math.imul(hash ^ data.charCodeAt(index), 16777619);
  return `vn_${action.kind}_${(hash >>> 0).toString(16)}`;
};

export function compileProject(input: Project, options: CompileOptions = {}): CompileResult {
  const result: CompileResult = { files: {}, sourceMap: {}, diagnostics: [] };
  const parsed = projectSchema.safeParse(input);
  if (!parsed.success) {
    result.diagnostics = parsed.error.issues.map(issue => ({
      severity: 'error', message: `项目格式无效 (${issue.path.join('.')}): ${issue.message}`,
    }));
    return result;
  }
  let project = parsed.data;
  normalizeChapterCompositions(project);
  result.diagnostics = validateProject(project);
  if (options.preview?.entryId && !project.nodes.some(node => node.id === options.preview?.entryId)) {
    result.diagnostics.push({ severity: 'error', message: '预览起点不存在。', nodeId: options.preview.entryId });
  }
  for (const [id, value] of Object.entries(options.preview?.variables ?? {})) {
    const variable = project.variables.find(item => item.id === id);
    const expected = variable?.type === 'number' ? 'number' : variable?.type === 'boolean' ? 'boolean' : 'string';
    if (!variable || typeof value !== expected || (typeof value === 'number' && !Number.isFinite(value))) {
      result.diagnostics.push({ severity: 'error', message: `预览变量 ${id} 不存在或类型不匹配。` });
    }
  }
  if (result.diagnostics.some(item => item.severity === 'error')) return result;

  project = interleaveProjectTimelines(timelinePlaybackLayout(project));
  const assets = new Map(project.assets.map(asset => [asset.id, asset]));
  const statements: string[] = ['# Generated by Visual Novel Studio. Edit the project data, not this file.'];
  const emit = (text: string, origin?: { nodeId: string; lineId?: string }) => {
    statements.push(text);
    if (origin) {
      result.sourceMap[`game/story.rpy:${statements.length}`] = { ...origin };
      result.sourceMap[`story.rpy:${statements.length}`] = { ...origin };
    }
  };
  const assetPath = (id: string) => pythonLiteral(assets.get(id)!.path.replaceAll('\\', '/'));
  const callSites = new Map<string, number>();
  const callSite = (id: string) => { const count = callSites.get(id) ?? 0; callSites.set(id, count + 1); return count ? `${id}_${count}` : id; };
  const go = (target: string | undefined, origin: { nodeId: string; lineId?: string }, indent = '    ') => {
    emit(`${indent}jump ${target ? nodeLabel(target) : 'vn_finish'}`, origin);
  };
  const flushTransition = (origin: { nodeId: string; lineId?: string }, indent = '    ') => {
    emit(`${indent}$ vn_actor_flush()`, origin);
    emit(`${indent}$ vn_performance_reveal()`, origin);
    emit(`${indent}$ vn_apply_scene_transition()`, origin);
  };
  const pause = (seconds: string | number, origin: { nodeId: string; lineId?: string }, indent = '    ') => {
    emit(`${indent}$ vn_actor_flush()`, origin);
    emit(`${indent}if vn_performance_active or vn_performance_transition:`, origin);
    emit(`${indent}    $ vn_performance_pause(${seconds})`, origin);
    emit(`${indent}else:`, origin);
    emit(`${indent}    pause ${seconds}`, origin);
  };
  const stage = (action: StageAction, origin: { nodeId: string; lineId?: string }, indent = '    ', layerExpression?: string) => {
    const write = (text: string) => emit(`${indent}${text}`, origin);
    if (!['show', 'hide', 'background', 'blueprint', 'effect', 'characterFeature'].includes(action.kind)) write('$ vn_actor_flush()');
    const timing = actionTiming(action);
    if (timing.duration > 0 && !['pause', 'music', 'stopMusic'].includes(action.kind)) write(`$ vn_performance_extend(${timing.duration + (action.kind === 'show' ? afterOffsetDuration(action.afterOffsets) : 0)})`);
    switch (action.kind) {
      case 'hideVisual':
        write(`$ vn_visual_wait = vn_hide_visual(${pythonLiteral(action.instanceId)}, ${pythonLiteral(action.exitTransition ?? null)})`);
        if (action.wait !== false) { write('if vn_visual_wait:'); pause('vn_visual_wait', origin, indent + '    '); }
        break;
      case 'visual': {
        const expanded = applyVisualInputs(materializeVisualCompositions(project, action), {});
        const data = { ...expanded, path: project.assets.find(asset => asset.id === expanded.assetId)?.path.replaceAll('\\', '/'), fontPath: project.assets.find(asset => asset.id === (expanded.fontAssetId ?? project.ui.fontAssetId))?.path.replaceAll('\\', '/') ?? 'fonts/SourceHanSansLite.ttf' };
        write(`$ vn_visual_wait = vn_show_visual(${pythonLiteral(data)})`);
        if (action.wait || action.transitionWait) { write('if vn_visual_wait:'); flushTransition(origin, indent + '    '); pause('vn_visual_wait', origin, indent + '    '); }
        break;
      }
      case 'background':
        write('if vn_has_persistent_actors():');
        write(`    $ vn_bp_background(${pythonLiteral(action.assetId)})`);
        write('else:');
        write(`    scene vn_background_${action.assetId}`);
        write('    $ vn_actor_instances.clear()');
        write('    $ vn_actor_reset_transitions(keep_overrides=True)');
        write(`$ vn_unlock(${pythonLiteral(action.assetId)})`);
        break;
      case 'show': {
        if (!action.characterId || !action.expressionId) {
          const duration = action.duration ?? (action.transition === 'fade' ? 1 : .5);
          write(`if vn_bp_show_speaker(${pythonLiteral(action.expressionId)}, ${action.x}, ${action.y}, ${action.scale}, ${layerExpression ?? action.layer}, preset_id=${pythonLiteral(action.presetId ?? '')}, instance_id=${pythonLiteral(action.instanceId ?? '')}, lifetime=${pythonLiteral(action.lifetime ?? '')}, move_duration=${action.transition === 'move' ? duration : 'None'}, offset_duration=${action.transition === 'none' ? 0 : duration}, move_offsets=${pythonLiteral(action.moveOffsets)}, after_offsets=${pythonLiteral(action.afterOffsets)}, transitions=${pythonLiteral(action.actorTransitions)}, wait=${pythonLiteral(action.wait !== false)}, transition_mode=${pythonLiteral(action.transition)}, transition_duration=${duration}, character_id=${pythonLiteral(action.characterId)}):`);
          write('    if vn_bp_character_label(' + (action.characterId ? pythonLiteral(action.characterId) : 'vn_current_speaker') + '):');
          write(`        call expression vn_bp_character_label(${action.characterId ? pythonLiteral(action.characterId) : 'vn_current_speaker'}) from ${callSite('vn_show_current_character')}`);
          if (action.transition === 'move' && action.wait !== false) { write('    if not vn_actor_last_modern:'); flushTransition(origin, indent + '        '); pause(duration, origin, indent + '        '); }
          else if (action.transition !== 'none' && action.transition !== 'move') {
            write('    if vn_pending_scene_transition is None and vn_performance_transition is None and not vn_actor_last_modern:');
            const transition = appearanceTransition(action.transition, String(duration));
            write(action.wait === false ? `        $ renpy.transition(${transition}, layer="master")` : `        $ vn_stage_transition(${transition}, ${duration})`);
          }
          return;
        }
        const character = effectiveCharacter(project, action.characterId)!;
        const expression = character.expressions.find(item => item.id === action.expressionId)!;
        const placement = resolveShowAction(project, action);
        write('$ vn_actor_last_modern = False');
        write(`$ vn_actor_retire_pending(${pythonLiteral(actorTag(action))})`);
        write(`$ vn_actor_pending_exit.pop(${pythonLiteral(actorTag(action))}, None)`);
        write(`if vn_actor_rules(${pythonLiteral(action.characterId)}, ${pythonLiteral(action.actorTransitions)}, ${pythonLiteral(action.transition)}, ${action.duration ?? (action.transition === 'fade' ? 1 : .5)}, ${pythonLiteral(action.lifetime ?? '')} or vn_actor_instances.get(${pythonLiteral(actorTag(action))}, {}).get("lifetime", "")) is not None:`);
        write(`    $ vn_bp_show(${pythonLiteral(action.characterId)}, ${pythonLiteral(action.expressionId)}, ${placement.x}, ${placement.y}, ${placement.scale}, ${layerExpression ?? action.layer}, instance_id=${pythonLiteral(action.instanceId ?? '')}, lifetime=${pythonLiteral(action.lifetime ?? '')}, move_offsets=${pythonLiteral(action.moveOffsets)}, after_offsets=${pythonLiteral(action.afterOffsets)}, transitions=${pythonLiteral(action.actorTransitions)}, wait=${pythonLiteral(action.wait !== false)}, transition_mode=${pythonLiteral(action.transition)}, transition_duration=${action.duration ?? (action.transition === 'fade' ? 1 : .5)})`);
        write('else:');
        write(`    show vn_actor_${action.characterId} ${action.expressionId}${action.instanceId ? ` as ${actorTag(action)}` : ''} at ${action.transition === 'move' && (action.moveOffsets || action.afterOffsets) ? `vn_move_offsets(${pythonLiteral(actorTag(action))}, ${placement.x}, ${placement.y}, ${placement.scale}, ${action.duration ?? .5}, ${pythonLiteral(action.moveOffsets ?? {})}, ${pythonLiteral(action.afterOffsets ?? {})})` : action.transition === 'move' ? `vn_move_stage(${placement.x}, ${placement.y}, ${placement.scale}, ${action.duration ?? .5})` : (action.moveOffsets || action.afterOffsets) ? `vn_show_offsets(${placement.x}, ${placement.y}, ${placement.scale}, ${action.transition === 'none' ? 0 : action.duration ?? (action.transition === 'fade' ? 1 : .5)}, ${pythonLiteral(action.moveOffsets ?? {})}, ${pythonLiteral(action.afterOffsets ?? {})})` : `vn_stage(${placement.x}, ${placement.y}, ${placement.scale})`} zorder ${layerExpression ? '(' + layerExpression + ')' : action.layer}`);
        write(`    $ vn_track_actor(${pythonLiteral(action.characterId)}, ${pythonLiteral(action.expressionId)}, ${layerExpression ?? action.layer}, ${pythonLiteral(action.instanceId ?? '')}, ${pythonLiteral(action.lifetime ?? '')})`);
        write(`$ vn_unlock(${pythonLiteral(expression.assetId)})`);
        if (character.blueprintId) write(`call vn_blueprint_${character.blueprintId} from ${callSite(`vn_character_blueprint_${action.characterId}`)}`);
        break;
      }
      case 'hide': write(`$ vn_bp_hide(${pythonLiteral(action.characterId)}, ${pythonLiteral(action.instanceId ?? '')}, ${pythonLiteral({ mode: action.transition, duration: action.duration ?? (action.transition === 'fade' ? 1 : .5) })}, ${pythonLiteral(action.wait !== false)})`); break;
      case 'audioClip': write(`$ vn_audio_clip_play(${pythonLiteral(action)})`); if (action.wait) pause(action.duration, origin, indent); break;
      case 'music': write(`play music ${assetPath(action.assetId)} ${action.loop ? 'loop' : 'noloop'} fadein ${action.fade}`); break;
      case 'sound': write(`play sound ${assetPath(action.assetId)}`); break;
      case 'unlock': write(`$ vn_unlock(${pythonLiteral(action.assetId)})`); break;
      case 'stopMusic': write(`stop music fadeout ${action.fade}`); break;
      case 'pause': flushTransition(origin, indent); pause(action.seconds, origin, indent); break;
      case 'hideInterface': write('$ vn_set_interface_visible(False)'); break;
      case 'showInterface': write('$ vn_set_interface_visible(True)'); break;
      case 'startDialogue': flushTransition(origin, indent); write('$ vn_start_dialogue()'); break;
      case 'animate': {
        const transform = transformName(action);
        if (action.instanceId) write(`$ vn_animate_instance(${pythonLiteral(action.characterId)}, ${pythonLiteral(action.instanceId)}, ${transform})`);
        else {
          write(`if vn_actor_instances.get(${pythonLiteral(actorTag(action))}, {}).get("transitions") is not None:`);
          write(`    $ vn_animate_instance(${pythonLiteral(action.characterId)}, "", ${transform})`);
          write('else:');
          write(`    show vn_actor_${action.characterId} at ${transform}`);
        }
        if (action.wait && !action.repeat) { flushTransition(origin, indent); pause(actorAnimationDuration(action), origin, indent); }
        break;
      }
      case 'camera': {
        const transform = transformName(action);
        write(`camera master at ${transform}`);
        if (action.wait && cameraAnimationDuration(action)) { flushTransition(origin, indent); pause(cameraAnimationDuration(action), origin, indent); }
        break;
      }
      case 'shake':
        flushTransition(origin, indent);
        write(`show layer master at vn_blueprint_shake(${pythonLiteral(action.direction)}, ${action.duration ?? 0.6}, ${action.amplitude ?? 20})`);
        if (action.wait !== false) pause(action.duration ?? 0.6, origin, indent);
        break;
      case 'effect':
      case 'characterFeature':
        for (const nested of expandStageAction(project, action)) stage(nested, origin, indent);
        break;
      case 'blueprint': {
        const args = Object.entries((action.inputs ?? {})).map(([id, value]) => `vn_bp_in_${action.blueprintId}_${id}=${pythonLiteral(value)}`).join(', ');
        if (action.actorTransitions) write(`$ vn_actor_transition_overrides.append(${pythonLiteral(action.actorTransitions)})`);
        write(`call vn_blueprint_${action.blueprintId}${args ? `(${args})` : ''} from ${callSite(`vn_blueprint_call_${action.blueprintId}`)}`);
        if (action.actorTransitions) write('$ vn_actor_transition_overrides.pop()');
        break;
      }
      case 'chapter':
        if (action.soundId) write(`$ renpy.music.play(${assetPath(action.soundId)}, channel="sound", loop=False)`);
        write('if not renpy.is_skipping() and not (vn_performance_active and vn_performance_skipped):');
        {
          const args = `title=${renpyText(action.title)}, subtitle=${renpyText(action.subtitle)}, duration=${action.duration}, effect=${pythonLiteral(action.effect)}, background=${action.backgroundId ? assetPath(action.backgroundId) : 'None'}, title_image=${action.titleImageId ? assetPath(action.titleImageId) : 'None'}`;
          const show = `$ renpy.show_screen("vn_chapter_title", ${args}, _vn_wait=False, _vn_layer="master", _layer="master", _zorder=${layerExpression ?? action.layer ?? 80})`;
          if (action.wait === false) { write(`    ${show}`); flushTransition(origin, indent + '    '); }
          else {
            write('    if vn_performance_active or vn_performance_transition:');
            write(`        ${show}`);
            flushTransition(origin, indent + '        ');
            write(`        $ vn_performance_pause(${action.duration})`);
            write('        hide screen vn_chapter_title onlayer master');
            write('    else:');
            write(`        call screen vn_chapter_title(${args})`);
          }
        }
        break;
    }
    if (action.kind === 'show' && action.transition === 'move') {
      if (action.wait !== false) { write('if not vn_actor_last_modern:'); flushTransition(origin, indent + '    '); pause(action.duration ?? .5, origin, indent + '    '); }
    } else if ('transition' in action && action.transition !== 'none') {
      write('if vn_pending_scene_transition is None and vn_performance_transition is None' + (action.kind === 'show' || action.kind === 'hide' ? ' and not vn_actor_last_modern' : '') + ':');
      const expression = action.duration === undefined ? action.transition : appearanceTransition(action.transition, String(action.duration));
      write(action.wait === false ? `    $ renpy.transition(${expression}, layer="master")` : `    $ vn_stage_transition(${expression}, ${action.duration ?? (action.transition === 'fade' ? 1 : .5)})`);
    }
  };

  for (const variable of project.variables) emit(`default ${variableReference(project, variable.id)} = ${pythonLiteral(variable.initial)}`);
  emit('default persistent.vn_unlocks = []');
  emit('default vn_current_node = None');
  emit('default vn_current_line = None');
  emit('default vn_current_speaker = None');
  emit('default vn_interaction_remaining = 0.0');
  emit('default vn_interaction_result = None');
  emit('default vn_minigame_answer = ""');
  emit('default vn_minigame_remaining = 0');
  emit('default vn_minigame_clicks = 0');
  emit('default vn_minigame_time_left = 0.0');
  emit('default vn_minigame_result = None');
  emit('default vn_pending_scene_transition = None');
  emit('default vn_current_scene = None');
  emit('default vn_scene_parameters = {}');
  // Exposed blueprint outputs live in the Ren'Py store so a call node can
  // expose typed data pins to the rest of the caller graph. They are reset at
  // every graph invocation below, which also makes an unconnected output
  // deterministic instead of leaking the previous call's value.
  for (const graph of projectGraphs(project) ?? []) {
    for (const pin of graph.exposedOutputs) emit(`default vn_bp_out_${graph.id}_${pin.id} = ${pythonLiteral(pin.defaultValue)}`);
    for (const node of graph.nodes) {
      if (node.type === 'callFunction' || node.type === 'callMacro') {
        const called = projectGraphs(project)?.find(item => item.id === node.properties.graphId);
        for (const pin of called?.exposedOutputs ?? []) emit(`default vn_bp_result_${node.id}_${pin.id} = ${pythonLiteral(pin.defaultValue)}`);
      }
    }
  }
  emit('');
  emit(`define narrator = Character(None, voice_tag="vn_voice_other"${continueIndicator(project)})`);
  const speakerColor = effectiveUiComponents(project.ui).find(component => component.binding === 'speaker')?.style?.textColor;
  for (const character of project.characters) {
    const effective = effectiveCharacter(project, character.id)!;
    emit(`define vn_character_${character.id} = Character(${renpyText(character.name)}, color=${pythonLiteral(speakerColor ?? character.color)}, voice_tag=${pythonLiteral(`vn_voice_${character.id}`)}${continueIndicator(project)})`);
    for (const expression of effective.expressions) emit(`image vn_actor_${character.id} ${expression.id} = ${assetPath(expression.assetId)}`);
  }
  for (const asset of project.assets.filter(item => item.kind === 'image')) {
    emit(`image vn_background_${asset.id} = Transform(${assetPath(asset.id)}, xysize=(${project.width}, ${project.height}), fit="cover")`);
  }
  emit('');
  emit('transform vn_stage(x, y, scale):');
  emit('    xpos float(x)');
  emit('    ypos float(y)');
  emit('    xanchor 0.5');
  emit('    yanchor 1.0');
  emit('    rotate_pad False transform_anchor True');
  emit('    zoom scale');
  emit('');
  const transforms = new Set<string>();
  emit('transform vn_move_stage(x, y, scale, duration):');
  emit('    subpixel True');
  emit('    xanchor 0.5 yanchor 1.0');
  emit('    rotate_pad False transform_anchor True');
  emit('    on show:');
  emit('        xpos (float(x) - 0.15) ypos float(y) zoom float(scale) rotate 0 alpha 0.0');
  emit('        easein duration xpos float(x) ypos float(y) zoom float(scale) alpha 1.0');
  emit('    on replace:');
  emit('        rotate 0');
  emit('        easein duration xpos float(x) ypos float(y) zoom float(scale) alpha 1.0');
  emit('');
  const allActions = [
    ...project.scenes.flatMap(scene => effectiveScene(project, scene.id)?.entryActions ?? []),
    ...project.nodes.flatMap(node => node.kind === 'passage' ? node.lines.flatMap(line => line.actions) : []),
    ...(projectGraphs(project) ?? []).flatMap(graph => graph.nodes.flatMap(node => {
      if (node.type === 'effect' && typeof node.properties.effectId === 'string') return [{ kind: 'effect' as const, effectId: node.properties.effectId }];
      const action = node.type === 'savedAction' ? savedBlueprintAction(node) : node.type === 'sceneAction' ? textCommandAction(project, String(node.properties.command ?? '')) : undefined;
      return action ? [action] : [];
    })),
  ].flatMap(action => expandStageAction(project, action));
  for (const action of allActions) {
    const transform = transformName(action);
    if (transforms.has(transform)) continue;
    transforms.add(transform);
    if (action.kind === 'animate') {
      emit(`transform ${transform}:`);
      emit('    subpixel True');
      emit('    xanchor 0.5 yanchor 1.0');
      emit('    rotate_pad False transform_anchor True');
      if (!Object.keys(action.curves ?? {}).length) {
        for (const frame of action.keyframes) emit(`    ${atlEasing(frame.easing)} ${frame.duration} xpos ${Number(frame.x).toFixed(6)} ypos ${Number(frame.y).toFixed(6)} zoom ${frame.scale} rotate ${frame.rotation} alpha ${frame.opacity}`);
      } else {
        const properties = { x: 'xpos', y: 'ypos', scale: 'zoom', rotation: 'rotate', opacity: 'alpha' }, duration = actorAnimationDuration(action);
        emit('    parallel:');
        for (const frame of action.keyframes) {
          const values = actorCurveProperties.filter(key => !action.curves?.[key]?.length).map(key => `${properties[key]} ${key === 'x' || key === 'y' ? Number(frame[key]).toFixed(6) : frame[key]}`).join(' ');
          emit(values ? `        ${atlEasing(frame.easing)} ${frame.duration} ${values}` : `        pause ${frame.duration}`);
        }
        const baseDuration = action.keyframes.reduce((sum, frame) => sum + frame.duration, 0);
        if (baseDuration < duration) emit(`        pause ${duration - baseDuration}`);
        for (const property of actorCurveProperties) {
          const frames = [...(action.curves?.[property] ?? [])].sort((a, b) => a.at - b.at); if (!frames.length) continue;
          emit('    parallel:'); emit(`        ${properties[property]} ${property === 'x' || property === 'y' ? Number(frames[0].value).toFixed(6) : frames[0].value}`);
          if (frames[0].at) emit(`        pause ${frames[0].at}`);
          frames.slice(1).forEach((frame, index) => emit(`        ${atlEasing(frame.easing)} ${frame.at - frames[index].at} ${properties[property]} ${property === 'x' || property === 'y' ? Number(frame.value).toFixed(6) : frame.value}`));
          if (frames.at(-1)!.at < duration) emit(`        pause ${duration - frames.at(-1)!.at}`);
        }
      }
      if (action.repeat) emit('    repeat');
      emit('');
    }
    if (action.kind === 'camera') {
      emit(`transform ${transform}:`);
      emit('    subpixel True');
      emit('    align (0.5, 0.5)');
      if (!Object.keys(action.curves ?? {}).length) emit(`    ${atlEasing(action.easing)} ${action.duration} xoffset ${action.x * project.width} yoffset ${action.y * project.height} zoom ${action.zoom} rotate ${action.rotation}`);
      else {
        const properties = { x: 'xoffset', y: 'yoffset', zoom: 'zoom', rotation: 'rotate' };
        const units = { x: project.width, y: project.height, zoom: 1, rotation: 1 }, duration = cameraAnimationDuration(action);
        emit('    parallel:');
        const values = cameraCurveProperties.filter(key => !action.curves?.[key]?.length).map(key => `${properties[key]} ${action[key] * units[key]}`).join(' ');
        emit(values ? `        ${atlEasing(action.easing)} ${action.duration} ${values}` : `        pause ${action.duration}`);
        if (action.duration < duration) emit(`        pause ${duration - action.duration}`);
        for (const key of cameraCurveProperties) {
          const frames = [...(action.curves?.[key] ?? [])].sort((a, b) => a.at - b.at); if (!frames.length) continue;
          emit('    parallel:'); emit(`        ${properties[key]} ${frames[0].value * units[key]}`);
          if (frames[0].at) emit(`        pause ${frames[0].at}`);
          frames.slice(1).forEach((frame, index) => emit(`        ${atlEasing(frame.easing)} ${frame.at - frames[index].at} ${properties[key]} ${frame.value * units[key]}`));
          if (frames.at(-1)!.at < duration) emit(`        pause ${duration - frames.at(-1)!.at}`);
        }
      }
      emit('');
    }
  }
  emit('init python:');
  emit('    def vn_apply_scene_transition():');
  emit('        global vn_pending_scene_transition');
  emit('        if vn_pending_scene_transition is None:');
  emit('            return');
  emit('        transition = vn_pending_scene_transition');
  emit('        vn_pending_scene_transition = None');
  emit('        duration = transition["duration"]');
  emit('        if transition["mode"] == "dissolve" and duration > 0:');
  emit('            vn_stage_transition(Dissolve(duration), duration)');
  emit('        elif transition["mode"] == "fade" and duration > 0:');
  emit('            vn_stage_transition(Fade(duration / 2.0, 0.0, duration / 2.0, color=transition["color"]), duration)');
  emit('        else:');
  emit('            renpy.with_statement(None)');
  emit('');
  emit('    def vn_unlock(asset_id):');
  emit('        if asset_id not in persistent.vn_unlocks:');
  emit('            persistent.vn_unlocks = persistent.vn_unlocks + [asset_id]');
  emit('            renpy.save_persistent()');
  emit('');
  emit('    vn_running_blueprint_events = set()');
  emit('    def vn_run_blueprint(blueprint_id, event_id=None, event_values=None):');
  emit('        label = str(blueprint_id) + ("__" + str(event_id) if event_id else "")');
  emit('        if label in vn_running_blueprint_events:');
  emit('            return');
  emit('        parents = list(renpy.game.contexts)');
  emit('        audio_changes = {}');
  emit('        vn_running_blueprint_events.add(label)');
  emit('        try:');
  emit('            renpy.call_in_new_context("vn_ui_blueprint_call", label, audio_changes, event_values or {}, _clear_layers=False)');
  emit('        finally:');
  emit('            vn_running_blueprint_events.discard(label)');
  emit('        for context in parents:');
  emit('            context.music = dict(context.music, **audio_changes)');
  emit('        renpy.restart_interaction()');
  if (options.development) {
    const variables = project.variables.map(variable => `${pythonLiteral(variable.id)}: ${variableReference(project, variable.id)}`).join(', ');
    emit('');
    emit('    def _vn_debug_emit():');
    emit('        import json');
    emit('        if "vn_current_node" not in globals() or "vn_current_line" not in globals():');
    emit('            return');
    emit(`        state = {"nodeId": vn_current_node, "lineId": vn_current_line, "variables": {${variables}}}`);
    emit('        message = json.dumps(state, ensure_ascii=True, sort_keys=True, separators=(",", ":"))');
    emit('        if message != getattr(_vn_debug_emit, "_last", None):');
    // Function attributes are outside Ren'Py store rollback, so restored states emit again.
    emit('            _vn_debug_emit._last = message');
    emit('            print("VNS_EVENT:" + message, flush=True)');
    emit('');
    emit('    config.interact_callbacks.append(_vn_debug_emit)');
  }
  emit('');
  // Compile reusable UE-style graphs into callable Ren'Py labels. The graph
  // editor stores typed links; the exporter follows execution pins and emits
  // the small set of side effects that are meaningful to a visual novel.
  const blueprintGraphs = projectGraphs(project) ?? [];
  // A UI callback needs a second interaction context for dialogs and waits.
  // Preserve authored audio changes when that context and its menu return.
  // Voice is excluded: Ren'Py stops dialogue voice while opening menus itself.
  emit('label vn_ui_blueprint_call(vn_ui_graph_id, vn_ui_audio_changes, vn_ui_event_values=None, vn_ui_audio_before=None):');
  emit('    $ vn_ui_audio_before = dict(renpy.game.context().music)');
  emit('    call expression "vn_blueprint_" + vn_ui_graph_id pass (**({"vn_bp_event_values": vn_ui_event_values} if vn_ui_event_values else {}))');
  emit('    $ vn_ui_audio_changes.update({key: value for key, value in renpy.game.context().music.items() if key in ("music", "sound", "ambient") and value is not vn_ui_audio_before.get(key)})');
  emit('    return');
  emit('');
  for (const line of createBlueprintRuntime(project).split('\n')) emit(line);
  for (const line of createPerformancePlaybackRuntime().split('\n')) emit(line);
  for (const line of createActorTransitionsRuntime().split('\n')) emit(line);
  const blueprintById = new Map(blueprintGraphs.map(graph => [graph.id, graph]));
  const nextBlueprint = (graph: BlueprintGraph, node: BlueprintNode, pinId?: string) => {
    const link = graph.links.find(item => item.fromNodeId === node.id && (!pinId || item.fromPinId === pinId)
      && node.pins.some(pin => pin.id === item.fromPinId && pin.direction === 'output' && pin.dataType === 'exec'));
    return link ? graph.nodes.find(item => item.id === link.toNodeId) : undefined;
  };

  // Data links are evaluated separately from execution links. Keeping this
  // resolver small and pure makes linked literals, variables, and math nodes
  // usable by executable nodes without introducing a second runtime graph.
  const blueprintDataExpression = (graph: BlueprintGraph, node: BlueprintNode, pinId: string, visited = new Set<string>()): string | undefined => {
    const incoming = graph.links.find(link => link.toNodeId === node.id && link.toPinId === pinId);
    if (!incoming) {
      const value = blueprintInputValue(node, pinId);
      return value === undefined ? undefined : pythonLiteral(value);
    }
    const source = graph.nodes.find(item => item.id === incoming.fromNodeId);
    if (!source || visited.has(`${source.id}:${incoming.fromPinId}`)) return undefined;
    const nextVisited = new Set(visited).add(`${source.id}:${incoming.fromPinId}`);
    switch (source.type) {
      case 'eventValueChanged': case 'eventTextCommitted': return `((vn_bp_event_values or {}).get(${pythonLiteral(source.id)}, {}).get(${pythonLiteral(incoming.fromPinId)}, ${pythonLiteral(source.pins.find(p=>p.id===incoming.fromPinId)?.defaultValue)}))`;
      case 'literal': return pythonLiteral(source.properties.value ?? source.properties.text ?? source.pins.find(pin => pin.id === incoming.fromPinId)?.defaultValue);
      case 'getVariable': {
        const variableId = typeof source.properties.variableId === 'string' ? source.properties.variableId : undefined;
        return variableId && project.variables.some(variable => variable.id === variableId) ? variableReference(project, variableId) : undefined;
      }
      case 'getInput': {
        const inputId = typeof source.properties.inputId === 'string' ? source.properties.inputId : undefined;
        return inputId && graph.exposedInputs.some(pin => pin.id === inputId) ? `vn_bp_in_${graph.id}_${inputId}` : undefined;
      }
      case 'callFunction':
      case 'callMacro': {
        const graphId = typeof source.properties.graphId === 'string' ? source.properties.graphId : undefined;
        const calledGraph = graphId ? blueprintById.get(graphId) : undefined;
        const outputId = incoming.fromPinId.startsWith('out_') ? incoming.fromPinId.slice(4) : undefined;
        return calledGraph && outputId && calledGraph.exposedOutputs.some(pin => pin.id === outputId)
          ? `vn_bp_result_${source.id}_${outputId}`
          : undefined;
      }
      case 'math': {
        const left = blueprintDataExpression(graph, source, 'a', nextVisited) ?? pythonLiteral(source.properties.a ?? 0);
        const right = blueprintDataExpression(graph, source, 'b', nextVisited) ?? pythonLiteral(source.properties.b ?? 0);
        const operation = String(source.properties.operation ?? source.properties.operator ?? 'add');
        if (operation === 'min' || operation === 'max') return `${operation}(${left}, ${right})`;
        const operator = ({ add: '+', '+': '+', subtract: '-', sub: '-', '-': '-', multiply: '*', mul: '*', '*': '*', divide: '/', div: '/', '/': '/', modulo: '%', mod: '%' } as Record<string, string>)[operation] ?? '+';
        return `(${left} ${operator} ${right})`;
      }
      case 'compare': {
        const left = blueprintDataExpression(graph, source, 'a', nextVisited) ?? pythonLiteral(source.properties.a);
        const right = blueprintDataExpression(graph, source, 'b', nextVisited) ?? pythonLiteral(source.properties.b);
        const operator = ({ eq: '==', ne: '!=', gt: '>', gte: '>=', lt: '<', lte: '<=' } as Record<string, string>)[String(source.properties.operator ?? 'eq')] ?? '==';
        return `(${left} ${operator} ${right})`;
      }
      case 'select': {
        const condition = blueprintDataExpression(graph, source, 'condition', nextVisited) ?? pythonLiteral(source.properties.condition ?? false);
        const yes = blueprintDataExpression(graph, source, 'true_value', nextVisited) ?? pythonLiteral(source.properties.true_value);
        const no = blueprintDataExpression(graph, source, 'false_value', nextVisited) ?? pythonLiteral(source.properties.false_value);
        return `(${yes} if ${condition} else ${no})`;
      }
      case 'forLoop': return `vn_bp_index_${source.id}`;
      case 'random': return `renpy.random.uniform(${blueprintDataExpression(graph, source, 'min', nextVisited) ?? '0'}, ${blueprintDataExpression(graph, source, 'max', nextVisited) ?? '1'})`;
      case 'formatText': return `str(${blueprintDataExpression(graph, source, 'format', nextVisited) ?? '"{value}"'}).replace("{value}", str(${blueprintDataExpression(graph, source, 'value', nextVisited) ?? '""'}))`;
      case 'showUiPage': return `vn_bp_page_result_${source.id}`;
      case 'getUiProperty': return `vn_ui_get(${blueprintDataExpression(graph, source, 'componentId', nextVisited) ?? 'None'}, ${pythonLiteral(source.properties.property ?? 'visible')})`;
      case 'getPlayerPreference': return `vn_preference_get(${pythonLiteral(source.properties.preference)}, ${blueprintDataExpression(graph, source, 'characterId', nextVisited) ?? 'None'})`;
      case 'getMinigameValue': return `vn_minigame_get(${pythonLiteral(source.properties.key ?? 'value')}, ${pythonLiteral(source.properties.defaultValue)})`;
      default: return undefined;
    }
  };

  const emitBlueprintNode = (graph: BlueprintGraph, node: BlueprintNode, visited: Set<string>, indent = '    ') => {
    if (visited.has(node.id)) { emit(`${indent}# 蓝图循环路径在此停止。`, { nodeId: node.id }); return; }
    visited.add(node.id);
    const origin = { nodeId: node.id };
    const nextExec = (pinId?: string) => nextBlueprint(graph, node, pinId);
    const layer = typeof node.properties.__timelineLayerOffset === 'number' ? `vn_bp_layer_base_${graph.id} + ${node.properties.__timelineLayerOffset}` : undefined;
    const value = (pinId: string, fallback?: VariableValue) => pinId === 'layer' && layer ? layer : blueprintDataExpression(graph, node, pinId) ?? pythonLiteral(fallback);
    const write = (text: string) => emit(`${indent}${text}`, origin);
    if (['playMusic', 'playSound', 'stopMusic', 'uiAction', 'showUiPage', 'closeUiPage', 'setUiProperty', 'animateUiProperty', 'playUiAnimation', 'showChapter', 'camera', 'shake'].includes(node.type)) write('$ vn_actor_flush()');
    const appearance = (nested = '') => {
      const modern = ['showCharacter', 'hideCharacter'].includes(node.type);
      if (modern) { write(nested + 'if not vn_actor_last_modern:'); write(nested + '    pass'); }
      const appearanceWrite = (text: string) => write(nested + (modern ? '    ' : '') + text);
      const transition = String(node.properties.transition ?? 'none');
      if (transition === 'move' && ['showCharacter'].includes(node.type)) {
        appearanceWrite(`if ${value('wait', true)}:`);
        appearanceWrite('    $ vn_apply_scene_transition()');
        pause(value('duration', .5), origin, indent + nested + (modern ? '        ' : '    ')); return;
      }
      const customDuration = node.properties.duration !== undefined || graph.links.some(link => link.toNodeId === node.id && link.toPinId === 'duration');
      const duration = customDuration ? value('duration', transition === 'fade' ? 1 : .5) : String(transition === 'fade' ? 1 : .5);
      const expression = customDuration ? appearanceTransition(transition, duration) : transition;
      if (transition !== 'none') {
        appearanceWrite('if vn_pending_scene_transition is None and vn_performance_transition is None:');
        appearanceWrite(`    if ${value('wait', true)}:`); appearanceWrite(`        $ vn_stage_transition(${expression}, ${duration})`);
        appearanceWrite('    else:'); appearanceWrite(`        $ renpy.transition(${expression}, layer="master")`);
      }
    };
    let savedAction = node.type === 'savedAction' ? rawSavedBlueprintAction(node) : undefined;
    if (savedAction?.kind === 'visual') savedAction = materializeVisualCompositions(project, savedAction);
    const visualData = savedAction?.kind === 'visual' ? `vn_bp_visual_${node.id}` : undefined;
    if (savedAction?.kind === 'visual') {
      const fields = visualInputFields(savedAction);
      const paths = Object.fromEntries(fields.map(field => [field.key, field.path]));
      const values = fields.map(field => `${pythonLiteral(field.key)}: ${value('object_' + field.key, field.value)}`).join(', ');
      write(`$ ${visualData} = vn_visual_with_inputs(${pythonLiteral({ ...savedAction, fontAssetId: savedAction.fontAssetId ?? project.ui.fontAssetId })}, ${pythonLiteral(paths)}, {${values}})`);
    }
    if (graph.timeline?.tailNodeId && node.id !== graph.timeline.tailNodeId) {
      const appearance = ['showBackground', 'showCharacter', 'hideCharacter'].includes(node.type);
      const saved = node.type === 'savedAction' ? savedBlueprintAction(node) : undefined;
      const seconds = appearance ? node.properties.transition === 'none' ? '0' : value('duration', node.properties.transition === 'fade' ? 1 : .5)
        : node.type === 'showChapter' ? value('duration', 4.2) : node.type === 'camera' ? value('duration', .5) : node.type === 'shake' ? value('duration', .6)
        : ['playMusic', 'stopMusic'].includes(node.type) ? value('fade', .3)
        : saved?.kind === 'audioClip' ? `vn_audio_clip_inputs(${pythonLiteral(saved)}, {${audioClipFields(saved).map(field => `${pythonLiteral(field.key)}: ${value('clip_' + field.key, field.value)}`).join(', ')}})["duration"]` : saved?.kind === 'show' ? String(saved.transition === 'none' ? 0 : saved.duration ?? (saved.transition === 'fade' ? 1 : .5)) : saved?.kind === 'visual' ? `${visualData}["duration"]` : saved?.kind === 'animate' ? String(actorAnimationDuration(saved)) : saved?.kind === 'camera' ? String(cameraAnimationDuration(saved)) : undefined;
      if (seconds) write(`$ vn_bp_timeline_end_${graph.id} = max(vn_bp_timeline_end_${graph.id}, vn_bp_clock() + max(0.0, float(${seconds})) + ${saved?.kind === 'show' ? afterOffsetDuration(saved.afterOffsets) : ['showCharacter'].includes(node.type) ? afterOffsetDuration(nodeAfterOffsets(node)) : 0})`);
    }
    if (node.type === 'delay') {
      const seconds = blueprintDataExpression(graph, node, 'seconds') ?? pythonLiteral(node.properties.seconds ?? 0);
      if (node.id === graph.timeline?.tailNodeId) {
        // A timed pause resumes immediately after loading. Recheck the saved
        // deadline, while retaining ordinary click-to-dismiss and skipping.
        write(`while not vn_bp_launch_${graph.id} and not renpy.is_skipping() and vn_bp_clock() < vn_bp_timeline_end_${graph.id}:`);
        write(`    $ vn_bp_dismissed_${graph.id} = vn_performance_pause(max(0.0, vn_bp_timeline_end_${graph.id} - vn_bp_clock()))`);
        write(`    if vn_bp_dismissed_${graph.id}:`);
        write(`        $ vn_bp_timeline_end_${graph.id} = vn_bp_clock()`);
      } else if (graph.timeline?.tailNodeId) {
        const deadline=`vn_bp_gap_${node.id}`;
        write(`$ ${deadline} = vn_bp_clock() + vn_bp_number(${seconds}, 0, None, "等待秒数")`);
        write(`while not renpy.is_skipping() and vn_bp_clock() < ${deadline}:`);
        write(`    $ vn_bp_gap_dismissed_${node.id} = vn_performance_pause(max(0.0, ${deadline} - vn_bp_clock()))`);
        write(`    if vn_bp_gap_dismissed_${node.id}:`);
        write(`        $ ${deadline} = vn_bp_clock()`);
      } else pause(seconds, origin, indent);
    }
    else if (node.type === 'setVariable') {
      const variableId = typeof node.properties.variableId === 'string' ? node.properties.variableId : undefined;
      const variable = variableId ? project.variables.find(item => item.id === variableId) : undefined;
      if (variable) {
        const value = blueprintDataExpression(graph, node, 'value') ?? pythonLiteral(node.properties.value ?? variable.initial);
        emit(`${indent}$ ${variableReference(project, variable.id)} = ${value}`, origin);
        if (variable.persistent) { write('$ renpy.retain_after_load()'); write('$ renpy.save_persistent()'); }
      }
    } else if (node.type === 'showBackground') {
      write(`$ vn_bp_background(${value('assetId')})`);
      appearance();
    } else if (node.type === 'showCharacter') {
      const character = node.type === 'showCharacter' ? `(${value('characterId', '')} or vn_current_speaker)` : 'vn_current_speaker';
      write(`if vn_bp_show_speaker(${value('expressionId', '')}, ${value('x', 0.5)}, ${value('y', 1)}, ${value('scale', 1)}, ${value('layer', 10)}, ${value('hideOthers', false)}, ${value('useDefaultFraming', false)}, ${value('presetId', '')}, ${value('instanceId', '')}, ${value('lifetime', '')}${node.properties.transition === 'move' ? ', move_duration=' + value('duration', .5) + (nodeMoveOffsets(node) ? ', move_offsets=' + pythonLiteral(nodeMoveOffsets(node)) : '') : (nodeMoveOffsets(node) || nodeAfterOffsets(node)) ? ', offset_duration=' + (node.properties.transition === 'none' ? '0' : value('duration', node.properties.transition === 'fade' ? 1 : .5)) + ', move_offsets=' + pythonLiteral(nodeMoveOffsets(node) ?? {}) : ''}${nodeAfterOffsets(node) ? ', after_offsets=' + pythonLiteral(nodeAfterOffsets(node)) : ''}, transitions=${pythonLiteral(node.properties.actorTransitions ?? "")}, wait=${value("wait", true)}, transition_mode=${pythonLiteral(node.properties.transition ?? "none")}, transition_duration=${value("duration", node.properties.transition === "fade" ? 1 : .5)}, character_id=${node.type === 'showCharacter' ? value('characterId', '') : 'None'}):`);
      write(`    if vn_bp_character_label(${character}):`);
      write(`        call expression vn_bp_character_label(${character}) from ${callSite(`vn_bp_speaker_${node.id}`)}`);
      appearance('    ');
    } else if (node.type === 'startDialogue') {
      flushTransition(origin); write('$ vn_start_dialogue()');
    } else if (node.type === 'showChapter') {
      write(`if ${value('soundId', '')}:`);
      write(`    $ renpy.music.play(vn_bp_asset(${value('soundId')}, "audio"), channel="sound", loop=False)`);
      const chapterArgs = `title=${value('title', '第一章')}, subtitle=${value('subtitle', '')}, duration=vn_bp_number(${value('duration', 4.2)}, 0, None, "章节时长"), effect=(${value('effect', '')} or None), background=vn_bp_optional_asset(${value('backgroundId', '')}, "image"), title_image=vn_bp_optional_asset(${value('titleImageId', '')}, "image")`;
      write(`$ vn_performance_extend(${value('duration', 4.2)})`);
      write('if not renpy.is_skipping() and not (vn_performance_active and vn_performance_skipped):');
      write(`    if ${value('wait', true)} and not vn_performance_active and not vn_performance_transition:`); write(`        call screen vn_chapter_title(${chapterArgs})`);
      write('    else:'); write(`        $ renpy.show_screen("vn_chapter_title", ${chapterArgs}, _vn_wait=False, _vn_layer="master", _layer="master", _zorder=${layer ?? 80})`);
      flushTransition(origin, indent + '        ');
      write(`        if ${value('wait', true)}:`); write(`            $ vn_performance_pause(${value('duration', 4.2)})`); write('            hide screen vn_chapter_title onlayer master');
    } else if (node.type === 'camera') {
      write(`camera master at vn_blueprint_camera(${value('x', 0)}, ${value('y', 0)}, ${value('zoom', 1)}, ${value('rotation', 0)}, ${value('duration', 0.5)}, ${value('easing', 'ease')})`);
      write(`$ vn_performance_extend(${value('duration', .5)})`);
      write(`if ${value('wait', true)}:`); pause(value('duration', .5), origin, indent + '    ');
    } else if (node.type === 'shake') {
      flushTransition(origin, indent); write(`show layer master at vn_blueprint_shake(${value('direction', 'vertical')}, ${value('duration', 0.6)}, ${value('amplitude', 20)})`);
      write(`$ vn_performance_extend(${value('duration', .6)})`);
      write(`if ${value('wait', true)}:`); pause(value('duration', .6), origin, indent + '    ');
    } else if (node.type === 'savedAction') {
      const action = savedAction;
      if (action?.kind === 'visual') {
        write(`$ vn_visual_wait = vn_show_visual(${layer ? `dict(${visualData}, layer=${layer})` : visualData})`);
        if (action.wait || action.transitionWait) { write('if vn_visual_wait:'); flushTransition(origin, indent + '    '); pause('vn_visual_wait', origin, indent + '    '); }
      } else if (action?.kind === 'audioClip') {
        const data = `vn_audio_clip_inputs(${pythonLiteral(action)}, {${audioClipFields(action).map(field => `${pythonLiteral(field.key)}: ${value('clip_' + field.key, field.value)}`).join(', ')}})`;
        write(`$ vn_audio_clip_play(${data})`);
        write(`$ vn_performance_extend(${data}["duration"])`);
        if (action.wait) pause(`(${data}["duration"])`, origin, indent);
      } else if (action) stage(action, origin, indent, layer);
    } else if (node.type === 'hideCharacter') {
      write(`$ vn_bp_hide(${value('characterId')}, ${value('instanceId', '')}, {"mode": ${pythonLiteral(node.properties.transition ?? 'none')}, "duration": ${value('duration', node.properties.transition === 'fade' ? 1 : .5)}}, ${value('wait', true)})`);
      appearance();
    } else if (node.type === 'playMusic') {
      write(`$ renpy.music.play(vn_bp_asset(${value('assetId')}, "audio"), channel="music", loop=${value('loop', true)}, fadein=vn_bp_number(${value('fade', 0.3)}, 0, None, "音乐淡入秒数"))`);
    } else if (node.type === 'playSound') {
      write(`if ${value('assetId')}:`);
      write(`    $ renpy.music.play(vn_bp_asset(${value('assetId')}, "audio"), channel=${pythonLiteral(node.properties.channel ?? 'sound')}, loop=${value('loop', false)})`);
    } else if (node.type === 'stopMusic') {
      write(`$ renpy.music.stop(channel=${pythonLiteral(node.properties.channel ?? 'music')}, fadeout=vn_bp_number(${value('fade', 0.3)}, 0, None, "声音淡出秒数"))`);
    } else if (node.type === 'switchScene') {
      write('if vn_pending_scene_transition is None:');
      write('    with None');
      write(`$ vn_pending_scene_transition = {"mode": ${pythonLiteral(node.properties.mode ?? 'none')}, "duration": vn_bp_number(${value('duration', 0.5)}, 0, None, "转场秒数"), "color": ${pythonLiteral(node.properties.color ?? '#000000')}, "toSceneId": ${value('sceneId')}}`);
      write('$ vn_current_scene = None');
      write('$ renpy.set_return_stack([])');
      write(`jump expression vn_bp_scene_label(${value('sceneId')})`);
      return;
    } else if (node.type === 'sceneAction') {
      const command = typeof node.properties.command === 'string' ? textCommandAction(project, node.properties.command) : undefined;
      if (command) stage(command, origin, indent);
    } else if (node.type === 'uiAction') {
      write(`call expression vn_bp_menu_label(${value('screen', 'pause_menu')}) from ${callSite(`vn_bp_menu_call_${node.id}`)}`);
    } else if (node.type === 'showUiPage') {
      write(`if ${value('wait', true)}:`);
      write(`    call expression vn_bp_menu_label(${value('pageId')}) from ${callSite(`vn_bp_page_${node.id}`)}`);
      write(`    $ vn_bp_page_result_${node.id} = str(_return or "")`);
      write('else:');
      write(`    $ vn_ui_open_page(${value('pageId')})`);
      write(`    $ vn_bp_page_result_${node.id} = ""`);
    } else if (node.type === 'closeUiPage') {
      write(`$ vn_ui_close_page(${value('pageId')}, ${value('result', '完成')})`);
    } else if (node.type === 'setUiProperty') {
      write(`$ vn_ui_set(${value('componentId')}, ${pythonLiteral(node.properties.property ?? 'visible')}, ${value('value')})`);
    } else if (node.type === 'animateUiProperty' || node.type === 'playUiAnimation') {
      if(node.type === 'playUiAnimation') write(`$ vn_bp_animation_${node.id} = vn_ui_play_animation(${pythonLiteral(node.properties.animationId ?? '')}, ${pythonLiteral(node.properties.playMode ?? 'forward')}, ${value('loops', 1)}, ${value('speed', 1)}, ${value('fromCurrent', false)})`);
      else
      write(`$ vn_bp_animation_${node.id} = vn_ui_animate(${value('componentId')}, ${pythonLiteral(node.properties.property ?? 'opacity')}, ${value('value', 0)}, ${value('duration', .3)}, ${pythonLiteral(node.properties.easing ?? 'ease')})`);
      write(`if ${value('wait', true)}:`);
      write(`    while vn_ui_animation_active(vn_bp_animation_${node.id}):`);
      write(`        if renpy.is_skipping():`);
      write(`            $ vn_ui_finish_animation(vn_bp_animation_${node.id})`);
      write(`        else:`);
      write(`            $ renpy.pause(0.016, hard=True)`);
      write(`            $ vn_ui_animation_tick()`);
    } else if (node.type === 'stopUiAnimationPlayback') {
      write(`$ vn_ui_stop_playback(${pythonLiteral(node.properties.animationId ?? '')}, ${value('finish', false)})`);
    } else if (node.type === 'stopUiAnimation') {
      write(`$ vn_ui_stop_animation(${value('componentId')}, ${pythonLiteral(node.properties.property ?? 'all')}, ${value('finish', false)})`);
    } else if (node.type === 'setPlayerPreference') {
      write(`$ vn_preference_set(${pythonLiteral(node.properties.preference)}, ${value('value')}, ${value('characterId')})`);
    } else if (node.type === 'setMinigameValue') {
      write(`$ vn_minigame_set(${pythonLiteral(node.properties.key ?? 'value')}, ${value('value')})`);
    } else if (node.type === 'finishMinigame') {
      write(`$ vn_finish_minigame(${pythonLiteral(node.properties.result ?? 'success')})`);
      write('return');
      return;
    } else if (node.type === 'confirmMessage') {
      write(`call vn_confirm_prompt(vn_ui_literal(${value('message', '确认继续吗？')}).replace("[", "[[")) from ${callSite(`vn_bp_confirm_${node.id}`)}`);
      write('if _return:');
      const yes = nextExec('yes'); if (yes) emitBlueprintNode(graph, yes, new Set(visited), `${indent}    `);
      write('    pass');
      write('else:');
      const no = nextExec('no'); if (no) emitBlueprintNode(graph, no, new Set(visited), `${indent}    `);
      write('    pass');
      return;
    } else if (node.type === 'resetUiComponent') {
      write(`$ vn_ui_reset(${value('componentId')})`);
    } else if (node.type === 'playSpine') {
      write(`$ vns_spine.play(${value('componentId')}, ${value('animation', '')}, ${value('loop', true)}, ${value('restart', true)})`);
    } else if (node.type === 'pauseSpine') {
      write(`$ vns_spine.pause(${value('componentId')}, ${value('paused', true)})`);
    } else if (node.type === 'setSpineSpeed') {
      write(`$ vns_spine.speed(${value('componentId')}, ${value('speed', 1)})`);
    } else if (node.type === 'effect') {
      const effectId = typeof node.properties.effectId === 'string' ? node.properties.effectId : undefined;
      if (effectId) stage({ kind: 'effect', effectId }, origin, indent);
    } else if (node.type === 'callFunction' || node.type === 'callMacro') {
      const graphId = typeof node.properties.graphId === 'string' ? node.properties.graphId : undefined;
      const calledGraph = graphId ? blueprintById.get(graphId) : undefined;
      if (calledGraph) {
        const args = calledGraph.exposedInputs.map((pin, index) => {
          const argument = blueprintDataExpression(graph, node, `arg_${pin.id}`) ?? blueprintDataExpression(graph, node, `arg_${index}`) ?? pythonLiteral(node.properties[`arg_${pin.id}`] ?? node.properties[`arg_${index}`] ?? pin.defaultValue);
          return argument;
        });
        const launch = node.properties.wait === false && canLaunchTimeline(project, calledGraph);
        if (layer && calledGraph.timeline) args.push(`vn_bp_layer_base_${calledGraph.id}=${layer}`);
        if (launch) args.push(`vn_bp_launch_${calledGraph.id}=True`);
        const suffix = args.length ? `(${args.join(', ')})` : '';
        if (node.properties.actorTransitions) write(`$ vn_actor_transition_overrides.append(${pythonLiteral(node.properties.actorTransitions)})`);
        emit(`${indent}call vn_blueprint_${graphId}${suffix} from ${callSite(`vn_blueprint_nested_${node.id}`)}`, origin);
        if (node.properties.actorTransitions) write('$ vn_actor_transition_overrides.pop()');
        if (launch && graph.timeline?.tailNodeId) write(`$ vn_bp_timeline_end_${graph.id} = max(vn_bp_timeline_end_${graph.id}, float(_return))`);
        for (const pin of calledGraph.exposedOutputs) write(`$ vn_bp_result_${node.id}_${pin.id} = vn_bp_out_${calledGraph.id}_${pin.id}`);
      }
    } else if (node.type === 'setOutput') {
      const outputId = typeof node.properties.outputId === 'string' ? node.properties.outputId : undefined;
      if (outputId && graph.exposedOutputs.some(pin => pin.id === outputId)) {
        const value = blueprintDataExpression(graph, node, 'value') ?? pythonLiteral(node.properties.value);
        emit(`${indent}$ vn_bp_out_${graph.id}_${outputId} = ${value}`, origin);
      }
    } else if (node.type === 'branch') {
      const variableId = typeof node.properties.variableId === 'string' ? node.properties.variableId : undefined;
      const variable = variableId ? project.variables.find(item => item.id === variableId) : undefined;
      const linkedCondition = blueprintDataExpression(graph, node, 'condition');
      const test = linkedCondition ?? (variable ? `${variableReference(project, variable.id)} == ${pythonLiteral(node.properties.value ?? variable.initial)}` : pythonLiteral(node.properties.condition ?? true));
      emit(`${indent}if ${test}:`, origin);
      const yes = nextExec('true'); if (yes) emitBlueprintNode(graph, yes, new Set(visited), `${indent}    `);
      emit(`${indent}    pass`, origin);
      emit(`${indent}else:`, origin);
      const no = nextExec('false'); if (no) emitBlueprintNode(graph, no, new Set(visited), `${indent}    `);
      emit(`${indent}    pass`, origin);
      return;
    } else if (node.type === 'return') { emit(`${indent}return`, origin); return; }
    else if (node.type === 'forLoop') {
      const indexVariable = `vn_bp_index_${node.id}`;
      const firstExpression = blueprintDataExpression(graph, node, 'first_index') ?? blueprintDataExpression(graph, node, 'firstIndex') ?? pythonLiteral(node.properties.firstIndex ?? 0);
      const lastExpression = blueprintDataExpression(graph, node, 'last_index') ?? blueprintDataExpression(graph, node, 'lastIndex') ?? pythonLiteral(node.properties.lastIndex ?? 0);
      emit(`${indent}$ ${indexVariable} = int(vn_bp_number(${firstExpression}, None, None, "循环起始数"))`, origin);
      emit(`${indent}$ vn_bp_last_${node.id} = int(vn_bp_number(${lastExpression}, None, None, "循环结束数"))`, origin);
      emit(`${indent}if vn_bp_last_${node.id} - ${indexVariable} >= 100000:`, origin);
      emit(`${indent}    $ renpy.error("单次计数循环最多执行 100000 次；持续玩法请使用定时事件。")`, origin);
      emit(`${indent}while ${indexVariable} <= vn_bp_last_${node.id}:`, origin);
      const body = nextExec('loop_body') ?? nextExec('loopBody');
      if (body) emitBlueprintNode(graph, body, new Set(visited), `${indent}    `);
      emit(`${indent}    $ ${indexVariable} += 1`, origin);
      const completed = nextExec('completed');
      if (completed) emitBlueprintNode(graph, completed, new Set(visited), indent);
      return;
    }
    if (node.type === 'sequence') {
      for (const pinId of node.pins.filter(pin => pin.direction === 'output' && pin.dataType === 'exec').map(pin => pin.id)) {
        const next = nextExec(pinId);
        if (next) emitBlueprintNode(graph, next, new Set(visited), indent);
      }
      return;
    }
    const next = nextExec();
    if (next) emitBlueprintNode(graph, next, visited, indent);
  };
  for (const graph of blueprintGraphs) {
    // Label parameters keep wait tokens local when another UI callback calls the same graph.
    const inputParameters = [...graph.exposedInputs.map(pin => `vn_bp_in_${graph.id}_${pin.id}=${pythonLiteral(pin.defaultValue)}`), ...(graph.timeline ? [`vn_bp_layer_base_${graph.id}=10`] : []), ...(graph.timeline?.tailNodeId ? [`vn_bp_timeline_end_${graph.id}=0.0`, `vn_bp_launch_${graph.id}=False`] : []), ...graph.nodes.filter(node => ['animateUiProperty','playUiAnimation'].includes(node.type)).map(node => `vn_bp_animation_${node.id}=None`), ...(graph.nodes.some(n=>['eventValueChanged','eventTextCommitted'].includes(n.type))?['vn_bp_event_values=None']:[])].join(', ');
    const roots = [graph.nodes.find(node => node.type === 'event'), ...graph.nodes.filter(node => ['eventClick', 'eventButton', 'eventValueChanged', 'eventTextCommitted', 'eventKey', 'eventTimer'].includes(node.type))];
    for (const event of roots) {
    emit(`label vn_blueprint_${graph.id}${event && event.type !== 'event' ? `__${event.id}` : ''}${inputParameters ? `(${inputParameters})` : ''}:`);
    if (graph.timeline?.tailNodeId) emit(`    $ vn_bp_timeline_end_${graph.id} = vn_bp_clock()`);
    for (const pin of graph.exposedOutputs) emit(`    $ vn_bp_out_${graph.id}_${pin.id} = ${pythonLiteral(pin.defaultValue)}`);
    for (const node of graph.nodes) {
      if (node.type === 'showUiPage') emit(`    $ vn_bp_page_result_${node.id} = ""`);
      if (node.type === 'callFunction' || node.type === 'callMacro') {
        const called = blueprintById.get(String(node.properties.graphId));
        for (const pin of called?.exposedOutputs ?? []) emit(`    $ vn_bp_result_${node.id}_${pin.id} = ${pythonLiteral(pin.defaultValue)}`);
      }
    }
    if (event) emitBlueprintNode(graph, event, new Set());
    emit(graph.timeline?.tailNodeId ? `    return vn_bp_timeline_end_${graph.id}` : '    return');
    emit('');
    }
  }
  // Load resumes the saved statement; ordinary player rollback remains greedy.
  emit('default _greedy_rollback = False');
  emit('label start:');
  emit('    stop music fadeout 0');
  emit('    $ vn_performance_reset()');
  emit('    $ vn_actor_reset_transitions()');
  for (const [id, value] of Object.entries(options.preview?.variables ?? {})) emit(`    $ ${variableReference(project, id)} = ${pythonLiteral(value)}`);
  emit(`    jump ${nodeLabel(options.preview?.entryId ?? project.entryId)}`);
  emit('');

  for (const node of project.nodes) {
    const origin = { nodeId: node.id };
    emit(`label ${nodeLabel(node.id)}:`, origin);
    emit(`    $ vn_current_node = ${pythonLiteral(node.id)}`, origin);
    emit(`    $ vn_mark_story_visit(${pythonLiteral(node.id)})`, origin);
    emit('    $ vn_current_line = None', origin);
    emit('    $ vn_current_speaker = None', origin);
    const scene = effectiveScene(project, node.sceneId)!;
    emit(`    if vn_current_scene != ${pythonLiteral(scene.id)}:`, origin);
    emit(`        $ vn_current_scene = ${pythonLiteral(scene.id)}`, origin);
    emit(`        $ vn_scene_parameters = dict(${pythonLiteral(scene.parameters ?? {})}, **((vn_pending_scene_transition or {}).get("parameters") or {}))`, origin);
    for (const action of scene.entryActions ?? []) stage(action, origin, '        ');
    if (scene.blueprintId) stage({ kind: 'blueprint', blueprintId: scene.blueprintId }, origin, '        ');
    switch (node.kind) {
      case 'start': go(node.next, origin); break;
      case 'passage': {
        if (!node.lines.length) { go(node.next, origin); break; }
        emit(`    jump ${lineLabel(node.id, node.lines[0].id)}`, origin);
        node.lines.forEach((line, index) => {
          const lineOrigin = { nodeId: node.id, lineId: line.id };
          emit('', lineOrigin);
          emit(`label ${lineLabel(node.id, line.id)}:`, lineOrigin);
          emit(`    $ vn_current_line = ${pythonLiteral(line.id)}`, lineOrigin);
          emit(`    $ vn_current_speaker = ${pythonLiteral(line.speakerId)}`, lineOrigin);
          if (line.silent) {
            emit(`    $ vn_performance_begin(${pythonLiteral(performancePlayback(project, line))})`, lineOrigin);
          }
          const voiceAsset = project.assets.find(a => a.id === line.voiceId && a.kind === 'audio');
          const voiceLog = voiceAsset ? { id: voiceVisitKey(node.id, line.id), assetId: voiceAsset.id, filename: voiceAsset.path.replaceAll('\\', '/'), speakerId: line.speakerId ?? '' } : null;
          emit(`    $ vn_line_dialogue = ${pythonLiteral(line.silent ? null : { speaker: line.speakerId ?? '', text: line.text.replaceAll('[', '[[').replaceAll('{', '{{'), voice: line.voiceId ?? '', voiceLog })}`, lineOrigin);
          line.actions.forEach(action => stage(action, lineOrigin));
          flushTransition(lineOrigin);
          if (line.voiceId) {
            emit('    if not vn_line_dialogue or vn_line_dialogue.get("started") is None:', lineOrigin);
            emit(`        $ vn_unlock(${pythonLiteral(line.voiceId)})`, lineOrigin);
            emit(`        voice ${assetPath(line.voiceId)}`, lineOrigin);
          }
          if (!line.silent) {
            emit(`    $ vn_current_voice_log = ${pythonLiteral(voiceLog)}`, lineOrigin);
            emit(`    ${line.speakerId ? `vn_character_${line.speakerId} ` : ''}${renpyText(line.text)} id vn_say_${node.id}_${line.id}`, lineOrigin);
            emit('    $ vn_keep_dialogue()', lineOrigin);
            emit('    $ vn_current_voice_log = None', lineOrigin);
            emit('    $ vn_line_dialogue = None', lineOrigin);
            emit('    $ vn_finish_line_actors()', lineOrigin);
            emit('    $ vn_finish_line_visuals()', lineOrigin);
          } else {
            const settings = performancePlayback(project, line);
            emit('    $ vn_performance_pause(max(0.0, vn_performance_until - vn_bp_clock()))', lineOrigin);
            emit(`    $ vn_performance_finish(${pythonLiteral(settings)})`, lineOrigin);
            if (settings.onComplete === 'title') emit('    jump vn_end_return', lineOrigin);
          }
          const following = node.lines[index + 1];
          if (following) emit(`    jump ${lineLabel(node.id, following.id)}`, lineOrigin);
          else go(node.next, lineOrigin);
        });
        break;
      }
      case 'choice':
        flushTransition(origin);
        emit('    menu:', origin);
        if (node.prompt) emit(`        ${renpyText(node.prompt)}`, origin);
        for (const choice of node.choices) {
          emit(`        ${renpyText(choice.text)}${choice.condition ? ` if ${conditionExpression(project, choice.condition)}` : ''}:`, origin);
          go(choice.target, origin, '            ');
        }
        go(undefined, origin);
        break;
      case 'condition':
        emit(`    if ${conditionExpression(project, node.condition)}:`, origin);
        go(node.yes, origin, '        ');
        emit('    else:', origin);
        go(node.no, origin, '        ');
        break;
      case 'set':
        if (node.when) emit(`    if ${conditionExpression(project, node.when)}:`, origin);
        emit(`${node.when ? '        ' : '    '}$ ${variableReference(project, node.variableId)} ${node.operation === 'add' ? '+=' : '='} ${pythonLiteral(node.value)}`, origin);
        // Persistent writes must survive loading without being executed a second time.
        if (project.variables.find(variable => variable.id === node.variableId)?.persistent) {
          emit(`${node.when ? '        ' : '    '}$ renpy.retain_after_load()`, origin);
          emit(`${node.when ? '        ' : '    '}$ renpy.save_persistent()`, origin);
        }
        go(node.next, origin);
        break;
      case 'chapterTitle':
        flushTransition(origin);
        if (node.soundId) emit(`    $ renpy.music.play(${assetPath(node.soundId)}, channel="sound", loop=False)`, origin);
        emit('    if not renpy.is_skipping():', origin);
        emit(`        call screen vn_chapter_title(title=${renpyText(node.title)}, subtitle=${renpyText(node.subtitle)}, duration=${node.duration}, effect=${pythonLiteral(node.effect)}, background=${node.backgroundId ? assetPath(node.backgroundId) : 'None'}, title_image=${node.titleImageId ? assetPath(node.titleImageId) : 'None'})`, origin);
        go(node.next, origin);
        break;
      case 'jump':
        if (node.sceneTransition) {
          emit('    if vn_pending_scene_transition is None:', origin);
          emit('        with None', origin);
          emit(`    $ vn_pending_scene_transition = ${pythonLiteral(node.sceneTransition)}`, origin);
          emit('    $ vn_current_scene = None', origin);
        }
        go(node.target, origin);
        break;
      case 'call':
        emit(`    call ${nodeLabel(node.target!)} from vn_return_${node.id}`, origin);
        go(node.next, origin);
        break;
      case 'return': emit('    return', origin); break;
      case 'end':
        emit('    jump vn_end_return', origin);
        break;
      case 'interaction': {
        flushTransition(origin);
        const hotspotData = node.hotspots.map(hotspot => {
          const data = pythonLiteral({ id: hotspot.id, name: hotspot.name.replaceAll('{', '{{'), x: hotspot.x, y: hotspot.y, width: hotspot.width, height: hotspot.height });
          const guards = [hotspot.condition ? conditionExpression(project, hotspot.condition) : '', hotspot.characterId ? `vn_character_showing(${pythonLiteral(hotspot.characterId)})` : ''].filter(Boolean);
          return guards.length ? `(${data} if ${guards.join(' and ')} else None)` : data;
        }).join(', ');
        emit('    $ vn_interaction_result = None', origin);
        emit(`    $ vn_interaction_remaining = ${node.timeoutSeconds}`, origin);
        // A loaded call screen restarts its statement; retain changes made inside it.
        emit('    $ renpy.retain_after_load()', origin);
        emit(`    call screen vn_interaction(prompt=${renpyText(node.prompt)}, hotspots=[item for item in [${hotspotData}] if item is not None], timeout_seconds=${node.timeoutSeconds}, show_hints=${node.showHints ? 'True' : 'False'})`, origin);
        emit('    $ vn_interaction_result = _return', origin);
        for (const hotspot of node.hotspots) {
          emit(`    if vn_interaction_result == ${pythonLiteral(hotspot.id)}:`, origin);
          go(hotspot.target, origin, '        ');
        }
        if (node.timeout) {
          emit(`    if vn_interaction_result == "timeout":`, origin);
          go(node.timeout, origin, '        ');
        }
        if (node.cancel) {
          emit(`    if vn_interaction_result == "cancel":`, origin);
          go(node.cancel, origin, '        ');
        }
        go(undefined, origin);
        break;
      }
      case 'minigame': {
        flushTransition(origin);
        const screen = node.template === 'password' ? 'vn_minigame_password' : node.template === 'custom' ? 'vn_minigame_custom' : 'vn_minigame_timed_clicks';
        emit('    $ vn_minigame_result = None', origin);
        emit('    $ vn_minigame_answer = ""', origin);
        emit(`    $ vn_minigame_remaining = ${node.attempts}`, origin);
        emit('    $ vn_minigame_clicks = 0', origin);
        emit(`    $ vn_minigame_time_left = ${node.timeLimit}`, origin);
        const args = node.template === 'password'
          ? `title=${renpyText(node.title)}, prompt=${renpyText(node.prompt)}, password=${pythonLiteral(node.password)}, case_sensitive=${node.caseSensitive ? 'True' : 'False'}`
          : node.template === 'custom'
            ? `minigame_id=${pythonLiteral(node.minigameId ?? '')}, title=${renpyText(node.title)}, prompt=${renpyText(node.prompt)}`
            : `title=${renpyText(node.title)}, prompt=${renpyText(node.prompt)}, target_clicks=${node.targetClicks}`;
        emit('    $ renpy.retain_after_load()', origin);
        if (node.template === 'custom') {
          const definition = project.minigames?.find(item => item.id === node.minigameId);
          emit(`    $ vn_minigame_definition_current = vn_minigame_begin(${pythonLiteral(node.id)}, ${pythonLiteral(node.minigameId ?? '')}, ${renpyText(node.title)}, ${renpyText(node.prompt)})`, origin);
          emit('    if vn_minigame_should_start():', origin);
          if (definition?.mode === 'blueprint' && definition.blueprintId) {
            emit(`        call vn_blueprint_${definition.blueprintId} from ${callSite(`vn_minigame_blueprint_${node.id}`)}`, origin);
          } else if (definition?.mode === 'script' && definition.script) {
            emit(`        call expression ${pythonLiteral(definition.script.entry)} pass (**${pythonLiteral(definition.script.args)}) from ${callSite(`vn_minigame_script_${node.id}`)}`, origin);
            emit('        if _return in ("success", "failure", "cancel"):', origin);
            emit('            $ vn_finish_minigame(_return)', origin);
          } else emit('        pass', origin);
          emit('    if vn_minigame_finished is None:', origin);
          emit(`        call screen ${screen}(${args})`, origin);
          emit('        $ vn_minigame_result = vn_minigame_result_value(_return)', origin);
          emit('    else:', origin);
          emit('        $ vn_minigame_result = vn_minigame_result_value()', origin);
          emit('    $ vn_minigame_close()', origin);
        } else {
          emit(`    call screen ${screen}(${args})`, origin);
          emit('    $ vn_minigame_result = _return', origin);
        }
        for (const [port, target] of [['success', node.success], ['failure', node.failure], ['cancel', node.cancel] as const]) {
          if (!target) continue;
          emit(`    if vn_minigame_result == ${pythonLiteral(port)}:`, origin);
          go(target, origin, '        ');
        }
        go(undefined, origin);
        break;
      }
    }
    emit('');
  }
  emit('label vn_finish:');
  emit('    jump vn_end_return');
  emit('label vn_end_return:');
  emit('    $ vn_performance_reset()');
  emit('    $ vn_actor_reset_transitions()');
  emit('    $ renpy.set_return_stack([])');
  emit('    return');
  emit('');

  result.files['game/story.rpy'] = statements.join('\n');
  const theme = effectiveUiTheme(project.ui);
  const menuMusic = project.assets.find(asset => asset.id === theme.menuMusicId && asset.kind === 'audio');
  result.files['game/options.rpy'] = [
    '# Generated project settings.',
    'init -2 python:',
    `    gui.init(${project.width}, ${project.height})`,
    `define config.name = ${pythonLiteral(project.name)}`,
    `define config.version = ${pythonLiteral(project.version)}`,
    `define build.name = ${pythonLiteral(exportSettings(project).platform === 'windows' ? exportSettings(project).fileName : project.id)}`,
    'define build.include_i686 = False',
    ...(project.assets.some(a => a.kind === 'script') ? [] : ['define build.include_old_themes = False']),
    ...(project.exportSettings?.iconAssetId ? [`define config.window_icon = ${pythonLiteral('gui/studio-window-icon.png')}`] : []),
    `define config.developer = ${options.development ? 'True' : 'False'}`,
    `define config.save_directory = ${pythonLiteral(`vns_${project.id}${options.preview ? '_preview' : ''}`)}`,
    'define config.default_language = "schinese"',
    'define config.history_length = 250',
    'define config.rollback_enabled = True',
    'define config.allow_skipping = True',
    'define config.has_sound = True',
    'define config.has_music = True',
    'define config.has_voice = True',
    `define config.main_menu_music = ${pythonLiteral(menuMusic?.path.replaceAll('\\', '/'))}`,
    `define config.main_menu_music_fadein = ${theme.menuMusicFade ?? 0.3}`,
    `define _game_menu_screen = ${pythonLiteral(theme.menuShortcutPage === 'pause' ? 'pause_menu' : theme.menuShortcutPage ?? 'save')}`,
    'define config.window = "auto"',
    'define config.window_auto_hide = []',
    `define config.thumbnail_width = ${Math.min(project.width, 960)}`,
    `define config.thumbnail_height = ${Math.round(Math.min(project.width, 960) * project.height / project.width)}`,
    'init python:',
    '    config.keymap["game_menu"] = [key for key in config.keymap["game_menu"] if key != "mouseup_3"]',
    '    config.keymap["hide_windows"] = list(dict.fromkeys(config.keymap["hide_windows"] + ["mouseup_3"]))',
    '    build.classify("game/testcases.rpy", None)',
    '    build.classify("game/testcases.rpyc", None)',
    '    build.classify("tests/**", None)',
    '    build.classify("verification/", None)',
    '    build.classify("verification-report.json", None)',
    '    build.classify("source-map.json", None)',
    '    build.classify("studio-source-map.json", None)',
    '    build.classify("build-manifest.json", None)',
    '    build.classify("game/**.rpy", None)',
    '    build.classify("game/python-packages/vns_spine.dll", "windows")',
    '    build.classify("*.keystore", None)',
    '    build.classify("*.keystore.*", None)',
    '    build.classify("signing-manifest.json", None)',
    '',
  ].join('\n');
  result.files['game/screens.rpy'] = createScreens(project);
  result.files['game/00-vn-ui.rpy'] = createUiRuntime(project);
  result.files['game/00-vn-dialogue.rpy'] = earlyDialogueRuntime;
  result.files['game/00-vn-preferences.rpy'] = createPreferencesRuntime(project);
  result.files['game/00-vn-parameters.rpy'] = createParameterRuntime(project);
  result.files['game/01-vn-spine.rpy'] = createSpineRuntime(project);
  result.files['game/01-vn-chapter.rpy'] = createChapterRuntime(project);
  result.files['game/01-vn-window.rpy'] = createWindowRuntime(project);
  result.files['game/01-vn-audio-clips.rpy'] = createAudioClipRuntime();
  result.files['game/01-vn-story-menu.rpy'] = createStoryMenuRuntime(project);
  result.files['studio-source-map.json'] = JSON.stringify(result.sourceMap, null, 2) + '\n';
  return result;
}
