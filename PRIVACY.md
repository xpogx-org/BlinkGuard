# Privacy

BlinkGuard is designed to keep your data on your machine.

## What stays local

- Preferences and settings (via `electron-store` under the app user-data folder)
- Blink session statistics
- Optional blink-detector debug logs under `{userData}/logs/` (only if you use camera detection / debug capture)
- Interaction trail under `{userData}/logs/interactions.jsonl` (settings changes, popup snooze/skip, tray and shortcut actions — custom popup/exercise text is redacted)

There is **no** BlinkGuard account, cloud sync backend, or analytics pipeline that watches how you use the app.

## Export diagnostics

About → **Report a problem** lets you export a local zip (or folder) with blink logs, the interaction trail, `app.log` when present, and algorithm-related settings. Nothing is uploaded. Attach that file when you open the structured GitHub bug report from the same panel.

## Reporting issues

Prefer **About → Report a problem → Open GitHub issue** so reports use the repo issue templates. You can also browse [GitHub Issues](https://github.com/xpogx-org/BlinkGuard/issues). For security vulnerabilities, see [SECURITY.md](SECURITY.md).

## Observability policy

- No silent telemetry or usage analytics
- Diagnostics export is the primary way to share operational context when you choose to
- Any future opt-in network metrics would require an explicit preference and an update to this document

## Camera

When camera blink detection is enabled, frames are processed on your device by the optional local sidecar. Video is not uploaded to BlinkGuard servers (there are none).

## Updates

Optional in-app update checks contact GitHub Releases for this repository (`xpogx-org/BlinkGuard`) to see if a newer build is available. That is a normal download/update channel, not usage analytics.

## Questions

Open a structured issue via **About → Report a problem** in the app, or browse https://github.com/xpogx-org/BlinkGuard/issues. See [SECURITY.md](SECURITY.md) for vulnerability reports.
