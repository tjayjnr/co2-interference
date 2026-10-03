// Publication-style report: a neutral block model, a builder that fills it from the analysis,
// and two renderers (PDF via jsPDF, Word via docx).

export type Block =
  | { t: "title"; title: string; subtitle?: string; author?: string; date: string }
  | { t: "abstract"; text: string; keywords: string }
  | { t: "h1" | "h2"; text: string }
  | { t: "p"; text: string }
  | { t: "bullets"; items: string[] }
  | { t: "eq"; text: string; n: number }
  | { t: "table"; caption: string; head: string[]; rows: string[][]; note?: string; textual?: boolean }
  | { t: "fig"; caption: string; png: string; w: number; h: number }
  | { t: "refs"; items: string[] };

export interface FigureData {
  png: string;
  w: number;
  h: number;
}

export interface ReportData {
  project: string;
  author: string;
  date: string;
  nWells: number;
  nPoints: number;
  horizon: number;
  pLabel: string;
  paramHead: string[];
  paramRows: string[][];
  wellHead: string[];
  wellRows: string[][];
  pointHead: string[];
  pointRows: string[][];
  boundaryDesc: string;
  coordDesc: string;
  skinDesc: string;
  limits: { p0: string; pfrac: string; safety: string; maxBuildup: string; maxBhp: string };
  kpi: { worst: string; peak: string; at: string; allowable: string; exceeded: boolean; scale: string; interferenceShare: number };
  peakHead: string[];
  peakRows: string[][];
  matrixTime: string;
  matrixHead: string[];
  matrixRows: string[][];
  arrivalThreshold: string;
  arrivalHead: string[];
  arrivalRows: string[][];
  pointCheckHead: string[];
  pointCheckRows: string[][];
  compareHead: string[];
  compareRows: string[][];
  compareSentence: string;
  driverHead: string[];
  driverRows: string[][];
  driverSentence: string;
  threeZone: boolean;
  zoneHead: string[];
  zoneRows: string[][];
  zoneNote: string;
  scheduleHead: string[];
  scheduleRows: string[][];
  satHead: string[];
  satRows: string[][];
  satSentence: string;
  figures: { sat?: FigureData; map?: FigureData; bhp?: FigureData; drivers?: FigureData; compare?: FigureData };
  warnings: string[];
}

