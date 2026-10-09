import { z } from 'zod';
import { projectSchema, themeSchema, uiComponentSchema, uiInstanceSchema, customUiPageSchema, uiComponentLimit } from './model';

// AI may inspect incomplete UI authoring states. Only cross-field UI checks are
// deferred here; field types, ranges, IDs and collection limits remain enforced.
// Final proposed changes still use projectSchema and project validation.
const components=z.array(z.object(uiComponentSchema.shape)).max(uiComponentLimit).default([]);
export const aiDraftProjectSchema=z.object(projectSchema.shape).extend({ui:themeSchema.extend({
 components,
 instances:z.array(uiInstanceSchema.extend({components})).max(64).optional(),
 customPages:z.array(customUiPageSchema.extend({components})).max(64).default([]),
})});
