import type { Well } from "./physics";

const HEADER = "name,x_m,y_m,rate_Mtpa,start_yr,end_yr,skin";

export function wellsToCsv(wells: Well[]): string {
  return [HEADER, ...wells.map((w) => [w.name, w.x, w.y, w.rateMtpa, w.startYr, w.endYr, w.skin].join(","))].join("\n");
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

/** Parse a wells CSV: name,x_m,y_m,rate_Mtpa,start_yr,end_yr[,skin] (header optional; , ; or tab delimited). */
export function parseWellsCsv(text: string): Well[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) throw new Error("File is empty");
  const delim = [",", ";", "\t"].sort((a, b) => lines[0].split(b).length - lines[0].split(a).length)[0];
  const rows = lines.map((l) => l.split(delim).map((c) => c.trim().replace(/^"|"$/g, "")));
  if (Number.isNaN(Number(rows[0][1]))) rows.shift(); // header row
  return rows.map((r, i) => {
    if (r.length < 6) throw new Error(`Row ${i + 1}: expected at least 6 columns (${HEADER})`);
    const nums = r.slice(1, 7).map((v) => (v === "" ? 0 : Number(v)));
    if (nums.some(Number.isNaN)) throw new Error(`Row ${i + 1}: non-numeric value`);
    return {
      id: `w${Date.now().toString(36)}${i}`,
      name: r[0] || `Well ${i + 1}`,
      x: nums[0],
      y: nums[1],
      rateMtpa: nums[2],
      startYr: nums[3],
      endYr: nums[4],
      skin: r.length > 6 ? nums[5] : 0,
    };
  });
}

export function download(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
