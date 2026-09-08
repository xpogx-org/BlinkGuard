# /screenshots

Refresh BlinkGuard README product screenshots (and optional intro MP4) on Windows.

**Invoke skill:** `readme-screenshots`

## Steps

1. Read `.cursor/skills/readme-screenshots/SKILL.md`.
2. Use helpers under `scripts/screenshot_tools/` (not under `docs/screenshots/`).
3. Capture EN + light prefs; write PNGs only to `docs/screenshots/`.
4. Update the README Screenshots section when the set changes.
5. Optional intro video: `npm run generate:intro-video` → `docs/intro/`.

Do not leave helper scripts under `docs/screenshots/`.
