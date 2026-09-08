#!/usr/bin/env node
/**
 * BlinkGuard agent-docs drift checker (no deps).
 * Run from repo root: node .cursor/skills/keep-agent-docs-current/scripts/check-docs.mjs
 *
 * Checks:
 * - PersistedPreferences fields vs backtick mentions in preferences-store.mdc
 * - electron/application/*.ts vs project-overview / clean-architecture maps
 *   (AGENTS.md is a harness router, not the encyclopedia)
 * - public/*.html vs dual-ui.mdc inventory (except retired blink-rate-coach.html)
 * - Cyrillic in agent docs (rules/skills/agents/commands/hooks + AGENTS.md + docs/harness)
 * - Phantom `kofi.ts` mentions in agent docs
 *
 * Exit 1 when gaps exist; exit 0 when OK.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../../..");

const gaps = [];

function read(rel) {
	const abs = path.join(REPO_ROOT, rel);
	if (!fs.existsSync(abs)) return null;
	return fs.readFileSync(abs, "utf8");
}

function listFiles(relDir, filterFn) {
	const abs = path.join(REPO_ROOT, relDir);
	if (!fs.existsSync(abs)) return [];
	return fs
		.readdirSync(abs, { withFileTypes: true })
		.filter((d) => d.isFile())
		.map((d) => d.name)
		.filter(filterFn ?? (() => true));
}

/** Field names from `export interface PersistedPreferences { ... }` */
function parsePersistedPreferenceFields(src) {
	const start = src.indexOf("export interface PersistedPreferences");
	if (start < 0) return [];
	const brace = src.indexOf("{", start);
	if (brace < 0) return [];
	let depth = 0;
	let end = brace;
	for (let i = brace; i < src.length; i++) {
		const ch = src[i];
		if (ch === "{") depth++;
		else if (ch === "}") {
			depth--;
			if (depth === 0) {
				end = i;
				break;
			}
		}
	}
	const body = src.slice(brace + 1, end);
	const fields = [];
	for (const line of body.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("*") || trimmed.startsWith("/")) continue;
		const m = /^([A-Za-z_][A-Za-z0-9_]*)\s*[?:]/.exec(trimmed);
		if (m) fields.push(m[1]);
	}
	return fields;
}

function checkPreferences() {
	const prefsSrc = read("shared/preferences.ts");
	const storeMdc = read(".cursor/rules/preferences-store.mdc");
	if (!prefsSrc || !storeMdc) {
		gaps.push("prefs: missing shared/preferences.ts or preferences-store.mdc");
		return;
	}
	const fields = parsePersistedPreferenceFields(prefsSrc);
	for (const f of fields) {
		if (!storeMdc.includes(`\`${f}\``)) {
			gaps.push(
				`prefs: PersistedPreferences.${f} missing as a backtick in preferences-store.mdc`,
			);
		}
	}
}

function applicationStems() {
	return listFiles("electron/application", (n) => n.endsWith(".ts")).map((n) => {
		const base = n.replace(/\.ts$/, "");
		const withoutService = base.replace(/-service$/, "");
		return { file: n, stems: [...new Set([base, withoutService])] };
	});
}

function kebabToPascal(kebab) {
	return kebab
		.split("-")
		.filter(Boolean)
		.map((s) => s.charAt(0).toUpperCase() + s.slice(1))
		.join("");
}

/** True if docs mention the stem (kebab, spaced, or PascalCase). */
function docsMention(hayLower, stem) {
	const s = stem.toLowerCase();
	if (hayLower.includes(s)) return true;
	if (hayLower.includes(s.replace(/-/g, " "))) return true;
	if (hayLower.includes(kebabToPascal(stem).toLowerCase())) return true;
	const tokens = s.split("-").filter((t) => t.length > 2);
	if (tokens.length === 0) return false;
	return tokens.every((t) => hayLower.includes(t));
}

