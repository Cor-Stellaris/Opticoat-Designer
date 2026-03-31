# Mobile Responsive Design Spec

**Date:** 2026-03-30
**Status:** Draft

## Context

OptiCoat Designer is a single-page React app that currently only works well on desktop. The layout uses fixed side-by-side panels, mouse-only interactions (drag-and-drop, hover, resize bars), tiny touch targets (~24px), and hardcoded panel widths. Mobile readiness score: ~2/10. Users need full functionality on phones and tablets — viewing, editing, demoing, and sharing designs.

## Approach

**CSS-First Responsive (Approach A)** — All changes stay within `src/opticoat-designer.js`. A `useIsMobile()` hook detects screen size. Layout decisions branch on `isPhone`/`isTablet`/`isDesktop` flags. No new files, no new dependencies. Desktop layout is completely untouched — all mobile changes are behind conditionals.

## Breakpoints

| Name | Width | Behavior |
|------|-------|----------|
| Phone | < 640px | Single-column, stacked panels, touch interactions |
| Tablet | 640px - 1024px | Hybrid — forced "tall" mode, larger touch targets |
| Desktop | > 1024px | Current layout, no changes |

Detection: `useIsMobile()` hook using `window.innerWidth` + `resize` event listener. Returns `{ isPhone, isTablet, isDesktop }`.

## Tab Navigation & Header (Phone)

- Tab names shorten: "Designer", "Assistant", "Tracking", "Yield"
- Header controls (dark mode, save/load workspace, user avatar) become icon-only, arranged in a compact row on the same line as tabs (right-aligned)
- All tab buttons and header controls grow to minimum 44px touch targets

## Designer Tab (Phone)

The most complex adaptation. Layout changes from side-by-side to a vertical split:

```
┌──────────────────────────────┐
│ [Designer] [Asst] [Trk] [Yl]│  Short tab names
│ [Moon] [Save] [Load] [User]  │  Icon-only controls
├──────────────────────────────┤
│ Lambda: 380-780  Y: 0-100 [G]│  Toolbar (compact, wrapped)
├──────────────────────────────┤
│ ┌──────────────────────────┐ │
│ │   Reflectivity Chart     │ │  Top half (fixed, no scroll)
│ │   (ResponsiveContainer)  │ │
│ └──────────────────────────┘ │
├══════ resize bar ════════════┤  Touch-draggable
│ Stack: [Default v] [+]      │
│ Substrate: [BK7 v] 1.0mm    │
│──────────────────────────────│
│ = 1  SiO2        125.0 nm   │  Swipe left -> [Lock][Delete]
│ = 2  TiO2         85.0 nm   │  Long-press to drag-reorder
│ = 3  SiO2        125.0 nm   │  Tap material/thickness to edit
│         [+ Add Layer]        │  Scrollable bottom half
└──────────────────────────────┘
```

### Chart panel (top)
- Fixed position (does not scroll with layers)
- Uses existing `ResponsiveContainer` — already scales with parent
- Chart zoom: touch-drag equivalent of existing mouse drag-to-zoom
- Default takes ~40% of screen height, adjustable via resize bar

### Resize bar
- Existing mouse-only resize bar gets touch event handlers (`touchstart`, `touchmove`, `touchend`)
- Visual: same thin bar with wider grab area (11px with padding)

### Layer rows
- **Clean single-line format:** grip handle, layer #, material name, thickness value
- **Swipe-to-reveal:** Swipe a row left to show lock + delete buttons. Only one row can be open at a time. Swipe right or tap elsewhere to close.
- **Long-press drag:** 300ms hold triggers drag mode. Row lifts with subtle shadow. Drag to new position. Drop to reorder.
- **Inline editing:** Tap material name to open dropdown (native `<select>` on mobile for OS picker). Tap thickness to focus the input field.

### Color sidebar
- On phone: becomes a collapsible section below the chart, toggled by a small "Color" button
- On tablet: stays visible as sidebar (same as desktop but narrower)

### Toolbar controls
- Wavelength range, Y-axis range, display mode selector, and settings gear wrap to fit phone width
- Inputs use 16px minimum font size (prevents iOS auto-zoom on focus)

## Designer Tab (Tablet)

- Forces "tall" (vertical split) mode — chart on top, layers below
- Color sidebar stays visible
- Touch targets enlarged to 44px
- Otherwise similar to desktop

## Design Assistant Tab (Phone)

Currently: 45%/55% left-right split.