export function buildBlocks(d: ReportData): Block[] {
  const b: Block[] = [];
  let fig = 0;
  let tab = 0;
  let eq = 0;
  const E = (text: string): Block => ({ t: "eq", text, n: ++eq });
  const T = (caption: string, head: string[], rows: string[][], note?: string): Block => ({ t: "table", caption: `Table ${++tab}. ${caption}`, head, rows, note });
  const F = (f: FigureData | undefined, caption: string): Block[] => (f ? [{ t: "fig", caption: `Figure ${++fig}. ${caption}`, png: f.png, w: f.w, h: f.h }] : []);

  b.push({ t: "title", title: "Pressure Interference Analysis for Multi-Well CO₂ Injection into a Saline Aquifer", subtitle: d.project || undefined, author: d.author || undefined, date: d.date });
  b.push({
    t: "abstract",
    text:
      `A screening-level pressure interference analysis was carried out for ${d.nWells} CO₂ injection well${d.nWells === 1 ? "" : "s"} operating in a confined saline aquifer over a ${d.horizon}-year horizon. ` +
      `Pressure buildup was computed with the Theis line-source solution, superposed in space and time over all wells, with the aquifer boundary condition represented by image wells and the near-well pressure drop represented by skin. ` +
      `The highest wellbore buildup is ${d.kpi.peak} (${d.kpi.worst}, ${d.kpi.at}) against an allowable buildup of ${d.kpi.allowable}; the field therefore ${d.kpi.exceeded ? "exceeds" : "remains within"} the pressure limit. ` +
      `${d.kpi.interferenceShare}% of the peak buildup at the controlling well is caused by interference from the other wells.`,
    keywords: "CO₂ storage; pressure interference; superposition; Theis solution; skin; saline aquifer",
  });

  b.push({ t: "h1", text: "1. Introduction" });
  b.push({ t: "p", text: "Injecting CO₂ into a saline aquifer displaces brine and raises the formation pressure well beyond the CO₂ plume. When several injectors operate in the same aquifer, their pressure fields overlap, and the buildup at any one well is the sum of its own response and the interference from its neighbours. This report quantifies that interference, compares it with a pressure limit derived from the fracture gradient, and examines the sensitivity of the result to the aquifer boundary condition and to near-well skin." });

  b.push({ t: "h1", text: "2. Methodology" });
  b.push({ t: "h2", text: "2.1 Single-well pressure response" });
  b.push({ t: "p", text: "The aquifer is treated as homogeneous, isotropic and confined, with single-phase slightly compressible radial flow. The injected CO₂ mass is converted to an equivalent reservoir-volume rate q using the CO₂ density at reservoir conditions, and brine viscosity is used throughout (brine-equivalent approach). The buildup at distance r and time t is given by the Theis line-source solution (Theis, 1935):" });
  b.push(E("Δp(r, t) = q μ / (4π k h) · E₁(r² / 4ηt),   η = k / (φ μ c_t)"));
  b.push({ t: "p", text: "where k is permeability, h thickness, μ viscosity, φ porosity, c_t total compressibility, η the hydraulic diffusivity and E₁ the exponential integral:" });
  b.push(E("E₁(u) = integral of ( e^(−s) / s ) ds, taken from s = u to infinity"));
  if (d.threeZone) b.push({ t: "p", text: "In this analysis the single-phase pressure function p_D is replaced by the three-zone CO₂–brine function of Section 2.8; the Theis expression above is its limit when all three zones have the properties of brine." });
  b.push({ t: "h2", text: "2.2 Multi-well superposition and shut-in" });
  b.push({ t: "p", text: "Because the governing equation is linear, the buildup at any point is the sum of the contributions of all wells and of all rate changes of each well. A well i that injects at rates q_i,1, q_i,2, …, q_i,N (each in force until the next change) is represented by one single-well solution per rate change, with the elapsed time since that change; the final change is the shut-in (q = 0), which superposes a negative rate and makes the pressure recover towards the initial value:" });
  b.push(E("Δp(x, t) = Σ_i Σ_j (q_i,j − q_i,j−1) · μ / (4π k h) · E₁( r_i² / 4η (t − t_i,j−1) ),   q_i,0 = 0"));
  b.push({ t: "h2", text: "2.3 Boundary conditions" });
  b.push({ t: "p", text: "Three conditions were evaluated: an infinite-acting aquifer; a constant-pressure boundary; and a no-flow (sealing) boundary. The bounded cases are solved with the method of images (Matthews and Russell, 1967): each well is mirrored across the straight boundary, and the image carries the same sign for a no-flow boundary (pressure is reinforced) and the opposite sign for a constant-pressure boundary (pressure is relieved):" });
  b.push(E("Δp = Δp_real ± Δp_image,   x′ = 2x_b − x"));
  b.push({ t: "h2", text: "2.4 Well skin" });
  b.push({ t: "p", text: "Near-well damage adds a steady pressure drop across the skin zone of the injector, acting only on that well and only while it injects (Earlougher, 1977):" });
  b.push(E("Δp_s = q μ s / (2π k h)"));
  b.push({ t: "p", text: `${d.skinDesc} Where the skin factor was calculated from a damaged zone, the Hawkins (1956) relation was used:` });
  b.push(E("s = (k / k_s − 1) ln(r_s / r_w)"));
  b.push({ t: "h2", text: "2.5 Pressure limit" });
  b.push({ t: "p", text: "The allowable buildup is the safety-factored fracture pressure less the initial pressure, using hydrostatic and fracture gradients applied at the injection depth D:" });
  b.push(E("Δp_max = f · G_f · D − G_h · D"));

  b.push({ t: "h2", text: "2.6 CO₂ saturation" });
  b.push({ t: "p", text: "The CO₂ plume around each injector is described by the radial Buckley–Leverett (Welge) solution for CO₂ displacing brine at the volumetric injection rate q. A given saturation S_g sits at radius r at time t according to" });
  b.push(E("r²(S_g, t) = q t / (π φ h) · df_g/dS_g"));
  b.push({ t: "p", text: "where the fractional flow of CO₂ follows from Corey relative permeabilities:" });
  b.push(E("f_g = 1 / (1 + k_rw μ_g / (k_rg μ_w)),   k_rw = (1 − S*)^n_w,   k_rg = k_rg,max · S*^n_g,   S* = S_g / (1 − S_wr)"));
  b.push({ t: "p", text: "The saturation jumps at the plume front to the Welge tangent value, where df_g/dS_g equals f_g/S_g. Overlapping plumes of neighbouring wells are added and capped at 1 − S_wr, and each plume stops growing at the end of injection of its well. Gravity override, dissolution, capillary effects and residual trapping are not included." });

  b.push({ t: "p", text: "For quadratic Corey curves the shock saturation and the front radius reduce to closed form, which was used to verify the numerical solution (β_g is the slope of the fractional-flow curve at the front and M_λ the end-point mobility ratio):" });
  b.push(E("r_g(t) = √( r_w² + β_g V(t) / (π φ h) ),   β_g = (1 + √(1 + M_λ)) / (2 (1 − S_wr)),   M_λ = k_rg0 μ_w / (k_rw0 μ_g)"));
  b.push({ t: "h2", text: "2.7 Dry-zone radius" });
  b.push({ t: "p", text: "Next to the injector the CO₂ evaporates the brine and leaves a dry zone. A water balance at the moving dry front, using the cumulative reservoir volume V(t) of CO₂ injected, gives" });
  b.push(E("r_d(t) = √( r_w² + α_d V(t) / (π φ h) ),   α_d = ρ_g c_eq / ( ρ_b (1 − X_s) S_wr + ρ_g c_eq (1 − S_wr) )"));
  b.push({ t: "p", text: "where c_eq is the mass of water carried per mass of CO₂ at equilibrium. It follows from equality of the water fugacity in the CO₂-rich phase and in the brine, using the IAPWS saturation pressure P_sat(T), a Poynting correction Π_w and the NaCl water activity a_w (screening value Φ_w ≈ 1 unless a different fugacity coefficient is entered). It is evaluated at the initial reservoir pressure P:" });
  b.push(E("y_w = a_w P_sat Π_w / (Φ_w P),   c_eq = (M_w / M_CO2) · y_w / (1 − y_w),   Π_w = exp[ V_w (P − P_sat) / (R T) ]"));

  if (d.threeZone) {
    b.push({ t: "h2", text: "2.8 Three-zone pressure kernel" });
    b.push({ t: "p", text: "Injected CO₂ displaces brine and creates three regions around each well: a dry CO₂ zone (zone 1, r ≤ r_d), a CO₂–brine two-phase zone (zone 2, r_d < r ≤ r_g) and the undisturbed brine zone (zone 3, r > r_g). Each zone has its own mobility and diffusivity, and in each zone the dimensionless pressure has the similarity form" });
    b.push(E("P_D,n(r_D, t_D) = a_n + b_n E₁( r_D² / 4 D_n t_D ),   n = 1, 2, 3"));
    b.push({ t: "p", text: "with r_D = r / r_w, t_D = k t / (μ_w φ c_t r_w²) and the brine zone as reference. The zone diffusivity ratio is D_n = m_n / c*_n, where m_n = Λ_n / Λ_0 is the mobility ratio (Λ_0 = k / μ_w) and c*_n = c_t,n / c_t the storage ratio. The mobility ratios are m_1 = k_rg,1 μ_w / μ_g, m_2 = k_rg(S̄) μ_w / μ_g + k_rw(S̄) at the average saturation S̄ = 1/β_g behind the front, and m_3 = 1; the zone compressibilities are c_t,1 = c_f + c_g, c_t,2 = c_f + (1 − S̄) c_w + S̄ c_g and c_t,3 = c_t. The constants follow from the line-source condition (b_1 = 1 / 2m_1), the far-field condition (a_3 = 0) and continuity of pressure and flux at the two fronts:" });
    b.push(E("b_2 = e^(u_2d − u_1d) / 2m_2,   b_3 = e^((u_2d − u_1d) + (u_3g − u_2g)) / 2m_3,   a_2 = b_3 E₁(u_3g) − b_2 E₁(u_2g),   a_1 = a_2 + b_2 E₁(u_2d) − b_1 E₁(u_1d)"));
    b.push({ t: "p", text: "Here u_nd = r_dD² / 4 D_n t_D and u_ng = r_gD² / 4 D_n t_D are constants because the dry front r_d and the gas front r_g both grow with √t (Sections 2.6 and 2.7). The pressure change is Δp = q μ_w P_D / (2π k h) plus the skin term. For a variable rate each rate change is represented by this kernel evaluated with the rate of the period that starts at that change (a shut-in uses the rate it stops), and the contributions are added by superposition in time." });
  }

  b.push({ t: "h1", text: "3. Input Data" });
  b.push({ t: "p", text: `Aquifer, fluid and pressure-limit parameters are listed in Table ${tab + 1}, and the well and monitoring-point data in Tables ${tab + 2} and ${tab + 3}. ${d.coordDesc} ${d.boundaryDesc}` });
  b.push(T("Aquifer, fluid and pressure-limit input parameters.", d.paramHead, d.paramRows));
  b.push(T("Injection well data (coordinates, CO₂ injection rate, injection period and skin factor).", d.wellHead, d.wellRows));
  if (d.threeZone) b.push(T("Zone properties of the three-zone pressure model.", d.zoneHead, d.zoneRows, d.zoneNote));
  if (d.scheduleRows.length) b.push(T("Rate changes of the injection wells (the new rate is in force from the stated year until the next change or the shut-in at the end year).", d.scheduleHead, d.scheduleRows));
  if (d.pointRows.length) b.push(T("Monitoring points.", d.pointHead, d.pointRows));

  b.push({ t: "h1", text: "4. Results" });
  b.push({ t: "h2", text: "4.1 CO₂ saturation and plume extent" });
  b.push({ t: "p", text: d.satSentence });
  b.push(T(`CO₂ plume of each well at t = ${d.matrixTime}.`, d.satHead, d.satRows));
  b.push(...F(d.figures.sat, `CO₂ saturation map at t = ${d.matrixTime}, showing the plume of each injector.`));
  b.push({ t: "h2", text: "4.2 Pressure buildup and limit check" });
  b.push({ t: "p", text: `The pressure limits at the injection depth are an initial pressure of ${d.limits.p0}, a fracture pressure of ${d.limits.pfrac} and, with a safety factor of ${d.limits.safety}, an allowable buildup of ${d.limits.maxBuildup} (maximum allowable bottomhole pressure ${d.limits.maxBhp}). Table ${tab + 1} gives the peak wellbore buildup of each well, split into the well's own response, skin and interference from the other wells. Pass/fail is judged against the allowable buildup only; the interference threshold of ${d.arrivalThreshold} is not a pass/fail limit and is used solely to define the detection contour, the arrival times and the monitoring-point check.` });
  b.push(T(`Peak wellbore pressure buildup per well (${d.pLabel}) and comparison with the allowable buildup.`, d.peakHead, d.peakRows));
  b.push(...F(d.figures.bhp, `Bottomhole pressure of each well and monitoring point, with the field-maximum and field-average curves and the maximum allowable bottomhole pressure.`));
  b.push({ t: "h2", text: "4.3 Well-to-well interference" });
  b.push({ t: "p", text: `Table ${tab + 1} gives the pressure that each injector (row) contributes at every well (column) at t = ${d.matrixTime}; the diagonal is each well's own buildup including skin. Table ${tab + 2} gives the time at which a single source well raises the pressure at each target by ${d.arrivalThreshold}.` });
  b.push(T(`Interference matrix at t = ${d.matrixTime} (${d.pLabel}).`, d.matrixHead, d.matrixRows));
  b.push(T(`Arrival time (years) of a pressure rise of ${d.arrivalThreshold} from each source well at each target.`, d.arrivalHead, d.arrivalRows, "A dash indicates the threshold is not reached within the injection period and analysis horizon."));
  if (d.pointCheckRows.length) {
    b.push({ t: "p", text: `Monitoring points are compared with the interference threshold of ${d.arrivalThreshold} (Table ${tab + 1}); this is a detection level, not a pressure limit.` });
    b.push(T(`Monitoring points compared with the interference threshold of ${d.arrivalThreshold}.`, d.pointCheckHead, d.pointCheckRows));
  }
  b.push(...F(d.figures.map, `Pressure buildup map at t = ${d.matrixTime}, with the interference-threshold and allowable-buildup contours.`));
  b.push({ t: "h2", text: "4.4 Sensitivity to the boundary condition" });
  b.push({ t: "p", text: d.compareSentence });
  b.push(T(`Peak wellbore buildup (${d.pLabel}), skin included, for the three boundary conditions.`, d.compareHead, d.compareRows));
  b.push(...F(d.figures.compare, "Wellbore buildup of the controlling well for the three boundary conditions."));
  b.push({ t: "h2", text: "4.5 Drivers of the field-maximum pressure" });
  b.push({ t: "p", text: d.driverSentence });
  b.push(T(`Contributions to the field-maximum buildup (${d.pLabel}) at the time of the peak.`, d.driverHead, d.driverRows));
  b.push(...F(d.figures.drivers, "Field-maximum buildup split by source well and skin over time."));

  b.push({ t: "h1", text: "5. Discussion" });
  b.push({ t: "p", text: `${d.kpi.exceeded ? `The analysis indicates that the allowable buildup is exceeded at ${d.kpi.worst}.` : `The analysis indicates that the allowable buildup is not exceeded at any well.`} Because the model is linear in injection rate, scaling all rates by a factor of ${d.kpi.scale} brings the worst well exactly to the limit; this factor is a first-order guide to the rate reduction (or headroom) available. The comparison of boundary conditions brackets the result: a sealing boundary is the conservative case and a constant-pressure boundary the optimistic one, and the true boundary behaviour of the formation should be established from geological data and pressure monitoring.` });
  if (d.warnings.length) b.push({ t: "p", text: `Input checks raised the following notes: ${d.warnings.join(" ")}` });

  b.push({ t: "h1", text: "6. Assumptions and Limitations" });
  b.push({
    t: "bullets",
    items: [
      "Homogeneous, isotropic, confined aquifer of constant thickness; no leakage through the caprock.",
      "Brine-equivalent single-phase flow: the CO₂ is converted to reservoir volume and brine viscosity is used everywhere. This overstates near-well pressure because CO₂ is less viscous than brine, but is reasonable for far-field interference.",
      "Wells are evaluated at the wellbore radius with a constant skin factor; wellbore storage, non-Darcy flow and CO₂-mobility effects are not modelled. The pressure kernel is either the single-phase (brine-equivalent) Theis solution or the three-zone CO₂–brine kernel; zone properties are taken at the average saturation behind the front, and the kernel treats the fronts as sharp.",
      "A single straight boundary is represented by image wells; multiple faults, heterogeneity, dissolution and brine production are not modelled.",
      "The results are intended for screening and ranking of well layouts and should be confirmed with numerical reservoir simulation before engineering decisions are made.",
    ],
  });

  b.push({
    t: "refs",
    items: [
      "Buckley, S.E., Leverett, M.C., 1942. Mechanism of fluid displacement in sands. Transactions of the AIME, 146, 107–116.",
      "Earlougher, R.C., Jr., 1977. Advances in Well Test Analysis. SPE Monograph Series, Vol. 5. Society of Petroleum Engineers, Richardson, TX.",
      "Hawkins, M.F., Jr., 1956. A note on the skin effect. Transactions of the AIME, 207, 356–357.",
      "Matthews, C.S., Russell, D.G., 1967. Pressure Buildup and Flow Tests in Wells. SPE Monograph Series, Vol. 1. Society of Petroleum Engineers, New York.",
      "Theis, C.V., 1935. The relation between the lowering of the piezometric surface and the rate and duration of discharge of a well using ground-water storage. Transactions of the American Geophysical Union, 16(2), 519–524.",
      "Welge, H.J., 1952. A simplified method for computing oil recovery by gas or water drive. Transactions of the AIME, 195, 91–98.",
    ],
  });
  return b;
}

