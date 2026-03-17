# Optimizer Redesign Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Design Assistant's random-search optimizer with a needle-refinement (coordinate descent) algorithm that enforces hard constraints on target boxes and supports flexible materials/layer counts.

**Architecture:** The entire change is within `src/opticoat-designer.js`. The `optimizeDesign` function (~650 lines, lines 5115-5765) gets a complete rewrite. UI controls in the Design Assistant section (lines ~8500-8900) get modified. A few state variables are added/removed (lines ~429-458). Session save/load (lines ~3716-3838) must be updated for new state variables.

**Tech Stack:** React 19, vanilla JavaScript (no new dependencies)

**Spec:** `docs/superpowers/specs/2026-03-17-optimizer-redesign-design.md`

---

## Chunk 1: State Variables & Session Persistence

### Task 1: Update state variables

**Files:**
- Modify: `src/opticoat-designer.js:429-458` (state declarations)
- Modify: `src/opticoat-designer.js:3716-3838` (session save/load)

- [ ] **Step 1: Replace `designLayers` with `minDesignLayers` and `maxDesignLayers`, remove `minimizePeaks` and `smoothnessWeight`, add `matchTolerance`**

At line 429, replace:
```js
const [designLayers, setDesignLayers] = useState(5);
```
with:
```js
const [minDesignLayers, setMinDesignLayers] = useState(3);
const [maxDesignLayers, setMaxDesignLayers] = useState(12);
```

At line 441-442, remove:
```js
const [minimizePeaks, setMinimizePeaks] = useState(false);
const [smoothnessWeight, setSmoothnessWeight] = useState(0.5);
```

Near line 458 (after `maxErrorThreshold`), add:
```js
const [matchTolerance, setMatchTolerance] = useState(1.0);
```

- [ ] **Step 2: Update session load to handle new state variables**

At line 3718, replace:
```js
if (session.designLayers) setDesignLayers(session.designLayers);
```
with:
```js
if (session.minDesignLayers) setMinDesignLayers(session.minDesignLayers);
if (session.maxDesignLayers) setMaxDesignLayers(session.maxDesignLayers);
if (session.designLayers && !session.minDesignLayers) {
  // Backward compatibility: old sessions had single designLayers
  setMinDesignLayers(Math.max(1, session.designLayers - 2));
  setMaxDesignLayers(session.designLayers + 4);
}
if (session.matchTolerance !== undefined) setMatchTolerance(session.matchTolerance);
```

- [ ] **Step 3: Update session save object**

In the session save object (around line 3769), replace `designLayers,` with:
```js
minDesignLayers,
maxDesignLayers,
matchTolerance,
```

- [ ] **Step 4: Update `handleSaveDesign` data object and all dependency arrays**

The `handleSaveDesign` function (line ~3814) includes `designLayers` in its save object:
```js
designPoints, designMaterials, designLayers, layerTemplate,
```
Replace `designLayers` with `minDesignLayers, maxDesignLayers, matchTolerance`:
```js
designPoints, designMaterials, minDesignLayers, maxDesignLayers, matchTolerance, layerTemplate,
```

Then search for ALL remaining `designLayers` references in `useEffect`/`useCallback` dependency arrays (lines ~3785, ~3814, ~3838). Replace every occurrence of `designLayers` with `minDesignLayers, maxDesignLayers`. Also remove `minimizePeaks` and `smoothnessWeight` if they appear in any dependency array.

- [ ] **Step 5: Update the layer template sync logic**

The current code at lines 5182 and 5195 uses `designLayers` in `for` loops inside `optimizeDesign`. These will be updated in Task 3 (the optimizer rewrite). For now, search for any OTHER references to `designLayers` outside of `optimizeDesign` and update them.

The layer template resize logic (lines 8543-8570) currently syncs template length to `designLayers`. This will be updated in Task 2 (UI changes) to use `maxDesignLayers` instead.

- [ ] **Step 6: Commit**

```bash
git add src/opticoat-designer.js
git commit -m "refactor: replace designLayers with min/max range, remove smoothness state"
```

---

## Chunk 2: UI Changes

### Task 2: Update Design Assistant controls

**Files:**
- Modify: `src/opticoat-designer.js:8500-8900` (Design Assistant UI controls)

- [ ] **Step 1: Replace "Number of Layers" input with Min/Max fields**

At lines 8534-8576, replace the single "Number of Layers" grid column with two inputs. Replace this block:
```jsx
<div>
  <label className="text-xs text-gray-600">
    Number of Layers:
  </label>
  <input
    type="number"
    value={designLayers}
    onChange={(e) => {
      const val = e.target.value === "" ? "" : parseInt(e.target.value) || 3;
      setDesignLayers(val);
      // Update layer template to match new layer count
      if (val !== "" && val > 0) {
        setLayerTemplate(prev => {
          const newTemplate = [...prev];
          while (newTemplate.length < val) {
            newTemplate.push({
              material: newTemplate.length % 2 === 0 ? "SiO2" : "ZrO2",
              minThickness: 20,
              maxThickness: 200
            });
          }
          return newTemplate.slice(0, val);
        });
      }
    }}
    onBlur={(e) => {
      if (e.target.value === "" || parseInt(e.target.value) < 1) {
        setDesignLayers(3);
        setLayerTemplate([
          { material: "SiO2", minThickness: 20, maxThickness: 200 },
          { material: "ZrO2", minThickness: 20, maxThickness: 200 },
          { material: "SiO2", minThickness: 20, maxThickness: 200 }
        ]);
      }
    }}
    className="w-full px-2 py-1 border rounded text-sm"
    min="1"
    max="20"
  />
</div>
```

