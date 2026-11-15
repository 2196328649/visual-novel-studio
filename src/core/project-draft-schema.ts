import { z } from 'zod';
import { projectSchema, themeSchema, uiComponentSchema, uiInstanceSchema, customUiPageSchema, uiComponentLimit } from './model';

// Drafts may contain unfinished UI bindings and hierarchy edits. Keep field
// validation while deferring cross-field checks until the author saves.
const components = z.array(z.object(uiComponentSchema.shape)).max(uiComponentLimit).default([]);
export const projectDraftSchema = z.object(projectSchema.shape).extend({ ui: themeSchema.extend({
  components,
  instances: z.array(uiInstanceSchema.extend({ components })).max(64).optional(),
  customPages: z.array(customUiPageSchema.extend({ components })).max(64).default([]),
}) });

export const projectRecoveryOptionsSchema = z.object({
  uiDraft: projectDraftSchema.optional(),
  projectDirty: z.boolean().optional(),
  clear: z.boolean().optional(),
});
