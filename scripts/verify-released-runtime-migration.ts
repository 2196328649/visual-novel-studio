import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { ElectronApplication } from '@playwright/test';
import { declaredUiComponents, type Project } from '../src/core/model';
import { containedPath, loadProject, saveProject } from '../src/desktop/project-store';
import { buildProject, runRenpy } from '../src/runtime/service';
import { uiPageHostScreens } from '../src/core/ui-pages';
import { launchDesktopFixture } from './lib/desktop-fixture';
import { cleanVerificationDirectories } from './lib/verification-cleanup';
import { extractReleasedDistribution, sha256File } from './lib/released-distribution';
import { assertReleasedProjectIdentity, readReleasedProject } from './lib/released-project-fixture';
import { authorReleasedRuntimeFixture, releasedSchemes } from './lib/released-runtime-fixture';
import { releasedNativeCases, releasedProbeSource, releasedProducerTests, releasedConsumerTests } from './lib/released-native-cases';

if (process.env.VNS_INSTALLED_EXE) throw new Error('Historical acceptance runs the pinned archive in isolation, never the daily installation.');
const root = path.resolve('.'), sdk = process.env.VNS_RENPY_SDK ?? 'E:/Tools/renpy-8.5.3-sdk';
const output = path.resolve('artifacts/released-runtime-migration', new Date().toISOString().replaceAll(':', '-'));
const report: { status: string; scope: string; archive?: unknown; runs: unknown[]; checks: unknown[]; error?: string; cleanup?: unknown } = {
  status: 'running', scope: 'Untouched 0.8.0 example/aihong plus explicitly authored base/original/derived inputs. Producer uses the SHA-pinned released executable, compiler and bundled RenPy. Menus/confirmation save the base context, title is not saveable; missing 0.8.0 keyboard/game-over authoring is recorded as a historical limitation, not forged coverage.', runs: [], checks: [] };