with:
```jsx
<div>
  <label className="text-xs text-gray-600">
    Layers (Min–Max):
  </label>
  <div className="flex gap-1 items-center">
    <input
      type="number"
      value={minDesignLayers}
      onChange={(e) => {
        const val = e.target.value === "" ? "" : parseInt(e.target.value) || 1;
        setMinDesignLayers(val);
      }}
      onBlur={(e) => {
        let val = parseInt(e.target.value);
        if (isNaN(val) || val < 1) val = 1;
        if (val > maxDesignLayers) val = maxDesignLayers;
        setMinDesignLayers(val);
      }}
      className="w-full px-2 py-1 border rounded text-sm"
      min="1"
      max="20"
    />
    <span className="text-xs text-gray-400">–</span>
    <input
      type="number"
      value={maxDesignLayers}
      onChange={(e) => {
        const val = e.target.value === "" ? "" : parseInt(e.target.value) || 12;
        setMaxDesignLayers(val);
        // Update layer template to match max layer count
        if (val !== "" && val > 0) {
          setLayerTemplate(prev => {
            const newTemplate = [...prev];
            while (newTemplate.length < val) {
              newTemplate.push({
                material: newTemplate.length % 2 === 0 ? "SiO2" : "ZrO2",
                minThickness: 20,
                maxThickness: 200
              });
            }
            return newTemplate.slice(0, val);
          });
        }
      }}
      onBlur={(e) => {
        let val = parseInt(e.target.value);
        if (isNaN(val) || val < 1) val = 3;
        if (val < minDesignLayers) val = minDesignLayers;
        setMaxDesignLayers(val);
      }}
      className="w-full px-2 py-1 border rounded text-sm"
      min="1"
      max="20"
    />
  </div>
</div>
```

- [ ] **Step 2: Add "Select All" / "Deselect All" buttons above material checkboxes**

At line 8727, just before the material checkbox grid, find:
```jsx
<div>
  <label className="text-xs text-gray-600">
    Materials to Use (will alternate automatically):
  </label>
  <div className="grid grid-cols-3 gap-1 mt-1">
```

Replace with:
```jsx
<div>
  <div className="flex items-center justify-between">
    <label className="text-xs text-gray-600">
      Available Materials:
    </label>
    <div className="flex gap-1">
      <button
        onClick={() => setDesignMaterials(Object.keys(allMaterials))}
        className="text-[10px] text-indigo-600 hover:text-indigo-800 underline"
      >
        Select All
      </button>
      <span className="text-[10px] text-gray-300">|</span>
      <button
        onClick={() => setDesignMaterials([])}
        className="text-[10px] text-red-500 hover:text-red-700 underline"
      >
        Deselect All
      </button>
    </div>
  </div>
  <div className="grid grid-cols-3 gap-1 mt-1">
```

- [ ] **Step 3: Remove "Minimize Reflectivity Peaks" checkbox and smoothness weight slider**

At lines 8767-8806, delete the entire block from:
```jsx
<div className="pt-2 border-t">
  <label className="flex items-center gap-2 text-xs font-medium mb-2">
    <input
      type="checkbox"
      checked={minimizePeaks}
```
through to its closing `</div>` (the `</div>` that closes the `pt-2 border-t` div, at approximately line 8806).

- [ ] **Step 4: Add "Match Tolerance" input for reverse engineering mode**

After the CSV upload section (line ~8203, after the closing `</div>` of the `reverseEngineerMode` block), add inside the `{reverseEngineerMode && (` conditional, before its closing `</div>`:

Find the line with:
```jsx
<p className="text-[10px] text-gray-500 mt-2">
  CSV format: wavelength (nm), reflectivity (%)
</p>
```

After it, add:
```jsx
<div className="mt-2">
  <label className="text-xs text-gray-600">
    Match Tolerance (±%):
  </label>
  <input
    type="number"
    value={matchTolerance}
    onChange={(e) => setMatchTolerance(e.target.value === "" ? "" : parseFloat(e.target.value))}
    onBlur={(e) => {
      if (e.target.value === "" || isNaN(parseFloat(e.target.value)) || parseFloat(e.target.value) < 0.1) {
        setMatchTolerance(1.0);
      }
    }}
    className="w-full px-2 py-1 border rounded text-sm mt-1"
    min="0.1"
    max="10"
    step="0.1"
  />
  <p className="text-[10px] text-gray-500 mt-1">
    Each CSV point must match within ±{matchTolerance}%
  </p>
</div>
```

