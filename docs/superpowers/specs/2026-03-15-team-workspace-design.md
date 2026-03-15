# Team Workspace — Shared Designer Experience

## Overview

Replace the simplified team design detail view with a full optical analysis workspace identical to the designer tab. Submissions become toggleable overlay traces on a shared chart. Engineers get complete data — reflectivity, transmission, color, stress, delta E, admittance, e-field — for every iteration.

## Problem

The current team design detail view shows only layer thicknesses and a small reflectivity preview. There is no way to:
- View transmission, absorption, admittance, e-field, or phase shift for shared designs
- See color analysis (swatches, L*a*b*, delta E) for submissions
- Compare submissions against the original design or against each other on a chart
- View stress data for shared designs or submissions
- Track approval history with engineering metrics
- Evaluate whether a submission is worth uploading before submitting

Engineers need data to make informed decisions. Without it, the design iteration process has no direction.

## Architecture: Reuse Designer Components

Extract the designer tab's optical calculation and rendering logic into standalone functions that work on stored design JSON. Both the designer tab and team workspace call the same math. Pattern already proven with `computeReflectivityFromData()`.

### Shared Low-Level Helpers

Before the standalone functions, extract two shared helpers used by both the standalone functions and the component-internal calculations:

**`getRefractiveIndexStandalone(material, wavelength, allMats)`**
- Handles Sellmeier, Cauchy, and constant-n material types
- Applies packing density correction if provided
- Identical logic to component's `getRefractiveIndex` but takes `allMats` dict instead of using closure

**`getExtinctionCoefficientStandalone(material, wavelength, allMats)`**
- Handles `kType` variants: none, constant, urbach
- Identical logic to component's `getExtinctionCoefficient`
- Returns 0 if no extinction data exists for the material

These helpers prevent duplicating dispersion logic across 5 standalone functions.

### Standalone Calculation Functions

All functions live outside the React component (top of `opticoat-designer.js`). No React state dependencies.

**`computeFullSpectrumFromData(designData, customMats)`**
- Extends existing `computeReflectivityFromData` with full transfer matrix including extinction coefficients
- Uses `getRefractiveIndexStandalone` and `getExtinctionCoefficientStandalone` for each layer
- Computes complex refractive index `n - ik` when extinction data exists
- Always computes via transfer matrix; `T = 100 - R` only as fallback when no extinction data exists for ANY material in the stack
- Applies tooling factors from `designData.machines[currentMachineId].toolingFactors` to layer thicknesses
- Resolves layers from `designData.layerStacks` using `designData.currentStackId` (same pattern as existing `computeReflectivityFromData`)
- Returns: `[{ wavelength, R, T, A, phase }, ...]`
  - `R`: reflectivity %
  - `T`: transmission % (from transfer matrix with extinction, or 100-R fallback)
  - `A`: absorption % (100 - R - T, or 0 if no extinction)
  - `phase`: reflection phase angle in degrees (from `Math.atan2(rI, rR) * 180 / Math.PI`)

**`computeColorInfoFromSpectrum(spectrumData, illuminant)`**
- Takes the OUTPUT of `computeFullSpectrumFromData` (array of `{ wavelength, R }`) plus an illuminant string
- Matches the existing `calculateColorInfo` logic: CIE 1931 2-degree observer, illuminant SPDs (D65, D50, A, F2, F11), XYZ tristimulus, Lab, LCh
- Returns: `{ hex, rgb, L, a_star, b_star, C, h, dominantWavelength, avgReflectivity, colorName, X, Y, Z }`
- Caller is responsible for calling `computeFullSpectrumFromData` first, then passing spectrum data here (clean dependency chain)

**`computeStressFromData(designData, customMats)`**
- Resolves layers from `layerStacks`/`currentStackId`
- For each layer: `stressForce = materialStress * thickness` (units: MPa*nm)
- Per-layer output: `{ material, thickness, stressMPa, stressForce, type: 'compressive'|'tensile' }`
  - `stressMPa`: intrinsic stress value from material database
  - `stressForce`: stress * thickness (MPa*nm), matches existing `calculateCoatingStress`
- Cumulative output: `{ totalStress (sum of stressForce, MPa*nm), totalStressMagnitude (absolute), totalCompressive (sum of negative stressForce), totalTensile (sum of positive stressForce), riskLevel: 'low'|'medium'|'high', riskColor }`
- Risk thresholds match existing designer tab logic

