#!/usr/bin/env node
/**
 * Reproducible workspace / packaged size report for BlinkGuard.
 * Usage: node scripts/measure-app-size.mjs [--packaged] [--phase before|after]
 */

import { execSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const specDir = join(root, "specs", "active", "optimize-app-size");
const baselinePath = join(specDir, "size-baseline.json");

const args = process.argv.slice(2);
const includePackaged = args.includes("--packaged");
const phaseArg = args.find((a) => a.startsWith("--phase="));
const phase = phaseArg?.split("=")[1];

/** Matches electron-builder `files` negations — not shipped inside app.asar. */
const PACKAGED_DIST_DIRS = new Set([
	"win-unpacked",
	"mac",
	"mac-arm64",
	"linux-unpacked",
]);

function isPackagedDistFile(name) {
	const lower = name.toLowerCase();
	return (
		lower.endsWith(".exe") ||
		lower.endsWith(".blockmap") ||
		lower.endsWith(".zip") ||
		lower.endsWith(".yml") ||
		lower.endsWith(".yaml") ||
		lower.endsWith(".dmg")
	);
}

function distLayerSizeBytes() {
	const distDir = join(root, "dist");
	if (!existsSync(distDir)) return 0;
	let total = 0;
	for (const entry of readdirSync(distDir, { withFileTypes: true })) {
		const full = join(distDir, entry.name);
		if (entry.isDirectory()) {
			if (PACKAGED_DIST_DIRS.has(entry.name)) continue;
			total += dirSizeBytes(full);
		} else if (entry.isFile() && !isPackagedDistFile(entry.name)) {
			try {
				total += statSync(full).size;
			} catch {
				// skip
			}
		}
	}
	return total;
}

function distPackagedArtifactsBytes() {
	const distDir = join(root, "dist");
	if (!existsSync(distDir)) return 0;
	let total = 0;
	for (const entry of readdirSync(distDir, { withFileTypes: true })) {
		const full = join(distDir, entry.name);
		if (entry.isDirectory() && PACKAGED_DIST_DIRS.has(entry.name)) {
			total += dirSizeBytes(full);
		} else if (entry.isFile() && isPackagedDistFile(entry.name)) {
			try {
				total += statSync(full).size;
			} catch {
				// skip
			}
		}
	}
	return total;
}

function dirSizeBytes(dirPath) {
	if (!existsSync(dirPath)) return 0;
	let total = 0;
	const stack = [dirPath];
	while (stack.length > 0) {
		const current = stack.pop();
		let entries;
		try {
			entries = readdirSync(current, { withFileTypes: true });
		} catch {
			continue;
		}
		for (const entry of entries) {
			const full = join(current, entry.name);
			if (entry.isDirectory()) {
				stack.push(full);
			} else if (entry.isFile()) {
				try {
					total += statSync(full).size;
				} catch {
					// skip unreadable files
				}
			}
		}
	}
	return total;
}

function fileSizeBytes(filePath) {
	if (!existsSync(filePath)) return 0;
	try {
		return statSync(filePath).size;
	} catch {
		return 0;
	}
}

function toMb(bytes) {
	return Math.round((bytes / (1024 * 1024)) * 100) / 100;
}

function gitRef() {
	try {
		return execSync("git rev-parse --short HEAD", {
			cwd: root,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
		}).trim();
	} catch {
		return "unknown";
	}
}

function sidecarPath() {
	const win = join(root, "electron", "resources", "blink_detector.exe");
	const unix = join(root, "electron", "resources", "blink_detector");
	if (existsSync(win)) return win;
	if (existsSync(unix)) return unix;
	return win;
}

function findPackagedRoots() {
	const candidates = [
		join(root, "dist", "win-unpacked"),
		join(root, "release", "win-unpacked"),
	];
	for (const dir of candidates) {
		if (existsSync(dir)) return { winUnpacked: dir };
	}
	const macCandidates = [
		join(root, "dist", "mac"),
		join(root, "release", "mac"),
	];
	for (const dir of macCandidates) {
		if (existsSync(dir)) return { macApp: dir };
	}
	return {};
}

function findInstallerArtifacts() {
	const searchDirs = [join(root, "dist"), join(root, "release")];
	const result = {};
	for (const dir of searchDirs) {
		if (!existsSync(dir)) continue;
		for (const name of readdirSync(dir)) {
			const lower = name.toLowerCase();
			const full = join(dir, name);
			if (!statSync(full).isFile()) continue;
			if (lower.endsWith(".exe") && lower.includes("setup")) {
				result.nsisInstallerMb = toMb(statSync(full).size);
			} else if (lower.endsWith(".dmg")) {
				result.macDmgMb = toMb(statSync(full).size);
			}
		}
	}
	return result;
}

function fetchReleaseAssets() {
	try {
		const raw = execSync(
			'gh release view --json tagName,assets --jq ".tagName as $t | .assets[] | [$t, .name, .size] | @tsv"',
			{ cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
		).trim();
		if (!raw) return null;
		const assets = raw.split("\n").map((line) => {
			const [tag, name, size] = line.split("\t");
			return { tag, name, sizeMb: toMb(Number(size)) };
		});
		return assets;
	} catch {
		return null;
	}
}

function buildReport() {
	const distMb = toMb(distLayerSizeBytes());
	const distPackagedMb = toMb(distPackagedArtifactsBytes());
	const layers = {
		distMb,
		distElectronMb: toMb(dirSizeBytes(join(root, "dist-electron"))),
		sidecarMb: toMb(fileSizeBytes(sidecarPath())),
		modelsMb: toMb(dirSizeBytes(join(root, "electron", "assets", "models"))),
		assetsMb: toMb(dirSizeBytes(join(root, "assets"))),
		soundsMb: toMb(dirSizeBytes(join(root, "public", "sounds"))),
	};

	const notes = [];
	if (distPackagedMb > 1) {
		notes.push(
			`dist/ contains ${distPackagedMb} MB of electron-builder artifacts (excluded from workspace dist/ layer)`,
		);
	}
	if (layers.sidecarMb === 0) {
		notes.push("Sidecar binary missing — run python/build_and_install.bat");
	}
	if (layers.modelsMb > 90) {
		notes.push(
			`dlib model dominates workspace models (${layers.modelsMb} MB) — embedded in sidecar via PyInstaller`,
		);
	}

	const report = {
		capturedAt: new Date().toISOString(),
		gitRef: gitRef(),
		...(phase ? { phase } : {}),
		layers,
		notes,
	};

	if (includePackaged) {
		const packaged = {};
		if (distPackagedMb > 0) {
			packaged.distArtifactsMb = distPackagedMb;
		}
		const roots = findPackagedRoots();
		if (roots.winUnpacked) {
			packaged.winUnpackedMb = toMb(dirSizeBytes(roots.winUnpacked));
			const localesDir = join(roots.winUnpacked, "locales");
			if (existsSync(localesDir)) {
				packaged.localeFileCount = readdirSync(localesDir).length;
			}
		}
		if (roots.macApp) {
			packaged.macAppMb = toMb(dirSizeBytes(roots.macApp));
		}
		Object.assign(packaged, findInstallerArtifacts());
		if (Object.keys(packaged).length > 0) {
			report.packaged = packaged;
		} else {
			notes.push("No packaged output found — run electron-builder locally");
		}
	}

	const releaseAssets = fetchReleaseAssets();
	if (releaseAssets?.length) {
		report.releaseAssets = releaseAssets;
	}

	return report;
}

function loadBaselines() {
	if (!existsSync(baselinePath)) return [];
	try {
		const data = JSON.parse(readFileSync(baselinePath, "utf8"));
		return Array.isArray(data) ? data : [data];
	} catch {
		return [];
	}
}

function saveReport(report) {
	mkdirSync(specDir, { recursive: true });
	const existing = loadBaselines();
	const idx = phase
		? existing.findIndex((r) => r.phase === phase)
		: existing.findIndex((r) => !r.phase);
	if (idx >= 0) {
		existing[idx] = report;
	} else {
		existing.push(report);
	}
	writeFileSync(baselinePath, `${JSON.stringify(existing, null, 2)}\n`);
}

function printTable(report) {
	const { layers, packaged, releaseAssets } = report;
	const rows = [
		["dist/ (Vite app only)", `${layers.distMb} MB`],
		["dist-electron/", `${layers.distElectronMb} MB`],
		["electron/resources/ (sidecar)", `${layers.sidecarMb} MB`],
		["electron/assets/models/", `${layers.modelsMb} MB`],
		["assets/", `${layers.assetsMb} MB`],
		["public/sounds/", `${layers.soundsMb} MB`],
	];
	console.log("\n## BlinkGuard size report\n");
	console.log(`| Layer | Size |`);
	console.log(`| --- | --- |`);
	for (const [layer, size] of rows) {
		console.log(`| ${layer} | ${size} |`);
	}
	const workspaceTotal =
		layers.distMb +
		layers.distElectronMb +
		layers.sidecarMb +
		layers.assetsMb +
		layers.soundsMb;
	console.log(`| **Workspace total (excl. models source)** | **${Math.round(workspaceTotal * 100) / 100} MB** |`);

	if (packaged) {
		console.log("\n### Packaged\n");
		console.log(`| Artifact | Size |`);
		console.log(`| --- | --- |`);
		if (packaged.distArtifactsMb != null) {
			console.log(`| dist/ build artifacts (local) | ${packaged.distArtifactsMb} MB |`);
		}
		if (packaged.winUnpackedMb != null) {
			console.log(`| win-unpacked | ${packaged.winUnpackedMb} MB |`);
		}
		if (packaged.localeFileCount != null) {
			console.log(`| locales/ file count | ${packaged.localeFileCount} |`);
		}
		if (packaged.nsisInstallerMb != null) {
			console.log(`| NSIS installer | ${packaged.nsisInstallerMb} MB |`);
		}
		if (packaged.macDmgMb != null) {
			console.log(`| macOS DMG | ${packaged.macDmgMb} MB |`);
		}
	}

	if (releaseAssets?.length) {
		console.log("\n### Latest GitHub Release assets\n");
		console.log(`| Asset | Size |`);
		console.log(`| --- | --- |`);
		for (const a of releaseAssets) {
			console.log(`| ${a.name} | ${a.sizeMb} MB |`);
		}
	}

	if (report.notes.length) {
		console.log("\n### Notes\n");
		for (const n of report.notes) {
			console.log(`- ${n}`);
		}
	}
	console.log("");
}

const report = buildReport();
saveReport(report);
printTable(report);
