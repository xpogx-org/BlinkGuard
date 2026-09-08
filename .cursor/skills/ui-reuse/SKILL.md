---
name: ui-reuse
description: >-
  BlinkGuard UI reuse catalog — atomic roles (atom/molecule/organism/pattern),
  shared React components in src/components, feature organisms, vanilla popup
  CSS/JS primitives. Use before creating or changing any settings UI, React
  component, button, slider, toggle, banner, panel, tabs, popup HTML/CSS, or
  visual chrome. Mandatory: read catalog.json first; prefer existing entries
  over new markup; one file one component; keep React and popups dual-UI split.
---

# UI reuse (catalog-first)

Before **creating or changing** any visual UI (React settings or vanilla popups), read [catalog.json](catalog.json) in this folder. Do not invent parallel buttons, sliders, cards, banners, or tab bars.

## Mandatory workflow

0. **Run the catalog checker** from repo root (before inventing UI or after add/rename/move), then fix only reported gaps:

   ```bash
   node .cursor/skills/ui-reuse/scripts/check-catalog.mjs
   ```

1. **Read** `catalog.json` (filter by `surface`, then `role` / `when`).
2. **Reuse** an existing entry — copy its `import` path; do not paste markup from another feature.
3. If nothing fits:
   - Shared reusable piece → new file under `src/components/` (React) or documented `pattern` under `public/css` / `public/js/shared` (popups).
   - Feature-only screen/block → `src/features/<feature>/ui/<kebab-name>.tsx`.
4. **One file = one exported UI component** (no multi-export grab-bags).
5. **Update** `catalog.json` with the new/changed entry (`role` required; fill `when` / `avoid` / `props` / `composedOf`).
6. Dual UI: never import React components into `public/` or build popup UIs in React settings.

## Roles

| role | Meaning | Home |
|---|---|---|
| `atom` | Primitive control | `src/components/` |
| `molecule` | Small composed block | `src/components/` or small feature widget |
| `organism` | Feature panel / dialog / wizard | `src/features/*/ui/` |
| `pattern` | Vanilla CSS/JS primitive (not a React component) | `public/css`, `public/js/shared` |

## Surfaces

- `react-settings` — Tailwind + `src/components` + `src/features/*/ui`
- `vanilla-popups` — `public/*.html` + `public/css` + `public/js` via `popupAPI`

Tokens live in `shared/theme.ts` (skill `ui-theme`). Settings: semantic Tailwind from `src/index.css`. Popups: `var(--popup-*)` in `public/css/base.css`. Do not mix stacks.

## Prefer these before inventing

| Need | Use |
|---|---|
| Button | `Button` |
| Pref toggle | `ToggleSwitch` in `SettingRow` `action` |
| Dropdown | `Select` |
| Range / volume / interval | `RangeSlider` |
| Settings card / row / grid | `SettingPanel` / `SettingRow` / `SettingGrid` |
| Section tabs | `SectionTabs` (wrap with `TabbedSection` for sticky chrome + keyed scroller) |
| Error / warning banner shell | `StatusBanner` |
| Compact chip / count / flair | `Badge` |
| Stat tile | `SummaryStat` |
| Frosted popup panel | `.popup-glass` + theme.js |

## Anti-patterns

- Copy-pasting gradient `<input type="range">` or private `SummaryStat` into a second feature
- Duplicating chip markup instead of `Badge`
- Palette Tailwind (`teal-*`, `amber-*`) or hex in feature CSS/JSX — skill `ui-theme`
- Adding a second settings shell or nav section after Debug
- Mixing React and popup stacks
- Leaving `catalog.json` stale after add/rename/move
- TS barrel `src/components/index.ts` — catalog is the index; keep direct `@/` imports

## After UI changes

Run skill `keep-agent-docs-current` if paths/nav/features drifted; always keep this catalog accurate for the next agent.
