# Team Workspace Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the simplified team design detail view with a full optical analysis workspace where submissions become toggleable overlay traces on a shared chart with complete engineering data.

**Architecture:** Extract standalone calculation functions from existing React hooks (proven pattern with `computeReflectivityFromData`). Team workspace reuses identical math and rendering patterns as designer tab. All changes in `src/opticoat-designer.js` — no backend changes.

**Tech Stack:** React 19, Recharts 3.6, standalone Tailwind CSS (use inline styles for missing classes), Prisma/PostgreSQL backend (unchanged)

**Spec:** `docs/superpowers/specs/2026-03-15-team-workspace-design.md`

---

## Chunk 1: Standalone Calculation Functions

### Task 1: Shared Low-Level Helpers

**Files:**
- Modify: `src/opticoat-designer.js` — insert after `computeReflectivityFromData` (after line ~300)

These two helpers eliminate duplication across all standalone functions. They replicate the logic from `getRefractiveIndex` (line 1045) and `getExtinctionCoefficient` (line 1025) but take an explicit `allMats` dict instead of using React closure state.

- [ ] **Step 1: Add `getRefractiveIndexStandalone`**

Insert after `computeReflectivityFromData` (after line ~293), before `const ThinFilmDesigner`:

```javascript
function getRefractiveIndexStandalone(material, wavelength, allMats, iadSettings = null, packingDensity = 1.0) {
  const data = allMats[material];
  if (!data) return 1.5;
  const lambdaMicrons = wavelength / 1000;
  let baseN;
  if (data.type === 'sellmeier') {
    const { B1, B2, B3, C1, C2, C3 } = data;
    const lambda2 = lambdaMicrons * lambdaMicrons;
    baseN = Math.sqrt(Math.abs(1 + (B1 * lambda2) / (lambda2 - C1) + (B2 * lambda2) / (lambda2 - C2) + (B3 * lambda2) / (lambda2 - C3)));
  } else if (data.type === 'cauchy') {
    baseN = data.A + data.B / (lambdaMicrons * lambdaMicrons) + (data.C || 0) / (lambdaMicrons ** 4);
  } else {
    baseN = data.n || 1.5;
  }
  if (iadSettings && iadSettings.enabled) {
    baseN = baseN * (1 + iadSettings.riIncrease / 100);
  }
  if (packingDensity < 1.0) {
    baseN = (packingDensity * baseN) + ((1 - packingDensity) * 1.0);
  }
  return baseN;
}

function getExtinctionCoefficientStandalone(material, wavelength, allMats) {
  const data = allMats[material];
  if (!data) return 0;
  if (data.kType === 'none' || !data.kType) return 0;
  if (data.kType === 'constant') return data.kValue || 0;
  if (data.kType === 'urbach') {
    const { k0, kEdge, kDecay } = data;
    if (wavelength <= kEdge) return k0;
    return k0 * Math.exp(-kDecay * (wavelength - kEdge));
  }
  return 0;
}
```

- [ ] **Step 2: Build and verify no errors**

Run: `npx craco build 2>&1 | tail -5`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add src/opticoat-designer.js
git commit -m "feat: add standalone refractive index and extinction coefficient helpers"
```

---

### Task 2: `computeFullSpectrumFromData`

**Files:**
- Modify: `src/opticoat-designer.js` — insert after the helpers from Task 1

This replaces the simpler `computeReflectivityFromData` for the team workspace. It computes R, T, A, and phase using the full transfer matrix with extinction coefficients, IAD, packing density, and tooling factors.

- [ ] **Step 1: Add the function**

```javascript
function computeFullSpectrumFromData(designData, customMats = {}) {
  if (!designData) return [];
  const allMats = { ...materialDispersion, ...customMats };

  // Resolve layers from current stack
  let layers = designData.layers || [];
  if (designData.layerStacks && designData.currentStackId) {
    const cs = designData.layerStacks.find(s => s.id === designData.currentStackId);
    if (cs && cs.layers && cs.layers.length > 0) layers = cs.layers;
  }
  if (layers.length === 0) return [];

  const wlRange = designData.wavelengthRange || { min: 380, max: 780, step: 5 };
  const n0 = designData.incident?.n || 1.0;
  const ns = designData.substrate?.n || 1.52;

  // Resolve tooling factors
  const machine = (designData.machines || []).find(m => m.id === designData.currentMachineId) || designData.machines?.[0];
  const toolingFactors = machine?.toolingFactors || {};

  const result = [];
  const step = Math.max(wlRange.step || 5, 2);

  for (let wl = wlRange.min; wl <= wlRange.max; wl += step) {
    // Transfer matrix with complex refractive index
    let M11r = 1, M11i = 0, M12r = 0, M12i = 0;
    let M21r = 0, M21i = 0, M22r = 1, M22i = 0;

    for (let i = layers.length - 1; i >= 0; i--) {
      const layer = layers[i];
      const nr = getRefractiveIndexStandalone(layer.material, wl, allMats, layer.iad, layer.packingDensity || 1.0);
      const ni = getExtinctionCoefficientStandalone(layer.material, wl, allMats);
      const tf = toolingFactors[layer.material] || 1.0;
      const d = (Number(layer.thickness) || 0) * tf;

      // Complex phase: delta = 2*pi*(nr - i*ni)*d / wl
      const deltaR = (2 * Math.PI * nr * d) / wl;
      const deltaI = -(2 * Math.PI * ni * d) / wl;

      // cos(deltaR + i*deltaI) = cos(deltaR)*cosh(deltaI) + i*sin(deltaR)*sinh(deltaI)
      const cosR = Math.cos(deltaR) * Math.cosh(deltaI);
      const cosI = Math.sin(deltaR) * Math.sinh(deltaI);
      // sin(deltaR + i*deltaI) = sin(deltaR)*cosh(deltaI) - i*cos(deltaR)*sinh(deltaI)
      const sinR = Math.sin(deltaR) * Math.cosh(deltaI);
      const sinI = -Math.cos(deltaR) * Math.sinh(deltaI);

      // eta = nr - i*ni (complex admittance of layer)
      const etaR = nr, etaI = -ni;
      const etaMag2 = etaR * etaR + etaI * etaI;

      // Layer matrix: [[cos(d), i*sin(d)/eta], [i*eta*sin(d), cos(d)]]
      // i*sin/eta
      const a12r = (-sinI * etaR - sinR * etaI) / etaMag2;
      const a12i = (sinR * etaR - sinI * etaI) / etaMag2;
      // i*eta*sin
      const a21r = -sinI * etaR + sinR * etaI;
      const a21i = sinR * etaR + sinI * etaI;

      // M_new = LayerMatrix * M_old
      const t11r = cosR * M11r - cosI * M11i + a12r * M21r - a12i * M21i;
      const t11i = cosR * M11i + cosI * M11r + a12r * M21i + a12i * M21r;
      const t12r = cosR * M12r - cosI * M12i + a12r * M22r - a12i * M22i;
      const t12i = cosR * M12i + cosI * M12r + a12r * M22i + a12i * M22r;
      const t21r = a21r * M11r - a21i * M11i + cosR * M21r - cosI * M21i;
      const t21i = a21r * M11i + a21i * M11r + cosR * M21i + cosI * M21r;
      const t22r = a21r * M12r - a21i * M12i + cosR * M22r - cosI * M22i;
      const t22i = a21r * M12i + a21i * M12r + cosR * M22i + cosI * M22r;

      M11r = t11r; M11i = t11i; M12r = t12r; M12i = t12i;
      M21r = t21r; M21i = t21i; M22r = t22r; M22i = t22i;
    }

    // Reflection coefficient: r = (n0*M11 + n0*ns*M12 - M21 - ns*M22) / (n0*M11 + n0*ns*M12 + M21 + ns*M22)
    const numR = n0 * M11r + n0 * ns * M12r - M21r - ns * M22r;
    const numI = n0 * M11i + n0 * ns * M12i - M21i - ns * M22i;
    const denR = n0 * M11r + n0 * ns * M12r + M21r + ns * M22r;
    const denI = n0 * M11i + n0 * ns * M12i + M21i + ns * M22i;
    const denMag2 = denR * denR + denI * denI;
    const rR = (numR * denR + numI * denI) / denMag2;
    const rI = (numI * denR - numR * denI) / denMag2;
    const R = Math.min((rR * rR + rI * rI) * 100, 100);

    // Transmission via Beer-Lambert absorption per layer
    let totalAbsorption = 0;
    let remainingIntensity = 1 - R / 100;
    for (let i = layers.length - 1; i >= 0; i--) {
      const k = getExtinctionCoefficientStandalone(layers[i].material, wl, allMats);
      if (k > 0) {
        const tf = toolingFactors[layers[i].material] || 1.0;
        const d = (Number(layers[i].thickness) || 0) * tf;
        const alpha = (4 * Math.PI * k * d) / wl;
        const layerAbsorption = remainingIntensity * (1 - Math.exp(-alpha));
        totalAbsorption += layerAbsorption;
        remainingIntensity -= layerAbsorption;
      }
    }
    const T = Math.max(0, (1 - R / 100 - totalAbsorption) * 100);
    const A = totalAbsorption * 100;

    // Phase angle
    const phase = Math.atan2(rI, rR) * 180 / Math.PI;

    result.push({ wavelength: wl, R, T, A, phase });
  }
  return result;
}
```

- [ ] **Step 2: Build and verify**

Run: `npx craco build 2>&1 | tail -5`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add src/opticoat-designer.js
git commit -m "feat: add computeFullSpectrumFromData with extinction, tooling, T/A/phase"
```

