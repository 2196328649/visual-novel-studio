import { promises as fs } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export async function prepareNotices() {
  const packages = new Map();
  async function collect(name, parentFile) {
    const require = createRequire(parentFile);
    let packageFile;
    try { packageFile = require.resolve(`${name}/package.json`); }
    catch {
      for (const directory of require.resolve.paths(name) ?? []) {
        const candidate = path.join(directory, name, 'package.json');
        const metadata = await fs.readFile(candidate, 'utf8').then(JSON.parse).catch(() => null);
        if (metadata?.name === name) { packageFile = candidate; break; }
      }
      if (!packageFile) throw new Error(`Cannot locate license metadata for ${name}`);
    }
    packageFile = await fs.realpath(packageFile);
    if (packages.has(packageFile)) return;
    const metadata = JSON.parse(await fs.readFile(packageFile, 'utf8'));
    const directory = path.dirname(packageFile);
    const names = (await fs.readdir(directory, { withFileTypes: true })).filter(file => file.isFile() && /^(licen[cs]e|copying|notice|copyright)([.-]|$)/i.test(file.name)).map(file => file.name).sort();
    const texts = [];
    for (const filename of names) texts.push(`${filename}\n${await fs.readFile(path.join(directory, filename), 'utf8')}`);
    if (!names.length && name === '@nodable/entities' && metadata.version === '3.0.0') texts.push(await fs.readFile(path.join(root, 'resources', 'licenses', 'nodable-entities-3.0.0.txt'), 'utf8'));
    if (!texts.length) throw new Error(`Missing license text for ${name}`);
    packages.set(packageFile, { metadata, texts });
    for (const dependency of Object.keys(metadata.dependencies ?? {})) await collect(dependency, packageFile);
  }
  const packageFile = path.join(root, 'package.json');
  const application = JSON.parse(await fs.readFile(packageFile, 'utf8'));
  for (const dependency of Object.keys(application.dependencies)) await collect(dependency, packageFile);
  const sections = ['Third-Party Notices', '', 'These unmodified dependencies are included in the editor. Their licenses apply to their respective components.', 'Electron notices are included beside the application executable. RenPy and its dependencies retain their notices in resources/runtime/LICENSE.txt.', 'Sample image, audio and font notices are in resources/SAMPLE-CREDITS.md and the bundled runtime.', 'ELK source code is available at https://github.com/kieler/elkjs and https://github.com/eclipse-elk/elk; the installed version is listed below.', ''];
  for (const { metadata, texts } of [...packages.values()].sort((a, b) => a.metadata.name.localeCompare(b.metadata.name))) {
    const repository = typeof metadata.repository === 'string' ? metadata.repository : metadata.repository?.url;
    sections.push(`${metadata.name} ${metadata.version}`, `License: ${typeof metadata.license === 'string' ? metadata.license : JSON.stringify(metadata.license)}`, `Source: ${repository ?? metadata.homepage ?? ''}`, '', ...texts, '', '-'.repeat(72), '');
  }
  const output = path.join(root, 'resources', 'THIRD-PARTY-NOTICES.txt');
  await fs.writeFile(output, sections.join('\n'), 'utf8');
  console.log(`Prepared notices for ${packages.size} dependency packages: ${output}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await prepareNotices();
