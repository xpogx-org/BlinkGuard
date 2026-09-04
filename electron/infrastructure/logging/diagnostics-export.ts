import { app, dialog, shell, type BrowserWindow } from "electron";
import { execFile } from "node:child_process";
import {
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { ExportDiagnosticsResult } from "../../../shared/diagnostics";
import {
	sanitizeQuietHoursByWeekday,
	type AppPreferences,
} from "../../../shared/preferences";
import { getAppLogPath } from "./configure-file-logging";
import { isBlinkDetectorBinaryPresent } from "../sidecar/blink-detector-path";

const execFileAsync = promisify(execFile);

export interface DiagnosticsExportOptions {
	preferences: AppPreferences;
	settingsProfilesCount?: number;
	parentWindow?: BrowserWindow | null;
}

export async function exportDiagnosticsBundle(
	options: DiagnosticsExportOptions,
): Promise<ExportDiagnosticsResult> {
	const stamp = formatStamp(new Date());
	const defaultName = `BlinkGuard-diagnostics-${stamp}.zip`;
	const desktop = app.getPath("desktop");

	const dialogOptions = {
		title: "Export BlinkGuard diagnostics",
		defaultPath: path.join(desktop, defaultName),
		filters: [{ name: "Zip archive", extensions: ["zip"] }],
	};
	const save = options.parentWindow
		? await dialog.showSaveDialog(options.parentWindow, dialogOptions)
		: await dialog.showSaveDialog(dialogOptions);

	if (save.canceled || !save.filePath) {
		return { status: "cancelled" };
	}

	const zipPath = save.filePath.endsWith(".zip")
		? save.filePath
		: `${save.filePath}.zip`;

	const stageRoot = mkdtempSync(path.join(os.tmpdir(), "blinkguard-diag-"));
	const stageDir = path.join(stageRoot, "BlinkGuard-diagnostics");
	const logsDir = path.join(stageDir, "logs");

	try {
		mkdirSync(logsDir, { recursive: true });

		writeFileSync(
			path.join(stageDir, "meta.json"),
			`${JSON.stringify(
				buildMeta(options.preferences, options.settingsProfilesCount),
				null,
				2,
			)}\n`,
			"utf8",
		);
		writeFileSync(
			path.join(stageDir, "algorithm-prefs.json"),
			`${JSON.stringify(buildAlgorithmPrefs(options.preferences), null, 2)}\n`,
			"utf8",
		);

		const userLogs = path.join(app.getPath("userData"), "logs");
		copyIfExists(
			path.join(userLogs, "blink-detector.jsonl"),
			path.join(logsDir, "blink-detector.jsonl"),
		);
		copyIfExists(
			path.join(userLogs, "blink-detector.jsonl.1"),
			path.join(logsDir, "blink-detector.jsonl.1"),
		);
		copyIfExists(
			path.join(userLogs, "interactions.jsonl"),
			path.join(logsDir, "interactions.jsonl"),
		);
		copyIfExists(
			path.join(userLogs, "interactions.jsonl.1"),
			path.join(logsDir, "interactions.jsonl.1"),
		);

		const appLog = getAppLogPath();
		if (appLog) {
			copyIfExists(appLog, path.join(logsDir, "app.log"));
		}

		try {
			await createZip(stageDir, zipPath);
			shell.showItemInFolder(zipPath);
			return { status: "saved", path: zipPath };
		} catch (zipError) {
			const folderPath = zipPath.replace(/\.zip$/i, "");
			try {
				if (existsSync(folderPath)) {
					rmSync(folderPath, { recursive: true, force: true });
				}
				cpSync(stageDir, folderPath, { recursive: true });
				shell.showItemInFolder(folderPath);
				return {
					status: "saved",
					path: folderPath,
					message:
						zipError instanceof Error
							? `Zip failed (${zipError.message}); saved as folder instead`
							: "Zip failed; saved as folder instead",
				};
			} catch (folderError) {
				const message =
					folderError instanceof Error
						? folderError.message
						: String(folderError);
				return { status: "error", message };
			}
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return { status: "error", message };
	} finally {
		try {
			rmSync(stageRoot, { recursive: true, force: true });
		} catch {
			// Best-effort temp cleanup.
		}
	}
}

function buildMeta(
	preferences: AppPreferences,
	settingsProfilesCount?: number,
): Record<string, unknown> {
	const root = process.env.APP_ROOT ?? app.getAppPath();
	const meta: Record<string, unknown> = {
		exportedAt: new Date().toISOString(),
		appVersion: app.getVersion(),
		electronVersion: process.versions.electron,
		chromeVersion: process.versions.chrome,
		nodeVersion: process.versions.node,
		platform: process.platform,
		arch: process.arch,
		locale: preferences.locale,
		packaged: app.isPackaged,
		cameraEnabled: preferences.cameraEnabled,
		isTracking: preferences.isTracking,
		hasCompletedOnboarding: preferences.hasCompletedOnboarding,
		sidecarBinaryPresent: isBlinkDetectorBinaryPresent(root, app.isPackaged),
	};
	if (settingsProfilesCount !== undefined) {
		meta.settingsProfilesCount = settingsProfilesCount;
	}
	return meta;
}

export { buildMeta };

export function buildAlgorithmPrefs(
	preferences: AppPreferences,
): Record<string, unknown> {
	return {
		cameraEnabled: preferences.cameraEnabled,
		cameraQuality: preferences.cameraQuality,
		cameraDevice: preferences.cameraDevice,
		earCalibration: preferences.earCalibration,
		calibrationAt: preferences.calibrationAt,
		calibrationNudgeEnabled: preferences.calibrationNudgeEnabled,
		calibrationNudgeDismissedAt: preferences.calibrationNudgeDismissedAt,
		lastBaselineDriftAt: preferences.lastBaselineDriftAt,
		classifierBias: preferences.classifierBias,
		classifierThreshold: preferences.classifierThreshold,
		mgdMode: preferences.mgdMode,
		autoStopNoFaceEnabled: preferences.autoStopNoFaceEnabled,
		autoStopNoFaceMinutes: preferences.autoStopNoFaceMinutes,
		blinkRateCoachingEnabled: preferences.blinkRateCoachingEnabled,
		blinkRateThresholdPerMin: preferences.blinkRateThresholdPerMin,
		reminderIntervalMs: preferences.reminderInterval,
		isTracking: preferences.isTracking,
		quietHoursEnabled: preferences.quietHoursEnabled,
		quietHoursStart: preferences.quietHoursStart,
		quietHoursEnd: preferences.quietHoursEnd,
		quietHoursByWeekday: sanitizeQuietHoursByWeekday(
			preferences.quietHoursByWeekday,
		),
		pauseOnFullscreen: preferences.pauseOnFullscreen,
		pauseAppRules: preferences.pauseAppRules,
		notificationStyle: preferences.notificationStyle,
	};
}

function copyIfExists(from: string, to: string): void {
	if (!existsSync(from)) return;
	cpSync(from, to);
}

function formatStamp(date: Date): string {
	const pad = (n: number) => String(n).padStart(2, "0");
	return [
		date.getFullYear(),
		pad(date.getMonth() + 1),
		pad(date.getDate()),
		"-",
		pad(date.getHours()),
		pad(date.getMinutes()),
		pad(date.getSeconds()),
	].join("");
}

async function createZip(stageDir: string, zipPath: string): Promise<void> {
	if (existsSync(zipPath)) {
		rmSync(zipPath, { force: true });
	}

	if (process.platform === "win32") {
		const stage = escapePsSingleQuoted(stageDir);
		const dest = escapePsSingleQuoted(zipPath);
		await execFileAsync(
			"powershell.exe",
			[
				"-NoProfile",
				"-NonInteractive",
				"-Command",
				`$ErrorActionPreference = 'Stop'; Compress-Archive -Path '${stage}\\*' -DestinationPath '${dest}' -Force`,
			],
			{ windowsHide: true },
		);
		return;
	}

	await execFileAsync("zip", ["-r", zipPath, "."], { cwd: stageDir });
}

function escapePsSingleQuoted(value: string): string {
	return value.replace(/'/g, "''");
}
