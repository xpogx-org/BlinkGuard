#!/usr/bin/env node
/* harness-stock: true */
/**
 * Shared parser for docs/harness/tasks.md sections and progress.md bullets.
 * Used by harness-start-task, harness-check-active, and harness-mark-verified.
 */
import fs from "fs";
import path from "path";

export const NONE = "(none)";

const VERIFIED_LABEL = "Verified";
const IN_PROGRESS_LABEL = "In progress";

export function harnessPaths(root = process.cwd()) {
	return {
		root,
		tasks: path.join(root, "docs", "harness", "tasks.md"),
		progress: path.join(root, "docs", "harness", "progress.md"),
	};
}

export function newlineOf(text) {
	return text.includes("\r\n") ? "\r\n" : "\n";
}

function escapeRe(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function parseFlagArgs(argv) {
	const flags = {};
	const positional = [];
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === "--") {
			positional.push(...argv.slice(i + 1));
			break;
		}
		if (a.startsWith("--") && a.length > 2) {
			const key = a.slice(2);
			const next = argv[i + 1];
			if (next !== undefined && !next.startsWith("--")) {
				flags[key] = next;
				i++;
			} else {
				flags[key] = true;
			}
		} else {
			positional.push(a);
		}
	}
	return { flags, positional };
}

export function assertSingleLine(name, value) {
	if (typeof value !== "string") {
		throw new Error(`${name} is required`);
	}
	if (value.includes("\n") || value.includes("\r")) {
		throw new Error(`${name} must be a single line`);
	}
}

export function readTextFile(filePath, missingMessage) {
	if (!fs.existsSync(filePath)) {
		throw new Error(missingMessage);
	}
	return fs.readFileSync(filePath, "utf8");
}

export function loadTasksText(root = process.cwd()) {
	const filePath = harnessPaths(root).tasks;
	return { path: filePath, text: readTextFile(filePath, "missing docs/harness/tasks.md") };
}

export function loadProgressText(root = process.cwd()) {
	const filePath = harnessPaths(root).progress;
	return {
		path: filePath,
		text: readTextFile(filePath, "missing docs/harness/progress.md"),
	};
}

function fieldRe(key) {
	return new RegExp(`^- ${escapeRe(key)}:\\s*(.*?)\\s*$`, "m");
}

export function readField(section, key) {
	const match = section.match(fieldRe(key));
	return match ? match[1].trim() : null;
}

export function replaceField(section, key, value) {
	const re = fieldRe(key);
	if (!re.test(section)) {
		throw new Error(`missing field ${key}`);
	}
	return section.replace(re, `- ${key}: ${value}`);
}

