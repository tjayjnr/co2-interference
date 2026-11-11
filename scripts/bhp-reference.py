"""Write tests/bhp-reference.json from the reference Python model (reference/co2_bhp_model.py).

Runs the model exactly as its browser form does (run_model, calculate_observation, save_results) and stores the files it
writes, so tests/bhp.test.mjs can check that the website (lib/bhp.ts) produces the same outputs.
Run with a Python that has numpy and scipy:
    python scripts/bhp-reference.py
"""

import json
import sys
import tempfile
from dataclasses import asdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "reference"))
import co2_bhp_model as m  # noqa: E402

CASES = [
    ("two_phase_default", {}, 30, (10.0, "0,0.5,1,5,10"), None),
    ("two_phase_no_evaporation", {"include_evaporation": False}, 20, (5.0, ""), {"mode": "max_bhp", "max_bhp_psia": 3600}),
    ("two_phase_corey2_skin", {"corey_n_gas": 2.0, "corey_n_water": 2.0, "skin": 2.5, "q_Mscf_day": 400.0}, 15, (5.0, "0,2,5"),
     {"mode": "fracture_fraction", "fracture_pressure_psia": 4000, "fraction": 0.9}),
    ("single_co2", {"phase_mode": "single", "single_phase_fluid": "co2"}, 30, (10.0, "0,0.5,1,5,10"), {"mode": "max_bhp", "max_bhp_psia": 5000.0}),
    ("single_water", {"phase_mode": "single", "single_phase_fluid": "water", "skin": 1.0}, 3, (0.0, ""), None),
]

out = {"inputs_default": asdict(m.Inputs()), "cases": []}
for name, patch, years, (period, offsets), limit in CASES:
    p = m.Inputs(**patch)
    p.observation_period_years = period
    p.observation_years = offsets
    results, constants = m.run_model(p, years)
    observation = m.calculate_observation(results[-1], p, make_plot=True)
    with tempfile.TemporaryDirectory() as tmp:
        folder = m.save_results(results, p, constants, tmp, make_plot=False, observation=observation, pressure_limit=limit)
        files = {f.name: f.read_bytes().decode("utf-8") for f in Path(folder).iterdir()}
    # first_year_detail.csv is long (hundreds of rows): keep the header and every 10th row plus the last one
    lines = files["first_year_detail.csv"].split("\r\n")
    body = [ln for ln in lines[1:] if ln]
    keep = sorted(set(range(0, len(body), 10)) | {len(body) - 1})
    files["first_year_detail.csv"] = {"header": lines[0], "rows": {str(i): body[i] for i in keep}, "count": len(body)}
    out["cases"].append({
        "name": name, "patch": patch, "years": years,
        "observation": {"period": period, "offsets": offsets}, "pressure_limit": limit,
        "files": files,
        "plot_shut_in": None if observation is None else {
            "elapsed_years": [float(x) for x in observation["elapsed_years"]],
            "bhp_psia": [float(x) for x in observation["bhp_psia"]],
        },
    })

dest = ROOT / "tests" / "bhp-reference.json"
dest.write_text(json.dumps(out, indent=1), encoding="utf-8")
print(f"wrote {dest} ({dest.stat().st_size // 1024} kB)")
for c in out["cases"]:
    print(c["name"], sorted(k for k in c["files"]))
