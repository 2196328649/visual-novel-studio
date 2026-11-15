import type { Project, UiComponent } from '../core/model';
import { uiAssetBindable, uiAssetBinding, uiAssetBindingCandidates } from '../core/ui-asset-binding';
import { uiControlBindingName } from '../core/ui-control-authoring';
import { uiInspectorSearchLabels } from '../core/ui-inspector-search';
import { uiFitNames } from '../core/ui';
import { uiPropertyControlFor } from '../core/ui-property-control';
import { Field } from './components';
import { NumberInput } from './NumberInput';
import { UiAssetSelect } from './AssetPicker';
import { bindingNames } from './UiNames';
import { UiPreferenceFields } from './PlayerPreferences';
import { UiCollectionInspector } from './UiCollectionInspector';
import { UiPropertyControlSummary } from './UiPropertyControl';
import { UiPropertyGroup } from './UiPropertyGroup';
import { SpinePlaybackFields } from './SpinePreview';
import type { AssetUrl } from './StageEditor';
import type { Commit } from './editor';

export const inspectorCollectionKinds = new Set<UiComponent['kind']>([
  'choiceList', 'saveSlots', 'galleryGrid', 'musicTrackList', 'voiceCollection', 'chapterList', 'historyList',
]);

export function uiInspectorContentSummary(project: Project, component: UiComponent): string {
  const property = component.kind === 'text' || component.kind === 'button' ? 'text' : component.kind === 'image' ? 'image' : component.kind === 'video' ? 'video' : component.kind === 'progress' ? 'value' : undefined;
  const source = property && uiPropertyControlFor(project, component, property);
  if (source) return `${source.control.mode === 'sync' ? '同步' : '跟随'}：${project.variables.find(item => item.id === source.control.parameterId)?.name ?? '参数已删除'}`;
  if (component.binding) return bindingNames[component.binding];
  if (['preference', 'preferenceChoice'].includes(component.kind)) return uiControlBindingName(project, component);
  if (component.assetParameterId) return uiAssetBinding(project, component)?.name ?? '素材参数失效';
  if (component.assetId) return project.assets.find(asset => asset.id === component.assetId)?.name ?? '素材已移除';
  if (component.kind === 'progress') return `${Math.round((component.value ?? 0) * 100)}%`;
  if (inspectorCollectionKinds.has(component.kind)) return component.kind === 'saveSlots' ? '存档与读档条目' : '列表来源与显示内容';
  return component.text || '内容来源';
}

const systemContent: Partial<Record<UiComponent['kind'], string>> = {
  panel: '面板承载底色、边框和子对象。位置与显示效果在上方调整；子对象的排列、间距与裁剪在通用属性的“子对象”中设置。',
  pauseMenu: '此控件整组显示内置暂停按钮，可调整整个区域和按钮共用外观。需要逐个设计时，可用独立按钮替代此控件，并在“页面设置 → 页面行为”关闭“显示系统默认内容”。',
  chapterTitle: '此控件保留旧版章节标题显示，文字来自剧情播放时传入的标题与副标题。这里调整标题区域和文字外观；当前章节演出在时间轴中编辑。',
  messageBox: '这是旧版确认对话框控件，目前仅显示它保存的说明文字。实际提示与确认、取消按钮由页面提供；在消息框页“添加组件 → 创建确认框布局”可生成可分别编辑的文字和按钮。',
  staffRoll: '在“名单文字”中按行填写制作人员，游戏中可滚动查看。这里设置名单显示区域与共用字体、字号和颜色。',
  keyboard: '此控件提供内置字母、数字和退格按键，用于当前文字输入。这里调整键盘区域及标题文字外观；键位与按键行为由系统提供，提交方式跟随正在进行的输入。',
  gameOver: '此控件整组显示游戏结束标题与“重新开始”“返回标题”按钮。这里调整整个区域及标题外观；需要分别设计按钮时，可用独立文字和按钮替代，并在页面设置中关闭系统默认内容。',
};

