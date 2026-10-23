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
  link.addEventListener("click", function () {
    showTab(link.dataset.gotoTab);
    // "See the code" links also jump to their section of solver.py.
    const target = link.dataset.gotoSection &&
      document.getElementById("code-section-" + link.dataset.gotoSection);
    if (target && target.scrollIntoView) target.scrollIntoView();
  });
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

  // Step 4: keep this result for the charts, show the full column,
  // and (re)draw both charts.
  lastResult = result;
  lastInputs = inputs;
  stopPlay();
  currentStage = result.stripper.stages.length;
  drawCharts();
  updateTransport();
}

function renderError(err) {
  stopPlay();
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
    buildCodeTab(solverCode);
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

/* ---------- 4. Charts and stage stepping (Step 4) ----------
 *
 * Two Plotly charts, both fed from the stripper part of the last result:
 *   a) Stage profile: propane in the liquid leaving each stage, log scale.
 *      Point 0 is the liquid entering the top (the flash liquid).
 *   b) Stepping diagram: equilibrium line y = Kx, operating line through
 *      (x_out, 0) and (x_in, y_top), and the staircase between them.
 *      The full staircase has 1 + 2N points, built from the bottom up;
 *      revealing the first k stages from the top is a slice of that list,
 *      because the segments join end to end.
 *
 * The transport controls (reset / back / step / play / slider) only change
 * how much of the already-computed column is revealed. They never re-run
 * the solver. When the inputs change, the new result is shown in full.
 */

let lastResult = null;
let lastInputs = null;
let currentStage = 0;      // stages revealed so far, 0..N
let playTimer = null;

function drawCharts() {
  if (!lastResult) return;
  const profileDiv = document.getElementById("chart-stage-profile");
  const stepDiv = document.getElementById("chart-stepping");
  if (typeof Plotly === "undefined") {
    profileDiv.textContent = "Charts could not load (Plotly unreachable). " +
                             "The numbers above are unaffected.";
    stepDiv.textContent = "";
    return;
  }
  const st = lastResult.stripper;
  const N = st.stages.length;
  const k = currentStage;
  const layoutBase = { margin: { t: 10, r: 16, b: 46, l: 62 },
                       showlegend: true, legend: { orientation: "h", y: -0.22 } };
  const config = { responsive: true, displaylogo: false };

  // (a) Stage profile, revealing points 0..k
  if (st.x_in > 0) {
    const xs = [0], ys = [st.x_in];
    st.stages.forEach(function (s) { xs.push(s.stage); ys.push(s.x_propane); });
    Plotly.react(profileDiv, [{
      x: xs.slice(0, k + 1), y: ys.slice(0, k + 1),
      mode: "lines+markers", type: "scatter", name: "liquid leaving stage",
      line: { color: "#dc2626" }, marker: { color: "#dc2626", size: 8 },
      hovertemplate: "stage %{x}: x = %{y:.3e}<extra></extra>",
    }], Object.assign({}, layoutBase, {
      xaxis: { title: "stage (0 = liquid entering the top)", dtick: 1, range: [-0.2, N + 0.2] },
      yaxis: { title: "propane in liquid [mol/mol]", type: "log", exponentformat: "e" },
      showlegend: false,
    }), config);
  } else {
    Plotly.react(profileDiv, [], Object.assign({}, layoutBase, {
      annotations: [{ text: "No propane enters the stripper in this case.",
                      showarrow: false, font: { color: "#64748b" } }],
      xaxis: { title: "stage" }, yaxis: { title: "propane in liquid [mol/mol]" },
      showlegend: false,
    }), config);
  }

  // (b) Stepping diagram, revealing the steps for stages 1..k
  const K = st.K_propane;
  const xArr = [st.x_in], yArr = [null];           // index = stage number
  st.stages.forEach(function (s) { xArr[s.stage] = s.x_propane; yArr[s.stage] = s.y_propane; });
  const yTop = N >= 1 ? yArr[1] : 0;
  const xMax = Math.max(st.x_in * 1.08, 1e-6);
  const yMax = Math.max(yTop * 1.15, 0.02);
  const traces = [
    { x: [0, yMax / K], y: [0, yMax], mode: "lines", type: "scatter",
      name: "equilibrium  y = Kx", line: { color: "#2563eb" } },
    { x: [st.x_out, st.x_in], y: [0, yTop], mode: "lines", type: "scatter",
      name: "operating line", line: { color: "#1e293b", dash: "dash" } },
  ];
  if (k > 0 && st.x_in > 0) {
    const full = [{ x: xArr[N], y: 0 }];
    for (let n = N; n >= 1; n--) {
      full.push({ x: xArr[n], y: yArr[n] }, { x: xArr[n - 1], y: yArr[n] });
    }
    const visible = full.slice(2 * (N - k));
    traces.push({
      x: visible.map(function (p) { return p.x; }),
      y: visible.map(function (p) { return p.y; }),
      mode: "lines+markers", type: "scatter", name: "stages 1–" + k,
      line: { color: "#dc2626" }, marker: { color: "#dc2626", size: 6 },
      hovertemplate: "x = %{x:.3e}, y = %{y:.3e}<extra></extra>",
    });
  }
  Plotly.react(stepDiv, traces, Object.assign({}, layoutBase, {
    xaxis: { title: "x — propane in liquid [mol/mol]", range: [0, xMax] },
    yaxis: { title: "y — propane in vapour [mol/mol]", range: [0, yMax] },
  }), config);
}

function captionText() {
  const st = lastResult.stripper;
  const N = st.stages.length, k = currentStage;
  if (k === 0) {
    return "Stage 0 of " + N + ": liquid enters the top at x = " +
           fmtFrac(st.x_in) + " propane (the flash liquid). " +
           "Step forward to follow it down the column.";
  }
  if (k === N) {
    return "Stage " + N + " of " + N + ": bottom of the column. Stripped " +
           "water leaves at x = " + fmtFrac(st.x_out) + " (" +
           fmtPpm(st.x_out_ppm) + " ppm); gas leaves the top at y = " +
           fmtFrac(st.top_gas_y_propane) + " propane.";
  }
  const s = st.stages[k - 1];
  return "Stage " + k + " of " + N + ": liquid leaves at x = " +
         fmtFrac(s.x_propane) + ", vapour leaves at y = " +
         fmtFrac(s.y_propane) + " propane.";
}

function updateTransport() {
  const N = lastResult ? lastResult.stripper.stages.length : 0;
  setText("stage-now", String(currentStage));
  setText("stage-max", lastResult ? String(N) : "—");
  const slider = document.getElementById("stage-slider");
  slider.max = N;
  slider.value = currentStage;
  slider.disabled = !lastResult;
  document.getElementById("btn-step").disabled = !lastResult || currentStage >= N;
  document.getElementById("btn-back").disabled = !lastResult || currentStage <= 0;
  document.getElementById("btn-reset").disabled = !lastResult || currentStage <= 0;
  document.getElementById("btn-play").disabled = !lastResult;
  setText("stage-caption", lastResult ? captionText() : "Waiting for the solver…");
}

function setStage(k) {
  if (!lastResult) return;
  const N = lastResult.stripper.stages.length;
  currentStage = Math.max(0, Math.min(N, k));
  drawCharts();
  updateTransport();
}

function stopPlay() {
  if (playTimer) {
    clearInterval(playTimer);
    playTimer = null;
    document.getElementById("btn-play").textContent = "Play";
  }
}

function togglePlay() {
  if (playTimer) { stopPlay(); updateTransport(); return; }
  if (!lastResult) return;
  if (currentStage >= lastResult.stripper.stages.length) setStage(0);
  document.getElementById("btn-play").textContent = "Pause";
  playTimer = setInterval(function () {
    setStage(currentStage + 1);
    if (currentStage >= lastResult.stripper.stages.length) {
      stopPlay();
      updateTransport();
    }
  }, 900);
  updateTransport();
}

/* ---------- 5. Python tab: the solver's own code, in sections (Step 5) ----------
 *
 * buildCodeTab() receives the exact text of solver.py that init() fetched
 * and ran, splits it at the "# === SECTION n: ... ===" markers, and builds
 * one block per section: heading, short explanation, inputs -> outputs
 * line, then the code. Because the display is generated from the running
 * file, the two can never disagree.
 *
 * Each section of solver.py also carries its explanation as a comment;
 * that comment header is dropped from the displayed code (it is the box
 * above it), but every other comment is kept.
 */

const SECTION_EXPLANATIONS = {
  0: { explain: "The file opens by stating what the model is, what it " +
                "leaves out, and the units used everywhere. Read this " +
                "before trusting any number the site shows.",
       inout: "" },
  1: { explain: "Turns the temperature into a vapour pressure for propane " +
                "and for water. That tells us how easily each one wants " +
                "to evaporate.",
       inout: "T (degC) -> P_sat of each component (bar)" },
  2: { explain: "Divides each vapour pressure by the flash pressure. " +
                "K above 1 means the component prefers the vapour, " +
                "below 1 it prefers the liquid.",
       inout: "P_sat of each component, P -> K_propane, K_water" },
  3: { explain: "Finds beta, the fraction of the feed that becomes vapour, " +
                "by trying values until the compositions add up correctly.",
       inout: "feed composition, K-values -> beta (0 to 1)" },
  4: { explain: "Uses beta to split the feed into vapour and liquid " +
                "streams. The liquid stream is passed on automatically " +
                "as the stripper feed.",
       inout: "beta -> V, L, and x, y for both streams" },
  5: { explain: "Works up the column one stage at a time from the bottom, " +
                "moving propane from the liquid into the rising gas on " +
                "each stage.",
       inout: "flash liquid, gas flow, stages N -> propane left in the " +
              "water, stage by stage" },
  6: { explain: "Checks the stage stepping against the Kremser shortcut " +
                "equation. If they disagree, something is wrong, and the " +
                "site warns instead of trusting the result.",
       inout: "stripping factor S, N -> check result, and the combined " +
              "numbers for the cards and the stream table" },
  tests: { explain: "Runs the solver on cases with known answers — pure " +
                    "feeds, closed balances, the Kremser comparison — and " +
                    "prints the worked default case. This block runs only " +
                    "when the file is run directly, never on the website.",
           inout: "" },
};

function buildCodeTab(source) {
  const container = document.getElementById("code-sections");
  if (!container) return;

  // Split at the section markers. Text before Section 1 (the module
  // docstring) becomes block 0.
  const blocks = [{ num: 0, title: "Top of the file — what this model is, and is not", lines: [] }];
  let current = blocks[0];
  source.split("\n").forEach(function (line) {
    const m = line.match(/^# === SECTION (\d+): (.+) ===$/);
    if (m) {
      current = { num: parseInt(m[1], 10), title: m[2], lines: [] };
      blocks.push(current);
    } else {
      current.lines.push(line);
    }
  });

  // The self-tests sit after Section 6, behind a dashed divider; split
  // them into their own block so Section 6 stays about the check itself.
  const lastBlock = blocks[blocks.length - 1];
  const cut = lastBlock.lines.findIndex(function (l) { return /^# -{10,}$/.test(l); });
  if (cut >= 0) {
    blocks.push({ num: "tests", title: "End of the file — self-tests",
                  lines: lastBlock.lines.slice(cut) });
    lastBlock.lines = lastBlock.lines.slice(0, cut);
  }

  blocks.forEach(function (block) {
    let ls = block.lines.slice();
    if (typeof block.num === "number" && block.num >= 1) {
      // Drop the leading explanation comment: stop at its "#" separator
      // line, or at the first non-comment line if there is no separator.
      // Only drop it if it really was the explanation header.
      let i = 0;
      while (i < ls.length && ls[i].startsWith("#")) {
        const isSeparator = ls[i].trim() === "#";
        i++;
        if (isSeparator) break;
      }
      if (ls.slice(0, i).join("\n").includes("Explanation:")) ls = ls.slice(i);
    }
    const codeText = ls.join("\n").trim();
    if (!codeText) return;

    const wrap = document.createElement("div");
    wrap.className = "code-section";
    wrap.id = "code-section-" + block.num;

    const h = document.createElement("h3");
    h.textContent = (typeof block.num === "number" && block.num >= 1
                     ? block.num + " · " : "") + block.title;
    wrap.appendChild(h);

    const meta = SECTION_EXPLANATIONS[block.num];
    if (meta) {
      const ex = document.createElement("div");
      ex.className = "code-explain";
      ex.textContent = meta.explain;
      wrap.appendChild(ex);
      if (meta.inout) {
        const io = document.createElement("p");
        io.className = "code-inout";
        io.textContent = "Inputs -> Outputs: " + meta.inout;
        wrap.appendChild(io);
      }
    }

    const pre = document.createElement("pre");
    pre.className = "code-block";
    const code = document.createElement("code");
    code.textContent = codeText;      // textContent: no HTML escaping bugs
    pre.appendChild(code);
    wrap.appendChild(pre);

    container.appendChild(wrap);
  });
}

document.getElementById("btn-step").addEventListener("click", function () {
  stopPlay(); setStage(currentStage + 1);
});
document.getElementById("btn-back").addEventListener("click", function () {
  stopPlay(); setStage(currentStage - 1);
});
document.getElementById("btn-reset").addEventListener("click", function () {
  stopPlay(); setStage(0);
});
document.getElementById("btn-play").addEventListener("click", togglePlay);
document.getElementById("stage-slider").addEventListener("input", function () {
  stopPlay();
  setStage(parseInt(document.getElementById("stage-slider").value, 10));
});

init();
