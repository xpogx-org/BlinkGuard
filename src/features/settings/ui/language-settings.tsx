import { Select } from "@/components/select";
import { SettingPanel } from "@/components/setting-panel";
import { SettingRow } from "@/components/setting-row";
import { useT } from "@/i18n";
import type { Locale } from "../../../../shared/i18n";
import { applyLocale } from "../model/apply-locale";
import type { SettingsPreferences } from "../model/preferences";
import type { SetPreferences } from "../model/use-preferences";

interface LanguageSettingsProps {
	preferences: SettingsPreferences;
	setPreferences: SetPreferences;
}

export function LanguageSettings({
	preferences,
	setPreferences,
}: LanguageSettingsProps) {
	const t = useT();
	return (
		<SettingPanel>
			<SettingRow
				title={t("language.title")}
				description={t("language.description")}
				action={
					<Select
						aria-label={t("language.toggleAria")}
						value={preferences.locale}
						onChange={(next) => {
							setPreferences((current) => applyLocale(current, next as Locale));
						}}
						options={[
							{ value: "en", label: t("language.en") },
							{ value: "uk", label: t("language.uk") },
						]}
					/>
				}
			/>
		</SettingPanel>
	);
}
