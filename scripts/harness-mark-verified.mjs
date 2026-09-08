#!/usr/bin/env node
/* harness-stock: true */
/**
 * Only process allowed to set status: verified on a harness task.
 * Requires gitignored .harness-last-verify.json from a green wrapper run.
 */
import fs from "fs";
import path from "path";

const STAMP_MAX_AGE_MS = 2 * 60 * 60 * 1000;

function fail(message, code = 1) {
	console.error(`harness-mark-verified: ${message}`);
	process.exit(code);
}

const taskId = process.argv[2];
if (!taskId) {
	fail("usage: node scripts/harness-mark-verified.mjs <task-id>", 2);
}

const root = process.cwd();
const stampPath = path.join(root, ".harness-last-verify.json");
const tasksPath = path.join(root, "docs", "harness", "tasks.md");

if (!fs.existsSync(stampPath)) {
	fail("missing .harness-last-verify.json (run the verify wrapper first)");
}

let stamp;
try {
	stamp = JSON.parse(fs.readFileSync(stampPath, "utf8"));
} catch {
	fail("could not parse .harness-last-verify.json");
}

if (stamp.exitCode !== 0) {
	fail("last verify was not exit 0");
}

if (!stamp.at || Number.isNaN(Date.parse(stamp.at))) {
	fail("last-verify stamp missing at");
}

if (Date.now() - Date.parse(stamp.at) > STAMP_MAX_AGE_MS) {
	fail("last-verify stamp expired (re-run the wrapper)");
}

if (!fs.existsSync(tasksPath)) {
	fail("missing docs/harness/tasks.md");
}

const text = fs.readFileSync(tasksPath, "utf8");
const parts = text.split(/(?=^## \[)/m);
let found = false;
let alreadyVerified = false;
let notActive = false;

const next = parts.map((part) => {
	if (!part.startsWith("## [")) {
		return part;
	}
	const match = part.match(/^## \[([^\]]+)\]/);
	if (!match || match[1] !== taskId) {
		return part;
	}
	found = true;
	if (/^- status:\s*verified\s*$/m.test(part)) {
		alreadyVerified = true;
		return part;
	}
	if (!/^- status:\s*active\s*$/m.test(part)) {
		notActive = true;
		return part;
	}
	return part.replace(/^- status:\s*active\s*$/m, "- status: verified");
});

if (!found) {
	fail(`no task heading ## [${taskId}] in docs/harness/tasks.md`);
}
if (alreadyVerified) {
	fail(`task ${taskId} is already verified`);
}
if (notActive) {
	fail(`task ${taskId} is not status: active`);
}

fs.writeFileSync(tasksPath, next.join(""));
fs.unlinkSync(stampPath);
console.log(`harness-mark-verified: ${taskId} -> verified`);
process.exit(0);
