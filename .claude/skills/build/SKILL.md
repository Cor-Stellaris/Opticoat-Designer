---
name: build
description: Build the project and report any errors. Use when the user says "build", "check build", or "does it compile".
allowed-tools: Bash(npx craco build *), Bash(npm run build), Read, Grep
---

## Build & Verify

Run the project build and analyze the results:

1. Run `npx craco build` in the project root
2. If the build **succeeds**:
   - Report the bundle sizes from the output
   - Note any warnings (but distinguish them from errors)
   - Confirm success
3. If the build **fails**:
   - Read the error messages carefully
   - Identify the file and line number of each error
   - Read the relevant code at those locations
   - Suggest specific fixes
   - After fixing, re-run the build to confirm

**Important context:**
- This project uses CRACO (not plain react-scripts)
- The main source file is `src/opticoat-designer.js` (~10000+ lines, single-file React app)
- Pre-existing warnings about React Hook dependencies and unused variables are expected and can be ignored
- The app uses a standalone Tailwind CSS file (`public/tailwind-standalone.css`), NOT JIT-compiled Tailwind
