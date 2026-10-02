// Builds the manual as PDF and Word (public/manual/user-manual.*) and copies both to the Desktop.
// Run after the screenshots exist in public/manual/:   node scripts/build-manual.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { manualBlocks } from "../lib/manual.ts";
import { renderDocx, renderPdf } from "../lib/report.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const shots = path.join(root, "public", "manual");
const img = (name) => {
  const f = path.join(shots, `${name}.png`);
  if (!fs.existsSync(f)) { console.warn("missing screenshot:", name); return undefined; }
  const buf = fs.readFileSync(f);
  return { png: `data:image/png;base64,${buf.toString("base64")}`, w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
};
const date = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
const blocks = manualBlocks(img, date);
const b64 = (f) => fs.readFileSync(path.join(root, "public", "fonts", f)).toString("base64");
const title = "CO₂ Interference Analyzer: User Manual";

const pdf = Buffer.from(await renderPdf(blocks, { regular: b64("STIX-Regular.ttf"), bold: b64("STIX-Bold.ttf"), italic: b64("STIX-Italic.ttf") }, title));
const docx = Buffer.from(await (await renderDocx(blocks, title)).arrayBuffer());
const desktop = path.join(os.homedir(), "Desktop");
for (const [name, data] of [["user-manual.pdf", pdf], ["user-manual.docx", docx]]) {
  fs.writeFileSync(path.join(shots, name), data);
  console.log(name, Math.round(data.length / 1024), "KB");
}
fs.writeFileSync(path.join(desktop, "CO2-Interference-User-Manual.pdf"), pdf);
fs.writeFileSync(path.join(desktop, "CO2-Interference-User-Manual.docx"), docx);
console.log("copied to", desktop);
