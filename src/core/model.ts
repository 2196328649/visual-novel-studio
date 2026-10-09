import { z } from 'zod';
import { uiHierarchyProblems, uiSubtreeIds } from './ui-hierarchy';
import { playerPreferenceKeys, playerPreferences, validPlayerPreference } from './preferences';
import { exportSettingsSchema } from './export-settings';

const id = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/);
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const value = z.union([z.string(), z.number().finite(), z.boolean()]);
export type VariableValue = z.infer<typeof value>;
export type Condition =
  | { kind: 'compare'; variableId: string; operator: 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte'; value: VariableValue }
  | { kind: 'all' | 'any'; conditions: Condition[] }
  | { kind: 'not'; condition: Condition };

export const conditionSchema: z.ZodType<Condition> = z.lazy(() => z.union([
  z.object({ kind: z.literal('compare'), variableId: id, operator: z.enum(['eq', 'ne', 'gt', 'gte', 'lt', 'lte']), value }),
  z.object({ kind: z.enum(['all', 'any']), conditions: z.array(conditionSchema) }),
  z.object({ kind: z.literal('not'), condition: conditionSchema }),
]));

const transition = z.enum(['none', 'dissolve', 'fade', 'move']).default('none');
const appearanceTiming = { duration: z.number().nonnegative().optional(), wait: z.boolean().optional() };
export const actorTransitionRuleSchema = z.object({ mode: z.enum(['none', 'dissolve', 'fade', 'move']), duration: z.number().finite().min(0).max(60) });
export const actorTransitionsSchema = z.object({ enter: actorTransitionRuleSchema.optional(), exit: actorTransitionRuleSchema.optional(), expression: actorTransitionRuleSchema.optional() });
export type ActorTransitions = z.infer<typeof actorTransitionsSchema>;
export type ActorTransitionRule = z.infer<typeof actorTransitionRuleSchema>;
export const visualTransitionsSchema = z.object({ enter: actorTransitionRuleSchema.optional(), exit: actorTransitionRuleSchema.optional(), replace: actorTransitionRuleSchema.optional() });
export type VisualTransitions = z.infer<typeof visualTransitionsSchema>;
export const sceneTransitionSchema = z.object({
  mode: z.enum(['none', 'dissolve', 'fade']).default('none'),
  duration: z.number().nonnegative().default(0.5),
  color: color.default('#000000'),
  fromSceneId: id.optional(),
  toSceneId: id.optional(),
  parameters: z.record(z.string(), value).optional(),
});
export type SceneTransition = z.infer<typeof sceneTransitionSchema>;
const easing = z.enum(['linear', 'ease', 'easein', 'easeout']);
export const keyframeSchema = z.object({
  x: z.number().finite(), y: z.number().finite(), scale: z.number().finite(),
  scaleX: z.number().finite().optional(), scaleY: z.number().finite().optional(),
  rotation: z.number().finite(), opacity: z.number().min(0).max(1),
  duration: z.number().nonnegative(), easing,
});
export type AnimationKeyframe = z.infer<typeof keyframeSchema>;
export const visualCurveKeySchema = z.object({ at: z.number().nonnegative(), value: z.number().finite(), easing: z.enum(['linear', 'ease', 'easein', 'easeout', 'outquad']) });
export const actorCurvesSchema = z.partialRecord(z.enum(['x', 'y', 'scale', 'rotation', 'opacity']), z.array(visualCurveKeySchema).min(1).max(64));
export const moveOffsetsSchema = actorCurvesSchema.refine(curves => Object.values(curves).every(frames => frames?.every(frame => frame.at <= 1)), '移动偏移关键帧需位于 0～1 的进度内');
export const cameraCurvesSchema = z.partialRecord(z.enum(['x', 'y', 'zoom', 'rotation']), z.array(visualCurveKeySchema).min(1).max(64));
export const particleLifeCurvesSchema = z.partialRecord(z.enum(['size', 'opacity', 'forceX', 'forceY', 'speed', 'red', 'green', 'blue']), z.array(visualCurveKeySchema.extend({ at: z.number().min(0).max(1) })).min(1).max(64));
export const visualObjectSchema = z.object({
  kind: z.literal('visual'), instanceId: id, name: z.string().max(120),
  content: z.enum(['image', 'text', 'particles', 'group', 'solid', 'video']), assetId: id.optional(),
  // Image clips created from the character library keep their source identity
  // for editing, while playback still treats them as ordinary visual objects.
  characterId: id.optional(), expressionId: id.optional(), text: z.string().max(10000).default(''),
  startAt: z.number().nonnegative().optional(),
  compositionId: id.optional(),
  parameters: z.array(z.object({
    id, name: z.string().min(1).max(120), dataType: z.enum(['number', 'string', 'boolean', 'asset']),
    defaultValue: value,
    targets: z.array(z.object({ instanceId: id, path: z.array(z.union([z.string(), z.number().int().nonnegative()])).min(1).max(12) })).min(1).max(128),
  })).max(128).optional(),
  parameterValues: z.record(id, value).optional(),
  get children(): z.ZodOptional<z.ZodArray<typeof visualObjectSchema>> { return z.array(visualObjectSchema).max(128).optional(); },
  width: z.number().positive().max(4), height: z.number().positive().max(4), layer: z.number().int(),
  color: color.default('#ffffff'), fontSize: z.number().int().min(12).max(300).default(60), fontAssetId: id.optional(),
  textClip: z.object({ x: z.number().finite(), y: z.number().finite(), width: z.number().nonnegative(), height: z.number().nonnegative() }).optional(),
  textEffects: z.object({ outlineWidth: z.number().nonnegative().optional(), outlineColor: color.optional(), outlineOpacity: z.number().min(0).max(1).optional(), shadowX: z.number().finite().optional(), shadowY: z.number().finite().optional(), shadowBlur: z.number().min(0).max(64).optional(), shadowColor: color.optional(), shadowOpacity: z.number().min(0).max(1).optional() }).optional(),
  textAlign: z.enum(['left', 'center', 'right']).optional(), textVerticalAlign: z.enum(['top', 'center', 'bottom']).optional(), textItalic: z.boolean().optional(),
  duration: z.number().nonnegative(), wait: z.boolean().default(false),
  persistent: z.boolean().optional(), loop: z.boolean().optional(),
  lifetime: z.enum(['line']).optional(),
  visualTransitions: visualTransitionsSchema.optional(), transitionWait: z.boolean().optional(),
  /** Media timing is used by video visual objects. Audio clips keep the same
   * concepts on their dedicated action shape. */
  sourceDuration: z.number().finite().nonnegative().optional(), mediaOffset: z.number().finite().nonnegative().optional(),
  volume: z.number().min(0).max(1).optional(), fadeIn: z.number().finite().nonnegative().optional(), fadeOut: z.number().finite().nonnegative().optional(), muted: z.boolean().optional(),
  retimeOnDuration: z.boolean().optional(),
  chapterPresentation: z.boolean().optional(),
  retimeBasisDuration: z.number().positive().optional(),
  keyframes: z.array(keyframeSchema).min(1).max(32),
  maskAssetId: id.optional(),
  imageFit: z.enum(['stretch', 'contain', 'cover']).optional(),
  imageAlign: z.enum(['top', 'center', 'bottom']).optional(),
  glyphParticles: z.object({
    source: z.enum(['image', 'text']).optional(), assetId: id.optional(), count: z.number().int().min(1).max(200),
    seed: z.number().int().min(0).max(1000000).optional(),
    lifeCurves: z.partialRecord(z.enum(['size', 'opacity', 'forceX', 'forceY', 'red', 'green', 'blue']), z.array(visualCurveKeySchema.extend({ at: z.number().min(0).max(1) })).min(1).max(64)).optional(),
    emissionStart: z.number().nonnegative(), timeScale: z.number().positive(), sizeScale: z.number().positive(), motionScale: z.number().nonnegative(),
    rect: z.object({ x: z.number().finite(), y: z.number().finite(), width: z.number().positive(), height: z.number().positive() }),
  }).optional(),
  ripple: z.object({ strength: z.number().min(0).max(1), speed: z.number().finite() }).optional(),
  dissolve: z.object({ start: z.number().nonnegative(), end: z.number().nonnegative(), from: z.number().min(-1).max(1), to: z.number().min(-1).max(1) }).optional(),
  curves: z.partialRecord(z.enum(['x', 'y', 'scale', 'scaleX', 'scaleY', 'rotation', 'opacity', 'dissolveStrength', 'rippleStrength', 'rippleSpeed']), z.array(visualCurveKeySchema).min(1).max(64)).optional(),
  particles: z.object({ count: z.number().int().min(1).max(500), seed: z.number().int().min(0).max(1000000), lifetime: z.number().positive(), speed: z.number().nonnegative(), direction: z.number().finite(), spread: z.number().min(0).max(360), size: z.number().positive(), endSize: z.number().nonnegative(), lifeCurves: particleLifeCurvesSchema.optional() }).optional(),
});
export type VisualObject = z.infer<typeof visualObjectSchema>;
export const actionSchema = z.discriminatedUnion('kind', [
  visualObjectSchema,
  z.object({ kind: z.literal('hideVisual'), instanceId: id, exitTransition: actorTransitionRuleSchema.optional(), wait: z.boolean().optional() }),
  z.object({ kind: z.literal('background'), assetId: id, transition, ...appearanceTiming }),
  z.object({ kind: z.literal('show'), actorTransitions: actorTransitionsSchema.optional(), moveOffsets: moveOffsetsSchema.optional(), afterOffsets: actorCurvesSchema.optional(), characterId: z.union([id, z.literal('')]).default(''), expressionId: z.string().max(240).default(''), instanceId: id.optional(), lifetime: z.enum(['line', 'persistent']).optional(), presetId: id.optional(), x: z.number().finite(), y: z.number().finite(), scale: z.number().finite(), layer: z.number().int(), transition, ...appearanceTiming }),
  z.object({ kind: z.literal('hide'), characterId: id, instanceId: id.optional(), transition, ...appearanceTiming }),
  z.object({ kind: z.literal('music'), assetId: id, loop: z.boolean().default(true), fade: z.number().nonnegative().default(0) }),
  z.object({ kind: z.literal('sound'), assetId: id }),
  z.object({ kind: z.literal('unlock'), assetId: id }),
  z.object({ kind: z.literal('audioClip'), instanceId: id, name: z.string().default('音频'), assetId: id, duration: z.number().finite().nonnegative(), sourceDuration: z.number().finite().nonnegative().optional(), offset: z.number().finite().nonnegative().default(0), volume: z.number().min(0).max(1).default(1), fadeIn: z.number().finite().nonnegative().default(0), fadeOut: z.number().finite().nonnegative().default(0), bus: z.enum(['music', 'sound', 'voice']).default('sound'), wait: z.boolean().default(false) }),
  z.object({ kind: z.literal('stopMusic'), fade: z.number().nonnegative().default(0) }),
  z.object({ kind: z.literal('pause'), seconds: z.number().nonnegative() }),
  z.object({ kind: z.literal('hideInterface') }),
  z.object({ kind: z.literal('showInterface') }),
  z.object({ kind: z.literal('startDialogue') }),
  z.object({ kind: z.literal('animate'), characterId: id, instanceId: id.optional(), keyframes: z.array(keyframeSchema).min(1).max(32), curves: actorCurvesSchema.optional(), wait: z.boolean().default(false), repeat: z.boolean().default(false) }),
  z.object({ kind: z.literal('camera'), x: z.number().finite(), y: z.number().finite(), zoom: z.number().finite(), rotation: z.number().finite(), duration: z.number().nonnegative(), easing, wait: z.boolean().default(false), curves: cameraCurvesSchema.optional() }),
  z.object({ kind: z.literal('shake'), direction: z.enum(['horizontal', 'vertical']), duration: z.number().nonnegative().optional(), amplitude: z.number().finite().optional(), wait: z.boolean().optional() }),
  z.object({ kind: z.literal('effect'), effectId: id }),
  z.object({ kind: z.literal('blueprint'), blueprintId: id, inputs: z.record(id, value).optional(), actorTransitions: actorTransitionsSchema.optional() }),
  z.object({ kind: z.literal('chapter'), title: z.string(), subtitle: z.string().default(''), duration: z.number().nonnegative().default(2.5), effect: z.enum(['none', 'fade', 'ink']).optional(), backgroundId: id.optional(), titleImageId: id.optional(), soundId: id.optional(), wait: z.boolean().optional(), layer: z.number().int().optional() }),
  z.object({ kind: z.literal('characterFeature'), characterId: id, featureId: id }),
]);
export type StageAction = z.infer<typeof actionSchema>;
export const effectDefinitionSchema = z.object({ id, name: z.string().min(1).max(120), commands: z.array(z.string().max(500)).max(64).default([]), actions: z.array(actionSchema).max(64).optional() });
export type EffectDefinition = z.infer<typeof effectDefinitionSchema>;
export const performancePlaybackSchema = z.object({
  clickSkip: z.boolean().optional(),
  onComplete: z.enum(['next', 'title']).optional(),
  transition: z.object({
    mode: z.enum(['none', 'dissolve', 'color']),
    outDuration: z.number().finite().min(0).max(60).default(.5),
    hold: z.number().finite().min(0).max(60).default(0),
    inDuration: z.number().finite().min(0).max(60).default(.5),
    color: color.default('#000000'),
  }).optional(),
});
export type PerformancePlayback = z.infer<typeof performancePlaybackSchema>;
export const lineSchema = z.object({ id, speakerId: id.optional(), text: z.string(), silent: z.boolean().optional(), voiceId: id.optional(), actions: z.array(actionSchema).default([]), playback: performancePlaybackSchema.optional() });
export type StoryLine = z.infer<typeof lineSchema>;

const flowchartSchema = z.object({ visible: z.boolean().optional(), name: z.string().max(120).optional(), styleId: id.optional() });
const base = { flowchart: flowchartSchema.optional(), id, name: z.string(), sceneId: id, x: z.number().finite(), y: z.number().finite(), textHeading: z.boolean().optional() };
const next = id.optional();
export const hotspotSchema = z.object({
  id, name: z.string(), x: z.number().finite(), y: z.number().finite(),
  width: z.number().nonnegative(), height: z.number().nonnegative(),
  characterId: id.optional(), condition: conditionSchema.optional(), target: next,
});
export type InteractionHotspot = z.infer<typeof hotspotSchema>;
export const externalScriptSchema = z.object({
  /** An imported project-local Ren'Py module loaded by the exported game. */
  assetId: id,
  entry: id,
  args: z.record(id, value).default({}),
});
export type ExternalScript = z.infer<typeof externalScriptSchema>;
export const minigameDefinitionSchema = z.object({
  id, name: z.string().min(1).max(120),
  mode: z.enum(['blueprint', 'script']),
  blueprintId: id.optional(),
  script: externalScriptSchema.optional(),
  /** The authored UI page used as the interaction surface. */
  uiPageId: id,
}).superRefine((definition, context) => {
  if (definition.mode === 'blueprint' && !definition.blueprintId) context.addIssue({ code: 'custom', path: ['blueprintId'], message: '蓝图小游戏必须绑定蓝图。' });
  if (definition.mode === 'script' && !definition.script) context.addIssue({ code: 'custom', path: ['script'], message: '脚本小游戏必须填写脚本入口。' });
});
export type MinigameDefinition = z.infer<typeof minigameDefinitionSchema>;

export const nodeSchema = z.discriminatedUnion('kind', [
  z.object({ ...base, kind: z.literal('start'), next }),
  z.object({ ...base, kind: z.literal('passage'), lines: z.array(lineSchema), next }),
  z.object({ ...base, kind: z.literal('choice'), prompt: z.string(), choices: z.array(z.object({ id, text: z.string(), target: next, condition: conditionSchema.optional() })) }),
  z.object({ ...base, kind: z.literal('condition'), condition: conditionSchema, yes: next, no: next }),
  z.object({ ...base, kind: z.literal('set'), variableId: id, operation: z.enum(['set', 'add']), value, when: conditionSchema.optional(), next }),
  z.object({ ...base, kind: z.literal('jump'), target: next, sceneTransition: sceneTransitionSchema.optional() }),
  z.object({ ...base, kind: z.literal('call'), target: next, next }),
  z.object({ ...base, kind: z.literal('return') }),
  z.object({ ...base, kind: z.literal('end') }),
  z.object({ ...base, kind: z.literal('chapterTitle'), title: z.string(), subtitle: z.string().default(''), duration: z.number().nonnegative().default(2.5),
    effect: z.enum(['none', 'fade', 'ink']).optional(), backgroundId: id.optional(), titleImageId: id.optional(), soundId: id.optional(), playback: performancePlaybackSchema.optional(), next }),
  z.object({ ...base, kind: z.literal('interaction'), prompt: z.string(), showHints: z.boolean().default(true), hotspots: z.array(hotspotSchema).min(1).max(64), timeoutSeconds: z.number().nonnegative().default(0), timeout: next, cancel: next }),
  z.object({ ...base, kind: z.literal('minigame'), template: z.enum(['password', 'timedClicks', 'custom']), title: z.string(), prompt: z.string(), password: z.string().max(128).default('1234'), caseSensitive: z.boolean().default(false), attempts: z.number().int().min(1).max(20).default(3), targetClicks: z.number().int().min(1).max(999).default(5), timeLimit: z.number().int().min(1).max(600).default(10), minigameId: id.optional(), success: next, failure: next, cancel: next }),
]);
export type StoryNode = z.infer<typeof nodeSchema>;
export type NodeKind = StoryNode['kind'];
export type PassageNode = Extract<StoryNode, { kind: 'passage' }>;

export const sceneSchema = z.object({
  id, name: z.string(), chapterId: id, flowchart: flowchartSchema.optional(),
  // A scene can inherit a reusable scene blueprint and override named parameters.
  baseSceneId: id.optional(),
  blueprintId: id.optional(),
  parameters: z.record(z.string(), value).optional(),
  entryActions: z.array(actionSchema).max(64).optional(),
});
export type Scene = z.infer<typeof sceneSchema>;

/** Resolve a scene instance chain without mutating authored scene data. */
export function effectiveScene(project: Project, sceneId: string, seen = new Set<string>()): Scene | undefined {
  const scene = project.scenes.find(item => item.id === sceneId);
  if (!scene || seen.has(scene.id) || !scene.baseSceneId) return scene;
  const base = effectiveScene(project, scene.baseSceneId, new Set(seen).add(scene.id));
  if (!base) return scene;
  return {
    ...base,
    ...scene,
    blueprintId: scene.blueprintId ?? base.blueprintId,
    parameters: { ...(base.parameters ?? {}), ...(scene.parameters ?? {}) },
    entryActions: scene.entryActions ?? base.entryActions,
  };
}

export const spineAssetSchema = z.object({
  version: z.string(), atlasPath: z.string(),
  pages: z.array(z.object({ name: z.string(), path: z.string(), width: z.number().positive(), height: z.number().positive(), sourcePremultipliedAlpha: z.boolean().optional() })).min(1).max(64),
  animations: z.array(z.object({ name: z.string(), duration: z.number().min(0) })).max(2048),
  skins: z.array(z.string()).max(2048),
  bounds: z.object({ x: z.number().finite(), y: z.number().finite(), width: z.number().positive(), height: z.number().positive() }),
});
export const assetCategorySchema = z.enum(['scene', 'portrait', 'ui', 'bgm', 'voice', 'sound', 'video', 'font', 'spine', 'script', 'other']);
export type AssetCategory = z.infer<typeof assetCategorySchema>;
const emissionMeshSchema = z.object({ vertices: z.array(z.tuple([z.number().finite(), z.number().finite()])).min(3).max(100000), triangles: z.array(z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative(), z.number().int().nonnegative()])).min(1).max(100000) }).refine(mesh => mesh.triangles.every(triangle => triangle.every(index => index < mesh.vertices.length)), '网格索引超出顶点范围');
export const assetSchema = z.object({ emissionMesh: emissionMeshSchema.optional(), id, name: z.string(), kind: z.enum(['image', 'audio', 'font', 'video', 'spine', 'script']), path: z.string(), category: assetCategorySchema.optional(), sourcePath: z.string().optional(), externalPath: z.string().optional(), externalFiles: z.record(z.string(), z.string()).optional(), width: z.number().optional(), height: z.number().optional(), visibleBounds: z.object({ x: z.number().nonnegative(), y: z.number().nonnegative(), width: z.number().positive(), height: z.number().positive() }).optional(), spine: spineAssetSchema.optional() });
export type Asset = z.infer<typeof assetSchema>;
/** Every file needed to save-as, serve, and export a grouped asset. */
export function assetFiles(asset: Asset): string[] {
  return [...new Set([asset.path, ...(asset.spine ? [asset.spine.atlasPath, ...asset.spine.pages.map(page => page.path)] : [])])];
}
export const characterFeatureSchema = z.object({ id, name: z.string(), actions: z.array(actionSchema).max(64).optional() });
export const characterDisplayPresetSchema = z.object({
  id, name: z.string().trim().min(1).max(80),
  x: z.number().finite(), y: z.number().finite(), scale: z.number().finite().positive(),
  useDefaultFraming: z.boolean().default(true),
});
export type CharacterDisplayPreset = z.infer<typeof characterDisplayPresetSchema>;
export const characterSchema = z.object({
  id, name: z.string(), color, expressions: z.array(z.object({ id, name: z.string(), assetId: id })),
  // Characters may inherit expressions and reusable blueprint features.
  baseCharacterId: id.optional(),
  defaultExpressionId: id.optional(),
  actorTransitions: actorTransitionsSchema.optional(),
  portraitFraming: z.object({ x: z.number().finite().default(0.5), top: z.number().min(-1).max(0.9).default(0.16), visibleFraction: z.number().min(0.1).max(1).default(0.64) }).optional(),
  displayPresets: z.array(characterDisplayPresetSchema).max(64).optional(),
  defaultDisplayPresetId: id.optional(),
  blueprintId: id.optional(),
  features: z.array(characterFeatureSchema).max(64).optional(),
});
export type Character = z.infer<typeof characterSchema>;
export const parameterSetSchema = z.object({ id, name: z.string().min(1).max(120), description: z.string().max(1000).optional(), kind: z.enum(['story', 'settings']) });
export type ParameterSet = z.infer<typeof parameterSetSchema>;
export const variableSchema = z.object({ id, name: z.string(), type: z.enum(['number', 'boolean', 'string']), initial: value, persistent: z.boolean().default(false), parameterSetId: id.optional(),
  setting: z.object({ visible: z.boolean().optional(), min: z.number().finite().optional(), max: z.number().finite().optional(), step: z.number().positive().optional(), options: z.array(z.string().max(200)).max(64).optional() }).optional(),
});
export type Variable = z.infer<typeof variableSchema>;

