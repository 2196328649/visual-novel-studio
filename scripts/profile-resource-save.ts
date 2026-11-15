import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { build as bundle, type Plugin } from 'esbuild';
import { assetFiles, type Project } from '../src/core/model';
import { relocateProjectAssets, type AssetRelocation } from '../src/core/asset-relocation';
import { assetSourcePath, containedPath, parseProject } from '../src/desktop/project-store';
import { resourcePathLedger } from '../src/desktop/resource-paths';
import type { ProjectSession } from '../src/core/bridge';
import { cleanVerificationDirectories } from './lib/verification-cleanup';

// Run only after all product changes are implemented. The baseline replaces
// resource-layout.ts inside an isolated bundle, never in the working checkout.
// Preparation and byte verification are outside the timed save. Fresh projects
// measure the first folder synchronization, not a cold operating-system cache.
// Example (run from editor after the unified implementation freeze):
// corepack pnpm exec tsx scripts/profile-resource-save.ts --layout imported
// --layout authored keeps referenced paths and ledger, not an entire disk image.
// Neither mode measures Save As, copies unreferenced collision files, nor starts
// the game. External members are listed but are outside the save measurement.
const workspace = path.resolve('.');
const option = (name: string) => {
  const inline = process.argv.find(value => value.startsWith(name + '='));
  const at = process.argv.indexOf(name);
  const value = inline?.slice(name.length + 1) ?? (at < 0 ? undefined : process.argv[at + 1]);
  if (inline !== undefined || at >= 0) assert.ok(value && !value.startsWith('--'), name + ' requires a value.');
  return value;
};
const sourceFile = path.resolve(option('--source') ?? process.env.VNS_AUTHOR_PROJECT ?? '../我的视觉小说1/project.vns.json');
const sourceRoot = path.dirname(sourceFile);
const baselineRoot = path.resolve(option('--baseline-root') ?? 'artifacts/editor-refinements-2026-11-10/baseline-source');
const artifactRoot = path.resolve(option('--artifact-root') ?? 'artifacts/editor-refinements-2026-11-10/resource-save');
const layout = option('--layout') ?? 'imported';
assert.ok(layout === 'authored' || layout === 'imported', '--layout must be authored or imported.');
const order = (option('--order') ?? 'baseline,current,current,baseline').split(',');
assert.ok(order.length > 0 && order.length <= 8 && order.every(value => value === 'baseline' || value === 'current'), '--order must contain 1–8 baseline/current entries.');
type Variant = 'baseline' | 'current';
const variants = [...new Set(order)] as Variant[];
const output = path.join(artifactRoot, new Date().toISOString().replaceAll(':', '-') + '-' + randomUUID().slice(0, 8));
const relativeModule = 'src/desktop/resource-layout.ts';
const profileKey = '__vnsResourceSaveProfile_20261110';
const normalize = (file: string) => path.resolve(file).replaceAll('\\', '/').toLowerCase();
const sha256 = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
const digest = async (file: string) => {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
};
const inside = (root: string, target: string) => {
  const relative = path.relative(root, target);
  return relative !== '' && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
};
const sameOrInside = (root: string, target: string) => normalize(root) === normalize(target) || inside(root, target);
const overlaps = (left: string, right: string) => sameOrInside(left, right) || inside(right, left);

