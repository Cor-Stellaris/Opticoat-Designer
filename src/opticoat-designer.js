import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceArea,
  ReferenceLine,
  BarChart,
  Bar,
  Cell,
  ScatterChart,
  Scatter,
} from "recharts";
import {
  Plus,
  Trash2,
  Upload,
  X,
  Settings,
  Zap,
  TrendingUp,
  Lock,
  Info,
  Library,
  GripVertical,
  Wifi,
  WifiOff,
  Save,
  FolderOpen,
  Crown,
  LogIn,
  User,
  Pencil,
  Download,
  Check,
  MessageCircle,
  Send,
  Copy,
  Moon,
  Sun,
  Users,
  UserPlus,
  UserMinus,
  Mail,
} from "lucide-react";
import { saveSession, loadSession, migrateFromLocalStorage, saveDesignLocally, getLocalDesigns, deleteLocalDesign } from './services/offlineStore';
import syncManager from './services/syncManager';
import { apiGet, apiPost, apiPut, apiDelete, apiStream, setTokenProvider } from './services/apiClient';
import html2canvas from 'html2canvas';

// Clerk — import hooks and components. They only work when wrapped in ClerkProvider (index.js).
import { useUser as useClerkUserHook, useAuth as useClerkAuthHook, useOrganization as useClerkOrgHook, useOrganizationList as useClerkOrgListHook, SignInButton, UserButton } from '@clerk/clerk-react';

const CLERK_ENABLED = !!process.env.REACT_APP_CLERK_PUBLISHABLE_KEY;

// Wrappers that return safe defaults when Clerk is not enabled
function useClerkUser() {
  if (CLERK_ENABLED) {
    return useClerkUserHook(); // eslint-disable-line react-hooks/rules-of-hooks
  }
  return { isSignedIn: false, user: null, isLoaded: true };
}
function useClerkAuth() {
  if (CLERK_ENABLED) {
    return useClerkAuthHook(); // eslint-disable-line react-hooks/rules-of-hooks
  }
  return { getToken: null };
}
// Organization hooks — these require Organizations to be enabled in Clerk Dashboard.
// We always call the hooks (React rules) but catch errors if the feature isn't enabled yet.
const ORG_DEFAULTS = { organization: null, membership: null, memberships: null, invitations: null };
const ORG_LIST_DEFAULTS = { createOrganization: null, setActive: null, userInvitations: null };
function useClerkOrg() {
  // Always call hook to satisfy React rules-of-hooks, but guard with try/catch
  let result = ORG_DEFAULTS;
  try {
    if (CLERK_ENABLED) {
      result = useClerkOrgHook(); // eslint-disable-line react-hooks/rules-of-hooks
    }
  } catch (e) {
    // Organizations not enabled in Clerk — return safe defaults
  }
  return result;
}
function useClerkOrgList() {
  let result = ORG_LIST_DEFAULTS;
  try {
    if (CLERK_ENABLED) {
      result = useClerkOrgListHook({ userInvitations: { infinite: true } }); // eslint-disable-line react-hooks/rules-of-hooks
    }
  } catch (e) {
    // Organizations not enabled in Clerk — return safe defaults
  }
  return result;
}

// Tier hierarchy for comparison
const TIER_ORDER = { free: 0, starter: 1, professional: 2, enterprise: 3 };

// DEV MODE: All features unlocked for testing. Restore original limits before production.
// Must match server/src/services/tierLimits.js free tier exactly
const FREE_TIER_LIMITS = {
  maxStacks: 1, maxLayersPerStack: 5, maxSavedDesigns: 1, maxCustomMaterials: 0,
  allowedAngles: [0],
  allowedDisplayModes: ['reflectivity', 'transmission'],
  allowedIlluminants: ['D65'],
  designAssistant: false, designAssistantMaxLayers: 0,
  reverseEngineer: false, colorTargetMode: false, csvUpload: false,
  recipeTracking: false, maxTrackingRuns: 0, yieldCalculator: false,
  maxMonteCarloIterations: 0, yieldColorSimulation: false, layerSensitivity: false,
  iad: false, maxMachines: 0,
  trackingDesignOverlay: false, trackingToleranceBands: false, trackingColorDrift: false,
  trackingTrendView: false, trackingExportPng: false, trackingExportCsv: true,
  trackingRunComparison: false,
  aiChat: false,
  teamCollaboration: false,
  maxTeams: 0,
  maxTeamSeats: 0,
  coatingTemplates: false,
};

const admittanceColors = ["#2563eb", "#dc2626", "#16a34a", "#9333ea", "#ea580c", "#0891b2", "#be185d", "#65a30d", "#7c3aed", "#d97706"];

// Parse tabular n,k text (CSV/TSV/whitespace). Format per line: wavelength n [k]
// Lines starting with # or // are ignored. Auto-detects μm vs nm (max wavelength < 20 → μm).
function parseNkTable(text) {
  const lines = String(text || '').split(/\r?\n/);
  const rows = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith('//')) continue;
    const parts = line.split(/[\s,;\t]+/).filter(Boolean).map(Number);
    if (parts.length < 2 || parts.some(v => !Number.isFinite(v))) continue;
    rows.push([parts[0], parts[1], parts[2] || 0]);
  }
  if (rows.length === 0) return [];
  const maxWl = Math.max(...rows.map(r => r[0]));
  if (maxWl < 20) { for (const r of rows) r[0] *= 1000; }
  rows.sort((a, b) => a[0] - b[0]);
  return rows;
}

// Linear interpolation of {n, k} at given wavelength (nm). Clamps at boundaries.
function interpolateNk(data, wavelength) {
  if (!data || data.length === 0) return { n: 1.5, k: 0 };
  if (data.length === 1) return { n: data[0][1], k: data[0][2] };
  if (wavelength <= data[0][0]) return { n: data[0][1], k: data[0][2] };
  const last = data[data.length - 1];
  if (wavelength >= last[0]) return { n: last[1], k: last[2] };
  let lo = 0, hi = data.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (data[mid][0] <= wavelength) lo = mid; else hi = mid;
  }
  const a = data[lo], b = data[hi];
  const t = (wavelength - a[0]) / (b[0] - a[0]);
  return { n: a[1] + t * (b[1] - a[1]), k: a[2] + t * (b[2] - a[2]) };
}

// Kramers-Kronig validation for tabular n,k data.
// Computes the KK-predicted n(E) from k(E) via the causal integral and compares
// against the user-supplied n. Uses trapezoidal rule with singularity skip.
// Note: finite integration range truncates the true KK integral, so expect some
// absolute offset even for perfectly consistent data. The *shape* is what matters —
// we compare via Pearson correlation and relative RMS deviation.
function validateKK(data) {
  if (!data || data.length < 5) {
    return { valid: false, message: 'Need ≥5 data points for KK validation', correlation: 0 };
  }
  // Use energy E (eV) — KK integrand is ω·k/(ω'²-ω²) (ω proportional to E)
  const E = data.map(r => 1239.84 / r[0]);
  const n = data.map(r => r[1]);
  const k = data.map(r => r[2]);
  // Compute KK-predicted n - 1 at each point
  const predicted = new Array(data.length);
  for (let i = 0; i < data.length; i++) {
    const Ei = E[i];
    let integral = 0;
    for (let j = 0; j < data.length - 1; j++) {
      if (j === i || j + 1 === i) continue;
      const Ej = E[j], Ejp = E[j + 1];
      const dE = Math.abs(Ejp - Ej);
      if (dE === 0) continue;
      const fj = (Ej * k[j]) / (Ej * Ej - Ei * Ei);
      const fjp = (Ejp * k[j + 1]) / (Ejp * Ejp - Ei * Ei);
      integral += 0.5 * (fj + fjp) * dE;
    }
    predicted[i] = 1 + (2 / Math.PI) * integral;
  }
  // Compare shapes: Pearson correlation between predicted and actual
  const mean = arr => arr.reduce((a, b) => a + b, 0) / arr.length;
  const nMean = mean(n), pMean = mean(predicted);
  let cov = 0, nVar = 0, pVar = 0;
  for (let i = 0; i < n.length; i++) {
    const dn = n[i] - nMean, dp = predicted[i] - pMean;
    cov += dn * dp;
    nVar += dn * dn;
    pVar += dp * dp;
  }
  const corr = (nVar > 0 && pVar > 0) ? cov / Math.sqrt(nVar * pVar) : 0;
  // Relative RMS: shape-match quality
  const diffs = predicted.map((p, i) => (p - pMean) - (n[i] - nMean));
  const rmsDiff = Math.sqrt(diffs.reduce((a, b) => a + b * b, 0) / diffs.length);
  const nRMS = Math.sqrt(nVar / n.length);
  const relErr = nRMS > 0 ? rmsDiff / nRMS : 0;
  return { valid: true, correlation: corr, relativeError: relErr, predicted, meanActual: nMean, meanPredicted: pMean };
}

// Brendel-Bormann (1992) — Lorentz oscillators with Gaussian-broadened lineshapes.
// Better than Lorentz-Drude for noble metals in the visible (smoother peaks).
// Each oscillator: {A, E0, gamma, sigma}. sigma = 0 → pure Lorentz (back-compat).
// E0 = 0 → Drude (no Gaussian broadening applied — Drude is already monotonic).
// Approximated via 5-point Gauss-Hermite quadrature of the Gaussian convolution
// (exact for polynomials up to degree 9; ~10⁻⁴ accuracy for smooth Lorentzians).
function brendelBormannNK(wavelength, params) {
  const E = 1239.84 / wavelength;
  const epsInf = params.epsInf != null ? params.epsInf : 1;
  const oscillators = params.oscillators || [];
  // Gauss-Hermite 5-point nodes and weights (for ∫ exp(-t²)·f(t) dt ≈ Σ wᵢ f(xᵢ))
  const ghX = [-2.020183, -0.958572, 0, 0.958572, 2.020183];
  const ghW = [0.019953, 0.393619, 0.945309, 0.393619, 0.019953];
  const invSqrtPi = 0.5641895835477563;
  let epsRe = epsInf;
  let epsIm = 0;
  for (let j = 0; j < oscillators.length; j++) {
    const osc = oscillators[j];
    const A = osc.A || 0, E0 = osc.E0 || 0, g = osc.gamma || 0, sigma = osc.sigma || 0;
    if (A === 0) continue;
    if (E0 === 0) {
      // Drude term
      const dn = E * E + g * g;
      if (dn === 0) continue;
      epsRe -= A / dn;
      epsIm += (A * g) / (E * dn);
    } else if (sigma === 0) {
      // Pure Lorentz (fast path — no quadrature needed)
      const delta = E0 * E0 - E * E;
      const dn = delta * delta + g * g * E * E;
      if (dn === 0) continue;
      epsRe += (A * delta) / dn;
      epsIm += (A * g * E) / dn;
    } else {
      // Gaussian-convolved Lorentz: sample over Ê = E0 + σ√2·xᵢ
      for (let i = 0; i < 5; i++) {
        const Ehat = E0 + sigma * Math.SQRT2 * ghX[i];
        if (Ehat <= 0) continue;
        const delta = Ehat * Ehat - E * E;
        const dn = delta * delta + g * g * E * E;
        if (dn === 0) continue;
        const w = ghW[i] * invSqrtPi;
        epsRe += w * (A * delta) / dn;
        epsIm += w * (A * g * E) / dn;
      }
    }
  }
  const mag = Math.sqrt(epsRe * epsRe + epsIm * epsIm);
  const n = Math.sqrt(Math.max(0, (mag + epsRe) / 2));
  const k = Math.sqrt(Math.max(0, (mag - epsRe) / 2));
  return { n, k };
}

// Cody-Lorentz dispersion — Tauc-Lorentz with an explicit Urbach tail below Eg.
// Adds sub-bandgap absorption (defect/disorder states) that TL misses.
// Best-in-class for HfO2, Ta2O5, Nb2O5, complex amorphous oxides.
// Extra param: Eu (Urbach width, eV). When Eu → 0, reduces to Tauc-Lorentz.
function codyLorentzNK(wavelength, params) {
  const E = 1239.84 / wavelength;
  const Eg = params.Eg;
  const Eu = params.Eu || 0;
  // TL base result (n and above-Eg k)
  const tl = taucLorentzNK(wavelength, params);
  if (E >= Eg || Eu <= 0) return tl;
  // Urbach tail below Eg: k(E) = k_edge · exp((E - Eg)/Eu)
  // Self-consistent edge value: evaluate TL k at Eg + Eu (one Urbach width above)
  const edgeWl = 1239.84 / (Eg + Eu);
  const tlEdge = taucLorentzNK(edgeWl, params);
  const k = tlEdge.k * Math.exp((E - Eg) / Eu);
  return { n: tl.n, k };
}

// Lorentz oscillator model (with optional Drude term for metals).
// Returns {n, k} at given wavelength (nm) from:
//   ε(E) = εInf + Σⱼ Aⱼ / (E₀ⱼ² - E² - i·γⱼ·E)
// Set E₀ = 0 to make that oscillator a Drude (free-electron) term.
// Params: { epsInf, oscillators: [{A, E0, gamma}, ...] } with A, E0, gamma in eV.
function drudeLorentzNK(wavelength, params) {
  const E = 1239.84 / wavelength;
  const epsInf = params.epsInf != null ? params.epsInf : 1;
  const oscillators = params.oscillators || [];
  let epsRe = epsInf;
  let epsIm = 0;
  for (let i = 0; i < oscillators.length; i++) {
    const osc = oscillators[i];
    const A = osc.A || 0, E0 = osc.E0 || 0, g = osc.gamma || 0;
    if (A === 0) continue;
    if (E0 === 0) {
      // Drude term: ε = -A / (E² + i·γ·E)
      const dn = E * E + g * g;
      if (dn === 0) continue;
      epsRe -= A / dn;
      epsIm += (A * g) / (E * dn);
    } else {
      // Lorentz oscillator: ε = A / (E₀² - E² - i·γ·E)
      const delta = E0 * E0 - E * E;
      const dn = delta * delta + g * g * E * E;
      if (dn === 0) continue;
      epsRe += (A * delta) / dn;
      epsIm += (A * g * E) / dn;
    }
  }
  const mag = Math.sqrt(epsRe * epsRe + epsIm * epsIm);
  const n = Math.sqrt(Math.max(0, (mag + epsRe) / 2));
  const k = Math.sqrt(Math.max(0, (mag - epsRe) / 2));
  return { n, k };
}

// Incoherent back-surface reflectance correction.
// Models a substrate with the coating on front and bare back-surface (default air).
// R_back = Fresnel reflectance at substrate/back-medium interface.
// R_total = R_front + (1-R_front)²·R_back / (1 - R_front·R_back)  (infinite-series incoherent sum)
// Previous code used R_front + (1-R_front)²·R_front — physically wrong (assumes back = front coating).
function applyBackSurfaceCorrection(R_front, nSubstrate, nBackMedium = 1.0) {
  if (!(R_front > 0)) return R_front;
  const dn = nSubstrate - nBackMedium;
  const sn = nSubstrate + nBackMedium;
  const R_back = (dn * dn) / (sn * sn);
  const denom = 1 - R_front * R_back;
  if (denom <= 0) return R_front;
  return R_front + Math.pow(1 - R_front, 2) * R_back / denom;
}

// Tauc-Lorentz dispersion (Jellison-Modine 1996, Appl. Phys. Lett. 69, 371).
// Standard for amorphous oxides (TiO2, HfO2, Ta2O5, Nb2O5). Returns {n, k} at wavelength (nm).
// Params: A (eV amplitude), E0 (eV peak), C (eV broadening), Eg (eV bandgap), epsInf (high-freq ε).
function taucLorentzNK(wavelength, params) {
  const A = params.A, E0 = params.E0, C = params.C, Eg = params.Eg;
  const epsInf = params.epsInf != null ? params.epsInf : 1;
  const E = 1239.84 / wavelength;

  // ε₂ (imaginary part) — zero below bandgap
  let eps2 = 0;
  if (E > Eg) {
    const num = A * E0 * C * (E - Eg) * (E - Eg);
    const den = (Math.pow(E * E - E0 * E0, 2) + C * C * E * E) * E;
    eps2 = num / den;
  }

  // ε₁ (real part) — Jellison-Modine closed-form Kramers-Kronig integral
  const alpha2 = 4 * E0 * E0 - C * C;
  const alpha = Math.sqrt(Math.max(1e-20, alpha2));
  const gamma2 = E0 * E0 - C * C / 2;
  const zeta4 = Math.pow(E * E - gamma2, 2) + alpha2 * C * C / 4;
  const a_ln = (Eg * Eg - E0 * E0) * E * E + Eg * Eg * C * C - E0 * E0 * (E0 * E0 + 3 * Eg * Eg);
  const a_atan = (E * E - E0 * E0) * (E0 * E0 + Eg * Eg) + Eg * Eg * C * C;
  const EminusEg = Math.abs(E - Eg) + 1e-12;
  const EplusEg = E + Eg;

  const t1 = (A * C * a_ln) / (2 * Math.PI * zeta4 * alpha * E0)
    * Math.log((E0 * E0 + Eg * Eg + alpha * Eg) / Math.max(1e-20, E0 * E0 + Eg * Eg - alpha * Eg));
  const t2 = -(A * a_atan) / (Math.PI * zeta4 * E0)
    * (Math.PI - Math.atan((2 * Eg + alpha) / C) + Math.atan((alpha - 2 * Eg) / C));
  const t3 = (4 * A * E0 * Eg * (E * E - gamma2)) / (Math.PI * zeta4 * alpha)
    * (Math.PI / 2 + Math.atan((2 * (gamma2 - Eg * Eg)) / (alpha * C)));
  const t4 = -(A * E0 * C * (E * E + Eg * Eg)) / (Math.PI * zeta4 * E)
    * Math.log(EminusEg / EplusEg);
  const t5 = (2 * A * E0 * C * Eg) / (Math.PI * zeta4)
    * Math.log((EminusEg * EplusEg) / Math.sqrt(Math.pow(E0 * E0 - Eg * Eg, 2) + Eg * Eg * C * C));

  const eps1 = epsInf + t1 + t2 + t3 + t4 + t5;
  const mag = Math.sqrt(eps1 * eps1 + eps2 * eps2);
  const n = Math.sqrt(Math.max(0, (mag + eps1) / 2));
  const k = Math.sqrt(Math.max(0, (mag - eps1) / 2));
  return { n, k };
}

const materialDispersion = {
  SiO2: {
    type: "sellmeier",
    B1: 0.6961663,
    B2: 0.4079426,
    B3: 0.8974794,
    C1: 0.0684043,
    C2: 0.1162414,
    C3: 9.896161,
    color: "#E8F4F8",
    iadIncrease: 3.0,
    stress: -50,
    kType: "none",
  },
  // Thin-film SiO2, e-beam deposition (no ion assist) — n≈1.45 @ 550nm
  SiO2_ebeam: {
    type: "cauchy",
    A: 1.438, B: 0.00420, C: 0,
    color: "#E8F4F8",
    iadIncrease: 1.5,
    stress: -80,
    kType: "none",
  },
  // Thin-film SiO2, ion-assisted deposition — n≈1.465 @ 550nm (close to bulk)
  SiO2_IAD: {
    type: "cauchy",
    A: 1.453, B: 0.00375, C: 0,
    color: "#D5EBF2",
    iadIncrease: 0.5,
    stress: -40,
    kType: "none",
  },
  SiO: {
    type: "cauchy",
    A: 1.85,
    B: 0.015,
    C: 0.0001,
    color: "#E5E5E5",
    iadIncrease: 2.5,
    stress: -80,
    kType: "urbach",
    k0: 0.02,
    kEdge: 400,
    kDecay: 0.015,
  },
  TiO2: {
    type: "cauchy",
    A: 2.35,
    B: 0.02,
    C: 0.0001,
    color: "#FFF4E6",
    iadIncrease: 4.0,
    stress: 150,
    kType: "urbach",
    k0: 0.15,
    kEdge: 380,
    kDecay: 0.025,
  },
  // Thin-film TiO2, e-beam (no ion assist) — n≈2.42 @ 550nm, Tauc-Lorentz
  TiO2_ebeam: {
    type: "tauc-lorentz",
    A: 95, E0: 4.3, C: 2.3, Eg: 3.3, epsInf: 2.10,
    color: "#FFE8CC",
    iadIncrease: 3.0,
    stress: 100,
    kType: "tauc-lorentz",
  },
  // Thin-film TiO2, ion-assisted — n≈2.52 @ 550nm, Tauc-Lorentz (denser, amorphous)
  TiO2_IAD: {
    type: "tauc-lorentz",
    A: 115, E0: 4.1, C: 2.0, Eg: 3.3, epsInf: 2.30,
    color: "#FFD9B3",
    iadIncrease: 1.0,
    stress: 200,
    kType: "tauc-lorentz",
  },
  // Thin-film TiO2, magnetron sputter — n≈2.48 @ 550nm, Tauc-Lorentz
  TiO2_sputter: {
    type: "tauc-lorentz",
    A: 108, E0: 4.2, C: 2.1, Eg: 3.3, epsInf: 2.25,
    color: "#FFDCC2",
    iadIncrease: 1.5,
    stress: 170,
    kType: "tauc-lorentz",
  },
  // Thin-film TiO2, atomic layer deposition — n≈2.40 @ 550nm, lowest loss
  TiO2_ALD: {
    type: "tauc-lorentz",
    A: 90, E0: 4.4, C: 2.4, Eg: 3.35, epsInf: 2.05,
    color: "#FFF0DD",
    iadIncrease: 0.5,
    stress: 80,
    kType: "tauc-lorentz",
  },
  Al2O3: {
    type: "sellmeier",
    B1: 1.4313493,
    B2: 0.65054713,
    B3: 5.3414021,
    C1: 0.0726631,
    C2: 0.1193242,
    C3: 18.028251,
    color: "#F0F8FF",
    iadIncrease: 2.0,
    stress: -100,
    kType: "none",
  },
  ZrO2: {
    type: "cauchy",
    A: 2.13,
    B: 0.03,
    C: 0.0002,
    color: "#FFF0F5",
    iadIncrease: 3.5,
    stress: 200,
    kType: "urbach",
    k0: 0.05,
    kEdge: 350,
    kDecay: 0.02,
  },
  Ta2O5: {
    type: "cauchy",
    A: 2.1,
    B: 0.025,
    C: 0.00015,
    color: "#F5F5DC",
    iadIncrease: 3.0,
    stress: 180,
    kType: "urbach",
    k0: 0.08,
    kEdge: 320,
    kDecay: 0.02,
  },
  Nb2O5: {
    type: "cauchy",
    A: 2.28,
    B: 0.028,
    C: 0.00018,
    color: "#FFF8DC",
    iadIncrease: 3.5,
    stress: 170,
    kType: "urbach",
    k0: 0.12,
    kEdge: 350,
    kDecay: 0.022,
  },
  HfO2: {
    type: "cauchy",
    A: 1.95,
    B: 0.022,
    C: 0.00012,
    color: "#F0FFF0",
    iadIncrease: 2.5,
    stress: 190,
    kType: "urbach",
    k0: 0.02,
    kEdge: 300,
    kDecay: 0.025,
  },
  MgF2: {
    type: "sellmeier",
    B1: 0.48755108,
    B2: 0.39875031,
    B3: 2.3120353,
    C1: 0.04338408,
    C2: 0.09461442,
    C3: 23.793604,
    color: "#F5FFFA",
    iadIncrease: 1.5,
    stress: -30,
    kType: "none",
  },
  Y2O3: {
    type: "cauchy",
    A: 1.87,
    B: 0.018,
    C: 0.0001,
    color: "#FFFACD",
    iadIncrease: 2.0,
    stress: 120,
    kType: "urbach",
    k0: 0.03,
    kEdge: 320,
    kDecay: 0.02,
  },
  // Metals — Rakic 1998 Lorentz-Drude fits (ε∞=1, A = f·ωₚ² with ωₚ from fit)
  // Silver — ωₚ = 9.01 eV
  Ag: {
    type: "lorentz",
    epsInf: 1.0,
    oscillators: [
      { A: 68.61, E0: 0,      gamma: 0.048 },  // Drude
      { A: 5.28,  E0: 0.816,  gamma: 3.886 },
      { A: 10.07, E0: 4.481,  gamma: 0.452 },
      { A: 0.893, E0: 8.185,  gamma: 0.065 },
      { A: 68.21, E0: 9.083,  gamma: 0.916 },
      { A: 458.5, E0: 20.29,  gamma: 2.419 },
    ],
    color: "#C0C0C0",
    iadIncrease: 0,
    stress: 0,
    kType: "lorentz",
  },
  // Gold — ωₚ = 9.03 eV
  Au: {
    type: "lorentz",
    epsInf: 1.0,
    oscillators: [
      { A: 61.98,  E0: 0,      gamma: 0.053 },  // Drude
      { A: 1.958,  E0: 0.415,  gamma: 0.241 },
      { A: 0.816,  E0: 0.830,  gamma: 0.345 },
      { A: 5.789,  E0: 2.969,  gamma: 0.870 },
      { A: 49.00,  E0: 4.304,  gamma: 2.494 },
      { A: 357.51, E0: 13.32,  gamma: 2.214 },
    ],
    color: "#D4AF37",
    iadIncrease: 0,
    stress: 0,
    kType: "lorentz",
  },
  // Aluminum — ωₚ = 14.98 eV
  Al: {
    type: "lorentz",
    epsInf: 1.0,
    oscillators: [
      { A: 117.35, E0: 0,      gamma: 0.047 },  // Drude
      { A: 50.93,  E0: 0.162,  gamma: 0.333 },
      { A: 11.22,  E0: 1.544,  gamma: 0.312 },
      { A: 37.25,  E0: 1.808,  gamma: 1.351 },
      { A: 6.73,   E0: 3.473,  gamma: 3.382 },
    ],
    color: "#A8A9AD",
    iadIncrease: 0,
    stress: 0,
    kType: "lorentz",
  },
  // Copper — ωₚ = 10.83 eV
  Cu: {
    type: "lorentz",
    epsInf: 1.0,
    oscillators: [
      { A: 69.72,  E0: 0,      gamma: 0.030 },  // Drude
      { A: 7.12,   E0: 0.291,  gamma: 0.378 },
      { A: 4.92,   E0: 2.957,  gamma: 1.056 },
      { A: 122.67, E0: 5.300,  gamma: 3.213 },
      { A: 133.86, E0: 11.18,  gamma: 4.305 },
    ],
    color: "#B87333",
    iadIncrease: 0,
    stress: 0,
    kType: "lorentz",
  },
  // Silver — Brendel-Bormann fit (Rakic 1998) — smoother visible-range peaks
  Ag_BB: {
    type: "brendel-bormann",
    epsInf: 1.0,
    oscillators: [
      { A: 66.65,  E0: 0,      gamma: 0.049, sigma: 0     },  // Drude
      { A: 4.059,  E0: 2.025,  gamma: 0.189, sigma: 1.894 },
      { A: 10.80,  E0: 5.185,  gamma: 0.067, sigma: 0.665 },
      { A: 4.140,  E0: 4.343,  gamma: 0.019, sigma: 0.189 },
      { A: 37.91,  E0: 9.809,  gamma: 0.117, sigma: 1.170 },
      { A: 324.72, E0: 18.56,  gamma: 0.052, sigma: 0.516 },
    ],
    color: "#D3D3D3",
    iadIncrease: 0,
    stress: 0,
    kType: "brendel-bormann",
  },
  // Gold — Brendel-Bormann fit (Rakic 1998)
  Au_BB: {
    type: "brendel-bormann",
    epsInf: 1.0,
    oscillators: [
      { A: 62.78,  E0: 0,      gamma: 0.050, sigma: 0     },  // Drude
      { A: 4.403,  E0: 0.218,  gamma: 0.074, sigma: 0.742 },
      { A: 4.077,  E0: 2.885,  gamma: 0.035, sigma: 0.349 },
      { A: 25.43,  E0: 4.069,  gamma: 0.083, sigma: 0.830 },
      { A: 58.62,  E0: 6.137,  gamma: 0.125, sigma: 1.246 },
      { A: 134.38, E0: 27.97,  gamma: 0.179, sigma: 1.795 },
    ],
    color: "#FFD700",
    iadIncrease: 0,
    stress: 0,
    kType: "brendel-bormann",
  },
};

// =====================================================================
// COATING TEMPLATES — Parameterized optical coating structure generators
// =====================================================================
// Each type has subtypes with declarative params and pure generate/generateTargets functions.
// generate(params, materials, getN) → [{material, thickness}]
// generateTargets(params) → [{wavelengthMin, wavelengthMax, rMin, rMax}]

// Helper: find material in palette closest to target refractive index at wavelength
function findClosestMaterial(targetN, wavelength, materials, getN, exclude = []) {
  let best = null, bestDiff = Infinity;
  for (const name of Object.keys(materials)) {
    if (exclude.includes(name)) continue;
    const n = getN(name, wavelength);
    const diff = Math.abs(n - targetN);
    if (diff < bestDiff) { bestDiff = diff; best = name; }
  }
  return best;
}

// Helper: find the highest-index material in palette at wavelength
function findHighIndexMaterial(wavelength, materials, getN) {
  let best = null, bestN = 0;
  for (const name of Object.keys(materials)) {
    const n = getN(name, wavelength);
    if (n > bestN) { bestN = n; best = name; }
  }
  return best;
}

// Helper: find the lowest-index material in palette at wavelength (excluding substrate-like indices)
function findLowIndexMaterial(wavelength, materials, getN) {
  let best = null, bestN = Infinity;
  for (const name of Object.keys(materials)) {
    const n = getN(name, wavelength);
    if (n < bestN) { bestN = n; best = name; }
  }
  return best;
}

const COATING_TEMPLATES = {
  ar: {
    id: 'ar',
    name: 'Anti-Reflection (AR)',
    icon: 'ar',
    category: 'common',
    description: 'Minimize reflection across a wavelength range',
    subtypes: [
      {
        id: 'ar_single',
        name: 'Single-Layer QWOT',
        description: 'Quarter-wave optical thickness — simplest AR for one wavelength',
        tierRequired: 'free',
        params: [
          { key: 'centerWavelength', label: 'Center Wavelength (nm)', type: 'number', min: 200, max: 2500, default: 550, step: 10 },
          { key: 'substrateN', label: 'Substrate Index', type: 'number', min: 1.0, max: 4.0, default: 1.52, step: 0.01, autoFill: 'substrate.n', readOnly: true },
        ],
        generate: (params, materials, getN) => {
          const wl = params.centerWavelength || 550;
          const nSub = params.substrateN || 1.52;
          const idealN = Math.sqrt(nSub); // sqrt(n_sub * n_air) where n_air ≈ 1
          const mat = findClosestMaterial(idealN, wl, materials, getN);
          if (!mat) return [];
          const n = getN(mat, wl);
          const thickness = wl / (4 * n);
          return [{ material: mat, thickness: Math.round(thickness * 10) / 10 }];
        },
        generateTargets: (params) => {
          const wl = params.centerWavelength || 550;
          const hw = 25;
          return [{ wavelengthMin: wl - hw, wavelengthMax: wl + hw, rMin: 0, rMax: 0.5 }];
        },
      },
      {
        id: 'ar_vcoat',
        name: 'V-Coat (2-layer)',
        description: 'Two-layer design for minimum reflectance at a single wavelength',
        tierRequired: 'free',
        params: [
          { key: 'centerWavelength', label: 'Center Wavelength (nm)', type: 'number', min: 200, max: 2500, default: 550, step: 10 },
          { key: 'substrateN', label: 'Substrate Index', type: 'number', min: 1.0, max: 4.0, default: 1.52, step: 0.01, autoFill: 'substrate.n', readOnly: true },
          { key: 'highMaterial', label: 'High-Index Material', type: 'material_select', filter: 'high', default: 'TiO2' },
          { key: 'lowMaterial', label: 'Low-Index Material', type: 'material_select', filter: 'low', default: 'SiO2' },
        ],
        generate: (params, materials, getN) => {
          const wl = params.centerWavelength || 550;
          const hMat = params.highMaterial || 'TiO2';
          const lMat = params.lowMaterial || 'SiO2';
          const nH = getN(hMat, wl);
          const nL = getN(lMat, wl);
          // V-coat: each layer is approximately QWOT
          const dH = wl / (4 * nH);
          const dL = wl / (4 * nL);
          return [
            { material: hMat, thickness: Math.round(dH * 10) / 10 },
            { material: lMat, thickness: Math.round(dL * 10) / 10 },
          ];
        },
        generateTargets: (params) => {
          const wl = params.centerWavelength || 550;
          return [{ wavelengthMin: wl - 15, wavelengthMax: wl + 15, rMin: 0, rMax: 0.3 }];
        },
      },
      {
        id: 'ar_broadband',
        name: 'Broadband AR (3-6 layers)',
        description: 'Multi-layer graded index for wide spectral range — good optimizer seed',
        tierRequired: 'starter',
        params: [
          { key: 'wavelengthMin', label: 'Wavelength Min (nm)', type: 'number', min: 200, max: 2400, default: 400, step: 10 },
          { key: 'wavelengthMax', label: 'Wavelength Max (nm)', type: 'number', min: 300, max: 2500, default: 700, step: 10 },
          { key: 'layerCount', label: 'Number of Layers', type: 'select', options: [3, 4, 5, 6], default: 4 },
          { key: 'substrateN', label: 'Substrate Index', type: 'number', min: 1.0, max: 4.0, default: 1.52, step: 0.01, autoFill: 'substrate.n', readOnly: true },
          { key: 'highMaterial', label: 'High-Index Material', type: 'material_select', filter: 'high', default: 'TiO2' },
          { key: 'lowMaterial', label: 'Low-Index Material', type: 'material_select', filter: 'low', default: 'SiO2' },
        ],
        generate: (params, materials, getN) => {
          const wlMin = params.wavelengthMin || 400;
          const wlMax = params.wavelengthMax || 700;
          const wlCenter = (wlMin + wlMax) / 2;
          const nSub = params.substrateN || 1.52;
          const N = params.layerCount || 4;
          const hMat = params.highMaterial || 'TiO2';
          const lMat = params.lowMaterial || 'SiO2';
          // Geometric index progression: ideal n_i = n_sub^((N-i)/(N+1))
          const layers = [];
          for (let i = 0; i < N; i++) {
            const idealN = Math.pow(nSub, (N - i) / (N + 1));
            // Alternate H/L materials, picking whichever is closer to idealN
            const nH = getN(hMat, wlCenter);
            const nL = getN(lMat, wlCenter);
            const mat = Math.abs(nH - idealN) < Math.abs(nL - idealN) ? hMat : lMat;
            const n = getN(mat, wlCenter);
            const thickness = wlCenter / (4 * n);
            layers.push({ material: mat, thickness: Math.round(thickness * 10) / 10 });
          }
          return layers;
        },
        generateTargets: (params) => {
          const wlMin = params.wavelengthMin || 400;
          const wlMax = params.wavelengthMax || 700;
          return [{ wavelengthMin: wlMin, wavelengthMax: wlMax, rMin: 0, rMax: 1.0 }];
        },
      },
    ],
  },
  hr: {
    id: 'hr',
    name: 'High Reflector (HR)',
    icon: 'hr',
    category: 'common',
    description: 'Maximize reflectance at a design wavelength using quarter-wave stacks',
    subtypes: [
      {
        id: 'hr_standard',
        name: 'Quarter-Wave Stack',
        description: 'Alternating high/low index layers, each λ/4 optical thickness',
        tierRequired: 'free',
        params: [
          { key: 'centerWavelength', label: 'Center Wavelength (nm)', type: 'number', min: 200, max: 2500, default: 1064, step: 10 },
          { key: 'numPairs', label: 'Number of Pairs', type: 'number', min: 2, max: 25, default: 7, step: 1 },
          { key: 'highMaterial', label: 'High-Index Material', type: 'material_select', filter: 'high', default: 'TiO2' },
          { key: 'lowMaterial', label: 'Low-Index Material', type: 'material_select', filter: 'low', default: 'SiO2' },
        ],
        generate: (params, materials, getN) => {
          const wl = params.centerWavelength || 1064;
          const pairs = Math.max(2, Math.min(25, params.numPairs || 7));
          const hMat = params.highMaterial || 'TiO2';
          const lMat = params.lowMaterial || 'SiO2';
          const nH = getN(hMat, wl);
          const nL = getN(lMat, wl);
          const dH = wl / (4 * nH);
          const dL = wl / (4 * nL);
          const layers = [];
          for (let i = 0; i < pairs; i++) {
            layers.push({ material: hMat, thickness: Math.round(dH * 10) / 10 });
            layers.push({ material: lMat, thickness: Math.round(dL * 10) / 10 });
          }
          return layers;
        },
        generateTargets: (params) => {
          const wl = params.centerWavelength || 1064;
          return [
            { wavelengthMin: wl - 50, wavelengthMax: wl + 50, rMin: 99.0, rMax: 100 },
          ];
        },
      },
    ],
  },
  bandpass: {
    id: 'bandpass',
    name: 'Bandpass Filter',
    icon: 'bandpass',
    category: 'common',
    description: 'Pass a narrow wavelength band using Fabry-Perot cavity design',
    subtypes: [
      {
        id: 'bandpass_single',
        name: 'Single Cavity',
        description: 'One Fabry-Perot cavity — wider passband, simpler structure',
        tierRequired: 'starter',
        params: [
          { key: 'centerWavelength', label: 'Center Wavelength (nm)', type: 'number', min: 200, max: 2500, default: 550, step: 10 },
          { key: 'numPairs', label: 'Mirror Pairs', type: 'number', min: 2, max: 12, default: 4, step: 1 },
          { key: 'spacerOrder', label: 'Spacer Order', type: 'select', options: [1, 2, 3], default: 1 },
          { key: 'highMaterial', label: 'High-Index Material', type: 'material_select', filter: 'high', default: 'TiO2' },
          { key: 'lowMaterial', label: 'Low-Index Material', type: 'material_select', filter: 'low', default: 'SiO2' },
        ],
        generate: (params, materials, getN) => {
          const wl = params.centerWavelength || 550;
          const p = Math.max(2, Math.min(12, params.numPairs || 4));
          const m = params.spacerOrder || 1;
          const hMat = params.highMaterial || 'TiO2';
          const lMat = params.lowMaterial || 'SiO2';
          const nH = getN(hMat, wl);
          const nL = getN(lMat, wl);
          const dH = wl / (4 * nH);
          const dL = wl / (4 * nL);
          const spacerD = m * wl / (2 * nH); // Half-wave spacer in H material
          const layers = [];
          // Front mirror: (HL)^p
          for (let i = 0; i < p; i++) {
            layers.push({ material: hMat, thickness: Math.round(dH * 10) / 10 });
            layers.push({ material: lMat, thickness: Math.round(dL * 10) / 10 });
          }
          // Spacer (half-wave in H material)
          layers.push({ material: hMat, thickness: Math.round(spacerD * 10) / 10 });
          // Back mirror: (LH)^p
          for (let i = 0; i < p; i++) {
            layers.push({ material: lMat, thickness: Math.round(dL * 10) / 10 });
            layers.push({ material: hMat, thickness: Math.round(dH * 10) / 10 });
          }
          return layers;
        },
        generateTargets: (params) => {
          const wl = params.centerWavelength || 550;
          return [
            { wavelengthMin: wl - 10, wavelengthMax: wl + 10, rMin: 0, rMax: 10 },
            { wavelengthMin: wl - 80, wavelengthMax: wl - 30, rMin: 90, rMax: 100 },
            { wavelengthMin: wl + 30, wavelengthMax: wl + 80, rMin: 90, rMax: 100 },
          ];
        },
      },
      {
        id: 'bandpass_double',
        name: 'Double Cavity',
        description: 'Two coupled cavities — steeper edges, flatter passband',
        tierRequired: 'professional',
        params: [
          { key: 'centerWavelength', label: 'Center Wavelength (nm)', type: 'number', min: 200, max: 2500, default: 550, step: 10 },
          { key: 'numPairs', label: 'Mirror Pairs per Cavity', type: 'number', min: 2, max: 10, default: 3, step: 1 },
          { key: 'highMaterial', label: 'High-Index Material', type: 'material_select', filter: 'high', default: 'TiO2' },
          { key: 'lowMaterial', label: 'Low-Index Material', type: 'material_select', filter: 'low', default: 'SiO2' },
        ],
        generate: (params, materials, getN) => {
          const wl = params.centerWavelength || 550;
          const p = Math.max(2, Math.min(10, params.numPairs || 3));
          const hMat = params.highMaterial || 'TiO2';
          const lMat = params.lowMaterial || 'SiO2';
          const nH = getN(hMat, wl);
          const nL = getN(lMat, wl);
          const dH = wl / (4 * nH);
          const dL = wl / (4 * nL);
          const spacerD = wl / (2 * nH);
          const layers = [];
          // Cavity 1: (HL)^p H (LH)^p
          for (let i = 0; i < p; i++) { layers.push({ material: hMat, thickness: Math.round(dH * 10) / 10 }); layers.push({ material: lMat, thickness: Math.round(dL * 10) / 10 }); }
          layers.push({ material: hMat, thickness: Math.round(spacerD * 10) / 10 });
          for (let i = 0; i < p; i++) { layers.push({ material: lMat, thickness: Math.round(dL * 10) / 10 }); layers.push({ material: hMat, thickness: Math.round(dH * 10) / 10 }); }
          // Coupling layer
          layers.push({ material: lMat, thickness: Math.round(dL * 10) / 10 });
          // Cavity 2: (HL)^p H (LH)^p
          for (let i = 0; i < p; i++) { layers.push({ material: hMat, thickness: Math.round(dH * 10) / 10 }); layers.push({ material: lMat, thickness: Math.round(dL * 10) / 10 }); }
          layers.push({ material: hMat, thickness: Math.round(spacerD * 10) / 10 });
          for (let i = 0; i < p; i++) { layers.push({ material: lMat, thickness: Math.round(dL * 10) / 10 }); layers.push({ material: hMat, thickness: Math.round(dH * 10) / 10 }); }
          return layers;
        },
        generateTargets: (params) => {
          const wl = params.centerWavelength || 550;
          return [
            { wavelengthMin: wl - 8, wavelengthMax: wl + 8, rMin: 0, rMax: 8 },
            { wavelengthMin: wl - 60, wavelengthMax: wl - 20, rMin: 95, rMax: 100 },
            { wavelengthMin: wl + 20, wavelengthMax: wl + 60, rMin: 95, rMax: 100 },
          ];
        },
      },
      {
        id: 'bandpass_triple',
        name: 'Triple Cavity',
        description: 'Three coupled cavities — near-rectangular passband profile',
        tierRequired: 'professional',
        params: [
          { key: 'centerWavelength', label: 'Center Wavelength (nm)', type: 'number', min: 200, max: 2500, default: 550, step: 10 },
          { key: 'numPairs', label: 'Mirror Pairs per Cavity', type: 'number', min: 2, max: 8, default: 3, step: 1 },
          { key: 'highMaterial', label: 'High-Index Material', type: 'material_select', filter: 'high', default: 'TiO2' },
          { key: 'lowMaterial', label: 'Low-Index Material', type: 'material_select', filter: 'low', default: 'SiO2' },
        ],
        generate: (params, materials, getN) => {
          const wl = params.centerWavelength || 550;
          const p = Math.max(2, Math.min(8, params.numPairs || 3));
          const hMat = params.highMaterial || 'TiO2';
          const lMat = params.lowMaterial || 'SiO2';
          const nH = getN(hMat, wl);
          const nL = getN(lMat, wl);
          const dH = wl / (4 * nH);
          const dL = wl / (4 * nL);
          const spacerD = wl / (2 * nH);
          const buildCavity = () => {
            const c = [];
            for (let i = 0; i < p; i++) { c.push({ material: hMat, thickness: Math.round(dH * 10) / 10 }); c.push({ material: lMat, thickness: Math.round(dL * 10) / 10 }); }
            c.push({ material: hMat, thickness: Math.round(spacerD * 10) / 10 });
            for (let i = 0; i < p; i++) { c.push({ material: lMat, thickness: Math.round(dL * 10) / 10 }); c.push({ material: hMat, thickness: Math.round(dH * 10) / 10 }); }
            return c;
          };
          const coupling = { material: lMat, thickness: Math.round(dL * 10) / 10 };
          return [...buildCavity(), coupling, ...buildCavity(), coupling, ...buildCavity()];
        },
        generateTargets: (params) => {
          const wl = params.centerWavelength || 550;
          return [
            { wavelengthMin: wl - 6, wavelengthMax: wl + 6, rMin: 0, rMax: 5 },
            { wavelengthMin: wl - 50, wavelengthMax: wl - 15, rMin: 97, rMax: 100 },
            { wavelengthMin: wl + 15, wavelengthMax: wl + 50, rMin: 97, rMax: 100 },
          ];
        },
      },
    ],
  },
  edge: {
    id: 'edge',
    name: 'Edge Filter',
    icon: 'edge',
    category: 'common',
    description: 'Sharp wavelength cutoff — long-pass or short-pass',
    subtypes: [
      {
        id: 'edge_longpass',
        name: 'Long-Pass',
        description: 'Passes wavelengths longer than edge, reflects shorter',
        tierRequired: 'starter',
        params: [
          { key: 'edgeWavelength', label: 'Edge Wavelength (nm)', type: 'number', min: 200, max: 2500, default: 500, step: 10 },
          { key: 'numPairs', label: 'Number of Pairs', type: 'number', min: 3, max: 20, default: 8, step: 1 },
          { key: 'highMaterial', label: 'High-Index Material', type: 'material_select', filter: 'high', default: 'TiO2' },
          { key: 'lowMaterial', label: 'Low-Index Material', type: 'material_select', filter: 'low', default: 'SiO2' },
        ],
        generate: (params, materials, getN) => {
          const wl = params.edgeWavelength || 500;
          const pairs = Math.max(3, Math.min(20, params.numPairs || 8));
          const hMat = params.highMaterial || 'TiO2';
          const lMat = params.lowMaterial || 'SiO2';
          const nH = getN(hMat, wl);
          const nL = getN(lMat, wl);
          const dH = wl / (4 * nH);
          const dL = wl / (4 * nL);
          const layers = [];
          // Quarter-wave stack centered at edge wavelength — reflects the short side
          for (let i = 0; i < pairs; i++) {
            layers.push({ material: hMat, thickness: Math.round(dH * 10) / 10 });
            layers.push({ material: lMat, thickness: Math.round(dL * 10) / 10 });
          }
          return layers;
        },
        generateTargets: (params) => {
          const wl = params.edgeWavelength || 500;
          return [
            { wavelengthMin: wl - 100, wavelengthMax: wl - 20, rMin: 90, rMax: 100 },
            { wavelengthMin: wl + 20, wavelengthMax: wl + 100, rMin: 0, rMax: 5 },
          ];
        },
      },
      {
        id: 'edge_shortpass',
        name: 'Short-Pass',
        description: 'Passes wavelengths shorter than edge, reflects longer',
        tierRequired: 'starter',
        params: [
          { key: 'edgeWavelength', label: 'Edge Wavelength (nm)', type: 'number', min: 200, max: 2500, default: 600, step: 10 },
          { key: 'numPairs', label: 'Number of Pairs', type: 'number', min: 3, max: 20, default: 8, step: 1 },
          { key: 'highMaterial', label: 'High-Index Material', type: 'material_select', filter: 'high', default: 'TiO2' },
          { key: 'lowMaterial', label: 'Low-Index Material', type: 'material_select', filter: 'low', default: 'SiO2' },
        ],
        generate: (params, materials, getN) => {
          const wl = params.edgeWavelength || 600;
          const pairs = Math.max(3, Math.min(20, params.numPairs || 8));
          const hMat = params.highMaterial || 'TiO2';
          const lMat = params.lowMaterial || 'SiO2';
          const nH = getN(hMat, wl);
          const nL = getN(lMat, wl);
          const dH = wl / (4 * nH);
          const dL = wl / (4 * nL);
          const layers = [];
          // Same structure as LP — QW stack reflects around center; optimizer refines
          for (let i = 0; i < pairs; i++) {
            layers.push({ material: lMat, thickness: Math.round(dL * 10) / 10 });
            layers.push({ material: hMat, thickness: Math.round(dH * 10) / 10 });
          }
          return layers;
        },
        generateTargets: (params) => {
          const wl = params.edgeWavelength || 600;
          return [
            { wavelengthMin: wl - 100, wavelengthMax: wl - 20, rMin: 0, rMax: 5 },
            { wavelengthMin: wl + 20, wavelengthMax: wl + 100, rMin: 90, rMax: 100 },
          ];
        },
      },
    ],
  },
  notch: {
    id: 'notch',
    name: 'Notch Filter',
    icon: 'notch',
    category: 'specialty',
    description: 'Block a narrow wavelength band, pass everything else',
    subtypes: [
      {
        id: 'notch_single',
        name: 'Single Notch',
        description: 'Quarter-wave stack for single-wavelength rejection',
        tierRequired: 'starter',
        params: [
          { key: 'rejectWavelength', label: 'Rejection Wavelength (nm)', type: 'number', min: 200, max: 2500, default: 532, step: 1 },
          { key: 'numPairs', label: 'Number of Pairs', type: 'number', min: 3, max: 20, default: 7, step: 1 },
          { key: 'highMaterial', label: 'High-Index Material', type: 'material_select', filter: 'high', default: 'TiO2' },
          { key: 'lowMaterial', label: 'Low-Index Material', type: 'material_select', filter: 'low', default: 'SiO2' },
        ],
        generate: (params, materials, getN) => {
          const wl = params.rejectWavelength || 532;
          const pairs = Math.max(3, Math.min(20, params.numPairs || 7));
          const hMat = params.highMaterial || 'TiO2';
          const lMat = params.lowMaterial || 'SiO2';
          const nH = getN(hMat, wl);
          const nL = getN(lMat, wl);
          const dH = wl / (4 * nH);
          const dL = wl / (4 * nL);
          const layers = [];
          for (let i = 0; i < pairs; i++) {
            layers.push({ material: hMat, thickness: Math.round(dH * 10) / 10 });
            layers.push({ material: lMat, thickness: Math.round(dL * 10) / 10 });
          }
          return layers;
        },
        generateTargets: (params) => {
          const wl = params.rejectWavelength || 532;
          return [
            { wavelengthMin: wl - 15, wavelengthMax: wl + 15, rMin: 99, rMax: 100 },
            { wavelengthMin: wl - 100, wavelengthMax: wl - 40, rMin: 0, rMax: 5 },
            { wavelengthMin: wl + 40, wavelengthMax: wl + 100, rMin: 0, rMax: 5 },
          ];
        },
      },
      {
        id: 'notch_multi',
        name: 'Multi-Notch',
        description: 'Multiple rejection bands — concatenated QW stacks',
        tierRequired: 'professional',
        params: [
          { key: 'rejectWavelength1', label: 'Rejection λ₁ (nm)', type: 'number', min: 200, max: 2500, default: 532, step: 1 },
          { key: 'rejectWavelength2', label: 'Rejection λ₂ (nm)', type: 'number', min: 200, max: 2500, default: 1064, step: 1 },
          { key: 'numPairs', label: 'Pairs per Notch', type: 'number', min: 3, max: 15, default: 5, step: 1 },
          { key: 'highMaterial', label: 'High-Index Material', type: 'material_select', filter: 'high', default: 'TiO2' },
          { key: 'lowMaterial', label: 'Low-Index Material', type: 'material_select', filter: 'low', default: 'SiO2' },
        ],
        generate: (params, materials, getN) => {
          const wls = [params.rejectWavelength1 || 532, params.rejectWavelength2 || 1064];
          const pairs = Math.max(3, Math.min(15, params.numPairs || 5));
          const hMat = params.highMaterial || 'TiO2';
          const lMat = params.lowMaterial || 'SiO2';
          const layers = [];
          for (const wl of wls) {
            const nH = getN(hMat, wl);
            const nL = getN(lMat, wl);
            const dH = wl / (4 * nH);
            const dL = wl / (4 * nL);
            for (let i = 0; i < pairs; i++) {
              layers.push({ material: hMat, thickness: Math.round(dH * 10) / 10 });
              layers.push({ material: lMat, thickness: Math.round(dL * 10) / 10 });
            }
          }
          return layers;
        },
        generateTargets: (params) => {
          const wl1 = params.rejectWavelength1 || 532;
          const wl2 = params.rejectWavelength2 || 1064;
          return [
            { wavelengthMin: wl1 - 15, wavelengthMax: wl1 + 15, rMin: 99, rMax: 100 },
            { wavelengthMin: wl2 - 15, wavelengthMax: wl2 + 15, rMin: 99, rMax: 100 },
          ];
        },
      },
    ],
  },
  dichroic: {
    id: 'dichroic',
    name: 'Dichroic / Beamsplitter',
    icon: 'dichroic',
    category: 'specialty',
    description: 'Split spectrum at a target wavelength with controlled R/T ratio',
    subtypes: [
      {
        id: 'dichroic_standard',
        name: 'Dichroic Beamsplitter',
        description: 'Edge filter tuned for a target reflection/transmission split',
        tierRequired: 'starter',
        params: [
          { key: 'splitWavelength', label: 'Split Wavelength (nm)', type: 'number', min: 200, max: 2500, default: 550, step: 10 },
          { key: 'numPairs', label: 'Number of Pairs', type: 'number', min: 3, max: 15, default: 6, step: 1 },
          { key: 'highMaterial', label: 'High-Index Material', type: 'material_select', filter: 'high', default: 'TiO2' },
          { key: 'lowMaterial', label: 'Low-Index Material', type: 'material_select', filter: 'low', default: 'SiO2' },
        ],
        generate: (params, materials, getN) => {
          const wl = params.splitWavelength || 550;
          const pairs = Math.max(3, Math.min(15, params.numPairs || 6));
          const hMat = params.highMaterial || 'TiO2';
          const lMat = params.lowMaterial || 'SiO2';
          const nH = getN(hMat, wl);
          const nL = getN(lMat, wl);
          const dH = wl / (4 * nH);
          const dL = wl / (4 * nL);
          const layers = [];
          for (let i = 0; i < pairs; i++) {
            layers.push({ material: hMat, thickness: Math.round(dH * 10) / 10 });
            layers.push({ material: lMat, thickness: Math.round(dL * 10) / 10 });
          }
          return layers;
        },
        generateTargets: (params) => {
          const wl = params.splitWavelength || 550;
          return [
            { wavelengthMin: wl - 80, wavelengthMax: wl - 10, rMin: 90, rMax: 100 },
            { wavelengthMin: wl + 10, wavelengthMax: wl + 80, rMin: 0, rMax: 10 },
          ];
        },
      },
    ],
  },
  nd: {
    id: 'nd',
    name: 'Neutral Density (ND)',
    icon: 'nd',
    category: 'specialty',
    description: 'Uniform partial reflection across a wavelength range (dielectric only)',
    subtypes: [
      {
        id: 'nd_dielectric',
        name: 'Dielectric Partial Reflector',
        description: 'Symmetric stack for ~uniform partial reflection. Limited OD without metals.',
        tierRequired: 'starter',
        params: [
          { key: 'targetReflectance', label: 'Target Reflectance (%)', type: 'number', min: 5, max: 80, default: 30, step: 5 },
          { key: 'wavelengthMin', label: 'Wavelength Min (nm)', type: 'number', min: 200, max: 2400, default: 400, step: 10 },
          { key: 'wavelengthMax', label: 'Wavelength Max (nm)', type: 'number', min: 300, max: 2500, default: 700, step: 10 },
          { key: 'highMaterial', label: 'High-Index Material', type: 'material_select', filter: 'high', default: 'TiO2' },
          { key: 'lowMaterial', label: 'Low-Index Material', type: 'material_select', filter: 'low', default: 'SiO2' },
        ],
        generate: (params, materials, getN) => {
          const wlCenter = ((params.wavelengthMin || 400) + (params.wavelengthMax || 700)) / 2;
          const targetR = (params.targetReflectance || 30) / 100;
          const hMat = params.highMaterial || 'TiO2';
          const lMat = params.lowMaterial || 'SiO2';
          const nH = getN(hMat, wlCenter);
          const nL = getN(lMat, wlCenter);
          // Estimate pairs needed: R ≈ ((nH/nL)^(2N) - 1)^2 / ((nH/nL)^(2N) + 1)^2
          // Solve for N, clamped to reasonable range
          const ratio = nH / nL;
          let pairs = 1;
          for (let N = 1; N <= 10; N++) {
            const r2N = Math.pow(ratio, 2 * N);
            const R = Math.pow((r2N - 1) / (r2N + 1), 2);
            if (R >= targetR) { pairs = N; break; }
            pairs = N;
          }
          const dH = wlCenter / (4 * nH);
          const dL = wlCenter / (4 * nL);
          const layers = [];
          for (let i = 0; i < pairs; i++) {
            layers.push({ material: hMat, thickness: Math.round(dH * 10) / 10 });
            if (i < pairs - 1) layers.push({ material: lMat, thickness: Math.round(dL * 10) / 10 });
          }
          return layers;
        },
        generateTargets: (params) => {
          const wlMin = params.wavelengthMin || 400;
          const wlMax = params.wavelengthMax || 700;
          const r = params.targetReflectance || 30;
          return [{ wavelengthMin: wlMin, wavelengthMax: wlMax, rMin: r - 5, rMax: r + 5 }];
        },
      },
    ],
  },
  polarizing: {
    id: 'polarizing',
    name: 'Polarizing',
    icon: 'polarizing',
    category: 'specialty',
    description: 'Separate s and p polarization using thin-film stack at Brewster\'s angle',
    subtypes: [
      {
        id: 'polarizing_standard',
        name: 'MacNeille Polarizer',
        description: 'Quarter-wave stack at Brewster\'s angle — reflects s, transmits p',
        tierRequired: 'professional',
        params: [
          { key: 'centerWavelength', label: 'Center Wavelength (nm)', type: 'number', min: 200, max: 2500, default: 632, step: 10 },
          { key: 'numPairs', label: 'Number of Pairs', type: 'number', min: 3, max: 20, default: 8, step: 1 },
          { key: 'highMaterial', label: 'High-Index Material', type: 'material_select', filter: 'high', default: 'TiO2' },
          { key: 'lowMaterial', label: 'Low-Index Material', type: 'material_select', filter: 'low', default: 'SiO2' },
        ],
        generate: (params, materials, getN) => {
          const wl = params.centerWavelength || 632;
          const pairs = Math.max(3, Math.min(20, params.numPairs || 8));
          const hMat = params.highMaterial || 'TiO2';
          const lMat = params.lowMaterial || 'SiO2';
          const nH = getN(hMat, wl);
          const nL = getN(lMat, wl);
          // Brewster's angle at H/L interface: arctan(nH/nL)
          const brewsterAngle = Math.atan(nH / nL);
          // QWOT adjusted for angle: d = lambda / (4 * n * cos(theta_in_layer))
          const cosH = Math.cos(Math.asin(Math.sin(brewsterAngle) / nH * nL)); // Snell's in H
          const cosL = Math.cos(brewsterAngle); // angle in L layer
          const dH = wl / (4 * nH * cosH);
          const dL = wl / (4 * nL * cosL);
          const layers = [];
          for (let i = 0; i < pairs; i++) {
            layers.push({ material: hMat, thickness: Math.round(dH * 10) / 10 });
            layers.push({ material: lMat, thickness: Math.round(dL * 10) / 10 });
          }
          return layers;
        },
        generateTargets: (params) => {
          const wl = params.centerWavelength || 632;
          return [
            { wavelengthMin: wl - 30, wavelengthMax: wl + 30, rMin: 45, rMax: 55 },
          ];
        },
      },
    ],
  },
  chirped: {
    id: 'chirped',
    name: 'Chirped Mirror',
    icon: 'chirped',
    category: 'specialty',
    description: 'Aperiodic stack for broadband reflection and dispersion compensation',
    subtypes: [
      {
        id: 'chirped_standard',
        name: 'Linear Chirp',
        description: 'Layer thicknesses vary linearly across a wavelength range — ultrafast optics seed',
        tierRequired: 'professional',
        params: [
          { key: 'wavelengthMin', label: 'Wavelength Min (nm)', type: 'number', min: 200, max: 2000, default: 700, step: 10 },
          { key: 'wavelengthMax', label: 'Wavelength Max (nm)', type: 'number', min: 400, max: 2500, default: 900, step: 10 },
          { key: 'numPairs', label: 'Number of Pairs', type: 'number', min: 5, max: 30, default: 15, step: 1 },
          { key: 'highMaterial', label: 'High-Index Material', type: 'material_select', filter: 'high', default: 'TiO2' },
          { key: 'lowMaterial', label: 'Low-Index Material', type: 'material_select', filter: 'low', default: 'SiO2' },
        ],
        generate: (params, materials, getN) => {
          const wlMin = params.wavelengthMin || 700;
          const wlMax = params.wavelengthMax || 900;
          const pairs = Math.max(5, Math.min(30, params.numPairs || 15));
          const hMat = params.highMaterial || 'TiO2';
          const lMat = params.lowMaterial || 'SiO2';
          const layers = [];
          for (let i = 0; i < pairs; i++) {
            // Linear chirp: wavelength varies from wlMin to wlMax across pairs
            const wl = wlMin + (wlMax - wlMin) * i / (pairs - 1);
            const nH = getN(hMat, wl);
            const nL = getN(lMat, wl);
            const dH = wl / (4 * nH);
            const dL = wl / (4 * nL);
            layers.push({ material: hMat, thickness: Math.round(dH * 10) / 10 });
            layers.push({ material: lMat, thickness: Math.round(dL * 10) / 10 });
          }
          return layers;
        },
        generateTargets: (params) => {
          const wlMin = params.wavelengthMin || 700;
          const wlMax = params.wavelengthMax || 900;
          return [{ wavelengthMin: wlMin, wavelengthMax: wlMax, rMin: 99, rMax: 100 }];
        },
      },
    ],
  },
};

// Ordered list for UI display
const COATING_TEMPLATE_ORDER = ['ar', 'hr', 'bandpass', 'edge', 'notch', 'dichroic', 'nd', 'polarizing', 'chirped'];

// Template icon labels for the UI grid
const COATING_ICONS = {
  ar: { emoji: '🔍', label: 'AR' },
  hr: { emoji: '🪞', label: 'HR' },
  bandpass: { emoji: '🎯', label: 'BP' },
  edge: { emoji: '📐', label: 'Edge' },
  notch: { emoji: '🚫', label: 'Notch' },
  dichroic: { emoji: '🔀', label: 'Split' },
  nd: { emoji: '⬛', label: 'ND' },
  polarizing: { emoji: '↕️', label: 'Pol' },
  chirped: { emoji: '🌊', label: 'Chirp' },
};

// Standalone reflectivity calculator for rendering mini-charts from design data JSON
function computeReflectivityFromData(designData, customMats = {}) {
  if (!designData) return [];
  // Prefer layers from the current stack in layerStacks (authoritative source)
  let layers = designData.layers || [];
  if (designData.layerStacks && designData.currentStackId) {
    const currentStack = designData.layerStacks.find(s => s.id === designData.currentStackId);
    if (currentStack && currentStack.layers && currentStack.layers.length > 0) {
      layers = currentStack.layers;
    }
  }
  if (layers.length === 0) return [];

  const wlRange = designData.wavelengthRange || { min: 380, max: 780, step: 5 };
  const n0 = designData.incident?.n || 1.0;
  const ns = designData.substrate?.n || 1.52;

  const allMats = { ...materialDispersion, ...customMats };

  function getN(material, wavelength) {
    const data = allMats[material];
    if (!data) return 1.5;
    const lm = wavelength / 1000;
    if (data.type === 'sellmeier') {
      const { B1, B2, B3, C1, C2, C3 } = data;
      const l2 = lm * lm;
      return Math.sqrt(Math.abs(1 + (B1 * l2) / (l2 - C1) + (B2 * l2) / (l2 - C2) + (B3 * l2) / (l2 - C3)));
    } else if (data.type === 'cauchy') {
      return data.A + data.B / (lm * lm) + (data.C || 0) / (lm ** 4);
    }
    return data.n || 1.5;
  }

  const result = [];
  const step = Math.max(wlRange.step || 5, 2);
  for (let wl = wlRange.min; wl <= wlRange.max; wl += step) {
    // Transfer matrix method — normal incidence
    let M11r = 1, M11i = 0, M12r = 0, M12i = 0, M21r = 0, M21i = 0, M22r = 1, M22i = 0;
    for (let i = layers.length - 1; i >= 0; i--) {
      const n = getN(layers[i].material, wl);
      const d = Number(layers[i].thickness) || 0;
      const delta = (2 * Math.PI * n * d) / wl;
      const cd = Math.cos(delta), sd = Math.sin(delta);
      const a11r = cd, a12r = 0, a12i = sd / n, a21r = 0, a21i = n * sd, a22r = cd;
      // Complex multiply M = A * M
      const t11r = a11r * M11r - a12i * M21i;
      const t11i = a11r * M11i + a12i * M21r;
      const t12r = a11r * M12r - a12i * M22i;
      const t12i = a11r * M12i + a12i * M22r;
      const t21r = -a21i * M11i + a22r * M21r;
      const t21i = a21i * M11r + a22r * M21i;
      const t22r = -a21i * M12i + a22r * M22r;
      const t22i = a21i * M12r + a22r * M22i;
      M11r = t11r; M11i = t11i; M12r = t12r; M12i = t12i;
      M21r = t21r; M21i = t21i; M22r = t22r; M22i = t22i;
    }
    // r = (n0*M11 + n0*ns*M12 - M21 - ns*M22) / (n0*M11 + n0*ns*M12 + M21 + ns*M22)
    const numR = n0 * M11r + n0 * ns * M12r - M21r - ns * M22r;
    const numI = n0 * M11i + n0 * ns * M12i - M21i - ns * M22i;
    const denR = n0 * M11r + n0 * ns * M12r + M21r + ns * M22r;
    const denI = n0 * M11i + n0 * ns * M12i + M21i + ns * M22i;
    const denMag2 = denR * denR + denI * denI;
    const rR = (numR * denR + numI * denI) / denMag2;
    const rI = (numI * denR - numR * denI) / denMag2;
    const R = (rR * rR + rI * rI) * 100;
    result.push({ wavelength: wl, R: Math.min(R, 100) });
  }
  return result;
}

// Splash screen ring data — matches the SVG icon color bands (outer → inner)
const SPLASH_RINGS = [
  { color: '#C83040', size: 380, bw: 10, glow: 'rgba(200,48,64,0.3)' },
  { color: '#E84848', size: 346, bw: 9,  glow: 'rgba(232,72,72,0.3)' },
  { color: '#F07830', size: 310, bw: 9,  glow: 'rgba(240,120,48,0.3)' },
  { color: '#F09828', size: 276, bw: 8,  glow: 'rgba(240,152,40,0.3)' },
  { color: '#E8D028', size: 242, bw: 8,  glow: 'rgba(232,208,40,0.3)' },
  { color: '#60C048', size: 208, bw: 8,  glow: 'rgba(96,192,72,0.3)' },
  { color: '#38B0C0', size: 172, bw: 7,  glow: 'rgba(56,176,192,0.3)' },
  { color: '#3888E0', size: 138, bw: 7,  glow: 'rgba(56,136,224,0.35)' },
  { color: '#5060D8', size: 104, bw: 7,  glow: 'rgba(80,96,216,0.35)' },
  { color: '#7858C8', size: 70,  bw: 6,  glow: 'rgba(120,88,200,0.35)' },
  { color: '#6040B0', size: 40,  bw: 6,  glow: 'rgba(96,64,176,0.4)' },
];

// Mobile responsiveness hook — detects phone/tablet/desktop breakpoints
function useIsMobile() {
  const [dims, setDims] = useState(
    typeof window !== 'undefined' ? { w: window.innerWidth, h: window.innerHeight } : { w: 1200, h: 800 }
  );
  useEffect(() => {
    const onResize = () => setDims({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return {
    isPhone: dims.w < 640,
    isTablet: dims.w >= 640 && dims.w <= 1024,
    isDesktop: dims.w > 1024,
    width: dims.w,
    height: dims.h,
    isLandscape: dims.w > dims.h,
  };
}

const ThinFilmDesigner = () => {
  const { isPhone, isTablet, isDesktop, height: screenHeight, isLandscape } = useIsMobile();
  const [activeTab, setActiveTab] = useState("designer");

  // Splash screen state: 'idle' → 'expanding' → null
  const [splashPhase, setSplashPhase] = useState('idle');

  useEffect(() => {
    if (splashPhase === 'idle') {
      const expandTimer = setTimeout(() => setSplashPhase('expanding'), 1400);
      return () => clearTimeout(expandTimer);
    }
    if (splashPhase === 'expanding') {
      const removeTimer = setTimeout(() => setSplashPhase(null), 1700);
      return () => clearTimeout(removeTimer);
    }
  }, [splashPhase]);

  // Dark mode state — persisted to localStorage, synced to <html> class
  const [darkMode, setDarkMode] = useState(() => {
    try { return localStorage.getItem('opticoat-darkMode') === 'true'; } catch { return false; }
  });

  // Chart zoom state (drag-to-zoom)
  const [chartZoom, setChartZoom] = useState(null); // { x1, x2 } or null
  const [zoomSelecting, setZoomSelecting] = useState(null); // { startX } during drag

  const [layers, setLayers] = useState([]);

  const [machines, setMachines] = useState([
    {
      id: 1,
      name: "Machine 1",
      toolingFactors: {
        SiO2: 1.0,
        SiO: 1.0,
        TiO2: 1.0,
        Al2O3: 1.0,
        ZrO2: 1.0,
        Ta2O5: 1.0,
        Nb2O5: 1.0,
        HfO2: 1.0,
        MgF2: 1.0,
        Y2O3: 1.0,
      },
    },
  ]);
  const [currentMachineId, setCurrentMachineId] = useState(1);

  const [customMaterials, setCustomMaterials] = useState(() => {
    try {
      const saved = localStorage.getItem('opticoat-customMaterials');
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });
  const allMaterials = { ...materialDispersion, ...customMaterials };
  const [showMaterialLibrary, setShowMaterialLibrary] = useState(false);
  const [newMaterialForm, setNewMaterialForm] = useState({
    name: '',
    mode: 'simple',
    n: 1.5,
    k: 0,
    dispersionType: 'cauchy',
    A: 2.0, B: 0.02, C: 0.0001,
    B1: 0.6, B2: 0.4, B3: 0.9, C1: 0.07, C2: 0.12, C3: 10.0,
    kType: 'none',
    kValue: 0,
    k0: 0.05, kEdge: 350, kDecay: 0.02,
    color: '#E0E0E0',
    iadIncrease: 2.0,
    stress: 0,
    // Tabular n,k mode
    tabularText: '',
    tabularData: [],
    tabularError: '',
    // Tauc-Lorentz params (typical TiO2 defaults)
    tlA: 100, tlE0: 4.2, tlC: 2.2, tlEg: 3.2, tlEpsInf: 2.2,
    // Lorentz / Drude-Lorentz params
    lzEpsInf: 1.0,
    lzOscillators: [{ A: 1.0, E0: 4.0, gamma: 0.5 }],
    // Cody-Lorentz adds Urbach width Eu to TL params (typical HfO2: Eu=0.1 eV)
    clA: 110, clE0: 6.0, clC: 3.0, clEg: 5.5, clEpsInf: 2.0, clEu: 0.1,
    // Last-run KK validation result (transient, not persisted)
    kkResult: null,
  });

  const [layerStacks, setLayerStacks] = useState([
    {
      id: 1,
      machineId: 1,
      name: "Layer Stack 1",
      layers: [],
      visible: true,
      color: "#4f46e5",
    },
  ]);
  const [currentStackId, setCurrentStackId] = useState(1);

  const [substrate, setSubstrate] = useState({ material: "Glass", n: 1.52 });
  const [incident, setIncident] = useState({ material: "Air", n: 1.0 });
  const [wavelengthRange, setWavelengthRange] = useState({
    min: 350,
    max: 800,
    step: 5,
  });
  const [qwotReference, setQwotReference] = useState(550);
  const [layoutMode, setLayoutMode] = useState("tall"); // "tall" or "wide"
  const [chartWidth, setChartWidth] = useState(60); // percentage for horizontal mode
  const [reflectivityRange, setReflectivityRange] = useState({
    min: 0,
    max: 100,
  });
  const [autoYAxis, setAutoYAxis] = useState(false);
  const [displayMode, setDisplayMode] = useState("reflectivity"); // 'reflectivity' or 'transmission'
  const [doubleSidedAR, setDoubleSidedAR] = useState(true); // Account for backside reflection (no black backing)
  const [surfaceRoughness, setSurfaceRoughness] = useState(0); // RMS surface roughness in nm (Davies-Bennett scalar scattering)
  const [selectedIlluminant, setSelectedIlluminant] = useState("D65");
  const [chartHeight, setChartHeight] = useState(65);
  const [isDragging, setIsDragging] = useState(false);
  const [isDraggingHorizontal, setIsDraggingHorizontal] = useState(false);
  const [reflectivityData, setReflectivityData] = useState([]);
  const [admittanceWavelengths, setAdmittanceWavelengths] = useState([450, 550, 650]);
  const [admittanceData, setAdmittanceData] = useState([]);
  const [efieldWavelengths, setEfieldWavelengths] = useState([450, 550, 650]);
  const [efieldData, setEfieldData] = useState({ lines: [], layers: [] });
  const [colorData, setColorData] = useState(null);
  const [stackColorData, setStackColorData] = useState({}); // Store color data for each stack
  const [angleColorData, setAngleColorData] = useState(null); // Store color data at different angles
  const [experimentalColorData, setExperimentalColorData] = useState(null);
  const [experimentalData, setExperimentalData] = useState(null);
  const [suggestions, setSuggestions] = useState([]);
  const [showToolingModal, setShowToolingModal] = useState(false);
  const [showTargetsModal, setShowTargetsModal] = useState(false);
  const [showIADModal, setShowIADModal] = useState(false);
  const [currentIADLayer, setCurrentIADLayer] = useState(null);
  const [targets, setTargets] = useState([]);
  const [recipes, setRecipes] = useState([
    { id: 1, name: "Default Recipe", targets: [] },
  ]);
  const [currentRecipeId, setCurrentRecipeId] = useState(1);
  const [layerFactor, setLayerFactor] = useState(1.0);
  const [layerFactorMode, setLayerFactorMode] = useState("all");
  const [showFactorPreview, setShowFactorPreview] = useState(false);
  const [factorPreviewData, setFactorPreviewData] = useState([]);
  const [shiftValue, setShiftValue] = useState(0);
  const [shiftMode, setShiftMode] = useState("left-right");
  const [showShiftPreview, setShowShiftPreview] = useState(false);
  const [shiftPreviewData, setShiftPreviewData] = useState([]);
  const [previousLastThicknesses, setPreviousLastThicknesses] = useState([]);

  // Design Assistant State
  const [designPoints, setDesignPoints] = useState([]);
  const [optimizing, setOptimizing] = useState(false);
  const [optimizationProgress, setOptimizationProgress] = useState(0);
  const [optimizationStage, setOptimizationStage] = useState("");
  const [solutions, setSolutions] = useState([]);
  const [minDesignLayers, setMinDesignLayers] = useState(3);
  const [maxDesignLayers, setMaxDesignLayers] = useState(12);
  const [designMaterials, setDesignMaterials] = useState(["SiO2", "ZrO2"]);
  const [useLayerTemplate, setUseLayerTemplate] = useState(false);
  const [layerTemplate, setLayerTemplate] = useState([
    { material: "SiO2", minThickness: 20, maxThickness: 200 },
    { material: "ZrO2", minThickness: 20, maxThickness: 200 },
    { material: "SiO2", minThickness: 20, maxThickness: 200 },
    { material: "ZrO2", minThickness: 20, maxThickness: 200 },
    { material: "SiO2", minThickness: 20, maxThickness: 200 }
  ]);
  const [targetModeIterations, setTargetModeIterations] = useState(75000);
  const [reverseEngineerIterations, setReverseEngineerIterations] = useState(50000);
  const [reverseEngineerData, setReverseEngineerData] = useState(null);
  const [reverseEngineerMode, setReverseEngineerMode] = useState(false);
  const [colorTargetMode, setColorTargetMode] = useState(false);
  const [targetColorL, setTargetColorL] = useState(50);
  const [targetColorA, setTargetColorA] = useState(0);
  const [targetColorB, setTargetColorB] = useState(0);
  const [colorInputMode, setColorInputMode] = useState('lab'); // 'lab' or 'lch'
  const [targetColorC, setTargetColorC] = useState(0); // Chroma
  const [targetColorH, setTargetColorH] = useState(0); // Hue in degrees
  const [colorWeight, setColorWeight] = useState(50); // Weight for color vs reflectivity (0-100)
  const [angleColorConstraints, setAngleColorConstraints] = useState([]);
  // Each entry: { id, angle, mode: 'maxShift'|'target', maxDeltaE, targetL, targetA, targetB, weight }
  const [useAdhesionLayer, setUseAdhesionLayer] = useState(false);
  const [adhesionMaterial, setAdhesionMaterial] = useState("SiO2");
  const [adhesionThickness, setAdhesionThickness] = useState(10);
  const [maxErrorThreshold, setMaxErrorThreshold] = useState(5.0);
  const [matchTolerance, setMatchTolerance] = useState(1.0);

  // Coating Template State — Designer tab picker
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);
  const [selectedTemplateType, setSelectedTemplateType] = useState(null);
  const [selectedSubtype, setSelectedSubtype] = useState(null);
  const [templateParams, setTemplateParams] = useState({});
  const [templateInsertConfirm, setTemplateInsertConfirm] = useState(null); // null or generated layers array

  // Recipe Tracking State
  const [trackingRuns, setTrackingRuns] = useState([]);
  const [selectedRecipeForTracking, setSelectedRecipeForTracking] =
    useState(null);
  const [selectedMachineForTracking, setSelectedMachineForTracking] =
    useState(null);
  const [selectedPlacementForTracking, setSelectedPlacementForTracking] =
    useState("INT");
  const [runNumber, setRunNumber] = useState("");
  const [trackingStats, setTrackingStats] = useState(null);
  const [trackingFilters, setTrackingFilters] = useState({
    machine: "all",
    recipe: "all",
    placement: "all",
  });
  const [editingNoteRunId, setEditingNoteRunId] = useState(null);
  // Design Target Overlay
  const [trackingOverlayEnabled, setTrackingOverlayEnabled] = useState(false);
  const [trackingOverlayStackId, setTrackingOverlayStackId] = useState(null);
  // Pass/Fail Tolerance Bands
  const [trackingToleranceEnabled, setTrackingToleranceEnabled] = useState(false);
  const [trackingTolerancePct, setTrackingTolerancePct] = useState(2.0);
  // Wavelength Trend View
  const [trackingTrendView, setTrackingTrendView] = useState('spectrum');
  const [trackingTrendWavelengths, setTrackingTrendWavelengths] = useState([550]);
  // Run Comparison
  const [trackingCompareRunIds, setTrackingCompareRunIds] = useState([]);
  const [trackingColorRunId, setTrackingColorRunId] = useState('mean');
  const trackingChartRef = useRef(null);

  // Monte Carlo Yield Simulation State
  const [mcNumRuns, setMcNumRuns] = useState(1000);
  const [mcThicknessError, setMcThicknessError] = useState(2.0);
  const [mcRIError, setMcRIError] = useState(1.0);
  const [mcToolingError, setMcToolingError] = useState(0.5);
  const [mcRunning, setMcRunning] = useState(false);
  const [mcProgress, setMcProgress] = useState(0);
  const [mcResults, setMcResults] = useState(null);
  const [mcShowExamples, setMcShowExamples] = useState(true);
  const [mcIncludeColor, setMcIncludeColor] = useState(true);
  // Sensitivity Analysis State
  const [saResults, setSaResults] = useState(null);
  const [saRunning, setSaRunning] = useState(false);
  const [saDelta, setSaDelta] = useState(1.0);
  const [saDeltaMode, setSaDeltaMode] = useState("nm");
  const [saSelectedLayer, setSaSelectedLayer] = useState(null);
  const [saUseTargetWeighting, setSaUseTargetWeighting] = useState(false);
  // Multi-Angle Display State
  const [showAngles, setShowAngles] = useState({
    angle_0: true,
    angle_15: false,
    angle_30: false,
    angle_45: false,
    angle_60: false,
  });
  const [showPhase, setShowPhase] = useState(false);
  const [dragIndex, setDragIndex] = useState(null);
  const [dragOverIndex, setDragOverIndex] = useState(null);
  const dragRowRectsRef = useRef([]);

  // Coating Stress Calculator State
  const [stressResults, setStressResults] = useState(null);
  const [showStressModal, setShowStressModal] = useState(false);

  // AI Chat
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [chatStreaming, setChatStreaming] = useState(false);
  const chatEndRef = useRef(null);
  const chatAbortRef = useRef(null);
  const chatContainerRef = useRef(null);
  const userScrolledUpRef = useRef(false);
  const [lumiAddon, setLumiAddon] = useState({ active: false, messagesUsed: 0, messageLimit: 100 });
  const [showLumiAddonPrompt, setShowLumiAddonPrompt] = useState(false);

  // Toast notification state (replaces browser alert())
  const [toasts, setToasts] = useState([]);
  const toastIdRef = useRef(0);
  const showToast = useCallback((message, type = 'info') => {
    const id = ++toastIdRef.current;
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4000);
  }, []);

  // Helper: get display name for a stack, prefixed with machine number when multiple machines exist
  const getStackDisplayName = useCallback((stack) => {
    if (machines.length <= 1) return stack.name;
    const machineIdx = machines.findIndex(m => m.id === stack.machineId);
    return `${machineIdx + 1}–${stack.name}`;
  }, [machines]);

  // Refs to prevent useEffect interference during delete operations
  // and to track previous layers for comparison to avoid infinite loops
  const isDeletingRef = React.useRef(false);
  const prevLayersRef = React.useRef(null);
  const isUpdatingStackRef = React.useRef(false);
  const calcRafRef = useRef(null);
  const admittanceRafRef = useRef(null);
  const efieldRafRef = useRef(null);

  // Offline persistence state
  const [offlineReady, setOfflineReady] = useState(false);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const autoSaveTimerRef = useRef(null);

  // Mobile interaction state
  const [swipeOpenRowId, setSwipeOpenRowId] = useState(null);
  const [touchDragState, setTouchDragState] = useState(null);
  const [mobileColorExpanded, setMobileColorExpanded] = useState(false);
  const [mobileRunListExpanded, setMobileRunListExpanded] = useState(false);
  const [mobileToolbarExpanded, setMobileToolbarExpanded] = useState(false);
  const [mobileStackMenuOpen, setMobileStackMenuOpen] = useState(false);
  const [mobileAssistantView, setMobileAssistantView] = useState('config'); // 'config' | 'solutions'
  const touchDragTimerRef = useRef(null);
  const touchDragStartRef = useRef({ x: 0, y: 0 });
  const swipeTrackRef = useRef({ startX: 0, startY: 0, currentX: 0 });
  const chartDoubleTapRef = useRef(0);
  const holdRepeatRef = useRef(null);

  // Auth state (Clerk)
  const { isSignedIn, user: authUser } = useClerkUser();
  const { getToken } = useClerkAuth();
  const { organization, membership, memberships, invitations: orgInvitations } = useClerkOrg();
  const { createOrganization, setActive: setActiveOrg, userInvitations } = useClerkOrgList();

  // ─── Theme-aware color helpers (for inline styles & Recharts props) ───
  const theme = {
    // Surfaces
    surface: darkMode ? '#161830' : '#ffffff',
    surfaceAlt: darkMode ? '#1a1c38' : '#f9fafb',
    surfaceHover: darkMode ? '#22244a' : '#f3f4f6',
    appBg: darkMode ? '#0c0d1a' : '#eef2ff',
    // Text
    textPrimary: darkMode ? '#e2e4e9' : '#1f2937',
    textSecondary: darkMode ? '#a8adb8' : '#4b5563',
    textTertiary: darkMode ? '#8891a0' : '#6b7280',
    textMuted: darkMode ? '#5c6370' : '#9ca3af',
    // Borders
    border: darkMode ? '#2a2c4a' : '#e5e7eb',
    borderStrong: darkMode ? '#363860' : '#d1d5db',
    // Accent
    accent: darkMode ? '#6366f1' : '#4f46e5',
    accentLight: darkMode ? '#1e1f3a' : '#e0e7ff',
    accentText: darkMode ? '#818cf8' : '#4f46e5',
    accentHover: darkMode ? '#818cf8' : '#4338ca',
    // Status
    success: darkMode ? '#22c55e' : '#16a34a',
    error: darkMode ? '#f87171' : '#dc2626',
    warning: darkMode ? '#fbbf24' : '#d97706',
    // Charts
    chartBg: darkMode ? '#161830' : '#ffffff',
    chartGrid: darkMode ? '#2a2c4a' : '#e5e7eb',
    chartAxisText: darkMode ? '#8891a0' : '#6b7280',
    chartTooltipBg: darkMode ? '#1e2040' : '#ffffff',
    chartTooltipBorder: darkMode ? '#363860' : '#e5e7eb',
    chartTooltipText: darkMode ? '#e2e4e9' : '#1f2937',
    // Inputs
    inputBg: darkMode ? '#1a1c38' : '#ffffff',
    inputBorder: darkMode ? '#363860' : '#d1d5db',
    inputText: darkMode ? '#e2e4e9' : '#1f2937',
    // Shadow
    shadow: darkMode
      ? '0 4px 6px -1px rgba(0,0,0,0.5), 0 2px 4px -1px rgba(0,0,0,0.4)'
      : '0 4px 6px -1px rgba(0,0,0,0.07), 0 2px 4px -1px rgba(0,0,0,0.06)',
    shadowLg: darkMode
      ? '0 10px 15px -3px rgba(0,0,0,0.6), 0 4px 6px -2px rgba(0,0,0,0.4)'
      : '0 10px 15px -3px rgba(0,0,0,0.08), 0 4px 6px -2px rgba(0,0,0,0.05)',
    // Overlay
    overlay: darkMode ? 'rgba(0,0,0,0.7)' : 'rgba(0,0,0,0.5)',
  };

  // Helper: adjust material pastel colors for dark mode (reduce lightness for dark bg)
  const getMaterialBg = (hexColor) => {
    if (!darkMode) return hexColor;
    // Dark mode: convert to HSL, boost saturation and set lightness to ~30%
    const r = parseInt(hexColor.slice(1, 3), 16) / 255;
    const g = parseInt(hexColor.slice(3, 5), 16) / 255;
    const b = parseInt(hexColor.slice(5, 7), 16) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const l = (max + min) / 2;
    let h = 0, s = 0;
    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
      else if (max === g) h = ((b - r) / d + 2) / 6;
      else h = ((r - g) / d + 4) / 6;
    }
    const newS = Math.min(1, s * 1.8 + 0.15);
    const newL = 0.30;
    const hue2rgb = (p, q, t) => { if (t < 0) t += 1; if (t > 1) t -= 1; if (t < 1/6) return p + (q - p) * 6 * t; if (t < 1/2) return q; if (t < 2/3) return p + (q - p) * (2/3 - t) * 6; return p; };
    const q2 = newL < 0.5 ? newL * (1 + newS) : newL + newS - newL * newS;
    const p2 = 2 * newL - q2;
    const nr = Math.round(hue2rgb(p2, q2, h + 1/3) * 255);
    const ng = Math.round(hue2rgb(p2, q2, h) * 255);
    const nb = Math.round(hue2rgb(p2, q2, h - 1/3) * 255);
    return `#${nr.toString(16).padStart(2,'0')}${ng.toString(16).padStart(2,'0')}${nb.toString(16).padStart(2,'0')}`;
  };

  // Custom chart tooltip renderer
  const ChartTooltip = ({ active, payload, label, suffix = '%', labelPrefix = '' }) => {
    if (!active || !payload || !payload.length) return null;
    return (
      <div style={{
        background: theme.chartTooltipBg,
        border: `1px solid ${theme.chartTooltipBorder}`,
        borderRadius: 8,
        padding: '8px 12px',
        boxShadow: darkMode ? '0 4px 12px rgba(0,0,0,0.5)' : '0 4px 12px rgba(0,0,0,0.1)',
        fontSize: 12,
        color: theme.chartTooltipText,
        lineHeight: 1.5,
      }}>
        <div style={{ fontWeight: 600, marginBottom: 4, color: theme.textSecondary, fontSize: 11 }}>
          {labelPrefix}{typeof label === 'number' ? label.toFixed(1) : label}{labelPrefix ? '' : ' nm'}
        </div>
        {payload.map((entry, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: entry.color, display: 'inline-block', flexShrink: 0 }} />
            <span style={{ color: theme.textTertiary, fontSize: 11 }}>{entry.name}:</span>
            <span style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
              {typeof entry.value === 'number' ? entry.value.toFixed(2) : entry.value}{suffix}
            </span>
          </div>
        ))}
      </div>
    );
  };

  // Shared chart axis label style
  const axisLabelStyle = { fill: theme.chartAxisText, fontSize: 11, fontWeight: 500 };

  // Chart zoom handlers
  const handleChartMouseDown = (e) => {
    if (e && e.activeLabel != null) setZoomSelecting({ startX: e.activeLabel });
  };
  const handleChartMouseMove = (e) => {
    if (zoomSelecting && e && e.activeLabel != null) {
      setZoomSelecting(prev => prev ? { ...prev, endX: e.activeLabel } : null);
    }
  };
  const handleChartMouseUp = () => {
    if (zoomSelecting && zoomSelecting.endX != null) {
      const x1 = Math.min(zoomSelecting.startX, zoomSelecting.endX);
      const x2 = Math.max(zoomSelecting.startX, zoomSelecting.endX);
      if (x2 - x1 > 5) setChartZoom({ x1, x2 });
    }
    setZoomSelecting(null);
  };
  const resetChartZoom = () => { setChartZoom(null); setZoomSelecting(null); };

  // Dark mode: sync class on <html> and persist to localStorage
  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
    try { localStorage.setItem('opticoat-darkMode', String(darkMode)); } catch {}
  }, [darkMode]);

  // Set token provider for API client
  useEffect(() => {
    if (getToken) setTokenProvider(getToken);
  }, [getToken]);

  // Auto-scroll chat to bottom when messages change (only if user hasn't scrolled up)
  useEffect(() => {
    if (chatEndRef.current && !userScrolledUpRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [chatMessages]);

  // Keyboard shortcut: Ctrl+Shift+A toggles AI chat
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.ctrlKey && e.shiftKey && (e.key === 'A' || e.key === 'a')) {
        const tag = document.activeElement?.tagName?.toLowerCase();
        if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
        e.preventDefault();
        setChatOpen(prev => {
          if (prev) return false;
          if (CLERK_ENABLED && !isSignedIn) return false;
          return true;
        });
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isSignedIn]);

  // Tier & gating state
  const [tierLimits, setTierLimits] = useState(FREE_TIER_LIMITS);
  const [userTier, setUserTier] = useState('free');
  const [trialInfo, setTrialInfo] = useState(null);
  const [showTeamModal, setShowTeamModal] = useState(false);
  const [teamSeats, setTeamSeats] = useState({ used: 0, max: 5 });
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteLoading, setInviteLoading] = useState(false);

  // Fetch tier from server when signed in
  useEffect(() => {
    if (!isSignedIn) {
      setTierLimits(FREE_TIER_LIMITS);
      setUserTier('free');
      return;
    }
    let cancelled = false;
    async function fetchTier() {
      try {
        const data = await apiGet('/api/auth/tier');
        if (!cancelled) {
          setUserTier(data.tier || 'free');
          setTierLimits(data.limits || FREE_TIER_LIMITS);
          setTrialInfo(data.trial || null);
          setLumiAddon(data.lumiAddon || { active: false, messagesUsed: 0, messageLimit: 100 });
        }
      } catch (e) {
        console.warn('Failed to fetch tier:', e);
      }
    }
    fetchTier();
    return () => { cancelled = true; };
  }, [isSignedIn]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync email to backend when Clerk user data is loaded
  useEffect(() => {
    if (!isSignedIn || !authUser) return;
    const clerkEmail = authUser.primaryEmailAddress?.emailAddress || authUser.emailAddresses?.[0]?.emailAddress;
    if (clerkEmail) {
      apiPost('/api/auth/sync', { email: clerkEmail }).catch(() => {});
    }
  }, [isSignedIn, authUser]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-create Clerk Organization when Enterprise user has no org
  useEffect(() => {
    if (!isSignedIn || userTier !== 'enterprise' || !createOrganization || organization) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('billing') !== 'success') return;
    (async () => {
      try {
        const org = await createOrganization({ name: `${authUser?.firstName || 'My'}'s Team` });
        if (setActiveOrg) await setActiveOrg({ organization: org.id });
        console.log('Auto-created org:', org.id);
      } catch (e) {
        console.warn('Failed to auto-create org:', e);
      }
    })();
  }, [isSignedIn, userTier, organization, createOrganization]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch seat usage when team modal opens
  useEffect(() => {
    if (!showTeamModal || !organization) return;
    (async () => {
      try {
        const data = await apiGet('/api/organizations/seats');
        setTeamSeats(data);
      } catch (e) {
        console.warn('Failed to fetch seats:', e);
      }
    })();
  }, [showTeamModal, organization]); // eslint-disable-line react-hooks/exhaustive-deps

  // Color comparison modal state
  const [showColorCompareModal, setShowColorCompareModal] = useState(false);
  const [colorCompareSelected, setColorCompareSelected] = useState([]);

  // Workspace save/load state
  const [savedDesigns, setSavedDesigns] = useState([]);
  const [showSaveWorkspaceModal, setShowSaveWorkspaceModal] = useState(false);
  const [showLoadWorkspaceModal, setShowLoadWorkspaceModal] = useState(false);
  const [saveWorkspaceName, setSaveWorkspaceName] = useState('');
  const [designsLoading, setDesignsLoading] = useState(false);
  const [expandedWorkspaceId, setExpandedWorkspaceId] = useState(null);
  const [workspaceDataCache, setWorkspaceDataCache] = useState({});
  const [showReplaceConfirmDialog, setShowReplaceConfirmDialog] = useState(null);
  const [pendingReplaceData, setPendingReplaceData] = useState(null);
  // Track the currently-loaded workspace for Save vs Save-as-New
  const [activeWorkspaceId, setActiveWorkspaceId] = useState(null);
  const [activeWorkspaceName, setActiveWorkspaceName] = useState('');

  // Upgrade prompt state
  const [showUpgradePrompt, setShowUpgradePrompt] = useState(false);
  const [upgradeFeature, setUpgradeFeature] = useState('');
  const [showPricingModal, setShowPricingModal] = useState(false);

  // Helper: check if feature is available and show upgrade prompt if not
  const requireFeature = useCallback((featureKey, featureLabel) => {
    if (tierLimits[featureKey] === true || tierLimits[featureKey] === 'all' || tierLimits[featureKey] === -1) return true;
    if (tierLimits[featureKey] === 'target' && featureKey === 'designAssistant') return true;
    if (typeof tierLimits[featureKey] === 'number' && tierLimits[featureKey] > 0) return true;
    setUpgradeFeature(featureLabel);
    setShowUpgradePrompt(true);
    return false;
  }, [tierLimits]);

  // Helper: check numeric limit
  const checkLimit = useCallback((limitKey, currentCount, featureLabel) => {
    const limit = tierLimits[limitKey];
    if (limit === -1) return true; // unlimited
    if (currentCount < limit) return true;
    setUpgradeFeature(featureLabel + ` (limit: ${limit})`);
    setShowUpgradePrompt(true);
    return false;
  }, [tierLimits]);

  // Helper function to safely parse number inputs
  // Convert L*a*b* to LCh
  const labToLch = (a, b) => {
    const C = Math.sqrt(a * a + b * b);
    let h = Math.atan2(b, a) * (180 / Math.PI);
    if (h < 0) h += 360;
    return { C, h };
  };

  // Convert LCh to L*a*b*
  const lchToLab = (C, h) => {
    const hRad = h * (Math.PI / 180);
    const a = C * Math.cos(hRad);
    const b = C * Math.sin(hRad);
    return { a, b };
  };

  const safeParseFloat = (value, defaultValue = 0) => {
    if (value === "" || value === null || value === undefined) {
      return defaultValue;
    }
    const parsed = parseFloat(value);
    return isNaN(parsed) ? defaultValue : parsed;
  };

  // AI Chat: send message with streaming
  const sendChatMessage = async () => {
    // Custom LUMI access check (handles 'addon' tier value)
    const aiChatAccess = tierLimits.aiChat;
    if (aiChatAccess === false) {
      setUpgradeFeature('Lumi AI Assistant');
      setShowUpgradePrompt(true);
      return;
    }
    if (aiChatAccess === 'addon' && !lumiAddon.active) {
      setShowLumiAddonPrompt(true);
      return;
    }
    const trimmed = chatInput.trim();
    if (!trimmed || chatStreaming) return;

    const userMsg = { role: 'user', content: trimmed };
    setChatMessages(prev => [...prev, userMsg]);
    setChatInput('');
    setChatStreaming(true);
    userScrolledUpRef.current = false;

    // Build context from current design state
    const context = {
      layers: layers.map(l => ({ material: l.material, thickness: l.thickness })),
      substrate: { material: substrate.material, n: substrate.n },
      incident: { material: incident.material, n: incident.n },
      wavelengthRange,
      displayMode,
      targets: targets.map(t => ({
        name: t.name,
        wavelengthMin: t.wavelengthMin,
        wavelengthMax: t.wavelengthMax,
        reflectivityMin: t.reflectivityMin,
        reflectivityMax: t.reflectivityMax,
      })),
      colorData: colorData ? { L: Number(colorData.L), a: Number(colorData.a), b: Number(colorData.b) } : null,
      stackCount: layerStacks.length,
      materials: Object.keys(allMaterials),
    };

    // Add thinking placeholder
    setChatMessages(prev => [...prev, { role: 'assistant', content: '', thinking: true }]);

    const controller = new AbortController();
    chatAbortRef.current = controller;

    try {
      await apiStream(
        '/api/chat',
        { messages: [...chatMessages.slice(-10), userMsg], context },
        (chunk) => {
          setChatMessages(prev => {
            const updated = [...prev];
            const last = updated.length - 1;
            if (updated[last]?.role === 'assistant') {
              updated[last] = { ...updated[last], content: updated[last].content + chunk, thinking: false };
            }
            return updated;
          });
        },
        () => {
          setChatStreaming(false);
          chatAbortRef.current = null;
          // Increment local counter for add-on users
          if (aiChatAccess === 'addon') {
            setLumiAddon(prev => ({ ...prev, messagesUsed: prev.messagesUsed + 1 }));
          }
        },
        (error) => {
          setChatMessages(prev => {
            const updated = [...prev];
            const last = updated.length - 1;
            if (updated[last]?.role === 'assistant') {
              updated[last] = { ...updated[last], content: 'Error: ' + error, thinking: false };
            }
            return updated;
          });
          setChatStreaming(false);
          chatAbortRef.current = null;
        },
        controller.signal
      );
    } catch (err) {
      if (err.name !== 'AbortError') {
        setChatMessages(prev => {
          const updated = [...prev];
          const last = updated.length - 1;
          if (updated[last]?.role === 'assistant') {
            updated[last] = { ...updated[last], content: 'Error: ' + err.message, thinking: false };
          }
          return updated;
        });
      }
      setChatStreaming(false);
      chatAbortRef.current = null;
    }
  };

  // IAD Functions
  const openIADModal = (layerId) => {
    if (!requireFeature('iad', 'IAD (Ion-Assisted Deposition)')) return;
    setCurrentIADLayer(layerId);
    setShowIADModal(true);
  };

  const getDefaultIADSettings = (material) => {
    const defaults = allMaterials[material];
    return {
      enabled: true,
      voltage: 100,
      current: 1.0,
      o2Flow: 8,
      arFlow: 5,
      riIncrease: defaults?.iadIncrease || 3.0,
      packingDensity: 1.0,
    };
  };

  const updateLayerIAD = (iadSettings) => {
    // Extract packing density to save separately on the layer
    const { packingDensity, ...iadOnly } = iadSettings;
    
    setLayers((prev) =>
      prev.map((layer) =>
        layer.id === currentIADLayer 
          ? { ...layer, iad: iadOnly, packingDensity: packingDensity || 1.0 } 
          : layer
      )
    );

    setLayerStacks((prev) =>
      prev.map((stack) => ({
        ...stack,
        layers: stack.layers.map((layer) =>
          layer.id === currentIADLayer 
            ? { ...layer, iad: iadOnly, packingDensity: packingDensity || 1.0 } 
            : layer
        ),
      }))
    );

    setShowIADModal(false);
    setCurrentIADLayer(null);
  };

  const removeLayerIAD = (layerId) => {
    setLayers((prev) =>
      prev.map((layer) =>
        layer.id === layerId ? { ...layer, iad: null } : layer
      )
    );

    setLayerStacks((prev) =>
      prev.map((stack) => ({
        ...stack,
        layers: stack.layers.map((layer) =>
          layer.id === layerId ? { ...layer, iad: null } : layer
        ),
      }))
    );
  };

  // Get extinction coefficient (k-value) at a given wavelength
  const getExtinctionCoefficient = useCallback((material, wavelength) => {
    const data = allMaterials[material];
    if (!data) return 0;

    // Tabular n,k materials: k comes directly from the table, independent of kType.
    if (data.type === "tabular") {
      return interpolateNk(data.data, wavelength).k;
    }

    // Tauc-Lorentz: absorption is built into the dispersion model.
    if (data.type === "tauc-lorentz") {
      return taucLorentzNK(wavelength, data).k;
    }

    // Lorentz / Drude / Drude-Lorentz: built-in k.
    if (data.type === "lorentz") {
      return drudeLorentzNK(wavelength, data).k;
    }

    // Cody-Lorentz: TL + Urbach tail below bandgap.
    if (data.type === "cody-lorentz") {
      return codyLorentzNK(wavelength, data).k;
    }

    // Brendel-Bormann: Gaussian-broadened Lorentz oscillators.
    if (data.type === "brendel-bormann") {
      return brendelBormannNK(wavelength, data).k;
    }

    if (data.kType === "none") return 0;

    if (data.kType === "constant") return data.kValue || 0;

    if (data.kType === "urbach") {
      const { k0, kEdge, kDecay } = data;
      if (wavelength <= kEdge) {
        return k0;
      } else {
        return k0 * Math.exp(-kDecay * (wavelength - kEdge));
      }
    }

    return 0;
  }, [customMaterials]);

  const getRefractiveIndex = useCallback(
    (material, wavelength, iadSettings = null, packingDensity = 1.0) => {
      const data = allMaterials[material];
      if (!data) return 1.5;

      const lambdaMicrons = wavelength / 1000;

      let baseN;
      if (data.type === "tabular") {
        baseN = interpolateNk(data.data, wavelength).n;
      } else if (data.type === "tauc-lorentz") {
        baseN = taucLorentzNK(wavelength, data).n;
      } else if (data.type === "lorentz") {
        baseN = drudeLorentzNK(wavelength, data).n;
      } else if (data.type === "cody-lorentz") {
        baseN = codyLorentzNK(wavelength, data).n;
      } else if (data.type === "brendel-bormann") {
        baseN = brendelBormannNK(wavelength, data).n;
      } else if (data.type === "sellmeier") {
        const { B1, B2, B3, C1, C2, C3 } = data;
        const lambda2 = lambdaMicrons * lambdaMicrons;
        const nSquared =
          1 +
          (B1 * lambda2) / (lambda2 - C1) +
          (B2 * lambda2) / (lambda2 - C2) +
          (B3 * lambda2) / (lambda2 - C3);
        baseN = Math.sqrt(Math.abs(nSquared));
      } else if (data.type === "cauchy") {
        const { A, B, C } = data;
        baseN =
          A + B / (lambdaMicrons * lambdaMicrons) + C / lambdaMicrons ** 4;
      } else {
        baseN = data.n;
      }

      // Apply IAD adjustment if enabled
      if (iadSettings && iadSettings.enabled) {
        const riMultiplier = 1 + iadSettings.riIncrease / 100;
        baseN = baseN * riMultiplier;
      }

      // Apply packing density correction
      // Formula: n_eff = p * n_solid + (1-p) * n_void
      // Where n_void = 1.0 (air in pores)
      if (packingDensity < 1.0) {
        const n_void = 1.0;
        baseN = (packingDensity * baseN) + ((1 - packingDensity) * n_void);
      }

      return baseN;
    },
    [customMaterials]
  );

  const calculateReflectivityAtWavelength = useCallback(
    (lambda, layerStack = layers, stackId = currentStackId, angle = 0, phaseOut = null) => {
      try {
        const n0 = incident.n;
        const ns = substrate.n;

        const stack = layerStacks.find((s) => s.id === stackId);
        const machine = machines.find((m) => m.id === stack?.machineId);
        const toolingFactors = machine?.toolingFactors || {};

        // Normal incidence (angle = 0) - with complex refractive index support
        if (angle === 0) {
          let M11r = 1,
            M11i = 0,
            M12r = 0,
            M12i = 0,
            M21r = 0,
            M21i = 0,
            M22r = 1,
            M22i = 0;

          for (let i = layerStack.length - 1; i >= 0; i--) {
            // Get real part of refractive index (n)
            const nr = getRefractiveIndex(
              layerStack[i].material,
              lambda,
              layerStack[i].iad,
              layerStack[i].packingDensity || 1.0
            );
            const ni = getExtinctionCoefficient(layerStack[i].material, lambda);
            
            const toolingFactor = toolingFactors[layerStack[i].material] || 1.0;
            const d = layerStack[i].thickness * toolingFactor;
            
            // Complex phase: δ = (2π/λ) * (n - ik) * d
            const delta0 = (2 * Math.PI * d) / lambda;
            const deltaR = delta0 * nr;  // Real part of phase
            const deltaI = delta0 * ni;  // Imaginary part magnitude
            
            // Complex trig functions: cos(a - ib) and sin(a - ib)
            // cos(a - ib) = cos(a)cosh(b) + i*sin(a)sinh(b)
            // sin(a - ib) = sin(a)cosh(b) - i*cos(a)sinh(b)
            const cosA = Math.cos(deltaR);
            const sinA = Math.sin(deltaR);
            const coshB = Math.cosh(deltaI);
            const sinhB = Math.sinh(deltaI);
            
            const cosDr = cosA * coshB;
            const cosDi = sinA * sinhB;
            const sinDr = sinA * coshB;
            const sinDi = -cosA * sinhB;
            
            // For characteristic matrix with complex N = nr - i*ni:
            // L11 = L22 = cos(δ)
            // L12 = i*sin(δ)/N
            // L21 = i*N*sin(δ)
            
            const L11r = cosDr;
            const L11i = cosDi;
            const L22r = cosDr;
            const L22i = cosDi;
            
            // L12 = i*sin(δ)/N - requires complex division then multiply by i
            const nMagSq = nr * nr + ni * ni;
            // sin(δ)/N = (sinDr + i*sinDi) * (nr + i*ni) / |N|²
            const sinOverN_r = (sinDr * nr - sinDi * ni) / nMagSq;
            const sinOverN_i = (sinDr * ni + sinDi * nr) / nMagSq;
            // Multiply by i: i*(a + ib) = -b + ia
            const L12r = -sinOverN_i;
            const L12i = sinOverN_r;
            
            // L21 = i*N*sin(δ) - requires complex multiplication then multiply by i
            // N*sin(δ) = (nr - i*ni) * (sinDr + i*sinDi)
            const NsinD_r = nr * sinDr + ni * sinDi;
            const NsinD_i = nr * sinDi - ni * sinDr;
            // Multiply by i
            const L21r = -NsinD_i;
            const L21i = NsinD_r;
            
            // Matrix multiplication M = M * L
            const newM11r =
              M11r * L11r - M11i * L11i + M12r * L21r - M12i * L21i;
            const newM11i =
              M11r * L11i + M11i * L11r + M12r * L21i + M12i * L21r;
            const newM12r =
              M11r * L12r - M11i * L12i + M12r * L22r - M12i * L22i;
            const newM12i =
              M11r * L12i + M11i * L12r + M12r * L22i + M12i * L22r;
            const newM21r =
              M21r * L11r - M21i * L11i + M22r * L21r - M22i * L21i;
            const newM21i =
              M21r * L11i + M21i * L11r + M22r * L21i + M22i * L21r;
            const newM22r =
              M21r * L12r - M21i * L12i + M22r * L22r - M22i * L22i;
            const newM22i =
              M21r * L12i + M21i * L12r + M22r * L22i + M22i * L22r;

            M11r = newM11r;
            M11i = newM11i;
            M12r = newM12r;
            M12i = newM12i;
            M21r = newM21r;
            M21i = newM21i;
            M22r = newM22r;
            M22i = newM22i;
          }

          const numR = n0 * M11r + n0 * ns * M12r - M21r - ns * M22r;
          const numI = n0 * M11i + n0 * ns * M12i - M21i - ns * M22i;
          const denR = n0 * M11r + n0 * ns * M12r + M21r + ns * M22r;
          const denI = n0 * M11i + n0 * ns * M12i + M21i + ns * M22i;
          const denMag = denR * denR + denI * denI;
          const rR = (numR * denR + numI * denI) / denMag;
          const rI = (numI * denR - numR * denI) / denMag;
          const R = rR * rR + rI * rI;
          if (phaseOut) phaseOut.phase = Math.atan2(rI, rR) * 180 / Math.PI;
          // Davies-Bennett scalar scattering loss (normal incidence: cosθ = 1)
          let Rout = R;
          if (surfaceRoughness > 0) {
            const arg = (4 * Math.PI * surfaceRoughness) / lambda;
            Rout = R * Math.exp(-arg * arg);
          }
          return Math.min(Math.max(Rout, 0), 1);
        }

        // Oblique incidence — full complex transfer matrix.
        // Uses complex refractive index N = nr - i·ni throughout (including
        // complex Snell's law and complex cos θ). This preserves absorption
        // at angles, which the previous real-n approximation dropped.
        const angleRad = (angle * Math.PI) / 180;
        const sinTheta0 = Math.sin(angleRad);
        const cosTheta0 = Math.cos(angleRad);
        const q = n0 * sinTheta0;  // n0·sin(θ0) — real (incident medium lossless)

        // Precompute per-layer [nr, ni, cosR, cosI]
        const layerData = new Array(layerStack.length);
        for (let i = 0; i < layerStack.length; i++) {
          const nr = getRefractiveIndex(
            layerStack[i].material, lambda,
            layerStack[i].iad, layerStack[i].packingDensity || 1.0
          );
          const ni = getExtinctionCoefficient(layerStack[i].material, lambda);
          // sin(θ_layer) = q / N = q·(nr + i·ni)/|N|²
          const magSq = nr * nr + ni * ni;
          const sinR = (q * nr) / magSq;
          const sinI = (q * ni) / magSq;
          // sin²(θ_layer)
          const sin2R = sinR * sinR - sinI * sinI;
          const sin2I = 2 * sinR * sinI;
          // cos²(θ_layer) = 1 - sin²
          const cos2R = 1 - sin2R;
          const cos2I = -sin2I;
          // cos(θ_layer) = sqrt(cos²) — principal branch (preserves Im sign)
          let cosR, cosI;
          if (cos2I === 0) {
            if (cos2R >= 0) { cosR = Math.sqrt(cos2R); cosI = 0; }
            else { cosR = 0; cosI = Math.sqrt(-cos2R); }
          } else {
            const mag = Math.hypot(cos2R, cos2I);
            cosR = Math.sqrt((mag + cos2R) / 2);
            cosI = (cos2I >= 0 ? 1 : -1) * Math.sqrt((mag - cos2R) / 2);
          }
          layerData[i] = [nr, ni, cosR, cosI];
        }

        // Substrate cos(θ) — substrate index is real (OptiCoat doesn't track substrate k)
        const sinThetaS = q / ns;
        let cosSubR, cosSubI;
        const cos2Sub = 1 - sinThetaS * sinThetaS;
        if (cos2Sub >= 0) { cosSubR = Math.sqrt(cos2Sub); cosSubI = 0; }
        else { cosSubR = 0; cosSubI = Math.sqrt(-cos2Sub); }  // TIR → evanescent

        // ─── s-polarization (TE) — η = N·cos(θ) ───
        let M11r_s = 1, M11i_s = 0, M12r_s = 0, M12i_s = 0;
        let M21r_s = 0, M21i_s = 0, M22r_s = 1, M22i_s = 0;

        for (let i = layerStack.length - 1; i >= 0; i--) {
          const [nr, ni, cR, cI] = layerData[i];
          const toolingFactor = toolingFactors[layerStack[i].material] || 1.0;
          const d = layerStack[i].thickness * toolingFactor;
          const factor = (2 * Math.PI * d) / lambda;
          // δ = factor · N · cos(θ) = factor · (nr - i·ni)(cR + i·cI)
          const deltaR = factor * (nr * cR + ni * cI);
          const deltaI = factor * (nr * cI - ni * cR);
          // cos(δR + i·δI) = cos(δR)cosh(δI) - i·sin(δR)sinh(δI)
          const cdR = Math.cos(deltaR), cdI_sh = Math.sin(deltaR);
          const coshDI = Math.cosh(deltaI), sinhDI = Math.sinh(deltaI);
          const cosDR = cdR * coshDI;
          const cosDI = -cdI_sh * sinhDI;
          const sinDR = cdI_sh * coshDI;
          const sinDI = cdR * sinhDI;
          // η_s = N·cos(θ) = (nr - i·ni)(cR + i·cI)
          const etaR = nr * cR + ni * cI;
          const etaI = nr * cI - ni * cR;
          // L11 = L22 = cos(δ)
          const L11r = cosDR, L11i = cosDI, L22r = cosDR, L22i = cosDI;
          // L12 = i·sin(δ)/η   and   L21 = i·η·sin(δ)
          const etaMagSq = etaR * etaR + etaI * etaI;
          const sOverEta_r = (sinDR * etaR + sinDI * etaI) / etaMagSq;
          const sOverEta_i = (sinDI * etaR - sinDR * etaI) / etaMagSq;
          const L12r = -sOverEta_i, L12i = sOverEta_r;
          const etaSin_r = etaR * sinDR - etaI * sinDI;
          const etaSin_i = etaR * sinDI + etaI * sinDR;
          const L21r = -etaSin_i, L21i = etaSin_r;
          // M = M · L
          const nM11r = M11r_s * L11r - M11i_s * L11i + M12r_s * L21r - M12i_s * L21i;
          const nM11i = M11r_s * L11i + M11i_s * L11r + M12r_s * L21i + M12i_s * L21r;
          const nM12r = M11r_s * L12r - M11i_s * L12i + M12r_s * L22r - M12i_s * L22i;
          const nM12i = M11r_s * L12i + M11i_s * L12r + M12r_s * L22i + M12i_s * L22r;
          const nM21r = M21r_s * L11r - M21i_s * L11i + M22r_s * L21r - M22i_s * L21i;
          const nM21i = M21r_s * L11i + M21i_s * L11r + M22r_s * L21i + M22i_s * L21r;
          const nM22r = M21r_s * L12r - M21i_s * L12i + M22r_s * L22r - M22i_s * L22i;
          const nM22i = M21r_s * L12i + M21i_s * L12r + M22r_s * L22i + M22i_s * L22r;
          M11r_s = nM11r; M11i_s = nM11i; M12r_s = nM12r; M12i_s = nM12i;
          M21r_s = nM21r; M21i_s = nM21i; M22r_s = nM22r; M22i_s = nM22i;
        }

        // η0_s = n0·cos(θ0) — real (lossless incident)
        const eta0_s = n0 * cosTheta0;
        // etas_s = ns·cos(θ_sub) — possibly complex (TIR)
        const etasS_r = ns * cosSubR, etasS_i = ns * cosSubI;
        // num = η0·M11 + η0·ηs·M12 - M21 - ηs·M22   (each term complex)
        const h0hsM12_r = eta0_s * (etasS_r * M12r_s - etasS_i * M12i_s);
        const h0hsM12_i = eta0_s * (etasS_r * M12i_s + etasS_i * M12r_s);
        const hsM22_r = etasS_r * M22r_s - etasS_i * M22i_s;
        const hsM22_i = etasS_r * M22i_s + etasS_i * M22r_s;
        const numR_s = eta0_s * M11r_s + h0hsM12_r - M21r_s - hsM22_r;
        const numI_s = eta0_s * M11i_s + h0hsM12_i - M21i_s - hsM22_i;
        const denR_s = eta0_s * M11r_s + h0hsM12_r + M21r_s + hsM22_r;
        const denI_s = eta0_s * M11i_s + h0hsM12_i + M21i_s + hsM22_i;
        const denMag_s = denR_s * denR_s + denI_s * denI_s;
        const rR_s = (numR_s * denR_s + numI_s * denI_s) / denMag_s;
        const rI_s = (numI_s * denR_s - numR_s * denI_s) / denMag_s;
        const Rs = rR_s * rR_s + rI_s * rI_s;

        // ─── p-polarization (TM) — η = N/cos(θ) ───
        let M11r_p = 1, M11i_p = 0, M12r_p = 0, M12i_p = 0;
        let M21r_p = 0, M21i_p = 0, M22r_p = 1, M22i_p = 0;

        for (let i = layerStack.length - 1; i >= 0; i--) {
          const [nr, ni, cR, cI] = layerData[i];
          const toolingFactor = toolingFactors[layerStack[i].material] || 1.0;
          const d = layerStack[i].thickness * toolingFactor;
          const factor = (2 * Math.PI * d) / lambda;
          // δ same as s-pol (depends only on N·cos(θ))
          const deltaR = factor * (nr * cR + ni * cI);
          const deltaI = factor * (nr * cI - ni * cR);
          const cdR = Math.cos(deltaR), cdI_sh = Math.sin(deltaR);
          const coshDI = Math.cosh(deltaI), sinhDI = Math.sinh(deltaI);
          const cosDR = cdR * coshDI;
          const cosDI = -cdI_sh * sinhDI;
          const sinDR = cdI_sh * coshDI;
          const sinDI = cdR * sinhDI;
          // η_p = N/cos(θ) = (nr - i·ni)·conj(cos)/|cos|² = (nr - i·ni)(cR - i·cI)/(cR²+cI²)
          const cosMagSq = cR * cR + cI * cI;
          const etaR = (nr * cR - ni * cI) / cosMagSq;
          const etaI = -(nr * cI + ni * cR) / cosMagSq;
          const L11r = cosDR, L11i = cosDI, L22r = cosDR, L22i = cosDI;
          const etaMagSq = etaR * etaR + etaI * etaI;
          const sOverEta_r = (sinDR * etaR + sinDI * etaI) / etaMagSq;
          const sOverEta_i = (sinDI * etaR - sinDR * etaI) / etaMagSq;
          const L12r = -sOverEta_i, L12i = sOverEta_r;
          const etaSin_r = etaR * sinDR - etaI * sinDI;
          const etaSin_i = etaR * sinDI + etaI * sinDR;
          const L21r = -etaSin_i, L21i = etaSin_r;
          const nM11r = M11r_p * L11r - M11i_p * L11i + M12r_p * L21r - M12i_p * L21i;
          const nM11i = M11r_p * L11i + M11i_p * L11r + M12r_p * L21i + M12i_p * L21r;
          const nM12r = M11r_p * L12r - M11i_p * L12i + M12r_p * L22r - M12i_p * L22i;
          const nM12i = M11r_p * L12i + M11i_p * L12r + M12r_p * L22i + M12i_p * L22r;
          const nM21r = M21r_p * L11r - M21i_p * L11i + M22r_p * L21r - M22i_p * L21i;
          const nM21i = M21r_p * L11i + M21i_p * L11r + M22r_p * L21i + M22i_p * L21r;
          const nM22r = M21r_p * L12r - M21i_p * L12i + M22r_p * L22r - M22i_p * L22i;
          const nM22i = M21r_p * L12i + M21i_p * L12r + M22r_p * L22i + M22i_p * L22r;
          M11r_p = nM11r; M11i_p = nM11i; M12r_p = nM12r; M12i_p = nM12i;
          M21r_p = nM21r; M21i_p = nM21i; M22r_p = nM22r; M22i_p = nM22i;
        }

        // η0_p = n0/cos(θ0) — real
        const eta0_p = n0 / cosTheta0;
        // etas_p = ns/cos(θ_sub) — complex if TIR
        const cosSubMagSq_p = cosSubR * cosSubR + cosSubI * cosSubI;
        const etasP_r = (ns * cosSubR) / cosSubMagSq_p;
        const etasP_i = -(ns * cosSubI) / cosSubMagSq_p;
        const h0hsM12_pr = eta0_p * (etasP_r * M12r_p - etasP_i * M12i_p);
        const h0hsM12_pi = eta0_p * (etasP_r * M12i_p + etasP_i * M12r_p);
        const hsM22_pr = etasP_r * M22r_p - etasP_i * M22i_p;
        const hsM22_pi = etasP_r * M22i_p + etasP_i * M22r_p;
        const numR_p = eta0_p * M11r_p + h0hsM12_pr - M21r_p - hsM22_pr;
        const numI_p = eta0_p * M11i_p + h0hsM12_pi - M21i_p - hsM22_pi;
        const denR_p = eta0_p * M11r_p + h0hsM12_pr + M21r_p + hsM22_pr;
        const denI_p = eta0_p * M11i_p + h0hsM12_pi + M21i_p + hsM22_pi;
        const denMag_p = denR_p * denR_p + denI_p * denI_p;
        const rR_p = (numR_p * denR_p + numI_p * denI_p) / denMag_p;
        const rI_p = (numI_p * denR_p - numR_p * denI_p) / denMag_p;
        const Rp = rR_p * rR_p + rI_p * rI_p;

        // Unpolarized = (Rs + Rp) / 2
        const R_avg = (Rs + Rp) / 2;
        if (phaseOut) {
          const phase_s = Math.atan2(rI_s, rR_s) * 180 / Math.PI;
          const phase_p = Math.atan2(rI_p, rR_p) * 180 / Math.PI;
          phaseOut.phase = (phase_s + phase_p) / 2;
        }
        // Davies-Bennett scalar scattering loss (angle-dependent: cosθ factor)
        let Rout2 = R_avg;
        if (surfaceRoughness > 0) {
          const arg = (4 * Math.PI * surfaceRoughness * cosTheta0) / lambda;
          Rout2 = R_avg * Math.exp(-arg * arg);
        }
        return Math.min(Math.max(Rout2, 0), 1);
      } catch (e) {
        if (phaseOut) phaseOut.phase = 0;
        return 0;
      }
    },
    [
      getRefractiveIndex,
      getExtinctionCoefficient,
      incident.n,
      substrate.n,
      layerStacks,
      machines,
      currentStackId,
      surfaceRoughness,
    ]
  );

    const calculateAngleColors = useCallback(
    (layerStack, stackId) => {
      const angles = tierLimits.allowedAngles && tierLimits.allowedAngles.length > 0
        ? [0, 15, 30, 45, 60].filter(a => tierLimits.allowedAngles.includes(a))
        : [0];
      const angleResults = [];

      angles.forEach((angle) => {
        // Calculate reflectivity at this angle across visible spectrum
        const visibleData = [];
        for (let lambda = 380; lambda <= 780; lambda += 5) {
          const R = calculateReflectivityAtWavelength(
            lambda,
            layerStack,
            stackId,
            angle
          );
          visibleData.push({
            wavelength: lambda,
            theoretical: R * 100,
          });
        }

        // Calculate color for this angle using same CIE data
        const CIE_DATA = {
          380: { x: 0.0014, y: 0.0, z: 0.0065, d65: 49.98 },
          385: { x: 0.0022, y: 0.0001, z: 0.0105, d65: 52.31 },
          390: { x: 0.0042, y: 0.0001, z: 0.0201, d65: 54.65 },
          395: { x: 0.0076, y: 0.0002, z: 0.0362, d65: 68.7 },
          400: { x: 0.0143, y: 0.0004, z: 0.0679, d65: 82.75 },
          405: { x: 0.0232, y: 0.0006, z: 0.1102, d65: 87.12 },
          410: { x: 0.0435, y: 0.0012, z: 0.2074, d65: 91.49 },
          415: { x: 0.0776, y: 0.0022, z: 0.3713, d65: 92.46 },
          420: { x: 0.1344, y: 0.004, z: 0.6456, d65: 93.43 },
          425: { x: 0.2148, y: 0.0073, z: 1.0391, d65: 90.06 },
          430: { x: 0.2839, y: 0.0116, z: 1.3856, d65: 86.68 },
          435: { x: 0.3285, y: 0.0168, z: 1.623, d65: 95.77 },
          440: { x: 0.3483, y: 0.023, z: 1.7471, d65: 104.86 },
          445: { x: 0.3481, y: 0.0298, z: 1.7826, d65: 110.94 },
          450: { x: 0.3362, y: 0.038, z: 1.7721, d65: 117.01 },
          455: { x: 0.3187, y: 0.048, z: 1.7441, d65: 117.41 },
          460: { x: 0.2908, y: 0.06, z: 1.6692, d65: 117.81 },
          465: { x: 0.2511, y: 0.0739, z: 1.5281, d65: 116.34 },
          470: { x: 0.1954, y: 0.091, z: 1.2876, d65: 114.86 },
          475: { x: 0.1421, y: 0.1126, z: 1.0419, d65: 115.39 },
          480: { x: 0.0956, y: 0.139, z: 0.813, d65: 115.92 },
          485: { x: 0.058, y: 0.1693, z: 0.6162, d65: 112.37 },
          490: { x: 0.032, y: 0.208, z: 0.4652, d65: 108.81 },
          495: { x: 0.0147, y: 0.2586, z: 0.3533, d65: 109.08 },
          500: { x: 0.0049, y: 0.323, z: 0.272, d65: 109.35 },
          505: { x: 0.0024, y: 0.4073, z: 0.2123, d65: 108.58 },
          510: { x: 0.0093, y: 0.503, z: 0.1582, d65: 107.8 },
          515: { x: 0.0291, y: 0.6082, z: 0.1117, d65: 106.3 },
          520: { x: 0.0633, y: 0.71, z: 0.0782, d65: 104.79 },
          525: { x: 0.1096, y: 0.7932, z: 0.0573, d65: 106.24 },
          530: { x: 0.1655, y: 0.862, z: 0.0422, d65: 107.69 },
          535: { x: 0.2257, y: 0.9149, z: 0.0298, d65: 106.05 },
          540: { x: 0.2904, y: 0.954, z: 0.0203, d65: 104.41 },
          545: { x: 0.3597, y: 0.9803, z: 0.0134, d65: 104.23 },
          550: { x: 0.4334, y: 0.995, z: 0.0087, d65: 104.05 },
          555: { x: 0.5121, y: 1.0, z: 0.0057, d65: 102.02 },
          560: { x: 0.5945, y: 0.995, z: 0.0039, d65: 100.0 },
          565: { x: 0.6784, y: 0.9786, z: 0.0027, d65: 98.17 },
          570: { x: 0.7621, y: 0.952, z: 0.0021, d65: 96.33 },
          575: { x: 0.8425, y: 0.9154, z: 0.0018, d65: 96.06 },
          580: { x: 0.9163, y: 0.87, z: 0.0017, d65: 95.79 },
          585: { x: 0.9786, y: 0.8163, z: 0.0014, d65: 92.24 },
          590: { x: 1.0263, y: 0.757, z: 0.0011, d65: 88.69 },
          595: { x: 1.0567, y: 0.6949, z: 0.001, d65: 89.35 },
          600: { x: 1.0622, y: 0.631, z: 0.0008, d65: 90.01 },
          605: { x: 1.0456, y: 0.5668, z: 0.0006, d65: 89.8 },
          610: { x: 1.0026, y: 0.503, z: 0.0003, d65: 89.6 },
          615: { x: 0.9384, y: 0.4412, z: 0.0002, d65: 88.65 },
          620: { x: 0.8544, y: 0.381, z: 0.0002, d65: 87.7 },
          625: { x: 0.7514, y: 0.321, z: 0.0001, d65: 85.49 },
          630: { x: 0.6424, y: 0.265, z: 0.0, d65: 83.29 },
          635: { x: 0.5419, y: 0.217, z: 0.0, d65: 83.49 },
          640: { x: 0.4479, y: 0.175, z: 0.0, d65: 83.7 },
          645: { x: 0.3608, y: 0.1382, z: 0.0, d65: 81.86 },
          650: { x: 0.2835, y: 0.107, z: 0.0, d65: 80.03 },
          655: { x: 0.2187, y: 0.0816, z: 0.0, d65: 80.12 },
          660: { x: 0.1649, y: 0.061, z: 0.0, d65: 80.21 },
          665: { x: 0.1212, y: 0.0446, z: 0.0, d65: 81.25 },
          670: { x: 0.0874, y: 0.032, z: 0.0, d65: 82.28 },
          675: { x: 0.0636, y: 0.0232, z: 0.0, d65: 80.28 },
          680: { x: 0.0468, y: 0.017, z: 0.0, d65: 78.28 },
          685: { x: 0.0329, y: 0.0119, z: 0.0, d65: 74.0 },
          690: { x: 0.0227, y: 0.0082, z: 0.0, d65: 69.72 },
          695: { x: 0.0158, y: 0.0057, z: 0.0, d65: 70.67 },
          700: { x: 0.0114, y: 0.0041, z: 0.0, d65: 71.61 },
          705: { x: 0.0081, y: 0.0029, z: 0.0, d65: 72.98 },
          710: { x: 0.0058, y: 0.0021, z: 0.0, d65: 74.35 },
          715: { x: 0.0041, y: 0.0015, z: 0.0, d65: 67.98 },
          720: { x: 0.0029, y: 0.001, z: 0.0, d65: 61.6 },
          725: { x: 0.002, y: 0.0007, z: 0.0, d65: 65.74 },
          730: { x: 0.0014, y: 0.0005, z: 0.0, d65: 69.89 },
          735: { x: 0.001, y: 0.0004, z: 0.0, d65: 72.49 },
          740: { x: 0.0007, y: 0.0003, z: 0.0, d65: 75.09 },
          745: { x: 0.0005, y: 0.0002, z: 0.0, d65: 69.34 },
          750: { x: 0.0003, y: 0.0001, z: 0.0, d65: 63.59 },
          755: { x: 0.0002, y: 0.0001, z: 0.0, d65: 55.01 },
          760: { x: 0.0002, y: 0.0001, z: 0.0, d65: 46.42 },
          765: { x: 0.0001, y: 0.0, z: 0.0, d65: 56.61 },
          770: { x: 0.0001, y: 0.0, z: 0.0, d65: 66.81 },
          775: { x: 0.0001, y: 0.0, z: 0.0, d65: 65.09 },
          780: { x: 0.0, y: 0.0, z: 0.0, d65: 63.38 },
        };

        const getCIEData = (lambda) => {
          const lower = Math.floor(lambda / 5) * 5;
          const upper = Math.ceil(lambda / 5) * 5;
          if (lower === upper || !CIE_DATA[lower] || !CIE_DATA[upper]) {
            return (
              CIE_DATA[lower] || CIE_DATA[upper] || { x: 0, y: 0, z: 0, d65: 0 }
            );
          }
          const t = (lambda - lower) / (upper - lower);
          const l = CIE_DATA[lower];
          const u = CIE_DATA[upper];
          return {
            x: l.x + t * (u.x - l.x),
            y: l.y + t * (u.y - l.y),
            z: l.z + t * (u.z - l.z),
            d65: l.d65 + t * (u.d65 - l.d65),
          };
        };

        // Calculate XYZ
        let X = 0,
          Y = 0,
          Z = 0,
          normalization = 0;
        visibleData.forEach((d) => {
          const R = d.theoretical / 100;
          const cie = getCIEData(d.wavelength);
          X += R * cie.d65 * cie.x;
          Y += R * cie.d65 * cie.y;
          Z += R * cie.d65 * cie.z;
          normalization += cie.d65 * cie.y;
        });

        if (normalization === 0) return;
        X = X / normalization;
        Y = Y / normalization;
        Z = Z / normalization;

        // Convert to Lab
        const Xn = 0.95047,
          Yn = 1.0,
          Zn = 1.08883;
        const f = (t) => {
          const delta = 6.0 / 29.0;
          if (t > delta * delta * delta) {
            return Math.pow(t, 1.0 / 3.0);
          } else {
            return t / (3 * delta * delta) + 4.0 / 29.0;
          }
        };

        const fx = f(X / Xn);
        const fy = f(Y / Yn);
        const fz = f(Z / Zn);

        const L = 116 * fy - 16;
        const a = 500 * (fx - fy);
        const b = 200 * (fy - fz);

        // Convert to RGB for display
        let R_linear = X * 3.2406 + Y * -1.5372 + Z * -0.4986;
        let G_linear = X * -0.9689 + Y * 1.8758 + Z * 0.0415;
        let B_linear = X * 0.0557 + Y * -0.204 + Z * 1.057;

        const gammaCorrect = (c) => {
          if (c <= 0.0031308) return 12.92 * c;
          return 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
        };

        R_linear = gammaCorrect(R_linear);
        G_linear = gammaCorrect(G_linear);
        B_linear = gammaCorrect(B_linear);

        const maxRGB = Math.max(R_linear, G_linear, B_linear);
        if (maxRGB > 1) {
          R_linear /= maxRGB;
          G_linear /= maxRGB;
          B_linear /= maxRGB;
        }

        const R_8bit = Math.max(0, Math.min(255, Math.round(R_linear * 255)));
        const G_8bit = Math.max(0, Math.min(255, Math.round(G_linear * 255)));
        const B_8bit = Math.max(0, Math.min(255, Math.round(B_linear * 255)));

        angleResults.push({
          angle: angle,
          L: L,
          a: a,
          b: b,
          rgb: `rgb(${R_8bit}, ${G_8bit}, ${B_8bit})`,
        });
      });

      // Calculate ΔE* from normal incidence (0°) for each angle
      const normalColor = angleResults.find((r) => r.angle === 0);
      if (normalColor) {
        angleResults.forEach((result) => {
          const dL = result.L - normalColor.L;
          const da = result.a - normalColor.a;
          const db = result.b - normalColor.b;
          result.deltaE = Math.sqrt(dL * dL + da * da + db * db);
        });
      }

      return angleResults;
    },
    [calculateReflectivityAtWavelength, tierLimits.allowedAngles]
  );

  const calculateColorInfo = useCallback((visibleData, illuminant = "D65") => {
    if (visibleData.length === 0) return null;

    // Standard Illuminant Spectral Power Distributions (380-780nm, 5nm intervals)
    const ILLUMINANT_SPD = {
      D65: {
        // Daylight 6500K - noon daylight
        380: 49.98,
        385: 52.31,
        390: 54.65,
        395: 68.7,
        400: 82.75,
        405: 87.12,
        410: 91.49,
        415: 92.46,
        420: 93.43,
        425: 90.06,
        430: 86.68,
        435: 95.77,
        440: 104.86,
        445: 110.94,
        450: 117.01,
        455: 117.41,
        460: 117.81,
        465: 116.34,
        470: 114.86,
        475: 115.39,
        480: 115.92,
        485: 112.37,
        490: 108.81,
        495: 109.08,
        500: 109.35,
        505: 108.58,
        510: 107.8,
        515: 106.3,
        520: 104.79,
        525: 106.24,
        530: 107.69,
        535: 106.05,
        540: 104.41,
        545: 104.23,
        550: 104.05,
        555: 102.02,
        560: 100.0,
        565: 98.17,
        570: 96.33,
        575: 96.06,
        580: 95.79,
        585: 92.24,
        590: 88.69,
        595: 89.35,
        600: 90.01,
        605: 89.8,
        610: 89.6,
        615: 88.65,
        620: 87.7,
        625: 85.49,
        630: 83.29,
        635: 83.49,
        640: 83.7,
        645: 81.86,
        650: 80.03,
        655: 80.12,
        660: 80.21,
        665: 81.25,
        670: 82.28,
        675: 80.28,
        680: 78.28,
        685: 74.0,
        690: 69.72,
        695: 70.67,
        700: 71.61,
        705: 72.98,
        710: 74.35,
        715: 67.98,
        720: 61.6,
        725: 65.74,
        730: 69.89,
        735: 72.49,
        740: 75.09,
        745: 69.34,
        750: 63.59,
        755: 55.01,
        760: 46.42,
        765: 56.61,
        770: 66.81,
        775: 65.09,
        780: 63.38,
        whitePoint: { Xn: 0.95047, Yn: 1.0, Zn: 1.08883 },
      },
      D50: {
        // Daylight 5000K - horizon light, used in printing
        380: 24.49,
        385: 27.18,
        390: 29.87,
        395: 39.59,
        400: 49.31,
        405: 52.91,
        410: 56.51,
        415: 58.27,
        420: 60.03,
        425: 58.93,
        430: 57.82,
        435: 66.32,
        440: 74.82,
        445: 81.04,
        450: 87.25,
        455: 88.93,
        460: 90.61,
        465: 90.99,
        470: 91.37,
        475: 93.24,
        480: 95.11,
        485: 93.54,
        490: 91.96,
        495: 93.84,
        500: 95.72,
        505: 96.17,
        510: 96.61,
        515: 96.87,
        520: 97.13,
        525: 99.61,
        530: 102.1,
        535: 101.43,
        540: 100.75,
        545: 101.54,
        550: 102.32,
        555: 101.16,
        560: 100.0,
        565: 98.87,
        570: 97.74,
        575: 98.33,
        580: 98.92,
        585: 96.21,
        590: 93.5,
        595: 95.59,
        600: 97.69,
        605: 98.48,
        610: 99.27,
        615: 99.16,
        620: 99.04,
        625: 97.38,
        630: 95.72,
        635: 97.29,
        640: 98.86,
        645: 97.26,
        650: 95.67,
        655: 96.93,
        660: 98.19,
        665: 100.6,
        670: 103.0,
        675: 101.07,
        680: 99.13,
        685: 93.26,
        690: 87.38,
        695: 89.49,
        700: 91.6,
        705: 92.25,
        710: 92.89,
        715: 84.87,
        720: 76.85,
        725: 81.68,
        730: 86.51,
        735: 89.55,
        740: 92.58,
        745: 85.4,
        750: 78.23,
        755: 67.96,
        760: 57.69,
        765: 70.31,
        770: 82.92,
        775: 80.6,
        780: 78.27,
        whitePoint: { Xn: 0.96422, Yn: 1.0, Zn: 0.82521 },
      },
      A: {
        // Incandescent/tungsten 2856K - warm indoor lighting
        380: 9.8,
        385: 10.9,
        390: 12.09,
        395: 13.35,
        400: 14.71,
        405: 16.15,
        410: 17.68,
        415: 19.29,
        420: 20.99,
        425: 22.79,
        430: 24.67,
        435: 26.64,
        440: 28.7,
        445: 30.85,
        450: 33.09,
        455: 35.41,
        460: 37.81,
        465: 40.3,
        470: 42.87,
        475: 45.52,
        480: 48.24,
        485: 51.04,
        490: 53.91,
        495: 56.85,
        500: 59.86,
        505: 62.93,
        510: 66.06,
        515: 69.25,
        520: 72.5,
        525: 75.79,
        530: 79.13,
        535: 82.52,
        540: 85.95,
        545: 89.41,
        550: 92.91,
        555: 96.44,
        560: 100.0,
        565: 103.58,
        570: 107.18,
        575: 110.8,
        580: 114.44,
        585: 118.08,
        590: 121.73,
        595: 125.39,
        600: 129.04,
        605: 132.7,
        610: 136.35,
        615: 139.99,
        620: 143.62,
        625: 147.24,
        630: 150.84,
        635: 154.42,
        640: 157.98,
        645: 161.52,
        650: 165.03,
        655: 168.51,
        660: 171.96,
        665: 175.38,
        670: 178.77,
        675: 182.12,
        680: 185.43,
        685: 188.7,
        690: 191.93,
        695: 195.12,
        700: 198.26,
        705: 201.36,
        710: 204.41,
        715: 207.41,
        720: 210.36,
        725: 213.27,
        730: 216.12,
        735: 218.92,
        740: 221.67,
        745: 224.36,
        750: 227.0,
        755: 229.59,
        760: 232.12,
        765: 234.59,
        770: 237.01,
        775: 239.37,
        780: 241.68,
        whitePoint: { Xn: 1.0985, Yn: 1.0, Zn: 0.35585 },
      },
      F2: {
        // Cool white fluorescent - typical office lighting
        380: 1.18,
        385: 1.48,
        390: 1.84,
        395: 2.15,
        400: 3.44,
        405: 15.69,
        410: 3.85,
        415: 3.74,
        420: 4.19,
        425: 4.62,
        430: 5.06,
        435: 34.98,
        440: 11.81,
        445: 6.27,
        450: 6.63,
        455: 6.93,
        460: 7.19,
        465: 7.4,
        470: 7.54,
        475: 7.62,
        480: 7.65,
        485: 7.62,
        490: 7.62,
        495: 7.45,
        500: 7.28,
        505: 7.15,
        510: 7.05,
        515: 7.04,
        520: 7.16,
        525: 7.47,
        530: 8.04,
        535: 8.88,
        540: 10.01,
        545: 24.88,
        550: 16.64,
        555: 14.59,
        560: 16.16,
        565: 17.56,
        570: 18.62,
        575: 21.47,
        580: 22.79,
        585: 19.29,
        590: 18.66,
        595: 17.73,
        600: 16.54,
        605: 15.21,
        610: 13.8,
        615: 12.36,
        620: 10.95,
        625: 9.65,
        630: 8.4,
        635: 7.32,
        640: 6.31,
        645: 5.43,
        650: 4.68,
        655: 4.02,
        660: 3.45,
        665: 2.96,
        670: 2.55,
        675: 2.19,
        680: 1.89,
        685: 1.64,
        690: 1.53,
        695: 1.27,
        700: 1.1,
        705: 0.99,
        710: 0.88,
        715: 0.76,
        720: 0.68,
        725: 0.61,
        730: 0.56,
        735: 0.54,
        740: 0.51,
        745: 0.47,
        750: 0.47,
        755: 0.43,
        760: 0.46,
        765: 0.47,
        770: 0.4,
        775: 0.33,
        780: 0.27,
        whitePoint: { Xn: 0.99186, Yn: 1.0, Zn: 0.67393 },
      },
      F11: {
        // Tri-phosphor fluorescent - modern office/retail lighting
        380: 0.91,
        385: 0.63,
        390: 0.46,
        395: 0.37,
        400: 1.29,
        405: 12.68,
        410: 1.59,
        415: 1.79,
        420: 2.46,
        425: 3.33,
        430: 4.49,
        435: 30.78,
        440: 5.29,
        445: 4.72,
        450: 4.56,
        455: 4.47,
        460: 4.4,
        465: 4.35,
        470: 4.32,
        475: 4.3,
        480: 4.3,
        485: 4.31,
        490: 4.34,
        495: 4.41,
        500: 4.51,
        505: 4.67,
        510: 4.89,
        515: 5.2,
        520: 5.63,
        525: 6.24,
        530: 7.07,
        535: 8.21,
        540: 9.77,
        545: 72.35,
        550: 13.4,
        555: 12.55,
        560: 12.72,
        565: 13.04,
        570: 13.44,
        575: 13.88,
        580: 14.36,
        585: 59.66,
        590: 16.75,
        595: 17.43,
        600: 18.0,
        605: 18.37,
        610: 18.49,
        615: 18.33,
        620: 17.89,
        625: 17.22,
        630: 16.36,
        635: 15.37,
        640: 14.29,
        645: 13.18,
        650: 12.07,
        655: 11.0,
        660: 9.98,
        665: 9.02,
        670: 8.12,
        675: 7.3,
        680: 6.55,
        685: 5.86,
        690: 5.23,
        695: 4.67,
        700: 4.16,
        705: 3.72,
        710: 3.25,
        715: 2.83,
        720: 2.49,
        725: 2.19,
        730: 1.94,
        735: 1.72,
        740: 1.52,
        745: 1.35,
        750: 1.2,
        755: 1.06,
        760: 0.94,
        765: 0.84,
        770: 0.74,
        775: 0.66,
        780: 0.58,
        whitePoint: { Xn: 1.00962, Yn: 1.0, Zn: 0.6435 },
      },
    };

    // CIE 1931 2° Standard Observer color matching functions (380-780nm, 5nm intervals)
    const CIE_DATA = {
      380: { x: 0.0014, y: 0.0, z: 0.0065, d65: 49.98 },
      385: { x: 0.0022, y: 0.0001, z: 0.0105, d65: 52.31 },
      390: { x: 0.0042, y: 0.0001, z: 0.0201, d65: 54.65 },
      395: { x: 0.0076, y: 0.0002, z: 0.0362, d65: 68.7 },
      400: { x: 0.0143, y: 0.0004, z: 0.0679, d65: 82.75 },
      405: { x: 0.0232, y: 0.0006, z: 0.1102, d65: 87.12 },
      410: { x: 0.0435, y: 0.0012, z: 0.2074, d65: 91.49 },
      415: { x: 0.0776, y: 0.0022, z: 0.3713, d65: 92.46 },
      420: { x: 0.1344, y: 0.004, z: 0.6456, d65: 93.43 },
      425: { x: 0.2148, y: 0.0073, z: 1.0391, d65: 90.06 },
      430: { x: 0.2839, y: 0.0116, z: 1.3856, d65: 86.68 },
      435: { x: 0.3285, y: 0.0168, z: 1.623, d65: 95.77 },
      440: { x: 0.3483, y: 0.023, z: 1.7471, d65: 104.86 },
      445: { x: 0.3481, y: 0.0298, z: 1.7826, d65: 110.94 },
      450: { x: 0.3362, y: 0.038, z: 1.7721, d65: 117.01 },
      455: { x: 0.3187, y: 0.048, z: 1.7441, d65: 117.41 },
      460: { x: 0.2908, y: 0.06, z: 1.6692, d65: 117.81 },
      465: { x: 0.2511, y: 0.0739, z: 1.5281, d65: 116.34 },
      470: { x: 0.1954, y: 0.091, z: 1.2876, d65: 114.86 },
      475: { x: 0.1421, y: 0.1126, z: 1.0419, d65: 115.39 },
      480: { x: 0.0956, y: 0.139, z: 0.813, d65: 115.92 },
      485: { x: 0.058, y: 0.1693, z: 0.6162, d65: 112.37 },
      490: { x: 0.032, y: 0.208, z: 0.4652, d65: 108.81 },
      495: { x: 0.0147, y: 0.2586, z: 0.3533, d65: 109.08 },
      500: { x: 0.0049, y: 0.323, z: 0.272, d65: 109.35 },
      505: { x: 0.0024, y: 0.4073, z: 0.2123, d65: 108.58 },
      510: { x: 0.0093, y: 0.503, z: 0.1582, d65: 107.8 },
      515: { x: 0.0291, y: 0.6082, z: 0.1117, d65: 106.3 },
      520: { x: 0.0633, y: 0.71, z: 0.0782, d65: 104.79 },
      525: { x: 0.1096, y: 0.7932, z: 0.0573, d65: 106.24 },
      530: { x: 0.1655, y: 0.862, z: 0.0422, d65: 107.69 },
      535: { x: 0.2257, y: 0.9149, z: 0.0298, d65: 106.05 },
      540: { x: 0.2904, y: 0.954, z: 0.0203, d65: 104.41 },
      545: { x: 0.3597, y: 0.9803, z: 0.0134, d65: 104.23 },
      550: { x: 0.4334, y: 0.995, z: 0.0087, d65: 104.05 },
      555: { x: 0.5121, y: 1.0, z: 0.0057, d65: 102.02 },
      560: { x: 0.5945, y: 0.995, z: 0.0039, d65: 100.0 },
      565: { x: 0.6784, y: 0.9786, z: 0.0027, d65: 98.17 },
      570: { x: 0.7621, y: 0.952, z: 0.0021, d65: 96.33 },
      575: { x: 0.8425, y: 0.9154, z: 0.0018, d65: 96.06 },
      580: { x: 0.9163, y: 0.87, z: 0.0017, d65: 95.79 },
      585: { x: 0.9786, y: 0.8163, z: 0.0014, d65: 92.24 },
      590: { x: 1.0263, y: 0.757, z: 0.0011, d65: 88.69 },
      595: { x: 1.0567, y: 0.6949, z: 0.001, d65: 89.35 },
      600: { x: 1.0622, y: 0.631, z: 0.0008, d65: 90.01 },
      605: { x: 1.0456, y: 0.5668, z: 0.0006, d65: 89.8 },
      610: { x: 1.0026, y: 0.503, z: 0.0003, d65: 89.6 },
      615: { x: 0.9384, y: 0.4412, z: 0.0002, d65: 88.65 },
      620: { x: 0.8544, y: 0.381, z: 0.0002, d65: 87.7 },
      625: { x: 0.7514, y: 0.321, z: 0.0001, d65: 85.49 },
      630: { x: 0.6424, y: 0.265, z: 0.0, d65: 83.29 },
      635: { x: 0.5419, y: 0.217, z: 0.0, d65: 83.49 },
      640: { x: 0.4479, y: 0.175, z: 0.0, d65: 83.7 },
      645: { x: 0.3608, y: 0.1382, z: 0.0, d65: 81.86 },
      650: { x: 0.2835, y: 0.107, z: 0.0, d65: 80.03 },
      655: { x: 0.2187, y: 0.0816, z: 0.0, d65: 80.12 },
      660: { x: 0.1649, y: 0.061, z: 0.0, d65: 80.21 },
      665: { x: 0.1212, y: 0.0446, z: 0.0, d65: 81.25 },
      670: { x: 0.0874, y: 0.032, z: 0.0, d65: 82.28 },
      675: { x: 0.0636, y: 0.0232, z: 0.0, d65: 80.28 },
      680: { x: 0.0468, y: 0.017, z: 0.0, d65: 78.28 },
      685: { x: 0.0329, y: 0.0119, z: 0.0, d65: 74.0 },
      690: { x: 0.0227, y: 0.0082, z: 0.0, d65: 69.72 },
      695: { x: 0.0158, y: 0.0057, z: 0.0, d65: 70.67 },
      700: { x: 0.0114, y: 0.0041, z: 0.0, d65: 71.61 },
      705: { x: 0.0081, y: 0.0029, z: 0.0, d65: 72.98 },
      710: { x: 0.0058, y: 0.0021, z: 0.0, d65: 74.35 },
      715: { x: 0.0041, y: 0.0015, z: 0.0, d65: 67.98 },
      720: { x: 0.0029, y: 0.001, z: 0.0, d65: 61.6 },
      725: { x: 0.002, y: 0.0007, z: 0.0, d65: 65.74 },
      730: { x: 0.0014, y: 0.0005, z: 0.0, d65: 69.89 },
      735: { x: 0.001, y: 0.0004, z: 0.0, d65: 72.49 },
      740: { x: 0.0007, y: 0.0003, z: 0.0, d65: 75.09 },
      745: { x: 0.0005, y: 0.0002, z: 0.0, d65: 69.34 },
      750: { x: 0.0003, y: 0.0001, z: 0.0, d65: 63.59 },
      755: { x: 0.0002, y: 0.0001, z: 0.0, d65: 55.01 },
      760: { x: 0.0002, y: 0.0001, z: 0.0, d65: 46.42 },
      765: { x: 0.0001, y: 0.0, z: 0.0, d65: 56.61 },
      770: { x: 0.0001, y: 0.0, z: 0.0, d65: 66.81 },
      775: { x: 0.0001, y: 0.0, z: 0.0, d65: 65.09 },
      780: { x: 0.0, y: 0.0, z: 0.0, d65: 63.38 },
    };

    // Interpolate CIE data for any wavelength
    const getCIEData = (lambda) => {
      const lower = Math.floor(lambda / 5) * 5;
      const upper = Math.ceil(lambda / 5) * 5;
      if (lower === upper || !CIE_DATA[lower] || !CIE_DATA[upper]) {
        return (
          CIE_DATA[lower] || CIE_DATA[upper] || { x: 0, y: 0, z: 0, d65: 0 }
        );
      }
      const t = (lambda - lower) / (upper - lower);
      const l = CIE_DATA[lower];
      const u = CIE_DATA[upper];
      return {
        x: l.x + t * (u.x - l.x),
        y: l.y + t * (u.y - l.y),
        z: l.z + t * (u.z - l.z),
        d65: l.d65 + t * (u.d65 - l.d65),
      };
    };

    // Calculate tristimulus values XYZ
    let X = 0,
      Y = 0,
      Z = 0,
      normalization = 0;

    visibleData.forEach((d) => {
      const R = d.theoretical / 100; // Reflectance as fraction
      const cie = getCIEData(d.wavelength);

      // Get illuminant SPD value for this wavelength
      const illumData = ILLUMINANT_SPD[illuminant] || ILLUMINANT_SPD.D65;
      const spd =
        illumData[Math.round(d.wavelength / 5) * 5] || illumData[560] || 100;

      X += R * spd * cie.x;
      Y += R * spd * cie.y;
      Z += R * spd * cie.z;
      normalization += spd * cie.y;
    });

    // Normalize by D65 illuminant
    if (normalization === 0) return null;
    X = X / normalization;
    Y = Y / normalization;
    Z = Z / normalization;

    // Convert XYZ to Lab using illuminant-specific white point
    const illumData = ILLUMINANT_SPD[illuminant] || ILLUMINANT_SPD.D65;
    const { Xn, Yn, Zn } = illumData.whitePoint;

    const f = (t) => {
      const delta = 6.0 / 29.0;
      if (t > delta * delta * delta) {
        return Math.pow(t, 1.0 / 3.0);
      } else {
        return t / (3 * delta * delta) + 4.0 / 29.0;
      }
    };

    const fx = f(X / Xn);
    const fy = f(Y / Yn);
    const fz = f(Z / Zn);

    const L = 116 * fy - 16; // Lightness (0-100)
    const a = 500 * (fx - fy); // Green (-) to Red (+)
    const b = 200 * (fy - fz); // Blue (-) to Yellow (+)

    // Convert Lab to LCh (cylindrical coordinates)
    const C = Math.sqrt(a * a + b * b); // Chroma (color saturation)
    let h = (Math.atan2(b, a) * 180) / Math.PI; // Hue angle
    if (h < 0) h += 360;

    // Convert XYZ to sRGB for display
    let R_linear = X * 3.2406 + Y * -1.5372 + Z * -0.4986;
    let G_linear = X * -0.9689 + Y * 1.8758 + Z * 0.0415;
    let B_linear = X * 0.0557 + Y * -0.204 + Z * 1.057;

    // sRGB gamma correction
    const gammaCorrect = (c) => {
      if (c <= 0.0031308) return 12.92 * c;
      return 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
    };

    R_linear = gammaCorrect(R_linear);
    G_linear = gammaCorrect(G_linear);
    B_linear = gammaCorrect(B_linear);

    // Normalize to valid RGB range
    const maxRGB = Math.max(R_linear, G_linear, B_linear);
    if (maxRGB > 1) {
      R_linear /= maxRGB;
      G_linear /= maxRGB;
      B_linear /= maxRGB;
    }

    const R_8bit = Math.max(0, Math.min(255, Math.round(R_linear * 255)));
    const G_8bit = Math.max(0, Math.min(255, Math.round(G_linear * 255)));
    const B_8bit = Math.max(0, Math.min(255, Math.round(B_linear * 255)));

    // Calculate dominant wavelength
    let maxReflectivity = 0;
    let dominantWavelength = 0;
    visibleData.forEach((d) => {
      if (d.theoretical > maxReflectivity) {
        maxReflectivity = d.theoretical;
        dominantWavelength = d.wavelength;
      }
    });

    // Color name from hue angle (LCh)
    let colorName = "Neutral/Achromatic";
    if (C > 10) {
      // Only name if color has sufficient chroma
      if (h >= 0 && h < 30) colorName = "Red";
      else if (h < 60) colorName = "Orange";
      else if (h < 90) colorName = "Yellow";
      else if (h < 150) colorName = "Yellow-Green";
      else if (h < 210) colorName = "Green-Cyan";
      else if (h < 270) colorName = "Cyan-Blue";
      else if (h < 330) colorName = "Blue-Magenta";
      else colorName = "Magenta-Red";
    }

    const avgReflectivity = (
      visibleData.reduce((sum, d) => sum + d.theoretical, 0) /
      visibleData.length
    ).toFixed(1);

    return {
      rgb: `rgb(${R_8bit}, ${G_8bit}, ${B_8bit})`,
      hex: `#${R_8bit.toString(16).padStart(2, "0")}${G_8bit.toString(
        16
      ).padStart(2, "0")}${B_8bit.toString(16).padStart(2, "0")}`,
      dominantWavelength,
      colorName,
      avgReflectivity,
      // CIE XYZ
      X: X.toFixed(4),
      Y: Y.toFixed(4),
      Z: Z.toFixed(4),
      // CIE Lab
      L: L.toFixed(1),
      a_star: a.toFixed(1),
      b_star: b.toFixed(1),
      // LCh
      L_lch: L.toFixed(1),
      C: C.toFixed(1),
      h: h.toFixed(1),
      // Spectral data for visualization
      spectralData: visibleData.map((d) => ({
        wavelength: d.wavelength,
        reflectivity: d.theoretical,
      })),
    };
  }, []);

  const calculateStackColorDeltaE = useCallback(
    (layerStack, stackId, targetL, targetA, targetB, angle = 0) => {
      // Calculate reflectivity across visible spectrum
      const visibleData = [];
      for (let lambda = 380; lambda <= 780; lambda += 5) {
        const R = calculateReflectivityAtWavelength(lambda, layerStack, stackId, angle) * 100;
        visibleData.push({ wavelength: lambda, theoretical: R });
      }

      // Get color info using existing function
      const colorInfo = calculateColorInfo(visibleData, selectedIlluminant);
      
      if (!colorInfo) {
        return { deltaE: 999, L: 0, a: 0, b: 0, rgb: '#808080', hex: '#808080' };
      }

      // Calculate ΔE* (CIE76 formula)
      const L = parseFloat(colorInfo.L);
      const a = parseFloat(colorInfo.a_star);
      const b = parseFloat(colorInfo.b_star);
      
      const dL = L - targetL;
      const da = a - targetA;
      const db = b - targetB;
      const deltaE = Math.sqrt(dL * dL + da * da + db * db);

      return {
        deltaE: deltaE,
        L: L,
        a: a,
        b: b,
        rgb: colorInfo.rgb,
        hex: colorInfo.hex
      };
    },
    [calculateReflectivityAtWavelength, calculateColorInfo, selectedIlluminant]
  );

  const calculateReflectedColor = useCallback(
    (data) => {
      const visibleData = data.filter(
        (d) => d.wavelength >= 380 && d.wavelength <= 780
      );

      if (visibleData.length === 0) {
        setColorData(null);
        return;
      }

      const colorInfo = calculateColorInfo(visibleData, selectedIlluminant);
      setColorData(colorInfo);
    },
    [calculateColorInfo, selectedIlluminant]
  );

  const generateOptimizationSuggestions = useCallback((combinedData) => {
    const newSuggestions = [];
    let sumSquaredError = 0,
      count = 0;

    combinedData.forEach((d) => {
      if (d.experimental !== undefined) {
        sumSquaredError += Math.pow(d.theoretical - d.experimental, 2);
        count++;
      }
    });

    if (count > 0) {
      const rmsError = Math.sqrt(sumSquaredError / count);
      newSuggestions.push({ message: `RMS Error: ${rmsError.toFixed(2)}%` });
    }
    setSuggestions(newSuggestions);
  }, []);

  const calculateCoatingStress = useCallback(() => {
    if (!layers || layers.length === 0) {
      setStressResults(null);
      return;
    }

    const stressData = [];
    let cumulativeStress = 0;

    layers.forEach((layer, idx) => {
      const materialData = allMaterials[layer.material];
      const intrinsicStress = materialData?.stress || 0; // MPa
      const thickness = layer.thickness; // nm

      // Stress force = intrinsic stress × thickness (MPa·nm)
      const stressForce = intrinsicStress * thickness;
      cumulativeStress += stressForce;

      stressData.push({
        layerNum: idx + 1,
        material: layer.material,
        thickness: thickness,
        intrinsicStress: intrinsicStress,
        stressForce: stressForce,
        cumulativeStress: cumulativeStress,
        stressType:
          intrinsicStress > 0
            ? "Compressive"
            : intrinsicStress < 0
            ? "Tensile"
            : "Neutral",
      });
    });

    // Calculate total optical thickness for additional context
    const totalOpticalThickness = layers.reduce((sum, layer) => {
      const n = getRefractiveIndex(layer.material, 550, null, layer.packingDensity || 1.0); // Reference at 550nm
      return sum + n * layer.thickness;
    }, 0);

    // Assess risk level
    const totalStress = Math.abs(cumulativeStress);
    let riskLevel, riskColor, recommendation;

    if (totalStress < 50000) {
      // < 50 MPa·µm
      riskLevel = "LOW";
      riskColor = "#10b981"; // green
      recommendation = "Safe for production. No annealing required.";
    } else if (totalStress < 150000) {
      // 50-150 MPa·µm
      riskLevel = "MEDIUM";
      riskColor = "#f59e0b"; // amber
      recommendation =
        "Monitor adhesion in production. Consider post-deposition annealing at 150°C for 2 hours to reduce stress.";
    } else {
      // > 150 MPa·µm
      riskLevel = "HIGH";
      riskColor = "#ef4444"; // red
      recommendation =
        "High risk of delamination. REDESIGN RECOMMENDED: Balance high-stress materials with low-stress materials, reduce layer thicknesses, or use annealing at 150-200°C.";
    }

    setStressResults({
      layers: stressData,
      totalStress: cumulativeStress,
      totalStressMagnitude: totalStress,
      totalPhysicalThickness: layers.reduce((sum, l) => sum + l.thickness, 0),
      totalOpticalThickness: totalOpticalThickness,
      riskLevel: riskLevel,
      riskColor: riskColor,
      recommendation: recommendation,
    });
  }, [layers, getRefractiveIndex]);

  const calculateReflectivity = useCallback(() => {
    try {
      // If no stacks with layers exist, clear all chart data and return
      const stacksWithLayers = layerStacks.filter(s => s.visible && s.layers.length > 0);
      if (stacksWithLayers.length === 0) {
        setReflectivityData([]);
        setStackColorData({});
        return;
      }

      const { min, max, step } = wavelengthRange;
      const data = [];

      const anglesToCalculate = [
        { key: "angle_0", value: 0, enabled: showAngles.angle_0 },
        { key: "angle_15", value: 15, enabled: showAngles.angle_15 },
        { key: "angle_30", value: 30, enabled: showAngles.angle_30 },
        { key: "angle_45", value: 45, enabled: showAngles.angle_45 },
        { key: "angle_60", value: 60, enabled: showAngles.angle_60 },
      ];

      for (let lambda = min; lambda <= max; lambda += step) {
        const dataPoint = { wavelength: lambda };

        // Calculate for all visible layer stacks (skip empty stacks — bare substrate reflection is not useful)
        layerStacks.forEach((stack) => {
          if (stack.visible && stack.layers.length > 0) {
            // Calculate for each enabled angle
            anglesToCalculate.forEach((angleData) => {
              if (
                angleData.enabled ||
                (angleData.value === 0 && stack.id === currentStackId)
              ) {
                const phaseOut = showPhase ? {} : null;
                let R = calculateReflectivityAtWavelength(
                  lambda,
                  stack.layers,
                  stack.id,
                  angleData.value,
                  phaseOut
                );

                // Apply double-sided correction if enabled (for measurements without black backing)
                // Total reflection = front surface + transmitted light × back surface × transmitted back
                // For symmetric coating: R_total = R + (1-R)² × R
                if (doubleSidedAR) {
                  R = applyBackSurfaceCorrection(R, substrate.n);
                }

                const key =
                  angleData.value === 0
                    ? `stack_${stack.id}`
                    : `stack_${stack.id}_${angleData.key}`;
                dataPoint[key] = R * 100;

                if (phaseOut) {
                  const phaseKey = angleData.value === 0
                    ? `stack_${stack.id}_phase`
                    : `stack_${stack.id}_${angleData.key}_phase`;
                  dataPoint[phaseKey] = phaseOut.phase;
                }

                const T_key =
                  angleData.value === 0
                    ? `stack_${stack.id}_transmission`
                    : `stack_${stack.id}_${angleData.key}_transmission`;
                
                // Calculate absorption from k-values
                let totalAbsorption = 0;
                let remainingIntensity = 1 - R; // Light that enters the coating
                stack.layers.forEach((layer) => {
                  const k = getExtinctionCoefficient(layer.material, lambda);
                  if (k > 0) {
                    // Beer-Lambert: I = I0 * exp(-4πkd/λ)
                    const alpha = (4 * Math.PI * k * layer.thickness) / lambda;
                    const layerAbsorption = remainingIntensity * (1 - Math.exp(-alpha));
                    totalAbsorption += layerAbsorption;
                    remainingIntensity -= layerAbsorption;
                  }
                });
                
                const T = (1 - R) - totalAbsorption; // Transmission = what enters minus what's absorbed
                dataPoint[T_key] = Math.max(0, T * 100);
                
                const A_key =
                  angleData.value === 0
                    ? `stack_${stack.id}_absorption`
                    : `stack_${stack.id}_${angleData.key}_absorption`;
                dataPoint[A_key] = totalAbsorption * 100;
              }
            });
          }
        });

        // Add experimental data if available
        if (experimentalData) {
          const expPoint = experimentalData.find(
            (d) => Math.abs(d.wavelength - lambda) < step * 2
          );
          if (expPoint) {
            dataPoint.experimental = expPoint.reflectivity;
            dataPoint.experimental_transmission = 100 - expPoint.reflectivity;
          }
        }

        data.push(dataPoint);
      }

      setReflectivityData(data);

      // Calculate reflected color for current stack only (for backward compatibility)
      const currentStackData = data.map((d) => ({
        wavelength: d.wavelength,
        theoretical: d[`stack_${currentStackId}`] || 0,
      }));
      calculateReflectedColor(currentStackData);

      // Calculate angle-dependent color for current stack
      if (currentStackId) {
        const currentStack = layerStacks.find((s) => s.id === currentStackId);
        if (currentStack && currentStack.visible) {
          const angleColors = calculateAngleColors(
            currentStack.layers,
            currentStackId
          );
          setAngleColorData(angleColors);
        }
      }

      // Calculate color data for ALL visible stacks (skip empty stacks)
      const newStackColorData = {};
      layerStacks.forEach((stack) => {
        if (stack.visible && stack.layers.length > 0) {
          const stackData = data.map((d) => ({
            wavelength: d.wavelength,
            theoretical: d[`stack_${stack.id}`] || 0,
          }));
          // Calculate color for this stack
          const visibleData = stackData.filter(
            (d) => d.wavelength >= 380 && d.wavelength <= 780
          );
          if (visibleData.length > 0) {
            const colorInfo = calculateColorInfo(
              visibleData,
              selectedIlluminant
            );
            if (colorInfo) {
              newStackColorData[stack.id] = {
                ...colorInfo,
                stackName: getStackDisplayName(stack),
                stackColor: stack.color,
              };
            }
          }
        }
      });
      setStackColorData(newStackColorData);

      // Calculate color data for experimental data if available
      if (experimentalData) {
        const expData = data
          .map((d) => ({
            wavelength: d.wavelength,
            theoretical: d.experimental || 0,
          }))
          .filter((d) => d.theoretical > 0);

        const visibleExpData = expData.filter(
          (d) => d.wavelength >= 380 && d.wavelength <= 780
        );
        if (visibleExpData.length > 0) {
          const expColorInfo = calculateColorInfo(
            visibleExpData,
            selectedIlluminant
          );
          setExperimentalColorData(expColorInfo);
        } else {
          setExperimentalColorData(null);
        }
      } else {
        setExperimentalColorData(null);
      }

      // Only auto-adjust Y-axis if Auto mode is enabled
      if (autoYAxis && data.length > 0) {
        const allValues = [];
        const dataKey = displayMode === "transmission" ? "_transmission" : "";

        data.forEach((d) => {
          layerStacks.forEach((stack) => {
            if (stack.visible) {
              const key = `stack_${stack.id}${dataKey}`;
              if (d[key] !== undefined) {
                allValues.push(d[key]);
              }
            }
          });
          if (displayMode === "transmission" && d.experimental_transmission) {
            allValues.push(d.experimental_transmission);
          } else if (displayMode === "reflectivity" && d.experimental) {
            allValues.push(d.experimental);
          }
        });

        if (allValues.length > 0) {
          const minVal = Math.min(...allValues);
          const maxVal = Math.max(...allValues);
          const padding = (maxVal - minVal) * 0.1;
          setReflectivityRange({
            min: Math.max(0, Math.floor(minVal - padding)),
            max: Math.ceil(maxVal + padding),
          });
        }
      }

      if (experimentalData) generateOptimizationSuggestions(data);
    } catch (e) {
      console.error("Calculation error:", e);
    }
  }, [
    wavelengthRange,
    layerStacks,
    calculateReflectivityAtWavelength,
    getExtinctionCoefficient,
    experimentalData,
    autoYAxis,
    currentStackId,
    calculateReflectedColor,
    generateOptimizationSuggestions,
    displayMode,
    calculateColorInfo,
    showAngles,
    doubleSidedAR,
    showPhase
  ]);

  // ========== ADMITTANCE DIAGRAM CALCULATION ==========
  const calculateAdmittanceLoci = useCallback(() => {
    if (displayMode !== "admittance") return;

    const stack = layerStacks.find((s) => s.id === currentStackId);
    if (!stack || !stack.layers || stack.layers.length === 0) { setAdmittanceData([]); return; }

    const layerStack = stack.layers;
    const machine = machines.find((m) => m.id === stack.machineId);
    const toolingFactors = machine?.toolingFactors || {};
    const nsR = substrate.n;
    const stepsPerLayer = 15;

    const allLoci = admittanceWavelengths.map((lambda, wIdx) => {
      const locusColor = admittanceColors[wIdx % admittanceColors.length];
      const points = [];
      let Yr = nsR, Yi = 0;
      points.push({ re: Yr, im: Yi, layerIndex: -1, t: 0, label: "Substrate", isBoundary: true, material: "Substrate", locusColor });

      for (let i = layerStack.length - 1; i >= 0; i--) {
        const layer = layerStack[i];
        const nr = getRefractiveIndex(layer.material, lambda, layer.iad, layer.packingDensity || 1.0);
        const ni = getExtinctionCoefficient(layer.material, lambda);
        const tf = toolingFactors[layer.material] || 1.0;
        const d = (layer.thickness || 0) * tf;
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

          // sin(d) * Ystart
          const sinYr = sinDr * YstartR - sinDi * YstartI;
          const sinYi = sinDr * YstartI + sinDi * YstartR;
          // / eta
          const etaMag2 = etaR * etaR + etaI * etaI;
          const sYeR = (sinYr * etaR + sinYi * etaI) / etaMag2;
          const sYeI = (sinYi * etaR - sinYr * etaI) / etaMag2;
          // * i
          const Br = cosDr - sYeI, Bi = cosDi + sYeR;

          // eta * sin(d)
          const eSr = etaR * sinDr - etaI * sinDi;
          const eSi = etaR * sinDi + etaI * sinDr;
          // * i
          const ieSr = -eSi, ieSi = eSr;
          // cos(d) * Ystart
          const cYr = cosDr * YstartR - cosDi * YstartI;
          const cYi = cosDr * YstartI + cosDi * YstartR;
          const Cr = ieSr + cYr, Ci = ieSi + cYi;

          // Y = C / B
          const Bmag2 = Br * Br + Bi * Bi;
          const YnR = (Cr * Br + Ci * Bi) / Bmag2;
          const YnI = (Ci * Br - Cr * Bi) / Bmag2;

          const isEnd = step === stepsPerLayer;
          points.push({ re: YnR, im: YnI, layerIndex: layerStack.length - 1 - i, t: frac, label: isEnd ? layer.material : null, isBoundary: isEnd, material: layer.material, locusColor });
          if (isEnd) { Yr = YnR; Yi = YnI; }
        }
      }
      return { wavelength: lambda, color: locusColor, points };
    });

    setAdmittanceData(allLoci);
  }, [displayMode, layerStacks, currentStackId, machines, substrate, admittanceWavelengths, getRefractiveIndex, getExtinctionCoefficient]);

  // Stable shape callback for admittance scatter points — avoids recreating
  // inline functions on every render which forces Recharts to re-evaluate all points.
  const admittanceShapeFn = useCallback((props) => {
    const { cx, cy, payload } = props;
    if (!cx || !cy) return null;
    if (payload.layerIndex === -1) {
      return <rect x={cx - 4} y={cy - 4} width={8} height={8} fill={payload.locusColor} stroke="#fff" strokeWidth={1} transform={`rotate(45, ${cx}, ${cy})`} />;
    }
    if (payload.isBoundary) {
      return <circle cx={cx} cy={cy} r={4} fill={allMaterials[payload.material]?.color || payload.locusColor} stroke={payload.locusColor} strokeWidth={2} />;
    }
    return null;
  }, [allMaterials]);

  // Stable tooltip content callback for admittance chart
  const admittanceTooltipContent = useCallback(({ payload }) => {
    if (payload && payload.length > 0) {
      const d = payload[0].payload;
      return (
        <div className="bg-white border rounded p-2 text-xs shadow">
          <div className="font-semibold">{d.material || "Substrate"}</div>
          <div>Re(Y): {d.re?.toFixed(4)}</div>
          <div>Im(Y): {d.im?.toFixed(4)}</div>
          {d.t !== undefined && d.layerIndex >= 0 && <div>Layer progress: {(d.t * 100).toFixed(0)}%</div>}
        </div>
      );
    }
    return null;
  }, []);

  // ========== E-FIELD DISTRIBUTION CALCULATION ==========
  const calculateEfieldDistribution = useCallback(() => {
    if (displayMode !== "efield") return;

    const stack = layerStacks.find((s) => s.id === currentStackId);
    if (!stack || !stack.layers || stack.layers.length === 0) {
      setEfieldData({ lines: [], layers: [] });
      return;
    }

    const layerStack = stack.layers;
    const machine = machines.find((m) => m.id === stack.machineId);
    const toolingFactors = machine?.toolingFactors || {};
    const n0 = incident.n;
    const ns = substrate.n;
    const stepsPerLayer = 40;

    // Build layer regions for ReferenceArea
    const layerRegions = [];
    let depthAccum = 0;
    for (let i = layerStack.length - 1; i >= 0; i--) {
      const layer = layerStack[i];
      const tf = toolingFactors[layer.material] || 1.0;
      const d = (layer.thickness || 0) * tf;
      const matColor = allMaterials[layer.material]?.color || "#888";
      layerRegions.push({ x1: depthAccum, x2: depthAccum + d, material: layer.material, color: matColor });
      depthAccum += d;
    }

    // Unified depth grid (same for all wavelengths)
    const depthPoints = [];
    let zAccum = 0;
    depthPoints.push({ depth: 0, material: "Substrate" });
    for (let i = layerStack.length - 1; i >= 0; i--) {
      const layer = layerStack[i];
      const tf = toolingFactors[layer.material] || 1.0;
      const d = (layer.thickness || 0) * tf;
      for (let step = 1; step <= stepsPerLayer; step++) {
        const frac = step / stepsPerLayer;
        depthPoints.push({ depth: zAccum + frac * d, material: layer.material });
      }
      zAccum += d;
    }

    const allLines = efieldWavelengths.map((lambda, wIdx) => {
      // === Pass 1: Full transfer matrix to get transmission amplitude t ===
      let M11r = 1, M11i = 0, M12r = 0, M12i = 0;
      let M21r = 0, M21i = 0, M22r = 1, M22i = 0;

      for (let i = layerStack.length - 1; i >= 0; i--) {
        const nr = getRefractiveIndex(layerStack[i].material, lambda, layerStack[i].iad, layerStack[i].packingDensity || 1.0);
        const ni = getExtinctionCoefficient(layerStack[i].material, lambda);
        const tf = toolingFactors[layerStack[i].material] || 1.0;
        const d = (layerStack[i].thickness || 0) * tf;

        const delta0 = (2 * Math.PI * d) / lambda;
        const deltaR = delta0 * nr;
        const deltaI = delta0 * ni;

        const cosA = Math.cos(deltaR), sinA = Math.sin(deltaR);
        const coshB = Math.cosh(deltaI), sinhB = Math.sinh(deltaI);
        const cosDr = cosA * coshB, cosDi = sinA * sinhB;
        const sinDr = sinA * coshB, sinDi = -cosA * sinhB;

        const L11r = cosDr, L11i = cosDi;
        const L22r = cosDr, L22i = cosDi;

        const nMagSq = nr * nr + ni * ni;
        const sinOverN_r = (sinDr * nr + sinDi * ni) / nMagSq;
        const sinOverN_i = (sinDi * nr - sinDr * ni) / nMagSq;
        const L12r = -sinOverN_i, L12i = sinOverN_r;

        const NsinD_r = nr * sinDr + ni * sinDi;
        const NsinD_i = nr * sinDi - ni * sinDr;
        const L21r = -NsinD_i, L21i = NsinD_r;

        const newM11r = M11r * L11r - M11i * L11i + M12r * L21r - M12i * L21i;
        const newM11i = M11r * L11i + M11i * L11r + M12r * L21i + M12i * L21r;
        const newM12r = M11r * L12r - M11i * L12i + M12r * L22r - M12i * L22i;
        const newM12i = M11r * L12i + M11i * L12r + M12r * L22i + M12i * L22r;
        const newM21r = M21r * L11r - M21i * L11i + M22r * L21r - M22i * L21i;
        const newM21i = M21r * L11i + M21i * L11r + M22r * L21i + M22i * L21r;
        const newM22r = M21r * L12r - M21i * L12i + M22r * L22r - M22i * L22i;
        const newM22i = M21r * L12i + M21i * L12r + M22r * L22i + M22i * L22r;

        M11r = newM11r; M11i = newM11i;
        M12r = newM12r; M12i = newM12i;
        M21r = newM21r; M21i = newM21i;
        M22r = newM22r; M22i = newM22i;
      }

      // B_full = M11 + ns * M12, C_full = M21 + ns * M22
      const Br = M11r + ns * M12r, Bi = M11i + ns * M12i;
      const Cr = M21r + ns * M22r, Ci = M21i + ns * M22i;

      // t = 2*n0 / (n0*B + C)
      const denR = n0 * Br + Cr, denI = n0 * Bi + Ci;
      const denMag2 = denR * denR + denI * denI;
      const tR = (2 * n0 * denR) / denMag2;
      const tI = -(2 * n0 * denI) / denMag2;
      const tMag2 = tR * tR + tI * tI;

      // === Pass 2: Trace E-field from substrate outward ===
      // Partial transfer matrix, built layer by layer
      let P11r = 1, P11i = 0, P12r = 0, P12i = 0;
      let P21r = 0, P21i = 0, P22r = 1, P22i = 0;

      const intensities = [];
      // At z=0 (substrate interface): B(0) = P11 + ns*P12 = 1 + 0 = 1
      const B0r = 1, B0i = 0;
      intensities.push((B0r * B0r + B0i * B0i) * tMag2);

      for (let i = layerStack.length - 1; i >= 0; i--) {
        const nr = getRefractiveIndex(layerStack[i].material, lambda, layerStack[i].iad, layerStack[i].packingDensity || 1.0);
        const ni = getExtinctionCoefficient(layerStack[i].material, lambda);
        const tf = toolingFactors[layerStack[i].material] || 1.0;
        const d = (layerStack[i].thickness || 0) * tf;

        const delta0 = (2 * Math.PI * d) / lambda;

        for (let step = 1; step <= stepsPerLayer; step++) {
          const frac = step / stepsPerLayer;
          const dR = frac * delta0 * nr;
          const dI = frac * delta0 * ni;

          const cosA = Math.cos(dR), sinA = Math.sin(dR);
          const coshBv = Math.cosh(dI), sinhBv = Math.sinh(dI);
          const cosDr = cosA * coshBv, cosDi = sinA * sinhBv;
          const sinDr = sinA * coshBv, sinDi = -cosA * sinhBv;

          const nMagSq = nr * nr + ni * ni;
          const sinOverN_r = (sinDr * nr + sinDi * ni) / nMagSq;
          const sinOverN_i = (sinDi * nr - sinDr * ni) / nMagSq;
          const sL12r = -sinOverN_i, sL12i = sinOverN_r;

          const NsinD_r = nr * sinDr + ni * sinDi;
          const NsinD_i = nr * sinDi - ni * sinDr;
          const sL21r = -NsinD_i, sL21i = NsinD_r;

          // Partial matrix for this sub-layer from 0 to frac*d
          // L_partial = [[cosDr+i*cosDi, sL12r+i*sL12i], [sL21r+i*sL21i, cosDr+i*cosDi]]
          // M_cumulative = P_prev_layers * L_partial
          // But we need cumulative from substrate: multiply previous layers' P by this partial layer
          const cumP11r = P11r * cosDr - P11i * cosDi + P12r * sL21r - P12i * sL21i;
          const cumP11i = P11r * cosDi + P11i * cosDr + P12r * sL21i + P12i * sL21r;
          const cumP12r = P11r * sL12r - P11i * sL12i + P12r * cosDr - P12i * cosDi;
          const cumP12i = P11r * sL12i + P11i * sL12r + P12r * cosDi + P12i * cosDr;

          // B(z) = cumP11 + ns * cumP12
          const Bzr = cumP11r + ns * cumP12r;
          const Bzi = cumP11i + ns * cumP12i;
          intensities.push((Bzr * Bzr + Bzi * Bzi) * tMag2);
        }

        // Update P to include the full layer
        const fullDR = delta0 * nr, fullDI = delta0 * ni;
        const fCosA = Math.cos(fullDR), fSinA = Math.sin(fullDR);
        const fCoshB = Math.cosh(fullDI), fSinhB = Math.sinh(fullDI);
        const fCosDr = fCosA * fCoshB, fCosDi = fSinA * fSinhB;
        const fSinDr = fSinA * fCoshB, fSinDi = -fCosA * fSinhB;

        const fNMagSq = nr * nr + ni * ni;
        const fSoN_r = (fSinDr * nr + fSinDi * ni) / fNMagSq;
        const fSoN_i = (fSinDi * nr - fSinDr * ni) / fNMagSq;
        const fL12r = -fSoN_i, fL12i = fSoN_r;

        const fNsD_r = nr * fSinDr + ni * fSinDi;
        const fNsD_i = nr * fSinDi - ni * fSinDr;
        const fL21r = -fNsD_i, fL21i = fNsD_r;

        const nP11r = P11r * fCosDr - P11i * fCosDi + P12r * fL21r - P12i * fL21i;
        const nP11i = P11r * fCosDi + P11i * fCosDr + P12r * fL21i + P12i * fL21r;
        const nP12r = P11r * fL12r - P11i * fL12i + P12r * fCosDr - P12i * fCosDi;
        const nP12i = P11r * fL12i + P11i * fL12r + P12r * fCosDi + P12i * fCosDr;
        const nP21r = P21r * fCosDr - P21i * fCosDi + P22r * fL21r - P22i * fL21i;
        const nP21i = P21r * fCosDi + P21i * fCosDr + P22r * fL21i + P22i * fL21r;
        const nP22r = P21r * fL12r - P21i * fL12i + P22r * fCosDr - P22i * fCosDi;
        const nP22i = P21r * fL12i + P21i * fL12r + P22r * fCosDi + P22i * fCosDr;

        P11r = nP11r; P11i = nP11i; P12r = nP12r; P12i = nP12i;
        P21r = nP21r; P21i = nP21i; P22r = nP22r; P22i = nP22i;
      }

      return { wavelength: lambda, color: admittanceColors[wIdx % admittanceColors.length], intensities };
    });

    // Merge into unified data array for LineChart
    const mergedData = depthPoints.map((pt, idx) => {
      const row = { depth: parseFloat(pt.depth.toFixed(2)), material: pt.material };
      allLines.forEach((line) => {
        row[`intensity_${line.wavelength}`] = line.intensities[idx];
      });
      return row;
    });

    setEfieldData({
      lines: allLines.map((l) => ({ wavelength: l.wavelength, color: l.color })),
      layers: layerRegions,
      data: mergedData,
    });
  }, [displayMode, layerStacks, currentStackId, machines, substrate, incident, efieldWavelengths, getRefractiveIndex, getExtinctionCoefficient]);

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const text = await file.text();
    const lines = text.split("\n");
    const data = [];

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      const parts = line.split(",");
      if (parts.length >= 2) {
        const wavelength = parseFloat(parts[0]);

        const reflectivity = parseFloat(parts[1]);
        if (!isNaN(wavelength) && !isNaN(reflectivity)) {
          data.push({ wavelength, reflectivity });
        }
      }
    }
    if (data.length > 0) setExperimentalData(data);
  };

  const handleReverseEngineerUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const text = await file.text();
    const lines = text.split("\n");
    const data = [];

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      const parts = line.split(",");
      if (parts.length >= 2) {
        const wavelength = parseFloat(parts[0]);
        const reflectivity = parseFloat(parts[1]);
        if (!isNaN(wavelength) && !isNaN(reflectivity)) {
          data.push({ wavelength, reflectivity });
        }
      }
    }
    if (data.length > 0) {
      setReverseEngineerData(data);
      setReverseEngineerMode(true);
    }
  };

  const clearReverseEngineerData = () => {
    setReverseEngineerData(null);
    setReverseEngineerMode(false);
  };

  const clearExperimentalData = () => {
    setExperimentalData(null);
    setSuggestions([]);
  };

  // Recipe Tracking Functions
  const handleTrackingFileUpload = async (e, placement) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    // Check tracking run limit
    if (!checkLimit('maxTrackingRuns', trackingRuns.length, 'Tracking Charts')) {
      e.target.value = "";
      return;
    }

    // Validate selections
    if (!selectedMachineForTracking || !selectedRecipeForTracking) {
      showToast("Please select a machine and recipe before uploading data.", 'error');
      e.target.value = "";
      return;
    }

    const newRuns = [];

    for (let fileIndex = 0; fileIndex < files.length; fileIndex++) {
      const file = files[fileIndex];
      const text = await file.text();
      const lines = text.split("\n");
      const data = [];

      // Parse CSV - expecting format: wavelength, reflectivity
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        const parts = line.split(",");
        if (parts.length >= 2) {
          const wavelength = parseFloat(parts[0]);
          const reflectivity = parseFloat(parts[1]);
          if (!isNaN(wavelength) && !isNaN(reflectivity)) {
            data.push({ wavelength, reflectivity });
          }
        }
      }

      if (data.length > 0) {
        newRuns.push({
          id: Date.now() + fileIndex,
          filename: file.name,
          timestamp: new Date().toISOString(),
          data: data,
          machineId: selectedMachineForTracking,
          machineName:
            machines.find((m) => m.id === selectedMachineForTracking)?.name ||
            "Unknown",
          recipeId: selectedRecipeForTracking,
          recipeName:
            recipes.find((r) => r.id === selectedRecipeForTracking)?.name ||
            "Unknown",
          placement: placement,
          runNumber: runNumber || "",
          notes: "",
        });
      }
    }

    if (newRuns.length > 0) {
      setTrackingRuns([...trackingRuns, ...newRuns]);
      applyTrackingFilters([...trackingRuns, ...newRuns]);
    }

    // Reset file input
    e.target.value = "";
  };

  const applyTrackingFilters = (runs) => {
    const filtered = runs.filter((run) => {
      if (
        trackingFilters.machine !== "all" &&
        run.machineId !== trackingFilters.machine
      )
        return false;
      if (
        trackingFilters.recipe !== "all" &&
        run.recipeId !== trackingFilters.recipe
      )
        return false;
      if (
        trackingFilters.placement !== "all" &&
        run.placement !== trackingFilters.placement
      )
        return false;
      return true;
    });

    calculateTrackingStats(filtered);
  };

  const updateTrackingFilter = (filterType, value) => {
    const newFilters = { ...trackingFilters, [filterType]: value };
    setTrackingFilters(newFilters);

    // Apply filters to existing runs
    const filtered = trackingRuns.filter((run) => {
      if (newFilters.machine !== "all" && run.machineId !== newFilters.machine)
        return false;
      if (newFilters.recipe !== "all" && run.recipeId !== newFilters.recipe)
        return false;
      if (
        newFilters.placement !== "all" &&
        run.placement !== newFilters.placement
      )
        return false;
      return true;
    });

    calculateTrackingStats(filtered);
  };

  const calculateTrackingStats = (runs) => {
    if (runs.length === 0) {
      setTrackingStats(null);
      return;
    }

    // Get all unique wavelengths
    const allWavelengths = new Set();
    runs.forEach((run) => {
      run.data.forEach((d) => allWavelengths.add(d.wavelength));
    });

    const sortedWavelengths = Array.from(allWavelengths).sort((a, b) => a - b);

    // Calculate statistics for each wavelength
    const stats = sortedWavelengths.map((wavelength) => {
      const dataPoint = { wavelength };

      // Add data from each run
      runs.forEach((run, idx) => {
        const point = run.data.find(
          (d) => Math.abs(d.wavelength - wavelength) < 0.5
        );
        dataPoint[`run${idx}`] = point ? point.reflectivity : null;
      });

      // Calculate statistics
      const values = runs
        .map((run, idx) => dataPoint[`run${idx}`])
        .filter((v) => v !== null);

      if (values.length > 0) {
        const mean = values.reduce((a, b) => a + b, 0) / values.length;
        const variance =
          values.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / values.length;
        const stdDev = Math.sqrt(variance);
        const min = Math.min(...values);
        const max = Math.max(...values);

        dataPoint.mean = mean;
        dataPoint.stdDev = stdDev;
        dataPoint.min = min;
        dataPoint.max = max;
        dataPoint.upperBound = mean + stdDev;
        dataPoint.lowerBound = mean - stdDev;
      }

      return dataPoint;
    });

    setTrackingStats(stats);
  };

  // Recalculate tracking stats whenever runs or filters change (e.g. after auto-load)
  useEffect(() => {
    if (trackingRuns.length > 0) {
      applyTrackingFilters(trackingRuns);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackingRuns.length]);

  const deleteTrackingRun = (id) => {
    const newRuns = trackingRuns.filter((r) => r.id !== id);
    setTrackingRuns(newRuns);
    applyTrackingFilters(newRuns);
    setTrackingCompareRunIds(prev => prev.filter(rid => rid !== id));
    if (editingNoteRunId === id) setEditingNoteRunId(null);
    if (String(trackingColorRunId) === String(id)) setTrackingColorRunId('mean');
  };

  const clearAllTrackingRuns = () => {
    if (window.confirm("Are you sure you want to clear all tracking data?")) {
      setTrackingRuns([]);
      setTrackingStats(null);
      setTrackingCompareRunIds([]);
      setTrackingOverlayEnabled(false);
      setTrackingToleranceEnabled(false);
      setTrackingTrendView('spectrum');
      setEditingNoteRunId(null);
      setTrackingColorRunId('mean');
    }
  };

  const saveTrackingData = () => {
    if (trackingRuns.length === 0) {
      showToast("No data to save", 'error');
      return;
    }

    const dataToSave = {
      exportDate: new Date().toISOString(),
      totalRuns: trackingRuns.length,
      runs: trackingRuns.map((run) => ({
        id: run.id,
        filename: run.filename,
        timestamp: run.timestamp,
        machineId: run.machineId,
        machineName: run.machineName,
        recipeId: run.recipeId,
        recipeName: run.recipeName,
        placement: run.placement,
        runNumber: run.runNumber,
        notes: run.notes || "",
        dataPoints: run.data.length,
      })),
      fullData: trackingRuns,
    };

    const blob = new Blob([JSON.stringify(dataToSave, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `tracking-data-${new Date().toISOString().split("T")[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const updateRunNotes = (runId, notes) => {
    const newRuns = trackingRuns.map(run =>
      run.id === runId ? { ...run, notes } : run
    );
    setTrackingRuns(newRuns);
  };

  const exportTrackingCSV = () => {
    if (!trackingStats || trackingStats.length === 0) return;
    const filteredRuns = trackingRuns.filter((run) => {
      if (trackingFilters.machine !== "all" && run.machineId !== trackingFilters.machine) return false;
      if (trackingFilters.recipe !== "all" && run.recipeId !== trackingFilters.recipe) return false;
      if (trackingFilters.placement !== "all" && run.placement !== trackingFilters.placement) return false;
      return true;
    });
    const headers = ['Wavelength (nm)', ...filteredRuns.map(r => r.filename), 'Mean', 'StdDev', 'Min', 'Max'];
    const rows = trackingStats.map(stat => {
      return [
        stat.wavelength,
        ...filteredRuns.map((_, idx) => stat[`run${idx}`] != null ? stat[`run${idx}`].toFixed(3) : ''),
        stat.mean != null ? stat.mean.toFixed(3) : '',
        stat.stdDev != null ? stat.stdDev.toFixed(3) : '',
        stat.min != null ? stat.min.toFixed(3) : '',
        stat.max != null ? stat.max.toFixed(3) : '',
      ].join(',');
    });
    const csv = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tracking-data-${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const exportTrackingPNG = () => {
    const chartContainer = trackingChartRef.current;
    if (!chartContainer || !trackingStats || trackingStats.length === 0) return;

    // Compute data for the stats panel
    const filteredRuns = trackingRuns.filter((run) => {
      if (trackingFilters.machine !== "all" && run.machineId !== trackingFilters.machine) return false;
      if (trackingFilters.recipe !== "all" && run.recipeId !== trackingFilters.recipe) return false;
      if (trackingFilters.placement !== "all" && run.placement !== trackingFilters.placement) return false;
      return true;
    });

    // Mean color
    const meanVisData = trackingStats.map(s => ({ wavelength: s.wavelength, theoretical: s.mean }));
    const meanColor = calculateColorInfo(meanVisData, 'D65');

    // Stats
    const avgStdDev = (trackingStats.filter(s => s.stdDev !== undefined).reduce((sum, s) => sum + s.stdDev, 0) /
      trackingStats.filter(s => s.stdDev !== undefined).length).toFixed(2);
    const maxVar = Math.max(...trackingStats.filter(s => s.max !== undefined && s.min !== undefined).map(s => s.max - s.min)).toFixed(2);
    const wlMin = Math.min(...trackingStats.map(s => s.wavelength)).toFixed(0);
    const wlMax = Math.max(...trackingStats.map(s => s.wavelength)).toFixed(0);

    // Build stats panel HTML
    const s = (obj) => Object.entries(obj).map(([k, v]) => `${k}:${v}`).join(';');
    const row = (label, value) => `<div style="display:flex;justify-content:space-between;margin-bottom:2px"><span>${label}</span><span style="font-weight:600">${value}</span></div>`;

    let statsHTML = `<div style="${s({
      width: '200px', padding: '12px', 'font-family': 'Arial,sans-serif', 'font-size': '11px',
      color: theme.textPrimary, 'background-color': '#ffffff', 'border-left': '1px solid #e5e7eb',
      display: 'flex', 'flex-direction': 'column', gap: '10px', overflow: 'hidden'
    })}">`;

    // Color Analysis section
    if (meanColor) {
      statsHTML += `<div>
        <div style="font-weight:700;font-size:12px;margin-bottom:6px;color:#1f2937">Color Analysis (Mean)</div>
        <div style="width:100%;height:40px;border-radius:4px;border:2px solid #9ca3af;margin-bottom:6px;background-color:${meanColor.rgb}"></div>
        <div style="font-weight:700;font-size:12px;margin-bottom:4px">${meanColor.colorName}</div>
        <div style="background:#eff6ff;border-radius:4px;padding:6px;margin-bottom:4px">
          <div style="font-weight:600;font-size:9px;color:#1e40af;margin-bottom:3px">CIE Lab</div>
          ${row('L*', meanColor.L)}${row('a*', meanColor.a_star)}${row('b*', meanColor.b_star)}
        </div>
        <div style="background:#faf5ff;border-radius:4px;padding:6px;margin-bottom:4px">
          <div style="font-weight:600;font-size:9px;color:#6b21a8;margin-bottom:3px">LCh</div>
          ${row('C', meanColor.C)}${row('h', meanColor.h + '°')}
        </div>
        ${row('Dom. λ', meanColor.dominantWavelength + 'nm')}
        ${row('Avg R', meanColor.avgReflectivity + '%')}
        ${row('Hex', meanColor.hex)}
      </div>`;
    }

    // Statistics section
    statsHTML += `<div>
      <div style="font-weight:700;font-size:12px;margin-bottom:6px;color:#1f2937">Statistics</div>
      ${row('Runs', `${filteredRuns.length}/${trackingRuns.length}`)}
      ${row('Avg Std Dev', avgStdDev + '%')}
      ${row('Max Variation', maxVar + '%')}
      ${row('λ Range', `${wlMin}-${wlMax}nm`)}
    </div>`;

    statsHTML += '</div>';

    // Create temporary off-screen export container
    const chartRect = chartContainer.getBoundingClientRect();
    const exportWrapper = document.createElement('div');
    exportWrapper.style.cssText = `position:fixed;left:-9999px;top:0;display:flex;background:#fff;width:${chartRect.width + 200}px;height:${chartRect.height}px`;

    // Clone the chart
    const chartClone = chartContainer.cloneNode(true);
    chartClone.style.cssText = `width:${chartRect.width}px;height:${chartRect.height}px;flex-shrink:0;overflow:hidden`;

    // Build the stats panel
    const statsPanel = document.createElement('div');
    statsPanel.innerHTML = statsHTML;

    exportWrapper.appendChild(chartClone);
    exportWrapper.appendChild(statsPanel.firstChild);
    document.body.appendChild(exportWrapper);

    html2canvas(exportWrapper, {
      backgroundColor: darkMode ? '#161830' : '#ffffff',
      scale: 2,
      useCORS: true,
      width: chartRect.width + 200,
      height: chartRect.height,
    }).then(canvas => {
      document.body.removeChild(exportWrapper);
      canvas.toBlob((blob) => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `tracking-chart-${new Date().toISOString().split('T')[0]}.png`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 'image/png');
    }).catch(() => {
      document.body.removeChild(exportWrapper);
      showToast('PNG export failed.', 'error');
    });
  };

  // Sensitivity Analysis Functions
  const classifyWavelengthRegion = (wl) => {
    if (wl < 380) return "UV";
    if (wl < 450) return "Violet-Blue";
    if (wl < 500) return "Blue-Cyan";
    if (wl < 570) return "Green";
    if (wl < 590) return "Yellow";
    if (wl < 620) return "Orange";
    if (wl < 780) return "Red";
    return "NIR";
  };

  const assignToleranceClasses = (results) => {
    if (results.layers.length === 0) return;
    const maxScore = Math.max(...results.layers.map((l) => l.sensitivityScore));
    if (maxScore === 0) {
      results.layers.forEach((l) => { l.toleranceClass = "loose"; });
      return;
    }
    results.layers.forEach((l) => {
      const normalized = l.sensitivityScore / maxScore;
      if (normalized >= 0.6) {
        l.toleranceClass = "tight";
      } else if (normalized >= 0.25) {
        l.toleranceClass = "medium";
      } else {
        l.toleranceClass = "loose";
      }
    });
  };

  const runSensitivityAnalysis = () => {
    if (!requireFeature('layerSensitivity', 'Layer Sensitivity Analysis')) return;
    if (layers.length === 0) return;
    setSaRunning(true);
    setSaResults(null);
    setSaSelectedLayer(null);

    setTimeout(() => {
      const wavelengths = [];
      for (let w = wavelengthRange.min; w <= wavelengthRange.max; w += wavelengthRange.step) {
        wavelengths.push(w);
      }

      const resultLayers = [];

      for (let i = 0; i < layers.length; i++) {
        const delta = saDeltaMode === "percent"
          ? (layers[i].thickness * saDelta) / 100
          : saDelta;

        if (delta === 0) continue;

        const perturbedPlus = layers.map((l, j) =>
          j === i ? { ...l, thickness: l.thickness + delta } : l
        );
        const perturbedMinus = layers.map((l, j) =>
          j === i ? { ...l, thickness: Math.max(0, l.thickness - delta) } : l
        );

        const wavelengthData = [];
        let sumSquared = 0;
        let peakSens = 0;
        let peakWl = wavelengthRange.min;

        for (const lambda of wavelengths) {
          const Rplus = calculateReflectivityAtWavelength(lambda, perturbedPlus, currentStackId);
          const Rminus = calculateReflectivityAtWavelength(lambda, perturbedMinus, currentStackId);
          const dRdt = (Rplus - Rminus) / (2 * delta);

          let weight = 1.0;
          if (saUseTargetWeighting && targets.length > 0) {
            weight = 0;
            for (const target of targets) {
              if (lambda >= target.wavelengthMin && lambda <= target.wavelengthMax) {
                weight = 1.0;
                break;
              }
            }
          }

          const absSens = Math.abs(dRdt) * weight;
          wavelengthData.push({ wavelength: lambda, sensitivity: absSens });
          sumSquared += absSens * absSens;

          if (absSens > peakSens) {
            peakSens = absSens;
            peakWl = lambda;
          }
        }

        const rmsScore = Math.sqrt(sumSquared / wavelengths.length);

        resultLayers.push({
          index: i,
          id: layers[i].id,
          material: layers[i].material,
          thickness: layers[i].thickness,
          sensitivityScore: rmsScore,
          peakWavelength: peakWl,
          peakSensitivity: peakSens,
          peakRegion: classifyWavelengthRegion(peakWl),
          toleranceClass: "medium",
          wavelengthData,
        });
      }

      resultLayers.sort((a, b) => b.sensitivityScore - a.sensitivityScore);

      const results = {
        layers: resultLayers,
        maxScore: resultLayers[0]?.sensitivityScore || 0,
        timestamp: Date.now(),
      };

      assignToleranceClasses(results);
      setSaResults(results);
      setSaRunning(false);
    }, 10);
  };

  // Monte Carlo Simulation Function
  const runMonteCarloSimulation = async () => {
    if (!tierLimits.yieldCalculator) {
      setUpgradeFeature('Yield Calculator');
      setShowUpgradePrompt(true);
      return;
    }
    if (targets.length === 0) {
      showToast("Please define at least one target specification before running Monte Carlo simulation.", 'error');
      return;
    }

    setMcRunning(true);
    setMcProgress(0);
    setMcResults(null);

    const results = {
      totalRuns: mcNumRuns,
      passedRuns: 0,
      failedRuns: 0,
      passRate: 0,
      errorDistribution: [],
      passedExamples: [],
      failedExamples: [],
      worstCaseError: 0,
      bestCaseError: Infinity,
      avgError: 0,
      // Color statistics
      colorStats: {
        allL: [],
        allA: [],
        allB: [],
        allDeltaE: [],
        nominalL: 0,
        nominalA: 0,
        nominalB: 0,
        meanL: 0,
        meanA: 0,
        meanB: 0,
        stdL: 0,
        stdA: 0,
        stdB: 0,
        maxDeltaE: 0,
        avgDeltaE: 0,
        deltaEDistribution: [],
      },
    };

    const allErrors = [];
    const passedRuns = [];
    const failedRuns = [];

    // Calculate nominal color for the current design (baseline for ΔE comparison)
    if (mcIncludeColor) {
      const nominalReflectivity = [];
      for (let lambda = 380; lambda <= 780; lambda += 5) {
        const R =
          calculateReflectivityAtWavelength(lambda, layers, currentStackId) *
          100;
        nominalReflectivity.push({ wavelength: lambda, theoretical: R });
      }
      const nominalColor = calculateColorInfo(
        nominalReflectivity,
        selectedIlluminant
      );
      if (nominalColor) {
        results.colorStats.nominalL = parseFloat(nominalColor.L);
        results.colorStats.nominalA = parseFloat(nominalColor.a_star);
        results.colorStats.nominalB = parseFloat(nominalColor.b_star);
      }
    }

    for (let run = 0; run < mcNumRuns; run++) {
      if (run % 50 === 0) {
        setMcProgress((run / mcNumRuns) * 100);
        await new Promise((resolve) => setTimeout(resolve, 0));
      }

      const virtualLayers = layers.map((layer) => {
        const thicknessMultiplier =
          1 +
          ((Math.random() + Math.random() + Math.random() + Math.random() - 2) /
            2) *
            (mcThicknessError / 100);

        let virtualIAD = layer.iad ? { ...layer.iad } : null;
        if (virtualIAD && virtualIAD.enabled) {
          const riMultiplier =
            1 +
            ((Math.random() +
              Math.random() +
              Math.random() +
              Math.random() -
              2) /
              2) *
              (mcRIError / 100);
          virtualIAD = {
            ...virtualIAD,
            riIncrease: virtualIAD.riIncrease * riMultiplier,
          };
        }

        return {
          ...layer,
          thickness: layer.thickness * thicknessMultiplier,
          iad: virtualIAD,
        };
      });

      const stack = layerStacks.find((s) => s.id === currentStackId);
      const machine = machines.find((m) => m.id === stack?.machineId);
      const baseToolingFactors = machine?.toolingFactors || {};

      const virtualToolingFactors = {};
      Object.keys(baseToolingFactors).forEach((material) => {
        const toolingMultiplier =
          1 +
          ((Math.random() + Math.random() + Math.random() + Math.random() - 2) /
            2) *
            (mcToolingError / 100);
        virtualToolingFactors[material] =
          baseToolingFactors[material] * toolingMultiplier;
      });

      const virtualStackId = Date.now() + run;
      const virtualStack = {
        id: virtualStackId,
        machineId: currentMachineId,
        layers: virtualLayers,
        visible: true,
      };

      const virtualMachine = {
        id: currentMachineId,
        toolingFactors: virtualToolingFactors,
      };

      // Temporarily add virtual stack/machine for calculateReflectivityAtWavelength
      // which reads layerStacks/machines from the closure.
      // We push/splice on a per-iteration basis and clean up immediately after.
      layerStacks.push(virtualStack);
      machines.push(virtualMachine);

      let maxError = 0;
      let passed = true;

      targets.forEach((target) => {
        const wavelengths = [];
        if (target.wavelengthMin === target.wavelengthMax) {
          wavelengths.push(target.wavelengthMin);
        } else {
          for (let i = 0; i < 5; i++) {
            const wl =
              target.wavelengthMin +
              (i / 4) * (target.wavelengthMax - target.wavelengthMin);
            wavelengths.push(wl);
          }
        }

        wavelengths.forEach((wl) => {
          const R =
            calculateReflectivityAtWavelength(
              wl,
              virtualLayers,
              virtualStackId
            ) * 100;

          if (R < target.reflectivityMin || R > target.reflectivityMax) {
            passed = false;
            const error = Math.max(
              target.reflectivityMin - R,
              R - target.reflectivityMax,
              0
            );
            maxError = Math.max(maxError, Math.abs(error));
          }
        });
      });

      // Calculate color for this virtual run
      let runDeltaE = 0;
      if (mcIncludeColor) {
        const virtualReflectivity = [];
        for (let lambda = 380; lambda <= 780; lambda += 5) {
          const R =
            calculateReflectivityAtWavelength(
              lambda,
              virtualLayers,
              virtualStackId
            ) * 100;
          virtualReflectivity.push({ wavelength: lambda, theoretical: R });
        }
        const virtualColor = calculateColorInfo(
          virtualReflectivity,
          selectedIlluminant
        );
        if (virtualColor) {
          const L = parseFloat(virtualColor.L);
          const a = parseFloat(virtualColor.a_star);
          const b = parseFloat(virtualColor.b_star);
          results.colorStats.allL.push(L);
          results.colorStats.allA.push(a);
          results.colorStats.allB.push(b);

          // Calculate ΔE* (CIE76 formula)
          const dL = L - results.colorStats.nominalL;
          const da = a - results.colorStats.nominalA;
          const db = b - results.colorStats.nominalB;
          runDeltaE = Math.sqrt(dL * dL + da * da + db * db);
          results.colorStats.allDeltaE.push(runDeltaE);
        }
      }

      layerStacks.pop();
      machines.pop();

      allErrors.push(maxError);

      if (passed) {
        results.passedRuns++;
        if (passedRuns.length < 3) {
          passedRuns.push({ layers: virtualLayers, error: maxError });
        } else {
          passedRuns.sort((a, b) => a.error - b.error);
          if (maxError < passedRuns[2].error) {
            passedRuns[2] = { layers: virtualLayers, error: maxError };
          }
        }
      } else {
        results.failedRuns++;
        if (failedRuns.length < 3) {
          failedRuns.push({ layers: virtualLayers, error: maxError });
        } else {
          failedRuns.sort((a, b) => b.error - a.error);
          if (maxError > failedRuns[2].error) {
            failedRuns[2] = { layers: virtualLayers, error: maxError };
          }
        }
      }

      results.worstCaseError = Math.max(results.worstCaseError, maxError);
      results.bestCaseError = Math.min(results.bestCaseError, maxError);
    }

    results.passRate = (results.passedRuns / results.totalRuns) * 100;
    results.avgError = allErrors.reduce((a, b) => a + b, 0) / allErrors.length;
    results.passedExamples = passedRuns;
    results.failedExamples = failedRuns;

    const bins = 10;
    const binSize = (results.worstCaseError - results.bestCaseError) / bins;
    const histogram = new Array(bins).fill(0).map((_, i) => ({
      range: `${(results.bestCaseError + i * binSize).toFixed(1)}-${(
        results.bestCaseError +
        (i + 1) * binSize
      ).toFixed(1)}%`,
      count: 0,
    }));

    allErrors.forEach((error) => {
      const binIndex = Math.min(
        Math.floor((error - results.bestCaseError) / binSize),
        bins - 1
      );
      if (binIndex >= 0) {
        histogram[binIndex].count++;
      }
    });

    results.errorDistribution = histogram;

    // Calculate final color statistics
    if (mcIncludeColor && results.colorStats.allL.length > 0) {
      const n = results.colorStats.allL.length;

      // Calculate means
      results.colorStats.meanL =
        results.colorStats.allL.reduce((a, b) => a + b, 0) / n;
      results.colorStats.meanA =
        results.colorStats.allA.reduce((a, b) => a + b, 0) / n;
      results.colorStats.meanB =
        results.colorStats.allB.reduce((a, b) => a + b, 0) / n;

      // Calculate standard deviations
      const varL =
        results.colorStats.allL.reduce(
          (sum, v) => sum + Math.pow(v - results.colorStats.meanL, 2),
          0
        ) / n;
      const varA =
        results.colorStats.allA.reduce(
          (sum, v) => sum + Math.pow(v - results.colorStats.meanA, 2),
          0
        ) / n;
      const varB =
        results.colorStats.allB.reduce(
          (sum, v) => sum + Math.pow(v - results.colorStats.meanB, 2),
          0
        ) / n;
      results.colorStats.stdL = Math.sqrt(varL);
      results.colorStats.stdA = Math.sqrt(varA);
      results.colorStats.stdB = Math.sqrt(varB);

      // Calculate ΔE statistics
      results.colorStats.maxDeltaE = Math.max(...results.colorStats.allDeltaE);
      results.colorStats.avgDeltaE =
        results.colorStats.allDeltaE.reduce((a, b) => a + b, 0) / n;

      // Build ΔE histogram (bins: 0-0.5, 0.5-1, 1-2, 2-3, 3-5, 5+)
      const deltaEBins = [
        { range: "0-0.5", label: "Imperceptible", count: 0 },
        { range: "0.5-1", label: "Slight", count: 0 },
        { range: "1-2", label: "Noticeable", count: 0 },
        { range: "2-3", label: "Visible", count: 0 },
        { range: "3-5", label: "Significant", count: 0 },
        { range: "5+", label: "Large", count: 0 },
      ];

      results.colorStats.allDeltaE.forEach((de) => {
        if (de < 0.5) deltaEBins[0].count++;
        else if (de < 1) deltaEBins[1].count++;
        else if (de < 2) deltaEBins[2].count++;
        else if (de < 3) deltaEBins[3].count++;
        else if (de < 5) deltaEBins[4].count++;
        else deltaEBins[5].count++;
      });

      results.colorStats.deltaEDistribution = deltaEBins;
    }

    setMcProgress(100);
    setMcResults(results);

    setTimeout(() => {
      setMcRunning(false);
      setMcProgress(0);
    }, 500);
  };

  // BUG FIX #2 & #3: Improved useEffect to prevent infinite loops
  // Uses refs to track previous state and avoid unnecessary updates
  useEffect(() => {
    try {
      localStorage.setItem('opticoat-customMaterials', JSON.stringify(customMaterials));
    } catch (e) {
      console.warn('Failed to save custom materials to localStorage:', e);
    }
  }, [customMaterials]);

  // ============ Offline Persistence ============

  // Load session from IndexedDB on mount + migrate localStorage data
  useEffect(() => {
    let cancelled = false;
    async function restoreSession() {
      try {
        // Migrate customMaterials from localStorage to IndexedDB (one-time)
        const migrated = await migrateFromLocalStorage();
        if (migrated && !cancelled) {
          setCustomMaterials(migrated);
        }

        const session = await loadSession();
        if (session && !cancelled) {
          // Use Array.isArray to properly restore empty arrays (not just non-empty ones).
          // Without this, deleting all stacks then reloading would skip the empty-array
          // restore and fall back to the 5-layer default from useState initialization.
          if (Array.isArray(session.layerStacks)) setLayerStacks(session.layerStacks);
          if (Array.isArray(session.layers)) setLayers(session.layers);
          if ('currentStackId' in session) setCurrentStackId(session.currentStackId);
          if (Array.isArray(session.machines) && session.machines.length > 0) setMachines(session.machines);
          if ('currentMachineId' in session) setCurrentMachineId(session.currentMachineId);
          if (session.substrate) setSubstrate(session.substrate);
          if (session.incident) setIncident(session.incident);
          if (session.wavelengthRange) setWavelengthRange(session.wavelengthRange);
          if (session.recipes?.length > 0) setRecipes(session.recipes);
          if (session.targets) setTargets(session.targets);
          if (session.trackingRuns) setTrackingRuns(session.trackingRuns);
          if (session.designPoints) setDesignPoints(session.designPoints);
          if (session.designMaterials) setDesignMaterials(session.designMaterials);
          if (session.minDesignLayers) setMinDesignLayers(session.minDesignLayers);
          if (session.maxDesignLayers) setMaxDesignLayers(session.maxDesignLayers);
          if (session.designLayers && !session.minDesignLayers) {
            // Backward compatibility: old sessions had single designLayers
            setMinDesignLayers(Math.max(1, session.designLayers - 2));
            setMaxDesignLayers(session.designLayers + 4);
          }
          if (session.matchTolerance !== undefined) setMatchTolerance(session.matchTolerance);
          if (session.layerTemplate) setLayerTemplate(session.layerTemplate);
          if (session.layoutMode) setLayoutMode(session.layoutMode === "horizontal" ? "wide" : session.layoutMode === "vertical" ? "tall" : session.layoutMode);
          if (session.displayMode) setDisplayMode(session.displayMode);
          if (session.selectedIlluminant) setSelectedIlluminant(session.selectedIlluminant);
          if (session.customMaterials && !migrated) setCustomMaterials(session.customMaterials);
        }
      } catch (e) {
        console.warn('Failed to restore session:', e);
      }
      if (!cancelled) setOfflineReady(true);
    }
    restoreSession();
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Subscribe to online/offline status changes
  useEffect(() => {
    const unsubscribe = syncManager.onStatusChange((status) => {
      setIsOnline(status === 'online' || status === 'synced' || status === 'tierUpdated');
    });
    syncManager.startPeriodicSync();
    return () => {
      unsubscribe();
      syncManager.stopPeriodicSync();
    };
  }, []);

  // Debounced auto-save to IndexedDB (1 second after last change)
  useEffect(() => {
    if (!offlineReady) return; // Don't save until initial load completes

    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
    }

    autoSaveTimerRef.current = setTimeout(() => {
      saveSession({
        layers,
        layerStacks,
        currentStackId,
        machines,
        currentMachineId,
        substrate,
        incident,
        wavelengthRange,
        recipes,
        targets,
        trackingRuns,
        designPoints,
        designMaterials,
        minDesignLayers,
        maxDesignLayers,
        matchTolerance,
        layerTemplate,
        layoutMode,
        displayMode,
        selectedIlluminant,
        customMaterials,
      });
    }, 1000);

    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
      }
    };
  }, [offlineReady, layers, layerStacks, currentStackId, machines, currentMachineId,
      substrate, incident, wavelengthRange, recipes, targets, trackingRuns,
      designPoints, designMaterials, minDesignLayers, maxDesignLayers, matchTolerance, layerTemplate, layoutMode,
      displayMode, selectedIlluminant, customMaterials]);

  // ============ Workspace Save/Load ============

  const loadDesignsList = useCallback(async () => {
    setDesignsLoading(true);
    try {
      if (isSignedIn) {
        const data = await apiGet('/api/designs');
        setSavedDesigns(data);
      } else {
        const local = await getLocalDesigns();
        setSavedDesigns(local || []);
      }
    } catch (e) {
      console.warn('Failed to load workspaces:', e);
      const local = await getLocalDesigns();
      setSavedDesigns(local || []);
    }
    setDesignsLoading(false);
  }, [isSignedIn]);

  // Fetch full workspace data for the expanded view
  const fetchWorkspaceData = useCallback(async (design) => {
    if (workspaceDataCache[design.id]) return workspaceDataCache[design.id];
    if (design.data) {
      setWorkspaceDataCache(prev => ({ ...prev, [design.id]: design.data }));
      return design.data;
    }
    try {
      const full = await apiGet(`/api/designs/${design.id}`);
      setWorkspaceDataCache(prev => ({ ...prev, [design.id]: full.data }));
      return full.data;
    } catch (e) {
      showToast('Failed to fetch workspace data', 'error');
      return null;
    }
  }, [workspaceDataCache]); // eslint-disable-line react-hooks/exhaustive-deps

  // Full workspace replace (after confirmation)
  // Migrate workspace data from older versions to current format
  const migrateWorkspaceData = (data) => {
    if (!data) return data;
    const d = { ...data };
    if (!d.version) d.version = 1;
    if (d.version < 2) {
      d.layerStacks = d.layerStacks || [];
      d.trackingRuns = d.trackingRuns || [];
      d.customMaterials = d.customMaterials || {};
      d.version = 2;
    }
    // Future migrations: if (d.version < 3) { ... d.version = 3; }
    return d;
  };

  const executeWorkspaceReplace = useCallback(async (rawData, designMeta) => {
    const d = migrateWorkspaceData(rawData);
    if (!d) return;
    isUpdatingStackRef.current = true;

    if (Array.isArray(d.layerStacks)) setLayerStacks(d.layerStacks);
    if (Array.isArray(d.layers)) setLayers(d.layers);
    if (d.currentStackId !== undefined) setCurrentStackId(d.currentStackId);
    if (Array.isArray(d.machines) && d.machines.length > 0) setMachines(d.machines);
    if (d.currentMachineId !== undefined) setCurrentMachineId(d.currentMachineId);
    if (d.substrate) setSubstrate(d.substrate);
    if (d.incident) setIncident(d.incident);
    if (d.wavelengthRange) setWavelengthRange(d.wavelengthRange);
    if (d.recipes) setRecipes(d.recipes);
    if (d.targets) setTargets(d.targets);
    if (Array.isArray(d.trackingRuns)) setTrackingRuns(d.trackingRuns);
    if (Array.isArray(d.designPoints)) setDesignPoints(d.designPoints);
    if (Array.isArray(d.designMaterials)) setDesignMaterials(d.designMaterials);
    if (d.minDesignLayers !== undefined) setMinDesignLayers(d.minDesignLayers);
    if (d.maxDesignLayers !== undefined) setMaxDesignLayers(d.maxDesignLayers);
    if (d.matchTolerance !== undefined) setMatchTolerance(d.matchTolerance);
    if (d.layerTemplate) setLayerTemplate(d.layerTemplate);
    if (d.displayMode) setDisplayMode(d.displayMode);
    if (d.selectedIlluminant) setSelectedIlluminant(d.selectedIlluminant);
    if (d.customMaterials) setCustomMaterials(d.customMaterials);

    const activeLayers = d.layers || (d.layerStacks?.find(s => s.id === d.currentStackId)?.layers) || [];
    prevLayersRef.current = JSON.stringify(activeLayers);

    // Track the loaded workspace for Save vs Save-as-New
    if (designMeta) {
      setActiveWorkspaceId(designMeta.id || null);
      setActiveWorkspaceName(designMeta.name || '');
    }

    Promise.resolve().then(() => { isUpdatingStackRef.current = false; });

    setShowReplaceConfirmDialog(null);
    setPendingReplaceData(null);
    setShowLoadWorkspaceModal(false);
    setActiveTab('designer');
    showToast('Workspace loaded', 'success');
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Build current workspace data snapshot
  const buildWorkspaceData = useCallback(() => ({
    version: 2,
    layers, layerStacks, currentStackId, machines, currentMachineId,
    substrate, incident, wavelengthRange, recipes, targets, trackingRuns,
    designPoints, designMaterials, minDesignLayers, maxDesignLayers, matchTolerance, layerTemplate,
    displayMode, selectedIlluminant, customMaterials,
  }), [layers, layerStacks, currentStackId, machines, currentMachineId,
      substrate, incident, wavelengthRange, recipes, targets, trackingRuns,
      designPoints, designMaterials, minDesignLayers, maxDesignLayers, matchTolerance, layerTemplate,
      displayMode, selectedIlluminant, customMaterials]);

  // Save workspace — supports overwrite (PUT) and save-as-new (POST) with dual cloud+local backup
  const handleSaveWorkspace = useCallback(async (name, overwriteId) => {
    if (!name.trim()) return;
    // Only check limit for new saves, not overwrites
    if (!overwriteId && !checkLimit('maxSavedDesigns', savedDesigns.length, 'Saved Workspaces')) return;
    const workspaceData = buildWorkspaceData();
    const trimmedName = name.trim();
    let cloudId = overwriteId || null;

    try {
      if (isSignedIn) {
        if (overwriteId) {
          // Overwrite existing workspace via PUT
          const result = await apiPut(`/api/designs/${overwriteId}`, { name: trimmedName, data: workspaceData });
          cloudId = result.id || overwriteId;
        } else {
          // Create new workspace via POST
          const result = await apiPost('/api/designs', { name: trimmedName, data: workspaceData });
          cloudId = result.id;
        }
      }

      // Always save a local backup (cloud + local dual save)
      await saveDesignLocally({
        id: cloudId || ('local_' + Date.now()),
        name: trimmedName,
        data: workspaceData,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      // Track this as the active workspace
      setActiveWorkspaceId(cloudId);
      setActiveWorkspaceName(trimmedName);

      setShowSaveWorkspaceModal(false);
      setSaveWorkspaceName('');
      loadDesignsList();

      const savedMsg = isSignedIn ? 'Workspace saved & backed up locally' : 'Workspace saved locally';
      showToast(`"${trimmedName}" — ${savedMsg}`, 'success');

      // If there's a pending workspace replace (user clicked "Save First"), execute it now
      if (pendingReplaceData) {
        const design = pendingReplaceData;
        const d = workspaceDataCache[design.id] || design.data;
        if (d) {
          setTimeout(() => executeWorkspaceReplace(d, design), 100);
        } else {
          fetchWorkspaceData(design).then(fetched => { if (fetched) executeWorkspaceReplace(fetched, design); });
        }
      }
    } catch (e) {
      console.warn('Failed to save workspace:', e);
      // If cloud save failed, try local-only save as fallback
      try {
        await saveDesignLocally({
          id: 'local_' + Date.now(),
          name: trimmedName,
          data: workspaceData,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
        showToast('Cloud save failed — saved locally only. Will sync when connection is restored.', 'error');
        setShowSaveWorkspaceModal(false);
        setSaveWorkspaceName('');
      } catch (localErr) {
        showToast('Failed to save: ' + e.message, 'error');
      }
    }
  }, [isSignedIn, buildWorkspaceData, loadDesignsList, checkLimit, savedDesigns,
      pendingReplaceData, workspaceDataCache, executeWorkspaceReplace, fetchWorkspaceData]);

  // Cherry-pick: Add a machine (with its stacks) from a workspace
  const handleAddMachineFromWorkspace = useCallback((machine, wsData) => {
    const newMachineId = Math.max(...machines.map(m => m.id), 0) + 1;
    const newMachine = { ...machine, id: newMachineId };
    setMachines(prev => [...prev, newMachine]);

    // Find stacks belonging to this machine in the workspace
    const machineStacks = (wsData.layerStacks || []).filter(s => s.machineId === machine.id);
    if (machineStacks.length > 0) {
      const maxStackId = Math.max(...layerStacks.map(s => s.id), 0);
      const remappedStacks = machineStacks.map((s, i) => ({
        ...s,
        id: maxStackId + i + 1,
        machineId: newMachineId,
      }));
      setLayerStacks(prev => [...prev, ...remappedStacks]);
    }
    showToast(`Machine "${machine.name || 'Machine ' + machine.id}" added with ${(wsData.layerStacks || []).filter(s => s.machineId === machine.id).length} stack(s)`, 'success');
  }, [machines, layerStacks]);

  // Cherry-pick: Add a single stack from a workspace
  const handleAddStackFromWorkspace = useCallback((stack) => {
    const newStackId = Math.max(...layerStacks.map(s => s.id), 0) + 1;
    const newStack = {
      ...stack,
      id: newStackId,
      machineId: currentMachineId,
      color: `hsl(${(newStackId * 60) % 360}, 70%, 50%)`,
    };

    isUpdatingStackRef.current = true;
    setLayerStacks(prev => [...prev, newStack]);
    setCurrentStackId(newStackId);
    setLayers(newStack.layers);
    prevLayersRef.current = JSON.stringify(newStack.layers);
    Promise.resolve().then(() => { isUpdatingStackRef.current = false; });

    showToast(`Stack "${stack.name || 'Stack'}" added`, 'success');
  }, [layerStacks, currentMachineId]);

  // Cherry-pick: Add custom materials from a workspace
  const handleAddMaterialsFromWorkspace = useCallback((materials) => {
    setCustomMaterials(prev => ({ ...prev, ...materials }));
    showToast(`${Object.keys(materials).length} material(s) added`, 'success');
  }, []);

  // Cherry-pick: Add optimizer targets from a workspace
  const handleAddTargetsFromWorkspace = useCallback((wsData) => {
    if (wsData.targets) setTargets(wsData.targets);
    if (Array.isArray(wsData.designPoints)) setDesignPoints(wsData.designPoints);
    if (Array.isArray(wsData.designMaterials)) setDesignMaterials(wsData.designMaterials);
    if (wsData.minDesignLayers !== undefined) setMinDesignLayers(wsData.minDesignLayers);
    if (wsData.maxDesignLayers !== undefined) setMaxDesignLayers(wsData.maxDesignLayers);
    if (wsData.matchTolerance !== undefined) setMatchTolerance(wsData.matchTolerance);
    if (wsData.layerTemplate) setLayerTemplate(wsData.layerTemplate);
    showToast('Optimizer targets loaded', 'success');
  }, []);

  // Cherry-pick: Add tracking runs from a workspace
  const handleAddTrackingRunsFromWorkspace = useCallback((runs) => {
    const maxId = Math.max(...trackingRuns.map(r => r.id || 0), 0);
    const remapped = runs.map((r, i) => ({ ...r, id: maxId + i + 1 }));
    setTrackingRuns(prev => [...prev, ...remapped]);
    showToast(`${runs.length} tracking run(s) added`, 'success');
  }, [trackingRuns]);

  const handleDeleteDesign = useCallback(async (designId) => {
    try {
      if (isSignedIn && !designId.startsWith('local_')) {
        await apiDelete(`/api/designs/${encodeURIComponent(designId)}`);
      } else {
        await deleteLocalDesign(designId);
      }
      setWorkspaceDataCache(prev => { const next = { ...prev }; delete next[designId]; return next; });
      loadDesignsList();
    } catch (e) {
      console.warn('Failed to delete workspace:', e);
    }
  }, [isSignedIn, loadDesignsList]);

  // ============ Billing ============

  const [enterpriseSeats, setEnterpriseSeats] = useState(5);
  const [billingInterval, setBillingInterval] = useState('monthly');
  const [checkoutLoading, setCheckoutLoading] = useState(false);

  const handleCheckout = useCallback(async (tier, interval = 'monthly') => {
    if (checkoutLoading) return; // Prevent double-click
    setCheckoutLoading(true);
    try {
      const body = { tier, interval };
      if (tier === 'enterprise') body.seats = enterpriseSeats;
      // Send Clerk email so Stripe customer gets the correct email
      const clerkEmail = authUser?.primaryEmailAddress?.emailAddress || authUser?.emailAddresses?.[0]?.emailAddress;
      if (clerkEmail) body.email = clerkEmail;
      const data = await apiPost('/api/billing/checkout', body);
      if (data.url) window.location.href = data.url;
    } catch (e) {
      showToast('Failed to start checkout: ' + e.message, 'error');
      setCheckoutLoading(false);
    }
  }, [enterpriseSeats, checkoutLoading]);

  const handleBillingPortal = useCallback(async () => {
    try {
      const data = await apiPost('/api/billing/portal', {});
      if (data.url) window.location.href = data.url;
    } catch (e) {
      showToast('Failed to open billing portal: ' + e.message, 'error');
    }
  }, []);

  // ============ Data Sync ============

  const syncDataToServer = useCallback(async () => {
    if (!isSignedIn || !isOnline) return;
    try {
      // Sync custom materials
      if (Object.keys(customMaterials).length > 0) {
        for (const [name, props] of Object.entries(customMaterials)) {
          await apiPost('/api/materials', { name, properties: props }).catch(() => {});
        }
      }
      // Sync machines
      for (const machine of machines) {
        await apiPost('/api/machines', {
          name: machine.name,
          toolingFactors: machine.toolingFactors,
        }).catch(() => {});
      }
    } catch (e) {
      console.warn('Data sync failed:', e);
    }
  }, [isSignedIn, isOnline, customMaterials, machines]);

  // Trigger sync when user signs in
  useEffect(() => {
    if (isSignedIn && isOnline) {
      syncDataToServer();
    }
  }, [isSignedIn]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    // Skip during delete operations (BUG FIX #1)
    if (isDeletingRef.current) {
      return;
    }

    // Skip if we're in the middle of updating stacks from this effect
    if (isUpdatingStackRef.current) {
      return;
    }

    if (
      activeTab === "designer" &&
      layerStacks.length > 0 &&
      currentStackId !== null
    ) {
      // Check if layers actually changed by comparing with previous value
      const layersJson = JSON.stringify(layers);
      const prevLayersJson = prevLayersRef.current;

      // Only update layerStacks if layers have actually changed
      if (layersJson !== prevLayersJson) {
        prevLayersRef.current = layersJson;

        // Check if the current stack's layers are different from our layers state
        const currentStack = layerStacks.find((s) => s.id === currentStackId);
        const currentStackLayersJson = currentStack
          ? JSON.stringify(currentStack.layers)
          : null;

        if (currentStackLayersJson !== layersJson) {
          // Mark that we're updating to prevent re-triggering
          isUpdatingStackRef.current = true;

          setLayerStacks((prevStacks) => {
            const updatedStacks = prevStacks.map((stack) => {
              if (stack.id === currentStackId) {
                return { ...stack, layers: layers };
              }
              return stack;
            });
            return updatedStacks;
          });

          // Reset the flag after a microtask to allow the state update to complete
          Promise.resolve().then(() => {
            isUpdatingStackRef.current = false;
          });
        }
      }

      // Debounce calculation via requestAnimationFrame — coalesces rapid arrow key
      // inputs into one calculation per frame instead of one per keystroke.
      // Only run reflectivity calculation when it will actually be displayed —
      // admittance and efield modes have their own dedicated useEffects.
      if (displayMode !== "admittance" && displayMode !== "efield") {
        if (calcRafRef.current) cancelAnimationFrame(calcRafRef.current);
        calcRafRef.current = requestAnimationFrame(() => {
          calcRafRef.current = null;
          calculateReflectivity();
        });
      }
    } else if (activeTab === "designer" && (layerStacks.length === 0 || currentStackId === null)) {
      // Also handle: stacks exist on other machines but no current stack selected.
      // Without this, the chart would show stale data from a previous calculation.
      if (displayMode !== "admittance" && displayMode !== "efield") {
        if (calcRafRef.current) cancelAnimationFrame(calcRafRef.current);
        calcRafRef.current = requestAnimationFrame(() => {
          calcRafRef.current = null;
          calculateReflectivity();
        });
      }
    }

    return () => {
      if (calcRafRef.current) cancelAnimationFrame(calcRafRef.current);
    };
  }, [
    layers,
    substrate,
    incident,
    wavelengthRange,
    experimentalData,
    autoYAxis,
    activeTab,
    currentStackId,
    calculateReflectivity,
    layerStacks, // Depend on full array to recalculate when stack layers update
    displayMode,
  ]);

  // Separate useEffect for admittance — only runs when in admittance mode
  useEffect(() => {
    if (displayMode === "admittance") {
      if (admittanceRafRef.current) cancelAnimationFrame(admittanceRafRef.current);
      admittanceRafRef.current = requestAnimationFrame(() => {
        admittanceRafRef.current = null;
        calculateAdmittanceLoci();
      });
    }
    return () => {
      if (admittanceRafRef.current) cancelAnimationFrame(admittanceRafRef.current);
    };
  }, [displayMode, calculateAdmittanceLoci]);

  // Separate useEffect for E-field — only runs when in efield mode
  useEffect(() => {
    if (displayMode === "efield") {
      if (efieldRafRef.current) cancelAnimationFrame(efieldRafRef.current);
      efieldRafRef.current = requestAnimationFrame(() => {
        efieldRafRef.current = null;
        calculateEfieldDistribution();
      });
    }
    return () => {
      if (efieldRafRef.current) cancelAnimationFrame(efieldRafRef.current);
    };
  }, [displayMode, calculateEfieldDistribution]);

  // BUG FIX #1: Properly use isDeletingRef during delete operations
  const deleteLayerStack = (id) => {
    // Set the deleting flag to prevent useEffect interference
    isDeletingRef.current = true;

    try {
      const newStacks = layerStacks.filter((s) => s.id !== id);

      // If we deleted the current stack, switch to another stack in the same machine
      if (currentStackId === id) {
        const machineStacks = newStacks.filter(
          (s) => s.machineId === currentMachineId
        );
        if (machineStacks.length > 0) {
          const newCurrentStack = machineStacks[0];
          setCurrentStackId(newCurrentStack.id);
          setLayers(newCurrentStack.layers);
          // Update the ref to match new layers
          prevLayersRef.current = JSON.stringify(newCurrentStack.layers);
        } else {
          // If no stacks remain in this machine, clear the current stack ID and layers
          setCurrentStackId(null);
          setLayers([]);
          prevLayersRef.current = JSON.stringify([]);
        }
      }

      setLayerStacks(newStacks);

      // If no stacks with layers remain, immediately clear chart data
      // (the useEffect is blocked by isDeletingRef so won't recalculate)
      if (newStacks.filter(s => s.visible && s.layers.length > 0).length === 0) {
        setReflectivityData([]);
        setStackColorData({});
      }
    } finally {
      // Reset the deleting flag after state updates are queued
      // Use setTimeout to ensure state updates have been processed
      setTimeout(() => {
        isDeletingRef.current = false;
      }, 0);
    }
  };

  const addLayerStack = () => {
    // Check tier limit
    if (!checkLimit('maxStacks', layerStacks.length, 'Layer Stacks')) return;

    // Generate a new unique ID
    const newId = Math.max(0, ...layerStacks.map((s) => s.id)) + 1;

    // Count stacks in current machine for naming
    const machineStacks = layerStacks.filter(
      (s) => s.machineId === currentMachineId
    );

    // Create new stack with default layers
    const newStack = {
      id: newId,
      machineId: currentMachineId,
      name: `Layer Stack ${machineStacks.length + 1}`,
      layers: [{ id: 1, material: "SiO2", thickness: 100, iad: null }],
      visible: true,
      color: `hsl(${(newId * 60) % 360}, 70%, 50%)`,
    };

    // Add the new stack
    setLayerStacks([...layerStacks, newStack]);

    // Switch to the new stack
    setCurrentStackId(newId);
    setLayers(newStack.layers);

    // Update the ref to match new layers
    prevLayersRef.current = JSON.stringify(newStack.layers);
  };

  // Check if a template subtype is accessible at the current tier
  const isTemplateAccessible = (subtype) => {
    const templateAccess = tierLimits.coatingTemplates;
    if (!templateAccess) return false;
    if (templateAccess === 'all') return true;
    if (templateAccess === 'basic') return subtype.tierRequired === 'free';
    return false;
  };

  // Insert template-generated layers into a stack
  const insertTemplateLayers = (generatedLayers, mode) => {
    // Layer count validation against tier limit
    const maxLayers = tierLimits.maxLayersPerStack;
    if (maxLayers > 0 && generatedLayers.length > maxLayers) {
      showToast(`Template generates ${generatedLayers.length} layers but your plan allows ${maxLayers}. Try fewer pairs or upgrade.`, 'error');
      return;
    }
    // mode: 'replace' = replace current stack, 'new' = create new stack
    const fullLayers = generatedLayers.map((l, i) => ({
      id: i + 1,
      material: l.material,
      thickness: l.thickness,
      iad: null,
      packingDensity: 1.0,
    }));

    if (mode === 'new') {
      const newId = Math.max(0, ...layerStacks.map((s) => s.id)) + 1;
      const machineStacks = layerStacks.filter(s => s.machineId === currentMachineId);
      const newStack = {
        id: newId,
        machineId: currentMachineId,
        name: `Layer Stack ${machineStacks.length + 1}`,
        layers: fullLayers,
        visible: true,
        color: `hsl(${(newId * 60) % 360}, 70%, 50%)`,
      };
      setLayerStacks([...layerStacks, newStack]);
      setCurrentStackId(newId);
      setLayers(fullLayers);
      prevLayersRef.current = JSON.stringify(fullLayers);
    } else {
      // Replace current stack
      setLayers(fullLayers);
      setLayerStacks(prev => prev.map(stack =>
        stack.id === currentStackId ? { ...stack, layers: fullLayers } : stack
      ));
      prevLayersRef.current = JSON.stringify(fullLayers);
    }
    setShowTemplatePicker(false);
    setTemplateInsertConfirm(null);
    setSelectedTemplateType(null);
    setSelectedSubtype(null);
    setTemplateParams({});
    showToast(`Template inserted: ${fullLayers.length} layers`, 'success');
  };

  // Generate layers from a template subtype with current params
  const generateTemplatePreview = (subtype, params) => {
    const getN = (material, wavelength) => getRefractiveIndex(material, wavelength);
    return subtype.generate(params, allMaterials, getN);
  };

  const switchLayerStack = (id) => {
    setCurrentStackId(id);
    const stack = layerStacks.find((s) => s.id === id);
    if (stack) {
      setLayers(stack.layers);
      // Update the ref to match new layers
      prevLayersRef.current = JSON.stringify(stack.layers);
    }
  };

  const toggleStackVisibility = (id) => {
    setLayerStacks(
      layerStacks.map((s) => {
        if (s.id === id) {
          return { ...s, visible: !s.visible };
        }
        return s;
      })
    );
  };

  const renameLayerStack = (id, newName) => {
    setLayerStacks(
      layerStacks.map((s) => {
        if (s.id === id) {
          return { ...s, name: newName };
        }
        return s;
      })
    );
  };

  // Machine management functions
  const addMachine = () => {
    if (!checkLimit('maxMachines', machines.length, 'Machines')) return;
    const toolingFactors = {};
    Object.keys(allMaterials).forEach((mat) => { toolingFactors[mat] = 1.0; });
    const newMachine = {
      id: Date.now(),
      name: `Machine ${machines.length + 1}`,
      toolingFactors,
    };
    setMachines([...machines, newMachine]);
    setCurrentMachineId(newMachine.id);
  };

  const deleteMachine = (id) => {
    if (machines.length === 1) {
      showToast("Cannot delete the last machine", 'error');
      return;
    }

    // Set deleting flag
    isDeletingRef.current = true;

    try {
      // Delete all layer stacks associated with this machine
      const newStacks = layerStacks.filter((s) => s.machineId !== id);
      setLayerStacks(newStacks);

      // Delete the machine
      const newMachines = machines.filter((m) => m.id !== id);
      setMachines(newMachines);

      // Switch to another machine
      if (currentMachineId === id && newMachines.length > 0) {
        const newMachineId = newMachines[0].id;
        setCurrentMachineId(newMachineId);

        // Switch to a stack in the new machine if available
        const newMachineStacks = newStacks.filter(
          (s) => s.machineId === newMachineId
        );
        if (newMachineStacks.length > 0) {
          setCurrentStackId(newMachineStacks[0].id);
          setLayers(newMachineStacks[0].layers);
          prevLayersRef.current = JSON.stringify(newMachineStacks[0].layers);
        } else {
          setCurrentStackId(null);
          setLayers([]);
          prevLayersRef.current = JSON.stringify([]);
        }
      }
    } finally {
      setTimeout(() => {
        isDeletingRef.current = false;
      }, 0);
    }
  };

  const switchMachine = (id) => {
    setCurrentMachineId(id);

    // Switch to the first stack in this machine, or clear if none
    const machineStacks = layerStacks.filter((s) => s.machineId === id);
    if (machineStacks.length > 0) {
      setCurrentStackId(machineStacks[0].id);
      setLayers(machineStacks[0].layers);
      prevLayersRef.current = JSON.stringify(machineStacks[0].layers);
    } else {
      setCurrentStackId(null);
      setLayers([]);
      prevLayersRef.current = JSON.stringify([]);
    }
  };

  const renameMachine = (id, newName) => {
    setMachines(
      machines.map((m) => {
        if (m.id === id) {
          return { ...m, name: newName };
        }
        return m;
      })
    );
  };

  const handleDividerMouseDown = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleHorizontalDividerMouseDown = (e) => {
    e.preventDefault();
    setIsDraggingHorizontal(true);
  };

  useEffect(() => {
    const handleMove = (clientY) => {
      const container = document.querySelector(".designer-container");
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const newHeight = ((clientY - rect.top) / rect.height) * 100;
      if (newHeight > 20 && newHeight < 80) {
        setChartHeight(newHeight);
      }
    };

    const handleMouseMove = (e) => { if (!isDragging) return; handleMove(e.clientY); };
    const handleTouchMove = (e) => { if (!isDragging) return; e.preventDefault(); handleMove(e.touches[0].clientY); };
    const handleEnd = () => { setIsDragging(false); };

    if (isDragging) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleEnd);
      document.addEventListener("touchmove", handleTouchMove, { passive: false });
      document.addEventListener("touchend", handleEnd);
      return () => {
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleEnd);
        document.removeEventListener("touchmove", handleTouchMove);
        document.removeEventListener("touchend", handleEnd);
      };
    }
  }, [isDragging]);

  // Horizontal dragging for horizontal layout mode
  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!isDraggingHorizontal) return;

      const container = document.querySelector(".designer-container");
      if (!container) return;

      const rect = container.getBoundingClientRect();
      // Invert calculation since layers are on the left now
      const newWidth = 100 - ((e.clientX - rect.left) / rect.width) * 100;

      // Calculate minimum layers panel width based on column minimums:
      // #(24px) + Material(80px) + Thick(64px) + QWOT(40px) + Last(32px) + Orig(32px) + Buttons(64px) + gaps(28px) + padding(16px) = 380px
      const minLayersPanelPixels = 380;
      const minLayersPanelPercent = (minLayersPanelPixels / rect.width) * 100;
      const maxChartWidth = 100 - minLayersPanelPercent;

      // Constrain between 30% and calculated max based on column minimums
      if (newWidth > 30 && newWidth < maxChartWidth) {
        setChartWidth(newWidth);
      }
    };

    const handleMouseUp = () => {
      setIsDraggingHorizontal(false);
    };

    if (isDraggingHorizontal) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      return () => {
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
      };
    }
  }, [isDraggingHorizontal]);

  const addCustomMaterial = () => {
    if (!checkLimit('maxCustomMaterials', Object.keys(customMaterials).length, 'Custom Materials')) return;
    const trimmedName = newMaterialForm.name.trim();
    if (!trimmedName) { showToast('Please enter a material name.', 'error'); return; }
    if (materialDispersion[trimmedName]) { showToast('A built-in material with this name already exists.', 'error'); return; }
    if (customMaterials[trimmedName]) { showToast('A custom material with this name already exists.', 'error'); return; }
    if (/\s/.test(trimmedName)) { showToast('Material name cannot contain spaces. Use underscores or CamelCase.', 'error'); return; }

    let materialData;
    if (newMaterialForm.mode === 'simple') {
      materialData = {
        type: 'constant',
        n: newMaterialForm.n,
        color: newMaterialForm.color,
        iadIncrease: newMaterialForm.iadIncrease,
        stress: newMaterialForm.stress,
        kType: newMaterialForm.k > 0 ? 'constant' : 'none',
        kValue: newMaterialForm.k,
        isCustom: true,
      };
    } else if (newMaterialForm.mode === 'tabular') {
      if (!newMaterialForm.tabularData || newMaterialForm.tabularData.length < 2) {
        showToast('Tabular material requires at least 2 data points. Upload or paste n,k data first.', 'error');
        return;
      }
      materialData = {
        type: 'tabular',
        data: newMaterialForm.tabularData,
        color: newMaterialForm.color,
        iadIncrease: newMaterialForm.iadIncrease,
        stress: newMaterialForm.stress,
        kType: 'tabular',
        isCustom: true,
      };
    } else {
      materialData = {
        isCustom: true,
        color: newMaterialForm.color,
        iadIncrease: newMaterialForm.iadIncrease,
        stress: newMaterialForm.stress,
        kType: newMaterialForm.kType,
      };
      if (newMaterialForm.dispersionType === 'cauchy') {
        materialData.type = 'cauchy';
        materialData.A = newMaterialForm.A;
        materialData.B = newMaterialForm.B;
        materialData.C = newMaterialForm.C;
      } else if (newMaterialForm.dispersionType === 'tauc-lorentz') {
        materialData.type = 'tauc-lorentz';
        materialData.A = newMaterialForm.tlA;
        materialData.E0 = newMaterialForm.tlE0;
        materialData.C = newMaterialForm.tlC;
        materialData.Eg = newMaterialForm.tlEg;
        materialData.epsInf = newMaterialForm.tlEpsInf;
        // TL has built-in absorption; override kType
        materialData.kType = 'tauc-lorentz';
      } else if (newMaterialForm.dispersionType === 'cody-lorentz') {
        materialData.type = 'cody-lorentz';
        materialData.A = newMaterialForm.clA;
        materialData.E0 = newMaterialForm.clE0;
        materialData.C = newMaterialForm.clC;
        materialData.Eg = newMaterialForm.clEg;
        materialData.epsInf = newMaterialForm.clEpsInf;
        materialData.Eu = newMaterialForm.clEu;
        materialData.kType = 'cody-lorentz';
      } else if (newMaterialForm.dispersionType === 'lorentz') {
        if (!newMaterialForm.lzOscillators || newMaterialForm.lzOscillators.length === 0) {
          showToast('Lorentz material requires at least 1 oscillator.', 'error');
          return;
        }
        materialData.type = 'lorentz';
        materialData.epsInf = newMaterialForm.lzEpsInf;
        materialData.oscillators = newMaterialForm.lzOscillators.map(o => ({ A: o.A, E0: o.E0, gamma: o.gamma }));
        materialData.kType = 'lorentz';
      } else {
        materialData.type = 'sellmeier';
        materialData.B1 = newMaterialForm.B1;
        materialData.B2 = newMaterialForm.B2;
        materialData.B3 = newMaterialForm.B3;
        materialData.C1 = newMaterialForm.C1;
        materialData.C2 = newMaterialForm.C2;
        materialData.C3 = newMaterialForm.C3;
      }
      if (newMaterialForm.dispersionType !== 'tauc-lorentz' && newMaterialForm.dispersionType !== 'lorentz' && newMaterialForm.dispersionType !== 'cody-lorentz') {
        if (newMaterialForm.kType === 'constant') {
          materialData.kValue = newMaterialForm.kValue;
        }
        if (newMaterialForm.kType === 'urbach') {
          materialData.k0 = newMaterialForm.k0;
          materialData.kEdge = newMaterialForm.kEdge;
          materialData.kDecay = newMaterialForm.kDecay;
        }
      }
    }

    setCustomMaterials((prev) => ({ ...prev, [trimmedName]: materialData }));
    setNewMaterialForm({
      name: '', mode: 'simple', n: 1.5, k: 0,
      dispersionType: 'cauchy', A: 2.0, B: 0.02, C: 0.0001,
      B1: 0.6, B2: 0.4, B3: 0.9, C1: 0.07, C2: 0.12, C3: 10.0,
      kType: 'none', kValue: 0, k0: 0.05, kEdge: 350, kDecay: 0.02,
      color: '#E0E0E0', iadIncrease: 2.0, stress: 0,
      tabularText: '', tabularData: [], tabularError: '',
      tlA: 100, tlE0: 4.2, tlC: 2.2, tlEg: 3.2, tlEpsInf: 2.2,
      lzEpsInf: 1.0, lzOscillators: [{ A: 1.0, E0: 4.0, gamma: 0.5 }],
      clA: 110, clE0: 6.0, clC: 3.0, clEg: 5.5, clEpsInf: 2.0, clEu: 0.1,
      kkResult: null,
    });
  };

  const deleteCustomMaterial = (name) => {
    const inUse = layerStacks.some((stack) =>
      stack.layers.some((layer) => layer.material === name)
    );
    if (inUse) {
      showToast(`Cannot delete "${name}" because it is currently used in a layer stack. Remove it from all layers first.`, 'error');
      return;
    }
    setCustomMaterials((prev) => {
      const next = { ...prev };
      delete next[name];
      return next;
    });
  };

  const addLayer = () => {
    if (!checkLimit('maxLayersPerStack', layers.length, 'Layers per Stack')) return;
    const newId = Math.max(...layers.map((l) => l.id), 0) + 1;
    const newLayers = [...layers, { id: newId, material: "SiO2", thickness: 100, iad: null, packingDensity: 1.0 }];
    setLayers(newLayers);
    setLayerStacks(prev => prev.map(stack =>
      stack.id === currentStackId ? { ...stack, layers: newLayers } : stack
    ));
  };

  const insertLayerAfter = (index) => {
    if (!checkLimit('maxLayersPerStack', layers.length, 'Layers per Stack')) return;
    const newId = Math.max(...layers.map((l) => l.id), 0) + 1;
    const newLayer = { id: newId, material: "SiO2", thickness: 100, iad: null, packingDensity: 1.0 };
    const newLayers = [...layers];
    newLayers.splice(index + 1, 0, newLayer);
    setLayers(newLayers);
    setLayerStacks(prev => prev.map(stack =>
      stack.id === currentStackId ? { ...stack, layers: newLayers } : stack
    ));
  };

  const removeLayer = (id) => {
    if (layers.length > 1) {
      const newLayers = layers.filter((l) => l.id !== id);
      setLayers(newLayers);
      setLayerStacks(prev => prev.map(stack =>
        stack.id === currentStackId ? { ...stack, layers: newLayers } : stack
      ));
    }
  };

  // Compute translateY for rows during drag to animate them shifting apart
  const getDragTransform = (idx, srcIdx, tgtIdx, rowHeight = 30) => {
    if (srcIdx === null || tgtIdx === null) return 'none';
    // The dragged row moves to the target position
    if (idx === srcIdx) {
      if (srcIdx === tgtIdx) return 'none';
      return `translateY(${(tgtIdx - srcIdx) * rowHeight}px)`;
    }
    if (srcIdx === tgtIdx) return 'none';
    if (srcIdx < tgtIdx) {
      // Dragging down: rows between source+1 and target shift up
      if (idx > srcIdx && idx <= tgtIdx) return `translateY(-${rowHeight}px)`;
    } else {
      // Dragging up: rows between target and source-1 shift down
      if (idx >= tgtIdx && idx < srcIdx) return `translateY(${rowHeight}px)`;
    }
    return 'none';
  };

  // Snapshot original row positions on drag start, calculate target from cursor Y
  const handleDragStartCapture = (container) => {
    if (!container) return;
    const rows = container.querySelectorAll('[data-layer-row]');
    dragRowRectsRef.current = Array.from(rows).map(row => {
      const rect = row.getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom, mid: rect.top + rect.height / 2, height: rect.height };
    });
  };

  const handleContainerDragOver = (e, offset = 0) => {
    e.preventDefault();
    const rects = dragRowRectsRef.current;
    if (!rects.length) return;
    const y = e.clientY;
    // Find which original row slot the cursor is in (by midpoint)
    let target = 0;
    for (let i = 0; i < rects.length; i++) {
      if (y > rects[i].mid) target = i + 1;
    }
    target = Math.min(target, rects.length - 1);
    if (dragOverIndex !== target + offset) setDragOverIndex(target + offset);
  };

  const moveLayer = (fromIndex, toIndex) => {
    if (fromIndex === toIndex || fromIndex == null || toIndex == null) return;
    const newLayers = [...layers];
    const [moved] = newLayers.splice(fromIndex, 1);
    newLayers.splice(toIndex, 0, moved);
    setLayers(newLayers);
    // Sync layerStacks in the same batch so calculateReflectivity has correct data
    setLayerStacks(prev => prev.map(stack =>
      stack.id === currentStackId ? { ...stack, layers: newLayers } : stack
    ));
  };

  const moveTemplateLayer = (fromIndex, toIndex) => {
    if (fromIndex === toIndex || fromIndex == null || toIndex == null) return;
    setLayerTemplate(prev => {
      const newTemplate = [...prev];
      const [moved] = newTemplate.splice(fromIndex, 1);
      newTemplate.splice(toIndex, 0, moved);
      return newTemplate;
    });
  };

  const updateLayer = (id, field, value) => {
    const newLayers = layers.map((l) => {
      if (l.id === id) {
        if (field === "material") return { ...l, material: value };
        // Allow empty string for user to clear and retype
        if (value === "" || value === null) return { ...l, [field]: "" };
        const numValue = parseFloat(value);
        // Prevent negative values for thickness
        if (field === "thickness" && numValue < 0)
          return { ...l, [field]: 0 };
        return { ...l, [field]: numValue };
      }
      return l;
    });

    setLayers(newLayers);

    // Sync layerStacks in the same handler — React batches both into one render,
    // eliminating the double-calculation cycle where the useEffect would first
    // calculate with stale layerStacks then re-calculate after sync.
    if (currentStackId) {
      prevLayersRef.current = JSON.stringify(newLayers);
      setLayerStacks(prev => prev.map(stack =>
        stack.id === currentStackId ? { ...stack, layers: newLayers } : stack
      ));
    }
  };

  const updateToolingFactor = (machineId, material, value) => {
    setMachines(
      machines.map((machine) => {
        if (machine.id === machineId) {
          return {
            ...machine,
            toolingFactors: {
              ...machine.toolingFactors,
              [material]: parseFloat(value) || 1.0,
            },
          };
        }
        return machine;
      })
    );
  };

  const applyFactorToLayers = () => {
    const factor = parseFloat(layerFactor);
    if (isNaN(factor) || factor <= 0) {
      showToast("Please enter a valid positive number for the factor", 'error');
      return;
    }

    // Save current last thicknesses for undo
    setPreviousLastThicknesses(layers.map((l) => l.lastThickness || null));

    const updatedLayers = layers.map((layer, index) => {
      // Skip locked layers
      if (layer.locked) {
        return { ...layer, lastThickness: layer.thickness };
      }

      const layerNumber = index + 1;
      let shouldApply = false;

      if (layerFactorMode === "all") {
        shouldApply = true;
      } else if (layerFactorMode === "odd") {
        shouldApply = layerNumber % 2 === 1;
      } else if (layerFactorMode === "even") {
        shouldApply = layerNumber % 2 === 0;
      }

      if (shouldApply) {
        return {
          ...layer,
          lastThickness: layer.thickness, // Store current as last
          thickness: layer.thickness * factor,
        };
      }
      return {
        ...layer,
        lastThickness: layer.thickness, // Store current as last even if not applying
      };
    });

    setLayers(updatedLayers);

    // Sync layerStacks + prevLayersRef in same handler to avoid double-calculation
    prevLayersRef.current = JSON.stringify(updatedLayers);
    setLayerStacks((prevStacks) =>
      prevStacks.map((stack) =>
        stack.id === currentStackId ? { ...stack, layers: updatedLayers } : stack
      )
    );

    setShowFactorPreview(false);
    setFactorPreviewData([]);
  };

  const calculateFactorPreview = useCallback(() => {
    const factor = parseFloat(layerFactor);
    if (isNaN(factor) || factor <= 0 || factor === 1.0) {
      setShowFactorPreview(false);
      setFactorPreviewData([]);
      return;
    }

    // Create preview layers with factor applied
    const previewLayers = layers.map((layer, index) => {
      const layerNumber = index + 1;
      let shouldApply = false;

      if (layerFactorMode === "all") {
        shouldApply = true;
      } else if (layerFactorMode === "odd") {
        shouldApply = layerNumber % 2 === 1;
      } else if (layerFactorMode === "even") {
        shouldApply = layerNumber % 2 === 0;
      }

      if (shouldApply) {
        return {
          ...layer,
          thickness: Math.round(layer.thickness * factor * 100) / 100,
        };
      }
      return layer;
    });

    // Calculate reflectivity for preview
    const { min, max, step } = wavelengthRange;
    const data = [];

    for (let lambda = min; lambda <= max; lambda += step) {
      const R = calculateReflectivityAtWavelength(
        lambda,
        previewLayers,
        currentStackId
      );
      data.push({
        wavelength: lambda,
        preview: R * 100,
        preview_transmission: (1 - R) * 100,
      });
    }

    setFactorPreviewData(data);
    setShowFactorPreview(true);
  }, [
    layerFactor,
    layerFactorMode,
    layers,
    wavelengthRange,
    calculateReflectivityAtWavelength,
    currentStackId,
  ]);

  // Update preview when factor or mode changes
  useEffect(() => {
    if (activeTab === "designer") {
      calculateFactorPreview();
    }
  }, [layerFactor, layerFactorMode, activeTab, calculateFactorPreview]);

  const calculateShiftPreview = useCallback(() => {
    const shift = parseFloat(shiftValue);
    if (isNaN(shift) || shift === 0) {
      setShowShiftPreview(false);
      setShiftPreviewData([]);
      return;
    }

    const { min, max, step } = wavelengthRange;
    const data = [];

    if (shiftMode === "left-right") {
      // Calculate scaled thicknesses - SAME method as applyShift uses
      const centerWavelength = (min + max) / 2;
      const scaleFactor = (centerWavelength + shift) / centerWavelength;

      // Create preview layers with scaled thicknesses
      const previewLayers = layers.map((layer) => ({
        ...layer,
        thickness: layer.thickness * scaleFactor,
      }));

      // Calculate reflectivity using the scaled layer thicknesses
      for (let lambda = min; lambda <= max; lambda += step) {
        let R = calculateReflectivityAtWavelength(
          lambda,
          previewLayers,
          currentStackId
        );

        // Apply double-sided calculation if enabled
        if (doubleSidedAR) {
          R = applyBackSurfaceCorrection(R, substrate.n);
        }

        data.push({
          wavelength: lambda,
          shiftPreview: R * 100,
          shiftPreview_transmission: (1 - R) * 100,
        });
      }
    } else {
      // Up/down shift: shift reflectivity values
      for (let lambda = min; lambda <= max; lambda += step) {
        let R = calculateReflectivityAtWavelength(
          lambda,
          layers,
          currentStackId
        );

        // Apply double-sided calculation if enabled
        if (doubleSidedAR) {
          R = applyBackSurfaceCorrection(R, substrate.n);
        }

        const shiftedR = Math.max(0, Math.min(100, R * 100 + shift));
        const shiftedT = Math.max(0, Math.min(100, (1 - R) * 100 - shift));
        data.push({
          wavelength: lambda,
          shiftPreview: shiftedR,
          shiftPreview_transmission: shiftedT,
        });
      }
    }

    setShiftPreviewData(data);
    setShowShiftPreview(true);
  }, [
    shiftValue,
    shiftMode,
    layers,
    wavelengthRange,
    calculateReflectivityAtWavelength,
    currentStackId,
    doubleSidedAR,
  ]);

  const calculateShiftedThicknesses = useCallback(() => {
    const shift = parseFloat(shiftValue);
    if (isNaN(shift) || shift === 0 || shiftMode !== "left-right") {
      return null;
    }

    // For wavelength shift, calculate proportional thickness changes
    // When shifting right (+), we need thicker layers to move peaks to higher wavelengths
    // When shifting left (-), we need thinner layers
    // The relationship is approximately linear: thickness_new = thickness_old * (1 + shift/lambda_center)

    const centerWavelength = (wavelengthRange.min + wavelengthRange.max) / 2;
    const scaleFactor = (centerWavelength + shift) / centerWavelength;

    return layers.map((layer) => ({
      ...layer,
      shiftedThickness: layer.locked
        ? layer.thickness
        : Math.round(layer.thickness * scaleFactor * 100) / 100,
    }));
  }, [shiftValue, shiftMode, layers, wavelengthRange]);

  const applyShift = () => {
    const shift = parseFloat(shiftValue);
    if (isNaN(shift) || shift === 0) {
      showToast("Please enter a non-zero shift value", 'error');
      return;
    }

    if (shiftMode === "left-right") {
      const shiftedLayers = calculateShiftedThicknesses();
      if (shiftedLayers) {
        // Save current last thicknesses for undo
        setPreviousLastThicknesses(layers.map((l) => l.lastThickness || null));

        const updatedLayers = shiftedLayers.map((layer) => ({
          ...layer,
          lastThickness: layer.thickness, // Store current as last
          originalThickness: layer.originalThickness || layer.thickness,
          thickness: Math.round(layer.shiftedThickness * 100) / 100,
        }));
        
        // Update layers state
        setLayers(updatedLayers);
        
        // Also update layerStacks directly to ensure chart updates
        setLayerStacks((prevStacks) =>
          prevStacks.map((stack) =>
            stack.id === currentStackId
              ? { ...stack, layers: updatedLayers }
              : stack
          )
        );
        
        // Update the ref to match new layers
        prevLayersRef.current = JSON.stringify(updatedLayers);
        
        setShowShiftPreview(false);
        setShiftPreviewData([]);
        setShiftValue(0); // Reset shift value after applying
      }
    } else {
      showToast("Up/Down shift cannot be directly applied to layer thicknesses. This mode is for visualization only.", 'info');
    }
  };

  // Update shift preview when shift value or mode changes
  useEffect(() => {
    if (activeTab === "designer") {
      calculateShiftPreview();
    }
  }, [shiftValue, shiftMode, activeTab, calculateShiftPreview]);

  const calculateXAxisTicks = useCallback(() => {
    const { min, max } = wavelengthRange;
    const range = max - min;

    // Calculate how many ticks we can fit (assuming ~50px per tick to avoid overlap)
    const chartWidth =
      typeof window !== "undefined" ? window.innerWidth * 0.7 : 1000; // Approximate chart width
    const maxTicks = Math.floor(chartWidth / 50);

    // Calculate ideal tick interval
    const idealInterval = range / maxTicks;

    // Round to nice intervals (prioritize 50, 25, 20, 10, 5)
    let tickInterval;
    if (idealInterval <= 5) {
      tickInterval = 5;
    } else if (idealInterval <= 10) {
      tickInterval = 10;
    } else if (idealInterval <= 20) {
      tickInterval = 20;
    } else if (idealInterval <= 25) {
      tickInterval = 25;
    } else if (idealInterval <= 50) {
      tickInterval = 50;
    } else if (idealInterval <= 100) {
      tickInterval = 100;
    } else if (idealInterval <= 200) {
      tickInterval = 200;
    } else {
      tickInterval = Math.ceil(idealInterval / 100) * 100;
    }

    // Generate ticks
    const ticks = [];
    let tick = Math.ceil(min / tickInterval) * tickInterval; // Start at first multiple of interval >= min

    while (tick <= max) {
      ticks.push(tick);
      tick += tickInterval;
    }

    // Ensure we have min and max if they're not already included
    if (ticks[0] !== min && ticks[0] - min > tickInterval / 2) {
      ticks.unshift(min);
    }
    if (
      ticks[ticks.length - 1] !== max &&
      max - ticks[ticks.length - 1] > tickInterval / 2
    ) {
      ticks.push(max);
    }

    return ticks;
  }, [wavelengthRange]);

  const calculateYAxisTicks = useCallback(() => {
    const { min, max } = reflectivityRange;
    const range = max - min;

    // Calculate how many ticks we can fit vertically (assuming ~40px per tick)
    const chartHeight = 400; // Approximate chart height based on chartHeight state
    const maxTicks = Math.floor(chartHeight / 40);

    // Calculate ideal tick interval
    const idealInterval = range / maxTicks;

    // Round to nice intervals (prioritize values ending in 5 or 0)
    let tickInterval;
    if (idealInterval <= 1) {
      tickInterval = 1;
    } else if (idealInterval <= 2) {
      tickInterval = 2;
    } else if (idealInterval <= 5) {
      tickInterval = 5;
    } else if (idealInterval <= 10) {
      tickInterval = 10;
    } else if (idealInterval <= 20) {
      tickInterval = 20;
    } else if (idealInterval <= 25) {
      tickInterval = 25;
    } else if (idealInterval <= 50) {
      tickInterval = 50;
    } else {
      tickInterval = Math.ceil(idealInterval / 10) * 10; // Round to nearest 10
    }

    // Generate ticks
    const ticks = [];
    let tick = Math.floor(min / tickInterval) * tickInterval; // Start at first multiple of interval <= min

    // Ensure we start at or below min
    if (tick < min) {
      tick = min;
    }

    while (tick <= max) {
      ticks.push(tick);
      tick += tickInterval;
    }

    // Ensure we have min and max
    if (ticks[0] > min) {
      ticks.unshift(min);
    }
    if (ticks[ticks.length - 1] < max) {
      ticks.push(max);
    }

    return ticks;
  }, [reflectivityRange]);

  const resetToOriginal = () => {
    const updatedLayers = layers.map((layer) => ({
      ...layer,
      thickness: layer.originalThickness || layer.thickness,
      lastThickness: undefined,
      originalThickness: undefined,
    }));
    setLayers(updatedLayers);
    setLayerStacks(prev => prev.map(stack =>
      stack.id === currentStackId ? { ...stack, layers: updatedLayers } : stack
    ));
    setPreviousLastThicknesses([]);
    setShowFactorPreview(false);
    setFactorPreviewData([]);
    setShowShiftPreview(false);
    setShiftPreviewData([]);
    setShiftValue(0);
  };

  const undoLastChange = () => {
    // Check if there's anything to undo
    const hasLastThickness = layers.some((l) => l.lastThickness !== undefined);
    if (!hasLastThickness) {
      showToast("No changes to undo", 'info');
      return;
    }

    const updatedLayers = layers.map((layer, index) => {
      if (layer.lastThickness !== undefined) {
        return {
          ...layer,
          thickness: layer.lastThickness,
          lastThickness: previousLastThicknesses[index] || undefined,
        };
      }
      return layer;
    });

    setLayers(updatedLayers);
    // Clear previous last thicknesses since we've used them
    setPreviousLastThicknesses([]);
  };

  const addTarget = () => {
    const newTarget = {
      id: Date.now(),
      name: `M${targets.length + 1}`,
      wavelengthMin: 380,
      wavelengthMax: 420,
      reflectivityMin: 3,
      reflectivityMax: 12,
    };
    const newTargets = [...targets, newTarget];
    setTargets(newTargets);
    updateRecipeTargets(currentRecipeId, newTargets);
  };

  const removeTarget = (id) => {
    const newTargets = targets.filter((t) => t.id !== id);
    setTargets(newTargets);
    updateRecipeTargets(currentRecipeId, newTargets);
  };

  const updateTarget = (id, field, value) => {
    const newTargets = targets.map((t) => {
      if (t.id === id) {
        if (field === "name") {
          return { ...t, [field]: value };
        }
        // Allow empty string during typing
        if (value === "" || value === null) {
          return { ...t, [field]: "" };
        }
        return { ...t, [field]: parseFloat(value) || 0 };
      }
      return t;
    });
    setTargets(newTargets);
    updateRecipeTargets(currentRecipeId, newTargets);
  };

  const addRecipe = () => {
    const newRecipe = {
      id: Date.now(),
      name: `Recipe ${recipes.length + 1}`,
      targets: [],
    };
    setRecipes([...recipes, newRecipe]);
    setCurrentRecipeId(newRecipe.id);
    setTargets([]);
  };

  const deleteRecipe = (id) => {
    if (recipes.length === 1) return;
    const newRecipes = recipes.filter((r) => r.id !== id);
    setRecipes(newRecipes);
    if (currentRecipeId === id) {
      setCurrentRecipeId(newRecipes[0].id);
      setTargets(newRecipes[0].targets);
    }
  };

  const switchRecipe = (id) => {
    setCurrentRecipeId(id);
    const recipe = recipes.find((r) => r.id === id);
    if (recipe) {
      setTargets(recipe.targets);
    }
  };

  const updateRecipeTargets = (recipeId, newTargets) => {
    setRecipes(prev =>
      prev.map((r) => {
        if (r.id === recipeId) {
          return { ...r, targets: newTargets };
        }
        return r;
      })
    );
  };

  const renameRecipe = (id, newName) => {
    setRecipes(
      recipes.map((r) => {
        if (r.id === id) {
          return { ...r, name: newName };
        }
        return r;
      })
    );
  };

  // Design Assistant Functions
  const addDesignPoint = () => {
    setDesignPoints([
      ...designPoints,
      {
        id: Date.now(),
        wavelengthMin: 550,
        wavelengthMax: 550,
        reflectivityMin: 40,
        reflectivityMax: 50,
        useWavelengthRange: false,
        useReflectivityRange: true,
      },
    ]);
  };

  const removeDesignPoint = (id) => {
    setDesignPoints(designPoints.filter((p) => p.id !== id));
  };

  const updateDesignPoint = (id, field, value) => {
    setDesignPoints(
      designPoints.map((p) => {
        if (p.id === id) {
          if (
            field === "useWavelengthRange" ||
            field === "useReflectivityRange"
          ) {
            return { ...p, [field]: value };
          }
          // Allow empty string for user to clear and retype
          if (value === "" || value === null) {
            return { ...p, [field]: "" };
          }
          // For numeric fields, parse and store as number
          const numValue =
            typeof value === "number"
              ? value
              : parseFloat(value) || 0;
          return { ...p, [field]: numValue };
        }
        return p;
      })
    );
  };

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
          calcR = applyBackSurfaceCorrection(calcR, substrate.n);
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
              const targetValue = (point.reflectivityMin + point.reflectivityMax) / 2;
              const v = Math.abs(calcR - targetValue);
              if (v > 1.0) {
                maxViolation = Math.max(maxViolation, v);
                totalViolation += v * v;
                pass = false;
              }
            }
          }
        } else {
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
          calcR = applyBackSurfaceCorrection(calcR, substrate.n);
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

  // Solve Ax = b via Gaussian elimination with partial pivoting (for LM optimizer)
  const solveLinear = (A, b) => {
    const n = A.length;
    const aug = A.map((row, i) => [...row, b[i]]);
    for (let col = 0; col < n; col++) {
      let maxVal = Math.abs(aug[col][col]);
      let maxRow = col;
      for (let row = col + 1; row < n; row++) {
        if (Math.abs(aug[row][col]) > maxVal) {
          maxVal = Math.abs(aug[row][col]);
          maxRow = row;
        }
      }
      if (maxVal < 1e-15) return null;
      if (maxRow !== col) [aug[col], aug[maxRow]] = [aug[maxRow], aug[col]];
      for (let row = col + 1; row < n; row++) {
        const f = aug[row][col] / aug[col][col];
        for (let j = col; j <= n; j++) aug[row][j] -= f * aug[col][j];
      }
    }
    const x = new Array(n);
    for (let i = n - 1; i >= 0; i--) {
      x[i] = aug[i][n];
      for (let j = i + 1; j < n; j++) x[i] -= aug[i][j] * x[j];
      x[i] /= aug[i][i];
    }
    return x;
  };

  // Classify material as High or Low refractive index at 550nm
  const classifyMaterialIndex = (material) => {
    const n = getRefractiveIndex(material, 550);
    return n >= 1.85 ? 'H' : 'L';
  };

  // Combined score: error + constraint violation penalty + alternation penalty.
  // Lower is better. Solutions with violation=0 are ranked by error alone.
  const calculateCombinedScore = (testLayers) => {
    // Single-pass scoring: computes violation, error, and maxDeviation in one loop
    // to avoid redundant reflectivity calculations (critical for CSV reverse engineering)

    if (colorTargetMode) {
      // Color target mode: soft constraints only, delegate to existing functions
      const { error, maxDeviation } = calculateMeritError(testLayers);
      return { score: error, error, maxDeviation, violation: 0, perTarget: [] };
    }

    let totalViolation = 0;
    let errorSum = 0;
    let errorCount = 0;
    let maxDeviation = 0;
    const perTarget = [];

    if (reverseEngineerMode && reverseEngineerData) {
      // Single pass through CSV data points
      for (let i = 0; i < reverseEngineerData.length; i++) {
        const dataPoint = reverseEngineerData[i];
        let calcR = calculateReflectivityAtWavelength(dataPoint.wavelength, testLayers);
        if (doubleSidedAR) {
          calcR = applyBackSurfaceCorrection(calcR, substrate.n);
        }
        calcR = calcR * 100;
        const deviation = Math.abs(calcR - dataPoint.reflectivity);
        maxDeviation = Math.max(maxDeviation, deviation);
        errorSum += deviation * deviation;
        errorCount++;
        // Constraint violation check
        if (deviation > matchTolerance) {
          totalViolation += Math.pow(deviation - matchTolerance, 2);
          perTarget.push({ pass: false, deviation });
        } else {
          perTarget.push({ pass: true, deviation });
        }
      }
    } else {
      // Target point mode — single pass
      // errorSum = distance from midpoint (for ranking quality)
      // totalViolation = out-of-bounds distance only (for constraint checking, separate from error)
      designPoints.forEach((point) => {
        let pointMaxViolation = 0;
        let pointPass = true;
        const targetValue = (point.reflectivityMin + point.reflectivityMax) / 2;

        if (point.useWavelengthRange) {
          for (let lambda = point.wavelengthMin; lambda <= point.wavelengthMax; lambda += 5) {
            const calcR = calculateReflectivityAtWavelength(lambda, testLayers) * 100;
            const d = Math.abs(calcR - targetValue);
            errorSum += d * d;
            maxDeviation = Math.max(maxDeviation, d);
            errorCount++;

            if (point.useReflectivityRange) {
              if (calcR < point.reflectivityMin) {
                const v = point.reflectivityMin - calcR;
                totalViolation += v * v;
                pointMaxViolation = Math.max(pointMaxViolation, v);
                pointPass = false;
              } else if (calcR > point.reflectivityMax) {
                const v = calcR - point.reflectivityMax;
                totalViolation += v * v;
                pointMaxViolation = Math.max(pointMaxViolation, v);
                pointPass = false;
              }
            } else {
              if (d > 1.0) {
                totalViolation += (d - 1.0) * (d - 1.0);
                pointMaxViolation = Math.max(pointMaxViolation, d);
                pointPass = false;
              }
            }
          }
        } else {
          const lambda = (point.wavelengthMin + point.wavelengthMax) / 2;
          const calcR = calculateReflectivityAtWavelength(lambda, testLayers) * 100;
          const d = Math.abs(calcR - targetValue);
          errorSum += d * d;
          maxDeviation = Math.max(maxDeviation, d);
          errorCount++;

          if (point.useReflectivityRange) {
            if (calcR < point.reflectivityMin) {
              const v = point.reflectivityMin - calcR;
              totalViolation += v * v;
              pointMaxViolation = Math.max(pointMaxViolation, v);
              pointPass = false;
            } else if (calcR > point.reflectivityMax) {
              const v = calcR - point.reflectivityMax;
              totalViolation += v * v;
              pointMaxViolation = Math.max(pointMaxViolation, v);
              pointPass = false;
            }
          } else {
            if (d > 1.0) {
              totalViolation += (d - 1.0) * (d - 1.0);
              pointMaxViolation = Math.max(pointMaxViolation, d);
              pointPass = false;
            }
          }
        }
        perTarget.push({ pass: pointPass, deviation: pointMaxViolation });
      });
    }

    const error = errorCount > 0 ? Math.sqrt(errorSum / errorCount) : 0;
    // Soft penalty for non-alternating H/L adjacent layers (delamination risk)
    let alternationPenalty = 0;
    for (let i = 1; i < testLayers.length; i++) {
      if (classifyMaterialIndex(testLayers[i - 1].material) === classifyMaterialIndex(testLayers[i].material)) {
        alternationPenalty += 0.5;
      }
    }
    const score = error + totalViolation * 10 + alternationPenalty;
    return { score, error, maxDeviation, violation: totalViolation, perTarget };
  };


  const optimizeDesign = async () => {
    // Tier gating
    if (!tierLimits.designAssistant) {
      setUpgradeFeature('Design Assistant');
      setShowUpgradePrompt(true);
      return;
    }
    // Validation
    if (!reverseEngineerMode && designPoints.length === 0) {
      showToast("Please add at least one target point or upload a CSV file for reverse engineering", 'error');
      return;
    }
    if (reverseEngineerMode && !reverseEngineerData) {
      showToast("Please upload a CSV file for reverse engineering", 'error');
      return;
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

    // Budget scaling — maps user iteration count to work multipliers
    const budgetScale = Math.max(1, numIterations / 50000);
    const seedBudget = Math.round(numIterations * 0.5);
    const topSeedCount = Math.min(100, Math.max(20, Math.round(10 * budgetScale)));
    const sweepMultiplier = Math.max(1, Math.sqrt(budgetScale));
    const shakeRounds = Math.min(12, Math.max(3, Math.round(3 * budgetScale)));
    const shakeSolutions = Math.min(15, Math.max(5, Math.round(5 * Math.sqrt(budgetScale))));
    const lmSolutions = Math.min(20, Math.max(8, Math.round(8 * Math.sqrt(budgetScale))));
    const lmMaxIters = Math.min(400, Math.max(150, Math.round(150 * Math.sqrt(budgetScale))));
    const swapSolutions = Math.min(10, Math.max(5, Math.round(5 * Math.sqrt(budgetScale))));
    const finalLMSolutions = Math.min(10, Math.max(5, Math.round(5 * Math.sqrt(budgetScale))));
    const finalLMIters = Math.min(200, Math.max(80, Math.round(80 * Math.sqrt(budgetScale))));

    // ===== PHASE 1: Seed Generation =====
    const seeds = [];
    let validSeedCount = 0;

    // Determine reference wavelengths for quarter-wave seeding
    let qwotWavelengths = [];
    if (!reverseEngineerMode && designPoints.length > 0) {
      qwotWavelengths = designPoints.map(p => (p.wavelengthMin + p.wavelengthMax) / 2);
    } else if (reverseEngineerMode && reverseEngineerData && reverseEngineerData.length > 0) {
      // Use the median wavelength from CSV data
      const sortedWl = reverseEngineerData.map(d => d.wavelength).sort((a, b) => a - b);
      qwotWavelengths = [sortedWl[Math.floor(sortedWl.length / 2)]];
    }

    // Classify palette materials into High/Low index groups for alternation
    const highMats = paletteMats.filter(m => classifyMaterialIndex(m) === 'H');
    const lowMats = paletteMats.filter(m => classifyMaterialIndex(m) === 'L');
    const canAlternate = highMats.length > 0 && lowMats.length > 0;

    // ----- Phase 1A: Differential Evolution (population-based global search) -----
    if (!useLayerTemplate) {
      const dePopSize = Math.min(40, Math.max(15, Math.round(15 * Math.sqrt(budgetScale))));
      const deGenerations = Math.min(100, Math.max(20, Math.round(20 * budgetScale)));
      const F = 0.8;  // Mutation factor
      const CR = 0.7; // Crossover rate

      // Build alternating material sequences for different layer counts
      const buildAlternatingMats = (nLayers) => {
        const mats = [];
        for (let i = 0; i < nLayers; i++) {
          if (canAlternate) {
            const group = (i % 2 === 0) ? highMats : lowMats;
            mats.push(group[Math.floor(Math.random() * group.length)]);
          } else {
            mats.push(paletteMats[Math.floor(Math.random() * paletteMats.length)]);
          }
        }
        return mats;
      };

      // Run DE for 2-3 layer count configurations
      const deCounts = new Set([minLayers, maxLayers, Math.round((minLayers + maxLayers) / 2)]);

      for (const nLayers of deCounts) {
        setOptimizationStage(`Phase 1A: Differential Evolution (${nLayers} layers)...`);
        await new Promise(resolve => setTimeout(resolve, 0));

        // Initialize population
        const pop = [];
        for (let i = 0; i < dePopSize; i++) {
          const mats = buildAlternatingMats(nLayers);
          const layers = mats.map((mat, j) => ({
            id: j, material: mat, thickness: 10 + Math.random() * 250
          }));
          const result = calculateCombinedScore(layers);
          pop.push({ layers, score: result.score, result });
        }

        // Evolve
        for (let gen = 0; gen < deGenerations; gen++) {
          for (let i = 0; i < dePopSize; i++) {
            // Select 3 distinct random indices != i
            let a, b, c;
            do { a = Math.floor(Math.random() * dePopSize); } while (a === i);
            do { b = Math.floor(Math.random() * dePopSize); } while (b === i || b === a);
            do { c = Math.floor(Math.random() * dePopSize); } while (c === i || c === a || c === b);

            // Mutation + crossover (evolve thicknesses only, materials stay fixed)
            const jRand = Math.floor(Math.random() * nLayers);
            const trial = pop[i].layers.map((l, j) => ({
              ...l,
              thickness: (Math.random() < CR || j === jRand)
                ? Math.max(5, Math.min(500, pop[a].layers[j].thickness + F * (pop[b].layers[j].thickness - pop[c].layers[j].thickness)))
                : l.thickness
            }));

            const trialResult = calculateCombinedScore(trial);
            if (trialResult.score <= pop[i].score) {
              pop[i] = { layers: trial, score: trialResult.score, result: trialResult };
            }
          }

          if (gen % 10 === 0) {
            setOptimizationProgress((gen / deGenerations) * 5);
            await new Promise(resolve => setTimeout(resolve, 0));
          }
        }

        // Add DE population as seeds
        for (const member of pop) {
          const r = member.result;
          if (r.violation === 0) validSeedCount++;
          seeds.push({
            layers: member.layers,
            score: r.score,
            error: r.error,
            maxDeviation: r.maxDeviation,
            violation: r.violation,
            perTarget: r.perTarget,
          });
        }
      }
    }

    // ----- Phase 1B: Random seeding (remaining budget) -----
    const randomBudget = Math.round(seedBudget * (useLayerTemplate ? 1.0 : 0.4));
    const minExplored = Math.round(randomBudget * 0.4);
    for (let iter = 0; iter < randomBudget; iter++) {
      if (iter % 500 === 0) {
        setOptimizationProgress(5 + (iter / randomBudget) * 15);
        setOptimizationStage(`Phase 1B: Random seeds... ${validSeedCount} valid seeds (${iter.toLocaleString()}/${randomBudget.toLocaleString()})`);
        await new Promise(resolve => setTimeout(resolve, 0));

        // Early termination: scale with budget, require exploring at least 40%
        if (validSeedCount >= topSeedCount * 2 && iter >= minExplored) break;
        if (iter >= Math.round(randomBudget * 0.6) && validSeedCount === 0) break;
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
        const numLayersForSeed = minLayers + Math.floor(Math.random() * (maxLayers - minLayers + 1));
        // Use quarter-wave seeding for first 40% of iterations, random for rest
        const useQWOT = qwotWavelengths.length > 0 && iter < seedBudget * 0.4;

        for (let i = 0; i < numLayersForSeed; i++) {
          let candidates;
          if (canAlternate && i > 0) {
            // Enforce H/L alternation: pick from opposite group
            const prevClass = classifyMaterialIndex(testLayers[i - 1].material);
            candidates = prevClass === 'H' ? lowMats : highMats;
          } else if (canAlternate && i === 0) {
            // First layer: randomly pick H or L
            candidates = Math.random() < 0.5 ? highMats : lowMats;
          } else {
            // Only one index group available: just avoid repeats
            const prevMat = i > 0 ? testLayers[i - 1].material : null;
            candidates = paletteMats.length > 1 ? paletteMats.filter(m => m !== prevMat) : paletteMats;
          }
          const material = candidates[Math.floor(Math.random() * candidates.length)];

          let thickness;
          if (useQWOT) {
            // Quarter-wave optical thickness: physical thickness = λ / (4 * n)
            // Use a random target wavelength and random multiplier (1x, 2x, 3x QWOT)
            const refLambda = qwotWavelengths[Math.floor(Math.random() * qwotWavelengths.length)];
            const n = getRefractiveIndex(material, refLambda);
            const qwot = refLambda / (4 * n);
            // Random multiplier: 1-4 quarter-waves, with ±20% jitter
            const multiplier = 1 + Math.floor(Math.random() * 4);
            thickness = qwot * multiplier * (0.8 + Math.random() * 0.4);
            thickness = Math.max(10, Math.min(500, thickness));
          } else {
            thickness = 10 + Math.random() * 250;
          }

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
    const topSeeds = seeds.slice(0, topSeedCount);

    // ===== PHASE 2: Needle Refinement =====
    setOptimizationStage(`Phase 2: Refining ${topSeeds.length} solutions...`);
    setOptimizationProgress(20);
    await new Promise(resolve => setTimeout(resolve, 0));

    const refinementPasses = [
      { stepSizes: [50, 20], maxSweeps: Math.round(10 * sweepMultiplier) },
      { stepSizes: [10, 5], maxSweeps: Math.round(15 * sweepMultiplier) },
      { stepSizes: [2, 1], maxSweeps: Math.round(15 * sweepMultiplier) },
      { stepSizes: [0.5, 0.2], maxSweeps: Math.round(20 * sweepMultiplier) },
    ];

    const refinedSolutions = [];

    for (let seedIdx = 0; seedIdx < topSeeds.length; seedIdx++) {
      setOptimizationProgress(20 + (seedIdx / topSeeds.length) * 15);
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
              // Merge adjacent same-material layers (removal may have created neighbors)
              const merged = [currentLayers[0]];
              for (let mi = 1; mi < currentLayers.length; mi++) {
                if (currentLayers[mi].material === merged[merged.length - 1].material) {
                  merged[merged.length - 1].thickness += currentLayers[mi].thickness;
                } else {
                  merged.push(currentLayers[mi]);
                }
              }
              currentLayers = merged;
              // Re-index
              currentLayers.forEach((l, i) => { l.id = i; });
              currentResult = calculateCombinedScore(currentLayers);
            }
          }

          // Check convergence — stop when score barely changes between sweeps
          const improvement = prevScore - currentResult.score;
          if (improvement >= 0 && improvement < Math.max(currentResult.score * 0.0001, 0.001)) break;
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

    // ===== PHASE 2B: Shake and Re-refine (basin hopping) =====
    setOptimizationStage("Phase 2B: Escaping local minima...");
    setOptimizationProgress(35);
    await new Promise(resolve => setTimeout(resolve, 0));

    const shakeRefinePasses = [
      { stepSizes: [10, 5], maxSweeps: Math.round(10 * sweepMultiplier) },
      { stepSizes: [2, 1], maxSweeps: Math.round(10 * sweepMultiplier) },
      { stepSizes: [0.5, 0.2], maxSweeps: Math.round(15 * sweepMultiplier) },
    ];
    const topForShake = refinedSolutions.sort((a, b) => a.score - b.score).slice(0, shakeSolutions);

    for (let shakeRound = 0; shakeRound < shakeRounds; shakeRound++) {
      setOptimizationStage(`Phase 2B: Shake round ${shakeRound + 1}/${shakeRounds} — best error: ${topForShake[0]?.error.toFixed(2) || '?'}%`);
      setOptimizationProgress(35 + (shakeRound / shakeRounds) * 10);
      await new Promise(resolve => setTimeout(resolve, 0));

      for (const sol of topForShake) {
        // Strip adhesion layer for perturbation
        const hasAdhesion = useAdhesionLayer && sol.layers.length > 0 && sol.layers[0].id === -1;
        const adhesionLayer = hasAdhesion ? sol.layers[0] : null;
        const shakeLayers = JSON.parse(JSON.stringify(hasAdhesion ? sol.layers.slice(1) : sol.layers));

        // Perturb all thicknesses by ±15-25%
        for (const layer of shakeLayers) {
          const perturbFactor = 0.75 + Math.random() * 0.5; // 0.75 to 1.25
          layer.thickness = Math.max(5, layer.thickness * perturbFactor);
          if (useLayerTemplate && layerTemplate[layer.id]) {
            layer.thickness = Math.max(layerTemplate[layer.id].minThickness || 5,
              Math.min(layerTemplate[layer.id].maxThickness || 500, layer.thickness));
          }
        }

        // Re-refine the perturbed stack
        let shakeResult = calculateCombinedScore(shakeLayers);
        for (const pass of shakeRefinePasses) {
          for (let sweep = 0; sweep < pass.maxSweeps; sweep++) {
            const prevScore = shakeResult.score;
            for (let li = 0; li < shakeLayers.length; li++) {
              const origT = shakeLayers[li].thickness;
              let bestScore = shakeResult.score;
              let bestT = origT;
              for (const step of pass.stepSizes) {
                for (const sign of [1, -1]) {
                  const nt = origT + sign * step;
                  if (nt < 5) continue;
                  if (useLayerTemplate && layerTemplate[li]) {
                    if (nt < (layerTemplate[li].minThickness || 5) || nt > (layerTemplate[li].maxThickness || 500)) continue;
                  }
                  shakeLayers[li].thickness = nt;
                  const tr = calculateCombinedScore(shakeLayers);
                  if (tr.score < bestScore) { bestScore = tr.score; bestT = nt; }
                }
              }
              shakeLayers[li].thickness = bestT;
              if (bestT !== origT) shakeResult = calculateCombinedScore(shakeLayers);
            }
            const imp = prevScore - shakeResult.score;
            if (imp >= 0 && imp < Math.max(shakeResult.score * 0.0001, 0.001)) break;
          }
        }

        // Keep the shaken result if it's better
        if (shakeResult.score < sol.score) {
          sol.layers = adhesionLayer ? [adhesionLayer, ...JSON.parse(JSON.stringify(shakeLayers))] : JSON.parse(JSON.stringify(shakeLayers));
          sol.score = shakeResult.score;
          sol.error = shakeResult.error;
          sol.maxDeviation = shakeResult.maxDeviation;
          sol.violation = shakeResult.violation;
          sol.perTarget = shakeResult.perTarget;
        }
      }
    }

    // ===== PHASE 2.5: Needle Insertion (OptiLayer-style layer insertion) =====
    if (!useLayerTemplate) {
      setOptimizationStage("Phase 2.5: Needle insertion...");
      setOptimizationProgress(45);
      await new Promise(resolve => setTimeout(resolve, 0));

      const needleSolutions = Math.min(8, Math.max(3, Math.round(3 * Math.sqrt(budgetScale))));
      const topForNeedle = refinedSolutions.sort((a, b) => a.score - b.score).slice(0, needleSolutions);

      for (let nsi = 0; nsi < topForNeedle.length; nsi++) {
        const sol = topForNeedle[nsi];
        if (nsi % 2 === 0) {
          setOptimizationStage(`Phase 2.5: Needle insertion ${nsi + 1}/${topForNeedle.length} — error: ${sol.error.toFixed(2)}%`);
          await new Promise(resolve => setTimeout(resolve, 0));
        }

        // Strip adhesion layer
        const hasAdhesion = useAdhesionLayer && sol.layers.length > 0 && sol.layers[0].id === -1;
        const adhesionLayer = hasAdhesion ? sol.layers[0] : null;
        let workLayers = JSON.parse(JSON.stringify(hasAdhesion ? sol.layers.slice(1) : sol.layers));

        let needleImproved = true;
        while (needleImproved && workLayers.length < maxLayers) {
          needleImproved = false;
          let bestInsertScore = calculateCombinedScore(workLayers).score;
          let bestInsertPos = -1;
          let bestInsertMat = null;

          // Try inserting a thin needle at every position
          for (let pos = 0; pos <= workLayers.length; pos++) {
            for (const mat of paletteMats) {
              // Enforce H/L alternation at insertion point
              if (canAlternate) {
                const leftMat = pos > 0 ? workLayers[pos - 1].material : null;
                const rightMat = pos < workLayers.length ? workLayers[pos].material : null;
                const matClass = classifyMaterialIndex(mat);
                if (leftMat && matClass === classifyMaterialIndex(leftMat)) continue;
                if (rightMat && matClass === classifyMaterialIndex(rightMat)) continue;
              }

              // Insert 5nm needle and score
              const testLayers = JSON.parse(JSON.stringify(workLayers));
              testLayers.splice(pos, 0, { id: 999, material: mat, thickness: 5 });
              const testResult = calculateCombinedScore(testLayers);

              if (testResult.score < bestInsertScore - 0.01) {
                bestInsertScore = testResult.score;
                bestInsertPos = pos;
                bestInsertMat = mat;
              }
            }
          }

          if (bestInsertPos >= 0) {
            // Accept the best insertion
            workLayers.splice(bestInsertPos, 0, { id: 999, material: bestInsertMat, thickness: 5 });
            workLayers.forEach((l, idx) => { l.id = idx; });

            // Quick coordinate descent refinement on the expanded stack
            const needleRefPasses = [
              { stepSizes: [20, 10], maxSweeps: 5 },
              { stepSizes: [5, 2], maxSweeps: 5 },
              { stepSizes: [1, 0.5], maxSweeps: 5 },
            ];
            let currentResult = calculateCombinedScore(workLayers);
            for (const pass of needleRefPasses) {
              for (let sweep = 0; sweep < pass.maxSweeps; sweep++) {
                const prevScore = currentResult.score;
                for (let li = 0; li < workLayers.length; li++) {
                  const originalThickness = workLayers[li].thickness;
                  let bScore = currentResult.score;
                  let bThick = originalThickness;
                  for (const step of pass.stepSizes) {
                    for (const sign of [1, -1]) {
                      const nt = originalThickness + sign * step;
                      if (nt < 3) continue;
                      workLayers[li].thickness = nt;
                      const tr = calculateCombinedScore(workLayers);
                      if (tr.score < bScore) { bScore = tr.score; bThick = nt; }
                    }
                  }
                  workLayers[li].thickness = bThick;
                  if (bThick !== originalThickness) currentResult = calculateCombinedScore(workLayers);
                }
                const imp = prevScore - currentResult.score;
                if (imp >= 0 && imp < Math.max(currentResult.score * 0.0001, 0.001)) break;
              }
            }

            // Remove layers that stayed very thin (needle didn't grow)
            workLayers = workLayers.filter(l => l.thickness >= 3);
            workLayers.forEach((l, idx) => { l.id = idx; });

            needleImproved = true;
          }
        }

        // Merge adjacent same-material layers if any were created
        if (workLayers.length > 1) {
          const merged = [{ ...workLayers[0] }];
          for (let mi = 1; mi < workLayers.length; mi++) {
            if (workLayers[mi].material === merged[merged.length - 1].material) {
              merged[merged.length - 1].thickness += workLayers[mi].thickness;
            } else {
              merged.push({ ...workLayers[mi] });
            }
          }
          if (merged.length < workLayers.length) {
            workLayers = merged;
            workLayers.forEach((l, idx) => { l.id = idx; });
          }
        }

        const needleResult = calculateCombinedScore(workLayers);
        if (needleResult.score < sol.score) {
          sol.layers = adhesionLayer
            ? [adhesionLayer, ...JSON.parse(JSON.stringify(workLayers))]
            : JSON.parse(JSON.stringify(workLayers));
          sol.score = needleResult.score;
          sol.error = needleResult.error;
          sol.maxDeviation = needleResult.maxDeviation;
          sol.violation = needleResult.violation;
          sol.perTarget = needleResult.perTarget;
        }
      }
    }

    // ===== PHASE 2C: Levenberg-Marquardt Polishing =====
    {
      setOptimizationStage("Phase 2C: Levenberg-Marquardt refinement...");
      setOptimizationProgress(60);
      await new Promise(resolve => setTimeout(resolve, 0));

      // Build evaluation wavelengths and targets once
      const lmEvalPoints = [];
      if (reverseEngineerMode && reverseEngineerData) {
        for (const dp of reverseEngineerData) {
          lmEvalPoints.push({ wavelength: dp.wavelength, target: dp.reflectivity });
        }
      } else {
        for (const point of designPoints) {
          const targetValue = (point.reflectivityMin + point.reflectivityMax) / 2;
          if (point.useWavelengthRange) {
            for (let lambda = point.wavelengthMin; lambda <= point.wavelengthMax; lambda += 5) {
              lmEvalPoints.push({ wavelength: lambda, target: targetValue });
            }
          } else {
            const lambda = (point.wavelengthMin + point.wavelengthMax) / 2;
            lmEvalPoints.push({ wavelength: lambda, target: targetValue });
          }
        }
      }

      // Compute residual vector: r_i = calcR(λ_i) - target_i
      const computeLMResiduals = (lmLayers) => {
        const r = new Array(lmEvalPoints.length);
        for (let i = 0; i < lmEvalPoints.length; i++) {
          let calcR = calculateReflectivityAtWavelength(lmEvalPoints[i].wavelength, lmLayers);
          if (reverseEngineerMode && doubleSidedAR) {
            calcR = applyBackSurfaceCorrection(calcR, substrate.n);
          }
          r[i] = calcR * 100 - lmEvalPoints[i].target;
        }
        return r;
      };

      const topForLM = refinedSolutions.sort((a, b) => a.score - b.score).slice(0, lmSolutions);

      for (let solIdx = 0; solIdx < topForLM.length; solIdx++) {
        const sol = topForLM[solIdx];
        if (solIdx % 2 === 0) {
          setOptimizationStage(`Phase 2C: LM refining solution ${solIdx + 1}/${topForLM.length} — error: ${sol.error.toFixed(2)}%`);
          await new Promise(resolve => setTimeout(resolve, 0));
        }

        // Strip adhesion layer for optimization
        const hasAdhesion = useAdhesionLayer && sol.layers.length > 0 && sol.layers[0].id === -1;
        const adhesionLayer = hasAdhesion ? sol.layers[0] : null;
        const lmLayers = JSON.parse(JSON.stringify(hasAdhesion ? sol.layers.slice(1) : sol.layers));
        const nParams = lmLayers.length;
        if (nParams === 0 || lmEvalPoints.length === 0) continue;

        // Thickness bounds
        const minThick = lmLayers.map((_, i) => {
          if (useLayerTemplate && layerTemplate[i]) return layerTemplate[i].minThickness || 5;
          return 5;
        });
        const maxThick = lmLayers.map((_, i) => {
          if (useLayerTemplate && layerTemplate[i]) return layerTemplate[i].maxThickness || 2000;
          return 2000;
        });

        // Run LM with one restart (perturb + re-converge to escape shallow local minima)
        for (let lmRun = 0; lmRun < 2; lmRun++) {
          if (lmRun === 1) {
            // Restart: perturb thicknesses by ±1% and reset damping
            for (let j = 0; j < nParams; j++) {
              const perturbFactor = 0.99 + Math.random() * 0.02;
              lmLayers[j].thickness = Math.max(minThick[j],
                Math.min(maxThick[j], lmLayers[j].thickness * perturbFactor));
            }
          }

        let residuals = computeLMResiduals(lmLayers);
        let cost = 0;
        for (let i = 0; i < residuals.length; i++) cost += residuals[i] * residuals[i];
        let lambda = lmRun === 0 ? 1e-3 : 1e-2;

        for (let iter = 0; iter < lmMaxIters; iter++) {
          const nRes = residuals.length;

          // Compute Jacobian columns via central differences with adaptive step
          const JtJ = Array.from({ length: nParams }, () => new Float64Array(nParams));
          const Jtr = new Float64Array(nParams);
          const Jcols = [];

          for (let j = 0; j < nParams; j++) {
            const origT = lmLayers[j].thickness;
            const dt_j = Math.max(0.01, Math.min(0.1, origT * 0.001));
            lmLayers[j].thickness = origT + dt_j;
            const rPlus = computeLMResiduals(lmLayers);
            lmLayers[j].thickness = origT - dt_j;
            const rMinus = computeLMResiduals(lmLayers);
            lmLayers[j].thickness = origT;

            const col = new Float64Array(nRes);
            for (let i = 0; i < nRes; i++) col[i] = (rPlus[i] - rMinus[i]) / (2 * dt_j);
            Jcols.push(col);
          }

          // Accumulate J^T J (symmetric) and J^T r
          for (let j = 0; j < nParams; j++) {
            for (let k = j; k < nParams; k++) {
              let sum = 0;
              for (let i = 0; i < nRes; i++) sum += Jcols[j][i] * Jcols[k][i];
              JtJ[j][k] = sum;
              JtJ[k][j] = sum;
            }
            let sum = 0;
            for (let i = 0; i < nRes; i++) sum += Jcols[j][i] * residuals[i];
            Jtr[j] = sum;
          }

          // Damped normal equations: (J^T J + λ·diag(J^T J)) δ = -J^T r
          const damped = JtJ.map((row, i) => {
            const newRow = Array.from(row);
            newRow[i] += lambda * Math.max(newRow[i], 1e-6);
            return newRow;
          });
          const negJtr = Array.from(Jtr).map(v => -v);
          const delta = solveLinear(damped, negJtr);
          if (!delta) break;

          // Trial step with bounds clamping
          const savedThicknesses = lmLayers.map(l => l.thickness);
          for (let j = 0; j < nParams; j++) {
            lmLayers[j].thickness = Math.max(minThick[j],
              Math.min(maxThick[j], savedThicknesses[j] + delta[j]));
          }

          const trialResiduals = computeLMResiduals(lmLayers);
          let trialCost = 0;
          for (let i = 0; i < trialResiduals.length; i++) trialCost += trialResiduals[i] * trialResiduals[i];

          if (trialCost < cost) {
            // Accept step, decrease damping
            residuals = trialResiduals;
            cost = trialCost;
            lambda *= 0.3;
            lambda = Math.max(lambda, 1e-12);
          } else {
            // Reject step, restore thicknesses, increase damping
            for (let j = 0; j < nParams; j++) lmLayers[j].thickness = savedThicknesses[j];
            lambda *= 10;
            if (lambda > 1e12) break;
          }

          // Convergence: max thickness change < 0.005 nm
          if (Math.max(...delta.map(Math.abs)) < 0.005) break;
        }
        } // end lmRun restart loop

        // Re-score with full merit function (includes constraint violations)
        const lmResult = calculateCombinedScore(lmLayers);
        if (lmResult.score < sol.score) {
          sol.layers = adhesionLayer
            ? [adhesionLayer, ...JSON.parse(JSON.stringify(lmLayers))]
            : JSON.parse(JSON.stringify(lmLayers));
          sol.score = lmResult.score;
          sol.error = lmResult.error;
          sol.maxDeviation = lmResult.maxDeviation;
          sol.violation = lmResult.violation;
          sol.perTarget = lmResult.perTarget;
        }
      }
    }

    // ===== PHASE 3: Material Swapping =====
    setOptimizationStage("Phase 3: Testing material swaps...");
    setOptimizationProgress(75);
    await new Promise(resolve => setTimeout(resolve, 0));

    let improvementsFound = 0;

    if (!useLayerTemplate && paletteMats.length > 1) {
      const topForSwap = refinedSolutions.sort((a, b) => a.score - b.score).slice(0, swapSolutions);

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

          // Skip materials that would violate H/L alternation or create mergeable 3-in-a-row
          const prevMat = layerIdx > 0 ? swapLayers[layerIdx - 1].material : null;
          const nextMat = layerIdx < swapLayers.length - 1 ? swapLayers[layerIdx + 1].material : null;
          const prevClass = prevMat ? classifyMaterialIndex(prevMat) : null;
          const nextClass = nextMat ? classifyMaterialIndex(nextMat) : null;

          for (const mat of paletteMats) {
            if (mat === originalMaterial) continue;
            if (mat === prevMat && mat === nextMat) continue;
            // Skip if same index class as BOTH neighbors (guaranteed delamination risk)
            const matClass = classifyMaterialIndex(mat);
            if (canAlternate && prevClass && nextClass && matClass === prevClass && matClass === nextClass) continue;
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

        // Merge adjacent same-material layers created by swaps
        const coreLayers = adhesionLayer ? sol.layers.slice(1) : sol.layers;
        if (coreLayers.length > 1) {
          const merged = [{ ...coreLayers[0] }];
          for (let mi = 1; mi < coreLayers.length; mi++) {
            if (coreLayers[mi].material === merged[merged.length - 1].material) {
              merged[merged.length - 1].thickness += coreLayers[mi].thickness;
            } else {
              merged.push({ ...coreLayers[mi] });
            }
          }
          if (merged.length < coreLayers.length) {
            merged.forEach((l, i) => { l.id = i; });
            const mergedResult = calculateCombinedScore(merged);
            sol.layers = adhesionLayer ? [adhesionLayer, ...merged] : merged;
            sol.score = mergedResult.score;
            sol.error = mergedResult.error;
            sol.maxDeviation = mergedResult.maxDeviation;
            sol.violation = mergedResult.violation;
            sol.perTarget = mergedResult.perTarget;
          }
        }
      }
    }

    setOptimizationStage(`Phase 3: Testing material swaps... ${improvementsFound} improvements found`);

    // ===== PHASE 4: Final LM Polish (re-converge after material swaps) =====
    if (improvementsFound > 0) {
      setOptimizationStage("Phase 4: Final LM polish...");
      setOptimizationProgress(85);
      await new Promise(resolve => setTimeout(resolve, 0));

      // Re-use lmEvalPoints from Phase 2C (still in scope)
      const lmEvalPointsFinal = [];
      if (reverseEngineerMode && reverseEngineerData) {
        for (const dp of reverseEngineerData) {
          lmEvalPointsFinal.push({ wavelength: dp.wavelength, target: dp.reflectivity });
        }
      } else {
        for (const point of designPoints) {
          const targetValue = (point.reflectivityMin + point.reflectivityMax) / 2;
          if (point.useWavelengthRange) {
            for (let lambda = point.wavelengthMin; lambda <= point.wavelengthMax; lambda += 5) {
              lmEvalPointsFinal.push({ wavelength: lambda, target: targetValue });
            }
          } else {
            const lambda = (point.wavelengthMin + point.wavelengthMax) / 2;
            lmEvalPointsFinal.push({ wavelength: lambda, target: targetValue });
          }
        }
      }

      const computeFinalResiduals = (lmLayers) => {
        const r = new Array(lmEvalPointsFinal.length);
        for (let i = 0; i < lmEvalPointsFinal.length; i++) {
          let calcR = calculateReflectivityAtWavelength(lmEvalPointsFinal[i].wavelength, lmLayers);
          if (reverseEngineerMode && doubleSidedAR) {
            calcR = applyBackSurfaceCorrection(calcR, substrate.n);
          }
          r[i] = calcR * 100 - lmEvalPointsFinal[i].target;
        }
        return r;
      };

      const topForFinalLM = refinedSolutions.sort((a, b) => a.score - b.score).slice(0, finalLMSolutions);
      for (const sol of topForFinalLM) {
        const hasAdhesion = useAdhesionLayer && sol.layers.length > 0 && sol.layers[0].id === -1;
        const adhesionLayer = hasAdhesion ? sol.layers[0] : null;
        const lmLayers = JSON.parse(JSON.stringify(hasAdhesion ? sol.layers.slice(1) : sol.layers));
        const nParams = lmLayers.length;
        if (nParams === 0 || lmEvalPointsFinal.length === 0) continue;

        const minThick = lmLayers.map((_, i) => {
          if (useLayerTemplate && layerTemplate[i]) return layerTemplate[i].minThickness || 5;
          return 5;
        });
        const maxThick = lmLayers.map((_, i) => {
          if (useLayerTemplate && layerTemplate[i]) return layerTemplate[i].maxThickness || 2000;
          return 2000;
        });

        let residuals = computeFinalResiduals(lmLayers);
        let cost = 0;
        for (let i = 0; i < residuals.length; i++) cost += residuals[i] * residuals[i];
        let lambda = 1e-3;

        for (let iter = 0; iter < finalLMIters; iter++) {
          const nRes = residuals.length;
          const JtJ = Array.from({ length: nParams }, () => new Float64Array(nParams));
          const Jtr = new Float64Array(nParams);
          const Jcols = [];

          for (let j = 0; j < nParams; j++) {
            const origT = lmLayers[j].thickness;
            const dt_j = Math.max(0.01, Math.min(0.1, origT * 0.001));
            lmLayers[j].thickness = origT + dt_j;
            const rPlus = computeFinalResiduals(lmLayers);
            lmLayers[j].thickness = origT - dt_j;
            const rMinus = computeFinalResiduals(lmLayers);
            lmLayers[j].thickness = origT;
            const col = new Float64Array(nRes);
            for (let i = 0; i < nRes; i++) col[i] = (rPlus[i] - rMinus[i]) / (2 * dt_j);
            Jcols.push(col);
          }

          for (let j = 0; j < nParams; j++) {
            for (let k = j; k < nParams; k++) {
              let sum = 0;
              for (let i = 0; i < nRes; i++) sum += Jcols[j][i] * Jcols[k][i];
              JtJ[j][k] = sum;
              JtJ[k][j] = sum;
            }
            let sum = 0;
            for (let i = 0; i < nRes; i++) sum += Jcols[j][i] * residuals[i];
            Jtr[j] = sum;
          }

          const damped = JtJ.map((row, i) => {
            const newRow = Array.from(row);
            newRow[i] += lambda * Math.max(newRow[i], 1e-6);
            return newRow;
          });
          const negJtr = Array.from(Jtr).map(v => -v);
          const delta = solveLinear(damped, negJtr);
          if (!delta) break;

          const savedThicknesses = lmLayers.map(l => l.thickness);
          for (let j = 0; j < nParams; j++) {
            lmLayers[j].thickness = Math.max(minThick[j],
              Math.min(maxThick[j], savedThicknesses[j] + delta[j]));
          }

          const trialResiduals = computeFinalResiduals(lmLayers);
          let trialCost = 0;
          for (let i = 0; i < trialResiduals.length; i++) trialCost += trialResiduals[i] * trialResiduals[i];

          if (trialCost < cost) {
            residuals = trialResiduals;
            cost = trialCost;
            lambda *= 0.3;
            lambda = Math.max(lambda, 1e-12);
          } else {
            for (let j = 0; j < nParams; j++) lmLayers[j].thickness = savedThicknesses[j];
            lambda *= 10;
            if (lambda > 1e12) break;
          }

          if (Math.max(...delta.map(Math.abs)) < 0.005) break;
        }

        const lmResult = calculateCombinedScore(lmLayers);
        if (lmResult.score < sol.score) {
          sol.layers = adhesionLayer
            ? [adhesionLayer, ...JSON.parse(JSON.stringify(lmLayers))]
            : JSON.parse(JSON.stringify(lmLayers));
          sol.score = lmResult.score;
          sol.error = lmResult.error;
          sol.maxDeviation = lmResult.maxDeviation;
          sol.violation = lmResult.violation;
          sol.perTarget = lmResult.perTarget;
        }
      }
    }

    // ===== FINAL: Sort, deduplicate, filter =====
    setOptimizationStage("Finalizing solutions...");
    setOptimizationProgress(95);
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

    // Filter by error threshold
    const qualified = deduplicated.filter(s => s.error < maxErrorThreshold);

    let finalSolutions;
    if (qualified.length >= 1) {
      finalSolutions = qualified.slice(0, 5);
    } else if (deduplicated.length > 0) {
      // Always show best solutions even if above error threshold, with a warning
      finalSolutions = deduplicated.slice(0, 5);
      const bestError = deduplicated[0].error.toFixed(2);
      showToast(`Best solutions have ${bestError}% RMS error (above ${maxErrorThreshold}% threshold). Try: adding more materials, increasing layer count, or raising Max Error.`, 'error');
    } else {
      // No solutions meet criteria
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

      // Final 2nm validation pass for hard constraints
      const finalCheck = calculateConstraintViolation(sol.layers, 2);

      return {
        ...sol,
        chartData: data,
        id: idx + 1,
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
      // On mobile, auto-switch to solutions view
      if (solutionsWithData.length > 0) setMobileAssistantView('solutions');
    }, 500);
  };

  const addSolutionAsStack = (solution) => {
    // Create a new layer stack with the solution layers
    const newId = Math.max(...layerStacks.map((s) => s.id), 0) + 1;
    const colors = [
      "#4f46e5",
      "#ef4444",
      "#10b981",
      "#f59e0b",
      "#8b5cf6",
      "#ec4899",
      "#06b6d4",
      "#84cc16",
    ];

    const newLayers = solution.layers.map((l, idx) => ({ ...l, id: idx + 1 }));

    const newStack = {
      id: newId,
      machineId: currentMachineId,
      name: `Solution ${solution.id}`,
      layers: newLayers,
      visible: true,
      color: colors[(newId - 1) % colors.length],
    };

    setLayerStacks([...layerStacks, newStack]);
    setCurrentStackId(newId);
    setLayers(newLayers); // IMPORTANT: Set the layers state so they display in the editor
    prevLayersRef.current = JSON.stringify(newLayers);
    setActiveTab("designer");
  };

  // IAD Modal Component
  const IADModal = () => {
    const layer = layers.find((l) => l.id === currentIADLayer);
    const currentSettings = layer 
      ? (layer.iad || getDefaultIADSettings(layer.material))
      : getDefaultIADSettings("SiO2");
    // Include layer's packing density in the config
    const initialConfig = {
      ...currentSettings,
      packingDensity: layer?.packingDensity || currentSettings.packingDensity || 1.0,
    };
    const [iadConfig, setIADConfig] = useState(initialConfig);
    
    if (!layer) return null;

    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-white rounded-lg p-6 max-w-md w-full">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg font-semibold">
              IAD Settings - Layer{" "}
              {layers.findIndex((l) => l.id === layer.id) + 1}
            </h3>
            <button
              onClick={() => setShowIADModal(false)}
              className="text-gray-500 hover:text-gray-700"
            >
              <X size={20} />
            </button>
          </div>

          <div className="mb-4 p-3 bg-blue-50 rounded text-sm">
            <p className="font-semibold mb-1">Material: {layer.material}</p>
            <p className="text-gray-600">
              Default RI increase:{" "}
              {allMaterials[layer.material]?.iadIncrease || 0}%
            </p>
          </div>

          <div className="space-y-4">
            <div>
              <label className="flex items-center space-x-2 mb-3">
                <input
                  type="checkbox"
                  checked={iadConfig.enabled}
                  onChange={(e) =>
                    setIADConfig({ ...iadConfig, enabled: e.target.checked })
                  }
                  className="w-4 h-4"
                />
                <span className="font-medium">Enable IAD</span>
              </label>
            </div>

            {iadConfig.enabled && (
              <>
                <div>
                  <label className="block text-sm font-medium mb-1">
                    Ion Source Voltage (V)
                  </label>
                  <input
                    type="number"
                    value={iadConfig.voltage}
                    onChange={(e) =>
                      setIADConfig({
                        ...iadConfig,
                        voltage: safeParseFloat(e.target.value),
                      })
                    }
                    className="w-full p-2 border rounded"
                    step="5"
                    min="50"
                    max="200"
                  />
                  <span className="text-xs text-gray-500">
                    Typical range: 80-150V
                  </span>
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1">
                    Ion Source Current (A)
                  </label>
                  <input
                    type="number"
                    value={iadConfig.current}
                    onChange={(e) =>
                      setIADConfig({
                        ...iadConfig,
                        current: safeParseFloat(e.target.value),
                      })
                    }
                    className="w-full p-2 border rounded"
                    step="0.1"
                    min="0.1"
                    max="3.0"
                  />
                  <span className="text-xs text-gray-500">
                    Typical range: 0.5-2.0A
                  </span>
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1">
                    O₂ Flow Rate (sccm)
                  </label>
                  <input
                    type="number"
                    value={iadConfig.o2Flow}
                    onChange={(e) =>
                      setIADConfig({
                        ...iadConfig,
                        o2Flow: safeParseFloat(e.target.value),
                      })
                    }
                    className="w-full p-2 border rounded"
                    step="0.5"
                    min="0"
                    max="20"
                  />
                  <span className="text-xs text-gray-500">
                    Typical range: 2-15 sccm
                  </span>
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1">
                    Ar Flow Rate (sccm)
                  </label>
                  <input
                    type="number"
                    value={iadConfig.arFlow}
                    onChange={(e) =>
                      setIADConfig({
                        ...iadConfig,
                        arFlow: safeParseFloat(e.target.value),
                      })
                    }
                    className="w-full p-2 border rounded"
                    step="0.5"
                    min="0"
                    max="20"
                  />
                  <span className="text-xs text-gray-500">
                    Typical range: 3-10 sccm
                  </span>
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1">
                    RI Increase (%)
                  </label>
                  <input
                    type="number"
                    value={iadConfig.riIncrease}
                    onChange={(e) =>
                      setIADConfig({
                        ...iadConfig,
                        riIncrease: safeParseFloat(e.target.value),
                      })
                    }
                    className="w-full p-2 border rounded"
                    step="0.1"
                    min="0"
                    max="10"
                  />
                  <span className="text-xs text-gray-500">
                    Material-dependent, typically 1-5%
                  </span>
                </div>

                <div className="pt-3 border-t">
                  <label className="block text-sm font-medium mb-1">
                    Packing Density
                  </label>
                  <input
                    type="number"
                    value={iadConfig.packingDensity}
                    onChange={(e) =>
                      setIADConfig({
                        ...iadConfig,
                        packingDensity: safeParseFloat(e.target.value) || 1.0,
                      })
                    }
                    className="w-full p-2 border rounded"
                    step="0.01"
                    min="0.5"
                    max="1.0"
                  />
                  <span className="text-xs text-gray-500">
                    1.0 = fully dense, 0.85-0.95 = porous e-beam, 0.95-1.0 = dense IAD
                  </span>
                </div>

                <div className="p-3 bg-gray-50 rounded text-sm">
                  <p className="font-medium mb-1">
                    Effective Refractive Index:
                  </p>
                  <p className="text-gray-700">
                    Base: {getRefractiveIndex(layer.material, 550).toFixed(4)} @
                    550nm
                  </p>
                  <p className="text-blue-600 font-medium">
                    With IAD:{" "}
                    {(
                      getRefractiveIndex(layer.material, 550) *
                      (1 + iadConfig.riIncrease / 100)
                    ).toFixed(4)}{" "}
                    @ 550nm
                  </p>
                </div>
              </>
            )}
          </div>

          <div className="mt-6 flex space-x-3">
            {layer.iad && (
              <button
                onClick={() => {
                  removeLayerIAD(currentIADLayer);
                  setShowIADModal(false);
                }}
                className="flex-1 px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600"
              >
                Remove IAD
              </button>
            )}
            <button
              onClick={() => setShowIADModal(false)}
              className="flex-1 px-4 py-2 bg-gray-200 rounded hover:bg-gray-300"
            >
              Cancel
            </button>
            <button
              onClick={() => updateLayerIAD(iadConfig)}
              className="flex-1 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
            >
              Apply
            </button>
          </div>
        </div>
      </div>
    );
  };

  // ========== ADMITTANCE CHART RENDER HELPER ==========
  const renderAdmittanceChart = () => (
    <ResponsiveContainer width="100%" height="100%">
      <ScatterChart margin={{ top: 10, right: 20, bottom: 40, left: 30 }}>
        <CartesianGrid strokeDasharray="4 4" stroke={theme.chartGrid} strokeOpacity={0.4} />
        <XAxis
          dataKey="re"
          type="number"
          name="Re(Y)"
          label={{ value: "Re(Y) — Admittance", position: "insideBottom", offset: -5, ...axisLabelStyle }}
          tick={{ fontSize: 11, fill: theme.chartAxisText }}
          stroke={theme.chartGrid}
          domain={["auto", "auto"]}
        />
        <YAxis
          dataKey="im"
          type="number"
          name="Im(Y)"
          label={{ value: "Im(Y)", angle: -90, position: "insideLeft", offset: -10, ...axisLabelStyle }}
          tick={{ fontSize: 11, fill: theme.chartAxisText }}
          stroke={theme.chartGrid}
          domain={["auto", "auto"]}
        />
        <Tooltip content={admittanceTooltipContent} />
        <Legend wrapperStyle={{ fontSize: "11px", paddingTop: "8px", color: theme.textSecondary }} verticalAlign="bottom" />
        {admittanceData.map((locus) => (
          <Scatter
            key={`adm-${locus.wavelength}`}
            name={`${locus.wavelength} nm`}
            data={locus.points}
            fill={locus.color}
            line={{ stroke: locus.color, strokeWidth: 2 }}
            lineType="joint"
            shape={admittanceShapeFn}
            isAnimationActive={false}
          />
        ))}
      </ScatterChart>
    </ResponsiveContainer>
  );

  // ========== E-FIELD CHART RENDER HELPER ==========
  const renderEfieldChart = () => (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={efieldData.data || []} margin={{ top: 10, right: 20, bottom: 40, left: 30 }}>
        <CartesianGrid strokeDasharray="4 4" stroke={theme.chartGrid} strokeOpacity={0.4} />
        {efieldData.layers.map((layer, idx) => (
          <ReferenceArea
            key={`efield-layer-${idx}`}
            x1={layer.x1}
            x2={layer.x2}
            fill={layer.color}
            fillOpacity={0.15}
            label={{ value: layer.material, position: "insideTop", fontSize: 9, fill: "#666" }}
          />
        ))}
        <XAxis
          dataKey="depth"
          type="number"
          label={{ value: "Depth (nm)", position: "insideBottom", offset: -5, ...axisLabelStyle }}
          tick={{ fontSize: 11, fill: theme.chartAxisText }}
          stroke={theme.chartGrid}
          domain={["auto", "auto"]}
        />
        <YAxis
          label={{ value: "|E|\u00B2 / |E\u2080|\u00B2", angle: -90, position: "insideLeft", offset: -10, ...axisLabelStyle }}
          tick={{ fontSize: 11, fill: theme.chartAxisText }}
          stroke={theme.chartGrid}
          domain={[0, "auto"]}
        />
        <Tooltip
          content={({ payload }) => {
            if (payload && payload.length > 0) {
              const d = payload[0].payload;
              return (
                <div style={{
                  background: theme.chartTooltipBg,
                  border: `1px solid ${theme.chartTooltipBorder}`,
                  borderRadius: 8,
                  padding: '8px 12px',
                  boxShadow: darkMode ? '0 4px 12px rgba(0,0,0,0.5)' : '0 4px 12px rgba(0,0,0,0.1)',
                  fontSize: 12,
                  color: theme.chartTooltipText,
                }}>
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>{d.material || ""}</div>
                  <div style={{ color: theme.textTertiary, fontSize: 11 }}>Depth: {d.depth?.toFixed(1)} nm</div>
                  {payload.map((p, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: p.color, display: 'inline-block' }} />
                      <span style={{ color: theme.textTertiary, fontSize: 11 }}>{p.name}:</span>
                      <span style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{p.value?.toFixed(4)}</span>
                    </div>
                  ))}
                </div>
              );
            }
            return null;
          }}
        />
        <Legend wrapperStyle={{ fontSize: "11px", paddingTop: "8px", color: theme.textSecondary }} verticalAlign="bottom" />
        {efieldData.lines.map((line) => (
          <Line
            key={`efield-${line.wavelength}`}
            dataKey={`intensity_${line.wavelength}`}
            stroke={line.color}
            dot={false}
            strokeWidth={2}
            name={`${line.wavelength} nm`}
            isAnimationActive={false}
            connectNulls={false}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );

  // Press-and-hold repeat for +/- thickness buttons on mobile
  // Uses setLayers with functional update to always read the latest value
  const startHoldRepeat = (layerId, delta) => {
    const applyDelta = () => {
      setLayers(prev => {
        const newLayers = prev.map(l => l.id === layerId ? { ...l, thickness: Math.max(0, (parseFloat(l.thickness) || 0) + delta) } : l);
        // Also sync to layerStacks
        if (currentStackId) {
          prevLayersRef.current = JSON.stringify(newLayers);
          setLayerStacks(stacks => stacks.map(stack =>
            stack.id === currentStackId ? { ...stack, layers: newLayers } : stack
          ));
        }
        return newLayers;
      });
    };
    applyDelta(); // fire once immediately
    let speed = 120;
    const tick = () => {
      applyDelta();
      speed = Math.max(30, speed * 0.85);
      holdRepeatRef.current = setTimeout(tick, speed);
    };
    holdRepeatRef.current = setTimeout(tick, 350);
  };
  const stopHoldRepeat = () => {
    if (holdRepeatRef.current) { clearTimeout(holdRepeatRef.current); holdRepeatRef.current = null; }
  };

  // On phone/tablet, force layout mode:
  // - Portrait phone/tablet: "tall" (chart on top, layers below)
  // - Landscape phone (short height): "wide" (chart and layers side by side)
  const effectiveLayoutMode = (() => {
    if (isPhone && !isLandscape) return 'tall';  // portrait phone → stacked
    if (isPhone && isLandscape) return 'wide';   // landscape phone → side by side
    if (isTablet && !isLandscape) return 'tall';  // portrait tablet → stacked
    if (isTablet && isLandscape) return 'wide';   // landscape tablet → side by side
    return layoutMode;                             // desktop → user's choice
  })();

  return (
    <div className="w-full bg-gradient-to-br from-blue-50 to-indigo-100 overflow-hidden" style={{ padding: isPhone ? '4px' : '8px', touchAction: 'manipulation', height: '100dvh', maxHeight: '100dvh' }}>
      {/* Splash screen */}
      {splashPhase && (<>
        {/* Circular reveal mask — box-shadow fills the screen, growing hole reveals the app from center */}
        <div style={{
          position: 'fixed', left: '50%', top: '50%', zIndex: 99997,
          borderRadius: '50%',
          boxShadow: '0 0 0 100vmax #080818',
          width: 0, height: 0,
          animation: splashPhase === 'expanding'
            ? 'splashRevealHole 1.3s cubic-bezier(0.22, 0, 0.15, 1) 0.35s forwards'
            : 'none',
          pointerEvents: 'none',
        }} />

        {/* Ring container — each ring expands individually */}
        <div style={{
          position: 'fixed', inset: 0, zIndex: 99998,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          pointerEvents: 'none',
        }}>
          {SPLASH_RINGS.map((ring, i) => (
            <div key={i} style={{
              position: 'absolute',
              width: ring.size, height: ring.size,
              borderRadius: '50%',
              border: `${ring.bw}px solid ${ring.color}`,
              opacity: 0.5 + i * 0.03,
              boxShadow: `0 0 ${8 + (10 - i) * 2}px ${ring.glow}, inset 0 0 ${4 + (10 - i)}px ${ring.glow}`,
              animation: splashPhase === 'expanding'
                ? `splashRingExpand ${0.7 + i * 0.04}s cubic-bezier(0.3, 0, 0.15, 1) ${i * 0.05}s forwards`
                : 'splashPulse 2.5s ease-in-out infinite',
            }} />
          ))}
          {/* Center white glow */}
          <div style={{
            position: 'absolute', width: 16, height: 16, borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(255,255,255,0.95) 0%, rgba(255,255,255,0.3) 50%, transparent 100%)',
            boxShadow: '0 0 20px rgba(255,255,255,0.4)',
            opacity: splashPhase === 'expanding' ? 0 : 1,
            transition: 'opacity 0.2s',
          }} />
        </div>

        {/* Text overlay — positioned below the rings */}
        <div style={{
          position: 'fixed', inset: 0, zIndex: 99999,
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          paddingTop: isPhone ? '30vh' : '300px',
          pointerEvents: 'none',
          opacity: splashPhase === 'expanding' ? 0 : 1,
          transition: 'opacity 0.25s ease-out',
        }}>
          <div style={{
            fontSize: isPhone ? '1.8rem' : '3.6rem', fontWeight: 700, letterSpacing: '-0.02em',
            color: '#e0e7ff', textAlign: 'center', whiteSpace: isPhone ? 'normal' : 'nowrap',
          }}>
            OptiCoat Designer
          </div>
          <div style={{
            fontSize: isPhone ? '0.65rem' : '1.1rem', fontWeight: 400, letterSpacing: isPhone ? '0.1em' : '0.18em',
            textTransform: 'uppercase', color: '#818cf8', opacity: 0.85,
            whiteSpace: isPhone ? 'normal' : 'nowrap', marginTop: '0.6rem', textAlign: 'center',
          }}>
            Thin-Film Optical Coating Design
          </div>
        </div>

        <style>{`
          @keyframes splashRingExpand {
            to { transform: scale(28); opacity: 0; }
          }
          @keyframes splashRevealHole {
            from { width: 0; height: 0; margin-left: 0; margin-top: 0; }
            to { width: 300vmax; height: 300vmax; margin-left: -150vmax; margin-top: -150vmax; }
          }
          @keyframes splashPulse {
            0%, 100% { transform: scale(1); }
            50% { transform: scale(1.03); }
          }
        `}</style>
      </>)}
      {/* Toast notifications */}
      {toasts.length > 0 && (
        <div style={{ position: 'fixed', top: '1rem', right: '1rem', zIndex: 9999, display: 'flex', flexDirection: 'column', gap: '0.5rem', maxWidth: '420px' }}>
          {toasts.map(toast => (
            <div key={toast.id} style={{
              padding: '12px 16px',
              borderRadius: '8px',
              color: '#fff',
              fontSize: '14px',
              lineHeight: '1.4',
              boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
              animation: 'fadeIn 0.2s ease-out',
              display: 'flex',
              alignItems: 'flex-start',
              gap: '8px',
              background: toast.type === 'error' ? '#dc2626' : toast.type === 'success' ? '#16a34a' : '#2563eb',
            }}>
              <span style={{ flex: 1 }}>{toast.message}</span>
              <button onClick={() => setToasts(prev => prev.filter(t => t.id !== toast.id))} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', fontSize: '16px', lineHeight: 1, opacity: 0.7, padding: 0 }}>&times;</button>
            </div>
          ))}
        </div>
      )}
      <div className="h-full flex flex-col">
        {/* Tabs */}
        <div className="flex gap-1 flex-shrink-0 items-center" style={{ background: darkMode ? '#111225' : '#e0e7ff', borderRadius: 10, padding: '3px 4px', flexWrap: (isPhone || isTablet) ? 'wrap' : 'nowrap', marginBottom: (isPhone || isTablet) ? 2 : 8 }}>
          {(() => { const compact = isPhone || isTablet; const iconSz = compact ? 11 : 14; return [
            { id: 'designer', label: compact ? 'Designer' : 'Thin-Film Designer', icon: null },
            { id: 'assistant', label: compact ? 'Assist' : 'Design Assistant', icon: <Zap size={iconSz} /> },
            { id: 'tracking', label: compact ? 'Track' : 'Recipe Tracking', icon: <Upload size={iconSz} /> },
            { id: 'yield', label: compact ? 'Yield' : 'Yield Analysis', icon: <TrendingUp size={iconSz} /> },
          ]; })().map(tab => (
            <button
              key={tab.id}
              onClick={() => {
                setActiveTab(tab.id);
              }}
              className="flex items-center gap-1.5 transition-all"
              style={{
                padding: (isPhone || isTablet) ? '5px 7px' : '6px 14px',
                borderRadius: (isPhone || isTablet) ? 6 : 8,
                fontSize: (isPhone || isTablet) ? 11 : 13,
                minHeight: isPhone ? 34 : undefined,
                fontWeight: activeTab === tab.id ? 600 : 500,
                background: activeTab === tab.id
                  ? (darkMode ? 'var(--accent)' : '#ffffff')
                  : 'transparent',
                color: activeTab === tab.id
                  ? (darkMode ? '#ffffff' : 'var(--accent)')
                  : (darkMode ? 'var(--text-tertiary)' : '#6b7280'),
                boxShadow: activeTab === tab.id
                  ? (darkMode ? '0 1px 4px rgba(99,102,241,0.3)' : '0 1px 3px rgba(0,0,0,0.1)')
                  : 'none',
                cursor: 'pointer',
                border: 'none',
              }}
              onMouseEnter={e => {
                if (activeTab !== tab.id) {
                  e.currentTarget.style.background = darkMode ? 'rgba(99,102,241,0.15)' : 'rgba(79,70,229,0.08)';
                  e.currentTarget.style.color = darkMode ? '#a5b4fc' : 'var(--accent)';
                }
              }}
              onMouseLeave={e => {
                if (activeTab !== tab.id) {
                  e.currentTarget.style.background = 'transparent';
                  e.currentTarget.style.color = darkMode ? 'var(--text-tertiary)' : '#6b7280';
                }
              }}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
          {/* Middle controls — pushed right of tabs */}
          <div className="flex items-center gap-2" style={{ marginLeft: 'auto' }}>
            {/* Dark mode toggle */}
            <button
              onClick={() => setDarkMode(prev => !prev)}
              className="flex items-center justify-center rounded"
              style={{
                width: isPhone ? 36 : 28, height: isPhone ? 36 : 28,
                background: darkMode ? 'var(--accent-light)' : 'var(--accent-lighter)',
                color: 'var(--accent-text)',
                transition: 'background 0.2s, color 0.2s',
              }}
              title={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {darkMode ? <Sun size={isPhone ? 16 : 14} /> : <Moon size={isPhone ? 16 : 14} />}
            </button>

            {/* Online/Offline indicator */}
            <div className="flex items-center gap-1 px-2 py-1 rounded-t text-xs" style={{ color: isOnline ? 'var(--success)' : 'var(--warning)' }}>
              {isOnline ? <Wifi size={14} /> : <WifiOff size={14} />}
            </div>

          </div>

          {/* Far right group — Auth + Workspace Save/Load */}
          <div className="flex items-center gap-2" style={{ marginLeft: 'auto' }}>
            {/* Auth button */}
            {CLERK_ENABLED ? (
              isSignedIn ? (
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setShowPricingModal(true)}
                    className="flex items-center gap-1 px-2 py-1 rounded text-xs bg-amber-100 text-amber-700 hover:bg-amber-200"
                    title="Manage subscription"
                  >
                    <Crown size={isPhone ? 14 : 12} />
                    {!isPhone && <span className="capitalize">{trialInfo?.isTrialing ? `Trial (${Math.max(1, Math.ceil((trialInfo.trialEnd - Date.now()) / 86400000))}d left)` : userTier}</span>}
                  </button>
                  {userTier === 'enterprise' && organization && membership?.role === 'org:admin' && (
                    <button
                      onClick={() => setShowTeamModal(true)}
                      className="flex items-center gap-1 px-2 py-1 rounded text-xs"
                      style={{ background: darkMode ? '#1e293b' : '#e0e7ff', color: darkMode ? '#93c5fd' : '#4338ca', border: 'none', cursor: 'pointer' }}
                      title="Team management"
                    >
                      <Users size={isPhone ? 14 : 12} />
                      {isDesktop && <span>Team</span>}
                    </button>
                  )}
                  <UserButton afterSignOutUrl={window.location.href} />
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setShowPricingModal(true)}
                    className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium"
                    style={{ background: theme.accentLight, color: theme.accentText, border: 'none', cursor: 'pointer' }}
                    title="View plans and pricing"
                  >
                    <Crown size={isPhone ? 14 : 12} />
                    {isDesktop && <span>Plans</span>}
                  </button>
                  <SignInButton mode="modal">
                    <button className="flex items-center gap-1 px-3 py-1.5 rounded text-xs bg-indigo-600 text-white hover:bg-indigo-700 font-medium" style={{ minHeight: isPhone ? 36 : undefined }}>
                      <LogIn size={isPhone ? 14 : 12} />
                      {isDesktop && <span>Sign In</span>}
                    </button>
                  </SignInButton>
                </div>
              )
            ) : (
              <button
                onClick={() => setShowPricingModal(true)}
                className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium"
                style={{ background: theme.accentLight, color: theme.accentText, border: 'none', cursor: 'pointer' }}
                title="View plans and pricing"
              >
                <Crown size={isPhone ? 14 : 12} />
                {isDesktop && <span>Plans</span>}
              </button>
            )}

            {/* Workspace Save/Load */}
            {(activeTab === 'designer' || activeTab === 'assistant') && (
              <>
                <div style={{ width: 1, height: 20, background: theme.border }}></div>
                <button
                  onClick={() => setShowSaveWorkspaceModal(true)}
                  className="flex items-center gap-1 rounded text-xs"
                  style={{ padding: isPhone ? '6px 8px' : '4px 10px', background: theme.accentLight, color: theme.accentText, border: 'none', cursor: 'pointer', fontWeight: 500, minHeight: isPhone ? 36 : undefined }}
                  title="Save all machines, stacks, materials, and settings as a workspace"
                >
                  <Save size={isPhone ? 16 : 12} />
                  {isDesktop && <span>Save Workspace</span>}
                </button>
                <button
                  onClick={() => { loadDesignsList(); setShowLoadWorkspaceModal(true); }}
                  className="flex items-center gap-1 rounded text-xs"
                  style={{ padding: isPhone ? '6px 8px' : '4px 10px', background: theme.accentLight, color: theme.accentText, border: 'none', cursor: 'pointer', fontWeight: 500, minHeight: isPhone ? 36 : undefined }}
                  title="Load a saved workspace or individual items"
                >
                  <FolderOpen size={isPhone ? 16 : 12} />
                  {isDesktop && <span>Load Workspace</span>}
                </button>
              </>
            )}
          </div>
        </div>

        {/* Designer Tab Content */}
        {activeTab === "designer" && (
          <>
            <div className="flex justify-between items-center mb-2 flex-shrink-0 flex-wrap gap-2">
              {(isPhone || isTablet) ? (
                /* Phone/tablet: collapsible summary toolbar */
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', flexWrap: 'wrap' }}>
                  <button
                    onClick={() => setMobileToolbarExpanded(!mobileToolbarExpanded)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 6,
                      background: darkMode ? '#1e1f3a' : '#ffffff', border: `1px solid ${darkMode ? '#363860' : '#d1d5db'}`,
                      cursor: 'pointer', fontSize: 11, color: darkMode ? '#a0a0b8' : '#374151', flex: 1,
                      boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
                    }}
                  >
                    <span style={{ fontWeight: 600 }}>{wavelengthRange.min}-{wavelengthRange.max}nm</span>
                    <span style={{ color: darkMode ? '#5c6370' : '#9ca3af' }}>|</span>
                    <span>{reflectivityRange.min}-{reflectivityRange.max}%</span>
                    <span style={{ color: darkMode ? '#5c6370' : '#9ca3af' }}>|</span>
                    <span style={{ textTransform: 'capitalize' }}>{displayMode.slice(0, 5)}</span>
                    <span style={{ marginLeft: 'auto', fontSize: 10 }}>{mobileToolbarExpanded ? '▲' : '▼'}</span>
                  </button>
                  <button onClick={() => setShowTargetsModal(true)} style={{ padding: '4px 8px', borderRadius: 6, background: darkMode ? '#1e1f3a' : '#fff', border: `1px solid ${darkMode ? '#363860' : '#d1d5db'}`, cursor: 'pointer', fontSize: 11, display: 'flex', alignItems: 'center', gap: 3, color: darkMode ? '#a0a0b8' : '#374151', boxShadow: '0 1px 2px rgba(0,0,0,0.05)' }}>
                    <Settings size={11} /> Targets
                  </button>
                </div>
              ) : (
                <h1 className="text-lg font-bold text-gray-800">
                  Thin Film Coating Stack Designer
                </h1>
              )}
              <div className="flex gap-2 text-xs flex-wrap" style={(isPhone || isTablet) ? { display: mobileToolbarExpanded ? 'flex' : 'none', width: '100%' } : undefined}>
                <div className="bg-white px-2 py-1 rounded shadow flex items-center gap-1 flex-shrink-0">
                  <span className="text-gray-600">λ: </span>
                  <input
                    type="number"
                    value={wavelengthRange.min === "" ? "" : wavelengthRange.min}
                    onChange={(e) =>
                      setWavelengthRange({
                        ...wavelengthRange,
                        min: e.target.value === "" ? "" : Math.max(0, parseInt(e.target.value) || 0),
                      })
                    }
                    onBlur={() => {
                      if (wavelengthRange.min === "" || wavelengthRange.min === null) {
                        setWavelengthRange({ ...wavelengthRange, min: 0 });
                      }
                    }}
                    className="w-12 px-1 border rounded"
                    style={{ fontSize: isPhone ? 16 : undefined }}
                    min="0"
                  />
                  <span className="mx-1">-</span>
                  <input
                    type="number"
                    value={wavelengthRange.max === "" ? "" : wavelengthRange.max}
                    onChange={(e) =>
                      setWavelengthRange({
                        ...wavelengthRange,
                        max: e.target.value === "" ? "" : Math.max(0, parseInt(e.target.value) || 0),
                      })
                    }
                    onBlur={() => {
                      if (wavelengthRange.max === "" || wavelengthRange.max === null) {
                        setWavelengthRange({ ...wavelengthRange, max: 0 });
                      }
                    }}
                    className="w-12 px-1 border rounded"
                    style={{ fontSize: isPhone ? 16 : undefined }}
                    min="0"
                  />
                  <span className="ml-1">nm</span>
                </div>
                <div className="bg-white px-2 py-1 rounded shadow flex items-center gap-1 flex-shrink-0">
                  <label className="flex items-center gap-1 cursor-pointer" title="Enable if measured without black backing (includes backside reflection)">
                    <input
                      type="checkbox"
                      checked={doubleSidedAR}
                      onChange={(e) => setDoubleSidedAR(e.target.checked)}
                      className="cursor-pointer"
                    />
                    <span className="text-xs">+Backside</span>
                  </label>
                </div>
                <div className="bg-white px-2 py-1 rounded shadow flex items-center gap-1 flex-shrink-0" title="Davies-Bennett scalar scattering loss: R_specular = R·exp(-(4πσ·cosθ/λ)²). Set 0 to disable. Typical values: 2–5nm (IAD), 5–15nm (e-beam), 20–50nm (rough sputter).">
                  <span className="text-xs text-gray-600">σ:</span>
                  <input
                    type="number"
                    value={surfaceRoughness === 0 ? "" : surfaceRoughness}
                    placeholder="0"
                    onChange={(e) => setSurfaceRoughness(parseFloat(e.target.value) || 0)}
                    className="w-10 px-1 py-0 border rounded text-xs"
                    step="1" min="0" max="200"
                  />
                  <span className="text-xs text-gray-500">nm</span>
                </div>
                <div className="bg-white px-2 py-1 rounded shadow flex items-center gap-1 flex-shrink-0">
                  <span className="text-gray-600">Y: </span>
                  <input
                    type="number"
                    value={reflectivityRange.min === "" ? "" : reflectivityRange.min}
                    onChange={(e) =>
                      setReflectivityRange({
                        ...reflectivityRange,
                        min: e.target.value === "" ? "" : Math.max(0, safeParseFloat(e.target.value)),
                      })
                    }
                    onBlur={() => {
                      if (reflectivityRange.min === "" || reflectivityRange.min === null) {
                        setReflectivityRange({ ...reflectivityRange, min: 0 });
                      }
                    }}
                    className="px-1 border rounded"
                    style={{ width: '3.5rem' }}
                    disabled={autoYAxis}
                    min="0"
                  />
                  <span className="mx-1">-</span>
                  <input
                    type="number"
                    value={reflectivityRange.max === "" ? "" : reflectivityRange.max}
                    onChange={(e) =>
                      setReflectivityRange({
                        ...reflectivityRange,
                        max: e.target.value === "" ? "" : Math.max(0, safeParseFloat(e.target.value)),
                      })
                    }
                    onBlur={() => {
                      if (reflectivityRange.max === "" || reflectivityRange.max === null) {
                        setReflectivityRange({ ...reflectivityRange, max: 0 });
                      }
                    }}
                    className="px-1 border rounded"
                    style={{ width: '3.5rem' }}
                    disabled={autoYAxis}
                    min="0"
                  />
                  <span className="ml-1">%</span>
                  <label className="ml-2 flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={autoYAxis}
                      onChange={(e) => setAutoYAxis(e.target.checked)}
                      className="cursor-pointer"
                    />
                    <span className="text-xs">Auto</span>
                  </label>
                </div>
                <div className="bg-white px-2 py-1 rounded shadow flex items-center gap-1 flex-shrink-0">
                  <span className="text-gray-600">Mode:</span>
                  <select
                    value={displayMode}
                    onChange={(e) => {
                      if (tierLimits.allowedDisplayModes.includes(e.target.value)) {
                        setDisplayMode(e.target.value);
                      } else {
                        setUpgradeFeature(e.target.value + ' display mode');
                        setShowUpgradePrompt(true);
                      }
                    }}
                    className="px-1 border rounded text-xs bg-white cursor-pointer"
                  >
                    <option value="reflectivity">Reflectivity</option>
                    <option value="transmission">Transmission</option>
                    <option value="absorption" disabled={!tierLimits.allowedDisplayModes.includes('absorption')}>Absorption{!tierLimits.allowedDisplayModes.includes('absorption') ? ' 🔒' : ''}</option>
                    <option value="admittance" disabled={!tierLimits.allowedDisplayModes.includes('admittance')}>Admittance{!tierLimits.allowedDisplayModes.includes('admittance') ? ' 🔒' : ''}</option>
                    <option value="efield" disabled={!tierLimits.allowedDisplayModes.includes('efield')}>E-Field{!tierLimits.allowedDisplayModes.includes('efield') ? ' 🔒' : ''}</option>
                  </select>
                </div>
                {isDesktop && <button
                  onClick={() => setShowTargetsModal(true)}
                  className="bg-white px-2 py-1 rounded shadow hover:bg-gray-50 flex items-center gap-1 flex-shrink-0"
                >
                  <Settings size={12} />
                  <span>Targets</span>
                </button>}
                {isDesktop && (
                  <button
                    onClick={() => setLayoutMode(layoutMode === "tall" ? "wide" : "tall")}
                    className="bg-white px-2 py-1 rounded shadow hover:bg-gray-50 flex items-center justify-center flex-shrink-0"
                    title={layoutMode === "tall" ? "Side-by-side layout" : "Stacked layout"}
                    style={{ fontSize: 16, lineHeight: 1, width: 32 }}
                  >
                    {layoutMode === "tall" ? "⬌" : "⬍"}
                  </button>
                )}
                <div className="bg-white px-2 py-1 rounded shadow flex-shrink-0">
                  {!experimentalData ? (
                    <label className={`flex items-center gap-1 ${tierLimits.csvUpload ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'}`}
                      onClick={(e) => { if (!tierLimits.csvUpload) { e.preventDefault(); setUpgradeFeature('CSV upload'); setShowUpgradePrompt(true); } }}
                    >
                      <Upload size={12} />
                      <span>Upload CSV{!tierLimits.csvUpload ? ' 🔒' : ''}</span>
                      {tierLimits.csvUpload && <input
                        type="file"
                        accept=".csv"
                        onChange={handleFileUpload}
                        className="hidden"
                      />}
                    </label>
                  ) : (
                    <div className="flex items-center gap-2">
                      <span className="text-green-600">✓ Exp Data</span>
                      {suggestions.map((s, i) => (
                        <span key={i} className="text-blue-600">
                          {s.message}
                        </span>
                      ))}
                      <button
                        onClick={clearExperimentalData}
                        className="text-red-600"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className={`flex-1 bg-white rounded-lg shadow-lg p-2 flex overflow-hidden designer-container min-h-0 ${effectiveLayoutMode === "wide" ? "flex-row" : "flex-col"}`}>
              
              {/* In horizontal mode: Layers first (left side) */}
              {effectiveLayoutMode === "wide" && (
                <div
                  style={{ width: `${100 - chartWidth}%`, height: "100%", paddingRight: 8, overflowY: (isPhone || isTablet) ? 'auto' : 'hidden', overflowX: 'hidden' }}
                  className="flex flex-col min-h-0 min-w-0"
                >
                  {(isPhone || isTablet) ? (
                    /* Compact layer header for phone/tablet */
                    <>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 2, flexShrink: 0, flexWrap: 'wrap' }}>
                      <select value={currentStackId || ''} onChange={(e) => switchLayerStack(parseInt(e.target.value))} style={{ flex: 1, minWidth: 0, padding: '3px 4px', borderRadius: 4, fontSize: 11, border: `1px solid ${darkMode ? '#363860' : '#d1d5db'}`, background: darkMode ? '#1e1f3a' : '#fff', color: darkMode ? '#e2e4e9' : '#1f2937' }}>
                        {layerStacks.filter((s) => s.machineId === currentMachineId).map((stack) => (
                          <option key={stack.id} value={stack.id}>{getStackDisplayName(stack)}</option>
                        ))}
                      </select>
                      <select value={currentMachineId} onChange={(e) => switchMachine(parseInt(e.target.value))} style={{ padding: '3px 4px', borderRadius: 4, fontSize: 11, border: `1px solid ${darkMode ? '#363860' : '#d1d5db'}`, background: darkMode ? '#1e1f3a' : '#fff', color: darkMode ? '#e2e4e9' : '#1f2937' }}>
                        {machines.map((machine) => (<option key={machine.id} value={machine.id}>{machine.name}</option>))}
                      </select>
                      <button onClick={addLayerStack} style={{ padding: '3px 6px', borderRadius: 4, fontSize: 11, background: '#16a34a', color: '#fff', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center' }} title="New Stack"><Plus size={11} /></button>
                      <button onClick={() => setMobileStackMenuOpen(!mobileStackMenuOpen)} style={{ padding: '3px 6px', borderRadius: 4, fontSize: 11, background: darkMode ? '#1e1f3a' : '#f3f4f6', color: darkMode ? '#a0a0b8' : '#374151', border: `1px solid ${darkMode ? '#363860' : '#d1d5db'}`, cursor: 'pointer', display: 'flex', alignItems: 'center' }} title="More options"><Settings size={11} /></button>
                    </div>
                    {mobileStackMenuOpen && (
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 2, flexShrink: 0, padding: '4px 0' }}>
                        <button onClick={() => deleteLayerStack(currentStackId)} disabled={layerStacks.filter((s) => s.machineId === currentMachineId).length === 0} style={{ padding: '2px 8px', borderRadius: 4, fontSize: 10, background: '#ef4444', color: '#fff', border: 'none', cursor: 'pointer' }}>Delete Stack</button>
                        <button onClick={() => { if (!tierLimits.coatingTemplates) { setUpgradeFeature('Coating Templates'); setShowUpgradePrompt(true); return; } setShowTemplatePicker(true); }} style={{ padding: '2px 8px', borderRadius: 4, fontSize: 10, background: theme.accent, color: '#fff', border: 'none', cursor: 'pointer' }}>Template</button>
                        <button onClick={() => setShowToolingModal(true)} style={{ padding: '2px 8px', borderRadius: 4, fontSize: 10, background: '#3b82f6', color: '#fff', border: 'none', cursor: 'pointer' }}>Tooling</button>
                        <button onClick={() => { calculateCoatingStress(); setShowStressModal(true); }} disabled={layers.length === 0} style={{ padding: '2px 8px', borderRadius: 4, fontSize: 10, background: '#9333ea', color: '#fff', border: 'none', cursor: 'pointer', opacity: layers.length === 0 ? 0.5 : 1 }}>Stress</button>
                      </div>
                    )}
                    </>
                  ) : (
                    /* Desktop: full header */
                    <>
                  <div className="flex items-center gap-2 mb-1 flex-shrink-0">
                    <h2 className="text-sm font-semibold text-gray-700">Layer Stacks</h2>
                    <button onClick={addLayerStack} className="px-2 py-0.5 bg-green-600 text-white rounded hover:bg-green-700 text-xs flex items-center gap-1"><Plus size={10} /> New Stack</button>
                    <button onClick={() => deleteLayerStack(currentStackId)} disabled={layerStacks.filter((s) => s.machineId === currentMachineId).length === 0} className="px-2 py-0.5 bg-red-500 text-white rounded hover:bg-red-600 text-xs disabled:bg-gray-300 disabled:cursor-not-allowed flex items-center gap-1"><Trash2 size={10} /> Delete Stack</button>
                    <button onClick={() => { if (!tierLimits.coatingTemplates) { setUpgradeFeature('Coating Templates'); setShowUpgradePrompt(true); return; } setShowTemplatePicker(true); }} style={{ background: theme.accent, color: '#fff', padding: '1px 8px', borderRadius: 4, fontSize: 11, display: 'flex', alignItems: 'center', gap: 4, border: 'none', cursor: 'pointer' }}><Zap size={10} /> Template</button>
                  </div>

                  {/* Stack Tabs */}
                  <div className="flex flex-wrap gap-1 mb-1 overflow-x-auto pt-0.5 pb-1 flex-shrink-0">
                    {layerStacks
                      .filter((s) => s.machineId === currentMachineId)
                      .map((stack) => (
                        <div key={stack.id} className="flex items-center gap-1 flex-shrink-0">
                          <button
                            onClick={() => switchLayerStack(stack.id)}
                            className={`px-2 py-0.5 rounded text-xs flex items-center gap-1 whitespace-nowrap ${
                              currentStackId === stack.id
                                ? "bg-indigo-600 text-white font-semibold"
                                : "bg-gray-200 text-gray-700 hover:bg-gray-300"
                            }`}
                          >
                            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: stack.color }}></div>
                            {getStackDisplayName(stack)}
                          </button>
                          <button
                            onClick={() => toggleStackVisibility(stack.id)}
                            className={`p-0.5 rounded text-xs ${stack.visible ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-400"}`}
                            title={stack.visible ? "Hide" : "Show"}
                          >
                            {stack.visible ? "👁" : "👁‍🗨"}
                          </button>
                        </div>
                      ))}
                  </div>

                  {/* Machine and Stack Management */}
                  <div className="mb-1 p-1 bg-gray-50 rounded border flex flex-col gap-1 flex-shrink-0">
                    <div className="flex gap-1 items-center">
                      <select value={currentMachineId} onChange={(e) => switchMachine(parseInt(e.target.value))} className="flex-1 px-2 py-0.5 border rounded text-xs">
                        {machines.map((machine) => (<option key={machine.id} value={machine.id}>{machine.name}</option>))}
                      </select>
                      <button onClick={addMachine} className="px-1.5 py-0.5 bg-green-600 text-white rounded hover:bg-green-700 text-xs" title="Add machine"><Plus size={10} /></button>
                      <button onClick={() => deleteMachine(currentMachineId)} disabled={machines.length === 1} className="px-1.5 py-0.5 bg-red-500 text-white rounded hover:bg-red-600 text-xs disabled:bg-gray-300 disabled:cursor-not-allowed" title="Delete machine"><Trash2 size={10} /></button>
                    </div>
                    <div className="flex gap-1 items-center">
                      <input type="text" value={machines.find((m) => m.id === currentMachineId)?.name || ""} onChange={(e) => renameMachine(currentMachineId, e.target.value)} className="flex-1 px-2 py-0.5 border rounded text-xs" placeholder="Machine name" />
                      <input type="text" value={layerStacks.find((s) => s.id === currentStackId)?.name || ""} onChange={(e) => renameLayerStack(currentStackId, e.target.value)} className="flex-1 px-2 py-0.5 border rounded text-xs" placeholder="Stack name" />
                    </div>
                    <div className="flex gap-1 items-center">
                      <button onClick={() => setShowToolingModal(true)} className="px-2 py-0.5 bg-blue-500 text-white rounded hover:bg-blue-600 text-xs flex items-center gap-1" title="Configure tooling factors"><Settings size={10} />Tooling</button>
                      <button onClick={() => { calculateCoatingStress(); setShowStressModal(true); }} disabled={layers.length === 0} className="px-2 py-0.5 bg-purple-600 text-white rounded hover:bg-purple-700 text-xs disabled:bg-gray-300 disabled:cursor-not-allowed flex items-center gap-1" title="Calculate stress"><Zap size={10} />Stress</button>
                    </div>
                  </div>
                    </>
                  )}

                  {/* Compact Grid Header for horizontal mode */}
                  <div className="grid gap-x-1 bg-gray-100 p-1 rounded text-xs font-semibold text-gray-700 border-b-2 border-gray-300 flex-shrink-0 items-center" style={{ gridTemplateColumns: (isPhone || isTablet) ? '2rem 1fr 7rem 2rem' : '0.8rem 1.5rem minmax(3rem, 1fr) minmax(2.5rem, 4rem) 2.5rem 2.5rem 2.5rem 4.5rem' }}>
                    {!(isPhone || isTablet) && <div></div>}
                    <div className="text-center">#</div>
                    <div className="truncate">Material</div>
                    <div className="px-1">{(isPhone || isTablet) ? 'nm' : 'Thick'}</div>
                    {!(isPhone || isTablet) && <div>QWOT</div>}
                    {!(isPhone || isTablet) && <div>Last</div>}
                    {!(isPhone || isTablet) && <div>Orig</div>}
                    <div></div>
                  </div>

                  {/* Layer List - Scrollable */}
                  <div className="flex-1 min-h-0" style={{ overflowY: 'auto', overflowX: 'hidden' }}>
                    {layerStacks.filter((s) => s.machineId === currentMachineId).length === 0 ? (
                      <div className="flex items-center justify-center h-full text-center p-4">
                        <div className="text-gray-500 text-xs">
                          <p className="font-semibold mb-2">No layer stacks</p>
                          <button
                            onClick={addLayerStack}
                            className="px-3 py-1 bg-green-600 text-white rounded hover:bg-green-700 text-xs"
                          >
                            <Plus size={12} /> Create Stack
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        {/* Substrate Row */}
                        <div className="grid gap-x-1 p-1 bg-amber-50 border-b border-gray-200 text-xs items-center" style={{ gridTemplateColumns: (isPhone || isTablet) ? '2rem 1fr 7rem 2rem' : '0.8rem 1.5rem minmax(3rem, 1fr) minmax(2.5rem, 4rem) 2.5rem 2.5rem 2.5rem 4.5rem' }}>
                          {!(isPhone || isTablet) && <div></div>}
                          <div className="text-center font-medium" style={{ fontSize: (isPhone || isTablet) ? 10 : undefined }}>Sub</div>
                          <div className="min-w-0 overflow-hidden">
                            <div className="flex items-center gap-1">
                              <input
                                type="text"
                                value={substrate.material}
                                onChange={(e) =>
                                  setSubstrate({
                                    ...substrate,
                                    material: e.target.value,
                                  })
                                }
                                className="flex-1 min-w-0 px-1 py-0.5 border rounded text-xs"
                              />
                              <div style={{ width: 12, flexShrink: 0 }}></div>
                            </div>
                          </div>
                          <div>
                            <input
                              type="number"
                              value={substrate.n}
                              onChange={(e) =>
                                setSubstrate({
                                  ...substrate,
                                  n: safeParseFloat(e.target.value) || 1.52,
                                })
                              }
                              className="w-full px-1 py-0.5 border rounded text-xs"
                              step="0.01"
                              title="Substrate refractive index"
                            />
                          </div>
                          {!(isPhone || isTablet) && <div>-</div>}
                          {!(isPhone || isTablet) && <div>-</div>}
                          {!(isPhone || isTablet) && <div>-</div>}
                          <div></div>
                        </div>

                        {/* Divider line after substrate with insert button */}
                        <div
                          className="relative border-b border-gray-300"
                          style={{ height: "1px", zIndex: 3 }}
                        >
                          <button
                            onClick={() => insertLayerAfter(-1)}
                            className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 bg-white hover:bg-green-100 rounded-full text-green-600 border border-gray-300 hover:border-green-500 transition-colors shadow-sm"
                            title="Insert layer after substrate"
                          >
                            <Plus size={10} />
                          </button>
                        </div>

                        {/* Layer Rows */}
                        <div
                          data-drag-container
                          style={{ overflow: 'visible' }}
                          onDragOver={(e) => handleContainerDragOver(e)}
                          onDrop={(e) => { e.preventDefault(); moveLayer(dragIndex, dragOverIndex); setDragIndex(null); setDragOverIndex(null); }}
                        >
                        {layers.map((layer, idx) => {
                          const layerNum = idx + 1;
                          return (
                            <React.Fragment key={layer.id}>
                            <div
                              data-layer-row
                              className="grid gap-x-1 p-1 border-b text-xs items-center"
                              style={{
                                backgroundColor: getMaterialBg(allMaterials[layer.material]?.color || '#e5e7eb'),
                                borderColor: darkMode ? '#2a2c4a' : '#e5e7eb',
                                borderLeft: layer.locked
                                  ? '3px solid #f87171'
                                  : `3px solid ${allMaterials[layer.material]?.color || '#9ca3af'}`,
                                gridTemplateColumns: (isPhone || isTablet) ? '2rem 1fr 7rem 2rem' : '0.8rem 1.5rem minmax(3rem, 1fr) minmax(2.5rem, 4rem) 2.5rem 2.5rem 2.5rem 4.5rem',
                                transform: getDragTransform(idx, dragIndex, dragOverIndex),
                                transition: 'transform 0.2s ease, background-color 0.15s',
                                position: 'relative',
                                zIndex: dragIndex === idx ? 2 : 0,
                                boxShadow: dragIndex === idx ? (darkMode ? '0 2px 10px rgba(0,0,0,0.5)' : '0 2px 8px rgba(0,0,0,0.18)') : 'none',
                              }}
                              onMouseEnter={(e) => { e.currentTarget.style.filter = 'brightness(0.93)'; }}
                              onMouseLeave={(e) => { e.currentTarget.style.filter = ''; }}
                              onDragEnd={() => { setDragIndex(null); setDragOverIndex(null); }}
                            >
                              {!(isPhone || isTablet) && <div
                                draggable
                                onDragStart={(e) => { setDragIndex(idx); e.dataTransfer.effectAllowed = "move"; const img = new Image(); img.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'; e.dataTransfer.setDragImage(img, 0, 0); handleDragStartCapture(e.currentTarget.closest('[data-drag-container]')); }}
                                className="text-gray-400 flex items-center justify-center"
                                style={{ cursor: 'grab', transition: 'color 0.15s, transform 0.15s' }}
                                title="Drag to reorder"
                                onMouseEnter={(e) => { e.currentTarget.style.color = '#6366f1'; e.currentTarget.style.transform = 'scale(1.25)'; }}
                                onMouseLeave={(e) => { e.currentTarget.style.color = ''; e.currentTarget.style.transform = ''; }}
                                onMouseDown={(e) => { e.currentTarget.style.cursor = 'grabbing'; }}
                                onMouseUp={(e) => { e.currentTarget.style.cursor = 'grab'; }}
                              ><GripVertical size={10} /></div>}
                              <div className="text-center font-medium" style={{ fontSize: (isPhone || isTablet) ? 11 : undefined }}>{layerNum}</div>
                              <div className="min-w-0 overflow-hidden">
                                <div className="flex items-center gap-1">
                                  <select
                                    value={layer.material}
                                    onChange={(e) => {
                                      if (e.target.value === "__manage__") {
                                        setShowMaterialLibrary(true);
                                        e.target.value = layer.material;
                                        return;
                                      }
                                      updateLayer(layer.id, "material", e.target.value);
                                    }}
                                    className="flex-1 min-w-0 px-1 py-0.5 border rounded bg-white text-xs"
                                    style={{ fontSize: (isPhone || isTablet) ? 14 : undefined }}
                                  >
                                    {Object.keys(allMaterials).map((mat) => (
                                      <option key={mat} value={mat}>{mat}</option>
                                    ))}
                                    <option disabled>──────────</option>
                                    <option value="__manage__">Manage Materials...</option>
                                  </select>
                                  {!(isPhone || isTablet) && <div
                                    className="cursor-help text-gray-400 hover:text-blue-600 flex-shrink-0"
                                    title={(() => {
                                      const mat = allMaterials[layer.material];
                                      if (!mat) return layer.material;
                                      const n = getRefractiveIndex(layer.material, 550, layer.iad, layer.packingDensity || 1.0);
                                      const k400 = getExtinctionCoefficient(layer.material, 400);
                                      const k550 = getExtinctionCoefficient(layer.material, 550);
                                      let kInfo = "";
                                      if (mat.type === "tabular") {
                                        const pts = mat.data ? mat.data.length : 0;
                                        const range = mat.data && mat.data.length > 0 ? `${mat.data[0][0].toFixed(0)}-${mat.data[mat.data.length-1][0].toFixed(0)}nm` : "";
                                        kInfo = `Tabular n,k data (${pts} points, ${range})\nk@400nm: ${k400.toExponential(2)}\nk@550nm: ${k550.toExponential(2)}`;
                                      } else if (mat.type === "tauc-lorentz") {
                                        kInfo = `Tauc-Lorentz (A=${mat.A}, E₀=${mat.E0}, C=${mat.C}, Eg=${mat.Eg}, ε∞=${mat.epsInf})\nk@400nm: ${k400.toExponential(2)}\nk@550nm: ${k550.toExponential(2)}`;
                                      } else if (mat.type === "cody-lorentz") {
                                        kInfo = `Cody-Lorentz (A=${mat.A}, E₀=${mat.E0}, C=${mat.C}, Eg=${mat.Eg}, ε∞=${mat.epsInf}, Eu=${mat.Eu})\nk@400nm: ${k400.toExponential(2)}\nk@550nm: ${k550.toExponential(2)}`;
                                      } else if (mat.type === "lorentz") {
                                        const nosc = (mat.oscillators || []).length;
                                        const hasDrude = (mat.oscillators || []).some(o => o.E0 === 0);
                                        kInfo = `${hasDrude ? 'Drude-Lorentz' : 'Lorentz'} (ε∞=${mat.epsInf}, ${nosc} oscillator${nosc !== 1 ? 's' : ''})\nk@400nm: ${k400.toExponential(2)}\nk@550nm: ${k550.toExponential(2)}`;
                                      } else if (mat.type === "brendel-bormann") {
                                        const nosc = (mat.oscillators || []).length;
                                        kInfo = `Brendel-Bormann (ε∞=${mat.epsInf}, ${nosc} oscillator${nosc !== 1 ? 's' : ''}, Gaussian-broadened)\nk@400nm: ${k400.toExponential(2)}\nk@550nm: ${k550.toExponential(2)}`;
                                      } else if (mat.kType === "none") {
                                        kInfo = "No absorption (transparent)";
                                      } else if (mat.kType === "constant") {
                                        kInfo = `k = ${mat.kValue || 0} (constant)`;
                                      } else if (mat.kType === "urbach") {
                                        kInfo = `Absorption edge: ${mat.kEdge}nm\nk@400nm: ${k400.toFixed(4)}\nk@550nm: ${k550.toFixed(4)}`;
                                      }
                                      return `${layer.material}\nn@550nm: ${n.toFixed(3)}\n${kInfo}`;
                                    })()}
                                  >
                                    <Info size={12} />
                                  </div>}
                                </div>
                              </div>
                              <div style={(isPhone || isTablet) ? { display: 'flex', alignItems: 'center', gap: 1 } : undefined}>
                                {(isPhone || isTablet) && <button onTouchStart={(e) => { e.preventDefault(); startHoldRepeat(layer.id, -1); }} onTouchEnd={stopHoldRepeat} onTouchCancel={stopHoldRepeat} onMouseDown={() => startHoldRepeat(layer.id, -1)} onMouseUp={stopHoldRepeat} onMouseLeave={stopHoldRepeat} style={{ width: 22, height: 24, border: `1px solid ${darkMode ? '#363860' : '#d1d5db'}`, borderRadius: '4px 0 0 4px', background: darkMode ? '#1e1f3a' : '#f3f4f6', color: darkMode ? '#a0a0b8' : '#374151', cursor: 'pointer', fontSize: 13, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, padding: 0, touchAction: 'none' }}>−</button>}
                                <input
                                  type="number"
                                  value={layer.thickness === "" ? "" : Math.round(layer.thickness * 100) / 100}
                                  onChange={(e) => updateLayer(layer.id, "thickness", e.target.value)}
                                  className={(isPhone || isTablet) ? "px-1 py-0.5 border-t border-b rounded-none text-xs" : "w-full px-1 py-0.5 border rounded text-xs"}
                                  step="1"
                                  style={(isPhone || isTablet) ? { width: '100%', minWidth: 0, textAlign: 'center', fontSize: 13, borderColor: darkMode ? '#363860' : '#d1d5db' } : undefined}
                                  inputMode={(isPhone || isTablet) ? "decimal" : undefined}
                                />
                                {(isPhone || isTablet) && <button onTouchStart={(e) => { e.preventDefault(); startHoldRepeat(layer.id, 1); }} onTouchEnd={stopHoldRepeat} onTouchCancel={stopHoldRepeat} onMouseDown={() => startHoldRepeat(layer.id, 1)} onMouseUp={stopHoldRepeat} onMouseLeave={stopHoldRepeat} style={{ width: 22, height: 24, border: `1px solid ${darkMode ? '#363860' : '#d1d5db'}`, borderRadius: '0 4px 4px 0', background: darkMode ? '#1e1f3a' : '#f3f4f6', color: darkMode ? '#a0a0b8' : '#374151', cursor: 'pointer', fontSize: 13, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, padding: 0, touchAction: 'none' }}>+</button>}
                              </div>
                              {!(isPhone || isTablet) && <div className="text-[10px] truncate" title={`Optical thickness: ${(getRefractiveIndex(layer.material, qwotReference, layer.iad, layer.packingDensity || 1.0) * (layer.thickness || 0)).toFixed(1)} nm`}>
                                {((getRefractiveIndex(layer.material, qwotReference, layer.iad, layer.packingDensity || 1.0) * (layer.thickness || 0)) / (qwotReference / 4)).toFixed(2)}
                              </div>}
                              {!(isPhone || isTablet) && <div className="text-[10px] text-gray-600 truncate">
                                {layer.lastThickness ? layer.lastThickness.toFixed(1) : "-"}
                              </div>}
                              {!(isPhone || isTablet) && <div className="text-[10px] text-gray-600 truncate">
                                {layer.originalThickness ? layer.originalThickness.toFixed(1) : "-"}
                              </div>}
                              <div className="flex items-center gap-0.5 justify-center">
                                {!(isPhone || isTablet) && layer.packingDensity && layer.packingDensity < 1.0 && (
                                  <span className="px-0.5 bg-purple-100 text-purple-700 rounded text-[7px] font-bold" title={`Packing Density: ${layer.packingDensity.toFixed(2)}`}>
                                    P
                                  </span>
                                )}
                                {!(isPhone || isTablet) && (
                                  <button
                                    onClick={() => setLayers(layers.map(l => l.id === layer.id ? { ...l, locked: !l.locked } : l))}
                                    className={`p-0.5 rounded transition-colors text-[10px] ${layer.locked ? "bg-red-100 text-red-600" : "text-gray-300 hover:text-gray-500"}`}
                                    title={layer.locked ? "Unlock layer (allow shift/factor)" : "Lock layer (exclude from shift/factor)"}
                                  >
                                    <Lock size={10} />
                                  </button>
                                )}
                                {!(isPhone || isTablet) && (
                                  <button
                                    onClick={() => {
                                      if (layer.originalThickness !== undefined) {
                                        setLayers(layers.map(l =>
                                          l.id === layer.id ? { ...l, originalThickness: undefined } : l
                                        ));
                                      } else {
                                        setLayers(layers.map(l =>
                                          l.id === layer.id ? { ...l, originalThickness: layer.thickness } : l
                                        ));
                                      }
                                    }}
                                    className={`p-0.5 rounded transition-colors text-[10px] ${
                                      layer.originalThickness !== undefined
                                        ? "bg-blue-100 text-blue-600"
                                        : "text-gray-400"
                                    }`}
                                    title={layer.originalThickness !== undefined ? "Clear original thickness" : "Save as original thickness"}
                                  >
                                    {"\uD83D\uDCCC"}
                                  </button>
                                )}
                                {!(isPhone || isTablet) && (
                                  <button
                                    onClick={() => openIADModal(layer.id)}
                                    className={`p-0.5 rounded transition-colors ${
                                      layer.iad && layer.iad.enabled
                                        ? "bg-yellow-100 text-yellow-600"
                                        : "text-gray-400"
                                    }`}
                                    title="IAD Settings"
                                  >
                                    <Zap size={10} />
                                  </button>
                                )}
                                <button
                                  onClick={() => removeLayer(layer.id)}
                                  className="p-0.5 hover:bg-red-100 rounded text-red-600"
                                  disabled={layers.length === 1}
                                >
                                  <Trash2 size={(isPhone || isTablet) ? 13 : 10} />
                                </button>
                              </div>
                            </div>

                            {/* Divider line with insert button */}
                            <div
                              className="relative border-b border-gray-300"
                              style={{ height: "1px", zIndex: 3 }}
                            >
                              <button
                                onClick={() => insertLayerAfter(idx)}
                                className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 bg-white hover:bg-green-100 rounded-full text-green-600 border border-gray-300 hover:border-green-500 transition-colors shadow-sm"
                                title={`Insert layer after layer ${layerNum}`}
                              >
                                <Plus size={10} />
                              </button>
                            </div>
                          </React.Fragment>
                        );
                      })}
                        </div>

                        {/* Incident Row */}
                        <div className="grid gap-x-1 p-1 bg-sky-50 border-b border-gray-200 text-xs items-center" style={{ gridTemplateColumns: (isPhone || isTablet) ? '2rem 1fr 7rem 2rem' : '0.8rem 1.5rem minmax(3rem, 1fr) minmax(2.5rem, 4rem) 2.5rem 2.5rem 2.5rem 4.5rem' }}>
                          {!(isPhone || isTablet) && <div></div>}
                          <div className="text-center font-medium" style={{ fontSize: (isPhone || isTablet) ? 10 : undefined }}>Inc</div>
                          <div className="truncate">{incident.material}</div>
                          <div>-</div>
                          {!(isPhone || isTablet) && <div>-</div>}
                          {!(isPhone || isTablet) && <div>-</div>}
                          {!(isPhone || isTablet) && <div>-</div>}
                          <div></div>
                        </div>
                      </>
                    )}
                  </div>

                  {/* Compact Summary for horizontal mode */}
                  <div className="bg-gray-50 rounded p-1 border mt-1 flex-shrink-0">
                    {(isPhone || isTablet) ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10 }}>
                        <span style={{ color: darkMode ? '#a0a0b8' : '#6b7280' }}>{layers.length}L / {layers.reduce((sum, l) => sum + (parseFloat(l.thickness) || 0), 0).toFixed(0)}nm</span>
                        <span style={{ color: darkMode ? '#a0a0b8' : '#6b7280' }}>Factor:</span>
                        <input type="number" value={layerFactor} onChange={(e) => setLayerFactor(e.target.value)} style={{ width: 40, padding: '2px 4px', border: `1px solid ${darkMode ? '#363860' : '#d1d5db'}`, borderRadius: 4, fontSize: 10, background: darkMode ? '#1e1f3a' : '#fff', color: darkMode ? '#e2e4e9' : '#1f2937' }} step="0.01" min="0" />
                        <button onClick={applyFactorToLayers} style={{ padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 600, background: '#4f46e5', color: '#fff', border: 'none', cursor: 'pointer' }}>Apply</button>
                        <div style={{ marginLeft: 'auto' }}>
                          <button onClick={resetToOriginal} style={{ padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 600, background: '#dc2626', color: '#fff', border: 'none', cursor: 'pointer', opacity: !layers.some((l) => l.originalThickness !== undefined) ? 0.4 : 1 }} disabled={!layers.some((l) => l.originalThickness !== undefined)}>Reset</button>
                        </div>
                      </div>
                    ) : (
                      <>
                      <div className="text-[10px] text-gray-600 flex flex-wrap gap-2 items-center">
                        <span>Layers: {layers.length}</span>
                        <span>Total: {layers.reduce((sum, l) => sum + (parseFloat(l.thickness) || 0), 0).toFixed(0)}nm</span>
                        <span className="flex items-center gap-1">
                          QWOT λ:
                          <input type="number" value={qwotReference} onChange={(e) => setQwotReference(parseInt(e.target.value) || 550)} className="w-12 px-1 py-0.5 border rounded text-[10px]" step="10" min="380" max="780" />
                        </span>
                      </div>
                      <div className="text-[10px] text-gray-600 flex flex-wrap gap-2 items-center mt-1">
                        <span className="flex items-center gap-1">
                          Factor:
                          <input type="number" value={layerFactor} onChange={(e) => setLayerFactor(e.target.value)} className="w-12 px-1 py-0.5 border rounded text-[10px]" step="0.01" />
                          <button onClick={applyFactorToLayers} className="px-1 py-0.5 bg-indigo-600 text-white rounded text-[9px]">Apply</button>
                        </span>
                        <span className="flex items-center gap-1">
                          Shift:
                          <input type="number" value={shiftValue} onChange={(e) => setShiftValue(e.target.value)} className="w-12 px-1 py-0.5 border rounded text-[10px]" step="1" />
                          <button onClick={applyShift} className="px-1 py-0.5 bg-green-600 text-white rounded text-[9px]" disabled={shiftMode === "up-down" || parseFloat(shiftValue) === 0}>Apply</button>
                        </span>
                        <button onClick={undoLastChange} className="px-1 py-0.5 bg-orange-600 text-white rounded text-[9px]" disabled={!layers.some((l) => l.lastThickness !== undefined)}>Undo</button>
                        <button onClick={resetToOriginal} className="px-1 py-0.5 bg-red-600 text-white rounded text-[9px]" disabled={!layers.some((l) => l.originalThickness !== undefined)}>Reset</button>
                      </div>
                      </>
                    )}
                  </div>
                </div>
              )}

              {/* Horizontal mode divider */}
              {effectiveLayoutMode === "wide" && (
                <div
                  className="flex items-center justify-center flex-shrink-0"
                  style={{ width: '11px', padding: '0 4px', transition: 'background-color 0.15s', backgroundClip: 'content-box', backgroundColor: theme.borderStrong, cursor: 'col-resize' }}
                  onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = theme.accentHover; }}
                  onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = theme.borderStrong; }}
                  onMouseDown={handleHorizontalDividerMouseDown}
                  title="Drag to resize"
                >
                </div>
              )}

              {/* Chart container - horizontal mode only */}
              {effectiveLayoutMode === "wide" && (
              <div
                style={{ flex: 1, height: "100%" }}
                className="min-h-0 flex gap-2 flex-shrink-0"
              >
                <div className="flex-1 min-w-0 min-h-0" style={{ height: "100%", position: 'relative' }}>
                  {chartZoom && displayMode !== "admittance" && displayMode !== "efield" && (
                    <button
                      onClick={resetChartZoom}
                      style={{
                        position: 'absolute', top: 4, right: 24, zIndex: 10,
                        padding: '2px 8px', borderRadius: 6, fontSize: 10, fontWeight: 600,
                        background: darkMode ? 'var(--accent)' : '#4f46e5',
                        color: '#fff', border: 'none', cursor: 'pointer',
                        boxShadow: '0 1px 4px rgba(0,0,0,0.2)',
                      }}
                    >
                      Reset Zoom
                    </button>
                  )}
                  {layerStacks.filter(s => s.visible && s.layers.length > 0).length === 0 ? (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: theme.textMuted }}>
                      <div style={{ textAlign: 'center' }}>
                        <p style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>No layer stacks</p>
                        <p style={{ fontSize: 12 }}>Create a layer stack to see the reflectivity chart</p>
                      </div>
                    </div>
                  ) : displayMode === "admittance" ? renderAdmittanceChart() : displayMode === "efield" ? renderEfieldChart() : (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart
                      data={reflectivityData}
                      margin={{ top: 5, right: 20, bottom: 20, left: 10 }}
                      onMouseDown={handleChartMouseDown}
                      onMouseMove={handleChartMouseMove}
                      onMouseUp={handleChartMouseUp}
                    >
                      <CartesianGrid strokeDasharray="4 4" stroke={theme.chartGrid} strokeOpacity={0.4} />
                      <XAxis
                        dataKey="wavelength"
                        type="number"
                        domain={chartZoom ? [chartZoom.x1, chartZoom.x2] : [wavelengthRange.min, wavelengthRange.max]}
                        ticks={calculateXAxisTicks()}
                        label={{
                          value: "Wavelength (nm)",
                          position: "insideBottom",
                          offset: -10,
                          ...axisLabelStyle,
                        }}
                        tick={{ fontSize: 11, fill: theme.chartAxisText }}
                        stroke={theme.chartGrid}
                        allowDataOverflow={false}
                      />
                      <YAxis
                        yAxisId="left"
                        label={{
                          value: `${
                            displayMode === "transmission"
                              ? "Transmission"
                              : displayMode === "absorption"
                              ? "Absorption"
                              : "Reflectivity"
                          } (%)`,
                          angle: -90,
                          position: "insideLeft",
                          ...axisLabelStyle,
                        }}
                        domain={[reflectivityRange.min, reflectivityRange.max]}
                        ticks={calculateYAxisTicks()}
                        tick={{ fontSize: 11, fill: theme.chartAxisText }}
                        stroke={theme.chartGrid}
                        allowDataOverflow={true}
                      />
                      {showPhase && (
                        <YAxis
                          yAxisId="right"
                          orientation="right"
                          label={{ value: "Phase (\u00B0)", angle: 90, position: "insideRight", ...axisLabelStyle }}
                          domain={[-180, 180]}
                          ticks={[-180, -90, 0, 90, 180]}
                          tick={{ fontSize: 11, fill: theme.chartAxisText }}
                          stroke={theme.chartGrid}
                          allowDataOverflow={true}
                        />
                      )}
                      <Tooltip content={<ChartTooltip />} />
                      <Legend wrapperStyle={{ fontSize: "11px", paddingTop: "8px", color: theme.textSecondary }} />

                      {targets.map((target) => {
                        // Clip target to visible chart range
                        const x1 = Math.max(target.wavelengthMin, wavelengthRange.min);
                        const x2 = Math.min(target.wavelengthMax, wavelengthRange.max);
                        const y1 = Math.max(target.reflectivityMin, reflectivityRange.min);
                        const y2 = Math.min(target.reflectivityMax, reflectivityRange.max);
                        
                        // Only render if there's actual overlap with visible area
                        if (x1 >= x2 || y1 >= y2) return null;
                        
                        return (
                          <ReferenceArea
                            key={target.id}
                            yAxisId="left"
                            x1={x1}
                            x2={x2}
                            y1={y1}
                            y2={y2}
                            fill="rgba(34, 197, 94, 0.1)"
                            stroke="rgba(34, 197, 94, 0.6)"
                            strokeWidth={2}
                            strokeDasharray="5 5"
                            label={{
                              value: target.name,
                              position: "insideTopLeft",
                              fill: darkMode ? '#4ade80' : '#15803d',
                              fontSize: 11,
                              fontWeight: "bold",
                            }}
                          />
                        );
                      })}

                      {layerStacks
                        .filter((s) => s.visible && s.layers.length > 0)
                        .map((stack) => {
                          const dataKey =
                            displayMode === "transmission"
                              ? `stack_${stack.id}_transmission`
                              : displayMode === "absorption"
                              ? `stack_${stack.id}_absorption`
                              : `stack_${stack.id}`;
                          return (
                            <Line
                              key={stack.id}
                              yAxisId="left"
                              type="monotone"
                              dataKey={dataKey}
                              stroke={stack.color}
                              strokeWidth={stack.id === currentStackId ? 3 : 2}
                              dot={false}
                              name={getStackDisplayName(stack)}
                              isAnimationActive={false}
                            />
                          );
                        })}

                      {/* Factor Preview Line - only for current stack */}
                      {showFactorPreview && factorPreviewData.length > 0 && (
                        <Line
                          yAxisId="left"
                          type="monotone"
                          data={factorPreviewData}
                          dataKey={
                            displayMode === "transmission"
                              ? "preview_transmission"
                              : "preview"
                          }
                          stroke={
                            layerStacks.find((s) => s.id === currentStackId)
                              ?.color || "#4f46e5"
                          }
                          strokeWidth={2}
                          strokeOpacity={0.4}
                          strokeDasharray="5 5"
                          dot={false}
                          name="Factor Preview"
                          isAnimationActive={false}
                        />
                      )}

                      {/* Shift Preview Line - only for current stack */}
                      {showShiftPreview && shiftPreviewData.length > 0 && (
                        <Line
                          yAxisId="left"
                          type="monotone"
                          data={shiftPreviewData}
                          dataKey={
                            displayMode === "transmission"
                              ? "shiftPreview_transmission"
                              : "shiftPreview"
                          }
                          stroke={
                            layerStacks.find((s) => s.id === currentStackId)
                              ?.color || "#4f46e5"
                          }
                          strokeWidth={2}
                          strokeOpacity={0.3}
                          strokeDasharray="3 3"
                          dot={false}
                          name="Shift Preview"
                          isAnimationActive={false}
                        />
                      )}

                      {experimentalData && (
                        <Line
                          yAxisId="left"
                          type="monotone"
                          dataKey={
                            displayMode === "transmission"
                              ? "experimental_transmission"
                              : "experimental"
                          }
                          stroke="#ef4444"
                          strokeWidth={2}
                          dot={false}
                          name="Experimental"
                          isAnimationActive={false}
                        />
                      )}

                      {/* Multi-Angle Lines for Current Stack */}
                      {currentStackId &&
                        layerStacks.find((s) => s.id === currentStackId)
                          ?.visible &&
                        [
                          {
                            key: "angle_15",
                            angle: 15,
                            dash: "8 4",
                            opacity: 0.7,
                          },
                          {
                            key: "angle_30",
                            angle: 30,
                            dash: "6 3",
                            opacity: 0.6,
                          },
                          {
                            key: "angle_45",
                            angle: 45,
                            dash: "4 2",
                            opacity: 0.5,
                          },
                          {
                            key: "angle_60",
                            angle: 60,
                            dash: "2 2",
                            opacity: 0.4,
                          },
                        ].map((angleData) => {
                          if (!showAngles[angleData.key]) return null;
                          const dataKey =
                            displayMode === "transmission"
                              ? `stack_${currentStackId}_${angleData.key}_transmission`
                              : displayMode === "absorption"
                              ? `stack_${currentStackId}_${angleData.key}_absorption`
                              : `stack_${currentStackId}_${angleData.key}`;
                          const currentStack = layerStacks.find(
                            (s) => s.id === currentStackId
                          );
                          return (
                            <Line
                              key={angleData.key}
                              yAxisId="left"
                              type="monotone"
                              dataKey={dataKey}
                              stroke={currentStack?.color || "#4f46e5"}
                              strokeWidth={1.5}
                              strokeOpacity={angleData.opacity}
                              strokeDasharray={angleData.dash}
                              dot={false}
                              name={`${currentStack?.name || "Current"} @ ${
                                angleData.angle
                              }°`}
                              isAnimationActive={false}
                            />
                          );
                        })}

                      {/* Phase Shift Overlay Lines */}
                      {showPhase && layerStacks.filter((s) => s.visible && s.layers.length > 0).map((stack) => (
                        <Line
                          key={`phase-${stack.id}`}
                          yAxisId="right"
                          type="monotone"
                          dataKey={`stack_${stack.id}_phase`}
                          stroke={stack.color}
                          strokeWidth={1.5}
                          strokeDasharray="6 3"
                          strokeOpacity={0.6}
                          dot={false}
                          name={`${getStackDisplayName(stack)} Phase`}
                          isAnimationActive={false}
                        />
                      ))}

                      {/* Zoom selection overlay */}
                      {zoomSelecting && zoomSelecting.endX != null && (
                        <ReferenceArea
                          yAxisId="left"
                          x1={zoomSelecting.startX}
                          x2={zoomSelecting.endX}
                          fill={darkMode ? 'rgba(99,102,241,0.2)' : 'rgba(79,70,229,0.15)'}
                          stroke={darkMode ? '#6366f1' : '#4f46e5'}
                          strokeWidth={1}
                          strokeDasharray="3 3"
                        />
                      )}
                    </LineChart>
                  </ResponsiveContainer>
                  )}
                </div>


                {/* Enhanced Color Analysis Sidebar */}
                <div className={`bg-gray-50 rounded p-2 border flex-shrink-0 flex flex-col overflow-y-auto ${effectiveLayoutMode === "wide" ? "w-36" : "w-48"}`} style={{ maxHeight: "100%", display: (isPhone || isTablet) ? 'none' : undefined }}>
                  <div className="text-xs font-bold text-gray-800 mb-2">
                    Color Analysis
                  </div>

                  {/* Current Stack Color - Enhanced */}
                  {colorData && (
                    <div className="mb-3 pb-3 border-b border-gray-300">
                      <div className="text-[10px] text-gray-600 font-semibold mb-1.5">
                        Current Stack
                      </div>

                      {/* Larger Color Swatch */}
                      <div
                        className="w-full h-16 rounded border-2 border-gray-400 shadow-md mb-2"
                        style={{ backgroundColor: colorData.rgb }}
                        title={colorData.hex}
                      ></div>

                      {/* Color Name */}
                      <div className="text-sm font-bold text-gray-900 mb-2">
                        {colorData.colorName}
                      </div>

                      {/* CIE Lab Color Space */}
                      <div className="bg-blue-50 rounded p-1.5 mb-2">
                        <div className="text-[9px] font-semibold text-blue-800 mb-1">
                          CIE Lab
                        </div>
                        <div className="text-[10px] text-gray-700 space-y-0.5">
                          <div className="flex justify-between">
                            <span>L* (Lightness):</span>
                            <span className="font-semibold">{colorData.L}</span>
                          </div>
                          <div className="flex justify-between">
                            <span>a* (±Red/Green):</span>
                            <span className="font-semibold">
                              {colorData.a_star}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span>b* (±Yellow/Blue):</span>
                            <span className="font-semibold">
                              {colorData.b_star}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* LCh Color Space */}
                      <div className="bg-purple-50 rounded p-1.5 mb-2">
                        <div className="text-[9px] font-semibold text-purple-800 mb-1">
                          LCh (Cylindrical)
                        </div>
                        <div className="text-[10px] text-gray-700 space-y-0.5">
                          <div className="flex justify-between">
                            <span>L (Lightness):</span>
                            <span className="font-semibold">
                              {colorData.L_lch}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span>C (Chroma):</span>
                            <span className="font-semibold">{colorData.C}</span>
                          </div>
                          <div className="flex justify-between">
                            <span>h (Hue°):</span>
                            <span className="font-semibold">
                              {colorData.h}°
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Additional Metrics */}
                      <div className="text-[10px] text-gray-700 space-y-0.5">
                        <div className="flex justify-between">
                          <span>Dominant λ:</span>
                          <span className="font-semibold">
                            {colorData.dominantWavelength}nm
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span>Avg R:</span>
                          <span className="font-semibold">
                            {colorData.avgReflectivity}%
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span>Hex:</span>
                          <span className="font-mono text-[9px]">
                            {colorData.hex}
                          </span>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Illuminant Selector */}
                  <div className="mb-3 pb-3 border-b border-gray-300">
                    <div className="text-[10px] font-semibold text-gray-700 mb-1">
                      Illuminant
                    </div>
                    <select
                      value={selectedIlluminant}
                      onChange={(e) => {
                        if (tierLimits.allowedIlluminants.includes(e.target.value)) {
                          setSelectedIlluminant(e.target.value);
                        } else {
                          setUpgradeFeature('additional illuminants');
                          setShowUpgradePrompt(true);
                        }
                      }}
                      className="w-full px-1.5 py-1 border rounded text-[10px] bg-white cursor-pointer"
                    >
                      <option value="D65">D65 - Daylight 6500K</option>
                      <option value="D50" disabled={!tierLimits.allowedIlluminants.includes('D50')}>D50 - Daylight 5000K{!tierLimits.allowedIlluminants.includes('D50') ? ' 🔒' : ''}</option>
                      <option value="A" disabled={!tierLimits.allowedIlluminants.includes('A')}>A - Incandescent 2856K{!tierLimits.allowedIlluminants.includes('A') ? ' 🔒' : ''}</option>
                      <option value="F2" disabled={!tierLimits.allowedIlluminants.includes('F2')}>F2 - Cool White Fluorescent{!tierLimits.allowedIlluminants.includes('F2') ? ' 🔒' : ''}</option>
                      <option value="F11" disabled={!tierLimits.allowedIlluminants.includes('F11')}>F11 - Tri-phosphor Fluorescent{!tierLimits.allowedIlluminants.includes('F11') ? ' 🔒' : ''}</option>
                    </select>
                  </div>

                  {/* All Visible Stacks Colors - Compact */}
                  {Object.keys(stackColorData).length > 0 && (
                    <details className="mb-3 pb-3 border-b border-gray-300">
                      <summary className="text-[10px] text-gray-600 font-semibold mb-1.5 cursor-pointer select-none hover:text-gray-800">
                        All Visible Stacks ({Object.keys(stackColorData).length})
                      </summary>
                      <div className="space-y-2 mt-1.5">
                        {Object.entries(stackColorData).map(
                          ([stackId, color]) => (
                            <div key={stackId} className="text-[9px]">
                              <div className="flex items-center gap-1 mb-0.5">
                                <div
                                  className="w-2 h-2 rounded-full flex-shrink-0"
                                  style={{ backgroundColor: color.stackColor }}
                                ></div>
                                <div className="font-semibold text-gray-700 truncate text-[10px]">
                                  {color.stackName}
                                </div>
                              </div>
                              <div
                                className="w-full h-8 rounded border border-gray-300 shadow-sm mb-1"
                                style={{ backgroundColor: color.rgb }}
                                title={`${color.colorName} - ${color.hex}`}
                              ></div>
                              <div className="text-gray-600 space-y-0.5 text-[9px]">
                                <div className="font-semibold">
                                  {color.colorName}
                                </div>
                                <div className="flex justify-between">
                                  <span>L*:</span>
                                  <span>{color.L}</span>
                                </div>
                                <div className="flex justify-between">
                                  <span>C:</span>
                                  <span>{color.C}</span>
                                </div>
                                <div className="flex justify-between">
                                  <span>h:</span>
                                  <span>{color.h}°</span>
                                </div>
                              </div>
                            </div>
                          )
                        )}
                      </div>
                    </details>
                  )}

                  {/* Experimental Data Color */}
                  {experimentalColorData && (
                    <div className="mb-3 pb-3 border-b border-gray-300">
                      <div className="text-[10px] text-gray-600 font-semibold mb-1.5">
                        Experimental
                      </div>
                      <div
                        className="w-full h-10 rounded border-2 border-red-400 shadow-sm mb-1"
                        style={{ backgroundColor: experimentalColorData.rgb }}
                        title={experimentalColorData.hex}
                      ></div>
                      <div className="text-[10px] space-y-0.5">
                        <div className="font-semibold text-gray-900">
                          {experimentalColorData.colorName}
                        </div>
                        <div className="text-gray-700 space-y-0.5 text-[9px]">
                          <div className="flex justify-between">
                            <span>L*:</span>
                            <span>{experimentalColorData.L}</span>
                          </div>
                          <div className="flex justify-between">
                            <span>C:</span>
                            <span>{experimentalColorData.C}</span>
                          </div>
                          <div className="flex justify-between">
                            <span>h:</span>
                            <span>{experimentalColorData.h}°</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* ΔE* Color Difference — Current Stack */}
                  {colorData && experimentalColorData && (
                    <div className="mb-3 pb-3 border-b border-gray-300">
                      <div className="text-[10px] text-gray-600 font-semibold mb-1.5">
                        ΔE* vs Experimental
                      </div>
                      <div className="p-1.5 bg-red-50 rounded border border-red-200">
                        {(() => {
                          const dL = parseFloat(colorData.L) - parseFloat(experimentalColorData.L);
                          const da = parseFloat(colorData.a_star) - parseFloat(experimentalColorData.a_star);
                          const db = parseFloat(colorData.b_star) - parseFloat(experimentalColorData.b_star);
                          const deltaE = Math.sqrt(dL * dL + da * da + db * db);
                          return (
                            <div className={`text-sm font-bold ${deltaE < 1 ? "text-green-600" : deltaE < 2 ? "text-yellow-600" : deltaE < 3 ? "text-orange-600" : "text-red-600"}`}>
                              ΔE* = {deltaE.toFixed(2)}
                              <span className="text-[8px] font-normal text-gray-500 ml-1">
                                {deltaE < 0.5 ? "(Imperceptible)" : deltaE < 1 ? "(Slight)" : deltaE < 2 ? "(Noticeable)" : deltaE < 3 ? "(Visible)" : deltaE < 5 ? "(Significant)" : "(Large)"}
                              </span>
                            </div>
                          );
                        })()}
                      </div>
                    </div>
                  )}

                  {/* Compare Colors Button */}
                  {Object.keys(stackColorData).length > 1 && (
                    <div className="mb-3 pb-3 border-b border-gray-300">
                      <button
                        onClick={() => { setColorCompareSelected(Object.keys(stackColorData)); setShowColorCompareModal(true); }}
                        className="w-full px-2 py-1.5 bg-indigo-600 text-white rounded hover:bg-indigo-700 text-[10px] font-semibold flex items-center justify-center gap-1"
                      >
                        Compare Stack Colors
                      </button>
                      <div className="text-[8px] text-gray-500 mt-1 text-center">
                        ΔE* comparison across all visible stacks
                      </div>
                    </div>
                  )}

                  {/* Angle-Dependent Color Analysis */}
                  {angleColorData && angleColorData.length > 0 && (
                    <details className="mb-3 pb-3 border-b border-gray-300">
                      <summary className="text-[10px] text-gray-600 font-semibold mb-1.5 cursor-pointer select-none hover:text-gray-800">
                        Color vs Viewing Angle
                      </summary>

                      {/* Color swatches row */}
                      <div className="flex gap-0.5 mb-2 mt-1.5">
                        {angleColorData.map((data) => (
                          <div key={data.angle} className="flex-1 text-center">
                            <div
                              className="w-full h-6 rounded border border-gray-300"
                              style={{ backgroundColor: data.rgb }}
                              title={`${data.angle}°: L*=${data.L.toFixed(
                                1
                              )}, a*=${data.a.toFixed(1)}, b*=${data.b.toFixed(
                                1
                              )}`}
                            ></div>
                            <div className="text-[8px] text-gray-600 mt-0.5">
                              {data.angle}°
                            </div>
                          </div>
                        ))}
                      </div>

                      {/* ΔE* from normal */}
                      <div className="text-[9px] text-gray-700 mb-1 font-semibold">
                        ΔE* from 0° (normal):
                      </div>
                      <div className="space-y-0.5">
                        {angleColorData
                          .filter((d) => d.angle > 0)
                          .map((data) => (
                            <div
                              key={data.angle}
                              className="flex justify-between text-[9px]"
                            >
                              <span>{data.angle}°:</span>
                              <span
                                className={`font-semibold ${
                                  data.deltaE < 1
                                    ? "text-green-600"
                                    : data.deltaE < 2
                                    ? "text-yellow-600"
                                    : data.deltaE < 3
                                    ? "text-orange-500"
                                    : "text-red-600"
                                }`}
                              >
                                {data.deltaE.toFixed(2)}
                                {data.deltaE < 1
                                  ? " ✓"
                                  : data.deltaE >= 3
                                  ? " ⚠"
                                  : ""}
                              </span>
                            </div>
                          ))}
                      </div>

                      {/* L*a*b* details (collapsible) */}
                      <details className="mt-2">
                        <summary className="text-[9px] text-gray-500 cursor-pointer hover:text-gray-700">
                          Show L*a*b* values...
                        </summary>
                        <div className="mt-1 space-y-1">
                          {angleColorData.map((data) => (
                            <div
                              key={data.angle}
                              className="text-[8px] text-gray-600 bg-gray-50 rounded p-1"
                            >
                              <span className="font-semibold">
                                {data.angle}°:
                              </span>{" "}
                              L*={data.L.toFixed(1)}, a*={data.a.toFixed(1)},
                              b*={data.b.toFixed(1)}
                            </div>
                          ))}
                        </div>
                      </details>

                      {/* Interpretation guide */}
                      <div className="mt-2 text-[8px] text-gray-500 bg-blue-50 rounded p-1">
                        <div className="font-semibold text-blue-700 mb-0.5">
                          Color Shift Guide:
                        </div>
                        <div>ΔE* &lt; 1: Imperceptible</div>
                        <div>ΔE* 1-2: Slight (acceptable)</div>
                        <div>ΔE* 2-3: Noticeable</div>
                        <div>ΔE* &gt; 3: Obvious shift ⚠</div>
                      </div>
                    </details>
                  )}

                  {/* Multi-Angle Selector */}
                  <details className="mb-3 pb-3 border-t border-gray-300 pt-2">
                    <summary className="text-[10px] font-semibold text-gray-700 mb-1.5 cursor-pointer select-none hover:text-gray-800">
                      Multi-Angle Display
                    </summary>
                    <div className="space-y-1 mt-1.5">
                      {[
                        { key: "angle_0", label: "0° (Normal)", angle: 0 },
                        { key: "angle_15", label: "15°", angle: 15 },
                        { key: "angle_30", label: "30°", angle: 30 },
                        { key: "angle_45", label: "45°", angle: 45 },
                        { key: "angle_60", label: "60°", angle: 60 },
                      ].map((angleOpt) => {
                        const allowed = tierLimits.allowedAngles.includes(angleOpt.angle);
                        return (
                        <label
                          key={angleOpt.key}
                          className={`flex items-center gap-1 text-[10px] p-1 rounded ${allowed ? 'cursor-pointer hover:bg-gray-100' : 'cursor-not-allowed opacity-50'}`}
                        >
                          <input
                            type="checkbox"
                            checked={showAngles[angleOpt.key]}
                            disabled={!allowed}
                            onChange={(e) => {
                              if (!allowed) { setUpgradeFeature('multi-angle display'); setShowUpgradePrompt(true); return; }
                              setShowAngles({
                                ...showAngles,
                                [angleOpt.key]: e.target.checked,
                              });
                            }}
                            className={allowed ? "cursor-pointer" : "cursor-not-allowed"}
                          />
                          <span>{angleOpt.label}{!allowed ? ' 🔒' : ''}</span>
                        </label>
                      );})}
                    </div>
                    <div className="mt-2 text-[9px] text-gray-500">
                      Toggle to show/hide angle curves on chart
                    </div>
                    <div className="mt-1 text-[8px]" style={{ color: darkMode ? '#6b7280' : '#9ca3af', lineHeight: 1.3 }}>
                      Note: Angle calculations use real refractive indices. Normal incidence (0°) includes full complex treatment for absorbing materials.
                    </div>
                  </details>

                  {/* Mode-specific options */}
                  <div className="mt-auto pt-2 border-t border-gray-300">
                    {(displayMode === "reflectivity" || displayMode === "transmission" || displayMode === "absorption") && (
                      <label className="flex items-center gap-1 text-[10px] cursor-pointer">
                        <input type="checkbox" checked={showPhase} onChange={(e) => setShowPhase(e.target.checked)} className="cursor-pointer" />
                        <span>Phase shift overlay ({"\u00B0"})</span>
                      </label>
                    )}
                    {displayMode === "admittance" && (
                      <div>
                        <div className="text-[10px] font-semibold text-gray-700 mb-1">Wavelengths (nm)</div>
                        <div className="space-y-1">
                          {admittanceWavelengths.map((wl, idx) => (
                            <div key={idx} className="flex items-center gap-1">
                              <input type="number" value={wl} onChange={(e) => { const nw = [...admittanceWavelengths]; nw[idx] = parseFloat(e.target.value) || 0; setAdmittanceWavelengths(nw); }} className="w-14 px-1 py-0.5 border rounded text-[10px]" step="10" min={wavelengthRange.min} max={wavelengthRange.max} />
                              <div className="w-3 h-3 rounded-full border flex-shrink-0" style={{ backgroundColor: admittanceColors[idx % admittanceColors.length] }} />
                              {admittanceWavelengths.length > 1 && (
                                <button onClick={() => setAdmittanceWavelengths(admittanceWavelengths.filter((_, i) => i !== idx))} className="text-red-500 text-[10px] hover:text-red-700">x</button>
                              )}
                            </div>
                          ))}
                        </div>
                        {admittanceWavelengths.length < 10 && (
                          <button onClick={() => setAdmittanceWavelengths([...admittanceWavelengths, 500])} className="mt-1 text-[10px] text-indigo-600 hover:text-indigo-800">+ Add wavelength</button>
                        )}
                        <div className="text-[9px] text-gray-500 mt-1">Each wavelength traces a separate locus</div>
                      </div>
                    )}
                    {displayMode === "efield" && (
                      <div>
                        <div className="text-[10px] font-semibold text-gray-700 mb-1">Wavelengths (nm)</div>
                        <div className="space-y-1">
                          {efieldWavelengths.map((wl, idx) => (
                            <div key={idx} className="flex items-center gap-1">
                              <input type="number" value={wl} onChange={(e) => { const nw = [...efieldWavelengths]; nw[idx] = parseFloat(e.target.value) || 0; setEfieldWavelengths(nw); }} className="w-14 px-1 py-0.5 border rounded text-[10px]" step="10" min={wavelengthRange.min} max={wavelengthRange.max} />
                              <div className="w-3 h-3 rounded-full border flex-shrink-0" style={{ backgroundColor: admittanceColors[idx % admittanceColors.length] }} />
                              {efieldWavelengths.length > 1 && (
                                <button onClick={() => setEfieldWavelengths(efieldWavelengths.filter((_, i) => i !== idx))} className="text-red-500 text-[10px] hover:text-red-700">x</button>
                              )}
                            </div>
                          ))}
                        </div>
                        {efieldWavelengths.length < 10 && (
                          <button onClick={() => setEfieldWavelengths([...efieldWavelengths, 500])} className="mt-1 text-[10px] text-indigo-600 hover:text-indigo-800">+ Add wavelength</button>
                        )}
                        <div className="text-[9px] text-gray-500 mt-1">Each wavelength shows a separate E-field curve</div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
              )}

              {/* VERTICAL MODE - Complete layout with sidebar on right */}
              {effectiveLayoutMode === "tall" && (
                <div className="flex flex-row flex-1 gap-2 min-h-0">
                  {/* Left column: Chart + Divider + Layers */}
                  <div className="flex-1 flex flex-col min-h-0 min-w-0">
                    {/* Chart section */}
                    <div style={{ height: `${isPhone ? Math.min(chartHeight, 45) : (isTablet && screenHeight < 500) ? Math.min(chartHeight, 35) : chartHeight}%`, position: 'relative' }} className="min-h-0 flex-shrink-0" onTouchEnd={(e) => { if (!isPhone && !isTablet) return; const now = Date.now(); if (chartDoubleTapRef.current && now - chartDoubleTapRef.current < 300) { resetChartZoom(); chartDoubleTapRef.current = 0; } else { chartDoubleTapRef.current = now; } }}>
                      {chartZoom && displayMode !== "admittance" && displayMode !== "efield" && (
                        <button
                          onClick={resetChartZoom}
                          style={{
                            position: 'absolute', top: 4, right: 24, zIndex: 10,
                            padding: '2px 8px', borderRadius: 6, fontSize: 10, fontWeight: 600,
                            background: darkMode ? 'var(--accent)' : '#4f46e5',
                            color: '#fff', border: 'none', cursor: 'pointer',
                            boxShadow: '0 1px 4px rgba(0,0,0,0.2)',
                          }}
                        >
                          Reset Zoom
                        </button>
                      )}
                      {layerStacks.filter(s => s.visible && s.layers.length > 0).length === 0 ? (
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: theme.textMuted }}>
                          <div style={{ textAlign: 'center' }}>
                            <p style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>No layer stacks</p>
                            <p style={{ fontSize: 12 }}>Create a layer stack to see the reflectivity chart</p>
                          </div>
                        </div>
                      ) : displayMode === "admittance" ? renderAdmittanceChart() : displayMode === "efield" ? renderEfieldChart() : (
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={reflectivityData} margin={{ top: 5, right: 20, bottom: 20, left: 10 }} onMouseDown={handleChartMouseDown} onMouseMove={handleChartMouseMove} onMouseUp={handleChartMouseUp}>
                          <CartesianGrid strokeDasharray="4 4" stroke={theme.chartGrid} strokeOpacity={0.4} />
                          <XAxis
                            dataKey="wavelength"
                            type="number"
                            domain={chartZoom ? [chartZoom.x1, chartZoom.x2] : [wavelengthRange.min, wavelengthRange.max]}
                            ticks={calculateXAxisTicks()}
                            label={{ value: "Wavelength (nm)", position: "insideBottom", offset: -10, ...axisLabelStyle }}
                            tick={{ fontSize: 11, fill: theme.chartAxisText }}
                            stroke={theme.chartGrid}
                            allowDataOverflow={false}
                          />
                          <YAxis
                            yAxisId="left"
                            label={{ value: `${displayMode === "transmission" ? "Transmission" : displayMode === "absorption" ? "Absorption" : "Reflectivity"} (%)`, angle: -90, position: "insideLeft", ...axisLabelStyle }}
                            domain={[reflectivityRange.min, reflectivityRange.max]}
                            ticks={calculateYAxisTicks()}
                            tick={{ fontSize: 11, fill: theme.chartAxisText }}
                            stroke={theme.chartGrid}
                            allowDataOverflow={true}
                          />
                          {showPhase && (
                            <YAxis
                              yAxisId="right"
                              orientation="right"
                              label={{ value: "Phase (\u00B0)", angle: 90, position: "insideRight", ...axisLabelStyle }}
                              domain={[-180, 180]}
                              ticks={[-180, -90, 0, 90, 180]}
                              tick={{ fontSize: 11, fill: theme.chartAxisText }}
                              stroke={theme.chartGrid}
                              allowDataOverflow={true}
                            />
                          )}
                          <Tooltip content={<ChartTooltip />} />
                          <Legend wrapperStyle={{ fontSize: "11px", paddingTop: "8px", color: theme.textSecondary }} />
                          {targets.map((target) => {
                            const x1 = Math.max(target.wavelengthMin, wavelengthRange.min);
                            const x2 = Math.min(target.wavelengthMax, wavelengthRange.max);
                            const y1 = Math.max(target.reflectivityMin, reflectivityRange.min);
                            const y2 = Math.min(target.reflectivityMax, reflectivityRange.max);
                            if (x1 >= x2 || y1 >= y2) return null;
                            return (
                              <ReferenceArea key={target.id} yAxisId="left" x1={x1} x2={x2} y1={y1} y2={y2} fill="rgba(34, 197, 94, 0.1)" stroke="rgba(34, 197, 94, 0.6)" strokeWidth={2} strokeDasharray="5 5" label={{ value: target.name, position: "insideTopLeft", fill: darkMode ? '#4ade80' : '#15803d', fontSize: 11, fontWeight: "bold" }} />
                            );
                          })}
                          {layerStacks.filter((s) => s.visible && s.layers.length > 0).map((stack) => {
                            const dataKey = displayMode === "transmission" ? `stack_${stack.id}_transmission` : displayMode === "absorption" ? `stack_${stack.id}_absorption` : `stack_${stack.id}`;
                            return (<Line key={stack.id} yAxisId="left" type="monotone" dataKey={dataKey} stroke={stack.color} strokeWidth={stack.id === currentStackId ? 3 : 2} dot={false} name={getStackDisplayName(stack)} isAnimationActive={false} />);
                          })}
                          {showFactorPreview && factorPreviewData.length > 0 && (
                            <Line yAxisId="left" type="monotone" data={factorPreviewData} dataKey={displayMode === "transmission" ? "preview_transmission" : "preview"} stroke={layerStacks.find((s) => s.id === currentStackId)?.color || "#4f46e5"} strokeWidth={2} strokeOpacity={0.4} strokeDasharray="5 5" dot={false} name="Factor Preview" isAnimationActive={false} />
                          )}
                          {showShiftPreview && shiftPreviewData.length > 0 && (
                            <Line yAxisId="left" type="monotone" data={shiftPreviewData} dataKey={displayMode === "transmission" ? "shiftPreview_transmission" : "shiftPreview"} stroke={layerStacks.find((s) => s.id === currentStackId)?.color || "#4f46e5"} strokeWidth={2} strokeOpacity={0.3} strokeDasharray="3 3" dot={false} name="Shift Preview" isAnimationActive={false} />
                          )}
                          {experimentalData && (
                            <Line yAxisId="left" type="monotone" dataKey={displayMode === "transmission" ? "experimental_transmission" : "experimental"} stroke="#ef4444" strokeWidth={2} dot={false} name="Experimental" isAnimationActive={false} />
                          )}
                          {/* Multi-Angle Lines for Current Stack */}
                          {currentStackId && layerStacks.find((s) => s.id === currentStackId)?.visible && [
                            { key: "angle_15", angle: 15, dash: "8 4", opacity: 0.7 },
                            { key: "angle_30", angle: 30, dash: "6 3", opacity: 0.6 },
                            { key: "angle_45", angle: 45, dash: "4 2", opacity: 0.5 },
                            { key: "angle_60", angle: 60, dash: "2 2", opacity: 0.4 },
                          ].map((angleData) => {
                            if (!showAngles[angleData.key]) return null;
                            const dataKey =
                            displayMode === "transmission"
                              ? `stack_${currentStackId}_${angleData.key}_transmission`
                              : displayMode === "absorption"
                              ? `stack_${currentStackId}_${angleData.key}_absorption`
                              : `stack_${currentStackId}_${angleData.key}`;
                            const currentStack = layerStacks.find((s) => s.id === currentStackId);
                            return (
                              <Line key={angleData.key} yAxisId="left" type="monotone" dataKey={dataKey} stroke={currentStack?.color || "#4f46e5"} strokeWidth={1.5} strokeOpacity={angleData.opacity} strokeDasharray={angleData.dash} dot={false} name={`${currentStack?.name || "Current"} @ ${angleData.angle}°`} isAnimationActive={false} />
                            );
                          })}
                          {/* Phase Shift Overlay Lines */}
                          {showPhase && layerStacks.filter((s) => s.visible && s.layers.length > 0).map((stack) => (
                            <Line key={`phase-${stack.id}`} yAxisId="right" type="monotone" dataKey={`stack_${stack.id}_phase`} stroke={stack.color} strokeWidth={1.5} strokeDasharray="6 3" strokeOpacity={0.6} dot={false} name={`${getStackDisplayName(stack)} Phase`} isAnimationActive={false} />
                          ))}
                          {/* Zoom selection overlay */}
                          {zoomSelecting && zoomSelecting.endX != null && (
                            <ReferenceArea
                              yAxisId="left"
                              x1={zoomSelecting.startX}
                              x2={zoomSelecting.endX}
                              fill={darkMode ? 'rgba(99,102,241,0.2)' : 'rgba(79,70,229,0.15)'}
                              stroke={darkMode ? '#6366f1' : '#4f46e5'}
                              strokeWidth={1}
                              strokeDasharray="3 3"
                            />
                          )}
                        </LineChart>
                      </ResponsiveContainer>
                      )}
                    </div>

                    {/* Resizable Divider */}
                    <div className="flex items-center justify-center flex-shrink-0" style={{ height: isPhone ? '28px' : '11px', padding: isPhone ? '10px 0' : '4px 0', transition: 'background-color 0.15s', backgroundClip: 'content-box', backgroundColor: theme.borderStrong, cursor: 'row-resize', touchAction: 'none' }} onMouseDown={handleDividerMouseDown} onTouchStart={(e) => { e.preventDefault(); setIsDragging(true); }} title="Drag to resize" onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = theme.accentHover; }} onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = theme.borderStrong; }}>
                      {isPhone && <div style={{ width: 40, height: 4, borderRadius: 2, background: darkMode ? '#4a4c72' : '#9ca3af' }}></div>}
                    </div>

                    {/* Layers section */}
                    <div style={{ height: `${100 - (isPhone ? Math.min(chartHeight, 45) : (isTablet && screenHeight < 500) ? Math.min(chartHeight, 35) : chartHeight) - 1}%` }} className="flex flex-col overflow-hidden min-h-0 min-w-0">
                      <div className="flex justify-between items-center mb-1 flex-shrink-0">
                        <div className="flex items-center gap-2">
                          <h2 className="text-sm font-semibold text-gray-700">Layer Stacks</h2>
                          <button onClick={addLayerStack} className="px-2 py-0.5 bg-green-600 text-white rounded hover:bg-green-700 text-xs flex items-center gap-1"><Plus size={10} /> New Stack</button>
                          <button onClick={() => deleteLayerStack(currentStackId)} disabled={layerStacks.filter((s) => s.machineId === currentMachineId).length === 0} className="px-2 py-0.5 bg-red-500 text-white rounded hover:bg-red-600 text-xs disabled:bg-gray-300 disabled:cursor-not-allowed flex items-center gap-1"><Trash2 size={10} /> Delete Stack</button>
                          <button onClick={() => { if (!tierLimits.coatingTemplates) { setUpgradeFeature('Coating Templates'); setShowUpgradePrompt(true); return; } setShowTemplatePicker(true); }} style={{ background: theme.accent, color: '#fff', padding: '1px 8px', borderRadius: 4, fontSize: 11, display: 'flex', alignItems: 'center', gap: 4, border: 'none', cursor: 'pointer' }}><Zap size={10} /> Template</button>
                        </div>
                      </div>

                      <div className="flex gap-1 mb-1 overflow-x-auto pb-1 flex-shrink-0" style={{ maxHeight: "30px" }}>
                        {layerStacks.filter((s) => s.machineId === currentMachineId).map((stack) => (
                          <div key={stack.id} className="flex items-center gap-1 flex-shrink-0">
                            <button onClick={() => switchLayerStack(stack.id)} className={`px-2 py-0.5 rounded text-xs flex items-center gap-1 whitespace-nowrap ${currentStackId === stack.id ? "bg-indigo-600 text-white font-semibold" : "bg-gray-200 text-gray-700 hover:bg-gray-300"}`}>
                              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: stack.color }}></div>
                              {getStackDisplayName(stack)}
                            </button>
                            <button onClick={() => toggleStackVisibility(stack.id)} className={`p-0.5 rounded text-xs ${stack.visible ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-400"}`} title={stack.visible ? "Hide" : "Show"}>{stack.visible ? "👁" : "👁‍🗨"}</button>
                          </div>
                        ))}
                      </div>

                      <div className="mb-1 p-1 bg-gray-50 rounded border flex flex-col gap-1 flex-shrink-0">
                        <div className="flex gap-2 items-center">
                          <select value={currentMachineId} onChange={(e) => switchMachine(parseInt(e.target.value))} className="flex-1 px-2 py-0.5 border rounded text-xs">
                            {machines.map((machine) => (<option key={machine.id} value={machine.id}>{machine.name}</option>))}
                          </select>
                          <button onClick={addMachine} className="px-2 py-0.5 bg-green-600 text-white rounded hover:bg-green-700 text-xs flex items-center gap-1" title="Add new machine"><Plus size={10} /></button>
                          <button onClick={() => deleteMachine(currentMachineId)} disabled={machines.length === 1} className="px-2 py-0.5 bg-red-500 text-white rounded hover:bg-red-600 text-xs disabled:bg-gray-300 disabled:cursor-not-allowed" title="Delete machine"><Trash2 size={10} /></button>
                        </div>
                        <div className="flex gap-2 items-center">
                          <input type="text" value={machines.find((m) => m.id === currentMachineId)?.name || ""} onChange={(e) => renameMachine(currentMachineId, e.target.value)} className="flex-1 px-2 py-0.5 border rounded text-xs" placeholder="Machine name" />
                          <input type="text" value={layerStacks.find((s) => s.id === currentStackId)?.name || ""} onChange={(e) => renameLayerStack(currentStackId, e.target.value)} className="flex-1 px-2 py-0.5 border rounded text-xs" placeholder="Stack name" />
                          <button onClick={() => setShowToolingModal(true)} className="px-2 py-0.5 bg-blue-500 text-white rounded hover:bg-blue-600 text-xs flex items-center gap-1" title="Configure tooling factors"><Settings size={10} />Tooling</button>
                          <button onClick={() => { calculateCoatingStress(); setShowStressModal(true); }} disabled={layers.length === 0} className="px-2 py-0.5 bg-purple-600 text-white rounded hover:bg-purple-700 text-xs disabled:bg-gray-300 disabled:cursor-not-allowed flex items-center gap-1" title="Calculate coating stress"><Zap size={10} />Stress</button>
                        </div>
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: isPhone ? '2rem 1fr 7rem 2.5rem' : 'repeat(12, minmax(0, 1fr))', gap: isPhone ? '2px' : '4px', padding: '4px', borderRadius: 6, fontSize: isPhone ? 11 : 12, fontWeight: 600, background: darkMode ? '#1e1e2e' : '#f3f4f6', color: darkMode ? '#a0a0b8' : '#374151', borderBottom: `2px solid ${darkMode ? '#2a2c4a' : '#d1d5db'}`, flexShrink: 0, alignItems: 'center' }}>
                        <div style={{ textAlign: 'center' }}>#</div>
                        {!isPhone && <div style={{ textAlign: 'center' }}>Type</div>}
                        <div style={isPhone ? {} : { gridColumn: 'span 2' }}>Material</div>
                        <div style={isPhone ? {} : { gridColumn: 'span 2' }}>{isPhone ? 'nm' : 'Thickness (nm)'}</div>
                        {!isPhone && <div style={{ textAlign: 'center' }}>QWOT</div>}
                        {!isPhone && <div style={{ gridColumn: 'span 2' }}>Last (nm)</div>}
                        {!isPhone && <div style={{ gridColumn: 'span 2' }}>Original (nm)</div>}
                        {isPhone ? <div></div> : <div></div>}
                      </div>

                      <div className="flex-1 min-h-0" style={{ overflowY: 'auto', overflowX: 'hidden' }}>
                        {layerStacks.filter((s) => s.machineId === currentMachineId).length === 0 ? (
                          <div className="flex items-center justify-center h-full text-center p-4">
                            <div className="text-gray-500 text-xs">
                              <p className="font-semibold mb-2">No layer stacks</p>
                              <button
                                onClick={addLayerStack}
                                className="px-3 py-1 bg-green-600 text-white rounded hover:bg-green-700 text-xs"
                              >
                                <Plus size={12} /> Create Stack
                              </button>
                            </div>
                          </div>
                        ) : (
                        <>
                        <div style={{ display: 'grid', gridTemplateColumns: isPhone ? '2rem 1fr 7rem 2.5rem' : 'repeat(12, minmax(0, 1fr))', gap: isPhone ? '2px' : '4px', padding: '4px', background: darkMode ? '#2a2520' : '#fffbeb', borderBottom: `1px solid ${darkMode ? '#2a2c4a' : '#e5e7eb'}`, fontSize: isPhone ? 12 : 12, alignItems: 'center' }}>
                          <div style={{ textAlign: 'center', fontWeight: 500, fontSize: 10 }}>Sub</div>
                          {!isPhone && <div style={{ textAlign: 'center', color: '#6b7280' }}>Sub</div>}
                          <div><input type="text" value={substrate.material} onChange={(e) => setSubstrate({ ...substrate, material: e.target.value })} className="w-full min-w-0 px-1 py-0.5 border rounded" style={{ fontSize: isPhone ? 14 : undefined }} /></div>
                          <div><input type="number" value={substrate.n} onChange={(e) => setSubstrate({ ...substrate, n: safeParseFloat(e.target.value) || 1.52 })} className="w-full px-1 py-0.5 border rounded" step="0.01" title="Substrate refractive index" style={{ fontSize: isPhone ? 14 : undefined }} /></div>
                          {!isPhone && <div style={{ textAlign: 'center' }}>-</div>}
                          {!isPhone && <div style={{ gridColumn: 'span 2', textAlign: 'left' }}>-</div>}
                          {!isPhone && <div style={{ gridColumn: 'span 2', textAlign: 'left' }}>-</div>}
                          {isPhone ? <div></div> : <div></div>}
                        </div>

                        <div className="relative border-b border-gray-300" style={{ height: "1px", zIndex: 3 }}>
                          <button onClick={() => insertLayerAfter(-1)} className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 bg-white hover:bg-green-100 rounded-full text-green-600 border border-gray-300 hover:border-green-500 transition-colors shadow-sm" title="Insert layer after substrate"><Plus size={10} /></button>
                        </div>

                        <div
                          data-drag-container
                          style={{ overflow: 'visible' }}
                          onDragOver={(e) => handleContainerDragOver(e)}
                          onDrop={(e) => { e.preventDefault(); moveLayer(dragIndex, dragOverIndex); setDragIndex(null); setDragOverIndex(null); }}
                        >
                        {layers.map((layer, idx) => (
                          <React.Fragment key={layer.id}>
                          <div
                            data-layer-row
                            style={{
                              display: 'grid',
                              gridTemplateColumns: isPhone ? '2rem 1fr 7rem 2.5rem' : 'repeat(12, minmax(0, 1fr))',
                              gap: isPhone ? '2px' : '4px',
                              padding: isPhone ? '4px 2px' : '4px',
                              borderBottom: `1px solid ${darkMode ? '#2a2c4a' : '#e5e7eb'}`,
                              fontSize: isPhone ? 12 : 12,
                              alignItems: 'center',
                              backgroundColor: getMaterialBg(allMaterials[layer.material]?.color || '#e5e7eb'),
                              borderLeft: layer.locked
                                ? '3px solid #f87171'
                                : `3px solid ${allMaterials[layer.material]?.color || '#9ca3af'}`,
                              transform: touchDragState?.isDragging && touchDragState.layerIdx === idx
                                ? `translateY(${touchDragState.currentY - touchDragState.startY}px) scale(1.02)`
                                : getDragTransform(idx, dragIndex, dragOverIndex),
                              transition: touchDragState?.isDragging && touchDragState.layerIdx === idx ? 'none' : 'transform 0.2s ease, background-color 0.15s',
                              position: 'relative',
                              zIndex: (dragIndex === idx || (touchDragState?.isDragging && touchDragState.layerIdx === idx)) ? 100 : 0,
                              boxShadow: (dragIndex === idx || (touchDragState?.isDragging && touchDragState.layerIdx === idx))
                                ? '0 4px 20px rgba(0,0,0,0.25)' : 'none',
                            }}
                            onMouseEnter={(e) => { if (!isPhone) e.currentTarget.style.filter = 'brightness(0.93)'; }}
                            onMouseLeave={(e) => { if (!isPhone) e.currentTarget.style.filter = ''; }}
                            onDragEnd={() => { setDragIndex(null); setDragOverIndex(null); }}
                          >
                            <div style={{ textAlign: 'center', fontWeight: 500, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '2px', fontSize: isPhone ? 11 : undefined }}>
                              {!isPhone && <span
                                draggable
                                onDragStart={(e) => { setDragIndex(idx); e.dataTransfer.effectAllowed = "move"; const img = new Image(); img.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'; e.dataTransfer.setDragImage(img, 0, 0); handleDragStartCapture(e.currentTarget.closest('[data-drag-container]')); }}
                                className="text-gray-400 inline-flex"
                                style={{ cursor: 'grab', transition: 'color 0.15s, transform 0.15s' }}
                                title="Drag to reorder"
                                onMouseEnter={(e) => { e.currentTarget.style.color = '#6366f1'; e.currentTarget.style.transform = 'scale(1.25)'; }}
                                onMouseLeave={(e) => { e.currentTarget.style.color = ''; e.currentTarget.style.transform = ''; }}
                              ><GripVertical size={10} /></span>}{idx + 1}
                            </div>
                            {!isPhone && <div style={{ textAlign: 'center', color: '#6b7280' }}>L</div>}
                            <div style={isPhone ? {} : { gridColumn: 'span 2' }}>
                              <div className="flex items-center gap-1">
                                <select value={layer.material} onChange={(e) => { if (e.target.value === "__manage__") { setShowMaterialLibrary(true); e.target.value = layer.material; return; } updateLayer(layer.id, "material", e.target.value); }} className="flex-1 px-1 py-0.5 border rounded bg-white" style={{ fontSize: isPhone ? 14 : undefined, minHeight: isPhone ? 30 : undefined }}>
                                  {Object.keys(allMaterials).map((mat) => (<option key={mat} value={mat}>{mat}</option>))}
                                  <option disabled>──────────</option>
                                  <option value="__manage__">Manage Materials...</option>
                                </select>
                                {!isPhone && <div
                                  className="cursor-help text-gray-400 hover:text-blue-600"
                                  title={(() => {
                                    const mat = allMaterials[layer.material];
                                    if (!mat) return layer.material;
                                    const n = getRefractiveIndex(layer.material, 550, layer.iad, layer.packingDensity || 1.0);
                                    const k400 = getExtinctionCoefficient(layer.material, 400);
                                    const k550 = getExtinctionCoefficient(layer.material, 550);
                                    let kInfo = "";
                                    if (mat.type === "tabular") {
                                      const pts = mat.data ? mat.data.length : 0;
                                      const range = mat.data && mat.data.length > 0 ? `${mat.data[0][0].toFixed(0)}-${mat.data[mat.data.length-1][0].toFixed(0)}nm` : "";
                                      kInfo = `Tabular n,k data (${pts} points, ${range})\nk@400nm: ${k400.toExponential(2)}\nk@550nm: ${k550.toExponential(2)}`;
                                    } else if (mat.type === "tauc-lorentz") {
                                      kInfo = `Tauc-Lorentz (A=${mat.A}, E₀=${mat.E0}, C=${mat.C}, Eg=${mat.Eg}, ε∞=${mat.epsInf})\nk@400nm: ${k400.toExponential(2)}\nk@550nm: ${k550.toExponential(2)}`;
                                    } else if (mat.type === "cody-lorentz") {
                                      kInfo = `Cody-Lorentz (A=${mat.A}, E₀=${mat.E0}, C=${mat.C}, Eg=${mat.Eg}, ε∞=${mat.epsInf}, Eu=${mat.Eu})\nk@400nm: ${k400.toExponential(2)}\nk@550nm: ${k550.toExponential(2)}`;
                                    } else if (mat.type === "lorentz") {
                                      const nosc = (mat.oscillators || []).length;
                                      const hasDrude = (mat.oscillators || []).some(o => o.E0 === 0);
                                      kInfo = `${hasDrude ? 'Drude-Lorentz' : 'Lorentz'} (ε∞=${mat.epsInf}, ${nosc} oscillator${nosc !== 1 ? 's' : ''})\nk@400nm: ${k400.toExponential(2)}\nk@550nm: ${k550.toExponential(2)}`;
                                    } else if (mat.type === "brendel-bormann") {
                                      const nosc = (mat.oscillators || []).length;
                                      kInfo = `Brendel-Bormann (ε∞=${mat.epsInf}, ${nosc} oscillator${nosc !== 1 ? 's' : ''}, Gaussian-broadened)\nk@400nm: ${k400.toExponential(2)}\nk@550nm: ${k550.toExponential(2)}`;
                                    } else if (mat.kType === "none") {
                                      kInfo = "No absorption (transparent)";
                                    } else if (mat.kType === "constant") {
                                      kInfo = `k = ${mat.kValue || 0} (constant)`;
                                    } else if (mat.kType === "urbach") {
                                      kInfo = `Absorption edge: ${mat.kEdge}nm\nk@400nm: ${k400.toFixed(4)}\nk@550nm: ${k550.toFixed(4)}`;
                                    }
                                    return `${layer.material}\nn@550nm: ${n.toFixed(3)}\n${kInfo}`;
                                  })()}
                                >
                                  <Info size={12} />
                                </div>}
                              </div>
                            </div>
                            <div style={isPhone ? { display: 'flex', alignItems: 'center', gap: 1 } : { gridColumn: 'span 2' }}>
                              {isPhone && <button onTouchStart={(e) => { e.preventDefault(); startHoldRepeat(layer.id, -1); }} onTouchEnd={stopHoldRepeat} onTouchCancel={stopHoldRepeat} onMouseDown={() => startHoldRepeat(layer.id, -1)} onMouseUp={stopHoldRepeat} onMouseLeave={stopHoldRepeat} style={{ width: 26, height: 28, border: `1px solid ${darkMode ? '#363860' : '#d1d5db'}`, borderRadius: '4px 0 0 4px', background: darkMode ? '#1e1f3a' : '#f3f4f6', color: darkMode ? '#a0a0b8' : '#374151', cursor: 'pointer', fontSize: 16, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, padding: 0, touchAction: 'none', userSelect: 'none', WebkitUserSelect: 'none' }}>−</button>}
                              <input type="number" value={layer.thickness === 0 ? "" : layer.thickness} onChange={(e) => updateLayer(layer.id, "thickness", e.target.value === "" ? 0 : e.target.value)} className={isPhone ? "px-1 py-0.5 border-t border-b rounded-none" : "w-full px-1 py-0.5 border rounded"} step="1" style={{ fontSize: isPhone ? 13 : undefined, minHeight: isPhone ? 26 : undefined, width: isPhone ? '100%' : undefined, minWidth: 0, textAlign: isPhone ? 'center' : undefined, borderColor: darkMode ? '#363860' : '#d1d5db' }} inputMode={isPhone ? "decimal" : undefined} />
                              {isPhone && <button onTouchStart={(e) => { e.preventDefault(); startHoldRepeat(layer.id, 1); }} onTouchEnd={stopHoldRepeat} onTouchCancel={stopHoldRepeat} onMouseDown={() => startHoldRepeat(layer.id, 1)} onMouseUp={stopHoldRepeat} onMouseLeave={stopHoldRepeat} style={{ width: 26, height: 28, border: `1px solid ${darkMode ? '#363860' : '#d1d5db'}`, borderRadius: '0 4px 4px 0', background: darkMode ? '#1e1f3a' : '#f3f4f6', color: darkMode ? '#a0a0b8' : '#374151', cursor: 'pointer', fontSize: 16, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, padding: 0, touchAction: 'none', userSelect: 'none', WebkitUserSelect: 'none' }}>+</button>}
                            </div>
                            {!isPhone && <div style={{ textAlign: 'center', color: '#6b7280', fontSize: 10 }}>{qwotReference > 0 ? ((getRefractiveIndex(layer.material, qwotReference, layer.iad) * (parseFloat(layer.thickness) || 0)) / (qwotReference / 4)).toFixed(2) : "-"}</div>}
                            {!isPhone && <div style={{ gridColumn: 'span 2', textAlign: 'left', color: '#6b7280', fontSize: 10 }}>{layer.lastThickness ? layer.lastThickness.toFixed(2) : "-"}</div>}
                            {!isPhone && <div style={{ gridColumn: 'span 2', textAlign: 'left', color: '#6b7280', fontSize: 10 }}>{layer.originalThickness ? layer.originalThickness.toFixed(2) : "-"}</div>}
                            {/* Action buttons — Lock/Pin/IAD on desktop, delete only on mobile */}
                            {isPhone || isTablet ? (
                              <div style={{ display: 'flex', justifyContent: 'center' }}>
                                <button onClick={() => removeLayer(layer.id)} style={{ padding: 2, borderRadius: 4, border: 'none', cursor: 'pointer', background: 'transparent', color: '#dc2626' }} disabled={layers.length === 1}><Trash2 size={isPhone ? 13 : 12} /></button>
                              </div>
                            ) : (
                              <div style={{ textAlign: 'center', display: 'flex', justifyContent: 'center', gap: '2px' }}>
                                <button onClick={() => setLayers(layers.map(l => l.id === layer.id ? { ...l, locked: !l.locked } : l))} className={`p-0.5 rounded transition-colors ${layer.locked ? "bg-red-100 text-red-600" : "text-gray-300 hover:text-gray-500"}`} title={layer.locked ? "Unlock layer (allow shift/factor)" : "Lock layer (exclude from shift/factor)"}><Lock size={12} /></button>
                                <button onClick={() => { setLayers(layers.map(l => l.id === layer.id ? { ...l, originalThickness: l.originalThickness ? undefined : l.thickness } : l)); }} className={`p-0.5 rounded ${layer.originalThickness ? "bg-green-100 text-green-600 hover:bg-red-100 hover:text-red-600" : "hover:bg-green-100 text-gray-400"}`} title={layer.originalThickness ? "Click to clear original" : "Save as original thickness"}>{"\uD83D\uDCCC"}</button>
                                <button onClick={() => openIADModal(layer.id)} className={`p-0.5 rounded transition-colors ${layer.iad && layer.iad.enabled ? "bg-yellow-100 text-yellow-600 hover:bg-yellow-200" : "hover:bg-gray-100 text-gray-400"}`} title="IAD Settings"><Zap size={12} /></button>
                                <button onClick={() => removeLayer(layer.id)} className="p-0.5 hover:bg-red-100 rounded text-red-600" disabled={layers.length === 1}><Trash2 size={12} /></button>
                              </div>
                            )}
                          </div>
                          <div className="relative border-b border-gray-300" style={{ height: "1px", zIndex: 3 }}>
                            <button onClick={() => insertLayerAfter(idx)} className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 bg-white hover:bg-green-100 rounded-full text-green-600 border border-gray-300 hover:border-green-500 transition-colors shadow-sm" title={`Insert layer after layer ${idx + 1}`}><Plus size={10} /></button>
                          </div>
                          </React.Fragment>
                        ))}
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: isPhone ? '2rem 1fr 7rem 2.5rem' : 'repeat(12, minmax(0, 1fr))', gap: isPhone ? '2px' : '4px', padding: '4px', background: darkMode ? '#1e2a30' : '#f0f9ff', borderBottom: `1px solid ${darkMode ? '#2a2c4a' : '#e5e7eb'}`, fontSize: isPhone ? 12 : 12, alignItems: 'center' }}>
                          <div style={{ textAlign: 'center', fontWeight: 500, fontSize: 10 }}>Inc</div>
                          {!isPhone && <div style={{ textAlign: 'center', color: '#6b7280' }}>Inc</div>}
                          <div style={isPhone ? {} : { gridColumn: 'span 2' }}><input type="text" value={incident.material} onChange={(e) => setIncident({ ...incident, material: e.target.value })} className="w-full px-1 py-0.5 border rounded" style={{ fontSize: isPhone ? 14 : undefined }} /></div>
                          <div style={isPhone ? {} : { gridColumn: 'span 2', textAlign: 'center' }}>-</div>
                          {!isPhone && <div style={{ textAlign: 'center' }}>-</div>}
                          {!isPhone && <div style={{ gridColumn: 'span 2', textAlign: 'left' }}>-</div>}
                          {!isPhone && <div style={{ gridColumn: 'span 2', textAlign: 'left' }}>-</div>}
                          {isPhone ? <div></div> : <div></div>}
                        </div>
                        </>
                        )}
                      </div>

                      <div className="bg-gray-50 rounded p-1.5 border mt-1 flex-shrink-0">
                        {(isPhone || isTablet) ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10 }}>
                            <span style={{ color: darkMode ? '#a0a0b8' : '#6b7280' }}>{layers.length}L / {layers.reduce((sum, l) => sum + (parseFloat(l.thickness) || 0), 0).toFixed(0)}nm</span>
                            <span style={{ color: darkMode ? '#a0a0b8' : '#6b7280' }}>Factor:</span>
                            <input type="number" value={layerFactor} onChange={(e) => setLayerFactor(e.target.value)} style={{ width: 40, padding: '2px 4px', border: `1px solid ${darkMode ? '#363860' : '#d1d5db'}`, borderRadius: 4, fontSize: 10, background: darkMode ? '#1e1f3a' : '#fff', color: darkMode ? '#e2e4e9' : '#1f2937' }} step="0.01" min="0" />
                            <button onClick={applyFactorToLayers} style={{ padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 600, background: '#4f46e5', color: '#fff', border: 'none', cursor: 'pointer' }}>Apply</button>
                            <div style={{ marginLeft: 'auto' }}>
                              <button onClick={resetToOriginal} style={{ padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 600, background: '#dc2626', color: '#fff', border: 'none', cursor: 'pointer', opacity: !layers.some((l) => l.originalThickness !== undefined) ? 0.4 : 1 }} disabled={!layers.some((l) => l.originalThickness !== undefined)}>Reset</button>
                            </div>
                          </div>
                        ) : (
                          <div className="text-xs text-gray-600 flex justify-between items-center gap-4">
                            <div className="flex gap-4">
                              <span>Layers: {layers.length}</span>
                              <span>Total: {layers.reduce((sum, l) => sum + (parseFloat(l.thickness) || 0), 0).toFixed(1)} nm</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <label className="font-semibold text-gray-700">Factor:</label>
                              <input type="number" value={layerFactor} onChange={(e) => setLayerFactor(e.target.value)} className="w-14 px-1 py-0.5 border rounded" step="0.01" min="0" />
                              <select value={layerFactorMode} onChange={(e) => setLayerFactorMode(e.target.value)} className="px-1 py-0.5 border rounded bg-white">
                                <option value="all">All</option>
                                <option value="odd">Odd</option>
                                <option value="even">Even</option>
                              </select>
                              <button onClick={applyFactorToLayers} className="px-2 py-0.5 bg-indigo-600 text-white rounded hover:bg-indigo-700 font-medium">Apply</button>
                              <div className="border-l pl-2 ml-2 flex items-center gap-1">
                                <label className="font-semibold text-gray-700">Shift:</label>
                                <input type="number" value={shiftValue} onChange={(e) => setShiftValue(e.target.value)} className="w-14 px-1 py-0.5 border rounded" step="1" />
                                <select value={shiftMode} onChange={(e) => setShiftMode(e.target.value)} className="px-1 py-0.5 border rounded bg-white">
                                  <option value="left-right">Left/Right</option>
                                  <option value="up-down">Up/Down</option>
                                </select>
                                <button onClick={applyShift} className="px-2 py-0.5 bg-green-600 text-white rounded hover:bg-green-700 font-medium" disabled={shiftMode === "up-down" || parseFloat(shiftValue) === 0}>Apply</button>
                              </div>
                              <button onClick={undoLastChange} className="px-2 py-0.5 bg-orange-600 text-white rounded hover:bg-orange-700 font-medium" disabled={!layers.some((l) => l.lastThickness !== undefined)}>Undo</button>
                              <button onClick={resetToOriginal} className="px-2 py-0.5 bg-red-600 text-white rounded hover:bg-red-700 font-medium" disabled={!layers.some((l) => l.originalThickness !== undefined)}>Reset</button>
                              <div className="border-l pl-2 ml-2 flex items-center gap-1">
                                <label className="font-semibold text-gray-700">QWOT λ:</label>
                                <input type="number" value={qwotReference} onChange={(e) => setQwotReference(safeParseFloat(e.target.value))} className="w-14 px-1 py-0.5 border rounded" step="1" min="0" placeholder="nm" />
                              </div>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Mobile: Color Analysis as collapsible section at bottom of layers */}
                      {isPhone && colorData && (
                        <details style={{ padding: '6px 8px', borderTop: `1px solid ${darkMode ? '#2a2c4a' : '#e5e7eb'}`, background: darkMode ? '#1a1c38' : '#f9fafb', borderRadius: '0 0 6px 6px', marginTop: 4, flexShrink: 0 }}>
                          <summary style={{ fontSize: 11, fontWeight: 600, cursor: 'pointer', padding: '4px 0', color: darkMode ? '#a0a0b8' : '#374151' }}>
                            Color Analysis — {colorData.colorName}
                            <span style={{ display: 'inline-block', width: 14, height: 14, borderRadius: 3, backgroundColor: colorData.rgb, border: '1px solid #999', marginLeft: 8, verticalAlign: 'middle' }}></span>
                          </summary>
                          <div style={{ marginTop: 6, fontSize: 11 }}>
                            <div style={{ width: '100%', height: 40, borderRadius: 6, border: '2px solid #999', marginBottom: 6, backgroundColor: colorData.rgb }}></div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px 12px', fontSize: 10, color: darkMode ? '#a0a0b8' : '#4b5563' }}>
                              <div>L*: <strong>{colorData.L}</strong></div>
                              <div>Hex: <strong>{colorData.hex}</strong></div>
                              <div>a*: <strong>{colorData.a_star}</strong></div>
                              <div>b*: <strong>{colorData.b_star}</strong></div>
                            </div>
                          </div>
                        </details>
                      )}
                    </div>
                  </div>

                  {/* Right column: Color Analysis Sidebar (hidden on phone — shown as collapsible in layers section) */}
                  <div className="w-48 flex-shrink-0 bg-gray-50 rounded p-2 border flex flex-col overflow-y-auto" style={isPhone ? { display: 'none' } : undefined}>
                    <div className="text-xs font-bold text-gray-800 mb-2">Color Analysis</div>

                    {/* Current Stack Color */}
                    {colorData && (
                      <div className="mb-3 pb-3 border-b border-gray-300">
                        <div className="text-[10px] text-gray-600 font-semibold mb-1.5">Current Stack</div>
                        <div className="w-full h-16 rounded border-2 border-gray-400 shadow-md mb-2" style={{ backgroundColor: colorData.rgb }} title={colorData.hex}></div>
                        <div className="text-sm font-bold text-gray-900 mb-2">{colorData.colorName}</div>
                        <div className="bg-blue-50 rounded p-1.5 mb-2">
                          <div className="text-[9px] font-semibold text-blue-800 mb-1">CIE Lab</div>
                          <div className="text-[10px] text-gray-700 space-y-0.5">
                            <div className="flex justify-between"><span>L* (Lightness):</span><span className="font-semibold">{colorData.L}</span></div>
                            <div className="flex justify-between"><span>a* (±Red/Green):</span><span className="font-semibold">{colorData.a_star}</span></div>
                            <div className="flex justify-between"><span>b* (±Yellow/Blue):</span><span className="font-semibold">{colorData.b_star}</span></div>
                          </div>
                        </div>
                        <div className="bg-purple-50 rounded p-1.5 mb-2">
                          <div className="text-[9px] font-semibold text-purple-800 mb-1">LCh (Cylindrical)</div>
                          <div className="text-[10px] text-gray-700 space-y-0.5">
                            <div className="flex justify-between"><span>L (Lightness):</span><span className="font-semibold">{colorData.L_lch}</span></div>
                            <div className="flex justify-between"><span>C (Chroma):</span><span className="font-semibold">{colorData.C}</span></div>
                            <div className="flex justify-between"><span>h (Hue°):</span><span className="font-semibold">{colorData.h}°</span></div>
                          </div>
                        </div>
                        <div className="text-[10px] text-gray-700 space-y-0.5">
                          <div className="flex justify-between"><span>Dominant λ:</span><span className="font-semibold">{colorData.dominantWavelength}nm</span></div>
                          <div className="flex justify-between"><span>Avg R:</span><span className="font-semibold">{colorData.avgReflectivity}%</span></div>
                          <div className="flex justify-between"><span>Hex:</span><span className="font-mono text-[9px]">{colorData.hex}</span></div>
                        </div>
                      </div>
                    )}

                    {/* Illuminant Selector */}
                    <div className="mb-3 pb-3 border-b border-gray-300">
                      <div className="text-[10px] font-semibold text-gray-700 mb-1">Illuminant</div>
                      <select value={selectedIlluminant} onChange={(e) => {
                        if (tierLimits.allowedIlluminants.includes(e.target.value)) {
                          setSelectedIlluminant(e.target.value);
                        } else {
                          setUpgradeFeature('additional illuminants');
                          setShowUpgradePrompt(true);
                        }
                      }} className="w-full px-1.5 py-1 border rounded text-[10px] bg-white cursor-pointer">
                        <option value="D65">D65 - Daylight 6500K</option>
                        <option value="D50" disabled={!tierLimits.allowedIlluminants.includes('D50')}>D50 - Daylight 5000K{!tierLimits.allowedIlluminants.includes('D50') ? ' 🔒' : ''}</option>
                        <option value="A" disabled={!tierLimits.allowedIlluminants.includes('A')}>A - Incandescent 2856K{!tierLimits.allowedIlluminants.includes('A') ? ' 🔒' : ''}</option>
                        <option value="F2" disabled={!tierLimits.allowedIlluminants.includes('F2')}>F2 - Cool White Fluorescent{!tierLimits.allowedIlluminants.includes('F2') ? ' 🔒' : ''}</option>
                        <option value="F11" disabled={!tierLimits.allowedIlluminants.includes('F11')}>F11 - Tri-phosphor Fluorescent{!tierLimits.allowedIlluminants.includes('F11') ? ' 🔒' : ''}</option>
                      </select>
                    </div>

                    {/* All Visible Stacks Colors */}
                    {Object.keys(stackColorData).length > 0 && (
                      <details className="mb-3 pb-3 border-b border-gray-300">
                        <summary className="text-[10px] text-gray-600 font-semibold mb-1.5 cursor-pointer select-none hover:text-gray-800">
                          All Visible Stacks ({Object.keys(stackColorData).length})
                        </summary>
                        <div className="space-y-2 mt-1.5">
                          {Object.entries(stackColorData).map(([stackId, color]) => (
                            <div key={stackId} className="text-[9px]">
                              <div className="flex items-center gap-1 mb-0.5">
                                <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: color.stackColor }}></div>
                                <div className="font-semibold text-gray-700 truncate text-[10px]">{color.stackName}</div>
                              </div>
                              <div className="w-full h-8 rounded border border-gray-300 shadow-sm mb-1" style={{ backgroundColor: color.rgb }} title={`${color.colorName} - ${color.hex}`}></div>
                              <div className="text-gray-600 space-y-0.5 text-[9px]">
                                <div className="font-semibold">{color.colorName}</div>
                                <div className="flex justify-between"><span>L*:</span><span>{color.L}</span></div>
                                <div className="flex justify-between"><span>C:</span><span>{color.C}</span></div>
                                <div className="flex justify-between"><span>h:</span><span>{color.h}°</span></div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </details>
                    )}

                    {/* Experimental Data Color */}
                    {experimentalColorData && (
                      <div className="mb-3 pb-3 border-b border-gray-300">
                        <div className="text-[10px] text-gray-600 font-semibold mb-1.5">Experimental</div>
                        <div className="w-full h-10 rounded border-2 border-red-400 shadow-sm mb-1" style={{ backgroundColor: experimentalColorData.rgb }} title={experimentalColorData.hex}></div>
                        <div className="text-[10px] space-y-0.5">
                          <div className="font-semibold text-gray-900">{experimentalColorData.colorName}</div>
                          <div className="text-gray-700 space-y-0.5 text-[9px]">
                            <div className="flex justify-between"><span>L*:</span><span>{experimentalColorData.L}</span></div>
                            <div className="flex justify-between"><span>C:</span><span>{experimentalColorData.C}</span></div>
                            <div className="flex justify-between"><span>h:</span><span>{experimentalColorData.h}°</span></div>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* ΔE* vs Experimental — Current Stack */}
                    {colorData && experimentalColorData && (
                      <div className="mb-3 pb-3 border-b border-gray-300">
                        <div className="text-[10px] text-gray-600 font-semibold mb-1.5">ΔE* vs Experimental</div>
                        <div className="p-1.5 bg-red-50 rounded border border-red-200">
                          {(() => {
                            const dL = parseFloat(colorData.L) - parseFloat(experimentalColorData.L);
                            const da = parseFloat(colorData.a_star) - parseFloat(experimentalColorData.a_star);
                            const db = parseFloat(colorData.b_star) - parseFloat(experimentalColorData.b_star);
                            const deltaE = Math.sqrt(dL * dL + da * da + db * db);
                            return (
                              <div className={`text-sm font-bold ${deltaE < 1 ? "text-green-600" : deltaE < 2 ? "text-yellow-600" : deltaE < 3 ? "text-orange-600" : "text-red-600"}`}>
                                ΔE* = {deltaE.toFixed(2)}
                                <span className="text-[8px] font-normal text-gray-500 ml-1">
                                  {deltaE < 0.5 ? "(Imperceptible)" : deltaE < 1 ? "(Slight)" : deltaE < 2 ? "(Noticeable)" : deltaE < 3 ? "(Visible)" : deltaE < 5 ? "(Significant)" : "(Large)"}
                                </span>
                              </div>
                            );
                          })()}
                        </div>
                      </div>
                    )}

                    {/* Compare Colors Button */}
                    {Object.keys(stackColorData).length > 1 && (
                      <div className="mb-3 pb-3 border-b border-gray-300">
                        <button
                          onClick={() => { setColorCompareSelected(Object.keys(stackColorData)); setShowColorCompareModal(true); }}
                          className="w-full px-2 py-1.5 bg-indigo-600 text-white rounded hover:bg-indigo-700 text-[10px] font-semibold flex items-center justify-center gap-1"
                        >
                          Compare Stack Colors
                        </button>
                        <div className="text-[8px] text-gray-500 mt-1 text-center">
                          ΔE* comparison across all visible stacks
                        </div>
                      </div>
                    )}

                    {/* Angle-Dependent Color Analysis */}
                    {angleColorData && angleColorData.length > 0 && (
                      <details className="mb-3 pb-3 border-b border-gray-300">
                        <summary className="text-[10px] text-gray-600 font-semibold mb-1.5 cursor-pointer select-none hover:text-gray-800">Color vs Viewing Angle</summary>
                        <div className="flex gap-0.5 mb-2 mt-1.5">
                          {angleColorData.map((data) => (
                            <div key={data.angle} className="flex-1 text-center">
                              <div className="w-full h-6 rounded border border-gray-300" style={{ backgroundColor: data.rgb }} title={`${data.angle}°: L*=${data.L.toFixed(1)}, a*=${data.a.toFixed(1)}, b*=${data.b.toFixed(1)}`}></div>
                              <div className="text-[8px] text-gray-600 mt-0.5">{data.angle}°</div>
                            </div>
                          ))}
                        </div>
                        <div className="text-[9px] text-gray-700 mb-1 font-semibold">ΔE* from 0° (normal):</div>
                        <div className="space-y-0.5">
                          {angleColorData.filter((d) => d.angle > 0).map((data) => (
                            <div key={data.angle} className="flex justify-between text-[9px]">
                              <span>{data.angle}°:</span>
                              <span className={`font-semibold ${data.deltaE < 1 ? "text-green-600" : data.deltaE < 2 ? "text-yellow-600" : data.deltaE < 3 ? "text-orange-500" : "text-red-600"}`}>
                                {data.deltaE.toFixed(2)}{data.deltaE < 1 ? " ✓" : data.deltaE >= 3 ? " ⚠" : ""}
                              </span>
                            </div>
                          ))}
                        </div>
                        <details className="mt-2">
                          <summary className="text-[9px] text-gray-500 cursor-pointer hover:text-gray-700">Show L*a*b* values...</summary>
                          <div className="mt-1 space-y-1">
                            {angleColorData.map((data) => (
                              <div key={data.angle} className="text-[8px] text-gray-600 bg-gray-50 rounded p-1">
                                <span className="font-semibold">{data.angle}°:</span> L*={data.L.toFixed(1)}, a*={data.a.toFixed(1)}, b*={data.b.toFixed(1)}
                              </div>
                            ))}
                          </div>
                        </details>
                        <div className="mt-2 text-[8px] text-gray-500 bg-blue-50 rounded p-1">
                          <div className="font-semibold text-blue-700 mb-0.5">Color Shift Guide:</div>
                          <div>ΔE* &lt; 1: Imperceptible</div>
                          <div>ΔE* 1-2: Slight (acceptable)</div>
                          <div>ΔE* 2-3: Noticeable</div>
                          <div>ΔE* &gt; 3: Obvious shift ⚠</div>
                        </div>
                      </details>
                    )}

                    {/* Multi-Angle Selector */}
                    <details className="mb-3 pb-3 border-t border-gray-300 pt-2">
                      <summary className="text-[10px] font-semibold text-gray-700 mb-1.5 cursor-pointer select-none hover:text-gray-800">Multi-Angle Display</summary>
                      <div className="space-y-1 mt-1.5">
                        {[
                          { key: "angle_0", label: "0° (Normal)", angle: 0 },
                          { key: "angle_15", label: "15°", angle: 15 },
                          { key: "angle_30", label: "30°", angle: 30 },
                          { key: "angle_45", label: "45°", angle: 45 },
                          { key: "angle_60", label: "60°", angle: 60 },
                        ].map((angleOpt) => (
                          <label key={angleOpt.key} className="flex items-center gap-1 text-[10px] cursor-pointer hover:bg-gray-100 p-1 rounded">
                            <input type="checkbox" checked={showAngles[angleOpt.key]} onChange={(e) => setShowAngles({ ...showAngles, [angleOpt.key]: e.target.checked })} className="cursor-pointer" />
                            <span>{angleOpt.label}</span>
                          </label>
                        ))}
                      </div>
                      <div className="mt-2 text-[9px] text-gray-500">Toggle to show/hide angle curves on chart</div>
                    </details>

                    {/* Mode-specific options */}
                    <div className="mt-auto pt-2 border-t border-gray-300">
                      {(displayMode === "reflectivity" || displayMode === "transmission" || displayMode === "absorption") && (
                        <label className="flex items-center gap-1 text-[10px] cursor-pointer">
                          <input type="checkbox" checked={showPhase} onChange={(e) => setShowPhase(e.target.checked)} className="cursor-pointer" />
                          <span>Phase shift overlay ({"\u00B0"})</span>
                        </label>
                      )}
                      {displayMode === "admittance" && (
                        <div>
                          <div className="text-[10px] font-semibold text-gray-700 mb-1">Wavelengths (nm)</div>
                          <div className="space-y-1">
                            {admittanceWavelengths.map((wl, idx) => (
                              <div key={idx} className="flex items-center gap-1">
                                <input type="number" value={wl} onChange={(e) => { const nw = [...admittanceWavelengths]; nw[idx] = parseFloat(e.target.value) || 0; setAdmittanceWavelengths(nw); }} className="w-14 px-1 py-0.5 border rounded text-[10px]" step="10" min={wavelengthRange.min} max={wavelengthRange.max} />
                                <div className="w-3 h-3 rounded-full border flex-shrink-0" style={{ backgroundColor: admittanceColors[idx % admittanceColors.length] }} />
                                {admittanceWavelengths.length > 1 && (
                                  <button onClick={() => setAdmittanceWavelengths(admittanceWavelengths.filter((_, i) => i !== idx))} className="text-red-500 text-[10px] hover:text-red-700">x</button>
                                )}
                              </div>
                            ))}
                          </div>
                          {admittanceWavelengths.length < 10 && (
                            <button onClick={() => setAdmittanceWavelengths([...admittanceWavelengths, 500])} className="mt-1 text-[10px] text-indigo-600 hover:text-indigo-800">+ Add wavelength</button>
                          )}
                          <div className="text-[9px] text-gray-500 mt-1">Each wavelength traces a separate locus</div>
                        </div>
                      )}
                      {displayMode === "efield" && (
                        <div>
                          <div className="text-[10px] font-semibold text-gray-700 mb-1">Wavelengths (nm)</div>
                          <div className="space-y-1">
                            {efieldWavelengths.map((wl, idx) => (
                              <div key={idx} className="flex items-center gap-1">
                                <input type="number" value={wl} onChange={(e) => { const nw = [...efieldWavelengths]; nw[idx] = parseFloat(e.target.value) || 0; setEfieldWavelengths(nw); }} className="w-14 px-1 py-0.5 border rounded text-[10px]" step="10" min={wavelengthRange.min} max={wavelengthRange.max} />
                                <div className="w-3 h-3 rounded-full border flex-shrink-0" style={{ backgroundColor: admittanceColors[idx % admittanceColors.length] }} />
                                {efieldWavelengths.length > 1 && (
                                  <button onClick={() => setEfieldWavelengths(efieldWavelengths.filter((_, i) => i !== idx))} className="text-red-500 text-[10px] hover:text-red-700">x</button>
                                )}
                              </div>
                            ))}
                          </div>
                          {efieldWavelengths.length < 10 && (
                            <button onClick={() => setEfieldWavelengths([...efieldWavelengths, 500])} className="mt-1 text-[10px] text-indigo-600 hover:text-indigo-800">+ Add wavelength</button>
                          )}
                          <div className="text-[9px] text-gray-500 mt-1">Each wavelength shows a separate E-field curve</div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

            </div>
          </>
        )}

        {/* Coating Template Picker Modal */}
        {showTemplatePicker && (
          <div style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', background: theme.overlay }} onClick={() => { setShowTemplatePicker(false); setSelectedTemplateType(null); setSelectedSubtype(null); setTemplateParams({}); setTemplateInsertConfirm(null); }}>
            <div style={{ background: theme.surface, borderRadius: 12, padding: 20, width: 520, maxHeight: '80vh', overflowY: 'auto', boxShadow: theme.shadowLg, border: `1px solid ${theme.border}` }} onClick={e => e.stopPropagation()}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <h3 style={{ fontSize: 16, fontWeight: 700, color: theme.textPrimary, margin: 0 }}>Insert Coating Template</h3>
                <button onClick={() => { setShowTemplatePicker(false); setSelectedTemplateType(null); setSelectedSubtype(null); setTemplateParams({}); setTemplateInsertConfirm(null); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: theme.textTertiary, padding: 4 }}><X size={16} /></button>
              </div>

              {/* Insert Confirmation Dialog */}
              {templateInsertConfirm && (
                <div style={{ padding: 16, background: theme.accentLight, borderRadius: 8, border: `1px solid ${theme.accent}` }}>
                  <p style={{ fontSize: 13, fontWeight: 600, color: theme.textPrimary, marginBottom: 12 }}>
                    Insert {templateInsertConfirm.length} layers — where?
                  </p>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={() => insertTemplateLayers(templateInsertConfirm, 'replace')} style={{ flex: 1, padding: '8px 12px', background: theme.accent, color: '#fff', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                      Replace Current Stack
                    </button>
                    <button onClick={() => insertTemplateLayers(templateInsertConfirm, 'new')} style={{ flex: 1, padding: '8px 12px', background: theme.surfaceAlt, color: theme.textPrimary, border: `1px solid ${theme.border}`, borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                      Create New Stack
                    </button>
                  </div>
                  <button onClick={() => setTemplateInsertConfirm(null)} style={{ marginTop: 8, background: 'none', border: 'none', color: theme.textTertiary, fontSize: 11, cursor: 'pointer' }}>Cancel</button>
                </div>
              )}

              {/* Type Selection Grid */}
              {!templateInsertConfirm && !selectedTemplateType && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                  {COATING_TEMPLATE_ORDER.map(typeId => {
                    const tmpl = COATING_TEMPLATES[typeId];
                    const iconData = COATING_ICONS[typeId];
                    return (
                      <button key={typeId} onClick={() => {
                        setSelectedTemplateType(typeId);
                        // If only one subtype, auto-select it
                        if (tmpl.subtypes.length === 1) {
                          setSelectedSubtype(tmpl.subtypes[0].id);
                          const defaults = {};
                          tmpl.subtypes[0].params.forEach(p => {
                            if (p.autoFill === 'substrate.n') defaults[p.key] = substrate.n || 1.52;
                            else if (p.default !== undefined) defaults[p.key] = p.default;
                          });
                          setTemplateParams(defaults);
                        }
                      }} style={{ padding: 12, background: theme.surfaceAlt, border: `1px solid ${theme.border}`, borderRadius: 8, cursor: 'pointer', textAlign: 'center', transition: 'border-color 0.15s' }}
                        onMouseEnter={e => e.currentTarget.style.borderColor = theme.accent}
                        onMouseLeave={e => e.currentTarget.style.borderColor = theme.border}
                      >
                        <div style={{ fontSize: 22, marginBottom: 4 }}>{iconData.emoji}</div>
                        <div style={{ fontSize: 11, fontWeight: 700, color: theme.textPrimary }}>{tmpl.name}</div>
                        <div style={{ fontSize: 9, color: theme.textTertiary, marginTop: 2 }}>{tmpl.description}</div>
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Subtype Selection */}
              {!templateInsertConfirm && selectedTemplateType && !selectedSubtype && (
                <div>
                  <button onClick={() => setSelectedTemplateType(null)} style={{ background: 'none', border: 'none', color: theme.accentText, fontSize: 11, cursor: 'pointer', marginBottom: 8, padding: 0 }}>← Back to types</button>
                  <div style={{ fontSize: 13, fontWeight: 600, color: theme.textPrimary, marginBottom: 8 }}>
                    {COATING_ICONS[selectedTemplateType]?.emoji} {COATING_TEMPLATES[selectedTemplateType].name} — Select variant:
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {COATING_TEMPLATES[selectedTemplateType].subtypes.map(sub => (
                      <button key={sub.id} onClick={() => {
                        setSelectedSubtype(sub.id);
                        const defaults = {};
                        sub.params.forEach(p => {
                          if (p.autoFill === 'substrate.n') defaults[p.key] = substrate.n || 1.52;
                          else if (p.default !== undefined) defaults[p.key] = p.default;
                        });
                        setTemplateParams(defaults);
                      }} style={{ padding: 10, background: theme.surfaceAlt, border: `1px solid ${theme.border}`, borderRadius: 8, cursor: 'pointer', textAlign: 'left' }}
                        onMouseEnter={e => e.currentTarget.style.borderColor = theme.accent}
                        onMouseLeave={e => e.currentTarget.style.borderColor = theme.border}
                      >
                        <div style={{ fontSize: 12, fontWeight: 600, color: theme.textPrimary }}>{sub.name}</div>
                        <div style={{ fontSize: 10, color: theme.textTertiary }}>{sub.description}</div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Parameter Form */}
              {!templateInsertConfirm && selectedTemplateType && selectedSubtype && (() => {
                const tmpl = COATING_TEMPLATES[selectedTemplateType];
                const sub = tmpl.subtypes.find(s => s.id === selectedSubtype);
                if (!sub) return null;
                return (
                  <div>
                    <button onClick={() => {
                      if (tmpl.subtypes.length > 1) { setSelectedSubtype(null); setTemplateParams({}); }
                      else { setSelectedTemplateType(null); setSelectedSubtype(null); setTemplateParams({}); }
                    }} style={{ background: 'none', border: 'none', color: theme.accentText, fontSize: 11, cursor: 'pointer', marginBottom: 8, padding: 0 }}>← Back</button>
                    <div style={{ fontSize: 13, fontWeight: 600, color: theme.textPrimary, marginBottom: 4 }}>
                      {COATING_ICONS[selectedTemplateType]?.emoji} {sub.name}
                    </div>
                    <div style={{ fontSize: 10, color: theme.textTertiary, marginBottom: 12 }}>{sub.description}</div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {sub.params.map(p => (
                        <div key={p.key}>
                          <label style={{ fontSize: 11, fontWeight: 500, color: theme.textSecondary, display: 'block', marginBottom: 2 }}>{p.label}</label>
                          {p.type === 'number' && (
                            <input
                              type="number"
                              value={templateParams[p.key] ?? p.default ?? ''}
                              onChange={e => setTemplateParams(prev => ({ ...prev, [p.key]: parseFloat(e.target.value) || 0 }))}
                              disabled={p.readOnly}
                              min={p.min} max={p.max} step={p.step}
                              style={{ width: '100%', padding: '6px 8px', border: `1px solid ${theme.inputBorder}`, borderRadius: 4, fontSize: 12, background: p.readOnly ? theme.surfaceAlt : theme.inputBg, color: theme.inputText }}
                            />
                          )}
                          {p.type === 'select' && (
                            <select
                              value={templateParams[p.key] ?? p.default ?? ''}
                              onChange={e => setTemplateParams(prev => ({ ...prev, [p.key]: parseInt(e.target.value) }))}
                              style={{ width: '100%', padding: '6px 8px', border: `1px solid ${theme.inputBorder}`, borderRadius: 4, fontSize: 12, background: theme.inputBg, color: theme.inputText }}
                            >
                              {p.options.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                            </select>
                          )}
                          {p.type === 'material_select' && (
                            <select
                              value={templateParams[p.key] ?? p.default ?? ''}
                              onChange={e => setTemplateParams(prev => ({ ...prev, [p.key]: e.target.value }))}
                              style={{ width: '100%', padding: '6px 8px', border: `1px solid ${theme.inputBorder}`, borderRadius: 4, fontSize: 12, background: theme.inputBg, color: theme.inputText }}
                            >
                              {Object.keys(allMaterials)
                                .filter(m => {
                                  if (!p.filter) return true;
                                  const n = getRefractiveIndex(m, 550);
                                  return p.filter === 'high' ? n >= 1.85 : n < 1.85;
                                })
                                .map(m => <option key={m} value={m}>{m} (n={getRefractiveIndex(m, 550).toFixed(2)})</option>)}
                            </select>
                          )}
                          {p.autoFill && <div style={{ fontSize: 9, color: theme.textMuted, marginTop: 1 }}>Auto-filled from substrate</div>}
                        </div>
                      ))}
                    </div>

                    <button
                      onClick={() => {
                        const generated = generateTemplatePreview(sub, templateParams);
                        if (!generated || generated.length === 0) {
                          showToast('Could not generate template — check parameters', 'error');
                          return;
                        }
                        setTemplateInsertConfirm(generated);
                      }}
                      style={{ marginTop: 16, width: '100%', padding: '10px 16px', background: theme.accent, color: '#fff', border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
                    >
                      <Zap size={14} /> Generate & Insert ({(() => {
                        const preview = generateTemplatePreview(sub, templateParams);
                        return preview ? preview.length : '?';
                      })()} layers)
                    </button>
                  </div>
                );
              })()}
            </div>
          </div>
        )}

        {/* Design Assistant Tab Content */}
        {activeTab === "assistant" && (
          <div className="flex-1 bg-white rounded-lg shadow-lg flex flex-col min-h-0" style={{ padding: (isPhone || isTablet) ? '8px' : '16px', overflow: (isPhone || isTablet) ? 'auto' : 'hidden', position: 'relative' }}>
            {!tierLimits.designAssistant && (
              <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', marginBottom: (isPhone || isTablet) ? 6 : 12, borderRadius: 8, background: 'linear-gradient(135deg, #fef3c7, #fde68a)', border: '1px solid #f59e0b', flexShrink: 0, position: 'relative', zIndex: 10 }}>
                <Lock size={14} style={{ color: '#b45309', flexShrink: 0 }} />
                <span style={{ fontSize: (isPhone || isTablet) ? 11 : 13, color: '#92400e', fontWeight: 500, flex: 1 }}>Requires a higher plan.</span>
                <button onClick={() => setShowPricingModal(true)} style={{ padding: '3px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600, background: '#f59e0b', color: '#fff', border: 'none', cursor: 'pointer', whiteSpace: 'nowrap' }}>Plans</button>
              </div>
              <div style={{ position: 'absolute', inset: 0, zIndex: 5, background: 'rgba(255,255,255,0.5)', cursor: 'not-allowed' }} onClick={() => { setUpgradeFeature('Design Assistant'); setShowUpgradePrompt(true); }} />
              </>
            )}
            {isDesktop && (
              <div className="flex items-baseline gap-4 mb-3 flex-shrink-0">
                <h2 className="text-lg font-bold text-gray-800">Design Assistant</h2>
                <p className="text-xs text-gray-500">Define targets or upload CSV to reverse engineer a layer stack</p>
              </div>
            )}
            <div className="flex gap-4 flex-1 min-h-0" style={{ flexDirection: (isPhone || isTablet) ? 'column' : 'row', overflow: isDesktop ? 'hidden' : undefined }}>

            {/* Left column: Config + Mode Selection + Generate */}
            <div className="flex flex-col min-h-0" style={{ width: (isPhone || isTablet) ? '100%' : '45%', flexShrink: (isPhone || isTablet) ? undefined : 0, overflow: isDesktop ? 'hidden' : undefined, display: (isPhone || isTablet) && mobileAssistantView === 'solutions' ? 'none' : undefined }}>

            {/* Mode Selection — compact, inside left column */}
            <div className="mb-3 p-2 bg-blue-50 rounded border border-blue-200 flex-shrink-0">
              <div className="flex gap-3 flex-wrap">
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="radio"
                    checked={!reverseEngineerMode}
                    onChange={() => { setReverseEngineerMode(false); }}
                    className="cursor-pointer"
                  />
                  <span className="text-xs font-medium">Target Point Mode</span>
                </label>
                <label className={`flex items-center gap-1.5 ${tierLimits.reverseEngineer ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'}`}>
                  <input
                    type="radio"
                    checked={reverseEngineerMode}
                    disabled={!tierLimits.reverseEngineer}
                    onChange={() => {
                      if (!tierLimits.reverseEngineer) { setUpgradeFeature('Reverse Engineer mode'); setShowUpgradePrompt(true); return; }
                      setReverseEngineerMode(true);
                    }}
                    className={tierLimits.reverseEngineer ? "cursor-pointer" : "cursor-not-allowed"}
                  />
                  <span className="text-xs font-medium">
                    Reverse Engineer CSV{!tierLimits.reverseEngineer ? ' 🔒' : ''}
                  </span>
                </label>
              </div>


              {reverseEngineerMode && (
                <div className="mt-2 p-2 bg-white rounded border">
                  <label className="text-xs font-semibold text-gray-700 mb-1 block">
                    Upload Reflectivity CSV:
                  </label>
                  {!reverseEngineerData ? (
                    <label className="cursor-pointer flex items-center gap-2 px-2 py-1.5 bg-indigo-600 text-white rounded hover:bg-indigo-700 w-fit text-xs">
                      <Upload size={12} />
                      <span>Choose CSV File</span>
                      <input
                        type="file"
                        accept=".csv"
                        onChange={handleReverseEngineerUpload}
                        className="hidden"
                      />
                    </label>
                  ) : (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-green-600 font-medium">
                        ✓ Loaded {reverseEngineerData.length} points
                      </span>
                      <button
                        onClick={clearReverseEngineerData}
                        className="px-2 py-0.5 bg-red-500 text-white rounded hover:bg-red-600 text-[10px] flex items-center gap-1"
                      >
                        <X size={10} />
                        Clear
                      </button>
                    </div>
                  )}
                  <p className="text-[10px] text-gray-500 mt-1">
                    CSV format: wavelength (nm), reflectivity (%)
                  </p>
                  <div className="mt-1">
                    <label className="text-[10px] text-gray-600">
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
                      className="w-full px-2 py-0.5 border rounded text-xs mt-0.5"
                      min="0.1"
                      max="10"
                      step="0.1"
                    />
                    <p className="text-[10px] text-gray-500 mt-0.5">
                      Each point must match within ±{matchTolerance}%
                    </p>
                  </div>
                </div>
              )}
            </div>

            <div className="flex flex-col flex-1 min-h-0">

                {/* Scrollable content area */}
                <div className="flex-1 overflow-y-auto min-h-0 pr-2">

                {false && colorTargetMode && (
                  <div className="p-2 bg-purple-50 rounded border border-purple-200 mb-3 flex-shrink-0">
                    <div className="flex items-center gap-2 mb-2">
                      <div 
                        className="w-10 h-10 rounded border-2 border-gray-400 shadow-inner flex-shrink-0"
                        style={{ 
                          backgroundColor: `lab(${targetColorL}% ${targetColorA} ${targetColorB})`
                        }}
                        title={`L*=${targetColorL}, a*=${targetColorA}, b*=${targetColorB}`}
                      ></div>
                      <div className="flex-1">
                        <div className="flex gap-1 mb-1">
                          <button
                            onClick={() => setColorInputMode('lab')}
                            className={`px-2 py-0.5 text-[10px] rounded ${colorInputMode === 'lab' ? 'bg-purple-600 text-white' : 'bg-gray-200 text-gray-700'}`}
                          >
                            L*a*b*
                          </button>
                          <button
                            onClick={() => {
                              // Convert current a*b* to C,h before switching
                              const { C, h } = labToLch(targetColorA || 0, targetColorB || 0);
                              setTargetColorC(parseFloat(C.toFixed(1)));
                              setTargetColorH(parseFloat(h.toFixed(1)));
                              setColorInputMode('lch');
                            }}
                            className={`px-2 py-0.5 text-[10px] rounded ${colorInputMode === 'lch' ? 'bg-purple-600 text-white' : 'bg-gray-200 text-gray-700'}`}
                          >
                            LCh
                          </button>
                        </div>
                        {colorInputMode === 'lab' ? (
                          <div className="grid grid-cols-3 gap-1">
                            <div>
                              <label className="text-[10px] text-gray-600">L*</label>
                              <input
                                type="number"
                                value={targetColorL}
                                onChange={(e) => setTargetColorL(e.target.value === "" ? "" : parseFloat(e.target.value))}
                                onBlur={(e) => { if (e.target.value === "") setTargetColorL(0); }}
                                className="w-full px-1 py-0.5 border rounded text-xs"
                                min="0"
                                max="100"
                                step="1"
                              />
                            </div>
                            <div>
                              <label className="text-[10px] text-gray-600">a*</label>
                              <input
                                type="number"
                                value={targetColorA}
                                onChange={(e) => setTargetColorA(e.target.value === "" ? "" : parseFloat(e.target.value))}
                                onBlur={(e) => { if (e.target.value === "") setTargetColorA(0); }}
                                className="w-full px-1 py-0.5 border rounded text-xs"
                                min="-128"
                                max="128"
                                step="1"
                              />
                            </div>
                            <div>
                              <label className="text-[10px] text-gray-600">b*</label>
                              <input
                                type="number"
                                value={targetColorB}
                                onChange={(e) => setTargetColorB(e.target.value === "" ? "" : parseFloat(e.target.value))}
                                onBlur={(e) => { if (e.target.value === "") setTargetColorB(0); }}
                                className="w-full px-1 py-0.5 border rounded text-xs"
                                min="-128"
                                max="128"
                                step="1"
                              />
                            </div>
                          </div>
                        ) : (
                          <div className="grid grid-cols-3 gap-1">
                            <div>
                              <label className="text-[10px] text-gray-600">L*</label>
                              <input
                                type="number"
                                value={targetColorL}
                                onChange={(e) => setTargetColorL(e.target.value === "" ? "" : parseFloat(e.target.value))}
                                onBlur={(e) => { if (e.target.value === "") setTargetColorL(0); }}
                                className="w-full px-1 py-0.5 border rounded text-xs"
                                min="0"
                                max="100"
                                step="1"
                              />
                            </div>
                            <div>
                              <label className="text-[10px] text-gray-600">C</label>
                              <input
                                type="number"
                                value={targetColorC}
                                onChange={(e) => {
                                  const newC = e.target.value === "" ? "" : parseFloat(e.target.value);
                                  setTargetColorC(newC);
                                  if (newC !== "") {
                                    const { a, b } = lchToLab(newC, targetColorH || 0);
                                    setTargetColorA(parseFloat(a.toFixed(2)));
                                    setTargetColorB(parseFloat(b.toFixed(2)));
                                  }
                                }}
                                onBlur={(e) => { if (e.target.value === "") setTargetColorC(0); }}
                                className="w-full px-1 py-0.5 border rounded text-xs"
                                min="0"
                                max="150"
                                step="1"
                              />
                            </div>
                            <div>
                              <label className="text-[10px] text-gray-600">h°</label>
                              <input
                                type="number"
                                value={targetColorH}
                                onChange={(e) => {
                                  const newH = e.target.value === "" ? "" : parseFloat(e.target.value);
                                  setTargetColorH(newH);
                                  if (newH !== "") {
                                    const { a, b } = lchToLab(targetColorC || 0, newH);
                                    setTargetColorA(parseFloat(a.toFixed(2)));
                                    setTargetColorB(parseFloat(b.toFixed(2)));
                                  }
                                }}
                                onBlur={(e) => { if (e.target.value === "") setTargetColorH(0); }}
                                className="w-full px-1 py-0.5 border rounded text-xs"
                                min="0"
                                max="360"
                                step="1"
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="mt-2 pt-2 border-t border-purple-200">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] text-gray-600">Optimization Balance:</span>
                        <span className="text-[10px] font-medium text-purple-700">
                          {colorWeight === 0 ? "Reflectivity Only" : 
                           colorWeight === 100 ? "Color Only" : 
                           `${colorWeight}% Color / ${100 - colorWeight}% Reflectivity`}
                        </span>
                      </div>
                      <input
                        type="range"
                        min="0"
                        max="100"
                        value={colorWeight}
                        onChange={(e) => setColorWeight(parseInt(e.target.value))}
                        className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
                      />
                      <div className="flex justify-between text-[9px] text-gray-500">
                        <span>Reflectivity</span>
                        <span>Color</span>
                      </div>
                    </div>
                    {/* Angle Color Constraints */}
                    <div className="mt-2 pt-2 border-t border-purple-200">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] font-semibold text-gray-700">Angle Color Constraints</span>
                        <button
                          onClick={() => setAngleColorConstraints(prev => [...prev, {
                            id: Date.now(), angle: 45, mode: 'maxShift', maxDeltaE: 5,
                            targetL: 50, targetA: 0, targetB: 0, weight: 50
                          }])}
                          className="px-1.5 py-0.5 text-[10px] bg-purple-600 text-white rounded"
                          style={{ cursor: 'pointer' }}
                          onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#7c3aed'; }}
                          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = '#9333ea'; }}
                        >+ Add</button>
                      </div>
                      <p className="text-[9px] text-gray-500 mb-1">
                        Constrain color at oblique angles during optimization.
                      </p>
                      {angleColorConstraints.map((constraint, idx) => (
                        <div key={constraint.id} className="p-1.5 bg-white rounded border border-purple-100 mb-1">
                          <div className="flex items-center gap-1 mb-1">
                            <select
                              value={constraint.angle}
                              onChange={(e) => setAngleColorConstraints(prev => prev.map(c => c.id === constraint.id ? { ...c, angle: parseInt(e.target.value) } : c))}
                              className="text-xs border rounded px-1 py-0.5"
                            >
                              <option value={15}>15°</option>
                              <option value={30}>30°</option>
                              <option value={45}>45°</option>
                              <option value={60}>60°</option>
                            </select>
                            <select
                              value={constraint.mode}
                              onChange={(e) => setAngleColorConstraints(prev => prev.map(c => c.id === constraint.id ? { ...c, mode: e.target.value } : c))}
                              className="text-xs border rounded px-1 py-0.5 flex-1"
                            >
                              <option value="maxShift">Max ΔE from 0°</option>
                              <option value="target">Target Color</option>
                            </select>
                            <button
                              onClick={() => setAngleColorConstraints(prev => prev.filter(c => c.id !== constraint.id))}
                              className="text-red-400"
                              style={{ cursor: 'pointer' }}
                              onMouseEnter={(e) => { e.currentTarget.style.color = '#dc2626'; }}
                              onMouseLeave={(e) => { e.currentTarget.style.color = '#f87171'; }}
                            >
                              <X size={12} />
                            </button>
                          </div>
                          {constraint.mode === 'maxShift' ? (
                            <div className="flex items-center gap-1">
                              <span className="text-[10px] text-gray-600">Max ΔE:</span>
                              <input
                                type="number"
                                value={constraint.maxDeltaE}
                                onChange={(e) => setAngleColorConstraints(prev => prev.map(c => c.id === constraint.id ? { ...c, maxDeltaE: e.target.value === "" ? "" : parseFloat(e.target.value) } : c))}
                                onBlur={(e) => { if (e.target.value === "") setAngleColorConstraints(prev => prev.map(c => c.id === constraint.id ? { ...c, maxDeltaE: 0 } : c)); }}
                                className="px-1 py-0.5 border rounded text-xs"
                                style={{ width: '3.5rem' }}
                                min="0"
                                max="50"
                                step="0.5"
                              />
                            </div>
                          ) : (
                            <div className="grid grid-cols-3 gap-1">
                              <div>
                                <label className="text-[10px] text-gray-600">L*</label>
                                <input
                                  type="number"
                                  value={constraint.targetL}
                                  onChange={(e) => setAngleColorConstraints(prev => prev.map(c => c.id === constraint.id ? { ...c, targetL: e.target.value === "" ? "" : parseFloat(e.target.value) } : c))}
                                  onBlur={(e) => { if (e.target.value === "") setAngleColorConstraints(prev => prev.map(c => c.id === constraint.id ? { ...c, targetL: 0 } : c)); }}
                                  className="w-full px-1 py-0.5 border rounded text-xs"
                                  min="0"
                                  max="100"
                                  step="1"
                                />
                              </div>
                              <div>
                                <label className="text-[10px] text-gray-600">a*</label>
                                <input
                                  type="number"
                                  value={constraint.targetA}
                                  onChange={(e) => setAngleColorConstraints(prev => prev.map(c => c.id === constraint.id ? { ...c, targetA: e.target.value === "" ? "" : parseFloat(e.target.value) } : c))}
                                  onBlur={(e) => { if (e.target.value === "") setAngleColorConstraints(prev => prev.map(c => c.id === constraint.id ? { ...c, targetA: 0 } : c)); }}
                                  className="w-full px-1 py-0.5 border rounded text-xs"
                                  min="-128"
                                  max="128"
                                  step="1"
                                />
                              </div>
                              <div>
                                <label className="text-[10px] text-gray-600">b*</label>
                                <input
                                  type="number"
                                  value={constraint.targetB}
                                  onChange={(e) => setAngleColorConstraints(prev => prev.map(c => c.id === constraint.id ? { ...c, targetB: e.target.value === "" ? "" : parseFloat(e.target.value) } : c))}
                                  onBlur={(e) => { if (e.target.value === "") setAngleColorConstraints(prev => prev.map(c => c.id === constraint.id ? { ...c, targetB: 0 } : c)); }}
                                  className="w-full px-1 py-0.5 border rounded text-xs"
                                  min="-128"
                                  max="128"
                                  step="1"
                                />
                              </div>
                            </div>
                          )}
                          <div className="flex items-center gap-1 mt-1">
                            <span className="text-[9px] text-gray-500">Weight:</span>
                            <input
                              type="range"
                              min="10"
                              max="100"
                              value={constraint.weight}
                              onChange={(e) => setAngleColorConstraints(prev => prev.map(c => c.id === constraint.id ? { ...c, weight: parseInt(e.target.value) } : c))}
                              className="flex-1 h-1 bg-gray-200 rounded-lg appearance-none cursor-pointer"
                            />
                            <span className="text-[9px] text-gray-600" style={{ width: '1.5rem' }}>{constraint.weight}%</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <details className="bg-gray-50 rounded mb-3 flex-shrink-0" open>
                  <summary className="p-3 cursor-pointer select-none font-semibold text-sm hover:bg-gray-100 rounded">
                    Design Parameters
                  </summary>
                  <div className="px-3 pb-3 space-y-2">
                    <div>
                      <label className="text-xs text-gray-600">
                        Iterations ({reverseEngineerMode ? "Reverse Engineer" : "Target Point"}):
                      </label>
                      <input
                        type="number"
                        value={reverseEngineerMode ? reverseEngineerIterations : targetModeIterations}
                        onChange={(e) => {
                          const val = e.target.value === "" ? "" : parseInt(e.target.value) || 50000;
                          if (reverseEngineerMode) {
                            setReverseEngineerIterations(val);
                          } else {
                            setTargetModeIterations(val);
                          }
                        }}
                        onBlur={(e) => {
                          if (e.target.value === "" || parseInt(e.target.value) < 10000) {
                            if (reverseEngineerMode) {
                              setReverseEngineerIterations(50000);
                            } else {
                              setTargetModeIterations(50000);
                            }
                          }
                        }}
                        className="w-full px-2 py-1 border rounded text-sm"
                        min="10000"
                        max="1000000"
                        step="10000"
                      />
                      <p className="text-xs text-gray-500 mt-1">
                        50k=fast (~30s), 200k=normal (~2-3min), 500k=thorough (~5-8min)
                      </p>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
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
                            max="50"
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
                            max="50"
                          />
                        </div>
                      </div>
                      <div>
                        <label className="text-xs text-gray-600">
                          Max Error (%):
                        </label>
                        <input
                          type="number"
                          value={maxErrorThreshold}
                          onChange={(e) =>
                            setMaxErrorThreshold(e.target.value === "" ? "" : parseFloat(e.target.value))
                          }
                          onBlur={(e) => {
                            if (e.target.value === "" || isNaN(parseFloat(e.target.value))) {
                              setMaxErrorThreshold(5.0);
                            }
                          }}
                          className="w-full px-2 py-1 border rounded text-sm"
                          min="0.5"
                          max="20"
                          step="0.5"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="flex items-center gap-2 text-xs font-medium mb-2">
                        <input
                          type="checkbox"
                          checked={useLayerTemplate}
                          onChange={(e) => setUseLayerTemplate(e.target.checked)}
                          className="cursor-pointer"
                        />
                        Use Exact Layer Structure
                      </label>
                      
                      {useLayerTemplate ? (
                        <div className="p-2 bg-white rounded border">
                          <p className="text-xs text-gray-600 mb-2">
                            Define exact material for each layer (Layer 1 = closest to substrate):
                          </p>
                          <div className="space-y-1 max-h-48 overflow-y-auto">
                            <div className="flex items-center gap-2 text-[10px] font-semibold text-gray-600 sticky top-0 bg-white pb-1 border-b">
                              <span className="w-4"></span>
                              <span className="w-10">Layer</span>
                              <span className="flex-1">Material</span>
                              <span className="w-16 text-center">Min (nm)</span>
                              <span className="w-16 text-center">Max (nm)</span>
                            </div>
                            <div
                              data-drag-container
                              onDragOver={(e) => handleContainerDragOver(e, 1000)}
                              onDrop={(e) => { e.preventDefault(); moveTemplateLayer(dragIndex - 1000, dragOverIndex - 1000); setDragIndex(null); setDragOverIndex(null); }}
                            >
                            {layerTemplate.map((layer, idx) => (
                              <div
                                data-layer-row
                                key={idx}
                                className="flex items-center gap-2"
                                style={{
                                  transform: getDragTransform(idx, dragIndex !== null && dragIndex >= 1000 ? dragIndex - 1000 : null, dragOverIndex !== null && dragOverIndex >= 1000 ? dragOverIndex - 1000 : null, 32),
                                  transition: 'transform 0.2s ease',
                                  position: 'relative',
                                  zIndex: dragIndex === idx + 1000 ? 2 : 0,
                                  boxShadow: dragIndex === idx + 1000 ? '0 2px 8px rgba(0,0,0,0.18)' : 'none',
                                }}
                                onDragEnd={() => { setDragIndex(null); setDragOverIndex(null); }}
                              >
                                <span
                                  draggable
                                  onDragStart={(e) => { setDragIndex(idx + 1000); e.dataTransfer.effectAllowed = "move"; const img = new Image(); img.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'; e.dataTransfer.setDragImage(img, 0, 0); handleDragStartCapture(e.currentTarget.closest('[data-drag-container]')); }}
                                  className="text-gray-400 flex-shrink-0 inline-flex"
                                  style={{ cursor: 'grab', transition: 'color 0.15s, transform 0.15s' }}
                                  title="Drag to reorder"
                                  onMouseEnter={(e) => { e.currentTarget.style.color = '#6366f1'; e.currentTarget.style.transform = 'scale(1.25)'; }}
                                  onMouseLeave={(e) => { e.currentTarget.style.color = ''; e.currentTarget.style.transform = ''; }}
                                  onMouseDown={(e) => { e.currentTarget.style.cursor = 'grabbing'; }}
                                  onMouseUp={(e) => { e.currentTarget.style.cursor = 'grab'; }}
                                ><GripVertical size={12} /></span>
                                <span className="text-xs font-medium w-10">L{idx + 1}:</span>
                                <select
                                  value={layer.material}
                                  onChange={(e) => {
                                    if (e.target.value === "__manage__") {
                                      setShowMaterialLibrary(true);
                                      e.target.value = layer.material;
                                      return;
                                    }
                                    const newTemplate = [...layerTemplate];
                                    newTemplate[idx] = { ...newTemplate[idx], material: e.target.value };
                                    setLayerTemplate(newTemplate);
                                  }}
                                  className="flex-1 px-2 py-1 border rounded text-xs bg-white"
                                >
                                  {Object.keys(allMaterials).map((m) => (
                                    <option key={m} value={m}>{m}</option>
                                  ))}
                                  <option disabled>──────────</option>
                                  <option value="__manage__">Manage Materials...</option>
                                </select>
                                <input
                                  type="number"
                                  value={layer.minThickness}
                                  onChange={(e) => {
                                    const newTemplate = [...layerTemplate];
                                    newTemplate[idx] = { 
                                      ...newTemplate[idx], 
                                      minThickness: e.target.value === "" ? "" : parseFloat(e.target.value)
                                    };
                                    setLayerTemplate(newTemplate);
                                  }}
                                  onBlur={(e) => {
                                    if (e.target.value === "" || isNaN(parseFloat(e.target.value))) {
                                      const newTemplate = [...layerTemplate];
                                      newTemplate[idx] = { ...newTemplate[idx], minThickness: 0 };
                                      setLayerTemplate(newTemplate);
                                    }
                                  }}
                                  className="w-16 px-1 py-1 border rounded text-xs text-center"
                                  min="0"
                                  step="1"
                                />
                                <input
                                  type="number"
                                  value={layer.maxThickness}
                                  onChange={(e) => {
                                    const newTemplate = [...layerTemplate];
                                    newTemplate[idx] = { 
                                      ...newTemplate[idx], 
                                      maxThickness: e.target.value === "" ? "" : parseFloat(e.target.value)
                                    };
                                    setLayerTemplate(newTemplate);
                                  }}
                                  onBlur={(e) => {
                                    if (e.target.value === "" || isNaN(parseFloat(e.target.value))) {
                                      const newTemplate = [...layerTemplate];
                                      newTemplate[idx] = { ...newTemplate[idx], maxThickness: 0 };
                                      setLayerTemplate(newTemplate);
                                    }
                                  }}
                                  className="w-16 px-1 py-1 border rounded text-xs text-center"
                                  min="0"
                                  step="1"
                                />
                              </div>
                            ))}
                            </div>
                          </div>
                          <p className="text-xs text-gray-500 mt-2">
                            Optimizer searches within min/max thickness range for each layer.
                          </p>
                        </div>
                      ) : (
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
                            {Object.keys(allMaterials)
                              .map((mat) => (
                                <label
                                  key={mat}
                                  className="flex items-center gap-1 text-xs"
                                >
                                  <input
                                    type="checkbox"
                                    checked={designMaterials.includes(mat)}
                                    onChange={(e) => {
                                      if (e.target.checked) {
                                        setDesignMaterials([
                                          ...designMaterials,
                                          mat,
                                        ]);
                                      } else {
                                        setDesignMaterials(
                                          designMaterials.filter((m) => m !== mat)
                                        );
                                      }
                                    }}
                                  />
                                  {mat}
                                </label>
                              ))}
                          </div>
                          <button
                            onClick={() => setShowMaterialLibrary(true)}
                            className="text-xs text-indigo-600 hover:text-indigo-800 underline mt-1"
                          >
                            Manage Materials...
                          </button>
                        </div>
                      )}
                    </div>
                    <div className="pt-2 border-t">
                      <label className="flex items-center gap-2 text-xs font-medium mb-2">
                        <input
                          type="checkbox"
                          checked={useAdhesionLayer}
                          onChange={(e) =>
                            setUseAdhesionLayer(e.target.checked)
                          }
                          className="cursor-pointer"
                        />
                        Add Adhesion Layer
                      </label>
                      {useAdhesionLayer && (
                        <div className="ml-5 space-y-2">
                          <div>
                            <label className="text-xs text-gray-600">
                              Material:
                            </label>
                            <select
                              value={adhesionMaterial}
                              onChange={(e) => {
                                if (e.target.value === "__manage__") {
                                  setShowMaterialLibrary(true);
                                  e.target.value = adhesionMaterial;
                                  return;
                                }
                                setAdhesionMaterial(e.target.value);
                              }}
                              className="w-full px-2 py-1 border rounded text-sm bg-white"
                            >
                              {Object.keys(allMaterials).map((mat) => (
                                <option key={mat} value={mat}>
                                  {mat}
                                </option>
                              ))}
                              <option disabled>──────────</option>
                              <option value="__manage__">Manage Materials...</option>
                            </select>
                          </div>
                          <div>
                            <label className="text-xs text-gray-600">
                              Thickness (nm):
                            </label>
                            <input
                              type="number"
                              value={adhesionThickness}
                              onChange={(e) =>
                                setAdhesionThickness(
                                  e.target.value === "" ? "" : safeParseFloat(e.target.value)
                                )
                              }
                              onBlur={(e) => {
                                if (e.target.value === "" || safeParseFloat(e.target.value) < 1) {
                                  setAdhesionThickness(10);
                                }
                              }}
                              className="w-full px-2 py-1 border rounded text-sm"
                              min="1"
                              max="100"
                              step="1"
                            />
                          </div>
                          <p className="text-[10px] text-gray-500">
                            Adhesion layer will be added as the first layer in
                            all solutions
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                </details>

                  {!reverseEngineerMode && (
                    <details className="mb-3" open>
                      <summary className="p-2 cursor-pointer select-none font-semibold text-sm hover:bg-gray-100 rounded bg-gray-50">
                        Target Specifications
                      </summary>
                      <div className="space-y-2">
                        {designPoints.map((point) => (
                          <div
                            key={point.id}
                            className="p-3 bg-gray-50 rounded border"
                          >
                            <div className="flex justify-between items-center mb-2">
                              <span className="text-xs font-semibold text-gray-700">
                                Target #{designPoints.indexOf(point) + 1}
                              </span>
                              <button
                                onClick={() => removeDesignPoint(point.id)}
                                className="p-1 bg-red-500 text-white rounded hover:bg-red-600"
                              >
                                <X size={14} />
                              </button>
                            </div>

                            {/* Wavelength Section */}
                            <div className="mb-3 p-2 bg-white rounded border">
                              <div className="mb-2">
                                <label className="flex items-center gap-2 text-xs font-medium">
                                  <input
                                    type="checkbox"
                                    checked={point.useWavelengthRange}
                                    onChange={(e) =>
                                      updateDesignPoint(
                                        point.id,
                                        "useWavelengthRange",
                                        e.target.checked
                                      )
                                    }
                                  />
                                  Wavelength Range
                                </label>
                              </div>
                              {point.useWavelengthRange ? (
                                <div className="flex gap-2">
                                  <div className="flex-1">
                                    <label className="text-xs text-gray-600">
                                      λ Min (nm)
                                    </label>
                                    <input
                                      type="number"
                                      value={point.wavelengthMin}
                                      onChange={(e) => {
                                        const val =
                                          e.target.value === ""
                                            ? ""
                                            : e.target.value;
                                        updateDesignPoint(
                                          point.id,
                                          "wavelengthMin",
                                          val
                                        );
                                      }}
                                      onBlur={(e) => {
                                        if (e.target.value === "") {
                                          updateDesignPoint(
                                            point.id,
                                            "wavelengthMin",
                                            0
                                          );
                                        }
                                      }}
                                      className="w-full px-2 py-1 border rounded text-sm"
                                      step="1"
                                    />
                                  </div>
                                  <div className="flex-1">
                                    <label className="text-xs text-gray-600">
                                      λ Max (nm)
                                    </label>
                                    <input
                                      type="number"
                                      value={point.wavelengthMax}
                                      onChange={(e) => {
                                        const val =
                                          e.target.value === ""
                                            ? ""
                                            : e.target.value;
                                        updateDesignPoint(
                                          point.id,
                                          "wavelengthMax",
                                          val
                                        );
                                      }}
                                      onBlur={(e) => {
                                        if (e.target.value === "") {
                                          updateDesignPoint(
                                            point.id,
                                            "wavelengthMax",
                                            0
                                          );
                                        }
                                      }}
                                      className="w-full px-2 py-1 border rounded text-sm"
                                      step="1"
                                    />
                                  </div>
                                </div>
                              ) : (
                                <div>
                                  <label className="text-xs text-gray-600">
                                    Wavelength (nm)
                                  </label>
                                  <input
                                    type="number"
                                    value={point.wavelengthMin}
                                    onChange={(e) => {
                                      const newValue =
                                        e.target.value === ""
                                          ? 0
                                          : Number(e.target.value);
                                      setDesignPoints(
                                        designPoints.map((p) =>
                                          p.id === point.id
                                            ? {
                                                ...p,
                                                wavelengthMin: newValue,
                                                wavelengthMax: newValue,
                                              }
                                            : p
                                        )
                                      );
                                    }}
                                    className="w-full px-2 py-1 border rounded text-sm"
                                    step="1"
                                  />
                                </div>
                              )}
                            </div>

                            {/* Reflectivity Section */}
                            <div className="p-2 bg-white rounded border">
                              <div className="mb-2">
                                <label className="flex items-center gap-2 text-xs font-medium">
                                  <input
                                    type="checkbox"
                                    checked={point.useReflectivityRange}
                                    onChange={(e) =>
                                      updateDesignPoint(
                                        point.id,
                                        "useReflectivityRange",
                                        e.target.checked
                                      )
                                    }
                                  />
                                  Reflectivity Range
                                </label>
                              </div>
                              {point.useReflectivityRange ? (
                                <div className="flex gap-2">
                                  <div className="flex-1">
                                    <label className="text-xs text-gray-600">
                                      R Min (%)
                                    </label>
                                    <input
                                      type="number"
                                      value={point.reflectivityMin}
                                      onChange={(e) => {
                                        const val =
                                          e.target.value === ""
                                            ? ""
                                            : e.target.value;
                                        updateDesignPoint(
                                          point.id,
                                          "reflectivityMin",
                                          val
                                        );
                                      }}
                                      onBlur={(e) => {
                                        if (e.target.value === "") {
                                          updateDesignPoint(
                                            point.id,
                                            "reflectivityMin",
                                            0
                                          );
                                        }
                                      }}
                                      className="w-full px-2 py-1 border rounded text-sm"
                                      step="1"
                                    />
                                  </div>
                                  <div className="flex-1">
                                    <label className="text-xs text-gray-600">
                                      R Max (%)
                                    </label>
                                    <input
                                      type="number"
                                      value={point.reflectivityMax}
                                      onChange={(e) => {
                                        const val =
                                          e.target.value === ""
                                            ? ""
                                            : e.target.value;
                                        updateDesignPoint(
                                          point.id,
                                          "reflectivityMax",
                                          val
                                        );
                                      }}
                                      onBlur={(e) => {
                                        if (e.target.value === "") {
                                          updateDesignPoint(
                                            point.id,
                                            "reflectivityMax",
                                            0
                                          );
                                        }
                                      }}
                                      className="w-full px-2 py-1 border rounded text-sm"
                                      step="1"
                                    />
                                  </div>
                                </div>
                              ) : (
                                <div>
                                  <label className="text-xs text-gray-600">
                                    Target R (%)
                                  </label>
                                  <input
                                    type="number"
                                    value={point.reflectivityMin}
                                    onChange={(e) => {
                                      const newValue =
                                        e.target.value === ""
                                          ? 0
                                          : Number(e.target.value);
                                      setDesignPoints(
                                        designPoints.map((p) =>
                                          p.id === point.id
                                            ? {
                                                ...p,
                                                reflectivityMin: newValue,
                                                reflectivityMax: newValue,
                                              }
                                            : p
                                        )
                                      );
                                    }}
                                    className="w-full px-2 py-1 border rounded text-sm"
                                    step="1"
                                  />
                                </div>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                      <button
                        onClick={addDesignPoint}
                        className="mt-2 w-full bg-green-600 text-white rounded hover:bg-green-700 flex items-center justify-center gap-1"
                        style={{ padding: (isPhone || isTablet) ? '4px 0' : '8px 0', fontSize: (isPhone || isTablet) ? 11 : 14 }}
                      >
                        <Plus size={(isPhone || isTablet) ? 12 : 14} /> {(isPhone || isTablet) ? '+ Target' : 'Add Target Specification'}
                      </button>
                    </details>
                  )}

                  {reverseEngineerMode && (
                    <div className="text-center text-gray-500 text-sm py-8">
                      {reverseEngineerData ? (
                        <div className="space-y-2">
                          <p className="font-semibold text-gray-700">
                            Ready to reverse engineer!
                          </p>
                          <p>
                            Loaded {reverseEngineerData.length} reflectivity
                            measurements
                          </p>
                          <p className="text-xs">
                            Configure materials and layers, then click "Generate
                            Solutions"
                          </p>
                        </div>
                      ) : (
                        <p>
                          Upload a CSV file with reflectivity data to begin
                          reverse engineering.
                        </p>
                      )}
                    </div>
                  )}

                </div>
                {/* End scrollable content area */}

                <button
                  onClick={optimizeDesign}
                  disabled={
                    !tierLimits.designAssistant ||
                    optimizing ||
                    (!reverseEngineerMode && designPoints.length === 0) ||
                    (reverseEngineerMode && !reverseEngineerData) ||
                    (!useLayerTemplate && designMaterials.length === 0)
                  }
                  className="w-full rounded flex items-center justify-center gap-2 flex-shrink-0 font-semibold"
                  style={{
                    padding: (isPhone || isTablet) ? '8px 0' : '8px 0',
                    marginTop: (isPhone || isTablet) ? 8 : 12,
                    fontSize: (isPhone || isTablet) ? 12 : 14,
                    position: (isPhone || isTablet) ? 'sticky' : undefined,
                    bottom: (isPhone || isTablet) ? 0 : undefined,
                    zIndex: (isPhone || isTablet) ? 10 : undefined,
                    background: optimizing ? (darkMode ? '#363860' : '#9ca3af') : (darkMode ? '#6366f1' : '#4f46e5'),
                    color: '#ffffff',
                    cursor: optimizing ? 'not-allowed' : 'pointer',
                    transition: 'background 0.2s, box-shadow 0.2s',
                    boxShadow: optimizing ? 'none' : (darkMode ? '0 2px 8px rgba(99,102,241,0.3)' : '0 2px 8px rgba(79,70,229,0.25)'),
                  }}
                  onMouseEnter={(e) => { if (!optimizing) e.currentTarget.style.background = darkMode ? '#818cf8' : '#4338ca'; }}
                  onMouseLeave={(e) => { if (!optimizing) e.currentTarget.style.background = darkMode ? '#6366f1' : '#4f46e5'; }}
                >
                  {optimizing ? (
                    <>
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                      Optimizing...
                    </>
                  ) : (
                    <>
                      <Zap size={16} />
                      Generate Solutions
                    </>
                  )}
                </button>

                {/* Progress Bar */}
                {optimizing && (
                  <div className="mt-2 flex-shrink-0">
                    <div className="flex justify-between items-center mb-1">
                      <span className="text-xs text-gray-600">
                        {optimizationStage}
                      </span>
                      <span className="text-xs font-semibold text-indigo-600">
                        {Math.round(optimizationProgress)}%
                      </span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
                      <div
                        className="bg-indigo-600 h-2 rounded-full transition-all duration-300 ease-out"
                        style={{ width: `${optimizationProgress}%` }}
                      ></div>
                    </div>
                    <p className="text-xs text-gray-500 mt-1 text-center">
                      This may take 30 seconds to 8 minutes depending on iteration count
                    </p>
                  </div>
                )}
            </div>
            </div>

            {/* Right: Solutions */}
            <div className="flex flex-col overflow-hidden min-h-0 flex-1 border rounded p-3" style={{ borderColor: darkMode ? '#2a2c4a' : '#e5e7eb', background: darkMode ? '#111225' : '#f9fafb', display: (isPhone || isTablet) && mobileAssistantView === 'config' ? 'none' : undefined }}>
              {(isPhone || isTablet) && (
                <button onClick={() => setMobileAssistantView('config')} style={{ alignSelf: 'flex-start', padding: '4px 12px', borderRadius: 6, fontSize: 11, fontWeight: 600, background: darkMode ? '#1e1f3a' : '#f3f4f6', color: darkMode ? '#a0a0b8' : '#374151', border: `1px solid ${darkMode ? '#363860' : '#d1d5db'}`, cursor: 'pointer', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 4 }}>
                  ← Back to Config
                </button>
              )}
              <h3 className="text-xs font-semibold mb-2 flex-shrink-0" style={{ color: theme.textSecondary }}>
                Solutions (Top 5, Error &lt; {maxErrorThreshold}%)
              </h3>
              <div className="flex-1 overflow-y-auto space-y-3 min-h-0">
                {solutions.length === 0 ? (
                  <div className="text-center text-sm py-8" style={{ color: theme.textMuted }}>
                    No solutions yet. Configure parameters and click "Generate
                    Solutions".
                  </div>
                  ) : (
                    solutions.map((solution, idx) => (
                      <div key={idx} className="p-3 border rounded bg-gray-50">
                        <div className="flex justify-between items-center mb-2">
                          <span className="font-semibold text-sm">
                            Solution {idx + 1}
                          </span>
                          <span
                            className={`text-xs font-semibold px-2 py-0.5 rounded ${
                              solution.error < 3
                                ? "bg-green-100 text-green-700"
                                : solution.error < 5
                                ? "bg-yellow-100 text-yellow-700"
                                : "bg-orange-100 text-orange-700"
                            }`}
                          >
                            {solution.error < 3 ? "✓ " : ""}
                            {`${solution.error.toFixed(2)}% error${solution.maxDeviation !== undefined ? ` (max: ${solution.maxDeviation.toFixed(1)}%)` : ''}`}
                          </span>
                          {!reverseEngineerMode && solution.targetResults && (
                            <div className="flex gap-1 mt-1 flex-wrap">
                              {solution.targetResults.map((tr, ti) => (
                                <span key={ti} className={`text-[10px] px-1 rounded ${tr.pass ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                                  {tr.pass ? '✓' : '✗'} T{ti + 1}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>




                        {/* Preview Chart */}
                        {solution.chartData && (
                          <div className="mb-2 bg-white p-2 rounded border">
                            <ResponsiveContainer width="100%" height={120}>
                              <LineChart data={solution.chartData}>
                                <CartesianGrid
                                  strokeDasharray="3 3"
                                  stroke={theme.chartGrid}
                                  strokeOpacity={0.6}
                                />
                                <XAxis
                                  dataKey="wavelength"
                                  tick={{ fontSize: 8, fill: theme.chartAxisText }}
                                  stroke={theme.chartAxisText}
                                />
                                <YAxis
                                  domain={[
                                    0,
                                    (dataMax) => {
                                      // Find maximum reflectivity in the visible spectrum (380-780nm)
                                      const visibleData =
                                        solution.chartData.filter(
                                          (d) =>
                                            d.wavelength >= 380 &&
                                            d.wavelength <= 780
                                        );
                                      const maxReflectivity = Math.max(
                                        ...visibleData.map(
                                          (d) => d.reflectivity
                                        )
                                      );
                                      // Add 10% padding to the max value, round up to nearest 5
                                      const paddedMax =
                                        Math.ceil((maxReflectivity * 1.1) / 5) *
                                        5;
                                      return Math.max(paddedMax, 10); // Minimum of 10 to avoid too compressed charts
                                    },
                                  ]}
                                  tick={{ fontSize: 8, fill: theme.chartAxisText }}
                                  stroke={theme.chartAxisText}
                                />
                                <Tooltip content={<ChartTooltip />} />
                                <Line
                                  type="monotone"
                                  dataKey="reflectivity"
                                  stroke="#4f46e5"
                                  strokeWidth={2}
                                  dot={false}
                                  name={
                                    displayMode === "transmission"
                                      ? "T (%)"
                                      : "R (%)"
                                  }
                                />
                                {/* Overlay target points or experimental data */}
                                {reverseEngineerMode &&
                                  reverseEngineerData &&
                                  reverseEngineerData.map((point, i) => {
                                    if (i % 5 === 0) {
                                      // Show every 5th point to avoid clutter
                                      return (
                                        <ReferenceArea
                                          key={i}
                                          x1={point.wavelength - 3}
                                          x2={point.wavelength + 3}
                                          y1={point.reflectivity - 2}
                                          y2={point.reflectivity + 2}
                                          fill="#ef4444"
                                          fillOpacity={0.2}
                                        />
                                      );
                                    }
                                    return null;
                                  })}
                                {!reverseEngineerMode &&
                                  designPoints.map((point, i) => (
                                    <ReferenceArea
                                      key={i}
                                      x1={point.wavelengthMin}
                                      x2={
                                        point.wavelengthMax ||
                                        point.wavelengthMin
                                      }
                                      y1={point.reflectivityMin}
                                      y2={
                                        point.reflectivityMax ||
                                        point.reflectivityMin
                                      }
                                      fill="#10b981"
                                      fillOpacity={0.2}
                                    />
                                  ))}
                              </LineChart>
                            </ResponsiveContainer>
                          </div>
                        )}

                        <div className="space-y-1 mb-2">
                          {solution.layers.map((layer, lidx) => (
                            <div
                              key={lidx}
                              className="text-xs flex justify-between"
                              style={{
                                backgroundColor: getMaterialBg(allMaterials[layer.material]?.color || '#e5e7eb'),
                                borderLeft: `3px solid ${allMaterials[layer.material]?.color || '#9ca3af'}`,
                                padding: "2px 6px",
                                borderRadius: "3px",
                                color: theme.textPrimary,
                              }}
                            >
                              <span>
                                Layer {lidx + 1}: {layer.material}
                              </span>
                              <span style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{layer.thickness.toFixed(1)} nm</span>
                            </div>
                          ))}
                        </div>
                        <button
                          onClick={() => addSolutionAsStack(solution)}
                          className="w-full py-1.5 bg-indigo-600 text-white rounded hover:bg-indigo-700 text-xs font-semibold"
                        >
                          Add Stack
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Recipe Tracking Tab Content */}

        {activeTab === "tracking" && (
          <div className="bg-white rounded-lg shadow-lg p-4 flex-1 overflow-hidden flex flex-col">
            {!tierLimits.recipeTracking && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', marginBottom: 12, borderRadius: 8, background: 'linear-gradient(135deg, #fef3c7, #fde68a)', border: '1px solid #f59e0b' }}>
                <Lock size={14} style={{ color: '#b45309', flexShrink: 0 }} />
                <span style={{ fontSize: 13, color: '#92400e', fontWeight: 500, flex: 1 }}>Recipe Tracking requires a higher plan. Explore the interface below!</span>
                <button onClick={() => setShowPricingModal(true)} style={{ padding: '4px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600, background: '#f59e0b', color: '#fff', border: 'none', cursor: 'pointer', whiteSpace: 'nowrap' }}>View Plans</button>
              </div>
            )}
            <div className="flex justify-between items-center mb-3 flex-shrink-0">
              <h1 className="text-lg font-bold text-gray-800">
                Recipe Tracking & Trend Analysis
              </h1>
              {trackingRuns.length > 0 && (
                <button
                  onClick={clearAllTrackingRuns}
                  className="px-3 py-1.5 bg-red-500 text-white rounded hover:bg-red-600 text-sm flex items-center gap-2"
                >
                  <Trash2 size={14} />
                  Clear All
                </button>
              )}
            </div>

            {trackingRuns.length === 0 ? (
              <div className="flex-1 flex items-center justify-center">
                <div className="text-center text-gray-500">
                  <Upload size={48} className="mx-auto mb-4 text-gray-400" />
                  <p className="text-lg font-semibold mb-2">
                    No tracking data uploaded
                  </p>
                  <p className="text-sm mb-4">
                    Select a machine and recipe, then upload CSV files for INT
                    (top) or EXT (bottom) lens positions.
                  </p>
                  <p className="text-xs text-gray-400">
                    Expected format: wavelength (nm), reflectivity (%)
                  </p>

                  {/* Selection Controls for Empty State */}
                  <div className="mt-6 max-w-md mx-auto bg-gray-50 rounded border p-4">
                    <div className="space-y-3">
                      <div>
                        <label className="text-xs font-semibold text-gray-700 mb-1 block text-left">
                          Machine:
                        </label>
                        <select
                          value={selectedMachineForTracking || ""}
                          onChange={(e) =>
                            setSelectedMachineForTracking(
                              parseInt(e.target.value)
                            )
                          }
                          className="w-full px-2 py-1.5 border rounded text-sm"
                        >
                          <option value="">Select Machine...</option>
                          {machines.map((machine) => (
                            <option key={machine.id} value={machine.id}>
                              {machine.name}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="text-xs font-semibold text-gray-700 mb-1 block text-left">
                          Recipe:
                        </label>
                        <select
                          value={selectedRecipeForTracking || ""}
                          onChange={(e) =>
                            setSelectedRecipeForTracking(
                              parseInt(e.target.value)
                            )
                          }
                          className="w-full px-2 py-1.5 border rounded text-sm"
                        >
                          <option value="">Select Recipe...</option>
                          {recipes.map((recipe) => (
                            <option key={recipe.id} value={recipe.id}>
                              {recipe.name}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="pt-2">
                        <label className="text-xs font-semibold text-gray-700 mb-1 block text-left">
                          Upload Data:
                        </label>
                        <div className="flex gap-2">
                          <label
                            className={`flex-1 px-3 py-2 rounded text-sm font-medium text-center cursor-pointer ${
                              selectedMachineForTracking &&
                              selectedRecipeForTracking
                                ? "bg-blue-600 text-white hover:bg-blue-700"
                                : "bg-gray-300 text-gray-500 cursor-not-allowed"
                            }`}
                          >
                            INT (Top)
                            <input
                              type="file"
                              multiple
                              accept=".csv"
                              onChange={(e) =>
                                handleTrackingFileUpload(e, "INT")
                              }
                              className="hidden"
                              disabled={
                                !selectedMachineForTracking ||
                                !selectedRecipeForTracking
                              }
                            />
                          </label>
                          <label
                            className={`flex-1 px-3 py-2 rounded text-sm font-medium text-center cursor-pointer ${
                              selectedMachineForTracking &&
                              selectedRecipeForTracking
                                ? "bg-green-600 text-white hover:bg-green-700"
                                : "bg-gray-300 text-gray-500 cursor-not-allowed"
                            }`}
                          >
                            EXT (Bottom)
                            <input
                              type="file"
                              multiple
                              accept=".csv"
                              onChange={(e) =>
                                handleTrackingFileUpload(e, "EXT")
                              }
                              className="hidden"
                              disabled={
                                !selectedMachineForTracking ||
                                !selectedRecipeForTracking
                              }
                            />
                          </label>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex-1 overflow-hidden flex gap-3" style={{ flexDirection: isPhone ? 'column' : 'row' }}>
                {/* Left Panel - Controls and Runs List */}
                <div className="flex-shrink-0 flex flex-col gap-2" style={{ width: isPhone ? '100%' : '12rem', overflowY: 'auto', overflowX: 'hidden' }}>
                  {/* Selection and Upload Controls */}
                  <div className="p-2 bg-gray-50 rounded border">
                    <h3 className="text-xs font-bold text-gray-700 mb-2">
                      Upload Data
                    </h3>
                    <div className="space-y-1.5">
                      <div>
                        <label className="text-[10px] font-medium text-gray-600 mb-0.5 block">
                          Machine:
                        </label>
                        <select
                          value={selectedMachineForTracking || ""}
                          onChange={(e) =>
                            setSelectedMachineForTracking(
                              parseInt(e.target.value)
                            )
                          }
                          className="w-full px-1.5 py-0.5 border rounded text-xs"
                        >
                          <option value="">Select...</option>
                          {machines.map((machine) => (
                            <option key={machine.id} value={machine.id}>
                              {machine.name}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="text-[10px] font-medium text-gray-600 mb-0.5 block">
                          Recipe:
                        </label>
                        <select
                          value={selectedRecipeForTracking || ""}
                          onChange={(e) =>
                            setSelectedRecipeForTracking(
                              parseInt(e.target.value)
                            )
                          }
                          className="w-full px-1.5 py-0.5 border rounded text-xs"
                        >
                          <option value="">Select...</option>
                          {recipes.map((recipe) => (
                            <option key={recipe.id} value={recipe.id}>
                              {recipe.name}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="text-[10px] font-medium text-gray-600 mb-0.5 block">
                          Run Number:
                        </label>
                        <input
                          type="text"
                          value={runNumber}
                          onChange={(e) => setRunNumber(e.target.value)}
                          className="w-full px-1.5 py-0.5 border rounded text-xs"
                          placeholder="Optional..."
                        />
                      </div>

                      <div className="flex gap-1 pt-1">
                        <label
                          className={`flex-1 px-2 py-1 rounded text-xs font-medium text-center cursor-pointer ${
                            selectedMachineForTracking &&
                            selectedRecipeForTracking
                              ? "bg-blue-600 text-white hover:bg-blue-700"
                              : "bg-gray-300 text-gray-500 cursor-not-allowed"
                          }`}
                        >
                          INT
                          <input
                            type="file"
                            multiple
                            accept=".csv"
                            onChange={(e) => handleTrackingFileUpload(e, "INT")}
                            className="hidden"
                            disabled={
                              !selectedMachineForTracking ||
                              !selectedRecipeForTracking
                            }
                          />
                        </label>
                        <label
                          className={`flex-1 px-2 py-1 rounded text-xs font-medium text-center cursor-pointer ${
                            selectedMachineForTracking &&
                            selectedRecipeForTracking
                              ? "bg-green-600 text-white hover:bg-green-700"
                              : "bg-gray-300 text-gray-500 cursor-not-allowed"
                          }`}
                        >
                          EXT
                          <input
                            type="file"
                            multiple
                            accept=".csv"
                            onChange={(e) => handleTrackingFileUpload(e, "EXT")}
                            className="hidden"
                            disabled={
                              !selectedMachineForTracking ||
                              !selectedRecipeForTracking
                            }
                          />
                        </label>
                      </div>
                    </div>
                  </div>

                  {/* Filters */}
                  <div className="p-2 bg-gray-50 rounded border">
                    <h3 className="text-xs font-bold text-gray-700 mb-2">
                      Filters
                    </h3>
                    <div className="space-y-2">
                      <div>
                        <label className="text-[10px] font-medium text-gray-600 mb-0.5 block">
                          Machine:
                        </label>
                        <select
                          value={trackingFilters.machine}
                          onChange={(e) =>
                            updateTrackingFilter(
                              "machine",
                              e.target.value === "all"
                                ? "all"
                                : parseInt(e.target.value)
                            )
                          }
                          className="w-full px-2 py-1 border rounded text-xs"
                        >
                          <option value="all">All</option>
                          {Array.from(
                            new Set(trackingRuns.map((r) => r.machineId))
                          ).map((machineId) => {
                            const machine = machines.find(
                              (m) => m.id === machineId
                            );
                            return machine ? (
                              <option key={machineId} value={machineId}>
                                {machine.name}
                              </option>
                            ) : null;
                          })}
                        </select>
                      </div>

                      <div>
                        <label className="text-[10px] font-medium text-gray-600 mb-0.5 block">
                          Recipe:
                        </label>
                        <select
                          value={trackingFilters.recipe}
                          onChange={(e) =>
                            updateTrackingFilter(
                              "recipe",
                              e.target.value === "all"
                                ? "all"
                                : parseInt(e.target.value)
                            )
                          }
                          className="w-full px-2 py-1 border rounded text-xs"
                        >
                          <option value="all">All</option>
                          {Array.from(
                            new Set(trackingRuns.map((r) => r.recipeId))
                          ).map((recipeId) => {
                            const recipe = recipes.find(
                              (r) => r.id === recipeId
                            );
                            return recipe ? (
                              <option key={recipeId} value={recipeId}>
                                {recipe.name}
                              </option>
                            ) : null;
                          })}
                        </select>
                      </div>

                      <div>
                        <label className="text-[10px] font-medium text-gray-600 mb-0.5 block">
                          Position:
                        </label>
                        <select
                          value={trackingFilters.placement}
                          onChange={(e) =>
                            updateTrackingFilter("placement", e.target.value)
                          }
                          className="w-full px-2 py-1 border rounded text-xs"
                        >
                          <option value="all">All</option>
                          <option value="INT">INT</option>
                          <option value="EXT">EXT</option>
                        </select>
                      </div>
                    </div>
                  </div>

                  {/* Runs List */}
                  <div className="p-2 bg-gray-50 rounded border">
                    {(() => {
                      const filteredRuns = trackingRuns.filter((run) => {
                        if (
                          trackingFilters.machine !== "all" &&
                          run.machineId !== trackingFilters.machine
                        )
                          return false;
                        if (
                          trackingFilters.recipe !== "all" &&
                          run.recipeId !== trackingFilters.recipe
                        )
                          return false;
                        if (
                          trackingFilters.placement !== "all" &&
                          run.placement !== trackingFilters.placement
                        )
                          return false;
                        return true;
                      });

                      return (
                        <>
                          <h3 className="text-xs font-bold text-gray-700 mb-1">
                            Runs ({filteredRuns.length}/{trackingRuns.length})
                          </h3>
                          <div className="space-y-1">
                            {filteredRuns.map((run) => (
                              <div key={run.id} className="p-1.5 border rounded bg-white hover:bg-gray-50 text-xs">
                                <div className="flex items-start justify-between">
                                  <div className="flex items-center gap-1 flex-1 min-w-0">
                                    {/* Compare checkbox */}
                                    <input
                                      type="checkbox"
                                      checked={trackingCompareRunIds.includes(run.id)}
                                      onChange={(e) => {
                                        if (e.target.checked) {
                                          if (!requireFeature('trackingRunComparison', 'Run Comparison')) return;
                                          setTrackingCompareRunIds(prev =>
                                            prev.length >= 2 ? [prev[1], run.id] : [...prev, run.id]
                                          );
                                        } else {
                                          setTrackingCompareRunIds(prev => prev.filter(id => id !== run.id));
                                        }
                                      }}
                                      style={{ width: 11, height: 11, flexShrink: 0 }}
                                    />
                                    <div className="flex-1 min-w-0">
                                      <div className="flex items-center gap-1 mb-0.5">
                                        <span
                                          className={`px-1 py-0.5 rounded text-[9px] font-bold flex-shrink-0 ${
                                            run.placement === "INT"
                                              ? "bg-blue-200 text-blue-800"
                                              : "bg-green-200 text-green-800"
                                          }`}
                                        >
                                          {run.placement}
                                        </span>
                                        <span className="truncate text-[10px] font-medium">
                                          {run.filename}
                                        </span>
                                      </div>
                                      <div className="text-[9px] text-gray-500 truncate">
                                        {run.machineName} | {run.recipeName}
                                      </div>
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-0.5 flex-shrink-0 ml-1">
                                    <button
                                      onClick={() => setEditingNoteRunId(editingNoteRunId === run.id ? null : run.id)}
                                      className={`p-0.5 rounded ${run.notes ? 'text-indigo-600 bg-indigo-50' : 'text-gray-400 hover:bg-gray-100'}`}
                                      title={run.notes || "Add note"}
                                    >
                                      <Pencil size={11} />
                                    </button>
                                    <button
                                      onClick={() => deleteTrackingRun(run.id)}
                                      className="p-0.5 text-red-600 hover:bg-red-100 rounded"
                                    >
                                      <Trash2 size={12} />
                                    </button>
                                  </div>
                                </div>
                                {/* Inline note editor */}
                                {editingNoteRunId === run.id && (
                                  <div className="mt-1 flex gap-1">
                                    <input
                                      type="text"
                                      value={run.notes || ""}
                                      onChange={(e) => updateRunNotes(run.id, e.target.value)}
                                      onKeyDown={(e) => { if (e.key === 'Enter') setEditingNoteRunId(null); }}
                                      placeholder="Add note..."
                                      className="flex-1 px-1 py-0.5 border rounded text-[10px]"
                                      autoFocus
                                    />
                                    <button onClick={() => setEditingNoteRunId(null)} className="p-0.5 text-green-600 hover:bg-green-50 rounded">
                                      <Check size={11} />
                                    </button>
                                  </div>
                                )}
                                {/* Show note text if present and not editing */}
                                {run.notes && editingNoteRunId !== run.id && (
                                  <div className="mt-0.5 text-[9px] text-indigo-600 truncate" title={run.notes}>
                                    {run.notes}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        </>
                      );
                    })()}
                  </div>
                </div>

                {/* Center Panel - Chart */}
                <div className="flex-1 flex flex-col" style={{ minWidth: 0 }}>
                  {/* Sub-tab bar + export buttons */}
                  <div className="flex items-center mb-1" style={{ flexShrink: 0, gap: '4px' }}>
                    <button
                      onClick={() => setTrackingTrendView('spectrum')}
                      className={`px-2 py-0.5 text-xs rounded ${trackingTrendView === 'spectrum' ? 'bg-indigo-600 text-white' : 'bg-gray-200 text-gray-700'}`}
                    >Spectrum</button>
                    <button
                      onClick={() => {
                        if (!requireFeature('trackingTrendView', 'Wavelength Trend View')) return;
                        setTrackingTrendView('trends');
                      }}
                      className={`px-2 py-0.5 text-xs rounded ${trackingTrendView === 'trends' ? 'bg-indigo-600 text-white' : 'bg-gray-200 text-gray-700'}`}
                    >Trends</button>
                    <button
                      onClick={() => {
                        if (!requireFeature('trackingRunComparison', 'Run Comparison')) return;
                        if (trackingCompareRunIds.length !== 2) { showToast('Select exactly 2 runs to compare (use checkboxes in the runs list).', 'info'); return; }
                        setTrackingTrendView('difference');
                      }}
                      className={`px-2 py-0.5 text-xs rounded ${trackingTrendView === 'difference' ? 'bg-indigo-600 text-white' : 'bg-gray-200 text-gray-700'} ${trackingCompareRunIds.length !== 2 ? 'opacity-50' : ''}`}
                    >Difference</button>
                    <div style={{ flex: 1 }} />
                    <button onClick={saveTrackingData} className="rounded" style={{ padding: '2px 6px', fontSize: '10px', backgroundColor: '#6366f1', color: '#fff' }}>JSON</button>
                    <button onClick={() => { if (!requireFeature('trackingExportCsv', 'CSV Export')) return; exportTrackingCSV(); }}
                      className="rounded" style={{ padding: '2px 6px', fontSize: '10px', backgroundColor: '#22c55e', color: '#fff' }}>CSV</button>
                    <button onClick={() => { if (!requireFeature('trackingExportPng', 'PNG Export')) return; exportTrackingPNG(); }}
                      className="rounded" style={{ padding: '2px 6px', fontSize: '10px', backgroundColor: '#3b82f6', color: '#fff' }}>PNG</button>
                  </div>

                  <div className="flex-1 flex flex-col bg-white border rounded p-2" ref={trackingChartRef} style={{ minHeight: 0 }}>
                    <div className="flex-1 overflow-hidden">
                    {trackingStats &&
                      (() => {
                        const filteredRuns = trackingRuns.filter((run) => {
                          if (trackingFilters.machine !== "all" && run.machineId !== trackingFilters.machine) return false;
                          if (trackingFilters.recipe !== "all" && run.recipeId !== trackingFilters.recipe) return false;
                          if (trackingFilters.placement !== "all" && run.placement !== trackingFilters.placement) return false;
                          return true;
                        });

                        // Merge design target overlay data
                        const mergedStats = (trackingOverlayEnabled && trackingOverlayStackId && reflectivityData)
                          ? trackingStats.map(stat => {
                              const designPoint = reflectivityData.find(
                                d => Math.abs(d.wavelength - stat.wavelength) < 2.5
                              );
                              const designTarget = designPoint ? designPoint[`stack_${trackingOverlayStackId}`] ?? null : null;
                              return {
                                ...stat,
                                designTarget,
                                toleranceUpper: (designTarget != null && trackingToleranceEnabled) ? designTarget * (1 + trackingTolerancePct / 100) : null,
                                toleranceLower: (designTarget != null && trackingToleranceEnabled) ? designTarget * (1 - trackingTolerancePct / 100) : null,
                              };
                            })
                          : trackingStats;

                        // --- SPECTRUM VIEW ---
                        if (trackingTrendView === 'spectrum') {
                          return (
                            <ResponsiveContainer width="100%" height="100%">
                              <LineChart data={mergedStats}>
                                <CartesianGrid strokeDasharray="4 4" stroke={theme.chartGrid} strokeOpacity={0.4} />
                                <XAxis dataKey="wavelength" type="number" domain={["dataMin", "dataMax"]}
                                  label={{ value: "Wavelength (nm)", position: "insideBottom", offset: -5, style: { fontSize: 12, fill: theme.chartAxisText } }} />
                                <YAxis label={{ value: "Reflectivity (%)", angle: -90, position: "insideLeft", style: { fontSize: 12, fill: theme.chartAxisText } }} />
                                <Tooltip
                                  content={({ active, payload, label }) => {
                                    if (!active || !payload || !payload.length) return null;
                                    const meanEntry = payload.find(p => p.dataKey === 'mean');
                                    const targetEntry = payload.find(p => p.dataKey === 'designTarget');
                                    const meanVal = meanEntry ? meanEntry.value : null;
                                    const upperEntry = payload.find(p => p.dataKey === 'upperBound');
                                    const sigma = (upperEntry && meanEntry) ? (upperEntry.value - meanEntry.value) : null;
                                    return (
                                      <div style={{ background: theme.chartTooltipBg, border: `1px solid ${theme.chartTooltipBorder}`, borderRadius: 6, padding: '4px 8px', fontSize: 11, lineHeight: 1.4, boxShadow: theme.shadow, color: theme.chartTooltipText }}>
                                        <div style={{ fontWeight: 600, color: theme.textPrimary }}>{label} nm</div>
                                        {meanVal != null && <div style={{ color: theme.accentText }}>Mean: {meanVal.toFixed(2)}%</div>}
                                        {sigma != null && <div style={{ color: theme.textTertiary }}>{'\u00B1'}{'\u03C3'}: {sigma.toFixed(2)}%</div>}
                                        {targetEntry && targetEntry.value != null && <div style={{ color: theme.error }}>Target: {targetEntry.value.toFixed(2)}%</div>}
                                      </div>
                                    );
                                  }}
                                />
                                <Legend />

                                {filteredRuns.map((run, idx) => (
                                  <Line key={run.id} type="monotone" dataKey={`run${idx}`}
                                    stroke={`hsl(${(idx * 360) / filteredRuns.length}, 70%, 50%)`}
                                    name={`${run.placement} - ${run.filename.substring(0, 15)}...`}
                                    dot={false} strokeWidth={1.5} opacity={0.6} connectNulls />
                                ))}

                                <Line type="monotone" dataKey="mean" stroke="#4f46e5" strokeWidth={3} name="Mean" dot={false} />
                                <Line type="monotone" dataKey="upperBound" stroke={theme.chartAxisText} strokeWidth={1} strokeDasharray="5 5" name="Mean + σ" dot={false} />
                                <Line type="monotone" dataKey="lowerBound" stroke={theme.chartAxisText} strokeWidth={1} strokeDasharray="5 5" name="Mean - σ" dot={false} />

                                {/* Design target overlay */}
                                {trackingOverlayEnabled && trackingOverlayStackId && (
                                  <Line type="monotone" dataKey="designTarget" stroke="#dc2626" strokeWidth={2}
                                    strokeDasharray="8 4" name="Design Target" dot={false} connectNulls />
                                )}

                                {/* Tolerance bands */}
                                {trackingToleranceEnabled && trackingOverlayEnabled && trackingOverlayStackId && (
                                  <>
                                    <Line type="monotone" dataKey="toleranceUpper" stroke="#fca5a5" strokeWidth={1}
                                      strokeDasharray="3 3" name={`Tolerance +${trackingTolerancePct}%`} dot={false} connectNulls />
                                    <Line type="monotone" dataKey="toleranceLower" stroke="#fca5a5" strokeWidth={1}
                                      strokeDasharray="3 3" name={`Tolerance -${trackingTolerancePct}%`} dot={false} connectNulls />
                                  </>
                                )}
                              </LineChart>
                            </ResponsiveContainer>
                          );
                        }

                        // --- TREND VIEW ---
                        if (trackingTrendView === 'trends') {
                          const sortedRuns = [...filteredRuns].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
                          const trendColors = ['#4f46e5', '#dc2626', '#16a34a'];
                          const trendData = sortedRuns.map((run, idx) => {
                            const point = { runIndex: idx + 1, label: run.filename.substring(0, 12) };
                            trackingTrendWavelengths.forEach(wl => {
                              const dp = run.data.find(d => Math.abs(d.wavelength - wl) < 2);
                              point[`wl_${wl}`] = dp ? dp.reflectivity : null;
                            });
                            return point;
                          });
                          return (
                            <div className="flex flex-col h-full">
                              <div className="flex-1">
                                <ResponsiveContainer width="100%" height="100%">
                                  <LineChart data={trendData}>
                                    <CartesianGrid strokeDasharray="4 4" stroke={theme.chartGrid} strokeOpacity={0.4} />
                                    <XAxis dataKey="runIndex" label={{ value: "Run #", position: "insideBottom", offset: -5, style: { fontSize: 12, fill: theme.chartAxisText } }} />
                                    <YAxis label={{ value: "Reflectivity (%)", angle: -90, position: "insideLeft", style: { fontSize: 12, fill: theme.chartAxisText } }} />
                                    <Tooltip
                                      content={({ active, payload, label }) => {
                                        if (!active || !payload || !payload.length) return null;
                                        const run = sortedRuns[label - 1];
                                        return (
                                          <div style={{ background: theme.chartTooltipBg, border: `1px solid ${theme.chartTooltipBorder}`, borderRadius: 6, padding: '4px 8px', fontSize: 11, lineHeight: 1.4, boxShadow: theme.shadow, color: theme.chartTooltipText }}>
                                            <div style={{ fontWeight: 600, color: theme.textPrimary }}>{run?.filename || `Run ${label}`}</div>
                                            {payload.map(p => (
                                              <div key={p.dataKey} style={{ color: p.color }}>{p.dataKey.replace('wl_', '')}nm: {p.value?.toFixed(2)}%</div>
                                            ))}
                                          </div>
                                        );
                                      }}
                                    />
                                    <Legend />
                                    {trackingTrendWavelengths.map((wl, i) => (
                                      <Line key={wl} type="monotone" dataKey={`wl_${wl}`} stroke={trendColors[i % trendColors.length]}
                                        strokeWidth={2} name={`${wl}nm`} dot={{ r: 3 }} connectNulls />
                                    ))}
                                  </LineChart>
                                </ResponsiveContainer>
                              </div>
                              {/* Wavelength selector */}
                              <div className="flex items-center gap-2 mt-1 pt-1 border-t" style={{ flexShrink: 0 }}>
                                <span className="text-[10px] text-gray-600 font-semibold">Track λ:</span>
                                {trackingTrendWavelengths.map((wl, i) => (
                                  <div key={i} className="flex items-center gap-0.5">
                                    <input
                                      type="number" value={wl}
                                      onChange={(e) => {
                                        const newWls = [...trackingTrendWavelengths];
                                        newWls[i] = parseInt(e.target.value) || 0;
                                        setTrackingTrendWavelengths(newWls);
                                      }}
                                      className="w-14 px-1 py-0.5 border rounded text-[10px]" min="200" max="2500" step="10"
                                    />
                                    {trackingTrendWavelengths.length > 1 && (
                                      <button onClick={() => setTrackingTrendWavelengths(prev => prev.filter((_, j) => j !== i))}
                                        className="text-red-500 text-xs font-bold">×</button>
                                    )}
                                  </div>
                                ))}
                                {trackingTrendWavelengths.length < 3 && (
                                  <button
                                    onClick={() => setTrackingTrendWavelengths(prev => [...prev, 450])}
                                    className="px-1 py-0.5 bg-gray-200 rounded text-[10px] text-gray-700 hover:bg-gray-300"
                                  >+ Add</button>
                                )}
                              </div>
                            </div>
                          );
                        }

                        // --- DIFFERENCE VIEW ---
                        if (trackingTrendView === 'difference' && trackingCompareRunIds.length === 2) {
                          const runA = trackingRuns.find(r => r.id === trackingCompareRunIds[0]);
                          const runB = trackingRuns.find(r => r.id === trackingCompareRunIds[1]);
                          if (!runA || !runB) return <div className="text-center text-gray-500 text-sm mt-8">Selected runs not found.</div>;
                          const allWls = new Set([...runA.data.map(d => d.wavelength), ...runB.data.map(d => d.wavelength)]);
                          const diffData = Array.from(allWls).sort((a, b) => a - b).map(wl => {
                            const vA = runA.data.find(d => Math.abs(d.wavelength - wl) < 2.5)?.reflectivity;
                            const vB = runB.data.find(d => Math.abs(d.wavelength - wl) < 2.5)?.reflectivity;
                            return {
                              wavelength: wl,
                              difference: (vA != null && vB != null) ? vA - vB : null,
                              runA: vA ?? null,
                              runB: vB ?? null,
                            };
                          });
                          return (
                            <ResponsiveContainer width="100%" height="100%">
                              <LineChart data={diffData}>
                                <CartesianGrid strokeDasharray="4 4" stroke={theme.chartGrid} strokeOpacity={0.4} />
                                <XAxis dataKey="wavelength" type="number" domain={["dataMin", "dataMax"]}
                                  label={{ value: "Wavelength (nm)", position: "insideBottom", offset: -5, style: { fontSize: 12, fill: theme.chartAxisText } }} />
                                <YAxis label={{ value: "Reflectivity Difference (%)", angle: -90, position: "insideLeft", style: { fontSize: 12, fill: theme.chartAxisText } }} />
                                <Tooltip
                                  content={({ active, payload, label }) => {
                                    if (!active || !payload || !payload.length) return null;
                                    const diff = payload.find(p => p.dataKey === 'difference');
                                    return (
                                      <div style={{ background: theme.chartTooltipBg, border: `1px solid ${theme.chartTooltipBorder}`, borderRadius: 6, padding: '4px 8px', fontSize: 11, lineHeight: 1.4, boxShadow: theme.shadow, color: theme.chartTooltipText }}>
                                        <div style={{ fontWeight: 600, color: theme.textPrimary }}>{label} nm</div>
                                        {diff && <div style={{ color: theme.accentText }}>Δ: {diff.value?.toFixed(3)}%</div>}
                                      </div>
                                    );
                                  }}
                                />
                                <Legend />
                                <ReferenceLine y={0} stroke={theme.chartAxisText} strokeDasharray="3 3" />
                                <Line type="monotone" dataKey="difference" stroke="#4f46e5" strokeWidth={2}
                                  name={`${runA.filename.substring(0, 12)} − ${runB.filename.substring(0, 12)}`} dot={false} connectNulls />
                              </LineChart>
                            </ResponsiveContainer>
                          );
                        }

                        return null;
                      })()}
                    </div>
                  </div>
                </div>

                {/* Right Panel - Statistics */}
                <div className="w-44 flex-shrink-0 flex flex-col gap-2 overflow-y-auto" style={{ maxHeight: '100%' }}>
                  {/* Color Analysis with run selector */}
                  {trackingStats && trackingStats.length > 0 && (() => {
                    const filteredRuns = trackingRuns.filter((run) => {
                      if (trackingFilters.machine !== "all" && run.machineId !== trackingFilters.machine) return false;
                      if (trackingFilters.recipe !== "all" && run.recipeId !== trackingFilters.recipe) return false;
                      if (trackingFilters.placement !== "all" && run.placement !== trackingFilters.placement) return false;
                      return true;
                    });

                    // Compute color from mean or selected individual run
                    let colorVisData;
                    let colorLabel = 'Mean';
                    const selectedRun = trackingColorRunId !== 'mean' ? filteredRuns.find(r => String(r.id) === String(trackingColorRunId)) : null;
                    if (selectedRun) {
                      colorVisData = selectedRun.data
                        .filter(d => d.wavelength >= 380 && d.wavelength <= 780)
                        .map(d => ({ wavelength: d.wavelength, theoretical: d.reflectivity }));
                      colorLabel = selectedRun.filename.substring(0, 20);
                    } else {
                      colorVisData = trackingStats.map(s => ({
                        wavelength: s.wavelength,
                        theoretical: s.mean
                      }));
                    }
                    const trackingColor = calculateColorInfo(colorVisData, 'D65');
                    if (!trackingColor) return null;
                    return (
                      <div className="p-1.5 bg-gray-50 rounded border">
                        <h3 className="text-xs font-bold text-gray-700 mb-1">
                          Color Analysis
                        </h3>
                        <select
                          value={trackingColorRunId}
                          onChange={(e) => setTrackingColorRunId(e.target.value)}
                          className="w-full px-1 py-0.5 border rounded mb-1.5"
                          style={{ fontSize: 10 }}
                        >
                          <option value="mean">Mean (all runs)</option>
                          {filteredRuns.map((run, idx) => (
                            <option key={run.id} value={run.id}>
                              Run {idx + 1}: {run.filename.substring(0, 18)}
                            </option>
                          ))}
                        </select>
                        <div
                          className="w-full rounded border-2 border-gray-400 shadow-md mb-1"
                          style={{ backgroundColor: trackingColor.rgb, height: 48 }}
                          title={`${colorLabel}: ${trackingColor.hex}`}
                        ></div>
                        <div className="text-sm font-bold text-gray-900 mb-1">
                          {trackingColor.colorName}
                        </div>
                        <div className="bg-blue-50 rounded p-1.5 mb-1">
                          <div style={{ fontSize: 9, fontWeight: 600, color: darkMode ? '#60a5fa' : '#1e40af', marginBottom: 2 }}>CIE Lab</div>
                          <div style={{ fontSize: 10, color: theme.textPrimary }}>
                            <div className="flex justify-between"><span>L*:</span><span className="font-semibold">{trackingColor.L}</span></div>
                            <div className="flex justify-between"><span>a*:</span><span className="font-semibold">{trackingColor.a_star}</span></div>
                            <div className="flex justify-between"><span>b*:</span><span className="font-semibold">{trackingColor.b_star}</span></div>
                          </div>
                        </div>
                        <div className="bg-purple-50 rounded p-1.5 mb-1">
                          <div style={{ fontSize: 9, fontWeight: 600, color: darkMode ? '#c084fc' : '#6b21a8', marginBottom: 2 }}>LCh</div>
                          <div style={{ fontSize: 10, color: theme.textPrimary }}>
                            <div className="flex justify-between"><span>C:</span><span className="font-semibold">{trackingColor.C}</span></div>
                            <div className="flex justify-between"><span>h:</span><span className="font-semibold">{trackingColor.h}°</span></div>
                          </div>
                        </div>
                        <div style={{ fontSize: 10, color: theme.textPrimary }}>
                          <div className="flex justify-between"><span>Dom. λ:</span><span className="font-semibold">{trackingColor.dominantWavelength}nm</span></div>
                          <div className="flex justify-between"><span>Avg R:</span><span className="font-semibold">{trackingColor.avgReflectivity}%</span></div>
                          <div className="flex justify-between"><span>Hex:</span><span className="font-mono" style={{ fontSize: 9 }}>{trackingColor.hex}</span></div>
                        </div>
                      </div>
                    );
                  })()}

                  {/* Design Target Overlay */}
                  <div className="p-1.5 bg-gray-50 rounded border">
                    <h3 className="text-xs font-bold text-gray-700 mb-1">Design Target</h3>
                    <label className="flex items-center gap-1 text-[10px] text-gray-700 mb-1">
                      <input
                        type="checkbox"
                        checked={trackingOverlayEnabled}
                        onChange={(e) => {
                          if (e.target.checked && !requireFeature('trackingDesignOverlay', 'Design Target Overlay')) return;
                          setTrackingOverlayEnabled(e.target.checked);
                        }}
                        style={{ width: 12, height: 12 }}
                      />
                      Show Overlay
                    </label>
                    {trackingOverlayEnabled && (
                      <select
                        value={trackingOverlayStackId || ""}
                        onChange={(e) => setTrackingOverlayStackId(e.target.value ? parseInt(e.target.value) : null)}
                        className="w-full px-1 py-0.5 border rounded text-[10px]"
                      >
                        <option value="">Select stack...</option>
                        {layerStacks.map(stack => (
                          <option key={stack.id} value={stack.id}>{getStackDisplayName(stack)}</option>
                        ))}
                      </select>
                    )}
                    {/* Tolerance Bands (only when overlay active) */}
                    {trackingOverlayEnabled && trackingOverlayStackId && (
                      <div className="mt-1.5 pt-1.5 border-t border-gray-200">
                        <label className="flex items-center gap-1 text-[10px] text-gray-700 mb-1">
                          <input
                            type="checkbox"
                            checked={trackingToleranceEnabled}
                            onChange={(e) => {
                              if (e.target.checked && !requireFeature('trackingToleranceBands', 'Tolerance Bands')) return;
                              setTrackingToleranceEnabled(e.target.checked);
                            }}
                            style={{ width: 12, height: 12 }}
                          />
                          Tolerance Band
                        </label>
                        {trackingToleranceEnabled && (
                          <div className="flex items-center gap-1">
                            <span className="text-[10px] text-gray-600">±</span>
                            <input
                              type="number"
                              value={trackingTolerancePct}
                              onChange={(e) => setTrackingTolerancePct(parseFloat(e.target.value) || 0)}
                              className="w-12 px-1 py-0.5 border rounded text-[10px]"
                              min="0.1"
                              max="50"
                              step="0.5"
                            />
                            <span className="text-[10px] text-gray-600">%</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {trackingStats &&
                    trackingStats.length > 0 &&
                    (() => {
                      const filteredRuns = trackingRuns.filter((run) => {
                        if (
                          trackingFilters.machine !== "all" &&
                          run.machineId !== trackingFilters.machine
                        )
                          return false;
                        if (
                          trackingFilters.recipe !== "all" &&
                          run.recipeId !== trackingFilters.recipe
                        )
                          return false;
                        if (
                          trackingFilters.placement !== "all" &&
                          run.placement !== trackingFilters.placement
                        )
                          return false;
                        return true;
                      });

                      return (
                        <div className="p-1.5 bg-gray-50 rounded border">
                          <h3 className="text-xs font-bold text-gray-700 mb-1.5">
                            Statistics
                          </h3>
                          <div className="space-y-1.5">
                            <div className="p-1.5 border rounded bg-blue-50">
                              <div className="text-[9px] text-gray-600">
                                Filtered
                              </div>
                              <div className="text-base font-bold text-blue-700">
                                {filteredRuns.length}
                                <span className="text-xs text-gray-500">
                                  /{trackingRuns.length}
                                </span>
                              </div>
                            </div>
                            <div className="p-1.5 border rounded bg-green-50">
                              <div className="text-[9px] text-gray-600">
                                Avg. Std Dev
                              </div>
                              <div className="text-base font-bold text-green-700">
                                {(
                                  trackingStats
                                    .filter((s) => s.stdDev !== undefined)
                                    .reduce((sum, s) => sum + s.stdDev, 0) /
                                  trackingStats.filter(
                                    (s) => s.stdDev !== undefined
                                  ).length
                                ).toFixed(2)}
                                %
                              </div>
                            </div>
                            <div className="p-1.5 border rounded bg-yellow-50">
                              <div className="text-[9px] text-gray-600">
                                Max Variation
                              </div>
                              <div className="text-base font-bold text-yellow-700">
                                {Math.max(
                                  ...trackingStats
                                    .filter(
                                      (s) =>
                                        s.max !== undefined &&
                                        s.min !== undefined
                                    )
                                    .map((s) => s.max - s.min)
                                ).toFixed(2)}
                                %
                              </div>
                            </div>
                            <div className="p-1.5 border rounded bg-purple-50">
                              <div className="text-[9px] text-gray-600">
                                λ Range
                              </div>
                              <div className="text-sm font-bold text-purple-700">
                                {Math.min(
                                  ...trackingStats.map((s) => s.wavelength)
                                ).toFixed(0)}
                                -
                                {Math.max(
                                  ...trackingStats.map((s) => s.wavelength)
                                ).toFixed(0)}
                                nm
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })()}

                  {/* ΔE Color Drift */}
                  {trackingStats && trackingStats.length > 0 && (() => {
                    if (!tierLimits.trackingColorDrift) {
                      return (
                        <div className="p-1.5 bg-gray-50 rounded border" style={{ opacity: 0.6 }}>
                          <h3 className="text-xs font-bold text-gray-700 mb-1 flex items-center gap-1">
                            Color Drift ({'\u0394'}E)
                            <Lock size={10} className="text-gray-400" />
                          </h3>
                          <button
                            onClick={() => requireFeature('trackingColorDrift', 'Color Drift (ΔE) Analysis')}
                            className="text-[10px] text-indigo-600 hover:underline"
                          >Upgrade to unlock</button>
                        </div>
                      );
                    }
                    const filteredRuns = trackingRuns.filter((run) => {
                      if (trackingFilters.machine !== "all" && run.machineId !== trackingFilters.machine) return false;
                      if (trackingFilters.recipe !== "all" && run.recipeId !== trackingFilters.recipe) return false;
                      if (trackingFilters.placement !== "all" && run.placement !== trackingFilters.placement) return false;
                      return true;
                    });
                    if (filteredRuns.length === 0) return null;
                    const meanColorVisData = trackingStats.map(s => ({ wavelength: s.wavelength, theoretical: s.mean }));
                    const meanColor = calculateColorInfo(meanColorVisData, 'D65');
                    if (!meanColor) return null;
                    const runDeltaEs = filteredRuns.map(run => {
                      const visData = run.data
                        .filter(d => d.wavelength >= 380 && d.wavelength <= 780)
                        .map(d => ({ wavelength: d.wavelength, theoretical: d.reflectivity }));
                      const color = calculateColorInfo(visData, 'D65');
                      if (!color) return { run, deltaE: null, color: null };
                      const dL = parseFloat(color.L) - parseFloat(meanColor.L);
                      const da = parseFloat(color.a_star) - parseFloat(meanColor.a_star);
                      const db = parseFloat(color.b_star) - parseFloat(meanColor.b_star);
                      return { run, deltaE: Math.sqrt(dL * dL + da * da + db * db), color };
                    });
                    return (
                      <div className="p-1.5 bg-gray-50 rounded border">
                        <h3 className="text-xs font-bold text-gray-700 mb-1.5">Color Drift ({'\u0394'}E)</h3>
                        <div className="space-y-0.5">
                          {runDeltaEs.map(({ run, deltaE, color }) => (
                            <div key={run.id} className="flex items-center gap-1 text-[10px]">
                              <div style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: color?.rgb || '#ccc', flexShrink: 0, border: `1px solid ${theme.borderStrong}` }} />
                              <span className="truncate flex-1" title={run.filename}>{run.filename.substring(0, 12)}</span>
                              <span className="font-bold" style={{ color: deltaE == null ? '#9ca3af' : deltaE > 3 ? '#dc2626' : deltaE > 1 ? '#f59e0b' : '#16a34a', flexShrink: 0 }}>
                                {deltaE != null ? deltaE.toFixed(1) : '—'}
                              </span>
                            </div>
                          ))}
                        </div>
                        <div className="mt-1 text-[8px] text-gray-400">vs. Mean | {'\u0394'}E: <span style={{color:'#16a34a'}}>{'<'}1</span> <span style={{color:'#f59e0b'}}>1-3</span> <span style={{color:'#dc2626'}}>{'>'}3</span></div>
                      </div>
                    );
                  })()}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Yield Analysis Tab Content */}
        {activeTab === "yield" && (
          <div className="flex-1 bg-white rounded-lg shadow-lg p-4 overflow-y-auto flex flex-col min-h-0" style={{ position: 'relative' }}>
            {!tierLimits.yieldCalculator && (
              <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', marginBottom: 12, borderRadius: 8, background: 'linear-gradient(135deg, #fef3c7, #fde68a)', border: '1px solid #f59e0b', position: 'relative', zIndex: 10 }}>
                <Lock size={14} style={{ color: '#b45309', flexShrink: 0 }} />
                <span style={{ fontSize: 13, color: '#92400e', fontWeight: 500, flex: 1 }}>Yield Analysis requires a higher plan.</span>
                <button onClick={() => setShowPricingModal(true)} style={{ padding: '4px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600, background: '#f59e0b', color: '#fff', border: 'none', cursor: 'pointer', whiteSpace: 'nowrap' }}>View Plans</button>
              </div>
              <div style={{ position: 'absolute', inset: 0, zIndex: 5, background: 'rgba(255,255,255,0.5)', cursor: 'not-allowed' }} onClick={() => { setUpgradeFeature('Yield Calculator'); setShowUpgradePrompt(true); }} />
              </>
            )}
            <details className="bg-gray-50 rounded mb-3 flex-shrink-0" open>
              <summary className="p-3 cursor-pointer select-none font-semibold text-lg hover:bg-gray-100 rounded">
                Monte Carlo Yield Simulation
              </summary>
              <div className="px-3 pb-3">
                <p className="text-sm text-gray-600 mb-4">
                  Predict manufacturing yield by simulating thousands of coating
                  runs with realistic process variations.
                </p>

                <div className={isPhone ? "" : "grid grid-cols-2 gap-4"} style={isPhone ? { display: 'flex', flexDirection: 'column', gap: '16px' } : undefined}>
                  {/* Left: Configuration */}
                  <div className="flex flex-col">
                <div className="bg-gray-50 p-3 rounded mb-3 flex-shrink-0">
                  <h3 className="text-sm font-semibold mb-3">
                    Simulation Parameters
                  </h3>

                  <div className="space-y-3">
                    <div>
                      <label className="text-xs text-gray-600 block mb-1">
                        Number of Runs:
                      </label>
                      <input
                        type="number"
                        value={mcNumRuns}
                        onChange={(e) => {
                          const val = parseInt(e.target.value) || 100;
                          const max = tierLimits.maxMonteCarloIterations === -1 ? 10000 : tierLimits.maxMonteCarloIterations;
                          setMcNumRuns(Math.min(val, max));
                        }}
                        className="w-full px-2 py-1 border rounded text-sm"
                        min="100"
                        max={tierLimits.maxMonteCarloIterations === -1 ? 10000 : tierLimits.maxMonteCarloIterations}
                        step="100"
                      />
                      <p className="text-xs text-gray-500 mt-1">
                        {tierLimits.maxMonteCarloIterations !== -1
                          ? `Limited to ${tierLimits.maxMonteCarloIterations} runs on ${userTier} tier. Upgrade for more.`
                          : '1,000 = fast (~10s), 5,000 = balanced (~40s), 10,000 = accurate (~90s)'}
                      </p>
                    </div>

                    <div className="pt-3 border-t">
                      <h4 className="text-xs font-semibold text-gray-700 mb-2">
                        Manufacturing Error Tolerances:
                      </h4>

                      <div className="space-y-2">
                        <div>
                          <label className="text-xs text-gray-600 block mb-1">
                            Thickness Error (±%):
                          </label>
                          <input
                            type="number"
                            value={mcThicknessError}
                            onChange={(e) =>
                              setMcThicknessError(
                                safeParseFloat(e.target.value) || 0
                              )
                            }
                            className="w-full px-2 py-1 border rounded text-sm"
                            min="0"
                            max="10"
                            step="0.1"
                          />
                          <p className="text-xs text-gray-500 mt-1">
                            Per-layer random variation (typical: 1-3%)
                          </p>
                        </div>

                        <div>
                          <label className="text-xs text-gray-600 block mb-1">
                            Refractive Index Error (±%):
                          </label>
                          <input
                            type="number"
                            value={mcRIError}
                            onChange={(e) =>
                              setMcRIError(safeParseFloat(e.target.value) || 0)
                            }
                            className="w-full px-2 py-1 border rounded text-sm"
                            min="0"
                            max="5"
                            step="0.1"
                          />
                          <p className="text-xs text-gray-500 mt-1">
                            IAD/packing density variation (typical: 0.5-2%)
                          </p>
                        </div>

                        <div>
                          <label className="text-xs text-gray-600 block mb-1">
                            Tooling Factor Error (±%):
                          </label>
                          <input
                            type="number"
                            value={mcToolingError}
                            onChange={(e) =>
                              setMcToolingError(
                                safeParseFloat(e.target.value) || 0
                              )
                            }
                            className="w-full px-2 py-1 border rounded text-sm"
                            min="0"
                            max="5"
                            step="0.1"
                          />
                          <p className="text-xs text-gray-500 mt-1">
                            Calibration uncertainty (typical: 0.3-1%)
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="pt-3 border-t">
                      <label className={`flex items-center gap-2 ${tierLimits.yieldColorSimulation ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'}`}>
                        <input
                          type="checkbox"
                          checked={mcIncludeColor && tierLimits.yieldColorSimulation}
                          disabled={!tierLimits.yieldColorSimulation}
                          onChange={(e) => {
                            if (!tierLimits.yieldColorSimulation) { setUpgradeFeature('color simulation'); setShowUpgradePrompt(true); return; }
                            setMcIncludeColor(e.target.checked);
                          }}
                          className={`w-4 h-4 ${tierLimits.yieldColorSimulation ? 'cursor-pointer' : 'cursor-not-allowed'}`}
                        />
                        <span className="text-sm font-medium text-gray-700">
                          Include Color Simulation{!tierLimits.yieldColorSimulation ? ' 🔒' : ''}
                        </span>
                      </label>
                      <p className="text-xs text-gray-500 mt-1 ml-6">
                        Calculate L*a*b* color variation and ΔE* distribution
                        (adds ~20% to run time)
                      </p>
                    </div>
                  </div>
                </div>

                {targets.length === 0 && (
                  <div className="p-3 bg-yellow-50 border border-yellow-200 rounded mb-3 flex-shrink-0">
                    <p className="text-sm text-yellow-800">
                      ⚠️ Please define target specifications in the Designer tab
                      before running simulation.
                    </p>
                  </div>
                )}

                <button
                  onClick={runMonteCarloSimulation}
                  disabled={!tierLimits.yieldCalculator || mcRunning || targets.length === 0}
                  className="w-full py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center justify-center gap-2 flex-shrink-0"
                >
                  {mcRunning ? (
                    <>
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                      Running Simulation...
                    </>
                  ) : (
                    <>
                      <TrendingUp size={16} />
                      Run Monte Carlo Simulation
                    </>
                  )}
                </button>

                {mcRunning && (
                  <div className="mt-2 flex-shrink-0">
                    <div className="flex justify-between items-center mb-1">
                      <span className="text-xs text-gray-600">Progress</span>
                      <span className="text-xs font-semibold text-indigo-600">
                        {Math.round(mcProgress)}%
                      </span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
                      <div
                        className="bg-indigo-600 h-2 rounded-full transition-all duration-300 ease-out"
                        style={{ width: `${mcProgress}%` }}
                      ></div>
                    </div>
                  </div>
                )}
              </div>

              {/* Right: Results */}
              <div className="flex flex-col">
                {!mcResults ? (
                  <div className="flex-1 flex items-center justify-center">
                    <div className="text-center text-gray-500">
                      <TrendingUp
                        size={48}
                        className="mx-auto mb-4 text-gray-400"
                      />
                      <p className="text-lg font-semibold mb-2">
                        No simulation results yet
                      </p>
                      <p className="text-sm">
                        Configure parameters and click "Run Monte Carlo
                        Simulation"
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="flex-1 overflow-y-auto min-h-0">
                    <h3 className="text-sm font-semibold mb-3">
                      Simulation Results
                    </h3>

                    {/* Yield Result */}
                    <div
                      className={`p-4 rounded-lg mb-4 border-2 ${
                        mcResults.passRate >= 95
                          ? "bg-green-50 border-green-300"
                          : mcResults.passRate >= 80
                          ? "bg-yellow-50 border-yellow-300"
                          : mcResults.passRate >= 60
                          ? "bg-orange-50 border-orange-300"
                          : "bg-red-50 border-red-300"
                      }`}
                    >
                      <div className="text-center">
                        <div
                          className="text-5xl font-bold mb-2"
                          style={{
                            color:
                              mcResults.passRate >= 95
                                ? "#16a34a"
                                : mcResults.passRate >= 80
                                ? "#ca8a04"
                                : mcResults.passRate >= 60
                                ? "#ea580c"
                                : "#dc2626",
                          }}
                        >
                          {mcResults.passRate.toFixed(1)}%
                        </div>
                        <div className="text-sm font-semibold text-gray-700">
                          Predicted Yield
                        </div>
                        <div className="text-xs text-gray-600 mt-1">
                          {mcResults.passedRuns} passed / {mcResults.totalRuns}{" "}
                          total runs
                        </div>
                      </div>
                    </div>

                    {/* Error Statistics */}
                    <div className="grid grid-cols-3 gap-2 mb-4">
                      <div className="p-2 bg-green-50 border border-green-200 rounded">
                        <div className="text-xs text-gray-600">Best Case</div>
                        <div className="text-lg font-bold text-green-700">
                          {mcResults.bestCaseError.toFixed(2)}%
                        </div>
                      </div>
                      <div className="p-2 bg-blue-50 border border-blue-200 rounded">
                        <div className="text-xs text-gray-600">Average</div>
                        <div className="text-lg font-bold text-blue-700">
                          {mcResults.avgError.toFixed(2)}%
                        </div>
                      </div>
                      <div className="p-2 bg-red-50 border border-red-200 rounded">
                        <div className="text-xs text-gray-600">Worst Case</div>
                        <div className="text-lg font-bold text-red-700">
                          {mcResults.worstCaseError.toFixed(2)}%
                        </div>
                      </div>
                    </div>

                    {/* Interpretation */}
                    <div className="p-3 bg-gray-50 border rounded mb-4">
                      <h4 className="text-xs font-semibold mb-2">
                        Interpretation:
                      </h4>
                      <p className="text-xs text-gray-700">
                        {mcResults.passRate >= 95 &&
                          "✅ Excellent - This design is very manufacturable with high confidence."}
                        {mcResults.passRate >= 80 &&
                          mcResults.passRate < 95 &&
                          "👍 Good - This design should be manufacturable with acceptable yield."}
                        {mcResults.passRate >= 60 &&
                          mcResults.passRate < 80 &&
                          "⚠️ Fair - Manufacturing may be challenging. Consider tightening process control or adjusting design."}
                        {mcResults.passRate < 60 &&
                          "❌ Poor - This design is not manufacturable with current process capabilities. Redesign recommended."}
                      </p>
                    </div>

                    {/* Color Statistics */}
                    {mcIncludeColor &&
                      mcResults.colorStats &&
                      mcResults.colorStats.allL.length > 0 && (
                        <div className="mb-4 p-3 bg-purple-50 border border-purple-200 rounded">
                          <h4 className="text-sm font-semibold text-purple-900 mb-3">
                            Color Variation Analysis
                          </h4>

                          {/* Nominal vs Mean Color Swatches */}
                          <div className="flex gap-4 mb-3">
                            <div className="flex-1">
                              <div className="text-xs text-gray-600 mb-1">
                                Nominal Design
                              </div>
                              <div className="flex items-center gap-2">
                                <div
                                  className="w-12 h-12 rounded border-2 border-gray-300 shadow-inner"
                                  style={{
                                    backgroundColor: `lab(${mcResults.colorStats.nominalL}% ${mcResults.colorStats.nominalA} ${mcResults.colorStats.nominalB})`,
                                  }}
                                  title={`L*=${mcResults.colorStats.nominalL.toFixed(
                                    1
                                  )} a*=${mcResults.colorStats.nominalA.toFixed(
                                    1
                                  )} b*=${mcResults.colorStats.nominalB.toFixed(
                                    1
                                  )}`}
                                ></div>
                                <div className="text-xs">
                                  <div>
                                    L*:{" "}
                                    {mcResults.colorStats.nominalL.toFixed(1)}
                                  </div>
                                  <div>
                                    a*:{" "}
                                    {mcResults.colorStats.nominalA.toFixed(1)}
                                  </div>
                                  <div>
                                    b*:{" "}
                                    {mcResults.colorStats.nominalB.toFixed(1)}
                                  </div>
                                </div>
                              </div>
                            </div>
                            <div className="flex-1">
                              <div className="text-xs text-gray-600 mb-1">
                                Mean Simulated
                              </div>
                              <div className="flex items-center gap-2">
                                <div
                                  className="w-12 h-12 rounded border-2 border-gray-300 shadow-inner"
                                  style={{
                                    backgroundColor: `lab(${mcResults.colorStats.meanL}% ${mcResults.colorStats.meanA} ${mcResults.colorStats.meanB})`,
                                  }}
                                  title={`L*=${mcResults.colorStats.meanL.toFixed(
                                    1
                                  )} a*=${mcResults.colorStats.meanA.toFixed(
                                    1
                                  )} b*=${mcResults.colorStats.meanB.toFixed(
                                    1
                                  )}`}
                                ></div>
                                <div className="text-xs">
                                  <div>
                                    L*: {mcResults.colorStats.meanL.toFixed(1)}{" "}
                                    ±{mcResults.colorStats.stdL.toFixed(2)}
                                  </div>
                                  <div>
                                    a*: {mcResults.colorStats.meanA.toFixed(1)}{" "}
                                    ±{mcResults.colorStats.stdA.toFixed(2)}
                                  </div>
                                  <div>
                                    b*: {mcResults.colorStats.meanB.toFixed(1)}{" "}
                                    ±{mcResults.colorStats.stdB.toFixed(2)}
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>

                          {/* ΔE Statistics */}
                          <div className="grid grid-cols-2 gap-2 mb-3">
                            <div className="p-2 bg-white rounded border">
                              <div className="text-xs text-gray-600">
                                Average ΔE*
                              </div>
                              <div
                                className={`text-lg font-bold ${
                                  mcResults.colorStats.avgDeltaE < 1
                                    ? "text-green-600"
                                    : mcResults.colorStats.avgDeltaE < 2
                                    ? "text-yellow-600"
                                    : mcResults.colorStats.avgDeltaE < 3
                                    ? "text-orange-600"
                                    : "text-red-600"
                                }`}
                              >
                                {mcResults.colorStats.avgDeltaE.toFixed(2)}
                              </div>
                            </div>
                            <div className="p-2 bg-white rounded border">
                              <div className="text-xs text-gray-600">
                                Max ΔE*
                              </div>
                              <div
                                className={`text-lg font-bold ${
                                  mcResults.colorStats.maxDeltaE < 1
                                    ? "text-green-600"
                                    : mcResults.colorStats.maxDeltaE < 2
                                    ? "text-yellow-600"
                                    : mcResults.colorStats.maxDeltaE < 3
                                    ? "text-orange-600"
                                    : "text-red-600"
                                }`}
                              >
                                {mcResults.colorStats.maxDeltaE.toFixed(2)}
                              </div>
                            </div>
                          </div>

                          {/* ΔE Distribution */}
                          <div className="text-xs font-semibold text-gray-700 mb-2">
                            ΔE* Distribution:
                          </div>
                          <div className="bg-white border rounded p-2">
                            <ResponsiveContainer width="100%" height={100}>
                              <BarChart
                                data={mcResults.colorStats.deltaEDistribution}
                              >
                                <CartesianGrid strokeDasharray="4 4" stroke={theme.chartGrid} strokeOpacity={0.4} />
                                <XAxis dataKey="range" tick={{ fontSize: 9, fill: theme.chartAxisText }} />
                                <YAxis tick={{ fontSize: 9, fill: theme.chartAxisText }} />
                                <Tooltip
                                  formatter={(value, name, props) => [value, props.payload.label]}
                                  labelFormatter={(label) => `ΔE*: ${label}`}
                                  contentStyle={{ backgroundColor: theme.chartTooltipBg, borderColor: theme.chartTooltipBorder, color: theme.chartTooltipText, borderRadius: 8, fontSize: 12, boxShadow: darkMode ? '0 4px 12px rgba(0,0,0,0.5)' : '0 4px 12px rgba(0,0,0,0.1)', padding: '8px 12px' }}
                                />
                                <Bar dataKey="count" fill="#8b5cf6" />
                              </BarChart>
                            </ResponsiveContainer>
                          </div>

                          {/* ΔE Legend */}
                          <div className="mt-2 text-xs text-gray-600 grid grid-cols-3 gap-1">
                            <div>
                              <span className="text-green-600 font-semibold">
                                ●
                              </span>{" "}
                              &lt;1: Imperceptible
                            </div>
                            <div>
                              <span className="text-yellow-600 font-semibold">
                                ●
                              </span>{" "}
                              1-2: Noticeable
                            </div>
                            <div>
                              <span className="text-red-600 font-semibold">
                                ●
                              </span>{" "}
                              &gt;3: Obvious
                            </div>
                          </div>
                        </div>
                      )}

                    {/* Error Distribution */}
                    <div className="mb-4">
                      <h4 className="text-xs font-semibold mb-2">
                        Error Distribution:
                      </h4>
                      <div className="bg-white border rounded p-2">
                        <ResponsiveContainer width="100%" height={150}>
                          <BarChart data={mcResults.errorDistribution}>
                            <CartesianGrid strokeDasharray="4 4" stroke={theme.chartGrid} strokeOpacity={0.4} />
                            <XAxis
                              dataKey="range"
                              tick={{ fontSize: 8, fill: theme.chartAxisText }}
                              angle={-45}
                              textAnchor="end"
                              height={60}
                            />
                            <YAxis tick={{ fontSize: 10, fill: theme.chartAxisText }} />
                            <Tooltip content={<ChartTooltip suffix="" />} />
                            <Bar dataKey="count" fill="#4f46e5" />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </div>

                    {/* Example Stacks */}
                    {(mcResults.passedExamples.length > 0 ||
                      mcResults.failedExamples.length > 0) && (
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <h4 className="text-xs font-semibold">
                            Example Coating Stacks:
                          </h4>
                          <button
                            onClick={() => setMcShowExamples(!mcShowExamples)}
                            className="text-xs text-indigo-600 hover:text-indigo-800"
                          >
                            {mcShowExamples ? "Hide" : "Show"}
                          </button>
                        </div>

                        {mcShowExamples && (
                          <div className="space-y-3">
                            {mcResults.passedExamples.length > 0 && (
                              <div className="p-2 bg-green-50 border border-green-200 rounded">
                                <div className="text-xs font-semibold text-green-800 mb-1">
                                  Best Passing Examples (lowest error):
                                </div>
                                {mcResults.passedExamples.map(
                                  (example, idx) => (
                                    <div key={idx} className="text-xs mb-2">
                                      <div className="font-medium">
                                        Example {idx + 1} - Error:{" "}
                                        {example.error.toFixed(2)}%
                                      </div>
                                      <div className="pl-2 space-y-0.5">
                                        {example.layers.map((layer, lidx) => (
                                          <div
                                            key={lidx}
                                            className="flex justify-between"
                                            style={{
                                              backgroundColor: getMaterialBg(allMaterials[layer.material]?.color || '#e5e7eb'),
                                              borderLeft: `3px solid ${allMaterials[layer.material]?.color || '#9ca3af'}`,
                                              padding: "1px 4px",
                                              borderRadius: "2px",
                                              color: theme.textPrimary,
                                            }}
                                          >
                                            <span>
                                              L{lidx + 1}: {layer.material}
                                            </span>
                                            <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                                              {layer.thickness.toFixed(1)}nm
                                            </span>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  )
                                )}
                              </div>
                            )}

                            {mcResults.failedExamples.length > 0 && (
                              <div className="p-2 bg-red-50 border border-red-200 rounded">
                                <div className="text-xs font-semibold text-red-800 mb-1">
                                  Worst Failing Examples (highest error):
                                </div>
                                {mcResults.failedExamples.map(
                                  (example, idx) => (
                                    <div key={idx} className="text-xs mb-2">
                                      <div className="font-medium">
                                        Example {idx + 1} - Error:{" "}
                                        {example.error.toFixed(2)}%
                                      </div>
                                      <div className="pl-2 space-y-0.5">
                                        {example.layers.map((layer, lidx) => (
                                          <div
                                            key={lidx}
                                            className="flex justify-between"
                                            style={{
                                              backgroundColor: getMaterialBg(allMaterials[layer.material]?.color || '#e5e7eb'),
                                              borderLeft: `3px solid ${allMaterials[layer.material]?.color || '#9ca3af'}`,
                                              padding: "1px 4px",
                                              borderRadius: "2px",
                                              color: theme.textPrimary,
                                            }}
                                          >
                                            <span>
                                              L{lidx + 1}: {layer.material}
                                            </span>
                                            <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                                              {layer.thickness.toFixed(1)}nm
                                            </span>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  )
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
                </div>
              </div>
            </details>

            {/* ========== SENSITIVITY ANALYSIS SECTION ========== */}
            <details className="bg-gray-50 rounded mb-3 flex-shrink-0" open>
              <summary className="p-3 cursor-pointer select-none font-semibold text-lg hover:bg-gray-100 rounded">
                Layer Sensitivity Analysis
              </summary>
              <div className="px-3 pb-3">
                <p className="text-sm text-gray-600 mb-4">
                  Identify which layers have the most impact on spectral performance to prioritize manufacturing tolerances.
                </p>

                <div className={isPhone ? "" : "grid grid-cols-2 gap-4"} style={isPhone ? { display: 'flex', flexDirection: 'column', gap: '16px' } : undefined}>
                {/* Left: SA Configuration */}
                <div>
                  <div className="bg-gray-50 p-3 rounded mb-3">
                    <h3 className="text-sm font-semibold mb-3">Analysis Parameters</h3>
                    <div className="space-y-3">
                      <div>
                        <label className="text-xs text-gray-600 block mb-1">Perturbation Size:</label>
                        <div className="flex gap-2">
                          <input
                            type="number"
                            value={saDelta}
                            onChange={(e) => setSaDelta(parseFloat(e.target.value) || 1.0)}
                            className="flex-1 px-2 py-1 border rounded text-sm"
                            min="0.1"
                            max="10"
                            step="0.1"
                          />
                          <select
                            value={saDeltaMode}
                            onChange={(e) => setSaDeltaMode(e.target.value)}
                            className="px-2 py-1 border rounded text-sm bg-white"
                          >
                            <option value="nm">nm</option>
                            <option value="percent">%</option>
                          </select>
                        </div>
                        <p className="text-xs text-gray-500 mt-1">Small delta for derivative accuracy (typical: 1nm or 1%)</p>
                      </div>
                      <div className="pt-3 border-t">
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={saUseTargetWeighting}
                            onChange={(e) => setSaUseTargetWeighting(e.target.checked)}
                            className="w-4 h-4 cursor-pointer"
                            disabled={targets.length === 0}
                          />
                          <span className="text-sm font-medium text-gray-700">Weight by Target Regions</span>
                        </label>
                        <p className="text-xs text-gray-500 mt-1 ml-6">
                          {targets.length === 0
                            ? "Define targets in Designer tab first"
                            : "Only consider sensitivity within defined target wavelength ranges"}
                        </p>
                      </div>
                    </div>
                  </div>

                  <button
                    onClick={runSensitivityAnalysis}
                    disabled={saRunning || layers.length === 0}
                    className="w-full py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    {saRunning ? (
                      <>
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                        Analyzing...
                      </>
                    ) : (
                      <>
                        <TrendingUp size={16} />
                        Run Sensitivity Analysis
                      </>
                    )}
                  </button>
                </div>

                {/* Right: SA Results */}
                <div>
                  {!saResults ? (
                    <div className="flex items-center justify-center h-full">
                      <div className="text-center text-gray-500">
                        <TrendingUp size={48} className="mx-auto mb-4 text-gray-400" />
                        <p className="text-lg font-semibold mb-2">No analysis results yet</p>
                        <p className="text-sm">Configure parameters and click &quot;Run Sensitivity Analysis&quot;</p>
                      </div>
                    </div>
                  ) : (
                    <div>
                      {/* Bar Chart: Layer Sensitivity Ranking */}
                      <div className="mb-4">
                        <h4 className="text-xs font-semibold mb-2">Layer Sensitivity Ranking:</h4>
                        <div className="bg-white border rounded p-2">
                          <ResponsiveContainer width="100%" height={Math.max(120, saResults.layers.length * 30)}>
                            <BarChart
                              data={saResults.layers.map((l) => ({
                                name: `L${l.index + 1} ${l.material}`,
                                sensitivity: parseFloat((l.sensitivityScore * 1000).toFixed(2)),
                              }))}
                              layout="vertical"
                              margin={{ left: 70, right: 20, top: 5, bottom: 5 }}
                            >
                              <CartesianGrid strokeDasharray="4 4" stroke={theme.chartGrid} strokeOpacity={0.4} />
                              <XAxis type="number" tick={{ fontSize: 10, fill: theme.chartAxisText }} />
                              <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: theme.chartAxisText }} width={65} />
                              <Tooltip content={<ChartTooltip suffix="" labelPrefix="Layer " />} />
                              <Bar dataKey="sensitivity">
                                {saResults.layers.map((l, idx) => (
                                  <Cell
                                    key={idx}
                                    fill={
                                      l.toleranceClass === "tight"
                                        ? "#ef4444"
                                        : l.toleranceClass === "medium"
                                        ? "#f59e0b"
                                        : "#22c55e"
                                    }
                                  />
                                ))}
                              </Bar>
                            </BarChart>
                          </ResponsiveContainer>
                        </div>
                      </div>

                      {/* Sensitivity Table */}
                      <div className="mb-4">
                        <h4 className="text-xs font-semibold mb-2">Layer Details:</h4>
                        <div className="bg-white border rounded overflow-hidden">
                          <table className="w-full text-xs">
                            <thead className="bg-gray-100">
                              <tr>
                                <th className="px-2 py-1.5 text-left font-semibold">Layer</th>
                                <th className="px-2 py-1.5 text-left font-semibold">Material</th>
                                <th className="px-2 py-1.5 text-right font-semibold">Thick</th>
                                <th className="px-2 py-1.5 text-right font-semibold">Score</th>
                                <th className="px-2 py-1.5 text-center font-semibold">Tolerance</th>
                                <th className="px-2 py-1.5 text-left font-semibold">Peak Region</th>
                                <th className="px-2 py-1.5 text-center font-semibold"></th>
                              </tr>
                            </thead>
                            <tbody>
                              {saResults.layers.map((layer) => (
                                <tr
                                  key={layer.id}
                                  className={`border-t hover:bg-gray-50 cursor-pointer ${
                                    saSelectedLayer === layer.index ? "bg-indigo-50" : ""
                                  }`}
                                  onClick={() =>
                                    setSaSelectedLayer(
                                      saSelectedLayer === layer.index ? null : layer.index
                                    )
                                  }
                                >
                                  <td className="px-2 py-1.5">L{layer.index + 1}</td>
                                  <td className="px-2 py-1.5">
                                    <span
                                      className="inline-block w-3 h-3 rounded mr-1 align-middle border"
                                      style={{
                                        backgroundColor:
                                          allMaterials[layer.material]?.color || "#ccc",
                                      }}
                                    ></span>
                                    {layer.material}
                                  </td>
                                  <td className="px-2 py-1.5 text-right">
                                    {layer.thickness.toFixed(1)}
                                  </td>
                                  <td className="px-2 py-1.5 text-right font-mono">
                                    {(layer.sensitivityScore * 1000).toFixed(2)}
                                  </td>
                                  <td className="px-2 py-1.5 text-center">
                                    <span
                                      className={`px-1.5 py-0.5 rounded text-xs font-semibold ${
                                        layer.toleranceClass === "tight"
                                          ? "bg-red-100 text-red-800"
                                          : layer.toleranceClass === "medium"
                                          ? "bg-yellow-100 text-yellow-800"
                                          : "bg-green-100 text-green-800"
                                      }`}
                                    >
                                      {layer.toleranceClass.charAt(0).toUpperCase() +
                                        layer.toleranceClass.slice(1)}
                                    </span>
                                  </td>
                                  <td className="px-2 py-1.5">
                                    {layer.peakRegion} ({layer.peakWavelength}nm)
                                  </td>
                                  <td className="px-2 py-1.5 text-center">
                                    <span className="text-indigo-600 text-xs">
                                      {saSelectedLayer === layer.index ? "Hide" : "View"}
                                    </span>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>

                      {/* Wavelength Drill-Down */}
                      {saSelectedLayer !== null &&
                        (() => {
                          const layerData = saResults.layers.find(
                            (l) => l.index === saSelectedLayer
                          );
                          if (!layerData) return null;
                          return (
                            <div className="mb-4 p-3 bg-indigo-50 border border-indigo-200 rounded">
                              <div className="flex items-center justify-between mb-2">
                                <h4 className="text-sm font-semibold text-indigo-900">
                                  L{layerData.index + 1} ({layerData.material},{" "}
                                  {layerData.thickness.toFixed(1)}nm) — Wavelength Sensitivity
                                </h4>
                                <button
                                  onClick={() => setSaSelectedLayer(null)}
                                  className="text-xs text-indigo-600 hover:text-indigo-800"
                                >
                                  Close
                                </button>
                              </div>
                              <div className="bg-white border rounded p-2">
                                <ResponsiveContainer width="100%" height={180}>
                                  <LineChart data={layerData.wavelengthData}>
                                    <CartesianGrid strokeDasharray="4 4" stroke={theme.chartGrid} strokeOpacity={0.4} />
                                    <XAxis
                                      dataKey="wavelength"
                                      type="number"
                                      domain={[wavelengthRange.min, wavelengthRange.max]}
                                      tick={{ fontSize: 10, fill: theme.chartAxisText }}
                                    />
                                    <YAxis tick={{ fontSize: 10, fill: theme.chartAxisText }} />
                                    <Tooltip
                                      formatter={(value) => [parseFloat(value).toFixed(4), "|dR/dt|"]}
                                      labelFormatter={(label) => `${label} nm`}
                                      contentStyle={{ backgroundColor: theme.chartTooltipBg, borderColor: theme.chartTooltipBorder, color: theme.chartTooltipText, borderRadius: 8, fontSize: 12, boxShadow: darkMode ? '0 4px 12px rgba(0,0,0,0.5)' : '0 4px 12px rgba(0,0,0,0.1)', padding: '8px 12px' }}
                                    />
                                    <Line
                                      type="monotone"
                                      dataKey="sensitivity"
                                      stroke="#4f46e5"
                                      strokeWidth={2}
                                      dot={false}
                                      isAnimationActive={false}
                                    />
                                  </LineChart>
                                </ResponsiveContainer>
                              </div>
                              <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                                <div className="p-1.5 bg-white rounded border text-center">
                                  <div className="text-gray-600">RMS Score</div>
                                  <div className="font-bold">
                                    {(layerData.sensitivityScore * 1000).toFixed(2)}
                                  </div>
                                </div>
                                <div className="p-1.5 bg-white rounded border text-center">
                                  <div className="text-gray-600">Peak</div>
                                  <div className="font-bold">
                                    {(layerData.peakSensitivity * 1000).toFixed(2)} @{" "}
                                    {layerData.peakWavelength}nm
                                  </div>
                                </div>
                                <div className="p-1.5 bg-white rounded border text-center">
                                  <div className="text-gray-600">Tolerance</div>
                                  <div
                                    className={`font-bold ${
                                      layerData.toleranceClass === "tight"
                                        ? "text-red-600"
                                        : layerData.toleranceClass === "medium"
                                        ? "text-yellow-600"
                                        : "text-green-600"
                                    }`}
                                  >
                                    {layerData.toleranceClass.charAt(0).toUpperCase() +
                                      layerData.toleranceClass.slice(1)}
                                  </div>
                                </div>
                              </div>
                            </div>
                          );
                        })()}

                      {/* Legend */}
                      <div className="flex gap-4 text-xs text-gray-600">
                        <span className="flex items-center gap-1">
                          <span className="w-3 h-3 rounded bg-red-500 inline-block"></span> Tight
                        </span>
                        <span className="flex items-center gap-1">
                          <span className="w-3 h-3 rounded bg-yellow-500 inline-block"></span> Medium
                        </span>
                        <span className="flex items-center gap-1">
                          <span className="w-3 h-3 rounded bg-green-500 inline-block"></span> Loose
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
              </div>
            </details>
          </div>
        )}

        {/* Pricing Tab - removed, now uses modal */}
      </div>

      {/* Modals */}
      {showToolingModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 max-w-md w-full max-h-[80vh] flex flex-col">
            <div className="flex justify-between items-center mb-4 flex-shrink-0">
              <h2 className="text-lg font-bold text-gray-800">
                Tooling Factors
              </h2>
              <button
                onClick={() => setShowToolingModal(false)}
                className="text-gray-500 hover:text-gray-700"
              >
                <X size={20} />
              </button>
            </div>

            {/* Layer Stack Selection */}
            <div className="mb-4 flex-shrink-0">
              <label className="text-sm font-semibold text-gray-700 mb-2 block">
                Machine:
              </label>
              <div className="px-3 py-2 border rounded bg-gray-50 font-medium">
                {machines.find((m) => m.id === currentMachineId)?.name ||
                  "Unknown Machine"}
              </div>
              <p className="text-xs text-gray-500 mt-1">
                Tooling factors apply to all layer stacks on this machine
              </p>
            </div>

            <div className="space-y-2 overflow-y-auto flex-1">
              {Object.keys(allMaterials).map((material) => {
                const currentMachine = machines.find(
                  (m) => m.id === currentMachineId
                );
                const toolingValue =
                  currentMachine?.toolingFactors?.[material] || 1.0;

                return (
                  <div
                    key={material}
                    className="flex items-center justify-between p-2 border rounded hover:bg-gray-50"
                  >
                    <span className="text-sm font-medium">{material}</span>
                    <input
                      type="number"
                      value={toolingValue}
                      onChange={(e) =>
                        updateToolingFactor(
                          currentMachineId,
                          material,
                          e.target.value
                        )
                      }
                      className="w-20 px-2 py-1 border rounded text-sm"
                      step="0.01"
                    />
                  </div>
                );
              })}
            </div>
            <button
              onClick={() => setShowToolingModal(false)}
              className="mt-4 w-full bg-indigo-600 text-white py-2 rounded hover:bg-indigo-700 flex-shrink-0"
            >
              Done
            </button>
          </div>
        </div>
      )}

      {showTargetsModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl p-6 max-w-3xl w-full max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-bold text-gray-800">
                Reflectivity Targets
              </h2>
              <button
                onClick={() => setShowTargetsModal(false)}
                className="text-gray-500 hover:text-gray-700"
              >
                <X size={20} />
              </button>
            </div>

            <div className="mb-4 p-3 bg-gray-50 rounded border">
              <label className="text-sm font-semibold text-gray-700 mb-2 block">
                Recipe/Layer Stack:
              </label>
              <div className="flex gap-2">
                <select
                  value={currentRecipeId}
                  onChange={(e) => switchRecipe(parseInt(e.target.value))}
                  className="flex-1 px-3 py-2 border rounded"
                >
                  {recipes.map((recipe) => (
                    <option key={recipe.id} value={recipe.id}>
                      {recipe.name}
                    </option>
                  ))}
                </select>
                <button
                  onClick={addRecipe}
                  className="px-3 py-2 bg-green-600 text-white rounded hover:bg-green-700 text-sm flex items-center gap-1"
                >
                  <Plus size={14} /> New Recipe
                </button>
              </div>

              <div className="mt-2 flex gap-2">
                <input
                  type="text"
                  value={
                    recipes.find((r) => r.id === currentRecipeId)?.name || ""
                  }
                  onChange={(e) =>
                    renameRecipe(currentRecipeId, e.target.value)
                  }
                  className="flex-1 px-3 py-1 border rounded text-sm"
                  placeholder="Recipe name"
                />
                <button
                  onClick={() => deleteRecipe(currentRecipeId)}
                  disabled={recipes.length === 1}
                  className="px-3 py-1 bg-red-500 text-white rounded hover:bg-red-600 text-sm disabled:bg-gray-300 disabled:cursor-not-allowed"
                >
                  Delete Recipe
                </button>
              </div>
            </div>

            <div className="mb-3">
              <h3 className="text-sm font-semibold text-gray-700 mb-2">
                Targets for{" "}
                {recipes.find((r) => r.id === currentRecipeId)?.name}:
              </h3>
            </div>

            <div className="space-y-3 max-h-80 overflow-y-auto mb-4">
              {targets.map((target) => (
                <div key={target.id} className="p-3 border rounded bg-gray-50">
                  <div className="grid grid-cols-6 gap-2 items-center">
                    <div>
                      <label className="text-xs text-gray-600">Name</label>
                      <input
                        type="text"
                        value={target.name}
                        onChange={(e) =>
                          updateTarget(target.id, "name", e.target.value)
                        }
                        className="w-full px-2 py-1 border rounded text-sm"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-gray-600">
                        λ Min (nm)
                      </label>
                      <input
                        type="number"
                        value={target.wavelengthMin}
                        onChange={(e) => {
                          const val = e.target.value === "" ? "" : e.target.value;
                          updateTarget(target.id, "wavelengthMin", val);
                        }}
                        onBlur={(e) => {
                          if (e.target.value === "") {
                            updateTarget(target.id, "wavelengthMin", 0);
                          }
                        }}
                        className="w-full px-2 py-1 border rounded text-sm"
                        min="0"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-gray-600">
                        λ Max (nm)
                      </label>
                      <input
                        type="number"
                        value={target.wavelengthMax}
                        onChange={(e) => {
                          const val = e.target.value === "" ? "" : e.target.value;
                          updateTarget(target.id, "wavelengthMax", val);
                        }}
                        onBlur={(e) => {
                          if (e.target.value === "") {
                            updateTarget(target.id, "wavelengthMax", 0);
                          }
                        }}
                        className="w-full px-2 py-1 border rounded text-sm"
                        min="0"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-gray-600">R Min (%)</label>
                      <input
                        type="number"
                        value={target.reflectivityMin}
                        onChange={(e) => {
                          const val = e.target.value === "" ? "" : e.target.value;
                          updateTarget(target.id, "reflectivityMin", val);
                        }}
                        onBlur={(e) => {
                          if (e.target.value === "") {
                            updateTarget(target.id, "reflectivityMin", 0);
                          }
                        }}
                        className="w-full px-2 py-1 border rounded text-sm"
                        min="0"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-gray-600">R Max (%)</label>
                      <input
                        type="number"
                        value={target.reflectivityMax}
                        onChange={(e) => {
                          const val = e.target.value === "" ? "" : e.target.value;
                          updateTarget(target.id, "reflectivityMax", val);
                        }}
                        onBlur={(e) => {
                          if (e.target.value === "") {
                            updateTarget(target.id, "reflectivityMax", 0);
                          }
                        }}
                        className="w-full px-2 py-1 border rounded text-sm"
                        min="0"
                      />
                    </div>                    
                    <div className="flex items-end">
                      <button
                        onClick={() => removeTarget(target.id)}
                        className="w-full px-2 py-1 bg-red-500 text-white rounded hover:bg-red-600 text-sm"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              ))}

              {targets.length === 0 && (
                <div className="text-center text-gray-500 text-sm py-4">
                  No targets defined for this recipe. Click "Add Target" to
                  create one.
                </div>
              )}
            </div>

            <div className="flex gap-2">
              <button
                onClick={addTarget}
                className="flex-1 bg-green-600 text-white py-2 rounded hover:bg-green-700 flex items-center justify-center gap-1"
              >
                <Plus size={16} /> Add Target
              </button>
              <button
                onClick={() => setShowTargetsModal(false)}
                className="flex-1 bg-indigo-600 text-white py-2 rounded hover:bg-indigo-700"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* IAD Modal */}
      {showIADModal && <IADModal />}

      {/* ========== COLOR COMPARISON MODAL ========== */}
      {showColorCompareModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" onClick={() => setShowColorCompareModal(false)}>
          <div className="bg-white rounded-lg shadow-xl p-4 flex flex-col" style={{ width: isPhone ? '95vw' : '560px', maxWidth: '95vw', maxHeight: isPhone ? '90vh' : 'calc(100vh - 40px)' }} onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-3 flex-shrink-0">
              <h2 className="text-base font-bold text-gray-800">
                Color Comparison
              </h2>
              <button onClick={() => setShowColorCompareModal(false)} className="text-gray-500 hover:text-gray-700">
                <X size={18} />
              </button>
            </div>

            {/* Stack Selection */}
            <div className="mb-3 pb-3 border-b flex-shrink-0">
              <div className="flex items-center justify-between mb-2">
                <div className="text-xs font-semibold text-gray-700">Select stacks to compare</div>
                <div className="flex gap-2">
                  <button onClick={() => setColorCompareSelected(Object.keys(stackColorData))} className="text-[10px] text-indigo-600 hover:text-indigo-800">Select All</button>
                  <button onClick={() => setColorCompareSelected([])} className="text-[10px] text-gray-500 hover:text-gray-700">Clear</button>
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(stackColorData).map(([stackId, color]) => {
                  const selected = colorCompareSelected.includes(stackId);
                  return (
                    <button
                      key={stackId}
                      onClick={() => setColorCompareSelected(prev => selected ? prev.filter(id => id !== stackId) : [...prev, stackId])}
                      className={`flex items-center gap-1.5 px-2 py-1 rounded border text-xs transition-colors ${selected ? 'border-indigo-500 bg-indigo-50 text-indigo-800' : 'border-gray-300 bg-white text-gray-500 hover:border-gray-400'}`}
                    >
                      <div className="w-4 h-4 rounded border flex-shrink-0" style={{ backgroundColor: color.rgb, borderColor: selected ? theme.accent : theme.borderStrong }}></div>
                      <span className="truncate" style={{ maxWidth: '120px' }}>{color.stackName}</span>
                    </button>
                  );
                })}
                {experimentalColorData && (() => {
                  const selected = colorCompareSelected.includes('experimental');
                  return (
                    <button
                      onClick={() => setColorCompareSelected(prev => selected ? prev.filter(id => id !== 'experimental') : [...prev, 'experimental'])}
                      className={`flex items-center gap-1.5 px-2 py-1 rounded border text-xs transition-colors ${selected ? 'border-red-500 bg-red-50 text-red-800' : 'border-gray-300 bg-white text-gray-500 hover:border-gray-400'}`}
                    >
                      <div className="w-4 h-4 rounded border-2 flex-shrink-0" style={{ backgroundColor: experimentalColorData.rgb, borderColor: selected ? theme.error : theme.borderStrong }}></div>
                      <span>Experimental</span>
                    </button>
                  );
                })()}
              </div>
            </div>

            <div className="overflow-y-auto flex-1 min-h-0 space-y-3">
              {/* Selected Stack Colors */}
              {colorCompareSelected.filter(id => id !== 'experimental').length > 0 && (
                <div>
                  <div className="text-xs font-semibold text-gray-700 mb-2">Selected Colors</div>
                  <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${Math.min(colorCompareSelected.filter(id => id !== 'experimental').length + (colorCompareSelected.includes('experimental') ? 1 : 0), 4)}, 1fr)` }}>
                    {colorCompareSelected.filter(id => id !== 'experimental').map(stackId => {
                      const color = stackColorData[stackId];
                      if (!color) return null;
                      return (
                        <div key={stackId} className="text-center">
                          <div className="w-full h-12 rounded border-2 border-gray-300 shadow-sm mb-1" style={{ backgroundColor: color.rgb }} title={color.hex}></div>
                          <div className="text-[10px] font-semibold text-gray-800 truncate">{color.stackName}</div>
                          <div className="text-[9px] text-gray-500">{color.colorName}</div>
                          <div className="text-[9px] text-gray-500">L*={color.L} C={color.C} h={color.h}°</div>
                        </div>
                      );
                    })}
                    {colorCompareSelected.includes('experimental') && experimentalColorData && (
                      <div className="text-center">
                        <div className="w-full h-12 rounded border-2 border-red-400 shadow-sm mb-1" style={{ backgroundColor: experimentalColorData.rgb }} title={experimentalColorData.hex}></div>
                        <div className="text-[10px] font-semibold text-gray-800 truncate">Experimental</div>
                        <div className="text-[9px] text-gray-500">{experimentalColorData.colorName}</div>
                        <div className="text-[9px] text-gray-500">L*={experimentalColorData.L} C={experimentalColorData.C} h={experimentalColorData.h}°</div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* ΔE Pairwise Comparisons */}
              {(() => {
                const selectedStacks = colorCompareSelected.filter(id => id !== 'experimental');
                const includeExp = colorCompareSelected.includes('experimental') && experimentalColorData;
                const allItems = [
                  ...selectedStacks.map(id => ({ id, data: stackColorData[id], label: stackColorData[id]?.stackName, type: 'stack' })),
                  ...(includeExp ? [{ id: 'experimental', data: { L: experimentalColorData.L, a_star: experimentalColorData.a_star, b_star: experimentalColorData.b_star, rgb: experimentalColorData.rgb, stackColor: '#ef4444' }, label: 'Experimental', type: 'experimental' }] : []),
                ].filter(item => item.data);

                if (allItems.length < 2) return (
                  <div className="text-center py-6 text-gray-400 text-sm">
                    Select at least 2 stacks to compare
                  </div>
                );

                const comparisons = [];
                for (let i = 0; i < allItems.length; i++) {
                  for (let j = i + 1; j < allItems.length; j++) {
                    const c1 = allItems[i].data;
                    const c2 = allItems[j].data;
                    const dL = parseFloat(c1.L) - parseFloat(c2.L);
                    const da = parseFloat(c1.a_star) - parseFloat(c2.a_star);
                    const db = parseFloat(c1.b_star) - parseFloat(c2.b_star);
                    const deltaE = Math.sqrt(dL * dL + da * da + db * db);
                    comparisons.push({
                      name1: allItems[i].label, name2: allItems[j].label,
                      rgb1: c1.rgb, rgb2: c2.rgb,
                      isExp: allItems[i].type === 'experimental' || allItems[j].type === 'experimental',
                      deltaE, dL: dL.toFixed(2), da: da.toFixed(2), db: db.toFixed(2),
                    });
                  }
                }
                comparisons.sort((a, b) => a.deltaE - b.deltaE);

                return (
                  <div>
                    <div className="text-xs font-semibold text-gray-700 mb-2">ΔE* Pairwise Comparisons ({comparisons.length})</div>
                    <div className="space-y-2">
                      {comparisons.map((comp, idx) => (
                        <div key={idx} className={`p-2 rounded border ${comp.isExp ? 'border-red-200 bg-red-50' : 'border-gray-200 bg-gray-50'}`}>
                          <div className="flex items-center gap-2 mb-1">
                            <div className="flex items-center gap-1 flex-1 min-w-0">
                              <div className="w-6 h-6 rounded border border-gray-300 flex-shrink-0" style={{ backgroundColor: comp.rgb1 }}></div>
                              <span className="text-xs font-medium text-gray-800 truncate">{comp.name1}</span>
                            </div>
                            <span className="text-xs text-gray-400 flex-shrink-0">vs</span>
                            <div className="flex items-center gap-1 flex-1 min-w-0">
                              <div className="w-6 h-6 rounded border border-gray-300 flex-shrink-0" style={{ backgroundColor: comp.rgb2 }}></div>
                              <span className="text-xs font-medium text-gray-800 truncate">{comp.name2}</span>
                            </div>
                            <div className={`text-sm font-bold flex-shrink-0 ${comp.deltaE < 1 ? "text-green-600" : comp.deltaE < 2 ? "text-yellow-600" : comp.deltaE < 3 ? "text-orange-600" : "text-red-600"}`}>
                              ΔE* = {comp.deltaE.toFixed(2)}
                            </div>
                          </div>
                          <div className="flex items-center gap-3 text-[9px] text-gray-500">
                            <span>ΔL*={comp.dL}</span>
                            <span>Δa*={comp.da}</span>
                            <span>Δb*={comp.db}</span>
                            <span className="ml-auto font-medium" style={{ color: comp.deltaE < 1 ? theme.success : comp.deltaE < 2 ? theme.warning : comp.deltaE < 3 ? (darkMode ? '#fb923c' : '#ea580c') : theme.error }}>
                              {comp.deltaE < 0.5 ? "Imperceptible" : comp.deltaE < 1 ? "Slight" : comp.deltaE < 2 ? "Noticeable" : comp.deltaE < 3 ? "Visible" : comp.deltaE < 5 ? "Significant" : "Large"}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}

              {/* ΔE Guide */}
              <div className="bg-blue-50 rounded p-2 border border-blue-200">
                <div className="text-xs font-semibold text-blue-800 mb-1">ΔE* Perception Guide</div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-[10px] text-gray-700">
                  <div className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500 flex-shrink-0"></span> &lt;0.5: Imperceptible</div>
                  <div className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500 flex-shrink-0"></span> 0.5–1: Expert eye only</div>
                  <div className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-yellow-500 flex-shrink-0"></span> 1–2: Careful observation</div>
                  <div className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-orange-500 flex-shrink-0"></span> 2–3: Casual observation</div>
                  <div className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500 flex-shrink-0"></span> 3–5: Obviously different</div>
                  <div className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-700 flex-shrink-0"></span> &gt;5: Very different</div>
                </div>
              </div>
            </div>

            <div className="flex justify-end mt-3 pt-3 border-t flex-shrink-0">
              <button onClick={() => setShowColorCompareModal(false)} className="px-4 py-1.5 bg-gray-200 text-gray-700 rounded hover:bg-gray-300 text-xs">
                Close
              </button>
            </div>
          </div>
        </div>
      )}


      {/* ========== MATERIAL LIBRARY MODAL ========== */}
      {showMaterialLibrary && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-4 w-[420px] max-h-[80vh] flex flex-col">
            <div className="flex justify-between items-center mb-3 flex-shrink-0">
              <h2 className="text-base font-bold text-gray-800 flex items-center gap-2">
                <Library size={18} /> Material Library
              </h2>
              <button onClick={() => setShowMaterialLibrary(false)} className="text-gray-500 hover:text-gray-700">
                <X size={18} />
              </button>
            </div>

            <div className="overflow-y-auto flex-1 space-y-2 min-h-0">
              {/* Built-in Materials — collapsed by default */}
              <details className="border rounded">
                <summary className="px-3 py-2 cursor-pointer select-none text-sm font-semibold text-gray-600 hover:bg-gray-50 rounded">
                  Built-in Materials ({Object.keys(materialDispersion).length})
                </summary>
                <div className="px-2 pb-2 grid grid-cols-2 gap-1">
                  {Object.keys(materialDispersion).map((name) => {
                    const mat = materialDispersion[name];
                    const n550 = getRefractiveIndex(name, 550);
                    return (
                      <div key={name} className="flex items-center gap-1 px-2 py-1 border rounded text-xs" style={{ backgroundColor: getMaterialBg(mat.color) }}>
                        <Lock size={10} className="text-gray-400 flex-shrink-0" />
                        <span className="font-medium truncate">{name}</span>
                        <span className="text-gray-500 ml-auto flex-shrink-0">{n550.toFixed(3)}</span>
                      </div>
                    );
                  })}
                </div>
              </details>

              {/* Custom Materials — always visible */}
              <div className="border rounded px-3 py-2">
                <h3 className="text-sm font-semibold text-gray-600 mb-1">Custom Materials</h3>
                {Object.keys(customMaterials).length === 0 ? (
                  <p className="text-xs text-gray-400 italic">No custom materials yet.</p>
                ) : (
                  <div className="space-y-1">
                    {Object.keys(customMaterials).map((name) => {
                      const mat = customMaterials[name];
                      const n550 = getRefractiveIndex(name, 550);
                      return (
                        <div key={name} className="flex items-center justify-between px-2 py-1 border rounded text-xs" style={{ backgroundColor: getMaterialBg(mat.color) }}>
                          <div className="min-w-0">
                            <span className="font-medium">{name}</span>
                            <span className="text-gray-500 ml-1">{mat.type} | n: {n550.toFixed(3)}</span>
                          </div>
                          <button onClick={() => deleteCustomMaterial(name)} className="p-0.5 hover:bg-red-100 rounded text-red-500 flex-shrink-0" title="Delete">
                            <Trash2 size={12} />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Add New Material — collapsible */}
              <details className="border rounded" open>
                <summary className="px-3 py-2 cursor-pointer select-none text-sm font-semibold text-gray-700 hover:bg-gray-50 rounded">
                  Add New Material
                </summary>
                <div className="px-3 pb-3 space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-xs text-gray-600 mb-0.5">Name</label>
                      <input
                        type="text"
                        value={newMaterialForm.name}
                        onChange={(e) => setNewMaterialForm({ ...newMaterialForm, name: e.target.value })}
                        className="w-full px-2 py-1 border rounded text-xs"
                        placeholder="e.g. MyMaterial"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-600 mb-0.5">Mode</label>
                      <select
                        value={newMaterialForm.mode}
                        onChange={(e) => setNewMaterialForm({ ...newMaterialForm, mode: e.target.value })}
                        className="w-full px-2 py-1 border rounded text-xs bg-white"
                      >
                        <option value="simple">Simple (constant n, k)</option>
                        <option value="advanced">Advanced (dispersion)</option>
                        <option value="tabular">Tabular n,k (measured data)</option>
                      </select>
                    </div>
                  </div>

                  {newMaterialForm.mode === 'simple' && (
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-xs text-gray-600 mb-0.5">Refractive Index (n)</label>
                        <input
                          type="number"
                          value={newMaterialForm.n}
                          onChange={(e) => setNewMaterialForm({ ...newMaterialForm, n: parseFloat(e.target.value) || 1.5 })}
                          className="w-full px-2 py-1 border rounded text-xs"
                          step="0.01" min="1" max="5"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-600 mb-0.5">Extinction Coeff. (k)</label>
                        <input
                          type="number"
                          value={newMaterialForm.k}
                          onChange={(e) => setNewMaterialForm({ ...newMaterialForm, k: parseFloat(e.target.value) || 0 })}
                          className="w-full px-2 py-1 border rounded text-xs"
                          step="0.001" min="0" max="1"
                        />
                      </div>
                    </div>
                  )}

                  {newMaterialForm.mode === 'advanced' && (
                    <div className="space-y-2">
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="block text-xs text-gray-600 mb-0.5">Dispersion Model</label>
                          <select
                            value={newMaterialForm.dispersionType}
                            onChange={(e) => setNewMaterialForm({ ...newMaterialForm, dispersionType: e.target.value })}
                            className="w-full px-2 py-1 border rounded text-xs bg-white"
                          >
                            <option value="cauchy">Cauchy</option>
                            <option value="sellmeier">Sellmeier</option>
                            <option value="tauc-lorentz">Tauc-Lorentz (amorphous oxides)</option>
                            <option value="cody-lorentz">Cody-Lorentz (TL + Urbach tail)</option>
                            <option value="lorentz">Lorentz / Drude-Lorentz (metals)</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs text-gray-600 mb-0.5">Absorption Model</label>
                          {(() => {
                            const builtIn = newMaterialForm.dispersionType === 'tauc-lorentz' || newMaterialForm.dispersionType === 'lorentz' || newMaterialForm.dispersionType === 'cody-lorentz';
                            return (
                              <select
                                value={builtIn ? 'builtin' : newMaterialForm.kType}
                                onChange={(e) => setNewMaterialForm({ ...newMaterialForm, kType: e.target.value })}
                                className="w-full px-2 py-1 border rounded text-xs bg-white"
                                disabled={builtIn}
                              >
                                {builtIn && <option value="builtin">Built-in (model includes k)</option>}
                                <option value="none">None (transparent)</option>
                                <option value="constant">Constant k</option>
                                <option value="urbach">Urbach Tail</option>
                              </select>
                            );
                          })()}
                        </div>
                      </div>

                      {newMaterialForm.dispersionType === 'cauchy' && (
                        <div className="grid grid-cols-3 gap-1">
                          <div>
                            <label className="block text-xs text-gray-600 mb-0.5">A</label>
                            <input type="number" value={newMaterialForm.A} onChange={(e) => setNewMaterialForm({ ...newMaterialForm, A: parseFloat(e.target.value) || 0 })} className="w-full px-1.5 py-1 border rounded text-xs" step="0.01" />
                          </div>
                          <div>
                            <label className="block text-xs text-gray-600 mb-0.5">B</label>
                            <input type="number" value={newMaterialForm.B} onChange={(e) => setNewMaterialForm({ ...newMaterialForm, B: parseFloat(e.target.value) || 0 })} className="w-full px-1.5 py-1 border rounded text-xs" step="0.001" />
                          </div>
                          <div>
                            <label className="block text-xs text-gray-600 mb-0.5">C</label>
                            <input type="number" value={newMaterialForm.C} onChange={(e) => setNewMaterialForm({ ...newMaterialForm, C: parseFloat(e.target.value) || 0 })} className="w-full px-1.5 py-1 border rounded text-xs" step="0.00001" />
                          </div>
                        </div>
                      )}

                      {newMaterialForm.dispersionType === 'sellmeier' && (
                        <div className="grid grid-cols-3 gap-1">
                          <div>
                            <label className="block text-xs text-gray-600 mb-0.5">B1</label>
                            <input type="number" value={newMaterialForm.B1} onChange={(e) => setNewMaterialForm({ ...newMaterialForm, B1: parseFloat(e.target.value) || 0 })} className="w-full px-1.5 py-1 border rounded text-xs" step="0.01" />
                          </div>
                          <div>
                            <label className="block text-xs text-gray-600 mb-0.5">B2</label>
                            <input type="number" value={newMaterialForm.B2} onChange={(e) => setNewMaterialForm({ ...newMaterialForm, B2: parseFloat(e.target.value) || 0 })} className="w-full px-1.5 py-1 border rounded text-xs" step="0.01" />
                          </div>
                          <div>
                            <label className="block text-xs text-gray-600 mb-0.5">B3</label>
                            <input type="number" value={newMaterialForm.B3} onChange={(e) => setNewMaterialForm({ ...newMaterialForm, B3: parseFloat(e.target.value) || 0 })} className="w-full px-1.5 py-1 border rounded text-xs" step="0.01" />
                          </div>
                          <div>
                            <label className="block text-xs text-gray-600 mb-0.5">C1</label>
                            <input type="number" value={newMaterialForm.C1} onChange={(e) => setNewMaterialForm({ ...newMaterialForm, C1: parseFloat(e.target.value) || 0 })} className="w-full px-1.5 py-1 border rounded text-xs" step="0.01" />
                          </div>
                          <div>
                            <label className="block text-xs text-gray-600 mb-0.5">C2</label>
                            <input type="number" value={newMaterialForm.C2} onChange={(e) => setNewMaterialForm({ ...newMaterialForm, C2: parseFloat(e.target.value) || 0 })} className="w-full px-1.5 py-1 border rounded text-xs" step="0.01" />
                          </div>
                          <div>
                            <label className="block text-xs text-gray-600 mb-0.5">C3</label>
                            <input type="number" value={newMaterialForm.C3} onChange={(e) => setNewMaterialForm({ ...newMaterialForm, C3: parseFloat(e.target.value) || 0 })} className="w-full px-1.5 py-1 border rounded text-xs" step="0.1" />
                          </div>
                        </div>
                      )}

                      {newMaterialForm.dispersionType === 'tauc-lorentz' && (
                        <>
                          <div className="text-[11px] text-gray-600 bg-blue-50 border border-blue-200 rounded px-2 py-1.5">
                            Jellison-Modine Tauc-Lorentz (1996). Industry standard for amorphous oxides (TiO2, HfO2, Ta2O5, Nb2O5). Absorption is built-in. Typical TiO2: A=100, E₀=4.2, C=2.2, Eg=3.2, ε∞=2.2.
                          </div>
                          <div className="grid grid-cols-5 gap-1">
                            <div>
                              <label className="block text-xs text-gray-600 mb-0.5" title="Oscillator amplitude (eV)">A (eV)</label>
                              <input type="number" value={newMaterialForm.tlA} onChange={(e) => setNewMaterialForm({ ...newMaterialForm, tlA: parseFloat(e.target.value) || 0 })} className="w-full px-1.5 py-1 border rounded text-xs" step="1" min="0" />
                            </div>
                            <div>
                              <label className="block text-xs text-gray-600 mb-0.5" title="Peak energy (eV)">E₀ (eV)</label>
                              <input type="number" value={newMaterialForm.tlE0} onChange={(e) => setNewMaterialForm({ ...newMaterialForm, tlE0: parseFloat(e.target.value) || 0 })} className="w-full px-1.5 py-1 border rounded text-xs" step="0.1" min="0.1" />
                            </div>
                            <div>
                              <label className="block text-xs text-gray-600 mb-0.5" title="Broadening (eV)">C (eV)</label>
                              <input type="number" value={newMaterialForm.tlC} onChange={(e) => setNewMaterialForm({ ...newMaterialForm, tlC: parseFloat(e.target.value) || 0 })} className="w-full px-1.5 py-1 border rounded text-xs" step="0.1" min="0.01" />
                            </div>
                            <div>
                              <label className="block text-xs text-gray-600 mb-0.5" title="Bandgap (eV)">Eg (eV)</label>
                              <input type="number" value={newMaterialForm.tlEg} onChange={(e) => setNewMaterialForm({ ...newMaterialForm, tlEg: parseFloat(e.target.value) || 0 })} className="w-full px-1.5 py-1 border rounded text-xs" step="0.1" min="0" />
                            </div>
                            <div>
                              <label className="block text-xs text-gray-600 mb-0.5" title="High-frequency dielectric constant">ε∞</label>
                              <input type="number" value={newMaterialForm.tlEpsInf} onChange={(e) => setNewMaterialForm({ ...newMaterialForm, tlEpsInf: parseFloat(e.target.value) || 1 })} className="w-full px-1.5 py-1 border rounded text-xs" step="0.1" min="1" />
                            </div>
                          </div>
                          {(() => {
                            const preview = taucLorentzNK(550, { A: newMaterialForm.tlA, E0: newMaterialForm.tlE0, C: newMaterialForm.tlC, Eg: newMaterialForm.tlEg, epsInf: newMaterialForm.tlEpsInf });
                            return (
                              <div className="text-[11px] text-gray-700 bg-green-50 border border-green-200 rounded px-2 py-1.5">
                                Preview at 550nm: n = {preview.n.toFixed(3)}, k = {preview.k.toExponential(2)}
                              </div>
                            );
                          })()}
                        </>
                      )}

                      {newMaterialForm.dispersionType === 'cody-lorentz' && (
                        <>
                          <div className="text-[11px] text-gray-600 bg-blue-50 border border-blue-200 rounded px-2 py-1.5">
                            Cody-Lorentz extends Tauc-Lorentz with an Urbach tail below Eg. Best for HfO2, Ta2O5, Nb2O5 where sub-gap defect absorption matters. Eu=0 reduces to Tauc-Lorentz. Typical Eu: 0.05–0.2 eV.
                          </div>
                          <div className="grid grid-cols-6 gap-1">
                            <div>
                              <label className="block text-xs text-gray-600 mb-0.5" title="Oscillator amplitude (eV)">A</label>
                              <input type="number" value={newMaterialForm.clA} onChange={(e) => setNewMaterialForm({ ...newMaterialForm, clA: parseFloat(e.target.value) || 0 })} className="w-full px-1.5 py-1 border rounded text-xs" step="1" min="0" />
                            </div>
                            <div>
                              <label className="block text-xs text-gray-600 mb-0.5" title="Peak energy (eV)">E₀</label>
                              <input type="number" value={newMaterialForm.clE0} onChange={(e) => setNewMaterialForm({ ...newMaterialForm, clE0: parseFloat(e.target.value) || 0 })} className="w-full px-1.5 py-1 border rounded text-xs" step="0.1" min="0.1" />
                            </div>
                            <div>
                              <label className="block text-xs text-gray-600 mb-0.5" title="Broadening (eV)">C</label>
                              <input type="number" value={newMaterialForm.clC} onChange={(e) => setNewMaterialForm({ ...newMaterialForm, clC: parseFloat(e.target.value) || 0 })} className="w-full px-1.5 py-1 border rounded text-xs" step="0.1" min="0.01" />
                            </div>
                            <div>
                              <label className="block text-xs text-gray-600 mb-0.5" title="Bandgap (eV)">Eg</label>
                              <input type="number" value={newMaterialForm.clEg} onChange={(e) => setNewMaterialForm({ ...newMaterialForm, clEg: parseFloat(e.target.value) || 0 })} className="w-full px-1.5 py-1 border rounded text-xs" step="0.1" min="0" />
                            </div>
                            <div>
                              <label className="block text-xs text-gray-600 mb-0.5" title="High-frequency ε">ε∞</label>
                              <input type="number" value={newMaterialForm.clEpsInf} onChange={(e) => setNewMaterialForm({ ...newMaterialForm, clEpsInf: parseFloat(e.target.value) || 1 })} className="w-full px-1.5 py-1 border rounded text-xs" step="0.1" min="1" />
                            </div>
                            <div>
                              <label className="block text-xs text-gray-600 mb-0.5" title="Urbach width (eV)">Eu</label>
                              <input type="number" value={newMaterialForm.clEu} onChange={(e) => setNewMaterialForm({ ...newMaterialForm, clEu: parseFloat(e.target.value) || 0 })} className="w-full px-1.5 py-1 border rounded text-xs" step="0.01" min="0" />
                            </div>
                          </div>
                          {(() => {
                            const preview = codyLorentzNK(550, { A: newMaterialForm.clA, E0: newMaterialForm.clE0, C: newMaterialForm.clC, Eg: newMaterialForm.clEg, epsInf: newMaterialForm.clEpsInf, Eu: newMaterialForm.clEu });
                            return (
                              <div className="text-[11px] text-gray-700 bg-green-50 border border-green-200 rounded px-2 py-1.5">
                                Preview at 550nm: n = {preview.n.toFixed(3)}, k = {preview.k.toExponential(2)}
                              </div>
                            );
                          })()}
                        </>
                      )}

                      {newMaterialForm.dispersionType === 'lorentz' && (
                        <>
                          <div className="text-[11px] text-gray-600 bg-blue-50 border border-blue-200 rounded px-2 py-1.5">
                            Multi-oscillator Lorentz model. For a <b>Drude</b> (free-electron) term, set E₀ = 0. Standard for metals (Au, Ag, Al) and materials with known absorption peaks. Oscillator: A/(E₀² − E² − i·γ·E).
                          </div>
                          <div className="flex items-center gap-2">
                            <div className="w-24">
                              <label className="block text-xs text-gray-600 mb-0.5">ε∞</label>
                              <input type="number" value={newMaterialForm.lzEpsInf} onChange={(e) => setNewMaterialForm({ ...newMaterialForm, lzEpsInf: parseFloat(e.target.value) || 1 })} className="w-full px-1.5 py-1 border rounded text-xs" step="0.1" min="1" />
                            </div>
                            <button
                              onClick={() => {
                                if (newMaterialForm.lzOscillators.length >= 8) return;
                                setNewMaterialForm({ ...newMaterialForm, lzOscillators: [...newMaterialForm.lzOscillators, { A: 1.0, E0: 4.0, gamma: 0.5 }] });
                              }}
                              className="ml-auto px-2 py-1 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded text-xs text-indigo-700"
                              disabled={newMaterialForm.lzOscillators.length >= 8}
                            >
                              + Add oscillator
                            </button>
                          </div>
                          <div className="space-y-1">
                            {newMaterialForm.lzOscillators.map((osc, idx) => (
                              <div key={idx} className="grid grid-cols-[1fr_1fr_1fr_auto] gap-1 items-end">
                                <div>
                                  {idx === 0 && <label className="block text-[10px] text-gray-600">A (eV²)</label>}
                                  <input type="number" value={osc.A} onChange={(e) => {
                                    const next = [...newMaterialForm.lzOscillators];
                                    next[idx] = { ...next[idx], A: parseFloat(e.target.value) || 0 };
                                    setNewMaterialForm({ ...newMaterialForm, lzOscillators: next });
                                  }} className="w-full px-1.5 py-1 border rounded text-xs" step="0.1" />
                                </div>
                                <div>
                                  {idx === 0 && <label className="block text-[10px] text-gray-600">E₀ (eV, 0=Drude)</label>}
                                  <input type="number" value={osc.E0} onChange={(e) => {
                                    const next = [...newMaterialForm.lzOscillators];
                                    next[idx] = { ...next[idx], E0: parseFloat(e.target.value) || 0 };
                                    setNewMaterialForm({ ...newMaterialForm, lzOscillators: next });
                                  }} className="w-full px-1.5 py-1 border rounded text-xs" step="0.1" min="0" />
                                </div>
                                <div>
                                  {idx === 0 && <label className="block text-[10px] text-gray-600">γ (eV)</label>}
                                  <input type="number" value={osc.gamma} onChange={(e) => {
                                    const next = [...newMaterialForm.lzOscillators];
                                    next[idx] = { ...next[idx], gamma: parseFloat(e.target.value) || 0 };
                                    setNewMaterialForm({ ...newMaterialForm, lzOscillators: next });
                                  }} className="w-full px-1.5 py-1 border rounded text-xs" step="0.01" min="0" />
                                </div>
                                <button
                                  onClick={() => {
                                    if (newMaterialForm.lzOscillators.length <= 1) return;
                                    setNewMaterialForm({ ...newMaterialForm, lzOscillators: newMaterialForm.lzOscillators.filter((_, i) => i !== idx) });
                                  }}
                                  className="p-1 bg-red-50 hover:bg-red-100 border border-red-200 rounded text-red-600 text-xs disabled:opacity-30"
                                  disabled={newMaterialForm.lzOscillators.length <= 1}
                                  title="Remove oscillator"
                                >
                                  ×
                                </button>
                              </div>
                            ))}
                          </div>
                          {(() => {
                            const preview = drudeLorentzNK(550, { epsInf: newMaterialForm.lzEpsInf, oscillators: newMaterialForm.lzOscillators });
                            return (
                              <div className="text-[11px] text-gray-700 bg-green-50 border border-green-200 rounded px-2 py-1.5">
                                Preview at 550nm: n = {preview.n.toFixed(3)}, k = {preview.k.toExponential(2)}
                              </div>
                            );
                          })()}
                        </>
                      )}

                      {newMaterialForm.kType === 'constant' && (
                        <div className="w-1/3">
                          <label className="block text-xs text-gray-600 mb-0.5">k value</label>
                          <input type="number" value={newMaterialForm.kValue} onChange={(e) => setNewMaterialForm({ ...newMaterialForm, kValue: parseFloat(e.target.value) || 0 })} className="w-full px-1.5 py-1 border rounded text-xs" step="0.001" min="0" max="1" />
                        </div>
                      )}

                      {newMaterialForm.kType === 'urbach' && (
                        <div className="grid grid-cols-3 gap-1">
                          <div>
                            <label className="block text-xs text-gray-600 mb-0.5">k0</label>
                            <input type="number" value={newMaterialForm.k0} onChange={(e) => setNewMaterialForm({ ...newMaterialForm, k0: parseFloat(e.target.value) || 0 })} className="w-full px-1.5 py-1 border rounded text-xs" step="0.01" min="0" />
                          </div>
                          <div>
                            <label className="block text-xs text-gray-600 mb-0.5">Edge (nm)</label>
                            <input type="number" value={newMaterialForm.kEdge} onChange={(e) => setNewMaterialForm({ ...newMaterialForm, kEdge: parseFloat(e.target.value) || 0 })} className="w-full px-1.5 py-1 border rounded text-xs" step="10" min="100" max="1000" />
                          </div>
                          <div>
                            <label className="block text-xs text-gray-600 mb-0.5">Decay</label>
                            <input type="number" value={newMaterialForm.kDecay} onChange={(e) => setNewMaterialForm({ ...newMaterialForm, kDecay: parseFloat(e.target.value) || 0 })} className="w-full px-1.5 py-1 border rounded text-xs" step="0.001" min="0" />
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {newMaterialForm.mode === 'tabular' && (
                    <div className="space-y-2">
                      <div className="text-[11px] text-gray-600 bg-blue-50 border border-blue-200 rounded px-2 py-1.5">
                        Paste or upload measured n,k data. Format: <code>wavelength n k</code> per line (comma, tab, or space separated). Wavelength in nm (or μm — auto-detected). Lines starting with <code>#</code> are ignored (YAML headers, CSV headers OK).
                      </div>
                      <div className="text-[11px] text-gray-600 bg-gray-50 border border-gray-200 rounded px-2 py-1.5 flex items-center gap-2">
                        <span className="font-semibold">Need data?</span>
                        <a
                          href="https://refractiveindex.info/"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-indigo-600 hover:text-indigo-800 underline"
                        >
                          Browse RefractiveIndex.info →
                        </a>
                        <span className="text-gray-500">Open a material page, click <em>Tabulated Data</em> → <em>Download</em>, then paste the file contents below.</span>
                      </div>
                      <div className="flex gap-2 items-center">
                        <label className="flex-1 cursor-pointer inline-flex items-center justify-center gap-1 px-2 py-1 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded text-xs text-indigo-700 font-medium">
                          <Upload size={12} />
                          Upload file (.csv, .txt, .nk, .dat)
                          <input
                            type="file"
                            accept=".csv,.txt,.nk,.dat,.tsv"
                            className="hidden"
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (!file) return;
                              const reader = new FileReader();
                              reader.onload = (ev) => {
                                const text = String(ev.target?.result || '');
                                const parsed = parseNkTable(text);
                                setNewMaterialForm(prev => ({
                                  ...prev,
                                  tabularText: text,
                                  tabularData: parsed,
                                  tabularError: parsed.length === 0 ? 'No valid data rows found. Check format.' : '',
                                  kkResult: null,
                                }));
                              };
                              reader.readAsText(file);
                              e.target.value = '';
                            }}
                          />
                        </label>
                        <button
                          onClick={() => {
                            setNewMaterialForm(prev => ({ ...prev, tabularText: '', tabularData: [], tabularError: '', kkResult: null }));
                          }}
                          className="px-2 py-1 bg-gray-100 hover:bg-gray-200 border rounded text-xs text-gray-700"
                          disabled={newMaterialForm.tabularData.length === 0}
                        >
                          Clear
                        </button>
                      </div>
                      <textarea
                        value={newMaterialForm.tabularText}
                        onChange={(e) => {
                          const text = e.target.value;
                          const parsed = parseNkTable(text);
                          setNewMaterialForm(prev => ({
                            ...prev,
                            tabularText: text,
                            tabularData: parsed,
                            tabularError: text.trim() && parsed.length === 0 ? 'No valid data rows found. Check format.' : '',
                            kkResult: null,
                          }));
                        }}
                        className="w-full px-2 py-1 border rounded text-[11px] font-mono"
                        rows={6}
                        placeholder={"# wavelength(nm)  n       k\n380  2.601  0.0012\n400  2.552  0.0008\n450  2.480  0.0003\n500  2.430  0.0001\n550  2.395  0.00005\n600  2.370  0.00002"}
                      />
                      {newMaterialForm.tabularError && (
                        <div className="text-xs text-red-600">{newMaterialForm.tabularError}</div>
                      )}
                      {newMaterialForm.tabularData.length > 0 && (
                        <div className="text-[11px] text-gray-700 bg-green-50 border border-green-200 rounded px-2 py-1.5">
                          <span className="font-semibold text-green-700">✓ Parsed {newMaterialForm.tabularData.length} points.</span>
                          {' '}Range: {newMaterialForm.tabularData[0][0].toFixed(1)}–{newMaterialForm.tabularData[newMaterialForm.tabularData.length-1][0].toFixed(1)} nm.
                          {' '}n@550: {interpolateNk(newMaterialForm.tabularData, 550).n.toFixed(3)},
                          {' '}k@550: {interpolateNk(newMaterialForm.tabularData, 550).k.toExponential(2)}
                        </div>
                      )}
                      {newMaterialForm.tabularData.length >= 5 && (
                        <div className="flex items-start gap-2">
                          <button
                            onClick={() => {
                              const result = validateKK(newMaterialForm.tabularData);
                              setNewMaterialForm(prev => ({ ...prev, kkResult: result }));
                            }}
                            className="px-2 py-1 bg-amber-50 hover:bg-amber-100 border border-amber-300 rounded text-xs text-amber-800 font-medium"
                            title="Check whether the n and k columns are Kramers-Kronig consistent (i.e., physically causal)."
                          >
                            Check KK consistency
                          </button>
                          {newMaterialForm.kkResult && newMaterialForm.kkResult.valid && (() => {
                            const { correlation, relativeError } = newMaterialForm.kkResult;
                            const ok = correlation > 0.9 && relativeError < 0.3;
                            const warn = correlation > 0.7 && correlation <= 0.9;
                            const bg = ok ? 'bg-green-50 border-green-200 text-green-800' : warn ? 'bg-amber-50 border-amber-200 text-amber-800' : 'bg-red-50 border-red-200 text-red-800';
                            const label = ok ? '✓ KK-consistent' : warn ? '⚠ Borderline' : '✗ Likely inconsistent';
                            return (
                              <div className={`flex-1 text-[11px] border rounded px-2 py-1 ${bg}`}>
                                <div><b>{label}</b> — shape correlation: {(correlation * 100).toFixed(1)}%, relative RMS error: {(relativeError * 100).toFixed(1)}%</div>
                                <div className="text-[10px] mt-0.5 opacity-80">Absolute-offset mismatch is normal due to finite wavelength range. Correlation &gt; 90% means n and k shapes are causally linked.</div>
                              </div>
                            );
                          })()}
                          {newMaterialForm.kkResult && !newMaterialForm.kkResult.valid && (
                            <div className="flex-1 text-[11px] bg-gray-50 border border-gray-200 rounded px-2 py-1 text-gray-700">
                              {newMaterialForm.kkResult.message}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label className="block text-xs text-gray-600 mb-0.5">Color</label>
                      <input
                        type="color"
                        value={newMaterialForm.color}
                        onChange={(e) => setNewMaterialForm({ ...newMaterialForm, color: e.target.value })}
                        className="w-full h-7 border rounded cursor-pointer"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-600 mb-0.5">IAD (%)</label>
                      <input
                        type="number"
                        value={newMaterialForm.iadIncrease}
                        onChange={(e) => setNewMaterialForm({ ...newMaterialForm, iadIncrease: parseFloat(e.target.value) || 0 })}
                        className="w-full px-1.5 py-1 border rounded text-xs"
                        step="0.5" min="0" max="10"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-600 mb-0.5">Stress (MPa)</label>
                      <input
                        type="number"
                        value={newMaterialForm.stress}
                        onChange={(e) => setNewMaterialForm({ ...newMaterialForm, stress: parseFloat(e.target.value) || 0 })}
                        className="w-full px-1.5 py-1 border rounded text-xs"
                        step="10"
                      />
                    </div>
                  </div>

                  <button
                    onClick={addCustomMaterial}
                    className="w-full py-1.5 bg-indigo-600 text-white rounded hover:bg-indigo-700 text-xs font-semibold"
                  >
                    Add Material
                  </button>
                </div>
              </details>
            </div>

            <button
              onClick={() => setShowMaterialLibrary(false)}
              className="mt-3 w-full bg-gray-200 py-1.5 rounded hover:bg-gray-300 flex-shrink-0 text-sm"
            >
              Done
            </button>
          </div>
        </div>
      )}

      {/* ========== COATING STRESS CALCULATOR MODAL ========== */}
      {showStressModal && stressResults && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto">
            {/* Modal Header */}
            <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex justify-between items-center">
              <h2 className="text-xl font-bold text-gray-800">
                Coating Stress Analysis
              </h2>
              <button
                onClick={() => setShowStressModal(false)}
                className="text-gray-500 hover:text-gray-700 text-2xl leading-none"
              >
                ×
              </button>
            </div>

            {/* Modal Content */}
            <div className="p-6">
              {/* Summary Cards */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
                <div className="bg-gray-50 rounded-lg p-4">
                  <div className="text-sm text-gray-600 mb-1">Total Stress</div>
                  <div className="text-2xl font-bold text-gray-900">
                    {stressResults.totalStress}{" "}
                    <span className="text-sm font-normal">MPa·nm</span>
                  </div>
                  <div className="text-xs text-gray-500 mt-1">
                    {parseFloat(stressResults.totalStress) > 0
                      ? "Compressive"
                      : "Tensile"}
                  </div>
                </div>

                <div className="bg-gray-50 rounded-lg p-4">
                  <div className="text-sm text-gray-600 mb-1">Risk Level</div>
                  <div
                    className="text-2xl font-bold"
                    style={{ color: stressResults.riskColor }}
                  >
                    {stressResults.riskLevel}
                  </div>
                  <div className="text-xs text-gray-500 mt-1">
                    {stressResults.totalStressMagnitude} MPa·nm
                  </div>
                </div>

                <div className="bg-gray-50 rounded-lg p-4">
                  <div className="text-sm text-gray-600 mb-1">
                    Total Thickness
                  </div>
                  <div className="text-2xl font-bold text-gray-900">
                    {stressResults.totalPhysicalThickness}{" "}
                    <span className="text-sm font-normal">nm</span>
                  </div>
                  <div className="text-xs text-gray-500 mt-1">Physical</div>
                </div>

                <div className="bg-gray-50 rounded-lg p-4">
                  <div className="text-sm text-gray-600 mb-1">
                    Optical Thickness
                  </div>
                  <div className="text-2xl font-bold text-gray-900">
                    {stressResults.totalOpticalThickness}{" "}
                    <span className="text-sm font-normal">nm</span>
                  </div>
                  <div className="text-xs text-gray-500 mt-1">QWOT basis</div>
                </div>
              </div>

              {/* Recommendation Box */}
              <div
                className="rounded-lg p-4 mb-6 border-2"
                style={{
                  backgroundColor:
                    stressResults.riskLevel === "LOW"
                      ? "#f0fdf4"
                      : stressResults.riskLevel === "MEDIUM"
                      ? "#fffbeb"
                      : "#fef2f2",
                  borderColor: stressResults.riskColor,
                }}
              >
                <div
                  className="font-semibold mb-2"
                  style={{ color: stressResults.riskColor }}
                >
                  Recommendation:
                </div>
                <div className="text-sm text-gray-700">
                  {stressResults.recommendation}
                </div>
              </div>

              {/* Layer-by-Layer Table */}
              <div className="mb-6">
                <h3 className="text-lg font-semibold text-gray-800 mb-3">
                  Layer-by-Layer Analysis
                </h3>
                <div className="overflow-x-auto">
                  <table className="min-w-full border border-gray-200 text-sm">
                    <thead className="bg-gray-100">
                      <tr>
                        <th className="px-4 py-2 text-left border-b">#</th>
                        <th className="px-4 py-2 text-left border-b">
                          Material
                        </th>
                        <th className="px-4 py-2 text-right border-b">
                          Thickness (nm)
                        </th>
                        <th className="px-4 py-2 text-right border-b">
                          Intrinsic Stress (MPa)
                        </th>
                        <th className="px-4 py-2 text-center border-b">Type</th>
                        <th className="px-4 py-2 text-right border-b">
                          Stress Force (MPa·nm)
                        </th>
                        <th className="px-4 py-2 text-right border-b">
                          Cumulative (MPa·nm)
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {stressResults.layers.map((layer, idx) => (
                        <tr
                          key={idx}
                          className={idx % 2 === 0 ? "bg-white" : "bg-gray-50"}
                        >
                          <td className="px-4 py-2 border-b">
                            {layer.layerNum}
                          </td>
                          <td className="px-4 py-2 border-b font-medium">
                            {layer.material}
                          </td>
                          <td className="px-4 py-2 text-right border-b">
                            {layer.thickness}
                          </td>
                          <td className="px-4 py-2 text-right border-b">
                            {layer.intrinsicStress}
                          </td>
                          <td className="px-4 py-2 text-center border-b">
                            <span
                              className={`px-2 py-1 rounded text-xs font-medium ${
                                layer.stressType === "Compressive"
                                  ? "bg-green-100 text-green-800"
                                  : layer.stressType === "Tensile"
                                  ? "bg-red-100 text-red-800"
                                  : "bg-gray-100 text-gray-800"
                              }`}
                            >
                              {layer.stressType}
                            </span>
                          </td>
                          <td className="px-4 py-2 text-right border-b font-mono">
                            {layer.stressForce}
                          </td>
                          <td className="px-4 py-2 text-right border-b font-mono font-semibold">
                            {layer.cumulativeStress}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Guidelines */}
              <div className="bg-blue-50 rounded-lg p-4 border border-blue-200">
                <h4 className="font-semibold text-blue-900 mb-2">
                  Stress Management Guidelines:
                </h4>
                <ul className="text-sm text-blue-800 space-y-1">
                  <li>
                    • <strong>Compressive stress</strong> (positive values):
                    Material wants to expand. Can cause buckling or
                    delamination.
                  </li>
                  <li>
                    • <strong>Tensile stress</strong> (negative values):
                    Material wants to contract. Can cause cracking.
                  </li>
                  <li>
                    • <strong>Balanced design:</strong> Alternate high-tensile
                    and high-compressive materials to minimize total stress.
                  </li>
                  <li>
                    • <strong>Annealing:</strong> Heat treatment at 150-200°C
                    for 2 hours can reduce stress by 30-50%.
                  </li>
                  <li>
                    • <strong>Critical threshold:</strong> Total stress
                    magnitude &gt;150,000 MPa·nm indicates high delamination
                    risk.
                  </li>
                </ul>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="sticky bottom-0 bg-gray-50 px-6 py-4 border-t border-gray-200 flex justify-end">
              <button
                onClick={() => setShowStressModal(false)}
                className="px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
      {/* ========== END STRESS MODAL ========== */}


      {/* ========== SAVE WORKSPACE MODAL ========== */}
      {showSaveWorkspaceModal && (
        <div className="fixed inset-0 flex items-center justify-center z-50" style={{ background: 'rgba(0,0,0,0.5)' }}>
          <div style={{ background: theme.surface, border: `1px solid ${theme.border}`, borderRadius: 12, padding: isPhone ? 16 : 24, width: isPhone ? '95vw' : 420, maxWidth: '95vw', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, color: theme.textPrimary, marginBottom: 4 }}>Save Workspace</h3>
            <p style={{ fontSize: 11, color: theme.textTertiary, marginBottom: 16 }}>Saves all machines, layer stacks, materials, optimizer targets, and settings.{isSignedIn ? ' A local backup is also saved automatically.' : ''}</p>

            {/* If working on a loaded workspace, show overwrite option */}
            {activeWorkspaceId && (
              <div style={{ background: theme.surfaceAlt || (darkMode ? '#1a1a2e' : '#f0f4ff'), border: `1px solid ${theme.border}`, borderRadius: 8, padding: '10px 12px', marginBottom: 12 }}>
                <div style={{ fontSize: 11, color: theme.textTertiary, marginBottom: 4 }}>Currently editing:</div>
                <div style={{ fontSize: 13, fontWeight: 600, color: theme.textPrimary, marginBottom: 8 }}>{activeWorkspaceName}</div>
                <button
                  onClick={() => handleSaveWorkspace(activeWorkspaceName, activeWorkspaceId)}
                  style={{ padding: '6px 14px', fontSize: 12, background: theme.accent, color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600, width: '100%' }}
                >Save (Overwrite Current)</button>
              </div>
            )}

            <div style={{ fontSize: 11, fontWeight: 600, color: theme.textTertiary, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>
              {activeWorkspaceId ? 'Or save as a new workspace:' : 'Workspace name:'}
            </div>
            <input
              type="text"
              placeholder="New workspace name..."
              value={saveWorkspaceName}
              onChange={(e) => setSaveWorkspaceName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && saveWorkspaceName.trim()) handleSaveWorkspace(saveWorkspaceName); }}
              style={{ width: '100%', padding: '8px 12px', border: `1px solid ${theme.inputBorder}`, borderRadius: 6, fontSize: 13, background: theme.inputBg, color: theme.inputText, marginBottom: 12, boxSizing: 'border-box' }}
              autoFocus={!activeWorkspaceId}
            />
            {!isSignedIn && (
              <p style={{ fontSize: 11, color: '#d97706', marginBottom: 12 }}>Saving locally only. Sign in to also save to the cloud.</p>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button onClick={() => { setShowSaveWorkspaceModal(false); setPendingReplaceData(null); }} style={{ padding: '6px 16px', fontSize: 13, color: theme.textSecondary, background: 'none', border: 'none', cursor: 'pointer' }}>Cancel</button>
              <button
                onClick={() => handleSaveWorkspace(saveWorkspaceName)}
                disabled={!saveWorkspaceName.trim()}
                style={{ padding: '6px 16px', fontSize: 13, background: saveWorkspaceName.trim() ? theme.accent : (darkMode ? '#333' : '#ccc'), color: '#fff', border: 'none', borderRadius: 6, cursor: saveWorkspaceName.trim() ? 'pointer' : 'not-allowed', fontWeight: 600 }}
              >Save as New</button>
            </div>
          </div>
        </div>
      )}

      {/* ========== LOAD WORKSPACE MODAL ========== */}
      {showLoadWorkspaceModal && (
        <div className="fixed inset-0 flex items-center justify-center z-50" style={{ background: 'rgba(0,0,0,0.5)' }}>
          <div style={{ background: theme.surface, border: `1px solid ${theme.border}`, borderRadius: 12, padding: isPhone ? 16 : 24, width: isPhone ? '95vw' : 560, maxWidth: '95vw', maxHeight: isPhone ? '90vh' : '75vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div>
                <h3 style={{ fontSize: 16, fontWeight: 700, color: theme.textPrimary, margin: 0 }}>Load Workspace</h3>
                <p style={{ fontSize: 11, color: theme.textTertiary, margin: '2px 0 0 0' }}>Load an entire workspace or pick individual items</p>
              </div>
              <button onClick={() => { setShowLoadWorkspaceModal(false); setExpandedWorkspaceId(null); }} style={{ background: 'none', border: 'none', color: theme.textSecondary, cursor: 'pointer' }}><X size={18} /></button>
            </div>
            {designsLoading ? (
              <p style={{ fontSize: 13, color: theme.textTertiary, textAlign: 'center', padding: '32px 0' }}>Loading workspaces...</p>
            ) : savedDesigns.length === 0 ? (
              <p style={{ fontSize: 13, color: theme.textTertiary, textAlign: 'center', padding: '32px 0' }}>No saved workspaces yet.</p>
            ) : (
              <div style={{ overflowY: 'auto', flex: 1, minHeight: 0 }}>
                {savedDesigns.map((design) => {
                  const isExpanded = expandedWorkspaceId === design.id;
                  const wsData = workspaceDataCache[design.id];
                  return (
                    <div key={design.id} style={{ marginBottom: 8, border: `1px solid ${isExpanded ? theme.accent : theme.border}`, borderRadius: 8, overflow: 'hidden', background: theme.surface }}>
                      {/* Workspace header row */}
                      <div
                        style={{ display: 'flex', alignItems: 'center', padding: '10px 12px', cursor: 'pointer', gap: 8 }}
                        onClick={async () => {
                          if (isExpanded) { setExpandedWorkspaceId(null); return; }
                          setExpandedWorkspaceId(design.id);
                          if (!workspaceDataCache[design.id]) fetchWorkspaceData(design);
                        }}
                      >
                        <span style={{ fontSize: 12, color: theme.textTertiary, transition: 'transform 0.2s', transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)', display: 'inline-block' }}>&#9654;</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: theme.textPrimary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{design.name}</div>
                          <div style={{ fontSize: 10, color: theme.textTertiary }}>{new Date(design.updatedAt || design.createdAt).toLocaleDateString()}</div>
                        </div>
                        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
                          <button
                            onClick={() => {
                              setShowReplaceConfirmDialog(design);
                              if (!workspaceDataCache[design.id]) fetchWorkspaceData(design);
                            }}
                            style={{ padding: '4px 10px', fontSize: 11, fontWeight: 600, background: theme.accent, color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}
                          >Load All</button>
                          <button
                            onClick={() => handleDeleteDesign(design.id)}
                            style={{ padding: '4px 6px', fontSize: 11, background: 'none', border: 'none', color: theme.error || '#ef4444', cursor: 'pointer' }}
                          ><Trash2 size={14} /></button>
                        </div>
                      </div>

                      {/* Expanded contents */}
                      {isExpanded && (
                        <div style={{ borderTop: `1px solid ${theme.border}`, padding: 12, background: theme.surfaceAlt || theme.surface }}>
                          {!wsData ? (
                            <p style={{ fontSize: 11, color: theme.textTertiary, textAlign: 'center', padding: 8 }}>Loading workspace contents...</p>
                          ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                              {/* Machines */}
                              {wsData.machines?.length > 0 && (
                                <div>
                                  <div style={{ fontSize: 10, fontWeight: 700, color: theme.textTertiary, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Machines</div>
                                  {wsData.machines.map((machine) => {
                                    const stackCount = (wsData.layerStacks || []).filter(s => s.machineId === machine.id).length;
                                    return (
                                      <div key={machine.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 0' }}>
                                        <span style={{ fontSize: 12, color: theme.textPrimary }}>{machine.name || `Machine ${machine.id}`} <span style={{ fontSize: 10, color: theme.textTertiary }}>({stackCount} stack{stackCount !== 1 ? 's' : ''})</span></span>
                                        <button onClick={() => handleAddMachineFromWorkspace(machine, wsData)} style={{ padding: '2px 8px', fontSize: 10, background: theme.accentLight, color: theme.accentText, border: 'none', borderRadius: 4, cursor: 'pointer', fontWeight: 600 }}>Add</button>
                                      </div>
                                    );
                                  })}
                                </div>
                              )}

                              {/* Layer Stacks */}
                              {wsData.layerStacks?.length > 0 && (
                                <div>
                                  <div style={{ fontSize: 10, fontWeight: 700, color: theme.textTertiary, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Layer Stacks</div>
                                  {wsData.layerStacks.map((stack) => (
                                    <div key={stack.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 0' }}>
                                      <span style={{ fontSize: 12, color: theme.textPrimary }}>
                                        <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: stack.color || '#6366f1', marginRight: 6, verticalAlign: 'middle' }}></span>
                                        {stack.name || `Stack ${stack.id}`} <span style={{ fontSize: 10, color: theme.textTertiary }}>({stack.layers?.length || 0} layer{(stack.layers?.length || 0) !== 1 ? 's' : ''})</span>
                                      </span>
                                      <button onClick={() => handleAddStackFromWorkspace(stack)} style={{ padding: '2px 8px', fontSize: 10, background: theme.accentLight, color: theme.accentText, border: 'none', borderRadius: 4, cursor: 'pointer', fontWeight: 600 }}>Add</button>
                                    </div>
                                  ))}
                                </div>
                              )}

                              {/* Custom Materials */}
                              {wsData.customMaterials && Object.keys(wsData.customMaterials).length > 0 && (
                                <div>
                                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                    <div style={{ fontSize: 10, fontWeight: 700, color: theme.textTertiary, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Custom Materials</div>
                                    <button onClick={() => handleAddMaterialsFromWorkspace(wsData.customMaterials)} style={{ padding: '2px 8px', fontSize: 10, background: theme.accentLight, color: theme.accentText, border: 'none', borderRadius: 4, cursor: 'pointer', fontWeight: 600 }}>Add All</button>
                                  </div>
                                  <div style={{ fontSize: 11, color: theme.textSecondary, marginTop: 2 }}>{Object.keys(wsData.customMaterials).join(', ')}</div>
                                </div>
                              )}

                              {/* Optimizer Targets */}
                              {(wsData.designPoints?.length > 0 || wsData.targets) && (
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                  <div>
                                    <div style={{ fontSize: 10, fontWeight: 700, color: theme.textTertiary, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Optimizer Targets</div>
                                    <div style={{ fontSize: 11, color: theme.textSecondary, marginTop: 2 }}>{wsData.designPoints?.length || 0} target point(s), {wsData.designMaterials?.length || 0} material(s)</div>
                                  </div>
                                  <button onClick={() => handleAddTargetsFromWorkspace(wsData)} style={{ padding: '2px 8px', fontSize: 10, background: theme.accentLight, color: theme.accentText, border: 'none', borderRadius: 4, cursor: 'pointer', fontWeight: 600 }}>Add</button>
                                </div>
                              )}

                              {/* Tracking Runs */}
                              {wsData.trackingRuns?.length > 0 && (
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                  <div>
                                    <div style={{ fontSize: 10, fontWeight: 700, color: theme.textTertiary, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Tracking Runs</div>
                                    <div style={{ fontSize: 11, color: theme.textSecondary, marginTop: 2 }}>{wsData.trackingRuns.length} run(s)</div>
                                  </div>
                                  <button onClick={() => handleAddTrackingRunsFromWorkspace(wsData.trackingRuns)} style={{ padding: '2px 8px', fontSize: 10, background: theme.accentLight, color: theme.accentText, border: 'none', borderRadius: 4, cursor: 'pointer', fontWeight: 600 }}>Add All</button>
                                </div>
                              )}

                              {/* Settings summary */}
                              <div style={{ fontSize: 10, color: theme.textMuted, borderTop: `1px solid ${theme.border}`, paddingTop: 6, marginTop: 2 }}>
                                Substrate: {wsData.substrate?.material || 'Glass'} (n={wsData.substrate?.n || '1.52'}) | Range: {wsData.wavelengthRange?.min || 380}-{wsData.wavelengthRange?.max || 780} nm | Illuminant: {wsData.selectedIlluminant || 'D65'}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ========== REPLACE WORKSPACE CONFIRM DIALOG ========== */}
      {showReplaceConfirmDialog && (
        <div className="fixed inset-0 flex items-center justify-center z-[60]" style={{ background: 'rgba(0,0,0,0.6)' }}>
          <div style={{ background: theme.surface, border: `1px solid ${theme.border}`, borderRadius: 12, padding: isPhone ? 16 : 24, width: isPhone ? '95vw' : 380, maxWidth: '95vw', boxShadow: '0 20px 60px rgba(0,0,0,0.4)' }}>
            <h3 style={{ fontSize: 15, fontWeight: 700, color: theme.textPrimary, marginBottom: 8 }}>Replace Current Workspace?</h3>
            <p style={{ fontSize: 12, color: theme.textSecondary, marginBottom: 6 }}>
              Loading <strong>"{showReplaceConfirmDialog.name}"</strong> will replace everything in your current workspace.
            </p>
            <p style={{ fontSize: 11, color: theme.textTertiary, marginBottom: 16 }}>All unsaved changes will be lost.</p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                onClick={() => setShowReplaceConfirmDialog(null)}
                style={{ padding: '6px 14px', fontSize: 12, color: theme.textSecondary, background: 'none', border: `1px solid ${theme.border}`, borderRadius: 6, cursor: 'pointer' }}
              >Cancel</button>
              <button
                onClick={() => {
                  setPendingReplaceData(showReplaceConfirmDialog);
                  setShowReplaceConfirmDialog(null);
                  setShowSaveWorkspaceModal(true);
                }}
                style={{ padding: '6px 14px', fontSize: 12, color: theme.accentText, background: theme.accentLight, border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600 }}
              >Save First</button>
              <button
                onClick={async () => {
                  const design = showReplaceConfirmDialog;
                  const d = workspaceDataCache[design.id] || design.data;
                  if (!d) {
                    const fetched = await fetchWorkspaceData(design);
                    if (fetched) executeWorkspaceReplace(fetched, design);
                  } else {
                    executeWorkspaceReplace(d, design);
                  }
                }}
                style={{ padding: '6px 14px', fontSize: 12, color: '#fff', background: '#dc2626', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600 }}
              >Replace</button>
            </div>
          </div>
        </div>
      )}

      {/* ========== PRICING MODAL ========== */}
      {showPricingModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" onClick={() => setShowPricingModal(false)}>
          <div className="rounded-xl shadow-2xl" style={{ width: '90vw', maxWidth: 960, height: '90vh', display: 'flex', flexDirection: 'column', background: theme.surface }} onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4" style={{ flexShrink: 0, borderBottom: `1px solid ${theme.border}` }}>
              <div>
                <h2 className="text-xl font-bold" style={{ color: theme.textPrimary }}>Choose Your Plan</h2>
                <p className="text-xs mt-0.5" style={{ color: theme.textMuted }}>Upgrade to unlock the full power of OptiCoat Designer</p>
              </div>
              <div className="flex items-center gap-3">
                {userTier !== 'free' && isSignedIn && (
                  <button onClick={handleBillingPortal} className="text-xs text-indigo-600 underline hover:text-indigo-800">Manage Billing</button>
                )}
                <button onClick={() => setShowPricingModal(false)} className="text-gray-400 hover:text-gray-600 p-1"><X size={20} /></button>
              </div>
            </div>

            {/* Billing interval toggle */}
            <div style={{ display: 'flex', justifyContent: 'center', padding: '12px 0 4px', flexShrink: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 0, borderRadius: 8, border: `1px solid ${theme.border}`, overflow: 'hidden' }}>
                <button
                  onClick={() => setBillingInterval('monthly')}
                  style={{ padding: '6px 18px', fontSize: 12, fontWeight: 600, border: 'none', cursor: 'pointer', background: billingInterval === 'monthly' ? theme.accent : 'transparent', color: billingInterval === 'monthly' ? '#fff' : theme.textSecondary }}
                >Monthly</button>
                <button
                  onClick={() => setBillingInterval('annual')}
                  style={{ padding: '6px 18px', fontSize: 12, fontWeight: 600, border: 'none', cursor: 'pointer', background: billingInterval === 'annual' ? theme.accent : 'transparent', color: billingInterval === 'annual' ? '#fff' : theme.textSecondary }}
                >Annual <span style={{ fontSize: 10, color: billingInterval === 'annual' ? '#bbf7d0' : '#22c55e', fontWeight: 700 }}>Save ~15%</span></button>
              </div>
            </div>

            {/* Scrollable body */}
            <div style={{ overflowY: 'auto', flex: 1, minHeight: 0, padding: '0 24px 16px' }}>
              <table className="w-full border-collapse text-sm" style={{ tableLayout: 'fixed' }}>
                <thead>
                  {/* Plan headers - sticky */}
                  <tr>
                    <th style={{ position: 'sticky', top: 0, background: theme.surface, zIndex: 2, textAlign: 'left', padding: '10px 8px 6px', width: '20%', fontSize: 11, fontWeight: 600, color: theme.textTertiary, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Feature</th>
                    {[
                      { key: 'free', name: 'Explorer', monthly: 'Free', annual: 'Free', sub: 'Get started' },
                      { key: 'starter', name: 'Starter', monthly: '$49/mo', annual: '$499/yr', sub: 'Individual engineers' },
                      { key: 'professional', name: 'Professional', monthly: '$149/mo', annual: '$1,499/yr', sub: 'Full-featured' },
                      { key: 'enterprise', name: 'Enterprise', monthly: '$599/mo', annual: '$6,999/yr', sub: 'For teams' },
                    ].map((tier) => (
                      <th key={tier.key} style={{ position: 'sticky', top: 0, background: theme.surface, zIndex: 2, textAlign: 'center', padding: '10px 8px 6px', width: '20%', verticalAlign: 'bottom' }}>
                        <div style={{ position: 'relative', paddingTop: tier.key === 'professional' ? 6 : 0 }}>
                          {tier.key === 'professional' && (
                            <div style={{ position: 'absolute', top: -10, left: '50%', transform: 'translateX(-50%)', background: theme.accent, color: '#fff', fontSize: 9, fontWeight: 700, padding: '2px 10px', borderRadius: 10, whiteSpace: 'nowrap', lineHeight: '14px' }}>MOST POPULAR</div>
                          )}
                          <div style={{ fontWeight: 700, color: theme.textPrimary, fontSize: 13 }}>{tier.name}</div>
                          <div style={{ fontWeight: 700, color: theme.textPrimary, fontSize: 17 }}>
                            {tier.key === 'enterprise'
                              ? billingInterval === 'monthly'
                                ? `$${599 + Math.max(0, enterpriseSeats - 5) * 69}/mo`
                                : `$${(6999 + Math.max(0, enterpriseSeats - 5) * 749).toLocaleString()}/yr`
                              : (billingInterval === 'monthly' ? tier.monthly : tier.annual)}
                          </div>
                          <div style={{ fontSize: 10, color: theme.textMuted }}>{tier.sub}</div>
                          {tier.key === 'professional' && (
                            <div style={{ fontSize: 9, color: '#22c55e', fontWeight: 600, marginTop: 2 }}>7-day free trial included</div>
                          )}
                          {tier.key === 'enterprise' && (
                            <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                              <span style={{ fontSize: 10, color: theme.textMuted }}>Seats:</span>
                              <button onClick={(e) => { e.stopPropagation(); setEnterpriseSeats(s => Math.max(1, s - 1)); }} style={{ width: 20, height: 20, borderRadius: 4, border: `1px solid ${theme.border}`, background: theme.surface, color: theme.textPrimary, fontSize: 13, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1 }}>−</button>
                              <span style={{ fontSize: 13, fontWeight: 700, color: theme.textPrimary, minWidth: 20, textAlign: 'center' }}>{enterpriseSeats}</span>
                              <button onClick={(e) => { e.stopPropagation(); setEnterpriseSeats(s => s + 1); }} style={{ width: 20, height: 20, borderRadius: 4, border: `1px solid ${theme.border}`, background: theme.surface, color: theme.textPrimary, fontSize: 13, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1 }}>+</button>
                            </div>
                          )}
                          {tier.key === 'enterprise' && enterpriseSeats > 5 && (
                            <div style={{ fontSize: 9, color: theme.textMuted, marginTop: 2 }}>5 included + {enterpriseSeats - 5} extra × {billingInterval === 'monthly' ? '$69/mo' : '$749/yr'}</div>
                          )}
                          {tier.key === 'enterprise' && enterpriseSeats <= 5 && (
                            <div style={{ fontSize: 9, color: theme.textMuted, marginTop: 2 }}>5 seats included</div>
                          )}
                          {userTier === tier.key ? (
                            <div style={{ marginTop: 6, padding: '4px 0', fontSize: 11, fontWeight: 600, color: theme.accentText, border: '1px solid #a5b4fc', borderRadius: 4, textAlign: 'center' }}>Current Plan</div>
                          ) : TIER_ORDER[userTier] >= TIER_ORDER[tier.key] ? (
                            <div style={{ marginTop: 6, height: 28 }}></div>
                          ) : isSignedIn ? (
                            <button disabled={checkoutLoading} onClick={() => { setShowPricingModal(false); handleCheckout(tier.key, billingInterval); }} style={{ marginTop: 6, width: '100%', padding: '5px 0', fontSize: 11, fontWeight: 600, background: tier.key === 'professional' ? '#22c55e' : theme.accent, color: '#fff', border: 'none', borderRadius: 4, cursor: checkoutLoading ? 'not-allowed' : 'pointer', opacity: checkoutLoading ? 0.6 : 1 }}>{checkoutLoading ? 'Processing...' : tier.key === 'professional' ? 'Start Free Trial' : 'Upgrade'}</button>
                          ) : (
                            <div style={{ marginTop: 6, fontSize: 10, color: theme.textMuted, textAlign: 'center', padding: '4px 0' }}>Sign in to upgrade</div>
                          )}
                        </div>
                      </th>
                    ))}
                  </tr>
                  {/* Divider below sticky header */}
                  <tr><td colSpan={5} style={{ position: 'sticky', top: 96, background: theme.surface, zIndex: 2, padding: 0, borderBottom: `2px solid ${theme.border}`, height: 0 }}></td></tr>
                </thead>
                <tbody>
                  {/* Section: Core Limits */}
                  {[
                    { label: 'Layer Stacks', values: ['1', '3', 'Unlimited', 'Unlimited'] },
                    { label: 'Layers per Stack', values: ['5', '15', '50', '100'] },
                    { label: 'Cloud Saves', values: ['1', '25', 'Unlimited', 'Unlimited'] },
                    { label: 'Custom Materials', values: ['\u2014', '5', 'Unlimited', 'Unlimited'] },
                    { label: 'Machines', values: ['\u2014', '\u2014', 'Unlimited', 'Unlimited'] },
                  ].map((row, i) => (
                    <tr key={row.label} style={{ background: i % 2 === 0 ? '#f9fafb' : '#fff' }}>
                      <td className="py-2 px-2 text-xs font-medium text-gray-700">{row.label}</td>
                      {row.values.map((v, j) => (
                        <td key={j} className="py-2 px-2 text-center text-xs text-gray-600">{v}</td>
                      ))}
                    </tr>
                  ))}

                  {/* Section header */}
                  <tr><td colSpan={5} className="pt-4 pb-1 px-2 text-xs font-bold text-gray-800 uppercase tracking-wider border-b border-gray-200">Display & Analysis</td></tr>
                  {[
                    { label: 'Reflectivity', values: [true, true, true, true] },
                    { label: 'Transmission', values: [true, true, true, true] },
                    { label: 'Absorption', values: [false, true, true, true] },
                    { label: 'Admittance Diagram', values: [false, false, true, true] },
                    { label: 'E-Field Distribution', values: [false, false, true, true] },
                    { label: 'Phase Shift', values: [false, false, true, true] },
                    { label: 'Multi-Angle (0\u00B0-60\u00B0)', values: ['0\u00B0 only', 'All angles', 'All angles', 'All angles'] },
                    { label: 'Illuminants', values: ['D65 only', 'All 5', 'All 5', 'All 5'] },
                  ].map((row, i) => (
                    <tr key={row.label} style={{ background: i % 2 === 0 ? '#f9fafb' : '#fff' }}>
                      <td className="py-1.5 px-2 text-xs font-medium text-gray-700">{row.label}</td>
                      {row.values.map((v, j) => (
                        <td key={j} className="py-1.5 px-2 text-center text-xs">
                          {v === true ? <span style={{ color: theme.success, fontWeight: 600 }}>&#10003;</span>
                           : v === false ? <span style={{ color: theme.textMuted }}>{'\u2717'}</span>
                           : <span className="text-gray-600">{v}</span>}
                        </td>
                      ))}
                    </tr>
                  ))}

                  {/* Section header */}
                  <tr><td colSpan={5} className="pt-4 pb-1 px-2 text-xs font-bold text-gray-800 uppercase tracking-wider border-b border-gray-200">Design Assistant</td></tr>
                  {[
                    { label: 'Target Optimizer', values: [false, true, true, true] },
                    { label: 'Max Optimization Layers', values: ['\u2014', '15', '50', '100'] },
                    { label: 'Reverse Engineer', values: [false, false, true, true] },
                    { label: 'CSV Upload', values: [false, false, true, true] },
                    { label: 'Coating Templates', values: [false, true, true, true] },
                  ].map((row, i) => (
                    <tr key={row.label} style={{ background: i % 2 === 0 ? '#f9fafb' : '#fff' }}>
                      <td className="py-1.5 px-2 text-xs font-medium text-gray-700">{row.label}</td>
                      {row.values.map((v, j) => (
                        <td key={j} className="py-1.5 px-2 text-center text-xs">
                          {v === true ? <span style={{ color: theme.success, fontWeight: 600 }}>&#10003;</span>
                           : v === false ? <span style={{ color: theme.textMuted }}>{'\u2717'}</span>
                           : <span className="text-gray-600">{v}</span>}
                        </td>
                      ))}
                    </tr>
                  ))}

                  {/* Section header */}
                  <tr><td colSpan={5} className="pt-4 pb-1 px-2 text-xs font-bold text-gray-800 uppercase tracking-wider border-b border-gray-200">Yield & Tracking</td></tr>
                  {[
                    { label: 'Monte Carlo Simulation', values: ['\u2014', '1,000 runs', 'Unlimited', 'Unlimited'] },
                    { label: 'Color Simulation', values: [false, false, true, true] },
                    { label: 'Layer Sensitivity', values: [false, false, true, true] },
                    { label: 'Recipe Tracking', values: [false, true, true, true] },
                    { label: 'Tracking Charts', values: ['\u2014', '25', 'Unlimited', 'Unlimited'] },
                    { label: 'Design Target Overlay', values: [false, true, true, true] },
                    { label: 'Tolerance Bands', values: [false, false, true, true] },
                    { label: 'Color Drift (ΔE)', values: [false, false, true, true] },
                    { label: 'Wavelength Trends', values: [false, true, true, true] },
                    { label: 'Run Comparison', values: [false, false, true, true] },
                    { label: 'Export PNG', values: [false, true, true, true] },
                    { label: 'Export CSV', values: [true, true, true, true] },
                    { label: 'Run Notes', values: [true, true, true, true] },
                  ].map((row, i) => (
                    <tr key={row.label} style={{ background: i % 2 === 0 ? '#f9fafb' : '#fff' }}>
                      <td className="py-1.5 px-2 text-xs font-medium text-gray-700">{row.label}</td>
                      {row.values.map((v, j) => (
                        <td key={j} className="py-1.5 px-2 text-center text-xs">
                          {v === true ? <span style={{ color: theme.success, fontWeight: 600 }}>&#10003;</span>
                           : v === false ? <span style={{ color: theme.textMuted }}>{'\u2717'}</span>
                           : <span className="text-gray-600">{v}</span>}
                        </td>
                      ))}
                    </tr>
                  ))}

                  {/* Section header */}
                  <tr><td colSpan={5} className="pt-4 pb-1 px-2 text-xs font-bold text-gray-800 uppercase tracking-wider border-b border-gray-200">Advanced</td></tr>
                  {[
                    { label: 'Lumi AI Assistant', values: [false, '$19/mo add-on (100 msgs)', 'Unlimited', 'Unlimited'] },
                    { label: 'IAD Modeling', values: [false, false, true, true] },
                    { label: 'User Seats', values: ['\u2014', '\u2014', '\u2014', `5 (+${billingInterval === 'monthly' ? '$69/mo' : '$749/yr'}/seat)`] },
                    { label: 'API Access', values: [false, false, false, true] },
                    { label: 'Priority Support', values: [false, false, false, true] },
                  ].map((row, i) => (
                    <tr key={row.label} style={{ background: i % 2 === 0 ? '#f9fafb' : '#fff' }}>
                      <td className="py-1.5 px-2 text-xs font-medium text-gray-700">{row.label}</td>
                      {row.values.map((v, j) => (
                        <td key={j} className="py-1.5 px-2 text-center text-xs">
                          {v === true ? <span style={{ color: theme.success, fontWeight: 600 }}>&#10003;</span>
                           : v === false ? <span style={{ color: theme.textMuted }}>{'\u2717'}</span>
                           : typeof v === 'string' && v.includes('add-on') ? <span style={{ color: '#6366f1', fontWeight: 600, fontSize: '10px' }}>{v}</span>
                           : v === 'Unlimited' ? <span style={{ color: theme.success, fontWeight: 600 }}>{v}</span>
                           : <span className="text-gray-600">{v}</span>}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ========== TEAM MANAGEMENT MODAL ========== */}
      {showTeamModal && organization && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" onClick={(e) => { if (e.target === e.currentTarget) setShowTeamModal(false); }}>
          <div style={{ background: theme.surface, color: theme.textPrimary, borderRadius: 12, boxShadow: '0 25px 50px rgba(0,0,0,0.25)', width: isPhone ? '95vw' : 480, maxWidth: '95vw', maxHeight: '80vh', overflow: 'auto', padding: isPhone ? 16 : 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h3 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>
                <Users size={18} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 8 }} />
                Team Management
              </h3>
              <button onClick={() => setShowTeamModal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: theme.textSecondary, fontSize: 18 }}>✕</button>
            </div>

            {/* Seat counter */}
            <div style={{ marginBottom: 16, padding: '10px 14px', borderRadius: 8, background: theme.surfaceAlt, border: `1px solid ${theme.border}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>Seats</span>
                <span style={{ fontSize: 13, color: theme.textSecondary }}>{teamSeats.used} of {teamSeats.max} used</span>
              </div>
              <div style={{ height: 6, borderRadius: 3, background: darkMode ? '#1e293b' : '#e5e7eb', overflow: 'hidden' }}>
                <div style={{ height: '100%', borderRadius: 3, background: teamSeats.used >= teamSeats.max ? '#ef4444' : '#4f46e5', width: `${Math.min(100, (teamSeats.used / teamSeats.max) * 100)}%`, transition: 'width 0.3s' }} />
              </div>
            </div>

            {/* Invite form */}
            <div style={{ marginBottom: 20 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: theme.textSecondary, marginBottom: 4, display: 'block' }}>Invite team member</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="colleague@company.com"
                  style={{ flex: 1, padding: '8px 12px', borderRadius: 6, border: `1px solid ${theme.border}`, background: theme.surface, color: theme.textPrimary, fontSize: 13, outline: 'none' }}
                  onKeyDown={(e) => { if (e.key === 'Enter') document.getElementById('invite-btn')?.click(); }}
                />
                <button
                  id="invite-btn"
                  disabled={inviteLoading || !inviteEmail || teamSeats.used >= teamSeats.max}
                  onClick={async () => {
                    if (!inviteEmail || !organization) return;
                    if (teamSeats.used >= teamSeats.max) { showToast('All seats are filled. Add more seats to invite members.', 'error'); return; }
                    setInviteLoading(true);
                    try {
                      await organization.inviteMember({ emailAddress: inviteEmail, role: 'org:member' });
                      setInviteEmail('');
                      showToast('Invitation sent!', 'success');
                      // Refresh invitations list
                      if (orgInvitations?.revalidate) orgInvitations.revalidate();
                    } catch (e) {
                      showToast('Failed to send invite: ' + (e.errors?.[0]?.message || e.message), 'error');
                    } finally {
                      setInviteLoading(false);
                    }
                  }}
                  style={{ padding: '8px 16px', borderRadius: 6, background: teamSeats.used >= teamSeats.max ? '#9ca3af' : '#4f46e5', color: '#fff', border: 'none', cursor: teamSeats.used >= teamSeats.max ? 'not-allowed' : 'pointer', fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 4 }}
                >
                  <UserPlus size={14} />
                  {inviteLoading ? 'Sending...' : 'Invite'}
                </button>
              </div>
              {teamSeats.used >= teamSeats.max && (
                <p style={{ fontSize: 11, color: '#ef4444', marginTop: 4 }}>All seats filled. <button onClick={() => { setShowTeamModal(false); setShowPricingModal(true); }} style={{ color: '#4f46e5', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline', fontSize: 11 }}>Add more seats</button></p>
              )}
            </div>

            {/* Members list */}
            <div style={{ marginBottom: 16 }}>
              <h4 style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: theme.textSecondary }}>Members</h4>
              {memberships?.data?.length > 0 ? memberships.data.map((m) => (
                <div key={m.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 10px', borderRadius: 6, marginBottom: 4, background: theme.surfaceAlt }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ width: 28, height: 28, borderRadius: '50%', background: '#4f46e5', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 600 }}>
                      {(m.publicUserData?.firstName?.[0] || m.publicUserData?.identifier?.[0] || '?').toUpperCase()}
                    </div>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 500 }}>{m.publicUserData?.firstName ? `${m.publicUserData.firstName} ${m.publicUserData.lastName || ''}`.trim() : m.publicUserData?.identifier}</div>
                      <div style={{ fontSize: 11, color: theme.textSecondary }}>{m.publicUserData?.identifier}</div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4, background: m.role === 'org:admin' ? '#fef3c7' : (darkMode ? '#1e293b' : '#f3f4f6'), color: m.role === 'org:admin' ? '#92400e' : theme.textSecondary, fontWeight: 500 }}>
                      {m.role === 'org:admin' ? 'Admin' : 'Member'}
                    </span>
                    {m.role !== 'org:admin' && membership?.role === 'org:admin' && (
                      <button
                        onClick={async () => {
                          try {
                            await organization.removeMember(m.publicUserData.userId);
                            showToast('Member removed', 'success');
                            if (memberships?.revalidate) memberships.revalidate();
                          } catch (e) { showToast('Failed to remove: ' + e.message, 'error'); }
                        }}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444', padding: 2 }}
                        title="Remove member"
                      >
                        <UserMinus size={14} />
                      </button>
                    )}
                  </div>
                </div>
              )) : (
                <p style={{ fontSize: 13, color: theme.textSecondary, textAlign: 'center', padding: 16 }}>No members yet. Invite your team!</p>
              )}
            </div>

            {/* Pending invitations */}
            {orgInvitations?.data?.length > 0 && (
              <div>
                <h4 style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: theme.textSecondary }}>Pending Invitations</h4>
                {orgInvitations.data.map((inv) => (
                  <div key={inv.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 10px', borderRadius: 6, marginBottom: 4, background: theme.surfaceAlt }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Mail size={14} style={{ color: theme.textSecondary }} />
                      <span style={{ fontSize: 13 }}>{inv.emailAddress}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 11, color: '#f59e0b', fontWeight: 500 }}>Pending</span>
                      <button
                        onClick={async () => {
                          try {
                            await inv.revoke();
                            showToast('Invitation revoked', 'success');
                            if (orgInvitations?.revalidate) orgInvitations.revalidate();
                          } catch (e) { showToast('Failed to revoke: ' + e.message, 'error'); }
                        }}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444', fontSize: 11, textDecoration: 'underline' }}
                      >
                        Revoke
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ========== ORG INVITATION BANNER ========== */}
      {userInvitations?.data?.length > 0 && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 60, padding: '10px 16px', background: 'linear-gradient(135deg, #4f46e5, #7c3aed)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, fontSize: 13, fontWeight: 500 }}>
          <Mail size={16} />
          <span>You've been invited to join <strong>{userInvitations.data[0].publicOrganizationData?.name || 'a team'}</strong></span>
          <button
            onClick={async () => {
              try {
                await userInvitations.data[0].accept();
                if (setActiveOrg) await setActiveOrg({ organization: userInvitations.data[0].publicOrganizationData.id });
                showToast('Joined team! Refreshing access...', 'success');
                // Re-fetch tier to get inherited Enterprise access
                window.location.reload();
              } catch (e) { showToast('Failed to accept: ' + e.message, 'error'); }
            }}
            style={{ padding: '4px 14px', borderRadius: 6, background: '#fff', color: '#4f46e5', border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: 12 }}
          >
            Accept
          </button>
          <button
            onClick={async () => {
              try {
                await userInvitations.data[0].reject();
                if (userInvitations?.revalidate) userInvitations.revalidate();
              } catch (e) { showToast('Failed to decline', 'error'); }
            }}
            style={{ padding: '4px 14px', borderRadius: 6, background: 'rgba(255,255,255,0.2)', color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 500, fontSize: 12 }}
          >
            Decline
          </button>
        </div>
      )}

      {/* ========== UPGRADE PROMPT MODAL ========== */}
      {showUpgradePrompt && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 w-96 text-center">
            <Crown size={40} className="mx-auto mb-3 text-amber-500" />
            <h3 className="text-lg font-bold text-gray-800 mb-2">Upgrade Required</h3>
            <p className="text-sm text-gray-600 mb-4">
              <strong>{upgradeFeature}</strong> requires a higher plan.
            </p>
            <div className="flex justify-center gap-3">
              <button onClick={() => setShowUpgradePrompt(false)} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">Not now</button>
              <button onClick={() => { setShowUpgradePrompt(false); setShowPricingModal(true); }} className="px-4 py-2 text-sm bg-indigo-600 text-white rounded hover:bg-indigo-700">View Plans</button>
            </div>
          </div>
        </div>
      )}

      {/* ========== LUMI ADD-ON PROMPT MODAL ========== */}
      {showLumiAddonPrompt && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
          <div style={{ background: theme.surface, borderRadius: '12px', padding: isPhone ? '20px' : '28px', width: isPhone ? '95vw' : '380px', maxWidth: '95vw', textAlign: 'center', boxShadow: '0 20px 60px rgba(0,0,0,0.3)', border: `1px solid ${theme.border}` }}>
            <div style={{ width: 48, height: 48, borderRadius: '50%', background: 'linear-gradient(135deg, #6366f1, #06b6d4)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px' }}>
              <Zap size={24} style={{ color: '#fff' }} />
            </div>
            <h3 style={{ fontSize: '18px', fontWeight: 700, color: theme.textPrimary, marginBottom: '8px' }}>Unlock Lumi AI</h3>
            <p style={{ fontSize: '13px', color: theme.textSecondary, marginBottom: '6px', lineHeight: '1.5' }}>
              Add AI-powered design assistance to your Starter plan.
            </p>
            <p style={{ fontSize: '13px', color: theme.textSecondary, marginBottom: '20px', lineHeight: '1.5' }}>
              <strong style={{ color: theme.textPrimary }}>$19/month</strong> — 100 expert consultations per month with full design context.
            </p>
            <div style={{ display: 'flex', justifyContent: 'center', gap: '10px' }}>
              <button
                onClick={() => setShowLumiAddonPrompt(false)}
                style={{ padding: '8px 18px', fontSize: '13px', color: theme.textSecondary, background: 'transparent', border: `1px solid ${theme.border}`, borderRadius: '6px', cursor: 'pointer' }}
              >Not now</button>
              <button
                disabled={checkoutLoading}
                onClick={async () => {
                  if (checkoutLoading) return;
                  setCheckoutLoading(true);
                  try {
                    const data = await apiPost('/api/billing/lumi-addon', {});
                    if (data.url) window.location.href = data.url;
                  } catch (err) {
                    showToast(err.message || 'Failed to start checkout', 'error');
                    setCheckoutLoading(false);
                  }
                  setShowLumiAddonPrompt(false);
                }}
                style={{
                  padding: '8px 18px', fontSize: '13px', fontWeight: 600, color: '#fff',
                  background: 'linear-gradient(135deg, #6366f1, #4f46e5)', border: 'none', borderRadius: '6px',
                  cursor: checkoutLoading ? 'not-allowed' : 'pointer', opacity: checkoutLoading ? 0.6 : 1,
                }}
                onMouseEnter={e => { e.currentTarget.style.background = 'linear-gradient(135deg, #4f46e5, #4338ca)'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'linear-gradient(135deg, #6366f1, #4f46e5)'; }}
              >{checkoutLoading ? 'Processing...' : 'Add Lumi — $19/mo'}</button>
            </div>
            <p style={{ fontSize: '11px', color: theme.textMuted, marginTop: '14px' }}>
              Or <span style={{ color: theme.accentText, cursor: 'pointer', textDecoration: 'underline' }} onClick={() => { setShowLumiAddonPrompt(false); setShowPricingModal(true); }}>upgrade to Professional</span> for unlimited access.
            </p>
          </div>
        </div>
      )}

      {/* ========== LUMI CHAT BADGE ========== */}
      {!chatOpen && (
        <button
          onClick={() => {
            if (CLERK_ENABLED && !isSignedIn) { setUpgradeFeature('Lumi AI Assistant'); setShowUpgradePrompt(true); return; }
            if (userTier === 'starter' && !lumiAddon.active) { setShowLumiAddonPrompt(true); return; }
            setChatOpen(true);
          }}
          style={{
            position: 'fixed',
            bottom: isPhone ? '16px' : '10px',
            right: isPhone ? '16px' : '10px',
            height: isPhone ? '44px' : '24px',
            borderRadius: isPhone ? '22px' : '12px',
            background: theme.accentLight,
            border: `1px solid ${darkMode ? '#363860' : '#c7d2fe'}`,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '4px',
            boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
            zIndex: 9998,
            transition: 'width 0.2s ease, background 0.2s ease, box-shadow 0.2s ease',
            overflow: 'hidden',
            padding: isPhone ? '0 14px' : '0 8px',
            width: isPhone ? '90px' : '46px',
            fontSize: isPhone ? '13px' : '11px',
            fontWeight: 700,
            letterSpacing: '0.5px',
          }}
          onMouseEnter={isPhone ? undefined : (e => { e.currentTarget.style.width = '82px'; e.currentTarget.style.background = darkMode ? '#22244a' : '#dbeafe'; e.currentTarget.style.boxShadow = '0 2px 6px rgba(79,70,229,0.2)'; e.currentTarget.querySelector('[data-lumi]').textContent = 'ASK LUMI'; })}
          onMouseLeave={isPhone ? undefined : (e => { e.currentTarget.style.width = '46px'; e.currentTarget.style.background = darkMode ? '#1e1f3a' : '#eef2ff'; e.currentTarget.style.boxShadow = darkMode ? '0 1px 3px rgba(0,0,0,0.3)' : '0 1px 3px rgba(0,0,0,0.08)'; e.currentTarget.querySelector('[data-lumi]').textContent = 'LUMI'; })}
        >
          <span data-lumi="" style={{
            whiteSpace: 'nowrap',
            background: 'linear-gradient(90deg, #4f46e5, #06b6d4, #eab308, #4f46e5)',
            backgroundSize: '200% 100%',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text',
            animation: 'lumiShimmer 3s ease-in-out infinite',
          }}>LUMI</span>
        </button>
      )}
      <style>{`
        @keyframes lumiShimmer {
          0% { background-position: 100% 50%; }
          100% { background-position: -100% 50%; }
        }
      `}</style>

      {/* ========== AI CHAT PANEL ========== */}
      {chatOpen && (
        <div style={{
          position: 'fixed',
          top: 0,
          right: 0,
          width: isPhone ? '100vw' : '380px',
          height: '100vh',
          background: theme.surface,
          boxShadow: darkMode ? '-4px 0 20px rgba(0,0,0,0.4)' : '-4px 0 20px rgba(0,0,0,0.15)',
          zIndex: 9999,
          display: 'flex',
          flexDirection: 'column',
        }}>
          {/* Chat Header */}
          <div style={{ position: 'relative' }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '14px 16px',
              borderBottom: `1px solid ${theme.border}`,
              background: theme.surfaceAlt,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <MessageCircle size={18} style={{ color: theme.accentText }} />
                <span style={{ fontWeight: 600, fontSize: '14px', color: theme.textPrimary }}>Lumi</span>
                <span style={{ fontSize: '11px', color: theme.textMuted, fontWeight: 400 }}>AI Design Assistant</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                {lumiAddon.active && tierLimits.aiChat === 'addon' && (
                  <span style={{
                    fontSize: '10px',
                    fontWeight: 600,
                    color: (lumiAddon.messageLimit - lumiAddon.messagesUsed) <= 10 ? '#ef4444' : theme.textMuted,
                    padding: '2px 8px',
                    borderRadius: '10px',
                    background: darkMode ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
                    marginRight: '4px',
                  }}>
                    {lumiAddon.messageLimit - lumiAddon.messagesUsed} left
                  </span>
                )}
                <button
                  onClick={() => {
                    setChatOpen(false);
                    if (chatAbortRef.current) {
                      chatAbortRef.current.abort();
                      chatAbortRef.current = null;
                      setChatStreaming(false);
                    }
                  }}
                  style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    padding: '4px',
                    color: theme.textTertiary,
                    display: 'flex',
                    alignItems: 'center',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.color = theme.textPrimary; }}
                  onMouseLeave={e => { e.currentTarget.style.color = theme.textTertiary; }}
                >
                  <X size={18} />
                </button>
              </div>
            </div>

          </div>

          {/* Chat Messages */}
          <div
            ref={chatContainerRef}
            onScroll={() => {
              const el = chatContainerRef.current;
              if (!el) return;
              const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 50;
              userScrolledUpRef.current = !atBottom;
            }}
            style={{
              flex: 1,
              overflowY: 'auto',
              padding: '16px',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
            }}
          >
            {chatMessages.length === 0 && (
              <div style={{
                textAlign: 'center',
                padding: '32px 16px',
                color: theme.textTertiary,
              }}>
                <MessageCircle size={32} style={{ margin: '0 auto 12px', color: darkMode ? '#363860' : '#c7d2fe' }} />
                <p style={{ fontSize: '14px', fontWeight: 600, color: theme.textPrimary, marginBottom: '8px' }}>
                  Hi, I'm Lumi!
                </p>
                <p style={{ fontSize: '12px', lineHeight: '1.5' }}>
                  Ask me about thin-film optics, material selection, layer optimization, color targets, or troubleshooting your current design.
                </p>
              </div>
            )}

            {chatMessages.map((msg, i) => (
              <div
                key={i}
                style={{
                  display: 'flex',
                  justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start',
                }}
              >
                <div style={{
                  maxWidth: '85%',
                  padding: '10px 14px',
                  borderRadius: msg.role === 'user' ? '14px 14px 4px 14px' : '14px 14px 14px 4px',
                  background: msg.role === 'user' ? theme.accentLight : theme.surfaceAlt,
                  border: `1px solid ${msg.role === 'user' ? (darkMode ? '#363860' : '#c7d2fe') : theme.border}`,
                  fontSize: '13px',
                  lineHeight: '1.5',
                  color: theme.textPrimary,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}>
                  {msg.thinking && !msg.content ? (
                    <span style={{ color: theme.textTertiary, fontStyle: 'italic', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span style={{ display: 'inline-flex', gap: '3px' }}>
                        <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: '#a78bfa', animation: 'lumiBounce 1.4s ease-in-out infinite' }} />
                        <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: '#818cf8', animation: 'lumiBounce 1.4s ease-in-out 0.2s infinite' }} />
                        <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: '#6366f1', animation: 'lumiBounce 1.4s ease-in-out 0.4s infinite' }} />
                      </span>
                      Lumi is thinking...
                    </span>
                  ) : (
                    <>
                      {msg.content}
                      {msg.role === 'assistant' && chatStreaming && i === chatMessages.length - 1 && msg.content && (
                        <span style={{
                          display: 'inline-block',
                          width: '2px',
                          height: '14px',
                          background: theme.accent,
                          marginLeft: '2px',
                          verticalAlign: 'text-bottom',
                          animation: 'chatCursorBlink 1s step-end infinite',
                        }} />
                      )}
                    </>
                  )}
                </div>
              </div>
            ))}
            <div ref={chatEndRef} />
          </div>

          {/* Chat Input */}
          <div style={{
            padding: '12px 16px',
            borderTop: `1px solid ${theme.border}`,
            background: theme.surfaceAlt,
            display: 'flex',
            gap: '8px',
            alignItems: 'flex-end',
          }}>
            <input
              type="text"
              value={chatInput}
              onChange={e => setChatInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChatMessage(); } }}
              placeholder="Ask about your design..."
              disabled={chatStreaming}
              style={{
                flex: 1,
                padding: '10px 12px',
                border: `1px solid ${theme.inputBorder}`,
                borderRadius: '8px',
                fontSize: '13px',
                outline: 'none',
                background: chatStreaming ? theme.surfaceAlt : theme.inputBg,
                color: theme.inputText,
              }}
              onFocus={e => { e.currentTarget.style.borderColor = theme.accentHover; e.currentTarget.style.boxShadow = `0 0 0 2px ${darkMode ? 'rgba(129,140,248,0.15)' : 'rgba(129,140,248,0.2)'}`; }}
              onBlur={e => { e.currentTarget.style.borderColor = theme.inputBorder; e.currentTarget.style.boxShadow = 'none'; }}
            />
            <button
              onClick={sendChatMessage}
              disabled={chatStreaming || !chatInput.trim()}
              style={{
                width: '38px',
                height: '38px',
                borderRadius: '8px',
                border: 'none',
                background: (chatStreaming || !chatInput.trim()) ? (darkMode ? '#363860' : '#c7d2fe') : theme.accent,
                color: '#fff',
                cursor: (chatStreaming || !chatInput.trim()) ? 'default' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                transition: 'background 0.2s',
              }}
              onMouseEnter={e => { if (!chatStreaming && chatInput.trim()) e.currentTarget.style.background = theme.accentHover; }}
              onMouseLeave={e => { if (!chatStreaming && chatInput.trim()) e.currentTarget.style.background = theme.accent; else e.currentTarget.style.background = darkMode ? '#363860' : '#c7d2fe'; }}
            >
              <Send size={16} />
            </button>
          </div>

          {/* Chat animations */}
          <style>{`
            @keyframes chatCursorBlink {
              0%, 100% { opacity: 1; }
              50% { opacity: 0; }
            }
            @keyframes lumiBounce {
              0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; }
              40% { transform: scale(1); opacity: 1; }
            }
          `}</style>
        </div>
      )}
    </div>
  );
};

export default ThinFilmDesigner;