// UE-style authoring graphs are kept separate from the story-flow graph. They
// describe typed execution/data pins and can be used as reusable functions,
// macros, effects, scene entry logic, or UI interactions.
export const blueprintPinSchema = z.object({
  // Node-local pins also use property names (assetId, characterId). A call
  // signature adds a four-character prefix to a project interface id.
  id: z.string().regex(/^[a-z][a-zA-Z0-9_]{0,67}$/),
  name: z.string().min(1).max(120),
  direction: z.enum(['input', 'output']),
  dataType: z.enum(['exec', 'boolean', 'number', 'string', 'asset', 'scene', 'character', 'ui', 'component', 'any']),
  required: z.boolean().default(false),
  defaultValue: value.optional(),
});
export type BlueprintPin = z.infer<typeof blueprintPinSchema>;
export const maxBlueprintInputs = 128;
export const maxBlueprintOutputs = 32;
export const blueprintNodeSchema = z.object({
  id,
  type: z.enum(['event', 'eventClick', 'eventButton', 'eventValueChanged', 'eventTextCommitted', 'eventKey', 'eventTimer', 'showUiPage', 'closeUiPage', 'random', 'formatText', 'sequence', 'branch', 'compare', 'select', 'setVariable', 'getVariable', 'getInput', 'literal', 'math', 'delay', 'forLoop', 'callFunction', 'callMacro', 'sceneAction', 'switchScene', 'showBackground', 'showCharacter', 'startDialogue', 'showChapter', 'camera', 'shake', 'savedAction', 'hideCharacter', 'playMusic', 'playSound', 'stopMusic', 'uiAction', 'setUiProperty', 'getUiProperty', 'animateUiProperty', 'stopUiAnimation', 'playUiAnimation', 'stopUiAnimationPlayback', 'resetUiComponent', 'playSpine', 'pauseSpine', 'setSpineSpeed', 'setPlayerPreference', 'getPlayerPreference', 'setMinigameValue', 'getMinigameValue', 'finishMinigame', 'confirmMessage', 'effect', 'setOutput', 'return', 'comment']),
  name: z.string().min(1).max(120),
  x: z.number().finite(),
  y: z.number().finite(),
  pins: z.array(blueprintPinSchema).max(4096).default([]),
  properties: z.record(z.string(), value).default({}),
  collapsed: z.boolean().default(false),
});
export type BlueprintNode = z.infer<typeof blueprintNodeSchema>;
export const blueprintLinkSchema = z.object({
  id,
  fromNodeId: id,
  fromPinId: blueprintPinSchema.shape.id,
  toNodeId: id,
  toPinId: blueprintPinSchema.shape.id,
});
export type BlueprintLink = z.infer<typeof blueprintLinkSchema>;
export const blueprintGraphSchema = z.object({
  id,
  name: z.string().min(1).max(120),
  callName: z.string().min(1).max(120).optional(),
  performanceKind: z.enum(['dialogue', 'standalone']).optional(),
  playback: performancePlaybackSchema.optional(),
  timelineComponent: z.boolean().optional(),
  visualComposition: z.boolean().optional(),
  compositionContainer: z.boolean().optional(),
  chapterVariant: z.enum(['text', 'image']).optional(),
  chapterPresetRevision: z.number().int().min(1).optional(),
  uiPageId: z.union([id, z.string().regex(/^ui:[a-zA-Z]+$/)]).optional(),
  uiInstanceId: id.optional(),
  kind: z.enum(['function', 'macro', 'effect', 'scene', 'character', 'ui', 'minigame']),
  nodes: z.array(blueprintNodeSchema).max(512).default([]),
  links: z.array(blueprintLinkSchema).max(2048).default([]),
  exposedInputs: z.array(blueprintPinSchema.extend({ id })).max(maxBlueprintInputs).default([]),
  exposedOutputs: z.array(blueprintPinSchema.extend({ id })).max(maxBlueprintOutputs).default([]),
  timeline: z.object({ tracks: z.array(z.object({ id, name: z.string().min(1).max(120) })).max(64), clips: z.array(z.object({ nodeId: id, trackId: id })).max(256), tailNodeId: id.optional() }).optional(),
});
export type BlueprintGraph = z.infer<typeof blueprintGraphSchema>;

