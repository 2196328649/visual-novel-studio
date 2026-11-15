import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BlueprintPin, Project, UiComponent } from '../../src/core/model';
import { projectGraphs } from '../../src/core/project-resources';
import { blueprintCallName, resolveBlueprintCall } from '../../src/core/blueprint-names';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../tests/fixtures/releases/v0.8.0');
export interface ReleasedProjectEntry { id: string; file: string; archiveEntry: string; bytes: number; sha256: string; inventory: { projectId: string; componentPages: string[]; blueprints: number; timelinePresets: number } }
export interface ReleasedDistribution { rootEntry: string; executable: string; executableSha256: string; asarSha256: string; provenance: string }
export interface ReleasedProjectManifest { distribution: ReleasedDistribution; schemaVersion: number; release: string; archive: { file: string; expectedSha256: string; provenance: string }; projects: ReleasedProjectEntry[] }
export const releasedProjectManifest = async () => JSON.parse(await fs.readFile(path.join(root, 'manifest.json'), 'utf8')) as ReleasedProjectManifest;
export async function readReleasedProject(entry: ReleasedProjectEntry) {
  assert.equal(path.basename(entry.file), entry.file, 'A source fixture cannot leave the historical fixture directory.');
  const bytes = await fs.readFile(path.join(root, entry.file));
  assert.equal(bytes.length, entry.bytes); assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.sha256);
  return { bytes, raw: JSON.parse(bytes.toString('utf8')) as Project };
}

/** Contract checks deliberately keep release-source evidence distinct from
 * native saved-game compatibility. Missing game media is never synthesized. */
export function assertReleasedProjectIdentity(source: Project, migrated: Project) {
  assert.equal(migrated.id, source.id); assert.equal(migrated.version, source.version);
  for (const key of ['assets', 'variables', 'chapters', 'scenes', 'nodes'] as const) {
    const actual = new Set(migrated[key].map(value => value.id));
    for (const value of source[key] ?? []) assert.ok(actual.has(value.id), key + ' lost stable ID ' + value.id);
  }
  const graphs = projectGraphs(migrated);
  for (const old of [...(source.blueprints ?? []), ...(source.timelinePresets ?? [])]) {
    const graph = graphs.find(graph => graph.id === old.id); assert.ok(graph, 'Lost historical graph ' + old.id);
    assert.equal(resolveBlueprintCall(graphs, blueprintCallName(old))?.id, old.id, 'Historical call name no longer resolves: ' + blueprintCallName(old));
    for (const key of ['exposedInputs', 'exposedOutputs'] as const) for (const pin of old[key] ?? []) {
      const current: BlueprintPin | undefined = graph[key].find(candidate => candidate.id === pin.id); assert.ok(current, old.id + ' lost interface pin ' + pin.id); assert.equal(current.dataType, pin.dataType);
    }
    if (old.kind === 'ui') {
      assert.equal(graph.uiPageId, old.uiPageId, 'Migration must not invent ownership for an old mixed graph.');
      assert.equal(graph.uiInstanceId, old.uiInstanceId); assert.deepEqual(graph.links, old.links ?? []);
      for (const node of old.nodes ?? []) assert.ok(graph.nodes.some(current => current.id === node.id && current.type === node.type), 'Lost mixed-graph entry ' + node.id);
    }
  }
  const controls = (components: UiComponent[], after: UiComponent[]) => {
    for (const component of components ?? []) {
      const current = after.find(current => current.id === component.id); assert.ok(current, 'Lost historical component ' + component.id);
      assert.equal(current.kind, component.kind); assert.equal(current.page, component.page);
      assert.deepEqual(current.events, component.events); assert.equal(current.blueprintId, component.blueprintId);
    }
  };
  controls(source.ui.components, migrated.ui.components);
  for (const instance of source.ui.instances ?? []) { const current = migrated.ui.instances?.find(value => value.id === instance.id); assert.ok(current); assert.equal(current.baseUiId, instance.baseUiId); controls(instance.components, current.components); }
  for (const page of source.ui.customPages ?? []) { const current = migrated.ui.customPages.find(value => value.id === page.id); assert.ok(current); assert.equal(current.onShowBlueprintId, page.onShowBlueprintId); controls(page.components, current.components); }
}