# Changelog

All notable changes to BlinkGuard are documented here. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [2.17.0] - 2026-08-30

### Added

- Session recap: overlay on qualified stop/idle; native summary on lock/quit; toggle in Settings General
- Tray: Hush all prompts (End hush row) plus shortcut; IPC `snooze-all` / `end-prompt-hush`
- Rewards: expanded shop (cheer themes, popup presets, snooze tokens); equip cheer and glow from Appearance
- Camera: `faceStatus` through sidecar and popup overlay; blink tracking gated on honest landmark trust
- Camera: `head_too_low` hint and motion-stable overlay hints during movement
- Onboarding: timer-first finish arms the first session with launch-at-login opt-out on Ready

### Changed

- Camera: calibration on Setup tab; simplified camera enable toggle
- Reminders: resync reminder loops when camera mode toggles during active tracking

### Fixed

- Updater: require consent before installing a staged update on quit
- Settings: restore inline icon and title layout in SettingRow

## [2.16.0] - 2026-08-24

### Added

- Tray: Start/Stop tracking, grouped menu with pause row, Snooze submenu, and idle vs tracking icon
- Tray: switch named Setups (confirms unsaved changes like Settings)
- Progress: look-away and exercise completed/skipped/snoozed on day history and the statistics panel
- Settings: motion on panels, banners, and dialogs; themed Select instead of native dropdowns
- Popups: enter motion, camera overlay fade, and look-away countdown ring
- Debug: Clean leftover overlays and sounds

### Changed

- Progress: compact statistics tab (goals and streak on the Goals card)

### Fixed

- Settings: selected nav pill fills the full row
- Debug: Ambient glow preview auto-dismisses after 3s

## [2.15.1] - 2026-08-22

### Fixed

- Camera: reject sub-60ms saccades as blinks when there is no reopen

## [2.15.0] - 2026-08-22

### Changed

- Camera: retrain Stage 4 personal classifier on mixed traces (OCEC drop/missing)

### Fixed

- Popup: keep per-display position and size when a monitor sleeps, unplugs, or becomes primary
- Camera: unstick skip_eyes_closed after glances
- Reminders: keep the Windows taskbar visible under ambient glow

## [2.14.0] - 2026-08-21

### Added

- Settings: named Setups to save and hot-apply preference snapshots
- Reminders: Strong cue profile (glow, overlay, sound)
- Quiet hours: per-weekday schedule overrides in Pause

### Fixed

- Camera: resync capture-status chip after cold-start subscribe
- Camera: credit real OCEC closes that hit reject_aperture
- Reminders: keep Gentle ambient under the blink overlay; pin glow above the Windows taskbar

## [2.13.0] - 2026-08-21

### Added

- Reminders: Standard / Gentle prompt profile with ambient glow → overlay → escalate ladder and ICMU backoff
- Reminders: separate camera miss-gap and timer micro-break intervals in settings
- Camera: live capture status in the tray tooltip/menu and Settings Setup chip

### Changed

- Reminders: ladder and streak cheer owned by ReminderService; standalone blink-rate coach toast removed

## [2.12.1] - 2026-08-16

### Fixed

- Sound: recover chimes after the default audio device changes
- Camera: keep blink tracking responsive when the app is in the tray

## [2.12.0] - 2026-08-16

### Added

- Optional native OS toasts for blink, exercise, and look-away (overlay, banners, or both)
- Remember blink editor layout per display; Save all / Set up next for remaining monitors

## [2.11.0] - 2026-08-16

### Added

- Section tabs on Reminders, Settings, About, and Debug (same chrome as Camera / Progress)
- Distinct lock, display-off, lid, and sleep pause reasons in settings and tray

### Fixed

- Camera: recover/persist desk rest; credit OCEC look-down and threshold misses

### Changed

- Reminders schedule: keep interval duration on the seconds chip instead of repeating it in copy

## [2.10.0] - 2026-08-15

### Added

