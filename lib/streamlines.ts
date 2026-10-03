// Streamlines of the flow field v = -grad(p) on a regular cell-centred grid (flow runs down the pressure gradient,
// i.e. away from injectors). Paths are integrated with a midpoint (RK2) scheme at constant speed in grid-index space.

/** Local maxima of the field (cells higher than all eight neighbours and above minFrac of the overall maximum). */
export function findPeaks(values: Float64Array, nx: number, ny: number, minFrac = 0.05): GridPoint[] {
  let max = 0;
  for (const v of values) if (v > max) max = v;
  const out: GridPoint[] = [];
  for (let j = 1; j < ny - 1; j++) {
    for (let i = 1; i < nx - 1; i++) {
      const v = values[j * nx + i];
      if (!(v >= minFrac * max) || Number.isNaN(v)) continue;
      let isMax = true;
      for (let dj = -1; dj <= 1 && isMax; dj++) for (let di = -1; di <= 1; di++) if ((di || dj) && !(v > values[(j + dj) * nx + i + di])) { isMax = false; break; }
      if (isMax) out.push({ i, j });
    }
  }
  return out;
}

export interface GridPoint {
  i: number; // fractional column index
  j: number; // fractional row index
}

export function streamPaths(values: Float64Array, nx: number, ny: number, seeds: GridPoint[], maxSteps = 1500, step = 0.5): GridPoint[][] {
  const gx = new Float64Array(nx * ny);
  const gy = new Float64Array(nx * ny);
  const at = (i: number, j: number) => values[j * nx + i];
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const l = at(Math.max(i - 1, 0), j), r = at(Math.min(i + 1, nx - 1), j);
      const d = at(i, Math.max(j - 1, 0)), u = at(i, Math.min(j + 1, ny - 1));
      if (Number.isNaN(l + r + d + u)) continue; // stays 0: no flow outside the aquifer
      gx[j * nx + i] = -(r - l);
      gy[j * nx + i] = -(u - d);
    }
  }
  const sample = (i: number, j: number): [number, number] => {
    const x = Math.min(Math.max(i, 0), nx - 1.000001), y = Math.min(Math.max(j, 0), ny - 1.000001);
    const i0 = Math.floor(x), j0 = Math.floor(y), fx = x - i0, fy = y - j0;
    const w = (a: Float64Array) =>
      a[j0 * nx + i0] * (1 - fx) * (1 - fy) + a[j0 * nx + i0 + 1] * fx * (1 - fy) + a[(j0 + 1) * nx + i0] * (1 - fx) * fy + a[(j0 + 1) * nx + i0 + 1] * fx * fy;
    return [w(gx), w(gy)];
  };
  const paths: GridPoint[][] = [];
  for (const seed of seeds) {
    let { i, j } = seed;
    if (!(i >= 0 && i <= nx - 1 && j >= 0 && j <= ny - 1)) continue;
    const pts: GridPoint[] = [{ i, j }];
    for (let n = 0; n < maxSteps; n++) {
      const [a, b] = sample(i, j);
      const m = Math.hypot(a, b);
      if (!(m > 1e-12)) break;
      const [a2, b2] = sample(i + (0.5 * step * a) / m, j + (0.5 * step * b) / m);
      const m2 = Math.hypot(a2, b2);
      if (!(m2 > 1e-12)) break;
      i += (step * a2) / m2;
      j += (step * b2) / m2;
      if (!(i >= 0 && i <= nx - 1 && j >= 0 && j <= ny - 1)) break;
      pts.push({ i, j });
    }
    paths.push(pts);
  }
  return paths;
}
