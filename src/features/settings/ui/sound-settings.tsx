import { Play, Volume2, VolumeX } from "lucide-react";
import { useEffect, useRef } from "react";
import { Button } from "@/components/button";
import { RangeSlider } from "@/components/range-slider";
import { Reveal } from "@/components/reveal";
import { SettingPanel } from "@/components/setting-panel";
import { SettingRow } from "@/components/setting-row";
import { ToggleSwitch } from "@/components/toggle-switch";
import { useT } from "@/i18n";
import { rendererIpc } from "@/shared/ipc/renderer-ipc";
import type { SettingsPreferences } from "../model/preferences";
import type { SetPreferences } from "../model/use-preferences";

interface SoundSettingsProps {
	preferences: SettingsPreferences;
	setPreferences: SetPreferences;
}

export function SoundSettings({
	preferences,
	setPreferences,
}: SoundSettingsProps) {
	const t = useT();
	const volume = preferences.soundVolume;
	const previewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	useEffect(() => {
		return () => {
			if (previewTimerRef.current) clearTimeout(previewTimerRef.current);
		};
	}, []);

	const previewBlinkAt = (nextVolume: number) => {
		if (previewTimerRef.current) clearTimeout(previewTimerRef.current);
		previewTimerRef.current = setTimeout(() => {
			rendererIpc.debugPreviewSound("blink", nextVolume);
		}, 250);
	};

	const playTestNow = () => {
		if (previewTimerRef.current) clearTimeout(previewTimerRef.current);
		rendererIpc.debugPreviewSound("blink", volume);
	};

	return (
		<SettingPanel>
			<SettingRow
				title={
					<>
						{preferences.soundEnabled ? (
							<Volume2 className="h-4 w-4 text-muted-foreground" aria-hidden />
						) : (
							<VolumeX className="h-4 w-4 text-muted-foreground" aria-hidden />
						)}
						{t("sound.title")}
					</>
				}
				description={t("sound.description")}
				action={
					<ToggleSwitch
						aria-label={t("sound.toggleAria")}
						checked={preferences.soundEnabled}
						onChange={() =>
							setPreferences((current) => ({
								...current,
								soundEnabled: !current.soundEnabled,
							}))
						}
					/>
				}
			>
				<Reveal open={preferences.soundEnabled}>
					<div className="flex items-center gap-3">
						<label
							htmlFor="sound-volume"
							className="shrink-0 text-sm text-muted-foreground"
						>
							{t("sound.volume")}
						</label>
						<RangeSlider
							id="sound-volume"
							aria-label={t("sound.volumeAria")}
							min={0}
							max={100}
							value={volume}
							onChange={(nextVolume) => {
								setPreferences((current) => ({
									...current,
									soundVolume: nextVolume,
								}));
								previewBlinkAt(nextVolume);
							}}
							className="h-1.5 flex-1"
						/>
						<div className="min-w-[3.25rem] rounded-md bg-accent px-2 py-1 text-center text-sm font-semibold text-accent-foreground">
							{volume}%
						</div>
						<Button
							type="button"
							variant="secondary"
							size="sm"
							className="gap-1.5"
							aria-label={t("sound.testAria")}
							onClick={playTestNow}
						>
							<Play className="h-3.5 w-3.5" aria-hidden />
							{t("sound.test")}
						</Button>
					</div>
				</Reveal>
			</SettingRow>
		</SettingPanel>
	);
}
