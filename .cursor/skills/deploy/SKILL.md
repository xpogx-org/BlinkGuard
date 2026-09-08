---
name: deploy
description: >-
  BlinkGuard GitHub Release ship: decide patch vs minor vs major per SemVer 2.0.0
  from commits since the latest tag, merge development into main, bump version,
  changelog/README, tag, publish the GitHub Release (CI on release:published),
  sync development, and draft a short Ko-fi post. Use when the user says /deploy,
  Ship, or asks to release/hotfix/publish a BlinkGuard build. Do not use for local
  npm run build:windows only.
disable-model-invocation: true
---

# BlinkGuard deploy (`/deploy`)

Ship a **published GitHub Release** for `xpogx-org/BlinkGuard`. CI packages Win+mac when the release is published — do not also push-tag-trigger (workflow listens only to `release: published` + `workflow_dispatch`).

Triggers: `/deploy`, `Ship`, `Release`, `Hotfix` (hotfix = force patch). Overrides: `Ship patch` / `Ship minor` / `Ship major`.

Spec: [Semantic Versioning 2.0.0](https://semver.org/) (`MAJOR.MINOR.PATCH`). Git tags use a `v` prefix (`v2.18.0`); `package.json` and release titles use bare `X.Y.Z`.

## Branch model

| Branch | Role |
|---|---|
| **`development`** | Default integration branch — all product commits land here |
| **`main`** | Release branch — updated **only** by this deploy skill |

**Do not** commit day-to-day work directly to `main`. PRs and local commits target `development`.

## Decide version

1. `git fetch origin --tags`; `git log vLAST..origin/development --oneline` (latest `v*` tag; use `development` as the ship candidate).
2. Working tree should be clean except files you are about to bump. If unrelated dirty files, stop.
3. Classify **user-facing** commits since `vLAST` (ignore the upcoming `chore(release)`). When several kinds land together, take the **highest** bump (patch < minor < major).

### SemVer rules (BlinkGuard)

BlinkGuard is past `1.0.0`. Treat **public API** as anything users or their data depend on: settings/prefs shape, backup/import envelope, IPC/preload contracts, popup behavior, sidecar protocol fields, auto-update expectations — not internal refactors.

| Change | Bump | Examples |
|---|---|---|
| Backward-compatible bug fix | **PATCH** `x.y.Z` | `fix(...)`, crash/regression, camera false positive/negative, updater consent |
| Backward-compatible new/changed behavior | **MINOR** `x.Y.0` | `feat(...)`, new pref/IPC, UI surface, reward/achievement, deprecation notice |
| Backward-incompatible change | **MAJOR** `X.0.0` | `BREAKING CHANGE` / `type!:`; backup v2 without import path; prefs rename without migration; `appId` / userData path change — **ask first** |

**Reset on increment** ([semver.org](https://semver.org/#specify-version-number-increments)):

- PATCH: `2.17.0` → `2.17.1`
- MINOR: `2.17.1` → `2.18.0` (patch resets to `0`)
- MAJOR: `2.18.3` → `3.0.0` (minor and patch reset to `0`)

**Conventional Commits → bump** (when message is ambiguous, read the diff + `CHANGELOG.md` Unreleased):

| Signal | Bump |
|---|---|
| `fix:` / Fixed / regression / hotfix | patch |
| `feat:` / Added / user-visible enhancement | minor |
| `BREAKING CHANGE:` / `type!:` / removed without migration | major |
| Deprecation only (still works) | minor |
| `docs:` / `chore:` / `ci:` / `test:` / refactor with no user impact | none |

**Stop — do not ship**:

| Condition | Action |
|---|---|
| No commits since `vLAST` | **Stop** — no empty release |
| Only docs/chore/ci with no product change | **Stop** unless user forced |
| Major needed but user did not confirm | **Stop** — ask |

`Hotfix` in the user message → **patch** even if a small feat snuck in, unless they also said minor/major.

Do **not** change `appId` `com.xpogx.blinkguard` (wipes userData).

**Not used for routine ships:** pre-release (`-alpha`, `-beta`) or build metadata (`+build`). Normal releases are plain `X.Y.Z` only.

**Immutability:** after CI has attached installers (or users may have the release URL), never rewrite that tag or GitHub Release body — ship a new version instead ([semver.org FAQ](https://semver.org/#what-do-i-do-if-i-accidentally-release-a-backward-incompatible-change-as-a-minor-version)). Same-session tag move is allowed **only** under Git+GitHub step 6 when `ls-remote` does not match the bump commit.

## Files

- `package.json` + lock: `npm version X.Y.Z --no-git-tag-version`
- `CHANGELOG.md` Keep a Changelog: move Unreleased into `## [X.Y.Z] - YYYY-MM-DD` (today)
- `README.md` Features only if user-visible behavior changed
- GitHub Release body: Added/Fixed/Changed + Notes + Full Changelog. **No Downloads / artifact list** (Assets already show files)

Repo URLs: `https://github.com/xpogx-org/BlinkGuard` (not `xPOGx/BlinkGuard`).

## Git + GitHub

PowerShell: no `&&`, no bash `cat <<EOF`. Write notes to a UTF-8 **no BOM** temp file (`release-notes.tmp.md` — not tracked `release-notes.md`).

**Pre-flight:** `development` must be pushed (`gh auth switch --user xPOGx`; `git -c credential.helper='!gh auth git-credential' push origin development`).

```
chore(release): Bump version to X.Y.Z
```

Then (strict order — **never** parallelize steps 4–6):

1. `git checkout main`
2. `git merge origin/development --ff-only` (stop if not fast-forward — reconcile on `development` first)
3. Bump version/changelog/README on `main`; stage **only** those files (and lock).
4. Commit on `main`, then push with BlinkGuard auth (`gh auth switch --user xPOGx`; `git -c credential.helper='!gh auth git-credential' push origin main`).
5. `git tag vX.Y.Z` on the **bump commit** (`git rev-parse HEAD` must be that commit). `git push origin vX.Y.Z` alone — do **not** start `gh release create` in the same tool batch.
6. **Tag verify (required):** `git rev-parse vX.Y.Z` and `git ls-remote origin refs/tags/vX.Y.Z` must be the **same SHA** as the bump commit. If remote differs (race / default-branch tag invent), **stop** — cancel any new CI run, move the remote tag to the bump SHA (`git push origin vX.Y.Z --force` is allowed **only** in this same-session verify failure before users download artifacts), re-verify `ls-remote`, then continue. Do not publish notes until verify passes.
7. `gh release create vX.Y.Z --repo xpogx-org/BlinkGuard --title "BlinkGuard X.Y.Z" --notes-file release-notes.tmp.md --latest` (after verify only). Prefer `--target <bump-sha>` when the CLI supports it.
8. Delete `release-notes.tmp.md` only (do **not** delete tracked `release-notes.md` if it exists in the repo).
9. `git checkout development`; `git merge main`; `git -c credential.helper='!gh auth git-credential' push origin development` (align `development` with the release commit **before** any `workflow_dispatch`).
10. Wait ~5s; `gh run list --repo xpogx-org/BlinkGuard --workflow=build.yml --limit 3`. Confirm the run's `headSha` equals the bump commit.

If no `release` run appears: `gh workflow run "Build and Release" --repo xpogx-org/BlinkGuard -f publish_to_tag=vX.Y.Z -f platforms=both` — only after step 9 so checkout of `development` has the bump.

Do not push unless this skill is running (user asked to ship). Do **not** `--force` tags except the step-6 same-session verify fix above. After CI has attached installers / users may have the URL, never rewrite that tag — ship a new version instead.

Auth: always `gh auth switch --user xPOGx` before BlinkGuard push/release (org repo).

## After CI

Reply with: version chosen + why (SemVer rule cited), release URL, Actions URL.

If a job fails, diagnose logs (`gh run view ID --log-failed`), fix on `development`, merge to `main` or re-run with `workflow_dispatch` + `publish_to_tag` (do not create a second tag). Prefer `platforms=windows` or `macos` so concurrency does not cancel a still-running sibling.

Known traps:

- `package.json` `build.electronLanguages` must include `en-US` and `uk` (matches `shared/i18n`); never `en` alone on electron-builder 26.15.x (can empty `locales/`). `compression` is root `build`, not under `nsis`.
- `tsc` in `scripts/publish-*.js` typechecks tests — mock `ProcessCleanup` fully.
- Windows dlib model: `curl.exe` + retries, not bare `Invoke-WebRequest`.
- Tag push alone does **not** start CI.
- Never batch `git push origin vX.Y.Z` with `gh release create` — race can invent a remote tag on the default branch tip (pre-bump). Verify `ls-remote` first. Recurred v2.19.0 (2026-09-07).
- `workflow_dispatch` before `development` merges the bump builds the wrong SHA — merge/push `development` first.
- Day-to-day commits on `main` bypass the branch model — always land work on `development`.

## Ko-fi draft (always)

End the user reply with a **short English** post (no artifact filenames). Link the **tag** release only — do not add a Ko-fi pitch or URL.

Template:

```
BlinkGuard X.Y.Z is out.

<1–3 sentences: what users get>

Download: https://github.com/xpogx-org/BlinkGuard/releases/tag/vX.Y.Z
```

## Anti-patterns

- Empty release / bump with no commits since last tag
- Wrong reset (`2.17.0` + minor → `2.17.1` instead of `2.18.0`)
- Shipping breaking prefs/backup changes as patch/minor without major + migration
- `Downloads` section in release notes
- Dual CI (`push: tags` + `release: published`)
- Local `build:windows` instead of GitHub Release unless the user asked only for a local package
- Changing `appId` or inventing a new GitHub owner
- Rewriting a published `vX.Y.Z` tag or release after CI artifacts / user-facing URL (except step-6 same-session verify)
- Parallel tag push + `gh release create` without `ls-remote` verify
- Committing product work directly to `main` outside `/deploy`
