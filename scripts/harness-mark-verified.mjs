#!/usr/bin/env node
/* harness-stock: true */
/**
 * Only process allowed to set status: verified on a harness task.
 * Requires gitignored .harness-last-verify.json from a green wrapper run.
 * Also moves the id from **In progress** onto **Verified** in progress.md.
 */
import fs from "fs";
import path from "path";
import {
	harnessPaths,
	loadProgressText,
	loadTasksText,
	markTaskVerifiedInText,
	moveActiveToVerified,
} from "./harness-tasks.mjs";

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
const paths = harnessPaths(root);

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

let tasksText;
let progressText;
try {
	tasksText = loadTasksText(root).text;
	progressText = loadProgressText(root).text;
} catch (error) {
	fail(error.message);
}

let nextTasks;
let title;
try {
	({ text: nextTasks, title } = markTaskVerifiedInText(tasksText, taskId));
} catch (error) {
	fail(error.message);
}

let nextProgress;
try {
	nextProgress = moveActiveToVerified(progressText, { id: taskId, title });
} catch (error) {
	fail(error.message);
}

fs.writeFileSync(paths.tasks, nextTasks);
fs.writeFileSync(paths.progress, nextProgress);
fs.unlinkSync(stampPath);
console.log(`harness-mark-verified: ${taskId} -> verified`);
process.exit(0);
