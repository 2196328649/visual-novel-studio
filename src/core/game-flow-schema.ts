import { z } from 'zod';
import { uiPageOpeningSchema } from './ui-page-opening-schema';
import { flowTransitionSchema } from './flow-transition-schema';

const id = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/);
const values = z.record(z.string(), z.union([z.string(), z.number().finite(), z.boolean()]));
const common = { id, name: z.string().max(120).optional(), allowSkip: z.boolean().default(false) };
export const gameFlowStepSchema = z.discriminatedUnion('kind', [
  z.object({ ...common, kind: z.literal('page'), pageId: z.union([id, z.string().regex(/^ui:[a-zA-Z]+$/)]), saveMode: z.enum(['save', 'load']).optional(), wait: z.boolean().default(true), modal: z.boolean().optional(), opening: uiPageOpeningSchema.optional(), completion: z.enum(['close', 'auto', 'confirm']).default('close'), duration: z.number().min(.05).max(3600).default(2), cancel: z.enum(['continue', 'title']).default('continue'), inputs: values.optional() }),
  z.object({ ...common, kind: z.literal('blueprint'), graphId: id, inputs: values.optional() }),
  z.object({ ...common, kind: z.literal('video'), assetId: id }),
]);
export const gameFlowSchema = z.object({
  schemaVersion: z.literal(1),
  beforeTitle: z.object({ repeat: z.enum(['launch', 'title', 'profile', 'version']).default('launch'), revision: z.string().max(120).default('1'), steps: z.array(gameFlowStepSchema).max(64).default([]) }),
  beforeNewGame: z.array(gameFlowStepSchema).max(64).default([]),
  // Absent in older projects: derive the original sequential connections.
  // Once edited, this is the complete set of authored continuation wires.
  connections: z.record(z.string(), z.string()).optional(),
  // The single next outlet belongs to its canonical source, not its destination
  // or the derived canvas edge. Retain obsolete keys for diagnosis and removal.
  transitions: z.record(z.string(), flowTransitionSchema).optional(),
  positions: z.record(z.string(), z.object({ x: z.number().finite(), y: z.number().finite() })).optional(),
});
export type GameFlowStep = z.infer<typeof gameFlowStepSchema>;
export type GameFlow = z.infer<typeof gameFlowSchema>;
export type GameFlowPhase = 'beforeTitle' | 'beforeNewGame';
export const gameFlowPhaseNames = { beforeTitle: '标题前流程', beforeNewGame: '新游戏前流程' } as const;
export const gameFlowRepeatNames = { launch: '每次应用启动', title: '每次进入标题', profile: '本机玩家资料首次', version: '指定版本首次' } as const;