export const uiPageSchema = z.enum(['main', 'say', 'choice', 'save', 'preferences', 'voiceSettings', 'pause', 'history', 'gallery', 'musicRoom', 'voiceCollection', 'chapterSelect', 'chapterTitle', 'messageBox', 'staff', 'keyboard', 'custom', 'flowchart', 'gameOver']);
export const uiComponentLimit = 4096;
export const uiSkinSchema = z.object({
  idle: id.optional(), hover: id.optional(), pressed: id.optional(), selected: id.optional(), disabled: id.optional(),
  fit: z.enum(['stretch', 'contain', 'cover', 'nineSlice']).optional(),
  borders: z.object({ left: z.number().min(0).max(2048), top: z.number().min(0).max(2048), right: z.number().min(0).max(2048), bottom: z.number().min(0).max(2048) }).optional(),
  hideText: z.boolean().optional(),
  brightness: z.object({ idle: z.number().min(0).max(1).optional(), hover: z.number().min(0).max(1).optional(), pressed: z.number().min(0).max(1).optional(), selected: z.number().min(0).max(1).optional(), disabled: z.number().min(0).max(1).optional() }).optional(),
});
export type UiSkin = z.infer<typeof uiSkinSchema>;
export type UiButtonState = 'idle' | 'hover' | 'pressed' | 'selected' | 'disabled';
export const uiPageSettingsSchema = z.object({
  layout: z.enum(['native', 'custom']).optional(),
  backgroundId: id.optional(), background: color.optional(),
  backgroundOpacity: z.number().min(0).max(1).optional(),
  showQuickMenu: z.boolean().optional(),
});
export const uiPagesSchema = z.partialRecord(uiPageSchema, uiPageSettingsSchema);
export const uiRelativeRectSchema = z.object({ x: z.number().finite(), y: z.number().finite(), width: z.number().nonnegative(), height: z.number().nonnegative() });
export const spinePlaybackSchema = z.object({
  animation: z.string().optional(), skin: z.string().optional(),
  autoplay: z.boolean().optional(), loop: z.boolean().optional(), speed: z.number().nonnegative().optional(),
  fit: z.enum(['contain', 'manual']).optional(), scale: z.number().finite().optional(),
  originX: z.number().finite().optional(), originY: z.number().finite().optional(),
  flipX: z.boolean().optional(), flipY: z.boolean().optional(), rotation: z.number().finite().optional(),
});
export type SpinePlayback = z.infer<typeof spinePlaybackSchema>;
export const galleryGroupSchema = z.object({
  id, name: z.string().max(120), thumbnailAssetId: id.optional(), assetIds: z.array(id).max(2048),
  unlockWhen: conditionSchema.optional(),
  variantUnlockWhen: z.record(id, conditionSchema).optional(),
});
export type GalleryGroup = z.infer<typeof galleryGroupSchema>;
export const uiComponentSchema = z.object({
  id, page: uiPageSchema,
  parentId: id.optional(),
  childLayer: z.enum(['background', 'foreground']).optional(),
  inheritState: z.boolean().optional(),
  name: z.string().max(120).optional(),
  editor: z.object({ hidden: z.boolean().optional(), locked: z.boolean().optional(), listOrder: z.number().finite().optional() }).optional(),
  kind: z.enum(['text', 'button', 'image', 'video', 'spine', 'panel', 'progress', 'choiceList', 'saveSlots', 'preference', 'preferenceChoice', 'pauseMenu', 'historyList', 'galleryGrid', 'musicTrackList', 'voiceCollection', 'chapterList', 'chapterTitle', 'messageBox', 'staffRoll', 'keyboard', 'flowchart', 'gameOver']),
  text: z.string().default(''), assetId: id.optional(), posterId: id.optional(), loop: z.boolean().optional(), value: z.number().min(0).max(1).optional(),
  tooltip: z.string().max(200).optional(), shortcut: z.string().max(64).optional(),
  skin: uiSkinSchema.optional(),
  disabled: z.boolean().optional(), visibleWhen: conditionSchema.optional(), enabledWhen: conditionSchema.optional(), selectedWhen: conditionSchema.optional(), saveMode: z.enum(['save', 'load']).optional(),
  spine: spinePlaybackSchema.optional(),
  layer: z.number().finite().optional(),
  list: z.object({
    layout: z.enum(['grid', 'staggered', 'flow']).optional(), staggerX: z.number().min(0).max(1920).optional(),
    columns: z.number().int().min(1).max(12).optional(), rows: z.number().int().min(1).max(12).optional(),
    gapX: z.number().min(0).max(256).optional(), gapY: z.number().min(0).max(256).optional(),
    itemWidth: z.number().min(16).max(1920).optional(), itemHeight: z.number().min(16).max(1080).optional(),
    navigation: z.enum(['top', 'bottom']).optional(),
    thumbnail: uiRelativeRectSchema.optional(), caption: uiRelativeRectSchema.optional(), number: uiRelativeRectSchema.optional(),
    thumbnailFit: z.enum(['contain', 'cover', 'stretch']).optional(), lockedRect: uiRelativeRectSchema.optional(), navigationRect: uiRelativeRectSchema.optional(), pageSkin: uiSkinSchema.optional(),
    thumbnailBrightness: uiSkinSchema.shape.brightness,
    pageTextColor: color.optional(), pageSelectedTextColor: color.optional(),
    captionMode: z.enum(['time', 'story']).optional(),
    fixedAutoSlot: z.boolean().optional(), pageCount: z.number().int().min(1).max(99).optional(),
    chapter: uiRelativeRectSchema.optional(), slotAction: uiRelativeRectSchema.optional(),
    slotActionSkin: uiSkinSchema.optional(), slotSaveSkin: uiSkinSchema.optional(), autoSlotSkin: uiSkinSchema.optional(), numberSkin: uiSkinSchema.optional(), numberTextColor: color.optional(),
    summaryFontSize: z.number().int().min(12).max(96).optional(),
    thumbnailFrame: uiRelativeRectSchema.extend({ assetId: id }).optional(),
    emptyAssetId: id.optional(), hoverOverlayId: id.optional(),
    showLabels: z.boolean().optional(), showDelete: z.boolean().optional(),
    lockedAssetId: id.optional(), assetIds: z.array(id).max(2048).optional(),
    galleryGroups: z.array(galleryGroupSchema).max(2048).optional(),
    galleryUnlockWhen: z.record(id, conditionSchema).optional(),
    galleryFit: z.enum(['contain', 'cover', 'stretch']).optional(),
    galleryEndAction: z.enum(['close', 'loop']).optional(), galleryShowControls: z.boolean().optional(),
    galleryPageButtonLimit: z.number().int().min(1).max(99).optional(),
    pageButtonWidth: z.number().min(16).max(256).optional(), pageButtonHeight: z.number().min(16).max(256).optional(), pageGap: z.number().min(0).max(128).optional(),
    pageFontSize: z.number().int().min(12).max(96).optional(), pageFontAssetId: id.optional(), pageBold: z.boolean().optional(),
    lockUnread: z.boolean().optional(), showProgress: z.boolean().optional(), confirmJump: z.boolean().optional(),
    flowLineAssetId: id.optional(), flowVerticalLineAssetId: id.optional(), flowLineWidth: z.number().min(1).max(32).optional(), flowLineColor: color.optional(), flowEndSkin: uiSkinSchema.optional(), flowChapterSkin: uiSkinSchema.optional(),
    flowCurrentMarker: z.object({ assetId: id, rect: uiRelativeRectSchema }).optional(),
    flowViewport: uiRelativeRectSchema.optional(), flowShowControls: z.boolean().optional(), flowShowVerticalScrollbar: z.boolean().optional(),
    flowScrollbar: z.object({ rect: uiRelativeRectSchema, trackId: id.optional(), thumb: uiSkinSchema.optional(), trackHeight: z.number().min(1).max(128).optional(), thumbHeight: z.number().min(4).max(128).optional() }).optional(),
    favoritesOnly: z.boolean().optional(),
    voiceOrder: z.enum(['source', 'favorites']).optional(),
    voiceRemoveConfirm: z.boolean().optional(), voiceRemoveMessage: z.string().min(1).max(2000).optional(),
    showVoiceControls: z.boolean().optional(), voiceSingleLine: z.boolean().optional(),
    voiceCaptionMode: z.enum(['speaker', 'text']).optional(), voiceFavoriteRect: uiRelativeRectSchema.optional(),
    historyLayout: z.enum(['stacked', 'columns']).optional(), historyNameWidth: z.number().min(40).max(400).optional(),
    historyNameFontSize: z.number().min(12).max(96).optional(), historyRowHeight: z.number().min(0).max(400).optional(),
    historyPaddingY: z.number().min(0).max(100).optional(),
    historyBold: z.boolean().optional(), historyLetterSpacing: z.number().min(-4).max(30).optional(),
    historyScrollbar: z.object({ rect: uiRelativeRectSchema, trackId: id.optional(), trackWidth: z.number().min(1).max(64).optional(), thumb: uiSkinSchema.optional() }).optional(),
    voiceButtonSize: z.number().min(16).max(128).optional(), voiceReplaySkin: uiSkinSchema.optional(), voiceFavoriteSkin: uiSkinSchema.optional(),
  }).optional(),
  action: z.enum(['start', 'load', 'preferences', 'gallery', 'music', 'quit', 'save', 'history', 'auto', 'skip',
    'return', 'mainMenu', 'rollback', 'window', 'fullscreen', 'mute', 'skipSeen', 'skipAll', 'transitions',
    'pause', 'chapterSelect', 'voiceCollection', 'flowchart', 'staff', 'blueprint', 'hideInterface',
    'musicPrevious', 'musicNext', 'musicPlayPause', 'musicStop', 'musicLoop', 'musicShuffle', 'setPlayerPreference', 'resetPreferences', 'voiceSettings', 'confirmYes', 'confirmNo', 'minigameSuccess', 'minigameFailure', 'minigameCancel']).optional(),
  blueprintId: id.optional(),
  binding: z.enum(['title', 'speaker', 'dialogue', 'tooltip', 'confirmation', 'minigameTitle', 'minigamePrompt', 'minigameStatus']).optional(),
  parameterId: id.optional(),
  events: z.object({ onClick: id.optional(), onShow: id.optional() }).optional(),
  hoverSoundId: id.nullable().optional(),
  preference: z.enum(playerPreferenceKeys).optional(), preferenceValue: value.optional(), preferenceCharacterId: id.optional(),
  slider: z.object({ trackId: id.optional(), fillId: id.optional(), thumb: uiSkinSchema.optional(), trackHeight: z.number().min(1).max(128).optional(), thumbWidth: z.number().min(4).max(128).optional(), thumbHeight: z.number().min(4).max(128).optional(), showLabel: z.boolean().optional(), reverse: z.boolean().optional() }).optional(),
  selector: z.object({ options: z.array(z.object({ label: z.string().min(1), value })).min(1).max(64), popupBackgroundId: id.optional(), arrowId: id.optional(), itemSkin: uiSkinSchema.optional(), itemHeight: z.number().min(16).max(128).optional() }).optional(),
  style: z.object({
    fontSize: z.number().int().min(12).max(96).optional(), fontAssetId: id.optional(), textColor: color.optional(),
    hoverTextColor: color.optional(), selectedTextColor: color.optional(), disabledTextColor: color.optional(),
    background: color.optional(), hoverBackground: color.optional(), pressedBackground: color.optional(), selectedBackground: color.optional(), disabledBackground: color.optional(),
    imageFit: z.enum(['contain', 'cover', 'stretch', 'nineSlice']).optional(),
    borderColor: color.optional(), borderWidth: z.number().min(0).max(32).optional(), radius: z.number().min(0).max(64).optional(),
    opacity: z.number().min(0).max(1).optional(),
    playerOpacity: z.boolean().optional(),
    outlineWidth: z.number().nonnegative().optional(), outlineColor: color.optional(), outlineOpacity: z.number().min(0).max(1).optional(),
    shadowX: z.number().optional(), shadowY: z.number().optional(), shadowBlur: z.number().min(0).max(64).optional(), shadowColor: color.optional(), shadowOpacity: z.number().min(0).max(1).optional(),
    align: z.enum(['left', 'center', 'right']).optional(),
  }).optional(),
  x: z.number().finite(), y: z.number().finite(),
  width: z.number().nonnegative(), height: z.number().nonnegative(),
}).superRefine((component, context) => {
  const groupIds = new Set<string>();
  for (const [index, group] of (component.list?.galleryGroups ?? []).entries()) {
    if (groupIds.has(group.id)) context.addIssue({ code: 'custom', path: ['list', 'galleryGroups', index, 'id'], message: '图鉴分组 ID 不能重复。' });
    groupIds.add(group.id);
    if (new Set(group.assetIds).size !== group.assetIds.length) context.addIssue({ code: 'custom', path: ['list', 'galleryGroups', index, 'assetIds'], message: '同组分镜不能重复。' });
  }
  const requiredPage = component.kind === 'choiceList' ? 'choice' : component.kind === 'saveSlots' ? 'save'
    : component.kind === 'pauseMenu' ? 'pause' : component.kind === 'historyList' ? 'history' : component.kind === 'galleryGrid' ? 'gallery'
    : component.kind === 'musicTrackList' ? 'musicRoom' : component.kind === 'voiceCollection' ? 'voiceCollection' : component.kind === 'chapterList' ? 'chapterSelect'
    : component.kind === 'chapterTitle' ? 'chapterTitle' : component.kind === 'messageBox' ? 'messageBox' : component.kind === 'staffRoll' ? 'staff'
    : component.kind === 'keyboard' ? 'keyboard' : component.kind === 'flowchart' ? 'flowchart'
    : component.kind === 'gameOver' ? 'gameOver' : undefined;
  if (requiredPage && component.page !== requiredPage) context.addIssue({ code: 'custom', path: ['page'], message: '该组件不能放在当前页面。' });
  if (component.kind === 'preference' || component.kind === 'preferenceChoice') {
    if (!component.parameterId && !['preferences', 'voiceSettings'].includes(component.page)) context.addIssue({ code: 'custom', path: ['page'], message: '设置控件应放在设置或角色音量页。' });
    if (!component.preference && !component.parameterId) context.addIssue({ code: 'custom', path: ['preference'], message: '请选择玩家设置或参数。' });
    else if (!component.parameterId && component.kind === 'preference' && playerPreferences[component.preference!].type !== 'number') context.addIssue({ code: 'custom', path: ['preference'], message: '滑条只能控制数值设置。' });
    else if (!component.parameterId && component.kind === 'preferenceChoice') for (const [index, option] of (component.selector?.options ?? []).entries()) {
      if (!validPlayerPreference(component.preference!, option.value)) context.addIssue({ code: 'custom', path: ['selector', 'options', index, 'value'], message: '选项值与所选设置不匹配。' });
    }
  }
  if (component.action === 'setPlayerPreference' && (!component.preference || !validPlayerPreference(component.preference, component.preferenceValue))) context.addIssue({ code: 'custom', path: ['preferenceValue'], message: '请选择玩家设置并填写有效的值。' });
  if (['confirmYes', 'confirmNo'].includes(component.action ?? '') && component.page !== 'messageBox') context.addIssue({ code: 'custom', path: ['action'], message: '确认和取消按钮应放在消息框页。' });
  if (component.action === 'blueprint' && !component.blueprintId) context.addIssue({ code: 'custom', path: ['blueprintId'], message: '界面按钮调用的蓝图不存在。' });
  if (component.binding) {
    const customBinding = component.kind === 'text' && component.page === 'custom' && ['minigameTitle', 'minigamePrompt', 'minigameStatus'].includes(component.binding);
    const bindingPages = { title: 'main', confirmation: 'messageBox', speaker: 'say', dialogue: 'say' } as const;
    const standardBinding = component.kind === 'text' && component.binding in bindingPages && component.page === bindingPages[component.binding as keyof typeof bindingPages];
    if (!customBinding && !standardBinding && !(component.kind === 'text' && component.binding === 'tooltip')) context.addIssue({ code: 'custom', path: ['binding'], message: '文字绑定必须匹配所属页面。' });
  }
});
export type UiComponent = z.infer<typeof uiComponentSchema>;
export const flowStyleSchema = z.object({
  id, name: z.string().trim().min(1).max(120),
  skin: uiSkinSchema.optional(), style: uiComponentSchema.shape.style,
});
export type FlowStyle = z.infer<typeof flowStyleSchema>;
/**
 * A UMG-like reusable interaction surface. Components retain the same
 * authoring fields as ordinary pages, but are isolated from menu pages and
 * can be selected by a custom minigame or a future generic screen node.
 */
