import { sanitizeCameraDevice, sameCameraDevice } from "../../shared/camera-devices";
import {
	sanitizeClassifierBias,
	sanitizeClassifierThreshold,
} from "../../shared/classifier-calibration";
import { sanitizeNotificationStyle } from "../../shared/notification-style";
import {
	DEFAULT_PREFERENCES,
	sameKeyboardShortcuts,
	samePauseAppRules,
	samePopupPositionsByDisplayId,
	samePopupSizesByDisplayId,
	sameQuietHoursByWeekday,
	sanitizeAutoStopNoFaceMinutes,
	sanitizeBlinkRateThresholdPerMin,
	sanitizeEpochMs,
	sanitizeExercisePrompts,
	sanitizeKeyboardShortcuts,
	sanitizeLookAwayHint,
	sanitizeLookAwayTitle,
	sanitizeAppearance,
	sanitizePauseAppRules,
	sanitizePersistedPreferences,
	sanitizePopupPositionsByDisplayId,
	sanitizePopupSizesByDisplayId,
	sanitizeQuietHoursByWeekday,
	sanitizeSnoozeMinutes,
	sanitizeSoundVolume,
	seedPopupPositionsFromLegacy,
	seedPopupSizesFromPositionIds,
	type AppPreferences,
	type KeyboardShortcuts,
	type PersistedPreferences,
	type Point,
	type QuietHoursByWeekday,
	type Size,
} from "../../shared/preferences";
import {
	SNAPSHOT_KEYS,
	overlaySettingsProfilePrefs,
} from "../../shared/settings-profiles";
import { sanitizeLocale } from "../../shared/i18n";
import type { PreferenceStore } from "./ports/preference-store";

const PERSISTED_KEYS = Object.keys(
	DEFAULT_PREFERENCES,
) as (keyof PersistedPreferences)[];

function samePreferenceValue(
	key: keyof PersistedPreferences,
	previous: PersistedPreferences[keyof PersistedPreferences],
	next: PersistedPreferences[keyof PersistedPreferences],
): boolean {
	if (previous === next) return true;
	if (key === "exercisePrompts") {
		const a = previous as string[];
		const b = next as string[];
		return (
			Array.isArray(a) &&
			Array.isArray(b) &&
			a.length === b.length &&
			a.every((value, index) => value === b[index])
		);
	}
	if (key === "popupColors") {
		const a = previous as PersistedPreferences["popupColors"];
		const b = next as PersistedPreferences["popupColors"];
		return (
			!!a &&
			!!b &&
			a.background === b.background &&
			a.text === b.text &&
			a.transparency === b.transparency
		);
	}
	if (key === "popupPosition") {
		const a = previous as PersistedPreferences["popupPosition"];
		const b = next as PersistedPreferences["popupPosition"];
		if (a === b) return true;
		if (!a || !b) return false;
		return a.x === b.x && a.y === b.y;
	}
	if (key === "popupPositionsByDisplayId") {
		return samePopupPositionsByDisplayId(
			previous as Record<string, Point>,
			next as Record<string, Point>,
		);
	}
	if (key === "popupSizesByDisplayId") {
		return samePopupSizesByDisplayId(
			previous as Record<string, Size>,
			next as Record<string, Size>,
		);
	}
	if (key === "popupSize") {
		const a = previous as PersistedPreferences["popupSize"];
		const b = next as PersistedPreferences["popupSize"];
		return !!a && !!b && a.width === b.width && a.height === b.height;
	}
	if (key === "keyboardShortcuts") {
		return sameKeyboardShortcuts(
			previous as KeyboardShortcuts,
			next as KeyboardShortcuts,
		);
	}
	if (key === "pauseAppRules") {
		return samePauseAppRules(
			previous as PersistedPreferences["pauseAppRules"],
			next as PersistedPreferences["pauseAppRules"],
		);
	}
	if (key === "quietHoursByWeekday") {
		return sameQuietHoursByWeekday(
			previous as QuietHoursByWeekday,
			next as QuietHoursByWeekday,
		);
	}
	if (key === "cameraDevice") {
		return sameCameraDevice(
			previous as PersistedPreferences["cameraDevice"],
			next as PersistedPreferences["cameraDevice"],
		);
	}
	return false;
}

