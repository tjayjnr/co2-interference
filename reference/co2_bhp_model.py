#!/usr/bin/env python3
"""Injection BHP with single-well and MULTIWELL INTERFERENCE sections.

WELL COUNT, DISTANCE OPTIONS, AND PRESSURE-LIMIT ASSESSMENT
    First choose Single well or Multiwell interference. For multiwell runs,
    select the number of wells and Constant neighboring spacing or Different
    distances. Constant spacing supports a straight line or square grid.
    Different distances support adjacent line gaps, a full pairwise-distance
    matrix, or custom x/y coordinates. All distances are in ft. A pairwise
    matrix must describe a realizable horizontal 2-D layout.
    Apply the well count and distances to preview the actual separation matrix.
    Existing per-well rate/start/radius/skin/pressure-limit edits are preserved
    when resizing the well table. New wells receive the displayed defaults.

    Select a pressure check for either single- or multiwell operation:
      - Not assessed: no pressure limit supplied.
      - Maximum allowable BHP: enter absolute psia.
      - Fraction of fracture pressure: enter absolute psia and a fraction (0.9
        by default; this is a user-selected input, not a regulatory rule).
    Optional max_bhp_psia in a well row overrides the shared limit for that well.
    PASS means required BHP <= allowable BHP; FAIL means required BHP > limit.
    Rates are not automatically reduced when a limit is exceeded. The check
    assesses pressure at computed sample times, not mechanical well integrity.
    pressure_limit_summary.csv reports peak BHP, allowable pressure, minimum
    margin, and first detected sampled exceedance. well_separations_ft.csv
    reports the actual pairwise distances with a zero diagonal.

    CLI examples:
      python co2_bhp_multiwell.py --multiwell --defaults --number-wells 5 --spacing-mode constant --spacing-ft 1000 --layout line
      python co2_bhp_multiwell.py --multiwell --defaults --number-wells 4 --spacing-mode different --adjacent-distances 1000,1500,800 --max-bhp-psia 4680
      python co2_bhp_multiwell.py --multiwell --defaults --number-wells 4 --spacing-mode different --distance-matrix-file distances.csv --fracture-pressure-psia 5200 --pressure-fraction 0.9

QUICK START — MULTIWELL
    Notebook / Colab: run this complete file; choose Single well or
    Multiwell interference in the Well system selector. If needed, install ipywidgets in a SEPARATE notebook cell first.
        %run co2_bhp_multiwell.py
    Browser form (choose Multiwell interference under Well system):
        python co2_bhp_multiwell.py --multiwell --browser
    Four wells on an editable 1000-ft square, with supplied physical defaults:
        python co2_bhp_multiwell.py --multiwell --defaults --years 30
    Disable evaporation and include field shut-in observation:
        python co2_bhp_multiwell.py --multiwell --defaults --evaporation off --observation-period 10 --observation-years 0,0.5,1,5,10
    Write an editable JSON configuration, then run it:
        python co2_bhp_multiwell.py --write-multiwell-example four_wells.json
        python co2_bhp_multiwell.py --config four_wells.json
    Direct API: calculate_multiwell_from_inputs({"years": 30,
        "parameters": asdict(Inputs()), "wells": [asdict(w) for w in default_wells()]})

MULTIWELL INPUTS AND OUTPUTS
    Each well has name, x_ft, y_ft, rate, start_year, rw_ft, skin, and an
    optional include_evaporation override (true/false/null = inherit).
    CO2 rates are Mscf/day; water rates are STB/day. All coordinates use ft.
    Passive monitoring wells use rate=0. The formation parameters are shared.
    Two-phase injection: one constant rate per source and staggered starts.
    Single-phase injection also supports rate_schedule, a list such as
        [{"year": 0, "rate": 150}, {"year": 5, "rate": 75}, {"year": 10, "rate": 0}]
    Schedule years are absolute project years. Two-phase arbitrary rate changes
    are explicitly rejected rather than treated as independent reset plumes.
    All wells stop at the project endpoint during post-shut-in observation.
    The supplied three-zone E1 expression is used at every receiver's distance.
    Each source's Peng-Robinson properties and fronts are updated at its TOTAL
    BHP, including neighboring-well pressure. Local skin is added only once.
    This is a multiphase superposition approximation; plume overlap is flagged,
    not resolved as a shared multidimensional displacement problem.

    multiwell_summary.csv: each BHP, own response, local skin, interference,
        individual source contributions, dry/gas radii and convergence residual.
    interference_contributions.csv: each receiver/source pair at each report time.
    source_states.csv: all original intermediate quantities at each source state.
    final_interference_matrix.csv: rows=receivers, columns=sources; excludes skin.
    evaluation_distances_ft.csv: interwell distance; diagonal=source well radius.
    multiwell_time_detail.csv: dense first-year and startup samples for plotting.
    plume_overlap.csv: pairwise circular-plume and dry-zone overlap checks.
    multiwell_inputs_used.json: replayable full configuration and model conventions.
    multiwell_observation.csv / observation_contributions.csv: optional falloff.
    multiwell_bhp_and_interference.png / multiwell_matrix_and_fronts.png: plots.
    When evaporation is OFF, dry_zone_radius_ft=0 and dry thickness/volume=0.
    The internal interface rd_ft and zone2_inner_radius_ft remain at rw so the
    absent dry annulus never creates negative pore volume. Do not interpret
    that internal interface as a nonzero dry-zone extent.

SINGLE-WELL OPTIONS (retained)
    Single-phase water, single-phase CO2, or two-phase CO2-brine.

EVAPORATION SELECTION
    Two-phase mode asks: Include evaporation? Yes or No.
    The notebook and browser forms have the same choice.
    Yes retains the original calculation and is the default.
    No sets yw = ceq = alpha_d = 0, so rd = rw and the dry-zone volume is zero.
    Dry-zone thickness is reported separately as rd - rw: exactly zero for No.
    rd_ft remains the boundary radius from the well center for all equations.
    Command line: --evaporation on or --evaporation off.
    Saved inputs use include_evaporation: true or false.

CO2 DISSOLUTION IN BRINE (OPTIONAL, TWO-PHASE MODEL ONLY)
    Two-phase mode asks: Include CO2 dissolution? Yes or No. No is the default
    and gives exactly the original calculation. Yes evaluates, at every trial
    pressure P: Xeq(P) (Spycher 2003 with NaCl salting-out; 35-99 C, 1-600 bar,
    <= 6 mol/kg), rho_aq = 1/((1-Xeq)/rho_b + Xeq/rho_app), Cd = rho_aq*Xeq.
    Dissolution enters the pressure calculation in four places:
      1. GAS FRONT: tangent from (-a,-a), a = Cd/(rho_g-Cd):
             dfg/dSg(Sf) = (fg(Sf)+a)/(Sf+a) = F_diss
             rg = sqrt(rw^2 + Vr_ft3*F_diss/(pi*phi*h)); a = 0 gives F exactly.
      2. ZONE 2 SATURATION by total CO2 mass balance:
             Sg2 = (Minj-rho_g*Vp1-Cd*Vp2)/((rho_g-Cd)*Vp2)
      3. ZONE 2 STORAGE: ct2 = Sg2*cg + Sw2*cw + cr + c_sol,
             c_sol = Sw2*rho_aq*(dXeq/dP)/(1-Xeq)*(1/rho_g-1/rho_app)
      4. FLOW INTO ZONE 3: b3 = theta*exp(...)/(2*m3),
             theta = [beta*(1-fg)-F_diss*(beta*(1-Sf)-rho_b)]/rho_b, beta = rho_aq*(1-Xeq)
    With evaporation ON the brine water content is rho_aq*(1-Xeq)*(1-xs).
    rho_b and xs are the live background brine values. The same per-source
    equations are used in single-well and multiwell runs.
    Command line: --dissolution on or --dissolution off.
    Saved inputs use include_dissolution: true or false.

PHASE SELECTION
    Notebook form: the two-phase grid opens with the shut-in inputs directly
    below injection years. Use the phase dropdown to select another model.
    Console: select 1 (water), 2 (CO2), or 3 (two-phase CO2-brine).
    Browser: run the command below to open the form. Two-phase mode opens
    with the shut-in choice, observation duration, and reporting years visible.
        python co2_bhp_multiwell.py --browser
    Single-phase water without prompts:
        python co2_bhp_multiwell.py --defaults --phase single --fluid water --years 30
    Water rate is water_rate_stb_day [STB/day], not q_Mscf_day.
    Single-phase water Bw is fixed at exactly 1.0 rb/STB at every pressure
    and time, including the initial state. It is not an editable input.
    Legacy water_Bw_rb_stb values in saved inputs are overridden to 1.0.
    Water density retains rho_w(P)=rho_w(Pi)*exp(cw*(P-Pi)).
    Water's reservoir rate is numerically q_water, krw=1, ct=cw+cr.
    Single-phase water does not call the Peng-Robinson model.
    In CSV files single_fluid_code is 0 for two-phase, 1 for CO2, 2 for water.
    Without prompts:
        python co2_bhp_multiwell.py --defaults --phase single --years 30
        python co2_bhp_multiwell.py --defaults --phase two --years 30
    Existing saved configurations default to the original two-phase mode.

    Single-phase CO2 means an initially CO2-filled homogeneous reservoir, krg=1.
    It uses the infinite-acting radial line-source E1 solution with Bg fixed
    at 0.0005690187 rb/scf. CO2 density and cg are fixed at the Peng-Robinson
    values at the initial reservoir pressure and specified temperature.
    It does not model injection displacing brine. No Corey curves, saturation
    balance, evaporation, or moving interfaces are evaluated in this mode.
    The line-source expression uses the classical slightly-compressible kernel
    with constant gas properties.
    Reference: https://nrap.gitlab.io/orion/pressure_models/radial_flow.html

    Two phases retains the supplied three-zone CO2-brine calculation, its
    physical defaults and equations, and cubic/quadratic Corey options.
    Phase changes here select independent model runs, not changes mid-run.
    Two-phase-only CSV fields are blank in single-phase mode.

ORIGINAL TWO-PHASE METHOD AND OUTPUT CONVENTIONS

OBSERVATION AFTER SHUT-IN (ALL PHASE OPTIONS)
    In the notebook grid, set Post-shut-in observation to Yes and enter a
    positive duration and the desired reporting years after shut-in.
    In the console, choose 1 for injection only, 2 for annual observation,
    or 3 to enter selected years after shut-in.
    For example, 30 injection years and observation years
    0, 0.5, 1, 5, 10 give elapsed years 30, 30.5, 31, 35, and 40.
    A blank year list reports each whole year and the exact period endpoint.
    An observation period of 0 disables the shut-in calculation.
    Example:
        python co2_bhp_multiwell.py --defaults --phase two --years 30 --observation-period 10 --observation-years 0,0.5,1,5,10
    Observation is available for single-phase water, single-phase CO2, and
    two-phase CO2-brine. The solver starts from the final pressure profile.
    Single-phase cases use one homogeneous zone with their existing fixed
    mobility and total compressibility; the injection equations are unchanged.
    The two-phase observation solver starts from the final three-zone pressure profile.
    It holds zone radii, mobilities and storage fixed at shut-in and solves
    radial pressure diffusion at zero well flow. Observation year 0 reports
    the well pressure just after shut-in, with the flowing skin drop removed.
    This is a fixed-zone pressure-falloff approximation.

INSTALL
    python -m pip install numpy scipy matplotlib

RUN IN JUPYTER / COLAB / A NOTEBOOK CELL
    %run co2_bhp_multiwell.py
    The notebook displays the input grid. It requires ipywidgets
    (install with %pip install ipywidgets in a notebook cell if needed).
    Alternatively, paste the complete script into a cell and run it.
    To use the text prompts from a notebook, call main([]).

RUN INTERACTIVELY (press Enter to retain a displayed default)
    python co2_bhp_multiwell.py

RUN THE CUBIC COREY CASE WITHOUT PROMPTS
    python co2_bhp_multiwell.py --defaults --years 30

REUSE OR EDIT THE INPUTS SAVED BY A PREVIOUS RUN
    python co2_bhp_multiwell.py --config co2_bhp_corey3_results/inputs_used.json --years 50

OUTPUTS
    annual_summary.csv       Main annual inputs and results.
    all_calculations.csv     Every annual intermediate calculation.
    first_year_detail.csv    Initial state and detailed BHP samples through year 1.
    observation_summary.csv Selected post-shut-in times in two-phase mode.
    inputs_used.json         Inputs, years and calculation conventions.
    bhp_vs_year.png          Optional plot, if matplotlib is installed.

METHOD
    Default gas and water Corey exponents are both 3. The leading front solves:
        (M_lambda - 1)*sf**3 + 3*sf - 2 = 0, with 0 < sf < 1.
        F3 = (sf + 2) / (3*sf*(1 - Swr)).
        rg = sqrt(rw**2 + Vr_ft3*F3/(pi*phi*h)).
    sf is normalized front saturation; Sg_front = (1 - Swr)*sf.
    Zone 2 representative saturation is still calculated by the supplied mass
    balance and is used to calculate krg2 and krw2 with exponent 3.
    The existing evaporation closure is retained:
        rd = sqrt(rw**2 + alpha_d*Vr_ft3/(pi*phi*h)).
    Setting BOTH Corey exponents to 2 restores the consistent quadratic front
    for comparison. Other exponent pairs are rejected by this implementation.
    A saved configuration retains its explicit exponents; edit both to 3 to
    use the cubic model with a configuration from the previous script.

    In SINGLE-WELL mode: M = 1 and N1 = 1 constant-rate period starting at t = 0.
    Temperature and supplied viscosities, rock/brine properties, permeability,
    and porosity remain constant. One common k and phi apply to all zones.
    Each year solves P = initial_pressure + TOTAL_delta_p(year, P).
    The preceding BHP is the initial pressure guess, not a frozen property state.
    Time in the front and pressure equations is cumulative: t = n years.
    BHP(n) = initial_pressure + TOTAL_delta_p(n).
    Annual_gain(n) = BHP(n) - BHP(n-1).
    The total pressure increase is NOT added again to the previous BHP.
    Within-year pressure iterations update all pressure-dependent quantities.
    Elapsed time and injected standard volume/mass stay fixed during the solve.
    Results are accepted only when the pressure residual is below 1e-4 psi.
    Plots always include the exact initial state: time = 0 and BHP = initial P.
    Extra first-year points use the same converged equations at subdaily times
    from 1 second to 1 day, then daily to the exact one-year endpoint.
    Single-phase water uses 241 logarithmically spaced samples from 1 second
    to 1 day, followed by six-hour sampling through the end of year 1.
    Later years retain annual reporting. The plot also expands the first year.
    Both panels mark first-year checkpoints at 0, 1 second, 1 minute, 1 hour,
    1 day, 30 days, and 1 year at their actual elapsed times.
    BHP ticks use regular 100-psi intervals for the CO2 plots. For single-phase
    water, pressure ticks are spaced according to the calculated range and
    include the initial pressure. The full-period plot normally uses 2-year ticks.

    The pure-CO2 Peng-Robinson model gives cg and the two-phase branch's Bg.
    In the two-phase branch, CO2 density is calculated at each pressure evaluation:
        rho_g(p,T) = p * M_CO2 / (Z(p,T) * R * T).
    Pressure and temperature are absolute; consistent SI units are used inside
    the density function, which returns lb/ft^3. Z is the existing PR result.
    CO2 density is not an input, including at the initial state.
    In the two-phase branch, the standard-density mass reference comes from
    the initial EOS density and Bg.
    In the two-phase branch, density at the converged BHP is also reported.

    The blue-cancelled water-vapor factor remains omitted: yw = aw*Psat/P.
    Zone 2 gas saturation is calculated by mass balance, not prescribed as 0.45.
    Reference mobility = k*krg1/mug; reference storage = phi*(cg+cr).
    The pressure prefactor retains intrinsic k, so its matching dimensionless
    pressure is pD_intrinsic = pD_gas_reference / krg1. Skin is then added as
    shown in the supplied pressure equation.

    Front radii retain the supplied representative-pressure approximation;
    this is not a spatially resolved coupled displacement/evaporation model.
    The equations have not been fitted to simulation.
    All pressure inputs are ABSOLUTE psia. One year is 365.25 days.

DEPENDENCIES
    numpy and scipy are required. matplotlib is optional for the plot.
    ipywidgets is used only for the notebook input form. The browser form
    uses Python's standard library and does not need notebook widgets.
"""

import argparse
import csv
import html
import json
import math
import sys
from dataclasses import asdict, dataclass, fields, replace
from functools import lru_cache
from pathlib import Path
# In Jupyter, run %pip install ipywidgets in a separate cell if needed.
try:
    import numpy as np
    from scipy.integrate import solve_ivp
    from scipy.optimize import brentq
    from scipy.sparse import diags
    from scipy.special import exp1
except ImportError as exc:
    raise SystemExit(
        "Required package missing. Install with:\n"
        "    python -m pip install numpy scipy\n"
        "Optional plotting: python -m pip install matplotlib"
    ) from exc


# Constants supplied in the equation images; these are not fitted inputs.
CO2_PC_PA = 7.3773e6
CO2_TC_K = 304.1282
CO2_OMEGA = 0.22394
P_SC_PSIA = 14.696
T_SC_F = 60.0
WATER_TC_K = 647.096
WATER_PC_MPA = 22.064
WATER_A = (-7.85951783, 1.84408259, -11.7866497,
           22.6807411, -15.9618719, 1.80122502)
WATER_POWERS = (1.0, 1.5, 3.0, 3.5, 4.0, 7.5)
MW_WATER = 18.01528
MW_CO2 = 44.0095
MW_SALT_KG_MOL = 0.0584428
WATER_MOLES_KG = 55.508
DAYS_PER_YEAR = 365.25
FT3_PER_BBL = 539.0 / 96.0
PA_PER_PSI = 6894.757293168
R_UNIVERSAL_J_MOL_K = 8.31446261815324
KG_M3_TO_LB_FT3 = 0.3048**3 / 0.45359237
M2_PER_MD = 9.869233e-16
PA_S_PER_CP = 0.001
M_PER_FT = 0.3048
PRESSURE_COEFFICIENT = 141.2
TIME_COEFFICIENT_YEARS = (
    M2_PER_MD * PA_PER_PSI * DAYS_PER_YEAR * 86400.0
    / (PA_S_PER_CP * M_PER_FT**2)
)

# Numerical convergence settings; these do not change the physical inputs.
PRESSURE_TOLERANCE_PSI = 1e-4
MAX_PRESSURE_ITERATIONS = 100
SINGLE_PHASE_WATER_BW_RB_STB = 1.0
SINGLE_PHASE_CO2_BG_RB_SCF = 0.0005690187

# Solubility units: pressure in bar, molar volume in cm^3/mol, mass in kg/mol.
PSI_TO_BAR = PA_PER_PSI / 1e5
R_BAR_CM3 = R_UNIVERSAL_J_MOL_K * 10.0
M_CO2 = MW_CO2 / 1000.0
M_NACL = MW_SALT_KG_MOL
M_H2O = MW_WATER / 1000.0
WATER_MOLES_PER_KG = 1.0 / M_H2O


@dataclass
class Inputs:
    """User-editable reservoir and operating inputs, in the displayed units."""
    q_Mscf_day: float = 150.0
    k_mD: float = 50.0
    h_ft: float = 20.0
    rw_ft: float = 0.55
    porosity: float = 0.20
    initial_pressure_psia: float = 3500.0
    temperature_F: float = 200.0
    mu_water_cP: float = 0.30
    brine_standard_density_lb_ft3: float = 63.878
    Swr: float = 0.55
    rock_compressibility_per_psi: float = 4.2e-6
    krg_endpoint: float = 0.65
    krw_endpoint: float = 1.00
    krg_zone1: float = 0.65
    corey_n_gas: float = 3.0
    corey_n_water: float = 3.0
    skin: float = 0.0

    phase_mode: str = "two"
    single_phase_fluid: str = "co2"
    water_rate_stb_day: float = 150.0
    # Retained only for compatibility with older configurations; not editable.
    water_Bw_rb_stb: float = SINGLE_PHASE_WATER_BW_RB_STB
    observation_period_years: float = 0.0
    observation_years: str = ""
    include_evaporation: bool = True
    include_dissolution: bool = False  # two-phase equilibrium CO2 dissolution in Zone 2

    def validate(self):
        if self.phase_mode not in PHASE_LABELS:
            raise ValueError("phase_mode must be 'single' or 'two'.")
        if self.single_phase_fluid not in ("water", "co2"):
            raise ValueError("single_phase_fluid must be 'water' or 'co2'.")
        if not isinstance(self.include_evaporation, bool):
            raise ValueError("include_evaporation must be True or False.")
        if not isinstance(self.include_dissolution, bool):
            raise ValueError("include_dissolution must be True or False.")
        observation_schedule(self.observation_period_years, self.observation_years)
        if is_water_mode(self):
            # Enforce the requested fixed factor even when loading old inputs.
            self.water_Bw_rb_stb = SINGLE_PHASE_WATER_BW_RB_STB
        active_names = input_names_for_phase(self.phase_mode, self.single_phase_fluid)
        for name in active_names:
            value = getattr(self, name)
            if isinstance(value, bool) or not isinstance(value, (int, float)):
                raise ValueError(f"{name} must be numeric.")
            if not math.isfinite(value):
                raise ValueError(f"{name} must be finite.")
        for name in (
            "q_Mscf_day", "k_mD", "h_ft", "rw_ft", "initial_pressure_psia",
            "mu_water_cP",
            "brine_standard_density_lb_ft3", "corey_n_gas", "corey_n_water",
            "water_rate_stb_day", "water_Bw_rb_stb",
        ):
            if name in active_names and getattr(self, name) <= 0:
                raise ValueError(f"{name} must be greater than zero.")
        if not 0 < self.porosity < 1:
            raise ValueError("porosity must be strictly between 0 and 1.")
        for name in ("Swr",):
            if name in active_names and not 0 <= getattr(self, name) < 1:
                raise ValueError(f"{name} must satisfy 0 <= value < 1.")
        for name in ("krg_endpoint", "krw_endpoint", "krg_zone1"):
            if name in active_names and not 0 < getattr(self, name) <= 1:
                raise ValueError(f"{name} must satisfy 0 < value <= 1.")
        for name in ("rock_compressibility_per_psi",):
            if name in active_names and getattr(self, name) < 0:
                raise ValueError(f"{name} cannot be negative.")
        if self.phase_mode == "two" and (self.corey_n_gas, self.corey_n_water) not in ((2.0, 2.0), (3.0, 3.0)):
            raise ValueError(
                "Set both Corey exponents to 3 for the cubic model, or both "
                "to 2 for the quadratic comparison. Other exponent pairs "
                "require a different front-saturation derivation."
            )
        temperature_K = (self.temperature_F + 459.67) * 5.0 / 9.0
        if temperature_K <= 0:
            raise ValueError("Absolute reservoir temperature must be positive.")
        if self.phase_mode == "two" or is_water_mode(self):
            water_properties(self.initial_pressure_psia, self)
        if not is_water_mode(self):
            state = pr_state(self.initial_pressure_psia, self.temperature_F)
            rho = calculate_co2_density(self.initial_pressure_psia, self.temperature_F, state["Z"])
            co2_viscosity(self.temperature_F, rho)
        if self.phase_mode == "two" and not temperature_K < WATER_TC_K:
            raise ValueError(
                "The supplied water-saturation equation requires "
                "0 < absolute temperature < 647.096 K."
            )
        if self.phase_mode == "two" and self.include_dissolution:
            calculate_solubility(self.initial_pressure_psia, self.temperature_F,
                                 water_properties(self.initial_pressure_psia, self)["salt_mass_fraction"])


PHASE_LABELS = {
    "single": "Single-phase CO2",
    "two": "Two-phase CO2-brine (original three-zone model)",
}
TWO_PHASE_ONLY = frozenset({
    "mu_water_cP", "brine_standard_density_lb_ft3", "Swr",
    "krg_endpoint", "krw_endpoint",
    "krg_zone1", "corey_n_gas", "corey_n_water",
})
OBSERVATION_INPUTS = {"observation_period_years", "observation_years"}


def is_water_mode(p):
    return p.phase_mode == "single" and p.single_phase_fluid == "water"


def model_label(p):
    if p.phase_mode == "two":
        return PHASE_LABELS["two"]
    return "Single-phase water" if is_water_mode(p) else "Single-phase CO2"


def input_names_for_phase(phase, single_fluid="co2"):
    """Numerical inputs used by the chosen model; unused fields are hidden."""
    if phase not in PHASE_LABELS or single_fluid not in ("co2", "water"):
        raise ValueError("Select single/two phases and water/co2 for single phase.")
    water_names = (
        "water_rate_stb_day", "k_mD", "h_ft", "rw_ft",
        "porosity", "initial_pressure_psia", "temperature_F", "mu_water_cP",
        "brine_standard_density_lb_ft3", "rock_compressibility_per_psi",
        "skin",
    )
    if phase == "single" and single_fluid == "water":
        return water_names
    return tuple(
        item.name for item in fields(Inputs)
        if item.name not in {"phase_mode", "single_phase_fluid", "water_rate_stb_day", "water_Bw_rb_stb", "include_evaporation", "include_dissolution"}
        and item.name not in OBSERVATION_INPUTS
        and (phase == "two" or item.name not in TWO_PHASE_ONLY)
    )


PROMPTS = {
    "water_rate_stb_day": "Surface water injection rate (STB/day)",
    "water_Bw_rb_stb": "Water formation-volume factor (fixed at 1.0 rb/STB)",
    "q_Mscf_day": "Surface injection rate (Mscf/day; 150 means 150,000 scf/day)",
    "k_mD": "Permeability in every zone (mD)",
    "h_ft": "Reservoir thickness (ft)",
    "rw_ft": "Well radius (ft)",
    "porosity": "Porosity in every zone (fraction)",
    "initial_pressure_psia": "Initial absolute pressure (psia)",
    "temperature_F": "Constant reservoir temperature (deg F)",
    "mu_water_cP": "Water viscosity (cP)",
    "brine_standard_density_lb_ft3": "Brine density at 60 F and 14.696 psia (lb/ft^3)",
    "Swr": "Irreducible water saturation Swr",
    "rock_compressibility_per_psi": "Rock compressibility (1/psi)",
    "krg_endpoint": "Gas endpoint relative permeability krg0",
    "krw_endpoint": "Water endpoint relative permeability krw0",
    "krg_zone1": "Zone 1 gas relative permeability krg1",
    "corey_n_gas": "Gas Corey exponent (3; or 2 with matching water exponent)",
    "corey_n_water": "Water Corey exponent (must match gas exponent)",
    "skin": "Skin factor",
}


# Background-property references:
# Fenghour et al. (1998), DOI 10.1063/1.556013, Eqs. 3--8, Tables 1 and 3.
# Driesner (2007), DOI 10.1016/j.gca.2007.05.026, liquid molar-volume mapping;
# independently checkable implementation: MOOSE BrineFluidProperties::rho_from_p_T_X.
# IAPWS R7-97(2012), Eq. 7 and Tables 2--4 (liquid-water Region 1).
# McCain standard-density equation is the relation supplied with this request.
_IF97_REGION1 = (
    (0,-2,.14632971213167), (0,-1,-.84548187169114),
    (0,0,-3.7563603672040), (0,1,3.3855169168385),
    (0,2,-.95791963387872), (0,3,.15772038513228),
    (0,4,-.016616417199501), (0,5,.00081214629983568),
    (1,-9,.00028319080123804), (1,-7,-.00060706301565874),
    (1,-1,-.018990068218419), (1,0,-.032529748770505),
    (1,1,-.021841717175414), (1,3,-.000052838357969930),
    (2,-3,-.00047184321073267), (2,0,-.00030001780793026),
    (2,1,.000047661393906987), (2,3,-.0000044141845330846),
    (2,17,-7.2694996297594e-16), (3,-4,-.000031679644845054),
    (3,0,-.0000028270797985312), (3,6,-8.5205128120103e-10),
    (4,-5,-.0000022425281908000), (4,-2,-.00000065171222895601),
    (4,10,-1.4341729937924e-13), (5,-8,-.00000040516996860117),
    (8,-11,-1.2734301741641e-9), (8,-6,-1.7424871230634e-10),
    (21,-29,-6.8762131295531e-19), (23,-31,1.4478307828521e-20),
    (29,-38,2.6335781662795e-23), (30,-39,-1.1947622640071e-23),
    (31,-40,1.8228094581404e-24), (32,-41,-9.3537087292458e-26),
)


def _number(value):
    """Return a float for scalar properties and an ndarray for cell properties."""
    value = np.asarray(value, dtype=float)
    return float(value) if value.ndim == 0 else value


@lru_cache(maxsize=64)
def salinity_from_standard_density(rho_standard_lb_ft3):
    """Infer NaCl-equivalent composition from the supplied standard density.

    rho_sc=62.368+0.438603*S+0.00160074*S^2, where S is WEIGHT PERCENT.
    The stable positive-root expression avoids subtraction at low salinity.
    This equation must never be applied to pressure-compressed reservoir density.
    """
    if not math.isfinite(rho_standard_lb_ft3) or rho_standard_lb_ft3 < 62.368:
        raise ValueError("Standard brine density must be at least 62.368 lb/ft3 for the supplied McCain relation.")
    delta = rho_standard_lb_ft3 - 62.368
    wt_percent = 2.0*delta / (
        .438603 + math.sqrt(.438603**2 + 4*.00160074*delta)
    )
    w = wt_percent / 100.0
    if not 0 <= w <= .26:
        raise ValueError("The implemented aqueous-brine backend requires NaCl mass fraction 0--0.26.")
    mw_water = MW_WATER/1000.0
    moles_salt = w/MW_SALT_KG_MOL
    moles_water = (1-w)/mw_water
    molality = w/(MW_SALT_KG_MOL*(1-w))
    return {
        "salt_mass_fraction": w,
        "salinity_wt_percent": wt_percent,
        "salinity_ppm": w*1e6,
        "x_NaCl": moles_salt/(moles_salt+moles_water),
        "salt_molality": molality,
        "water_activity": WATER_MOLES_KG/(WATER_MOLES_KG+2*molality),
    }


def _water97_liquid_density(pressure_Pa, temperature_K):
    """IAPWS-IF97 Region 1 density, kg/m3; scalar or broadcast arrays.

    v=R*T*gamma_pi/pstar, with R=461.526 J/(kg K), pstar=16.53 MPa.
    This is only the compressed-liquid region, not the full IF97 formulation.
    """
    P, T = np.broadcast_arrays(np.asarray(pressure_Pa, float), np.asarray(temperature_K, float))
    if (not np.isfinite(P).all() or not np.isfinite(T).all()
            or np.any(T < 273.15) or np.any(T > 623.15)
            or np.any(P < 1.0e5) or np.any(P > 1.0e8)):
        raise ValueError("Brine backend requires 0.1--100 MPa and mapped liquid-water temperature 273.15--623.15 K.")
    tau_sat = 1-T/WATER_TC_K
    psat = WATER_PC_MPA*1e6*np.exp(
        WATER_TC_K/T*sum(a*tau_sat**power for a,power in zip(WATER_A,WATER_POWERS))
    )
    if np.any(P < psat*(1-1e-7)):
        raise ValueError("The Driesner mapped-water state is not compressed liquid; this backend cannot evaluate it.")
    x, y = 7.1-P/16.53e6, 1386.0/T-1.222
    gp = np.zeros_like(P)
    for I,J,n in _IF97_REGION1:
        if I:
            gp += -n*I*x**(I-1)*y**J
    density = 16.53e6/(461.526*T*gp)
    if np.any(density <= 0) or not np.isfinite(density).all():
        raise ValueError("IAPWS liquid-water density is invalid.")
    return _number(density)


