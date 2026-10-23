/* app.js -- the glue between the page and solver.py (Step 3).
 *
 * What this file does, in order:
 *   1. Tab switching (moved here from the skeleton's inline script).
 *   2. Loads Python in the browser (Pyodide), fetches solver.py and runs it.
 *      The browser cannot run a .py file by itself; Pyodide is the translator.
 *   3. On any sidebar input change: reads the inputs by id, hands them to
 *      solver.solve_all() in Python, and writes the returned numbers into
 *      the flowsheet strip, the 4 cards, the stream table and the warnings box.
 *
 * This file contains NO engineering equations. All the math stays in
 * solver.py; this file only moves numbers between the page and the solver.
 */
"use strict";

/* ---------- 1. Tabs ---------- */

function showTab(name) {
  document.querySelectorAll(".tab").forEach(function (b) {
    b.classList.toggle("active", b.dataset.tab === name);
  });
  ["app", "theory", "python"].forEach(function (n) {
    document.getElementById("panel-" + n).hidden = (n !== name);
  });
}
document.querySelectorAll(".tab").forEach(function (btn) {
  btn.addEventListener("click", function () { showTab(btn.dataset.tab); });
});
document.querySelectorAll("[data-goto-tab]").forEach(function (link) {
  link.addEventListener("click", function () { showTab(link.dataset.gotoTab); });
});

/* ---------- helpers: reading inputs, formatting numbers ---------- */

// Solver argument names, in the order solve_all() expects them.
// The sidebar input ids are these same names (done on purpose in Step 2).
const SOLVER_ARGS = ["feed_flow", "z_propane", "flash_T_C", "flash_P_bar",
                     "stripper_T_C", "stripper_P_bar", "gas_flow", "n_stages"];

function readInputs() {
  const values = {};
  for (const name of SOLVER_ARGS) {
    const raw = document.getElementById(name).value;
    const v = (name === "n_stages") ? parseInt(raw, 10) : parseFloat(raw);
    if (!Number.isFinite(v)) throw new Error("Input '" + name + "' is not a number.");
    values[name] = v;
  }
  return values;
}

function fmtFlow(x) { return x.toFixed(2); }                    // mol/h
function fmtPct(x) { return (x > 99.9 ? x.toFixed(3) : x.toFixed(2)) + " %"; }
function fmtFrac(x) {                                            // mole fraction
  if (x === 0) return "0";
  return Math.abs(x) < 0.001 ? x.toExponential(2) : x.toFixed(4);
}
function fmtPpm(ppm) {
  if (ppm < 0.01) return "<0.01";
  if (ppm < 10) return ppm.toFixed(2);
  if (ppm < 1000) return ppm.toFixed(1);
  return Math.round(ppm).toLocaleString("en-US");
}
function setText(id, text) { document.getElementById(id).textContent = text; }
function setRow(rowId, flow, xPropane, xWater) {
  const cells = document.querySelectorAll("#" + rowId + " td");
  cells[1].textContent = flow;
  cells[2].textContent = xPropane;
  cells[3].textContent = xWater;
}

/* ---------- 3. Rendering one solver result onto the page ---------- */

