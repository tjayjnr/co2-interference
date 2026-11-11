"""Write tests/multiwell-reference.json from the multiwell section of the reference program (reference/co2_bhp_model.py).

Each case is run as the program's browser form does (configure_well_geometry, run_multiwell,
calculate_multiwell_observation, save_multiwell_results) and the files it writes are stored, so
tests/multiwell.test.mjs can check that the website (lib/multiwell.ts) produces the same outputs.
Run with a Python that has numpy and scipy:
    python scripts/multiwell-reference.py
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
    {
        "name": "two_phase_line_staggered",
        "patch": {},
        "wells": [
            {"name": "Well 1", "rate": 150.0, "start_year": 0.0, "rw_ft": 0.55, "skin": 0.0},
            {"name": "Well 2", "rate": 200.0, "start_year": 2.0, "rw_ft": 0.4, "skin": 1.5, "max_bhp_psia": 3650.0},
            {"name": "Well 3", "rate": 100.0, "start_year": 5.0, "rw_ft": 0.55, "skin": 0.0, "include_evaporation": False},
        ],
        "geometry": {"number": 3, "mode": "constant", "layout": "line", "spacing_ft": 1000.0},
        "years": 10.0, "report_times": "", "observation": (5.0, "0,1,5"),
        "limit": {"mode": "max_bhp", "max_bhp_psia": 3700.0},
    },
    {
        "name": "two_phase_grid_no_evaporation",
        "patch": {"include_evaporation": False},
        "wells": None,
        "geometry": {"number": 4, "mode": "constant", "layout": "grid", "spacing_ft": 800.0},
        "years": 5.0, "report_times": "0.5,1,2.5,5", "observation": (0.0, ""),
        "limit": {"mode": "fracture_fraction", "fracture_pressure_psia": 4500.0, "fraction": 0.9},
    },
    {
        "name": "single_co2_adjacent_schedule",
        "patch": {"phase_mode": "single", "single_phase_fluid": "co2"},
        "wells": [
            {"name": "A", "rate": 150.0, "start_year": 0.0, "rw_ft": 0.55, "skin": 0.0},
            {"name": "B", "rate": 150.0, "start_year": 1.0, "rw_ft": 0.55, "skin": 2.0,
             "rate_schedule": [{"year": 1.0, "rate": 150.0}, {"year": 4.0, "rate": 75.0}, {"year": 7.0, "rate": 0.0}]},
            {"name": "C", "rate": 0.0, "start_year": 0.0, "rw_ft": 0.55, "skin": 0.0},
        ],
        "geometry": {"number": 3, "mode": "different", "different_input": "adjacent", "adjacent_distances_ft": "1000, 1500"},
        "years": 10.0, "report_times": "", "observation": (5.0, ""),
        "limit": None,
    },
    {
        "name": "water_pairwise",
        "patch": {"phase_mode": "single", "single_phase_fluid": "water"},
        "wells": None,
        "geometry": {"number": 3, "mode": "different", "different_input": "pairwise",
                     "pairwise_distances_ft": "0,1000,1500\n1000,0,1200\n1500,1200,0"},
        "years": 3.0, "report_times": "1,2,3", "observation": (2.0, "0,0.5,2"),
        "limit": {"mode": "max_bhp", "max_bhp_psia": 3700.0},
    },
]

LONG = {"multiwell_time_detail.csv", "source_states.csv", "interference_contributions.csv"}

out = {"cases": []}
for case in CASES:
    p = m.Inputs(**case["patch"])
    period, offsets = case["observation"]
    p.observation_period_years = period
    p.observation_years = offsets
    wells = [m.Well(**w) for w in case["wells"]] if case["wells"] else m.default_wells(p, case["geometry"]["number"])
    wells, settings = m.configure_well_geometry(p, wells, **case["geometry"])
    result = m.run_multiwell(p, wells, case["years"], case["report_times"], pressure_limit=case["limit"])
    result["geometry"] = settings
    observation = m.calculate_multiwell_observation(result, detail=True)
    with tempfile.TemporaryDirectory() as tmp:
        folder = m.save_multiwell_results(result, tmp, make_plot=False, observation=observation)
        files = {f.name: f.read_bytes().decode("utf-8") for f in Path(folder).iterdir()}
    for name in LONG:
        lines = files[name].split("\r\n")
        body = [ln for ln in lines[1:] if ln]
        keep = sorted(set(range(0, len(body), 7)) | {len(body) - 1})
        files[name] = {"header": lines[0], "rows": {str(i): body[i] for i in keep}, "count": len(body)}
    out["cases"].append({
        **{k: v for k, v in case.items() if k != "observation"},
        "observation": {"period": period, "offsets": offsets},
        "inputs": asdict(p),
        "files": files,
    })

dest = ROOT / "tests" / "multiwell-reference.json"
dest.write_text(json.dumps(out, indent=1), encoding="utf-8")
print(f"wrote {dest} ({dest.stat().st_size // 1024} kB)")
for c in out["cases"]:
    print(c["name"], sorted(c["files"]))
