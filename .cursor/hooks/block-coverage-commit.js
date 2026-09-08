#!/usr/bin/env node
/**
 * beforeShellExecution: warn before git add/commit of coverage/.
 * Fail open — allow on parse errors. permission "ask" when coverage is staged.
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

/** Strip -m / heredoc message bodies so "coverage" in prose does not trip the gate. */
function scrubGitMessages(command) {
	return String(command || "")
		.replace(/-m\s+"(?:\\.|[^"\\])*"/g, " ")
		.replace(/-m\s+'(?:\\.|[^'\\])*'/g, " ")
		.replace(/-m\s+\$\([\s\S]*?\)/g, " ")
		.replace(/<<['"]?EOF[\s\S]*?^EOF/gim, " ");
}

function mentionsCoverage(command) {
	const raw = String(command || "");
	if (!/\bgit\b/i.test(raw)) return false;
	const c = scrubGitMessages(raw);

	// Path under coverage/
	if (/coverage[/\\]/i.test(c)) return true;

	// Bare pathspec token `coverage` (git add -f coverage, git add -- coverage)
	if (/(?:^|[\s"'=])coverage(?=[\s"']|$)/i.test(c)) return true;

	return false;
}

async function main() {
	try {
		const raw = await readStdin();
		if (!raw.trim()) {
			process.stdout.write(JSON.stringify({ permission: "allow" }) + "\n");
			return;
		}
		let payload;
		try {
			payload = JSON.parse(raw);
		} catch {
			process.stdout.write(JSON.stringify({ permission: "allow" }) + "\n");
			return;
		}
		const command = payload.command ?? payload.tool_input?.command ?? "";
		if (!mentionsCoverage(command)) {
			process.stdout.write(JSON.stringify({ permission: "allow" }) + "\n");
			return;
		}
		const message =
			"coverage/ is gitignored — do not commit regenerated Vitest coverage. Continue only if intentional.";
		process.stdout.write(
			JSON.stringify({
				permission: "ask",
				user_message: message,
				agent_message: message,
			}) + "\n",
		);
	} catch {
		process.stdout.write(JSON.stringify({ permission: "allow" }) + "\n");
	}
}

main();