// ---- PDF -------------------------------------------------------------------

export interface FontData {
  regular: string; // base64 TTF
  bold: string;
  italic: string;
}

// The PDF font (STIX) has no subscript-digit glyphs, so those fall back to plain characters.
const SUB: Record<string, string> = { "₀": "0", "₁": "1", "₂": "2", "₃": "3", "₄": "4", "₅": "5", "₆": "6", "₇": "7", "₈": "8", "₉": "9", "ᵢ": "i", "ₛ": "s", "ᵤ": "u", "₌": "=", "⁻": "-", "ˢ": "s" };
const pdfSafe = (t: string) => t.replace(/[₀-₉ᵢₛᵤ₌⁻ˢ]/g, (ch) => SUB[ch] ?? ch);
function pdfBlocks(blocks: Block[]): Block[] {
  return blocks.map((b) => {
    switch (b.t) {
      case "title": return { ...b, title: pdfSafe(b.title), subtitle: b.subtitle && pdfSafe(b.subtitle), author: b.author && pdfSafe(b.author) };
      case "abstract": return { ...b, text: pdfSafe(b.text), keywords: pdfSafe(b.keywords) };
      case "h1": case "h2": case "p": return { ...b, text: pdfSafe(b.text) };
      case "bullets": return { ...b, items: b.items.map(pdfSafe) };
      case "eq": return { ...b, text: pdfSafe(b.text).replace(/√/g, "sqrt") }; // the italic PDF font has no radical sign
      case "table": return { ...b, caption: pdfSafe(b.caption), head: b.head.map(pdfSafe), rows: b.rows.map((r) => r.map(pdfSafe)), note: b.note && pdfSafe(b.note) };
      case "fig": return { ...b, caption: pdfSafe(b.caption) };
      case "refs": return { ...b, items: b.items.map(pdfSafe) };
    }
  });
}