def brine_density_kg_m3(pressure_Pa, temperature_K, salt_mass_fraction):
    """Driesner liquid molar-volume mapping, backed by IF97 Region 1.

    P is converted to bar; composition is converted to NaCl MOLE fraction.
    rho_brine = rho_water(P,Tv) * M_brine/M_water. No CO2 dissolution.
    Returns density and the mapped water temperature used by the correlation.
    """
    w = float(salt_mass_fraction)
    if not 0 <= w <= .26:
        raise ValueError("NaCl mass fraction must be between 0 and 0.26.")
    P = np.asarray(pressure_Pa, float)
    if not np.isfinite(P).all() or np.any(P < 1e5) or np.any(P > 1e8):
        raise ValueError("The implemented brine backend supports 0.1--100 MPa.")
    pbar = P*1e-5
    p2, p3 = pbar*pbar, pbar*pbar*pbar
    mw = MW_WATER/1000.0
    x = (w/MW_SALT_KG_MOL)/(w/MW_SALT_KG_MOL+(1-w)/mw)
    n11 = -54.2958-45.7623*np.exp(-9.44785e-4*pbar)
    n21 = -2.6142-2.39092e-4*pbar
    n22 = .0356828+4.37235e-6*pbar+2.0566e-9*p2
    n1x1 = 330.47+.942876*np.sqrt(pbar)+.0817193*pbar-2.47556e-8*p2+3.45052e-10*p3
    n2x1 = -.0370751+.00237723*np.sqrt(pbar)+5.42049e-5*pbar+5.84709e-9*p2-5.99373e-13*p3
    n12 = -n1x1-n11
    n20 = 1-n21*np.sqrt(n22)
    n23 = n2x1-n20-n21*np.sqrt(1+n22)
    n1 = n1x1+n11*(1-x)+n12*(1-x)**2
    n2 = n20+n21*np.sqrt(x+n22)+n23*x
    Tv = n1+n2*(temperature_K-273.15)+273.15
    molar_mass = 1/(w/MW_SALT_KG_MOL+(1-w)/mw)
    rho = np.asarray(_water97_liquid_density(P,Tv))*molar_mass/mw
    return _number(rho), _number(Tv)


def water_properties(pressure_psia, p):
    """Calculated saline-water density and isothermal compressibility.

    cw=(1/rho)*(d rho/dP)|T,w. Central differences hold composition fixed.
    A one-sided second-order stencil is used only at a pressure-domain edge.
    The previous fixed Bw=1 convention is deliberately retained separately.
    """
    P = np.asarray(pressure_psia,float)*PA_PER_PSI
    T = (p.temperature_F+459.67)*5.0/9.0
    salt = salinity_from_standard_density(p.brine_standard_density_lb_ft3)
    w = salt["salt_mass_fraction"]
    rho, Tv = brine_density_kg_m3(P,T,w)
    rho = np.asarray(rho)
    h = np.maximum(100.0,1e-4*P)
    lo, hi = 1e5,1e8
    forward, backward = P-h < lo, P+h > hi
    # Clipped side points allow one vectorized evaluation; one-sided entries
    # are replaced below, so clipped central stencils are never used as cw.
    rp = np.asarray(brine_density_kg_m3(np.minimum(P+h,hi),T,w)[0])
    rm = np.asarray(brine_density_kg_m3(np.maximum(P-h,lo),T,w)[0])
    derivative = (rp-rm)/(2*h)
    if np.any(forward):
        r2 = np.asarray(brine_density_kg_m3(np.minimum(P+2*h,hi),T,w)[0])
        derivative = np.where(forward,(-3*rho+4*rp-r2)/(2*h),derivative)
    if np.any(backward):
        r2 = np.asarray(brine_density_kg_m3(np.maximum(P-2*h,lo),T,w)[0])
        derivative = np.where(backward,(3*rho-4*rm+r2)/(2*h),derivative)
    cw = derivative/rho
    if np.any(cw <= 0) or not np.isfinite(cw).all():
        raise ValueError("Calculated brine isothermal compressibility is not positive and finite.")
    return {
        **salt,
        "rho_brine_kg_m3": _number(rho),
        "rho_water_lb_ft3": _number(rho*KG_M3_TO_LB_FT3),
        "brine_equivalent_water_temperature_K": _number(Tv),
        "cw_per_Pa": _number(cw), "cw_per_psi": _number(cw*PA_PER_PSI),
        "cw_derivative_step_Pa": _number(h),
        "salt_concentration_kg_m3": _number(w*rho),
        "Bw_rb_stb": SINGLE_PHASE_WATER_BW_RB_STB,
    }


def co2_viscosity(temperature_F, rho_g_lb_ft3):
    """Fenghour et al. (1998) background viscosity, scalar or arrays.

    T[K], rho[kg/m3] give microPa.s; divide by 1000 for cP. The critical
    enhancement is not included; near-critical states are rejected explicitly.
    """
    T = (temperature_F+459.67)*5.0/9.0
    rho = np.asarray(rho_g_lb_ft3,float)/KG_M3_TO_LB_FT3
    if not 200 <= T <= 1500 or np.any(rho < 0) or np.any(rho > 1400) or not np.isfinite(rho).all():
        raise ValueError("Fenghour viscosity requires 200--1500 K and CO2 density 0--1400 kg/m3.")
    if 300 < T < 310 and np.any((rho > 300)&(rho < 600)):
        raise ValueError("Near-critical CO2 requires a viscosity critical-enhancement model, which is not included.")
    ts = T/251.196
    a = (.235156,-.491266,.05211155,.05347906,-.01537102)
    mu0 = 1.00697*math.sqrt(T)/math.exp(sum(ai*math.log(ts)**i for i,ai in enumerate(a)))
    excess = (.004071119*rho+7.198037e-5*rho**2+2.411697e-17*rho**6/ts**3
              +2.971072e-23*rho**8-1.627888e-23*rho**8/ts)
    mu = mu0+excess
    if np.any(mu <= 0) or not np.isfinite(mu).all():
        raise ValueError("Calculated CO2 viscosity is invalid.")
    return {
        "mu_gas_cP": _number(mu*1e-3), "mu_gas_Pa_s": _number(mu*1e-6),
        "viscosity_density_kg_m3": _number(rho),
    }


def _live_co2_arrays(pressure_psia, temperature_F):
    """Vectorized PR density/cg and Fenghour viscosity for evolving grid cells.

    Cardano real roots are filtered by Z>B and lowest fugacity, as in pr_state.
    The scalar annual calculation continues to use the existing np.roots solver.
    """
    P = np.asarray(pressure_psia,float)
    T = (temperature_F+459.67)*5.0/9.0
    if np.any(P <= 0) or not np.isfinite(P).all():
        raise ValueError("Cell absolute pressures must be positive and finite.")
    Tr, Pr = T/CO2_TC_K,P*PA_PER_PSI/CO2_PC_PA
    kappa = .37464+1.54226*CO2_OMEGA-.26992*CO2_OMEGA**2
    alpha = (1+kappa*(1-math.sqrt(Tr)))**2
    A, B = .45724*alpha*Pr/Tr**2,.07780*Pr/Tr
    ca, cb, cc = B-1,A-2*B-3*B**2,-A*B+B**2+B**3
    u, v = cb-ca*ca/3,2*ca**3/27-ca*cb/3+cc
    disc = (v/2)**2+(u/3)**3
    root = np.sqrt(np.maximum(disc,0))
    single = np.cbrt(-v/2+root)+np.cbrt(-v/2-root)-ca/3
    q = np.maximum(-u/3,1e-100)  # prevent underflow in unused three-root branches
    angle = np.arccos(np.clip(-v/(2*q**1.5),-1,1))
    candidates = np.stack([
        np.where(disc < 0,2*np.sqrt(q)*np.cos((angle+2*math.pi*j)/3)-ca/3,single)
        for j in range(3)
    ])
    valid = candidates > B
    z = np.where(valid,candidates,B+1)
    sqrt2 = math.sqrt(2)
    log_phi = z-1-np.log(z-B)-A/(2*sqrt2*B)*np.log1p(2*sqrt2*B/(z+(1-sqrt2)*B))
    log_phi = np.where(valid,log_phi,np.inf)
    indices = np.argmin(log_phi,axis=0)
    Z = np.take_along_axis(candidates,np.expand_dims(indices,0),axis=0)[0]
    if not np.isfinite(np.min(log_phi,axis=0)).all():
        raise ValueError("No admissible PR cell root.")
    FZ = 3*Z**2+2*(B-1)*Z+A-2*B-3*B**2
    N = B*Z**2+(A-2*B-6*B**2)*Z-2*A*B+2*B**2+3*B**3
    cg = 1/P+N/(P*FZ*Z)
    rho = P*PA_PER_PSI*(MW_CO2/1000)/(Z*R_UNIVERSAL_J_MOL_K*T)
    mu = co2_viscosity(temperature_F,rho*KG_M3_TO_LB_FT3)["mu_gas_cP"]
    if np.any(cg <= 0) or not np.isfinite(cg).all():
        raise ValueError("Calculated cell gas compressibility is invalid.")
    return np.asarray(mu),cg


def pr_state(pressure_psia, temperature_F):
    """Solve the supplied PR cubic and select the lowest-fugacity real root."""
    if pressure_psia <= 0 or not math.isfinite(pressure_psia):
        raise ValueError("Peng-Robinson pressure must be finite and positive psia.")
    temperature_K = (temperature_F + 459.67) * 5.0 / 9.0
    Pr = pressure_psia * PA_PER_PSI / CO2_PC_PA
    Tr = temperature_K / CO2_TC_K
    kappa = 0.37464 + 1.54226 * CO2_OMEGA - 0.26992 * CO2_OMEGA**2
    alpha = (1 + kappa * (1 - math.sqrt(Tr)))**2
    A = 0.45724 * alpha * Pr / Tr**2
    B = 0.07780 * Pr / Tr
    ca = B - 1
    cb = A - 2*B - 3*B**2
    cc = -A*B + B**2 + B**3
    roots = np.roots([1.0, ca, cb, cc])
    candidates = [float(root.real) for root in roots
                  if abs(root.imag) < 1e-8 * max(1.0, abs(root.real))
                  and root.real > B]
    if not candidates:
        raise ValueError("No admissible real Peng-Robinson root with Z > B.")

    def ln_fugacity(Z):
        # log1p evaluates the same supplied log ratio accurately at low B.
        sqrt2 = math.sqrt(2.0)
        log_ratio = math.log1p(2*sqrt2*B / (Z + (1-sqrt2)*B))
        return Z - 1 - math.log(Z-B) - A/(2*sqrt2*B) * log_ratio

    Z = min(candidates, key=ln_fugacity)
    FZ = 3*Z**2 + 2*(B-1)*Z + A - 2*B - 3*B**2
    if abs(FZ) < 1e-14:
        raise ValueError("The PR pressure derivative is singular at this state.")
    N = B*Z**2 + (A-2*B-6*B**2)*Z - 2*A*B + 2*B**2 + 3*B**3
    dZ_dP = -N / (pressure_psia * FZ)
    cg = 1/pressure_psia - dZ_dP/Z
    if not math.isfinite(cg) or cg <= 0:
        raise ValueError("Gas compressibility is not positive at this PR state.")
    residual = Z**3 + ca*Z**2 + cb*Z + cc
    return {
        "temperature_K": temperature_K, "Pr": Pr, "Tr": Tr, "kappa": kappa,
        "alpha_PR": alpha, "A_PR": A, "B_PR": B, "Z": Z, "FZ": FZ,
        "N_PR": N, "dZ_dP_per_psi": dZ_dP, "cg_per_psi": cg,
        "PR_cubic_residual": residual,
    }


def calculate_co2_density(pressure_psia, temperature_F, Z=None):
    """Calculate pure-CO2 density from rho = p*M/(Z*R*T), in lb/ft^3.

    Inputs: absolute pressure [psia], temperature [deg F], and optional PR Z.
    Density is evaluated with p [Pa], M [kg/mol], R [J/(mol K)] and T [K],
    then converted from kg/m^3 to lb/ft^3. The existing PR solver supplies Z.
    """
    temperature_K = (temperature_F + 459.67) * 5.0 / 9.0
    if not math.isfinite(pressure_psia) or pressure_psia <= 0:
        raise ValueError("Density calculation requires positive absolute pressure.")
    if not math.isfinite(temperature_K) or temperature_K <= 0:
        raise ValueError("Density calculation requires positive absolute temperature.")
    if Z is None:
        Z = pr_state(pressure_psia, temperature_F)["Z"]
    if not math.isfinite(Z) or Z <= 0:
        raise ValueError("Density calculation requires a positive finite PR Z.")
    rho_kg_m3 = (
        pressure_psia * PA_PER_PSI * (MW_CO2 / 1000.0)
        / (Z * R_UNIVERSAL_J_MOL_K * temperature_K)
    )
    return rho_kg_m3 * KG_M3_TO_LB_FT3


def gas_properties(pressure_psia, temperature_F, Zsc):
    state = pr_state(pressure_psia, temperature_F)
    state["rho_g_lb_ft3"] = calculate_co2_density(
        pressure_psia, temperature_F, state["Z"]
    )
    state["Bg_rb_scf"] = (
        state["Z"] / Zsc * (temperature_F + 459.67) / (T_SC_F + 459.67)
        * P_SC_PSIA / pressure_psia / FT3_PER_BBL
    )
    state.update(co2_viscosity(temperature_F,state["rho_g_lb_ft3"]))
    return state


def corey_front_quantities(M_lambda, Swr, n_gas=3.0, n_water=3.0):
    """Return the leading-shock state and its radial front factor.

    s = Sg/(1-Swr) and fg(s) = M*s**n/(M*s**n + (1-s)**n).
    The leading front into gas-free brine satisfies sf*fg'(sf) = fg(sf).
    With n=3 this reduces to (M-1)*sf**3 + 3*sf - 2 = 0.
    Its derivative is 3*((M-1)*sf**2 + 1), positive on (0,1) for M>0,
    so the bracket [0,1] contains exactly one physical root, including M=1.
    """
    if not math.isfinite(M_lambda) or M_lambda <= 0:
        raise ValueError("Endpoint mobility ratio M_lambda must be finite and positive.")
    if not 0 <= Swr < 1:
        raise ValueError("Swr must satisfy 0 <= Swr < 1.")
    if n_gas == n_water == 3.0:
        sf = brentq(
            lambda value: (M_lambda-1.0)*value**3 + 3.0*value - 2.0,
            0.0, 1.0, xtol=1e-14, rtol=1e-14,
        )
        front_factor = (sf+2.0)/(3.0*sf*(1.0-Swr))
    elif n_gas == n_water == 2.0:
        sf = 1.0/math.sqrt(1.0+M_lambda)
        front_factor = (1.0+math.sqrt(1.0+M_lambda))/(2.0*(1.0-Swr))
    else:
        raise ValueError("Supported Corey exponent pairs are (3, 3) and (2, 2).")

    exponent = n_gas
    denominator = M_lambda*sf**exponent + (1.0-sf)**exponent
    fg = M_lambda*sf**exponent/denominator
    derivative = (
        exponent*M_lambda*sf**(exponent-1.0)*(1.0-sf)**(exponent-1.0)
        / denominator**2
    )
    tangent_error = sf*derivative-fg
    if abs(tangent_error) > 1e-9:
        raise ValueError("Leading-front saturation failed the shock-tangent condition.")
    return {
        "corey_n_gas": float(n_gas), "corey_n_water": float(n_water),
        "sf_normalized": sf, "Sg_front": (1.0-Swr)*sf,
        "fg_front": fg, "dfg_ds_front": derivative,
        "front_tangent_error": tangent_error,
        "gas_front_factor": front_factor,
    }


def _cubic_roots(a, b, c):
    """Real roots of z^3+a*z^2+b*z+c; only used in the validated range."""
    pp = b - a*a/3.0
    qq = 2.0*a**3/27.0 - a*b/3.0 + c
    disc = (qq/2.0)**2 + (pp/3.0)**3

    def cbrt(v):
        return math.copysign(abs(v)**(1.0/3.0), v)

    if disc > 0.0:
        sd = math.sqrt(disc)
        return [cbrt(-qq/2.0 + sd) + cbrt(-qq/2.0 - sd) - a/3.0]
    if pp >= 0.0:
        return [cbrt(-qq) - a/3.0]
    arg = (3.0*qq/(2.0*pp))*math.sqrt(-3.0/pp)
    theta = math.acos(max(-1.0, min(1.0, arg)))/3.0
    return [2.0*math.sqrt(-pp/3.0)*math.cos(theta-2.0*math.pi*k/3.0)
            - a/3.0 for k in range(3)]


def _ln_phi(volume_cm3_mol, pressure_bar, temperature_k, a_i, b_i):
    """Infinite-dilution modified-RK fugacity expression for CO2 or water."""
    v, tk = volume_cm3_mol, temperature_k
    ac = 7.54e7 - 4.13e4*tk
    bc = 27.8
    log_term = math.log1p(bc/v)
    return (math.log(v/(v-bc)) + b_i/(v-bc)
            - 2.0*a_i/(R_BAR_CM3*tk**1.5*bc)*log_term
            + ac*b_i/(R_BAR_CM3*tk**1.5*bc**2)
            * (log_term-bc/(v+bc))
            - math.log(pressure_bar*v/(R_BAR_CM3*tk)))


def _rk_volume(pressure_bar, temperature_k):
    """Pure-CO2 molar volume using the solubility model's modified RK EOS."""
    tk, pb = temperature_k, pressure_bar
    ac, bc = 7.54e7-4.13e4*tk, 27.8
    aa = ac*pb/(R_BAR_CM3**2*tk**2.5)
    bb = bc*pb/(R_BAR_CM3*tk)
    zz = _cubic_roots(-1.0, aa-bb-bb*bb, -aa*bb)
    volumes = [z*R_BAR_CM3*tk/pb for z in zz if z > bb]
    if not volumes:
        raise ValueError("No physical modified-RK molar-volume root found.")
    return min(volumes, key=lambda v: _ln_phi(v, pb, tk, ac, bc))


def _equilibrium_constants(temperature_k):
    tc = temperature_k-273.15
    kh = 10.0**(-2.209 + 0.03097*tc - 1.098e-4*tc**2 + 2.048e-7*tc**3)
    kc = 10.0**(1.189 + 0.01304*tc - 5.446e-5*tc**2)
    return kh, kc


def _salting_coefficient(pressure_bar, temperature_k, salt_molality):
    tk, pb, ms = temperature_k, pressure_bar, salt_molality
    lam = (-0.411370585 + 6.07632013e-4*tk + 97.5347708/tk
           - 0.0237622469*pb/tk + 0.0170656236*pb/(630.0-tk)
           + 1.41335834e-5*tk*math.log(pb))
    zeta = (3.36389723e-4 - 1.9829898e-5*tk + 2.12220830e-3*pb/tk
            - 5.24873303e-3*pb/(630.0-tk))
    return math.exp(2.0*lam*ms + zeta*ms**2)


def _equilibrium_at_volume(pressure_bar, temperature_k, xs, volume_cm3_mol):
    """Internal algebraic partitioning; separate volume permits EOS validation."""
    pb, tk = pressure_bar, temperature_k
    ms = xs/((1.0-xs)*M_NACL)
    kh, kc = _equilibrium_constants(tk)
    phi_c = math.exp(_ln_phi(volume_cm3_mol, pb, tk, 7.54e7-4.13e4*tk, 27.8))
    phi_h = math.exp(_ln_phi(volume_cm3_mol, pb, tk, 7.89e7, 18.18))
    delta_p = pb-1.0
    a = kh/(phi_h*pb)*math.exp(delta_p*18.1/(R_BAR_CM3*tk))
    b = phi_c*pb/(WATER_MOLES_PER_KG*kc)*math.exp(-delta_p*32.6/(R_BAR_CM3*tk))
    y_water = (1.0-b)/(1.0/a-b)
    x_co2_water = b*(1.0-y_water)
    if not (0.0 <= y_water < 1.0 and 0.0 <= x_co2_water < 1.0):
        raise ValueError("Partitioning result outside physical bounds.")
    mc_water = WATER_MOLES_PER_KG*x_co2_water/(1.0-x_co2_water)
    gamma = _salting_coefficient(pb, tk, ms)
    mc = mc_water/gamma
    x_mass = mc*M_CO2/(1.0 + ms*M_NACL + mc*M_CO2)
    return dict(mc_mol_per_kg_water=mc, Xco2_eq=x_mass,
                ms_mol_per_kg_water=ms, mc_pure_water=mc_water,
                gamma=gamma, phi_co2=phi_c, phi_water=phi_h,
                K0_co2=kc, K0_water=kh, A=a, B=b,
                x_co2_pure_water=x_co2_water, y_water_pure_system=y_water,
                volume_cm3_per_mol=volume_cm3_mol)


def calculate_solubility(p_psia, t_f, xs=0.034):
    """Return equilibrium molality [mol/kg water] and aqueous CO2 mass fraction.

    p_psia: absolute pressure [psia]. t_f: temperature [F].
    xs: NaCl mass fraction of CO2-FREE brine [kg salt/kg CO2-free brine].
    Spycher et al. (2003), Spycher and Pruess (2005) salting-out:
        https://doi.org/10.1016/S0016-7037(03)00273-4
        https://doi.org/10.1016/j.gca.2005.01.015
    """
    if not all(math.isfinite(v) for v in (p_psia, t_f, xs)):
        raise ValueError("All inputs must be finite numbers.")
    pb = p_psia*PSI_TO_BAR
    tc = (t_f-32.0)*5.0/9.0
    tk = tc+273.15
    if not 1.0 <= pb <= 600.0:
        raise ValueError("Dissolution pressure range is 1-600 bar absolute (14.504-8702.264 psia).")
    if not 35.0-1e-10 <= tc <= 99.0+1e-10:
        raise ValueError("Dissolution temperature range is 35-99 C (95-210.2 F).")
    if not 0.0 <= xs < 1.0:
        raise ValueError("NaCl mass fraction must be in [0, 1).")
    ms = xs/((1.0-xs)*M_NACL)
    if ms > 6.0:
        raise ValueError("NaCl molality exceeds the implemented limit of 6 mol/kg water.")
    volume = _rk_volume(pb, tk)
    result = _equilibrium_at_volume(pb, tk, xs, volume)
    result.update(pressure_bar=pb, temperature_c=tc, salt_mass_fraction=xs)
    return result


def dissolution_properties(pressure_psia, p, rho_brine_lb_ft3, salt_mass_fraction):
    """Equilibrium dissolved CO2 in Zone 2; OFF adds exactly zero inventory.

    PR continues to provide the free-phase PVT. The modified-RK EOS above is
    used only for the solubility correlation, as in Spycher et al. (2003).
    Garcia's apparent partial molar volume supplies the solution density
    (https://escholarship.org/uc/item/4q1422qm). The CO2-free brine density
    and salt fraction are the live background values at this pressure.
    """
    mc = xeq = cd = partial_rho = dx_dp = 0.0
    rho_aq = rho_brine_lb_ft3
    if p.include_dissolution:
        equilibrium = calculate_solubility(pressure_psia, p.temperature_F, salt_mass_fraction)
        mc, xeq = equilibrium["mc_mol_per_kg_water"], equilibrium["Xco2_eq"]
        tc = (p.temperature_F-32.0)*5.0/9.0
        vphi = 37.51-0.09585*tc+0.000874*tc**2-5.044e-7*tc**3
        partial_rho = M_CO2/(vphi*1e-6)*KG_M3_TO_LB_FT3
        rho_aq = 1.0/((1.0-xeq)/rho_brine_lb_ft3+xeq/partial_rho)
        cd = rho_aq*xeq
        # dXeq/dP: central difference, one-sided at the model pressure limits.
        step = max(1e-4*pressure_psia, 1e-3)
        high = min(pressure_psia+step, 600.0/PSI_TO_BAR)
        low = max(pressure_psia-step, 1.0/PSI_TO_BAR)
        if high <= low:
            raise ValueError("Cannot evaluate dXeq/dP at this pressure.")
        x_high = (calculate_solubility(high, p.temperature_F, salt_mass_fraction)["Xco2_eq"]
                  if high != pressure_psia else xeq)
        x_low = (calculate_solubility(low, p.temperature_F, salt_mass_fraction)["Xco2_eq"]
                 if low != pressure_psia else xeq)
        dx_dp = (x_high-x_low)/(high-low)
    return {"dissolution_enabled": int(p.include_dissolution),
            "CO2_molality_mol_kg_water": mc, "Xco2_eq": xeq,
            "rho_aq_lb_ft3": rho_aq, "Cd_lb_ft3_aqueous": cd,
            "rho_co2_apparent_lb_ft3": partial_rho, "dXeq_dP_per_psi": dx_dp}


def corey_fractional_flow(s, M_lambda, n):
    """fg(s) and dfg/ds for equal Corey exponents, s = Sg/(1-Swr)."""
    denominator = M_lambda*s**n+(1.0-s)**n
    fg = M_lambda*s**n/denominator
    derivative = n*M_lambda*s**(n-1.0)*(1.0-s)**(n-1.0)/denominator**2
    return fg, derivative


def dissolution_front_quantities(M_lambda, Swr, n_gas, n_water, a):
    """Leading gas shock into CO2-free brine when CO2 dissolves in brine.

    CO2 conservation across the shock (concentration rho_g*Sg+cd*(1-Sg),
    flux rho_g*fg+cd*(1-fg)) gives the shock speed
        F(S) = (fg + a)/(S + a),  a = cd/(rho_g - cd),  S = Sg.
    The physical shock is the maximum of F, where the chord from (-a,-a)
    is tangent to fg(Sg): dfg/dSg = (fg + a)/(Sf + a).
    a = 0 returns the original front quantities exactly.
    """
    if a == 0.0:
        return corey_front_quantities(M_lambda, Swr, n_gas, n_water)
    if not math.isfinite(a) or a < 0:
        raise ValueError("Dissolution retardation a = cd/(rho_g-cd) must be finite and >= 0.")
    if n_gas != n_water or n_gas not in (2.0, 3.0):
        raise ValueError("Supported Corey exponent pairs are (3, 3) and (2, 2).")
    n = n_gas
    width = 1.0-Swr

    def speed(s):
        return (corey_fractional_flow(s, M_lambda, n)[0]+a)/(width*s+a)

    def tangency(s):
        # Numerator of dF/ds; positive below the tangent point, negative above.
        fg, derivative = corey_fractional_flow(s, M_lambda, n)
        return derivative*(width*s+a)-width*(fg+a)

    grid = np.linspace(1e-9, 1.0, 20001)
    index = int(np.argmax(speed(grid)))
    if index == 0 or index == len(grid)-1:
        raise ValueError("Could not locate the dissolution-retarded gas front.")
    left, right = float(grid[index-1]), float(grid[index+1])
    if tangency(left) > 0 > tangency(right):
        sf = brentq(tangency, left, right, xtol=1e-15, rtol=1e-14)
    else:
        sf = float(grid[index])
    fg, derivative = corey_fractional_flow(sf, M_lambda, n)
    front_factor = (fg+a)/(width*sf+a)
    tangent_error = derivative/width-front_factor
    if abs(tangent_error) > 1e-7*front_factor:
        raise ValueError("Dissolution front failed the shock-tangent condition.")
    return {
        "corey_n_gas": float(n_gas), "corey_n_water": float(n_water),
        "sf_normalized": sf, "Sg_front": width*sf,
        "fg_front": fg, "dfg_ds_front": derivative,
        "front_tangent_error": tangent_error,
        "gas_front_factor": front_factor,
    }


def reference_two_phase_quantities(p):
    """Initial mass references; transport properties are recalculated per trial."""
    Zsc = pr_state(P_SC_PSIA,T_SC_F)["Z"]
    initial = gas_properties(p.initial_pressure_psia,p.temperature_F,Zsc)
    water = water_properties(p.initial_pressure_psia,p)
    rho_sc = initial["rho_g_lb_ft3"]*initial["Bg_rb_scf"]*FT3_PER_BBL
    TK = initial["temperature_K"]
    tau = 1-TK/WATER_TC_K
    psat = WATER_PC_MPA*math.exp(WATER_TC_K/TK*sum(
        a*tau**power for a,power in zip(WATER_A,WATER_POWERS)))
    return {
        "Zsc":Zsc,"initial_Bg_rb_scf":initial["Bg_rb_scf"],
        "initial_gas_density_calculated_lb_ft3":initial["rho_g_lb_ft3"],
        "initial_mu_gas_cP":initial["mu_gas_cP"],
        "initial_cw_per_psi":water["cw_per_psi"],
        "initial_water_density_lb_ft3":water["rho_water_lb_ft3"],
        "rho_sc_lb_scf":rho_sc,"water_Psat_psia":psat*1e6/PA_PER_PSI,
        "q_sc_scf_day":p.q_Mscf_day*1000.0,
        "time_coefficient_years":TIME_COEFFICIENT_YEARS,
    }