function contentBindings(project: Project, component: UiComponent): NonNullable<UiComponent['binding']>[] {
  if (component.kind !== 'text') return [];
  const bindings: NonNullable<UiComponent['binding']>[] = ['tooltip'];
  if (component.page === 'main') bindings.unshift('title');
  if (component.page === 'say') bindings.unshift('speaker', 'dialogue');
  if (component.page === 'messageBox') bindings.unshift('confirmation');
  if (component.page === 'custom' && (component.binding?.startsWith('minigame') || project.minigames.some(game => project.ui.customPages.find(page => page.id === game.uiPageId)?.components.some(item => item.id === component.id)))) bindings.unshift('minigameTitle', 'minigamePrompt', 'minigameStatus');
  if (component.binding && !bindings.includes(component.binding)) bindings.push(component.binding);
  return bindings;
}

/** Source editing is separate from appearance: changing a state never changes text or an asset binding. */
export function UiInspectorContent({ project, component, peers, edit, commit, assetUrl, pageId, onOpenGraph, onParameter, includeBindings = true }: {
  project: Project; component: UiComponent; peers: UiComponent[]; edit: (change: (component: UiComponent) => void, options?: { separate?: boolean }) => void;
  commit: Commit; assetUrl: AssetUrl; pageId?: string; onOpenGraph?: (id: string, nodeId?: string) => void; onParameter?: (id: string) => void;
  includeBindings?: boolean;
}) {
  const bindings = contentBindings(project, component);
  const isControl = component.kind === 'preference' || component.kind === 'preferenceChoice';
  const candidates = uiAssetBindable(component) ? uiAssetBindingCandidates(project, component) : [];
  const boundAsset = uiAssetBinding(project, component);
  const assetKind = ['image', 'video', 'spine'].includes(component.kind) ? component.kind as 'image' | 'video' | 'spine' : undefined;
  const sourceName = component.kind === 'video' ? '视频来源' : '图片来源';
  const materialName = component.kind === 'video' ? '视频素材' : component.kind === 'spine' ? '骨骼素材' : '图片素材';
  const textControl = component.kind === 'text' && uiPropertyControlFor(project, component, 'text');
  const mediaControl = component.kind === 'image' || component.kind === 'video' ? uiPropertyControlFor(project, component, component.kind) : undefined;
  return <>
    {component.kind === 'text' && bindings.length > 0 && <Field label={textControl && !component.binding ? '默认文字来源' : '文字来源'} uiProperty={component.binding ? 'text' : undefined}>
      <select aria-label="文字内容" value={component.binding ?? ''} onChange={event => edit(c => { c.binding = event.target.value as UiComponent['binding'] || undefined; })}>
        <option value="">固定文字</option>{bindings.map(binding => <option key={binding} value={binding} disabled={binding !== 'tooltip' && peers.some(other => other.id !== component.id && other.binding === binding)}>{bindingNames[binding]}</option>)}
      </select>
    </Field>}
    {component.binding && <p className="ui-inspector-source" role="note">{textControl ? `默认来源“${bindingNames[component.binding]}”已保留；解除文字属性关联后恢复。` : <>内容来自{bindingNames[component.binding]}。{component.binding === 'dialogue' || component.binding === 'speaker' ? '这里设置对话默认外观，角色和单句文字演出可以单独覆盖。' : '运行时随来源更新。'}</>}</p>}
    {(component.kind === 'text' || component.kind === 'button' || isControl) && !component.binding && <Field label={isControl ? '标题' : '文字'} uiProperty={isControl ? undefined : 'text'}>
      <input aria-label={isControl ? '控件标题' : '文字'} value={component.text} onChange={event => edit(c => { c.text = event.target.value; })} />
    </Field>}
    {component.kind === 'staffRoll' && <Field label="名单文字" hint="保留换行、空行和缩进；游戏中按原文显示。">
      <textarea aria-label="名单文字" rows={6} value={component.text} onChange={event => edit(c => { c.text = event.target.value; })} />
    </Field>}
    {assetKind && <>
      {uiAssetBindable(component) && <Field label={mediaControl ? `默认${sourceName}` : sourceName} hint={mediaControl ? '此默认来源已保留；解除素材属性关联后才会恢复。下方属性关联生效时，空参数会清空素材。' : '跟随素材参数时，参数为空会显示下方素材。'}>
        <select aria-label={sourceName} value={component.assetParameterId ?? ''} onChange={event => edit(c => { c.assetParameterId = event.target.value || undefined; })}>
          <option value="">固定{assetKind === 'video' ? '视频' : '图片'}</option>
          {candidates.map(variable => <option key={variable.id} value={variable.id}>参数：{variable.name}</option>)}
          {!!component.assetParameterId && !boundAsset && <option value={component.assetParameterId}>参数已删除或类型不符</option>}
        </select>
        {boundAsset && onParameter && <button type="button" className="text-button" onClick={() => onParameter(boundAsset.id)}>查看来源参数</button>}
      </Field>}
      <Field label={!mediaControl && component.assetParameterId ? '参数为空时显示' : materialName} uiProperty={component.kind === 'image' ? 'image' : component.kind === 'video' ? 'video' : 'spineAsset'}>
        <UiAssetSelect project={project} assetUrl={assetUrl} kind={assetKind} label={materialName} value={component.assetId} onChange={value => edit(c => {
          c.assetId = value;
          if (c.kind === 'spine') c.spine = { ...c.spine, animation: project.assets.find(asset => asset.id === value)?.spine?.animations[0]?.name, skin: undefined };
        })} />
      </Field>
    </>}
    {component.kind === 'image' && <>
      <Field label="图片缩放" uiProperty="imageFit"><select aria-label="图片缩放" value={component.style?.imageFit ?? 'contain'} onChange={event => edit(c => { c.style = { ...c.style, imageFit: event.target.value as NonNullable<UiComponent['style']>['imageFit'] }; })}>
        {Object.entries(uiFitNames).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
      </select></Field>
      {component.style?.imageFit === 'nineSlice' && <UiPropertyGroup id="image-slicing" title="九宫格边距" defaultOpen summary="源图像素" searchKeywords="四角 切片 左 右 上 下">
        <div className="ui-inspector-transform">{(['left', 'top', 'right', 'bottom'] as const).map(edge => <Field key={edge} label={`${{ left: '左', top: '上', right: '右', bottom: '下' }[edge]}边距 px`}>
          <NumberInput aria-label={`图片${{ left: '左', top: '上', right: '右', bottom: '下' }[edge]}边距`} min={0} value={component.skin?.borders?.[edge] ?? 12} onChange={event => edit(c => { c.skin = { ...c.skin, borders: { left: 12, top: 12, right: 12, bottom: 12, ...c.skin?.borders, [edge]: Number(event.target.value) } }; })} />
        </Field>)}</div>
      </UiPropertyGroup>}
    </>}
    {component.kind === 'video' && <>
      <Field label="循环播放" uiProperty="videoLoop"><input aria-label="循环播放" type="checkbox" checked={component.loop ?? true} onChange={event => edit(c => { c.loop = event.target.checked; })} /></Field>
      <Field label="加载时显示图片" uiProperty="videoPoster"><UiAssetSelect project={project} assetUrl={assetUrl} kind="image" label="加载时显示图片" value={component.posterId} onChange={value => edit(c => { c.posterId = value; })} /></Field>
    </>}
    {component.kind === 'spine' && <SpinePlaybackFields asset={project.assets.find(asset => asset.id === component.assetId)} value={component.spine} onChange={settings => edit(c => { c.spine = settings; })} />}
    {component.kind === 'progress' && <Field label="初始进度 %" uiProperty="value"><NumberInput aria-label="进度条初始值" min={0} max={100} step={1} value={Number(((component.value ?? 0) * 100).toFixed(2))} onChange={event => edit(c => { c.value = Number(event.target.value) / 100; })} /></Field>}
    {isControl && <UiPreferenceFields project={project} component={component} edit={edit} assetUrl={assetUrl} section="content" onParameter={onParameter} />}
    {inspectorCollectionKinds.has(component.kind) && <UiCollectionInspector project={project} component={component} edit={edit} assetUrl={assetUrl} section="content" />}
    {systemContent[component.kind] && <p className="ui-inspector-source">{systemContent[component.kind]}</p>}
    {includeBindings && <UiInspectorBindings project={project} component={component} peers={peers} commit={commit} pageId={pageId} onOpenGraph={onOpenGraph} />}
  </>;
}

/** Secondary entry only; the source is configured at the field itself. */
export function UiInspectorBindings({ project, component, peers, commit, pageId, onOpenGraph }: {
  project: Project; component: UiComponent; peers: UiComponent[]; commit: Commit;
  pageId?: string; onOpenGraph?: (id: string, nodeId?: string) => void;
}) {
  return <UiPropertyControlSummary searchKeywords={uiInspectorSearchLabels(project, component, 'bindings')} />;
}