- Camera settings split into Setup and Tuning tabs
- Nudge when EAR calibration is stale or drifted (banner + popup; no auto-start)
- Styled scrollbars on settings pages

### Changed

- UI: shared theme tokens for colors and type

## [2.9.0] - 2026-08-14

### Added

- Camera: OCEC open/closed overlay to confirm blink credits (default on)
- Product intro video (`docs/intro/blinkguard-intro.mp4`)

### Fixed

- Camera: credit look-down blinks rejected as opening or classifier
- Camera: back off locate work when no face is visible (idle YuNet-only; throttle none IPC; debounce no-face toast)

## [2.8.0] - 2026-08-14

### Added

- Achievements catalog and Progress tab
- Camera device picker persisted in settings
- Per-app foreground blocklist to pause reminders
- Session: pause tracking on lid close, lock, and display sleep; restore after wake
- Eye-care popups: keyboard a11y and click-through

### Fixed

- Camera: keep Logitech C170 face detect in daylight
- Camera: keep desk-distance faces after lean-back
- Settings: reset scroll when switching pages

### Changed

- Docs: Ko-fi and Open Collective in Support

## [2.7.1] - 2026-08-13

### Fixed

- Camera: YuNet locates faces; HOG boxes feed 68-pt landmarks (no CNN crop to predictor); relative min bbox against eye/eyebrow false locks; skip HOG-refine while YuNet box is still; Phase A ignores non-ok faces; ignore OpenCV DNN graph-engine stderr
- Camera: accept native streams and stop idle preview capture
- CI: repair ProcessCleanup mocks for tsc; retry Windows shape-predictor download with curl

### Changed

- Docs: macOS Gatekeeper quarantine workaround in README

## [2.7.0] - 2026-08-12

### Added

- Camera: two-phase personal blink calibration
- Blink: pose, per-eye, aperture, and logistic veto
- Blink: labeled EAR corpus and offline F1 tools
- Stats: live BPM from face-visible coverage

### Fixed

- Sidecar: let PyInstaller delete Temp on graceful quit
- Reminders: pause eye-care on no-face auto-stop when coupled

### Changed

- GitHub links and update/publish targets point at `xpogx-org/BlinkGuard`
- Ignore versioned PyInstaller build output

## [2.6.0] - 2026-08-10

### Added

- Multi-action global keyboard shortcuts
- Configurable reminder snooze duration
- Eye-care (exercises / look-away) can run independently of blink reminders
- Expanded first-run onboarding with language and ready steps
- Settings: collapse custom prompts behind toggles

### Fixed

- Camera: harden HOG face detect against flicker misses
- Camera: mirror preview for natural left-right motion
- Blink: soften look-down opening gates for real blinks
- Updates: refresh staged download against GitHub latest
- UI: clamp popup position when displays change
- UI: align export icon and raise nav breakpoint to 820px

### Changed

- UI: extract shared atoms and split settings controls

## [2.5.1] - 2026-08-10

### Added

- Themed boot splash with compressed app icon

### Fixed

- Blink: tune look-down FSM gates from Phase 0 logs

### Changed

- UI: polish settings layout and popup panel chrome
- Docs: refresh README screenshots for Progress UI; clarify optional camera sidecar setup

## [2.5.0] - 2026-08-10

### Added

- Camera: L1 blink ROI gates, face continuity, and Phase 0 acceptance
- Camera: Ultra 30 FPS path and preview sync hardening
- Camera: parked L2-A face CLAHE path for landmarks
- Camera: OS camera device names in diagnostics
- About: thank-you page for early testers

### Fixed

- Camera: re-request preview video after camera restart
- Reminders: stop eye-care timers when tracking stops
- About: pin Release Notes toolbar like Progress tabs
- IPC: unblock tsc and tighten preload channel gates

### Changed

- Docs: agent stack versions (Electron 43, React 19, Vite 8)

## [2.4.1] - 2026-08-09

### Fixed

- Camera: restore MSMF open path that worked before 2.4.0

## [2.4.0] - 2026-08-09

### Added

