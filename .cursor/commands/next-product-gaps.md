# /next-product-gaps

Find the next N BlinkGuard product gaps and write paste-ready English planning briefs.

**Invoke skill:** `next-product-gaps`

## Steps

1. Read `.cursor/skills/next-product-gaps/SKILL.md`.
2. Run `node .cursor/skills/next-product-gaps/scripts/gather-shipped.mjs` and Read `shipped-drop.md`.
3. Drop shipped / in-progress / same-pain duplicates (tray/hush/goals fences already shipped).
4. Probe real seams, then write N English fences (default 3).
5. Recap in the user's language; do **not** implement or CreatePlan in this chat.

Do not re-brief ideas listed in `shipped-drop.md`.
