<!-- harness-stock: true -->
# Index: UI

- **What:** User-visible screens, components, popups, copy. Dual UI: React settings vs vanilla `public/` popups — do not mix stacks.
- **Where:** `src/app.tsx`, `src/features/*`, `src/components/`, `public/*.html` (+ `public/js` / `public/css`).
- **When to open:** Changing layout, components, navigation, popups, or user-facing strings. Skills `ui-reuse` (`catalog.json`) and `i18n-en-uk`; rule `dual-ui`. Settings nav order lives in rule `project-overview`.