export async function renderPdf(rawBlocks: Block[], fonts: FontData, runningTitle: string): Promise<ArrayBuffer> {
  const blocks = pdfBlocks(rawBlocks);
  const { jsPDF } = await import("jspdf");
  const { autoTable } = await import("jspdf-autotable");
  const doc = new jsPDF({ unit: "mm", format: "a4", compress: true });
  doc.addFileToVFS("STIX-Regular.ttf", fonts.regular);
  doc.addFont("STIX-Regular.ttf", "STIX", "normal");
  doc.addFileToVFS("STIX-Bold.ttf", fonts.bold);
  doc.addFont("STIX-Bold.ttf", "STIX", "bold");
  doc.addFileToVFS("STIX-Italic.ttf", fonts.italic);
  doc.addFont("STIX-Italic.ttf", "STIX", "italic");

  const PW = 210, PH = 297, ML = 25, MR = 25, MT = 24, MB = 22;
  const CW = PW - ML - MR;
  const PT = 0.3528; // mm per pt
  let y = MT;
  const ensure = (h: number) => {
    if (y + h > PH - MB) { doc.addPage(); y = MT; }
  };
  const font = (style: "normal" | "bold" | "italic", size: number) => { doc.setFont("STIX", style); doc.setFontSize(size); };

  const para = (text: string, o: { size?: number; style?: "normal" | "bold" | "italic"; align?: "left" | "center" | "justify"; gap?: number; indent?: number } = {}) => {
    const size = o.size ?? 10.5;
    font(o.style ?? "normal", size);
    const lh = size * PT * 1.4;
    const width = CW - (o.indent ?? 0) * 2;
    const x0 = ML + (o.indent ?? 0);
    const lines = doc.splitTextToSize(text, width) as string[];
    lines.forEach((line, i) => {
      ensure(lh);
      if (o.align === "center") doc.text(line, ML + CW / 2, y + lh * 0.75, { align: "center" });
      else if (o.align === "justify" && i < lines.length - 1) doc.text(line, x0, y + lh * 0.75, { align: "justify", maxWidth: width });
      else doc.text(line, x0, y + lh * 0.75);
      y += lh;
    });
    y += o.gap ?? 2.2;
  };

  // Space a heading needs so it never ends up alone at the bottom of a page: room for what follows it.
  const needAfter = (next: Block | undefined) => {
    if (next?.t === "fig") return Math.min((CW * next.h) / next.w, 105) + 20;
    if (next?.t === "table") return 45;
    return 30;
  };
  for (let bi = 0; bi < blocks.length; bi++) {
    const blk = blocks[bi];
    const next = blocks[bi + 1];
    switch (blk.t) {
      case "title": {
        para(blk.title, { size: 17, style: "bold", align: "center", gap: 2 });
        if (blk.subtitle) para(blk.subtitle, { size: 12, style: "italic", align: "center", gap: 2 });
        para([blk.author, blk.date].filter(Boolean).join("  ·  "), { size: 10.5, align: "center", gap: 3 });
        doc.setDrawColor(40); doc.setLineWidth(0.3); doc.line(ML, y, ML + CW, y); y += 5;
        break;
      }
      case "abstract": {
        para("Abstract", { size: 11, style: "bold", gap: 1 });
        para(blk.text, { size: 10, style: "italic", align: "justify", indent: 6, gap: 2 });
        para(`Keywords: ${blk.keywords}`, { size: 9.5, indent: 6, gap: 4 });
        break;
      }
      case "h1": ensure(Math.max(14, needAfter(next))); y += 3; para(blk.text, { size: 13, style: "bold", gap: 1.5 }); break;
      case "h2": ensure(Math.max(11, needAfter(next))); y += 1; para(blk.text, { size: 11, style: "bold", gap: 1 }); break;
      case "p": para(blk.text, { align: "justify" }); break;
      case "bullets": blk.items.forEach((it) => para(`•  ${it}`, { align: "left", indent: 4, gap: 1 })); y += 2; break;
      case "eq": {
        font("italic", 11);
        const lh = 11 * PT * 1.6;
        const lines = doc.splitTextToSize(blk.text, CW - 22) as string[]; // long equations wrap onto several centred lines
        ensure(lh * lines.length + 2);
        y += 1;
        lines.forEach((ln, i) => doc.text(ln, ML + CW / 2, y + lh * 0.7 + i * lh, { align: "center" }));
        font("normal", 10.5);
        doc.text(`(${blk.n})`, ML + CW, y + lh * 0.7 + ((lines.length - 1) * lh) / 2, { align: "right" });
        y += lh * lines.length + 2;
        break;
      }
      case "table": {
        font("bold", 9.5);
        const cap = doc.splitTextToSize(blk.caption, CW) as string[];
        ensure(cap.length * 4.6 + 22);
        cap.forEach((l) => { doc.text(l, ML, y + 3.4); y += 4.6; });
        y += 1;
        const small = blk.head.length > 7;
        const last = blk.rows.length - 1;
        autoTable(doc, {
          startY: y,
          head: [blk.head],
          body: blk.rows,
          theme: "plain",
          margin: { left: ML, right: MR, top: MT, bottom: MB },
          styles: { font: "STIX", fontSize: small ? 7.5 : 9, cellPadding: { top: 1.1, bottom: 1.1, left: 1.4, right: 1.4 }, textColor: 20, overflow: "linebreak" },
          headStyles: { font: "STIX", fontStyle: "bold", fillColor: false as unknown as undefined, lineColor: 20, lineWidth: { top: 0.35, bottom: 0.18, left: 0, right: 0 } },
          columnStyles: Object.fromEntries(blk.head.map((_, i) => [i, { halign: i === 0 || blk.textual ? "left" : "right" }])) as never,
          didParseCell: (h) => {
            h.cell.styles.halign = h.column.index === 0 || blk.textual ? "left" : "right";
            if (h.section === "body" && h.row.index === last) {
              h.cell.styles.lineColor = 20;
              h.cell.styles.lineWidth = { top: 0, bottom: 0.35, left: 0, right: 0 };
            }
          },
        });
        y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 2;
        if (blk.note) para(blk.note, { size: 8.5, style: "italic", gap: 2 });
        y += 3;
        break;
      }
      case "fig": {
        let w = CW;
        let h = (CW * blk.h) / blk.w;
        if (h > 105) { h = 105; w = (h * blk.w) / blk.h; }
        font("italic", 9);
        const cap = doc.splitTextToSize(blk.caption, CW) as string[];
        ensure(h + cap.length * 4.2 + 6);
        doc.addImage(blk.png, "PNG", ML + (CW - w) / 2, y, w, h, undefined, "FAST");
        y += h + 2;
        font("italic", 9);
        cap.forEach((l) => { doc.text(l, ML, y + 3.2); y += 4.2; });
        y += 5;
        break;
      }
      case "refs": {
        ensure(14); y += 3;
        para("References", { size: 13, style: "bold", gap: 1.5 });
        blk.items.forEach((r) => para(r, { size: 9.5, indent: 5, gap: 1.6 }));
        break;
      }
    }
  }
  const n = doc.getNumberOfPages();
  for (let i = 1; i <= n; i++) {
    doc.setPage(i);
    font("normal", 8.5);
    doc.setTextColor(90);
    doc.text(pdfSafe(runningTitle), ML, PH - 12);
    doc.text(`${i} / ${n}`, ML + CW, PH - 12, { align: "right" });
    doc.setTextColor(0);
  }
  return doc.output("arraybuffer");
}

