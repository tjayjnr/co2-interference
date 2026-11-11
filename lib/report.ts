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
  /** pressure model: two-phase CO2-brine (three-zone), single-phase CO2 or single-phase water */
  model: "two" | "co2" | "water";
  modelLabel: string;
  evaporation: boolean;
  paramHead: string[];
  paramRows: string[][];
  wellHead: string[];
  wellRows: string[][];
  pointHead: string[];
  pointRows: string[][];
  boundaryDesc: string;
  coordDesc: string;
  skinDesc: string;
  /** the program's pressure check: a sentence describing it, and the allowable BHP / buildup ("–" when not assessed) */
  limits: { p0: string; check: string; assessed: boolean; maxBuildup: string; maxBhp: string };
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
  zoneHead: string[];
  zoneRows: string[][];
  zoneNote: string;
  scheduleHead: string[];
  scheduleRows: string[][];
  satHead: string[];
  satRows: string[][];
  satSentence: string;
  bhpHead: string[];
  /** cumulative injected mass of the field at the end of injection */
  injectedTotal: string;
  bhpRows: string[][];
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
  const two = d.model === "two";
  const fluid = d.model === "water" ? "water" : "CO₂";

  b.push({ t: "title", title: `Pressure Interference Analysis for Multi-Well ${d.model === "water" ? "Water" : "CO₂"} Injection into a Saline Aquifer`, subtitle: d.project || undefined, author: d.author || undefined, date: d.date });
  b.push({
    t: "abstract",
    text:
      `A screening-level pressure interference analysis was carried out for ${d.nWells} ${fluid} injection well${d.nWells === 1 ? "" : "s"} operating in a confined saline aquifer over a ${d.horizon}-year horizon. ` +
      `The bottom-hole pressure of each well was computed with an injection-BHP model (${d.modelLabel}) in which the pressure-dependent fluid properties are converged with the bottom-hole pressure; the pressure fields of all wells were superposed, with the aquifer boundary represented by image wells and the near-well pressure drop represented by skin. ` +
      (d.limits.assessed
        ? `The highest wellbore buildup is ${d.kpi.peak} (${d.kpi.worst}, ${d.kpi.at}) against an allowable buildup of ${d.kpi.allowable}; the field therefore ${d.kpi.exceeded ? "exceeds" : "remains within"} the pressure limit. `
        : `The highest wellbore buildup is ${d.kpi.peak} (${d.kpi.worst}, ${d.kpi.at}); no pressure limit was supplied. `) +
      `${d.kpi.interferenceShare}% of the peak buildup at the controlling well is caused by interference from the other wells. ` +
      `By the end of injection the field has injected ${d.injectedTotal} of ${fluid}.`,
    keywords: `${fluid} injection; bottom-hole pressure; pressure interference; superposition; ${two ? "three-zone model; Peng–Robinson; " : ""}skin; saline aquifer`,
  });

  b.push({ t: "h1", text: "1. Introduction" });
  b.push({ t: "p", text: `Injecting ${fluid} into a saline aquifer raises the formation pressure well beyond the injected volume. When several injectors operate in the same aquifer, their pressure fields overlap, and the bottom-hole pressure at any one well is the sum of its own response and the interference from its neighbours. This report quantifies that interference, compares it with the pressure limit chosen for the study, and examines the sensitivity of the result to the aquifer boundary condition and to near-well skin.` });

  b.push({ t: "h1", text: "2. Methodology" });
  b.push({ t: "h2", text: "2.1 Single-well injection pressure" });
  b.push({ t: "p", text: "Each well follows the injection bottom-hole-pressure model supplied for this study, in field units (psia, ft, mD, cP; one year = 365.25 days). The reservoir is homogeneous and infinite-acting with one permeability k and porosity φ for all zones, constant temperature and constant viscosities. The pressure increase of one well injecting at a constant surface rate q for an elapsed time t is" });
  b.push(E("Δp = 141.2 μ q B / (k h) · ( p_D + s )"));
  if (two) {
    b.push({ t: "p", text: "In the two-phase CO₂–brine model three zones form around the well: dry CO₂ (zone 1, r_w ≤ r ≤ r_d), CO₂ + brine (zone 2, r_d < r ≤ r_g) and brine (zone 3, r > r_g). The prefactor uses the gas viscosity μ_g and the gas formation volume factor B_g, and the dimensionless pressure is referenced to the dry-CO₂ zone (p_D = p_D,gas / k_rg1). In each zone" });
    b.push(E("p_D,n(r_D, t_D) = a_n + b_n E₁( r_D² / 4 D_n t_D ),   r_D = r / r_w,   t_D = k k_rg1 t / (μ_g φ c_t1 r_w²)"));
    b.push({ t: "p", text: "where E₁ is the exponential integral, m_n = Λ_n / Λ_1 is the mobility ratio (Λ_1 = k k_rg1 / μ_g, Λ_2 = k (k_rg2 / μ_g + k_rw2 / μ_w), Λ_3 = k / μ_w), c*_n = c_tn / c_t1 the storage ratio (c_t1 = c_g + c_r, c_t2 = S_g2 c_g + S_w2 c_w + c_r, c_t3 = c_w + c_r) and D_n = m_n / c*_n. The constants follow from the line-source condition, the far-field condition (a_3 = 0) and continuity of pressure and flux at the two fronts:" });
    b.push(E("b_1 = 1 / 2m_1,   b_2 = e^(u_2d − u_1d) / 2m_2,   b_3 = e^((u_2d − u_1d) + (u_3g − u_2g)) / 2m_3,   a_2 = b_3 E₁(u_3g) − b_2 E₁(u_2g),   a_1 = a_2 + b_2 E₁(u_2d) − b_1 E₁(u_1d)"));
    b.push({ t: "p", text: "with u_nd = r_dD² / 4 D_n t_D and u_ng = r_gD² / 4 D_n t_D. The gas front follows from the Corey leading-shock condition (both exponents 3: (M_λ − 1) s_f³ + 3 s_f − 2 = 0, F = (s_f + 2) / (3 s_f (1 − S_wr)); both exponents 2: the matching quadratic front), with M_λ = k_rg0 μ_w / (k_rw0 μ_g) and V_r the cumulative reservoir volume of CO₂ (surface volume × B_g):" });
    b.push(E("r_g = √( r_w² + F V_r / (π φ h) )"));
    b.push({ t: "p", text: d.evaporation
      ? "Next to the well the CO₂ evaporates the residual brine. With the water mole fraction in the CO₂ y_w = a_w P_sat / P (IAPWS saturation pressure, NaCl water activity) and c_eq = (M_w / M_CO2) y_w / (1 − y_w), the dry front is"
      : "Evaporation was not included in this analysis (y_w = c_eq = α_d = 0), so the dry front stays at the wellbore (r_d = r_w) and there is no dry zone. With evaporation the dry front would be" });
    b.push(E("r_d = √( r_w² + α_d V_r / (π φ h) ),   α_d = ρ_g c_eq / ( ρ_b (1 − X_s) S_wr + ρ_g c_eq (1 − S_wr) )"));
    b.push({ t: "p", text: "The zone 2 gas saturation S_g2 follows from the CO₂ mass balance (injected mass less the CO₂ in the dry zone, divided by the zone 2 pore volume), and gives the zone 2 relative permeabilities k_rg2 = k_rg0 x^n_g and k_rw2 = k_rw0 (1 − x)^n_w with x = S_g2 / (1 − S_wr); the zone 2 mobility is Λ_2 = k (k_rg2 / μ_g + k_rw2 / μ_w). The CO₂ properties (compressibility factor Z, compressibility c_g, density ρ_g = p M / (Z R T) and B_g) come from the Peng–Robinson equation of state for pure CO₂ and are evaluated at the bottom-hole pressure itself: at each time the equation P = P_i + Δp(t, P) is solved by fixed-point iteration (Brent's method once the residual changes sign) until the residual is below 10⁻⁴ psi." });
  } else if (d.model === "co2") {
    b.push({ t: "p", text: "In the single-phase CO₂ model the reservoir is initially filled with CO₂ (relative permeability 1). B_g is fixed at 0.0005690187 rb/scf, and the CO₂ density and compressibility c_g are fixed at their Peng–Robinson values at the initial pressure and reservoir temperature; c_t = c_g + c_r and μ = μ_g. The dimensionless pressure is the line-source solution" });
    b.push(E("p_D = ½ E₁( 1 / 4t_D ),   t_D = k t / (μ φ c_t r_w²)"));
  } else {
    b.push({ t: "p", text: "In the single-phase water model the reservoir is initially filled with water (relative permeability 1), B_w = 1.0 rb/STB at all pressures, c_t = c_w + c_r and μ = μ_w; the water density is ρ_w(P) = ρ_w(P_i) exp(c_w (P − P_i)). The dimensionless pressure is the line-source solution" });
    b.push(E("p_D = ½ E₁( 1 / 4t_D ),   t_D = k t / (μ φ c_t r_w²)"));
  }
  b.push({ t: "h2", text: "2.2 Multiwell interference and shut-in" });
  b.push({ t: "p", text: "The single-well expressions above give the pressure increase at any radius r around a well (the same profile is used at the well, r = r_w, and away from it). Following the multiwell section of the model, the pressure at every well is the sum of the profiles of all sources at their distances from it (the well itself at its own radius), so the bottom-hole pressure of a well is the initial pressure plus its own formation response, its skin and the interference from the other wells; skin acts only at the well itself. Each two-phase source has its own constant rate, start year, radius, skin and evaporation choice; its Peng–Robinson properties and fronts are evaluated at its own total bottom-hole pressure, including the pressure from its neighbours, by solving the coupled system of all wells at each time (damped fixed-point iteration to 10⁻⁴ psi). This is a representative-property multiphase superposition approximation; overlapping plumes are flagged, not resolved. Single-phase sources may change rate; their constant-property line-source responses are superposed in time:" });
  b.push(E("Δp(x, t) = Σ_i Σ_j (q_i,j − q_i,j−1) · ½ E₁( r_i² φ μ c_t / (4 k (t − t_i,j)) ) · 141.2 μ B / (k h)"));
  b.push({ t: "p", text: "All wells stop at the project endpoint. With post-shut-in observation, each source's final pressure profile then diffuses at zero rate with its zone radii, mobilities and storage frozen at shut-in (fixed-zone falloff approximation; finite-volume radial grid), and the sources are again added at every well. At the instant of shut-in the flowing skin drop is removed." });
  b.push({ t: "h2", text: "2.3 Boundary conditions" });
  b.push({ t: "p", text: "Three conditions were evaluated: an infinite-acting aquifer; a constant-pressure boundary; and a no-flow (sealing) boundary. The bounded cases are solved with the method of images (Matthews and Russell, 1967): each well is mirrored across the straight boundary, and the image carries the same sign for a no-flow boundary (pressure is reinforced) and the opposite sign for a constant-pressure boundary (pressure is relieved):" });
  b.push(E("Δp = Δp_real ± Δp_image,   x′ = 2x_b − x"));
  b.push({ t: "h2", text: "2.4 Well skin" });
  b.push({ t: "p", text: "Near-well damage adds a steady pressure drop across the skin zone of the injector, acting only on that well and only while it injects (the s term of Equation 1):" });
  b.push(E("Δp_s = 141.2 μ q B s / (k h)"));
  b.push({ t: "p", text: d.skinDesc });
  b.push({ t: "h2", text: "2.5 Pressure limit" });
  b.push({ t: "p", text: "The pressure check of the model compares the required bottom-hole pressure with a user-specified allowable value at every computed time: either a maximum allowable bottom-hole pressure, or a fraction f of the fracture pressure P_frac (a user choice, not a regulatory rule); a well may also carry its own maximum. PASS means the required BHP does not exceed the allowable BHP; rates are not reduced automatically, and the check concerns operating pressure, not mechanical well integrity." });
  b.push(E("BHP_allow = f · P_frac   (or the maximum allowable BHP),   Δp_max = BHP_allow − P_i"));
  if (two) {
    b.push({ t: "h2", text: "2.6 CO₂ saturation map" });
    b.push({ t: "p", text: "The saturation map places, around each injector, the radial Buckley–Leverett (Welge) saturation profile for that well's cumulative reservoir volume of CO₂ V_r, with the same Corey relative permeabilities:" });
    b.push(E("r²(S_g) = V_r / (π φ h) · df_g/dS_g,   f_g = 1 / (1 + k_rw μ_g / (k_rg μ_w))"));
    b.push({ t: "p", text: "Where the plumes of neighbouring wells overlap, the map shows the higher of their saturations, so each plume keeps its own profile from the well outward. Gravity override, dissolution, capillary effects and residual trapping are not included." });
  }

  b.push({ t: "h1", text: "3. Input Data" });
  b.push({ t: "p", text: `Reservoir, fluid and pressure-limit parameters are listed in Table ${tab + 1}, and the well and monitoring-point data in Tables ${tab + 2} and ${tab + 3}. ${d.coordDesc} ${d.boundaryDesc}` });
  b.push(T("Reservoir, fluid and pressure-limit input parameters.", d.paramHead, d.paramRows));
  b.push(T(`Injection well data (coordinates, surface ${fluid} injection rate, injection period and skin factor).`, d.wellHead, d.wellRows));
  if (d.scheduleRows.length) b.push(T("Rate changes of the injection wells (the new rate is in force from the stated year until the next change or the shut-in at the end year).", d.scheduleHead, d.scheduleRows));
  if (d.pointRows.length) b.push(T("Monitoring points.", d.pointHead, d.pointRows));

  b.push({ t: "h1", text: "4. Results" });
  b.push({ t: "h2", text: "4.1 Bottom-hole pressure of each well" });
  b.push({ t: "p", text: `Table ${tab + 1} gives the bottom-hole pressure of each well at the end of its injection period and at the end of the analysis horizon, including interference from the other wells, and the mass of ${fluid} each well has injected by the end of its injection (standard-condition density × injected surface volume); the field has injected ${d.injectedTotal} in total. Table ${tab + 2} lists the zone properties of the controlling well.` });
  b.push(T(`Bottom-hole pressure of each well (${d.pLabel}).`, d.bhpHead, d.bhpRows));
  if (d.zoneRows.length) b.push(T("Zone properties of the pressure model for the controlling well.", d.zoneHead, d.zoneRows, d.zoneNote));
  if (two) {
    b.push({ t: "h2", text: "4.2 CO₂ zones and plume extent" });
    b.push({ t: "p", text: d.satSentence });
    b.push(T(`CO₂ zones of each well at t = ${d.matrixTime}.`, d.satHead, d.satRows));
    b.push(...F(d.figures.sat, `CO₂ saturation map at t = ${d.matrixTime}, showing the plume of each injector.`));
  }
  const s = two ? 3 : 2;
  b.push({ t: "h2", text: `4.${s} Pressure buildup and limit check` });
  b.push({ t: "p", text: `The initial pressure is ${d.limits.p0}. ${d.limits.check}${d.limits.assessed ? `, that is an allowable buildup of ${d.limits.maxBuildup}` : ""}. Table ${tab + 1} gives the peak wellbore buildup of each well, split into the well's own response, skin and interference from the other wells. Pass/fail is judged against the allowable bottom-hole pressure only; the interference threshold of ${d.arrivalThreshold} is not a pass/fail limit and is used solely to define the detection contour, the arrival times and the monitoring-point check.` });
  b.push(T(`Peak wellbore pressure buildup per well (${d.pLabel}) and comparison with the allowable buildup.`, d.peakHead, d.peakRows));
  b.push(...F(d.figures.bhp, `Bottomhole pressure of each well and monitoring point, with the field-maximum and field-average curves and the maximum allowable bottomhole pressure.`));
  b.push({ t: "h2", text: `4.${s + 1} Well-to-well interference` });
  b.push({ t: "p", text: `Table ${tab + 1} gives the pressure that each injector (row) contributes at every well (column) at t = ${d.matrixTime}; the diagonal is each well's own buildup including skin. Table ${tab + 2} gives the time at which a single source well raises the pressure at each target by ${d.arrivalThreshold}.` });
  b.push(T(`Interference matrix at t = ${d.matrixTime} (${d.pLabel}).`, d.matrixHead, d.matrixRows));
  b.push(T(`Arrival time (years) of a pressure rise of ${d.arrivalThreshold} from each source well at each target.`, d.arrivalHead, d.arrivalRows, "A dash indicates the threshold is not reached within the injection period and analysis horizon."));
  if (d.pointCheckRows.length) {
    b.push({ t: "p", text: `Monitoring points are compared with the interference threshold of ${d.arrivalThreshold} (Table ${tab + 1}); this is a detection level, not a pressure limit.` });
    b.push(T(`Monitoring points compared with the interference threshold of ${d.arrivalThreshold}.`, d.pointCheckHead, d.pointCheckRows));
  }
  b.push(...F(d.figures.map, `Pressure buildup map at t = ${d.matrixTime}, with the interference-threshold and allowable-buildup contours.`));
  b.push({ t: "h2", text: `4.${s + 2} Sensitivity to the boundary condition` });
  b.push({ t: "p", text: d.compareSentence });
  b.push(T(`Peak wellbore buildup (${d.pLabel}), skin included, for the three boundary conditions.`, d.compareHead, d.compareRows));
  b.push(...F(d.figures.compare, "Wellbore buildup of the controlling well for the three boundary conditions."));
  b.push({ t: "h2", text: `4.${s + 3} Drivers of the field-maximum pressure` });
  b.push({ t: "p", text: d.driverSentence });
  b.push(T(`Contributions to the field-maximum buildup (${d.pLabel}) at the time of the peak.`, d.driverHead, d.driverRows));
  b.push(...F(d.figures.drivers, "Field-maximum buildup split by source well and skin over time."));

  b.push({ t: "h1", text: "5. Discussion" });
  b.push({ t: "p", text: `${!d.limits.assessed ? "No pressure limit was supplied, so the wells were not assessed against one." : d.kpi.exceeded ? `The analysis indicates that the allowable buildup is exceeded at ${d.kpi.worst}.` : `The analysis indicates that the allowable buildup is not exceeded at any well.`} The pressure model is close to linear in injection rate (the fluid properties depend only weakly on pressure), so scaling all rates by a factor of about ${d.kpi.scale} brings the worst well to the limit; this factor is a first-order guide to the rate reduction (or headroom) available. The comparison of boundary conditions brackets the result: a sealing boundary is the conservative case and a constant-pressure boundary the optimistic one, and the true boundary behaviour of the formation should be established from geological data and pressure monitoring.` });
  if (d.warnings.length) b.push({ t: "p", text: `Input checks raised the following notes: ${d.warnings.join(" ")}` });

  b.push({ t: "h1", text: "6. Assumptions and Limitations" });
  b.push({
    t: "bullets",
    items: [
      "Homogeneous, confined, infinite-acting aquifer of constant thickness, with one permeability and porosity for all zones, constant temperature and viscosities; no leakage through the caprock.",
      two
        ? "The front radii use a representative-pressure approximation (properties at the bottom-hole pressure); this is not a spatially resolved coupled displacement/evaporation model, and the fronts are treated as sharp. The equations have not been fitted to simulation."
        : `The single-phase ${fluid} model uses the slightly-compressible line-source solution with constant fluid properties; it does not model ${d.model === "co2" ? "CO₂ displacing brine" : "any CO₂"}.`,
      "The multiwell section of the model superposes the single-well radial pressure profiles with representative properties at each well's own bottom-hole pressure; with interacting fronts or strongly pressure-dependent properties this is an approximation, and overlapping plumes are flagged rather than resolved. Image wells for a boundary are an addition of this analysis. After shut-in the zones are frozen (fixed-zone falloff).",
      "Wells are evaluated at the wellbore radius with a constant skin factor; wellbore storage, non-Darcy flow, gravity override, dissolution and trapping are not modelled.",
      "A single straight boundary is represented by image wells; multiple faults, heterogeneity and brine production are not modelled.",
      "The results are intended for screening and ranking of well layouts and should be confirmed with numerical reservoir simulation before engineering decisions are made.",
    ],
  });

  b.push({
    t: "refs",
    items: [
      "Buckley, S.E., Leverett, M.C., 1942. Mechanism of fluid displacement in sands. Transactions of the AIME, 146, 107–116.",
      "Earlougher, R.C., Jr., 1977. Advances in Well Test Analysis. SPE Monograph Series, Vol. 5. Society of Petroleum Engineers, Richardson, TX.",
      "Matthews, C.S., Russell, D.G., 1967. Pressure Buildup and Flow Tests in Wells. SPE Monograph Series, Vol. 1. Society of Petroleum Engineers, New York.",
      "Peng, D.-Y., Robinson, D.B., 1976. A new two-constant equation of state. Industrial & Engineering Chemistry Fundamentals, 15(1), 59–64.",
      "Wagner, W., Pruss, A., 1993. International equations for the saturation properties of ordinary water substance. Journal of Physical and Chemical Reference Data, 22(3), 783–787.",
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
