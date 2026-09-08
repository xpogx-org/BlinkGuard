#!/usr/bin/env node
/**
 * beforeShellExecution: warn against routine setup.bat / setup.sh for sidecar rebuild.
 * Fail open — allow on parse errors. permission "ask" when setup scripts match.
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

function isSidecarSetup(command) {
	const c = String(command || "");
	// setup.bat / setup.sh under python/ (or bare when cwd is python)
	if (/(?:^|[\s"'/\\])setup\.(bat|sh)(?=[\s"']|$)/i.test(c)) return true;
	if (/python[/\\]setup\.(bat|sh)/i.test(c)) return true;
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
		if (!isSidecarSetup(command)) {
			process.stdout.write(JSON.stringify({ permission: "allow" }) + "\n");
			return;
		}
		const message =
			"Sidecar skill forbids setup.bat/setup.sh on routine rebuild — use the venv python + build_and_install, then check_exe_mtime.py. Continue only for first-time env setup.";
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