// ---- Word ------------------------------------------------------------------

function dataUrlBytes(url: string): Uint8Array {
  const bin = atob(url.split(",")[1]);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function renderDocx(blocks: Block[], runningTitle: string): Promise<Blob> {
  const {
    AlignmentType, BorderStyle, Document, Footer, HeadingLevel, ImageRun, Packer, PageNumber, Paragraph, Table, TableCell, TableRow, TabStopType, TextRun, WidthType,
  } = await import("docx");
  const FONT = "Times New Roman";
  const none = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
  const run = (text: string, o: { bold?: boolean; italics?: boolean; size?: number } = {}) => new TextRun({ text, font: FONT, bold: o.bold, italics: o.italics, size: o.size ?? 22 });
  const children: (InstanceType<typeof Paragraph> | InstanceType<typeof Table>)[] = [];

  for (const blk of blocks) {
    switch (blk.t) {
      case "title":
        children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 80 }, children: [run(blk.title, { bold: true, size: 34 })] }));
        if (blk.subtitle) children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 80 }, children: [run(blk.subtitle, { italics: true, size: 24 })] }));
        children.push(new Paragraph({
          alignment: AlignmentType.CENTER, spacing: { after: 160 },
          border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "222222", space: 6 } },
          children: [run([blk.author, blk.date].filter(Boolean).join("  ·  "))],
        }));
        break;
      case "abstract":
        children.push(new Paragraph({ spacing: { after: 40 }, children: [run("Abstract", { bold: true, size: 22 })] }));
        children.push(new Paragraph({ alignment: AlignmentType.JUSTIFIED, indent: { left: 360, right: 360 }, spacing: { after: 60, line: 264 }, children: [run(blk.text, { italics: true, size: 20 })] }));
        children.push(new Paragraph({ indent: { left: 360, right: 360 }, spacing: { after: 200 }, children: [run("Keywords: ", { bold: true, size: 19 }), run(blk.keywords, { size: 19 })] }));
        break;
      case "h1":
        children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, keepNext: true, spacing: { before: 280, after: 100 }, children: [run(blk.text, { bold: true, size: 26 })] }));
        break;
      case "h2":
        children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, keepNext: true, spacing: { before: 160, after: 60 }, children: [run(blk.text, { bold: true, size: 22 })] }));
        break;
      case "p":
        children.push(new Paragraph({ alignment: AlignmentType.JUSTIFIED, spacing: { after: 120, line: 276 }, children: [run(blk.text)] }));
        break;
      case "bullets":
        blk.items.forEach((it) => children.push(new Paragraph({ bullet: { level: 0 }, alignment: AlignmentType.JUSTIFIED, spacing: { after: 50, line: 264 }, children: [run(it)] })));
        break;
      case "eq":
        children.push(new Paragraph({
          spacing: { before: 60, after: 100 },
          tabStops: [{ type: TabStopType.CENTER, position: 4536 }, { type: TabStopType.RIGHT, position: 9072 }],
          children: [run("\t"), run(blk.text, { italics: true }), run(`\t(${blk.n})`)],
        }));
        break;
      case "table": {
        children.push(new Paragraph({ keepNext: true, spacing: { before: 120, after: 60 }, children: [run(blk.caption, { bold: true, size: 20 })] }));
        const cell = (text: string, i: number, kind: "head" | "body" | "last") =>
          new TableCell({
            margins: { top: 40, bottom: 40, left: 70, right: 70 },
            borders: {
              top: kind === "head" ? { style: BorderStyle.SINGLE, size: 8, color: "111111" } : none,
              bottom: kind === "head" ? { style: BorderStyle.SINGLE, size: 4, color: "111111" } : kind === "last" ? { style: BorderStyle.SINGLE, size: 8, color: "111111" } : none,
              left: none, right: none,
            },
            children: [new Paragraph({ alignment: i === 0 || blk.textual ? AlignmentType.LEFT : AlignmentType.RIGHT, children: [run(text, { bold: kind === "head", size: blk.head.length > 7 ? 15 : 18 })] })],
          });
        const last = blk.rows.length - 1;
        children.push(new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          borders: { top: none, bottom: none, left: none, right: none, insideHorizontal: none, insideVertical: none },
          rows: [
            new TableRow({ tableHeader: true, cantSplit: true, children: blk.head.map((h, i) => cell(h, i, "head")) }),
            ...blk.rows.map((r, ri) => new TableRow({ cantSplit: true, children: r.map((c, i) => cell(c, i, ri === last ? "last" : "body")) })),
          ],
        }));
        if (blk.note) children.push(new Paragraph({ spacing: { before: 40, after: 80 }, children: [run(blk.note, { italics: true, size: 17 })] }));
        else children.push(new Paragraph({ spacing: { after: 100 }, children: [] }));
        break;
      }
      case "fig": {
        let w = 560;
        let h = (w * blk.h) / blk.w;
        if (h > 420) { h = 420; w = (h * blk.w) / blk.h; }
        children.push(new Paragraph({
          alignment: AlignmentType.CENTER, keepNext: true, spacing: { before: 120, after: 60 },
          children: [new ImageRun({ type: "png", data: dataUrlBytes(blk.png), transformation: { width: Math.round(w), height: Math.round(h) }, altText: { title: blk.caption, description: blk.caption, name: "figure" } })],
        }));
        children.push(new Paragraph({ spacing: { after: 160 }, children: [run(blk.caption, { italics: true, size: 18 })] }));
        break;
      }
      case "refs":
        children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, keepNext: true, spacing: { before: 280, after: 100 }, children: [run("References", { bold: true, size: 26 })] }));
        blk.items.forEach((r) => children.push(new Paragraph({ indent: { left: 360, hanging: 360 }, spacing: { after: 70 }, children: [run(r, { size: 20 })] })));
        break;
    }
  }

  const doc = new Document({
    creator: "CO2 Interference Analyzer",
    title: runningTitle,
    styles: { default: { document: { run: { font: FONT, size: 22 } } } },
    sections: [{
      properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1361, bottom: 1247, left: 1417, right: 1417 } } },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            tabStops: [{ type: TabStopType.RIGHT, position: 9072 }],
            children: [new TextRun({ text: runningTitle, font: FONT, size: 17, color: "555555" }), new TextRun({ text: "\t", font: FONT, size: 17 }), new TextRun({ children: [PageNumber.CURRENT, " / ", PageNumber.TOTAL_PAGES], font: FONT, size: 17, color: "555555" })],
          })],
        }),
      },
      children,
    }],
  });
  return Packer.toBlob(doc);
}
