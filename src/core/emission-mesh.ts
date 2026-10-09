export type EmissionMesh = { vertices: [number, number][]; triangles: [number, number, number][] };

/** Deterministic area-weighted Sprite mesh samples, shared by preview and export. */
export function emissionMeshPoints(mesh: EmissionMesh, count = 2048): [number, number][] {
  const areas: number[] = []; let total = 0;
  for (const indices of mesh.triangles) {
    const [a, b, c] = indices.map(i => mesh.vertices[i]);
    if (!a || !b || !c) return [];
    total += Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / 2;
    areas.push(total);
  }
  if (!(total > 0) || !Number.isFinite(total)) return [];
  let seed = 73129;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  return Array.from({ length: count }, () => {
    const target = random() * total;
    let lo = 0, hi = areas.length - 1;
    while (lo < hi) { const mid = (lo + hi) >>> 1; if (areas[mid] <= target) lo = mid + 1; else hi = mid; }
    const [a, b, c] = mesh.triangles[lo].map(i => mesh.vertices[i]);
    const u = Math.sqrt(random()), v = random();
    return [a[0] * (1 - u) + b[0] * u * (1 - v) + c[0] * u * v, a[1] * (1 - u) + b[1] * u * (1 - v) + c[1] * u * v];
  });
}
