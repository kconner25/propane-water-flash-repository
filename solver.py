"""
Propane + water: flash vessel, then stripping column -- solver only (Step 1).

Teaching model, NOT a predictive design model.
  * Flash: Raoult's law, K_i = P_sat_i(T) / P, vapour pressures from the
    Antoine equation, vapour fraction from the Rachford-Rice equation.
  * Propane + water are nearly immiscible and strongly non-ideal, so a real
    design needs activity coefficients / a 3-phase flash. This model exists
    to teach the calculation sequence: feed -> flash -> flash liquid ->
    stripper (the stripper feed is never a separate input).
  * Stripper: isothermal, constant molar overflow, only propane transfers
    (water loss to the gas and gas dissolving in the liquid are neglected),
    pure inert stripping gas in at the bottom.

Units everywhere in this file:
  flows mol/h, compositions mole fraction, T in degC, P in bar.

Run it on its own to see the worked default case and the self-tests:
    python3 solver.py
"""

import math


# === SECTION 1: Inputs and Antoine constants ===
# Explanation: Turns the temperature into a vapour pressure for propane and
# for water. That tells us how easily each one wants to evaporate.
# Inputs -> Outputs: T (degC) -> P_sat of each component (bar)
#
# Antoine equation, NIST form:  log10(P_sat / bar) = A - B / (T / K + C)
# Propane: NIST (Helgeson & Sage), fit range 277.6-360.8 K.
# Water:   NIST (Stull), fit range 255.9-373 K.
ANTOINE = {
    "propane": {"A": 4.53678, "B": 1149.36, "C": 24.906,
                "T_min_K": 277.6, "T_max_K": 360.8},
    "water":   {"A": 4.65430, "B": 1435.264, "C": -64.848,
                "T_min_K": 255.9, "T_max_K": 373.0},
}

PROPANE_CRITICAL_T_C = 96.7  # above this, liquid propane cannot exist

# One sensible case, pre-loaded so the site (Step 3) solves on open.
DEFAULTS = {                   # keys match solve_all() exactly
    "feed_flow": 100.0,        # mol/h
    "z_propane": 0.30,         # mole fraction propane in the feed
    "flash_T_C": 25.0,
    "flash_P_bar": 1.0,
    "stripper_T_C": 25.0,
    "stripper_P_bar": 1.0,
    "gas_flow": 50.0,          # mol/h of pure inert stripping gas
    "n_stages": 5,
}


def vapour_pressure_bar(component, T_C):
    """Pure-component vapour pressure from the Antoine equation."""
    p = ANTOINE[component]
    T_K = T_C + 273.15
    return 10.0 ** (p["A"] - p["B"] / (T_K + p["C"]))


def antoine_in_range(component, T_C):
    """True if T is inside the temperature range the constants were fit to."""
    p = ANTOINE[component]
    T_K = T_C + 273.15
    return p["T_min_K"] <= T_K <= p["T_max_K"]


# === SECTION 2: K-values ===
# Explanation: Divides each vapour pressure by the flash pressure. K above 1
# means the component prefers the vapour, below 1 it prefers the liquid.
# Inputs -> Outputs: P_sat of each component, P -> K_propane, K_water

def k_values(T_C, P_bar):
    """Raoult's-law K-values, K_i = P_sat_i(T) / P, plus the P_sat values."""
    if P_bar <= 0:
        raise ValueError("Pressure must be positive.")
    psat = {name: vapour_pressure_bar(name, T_C)
            for name in ("propane", "water")}
    K = {name: value / P_bar for name, value in psat.items()}
    return K, psat


# === SECTION 3: Rachford-Rice flash ===
# Explanation: Finds beta, the fraction of the feed that becomes vapour, by
# trying values until the compositions add up correctly.
# Inputs -> Outputs: feed composition, K-values -> beta (0 to 1)

def _rachford_rice_residual(beta, z, K):
    """f(beta) = sum_i z_i (K_i - 1) / (1 + beta (K_i - 1)). Zero at the answer."""
    return sum(z_i * (K_i - 1.0) / (1.0 + beta * (K_i - 1.0))
               for z_i, K_i in zip(z, K))


