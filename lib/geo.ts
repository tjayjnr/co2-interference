// Real-world coordinates: longitude/latitude (WGS84 degrees) <-> local x/y metres.
// Azimuthal equidistant projection on a sphere (R = 6371.0088 km) centred on a local origin.
// Distances from the origin are exact; between other points the error stays well below 0.5 %
// for fields up to ~100 km across, which is far smaller than typical input uncertainty.

const R = 6371008.8;
const RAD = Math.PI / 180;

export function project(lat: number, lon: number, lat0: number, lon0: number): { x: number; y: number } {
  const p = lat * RAD, p0 = lat0 * RAD, dl = (lon - lon0) * RAD;
  const cosc = Math.min(1, Math.max(-1, Math.sin(p0) * Math.sin(p) + Math.cos(p0) * Math.cos(p) * Math.cos(dl)));
  const c = Math.acos(cosc);
  const k = c < 1e-12 ? 1 : c / Math.sin(c);
  return {
    x: R * k * Math.cos(p) * Math.sin(dl),
    y: R * k * (Math.cos(p0) * Math.sin(p) - Math.sin(p0) * Math.cos(p) * Math.cos(dl)),
  };
}

export function unproject(x: number, y: number, lat0: number, lon0: number): { lat: number; lon: number } {
  const rho = Math.hypot(x, y);
  if (rho < 1e-9) return { lat: lat0, lon: lon0 };
  const p0 = lat0 * RAD;
  const c = rho / R;
  const lat = Math.asin(Math.min(1, Math.max(-1, Math.cos(c) * Math.sin(p0) + (y * Math.sin(c) * Math.cos(p0)) / rho)));
  const lon = lon0 * RAD + Math.atan2(x * Math.sin(c), rho * Math.cos(p0) * Math.cos(c) - y * Math.sin(p0) * Math.sin(c));
  return { lat: lat / RAD, lon: lon / RAD };
}

/** Simple mean of coordinates, used as the projection origin. */
export function centroid(pts: { lat: number; lon: number }[]): { lat: number; lon: number } | null {
  if (!pts.length) return null;
  return { lat: pts.reduce((s, p) => s + p.lat, 0) / pts.length, lon: pts.reduce((s, p) => s + p.lon, 0) / pts.length };
}

export const validLatLon = (lat: number, lon: number) => Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
