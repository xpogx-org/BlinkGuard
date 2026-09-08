#!/usr/bin/env node
/* harness-stock: true */
/**
 * Exit 1 if more than one harness task is status: active.
 * --need-active also fails when zero are active.
 */
import { activeTasks, loadTasksText, parseFlagArgs, parseTasksFile } from "./harness-tasks.mjs";

function fail(message, code = 1) {
	console.error(`harness-check-active: ${message}`);
	process.exit(code);
}

const { flags, positional } = parseFlagArgs(process.argv.slice(2));
if (positional.length > 0 || Object.keys(flags).some((key) => key !== "need-active")) {
	fail("usage: node scripts/harness-check-active.mjs [--need-active]", 2);
}

const needActive = Boolean(flags["need-active"]);
let text;
try {
	text = loadTasksText().text;
} catch (error) {
	fail(error.message);
}

const actives = activeTasks(parseTasksFile(text));
if (actives.length > 1) {
	fail(
		`expected at most one active task, found ${actives.length}: ${actives.map((task) => task.id).join(", ")}`,
	);
}
if (needActive && actives.length === 0) {
	fail("expected one active task, found none");
}

if (actives.length === 0) {
	console.log("harness-check-active: none");
} else {
	console.log(`harness-check-active: ${actives[0].id}`);
}
process.exit(0);