def solve_vapour_fraction(z, K):
    """Vapour fraction beta for feed mole fractions z and K-values K.

    The two sums are the bubble/dew tests: if sum(z_i K_i) <= 1 the feed is
    a subcooled liquid (beta = 0); if sum(z_i / K_i) <= 1 it is a superheated
    vapour (beta = 1). Otherwise f(beta) falls from + to - on [0, 1] and
    bisection finds the root.
    """
    if sum(z_i * K_i for z_i, K_i in zip(z, K)) <= 1.0:
        return 0.0
    if sum(z_i / K_i for z_i, K_i in zip(z, K)) <= 1.0:
        return 1.0
    lo, hi = 0.0, 1.0
    for _ in range(200):
        mid = 0.5 * (lo + hi)
        if _rachford_rice_residual(mid, z, K) > 0.0:
            lo = mid
        else:
            hi = mid
    return 0.5 * (lo + hi)


# === SECTION 4: Flash streams ===
# Explanation: Uses beta to split the feed into vapour and liquid streams.
# The liquid stream is passed on automatically as the stripper feed.
# Inputs -> Outputs: beta -> V, L, and x, y for both streams

def flash(feed_flow, z_propane, T_C, P_bar):
    """Isothermal flash of a propane + water feed. Returns every stream."""
    if feed_flow <= 0:
        raise ValueError("Feed flow must be positive.")
    if not 0.0 <= z_propane <= 1.0:
        raise ValueError("Feed propane mole fraction must be between 0 and 1.")

    z = [z_propane, 1.0 - z_propane]              # [propane, water]
    K_dict, psat = k_values(T_C, P_bar)
    K = [K_dict["propane"], K_dict["water"]]

    beta = solve_vapour_fraction(z, K)
    x = [z_i / (1.0 + beta * (K_i - 1.0)) for z_i, K_i in zip(z, K)]
    y = [K_i * x_i for K_i, x_i in zip(K, x)]

    V = beta * feed_flow
    L = (1.0 - beta) * feed_flow
    return {
        "beta": beta,
        "K": {"propane": K[0], "water": K[1]},
        "P_sat_bar": psat,
        "vapour": {"flow": V, "x_propane": y[0], "x_water": y[1]},
        "liquid": {"flow": L, "x_propane": x[0], "x_water": x[1]},
        # Component balance error: must be ~0, the site checks this in Step 3.
        "balance_error": max(
            abs(feed_flow * z[0] - (V * y[0] + L * x[0])),
            abs(feed_flow * z[1] - (V * y[1] + L * x[1])),
        ),
    }


# === SECTION 5: Stripper stage stepping ===
# Explanation: Works up the column one stage at a time from the bottom,
# moving propane from the liquid into the rising gas on each stage.
# Inputs -> Outputs: flash liquid, gas flow, stages N -> propane left in the
# water, stage by stage
#
# Stage n receives liquid x_{n-1} from above and gas y_{n+1} from below and
# leaves in equilibrium: y_n = K x_n. The bottom outlet x_N is the one
# unknown, so we guess it, step up to the top, and bisect until the top
# liquid we compute equals the flash liquid we were given (shooting method).

def _profile_from_bottom(x_bottom, K, gas_flow, liquid_flow, n_stages):
    """Liquid/vapour propane mole fractions for a guessed bottom outlet."""
    N = n_stages
    x = [0.0] * (N + 1)        # x[0] = liquid in at top, x[N] = liquid out
    y = [0.0] * (N + 2)        # y[N+1] = gas in at bottom (pure inert: 0)
    x[N] = x_bottom
    y[N] = K * x[N]
    ratio = gas_flow / liquid_flow
    x[N - 1] = x[N] + ratio * (y[N] - y[N + 1])          # stage N balance
    for n in range(N - 1, 0, -1):
        y[n] = K * x[n]
        x[n - 1] = x[n] + ratio * (y[n] - y[n + 1])      # stage n balance
    return x, y


