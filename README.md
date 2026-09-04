<p align="center">
  <img src="assets/icons/icon.png" alt="BlinkGuard" width="128" height="128">
</p>

<h1 align="center">BlinkGuard</h1>

<p align="center">
  <strong>Windows and macOS</strong> desktop app that helps prevent dry eyes and eye strain — timer-based blink reminders (no camera required), optional on-device camera detection, and 20-20-20 breaks. No account. No cloud.
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg?style=for-the-badge" alt="MIT License"></a>
  <a href="https://github.com/xpogx-org/BlinkGuard/releases/latest"><img src="https://img.shields.io/github/v/release/xpogx-org/BlinkGuard?style=for-the-badge" alt="Latest release"></a>
  <a href="https://github.com/xpogx-org/BlinkGuard/releases/latest"><img src="https://img.shields.io/badge/Windows-supported-0078D6?style=for-the-badge&logo=windows&logoColor=white" alt="Windows"></a>
  <a href="https://github.com/xpogx-org/BlinkGuard/releases/latest"><img src="https://img.shields.io/badge/macOS-supported-000000?style=for-the-badge&logo=apple&logoColor=white" alt="macOS"></a>
</p>

<p align="center">
  <a href="https://github.com/xpogx-org/BlinkGuard/releases/latest"><strong>Download</strong></a>
  ·
  <a href="PRIVACY.md">Privacy</a>
  ·
  <a href="SECURITY.md">Security</a>
  ·
  <a href="CHANGELOG.md">Changelog</a>
</p>

## Contents

