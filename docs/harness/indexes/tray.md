# Index: Tray

- **What:** Tray menu, hush, pause, and related runtime flags. Do not stuff hush essays into `AGENTS.md` or `project-overview`.
- **Where:** `electron/infrastructure/tray/`.
- **When to open:** Changing tray menu, hush, snooze, or pause reasons. Rule `tray-runtime`. Tray popup chrome uses `buildTrayMenuTheme(nativeTheme.shouldUseDarkColors)` after `themeSource` matches `appearance`; overlay `popupColors` are not retargeted.