**`computeAdmittanceFromData(designData, customMats, wavelengths)`**
- Takes `wavelengths` as an **array** (e.g., `[450, 550, 650]`), not a single value
- Uses `getRefractiveIndexStandalone` and `getExtinctionCoefficientStandalone`
- Applies tooling factors from `designData.machines`
- Returns same format as existing `calculateAdmittanceLoci`: array of `{ wavelength, color, points: [{ re, im, layerIndex, label, isBoundary }] }`

**`computeEfieldFromData(designData, customMats, wavelengths)`**
- Takes `wavelengths` as an **array**
- Uses `designData.incident.n` for incident medium
- Applies tooling factors from `designData.machines`
- Returns same format as existing `calculateEfieldDistribution`: `{ lines, layers, data }`

## Layout

When a user clicks into a shared design from the team detail view, they enter the workspace.

### Left Panel — Chart & Analysis (~70% width)

**Chart area:**
- Recharts LineChart, identical sizing and styling to designer tab
- Original shared design rendered as primary trace (indigo)
- Toggled-on submissions rendered as additional colored traces
- Display mode switcher: reflectivity, transmission, absorption, admittance, e-field, phase shift
- Wavelength range and axis scaling match the design's stored `wavelengthRange`
- For reflectivity/transmission/absorption/phase: all visible traces overlaid on the same chart
- For admittance/e-field: only the **focused trace** (`teamActiveLayerView`) is shown, since overlaying multiple loci/field plots is visually chaotic. A label indicates which trace is displayed, and the user switches via the right panel.
- Wavelength inputs for admittance and e-field modes (identical to designer tab controls at lines 7771/7791): placed in the display mode controls area, default to `[450, 550, 650]`

**Color analysis sidebar (below or beside chart, matching designer tab layout):**
- Illuminant selector dropdown
- Color swatch for each visible trace
- "All Visible Stacks" section (collapsible) — lists each visible design/submission with its color
- Color vs Viewing Angle section (collapsible)
- Multi-Angle Display section (collapsible)
- "Compare Colors" button — opens the same Color Comparison modal as designer tab, populated with original design + all toggled submissions

### Right Panel — Team Context (~30% width)

**Design header:**
- Design name, status badge
- Admin: status dropdown (draft / in_review / approved / production / archived)
- Non-admin: read-only status badge
- Shared by (name/email), date

**Submission Traces section:**
- List of all submissions as toggleable items
- Each item: visibility toggle (eye icon) + color swatch + submitter name + date + status badge (pending/approved/denied)
- Original design always listed first as "Original Design" with its own toggle (on by default)
- Toggling a submission runs `computeFullSpectrumFromData` on its stored data and overlays it
- **Focus indicator**: clicking a submission's name (not the eye icon) sets it as the focused trace for layer details, admittance, and e-field views. Highlighted with a subtle border/background.
- Computed spectrum data is **cached by submission ID** — toggling off/on does not re-run the calculation

**Approval Timeline section:**
- Reverse-chronological list of all submissions
- Each entry: status icon, submitter name, date, reviewer note (if reviewed), 1-line metrics summary (avg R%, layer count, color swatch)
- Clicking a timeline entry toggles that submission's visibility on the chart
- Non-admins can read full history to understand what worked and what didn't

**Metrics Comparison Table section:**
- Always visible, no interaction needed
- Rows: original design + each submission
- Columns: avg R% (visible), avg T% (visible), total thickness (nm), layer count, color swatch, delta E vs original, total stress (MPa*nm), risk level, status badge
- Engineers can scan across iterations and spot trends at a glance

**Layer Details section (expandable):**
- Shows layers for the **focused trace** (set by clicking a submission name in the Submission Traces section; defaults to original design)
- Table: layer #, material (with color swatch), thickness, packing density, IAD status
- Per-layer stress: intrinsic stress (MPa), stress force (MPa*nm), compressive/tensile indicator
- Cumulative stress total, risk level, and risk color at bottom

**Actions:**
- Clone to personal workspace (creates a new `Design` record in user's library with the design's JSON data copied — same as existing `handleCloneDesign`)
- Submit Changes (opens pre-submission comparison preview)
- Compare Colors button (opens modal)
- Admin only: Approve / Deny buttons for pending submissions (deny requires review note)

**Discussion section:**
- Comment thread, same as current implementation

## Submission Overlay Behavior

1. Workspace loads with original shared design as primary trace (always visible, focused by default)
2. Submissions listed in right panel with visibility toggles
3. Toggling a submission ON:
   - Calls `computeFullSpectrumFromData` on submission's stored data (result cached)
   - Adds trace to chart with unique assigned color
   - Color swatch, metrics row become available
