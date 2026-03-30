# OptiCoat Designer

Thin-film optical coating designer and optimizer. Single-page React application.

## Build & Run

```bash
npm start          # Dev server (uses craco)
npm run build      # Production build (uses craco)
npx craco build    # Direct build command
```

Build uses **CRACO** (not plain react-scripts). Config in `craco.config.js`.

## Architecture

**Single-file React app**: All application code lives in `src/opticoat-designer.js` (~10,900 lines). There are no separate component files. All state, logic, and JSX are in one functional component using React hooks.

### Application Tabs
- **Designer** (line ~5340): Main coating designer — layer stacks, reflectivity chart, color info, E-field, admittance, phase shift
- **Design Assistant** (line ~7345): Optimizer — target mode, reverse engineering (CSV), color target mode with angle constraints
- **Recipe Tracking** (line ~8646): Track coating runs across machines
- **Yield Calculator** (line ~9266): Calculate yield from substrate dimensions

### Key Sections by Line Number
- **Material database** (line ~34): `materialDispersion` object — SiO2, SiO, TiO2, Al2O3, ZrO2, Ta2O5, Nb2O5, HfO2, MgF2, Y2O3 + user custom materials
- **State variables** (lines ~170-370): All `useState` declarations
- **Optical calculations** (lines ~539-860): `calculateReflectivityAtWavelength` (transfer matrix, supports angles via Snell's law, s/p polarization)
- **Color science** (lines ~858-1783): `calculateAngleColors`, `calculateColorInfo` (CIE 1931 + illuminants D65/D50/A/F2/F11), `calculateStackColorDeltaE`
- **Main reflectivity calc** (line ~1897): `calculateReflectivity` — drives the chart
- **Admittance loci** (line ~2126): `calculateAdmittanceLoci`
- **E-field distribution** (line ~2200): `calculateEfieldDistribution`
- **Layer management** (lines ~3556-3640): `addLayer`, `removeLayer`, `moveLayer` (drag & drop)
- **Shift/Factor** (lines ~3673-3940): `applyFactorToLayers`, `calculateShiftedThicknesses`, layer locking
- **Optimizer** (line ~4229): `optimizeDesign` — random search + 3-stage refinement, supports reflectivity targets, reverse engineering, and color target mode with angle constraints
- **Drag & drop** (lines ~3596-3615): Container-level HTML5 drag/drop with snapshotted positions to avoid flickering

## Tailwind CSS: Dual Setup

The app has **two** Tailwind sources:
1. **CRACO + PostCSS JIT** (`craco.config.js` → `tailwind.config.js`): Scans `src/**/*.{js,jsx,ts,tsx}` and generates classes at build time. Most standard Tailwind classes work fine (e.g., `border-indigo-500`, `bg-indigo-50`, `text-gray-700`).
2. **Standalone fallback** (`public/tailwind-standalone.css`): Pre-built file linked in `index.html` for runtime/dev coverage.

### Classes that still need inline styles:
Some classes are NOT generated even by JIT (typically cursor variants and fractional sizes):
- `cursor-grab`, `cursor-grabbing`, `cursor-col-resize`, `cursor-row-resize`
- `w-0.5`, `h-0.5`

```jsx
// Use inline styles for cursor and uncommon sizing
style={{ cursor: 'grab', width: '3.5rem' }}
```

When adding hover/active effects, use `onMouseEnter`/`onMouseLeave`/`onMouseDown`/`onMouseUp` event handlers with `e.currentTarget.style`.

## Key Patterns

### State Updates
When updating layers that should trigger chart recalculation, update BOTH `layers` and `layerStacks` in the same event handler for React batching:
```js
setLayers(newLayers);
setLayerStacks(prev => prev.map(stack =>
  stack.id === currentStackId ? { ...stack, layers: newLayers } : stack
));
```

### Resize Bars
Use `backgroundClip: 'content-box'` with padding for thin visible bar + wider grab area:
```jsx
style={{ width: '11px', padding: '0 4px', backgroundClip: 'content-box' }}
```

### Drag & Drop
Container-level `onDragOver` with snapshotted original row positions (`dragRowRectsRef`). Per-row `onDragOver` causes oscillation. Transparent 1px drag ghost image hides browser default.

## Dependencies
- **React 19** + react-dom
- **Recharts 3.6** — LineChart, BarChart, ScatterChart
- **lucide-react** — Icons: Plus, Trash2, Upload, X, Settings, Zap, TrendingUp, Lock, Info, Library, GripVertical
- **CRACO** — CRA config override
- **tailwindcss** — Only used for the pre-built standalone file

## Files
```
src/
  opticoat-designer.js   # All application code (~10,900 lines)
  index.js               # Entry point — renders OptiCoat Designer
  index.css              # Minimal CSS (body/code fonts only, ~263 bytes built)
  tailwind-input.css     # NOT USED — @tailwind directives, never imported
public/
  index.html             # Links tailwind-standalone.css
  tailwind-standalone.css # Pre-built Tailwind CSS (the only stylesheet)
```

## Backend (`/server`)

### Stack
- **Node.js + Express** on port 3001
- **Prisma v7** ORM with PostgreSQL (Supabase hosted)
- **Clerk** for authentication
- **Stripe** for subscription billing

### Commands
```bash
cd server
npm run dev        # Dev server with --watch
npm run db:push    # Push schema to Supabase
npm run db:generate # Generate Prisma client
npm run db:studio  # Open Prisma Studio
```

### Structure
```
server/
  src/
    index.js              # Express entry point (port 3001)
    middleware/
      auth.js             # Clerk auth + auto-create user
      tierCheck.js        # Tier feature gating middleware
    routes/
      auth.js             # POST /api/auth/sync, GET /api/auth/tier
      designs.js          # CRUD /api/designs
      materials.js        # CRUD /api/materials
      billing.js          # Stripe checkout/portal/webhooks
      tracking.js         # CRUD /api/tracking/runs
      machines.js         # CRUD /api/machines
    services/
      tierLimits.js       # TIER_LIMITS config + Stripe price mappings
      stripe.js           # Stripe instance + price-to-tier mapping
  prisma/
    schema.prisma         # Database schema (User, Design, CustomMaterial, Machine, TrackingRun)
    prisma.config.ts      # Prisma v7 datasource config (DATABASE_URL)
```

### Subscription Tiers
- **Free (Explorer)**: 1 stack, 5 layers, 1 save, no optimizer, no Lumi
- **Starter (Designer)**: $49/mo — 3 stacks, 15 layers, 25 saves, target optimizer, no Lumi
- **Professional (Engineer)**: $149/mo — unlimited stacks/saves, 50 layers, all features, Lumi AI, 7-day trial
- **Enterprise (Production)**: $599/mo — 100 layers, team workspaces, 5 seats included, API access, Lumi AI

### Prisma v7 Note
Prisma 7 removed `url` from `datasource` block in schema.prisma. The connection URL is in `prisma/prisma.config.ts` instead. Use `env("DATABASE_URL")`.

### Environment Variables
Copy `server/.env.example` to `server/.env` and fill in:
- `DATABASE_URL` — Supabase PostgreSQL connection string
- `CLERK_SECRET_KEY` — from Clerk dashboard
- `STRIPE_SECRET_KEY` — from Stripe dashboard
- `STRIPE_WEBHOOK_SECRET` — from Stripe webhook setup
- `STRIPE_*_PRICE_ID` — create products in Stripe first

## Custom Skills
- `/build` — build & verify
- `/reviewer` — full-stack code reviewer (bugs, security, performance, cross-stack)
- `/frontend` — frontend specialist
- `/backend` — backend specialist

## Pre-existing Build Warnings (Safe to Ignore)
- React Hook `useCallback` missing dependency warnings (intentional to avoid infinite loops)
- `originalStacks` / `originalMachines` assigned but never used
