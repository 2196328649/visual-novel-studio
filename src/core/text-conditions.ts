import { conditionSchema, variableValueType, type Condition, type Project } from './model';
import { parameterAssetFromText, parameterAssetText, parameterTypeName } from './parameter-sets';
import { argumentValue } from './text-arguments';
import { parameterConditionPattern } from './parameter-references';

const operators = { '==': 'eq', '=': 'eq', '!=': 'ne', '>': 'gt', '>=': 'gte', '<': 'lt', '<=': 'lte' } as const;
export function parseTextCondition(project: Project, source: string): Condition {
  if (source.trim().startsWith('{')) return conditionSchema.parse(JSON.parse(source));
  const match = source.trim().match(parameterConditionPattern);
  if (!match) throw new Error('条件格式为：章节进度 < 2');
  const reference = match[1].trim();
  const id = reference.match(/【([a-z][a-z0-9_]{0,63})】$/)?.[1];
  const variables = project.variables.filter(variable => id ? variable.id === id : reference === variable.id || reference === variable.name);
  if (variables.length !== 1) throw new Error(`条件参数不存在或名称有歧义：${reference}`);
  let value = argumentValue(match[3]);
  if (variables[0].type === 'asset') {
    const assetId = parameterAssetFromText(project, variables[0], match[3]);
    if (assetId === undefined) throw new Error(`未找到${parameterTypeName(variables[0])}素材：${match[3].trim()}`);
    value = assetId;
  }
  if (typeof value !== variableValueType(variables[0])) throw new Error(`条件值与参数“${variables[0].name}”类型不匹配。`);
  if (!['eq', 'ne'].includes(operators[match[2] as keyof typeof operators]) && variables[0].type !== 'number') throw new Error('大于和小于只能用于数值参数。');
  return { kind: 'compare', variableId: variables[0].id, operator: operators[match[2] as keyof typeof operators], value };
}

export function textCondition(project: Project, condition: Condition): string {
  if (condition.kind !== 'compare') return JSON.stringify(condition);
  const variable = project.variables.find(variable => variable.id === condition.variableId);
  const operator = { eq: '==', ne: '!=', gt: '>', gte: '>=', lt: '<', lte: '<=' }[condition.operator];
  return `${variable ? variable.name + '【' + variable.id + '】' : condition.variableId} ${operator} ${variable?.type === 'asset' ? JSON.stringify(parameterAssetText(project, variable, condition.value)) : typeof condition.value === 'string' ? JSON.stringify(condition.value) : typeof condition.value === 'boolean' ? condition.value ? '是' : '否' : condition.value}`;
}
