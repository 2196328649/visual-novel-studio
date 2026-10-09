import { build } from 'esbuild';
import { builtinModules } from 'node:module';

const result = await build({ entryPoints: ['src/desktop/main.ts', 'src/desktop/preload.ts'], outdir: 'dist-desktop', outExtension: { '.js': '.cjs' }, bundle: true, platform: 'node', format: 'cjs', external: ['electron'], target: 'node22', sourcemap: true, metafile: true });
// The release contains bundled code, not duplicate copies of its development dependencies.
// Fail the build if a future external dependency would need node_modules at runtime.
const allowed = new Set(['electron', ...builtinModules, ...builtinModules.map(name => `node:${name}`)]);
const missing = [...new Set(Object.values(result.metafile.outputs).flatMap(output => output.imports)
  .filter(item => item.external && !allowed.has(item.path)).map(item => item.path))];
if (missing.length) throw new Error(`Unbundled desktop dependencies: ${missing.join(', ')}. Bundle them or explicitly include them in the release.`);