// Resolve existing ancestors before any mkdir. A junction below artifacts must
// not cause even a temporary directory to be created in the read-only project.
async function resolveFuturePath(target: string) {
  let ancestor = path.resolve(target);
  for (;;) {
    try {
      await fs.lstat(ancestor);
      return { ancestor, real: path.resolve(await fs.realpath(ancestor), path.relative(ancestor, target)) };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      // A dangling link exists but cannot be resolved; do not walk through it.
      const link = await fs.lstat(ancestor).catch(linkError => { if ((linkError as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw linkError; });
      assert.ok(!link, 'Profiling output crosses an unresolved link: ' + ancestor);
      const parent = path.dirname(ancestor);
      assert.notEqual(parent, ancestor, 'Profiling output has no existing ancestor.');
      ancestor = parent;
    }
  }
}

async function prepareOutput() {
  const artifacts = path.join(workspace, 'artifacts');
  assert.ok(inside(artifacts, output), 'Profiling output must be a new child of this workspace’s artifacts directory.');
  const realWorkspace = await fs.realpath(workspace), realSourceRoot = await fs.realpath(sourceRoot);
  const realSourceFile = await fs.realpath(sourceFile);
  const artifactsTarget = await resolveFuturePath(artifacts), outputTarget = await resolveFuturePath(output);
  assert.equal(normalize(artifactsTarget.real), normalize(path.join(realWorkspace, 'artifacts')), 'The artifacts root must not redirect to another directory.');
  assert.ok(inside(artifactsTarget.real, outputTarget.real), 'Profiling output must not follow a link outside artifacts.');
  assert.ok(!overlaps(outputTarget.real, realSourceRoot), 'Profiling output and the read-only project must not overlap.');
  assert.ok(!sameOrInside(outputTarget.real, realSourceFile), 'Profiling output must not contain the real source project file.');
  assert.equal(normalize(outputTarget.real), normalize(path.resolve(realWorkspace, path.relative(workspace, output))), 'Profiling output must not cross directory aliases.');
  await fs.mkdir(artifactRoot, { recursive: true });
  assert.equal(normalize(await fs.realpath(artifactRoot)), normalize(path.dirname(outputTarget.real)));
  await fs.mkdir(output); // Exclusive creation: never reuse another run's directory.
  assert.equal(normalize(await fs.realpath(output)), normalize(outputTarget.real));
  return { realSourceRoot, realSourceFile };
}

interface SourceResource { source: string; realSource: string; size: number; sha256: string }
interface ResourceReference { assetId: string; original: string; fixture: string; source: string; exists: boolean }
interface Materialization { source: string; relative: string }
interface Mark { name: string; ms: number; details?: Record<string, number> }
interface CopySample { source: string; destination: string; startMs: number; durationMs: number; bytes: number; asset: boolean; error?: string }
interface SaveSample {
  name: string; totalMs: number; stages: Record<string, number | null>; marks: Mark[]; copies: CopySample[];
  copiedAssetBytes: number; assetCopyAttempts: number; maxCopiesInFlight: number;
  projectSha256: string; resourceReport: ProjectSession['resourceReport'];
}
interface ProfileStore { saveProject: (file: string, project: Project) => Promise<ProjectSession> }
const resources = new Map<string, SourceResource>();
const materializations = new Map<string, Materialization>();
const references: ResourceReference[] = [];
const externalReferences: { assetId: string; original: string; source: string }[] = [];
const sourceAliases: { source: string; realSource: string }[] = [];
const runNames: string[] = [];
const checks: string[] = [];
const runs: { variant: Variant; directory: string; setupMs: number; verificationMs: number; samples: SaveSample[] }[] = [];
const report: Record<string, unknown> = {
  status: 'preparing', sourceFile, baselineRoot, output, layout, order, checks, runs,
  scope: 'Only resource-layout.ts differs between baseline and current bundles. Project parsing, durable writes, assets and all other source modules are identical.',
  measurement: 'First and subsequent same-directory saves of a fresh isolated project, not Save As. Fixture copying and independent SHA256 verification are excluded; the product’s own hashes, metadata checks, durable writes and cleanup remain timed. Preparation warms the OS file cache; these are not disk-cold measurements. Unreferenced files and their destination conflicts are not reproduced.',
  copyMetric: 'maxCopiesInFlight counts overlapping fs.copyFile calls, not the full copy-plus-hash worker interval. Asset byte totals exclude failed/EEXIST attempts and the project backup. The default two runs per variant are descriptive observations, not a latency percentile.',
  layoutMeaning: layout === 'imported'
    ? 'Fully internal assets are staged below assets/__save_profile_import__; Spine groups keep original member structure in separate group directories. Assets with external members retain internal paths and their ledger because the product skips organizing those groups. Source links are materialized as ordinary files and reported. This measures simulated initial organization, not the author’s on-disk layout.'
    : 'Referenced internal paths and the resource ledger are preserved; unreferenced files are not copied, so this is not a complete directory mirror. Internal filesystem aliases are rejected rather than silently flattened. External members remain references and are excluded from timing and byte auditing. Folder synchronization follows the author’s setting.',
};
let phase = 'output safety', sourceBytes: Buffer | undefined, sourceLedgerBytes: Buffer | undefined;
let ledgerCaptured = false, outputReady = false, snapshotComplete = false;
let primaryError: unknown, hadPrimaryError = false;
const finalizationErrors: { phase: string; error: string }[] = [];
const writeReport = () => fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));

