import { useEffect, useId, useRef, useState, isValidElement, cloneElement, type ButtonHTMLAttributes, type ReactNode, type ReactElement } from "react";
import { ChevronDown, CircleHelp, Plus, Trash2 } from "lucide-react";
import { NumberInput } from './NumberInput';
import { parameterSets, parameterSetFor } from '../core/parameter-sets';
import type {
  Condition,
  Project,
  Variable,
  VariableValue,
} from "../core/model";

export function IconButton({
  title,
  children,
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { title: string }) {
  return (
    <button
      type="button"
      {...props}
      title={title}
      aria-label={title}
      className={`icon-button ${className}`}
    >
      {children}
    </button>
  );
}
export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  const labelId = useId();
  const toggle = isValidElement<{ type?: string }>(children) && children.type === 'input' && children.props.type === 'checkbox';
  const explicitLabel = isValidElement<{ 'aria-label'?: string; 'aria-labelledby'?: string }>(children) && (children.props['aria-label'] || children.props['aria-labelledby']);
  const control = !explicitLabel && isValidElement(children) && (children.type === NumberInput || typeof children.type === 'string' && ['input', 'select', 'textarea'].includes(children.type))
    ? cloneElement(children as ReactElement<Record<string, unknown>>, { 'aria-labelledby': labelId }) : children;
  return (
    <div className={`field${toggle ? ' field-toggle' : ''}${hint ? ' field-with-help' : ''}`}>
      <label className="field-control">
        <span className="field-label" id={labelId}>{label}</span>
        {control}
      </label>
      {hint && <details className="field-help"><summary aria-label={`${label}说明`} title={hint}><CircleHelp size={13} aria-hidden="true" /></summary><small>{hint}</small></details>}
    </div>
  );
}
export function ToolbarMenu({ label, children }: { label: string; children: ReactNode }) {
  const menu = useRef<HTMLDetailsElement>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (menu.current && event.target instanceof Node && !menu.current.contains(event.target)) menu.current.open = false;
    };
    document.addEventListener('pointerdown', dismiss, true);
    return () => document.removeEventListener('pointerdown', dismiss, true);
  }, [open]);
  return <details ref={menu} className="toolbar-menu" onToggle={event => setOpen(event.currentTarget.open)}
    onBlur={event => { if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false; }}
    onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); event.currentTarget.open = false; event.currentTarget.querySelector('summary')?.focus(); } }}>
    <summary className="small-button">{label}<ChevronDown size={13} aria-hidden="true" /></summary>
    <div className="toolbar-menu-items" role="group" aria-label={label} onClick={event => { if ((event.target as Element).closest('button') && menu.current) menu.current.open = false; }}>{children}</div>
  </details>;
}
export function Empty({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {children}
    </div>
  );
}
export function ValueInput({
  variable,
  value,
  onChange,
  label = '状态值',
}: {
  variable?: Variable;
  value: VariableValue;
  onChange: (value: VariableValue) => void;
  label?: string;
}) {
  const type = variable?.type ?? typeof value;
  if (type === "boolean")
    return (
      <select
        aria-label={label}
        value={String(value)}
        onChange={(e) => onChange(e.target.value === "true")}
      >
        <option value="true">是</option>
        <option value="false">否</option>
      </select>
    );
  return (
    <NumberInput
      aria-label={label}
      type={type === "number" ? "number" : "text"}
      value={String(value)}
      onChange={(e) =>
        onChange(type === "number" ? Number(e.target.value) : e.target.value)
      }
    />
  );
}
export function ConditionEditor({
  project,
  condition,
  onChange,
  groupBySet = false,
}: {
  project: Project;
  condition: Condition;
  onChange: (condition: Condition) => void;
  groupBySet?: boolean;
}) {
  const first = project.variables[0];
  const fresh = (): Condition =>
    first
      ? {
          kind: "compare",
          variableId: first.id,
          operator: "eq",
          value: first.initial,
        }
      : { kind: "all", conditions: [] };
  return (
    <div className="condition-editor">
      <select
        aria-label="条件组合方式"
        value={condition.kind}
        onChange={(e) => {
          const kind = e.target.value as Condition["kind"];
          if (kind === "compare") onChange(fresh());
          else if (kind === "not") onChange({ kind, condition: fresh() });
          else onChange({ kind, conditions: [fresh()] });
        }}
      >
        <option value="compare" disabled={!first}>
          状态比较
        </option>
        <option value="all">全部满足</option>
        <option value="any">任一满足</option>
        <option value="not">不满足</option>
      </select>
      {condition.kind === "compare" && (
        <div className="condition-fields">
          <select
            aria-label="条件状态"
            value={condition.variableId}
            onChange={(e) => {
              const variable = project.variables.find(
                (v) => v.id === e.target.value,
              );
              onChange({
                ...condition,
                variableId: e.target.value,
                operator: "eq",
                value: variable?.initial ?? 0,
              });
            }}
          >
            <option value="" disabled>
              选择状态
            </option>
            {groupBySet ? parameterSets(project).map(set => <optgroup key={set.id} label={set.name}>{project.variables.filter(variable => parameterSetFor(project, variable).id === set.id).map(variable => <option key={variable.id} value={variable.id}>{variable.name}</option>)}</optgroup>) : project.variables.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
          <select
            aria-label="比较方式"
            value={condition.operator}
            onChange={(e) =>
              onChange({
                ...condition,
                operator: e.target.value as Extract<
                  Condition,
                  { kind: "compare" }
                >["operator"],
              })
            }
          >
            <option value="eq">等于</option>
            <option value="ne">不等于</option>
            {project.variables.find((v) => v.id === condition.variableId)
              ?.type === "number" && (
              <>
                <option value="gt">大于</option>
                <option value="gte">大于或等于</option>
                <option value="lt">小于</option>
                <option value="lte">小于或等于</option>
              </>
            )}
          </select>
          <ValueInput
            variable={project.variables.find(
              (v) => v.id === condition.variableId,
            )}
            value={condition.value}
            onChange={(value) => onChange({ ...condition, value })}
          />
        </div>
      )}
      {(condition.kind === "all" || condition.kind === "any") && (
        <>
          {condition.conditions.map((child, i) => (
            <div className="condition-child" key={i}>
              <ConditionEditor
                project={project}
                groupBySet={groupBySet}
                condition={child}
                onChange={(changed) =>
                  onChange({
                    ...condition,
                    conditions: condition.conditions.map((c, n) =>
                      n === i ? changed : c,
                    ),
                  })
                }
              />
              <IconButton
                title="删除条件"
                onClick={() =>
                  onChange({
                    ...condition,
                    conditions: condition.conditions.filter((_, n) => n !== i),
                  })
                }
              >
                <Trash2 size={14} />
              </IconButton>
            </div>
          ))}
          <button
            className="text-button"
            disabled={!first}
            onClick={() =>
              onChange({
                ...condition,
                conditions: [...condition.conditions, fresh()],
              })
            }
          >
            <Plus size={14} />
            添加条件
          </button>
          {!first && <span className="muted">尚无状态</span>}
        </>
      )}
      {condition.kind === "not" && (
        <ConditionEditor
          project={project}
          groupBySet={groupBySet}
          condition={condition.condition}
          onChange={(next) => onChange({ kind: "not", condition: next })}
        />
      )}
    </div>
  );
}

export function TargetSelect({
  project,
  value,
  onChange,
  label = "后续段落",
  empty = '未连接',
}: {
  project: Project;
  value?: string;
  onChange: (value?: string) => void;
  label?: string;
  empty?: string;
}) {
  return (
    <select
      aria-label={label}
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value || undefined)}
    >
      <option value="">{empty}</option>
      {project.scenes.map((scene) => (
        <optgroup key={scene.id} label={scene.name}>
          {project.nodes
            .filter((n) => n.sceneId === scene.id)
            .map((n) => (
              <option key={n.id} value={n.id}>
                {n.name}
              </option>
            ))}
        </optgroup>
      ))}
    </select>
  );
}
