# Index: Styles

- **What:** Color/type tokens, themes, global CSS, design-system primitives.
- **Where:** `shared/theme.ts` (source of truth), React/Tailwind in `src/` (`html.dark` from pref `appearance` + `prefers-color-scheme` after hydrate; boot splash pins `?dark=` from main, matchMedia only when `?dark=` is absent), vanilla popup CSS in `public/css`. Overlay cards use `popupColors`, not OS chrome.
- **When to open:** Changing visual tokens, themes, or shared styling. Skill `ui-theme`.
