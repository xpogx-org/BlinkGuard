# Index: Logic

- **What:** Domain rules, application orchestration, composition root. Thin `electron/main.ts` — extend existing services/adapters; do not invent extra layers.
- **Where:** `electron/domain/`, `electron/application/`, `electron/main.ts`.
- **When to open:** Changing behavior, policies, or data flow that is not layout. Rules `clean-architecture` and `composition-root`. Module map: rule `project-overview`. Pref `appearance` is sanitized in `shared/preferences.ts`; `nativeTheme.themeSource` is wired in `main.ts`.
