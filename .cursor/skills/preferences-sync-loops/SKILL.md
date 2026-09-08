---
name: preferences-sync-loops
description: >-
  Prevent BlinkGuard settings preference bounce loops between React
  usePreferences sync, renderer IPC update* channels, and main
  sendPreferences echoes. Use when adding or changing preferences,
  setPreferences, use-preferences, preferences-sync, updateLocale,
  loadPreferences, dark mode, locale, toggles, onboarding prefs, or
  any IPC handler that calls windows.sendPreferences().
---

# Preferences sync loops (BlinkGuard)

This bug class bit the app **more than once**: a settings control appears to
toggle forever (theme thrash, IPC storm, UI freeze). Treat every prefs change
as a potential main↔renderer feedback loop.

## Architecture (source of truth)

| Side | Role |
|---|---|
| Main `PreferencesService` + store | Persisted truth |
| `windows.sendPreferences()` → `loadPreferences` | Main → renderer snapshot |
| React `usePreferences` | UI state; **diff-pushes** only user changes after hydrate |
| `src/features/settings/model/preferences-sync.ts` | `sameRendererPrefs` + `pushPreferenceDiff` |

Flow after hydrate:

1. User edits → `setPreferences`
2. Sync effect compares to `lastSyncedRef` → `pushPreferenceDiff` (changed keys only)
3. Main handlers persist (and **rarely** `sendPreferences`)
4. Inbound `onPreferences` merges; if equal, keep same state ref; always refresh `lastSyncedRef` so echoes do not re-push

## Hard rules

1. **Never** call every `update*` on every prefs object change. Diff only (`pushPreferenceDiff`).
2. **First hydrate must not echo-write** the whole store back to main.
3. **`sendPreferences()` is a bounce vector.** From an IPC handler invoked by the settings sync, call it only when:
   - the value actually changed, and
   - another surface truly needs the snapshot (tray locale, reset, editor geometry, calibration complete, tracking via shortcut).
4. **No-op equal writes** in `PreferencesService.set` (already required).
5. **Do not rewrite** `popupMessage` / `exercisePrompts` / `lookAwayTitle` / `lookAwayHint` inside `updateLocale`. React `LanguageSettings` owns built-in content on language change (see i18n skill).
6. Prefer **one writer** per field: either sync-diff **or** direct `rendererIpc.updateX` in the control — not both unless the direct call is intentional and main no-ops equals.
7. When adding a persisted pref:
   - add to `sameRendererPrefs`
   - add to `pushPreferenceDiff` (unless intentionally main-only / direct IPC)
   - add a regression test that toggling it does **not** call `updateLocale` / unrelated channels
   - if the handler calls `sendPreferences`, add an unchanged early-return

## Checklist (new or changed interactive control)

- [ ] Control updates via `setPreferences` (or documented direct IPC)
- [ ] Field covered by `sameRendererPrefs` + `pushPreferenceDiff` when synced
- [ ] Handler does not `sendPreferences()` on no-op / unchanged value
- [ ] Test: change control → only its IPC channel(s); echo `loadPreferences` → no further sends
- [ ] No `useEffect` that writes prefs ↔ depends on the same prefs without a ref/equality gate

## Known bounce sites (`sendPreferences`)

Full inventory: [`references/bounce-sites.md`](references/bounce-sites.md). Skim that file when touching prefs IPC that might call `windows.sendPreferences()`.

`keyboardShortcuts` is a map: compare with `sameKeyboardShortcuts` in `sameRendererPrefs` / `pushPreferenceDiff` → single `updateKeyboardShortcuts` channel. Handler must no-op when the sanitized map is unchanged before `registerAll`.

`microBreakInterval` and `blinkPromptProfile` are compared in `sameRendererPrefs` and pushed via `updateMicroBreakInterval` / `updateBlinkPromptProfile` (seconds for the interval at the renderer boundary). Do not fold them into `updateInterval` (camera miss-gap only).

Named setups (`settings-profiles`): switch/save/rename/delete/list are **invoke-only**. Do not add setup metadata to `sameRendererPrefs` / `pushPreferenceDiff` / `PERSISTED_KEYS`. Persist lives in third store `blinkguard-settings-profiles`. Optional `settingsProfiles` may appear in **backup v1** when exporting preferences/both — that is import/export only, not a prefs bounce path.
## Anti-patterns

```ts
// BAD — full sync on every preferences identity change
useEffect(() => {
  rendererIpc.updateAppearance(preferences.appearance);
  rendererIpc.updateLocale(preferences.locale); // often sendPreferences!
  // …every other field…
}, [preferences]);

// BAD — main always echoes
ipcMain.on(updateLocale, (_, locale) => {
  preferences.set("locale", locale);
  windows.sendPreferences(); // even when unchanged
});

// BAD — inbound always setState new object
onPreferences((saved) => setPreferences((c) => ({ ...c, ...saved })));
```

```ts
// GOOD — diff + equality + hydrate seed (see use-preferences.ts)
if (!previous) { lastSyncedRef.current = preferences; return; }
if (sameRendererPrefs(previous, preferences)) return;
pushPreferenceDiff(previous, preferences);
```

## Tests to extend

- `src/__tests__/shared/preferences-sync.test.ts` — diff / equality
- `src/__tests__/pages/app.test.tsx` — interactive toggles + echo ignore
- `src/__tests__/electron/preferences-service.test.ts` — `set()` no-op

## Symptom → cause

| Symptom | Likely cause |
|---|---|
| Theme / toggle flips forever | Sync effect + `sendPreferences` + setState new object |
| IPC flood of `update-*` | Full push instead of diff; missing hydrate seed |
| Locale channel on unrelated toggle | `updateLocale` inside all-fields sync |
| Loop only after language work | `updateLocale` rewriting prompts + echo |
