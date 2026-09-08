# /docs

Refresh BlinkGuard Cursor agent docs so rules/skills/`AGENTS.md` match the repo.

**Invoke skill:** `keep-agent-docs-current`

## Steps

1. From repo root run:

   ```bash
   node .cursor/skills/keep-agent-docs-current/scripts/check-docs.mjs
   ```

2. Follow the skill checklist; patch only false/misplacing facts.
3. Optional: spawn the `docs-auditor` subagent to report drift (readonly).
4. If UI paths changed, also run `node .cursor/skills/ui-reuse/scripts/check-catalog.mjs`.

Do not invent layers or dump full IPC lists. `.cursor/` rules/skills/agents/commands/hooks are tracked — patch them in the same change.
