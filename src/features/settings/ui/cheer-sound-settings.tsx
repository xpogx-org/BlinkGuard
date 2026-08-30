import { useMemo } from "react";
import { Button } from "@/components/button";
import { SettingPanel } from "@/components/setting-panel";
import { SettingRow } from "@/components/setting-row";
import { useBlinkStats } from "@/features/statistics/model/use-blink-stats";
import { useT } from "@/i18n";
import {
	type CheerThemeId,
	FREE_EQUIP_CHEER_THEME_IDS,
} from "../../../../shared/cheer-themes";

export function CheerSoundSettings() {
	const t = useT();
	const { snapshot, equipCheerTheme } = useBlinkStats();
	const { equippedCheerTheme, unlockedCheerThemeIds } = snapshot;

	const equippableCheerThemes = useMemo(() => {
		const shop = unlockedCheerThemeIds.filter(
			(id) => !(FREE_EQUIP_CHEER_THEME_IDS as readonly string[]).includes(id),
		);
		return [...FREE_EQUIP_CHEER_THEME_IDS, ...shop];
	}, [unlockedCheerThemeIds]);

	return (
		<SettingPanel>
			<SettingRow
				title={t("rewards.cheerSound")}
				description={t("rewards.cheerSoundDesc")}
			>
				<div className="flex flex-wrap gap-2">
					<Button
						type="button"
						variant={equippedCheerTheme === "random" ? "default" : "secondary"}
						size="sm"
						onClick={() => equipCheerTheme("random")}
					>
						{t("rewards.cheerTheme.random")}
					</Button>
					{equippableCheerThemes.map((themeId) => (
						<Button
							key={themeId}
							type="button"
							variant={equippedCheerTheme === themeId ? "default" : "secondary"}
							size="sm"
							onClick={() => equipCheerTheme(themeId)}
						>
							{t(`rewards.cheerTheme.${themeId as CheerThemeId}`)}
						</Button>
					))}
				</div>
			</SettingRow>
		</SettingPanel>
	);
}
