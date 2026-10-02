// Marching-squares iso-lines on a regular cell-centred grid. Returns segments in grid index space.

export type Segment = [number, number, number, number];

export function isoSegments(values: Float64Array, nx: number, ny: number, level: number): Segment[] {
  const segs: Segment[] = [];
  const v = (i: number, j: number) => values[j * nx + i];
  const lerp = (a: number, b: number) => (level - a) / (b - a);
  for (let j = 0; j < ny - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = v(i, j);
      const b = v(i + 1, j);
      const c = v(i + 1, j + 1);
      const d = v(i, j + 1);
      if (Number.isNaN(a + b + c + d)) continue;
      const idx = (a >= level ? 1 : 0) | (b >= level ? 2 : 0) | (c >= level ? 4 : 0) | (d >= level ? 8 : 0);
      if (idx === 0 || idx === 15) continue;
      const bottom: [number, number] = [i + lerp(a, b), j];
      const right: [number, number] = [i + 1, j + lerp(b, c)];
      const top: [number, number] = [i + lerp(d, c), j + 1];
      const left: [number, number] = [i, j + lerp(a, d)];
      const add = (p: [number, number], q: [number, number]) => segs.push([p[0], p[1], q[0], q[1]]);
      switch (idx) {
        case 1: case 14: add(left, bottom); break;
        case 2: case 13: add(bottom, right); break;
        case 3: case 12: add(left, right); break;
        case 4: case 11: add(right, top); break;
        case 6: case 9: add(bottom, top); break;
        case 7: case 8: add(left, top); break;
        case 5: add(left, top); add(bottom, right); break;
        case 10: add(left, bottom); add(right, top); break;
      }
    }
  }
  return segs;
}