---

### Task 3: `computeColorInfoFromSpectrum`

**Files:**
- Modify: `src/opticoat-designer.js` — insert after `computeFullSpectrumFromData`

Standalone version of `calculateColorInfo` (lines 1624-2296). Takes spectrum data output, not raw design data. Includes CIE 1931 observer, 5 illuminant SPDs, XYZ→Lab→LCh→sRGB conversion.

- [ ] **Step 1: Add the function**

This is large (~250 lines) because it embeds CIE observer data and illuminant SPDs. The data tables are copied from the existing `calculateColorInfo` function (lines 1628-2139).

```javascript
function computeColorInfoFromSpectrum(spectrumData, illuminant = 'D65') {
  if (!spectrumData || spectrumData.length === 0) return null;

  // CIE 1931 2° Standard Observer (380-780nm, 5nm intervals)
  // and Illuminant SPD data — identical to calculateColorInfo (lines 1628-2139)
  const CIE_DATA = {
    380: { x: 0.0014, y: 0.0000, z: 0.0065 },
    385: { x: 0.0022, y: 0.0001, z: 0.0105 },
    390: { x: 0.0042, y: 0.0001, z: 0.0201 },
    395: { x: 0.0076, y: 0.0002, z: 0.0362 },
    400: { x: 0.0143, y: 0.0004, z: 0.0679 },
    405: { x: 0.0232, y: 0.0006, z: 0.1102 },
    410: { x: 0.0435, y: 0.0012, z: 0.2074 },
    415: { x: 0.0776, y: 0.0022, z: 0.3713 },
    420: { x: 0.1344, y: 0.0040, z: 0.6456 },
    425: { x: 0.2148, y: 0.0073, z: 1.0391 },
    430: { x: 0.2839, y: 0.0116, z: 1.3856 },
    435: { x: 0.3285, y: 0.0168, z: 1.6230 },
    440: { x: 0.3483, y: 0.0230, z: 1.7471 },
    445: { x: 0.3481, y: 0.0298, z: 1.7826 },
    450: { x: 0.3362, y: 0.0380, z: 1.7721 },
    455: { x: 0.3187, y: 0.0480, z: 1.7441 },
    460: { x: 0.2908, y: 0.0600, z: 1.6692 },
    465: { x: 0.2511, y: 0.0739, z: 1.5281 },
    470: { x: 0.1954, y: 0.0910, z: 1.2876 },
    475: { x: 0.1421, y: 0.1126, z: 1.0419 },
    480: { x: 0.0956, y: 0.1390, z: 0.8130 },
    485: { x: 0.0580, y: 0.1693, z: 0.6162 },
    490: { x: 0.0320, y: 0.2080, z: 0.4652 },
    495: { x: 0.0147, y: 0.2586, z: 0.3533 },
    500: { x: 0.0049, y: 0.3230, z: 0.2720 },
    505: { x: 0.0024, y: 0.4073, z: 0.2123 },
    510: { x: 0.0093, y: 0.5030, z: 0.1582 },
    515: { x: 0.0291, y: 0.6082, z: 0.1117 },
    520: { x: 0.0633, y: 0.7100, z: 0.0782 },
    525: { x: 0.1096, y: 0.7932, z: 0.0573 },
    530: { x: 0.1655, y: 0.8620, z: 0.0422 },
    535: { x: 0.2257, y: 0.9149, z: 0.0298 },
    540: { x: 0.2904, y: 0.9540, z: 0.0203 },
    545: { x: 0.3597, y: 0.9803, z: 0.0134 },
    550: { x: 0.4334, y: 0.9950, z: 0.0087 },
    555: { x: 0.5121, y: 1.0002, z: 0.0057 },
    560: { x: 0.5945, y: 0.9950, z: 0.0039 },
    565: { x: 0.6784, y: 0.9786, z: 0.0027 },
    570: { x: 0.7621, y: 0.9520, z: 0.0021 },
    575: { x: 0.8425, y: 0.9154, z: 0.0018 },
    580: { x: 0.9163, y: 0.8700, z: 0.0017 },
    585: { x: 0.9786, y: 0.8163, z: 0.0014 },
    590: { x: 1.0263, y: 0.7570, z: 0.0011 },
    595: { x: 1.0567, y: 0.6949, z: 0.0010 },
    600: { x: 1.0622, y: 0.6310, z: 0.0008 },
    605: { x: 1.0456, y: 0.5668, z: 0.0006 },
    610: { x: 1.0026, y: 0.5030, z: 0.0003 },
    615: { x: 0.9384, y: 0.4412, z: 0.0002 },
    620: { x: 0.8544, y: 0.3810, z: 0.0002 },
    625: { x: 0.7514, y: 0.3210, z: 0.0001 },
    630: { x: 0.6424, y: 0.2650, z: 0.0000 },
    635: { x: 0.5419, y: 0.2170, z: 0.0000 },
    640: { x: 0.4479, y: 0.1750, z: 0.0000 },
    645: { x: 0.3608, y: 0.1382, z: 0.0000 },
    650: { x: 0.2835, y: 0.1070, z: 0.0000 },
    655: { x: 0.2187, y: 0.0816, z: 0.0000 },
    660: { x: 0.1649, y: 0.0610, z: 0.0000 },
    665: { x: 0.1212, y: 0.0446, z: 0.0000 },
    670: { x: 0.0874, y: 0.0320, z: 0.0000 },
    675: { x: 0.0636, y: 0.0232, z: 0.0000 },
    680: { x: 0.0468, y: 0.0170, z: 0.0000 },
    685: { x: 0.0329, y: 0.0119, z: 0.0000 },
    690: { x: 0.0227, y: 0.0082, z: 0.0000 },
    695: { x: 0.0158, y: 0.0057, z: 0.0000 },
    700: { x: 0.0114, y: 0.0041, z: 0.0000 },
    705: { x: 0.0081, y: 0.0029, z: 0.0000 },
    710: { x: 0.0058, y: 0.0021, z: 0.0000 },
    715: { x: 0.0041, y: 0.0015, z: 0.0000 },
    720: { x: 0.0029, y: 0.0010, z: 0.0000 },
    725: { x: 0.0020, y: 0.0007, z: 0.0000 },
    730: { x: 0.0014, y: 0.0005, z: 0.0000 },
    735: { x: 0.0010, y: 0.0004, z: 0.0000 },
    740: { x: 0.0007, y: 0.0002, z: 0.0000 },
    745: { x: 0.0005, y: 0.0002, z: 0.0000 },
    750: { x: 0.0003, y: 0.0001, z: 0.0000 },
    755: { x: 0.0002, y: 0.0001, z: 0.0000 },
    760: { x: 0.0002, y: 0.0001, z: 0.0000 },
    765: { x: 0.0001, y: 0.0000, z: 0.0000 },
    770: { x: 0.0001, y: 0.0000, z: 0.0000 },
    775: { x: 0.0000, y: 0.0000, z: 0.0000 },
    780: { x: 0.0000, y: 0.0000, z: 0.0000 },
  };

  // Illuminant SPDs — copy the EXACT data tables from calculateColorInfo (lines 1628-2054)
  // Each illuminant has SPD values at 5nm intervals 380-780 and a whitePoint { Xn, Yn, Zn }
  // NOTE TO IMPLEMENTER: Copy the full ILLUMINANT_SPD object from calculateColorInfo.
  // It is ~400 lines of data tables. The structure is:
  // const ILLUMINANT_SPD = { D65: { 380: 49.98, 385: 52.31, ..., whitePoint: { Xn: 0.9505, Yn: 1.0, Zn: 1.089 } }, D50: {...}, A: {...}, F2: {...}, F11: {...} };
  // For brevity in this plan, use a placeholder that references the existing data.
  // The implementer MUST copy the full data from the existing function.

  const getCIEData = (wavelength) => {
    const rounded = Math.round(wavelength / 5) * 5;
    if (CIE_DATA[rounded]) return CIE_DATA[rounded];
    const lower = Math.floor(wavelength / 5) * 5;
    const upper = lower + 5;
    const dl = CIE_DATA[lower], du = CIE_DATA[upper];
    if (!dl || !du) return CIE_DATA[rounded] || { x: 0, y: 0, z: 0 };
    const frac = (wavelength - lower) / 5;
    return { x: dl.x + frac * (du.x - dl.x), y: dl.y + frac * (du.y - dl.y), z: dl.z + frac * (du.z - dl.z) };
  };

  const illumData = ILLUMINANT_SPD[illuminant] || ILLUMINANT_SPD.D65;

  // XYZ tristimulus
  let X = 0, Y = 0, Z = 0, normalization = 0;
  spectrumData.forEach(d => {
    if (d.wavelength < 380 || d.wavelength > 780) return;
    const reflectance = d.R / 100;
    const cie = getCIEData(d.wavelength);
    const spd = illumData[Math.round(d.wavelength / 5) * 5] || 100;
    X += reflectance * spd * cie.x;
    Y += reflectance * spd * cie.y;
    Z += reflectance * spd * cie.z;
    normalization += spd * cie.y;
  });
  if (normalization === 0) return null;
  X /= normalization; Y /= normalization; Z /= normalization;

  // XYZ → Lab
  const { Xn, Yn, Zn } = illumData.whitePoint;
  const f = (t) => t > (6/29)**3 ? Math.pow(t, 1/3) : t / (3 * (6/29)**2) + 4/29;
  const fx = f(X / Xn), fy = f(Y / Yn), fz = f(Z / Zn);
  const L = 116 * fy - 16;
  const a = 500 * (fx - fy);
  const b = 200 * (fy - fz);

  // Lab → LCh
  const C = Math.sqrt(a * a + b * b);
  let h = Math.atan2(b, a) * 180 / Math.PI;
  if (h < 0) h += 360;

  // XYZ → sRGB
  let Rl = X * 3.2406 + Y * -1.5372 + Z * -0.4986;
  let Gl = X * -0.9689 + Y * 1.8758 + Z * 0.0415;
  let Bl = X * 0.0557 + Y * -0.204 + Z * 1.057;
  const gamma = (c) => c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1/2.4) - 0.055;
  Rl = gamma(Rl); Gl = gamma(Gl); Bl = gamma(Bl);
  const maxRGB = Math.max(Rl, Gl, Bl);
  if (maxRGB > 1) { Rl /= maxRGB; Gl /= maxRGB; Bl /= maxRGB; }
  const R8 = Math.max(0, Math.min(255, Math.round(Rl * 255)));
  const G8 = Math.max(0, Math.min(255, Math.round(Gl * 255)));
  const B8 = Math.max(0, Math.min(255, Math.round(Bl * 255)));

  // Dominant wavelength & color name
  let maxR = 0, domWl = 0;
  spectrumData.forEach(d => { if (d.wavelength >= 380 && d.wavelength <= 780 && d.R > maxR) { maxR = d.R; domWl = d.wavelength; } });
  const avgR = spectrumData.filter(d => d.wavelength >= 380 && d.wavelength <= 780).reduce((s, d) => s + d.R, 0) / Math.max(1, spectrumData.filter(d => d.wavelength >= 380 && d.wavelength <= 780).length);

  let colorName = 'Neutral/Achromatic';
  if (C > 10) {
    if (h >= 0 && h < 30) colorName = 'Red';
    else if (h < 60) colorName = 'Orange';
    else if (h < 90) colorName = 'Yellow';
    else if (h < 150) colorName = 'Yellow-Green';
    else if (h < 210) colorName = 'Green-Cyan';
    else if (h < 270) colorName = 'Cyan-Blue';
    else if (h < 330) colorName = 'Blue-Magenta';
    else colorName = 'Magenta-Red';
  }

  return {
    rgb: `rgb(${R8}, ${G8}, ${B8})`,
    hex: `#${R8.toString(16).padStart(2,'0')}${G8.toString(16).padStart(2,'0')}${B8.toString(16).padStart(2,'0')}`,
    dominantWavelength: domWl, colorName,
    avgReflectivity: avgR.toFixed(1),
    X: X.toFixed(4), Y: Y.toFixed(4), Z: Z.toFixed(4),
    L: L.toFixed(1), a_star: a.toFixed(1), b_star: b.toFixed(1),
    L_lch: L.toFixed(1), C: C.toFixed(1), h: h.toFixed(1),
  };
}
```

**CRITICAL NOTE TO IMPLEMENTER:** The `ILLUMINANT_SPD` object must be copied in full from the existing `calculateColorInfo` function (lines 1628-2054). It contains ~400 lines of spectral power distribution data for D65, D50, A, F2, and F11 illuminants including their white points. Do NOT abbreviate — the color calculations require the exact SPD values.

- [ ] **Step 2: Build and verify**

Run: `npx craco build 2>&1 | tail -5`

- [ ] **Step 3: Commit**

```bash
git add src/opticoat-designer.js
git commit -m "feat: add computeColorInfoFromSpectrum standalone color analysis"
```

---

### Task 4: `computeStressFromData`

**Files:**
- Modify: `src/opticoat-designer.js` — insert after `computeColorInfoFromSpectrum`

- [ ] **Step 1: Add the function**

```javascript
function computeStressFromData(designData, customMats = {}) {
  const allMats = { ...materialDispersion, ...customMats };
  let layers = designData?.layers || [];
  if (designData?.layerStacks && designData.currentStackId) {
    const cs = designData.layerStacks.find(s => s.id === designData.currentStackId);
    if (cs && cs.layers && cs.layers.length > 0) layers = cs.layers;
  }
  if (layers.length === 0) return null;

  const stressData = [];
  let cumulativeStress = 0;
  let totalCompressive = 0, totalTensile = 0;

  layers.forEach((layer, idx) => {
    const materialData = allMats[layer.material];
    const intrinsicStress = materialData?.stress || 0;
    const thickness = Number(layer.thickness) || 0;
    const stressForce = intrinsicStress * thickness;
    cumulativeStress += stressForce;
    if (stressForce < 0) totalTensile += stressForce;
    else if (stressForce > 0) totalCompressive += stressForce;

    stressData.push({
      layerNum: idx + 1,
      material: layer.material,
      thickness,
      intrinsicStress,
      stressForce,
      cumulativeStress,
      stressType: intrinsicStress > 0 ? 'Compressive' : intrinsicStress < 0 ? 'Tensile' : 'Neutral',
    });
  });

  const totalStressMagnitude = Math.abs(cumulativeStress);
  let riskLevel, riskColor, recommendation;
  if (totalStressMagnitude < 50000) {
    riskLevel = 'LOW'; riskColor = '#10b981';
    recommendation = 'Safe for production. No annealing required.';
  } else if (totalStressMagnitude < 150000) {
    riskLevel = 'MEDIUM'; riskColor = '#f59e0b';
    recommendation = 'Monitor adhesion. Consider post-deposition annealing at 150\u00b0C for 2 hours.';
  } else {
    riskLevel = 'HIGH'; riskColor = '#ef4444';
    recommendation = 'High risk of delamination. REDESIGN RECOMMENDED.';
  }

  return {
    layers: stressData,
    totalStress: cumulativeStress,
    totalStressMagnitude,
    totalCompressive,
    totalTensile,
    totalPhysicalThickness: layers.reduce((s, l) => s + (Number(l.thickness) || 0), 0),
    riskLevel, riskColor, recommendation,
  };
}
```

- [ ] **Step 2: Build and verify**
- [ ] **Step 3: Commit**

```bash
git add src/opticoat-designer.js
git commit -m "feat: add computeStressFromData standalone stress analysis"
```

---

### Task 5: `computeAdmittanceFromData` and `computeEfieldFromData`

**Files:**
- Modify: `src/opticoat-designer.js` — insert after `computeStressFromData`

- [ ] **Step 1: Add `computeAdmittanceFromData`**

Replicate the logic from `calculateAdmittanceLoci` (lines 2676-2748) but standalone. Takes `wavelengths` array.

```javascript
function computeAdmittanceFromData(designData, customMats = {}, wavelengths = [450, 550, 650]) {
  const allMats = { ...materialDispersion, ...customMats };
  let layers = designData?.layers || [];
  if (designData?.layerStacks && designData.currentStackId) {
    const cs = designData.layerStacks.find(s => s.id === designData.currentStackId);
    if (cs && cs.layers && cs.layers.length > 0) layers = cs.layers;
  }
  if (layers.length === 0) return [];

  const ns = designData.substrate?.n || 1.52;
  const machine = (designData.machines || []).find(m => m.id === designData.currentMachineId) || designData.machines?.[0];
  const toolingFactors = machine?.toolingFactors || {};
  const admittanceColors = ['#2563eb', '#16a34a', '#dc2626', '#9333ea', '#ea580c'];
  const stepsPerLayer = 15;

  return wavelengths.map((lambda, wIdx) => {
    const locusColor = admittanceColors[wIdx % admittanceColors.length];
    const points = [];
    let Yr = ns, Yi = 0;
    points.push({ re: Yr, im: Yi, layerIndex: -1, t: 0, label: 'Substrate', isBoundary: true, material: 'Substrate', locusColor });

    for (let i = layers.length - 1; i >= 0; i--) {
      const layer = layers[i];
      const nr = getRefractiveIndexStandalone(layer.material, lambda, allMats, layer.iad, layer.packingDensity || 1.0);
      const ni = getExtinctionCoefficientStandalone(layer.material, lambda, allMats);
      const tf = toolingFactors[layer.material] || 1.0;
      const d = (Number(layer.thickness) || 0) * tf;
      const etaR = nr, etaI = -ni;
      const delta0 = (2 * Math.PI * d) / lambda;
      const YstartR = Yr, YstartI = Yi;

      for (let step = 1; step <= stepsPerLayer; step++) {
        const frac = step / stepsPerLayer;
        const dR = frac * delta0 * nr;
        const dI = frac * delta0 * ni;
        const cosA = Math.cos(dR), sinA = Math.sin(dR);
        const coshB = Math.cosh(dI), sinhB = Math.sinh(dI);
        const cosDr = cosA * coshB, cosDi = sinA * sinhB;
        const sinDr = sinA * coshB, sinDi = -cosA * sinhB;
        const sinYr = sinDr * YstartR - sinDi * YstartI;
        const sinYi = sinDr * YstartI + sinDi * YstartR;
        const etaMag2 = etaR * etaR + etaI * etaI;
        const sYeR = (sinYr * etaR + sinYi * etaI) / etaMag2;
        const sYeI = (sinYi * etaR - sinYr * etaI) / etaMag2;
        const Br = cosDr - sYeI, Bi = cosDi + sYeR;
        const eSr = etaR * sinDr - etaI * sinDi;
        const eSi = etaR * sinDi + etaI * sinDr;
        const ieSr = -eSi, ieSi = eSr;
        const cYr = cosDr * YstartR - cosDi * YstartI;
        const cYi = cosDr * YstartI + cosDi * YstartR;
        const Cr = ieSr + cYr, Ci = ieSi + cYi;
        const Bmag2 = Br * Br + Bi * Bi;
        const YnR = (Cr * Br + Ci * Bi) / Bmag2;
        const YnI = (Ci * Br - Cr * Bi) / Bmag2;
        const isEnd = step === stepsPerLayer;
        points.push({ re: YnR, im: YnI, layerIndex: layers.length - 1 - i, t: frac, label: isEnd ? layer.material : null, isBoundary: isEnd, material: layer.material, locusColor });
        if (isEnd) { Yr = YnR; Yi = YnI; }
      }
    }
    return { wavelength: lambda, color: locusColor, points };
  });
}
```

- [ ] **Step 2: Add `computeEfieldFromData`**

Replicate logic from `calculateEfieldDistribution` (lines 2781-2980). Two-pass: full transfer matrix for transmission amplitude, then partial matrices for E-field intensity.

```javascript
function computeEfieldFromData(designData, customMats = {}, wavelengths = [450, 550, 650]) {
  const allMats = { ...materialDispersion, ...customMats };
  let layers = designData?.layers || [];
  if (designData?.layerStacks && designData.currentStackId) {
    const cs = designData.layerStacks.find(s => s.id === designData.currentStackId);
    if (cs && cs.layers && cs.layers.length > 0) layers = cs.layers;
  }
  if (layers.length === 0) return { lines: [], layers: [], data: [] };

  const n0 = designData.incident?.n || 1.0;
  const ns = designData.substrate?.n || 1.52;
  const machine = (designData.machines || []).find(m => m.id === designData.currentMachineId) || designData.machines?.[0];
  const toolingFactors = machine?.toolingFactors || {};
  const admittanceColors = ['#2563eb', '#16a34a', '#dc2626', '#9333ea', '#ea580c'];
  const stepsPerLayer = 40;

  // Build layer regions for chart backgrounds
  const layerRegions = [];
  let depthAccum = 0;
  for (let i = layers.length - 1; i >= 0; i--) {
    const layer = layers[i];
    const tf = toolingFactors[layer.material] || 1.0;
    const d = (Number(layer.thickness) || 0) * tf;
    const matColor = allMats[layer.material]?.color || '#888';
    layerRegions.push({ x1: depthAccum, x2: depthAccum + d, material: layer.material, color: matColor });
    depthAccum += d;
  }

  // Unified depth grid
  const depthPoints = [{ depth: 0, material: 'Substrate' }];
  let zAccum = 0;
  for (let i = layers.length - 1; i >= 0; i--) {
    const tf = toolingFactors[layers[i].material] || 1.0;
    const d = (Number(layers[i].thickness) || 0) * tf;
    for (let step = 1; step <= stepsPerLayer; step++) {
      depthPoints.push({ depth: zAccum + (step / stepsPerLayer) * d, material: layers[i].material });
    }
    zAccum += d;
  }

  const allLines = wavelengths.map((lambda, wIdx) => {
    // Pass 1: Full transfer matrix to get transmission amplitude
    let M11r = 1, M11i = 0, M12r = 0, M12i = 0;
    let M21r = 0, M21i = 0, M22r = 1, M22i = 0;
    for (let i = layers.length - 1; i >= 0; i--) {
      const nr = getRefractiveIndexStandalone(layers[i].material, lambda, allMats, layers[i].iad, layers[i].packingDensity || 1.0);
      const ni = getExtinctionCoefficientStandalone(layers[i].material, lambda, allMats);
      const tf = toolingFactors[layers[i].material] || 1.0;
      const d = (Number(layers[i].thickness) || 0) * tf;
      const deltaR = (2 * Math.PI * nr * d) / lambda;
      const deltaI = -(2 * Math.PI * ni * d) / lambda;
      const cosR = Math.cos(deltaR) * Math.cosh(deltaI);
      const cosI = Math.sin(deltaR) * Math.sinh(deltaI);
      const sinR = Math.sin(deltaR) * Math.cosh(deltaI);
      const sinI = -Math.cos(deltaR) * Math.sinh(deltaI);
      const etaR = nr, etaI = -ni;
      const etaMag2 = etaR * etaR + etaI * etaI;
      const a12r = (-sinI * etaR - sinR * etaI) / etaMag2;
      const a12i = (sinR * etaR - sinI * etaI) / etaMag2;
      const a21r = -sinI * etaR + sinR * etaI;
      const a21i = sinR * etaR + sinI * etaI;
      const t11r = cosR * M11r - cosI * M11i + a12r * M21r - a12i * M21i;
      const t11i = cosR * M11i + cosI * M11r + a12r * M21i + a12i * M21r;
      const t12r = cosR * M12r - cosI * M12i + a12r * M22r - a12i * M22i;
      const t12i = cosR * M12i + cosI * M12r + a12r * M22i + a12i * M22r;
      const t21r = a21r * M11r - a21i * M11i + cosR * M21r - cosI * M21i;
      const t21i = a21r * M11i + a21i * M11r + cosR * M21i + cosI * M21r;
      const t22r = a21r * M12r - a21i * M12i + cosR * M22r - cosI * M22i;
      const t22i = a21r * M12i + a21i * M12r + cosR * M22i + cosI * M22r;
      M11r = t11r; M11i = t11i; M12r = t12r; M12i = t12i;
      M21r = t21r; M21i = t21i; M22r = t22r; M22i = t22i;
    }
    // t = 2*n0 / (n0*B + C) where B = M11 + ns*M12, C = M21 + ns*M22
    const Br = M11r + ns * M12r, Bi = M11i + ns * M12i;
    const Cr = M21r + ns * M22r, Ci = M21i + ns * M22i;
    const denR = n0 * Br + Cr, denI = n0 * Bi + Ci;
    const denMag2 = denR * denR + denI * denI;
    const tR = (2 * n0 * denR) / denMag2;
    const tI = -(2 * n0 * denI) / denMag2;
    const tMag2 = tR * tR + tI * tI;

    // Pass 2: Partial transfer matrices for E-field
    let P11r = 1, P11i = 0, P12r = 0, P12i = 0;
    let P21r = 0, P21i = 0, P22r = 1, P22i = 0;
    const intensities = [(1) * tMag2]; // substrate point

    for (let i = layers.length - 1; i >= 0; i--) {
      const nr = getRefractiveIndexStandalone(layers[i].material, lambda, allMats, layers[i].iad, layers[i].packingDensity || 1.0);
      const ni = getExtinctionCoefficientStandalone(layers[i].material, lambda, allMats);
      const tf = toolingFactors[layers[i].material] || 1.0;
      const d = (Number(layers[i].thickness) || 0) * tf;

      for (let step = 1; step <= stepsPerLayer; step++) {
        const frac = step / stepsPerLayer;
        const subD = frac * d;
        const deltaR = (2 * Math.PI * nr * subD) / lambda;
        const deltaI = -(2 * Math.PI * ni * subD) / lambda;
        const cosR2 = Math.cos(deltaR) * Math.cosh(deltaI);
        const cosI2 = Math.sin(deltaR) * Math.sinh(deltaI);
        const sinR2 = Math.sin(deltaR) * Math.cosh(deltaI);
        const sinI2 = -Math.cos(deltaR) * Math.sinh(deltaI);
        const etaR2 = nr, etaI2 = -ni;
        const etaMag2b = etaR2 * etaR2 + etaI2 * etaI2;
        const s12r = (-sinI2 * etaR2 - sinR2 * etaI2) / etaMag2b;
        const s12i = (sinR2 * etaR2 - sinI2 * etaI2) / etaMag2b;

        // B(z) = cos(delta_partial) * P11 + i*sin(delta_partial)/eta * P21 ... simplified:
        // We need B(z) = first row of (partial_layer_matrix * P) applied to [1, ns]
        const BzR = (cosR2 * P11r - cosI2 * P11i + s12r * P21r - s12i * P21i)
                   + ns * (cosR2 * P12r - cosI2 * P12i + s12r * P22r - s12i * P22i);
        const BzI = (cosR2 * P11i + cosI2 * P11r + s12r * P21i + s12i * P21r)
                   + ns * (cosR2 * P12i + cosI2 * P12r + s12r * P22i + s12i * P22r);

        intensities.push((BzR * BzR + BzI * BzI) * tMag2);
      }

      // Update P with full layer matrix
      const deltaRf = (2 * Math.PI * nr * d) / lambda;
      const deltaIf = -(2 * Math.PI * ni * d) / lambda;
      const cosRf = Math.cos(deltaRf) * Math.cosh(deltaIf);
      const cosIf = Math.sin(deltaRf) * Math.sinh(deltaIf);
      const sinRf = Math.sin(deltaRf) * Math.cosh(deltaIf);
      const sinIf = -Math.cos(deltaRf) * Math.sinh(deltaIf);
      const etaRf = nr, etaIf = -ni;
      const etaMag2f = etaRf * etaRf + etaIf * etaIf;
      const f12r = (-sinIf * etaRf - sinRf * etaIf) / etaMag2f;
      const f12i = (sinRf * etaRf - sinIf * etaIf) / etaMag2f;
      const f21r = -sinIf * etaRf + sinRf * etaIf;
      const f21i = sinRf * etaRf + sinIf * etaIf;
      const np11r = cosRf * P11r - cosIf * P11i + f12r * P21r - f12i * P21i;
      const np11i = cosRf * P11i + cosIf * P11r + f12r * P21i + f12i * P21r;
      const np12r = cosRf * P12r - cosIf * P12i + f12r * P22r - f12i * P22i;
      const np12i = cosRf * P12i + cosIf * P12r + f12r * P22i + f12i * P22r;
      const np21r = f21r * P11r - f21i * P11i + cosRf * P21r - cosIf * P21i;
      const np21i = f21r * P11i + f21i * P11r + cosRf * P21i + cosIf * P21r;
      const np22r = f21r * P12r - f21i * P12i + cosRf * P22r - cosIf * P22i;
      const np22i = f21r * P12i + f21i * P12r + cosRf * P22i + cosIf * P22r;
      P11r = np11r; P11i = np11i; P12r = np12r; P12i = np12i;
      P21r = np21r; P21i = np21i; P22r = np22r; P22i = np22i;
    }

    return { wavelength: lambda, color: admittanceColors[wIdx % admittanceColors.length], intensities };
  });

  const mergedData = depthPoints.map((pt, idx) => {
    const row = { depth: parseFloat(pt.depth.toFixed(2)), material: pt.material };
    allLines.forEach(line => { row[`intensity_${line.wavelength}`] = line.intensities[idx]; });
    return row;
  });

  return {
    lines: allLines.map(l => ({ wavelength: l.wavelength, color: l.color })),
    layers: layerRegions,
    data: mergedData,
  };
}
```

- [ ] **Step 3: Build and verify**
- [ ] **Step 4: Commit**

```bash
git add src/opticoat-designer.js
git commit -m "feat: add standalone admittance and e-field calculation functions"
```

---

## Chunk 2: State Variables & Team Workspace Layout

### Task 6: Add Team Workspace State Variables

**Files:**
- Modify: `src/opticoat-designer.js` — add near existing team state variables (~line 567)

- [ ] **Step 1: Add state variables**

After the existing team state block (`const [reviewNoteText, setReviewNoteText] = ...`), add:

```javascript
// Team workspace state
const [teamVisibleTraces, setTeamVisibleTraces] = useState({ original: true });
const [teamTraceColors] = useState(() => {
  const palette = ['#4f46e5', '#dc2626', '#16a34a', '#ea580c', '#7c3aed', '#0891b2', '#ca8a04', '#be185d', '#4338ca', '#15803d', '#9333ea', '#0d9488'];
  return { _palette: palette };
});
const [teamTraceCache, setTeamTraceCache] = useState({});
const [teamDisplayMode, setTeamDisplayMode] = useState('reflectivity');
const [teamSelectedIlluminant, setTeamSelectedIlluminant] = useState('D65');
const [teamActiveLayerView, setTeamActiveLayerView] = useState('original');
const [showTeamColorCompare, setShowTeamColorCompare] = useState(false);
const [teamColorCompareSelected, setTeamColorCompareSelected] = useState([]);
const [teamAdmittanceWavelengths, setTeamAdmittanceWavelengths] = useState([450, 550, 650]);
const [teamEfieldWavelengths, setTeamEfieldWavelengths] = useState([450, 550, 650]);
```

- [ ] **Step 2: Add helper to get trace color**

```javascript
const getTeamTraceColor = useCallback((traceId, submissions = []) => {
  const palette = ['#4f46e5', '#dc2626', '#16a34a', '#ea580c', '#7c3aed', '#0891b2', '#ca8a04', '#be185d', '#4338ca', '#15803d', '#9333ea', '#0d9488'];
  if (traceId === 'original') return palette[0];
  const sortedSubs = [...submissions].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  const idx = sortedSubs.findIndex(s => `sub_${s.id}` === traceId);
  return palette[(idx + 1) % palette.length];
}, []);
```

- [ ] **Step 3: Add helper to compute/cache trace data**

```javascript
const getTeamTraceData = useCallback((traceId, designData, submissions = []) => {
  if (teamTraceCache[traceId]) return teamTraceCache[traceId];
  let data;
  if (traceId === 'original') {
    data = designData;
  } else {
    const sub = submissions.find(s => `sub_${s.id}` === traceId);
    data = sub?.data;
  }
  if (!data) return null;
  const customMats = data.customMaterials || {};
  const spectrum = computeFullSpectrumFromData(data, customMats);
  const colorInfo = computeColorInfoFromSpectrum(spectrum, teamSelectedIlluminant);
  const stress = computeStressFromData(data, customMats);
  const result = { spectrum, colorInfo, stress, data };
  setTeamTraceCache(prev => ({ ...prev, [traceId]: result }));
  return result;
}, [teamTraceCache, teamSelectedIlluminant]);
```

- [ ] **Step 4: Reset team state when changing designs**

In the existing `loadSharedDesignDetail` function (~line 689), add resets:

```javascript
// Add after the existing loadSharedDesignDetail logic:
setTeamVisibleTraces({ original: true });
setTeamTraceCache({});
setTeamDisplayMode('reflectivity');
setTeamActiveLayerView('original');
```

- [ ] **Step 5: Build and verify**
- [ ] **Step 6: Commit**

```bash
git add src/opticoat-designer.js
git commit -m "feat: add team workspace state variables and trace helpers"
```

---

### Task 7: Replace Shared Design Detail View — Left Panel (Chart)

**Files:**
- Modify: `src/opticoat-designer.js` — replace the existing shared design detail view (~lines 11705-11856)

This is the largest task. Replace the entire `{/* ---- SHARED DESIGN DETAIL VIEW ---- */}` section with the new workspace layout.

- [ ] **Step 1: Replace the design detail view opening and left panel**

Replace from `{/* ---- SHARED DESIGN DETAIL VIEW ---- */}` through the end of the Design Overview IIFE (`})()}`) with the new workspace. The workspace is a flex container: left panel (~70%) has the chart and color sidebar, right panel (~30%) has team context.

The chart renders all visible traces as Recharts Line components. Display mode switcher controls what data key is used (R, T, A, phase). For admittance/e-field, only the focused trace is rendered using the specialized chart types.

**NOTE:** This JSX is large (~400 lines). The implementer should:
1. Read the existing designer tab chart rendering (lines ~6200-7715) for patterns
2. Use inline styles for any Tailwind classes that may not exist in the standalone CSS
3. Follow the existing pattern of `ResponsiveContainer > LineChart > Line` for traces
4. Use `computeFullSpectrumFromData` output keyed by trace ID for data
5. Color sidebar should use `computeColorInfoFromSpectrum` output for each visible trace

Key structure:
```jsx
{/* SHARED DESIGN DETAIL VIEW — Full Workspace */}
{!teamLoading && teamView === 'design' && selectedSharedDesign && (() => {
  const myRole = selectedTeamDetail?.myRole;
  const submissions = selectedSharedDesign.submissions || [];
  const data = selectedSharedDesign.data || {};

  // Compute data for all visible traces
  const visibleTraceIds = Object.entries(teamVisibleTraces).filter(([,v]) => v).map(([k]) => k);
  const traceData = {};
  visibleTraceIds.forEach(id => {
    traceData[id] = getTeamTraceData(id, data, submissions);
  });

  // Build chart data — merge all visible spectra into single array keyed by trace ID
  // For R/T/A/phase modes
  let chartData = [];
  if (['reflectivity','transmission','absorption','phaseShift'].includes(teamDisplayMode)) {
    const wlRange = data.wavelengthRange || { min: 380, max: 780, step: 5 };
    const step = Math.max(wlRange.step || 5, 2);
    for (let wl = wlRange.min; wl <= wlRange.max; wl += step) {
      const point = { wavelength: wl };
      visibleTraceIds.forEach(id => {
        const spectrum = traceData[id]?.spectrum || [];
        const match = spectrum.find(s => Math.abs(s.wavelength - wl) < step / 2);
        if (match) {
          const key = teamDisplayMode === 'reflectivity' ? 'R' : teamDisplayMode === 'transmission' ? 'T' : teamDisplayMode === 'absorption' ? 'A' : 'phase';
          point[id] = match[key];
        }
      });
      chartData.push(point);
    }
  }

  return (
    <div style={{ display: 'flex', gap: '12px', height: '100%' }}>
      {/* LEFT PANEL — Chart & Color Analysis */}
      <div style={{ flex: '1 1 70%', minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        {/* Display mode switcher + back button */}
        {/* Chart area */}
        {/* Color analysis sidebar */}
      </div>

      {/* RIGHT PANEL — Team Context */}
      <div style={{ flex: '0 0 30%', minWidth: '280px', overflowY: 'auto' }}>
        {/* Design header, submission traces, timeline, metrics table, layer details, actions, discussion */}
      </div>
    </div>
  );
})()}
```

- [ ] **Step 2: Build and verify**
- [ ] **Step 3: Commit**

```bash
git add src/opticoat-designer.js
git commit -m "feat: replace shared design detail with full workspace — left panel chart"
```

---

### Task 8: Right Panel — Submission Traces, Timeline, Metrics Table

**Files:**
- Modify: `src/opticoat-designer.js` — fill in the right panel from Task 7

- [ ] **Step 1: Add design header with status controls**

Admin gets status dropdown, members get read-only badge. Clone and Submit Changes buttons.

- [ ] **Step 2: Add Submission Traces section**

List all submissions with eye icon toggles (visibility) and click-to-focus (layer detail). Original design always first.

```jsx
{/* Submission Traces */}
<div className="mb-3">
  <div style={{ fontSize: '11px' }} className="text-gray-500 font-semibold mb-1.5">Traces</div>
  {/* Original design */}
  <div className="flex items-center gap-2 p-1.5 rounded border mb-1" style={{ borderColor: teamActiveLayerView === 'original' ? '#6366f1' : '#e5e7eb', cursor: 'pointer' }}>
    <button onClick={() => setTeamVisibleTraces(prev => ({ ...prev, original: !prev.original }))} style={{ cursor: 'pointer' }}>
      {teamVisibleTraces.original ? <Eye size={14} /> : <EyeOff size={14} />}
    </button>
    <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: getTeamTraceColor('original', submissions), flexShrink: 0 }} />
    <span onClick={() => setTeamActiveLayerView('original')} style={{ fontSize: '11px', cursor: 'pointer' }} className="text-gray-700 font-medium flex-1">Original Design</span>
  </div>
  {/* Submissions */}
  {submissions.map(sub => {
    const traceId = `sub_${sub.id}`;
    const ssc = { pending: '#92400e', approved: '#065f46', denied: '#991b1b' };
    return (
      <div key={sub.id} className="flex items-center gap-2 p-1.5 rounded border mb-1" style={{ borderColor: teamActiveLayerView === traceId ? '#6366f1' : '#e5e7eb', cursor: 'pointer' }}>
        <button onClick={() => setTeamVisibleTraces(prev => ({ ...prev, [traceId]: !prev[traceId] }))} style={{ cursor: 'pointer' }}>
          {teamVisibleTraces[traceId] ? <Eye size={14} /> : <EyeOff size={14} />}
        </button>
        <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: getTeamTraceColor(traceId, submissions), flexShrink: 0 }} />
        <span onClick={() => setTeamActiveLayerView(traceId)} style={{ fontSize: '11px', cursor: 'pointer' }} className="text-gray-600 flex-1 truncate">{sub.submitter?.email || 'Unknown'}</span>
        <span style={{ fontSize: '9px', color: ssc[sub.status] || '#6b7280' }}>{sub.status}</span>
      </div>
    );
  })}
