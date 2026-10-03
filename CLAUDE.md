@AGENTS.md

# CO₂ Injection Pressure Interference and Saturation Analyzer

Web app (Next.js 16, React 19, TypeScript, no UI library) for screening-level analysis of several CO₂ injection wells in a
saline aquifer. Live site: https://co2-interference.vercel.app · repo: github.com/tjayjnr/co2-interference.
Everything runs in the browser; there is no backend or database.

## Run, test, ship
- `npm install`, then `npm run dev` (http://localhost:3000). `npm run build` must pass before pushing.
- `npm test` runs the physics tests (`tests/physics.test.mjs`, Node's built-in runner; TS files are loaded with type stripping,
  so modules imported by tests use explicit `.ts` extensions and no path aliases).
- Pushing to `main` deploys to Vercel automatically (`vercel.json` pins the Next.js framework). Work on a branch and open a
  pull request if you are not the project owner.
- User manual: `npm run manual` rebuilds `public/manual/user-manual.pdf|docx` (also copies them to the Desktop of whoever runs
  it). Screenshots in `public/manual/*.png` come from `scripts/manual-shots.cjs` (needs `npm i -D puppeteer-core`, Edge/Chrome,
  and the built app running on port 3120). Rerun both after any visible UI change.

## Where things are
- `lib/physics.ts` – Theis solution, superposition over wells and rate changes, images for boundaries, skin, grids, limits.
- `lib/threezone.ts` – constants of the three-zone CO₂–brine pressure kernel (kernel itself is `threeZoneKernel` in physics.ts).
- `lib/saturation.ts` – radial Buckley–Leverett plume (Welge); `lib/dryzone.ts` – dry-zone radius (IAPWS, fugacity chain).
- `lib/geo.ts` – lon/lat ⇄ local x,y; `lib/units.ts` – unit tables; `lib/csv.ts` – wells CSV import/export.
- `lib/charts.ts` – every chart as an SVG string (title, legend, zoom `view`, map styles); `lib/contour.ts`, `lib/streamlines.ts`.
- `lib/report.ts` – publication-style PDF (jsPDF + STIX fonts in `public/fonts`) and Word (docx) report.
- `lib/manual.ts` – manual content shared by `/manual` (app/manual/page.tsx) and the PDF/Word manual.
- `app/page.tsx` – the whole UI (inputs left, results right); `components/ChartView.tsx` – zoom/export wrapper; `app/globals.css`.

## Conventions and gotchas
- Physics always works in canonical units (m, mD, MPa, mPa·s, 1/MPa, kg/m³, Mt/yr, years). Units are display-only
  (`lib/units.ts`, `uf()` in page.tsx). CSV files are always metres / Mt/yr or degrees.
- Results are computed from the snapshot taken when RUN is pressed (`applied`); live inputs never change results until RUN.
  Well/point names are the exception (they update everywhere at once).
- Inputs are stored as typed and clamped only when used (`satEff`, `dryEff`, …): clamping inside `onChange` rewrites what the
  user is typing.
- Wells on all maps are a thin vertical line with the name on top (no circles or dots). Fonts: Times New Roman everywhere
  (the PDF uses STIX, which has no subscript digits or radical in italics – see `pdfSafe`).
- Any change to inputs, equations or visuals should update `lib/manual.ts`, the report text in `lib/report.ts`, and add or
  adjust a test. Keep the tests passing; they include checks against the reference derivation (single-well 82 psi example,
  closed-form gas front 1690 m, three-zone continuity conditions).
- Model scope: homogeneous confined aquifer, one straight boundary, brine-equivalent or three-zone pressure kernel, no gravity
  override/dissolution/trapping in the saturation map. Results are for screening only.
