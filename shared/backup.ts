/**
 * Backup envelope scope matrix (v1):
 *
 * Scope          | preferences | blinkStats | settingsProfiles (when any saved)
 * ---------------|-------------|------------|----------------------------------
 * preferences    | yes         | no         | yes
 * statistics     | no          | yes        | no
 * both           | yes         | yes        | yes
 *
 * Import subset: requesting `preferences` from a `both`-scoped file still
 * restores `settingsProfiles` when the field is present. Missing field = skip
 * (local Setups unchanged). Named Setups stay in the third store — not merged
 * into preferences or stats.
 */
import {
	normalizeBlinkStatsState,
	type BlinkStatsState,
} from "./blink-stats";
import {
	sanitizePersistedPreferences,
	type PersistedPreferences,
} from "./preferences";
import {
	sanitizeSettingsProfilesState,
	type SettingsProfilesState,
} from "./settings-profiles";

export const BACKUP_SCHEMA = "blinkguard-backup" as const;
export const BACKUP_VERSION = 1 as const;

export type BackupScope = "preferences" | "statistics" | "both";

export type BackupDocument = {
	schema: typeof BACKUP_SCHEMA;
	version: typeof BACKUP_VERSION;
	exportedAt: string;
	appVersion: string;
	scope: BackupScope;
	preferences?: PersistedPreferences;
	blinkStats?: BlinkStatsState;
	/** Named Setups from blinkguard-settings-profiles.json; omitted when empty. */
	settingsProfiles?: SettingsProfilesState;
};

export type ExportBackupStatus = "saved" | "cancelled" | "error";

export interface ExportBackupResult {
	status: ExportBackupStatus;
	path?: string;
	message?: string;
}

export type ImportBackupStatus =
	| "imported"
	| "cancelled"
	| "error"
	| "needs-profiles-confirm";

export interface ImportBackupResult {
	status: ImportBackupStatus;
	path?: string;
	message?: string;
	backupProfileNames?: string[];
	localProfileNames?: string[];
}

export type ParsedBackup = {
	preferences?: PersistedPreferences;
	blinkStats?: BlinkStatsState;
	settingsProfiles?: SettingsProfilesState;
};

export type ParseBackupError = {
	ok: false;
	message: string;
};

export type ParseBackupSuccess = {
	ok: true;
	value: ParsedBackup;
};

export type ParseBackupResult = ParseBackupError | ParseBackupSuccess;

export function backupScopeIncludesPreferences(scope: BackupScope): boolean {
	return scope === "preferences" || scope === "both";
}

export function backupScopeIncludesStatistics(scope: BackupScope): boolean {
	return scope === "statistics" || scope === "both";
}

export function isBackupScope(value: unknown): value is BackupScope {
	return (
		value === "preferences" || value === "statistics" || value === "both"
	);
}

export function buildBackupDocument(options: {
	scope: BackupScope;
	appVersion: string;
	exportedAt?: Date;
	preferences?: PersistedPreferences;
	blinkStats?: BlinkStatsState;
	settingsProfiles?: SettingsProfilesState;
}): BackupDocument {
	const exportedAt = (options.exportedAt ?? new Date()).toISOString();
	const document: BackupDocument = {
		schema: BACKUP_SCHEMA,
		version: BACKUP_VERSION,
		exportedAt,
		appVersion: options.appVersion,
		scope: options.scope,
	};
	if (backupScopeIncludesPreferences(options.scope)) {
		if (!options.preferences) {
			throw new Error("preferences required for preferences backup scope");
		}
		document.preferences = options.preferences;
		const profiles = options.settingsProfiles;
		if (profiles && profiles.profiles.length > 0) {
			document.settingsProfiles = profiles;
		}
	}
	if (backupScopeIncludesStatistics(options.scope)) {
		if (!options.blinkStats) {
			throw new Error("blinkStats required for statistics backup scope");
		}
		document.blinkStats = options.blinkStats;
	}
	return document;
}

/**
 * Strict backup parse for import. Rejects envelope/structure errors before any store writes.
 * Soft field sanitization applies only after structural checks pass.
 */
export function parseBackupDocument(
	raw: unknown,
	requestedScope: BackupScope,
): ParseBackupResult {
	if (!isBackupScope(requestedScope)) {
		return { ok: false, message: "Invalid backup scope" };
	}
	if (!raw || typeof raw !== "object") {
		return { ok: false, message: "Backup must be a JSON object" };
	}
	const record = raw as Record<string, unknown>;
	if (record.schema !== BACKUP_SCHEMA) {
		return { ok: false, message: "Unsupported or missing backup schema" };
	}
	if (record.version !== BACKUP_VERSION) {
		return { ok: false, message: "Unsupported backup version" };
	}

	const result: ParsedBackup = {};

	if (backupScopeIncludesPreferences(requestedScope)) {
		if (!record.preferences || typeof record.preferences !== "object") {
			return {
				ok: false,
				message: "Backup is missing preferences for the selected scope",
			};
		}
		result.preferences = sanitizePersistedPreferences(record.preferences, {
			forceIsTrackingFalse: true,
		});
		if (record.settingsProfiles !== undefined) {
			result.settingsProfiles = sanitizeSettingsProfilesState(
				record.settingsProfiles,
			);
		}
	}

	if (backupScopeIncludesStatistics(requestedScope)) {
		if (!record.blinkStats || typeof record.blinkStats !== "object") {
			return {
				ok: false,
				message: "Backup is missing statistics for the selected scope",
			};
		}
		const statsRecord = record.blinkStats as Record<string, unknown>;
		if (!Array.isArray(statsRecord.days)) {
			return {
				ok: false,
				message: "Backup statistics must include a days array",
			};
		}
		result.blinkStats = normalizeBlinkStatsState(record.blinkStats);
	}

	return { ok: true, value: result };
}