- [ ] **Step 5: Fix the "Generate Solutions" button disabled logic**

At line ~9175-9180, the current disabled condition is:
```jsx
disabled={
  optimizing ||
  (!reverseEngineerMode && designPoints.length === 0) ||
  (reverseEngineerMode && !reverseEngineerData) ||
  designMaterials.length === 0
}
```

Replace with:
```jsx
disabled={
  optimizing ||
  (!reverseEngineerMode && !colorTargetMode && designPoints.length === 0) ||
  (reverseEngineerMode && !reverseEngineerData) ||
  (!useLayerTemplate && designMaterials.length === 0)
}
```

Changes: (1) add `!colorTargetMode &&` so color target mode works without design points, (2) add `!useLayerTemplate &&` so template mode works without palette materials selected.

- [ ] **Step 6: Update solution display to show max deviation for reverse engineering**

At lines 9248-9250, replace:
```jsx
{colorTargetMode
  ? `ΔE* ${solution.error.toFixed(2)}`
  : `${solution.error.toFixed(2)}% error`}
```
with:
```jsx
{colorTargetMode
  ? `ΔE* ${solution.error.toFixed(2)}`
  : `${solution.error.toFixed(2)}% error${solution.maxDeviation !== undefined ? ` (max: ${solution.maxDeviation.toFixed(1)}%)` : ''}`}
```

- [ ] **Step 7: Add per-target pass/fail indicators for target mode solutions**