function replaceOnce(source: string, marker: string, replacement: string) {
  assert.equal(source.split(marker).length, 2, 'Profiling marker must match exactly once: ' + marker);
  return source.replace(marker, replacement);
}

function instrument(source: string) {
  const declaration = 'export async function prepareResourceLayout(root: string, project: Project) {';
  source = replaceOnce(source, declaration, declaration + `\n  const __resourceSaveProfile = (globalThis as any)[${JSON.stringify(profileKey)}];\n  __resourceSaveProfile?.mark('prepare-start');`);
  const preflight = '  const next = relocateProjectAssets(project, relocations);';
  source = replaceOnce(source, preflight, preflight + "\n  __resourceSaveProfile?.mark('preflight-end', { plans: plans.length, relocations: relocations.length, skipped: skipped.length });");
  const ledger = '  if (plans.length) {';
  source = replaceOnce(source, ledger, "  __resourceSaveProfile?.mark('copies-end');\n" + ledger);
  const finish = '  return { project: next, relocations, skipped, finish: async () => {';
  source = replaceOnce(source, finish, "  __resourceSaveProfile?.mark('prepare-end');\n" + finish + "\n    __resourceSaveProfile?.mark('finish-start');");
  const retained = '    return retained;';
  return replaceOnce(source, retained, "    __resourceSaveProfile?.mark('finish-end', { retained: retained.length });\n" + retained);
}

async function makeStore(variant: Variant, source: string): Promise<ProfileStore> {
  let replacements = 0;
  const override: Plugin = { name: 'resource-save-profile-' + variant, setup(build) {
    build.onLoad({ filter: /[\\/]src[\\/]desktop[\\/]resource-layout\.ts$/ }, args => {
      assert.equal(normalize(args.path), normalize(path.join(workspace, relativeModule)));
      replacements++;
      return { contents: instrument(source), loader: 'ts', resolveDir: path.dirname(args.path) };
    });
  } };
  const result = await bundle({ entryPoints: [path.join(workspace, 'src/desktop/project-store.ts')], bundle: true, packages: 'external', platform: 'node', format: 'esm', target: 'node22', write: false, logLevel: 'silent', plugins: [override] });
  assert.equal(replacements, 1, 'The saved baseline must replace exactly the live resource-layout module.');
  const destination = path.join(output, 'profile-modules', variant + '.mjs');
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.writeFile(destination, result.outputFiles[0].contents);
  const loaded = await import(pathToFileURL(destination).href) as ProfileStore;
  assert.equal(typeof loaded.saveProject, 'function');
  (report.bundles as Record<string, unknown>)[variant] = { sourceSha256: sha256(source), bundleSha256: sha256(Buffer.from(result.outputFiles[0].contents)) };
  return loaded;
}

