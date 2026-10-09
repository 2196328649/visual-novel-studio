import { createContext } from 'react';
import type { VisualEditing } from './VisualObjectPreview';

export const CompositionEditingContext = createContext<VisualEditing | undefined>(undefined);
