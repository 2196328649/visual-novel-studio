import type { Project } from './model';

/** All text written by this editor uses explicit performance declarations.
 * Omitted version flags are reserved for reading genuinely old project files. */
export function currentScriptText(content: string, sourceName?: string): NonNullable<Project['scriptText']> {
  return { format: 'vns-text-1', content, sourceName, standaloneSyntax: 'module-names', performanceSyntax: 'explicit', playbackSyntax: 'inline' };
}
