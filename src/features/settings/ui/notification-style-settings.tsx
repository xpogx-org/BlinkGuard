import { Select } from "@/components/select";
import { SettingPanel } from "@/components/setting-panel";
import { SettingRow } from "@/components/setting-row";
import { useT } from "@/i18n";
import { isNotificationStyleValue } from "../../../../shared/notification-style";
import type { SettingsPreferences } from "../model/preferences";
import type { SetPreferences } from "../model/use-preferences";

interface NotificationStyleSettingsProps {
	preferences: SettingsPreferences;
	setPreferences: SetPreferences;
}

export function NotificationStyleSettings({
	preferences,
	setPreferences,
}: NotificationStyleSettingsProps) {
	const t = useT();
	return (
		<SettingPanel>
			<SettingRow
				title={t("notifications.style.title")}
				description={t("notifications.style.description")}
				action={
					<Select
						aria-label={t("notifications.style.aria")}
						value={preferences.notificationStyle}
						onChange={(next) => {
							if (!isNotificationStyleValue(next)) return;
							setPreferences((current) => ({
								...current,
								notificationStyle: next,
							}));
						}}
						className="max-w-[12.5rem]"
						options={[
							{ value: "overlay", label: t("notifications.style.overlay") },
							{ value: "native", label: t("notifications.style.native") },
							{ value: "both", label: t("notifications.style.both") },
						]}
					/>
				}
			/>
		</SettingPanel>
	);
}
