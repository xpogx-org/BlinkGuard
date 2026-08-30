import { ToggleSwitch } from "@/components/toggle-switch";
import { SettingPanel } from "@/components/setting-panel";
import { SettingRow } from "@/components/setting-row";
import { useT } from "@/i18n";
import type { SettingsPreferences } from "../model/preferences";
import type { SetPreferences } from "../model/use-preferences";

interface SessionRecapSettingsProps {
	preferences: SettingsPreferences;
	setPreferences: SetPreferences;
}

export function SessionRecapSettings({
	preferences,
	setPreferences,
}: SessionRecapSettingsProps) {
	const t = useT();
	return (
		<SettingPanel>
			<SettingRow
				title={t("settings.sessionRecap.title")}
				description={t("settings.sessionRecap.description")}
				action={
					<ToggleSwitch
						aria-label={t("settings.sessionRecap.toggleAria")}
						checked={preferences.sessionRecapEnabled}
						onChange={() =>
							setPreferences((current) => ({
								...current,
								sessionRecapEnabled: !current.sessionRecapEnabled,
							}))
						}
					/>
				}
			/>
		</SettingPanel>
	);
}
