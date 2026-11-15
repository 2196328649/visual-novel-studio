import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { spineAndroidAbis, spineRuntimeAbi } from '../../src/runtime/spine-bundle';

/** File-integrity fixture only, never loaded as native code. Actual ABI/render
 * behavior remains covered by the real C runtime acceptance scripts. */
export async function writeSpineBundleFixture(root: string, contents: (abi: string) => string = abi => abi) {
  const write = async (relative: string, value: string) => { const file = path.join(root, relative); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, value); };
  const hash = (value: string) => createHash('sha256').update(value).digest('hex');
  await write('vns_spine.py', 'SPINE_ABI = ' + spineRuntimeAbi + '\n');
  await write('vns_spine.dll', contents('windows-x86_64'));
  await write('build.json', JSON.stringify({ abi: spineRuntimeAbi, sha256: hash(contents('windows-x86_64')) }));
  const files: Record<string, string> = {};
  for (const abi of spineAndroidAbis) { const source = contents(abi); await write('android/' + abi + '/libvns_spine.so', source); files[abi] = hash(source); }
  await write('android/build.json', JSON.stringify({ abi: spineRuntimeAbi, files }));
}