After the solution error badge (line ~9251, after the closing `</span>`), add:
```jsx
{!colorTargetMode && !reverseEngineerMode && solution.targetResults && (
  <div className="flex gap-1 mt-1 flex-wrap">
    {solution.targetResults.map((tr, ti) => (
      <span key={ti} className={`text-[10px] px-1 rounded ${tr.pass ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
        {tr.pass ? '✓' : '✗'} T{ti + 1}
      </span>
    ))}
  </div>
)}
```

- [ ] **Step 8: Commit**

```bash
git add src/opticoat-designer.js
git commit -m "feat: update Design Assistant UI — min/max layers, select all materials, match tolerance"
```

---

## Chunk 3: Optimizer Rewrite — Helper Functions

### Task 3: Write the constraint-aware merit function and helper utilities

**Files:**
- Modify: `src/opticoat-designer.js` — add new helper functions just before the `optimizeDesign` function (insert at line ~5114)

- [ ] **Step 1: Add `calculateConstraintViolation` function**

Insert before `const optimizeDesign = async () => {` (line 5115):

```js
// === OPTIMIZER HELPER FUNCTIONS ===

// Calculate how far a solution violates hard constraints.
// Returns { violation: number, perTarget: [{pass, deviation}] }
// violation = 0 means all constraints satisfied.
const calculateConstraintViolation = (testLayers, sampleStep = 5) => {
  let totalViolation = 0;
  const perTarget = [];

  if (colorTargetMode) {
    // Color target mode uses soft constraints only (Delta E)
    return { violation: 0, perTarget: [] };
  }

  if (reverseEngineerMode && reverseEngineerData) {
    reverseEngineerData.forEach((dataPoint) => {
      let calcR = calculateReflectivityAtWavelength(dataPoint.wavelength, testLayers);
      if (doubleSidedAR) {
        calcR = calcR + Math.pow(1 - calcR, 2) * calcR;
      }
      calcR = calcR * 100;
      const deviation = Math.abs(calcR - dataPoint.reflectivity);
      const tolerance = matchTolerance;
      if (deviation > tolerance) {
        totalViolation += Math.pow(deviation - tolerance, 2);
        perTarget.push({ pass: false, deviation });
      } else {
        perTarget.push({ pass: true, deviation });
      }
    });
  } else {
    // Target point mode
    designPoints.forEach((point) => {
      let maxViolation = 0;
      let pass = true;

      if (point.useWavelengthRange) {
        // Sample densely across the wavelength range
        for (let lambda = point.wavelengthMin; lambda <= point.wavelengthMax; lambda += sampleStep) {
          const calcR = calculateReflectivityAtWavelength(lambda, testLayers) * 100;
          if (point.useReflectivityRange) {
            if (calcR < point.reflectivityMin) {
              const v = point.reflectivityMin - calcR;
              maxViolation = Math.max(maxViolation, v);
              totalViolation += v * v;
              pass = false;
            } else if (calcR > point.reflectivityMax) {
              const v = calcR - point.reflectivityMax;
              maxViolation = Math.max(maxViolation, v);
              totalViolation += v * v;
              pass = false;
            }
          } else {
            // Single reflectivity target — no hard constraint (it's a point target)
            // Violation is distance from target value
            const targetValue = (point.reflectivityMin + point.reflectivityMax) / 2;
            const v = Math.abs(calcR - targetValue);
            if (v > 1.0) { // Allow 1% tolerance for point targets
              maxViolation = Math.max(maxViolation, v);
              totalViolation += v * v;
              pass = false;
            }
          }
        }
      } else {
        // Single wavelength
        const lambda = (point.wavelengthMin + point.wavelengthMax) / 2;
        const calcR = calculateReflectivityAtWavelength(lambda, testLayers) * 100;
        if (point.useReflectivityRange) {
          if (calcR < point.reflectivityMin) {
            const v = point.reflectivityMin - calcR;
            maxViolation = Math.max(maxViolation, v);
            totalViolation += v * v;
            pass = false;
          } else if (calcR > point.reflectivityMax) {
            const v = calcR - point.reflectivityMax;
            maxViolation = Math.max(maxViolation, v);
            totalViolation += v * v;
            pass = false;
          }
        } else {
          const targetValue = (point.reflectivityMin + point.reflectivityMax) / 2;
          const v = Math.abs(calcR - targetValue);
          if (v > 1.0) {
            maxViolation = Math.max(maxViolation, v);
            totalViolation += v * v;
            pass = false;
          }
        }
      }
      perTarget.push({ pass, deviation: maxViolation });
    });
  }

  return { violation: totalViolation, perTarget };
};
```

- [ ] **Step 2: Add `calculateMeritError` function**

```js
// Calculate the RMS error score for ranking solutions (no penalties, pure target deviation).
// Returns { error: number, maxDeviation: number }
const calculateMeritError = (testLayers, sampleStep = 5) => {
  let error = 0;
  let errorCount = 0;
  let maxDeviation = 0;

  if (colorTargetMode) {
    const colorResult = calculateStackColorDeltaE(
      testLayers, currentStackId, targetColorL, targetColorA, targetColorB
    );
    let totalError = colorResult.deltaE;

    // Angle color constraints (preserved from current implementation)
    if (angleColorConstraints.length > 0) {
      let angleError = 0;
      angleColorConstraints.forEach(constraint => {
        if (constraint.mode === 'maxShift') {
          const angleColor = calculateStackColorDeltaE(
            testLayers, currentStackId, colorResult.L, colorResult.a, colorResult.b, constraint.angle
          );
          if (angleColor.deltaE > constraint.maxDeltaE) {
            angleError += Math.pow(angleColor.deltaE - constraint.maxDeltaE, 2);
          }
        } else if (constraint.mode === 'target') {
          const angleColor = calculateStackColorDeltaE(
            testLayers, currentStackId, constraint.targetL, constraint.targetA, constraint.targetB, constraint.angle
          );
          angleError += Math.pow(angleColor.deltaE, 2);
        }
      });
      if (angleError > 0) {
        const avgAngleError = Math.sqrt(angleError / angleColorConstraints.length);
        const avgWeight = angleColorConstraints.reduce((sum, c) => sum + c.weight, 0) / angleColorConstraints.length / 100;
        totalError += avgAngleError * avgWeight * 10;
      }
    }

    // Combined color + reflectivity weighting
    if (colorWeight < 100 && designPoints.length > 0) {
      let reflectivityError = 0;
      let reflectivityCount = 0;
      designPoints.forEach((point) => {
        const lambda = point.useWavelengthRange
          ? point.wavelengthMin
          : (point.wavelengthMin + point.wavelengthMax) / 2;
        const step = point.useWavelengthRange
          ? (point.wavelengthMax - point.wavelengthMin) / 4
          : 0;
        const numSamples = point.useWavelengthRange ? 5 : 1;
        for (let i = 0; i < numSamples; i++) {
          const wl = lambda + i * step;
          const calcR = calculateReflectivityAtWavelength(wl, testLayers) * 100;
          const targetValue = (point.reflectivityMin + point.reflectivityMax) / 2;
          if (point.useReflectivityRange) {
            if (calcR < point.reflectivityMin) {
              reflectivityError += Math.pow(point.reflectivityMin - calcR, 2);
              reflectivityCount++;
            } else if (calcR > point.reflectivityMax) {
              reflectivityError += Math.pow(calcR - point.reflectivityMax, 2);
              reflectivityCount++;
            }
          } else {
            reflectivityError += Math.pow(calcR - targetValue, 2);
            reflectivityCount++;
          }
        }
      });
      const avgReflErr = reflectivityCount > 0 ? Math.sqrt(reflectivityError / reflectivityCount) : 0;
      const colorFraction = colorWeight / 100;
      totalError = colorFraction * totalError + (1 - colorFraction) * avgReflErr;
    }

    return { error: totalError, maxDeviation: totalError };
  }

  if (reverseEngineerMode && reverseEngineerData) {
    reverseEngineerData.forEach((dataPoint) => {
      let calcR = calculateReflectivityAtWavelength(dataPoint.wavelength, testLayers);
      if (doubleSidedAR) {
        calcR = calcR + Math.pow(1 - calcR, 2) * calcR;
      }
      calcR = calcR * 100;
      const deviation = Math.abs(calcR - dataPoint.reflectivity);
      maxDeviation = Math.max(maxDeviation, deviation);
      error += Math.pow(deviation, 2);
      errorCount++;
    });
  } else {
    // Target point mode
    designPoints.forEach((point) => {
      if (point.useWavelengthRange) {
        for (let lambda = point.wavelengthMin; lambda <= point.wavelengthMax; lambda += sampleStep) {
          const calcR = calculateReflectivityAtWavelength(lambda, testLayers) * 100;
          const targetValue = (point.reflectivityMin + point.reflectivityMax) / 2;
          if (point.useReflectivityRange) {
            if (calcR < point.reflectivityMin) {
              const d = point.reflectivityMin - calcR;
              error += d * d;
              maxDeviation = Math.max(maxDeviation, d);
              errorCount++;
            } else if (calcR > point.reflectivityMax) {
              const d = calcR - point.reflectivityMax;
              error += d * d;
              maxDeviation = Math.max(maxDeviation, d);
              errorCount++;
            } else {
              // Inside the box — error is distance from midpoint (for ranking)
              const d = Math.abs(calcR - targetValue);
              error += d * d;
              errorCount++;
            }
          } else {
            const d = Math.abs(calcR - targetValue);
            error += d * d;
            maxDeviation = Math.max(maxDeviation, d);
            errorCount++;
          }
        }
      } else {
        const lambda = (point.wavelengthMin + point.wavelengthMax) / 2;
        const calcR = calculateReflectivityAtWavelength(lambda, testLayers) * 100;
        const targetValue = (point.reflectivityMin + point.reflectivityMax) / 2;
        if (point.useReflectivityRange) {
          if (calcR < point.reflectivityMin) {
            const d = point.reflectivityMin - calcR;
            error += d * d;
            maxDeviation = Math.max(maxDeviation, d);
          } else if (calcR > point.reflectivityMax) {
            const d = calcR - point.reflectivityMax;
            error += d * d;
            maxDeviation = Math.max(maxDeviation, d);
          }
        } else {
          const d = Math.abs(calcR - targetValue);
          error += d * d;
          maxDeviation = Math.max(maxDeviation, d);
        }
        errorCount++;
      }
    });
  }

  const rmsError = errorCount > 0 ? Math.sqrt(error / errorCount) : 0;
  return { error: rmsError, maxDeviation };
};
```

- [ ] **Step 3: Add `calculateCombinedScore` function**

```js
// Combined score: error + constraint violation penalty.
// Lower is better. Solutions with violation=0 are ranked by error alone.
const calculateCombinedScore = (testLayers) => {
  const { violation, perTarget } = calculateConstraintViolation(testLayers);
  const { error, maxDeviation } = calculateMeritError(testLayers);
  // Heavy penalty for constraint violations to ensure compliant solutions rank first
  const score = error + violation * 10;
  return { score, error, maxDeviation, violation, perTarget };
};
```

- [ ] **Step 4: Commit**

```bash
git add src/opticoat-designer.js
git commit -m "feat: add constraint-aware merit function helpers for optimizer"
```

---

## Chunk 4: Optimizer Rewrite — Core Algorithm

### Task 4: Rewrite `optimizeDesign` with needle refinement

**Files:**
- Modify: `src/opticoat-designer.js:5115-5765` — complete replacement of `optimizeDesign` function body

- [ ] **Step 1: Replace the entire `optimizeDesign` function**

Delete lines 5115-5765 (the entire `const optimizeDesign = async () => { ... };`) and replace with:

```js
const optimizeDesign = async () => {
  // Validation
  if (!reverseEngineerMode && !colorTargetMode && designPoints.length === 0) {
    showToast("Please add at least one target point, upload a CSV file for reverse engineering, or use Color Target Mode", 'error');
    return;
  }
  if (reverseEngineerMode && !reverseEngineerData) {
    showToast("Please upload a CSV file for reverse engineering", 'error');
    return;
  }
  if (colorTargetMode && targetColorL === 0 && targetColorA === 0 && targetColorB === 0) {
    if (!window.confirm("Target color is set to L*=0, a*=0, b*=0 (pure black). Continue anyway?")) return;
  }
  if (!useLayerTemplate && designMaterials.length === 0) {
    showToast("Please select at least one material", 'error');
    return;
  }

  setOptimizing(true);
  setSolutions([]);
  setOptimizationProgress(0);
  setOptimizationStage("Phase 1: Generating candidates...");

  const numIterations = reverseEngineerMode ? reverseEngineerIterations : targetModeIterations;
  const minLayers = useLayerTemplate ? layerTemplate.length : (typeof minDesignLayers === 'number' ? minDesignLayers : 3);
  const maxLayers = useLayerTemplate ? layerTemplate.length : (typeof maxDesignLayers === 'number' ? maxDesignLayers : 12);
  const allMats = Object.keys(allMaterials);
  const paletteMats = useLayerTemplate ? allMats : designMaterials;

  // ===== PHASE 1: Seed Generation =====
  const seeds = [];
  let validSeedCount = 0;

  for (let iter = 0; iter < numIterations; iter++) {
    if (iter % 500 === 0) {
      setOptimizationProgress((iter / numIterations) * 25);
      setOptimizationStage(`Phase 1: Generating candidates... ${validSeedCount} valid seeds found`);
      await new Promise(resolve => setTimeout(resolve, 0));
    }

    const testLayers = [];
    if (useLayerTemplate) {
      for (let i = 0; i < layerTemplate.length; i++) {
        const lc = layerTemplate[i] || { material: "SiO2", minThickness: 20, maxThickness: 200 };
        const minT = lc.minThickness || 20;
        const maxT = lc.maxThickness || 200;
        testLayers.push({ id: i, material: lc.material, thickness: minT + Math.random() * (maxT - minT) });
      }
    } else {
      const numLayers = minLayers + Math.floor(Math.random() * (maxLayers - minLayers + 1));
      for (let i = 0; i < numLayers; i++) {
        const material = paletteMats[Math.floor(Math.random() * paletteMats.length)];
        const thickness = 10 + Math.random() * 250;
        testLayers.push({ id: i, material, thickness });
      }
    }

    const result = calculateCombinedScore(testLayers);
    if (result.violation === 0) validSeedCount++;

    seeds.push({
      layers: testLayers,
      score: result.score,
      error: result.error,
      maxDeviation: result.maxDeviation,
      violation: result.violation,
      perTarget: result.perTarget,
    });
  }

  // Sort seeds: compliant first (violation=0), then by score
  seeds.sort((a, b) => {
    if (a.violation === 0 && b.violation !== 0) return -1;
    if (a.violation !== 0 && b.violation === 0) return 1;
    return a.score - b.score;
  });
  const topSeeds = seeds.slice(0, 20);

  // ===== PHASE 2: Needle Refinement =====
  setOptimizationStage("Phase 2: Refining solutions...");
  setOptimizationProgress(25);
  await new Promise(resolve => setTimeout(resolve, 0));

  const refinementPasses = [
    { stepSizes: [20, 10], maxSweeps: 15 },   // Coarse
    { stepSizes: [5, 2], maxSweeps: 15 },      // Medium
    { stepSizes: [1, 0.5], maxSweeps: 20 },    // Fine
  ];

  const refinedSolutions = [];

  for (let seedIdx = 0; seedIdx < topSeeds.length; seedIdx++) {
    setOptimizationProgress(25 + (seedIdx / topSeeds.length) * 50);
    setOptimizationStage(`Phase 2: Refining solution ${seedIdx + 1} of ${topSeeds.length} — best error: ${topSeeds[0].error.toFixed(2)}%`);
    if (seedIdx % 2 === 0) await new Promise(resolve => setTimeout(resolve, 0));

    let currentLayers = JSON.parse(JSON.stringify(topSeeds[seedIdx].layers));
    let currentResult = calculateCombinedScore(currentLayers);

    for (const pass of refinementPasses) {
      for (let sweep = 0; sweep < pass.maxSweeps; sweep++) {
        const prevScore = currentResult.score;

        for (let layerIdx = 0; layerIdx < currentLayers.length; layerIdx++) {
          const originalThickness = currentLayers[layerIdx].thickness;
          let bestScore = currentResult.score;
          let bestThickness = originalThickness;

          for (const step of pass.stepSizes) {
            for (const sign of [1, -1]) {
              const newThickness = originalThickness + sign * step;
              if (newThickness < 5) continue; // Min thickness guard

              // Respect template bounds if using template
              if (useLayerTemplate && layerTemplate[layerIdx]) {
                const minT = layerTemplate[layerIdx].minThickness || 5;
                const maxT = layerTemplate[layerIdx].maxThickness || 500;
                if (newThickness < minT || newThickness > maxT) continue;
              }

              currentLayers[layerIdx].thickness = newThickness;
              const testResult = calculateCombinedScore(currentLayers);

              if (testResult.score < bestScore) {
                bestScore = testResult.score;
                bestThickness = newThickness;
              }
            }
          }

          currentLayers[layerIdx].thickness = bestThickness;
          if (bestThickness !== originalThickness) {
            currentResult = calculateCombinedScore(currentLayers);
          }
        }

        // Remove layers that converged below 5nm (if not using template and above min layer count)
        if (!useLayerTemplate && currentLayers.length > minLayers) {
          const thinLayers = currentLayers.filter(l => l.thickness < 5);
          if (thinLayers.length > 0) {
            currentLayers = currentLayers.filter(l => l.thickness >= 5);
            // Re-index
            currentLayers.forEach((l, i) => { l.id = i; });
            currentResult = calculateCombinedScore(currentLayers);
          }
        }

        // Check convergence
        const improvement = prevScore - currentResult.score;
        if (improvement < currentResult.score * 0.0001) break; // < 0.01% improvement
      }
    }

    // Add adhesion layer if enabled
    const finalLayers = useAdhesionLayer
      ? [{ id: -1, material: adhesionMaterial, thickness: adhesionThickness, iad: null }, ...currentLayers]
      : currentLayers;

    refinedSolutions.push({
      layers: finalLayers,
      score: currentResult.score,
      error: currentResult.error,
      maxDeviation: currentResult.maxDeviation,
      violation: currentResult.violation,
      perTarget: currentResult.perTarget,
    });
  }

  // ===== PHASE 3: Material Swapping =====
  setOptimizationStage("Phase 3: Testing material swaps...");
  setOptimizationProgress(75);
  await new Promise(resolve => setTimeout(resolve, 0));

  let improvementsFound = 0;

  if (!useLayerTemplate && paletteMats.length > 1) {
    // Only swap on top 5 solutions to save time
    const topForSwap = refinedSolutions.sort((a, b) => a.score - b.score).slice(0, 5);

    for (const sol of topForSwap) {
      // Strip adhesion layer for scoring consistency with Phase 1/2
      const hasAdhesion = useAdhesionLayer && sol.layers.length > 0 && sol.layers[0].id === -1;
      const adhesionLayer = hasAdhesion ? sol.layers[0] : null;
      const swapLayers = JSON.parse(JSON.stringify(hasAdhesion ? sol.layers.slice(1) : sol.layers));
      const startIdx = 0;

      for (let layerIdx = startIdx; layerIdx < swapLayers.length; layerIdx++) {
        const originalMaterial = swapLayers[layerIdx].material;
        let bestScore = calculateCombinedScore(swapLayers).score;
        let bestMaterial = originalMaterial;

        for (const mat of paletteMats) {
          if (mat === originalMaterial) continue;
          swapLayers[layerIdx].material = mat;
          const testResult = calculateCombinedScore(swapLayers);

          if (testResult.score < bestScore) {
            bestScore = testResult.score;
            bestMaterial = mat;
          }
        }

        swapLayers[layerIdx].material = bestMaterial;

        if (bestMaterial !== originalMaterial) {
          improvementsFound++;
          // Quick fine-pass needle sweep after accepted swap
          for (let sweep = 0; sweep < 5; sweep++) {
            let improved = false;
            for (let li = startIdx; li < swapLayers.length; li++) {
              const orig = swapLayers[li].thickness;
              let bScore = calculateCombinedScore(swapLayers).score;
              let bThick = orig;
              for (const step of [1, 0.5]) {
                for (const sign of [1, -1]) {
                  const nt = orig + sign * step;
                  if (nt < 5) continue;
                  swapLayers[li].thickness = nt;
                  const tr = calculateCombinedScore(swapLayers);
                  if (tr.score < bScore) { bScore = tr.score; bThick = nt; }
                }
              }
              swapLayers[li].thickness = bThick;
              if (bThick !== orig) improved = true;
            }
            if (!improved) break;
          }

          // Update the solution
          const finalResult = calculateCombinedScore(swapLayers);
          sol.layers = adhesionLayer
            ? [adhesionLayer, ...JSON.parse(JSON.stringify(swapLayers))]
            : JSON.parse(JSON.stringify(swapLayers));
          sol.score = finalResult.score;
          sol.error = finalResult.error;
          sol.maxDeviation = finalResult.maxDeviation;
          sol.violation = finalResult.violation;
          sol.perTarget = finalResult.perTarget;
        }
      }
    }
  }

  setOptimizationStage(`Phase 3: Testing material swaps... ${improvementsFound} improvements found`);

  // ===== FINAL: Sort, deduplicate, filter =====
  setOptimizationStage("Finalizing solutions...");
  setOptimizationProgress(90);
  await new Promise(resolve => setTimeout(resolve, 0));

  // Sort: compliant solutions first, then by error
  refinedSolutions.sort((a, b) => {
    if (a.violation === 0 && b.violation !== 0) return -1;
    if (a.violation !== 0 && b.violation === 0) return 1;
    return a.error - b.error;
  });

  // Deduplicate: solutions must differ by > 2% of total stack thickness
  const deduplicated = [];
  for (const sol of refinedSolutions) {
    const solThickness = sol.layers.reduce((sum, l) => sum + l.thickness, 0);
    const threshold = solThickness * 0.02;
    const isDuplicate = deduplicated.some(existing => {
      if (existing.layers.length !== sol.layers.length) return false;
      const diff = existing.layers.reduce((sum, l, i) =>
        sum + Math.abs(l.thickness - (sol.layers[i]?.thickness || 0)), 0);
      return diff < threshold;
    });
    if (!isDuplicate) deduplicated.push(sol);
    if (deduplicated.length >= 10) break; // Keep pool for filtering
  }

  // Filter by error threshold and constraint compliance
  const qualified = deduplicated.filter(s => s.error < maxErrorThreshold);

  let finalSolutions;
  if (qualified.length >= 1) {
    finalSolutions = qualified.slice(0, 5);
  } else {
    // No solutions meet criteria — show best anyway with message
    const bestError = deduplicated.length > 0 ? deduplicated[0].error.toFixed(2) : "N/A";
    const bestViolation = deduplicated.length > 0 && deduplicated[0].violation > 0;
    const msg = bestViolation
      ? `No solutions satisfy all constraints. Best error: ${bestError}%. Try: widening target boxes, adding more materials, or increasing max layer count.`
      : `No solutions found with error < ${maxErrorThreshold}%. Best error: ${bestError}%. Try increasing Max Error threshold.`;
    showToast(msg, 'error');
    setOptimizing(false);
    setOptimizationProgress(0);
    setOptimizationStage("");
    return;
  }

  // Generate chart data and color info for each solution
  const solutionsWithData = finalSolutions.map((sol, idx) => {
    const data = [];
    for (let wavelength = wavelengthRange.min; wavelength <= wavelengthRange.max; wavelength += wavelengthRange.step) {
      const R = calculateReflectivityAtWavelength(wavelength, sol.layers);
      data.push({
        wavelength,
        reflectivity: displayMode === "transmission" ? (1 - R) * 100 : R * 100,
      });
    }

    let solutionColorInfo = null;
    if (colorTargetMode) {
      solutionColorInfo = calculateStackColorDeltaE(
        sol.layers, currentStackId, targetColorL, targetColorA, targetColorB
      );
    }

    // Final 2nm validation pass for hard constraints
    const finalCheck = calculateConstraintViolation(sol.layers, 2);

    return {
      ...sol,
      chartData: data,
      id: idx + 1,
      colorInfo: solutionColorInfo,
      targetResults: finalCheck.perTarget,
    };
  });

  setOptimizationProgress(100);
  setOptimizationStage("Complete!");
  setSolutions(solutionsWithData);

  setTimeout(() => {
    setOptimizing(false);
    setOptimizationProgress(0);
    setOptimizationStage("");
  }, 500);
};
```

- [ ] **Step 2: Update the `addSolutionAsStack` function**

The existing `addSolutionAsStack` at line ~5767 should remain unchanged — it already handles arbitrary layer arrays.

- [ ] **Step 3: Commit**

```bash
git add src/opticoat-designer.js
git commit -m "feat: rewrite optimizer with needle refinement and hard constraints"
```

---

## Chunk 5: Cleanup & Verification

### Task 5: Remove dead references and verify build

**Files:**
- Modify: `src/opticoat-designer.js` — cleanup any remaining references

- [ ] **Step 1: Search for and remove any remaining references to `designLayers`, `minimizePeaks`, `smoothnessWeight`**

Search the entire file for these identifiers. They should no longer exist anywhere except possibly in comments. Remove any remaining references.

Specifically check:
- Session save/load (lines ~3716-3838)
- Dependency arrays in `useEffect`/`useCallback`
- The `optimizeDesign` function (should be fully replaced)
- The UI section (should be fully updated)

- [ ] **Step 2: Verify the "Generate Solutions" button disabled condition was updated in Chunk 2**

Confirm the disabled condition at line ~9179 matches what was set in Chunk 2, Task 2, Step 5 (should already include `!colorTargetMode &&` and `!useLayerTemplate &&`).

- [ ] **Step 3: Build the project**

```bash
npm run build
```

Expected: Build succeeds with no errors (warnings about unused variables are acceptable and pre-existing).

- [ ] **Step 4: Fix any build errors**

If the build fails, fix the errors. Common issues:
- Missing variable references (renamed `designLayers` → `minDesignLayers`/`maxDesignLayers`)
- Removed `minimizePeaks`/`smoothnessWeight` still referenced somewhere
- Syntax errors in the new code

- [ ] **Step 5: Commit final cleanup**

```bash
git add src/opticoat-designer.js
git commit -m "chore: cleanup dead references and verify build"
```

### Task 6: Manual testing checklist

These are manual verification steps to confirm the optimizer works correctly:

- [ ] **Step 1: Test target mode with a single box target**

Set a target box: 450-550nm, 0-2% reflectivity. Select SiO2 + TiO2. Min layers 3, max 8. Click "Generate Solutions". Verify:
- Solutions appear with error percentages
- Each solution has green checkmarks for the target
- Preview charts show the curve passing through the target box

- [ ] **Step 2: Test target mode with multiple boxes**

Add two targets: 400-500nm at 0-2% R, and 600-700nm at 90-100% R. Run optimizer. Verify solutions respect both boxes simultaneously.

- [ ] **Step 3: Test reverse engineering mode with a CSV**

Upload a known CSV file. Set match tolerance to ±2%. Run optimizer. Verify:
- Solutions show both RMS error and max deviation
- The curve shape matches the CSV data shape (no horizontal shifting)

- [ ] **Step 4: Test "Select All" / "Deselect All" buttons**

Click "Select All" — all material checkboxes should be checked.
Click "Deselect All" — all should be unchecked. Button should disable "Generate Solutions".

- [ ] **Step 5: Test min/max layer count**

Set min=3, max=10. Run optimizer. Verify solutions have varying layer counts within that range.

- [ ] **Step 6: Test layer template mode still works**

Enable "Use Exact Layer Structure". Define 5 layers with specific materials and thickness ranges. Run optimizer. Verify solutions use exactly those materials in that order.