4. Toggling OFF hides the trace (cached data retained)
5. For R/T/A/phase modes: all visible traces overlaid on same chart
6. For admittance/e-field: only focused trace shown
7. Color analysis updates for all visible traces

### Trace Color Assignment

Colors are assigned from a fixed palette of 12 visually distinct colors:
```
['#4f46e5', '#dc2626', '#16a34a', '#ea580c', '#7c3aed', '#0891b2',
 '#ca8a04', '#be185d', '#4338ca', '#15803d', '#9333ea', '#0d9488']
```
- Original design always gets index 0 (indigo `#4f46e5`)
- Submissions are assigned in chronological order (oldest = index 1, etc.)
- If more than 12 traces, colors cycle from index 0

## Pre-Submission Comparison Preview

When "Submit Changes" is clicked:
1. User selects a saved design from their personal library (existing flow via `apiGet('/api/designs/${id}')`)
2. Before confirming, show a comparison panel:
   - Runs `computeFullSpectrumFromData` on both the selected personal design and the original shared design
   - Runs `computeColorInfoFromSpectrum` and `computeStressFromData` on both
   - Side-by-side metrics: avg R%, avg T%, total thickness, layer count, color swatches, delta E between them, total stress, risk level
3. User can see at a glance whether their changes are meaningfully different
4. Confirm to submit, or cancel

## Error Handling

- If `designData` is malformed or has empty layers: show "Unable to render — design data incomplete" in the chart area, with the right panel still functional (timeline, comments, actions)
- If a submission's data fails to compute: show a warning icon next to that submission in the trace list, skip it in the metrics table
- If custom materials in the design are not in the viewer's material database: use the custom materials stored in `designData.customMaterials` (they're included in the saved JSON)

## Admin vs Member Experience

### All team members see:
- Full chart workspace with all display modes
- Original design as primary trace
- Toggle any submission on/off as overlay traces
- Color analysis sidebar (illuminant, swatches, angle analysis)
- Compare Colors modal with delta E
- Metrics comparison table across all submissions
- Approval timeline with reviewer notes and metrics
- Layer details with stress breakdown for any visible trace
- Clone to personal workspace
- Submit Changes with pre-submission comparison preview
- Discussion thread

### Admin-only features:
- Status dropdown to change design status
- Approve / Deny buttons on pending submissions (deny requires review note)
- Delete design / delete comments by others

## What Changes

### Replaced:
- Current simplified shared design detail view (card-based with small chart) — replaced by full workspace
- Current submission detail view (just a layer table) — removed; submissions are now overlay traces

### Unchanged:
- Team list view (team cards with member/design counts)
- Team detail view (member management, shared designs list)
- Backend API — no changes needed; all data already stored correctly
- Database schema — no changes needed

### New:
- 2 shared low-level helpers (`getRefractiveIndexStandalone`, `getExtinctionCoefficientStandalone`)
- 5 standalone calculation functions (top of opticoat-designer.js)
- Team workspace layout with chart + right panel
- Submission trace toggle system with caching
- Approval timeline component
- Metrics comparison table component
- Pre-submission comparison preview

## State Management

New state variables needed for the team workspace:
- `teamVisibleTraces`: `{ original: true, sub_<id>: boolean }` — which traces are visible
- `teamTraceColors`: `{ original: '#4f46e5', sub_<id>: string }` — color assignment per trace
- `teamTraceCache`: `{ original: [...], sub_<id>: [...] }` — cached spectrum computation results
- `teamDisplayMode`: string — current display mode in team workspace (default: 'reflectivity')
- `teamSelectedIlluminant`: string — illuminant for team workspace color analysis (default: 'D65')
- `teamActiveLayerView`: string — which trace's layers are shown in detail (default: 'original'). Set by clicking a submission name in the Submission Traces list.
- `showTeamColorCompare`: boolean — color comparison modal visibility
- `teamColorCompareSelected`: string[] — selected traces for color comparison
- `teamAdmittanceWavelengths`: number[] — wavelengths for admittance mode (default: [450, 550, 650])
- `teamEfieldWavelengths`: number[] — wavelengths for e-field mode (default: [450, 550, 650])

## Non-Goals (Explicitly Out of Scope)

- Refactoring the designer tab to use the new standalone functions (separate effort)
- Real-time collaborative editing
- Diff view showing exactly which layers changed between submissions
- Notification changes
- Backend API changes