async function measure(store: ProfileStore, file: string, project: Project, name: string, fileSizes: Map<string, number>): Promise<{ sample: SaveSample; session: ProjectSession }> {
  const root = path.dirname(file), marks: Mark[] = [], copies: CopySample[] = [];
  fileSizes.set(normalize(file), (await fs.stat(file)).size);
  const originalCopy = fs.copyFile;
  const globals = globalThis as Record<string, unknown>, previousHook = globals[profileKey];
  const hadHook = Object.hasOwn(globals, profileKey);
  let active = 0, maximum = 0;
  const pendingCopies = new Set<Promise<void>>();
  const start = performance.now();
  globals[profileKey] = { mark: (name: string, details?: Record<string, number>) => marks.push({ name, ms: performance.now() - start, ...(details ? { details } : {}) }) };
  const asPath = (value: Parameters<typeof fs.copyFile>[0]) => typeof value === 'string' ? value : value instanceof URL ? fileURLToPath(value) : value.toString();
  fs.copyFile = (...args: Parameters<typeof fs.copyFile>) => {
    const source = asPath(args[0]), destination = asPath(args[1]);
    const started = performance.now();
    const sample: CopySample = { source: path.relative(root, source), destination: path.relative(root, destination), startMs: started - start, durationMs: 0, bytes: fileSizes.get(normalize(source)) ?? 0, asset: normalize(source) !== normalize(file) };
    copies.push(sample); active++; maximum = Math.max(maximum, active);
    const operation = (async () => {
      try { await originalCopy(...args); fileSizes.set(normalize(destination), sample.bytes); }
      catch (error) { sample.error = (error as NodeJS.ErrnoException).code ?? String(error); throw error; }
      finally { sample.durationMs = performance.now() - started; active--; }
    })();
    pendingCopies.add(operation);
    void operation.then(() => pendingCopies.delete(operation), () => pendingCopies.delete(operation));
    return operation;
  };
  try {
    const session = await store.saveProject(file, project), totalMs = performance.now() - start;
    assert.equal(active, 0, 'No copy may outlive a completed save.');
    const timing = (from: string, to: string) => {
      const a = marks.find(mark => mark.name === from)?.ms, b = marks.find(mark => mark.name === to)?.ms;
      return a === undefined || b === undefined ? null : b - a;
    };
    const sample: SaveSample = {
      name, totalMs, marks, copies,
      stages: {
        beforePrepareMs: marks.find(mark => mark.name === 'prepare-start')?.ms ?? null,
        preflightMs: timing('prepare-start', 'preflight-end'), copyAndDestinationHashMs: timing('preflight-end', 'copies-end'),
        ledgerMs: timing('copies-end', 'prepare-end'), totalPrepareMs: timing('prepare-start', 'prepare-end'),
        durableProjectWriteMs: timing('prepare-end', 'finish-start'), sourceVerificationAndCleanupMs: timing('finish-start', 'finish-end'),
      },
      copiedAssetBytes: copies.filter(copy => copy.asset && !copy.error).reduce((sum, copy) => sum + copy.bytes, 0),
      assetCopyAttempts: copies.filter(copy => copy.asset).length, maxCopiesInFlight: maximum,
      projectSha256: sha256(JSON.stringify(session.project)), resourceReport: session.resourceReport,
    };
    return { sample, session };
  } catch (error) {
    report.failedSave = { name, totalMs: performance.now() - start, activeCopiesAtFailure: active, marks, copies, error: String(error) };
    throw error;
  } finally {
    // Keep the forwarding wrapper installed until every observed native copy
    // settles, even when profiling a version that rejects its save too early.
    while (pendingCopies.size) await Promise.allSettled([...pendingCopies]);
    fs.copyFile = originalCopy;
    if (hadHook) globals[profileKey] = previousHook; else delete globals[profileKey];
  }
}

