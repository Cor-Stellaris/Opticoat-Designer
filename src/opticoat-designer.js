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
  Users,
  Bell,
  Copy,
  XCircle,
  UserPlus,
  MessageSquare,
  Eye,
  EyeOff,
  ChevronLeft,
} from "lucide-react";
import { saveSession, loadSession, migrateFromLocalStorage, saveDesignLocally, getLocalDesigns, deleteLocalDesign } from './services/offlineStore';
import syncManager from './services/syncManager';
import { apiGet, apiPost, apiPut, apiDelete, apiStream, setTokenProvider } from './services/apiClient';
import html2canvas from 'html2canvas';

// Clerk — import hooks and components. They only work when wrapped in ClerkProvider (index.js).
import { useUser as useClerkUserHook, useAuth as useClerkAuthHook, SignInButton, UserButton } from '@clerk/clerk-react';

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

// Tier hierarchy for comparison
const TIER_ORDER = { free: 0, starter: 1, professional: 2, enterprise: 3 };

// DEV MODE: All features unlocked for testing. Restore original limits before production.
const FREE_TIER_LIMITS = {
  maxStacks: -1, maxLayersPerStack: 100, maxSavedDesigns: -1, maxCustomMaterials: -1,
  allowedAngles: [0, 15, 30, 45, 60],
  allowedDisplayModes: ['reflectivity', 'transmission', 'absorption', 'admittance', 'efield', 'phaseShift'],
  allowedIlluminants: ['D65', 'D50', 'A', 'F2', 'F11'],
  designAssistant: 'all', designAssistantMaxLayers: 100,
  reverseEngineer: true, colorTargetMode: true, csvUpload: true,
  recipeTracking: true, maxTrackingRuns: -1, yieldCalculator: true,
  maxMonteCarloIterations: -1, yieldColorSimulation: true, layerSensitivity: true,
  iad: true, maxMachines: -1,
  trackingDesignOverlay: true, trackingToleranceBands: true, trackingColorDrift: true,
  trackingTrendView: true, trackingExportPng: true, trackingExportCsv: true,
  trackingRunComparison: true,
  aiChat: true,
  teamCollaboration: true,
  maxTeams: -1,
  maxTeamSeats: -1,
};

const admittanceColors = ["#2563eb", "#dc2626", "#16a34a", "#9333ea", "#ea580c", "#0891b2", "#be185d", "#65a30d", "#7c3aed", "#d97706"];

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