def calculate_two_phase_year(year, property_pressure, p, c):
    """Evaluate the supplied annual equations at one trial property pressure."""
    # 1. Current pressure-dependent Bg, cg and density.
    gas = gas_properties(property_pressure, p.temperature_F, c["Zsc"])
    Bg, cg = gas["Bg_rb_scf"], gas["cg_per_psi"]
    rho_g = gas["rho_g_lb_ft3"]
    mu_g = gas["mu_gas_cP"]
    water = water_properties(property_pressure,p)
    cw = water["cw_per_psi"]
    salt = water["salt_mass_fraction"]
    M_lambda = p.krg_endpoint*p.mu_water_cP/(p.krw_endpoint*mu_g)
    c = dict(c, **corey_front_quantities(M_lambda,p.Swr,p.corey_n_gas,p.corey_n_water),
             M_lambda=M_lambda,reference_mobility_mD_cP=p.k_mD*p.krg_zone1/mu_g)
    # DISSOLUTION ENTRY 1: equilibrium concentration at this trial pressure.
    dissolved = dissolution_properties(property_pressure, p, water["rho_water_lb_ft3"], salt)
    Cd = dissolved["Cd_lb_ft3_aqueous"]
    if p.include_dissolution and rho_g <= Cd:
        raise ValueError("Dissolution inventory requires rho_g > Cd at the trial pressure.")
    # DISSOLUTION ENTRY 2: the gas front must also saturate the brine it contacts,
    # so the shock tangent is drawn from (-a,-a), a = Cd/(rho_g-Cd).
    a_diss = Cd/(rho_g-Cd) if p.include_dissolution else 0.0
    if p.include_dissolution:
        c.update(dissolution_front_quantities(
            M_lambda, p.Swr, p.corey_n_gas, p.corey_n_water, a_diss))

    # 2. Cumulative injected volume, evaluated at the current property pressure.
    t_days = year*DAYS_PER_YEAR
    Vsc = c["q_sc_scf_day"]*t_days
    Vr_rb = Vsc*Bg
    Vr_ft3 = Vr_rb*FT3_PER_BBL

    # 3. Water vapor and evaporation, with the cancelled factor omitted.
    if p.include_evaporation:
        yw = water["water_activity"] * c["water_Psat_psia"] / property_pressure
        if not 0 <= yw < 1:
            raise ValueError("The supplied water-vapor expression gives yw outside [0,1).")
        ceq = MW_WATER/MW_CO2 * yw/(1-yw)
        # Water mass per brine volume; with dissolution the brine is CO2-saturated.
        water_content = (dissolved["rho_aq_lb_ft3"]*(1-dissolved["Xco2_eq"])*(1-salt)
                         if p.include_dissolution else water["rho_water_lb_ft3"]*(1-salt))
        alpha_d = rho_g*ceq / (
            water_content*p.Swr
            + rho_g*ceq*(1-p.Swr)
        )
    else:
        yw = ceq = alpha_d = 0.0

    # 4. Front radii measured from the well center.
    # For n=3, gas_front_factor is the newly derived cubic factor F3.
    # The existing evaporation expression for alpha_d and rd is retained.
    area_factor = math.pi*p.porosity*p.h_ft
    rg = math.sqrt(p.rw_ft**2 + Vr_ft3/area_factor*c["gas_front_factor"])
    rd = (math.sqrt(p.rw_ft**2 + alpha_d*Vr_ft3/area_factor)
          if p.include_evaporation else p.rw_ft)
    # No evaporation means no dry annulus. Keep the internal boundary at rw;
    # setting a center-based radius to zero would give negative pore volume.
    dry_zone_thickness = rd-p.rw_ft if p.include_evaporation else 0.0

    # 5. Zone volumes, masses and representative saturations.
    Vp1 = (area_factor*(rd**2-p.rw_ft**2)
           if p.include_evaporation else 0.0)
    Vp2 = area_factor*(rg**2-rd**2)
    if Vp2 <= 0:
        raise ValueError("The equations give a non-positive Zone 2 pore volume.")
    Minj = c["rho_sc_lb_scf"]*Vsc
    Mg1 = rho_g*Vp1
    # DISSOLUTION ENTRY 3: free + dissolved CO2 mass balance gives Sg2.
    if p.include_dissolution:
        # Minj = rho_g*Vp1 + rho_g*Sg2*Vp2 + Cd*(1-Sg2)*Vp2 (Welge average consistent with the retarded front).
        Sg2 = (Minj-Mg1-Cd*Vp2)/((rho_g-Cd)*Vp2)
        Sw2 = 1-Sg2
        Vg2 = Sg2*Vp2
        Mg2 = rho_g*Vg2
        Mdiss = Cd*Sw2*Vp2
    else:
        # Keep the original operations to preserve OFF results exactly.
        Mg2 = Minj-Mg1
        Vg2 = Mg2/rho_g
        Sg2 = Vg2/Vp2
        Sw2 = 1-Sg2
        Mdiss = 0.0
    Mfree = Mg1+Mg2
    if not (0 <= Sg2 <= 1-p.Swr and p.Swr <= Sw2 <= 1):
        raise ValueError(f"Calculated saturations violate the supplied limits: Sg2={Sg2}, Sw2={Sw2}.")
    x2 = Sg2/(1-p.Swr)
    krg2 = p.krg_endpoint*x2**p.corey_n_gas
    krw2 = p.krw_endpoint*(1-x2)**p.corey_n_water

    # DISSOLUTION ENTRIES 4 and 5: solubility storage in Zone 2 and brine flux into Zone 3.
    if p.include_dissolution:
        Xeq, rho_aq = dissolved["Xco2_eq"], dissolved["rho_aq_lb_ft3"]
        c_sol = (Sw2*rho_aq*dissolved["dXeq_dP_per_psi"]/(1-Xeq)
                 * (1/rho_g-1/dissolved["rho_co2_apparent_lb_ft3"]))
        beta = rho_aq*(1-Xeq)  # CO2-free brine mass per CO2-saturated volume
        rho_b = water["rho_water_lb_ft3"]
        zone3_flux_ratio = (beta*(1-c["fg_front"])
                            - c["gas_front_factor"]*(beta*(1-c["Sg_front"])-rho_b))/rho_b
        if not 0 < zone3_flux_ratio <= 1+1e-12:
            raise ValueError(f"Zone 3 brine flux ratio {zone3_flux_ratio:g} is outside (0, 1].")
    else:
        c_sol = 0.0
        zone3_flux_ratio = 1.0

    # 6. Zone mobilities and total compressibilities.
    mobilities = [
        p.k_mD*p.krg_zone1/mu_g,
        p.k_mD*(krg2/mu_g+krw2/p.mu_water_cP),
        p.k_mD/p.mu_water_cP,  # supplied Zone 3 krw = 1
    ]
    total_c = [
        cg+p.rock_compressibility_per_psi,
        (Sg2*cg+Sw2*cw+p.rock_compressibility_per_psi+c_sol if p.include_dissolution
         else Sg2*cg+Sw2*cw+p.rock_compressibility_per_psi),
        cw+p.rock_compressibility_per_psi,
    ]
    if any(value <= 0 for value in total_c):
        raise ValueError("Every zone total compressibility must be positive.")
    m = [value/c["reference_mobility_mD_cP"] for value in mobilities]
    c_star = [value/total_c[0] for value in total_c]  # common porosity cancels
    D = [mi/ci for mi, ci in zip(m, c_star)]

    # 7. Dimensionless time and interface/well arguments.
    rdD, rgD = rd/p.rw_ft, rg/p.rw_ft
    tD = TIME_COEFFICIENT_YEARS*p.k_mD*p.krg_zone1*year / (
        mu_g*p.porosity*p.rw_ft**2*total_c[0]
    )
    uw = 1/(4*(D[0] if p.include_evaporation else D[1])*tD)
    u1d = rdD**2/(4*D[0]*tD)
    u2d = rdD**2/(4*D[1]*tD)
    u2g = rgD**2/(4*D[1]*tD)
    u3g = rgD**2/(4*D[2]*tD)
    E1w, E1d1, E1d2, E1g2, E1g3 = (
        float(exp1(u)) for u in (uw, u1d, u2d, u2g, u3g)
    )

    # 8. Flux matching and pressure continuity coefficients.
    dry_exponent = u2d-u1d
    gas_exponent = u3g-u2g
    a3 = 0.0
    if p.include_evaporation:
        b1 = 1/(2*m[0])
        b2 = math.exp(dry_exponent)/(2*m[1])
        b3 = (zone3_flux_ratio*math.exp(dry_exponent+gas_exponent)/(2*m[2]) if p.include_dissolution
              else math.exp(dry_exponent+gas_exponent)/(2*m[2]))
        a2 = b3*E1g3-b2*E1g2
        a1 = a2+b2*E1d2-b1*E1d1
    else:
        # The absent dry region has no matching condition. Zone 2 begins at rw.
        b1 = a1 = dry_exponent = E1d1 = E1d2 = u1d = u2d = 0.0
        b2 = 1/(2*m[1])
        b3 = (zone3_flux_ratio*math.exp(gas_exponent)/(2*m[2]) if p.include_dissolution
              else math.exp(gas_exponent)/(2*m[2]))
        a2 = b3*E1g3-b2*E1g2

    # 9. Select the Zone 1 branch at the well and align the pressure reference.
    pD_gas = (a1+b1*E1w if p.include_evaporation else a2+b2*E1w)
    pD_intrinsic = pD_gas/p.krg_zone1
    q_reservoir = c["q_sc_scf_day"]*Bg
    delta_p = PRESSURE_COEFFICIENT*mu_g*q_reservoir / (p.k_mD*p.h_ft) * (
        pD_intrinsic+p.skin
    )
    BHP = p.initial_pressure_psia+delta_p
    annual_gain = BHP-property_pressure
    if BHP <= 0 or not math.isfinite(BHP):
        raise ValueError("The calculated BHP is non-positive or non-finite.")

    # 10. Reconciliation checks; these never feed the physical calculations.
    mass_error = Mfree+Mdiss-Minj
    # Dissolved gas has no free-phase volume: Mdiss/rho_g is an equivalent.
    volume_error = Vp1+Sg2*Vp2+Mdiss/rho_g-Vr_ft3
    dry_error = (a1+b1*E1d1-(a2+b2*E1d2) if p.include_evaporation else 0.0)
    gas_error = a2+b2*E1g2-(a3+b3*E1g3)
    if abs(mass_error) > 1e-9*max(1, Minj):
        raise ValueError("CO2 mass balance failed.")
    if abs(volume_error) > 1e-9*max(1, Vr_ft3):
        raise ValueError("Gas-volume balance failed.")
    if max(abs(dry_error), abs(gas_error)) > 1e-9*max(1, abs(pD_gas)):
        raise ValueError("Interface pressure continuity failed.")

    result = {
        "year": year, "P_used_psia": property_pressure, "t_days": t_days,
        **c, **gas, **water,
        "rho_g_lb_ft3": rho_g, "Vsc_scf": Vsc,
        "Vr_rb": Vr_rb, "Vr_ft3": Vr_ft3,
        "yw": yw, "ceq": ceq, "alpha_d_evaporation": alpha_d,
        "rg_ft": rg, "rd_ft": rd,
        "dry_zone_thickness_ft": dry_zone_thickness,
        "Vp1_ft3": Vp1, "Vp2_ft3": Vp2,
        "Minj_lb": Minj, "Mg1_lb": Mg1, "Mg2_lb": Mg2, "Vg2_ft3": Vg2,
        "Sg2": Sg2, "Sw2": Sw2, "x2": x2, "krg2": krg2, "krw2": krw2,
        "rdD": rdD, "rgD": rgD, "tD": tD,
        "uw": uw, "u1d": u1d, "u2d": u2d, "u2g": u2g, "u3g": u3g,
        "E1w": E1w, "E1d1": E1d1, "E1d2": E1d2,
        "E1g2": E1g2, "E1g3": E1g3,
        "dry_exponent": dry_exponent, "gas_exponent": gas_exponent,
        "b1": b1, "b2": b2, "b3": b3, "a1": a1, "a2": a2, "a3": a3,
        "pD_gas_reference": pD_gas, "pD_intrinsic_reference": pD_intrinsic,
        "q_reservoir_rb_day": q_reservoir,
        "total_delta_p_psi": delta_p, "annual_gain_psi": annual_gain,
        "BHP_psia": BHP, "mass_balance_error_lb": mass_error,
        "volume_balance_error_ft3": volume_error,
        "dry_interface_error": dry_error, "gas_interface_error": gas_error,
    }
    for zone in range(3):
        n = zone+1
        result[f"Lambda{n}_mD_cP"] = mobilities[zone]
        result[f"ct{n}_per_psi"] = total_c[zone]
        result[f"m{n}"] = m[zone]
        result[f"c{n}_star"] = c_star[zone]
        result[f"D{n}"] = D[zone]
    if p.include_dissolution:
        # Only with dissolution on, so the files without dissolution keep their columns.
        result.update(dissolved, Mfree_lb=Mfree, Mdiss_lb=Mdiss,
                      dissolved_fraction_of_injected=Mdiss/Minj,
                      free_gas_volume_ft3=Vp1+Sg2*Vp2,
                      dissolved_gas_equivalent_volume_ft3=Mdiss/rho_g,
                      dissolution_retardation_a=a_diss,
                      c_solubility_storage_per_psi=c_sol,
                      zone3_flux_ratio=zone3_flux_ratio,
                      zone3_brine_flux_rb_day=zone3_flux_ratio*q_reservoir)
    if not all(math.isfinite(value) for value in result.values()):
        raise ValueError("A calculated intermediate is non-finite.")
    return result


def reference_quantities(p):
    """Set initial inventory references, without freezing transport properties."""
    if p.phase_mode == "two":
        return {**reference_two_phase_quantities(p),"phase_count":2,"single_fluid_code":0}
    if is_water_mode(p):
        water = water_properties(p.initial_pressure_psia,p)
        return {
            "phase_count":1,"single_fluid_code":2,
            "reference_mobility_mD_cP":p.k_mD/p.mu_water_cP,
            "initial_Bw_rb_stb":SINGLE_PHASE_WATER_BW_RB_STB,
            "initial_water_density_lb_ft3":water["rho_water_lb_ft3"],
            "initial_cw_per_psi":water["cw_per_psi"],
            "q_water_stb_day":p.water_rate_stb_day,
            "water_mass_per_stb_lb":p.brine_standard_density_lb_ft3*FT3_PER_BBL,
            "time_coefficient_years":TIME_COEFFICIENT_YEARS,
        }
    Zsc = pr_state(P_SC_PSIA,T_SC_F)["Z"]
    initial = gas_properties(p.initial_pressure_psia,p.temperature_F,Zsc)
    return {
        "phase_count":1,"single_fluid_code":1,"Zsc":Zsc,
        "initial_Bg_rb_scf":SINGLE_PHASE_CO2_BG_RB_SCF,
        "initial_cg_per_psi":initial["cg_per_psi"],
        "initial_gas_density_calculated_lb_ft3":initial["rho_g_lb_ft3"],
        "initial_mu_gas_cP":initial["mu_gas_cP"],
        "rho_sc_lb_scf":calculate_co2_density(P_SC_PSIA,T_SC_F,Zsc),
        "q_sc_scf_day":p.q_Mscf_day*1000.0,
        "time_coefficient_years":TIME_COEFFICIENT_YEARS,
    }


def calculate_single_phase_year(year, property_pressure, p, c):
    """Homogeneous, CO2-filled, infinite-acting radial E1 approximation.

    krg=1, ct=cg+cr, tD=C*k*t/(mu_g*phi*rw^2*ct), u=1/(4*tD).
    dP=141.2*mu_g*q_res/(k*h)*(0.5*E1(u)+skin), field units.
    Bg is fixed, and cg and density are fixed at the initial reservoir state.
    Viscosity is calculated using a separate live PR density at every trial;
    fixed inventory properties do not supply the viscosity density.
    """
    gas = gas_properties(property_pressure,p.temperature_F,c["Zsc"])
    mu_g = gas["mu_gas_cP"]
    c = dict(c,reference_mobility_mD_cP=p.k_mD/mu_g)
    gas["cg_per_psi"] = c["initial_cg_per_psi"]
    gas["rho_g_lb_ft3"] = c["initial_gas_density_calculated_lb_ft3"]
    gas["Bg_rb_scf"] = c["initial_Bg_rb_scf"]
    ct = gas["cg_per_psi"] + p.rock_compressibility_per_psi
    if ct <= 0:
        raise ValueError("Single-phase total compressibility must be positive.")
    t_days = year*DAYS_PER_YEAR
    Vsc = c["q_sc_scf_day"]*t_days
    Vr_rb = Vsc*gas["Bg_rb_scf"]
    tD = TIME_COEFFICIENT_YEARS*p.k_mD*year / (
        mu_g*p.porosity*p.rw_ft**2*ct
    )
    uw = 1.0/(4.0*tD)
    E1w = float(exp1(uw))
    pD = 0.5*E1w
    q_reservoir = c["q_sc_scf_day"]*gas["Bg_rb_scf"]
    delta_p = PRESSURE_COEFFICIENT*mu_g*q_reservoir / (
        p.k_mD*p.h_ft
    )*(pD+p.skin)
    bhp = p.initial_pressure_psia + delta_p
    result = {
        "year": year, "P_used_psia": property_pressure, "t_days": t_days,
        **gas, **c, "Vsc_scf": Vsc, "Vr_rb": Vr_rb,
        "Vr_ft3": Vr_rb*FT3_PER_BBL, "Minj_lb": c["rho_sc_lb_scf"]*Vsc,
        "krg_single_phase": 1.0, "Lambda1_mD_cP": p.k_mD/mu_g,
        "ct1_per_psi": ct, "m1": 1.0, "c1_star": 1.0, "D1": 1.0,
        "tD": tD, "uw": uw, "E1w": E1w,
        "pD_gas_reference": pD, "pD_intrinsic_reference": pD,
        "q_reservoir_rb_day": q_reservoir,
        "total_delta_p_psi": delta_p, "annual_gain_psi": bhp-property_pressure,
        "BHP_psia": bhp,
    }
    if bhp <= 0 or not all(math.isfinite(value) for value in result.values()):
        raise ValueError("Single-phase calculation produced an invalid value.")
    return result


def calculate_single_phase_water_year(year, property_pressure, p, c):
    """Single-phase water in an initially water-filled infinite reservoir.

    Relative permeability is 1. Bw is fixed at 1, so q_res=q_water numerically.
    Uses the same radial E1 kernel and pressure iteration as the CO2 option.
    """
    water = water_properties(property_pressure, p)
    ct = water["cw_per_psi"] + p.rock_compressibility_per_psi
    t_days = year*DAYS_PER_YEAR
    q_reservoir = p.water_rate_stb_day*water["Bw_rb_stb"]
    tD = TIME_COEFFICIENT_YEARS*p.k_mD*year / (
        p.mu_water_cP*p.porosity*p.rw_ft**2*ct
    )
    uw = 1.0/(4.0*tD)
    E1w = float(exp1(uw))
    pD = 0.5*E1w
    delta_p = PRESSURE_COEFFICIENT*p.mu_water_cP*q_reservoir / (
        p.k_mD*p.h_ft
    )*(pD+p.skin)
    bhp = p.initial_pressure_psia + delta_p
    result = {
        "year": year, "P_used_psia": property_pressure, "t_days": t_days,
        **water, **c, "Vwater_stb": p.water_rate_stb_day*t_days,
        "Vr_rb": q_reservoir*t_days, "Vr_ft3": q_reservoir*t_days*FT3_PER_BBL,
        "Minj_lb": c["water_mass_per_stb_lb"]*p.water_rate_stb_day*t_days,
        "krw_single_phase": 1.0, "Lambda1_mD_cP": p.k_mD/p.mu_water_cP,
        "ct1_per_psi": ct, "m1": 1.0, "c1_star": 1.0, "D1": 1.0,
        "tD": tD, "uw": uw, "E1w": E1w,
        "pD_water_reference": pD, "pD_intrinsic_reference": pD,
        "q_reservoir_rb_day": q_reservoir,
        "total_delta_p_psi": delta_p, "annual_gain_psi": bhp-property_pressure,
        "BHP_psia": bhp,
    }
    if bhp <= 0 or not all(math.isfinite(value) for value in result.values()):
        raise ValueError("Single-phase water calculation produced an invalid value.")
    return result


def calculate_year(year, property_pressure, p, c):
    """Dispatch to one physical model; never combine their pressure terms."""
    if not math.isfinite(year) or year <= 0:
        raise ValueError("Elapsed time must be positive; use the initial state at t=0.")
    if is_water_mode(p):
        return calculate_single_phase_water_year(year, property_pressure, p, c)
    if p.phase_mode == "single":
        return calculate_single_phase_year(year, property_pressure, p, c)
    if p.phase_mode == "two":
        return calculate_two_phase_year(year, property_pressure, p, c)
    raise ValueError("Select phase_mode='single' or phase_mode='two'.")


def solve_year(year, previous_bhp, p, constants):
    """Close the pressure/property coupling at a fixed cumulative elapsed time.

    Fixed-point trials start from the preceding BHP. Once two trials bracket
    the pressure residual, Brent's method completes the solve without relying
    on fixed-point convergence. Every trial recalculates the complete set of
    annual equations; no trial advances time or adds injected mass.
    """
    evaluations = 0

    def evaluate(trial_pressure):
        nonlocal evaluations
        evaluations += 1
        try:
            trial_result = calculate_year(year, trial_pressure, p, constants)
        except (ValueError, OverflowError, ZeroDivisionError) as exc:
            raise ValueError(
                f"Property pressure {trial_pressure:.6f} psia: {exc}"
            ) from exc
        residual = trial_pressure-trial_result["BHP_psia"]
        return trial_result, residual

    trial_pressure = previous_bhp
    previous_trial = None
    previous_residual = None
    for _ in range(MAX_PRESSURE_ITERATIONS):
        result, residual = evaluate(trial_pressure)
        if abs(residual) < PRESSURE_TOLERANCE_PSI:
            break
        if previous_residual is not None and previous_residual*residual < 0:
            lower, upper = sorted((previous_trial, trial_pressure))

            def pressure_residual(pressure):
                return evaluate(pressure)[1]

            try:
                root = brentq(
                    pressure_residual, lower, upper,
                    xtol=1e-8, rtol=1e-12,
                    maxiter=MAX_PRESSURE_ITERATIONS,
                )
            except RuntimeError as exc:
                raise ValueError("Pressure/property solve did not converge.") from exc
            result, residual = evaluate(root)
            if abs(residual) >= PRESSURE_TOLERANCE_PSI:
                raise ValueError(
                    f"Pressure/property residual {residual:.6g} psi exceeds "
                    f"the {PRESSURE_TOLERANCE_PSI:g} psi tolerance."
                )
            break
        previous_trial, previous_residual = trial_pressure, residual
        trial_pressure = result["BHP_psia"]
    else:
        raise ValueError(
            f"Pressure/property solve did not converge after "
            f"{MAX_PRESSURE_ITERATIONS} fixed-point trials; "
            f"last residual was {residual:.6g} psi."
        )

    # Annual gain compares time levels, not the final nonlinear trial pressures.
    result["annual_gain_psi"] = result["BHP_psia"]-previous_bhp
    if is_water_mode(p):
        result["rho_water_at_BHP_lb_ft3"] = water_properties(result["BHP_psia"], p)["rho_water_lb_ft3"]
    elif p.phase_mode == "single":
        result["rho_g_at_BHP_lb_ft3"] = result["rho_g_lb_ft3"]
    else:
        result["rho_g_at_BHP_lb_ft3"] = calculate_co2_density(result["BHP_psia"], p.temperature_F)
    result["pressure_evaluations"] = evaluations
    result["pressure_residual_psi"] = residual
    return result


def run_model(p, years):
    """Solve pressure and properties together at each annual reporting time."""
    p.validate()
    if isinstance(years, bool) or not isinstance(years, int) or years < 1:
        raise ValueError("Number of years must be a positive integer.")
    constants = reference_quantities(p)
    pressure = p.initial_pressure_psia
    results = []
    for year in range(1, years+1):
        try:
            result = solve_year(year, pressure, p, constants)
        except (ValueError, OverflowError, ZeroDivisionError) as exc:
            raise ValueError(
                f"Year {year}, starting pressure {pressure:.6f} psia: {exc}"
            ) from exc
        results.append(result)
        pressure = result["BHP_psia"]  # next year's initial pressure guess
    return results, constants


SUMMARY_FIELDS = [
    "year", "phase_count", "single_fluid_code", "P_used_psia",
    "mu_gas_cP", "mu_gas_Pa_s", "viscosity_density_kg_m3", "cw_per_Pa",
    "rho_brine_kg_m3", "salt_mass_fraction", "salinity_wt_percent", "salinity_ppm",
    "x_NaCl", "salt_molality", "water_activity", "salt_concentration_kg_m3",
    "Bw_rb_stb", "cw_per_psi", "rho_water_lb_ft3", "rho_water_at_BHP_lb_ft3", "Bg_rb_scf", "cg_per_psi", "rho_g_lb_ft3",
    "rho_g_at_BHP_lb_ft3",
    "corey_n_gas", "corey_n_water", "sf_normalized", "Sg_front",
    "gas_front_factor", "rd_ft", "dry_zone_thickness_ft", "Vp1_ft3", "Mg1_lb",
    "rg_ft", "Sg2", "Sw2", "krg2", "krw2",
    "Lambda2_mD_cP",
    "pD_gas_reference", "pD_intrinsic_reference",
    "total_delta_p_psi", "annual_gain_psi", "BHP_psia",
    "pressure_evaluations", "pressure_residual_psi",
    "max_allowable_BHP_psia", "pressure_limit_status", "pressure_margin_psi", "pressure_exceedance_psi",
]


def calculate_first_year_detail(annual_results, p, constants):
    """Calculate plotting samples without changing the annual model results.

    Time zero is the prescribed initial condition, so the positive-time
    three-zone equations are not evaluated at t = 0. Every later sample is
    solved at its own cumulative elapsed time and injected standard mass.
    """
    water_mode = is_water_mode(p)
    if water_mode:
        initial_gas = water_properties(p.initial_pressure_psia, p)
        initial_gas["rho_water_at_BHP_lb_ft3"] = initial_gas["rho_water_lb_ft3"]
    elif p.phase_mode == "single":
        initial_gas = gas_properties(p.initial_pressure_psia,p.temperature_F,constants["Zsc"])
        initial_gas.update(
            cg_per_psi=constants["initial_cg_per_psi"],
            rho_g_lb_ft3=constants["initial_gas_density_calculated_lb_ft3"],
            rho_g_at_BHP_lb_ft3=constants["initial_gas_density_calculated_lb_ft3"],
            Bg_rb_scf=constants["initial_Bg_rb_scf"],
        )
    else:
        initial_gas = gas_properties(p.initial_pressure_psia, p.temperature_F, constants["Zsc"])
        initial_gas["rho_g_at_BHP_lb_ft3"] = initial_gas["rho_g_lb_ft3"]
        initial_gas.update(water_properties(p.initial_pressure_psia,p))
    detailed = [{
        "year": 0.0, "t_days": 0.0, "phase_count": constants["phase_count"],
        "single_fluid_code": constants["single_fluid_code"],
        "P_used_psia": p.initial_pressure_psia,
        "BHP_psia": p.initial_pressure_psia, "total_delta_p_psi": 0.0,
        **initial_gas,
        **({"rd_ft": p.rw_ft, "rg_ft": p.rw_ft,
            "dry_zone_thickness_ft": 0.0, "Vp1_ft3": 0.0, "Mg1_lb": 0.0}
           if p.phase_mode == "two" else {}),
        "pressure_evaluations": 0, "pressure_residual_psi": 0.0,
    }]
    subdaily_days = np.geomspace(1.0/86400.0, 1.0, 241 if water_mode else 61)
    later_days = (
        np.arange(1.25, DAYS_PER_YEAR, 0.25) if water_mode
        else np.arange(2.0, DAYS_PER_YEAR, 1.0)
    )
    # Include exact minute/hour checkpoints so plotted BHP labels use solved
    # values at those times rather than interpolated neighbouring samples.
    label_checkpoint_days = np.array([1.0/1440.0, 1.0/24.0])
    sample_days = np.unique(np.concatenate(
        (subdaily_days, label_checkpoint_days, later_days)
    ))
    pressure_guess = p.initial_pressure_psia
    for days in sample_days:
        elapsed_years = float(days/DAYS_PER_YEAR)
        try:
            result = solve_year(elapsed_years, pressure_guess, p, constants)
        except (ValueError, OverflowError, ZeroDivisionError) as exc:
            raise ValueError(
                f"First-year detail at {days:.9g} days: {exc}"
            ) from exc
        detailed.append(result)
        pressure_guess = result["BHP_psia"]
    # Reuse the annual endpoint exactly; retain one sample at year 1.
    detailed.append(dict(annual_results[0]))
    return detailed


def observation_schedule(period, selected):
    """Validate the shut-in duration and return sorted reporting offsets."""
    try:
        if isinstance(period, bool):
            raise ValueError
        period = float(period)
        if not math.isfinite(period) or period < 0:
            raise ValueError
    except (ValueError, TypeError, OverflowError) as exc:
        raise ValueError("Observation period must be a finite number of years >= 0.") from exc

    if isinstance(selected, str):
        selected = selected.split(",") if selected.strip() else []
    if not isinstance(selected, (list, tuple)):
        raise ValueError("Enter observation years as a comma-separated list of numbers.")
    if period == 0:
        if selected:
            raise ValueError("Enter a positive observation period before selecting observation years.")
        return period, []
    if not selected:
        offsets = list(range(1, math.floor(period) + 1))
        if not offsets or offsets[-1] != period:
            offsets.append(period)
        return period, offsets
    try:
        if any(isinstance(value, bool) for value in selected):
            raise ValueError
        offsets = sorted({float(value) for value in selected})
        if any(not math.isfinite(value) or not 0 <= value <= period for value in offsets):
            raise ValueError
    except (ValueError, TypeError, OverflowError) as exc:
        raise ValueError(f"Observation years must be numbers between 0 and {period:g}.") from exc
    return period, offsets


def calculate_observation(final, p, make_plot=True):
    """Nonlinear zero-flow pressure diffusion with live transport/storage.

    The supplied final zones and saturations remain frozen. Each RHS call
    recalculates cell viscosity and cw at local absolute pressure. This is a
    fixed-front approximation, without post-shut-in saturation redistribution.
    """
    period, offsets = observation_schedule(p.observation_period_years,p.observation_years)
    if not offsets:
        return None
    active_zones = (1,2,3) if p.phase_mode == "two" else (1,)
    final_mobility = np.array([final[f"Lambda{z}_mD_cP"] for z in active_zones])
    final_storage = p.porosity*np.array([final[f"ct{z}_per_psi"] for z in active_zones])
    diffusivity = TIME_COEFFICIENT_YEARS*final_mobility/final_storage
    outer_front = final["rg_ft"] if p.phase_mode == "two" else p.rw_ft
    outer_radius = outer_front+12*math.sqrt(max(diffusivity)*(final["year"]+period))
    edges = ((p.rw_ft,final["rd_ft"],final["rg_ft"],outer_radius)
             if p.phase_mode == "two" else (p.rw_ft,outer_radius))
    faces, zones = [p.rw_ft],[]
    for zone,(inner,outer) in enumerate(zip(edges,edges[1:])):
        if outer > inner:
            count = math.ceil(math.log(outer/inner)/.04)
            faces.extend(np.geomspace(inner,outer,count+1)[1:])
            zones.extend([zone]*count)
    faces, zones = np.asarray(faces),np.asarray(zones,dtype=int)
    centers = np.sqrt(faces[:-1]*faces[1:])
    geometry = (faces[1:]**2-faces[:-1]**2)/2
    resistance_left = np.log(faces[1:-1]/centers[:-1])
    resistance_right = np.log(centers[1:]/faces[1:-1])
    outer_log = math.log(outer_radius/centers[-1])

    if p.phase_mode == "two":
        scale = PRESSURE_COEFFICIENT*final["mu_gas_cP"]*final["q_reservoir_rb_day"]/(p.k_mD*p.h_ft*p.krg_zone1)
        aa = np.array([final[f"a{z}"] for z in (1,2,3)])
        bb = np.array([final[f"b{z}"] for z in (1,2,3)])
        DD = np.array([final[f"D{z}"] for z in (1,2,3)])
        well_pD = final["pD_gas_reference"]
    else:
        viscosity = p.mu_water_cP if is_water_mode(p) else final["mu_gas_cP"]
        scale = PRESSURE_COEFFICIENT*viscosity*final["q_reservoir_rb_day"]/(p.k_mD*p.h_ft)
        aa,bb,DD = np.array([0.]),np.array([.5]),np.array([1.])
        well_pD = final["pD_intrinsic_reference"]
    arguments = (centers/p.rw_ft)**2/(4*DD[zones]*final["tD"])
    initial_excess = scale*(aa[zones]+bb[zones]*exp1(arguments))

    def rhs(_time,excess):
        pressures = p.initial_pressure_psia+excess
        if is_water_mode(p):
            water = water_properties(pressures,p)
            mobility = np.full_like(excess,p.k_mD/p.mu_water_cP)
            ct = np.asarray(water["cw_per_psi"])+p.rock_compressibility_per_psi
        elif p.phase_mode == "single":
            mu,_ = _live_co2_arrays(pressures,p.temperature_F)
            mobility = p.k_mD/mu
            # Retain the requested fixed initial cg in this single-phase branch.
            ct = np.full_like(excess,final["ct1_per_psi"])
        else:
            mu,cg = _live_co2_arrays(pressures,p.temperature_F)
            cw = np.asarray(water_properties(pressures,p)["cw_per_psi"])
            mobility = np.where(zones==0,p.k_mD*p.krg_zone1/mu,
                       np.where(zones==1,p.k_mD*(final["krg2"]/mu+final["krw2"]/p.mu_water_cP),
                                p.k_mD/p.mu_water_cP))
            ct = np.where(zones==0,cg+p.rock_compressibility_per_psi,
                 np.where(zones==1,final["Sg2"]*cg+final["Sw2"]*cw+p.rock_compressibility_per_psi,
                          cw+p.rock_compressibility_per_psi))
        resistance = resistance_left/mobility[:-1]+resistance_right/mobility[1:]
        flux_to_left = TIME_COEFFICIENT_YEARS*np.diff(excess)/resistance
        net = np.zeros_like(excess)
        net[:-1] += flux_to_left
        net[1:] -= flux_to_left
        net[-1] -= TIME_COEFFICIENT_YEARS*mobility[-1]*excess[-1]/outer_log
        return net/(p.porosity*ct*geometry)

    times = [0.,period,*offsets]
    if make_plot:
        times.extend(np.geomspace(min(period/100,1/(DAYS_PER_YEAR*86400)),period,90))
    times = np.unique(times)
    count = len(centers)
    sparsity = diags([np.ones(count-1),np.ones(count),np.ones(count-1)],[-1,0,1],format="csc")
    solution = solve_ivp(rhs,(0.,period),initial_excess,method="BDF",
                         jac_sparsity=sparsity,t_eval=times,rtol=2e-7,atol=1e-8)
    if not solution.success or not np.isfinite(solution.y).all():
        raise ValueError(f"Shut-in pressure solve failed: {solution.message}")
    well_excess = solution.y[0].copy()
    well_excess[0] = scale*well_pD
    pressure_by_time = dict(zip(times.tolist(),well_excess.tolist()))
    rows = []
    for offset in offsets:
        buildup = pressure_by_time[offset]
        bhp = p.initial_pressure_psia+buildup
        properties = {}
        if is_water_mode(p) or p.phase_mode == "two":
            properties.update(water_properties(bhp,p))
        if not is_water_mode(p):
            live_density = calculate_co2_density(bhp,p.temperature_F)
            properties.update(co2_viscosity(p.temperature_F,live_density))
        rows.append({
            "years_after_shut_in":offset,"elapsed_year":final["year"]+offset,
            "BHP_psia":bhp,"total_delta_p_psi":buildup,
            "falloff_from_flowing_BHP_psi":final["BHP_psia"]-bhp,
            **properties,
            **({"q_water_stb_day":0.,"cumulative_injected_water_stb":final["Vwater_stb"]}
               if is_water_mode(p) else
               {"q_sc_scf_day":0.,"cumulative_injected_CO2_scf":final["Vsc_scf"]}),
            **({"rd_ft":final["rd_ft"],"rg_ft":final["rg_ft"],
                "dry_zone_thickness_ft":final["dry_zone_thickness_ft"],
                "Vp1_ft3":final["Vp1_ft3"],"Mg1_lb":final["Mg1_lb"]}
               if p.phase_mode == "two" else {}),
        })
    return {"rows":rows,"elapsed_years":final["year"]+times,
            "bhp_psia":p.initial_pressure_psia+well_excess}

