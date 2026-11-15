/** Paths are relative to the project root, including when reading a nested value. */
export type AiProjectPath = readonly (string | number | { id: string })[];

const assetFileFields = new Set(['path', 'sourcePath', 'externalPath', 'externalFiles']);
const listItem = (segment: AiProjectPath[number] | undefined) => typeof segment === 'number'
  || typeof segment === 'object' && segment !== null
  || typeof segment === 'string' && /^\d+$/.test(segment);

/** Hide stored file locations without removing author-defined names or property paths. */
export function isPrivateAiProjectPath(path: AiProjectPath): boolean {
  if (path[0] === 'scriptText') return true;
  if (path[0] === 'exportSettings' && path[1] === 'directory') return true;
  if (path[0] !== 'assets' || !listItem(path[1])) return false;
  if (typeof path[2] === 'string' && assetFileFields.has(path[2])) return true;
  return path[2] === 'spine' && (path[3] === 'atlasPath'
    || path[3] === 'pages' && listItem(path[4]) && path[5] === 'path');
}

/** Detach public project data. Partial reads retain their original project path. */
export function scrubAiProject(value: unknown, path: AiProjectPath = []): any {
  if (isPrivateAiProjectPath(path)) return undefined;
  if (Array.isArray(value)) return value.map((item, index) => scrubAiProject(item, [...path, index]));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).flatMap(([key, item]) => {
      const publicValue = scrubAiProject(item, [...path, key]);
      return publicValue === undefined ? [] : [[key, publicValue]];
    }));
  }
  return value;
}
