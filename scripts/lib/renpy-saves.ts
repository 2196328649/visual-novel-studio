import { promises as fs } from 'node:fs';
import path from 'node:path';

/** Ren'Py commands without --savedir (compile, lint) load the game's shared save
 * folder in %APPDATA%\RenPy, merge it into game/saves and write it back on quit.
 * The runtime test then reads game/saves too, so an author's earlier playthrough
 * leaks into the test, and the test overwrites the author's progress. Point every
 * Ren'Py process of this verification run at a private folder instead. */
export async function isolateRenpySaves(runDir: string): Promise<string> {
  const root = path.join(runDir, 'renpy-saves');
  await fs.mkdir(root, { recursive: true });
  process.env.RENPY_PATH_TO_SAVES = root;
  return root;
}
