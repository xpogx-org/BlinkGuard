import { useCameraStatus } from "@/features/camera/model/use-camera-status";
import { usePreferences } from "@/features/settings/model/use-preferences";
import { SettingsShell } from "@/features/settings/ui/settings-shell";
import { useShortcutControls } from "@/features/shortcuts/model/use-shortcut-controls";
import { I18nProvider } from "@/i18n";

export default function BlinkGuardHomepage() {
	const {
		preferences,
		setPreferences,
		prefsHydrated,
		toggleTracking,
		changeReminderInterval,
	} = usePreferences();
	const camera = useCameraStatus();
	const shortcuts = useShortcutControls({
		preferences,
		setPreferences,
		toggleTracking,
	});

	return (
		<I18nProvider locale={preferences.locale}>
			<SettingsShell
				preferences={preferences}
				setPreferences={setPreferences}
				prefsHydrated={prefsHydrated}
				toggleTracking={toggleTracking}
				changeReminderInterval={changeReminderInterval}
				camera={camera}
				shortcuts={shortcuts}
			/>
		</I18nProvider>
	);
}
