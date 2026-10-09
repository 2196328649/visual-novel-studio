import type { Condition, Project } from '../core/model';
import { pythonLiteral } from './literals';

export function variableReference(project: Project, variableId: string): string {
  const variable = project.variables.find(item => item.id === variableId);
  return `${variable?.persistent ? 'persistent.' : ''}vn_var_${variableId}`;
}

export function conditionExpression(project: Project, condition: Condition): string {
  switch (condition.kind) {
    case 'compare': {
      const operator = { eq: '==', ne: '!=', gt: '>', gte: '>=', lt: '<', lte: '<=' }[condition.operator];
      return `(${variableReference(project, condition.variableId)} ${operator} ${pythonLiteral(condition.value)})`;
    }
    case 'not': return `(not ${conditionExpression(project, condition.condition)})`;
    case 'all': return condition.conditions.length ? `(${condition.conditions.map(item => conditionExpression(project, item)).join(' and ')})` : 'True';
    case 'any': return condition.conditions.length ? `(${condition.conditions.map(item => conditionExpression(project, item)).join(' or ')})` : 'False';
  }
}