export class PreferencesService {
	readonly current: AppPreferences;

	constructor(private readonly store: PreferenceStore) {
		const loaded: Record<string, unknown> = { ...DEFAULT_PREFERENCES };
		for (const key of PERSISTED_KEYS) {
			if (key === "keyboardShortcuts") {
				// Omit default map when absent so sanitize can migrate legacy
				// `keyboardShortcut` → `trackingToggle`.
				if (this.store.has("keyboardShortcuts")) {
					loaded.keyboardShortcuts = this.store.get(
						"keyboardShortcuts",
						DEFAULT_PREFERENCES.keyboardShortcuts,
					);
				} else {
					delete loaded.keyboardShortcuts;
				}
				continue;
			}
			if (key === "appearance") {
				// Omit default System when absent so sanitize can map legacy
				// `darkMode` boolean (true→Dark, false→Light).
				if (this.store.has("appearance")) {
					loaded.appearance = this.store.get(
						"appearance",
						DEFAULT_PREFERENCES.appearance,
					);
				} else {
					delete loaded.appearance;
				}
				continue;
			}
			loaded[key] = this.store.get(key, DEFAULT_PREFERENCES[key]);
		}
		if (
			!this.store.has("keyboardShortcuts") &&
			this.store.has("keyboardShortcut")
		) {
			loaded.keyboardShortcut = this.store.get("keyboardShortcut", "");
		}
		if (!this.store.has("appearance") && this.store.has("darkMode")) {
			loaded.darkMode = this.store.get("darkMode");
		}
		const persisted = sanitizePersistedPreferences(loaded);

		// Upgrade: existing installs without the flag should skip first-run.
		if (!this.store.has("hasCompletedOnboarding")) {
			const looksLikeExistingUser =
				PERSISTED_KEYS.some(
					(key) =>
						key !== "hasCompletedOnboarding" && this.store.has(key),
				) ||
				this.store.has("keyboardShortcut") ||
				this.store.has("darkMode");
			if (looksLikeExistingUser) {
				persisted.hasCompletedOnboarding = true;
				this.store.set("hasCompletedOnboarding", true);
			}
		}

		// Persist migrated map only when upgrading from legacy `keyboardShortcut`.
		// Do not write defaults on a fresh store — that would trip the
		// hasCompletedOnboarding upgrade heuristic on the next launch.
		if (
			!this.store.has("keyboardShortcuts") &&
			this.store.has("keyboardShortcut")
		) {
			this.store.set("keyboardShortcuts", persisted.keyboardShortcuts);
		}
		if (!this.store.has("appearance") && this.store.has("darkMode")) {
			this.store.set("appearance", persisted.appearance);
			this.store.delete?.("darkMode");
		}

		this.current = { ...persisted };
	}