</div>
```

- [ ] **Step 3: Add Approval Timeline section**

Reverse-chronological list showing status, submitter, date, reviewer note, metrics snapshot.

- [ ] **Step 4: Add Metrics Comparison Table**

Table rows = original + each submission. Columns: avg R%, avg T%, thickness, layers, color swatch, delta E vs original, stress, risk, status.

- [ ] **Step 5: Add Layer Details section**

Expandable section showing layers for the focused trace (`teamActiveLayerView`). Includes per-layer stress, cumulative stress, risk assessment.

- [ ] **Step 6: Add Actions section**

Clone, Submit Changes, Compare Colors, admin Approve/Deny.

- [ ] **Step 7: Add Discussion section**

Reuse existing comment thread code.

- [ ] **Step 8: Build and verify**
- [ ] **Step 9: Commit**

```bash
git add src/opticoat-designer.js
git commit -m "feat: add right panel — traces, timeline, metrics, layers, actions"
```

---

## Chunk 3: Color Comparison Modal & Pre-Submission Preview

### Task 9: Team Color Comparison Modal

**Files:**
- Modify: `src/opticoat-designer.js` — add near the existing color comparison modal

Identical UX to the designer tab's Color Comparison modal but populated with team traces.

- [ ] **Step 1: Add modal JSX**

Uses `showTeamColorCompare` state. Lists original + all submissions as selectable. Computes pairwise delta E using L*a*b* values from `computeColorInfoFromSpectrum`.

Delta E (CIE76) = sqrt((L1-L2)^2 + (a1-a2)^2 + (b1-b2)^2)

- [ ] **Step 2: Build and verify**
- [ ] **Step 3: Commit**

```bash
git add src/opticoat-designer.js
git commit -m "feat: add team color comparison modal with pairwise delta E"
```

---

### Task 10: Pre-Submission Comparison Preview

**Files:**
- Modify: `src/opticoat-designer.js` — enhance the existing Submit Changes modal

- [ ] **Step 1: Add preview computation**

When user selects a saved design in the submit modal, run `computeFullSpectrumFromData`, `computeColorInfoFromSpectrum`, and `computeStressFromData` on both the selected design and the original shared design.

- [ ] **Step 2: Add comparison panel UI**

Show side-by-side: avg R%, avg T%, total thickness, layer count, color swatches, delta E, stress, risk level. User reviews before confirming submission.

- [ ] **Step 3: Build and verify**
- [ ] **Step 4: Commit**

```bash
git add src/opticoat-designer.js
git commit -m "feat: add pre-submission comparison preview"
```

---

## Chunk 4: Remove Old Views & Final Polish

### Task 11: Remove Old Submission Detail View

**Files:**
- Modify: `src/opticoat-designer.js` — remove the old submission detail view (~lines 12125-12228)

- [ ] **Step 1: Remove old view**

The old `teamView === 'submission'` block is no longer needed — submissions are now overlay traces in the workspace. Remove the entire block and the `setTeamView('submission')` calls. Keep the `loadSubmissionDetail` function for now (can be removed later if truly unused).

- [ ] **Step 2: Build and verify**
- [ ] **Step 3: Commit**

```bash
git add src/opticoat-designer.js
git commit -m "refactor: remove old submission detail view, replaced by workspace traces"
```

---

### Task 12: Import Missing Icons & Final Build

**Files:**
- Modify: `src/opticoat-designer.js` — check imports

- [ ] **Step 1: Verify icon imports**

Ensure `Eye`, `EyeOff` (or equivalent from lucide-react) are imported. Check for any other missing imports.

- [ ] **Step 2: Full build and manual test**

Run: `npx craco build 2>&1 | tail -10`
Expected: Build succeeds with no new errors (existing warnings are OK per CLAUDE.md)

- [ ] **Step 3: Final commit**

```bash
git add src/opticoat-designer.js
git commit -m "feat: complete team workspace — full optical analysis for shared designs"
```
