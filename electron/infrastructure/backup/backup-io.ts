import { app, dialog, shell, type BrowserWindow } from "electron";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
	backupScopeIncludesPreferences,
	buildBackupDocument,
	isBackupScope,
	parseBackupDocument,
	type BackupDocument,
	type BackupScope,
	type ExportBackupResult,
	type ImportBackupResult,
	type ParsedBackup,
} from "../../../shared/backup";
import type { BlinkStatsState } from "../../../shared/blink-stats";
import type { PersistedPreferences } from "../../../shared/preferences";
import type { SettingsProfilesState } from "../../../shared/settings-profiles";

export interface BackupExportOptions {
	scope: BackupScope;
	preferences: PersistedPreferences;
	blinkStats: BlinkStatsState;
	settingsProfiles?: SettingsProfilesState;
	parentWindow?: BrowserWindow | null;
}

export interface BackupImportOptions {
	scope: BackupScope;
	parentWindow?: BrowserWindow | null;
	filePath?: string;
	profilesOverwriteConfirmed?: boolean;
	getLocalProfiles: () => SettingsProfilesState;
	apply: (parsed: ParsedBackup) => void;
}

export async function exportBackupBundle(
	options: BackupExportOptions,
): Promise<ExportBackupResult> {
	if (!isBackupScope(options.scope)) {
		return { status: "error", message: "Invalid backup scope" };
	}

	let document: BackupDocument;
	try {
		document = buildBackupDocument({
			scope: options.scope,
			appVersion: app.getVersion(),
			preferences: options.preferences,
			blinkStats: options.blinkStats,
			settingsProfiles: options.settingsProfiles,
		});
	} catch (error) {
		return {
			status: "error",
			message: error instanceof Error ? error.message : String(error),
		};
	}

	const stamp = formatStamp(new Date());
	const defaultName = `BlinkGuard-backup-${stamp}.json`;
	const desktop = app.getPath("desktop");
	const dialogOptions = {
		title: "Export BlinkGuard backup",
		defaultPath: path.join(desktop, defaultName),
		filters: [{ name: "JSON", extensions: ["json"] }],
	};
	const save = options.parentWindow
		? await dialog.showSaveDialog(options.parentWindow, dialogOptions)
		: await dialog.showSaveDialog(dialogOptions);

	if (save.canceled || !save.filePath) {
		return { status: "cancelled" };
	}

	const filePath = save.filePath.endsWith(".json")
		? save.filePath
		: `${save.filePath}.json`;

	try {
		writeFileSync(
			filePath,
			`${JSON.stringify(document, null, 2)}\n`,
			"utf8",
		);
		shell.showItemInFolder(filePath);
		return { status: "saved", path: filePath };
	} catch (error) {
		return {
			status: "error",
			message: error instanceof Error ? error.message : String(error),
		};
	}
}

export async function importBackupBundle(
	options: BackupImportOptions,
): Promise<ImportBackupResult> {
	if (!isBackupScope(options.scope)) {
		return { status: "error", message: "Invalid backup scope" };
	}

	let filePath = options.filePath;
	if (!filePath) {
		const dialogOptions = {
			title: "Import BlinkGuard backup",
			filters: [{ name: "JSON", extensions: ["json"] }],
			properties: ["openFile"] as const,
		};
		const open = options.parentWindow
			? await dialog.showOpenDialog(options.parentWindow, {
					...dialogOptions,
					properties: ["openFile"],
				})
			: await dialog.showOpenDialog({
					...dialogOptions,
					properties: ["openFile"],
				});

		if (open.canceled || open.filePaths.length === 0) {
			return { status: "cancelled" };
		}

		filePath = open.filePaths[0];
	}

	let raw: unknown;
	try {
		const text = readFileSync(filePath, "utf8");
		raw = JSON.parse(text) as unknown;
	} catch (error) {
		return {
			status: "error",
			message:
				error instanceof SyntaxError
					? "Invalid JSON"
					: error instanceof Error
						? error.message
						: String(error),
		};
	}

	const parsed = parseBackupDocument(raw, options.scope);
	if (!parsed.ok) {
		return { status: "error", message: parsed.message };
	}

	const localProfiles = options.getLocalProfiles();
	const backupHasProfiles =
		backupScopeIncludesPreferences(options.scope) &&
		parsed.value.settingsProfiles !== undefined;
	const localHasProfiles = localProfiles.profiles.length > 0;

	if (
		backupHasProfiles &&
		localHasProfiles &&
		!options.profilesOverwriteConfirmed
	) {
		const backupProfileNames =
			parsed.value.settingsProfiles?.profiles.map((p) => p.name) ?? [];
		const localProfileNames = localProfiles.profiles.map((p) => p.name);
		return {
			status: "needs-profiles-confirm",
			path: filePath,
			backupProfileNames,
			localProfileNames,
		};
	}

	try {
		options.apply(parsed.value);
		return { status: "imported", path: filePath };
	} catch (error) {
		return {
			status: "error",
			message: error instanceof Error ? error.message : String(error),
		};
	}
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
