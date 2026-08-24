import { Activity, Clock, Moon, Play, Square } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import { Button } from "@/components/button";
import { RangeSlider } from "@/components/range-slider";
import { Select } from "@/components/select";
import { SettingGrid } from "@/components/setting-grid";
import { SettingPanel } from "@/components/setting-panel";
import { SettingRow } from "@/components/setting-row";
import type { SettingsPreferences } from "@/features/settings/model/preferences";
import { useI18n } from "@/i18n";
import { pluralKey } from "../../../../shared/i18n";
import type { BlinkPromptProfile } from "../../../../shared/preferences";

interface ReminderControlsProps {
	preferences: SettingsPreferences;
	setPreferences: Dispatch<SetStateAction<SettingsPreferences>>;
	onIntervalChange: (seconds: number) => void;
	onToggleTracking: () => void;
}

function formatBlinksPerMinute(intervalSeconds: number): string {
	const rate = 60 / intervalSeconds;
	return Number.isInteger(rate) ? String(rate) : rate.toFixed(1);
}

function isBlinkPromptProfile(value: string): value is BlinkPromptProfile {
	return value === "standard" || value === "gentle" || value === "strong";
}

export function ReminderControls({
	preferences,
	setPreferences,
	onIntervalChange,
	onToggleTracking,
}: ReminderControlsProps) {
	const { t, locale } = useI18n();
	const cameraOn = preferences.cameraEnabled;
	const intervalSeconds = cameraOn
		? preferences.reminderInterval
		: preferences.microBreakInterval;
	const blinksPerMinute = 60 / intervalSeconds;
	const formattedRate = formatBlinksPerMinute(intervalSeconds);
	const inTypicalRange = blinksPerMinute >= 15 && blinksPerMinute <= 20;
	const snoozeMinutes = preferences.snoozeMinutes;
	const snoozeDescKey = pluralKey(
		"reminders.snoozeDesc",
		locale,
		snoozeMinutes,
	);
	const profileDescKey =
		preferences.blinkPromptProfile === "gentle"
			? "reminders.profile.gentleDesc"
			: preferences.blinkPromptProfile === "strong"
				? "reminders.profile.strongDesc"
				: "reminders.profile.standardDesc";

	return (
		<>
			<SettingGrid>
				<SettingPanel className="flex h-full flex-col">
					<SettingRow
						title={
							<>
								<Clock className="h-4 w-4 text-muted-foreground" aria-hidden />
								<label htmlFor="reminder-interval">
									{t("reminders.interval")}
								</label>
							</>
						}
						description={
							cameraOn ? t("reminders.desc.camera") : t("reminders.desc.timer")
						}
					/>
					<div className="mt-auto flex flex-col items-center gap-3 pt-3 sm:flex-row sm:items-end sm:gap-4">
						<div className="flex min-h-9 min-w-0 w-full flex-1 items-center gap-3">
							<RangeSlider
								id="reminder-interval"
								aria-label={t("reminders.intervalAria")}
								min={cameraOn ? 1 : 15}
								max={cameraOn ? 10 : 120}
								value={intervalSeconds}
								onChange={(next) => {
									if (cameraOn) {
										onIntervalChange(next);
										return;
									}
									setPreferences((current) => ({
										...current,
										microBreakInterval: next,
									}));
								}}
								className="min-w-0 flex-1"
							/>
							<div className="min-w-[4.5rem] shrink-0 rounded-md bg-accent px-3 py-1 text-center text-sm font-semibold text-accent-foreground">
								{intervalSeconds}s
							</div>
						</div>
						<div className="relative flex w-[5.75rem] shrink-0 flex-col items-center">
							{preferences.isTracking ? (
								<div className="absolute bottom-full left-1/2 mb-1 flex -translate-x-1/2 items-center justify-center gap-1 whitespace-nowrap text-xs font-medium text-primary">
									<Activity className="h-3 w-3" aria-hidden />
									<span>{t("common.active")}</span>
								</div>
							) : null}
							<Button
								type="button"
								variant={preferences.isTracking ? "destructive" : "default"}
								onClick={onToggleTracking}
								className="w-full gap-2 whitespace-nowrap"
							>
								{preferences.isTracking ? (
									<>
										<Square className="h-4 w-4" aria-hidden />
										{t("common.stop")}
									</>
								) : (
									<>
										<Play className="h-4 w-4" aria-hidden />
										{t("common.start")}
									</>
								)}
							</Button>
						</div>
					</div>
				</SettingPanel>

				<SettingPanel className="flex h-full flex-col">
					<SettingRow
						title={
							<>
								<Moon className="h-4 w-4 text-muted-foreground" aria-hidden />
								<label htmlFor="snooze-minutes">{t("reminders.snooze")}</label>
							</>
						}
						description={t(snoozeDescKey, { n: snoozeMinutes })}
					/>
					<div className="mt-auto flex min-h-9 items-center gap-2 pt-3">
						<RangeSlider
							id="snooze-minutes"
							aria-label={t("reminders.snoozeAria")}
							min={1}
							max={30}
							value={snoozeMinutes}
							onChange={(next) =>
								setPreferences((current) => ({
									...current,
									snoozeMinutes: next,
								}))
							}
							className="min-w-0 flex-1"
						/>
						<div className="min-w-[2.5rem] text-center text-xs font-medium text-primary">
							{snoozeMinutes}m
						</div>
					</div>
				</SettingPanel>
			</SettingGrid>

			<SettingPanel>
				<SettingRow
					title={t("reminders.profile.title")}
					description={t("reminders.profile.description")}
					action={
						<Select
							aria-label={t("reminders.profile.aria")}
							value={preferences.blinkPromptProfile}
							onChange={(next) => {
								if (!isBlinkPromptProfile(next)) return;
								setPreferences((current) => ({
									...current,
									blinkPromptProfile: next,
								}));
							}}
							options={[
								{
									value: "gentle",
									label: t("reminders.profile.gentle"),
									description: t("reminders.profile.gentleShort"),
								},
								{
									value: "standard",
									label: t("reminders.profile.standard"),
									description: t("reminders.profile.standardShort"),
								},
								{
									value: "strong",
									label: t("reminders.profile.strong"),
									description: t("reminders.profile.strongShort"),
								},
							]}
						/>
					}
				>
					<p className="text-xs text-muted-foreground sm:text-sm">
						{t(profileDescKey)}
					</p>
				</SettingRow>
			</SettingPanel>

			<aside
				role="status"
				className="rounded-md bg-accent/60 p-3 text-xs text-muted-foreground sm:text-sm"
			>
				<p>
					<span className="font-semibold text-foreground">
						{t("reminders.rateSummary", { rate: formattedRate })}
					</span>
					{" — "}
					{cameraOn && !preferences.mgdMode
						? t("reminders.rateHint.camera")
						: t("reminders.rateHint.timer")}
				</p>
				{inTypicalRange ? (
					<p className="mt-1.5 text-primary">{t("reminders.inTypicalRange")}</p>
				) : null}
			</aside>

			<aside className="rounded-md bg-accent/60 p-3 text-xs text-muted-foreground sm:text-sm">
				<p className="mb-2 font-semibold text-foreground">
					{t("reminders.guidanceTitle")}
				</p>
				<ul className="list-disc space-y-1.5 pl-4">
					<li>
						{t("reminders.guidance.1", {
							resting: t("reminders.guidance.1.resting"),
							focused: t("reminders.guidance.1.focused"),
						})}
					</li>
					<li>
						{t("reminders.guidance.2", {
							women: t("reminders.guidance.2.women"),
							men: t("reminders.guidance.2.men"),
						})}
					</li>
					<li>
						{t("reminders.guidance.3.before")}
						<span className="font-medium text-foreground">
							{t("reminders.guidance.3.complete")}
						</span>
						{t("reminders.guidance.3.after")}
						<span className="font-medium text-foreground">
							{t("reminders.guidance.3.mgd")}
						</span>
						{t("reminders.guidance.3.afterMgd")}
					</li>
				</ul>
				<p className="mt-2 text-2xs opacity-80 sm:text-xs">
					{t("reminders.guidance.disclaimer")}
				</p>
			</aside>
		</>
	);
}
