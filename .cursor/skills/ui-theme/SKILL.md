---
name: ui-theme
description: >-
  BlinkGuard UI theme tokens — shared/theme.ts is the source for colors,
  fonts, radii, type scale, and spacing. Settings use semantic Tailwind
  (bg-primary, text-sm); popups use --popup-* CSS vars. Use when changing
  UI, CSS, className, Tailwind, popup styles, color, spacing, font, theme,
  chips/badges, canvas/share-card colors, or preference popup defaults.
---

# UI theme tokens

One frozen object in `shared/theme.ts`. Two CSS exits. Do not mix React settings with vanilla popups.

```
theme.ts → src/index.css :root/.dark → Tailwind bg-primary / p-4 → React
theme.ts → public/css/base.css --popup-* → vanilla popups
theme.ts → canvas / style={} / DEFAULT_PREFERENCES.popupColors
```

Runtime stays CSS variables (first paint of splash/popup has no JS). User `popupColors.background/text/transparency` still override via `public/js/shared/theme.js`. Accent and radius are not Appearance overrides.

## Before changing styles

1. Read `shared/theme.ts`.
2. Settings: only semantic Tailwind from `@theme` (`bg-background`, `text-primary`, `border-border`, `p-4`, `gap-2`, `rounded-md`, `text-sm`, `font-sans`). A new color or type size starts as a key in `theme`, then a CSS var / `@theme` mapping.
3. Popups: only `var(--popup-*)`. A new key goes in `theme.popup` **and** the `/* theme:start */` block in `public/css/base.css`.
4. Canvas / `style={}` / preference defaults: import `theme` / `hsl` / `cssColor`.
5. Forbidden: `teal-*` / `amber-*` / other Tailwind palettes, hex in feature CSS/JSX, `text-[11px]`, duplicating a chip instead of `Badge`.
6. Do not mix the dual UI stacks.

Layout-arbitrary classes (`min-w-[8rem]`, `max-h-[min(92vh,900px)]`, `min-[820px]:`) are geometry, not theme — leave them.

## Helpers

- `hsl(c, alpha?)` — canvas and computed colors from HSL tokens
- `cssColor("primary")` → `hsl(var(--primary))` for `style={}`
- `theme.recipe.chip` / `theme.recipe.warningSurface` — repeated class strings; chips go through `Badge`

## Sync

Edit numbers **only** in `theme.ts`, then match the marker blocks in `src/index.css` and `public/css/base.css`. `src/index.css` has `@source "../shared/theme.ts"` so `theme.recipe` class strings are scanned. Splash inline HSL in `index.html` must keep the same `--background` channels (first paint; no JS). Vitest: `src/__tests__/shared/theme-css-sync.test.ts`.

## Exceptions

- Video letterbox is `var(--popup-letterbox)` (`#000`) — functional black frame, not brand.
- `theme.js` writes only user bg/text/transparency.
- Ambient Gentle glow (`public/css/ambient.css`) reuses existing `--popup-accent` / `--popup-warning` with `color-mix` — **no** new `theme.popup` keys for the wash.