- Background GitHub Releases update poll every 6 hours
- Telegram contact in README Connect section

### Fixed

- Reminders: apply interval changes without stopping the camera
- Camera: clear sticky eyes_closed after walk-away
- Camera: clear look-down await without requiring frontal close-band

### Changed

- CI: single automatic trigger on Release published (no duplicate tag-push run)

## [2.3.0] - 2026-08-09

### Added

- Settings Progress section with fixed tabs for stats / goals / rewards
- Share card preview with toggles
- Editable look-away popup title and hint
- Camera settings copy explaining timer mode leaves blink features inactive
- Silent update install on quit without a Restart prompt

### Fixed

- Camera: stop silent blink misses and center credit loops
- Camera: harden Windows open for legacy UVC cams
- Camera: smooth face overlay jitter in preview
- Eye-care popups: less click-steal and fewer timer clashes
- CI: Windows Python bat scripts cmd-safe; blink binary smoke test no longer hangs on readline

## [2.2.0] - 2026-08-09

### Added

- Blink levels, share card, and level-up cheer in profile/statistics
- Rewards shop: purchase counters, discount upgrades, Cheer FX, Debug shop grants
- In-app GitHub Release Notes view on the About page
- Branded Windows NSIS installer visuals
- Ephemeral updater toasts for silent checks (dialog kept for manual checks)

### Fixed

- Camera: track blinks against live open-eye EAR; stop mid-band latch ignoring post-credit blinks
- Camera: scope errors to Camera and clear when ready; app icon on preview window
- Camera: harden Windows OpenCV capture against black frames; quiet MSMF cold-start probe spam
- Popup card corners: clear html background bleed; restore frosted fill on exercise/look-away cards

### Changed

- CI: faster builds, drop duplicate landmark model download
- CI: also trigger release builds on `release: published` (not only tag push)

## [2.1.0] - 2026-08-09

### Added

- Goals, streaks, and blink rewards shop in statistics
- Reset control for goals defaults in settings
- Local prefs and stats JSON backup export/import
- In-app update UI (replaces native update dialogs)
- macOS in-app updates via GitHub Releases
- macOS fullscreen focus pause with honest unsupported UI when needed
- Diagnostics export (local logs and interaction trail) for support
- Camera preview stays live when a face is temporarily missing
- CI macOS release build and publish path

### Fixed

- Blink tracking hardened; stop closed-eye credit storms
- Defer Start reminder popup until the settings shell is ready
- Sharper text by avoiding window opacity soft-compositing
- Pointer cursor on interactive controls
- Disable text selection outside shareable content
- Main window uses the BlinkGuard icon
- Eye Lottie matte keyframes
- Release workflow tag triggers (branches+tags AND bug)
- CI Node version bumped to 22 for Vite 8 builds

### Changed

- Stop tracking the downloaded face-landmark model in git
- Quieter Windows packaging warnings

## [2.0.0] - 2026-08

BlinkGuard-era product release (rebranded and extended from the ScreenBlink lineage; see [NOTICE](NOTICE)).

### Added

- About settings page with product story, privacy summary, and GitHub link
- Windows in-app updates via GitHub Releases (`electron-updater`)
- EN/UK localization for settings and popups
- Soft-pause for quiet hours and fullscreen focus
- Independent 20-20-20 look-away timer alongside eye exercises
- Local blink session statistics and live blinks-per-minute rate
- Soft live blink-rate coaching toast (camera mode)
- Skippable first-run onboarding wizard
- Distinct notification sounds and volume control
- Debug overlays for previewing popups and testing sounds

### Changed

- Product identity: `BlinkGuard` / `com.xpogx.blinkguard` (fresh appId and user-data path)
- New brand icons (distinct from upstream ScreenBlink assets)
- Pragmatic Clean Architecture around a thin Electron composition root
- Camera path retuned on dlib blink gates (MediaPipe path removed)

### Fixed

- Preference sync bounce loops between renderer and main
- Look-away popup focus stealing
- Single-instance lock and sidecar orphan cleanup