export const customUiPageSchema = z.object({
  id, name: z.string().min(1).max(120),
  components: z.array(uiComponentSchema).max(uiComponentLimit).default([]),
  backgroundId: id.optional(), background: color.optional(), modal: z.boolean().default(true),
  onShowBlueprintId: id.optional(),
});
export type CustomUiPage = z.infer<typeof customUiPageSchema>;
export const uiInstanceSchema = z.object({
  id, name: z.string().min(1).max(120), baseUiId: id.optional(), blueprintId: id.optional(),
  components: z.array(uiComponentSchema).max(uiComponentLimit).default([]),
  hiddenComponentIds: z.array(id).max(uiComponentLimit).optional(),
  parameters: z.record(z.string(), value).optional(),
  pages: uiPagesSchema.optional(),
});
export type UiInstance = z.infer<typeof uiInstanceSchema>;
export const uiAnimationKeySchema = z.object({
  id, time: z.number().min(0).max(3600), value: z.number(),
  easing: z.enum(['linear', 'ease', 'easein', 'easeout']).default('linear'),
});
export const uiAnimationTrackSchema = z.object({
  id, componentId: id, property: z.enum(['x', 'y', 'width', 'height', 'opacity', 'value']),
  keys: z.array(uiAnimationKeySchema).min(1).max(1024),
});
export const uiAnimationClipSchema = z.object({
  id, name: z.string().trim().min(1).max(120), pageId: z.string().min(1).max(80), uiInstanceId: id.optional(),
  duration: z.number().min(0).max(3600), tracks: z.array(uiAnimationTrackSchema).max(128),
});
export type UiAnimationKey = z.infer<typeof uiAnimationKeySchema>;
export type UiAnimationTrack = z.infer<typeof uiAnimationTrackSchema>;
export type UiAnimationClip = z.infer<typeof uiAnimationClipSchema>;
export const themeSchema = z.object({
  flowStyles: z.array(flowStyleSchema).max(128).optional(),
  disabledPages: z.array(uiPageSchema).optional(),
  accent: color, background: color, textColor: color, fontSize: z.number().int().min(16).max(64),
  dialogueHeight: z.number().min(0.15).max(0.6), dialogueOpacity: z.number().min(0).max(1),
  menuMusicId: id.optional(), menuMusicFade: z.number().min(0).max(10).optional(),
  hoverSoundId: id.optional(),
  menuShortcutPage: z.enum(['save', 'load', 'preferences', 'pause']).optional(),
  chapterTransition: z.object({ effect: z.enum(['none', 'fade', 'ink']).optional(), overlayId: id.optional(), maskId: id.optional(), dissolveId: id.optional(), backgroundOffsetX: z.number().min(-1).max(1).optional(), backgroundOffsetY: z.number().min(-1).max(1).optional(), particles: z.boolean().optional(), particleColor: color.optional(), ripple: z.boolean().optional(), rippleStrength: z.number().min(0).max(0.2).optional(), rippleSpeed: z.number().min(0).max(1).optional() }).optional(),
  menuBackgroundId: id.optional(), fontAssetId: id.optional(), continueIndicatorId: id.optional(), continueIndicatorWidth: z.number().min(8).max(256).optional(), pages: uiPagesSchema.optional(), components: z.array(uiComponentSchema).max(uiComponentLimit).default([]),
  instances: z.array(uiInstanceSchema).max(64).optional(), activeInstanceId: id.optional(),
  customPages: z.array(customUiPageSchema).max(64).default([]),
  animations: z.array(uiAnimationClipSchema).max(256).optional(),
});
export type UiTheme = z.infer<typeof themeSchema>;

