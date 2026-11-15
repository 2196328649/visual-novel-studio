import { z } from 'zod';

const seconds = z.number().finite().nonnegative();

/** An absent setting inherits the existing source/destination transition. */
export const flowTransitionSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('none') }),
  z.object({ mode: z.literal('dissolve'), duration: seconds }),
  z.object({ mode: z.literal('color'), outDuration: seconds, hold: seconds, inDuration: seconds, color: z.string().regex(/^#[0-9a-fA-F]{6}$/) }),
]).refine(transition => transition.mode !== 'color' || Number.isFinite(transition.outDuration + transition.hold + transition.inDuration), '过渡总时长必须是有限数值。');

export type FlowTransition = z.infer<typeof flowTransitionSchema>;

/** Keys are the real source port IDs, including choice and hotspot identities. */
export const flowTransitionsSchema = z.record(z.string().regex(/^[a-z][a-z0-9_]{0,63}$/), flowTransitionSchema);
