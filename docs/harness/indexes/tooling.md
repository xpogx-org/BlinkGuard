<!-- harness-stock: true -->
# Index: Tooling

- **What:** Verify wrapper, lint/test/build entrypoints, Cloud VM caveats, packaging, `/deploy`. Skills live under git-tracked `.cursor/skills/` (session `.cursor/plans/` stay gitignored).
- **Where:** `docs/harness/manifest.json`, `scripts/harness-verify.mjs`, `package.json` scripts, `biome.json`, `tsconfig.json`. Layer 1: `npx @biomejs/biome check src` then `npm run build:electron` (`npm run lint` writes — not Layer 1; Biome scopes `src` only; LF via `biome.json` + `src/**` in `.gitattributes`; Tailwind CSS parser on; `src/assets/**` excluded — Lottie JSON and unused logos). Layer 2: `npm run coverage` (`coverage/` is gitignored). Layer 3 missing. Branches: day-to-day on `development`; `main` only via skill `deploy` (`/deploy` is HITL).
- **When to open:** Changing the check command, CI, packaging, Cloud VM notes, or `/deploy`. Cloud VM: `DISPLAY=:1 npm run dev`; `--no-sandbox` and DBus/GPU log noise are benign; sidecar binary is not built there. Do not run `build:mac` / `build:windows` / publish scripts in Cloud — OS-host packaging only.
