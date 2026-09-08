---
name: keep-agent-docs-current
description: >-
  Keeps BlinkGuard Cursor agent docs accurate after code changes — skim and
  patch .cursor/rules, .cursor/skills, harness indexes, and the AGENTS.md
  router when paths, prefs, IPC,
  features, or protocols drift. Use after meaningful feature/IPC/prefs/domain/UI/
  sidecar edits, when docs disagree with the repo, or when the user asks to
  update skills/rules.
---

# Keep agent docs current

After a **meaningful** code change, agent docs must match the repo. Do not leave stale paths, prefs keys, MediaPipe/backend notes, feature lists, or ownership maps.

**Language:** Rules, skills, plans, harness indexes, and `AGENTS.md` are **English only** — Ukrainian belongs only in `shared/i18n/uk.ts` (product UI), not in agent guidance or inline examples in skills. **Chat:** default to English; use Ukrainian only when the user writes in Ukrainian (match their language, do not switch unprompted).

Git-tracked `AGENTS.md` is a **short harness router**, not an encyclopedia. After a meaningful change, refresh **touched indexes** under `docs/harness/indexes/` plus file-scoped rules/skills. Do **not** grow `AGENTS.md` with Cloud VM or sidecar essays.

## When to run

Trigger this after (or as the closing step of) work that touches any of:

- New or renamed preference / sanitizer
- New or renamed IPC channel / preload whitelist / `popupAPI` method
- BrowserWindow `webPreferences` / preload bridge / IPC handler validation (skim `electron-security`)
- New domain policy or application service
- New `src/features/*` folder or settings nav section
- New `public/*.html` popup (or dedicated `public/js`)
- Sidecar NDJSON protocol / handshake / rebuild rules
- Product rename or removed feature (e.g. MediaPipe)

Skip for typo-only, comment-only, or pure test-fixture tweaks that do not change contracts.

## Workflow

0. **Run the checker** from repo root, then patch only reported gaps:

   ```bash
   node .cursor/skills/keep-agent-docs-current/scripts/check-docs.mjs
   ```

   **Gate:** Do not mark agent-docs / Phase 5 docs todos complete until `check-docs.mjs` exits 0 (or each gap is explicitly deferred in the todo with reason).

1. Identify which docs could be wrong: `.cursor/rules/*.mdc`, `.cursor/skills/*/SKILL.md`, `docs/harness/indexes/`, `AGENTS.md` (router only).
2. **Tracked agent docs:** The `AGENTS.md` router, `docs/harness/`, and `.cursor/` (rules, skills, agents, commands, hooks) are committed. Patch **touched indexes** and the matching rule/skill in the same change. Keep the router short. `.cursor/plans/` stays gitignored. On `/ship`, those tracked docs ship via git.
3. Skim only the relevant files (module map, prefs keys, dual-UI list, camera/sidecar, sync-loops, testing). Patch **only** facts that are false or that would misplace the next change (paths, ownership, defaults, removed APIs).
4. Prefer updating an existing rule/skill over adding a new one. Prefer file-scoped rules (`tray-runtime`, `composition-root`, `camera-detection`) and the matching harness index over stuffing always-on overview / `AGENTS.md`.
5. Add a **new skill** only for a fragile multi-step workflow (protocol, anti-loop, dual-surface i18n). Otherwise keep rules short.
6. Do not paste large code dumps into docs; link to source of truth files instead.
7. Do not invent layers or APIs in docs that do not exist in code.

## Checklist

- [ ] Ran `scripts/check-docs.mjs` (exit 0) and addressed its gaps (or noted intentional deferrals)
- [ ] English-only scan: no Cyrillic in `.cursor/{rules,skills,agents,commands,hooks}`, `docs/harness/`, or `AGENTS.md` (locale `"uk"` / path `uk.ts` OK)
- [ ] `project-overview` / `clean-architecture` maps still mention application stems + tray (overview stays slim — detail in file-scoped rules). Do not restuff those maps into `AGENTS.md`.
- [ ] `preferences-store` has each `PersistedPreferences` field as a backtick (compact list OK — SoT remains `shared/preferences.ts`)
- [ ] `testing.mdc` states the four Vitest folders + Python unittest placement (not an exhaustive basename laundry)
- [ ] `dual-ui` lists real `public/*.html` (except intentional retired `blink-rate-coach.html`) + feature folders
- [ ] Camera / sidecar docs stay dlib-only unless code reintroduces a backend switch
- [ ] `camera-detection` **globs** updated when a new camera contract file lands
- [ ] No phantom paths (`kofi.ts`, retired HTML such as `blink-rate-coach.html`)
- [ ] New bounce-prone prefs IPC noted in `preferences-sync-loops` / `references/bounce-sites.md` if `sendPreferences` is involved
- [ ] Changed `DEFAULT_*` or default values in `shared/preferences.ts`: grep `src/__tests__` and `DEFAULT_RENDERER_PREFERENCES` for hardcoded old defaults before verify
- [ ] New manual pause/hush runtime flags (`promptSuppressUntil`, tray pause reason): clear in `AppRuntimeState` reset paths **and** refresh UI via `focusPause.pushState()` when cleared outside the hush helper — see `tray-runtime`
- [ ] `electron/main.ts` / tray wiring: `trayRef` / hush orchestrators before controllers — see `composition-root`; run `npm run build:electron` after tray-menu-model or main composition edits
- [ ] BrowserWindow / preload / IPC handler changes reflected in `electron-security` when those surfaces drift
- [ ] **`python/blink_detector_package/**` edits:** before marking implement/verify complete, rebuild sidecar via skill `blink-detector-sidecar` **Rebuild intake** (venv `Scripts\python.exe` on Windows — **never** `setup.bat` on routine rebuild) and run `python/log_tools/check_exe_mtime.py` with `status=OK`; tell user to restart app/sidecar
- [ ] New user-facing copy covered by `i18n-en-uk` checklist when EN/UK strings changed
- [ ] New/renamed/moved React or popup UI reflected in `ui-reuse/catalog.json` — run `check-catalog.mjs` when UI paths changed
- [ ] Project agents / hooks / commands / skill `references/` still match this index (when those files exist under `.cursor/`)
- [ ] Touched harness indexes still accurate (`tooling.md` for Cloud/verify/`/deploy`, `sidecar.md` for detector). Do not grow `AGENTS.md` with Cloud or sidecar essays.
- [ ] After a `/next-product-gaps` brief **ships** on `development`, append one line to `.cursor/skills/next-product-gaps/shipped-drop.md`
- [ ] README screenshot helpers stay in `scripts/screenshot_tools/` (not under `docs/screenshots/`) when that workflow changes; intro MP4 generator stays in `scripts/intro_video/` with outputs in `docs/intro/`

## Anti-patterns

- Updating docs without verifying against the file that owns the contract
- Expanding every rule into a full feature tutorial / second SoT for prefs keys
- Leaving ScreenBlink / `useMediaPipe` / old shell names after renames
- Committing regenerated `coverage/` or leaving `.cursor/` rules/skills uncommitted so another machine diverges
- Stuffing tray/hush essays into always-on overview / `AGENTS.md` (use `tray-runtime` + `docs/harness/indexes/tray.md`)
- Growing `AGENTS.md` with Cloud VM or sidecar protocol dumps (use `indexes/tooling.md` / `indexes/sidecar.md` and the owning skill/rule)
