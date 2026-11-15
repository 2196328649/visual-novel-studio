import type { BlueprintGraph, Project, VariableValue } from './model';
import { blueprintCapabilityNames, blueprintEnvironments, type BlueprintEnvironment } from './blueprint-capability-types';
import { blueprintNodeCapabilitySummary, callableBlueprintCapabilities, type CapabilityNode } from './blueprint-execution-analysis';
export { blueprintCapabilityNames, blueprintEnvironments, blueprintNodeCapabilities, type BlueprintCapability, type BlueprintEnvironment } from './blueprint-capability-types';

/** A callable summary starts at the call entry, never at unrelated UI events. */
export function blueprintCapabilitySummary(project: Project, graph: BlueprintGraph, inputs?: Record<string, VariableValue>) {
  return callableBlueprintCapabilities(project, graph, inputs);
}
export function blueprintRequiredCapabilities(project: Project, graph: BlueprintGraph) {
  return blueprintCapabilitySummary(project, graph).required;
}
export function blueprintCapabilityCheck(project: Project, node: CapabilityNode, environment: BlueprintEnvironment, callerGraph?: BlueprintGraph) {
  const summary = blueprintNodeCapabilitySummary(project, node, callerGraph);
  const missing = summary.required.filter(capability => !blueprintEnvironments[environment].includes(capability));
  const problem = missing.length ? '此节点需要' + missing.map(capability => blueprintCapabilityNames[capability]).join('、') + '，当前运行环境不提供这些能力。' : undefined;
  return { ...summary, problem };
}
export function blueprintCapabilityProblem(project: Project, node: CapabilityNode, environment: BlueprintEnvironment, callerGraph?: BlueprintGraph): string | undefined {
  return blueprintCapabilityCheck(project, node, environment, callerGraph).problem;
}
