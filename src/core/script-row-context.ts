import type { Project, StoryLine } from './model';

// These fields affect only their own row. Actions, identities, order and every
// resource remain dependencies of other rows (e.g. actor instance suggestions).
const ownLineFields = new Set(['text', 'textPresentation', 'textSpans', 'textPauses']);
function sameFields(a: object, b: object, ignored: ReadonlySet<string>) {
  const before = a as Record<string, unknown>, next = b as Record<string, unknown>;
  const keys = Object.keys(before).filter(key => !ignored.has(key));
  return keys.length === Object.keys(next).filter(key => !ignored.has(key)).length
    && keys.every(key => Object.hasOwn(next, key) && before[key] === next[key]);
}
const storyFields = new Set(['nodes', 'scriptText']);
const passageFields = new Set(['lines']);
const sameLines = (a: StoryLine[], b: StoryLine[]) => a === b || a.length === b.length
  && a.every((line, index) => line === b[index] || sameFields(line, b[index], ownLineFields));

/** Immutable module-row dependencies. Each row also receives its own exact line.
 * A new resource, stage action, story link or unknown field invalidates the cache;
 * sibling prose and text looks do not change the row's controls or choices. */
export function sameScriptRowContext(before: Project, next: Project): boolean {
  return before === next || sameFields(before, next, storyFields)
    && (before.nodes === next.nodes || before.nodes.length === next.nodes.length
      && before.nodes.every((node, index) => {
        const other = next.nodes[index];
        return node === other || node.kind === 'passage' && other.kind === 'passage'
          && sameFields(node, other, passageFields) && sameLines(node.lines, other.lines);
      }));
}
