---
name: i18n-en-uk
description: >-
  BlinkGuard lightweight EN+UK i18n — shared catalogs, t()/pluralKey,
  locale preference, React useT/I18nProvider, vanilla popup data-i18n /
  applyI18n, locale-aware exercise/popup defaults, Ukrainian plural
  (one/few/many), and translation quality rules.
  Use when adding or editing UI copy, translating strings, changing
  locale, working on shared/i18n, src/i18n, public/js/shared/i18n.js,
  Language settings, onboarding/settings/popup localization, or
  exercise/look-away default prompts.
---

# BlinkGuard i18n (EN + UK)

No i18next. One Electron-free catalog + tiny `t()`. Locales: `"en"` | `"uk"`.

## Layout

| Path | Role |
|---|---|
| `shared/i18n/en.ts` / `uk.ts` | Flat message catalogs (same keys) |
| `shared/i18n/t.ts` | `t(locale, key, vars?)` — locale → EN → key |
| `shared/i18n/plural.ts` | `pluralSuffix` / `pluralKey` (uk one/few/many) |
| `shared/i18n/defaults.ts` | `defaultExercisePrompts` / `defaultPopupMessage` / `defaultLookAwayTitle` / `defaultLookAwayHint` |
| `shared/preferences.ts` | `locale` pref; sanitize unknown → `"en"` |
| `src/i18n/index.tsx` | `I18nProvider` / `useT` / `useI18n` |
| `public/js/shared/i18n.js` | Popup apply via `popupAPI.onApplyI18n` |
| `electron/.../window-manager.ts` | `sendI18n` on popup `did-finish-load` |

## Adding a string

1. Add the key to **both** `en.ts` and `uk.ts` (parity required).
2. React: `const t = useT();` → `{t("section.key")}` or `{t("key", { n: 5 })}`.
3. Counted nouns (seconds/minutes): `pluralKey("reminders.snoozeDesc", locale, n)` then `t(thatKey, { n })`. Provide `""`, `_few`, `_plural` variants in catalogs (EN `_few` may equal `_plural`).
4. Popup chrome: English fallback in HTML + `data-i18n="popup...."`. Include `<script src="js/shared/i18n.js">` before other popup scripts (interactive dialogs also load `popup-a11y.js` after it). Runtime JS: `window.__i18n.t(key, vars)`.
5. Built-in content defaults: keys under `defaults.*` via `defaultExercisePrompts(locale)` / `defaultPopupMessage(locale)` / `defaultLookAwayTitle(locale)` / `defaultLookAwayHint(locale)`.

Interpolation: `{name}` placeholders only.

## Locale behaviour

- Pref: `preferences.locale`; Settings → Language select; IPC `updateLocale`.
- Language switch updates React chrome **immediately**.
- Stored `exercisePrompts` / `popupMessage` / `lookAwayTitle` / `lookAwayHint` are **user content** — do **not** rewrite on locale change.
- Locale-aware built-ins only on: exercise / look-away **Reset defaults**, empty-prompt sanitize, full **Reset Preferences** (full reset restores `locale: "en"` with other defaults), and React `LanguageSettings` when the stored value still matches a built-in EN or UK default (`isBuiltIn*`).
- Next interruptive popups get `applyI18n`; already-open camera/editor need not live-retranslate.
- Look-away title/hint are delivered like exercise body text: main resolves via `resolveLookAwayTitle` / `Hint` then sends `update-look-away-copy` (not `data-i18n` on those nodes). Unit/skip stay catalog chrome; snooze button labels use `pluralKey` + `{n}` from `snoozeMinutes` — main overwrites those keys in `sendI18n` (tray uses the same).

## UK catalog (`uk.ts`) — product UI only

Agent docs and skills stay English. Product strings for locale `"uk"` live only in `shared/i18n/uk.ts` (do not put Ukrainian examples in rules/skills).

- Natural phrasing in `uk.ts`, not word-for-word EN. Prefer meters for distance keys (see paired keys in `uk.ts`).
- Plurals (CLDR): use `pluralKey` with `_few` / `_plural` suffixes — 1/21 → one form; 2–4 → few; 5–20 and 11–14 → many (seconds/minutes keys in `uk.ts` are the reference).
- Fix grammar before shipping: invalid plural agreement with interval copy (e.g. EN shape "every 1 second") — grep `reminders.` / `snooze` keys in `uk.ts`.
- Keep UI labels short where EN is short (Start/Stop, status badges — match EN brevity).
- Avoid calques: prefer natural UK phrasing over literal EN structure (compare paired EN/UK reminder and schedule keys).

## Checklist before done

- [ ] Key exists in **en** and **uk**
- [ ] After **uk.ts** edits, read ±5 lines around each change — no orphan string literals between keys (partial `StrReplace` can leave a duplicate line)
- [ ] Counted strings use `pluralKey` + three forms where n can be 1–4
- [ ] Popup HTML has `data-i18n` + `i18n.js` if user-visible
- [ ] No hard-coded EN left in the touched React/public surface
- [ ] Missing uk key must fall back to EN via `t()` (do not delete en)

## Blink overlay message pools

Camera / timer blink copy rotates from catalog pools (not a single hardcoded HTML string):

- Camera: `popup.blink.pool.0`…`N` (main picks via `pickBlinkOverlayMessage` + store-only `blinkPromptIndex`)
- Timer (no camera): `popup.blink.timerPool.0`…`N` — cues only; never claim a detected miss
- Custom non-default `popupMessage` wins and does not advance the pool index
- Ambient sr-only: `popup.ambient.message`; Gentle glow is visual-first

Camera Tuning `camera.coaching*` describes the low-BPM **ladder boost**, not a second coach card.

## Out of scope

NSIS installer language, Python sidecar logs, auto-rewriting user-edited prompts / look-away copy on language switch.
