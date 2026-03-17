# Design Assistant Optimizer Redesign

## Problem Statement

The current optimizer in the Design Assistant tab produces poor results for three reasons:

1. **Corrupted merit function** — Smoothness, peak count, and thickness penalties are added to the target error, causing solutions that hit targets to score worse than solutions that miss targets but are "smoother." This is why solutions go outside target boxes.
2. **Pure random search** — Phase 1 generates fully random layer stacks. Phase 2 perturbs all layers simultaneously, preventing convergence.
3. **Rigid configuration** — Fixed layer count and forced alternating H/L materials prevent the optimizer from exploring the full design space.

## Requirements

- Target boxes must be **hard constraints** — any solution that violates them is rejected
- Error number must reflect **only target deviation** — no phantom penalties
- Materials are a **palette** — optimizer picks the best subset from selected materials
- Layer count is a **range** (min-max), not a fixed number
- CSV reverse engineering treats every data point as an individual target
- Optimizer must converge reliably on multi-box targets across different spectral regions

## Design

### 1. Merit Function Redesign

**Hard constraint check (pass/fail):**
Before scoring, check every target. For each target box, sample the reflectivity curve every 2nm across its wavelength range. If ANY sample falls outside the reflectivity min/max bounds, the solution is rejected entirely.

For reverse engineering mode, each CSV point has a tolerance band (default ±1%, user-adjustable). If any calculated reflectivity falls outside that band, the solution is rejected.

**Error score (for ranking valid solutions):**
- **Target mode:** RMS deviation from the midpoint of each target box, sampled every 2nm.
- **Reverse engineering mode:** RMS deviation between calculated reflectivity and each CSV data point.
- **Color target mode:** Delta E from target color (unchanged).

**Removed penalties:**
- No smoothness penalty
- No peak count penalty
- No thickness penalty
- The curve can do whatever it wants outside defined targets

### 2. Optimization Algorithm — Needle Refinement

Three-phase optimization replacing the current random search + random perturbation.

**Phase 1: Seed Generation**
- Generate random candidate stacks using the material palette and layer count range
- Filter with hard constraints — discard any that violate targets
- Keep the top 20 seeds that pass constraints (or top 20 by error if none pass yet)
- Uses the existing user-configurable iteration counts (target mode / reverse engineering)

**Phase 2: Needle Refinement (coordinate descent)**
For each of the top 20 seeds:
1. Pick layer 1. Try adjusting thickness by small amounts (+1nm, -1nm, +5nm, -5nm, +10nm, -10nm)
2. Keep whichever adjustment gives the best error AND passes hard constraints
3. Move to next layer, repeat
4. Continue through all layers — one "sweep"
5. Run sweeps until convergence (error improvement < 0.01%) or max 50 sweeps

Step sizes adapt: start coarse (±20nm), then medium (±5nm), then fine (±1nm).

**Phase 3: Material Swapping**
After thickness optimization converges:
1. For each layer, try swapping its material for every other material in the palette
2. Re-run a quick needle sweep after each swap
3. Keep the swap if it improves score while maintaining hard constraints

**Solution selection:**
Return the best 5 distinct solutions (differ by > 5nm total stack difference to avoid near-identical results).

### 3. Material Palette & Layer Count Flexibility

**Material selection:**
- Selected materials are the available palette — optimizer picks the best combination
- No forced alternating low/high index (though alternating H/L naturally emerges for most coatings)
- "Select All" and "Deselect All" buttons above material checkboxes
- Layer template mode overrides palette — materials are fixed per-layer when template is active

**Layer count:**
- Replace single "Number of Layers" with Min Layers (default 3) and Max Layers (default 12)
- Phase 1 seeds pick random layer counts within this range
- During refinement, layers with thickness < 5nm can be removed
- Layer template mode overrides — layer count is fixed to template length

### 4. Reverse Engineering Improvements

**Per-point constraints:**
- Each CSV row (wavelength, reflectivity) is an individual constraint
- Match tolerance: ±1% reflectivity by default, user-adjustable via "Match Tolerance (±%)" input
- Prevents shape-shifting — optimizer can't cheat by matching average while being off at individual points

**Error reporting:**
- Show max deviation alongside RMS error in solution previews
- Per-point accountability replaces aggregate-only scoring

### 5. UI Changes

**Controls panel:**
- Add "Select All" / "Deselect All" buttons above material checkboxes
- Replace "Number of Layers" with "Min Layers" and "Max Layers" fields
- Remove "Minimize Reflectivity Peaks" checkbox
- Remove smoothness weight slider
- Relabel "Max Error Threshold" to "Max Error (%)" with updated tooltip

**Reverse engineering additions:**
- New "Match Tolerance (±%)" input (default 1.0)
- Solution previews show "Max deviation: X%" alongside "RMS error: X%"

**Solution display:**
- Target mode: green checkmark or red X per target box for hard constraint pass/fail
- Error number reflects only target deviation

**Unchanged:**
- Target point builder
- Color target mode controls
- CSV upload
- Layer template mode
- Adhesion layer controls
- Solution preview charts
- "Add as Stack" button
- Iteration count inputs

### 6. Progress Feedback

**Live progress updates:**
- Phase 1: "Generating candidates... X valid seeds found"
- Phase 2: "Refining solution X of 20 — current best error: Y%"
- Phase 3: "Testing material swaps... improvements found: X"

**Guard rails:**
- If zero valid seeds found: "No solutions found that satisfy all constraints. Try: widening target boxes, adding more materials, or increasing max layer count."
- Convergence detection: stop needle sweeps when error improvement < 0.01%
- Max 50 sweeps per seed to prevent infinite loops

**Performance target:**
- Under 60 seconds for typical cases (5-8 layers, 2-3 target boxes)
- Complex cases (12+ layers, dense CSV) may take longer — progress indicator keeps user informed

## Implementation Scope

All changes are within `src/opticoat-designer.js`:
- `optimizeDesign` function (~650 lines, lines 5115-5765): Complete rewrite of optimization logic
- Design Assistant UI section (lines ~8646+): UI control modifications
- State variables (lines ~429-458): Update/add state for min/max layers, match tolerance

No backend changes. No new files. No new dependencies.
