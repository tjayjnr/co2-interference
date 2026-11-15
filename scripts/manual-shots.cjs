// Retakes the screenshots used by the user manual. Needs: npm i -D puppeteer-core, Microsoft Edge or Chrome, and the app running
// (npm run build && npm run start -- -p 3120).  EDGE_PATH overrides the browser location, APP_URL the address.
const puppeteer = require("puppeteer-core");
const path = require("path");
const out = path.join(__dirname, "..", "public", "manual");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const b = await puppeteer.launch({ executablePath: process.env.EDGE_PATH || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: "new", args: ["--no-sandbox"] });
  const p = await b.newPage();
  await p.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "light" }]);
  await p.setViewport({ width: 1500, height: 1000 });
  await p.goto((process.env.APP_URL || "http://localhost:3120"), { waitUntil: "networkidle0" });
  // the input column scrolls on its own on wide screens: let it grow so every group can be captured
  await p.addStyleTag({ content: "aside.panel { position: static !important; max-height: none !important; overflow: visible !important; } .panel .inputs .group[hidden] { display: block !important; }" });
  const click = async (t) => { const [x] = await p.$$(`xpath/.//button[contains(., "${t}")]`); await x.click(); };
  const group = async (name) => p.$(`[data-group="${name}"]`);
  // the first table in the results area (not the well-separation table in the input panel)
  const resultTable = async () => (await p.evaluateHandle(() => [...document.querySelectorAll("table.matrix")].find((t) => !t.closest("aside")) ?? null)).asElement();
  const rect = async (h) => h.evaluate((e) => { const r = e.getBoundingClientRect(); return { x: r.x + scrollX, y: r.y + scrollY, w: r.width, h: r.height }; });
  const union = async (hs) => { const rs = await Promise.all(hs.map(rect)); const x0 = Math.min(...rs.map((r) => r.x)), y0 = Math.min(...rs.map((r) => r.y)), x1 = Math.max(...rs.map((r) => r.x + r.w)), y1 = Math.max(...rs.map((r) => r.y + r.h)); return { x: x0 - 6, y: y0 - 6, width: x1 - x0 + 12, height: y1 - y0 + 12 }; };
  const snap = async (name, hs) => p.screenshot({ path: `${out}/${name}.png`, clip: await union(hs), captureBeyondViewport: true });
  const setSel = (label, value) => p.evaluate((label, value) => { const el = document.querySelector(`select[aria-label="${label}"]`); const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set; set.call(el, value); el.dispatchEvent(new Event("change", { bubbles: true })); }, label, value);
  const pickSystem = async (label) => { const [l] = await p.$$(`xpath/.//label[contains(@class,"sysbtn")][contains(., "${label}")]`); await l.click(); await sleep(300); };

  // inputs (before running), multiwell interference
  await snap("system", [await group("system")]);
  await snap("input", [await group("model"), await group("reservoir")]);
  await snap("skinbound", [await group("model"), await group("limit")]);
  await snap("wells", [await group("wells")]);
  await setSel("Distances", "different"); await sleep(200);
  await setSel("Different-distance input", "coordinates"); await sleep(300);
  await p.select(".coordsel select", "geo"); await sleep(400);
  await snap("wells-geo", [await group("wells")]);
  await p.select(".coordsel select", "local"); await sleep(300);
  await setSel("Distances", "constant"); await sleep(300);

  await click("RUN analysis"); await p.waitForSelector(".kpis"); await sleep(1500);
  await snap("mwresults", [await p.$(".kpis"), (await p.$$(".results table.bhp-summary"))[2]]);
  // overview with numbered call-outs (on the pressure map, which has the chart toolbar)
  await click("Pressure map"); await sleep(1200);
  await p.evaluate(() => scrollTo(0, 0));
  await p.evaluate(() => {
    const pick = (sel) => document.querySelector(sel).getBoundingClientRect();
    const items = [
      [1, pick(".run"), "tl"], [2, pick("aside.panel h2"), "tl"], [3, pick(".hdrbtns"), "tl"],
      [4, pick(".kpis"), "tl"], [5, pick("nav.tabs"), "tl"], [6, pick(".chartbar"), "tl"],
    ];
    for (const [n, r] of items) {
      const d = document.createElement("div");
      d.textContent = String(n);
      Object.assign(d.style, { position: "absolute", left: `${r.x + scrollX - 12}px`, top: `${r.y + scrollY - 12}px`, width: "26px", height: "26px", borderRadius: "50%", background: "#d9480f", color: "#fff", font: "bold 15px 'Times New Roman',serif", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 99999, boxShadow: "0 0 0 2px #fff" });
      d.className = "callout";
      document.body.appendChild(d);
    }
  });
  await p.screenshot({ path: `${out}/overview.png` });
  await p.evaluate(() => document.querySelectorAll(".callout").forEach((e) => e.remove()));

  await snap("pressure-map", [(await p.$$(".chartview"))[0]]);
  // map style example for the manual: Viridis, colour bands, contour lines and streamlines
  await setSel("Colour scale", "viridis"); await setSel("Fill style", "bands"); await sleep(200);
  await p.click('input[aria-label="Contour lines"]'); await p.click('input[aria-label="Streamlines"]'); await sleep(900);
  await snap("mapstyle", [(await p.$$(".mapstyle"))[0], (await p.$$(".chartview"))[0]]);
  await setSel("Fill style", "none"); await setSel("Colour scale", "jet"); await setSel("Contour reach", "0.5"); await setSel("Number of contour levels", "15");
  await p.click('input[aria-label="Streamlines"]'); await sleep(900);
  await snap("mapcontour", [(await p.$$(".mapstyle"))[0], (await p.$$(".chartview"))[0]]);
  await click("Reset style"); await sleep(500);
  // zoom example: drag a box on the pressure map
  const sv = await (await p.$(".chartsvg svg")).evaluate((s) => { const q = s.getBoundingClientRect(); return { x: q.x, y: q.y, w: q.width, h: q.height }; });
  await p.mouse.move(sv.x + sv.w * 0.36, sv.y + sv.h * 0.40); await p.mouse.down();
  await p.mouse.move(sv.x + sv.w * 0.62, sv.y + sv.h * 0.60, { steps: 8 }); await p.mouse.up(); await sleep(600);
  await snap("zoom", [(await p.$$(".chartview"))[0]]);
  await click("CO₂ saturation"); await sleep(900);
  await snap("sat", [(await p.$$(".chartview"))[0], await resultTable()]);
  await click("Time series"); await sleep(900);
  await snap("time-series", [(await p.$$(".chartview"))[0]]);
  await click("Interference matrix"); await sleep(1500);
  { // the interference matrix (header "Source ↓ / Receiver →"), with the caption above it
    const m = (await p.$$("table.matrix"))[await p.$$eval("table.matrix", (ts) => ts.findIndex((el) => el.textContent.includes("Receiver")))];
    const above = (await m.evaluateHandle((el) => el.closest(".tablewrap")?.previousElementSibling ?? el)).asElement();
    await snap("matrix", [above ?? m, m]); }
  await click("Limit check"); await sleep(600);
  { const t = await p.$$("table.matrix"); await snap("limits", t); }
  // the comparison runs in the background worker: wait until its "Calculating…" note is gone and the chart is drawn
  await click("Compare boundaries");
  await p.waitForFunction(() => !document.querySelector(".calc-note") && document.querySelector(".chartview"), { timeout: 60000, polling: 200 }); await sleep(800);
  await snap("compare", [(await p.$$(".chartview"))[0], await resultTable()]);

  // single well
  await pickSystem("Single well");
  await snap("single", [await group("wells")]);
  await click("RUN analysis");
  await p.waitForSelector(".run-toast", { timeout: 5000 }).catch(() => {});
  await p.waitForFunction(() => !document.querySelector(".run-toast"), { timeout: 60000, polling: 200 }); await sleep(800);
  await click("Program results"); await sleep(800);
  await snap("program", [await p.$(".kpis"), await p.$(".results .plotwrap")]);
  await b.close();
  console.log("shots done");
})().catch((e) => { console.error(e); process.exit(1); });
