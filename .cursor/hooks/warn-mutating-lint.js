#!/usr/bin/env node
/**
 * beforeShellExecution: warn that `npm run lint` writes src via biome --write.
 * Fail open — allow on parse errors. permission "ask" when lint mutates.
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

function isMutatingLint(command) {
	const c = String(command || "");
	if (!/\bnpm\s+run\s+lint\b/.test(c)) return false;
	// Explicit read-only biome is fine
	if (/@biomejs\/biome\s+check(?:\s|$)/.test(c) && !/--write\b/.test(c)) {
		return false;
	}
	return true;
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
		if (!isMutatingLint(command)) {
			process.stdout.write(JSON.stringify({ permission: "allow" }) + "\n");
			return;
		}
		const message =
			"`npm run lint` runs biome --write and mutates src. Prefer read-only: npx @biomejs/biome check src. Continue only if you intend to write.";
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