	set<K extends keyof PersistedPreferences>(
		key: K,
		value: PersistedPreferences[K],
	): void {
		let next = value;
		if (key === "locale") {
			next = sanitizeLocale(value) as PersistedPreferences[K];
		} else if (key === "appearance") {
			next = sanitizeAppearance(value) as PersistedPreferences[K];
		} else if (key === "notificationStyle") {
			next = sanitizeNotificationStyle(value) as PersistedPreferences[K];
		} else if (key === "exercisePrompts") {
			next = sanitizeExercisePrompts(
				value,
				this.current.locale,
			) as PersistedPreferences[K];
		} else if (key === "lookAwayTitle") {
			next = sanitizeLookAwayTitle(
				value,
				this.current.locale,
			) as PersistedPreferences[K];
		} else if (key === "lookAwayHint") {
			next = sanitizeLookAwayHint(
				value,
				this.current.locale,
			) as PersistedPreferences[K];
		} else if (key === "blinkRateThresholdPerMin") {
			next = sanitizeBlinkRateThresholdPerMin(
				value,
			) as PersistedPreferences[K];
		} else if (key === "autoStopNoFaceMinutes") {
			next = sanitizeAutoStopNoFaceMinutes(
				value,
			) as PersistedPreferences[K];
		} else if (key === "snoozeMinutes") {
			next = sanitizeSnoozeMinutes(value) as PersistedPreferences[K];
		} else if (key === "soundVolume") {
			next = sanitizeSoundVolume(value) as PersistedPreferences[K];
		} else if (key === "keyboardShortcuts") {
			next = sanitizeKeyboardShortcuts(value) as PersistedPreferences[K];
		} else if (key === "classifierBias") {
			next = sanitizeClassifierBias(value) as PersistedPreferences[K];
		} else if (key === "classifierThreshold") {
			next = sanitizeClassifierThreshold(value) as PersistedPreferences[K];
		} else if (key === "pauseAppRules") {
			next = sanitizePauseAppRules(value) as PersistedPreferences[K];
		} else if (key === "quietHoursByWeekday") {
			next = sanitizeQuietHoursByWeekday(value) as PersistedPreferences[K];
		} else if (key === "cameraDevice") {
			next = sanitizeCameraDevice(value) as PersistedPreferences[K];
		} else if (key === "popupPositionsByDisplayId") {
			next = sanitizePopupPositionsByDisplayId(
				value,
			) as PersistedPreferences[K];
		} else if (key === "popupSizesByDisplayId") {
			next = sanitizePopupSizesByDisplayId(value) as PersistedPreferences[K];
		} else if (
			key === "calibrationAt" ||
			key === "calibrationNudgeDismissedAt" ||
			key === "lastBaselineDriftAt"
		) {
			next = sanitizeEpochMs(value) as PersistedPreferences[K];
		}
		// No-op equal writes: settings sync and dual IPC callers re-send often.
		if (samePreferenceValue(key, this.current[key], next)) {
			return;
		}
		this.current[key] = next as never;
		this.store.set(key, next);
	}

	/**
	 * Seed `popupPositionsByDisplayId` from legacy `popupPosition` when the map
	 * is empty. Returns true when the map was written.
	 */
	seedPopupPositionsFromLegacy(seedDisplayId: string): boolean {
		const next = seedPopupPositionsFromLegacy(
			this.current.popupPositionsByDisplayId,
			this.current.popupPosition,
			seedDisplayId,
		);
		if (
			samePopupPositionsByDisplayId(
				next,
				this.current.popupPositionsByDisplayId,
			)
		) {
			return false;
		}
		this.set("popupPositionsByDisplayId", next);
		return true;
	}

	/**
	 * Seed `popupSizesByDisplayId` from the size mirror when the map is empty.
	 * Uses ids already in the position map. Returns true when the map was written.
	 */
	seedPopupSizesFromPositionIds(): boolean {
		const next = seedPopupSizesFromPositionIds(
			this.current.popupSizesByDisplayId,
			Object.keys(this.current.popupPositionsByDisplayId),
			this.current.popupSize,
		);
		if (
			samePopupSizesByDisplayId(next, this.current.popupSizesByDisplayId)
		) {
			return false;
		}
		this.set("popupSizesByDisplayId", next);
		return true;
	}

	/**
	 * Overlay a settings-profile snapshot onto live prefs via per-key `set`.
	 * Never clears the store; excluded keys stay unchanged.
	 */
	applyProfileSnapshot(snapshot: unknown): void {
		const next = overlaySettingsProfilePrefs(this.current, snapshot);
		for (const key of SNAPSHOT_KEYS) {
			this.set(key, next[key]);
		}
	}

	/**
	 * Replace all persisted preferences from a sanitized backup payload.
	 * Caller should pass output of sanitizePersistedPreferences (with forceIsTrackingFalse).
	 */
	replaceFromBackup(preferences: PersistedPreferences): void {
		const next = sanitizePersistedPreferences(preferences, {
			forceIsTrackingFalse: true,
		});
		this.store.clear();
		Object.assign(this.current, next);
		for (const key of PERSISTED_KEYS) {
			this.store.set(key, this.current[key]);
		}
	}

	reset(
		popupPosition: PersistedPreferences["popupPosition"],
		options?: { replayOnboarding?: boolean },
	): void {
		this.store.clear();
		Object.assign(this.current, DEFAULT_PREFERENCES, {
			popupPosition,
		});
		if (!options?.replayOnboarding) {
			this.set("hasCompletedOnboarding", true);
		}
	}
}