function render(result, inputs) {
  const fl = result.flash, st = result.stripper;
  const specPpm = parseFloat(document.getElementById("spec_ppm").value);

  // Flowsheet strip
  setText("stream-feed", fmtFlow(inputs.feed_flow) + " mol/h");
  setText("stream-vapour", fmtFlow(fl.vapour.flow) + " mol/h");
  setText("stream-liquid", fmtFlow(fl.liquid.flow) + " mol/h");
  setText("stream-stripped", fmtPpm(st.x_out_ppm) + " ppm propane");

  // The 4 cards
  setText("card-beta", fl.beta.toFixed(4));
  setText("card-split", fmtPct(result.overall.propane_to_flash_vapour_pct));
  setText("card-ppm", fmtPpm(st.x_out_ppm) + " ppm");
  setText("card-removal", fmtPct(result.overall.propane_removal_pct));

  // Spec pill on the stripped-water card: green if the target is met.
  const pill = document.getElementById("card-spec-pill");
  const meets = Number.isFinite(specPpm) && st.x_out_ppm <= specPpm;
  pill.textContent = Number.isFinite(specPpm)
    ? (meets ? "✓ meets spec (≤ " + fmtPpm(specPpm) + " ppm)"
             : "✗ above spec (≤ " + fmtPpm(specPpm) + " ppm)")
    : "spec: —";
  pill.classList.toggle("ok", meets);
  pill.classList.toggle("bad", Number.isFinite(specPpm) && !meets);

  // Stream table. Solver's vapour dict calls its mole fractions x_propane /
  // x_water; for the vapour stream those ARE the y values.
  // Column flows are the model's constant-molar-overflow flows (see the
  // note under the table in index.html).
  setRow("row-feed", fmtFlow(inputs.feed_flow),
         fmtFrac(inputs.z_propane), fmtFrac(1 - inputs.z_propane));
  setRow("row-vapour", fmtFlow(fl.vapour.flow),
         fmtFrac(fl.vapour.x_propane), fmtFrac(fl.vapour.x_water));
  setRow("row-liquid", fmtFlow(fl.liquid.flow),
         fmtFrac(fl.liquid.x_propane), fmtFrac(fl.liquid.x_water));
  setRow("row-gas-in", fmtFlow(inputs.gas_flow), "0", "0");
  setRow("row-top-gas", fmtFlow(inputs.gas_flow),
         fmtFrac(st.top_gas_y_propane), "0");
  setRow("row-stripped", fmtFlow(st.liquid_out_flow),
         fmtFrac(st.x_out), fmtFrac(1 - st.x_out));
  document.querySelectorAll("#row-balance td")[1].textContent =
    fl.balance_error.toExponential(1) + " mol/h (flash)";

  // Warnings: everything the solver flagged, plus the Kremser cross-check.
  const warnings = result.warnings.slice();
  if (!result.kremser.agree) {
    warnings.push("Stage stepping and the Kremser check disagree — " +
                  "do not trust these numbers.");
  }
  const box = document.getElementById("warnings");
  box.hidden = warnings.length === 0;
  box.textContent = warnings.join("  ");
}

function renderError(err) {
  // Python errors arrive as a long traceback; show only its last line,
  // which is the actual message (e.g. "ValueError: Pressure must be...").
  const lines = String(err && err.message ? err.message : err)
    .split("\n").map(function (s) { return s.trim(); }).filter(Boolean);
  const box = document.getElementById("warnings");
  box.hidden = false;
  box.textContent = "Solver error: " + (lines[lines.length - 1] || "unknown error");
}

/* ---------- 2. Loading Python and wiring the inputs ---------- */

let pyodide = null;
let solverReady = false;

async function init() {
  const badge = document.getElementById("py-status");
  try {
    badge.textContent = "Python: loading…";
    pyodide = await loadPyodide({
      indexURL: "https://cdn.jsdelivr.net/pyodide/v0.26.4/full/",
    });
    const solverCode = await (await fetch("solver.py")).text();
    // The solver file, plus one small wrapper that returns its result as
    // JSON text so JavaScript can read it.
    pyodide.runPython(solverCode + "\n" + [
      "import json as _json",
      "def solve_json(feed_flow, z_propane, flash_T_C, flash_P_bar,",
      "               stripper_T_C, stripper_P_bar, gas_flow, n_stages):",
      "    return _json.dumps(solve_all(feed_flow, z_propane, flash_T_C,",
      "        flash_P_bar, stripper_T_C, stripper_P_bar, gas_flow,",
      "        int(n_stages)))",
    ].join("\n"));
    solverReady = true;
    badge.textContent = "Python: ready";
    badge.classList.add("ready");
    update();
  } catch (err) {
    badge.textContent = "Python: failed to load";
    renderError(err);
  }
}

function update() {
  if (!solverReady) return;
  try {
    const inputs = readInputs();
    // Hand the numbers to Python through named globals, not by building a
    // code string out of user input.
    SOLVER_ARGS.forEach(function (name, i) {
      pyodide.globals.set("a" + i, inputs[name]);
    });
    const json = pyodide.runPython("solve_json(a0, a1, a2, a3, a4, a5, a6, a7)");
    render(JSON.parse(json), inputs);
  } catch (err) {
    renderError(err);
  }
}

document.querySelectorAll(".sidebar input, .sidebar select").forEach(function (el) {
  el.addEventListener("input", update);
  el.addEventListener("change", update);
});

init();