export const projectSchema = z.object({
  schemaVersion: z.literal(1), id, name: z.string().min(1).max(200), version: z.string().regex(/^\d+\.\d+\.\d+$/),
  playerDefaults: z.partialRecord(z.enum(playerPreferenceKeys), value).optional(),
  parameterSets: z.array(parameterSetSchema).max(128).optional(),
  exportSettings: exportSettingsSchema.optional(),
  resourceSettings: z.object({ importMode: z.enum(['copy', 'reference']).default('copy'), syncFolders: z.boolean().optional(), directory: z.string().trim().min(1).max(120).refine(directory => !/^[\\/]|^[a-z]:|[:\x00]/i.test(directory) && directory.replaceAll('\\', '/').split('/').every(part => part && part !== '.' && part !== '..'), '资源文件夹必须是项目内的相对目录').default('assets') }).optional(),
  width: z.number().int().min(640).max(3840), height: z.number().int().min(360).max(2160),
  assets: z.array(assetSchema), characters: z.array(characterSchema), variables: z.array(variableSchema), effects: z.array(effectDefinitionSchema).default([]),
  blueprints: z.array(blueprintGraphSchema).max(256).default([]),
  timelinePresets: z.array(blueprintGraphSchema).max(256).optional(),
  minigames: z.array(minigameDefinitionSchema).max(128).default([]),
  contentBrowser: z.object({
    folders: z.array(z.object({ id, name: z.string().trim().min(1).max(80), parentId: id.optional(), category: assetCategorySchema.optional() })).max(512).default([]),
    assignments: z.record(z.string(), id).default({}),
    favorites: z.array(z.string()).default([]),
  }).optional(),
  scriptText: z.object({ format: z.literal('vns-text-1'), content: z.string(), sourceName: z.string().optional(), standaloneSyntax: z.literal('module-names').optional(), performanceSyntax: z.literal('explicit').optional(), playbackSyntax: z.literal('inline').optional() }).optional(),
  chapters: z.array(z.object({ id, name: z.string(), flowchart: flowchartSchema.optional() })),
  scenes: z.array(sceneSchema),
  nodes: z.array(nodeSchema), entryId: id, ui: themeSchema,
}).superRefine((project, context) => {
  const check = (components: UiComponent[], path: (string | number)[]) => {
    for (const problem of uiHierarchyProblems(components)) context.addIssue({ code: 'custom', path: [...path, components.findIndex(c => c.id === problem.id), 'parentId'], message: problem.message });
  };
  check(project.ui.components, ['ui', 'components']);
  project.ui.customPages.forEach((page, i) => check(page.components, ['ui', 'customPages', i, 'components']));
  project.ui.instances?.forEach((instance, i) => check(effectiveUiComponents({ ...project.ui, activeInstanceId: instance.id }), ['ui', 'instances', i, 'components']));
  const styleNames = new Set<string>(), styleIds = new Set<string>();
  project.ui.flowStyles?.forEach((style, i) => {
    if (styleNames.has(style.name) || styleIds.has(style.id)) context.addIssue({ code: 'custom', path: ['ui', 'flowStyles', i], message: '流程图样式名称和标识不能重复。' });
    styleNames.add(style.name); styleIds.add(style.id);
  });
});
export type Project = z.infer<typeof projectSchema>;
export interface Diagnostic {
  severity: 'error' | 'warning'; message: string;
  nodeId?: string; lineId?: string; assetId?: string; sourceLine?: number;
  code?: string; help?: string; setting?: 'entry';
  ui?: { page: UiComponent['page']; componentId?: string; instanceId?: string; customPageId?: string };
}

