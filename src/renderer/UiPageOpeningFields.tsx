import type { Project } from '../core/model';
import { openingModalFromInput, resolveUiPageOpening, uiPageOpeningPresets, uiPageOpeningSummary, type UiPageOpening, type UiPageOpeningPreset } from '../core/ui-page-opening';
import { uiPage } from '../core/ui-pages';
import { Field } from './components';
import { NumberInput } from './NumberInput';

export function UiPageOpeningFields({ project, pageId, value, onChange, defaults = false, dynamic = false, label = '页面打开' }: {
  project: Project; pageId: string; value?: UiPageOpening; onChange: (value: UiPageOpening | undefined) => void; defaults?: boolean; dynamic?: boolean; label?: string;
}) {
  const settings = resolveUiPageOpening(project, pageId, value), builtin = uiPage(project, pageId)?.template;
  const change = (patch: UiPageOpening) => onChange({ ...value, ...patch, ...(patch.wait === true ? { lifetime: 'owner' } : {}), ...(patch.lifetime && patch.lifetime !== 'owner' ? { wait: false } : {}) });
  const preset = Object.entries(uiPageOpeningPresets).find(([, item]) => Object.entries(item.value).every(([key, field]) => settings[key as keyof typeof settings] === field))?.[0] ?? '';
  return <section className="ui-page-opening" aria-label={label + '设置'}>
    <Field label={defaults ? '默认打开方式' : '打开方式'}><select aria-label={label + '预设'} value={preset} disabled={dynamic || builtin} onChange={event => onChange({ ...uiPageOpeningPresets[event.target.value as UiPageOpeningPreset].value })}>
      {!preset && <option value="" disabled>自定义组合</option>}{Object.entries(uiPageOpeningPresets).map(([key, item]) => <option key={key} value={key}>{item.name}</option>)}
    </select></Field>
    <p className="ui-page-help">{uiPageOpeningSummary(settings)}</p>
    {builtin ? <p className="ui-page-help">内置菜单等待关闭并接管输入。关闭后回到打开它的位置；成功读档会恢复存档。</p> : <details className="ui-page-opening-details"><summary>显示、交互与保留范围</summary>
      <Field label="显示方式"><select aria-label={label + '显示方式'} value={settings.presentation} onChange={event => change({ presentation: event.target.value as UiPageOpening['presentation'] })}><option value="page">独立界面 · 显示页面背景</option><option value="overlay">覆盖层 · 保留底层画面</option></select></Field>
      <Field label="流程继续时机"><select aria-label={label + '继续时机'} disabled={dynamic} value={settings.wait ? 'wait' : 'continue'} onChange={event => change({ wait: event.target.value === 'wait' })}><option value="wait">等待界面关闭</option><option value="continue">显示后立即继续</option></select></Field>
      <Field label="输入方式"><select aria-label={label === '节点' ? '节点底层输入' : label + '输入方式'} disabled={dynamic} value={openingModalFromInput(settings.input)} onChange={event => change({ input: event.target.value === 'modal' ? 'block' : event.target.value === 'modeless' ? 'controls' : 'none' })}><option value="modal">拦截底层操作</option><option value="modeless">仅本层控件，空白处穿透</option><option value="passthrough">完全穿透 · 仅显示</option></select></Field>
      <Field label="保留范围"><select aria-label={label + '保留范围'} value={settings.lifetime} onChange={event => change({ lifetime: event.target.value as UiPageOpening['lifetime'] })}><option value="owner">跟随打开者关闭</option><option value="scene">当前小章节</option><option value="game">整局游戏</option></select></Field>
      <label className="ui-page-check"><input type="checkbox" aria-label={label + '允许Esc关闭'} checked={settings.closeOnEscape} onChange={event => change({ closeOnEscape: event.target.checked })} />允许 Esc / 右键关闭</label>
      <Field label="自动关闭（秒）"><NumberInput aria-label={label + '自动关闭秒数'} min={0} step={.1} value={settings.autoClose} onChange={event => change({ autoClose: Math.max(0, event.target.valueAsNumber) })} /></Field>
      <p className="ui-page-help">0 表示不自动关闭。覆盖层只绘制控件；底色、背景图片仍保留在独立显示时使用。等待只暂停调用流程，不冻结音乐或其他页面计时器。</p>
    </details>}
    {dynamic && <p className="ui-page-help">等待或输入方式由蓝图数据线决定，请在对应连接点调整。</p>}
    {!defaults && !builtin && value && Object.keys(value).length > 0 && <button type="button" className="text-button" onClick={() => onChange(undefined)}>恢复页面默认打开方式</button>}
  </section>;
}
