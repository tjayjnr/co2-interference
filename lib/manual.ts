// User manual content. One block list feeds the /manual web page and the PDF / Word downloads.

import type { Block, FigureData } from "./report";

export const SITE_URL = "https://co2-interference.vercel.app";

export type ImgResolver = (name: string) => FigureData | undefined;

export function manualBlocks(img: ImgResolver, date: string): Block[] {
  const b: Block[] = [];
  const fig = (name: string, caption: string) => {
    const f = img(name);
    if (f) b.push({ t: "fig", caption, png: f.png, w: f.w, h: f.h });
  };
  const p = (text: string) => b.push({ t: "p", text });
  const h1 = (text: string) => b.push({ t: "h1", text });
  const h2 = (text: string) => b.push({ t: "h2", text });
  const bullets = (...items: string[]) => b.push({ t: "bullets", items });
  const table = (caption: string, head: string[], rows: string[][], note?: string) => b.push({ t: "table", caption, head, rows, note, textual: true });

  b.push({ t: "title", title: "User Manual: CO₂-SATriPI Tool", subtitle: `Web application at ${SITE_URL}`, date });

  h1("1. Introduction");
  p("The CO₂-SATriPI Tool is a web application for screening-level analysis of several injection wells operating in the same saline aquifer. For a set of wells, rates and reservoir properties it calculates the bottom-hole pressure of every well with an injection-BHP model (two-phase CO₂–brine, single-phase CO₂ or single-phase water), how far the injected CO₂ spreads, how much the formation pressure rises at each well and at monitoring locations, how strongly the wells interfere with one another, and whether the bottom-hole pressure stays below a pressure limit (a maximum allowable BHP or a fraction of the fracture pressure). At the top of the Input section you choose which calculation of the program to run: Single well (the program's single-well calculation) or Multiwell interference (the program's multiwell section, in which every well's BHP includes the pressure from the other wells).");
  p("The application runs in a web browser; nothing needs to be installed and the inputs are not sent to a server. Open the address above on a computer (a QR code that opens the same address can be printed on posters or slides). A large screen is recommended because the inputs are on the left and the results on the right.");
  b.push({ t: "h2", text: "1.1 What the application calculates" });
  bullets(
    "The bottom-hole pressure (BHP) of each well from the injection-BHP model: two-phase CO₂–brine with three zones (dry CO₂, CO₂ + brine, brine) and Peng–Robinson CO₂ properties, single-phase CO₂ or single-phase water, including the pressure falloff after shut-in.",
    "Pressure buildup in the aquifer, from the pressure profiles of all wells added together, with a choice of aquifer boundary condition (infinite, constant-pressure or sealing).",
    "CO₂ fronts (dry zone and gas front), zone 2 saturation and a saturation map around each injector (two-phase model).",
    "The effect of well skin, typed in per well.",
    "Well-to-well interference: how much of each well's buildup is caused by the other wells, and when a pressure effect arrives at each target.",
    "A pass/fail check of every well against the maximum allowable buildup, and a check of monitoring points against an interference threshold.",
    "A side-by-side comparison of the three boundary conditions.",
    "Charts, tables, a results CSV and a publication-style report in PDF or Word format.",
  );
  b.push({ t: "h2", text: "1.2 What it is not" });
  p("The model is analytical and intended for screening and for ranking well layouts. It assumes a homogeneous, confined aquifer with one permeability and porosity for all zones (Section 10). Results should be confirmed with numerical reservoir simulation before engineering decisions are made.");

  h1("2. Quick start");
  p("The page opens with a worked example (four wells 1000 ft apart in a straight line and one monitoring point), so you can try the application immediately.");
  b.push({ t: "bullets", items: [
    "Step 1. Choose the Well system at the top of the Input panel: Single well or Multiwell interference.",
    "Step 2. Check the values in the Input panel. Change anything you like; each number has its own unit selector beside it. The Input panel is a vertical list of tabs (Well system, Model, Reservoir & fluids, Wells, Pressure limit, Shut-in, Monitoring points, Report); click a tab to open its inputs directly under it, and click it again to close it. Inside each tab the inputs are arranged in small labelled groups (for example Pressure limit and Interference, or Observation after injection stops and Observation period).",
    "Step 3. Single well: enter the rate, skin and number of injection years. Multiwell: set the Number of wells and how the distances are given (constant spacing in a line or grid, adjacent distances, a pairwise distance matrix or x/y coordinates), then each well's rate, start and end year, radius, skin, evaporation choice and own maximum BHP in the table.",
    "Step 4. Press ▶ RUN analysis (button at the top of the left panel, or the RUN button in the “No results yet” panel on the right). Nothing is calculated until you do this.",
    "Step 5. Read the status cards: with the example data (two-phase model, 30 years) the peak BHP is 3582.45 psia at Well 2 and Well 3 against an allowable BHP of 4680 psia (0.9 × 5200 psia), so the status is PASS.",
    "Step 6. Click through the result tabs. Multiwell: Multiwell results (the program's own tables, figures and files), CO₂ saturation, Pressure map, Time series, Well BHP, Interference matrix, Limit check and Compare boundaries. Single well: Program results first.",
    "Step 7. Change an input and press RUN again. A yellow banner reminds you whenever the displayed results are older than the inputs.",
    "Step 8. Export what you need: the program's files, chart images (PNG or SVG), the results CSV, or the full report (PDF or Word).",
  ] });

  h1("3. The screen at a glance");
  fig("overview", "Figure 1. The main screen after pressing RUN. The numbered areas are described in Table 1.");
  table("Table 1. Areas of the main screen.", ["No.", "Area", "What it does"], [
    ["1", "RUN analysis", "Starts the calculation with the current inputs. Also shows whether results are up to date."],
    ["2", "Input panel", "One Input section with all inputs, in groups: well system, pressure model and boundary, reservoir and fluids, the injection well (single well) or the number of wells and distances (multiwell), the pressure limit, shut-in observation, monitoring points and report details."],
    ["3", "Export buttons", "Results CSV, Report (PDF) and Report (Word); the User manual link."],
    ["4", "Status cards", "Peak BHP of the worst well (the bar shows how much of the allowable buildup it uses), allowable BHP, the program's pressure status (PASS, FAIL or NOT ASSESSED) and the cumulative CO₂ injected by the field."],
    ["5", "Result tabs", "Multiwell results or Program results, CO₂ saturation (two-phase model), Pressure map, Time series, Well BHP and Interference matrix (multiwell), Limit check, Compare boundaries."],
    ["6", "Chart toolbar", "Zoom in/out, Reset zoom, Export PNG and Export SVG for the chart below it."],
  ]);

  h1("4. Entering the inputs");
  b.push({ t: "h2", text: "4.1 Units" });
  p("Every input that has a unit carries its own unit selector directly beside the value, for example Permeability 50 [mD ▾]. Pick another unit and the number is converted automatically; the calculation is unaffected. The small selector beside the Input heading switches all quantities at once between Field (US oilfield) units, the default, and SI units. Pressures in the results can also be switched with the Pressure unit selector above the charts.");
  p("Time is always in years. CSV import and export always use metres (or longitude and latitude in degrees) and the model's surface rate (Mscf/day of CO₂, or STB/day of water) so that files stay unambiguous.");
  fig("input", "Figure 2. The Input section with a unit selector beside every value.");
  fig("system", "Figure 2a. The Well system choice at the top of the Input section: Single well or Multiwell interference.");

  b.push({ t: "h2", text: "4.2 Reservoir parameters" });
  p("The Reservoir & fluids tab is arranged in four groups: Formation (permeability, porosity, thickness, rock compressibility and, for a single well, the well radius), Initial conditions (pressure and temperature), Brine (water viscosity and standard density; not shown for single-phase CO₂) and Relative permeability (two-phase only).");
  table("Table 2. Reservoir inputs (defaults are those of the reference model). Use site data wherever available.", ["Parameter", "Meaning", "Default"], [
    ["Permeability", "Permeability of the injection formation; the same in all zones.", "50 mD"],
    ["Thickness", "Net thickness of the injection interval.", "20 ft"],
    ["Porosity", "Pore volume fraction; the same in all zones.", "0.20"],
    ["Well radius", "Radius at which each well's own pressure is evaluated.", "0.55 ft"],
    ["Initial pressure (absolute)", "Initial reservoir pressure (absolute, psia in field units).", "3500 psia"],
    ["Temperature", "Constant temperature; used for the Peng–Robinson CO₂ properties, the CO₂ viscosity, the brine density and compressibility and the water vapour pressure. Used by all three models.", "200 °F"],
  ]);

  b.push({ t: "h2", text: "4.2.1 Pressure model and fluid inputs" });
  p("The Model tab has four drop-down lists: Phase / fluid (Two-phase CO₂–brine, Single-phase CO₂ or Single-phase water), Evaporation (Yes or No; two-phase only), CO₂ dissolution (Off or On; two-phase only) and Boundary (Infinite, Sealing fault or Constant pressure). The boundary line and position appear only when a fault or constant-pressure edge is chosen. Only the inputs used by the chosen model are shown.");
  table("Table 2a. The three pressure models.", ["Model", "What it represents"], [
    ["Two-phase CO₂–brine (default)", "Three zones around each well: dry CO₂ next to the well (if evaporation is included), CO₂ + brine, and brine. The gas front follows from the Corey relative permeabilities (any exponents you choose), the dry front from the evaporation of the residual brine, and the zone 2 saturation from the CO₂ mass balance. CO₂ density, compressibility and Bg come from the Peng–Robinson equation of state for pure CO₂ at each well's bottom-hole pressure, converged to 10⁻⁴ psi; the CO₂ viscosity, brine density and water compressibility are recalculated at the same pressure."],
    ["Single-phase CO₂", "A CO₂-filled reservoir with relative permeability 1. Bg is fixed at 0.0005690187 rb/scf; CO₂ density and compressibility are fixed at the initial pressure. The CO₂ viscosity is recalculated at every pressure trial from the live Peng–Robinson density."],
    ["Single-phase water", "A water-filled reservoir with relative permeability 1 and Bw = 1.0 rb/STB. The brine density and water compressibility are calculated at every pressure trial. Rates are in STB/day."],
  ]);
  table("Table 2b. Fluid and rock-fluid inputs.", ["Input", "Used by", "Default"], [
    ["Evaporation", "Two-phase. No sets the dry zone to zero (r_d = r_w).", "Yes"],
    ["CO₂ dissolution", "Two-phase. On keeps CO₂ dissolved at its equilibrium solubility in the zone 2 brine (Spycher et al. 2003 with NaCl salting-out; valid 35–99 °C, 1–600 bar, 0–6 mol NaCl/kg). With C_d = ρ_aq X_CO2,eq it enters the pressure in four places: a slower gas front (tangent from (−a, −a), a = C_d/(ρ_g − C_d)); the zone 2 saturation S_g2 = (M_inj − ρ_g V_p1 − C_d V_p2) / ((ρ_g − C_d) V_p2); an extra zone 2 storage term from dX_eq/dp in c_t2; and less brine pushed into zone 3 (θ < 1 in b_3). Off gives exactly the original calculation.", "Off"],
    ["Water viscosity", "Two-phase, water", "0.30 cP"],
    ["Standard density (60 °F, 1 atm), under Brine", "Two-phase, water. The measured density at standard conditions; the salinity follows from it. Do not enter a reservoir-condition density.", "63.878 lb/ft³"],
    ["Rock compressibility", "All models", "4.2×10⁻⁶ 1/psi"],
    ["Irreducible water saturation Swr", "Two-phase. The maximum CO₂ saturation is 1 − Swr.", "0.55"],
    ["Gas end-point krg0", "Two-phase", "0.65"],
    ["Water end-point krw0", "Two-phase", "1.0"],
    ["Zone 1 gas krg1", "Two-phase (dry-CO₂ zone)", "0.65"],
    ["Gas and water Corey exponents", "Two-phase. Any values greater than 1 and less than 6 (1 < ng < 6, 1 < nw < 6); they need not be equal. Both 3 or both 2 use the exact cubic or quadratic front; any other pair finds the same Welge tangent numerically.", "3 and 3"],
      ], "If an input is outside its allowed range (for example porosity not between 0 and 1, or a Corey exponent not between 1 and 6) a red message appears under the RUN button and the calculation stops with the same message.");

  b.push({ t: "h2", text: "4.2.2 Post-shut-in observation" });
  p("As in the program, the Input section asks: Include pressure observation after injection stops? Choose Yes and enter the Observation duration (years) and the Observation years to report (for example 0, 0.5, 1, 5, 10; leave blank for every whole year and the end of the period), or choose No. Observation starts when the last well stops (the latest End year; single well: after its injection years); the pressure then falls by zero-flow radial diffusion of each well's final pressure profile with the zone radii, mobilities and storage frozen at shut-in, and in the multiwell calculation the wells' falloffs are added at every well. Year 0 is the instant injection stops, with the flowing skin drop removed. The results run from year 0 to the last End year plus the observation duration; the evaluation-time slider covers the same period.");

  b.push({ t: "h2", text: "4.3 Pressure limit" });
  p("The group asks, as the program does: Will the required pressure exceed a limit? Choose the pressure assessment: Not assessed (no limit; every well is reported NOT ASSESSED), Maximum allowable BHP (an absolute pressure), or Fraction of fracture pressure (an absolute fracture pressure and an allowable fraction, 0.9 by default; this is your choice, not a regulatory rule). In the multiwell table a well can also have its own Max BHP, which replaces the shared limit for that well. The check compares the required BHP with the allowable BHP at every computed time: FAIL means the required BHP exceeds it at a computed time. Rates are not reduced automatically, and this is an operating-pressure check, not a prediction of mechanical well integrity.");
  table("Table 4. Pressure-limit inputs.", ["Input", "Meaning", "Default"], [
    ["Pressure assessment", "Not assessed, Maximum allowable BHP, or Fraction of fracture pressure.", "Fraction of fracture pressure"],
    ["Maximum allowable BHP", "Absolute bottom-hole pressure that must not be exceeded.", "4680 psia"],
    ["Fracture pressure, Allowable fraction", "Allowable BHP = fraction × fracture pressure (absolute).", "5200 psia, 0.9 (4680 psia)"],
    ["Interference threshold", "Detection level for the map contour, the arrival times and the monitoring points; not a pass/fail limit.", "1 psi"],
  ]);
  p("Four properties are not inputs: the program calculates them in the background at every pressure trial, at each well's own bottom-hole pressure, and again in every cell of the shut-in solve. The result tables and CSV files report them at every time.");
  table("Table 2c. Properties calculated in the background (not inputs).", ["Property", "How it is calculated", "Used by"], [
    ["CO₂ viscosity", "Fenghour, Wakeham and Vesovic (1998) correlation from the reservoir temperature and the live Peng–Robinson CO₂ density at the pressure (no near-critical enhancement; near-critical states are rejected).", "Two-phase, CO₂"],
    ["Salinity (NaCl equivalent)", "Positive root of the McCain standard-density relation ρ_sc = 62.368 + 0.438603 S + 0.00160074 S² (S in weight percent), from the brine density at 60 °F and 14.696 psia. Salt mass and mole fractions do not change with pressure; the salt concentration in kg/m³ does.", "Two-phase, water"],
    ["Brine density", "Driesner (2007) liquid molar-volume mapping with the IAPWS-IF97 Region 1 liquid-water density, at the pressure, temperature and salt mass fraction (0.1–100 MPa, salt mass fraction 0–0.26).", "Two-phase, water"],
    ["Water compressibility c_w", "c_w = (1/ρ)(dρ/dP) at fixed temperature and salt mass fraction, from the brine density by central differences.", "Two-phase, water"],
  ]);

  b.push({ t: "h2", text: "4.4 Interference threshold" });
  p("The interference threshold (in the Pressure limit group) is the smallest pressure change you regard as detectable. It defines the dashed contour on the pressure map, the arrival times on the Interference matrix tab and the monitoring-point check on the Limit check tab. It is not a pass/fail limit.");

  b.push({ t: "h2", text: "4.5 Well skin" });
  p("Skin describes extra pressure loss (positive skin, formation damage) or gain (negative skin, stimulation) near a well. Type each well's skin factor in the Skin column of the wells table; a blank cell means zero skin. The skin pressure drop, 141.2·μ·q·B·s/(k·h), is added at the injector itself while it injects; it does not change the pressure felt at other wells.");
  fig("skinbound", "Figure 3. The Pressure model and boundary group and the Pressure limit group of the Input section.");

  b.push({ t: "h2", text: "4.6 Boundary condition" });
  p("The boundary is set in the first group of the Input section, together with the pressure model. Choose how the aquifer behaves at a straight outer boundary:");
  bullets(
    "Infinite: the aquifer extends indefinitely; pressure spreads without meeting an edge.",
    "Sealing fault (no-flow): a barrier that reflects the pressure; buildup is higher than in the infinite case.",
    "Constant pressure: an open edge that holds the pressure; buildup is lower than in the infinite case.",
  );
  p("For the two bounded cases give the boundary as a line, x = constant or y = constant (or longitude or latitude when real-world coordinates are used), and its position. All wells and monitoring points must lie on the same side. The Compare boundaries tab always shows all three cases side by side using the line you entered here. The program itself is infinite-acting: a boundary is applied with image wells in the maps, curves, matrix and comparison, while the Multiwell results and Program results tabs stay the program's infinite-acting outputs.");

  b.push({ t: "h2", text: "4.7 Injection wells" });
  p("Single well: enter the surface injection rate, the skin factor and the number of whole injection years. The well sits at the centre of the maps (x = y = 0) and injects at a constant rate from year 0, exactly as the program's single-well calculation; the well radius is in the Reservoir and fluids group.");
  fig("single", "Figure 3a. The Injection well group of the Single well system.");
  p("Multiwell interference: the inputs follow the program's multiwell form. Number of wells (2 to 32) sets the rows of the table; raising it adds wells named Well k with the default rate, start year 0, radius 0.55 ft and skin 0, and lowering it removes wells from the end. Distances: Constant neighboring spacing places the wells in a Straight line or a Square grid with the given spacing between neighbours (all other separations, including grid diagonals, follow from the layout); Different distances lets you give the Adjacent distances along a line (Well 1–2, Well 2–3, …), the Full pairwise distance matrix (numeric CSV, one row per well, zero diagonal; it must describe a realizable horizontal 2-D layout) or Custom x/y coordinates typed in the table (or longitude/latitude, Section 4.8). Distances are typed in the distance unit chosen in the panel. The Well separation distances table below the well table shows the actual distances, and the x and y columns show the positions calculated from the distances. Well radius: choose Same for all wells and enter one value, or Different for each well and enter each well's radius in the Radius column of the table (it starts at the common value). Reporting times are the project years of the program's tables (blank = every whole year and the endpoint).");
  fig("wells", "Figure 4. The Number of wells and distances group (multiwell).");
  table("Table 5. Columns of the multiwell table.", ["Column", "Meaning"], [
    ["Name", "Label shown on charts, tables, files and reports. It updates everywhere at once, without a new RUN."],
    ["x, y (or Lon, Lat)", "Well location: calculated from the distances, or typed in with Custom x/y coordinates."],
    ["Rate", "Surface injection rate: Mscf/day of CO₂ (150 means 150,000 scf/day), or STB/day of water for the water model. 0 makes a passive observation well."],
    ["Start (yr)", "Project year in which the well starts injecting."],
    ["End (yr)", "Project year in which the well stops injecting. The latest End year is the project endpoint of the program, after which the observation starts. A single-phase well's end is a rate change to 0 (the program's rate schedule). A two-phase well that stops before the last one follows the program's fixed-zone falloff from its End year while the others continue; this is an extension, because the program itself stops all wells together. With equal End years the results are exactly the program's."],
    ["Radius", "Shown when Well radius is Different for each well: the radius of this well."],
    ["Skin", "Skin factor of the well; blank means 0 (Section 4.5)."],
    ["Evaporation", "Two-phase model: inherit (the setting of the Pressure model group), on or off for this well."],
    ["Max BHP", "This well's own maximum allowable BHP; blank uses the shared pressure limit."],
    ["＋", "Single-phase models: adds a rate change (Section 4.7.1)."],
    ["×", "Removes the well."],
  ]);
  p("Import CSV loads a table of wells from a file (the positions are then used as Custom x/y coordinates) and Export saves the current table (Section 9).");

  b.push({ t: "h2", text: "4.7.1 Rate changes (variable injection rate)" });
  p("In the single-phase models (CO₂ or water) a well can inject at more than one rate, as the program's rate schedule allows. Click ＋ at the end of a well's row to add a rate change: the year from which the new rate applies and the new rate (0 stops the well). The changes are added by superposition in time of the constant-property line-source solution. The two-phase model accepts one constant rate per well from its start year: the program does not treat rate changes of moving fronts as reset plumes, so ＋ is not offered there.");

  b.push({ t: "h2", text: "4.8 Real-world coordinates (longitude and latitude)" });
  p("If your wells are known as longitude and latitude, set Location input to “Longitude / latitude (real-world)”. The x and y columns are replaced by Lon (°) and Lat (°); the same applies to the monitoring points. Enter WGS84 decimal degrees, with east and north positive.");
  bullets(
    "When you first switch, the existing wells are converted to example coordinates near Houston. Replace them with your own.",
    "The application converts the coordinates to metres with an azimuthal equidistant projection centred on the centroid of all your locations. Over a field up to about 100 km across the distance error is far below 0.5 %.",
    "The boundary line is then entered as a longitude (north–south line) or a latitude (east–west line).",
    "Maps are labelled with longitude and latitude, and the report states the projection used.",
    "Latitude must lie between −90° and 90° and longitude between −180° and 180°; otherwise an error message appears.",
  );
  fig("wells-geo", "Figure 5. The wells table in longitude / latitude mode.");

  b.push({ t: "h2", text: "4.9 Monitoring points" });
  p("Monitoring points are locations where nothing is injected but pressure is of interest, for example a legacy well, a fault or the edge of a permit area. Each point appears on the maps, as a dashed curve in the time series, as a target in the arrival-time table and in the monitoring-point check on the Limit check tab. Use + Add point to add more.");

  b.push({ t: "h2", text: "4.10 Report details" });
  p("Project name and Author are optional and are printed on the title block of the PDF and Word reports.");

  h1("5. Running the analysis");
  bullets(
    "Press ▶ RUN analysis. The inputs at that moment are used for all results, tables, figures and reports.",
    "If you change any input afterwards, the status text next to the button and a yellow banner above the results say that the inputs have changed; press RUN again to refresh.",
    "The Evaluation time slider, the Pressure unit selector, Map area, Map padding and the tabs do not require a new RUN, because they only change what is displayed. The Evaluation time slider is shown on the CO₂ saturation and Pressure map tabs only; the Interference matrix uses the time last chosen there. The ▶ Play button beside it plays the time forward to the end of the results so the maps and charts animate (the CO₂ plumes grow and the pressure spreads); press ❚❚ to pause, or move the slider to stop and pick a time. Pressing Play at the end starts again from the beginning.",
    "Warnings appear above the results when something is inconsistent, for example a well that lies on the boundary, wells on both sides of the boundary, two wells at the same location, a well whose end year is not after its start year, or a pressure limit that is below the initial pressure.",
  );

  h1("6. Reading the results");
  b.push({ t: "h2", text: "6.1 Status cards" });
  p("Three cards sit above the tabs. Peak BHP is the highest required bottom-hole pressure of any well at the program's computed times (injection and observation) and names the well and the year. Allowable BHP shows the limit that is being applied. Pressure status is the program's overall result: PASS, FAIL or NOT ASSESSED, and the card says by what factor all injection rates could be scaled before the worst well reaches the limit. Cumulative CO₂ injected (field) (water for the water model) is the total mass injected by all wells by the end of injection, in million tonnes (Mt) with the tonnes, pounds and surface volume below it; it is the program's standard-condition density (rho_sc_lb_scf, or water_mass_per_stb_lb) times the injected surface volume. The Multiwell results tab (Program results for a single well) lists the same for every well with the Field total. The model is close to linear in rate (the CO₂ properties depend weakly on pressure), so the factor is a close guide rather than exact.");

  b.push({ t: "h2", text: "6.2 CO₂ saturation tab" });
  fig("sat", "Figure 6. CO₂ saturation map with the plume of each injector and the table of CO₂ zones.");
  p("The map shows the saturation of injected CO₂ (Sg) at the evaluation time, with a labelled colour scale from 0 up to the maximum saturation. Each injector creates a roughly circular plume; the well is drawn as a thin vertical line that starts at the plume centre and points upward, with its name centred on top of the line (click a name in the table below the map to rename it); the plume edge is where the colour returns to the dark-blue brine background. Each plume is coloured from the highest saturation next to its well, falling outward to its front; where plumes of neighbouring wells overlap, the higher of their saturations is shown, so every well keeps its own plume. The tab is shown for the two-phase model only. The map places the radial Buckley–Leverett profile around each well for the reservoir volume of CO₂ it has injected (surface volume × Bg at its bottom-hole pressure). Below the map, a table lists for each well the mass injected so far, the gas front r_g and the dry front r_d from the pressure model, the zone 2 (CO₂ + brine) saturation, the saturation at the front and the maximum saturation. Drag the Evaluation time slider to watch the plumes grow; each plume stops growing when its well is shut in.");

  b.push({ t: "h2", text: "6.3 Pressure map tab" });
  p("The CO₂ saturation map is fitted to the wells: Map area Around the wells shows the wells with automatic padding large enough for the largest CO₂ plume and at least most of a well spacing around them, so every well stands apart even in a square grid; Wells and monitoring points also includes the monitoring points. The pressure map shows the wells spread over the map with about two well spacings around them, so every well is clearly seen. The aquifer is infinite-acting, so the pressure never ends at an edge; the colour scale of the pressure map therefore starts at the highest buildup on the map edge, so the edge takes the lightest colour and the pressure is seen spreading out from the wells and fading out inside the map. Only the display changes, not the calculation; the colour bar gives the true values. Type a Map padding to set your own margin for both maps, and Auto padding returns to the automatic ones. Each well is a vertical line pointing up from its position with its name on top; the line is shortened when another well sits just above it, and a name that would cover another well moves beside or below its line. When wells are so close that a full name does not fit, only the well number is shown (zoom in to see every name).");
  fig("pressure-map", "Figure 7. Pressure buildup map with the interference-threshold and allowable-buildup contours.");
  p("The map shows the total pressure buildup caused by all wells at the evaluation time, with a labelled colour scale. The scale runs from the buildup on the map edge (rounded up) to the highest and gives more of its colours to the higher pressures, so the pressure of each well is seen spreading out from the well and highest at the well: the darkest colours sit at the wells, and wells between other wells are darker because they also feel their interference. The colour bar shows the true values. The dashed teal contour is the interference threshold (detection only). The solid white-and-black contour is the max allowable buildup (the pass/fail limit); it appears only near wells that approach the limit. Each well is drawn as a thin vertical line with its name on top, as on the saturation map. Use Map padding to enlarge or shrink the area drawn around the wells.");
  p("Above the pressure map, the style bar controls how the map is coloured and annotated. The choices apply to the picture, to the PNG and SVG exports and to the report figure.");
  table("Table 5a. Map style options (pressure map).", ["Option", "What it does"], [
    ["Colour scale", "Sunset (default), Jet, Turbo, Viridis, Plasma, Blues, Cool–warm (diverging) or Greyscale. The colour bar and its numbers follow the choice."],
    ["Fill", "Smooth colours, Colour bands (the pressure is grouped into the chosen number of classes with a stepped colour bar) or No fill (white map). No fill together with Contour lines gives a classic contour plot in which every line is coloured by its pressure value and the colour bar is marked at the contour levels."],
    ["Reverse colours", "Flips the colour scale so that high pressure takes the colour of low pressure and vice versa."],
    ["Contour lines", "Draws iso-pressure lines at round values (5, 8, 10, 15, 20, 30 or 40 levels) with the value written on each line. Contours of: Each well separately (default) draws, around every well, the lines of the pressure change caused by that well alone, so you see how the pressure of each well propagates; Total field draws the lines of the summed field. The lines stay within the chosen Contour reach of the well (Close to the wells, Around the wells, Wide, Half the map or Whole map). The levels are common to all wells and span the pressures found inside the reach, and the colour bar is marked and labelled at the same levels, so the legend and the lines always agree. Labels turns the numbers off."],
    ["Streamlines", "Draws the flow paths of the brine (down the pressure gradient, away from the injectors), with an arrow showing the direction. They bend around the wells and are pushed away from a sealing boundary."],
    ["Reset style", "Returns to the default colours."],
  ]);
  fig("mapstyle", "Figure 7a. The pressure map with the Viridis scale, colour bands, contour lines and streamlines.");
  fig("mapcontour", "Figure 7b. A contour plot (No fill, Jet scale, 15 levels): the lines around each well show how the pressure of that well alone propagates, coloured by pressure value.");

  b.push({ t: "h2", text: "6.4 Time series tab" });
  fig("time-series", "Figure 8. Time series of pressure at every well and monitoring point, with the field maximum and average.");
  p("The Show selector chooses what is plotted: total buildup (ΔP) at each wellbore including skin; bottomhole pressure (initial pressure plus buildup), with the maximum allowable bottomhole pressure; or interference only, which removes each well's own contribution so that only the effect of the other wells remains. Dashed lines are monitoring points. The black line is the field maximum (the highest pressure of any well at each time) and the grey dash-dot line is the field average.");
  p("Under the chart, the section “What drives the field maximum” stacks the contributions of each injector and of skin at the well that has the highest pressure at each time, and a table gives the breakdown at the moment of the field peak.");

  b.push({ t: "h2", text: "6.0 Multiwell results and Program results tabs" });
  p("Multiwell results (multiwell interference) shows the program's multiwell outputs, with its two figures first (BHP and interference of every well over time; the final contribution matrix and the radial front estimates), then the BHP of every well when the last well stops, split into its own formation response, its skin and the interference from the other wells, with its limit status and pressure margin; the peak pressure assessment of every well; the well separation distances; the readings after all wells stop, and every file of the program: multiwell_summary.csv, interference_contributions.csv, source_states.csv, multiwell_time_detail.csv, plume_overlap.csv, final_interference_matrix.csv, evaluation_distances_ft.csv, well_separations_ft.csv, pressure_limit_summary.csv, multiwell_inputs_used.json, multiwell_observation.csv, observation_contributions.csv and the two PNG figures. These results are infinite-acting, as the program; a boundary chosen in the Input section is applied only in the maps and curves.");
  fig("mwresults", "Figure 5a. The Multiwell results tab: the program's endpoint table, peak pressure assessment and well separations.");
  p("Program results (single well) shows the program's single-well outputs: the end-of-injection BHP, the post-shut-in observation table, the BHP plot, the annual results with the pressure status, the pressure assessment and the files annual_summary.csv, all_calculations.csv, first_year_detail.csv, observation_summary.csv, pressure_limit_summary.csv, inputs_used.json and bhp_vs_year.png.");
  fig("program", "Figure 5b. The Program results tab of the Single well system.");

  b.push({ t: "h2", text: "6.4a Well BHP tab" });
  p("Choose a well in the Well selector. The chart shows its bottom-hole pressure over the whole results period, with the interference from the other wells, and the same well alone (the program for one well), followed by the program’s own BHP plot for that well. Below the charts, the reference program is run for that well on its own, unchanged (its rate, radius, skin, evaporation choice and own maximum BHP, from its start year to its end year in whole years, and the post-shut-in observation entered in the Input section): the end-of-injection BHP, the post-shut-in observation table, its annual results table, and its files annual_summary.csv, all_calculations.csv (every intermediate value, including the zone diffusivity ratios D1, D2, D3), first_year_detail.csv, observation_summary.csv, inputs_used.json and bhp_vs_year.png.");

  b.push({ t: "h2", text: "6.5 Interference matrix tab" });
  fig("matrix", "Figure 9. Interference matrix and arrival-time table.");
  p("The first table has one row per injecting well and one column per receiving well. Each cell is the pressure that the row well contributes at the column well at the evaluation time; the diagonal cells are each well's own buildup including skin. The last column gives the total felt at other wells, and the last row the total at each receiver. The second table gives the first time (years) that a single source well alone raises the pressure at each target (wells and monitoring points) by the interference threshold; a dash means it does not happen during the injection period.");

  b.push({ t: "h2", text: "6.6 Limit check tab" });
  fig("limits", "Figure 10. Limit check for each well and the monitoring-point table.");
  p("Each well is listed with the program's pressure assessment (pressure_limit_summary.csv): its status, peak BHP and the year of the peak, in the multiwell calculation how that peak splits into the well's own formation response, skin and interference, the allowable BHP, the minimum margin and the first computed time at which the limit is exceeded. Below, the monitoring-point table shows the peak buildup at each monitoring point and whether, and when, it first reaches the interference threshold.");

  b.push({ t: "h2", text: "6.7 Compare boundaries tab" });
  fig("compare", "Figure 11. Wellbore buildup of one well for the three boundary conditions.");
  p("The chart plots the buildup of the well you select for an infinite aquifer, a constant-pressure boundary and a no-flow boundary, together with the allowable buildup. The table gives the peak buildup of every well for each case; red cells exceed the limit. The no-flow case is the most conservative and the constant-pressure case the least.");

  h1("7. Working with the charts");
  p("Every chart has a title, a legend and a toolbar.");
  fig("zoom", "Figure 12. A zoomed region of a map. Zoom controls are above the chart.");
  table("Table 6. Chart controls.", ["Action", "How"], [
    ["Zoom into a region", "Drag a box on the plot. On maps the box is made square so the scale stays true."],
    ["Zoom about a point", "Hold Ctrl (⌘ on a Mac) and scroll the mouse wheel, or pinch on a trackpad."],
    ["Zoom in or out in steps", "Use the ＋ and − buttons."],
    ["Return to the full view", "Click Reset zoom or double-click the chart. Zoom also resets after a new RUN."],
    ["Save the chart as an image", "Click Export PNG (raster) or Export SVG (vector). The image has a white background, a title and a legend, and shows the region currently displayed."],
  ]);

  h1("8. Exports");
  b.push({ t: "h2", text: "8.1 Results CSV" });
  p("Export results CSV saves the interference matrix at the evaluation time, the time series that is currently shown, and the peak check of every well, in the selected pressure unit.");
  b.push({ t: "h2", text: "8.2 Report (PDF and Word)" });
  p("Report (PDF) and Report (Word) generate a publication-style document: title block, abstract, introduction, methodology with numbered equations of the selected pressure model, input tables, results with captioned figures and tables (bottom-hole pressure, zone properties, CO₂ zones and saturation, pressure, interference, boundary sensitivity, field-maximum drivers), a discussion written from your numbers, limitations and references. The report reflects the inputs of the last run and the units and evaluation time currently selected. The Word version can be edited; the PDF is ready to share.");

  h1("9. File formats");
  p("The wells table can be saved with Export and loaded again with Import CSV. Excel files should be saved as CSV first. Columns are separated by commas, semicolons or tabs, and the header row is optional.");
  table("Table 7. Wells CSV columns.", ["Mode", "Columns (in order)"], [
    ["Local coordinates", "name, x_m, y_m, rate, start_yr, end_yr, skin (optional), changes (optional)"],
    ["Longitude / latitude", "name, lon_deg, lat_deg, rate, start_yr, end_yr, skin (optional), changes (optional)"],
  ], "The rate is in Mscf/day of CO₂ (or STB/day of water for the water model). An empty skin means zero skin. The optional changes column lists rate changes as year:rate pairs separated by | , for example 8:100|15:50 (the rate becomes 100 Mscf/day from year 8 and 50 Mscf/day from year 15). A header whose second column contains “lon” switches the application to longitude / latitude mode on import.");
  p("Example (local coordinates):  INJ-1,0,0,150,0,25,   (skin left empty)   and   INJ-2,4000,1000,150,2,25,4.5");

  h1("10. Model summary and limitations");
  p("Each well follows the injection-BHP model supplied for this application (the Python reference model in the repository, translated line by line and tested against it): two-phase CO₂–brine with three zones, single-phase CO₂ or single-phase water, with the pressure-dependent properties converged at the bottom-hole pressure. The pressure profile of every well is added to give the pressure anywhere in the aquifer, a straight boundary is modelled with image wells, and the wellbore pressure adds the skin term. After shut-in each well follows the fixed-zone falloff of the model. The report contains the equations.");
  bullets(
    "Homogeneous, confined, infinite-acting aquifer of constant thickness, with one permeability and porosity for all zones, constant temperature and constant viscosities; no leakage through the caprock.",
    "The two-phase front radii use a representative-pressure approximation (properties at the bottom-hole pressure); this is not a spatially resolved displacement/evaporation model, and the fronts are sharp. The equations have not been fitted to simulation.",
    "The reference model is for one well at a constant rate. Adding the profiles of several wells, rate changes and image wells is an extension; it is exact for one well at constant rate and an approximation when fronts interact or properties depend strongly on pressure.",
    "The CO₂ saturation map neglects gravity override, dissolution, capillary pressure and residual trapping, and does not feel the aquifer boundary.",
    "Skin is a constant factor applied only at the injector while it injects.",
    "Only one straight boundary can be modelled. Multiple faults, heterogeneity, brine production and geomechanical effects are not included.",
    "Results are for screening and ranking; confirm with numerical simulation before making decisions.",
  );

  h1("11. Troubleshooting");
  table("Table 8. Common questions.", ["Problem", "Likely cause", "What to do"], [
    ["“No results yet”", "The analysis has not been run.", "Press ▶ RUN analysis."],
    ["Results do not change when I edit an input", "Results update only on RUN.", "Press RUN; watch for the yellow banner."],
    ["Warning: wells on both sides of the boundary", "The boundary line passes between wells or points.", "Move the boundary so that all locations are on one side."],
    ["The allowable BHP is at or below the initial pressure", "The maximum BHP, or the fraction × fracture pressure, is below the initial pressure.", "Check the initial pressure and the pressure-limit inputs."],
    ["“These pairwise distances cannot form a horizontal 2-D well layout”", "The distance matrix is not a set of distances between points on a plane.", "Check the matrix, or enter x/y coordinates instead."],
    ["“Calculation stopped”", "An input is out of range, or an intermediate result broke a model check (for example the zone 2 saturation above 1 − Swr).", "Read the message, change the input it names, and press RUN again."],
    ["Wells import fails", "A row has fewer than six columns or a non-numeric value.", "Check the column order in Section 9; the message names the row."],
    ["Longitude / latitude error", "Latitude is outside ±90° or longitude outside ±180°.", "Correct the values; check that longitude and latitude are not swapped."],
    ["The plume looks small", "Only injected mass inside the front is shown; there is no gravity override. The example rates are small (150 Mscf/day).", "Check the rates, porosity, thickness and relative-permeability inputs."],
    ["A chart is too small to read", "The browser window is narrow.", "Widen the window or use the zoom controls."],
    ["Exports do nothing", "The browser blocked the download.", "Allow downloads for the site and try again."],
  ]);

  h1("12. Glossary");
  table("Table 9. Terms used in the application.", ["Term", "Meaning"], [
    ["Buildup", "Rise of the formation pressure above its initial value because of injection."],
    ["Bottomhole pressure (BHP)", "Pressure at the well in the injection interval: initial pressure plus buildup."],
    ["Interference", "Pressure rise at a well that is caused by other wells."],
    ["Skin", "Dimensionless factor for near-well damage (positive) or stimulation (negative)."],
    ["Plume", "The region occupied by injected CO₂."],
    ["Sg", "CO₂ saturation: the fraction of the pore volume filled with CO₂."],
    ["Allowable BHP", "Maximum allowable BHP, or the allowable fraction × the fracture pressure; the pass/fail limit for wells."],
    ["Interference threshold", "Small pressure rise used to detect where and when a well's influence arrives; not a pass/fail limit."],
    ["Image well", "A mirrored well used to represent a straight boundary."],
    ["Shut-in", "End of injection at a well (its End year); its pressure then falls."],
    ["Bg", "Gas formation volume factor: reservoir barrels per standard cubic foot of CO₂."],
    ["Mscf/day", "Thousand standard cubic feet per day (standard conditions 14.696 psia, 60 °F)."],
  ]);

  h1("Appendix A. Default example data");
  b.push({ t: "table", caption: "Table 10. Wells in the built-in example (multiwell interference).", head: ["Well", "x (ft)", "y (ft)", "Rate (Mscf/day)", "Start (yr)", "Radius (ft)", "Skin"], rows: [
    ["Well 1", "0", "0", "150", "0", "0.55", "0"],
    ["Well 2", "1000", "0", "150", "0", "0.55", "0"],
    ["Well 3", "2000", "0", "150", "0", "0.55", "0"],
    ["Well 4", "3000", "0", "150", "0", "0.55", "0"],
  ], note: "Constant neighboring spacing of 1000 ft in a straight line; every well injects from year 0 to year 30; observation for 10 years after shut-in (0, 0.5, 1, 5, 10). Monitoring point “Legacy well” at x = 2500 m, y = −1500 m. Reservoir and fluids: the defaults of the reference program (Table 2, Table 2b). Pressure limit: 0.9 × a fracture pressure of 5200 psia." });

  b.push({
    t: "refs",
    items: [
      "Buckley, S.E., Leverett, M.C., 1942. Mechanism of fluid displacement in sands. Transactions of the AIME, 146, 107–116.",
      "Driesner, T., 2007. The system H₂O–NaCl. Part II: Correlations for molar volume, enthalpy, and isobaric heat capacity from 0 to 1000 °C, 1 to 5000 bar, and 0 to 1 X_NaCl. Geochimica et Cosmochimica Acta, 71(20), 4902–4919.",
      "Earlougher, R.C., Jr., 1977. Advances in Well Test Analysis. SPE Monograph Series, Vol. 5. Society of Petroleum Engineers, Richardson, TX.",
      "Fenghour, A., Wakeham, W.A., Vesovic, V., 1998. The viscosity of carbon dioxide. Journal of Physical and Chemical Reference Data, 27(1), 31–44.",
      "IAPWS, 2012. Revised Release on the IAPWS Industrial Formulation 1997 for the Thermodynamic Properties of Water and Steam (R7-97(2012)). International Association for the Properties of Water and Steam.",
      "Matthews, C.S., Russell, D.G., 1967. Pressure Buildup and Flow Tests in Wells. SPE Monograph Series, Vol. 1. Society of Petroleum Engineers, New York.",
      "McCain, W.D., Jr., 1990. The Properties of Petroleum Fluids, 2nd ed. PennWell Books, Tulsa, OK.",
      "Peng, D.-Y., Robinson, D.B., 1976. A new two-constant equation of state. Industrial & Engineering Chemistry Fundamentals, 15(1), 59–64.",
      "Welge, H.J., 1952. A simplified method for computing oil recovery by gas or water drive. Transactions of the AIME, 195, 91–98.",
    ],
  });
  return b;
}