await fs.mkdir(output, { recursive: true });
const saveReport = () => fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
async function check(name: string, result: { code: number; log: string }, expectedCases?: number) {
  const logPath = path.join(output, name + '.log'); await fs.writeFile(logPath, result.log);
  report.checks.push({ name, code: result.code, logPath, expectedCases }); await saveReport();
  assert.equal(result.code, 0, name + ': ' + result.log.slice(-12000));
  if (expectedCases !== undefined) assert.match(result.log, new RegExp('Test cases\\s*:\\s*' + expectedCases + '\\s*\\|\\s*' + expectedCases + ' passed'));
}
interface Snapshot { variables: Record<string, unknown>; overrides: Record<string, unknown>; openPages: Record<string, string>; screens: string[]; contexts: number; pageSchema?: number; migrations: unknown[] }
function compareRestored(before: Snapshot, after: Snapshot, project: Project) {
  assert.deepEqual(after.variables, before.variables, 'Old project state/callback counts must survive without replay.');
  assert.deepEqual(after.openPages, before.openPages); assert.equal(after.contexts, 1);
  const live = new Set(Object.keys(before.openPages));
  for (const [page, screens] of Object.entries(uiPageHostScreens)) if (screens.some(screen => before.screens.includes(screen))) live.add('ui:' + page);
  const owners = new Map(declaredUiComponents(project).map(component => [component.id, component.page === 'custom' ? project.ui.customPages.find(page => page.components.some(row => row.id === component.id))?.id : 'ui:' + component.page]));
  for (const [identity, value] of Object.entries(before.overrides)) {
    if (live.has(owners.get(identity) ?? '')) assert.deepEqual(after.overrides[identity], value, identity + ': restored live override');
    else assert.equal(Object.hasOwn(after.overrides, identity), false, identity + ': a closed/removed page cannot seed a new lifetime');
  }
}
async function digests(directory: string, accept: (file: string) => boolean, prefix = ''): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const relative = path.join(prefix, entry.name), full = path.join(directory, entry.name);
    if (entry.isDirectory()) Object.assign(result, await digests(full, accept, relative));
    else if (entry.isFile() && accept(relative)) result[relative] = await sha256File(full);
  }
  return result;
}
try {
  const release = await extractReleasedDistribution(root, output, path.join(sdk, 'lib/py3-windows-x86_64/python.exe'));
  report.archive = { ...release.archive, release: release.manifest.release, distribution: release.manifest.distribution };
  const scenarios = [
    ...release.manifest.projects.map(entry => ({ id: 'untouched_' + entry.id, entry, scheme: undefined })),
    ...releasedSchemes.map(scheme => ({ id: 'authored_' + scheme, entry: release.manifest.projects.find(entry => entry.id === 'example')!, scheme })),
  ];
  for (const scenario of scenarios) {
    const run = containedPath(output, scenario.id), work = path.join(run, 'work'), evidence = path.join(run, 'evidence');
    const source = path.join(work, 'source'), profile = path.join(work, 'profile'), oldGame = path.join(work, 'old-game'), nextGame = path.join(work, 'upgraded-game'), saves = path.join(work, 'saves');
    await fs.mkdir(evidence, { recursive: true }); await fs.mkdir(work, { recursive: true });
    let app: ElectronApplication | undefined, failure: unknown;
    try {
      const origin = await readReleasedProject(scenario.entry), extractedProject = containedPath(release.extractedRoot, scenario.entry.archiveEntry);
      assert.deepEqual(await fs.readFile(extractedProject), origin.bytes);
      await fs.cp(path.dirname(extractedProject), source, { recursive: true, errorOnExist: true, force: false });
      const file = path.join(source, 'project.vns.json');
      const authored = scenario.scheme ? authorReleasedRuntimeFixture(origin.raw, scenario.scheme) : undefined;
      const input = authored?.project ?? origin.raw;
      if (authored) await fs.writeFile(file, JSON.stringify(input, null, 2));
      await fs.copyFile(file, path.join(evidence, 'old-authoring-input.project.json'));
      app = await launchDesktopFixture({ root, profile, projectFile: file, release: release.launch });
      const page = await app.firstWindow();
      const initial = await page.evaluate(() => window.studio!.getInitial());
      assert.equal(initial.project.id, input.id);
      const saved = await page.evaluate(project => window.studio!.save(project), input); assert.ok(saved?.project);
      const oldProject = saved.project;
      assertReleasedProjectIdentity(input, oldProject);
      await fs.copyFile(file, path.join(evidence, 'old-normalized.project.json'));
      const generated = await page.evaluate(project => window.studio!.preview(project, { mode: 'window' }), oldProject);
      await check(scenario.id + '-old-preview', { code: generated.ok ? 0 : 1, log: generated.log + JSON.stringify(generated.diagnostics) });
      assert.ok(generated.buildPath);
      const oldBuild = path.resolve(generated.buildPath), profileRoot = await fs.realpath(profile);
      const relative = path.relative(profileRoot, await fs.realpath(oldBuild));
      assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative), 'The old compiler must write only in its isolated profile.');
      await page.evaluate(() => window.studio!.controlPreview?.('stop'));
      await fs.cp(oldBuild, oldGame, { recursive: true, errorOnExist: true, force: false });
      await app.close(); app = undefined;
      await fs.copyFile(path.join(work, 'tested-app.json'), path.join(evidence, 'producer-binaries.json'));
      const generatedHashes = await digests(path.join(oldGame, 'game'), name => /\.rpyc?$/.test(name));
      await fs.writeFile(path.join(evidence, 'producer-generated-sha256.json'), JSON.stringify(generatedHashes, null, 2));
      const cases = releasedNativeCases(oldProject, authored), probe = releasedProbeSource(oldProject), producerTests = releasedProducerTests(cases, authored);
      await fs.writeFile(path.join(oldGame, 'game/release-probe.rpy'), probe);
      await fs.writeFile(path.join(oldGame, 'game/testcases.rpy'), producerTests);
      await fs.writeFile(path.join(evidence, 'release-probe.rpy'), probe); await fs.writeFile(path.join(evidence, 'producer-testcases.rpy'), producerTests);
      const nativeOptions = { savedir: saves, timeoutMs: 900000, env: { VNS_RELEASE_SNAPSHOT_DIR: path.join(evidence, 'old-snapshots'), PYTHONDONTWRITEBYTECODE: '1' }, onData: (text: string) => process.stdout.write(text) };
      await check(scenario.id + '-old-native', await runRenpy(release.sdk, oldGame, ['test', '--report-detailed', '--report-skipped'], nativeOptions), cases.length + (authored ? 2 : 0));
      const oldSaves = await digests(saves, name => path.basename(name).startsWith('v080_') && name.endsWith('.save'));
      assert.equal(Object.keys(oldSaves).length, cases.length, 'Every declared persistence case needs an actual old-engine save.');
      for (const [name] of Object.entries(oldSaves)) { const target = containedPath(path.join(evidence, 'old-saves'), name); await fs.mkdir(path.dirname(target), { recursive: true }); await fs.copyFile(containedPath(saves, name), target); }
      await fs.writeFile(path.join(evidence, 'old-saves-sha256.json'), JSON.stringify(oldSaves, null, 2));
      // Preserve the actual old .rpyc files before recompilation. RenPy uses
      // these statement identities to match saved continuations after edits.
      await fs.cp(oldGame, nextGame, { recursive: true, errorOnExist: true, force: false });
      const migrated = await loadProject(file); assertReleasedProjectIdentity(oldProject, migrated.project);
      const next = (await saveProject(file, migrated.project)).project;
      assertReleasedProjectIdentity(oldProject, (await loadProject(file)).project);
      await fs.copyFile(file, path.join(evidence, 'migrated.project.json'));
      const built = await buildProject({ project: next, projectDir: source, sdkRoot: sdk, outputDir: nextGame, development: true, preview: { mode: 'window' }, previewHost: true });
      await check(scenario.id + '-upgrade-build', { code: built.ok ? 0 : 1, log: built.log + JSON.stringify(built.diagnostics) });
      const consumerTests = releasedConsumerTests(cases);
      await fs.writeFile(path.join(nextGame, 'game/testcases.rpy'), consumerTests); await fs.writeFile(path.join(evidence, 'consumer-testcases.rpy'), consumerTests);
      await check(scenario.id + '-upgraded-native', await runRenpy(sdk, nextGame, ['test', '--report-detailed', '--report-skipped'], { ...nativeOptions, env: { ...nativeOptions.env, VNS_RELEASE_SNAPSHOT_DIR: path.join(evidence, 'upgraded-snapshots') } }), cases.length);
      assert.deepEqual(await digests(saves, name => path.basename(name).startsWith('v080_') && name.endsWith('.save')), oldSaves, 'The original native saves must remain byte-identical.');
      for (const row of cases) {
        const read = (group: string, name: string) => fs.readFile(path.join(evidence, group, name + '.json'), 'utf8').then(text => JSON.parse(text) as Snapshot);
        const before = await read('old-snapshots', row.key), after = await read('upgraded-snapshots', row.key), resaved = await read('upgraded-snapshots', row.key + '_resaved');
        compareRestored(before, after, next); assert.equal(after.pageSchema, 1);
        assert.deepEqual(resaved.variables, after.variables); assert.deepEqual(resaved.openPages, after.openPages); assert.deepEqual(resaved.overrides, after.overrides); assert.deepEqual(resaved.migrations, after.migrations);
        if (row.saveScope === 'base-only') assert.equal(after.screens.includes(row.host), false, 'Temporary native menu/confirm context must not be resurrected.');
        if (row.key.startsWith('rollback')) compareRestored(await read('old-snapshots', row.key + '_anchor'), await read('upgraded-snapshots', row.key + '_anchor'), next);
      }
      assert.deepEqual((await readReleasedProject(scenario.entry)).bytes, origin.bytes);
      report.runs.push({ id: scenario.id, sourceSha256: scenario.entry.sha256, scheme: scenario.scheme ?? null, untouched: !authored,
        producerProjectSha256: await sha256File(path.join(evidence, 'old-normalized.project.json')), saveFiles: Object.keys(oldSaves),
        cases: cases.map(({ key, host, saveScope }) => ({ key, host, saveScope })), historicalLimitations: authored ? ['Title cannot save.', 'Menu and confirmation saves restore their base context, not a copied callback.', '0.8.0 input host has no authored keyboard controls; its real input interaction is saved.', '0.8.0 ending returns directly to title; no active game-over save is fabricated.'] : [] });
    } catch (error) { failure = error; throw error; }
    finally {
      const teardown: string[] = [];
      if (app) {
        try { const page = await app.firstWindow(); await page.evaluate(() => window.studio!.controlPreview?.('stop')); }
        catch (error) { teardown.push('stop preview: ' + String(error)); }
        try { await app.close(); } catch (error) { teardown.push('close desktop: ' + String(error)); }
      }
      const cleaned = await cleanVerificationDirectories(run, ['work']);
      teardown.push(...cleaned.errors.map(error => error.path + ': ' + error.error));
      await fs.writeFile(path.join(run, 'teardown.json'), JSON.stringify({ errors: teardown }, null, 2)); await saveReport();
      if (teardown.length && !failure) throw new Error(teardown.join('\n'));
    }
  }
  assert.equal(report.runs.length, scenarios.length); report.status = 'passed';
} catch (error) { report.status = 'failed'; report.error = String(error); console.error(error); process.exitCode = 1; }
finally {
  try { report.cleanup = await cleanVerificationDirectories(output, ['release']); assert.deepEqual((report.cleanup as { errors: unknown[] }).errors, []); }
  catch (error) { report.status = 'failed'; report.cleanup = { error: String(error) }; process.exitCode = 1; }
  await saveReport(); console.log(path.join(output, 'report.json'));
}
