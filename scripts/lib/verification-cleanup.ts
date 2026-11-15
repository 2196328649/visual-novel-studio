import { promises as fs } from 'node:fs';
import path from 'node:path';

export interface VerificationCleanup { removed: string[]; absent: string[]; errors: { path: string; error: string }[] }
const inside = (parent: string, child: string) => {
  const relative = path.relative(parent, child);
  return relative !== '' && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
};

/** Only explicitly named, resolved children of this run can be removed. Reports,
 * screenshots and authored source remain; never follow a junction out of the run. */
export async function cleanVerificationDirectories(output: string, names: readonly string[]): Promise<VerificationCleanup> {
  const workspace = await fs.realpath(path.resolve('.'));
  const root = await fs.realpath(path.resolve(output));
  if (!inside(workspace, root)) throw new Error('Verification output must be inside the workspace: ' + root);
  const result: VerificationCleanup = { removed: [], absent: [], errors: [] };
  // Resolve and check the entire list before deleting anything.
  const targets: string[] = [];
  for (const name of names) {
    const candidate = path.resolve(root, name);
    if (!inside(root, candidate)) throw new Error('Refusing non-child cleanup target: ' + candidate);
    try {
      const resolved = await fs.realpath(candidate);
      if (!inside(root, resolved)) throw new Error('Refusing cleanup outside run: ' + resolved);
      targets.push(candidate);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') result.absent.push(candidate);
      else throw error;
    }
  }
  for (const target of targets) {
    try { await fs.rm(target, { recursive: true, force: true, maxRetries: 4, retryDelay: 200 }); result.removed.push(target); }
    catch (error) { result.errors.push({ path: target, error: String(error) }); }
  }
  await fs.writeFile(path.join(root, 'cleanup.json'), JSON.stringify(result, null, 2));
  return result;
}
