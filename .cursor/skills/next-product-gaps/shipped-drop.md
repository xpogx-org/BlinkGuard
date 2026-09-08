# Already shipped — never re-brief

Living drop list for `/next-product-gaps`. After a gaps brief **ships** (commit on `development`), append one line here (`keep-agent-docs-current`).

Verify each line in `git log` / code before treating it as gospel. If the feature is gone, delete the line.

## Maintain

- **After ship** on `development`: append one line (via `keep-agent-docs-current`).
- **During a gaps gather**: if git already has the feature but this list does not, append now.
- **If removed**: delete the line when the feature is gone from code.
- Do **not** add a “still open” backlog here — that biases every run toward one idea.

## Tray / pause / hush

- Tray Start/Stop, grouped menu, idle vs tracking icon
- Themed tray popup (`tray-menu-window.ts` / `public/tray-menu.*`) — not Electron `Menu`
- Tray Setups switch (radio; no Save/Rename/Delete)
- Tray Hush / End hush + shortcut `snoozeAll`
- Tray token extended hush (2× `snoozeMinutes`)
- Tray meeting-length hush: 15/30/60 + until-resume (`shared/hush-durations.ts`, IPC `untilResume`)
- Tray glance: live BPM + today/goal (`shared/tray-session-glance.ts`)
- Tray look-away now (`LookAwayService.promptNow`, no new IPC)
- Capture-status tray chip (`CameraCaptureStatusService`)
- Session-idle pause reasons: lock / display-off / lid / suspend
- Weekday quiet hours (`quietHoursByWeekday`)
- Quiet hours freeze tracking minutes + camera soft-pause (not Stop/recap; fullscreen/app-rule still do not freeze the clock)
- Per-app foreground blocklist in Settings → Pause (`pauseAppRules`; picker + tray one-click **Pause for {app}** from `lastExternalForeground`, process-only)
- Fullscreen pause (`pauseOnFullscreen`)

## Reminders / camera / overlays

- Reminder ladder + Gentle/Standard/Strong (`blinkPromptProfile`)
- Separate camera miss-gap vs timer `microBreakInterval`
- Native OS toasts (`notificationStyle` overlay / native / both)
- Per-display popup position/size maps
- Camera device picker (`cameraDevice`)
- EAR calibration nudge (no auto-start)
- Sidecar `faceStatus` + `head_too_low` / landmark trust
- Session recap overlay + native lock/quit

## Progress / data / support

- Named Setups (cap 5) + include in backup v1
- Spend snooze tokens from tray / shortcut / toast
- Eye-care completed/skipped/snoozed on statistics
- Timer-first goals: `goalsConfigForCamera` in `shared/preferences.ts` (achievements must not import `blink-stats.ts`)
- Timer-mode offline shop points (`creditOfflineFromTrackingMs`, 1 per 10s; spend offline-first)
- Report a problem + GitHub issue templates + diagnostics `meta.json`
- Settings / boot splash / tray follow Windows via pref `appearance` (`system` | `light` | `dark`); overlays stay on `popupColors`

## Do not re-open as DX

- Linux packaging, unsigned SmartScreen, README version drift
- Classifier CLI retrain, multi-user, water/posture
