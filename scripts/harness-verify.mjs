#!/usr/bin/env node
/* harness-stock: true */
/**
 * One-exit-code harness verify. Reads docs/harness/manifest.json.
 * Layer 1 then 2 fail-fast. Layer 3 only when layer3Status === "present".
 * Writes .harness-last-verify.json only on success. Deletes any stamp first.
 */
import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";

const root = process.cwd();
const stampPath = path.join(root, ".harness-last-verify.json");
const manifestPath = path.join(root, "docs", "harness", "manifest.json");

function fail(message, code = 1) {
	console.error(`harness-verify: ${message}`);
	process.exit(code);
}

if (fs.existsSync(stampPath)) {
	fs.unlinkSync(stampPath);
}

if (!fs.existsSync(manifestPath)) {
	fail("missing docs/harness/manifest.json");
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const layer1 = Array.isArray(manifest.layer1Commands) ? manifest.layer1Commands : [];
const layer2 = Array.isArray(manifest.layer2Commands) ? manifest.layer2Commands : [];

if (layer1.length === 0 || layer2.length === 0) {
	fail("manifest missing layer1Commands or layer2Commands");
}

function runLayer(label, commands) {
	for (const command of commands) {
		if (!command || typeof command !== "string") {
			fail(`invalid command in layer ${label}`);
		}
		console.log(`harness-verify layer ${label}: ${command}`);
		const result = spawnSync(command, {
			cwd: root,
			shell: true,
			stdio: "inherit",
			env: process.env,
		});
		const code = result.status === null || result.status === undefined ? 1 : result.status;
		if (code !== 0) {
			fail(`layer ${label} failed (${code})`, code);
		}
	}
}

runLayer("1", layer1);
runLayer("2", layer2);

if (manifest.layer3Status === "present" && manifest.layer3Command) {
	runLayer("3", [manifest.layer3Command]);
} else {
	console.log("harness-verify: layer 3 skipped (missing)");
}

fs.writeFileSync(
	stampPath,
	JSON.stringify(
		{
			exitCode: 0,
			at: new Date().toISOString(),
			command: manifest.verifyCommand || "harness-verify",
		},
		null,
		2,
	) + "\n",
);

process.exit(0);