function checkApplicationMaps() {
	const overview = read(".cursor/rules/project-overview.mdc") ?? "";
	const ca = read(".cursor/rules/clean-architecture.mdc") ?? "";
	const agents = read("AGENTS.md") ?? "";
	const haystack = `${overview}\n${ca}\n${agents}`.toLowerCase();
	for (const { file, stems } of applicationStems()) {
		const hit = stems.some((s) => docsMention(haystack, s));
		if (!hit) {
			gaps.push(
				`application: electron/application/${file} not mentioned in project-overview / clean-architecture maps`,
			);
		}
	}
	const trayDir = path.join(REPO_ROOT, "electron/infrastructure/tray");
	if (fs.existsSync(trayDir) && !haystack.includes("tray")) {
		gaps.push(
			"infrastructure: electron/infrastructure/tray/ exists but tray is missing from CA/overview/AGENTS maps",
		);
	}
}

const RETIRED_PUBLIC_HTML = new Set(["blink-rate-coach.html"]);

function checkDualUiHtml() {
	const dual = read(".cursor/rules/dual-ui.mdc");
	if (!dual) {
		gaps.push("dual-ui: missing .cursor/rules/dual-ui.mdc");
		return;
	}
	const htmlFiles = listFiles("public", (n) => n.endsWith(".html"));
	for (const name of htmlFiles) {
		if (RETIRED_PUBLIC_HTML.has(name)) continue;
		if (!dual.includes(name) && !dual.includes(`\`${name}\``)) {
			gaps.push(`dual-ui: public/${name} not mentioned in dual-ui.mdc`);
		}
	}
}

const CYRILLIC_RE = /[\u0400-\u04FF]/;

function checkEnglishOnly() {
	const roots = [
		".cursor/rules",
		".cursor/skills",
		".cursor/agents",
		".cursor/commands",
		".cursor/hooks",
		"docs/harness",
		"AGENTS.md",
	];
	function walk(rel) {
		const abs = path.join(REPO_ROOT, rel);
		if (!fs.existsSync(abs)) return;
		const st = fs.statSync(abs);
		if (st.isFile()) {
			if (!/\.(mdc|md|ts|tsx|json|mjs|js)$/i.test(abs)) return;
			const norm = rel.replace(/\\/g, "/");
			if (norm.endsWith("scripts/check-docs.mjs")) return;
			const text = fs.readFileSync(abs, "utf8");
			if (CYRILLIC_RE.test(text)) {
				gaps.push(`english-only: Cyrillic found in ${norm}`);
			}
			return;
		}
		if (!st.isDirectory()) return;
		for (const name of fs.readdirSync(abs)) {
			if (name === "node_modules") continue;
			walk(path.join(rel, name));
		}
	}
	for (const r of roots) walk(r);
}

function isOwnershipStyleKofiMention(line) {
	if (!/kofi\.ts\b/.test(line)) return false;
	if (
		/\bphantom\b|\bdoes not exist\b|\bretired\b|\bavoid\b|\bno longer\b|\bdo not\b|\bnever existed\b/i.test(
			line,
		)
	) {
		return false;
	}
	return true;
}

function checkPhantomKofi() {
	const roots = [
		".cursor/rules",
		".cursor/skills",
		".cursor/agents",
		".cursor/commands",
		"AGENTS.md",
	];
	function walk(rel) {
		const abs = path.join(REPO_ROOT, rel);
		if (!fs.existsSync(abs)) return;
		const st = fs.statSync(abs);
		if (st.isFile()) {
			if (!/\.(mdc|md|ts|tsx|json|mjs|js)$/i.test(abs)) return;
			const norm = rel.replace(/\\/g, "/");
			if (norm.endsWith("scripts/check-docs.mjs")) return;
			const text = fs.readFileSync(abs, "utf8");
			for (const line of text.split(/\r?\n/)) {
				if (isOwnershipStyleKofiMention(line)) {
					gaps.push(`phantom: ${norm} mentions kofi.ts (file does not exist)`);
					break;
				}
			}
			return;
		}
		if (!st.isDirectory()) return;
		for (const name of fs.readdirSync(abs)) {
			if (name === "node_modules") continue;
			walk(path.join(rel, name));
		}
	}
	for (const r of roots) walk(r);
}

function main() {
	checkPreferences();
	checkApplicationMaps();
	checkDualUiHtml();
	checkEnglishOnly();
	checkPhantomKofi();

	if (gaps.length === 0) {
		console.log("check-docs: OK — no gaps reported");
		process.exit(0);
	}
	console.log(`check-docs: ${gaps.length} gap(s):\n`);
	for (const g of gaps) console.log(`- ${g}`);
	process.exit(1);
}

main();