export function parseTasksFile(text) {
	const parts = text.split(/(?=^## \[)/m);
	const preamble = parts[0]?.startsWith("## [") ? "" : (parts.shift() ?? "");
	const tasks = [];
	for (const part of parts) {
		const match = part.match(/^## \[([^\]]+)\](.*)$/m);
		if (!match) {
			continue;
		}
		const id = match[1].trim();
		const title = match[2].trim();
		tasks.push({
			id,
			title,
			status: readField(part, "status"),
			raw: part,
		});
	}
	return { preamble, parts, tasks };
}

export function findTask(parsed, taskId) {
	return parsed.tasks.find((task) => task.id === taskId) ?? null;
}

export function activeTasks(parsed) {
	return parsed.tasks.filter((task) => task.status === "active");
}

export function nextTaskId(parsed) {
	let max = 0;
	for (const task of parsed.tasks) {
		const match = /^T-(\d+)$/.exec(task.id);
		if (match) {
			max = Math.max(max, Number(match[1]));
		}
	}
	return `T-${String(max + 1).padStart(3, "0")}`;
}

export function rewriteTaskSection(text, taskId, mutator) {
	const parts = text.split(/(?=^## \[)/m);
	let found = false;
	const next = parts.map((part) => {
		if (!part.startsWith("## [")) {
			return part;
		}
		const match = part.match(/^## \[([^\]]+)\]/);
		if (!match || match[1] !== taskId) {
			return part;
		}
		found = true;
		return mutator(part);
	});
	if (!found) {
		throw new Error(`no task heading ## [${taskId}] in docs/harness/tasks.md`);
	}
	return next.join("");
}

export function assertNoActive(parsed) {
	const actives = activeTasks(parsed);
	if (actives.length > 0) {
		throw new Error(`already active: ${actives.map((task) => task.id).join(", ")}`);
	}
}

export function activateTaskInText(text, taskId) {
	const parsed = parseTasksFile(text);
	assertNoActive(parsed);
	const task = findTask(parsed, taskId);
	if (!task) {
		throw new Error(`no task heading ## [${taskId}] in docs/harness/tasks.md`);
	}
	if (task.status !== "not-started") {
		throw new Error(`task ${taskId} is not status: not-started (status: ${task.status})`);
	}
	return rewriteTaskSection(text, taskId, (part) => replaceField(part, "status", "active"));
}

export function appendTaskSection(text, spec) {
	const nl = newlineOf(text);
	const sddSpec = spec.sddSpec && spec.sddSpec !== NONE ? spec.sddSpec : NONE;
	const block = [
		`## [${spec.id}] ${spec.title}`,
		"",
		`- behavior: ${spec.behavior}`,
		`- proof: ${spec.proof}`,
		`- status: active`,
		`- sddSpec: ${sddSpec}`,
		"",
	].join(nl);
	const trimmed = text.replace(/[ \t]*$/u, "");
	const prefix = trimmed.endsWith(nl) ? trimmed : `${trimmed}${nl}`;
	const withBlank = prefix.endsWith(`${nl}${nl}`) ? prefix : `${prefix}${nl}`;
	return `${withBlank}${block}`;
}

export function addActiveTaskToText(text, spec) {
	const parsed = parseTasksFile(text);
	assertNoActive(parsed);
	if (findTask(parsed, spec.id)) {
		throw new Error(`task ${spec.id} already exists`);
	}
	return appendTaskSection(text, spec);
}

export function markTaskVerifiedInText(text, taskId) {
	const parsed = parseTasksFile(text);
	const task = findTask(parsed, taskId);
	if (!task) {
		throw new Error(`no task heading ## [${taskId}] in docs/harness/tasks.md`);
	}
	if (task.status === "verified") {
		throw new Error(`task ${taskId} is already verified`);
	}
	if (task.status !== "active") {
		throw new Error(`task ${taskId} is not status: active`);
	}
	const actives = activeTasks(parsed);
	if (actives.length !== 1) {
		throw new Error(
			`expected exactly one active task, found ${actives.length}: ${actives.map((item) => item.id).join(", ")}`,
		);
	}
	if (actives[0].id !== taskId) {
		throw new Error(`task ${taskId} is not the active task (${actives[0].id})`);
	}
	return {
		text: rewriteTaskSection(text, taskId, (part) => replaceField(part, "status", "verified")),
		title: task.title,
	};
}

function bulletRe(label) {
	return new RegExp(`^- \\*\\*${escapeRe(label)}:\\*\\*\\s*(.*)$`, "m");
}

export function readProgressBullet(text, label) {
	const match = text.match(bulletRe(label));
	if (!match) {
		throw new Error(`missing **${label}:** bullet in docs/harness/progress.md`);
	}
	return match[1].trim();
}

export function writeProgressBullet(text, label, value) {
	const re = bulletRe(label);
	if (!re.test(text)) {
		throw new Error(`missing **${label}:** bullet in docs/harness/progress.md`);
	}
	return text.replace(re, `- **${label}:** ${value}`);
}

export function parseVerifiedEntries(value) {
	if (!value || value === NONE) {
		return [];
	}
	return value
		.split(/\s*;\s*/)
		.map((chunk) => chunk.trim())
		.filter(Boolean)
		.map((chunk) => {
			const match = /^(\S+)\s+\((.*)\)\s*$/.exec(chunk);
			if (match) {
				return { id: match[1], title: match[2] };
			}
			return { id: chunk, title: "" };
		});
}

export function formatVerifiedEntries(entries) {
	if (!entries.length) {
		return NONE;
	}
	return entries
		.map((entry) => {
			const title = (entry.title || "").trim();
			return title ? `${entry.id} (${title})` : entry.id;
		})
		.join("; ");
}

export function setInProgress(text, taskIdOrNull) {
	return writeProgressBullet(text, IN_PROGRESS_LABEL, taskIdOrNull || NONE);
}

export function appendVerified(text, { id, title }) {
	const current = readProgressBullet(text, VERIFIED_LABEL);
	const entries = parseVerifiedEntries(current);
	if (!entries.some((entry) => entry.id === id)) {
		entries.push({ id, title: title || "" });
	}
	return writeProgressBullet(text, VERIFIED_LABEL, formatVerifiedEntries(entries));
}

export function moveActiveToVerified(progressText, { id, title }) {
	const withVerified = appendVerified(progressText, { id, title });
	return setInProgress(withVerified, null);
}