def strip(liquid_flow, x_in, gas_flow, T_C, P_bar, n_stages):
    """Strip propane from the flash liquid with pure inert gas."""
    if liquid_flow <= 0:
        raise ValueError("Stripper feed (flash liquid) flow must be positive.")
    if gas_flow < 0:
        raise ValueError("Stripping gas flow cannot be negative.")
    if int(n_stages) != n_stages or n_stages < 1:
        raise ValueError("Number of stages must be a whole number >= 1.")
    n_stages = int(n_stages)

    K_dict, _ = k_values(T_C, P_bar)
    K = K_dict["propane"]
    S = K * gas_flow / liquid_flow                       # stripping factor

    if x_in == 0.0:
        x_bottom, x, y = 0.0, [0.0] * (n_stages + 1), [0.0] * (n_stages + 2)
    else:
        lo, hi = 0.0, x_in
        for _ in range(100):
            mid = 0.5 * (lo + hi)
            x_try, _ = _profile_from_bottom(mid, K, gas_flow,
                                            liquid_flow, n_stages)
            if x_try[0] < x_in:
                lo = mid
            else:
                hi = mid
        x_bottom = 0.5 * (lo + hi)
        x, y = _profile_from_bottom(x_bottom, K, gas_flow,
                                    liquid_flow, n_stages)

    stages = [{"stage": n, "x_propane": x[n], "y_propane": y[n]}
              for n in range(1, n_stages + 1)]
    return {
        "K_propane": K,
        "stripping_factor_S": S,
        "stages": stages,
        "x_in": x_in,
        "x_out": x_bottom,
        "x_out_ppm": x_bottom * 1.0e6,
        "liquid_out_flow": liquid_flow,                  # constant L (model)
        "propane_to_gas": liquid_flow * (x_in - x_bottom),
        "top_gas_y_propane": y[1],
        "s_too_low": S <= 1.0,   # no number of stages meets a tight spec
    }


# === SECTION 6: Kremser check and outputs ===
# Explanation: Checks the stage stepping against the Kremser shortcut
# equation. If they disagree, something is wrong, and the site warns
# instead of trusting the result.
# Inputs -> Outputs: stripping factor S, N -> check result, and the combined
# numbers for the cards and the stream table

def kremser_fraction_remaining(S, n_stages):
    """x_out / x_in for a stripper with pure inlet gas (Kremser equation)."""
    if abs(S - 1.0) < 1e-12:
        return 1.0 / (n_stages + 1.0)
    if S > 1.0 and (n_stages + 1) * math.log10(S) > 250.0:
        return 0.0          # S^(N+1) would overflow; the fraction is ~0
    return (S - 1.0) / (S ** (n_stages + 1) - 1.0)


def solve_all(feed_flow, z_propane, flash_T_C, flash_P_bar,
              stripper_T_C, stripper_P_bar, gas_flow, n_stages):
    """Full sequence: flash the feed, strip the flash liquid, check it."""
    fl = flash(feed_flow, z_propane, flash_T_C, flash_P_bar)
    st = strip(fl["liquid"]["flow"], fl["liquid"]["x_propane"], gas_flow,
               stripper_T_C, stripper_P_bar, n_stages)

    predicted_x_out = (fl["liquid"]["x_propane"]
                       * kremser_fraction_remaining(st["stripping_factor_S"],
                                                    int(n_stages)))
    if predicted_x_out > 0.0:
        kremser_rel_error = abs(st["x_out"] - predicted_x_out) / predicted_x_out
    else:
        kremser_rel_error = abs(st["x_out"] - predicted_x_out)

    feed_propane = feed_flow * z_propane
    removal_pct = (100.0 * (feed_propane - fl["liquid"]["flow"] * st["x_out"])
                   / feed_propane) if feed_propane > 0 else 100.0

    warnings = []
    for label, T_C in (("Flash", flash_T_C), ("Stripper", stripper_T_C)):
        for name in ("propane", "water"):
            if not antoine_in_range(name, T_C):
                warnings.append(
                    f"{label} T = {T_C} degC is outside the Antoine fit range "
                    f"for {name}; treat that vapour pressure as approximate.")
        if T_C > PROPANE_CRITICAL_T_C - 10.0:
            warnings.append(
                f"{label} T = {T_C} degC is within 10 degC of propane's "
                f"critical temperature ({PROPANE_CRITICAL_T_C} degC); a "
                "separate liquid propane phase may form and this 2-phase "
                "model does not cover it.")
    if st["s_too_low"]:
        warnings.append(
            f"Stripping factor S = {st['stripping_factor_S']:.3f} <= 1: "
            "adding stages cannot meet a tight propane spec. Raise the gas "
            "flow, or raise T / lower P to raise K.")
    if fl["beta"] in (0.0, 1.0):
        warnings.append(
            f"Flash beta = {fl['beta']:.0f}: the feed does not split at "
            "these conditions, so one unit gets the whole feed.")

    return {
        "flash": fl,
        "stripper": st,
        "kremser": {"predicted_x_out": predicted_x_out,
                    "rel_error": kremser_rel_error,
                    "agree": kremser_rel_error < 1e-6},
        "overall": {
            "propane_removal_pct": removal_pct,
            "propane_to_flash_vapour_pct":
                (100.0 * fl["vapour"]["flow"] * fl["vapour"]["x_propane"]
                 / feed_propane) if feed_propane > 0 else 0.0,
        },
        "warnings": warnings,
    }


