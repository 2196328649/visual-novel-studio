import test from 'node:test';
import assert from 'node:assert/strict';
import { emissionMeshPoints, type EmissionMesh } from '../src/core/emission-mesh';
import { assetSchema } from '../src/core/model';

test('mesh sampling respects triangle area, barycentric bounds and deterministic export', () => {
  const mesh: EmissionMesh = { vertices: [[0, 0], [1, 0], [0, 1], [2, 0], [4, 0], [2, 2]], triangles: [[0, 1, 2], [3, 4, 5]] };
  const points = emissionMeshPoints(mesh, 10000);
  assert.deepEqual(points, emissionMeshPoints(structuredClone(mesh), 10000));
  for (const [x, y] of points) assert.ok(y >= 0 && (x < 2 ? x >= 0 && x + y <= 1 : x >= 2 && x + y <= 4));
  const smallFraction = points.filter(([x]) => x < 2).length / points.length;
  assert.ok(Math.abs(smallFraction - .2) < .02, `area weighting: ${smallFraction}`);
  assert.deepEqual(emissionMeshPoints({ vertices: [[0, 0], [0, 0], [0, 0]], triangles: [[0, 1, 2]] }), []);
});

test('asset mesh survives serialization and rejects invalid indices', () => {
  const asset = { id: 'title', name: 'Title', kind: 'image', path: 'title.png', emissionMesh: { vertices: [[0, 0], [1, 0], [0, 1]], triangles: [[0, 1, 2]] } };
  assert.deepEqual(assetSchema.parse(JSON.parse(JSON.stringify(asset))).emissionMesh, asset.emissionMesh);
  asset.emissionMesh.triangles[0][2] = 3;
  assert.equal(assetSchema.safeParse(asset).success, false);
});