/** Resolve inherited character data without mutating authored project data. */
export function effectiveCharacter(project: Project, characterId: string, seen = new Set<string>()): Character | undefined {
  const character = project.characters.find(item => item.id === characterId);
  if (!character || seen.has(character.id)) return character;
  if (!character.baseCharacterId) return character;
  const base = effectiveCharacter(project, character.baseCharacterId, new Set(seen).add(character.id));
  if (!base) return character;
  const expressions = [...base.expressions, ...character.expressions];
  const expressionMap = new Map(expressions.map(item => [item.id, item]));
  const features = [...(base.features ?? []), ...(character.features ?? [])];
  const featureMap = new Map(features.map(item => [item.id, item]));
  const displayPresets = [...new Map([...(base.displayPresets ?? []), ...(character.displayPresets ?? [])].map(item => [item.id, item])).values()];
  return { ...base, ...character, ...(base.actorTransitions || character.actorTransitions ? { actorTransitions: { ...base.actorTransitions, ...character.actorTransitions } } : {}), blueprintId: character.blueprintId ?? base.blueprintId, expressions: [...expressionMap.values()], features: [...featureMap.values()], displayPresets };
}

export function characterFeatureActions(project: Project, characterId: string, featureId: string): StageAction[] {
  const feature = effectiveCharacter(project, characterId)?.features?.find(item => item.id === featureId);
  const lineage = new Set<string>();
  let current: string | undefined = characterId;
  while (current && !lineage.has(current)) {
    lineage.add(current);
    current = project.characters.find(item => item.id === current)?.baseCharacterId;
  }
  return (feature?.actions ?? []).map(action => action.kind !== 'visual' && 'characterId' in action && typeof action.characterId === 'string' && lineage.has(action.characterId) ? { ...action, characterId } : action);
}

