@AGENTS.md

# CO₂ Injection Pressure Interference

Web app (Next.js 16, React 19, TypeScript, no UI library) for screening-level analysis of several injection wells in a
saline aquifer. The user chooses the Well system: Single well (the program's single-well calculation) or Multiwell
interference (the program's multiwell section). Models: single-phase water, single-phase CO₂ or two-phase CO₂–brine. Live site:
https://co2-interference.vercel.app · repo: github.com/tjayjnr/co2-interference. Everything runs in the browser.

## Run, test, ship
- `npm install`, then `npm run dev` (http://localhost:3000). `npm run build` must pass before pushing.
- `npm test` runs `tests/bhp.test.mjs`, `tests/multiwell.test.mjs`, `tests/field.test.mjs`, `tests/physics.test.mjs` (Node's runner with type
  stripping: imported modules use explicit `.ts` extensions, no path aliases, no constructor parameter properties).
- Pushing to `main` deploys to Vercel automatically. Work on a branch and open a pull request if you are not the owner.
- User manual: `npm run manual` rebuilds `public/manual/user-manual.pdf|docx`. Screenshots in `public/manual/*.png` come from
  `scripts/manual-shots.cjs` (needs `npm i -D puppeteer-core`, Edge/Chrome, the built app on port 3120). Rerun both after UI changes.

## Where things are
- `reference/co2_bhp_model.py` – the reference program, verbatim: co2_bhp_multiwell (2).py (single-well and MULTIWELL
  INTERFERENCE sections, Peng–Robinson CO₂ properties, zone 2 mobility Λ₂ = k·(krg2/μg + krw2/μw), pressure-limit
  check). It is the source of truth for every equation, input check, message, table and output file. (Peng–Robinson is
  4–6 % low in CO₂ density near the critical region compared with Span–Wagner; the project chose to keep Peng–Robinson.)
- `lib/bhp.ts` – line-by-line translation of the single-well section (Python names, same result keys and order, messages,
  first-year detail, shut-in observation, pressure-limit status/summary, output files with Python number formatting,
  scipy `brentq` ported step by step). `lib/bhpPlot.ts` – the program's figure bhp_vs_year.png as SVG.
- `lib/multiwell.ts` – line-by-line translation of the multiwell section (website additions: image wells, and `end_year` per well:
  single phase = rate change to 0; two phase stopped early = the program's fixed-zone falloff from its end year) (Well, validate_wells, configure_well_geometry incl.
  the pairwise-matrix layout, _evaluate_multiwell, solve_multiwell_time, _multiwell_rows, run_multiwell,
  _frozen_source_observation, calculate_multiwell_observation, save_multiwell_results files). Only addition: optional image
  wells (`images`) for the website's boundary option. `lib/multiwellPlot.ts` – its two figures as SVG.
- `lib/mwfield.ts` – `MultiwellField`: the multiwell program evaluated at any point/time for the maps, curves, matrix and
  boundary comparison (coupled solve at that time; frozen-source falloff after the endpoint). Used for both systems
  (single well = one-well multiwell run, equal to the single-well program within the 1e-4 psi tolerance). Returns MPa.
- `lib/physics.ts` – shared types, rate schedules, image sources, time grid, pressure limit. `lib/saturation.ts` – Buckley–Leverett map.
- `lib/geo.ts`, `lib/units.ts`, `lib/csv.ts`, `lib/charts.ts` (+ `contour.ts`, `streamlines.ts`), `lib/report.ts` (PDF/Word report).
- `app/page.tsx` – the UI: Well system (Single well / Multiwell interference) first, then model and boundary, reservoir and
  fluids, the well (single) or number of wells, distances and the well table (multi), pressure check, observation, points,
  report. Tabs: Program results (single) or Multiwell results (multi, the program's exact tables, figures and files), then
  maps/curves; Well BHP (multi) also runs the single-well program for the selected well on its own.

## Conventions and gotchas
- Never change the physics in lib/bhp.ts on its own: change the Python, copy it to `reference/`, mirror it in lib/bhp.ts,
  run `python scripts/bhp-reference.py` and `python scripts/multiwell-reference.py` (need numpy + scipy) and `npm test`.
- Known differences from the Python, documented in the tests: `pressure_evaluations` can differ by one at round-off;
  shut-in pressures agree to about 1e-3 psi (different time integrator from scipy BDF); a pairwise-matrix layout is
  normalised with the third well above the x axis (numpy eigenvector signs are arbitrary; distances are identical).
- Page inputs are stored in canonical units (m, mD, MPa, cP, 1/MPa, kg/m³, °C; well rates in Mscf/day of CO₂ or STB/day of
  water) and converted to the program's field units by `toBhp()` in page.tsx. Units are display-only (`lib/units.ts`).
- Results come from the snapshot taken when RUN is pressed; nothing is calculated before the first RUN. Well/point names
  update everywhere at once. Never clamp inputs inside `onChange`; the program's `validate` reports bad values.
- The diffusivity is not an input: the program calculates D = m / c* for each zone (all_calculations.csv).
- Any change to inputs, equations or visuals should update `lib/manual.ts`, the report text in `lib/report.ts` and a test.
