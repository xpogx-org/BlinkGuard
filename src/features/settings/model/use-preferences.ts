import { useEffect, useRef, useState } from "react";
import { rendererIpc } from "@/shared/ipc/renderer-ipc";
import {
	type AppearancePreference,
	type RendererPreferences,
	resolveDarkMode,
} from "../../../../shared/preferences";
import {
	DEFAULT_RENDERER_PREFERENCES,
	type SettingsPreferences,
} from "./preferences";
import { pushPreferenceDiff, sameRendererPrefs } from "./preferences-sync";

export type SetPreferences = React.Dispatch<
	React.SetStateAction<SettingsPreferences>
>;

const PREFERS_DARK = "(prefers-color-scheme: dark)";

function osPrefersDark(): boolean {
	if (typeof window.matchMedia !== "function") return false;
	return window.matchMedia(PREFERS_DARK).matches;
}

function applyAppearanceClass(appearance: AppearancePreference): void {
	document.documentElement.classList.toggle(
		"dark",
		resolveDarkMode(appearance, osPrefersDark()),
	);
}

export function usePreferences() {
	const [preferences, setPreferences] = useState<SettingsPreferences>(
		DEFAULT_RENDERER_PREFERENCES,
	);
	const [prefsHydrated, setPrefsHydrated] = useState(false);
	/** Last snapshot we either received from main or successfully diff-pushed. */
	const lastSyncedRef = useRef<SettingsPreferences | null>(null);
	const lastReminderIntervalRef = useRef<number | null>(null);

	useEffect(
		() =>
			rendererIpc.onPreferences((saved: RendererPreferences) => {
				setPreferences((current) => {
					const merged = { ...current, ...saved };
					// Main is source of truth for echoes (shortcut, reset, locale,
					// calibration). Mark synced so the push effect does not bounce.
					if (sameRendererPrefs(current, merged)) {
						lastSyncedRef.current = current;
						lastReminderIntervalRef.current = current.reminderInterval;
						return current;
					}
					lastSyncedRef.current = merged;
					lastReminderIntervalRef.current = merged.reminderInterval;
					return merged;
				});
				setPrefsHydrated(true);
			}),
		[],
	);

	useEffect(() => {
		// Wait for main → renderer hydrate so defaults do not overwrite the store
		// (e.g. hasCompletedOnboarding: false) or bounce sendPreferences loops.
		if (!prefsHydrated) return;

		const previous = lastSyncedRef.current;
		if (!previous) {
			// First hydrate: main already persisted these values — do not echo-write.
			lastSyncedRef.current = preferences;
			lastReminderIntervalRef.current = preferences.reminderInterval;
			return;
		}
		if (sameRendererPrefs(previous, preferences)) {
			return;
		}
		lastSyncedRef.current = preferences;
		pushPreferenceDiff(previous, preferences);
	}, [preferences, prefsHydrated]);

	useEffect(() => {
		// Splash / `?dark=` owns html.dark until hydrate so DEFAULT System
		// does not flash over an existing explicit Dark/Light store.
		if (!prefsHydrated) return;
		applyAppearanceClass(preferences.appearance);
		if (typeof window.matchMedia !== "function") return;
		const media = window.matchMedia(PREFERS_DARK);
		const onChange = () => applyAppearanceClass(preferences.appearance);
		media.addEventListener("change", onChange);
		return () => media.removeEventListener("change", onChange);
	}, [prefsHydrated, preferences.appearance]);

	useEffect(() => {
		// Same hydrate gate as the prefs sync above — otherwise the default
		// interval is written to the store before loadPreferences arrives.
		// Fires while tracking too so slider changes live-reschedule loops
		// without stopReminders / camera reopen.
		if (!prefsHydrated) return;
		if (lastReminderIntervalRef.current === preferences.reminderInterval) {
			return;
		}
		lastReminderIntervalRef.current = preferences.reminderInterval;
		rendererIpc.updateReminderInterval(preferences.reminderInterval);
	}, [prefsHydrated, preferences.reminderInterval]);

	const toggleTracking = () => {
		setPreferences((current) => ({
			...current,
			isTracking: !current.isTracking,
		}));
		if (preferences.isTracking) {
			rendererIpc.stopReminders();
		} else {
			rendererIpc.startReminders(preferences.reminderInterval);
		}
	};

	const changeReminderInterval = (reminderInterval: number) => {
		setPreferences((current) => ({
			...current,
			reminderInterval,
		}));
	};

	return {
		preferences,
		setPreferences,
		prefsHydrated,
		toggleTracking,
		changeReminderInterval,
	};
}
