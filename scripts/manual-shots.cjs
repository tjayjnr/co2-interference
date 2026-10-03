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
  const click = async (t) => { const [x] = await p.$$(`xpath/.//button[contains(., "${t}")]`); await x.click(); };
  const sectionByH2 = async (t) => (await p.$$(`xpath/.//section[h2[contains(., "${t}")] or div/h2[contains(., "${t}")]]`))[0];
  const rect = async (h) => h.evaluate((e) => { const r = e.getBoundingClientRect(); return { x: r.x + scrollX, y: r.y + scrollY, w: r.width, h: r.height }; });
  const union = async (hs) => { const rs = await Promise.all(hs.map(rect)); const x0 = Math.min(...rs.map((r) => r.x)), y0 = Math.min(...rs.map((r) => r.y)), x1 = Math.max(...rs.map((r) => r.x + r.w)), y1 = Math.max(...rs.map((r) => r.y + r.h)); return { x: x0 - 6, y: y0 - 6, width: x1 - x0 + 12, height: y1 - y0 + 12 }; };
  const snap = async (name, hs) => p.screenshot({ path: `${out}/${name}.png`, clip: await union(hs), captureBeyondViewport: true });

  // inputs (before running)
  await snap("input", [await sectionByH2("Input")]);
  await snap("skinbound", [await sectionByH2("Well skin"), await sectionByH2("Boundary condition")]);
  await snap("wells", [await sectionByH2("Injection wells")]);
  await p.select(".coordsel select", "geo"); await sleep(300);
  await snap("wells-geo", [await sectionByH2("Injection wells")]);
  await p.select(".coordsel select", "local"); await sleep(300);

  await click("RUN analysis"); await p.waitForSelector(".kpis"); await sleep(700);
  // overview with numbered call-outs
  await p.evaluate(() => {
    const pick = (sel) => document.querySelector(sel).getBoundingClientRect();
    const items = [
      [1, pick(".run"), "tl"], [2, pick("aside.panel h2"), "tl"], [3, pick(".hdrbtns"), "tl"],
      [4, pick(".kpis"), "tl"], [5, pick("nav.tabs"), "tl"], [6, pick(".chartbar"), "tl"],
    ];
    for (const [n, r] of items) {
      const d = document.createElement("div");
      d.textContent = String(n);
      Object.assign(d.style, { position: "fixed", left: `${r.x - 12}px`, top: `${r.y - 12}px`, width: "26px", height: "26px", borderRadius: "50%", background: "#d9480f", color: "#fff", font: "bold 15px 'Times New Roman',serif", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 99999, boxShadow: "0 0 0 2px #fff" });
      document.body.appendChild(d);
    }
  });
  await p.screenshot({ path: `${out}/overview.png` });
  await p.evaluate(() => document.querySelectorAll("body > div[style*='fixed']").forEach((e) => e.remove()));

  await snap("sat", [(await p.$$(".chartview"))[0], (await p.$$("table.matrix"))[0]]);
  await click("Pressure map"); await sleep(500);
  await snap("pressure-map", [(await p.$$(".chartview"))[0]]);
  // map style example for the manual: Viridis, colour bands, contour lines and streamlines
  const setSel = (label, value) => p.evaluate((label, value) => { const el = document.querySelector(`select[aria-label="${label}"]`); const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set; set.call(el, value); el.dispatchEvent(new Event("change", { bubbles: true })); }, label, value);
  await setSel("Colour scale", "viridis"); await setSel("Fill style", "bands"); await sleep(200);
  await p.click('input[aria-label="Contour lines"]'); await p.click('input[aria-label="Streamlines"]'); await sleep(700);
  await snap("mapstyle", [(await p.$$(".mapstyle"))[0], (await p.$$(".chartview"))[0]]);
  await setSel("Fill style", "none"); await setSel("Colour scale", "jet"); await setSel("Contour reach", "0.5"); await setSel("Number of contour levels", "15");
  await p.click('input[aria-label="Streamlines"]'); await sleep(700);
  await snap("mapcontour", [(await p.$$(".mapstyle"))[0], (await p.$$(".chartview"))[0]]);
  await click("Reset style"); await sleep(400);
  // zoom example: drag a box on the pressure map
  const sv = await (await p.$(".chartsvg svg")).evaluate((s) => { const q = s.getBoundingClientRect(); return { x: q.x, y: q.y, w: q.width, h: q.height }; });
  await p.mouse.move(sv.x + sv.w * 0.30, sv.y + sv.h * 0.38); await p.mouse.down();
  await p.mouse.move(sv.x + sv.w * 0.52, sv.y + sv.h * 0.62, { steps: 8 }); await p.mouse.up(); await sleep(500);
  await snap("zoom", [(await p.$$(".chartview"))[0]]);
  await click("Time series"); await sleep(500);
  await snap("time-series", [(await p.$$(".chartview"))[0]]);
  await click("Interference matrix"); await sleep(400);
  { const t = await p.$$("table.matrix"); await snap("matrix", [t[0], t[1]]); }
  await click("Limit check"); await sleep(400);
  { const t = await p.$$("table.matrix"); await snap("limits", t); }
  await click("Compare boundaries"); await sleep(500);
  await snap("compare", [(await p.$$(".chartview"))[0], (await p.$$("table.matrix"))[0]]);
  await b.close();
  console.log("shots done");
})();
