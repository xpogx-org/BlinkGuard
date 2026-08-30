import { Button } from "@/components/button";
import { SettingPanel } from "@/components/setting-panel";
import { SettingRow } from "@/components/setting-row";
import { useBlinkStats } from "@/features/statistics/model/use-blink-stats";
import { useT } from "@/i18n";
import {
	POPUP_PRESET_IDS,
	POPUP_PRESETS,
} from "../../../../shared/popup-presets";

export function PopupPresetSettings() {
	const t = useT();
	const { snapshot, equipPopupPreset, clearPopupPreset } = useBlinkStats();
	const { equippedPopupPresetId, unlockedPopupPresetIds } = snapshot;

	return (
		<SettingPanel>
			<SettingRow
				title={t("rewards.popupColors")}
				description={t("rewards.popupColorsDesc")}
			>
				<div className="flex flex-wrap gap-2">
					<Button
						type="button"
						variant={equippedPopupPresetId == null ? "default" : "secondary"}
						size="sm"
						onClick={() => clearPopupPreset()}
					>
						{t("rewards.popupPreset.custom")}
					</Button>
					{POPUP_PRESET_IDS.map((presetId) => {
						const preset = POPUP_PRESETS[presetId];
						const unlocked = unlockedPopupPresetIds.includes(presetId);
						const isActive = equippedPopupPresetId === presetId;
						const titleKey =
							presetId === "aurora"
								? "rewards.popupPresetAurora"
								: "rewards.popupPresetSunset";

						return (
							<Button
								key={presetId}
								type="button"
								variant={isActive ? "default" : "secondary"}
								size="sm"
								disabled={!unlocked}
								title={
									unlocked ? undefined : t("rewards.popupPreset.lockedHint")
								}
								className="gap-2"
								onClick={() => {
									if (unlocked) equipPopupPreset(presetId);
								}}
							>
								<span
									className="inline-block h-3 w-3 shrink-0 rounded-full border border-border"
									style={{ backgroundColor: preset.colors.background }}
									aria-hidden
								/>
								{t(titleKey)}
							</Button>
						);
					})}
				</div>
			</SettingRow>
		</SettingPanel>
	);
}