function computeFullSpectrumFromData(designData, customMats = {}) {
  if (!designData) return [];
  const allMats = { ...materialDispersion, ...customMats };

  let layers = designData.layers || [];
  if (designData.layerStacks && designData.currentStackId) {
    const cs = designData.layerStacks.find(s => s.id === designData.currentStackId);
    if (cs && cs.layers && cs.layers.length > 0) layers = cs.layers;
  }
  if (layers.length === 0) return [];

  const wlRange = designData.wavelengthRange || { min: 380, max: 780, step: 5 };
  const n0 = designData.incident?.n || 1.0;
  const ns = designData.substrate?.n || 1.52;

  const machine = (designData.machines || []).find(m => m.id === designData.currentMachineId) || designData.machines?.[0];
  const toolingFactors = machine?.toolingFactors || {};

  const result = [];
  const step = Math.max(wlRange.step || 5, 2);

  for (let wl = wlRange.min; wl <= wlRange.max; wl += step) {
    let M11r = 1, M11i = 0, M12r = 0, M12i = 0;
    let M21r = 0, M21i = 0, M22r = 1, M22i = 0;

    for (let i = layers.length - 1; i >= 0; i--) {
      const layer = layers[i];
      const nr = getRefractiveIndexStandalone(layer.material, wl, allMats, layer.iad, layer.packingDensity || 1.0);
      const ni = getExtinctionCoefficientStandalone(layer.material, wl, allMats);
      const tf = toolingFactors[layer.material] || 1.0;
      const d = (Number(layer.thickness) || 0) * tf;

      const deltaR = (2 * Math.PI * nr * d) / wl;
      const deltaI = -(2 * Math.PI * ni * d) / wl;

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

    const numR = n0 * M11r + n0 * ns * M12r - M21r - ns * M22r;
    const numI = n0 * M11i + n0 * ns * M12i - M21i - ns * M22i;
    const denR = n0 * M11r + n0 * ns * M12r + M21r + ns * M22r;
    const denI = n0 * M11i + n0 * ns * M12i + M21i + ns * M22i;
    const denMag2 = denR * denR + denI * denI;
    const rR = (numR * denR + numI * denI) / denMag2;
    const rI = (numI * denR - numR * denI) / denMag2;
    const R = Math.min((rR * rR + rI * rI) * 100, 100);

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
    const phase = Math.atan2(rI, rR) * 180 / Math.PI;

    result.push({ wavelength: wl, R, T, A, phase });
  }
  return result;
}

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
      layerNum: idx + 1, material: layer.material, thickness,
      intrinsicStress, stressForce, cumulativeStress,
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
    layers: stressData, totalStress: cumulativeStress, totalStressMagnitude,
    totalCompressive, totalTensile,
    totalPhysicalThickness: layers.reduce((s, l) => s + (Number(l.thickness) || 0), 0),
    riskLevel, riskColor, recommendation,
  };
}

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
  const efieldColors = ['#2563eb', '#16a34a', '#dc2626', '#9333ea', '#ea580c'];
  const stepsPerLayer = 40;

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
    // Pass 1: Full transfer matrix for transmission amplitude
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
    const intensities = [tMag2]; // substrate point

    for (let i = layers.length - 1; i >= 0; i--) {
      const nr = getRefractiveIndexStandalone(layers[i].material, lambda, allMats, layers[i].iad, layers[i].packingDensity || 1.0);
      const ni = getExtinctionCoefficientStandalone(layers[i].material, lambda, allMats);
      const tf = toolingFactors[layers[i].material] || 1.0;
      const d = (Number(layers[i].thickness) || 0) * tf;

      for (let step = 1; step <= stepsPerLayer; step++) {
        const frac = step / stepsPerLayer;
        const subD = frac * d;
        const deltaR2 = (2 * Math.PI * nr * subD) / lambda;
        const deltaI2 = -(2 * Math.PI * ni * subD) / lambda;
        const cosR2 = Math.cos(deltaR2) * Math.cosh(deltaI2);
        const cosI2 = Math.sin(deltaR2) * Math.sinh(deltaI2);
        const sinR2 = Math.sin(deltaR2) * Math.cosh(deltaI2);
        const sinI2 = -Math.cos(deltaR2) * Math.sinh(deltaI2);
        const etaR2 = nr, etaI2 = -ni;
        const etaMag2b = etaR2 * etaR2 + etaI2 * etaI2;
        const s12r = (-sinI2 * etaR2 - sinR2 * etaI2) / etaMag2b;
        const s12i = (sinR2 * etaR2 - sinI2 * etaI2) / etaMag2b;

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

    return { wavelength: lambda, color: efieldColors[wIdx % efieldColors.length], intensities };
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

function computeColorInfoFromSpectrum(spectrumData, illuminant = 'D65') {
  if (!spectrumData || spectrumData.length === 0) return null;

  // CIE 1931 2° Standard Observer (380-780nm, 5nm intervals)
  const CIE_DATA = {
    380:{x:0.0014,y:0.0000,z:0.0065},385:{x:0.0022,y:0.0001,z:0.0105},390:{x:0.0042,y:0.0001,z:0.0201},395:{x:0.0076,y:0.0002,z:0.0362},400:{x:0.0143,y:0.0004,z:0.0679},405:{x:0.0232,y:0.0006,z:0.1102},410:{x:0.0435,y:0.0012,z:0.2074},415:{x:0.0776,y:0.0022,z:0.3713},420:{x:0.1344,y:0.0040,z:0.6456},425:{x:0.2148,y:0.0073,z:1.0391},430:{x:0.2839,y:0.0116,z:1.3856},435:{x:0.3285,y:0.0168,z:1.6230},440:{x:0.3483,y:0.0230,z:1.7471},445:{x:0.3481,y:0.0298,z:1.7826},450:{x:0.3362,y:0.0380,z:1.7721},455:{x:0.3187,y:0.0480,z:1.7441},460:{x:0.2908,y:0.0600,z:1.6692},465:{x:0.2511,y:0.0739,z:1.5281},470:{x:0.1954,y:0.0910,z:1.2876},475:{x:0.1421,y:0.1126,z:1.0419},480:{x:0.0956,y:0.1390,z:0.8130},485:{x:0.0580,y:0.1693,z:0.6162},490:{x:0.0320,y:0.2080,z:0.4652},495:{x:0.0147,y:0.2586,z:0.3533},500:{x:0.0049,y:0.3230,z:0.2720},505:{x:0.0024,y:0.4073,z:0.2123},510:{x:0.0093,y:0.5030,z:0.1582},515:{x:0.0291,y:0.6082,z:0.1117},520:{x:0.0633,y:0.7100,z:0.0782},525:{x:0.1096,y:0.7932,z:0.0573},530:{x:0.1655,y:0.8620,z:0.0422},535:{x:0.2257,y:0.9149,z:0.0298},540:{x:0.2904,y:0.9540,z:0.0203},545:{x:0.3597,y:0.9803,z:0.0134},550:{x:0.4334,y:0.9950,z:0.0087},555:{x:0.5121,y:1.0002,z:0.0057},560:{x:0.5945,y:0.9950,z:0.0039},565:{x:0.6784,y:0.9786,z:0.0027},570:{x:0.7621,y:0.9520,z:0.0021},575:{x:0.8425,y:0.9154,z:0.0018},580:{x:0.9163,y:0.8700,z:0.0017},585:{x:0.9786,y:0.8163,z:0.0014},590:{x:1.0263,y:0.7570,z:0.0011},595:{x:1.0567,y:0.6949,z:0.0010},600:{x:1.0622,y:0.6310,z:0.0008},605:{x:1.0456,y:0.5668,z:0.0006},610:{x:1.0026,y:0.5030,z:0.0003},615:{x:0.9384,y:0.4412,z:0.0002},620:{x:0.8544,y:0.3810,z:0.0002},625:{x:0.7514,y:0.3210,z:0.0001},630:{x:0.6424,y:0.2650,z:0.0000},635:{x:0.5419,y:0.2170,z:0.0000},640:{x:0.4479,y:0.1750,z:0.0000},645:{x:0.3608,y:0.1382,z:0.0000},650:{x:0.2835,y:0.1070,z:0.0000},655:{x:0.2187,y:0.0816,z:0.0000},660:{x:0.1649,y:0.0610,z:0.0000},665:{x:0.1212,y:0.0446,z:0.0000},670:{x:0.0874,y:0.0320,z:0.0000},675:{x:0.0636,y:0.0232,z:0.0000},680:{x:0.0468,y:0.0170,z:0.0000},685:{x:0.0329,y:0.0119,z:0.0000},690:{x:0.0227,y:0.0082,z:0.0000},695:{x:0.0158,y:0.0057,z:0.0000},700:{x:0.0114,y:0.0041,z:0.0000},705:{x:0.0081,y:0.0029,z:0.0000},710:{x:0.0058,y:0.0021,z:0.0000},715:{x:0.0041,y:0.0015,z:0.0000},720:{x:0.0029,y:0.0010,z:0.0000},725:{x:0.0020,y:0.0007,z:0.0000},730:{x:0.0014,y:0.0005,z:0.0000},735:{x:0.0010,y:0.0004,z:0.0000},740:{x:0.0007,y:0.0002,z:0.0000},745:{x:0.0005,y:0.0002,z:0.0000},750:{x:0.0003,y:0.0001,z:0.0000},755:{x:0.0002,y:0.0001,z:0.0000},760:{x:0.0002,y:0.0001,z:0.0000},765:{x:0.0001,y:0.0000,z:0.0000},770:{x:0.0001,y:0.0000,z:0.0000},775:{x:0.0000,y:0.0000,z:0.0000},780:{x:0.0000,y:0.0000,z:0.0000}
  };

  // Standard Illuminant Spectral Power Distributions (380-780nm, 5nm intervals)
  const ILLUMINANT_SPD = {
    D65: {
      380: 49.98, 385: 52.31, 390: 54.65, 395: 68.7, 400: 82.75, 405: 87.12, 410: 91.49, 415: 92.46, 420: 93.43, 425: 90.06, 430: 86.68, 435: 95.77, 440: 104.86, 445: 110.94, 450: 117.01, 455: 117.41, 460: 117.81, 465: 116.34, 470: 114.86, 475: 115.39, 480: 115.92, 485: 112.37, 490: 108.81, 495: 109.08, 500: 109.35, 505: 108.58, 510: 107.8, 515: 106.3, 520: 104.79, 525: 106.24, 530: 107.69, 535: 106.05, 540: 104.41, 545: 104.23, 550: 104.05, 555: 102.02, 560: 100.0, 565: 98.17, 570: 96.33, 575: 96.06, 580: 95.79, 585: 92.24, 590: 88.69, 595: 89.35, 600: 90.01, 605: 89.8, 610: 89.6, 615: 88.65, 620: 87.7, 625: 85.49, 630: 83.29, 635: 83.49, 640: 83.7, 645: 81.86, 650: 80.03, 655: 80.12, 660: 80.21, 665: 81.25, 670: 82.28, 675: 80.28, 680: 78.28, 685: 74.0, 690: 69.72, 695: 70.67, 700: 71.61, 705: 72.98, 710: 74.35, 715: 67.98, 720: 61.6, 725: 65.74, 730: 69.89, 735: 72.49, 740: 75.09, 745: 69.34, 750: 63.59, 755: 55.01, 760: 46.42, 765: 56.61, 770: 66.81, 775: 65.09, 780: 63.38,
      whitePoint: { Xn: 0.95047, Yn: 1.0, Zn: 1.08883 },
    },
    D50: {
      380: 24.49, 385: 27.18, 390: 29.87, 395: 39.59, 400: 49.31, 405: 52.91, 410: 56.51, 415: 58.27, 420: 60.03, 425: 58.93, 430: 57.82, 435: 66.32, 440: 74.82, 445: 81.04, 450: 87.25, 455: 88.93, 460: 90.61, 465: 90.99, 470: 91.37, 475: 93.24, 480: 95.11, 485: 93.54, 490: 91.96, 495: 93.84, 500: 95.72, 505: 96.17, 510: 96.61, 515: 96.87, 520: 97.13, 525: 99.61, 530: 102.1, 535: 101.43, 540: 100.75, 545: 101.54, 550: 102.32, 555: 101.16, 560: 100.0, 565: 98.87, 570: 97.74, 575: 98.33, 580: 98.92, 585: 96.21, 590: 93.5, 595: 95.59, 600: 97.69, 605: 98.48, 610: 99.27, 615: 99.16, 620: 99.04, 625: 97.38, 630: 95.72, 635: 97.29, 640: 98.86, 645: 97.26, 650: 95.67, 655: 96.93, 660: 98.19, 665: 100.6, 670: 103.0, 675: 101.07, 680: 99.13, 685: 93.26, 690: 87.38, 695: 89.49, 700: 91.6, 705: 92.25, 710: 92.89, 715: 84.87, 720: 76.85, 725: 81.68, 730: 86.51, 735: 89.55, 740: 92.58, 745: 85.4, 750: 78.23, 755: 67.96, 760: 57.69, 765: 70.31, 770: 82.92, 775: 80.6, 780: 78.27,
      whitePoint: { Xn: 0.96422, Yn: 1.0, Zn: 0.82521 },
    },
    A: {
      380: 9.8, 385: 10.9, 390: 12.09, 395: 13.35, 400: 14.71, 405: 16.15, 410: 17.68, 415: 19.29, 420: 20.99, 425: 22.79, 430: 24.67, 435: 26.64, 440: 28.7, 445: 30.85, 450: 33.09, 455: 35.41, 460: 37.81, 465: 40.3, 470: 42.87, 475: 45.52, 480: 48.24, 485: 51.04, 490: 53.91, 495: 56.85, 500: 59.86, 505: 62.93, 510: 66.06, 515: 69.25, 520: 72.5, 525: 75.79, 530: 79.13, 535: 82.52, 540: 85.95, 545: 89.41, 550: 92.91, 555: 96.44, 560: 100.0, 565: 103.58, 570: 107.18, 575: 110.8, 580: 114.44, 585: 118.08, 590: 121.73, 595: 125.39, 600: 129.04, 605: 132.7, 610: 136.35, 615: 139.99, 620: 143.62, 625: 147.24, 630: 150.84, 635: 154.42, 640: 157.98, 645: 161.52, 650: 165.03, 655: 168.51, 660: 171.96, 665: 175.38, 670: 178.77, 675: 182.12, 680: 185.43, 685: 188.7, 690: 191.93, 695: 195.12, 700: 198.26, 705: 201.36, 710: 204.41, 715: 207.41, 720: 210.36, 725: 213.27, 730: 216.12, 735: 218.92, 740: 221.67, 745: 224.36, 750: 227.0, 755: 229.59, 760: 232.12, 765: 234.59, 770: 237.01, 775: 239.37, 780: 241.68,
      whitePoint: { Xn: 1.0985, Yn: 1.0, Zn: 0.35585 },
    },
    F2: {
      380: 1.18, 385: 1.48, 390: 1.84, 395: 2.15, 400: 3.44, 405: 15.69, 410: 3.85, 415: 3.74, 420: 4.19, 425: 4.62, 430: 5.06, 435: 34.98, 440: 11.81, 445: 6.27, 450: 6.63, 455: 6.93, 460: 7.19, 465: 7.4, 470: 7.54, 475: 7.62, 480: 7.65, 485: 7.62, 490: 7.62, 495: 7.45, 500: 7.28, 505: 7.15, 510: 7.05, 515: 7.04, 520: 7.16, 525: 7.47, 530: 8.04, 535: 8.88, 540: 10.01, 545: 24.88, 550: 16.64, 555: 14.59, 560: 16.16, 565: 17.56, 570: 18.62, 575: 21.47, 580: 22.79, 585: 19.29, 590: 18.66, 595: 17.73, 600: 16.54, 605: 15.21, 610: 13.8, 615: 12.36, 620: 10.95, 625: 9.65, 630: 8.4, 635: 7.32, 640: 6.31, 645: 5.43, 650: 4.68, 655: 4.02, 660: 3.45, 665: 2.96, 670: 2.55, 675: 2.19, 680: 1.89, 685: 1.64, 690: 1.53, 695: 1.27, 700: 1.1, 705: 0.99, 710: 0.88, 715: 0.76, 720: 0.68, 725: 0.61, 730: 0.56, 735: 0.54, 740: 0.51, 745: 0.47, 750: 0.47, 755: 0.43, 760: 0.46, 765: 0.47, 770: 0.4, 775: 0.33, 780: 0.27,
      whitePoint: { Xn: 0.99186, Yn: 1.0, Zn: 0.67393 },
    },
    F11: {
      380: 0.91, 385: 0.63, 390: 0.46, 395: 0.37, 400: 1.29, 405: 12.68, 410: 1.59, 415: 1.79, 420: 2.46, 425: 3.33, 430: 4.49, 435: 30.78, 440: 5.29, 445: 4.72, 450: 4.56, 455: 4.47, 460: 4.4, 465: 4.35, 470: 4.32, 475: 4.3, 480: 4.3, 485: 4.31, 490: 4.34, 495: 4.41, 500: 4.51, 505: 4.67, 510: 4.89, 515: 5.2, 520: 5.63, 525: 6.24, 530: 7.07, 535: 8.21, 540: 9.77, 545: 72.35, 550: 13.4, 555: 12.55, 560: 12.72, 565: 13.04, 570: 13.44, 575: 13.88, 580: 14.36, 585: 59.66, 590: 16.75, 595: 17.43, 600: 18.0, 605: 18.37, 610: 18.49, 615: 18.33, 620: 17.89, 625: 17.22, 630: 16.36, 635: 15.37, 640: 14.29, 645: 13.18, 650: 12.07, 655: 11.0, 660: 9.98, 665: 9.02, 670: 8.12, 675: 7.3, 680: 6.55, 685: 5.86, 690: 5.23, 695: 4.67, 700: 4.16, 705: 3.72, 710: 3.25, 715: 2.83, 720: 2.49, 725: 2.19, 730: 1.94, 735: 1.72, 740: 1.52, 745: 1.35, 750: 1.2, 755: 1.06, 760: 0.94, 765: 0.84, 770: 0.74, 775: 0.66, 780: 0.58,
      whitePoint: { Xn: 1.00962, Yn: 1.0, Zn: 0.6435 },
    },
  };

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

  const { Xn, Yn, Zn } = illumData.whitePoint;
  const f = (t) => t > Math.pow(6/29, 3) ? Math.pow(t, 1/3) : t / (3 * Math.pow(6/29, 2)) + 4/29;
  const fx = f(X / Xn), fy = f(Y / Yn), fz = f(Z / Zn);
  const L = 116 * fy - 16;
  const a = 500 * (fx - fy);
  const b = 200 * (fy - fz);

  const C = Math.sqrt(a * a + b * b);
  let h = Math.atan2(b, a) * 180 / Math.PI;
  if (h < 0) h += 360;

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

  let maxR = 0, domWl = 0;
  spectrumData.forEach(d => { if (d.wavelength >= 380 && d.wavelength <= 780 && d.R > maxR) { maxR = d.R; domWl = d.wavelength; } });
  const visData = spectrumData.filter(d => d.wavelength >= 380 && d.wavelength <= 780);
  const avgR = visData.length > 0 ? visData.reduce((s, d) => s + d.R, 0) / visData.length : 0;

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
    dominantWavelength: domWl, colorName, avgReflectivity: avgR.toFixed(1),
    X: X.toFixed(4), Y: Y.toFixed(4), Z: Z.toFixed(4),
    L: L.toFixed(1), a_star: a.toFixed(1), b_star: b.toFixed(1),
    L_lch: L.toFixed(1), C: C.toFixed(1), h: h.toFixed(1),
  };
}

const ThinFilmDesigner = () => {
  const [activeTab, setActiveTab] = useState("designer");

  const [layers, setLayers] = useState([
    { id: 1, material: "SiO2", thickness: 148.42, iad: null, packingDensity: 1.0 },
    { id: 2, material: "ZrO2", thickness: 30.16, iad: null, packingDensity: 1.0 },
    { id: 3, material: "SiO2", thickness: 23.68, iad: null, packingDensity: 1.0 },
    { id: 4, material: "ZrO2", thickness: 61.29, iad: null, packingDensity: 1.0 },
    { id: 5, material: "SiO2", thickness: 88.03, iad: null, packingDensity: 1.0 },
  ]);

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
  });

  const [layerStacks, setLayerStacks] = useState([
    {
      id: 1,
      machineId: 1,
      name: "Layer Stack 1",
      layers: [
        { id: 1, material: "SiO2", thickness: 148.42, iad: null, packingDensity: 1.0 },
        { id: 2, material: "ZrO2", thickness: 30.16, iad: null, packingDensity: 1.0 },
        { id: 3, material: "SiO2", thickness: 23.68, iad: null, packingDensity: 1.0 },
        { id: 4, material: "ZrO2", thickness: 61.29, iad: null, packingDensity: 1.0 },
        { id: 5, material: "SiO2", thickness: 88.03, iad: null, packingDensity: 1.0 },
      ],
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
  const [layoutMode, setLayoutMode] = useState("vertical"); // "vertical" or "horizontal"
  const [chartWidth, setChartWidth] = useState(60); // percentage for horizontal mode
  const [reflectivityRange, setReflectivityRange] = useState({
    min: 0,
    max: 100,
  });
  const [autoYAxis, setAutoYAxis] = useState(false);
  const [displayMode, setDisplayMode] = useState("reflectivity"); // 'reflectivity' or 'transmission'
  const [doubleSidedAR, setDoubleSidedAR] = useState(true); // Account for backside reflection (no black backing)
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
  const [designLayers, setDesignLayers] = useState(5);
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
  const [reverseEngineerIterations, setReverseEngineerIterations] = useState(200000);
  const [minimizePeaks, setMinimizePeaks] = useState(false);
  const [smoothnessWeight, setSmoothnessWeight] = useState(0.5);
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

  // Current user ID (set from tier fetch)
  const [currentUserId, setCurrentUserId] = useState(null);

  // Team collaboration state
  const [teams, setTeams] = useState([]);
  const [selectedTeamId, setSelectedTeamId] = useState(null);
  const [selectedTeamDetail, setSelectedTeamDetail] = useState(null);
  const [teamDesigns, setTeamDesigns] = useState([]);
  const [selectedSharedDesign, setSelectedSharedDesign] = useState(null);
  const [selectedSubmission, setSelectedSubmission] = useState(null);
  const [teamView, setTeamView] = useState('list');
  const [teamLoading, setTeamLoading] = useState(false);
  const [pendingInvitations, setPendingInvitations] = useState([]);
  const [showCreateTeamModal, setShowCreateTeamModal] = useState(false);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [showShareToTeamModal, setShowShareToTeamModal] = useState(false);
  const [showSubmitChangesModal, setShowSubmitChangesModal] = useState(false);
  const [showApproveModal, setShowApproveModal] = useState(false);
  const [showDenyModal, setShowDenyModal] = useState(false);
  const [showColorCompareModal, setShowColorCompareModal] = useState(false);
  const [colorCompareSelected, setColorCompareSelected] = useState([]);
  const [pendingSubmissionId, setPendingSubmissionId] = useState(null);
  const [newTeamName, setNewTeamName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [submissionNotes, setSubmissionNotes] = useState('');
  const [selectedDesignForSubmission, setSelectedDesignForSubmission] = useState(null);
  const [submissionPreviewData, setSubmissionPreviewData] = useState(null);
  const [submissionPreviewLoading, setSubmissionPreviewLoading] = useState(false);
  const [commentText, setCommentText] = useState('');
  const [reviewNoteText, setReviewNoteText] = useState('');
  const [shareDesignName, setShareDesignName] = useState('');
  const [notifications, setNotifications] = useState([]);
  const [unreadNotificationCount, setUnreadNotificationCount] = useState(0);
  const [showNotificationDropdown, setShowNotificationDropdown] = useState(false);

  // Team workspace state
  const [teamVisibleTraces, setTeamVisibleTraces] = useState({ original: true });
  const [teamTraceCache, setTeamTraceCache] = useState({});
  const [teamDisplayMode, setTeamDisplayMode] = useState('reflectivity');
  const [teamSelectedIlluminant, setTeamSelectedIlluminant] = useState('D65');
  const [teamActiveLayerView, setTeamActiveLayerView] = useState('original');
  const [showTeamColorCompare, setShowTeamColorCompare] = useState(false);
  const [teamColorCompareSelected, setTeamColorCompareSelected] = useState([]);
  const [teamAdmittanceWavelengths, setTeamAdmittanceWavelengths] = useState([450, 550, 650]);
  const [teamEfieldWavelengths, setTeamEfieldWavelengths] = useState([450, 550, 650]);

  // Toast notification state (replaces browser alert())
  const [toasts, setToasts] = useState([]);
  const toastIdRef = useRef(0);
  const showToast = useCallback((message, type = 'info') => {
    const id = ++toastIdRef.current;
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4000);
  }, []);

  const TEAM_TRACE_PALETTE = ['#4f46e5', '#dc2626', '#16a34a', '#ea580c', '#7c3aed', '#0891b2', '#ca8a04', '#be185d', '#4338ca', '#15803d', '#9333ea', '#0d9488'];

  const getTeamTraceColor = useCallback((traceId, submissions = []) => {
    if (traceId === 'original') return TEAM_TRACE_PALETTE[0];
    const sortedSubs = [...submissions].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    const idx = sortedSubs.findIndex(s => `sub_${s.id}` === traceId);
    return TEAM_TRACE_PALETTE[(idx + 1) % TEAM_TRACE_PALETTE.length];
  }, []);

  const getTeamTraceData = useCallback((traceId, designData, submissions = [], illuminant = 'D65') => {
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
    const colorInfo = computeColorInfoFromSpectrum(spectrum, illuminant);
    const stress = computeStressFromData(data, customMats);
    const result = { spectrum, colorInfo, stress, data };
    setTeamTraceCache(prev => ({ ...prev, [traceId]: result }));
    return result;
  }, [teamTraceCache]);

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

  // Auth state (Clerk)
  const { isSignedIn, user: authUser } = useClerkUser();
  const { getToken } = useClerkAuth();

  // Set token provider for API client
  useEffect(() => {
    if (getToken) setTokenProvider(getToken);
  }, [getToken]);

  // Auto-scroll chat to bottom when messages change
  useEffect(() => {
    if (chatEndRef.current) {
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

  // Fetch tier from server when signed in
  // DEV OVERRIDE: Force enterprise tier for testing. Remove before production.
  useEffect(() => {
    if (!isSignedIn) {
      setTierLimits(FREE_TIER_LIMITS);
      setUserTier('free');
      return;
    }
    // DEV OVERRIDE — force enterprise for all signed-in users during testing
    setUserTier('enterprise');
    setTierLimits(FREE_TIER_LIMITS); // FREE_TIER_LIMITS already has all features enabled in dev mode
    let cancelled = false;
    async function fetchTier() {
      try {
        const data = await apiGet('/api/auth/tier');
        if (!cancelled) {
          // DEV OVERRIDE: Always use enterprise regardless of backend response
          setUserTier('enterprise');
          setTierLimits(FREE_TIER_LIMITS);
          if (data.userId) setCurrentUserId(data.userId);
        }
      } catch (e) {
        console.warn('Failed to fetch tier:', e);
      }
    }
    // Also sync user to backend on first sign-in
    apiPost('/api/auth/sync', {}).catch(() => {});
    fetchTier();
    return () => { cancelled = true; };
  }, [isSignedIn]); // eslint-disable-line react-hooks/exhaustive-deps

  // Team collaboration helpers
  const loadTeams = useCallback(async () => {
    if (!isSignedIn) return;
    try { const data = await apiGet('/api/teams'); setTeams(data); } catch (e) { console.warn('Failed to load teams:', e); }
  }, [isSignedIn]);

  const loadPendingInvitations = useCallback(async () => {
    if (!isSignedIn) return;
    try { const data = await apiGet('/api/invitations'); setPendingInvitations(data); } catch (e) { console.warn('Failed to load invitations:', e); }
  }, [isSignedIn]);

  const loadTeamDetail = useCallback(async (teamId) => {
    try {
      setTeamLoading(true);
      const [detail, designs] = await Promise.all([apiGet(`/api/teams/${teamId}`), apiGet(`/api/teams/${teamId}/designs`)]);
      setSelectedTeamDetail(detail);
      setTeamDesigns(designs);
    } catch (e) { console.warn('Failed to load team detail:', e); } finally { setTeamLoading(false); }
  }, []);

  const loadSharedDesignDetail = useCallback(async (teamId, designId) => {
    try { setTeamLoading(true); const data = await apiGet(`/api/teams/${teamId}/designs/${designId}`); setSelectedSharedDesign(data); setTeamVisibleTraces({ original: true }); setTeamTraceCache({}); setTeamDisplayMode('reflectivity'); setTeamActiveLayerView('original'); } catch (e) { console.warn('Failed to load shared design:', e); } finally { setTeamLoading(false); }
  }, []);

  const loadSubmissionDetail = useCallback(async (teamId, designId, subId) => {
    try { setTeamLoading(true); const data = await apiGet(`/api/teams/${teamId}/designs/${designId}/submissions/${subId}`); setSelectedSubmission(data); } catch (e) { console.warn('Failed to load submission:', e); } finally { setTeamLoading(false); }
  }, []);

  const loadUnreadCount = useCallback(async () => {
    if (!isSignedIn) return;
    try { const data = await apiGet('/api/notifications/unread-count'); setUnreadNotificationCount(data.count); } catch (e) {}
  }, [isSignedIn]);

  const loadNotifications = useCallback(async () => {
    try { const data = await apiGet('/api/notifications'); setNotifications(data.notifications || []); } catch (e) { console.warn('Failed to load notifications:', e); }
  }, []);

  const handleCreateTeam = useCallback(async () => {
    if (!newTeamName.trim()) return;
    try { await apiPost('/api/teams', { name: newTeamName.trim() }); setShowCreateTeamModal(false); setNewTeamName(''); loadTeams(); } catch (e) { showToast('Failed to create team: ' + e.message, 'error'); }
  }, [newTeamName, loadTeams]);

  const handleInviteMember = useCallback(async () => {
    if (!inviteEmail.trim() || !selectedTeamId) return;
    try { await apiPost(`/api/teams/${selectedTeamId}/invite`, { email: inviteEmail.trim() }); setInviteEmail(''); setShowInviteModal(false); loadTeamDetail(selectedTeamId); } catch (e) { showToast('Failed to invite: ' + e.message, 'error'); }
  }, [inviteEmail, selectedTeamId, loadTeamDetail]);

  const handleAcceptInvitation = useCallback(async (invitationId) => {
    try { await apiPost(`/api/invitations/${invitationId}/accept`); loadPendingInvitations(); loadTeams(); } catch (e) { showToast('Failed to accept invitation: ' + e.message, 'error'); }
  }, [loadPendingInvitations, loadTeams]);

  const handleDeclineInvitation = useCallback(async (invitationId) => {
    try { await apiPost(`/api/invitations/${invitationId}/decline`); loadPendingInvitations(); } catch (e) { showToast('Failed to decline invitation: ' + e.message, 'error'); }
  }, [loadPendingInvitations]);

  const handleShareToTeam = useCallback(async (teamId) => {
    if (!shareDesignName.trim()) return;
    try {
      const designData = {
        layers, layerStacks, currentStackId, machines, currentMachineId,
        substrate, incident, wavelengthRange, recipes, targets,
        designPoints, designMaterials, designLayers, layerTemplate,
        displayMode, selectedIlluminant, customMaterials,
      };
      await apiPost(`/api/teams/${teamId}/designs`, { name: shareDesignName.trim(), data: designData });
      setShowShareToTeamModal(false); setShareDesignName('');
      if (selectedTeamId === teamId) loadTeamDetail(teamId);
      showToast('Design shared to team', 'success');
    } catch (e) { showToast('Failed to share: ' + e.message, 'error'); }
  }, [shareDesignName, layers, layerStacks, currentStackId, machines, currentMachineId, substrate, incident, wavelengthRange, recipes, targets, designPoints, designMaterials, designLayers, layerTemplate, displayMode, selectedIlluminant, customMaterials, selectedTeamId, loadTeamDetail]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleCloneDesign = useCallback(async (teamId, designId) => {
    try { const clone = await apiPost(`/api/teams/${teamId}/designs/${designId}/clone`); showToast('Design cloned: ' + clone.name, 'success'); } catch (e) { showToast('Failed to clone: ' + e.message, 'error'); }
  }, []);

  const handleSubmitChanges = useCallback(async () => {
    if (!submissionNotes.trim() || !selectedDesignForSubmission) return;
    try {
      const design = await apiGet(`/api/designs/${selectedDesignForSubmission}`);
      if (!design) { showToast('Design not found', 'error'); return; }
      await apiPost(`/api/teams/${selectedTeamId}/designs/${selectedSharedDesign.id}/submissions`, { data: design.data, notes: submissionNotes.trim(), sourceDesignId: design.id });
      setShowSubmitChangesModal(false); setSubmissionNotes(''); setSelectedDesignForSubmission(null); setSubmissionPreviewData(null);
      loadSharedDesignDetail(selectedTeamId, selectedSharedDesign.id);
    } catch (e) { showToast('Failed to submit: ' + e.message, 'error'); }
  }, [submissionNotes, selectedDesignForSubmission, selectedTeamId, selectedSharedDesign, loadSharedDesignDetail]);

  // Load preview data when user selects a design for submission
  useEffect(() => {
    if (!selectedDesignForSubmission || !selectedSharedDesign) {
      setSubmissionPreviewData(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        setSubmissionPreviewLoading(true);
        const design = await apiGet(`/api/designs/${selectedDesignForSubmission}`);
        if (cancelled || !design) return;
        const personalData = design.data;
        const originalData = selectedSharedDesign.data || {};

        const personalCustomMats = personalData?.customMaterials || {};
        const originalCustomMats = originalData?.customMaterials || {};

        const personalSpectrum = computeFullSpectrumFromData(personalData, personalCustomMats);
        const originalSpectrum = computeFullSpectrumFromData(originalData, originalCustomMats);

        const personalColor = computeColorInfoFromSpectrum(personalSpectrum, 'D65');
        const originalColor = computeColorInfoFromSpectrum(originalSpectrum, 'D65');

        const personalStress = computeStressFromData(personalData, personalCustomMats);
        const originalStress = computeStressFromData(originalData, originalCustomMats);

        // Get layers
        let personalLayers = personalData?.layers || [];
        if (personalData?.layerStacks && personalData.currentStackId) {
          const cs = personalData.layerStacks.find(s => s.id === personalData.currentStackId);
          if (cs && cs.layers?.length > 0) personalLayers = cs.layers;
        }
        let originalLayers = originalData?.layers || [];
        if (originalData?.layerStacks && originalData.currentStackId) {
          const cs = originalData.layerStacks.find(s => s.id === originalData.currentStackId);
          if (cs && cs.layers?.length > 0) originalLayers = cs.layers;
        }

        const personalThickness = personalLayers.reduce((s, l) => s + (Number(l.thickness) || 0), 0);
        const originalThickness = originalLayers.reduce((s, l) => s + (Number(l.thickness) || 0), 0);

        // Delta E between personal and original
        let deltaE = null;
        if (personalColor && originalColor) {
          const dL = parseFloat(personalColor.L) - parseFloat(originalColor.L);
          const da = parseFloat(personalColor.a_star) - parseFloat(originalColor.a_star);
          const db = parseFloat(personalColor.b_star) - parseFloat(originalColor.b_star);
          deltaE = Math.sqrt(dL * dL + da * da + db * db);
        }

        if (!cancelled) {
          setSubmissionPreviewData({
            personal: { color: personalColor, stress: personalStress, layerCount: personalLayers.length, totalThickness: personalThickness },
            original: { color: originalColor, stress: originalStress, layerCount: originalLayers.length, totalThickness: originalThickness },
            deltaE,
          });
        }
      } catch (e) {
        if (!cancelled) setSubmissionPreviewData(null);
      } finally {
        if (!cancelled) setSubmissionPreviewLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [selectedDesignForSubmission, selectedSharedDesign]);

  const handleApproveSubmission = useCallback(async () => {
    if (!pendingSubmissionId) return;
    try {
      await apiPost(`/api/teams/${selectedTeamId}/designs/${selectedSharedDesign.id}/submissions/${pendingSubmissionId}/approve`, { reviewNote: reviewNoteText || '' });
      setShowApproveModal(false); setReviewNoteText(''); setPendingSubmissionId(null);
      loadSharedDesignDetail(selectedTeamId, selectedSharedDesign.id);
    } catch (e) { showToast('Failed to approve: ' + e.message, 'error'); }
  }, [pendingSubmissionId, reviewNoteText, selectedTeamId, selectedSharedDesign, loadSharedDesignDetail]);

  const handleDenySubmission = useCallback(async () => {
    if (!pendingSubmissionId || !reviewNoteText.trim()) return;
    try {
      await apiPost(`/api/teams/${selectedTeamId}/designs/${selectedSharedDesign.id}/submissions/${pendingSubmissionId}/deny`, { reviewNote: reviewNoteText.trim() });
      setShowDenyModal(false); setReviewNoteText(''); setPendingSubmissionId(null);
      loadSharedDesignDetail(selectedTeamId, selectedSharedDesign.id);
    } catch (e) { showToast('Failed to deny: ' + e.message, 'error'); }
  }, [pendingSubmissionId, reviewNoteText, selectedTeamId, selectedSharedDesign, loadSharedDesignDetail]);

  const handleAddComment = useCallback(async (type, parentId) => {
    if (!commentText.trim()) return;
    try {
      const basePath = `/api/teams/${selectedTeamId}/designs/${selectedSharedDesign.id}`;
      const path = type === 'design' ? `${basePath}/comments` : `${basePath}/submissions/${parentId}/comments`;
      await apiPost(path, { content: commentText.trim() }); setCommentText('');
      loadSharedDesignDetail(selectedTeamId, selectedSharedDesign.id);
    } catch (e) { showToast('Failed to add comment: ' + e.message, 'error'); }
  }, [commentText, selectedTeamId, selectedSharedDesign, loadSharedDesignDetail]);

  const handleDeleteComment = useCallback(async (type, parentId, commentId) => {
    try {
      const basePath = `/api/teams/${selectedTeamId}/designs/${selectedSharedDesign.id}`;
      const path = type === 'design' ? `${basePath}/comments/${commentId}` : `${basePath}/submissions/${parentId}/comments/${commentId}`;
      await apiDelete(path); loadSharedDesignDetail(selectedTeamId, selectedSharedDesign.id);
    } catch (e) { showToast('Failed to delete comment: ' + e.message, 'error'); }
  }, [selectedTeamId, selectedSharedDesign, loadSharedDesignDetail]);

  const handleUpdateDesignStatus = useCallback(async (designId, status) => {
    try {
      await apiPut(`/api/teams/${selectedTeamId}/designs/${designId}/status`, { status });
      loadTeamDetail(selectedTeamId);
      if (selectedSharedDesign?.id === designId) loadSharedDesignDetail(selectedTeamId, designId);
    } catch (e) { showToast('Failed to update status: ' + e.message, 'error'); }
  }, [selectedTeamId, selectedSharedDesign, loadTeamDetail, loadSharedDesignDetail]);

  const handleMarkNotificationRead = useCallback(async (id) => {
    try { await apiPut(`/api/notifications/${id}/read`); loadUnreadCount(); loadNotifications(); } catch (e) {}
  }, [loadUnreadCount, loadNotifications]);

  const handleMarkAllNotificationsRead = useCallback(async () => {
    try { await apiPut('/api/notifications/read-all'); setUnreadNotificationCount(0); loadNotifications(); } catch (e) {}
  }, [loadNotifications]);

  const handleNotificationClick = useCallback((n) => {
    handleMarkNotificationRead(n.id);
    setShowNotificationDropdown(false);
    if (n.data?.teamId) {
      setActiveTab('team');
      setSelectedTeamId(n.data.teamId);
      setTeamView('detail');
      loadTeamDetail(n.data.teamId);
    }
  }, [handleMarkNotificationRead, loadTeamDetail]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load teams and notifications when signed in with team access
  useEffect(() => {
    if (isSignedIn && tierLimits.teamCollaboration) {
      loadTeams(); loadPendingInvitations(); loadUnreadCount();
      const interval = setInterval(loadUnreadCount, 60000);
      return () => clearInterval(interval);
    }
  }, [isSignedIn, tierLimits.teamCollaboration, loadTeams, loadPendingInvitations, loadUnreadCount]);

  // Save/Load designs state
  const [savedDesigns, setSavedDesigns] = useState([]);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [showLoadModal, setShowLoadModal] = useState(false);
  const [saveDesignName, setSaveDesignName] = useState('');
  const [designsLoading, setDesignsLoading] = useState(false);

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
    const trimmed = chatInput.trim();
    if (!trimmed || chatStreaming) return;

    const userMsg = { role: 'user', content: trimmed };
    setChatMessages(prev => [...prev, userMsg]);
    setChatInput('');
    setChatStreaming(true);

    // Build context from current design state
    const context = {
      layers: layers.map(l => ({ material: l.material, thickness: l.thickness })),
      substrate: { material: substrate.material, n: substrate.n },
      incident: { material: incident.material, n: incident.n },
      wavelengthRange,
      displayMode,
      targets: targets.map(t => ({ wavelength: t.wavelength, value: t.value, type: t.type })),
      colorData: colorData ? { L: Number(colorData.L), a: Number(colorData.a), b: Number(colorData.b) } : null,
      stackCount: layerStacks.length,
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
      if (data.type === "sellmeier") {
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
            const sinOverN_r = (sinDr * nr - sinDi * (-ni)) / nMagSq;
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
          return Math.min(Math.max(R, 0), 1);
        }

        // Oblique incidence - calculate using Snell's law for each layer
        const angleRad = (angle * Math.PI) / 180;
        const theta0 = angleRad;

        const angles = [theta0];
        const ns_array = [n0];

        for (let i = layerStack.length - 1; i >= 0; i--) {
          const n = getRefractiveIndex(
              layerStack[i].material,
              lambda,
              layerStack[i].iad,
              layerStack[i].packingDensity || 1.0
            );
          ns_array.push(n);
          const sinTheta = (n0 * Math.sin(theta0)) / n;
          if (sinTheta > 1) return 0; // Total internal reflection
          angles.push(Math.asin(sinTheta));
        }

        ns_array.push(ns);
        const sinThetaS = (n0 * Math.sin(theta0)) / ns;
        if (sinThetaS > 1) return 0;
        angles.push(Math.asin(sinThetaS));

        // Calculate s-polarization (TE mode)
        let M11r_s = 1,
          M11i_s = 0,
          M12r_s = 0,
          M12i_s = 0,
          M21r_s = 0,
          M21i_s = 0,
          M22r_s = 1,
          M22i_s = 0;

        for (let i = layerStack.length - 1; i >= 0; i--) {
          const n = getRefractiveIndex(
            layerStack[i].material,
            lambda,
            layerStack[i].iad,
            layerStack[i].packingDensity || 1.0
          );
          const toolingFactor = toolingFactors[layerStack[i].material] || 1.0;
          const d = layerStack[i].thickness * toolingFactor;
          const theta = angles[angles.length - 2 - i];
          const cosTheta = Math.cos(theta);
          const delta = (2 * Math.PI * n * d * cosTheta) / lambda;
          const cosD = Math.cos(delta);
          const sinD = Math.sin(delta);
          const eta = n * cosTheta;

          const L11r = cosD,
            L11i = 0,
            L12r = 0,
            L12i = sinD / eta,
            L21r = 0,
            L21i = eta * sinD,
            L22r = cosD,
            L22i = 0;
          const newM11r =
            M11r_s * L11r - M11i_s * L11i + M12r_s * L21r - M12i_s * L21i;
          const newM11i =
            M11r_s * L11i + M11i_s * L11r + M12r_s * L21i + M12i_s * L21r;
          const newM12r =
            M11r_s * L12r - M11i_s * L12i + M12r_s * L22r - M12i_s * L22i;
          const newM12i =
            M11r_s * L12i + M11i_s * L12r + M12r_s * L22i + M12i_s * L22r;
          const newM21r =
            M21r_s * L11r - M21i_s * L11i + M22r_s * L21r - M22i_s * L21i;
          const newM21i =
            M21r_s * L11i + M21i_s * L11r + M22r_s * L21i + M22i_s * L21r;
          const newM22r =
            M21r_s * L12r - M21i_s * L12i + M22r_s * L22r - M22i_s * L22i;
          const newM22i =
            M21r_s * L12i + M21i_s * L12r + M22r_s * L22i + M22i_s * L22r;

          M11r_s = newM11r;
          M11i_s = newM11i;
          M12r_s = newM12r;
          M12i_s = newM12i;
          M21r_s = newM21r;
          M21i_s = newM21i;
          M22r_s = newM22r;
          M22i_s = newM22i;
        }

        const eta0_s = n0 * Math.cos(theta0);
        const etas_s = ns * Math.cos(angles[angles.length - 1]);
        const numR_s =
          eta0_s * M11r_s + eta0_s * etas_s * M12r_s - M21r_s - etas_s * M22r_s;
        const numI_s =
          eta0_s * M11i_s + eta0_s * etas_s * M12i_s - M21i_s - etas_s * M22i_s;
        const denR_s =
          eta0_s * M11r_s + eta0_s * etas_s * M12r_s + M21r_s + etas_s * M22r_s;
        const denI_s =
          eta0_s * M11i_s + eta0_s * etas_s * M12i_s + M21i_s + etas_s * M22i_s;
        const denMag_s = denR_s * denR_s + denI_s * denI_s;
        const rR_s = (numR_s * denR_s + numI_s * denI_s) / denMag_s;
        const rI_s = (numI_s * denR_s - numR_s * denI_s) / denMag_s;
        const Rs = rR_s * rR_s + rI_s * rI_s;

        // Calculate p-polarization (TM mode)
        let M11r_p = 1,
          M11i_p = 0,
          M12r_p = 0,
          M12i_p = 0,
          M21r_p = 0,
          M21i_p = 0,
          M22r_p = 1,
          M22i_p = 0;

        for (let i = layerStack.length - 1; i >= 0; i--) {
          const n = getRefractiveIndex(
            layerStack[i].material,
            lambda,
            layerStack[i].iad,
            layerStack[i].packingDensity || 1.0
          );
          const toolingFactor = toolingFactors[layerStack[i].material] || 1.0;
          const d = layerStack[i].thickness * toolingFactor;
          const theta = angles[angles.length - 2 - i];
          const cosTheta = Math.cos(theta);
          const delta = (2 * Math.PI * n * d * cosTheta) / lambda;
          const cosD = Math.cos(delta);
          const sinD = Math.sin(delta);
          const eta = n / cosTheta;

          const L11r = cosD,
            L11i = 0,
            L12r = 0,
            L12i = sinD / eta,
            L21r = 0,
            L21i = eta * sinD,
            L22r = cosD,
            L22i = 0;
          const newM11r =
            M11r_p * L11r - M11i_p * L11i + M12r_p * L21r - M12i_p * L21i;
          const newM11i =
            M11r_p * L11i + M11i_p * L11r + M12r_p * L21i + M12i_p * L21r;
          const newM12r =
            M11r_p * L12r - M11i_p * L12i + M12r_p * L22r - M12i_p * L22i;
          const newM12i =
            M11r_p * L12i + M11i_p * L12r + M12r_p * L22i + M12i_p * L22r;
          const newM21r =
            M21r_p * L11r - M21i_p * L11i + M22r_p * L21r - M22i_p * L21i;
          const newM21i =
            M21r_p * L11i + M21i_p * L11r + M22r_p * L21i + M22i_p * L21r;
          const newM22r =
            M21r_p * L12r - M21i_p * L12i + M22r_p * L22r - M22i_p * L22i;
          const newM22i =
            M21r_p * L12i + M21i_p * L12r + M22r_p * L22i + M22i_p * L22r;

          M11r_p = newM11r;
          M11i_p = newM11i;
          M12r_p = newM12r;
          M12i_p = newM12i;
          M21r_p = newM21r;
          M21i_p = newM21i;
          M22r_p = newM22r;
          M22i_p = newM22i;
        }

        const eta0_p = n0 / Math.cos(theta0);
        const etas_p = ns / Math.cos(angles[angles.length - 1]);
        const numR_p =
          eta0_p * M11r_p + eta0_p * etas_p * M12r_p - M21r_p - etas_p * M22r_p;
        const numI_p =
          eta0_p * M11i_p + eta0_p * etas_p * M12i_p - M21i_p - etas_p * M22i_p;
        const denR_p =
          eta0_p * M11r_p + eta0_p * etas_p * M12r_p + M21r_p + etas_p * M22r_p;
        const denI_p =
          eta0_p * M11i_p + eta0_p * etas_p * M12i_p + M21i_p + etas_p * M22i_p;
        const denMag_p = denR_p * denR_p + denI_p * denI_p;
        const rR_p = (numR_p * denR_p + numI_p * denI_p) / denMag_p;
        const rI_p = (numI_p * denR_p - numR_p * denI_p) / denMag_p;
        const Rp = rR_p * rR_p + rI_p * rI_p;

        // Average s and p polarizations for unpolarized light
        const R_avg = (Rs + Rp) / 2;
        if (phaseOut) {
          const phase_s = Math.atan2(rI_s, rR_s) * 180 / Math.PI;
          const phase_p = Math.atan2(rI_p, rR_p) * 180 / Math.PI;
          phaseOut.phase = (phase_s + phase_p) / 2;
        }
        return Math.min(Math.max(R_avg, 0), 1);
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
    ]
  );

    const calculateAngleColors = useCallback(
    (layerStack, stackId) => {
      const angles = [0, 15, 30, 45, 60];
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
    [calculateReflectivityAtWavelength]
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

        // Calculate for all visible layer stacks
        layerStacks.forEach((stack) => {
          if (stack.visible) {
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
                  R = R + Math.pow(1 - R, 2) * R;
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

      // Calculate color data for ALL visible stacks
      const newStackColorData = {};
      layerStacks.forEach((stack) => {
        if (stack.visible) {
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
      color: '#374151', 'background-color': '#ffffff', 'border-left': '1px solid #e5e7eb',
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
      backgroundColor: '#ffffff',
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

      const originalStacks = [...layerStacks];
      const originalMachines = [...machines];
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

      layerStacks.splice(layerStacks.indexOf(virtualStack), 1);
      machines.splice(machines.indexOf(virtualMachine), 1);

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
          if (session.layers?.length > 0) setLayers(session.layers);
          if (session.layerStacks?.length > 0) setLayerStacks(session.layerStacks);
          if (session.currentStackId != null) setCurrentStackId(session.currentStackId);
          if (session.machines?.length > 0) setMachines(session.machines);
          if (session.currentMachineId != null) setCurrentMachineId(session.currentMachineId);
          if (session.substrate) setSubstrate(session.substrate);
          if (session.incident) setIncident(session.incident);
          if (session.wavelengthRange) setWavelengthRange(session.wavelengthRange);
          if (session.recipes?.length > 0) setRecipes(session.recipes);
          if (session.targets) setTargets(session.targets);
          if (session.trackingRuns) setTrackingRuns(session.trackingRuns);
          if (session.designPoints) setDesignPoints(session.designPoints);
          if (session.designMaterials) setDesignMaterials(session.designMaterials);
          if (session.designLayers) setDesignLayers(session.designLayers);
          if (session.layerTemplate) setLayerTemplate(session.layerTemplate);
          if (session.layoutMode) setLayoutMode(session.layoutMode);
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
        designLayers,
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
      designPoints, designMaterials, designLayers, layerTemplate, layoutMode,
      displayMode, selectedIlluminant, customMaterials]);

  // ============ Save/Load Designs ============

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
      console.warn('Failed to load designs:', e);
      const local = await getLocalDesigns();
      setSavedDesigns(local || []);
    }
    setDesignsLoading(false);
  }, [isSignedIn]);

  const handleSaveDesign = useCallback(async (name) => {
    if (!name.trim()) return;
    if (!checkLimit('maxSavedDesigns', savedDesigns.length, 'Saved Designs')) return;
    const designData = {
      layers, layerStacks, currentStackId, machines, currentMachineId,
      substrate, incident, wavelengthRange, recipes, targets, trackingRuns,
      designPoints, designMaterials, designLayers, layerTemplate,
      displayMode, selectedIlluminant, customMaterials,
    };
    try {
      if (isSignedIn) {
        await apiPost('/api/designs', { name: name.trim(), data: designData });
      } else {
        await saveDesignLocally({
          id: 'local_' + Date.now(),
          name: name.trim(),
          data: designData,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      }
      setShowSaveModal(false);
      setSaveDesignName('');
      loadDesignsList();
    } catch (e) {
      console.warn('Failed to save design:', e);
      showToast('Failed to save: ' + e.message, 'error');
    }
  }, [isSignedIn, layers, layerStacks, currentStackId, machines, currentMachineId,
      substrate, incident, wavelengthRange, recipes, targets, designPoints,
      designMaterials, designLayers, layerTemplate, displayMode, selectedIlluminant,
      customMaterials, loadDesignsList, checkLimit, savedDesigns, trackingRuns]);

  const handleLoadDesign = useCallback(async (design) => {
    try {
      // If data isn't included (list endpoint omits it), fetch the full design
      let d = design.data;
      if (!d) {
        const full = await apiGet(`/api/designs/${design.id}`);
        d = full.data;
      }
      if (!d) { showToast('Design data is empty', 'error'); return; }

      const designName = design.name || 'Loaded Design';

      // Add the loaded design's layers as a NEW stack instead of replacing existing stacks
      const loadedLayers = d.layers || (d.layerStacks?.length > 0
        ? d.layerStacks.find(s => s.id === d.currentStackId)?.layers || d.layerStacks[0].layers
        : [{ id: 1, material: "SiO2", thickness: 100, iad: null }]);

      const newStackId = Math.max(...layerStacks.map(s => s.id), 0) + 1;
      const newStack = {
        id: newStackId,
        machineId: currentMachineId,
        name: designName,
        layers: loadedLayers,
        visible: true,
        color: `hsl(${(newStackId * 60) % 360}, 70%, 50%)`,
      };

      // Use isUpdatingStackRef to prevent the layers→layerStacks sync useEffect from interfering
      isUpdatingStackRef.current = true;

      setLayerStacks(prev => [...prev, newStack]);
      setCurrentStackId(newStackId);
      setLayers(loadedLayers);
      prevLayersRef.current = JSON.stringify(loadedLayers);

      // Merge custom materials from loaded design (doesn't overwrite existing)
      if (d.customMaterials) {
        setCustomMaterials(prev => ({ ...prev, ...d.customMaterials }));
      }

      // Restore design settings if present
      if (d.substrate) setSubstrate(d.substrate);
      if (d.incident) setIncident(d.incident);
      if (d.wavelengthRange) setWavelengthRange(d.wavelengthRange);
      if (d.selectedIlluminant) setSelectedIlluminant(d.selectedIlluminant);
      if (d.targets) setTargets(d.targets);
      if (d.machines?.length > 0) {
        const sourceMachine = d.machines[0];
        if (sourceMachine.toolingFactors) {
          setMachines(prev => prev.map(m =>
            m.id === currentMachineId ? { ...m, toolingFactors: { ...m.toolingFactors, ...sourceMachine.toolingFactors } } : m
          ));
        }
      }

      // Release the guard after state updates flush
      Promise.resolve().then(() => { isUpdatingStackRef.current = false; });

      setShowLoadModal(false);
      setActiveTab('designer');
      showToast(`"${designName}" added as new stack — settings restored`, 'success');
    } catch (e) {
      showToast('Failed to load design: ' + e.message, 'error');
    }
  }, [showToast, layerStacks, currentMachineId]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleDeleteDesign = useCallback(async (designId) => {
    try {
      if (isSignedIn && !designId.startsWith('local_')) {
        await apiDelete(`/api/designs/${encodeURIComponent(designId)}`);
      } else {
        await deleteLocalDesign(designId);
      }
      loadDesignsList();
    } catch (e) {
      console.warn('Failed to delete design:', e);
    }
  }, [isSignedIn, loadDesignsList]);

  // ============ Billing ============

  const handleCheckout = useCallback(async (tier, interval = 'monthly') => {
    try {
      const data = await apiPost('/api/billing/checkout', { tier, interval });
      if (data.url) window.location.href = data.url;
    } catch (e) {
      showToast('Failed to start checkout: ' + e.message, 'error');
    }
  }, []);

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
    } else if (activeTab === "designer" && layerStacks.length === 0) {
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
    const handleMouseMove = (e) => {
      if (!isDragging) return;

      // Find the container element
      const container = document.querySelector(".designer-container");
      if (!container) return;

      const rect = container.getBoundingClientRect();
      const newHeight = ((e.clientY - rect.top) / rect.height) * 100;

      // Constrain between 30% and 80%
      if (newHeight > 30 && newHeight < 80) {
        setChartHeight(newHeight);
      }
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    if (isDragging) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      return () => {
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
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
      } else {
        materialData.type = 'sellmeier';
        materialData.B1 = newMaterialForm.B1;
        materialData.B2 = newMaterialForm.B2;
        materialData.B3 = newMaterialForm.B3;
        materialData.C1 = newMaterialForm.C1;
        materialData.C2 = newMaterialForm.C2;
        materialData.C3 = newMaterialForm.C3;
      }
      if (newMaterialForm.kType === 'constant') {
        materialData.kValue = newMaterialForm.kValue;
      }
      if (newMaterialForm.kType === 'urbach') {
        materialData.k0 = newMaterialForm.k0;
        materialData.kEdge = newMaterialForm.kEdge;
        materialData.kDecay = newMaterialForm.kDecay;
      }
    }

    setCustomMaterials((prev) => ({ ...prev, [trimmedName]: materialData }));
    setNewMaterialForm({
      name: '', mode: 'simple', n: 1.5, k: 0,
      dispersionType: 'cauchy', A: 2.0, B: 0.02, C: 0.0001,
      B1: 0.6, B2: 0.4, B3: 0.9, C1: 0.07, C2: 0.12, C3: 10.0,
      kType: 'none', kValue: 0, k0: 0.05, kEdge: 350, kDecay: 0.02,
      color: '#E0E0E0', iadIncrease: 2.0, stress: 0,
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
    setLayers([...layers, { id: newId, material: "SiO2", thickness: 100, iad: null, packingDensity: 1.0 }]);
  };

  const insertLayerAfter = (index) => {
    if (!checkLimit('maxLayersPerStack', layers.length, 'Layers per Stack')) return;
    const newId = Math.max(...layers.map((l) => l.id), 0) + 1;
    const newLayer = { id: newId, material: "SiO2", thickness: 100, iad: null, packingDensity: 1.0 };
    const newLayers = [...layers];
    newLayers.splice(index + 1, 0, newLayer);
    setLayers(newLayers);
  };

  const removeLayer = (id) => {
    if (layers.length > 1) setLayers(layers.filter((l) => l.id !== id));
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
          R = R + Math.pow(1 - R, 2) * R;
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
          R = R + Math.pow(1 - R, 2) * R;
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
    setRecipes(
      recipes.map((r) => {
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
      // Allow all zeros but warn user
      if (!window.confirm("Target color is set to L*=0, a*=0, b*=0 (pure black). Continue anyway?")) {
        return;
      }
    }

    setOptimizing(true);
    setSolutions([]);
    setOptimizationProgress(0);
    setOptimizationStage("Initializing...");

    // Separate materials by refractive index (low vs high)
    const lowIndexMaterials = [];
    const highIndexMaterials = [];
    const threshold = 1.8; // Approximate threshold between low and high index

    designMaterials.forEach((mat) => {
      const n = getRefractiveIndex(mat, 550);
      if (n < threshold) {
        lowIndexMaterials.push(mat);
      } else {
        highIndexMaterials.push(mat);
      }
    });

    // Ensure we have both types (only needed when not using template)
    if (!useLayerTemplate && (lowIndexMaterials.length === 0 || highIndexMaterials.length === 0)) {
      showToast("Please select both low-index (n<1.8) and high-index (n>1.8) materials for alternating structure", 'error');
      setOptimizing(false);
      return;
    }

    // DRAMATICALLY increased iterations for <3% error target
    // This will take longer but produce much better results
    const numIterations = reverseEngineerMode ? reverseEngineerIterations : targetModeIterations;
    const foundSolutions = [];

    // Track best solution for refinement
    let bestSolution = null;

    setOptimizationStage("Phase 1: Extensive Random Search");

    for (let iter = 0; iter < numIterations; iter++) {
      // Update progress every 200 iterations
      if (iter % 200 === 0) {
        setOptimizationProgress((iter / numIterations) * 30); // First 30% for random search
        await new Promise((resolve) => setTimeout(resolve, 0)); // Allow UI update
      }

      // Generate layer stack
      const testLayers = [];

      if (useLayerTemplate) {
        // Use exact layer structure from template with per-layer thickness ranges
        for (let i = 0; i < designLayers; i++) {
          const layerConfig = layerTemplate[i] || { material: "SiO2", minThickness: 20, maxThickness: 200 };
          const material = layerConfig.material;
          const minT = layerConfig.minThickness || 20;
          const maxT = layerConfig.maxThickness || 200;
          const thickness = minT + Math.random() * (maxT - minT);
          testLayers.push({ id: i, material, thickness });
        }
      } else {
        // Random layer stack with alternating low/high index
        // Randomly start with either low or high index
        let useLowIndex = Math.random() < 0.5;

        for (let i = 0; i < designLayers; i++) {
          let material;
          if (useLowIndex) {
            material =
              lowIndexMaterials[
                Math.floor(Math.random() * lowIndexMaterials.length)
              ];
          } else {
            material =
              highIndexMaterials[
                Math.floor(Math.random() * highIndexMaterials.length)
              ];
          }

          // Wider thickness range for better exploration
          const thickness = reverseEngineerMode
            ? 30 + Math.random() * 150
            : 25 + Math.random() * 125;
          testLayers.push({ id: i, material, thickness });

          // Alternate for next layer
          useLowIndex = !useLowIndex;
        }
      }

      // Calculate error
      let error = 0;
      let errorCount = 0;

      if (colorTargetMode) {
            // Color target mode: minimize ΔE* from target color
            const colorResult = calculateStackColorDeltaE(
              testLayers,
              currentStackId,
              targetColorL,
              targetColorA,
              targetColorB
            );
            error = colorResult.deltaE;

            // Angle color constraints
            if (angleColorConstraints.length > 0) {
              let angleError = 0;
              const normalColor = colorResult;

              angleColorConstraints.forEach(constraint => {
                if (constraint.mode === 'maxShift') {
                  const angleColor = calculateStackColorDeltaE(
                    testLayers, currentStackId, normalColor.L, normalColor.a, normalColor.b, constraint.angle
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
                error += avgAngleError * avgWeight * 10;
              }
            }

            errorCount = 1;
          } else if (reverseEngineerMode) {
            // Reverse engineering mode: fit to uploaded CSV data
            reverseEngineerData.forEach((dataPoint) => {
              let calcR = calculateReflectivityAtWavelength(
                dataPoint.wavelength,
                testLayers
              );
              
              // Apply double-sided correction if enabled (matches how CSV was measured)
              if (doubleSidedAR) {
                calcR = calcR + Math.pow(1 - calcR, 2) * calcR;
              }
              
              calcR = calcR * 100;
              error += Math.pow(calcR - dataPoint.reflectivity, 2);
              errorCount++;
            });
          } else {
        // Normal mode: fit to design points
        designPoints.forEach((point) => {
          if (point.useWavelengthRange) {
            // Sample multiple wavelengths across the range
            const numSamples = 5;
            const step =
              (point.wavelengthMax - point.wavelengthMin) / (numSamples - 1);
            for (let i = 0; i < numSamples; i++) {
              const lambda = point.wavelengthMin + i * step;
              const calcR =
                calculateReflectivityAtWavelength(lambda, testLayers) * 100;

              if (point.useReflectivityRange) {
                // Range mode: only penalize if outside range
                if (calcR < point.reflectivityMin) {
                  error += Math.pow(point.reflectivityMin - calcR, 2);
                  errorCount++;
                } else if (calcR > point.reflectivityMax) {
                  error += Math.pow(calcR - point.reflectivityMax, 2);
                  errorCount++;
                }
              } else {
                // Single target mode
                const targetValue =
                  (point.reflectivityMin + point.reflectivityMax) / 2;
                error += Math.pow(calcR - targetValue, 2);
                errorCount++;
              }
            }
          } else {
            // Single wavelength
            const lambda = (point.wavelengthMin + point.wavelengthMax) / 2;
            const calcR =
              calculateReflectivityAtWavelength(lambda, testLayers) * 100;

            if (point.useReflectivityRange) {
              if (calcR < point.reflectivityMin) {
                error += Math.pow(point.reflectivityMin - calcR, 2);
              } else if (calcR > point.reflectivityMax) {
                error += Math.pow(calcR - point.reflectivityMax, 2);
              }
            } else {
              const targetValue =
                (point.reflectivityMin + point.reflectivityMax) / 2;
              error += Math.pow(calcR - targetValue, 2);
            }
            errorCount++;
          }
        });
      }

      error = errorCount > 0 ? Math.sqrt(error / errorCount) : 0;

      // Add smoothness penalty - apply to BOTH target mode AND reverse engineering
      const { min, max, step } = wavelengthRange;
      let prevR = null;
      let smoothnessPenalty = 0;
      let smoothnessCount = 0;
      let peakCount = 0;
      let prevSlope = null;

      // Sample across full wavelength range to detect peaks and smoothness
      for (let lambda = min; lambda <= max; lambda += step * 2) {
        const calcR =
          calculateReflectivityAtWavelength(lambda, testLayers) * 100;

        if (prevR !== null) {
          const currentSlope = calcR - prevR;

          // Detect peaks (sign change in slope)
          if (
            prevSlope !== null &&
            Math.sign(currentSlope) !== Math.sign(prevSlope) &&
            Math.abs(currentSlope) > 1
          ) {
            peakCount++;
          }

          // Penalize large variations between adjacent points
          const variation = Math.abs(calcR - prevR);
          smoothnessPenalty += Math.pow(variation, 2);
          smoothnessCount++;

          prevSlope = currentSlope;
        }
        prevR = calcR;
      }

      if (smoothnessCount > 0) {
        const avgVariation = Math.sqrt(smoothnessPenalty / smoothnessCount);

        // Calculate total optical thickness (sum of n*d for each layer)
        const totalOpticalThickness = testLayers.reduce((sum, layer) => {
          const n = getRefractiveIndex(layer.material, 550); // Use 550nm as reference
          return sum + n * layer.thickness;
        }, 0);

        if (reverseEngineerMode) {
          // For reverse engineering: moderate smoothness to match data while reducing peaks
          const smoothnessError = avgVariation * 0.2; // Lighter weight to prioritize data fit
          const peakError = peakCount * 1.5; // Moderate peak penalty
          const thicknessError = totalOpticalThickness / 5000; // Slight penalty for very thick stacks
          error = error + smoothnessError + peakError + thicknessError;
        } else {
          // For target mode: use user-defined weight if minimizePeaks is checked
          const effectiveWeight = minimizePeaks ? smoothnessWeight : 0.3;
          const smoothnessError = avgVariation * effectiveWeight;
          const peakError = peakCount * 2.0; // Heavier peak penalty for target mode
          const thicknessError = totalOpticalThickness / 3000; // Encourage thinner stacks
          error = error + smoothnessError + peakError + thicknessError;
        }
      }

      // Add adhesion layer if enabled
      const layersWithAdhesion = useAdhesionLayer
        ? [
            {
              id: -1,
              material: adhesionMaterial,
              thickness: adhesionThickness,
              iad: null,
            },
            ...testLayers,
          ]
        : testLayers;

      foundSolutions.push({ layers: layersWithAdhesion, error });

      // Track best solution
      if (!bestSolution || error < bestSolution.error) {
        bestSolution = {
          layers: JSON.parse(JSON.stringify(layersWithAdhesion)),
          error,
        };
      }
    }

    // Refinement phase: Take the top 50 solutions and refine them VERY aggressively
    setOptimizationStage("Phase 2: Fine-Tuning (This may take a few minutes)");
    setOptimizationProgress(30);
    await new Promise((resolve) => setTimeout(resolve, 0));

    foundSolutions.sort((a, b) => a.error - b.error);
    const topSolutions = foundSolutions.slice(0, 50);

    // Multi-stage refinement with decreasing step sizes
    const refinementStages = [
      { iterations: 1000, adjustmentRange: 0.3 }, // ±30%
      { iterations: 1000, adjustmentRange: 0.15 }, // ±15%
      { iterations: 500, adjustmentRange: 0.05 }, // ±5% for final precision
    ];

    for (let solIdx = 0; solIdx < topSolutions.length; solIdx++) {
      setOptimizationProgress(30 + (solIdx / topSolutions.length) * 60); // 30-90%

      let baseLayers = JSON.parse(JSON.stringify(topSolutions[solIdx].layers));

      // Multi-stage refinement
      for (const stage of refinementStages) {
        for (let refineIter = 0; refineIter < stage.iterations; refineIter++) {
          const refinedLayers = baseLayers.map((layer, layerIndex) => {
            // Adaptive random adjustment based on stage
            const adjustment =
              1 -
              stage.adjustmentRange +
              Math.random() * (2 * stage.adjustmentRange);
            
            // Get layer-specific min/max if using template
            let minT = 15;
            let maxT = 300;
            if (useLayerTemplate && layerTemplate[layerIndex]) {
              minT = layerTemplate[layerIndex].minThickness || 15;
              maxT = layerTemplate[layerIndex].maxThickness || 300;
            }
            
            const newThickness = Math.max(
              minT,
              Math.min(maxT, layer.thickness * adjustment)
            );
            return { ...layer, thickness: newThickness };
          });

          // Calculate error
          let error = 0;
          let errorCount = 0;

          if (colorTargetMode) {
            // Color target mode: minimize ΔE* from target color
            const colorResult = calculateStackColorDeltaE(
              refinedLayers,
              currentStackId,
              targetColorL,
              targetColorA,
              targetColorB
            );
            const deltaE = colorResult.deltaE;
            
            // Check if we should combine with reflectivity targets
            if (colorWeight < 100 && designPoints.length > 0) {
              // Calculate reflectivity error using same method as normal mode
              let reflectivityError = 0;
              let reflectivityCount = 0;
              
              designPoints.forEach((point) => {
                if (point.useWavelengthRange) {
                  const numSamples = 5;
                  const step = (point.wavelengthMax - point.wavelengthMin) / (numSamples - 1);
                  for (let i = 0; i < numSamples; i++) {
                    const lambda = point.wavelengthMin + i * step;
                    const calcR = calculateReflectivityAtWavelength(lambda, refinedLayers) * 100;
                    if (point.useReflectivityRange) {
                      if (calcR < point.reflectivityMin) {
                        reflectivityError += Math.pow(point.reflectivityMin - calcR, 2);
                        reflectivityCount++;
                      } else if (calcR > point.reflectivityMax) {
                        reflectivityError += Math.pow(calcR - point.reflectivityMax, 2);
                        reflectivityCount++;
                      }
                    } else {
                      const targetValue = (point.reflectivityMin + point.reflectivityMax) / 2;
                      reflectivityError += Math.pow(calcR - targetValue, 2);
                      reflectivityCount++;
                    }
                  }
                } else {
                  const calcR = calculateReflectivityAtWavelength(point.wavelength || point.wavelengthMin, refinedLayers) * 100;
                  if (point.useReflectivityRange) {
                    if (calcR < point.reflectivityMin) {
                      reflectivityError += Math.pow(point.reflectivityMin - calcR, 2);
                      reflectivityCount++;
                    } else if (calcR > point.reflectivityMax) {
                      reflectivityError += Math.pow(calcR - point.reflectivityMax, 2);
                      reflectivityCount++;
                    }
                  } else {
                    const targetValue = (point.reflectivityMin + point.reflectivityMax) / 2;
                    reflectivityError += Math.pow(calcR - targetValue, 2);
                    reflectivityCount++;
                  }
                }
              });
              
              const avgReflectivityError = reflectivityCount > 0 ? Math.sqrt(reflectivityError / reflectivityCount) : 0;
              
              // Combine errors based on weight
              const colorFraction = colorWeight / 100;
              const reflectivityFraction = 1 - colorFraction;
              error = (colorFraction * deltaE) + (reflectivityFraction * avgReflectivityError);
            } else {
              // Color only
              error = deltaE;
            }

            // Angle color constraints
            if (angleColorConstraints.length > 0) {
              let angleError = 0;
              const normalColor = colorResult;

              angleColorConstraints.forEach(constraint => {
                if (constraint.mode === 'maxShift') {
                  const angleColor = calculateStackColorDeltaE(
                    refinedLayers, currentStackId, normalColor.L, normalColor.a, normalColor.b, constraint.angle
                  );
                  if (angleColor.deltaE > constraint.maxDeltaE) {
                    angleError += Math.pow(angleColor.deltaE - constraint.maxDeltaE, 2);
                  }
                } else if (constraint.mode === 'target') {
                  const angleColor = calculateStackColorDeltaE(
                    refinedLayers, currentStackId, constraint.targetL, constraint.targetA, constraint.targetB, constraint.angle
                  );
                  angleError += Math.pow(angleColor.deltaE, 2);
                }
              });

              if (angleError > 0) {
                const avgAngleError = Math.sqrt(angleError / angleColorConstraints.length);
                const avgWeight = angleColorConstraints.reduce((sum, c) => sum + c.weight, 0) / angleColorConstraints.length / 100;
                error += avgAngleError * avgWeight * 10;
              }
            }

            errorCount = 1;
          } else if (reverseEngineerMode) {
            reverseEngineerData.forEach((dataPoint) => {
              let calcR = calculateReflectivityAtWavelength(
                dataPoint.wavelength,
                refinedLayers
              );
              
              // Apply double-sided correction if enabled (matches how CSV was measured)
              if (doubleSidedAR) {
                calcR = calcR + Math.pow(1 - calcR, 2) * calcR;
              }
              
              calcR = calcR * 100;
              error += Math.pow(calcR - dataPoint.reflectivity, 2);
              errorCount++;
            });
          } else {
            designPoints.forEach((point) => {
              if (point.useWavelengthRange) {
                const numSamples = 5;
                const step =
                  (point.wavelengthMax - point.wavelengthMin) /
                  (numSamples - 1);
                for (let i = 0; i < numSamples; i++) {
                  const lambda = point.wavelengthMin + i * step;
                  const calcR =
                    calculateReflectivityAtWavelength(lambda, refinedLayers) *
                    100;

                  if (point.useReflectivityRange) {
                    if (calcR < point.reflectivityMin) {
                      error += Math.pow(point.reflectivityMin - calcR, 2);
                      errorCount++;
                    } else if (calcR > point.reflectivityMax) {
                      error += Math.pow(calcR - point.reflectivityMax, 2);
                      errorCount++;
                    }
                  } else {
                    const targetValue =
                      (point.reflectivityMin + point.reflectivityMax) / 2;
                    error += Math.pow(calcR - targetValue, 2);
                    errorCount++;
                  }
                }
              } else {
                const lambda = (point.wavelengthMin + point.wavelengthMax) / 2;
                const calcR =
                  calculateReflectivityAtWavelength(lambda, refinedLayers) *
                  100;

                if (point.useReflectivityRange) {
                  if (calcR < point.reflectivityMin) {
                    error += Math.pow(point.reflectivityMin - calcR, 2);
                  } else if (calcR > point.reflectivityMax) {
                    error += Math.pow(calcR - point.reflectivityMax, 2);
                  }
                } else {
                  const targetValue =
                    (point.reflectivityMin + point.reflectivityMax) / 2;
                  error += Math.pow(calcR - targetValue, 2);
                }
                errorCount++;
              }
            });
          }

          error = errorCount > 0 ? Math.sqrt(error / errorCount) : 0;

          // Add smoothness penalties (lighter during refinement)
          const { min, max, step } = wavelengthRange;
          let prevR = null;
          let smoothnessPenalty = 0;
          let smoothnessCount = 0;
          let peakCount = 0;
          let prevSlope = null;

          for (let lambda = min; lambda <= max; lambda += step * 2) {
            const calcR =
              calculateReflectivityAtWavelength(lambda, refinedLayers) * 100;

            if (prevR !== null) {
              const currentSlope = calcR - prevR;
              if (
                prevSlope !== null &&
                Math.sign(currentSlope) !== Math.sign(prevSlope) &&
                Math.abs(currentSlope) > 1
              ) {
                peakCount++;
              }
              const variation = Math.abs(calcR - prevR);
              smoothnessPenalty += Math.pow(variation, 2);
              smoothnessCount++;
              prevSlope = currentSlope;
            }
            prevR = calcR;
          }

          if (smoothnessCount > 0) {
            const avgVariation = Math.sqrt(smoothnessPenalty / smoothnessCount);
            const totalOpticalThickness = refinedLayers.reduce((sum, layer) => {
              const n = getRefractiveIndex(layer.material, 550);
              return sum + n * layer.thickness;
            }, 0);

            if (reverseEngineerMode) {
              const smoothnessError = avgVariation * 0.15;
              const peakError = peakCount * 1.0;
              const thicknessError = totalOpticalThickness / 5000;
              error = error + smoothnessError + peakError + thicknessError;
            } else {
              const effectiveWeight = minimizePeaks ? smoothnessWeight : 0.25;
              const smoothnessError = avgVariation * effectiveWeight;
              const peakError = peakCount * 1.5;
              const thicknessError = totalOpticalThickness / 3000;
              error = error + smoothnessError + peakError + thicknessError;
            }
          }

          // Don't add adhesion layer here - it's already in refinedLayers from phase 1
          foundSolutions.push({ layers: refinedLayers, error });

          // If this refinement is better, use it as new base for next iteration
          if (foundSolutions.length > 0 && error < topSolutions[solIdx].error) {
            baseLayers = JSON.parse(JSON.stringify(refinedLayers));
            topSolutions[solIdx].error = error;
          }
        }
      }
    }

    // Final sort and filter based on user-defined error threshold
    setOptimizationStage("Phase 3: Finalizing Solutions");
    setOptimizationProgress(90);
    await new Promise((resolve) => setTimeout(resolve, 0));

    foundSolutions.sort((a, b) => a.error - b.error);

    // Use user-configurable error threshold
    const excellentSolutions = foundSolutions.filter((s) => s.error < maxErrorThreshold);

    let finalSolutions;
    if (excellentSolutions.length >= 5) {
      finalSolutions = excellentSolutions.slice(0, 5);
    } else if (excellentSolutions.length > 0) {
      // Return whatever excellent solutions we have, even if < 5
      finalSolutions = excellentSolutions.slice(0, 5);
      console.log(
        `Found ${excellentSolutions.length} solutions with <${maxErrorThreshold}% error`
      );
    } else {
      // No solutions meet the criteria
      const bestError =
        foundSolutions.length > 0 ? foundSolutions[0].error.toFixed(2) : "N/A";
      showToast(`No solutions found with error <${maxErrorThreshold}%. Best error: ${bestError}%. Try increasing Max Error threshold, adding layers, widening thickness ranges, or using different materials.`, 'error');
      setOptimizing(false);
      setOptimizationProgress(0);
      setOptimizationStage("");
      return;
    }

    // Add reflectivity data for each solution for preview charts
    const solutionsWithData = finalSolutions.map((sol, idx) => {
      const data = [];
      for (
        let wavelength = wavelengthRange.min;
        wavelength <= wavelengthRange.max;
        wavelength += wavelengthRange.step
      ) {
        const R = calculateReflectivityAtWavelength(wavelength, sol.layers);
        data.push({
          wavelength,
          reflectivity:
            displayMode === "transmission" ? (1 - R) * 100 : R * 100,
        });
      }
      
      // Calculate color info for this solution
      let solutionColorInfo = null;
      if (colorTargetMode) {
        solutionColorInfo = calculateStackColorDeltaE(
          sol.layers,
          currentStackId,
          targetColorL,
          targetColorA,
          targetColorB
        );
      }
      
      return { ...sol, chartData: data, id: idx + 1, colorInfo: solutionColorInfo };
    });

    setOptimizationProgress(100);
    setOptimizationStage("Complete!");
    setSolutions(solutionsWithData);

    // Reset progress after a short delay
    setTimeout(() => {
      setOptimizing(false);
      setOptimizationProgress(0);
      setOptimizationStage("");
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
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis
          dataKey="re"
          type="number"
          name="Re(Y)"
          label={{ value: "Re(Y) — Admittance", position: "insideBottom", offset: -5 }}
          tick={{ fontSize: 10 }}
          domain={["auto", "auto"]}
        />
        <YAxis
          dataKey="im"
          type="number"
          name="Im(Y)"
          label={{ value: "Im(Y)", angle: -90, position: "insideLeft", offset: -10 }}
          tick={{ fontSize: 10 }}
          domain={["auto", "auto"]}
        />
        <Tooltip content={admittanceTooltipContent} />
        <Legend wrapperStyle={{ fontSize: "10px", paddingTop: "10px" }} verticalAlign="bottom" />
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
        <CartesianGrid strokeDasharray="3 3" />
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
          label={{ value: "Depth (nm)", position: "insideBottom", offset: -5 }}
          tick={{ fontSize: 10 }}
          domain={["auto", "auto"]}
        />
        <YAxis
          label={{ value: "|E|\u00B2 / |E\u2080|\u00B2", angle: -90, position: "insideLeft", offset: -10 }}
          tick={{ fontSize: 10 }}
          domain={[0, "auto"]}
        />
        <Tooltip
          content={({ payload, label }) => {
            if (payload && payload.length > 0) {
              const d = payload[0].payload;
              return (
                <div className="bg-white border rounded p-2 text-xs shadow">
                  <div className="font-semibold">{d.material || ""}</div>
                  <div>Depth: {d.depth?.toFixed(1)} nm</div>
                  {payload.map((p, i) => (
                    <div key={i} style={{ color: p.color }}>{p.name}: {p.value?.toFixed(4)}</div>
                  ))}
                </div>
              );
            }
            return null;
          }}
        />
        <Legend wrapperStyle={{ fontSize: "10px", paddingTop: "10px" }} verticalAlign="bottom" />
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

  return (
    <div className="w-full h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-2 overflow-hidden">
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
        <div className="flex gap-1 mb-2 flex-shrink-0">
          <button
            onClick={() => setActiveTab("designer")}
            className={`px-4 py-2 rounded-t font-semibold transition-colors ${
              activeTab === "designer"
                ? "bg-white text-indigo-600 shadow"
                : "bg-indigo-100 text-gray-600 hover:bg-indigo-200"
            }`}
          >
            Thin-Film Designer
          </button>
          <button
            onClick={() => setActiveTab("assistant")}
            className={`px-4 py-2 rounded-t font-semibold transition-colors flex items-center gap-2 ${
              activeTab === "assistant"
                ? "bg-white text-indigo-600 shadow"
                : "bg-indigo-100 text-gray-600 hover:bg-indigo-200"
            }`}
          >
            <Zap size={16} />
            Design Assistant
          </button>
          <button
            onClick={() => {
              if (CLERK_ENABLED && !isSignedIn) { setUpgradeFeature('Team Collaboration'); setShowUpgradePrompt(true); return; }
              if (!requireFeature('teamCollaboration', 'Team Collaboration')) return;
              setActiveTab("team");
            }}
            className={`px-4 py-2 rounded-t font-semibold transition-colors flex items-center gap-2 ${
              activeTab === "team"
                ? "bg-white text-indigo-600 shadow"
                : "bg-indigo-100 text-gray-600 hover:bg-indigo-200"
            }`}
          >
            <Users size={16} />
            Team
          </button>
          <button
            onClick={() => setActiveTab("tracking")}
            className={`px-4 py-2 rounded-t font-semibold transition-colors flex items-center gap-2 ${
              activeTab === "tracking"
                ? "bg-white text-indigo-600 shadow"
                : "bg-indigo-100 text-gray-600 hover:bg-indigo-200"
            }`}
          >
            <Upload size={16} />
            Recipe Tracking
          </button>
          <button
            onClick={() => setActiveTab("yield")}
            className={`px-4 py-2 rounded-t font-semibold transition-colors flex items-center gap-2 ${
              activeTab === "yield"
                ? "bg-white text-indigo-600 shadow"
                : "bg-indigo-100 text-gray-600 hover:bg-indigo-200"
            }`}
          >
            <TrendingUp size={16} />
            Yield Analysis
          </button>
          {/* Right side controls */}
          <div className="ml-auto flex items-center gap-2">
            {/* Save/Load buttons */}
            <button
              onClick={() => setShowSaveModal(true)}
              className="flex items-center gap-1 px-2 py-1 rounded text-xs bg-indigo-100 text-indigo-700 hover:bg-indigo-200"
              title="Save current design"
            >
              <Save size={12} />
              <span>Save</span>
            </button>
            <button
              onClick={() => { loadDesignsList(); setShowLoadModal(true); }}
              className="flex items-center gap-1 px-2 py-1 rounded text-xs bg-indigo-100 text-indigo-700 hover:bg-indigo-200"
              title="Load a saved design"
            >
              <FolderOpen size={12} />
              <span>Load</span>
            </button>

            {/* Online/Offline indicator */}
            <div className="flex items-center gap-1 px-2 py-1 rounded-t text-xs" style={{ color: isOnline ? '#16a34a' : '#d97706' }}>
              {isOnline ? <Wifi size={14} /> : <WifiOff size={14} />}
            </div>

            {/* Auth button */}
            {CLERK_ENABLED ? (
              isSignedIn ? (
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setShowPricingModal(true)}
                    className="flex items-center gap-1 px-2 py-1 rounded text-xs bg-amber-100 text-amber-700 hover:bg-amber-200"
                    title="Manage subscription"
                  >
                    <Crown size={12} />
                    <span className="capitalize">{userTier}</span>
                  </button>
                  {tierLimits.teamCollaboration && (
                    <div style={{ position: 'relative', display: 'inline-block' }}>
                      <button
                        onClick={() => { setShowNotificationDropdown(!showNotificationDropdown); if (!showNotificationDropdown) loadNotifications(); }}
                        className="p-2 text-gray-600 hover:text-indigo-600"
                        style={{ position: 'relative', cursor: 'pointer' }}
                      >
                        <Bell size={18} />
                        {unreadNotificationCount > 0 && (
                          <span style={{
                            position: 'absolute', top: '2px', right: '2px', background: '#ef4444', color: 'white',
                            borderRadius: '50%', width: '16px', height: '16px', fontSize: '10px',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                          }}>
                            {unreadNotificationCount > 9 ? '9+' : unreadNotificationCount}
                          </span>
                        )}
                      </button>
                      {showNotificationDropdown && (
                        <div style={{
                          position: 'absolute', right: 0, top: '100%', width: '320px', background: 'white',
                          border: '1px solid #e5e7eb', borderRadius: '8px', boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                          zIndex: 50, maxHeight: '400px', overflowY: 'auto',
                        }}>
                          <div className="flex items-center justify-between p-3 border-b">
                            <span className="text-sm font-semibold">Notifications</span>
                            <button onClick={handleMarkAllNotificationsRead} className="text-xs text-indigo-600" style={{ cursor: 'pointer' }}>Mark all read</button>
                          </div>
                          {notifications.length === 0 ? (
                            <p className="text-sm text-gray-500 p-4 text-center">No notifications</p>
                          ) : notifications.map(n => (
                            <div key={n.id} onClick={() => handleNotificationClick(n)}
                              style={{ padding: '10px 12px', borderBottom: '1px solid #f3f4f6', background: n.read ? 'white' : '#f0f4ff', cursor: 'pointer' }}>
                              <p style={{ fontSize: '13px', color: '#374151', margin: 0 }}>
                                {n.type === 'team_invite' && `You were invited to team "${n.data?.teamName}"`}
                                {n.type === 'invite_accepted' && `${n.data?.memberEmail} joined "${n.data?.teamName}"`}
                                {n.type === 'design_shared' && `${n.data?.ownerName} shared "${n.data?.designName}" in ${n.data?.teamName}`}
                                {n.type === 'submission_new' && `${n.data?.submitterName} submitted changes to "${n.data?.designName}"`}
                                {n.type === 'submission_approved' && `Your submission for "${n.data?.designName}" was approved`}
                                {n.type === 'submission_denied' && `Your submission for "${n.data?.designName}" was denied`}
                                {n.type === 'comment_design' && `${n.data?.authorName} commented on "${n.data?.designName}"`}
                                {n.type === 'comment_submission' && `${n.data?.authorName} commented on submission for "${n.data?.designName}"`}
                              </p>
                              <p style={{ fontSize: '11px', color: '#9ca3af', margin: '2px 0 0' }}>{new Date(n.createdAt).toLocaleString()}</p>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                  <UserButton afterSignOutUrl={window.location.href} />
                </div>
              ) : (
                <SignInButton mode="modal">
                  <button className="flex items-center gap-1 px-3 py-1.5 rounded text-xs bg-indigo-600 text-white hover:bg-indigo-700 font-medium">
                    <LogIn size={12} />
                    <span>Sign In</span>
                  </button>
                </SignInButton>
              )
            ) : (
              <div className="flex items-center gap-1 px-2 py-1 rounded text-xs text-gray-400">
                <User size={14} />
              </div>
            )}
          </div>
        </div>

        {/* Designer Tab Content */}
        {activeTab === "designer" && (
          <>
            <div className="flex justify-between items-center mb-2 flex-shrink-0 flex-wrap gap-2">
              <h1 className="text-lg font-bold text-gray-800">
                Thin Film Coating Stack Designer
              </h1>
              <div className="flex gap-2 text-xs flex-wrap">
                <div className="bg-white px-2 py-1 rounded shadow flex items-center gap-1 flex-shrink-0">
                  <span className="text-gray-600">λ: </span>
                  <input
                    type="number"
                    value={wavelengthRange.min}
                    onChange={(e) =>
                      setWavelengthRange({
                        ...wavelengthRange,
                        min: e.target.value === "" ? 0 : Math.max(0, parseInt(e.target.value) || 0),
                      })
                    }
                    onBlur={(e) => {
                      if (e.target.value === "") {
                        setWavelengthRange({ ...wavelengthRange, min: 0 });
                      }
                    }}
                    className="w-12 px-1 border rounded"
                    min="0"
                  />
                  <span className="mx-1">-</span>
                  <input
                    type="number"
                    value={wavelengthRange.max}
                    onChange={(e) =>
                      setWavelengthRange({
                        ...wavelengthRange,
                        max: e.target.value === "" ? 0 : Math.max(0, parseInt(e.target.value) || 0),
                      })
                    }
                    onBlur={(e) => {
                      if (e.target.value === "") {
                        setWavelengthRange({ ...wavelengthRange, max: 0 });
                      }
                    }}
                    className="w-12 px-1 border rounded"
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
                <div className="bg-white px-2 py-1 rounded shadow flex items-center gap-1 flex-shrink-0">
                  <span className="text-gray-600">Y: </span>
                  <input
                    type="number"
                    value={reflectivityRange.min}
                    onChange={(e) =>
                      setReflectivityRange({
                        ...reflectivityRange,
                        min: e.target.value === "" ? 0 : Math.max(0, safeParseFloat(e.target.value)),
                      })
                    }
                    onBlur={(e) => {
                      if (e.target.value === "") {
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
                    value={reflectivityRange.max}
                    onChange={(e) =>
                      setReflectivityRange({
                        ...reflectivityRange,
                        max: e.target.value === "" ? 0 : Math.max(0, safeParseFloat(e.target.value)),
                      })
                    }
                    onBlur={(e) => {
                      if (e.target.value === "") {
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
                <button
                  onClick={() => setShowTargetsModal(true)}
                  className="bg-white px-2 py-1 rounded shadow hover:bg-gray-50 flex items-center gap-1 flex-shrink-0"
                >
                  <Settings size={12} />
                  <span>Targets</span>
                </button>
                <button
                  onClick={() => setLayoutMode(layoutMode === "vertical" ? "horizontal" : "vertical")}
                  className="bg-white px-2 py-1 rounded shadow hover:bg-gray-50 flex items-center gap-1 flex-shrink-0"
                  title={layoutMode === "vertical" ? "Switch to side-by-side layout" : "Switch to stacked layout"}
                >
                  <span>{layoutMode === "vertical" ? "⬌" : "⬍"}</span>
                  <span>{layoutMode === "vertical" ? "Wide" : "Tall"}</span>
                </button>
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

            <div className={`flex-1 bg-white rounded-lg shadow-lg p-2 flex overflow-hidden designer-container min-h-0 ${layoutMode === "horizontal" ? "flex-row" : "flex-col"}`}>
              
              {/* In horizontal mode: Layers first (left side) */}
              {layoutMode === "horizontal" && (
                <div
                  style={{ width: `${100 - chartWidth}%`, height: "100%", paddingRight: 8 }}
                  className="flex flex-col overflow-hidden min-h-0 min-w-0"
                >
                  <div className="flex items-center gap-2 mb-1 flex-shrink-0">
                    <h2 className="text-sm font-semibold text-gray-700">Layer Stacks</h2>
                    <button onClick={addLayerStack} className="px-2 py-0.5 bg-green-600 text-white rounded hover:bg-green-700 text-xs flex items-center gap-1"><Plus size={10} /> New Stack</button>
                    <button onClick={() => deleteLayerStack(currentStackId)} disabled={layerStacks.filter((s) => s.machineId === currentMachineId).length === 0} className="px-2 py-0.5 bg-red-500 text-white rounded hover:bg-red-600 text-xs disabled:bg-gray-300 disabled:cursor-not-allowed flex items-center gap-1"><Trash2 size={10} /> Delete Stack</button>
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

                  {/* Compact Grid Header for horizontal mode */}
                  <div className="grid gap-x-1 bg-gray-100 p-1 rounded text-xs font-semibold text-gray-700 border-b-2 border-gray-300 flex-shrink-0 items-center" style={{ gridTemplateColumns: '0.8rem 1.5rem minmax(3rem, 1fr) minmax(2.5rem, 4rem) 2.5rem 2.5rem 2.5rem 3.5rem' }}>
                    <div></div>
                    <div className="text-center">#</div>
                    <div className="truncate">Material</div>
                    <div className="px-1">Thick</div>
                    <div>QWOT</div>
                    <div>Last</div>
                    <div>Orig</div>
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
                        <div className="grid gap-x-1 p-1 bg-amber-50 border-b border-gray-200 text-xs items-center" style={{ gridTemplateColumns: '0.8rem 1.5rem minmax(3rem, 1fr) minmax(2.5rem, 4rem) 2.5rem 2.5rem 2.5rem 3.5rem' }}>
                          <div></div>
                          <div className="text-center font-medium">S</div>
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
                          <div>-</div>
                          <div>-</div>
                          <div>-</div>
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
                              className={`grid gap-x-1 p-1 border-b border-gray-200 text-xs items-center hover:bg-gray-50 ${layer.locked ? "border-l-2 border-l-red-400" : ""}`}
                              style={{
                                backgroundColor: allMaterials[layer.material]?.color || "#fff",
                                gridTemplateColumns: '0.8rem 1.5rem minmax(3rem, 1fr) minmax(2.5rem, 4rem) 2.5rem 2.5rem 2.5rem 3.5rem',
                                transform: getDragTransform(idx, dragIndex, dragOverIndex),
                                transition: 'transform 0.2s ease',
                                position: 'relative',
                                zIndex: dragIndex === idx ? 2 : 0,
                                boxShadow: dragIndex === idx ? '0 2px 8px rgba(0,0,0,0.18)' : 'none',
                              }}
                              onDragEnd={() => { setDragIndex(null); setDragOverIndex(null); }}
                            >
                              <div
                                draggable
                                onDragStart={(e) => { setDragIndex(idx); e.dataTransfer.effectAllowed = "move"; const img = new Image(); img.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'; e.dataTransfer.setDragImage(img, 0, 0); handleDragStartCapture(e.currentTarget.closest('[data-drag-container]')); }}
                                className="text-gray-400 flex items-center justify-center"
                                style={{ cursor: 'grab', transition: 'color 0.15s, transform 0.15s' }}
                                title="Drag to reorder"
                                onMouseEnter={(e) => { e.currentTarget.style.color = '#6366f1'; e.currentTarget.style.transform = 'scale(1.25)'; }}
                                onMouseLeave={(e) => { e.currentTarget.style.color = ''; e.currentTarget.style.transform = ''; }}
                                onMouseDown={(e) => { e.currentTarget.style.cursor = 'grabbing'; }}
                                onMouseUp={(e) => { e.currentTarget.style.cursor = 'grab'; }}
                              ><GripVertical size={10} /></div>
                              <div className="text-center font-medium">{layerNum}</div>
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
                                  >
                                    {Object.keys(allMaterials).map((mat) => (
                                      <option key={mat} value={mat}>{mat}</option>
                                    ))}
                                    <option disabled>──────────</option>
                                    <option value="__manage__">Manage Materials...</option>
                                  </select>
                                  <div
                                    className="cursor-help text-gray-400 hover:text-blue-600 flex-shrink-0"
                                    title={(() => {
                                      const mat = allMaterials[layer.material];
                                      if (!mat) return layer.material;
                                      const n = getRefractiveIndex(layer.material, 550, layer.iad, layer.packingDensity || 1.0);
                                      const k400 = getExtinctionCoefficient(layer.material, 400);
                                      const k550 = getExtinctionCoefficient(layer.material, 550);
                                      let kInfo = "";
                                      if (mat.kType === "none") {
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
                                  </div>
                                </div>
                              </div>
                              <div>
                                <input
                                  type="number"
                                  value={layer.thickness === "" ? "" : Math.round(layer.thickness * 100) / 100}
                                  onChange={(e) => updateLayer(layer.id, "thickness", e.target.value)}
                                  className="w-full px-1 py-0.5 border rounded text-xs"
                                  step="1"
                                />
                              </div>
                              <div className="text-[10px] truncate" title={`Optical thickness: ${(getRefractiveIndex(layer.material, qwotReference, layer.iad, layer.packingDensity || 1.0) * (layer.thickness || 0)).toFixed(1)} nm`}>
                                {((getRefractiveIndex(layer.material, qwotReference, layer.iad, layer.packingDensity || 1.0) * (layer.thickness || 0)) / (qwotReference / 4)).toFixed(2)}
                              </div>
                              <div className="text-[10px] text-gray-600 truncate">
                                {layer.lastThickness ? layer.lastThickness.toFixed(1) : "-"}
                              </div>
                              <div className="text-[10px] text-gray-600 truncate">
                                {layer.originalThickness ? layer.originalThickness.toFixed(1) : "-"}
                              </div>
                              <div className="flex items-center gap-0.5">
                                {layer.packingDensity && layer.packingDensity < 1.0 && (
                                  <span className="px-0.5 bg-purple-100 text-purple-700 rounded text-[7px] font-bold" title={`Packing Density: ${layer.packingDensity.toFixed(2)}`}>
                                    P
                                  </span>
                                )}
                                <button
                                  onClick={() => setLayers(layers.map(l => l.id === layer.id ? { ...l, locked: !l.locked } : l))}
                                  className={`p-0.5 rounded transition-colors text-[10px] ${layer.locked ? "bg-red-100 text-red-600" : "text-gray-300 hover:text-gray-500"}`}
                                  title={layer.locked ? "Unlock layer (allow shift/factor)" : "Lock layer (exclude from shift/factor)"}
                                >
                                  <Lock size={10} />
                                </button>
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
                                <button
                                  onClick={() => removeLayer(layer.id)}
                                  className="p-0.5 hover:bg-red-100 rounded text-red-600"
                                  disabled={layers.length === 1}
                                >
                                  <Trash2 size={10} />
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
                        <div className="grid gap-x-1 p-1 bg-sky-50 border-b border-gray-200 text-xs items-center" style={{ gridTemplateColumns: '0.8rem 1.5rem minmax(3rem, 1fr) minmax(2.5rem, 4rem) 2.5rem 2.5rem 2.5rem 3.5rem' }}>
                          <div></div>
                          <div className="text-center font-medium">I</div>
                          <div className="truncate">{incident.material}</div>
                          <div>-</div>
                          <div>-</div>
                          <div>-</div>
                          <div>-</div>
                          <div></div>
                        </div>
                      </>
                    )}
                  </div>

                  {/* Compact Summary for horizontal mode */}
                  <div className="bg-gray-50 rounded p-1 border mt-1 flex-shrink-0">
                    <div className="text-[10px] text-gray-600 flex flex-wrap gap-2 items-center">
                      <span>Layers: {layers.length}</span>
                      <span>Total: {layers.reduce((sum, l) => sum + (parseFloat(l.thickness) || 0), 0).toFixed(0)}nm</span>
                      <span className="flex items-center gap-1">
                        QWOT λ:
                        <input
                          type="number"
                          value={qwotReference}
                          onChange={(e) => setQwotReference(parseInt(e.target.value) || 550)}
                          className="w-12 px-1 py-0.5 border rounded text-[10px]"
                          step="10"
                          min="380"
                          max="780"
                        />
                      </span>
                    </div>
                    <div className="text-[10px] text-gray-600 flex flex-wrap gap-2 items-center mt-1">
                      <span className="flex items-center gap-1">
                        Factor:
                        <input
                          type="number"
                          value={layerFactor}
                          onChange={(e) => setLayerFactor(e.target.value)}
                          className="w-12 px-1 py-0.5 border rounded text-[10px]"
                          step="0.01"
                        />
                        <button
                          onClick={applyFactorToLayers}
                          className="px-1 py-0.5 bg-indigo-600 text-white rounded text-[9px]"
                        >
                          Apply
                        </button>
                      </span>
                      <span className="flex items-center gap-1">
                        Shift:
                        <input
                          type="number"
                          value={shiftValue}
                          onChange={(e) => setShiftValue(e.target.value)}
                          className="w-12 px-1 py-0.5 border rounded text-[10px]"
                          step="1"
                        />
                        <button
                          onClick={applyShift}
                          className="px-1 py-0.5 bg-green-600 text-white rounded text-[9px]"
                          disabled={shiftMode === "up-down" || parseFloat(shiftValue) === 0}
                        >
                          Apply
                        </button>
                      </span>
                      <button
                        onClick={undoLastChange}
                        className="px-1 py-0.5 bg-orange-600 text-white rounded text-[9px]"
                        disabled={!layers.some((l) => l.lastThickness !== undefined)}
                      >
                        Undo
                      </button>
                      <button
                        onClick={resetToOriginal}
                        className="px-1 py-0.5 bg-red-600 text-white rounded text-[9px]"
                        disabled={!layers.some((l) => l.originalThickness !== undefined)}
                      >
                        Reset
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Horizontal mode divider */}
              {layoutMode === "horizontal" && (
                <div
                  className="flex items-center justify-center flex-shrink-0"
                  style={{ width: '11px', padding: '0 4px', transition: 'background-color 0.15s', backgroundClip: 'content-box', backgroundColor: '#d1d5db', cursor: 'col-resize' }}
                  onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#818cf8'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = '#d1d5db'; }}
                  onMouseDown={handleHorizontalDividerMouseDown}
                  title="Drag to resize"
                >
                </div>
              )}

              {/* Chart container - horizontal mode only */}
              {layoutMode === "horizontal" && (
              <div
                style={{ flex: 1, height: "100%" }}
                className="min-h-0 flex gap-2 flex-shrink-0"
              >
                <div className="flex-1 min-w-0 min-h-0" style={{ height: "100%" }}>
                  {displayMode === "admittance" ? renderAdmittanceChart() : displayMode === "efield" ? renderEfieldChart() : (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={reflectivityData} margin={{ top: 5, right: 20, bottom: 20, left: 10 }}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis
                        dataKey="wavelength"
                        type="number"
                        domain={[wavelengthRange.min, wavelengthRange.max]}
                        ticks={calculateXAxisTicks()}
                        label={{
                          value: "Wavelength (nm)",
                          position: "insideBottom",
                          offset: -10,
                        }}
                        tick={{ fontSize: 10 }}
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
                        }}
                        domain={[reflectivityRange.min, reflectivityRange.max]}
                        ticks={calculateYAxisTicks()}
                        tick={{ fontSize: 10 }}
                        allowDataOverflow={true}
                      />
                      {showPhase && (
                        <YAxis
                          yAxisId="right"
                          orientation="right"
                          label={{ value: "Phase (\u00B0)", angle: 90, position: "insideRight" }}
                          domain={[-180, 180]}
                          ticks={[-180, -90, 0, 90, 180]}
                          tick={{ fontSize: 10 }}
                          allowDataOverflow={true}
                        />
                      )}
                      <Tooltip />
                      <Legend wrapperStyle={{ fontSize: "10px", paddingTop: "10px" }} />

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
                              fill: "#15803d",
                              fontSize: 11,
                              fontWeight: "bold",
                            }}
                          />
                        );
                      })}

                      {layerStacks
                        .filter((s) => s.visible)
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
                      {showPhase && layerStacks.filter((s) => s.visible).map((stack) => (
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
                    </LineChart>
                  </ResponsiveContainer>
                  )}
                </div>


                {/* Enhanced Color Analysis Sidebar */}
                <div className={`bg-gray-50 rounded p-2 border flex-shrink-0 flex flex-col overflow-y-auto ${layoutMode === "horizontal" ? "w-36" : "w-48"}`} style={{ maxHeight: "100%" }}>
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
              {layoutMode === "vertical" && (
                <div className="flex flex-row flex-1 gap-2 min-h-0">
                  {/* Left column: Chart + Divider + Layers */}
                  <div className="flex-1 flex flex-col min-h-0 min-w-0">
                    {/* Chart section */}
                    <div style={{ height: `${chartHeight}%` }} className="min-h-0 flex-shrink-0">
                      {displayMode === "admittance" ? renderAdmittanceChart() : displayMode === "efield" ? renderEfieldChart() : (
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={reflectivityData} margin={{ top: 5, right: 20, bottom: 20, left: 10 }}>
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis
                            dataKey="wavelength"
                            type="number"
                            domain={[wavelengthRange.min, wavelengthRange.max]}
                            ticks={calculateXAxisTicks()}
                            label={{ value: "Wavelength (nm)", position: "insideBottom", offset: -10 }}
                            tick={{ fontSize: 10 }}
                            allowDataOverflow={false}
                          />
                          <YAxis
                            yAxisId="left"
                            label={{ value: `${displayMode === "transmission" ? "Transmission" : displayMode === "absorption" ? "Absorption" : "Reflectivity"} (%)`, angle: -90, position: "insideLeft" }}
                            domain={[reflectivityRange.min, reflectivityRange.max]}
                            ticks={calculateYAxisTicks()}
                            tick={{ fontSize: 10 }}
                            allowDataOverflow={true}
                          />
                          {showPhase && (
                            <YAxis
                              yAxisId="right"
                              orientation="right"
                              label={{ value: "Phase (\u00B0)", angle: 90, position: "insideRight" }}
                              domain={[-180, 180]}
                              ticks={[-180, -90, 0, 90, 180]}
                              tick={{ fontSize: 10 }}
                              allowDataOverflow={true}
                            />
                          )}
                          <Tooltip />
                          <Legend wrapperStyle={{ fontSize: "10px", paddingTop: "10px" }} />
                          {targets.map((target) => {
                            const x1 = Math.max(target.wavelengthMin, wavelengthRange.min);
                            const x2 = Math.min(target.wavelengthMax, wavelengthRange.max);
                            const y1 = Math.max(target.reflectivityMin, reflectivityRange.min);
                            const y2 = Math.min(target.reflectivityMax, reflectivityRange.max);
                            if (x1 >= x2 || y1 >= y2) return null;
                            return (
                              <ReferenceArea key={target.id} x1={x1} x2={x2} y1={y1} y2={y2} fill="rgba(34, 197, 94, 0.1)" stroke="rgba(34, 197, 94, 0.6)" strokeWidth={2} strokeDasharray="5 5" label={{ value: target.name, position: "insideTopLeft", fill: "#15803d", fontSize: 11, fontWeight: "bold" }} />
                            );
                          })}
                          {layerStacks.filter((s) => s.visible).map((stack) => {
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
                          {showPhase && layerStacks.filter((s) => s.visible).map((stack) => (
                            <Line key={`phase-${stack.id}`} yAxisId="right" type="monotone" dataKey={`stack_${stack.id}_phase`} stroke={stack.color} strokeWidth={1.5} strokeDasharray="6 3" strokeOpacity={0.6} dot={false} name={`${getStackDisplayName(stack)} Phase`} isAnimationActive={false} />
                          ))}
                        </LineChart>
                      </ResponsiveContainer>
                      )}
                    </div>

                    {/* Resizable Divider */}
                    <div className="flex items-center justify-center flex-shrink-0" style={{ height: '11px', padding: '4px 0', transition: 'background-color 0.15s', backgroundClip: 'content-box', backgroundColor: '#d1d5db', cursor: 'row-resize' }} onMouseDown={handleDividerMouseDown} title="Drag to resize" onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#818cf8'; }} onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = '#d1d5db'; }}>
                    </div>

                    {/* Layers section */}
                    <div style={{ height: `${100 - chartHeight - 1}%` }} className="flex flex-col overflow-hidden min-h-0 min-w-0">
                      <div className="flex justify-between items-center mb-1 flex-shrink-0">
                        <div className="flex items-center gap-2">
                          <h2 className="text-sm font-semibold text-gray-700">Layer Stacks</h2>
                          <button onClick={addLayerStack} className="px-2 py-0.5 bg-green-600 text-white rounded hover:bg-green-700 text-xs flex items-center gap-1"><Plus size={10} /> New Stack</button>
                          <button onClick={() => deleteLayerStack(currentStackId)} disabled={layerStacks.filter((s) => s.machineId === currentMachineId).length === 0} className="px-2 py-0.5 bg-red-500 text-white rounded hover:bg-red-600 text-xs disabled:bg-gray-300 disabled:cursor-not-allowed flex items-center gap-1"><Trash2 size={10} /> Delete Stack</button>
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

                      <div className="grid grid-cols-12 gap-1 bg-gray-100 p-1 rounded text-xs font-semibold text-gray-700 border-b-2 border-gray-300 flex-shrink-0">
                        <div className="col-span-1 text-center">#</div>
                        <div className="col-span-1 text-center">Type</div>
                        <div className="col-span-2">Material</div>
                        <div className="col-span-2">Thickness (nm)</div>
                        <div className="col-span-1 text-center">QWOT</div>
                        <div className="col-span-2">Last (nm)</div>
                        <div className="col-span-2">Original (nm)</div>
                        <div className="col-span-1"></div>
                      </div>

                      <div className="flex-1 min-h-0" style={{ overflowY: 'auto', overflowX: 'hidden' }}>
                        <div className="grid grid-cols-12 gap-1 p-1 bg-amber-50 border-b border-gray-200 text-xs items-center">
                          <div className="col-span-1 text-center font-medium">-</div>
                          <div className="col-span-1 text-center text-gray-600">Sub</div>
                          <div className="col-span-2"><div className="flex items-center gap-1"><input type="text" value={substrate.material} onChange={(e) => setSubstrate({ ...substrate, material: e.target.value })} className="flex-1 min-w-0 px-1 py-0.5 border rounded" /><div style={{ width: 12, flexShrink: 0 }}></div></div></div>
                          <div className="col-span-2"><input type="number" value={substrate.n} onChange={(e) => setSubstrate({ ...substrate, n: safeParseFloat(e.target.value) || 1.52 })} className="w-full px-1 py-0.5 border rounded" step="0.01" title="Substrate refractive index" /></div>
                          <div className="col-span-1 text-center">-</div>
                          <div className="col-span-2 text-left">-</div>
                          <div className="col-span-2 text-left">-</div>
                          <div className="col-span-1"></div>
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
                            key={layer.id}
                            className={`grid grid-cols-12 gap-1 p-1 border-b border-gray-200 text-xs items-center hover:bg-gray-50 ${layer.locked ? "border-l-2 border-l-red-400" : ""}`}
                            style={{
                              backgroundColor: allMaterials[layer.material]?.color || "#fff",
                              transform: getDragTransform(idx, dragIndex, dragOverIndex),
                              transition: 'transform 0.2s ease',
                              position: 'relative',
                              zIndex: dragIndex === idx ? 2 : 0,
                              boxShadow: dragIndex === idx ? '0 2px 8px rgba(0,0,0,0.18)' : 'none',
                            }}
                            onDragEnd={() => { setDragIndex(null); setDragOverIndex(null); }}
                          >
                            <div className="col-span-1 text-center font-medium flex items-center justify-center gap-0.5">
                              <span
                                draggable
                                onDragStart={(e) => { setDragIndex(idx); e.dataTransfer.effectAllowed = "move"; const img = new Image(); img.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'; e.dataTransfer.setDragImage(img, 0, 0); handleDragStartCapture(e.currentTarget.closest('[data-drag-container]')); }}
                                className="text-gray-400 inline-flex"
                                style={{ cursor: 'grab', transition: 'color 0.15s, transform 0.15s' }}
                                title="Drag to reorder"
                                onMouseEnter={(e) => { e.currentTarget.style.color = '#6366f1'; e.currentTarget.style.transform = 'scale(1.25)'; }}
                                onMouseLeave={(e) => { e.currentTarget.style.color = ''; e.currentTarget.style.transform = ''; }}
                                onMouseDown={(e) => { e.currentTarget.style.cursor = 'grabbing'; }}
                                onMouseUp={(e) => { e.currentTarget.style.cursor = 'grab'; }}
                              ><GripVertical size={10} /></span>{idx + 1}
                            </div>
                            <div className="col-span-1 text-center text-gray-600">L</div>
                            <div className="col-span-2">
                              <div className="flex items-center gap-1">
                                <select value={layer.material} onChange={(e) => { if (e.target.value === "__manage__") { setShowMaterialLibrary(true); e.target.value = layer.material; return; } updateLayer(layer.id, "material", e.target.value); }} className="flex-1 px-1 py-0.5 border rounded bg-white">
                                  {Object.keys(allMaterials).map((mat) => (<option key={mat} value={mat}>{mat}</option>))}
                                  <option disabled>──────────</option>
                                  <option value="__manage__">Manage Materials...</option>
                                </select>
                                <div
                                  className="cursor-help text-gray-400 hover:text-blue-600"
                                  title={(() => {
                                    const mat = allMaterials[layer.material];
                                    if (!mat) return layer.material;
                                    const n = getRefractiveIndex(layer.material, 550, layer.iad, layer.packingDensity || 1.0);
                                    const k400 = getExtinctionCoefficient(layer.material, 400);
                                    const k550 = getExtinctionCoefficient(layer.material, 550);
                                    let kInfo = "";
                                    if (mat.kType === "none") {
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
                                </div>
                              </div>
                            </div>
                            <div className="col-span-2"><input type="number" value={layer.thickness === 0 ? "" : layer.thickness} onChange={(e) => updateLayer(layer.id, "thickness", e.target.value === "" ? 0 : e.target.value)} className="w-full px-1 py-0.5 border rounded" step="1" /></div>
                            <div className="col-span-1 text-center text-gray-600 text-[10px]">{qwotReference > 0 ? ((getRefractiveIndex(layer.material, qwotReference, layer.iad) * (parseFloat(layer.thickness) || 0)) / (qwotReference / 4)).toFixed(2) : "-"}</div>
                            <div className="col-span-2 text-left text-gray-600 text-[10px]">{layer.lastThickness ? layer.lastThickness.toFixed(2) : "-"}</div>
                            <div className="col-span-2 text-left text-gray-600 text-[10px]">{layer.originalThickness ? layer.originalThickness.toFixed(2) : "-"}</div>
                            <div className="col-span-1 text-center flex justify-center gap-0.5">
                              <button onClick={() => setLayers(layers.map(l => l.id === layer.id ? { ...l, locked: !l.locked } : l))} className={`p-0.5 rounded transition-colors ${layer.locked ? "bg-red-100 text-red-600" : "text-gray-300 hover:text-gray-500"}`} title={layer.locked ? "Unlock layer (allow shift/factor)" : "Lock layer (exclude from shift/factor)"}><Lock size={12} /></button>
                              <button onClick={() => { setLayers(layers.map(l => l.id === layer.id ? { ...l, originalThickness: l.originalThickness ? undefined : l.thickness } : l)); }} className={`p-0.5 rounded ${layer.originalThickness ? "bg-green-100 text-green-600 hover:bg-red-100 hover:text-red-600" : "hover:bg-green-100 text-gray-400"}`} title={layer.originalThickness ? "Click to clear original" : "Save as original thickness"}>{"\uD83D\uDCCC"}</button>
                              <button onClick={() => openIADModal(layer.id)} className={`p-0.5 rounded transition-colors ${layer.iad && layer.iad.enabled ? "bg-yellow-100 text-yellow-600 hover:bg-yellow-200" : "hover:bg-gray-100 text-gray-400"}`} title="IAD Settings"><Zap size={12} /></button>
                              <button onClick={() => removeLayer(layer.id)} className="p-0.5 hover:bg-red-100 rounded text-red-600" disabled={layers.length === 1}><Trash2 size={12} /></button>
                            </div>
                          </div>
                          <div className="relative border-b border-gray-300" style={{ height: "1px", zIndex: 3 }}>
                            <button onClick={() => insertLayerAfter(idx)} className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 bg-white hover:bg-green-100 rounded-full text-green-600 border border-gray-300 hover:border-green-500 transition-colors shadow-sm" title={`Insert layer after layer ${idx + 1}`}><Plus size={10} /></button>
                          </div>
                          </React.Fragment>
                        ))}
                        </div>

                        <div className="grid grid-cols-12 gap-1 p-1 bg-sky-50 border-b border-gray-200 text-xs items-center">
                          <div className="col-span-1 text-center font-medium">-</div>
                          <div className="col-span-1 text-center text-gray-600">Inc</div>
                          <div className="col-span-2"><input type="text" value={incident.material} onChange={(e) => setIncident({ ...incident, material: e.target.value })} className="w-full px-1 py-0.5 border rounded" /></div>
                          <div className="col-span-2 text-center">-</div>
                          <div className="col-span-1 text-center">-</div>
                          <div className="col-span-2 text-left">-</div>
                          <div className="col-span-2 text-left">-</div>
                          <div className="col-span-1"></div>
                        </div>
                      </div>

                      <div className="bg-gray-50 rounded p-1.5 border mt-1 flex-shrink-0">
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
                      </div>
                    </div>
                  </div>

                  {/* Right column: Color Analysis Sidebar */}
                  <div className="w-48 flex-shrink-0 bg-gray-50 rounded p-2 border flex flex-col overflow-y-auto">
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

        {/* Design Assistant Tab Content */}
        {activeTab === "assistant" && (
          <div className="flex-1 bg-white rounded-lg shadow-lg p-4 overflow-hidden flex flex-col min-h-0">
            <h2 className="text-xl font-bold text-gray-800 mb-3">
              Design Assistant
            </h2>
            <p className="text-sm text-gray-600 mb-4">
              Define target reflectivity points or upload a CSV file to reverse
              engineer a layer stack.
            </p>

            {/* Mode Selection */}
            <div className="mb-4 p-3 bg-blue-50 rounded border border-blue-200">
              <div className="flex gap-4 flex-wrap">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    checked={!reverseEngineerMode && !colorTargetMode}
                    onChange={() => { setReverseEngineerMode(false); setColorTargetMode(false); }}
                    className="cursor-pointer"
                  />
                  <span className="text-sm font-medium">Target Point Mode</span>
                </label>
                <label className={`flex items-center gap-2 ${tierLimits.reverseEngineer ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'}`}>
                  <input
                    type="radio"
                    checked={reverseEngineerMode}
                    disabled={!tierLimits.reverseEngineer}
                    onChange={() => {
                      if (!tierLimits.reverseEngineer) { setUpgradeFeature('Reverse Engineer mode'); setShowUpgradePrompt(true); return; }
                      setReverseEngineerMode(true); setColorTargetMode(false);
                    }}
                    className={tierLimits.reverseEngineer ? "cursor-pointer" : "cursor-not-allowed"}
                  />
                  <span className="text-sm font-medium">
                    Reverse Engineer CSV{!tierLimits.reverseEngineer ? ' 🔒' : ''}
                  </span>
                </label>
                <label className={`flex items-center gap-2 ${tierLimits.colorTargetMode ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'}`}>
                  <input
                    type="radio"
                    checked={colorTargetMode}
                    disabled={!tierLimits.colorTargetMode}
                    onChange={() => {
                      if (!tierLimits.colorTargetMode) { setUpgradeFeature('Color Target mode'); setShowUpgradePrompt(true); return; }
                      setColorTargetMode(true); setReverseEngineerMode(false);
                    }}
                    className={tierLimits.colorTargetMode ? "cursor-pointer" : "cursor-not-allowed"}
                  />
                  <span className="text-sm font-medium">
                    Color Target Mode{!tierLimits.colorTargetMode ? ' 🔒' : ''}
                  </span>
                </label>
                <div className="border-l border-blue-300 pl-4 ml-2">
                  <label 
                    className="flex items-center gap-2 cursor-pointer"
                    title="Enable if measured without black backing (includes backside reflection)"
                  >
                    <input
                      type="checkbox"
                      checked={doubleSidedAR}
                      onChange={(e) => setDoubleSidedAR(e.target.checked)}
                      className="cursor-pointer"
                    />
                    <span className="text-sm font-medium">+Backside</span>
                  </label>
                </div>
              </div>

              {reverseEngineerMode && (
                <div className="mt-3 p-2 bg-white rounded border">
                  <label className="text-xs font-semibold text-gray-700 mb-2 block">
                    Upload Reflectivity CSV:
                  </label>
                  {!reverseEngineerData ? (
                    <label className="cursor-pointer flex items-center gap-2 px-3 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700 w-fit">
                      <Upload size={14} />
                      <span className="text-sm">Choose CSV File</span>
                      <input
                        type="file"
                        accept=".csv"
                        onChange={handleReverseEngineerUpload}
                        className="hidden"
                      />
                    </label>
                  ) : (
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-green-600 font-medium">
                        ✓ Loaded {reverseEngineerData.length} data points
                      </span>
                      <button
                        onClick={clearReverseEngineerData}
                        className="px-2 py-1 bg-red-500 text-white rounded hover:bg-red-600 text-xs flex items-center gap-1"
                      >
                        <X size={12} />
                        Clear
                      </button>
                    </div>
                  )}
                  <p className="text-[10px] text-gray-500 mt-2">
                    CSV format: wavelength (nm), reflectivity (%)
                  </p>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4 flex-1 overflow-hidden min-h-0">
              {/* Left: Configuration */}
              <div className="flex flex-col overflow-hidden min-h-0">
                
                {/* Scrollable content area */}
                <div className="flex-1 overflow-y-auto min-h-0 pr-2">
                
                {colorTargetMode && (
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
                        50k=fast, 200k=normal, 500k=thorough
                      </p>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
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
                                  // Alternate between SiO2 and ZrO2 by default
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
                          <label className="text-xs text-gray-600">
                            Materials to Use (will alternate automatically):
                          </label>
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
                          checked={minimizePeaks}
                          onChange={(e) => setMinimizePeaks(e.target.checked)}
                          className="cursor-pointer"
                        />
                        Minimize Reflectivity Peaks
                      </label>
                      {minimizePeaks && (
                        <div className="ml-5">
                          <label className="text-xs text-gray-600">
                            Smoothness Weight (0-1):
                          </label>
                          <input
                            type="number"
                            value={smoothnessWeight}
                            onChange={(e) =>
                              setSmoothnessWeight(
                                e.target.value === "" ? "" : safeParseFloat(e.target.value)
                              )
                            }
                            onBlur={(e) => {
                              if (e.target.value === "") {
                                setSmoothnessWeight(0);
                              }
                            }}
                            className="w-full px-2 py-1 border rounded text-sm"
                            min="0"
                            max="1"
                            step="0.1"
                          />
                          <p className="text-[10px] text-gray-500 mt-1">
                            Higher values prioritize smoother curves over target
                            accuracy
                          </p>
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

                <div className="flex-1 min-h-0 overflow-y-auto pr-2">
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
                        className="mt-2 w-full py-2 bg-green-600 text-white rounded hover:bg-green-700 flex items-center justify-center gap-1"
                      >
                        <Plus size={14} /> Add Target Specification
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
                
                </div>
                {/* End scrollable content area */}

                <button
                  onClick={optimizeDesign}
                  disabled={
                    optimizing ||
                    (!reverseEngineerMode && designPoints.length === 0) ||
                    (reverseEngineerMode && !reverseEngineerData) ||
                    designMaterials.length === 0
                  }
                  className="mt-3 w-full py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center justify-center gap-2 flex-shrink-0"
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
                      This may take 1-3 minutes for best results (&lt;3% error)
                    </p>
                  </div>
                )}
              </div>

              {/* Right: Solutions */}
              <div className="flex flex-col overflow-hidden min-h-0">
                <h3 className="text-sm font-semibold mb-2 flex-shrink-0">
                  Solutions (Top 5, Error &lt; {maxErrorThreshold}%)
                </h3>
                <div className="flex-1 overflow-y-auto space-y-3 min-h-0">
                  {solutions.length === 0 ? (
                    <div className="text-center text-gray-500 text-sm py-8">
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
                            {colorTargetMode 
                              ? `ΔE* ${solution.error.toFixed(2)}` 
                              : `${solution.error.toFixed(2)}% error`}
                          </span>
                        </div>

                        {/* Color Swatch for Color Target Mode */}
                        {colorTargetMode && solution.colorInfo && (
                          <div className="mb-2 p-2 bg-white rounded border flex items-center gap-3">
                            <div
                              className="w-12 h-12 rounded border-2 border-gray-300 shadow-inner flex-shrink-0"
                              style={{ backgroundColor: solution.colorInfo.rgb }}
                              title={`L*=${solution.colorInfo.L.toFixed(1)} a*=${solution.colorInfo.a.toFixed(1)} b*=${solution.colorInfo.b.toFixed(1)}`}
                            ></div>
                            <div className="text-xs">
                              <div className="font-semibold text-gray-700">Resulting Color</div>
                              <div>L*: {solution.colorInfo.L.toFixed(1)}</div>
                              <div>a*: {solution.colorInfo.a.toFixed(1)}</div>
                              <div>b*: {solution.colorInfo.b.toFixed(1)}</div>
                            </div>
                            <div className="ml-auto text-right">
                              <div className="text-xs text-gray-500">Target</div>
                              <div className="text-xs">L*: {targetColorL}</div>
                              <div className="text-xs">a*: {targetColorA}</div>
                              <div className="text-xs">b*: {targetColorB}</div>
                            </div>
                          </div>
                        )}

                        {/* Preview Chart */}
                        {solution.chartData && (
                          <div className="mb-2 bg-white p-2 rounded border">
                            <ResponsiveContainer width="100%" height={120}>
                              <LineChart data={solution.chartData}>
                                <CartesianGrid
                                  strokeDasharray="3 3"
                                  stroke="#e5e7eb"
                                />
                                <XAxis
                                  dataKey="wavelength"
                                  tick={{ fontSize: 8 }}
                                  stroke="#9ca3af"
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
                                  tick={{ fontSize: 8 }}
                                  stroke="#9ca3af"
                                />
                                <Tooltip
                                  contentStyle={{ fontSize: "10px" }}
                                  labelStyle={{ fontSize: "10px" }}
                                />
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
                                backgroundColor:
                                  allMaterials[layer.material].color,
                                padding: "2px 4px",
                                borderRadius: "2px",
                              }}
                            >
                              <span>
                                Layer {lidx + 1}: {layer.material}
                              </span>
                              <span>{layer.thickness.toFixed(1)} nm</span>
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
              <div className="flex-1 overflow-hidden flex gap-3">
                {/* Left Panel - Controls and Runs List */}
                <div className="w-48 flex-shrink-0 flex flex-col gap-2" style={{ overflowY: 'auto', overflowX: 'hidden' }}>
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
                                <CartesianGrid strokeDasharray="3 3" />
                                <XAxis dataKey="wavelength" type="number" domain={["dataMin", "dataMax"]}
                                  label={{ value: "Wavelength (nm)", position: "insideBottom", offset: -5, style: { fontSize: 12 } }} />
                                <YAxis label={{ value: "Reflectivity (%)", angle: -90, position: "insideLeft", style: { fontSize: 12 } }} />
                                <Tooltip
                                  content={({ active, payload, label }) => {
                                    if (!active || !payload || !payload.length) return null;
                                    const meanEntry = payload.find(p => p.dataKey === 'mean');
                                    const targetEntry = payload.find(p => p.dataKey === 'designTarget');
                                    const meanVal = meanEntry ? meanEntry.value : null;
                                    const upperEntry = payload.find(p => p.dataKey === 'upperBound');
                                    const sigma = (upperEntry && meanEntry) ? (upperEntry.value - meanEntry.value) : null;
                                    return (
                                      <div style={{ background: '#fff', border: '1px solid #d1d5db', borderRadius: 4, padding: '4px 8px', fontSize: 11, lineHeight: 1.4, boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
                                        <div style={{ fontWeight: 600, color: '#374151' }}>{label} nm</div>
                                        {meanVal != null && <div style={{ color: '#4f46e5' }}>Mean: {meanVal.toFixed(2)}%</div>}
                                        {sigma != null && <div style={{ color: '#6b7280' }}>{'\u00B1'}{'\u03C3'}: {sigma.toFixed(2)}%</div>}
                                        {targetEntry && targetEntry.value != null && <div style={{ color: '#dc2626' }}>Target: {targetEntry.value.toFixed(2)}%</div>}
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
                                <Line type="monotone" dataKey="upperBound" stroke="#9ca3af" strokeWidth={1} strokeDasharray="5 5" name="Mean + σ" dot={false} />
                                <Line type="monotone" dataKey="lowerBound" stroke="#9ca3af" strokeWidth={1} strokeDasharray="5 5" name="Mean - σ" dot={false} />

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
                                    <CartesianGrid strokeDasharray="3 3" />
                                    <XAxis dataKey="runIndex" label={{ value: "Run #", position: "insideBottom", offset: -5, style: { fontSize: 12 } }} />
                                    <YAxis label={{ value: "Reflectivity (%)", angle: -90, position: "insideLeft", style: { fontSize: 12 } }} />
                                    <Tooltip
                                      content={({ active, payload, label }) => {
                                        if (!active || !payload || !payload.length) return null;
                                        const run = sortedRuns[label - 1];
                                        return (
                                          <div style={{ background: '#fff', border: '1px solid #d1d5db', borderRadius: 4, padding: '4px 8px', fontSize: 11, lineHeight: 1.4, boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
                                            <div style={{ fontWeight: 600, color: '#374151' }}>{run?.filename || `Run ${label}`}</div>
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
                                <CartesianGrid strokeDasharray="3 3" />
                                <XAxis dataKey="wavelength" type="number" domain={["dataMin", "dataMax"]}
                                  label={{ value: "Wavelength (nm)", position: "insideBottom", offset: -5, style: { fontSize: 12 } }} />
                                <YAxis label={{ value: "Reflectivity Difference (%)", angle: -90, position: "insideLeft", style: { fontSize: 12 } }} />
                                <Tooltip
                                  content={({ active, payload, label }) => {
                                    if (!active || !payload || !payload.length) return null;
                                    const diff = payload.find(p => p.dataKey === 'difference');
                                    return (
                                      <div style={{ background: '#fff', border: '1px solid #d1d5db', borderRadius: 4, padding: '4px 8px', fontSize: 11, lineHeight: 1.4, boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
                                        <div style={{ fontWeight: 600, color: '#374151' }}>{label} nm</div>
                                        {diff && <div style={{ color: '#4f46e5' }}>Δ: {diff.value?.toFixed(3)}%</div>}
                                      </div>
                                    );
                                  }}
                                />
                                <Legend />
                                <ReferenceLine y={0} stroke="#9ca3af" strokeDasharray="3 3" />
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
                          <div style={{ fontSize: 9, fontWeight: 600, color: '#1e40af', marginBottom: 2 }}>CIE Lab</div>
                          <div style={{ fontSize: 10, color: '#374151' }}>
                            <div className="flex justify-between"><span>L*:</span><span className="font-semibold">{trackingColor.L}</span></div>
                            <div className="flex justify-between"><span>a*:</span><span className="font-semibold">{trackingColor.a_star}</span></div>
                            <div className="flex justify-between"><span>b*:</span><span className="font-semibold">{trackingColor.b_star}</span></div>
                          </div>
                        </div>
                        <div className="bg-purple-50 rounded p-1.5 mb-1">
                          <div style={{ fontSize: 9, fontWeight: 600, color: '#6b21a8', marginBottom: 2 }}>LCh</div>
                          <div style={{ fontSize: 10, color: '#374151' }}>
                            <div className="flex justify-between"><span>C:</span><span className="font-semibold">{trackingColor.C}</span></div>
                            <div className="flex justify-between"><span>h:</span><span className="font-semibold">{trackingColor.h}°</span></div>
                          </div>
                        </div>
                        <div style={{ fontSize: 10, color: '#374151' }}>
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
                              <div style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: color?.rgb || '#ccc', flexShrink: 0, border: '1px solid #d1d5db' }} />
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
          <div className="flex-1 bg-white rounded-lg shadow-lg p-4 overflow-y-auto flex flex-col min-h-0">
            <details className="bg-gray-50 rounded mb-3 flex-shrink-0" open>
              <summary className="p-3 cursor-pointer select-none font-semibold text-lg hover:bg-gray-100 rounded">
                Monte Carlo Yield Simulation
              </summary>
              <div className="px-3 pb-3">
                <p className="text-sm text-gray-600 mb-4">
                  Predict manufacturing yield by simulating thousands of coating
                  runs with realistic process variations.
                </p>

                <div className="grid grid-cols-2 gap-4">
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
                  disabled={mcRunning || targets.length === 0}
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
                                <CartesianGrid strokeDasharray="3 3" />
                                <XAxis dataKey="range" tick={{ fontSize: 9 }} />
                                <YAxis tick={{ fontSize: 9 }} />
                                <Tooltip
                                  formatter={(value, name, props) => [
                                    value,
                                    props.payload.label,
                                  ]}
                                  labelFormatter={(label) => `ΔE*: ${label}`}
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
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis
                              dataKey="range"
                              tick={{ fontSize: 8 }}
                              angle={-45}
                              textAnchor="end"
                              height={60}
                            />
                            <YAxis tick={{ fontSize: 10 }} />
                            <Tooltip />
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
                                              backgroundColor:
                                                allMaterials[
                                                  layer.material
                                                ].color,
                                              padding: "1px 2px",
                                              borderRadius: "2px",
                                            }}
                                          >
                                            <span>
                                              L{lidx + 1}: {layer.material}
                                            </span>
                                            <span>
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
                                              backgroundColor:
                                                allMaterials[
                                                  layer.material
                                                ].color,
                                              padding: "1px 2px",
                                              borderRadius: "2px",
                                            }}
                                          >
                                            <span>
                                              L{lidx + 1}: {layer.material}
                                            </span>
                                            <span>
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

                <div className="grid grid-cols-2 gap-4">
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
                              <CartesianGrid strokeDasharray="3 3" />
                              <XAxis type="number" tick={{ fontSize: 10 }} />
                              <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={65} />
                              <Tooltip formatter={(value) => [`${value}`, "Sensitivity"]} />
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
                                    <CartesianGrid strokeDasharray="3 3" />
                                    <XAxis
                                      dataKey="wavelength"
                                      type="number"
                                      domain={[wavelengthRange.min, wavelengthRange.max]}
                                      tick={{ fontSize: 10 }}
                                    />
                                    <YAxis tick={{ fontSize: 10 }} />
                                    <Tooltip
                                      formatter={(value) => [
                                        parseFloat(value).toFixed(4),
                                        "|dR/dt|",
                                      ]}
                                      labelFormatter={(label) => `${label} nm`}
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
        {/* ========== TEAM TAB CONTENT ========== */}
        {activeTab === "team" && (
          <div className="flex-1 bg-white rounded-lg shadow-lg p-4 overflow-y-auto flex flex-col min-h-0">
            {/* Back navigation */}
            {teamView !== 'list' && (
              <button
                onClick={() => {
                  if (teamView === 'design') { setTeamView('detail'); setSelectedSharedDesign(null); }
                  else { setTeamView('list'); setSelectedTeamId(null); setSelectedTeamDetail(null); setTeamDesigns([]); }
                }}
                className="mb-3 text-sm text-indigo-600 hover:text-indigo-800 flex items-center gap-1"
                style={{ cursor: 'pointer' }}
              >
                <span style={{ fontSize: '16px' }}>&larr;</span> Back
              </button>
            )}

            {teamLoading && <div className="text-center text-gray-500 py-8">Loading...</div>}

            {/* ---- TEAM LIST VIEW ---- */}
            {!teamLoading && teamView === 'list' && (
              <div>
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2"><Users size={20} /> Teams</h2>
                  <button onClick={() => setShowCreateTeamModal(true)} className="px-3 py-1.5 bg-indigo-600 text-white text-sm rounded hover:bg-indigo-700 flex items-center gap-1" style={{ cursor: 'pointer' }}>
                    <Plus size={14} /> Create Team
                  </button>
                </div>

                {/* Pending invitations banner */}
                {pendingInvitations.length > 0 && (
                  <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                    <p className="text-sm font-semibold text-amber-800 mb-2">Pending Invitations</p>
                    {pendingInvitations.map(inv => (
                      <div key={inv.id} className="flex items-center justify-between py-1.5">
                        <span className="text-sm text-gray-700">Team: <strong>{inv.teamName || inv.team?.name || 'Unknown'}</strong></span>
                        <div className="flex gap-2">
                          <button onClick={() => handleAcceptInvitation(inv.id)} className="px-2 py-1 text-xs bg-green-600 text-white rounded hover:bg-green-700" style={{ cursor: 'pointer' }}>Accept</button>
                          <button onClick={() => handleDeclineInvitation(inv.id)} className="px-2 py-1 text-xs bg-red-500 text-white rounded hover:bg-red-600" style={{ cursor: 'pointer' }}>Decline</button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Teams grid */}
                {teams.length === 0 ? (
                  <div className="text-center py-16 text-gray-400">
                    <Users size={48} className="mx-auto mb-3 text-gray-300" />
                    <p className="text-lg font-medium">No teams yet</p>
                    <p className="text-sm">Create a team to start collaborating on coating designs.</p>
                  </div>
                ) : (
                  <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
                    {teams.map(team => (
                      <div key={team.id} onClick={() => { setSelectedTeamId(team.id); setTeamView('detail'); loadTeamDetail(team.id); }}
                        className="p-4 border rounded-lg hover:border-indigo-300 hover:shadow-md transition-all"
                        style={{ cursor: 'pointer' }}>
                        <h3 className="font-semibold text-gray-800">{team.name}</h3>
                        <div className="flex items-center gap-4 mt-2 text-xs text-gray-500">
                          <span>{team.memberCount || team._count?.members || 0} members</span>
                          <span>{team.designCount || team._count?.sharedDesigns || 0} designs</span>
                        </div>
                        <span className="inline-block mt-2 px-2 py-0.5 text-xs rounded" style={{
                          background: team.role === 'admin' ? '#dbeafe' : '#f3f4f6',
                          color: team.role === 'admin' ? '#1e40af' : '#6b7280',
                        }}>{team.role}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ---- TEAM DETAIL VIEW ---- */}
            {!teamLoading && teamView === 'detail' && selectedTeamDetail && (
              <div className="flex gap-4 flex-1 min-h-0">
                {/* Left sidebar - members */}
                <div style={{ width: '220px', flexShrink: 0 }} className="border-r pr-4 overflow-y-auto">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-bold text-gray-700">Members</h3>
                    {(selectedTeamDetail.myRole === 'admin') && (
                      <button onClick={() => setShowInviteModal(true)} className="text-indigo-600 hover:text-indigo-800" style={{ cursor: 'pointer' }} title="Invite member">
                        <UserPlus size={16} />
                      </button>
                    )}
                  </div>
                  {(selectedTeamDetail.members || []).map(m => (
                    <div key={m.id} className="flex items-center justify-between py-1.5 text-sm">
                      <div className="flex items-center gap-2">
                        <span className="text-gray-700">{m.user?.name || m.user?.email || m.email || 'Unknown'}</span>
                        {m.role === 'admin' && <Crown size={12} className="text-amber-500" />}
                      </div>
                    </div>
                  ))}
                  {(selectedTeamDetail.pendingInvites || []).length > 0 && (
                    <div className="mt-3 pt-3 border-t">
                      <p className="text-xs font-semibold text-gray-500 mb-1">Pending</p>
                      {selectedTeamDetail.pendingInvites.map(inv => (
                        <div key={inv.id} className="text-xs text-gray-400 py-0.5">{inv.email}</div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Right side - shared designs */}
                <div className="flex-1 overflow-y-auto">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-lg font-bold text-gray-800">{selectedTeamDetail.name}</h3>
                    <button onClick={() => setShowShareToTeamModal(true)} className="px-3 py-1.5 bg-indigo-600 text-white text-sm rounded hover:bg-indigo-700 flex items-center gap-1" style={{ cursor: 'pointer' }}>
                      <Send size={14} /> Share Design
                    </button>
                  </div>

                  {teamDesigns.length === 0 ? (
                    <div className="text-center py-12 text-gray-400">
                      <p className="text-sm">No shared designs yet. Share a design to start collaborating.</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {teamDesigns.map(d => {
                        const statusColors = {
                          draft: { bg: '#f3f4f6', text: '#6b7280' },
                          in_review: { bg: '#fef3c7', text: '#92400e' },
                          approved: { bg: '#d1fae5', text: '#065f46' },
                          production: { bg: '#dbeafe', text: '#1e40af' },
                          archived: { bg: '#f3f4f6', text: '#9ca3af' },
                        };
                        const sc = statusColors[d.status] || statusColors.draft;
                        return (
                          <div key={d.id} onClick={() => { loadSharedDesignDetail(selectedTeamId, d.id); setTeamView('design'); }}
                            className="p-3 border rounded-lg hover:border-indigo-300 hover:shadow transition-all flex items-center justify-between"
                            style={{ cursor: 'pointer' }}>
                            <div>
                              <span className="font-medium text-gray-800">{d.name}</span>
                              <span className="ml-2 text-xs text-gray-500">by {d.owner?.name || d.owner?.email || 'Unknown'}</span>
                            </div>
                            <span className="px-2 py-0.5 text-xs rounded" style={{ background: sc.bg, color: sc.text }}>
                              {(d.status || 'draft').replace('_', ' ')}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ---- SHARED DESIGN DETAIL VIEW ---- */}
            {!teamLoading && teamView === 'design' && selectedSharedDesign && (() => {
              const myRole = selectedTeamDetail?.myRole;
              const statusColors = {
                draft: { bg: '#f3f4f6', text: '#6b7280' },
                in_review: { bg: '#fef3c7', text: '#92400e' },
                approved: { bg: '#d1fae5', text: '#065f46' },
                production: { bg: '#dbeafe', text: '#1e40af' },
                archived: { bg: '#f3f4f6', text: '#9ca3af' },
              };
              const subStatusColors = {
                pending: { bg: '#fef3c7', text: '#92400e' },
                approved: { bg: '#d1fae5', text: '#065f46' },
                denied: { bg: '#fecaca', text: '#991b1b' },
              };
              const sc = statusColors[selectedSharedDesign.status] || statusColors.draft;
              const submissions = selectedSharedDesign.submissions || [];
              const designData = selectedSharedDesign.data || {};
              const getMatColor = (mat) => materialDispersion[mat]?.color || designData.customMaterials?.[mat]?.color || '#ccc';

              // Build trace IDs
              const allTraceIds = ['original', ...submissions.map(s => `sub_${s.id}`)];
              const visibleTraceIds = allTraceIds.filter(id => teamVisibleTraces[id]);

              // Compute trace data for all visible traces
              const traceDataMap = {};
              for (const tid of allTraceIds) {
                traceDataMap[tid] = getTeamTraceData(tid, designData, submissions, teamSelectedIlluminant);
              }

              // Build merged chart data for R/T/A/phase modes
              const buildMergedChartData = (mode) => {
                const dataByWl = {};
                for (const tid of visibleTraceIds) {
                  const td = traceDataMap[tid];
                  if (!td || !td.spectrum) continue;
                  for (const pt of td.spectrum) {
                    if (!dataByWl[pt.wavelength]) dataByWl[pt.wavelength] = { wavelength: pt.wavelength };
                    if (mode === 'reflectivity') dataByWl[pt.wavelength][tid] = pt.R;
                    else if (mode === 'transmission') dataByWl[pt.wavelength][tid] = pt.T;
                    else if (mode === 'absorption') dataByWl[pt.wavelength][tid] = pt.A;
                    else if (mode === 'phaseShift') dataByWl[pt.wavelength][tid] = pt.phase;
                  }
                }
                return Object.values(dataByWl).sort((a, b) => a.wavelength - b.wavelength);
              };

              // Resolve layers for a trace
              const resolveTraceLayers = (traceId) => {
                const td = traceDataMap[traceId];
                if (!td || !td.data) return [];
                const d = td.data;
                let resolved = d.layers || [];
                if (d.layerStacks && d.currentStackId) {
                  const cs = d.layerStacks.find(s => s.id === d.currentStackId);
                  if (cs && cs.layers && cs.layers.length > 0) resolved = cs.layers;
                }
                return resolved;
              };

              const focusedLayers = resolveTraceLayers(teamActiveLayerView);
              const focusedTraceData = traceDataMap[teamActiveLayerView];

              // Y-axis config per mode
              const modeConfig = {
                reflectivity: { unit: '%', domain: [0, 100], label: 'Reflectivity' },
                transmission: { unit: '%', domain: [0, 100], label: 'Transmission' },
                absorption: { unit: '%', domain: [0, 100], label: 'Absorption' },
                phaseShift: { unit: '\u00B0', domain: ['auto', 'auto'], label: 'Phase Shift' },
              };

              return (
                <div style={{ display: 'flex', gap: '12px', minHeight: '600px' }}>
                  {/* LEFT PANEL — Chart + Color */}
                  <div style={{ flex: '1 1 70%', minWidth: 0 }}>
                    {/* Header bar */}
                    <div className="flex items-center gap-2 mb-3" style={{ flexWrap: 'wrap' }}>
                      <button onClick={() => setTeamView('detail')} className="text-gray-500" style={{ cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                        onMouseEnter={e => e.currentTarget.style.color = '#4f46e5'} onMouseLeave={e => e.currentTarget.style.color = '#6b7280'}>
                        <ChevronLeft size={18} />
                      </button>
                      <h2 className="text-lg font-bold text-gray-800" style={{ marginRight: 'auto' }}>{selectedSharedDesign.name}</h2>
                      <select value={teamDisplayMode} onChange={e => setTeamDisplayMode(e.target.value)}
                        className="text-xs border rounded px-2 py-1" style={{ cursor: 'pointer' }}>
                        <option value="reflectivity">Reflectivity</option>
                        <option value="transmission">Transmission</option>
                        <option value="absorption">Absorption</option>
                        <option value="admittance">Admittance</option>
                        <option value="efield">E-Field</option>
                        <option value="phaseShift">Phase Shift</option>
                      </select>
                      <select value={teamSelectedIlluminant} onChange={e => { setTeamSelectedIlluminant(e.target.value); setTeamTraceCache({}); }}
                        className="text-xs border rounded px-2 py-1" style={{ cursor: 'pointer' }}>
                        <option value="D65">D65</option>
                        <option value="D50">D50</option>
                        <option value="A">A</option>
                        <option value="F2">F2</option>
                        <option value="F11">F11</option>
                      </select>
                    </div>

                    {/* Chart area */}
                    <div className="mb-3 p-3 border rounded-lg">
                      {/* R/T/A/Phase chart */}
                      {['reflectivity', 'transmission', 'absorption', 'phaseShift'].includes(teamDisplayMode) && (() => {
                        const chartData = buildMergedChartData(teamDisplayMode);
                        const mc = modeConfig[teamDisplayMode];
                        return (
                          <div style={{ width: '100%', height: '350px' }}>
                            <ResponsiveContainer width="100%" height="100%">
                              <LineChart data={chartData} margin={{ top: 5, right: 15, bottom: 20, left: 15 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                                <XAxis dataKey="wavelength" tick={{ fontSize: 10 }} tickCount={8} label={{ value: 'Wavelength (nm)', position: 'insideBottom', offset: -10, style: { fontSize: '10px', fill: '#9ca3af' } }} />
                                <YAxis tick={{ fontSize: 10 }} domain={mc.domain} unit={mc.unit} label={{ value: mc.label, angle: -90, position: 'insideLeft', offset: 5, style: { fontSize: '10px', fill: '#9ca3af' } }} />
                                <Tooltip />
                                {visibleTraceIds.map(id => (
                                  <Line key={id} type="monotone" dataKey={id} stroke={getTeamTraceColor(id, submissions)} strokeWidth={id === teamActiveLayerView ? 2.5 : 1.5} dot={false}
                                    name={id === 'original' ? 'Original' : submissions.find(s => `sub_${s.id}` === id)?.submitter?.email || 'Submission'}
                                    strokeDasharray={id === 'original' ? undefined : '5 3'} />
                                ))}
                              </LineChart>
                            </ResponsiveContainer>
                          </div>
                        );
                      })()}

                      {/* Admittance chart */}
                      {teamDisplayMode === 'admittance' && (() => {
                        const td = traceDataMap[teamActiveLayerView];
                        if (!td || !td.data) return <div className="text-sm text-gray-400 p-4 text-center">No data for focused trace</div>;
                        const admData = computeAdmittanceFromData(td.data, td.data.customMaterials || {}, teamAdmittanceWavelengths);
                        if (!admData || admData.length === 0) return <div className="text-sm text-gray-400 p-4 text-center">No admittance data</div>;
                        return (
                          <div>
                            <div className="flex items-center gap-2 mb-2" style={{ fontSize: '10px' }}>
                              <span className="text-gray-500">Wavelengths:</span>
                              {teamAdmittanceWavelengths.map((wl, wi) => (
                                <input key={wi} type="number" value={wl} onChange={e => { const nw = [...teamAdmittanceWavelengths]; nw[wi] = Number(e.target.value); setTeamAdmittanceWavelengths(nw); }}
                                  className="border rounded px-1 py-0.5 text-center" style={{ width: '55px', fontSize: '10px' }} />
                              ))}
                              <span className="text-gray-400">nm</span>
                            </div>
                            <div style={{ width: '100%', height: '320px' }}>
                              <ResponsiveContainer width="100%" height="100%">
                                <ScatterChart margin={{ top: 5, right: 15, bottom: 20, left: 15 }}>
                                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                                  <XAxis dataKey="re" type="number" tick={{ fontSize: 10 }} name="Re(Y)" label={{ value: 'Re(Y)', position: 'insideBottom', offset: -10, style: { fontSize: '10px', fill: '#9ca3af' } }} />
                                  <YAxis dataKey="im" type="number" tick={{ fontSize: 10 }} name="Im(Y)" label={{ value: 'Im(Y)', angle: -90, position: 'insideLeft', offset: 5, style: { fontSize: '10px', fill: '#9ca3af' } }} />
                                  <Tooltip />
                                  {admData.map((locus, li) => (
                                    <Scatter key={li} data={locus.points || locus} fill={['#4f46e5', '#dc2626', '#16a34a'][li % 3]} line={{ stroke: ['#4f46e5', '#dc2626', '#16a34a'][li % 3], strokeWidth: 1.5 }} lineType="joint"
                                      name={`${locus.wavelength || teamAdmittanceWavelengths[li]} nm`} shape="circle" legendType="circle" />
                                  ))}
                                </ScatterChart>
                              </ResponsiveContainer>
                            </div>
                          </div>
                        );
                      })()}

                      {/* E-field chart */}
                      {teamDisplayMode === 'efield' && (() => {
                        const td = traceDataMap[teamActiveLayerView];
                        if (!td || !td.data) return <div className="text-sm text-gray-400 p-4 text-center">No data for focused trace</div>;
                        const efResult = computeEfieldFromData(td.data, td.data.customMaterials || {}, teamEfieldWavelengths);
                        if (!efResult || !efResult.data || efResult.data.length === 0) return <div className="text-sm text-gray-400 p-4 text-center">No E-field data</div>;
                        const efLayers = efResult.layers || [];
                        const efLines = efResult.lines || [];
                        const lineColors = ['#4f46e5', '#dc2626', '#16a34a'];
                        return (
                          <div>
                            <div className="flex items-center gap-2 mb-2" style={{ fontSize: '10px' }}>
                              <span className="text-gray-500">Wavelengths:</span>
                              {teamEfieldWavelengths.map((wl, wi) => (
                                <input key={wi} type="number" value={wl} onChange={e => { const nw = [...teamEfieldWavelengths]; nw[wi] = Number(e.target.value); setTeamEfieldWavelengths(nw); }}
                                  className="border rounded px-1 py-0.5 text-center" style={{ width: '55px', fontSize: '10px' }} />
                              ))}
                              <span className="text-gray-400">nm</span>
                            </div>
                            <div style={{ width: '100%', height: '320px' }}>
                              <ResponsiveContainer width="100%" height="100%">
                                <LineChart data={efResult.data} margin={{ top: 5, right: 15, bottom: 20, left: 15 }}>
                                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                                  {efLayers.map((layer, li) => (
                                    <ReferenceArea key={li} x1={layer.x1} x2={layer.x2} fill={getMatColor(layer.material)} fillOpacity={0.15} />
                                  ))}
                                  <XAxis dataKey="depth" tick={{ fontSize: 10 }} label={{ value: 'Position (nm)', position: 'insideBottom', offset: -10, style: { fontSize: '10px', fill: '#9ca3af' } }} />
                                  <YAxis tick={{ fontSize: 10 }} label={{ value: '|E|^2', angle: -90, position: 'insideLeft', offset: 5, style: { fontSize: '10px', fill: '#9ca3af' } }} />
                                  <Tooltip />
                                  {efLines.map((line, li) => (
                                    <Line key={li} type="monotone" dataKey={`intensity_${line.wavelength}`} stroke={lineColors[li % 3]} strokeWidth={1.5} dot={false} name={`${line.wavelength} nm`} />
                                  ))}
                                </LineChart>
                              </ResponsiveContainer>
                            </div>
                          </div>
                        );
                      })()}
                    </div>

                    {/* Color analysis section */}
                    <div className="p-3 border rounded-lg mb-3">
                      <div className="flex items-center justify-between mb-2">
                        <span style={{ fontSize: '12px' }} className="font-semibold text-gray-700">Color Analysis</span>
                      </div>
                      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                        {visibleTraceIds.map(tid => {
                          const td = traceDataMap[tid];
                          const ci = td?.colorInfo;
                          const traceName = tid === 'original' ? 'Original' : (submissions.find(s => `sub_${s.id}` === tid)?.submitter?.name || submissions.find(s => `sub_${s.id}` === tid)?.submitter?.email || 'Submission');
                          return (
                            <div key={tid} className="flex items-center gap-3 p-2 rounded" style={{ background: '#fafafa', border: tid === teamActiveLayerView ? '2px solid #818cf8' : '1px solid #e5e7eb', minWidth: '200px' }}>
                              <div style={{ width: '48px', height: '48px', borderRadius: '8px', backgroundColor: ci?.hex || ci?.rgb || '#ccc', border: '2px solid rgba(0,0,0,0.1)', flexShrink: 0 }} />
                              <div style={{ fontSize: '10px' }}>
                                <div className="font-semibold text-gray-700" style={{ fontSize: '11px' }}>{traceName}</div>
                                {ci && (
                                  <>
                                    <div className="text-gray-500">{ci.colorName || '—'}</div>
                                    <div className="text-gray-400">L*={ci.L} a*={ci.a_star} b*={ci.b_star}</div>
                                    <div className="text-gray-400">C={ci.C} h={ci.h}</div>
                                    <div className="text-gray-400">Dom. {ci.dominantWavelength || '—'} nm | Avg R {typeof ci.avgReflectivity === 'number' ? ci.avgReflectivity.toFixed(1) : ci.avgReflectivity}%</div>
                                  </>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* Metrics Comparison Table */}
                    <details open className="mb-3 border rounded-lg">
                      <summary className="p-2 font-semibold text-gray-700" style={{ fontSize: '12px', cursor: 'pointer' }}>Metrics Comparison</summary>
                      <div style={{ overflowX: 'auto', padding: '0 8px 8px' }}>
                        <table className="w-full" style={{ fontSize: '10px', borderCollapse: 'collapse' }}>
                          <thead>
                            <tr className="bg-gray-50 text-gray-400">
                              <th className="text-left px-2 py-1 font-medium">Name</th>
                              <th className="text-right px-2 py-1 font-medium">Avg R%</th>
                              <th className="text-right px-2 py-1 font-medium">Avg T%</th>
                              <th className="text-right px-2 py-1 font-medium">Thickness</th>
                              <th className="text-right px-2 py-1 font-medium">Layers</th>
                              <th className="text-center px-2 py-1 font-medium">Color</th>
                              <th className="text-right px-2 py-1 font-medium">{'\u0394'}E vs Orig</th>
                              <th className="text-right px-2 py-1 font-medium">Stress</th>
                              <th className="text-center px-2 py-1 font-medium">Risk</th>
                              <th className="text-center px-2 py-1 font-medium">Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {allTraceIds.map(tid => {
                              const td = traceDataMap[tid];
                              if (!td) return null;
                              const ci = td.colorInfo;
                              const st = td.stress;
                              const layers = resolveTraceLayers(tid);
                              const totalThick = layers.reduce((sum, l) => sum + Number(l.thickness || 0), 0);
                              const spectrum = td.spectrum || [];
                              const visSpectrum = spectrum.filter(p => p.wavelength >= 380 && p.wavelength <= 780);
                              const avgR = visSpectrum.length > 0 ? visSpectrum.reduce((s, p) => s + p.R, 0) / visSpectrum.length : 0;
                              const avgT = visSpectrum.length > 0 ? visSpectrum.reduce((s, p) => s + (p.T || 0), 0) / visSpectrum.length : 0;
                              // Delta E vs original
                              let deltaE = null;
                              if (tid !== 'original' && traceDataMap['original']?.colorInfo && ci) {
                                const oc = traceDataMap['original'].colorInfo;
                                const dL = parseFloat(oc.L) - parseFloat(ci.L);
                                const da = parseFloat(oc.a_star) - parseFloat(ci.a_star);
                                const db = parseFloat(oc.b_star) - parseFloat(ci.b_star);
                                deltaE = Math.sqrt(dL * dL + da * da + db * db);
                              }
                              const sub = tid !== 'original' ? submissions.find(s => `sub_${s.id}` === tid) : null;
                              const traceName = tid === 'original' ? 'Original' : (sub?.submitter?.name || sub?.submitter?.email || 'Submission');
                              const traceStatus = tid === 'original' ? (selectedSharedDesign.status || 'draft') : (sub?.status || 'pending');
                              const tsc = tid === 'original' ? (statusColors[traceStatus] || statusColors.draft) : (subStatusColors[traceStatus] || subStatusColors.pending);
                              return (
                                <tr key={tid} style={{ borderTop: '1px solid #f3f4f6', background: tid === teamActiveLayerView ? '#eef2ff' : undefined }}>
                                  <td className="px-2 py-1 text-gray-700 font-medium">
                                    <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', background: getTeamTraceColor(tid, submissions), marginRight: '5px', verticalAlign: 'middle' }} />
                                    {traceName}
                                  </td>
                                  <td className="px-2 py-1 text-gray-700 text-right">{avgR.toFixed(1)}</td>
                                  <td className="px-2 py-1 text-gray-700 text-right">{avgT.toFixed(1)}</td>
                                  <td className="px-2 py-1 text-gray-700 text-right">{totalThick.toFixed(1)} nm</td>
                                  <td className="px-2 py-1 text-gray-700 text-right">{layers.length}</td>
                                  <td className="px-2 py-1 text-center">
                                    <span style={{ display: 'inline-block', width: '14px', height: '14px', borderRadius: '3px', background: ci?.hex || ci?.rgb || '#ccc', border: '1px solid rgba(0,0,0,0.1)', verticalAlign: 'middle' }} />
                                  </td>
                                  <td className="px-2 py-1 text-gray-700 text-right">{deltaE != null ? deltaE.toFixed(2) : '—'}</td>
                                  <td className="px-2 py-1 text-gray-700 text-right">{st?.totalStressMagnitude != null ? st.totalStressMagnitude.toFixed(1) : '—'} MPa</td>
                                  <td className="px-2 py-1 text-center">
                                    {st?.riskLevel && <span className="px-1.5 py-0.5 rounded text-xs" style={{ background: st.riskColor || '#f3f4f6', color: '#fff', fontSize: '9px' }}>{st.riskLevel}</span>}
                                  </td>
                                  <td className="px-2 py-1 text-center">
                                    <span className="px-1.5 py-0.5 rounded text-xs" style={{ background: tsc.bg, color: tsc.text, fontSize: '9px' }}>{traceStatus.replace('_', ' ')}</span>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </details>
                  </div>

                  {/* RIGHT PANEL — Team Context */}
                  <div style={{ flex: '0 0 30%', minWidth: '280px' }}>
                    {/* Design Header */}
                    <div className="p-3 border rounded-lg mb-3">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="font-semibold text-gray-800" style={{ fontSize: '13px' }}>{selectedSharedDesign.name}</span>
                        {myRole === 'admin' ? (
                          <select value={selectedSharedDesign.status || 'draft'} onChange={e => handleUpdateDesignStatus(selectedSharedDesign.id, e.target.value)}
                            className="text-xs border rounded px-2 py-1" style={{ cursor: 'pointer', marginLeft: 'auto' }}>
                            <option value="draft">Draft</option>
                            <option value="in_review">In Review</option>
                            <option value="approved">Approved</option>
                            <option value="production">Production</option>
                            <option value="archived">Archived</option>
                          </select>
                        ) : (
                          <span className="px-2 py-0.5 text-xs rounded" style={{ background: sc.bg, color: sc.text, marginLeft: 'auto' }}>
                            {(selectedSharedDesign.status || 'draft').replace('_', ' ')}
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: '10px' }} className="text-gray-500 mb-2">
                        <div>Shared by: <span className="text-gray-700 font-medium">{selectedSharedDesign.owner?.email || 'Unknown'}</span></div>
                        <div>Date: <span className="text-gray-700 font-medium">{new Date(selectedSharedDesign.createdAt).toLocaleDateString()}</span></div>
                      </div>
                      <div className="flex gap-2">
                        <button onClick={() => handleCloneDesign(selectedTeamId, selectedSharedDesign.id)}
                          className="px-2 py-1 text-xs border rounded flex items-center gap-1" style={{ cursor: 'pointer' }}
                          onMouseEnter={e => e.currentTarget.style.background = '#f9fafb'} onMouseLeave={e => e.currentTarget.style.background = ''}>
                          <Copy size={12} /> Clone
                        </button>
                        <button onClick={() => { setShowSubmitChangesModal(true); }}
                          className="px-2 py-1 text-xs bg-indigo-600 text-white rounded flex items-center gap-1" style={{ cursor: 'pointer' }}
                          onMouseEnter={e => e.currentTarget.style.background = '#4338ca'} onMouseLeave={e => e.currentTarget.style.background = '#4f46e5'}>
                          <Send size={12} /> Submit Changes
                        </button>
                        <button onClick={() => { setTeamColorCompareSelected(Object.keys(teamVisibleTraces).filter(k => teamVisibleTraces[k])); setShowTeamColorCompare(true); }}
                          className="px-2 py-1 text-xs border rounded flex items-center gap-1" style={{ cursor: 'pointer' }}
                          onMouseEnter={e => e.currentTarget.style.background = '#f9fafb'} onMouseLeave={e => e.currentTarget.style.background = ''}>
                          Compare Colors
                        </button>
                      </div>
                    </div>

                    {/* Submission Traces */}
                    <div className="p-3 border rounded-lg mb-3">
                      <div className="font-semibold text-gray-700 mb-2" style={{ fontSize: '12px' }}>Traces</div>
                      {/* Original */}
                      <div className="flex items-center gap-2 p-2 rounded mb-1"
                        style={{ cursor: 'pointer', border: teamActiveLayerView === 'original' ? '2px solid #818cf8' : '1px solid #e5e7eb', background: teamActiveLayerView === 'original' ? '#eef2ff' : '#fff' }}
                        onClick={() => setTeamActiveLayerView('original')}>
                        <button onClick={e => { e.stopPropagation(); setTeamVisibleTraces(prev => ({ ...prev, original: !prev.original })); }}
                          style={{ cursor: 'pointer', color: teamVisibleTraces.original ? '#4f46e5' : '#d1d5db', flexShrink: 0 }}>
                          {teamVisibleTraces.original ? <Eye size={14} /> : <EyeOff size={14} />}
                        </button>
                        <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: getTeamTraceColor('original', submissions), flexShrink: 0 }} />
                        <span className="text-gray-700 font-medium" style={{ fontSize: '11px' }}>Original Design</span>
                      </div>
                      {/* Submissions */}
                      {submissions.map(sub => {
                        const tid = `sub_${sub.id}`;
                        const ssc = subStatusColors[sub.status] || subStatusColors.pending;
                        return (
                          <div key={sub.id} className="flex items-center gap-2 p-2 rounded mb-1"
                            style={{ cursor: 'pointer', border: teamActiveLayerView === tid ? '2px solid #818cf8' : '1px solid #e5e7eb', background: teamActiveLayerView === tid ? '#eef2ff' : '#fff' }}
                            onClick={() => setTeamActiveLayerView(tid)}>
                            <button onClick={e => { e.stopPropagation(); setTeamVisibleTraces(prev => ({ ...prev, [tid]: !prev[tid] })); }}
                              style={{ cursor: 'pointer', color: teamVisibleTraces[tid] ? getTeamTraceColor(tid, submissions) : '#d1d5db', flexShrink: 0 }}>
                              {teamVisibleTraces[tid] ? <Eye size={14} /> : <EyeOff size={14} />}
                            </button>
                            <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: getTeamTraceColor(tid, submissions), flexShrink: 0 }} />
                            <div style={{ minWidth: 0, flex: 1 }}>
                              <div className="text-gray-700" style={{ fontSize: '11px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {sub.submitter?.name || sub.submitter?.email || 'Unknown'}
                              </div>
                              <div className="text-gray-400" style={{ fontSize: '9px' }}>{new Date(sub.createdAt).toLocaleDateString()}</div>
                            </div>
                            <span className="px-1.5 py-0.5 rounded text-xs" style={{ background: ssc.bg, color: ssc.text, fontSize: '9px', flexShrink: 0 }}>{sub.status}</span>
                          </div>
                        );
                      })}
                      {submissions.length === 0 && <div className="text-xs text-gray-400 mt-1">No submissions yet.</div>}
                    </div>

                    {/* Approval Timeline */}
                    <details className="mb-3 border rounded-lg">
                      <summary className="p-2 font-semibold text-gray-700" style={{ fontSize: '12px', cursor: 'pointer' }}>Approval Timeline</summary>
                      <div style={{ padding: '0 8px 8px', maxHeight: '250px', overflowY: 'auto' }}>
                        {[...submissions].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).map(sub => {
                          const ssc = subStatusColors[sub.status] || subStatusColors.pending;
                          const td = traceDataMap[`sub_${sub.id}`];
                          const ci = td?.colorInfo;
                          const visSpectrum = (td?.spectrum || []).filter(p => p.wavelength >= 380 && p.wavelength <= 780);
                          const avgR = visSpectrum.length > 0 ? (visSpectrum.reduce((s, p) => s + p.R, 0) / visSpectrum.length).toFixed(1) : '—';
                          return (
                            <div key={sub.id} className="mb-2 p-2 rounded" style={{ background: '#fafafa', fontSize: '10px' }}>
                              <div className="flex items-center gap-2">
                                <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: ssc.text, flexShrink: 0 }} />
                                <span className="text-gray-700 font-medium">{sub.submitter?.name || sub.submitter?.email || '?'}</span>
                                <span className="text-gray-400 ml-auto">{new Date(sub.createdAt).toLocaleDateString()}</span>
                              </div>
                              <div className="flex items-center gap-2 mt-1">
                                <span className="px-1.5 py-0.5 rounded" style={{ background: ssc.bg, color: ssc.text, fontSize: '9px' }}>{sub.status}</span>
                                <span className="text-gray-500">Avg R: {avgR}%</span>
                                {ci && <span style={{ display: 'inline-block', width: '10px', height: '10px', borderRadius: '2px', background: ci.hex || ci.rgb || '#ccc', border: '1px solid rgba(0,0,0,0.1)' }} />}
                              </div>
                              {sub.reviewNote && <div className="text-gray-500 mt-1" style={{ fontStyle: 'italic' }}>{sub.reviewNote}</div>}
                              {sub.notes && <div className="text-gray-400 mt-0.5">{sub.notes}</div>}
                            </div>
                          );
                        })}
                        {submissions.length === 0 && <div className="text-xs text-gray-400 p-2">No submissions yet.</div>}
                      </div>
                    </details>

                    {/* Layer Details for focused trace */}
                    <details open className="mb-3 border rounded-lg">
                      <summary className="p-2 font-semibold text-gray-700" style={{ fontSize: '12px', cursor: 'pointer' }}>
                        Layer Details — {teamActiveLayerView === 'original' ? 'Original' : (submissions.find(s => `sub_${s.id}` === teamActiveLayerView)?.submitter?.email || 'Submission')}
                      </summary>
                      <div style={{ padding: '0 8px 8px', maxHeight: '350px', overflowY: 'auto' }}>
                        {focusedLayers.length > 0 ? (
                          <>
                            <table className="w-full" style={{ fontSize: '10px', borderCollapse: 'collapse' }}>
                              <thead>
                                <tr className="bg-gray-50 text-gray-400">
                                  <th className="text-left px-1 py-1 font-medium" style={{ width: '22px' }}>#</th>
                                  <th className="text-left px-1 py-1 font-medium">Material</th>
                                  <th className="text-right px-1 py-1 font-medium" style={{ width: '65px' }}>Thick.</th>
                                  <th className="text-right px-1 py-1 font-medium" style={{ width: '45px' }}>Pack.</th>
                                  <th className="text-center px-1 py-1 font-medium" style={{ width: '30px' }}>IAD</th>
                                </tr>
                              </thead>
                              <tbody>
                                {focusedLayers.map((l, li) => {
                                  const stressLayer = focusedTraceData?.stress?.layers?.[li];
                                  return (
                                    <React.Fragment key={li}>
                                      <tr style={{ borderTop: '1px solid #f3f4f6' }}>
                                        <td className="px-1 py-0.5 text-gray-400">{li + 1}</td>
                                        <td className="px-1 py-0.5 text-gray-700">
                                          <span style={{ display: 'inline-block', width: '7px', height: '7px', borderRadius: '2px', background: getMatColor(l.material), marginRight: '4px', verticalAlign: 'middle', border: '1px solid rgba(0,0,0,0.1)' }} />
                                          {l.material}
                                        </td>
                                        <td className="px-1 py-0.5 text-gray-700 text-right">{Number(l.thickness).toFixed(2)}</td>
                                        <td className="px-1 py-0.5 text-gray-500 text-right">{l.packingDensity != null && l.packingDensity !== 1.0 ? l.packingDensity.toFixed(3) : '—'}</td>
                                        <td className="px-1 py-0.5 text-center">{l.iad?.enabled ? <span style={{ color: '#16a34a', fontWeight: 600 }}>+</span> : <span className="text-gray-300">—</span>}</td>
                                      </tr>
                                      {stressLayer && (
                                        <tr>
                                          <td colSpan={5} className="px-1 pb-1" style={{ fontSize: '9px' }}>
                                            <span className="text-gray-400">Stress: {stressLayer.intrinsicStress?.toFixed(0) || '—'} MPa | Force: {stressLayer.stressForce?.toFixed(1) || '—'} MPa·nm</span>
                                            {stressLayer.stressType && (
                                              <span className="ml-1 px-1 py-0.5 rounded" style={{ fontSize: '8px', background: stressLayer.stressType === 'Compressive' ? '#dbeafe' : '#fef3c7', color: stressLayer.stressType === 'Compressive' ? '#1e40af' : '#92400e' }}>
                                                {stressLayer.stressType}
                                              </span>
                                            )}
                                          </td>
                                        </tr>
                                      )}
                                    </React.Fragment>
                                  );
                                })}
                              </tbody>
                            </table>
                            {/* Cumulative stress summary */}
                            {focusedTraceData?.stress && (
                              <div className="mt-2 p-2 rounded" style={{ background: '#f9fafb', fontSize: '10px' }}>
                                <div className="flex items-center justify-between">
                                  <span className="text-gray-500">Total Stress:</span>
                                  <span className="text-gray-700 font-medium">{focusedTraceData.stress.totalStressMagnitude?.toFixed(1) || '—'} MPa</span>
                                </div>
                                <div className="flex items-center justify-between mt-0.5">
                                  <span className="text-gray-500">Physical Thickness:</span>
                                  <span className="text-gray-700 font-medium">{focusedTraceData.stress.totalPhysicalThickness?.toFixed(1) || '—'} nm</span>
                                </div>
                                {focusedTraceData.stress.riskLevel && (
                                  <div className="flex items-center justify-between mt-1">
                                    <span className="text-gray-500">Risk:</span>
                                    <span className="px-1.5 py-0.5 rounded text-xs" style={{ background: focusedTraceData.stress.riskColor || '#f3f4f6', color: '#fff', fontSize: '9px' }}>{focusedTraceData.stress.riskLevel}</span>
                                  </div>
                                )}
                                {focusedTraceData.stress.recommendation && (
                                  <div className="text-gray-400 mt-1" style={{ fontSize: '9px' }}>{focusedTraceData.stress.recommendation}</div>
                                )}
                              </div>
                            )}
                          </>
                        ) : (
                          <div className="text-xs text-gray-400 p-2">No layer data available.</div>
                        )}
                      </div>
                    </details>

                    {/* Admin actions for pending submission */}
                    {myRole === 'admin' && teamActiveLayerView !== 'original' && (() => {
                      const sub = submissions.find(s => `sub_${s.id}` === teamActiveLayerView);
                      if (!sub || sub.status !== 'pending') return null;
                      return (
                        <div className="p-3 border rounded-lg mb-3 flex gap-2">
                          <button onClick={() => { setPendingSubmissionId(sub.id); setShowApproveModal(true); }}
                            className="px-3 py-1.5 text-xs bg-green-600 text-white rounded flex items-center gap-1" style={{ cursor: 'pointer' }}
                            onMouseEnter={e => e.currentTarget.style.background = '#15803d'} onMouseLeave={e => e.currentTarget.style.background = '#16a34a'}>
                            <Check size={12} /> Approve
                          </button>
                          <button onClick={() => { setPendingSubmissionId(sub.id); setShowDenyModal(true); }}
                            className="px-3 py-1.5 text-xs bg-red-500 text-white rounded flex items-center gap-1" style={{ cursor: 'pointer' }}
                            onMouseEnter={e => e.currentTarget.style.background = '#b91c1c'} onMouseLeave={e => e.currentTarget.style.background = '#ef4444'}>
                            <XCircle size={12} /> Deny
                          </button>
                        </div>
                      );
                    })()}

                    {/* Discussion */}
                    <div className="p-3 border rounded-lg">
                      <div className="font-semibold text-gray-700 mb-2 flex items-center gap-1" style={{ fontSize: '12px' }}><MessageSquare size={14} /> Discussion</div>
                      {(selectedSharedDesign.comments || []).length === 0 && <p className="text-xs text-gray-400 mb-2">No comments yet.</p>}
                      <div style={{ maxHeight: '200px', overflowY: 'auto' }}>
                        {(selectedSharedDesign.comments || []).map(c => (
                          <div key={c.id} className="mb-2 p-2 bg-gray-50 rounded" style={{ fontSize: '11px' }}>
                            <div className="flex items-center justify-between">
                              <span className="font-medium text-gray-700">{c.author?.name || c.author?.email || 'Unknown'}</span>
                              <div className="flex items-center gap-2">
                                <span className="text-gray-400" style={{ fontSize: '9px' }}>{new Date(c.createdAt).toLocaleString()}</span>
                                {(c.author?.id === currentUserId || myRole === 'admin') && (
                                  <button onClick={(e) => { e.stopPropagation(); handleDeleteComment('design', null, c.id); }} style={{ cursor: 'pointer', color: '#f87171' }}
                                    onMouseEnter={e => e.currentTarget.style.color = '#dc2626'} onMouseLeave={e => e.currentTarget.style.color = '#f87171'}>
                                    <Trash2 size={11} />
                                  </button>
                                )}
                              </div>
                            </div>
                            <p className="text-gray-600 mt-1">{c.content}</p>
                          </div>
                        ))}
                      </div>
                      <div className="flex gap-2 mt-2">
                        <input type="text" value={commentText} onChange={e => setCommentText(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') handleAddComment('design', null); }}
                          placeholder="Add a comment..." className="flex-1 px-2 py-1 border rounded text-sm" style={{ fontSize: '11px' }} />
                        <button onClick={() => handleAddComment('design', null)} className="px-2 py-1 bg-indigo-600 text-white rounded" style={{ cursor: 'pointer' }}
                          onMouseEnter={e => e.currentTarget.style.background = '#4338ca'} onMouseLeave={e => e.currentTarget.style.background = '#4f46e5'}>
                          <Send size={12} />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })()}

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
          <div className="bg-white rounded-lg shadow-xl p-4 flex flex-col" style={{ width: '560px', maxWidth: '95vw', maxHeight: 'calc(100vh - 40px)' }} onClick={(e) => e.stopPropagation()}>
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
                      className="flex items-center gap-1.5 px-2 py-1 rounded text-xs"
                      style={{ transition: 'all 0.15s', border: selected ? '2px solid #6366f1' : '1px solid #d1d5db', background: selected ? '#eef2ff' : '#fff', color: selected ? '#3730a3' : '#6b7280' }}
                    >
                      <div className="rounded flex-shrink-0" style={{ width: '16px', height: '16px', backgroundColor: color.rgb, border: `2px solid ${selected ? '#6366f1' : '#d1d5db'}` }}></div>
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
                      <div className="w-4 h-4 rounded border-2 flex-shrink-0" style={{ backgroundColor: experimentalColorData.rgb, borderColor: selected ? '#ef4444' : '#d1d5db' }}></div>
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
                            <span className="ml-auto font-medium" style={{ color: comp.deltaE < 1 ? '#16a34a' : comp.deltaE < 2 ? '#ca8a04' : comp.deltaE < 3 ? '#ea580c' : '#dc2626' }}>
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

      {/* ========== TEAM COLOR COMPARISON MODAL ========== */}
      {showTeamColorCompare && selectedSharedDesign && (() => {
        const submissions = selectedSharedDesign.submissions || [];
        const designData = selectedSharedDesign.data || {};
        const allTraceIds = ['original', ...submissions.map(s => `sub_${s.id}`)];

        // Build trace info for display
        const traceInfoList = allTraceIds.map(tid => {
          const traceData = getTeamTraceData(tid, designData, submissions, teamSelectedIlluminant);
          let label = 'Original';
          if (tid !== 'original') {
            const sub = submissions.find(s => `sub_${s.id}` === tid);
            label = sub ? (sub.submitter?.name || sub.submitter?.email || 'Submission') : tid;
          }
          return { id: tid, label, traceData, color: getTeamTraceColor(tid, submissions) };
        }).filter(t => t.traceData && t.traceData.colorInfo);

        const selectedTraces = traceInfoList.filter(t => teamColorCompareSelected.includes(t.id));

        // Build pairwise comparisons
        const comparisons = [];
        for (let i = 0; i < selectedTraces.length; i++) {
          for (let j = i + 1; j < selectedTraces.length; j++) {
            const c1 = selectedTraces[i].traceData.colorInfo;
            const c2 = selectedTraces[j].traceData.colorInfo;
            const dL = parseFloat(c1.L) - parseFloat(c2.L);
            const da = parseFloat(c1.a_star) - parseFloat(c2.a_star);
            const db = parseFloat(c1.b_star) - parseFloat(c2.b_star);
            const deltaE = Math.sqrt(dL * dL + da * da + db * db);
            comparisons.push({
              name1: selectedTraces[i].label, name2: selectedTraces[j].label,
              rgb1: c1.hex || c1.rgb, rgb2: c2.hex || c2.rgb,
              color1: selectedTraces[i].color, color2: selectedTraces[j].color,
              deltaE, dL: dL.toFixed(2), da: da.toFixed(2), db: db.toFixed(2),
            });
          }
        }
        comparisons.sort((a, b) => a.deltaE - b.deltaE);

        return (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" onClick={() => setShowTeamColorCompare(false)}>
            <div onClick={e => e.stopPropagation()} className="bg-white rounded-lg shadow-xl p-6 flex flex-col" style={{ maxWidth: '95vw', width: '700px', maxHeight: 'calc(100vh - 40px)' }}>
              <div className="flex justify-between items-center mb-3 flex-shrink-0">
                <h2 className="text-base font-bold text-gray-800">Team Color Comparison</h2>
                <button onClick={() => setShowTeamColorCompare(false)} className="text-gray-500 hover:text-gray-700">
                  <X size={18} />
                </button>
              </div>

              {/* Trace Selection */}
              <div className="mb-3 pb-3 border-b flex-shrink-0">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-xs font-semibold text-gray-700">Select traces to compare</div>
                  <div className="flex gap-2">
                    <button onClick={() => setTeamColorCompareSelected(traceInfoList.map(t => t.id))} className="text-xs text-indigo-600 hover:text-indigo-800" style={{ cursor: 'pointer', fontSize: '10px' }}>Select All</button>
                    <button onClick={() => setTeamColorCompareSelected([])} className="text-xs text-gray-500 hover:text-gray-700" style={{ cursor: 'pointer', fontSize: '10px' }}>Clear</button>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {traceInfoList.map(trace => {
                    const selected = teamColorCompareSelected.includes(trace.id);
                    return (
                      <button
                        key={trace.id}
                        onClick={() => setTeamColorCompareSelected(prev => selected ? prev.filter(id => id !== trace.id) : [...prev, trace.id])}
                        className="flex items-center gap-1.5 px-2 py-1 rounded text-xs"
                        style={{ cursor: 'pointer', transition: 'all 0.15s', border: selected ? '2px solid #6366f1' : '1px solid #d1d5db', background: selected ? '#eef2ff' : '#fff', color: selected ? '#3730a3' : '#6b7280' }}
                      >
                        <div style={{ width: '16px', height: '16px', borderRadius: '4px', backgroundColor: trace.traceData.colorInfo.hex || trace.traceData.colorInfo.rgb, border: `2px solid ${trace.color}`, flexShrink: 0 }}></div>
                        <span className="truncate" style={{ maxWidth: '120px' }}>{trace.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div style={{ overflowY: 'auto', flex: '1 1 0', minHeight: 0 }}>
                {/* Selected trace color details */}
                {selectedTraces.length > 0 && (
                  <div className="mb-3">
                    <div className="text-xs font-semibold text-gray-700 mb-2">Selected Colors</div>
                    <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${Math.min(selectedTraces.length, 4)}, 1fr)` }}>
                      {selectedTraces.map(trace => {
                        const ci = trace.traceData.colorInfo;
                        return (
                          <div key={trace.id} className="text-center">
                            <div style={{ width: '100%', height: '48px', borderRadius: '6px', border: `3px solid ${trace.color}`, backgroundColor: ci.hex || ci.rgb, marginBottom: '4px' }} title={ci.hex}></div>
                            <div style={{ fontSize: '10px', fontWeight: 600, color: '#1f2937' }} className="truncate">{trace.label}</div>
                            <div style={{ fontSize: '9px', color: '#6b7280' }}>{ci.colorName}</div>
                            <div style={{ fontSize: '9px', color: '#6b7280' }}>L*={parseFloat(ci.L).toFixed(1)} a*={parseFloat(ci.a_star).toFixed(1)} b*={parseFloat(ci.b_star).toFixed(1)}</div>
                            <div style={{ fontSize: '9px', color: '#6b7280' }}>C={parseFloat(ci.C).toFixed(1)} h={parseFloat(ci.h).toFixed(1)}</div>
                            <div style={{ fontSize: '9px', color: '#6b7280' }}>{ci.hex}</div>
                            <div style={{ fontSize: '9px', color: '#6b7280' }}>{ci.dominantWavelength ? `${ci.dominantWavelength}nm` : ''}</div>
                            <div style={{ fontSize: '9px', color: '#6b7280' }}>Avg R: {parseFloat(ci.avgReflectivity).toFixed(1)}%</div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Pairwise Delta E */}
                {comparisons.length > 0 ? (
                  <div className="mb-3">
                    <div className="text-xs font-semibold text-gray-700 mb-2">Delta E* Pairwise Comparisons ({comparisons.length})</div>
                    <div className="space-y-2">
                      {comparisons.map((comp, idx) => (
                        <div key={idx} className="p-2 rounded border border-gray-200 bg-gray-50">
                          <div className="flex items-center gap-2 mb-1">
                            <div className="flex items-center gap-1 flex-1 min-w-0">
                              <div style={{ width: '24px', height: '24px', borderRadius: '4px', border: '1px solid #d1d5db', backgroundColor: comp.rgb1, flexShrink: 0 }}></div>
                              <span className="text-xs font-medium text-gray-800 truncate">{comp.name1}</span>
                            </div>
                            <span className="text-xs text-gray-400" style={{ flexShrink: 0 }}>vs</span>
                            <div className="flex items-center gap-1 flex-1 min-w-0">
                              <div style={{ width: '24px', height: '24px', borderRadius: '4px', border: '1px solid #d1d5db', backgroundColor: comp.rgb2, flexShrink: 0 }}></div>
                              <span className="text-xs font-medium text-gray-800 truncate">{comp.name2}</span>
                            </div>
                            <div className="text-sm font-bold" style={{ flexShrink: 0, color: comp.deltaE < 1 ? '#16a34a' : comp.deltaE < 2 ? '#ca8a04' : comp.deltaE < 3.5 ? '#ea580c' : '#dc2626' }}>
                              Delta E* = {comp.deltaE.toFixed(2)}
                            </div>
                          </div>
                          <div className="flex items-center gap-3" style={{ fontSize: '9px', color: '#6b7280' }}>
                            <span>dL*={comp.dL}</span>
                            <span>da*={comp.da}</span>
                            <span>db*={comp.db}</span>
                            <span style={{ marginLeft: 'auto', fontWeight: 500, color: comp.deltaE < 1 ? '#16a34a' : comp.deltaE < 2 ? '#ca8a04' : comp.deltaE < 3.5 ? '#ea580c' : '#dc2626' }}>
                              {comp.deltaE < 1 ? 'Imperceptible' : comp.deltaE < 2 ? 'Slight (trained observer)' : comp.deltaE < 3.5 ? 'Noticeable' : comp.deltaE < 5 ? 'Significant' : 'Obvious'}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : selectedTraces.length < 2 ? (
                  <div className="text-center py-6 text-gray-400 text-sm">Select at least 2 traces to compare</div>
                ) : null}

                {/* Perception Guide */}
                <div className="bg-blue-50 rounded p-2 border border-blue-200">
                  <div className="text-xs font-semibold text-blue-800 mb-1">Delta E* Perception Guide</div>
                  <div className="grid grid-cols-2 gap-x-4" style={{ fontSize: '10px', color: '#374151' }}>
                    <div className="flex items-center gap-1"><span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#22c55e', flexShrink: 0, display: 'inline-block' }}></span> &lt;1: Imperceptible</div>
                    <div className="flex items-center gap-1"><span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#eab308', flexShrink: 0, display: 'inline-block' }}></span> 1-2: Slight (trained observer)</div>
                    <div className="flex items-center gap-1"><span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#f97316', flexShrink: 0, display: 'inline-block' }}></span> 2-3.5: Noticeable</div>
                    <div className="flex items-center gap-1"><span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#ef4444', flexShrink: 0, display: 'inline-block' }}></span> 3.5-5: Significant</div>
                    <div className="flex items-center gap-1"><span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#b91c1c', flexShrink: 0, display: 'inline-block' }}></span> &gt;5: Obvious</div>
                  </div>
                </div>
              </div>

              <div className="flex justify-end mt-3 pt-3 border-t flex-shrink-0">
                <button onClick={() => setShowTeamColorCompare(false)} className="px-4 py-1.5 bg-gray-200 text-gray-700 rounded hover:bg-gray-300 text-xs" style={{ cursor: 'pointer' }}>
                  Close
                </button>
              </div>
            </div>
          </div>
        );
      })()}

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
                      <div key={name} className="flex items-center gap-1 px-2 py-1 border rounded text-xs" style={{ backgroundColor: mat.color }}>
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
                        <div key={name} className="flex items-center justify-between px-2 py-1 border rounded text-xs" style={{ backgroundColor: mat.color }}>
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
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs text-gray-600 mb-0.5">Absorption Model</label>
                          <select
                            value={newMaterialForm.kType}
                            onChange={(e) => setNewMaterialForm({ ...newMaterialForm, kType: e.target.value })}
                            className="w-full px-2 py-1 border rounded text-xs bg-white"
                          >
                            <option value="none">None (transparent)</option>
                            <option value="constant">Constant k</option>
                            <option value="urbach">Urbach Tail</option>
                          </select>
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

      {/* ========== CREATE TEAM MODAL ========== */}
      {showCreateTeamModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 w-96">
            <h3 className="text-lg font-bold text-gray-800 mb-4">Create Team</h3>
            <input
              type="text"
              placeholder="Team name..."
              value={newTeamName}
              onChange={(e) => setNewTeamName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleCreateTeam(); }}
              className="w-full px-3 py-2 border rounded mb-4 text-sm"
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowCreateTeamModal(false)} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800" style={{ cursor: 'pointer' }}>Cancel</button>
              <button onClick={handleCreateTeam} className="px-4 py-2 text-sm bg-indigo-600 text-white rounded hover:bg-indigo-700" style={{ cursor: 'pointer' }}>Create</button>
            </div>
          </div>
        </div>
      )}

      {/* ========== INVITE MEMBER MODAL ========== */}
      {showInviteModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 w-96">
            <h3 className="text-lg font-bold text-gray-800 mb-4">Invite Team Member</h3>
            <input
              type="email"
              placeholder="Email address..."
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleInviteMember(); }}
              className="w-full px-3 py-2 border rounded mb-2 text-sm"
              autoFocus
            />
            <p className="text-xs text-gray-500 mb-4">The invitee must have an Enterprise-tier OptiCoat account.</p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowInviteModal(false)} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800" style={{ cursor: 'pointer' }}>Cancel</button>
              <button onClick={handleInviteMember} className="px-4 py-2 text-sm bg-indigo-600 text-white rounded hover:bg-indigo-700 flex items-center gap-1" style={{ cursor: 'pointer' }}>
                <UserPlus size={14} /> Send Invite
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========== SHARE TO TEAM MODAL ========== */}
      {showShareToTeamModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 w-96">
            <h3 className="text-lg font-bold text-gray-800 mb-4">Share Design to Team</h3>
            <input
              type="text"
              placeholder="Name for the shared design..."
              value={shareDesignName}
              onChange={(e) => setShareDesignName(e.target.value)}
              className="w-full px-3 py-2 border rounded mb-4 text-sm"
              autoFocus
            />
            {shareDesignName.trim() ? (
              <div>
                <p className="text-sm text-gray-600 mb-2">Share to:</p>
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {teams.map(t => (
                    <button key={t.id} onClick={() => handleShareToTeam(t.id)}
                      className="w-full text-left px-3 py-2 border rounded hover:border-indigo-300 hover:bg-indigo-50 text-sm transition-colors"
                      style={{ cursor: 'pointer' }}>
                      {t.name}
                    </button>
                  ))}
                </div>
                {teams.length === 0 && <p className="text-xs text-gray-400">No teams available. Create a team first.</p>}
              </div>
            ) : (
              <p className="text-xs text-gray-400">Enter a name to see available teams.</p>
            )}
            <div className="flex justify-end mt-4">
              <button onClick={() => { setShowShareToTeamModal(false); setShareDesignName(''); }} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800" style={{ cursor: 'pointer' }}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* ========== SUBMIT CHANGES MODAL ========== */}
      {showSubmitChangesModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6" style={{ width: '480px', maxWidth: '95vw', maxHeight: 'calc(100vh - 40px)', overflowY: 'auto' }}>
            <h3 className="text-lg font-bold text-gray-800 mb-4">Submit Changes for Review</h3>
            <label className="block text-sm text-gray-700 mb-1">Select your saved design:</label>
            <select
              value={selectedDesignForSubmission || ''}
              onChange={e => setSelectedDesignForSubmission(e.target.value || null)}
              className="w-full px-3 py-2 border rounded mb-3 text-sm"
            >
              <option value="">-- Select a saved design --</option>
              {savedDesigns.map(d => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
            <label className="block text-sm text-gray-700 mb-1">Change notes:</label>
            <textarea
              value={submissionNotes}
              onChange={e => setSubmissionNotes(e.target.value)}
              placeholder="Describe what you changed and why..."
              className="w-full px-3 py-2 border rounded mb-3 text-sm"
              rows={3}
            />

            {/* Pre-Submission Comparison Preview */}
            {selectedDesignForSubmission && (
              <div className="mb-4 p-3 border rounded-lg" style={{ borderColor: '#c7d2fe', background: '#f5f3ff' }}>
                <div className="text-xs font-semibold text-indigo-800 mb-2">Comparison Preview</div>
                {submissionPreviewLoading && (
                  <div className="text-xs text-gray-500 text-center py-3">Loading preview...</div>
                )}
                {!submissionPreviewLoading && submissionPreviewData && (() => {
                  const { personal, original, deltaE } = submissionPreviewData;
                  const pColor = personal.color;
                  const oColor = original.color;
                  return (
                    <div>
                      {/* Side-by-side color swatches */}
                      <div className="flex gap-3 mb-3">
                        <div className="flex-1 text-center">
                          <div style={{ fontSize: '10px', fontWeight: 600, color: '#4b5563', marginBottom: '4px' }}>Original</div>
                          <div style={{ width: '100%', height: '36px', borderRadius: '6px', border: '2px solid #d1d5db', backgroundColor: oColor?.hex || oColor?.rgb || '#ccc' }}></div>
                          <div style={{ fontSize: '9px', color: '#6b7280', marginTop: '2px' }}>{oColor?.colorName || '—'}</div>
                        </div>
                        <div className="flex-1 text-center">
                          <div style={{ fontSize: '10px', fontWeight: 600, color: '#4b5563', marginBottom: '4px' }}>Your Design</div>
                          <div style={{ width: '100%', height: '36px', borderRadius: '6px', border: '2px solid #6366f1', backgroundColor: pColor?.hex || pColor?.rgb || '#ccc' }}></div>
                          <div style={{ fontSize: '9px', color: '#6b7280', marginTop: '2px' }}>{pColor?.colorName || '—'}</div>
                        </div>
                      </div>

                      {/* Delta E badge */}
                      {deltaE != null && (
                        <div className="text-center mb-3">
                          <span className="inline-block px-3 py-1 rounded-full text-xs font-bold" style={{
                            backgroundColor: deltaE < 1 ? '#d1fae5' : deltaE < 2 ? '#fef3c7' : deltaE < 3.5 ? '#ffedd5' : '#fecaca',
                            color: deltaE < 1 ? '#065f46' : deltaE < 2 ? '#92400e' : deltaE < 3.5 ? '#9a3412' : '#991b1b',
                          }}>
                            Delta E* = {deltaE.toFixed(2)} — {deltaE < 1 ? 'Imperceptible' : deltaE < 2 ? 'Slight' : deltaE < 3.5 ? 'Noticeable' : deltaE < 5 ? 'Significant' : 'Obvious'}
                          </span>
                        </div>
                      )}

                      {/* Metrics comparison table */}
                      <div style={{ fontSize: '11px' }}>
                        <div className="grid grid-cols-3 gap-1 text-center" style={{ fontSize: '10px' }}>
                          <div style={{ fontWeight: 600, color: '#6b7280' }}>Metric</div>
                          <div style={{ fontWeight: 600, color: '#6b7280' }}>Original</div>
                          <div style={{ fontWeight: 600, color: '#6366f1' }}>Yours</div>

                          <div className="text-left text-gray-600">Avg R%</div>
                          <div className="text-gray-800">{oColor?.avgReflectivity ? parseFloat(oColor.avgReflectivity).toFixed(1) + '%' : '—'}</div>
                          <div className="text-gray-800">{pColor?.avgReflectivity ? parseFloat(pColor.avgReflectivity).toFixed(1) + '%' : '—'}</div>

                          <div className="text-left text-gray-600">Layers</div>
                          <div className="text-gray-800">{original.layerCount}</div>
                          <div className="text-gray-800">{personal.layerCount}</div>

                          <div className="text-left text-gray-600">Thickness</div>
                          <div className="text-gray-800">{original.totalThickness.toFixed(1)} nm</div>
                          <div className="text-gray-800">{personal.totalThickness.toFixed(1)} nm</div>

                          <div className="text-left text-gray-600">Stress</div>
                          <div className="text-gray-800">
                            {original.stress ? (
                              <span style={{ color: original.stress.riskColor }}>{original.stress.riskLevel}</span>
                            ) : '—'}
                          </div>
                          <div className="text-gray-800">
                            {personal.stress ? (
                              <span style={{ color: personal.stress.riskColor }}>{personal.stress.riskLevel}</span>
                            ) : '—'}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })()}
                {!submissionPreviewLoading && !submissionPreviewData && (
                  <div className="text-xs text-gray-400 text-center py-2">Could not load preview</div>
                )}
              </div>
            )}

            <div className="flex justify-end gap-2">
              <button onClick={() => { setShowSubmitChangesModal(false); setSubmissionNotes(''); setSelectedDesignForSubmission(null); setSubmissionPreviewData(null); }} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800" style={{ cursor: 'pointer' }}>Cancel</button>
              <button onClick={handleSubmitChanges} disabled={!selectedDesignForSubmission || !submissionNotes.trim()}
                className="px-4 py-2 text-sm bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50" style={{ cursor: 'pointer' }}>
                Submit for Review
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========== APPROVE SUBMISSION MODAL ========== */}
      {showApproveModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 w-96">
            <h3 className="text-lg font-bold text-gray-800 mb-4">Approve Submission</h3>
            <label className="block text-sm text-gray-700 mb-1">Review note (optional):</label>
            <textarea
              value={reviewNoteText}
              onChange={e => setReviewNoteText(e.target.value)}
              placeholder="Optional note for the submitter..."
              className="w-full px-3 py-2 border rounded mb-4 text-sm"
              rows={3}
            />
            <div className="flex justify-end gap-2">
              <button onClick={() => { setShowApproveModal(false); setReviewNoteText(''); setPendingSubmissionId(null); }} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800" style={{ cursor: 'pointer' }}>Cancel</button>
              <button onClick={handleApproveSubmission} className="px-4 py-2 text-sm bg-green-600 text-white rounded hover:bg-green-700 flex items-center gap-1" style={{ cursor: 'pointer' }}>
                <Check size={14} /> Approve
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========== DENY SUBMISSION MODAL ========== */}
      {showDenyModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 w-96">
            <h3 className="text-lg font-bold text-gray-800 mb-4">Deny Submission</h3>
            <label className="block text-sm text-gray-700 mb-1">Review note (required):</label>
            <textarea
              value={reviewNoteText}
              onChange={e => setReviewNoteText(e.target.value)}
              placeholder="Explain why this submission is being denied..."
              className="w-full px-3 py-2 border rounded mb-4 text-sm"
              rows={3}
            />
            <div className="flex justify-end gap-2">
              <button onClick={() => { setShowDenyModal(false); setReviewNoteText(''); setPendingSubmissionId(null); }} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800" style={{ cursor: 'pointer' }}>Cancel</button>
              <button onClick={handleDenySubmission} disabled={!reviewNoteText.trim()}
                className="px-4 py-2 text-sm bg-red-500 text-white rounded hover:bg-red-600 disabled:opacity-50 flex items-center gap-1" style={{ cursor: 'pointer' }}>
                <XCircle size={14} /> Deny
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========== SAVE DESIGN MODAL ========== */}
      {showSaveModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 w-96">
            <h3 className="text-lg font-bold text-gray-800 mb-4">Save Design</h3>
            <input
              type="text"
              placeholder="Design name..."
              value={saveDesignName}
              onChange={(e) => setSaveDesignName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSaveDesign(saveDesignName); }}
              className="w-full px-3 py-2 border rounded mb-4 text-sm"
              autoFocus
            />
            {!isSignedIn && (
              <p className="text-xs text-amber-600 mb-3">Saving locally. Sign in to save to the cloud.</p>
            )}
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowSaveModal(false)} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">Cancel</button>
              <button onClick={() => handleSaveDesign(saveDesignName)} className="px-4 py-2 text-sm bg-indigo-600 text-white rounded hover:bg-indigo-700">Save</button>
            </div>
          </div>
        </div>
      )}

      {/* ========== LOAD DESIGN MODAL ========== */}
      {showLoadModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 w-[500px] max-h-[70vh] flex flex-col">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-bold text-gray-800">Load Design</h3>
              <button onClick={() => setShowLoadModal(false)} className="text-gray-500 hover:text-gray-700"><X size={18} /></button>
            </div>
            {designsLoading ? (
              <p className="text-sm text-gray-500 py-8 text-center">Loading designs...</p>
            ) : savedDesigns.length === 0 ? (
              <p className="text-sm text-gray-500 py-8 text-center">No saved designs yet.</p>
            ) : (
              <div className="overflow-y-auto flex-1 space-y-2">
                {savedDesigns.map((design) => (
                  <div key={design.id} className="flex items-center justify-between p-3 border rounded hover:bg-gray-50">
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm truncate">{design.name}</div>
                      <div className="text-xs text-gray-500">{new Date(design.updatedAt || design.createdAt).toLocaleDateString()}</div>
                    </div>
                    <div className="flex gap-2 ml-3">
                      <button onClick={() => handleLoadDesign(design)} className="px-3 py-1 text-xs bg-indigo-600 text-white rounded hover:bg-indigo-700">Load</button>
                      <button onClick={() => handleDeleteDesign(design.id)} className="px-2 py-1 text-xs text-red-500 hover:text-red-700"><Trash2 size={14} /></button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ========== PRICING MODAL ========== */}
      {showPricingModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" onClick={() => setShowPricingModal(false)}>
          <div className="bg-white rounded-xl shadow-2xl" style={{ width: '90vw', maxWidth: 960, height: '90vh', display: 'flex', flexDirection: 'column' }} onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200" style={{ flexShrink: 0 }}>
              <div>
                <h2 className="text-xl font-bold text-gray-800">Choose Your Plan</h2>
                <p className="text-xs text-gray-500 mt-0.5">Upgrade to unlock the full power of OptiCoat Designer</p>
              </div>
              <div className="flex items-center gap-3">
                {userTier !== 'free' && isSignedIn && (
                  <button onClick={handleBillingPortal} className="text-xs text-indigo-600 underline hover:text-indigo-800">Manage Billing</button>
                )}
                <button onClick={() => setShowPricingModal(false)} className="text-gray-400 hover:text-gray-600 p-1"><X size={20} /></button>
              </div>
            </div>

            {/* Scrollable body */}
            <div style={{ overflowY: 'auto', flex: 1, minHeight: 0, padding: '0 24px 16px' }}>
              <table className="w-full border-collapse text-sm" style={{ tableLayout: 'fixed' }}>
                <thead>
                  {/* Plan headers - sticky */}
                  <tr>
                    <th style={{ position: 'sticky', top: 0, background: '#fff', zIndex: 2, textAlign: 'left', padding: '10px 8px 6px', width: '20%', fontSize: 11, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Feature</th>
                    {[
                      { key: 'free', name: 'Explorer', price: 'Free', sub: 'Get started' },
                      { key: 'starter', name: 'Starter', price: '$49/mo', sub: 'Individual engineers' },
                      { key: 'professional', name: 'Professional', price: '$149/mo', sub: 'Full-featured' },
                      { key: 'enterprise', name: 'Enterprise', price: '$349/mo', sub: 'For teams' },
                    ].map((tier) => (
                      <th key={tier.key} style={{ position: 'sticky', top: 0, background: '#fff', zIndex: 2, textAlign: 'center', padding: '10px 8px 6px', width: '20%', verticalAlign: 'bottom' }}>
                        <div style={{ position: 'relative', paddingTop: tier.key === 'professional' ? 6 : 0 }}>
                          {tier.key === 'professional' && (
                            <div style={{ position: 'absolute', top: -10, left: '50%', transform: 'translateX(-50%)', background: '#4f46e5', color: '#fff', fontSize: 9, fontWeight: 700, padding: '2px 10px', borderRadius: 10, whiteSpace: 'nowrap', lineHeight: '14px' }}>MOST POPULAR</div>
                          )}
                          <div style={{ fontWeight: 700, color: '#1f2937', fontSize: 13 }}>{tier.name}</div>
                          <div style={{ fontWeight: 700, color: '#1f2937', fontSize: 17 }}>{tier.price}</div>
                          <div style={{ fontSize: 10, color: '#9ca3af' }}>{tier.sub}</div>
                          {userTier === tier.key ? (
                            <div style={{ marginTop: 6, padding: '4px 0', fontSize: 11, fontWeight: 600, color: '#4f46e5', border: '1px solid #a5b4fc', borderRadius: 4, textAlign: 'center' }}>Current Plan</div>
                          ) : TIER_ORDER[userTier] >= TIER_ORDER[tier.key] ? (
                            <div style={{ marginTop: 6, height: 28 }}></div>
                          ) : isSignedIn ? (
                            <button onClick={() => { setShowPricingModal(false); handleCheckout(tier.key); }} style={{ marginTop: 6, width: '100%', padding: '5px 0', fontSize: 11, fontWeight: 600, background: '#4f46e5', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}>Upgrade</button>
                          ) : (
                            <div style={{ marginTop: 6, fontSize: 10, color: '#9ca3af', textAlign: 'center', padding: '4px 0' }}>Sign in to upgrade</div>
                          )}
                        </div>
                      </th>
                    ))}
                  </tr>
                  {/* Divider below sticky header */}
                  <tr><td colSpan={5} style={{ position: 'sticky', top: 96, background: '#fff', zIndex: 2, padding: 0, borderBottom: '2px solid #e5e7eb', height: 0 }}></td></tr>
                </thead>
                <tbody>
                  {/* Section: Core Limits */}
                  {[
                    { label: 'Layer Stacks', values: ['1', '3', 'Unlimited', 'Unlimited'] },
                    { label: 'Layers per Stack', values: ['6', '15', '50', '100'] },
                    { label: 'Cloud Saves', values: ['3', '25', 'Unlimited', 'Unlimited'] },
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
                          {v === true ? <span style={{ color: '#16a34a', fontWeight: 600 }}>&#10003;</span>
                           : v === false ? <span style={{ color: '#d4d4d8' }}>{'\u2717'}</span>
                           : <span className="text-gray-600">{v}</span>}
                        </td>
                      ))}
                    </tr>
                  ))}

                  {/* Section header */}
                  <tr><td colSpan={5} className="pt-4 pb-1 px-2 text-xs font-bold text-gray-800 uppercase tracking-wider border-b border-gray-200">Design Assistant</td></tr>
                  {[
                    { label: 'Target Optimizer', values: [true, true, true, true] },
                    { label: 'Max Optimization Layers', values: ['6', '15', '50', '100'] },
                    { label: 'Reverse Engineer', values: [false, false, true, true] },
                    { label: 'Color Target Mode', values: [false, false, true, true] },
                    { label: 'CSV Upload', values: [false, false, true, true] },
                  ].map((row, i) => (
                    <tr key={row.label} style={{ background: i % 2 === 0 ? '#f9fafb' : '#fff' }}>
                      <td className="py-1.5 px-2 text-xs font-medium text-gray-700">{row.label}</td>
                      {row.values.map((v, j) => (
                        <td key={j} className="py-1.5 px-2 text-center text-xs">
                          {v === true ? <span style={{ color: '#16a34a', fontWeight: 600 }}>&#10003;</span>
                           : v === false ? <span style={{ color: '#d4d4d8' }}>{'\u2717'}</span>
                           : <span className="text-gray-600">{v}</span>}
                        </td>
                      ))}
                    </tr>
                  ))}

                  {/* Section header */}
                  <tr><td colSpan={5} className="pt-4 pb-1 px-2 text-xs font-bold text-gray-800 uppercase tracking-wider border-b border-gray-200">Yield & Tracking</td></tr>
                  {[
                    { label: 'Monte Carlo Simulation', values: ['100 runs', '1,000 runs', 'Unlimited', 'Unlimited'] },
                    { label: 'Color Simulation', values: [false, false, true, true] },
                    { label: 'Layer Sensitivity', values: [false, false, true, true] },
                    { label: 'Recipe Tracking', values: [true, true, true, true] },
                    { label: 'Tracking Charts', values: ['3', '25', 'Unlimited', 'Unlimited'] },
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
                          {v === true ? <span style={{ color: '#16a34a', fontWeight: 600 }}>&#10003;</span>
                           : v === false ? <span style={{ color: '#d4d4d8' }}>{'\u2717'}</span>
                           : <span className="text-gray-600">{v}</span>}
                        </td>
                      ))}
                    </tr>
                  ))}

                  {/* Section header */}
                  <tr><td colSpan={5} className="pt-4 pb-1 px-2 text-xs font-bold text-gray-800 uppercase tracking-wider border-b border-gray-200">Advanced</td></tr>
                  {[
                    { label: 'IAD Modeling', values: [false, false, true, true] },
                    { label: 'Team Seats', values: ['\u2014', '\u2014', '\u2014', '5 (+$49/seat)'] },
                    { label: 'API Access', values: [false, false, false, true] },
                    { label: 'Priority Support', values: [false, false, false, true] },
                  ].map((row, i) => (
                    <tr key={row.label} style={{ background: i % 2 === 0 ? '#f9fafb' : '#fff' }}>
                      <td className="py-1.5 px-2 text-xs font-medium text-gray-700">{row.label}</td>
                      {row.values.map((v, j) => (
                        <td key={j} className="py-1.5 px-2 text-center text-xs">
                          {v === true ? <span style={{ color: '#16a34a', fontWeight: 600 }}>&#10003;</span>
                           : v === false ? <span style={{ color: '#d4d4d8' }}>{'\u2717'}</span>
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

      {/* ========== LUMI CHAT BADGE ========== */}
      {!chatOpen && (
        <button
          onClick={() => {
            if (CLERK_ENABLED && !isSignedIn) { setUpgradeFeature('Lumi AI Assistant'); setShowUpgradePrompt(true); return; }
            if (!requireFeature('aiChat', 'Lumi AI Assistant')) return;
            setChatOpen(true);
          }}
          style={{
            position: 'fixed',
            bottom: '10px',
            right: '10px',
            height: '24px',
            borderRadius: '12px',
            background: '#eef2ff',
            border: '1px solid #c7d2fe',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '4px',
            boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
            zIndex: 9998,
            transition: 'width 0.2s ease, background 0.2s ease, box-shadow 0.2s ease',
            overflow: 'hidden',
            padding: '0 8px',
            width: '46px',
            fontSize: '11px',
            fontWeight: 700,
            letterSpacing: '0.5px',
          }}
          onMouseEnter={e => { e.currentTarget.style.width = '82px'; e.currentTarget.style.background = '#dbeafe'; e.currentTarget.style.boxShadow = '0 2px 6px rgba(79,70,229,0.2)'; e.currentTarget.querySelector('[data-lumi]').textContent = 'ASK LUMI'; }}
          onMouseLeave={e => { e.currentTarget.style.width = '46px'; e.currentTarget.style.background = '#eef2ff'; e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.08)'; e.currentTarget.querySelector('[data-lumi]').textContent = 'LUMI'; }}
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
          width: '380px',
          height: '100vh',
          background: '#ffffff',
          boxShadow: '-4px 0 20px rgba(0,0,0,0.15)',
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
              borderBottom: '1px solid #e5e7eb',
              background: '#f9fafb',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <MessageCircle size={18} style={{ color: '#4f46e5' }} />
                <span style={{ fontWeight: 600, fontSize: '14px', color: '#1f2937' }}>Lumi</span>
                <span style={{ fontSize: '11px', color: '#9ca3af', fontWeight: 400 }}>AI Design Assistant</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
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
                    color: '#6b7280',
                    display: 'flex',
                    alignItems: 'center',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.color = '#1f2937'; }}
                  onMouseLeave={e => { e.currentTarget.style.color = '#6b7280'; }}
                >
                  <X size={18} />
                </button>
              </div>
            </div>

          </div>

          {/* Chat Messages */}
          <div style={{
            flex: 1,
            overflowY: 'auto',
            padding: '16px',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
          }}>
            {chatMessages.length === 0 && (
              <div style={{
                textAlign: 'center',
                padding: '32px 16px',
                color: '#6b7280',
              }}>
                <MessageCircle size={32} style={{ margin: '0 auto 12px', color: '#c7d2fe' }} />
                <p style={{ fontSize: '14px', fontWeight: 600, color: '#374151', marginBottom: '8px' }}>
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
                  background: msg.role === 'user' ? '#eef2ff' : '#f9fafb',
                  border: msg.role === 'user' ? '1px solid #c7d2fe' : '1px solid #e5e7eb',
                  fontSize: '13px',
                  lineHeight: '1.5',
                  color: '#1f2937',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}>
                  {msg.thinking && !msg.content ? (
                    <span style={{ color: '#6b7280', fontStyle: 'italic', display: 'flex', alignItems: 'center', gap: '6px' }}>
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
                          background: '#4f46e5',
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
            borderTop: '1px solid #e5e7eb',
            background: '#f9fafb',
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
                border: '1px solid #d1d5db',
                borderRadius: '8px',
                fontSize: '13px',
                outline: 'none',
                background: chatStreaming ? '#f3f4f6' : '#fff',
                color: '#1f2937',
              }}
              onFocus={e => { e.currentTarget.style.borderColor = '#818cf8'; e.currentTarget.style.boxShadow = '0 0 0 2px rgba(129,140,248,0.2)'; }}
              onBlur={e => { e.currentTarget.style.borderColor = '#d1d5db'; e.currentTarget.style.boxShadow = 'none'; }}
            />
            <button
              onClick={sendChatMessage}
              disabled={chatStreaming || !chatInput.trim()}
              style={{
                width: '38px',
                height: '38px',
                borderRadius: '8px',
                border: 'none',
                background: (chatStreaming || !chatInput.trim()) ? '#c7d2fe' : '#4f46e5',
                color: '#fff',
                cursor: (chatStreaming || !chatInput.trim()) ? 'default' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                transition: 'background 0.2s',
              }}
              onMouseEnter={e => { if (!chatStreaming && chatInput.trim()) e.currentTarget.style.background = '#4338ca'; }}
              onMouseLeave={e => { if (!chatStreaming && chatInput.trim()) e.currentTarget.style.background = '#4f46e5'; else e.currentTarget.style.background = '#c7d2fe'; }}
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
