# next-product-gaps — fence examples

Read before writing Step 5 fences. Full briefs from past runs live in chat history; these show shape and common mistakes.

## Good (truncated) — historical shape (feature shipped)

> The hush fence below is a **shape example** from a past gaps run. Meeting-length /
> sticky hush from the tray has **shipped** — do not re-brief it; see `shipped-drop.md`.

Real paths, pause≠stop, named tests, cycle-safe owners:

```text
BlinkGuard ~2.18.0 | Meeting-length and sticky hush from the tray

Goal: Let a tray-only Windows user silence all blink / look-away / exercise prompts
for a meeting or lunch (15 / 30 / 60 minutes, or until End hush) without stopping
tracking or changing quiet hours.

Product context
- Electron desktop app (React settings, vanilla popups, optional Python sidecar).
  Tray: Start/Stop, Hush, Snooze, Setups (`electron/infrastructure/tray/tray-menu-model.ts`).
- `snoozeAllPrompts` (`electron/application/snooze-all.ts`) accepts `{ durationMs }`;
  shortcut `snoozeAll` only uses `preferences.snoozeMinutes` (1–30). No 15/60 or
  until-resume from tray. `eyeCareIndependentOfTracking` default true — Stop does not
  pause eye-care; 5-minute hush is too short for Zoom.

Do not
- Stop tracking, release camera, or flip `eyeCareIndependentOfTracking`.
- Persist hush across quit; replace per-kind Snooze or default Hush shortcut.

Seams to plan
- `electron/application/snooze-all.ts`: sticky path without `schedulePromptHushExpiry`.
- `shared/ipc-channels.ts` + handlers: extend `SnoozeAllPayload` with sanitized duration.
- `tray-menu-model.ts` + `tray-controller.ts`: 15/30/60 + Until I resume submenu.
- Pure remaining-time helper + i18n `shared/i18n/en.ts` / `uk.ts` (`tray.hush*`).
- Tests: `src/__tests__/electron/snooze-all.test.ts`, `tray-menu-model.test.ts`.

Acceptance
- Tray offers 5m (pref), 15m, 30m, 60m, Until I resume; tracking and camera unchanged.
- During hush, overlays and native toasts suppressed; End hush resumes immediately.
- Timed hush shows remaining minutes; quit clears hush. EN+UK strings; `npm test` green.
```

## Bad — same daily pain in one batch

Do **not** ship both of these in the same trio — they both silence Zoom/meetings:

- Meeting-length and sticky hush from the tray
- Pause this app from the tray

Keep the stronger one; defer the other to a later gaps run.

## Bad — cycle-unsafe owner

```text
Seams to plan
- Pure helper next to `dayMeetsDailyGoals` in `shared/blink-stats.ts` for achievements.
```

`shared/achievements.ts` must not import `shared/blink-stats.ts`. Name the owner:

```text
Seams to plan
- `goalsConfigForCamera` (or equivalent) in `shared/preferences.ts`; use from
  `blink-stats.ts`, `achievements.ts`, and `formatTraySessionGlance`.
```

## Bad — laundry-list seams (no files read)

```text
Seams to plan
- shared/ prefs, sanitizers, backup, i18n EN/UK
- electron/application services + IPC
- infrastructure (tray, windows, sidecar) if needed
- src/features UI
- tests to add
```

Replace with paths you actually Read, e.g. `electron/application/focus-pause-service.ts`,
`shared/preferences.ts` (`sanitizePauseAppRules`), `src/__tests__/electron/tray-menu-model.test.ts`.
