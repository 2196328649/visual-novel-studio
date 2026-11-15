import { useId, useMemo, useState } from 'react';
import { AlignLeft, AlignCenter, AlignRight, AlignHorizontalSpaceBetween, AlignVerticalSpaceBetween, ArrowLeft, ArrowRight, ArrowUp, ArrowDown, Magnet } from 'lucide-react';
import { planUiArrangement, uiRectChangeProblem, uiSelectionRoots, type UiArrangement, type UiArrangementPlan, type UiArrangeTarget, type UiEditScope } from '../core/ui-arrange';
import type { Project, UiComponent } from '../core/model';
import { componentName } from './UiNames';
import { NumberInput } from './NumberInput';

export function UiLayoutToolbar({ project, components, selectedIds, scope, visible, arrange, feedback, snapEnabled, setSnapEnabled }: {
  project: Project; components: UiComponent[]; selectedIds: string[]; scope: UiEditScope;
  visible: (component: UiComponent) => boolean; arrange: (operation: UiArrangement, label: string) => void; feedback: string;
  snapEnabled: boolean; setSnapEnabled: (enabled: boolean) => void;
}) {
  const roots = uiSelectionRoots(components, selectedIds);
  const [step, setStep] = useState(1);
  const helpId = useId();
  const target: UiArrangeTarget = roots.length > 1 ? 'last' : 'canvas';
  const reference = target === 'last' ? components.find(component => component.id === selectedIds.at(-1)) : undefined;
  const alignments = useMemo(() => [
    { label: '左对齐', axis: 'x', edge: 'start', icon: AlignLeft },
    { label: '水平居中', axis: 'x', edge: 'center', icon: AlignCenter },
    { label: '右对齐', axis: 'x', edge: 'end', icon: AlignRight },
    { label: '顶对齐', axis: 'y', edge: 'start', icon: AlignLeft },
    { label: '垂直居中', axis: 'y', edge: 'center', icon: AlignCenter },
    { label: '底对齐', axis: 'y', edge: 'end', icon: AlignRight },
  ] as const, []);
  const nudges = useMemo(() => [{ label: '向左微调', x: -1, y: 0, icon: ArrowLeft }, { label: '向上微调', x: 0, y: -1, icon: ArrowUp }, { label: '向下微调', x: 0, y: 1, icon: ArrowDown }, { label: '向右微调', x: 1, y: 0, icon: ArrowRight }], []);
  const plans = useMemo(() => {
    const result = new Map<string, UiArrangementPlan>();
    const operations: UiArrangement[] = [...alignments.map(({ axis, edge }): UiArrangement => ({ kind: 'align', axis, edge, target })), { kind: 'distribute', axis: 'x' }, { kind: 'distribute', axis: 'y' }, { kind: 'move', delta: { x: 0, y: 0 } }, ...nudges.map(({ x, y }): UiArrangement => ({ kind: 'move', delta: { x: x * step, y: y * step } }))];
    for (const operation of operations) {
      const plan = planUiArrangement(components, selectedIds, project, operation, visible);
      result.set(JSON.stringify(operation), { ...plan, problem: plan.problem ?? uiRectChangeProblem(project, scope, plan.changes) });
    }
    return result;
  }, [components, selectedIds, project, scope.page, scope.ownerId, target, visible, alignments, nudges, step]);
  const problem = (operation: UiArrangement) => plans.get(JSON.stringify(operation))?.problem;
  const distributionHint = (axis: 'x' | 'y') => {
    const plan = plans.get(JSON.stringify({ kind: 'distribute', axis })), direction = axis === 'x' ? '水平' : '垂直';
    if (plan?.problem) return `${direction}等距：${plan.problem}`;
    const gap = plan?.distribution?.gap;
    if (gap === undefined) return `${direction}等距：保持两端不动，让控件之间的空隙相等。`;
    const pixels = Number(Math.abs(gap).toFixed(2));
    return `${direction}等距：保持两端不动，${gap < -1e-6 ? `该方向的外框重叠 ${pixels || '小于 0.01'} px` : `间距 ${pixels} px`}。`;
  };
  const nudgeProblems = nudges.map(({ x, y }) => problem({ kind: 'move', delta: { x: x * step, y: y * step } }));
  const unavailable = problem({ kind: 'move', delta: { x: 0, y: 0 } }) || (nudgeProblems.every(Boolean) ? nudgeProblems[0] : undefined);
  const horizontalProblem = problem({ kind: 'distribute', axis: 'x' }), verticalProblem = problem({ kind: 'distribute', axis: 'y' });
  const distributionHelp = horizontalProblem && horizontalProblem === verticalProblem ? `等距：${horizontalProblem}` : `${distributionHint('x')} ${distributionHint('y')}`;
  const help = unavailable || (selectedIds.length >= 2 ? distributionHelp : problem({ kind: 'align', axis: 'x', edge: 'start', target }));
  return <div className="ui-layout-tools" aria-label="控件布局工具栏" data-align-target={target}>
    <div className="ui-layout-tool-row" role="toolbar" aria-label="对齐与分布">
      <div className="ui-layout-tool-group" role="group" aria-label="对齐">
        <span>对齐</span>
        {alignments.map(({ label, axis, edge, icon: Icon }) => {
          const operation: UiArrangement = { kind: 'align', axis, edge, target }, reason = problem(operation);
          return <button key={label} type="button" className="icon-button" aria-label={label} title={reason ?? label + ' · ' + (reference ? `基准：${componentName(reference)}（末选，保持不动）` : '整个游戏画面')} disabled={!!reason} onClick={() => arrange(operation, label)}><Icon size={18} style={axis === 'y' ? { transform: 'rotate(90deg)' } : undefined} /></button>;
        })}
      </div>
      <div className="ui-layout-tool-group" role="group" aria-label="等距分布">
        <span>等距</span>
        {(['x', 'y'] as const).map(axis => {
          const operation: UiArrangement = { kind: 'distribute', axis }, reason = problem(operation), label = axis === 'x' ? '水平等距' : '垂直等距', Icon = axis === 'x' ? AlignHorizontalSpaceBetween : AlignVerticalSpaceBetween;
          const hint = distributionHint(axis);
          return <span key={axis} className="ui-distribution-action" role={reason ? 'group' : undefined} tabIndex={reason ? 0 : undefined} aria-label={reason ? `${label}不可用：${reason}` : undefined} title={hint}>
            <button type="button" className="icon-button" aria-label={label} aria-describedby={helpId} title={hint} disabled={!!reason} onClick={() => arrange(operation, label)}><Icon size={18} /></button>
          </span>;
        })}
      </div>
      <div className="ui-layout-tool-group ui-nudge-tools" role="group" aria-label="位置微调">
        <span>微调</span>{nudges.map(({ label, x, y, icon: Icon }, index) => <button key={label} type="button" className="icon-button" aria-label={label} title={nudgeProblems[index] ?? `${label} ${step} px（游戏分辨率）`} disabled={!!nudgeProblems[index]} onClick={() => arrange({ kind: 'move', delta: { x: x * step, y: y * step } }, label)}><Icon size={16} /></button>)}
        <div className="ui-nudge-step"><NumberInput aria-label="微调步长" title="方向按钮每次移动的游戏像素数；请输入大于 0 的数值。" value={step} onChange={event => { const value = event.target.valueAsNumber; if (value > 0) setStep(value); }} /><span aria-hidden="true">px</span></div>
      </div>
      <div className="ui-layout-tool-group ui-snap-tools">
        <button type="button" className="ui-snap-toggle" aria-label="智能吸附" aria-pressed={snapEnabled} title={`${snapEnabled ? '已开启' : '已关闭'}：拖动时吸附到游戏画面或其他控件的边缘、中心。拖动中按住 Alt 暂停吸附；微调不受影响。`} onClick={() => setSnapEnabled(!snapEnabled)}><Magnet size={14} /><span>智能吸附</span><small>{snapEnabled ? '开' : '关'}</small></button>
      </div>
    </div>
    <div className="ui-layout-help"><strong data-ui-selection-count={selectedIds.length} title="在画布空白处拖框，完整框住控件即可多选；Shift 追加，Ctrl 切换，Esc 取消框选。">{selectedIds.length ? `已选 ${selectedIds.length} 项` : '未选择控件'}</strong>
      {selectedIds.length > 0 && <span className={'ui-align-reference' + (reference ? ' has-reference' : '')} title={reference ? `基准：${componentName(reference)}（最后选中）。对齐时保持它不动；等距分布仍按两端计算。` : '单选时对齐到整个游戏画面，不是编辑器窗口。'}>基准：{reference ? componentName(reference) + '（末选）' : '整个游戏画面'}</span>}
      <span id={helpId} role="status" aria-live="polite">{feedback || (!selectedIds.length ? '空白处拖框 · 完整框住即选中 · Shift 追加 · Ctrl 切换' : help || (roots.length < selectedIds.length ? '父子一起选时整组移动，不重复偏移。' : '拖框 / Shift / Ctrl 多选 · 方向键 1 px · Shift + 方向键 10 px'))}</span>
    </div>
  </div>;
}
