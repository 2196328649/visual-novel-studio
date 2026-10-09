import { GraphResourceOptions } from './GraphResourceOptions';
import { blueprintResources, projectGraphs } from '../core/project-resources';
import { ThemeInspector } from './UiInspector';
import { VisualTransitionField } from './VisualTransitionsEditor';

import { applyAudioClipInputs, createAudioClip } from '../core/audio-clip';
import { TimelineAudioClipEditor } from './TimelineAudioClipEditor';
import { ShowOffsetsEditor } from './EntranceOffsetsEditor';
import { VisualObjectEditor } from './VisualObjectEditor';
import { ActorInstanceField, ActorLifetimeSelect } from './ActorInstanceFields';
import { PortraitFraming } from './PortraitFraming';
import { detachDisplayPreset, resolveShowAction } from '../core/character-presets';
import { CharacterPresets, CharacterPresetSelect } from './CharacterPresets';
import { NumberInput } from './NumberInput';
import { ChapterFields } from './ChapterFields';
import { isStandaloneNode } from '../core/standalone-performance';
import { PerformancePlaybackFields } from './PerformancePlaybackFields';
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowDown, ArrowUp, Copy, Plus, RefreshCw, Settings2, Save, FileCode2, Sparkles, Trash2, X } from "lucide-react";
import { connectNode, effectiveCharacter, effectiveScene, inheritanceReaches, effectDefinitionSchema, makeId, newNode, targets, type Asset, type AssetCategory, type AnimationKeyframe, type Character, type EffectDefinition, type Project, type StageAction, type StoryNode, type SceneTransition, type Scene, type Variable } from "../core/model";
import {
  actionNames,
  findLine,
  nodeNames,
  removeNodes,
  type Commit,
  type EditorView,
} from "./editor";
import {
  ConditionEditor,
  Empty,
  Field,
  IconButton,
  TargetSelect,
  ValueInput,
} from "./components";

import { UiAssetSelect, UiFontFaces, uiFontFamily } from './UiAppearance';

import { SpineAssetPreview } from './SpinePreview';

import type { AssetUrl } from "./StageEditor";
import { applyTextScript, projectToText, textCommandAction, textReference } from "../core/text-script";
import { ParameterEditor } from "./ParameterEditor";
import { assetCategories, assetCategoryNames, categoryAcceptsKind, categoryAssets, setAssetCategory } from '../core/asset-library';
import { browserBridge } from './browserBridge';
import { ActorTransitionFields } from './ActorTransitionFields';
import { actorTransitionDefaults, resolveActorTransitions, graphShowsActors } from '../core/actor-transitions';
import { BlueprintCallFields } from './BlueprintCallFields';
import { blueprintGroup } from '../core/blueprint-authoring';

