#!/usr/bin/env node
/**
 * BlinkGuard ui-reuse catalog drift checker (no deps).
 * Run from repo root: node .cursor/skills/ui-reuse/scripts/check-catalog.mjs
 *
 * Compares src/components/*.tsx and src/features/<feature>/ui/*.(tsx|ts)
 * against catalog.json `path` values.
 *
 * Exit 1 when gaps exist; exit 0 when OK.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../../..");
const CATALOG_PATH = path.join(REPO_ROOT, ".cursor/skills/ui-reuse/catalog.json");

function norm(p) {
	return p.replace(/\\/g, "/");
}

function collectDiskUiPaths() {
	const out = new Set();
	const componentsDir = path.join(REPO_ROOT, "src/components");
	if (fs.existsSync(componentsDir)) {
		for (const name of fs.readdirSync(componentsDir)) {
			if (name.endsWith(".tsx")) out.add(norm(`src/components/${name}`));
		}
	}
	const featuresDir = path.join(REPO_ROOT, "src/features");
	if (!fs.existsSync(featuresDir)) return out;
	for (const feature of fs.readdirSync(featuresDir, { withFileTypes: true })) {
		if (!feature.isDirectory()) continue;
		const uiDir = path.join(featuresDir, feature.name, "ui");
		if (!fs.existsSync(uiDir)) continue;
		for (const name of fs.readdirSync(uiDir)) {
			if (/\.(tsx|ts)$/.test(name) && !name.endsWith(".d.ts")) {
				out.add(norm(`src/features/${feature.name}/ui/${name}`));
			}
		}
	}
	return out;
}

function isScopedCatalogPath(p) {
	const n = norm(p);
	if (/^src\/components\/[^/]+\.tsx$/.test(n)) return true;
	if (/^src\/features\/[^/]+\/ui\/[^/]+\.(tsx|ts)$/.test(n)) return true;
	return false;
}

function main() {
	const gaps = [];

	if (!fs.existsSync(CATALOG_PATH)) {
		console.log("check-catalog: missing catalog.json");
		process.exit(1);
	}
	let catalog;
	try {
		catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, "utf8"));
	} catch (err) {
		console.log(`check-catalog: failed to parse catalog.json: ${err.message}`);
		process.exit(1);
	}

	const disk = collectDiskUiPaths();
	const catalogPaths = new Set();
	const entries = Array.isArray(catalog.components) ? catalog.components : [];
	for (const entry of entries) {
		if (!entry || typeof entry.path !== "string") continue;
		const p = norm(entry.path.trim());
		if (!isScopedCatalogPath(p)) continue;
		catalogPaths.add(p);
	}

	for (const p of [...disk].sort()) {
		if (!catalogPaths.has(p)) {
			gaps.push(`disk→catalog: ${p} exists on disk but has no catalog.json path entry`);
		}
	}
	for (const p of [...catalogPaths].sort()) {
		if (!disk.has(p)) {
			gaps.push(`catalog→disk: catalog lists ${p} but file is missing`);
		}
	}

	for (const entry of entries) {
		if (!entry || typeof entry.id !== "string" || typeof entry.path !== "string") {
			continue;
		}
		if (entry.surface !== "react-settings") continue;
		const p = norm(entry.path.trim());
		if (p.includes(" + ") || !/\.(tsx|ts)$/.test(p)) continue;
		const stem = path.basename(p).replace(/\.(tsx|ts)$/, "");
		if (stem !== entry.id) {
			gaps.push(
				`id↔file: id "${entry.id}" does not match filename stem "${stem}" (${p})`,
			);
		}
	}

	if (gaps.length === 0) {
		console.log("check-catalog: OK — components + feature ui paths match catalog.json");
		process.exit(0);
	}
	console.log(`check-catalog: ${gaps.length} gap(s):\n`);
	for (const g of gaps) console.log(`- ${g}`);
	process.exit(1);
}

main();