/** Resolve the active UI instance chain, retaining local components as overrides. */
export function effectiveUiComponents(theme: UiTheme): UiComponent[] {
  const instances = theme.instances ?? [];
  const byId = new Map(instances.map(instance => [instance.id, instance]));
  const chain: UiInstance[] = [];
  const seen = new Set<string>();
  let current = theme.activeInstanceId ? byId.get(theme.activeInstanceId) : undefined;
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    chain.unshift(current);
    current = current.baseUiId ? byId.get(current.baseUiId) : undefined;
  }
  const components = new Map(theme.components.map(component => [component.id, component]));
  const hiddenIds = new Set<string>();
  for (const instance of chain) {
    for (const component of instance.components) { components.set(component.id, component); hiddenIds.delete(component.id); }
    for (const id of instance.hiddenComponentIds ?? []) for (const childId of uiSubtreeIds([...components.values()], id)) { components.delete(childId); hiddenIds.add(childId); }
  }
  // Descendants added in a derived instance stay hidden while their parent is hidden.
  for (const id of hiddenIds) for (const childId of uiSubtreeIds([...components.values()], id)) components.delete(childId);
  return [...components.values()];
}

/** Components addressable from a Blueprint, including reusable interaction UI. */
export function allUiComponents(project: Project): UiComponent[] {
  return [...effectiveUiComponents(project.ui), ...(project.ui.customPages ?? []).flatMap(page => page.components)];
}

/** All authored identities remain valid when another UI scheme is selected.
 * Effective overrides win for identities shared through inheritance. */
export function declaredUiComponents(project: Project): UiComponent[] {
  const components = new Map(allUiComponents(project).map(component => [component.id, component]));
  for (const component of [...project.ui.components, ...(project.ui.instances ?? []).flatMap(instance => instance.components)]) {
    if (!components.has(component.id)) components.set(component.id, component);
  }
  return [...components.values()];
}

export function customUiPage(project: Project, pageId: string): CustomUiPage | undefined {
  return (project.ui.customPages ?? []).find(page => page.id === pageId);
}

/** Resolve components for one authored custom page. */
export function customUiComponents(project: Project, pageId: string): UiComponent[] {
  return customUiPage(project, pageId)?.components ?? [];
}

/** Find a custom-page component without exposing the mutable page array. */
export function findCustomUiComponent(project: Project, componentId: string): UiComponent | undefined {
  for (const page of project.ui.customPages ?? []) {
    const component = page.components.find(item => item.id === componentId);
    if (component) return component;
  }
  return undefined;
}

/** Mutably resolve a custom-page component while editing a project draft. */
export function editableCustomUiComponent(project: Project, componentId: string): UiComponent | undefined {
  return findCustomUiComponent(project, componentId);
}

export function orderedUiComponents(theme: UiTheme): UiComponent[] {
  return sortUiComponents(effectiveUiComponents(theme));
}

export function sortUiComponents(components: UiComponent[]): UiComponent[] {
  return components.map((component, index) => ({ component, index }))
    .sort((a, b) => (a.component.layer ?? a.index) - (b.component.layer ?? b.index) || a.index - b.index)
    .map(entry => entry.component);
}