def save_results(results, p, constants, output_dir, make_plot=True, *, observation=None, pressure_limit=None):
    water_mode = is_water_mode(p)
    pressure_limit = pressure_limit_spec(pressure_limit)
    apply_pressure_status(results, pressure_limit)
    first_year_detail = calculate_first_year_detail(results, p, constants)
    apply_pressure_status(first_year_detail, pressure_limit)
    if observation:
        apply_pressure_status(observation["rows"], pressure_limit)
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    for filename, columns in (
        ("annual_summary.csv", SUMMARY_FIELDS),
        ("all_calculations.csv", list(results[0])),
    ):
        with (output_dir/filename).open("w", newline="", encoding="utf-8") as handle:
            writer = csv.DictWriter(handle, fieldnames=columns, extrasaction="ignore")
            writer.writeheader()
            writer.writerows(results)
    detail_fields = [
        "year", "phase_count", "single_fluid_code", "t_days",
        "mu_gas_cP", "mu_gas_Pa_s", "viscosity_density_kg_m3", "cw_per_Pa",
        "rho_brine_kg_m3", "salt_mass_fraction", "salinity_wt_percent", "salinity_ppm",
        "x_NaCl", "salt_molality", "water_activity", "salt_concentration_kg_m3",
        "Bw_rb_stb", "cw_per_psi", "rho_water_lb_ft3", "rho_water_at_BHP_lb_ft3", "P_used_psia", "BHP_psia", "total_delta_p_psi",
        "rho_g_lb_ft3", "rho_g_at_BHP_lb_ft3", "Bg_rb_scf", "cg_per_psi",
        "rd_ft", "dry_zone_thickness_ft", "Vp1_ft3", "Mg1_lb", "rg_ft",
        "pressure_evaluations", "pressure_residual_psi",
        "max_allowable_BHP_psia", "pressure_limit_status", "pressure_margin_psi", "pressure_exceedance_psi",
    ]
    with (output_dir/"first_year_detail.csv").open(
        "w", newline="", encoding="utf-8"
    ) as handle:
        writer = csv.DictWriter(handle, fieldnames=detail_fields, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(first_year_detail)
    observation_path = output_dir/"observation_summary.csv"
    if observation is not None:
        rows = observation["rows"]
        with observation_path.open("w", newline="", encoding="utf-8") as handle:
            writer = csv.DictWriter(handle, fieldnames=list(rows[0]))
            writer.writeheader()
            writer.writerows(rows)
    elif (output_dir/"inputs_used.json").exists():
        # Drop the prior generated observation table when reusing its folder.
        observation_path.unlink(missing_ok=True)
    saved_inputs = {
        "years": len(results), "parameters": asdict(p), "references": constants,
        "pressure_limit": pressure_limit,
        "phase_mode": p.phase_mode, "phase_description": model_label(p),
        "method": {
            "wells_M": 1, "constant_rate_periods_N1": 1,
            "days_per_year": DAYS_PER_YEAR,
            "property_pressure": "converged same-year BHP within the pressure residual tolerance",
            "elapsed_time": "cumulative year n",
            "BHP": "initial pressure + total_delta_p",
            "update": "within-year pressure/property solve at fixed cumulative time and injected standard mass",
            "pressure_initial_guess": "previous year's BHP; initial pressure in year 1",
            "pressure_residual_tolerance_psi": PRESSURE_TOLERANCE_PSI,
            "maximum_pressure_iterations": MAX_PRESSURE_ITERATIONS,
            "pressure_residual": "P_used_psia - BHP_psia",
            "pressure_evaluations": "number of annual-equation evaluations in the within-year solve",
            "gas_viscosity": "Fenghour-Wakeham-Vesovic 1998 background correlation using live PR density at every trial pressure; not an input",
            "water_compressibility": "cw=(d rho_brine/dP at fixed T and salt kg/kg)/rho_brine; not an input",
            "brine_density": "Driesner 2007 liquid molar-volume mapping backed by IAPWS-IF97 Region 1",
            "salinity": "NaCl-equivalent salt kg/kg inferred from measured standard brine density with the supplied McCain inverse; not an input",
            "salinity_pressure_convention": "Salt kg/kg and mole fraction are conserved under compression; salt kg/m3 changes with density. No salt transport or precipitation is solved.",
            "brine_reference_density_basis": "60 F and 14.696 psia; do not enter a reservoir-condition density",
            "brine_backend_limits": "0.1--100 MPa; mapped liquid-water temperature 273.15--623.15 K; salt kg/kg 0--0.26",
            "gas_viscosity_reference": "https://doi.org/10.1063/1.556013",
            "brine_density_reference": "https://doi.org/10.1016/j.gca.2007.05.026",
            "water_density_reference": "https://iapws.org/public/documents/UWTF-/IF97-Rev.pdf",
            "gas_density": "calculated from rho = p*M/(Z*R*T); not an input",
            "gas_density_timing": "rho_g_lb_ft3 uses converged P_used_psia; rho_g_at_BHP_lb_ft3 uses BHP_psia; pressures agree within tolerance",
            "vapor_correction": "blue-cancelled factor omitted",
            "pressure_reference": "intrinsic k with pD_gas_reference / krg_zone1",
            "leading_front": "n=3: (M_lambda-1)*sf^3+3*sf-2=0; F3=(sf+2)/(3*sf*(1-Swr)); n=2 uses its matching quadratic front",
            "gas_front_radius": "sqrt(rw^2 + Vr_ft3*gas_front_factor/(pi*phi*h))",
            "dry_front_radius": "center-based boundary rd = sqrt(rw^2 + alpha_d*Vr_ft3/(pi*phi*h)) with evaporation; rd = rw without evaporation",
            "dry_zone_thickness": "dry_zone_thickness_ft = rd - rw; exactly 0 without evaporation",
            "dry_zone_without_evaporation": "yw = ceq = alpha_d = dry_zone_thickness_ft = Vp1_ft3 = Mg1_lb = 0; internal rd_ft = rw_ft",
            "zone2_saturation": "representative mass-balance saturation; distinct from leading-front saturation Sg_front",
            "plot_initial_state": "time = 0; BHP = initial_pressure_psia",
            "first_year_sampling": "61 geometrically spaced samples from 1 second to 1 day, plus exact 1-minute and 1-hour checkpoints; daily from day 2; exact year-1 endpoint",
            "later_year_sampling": "annual endpoints only",
            "full_period_time_tick_interval_years": 2,
            "first_year_plot_axis": "linear from 0 to 1 second; logarithmic thereafter",
            "first_year_checkpoints": "0, 1 second, 1 minute, 1 hour, 1 day, 30 days, 1 year; matching markers on both panels",
            "pressure_axis": "ticks start at initial_pressure_psia; regular 100-psi intervals; 5 percent visual margin below initial pressure",
        },
    }
    if p.phase_mode == "two" and p.include_dissolution:
        saved_inputs["method"].update({
            "dissolution": "equilibrium CO2 held in the zone 2 aqueous phase: Cd = rho_aq*Xco2_eq; Sg2 = (Minj-rho_g*Vp1-Cd*Vp2)/((rho_g-Cd)*Vp2); Mdiss = Cd*(1-Sg2)*Vp2",
            "dissolution_coupling": "(1) gas front dfg/dSg = (fg+a)/(Sf+a), a = Cd/(rho_g-Cd); (2) Sg2 mass balance -> krg2, krw2, Lambda2; (3) ct2 = Sg2*cg+Sw2*cw+cr+c_sol, c_sol = Sw2*rho_aq*(dXeq/dP)/(1-Xeq)*(1/rho_g-1/rho_app); (4) b3 = theta*exp(...)/(2*m3), theta = [beta*(1-fg)-F*(beta*(1-Sf)-rho_b)]/rho_b, beta = rho_aq*(1-Xeq); solubility and PVT updated at every pressure evaluation",
            "dissolution_solubility": "Spycher et al. 2003 with the Spycher-Pruess 2005 NaCl salting-out coefficient; 35-99 C, 1-600 bar absolute, 0-6 mol NaCl/kg water",
            "dissolution_aqueous_density": "Garcia apparent molar volume of dissolved CO2 mixed with the live CO2-free brine density",
            "dissolution_limitation": "local equilibrium; Zone 1 holds no brine and Zone 3 is CO2-free brine; pressure continuity at rd and rg is enforced exactly",
            "dissolution_references": "https://doi.org/10.1016/S0016-7037(03)00273-4; https://doi.org/10.1016/j.gca.2005.01.015; https://escholarship.org/uc/item/4q1422qm",
        })
    if observation is not None:
        saved_inputs["method"]["observation"] = (
            "Nonlinear zero-flow radial pressure diffusion with zone geometry and saturations "
            "frozen at shut-in. Cell viscosity and storage are updated at local pressure. Observation times are years after shut-in. "
            "Year zero reports formation pressure after removal of flowing skin."
        )
        saved_inputs["observation_report_years"] = [
            row["years_after_shut_in"] for row in observation["rows"]
        ]
    pressure_samples = list(results)+list(first_year_detail)
    if observation:
        pressure_samples += apply_pressure_status([
            {"year": float(t), "BHP_psia": float(bhp)} for t, bhp in
            zip(observation["elapsed_years"], observation["bhp_psia"])], pressure_limit)
    _write_multiwell_csv(output_dir/"pressure_limit_summary.csv", pressure_failure_summary(pressure_samples))
    if p.phase_mode == "single":
        saved_inputs["method"].update({
            "leading_front": "not applicable: initially single-phase CO2 reservoir",
            "gas_front_radius": "not applicable", "dry_front_radius": "not applicable",
            "zone2_saturation": "not applicable", "vapor_correction": "not applicable",
            "relative_permeability": "1.0 for single-phase CO2",
            "total_compressibility": "cg + rock compressibility",
            "pressure_reference": "intrinsic k; pD = 0.5*E1(1/(4*tD))",
            "limitation": "E1 slightly-compressible kernel with representative-BHP PR updates; not an exact real-gas solution",
        })
    if water_mode:
        saved_inputs["method"].update({
            "gas_density": "not applicable", "gas_density_timing": "not applicable",
            "leading_front": "not applicable: initially water-filled reservoir",
            "relative_permeability": "1.0 for single-phase water",
            "total_compressibility": "water compressibility + rock compressibility",
            "pressure_reference": "intrinsic k; pD = 0.5*E1(1/(4*tD))",
            "water_density": "Driesner liquid-brine density at current trial pressure, temperature and derived salt mass fraction",
            "water_Bw": "fixed at exactly 1.0 rb/STB for all times and pressures",
            "surface_rate_unit": "STB/day", "reservoir_rate": "q_water*1.0 (rb/day)",
            "first_year_sampling": "241 logarithmically spaced samples from 1 second to 1 day, plus exact 1-minute and 1-hour checkpoints; every 6 hours after day 1; exact year-1 endpoint",
            "pressure_axis": "Shared BHP range with rounded ticks anchored at initial pressure and padding around the full water curve",
            "full_period_time_tick_interval_years": (
                1 if len(results) <= 4 else 2 if len(results) <= 30 else "automatic integer-year ticks"
            ),
            "limitation": "representative-pressure E1 approximation with calculated cw; fixed water viscosity and the retained fixed Bw=1 convention",
        })
    elif p.phase_mode == "single":
        saved_inputs["method"].update({
            "gas_formation_volume_factor": f"Fixed at {constants['initial_Bg_rb_scf']:.10f} rb/scf",
            "gas_density": "Fixed at the Peng-Robinson value at the initial pressure and reservoir temperature",
            "gas_density_timing": "Both inventory-density columns report the fixed initial density; viscosity_density_kg_m3 is the live density used for viscosity",
            "total_compressibility": "Fixed initial cg + rock compressibility",
            "reservoir_rate": "q_sc_scf_day * initial_Bg_rb_scf (rb/day)",
            "limitation": "representative-pressure E1 kernel with fixed Bg, cg and inventory density, but viscosity updated from separate live PR density",
        })
    saved_inputs["active_input_names"] = list(input_names_for_phase(p.phase_mode, p.single_phase_fluid))
    (output_dir/"inputs_used.json").write_text(
        json.dumps(saved_inputs, indent=2, allow_nan=False), encoding="utf-8"
    )
    if make_plot:
        try:
            import matplotlib
            matplotlib.use("Agg")
            import matplotlib.pyplot as plt
            from matplotlib.ticker import MaxNLocator
        except ImportError:
            print("Plot skipped: install matplotlib to create bhp_vs_year.png.")
        else:
            history = first_year_detail + results[1:]
            fig, (ax, early_ax) = plt.subplots(
                1, 2, figsize=(12.8, 5.3), sharey=True,
                gridspec_kw={"width_ratios": [1.3, 1.0]},
            )
            ax.plot([r["year"] for r in history], [r["BHP_psia"] for r in history],
                    color="#BC332B", linewidth=1.6, label="Calculated BHP")
            ax.scatter([r["year"] for r in results], [r["BHP_psia"] for r in results],
                       color="#BC332B", s=14, zorder=3)
            end_year = results[-1]["year"]
            ax.set(xlabel="Elapsed injection time (years)", ylabel="BHP (psia)",
                   title="Full injection period", xlim=(0, end_year))
            if water_mode and end_year > 30:
                ax.xaxis.set_major_locator(MaxNLocator(nbins=10, integer=True))
            else:
                year_step = 1 if water_mode and end_year <= 4 else 2
                ax.set_xticks(np.arange(0, end_year + 1, year_step))
            if observation is not None:
                shut_in_year = results[-1]["year"]
                end_year = observation["elapsed_years"][-1]
                ax.plot(observation["elapsed_years"], observation["bhp_psia"],
                        color="#235F73", linewidth=1.6, label="Shut-in pressure")
                ax.scatter([r["elapsed_year"] for r in observation["rows"]],
                           [r["BHP_psia"] for r in observation["rows"]],
                           color="#235F73", marker="s", s=24, zorder=5,
                           clip_on=False, label="Selected observation years")
                ax.axvline(shut_in_year, color="#666666", linestyle="--", linewidth=1,
                           label="Shut-in")
                ax.set(xlabel="Elapsed time from injection start (years)",
                       title="Injection and post-shut-in observation", xlim=(0, end_year))
                ax.set_xticks(np.arange(0, end_year + 1e-10, 2))
            ax.tick_params(axis="x", labelsize=9)
            early_ax.plot([r["t_days"] for r in first_year_detail],
                          [r["BHP_psia"] for r in first_year_detail],
                          color="#BC332B", linewidth=1.6)
            early_ax.set_xscale("symlog", linthresh=1.0/86400.0, linscale=0.8 if water_mode else 0.5)
            early_ax.set(
                xlabel="Elapsed injection time", title="First year: expanded time scale",
                xlim=(0, DAYS_PER_YEAR),
            )
            early_ax.set_xticks(
                [0, 1/86400, 1/1440, 1/24, 1, 30, DAYS_PER_YEAR],
                labels=["0", "1 s", "1 min", "1 h", "1 d", "30 d", "1 yr"],
            )
            early_ax.tick_params(axis="x", labelsize=9)
            for panel in (ax, early_ax):
                panel.scatter([0], [p.initial_pressure_psia], color="#19394D",
                              s=28, zorder=4, clip_on=False, label="Initial pressure")
                panel.grid(True, alpha=0.3)
            checkpoint_days = [0.0, 1/86400, 1/1440, 1/24, 1.0, 30.0, DAYS_PER_YEAR]
            checkpoints = [
                next(
                    row for row in first_year_detail
                    if math.isclose(row["t_days"], days, rel_tol=1e-10, abs_tol=1e-14)
                )
                for days in checkpoint_days
            ]
            maximum_bhp = max(row["BHP_psia"] for row in history)
            minimum_bhp = p.initial_pressure_psia
            if observation is not None:
                maximum_bhp = max(maximum_bhp, float(max(observation["bhp_psia"])))
                minimum_bhp = min(minimum_bhp, min(row["BHP_psia"] for row in history),
                                  float(min(observation["bhp_psia"])))
            if water_mode:
                pi = p.initial_pressure_psia
                low = min(row["BHP_psia"] for row in history) - pi
                high = maximum_bhp - pi
                span = high - low
                padding = max(0.05 * span, 8 * math.ulp(pi)) if span else 1.0
                lower, upper = low - padding, high + padding
                locator = MaxNLocator(nbins=5, steps=[1, 2, 2.5, 5, 10])
                offsets = locator.tick_values(lower, upper)
                pressure_ticks = pi + offsets[(offsets >= lower) & (offsets <= upper)]
                ax.set_yticks(pressure_ticks)
                ax.ticklabel_format(axis="y", style="plain", useOffset=False)
                ax.set_ylim(pi + lower, pi + upper)
            else:
                pressure_step = 100.0
                tick_intervals = max(1, math.ceil(
                    (maximum_bhp-p.initial_pressure_psia)/pressure_step
                ))
                pressure_top = p.initial_pressure_psia+tick_intervals*pressure_step
                pressure_ticks = p.initial_pressure_psia + pressure_step*np.arange(tick_intervals+1)
                ax.set_yticks(pressure_ticks, labels=[f"{value:g}" for value in pressure_ticks])
                bottom_margin = 0.05*(pressure_top-p.initial_pressure_psia)
                ax.set_ylim(minimum_bhp-bottom_margin, pressure_top)
            for panel in (ax, early_ax):
                panel.tick_params(axis="y", labelleft=True, labelsize=9)
            # Keep the true time coordinates on the full linear-year axis.
            # Very early checkpoints therefore appear close to time zero.
            checkpoint_pressure = [row["BHP_psia"] for row in checkpoints[1:]]
            ax.scatter(
                [row["year"] for row in checkpoints[1:]], checkpoint_pressure,
                color="#2C7DA0", s=25, zorder=5, clip_on=False,
                label="First-year checkpoints",
            )
            early_ax.scatter(
                [row["t_days"] for row in checkpoints[1:]], checkpoint_pressure,
                color="#2C7DA0", s=25, zorder=5, clip_on=False,
            )
            # Legend in one row under the panels, so it never covers the curves.
            handles, labels = ax.get_legend_handles_labels()
            fig.legend(handles, labels, loc="lower center", ncol=len(labels), fontsize=9, frameon=False)
            fig.tight_layout(rect=(0, 0.07, 1, 1))
            fig.savefig(output_dir/"bhp_vs_year.png", dpi=200)
            plt.close(fig)
    return output_dir


def positive_integer(text):
    try:
        value = int(text)
    except ValueError as exc:
        raise argparse.ArgumentTypeError("Enter a positive integer number of years.") from exc
    if value < 1:
        raise argparse.ArgumentTypeError("Number of years must be at least 1.")
    return value


class InputUnavailableError(RuntimeError):
    """The host does not provide synchronous text input."""


def read_prompt(prompt):
    """Read text from a terminal or a notebook's standard input channel."""
    try:
        response = input(prompt)
    except NotImplementedError:
        response = None
    if response is None:
        raise InputUnavailableError(
            "This environment does not provide interactive input. "
            "Run the script in a terminal or call calculate_from_inputs({...}) "
            "with your phase, injection years, observation_period_years and observation_years."
        )
    return str(response).strip()


def ask_years(default=30):
    while True:
        text = read_prompt(f"Number of full injection years [{default}]: ")
        try:
            return positive_integer(text or str(default))
        except argparse.ArgumentTypeError as exc:
            print(exc)


def ask_observation(p):
    print("\nPOST-SHUT-IN OBSERVATION ("+model_label(p)+")")
    annual = False
    if not p.observation_years:
        print("  1. Injection only")
        print("  2. Observe annually after shut-in")
        print("  3. Select observation years after shut-in")
        while True:
            choice = read_prompt("Choose 1, 2 or 3 for shut-in observation [1]: ").lower()
            if choice in ("", "1", "n", "no"):
                return
            if choice in ("2", "3", "y", "yes"):
                annual = choice == "2"
                break
            print("Select 1, 2 or 3.")
    while True:
        try:
            period = float(read_prompt("Observation duration after shut-in (years): "))
            if math.isfinite(period) and period > 0:
                break
        except ValueError:
            pass
        print("Enter a positive, finite observation duration in years.")
    if annual:
        p.observation_period_years = period
        return
    while True:
        selected = p.observation_years or read_prompt(
            f"Observation years to report (0 to {period:g}, comma-separated; "
            "0 is the instant of shut-in, Enter for annual): "
        )
        try:
            observation_schedule(period, selected)
        except ValueError as exc:
            if p.observation_years:
                raise
            print(exc)
        else:
            p.observation_period_years = period
            p.observation_years = selected
            return


def ask_phase(phase_mode=None, single_phase_fluid=None):
    """Require an explicit console choice unless the caller specifies a mode."""
    if phase_mode is None:
        while True:
            print("\nSELECT THE PHASE / FLUID:")
            print("  1. Single-phase WATER (rate in STB/day)")
            print("  2. Single-phase CO2 (rate in Mscf/day)")
            print("  3. Two-phase CO2-BRINE (original three-zone model)")
            choice = read_prompt("Choose 1, 2 or 3: ")
            if choice in ("1", "2", "3"):
                phase_mode, selected_fluid = {
                    "1": ("single", "water"), "2": ("single", "co2"),
                    "3": ("two", "co2"),
                }[choice]
                if single_phase_fluid is not None and single_phase_fluid != selected_fluid:
                    raise ValueError("Your selected phase conflicts with --fluid. Choose matching options.")
                return phase_mode, selected_fluid
            print("Select 1, 2 or 3 before continuing.")
    if phase_mode == "single" and single_phase_fluid is None:
        while True:
            print("\nSingle-phase fluid: 1 = WATER, 2 = CO2")
            choice = read_prompt("Choose 1 or 2: ")
            if choice in ("1", "2"):
                single_phase_fluid = {"1": "water", "2": "co2"}[choice]
                break
            print("Select 1 or 2 before continuing.")
    return phase_mode, single_phase_fluid or "co2"


def ask_inputs(defaults, phase_mode=None, single_phase_fluid=None):
    """Ask for the phase first and then only the selected model's inputs."""
    phase_mode, single_phase_fluid = ask_phase(phase_mode, single_phase_fluid)
    values = dict(asdict(defaults), phase_mode=phase_mode, single_phase_fluid=single_phase_fluid)
    print("\nSelected: "+model_label(Inputs(**values)))
    if phase_mode == "two":
        default_choice = "yes" if values["include_evaporation"] else "no"
        while True:
            choice = read_prompt(f"Include evaporation? (yes/no) [{default_choice}]: ").lower()
            if choice in ("", "y", "yes", "n", "no"):
                values["include_evaporation"] = (
                    values["include_evaporation"] if not choice else choice in ("y", "yes")
                )
                break
            print("Enter yes or no.")
        default_choice = "yes" if values["include_dissolution"] else "no"
        while True:
            choice = read_prompt(f"Include CO2 dissolution? (yes/no) [{default_choice}]: ").lower()
            if choice in ("", "y", "yes", "n", "no"):
                values["include_dissolution"] = (
                    values["include_dissolution"] if not choice else choice in ("y", "yes")
                )
                break
            print("Enter yes or no.")
    print("Enter each input. Press Enter to keep its displayed value.")
    for name in input_names_for_phase(phase_mode, single_phase_fluid):
        while True:
            text = read_prompt(f"{PROMPTS[name]} [{values[name]:g}]: ")
            if not text:
                break
            try:
                value = float(text)
                if not math.isfinite(value):
                    raise ValueError
                values[name] = value
                break
            except ValueError:
                print("Enter a finite number; scientific notation such as 4.2e-6 is allowed.")
    return Inputs(**values)


def print_results(results, folder, observation=None):
    phase = "single" if results[0]["phase_count"] == 1 else "two"
    water = results[0]["single_fluid_code"] == 2
    label = ("Single-phase water" if water else PHASE_LABELS[phase])
    print("\nFlow model: "+label)
    if phase == "single":
        print("Single-phase relative permeability = 1; fronts and Zone 2 are not applicable.")
        if not water:
            print(f"Single-phase CO2 uses fixed Bg = {results[0]['Bg_rb_scf']:.10f} rb/scf.")
            print("CO2 density and cg are fixed at the initial reservoir state.")
    print("Pressure and pressure-dependent properties converge within each year.")
    print("BHP = fixed initial pressure + cumulative pressure increase.\n")
    if phase == "two":
        print("rd is the dry-zone boundary from the well center; dry width is rd - rw.")
    b_label = "Bw (rb/STB)" if water else "Bg (rb/scf)"
    c_label = "cw (1/psi)" if water else "cg (1/psi)"
    rho_label = "rho fixed" if phase == "single" and not water else "rho at BHP"
    print(f"{'Year':>5} {'P used':>13} {'rho used':>13} {rho_label:>13} {b_label:>15} {c_label:>15} "
          f"{'rd (ft)':>11} {'Dry width(ft)':>13} {'rg (ft)':>12} {'Total dP':>12} {'Gain':>11} {'BHP (psia)':>14}")
    for r in results:
        radius_text = (f"{r['rd_ft']:11.5f} {r['dry_zone_thickness_ft']:13.5f} {r['rg_ft']:12.5f}" if phase == "two"
                       else f"{'N/A':>11} {'N/A':>13} {'N/A':>12}")
        rho = r["rho_water_lb_ft3"] if water else r["rho_g_lb_ft3"]
        rho_bhp = r["rho_water_at_BHP_lb_ft3"] if water else r["rho_g_at_BHP_lb_ft3"]
        b = r["Bw_rb_stb"] if water else r["Bg_rb_scf"]
        cf = r["cw_per_psi"] if water else r["cg_per_psi"]
        print(f"{r['year']:5d} {r['P_used_psia']:13.6f} {rho:13.6f} {rho_bhp:13.6f} "
              f"{b:15.9f} {cf:15.8e} {radius_text} "
              f"{r['total_delta_p_psi']:12.6f} {r['annual_gain_psi']:11.6f} {r['BHP_psia']:14.6f}")
    final = results[-1]
    print(f"\nCompleted {len(results)} year(s).")
    if phase == "two":
        print(f"Corey exponents: ng = {final['corey_n_gas']:g}, nw = {final['corey_n_water']:g}")
        print(f"Normalized front saturation sf: {final['sf_normalized']:.9f}")
        print(f"Physical front gas saturation: {final['Sg_front']:.9f}")
        print(f"Gas-front factor: {final['gas_front_factor']:.9f}")
        print(f"Dry-zone boundary radius from center: {final['rd_ft']:.9f} ft")
        print(f"Dry-zone thickness: {final['dry_zone_thickness_ft']:.9f} ft")
        print(f"Dry-zone pore volume: {final['Vp1_ft3']:.9f} ft^3")
        print(f"CO2 mass in dry zone: {final['Mg1_lb']:.9f} lb")
    print(f"End-of-injection BHP: {final['BHP_psia']:.6f} psia")
    print(f"Total increase from initial pressure: {final['total_delta_p_psi']:.6f} psi")
    print(f"Maximum absolute pressure residual: "
          f"{max(abs(r['pressure_residual_psi']) for r in results):.3e} psi")
    if water:
        print("First-year detail: initial pressure at time zero, dense startup samples, then every 6 hours after day 1.")
    else:
        print("First-year detail: initial pressure at time zero, subdaily points, then daily.")
    if observation is not None:
        print("\nPOST-SHUT-IN OBSERVATION (zero injection rate)")
        print(f"{'Years after shut-in':>19} {'Elapsed year':>14} {'BHP (psia)':>14} {'Falloff (psi)':>14}")
        for row in observation["rows"]:
            print(f"{row['years_after_shut_in']:19.10g} {row['elapsed_year']:14.10g} "
                  f"{row['BHP_psia']:14.6f} {row['falloff_from_flowing_BHP_psi']:14.6f}")
        print("Selected observation years are saved in observation_summary.csv.")
    print(f"Results saved in: {Path(folder).resolve()}")
    assessment = Path(folder)/'pressure_limit_summary.csv'
    if assessment.exists():
        with assessment.open(newline='',encoding='utf-8') as handle:
            for row in csv.DictReader(handle):
                print(f"Pressure assessment: {row['overall_status']}; peak BHP {float(row['peak_BHP_psia']):.6f} psia; "
                      f"allowable BHP {row['max_allowable_BHP_psia'] or 'not set'}.")


def calculate_from_inputs(user_inputs, output_dir="co2_bhp_corey3_results", make_plot=True):
    """Direct notebook alternative: supply years, phase_mode and physical inputs.

    phase_mode="single", single_phase_fluid="water" selects water.
    phase_mode="single", single_phase_fluid="co2" selects CO2.
    phase_mode="two" retains the original CO2-brine model.
    Only the numerical inputs for the selected phase are used.

    Example (edit any entries before calling):
        user_inputs = {"years": 30, **asdict(Inputs())}
        user_inputs["q_Mscf_day"] = 150
        user_inputs["observation_period_years"] = 10
        user_inputs["observation_years"] = [0, 0.5, 1, 5, 10]
        results = calculate_from_inputs(user_inputs)

    This path never calls input(), parses notebook arguments, or exits a kernel.
    """
    values = dict(user_inputs)
    pressure_limit = values.pop("pressure_limit", None)
    if "initial_gas_density_lb_ft3" in values:
        values.pop("initial_gas_density_lb_ft3")
        print("CO2 density is calculated automatically; the legacy density input is ignored.")
    if "years" not in values:
        raise ValueError("Enter the number of injection years under the key 'years'.")
    years = values.pop("years")
    allowed = {item.name for item in fields(Inputs)}
    unknown = set(values)-allowed
    if unknown:
        raise ValueError("Unrecognized input(s): "+", ".join(sorted(unknown)))
    parameters = Inputs(**values)
    results, constants = run_model(parameters, years)
    observation = calculate_observation(results[-1], parameters, make_plot)
    folder = save_results(results, parameters, constants, output_dir, make_plot,
                          observation=observation, pressure_limit=pressure_limit)
    print_results(results, folder, observation)
    return results


def _notebook_summary_html(results):
    """Render annual outputs without adding a pandas dependency."""
    fixed_co2 = results[0].get("single_fluid_code") == 1
    columns = [
        ("Year", "year", ".0f"),
        ("Years after shut-in", "years_after_shut_in", ".10g"),
        ("Elapsed year", "elapsed_year", ".10g"),
        ("CO2 viscosity (cP)", "mu_gas_cP", ".7f"),
        ("Derived salinity (mass ppm)", "salinity_ppm", ".4f"),
        ("Salt concentration (kg/m3)", "salt_concentration_kg_m3", ".7f"),
        ("Water density at pressure used (lb/ft3)", "rho_water_lb_ft3", ".6f"),
        ("Water density at BHP (lb/ft3)", "rho_water_at_BHP_lb_ft3", ".6f"),
        ("Bw (rb/STB)", "Bw_rb_stb", ".8f"),
        ("cw (1/psi)", "cw_per_psi", ".7e"),
        ("Converged property pressure (psia)", "P_used_psia", ".4f"),
        ("Fixed CO2 density at Pi (lb/ft3)" if fixed_co2 else "CO2 density at pressure used (lb/ft3)",
         "rho_g_lb_ft3", ".6f"),
        ("CO2 density at new BHP (lb/ft3)", "rho_g_at_BHP_lb_ft3", ".6f"),
        ("Bg (rb/scf)", "Bg_rb_scf", ".10f"),
        ("cg (1/psi)", "cg_per_psi", ".7e"),
        ("Dry boundary from well center (ft)", "rd_ft", ".4f"),
        ("Dry-zone thickness (ft)", "dry_zone_thickness_ft", ".4f"),
        ("Dry-zone pore volume (ft3)", "Vp1_ft3", ".4f"),
        ("CO2 mass in dry zone (lb)", "Mg1_lb", ".4f"),
        ("Gas radius (ft)", "rg_ft", ".4f"),
        ("Normalized front saturation sf", "sf_normalized", ".6f"),
        ("Gas-front factor", "gas_front_factor", ".6f"),
        ("Zone 2 gas saturation", "Sg2", ".6f"),
        ("Zone 2 krg", "krg2", ".6f"),
        ("Zone 2 krw", "krw2", ".6f"),
        ("Equilibrium aqueous CO2 mass fraction", "Xco2_eq", ".6f"),
        ("Dissolved CO2 concentration Cd (lb/ft3)", "Cd_lb_ft3_aqueous", ".6f"),
        ("Dissolved CO2 mass (lb)", "Mdiss_lb", ".4f"),
        ("Dissolved fraction of injected CO2", "dissolved_fraction_of_injected", ".6f"),
        ("Solubility storage c_sol (1/psi)", "c_solubility_storage_per_psi", ".7e"),
        ("Zone 3 brine flux ratio", "zone3_flux_ratio", ".6f"),
        ("Total increase (psi)", "total_delta_p_psi", ".6f"),
        ("Annual gain (psi)", "annual_gain_psi", ".6f"),
        ("BHP (psia)", "BHP_psia", ".6f"),
        ("Falloff from flowing BHP (psi)", "falloff_from_flowing_BHP_psi", ".6f"),
        ("Pressure evaluations", "pressure_evaluations", ".0f"),
        ("Pressure residual (psi)", "pressure_residual_psi", ".2e"),
    ]
    columns = [column for column in columns if column[1] in results[0]
               and not (fixed_co2 and column[1] == "rho_g_at_BHP_lb_ft3")]
    if results and "pressure_limit_status" in results[0]:
        columns.extend([("Allowable BHP (psia)", "max_allowable_BHP_psia", ""),
                        ("Pressure status", "pressure_limit_status", "")])
    heads = "".join("<th>"+html.escape(label)+"</th>" for label, _, _ in columns)
    body = "".join(
        "<tr>"+"".join("<td>"+format(row[key], fmt)+"</td>" for _, key, fmt in columns)+"</tr>"
        for row in results
    )
    return (
        "<div style='max-height:520px;overflow:auto'>"
        "<table class='bhp-summary' style='border-collapse:collapse;font-size:13px'>"
        "<thead style='background:#234e70;color:white'><tr>"+heads+"</tr></thead>"
        "<tbody>"+body+"</tbody></table></div>"
        "<style>.bhp-summary th,.bhp-summary td{padding:6px 9px;text-align:right;border-bottom:1px solid #ddd;}"
        ".bhp-summary thead th{position:sticky;top:0;background:#234e70;}</style>"
    )


BROWSER_PHASES = {
    "two": ("two", "co2", "Two-phase CO₂–brine"),
    "water": ("single", "water", "Single-phase water"),
    "co2": ("single", "co2", "Single-phase CO₂"),
}


def _browser_form_html(values, token, *, result="", error=""):
    escape = html.escape
    phase = values.get("phase", "two")
    observe = values.get("observe", "yes")

    def checked(choice):
        return "checked" if observe == choice else ""

    options = "".join(
        f'<option value="{key}" {"selected" if key == phase else ""}>{label}</option>'
        for key, (_, _, label) in BROWSER_PHASES.items()
    )
    active_inputs = {
        key: input_names_for_phase(mode, fluid)
        for key, (mode, fluid, _) in BROWSER_PHASES.items()
    }
    physical_fields = []
    for name, default in asdict(Inputs()).items():
        phases = " ".join(key for key, names in active_inputs.items() if name in names)
        if phases:
            value = escape(values.get(name, f"{default:g}"))
            physical_fields.append(
                f'<label data-phases="{phases}">{escape(PROMPTS[name])}'
                f'<input type="number" step="any" name="{name}" value="{value}"></label>'
            )
    notice = f'<p id="results" role="alert">{escape(error)}</p>' if error else ""
    return f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>CO₂ injection and shut-in pressure</title>
<style>
* {{ box-sizing:border-box }}
body {{ margin:0; background:#f2f6f8; color:#152c3a; font:16px/1.5 system-ui,sans-serif }}
main {{ max-width:980px; margin:auto; padding:24px 18px 56px }}
h1 {{ margin:0 0 8px; line-height:1.15; font-size:clamp(1.65rem,4vw,2.3rem) }}
p {{ margin:8px 0 14px }}
form, section {{ background:white; padding:20px; border:1px solid #c4d3db;
                 border-radius:12px; margin:16px 0 }}
fieldset {{ margin:16px 0; padding:12px 16px 16px; border:2px solid #2c6577;
            border-radius:8px; background:#eff8fa }}
legend {{ padding:0 7px; font-weight:750 }}
.grid {{ display:grid; grid-template-columns:repeat(auto-fit,minmax(min(100%,220px),1fr));
         gap:12px }}
label {{ display:block; font-weight:600 }}
.choice {{ display:inline-block; margin:0 14px 8px 0 }}
input:not([type=radio]), select {{ width:100%; min-height:42px; padding:7px 9px;
    margin-top:4px; border:1px solid #7293a3; border-radius:5px; font:inherit }}
summary {{ cursor:pointer; font-weight:650; margin:12px 0 }}
button {{ background:#174f65; color:white; border:0; border-radius:5px; padding:10px 18px;
          font:inherit; font-weight:700; cursor:pointer; margin-top:10px }}
a {{ color:#174f65; font-weight:650 }}
img {{ width:100%; height:auto }}
[hidden] {{ display:none!important }}
[role=alert] {{ padding:12px; background:#fff1eb; border:1px solid #a64b36; color:#762c20 }}
</style></head>
<body><main>
<h1>CO₂ injection and shut-in pressure</h1>
<p>Set the injection duration and choose when to report bottom-hole pressure after shut-in.</p>
{notice}
<form method="post" action="/#results">
<input type="hidden" name="token" value="{token}">
<div class="grid">
  <label>Phase <select id="phase" name="phase">{options}</select></label>
  <label>Injection duration (years)
    <input type="number" name="years" min="1" step="1" required value="{escape(values.get('years', '30'))}">
  </label>
</div>
<label data-phases="two">Include evaporation?
  <select name="evaporation">
    <option value="yes" {"selected" if values.get("evaporation", "yes") == "yes" else ""}>Yes</option>
    <option value="no" {"selected" if values.get("evaporation", "yes") == "no" else ""}>No</option>
  </select>
</label>
<fieldset id="observation">
  <legend>Post-shut-in observation</legend>
  <p>Include pressure observation after injection stops?</p>
  <label class="choice"><input type="radio" name="observe" value="yes" {checked('yes')}> Yes</label>
  <label class="choice"><input type="radio" name="observe" value="no" {checked('no')}> No</label>
  <div id="reporting" class="grid">
    <label>Observation duration (years)
      <input type="number" id="duration" name="period" step="any" min="0"
             placeholder="e.g. 10" value="{escape(values.get('period', ''))}">
    </label>
    <label>Observation years to report
      <input type="text" name="offsets" aria-describedby="time-help"
             placeholder="e.g. 0, 0.5, 1, 5, 10" value="{escape(values.get('offsets', ''))}">
    </label>
  </div>
  <p id="time-help">Enter comma-separated years after shut-in. Year 0 is the instant
  injection stops. Leave the list blank for annual readings and the endpoint.</p>
</fieldset>
<details><summary>Reservoir and fluid inputs</summary>
<div class="grid">{"".join(physical_fields)}</div></details>
<button type="submit">Calculate pressure</button>
</form>
{result}
</main>
<script>
const form = document.querySelector("form");
function updateForm() {{
  const phase = form.elements.phase.value;
  const twoPhase = phase === "two";
  const observe = form.elements.observe.value === "yes";
  document.querySelector("#reporting").hidden = !observe;
  document.querySelector("#time-help").hidden = !observe;
  form.elements.period.required = observe;
  form.elements.period.disabled = !observe;
  form.elements.offsets.disabled = !observe;
  document.querySelectorAll("[data-phases]").forEach(label => {{
    label.hidden = !label.dataset.phases.split(" ").includes(phase);
    label.querySelector("input, select").disabled = label.hidden;
  }});
}}
form.addEventListener("change", updateForm);
updateForm();
</script>
</body></html>"""


def _browser_calculation(values, output_dir, make_plot):
    from base64 import b64encode

    selection = values.get("phase")
    if selection not in BROWSER_PHASES:
        raise ValueError("Select a phase.")
    phase, fluid, label = BROWSER_PHASES[selection]
    years = positive_integer(values.get("years", ""))
    p = Inputs(phase_mode=phase, single_phase_fluid=fluid)
    if phase == "two":
        evaporation = values.get("evaporation", "yes")
        if evaporation not in ("yes", "no"):
            raise ValueError("Choose Yes or No for Include evaporation.")
        p.include_evaporation = evaporation == "yes"
    for name in input_names_for_phase(phase, fluid):
        try:
            setattr(p, name, float(values.get(name, getattr(p, name))))
        except ValueError as exc:
            raise ValueError(f"Enter a number for {PROMPTS[name]}.") from exc
    if values.get("observe") == "yes":
        try:
            p.observation_period_years = float(values.get("period", ""))
        except ValueError as exc:
            raise ValueError("Enter a positive observation duration in years.") from exc
        if not math.isfinite(p.observation_period_years) or p.observation_period_years <= 0:
            raise ValueError("Enter a positive, finite observation duration in years.")
        p.observation_years = values.get("offsets", "").strip()

    results, constants = run_model(p, years)
    observation = calculate_observation(results[-1], p, make_plot)
    folder = save_results(results, p, constants, output_dir, make_plot, observation=observation,
                          pressure_limit=pressure_limit_from_form(values))
    pressure = results[-1]["BHP_psia"]
    content = [
        '<section id="results"><h2>Calculated pressure</h2>',
        f"<p>{label} · End-of-injection BHP at year {years}: <strong>{pressure:.3f} psia</strong></p>",
    ]
    if observation is not None:
        csv_path = folder/"observation_summary.csv"
        payload = b64encode(csv_path.read_bytes()).decode("ascii")
        content.extend([
            "<h3>Selected post-shut-in observation years</h3>",
            _notebook_summary_html(observation["rows"]),
            f'<p><a download="{csv_path.name}" href="data:text/csv;base64,{payload}">'
            "Download observation_summary.csv</a></p>",
        ])
    plot = folder/"bhp_vs_year.png"
    if make_plot and plot.exists():
        payload = b64encode(plot.read_bytes()).decode("ascii")
        content.append(f'<img alt="Bottom-hole pressure versus elapsed time" src="data:image/png;base64,{payload}">')
    content.extend([
        "<h3>Annual injection results</h3>", _notebook_summary_html(results),
        f"<p>Output folder: <code>{html.escape(str(folder.resolve()))}</code></p></section>",
    ])
    limit_file = folder/"pressure_limit_summary.csv"
    if limit_file.exists():
        payload = b64encode(limit_file.read_bytes()).decode("ascii")
        content.append(f'<p><a download="pressure_limit_summary.csv" href="data:text/csv;base64,{payload}">Download pressure-limit assessment</a></p>')
    return "".join(content)


def serve_browser_form(output_dir, make_plot=True):
    """Open a local HTML form without requiring a notebook or external server."""
    from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
    from secrets import compare_digest, token_urlsafe
    from threading import Lock
    from urllib.parse import parse_qsl
    import webbrowser

    if make_plot:
        try:
            import matplotlib
        except ImportError:
            make_plot = False
        else:
            matplotlib.use("Agg")
    token = token_urlsafe()
    calculation_lock = Lock()

    class Handler(BaseHTTPRequestHandler):
        def _send_form(self, values, status=200, **kwargs):
            body = _browser_form_html(values, token, **kwargs).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

        def _is_form_request(self):
            return self.path == "/" and self.headers.get("Host") == f"127.0.0.1:{self.server.server_port}"

        def do_GET(self):
            if self._is_form_request():
                self._send_form({})
            else:
                self.send_error(404)

        def do_POST(self):
            if not self._is_form_request():
                self.send_error(404)
                return
            length = self.headers.get("Content-Length", "")
            if not length.isdecimal() or not 0 < int(length) <= 262144:
                self.send_error(400)
                return
            try:
                data = self.rfile.read(int(length)).decode("utf-8")
                values = dict(parse_qsl(data, keep_blank_values=True, max_num_fields=64))
                provided = values.pop("token", "").encode("utf-8")
                if not compare_digest(provided, token.encode("ascii")):
                    self.send_error(403)
                    return
            except ValueError:
                self.send_error(400)
                return
            try:
                with calculation_lock:
                    result = _browser_calculation(values, output_dir, make_plot)
            except (ValueError, OSError, OverflowError, argparse.ArgumentTypeError) as exc:
                self._send_form(values, 400, error=str(exc))
            else:
                self._send_form(values, result=result)

    with ThreadingHTTPServer(("127.0.0.1", 0), Handler) as server:
        url = f"http://127.0.0.1:{server.server_port}/"
        print(f"Open the pressure form at {url} (Ctrl+C to close).", flush=True)
        try:
            try:
                webbrowser.open(url)
            except webbrowser.Error:
                pass  # The printed URL can also be opened manually.
            server.serve_forever()
        except KeyboardInterrupt:
            print("\nBrowser form closed.")


def show_single_well_input_form(display_form=True):
    """Display the input grid with two-phase CO2-brine selected.

    The two-phase observation controls use the same input grid as the
    reservoir and fluid fields. The phase dropdown can switch models.
    In a notebook: BHP_FORM = show_input_form()
    After Calculate: BHP_FORM['results'] contains every annual result.
    """
    try:
        import ipywidgets as widgets
        from IPython.display import HTML, Image, FileLink, clear_output, display
    except ImportError as exc:
        raise InputUnavailableError(
            "Notebook form support is missing. Run '%pip install ipywidgets' "
            "in a notebook cell, then rerun this script. Alternatively, use "
            "calculate_from_inputs with phase_mode and single_phase_fluid."
        ) from exc

    defaults_dict = asdict(Inputs())
    choices = {
        "single_water": ("single", "water"),
        "single_co2": ("single", "co2"),
        "two": ("two", "co2"),
    }
    selection = widgets.Dropdown(
        options=[
            ("-- Select the phase before calculating --", ""),
            ("1. Single-phase WATER", "single_water"),
            ("2. Single-phase CO2", "single_co2"),
            ("3. Two-phase CO2-BRINE", "two"),
        ], value="two", description="Phase selection:",
        style={"description_width": "initial"},
        layout=widgets.Layout(width="620px"),
    )
    phase_help = widgets.HTML()
    years_widget = widgets.Text(value="30", layout=widgets.Layout(width="180px"))
    injection_rows = [widgets.Label("Number of injection years (positive integer)"), years_widget]
    evaporation_choice = widgets.Dropdown(
        options=[("Yes", True), ("No", False)], value=True,
        layout=widgets.Layout(width="180px"),
    )
    evaporation_rows = [widgets.Label("Include evaporation?"), evaporation_choice]
    observation_choice = widgets.Dropdown(
        options=[("No", False), ("Yes", True)], value=False,
        layout=widgets.Layout(width="180px"),
    )
    observation_period_widget = widgets.Text(
        placeholder="e.g. 10", disabled=True, layout=widgets.Layout(width="180px"),
    )
    observation_years_widget = widgets.Text(
        placeholder="e.g. 0, 0.5, 1, 5, 10", disabled=True, layout=widgets.Layout(width="180px"),
    )
    observation_rows = [
        widgets.Label("Post-shut-in observation"), observation_choice,
        widgets.Label("Observation duration after shut-in (years)"), observation_period_widget,
        widgets.Label("Observation years to report (comma-separated)"), observation_years_widget,
    ]
    entries = {
        name: widgets.Text(value=f"{value:g}", layout=widgets.Layout(width="180px"))
        for name, value in defaults_dict.items()
        if name not in ("phase_mode", "single_phase_fluid", "water_Bw_rb_stb", "include_evaporation", "include_dissolution")
        and name not in OBSERVATION_INPUTS
    }
    labels = {name: widgets.Label(PROMPTS[name]) for name in entries}
    grid = widgets.GridBox(
        children=[], layout=widgets.Layout(
            grid_template_columns="minmax(330px, 540px) 180px",
            grid_gap="6px 12px", align_items="center",
        ),
    )
    directory_widget = widgets.Text(
        value="co2_bhp_corey3_results", description="Output folder:",
        style={"description_width": "initial"}, layout=widgets.Layout(width="620px"),
    )
    plot_widget = widgets.Checkbox(value=True, description="Save and display the BHP plot")
    limit_panel, read_limit, limit_controls = pressure_limit_widgets(widgets)
    button = widgets.Button(
        description="Calculate all years", button_style="primary", disabled=True,
        layout=widgets.Layout(width="200px"),
    )
    status = widgets.HTML()
    output = widgets.Output()
    state = {
        "phase_selection": selection, "years": years_widget, "inputs": entries,
        "include_evaporation": evaporation_choice,
        "include_observation": observation_choice, "input_grid": grid,
        "observation_period_years": observation_period_widget,
        "observation_years": observation_years_widget, "observation_results": None,
        "output_dir": directory_widget, "make_plot": plot_widget,
        "button": button, "status": status, "output": output, "results": None, "error": None,
        "folder": None, "selected_phase": None, "selected_fluid": None,
    }

    def on_observation_changed(change):
        observation_period_widget.disabled = not observation_choice.value
        observation_years_widget.disabled = not observation_choice.value

    def on_selection_changed(change):
        state.update(results=None, observation_results=None, error=None, folder=None)
        state.pop("constants", None)
        status.value = ""
        if change is not None:
            with output:
                clear_output(wait=False)
        if selection.value not in choices:
            button.disabled = True
            state.update(selected_phase=None, selected_fluid=None)
            grid.children = ()
            phase_help.value = "<p><b>Choose a phase above to display its inputs.</b></p>"
            return
        phase, fluid = choices[selection.value]
        state.update(selected_phase=phase, selected_fluid=fluid)
        children = list(injection_rows)
        if phase == "two":
            children.extend(evaporation_rows)
        children.extend(observation_rows)
        for name in input_names_for_phase(phase, fluid):
            labels[name].value = (
                PROMPTS[name]
            )
            children.extend([labels[name], entries[name]])
        grid.children = tuple(children)
        phase_help.value = (
            "<p><b>Selected: single-phase WATER.</b> Initially water-filled reservoir. "
            "Rate: <b>STB/day</b>; <b>Bw is fixed at 1.0 rb/STB at all times</b>. Enter water density "
            "at initial pressure. Water viscosity and compressibility are supplied constants.</p>"
            if fluid == "water" else
            "<p><b>Selected: single-phase CO2.</b> Initially CO2-filled reservoir; "
            "relative permeability = 1. Rate: <b>Mscf/day</b>. "
            f"<b>Bg is fixed at {SINGLE_PHASE_CO2_BG_RB_SCF:.10f} rb/scf.</b> "
            "CO2 density and cg are fixed at their Peng–Robinson values at the initial "
            "reservoir pressure and temperature.</p>"
            if phase == "single" else
            "<p><b>Selected: two-phase CO2-BRINE.</b> Original dry-gas, two-phase, "
            "and brine zones. CO2 rate: <b>Mscf/day</b>. "
            "Use matching Corey exponents: both 3, or both 2.</p>"
            "<p>For shut-in observation, select <b>Yes</b> in the input grid. "
            "Year <b>0</b> is the instant injection stops. Leave the reporting years "
            "blank for annual readings and a reading at the end of the observation period.</p>"
        )
        button.disabled = False

    def on_calculate(_button):
        button.disabled = True
        status.value = '<p role="status">Calculating pressure…</p>'
        state.update(results=None, observation_results=None, error=None, folder=None)
        state.pop("constants", None)
        with output:
            clear_output(wait=True)
            try:
                if selection.value not in choices:
                    raise ValueError("Select the phase at the top of the form first.")
                phase, fluid = choices[selection.value]
                years = positive_integer(years_widget.value.strip())
                values = dict(defaults_dict, phase_mode=phase, single_phase_fluid=fluid)
                if phase == "two":
                    values["include_evaporation"] = evaporation_choice.value
                if observation_choice.value:
                    try:
                        period = float(observation_period_widget.value.strip())
                        if not math.isfinite(period) or period <= 0:
                            raise ValueError
                    except ValueError as exc:
                        raise ValueError("Enter a positive, finite observation duration in years.") from exc
                    selected = observation_years_widget.value.strip()
                    observation_schedule(period, selected)
                    values.update(observation_period_years=period, observation_years=selected)
                for name in input_names_for_phase(phase, fluid):
                    try:
                        values[name] = float(entries[name].value.strip())
                    except (ValueError, TypeError) as exc:
                        raise ValueError("Enter a number for: "+PROMPTS[name]) from exc
                parameters = Inputs(**values)
                parameters.validate()
                destination = directory_widget.value.strip()
                if not destination:
                    raise ValueError("Enter an output folder name.")
                print(f"Calculating {model_label(parameters)} for all {years} years...")
                results, constants = run_model(parameters, years)
                observation = calculate_observation(results[-1], parameters, plot_widget.value)
                folder = save_results(results, parameters, constants, destination, plot_widget.value,
                                      observation=observation, pressure_limit=read_limit())
                observation_rows = observation["rows"] if observation is not None else None
                state.update(results=results, constants=constants, folder=folder,
                             observation_results=observation_rows)
                message = f"Calculated {years} injection years."
                if observation_rows is not None:
                    message += f" Calculated pressure at {len(observation_rows)} shut-in observation times."
                status.value = f'<p role="status"><b>{message}</b></p>'
                print(f"Completed all {years} years.")
                print(f"End-of-injection BHP: {results[-1]['BHP_psia']:.6f} psia")
                print(f"Total increase: {results[-1]['total_delta_p_psi']:.6f} psi")
                print("Each year's pressure and properties are converged together.\n")
                display(HTML(_notebook_summary_html(results)))
                if observation_rows is not None:
                    display(HTML("<h4>Post-shut-in observation (zero injection rate)</h4>"
                                 + _notebook_summary_html(observation_rows)))
                print("\nSaved results:")
                for filename in ("annual_summary.csv", "all_calculations.csv",
                                 "first_year_detail.csv", "inputs_used.json", "pressure_limit_summary.csv"):
                    display(FileLink(str(folder/filename)))
                if observation_rows is not None:
                    display(FileLink(str(folder/"observation_summary.csv")))
                plot_path = folder/"bhp_vs_year.png"
                if plot_widget.value and plot_path.exists():
                    display(Image(filename=str(plot_path)))
            except (ValueError, OSError, OverflowError, argparse.ArgumentTypeError) as exc:
                state["error"] = str(exc)
                status.value = f'<p role="alert"><b>Calculation stopped:</b> {html.escape(str(exc))}</p>'
            finally:
                button.disabled = selection.value not in choices

    selection.observe(on_selection_changed, names="value")
    observation_choice.observe(on_observation_changed, names="value")
    button.on_click(on_calculate)
    on_selection_changed(None)
    panel = widgets.VBox([
        widgets.HTML("<h3>Injection and shut-in pressure</h3>"
                     "<p>Choose a phase, enter the displayed inputs, and click Calculate all years. "
                     "CO2 rates use Mscf/day; water rates use STB/day.</p>"),
        selection, phase_help, grid,
        limit_panel, directory_widget, plot_widget, button, status, output,
    ])
    state["form"] = panel
    state["pressure_limit_controls"] = limit_controls
    if display_form:
        display(panel)
    return state


def in_notebook():
    """Detect a live notebook kernel without inspecting its command-line flags."""
    try:
        from IPython import get_ipython
    except ImportError:
        return False
    shell = get_ipython()
    return shell is not None and (
        hasattr(shell, "kernel") or type(shell).__name__ != "TerminalInteractiveShell"
    )


def load_config(path):
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError("The configuration must be a JSON object.")
    parameters = data.get("parameters", data)
    if not isinstance(parameters, dict):
        raise ValueError("Configuration 'parameters' must be a JSON object.")
    parameters = dict(parameters)
    if "initial_gas_density_lb_ft3" in parameters:
        parameters.pop("initial_gas_density_lb_ft3")
        print("CO2 density is calculated automatically; the legacy density input is ignored.")
    allowed = {item.name for item in fields(Inputs)}
    unknown = set(parameters)-allowed
    if unknown:
        raise ValueError("Unrecognized input parameter(s): "+", ".join(sorted(unknown)))
    years = data.get("years", 30) if "parameters" in data else 30
    return Inputs(**parameters), years


def single_well_main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--phase", choices=("single", "two"),
                        help="single = choose water or CO2; two = original CO2-brine model")
    parser.add_argument("--fluid", choices=("water", "co2"),
                        help="Fluid for --phase single (default: co2, or saved configuration)")
    parser.add_argument("--years", type=positive_integer, help="Number of annual updates")
    parser.add_argument("--evaporation", choices=("on", "off"),
                        help="Include evaporation in the two-phase model (default: on, or saved configuration)")
    parser.add_argument("--dissolution", choices=("on", "off"),
                        help="Include equilibrium CO2 dissolution in the two-phase model (default: off, or saved configuration)")
    parser.add_argument("--observation-period", type=float,
                        help="Years of zero-rate observation after injection (water, CO2, or two-phase)")
    parser.add_argument("--observation-years",
                        help="Comma-separated reporting years after shut-in; blank reports annual times and endpoint")
    parser.add_argument("--browser", action="store_true",
                        help="Open the local browser form with visible shut-in and observation-year controls")
    parser.add_argument("--defaults", action="store_true", help="Use saved physical defaults without prompts; select model with --phase")
    parser.add_argument("--config", type=Path, help="Read inputs_used.json or a flat parameter JSON object")
    parser.add_argument("--output-dir", type=Path, default=Path("co2_bhp_corey3_results"))
    parser.add_argument("--no-plot", action="store_true", help="Write numerical outputs only")
    parser.add_argument("--max-bhp-psia", type=float, help="Maximum allowable BHP in absolute psia")
    parser.add_argument("--fracture-pressure-psia", type=float, help="Fracture pressure in absolute psia")
    parser.add_argument("--pressure-fraction", type=float, default=.9, help="Allowable fracture-pressure fraction")
    args = parser.parse_args(argv)
    if args.defaults and args.config:
        parser.error("Use either --defaults or --config, not both.")
    try:
        if args.browser:
            if args.defaults or any(value is not None for value in (
                args.phase, args.fluid, args.years, args.evaporation, args.dissolution, args.observation_period, args.observation_years, args.config,
            )):
                parser.error("With --browser, enter model inputs in the form. Only --output-dir and --no-plot apply.")
            serve_browser_form(args.output_dir, not args.no_plot)
            return 0
        if args.config:
            parameters, config_years = load_config(args.config)
            years = args.years if args.years is not None else config_years
        elif args.defaults:
            parameters = Inputs()
            years = args.years if args.years is not None else 30
        else:
            chosen_phase, chosen_fluid = ask_phase(args.phase, args.fluid)
            years = args.years if args.years is not None else ask_years()
            defaults = Inputs(phase_mode=chosen_phase, single_phase_fluid=chosen_fluid)
            if args.evaporation is not None:
                defaults.include_evaporation = args.evaporation == "on"
            if args.dissolution is not None:
                defaults.include_dissolution = args.dissolution == "on"
            if args.observation_period is None:
                defaults.observation_years = args.observation_years or ""
                ask_observation(defaults)
            parameters = ask_inputs(defaults, chosen_phase, chosen_fluid)
        if args.phase is not None:
            parameters.phase_mode = args.phase
        if args.fluid is not None:
            if parameters.phase_mode != "single":
                raise ValueError("--fluid is available only with the single-phase model; use --phase single.")
            parameters.single_phase_fluid = args.fluid
        if parameters.phase_mode == "two" and args.evaporation is not None:
            parameters.include_evaporation = args.evaporation == "on"
        if parameters.phase_mode == "two" and args.dissolution is not None:
            parameters.include_dissolution = args.dissolution == "on"
        if args.observation_period is not None:
            parameters.observation_period_years = args.observation_period
        if args.observation_years is not None:
            parameters.observation_years = args.observation_years
        saved_limit = (json.loads(args.config.read_text()).get("pressure_limit") if args.config else None)
        limit = pressure_limit_from_cli(args, saved_limit)
        if not args.defaults and not args.config and args.max_bhp_psia is None and args.fracture_pressure_psia is None:
            limit = ask_pressure_limit()
        results, constants = run_model(parameters, years)
        observation = calculate_observation(results[-1], parameters, not args.no_plot)
        folder = save_results(results, parameters, constants, args.output_dir, not args.no_plot,
                              observation=observation, pressure_limit=limit)
    except (ValueError, OSError, OverflowError, InputUnavailableError) as exc:
        print(f"Calculation stopped: {exc}", file=sys.stderr)
        return 1

    print_results(results, folder, observation)
    return 0


# ---------------------------------------------------------------------------
# MULTIWELL INTERFERENCE
# Rows = receiving wells; columns = source wells. No skin in off-diagonal terms.
# ---------------------------------------------------------------------------

MULTIWELL_METHOD = (
    "Infinite-acting spatial superposition of the supplied radial E1 responses. "
    "Two-phase sources have individual constant rates and staggered start times; "
    "their PR properties are iterated at the total source-well BHP. This is a "
    "representative-property multiphase superposition approximation, not a "
    "coupled multidimensional displacement solution. Single-phase schedules "
    "use time and space superposition with the background viscosity / cw at "
    "each source's trial BHP. CO2 viscosity (Fenghour), brine density and cw "
    "(Driesner + IAPWS-IF97) and salinity (McCain inverse of the standard "
    "brine density) are calculated, never entered."
)


# Geometry is resolved to real 2-D coordinates before the pressure solver runs.
# Constant spacing means adjacent spacing in a line/grid, not equal all-pair distances.

def well_separations(wells):
    return np.array([[math.hypot(a.x_ft-b.x_ft, a.y_ft-b.y_ft) for b in wells] for a in wells])


def _distance_numbers(value):
    if isinstance(value, str):
        value = value.replace(';', ',').replace('\n', ',').split(',')
        value = [v.strip() for v in value if v.strip()]
    try:
        numbers = [float(v) for v in value]
    except (ValueError, TypeError) as exc:
        raise ValueError('Enter distances as comma-separated numbers in ft.') from exc
    if any(not math.isfinite(v) or v <= 0 for v in numbers):
        raise ValueError('All interwell distances must be finite and positive.')
    return numbers


def coordinates_from_distances(value, number):
    """Recover an exact planar layout from a symmetric Euclidean distance matrix."""
    if isinstance(value, str):
        try:
            value = [[float(v.strip()) for v in row.split(',')]
                     for row in value.strip().splitlines() if row.strip()]
        except ValueError as exc:
            raise ValueError('Enter the distance matrix as numeric CSV rows, without headers.') from exc
    try:
        distance = np.asarray(value, dtype=float)
    except (ValueError, TypeError) as exc:
        raise ValueError('Enter a square numeric pairwise-distance matrix.') from exc
    if distance.shape != (number, number) or not np.isfinite(distance).all():
        raise ValueError(f'The distance matrix must contain {number} rows and {number} columns.')
    scale = max(float(np.max(abs(distance))), 1.0)
    tolerance = 1e-6*scale
    if not np.allclose(distance, distance.T, atol=tolerance, rtol=0):
        raise ValueError('Pairwise distances must be symmetric: distance A–B must equal B–A.')
    if np.max(abs(np.diag(distance))) > tolerance:
        raise ValueError('Distance-matrix diagonal entries must be zero.')
    if np.any(distance[~np.eye(number, dtype=bool)] <= 0):
        raise ValueError('Every off-diagonal well separation must be positive.')
    distance = (distance+distance.T)/2
    np.fill_diagonal(distance, 0.0)
    centering = np.eye(number)-np.ones((number, number))/number
    gram = -0.5*centering@(distance**2)@centering
    eigenvalues, vectors = np.linalg.eigh(gram)
    eigen_tolerance = max(number*scale*tolerance, 1e-10)
    if eigenvalues[0] < -eigen_tolerance or np.count_nonzero(eigenvalues > eigen_tolerance) > 2:
        raise ValueError('These pairwise distances cannot form a horizontal 2-D well layout. '
                         'Check the distances or enter x/y coordinates instead.')
    order = np.argsort(eigenvalues)[::-1][:2]
    coords = vectors[:, order]*np.sqrt(np.maximum(eigenvalues[order], 0.0))
    if coords.shape[1] == 1:
        coords = np.column_stack([coords[:, 0], np.zeros(number)])
    coords -= coords[0]
    if number > 1:
        angle = math.atan2(coords[1, 1], coords[1, 0])
        c, s = math.cos(angle), math.sin(angle)
        coords = coords@np.array([[c, -s], [s, c]])
    reconstructed = np.linalg.norm(coords[:, None, :]-coords[None, :, :], axis=2)
    if np.max(abs(reconstructed-distance)) > tolerance:
        raise ValueError('The distance matrix is inconsistent with a 2-D layout; check its values.')
    return coords


def configure_well_geometry(p, wells=None, *, number=None, mode='constant', layout='line',
                            spacing_ft=1000.0, different_input='adjacent',
                            adjacent_distances_ft=None, pairwise_distances_ft=None):
    """Keep per-well operations while applying the requested distance definition."""
    if number is None:
        number = len(wells) if wells is not None else 4
    if isinstance(number, bool) or not isinstance(number, int) or not 1 <= number <= 32:
        raise ValueError('Choose an integer number of wells from 1 to 32.')
    if mode not in ('constant', 'different'):
        raise ValueError('Choose constant spacing or different distances.')
    if not isinstance(spacing_ft, (int, float)) or not math.isfinite(spacing_ft) or spacing_ft <= 0:
        raise ValueError('Neighboring-well spacing must be finite and positive.')
    existing = [Well(**w) if isinstance(w, dict) else w for w in (wells or [])]
    templates = default_wells(p, number, spacing_ft)
    operations = [existing[i] if i < len(existing) else templates[i] for i in range(number)]
    settings = {'number': number, 'mode': mode, 'layout': layout, 'spacing_ft': float(spacing_ft),
                'different_input': different_input}
    if mode == 'constant':
        if layout not in ('line', 'grid'):
            raise ValueError('Choose a straight line or a square grid for constant spacing.')
        columns = math.ceil(math.sqrt(number)) if layout == 'grid' else number
        coords = np.array([[(i % columns)*spacing_ft, (i//columns)*spacing_ft] for i in range(number)])
    elif different_input == 'adjacent':
        if adjacent_distances_ft is None and number > 1:
            raise ValueError(f'Enter {number-1} adjacent distances in ft.')
        gaps = _distance_numbers(adjacent_distances_ft or [])
        if len(gaps) != number-1:
            raise ValueError(f'Enter {number-1} adjacent distances: Well 1–2, Well 2–3, and so on.')
        coords = np.column_stack([np.r_[0.0, np.cumsum(gaps)], np.zeros(number)])
        settings['adjacent_distances_ft'] = gaps
    elif different_input == 'pairwise':
        if pairwise_distances_ft is None:
            raise ValueError('Enter the full pairwise-distance matrix.')
        coords = coordinates_from_distances(pairwise_distances_ft, number)
        settings['pairwise_distances_ft'] = np.linalg.norm(coords[:, None, :]-coords[None, :, :], axis=2).tolist()
    elif different_input == 'coordinates':
        if len(existing) != number:
            raise ValueError('The coordinate table must have exactly the selected number of wells. Apply the well count first.')
        coords = np.array([[w.x_ft, w.y_ft] for w in operations])
    else:
        raise ValueError('Choose adjacent distances, a pairwise matrix, or x/y coordinates.')
    configured = [replace(w, x_ft=float(x), y_ft=float(y)) for w, (x, y) in zip(operations, coords)]
    validate_wells(configured, p)
    return configured, settings


def geometry_from_form(values):
    try:
        number = int(values.get('number_wells', 4))
        if str(values.get('number_wells', number)).strip() != str(number):
            raise ValueError
        spacing = float(values.get('spacing_ft', 1000))
    except (ValueError, TypeError) as exc:
        raise ValueError('Enter an integer well count and a positive spacing in ft.') from exc
    return {'number': number, 'mode': values.get('spacing_mode', 'constant'),
            'layout': values.get('layout', 'line'), 'spacing_ft': spacing,
            'different_input': values.get('different_input', 'adjacent'),
            'adjacent_distances_ft': values.get('adjacent_distances') or None,
            'pairwise_distances_ft': values.get('distance_matrix') or None}


def resize_well_rows(p, wells, number, spacing=1000.0):
    if not 1 <= number <= 32:
        raise ValueError('Choose 1–32 wells.')
    rows = list(wells[:number])
    names = {w.name.casefold() for w in rows}
    for i in range(len(rows), number):
        candidate = i+1
        while f'well {candidate}' in names:
            candidate += 1
        name = f'Well {candidate}'
        names.add(name.casefold())
        x = max((w.x_ft for w in rows), default=-spacing)+spacing
        rate = p.water_rate_stb_day if is_water_mode(p) else p.q_Mscf_day
        rows.append(Well(name, x, 0.0, rate, 0.0, p.rw_ft, p.skin))
    return rows


def prepare_wells_from_form(values, p):
    settings = geometry_from_form(values)
    old = parse_wells_csv(values.get('wells_csv', wells_to_csv(default_wells(p))), p, require_coordinates=False)
    old = resize_well_rows(p, old, settings['number'], settings['spacing_ft'])
    wells, settings = configure_well_geometry(p, old, **settings)
    values['wells_csv'] = wells_to_csv(wells)
    return wells, settings


def separation_table_html(wells):
    matrix = well_separations(wells)
    heads = ''.join('<th>'+html.escape(w.name)+'</th>' for w in wells)
    rows = ''.join('<tr><th>'+html.escape(w.name)+'</th>'+''.join(
        f'<td>{matrix[i,j]:.3f}</td>' for j in range(len(wells)))+'</tr>' for i, w in enumerate(wells))
    return ('<div style="overflow:auto"><p>Well separation distances (ft)</p>'
            '<table style="border-collapse:separate;border-spacing:10px 4px"><tr><th></th>'+heads+
            '</tr>'+rows+'</table></div>')


def pressure_limit_spec(value=None):
    """A user-provided operational pressure limit, not a mechanical integrity model."""
    value = dict(value or {})
    mode = value.get('mode', 'none')
    if mode == 'none':
        return {'mode': 'none', 'allowable_bhp_psia': None}
    if mode not in ('max_bhp', 'fracture_fraction'):
        raise ValueError('Choose no pressure assessment, maximum BHP, or a fracture-pressure fraction.')
    key = 'max_bhp_psia' if mode == 'max_bhp' else 'fracture_pressure_psia'
    try:
        pressure = float(value[key])
        fraction = float(value.get('fraction', .9))
    except (KeyError, ValueError, TypeError) as exc:
        raise ValueError('Enter a positive pressure limit in absolute psia.') from exc
    if not math.isfinite(pressure) or pressure <= 0:
        raise ValueError('The pressure limit must be finite and positive psia.')
    if mode == 'fracture_fraction' and (not math.isfinite(fraction) or not 0 < fraction <= 1):
        raise ValueError('The allowable fraction of fracture pressure must be greater than 0 and at most 1.')
    return {'mode': mode, key: pressure, 'fraction': fraction,
            'allowable_bhp_psia': pressure if mode == 'max_bhp' else pressure*fraction}


def pressure_limit_from_form(values):
    return pressure_limit_spec({'mode': values.get('limit_mode', 'none'),
                                'max_bhp_psia': values.get('max_bhp_psia', ''),
                                'fracture_pressure_psia': values.get('fracture_pressure_psia', ''),
                                'fraction': values.get('pressure_fraction', .9)})


def pressure_status(bhp, specification=None, well=None):
    specification = pressure_limit_spec(specification)
    limit = well.max_bhp_psia if well is not None and well.max_bhp_psia is not None else specification['allowable_bhp_psia']
    if limit is None:
        return {'max_allowable_BHP_psia': '', 'pressure_limit_status': 'NOT ASSESSED',
                'pressure_margin_psi': '', 'pressure_exceedance_psi': '',
                'failure_criterion': 'No pressure limit supplied'}
    limit = float(limit)
    return {'max_allowable_BHP_psia': limit,
            'pressure_limit_status': 'FAIL' if bhp > limit else 'PASS',
            'pressure_margin_psi': limit-bhp, 'pressure_exceedance_psi': max(0.0, bhp-limit),
            'failure_criterion': 'Required BHP exceeds the user-specified allowable BHP'}


def apply_pressure_status(rows, specification=None, well=None):
    for row in rows:
        row.update(pressure_status(row['BHP_psia'], specification, well))
    return rows


def pressure_failure_summary(rows, default_name='Well 1'):
    groups = {}
    for row in rows:
        groups.setdefault(row.get('well', default_name), []).append(row)
    summary = []
    for name, values in groups.items():
        peak = max(values, key=lambda row: row['BHP_psia'])
        failed = [r for r in values if r.get('pressure_limit_status') == 'FAIL']
        assessed = any(r.get('pressure_limit_status') in ('PASS', 'FAIL') for r in values)
        summary.append({'well': name, 'overall_status': 'FAIL' if failed else 'PASS' if assessed else 'NOT ASSESSED',
                        'max_allowable_BHP_psia': peak.get('max_allowable_BHP_psia', ''),
                        'peak_BHP_psia': peak['BHP_psia'],
                        'peak_project_year': peak.get('year', peak.get('elapsed_year', '')),
                        'minimum_pressure_margin_psi': min((r['pressure_margin_psi'] for r in values
                                                           if isinstance(r.get('pressure_margin_psi'), (float, int))), default=''),
                        'first_detected_failure_year': min((r.get('year', r.get('elapsed_year', 0)) for r in failed), default=''),
                        'assessment': 'Pressure limit at computed sample times; not a mechanical integrity prediction'})
    return summary


def failure_summary_html(rows):
    columns = [('Well', 'well'), ('Overall status', 'overall_status'), ('Peak BHP (psia)', 'peak_BHP_psia'),
               ('Allowed BHP (psia)', 'max_allowable_BHP_psia'), ('First sampled exceedance (year)', 'first_detected_failure_year')]
    body = []
    for row in rows:
        cells = [html.escape(f'{row[k]:.4f}' if isinstance(row.get(k), float) else str(row.get(k,''))) for _, k in columns]
        body.append('<tr>'+''.join(f'<td style="padding:5px 9px">{v}</td>' for v in cells)+'</tr>')
    return '<div style="overflow:auto"><table><tr>'+''.join('<th>'+label+'</th>' for label,_ in columns)+'</tr>'+''.join(body)+'</table></div>'


def pressure_limit_widgets(widgets):
    mode = widgets.Dropdown(options=[('Not assessed', 'none'), ('Maximum allowable BHP', 'max_bhp'),
                                     ('Fraction of fracture pressure', 'fracture_fraction')],
                            value='none', description='Pressure check:', style={'description_width': 'initial'},
                            layout=widgets.Layout(width='620px'))
    maximum = widgets.Text(value='', description='Maximum BHP (psia):', style={'description_width': 'initial'})
    fracture = widgets.Text(value='', description='Fracture pressure (psia):', style={'description_width': 'initial'})
    fraction = widgets.FloatText(value=.9, description='Allowable fraction:', style={'description_width': 'initial'})
    def update(_change=None):
        maximum.layout.display = '' if mode.value == 'max_bhp' else 'none'
        fracture.layout.display = fraction.layout.display = '' if mode.value == 'fracture_fraction' else 'none'
    mode.observe(update, names='value')
    update()
    panel = widgets.VBox([mode, maximum, fracture, fraction, widgets.HTML(
        '<p>FAIL means the required BHP exceeds your limit. Rates are not automatically reduced. '
        'No limit gives NOT ASSESSED. This checks operating pressure, not mechanical well integrity.</p>')])
    def read():
        return pressure_limit_spec({'mode': mode.value, 'max_bhp_psia': maximum.value,
                                    'fracture_pressure_psia': fracture.value, 'fraction': fraction.value})
    return panel, read, {'mode': mode, 'maximum': maximum, 'fracture': fracture, 'fraction': fraction}


def ask_pressure_limit():
    choice = read_prompt('Pressure check: 0 = not assessed, 1 = maximum BHP, 2 = fraction of fracture pressure [0]: ').strip() or '0'
    if choice == '0':
        return pressure_limit_spec()
    if choice == '1':
        return pressure_limit_spec({'mode': 'max_bhp', 'max_bhp_psia': read_prompt('Maximum allowable BHP (psia): ')})
    if choice == '2':
        pressure = read_prompt('Fracture pressure (psia): ')
        fraction = read_prompt('Allowable fraction [0.9]: ').strip() or '.9'
        return pressure_limit_spec({'mode': 'fracture_fraction', 'fracture_pressure_psia': pressure, 'fraction': fraction})
    raise ValueError('Choose 0, 1, or 2 for the pressure check.')


def pressure_limit_from_cli(args, saved=None):
    maximum = getattr(args, 'max_bhp_psia', None)
    fracture = getattr(args, 'fracture_pressure_psia', None)
    if maximum is not None and fracture is not None:
        raise ValueError('Choose either maximum BHP or fracture pressure, not both.')
    if maximum is not None:
        return pressure_limit_spec({'mode': 'max_bhp', 'max_bhp_psia': maximum})
    if fracture is not None:
        return pressure_limit_spec({'mode': 'fracture_fraction', 'fracture_pressure_psia': fracture,
                                    'fraction': getattr(args, 'pressure_fraction', .9)})
    return pressure_limit_spec(saved)


@dataclass
class Well:
    """Rate: Mscf/day for CO2; STB/day for water. Coordinates/radius: ft.

    Optional single-phase rate_schedule uses absolute project years, for example
    [{"year": 0, "rate": 150}, {"year": 5, "rate": 75},
     {"year": 10, "rate": 0}]. It overrides rate/start_year.
    rate=0 without a schedule creates a passive observation well.
    """
    name: str = "Well 1"
    x_ft: float = 0.0
    y_ft: float = 0.0
    rate: float = 150.0
    start_year: float = 0.0
    rw_ft: float = 0.55
    skin: float = 0.0
    include_evaporation: object = None
    rate_schedule: object = None
    max_bhp_psia: object = None

    def events(self):
        if self.rate_schedule is None:
            return [(float(self.start_year), float(self.rate))]
        return [(float(item["year"]), float(item["rate"]))
                for item in self.rate_schedule]

    def source_start(self):
        return next((time for time, rate in self.events() if rate > 0),
                    float(self.start_year))

    def current_rate(self, year):
        return next((rate for time, rate in reversed(self.events()) if year >= time), 0.0)

    def cumulative_rate_days(self, year):
        events = self.events()
        return DAYS_PER_YEAR * sum(
            rate * max(0.0, min(year, events[j+1][0] if j+1 < len(events) else year)-time)
            for j, (time, rate) in enumerate(events)
        )


def validate_wells(wells, p):
    if not isinstance(wells, (list, tuple)) or not 1 <= len(wells) <= 32:
        raise ValueError("Enter between 1 and 32 wells.")
    names = set()
    for well in wells:
        if not isinstance(well, Well):
            raise ValueError("Each well must be a Well object or a well-input dictionary.")
        if not isinstance(well.name, str) or not well.name.strip() or len(well.name) > 80:
            raise ValueError("Each well needs a nonblank name of at most 80 characters.")
        if well.name.casefold() in names:
            raise ValueError(f"Duplicate well name: {well.name}")
        names.add(well.name.casefold())
        for key in ("x_ft", "y_ft", "rate", "start_year", "rw_ft", "skin"):
            value = getattr(well, key)
            if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
                raise ValueError(f"{well.name}: {key} must be a finite number.")
        if well.rate < 0 or well.start_year < 0 or well.rw_ft <= 0:
            raise ValueError(f"{well.name}: rate/start year must be >= 0 and well radius > 0.")
        if well.include_evaporation is not None and not isinstance(well.include_evaporation, bool):
            raise ValueError(f"{well.name}: include_evaporation must be true, false, or null.")
        if well.max_bhp_psia is not None:
            if isinstance(well.max_bhp_psia, bool) or not isinstance(well.max_bhp_psia, (int, float)) or not math.isfinite(well.max_bhp_psia) or well.max_bhp_psia <= 0:
                raise ValueError(f"{well.name}: maximum BHP must be finite and positive psia, or blank.")
        if well.rate_schedule is not None:
            if p.phase_mode == "two":
                raise ValueError(
                    f"{well.name}: two-phase moving-front injection currently supports one "
                    "constant rate per well plus its start year. Arbitrary rate changes need "
                    "a validated history-dependent multiphase kernel; they are not reset plumes. "
                    "Use the global post-shut-in observation section for field shut-in."
                )
            if not isinstance(well.rate_schedule, list) or not well.rate_schedule:
                raise ValueError(f"{well.name}: rate_schedule must be a nonempty list.")
            previous = -1.0
            for item in well.rate_schedule:
                if not isinstance(item, dict) or set(item) != {"year", "rate"}:
                    raise ValueError(f"{well.name}: schedule items require exactly year and rate.")
                year, rate = item["year"], item["rate"]
                if any(isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v)
                       for v in (year, rate)) or year < 0 or rate < 0 or year <= previous:
                    raise ValueError(f"{well.name}: schedule years must increase strictly; rates must be >= 0.")
                previous = year
    for m, receiver in enumerate(wells):
        for source in wells[:m]:
            distance = math.hypot(receiver.x_ft-source.x_ft, receiver.y_ft-source.y_ft)
            if distance <= receiver.rw_ft+source.rw_ft:
                raise ValueError(f"{receiver.name} and {source.name}: wellbores overlap; increase separation.")


def default_wells(p=None, number=4, spacing_ft=1000.0):
    p = p or Inputs()
    if isinstance(number, bool) or not isinstance(number, int) or not 1 <= number <= 32:
        raise ValueError("Number of wells must be an integer from 1 to 32.")
    if not math.isfinite(spacing_ft) or spacing_ft <= 0:
        raise ValueError("Well spacing must be finite and positive.")
    columns = math.ceil(math.sqrt(number))
    rate = p.water_rate_stb_day if is_water_mode(p) else p.q_Mscf_day
    return [Well(f"Well {i+1}", (i % columns)*spacing_ft, (i//columns)*spacing_ft,
                 rate, 0.0, p.rw_ft, p.skin) for i in range(number)]


def wells_to_csv(wells):
    from io import StringIO
    buffer = StringIO()
    keys = ["name", "x_ft", "y_ft", "rate", "start_year", "rw_ft", "skin", "evaporation", "max_bhp_psia"]
    writer = csv.DictWriter(buffer, fieldnames=keys, lineterminator="\n")
    writer.writeheader()
    for well in wells:
        record = {key: getattr(well, key) for key in keys if key != "evaporation"}
        record["evaporation"] = ("inherit" if well.include_evaporation is None else
                                 "on" if well.include_evaporation else "off")
        writer.writerow(record)
    return buffer.getvalue()


def parse_wells_csv(value, p, require_coordinates=True):
    from io import StringIO
    if not isinstance(value, str) or not value.strip():
        raise ValueError("Enter the well table, including its header row.")
    reader = csv.DictReader(StringIO(value.strip()))
    required = {"name", "rate", "start_year", "rw_ft", "skin"}
    if require_coordinates:
        required |= {"x_ft", "y_ft"}
    if not reader.fieldnames or not required <= set(reader.fieldnames):
        raise ValueError("Well-table columns: name,x_ft,y_ft,rate,start_year,rw_ft,skin,evaporation")
    unknown = set(reader.fieldnames)-required-{"evaporation", "max_bhp_psia", "x_ft", "y_ft"}
    if unknown:
        raise ValueError("Unrecognized well-table columns: "+", ".join(sorted(unknown)))
    wells = []
    for number, row in enumerate(reader, 2):
        try:
            if None in row or any(row.get(key) is None for key in required):
                raise ValueError("missing or extra columns")
            evap = (row.get("evaporation") or "inherit").strip().lower()
            if evap not in ("inherit", "on", "off", "yes", "no", "true", "false"):
                raise ValueError("evaporation must be inherit, on, or off")
            wells.append(Well(
                name=row["name"].strip(),
                **{key: float(row[key]) for key in required-{"name", "x_ft", "y_ft"}},
                x_ft=float(row.get("x_ft") or 0), y_ft=float(row.get("y_ft") or 0),
                include_evaporation=(None if evap == "inherit" else evap in ("on", "yes", "true")),
                max_bhp_psia=float(row["max_bhp_psia"]) if (row.get("max_bhp_psia") or "").strip() else None,
            ))
        except (ValueError, TypeError) as exc:
            raise ValueError(f"Well-table row {number}: {exc}") from exc
    if require_coordinates:
        validate_wells(wells, p)
    return wells


def _well_parameters(p, well, rate=None):
    rate = max(well.rate, 1.0) if rate is None else rate
    values = dict(rw_ft=well.rw_ft, skin=well.skin,
                  observation_period_years=0.0, observation_years="")
    values["water_rate_stb_day" if is_water_mode(p) else "q_Mscf_day"] = rate
    if well.include_evaporation is not None:
        values["include_evaporation"] = well.include_evaporation
    return replace(p, **values)


def radial_pressure_from_state(radius_ft, state, p):
    """The supplied piecewise E1 expression, excluding the local skin drop.

    Existing a,b,D are gas-reference normalized. Divide by krg_zone1 exactly
    once to align with the original intrinsic-k pressure prefactor.
    """
    radii = np.asarray(radius_ft, dtype=float)
    if np.any(~np.isfinite(radii)) or np.any(radii < p.rw_ft*(1-1e-12)):
        raise ValueError("Evaluate source pressure at or outside its wellbore radius.")
    if p.phase_mode == "two":
        zones = np.where(radii <= state["rg_ft"], 2, 3)
        if p.include_evaporation:
            zones = np.where(radii <= state["rd_ft"], 1, zones)
        a = np.array([state[f"a{n}"] for n in (1, 2, 3)])
        b = np.array([state[f"b{n}"] for n in (1, 2, 3)])
        D = np.array([state[f"D{n}"] for n in (1, 2, 3)])
        index = zones-1
        arguments = (radii/p.rw_ft)**2/(4*D[index]*state["tD"])
        pD = (a[index]+b[index]*exp1(arguments))/p.krg_zone1
        viscosity = state["mu_gas_cP"]
    else:
        zones = np.ones(radii.shape, dtype=int)
        pD = 0.5*exp1((radii/p.rw_ft)**2/(4*state["tD"]))
        viscosity = p.mu_water_cP if is_water_mode(p) else state["mu_gas_cP"]
    prefactor = PRESSURE_COEFFICIENT*viscosity*state["q_reservoir_rb_day"]/(p.k_mD*p.h_ft)
    return prefactor*pD, zones, pD


def _single_phase_source_profile(year, well, radii, p, constants, *, stop_year=None,
                                 property_pressure=None):
    """Exact time superposition for the adopted E1 kernel.

    Water cw and CO2 viscosity are the background properties at the source
    well's property pressure (its trial BHP); the other kernel inputs are fixed.
    """
    water = is_water_mode(p)
    pressure = p.initial_pressure_psia if property_pressure is None else float(property_pressure)
    if water:
        viscosity = p.mu_water_cP
        ct = water_properties(pressure, p)["cw_per_psi"]
    else:
        viscosity = gas_properties(pressure, p.temperature_F, constants["Zsc"])["mu_gas_cP"]
        ct = constants["initial_cg_per_psi"]
    ct += p.rock_compressibility_per_psi
    B = 1.0 if water else SINGLE_PHASE_CO2_BG_RB_SCF
    rate_conversion = 1.0 if water else 1000.0
    scale = PRESSURE_COEFFICIENT*viscosity*B*rate_conversion/(p.k_mD*p.h_ft)
    profile = np.zeros(np.asarray(radii).shape, dtype=float)
    events = list(well.events())
    if stop_year is not None:
        events = [(time, rate) for time, rate in events if time < stop_year]
        events.append((stop_year, 0.0))
    previous_rate = 0.0
    for time, rate in events:
        increment = rate-previous_rate
        previous_rate = rate
        lag = year-time
        if lag > 0 and increment:
            argument = np.asarray(radii)**2*p.porosity*viscosity*ct / (
                4*TIME_COEFFICIENT_YEARS*p.k_mD*lag
            )
            profile += scale*increment*0.5*exp1(argument)
    current = well.current_rate(year) if stop_year is None or year < stop_year else 0.0
    return profile, scale*current*well.skin


def _evaluate_multiwell(year, trial, p, wells, source_parameters, constants, distances):
    count = len(wells)
    C = np.zeros((count, count))
    zones = np.zeros((count, count), dtype=int)
    skin = np.zeros(count)
    states = [None]*count
    for i, (well, parameters, reference) in enumerate(zip(wells, source_parameters, constants)):
        age = year-well.source_start()
        if year <= 0:
            continue  # prescribed initial state, immediately before initial startup
        if p.phase_mode == "two":
            if age > 0 and well.rate > 0:
                state = calculate_year(age, float(trial[i]), parameters, reference)
                C[:, i], zones[:, i], _ = radial_pressure_from_state(distances[:, i], state, parameters)
                skin[i] = (PRESSURE_COEFFICIENT*state["mu_gas_cP"]*state["q_reservoir_rb_day"]
                           /(p.k_mD*p.h_ft)*well.skin)
                states[i] = state
            elif age == 0 and well.rate > 0 and well.skin:
                gas = gas_properties(float(trial[i]), p.temperature_F, reference["Zsc"])
                skin[i] = PRESSURE_COEFFICIENT*gas["mu_gas_cP"]*well.rate*1000*gas["Bg_rb_scf"]*well.skin/(p.k_mD*p.h_ft)
        else:
            C[:, i], skin[i] = _single_phase_source_profile(
                year, well, distances[:, i], parameters, reference,
                property_pressure=float(trial[i]))
            cumulative = well.cumulative_rate_days(year)
            if age > 0 and cumulative > 0:
                equivalent_rate = cumulative/(age*DAYS_PER_YEAR)
                average_parameters = _well_parameters(p, well, equivalent_rate)
                average_reference = dict(reference)
                average_reference["q_water_stb_day" if is_water_mode(p) else "q_sc_scf_day"] = (
                    equivalent_rate if is_water_mode(p) else equivalent_rate*1000)
                state = calculate_year(age, float(trial[i]), average_parameters, average_reference)
                state["equivalent_rate_for_cumulative_volume"] = equivalent_rate
                state["current_surface_rate"] = well.current_rate(year)
                state["q_reservoir_rb_day"] = well.current_rate(year)*(1.0 if is_water_mode(p) else
                                                                          1000*SINGLE_PHASE_CO2_BG_RB_SCF)
                states[i] = state
                zones[:, i] = 1
    total = p.initial_pressure_psia+C.sum(axis=1)+skin
    if not np.isfinite(total).all() or np.any(total <= 0):
        raise ValueError("Multiwell calculation produced nonpositive or nonfinite BHP.")
    return {"year": year, "bhp": total, "matrix": C, "skin": skin, "zones": zones,
            "states": states, "trial": np.asarray(trial).copy()}


def solve_multiwell_time(year, previous, p, wells, source_parameters, constants, distances):
    """Solve the whole BHP vector; update source properties at total source BHP."""
    evaluations = 0

    def evaluate(trial):
        nonlocal evaluations
        evaluations += 1
        if np.any(np.asarray(trial) <= 0) or not np.isfinite(trial).all():
            raise ValueError("All trial source pressures must be finite and positive.")
        return _evaluate_multiwell(year, trial, p, wells, source_parameters, constants, distances)

    trial = np.asarray(previous, dtype=float).copy()
    for _ in range(MAX_PRESSURE_ITERATIONS):
        snapshot = evaluate(trial)
        residual = trial-snapshot["bhp"]
        if np.max(np.abs(residual)) < PRESSURE_TOLERANCE_PSI:
            break
        if p.phase_mode == "single":
            # Only the background viscosity / cw depend on the trial pressure.
            trial = snapshot["bhp"]
        else:
            trial = 0.5*trial+0.5*snapshot["bhp"]
    else:
        from scipy.optimize import least_squares

        def residual_function(pressure):
            return pressure-evaluate(pressure)["bhp"]

        solution = least_squares(residual_function, trial, bounds=(1e-6, np.inf),
                                 xtol=1e-12, ftol=1e-12, gtol=1e-10,
                                 max_nfev=MAX_PRESSURE_ITERATIONS*5, x_scale="jac")
        snapshot = evaluate(solution.x)
        residual = solution.x-snapshot["bhp"]
        if np.max(np.abs(residual)) >= PRESSURE_TOLERANCE_PSI:
            raise ValueError(f"Year {year:g}: coupled BHP residual is {np.max(np.abs(residual)):g} psi.")
    snapshot["residual"] = residual
    snapshot["evaluations"] = evaluations
    return snapshot


def _multiwell_rows(snapshot, p, wells, distances, *, include_details=True, pressure_limit=None):
    summary, contributions, states, overlaps = [], [], [], []
    C, skin = snapshot["matrix"], snapshot["skin"]
    for m, receiver in enumerate(wells):
        state = snapshot["states"][m]
        dry_radius = (state["rd_ft"] if state and p.phase_mode == "two" and
                      state.get("dry_zone_thickness_ft", 0) > 0 else 0.0)
        row = {
            "year": snapshot["year"], "well": receiver.name,
            "BHP_psia": float(snapshot["bhp"][m]),
            "initial_pressure_psia": p.initial_pressure_psia,
            "own_formation_response_psi": float(C[m, m]),
            "own_skin_psi": float(skin[m]),
            "interference_psi": float(C[m, :].sum()-C[m, m]),
            "total_delta_p_psi": float(C[m, :].sum()+skin[m]),
            "current_surface_rate": receiver.current_rate(snapshot["year"]) if snapshot["year"] > 0 else 0.0,
            "rate_units": "STB/day" if is_water_mode(p) else "Mscf/day",
            "source_age_years": max(0.0, snapshot["year"]-receiver.source_start()),
            "dry_zone_radius_ft": dry_radius if p.phase_mode == "two" else "",
            "zone2_inner_radius_ft": (state["rd_ft"] if state and p.phase_mode == "two" else ""),
            "dry_zone_thickness_ft": state.get("dry_zone_thickness_ft", "") if state else "",
            "gas_front_radius_ft": state.get("rg_ft", "") if state else "",
            "Sg2": state.get("Sg2", "") if state else "",
            "krg2": state.get("krg2", "") if state else "",
            "krw2": state.get("krw2", "") if state else "",
            "pressure_residual_psi": float(snapshot["residual"][m]),
            "pressure_evaluations": snapshot["evaluations"],
        }
        row.update(pressure_status(row["BHP_psia"], pressure_limit, receiver))
        row.update({f"from_{source.name}_psi": float(C[m, i]) for i, source in enumerate(wells)})
        summary.append(row)
        if not include_details:
            continue
        for i, source in enumerate(wells):
            contributions.append({
                "year": snapshot["year"], "receiving_well": receiver.name,
                "source_well": source.name, "is_self": m == i,
                "evaluation_radius_ft": float(distances[m, i]),
                "rD": float(distances[m, i]/source.rw_ft),
                "source_age_years": max(0.0, snapshot["year"]-source.source_start()),
                "receiver_zone_in_source_response": int(snapshot["zones"][m, i]),
                "delta_p_psi": float(C[m, i]),
            })
        details = dict(state) if state else {}
        for key in ("BHP_psia", "total_delta_p_psi", "annual_gain_psi"):
            if key in details:
                details["constant_rate_equivalent_"+key] = details.pop(key)
        details.update(row)
        details["P_used_psia"] = float(snapshot["trial"][m])
        if state:
            if is_water_mode(p):
                details["rho_water_at_BHP_lb_ft3"] = water_properties(float(snapshot["bhp"][m]), p)["rho_water_lb_ft3"]
            elif p.phase_mode == "single":
                details["rho_g_at_BHP_lb_ft3"] = state["rho_g_lb_ft3"]
            else:
                details["rho_g_at_BHP_lb_ft3"] = calculate_co2_density(float(snapshot["bhp"][m]), p.temperature_F)
        states.append(details)
    if include_details and p.phase_mode == "two":
        for i, wi in enumerate(wells):
            for m in range(i+1, len(wells)):
                wm = wells[m]
                si, sm = snapshot["states"][i], snapshot["states"][m]
                gi, gm = (s["rg_ft"] if s else 0.0 for s in (si, sm))
                di, dm = (s["rd_ft"] if s and s.get("dry_zone_thickness_ft", 0) > 0 else 0.0
                          for s in (si, sm))
                overlaps.append({
                    "year": snapshot["year"], "well_i": wi.name, "well_m": wm.name,
                    "separation_ft": float(distances[m, i]),
                    "rg_i_ft": gi, "rg_m_ft": gm, "rd_i_ft": di, "rd_m_ft": dm,
                    "plumes_touch_or_overlap": bool(gi > 0 and gm > 0 and gi+gm >= distances[m, i]),
                    "dry_zones_touch_or_overlap": bool(di > 0 and dm > 0 and di+dm >= distances[m, i]),
                })
    return summary, contributions, states, overlaps


def _parse_report_times(value, years):
    if value is None or value == "":
        values = [float(t) for t in range(1, math.floor(years)+1)]
    elif isinstance(value, str):
        try:
            values = [float(item.strip()) for item in value.split(",") if item.strip()]
        except ValueError as exc:
            raise ValueError("Reporting times must be comma-separated years.") from exc
    elif isinstance(value, (list, tuple)):
        values = list(value)
    else:
        raise ValueError("Reporting times must be a list or comma-separated years.")
    if any(isinstance(t, bool) or not isinstance(t, (int, float)) or not math.isfinite(t)
           or not 0 <= t <= years for t in values):
        raise ValueError("Reporting times must lie between zero and the project injection endpoint.")
    return sorted({0.0, float(years), *(float(t) for t in values)})


def run_multiwell(p, wells, years=30, report_times=None, *, detail=True, pressure_limit=None):
    """Return annual decomposition, full source states, overlaps and plot samples."""
    p.validate()
    wells = [Well(**item) if isinstance(item, dict) else item for item in wells]
    validate_wells(wells, p)
    pressure_limit = pressure_limit_spec(pressure_limit)
    if isinstance(years, bool) or not isinstance(years, (int, float)) or not math.isfinite(years) or years <= 0:
        raise ValueError("Project injection endpoint must be finite and positive.")
    years = float(years)
    parameters = [_well_parameters(p, well) for well in wells]
    constants = [reference_quantities(item) for item in parameters]
    distances = np.array([[math.hypot(wm.x_ft-wi.x_ft, wm.y_ft-wi.y_ft) if m != i else wi.rw_ft
                           for i, wi in enumerate(wells)] for m, wm in enumerate(wells)])
    report = _parse_report_times(report_times, years)
    times = set(report)
    if detail:
        first = min(1.0, years)
        second = 1/(DAYS_PER_YEAR*86400)
        times.update(np.geomspace(second, min(1/DAYS_PER_YEAR, first), 45))
        times.update(np.linspace(min(1/DAYS_PER_YEAR, first), first, 61))
        for well in wells:
            for event, _rate in well.events():
                if 0 <= event < years:
                    times.add(event)
                    duration = min(1.0, years-event)
                    if duration > second:
                        times.update(event+np.geomspace(second, duration, 45))
    times = sorted(float(t) for t in times if 0 <= t <= years)
    previous = np.full(len(wells), p.initial_pressure_psia)
    summary, contributions, states, overlaps, detailed = [], [], [], [], []
    end = None
    for year in times:
        snapshot = solve_multiwell_time(year, previous, p, wells, parameters, constants, distances)
        previous = snapshot["bhp"]
        selected = year in report
        rows, pairs, source_states, contacts = _multiwell_rows(snapshot, p, wells, distances,
                                                             include_details=selected, pressure_limit=pressure_limit)
        detailed.extend(rows)
        if selected:
            summary.extend(rows)
            contributions.extend(pairs)
            states.extend(source_states)
            overlaps.extend(contacts)
        if year == years:
            end = snapshot
    return {
        "parameters": p, "wells": wells, "years": years, "report_times": report,
        "summary": summary, "contributions": contributions, "source_states": states,
        "overlaps": overlaps, "detail": detailed, "end_snapshot": end,
        "source_parameters": parameters, "references": constants, "distances": distances,
        "method": MULTIWELL_METHOD, "pressure_limit": pressure_limit,
    }


def _frozen_source_observation(state, p, radii, offsets):
    """State-preserving zero-rate diffusion of one source's final radial profile.

    Other sources are added afterwards; this remains the radial superposition
    approximation. No negative-injection step or new plume is introduced.
    """
    period = float(max(offsets))
    initial, _, _ = radial_pressure_from_state(radii, state, p)
    if period == 0:
        return np.asarray(initial)[:, None]
    active_zones = (1, 2, 3) if p.include_evaporation else (2, 3)
    mobility = np.array([state[f"Lambda{n}_mD_cP"] for n in active_zones])
    storage = p.porosity*np.array([state[f"ct{n}_per_psi"] for n in active_zones])
    diffusivity = TIME_COEFFICIENT_YEARS*mobility/storage
    outer = max(state["rg_ft"]+12*math.sqrt(max(diffusivity)*(state["year"]+period)),
                2*float(max(radii)))
    edges = ([p.rw_ft, state["rd_ft"], state["rg_ft"], outer] if p.include_evaporation
             else [p.rw_ft, state["rg_ft"], outer])
    faces, zones = [p.rw_ft], []
    for zone, (inner, boundary) in enumerate(zip(edges, edges[1:])):
        if boundary > inner:
            cells = max(1, math.ceil(math.log(boundary/inner)/0.035))
            faces.extend(np.geomspace(inner, boundary, cells+1)[1:])
            zones.extend([zone]*cells)
    faces, zones = np.asarray(faces), np.asarray(zones, dtype=int)
    centers = np.sqrt(faces[:-1]*faces[1:])
    geometry = (faces[1:]**2-faces[:-1]**2)/2
    resistance_left = np.log(faces[1:-1]/centers[:-1])
    resistance_right = np.log(centers[1:]/faces[1:-1])
    outer_log = math.log(outer/centers[-1])
    physical = zones if p.include_evaporation else zones+1  # 0 dry, 1 two-phase, 2 brine

    def rhs(_time, excess):
        # Live cell viscosity and storage at initial pressure + this source's excess.
        pressures = p.initial_pressure_psia+excess
        mu, cg = _live_co2_arrays(pressures, p.temperature_F)
        cw = np.asarray(water_properties(pressures, p)["cw_per_psi"])
        mobility = np.where(physical==0, p.k_mD*p.krg_zone1/mu,
                   np.where(physical==1, p.k_mD*(state["krg2"]/mu+state["krw2"]/p.mu_water_cP),
                            p.k_mD/p.mu_water_cP))
        ct = np.where(physical==0, cg+p.rock_compressibility_per_psi,
             np.where(physical==1, state["Sg2"]*cg+state["Sw2"]*cw+p.rock_compressibility_per_psi,
                      cw+p.rock_compressibility_per_psi))
        resistance = resistance_left/mobility[:-1]+resistance_right/mobility[1:]
        flux_to_left = TIME_COEFFICIENT_YEARS*np.diff(excess)/resistance
        net = np.zeros_like(excess)
        net[:-1] += flux_to_left
        net[1:] -= flux_to_left
        net[-1] -= TIME_COEFFICIENT_YEARS*mobility[-1]*excess[-1]/outer_log
        return net/(p.porosity*ct*geometry)

    profile, _, _ = radial_pressure_from_state(centers, state, p)
    times = sorted({0.0, *(float(t) for t in offsets)})
    count = len(centers)
    sparsity = diags([np.ones(count-1), np.ones(count), np.ones(count-1)], [-1, 0, 1], format="csc")
    solution = solve_ivp(rhs, (0, period), profile, method="BDF", jac_sparsity=sparsity,
                         t_eval=times, rtol=2e-7, atol=1e-8)
    if not solution.success or not np.isfinite(solution.y).all():
        raise ValueError("Multiwell shut-in diffusion failed: "+solution.message)
    samples = np.column_stack([
        np.interp(np.log(radii), np.log(centers), solution.y[:, j]) for j in range(len(times))
    ])
    samples[:, 0] = initial
    return samples[:, [times.index(float(t)) for t in offsets]]


def calculate_multiwell_observation(result, *, detail=True):
    p, wells = result["parameters"], result["wells"]
    period, offsets = observation_schedule(p.observation_period_years, p.observation_years)
    if not offsets:
        return None
    times = {0.0, period, *offsets}
    if detail:
        times.update(np.geomspace(min(period/100, 1/(DAYS_PER_YEAR*86400)), period, 75))
    times = sorted(times)
    matrices = np.zeros((len(times), len(wells), len(wells)))
    for i, (well, parameters, constants, state) in enumerate(zip(
            wells, result["source_parameters"], result["references"], result["end_snapshot"]["states"])):
        radii = result["distances"][:, i]
        if p.phase_mode == "two":
            if state:
                matrices[:, :, i] = _frozen_source_observation(state, parameters, radii, times).T
        else:
            for j, offset in enumerate(times):
                matrices[j, :, i], _ = _single_phase_source_profile(
                    result["years"]+offset, well, radii, parameters, constants,
                    stop_year=result["years"],
                    property_pressure=result["end_snapshot"]["trial"][i])
    rows, pairs, plot_rows = [], [], []
    for j, offset in enumerate(times):
        for m, well in enumerate(wells):
            C = matrices[j]
            row = {
                "years_after_shut_in": offset, "year": result["years"]+offset,
                "well": well.name,
                "BHP_psia": float(p.initial_pressure_psia+C[m].sum()),
                "own_formation_response_psi": float(C[m, m]), "own_skin_psi": 0.0,
                "interference_psi": float(C[m].sum()-C[m, m]),
                "total_delta_p_psi": float(C[m].sum()), "current_surface_rate": 0.0,
                "falloff_from_flowing_BHP_psi": float(result["end_snapshot"]["bhp"][m]
                                                      -p.initial_pressure_psia-C[m].sum()),
            }
            row.update(pressure_status(row["BHP_psia"], result.get("pressure_limit"), well))
            row.update({f"from_{source.name}_psi": float(C[m, i]) for i, source in enumerate(wells)})
            plot_rows.append(row)
            if offset in offsets:
                rows.append(row)
                for i, source in enumerate(wells):
                    pairs.append({"years_after_shut_in": offset, "year": row["year"],
                                  "receiving_well": well.name, "source_well": source.name,
                                  "is_self": m == i, "delta_p_psi": float(C[m, i])})
    return {"rows": rows, "contributions": pairs, "detail": plot_rows,
            "method": ("Fixed-zone zero-flow radial diffusion of each final source profile with live cell viscosity and storage; "
                       "spatial superposition; all field wells stop at the project endpoint."
                       if p.phase_mode == "two" else
                       "E1 time/space superposition with background properties at each source's endpoint BHP; all wells stop at endpoint.")}


def _write_multiwell_csv(path, rows, fallback_fields=None):
    keys = list(dict.fromkeys(key for row in rows for key in row)) if rows else list(fallback_fields or [])
    with Path(path).open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=keys)
        writer.writeheader()
        writer.writerows(rows)


def save_multiwell_results(result, output_dir, make_plot=True, observation=None):
    folder = Path(output_dir)
    folder.mkdir(parents=True, exist_ok=True)
    for filename, rows in (
        ("multiwell_summary.csv", result["summary"]),
        ("interference_contributions.csv", result["contributions"]),
        ("source_states.csv", result["source_states"]),
        ("multiwell_time_detail.csv", result["detail"]),
        ("plume_overlap.csv", result["overlaps"]),
    ):
        _write_multiwell_csv(folder/filename, rows, ["year", "well_i", "well_m", "plumes_touch_or_overlap"])
    wells = result["wells"]
    matrix_rows, distance_rows = [], []
    for m, well in enumerate(wells):
        matrix_rows.append({"receiving_well": well.name, **{
            source.name: float(result["end_snapshot"]["matrix"][m, i]) for i, source in enumerate(wells)}})
        distance_rows.append({"receiving_well": well.name, **{
            source.name: float(result["distances"][m, i]) for i, source in enumerate(wells)}})
    _write_multiwell_csv(folder/"final_interference_matrix.csv", matrix_rows)
    _write_multiwell_csv(folder/"evaluation_distances_ft.csv", distance_rows)
    separations = well_separations(wells)
    _write_multiwell_csv(folder/"well_separations_ft.csv", [{"well": well.name, **{
        source.name: float(separations[m, i]) for i, source in enumerate(wells)}} for m, well in enumerate(wells)])
    failure_rows = pressure_failure_summary(result["detail"]+(observation["detail"] if observation else []))
    result["pressure_limit_summary"] = failure_rows
    _write_multiwell_csv(folder/"pressure_limit_summary.csv", failure_rows)
    saved = {
        "system": "multiwell", "years": result["years"],
        "parameters": asdict(result["parameters"]),
        "wells": [asdict(well) for well in wells], "report_times": result["report_times"],
        "method": MULTIWELL_METHOD, "matrix_orientation": "rows=receivers; columns=sources; no skin",
        "pressure_tolerance_psi": PRESSURE_TOLERANCE_PSI,
        "dry_zone_convention": "dry_zone_radius_ft=0 when absent; zone2_inner_radius_ft=rw",
        "observation_method": observation["method"] if observation else None,
        "overlap_detected": any(row["plumes_touch_or_overlap"] for row in result["overlaps"]),
        "geometry": result.get("geometry"), "pressure_limit": result.get("pressure_limit"),
    }
    (folder/"multiwell_inputs_used.json").write_text(json.dumps(saved, indent=2, allow_nan=False), encoding="utf-8")
    for filename, key in (("multiwell_observation.csv", "rows"),
                          ("observation_contributions.csv", "contributions")):
        if observation:
            _write_multiwell_csv(folder/filename, observation[key])
        else:
            (folder/filename).unlink(missing_ok=True)
    if make_plot:
        _plot_multiwell(result, folder, observation)
    else:
        for filename in ("multiwell_bhp_and_interference.png", "multiwell_matrix_and_fronts.png"):
            (folder/filename).unlink(missing_ok=True)
    return folder


def _plot_multiwell(result, folder, observation):
    try:
        import matplotlib.pyplot as plt
        from matplotlib.patches import Circle, Rectangle
    except ImportError:
        print("Plotting skipped: install matplotlib to enable plots.")
        return
    wells = result["wells"]
    colors = plt.get_cmap("tab10")
    fig, axes = plt.subplots(1, 2, figsize=(13, 5), constrained_layout=True)
    for i, well in enumerate(wells):
        rows = [row for row in result["detail"] if row["well"] == well.name]
        axes[0].plot([r["year"] for r in rows], [r["BHP_psia"] for r in rows],
                     label=well.name, color=colors(i % 10))
        axes[1].plot([r["year"] for r in rows], [r["interference_psi"] for r in rows],
                     label=well.name, color=colors(i % 10))
        if observation:
            rows = [r for r in observation["detail"] if r["well"] == well.name]
            axes[0].plot([r["year"] for r in rows], [r["BHP_psia"] for r in rows],
                         "--", color=colors(i % 10))
            axes[1].plot([r["year"] for r in rows], [r["interference_psi"] for r in rows],
                         "--", color=colors(i % 10))
    for axis, ylabel, title in zip(axes, ("BHP (psia)", "Interference from other wells (psi)"),
                                   ("Well pressure", "Neighboring-well contributions")):
        axis.set(xlabel="Project time (years)", ylabel=ylabel, title=title)
        axis.grid(alpha=.25)
        axis.legend(fontsize=8)
    fig.savefig(folder/"multiwell_bhp_and_interference.png", dpi=180)
    plt.close(fig)
    fig, axes = plt.subplots(1, 2, figsize=(13, 5), constrained_layout=True)
    matrix = result["end_snapshot"]["matrix"]
    im = axes[0].imshow(matrix, cmap="YlOrRd", aspect="equal")
    axes[0].set_xticks(range(len(wells)), [w.name for w in wells], rotation=45, ha="right")
    axes[0].set_yticks(range(len(wells)), [w.name for w in wells])
    axes[0].set(xlabel="Source well", ylabel="Receiving well", title="Final formation-pressure contributions")
    if len(wells) <= 8:
        for m in range(len(wells)):
            for i in range(len(wells)):
                text_color = "white" if matrix[m, i] > 0.65*max(float(matrix.max()), 1e-12) else "black"
                axes[0].text(i, m, f"{matrix[m, i]:.2f}", ha="center", va="center", fontsize=8,
                             color=text_color)
    fig.colorbar(im, ax=axes[0], label="Pressure contribution (psi)", shrink=.8)
    limits_x, limits_y = [], []
    end_states = result["end_snapshot"]["states"]
    radii = [(state.get("rg_ft", 0.0) if state else 0.0) for state in end_states]
    # Shade the plume overlap only for interfering wells: pairs with r_i + r_m > d_im.
    overlap_pairs = [(i, m) for i in range(len(wells)) for m in range(i+1, len(wells))
                     if radii[i] > 0 and radii[m] > 0
                     and radii[i]+radii[m] > math.hypot(wells[i].x_ft-wells[m].x_ft, wells[i].y_ft-wells[m].y_ft)]
    for i, m in overlap_pairs:
        clip = Circle((wells[i].x_ft, wells[i].y_ft), radii[i], transform=axes[1].transData)
        lens = Circle((wells[m].x_ft, wells[m].y_ft), radii[m], color="#404040", alpha=.35, linewidth=0)
        axes[1].add_patch(lens)
        lens.set_clip_path(clip)
    for i, (well, state) in enumerate(zip(wells, end_states)):
        color = colors(i % 10)
        radius = radii[i]
        if radius:
            axes[1].add_patch(Circle((well.x_ft, well.y_ft), radius, fill=False, color=color, linewidth=1.5))
            dry = state.get("dry_zone_thickness_ft", 0)
            if dry > 0:
                axes[1].add_patch(Circle((well.x_ft, well.y_ft), state["rd_ft"], color=color, alpha=.25))
        axes[1].plot(well.x_ft, well.y_ft, "o", color=color)
        axes[1].annotate(well.name, (well.x_ft, well.y_ft), xytext=(5, 5), textcoords="offset points")
        extent = max(radius, 20.0)
        limits_x.extend([well.x_ft-extent, well.x_ft+extent])
        limits_y.extend([well.y_ft-extent, well.y_ft+extent])
    axes[1].set(xlabel="x (ft)", ylabel="y (ft)", title="Individual radial front estimates")
    axes[1].set_aspect("equal", adjustable="box")
    axes[1].set_xlim(min(limits_x)-50, max(limits_x)+50)
    axes[1].set_ylim(min(limits_y)-50, max(limits_y)+50)
    axes[1].grid(alpha=.2)
    if overlap_pairs:
        axes[1].add_patch(Rectangle((0, 0), 0, 0, color="#404040", alpha=.35, label="Plume overlap between interfering wells"))
        axes[1].legend(loc="upper center", bbox_to_anchor=(.5, -.12), fontsize=8, frameon=False)
    fig.savefig(folder/"multiwell_matrix_and_fronts.png", dpi=180)
    plt.close(fig)


def print_multiwell_results(result, folder, observation=None):
    end = result["years"]
    print(f"\nMultiwell results at project year {end:g}; {len(result['wells'])} wells")
    print(f"{'Well':20s} {'BHP psia':>13s} {'Own formation':>15s} {'Skin psi':>12s} {'Interference psi':>18s}  Pressure status")
    for row in result["summary"]:
        if row["year"] == end:
            print(f"{row['well']:20.20s} {row['BHP_psia']:13.6f} "
                  f"{row['own_formation_response_psi']:15.6f} {row['own_skin_psi']:12.6f} "
                  f"{row['interference_psi']:18.6f}  {row['pressure_limit_status']}")
    print("Rows of the contribution matrix are receiving wells; columns are sources.")
    if result["parameters"].phase_mode == "two":
        print("Two-phase pressure uses the supplied three-zone superposition approximation.")
        if any(row["plumes_touch_or_overlap"] for row in result["overlaps"]):
            print("Individual plume circles overlap at one or more reporting times; see plume_overlap.csv.")
    if observation:
        print(f"Calculated {len(observation['rows'])} well/time post-shut-in readings.")
    for row in result.get('pressure_limit_summary', []):
        print(f"{row['well']}: {row['overall_status']} at computed times; peak BHP {row['peak_BHP_psia']:.6f} psia; allowable BHP {row['max_allowable_BHP_psia'] or 'not set'}.")
    print(f"Results: {Path(folder).resolve()}")


def _multiwell_summary_html(rows, endpoint=None):
    if endpoint is not None:
        rows = [row for row in rows if row["year"] == endpoint]
    columns = [("Year", "year"), ("Well", "well"), ("BHP (psia)", "BHP_psia"),
               ("Own formation (psi)", "own_formation_response_psi"),
               ("Skin (psi)", "own_skin_psi"), ("Interference (psi)", "interference_psi"),
               ("Limit status", "pressure_limit_status"), ("Pressure margin (psi)", "pressure_margin_psi")]
    body = []
    for row in rows:
        cells = []
        for _, key in columns:
            value = row.get(key, "")
            cells.append(html.escape(f"{value:.6f}" if isinstance(value, (float, np.floating)) else str(value)))
        body.append("<tr>"+"".join(f"<td style='padding:5px 9px'>{v}</td>" for v in cells)+"</tr>")
    return ("<div style='overflow:auto'><table><thead><tr>"+
            "".join(f"<th style='padding:5px 9px'>{label}</th>" for label, _ in columns)+
            "</tr></thead><tbody>"+"".join(body)+"</tbody></table></div>")


def calculate_multiwell_from_inputs(user_inputs, output_dir="co2_bhp_multiwell_results", make_plot=True):
    values = dict(user_inputs)
    values.pop("system", None)
    years = values.pop("years", 30)
    wells = values.pop("wells", None)
    report = values.pop("report_times", None)
    detail = values.pop("detail", True)
    geometry = values.pop("geometry", None)
    pressure_limit = values.pop("pressure_limit", None)
    nested = values.pop("parameters", None)
    # Metadata in a saved output file is informational, not another input.
    for key in ("method", "matrix_orientation", "pressure_tolerance_psi", "dry_zone_convention",
                "observation_method", "overlap_detected"):
        values.pop(key, None)
    if nested is not None and values:
        raise ValueError("Put physical inputs inside parameters when using a nested configuration.")
    parameters = Inputs(**(nested if nested is not None else values))
    if wells is None:
        wells = default_wells(parameters)
    if geometry:
        wells, geometry = configure_well_geometry(parameters, wells, **geometry)
    result = run_multiwell(parameters, wells, years, report, detail=detail, pressure_limit=pressure_limit)
    result["geometry"] = geometry
    observation = calculate_multiwell_observation(result, detail=make_plot)
    folder = save_multiwell_results(result, output_dir, make_plot, observation)
    result.update(folder=folder, observation=observation)
    print_multiwell_results(result, folder, observation)
    return result


# Preserve the direct single-well API; dispatch only explicit multiwell inputs.
calculate_single_well_from_inputs = calculate_from_inputs


def calculate_from_inputs(user_inputs, output_dir=None, make_plot=True):
    multi = user_inputs.get("system") == "multiwell" or "wells" in user_inputs
    if multi:
        return calculate_multiwell_from_inputs(user_inputs, output_dir or "co2_bhp_multiwell_results", make_plot)
    return calculate_single_well_from_inputs(user_inputs, output_dir or "co2_bhp_corey3_results", make_plot)



# ---------------------- Multiwell input interfaces --------------------------

_single_browser_form_html = _browser_form_html
_single_browser_calculation = _browser_calculation
_browser_default_system = "single"


def _browser_form_html(values, token, *, result="", error=""):
    values = dict(values)
    system = values.get("system", _browser_default_system)
    initial_wells, _ = configure_well_geometry(Inputs(), number=4)
    initial_table = wells_to_csv(initial_wells)
    def selected(key, value, default):
        return 'selected' if values.get(key, default) == value else ''
    system_selector = f'''<label>Well system
    <select id="well-system" name="system">
     <option value="single" {"selected" if system == "single" else ""}>Single well</option>
     <option value="multiwell" {"selected" if system == "multiwell" else ""}>Multiwell interference</option>
    </select></label>'''
    extra = f'''
<fieldset id="multiwell-section"><legend>Number of wells and distances</legend>
 <div class="grid">
 <label>Number of wells <input name="number_wells" type="number" min="2" max="32" step="1"
 value="{html.escape(values.get('number_wells', '4'))}"></label>
 <label>Distances <select name="spacing_mode">
 <option value="constant" {selected('spacing_mode','constant','constant')}>Constant neighboring spacing</option>
 <option value="different" {selected('spacing_mode','different','constant')}>Different distances</option></select></label>
 <label id="constant-layout">Layout <select name="layout">
 <option value="line" {selected('layout','line','line')}>Straight line</option>
 <option value="grid" {selected('layout','grid','line')}>Square grid</option></select></label>
 <label id="spacing-value">Neighboring spacing (ft)
 <input name="spacing_ft" type="number" step="any" min="0" value="{html.escape(values.get('spacing_ft','1000'))}"></label>
 <label id="different-method">Different-distance input <select name="different_input">
 <option value="adjacent" {selected('different_input','adjacent','adjacent')}>Adjacent distances along a line</option>
 <option value="pairwise" {selected('different_input','pairwise','adjacent')}>Full pairwise distance matrix</option>
 <option value="coordinates" {selected('different_input','coordinates','adjacent')}>Custom x/y coordinates</option>
 </select></label></div>
 <label id="adjacent-input">Adjacent distances in ft: Well 1–2, Well 2–3, …
 <input name="adjacent_distances" placeholder="e.g. 1000, 1500, 800"
 value="{html.escape(values.get('adjacent_distances',''))}"></label>
 <label id="matrix-input">Pairwise distances (numeric CSV, one row per well; zero diagonal)
 <textarea name="distance_matrix" rows="6" style="width:100%;font-family:monospace">{html.escape(values.get('distance_matrix',''))}</textarea></label>
 <p>Constant spacing applies to neighboring wells. All pairwise separations, including grid diagonals,
 are calculated from the layout. Adjacent distances place the wells along a straight line.</p>
 <button type="submit" name="action" value="layout" formnovalidate>Apply well count and preview distances</button>
 <label>Individual well inputs
 <textarea name="wells_csv" rows="8" style="width:100%;font:14px/1.5 monospace;white-space:pre">{html.escape(values.get('wells_csv', initial_table))}</textarea></label>
 <p>Edit each rate, start year, radius, skin, and evaporation option. Rate units are Mscf/day for CO₂
 and STB/day for water. A blank max_bhp_psia uses the shared pressure limit; enter a value to override
 it for one well. Coordinates are calculated from distances unless Custom x/y coordinates is selected.</p>
 <label>Reporting times (project years; blank = annual)
 <input name="report_times" value="{html.escape(values.get('report_times',''))}"></label>
</fieldset>
<fieldset id="pressure-limit-section"><legend>Will the required pressure exceed a limit?</legend>
 <label>Pressure assessment <select name="limit_mode">
 <option value="none" {selected('limit_mode','none','none')}>Not assessed — no limit supplied</option>
 <option value="max_bhp" {selected('limit_mode','max_bhp','none')}>Maximum allowable BHP</option>
 <option value="fracture_fraction" {selected('limit_mode','fracture_fraction','none')}>Fraction of fracture pressure</option>
 </select></label>
 <label id="maximum-pressure-input">Maximum allowable BHP (absolute psia)
 <input name="max_bhp_psia" type="number" step="any" value="{html.escape(values.get('max_bhp_psia',''))}"></label>
 <div id="fracture-pressure-input" class="grid">
 <label>Fracture pressure (absolute psia) <input name="fracture_pressure_psia" type="number" step="any"
 value="{html.escape(values.get('fracture_pressure_psia',''))}"></label>
 <label>Allowable fraction <input name="pressure_fraction" type="number" min="0" max="1" step="any"
 value="{html.escape(values.get('pressure_fraction','0.9'))}"></label></div>
 <p>FAIL means required BHP exceeds the selected limit at a computed time. Rates are not automatically
 reduced. This is an operating-pressure check, not a prediction of mechanical well integrity.</p>
</fieldset>'''
    document = _single_browser_form_html(values, token, result=result, error=error)
    document = document.replace('<div class="grid">', system_selector+'<div class="grid">', 1)
    document = document.replace('<fieldset id="observation">', extra+'<fieldset id="observation">', 1)
    script = '''
function setVisible(id, visible) {
 const group = document.getElementById(id);
 group.hidden = !visible;
 group.querySelectorAll('input,select,textarea').forEach(input => input.disabled = !visible);
}
function updateWellSystem() {
 const multi = form.elements.system.value === 'multiwell';
 setVisible('multiwell-section', multi);
 if (multi) {
  const constant = form.elements.spacing_mode.value === 'constant';
  const method = form.elements.different_input.value;
  setVisible('constant-layout', constant);
  setVisible('spacing-value', constant);
  setVisible('different-method', !constant);
  setVisible('adjacent-input', !constant && method === 'adjacent');
  setVisible('matrix-input', !constant && method === 'pairwise');
 }
 ['q_Mscf_day','water_rate_stb_day','rw_ft','skin'].forEach(name => {
  const input=form.elements[name];
  if (input && multi) { input.disabled=true; input.closest('label').hidden=true; }
 });
 const limit=form.elements.limit_mode.value;
 setVisible('maximum-pressure-input', limit==='max_bhp');
 setVisible('fracture-pressure-input', limit==='fracture_fraction');
}
form.addEventListener('change', updateWellSystem);
updateWellSystem();
'''
    return document.replace('</script>', script+'</script>', 1)


def _browser_calculation(values, output_dir, make_plot):
    if values.get('system', 'single') != 'multiwell':
        return _single_browser_calculation(values, output_dir, make_plot)
    from base64 import b64encode
    if values.get('phase') not in BROWSER_PHASES:
        raise ValueError('Select a phase.')
    phase, fluid, _ = BROWSER_PHASES[values['phase']]
    p = Inputs(phase_mode=phase, single_phase_fluid=fluid)
    for name in input_names_for_phase(phase, fluid):
        try:
            setattr(p, name, float(values.get(name, getattr(p, name))))
        except (TypeError, ValueError) as exc:
            raise ValueError('Enter a number for '+PROMPTS[name]) from exc
    p.include_evaporation = values.get('evaporation', 'yes') == 'yes'
    wells, geometry = prepare_wells_from_form(values, p)
    if values.get('action') == 'layout':
        return '<section id="results"><h2>Well layout ready</h2>'+separation_table_html(wells)+'</section>'
    limit = pressure_limit_from_form(values)
    if values.get('observe') == 'yes':
        try:
            p.observation_period_years = float(values.get('period', ''))
        except ValueError as exc:
            raise ValueError('Enter a positive observation duration.') from exc
        if not math.isfinite(p.observation_period_years) or p.observation_period_years <= 0:
            raise ValueError('Enter a positive observation duration.')
        p.observation_years = values.get('offsets', '')
    try:
        years = float(values.get('years', '30'))
    except ValueError as exc:
        raise ValueError('Enter a valid project endpoint in years.') from exc
    result = run_multiwell(p, wells, years, values.get('report_times',''), pressure_limit=limit)
    result['geometry'] = geometry
    observation = calculate_multiwell_observation(result, detail=make_plot)
    folder = save_multiwell_results(result, Path(output_dir)/'multiwell', make_plot, observation)
    content = ['<section id="results"><h2>Multiwell pressure and interference</h2>',
               _multiwell_summary_html(result['summary'], result['years']),
               '<h3>Peak pressure assessment</h3>', failure_summary_html(result['pressure_limit_summary']),
               separation_table_html(wells)]
    if phase == 'two':
        content.append('<p>Three-zone multiphase superposition approximation. Plume overlap is reported separately.</p>')
    if observation:
        content.extend(['<h3>After all wells stop</h3>', _multiwell_summary_html(observation['rows'])])
    if make_plot:
        for filename in ('multiwell_bhp_and_interference.png','multiwell_matrix_and_fronts.png'):
            if (folder/filename).exists():
                payload=b64encode((folder/filename).read_bytes()).decode('ascii')
                content.append(f'<img alt="{filename}" src="data:image/png;base64,{payload}">')
    names=['multiwell_summary.csv','interference_contributions.csv','source_states.csv',
           'multiwell_time_detail.csv','final_interference_matrix.csv','well_separations_ft.csv',
           'evaluation_distances_ft.csv','plume_overlap.csv','multiwell_inputs_used.json','pressure_limit_summary.csv']
    if observation:
        names += ['multiwell_observation.csv','observation_contributions.csv']
    content.append('<h3>Download calculations</h3><ul>')
    for filename in names:
        payload=b64encode((folder/filename).read_bytes()).decode('ascii')
        content.append(f'<li><a download="{filename}" href="data:application/octet-stream;base64,{payload}">{filename}</a></li>')
    return ''.join(content)+'</ul></section>'


def show_multiwell_input_form(display_form=True):
    try:
        import ipywidgets as widgets
        from IPython.display import HTML, Image, FileLink, clear_output, display
    except ImportError as exc:
        raise InputUnavailableError("Install ipywidgets in a separate notebook cell, or use --browser.") from exc
    defaults = Inputs()
    phase = widgets.Dropdown(options=[(label, key) for key, (_p, _f, label) in BROWSER_PHASES.items()],
                             value="two", description="Phase:", layout=widgets.Layout(width="620px"))
    years = widgets.Text(value="30", description="Project years:",
                         style={"description_width": "initial"})
    reports = widgets.Text(value="", placeholder="Blank = annual readings and endpoint",
                           description="Report years:", style={"description_width": "initial"},
                           layout=widgets.Layout(width="620px"))
    count = widgets.BoundedIntText(value=4, min=1, max=32, description="Well count:")
    spacing = widgets.FloatText(value=1000.0, description="Spacing (ft):")
    spacing_mode = widgets.Dropdown(options=[('Constant neighboring spacing','constant'), ('Different distances','different')],
                                    value='constant', description='Distances:', style={'description_width':'initial'},
                                    layout=widgets.Layout(width='620px'))
    layout_choice = widgets.Dropdown(options=[('Straight line','line'),('Square grid','grid')], value='line', description='Layout:')
    different_method = widgets.Dropdown(options=[('Adjacent distances along a line','adjacent'),
                                                ('Full pairwise distance matrix','pairwise'),('Custom x/y coordinates','coordinates')],
                                        value='adjacent', description='Input method:', style={'description_width':'initial'},
                                        layout=widgets.Layout(width='620px'))
    gaps = widgets.Text(value='1000,1000,1000', description='Adjacent gaps (ft):', style={'description_width':'initial'},
                        layout=widgets.Layout(width='620px'))
    distance_matrix = widgets.Textarea(value='', placeholder='Numeric CSV: one row per well, zero diagonal',
                                       description='Distances (ft):', style={'description_width':'initial'},
                                       layout=widgets.Layout(width='100%',height='130px'))
    rebuild = widgets.Button(description="Apply well count and distances", layout=widgets.Layout(width='270px'))
    table = widgets.Textarea(value=wells_to_csv(default_wells(defaults)),
                             layout=widgets.Layout(width="100%", height="190px"))
    table_help = widgets.HTML()
    geometry_preview = widgets.HTML()
    limit_panel, read_limit, limit_controls = pressure_limit_widgets(widgets)
    evaporation = widgets.Dropdown(options=[("Yes", True), ("No", False)], value=True,
                                   description="Evaporation:", style={"description_width": "initial"})
    observe = widgets.Checkbox(value=False, description="Include observation after all wells stop")
    period = widgets.Text(value="10", description="Observe years:", disabled=True,
                          style={"description_width": "initial"})
    offsets = widgets.Text(value="", description="Readings after stop:", disabled=True,
                           placeholder="e.g. 0, 0.5, 1, 5, 10",
                           style={"description_width": "initial"}, layout=widgets.Layout(width="620px"))
    shared = {name: widgets.Text(value=f"{getattr(defaults, name):g}", layout=widgets.Layout(width="180px"))
              for name in PROMPTS if name not in ("q_Mscf_day", "water_rate_stb_day", "water_Bw_rb_stb", "rw_ft", "skin")}
    grid = widgets.GridBox(layout=widgets.Layout(grid_template_columns="minmax(300px,540px) 180px", grid_gap="5px 10px"))
    folder_widget = widgets.Text(value="co2_bhp_multiwell_results", description="Output folder:",
                                 style={"description_width": "initial"}, layout=widgets.Layout(width="620px"))
    plot = widgets.Checkbox(value=True, description="Save and show plots")
    button = widgets.Button(description="Calculate multiwell", button_style="primary")
    status, output = widgets.HTML(), widgets.Output()
    state = {"results": None, "error": None, "folder": None}

    def update(_change=None):
        mode, fluid, _ = BROWSER_PHASES[phase.value]
        children = []
        for name in input_names_for_phase(mode, fluid):
            if name in shared:
                children.extend([widgets.Label(PROMPTS[name]), shared[name]])
        grid.children = tuple(children)
        evaporation.layout.display = "" if mode == "two" else "none"
        unit = "STB/day" if fluid == "water" else "Mscf/day"
        table_help.value = (f"<p><b>Rate units: {unit}.</b> Coordinates/radii: ft. Start year: project time. "
                            "Edit the CSV below; one row per well. Rate 0 creates an observation well. "
                            "Evaporation: inherit, on, or off. Blank max_bhp_psia uses the shared pressure limit. "
                            "Coordinates are calculated from distances unless Custom x/y coordinates is selected.</p>")
        period.disabled = offsets.disabled = not observe.value
        constant = spacing_mode.value == 'constant'
        spacing.layout.display = layout_choice.layout.display = '' if constant else 'none'
        different_method.layout.display = '' if not constant else 'none'
        gaps.layout.display = '' if not constant and different_method.value == 'adjacent' else 'none'
        distance_matrix.layout.display = '' if not constant and different_method.value == 'pairwise' else 'none'

    def configured(p):
        old = parse_wells_csv(table.value, p, require_coordinates=False)
        old = resize_well_rows(p, old, count.value, spacing.value)
        return configure_well_geometry(p, old, number=count.value, mode=spacing_mode.value,
                                       layout=layout_choice.value, spacing_ft=spacing.value,
                                       different_input=different_method.value,
                                       adjacent_distances_ft=gaps.value or None,
                                       pairwise_distances_ft=distance_matrix.value or None)

    def rebuild_table(_button):
        try:
            mode, fluid, _ = BROWSER_PHASES[phase.value]
            p = replace(defaults, phase_mode=mode, single_phase_fluid=fluid)
            wells, _settings = configured(p)
            table.value = wells_to_csv(wells)
            geometry_preview.value = separation_table_html(wells)
            status.value = ""
        except ValueError as exc:
            status.value = f"<p>{html.escape(str(exc))}</p>"

    def calculate(_button):
        button.disabled = True
        status.value = "<p>Calculating all well pressures and individual contributions…</p>"
        with output:
            clear_output(wait=True)
            try:
                mode, fluid, _ = BROWSER_PHASES[phase.value]
                values = asdict(defaults)
                values.update(phase_mode=mode, single_phase_fluid=fluid,
                              include_evaporation=evaporation.value,
                              observation_period_years=0.0, observation_years="")
                for name in input_names_for_phase(mode, fluid):
                    if name in shared:
                        try:
                            values[name] = float(shared[name].value.strip())
                        except ValueError as exc:
                            raise ValueError("Enter a number for "+PROMPTS[name]) from exc
                if observe.value:
                    values["observation_period_years"] = float(period.value.strip())
                    values["observation_years"] = offsets.value.strip()
                    if values["observation_period_years"] <= 0:
                        raise ValueError("Enter a positive observation duration.")
                p = Inputs(**values)
                wells, geometry = configured(p)
                table.value = wells_to_csv(wells)
                geometry_preview.value = separation_table_html(wells)
                endpoint = float(years.value.strip())
                print(f"Calculating {len(wells)} wells through project year {endpoint:g}...")
                result = run_multiwell(p, wells, endpoint, reports.value.strip(), pressure_limit=read_limit())
                result['geometry'] = geometry
                observation = calculate_multiwell_observation(result, detail=plot.value)
                destination = folder_widget.value.strip()
                if not destination:
                    raise ValueError("Enter an output folder.")
                folder = save_multiwell_results(result, destination, plot.value, observation)
                print_multiwell_results(result, folder, observation)
                display(HTML(_multiwell_summary_html(result["summary"], result["years"])))
                display(HTML('<h4>Peak pressure assessment</h4>'+failure_summary_html(result['pressure_limit_summary'])))
                if observation:
                    display(HTML("<h4>After field shut-in</h4>"+_multiwell_summary_html(observation["rows"])))
                for filename in ("multiwell_summary.csv", "interference_contributions.csv", "source_states.csv",
                                 "final_interference_matrix.csv", "multiwell_inputs_used.json", "plume_overlap.csv",
                                 "multiwell_observation.csv", "observation_contributions.csv", "well_separations_ft.csv",
                                 "pressure_limit_summary.csv"):
                    if (folder/filename).exists():
                        display(FileLink(str(folder/filename)))
                if plot.value:
                    for filename in ("multiwell_bhp_and_interference.png", "multiwell_matrix_and_fronts.png"):
                        if (folder/filename).exists():
                            display(Image(filename=str(folder/filename)))
                state.update(results=result["summary"], model=result, observation=observation,
                             folder=folder, error=None)
                status.value = "<p><b>Completed. Individual source contributions and zone states are saved.</b></p>"
            except (ValueError, OSError, OverflowError, TypeError) as exc:
                state.update(error=str(exc), results=None)
                status.value = "<p><b>Calculation stopped:</b> "+html.escape(str(exc))+"</p>"
            finally:
                button.disabled = False

    phase.observe(update, names="value")
    observe.observe(update, names="value")
    spacing_mode.observe(update, names='value')
    different_method.observe(update, names='value')
    def count_changed(_change):
        old_gaps = [v.strip() for v in gaps.value.split(',') if v.strip()]
        gaps.value = ','.join((old_gaps+[str(spacing.value)]*count.value)[:count.value-1])
        if different_method.value != 'pairwise':
            rebuild_table(None)
    count.observe(count_changed, names='value')
    rebuild.on_click(rebuild_table)
    button.on_click(calculate)
    update()
    panel = widgets.VBox([
        widgets.HTML("<h3>Multiwell BHP and interference</h3>"
                     "<p>Enter each source's geometry, rate, start time, radius, and skin. "
                     "All wells share the formation inputs below. Two-phase injection uses "
                     "one constant rate per well; the post-shut-in section stops all wells together.</p>"),
        phase, years, reports, count, spacing_mode, layout_choice, spacing, different_method,
        gaps, distance_matrix, widgets.HTML('<p>Constant spacing applies to neighbors; other separations are calculated from the layout.</p>'),
        rebuild, geometry_preview, table_help, table,
        limit_panel, evaporation, observe, period, offsets,
        widgets.Accordion(children=[grid], titles=("Shared reservoir and fluid inputs",)),
        folder_widget, plot, button, status, output,
    ])
    rebuild_table(None)
    state.update(form=panel, well_table=table, phase_widget=phase, pressure_limit_controls=limit_controls,
                 geometry_controls={'count':count,'mode':spacing_mode,'layout':layout_choice,'spacing':spacing,
                                    'different_input':different_method,'adjacent':gaps,'matrix':distance_matrix,
                                    'apply_button':rebuild}, geometry_preview=geometry_preview)
    if display_form:
        display(panel)
    return state


def show_input_form():
    try:
        import ipywidgets as widgets
        from IPython.display import display
    except ImportError as exc:
        raise InputUnavailableError("Notebook forms require ipywidgets. Install it in a separate cell, "
                                    "or run python co2_bhp_multiwell.py --browser.") from exc
    single = show_single_well_input_form(display_form=False)
    multi = show_multiwell_input_form(display_form=False)
    system = widgets.Dropdown(options=[('Single well','single'),('Multiwell interference','multiwell')],
                              value='multiwell', description='Well system:', style={'description_width':'initial'},
                              layout=widgets.Layout(width='620px'))
    def select_system(_change=None):
        single['form'].layout.display = '' if system.value == 'single' else 'none'
        multi['form'].layout.display = '' if system.value == 'multiwell' else 'none'
    system.observe(select_system, names='value')
    select_system()
    panel=widgets.VBox([system,single['form'],multi['form']])
    display(panel)
    return {"form": panel, "single_well": single, "multiwell": multi, 'system_widget':system}


def _ask_wells(p, number=4, spacing=1000.0, return_geometry=False):
    print('\nMULTIWELL INPUT SECTION')
    text=read_prompt(f'Number of wells [{number}]: ').strip()
    number=positive_integer(text) if text else number
    choice=read_prompt('Distances: 1 = constant neighboring spacing, 2 = different distances [1]: ').strip() or '1'
    settings={'number':number,'spacing_ft':spacing}
    if choice == '1':
        pattern=read_prompt('Layout: 1 = straight line, 2 = square grid [1]: ').strip() or '1'
        if pattern not in ('1','2'):
            raise ValueError('Choose line or grid.')
        entered=read_prompt(f'Distance between neighboring wells (ft) [{spacing:g}]: ').strip()
        settings.update(mode='constant',layout='line' if pattern == '1' else 'grid',
                        spacing_ft=float(entered) if entered else spacing)
    elif choice == '2':
        method=read_prompt('Input: 1 = adjacent distances along a line, 2 = all pairwise distances, 3 = x/y coordinates [1]: ').strip() or '1'
        if method not in ('1','2','3'):
            raise ValueError('Choose 1, 2, or 3 for distance input.')
        settings.update(mode='different',different_input={'1':'adjacent','2':'pairwise','3':'coordinates'}[method])
        if method == '1':
            gaps=[]
            for i in range(number-1):
                entered=read_prompt(f'Distance Well {i+1} to Well {i+2} (ft) [{spacing:g}]: ').strip()
                gaps.append(float(entered) if entered else spacing)
            settings['adjacent_distances_ft']=gaps
        elif method == '2':
            matrix=np.zeros((number,number))
            for i in range(number):
                for j in range(i+1,number):
                    entered=read_prompt(f'Distance Well {i+1} to Well {j+1} (ft): ').strip()
                    matrix[i,j]=matrix[j,i]=float(entered)
            settings['pairwise_distances_ft']=matrix.tolist()
    else:
        raise ValueError('Choose constant or different distances.')
    coordinate_input=settings.get('different_input') == 'coordinates'
    defaults=default_wells(p,number,settings['spacing_ft'])
    if not coordinate_input:
        defaults,_=configure_well_geometry(p,defaults,**settings)
    wells=[]
    units='STB/day' if is_water_mode(p) else 'Mscf/day'
    for default in defaults:
        print(f'\n{default.name} (rate: {units}; coordinates/radius: ft)')
        name=read_prompt(f'Name [{default.name}]: ').strip() or default.name
        values={'x_ft':default.x_ft,'y_ft':default.y_ft}
        fields_to_ask=([('x_ft','x coordinate'),('y_ft','y coordinate')] if coordinate_input else [])
        fields_to_ask += [('rate','Injection rate (0 = observation well)'),('start_year','Start year'),
                          ('rw_ft','Well radius'),('skin','Skin')]
        for key,label in fields_to_ask:
            value=getattr(default,key)
            entered=read_prompt(f'{label} [{value:g}]: ').strip()
            values[key]=float(entered) if entered else value
        evaporation=None
        if p.phase_mode == 'two':
            entered=read_prompt('Evaporation: inherit, on, off [inherit]: ').strip().lower() or 'inherit'
            if entered not in ('inherit','on','off'):
                raise ValueError('Choose inherit, on, or off.')
            evaporation=None if entered == 'inherit' else entered == 'on'
        maximum=read_prompt('Individual maximum BHP (psia; blank = shared limit): ').strip()
        wells.append(Well(name=name,**values,include_evaporation=evaporation,
                          max_bhp_psia=float(maximum) if maximum else None))
    wells,settings=configure_well_geometry(p,wells,**settings)
    print('\nComputed well separations:')
    matrix=well_separations(wells)
    for i in range(len(wells)):
        for j in range(i+1,len(wells)):
            print(f'{wells[i].name} to {wells[j].name}: {matrix[i,j]:.3f} ft')
    return (wells,settings) if return_geometry else wells



def main(argv=None):
    """Route legacy single-well runs or the new multiwell calculation."""
    argv = list(sys.argv[1:] if argv is None else argv)
    extra = argparse.ArgumentParser(add_help=False)
    extra.add_argument("--system", choices=("single", "multiwell"))
    extra.add_argument("--multiwell", action="store_true")
    extra.add_argument("--wells-file", type=Path)
    extra.add_argument("--number-wells", type=int)
    extra.add_argument("--spacing-ft", type=float)
    extra.add_argument('--spacing-mode', choices=('constant','different'))
    extra.add_argument('--layout', choices=('line','grid'))
    extra.add_argument('--distance-input', choices=('adjacent','pairwise','coordinates'))
    extra.add_argument('--adjacent-distances')
    extra.add_argument('--distance-matrix-file',type=Path)
    extra.add_argument("--report-times")
    extra.add_argument("--no-detail", action="store_true")
    extra.add_argument("--write-multiwell-example", type=Path)
    options, remaining = extra.parse_known_args(argv)
    requested_count = options.number_wells if options.number_wells is not None else 4
    requested_spacing = options.spacing_ft if options.spacing_ft is not None else 1000.0
    if options.write_multiwell_example:
        p = Inputs()
        payload = {"system": "multiwell", "years": 30, "parameters": asdict(p),
                   "wells": [asdict(w) for w in default_wells(p, requested_count, requested_spacing)]}
        generated,settings=configure_well_geometry(p,payload['wells'],number=requested_count,
                                                   spacing_ft=requested_spacing,layout=options.layout or 'line')
        payload.update(wells=[asdict(w) for w in generated],geometry=settings)
        path = options.write_multiwell_example
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        print(f"Editable multiwell configuration written to {path.resolve()}")
        return 0
    configuration = None
    config_probe = argparse.ArgumentParser(add_help=False)
    config_probe.add_argument("--config", type=Path)
    config_option, _ = config_probe.parse_known_args(remaining)
    if config_option.config is not None:
        try:
            configuration = json.loads(config_option.config.read_text(encoding="utf-8"))
        except (ValueError, OSError) as exc:
            print(f"Calculation stopped: {exc}", file=sys.stderr)
            return 1
    config_multi = isinstance(configuration, dict) and (
        configuration.get("system") == "multiwell" or "wells" in configuration)
    multi = options.multiwell or options.system == "multiwell" or options.wells_file is not None or config_multi
    if options.system == "single" and multi:
        print("Calculation stopped: --system single conflicts with multiwell inputs.", file=sys.stderr)
        return 1
    if not argv:
        answer = read_prompt("Well system: 1 = single well, 2 = multiwell interference [2]: ").strip() or "2"
        if answer not in ("1", "2"):
            print("Choose 1 or 2.", file=sys.stderr)
            return 1
        multi = answer == "2"
    if "--browser" in remaining:
        global _browser_default_system
        _browser_default_system = "multiwell" if multi else "single"
        return single_well_main(remaining)
    if not multi:
        if "--help" in remaining or "-h" in remaining:
            print("MULTIWELL OPTIONS: --multiwell --number-wells 4 --spacing-ft 1000\n"
                  "  --wells-file wells.csv  --report-times 0.5,1,5,10,30  --no-detail\n"
                  "  --write-multiwell-example four_wells.json\n"
                  "  --config multiwell_inputs_used.json\n")
        return single_well_main(remaining)
    parser = argparse.ArgumentParser(description="Multiwell pressure interference using the supplied E1 model.")
    parser.add_argument("--phase", choices=("single", "two"))
    parser.add_argument("--fluid", choices=("water", "co2"))
    parser.add_argument("--years", type=float)
    parser.add_argument("--evaporation", choices=("on", "off"))
    parser.add_argument("--dissolution", choices=("on", "off"))
    parser.add_argument("--observation-period", type=float)
    parser.add_argument("--observation-years")
    parser.add_argument("--config", type=Path)
    parser.add_argument("--defaults", action="store_true")
    parser.add_argument("--output-dir", type=Path, default=Path("co2_bhp_multiwell_results"))
    parser.add_argument("--no-plot", action="store_true")
    parser.add_argument('--max-bhp-psia',type=float)
    parser.add_argument('--fracture-pressure-psia',type=float)
    parser.add_argument('--pressure-fraction',type=float,default=.9)
    args = parser.parse_args(remaining)
    if args.defaults and args.config:
        parser.error("Use either --defaults or --config.")
    try:
        if configuration is not None:
            if not isinstance(configuration, dict):
                raise ValueError("The configuration must be a JSON object.")
            physical = configuration.get("parameters", configuration)
            if physical is configuration:
                allowed = {item.name for item in fields(Inputs)}
                unknown = set(configuration)-allowed-{"system", "years", "wells", "report_times",'geometry','pressure_limit'}
                if unknown:
                    raise ValueError("Unrecognized configuration input(s): "+", ".join(sorted(unknown)))
                physical = {key: value for key, value in configuration.items() if key in allowed}
            p = Inputs(**physical)
            years = configuration.get("years", 30)
            wells = configuration.get("wells")
            report = configuration.get("report_times")
            geometry = configuration.get('geometry')
        elif args.defaults:
            p, years, wells, report, geometry = Inputs(), 30, None, None, None
        else:
            phase, fluid = ask_phase(args.phase, args.fluid)
            years = args.years if args.years is not None else ask_years()
            p = Inputs(phase_mode=phase, single_phase_fluid=fluid)
            if args.evaporation is not None:
                p.include_evaporation = args.evaporation == "on"
            if args.dissolution is not None:
                p.include_dissolution = args.dissolution == "on"
            if args.observation_period is None:
                ask_observation(p)
            p = ask_inputs(p, phase, fluid)
            wells, report, geometry = None, None, None
        if args.phase is not None:
            p.phase_mode = args.phase
        if args.fluid is not None:
            if p.phase_mode != "single":
                raise ValueError("--fluid requires --phase single.")
            p.single_phase_fluid = args.fluid
        if args.years is not None:
            years = args.years
        if args.evaporation is not None:
            p.include_evaporation = args.evaporation == "on"
        if args.dissolution is not None:
            p.include_dissolution = args.dissolution == "on"
        if args.observation_period is not None:
            p.observation_period_years = args.observation_period
        if args.observation_years is not None:
            p.observation_years = args.observation_years
        limit=pressure_limit_from_cli(args,configuration.get('pressure_limit') if configuration else None)
        if not args.defaults and not args.config and args.max_bhp_psia is None and args.fracture_pressure_psia is None:
            limit=ask_pressure_limit()
        if options.wells_file:
            text = options.wells_file.read_text(encoding="utf-8")
            if options.wells_file.suffix.lower() == ".json":
                content = json.loads(text)
                wells = content.get("wells") if isinstance(content, dict) else content
                if not isinstance(wells, list):
                    raise ValueError("Well JSON must be a list or an object containing wells.")
            else:
                wells = parse_wells_csv(text, p, require_coordinates=options.spacing_mode is None)
        if wells is None:
            if args.defaults or args.config:
                wells=default_wells(p,requested_count,requested_spacing)
                if geometry is None:
                    geometry={'number':len(wells),'mode':'constant','layout':options.layout or 'line',
                              'spacing_ft':requested_spacing}
            else:
                wells,geometry=_ask_wells(p,requested_count,requested_spacing,return_geometry=True)
        if any(value is not None for value in (options.number_wells,options.spacing_ft,options.spacing_mode,
                                                options.layout,options.distance_input,options.adjacent_distances,options.distance_matrix_file)):
            geometry=dict(geometry or {})
            geometry.update(number=options.number_wells if options.number_wells is not None else len(wells),
                            spacing_ft=options.spacing_ft if options.spacing_ft is not None else geometry.get('spacing_ft',1000),
                            layout=options.layout or geometry.get('layout','line'))
            geometry['mode']=options.spacing_mode or ('different' if options.adjacent_distances or options.distance_matrix_file
                                                      else geometry.get('mode','constant'))
            if options.distance_input:
                geometry['different_input']=options.distance_input
            if options.adjacent_distances is not None:
                geometry.update(different_input='adjacent',adjacent_distances_ft=options.adjacent_distances)
            if options.distance_matrix_file:
                geometry.update(different_input='pairwise',pairwise_distances_ft=options.distance_matrix_file.read_text())
        if geometry:
            wells,geometry=configure_well_geometry(p,wells,**geometry)
        if options.report_times is not None:
            report = options.report_times
        result = run_multiwell(p, wells, years, report, detail=not options.no_detail,pressure_limit=limit)
        result['geometry']=geometry
        observation = calculate_multiwell_observation(result, detail=not args.no_plot)
        folder = save_multiwell_results(result, args.output_dir, not args.no_plot, observation)
        print_multiwell_results(result, folder, observation)
        return 0
    except (ValueError, TypeError, OSError, OverflowError, InputUnavailableError) as exc:
        print(f"Calculation stopped: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    try:
        notebook = in_notebook()
        source = globals().get("__file__")
        # %run sets the script's argv; a pasted cell inherits the kernel's argv.
        script_argv = source and sys.argv and Path(sys.argv[0]).resolve() == Path(source).resolve()
        arguments = sys.argv[1:] if script_argv or not notebook else []
        if notebook and not arguments:
            BHP_FORM = show_input_form()
        else:
            exit_status = main(arguments)
            if exit_status and not notebook:
                raise SystemExit(exit_status)
    except InputUnavailableError as exc:
        print(exc)
    except (KeyboardInterrupt, EOFError):
        print("\nInput cancelled.")