On phone:
- Stacks vertically — configuration section on top, results section below
- Mode selector (Target Point / Reverse Engineer) stays as radio buttons, full-width
- Target inputs become full-width single-column
- CSV upload area becomes full-width
- "Generate" button becomes full-width sticky at the bottom
- Results section scrolls below configuration

## Recipe Tracking Tab (Phone)

Currently: 192px left sidebar + charts right.

On phone:
- Selection controls (machine, recipe, run#) become full-width at top
- Run list becomes a collapsible section below controls (tap to expand/collapse)
- INT/EXT chart panels stack vertically (INT above EXT) instead of side-by-side
- Data tables get horizontal scroll on the table container

## Yield Calculator Tab (Phone)

Currently: 2-column grid.

On phone:
- Grid becomes single-column — simulation parameters above, results below
- All inputs go full-width
- Charts remain in ResponsiveContainer (already scales)
- Collapsible details section works well on mobile as-is

## Touch Interactions

### Long-press drag (layer reordering)
- 300ms hold threshold triggers drag mode
- Visual feedback: row lifts with shadow, slight scale increase
- Drag to new position, drop to place
- Implemented with `touchstart`, `touchmove`, `touchend` event handlers
- Cancels if finger moves >10px before 300ms threshold (prevents accidental triggers during scroll)

### Swipe-to-reveal (layer actions)
- Swipe left on a layer row reveals lock + delete buttons
- Only one row can have revealed actions at a time
- Swipe right or tap elsewhere to close
- Implemented with touch event handlers tracking horizontal movement
- Threshold: 50px horizontal movement triggers reveal

### Chart zoom (touch)
- Double-tap to reset zoom (equivalent to existing double-click)
- Note: Recharts doesn't natively support pinch-to-zoom. For v1, chart zoom on mobile is limited to the existing drag-to-select behavior adapted for touch (single-finger horizontal drag within the chart area selects a zoom range). Pinch-to-zoom is a future enhancement if needed.

### Resize bar (touch)
- Existing mouse handlers extended with `touchstart`/`touchmove`/`touchend`
- Same visual behavior as desktop but with touch events

## General Mobile Fixes

### Touch targets
- All buttons grow to minimum 44px height on phone (currently ~24px)
- Icon-only buttons get 44x44px minimum hit area
- Spacing between buttons increases to prevent mis-taps

### Input fields
- Minimum 16px font size on all inputs (prevents iOS Safari auto-zoom on focus)
- Material dropdowns use native `<select>` on mobile for OS-native picker
- Number inputs use `inputMode="decimal"` for numeric keyboard

### Modals
- All modals become full-width on phone (width: 95vw or 100vw)
- Max-height: 90vh with scroll
- Pricing modal becomes scrollable single-column
- Save/Load workspace modals go full-width
- Close button enlarged to 44px touch target

### Lumi AI badge
- Stays in bottom-right corner
- Touch target enlarged to 48px minimum
- No hover state — tap to expand directly

## What Does NOT Change

- **Desktop layout** — completely untouched, all changes behind `isPhone`/`isTablet` flags
- **All optical calculations** — transfer matrix, color science, optimizer, E-field, admittance
- **Data model** — layers, stacks, materials, state management
- **Chart library (Recharts)** — already uses ResponsiveContainer
- **Backend/API** — no server changes
- **Authentication/billing** — no changes

## Dependencies

**No new npm dependencies.** All touch interactions implemented with vanilla JS touch event handlers. The `useIsMobile()` hook uses standard `window.innerWidth` and `resize` event.

## Implementation Order

1. `useIsMobile()` hook + breakpoint detection
2. Tab navigation + header controls (phone adaptation)
3. Designer tab — vertical split layout with touch resize bar
4. Designer tab — layer rows: swipe-to-reveal + long-press drag + inline edit
5. Designer tab — chart touch zoom + color section collapse
6. Design Assistant tab — stack to vertical
7. Recipe Tracking tab — stack to vertical + horizontal scroll tables
8. Yield Calculator tab — single-column grid
9. Modal sizing adjustments
10. Touch target sizing pass across all buttons/inputs
11. Toolbar control wrapping

## Verification

1. Test on Chrome DevTools mobile emulation (iPhone SE 375px, iPhone 14 390px, iPad 768px)
2. Test on actual phone via local network (`npm start` + access via phone browser)
3. Verify all tabs render without horizontal overflow
4. Verify layer swipe-to-reveal works (touch simulation in DevTools)
5. Verify layer long-press drag reorders correctly
6. Verify chart resize bar works with touch
7. Verify all inputs accept input without iOS auto-zoom
8. Verify modals fit screen and are dismissible
9. Verify desktop layout is completely unchanged at >1024px
