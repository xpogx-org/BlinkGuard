---
name: next-product-gaps
description: >-
  Finds the next N BlinkGuard product gaps (default 3) and writes paste-ready
  English planning briefs. Runs gather-shipped.mjs and shipped-drop.md so
  shipped work is not re-briefed. Use when the user says next 3, next three,
  gaps, improvements, new features, make the app better, what to build next,
  /next-product-gaps, or asks for agent-ready feature briefs. Do not implement
  or write specs in the gaps chat.
---

# Next product gaps (N briefs)

Ship **N** standalone English briefs the user can paste into a **planning** agent. Default **N = 3**. Do **not** implement, CreatePlan, SwitchMode, write `specs/` files, or spawn implementers in this chat.

**Language:** Chat and recap match the **user's language**. Brief bodies are **English only**.

Rename this chat to `Next product gaps` via `cursor-app-control` `rename_chat`.

## Progress checklist

Copy and tick before sending:

```text
Gaps progress:
- [ ] 0. Parse N + optional theme; rename chat
- [ ] 1. Run gather-shipped.mjs; Read shipped-drop.md
- [ ] 2. Drop shipped / in-progress / same-pain duplicates
- [ ] 3. Probe seams on ~5 candidates (Read real files)
- [ ] 4. Select N (one pain; Windows daily-use)
- [ ] 5. Write N fences from the template
- [ ] 6. Self-check, then recap
```

## Step 0 — Parse request

| User says | N | Theme |
|---|---|---|
| `/next-product-gaps` or `next 3` | 3 | open |
| `next 5`, `next 1`, etc. | that number | open |
| `next 1 Weak blink store` | 1 | stay on that hole |

If the user named a **theme** and it is already shipped (drop list, git, or code), say it shipped and **stop** — do not invent a substitute brief.

## Step 1 — Gather shipped work

**Run** from repo root (no hand-chained `git log && …` on PowerShell 5.1):

```bash
node .cursor/skills/next-product-gaps/scripts/gather-shipped.mjs
```

If the script is missing, one Shell call per command: `git log --oneline -40`, then branch, then `CHANGELOG.md` head.

Then **Read** [shipped-drop.md](shipped-drop.md).

**SearchConversations** (two queries, 1–2 keywords each): `next-product-gaps`, then `product gaps`. Do **not** search `BlinkGuard ~`. History titles are hints — Grep each in git/code before dropping or repeating.

**Drop-list drift:** if HEAD or `development` already contains a feature missing from `shipped-drop.md`, append one line in this step. `keep-agent-docs-current` still appends after a later ship on `development`.

Daily work lands on `development`; `CHANGELOG` Unreleased is often empty until `/deploy`. Do not treat `main` alone as source of truth.

## Step 2 — Drop

Drop anything already in HEAD, `development`, `main`, `CHANGELOG.md`, `shipped-drop.md`, or the current uncommitted diff. Empty Unreleased does **not** mean nothing shipped.

## Step 3 — Probe (~5 candidates)

Before picking the final N, **Read** real files for each candidate. Confirm the user **cannot already do it**.

Touch only when the idea needs them:

- Dual-UI (`src/features` vs `public/`)
- `shared/ipc-channels.ts` + preload whitelist
- Backup/sanitize (`shared/backup.ts`, `PERSISTED_KEYS`)
- i18n EN+UK (`shared/i18n/en.ts`, `uk.ts`)
- `preferences-sync-loops` when `sendPreferences` echoes

**Owner rule:** Grep importers; name the file that can hold a helper **without a cycle**. Example: `shared/achievements.ts` must not import `shared/blink-stats.ts`; helpers both need (`goalsConfigForCamera`) live in `shared/preferences.ts`. Never write “put the helper next to `dayMeetsDailyGoals`”.

## Step 4 — Select N

Windows-first, user-visible, one planning session each.

- **One user-pain per batch** — if two ideas both silence Zoom (timed hush vs pause-this-app), keep only the stronger.
- Prefer **different loops** (tray vs stats vs camera vs pause) when impact is close.
- Prefer timer-only-safe ideas unless the gap is camera-specific.
- Rank by user-visible impact, not DX/docs/Linux/signing unless those are the pain.

See [shipped-drop.md](shipped-drop.md) for the shipped catalog — do not duplicate that list here.

## Step 5 — Write fences

Read [examples.md](examples.md) before writing. One idea per fenced `text` block. No commentary inside the fence. Short recap **after** all fences (same language as the user; titles only — do not duplicate brief bodies).

### Template

Each fence must stand alone (the planning agent will not see this chat).

```text
BlinkGuard ~<version from package.json> | <short title>

Goal: <one sentence, user-visible outcome — not "add a service">

Product context
- One clause: Electron main + React settings + vanilla popups + optional Python sidecar.
- What exists today for this area only (files, prefs, services, UI you Read).
- Why the current path is painful.

Do not
- Concrete non-goals and regressions (click-to-show tray, second stats store, auto-apply Setups, pause≠stop, …).

Seams to plan
- Only concrete paths you Read — omit rows you did not need.
- Name the owning file for each new helper (cycle-safe).
- Tests to add (pure helpers; no real Electron Tray/windows).

Acceptance
- 3–5 observable checks a later implementer can tick.
```

## Step 6 — Self-check

Before sending:

- [ ] Every cited path exists in the repo
- [ ] No title appears on `shipped-drop.md` or in recent git
- [ ] Pairwise: no two briefs solve the **same daily pain**
- [ ] Count matches N; themed request stayed on theme
- [ ] Goal is user-visible; Do not lists concrete regressions
- [ ] Acceptance has 3–5 observable ticks
- [ ] No “consider also”; no ASCII mockups; ~50–90 lines per fence
- [ ] Stats/achievements shared helpers name `shared/preferences.ts`, not `blink-stats.ts`
- [ ] pause vs stop, independent eye-care, backup/sanitize, i18n spelled when they apply

## What to propose

Prefer:

- A missing daily control (tray, pause, snooze, setups)
- A hole in an existing loop (stats, compliance, camera status, quiet hours)
- A small new surface that reuses current services

Avoid (unless the user asked):

- Linux packaging / unsigned SmartScreen / README version drift
- Classifier CLI retrain, multi-user, water/posture
- Two briefs for the **same daily pain**
- Vague refactors, extra architecture layers, new frameworks
- Keyboard-idle / AFK “activity checker” freeze (T-002 rejected 2026-09-09 — see `docs/harness/decisions.md`)