/** Resolve theme-level parameter overrides from the active UI instance chain. */
export function effectiveUiTheme(theme: UiTheme): UiTheme {
  const instances = theme.instances ?? [];
  const byId = new Map(instances.map(instance => [instance.id, instance]));
  const chain: UiInstance[] = [];
  const seen = new Set<string>();
  let current = theme.activeInstanceId ? byId.get(theme.activeInstanceId) : undefined;
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    chain.unshift(current);
    current = current.baseUiId ? byId.get(current.baseUiId) : undefined;
  }
  const parameters = Object.assign({}, ...chain.map(instance => instance.parameters ?? {}));
  const resolved = { ...theme };
  resolved.pages = { ...theme.pages };
  for (const instance of chain) {
    for (const [page, settings] of Object.entries(instance.pages ?? {})) {
      const key = page as keyof NonNullable<UiTheme['pages']>;
      resolved.pages[key] = { ...resolved.pages[key], ...settings };
    }
  }
  if (typeof parameters.accent === 'string' && /^#[0-9a-fA-F]{6}$/.test(parameters.accent)) resolved.accent = parameters.accent;
  if (typeof parameters.background === 'string' && /^#[0-9a-fA-F]{6}$/.test(parameters.background)) resolved.background = parameters.background;
  if (typeof parameters.textColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(parameters.textColor)) resolved.textColor = parameters.textColor;
  if (typeof parameters.fontSize === 'number') resolved.fontSize = Math.max(16, Math.min(64, Math.round(parameters.fontSize)));
  if (typeof parameters.dialogueHeight === 'number') resolved.dialogueHeight = Math.max(0.15, Math.min(0.6, parameters.dialogueHeight));
  if (typeof parameters.dialogueOpacity === 'number') resolved.dialogueOpacity = Math.max(0, Math.min(1, parameters.dialogueOpacity));
  if (typeof parameters.menuBackgroundId === 'string') resolved.menuBackgroundId = parameters.menuBackgroundId;
  if (typeof parameters.menuMusicId === 'string') resolved.menuMusicId = parameters.menuMusicId;
  if (typeof parameters.fontAssetId === 'string') resolved.fontAssetId = parameters.fontAssetId;
  if (typeof parameters.continueIndicatorId === 'string') resolved.continueIndicatorId = parameters.continueIndicatorId;
  return resolved;
}

export function localUiComponents(theme: UiTheme): UiComponent[] {
  return theme.instances?.find(instance => instance.id === theme.activeInstanceId)?.components ?? theme.components;
}

export function editableUiComponent(theme: UiTheme, id: string): UiComponent | undefined {
  const local = localUiComponents(theme);
  const existing = local.find(component => component.id === id);
  if (existing) return existing;
  const inherited = effectiveUiComponents(theme).find(component => component.id === id);
  if (!inherited || local.length >= uiComponentLimit) return;
  const override = structuredClone(inherited);
  local.push(override);
  return override;
}

export function inheritanceReaches<T extends { id: string }>(items: T[], from: string | undefined, target: string, parent: (item: T) => string | undefined): boolean {
  const seen = new Set<string>();
  while (from && !seen.has(from)) {
    if (from === target) return true;
    seen.add(from);
    const item = items.find(item => item.id === from);
    from = item ? parent(item) : undefined;
  }
  return false;
}

export function makeId(prefix = 'n'): string { return `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`; }
export function createProject(name = '未命名作品'): Project {
  const chapterId = makeId('chapter');
  const sceneId = makeId('scene');
  const startId = makeId();
  const passageId = makeId();
  const endId = makeId();
  return {
    schemaVersion: 1, id: makeId('project'), name, version: '1.0.0', width: 1280, height: 720,
    resourceSettings: { importMode: 'copy', directory: 'assets', syncFolders: true },
    assets: [], characters: [], variables: [], effects: [], blueprints: [], timelinePresets: [], minigames: [], chapters: [{ id: chapterId, name: '第一章' }],
    scenes: [{ id: sceneId, chapterId, name: '开场' }], entryId: startId,
    nodes: [
      { kind: 'start', id: startId, sceneId, name: '开始', x: 40, y: 120, next: passageId },
      { kind: 'passage', id: passageId, sceneId, name: '第一段', x: 300, y: 120, lines: [{ id: makeId('line'), text: '', actions: [] }], next: endId },
      { kind: 'end', id: endId, sceneId, name: '返回标题界面', x: 580, y: 120 },
    ],
    ui: { accent: '#1b8a78', background: '#141819', textColor: '#f5f7f7', fontSize: 28, dialogueHeight: 0.27, dialogueOpacity: 0.88, components: [], customPages: [] },
  };
}

export function targets(node: StoryNode): { port: string; target?: string }[] {
  switch (node.kind) {
    case 'choice': return node.choices.map(c => ({ port: c.id, target: c.target }));
    case 'interaction': return [...node.hotspots.map(hotspot => ({ port: hotspot.id, target: hotspot.target })), { port: 'timeout', target: node.timeout }, { port: 'cancel', target: node.cancel }];
    case 'minigame': return [{ port: 'success', target: node.success }, { port: 'failure', target: node.failure }, { port: 'cancel', target: node.cancel }];
    case 'condition': return [{ port: 'yes', target: node.yes }, { port: 'no', target: node.no }];
    case 'jump': return [{ port: 'target', target: node.target }];
    case 'call': return [{ port: 'target', target: node.target }, { port: 'next', target: node.next }];
    case 'end': case 'return': return [];
    case 'passage': return node.lines.some(line => line.silent && line.playback?.onComplete === 'title') ? [] : [{ port: 'next', target: node.next }];
    case 'chapterTitle': return node.playback?.onComplete === 'title' ? [] : [{ port: 'next', target: node.next }];
    default: return [{ port: 'next', target: node.next }];
  }
}

export function connectNode(node: StoryNode, port: string, target?: string): StoryNode {
  if (node.kind === 'choice') return { ...node, choices: node.choices.map(c => c.id === port ? { ...c, target } : c) };
  if (node.kind === 'interaction') {
    if (port === 'timeout' || port === 'cancel') return { ...node, [port]: target };
    return { ...node, hotspots: node.hotspots.map(hotspot => hotspot.id === port ? { ...hotspot, target } : hotspot) };
  }
  if (node.kind === 'minigame' && (port === 'success' || port === 'failure' || port === 'cancel')) return { ...node, [port]: target };
  if (node.kind === 'condition' && (port === 'yes' || port === 'no')) return { ...node, [port]: target };
  if (node.kind === 'jump' && port === 'target') return { ...node, target, sceneTransition: node.sceneTransition ? { ...node.sceneTransition, toSceneId: undefined } : undefined };
  if (node.kind === 'call' && port === 'target') return { ...node, target };
  if ('next' in node || ['start', 'passage', 'set', 'call'].includes(node.kind)) return { ...node, next: target } as StoryNode;
  return node;
}

export function newNode(kind: NodeKind, sceneId: string, variableId?: string): StoryNode {
  const base = { id: makeId(), sceneId, x: 300, y: 300 };
  switch (kind) {
    case 'passage': return { ...base, kind, name: '新段落', lines: [{ id: makeId('line'), text: '', actions: [] }] };
    case 'choice': return { ...base, kind, name: '选择', prompt: '', choices: [{ id: makeId('option'), text: '选项一' }, { id: makeId('option'), text: '选项二' }] };
    case 'condition': return { ...base, kind, name: '条件', condition: variableId ? { kind: 'compare', variableId, operator: 'gte', value: 1 } : { kind: 'all', conditions: [] } };
    case 'set': return { ...base, kind, name: '修改状态', variableId: variableId ?? 'missing', operation: 'set', value: 0 };
    case 'end': return { ...base, kind, name: '返回标题界面' };
    case 'chapterTitle': return { ...base, kind, name: '章节标题', title: '第一章', subtitle: '', duration: 2.5 };
    case 'start': return { ...base, kind, name: '开始' };
    case 'jump': return { ...base, kind, name: '跳转' };
    case 'call': return { ...base, kind, name: '调用段落' };
    case 'return': return { ...base, kind, name: '返回' };
    case 'interaction': return { ...base, kind, name: '点击互动', prompt: '你想查看哪里？', showHints: true, hotspots: [{ id: makeId('hotspot'), name: '互动区域', x: 0.35, y: 0.3, width: 0.3, height: 0.4 }], timeoutSeconds: 0 };
    case 'minigame': return { ...base, kind, name: '自定义小游戏', template: 'custom', title: '自定义小游戏', prompt: '通过控件蓝图或外接脚本实现玩法', password: '', caseSensitive: false, attempts: 3, targetClicks: 5, timeLimit: 10 };
  }
}
