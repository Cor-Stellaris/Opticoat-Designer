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
Before scoring, check every target. For each target box, sample the reflectivity curve every 5nm across its wavelength range (with a final 2nm validation pass on the best solutions before returning results). If ANY sample falls outside the reflectivity min/max bounds, the solution is rejected entirely.

For reverse engineering mode, each CSV point has a tolerance band (default ±1%, user-adjustable). If any calculated reflectivity falls outside that band, the solution is rejected.

For color target mode, hard constraints are not applied — Delta E is inherently a continuous metric. The error score is Delta E from the target color. Existing angle color constraints (`maxShift` and `target` modes) remain as soft penalties added to the Delta E score, unchanged from the current implementation.

**Error score (for ranking valid solutions):**
- **Target mode:** RMS deviation from the midpoint of each target box, sampled every 5nm. Design points with `useWavelengthRange=false` use their single wavelength. Design points with `useReflectivityRange=false` use the midpoint of min/max as the target value.
- **Reverse engineering mode:** RMS deviation between calculated reflectivity and each CSV data point.
- **Color target mode:** Delta E from target color + angle constraint penalties (unchanged from current).

**Removed penalties:**
- No smoothness penalty
- No peak count penalty
- No thickness penalty
- The curve can do whatever it wants outside defined targets

### 2. Optimization Algorithm — Needle Refinement

Three-phase optimization replacing the current random search + random perturbation.

**Phase 1: Seed Generation**
- Generate random candidate stacks using the material palette and layer count range
- Score every seed using a **constraint-aware merit function**: the base error score (RMS deviation from targets) plus a **constraint violation penalty** equal to the sum of all out-of-bounds deviations squared. This means seeds that are "close" to satisfying constraints rank higher than seeds that are far off, enabling Phase 2 to converge toward compliance.
- Keep the top 20 seeds by this combined score
- Seeds that fully satisfy hard constraints are always ranked above those that don't
- Uses the existing user-configurable iteration counts (target mode / reverse engineering)

**Phase 2: Needle Refinement (coordinate descent)**
For each of the top 20 seeds, run three passes with decreasing step sizes:
- **Coarse pass:** Try ±20nm and ±10nm per layer, sweep all layers, repeat until convergence or 15 sweeps
- **Medium pass:** Try ±5nm and ±2nm per layer, sweep all layers, repeat until convergence or 15 sweeps
- **Fine pass:** Try ±1nm and ±0.5nm per layer, sweep all layers, repeat until convergence or 20 sweeps

For each perturbation: keep the adjustment that gives the best combined score (error + constraint violation penalty). As seeds converge toward constraint satisfaction, the penalty naturally drops to zero and the optimizer focuses purely on minimizing error.

Convergence: stop a pass when the score improvement is < 0.01% between sweeps.

**Phase 3: Material Swapping**
After thickness optimization converges:
1. For each layer, try swapping its material for every other material in the palette
2. After a beneficial swap, run a **short** fine-pass needle sweep (max 5 sweeps, ±1nm steps only)
3. Keep the swap if it improves score while maintaining constraints
4. If no swap improves the score for a given layer, skip it immediately (no sweep needed)

This limits worst case to ~N_layers material evaluations (most rejected without sweep) plus a few short sweeps for accepted swaps.

**Solution selection:**
Return the best 5 distinct solutions. Distinctness: solutions must differ by more than (total_stack_thickness * 0.02) nm to avoid near-identical results. This scales with design complexity — thicker/more-layer designs need a larger difference threshold.

### 3. Material Palette & Layer Count Flexibility

**Material selection:**
- Selected materials are the available palette — optimizer picks the best combination
- No forced alternating low/high index (though alternating H/L naturally emerges for most coatings)
- "Select All" and "Deselect All" buttons above material checkboxes
- Layer template mode overrides palette — materials are fixed per-layer when template is active

**Layer count:**
- Replace single "Number of Layers" with Min Layers (default 3) and Max Layers (default 12)
- Phase 1 seeds pick random layer counts within this range
- During refinement, layers with thickness converging below 5nm are removed (but layer count must stay >= min layers)
- Layer insertion is NOT performed during optimization — the layer count range in Phase 1 provides sufficient exploration
- Layer template mode overrides — layer count is fixed to template length

### 4. Reverse Engineering Improvements

**Per-point constraints:**
- Each CSV row (wavelength, reflectivity) is an individual constraint
- Match tolerance: ±1% reflectivity by default, user-adjustable via "Match Tolerance (±%)" input
- Prevents shape-shifting — optimizer can't cheat by matching average while being off at individual points
- Double-sided AR correction (`doubleSidedAR` checkbox) is preserved — when enabled, the correction is applied to calculated reflectivity before comparing to CSV values, same as current behavior

**Error reporting:**
- Show max deviation alongside RMS error in solution previews
- Per-point accountability replaces aggregate-only scoring

### 5. UI Changes

**Controls panel:**
- Add "Select All" / "Deselect All" buttons above material checkboxes
- Replace "Number of Layers" with "Min Layers" and "Max Layers" fields
- Remove "Minimize Reflectivity Peaks" checkbox
- Remove smoothness weight slider
- Relabel "Max Error Threshold" to "Max Error (%)" — this is the maximum RMS error for a solution to be displayed in results. It acts as a quality filter on top of hard constraints: solutions must both satisfy hard constraints AND have RMS error below this threshold.

**Reverse engineering additions:**
- New "Match Tolerance (±%)" input (default 1.0)
- Solution previews show "Max deviation: X%" alongside "RMS error: X%"

**Solution display:**
- Target mode: green checkmark or red X per target box for hard constraint pass/fail
- Error number reflects only target deviation

**Unchanged:**
- Target point builder
- Color target mode controls (including angle constraints)
- CSV upload
- Layer template mode
- Adhesion layer controls — adhesion layer is prepended as a fixed layer (not optimized, not subject to material swapping or thickness refinement). It does not count toward the min/max layer range.
- Solution preview charts
- "Add as Stack" button
- Iteration count inputs
- Double-sided AR checkbox

### 6. Progress Feedback

**Live progress updates:**
- Phase 1: "Generating candidates... X valid seeds found"
- Phase 2: "Refining solution X of 20 — current best error: Y%"
- Phase 3: "Testing material swaps... improvements found: X"

**Guard rails:**
- If all seeds after Phase 2 still violate constraints: "No solutions found that satisfy all constraints. Try: widening target boxes, adding more materials, or increasing max layer count."
- Convergence detection: stop needle sweeps when error improvement < 0.01%
- Max sweeps per pass capped (15 coarse, 15 medium, 20 fine) to prevent infinite loops

**Performance target:**
- Under 60 seconds for typical cases (5-8 layers, 2-3 target boxes)
- Complex cases (12+ layers, dense CSV) may take longer — progress indicator keeps user informed
- Sampling at 5nm during optimization (vs 2nm) reduces compute by 60% with negligible accuracy loss; final 2nm validation on top 5 solutions ensures precision

## Implementation Scope

All changes are within `src/opticoat-designer.js`:
- `optimizeDesign` function (~650 lines, lines 5115-5765): Complete rewrite of optimization logic
- Design Assistant UI section (lines ~8646+): UI control modifications
- State variables (lines ~429-458): Update/add state for min/max layers, match tolerance

No backend changes. No new files. No new dependencies.
