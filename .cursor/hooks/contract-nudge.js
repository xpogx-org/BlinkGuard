#!/usr/bin/env node
/**
 * afterFileEdit: nudge when contract files change.
 * Fail open — empty stdout on parse/IO errors.
 * Do not also register under postToolUse (would double-nudge).
 */
const { stdin } = process;

function readStdin() {
	return new Promise((resolve) => {
		const chunks = [];
		stdin.on("data", (c) => chunks.push(c));
		stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
		stdin.on("error", () => resolve(""));
	});
}

function normalizePath(p) {
	return String(p || "")
		.replace(/\\/g, "/")
		.replace(/^[A-Za-z]:/, "");
}

function matchNudge(filePath) {
	const p = normalizePath(filePath);
	if (!p) return null;

	if (
		p.endsWith("/shared/preferences.ts") ||
		p.endsWith("shared/preferences.ts") ||
		p.endsWith("/shared/ipc-channels.ts") ||
		p.endsWith("shared/ipc-channels.ts") ||
		p.endsWith("/electron/preload.ts") ||
		p.endsWith("electron/preload.ts")
	) {
		return "Contract file edited — run keep-agent-docs-current / check-docs.mjs (prefs, IPC, preload).";
	}

	if (
		/\/electron\/infrastructure\/tray\//.test(p) ||
		/\/electron\/application\/snooze-all\.ts$/.test(p) ||
		/\/electron\/application\/snooze-token-prompt\.ts$/.test(p) ||
		/\/electron\/application\/focus-pause-service\.ts$/.test(p) ||
		/\/electron\/application\/session-pause-service\.ts$/.test(p) ||
		/\/electron\/application\/camera-capture-status-service\.ts$/.test(p) ||
		/\/shared\/(tray-session-glance|camera-capture-status|session-pause-status)\.ts$/.test(p) ||
		/\/public\/tray-menu\.(html|js|css)$/.test(p)
	) {
		return "Tray/hush/pause/capture-status surface edited — skim tray-runtime + composition-root; hush is runtime (promptSuppressUntil), not a pref.";
	}

	if (/\/src\/components\//.test(p) || /\/src\/features\/[^/]+\/ui\//.test(p)) {
		return "UI path edited — run ui-reuse check-catalog.mjs and update catalog.json if needed.";
	}

	if (/\/public\/[^/]+\.(html|js|css)$/.test(p) || /\/public\/.+\/.+\.(html|js|css)$/.test(p)) {
		return "Popup surface edited — dual-ui + i18n; keep React/vanilla split.";
	}

	if (/\/python\/blink_detector_package\//.test(p)) {
		return "Sidecar package edited — check protocol sync; rebuild binary if needed (check_exe_mtime.py).";
	}

	return null;
}

function extractPath(payload) {
	const input = payload?.tool_input ?? payload?.toolInput ?? payload ?? {};
	if (typeof input.path === "string") return input.path;
	if (typeof input.file_path === "string") return input.file_path;
	if (typeof input.filePath === "string") return input.filePath;
	if (typeof input.target_notebook === "string") return input.target_notebook;
	return "";
}

async function main() {
	try {
		const raw = await readStdin();
		if (!raw.trim()) {
			process.stdout.write("{}\n");
			return;
		}
		let payload;
		try {
			payload = JSON.parse(raw);
		} catch {
			process.stdout.write("{}\n");
			return;
		}
		const nudge = matchNudge(extractPath(payload));
		if (!nudge) {
			process.stdout.write("{}\n");
			return;
		}
		process.stdout.write(JSON.stringify({ additional_context: nudge }) + "\n");
	} catch {
		process.stdout.write("{}\n");
	}
}

main();
