#!/usr/bin/env node
/* harness-stock: true */
/**
 * Activate exactly one harness task. Fails if any row is already active.
 * --activate <id> from not-started, or --add a new active row.
 */
import fs from "fs";
import {
	activateTaskInText,
	addActiveTaskToText,
	assertSingleLine,
	loadProgressText,
	loadTasksText,
	nextTaskId,
	NONE,
	parseFlagArgs,
	parseTasksFile,
	setInProgress,
} from "./harness-tasks.mjs";

function fail(message, code = 1) {
	console.error(`harness-start-task: ${message}`);
	process.exit(code);
}

const USAGE =
	"usage: node scripts/harness-start-task.mjs --activate <task-id>\n" +
	"       node scripts/harness-start-task.mjs --add <task-id> --title <title> --behavior <text> --proof <text> [--sddSpec <path>]\n" +
	"       node scripts/harness-start-task.mjs --add --next --title <title> --behavior <text> --proof <text> [--sddSpec <path>]";

function requireStringFlag(flags, name) {
	const value = flags[name];
	if (typeof value !== "string" || !value.trim()) {
		fail(`${name} is required`, 2);
	}
	assertSingleLine(name, value);
	return value.trim();
}

const { flags, positional } = parseFlagArgs(process.argv.slice(2));
if (positional.length > 0) {
	fail(USAGE, 2);
}

const wantsActivate = Object.hasOwn(flags, "activate");
const wantsAdd = Object.hasOwn(flags, "add");
const wantsNext = flags.next === true;

if (wantsActivate === wantsAdd) {
	fail(USAGE, 2);
}
if (wantsActivate && wantsNext) {
	fail(USAGE, 2);
}
if (wantsAdd && wantsNext && typeof flags.add === "string") {
	fail("use either --add <task-id> or --add --next, not both", 2);
}

let tasksPath;
let tasksText;
let progressPath;
let progressText;
try {
	({ path: tasksPath, text: tasksText } = loadTasksText());
	({ path: progressPath, text: progressText } = loadProgressText());
} catch (error) {
	fail(error.message);
}

let taskId;
let nextTasks;
try {
	if (wantsActivate) {
		if (typeof flags.activate !== "string" || !flags.activate.trim()) {
			fail(USAGE, 2);
		}
		taskId = flags.activate.trim();
		assertSingleLine("task-id", taskId);
		nextTasks = activateTaskInText(tasksText, taskId);
	} else {
		const title = requireStringFlag(flags, "title");
		const behavior = requireStringFlag(flags, "behavior");
		const proof = requireStringFlag(flags, "proof");
		const sddSpec = NONE_OR_SPEC(flags.sddSpec);
		assertSingleLine("sddSpec", sddSpec);
		if (wantsNext) {
			taskId = nextTaskId(parseTasksFile(tasksText));
		} else if (typeof flags.add === "string" && flags.add.trim()) {
			taskId = flags.add.trim();
			assertSingleLine("task-id", taskId);
		} else {
			fail(USAGE, 2);
		}
		nextTasks = addActiveTaskToText(tasksText, {
			id: taskId,
			title,
			behavior,
			proof,
			sddSpec,
		});
	}
} catch (error) {
	fail(error.message);
}

let nextProgress;
try {
	nextProgress = setInProgress(progressText, taskId);
} catch (error) {
	fail(error.message);
}

fs.writeFileSync(tasksPath, nextTasks);
fs.writeFileSync(progressPath, nextProgress);
console.log(`harness-start-task: ${taskId} -> active`);
process.exit(0);

function NONE_OR_SPEC(value) {
	if (value === true || value === undefined) {
		return NONE;
	}
	if (typeof value !== "string" || !value.trim()) {
		return NONE;
	}
	return value.trim();
}
