# /deploy

Ship a published GitHub Release for BlinkGuard.

**Invoke skill:** `deploy`

## Branch model

- **`development`** — default integration branch; all day-to-day commits land here.
- **`main`** — release branch only; updated exclusively by this command (merge from `development`, then version bump, tag, and GitHub Release).

## Steps

1. Ensure `development` is pushed and the working tree is clean.
2. Follow the `deploy` skill: decide SemVer bump, merge `development` → `main`, bump `package.json` / lock, move `CHANGELOG.md` Unreleased, write **`release-notes.tmp.md`** (not tracked `release-notes.md`), tag `vX.Y.Z`, publish the GitHub Release, verify CI.
3. Merge `main` back into `development` and push so both branches stay aligned.

Do not commit product work directly to `main`. Do not push tags or releases outside this workflow.