- [Features](#features)
- [Intro](#intro)
- [Screenshots](#screenshots)
- [Install](#install)
- [Development](#development)
- [Connect](#connect)
- [Support](#support)
- [Third-party attribution](#third-party-attribution)

## Features

### For your eyes

- **Timer blink reminders** — micro-break cues every 15–120s with no camera; optional camera miss-gap (1–10s) when blink detection is on
- **Blink prompt profiles** — Standard / Gentle / Strong (ambient glow → overlay → escalate)
- **20-20-20 look-away** and **eye exercises** — independent timers; Skip / Snooze; exercises auto-close after 30 seconds
- **Quiet hours, fullscreen, and per-app pause** — hide prompts during quiet time (optional per-weekday hours), fullscreen, or listed foreground apps
- **Progress** — stats (blinks plus look-away/exercise), goals, levels, achievements, rewards shop (cheer themes, popup glow, snooze tokens), and a shareable card
- **Session recap** — overlay summary when you stop or idle; native recap on lock/quit (toggle in Settings)
- **Your overlay** — drag, resize, colors, transparency; layout remembered per display (kept if a monitor sleeps or unplugs); optional sounds and native OS toasts
- **Local by design** — preferences via `electron-store`; named Setups; backup/import JSON; English and Ukrainian; dark / light. Camera frames never leave the machine ([PRIVACY.md](PRIVACY.md))

### Camera and power users

- **Optional blink detection** — OpenCV YuNet + dlib sidecar; personal EAR calibration; reminds you only when you haven’t blinked for the miss-gap
- **MGD mode** — timed popups even while blinking; the popup still closes on a detected blink
- **Setup vs Tuning** — enable and calibrate on Setup; live preview (up to Ultra 30 FPS), capture-status chip, face hints (`head_too_low`, motion-stable overlay), nudge when EAR calibration is stale
- **Sleep / lock / lid** — pauses with a distinct reason in Settings and the tray; resumes when the session is active again
- **Tray** — Start/Stop tracking, Hush/End hush all prompts, snooze by kind, switch Setups, pause and capture status; idle vs tracking icon
- **In-app updates** — GitHub Releases (Windows and macOS); About opens Release Notes
- **Report a problem** — About exports local diagnostics and opens a structured GitHub bug report (attach the zip yourself; nothing uploads automatically)

Full history: [CHANGELOG.md](CHANGELOG.md).

## Intro

[![Watch the BlinkGuard intro](docs/intro/poster.png)](docs/intro/blinkguard-intro.mp4)

Silent 18-second 1080p overview. After README screenshots change, regenerate with `npm run generate:intro-video`.

## Screenshots

![Reminders settings](docs/screenshots/settings-reminders.png)

![Camera settings](docs/screenshots/settings-camera.png)

![Progress](docs/screenshots/settings-progress.png)

![Blink reminder popup](docs/screenshots/popup-blink.png)

![Exercise reminder popup](docs/screenshots/popup-exercise.png)

## Install

Download the latest Windows installer or macOS DMG from [GitHub Releases](https://github.com/xpogx-org/BlinkGuard/releases/latest).

### Windows

Run `BlinkGuard.Setup.exe` and follow the installer.

### macOS Gatekeeper (“app is damaged”)

GitHub macOS builds are often **unsigned** (no Apple Developer ID / notarize in CI). After a browser download, macOS attaches a quarantine flag. Gatekeeper then shows:

> “BlinkGuard” is damaged and can’t be opened. You should move it to the Trash.

The app is not corrupt. **Right-click → Open does not bypass this dialog.** After dragging BlinkGuard into Applications, strip the quarantine flag in Terminal:

```bash
xattr -cr /Applications/BlinkGuard.app
```

Then open the app again. If it lives somewhere else, pass that path instead.

Signed + notarized builds do not need this step.

---

## Development

The desktop app runs **without** the camera sidecar. Reminders, exercises, look-away, progress, and settings all work with Node/npm only. Camera blink detection is optional and off by default; when you enable it, frames stay on-device (see [PRIVACY.md](PRIVACY.md)).

Layout and IPC traps: [docs/architecture.md](docs/architecture.md), [docs/ipc-and-preferences.md](docs/ipc-and-preferences.md). Cursor Cloud notes: [AGENTS.md](AGENTS.md).

### Stack

| Area | Stack |
|---|---|
| UI | React 19, TypeScript 7, Vite 8, Tailwind CSS 4, Lucide |
| Desktop | Electron 44, `electron-store`, `electron-updater` |
| Computer vision (optional) | Python, OpenCV 5, dlib 20, NumPy, PyInstaller |
| Tooling | Biome, Vitest 5, Electron Builder |

### Core app

Requires **Node.js 22.12+** (LTS is fine; Vitest 5 floor).

```bash
npm install
npm run dev          # Vite + Electron (needs a display)
npm run lint         # Biome (writes fixes)
npm run coverage     # Vitest one-shot
npm run build:electron
```

On startup you may see `Blink detector binary not found …` — that is expected until you build the optional sidecar below. Timer-mode reminders still work.

### Optional camera sidecar

Only needed if you want OpenCV/dlib blink detection or the live camera preview. You need a webcam, [Git LFS](https://git-lfs.com/) for the landmarks model, the committed YuNet ONNX (`electron/assets/models/face_detection_yunet_2023mar.onnx`), optional OCEC confirm ONNX (`electron/assets/models/ocec_s.onnx`), and a Python toolchain that can install `dlib`.

**Python version:** use **3.11** (same as CI). Very new releases (e.g. **3.14**) often have no prebuilt `dlib` wheel on Windows; `pip` then tries to compile from source and fails without a C++ toolchain.

**Windows C++ toolchain:** Visual Studio Code is an editor only — it does **not** include a compiler. Install [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) (or Visual Studio) with the **Desktop development with C++** workload before `pip install dlib`.

```bash
git lfs pull   # ~99 MB model: electron/assets/models/shape_predictor_68_face_landmarks.dat

# macOS / Linux
cd python
./setup.sh
./build_and_install.sh

# Windows (cmd)
cd python
setup.bat
build_and_install.bat
```

That installs deps into `python/venv`, builds a PyInstaller binary, and copies it to `electron/resources/`. Restart `npm run dev` afterward. Without the binary, leave camera detection off — the rest of the app is unaffected.

Linux appears here only as a **sidecar build host**, not a packaged BlinkGuard target.

### Sharper UI text (Windows + NVIDIA)

Popup transparency is applied to the **panel background** (CSS alpha), not `BrowserWindow.setOpacity`, so glyphs stay fully opaque. Frosted panels use a blur underlay behind text. Settings no longer force grayscale font smoothing.

If text still looks soft on NVIDIA:

1. NVIDIA Control Panel → Manage 3D settings → Program Settings → BlinkGuard (or Electron)
2. Antialiasing - Mode → **Application-controlled**
3. Disable **MFAA**, **FXAA**, and **Enhance application setting** for that profile
4. Compare at **100%** Windows display scale when testing

Tradeoff: less driver AA for that app profile; in-app glass may look slightly less frosted than before.

---

## Connect

[![GitHub](https://img.shields.io/badge/GitHub-xpogx--org%2FBlinkGuard-181717?style=for-the-badge&logo=github&logoColor=white)](https://github.com/xpogx-org/BlinkGuard)
[![Telegram](https://img.shields.io/badge/Telegram-PaOnGa-26A5E4?style=for-the-badge&logo=telegram&logoColor=white)](https://t.me/PaOnGa)
[![LinkedIn](https://img.shields.io/badge/LinkedIn-Pavlo%20Dzhevaha-0077B5?style=for-the-badge&logo=linkedin&logoColor=white)](https://www.linkedin.com/in/pavlo-dzhevaha-342068105/)
[![Email](https://img.shields.io/badge/Email-pavel19.1078%40gmail.com-D14836?style=for-the-badge&logo=gmail&logoColor=white)](mailto:pavel19.1078@gmail.com)

BlinkGuard is a personal project by **Pavlo Dzhevaha** — built locally, from the heart, after enough dry eyes from long coding sessions. Issues, ideas, and PRs are welcome.

**Bug reports:** In the app, **About → Report a problem** — export diagnostics, then **Open GitHub issue** and attach the zip. [Issue templates](https://github.com/xpogx-org/BlinkGuard/issues/new/choose) are also on GitHub. See [PRIVACY.md](PRIVACY.md).

---

## Support

Donations go toward release costs (code signing, notarization, CI). The app stays free, local, and open source — no paywalled features.

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/X6B6250JKQ)
[![Open Collective](https://img.shields.io/badge/Open%20Collective-BlinkGuard-7FADF2?style=for-the-badge&logo=open-collective&logoColor=white)](https://opencollective.com/xpogx)

---

## Star BlinkGuard

If BlinkGuard helps your eyes on long screen days, a star helps others find it and keeps development going.

**BlinkGuard** — a quiet, local companion for your eyes

[![Watch](https://img.shields.io/github/watchers/xpogx-org/BlinkGuard?style=for-the-badge&label=Watch&logo=github)](https://github.com/xpogx-org/BlinkGuard/subscription)
[![Fork](https://img.shields.io/github/forks/xpogx-org/BlinkGuard?style=for-the-badge&logo=github)](https://github.com/xpogx-org/BlinkGuard/fork)
[![Stars](https://img.shields.io/github/stars/xpogx-org/BlinkGuard?style=for-the-badge&logo=github)](https://github.com/xpogx-org/BlinkGuard/stargazers)

## Third-party attribution

BlinkGuard is originally based on [ScreenBlink](https://github.com/katunli/ScreenBlink) by Katun Li. Copyright and license notices for that lineage are recorded in [NOTICE](NOTICE). BlinkGuard is maintained independently under the MIT License ([LICENSE](LICENSE)).