# ---------------------------------------------------------------------------
# Self-tests and the worked default case. Not a numbered section: this block
# only runs when the file is run directly, never when the website imports it.
# ---------------------------------------------------------------------------

def _run_tests():
    r = solve_all(**{**DEFAULTS})
    fl, st = r["flash"], r["stripper"]

    # Flash compositions close, and the component balances close.
    assert abs(fl["vapour"]["x_propane"] + fl["vapour"]["x_water"] - 1.0) < 1e-9
    assert abs(fl["liquid"]["x_propane"] + fl["liquid"]["x_water"] - 1.0) < 1e-9
    assert fl["balance_error"] < 1e-6, fl["balance_error"]

    # Stage stepping must agree with the Kremser shortcut.
    assert r["kremser"]["agree"], r["kremser"]

    # Pure-component feeds give the obvious answers.
    assert flash(100.0, 0.0, 25.0, 1.0)["beta"] == 0.0    # pure water
    assert flash(100.0, 1.0, 25.0, 1.0)["beta"] == 1.0    # pure propane

    # No stripping gas: nothing is stripped.
    st0 = strip(80.0, 0.10, 0.0, 25.0, 1.0, 5)
    assert abs(st0["x_out"] - 0.10) < 1e-9 and st0["s_too_low"]

    # Kremser at S = 1 exactly: fraction remaining is 1 / (N + 1).
    assert abs(kremser_fraction_remaining(1.0, 9) - 0.1) < 1e-12

    print("Default case (feed 100 mol/h, 30 mol% propane, flash and "
          "stripper both 25 degC / 1 bar, gas 50 mol/h, N = 5)")
    print(f"  P_sat: propane {fl['P_sat_bar']['propane']:.3f} bar, "
          f"water {fl['P_sat_bar']['water']:.4f} bar")
    print(f"  K:     propane {fl['K']['propane']:.3f}, "
          f"water {fl['K']['water']:.4f}")
    print(f"  beta = {fl['beta']:.4f}   V = {fl['vapour']['flow']:.2f} mol/h "
          f"(y_C3 = {fl['vapour']['x_propane']:.4f})   "
          f"L = {fl['liquid']['flow']:.2f} mol/h "
          f"(x_C3 = {fl['liquid']['x_propane']:.4f})")
    print(f"  Stripper: S = {st['stripping_factor_S']:.3f}, "
          f"x_in = {st['x_in']:.4f} -> x_out = {st['x_out']:.3e} "
          f"({st['x_out_ppm']:.1f} ppm)")
    print(f"  Kremser check: predicted x_out = "
          f"{r['kremser']['predicted_x_out']:.3e}, rel. error "
          f"{r['kremser']['rel_error']:.2e} -> agree")
    print(f"  Overall propane removal: "
          f"{r['overall']['propane_removal_pct']:.2f} %")
    print("All self-tests passed.")


if __name__ == "__main__":
    _run_tests()
