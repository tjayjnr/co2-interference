import type { Point, Well } from "./physics";

/** Editable well: coordinates may be local x/y (m) or lon/lat (deg); skin is typed text ("" = calculate). */
export interface WellIn extends Well {
  skinText: string;
  lon?: number;
  lat?: number;
}

export interface PointIn extends Point {
  lon?: number;
  lat?: number;
}

const HEADER_LOCAL = "name,x_m,y_m,rate_Mtpa,start_yr,end_yr,skin,changes";
const HEADER_GEO = "name,lon_deg,lat_deg,rate_Mtpa,start_yr,end_yr,skin,changes";

export function wellsToCsv(wells: WellIn[], geo: boolean): string {
  const rows = wells.map((w) => [w.name, geo ? w.lon ?? 0 : w.x, geo ? w.lat ?? 0 : w.y, w.rateMtpa, w.startYr, w.endYr, w.skinText, (w.changes ?? []).map((c) => `${c.yr}:${c.rateMtpa}`).join("|")].join(","));
  return [geo ? HEADER_GEO : HEADER_LOCAL, ...rows].join("\n");
}

export function toCsv(rows: (string | number)[][]): string {
  return rows
    .map((r) =>
      r
        .map((v) => {
          const s = typeof v === "number" ? (Number.isFinite(v) ? String(v) : "") : v;
          return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        })
        .join(","),
    )
    .join("\n");
}

/**
 * Parse a wells CSV. Local: name,x_m,y_m,rate_Mtpa,start_yr,end_yr[,skin].
 * Geographic (detected from a header containing "lon"): name,lon_deg,lat_deg,rate_Mtpa,start_yr,end_yr[,skin].
 * A blank skin means "calculate it". Optional last column "changes": rate changes as year:rate pairs separated by | (e.g. 8:0.5|15:0.2).
 * Header optional; , ; or tab delimited.
 */
export function parseWellsCsv(text: string): { wells: WellIn[]; geo: boolean } {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) throw new Error("File is empty");
  const delim = [",", ";", "\t"].sort((a, b) => lines[0].split(b).length - lines[0].split(a).length)[0];
  const rows = lines.map((l) => l.split(delim).map((c) => c.trim().replace(/^"|"$/g, "")));
  let geo = false;
  if (Number.isNaN(Number(rows[0][1]))) {
    geo = /lon/i.test(rows[0][1] ?? "");
    rows.shift(); // header row
  }
  const wells = rows.map((r, i): WellIn => {
    if (r.length < 6) throw new Error(`Row ${i + 1}: expected at least 6 columns (${geo ? HEADER_GEO : HEADER_LOCAL})`);
    const nums = r.slice(1, 6).map(Number);
    if (nums.some(Number.isNaN)) throw new Error(`Row ${i + 1}: non-numeric value`);
    const skinText = (r[6] ?? "").trim();
    const changes = (r[7] ?? "")
      .split("|")
      .map((x) => x.trim())
      .filter(Boolean)
      .map((x) => {
        const [yr, q] = x.split(":").map(Number);
        if (!Number.isFinite(yr) || !Number.isFinite(q)) throw new Error(`Row ${i + 1}: rate changes must look like 8:0.5|15:0.2 (year:rate)`);
        return { yr, rateMtpa: q };
      });
    if (skinText !== "" && Number.isNaN(Number(skinText))) throw new Error(`Row ${i + 1}: skin must be a number or blank`);
    if (geo && (Math.abs(nums[1]) > 90 || Math.abs(nums[0]) > 180)) throw new Error(`Row ${i + 1}: longitude/latitude out of range`);
    return {
      id: `w${Date.now().toString(36)}${i}`,
      name: r[0] || `Well ${i + 1}`,
      x: geo ? 0 : nums[0],
      y: geo ? 0 : nums[1],
      lon: geo ? nums[0] : undefined,
      lat: geo ? nums[1] : undefined,
      rateMtpa: nums[2],
      startYr: nums[3],
      endYr: nums[4],
      skin: 0,
      skinText,
      changes,
    };
  });
  return { wells, geo };
}

export function download(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
