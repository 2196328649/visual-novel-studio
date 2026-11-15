import { z } from 'zod';

/** Defaults live on the page; a use may override them without duplicating it. */
export const uiPageOpeningSchema = z.object({
  presentation: z.enum(['page', 'overlay']).optional(),
  wait: z.boolean().optional(),
  input: z.enum(['block', 'controls', 'none']).optional(),
  lifetime: z.enum(['owner', 'scene', 'game']).optional(),
  closeOnEscape: z.boolean().optional(),
  autoClose: z.number().finite().nonnegative().optional(),
});
export type UiPageOpening = z.infer<typeof uiPageOpeningSchema>;
export type ResolvedUiPageOpening = Required<UiPageOpening>;
