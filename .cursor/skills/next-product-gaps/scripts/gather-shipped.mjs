#!/usr/bin/env node
/**
 * BlinkGuard next-product-gaps gather (no deps).
 * Run from repo root: node .cursor/skills/next-product-gaps/scripts/gather-shipped.mjs
 *
 * Prints version, branch, git logs, and CHANGELOG head — without shell && chaining.
 */

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../../..");

function readJson(rel) {
	const abs = path.join(REPO_ROOT, rel);
	if (!fs.existsSync(abs)) return null;
	return JSON.parse(fs.readFileSync(abs, "utf8"));
}

function readHead(rel, maxLines = 60) {
	const abs = path.join(REPO_ROOT, rel);
	if (!fs.existsSync(abs)) return null;
	return fs
		.readFileSync(abs, "utf8")
		.split(/\r?\n/)
		.slice(0, maxLines)
		.join("\n");
}

function git(...args) {
	const r = spawnSync("git", args, {
		cwd: REPO_ROOT,
		encoding: "utf8",
		windowsHide: true,
	});
	if (r.error) {
		return { ok: false, text: String(r.error.message) };
	}
	if (r.status !== 0) {
		const err = (r.stderr || r.stdout || "").trim();
		return { ok: false, text: err || `git exit ${r.status}` };
	}
	return { ok: true, text: (r.stdout || "").trimEnd() };
}

function section(title) {
	console.log(`\n==== ${title} ====\n`);
}

function printGitLog(label, ref, count) {
	const r = git("log", "--oneline", `-${count}`, ref);
	if (!r.ok) {
		console.log(`(${label}: ${r.text})`);
		return;
	}
	console.log(r.text || "(empty)");
}

function main() {
	const pkg = readJson("package.json");
	section("VERSION");
	console.log(pkg?.version ?? "(package.json missing)");

	const branch = git("branch", "--show-current");
	section("BRANCH");
	const branchName = branch.ok ? branch.text : "(unknown)";
	console.log(branchName);
	if (branch.ok) {
		console.log(
			branchName === "development"
				? "on development (integration branch)"
				: `not development — also print development log below`,
		);
	}

	section("GIT LOG — HEAD (40)");
	printGitLog("HEAD", "HEAD", 40);

	if (branch.ok && branch.text !== "development") {
		section("GIT LOG — development (40)");
		printGitLog("development", "development", 40);
	}

	section("GIT LOG — main (15)");
	printGitLog("main", "main", 15);

	section("CHANGELOG.md (first 60 lines)");
	const changelog = readHead("CHANGELOG.md", 60);
	console.log(changelog ?? "(CHANGELOG.md missing)");
}

main();