try {
  const { realSourceRoot } = await prepareOutput();
  outputReady = true; phase = 'snapshot';
  sourceBytes = await fs.readFile(sourceFile);
  sourceLedgerBytes = await fs.readFile(path.join(sourceRoot, resourcePathLedger)).catch(error => { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; });
  ledgerCaptured = true;
  const author = parseProject(JSON.parse(sourceBytes.toString('utf8'))).project;
  report.sourceSha256 = sha256(sourceBytes);
  report.sourceLedgerSha256 = sourceLedgerBytes ? sha256(sourceLedgerBytes) : null;
  const initial = structuredClone(author), relocations: AssetRelocation[] = [];
  let needsLedger = layout === 'authored';
  for (const [assetIndex, asset] of author.assets.entries()) {
    const hasExternalMembers = !!asset.externalPath || Object.keys(asset.externalFiles ?? {}).length > 0;
    const importAsset = layout === 'imported' && !hasExternalMembers;
    if (hasExternalMembers) needsLedger = true;
    const mappings: Record<string, string> = {};
    for (const original of assetFiles(asset)) {
      const source = assetSourcePath(sourceRoot, asset, original);
      if (asset.externalFiles?.[original] || (original === asset.path && asset.externalPath)) {
        externalReferences.push({ assetId: asset.id, original, source });
        continue;
      }
      const relative = path.relative(sourceRoot, source).replaceAll('\\', '/');
      // No source file is ever used as a write target. All materialized paths
      // must also pass the product's contained-path check before any copy.
      assert.equal(normalize(containedPath(sourceRoot, relative)), normalize(source));
      const fixture = !importAsset ? original : asset.spine
        ? `assets/__save_profile_import__/spine-${assetIndex}/${original.replaceAll('\\', '/')}`
        : 'assets/__save_profile_import__/files/' + relative;
      containedPath(output, fixture);
      const info = await fs.stat(source).catch(error => { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; });
      const exists = !!info?.isFile();
      references.push({ assetId: asset.id, original, fixture, source, exists });
      if (importAsset) mappings[original] = fixture;
      if (exists) {
        if (!resources.has(normalize(source))) {
          const realSource = await fs.realpath(source);
          assert.ok(inside(realSourceRoot, realSource), 'An internal source reference resolves outside the source project: ' + source);
          assert.ok(!sameOrInside(await fs.realpath(output), realSource), 'A source resource may not be inside the profile output.');
          if (normalize(realSource) !== normalize(path.resolve(realSourceRoot, relative))) sourceAliases.push({ source, realSource });
          resources.set(normalize(source), { source, realSource, size: info!.size, sha256: await digest(source) });
        }
        // One resolved source can serve both an unchanged mixed group and an
        // imported asset. They need different physical fixture destinations.
        const destination = importAsset ? fixture : relative;
        const destinationKey = normalize(containedPath(output, destination));
        const previous = materializations.get(destinationKey);
        if (previous) assert.equal(resources.get(normalize(previous.source))!.sha256, resources.get(normalize(source))!.sha256, 'Two fixture files may not overwrite different source bytes.');
        else materializations.set(destinationKey, { source, relative: destination });
      }
    }
    if (Object.keys(mappings).length) relocations.push({ assetId: asset.id, files: mappings });
  }
  snapshotComplete = true;
  const fixture = relocateProjectAssets(initial, relocations);
  if (layout === 'imported') fixture.resourceSettings = { importMode: 'copy', directory: 'assets', ...fixture.resourceSettings, syncFolders: true };
  const ledgerBytes = needsLedger ? sourceLedgerBytes : undefined;
  report.fixture = {
    projectSha256: sha256(JSON.stringify(fixture)), assets: fixture.assets.length,
    internalAssets: new Set(references.map(reference => reference.assetId)).size,
    references: references.length, uniqueFiles: resources.size, bytes: [...resources.values()].reduce((sum, resource) => sum + resource.size, 0),
    materializedFiles: materializations.size, materializedBytes: [...materializations.values()].reduce((sum, item) => sum + resources.get(normalize(item.source))!.size, 0),
    missing: references.filter(reference => !reference.exists), syncFolders: fixture.resourceSettings?.syncFolders !== false,
    ledgerSha256: ledgerBytes ? sha256(ledgerBytes) : null, externalReferences, flattenedSourceAliases: sourceAliases,
  };
  await fs.writeFile(path.join(output, 'source-resources.json'), JSON.stringify({ resources: [...resources.values()], references, materializations: [...materializations.values()], externalReferences, sourceAliases }, null, 2));
  assert.ok(layout !== 'authored' || sourceAliases.length === 0, 'Authored profiling cannot flatten internal filesystem aliases; use imported mode for a reported synthetic layout.');
  phase = 'bundle'; report.bundles = {};
  const moduleSources = Object.fromEntries(await Promise.all(variants.map(async variant => [variant, await fs.readFile(path.join(variant === 'baseline' ? baselineRoot : workspace, relativeModule), 'utf8')]))) as Record<Variant, string>;
  if (variants.length === 2) assert.notEqual(moduleSources.baseline, moduleSources.current, 'A baseline comparison needs an actual product change.');
  const stores = new Map<Variant, ProfileStore>();
  for (const variant of variants) stores.set(variant, await makeStore(variant, moduleSources[variant]));
  let expectedProject: Project | undefined;
  report.status = 'running';
  await writeReport();
  for (const [index, value] of order.entries()) {
    const variant = value as Variant, directory = `run-${index + 1}-${variant}`, root = path.join(output, directory);
    runNames.push(directory); phase = directory + '/prepare';
    const setupStart = performance.now(), fileSizes = new Map<string, number>();
    await fs.mkdir(root, { recursive: true });
    assert.ok(inside(await fs.realpath(output), await fs.realpath(root)), 'Each fixture must remain inside this profile run.');
    for (const { source, relative } of materializations.values()) {
      const resource = resources.get(normalize(source))!;
      const destination = containedPath(root, relative);
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await fs.copyFile(source, destination, fs.constants.COPYFILE_EXCL);
      fileSizes.set(normalize(destination), resource.size);
      assert.equal(await digest(destination), resource.sha256, 'Fixture preparation must preserve every byte: ' + relative);
    }
    if (ledgerBytes) { const ledger = containedPath(root, resourcePathLedger); await fs.mkdir(path.dirname(ledger), { recursive: true }); await fs.writeFile(ledger, ledgerBytes, { flag: 'wx' }); }
    const file = path.join(root, 'project.vns.json');
    await fs.writeFile(file, JSON.stringify(fixture, null, 2) + '\n', { flag: 'wx' });
    const run = { variant, directory, setupMs: performance.now() - setupStart, verificationMs: 0, samples: [] as SaveSample[] };
    runs.push(run);
    phase = directory + '/first-save';
    const first = await measure(stores.get(variant)!, file, structuredClone(fixture), 'first-save', fileSizes);
    run.samples.push(first.sample);
    console.log(JSON.stringify({ run: directory, name: first.sample.name, totalMs: first.sample.totalMs, stages: first.sample.stages, copiedAssetBytes: first.sample.copiedAssetBytes, maxCopiesInFlight: first.sample.maxCopiesInFlight }));
    phase = directory + '/subsequent-save';
    const subsequent = await measure(stores.get(variant)!, file, first.session.project, 'subsequent-save', fileSizes);
    run.samples.push(subsequent.sample);
    console.log(JSON.stringify({ run: directory, name: subsequent.sample.name, totalMs: subsequent.sample.totalMs, stages: subsequent.sample.stages, copiedAssetBytes: subsequent.sample.copiedAssetBytes }));
    phase = directory + '/verify'; const verificationStart = performance.now();
    assert.deepEqual(subsequent.session.project, first.session.project, 'A subsequent save must not change the authored project.');
    assert.equal(subsequent.sample.assetCopyAttempts, 0, 'A subsequent save must not copy already organized resources.');
    if (expectedProject) assert.deepEqual(first.session.project, expectedProject, 'Baseline and current saves must produce the same project.');
    else expectedProject = first.session.project;
    assert.deepEqual(parseProject(JSON.parse(await fs.readFile(file, 'utf8'))).project, first.session.project, 'The durable project must contain the returned snapshot.');
    const verified = new Map<string, string>();
    const savedRelocations = new Map((first.session.assetRelocations ?? []).map(item => [item.assetId, item.files]));
    const verifiedDigest = async (file: string) => {
      let value = verified.get(normalize(file));
      if (value === undefined) { value = await digest(file); verified.set(normalize(file), value); }
      return value;
    };
    for (const reference of references.filter(reference => reference.exists)) {
      const asset = first.session.project.assets.find(asset => asset.id === reference.assetId)!;
      const originalAsset = fixture.assets.find(asset => asset.id === reference.assetId)!;
      const savedRelative = savedRelocations.get(reference.assetId)?.[reference.fixture] ?? reference.fixture;
      assert.ok(assetFiles(asset).includes(savedRelative), 'Every internal reference must remain identifiable by asset ID and relocation.');
      const saved = assetSourcePath(root, asset, savedRelative), expectedHash = resources.get(normalize(reference.source))!.sha256;
      assert.equal(await verifiedDigest(saved), expectedHash, 'Saved bytes must match the source: ' + reference.original);
      const historical = assetSourcePath(root, originalAsset, reference.fixture);
      assert.equal(await verifiedDigest(historical), expectedHash, 'Old project references must retain this asset’s bytes after the move.');
    }
    run.verificationMs = performance.now() - verificationStart;
    checks.push(`${directory}: first/subsequent project and all ${references.filter(reference => reference.exists).length} resource references verified; subsequent save copied no assets.`);
    await fs.writeFile(path.join(output, directory + '.json'), JSON.stringify(run, null, 2));
    await writeReport();
  }
  const summary = Object.fromEntries(variants.map(variant => [variant, ['first-save', 'subsequent-save'].map(name => {
    const samples = runs.filter(run => run.variant === variant).flatMap(run => run.samples.filter(sample => sample.name === name));
    return { name, totalMs: samples.map(sample => sample.totalMs), copyAndDestinationHashMs: samples.map(sample => sample.stages.copyAndDestinationHashMs), copiedAssetBytes: samples.map(sample => sample.copiedAssetBytes) };
  })]));
  report.summary = summary; report.status = 'measured'; report.measurementStatus = 'passed';
  await writeReport();
  console.log(JSON.stringify(summary, null, 2));
} catch (error) {
  hadPrimaryError = true; primaryError = error;
  report.status = 'failed'; report.phase = phase; report.error = String(error);
  report.measurementStatus ??= 'failed';
} finally {
  const recordFinalizationError = (phase: string, error: unknown) => { finalizationErrors.push({ phase, error: String(error) }); };
  const sourceAudit: Record<string, unknown> = { snapshotComplete, checkedResources: resources.size, externalReferencesExcluded: externalReferences.length };
  if (sourceBytes) {
    try {
      const after = await fs.readFile(sourceFile);
      report.sourceSha256After = sha256(after); report.sourceUnchanged = after.equals(sourceBytes);
      assert.equal(report.sourceUnchanged, true, 'The read-only author project changed.');
      sourceAudit.project = 'unchanged';
    } catch (error) { sourceAudit.project = 'failed'; recordFinalizationError('source project integrity', error); }
  } else sourceAudit.project = 'not captured';
  if (ledgerCaptured) {
    try {
      const after = await fs.readFile(path.join(sourceRoot, resourcePathLedger)).catch(error => { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; });
      sourceAudit.ledgerSha256After = after ? sha256(after) : null;
      assert.ok(sourceLedgerBytes === undefined ? after === undefined : after?.equals(sourceLedgerBytes), 'The read-only source resource ledger changed.');
      sourceAudit.ledger = 'unchanged';
    } catch (error) { sourceAudit.ledger = 'failed'; recordFinalizationError('source ledger integrity', error); }
  } else sourceAudit.ledger = 'not captured';
  const sourceResults: { source: string; expectedSha256: string; actualSha256?: string; unchanged: boolean; error?: string }[] = [];
  for (const resource of resources.values()) {
    try {
      const actualSha256 = await digest(resource.source), unchanged = actualSha256 === resource.sha256;
      sourceResults.push({ source: resource.source, expectedSha256: resource.sha256, actualSha256, unchanged });
      if (!unchanged) recordFinalizationError('source resource integrity', 'The read-only source resource changed: ' + resource.source);
    } catch (error) {
      sourceResults.push({ source: resource.source, expectedSha256: resource.sha256, unchanged: false, error: String(error) });
      recordFinalizationError('source resource integrity', error);
    }
  }
  sourceAudit.resourcesUnchanged = sourceResults.every(result => result.unchanged);
  sourceAudit.status = sourceBytes && ledgerCaptured && snapshotComplete && !finalizationErrors.length ? 'passed' : 'incomplete-or-failed';
  report.sourceAudit = sourceAudit;
  if (outputReady) {
    try { await fs.writeFile(path.join(output, 'source-integrity.json'), JSON.stringify({ ...sourceAudit, resources: sourceResults }, null, 2)); }
    catch (error) { recordFinalizationError('source integrity report', error); }
    try {
      const cleanup = await cleanVerificationDirectories(output, ['profile-modules', ...runNames]);
      report.cleanup = cleanup;
      if (cleanup.errors.length) recordFinalizationError('cleanup', JSON.stringify(cleanup.errors));
    } catch (error) { report.cleanupError = String(error); recordFinalizationError('cleanup', error); }
  } else report.cleanup = { skipped: 'Output safety checks did not establish an owned run directory.' };
  report.finalizationErrors = finalizationErrors;
  report.status = hadPrimaryError || finalizationErrors.length ? 'failed' : 'passed';
  if (report.status === 'passed') checks.push('The source project, captured resource ledger and every copied internal source resource are unchanged; all run and bundle directories were removed.');
  if (outputReady) {
    try { await writeReport(); }
    catch (error) { recordFinalizationError('final report', error); report.status = 'failed'; console.error('Could not persist the final profile report:', error); }
    console.log(output);
  }
  if (hadPrimaryError || finalizationErrors.length) process.exitCode = 1;
}
if (hadPrimaryError) throw primaryError;
if (finalizationErrors.length) throw new Error('Profile finalization failed; see the source-integrity and cleanup records.');
