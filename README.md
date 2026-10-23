# Propane + Water: Flash, Then Stripping

An interactive teaching website for a two-unit separation sequence: a
propane + water feed enters a **flash vessel**, and the liquid from the
flash becomes the feed to a **stripping column**, where inert gas removes
the remaining propane. Change any input and every result updates — the
stripper feed is always the flash liquid, never a separate input.

**Live site:** once GitHub Pages is enabled (see *Deploy* below), the site
is at `https://<your-username>.github.io/<this-repo>/`

Layout and interaction style are modelled on
[chetools' Sequential Design of Experiments](https://chetools.github.io/claude/sequential-design/).

## The three tabs

- **App** — sidebar inputs (feed, flash, stripper), four result cards,
  a stream table, a stage-profile chart and a stepping diagram, with
  controls to step through the column stage by stage.
- **Theory** — the governing equations: Raoult's law and the Antoine
  equation, the Rachford–Rice flash equation, the stage balance, the
  stripping factor S, and the Kremser equation — including why S ≤ 1
  cannot be fixed by adding stages.
- **Python — step by step** — the actual solver code, on screen, split
  into six sections, each with a short plain-English explanation and its
  inputs → outputs. The code shown is generated live from `solver.py`
  itself, so it is always the code that produced the numbers.

## Files

| File | Job |
|---|---|
| `solver.py` | All of the engineering math, in six numbered sections. No page code. |
| `index.html` | Page structure: sidebar, cards, tables, tabs, Theory text. |
| `style.css` | Appearance only: layout, colours, cards. |
| `app.js` | The glue: loads the solver, reads inputs, draws cards, table and charts. No equations. |

There is no server and no build step. The browser runs the Python itself
using [Pyodide](https://pyodide.org) (0.26.4) and draws the charts with
[Plotly](https://plotly.com/javascript/) (2.35.2), both loaded from CDNs.

## The model — and its limits

**Teaching model, not a design prediction.** Propane and water are nearly
immiscible, so the Raoult's-law flash used here is not physically
predictive for this pair; a real design needs activity coefficients or a
3-phase flash. The point of the site is the calculation sequence and how
the units connect.

- Flash: K_i = P_sat_i(T)/P, vapour pressures from the Antoine equation
  (constants from the NIST Chemistry WebBook), vapour fraction β from the
  Rachford–Rice equation.
- Stripper: isothermal, constant molar overflow, only propane transfers,
  pure inert gas in at the bottom. Stages are stepped by a shooting
  method and checked against the Kremser equation on every calculation;
  the site warns if they disagree, if the stripping factor S ≤ 1, if a
  temperature is outside an Antoine fit range, or near propane's
  critical temperature (96.7 °C).

Default case on load: 100 mol/h feed, 30 mol% propane, flash and column
both at 25 °C / 1 bar, 50 mol/h stripping gas, 5 stages → β = 0.2278,
flash liquid 77.22 mol/h at 10.20 mol% propane, stripped water at
9.6 ppm propane (S = 6.17).

## Run it locally

Downloading the files and double-clicking `index.html` does **not** work:
the page fetches `solver.py`, and browsers block that from a `file://`
page. Serve the folder instead:

```bash
cd propane-water-flash-stripper
python3 -m http.server
# open http://localhost:8000
```

## Test the solver on its own

`solver.py` needs nothing but Python 3. Running it executes its
self-tests (component balances, pure-component feeds, the
stage-stepping vs Kremser comparison) and prints the worked default case:

```bash
python3 solver.py
```

## Deploy (GitHub Pages)

1. All five files (`index.html`, `style.css`, `app.js`, `solver.py`,
   `README.md`) sit at the top level of the repository, with exactly
   those names.
2. In the repository: **Settings → Pages**.
3. Under *Build and deployment*, Source: **Deploy from a branch**;
   Branch: **main**, folder **/ (root)**; **Save**.
4. Wait about a minute, then visit
   `https://<your-username>.github.io/<this-repo>/`.
   The sidebar badge should read "Python: ready" and the cards should
   show the default case above.

## How this was built

Built step by step with an AI assistant (Muse) as the coder, with each
step explained and tested before the next began:

1. `solver.py` — the math, with self-tests.
2. `index.html` + `style.css` — the page skeleton in the reference site's style.
3. `app.js` — wiring the inputs to the solver through Pyodide.
4. Charts (Plotly) and the stage step-through controls.
5. The Theory tab and the on-screen code tab.
6. This README and GitHub Pages deployment.

Antoine constants: NIST Chemistry WebBook (propane: Helgeson & Sage fit,
277.6–360.8 K; water: Stull fit, 255.9–373 K).
