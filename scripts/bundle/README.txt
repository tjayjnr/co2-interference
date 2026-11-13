BHP CALCULATION CODE (as used by the website)
=============================================

Translated line by line from the Python program co2_bhp_multiwell (2).py: the single-well section and the
MULTIWELL INTERFERENCE section, Peng-Robinson CO2 properties, Lambda2 = k*(krg2/mu_g + krw2/mu_w), and the
pressure-limit check. The website's tests compare every output file with the files written by the Python.

Files
  bhp.ts            Single well: single-phase water, single-phase CO2 and two-phase CO2-brine (three zones), the
                    year-by-year pressure/property solve, the first-year detail, the post-shut-in observation, the
                    pressure-limit check and the output files (CSV/JSON as written by the Python).
  multiwell.ts      Multiwell interference: well table, distances (constant spacing in a line or grid, adjacent
                    distances, pairwise distance matrix, x/y coordinates), the coupled solve of all wells (each well's
                    properties at its own total BHP), the observation after all wells stop, the pressure check and the
                    output files (multiwell_summary.csv, interference_contributions.csv, source_states.csv, ...).
  bhpPlot.ts        The single-well figure bhp_vs_year as SVG.
  multiwellPlot.ts  The two multiwell figures (BHP and interference; contribution matrix and fronts) as SVG.
  run_bhp.mjs       A script to run the calculation without the website. Edit the INPUTS at the top.

How to run (Node.js 22.18 or newer; Node runs the .ts files directly)
  node run_bhp.mjs               single well (prints the BHP, saves the files in results/)
  node run_bhp.mjs --multiwell   multiwell interference (prints each well's BHP, own response, skin and
                                 interference, saves the files in results_multiwell/)

Each multiwell well has a start_year and an end_year; the last end year is the project endpoint. A single-phase
well's end year is a rate change to 0 (the program's rate schedule); a two-phase well that stops before the last one
follows the program's fixed-zone falloff from its end year while the others continue (an addition to the program,
which stops all wells together; with equal end years the results are exactly the program's).

Well radius in the multiwell run: RADIUS = { same: true, rw_ft: 0.55 } gives every well the same radius;
same: false uses the rw_ft given for each well in WELLS.

Units are field units, as in the Python program: psia, ft, mD, cP, 1/psi, lb/ft3, Mscf/day (CO2) or STB/day
(water), deg F; one year = 365.25 days.

Differences from the Python (both tiny): after shut-in the pressures agree to about 0.003 psi (a different time
integrator from scipy BDF), and a pairwise-matrix layout is drawn with the third well above the x axis (numpy's
eigenvector signs are arbitrary; all distances and pressures are the same).

Background properties (calculated, never entered): CO2 viscosity (Fenghour 1998, from the live Peng-Robinson density),
salinity (McCain inverse of the brine density at 60 F and 14.696 psia), brine density (Driesner 2007 + IAPWS-IF97) and
water compressibility cw = (1/rho)(d rho/dP). They are recalculated at every pressure trial and in the shut-in solve.
The only related input is brine_standard_density_lb_ft3 (default 63.878 lb/ft3).