export type ResourceSelection = {
  kind: "asset" | "character" | "variable";
  id: string;
};
export function Inspector({
  project,
  nodeId,
  lineId,
  resource,
  view,
  uiId,
  uiSelectionRequest,
  projectSettings,
  commit,
  assetUrl,
  selectNode,
  selectResource,
  hideDialogue = false,
  selectUi,
}: {
  project: Project;
  nodeId?: string;
  lineId?: string;
  resource?: ResourceSelection;
  view: EditorView;
  uiId?: string;
  uiSelectionRequest?: string;
  projectSettings: boolean;
  commit: Commit;
  assetUrl: AssetUrl;
  selectNode: (id: string, lineId?: string) => void;
  selectResource: (resource?: ResourceSelection) => void;
  hideDialogue?: boolean;
  selectUi?: (id?: string) => void;
}) {
  const node = project.nodes.find((n) => n.id === nodeId);
  const line = hideDialogue ? undefined : findLine(project, nodeId, lineId);
  const effects = project.effects ?? [];
  const [effectDraft, setEffectDraft] = useState<{ nodeId: string; lineId: string; name: string; replace: boolean }>();
  const [effectsOpen, setEffectsOpen] = useState(false);
  const editNode = (label: string, edit: (node: StoryNode) => void) =>
    commit(label, (p) => {
      const n = p.nodes.find((n) => n.id === nodeId);
      if (n) edit(n);
    });
  let title =
    view === "ui"
      ? "界面属性"
      : isStandaloneNode(node) ? '独立演出' : line && node?.kind === "passage"
        ? "对白与演出"
        : node
          ? nodeNames[node.kind]
          : "属性";
  if (resource)
    title = { asset: "素材属性", character: "角色属性", variable: "状态属性" }[
      resource.kind
    ];
  if (projectSettings) title = "作品设置";
  return (
    <aside className={view === "ui" && !projectSettings ? "inspector ui-inspector-shell" : "inspector"}>
      {(view !== "ui" || projectSettings) && <div className="panel-heading">
        <Settings2 size={15} />
        <h2>{title}</h2>
        <div className="spacer" />
        {(projectSettings || node?.kind === 'passage' && !!line) && <IconButton title="管理效果" onClick={() => setEffectsOpen(true)}><Sparkles size={15} /></IconButton>}
      </div>}
      <div className="inspector-scroll">
        {projectSettings ? (
          <>
            <Field label="作品名称">
              <input
                value={project.name}
                onChange={(e) =>
                  commit("作品名称", (p) => {
                    p.name = e.target.value;
                  })
                }
              />
            </Field>
            <Field label="版本">
              <input
                value={project.version}
                onChange={(e) =>
                  commit("作品版本", (p) => {
                    p.version = e.target.value;
                  })
                }
              />
            </Field>
            <div className="field-row">
              <Field label="画面宽度">
                <NumberInput
                  type="number"
                  
                  
                  value={project.width}
                  onChange={(e) =>
                    commit("画面尺寸", (p) => {
                      p.width = Number(e.target.value);
                    })
                  }
                />
              </Field>
              <Field label="画面高度">
                <NumberInput
                  type="number"
                  
                  
                  value={project.height}
                  onChange={(e) =>
                    commit("画面尺寸", (p) => {
                      p.height = Number(e.target.value);
                    })
                  }
                />
              </Field>
            </div>
            <Field label="故事入口">
              <TargetSelect
                project={project}
                value={project.entryId}
                onChange={(value) => {
                  if (value)
                    commit("故事入口", (p) => {
                      p.entryId = value;
                    });
                }}
              />
            </Field>
          </>
        ) : resource ? (
          <ResourceInspector
            project={project}
            selection={resource}
            commit={commit}
            assetUrl={assetUrl}
            selectResource={selectResource}
          />
        ) : view === "ui" ? (
          <ThemeInspector selectUi={selectUi} project={project} id={uiId} selectionRequest={uiSelectionRequest} commit={commit} assetUrl={assetUrl} />
        ) : node ? (
          <>
            <Field label="名称">
              <input
                value={node.name}
                onChange={(e) =>
                  editNode(`节点名称 ${node.id}`, (n) => {
                    n.name = e.target.value;
                  })
                }
              />
            </Field>
            {node.kind !== 'start' && <Field label="所属小章节">
              <select
                value={node.sceneId}
                onChange={(e) =>
                  editNode("移动至场景", (n) => {
                    n.sceneId = e.target.value;
                  })
                }
              >
                {project.scenes.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </Field>}
            {node.kind === "passage" && line && (
              <>
                {line.silent && <PerformancePlaybackFields project={project} line={line} onChange={playback => editNode('独立演出播放设置', n => { if (n.kind === 'passage') n.lines.find(l => l.id === line.id)!.playback = playback; })} />}
                <div className="inspector-section-title">当前对白</div>
                <Field label="说话人">
                  <select
                    value={line.speakerId ?? ""}
                    onChange={(e) =>
                      editNode(`说话人 ${line.id}`, (n) => {
                        if (n.kind === "passage")
                          n.lines.find((l) => l.id === line.id)!.speakerId =
                            e.target.value || undefined;
                      })
                    }
                  >
                    <option value="">旁白</option>
                    {project.characters.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="配音">
                  <AssetSelect
                    project={project}
                    kind="audio"
                    category="voice"
                    label="配音素材"
                    assetUrl={assetUrl}
                    value={line.voiceId}
                    onChange={(value) =>
                      editNode("设置配音", (n) => {
                        if (n.kind === "passage")
                          n.lines.find((l) => l.id === line.id)!.voiceId =
                            value;
                      })
                    }
                  />
                </Field>
                {line.voiceId && (
                  <audio controls preload="none" src={assetUrl(line.voiceId)} />
                )}
                <div className="inspector-section-title">
                  本行演出 <span>{line.actions.length}</span>
                </div>
                {line.actions.map((action, i) => (
                  <div className="action-editor" key={`${line.id}-${i}`}>
                    <div className="action-editor-header">
                      <strong>{actionNames[action.kind]}</strong>
                      <div className="spacer" />
                      <IconButton
                        title="动作上移"
                        disabled={i === 0}
                        onClick={() =>
                          editNode("移动动作", (n) => {
                            if (n.kind === "passage") {
                              const a = n.lines.find(
                                (l) => l.id === line.id,
                              )!.actions;
                              [a[i - 1], a[i]] = [a[i], a[i - 1]];
                            }
                          })
                        }
                      >
                        <ArrowUp size={13} />
                      </IconButton>
                      <IconButton
                        title="动作下移"
                        disabled={i === line.actions.length - 1}
                        onClick={() =>
                          editNode("移动动作", (n) => {
                            if (n.kind === "passage") {
                              const a = n.lines.find(
                                (l) => l.id === line.id,
                              )!.actions;
                              [a[i + 1], a[i]] = [a[i], a[i + 1]];
                            }
                          })
                        }
                      >
                        <ArrowDown size={13} />
                      </IconButton>
                      <IconButton
                        title="删除动作"
                        onClick={() =>
                          editNode("删除动作", (n) => {
                            if (n.kind === "passage")
                              n.lines
                                .find((l) => l.id === line.id)!
                                .actions.splice(i, 1);
                          })
                        }
                      >
                        <Trash2 size={13} />
                      </IconButton>
                    </div>
                    <ActionEditor
                      project={project}
                      action={action}
                      onChange={(next) =>
                        editNode(`编辑动作 ${line.id} ${i}`, (n) => {
                          if (n.kind === "passage")
                            n.lines.find((l) => l.id === line.id)!.actions[i] =
                              next;
                        })
                      }
                    />
                  </div>
                ))}
                <select
                  aria-label="添加演出动作"
                  value=""
                  onChange={(e) => {
                    const action = newAction(
                      e.target.value as StageAction["kind"],
                      project,
                    );
                    if (action)
                      editNode("添加演出", (n) => {
                        if (n.kind === "passage")
                          n.lines
                            .find((l) => l.id === line.id)!
                            .actions.push(action);
                      });
                  }}
                >
                  <option value="">添加演出动作</option>
                  {Object.entries(actionNames).filter(([kind]) => kind !== 'characterFeature').map(([kind, name]) => (
                    <option
                      key={kind}
                      value={kind}
                      disabled={
                        !newAction(kind as StageAction["kind"], project)
                      }
                    >
                      {name}
                    </option>
                  ))}
                </select>
                {effectDraft?.nodeId === node.id && effectDraft.lineId === line.id ? (
                  <div className="action-editor">
                    <Field label="新效果名称"><input autoFocus maxLength={120} value={effectDraft.name} onChange={event => setEffectDraft({ ...effectDraft, name: event.target.value })} /></Field>
                    <label className="check-field"><input type="checkbox" checked={effectDraft.replace} onChange={event => setEffectDraft({ ...effectDraft, replace: event.target.checked })} />本行动作替换为效果调用</label>
                    <div className="inspector-footer-actions">
                      <button className="small-button" disabled={!effectDraft.name.trim() || effects.some(effect => effect.name === effectDraft.name.trim()) || !line.actions.length} onClick={() => {
                        const id = makeId("effect");
                        commit("保存为效果", changed => {
                          const source = findLine(changed, effectDraft.nodeId, effectDraft.lineId);
                          if (!source?.actions.length) return;
                          (changed.effects ??= []).push({ id, name: effectDraft.name.trim(), commands: [], actions: structuredClone(source.actions) });
                          if (effectDraft.replace) source.actions = [{ kind: "effect", effectId: id }];
                        });
                        setEffectDraft(undefined);
                      }}><Save size={14} />保存效果</button>
                      <button className="small-button" onClick={() => setEffectDraft(undefined)}>取消</button>
                    </div>
                    {effects.some(effect => effect.name === effectDraft.name.trim()) && <span role="alert" className="danger-text">效果名称已存在</span>}
                  </div>
                ) : <button className="text-button" disabled={!line.actions.length} onClick={() => {
                  const base = '演出效果';
                  let name = base;
                  for (let index = 2; effects.some(effect => effect.name === name); index += 1) name = `${base} ${index}`;
                  setEffectDraft({ nodeId: node.id, lineId: line.id, name, replace: true });
                }}><Save size={14} />保存为效果</button>}
              </>
            )}
            {node.kind !== 'start' && <SceneInstanceEditor project={project} sceneId={node.sceneId} commit={commit} selectNode={selectNode} />}
            {node.kind === "jump" && (
              <SceneTransitionEditor project={project} node={node} onChange={(transition) => editNode("场景转场", (changed) => { if (changed.kind === "jump") changed.sceneTransition = transition; })} onTarget={target => editNode("转场目标", changed => { if (changed.kind === "jump") { changed.target = target; changed.sceneTransition = { ...(changed.sceneTransition ?? { mode: 'none', duration: 0, color: '#000000' }), fromSceneId: changed.sceneId, toSceneId: project.nodes.find(item => item.id === target)?.sceneId }; } })} />
            )}
            {node.kind === "choice" && (
              <>
                <Field label="选择提示">
                  <textarea
                    rows={2}
                    value={node.prompt}
                    onChange={(e) =>
                      editNode("选择提示", (n) => {
                        if (n.kind === "choice") n.prompt = e.target.value;
                      })
                    }
                  />
                </Field>
                {node.choices.map((choice, i) => (
                  <div className="choice-editor" key={choice.id}>
                    <div className="action-editor-header">
                      <strong>选项 {i + 1}</strong>
                      <div className="spacer" />
                      <IconButton
                        title="删除选项"
                        onClick={() =>
                          editNode("删除选项", (n) => {
                            if (n.kind === "choice") n.choices.splice(i, 1);
                          })
                        }
                      >
                        <Trash2 size={14} />
                      </IconButton>
                    </div>
                    <Field label="文字">
                      <input
                        value={choice.text}
                        onChange={(e) =>
                          editNode(`选项文字 ${choice.id}`, (n) => {
                            if (n.kind === "choice")
                              n.choices[i].text = e.target.value;
                          })
                        }
                      />
                    </Field>
                    <Field label="前往">
                      <TargetSelect
                        project={project}
                        value={choice.target}
                        onChange={(value) =>
                          editNode("选项连接", (n) => {
                            if (n.kind === "choice")
                              n.choices[i].target = value;
                          })
                        }
                      />
                    </Field>
                    <label className="check-field">
                      <input
                        type="checkbox"
                        checked={!!choice.condition}
                        onChange={(e) =>
                          editNode("选项条件", (n) => {
                            if (n.kind === "choice")
                              n.choices[i].condition = e.target.checked
                                ? { kind: "all", conditions: [] }
                                : undefined;
                          })
                        }
                      />
                      满足条件时显示
                    </label>
                    {choice.condition && (
                      <ConditionEditor
                        project={project}
                        condition={choice.condition}
                        onChange={(condition) =>
                          editNode("选项条件", (n) => {
                            if (n.kind === "choice")
                              n.choices[i].condition = condition;
                          })
                        }
                      />
                    )}
                  </div>
                ))}
                <button
                  className="text-button"
                  onClick={() =>
                    editNode("添加选项", (n) => {
                      if (n.kind === "choice")
                        n.choices.push({
                          id: makeId("option"),
                          text: `选项 ${n.choices.length + 1}`,
                        });
                    })
                  }
                >
                  <Plus size={14} />
                  添加选项
                </button>
              </>
            )}
            {node.kind === "condition" && (
              <Field label="判断条件">
                <ConditionEditor
                  project={project}
                  condition={node.condition}
                  onChange={(condition) =>
                    editNode("判断条件", (n) => {
                      if (n.kind === "condition") n.condition = condition;
                    })
                  }
                />
              </Field>
            )}
            {node.kind === "interaction" && (
              <>
                <Field label="互动提示">
                  <textarea rows={2} value={node.prompt} onChange={event => editNode("互动提示", changed => { if (changed.kind === "interaction") changed.prompt = event.target.value; })} />
                </Field>
                <label className="check-field">
                  <input type="checkbox" checked={node.showHints} onChange={event => editNode("互动区域提示", changed => { if (changed.kind === "interaction") changed.showHints = event.target.checked; })} />
                  显示可点击区域
                </label>
                <NumberField label="超时秒数（0 为不限时）" value={node.timeoutSeconds} min={0} max={3600} step={0.1} onChange={value => editNode("互动超时", changed => { if (changed.kind === "interaction") changed.timeoutSeconds = value; })} />
                <div className="inspector-section-title">互动区域 <span>{node.hotspots.length} / 64</span></div>
                {node.hotspots.map((hotspot, index) => {
                  const editHotspot = (label: string, edit: (value: typeof hotspot) => void) => editNode(label, changed => {
                    if (changed.kind === "interaction") {
                      const value = changed.hotspots.find(item => item.id === hotspot.id);
                      if (value) edit(value);
                    }
                  });
                  return (
                    <div className="choice-editor" key={hotspot.id}>
                      <div className="action-editor-header">
                        <strong>区域 {index + 1}</strong><div className="spacer" />
                        <IconButton title="删除互动区域" disabled={node.hotspots.length <= 1} onClick={() => editNode("删除互动区域", changed => { if (changed.kind === "interaction") changed.hotspots = changed.hotspots.filter(item => item.id !== hotspot.id); })}><Trash2 size={14} /></IconButton>
                      </div>
                      <Field label="区域名称"><input value={hotspot.name} onChange={event => editHotspot(`区域名称 ${hotspot.id}`, value => { value.name = event.target.value; })} /></Field>
                      <Field label="关联角色">
                        <select value={hotspot.characterId ?? ""} onChange={event => editHotspot("互动角色", value => { value.characterId = event.target.value || undefined; })}>
                          <option value="">场景区域</option>
                          {project.characters.map(character => <option key={character.id} value={character.id}>{character.name}</option>)}
                        </select>
                      </Field>
                      <div className="field-row">
                        <NumberField label="左侧位置 %" value={hotspot.x * 100} min={0} max={(1 - hotspot.width) * 100} onChange={value => editHotspot("互动区域位置", changed => { changed.x = value / 100; })} />
                        <NumberField label="顶部位置 %" value={hotspot.y * 100} min={0} max={(1 - hotspot.height) * 100} onChange={value => editHotspot("互动区域位置", changed => { changed.y = value / 100; })} />
                      </div>
                      <div className="field-row">
                        <NumberField label="区域宽度 %" value={hotspot.width * 100} min={1} max={(1 - hotspot.x) * 100} onChange={value => editHotspot("互动区域尺寸", changed => { changed.width = value / 100; })} />
                        <NumberField label="区域高度 %" value={hotspot.height * 100} min={1} max={(1 - hotspot.y) * 100} onChange={value => editHotspot("互动区域尺寸", changed => { changed.height = value / 100; })} />
                      </div>
                      <Field label="点击后前往"><TargetSelect label="点击后前往" project={project} value={hotspot.target} onChange={value => editHotspot("互动区域连接", changed => { changed.target = value; })} /></Field>
                      <label className="check-field">
                        <input type="checkbox" checked={!!hotspot.condition} onChange={event => editHotspot("互动区域条件", value => { value.condition = event.target.checked ? { kind: "all", conditions: [] } : undefined; })} />
                        满足条件时显示
                      </label>
                      {hotspot.condition && <ConditionEditor project={project} condition={hotspot.condition} onChange={condition => editHotspot("互动区域条件", value => { value.condition = condition; })} />}
                    </div>
                  );
                })}
                <button className="text-button" disabled={node.hotspots.length >= 64} onClick={() => editNode("添加互动区域", changed => { if (changed.kind === "interaction") changed.hotspots.push({ id: makeId("hotspot"), name: `互动区域 ${changed.hotspots.length + 1}`, x: 0.35, y: 0.3, width: 0.3, height: 0.4 }); })}><Plus size={14} />添加互动区域</button>
              </>
            )}
            {node.kind === "minigame" && (
              <>
                <Field label="小游戏类型">
                  <select value={node.template} onChange={event => editNode("小游戏类型", changed => { if (changed.kind === "minigame") changed.template = event.target.value as typeof node.template; })}>
                    <option value="custom">自定义小游戏</option><option value="password">密码锁示例</option><option value="timedClicks">限时点击示例</option>
                  </select>
                </Field>
                <Field label="小游戏标题"><input value={node.title} onChange={event => editNode("小游戏标题", changed => { if (changed.kind === "minigame") changed.title = event.target.value; })} /></Field>
                <Field label="小游戏提示"><textarea rows={2} value={node.prompt} onChange={event => editNode("小游戏提示", changed => { if (changed.kind === "minigame") changed.prompt = event.target.value; })} /></Field>
                {node.template === "custom" ? <>
                  <Field label="小游戏定义">
                    <select value={node.minigameId ?? ""} onChange={event => editNode("小游戏定义", changed => { if (changed.kind === "minigame") changed.minigameId = event.target.value || undefined; })}>
                      <option value="">请选择小游戏定义</option>
                      {(project.minigames ?? []).map(game => <option key={game.id} value={game.id}>{game.name}</option>)}
                    </select>
                  </Field>
                  <p className="muted">界面由“界面 → 自定义页面”编辑，玩法由小游戏蓝图或外接 Ren'Py 脚本实现。</p>
                </> : node.template === "password" ? <>
                  <Field label="正确密码"><input value={node.password} maxLength={128} onChange={event => editNode("小游戏密码", changed => { if (changed.kind === "minigame") changed.password = event.target.value; })} /></Field>
                  <NumberField label="允许尝试次数" value={node.attempts} min={1} max={20} onChange={value => editNode("密码尝试次数", changed => { if (changed.kind === "minigame") changed.attempts = value; })} />
                  <label className="check-field"><input type="checkbox" checked={node.caseSensitive} onChange={event => editNode("密码大小写", changed => { if (changed.kind === "minigame") changed.caseSensitive = event.target.checked; })} />区分大小写</label>
                </> : <>
                  <NumberField label="目标点击次数" value={node.targetClicks} min={1} max={999} onChange={value => editNode("点击目标", changed => { if (changed.kind === "minigame") changed.targetClicks = value; })} />
                  <NumberField label="限时秒数" value={node.timeLimit} min={1} max={600} onChange={value => editNode("点击限时", changed => { if (changed.kind === "minigame") changed.timeLimit = value; })} />
                </>}
              </>
            )}

            {node.kind === "set" && (
              <>
                <label className="check-field"><input aria-label="条件成立时才修改参数" type="checkbox" checked={!!node.when} disabled={!project.variables.length} onChange={event => editNode('参数修改条件', current => { if (current.kind === 'set') current.when = event.target.checked ? { kind: 'compare', variableId: current.variableId, operator: 'lt', value: current.value } : undefined; })} />条件成立时才修改</label>
                {node.when && <ConditionEditor project={project} condition={node.when} onChange={condition => editNode('参数修改条件', current => { if (current.kind === 'set') current.when = condition; })} />}
                <Field label="状态">
                  <select
                    value={node.variableId}
                    onChange={(e) =>
                      editNode("选择状态", (n) => {
                        if (n.kind === "set") {
                          n.variableId = e.target.value;
                          n.operation = "set";
                          n.value =
                            project.variables.find(
                              (v) => v.id === e.target.value,
                            )?.initial ?? 0;
                        }
                      })
                    }
                  >
                    <option value="missing">选择状态</option>
                    {project.variables.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="操作">
                  <select
                    value={node.operation}
                    onChange={(e) =>
                      editNode("状态操作", (n) => {
                        if (n.kind === "set")
                          n.operation = e.target.value as "set" | "add";
                      })
                    }
                  >
                    <option value="set">设为</option>
                    <option
                      value="add"
                      disabled={
                        project.variables.find((v) => v.id === node.variableId)
                          ?.type !== "number"
                      }
                    >
                      增加
                    </option>
                  </select>
                </Field>
                <Field label="值">
                  <ValueInput
                    variable={project.variables.find(
                      (v) => v.id === node.variableId,
                    )}
                    value={node.value}
                    onChange={(value) =>
                      editNode("状态值", (n) => {
                        if (n.kind === "set") n.value = value;
                      })
                    }
                  />
                </Field>
              </>
            )}
            {node.kind !== "choice" &&
              targets(node).filter(port => node.kind !== "interaction" || port.port === "timeout" || port.port === "cancel").map((port) => (
                <Field
                  key={port.port}
                  label={connectionName(port.port)}
                >
                  <TargetSelect
                    project={project}
                    value={port.target}
                    label={connectionName(port.port)}
                    onChange={(value) =>
                      commit("修改连接", (p) => {
                        p.nodes = p.nodes.map((n) =>
                          n.id === node.id
                            ? connectNode(n, port.port, value)
                            : n,
                        );
                      })
                    }
                  />
                </Field>
              ))}
            {node.kind !== 'start' && <div className="inspector-footer-actions">
              <button
                className="small-button"
                onClick={() => {
                  const id = makeId();
                  commit("复制节点", (p) => {
                    const clone = structuredClone(node);
                    clone.id = id;
                    clone.name += " 副本";
                    clone.x += 50;
                    clone.y += 80;
                    if (clone.kind === "passage")
                      clone.lines.forEach((l) => {
                        l.id = makeId("line");
                      });
                    if (clone.kind === "choice")
                      clone.choices.forEach((c) => {
                        c.id = makeId("option");
                      });
                    if (clone.kind === "interaction")
                      clone.hotspots.forEach((hotspot) => {
                        hotspot.id = makeId("hotspot");
                      });
                    p.nodes.push(clone);
                  });
                  selectNode(id);
                }}
              >
                <Copy size={14} />
                复制
              </button>
              <button
                className="danger-text small-button"
                disabled={node.id === project.entryId}
                onClick={() =>
                  commit("删除节点", (p) => removeNodes(p, [node.id]))
                }
              >
                <Trash2 size={14} />
                删除
              </button>
            </div>}
          </>
        ) : (
          <Empty title="未选择内容" />
        )}
      </div>
      {effectsOpen && <EffectManager project={project} commit={commit} onClose={() => setEffectsOpen(false)} />}
    </aside>
  );
}

function SceneInstanceEditor({ project, sceneId, commit, selectNode }: { project: Project; sceneId: string; commit: Commit; selectNode: (id: string) => void }) {
  const scene = project.scenes.find(item => item.id === sceneId);
  if (!scene) return null;
  const effective = effectiveScene(project, sceneId)!;
  const base = scene.baseSceneId ? effectiveScene(project, scene.baseSceneId) : undefined;
  const actions = effective.entryActions ?? [];
  const edit = (label: string, change: (scene: Scene) => void) => commit(label, project => { const scene = project.scenes.find(item => item.id === sceneId); if (scene) change(scene); });
  const editActions = (change: (actions: StageAction[]) => void) => edit('场景入场演出', scene => { scene.entryActions ??= structuredClone(actions); change(scene.entryActions); });
  return <details className="scene-instance-editor">
    <summary>场景实例 · {scene.name}</summary>
    <Field label="基础场景"><select value={scene.baseSceneId ?? ''} onChange={event => edit('场景继承', scene => { scene.baseSceneId = event.target.value || undefined; })}><option value="">无，独立场景</option>{project.scenes.filter(item => !inheritanceReaches(project.scenes, item.id, sceneId, scene => scene.baseSceneId)).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
    <Field label="场景蓝图"><select value={scene.blueprintId ?? ''} onChange={event => edit('场景蓝图', scene => { scene.blueprintId = event.target.value || undefined; })}><option value="">不绑定</option>{blueprintResources(project).map(graph => <option key={graph.id} value={graph.id}>{graph.name}</option>)}</select></Field>
    <button className="text-button" onClick={() => {
      const id = makeId('scene');
      const passage = newNode('passage', id);
      const ending = newNode('end', id);
      if (passage.kind === 'passage') passage.next = ending.id;
      ending.x = passage.x + 300;
      commit('派生场景实例', project => { project.scenes.push({ id, name: `${scene.name} 实例`, chapterId: scene.chapterId, baseSceneId: scene.id }); project.nodes.push(passage, ending); });
      selectNode(passage.id);
    }}><Copy size={14} />派生场景实例</button>
    <div className="inspector-section-title">入场演出 <span>{actions.length} / 64</span></div>
    {scene.baseSceneId && <button className="text-button" disabled={scene.entryActions === undefined} onClick={() => edit('恢复场景演出继承', scene => { scene.entryActions = undefined; })}><RefreshCw size={14} />恢复基础演出</button>}
    {actions.map((action, index) => <div className="action-editor" key={index}><div className="action-editor-header"><strong>{actionNames[action.kind]}</strong><div className="spacer" /><IconButton title="入场动作上移" disabled={!index} onClick={() => editActions(actions => { [actions[index - 1], actions[index]] = [actions[index], actions[index - 1]]; })}><ArrowUp size={13} /></IconButton><IconButton title="入场动作下移" disabled={index === actions.length - 1} onClick={() => editActions(actions => { [actions[index + 1], actions[index]] = [actions[index], actions[index + 1]]; })}><ArrowDown size={13} /></IconButton><IconButton title="删除入场动作" onClick={() => editActions(actions => { actions.splice(index, 1); })}><Trash2 size={13} /></IconButton></div><ActionEditor project={project} action={action} onChange={next => editActions(actions => { actions[index] = next; })} /></div>)}
    <select aria-label="添加场景入场动作" value="" disabled={actions.length >= 64} onChange={event => { const action = newAction(event.target.value as StageAction['kind'], project); if (action) editActions(actions => { actions.push(action); }); }}><option value="">添加入场动作</option>{Object.entries(actionNames).filter(([kind]) => kind !== 'characterFeature').map(([kind, name]) => <option key={kind} value={kind} disabled={!newAction(kind as StageAction['kind'], project)}>{name}</option>)}</select>
    <div className="inspector-section-title">实例参数</div>
    <ParameterEditor value={scene.parameters} inherited={base?.parameters} onChange={parameters => edit('场景实例参数', scene => { scene.parameters = parameters; })} />
  </details>;
}

function SceneTransitionEditor({ project, node, onChange, onTarget }: { project: Project; node: Extract<StoryNode, { kind: "jump" }>; onChange: (transition: SceneTransition | undefined) => void; onTarget: (target: string) => void }) {
  const transition = node.sceneTransition ?? { mode: "none", duration: 0, color: "#000000" } satisfies SceneTransition;
  const targetNode = project.nodes.find(item => item.id === node.target);
  const setTransition = (next: SceneTransition) => onChange({ ...next, fromSceneId: node.sceneId, toSceneId: targetNode?.sceneId });
  const sceneEntry = (id: string) => project.nodes.find(item => item.sceneId === id && item.kind === 'start') ?? project.nodes.find(item => item.sceneId === id);
  return <div className="action-editor">
    <div className="inspector-section-title">场景切换</div>
    <Field label="源场景"><span>{project.scenes.find(item => item.id === node.sceneId)?.name}</span></Field>
    <Field label="目标场景"><select value={targetNode?.sceneId ?? ''} onChange={event => { const entry = sceneEntry(event.target.value); if (entry) onTarget(entry.id); }}><option value="" disabled>选择目标场景</option>{project.scenes.map(scene => <option key={scene.id} value={scene.id} disabled={!sceneEntry(scene.id)}>{scene.name}</option>)}</select></Field>
    <Field label="切换方式"><select value={transition.mode} onChange={event => {
      const mode = event.target.value as SceneTransition["mode"];
      setTransition({ ...transition, mode, duration: mode === 'none' ? 0 : transition.duration || 0.5 });
    }}><option value="none">无，直接切换</option><option value="dissolve">溶解</option><option value="fade">淡入淡出</option></select></Field>
    {transition.mode !== "none" && <>
      <Field label="转场总时长 秒"><NumberInput type="number"   step="0.1" value={transition.duration} onChange={event => setTransition({ ...transition, duration: Number(event.target.value) })} /></Field>
      <Field label="颜色"><input type="color" value={transition.color} onChange={event => setTransition({ ...transition, color: event.target.value })} /></Field>
    </>}
    <div className="inspector-section-title">传入参数</div><ParameterEditor value={transition.parameters} onChange={parameters => setTransition({ ...transition, parameters })} />
    <button className="text-button" onClick={() => onChange(undefined)}>清除场景转场</button>
  </div>;
}

type EffectRow = { key: string; action?: StageAction; command?: string };
type EffectEdit = { id: string; name: string; rows: EffectRow[]; original: string };
const effectSignature = (name: string, rows: EffectRow[]) => JSON.stringify([name, rows.map(row => row.action ?? row.command)]);
function effectEdit(project: Project, effect: EffectDefinition): EffectEdit {
  const rows = [
    ...(effect.actions ?? []).map(action => ({ key: makeId("row"), action: structuredClone(action) })),
    ...effect.commands.map(command => ({ key: makeId("row"), action: textCommandAction(project, command), command })),
  ];
  return { id: effect.id, name: effect.name, rows, original: effectSignature(effect.name, rows) };
}
function effectCalls(project: Project, effect: EffectDefinition): string[] {
  return [...(effect.actions ?? []), ...effect.commands.map(command => textCommandAction(project, command))]
    .flatMap(action => action?.kind === "effect" ? [action.effectId] : []);
}
function effectReaches(project: Project, from: string, target: string, visited = new Set<string>()): boolean {
  if (from === target) return true;
  if (visited.has(from)) return false;
  const effect = project.effects.find(item => item.id === from);
  if (!effect) return false;
  const next = new Set(visited).add(from);
  return effectCalls(project, effect).some(id => effectReaches(project, id, target, next));
}
function effectReferences(project: Project, effectId: string): string[] {
  const references: string[] = [];
  for (const node of project.nodes) if (node.kind === "passage") {
    node.lines.forEach((line, index) => {
      if (line.actions.some(action => action.kind === "effect" && action.effectId === effectId)) {
        const scene = project.scenes.find(item => item.id === node.sceneId);
        references.push(`${scene?.name ?? "场景"} / ${node.name} / 第 ${index + 1} 行`);
      }
    });
  }
  for (const effect of project.effects) if (effect.id !== effectId && effectCalls(project, effect).includes(effectId)) references.push(`效果 / ${effect.name}`);
  return references;
}

export function EffectManager({ project, commit, onClose }: { project: Project; commit: Commit; onClose: () => void }) {
  const available = project.effects.filter(effect => !effect.id.startsWith("txt_performance_"));
  const [draft, setDraft] = useState<EffectEdit | undefined>(() => available[0] ? effectEdit(project, available[0]) : undefined);
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.querySelector<HTMLElement>("input, select, button")?.focus();
    return () => previous?.focus();
  }, []);
  const pendingText = useMemo(() => {
    if (!project.scriptText) return false;
    const parsed = applyTextScript(project, project.scriptText.content);
    return parsed.issues.some(issue => issue.severity === "error") || projectToText(parsed.project) !== projectToText(project);
  }, [project]);
  const existing = project.effects.find(effect => effect.id === draft?.id);
  const dirty = !!draft && (!existing || effectSignature(draft.name, draft.rows) !== draft.original);
  const references = draft ? effectReferences(project, draft.id) : [];
  const actions = draft?.rows.flatMap(row => row.action ? [row.action] : []) ?? [];
  const candidate = draft ? { id: draft.id, name: draft.name.trim(), actions, commands: [] } : undefined;
  const choices: Project = draft ? { ...project, effects: available.filter(effect => !effectReaches(project, effect.id, draft.id)) } : project;
  const problem = pendingText ? "文本草稿尚未应用，暂不能修改共享效果。"
    : !draft ? ""
    : !draft.name.trim() ? "请输入效果名称。"
    : project.effects.some(effect => effect.id !== draft.id && effect.name === draft.name.trim()) ? "效果名称已存在。"
    : draft.rows.some(row => !row.action) ? "存在无法识别的动作，请修正或删除该动作。"
    : draft.rows.length > 64 ? "一个效果最多包含 64 个动作。"
    : !effectDefinitionSchema.safeParse(candidate).success ? "效果名称或动作参数无效。"
    : actions.some(action => action.kind === "effect" && effectReaches(project, action.effectId, draft.id)) ? "效果不能直接或间接调用自身。" : "";
  const leave = (next: () => void) => { if (!dirty || confirm("放弃尚未保存的效果修改？")) next(); };
  const editRow = (index: number, row: Partial<EffectRow>) => setDraft(current => current && ({ ...current, rows: current.rows.map((item, i) => i === index ? { ...item, ...row } : item) }));
  const moveRow = (index: number, direction: number) => setDraft(current => {
    if (!current) return current;
    const rows = [...current.rows];
    [rows[index], rows[index + direction]] = [rows[index + direction], rows[index]];
    return { ...current, rows };
  });
  return createPortal(<div className="modal-backdrop" onKeyDown={event => {
    event.stopPropagation();
    if (event.key === "Escape" && !event.nativeEvent.isComposing) { event.preventDefault(); leave(onClose); }
    if (event.key === "Tab") {
      const controls = [...(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]') ?? [])];
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  }}><div ref={dialog} role="dialog" aria-modal="true" aria-labelledby="effect-manager-title" className="dialog effect-manager">
    <div className="dialog-header"><h2 id="effect-manager-title">管理效果</h2><IconButton title="关闭效果管理" onClick={() => leave(onClose)}><X size={18} /></IconButton></div>
    <div className="effect-manager-body">
    <div className="effect-manager-picker">
      <Field label="选择效果"><select value={draft?.id ?? ""} onChange={event => leave(() => { const selected = available.find(effect => effect.id === event.target.value); setDraft(selected ? effectEdit(project, selected) : undefined); })}>
        {!draft && <option value="">尚无效果</option>}{draft && !existing && <option value={draft.id}>{draft.name || "新效果"}</option>}
        {available.map(effect => <option key={effect.id} value={effect.id}>{effect.name}</option>)}
      </select></Field>
      <IconButton title="新建效果" disabled={pendingText} onClick={() => leave(() => {
        let name = "新效果";
        for (let i = 2; project.effects.some(effect => effect.name === name); i++) name = `新效果 ${i}`;
        setDraft({ id: makeId("effect"), name, rows: [], original: "" });
      })}><Plus size={16} /></IconButton>
    </div>
    {draft ? <>
      <Field label="效果名称"><input maxLength={120} value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} /></Field>
      <div className="inspector-section-title">效果动作 <span>{draft.rows.length}</span></div>
      {draft.rows.map((row, index) => <div className="action-editor" key={row.key}>
        <div className="action-editor-header"><strong>{index + 1}. {row.action ? actionNames[row.action.kind] : "未识别动作"}</strong><div className="spacer" />
          <IconButton title="效果动作上移" disabled={index === 0} onClick={() => moveRow(index, -1)}><ArrowUp size={13} /></IconButton>
          <IconButton title="效果动作下移" disabled={index === draft.rows.length - 1} onClick={() => moveRow(index, 1)}><ArrowDown size={13} /></IconButton>
          <IconButton title="删除效果动作" onClick={() => setDraft({ ...draft, rows: draft.rows.filter((_, i) => i !== index) })}><Trash2 size={13} /></IconButton>
        </div>
        {row.action ? <ActionEditor project={choices} action={row.action} onChange={action => editRow(index, { action })} />
          : <Field label="原始指令"><input value={row.command ?? ""} onChange={event => editRow(index, { command: event.target.value, action: textCommandAction(project, event.target.value) })} /></Field>}
      </div>)}
      <select aria-label="添加效果动作" value="" disabled={draft.rows.length >= 64} onChange={event => {
        const action = newAction(event.target.value as StageAction["kind"], choices);
        if (action) setDraft({ ...draft, rows: [...draft.rows, { key: makeId("row"), action }] });
      }}><option value="">添加效果动作</option>{Object.entries(actionNames).filter(([kind]) => kind !== 'characterFeature').map(([kind, name]) => <option key={kind} value={kind} disabled={!newAction(kind as StageAction["kind"], choices)}>{name}</option>)}</select>
      <div className="effect-manager-references"><strong>调用位置 · {references.length}</strong>{references.length > 0 && <ul>{references.map((reference, index) => <li key={index}>{reference}</li>)}</ul>}</div>
    </> : <Empty title="尚无可复用效果" />}
    {problem && <p role="alert" className="danger-text">{problem}</p>}
    </div>
    <div className="dialog-actions">
      <button className="danger-text small-button" disabled={!existing || references.length > 0 || pendingText} title={references.length ? "仍有调用，不能删除" : "删除未被调用的效果"} onClick={() => {
        if (!existing || effectReferences(project, existing.id).length || pendingText || !confirm(`删除效果“${existing.name}”？`)) return;
        commit("删除共享效果", changed => { if (!effectReferences(changed, existing.id).length) changed.effects = changed.effects.filter(effect => effect.id !== existing.id); });
        const next = available.find(effect => effect.id !== existing.id);
        setDraft(next ? effectEdit(project, next) : undefined);
      }}><Trash2 size={14} />删除效果</button>
      <div className="spacer" />
      <button className="small-button" onClick={() => leave(onClose)}>取消</button>
      <button className="primary" disabled={!draft || !dirty || !!problem} onClick={() => {
        if (!draft || !candidate || problem) return;
        commit(existing ? "修改共享效果" : "新建共享效果", changed => {
          for (const effect of changed.effects) effect.commands = effect.commands.map(command => {
            const action = textCommandAction(changed, command);
            return action?.kind === "effect" && action.effectId === candidate.id ? `@效果：${textReference(candidate.name, candidate.id)}` : command;
          });
          const index = changed.effects.findIndex(effect => effect.id === candidate.id);
          if (index >= 0) changed.effects[index] = structuredClone(candidate);
          else changed.effects.push(structuredClone(candidate));
        });
        onClose();
      }}><Save size={14} />保存修改</button>
    </div>
  </div></div>, document.body);
}

function connectionName(port: string) {
  return ({ yes: "满足时前往", no: "不满足时前往", target: "目标段落", success: "成功后前往", failure: "失败后前往", cancel: "取消后前往", timeout: "超时后前往" } as Record<string, string>)[port] ?? "接下来";
}

export function NumberField({ label, value, min, max, step = 1, onChange }: {
  label: string; value: number; min?: number; max?: number; step?: number; onChange: (value: number) => void;
}) {
  // Percentage conversions can introduce binary noise; format only the display.
  const displayed = Number.isFinite(value) ? Number(value.toPrecision(15)) : value;
  return <Field label={label}><NumberInput type="number" value={displayed} min={min} max={max} step={step} onChange={event => onChange(event.target.valueAsNumber)} /></Field>;
}

function AssetSelect({
  project,
  kind,
  value,
  onChange,
  category,
  assetUrl,
  label,
}: {
  project: Project;
  kind: Asset["kind"];
  value?: string;
  onChange: (id?: string) => void;
  category?: AssetCategory;
  assetUrl?: AssetUrl;
  label?: string;
}) {
  return <UiAssetSelect project={project} kind={kind} category={category} label={label} value={value} empty="无" onChange={onChange} assetUrl={assetUrl ?? (id => { const asset = project.assets.find(item => item.id === id); return asset ? (window.studio ?? browserBridge).assetUrl(asset.path) : undefined; })} />;
}

/** Return a local expression copy, creating an override for inherited data when needed. */
function ensureExpressionOverride(character: Character, expressionId: string, effective: Character | undefined) {
  const local = character.expressions.find(expression => expression.id === expressionId);
  if (local) return local;
  const inherited = effective?.expressions.find(expression => expression.id === expressionId);
  if (!inherited) return undefined;
  const copy = structuredClone(inherited);
  character.expressions.push(copy);
  return copy;
}

/** Return a local feature copy, creating an override for inherited data when needed. */
function ensureFeatureOverride(character: Character, featureId: string, effective: Character | undefined) {
  const local = (character.features ?? []).find(feature => feature.id === featureId);
  if (local) return local;
  if ((character.features?.length ?? 0) >= 64) return undefined;
  const inherited = effective?.features?.find(feature => feature.id === featureId);
  if (!inherited) return undefined;
  const copy = structuredClone(inherited);
  (character.features ??= []).push(copy);
  return copy;
}

function characterAncestors(project: Project, characterId: string) {
  const ids = new Set<string>();
  let current: string | undefined = characterId;
  while (current && !ids.has(current)) {
    ids.add(current);
    current = project.characters.find(character => character.id === current)?.baseCharacterId;
  }
  return ids;
}

export type CharacterSection = 'appearance' | 'staging' | 'transitions';

export function ResourceInspector({
  project,
  selection,
  commit,
  assetUrl,
  selectResource,
  characterSection,
}: {
  project: Project;
  selection: ResourceSelection;
  commit: Commit;
  assetUrl: AssetUrl;
  selectResource: (selection?: ResourceSelection) => void;
  characterSection?: CharacterSection;
}) {
  if (selection.kind === "asset") {
    const asset = project.assets.find((a) => a.id === selection.id);
    if (!asset) return <Empty title="素材不存在" />;
    return (
      <>
        {asset.kind === "image" ? (
          <div className="asset-inspector-preview">
            <img src={assetUrl(asset.id)} alt={asset.name} />
          </div>
        ) : asset.kind === 'spine' ? <SpineAssetPreview key={asset.id} asset={asset} /> : asset.kind === 'font' ? (
          <div className="asset-font-preview" style={{ fontFamily: uiFontFamily(asset.id) }}><UiFontFaces project={project} assetUrl={assetUrl} />春江潮水连海平<br />中文字体预览 Aa 123</div>
        ) : asset.kind === 'video' ? (
          <video className="asset-video-preview" controls preload="metadata" src={assetUrl(asset.id)} />
        ) : asset.kind === 'script' ? (
          <div className="asset-script-preview"><FileCode2 size={28} /><span>Ren'Py .rpy</span></div>
        ) : (
          <audio controls preload="none" src={assetUrl(asset.id)} />
        )}
        <Field label="名称">
          <input
            value={asset.name}
            onChange={(e) =>
              commit("素材名称", (p) => {
                p.assets.find((a) => a.id === asset.id)!.name = e.target.value;
              })
            }
          />
        </Field>
        <Field label="文件">
          <span className="path-value">{asset.path}</span>
        </Field>
        <Field label="类型">
          <span>{{ image: '图片', audio: '音频', video: '视频', font: '字体', spine: '骨骼动画', script: 'Ren\'Py 脚本' }[asset.kind]}</span>
        </Field>
        <Field label="素材分类"><select aria-label="素材分类" value={assetCategories(project).get(asset.id) ?? 'other'} onChange={event => commit('设置素材分类', draft => setAssetCategory(draft, [asset.id], event.target.value as AssetCategory))}>{(Object.entries(assetCategoryNames) as [AssetCategory, string][]).filter(([category]) => categoryAcceptsKind(category, asset.kind)).map(([category, name]) => <option key={category} value={category}>{name}</option>)}</select></Field>
        {asset.width && (
          <Field label="尺寸">
            <span>
              {asset.width} × {asset.height}
            </span>
          </Field>
        )}
        <button
          className="danger-text small-button"
          onClick={() => {
            if (
              confirm(
                `从工程中移除素材“${asset.name}”？文件会保留，引用处将显示问题。`,
              )
            ) {
              commit("删除素材", (p) => {
                p.assets = p.assets.filter((a) => a.id !== asset.id);
              });
              selectResource(undefined);
            }
          }}
        >
          <Trash2 size={14} />
          移除素材
        </button>
      </>
    );
  }
  if (selection.kind === "character") {
    const character = project.characters.find((c) => c.id === selection.id);
    if (!character) return <Empty title="角色不存在" />;
    const effective = effectiveCharacter(project, character.id) ?? character;
    const base = character.baseCharacterId ? effectiveCharacter(project, character.baseCharacterId) : undefined;
    const edit = (label: string, f: (c: Character) => void) =>
      commit(label, (p) => f(p.characters.find((c) => c.id === character.id)!));
    const editExpression = (label: string, expressionId: string, f: (expression: Character["expressions"][number]) => void) =>
      edit(label, c => { const item = ensureExpressionOverride(c, expressionId, effective); if (item) f(item); });
    const localExpressionIds = new Set(character.expressions.map(expression => expression.id));
    const inheritedExpressionIds = new Set((base?.expressions ?? []).map(expression => expression.id));
    return (
      <>
        {(!characterSection || characterSection === 'appearance') && <>
        <details className="character-inspector-section" open><summary>基本信息</summary>
        <div className="character-basic-fields">
        <Field label="角色名称">
          <input
            value={character.name}
            onChange={(e) =>
              edit("角色名称", (c) => {
                c.name = e.target.value;
              })
            }
          />
        </Field>
        <Field label="姓名颜色">
          <input
            type="color"
            value={character.color}
            onChange={(e) =>
              edit("角色颜色", (c) => {
                c.color = e.target.value;
              })
            }
          />
        </Field>
        <Field label="默认表情" hint="显示角色时使用；单句可以覆盖。"><select aria-label="角色默认表情" value={character.defaultExpressionId ?? ''} onChange={event => edit('角色默认表情', c => { c.defaultExpressionId = event.target.value || undefined; })}><option value="">使用第一个表情</option>{effective.expressions.map(expression => <option key={expression.id} value={expression.id}>{expression.name}</option>)}</select></Field>
        </div>
        </details>
        <details className="character-inspector-section" open><summary>立绘与表情 · {effective.expressions.length}</summary>
        <div className="character-expression-grid">
        {effective.expressions.map((expression) => (
          <div className="expression-editor" key={expression.id}>
            <img src={assetUrl(expression.assetId)} alt={expression.name} />
            <div>
              <input
                aria-label="表情名称"
                value={expression.name}
                onChange={(e) => editExpression("表情名称", expression.id, item => { item.name = e.target.value; })}
              />
              <AssetSelect
                project={project}
                kind="image"
                category="portrait"
                assetUrl={assetUrl}
                label="立绘素材"
                value={expression.assetId}
                onChange={(value) => editExpression("表情素材", expression.id, item => { item.assetId = value ?? "missing"; })}
              />
              <small className="muted">{localExpressionIds.has(expression.id) ? inheritedExpressionIds.has(expression.id) ? "本地覆盖" : "本地" : "继承自基础角色"}</small>
            </div>
            {localExpressionIds.has(expression.id) ? inheritedExpressionIds.has(expression.id)
              ? <IconButton title="恢复表情继承" onClick={() => edit("恢复表情继承", c => { c.expressions = c.expressions.filter(item => item.id !== expression.id); })}><RefreshCw size={13} /></IconButton>
              : <IconButton title="删除表情" onClick={() => edit("删除表情", c => { c.expressions = c.expressions.filter(item => item.id !== expression.id); })}><Trash2 size={13} /></IconButton>
              : <IconButton title="创建本地覆盖" onClick={() => editExpression("覆盖表情", expression.id, () => undefined)}><Copy size={13} /></IconButton>}
          </div>
        ))}</div>
        <button
          className="text-button"
          disabled={!categoryAssets(project, 'image', 'portrait').length}
          onClick={() =>
            edit("添加表情", (c) =>
              c.expressions.push({
                id: makeId("expression"),
                name: `表情 ${effective.expressions.length + 1}`,
                assetId: categoryAssets(project, 'image', 'portrait')[0].id,
              }),
            )
          }
        >
          <Plus size={14} />
          添加表情
        </button>
        </details></>}
        {(!characterSection || characterSection === 'staging') && <div className="character-staging-sections">
        <PortraitFraming project={project} character={character} assetUrl={assetUrl} onChange={value => edit("角色默认构图", c => { c.portraitFraming = value; })} />
        <CharacterPresets key={character.id} project={project} character={character} assetUrl={assetUrl} onChange={patch => edit("角色站位预设", c => { Object.assign(c, patch); })} />
        </div>}
        {(!characterSection || characterSection === 'transitions') && <section className="character-setting-card"><ActorTransitionFields label="角色默认过渡" defaults={{ ...actorTransitionDefaults(), ...effectiveCharacter(project, character.baseCharacterId ?? "")?.actorTransitions }} value={character.actorTransitions} onChange={value => edit('角色默认过渡', c => { c.actorTransitions = value; })} /></section>}
        <div className="inspector-footer-actions">
          <button
            className="danger-text small-button"
            onClick={() => {
              if (
                confirm(
                  `删除角色“${character.name}”？已有对白和演出引用需要重新指定。`,
                )
              ) {
                commit("删除角色", (p) => {
                  p.characters = p.characters.filter(
                    (c) => c.id !== character.id,
                  );
                });
                selectResource(undefined);
              }
            }}
          >
            <Trash2 size={14} />
            删除角色
          </button>
        </div>
      </>
    );
  }
  const variable = project.variables.find((v) => v.id === selection.id);
  if (!variable) return <Empty title="状态不存在" />;
  const edit = (label: string, f: (v: Variable) => void) =>
    commit(label, (p) => f(p.variables.find((v) => v.id === variable.id)!));
  return (
    <>
      <Field label="状态名称">
        <input
          value={variable.name}
          onChange={(e) =>
            edit("状态名称", (v) => {
              v.name = e.target.value;
            })
          }
        />
      </Field>
      <Field label="类型">
        <select
          value={variable.type}
          onChange={(e) =>
            edit("状态类型", (v) => {
              v.type = e.target.value as Variable["type"];
              v.initial =
                v.type === "boolean" ? false : v.type === "number" ? 0 : "";
            })
          }
        >
          <option value="number">数值</option>
          <option value="boolean">开关</option>
          <option value="string">文字</option>
        </select>
      </Field>
      <Field label="初始值">
        <ValueInput
          variable={variable}
          value={variable.initial}
          onChange={(value) =>
            edit("初始值", (v) => {
              v.initial = value;
            })
          }
        />
      </Field>
      <label className="check-field">
        <input
          type="checkbox"
          checked={variable.persistent}
          onChange={(e) =>
            edit("跨周目状态", (v) => {
              v.persistent = e.target.checked;
            })
          }
        />
        跨周目保留
      </label>
      <div className="inspector-footer-actions">
        <button
          className="danger-text small-button"
          onClick={() => {
            if (
              confirm(
                `删除状态“${variable.name}”？已有条件和修改状态节点需要重新指定。`,
              )
            ) {
              commit("删除状态", (p) => {
                p.variables = p.variables.filter((v) => v.id !== variable.id);
              });
              selectResource(undefined);
            }
          }}
        >
          <Trash2 size={14} />
          删除状态
        </button>
      </div>
    </>
  );
}

export function ActionEditor({
  project,
  action: authoredAction,
  entranceOffsets = true,
  hostCharacterId,
  speakerId,
  onChange,
  assetUrl,
}: {
  project: Project;
  action: StageAction;
  entranceOffsets?: boolean;
  hostCharacterId?: string;
  speakerId?: string;
  onChange: (action: StageAction) => void;
  assetUrl?: AssetUrl;
}) {
  if (authoredAction.kind === 'audioClip') return <TimelineAudioClipEditor project={project} clip={authoredAction} assetUrl={assetUrl} onChange={patch => onChange(applyAudioClipInputs({ ...authoredAction, ...patch }, {}))} />;
  if (authoredAction.kind === 'visual') return <VisualObjectEditor project={project} object={authoredAction} onChange={onChange} />;
  if (authoredAction.kind === 'hideVisual') return <><Field label="对象ID" hint="填写显示图片、视频或文字时使用的 ID。"><input value={authoredAction.instanceId} onChange={event => onChange({ ...authoredAction, instanceId: event.target.value })} /></Field><VisualTransitionField label="离场过渡" value={authoredAction.exitTransition} inherit onChange={exitTransition => onChange({ ...authoredAction, exitTransition })} /><Field label="等待离场结束"><input type="checkbox" checked={authoredAction.wait !== false} onChange={event => onChange({ ...authoredAction, wait: event.target.checked })} /></Field></>;
  if (authoredAction.kind === 'startDialogue') return <p className="muted">从此处开始本句文字和配音，继续执行后面的图片、角色和音效演出。同一句只触发一次；独立演出中没有台词时跳过。可在前面添加“等待”来设置开始时间。</p>;
  if (authoredAction.kind === 'hideInterface' || authoredAction.kind === 'showInterface') return <p className="muted">{authoredAction.kind === 'hideInterface' ? '隐藏对话框及快捷按钮，直到执行“显示界面”。' : '恢复对话框及快捷按钮，后续演出保持显示。'}</p>;
  if (authoredAction.kind === 'unlock') return <Field label="解锁素材"><select aria-label="解锁素材" value={authoredAction.assetId} onChange={event => onChange({ ...authoredAction, assetId: event.target.value })}>{project.assets.filter(asset => asset.kind === 'image' || asset.kind === 'audio').map(asset => <option key={asset.id} value={asset.id}>{asset.name}</option>)}</select></Field>;
  const bindsHost = hostCharacterId && (authoredAction.kind === "show" || authoredAction.kind === "hide" || authoredAction.kind === "animate" || authoredAction.kind === "characterFeature") && characterAncestors(project, hostCharacterId).has(authoredAction.characterId);
  const action: StageAction = bindsHost ? { ...authoredAction, characterId: hostCharacterId } : authoredAction;
  const showCharacterId = action.kind === "show" ? action.characterId || speakerId || "" : "";
  return (
    <>
      {"assetId" in action && (
        <Field label={action.kind === "background" ? "背景素材" : "音频素材"}>
          <AssetSelect
            project={project}
            kind={action.kind === "background" ? "image" : "audio"}
            category={action.kind === 'background' ? 'scene' : action.kind === 'music' ? 'bgm' : 'sound'}
            label={action.kind === 'background' ? '背景素材' : action.kind === 'music' ? 'BGM素材' : '音效素材'}
            value={action.assetId}
            assetUrl={assetUrl}
            onChange={(value) =>
              onChange({ ...action, assetId: value ?? "missing" })
            }
          />
        </Field>
      )}
      {(action.kind === "show" || action.kind === "hide" || action.kind === "animate") && (
        <Field label="角色">
          <select
            aria-label="显示角色目标"
            value={action.characterId}
            onChange={(e) => {
              const id = e.target.value;
              onChange(
                action.kind === "show"
                  ? {
                      ...action,
                      characterId: id,
                      expressionId:
                        "",
                    }
                  : { ...action, characterId: id },
              );
            }}
          >
            {action.kind === "show" && <option value="">当前台词角色（自动）</option>}
            {project.characters.map((c) => (
              <option key={c.id} value={c.id}>
                {c.id === hostCharacterId ? `当前角色：${c.name}` : c.name}
              </option>
            ))}
          </select>
        </Field>
      )}
      {(action.kind === "show" || action.kind === "hide" || action.kind === "animate") && <Field label="实例 ID"><ActorInstanceField project={project} characterId={action.characterId} value={action.instanceId} onChange={instanceId => onChange({ ...action, instanceId })} /></Field>}
      {action.kind === "show" && <>
        <Field label="显示范围"><ActorLifetimeSelect value={action.lifetime} onChange={lifetime => onChange({ ...action, lifetime })} /></Field>
        <p className="muted">{action.lifetime === 'line' ? '台词推进后自动隐藏。' : action.lifetime === 'persistent' ? '持续保留到隐藏此实例；换背景和自动发言演出不会清除它。' : '保留原指令行为，可切换为仅本句或持续显示。'} 同一 ID 更新同一实例，不同 ID 可同时显示同一角色。</p>
      </>}
      {action.kind === "characterFeature" && (
        <>
          <Field label="角色">
            <select value={action.characterId} onChange={event => {
              const id = event.target.value;
              const features = effectiveCharacter(project, id)?.features ?? [];
              onChange({ ...action, characterId: id, featureId: features[0]?.id ?? "missing" });
            }}>
              {project.characters.map(character => <option key={character.id} value={character.id}>{character.id === hostCharacterId ? `当前角色：${character.name}` : character.name}</option>)}
            </select>
          </Field>
          <Field label="功能">
            <select value={action.featureId} onChange={event => onChange({ ...action, featureId: event.target.value })}>
              <option value="missing" disabled>选择角色功能</option>
              {(effectiveCharacter(project, action.characterId)?.features ?? []).map(feature => <option key={feature.id} value={feature.id}>{feature.name}</option>)}
            </select>
          </Field>
        </>
      )}
      {action.kind === "show" && (
        <>
          {!action.characterId && <p className="muted">留空跟随当前台词的发言角色；旁白及没有立绘的角色跳过。</p>}
          <Field label="表情">
            {!action.characterId ? <><input aria-label="显示角色表情" list="speaker-expression-options" value={action.expressionId} placeholder="留空使用角色默认表情" onChange={e => onChange({ ...action, expressionId: e.target.value })} /><datalist id="speaker-expression-options">{effectiveCharacter(project, showCharacterId)?.expressions.map(ex => <option key={ex.id} value={ex.name} />)}</datalist></> : <select aria-label="显示角色表情" value={action.expressionId} onChange={e => onChange({ ...action, expressionId: e.target.value })}>
              <option value="">角色默认表情</option>
              {effectiveCharacter(project, action.characterId)?.expressions.map(ex => <option key={ex.id} value={ex.id}>{ex.name}</option>)}
            </select>}
          </Field>
          <div className="field-row">
            <Field label="站位预设"><CharacterPresetSelect project={project} characterId={action.characterId} value={action.presetId} onChange={presetId => onChange(presetId ? { ...action, presetId } : detachDisplayPreset(project, action))} /></Field>
          </div>
          {action.presetId && <p className="muted">此演出跟随角色预设。修改下面的位置或缩放，会转为本次手动调整。</p>}
          <div className="field-row">
            <NumberField label="横向位置 %" value={resolveShowAction(project, action).x * 100} step={.1} onChange={x => onChange({ ...detachDisplayPreset(project, action), x: x / 100 })} />
            <NumberField label="纵向位置 %" value={resolveShowAction(project, action).y * 100} step={.1} onChange={y => onChange({ ...detachDisplayPreset(project, action), y: y / 100 })} />
          </div>
          <div className="field-row">
            <Field label="缩放 %">
              <NumberInput
                type="number"
                
                
                value={Math.round(resolveShowAction(project, action).scale * 100)}
                onChange={(e) =>
                  onChange({
                    ...detachDisplayPreset(project, action),
                    scale: Number(e.target.value) / 100,
                  })
                }
              />
            </Field>
            <Field label="图层">
              <NumberInput
                type="number"
                
                
                value={action.layer}
                onChange={(e) =>
                  onChange({
                    ...action,
                    layer: Math.round(Number(e.target.value)),
                  })
                }
              />
            </Field>
          </div>
        </>
      )}
      {action.kind === "show" && <><ActorTransitionFields value={action.actorTransitions} defaults={resolveActorTransitions(project, action.characterId, { ...action, actorTransitions: undefined }) ?? actorTransitionDefaults(action.transition, action.duration)} onChange={actorTransitions => onChange({ ...action, actorTransitions })} /><label className="check-field"><input type="checkbox" checked={action.wait !== false} onChange={event => onChange({ ...action, wait: event.target.checked })} />等待过渡完成</label></>}
      {"transition" in action && action.kind !== "show" && (
        <Field label="转场">
          <select
            value={action.transition}
            onChange={(e) =>
              onChange({
                ...action,
                transition: e.target.value as
                  | "none"
                  | "dissolve"
                  | "fade"
                  | "move",
              })
            }
          >
            <option value="none">立即</option>
            <option value="dissolve">淡化</option>
            <option value="fade">淡入黑场</option>
            <option value="move">移动</option>
          </select>
        </Field>
      )}
      {entranceOffsets && action.kind === "show" && <ShowOffsetsEditor action={action} onChange={onChange} />}
      {action.kind === "music" && (
        <label className="check-field">
          <input
            type="checkbox"
            checked={action.loop}
            onChange={(e) => onChange({ ...action, loop: e.target.checked })}
          />
          循环播放
        </label>
      )}
      {(action.kind === "music" || action.kind === "stopMusic") && (
        <Field label="淡入 / 淡出 秒">
          <NumberInput
            type="number"
            
            
            step="0.1"
            value={action.fade}
            onChange={(e) =>
              onChange({
                ...action,
                fade: Number(e.target.value),
              })
            }
          />
        </Field>
      )}
      {action.kind === "pause" && (
        <Field label="等待 秒">
          <NumberInput
            type="number"
            
            
            step="0.1"
            value={action.seconds}
            onChange={(e) =>
              onChange({
                ...action,
                seconds: Number(e.target.value),
              })
            }
          />
        </Field>
      )}
      {action.kind === "animate" && (
        <>
          <label className="check-field"><input type="checkbox" checked={action.repeat} onChange={event => onChange({ ...action, repeat: event.target.checked, wait: event.target.checked ? false : action.wait })} />循环动画</label>
          <label className="check-field"><input type="checkbox" checked={action.wait} disabled={action.repeat} onChange={event => onChange({ ...action, wait: event.target.checked })} />完成动画后继续</label>
          {action.keyframes.map((frame, index) => (
            <div key={index} style={{ borderTop: "1px solid var(--border, #444b52)", paddingTop: 8, marginTop: 8 }}>
              <div className="action-editor-header">
                <strong>关键帧 {index + 1}</strong><div className="spacer" />
                <IconButton title="关键帧上移" disabled={index === 0} onClick={() => { const keyframes = [...action.keyframes]; [keyframes[index - 1], keyframes[index]] = [keyframes[index], keyframes[index - 1]]; onChange({ ...action, keyframes }); }}><ArrowUp size={13} /></IconButton>
                <IconButton title="关键帧下移" disabled={index === action.keyframes.length - 1} onClick={() => { const keyframes = [...action.keyframes]; [keyframes[index + 1], keyframes[index]] = [keyframes[index], keyframes[index + 1]]; onChange({ ...action, keyframes }); }}><ArrowDown size={13} /></IconButton>
                <IconButton title="删除关键帧" disabled={action.keyframes.length <= 1} onClick={() => onChange({ ...action, keyframes: action.keyframes.filter((_, i) => i !== index) })}><Trash2 size={13} /></IconButton>
              </div>
              <KeyframeEditor frame={frame} onChange={next => onChange({ ...action, keyframes: action.keyframes.map((item, i) => i === index ? next : item) })} />
            </div>
          ))}
          <button className="text-button" disabled={action.keyframes.length >= 32} onClick={() => onChange({ ...action, keyframes: [...action.keyframes, { ...action.keyframes[action.keyframes.length - 1], duration: 1 }] })}><Plus size={14} />添加关键帧</button>
        </>
      )}
      {action.kind === "camera" && (
        <>
          <div className="field-row">
            <NumberField label="横向偏移 %" value={action.x * 100} step={.1} onChange={value => onChange({ ...action, x: value / 100 })} />
            <NumberField label="纵向偏移 %" value={action.y * 100} step={.1} onChange={value => onChange({ ...action, y: value / 100 })} />
          </div>
          <div className="field-row">
            <NumberField label="镜头缩放 %" value={action.zoom * 100} min={25} max={400} onChange={value => onChange({ ...action, zoom: value / 100 })} />
            <NumberField label="镜头旋转 度" value={action.rotation} min={-180} max={180} onChange={value => onChange({ ...action, rotation: value })} />
          </div>
          <NumberField label="运动时长 秒" value={action.duration} min={0} max={60} step={0.1} onChange={value => onChange({ ...action, duration: value })} />
          <EasingEditor value={action.easing} onChange={easing => onChange({ ...action, easing })} />
          <label className="check-field"><input type="checkbox" checked={action.wait} onChange={event => onChange({ ...action, wait: event.target.checked })} />完成运动后继续</label>
        </>
      )}
      {action.kind === "shake" && <><NumberField label="震动时长" value={action.duration ?? 0.6} step={0.1} onChange={duration => onChange({ ...action, duration })} /><NumberField label="震动幅度（像素）" value={action.amplitude ?? 20} onChange={amplitude => onChange({ ...action, amplitude })} /><label className="check-field"><input type="checkbox" checked={action.wait !== false} onChange={event => onChange({ ...action, wait: event.target.checked })} />等待震动完成</label><Field label="震动方向"><select value={action.direction} onChange={event => onChange({ ...action, direction: event.target.value as typeof action.direction })}><option value="horizontal">横向</option><option value="vertical">纵向</option></select></Field></>}
      {action.kind === "effect" && <Field label="效果实例"><select value={action.effectId} onChange={event => onChange({ ...action, effectId: event.target.value })}><option value="missing" disabled>选择效果实例</option>{(project.effects ?? []).map(effect => <option key={effect.id} value={effect.id}>{effect.name}</option>)}</select></Field>}
      {action.kind === 'chapter' && <ChapterFields project={project} action={action} onChange={onChange} assetUrl={assetUrl} />}
      {action.kind === "blueprint" && <><Field label="蓝图 / 时间轴预设"><select value={action.blueprintId} onChange={event => onChange({ kind: 'blueprint', blueprintId: event.target.value })}><option value="missing" disabled>选择演出资源</option><GraphResourceOptions project={project} graphs={projectGraphs(project)} paths /></select></Field><BlueprintCallFields project={project} graph={projectGraphs(project).find(graph => graph.id === action.blueprintId)} inputs={action.inputs} onChange={inputs => onChange({ ...action, inputs })} assetUrl={assetUrl} speakerId={speakerId} />{graphShowsActors(project, action.blueprintId) && <ActorTransitionFields inheritLabel="蓝图与角色设置" label="本次角色过渡" value={action.actorTransitions} defaults={resolveActorTransitions(project, speakerId ?? '', { transition: 'dissolve' }) ?? actorTransitionDefaults()} onChange={actorTransitions => onChange({ ...action, actorTransitions })} />}</>}
    </>
  );
}

export function KeyframeEditor({ frame, onChange }: { frame: AnimationKeyframe; onChange: (value: AnimationKeyframe) => void }) {
  const axes = frame.scaleX !== undefined || frame.scaleY !== undefined;
  return <>
    <div className="field-row">
      <NumberField label="横向位置 %" value={frame.x * 100} step={.1} onChange={value => onChange({ ...frame, x: value / 100 })} />
      <NumberField label="纵向位置 %" value={frame.y * 100} step={.1} onChange={value => onChange({ ...frame, y: value / 100 })} />
    </div>
    <div className="field-row">
      {(!axes || frame.scale !== 1) && <NumberField label="缩放 %" value={frame.scale * 100} min={5} max={400} onChange={value => onChange({ ...frame, scale: value / 100 })} />}
      <NumberField label="旋转 度" value={frame.rotation} min={-360} max={360} onChange={value => onChange({ ...frame, rotation: value })} />
    </div>
    {axes && <div className="field-row"><NumberField label="缩放 X %" value={(frame.scaleX ?? 1) * 100} onChange={value => onChange({ ...frame, scaleX: value / 100 })} /><NumberField label="缩放 Y %" value={(frame.scaleY ?? 1) * 100} onChange={value => onChange({ ...frame, scaleY: value / 100 })} /></div>}
    <div className="field-row">
      <NumberField label="不透明度 %" value={frame.opacity * 100} min={0} max={100} onChange={value => onChange({ ...frame, opacity: value / 100 })} />
      <NumberField label="到达时长 秒" value={frame.duration} min={0} max={60} step={0.1} onChange={value => onChange({ ...frame, duration: value })} />
    </div>
    <EasingEditor value={frame.easing} onChange={easing => onChange({ ...frame, easing })} />
  </>;
}

function EasingEditor({ value, onChange }: { value: AnimationKeyframe["easing"]; onChange: (value: AnimationKeyframe["easing"]) => void }) {
  return <Field label="运动曲线"><select value={value} onChange={event => onChange(event.target.value as AnimationKeyframe["easing"])}><option value="linear">匀速</option><option value="ease">平滑</option><option value="easein">逐渐加速</option><option value="easeout">逐渐减速</option></select></Field>;
}

export function newAction(
  kind: StageAction["kind"],
  project: Project,
  hostCharacterId?: string,
  excludeFeatureId?: string,
): StageAction | undefined {
  const image = categoryAssets(project, 'image', 'scene')[0];
  const music = categoryAssets(project, 'audio', 'bgm')[0];
  const sound = categoryAssets(project, 'audio', 'sound')[0];
  const characters = project.characters.map(character => effectiveCharacter(project, character.id) ?? character);
  const character = hostCharacterId ? characters.find(character => character.id === hostCharacterId) : characters.find(character => character.expressions.length);
  const featureCharacter = hostCharacterId ? characters.find(character => character.id === hostCharacterId) : characters.find(character => character.features?.length);
  const feature = featureCharacter?.features?.find(feature => feature.id !== excludeFeatureId);
  const expression = character?.expressions[0];
  if (kind === 'unlock') { const asset = project.assets.find(asset => asset.kind === 'image' || asset.kind === 'audio'); if (asset) return { kind, assetId: asset.id }; }
  if (kind === 'audioClip') { const asset = project.assets.find(a => a.kind === 'audio'); if (asset) return { ...createAudioClip(asset.id, asset.name, 3), sourceDuration: undefined }; }
  if (kind === "background" && image)
    return { kind, assetId: image.id, transition: "dissolve" };
  if (kind === "show")
    return {
      kind,
      characterId: hostCharacterId ?? "",
      expressionId: "",
      presetId: 'default',
      lifetime: 'line',
      x: 0.5,
      y: 1,
      scale: 1,
      layer: 10,
      transition: "dissolve",
    };
  if (kind === "hide" && (hostCharacterId || project.characters[0]))
    return {
      kind,
      characterId: hostCharacterId ?? project.characters[0].id,
      transition: "dissolve",
    };
  if (kind === "music" && music)
    return { kind, assetId: music.id, loop: true, fade: 0 };
  if (kind === "sound" && sound) return { kind, assetId: sound.id };
  if (kind === "stopMusic") return { kind, fade: 0 };
  if (kind === "pause") return { kind, seconds: 1 };
  if (kind === 'hideInterface' || kind === 'showInterface' || kind === 'startDialogue') return { kind };
  if (kind === 'hideVisual') return { kind, instanceId: 'image' };
  if (kind === "animate" && character && expression) return {
    kind, characterId: character.id, wait: false, repeat: false,
    keyframes: [
      { x: 0.5, y: 1, scale: 1, rotation: 0, opacity: 1, duration: 0, easing: "linear" },
      { x: 0.65, y: 1, scale: 1, rotation: 0, opacity: 1, duration: 1, easing: "ease" },
    ],
  };
  if (kind === "characterFeature" && featureCharacter && feature) return {
    kind, characterId: featureCharacter.id, featureId: feature.id,
  };
  if (kind === "camera") return { kind, x: 0, y: 0, zoom: 1.1, rotation: 0, duration: 1, easing: "ease", wait: false };
  if (kind === "shake") return { kind, direction: "horizontal" };
  if (kind === "effect" && project.effects?.[0]) return { kind, effectId: project.effects[0].id };
  if (kind === "blueprint" && projectGraphs(project)?.[0]) return { kind, blueprintId: projectGraphs(project)[0].id };
}
