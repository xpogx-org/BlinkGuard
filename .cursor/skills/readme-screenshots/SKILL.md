---
name: readme-screenshots
description: >-
  Capture and refresh BlinkGuard README product screenshots on Windows —
  scripts/screenshot_tools Win32 helpers, EN+light prefs, nav/Debug overlay
  workflow, docs/screenshots PNG set, README Screenshots section, and the
  product intro video (scripts/intro_video → docs/intro/).
  Use when updating README images, docs/screenshots, product screenshots,
  capture-window / click-rel helpers, regenerating settings/popup PNGs, or
  rebuilding the intro MP4.
---

# README screenshots (Windows)

Tools live in [`scripts/screenshot_tools/`](../../../scripts/screenshot_tools/)
(same pattern as [`python/log_tools/`](../../../python/log_tools/)). PNG assets
go only in [`docs/screenshots/`](../../../docs/screenshots/). Do **not** leave
helper `.ps1` under `docs/screenshots/`.

## Current README set

| File | Content |
|---|---|
| `settings-reminders.png` | Reminders (+ quiet hours / fullscreen pause) |
| `settings-camera.png` | Camera (incl. Ultra quality) |
| `settings-progress.png` | Progress → Statistics tab (goals + totals) |
| `popup-blink.png` | Blink overlay (Debug preview) |
| `popup-exercise.png` | Exercise overlay (Debug preview; left-biased) |

Keep the set lean. Skip Appearance, Settings/backup, About, Rewards-only,
look-away popup, dark mode, onboarding, live camera preview unless the user
asks. When the settings nav gains a major surface (like Progress), add one
shot and update [`README.md`](../../../README.md) Screenshots.

## Tools

Run with **Windows PowerShell 5.1** (`powershell.exe`) from repo root or
`scripts/screenshot_tools/`:

| Script | Args |
|---|---|
| `capture-window.ps1` | `<out.png>` |
| `capture-title.ps1` | `<title-substring> <out.png>` |
| `capture-hwnd.ps1` | `<hwnd> <out.png>` |
| `click-rel.ps1` | `<relX> <relY>` (window client/chrome-relative) |
| `list-electron-wins.ps1` | (none) |

One-offs → `scripts/screenshot_tools/_scratch/` (gitignored).

## Capture workflow

1. **Backup** `%APPDATA%/BlinkGuard/config.json` → `config.json.bak-screenshots`.
2. Set for shots: `locale: "en"`, `darkMode: false`, `popupMessage: "Blink!"`,
   EN `exercisePrompts`, `hasCompletedOnboarding: true`.
3. `npm run dev` — wait until the main window title is `BlinkGuard`
   (`list-electron-wins.ps1`). Cold start can take a few seconds after
   `BlinkGuard app started`.
4. Capture settings views with `capture-window.ps1` after `click-rel.ps1` nav.
5. Popups: Debug → Preview overlays. Blink title ≈ `Blink Reminder`
   (stays until dismiss — no 2.5s auto-close; starting/stopped still ~2.5s).
   Exercise / look-away are often title `blinkguard`; use `list-electron-wins.ps1` +
   `capture-hwnd.ps1`. Exercise is **left-biased**; look-away **right-biased**.
   Ambient glow is workArea-only (Debug kind `ambient`) — capture the display frame, not a card.
6. With `cameraEnabled`, blink snooze is hidden — that is correct product UI.
7. **Restore** prefs from the backup; stop the app so in-memory EN/light does
   not overwrite the restored file on the next store write.
8. Delete any probe PNGs / temp scripts; stage only `docs/screenshots/*.png`
   + README if the section changed.
9. If those PNGs changed, regenerate the intro: `npm run generate:intro-video`
   (ffmpeg on PATH). Stage `docs/intro/blinkguard-intro.mp4` + `poster.png`.
   Intermediates stay in `scripts/intro_video/_scratch/` (gitignored).

## Nav click hints (relative to window; DPI-sensitive)

Sidebar X ≈ `120`. Approximate Y for a ~1169×878 window (re-probe if layout
shifts):

| Section | relY (approx) |
|---|---|
| Reminders | 130 |
| Camera | 185 |
| Progress | 305 |
| Debug | 475 |

Debug overlay row: Blink ≈ `(310, 250)`; Exercise often wraps ≈ `(310, 300)`.
Always verify with a probe capture or `list-electron-wins.ps1` after clicks.

## Prefs safety

Never commit `%APPDATA%` files. Always restore the user’s locale/theme after
shots. Prefer stopping Electron before restoring the JSON backup.
