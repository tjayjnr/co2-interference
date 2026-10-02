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

  b.push({ t: "title", title: "User Manual: CO₂ Injection Pressure Interference and Saturation Analyzer", subtitle: `Web application at ${SITE_URL}`, date });

  h1("1. Introduction");
  p("The CO₂ Injection Pressure Interference and Saturation Analyzer is a web application for screening-level analysis of several CO₂ injection wells operating in the same saline aquifer. For a set of wells, rates and aquifer properties it calculates how far the injected CO₂ spreads, how much the formation pressure rises at each well and at monitoring locations, how strongly the wells interfere with one another, and whether the pressure stays below a limit derived from the fracture gradient.");
  p("The application runs in a web browser; nothing needs to be installed and the inputs are not sent to a server. Open the address above on a computer (a QR code that opens the same address can be printed on posters or slides). A large screen is recommended because the inputs are on the left and the results on the right.");
  b.push({ t: "h2", text: "1.1 What the application calculates" });
  bullets(
    "CO₂ saturation and plume extent around each injector (radial Buckley–Leverett front).",
    "Pressure buildup in the aquifer, from the Theis solution superposed over all wells, with a choice of aquifer boundary condition (infinite, constant-pressure or sealing).",
    "The effect of well skin, which can be typed in per well or calculated from a damaged zone.",
    "Well-to-well interference: how much of each well's buildup is caused by the other wells, and when a pressure effect arrives at each target.",
    "A pass/fail check of every well against the maximum allowable buildup, and a check of monitoring points against an interference threshold.",
    "A side-by-side comparison of the three boundary conditions.",
    "Charts, tables, a results CSV and a publication-style report in PDF or Word format.",
  );
  b.push({ t: "h2", text: "1.2 What it is not" });
  p("The model is analytical and intended for screening and for ranking well layouts. It assumes a homogeneous, confined aquifer and brine-equivalent flow (Section 10). Results should be confirmed with numerical reservoir simulation before engineering decisions are made.");

  h1("2. Quick start");
  p("The page opens with a worked example (four injectors and one monitoring point), so you can try the application immediately.");
  b.push({ t: "bullets", items: [
    "Step 1. Check the values in the Input panel on the left. Change anything you like; each number has its own unit selector beside it.",
    "Step 2. Check the injection wells table: location, injection rate in Mt of CO₂ per year, start and end year of injection, and skin (leave blank to calculate it).",
    "Step 3. Press ▶ RUN analysis (green-blue button at the top of the left panel, or the link in the “No results yet” message). Nothing is calculated until you do this.",
    "Step 4. Read the status card: with the example data the peak buildup is about 10.05 MPa against an allowable 8.70 MPa, so it reports “Limit exceeded”.",
    "Step 5. Click through the result tabs: CO₂ saturation, Pressure map, Time series, Interference matrix, Limit check and Compare boundaries.",
    "Step 6. Change an input and press RUN again. A yellow banner reminds you whenever the displayed results are older than the inputs.",
    "Step 7. Export what you need: chart images (PNG or SVG), the results CSV, or the full report (PDF or Word).",
  ] });

  h1("3. The screen at a glance");
  fig("overview", "Figure 1. The main screen after pressing RUN. The numbered areas are described in Table 1.");
  table("Table 1. Areas of the main screen.", ["No.", "Area", "What it does"], [
    ["1", "RUN analysis", "Starts the calculation with the current inputs. Also shows whether results are up to date."],
    ["2", "Input panel", "All inputs: aquifer, pressure limit, CO₂ saturation, skin, boundary, wells, monitoring points and report details."],
    ["3", "Export buttons", "Results CSV, Report (PDF) and Report (Word); the User manual link."],
    ["4", "Status cards", "Peak buildup, allowable buildup and the pass/fail status against the max allowable buildup."],
    ["5", "Result tabs", "CO₂ saturation, Pressure map, Time series, Interference matrix, Limit check, Compare boundaries."],
    ["6", "Chart toolbar", "Zoom in/out, Reset zoom, Export PNG and Export SVG for the chart below it."],
  ]);

  h1("4. Entering the inputs");
  b.push({ t: "h2", text: "4.1 Units" });
  p("Every input that has a unit carries its own unit selector directly beside the value, for example Permeability 150 [mD ▾]. Pick another unit and the number is converted automatically; the calculation is unaffected. The small selector beside the Input heading switches all quantities at once between SI units and Field (US oilfield) units. Pressures in the results can also be switched with the Pressure unit selector above the charts.");
  p("Time is always in years. CSV import and export always use metres and Mt/yr (or longitude and latitude in degrees) so that files stay unambiguous.");
  fig("input", "Figure 2. The Input section with a unit selector beside every value.");

  b.push({ t: "h2", text: "4.2 Aquifer and fluid parameters" });
  table("Table 2. Input parameters. Typical ranges are only a guide; use site data wherever available.", ["Parameter", "Meaning", "Typical range"], [
    ["Permeability", "Horizontal permeability of the injection formation.", "10 to 1000 mD"],
    ["Thickness", "Net thickness of the injection interval.", "10 to 200 m"],
    ["Porosity", "Pore volume fraction.", "0.10 to 0.30"],
    ["Total compressibility", "Combined rock and brine compressibility; controls how fast pressure spreads.", "2×10⁻⁴ to 10⁻³ 1/MPa"],
    ["Brine viscosity", "Viscosity of the formation brine at reservoir conditions.", "0.3 to 1 mPa·s"],
    ["CO₂ density", "Density of CO₂ at reservoir pressure and temperature; converts injected mass into reservoir volume.", "400 to 800 kg/m³"],
    ["Wellbore radius", "Radius at which each well's own pressure is evaluated.", "0.07 to 0.15 m"],
    ["Depth", "Mid-depth of the injection interval; sets the initial and fracture pressures.", "800 to 4000 m"],
    ["Analysis horizon", "Length of the time series, in years. The evaluation-time slider runs from 0 to this value.", "20 to 100 yr"],
  ]);

  b.push({ t: "h2", text: "4.3 Pressure limit" });
  p("The allowable buildup is calculated as: safety factor × fracture pressure − initial pressure, where the initial pressure is the hydrostatic gradient times the depth, and the fracture pressure is the fracture gradient times the depth. The panel shows the initial pressure, the fracture pressure and the resulting maximum buildup under the inputs.");
  table("Table 3. Pressure-limit inputs.", ["Input", "Meaning", "Typical value"], [
    ["Hydrostatic gradient", "Initial formation-pressure gradient.", "0.0098 to 0.0115 MPa/m"],
    ["Fracture gradient", "Gradient of the pressure at which the caprock or formation would fracture.", "0.015 to 0.020 MPa/m"],
    ["Safety factor", "Fraction of the fracture pressure that you allow to be reached.", "0.8 to 0.95"],
    ["Interference threshold", "A small pressure rise used only to detect where and when a well's influence arrives. It is not a pass/fail limit.", "0.01 to 0.1 MPa"],
  ]);
  p("Important: wells pass or fail against the max allowable buildup only. The interference threshold is used for the dashed map contour, the arrival-time table and the monitoring-point check.");

  b.push({ t: "h2", text: "4.4 CO₂ saturation inputs" });
  table("Table 4. Relative-permeability inputs used for the CO₂ saturation map.", ["Input", "Meaning", "Default"], [
    ["Residual brine Swr", "Brine saturation that cannot be displaced. The maximum CO₂ saturation is 1 − Swr.", "0.2"],
    ["Max CO₂ rel. perm. krg", "Relative permeability to CO₂ at maximum CO₂ saturation.", "0.4"],
    ["Corey exponent, brine", "Shape of the brine relative-permeability curve.", "4"],
    ["Corey exponent, CO₂", "Shape of the CO₂ relative-permeability curve.", "2"],
    ["CO₂ viscosity", "Viscosity of CO₂ at reservoir conditions.", "0.06 mPa·s"],
  ], "The defaults are illustrative; replace them with values for your formation (for example from core measurements).");

  b.push({ t: "h2", text: "4.5 Well skin" });
  p("Skin describes extra pressure loss (positive skin, formation damage) or gain (negative skin, stimulation) near a well. Skin is set per well in the Skin column of the wells table:");
  bullets(
    "If you have a measured skin value, type it in the well's Skin cell.",
    "If you leave the cell empty, the application calculates the skin of that well with the Hawkins formula, s = (k/ks − 1) ln(rs/rw), from the damaged-zone permeability ks and radius rs in the Well skin section. The calculated value is displayed in grey inside the empty cell.",
    "You can mix both approaches: some wells with typed skin, the others calculated.",
  );
  p("Skin raises the pressure at the injector itself while it injects; it does not change the pressure felt at other wells.");
  fig("skinbound", "Figure 3. The Well skin and Boundary condition sections.");

  b.push({ t: "h2", text: "4.6 Boundary condition" });
  p("Choose how the aquifer behaves at a straight outer boundary:");
  bullets(
    "None (infinite): the aquifer extends indefinitely; pressure spreads without meeting an edge.",
    "Sealing fault (no-flow): a barrier that reflects the pressure; buildup is higher than in the infinite case.",
    "Constant pressure: an open edge that holds the pressure; buildup is lower than in the infinite case.",
  );
  p("For the two bounded cases give the boundary as a line, x = constant or y = constant (or longitude or latitude when real-world coordinates are used), and its position. All wells and monitoring points must lie on the same side. The Compare boundaries tab always shows all three cases side by side using the line you entered here.");

  b.push({ t: "h2", text: "4.7 Injection wells" });
  fig("wells", "Figure 4. The Injection wells section.");
  table("Table 5. Columns of the wells table.", ["Column", "Meaning"], [
    ["Name", "Label shown on charts and tables."],
    ["x, y (or Lon, Lat)", "Well location. Choose the units with the selector in the column header."],
    ["Rate", "CO₂ injection rate (default unit Mt/yr). Change the unit in the column header."],
    ["Start, End", "Year injection starts and stops. After the end year the well is shut in and its pressure recovers."],
    ["Skin", "Typed skin value, or empty to calculate it (Section 4.5)."],
    ["×", "Removes the well."],
  ]);
  p("Use + Add well to add a well. Import CSV loads a table of wells from a file and Export saves the current table (Section 9).");

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
    "The Evaluation time slider, the Pressure unit selector, Map padding and the tabs do not require a new RUN, because they only change what is displayed.",
    "Warnings appear above the results when something is inconsistent, for example a well that lies on the boundary, wells on both sides of the boundary, two wells at the same location, an end year that is not after the start year, or a pressure limit that is below the initial pressure.",
  );

  h1("6. Reading the results");
  b.push({ t: "h2", text: "6.1 Status cards" });
  p("Three cards sit above the tabs. Peak buildup is the highest wellbore pressure buildup of any well over the whole analysis horizon and names the well and the time. Allowable buildup shows the limit that is being applied. Status reports Within limit or Limit exceeded, and says by what factor all injection rates could be scaled before the worst well reaches the limit. Because the model is linear in rate, that factor is exact within the model.");

  b.push({ t: "h2", text: "6.2 CO₂ saturation tab" });
  fig("sat", "Figure 6. CO₂ saturation map with the plume of each injector and the table of plume radii.");
  p("The map shows the saturation of injected CO₂ (Sg) at the evaluation time, with a labelled colour scale from 0 up to the maximum saturation. Each injector creates a roughly circular plume; the dashed contour marks the plume edge (Sg = 0.05). Plumes of neighbouring wells are added where they overlap. Below the map, a table lists for each well the mass injected so far, the plume radius, the saturation just behind the front and the maximum saturation at the well. Drag the Evaluation time slider to watch the plumes grow; each plume stops growing when its well is shut in.");

  b.push({ t: "h2", text: "6.3 Pressure map tab" });
  fig("pressure-map", "Figure 7. Pressure buildup map with the interference-threshold and allowable-buildup contours.");
  p("The map shows the total pressure buildup caused by all wells at the evaluation time, with a labelled colour scale. The dashed teal contour is the interference threshold (detection only). The solid white-and-black contour is the max allowable buildup (the pass/fail limit); it appears only near wells that approach the limit. Use Map padding to enlarge or shrink the area drawn around the wells.");

  b.push({ t: "h2", text: "6.4 Time series tab" });
  fig("time-series", "Figure 8. Time series of pressure at every well and monitoring point, with the field maximum and average.");
  p("The Show selector chooses what is plotted: total buildup (ΔP) at each wellbore including skin; bottomhole pressure (initial pressure plus buildup), with the maximum allowable bottomhole pressure; or interference only, which removes each well's own contribution so that only the effect of the other wells remains. Dashed lines are monitoring points. The black line is the field maximum (the highest pressure of any well at each time) and the grey dash-dot line is the field average.");
  p("Under the chart, the section “What drives the field maximum” stacks the contributions of each injector and of skin at the well that has the highest pressure at each time, and a table gives the breakdown at the moment of the field peak.");

  b.push({ t: "h2", text: "6.5 Interference matrix tab" });
  fig("matrix", "Figure 9. Interference matrix and arrival-time table.");
  p("The first table has one row per injecting well and one column per receiving well. Each cell is the pressure that the row well contributes at the column well at the evaluation time; the diagonal cells are each well's own buildup including skin. The last column gives the total felt at other wells, and the last row the total at each receiver. The second table gives the first time (years) that a single source well alone raises the pressure at each target (wells and monitoring points) by the interference threshold; a dash means it does not happen during the injection period.");

  b.push({ t: "h2", text: "6.6 Limit check tab" });
  fig("limits", "Figure 10. Limit check for each well and the monitoring-point table.");
  p("Each well is listed with its peak buildup, the time of the peak and how that peak splits into the well's own response, skin and interference from the other wells. The bottomhole pressure, the margin to the allowable buildup and an OK or Exceeds status follow. Below, the monitoring-point table shows the peak buildup at each monitoring point and whether, and when, it first reaches the interference threshold.");

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
  p("Report (PDF) and Report (Word) generate a publication-style document: title block, abstract, introduction, methodology with numbered equations, input tables, results with captioned figures and tables (CO₂ saturation, pressure, interference, boundary sensitivity, field-maximum drivers), a discussion written from your numbers, limitations and references. The report reflects the inputs of the last run and the units and evaluation time currently selected. The Word version can be edited; the PDF is ready to share.");

  h1("9. File formats");
  p("The wells table can be saved with Export and loaded again with Import CSV. Excel files should be saved as CSV first. Columns are separated by commas, semicolons or tabs, and the header row is optional.");
  table("Table 7. Wells CSV columns.", ["Mode", "Columns (in order)"], [
    ["Local coordinates", "name, x_m, y_m, rate_Mtpa, start_yr, end_yr, skin (optional)"],
    ["Longitude / latitude", "name, lon_deg, lat_deg, rate_Mtpa, start_yr, end_yr, skin (optional)"],
  ], "An empty skin means “calculate it”. A header whose second column contains “lon” switches the application to longitude / latitude mode on import.");
  p("Example (local coordinates):  INJ-1,0,0,1,0,25,   (skin left empty)   and   INJ-2,4000,1000,1,2,25,4.5");

  h1("10. Model summary and limitations");
  p("Pressure buildup is calculated from the Theis line-source solution for each well, added together in space and time, with shut-in modelled by a negative rate after the end year and a straight boundary modelled with image wells. The wellbore pressure adds the skin term. CO₂ saturation follows from the radial Buckley–Leverett (Welge) solution with Corey relative permeabilities. The report contains the equations.");
  bullets(
    "Homogeneous, isotropic, confined aquifer of constant thickness; no leakage through the caprock.",
    "Brine-equivalent flow for the pressure calculation: CO₂ is converted to reservoir volume with the CO₂ density and brine viscosity is used everywhere. This overstates near-well pressure but is reasonable for interference between wells.",
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
    ["The allowable buildup is zero or negative", "Safety-factored fracture pressure is below the initial pressure.", "Check depth and the two gradients, and the safety factor."],
    ["Wells import fails", "A row has fewer than six columns or a non-numeric value.", "Check the column order in Section 9; the message names the row."],
    ["Longitude / latitude error", "Latitude is outside ±90° or longitude outside ±180°.", "Correct the values; check that longitude and latitude are not swapped."],
    ["The plume looks small", "Only injected mass inside the front is shown; there is no gravity override.", "Check porosity, thickness, CO₂ density and relative-permeability inputs."],
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
    ["Allowable buildup", "Safety factor × fracture pressure − initial pressure; the pass/fail limit for wells."],
    ["Interference threshold", "Small pressure rise used to detect where and when a well's influence arrives; not a pass/fail limit."],
    ["Image well", "A mirrored well used to represent a straight boundary."],
    ["Shut-in", "End of injection at a well; its pressure then recovers."],
  ]);

  h1("Appendix A. Default example data");
  b.push({ t: "table", caption: "Table 10. Wells in the built-in example.", head: ["Well", "x (m)", "y (m)", "Rate (Mt/yr)", "Start (yr)", "End (yr)", "Skin"], rows: [
    ["INJ-1", "0", "0", "1.0", "0", "25", "calculated"],
    ["INJ-2", "4000", "1000", "1.0", "2", "25", "calculated"],
    ["INJ-3", "1500", "5000", "0.8", "5", "25", "calculated"],
    ["INJ-4", "-3500", "3000", "0.5", "8", "20", "calculated"],
  ], note: "Monitoring point “Legacy well” at x = 8000 m, y = −3000 m. Aquifer: 150 mD, 60 m, porosity 0.2, depth 2000 m; skin from a damaged zone of 50 mD and 1.5 m radius (s = 5.42)." });

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
