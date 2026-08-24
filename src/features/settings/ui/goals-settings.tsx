import { useState } from "react";
import { Badge } from "@/components/badge";
import { Button } from "@/components/button";
import { Reveal } from "@/components/reveal";
import { SettingPanel } from "@/components/setting-panel";
import { SettingRow } from "@/components/setting-row";
import { ToggleSwitch } from "@/components/toggle-switch";
import { useBlinkStats } from "@/features/statistics/model/use-blink-stats";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import type { GoalMetricProgress } from "../../../../shared/blink-stats";
import { pluralKey } from "../../../../shared/i18n";
import { DEFAULT_GOALS_CONFIG } from "../../../../shared/preferences";
import type { SettingsPreferences } from "../model/preferences";
import type { SetPreferences } from "../model/use-preferences";

interface GoalsSettingsProps {
	preferences: SettingsPreferences;
	setPreferences: SetPreferences;
}

function GoalNumberInput({
	id,
	label,
	value,
	onChange,
}: {
	id: string;
	label: string;
	value: number;
	onChange: (value: number) => void;
}) {
	return (
		<label className="flex flex-col gap-1 text-sm">
			<span className="text-muted-foreground">{label}</span>
			<input
				id={id}
				type="number"
				min={0}
				max={100000}
				value={value}
				onChange={(event) => {
					const next = Number.parseInt(event.target.value, 10);
					onChange(Number.isFinite(next) ? Math.max(0, next) : 0);
				}}
				className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-foreground tabular-nums"
			/>
		</label>
	);
}

function GoalProgressRow({
	label,
	metric,
	metLabel,
}: {
	label: string;
	metric: GoalMetricProgress;
	metLabel: string;
}) {
	const ratio =
		metric.target > 0 ? Math.min(1, metric.current / metric.target) : 0;
	return (
		<div>
			<div className="mb-1 flex items-center justify-between gap-2 text-xs">
				<span className="text-muted-foreground">{label}</span>
				<span className="tabular-nums text-foreground">
					{metric.current}/{metric.target}
					{metric.met ? ` · ${metLabel}` : ""}
				</span>
			</div>
			<div className="h-1.5 overflow-hidden rounded-full bg-muted">
				<div
					className={cn(
						"h-full rounded-full transition-[width]",
						metric.met ? "bg-success" : "bg-primary",
					)}
					style={{ width: `${ratio * 100}%` }}
				/>
			</div>
		</div>
	);
}

export function GoalsSettings({
	preferences,
	setPreferences,
}: GoalsSettingsProps) {
	const { t, locale } = useI18n();
	const { snapshot } = useBlinkStats();
	const { goals, streak } = snapshot;
	const [settingsOpen, setSettingsOpen] = useState(false);
	const atDefaults =
		preferences.goalsEnabled === DEFAULT_GOALS_CONFIG.goalsEnabled &&
		preferences.dailyBlinkGoal === DEFAULT_GOALS_CONFIG.dailyBlinkGoal &&
		preferences.dailyTrackingMinutesGoal ===
			DEFAULT_GOALS_CONFIG.dailyTrackingMinutesGoal &&
		preferences.weeklyBlinkGoal === DEFAULT_GOALS_CONFIG.weeklyBlinkGoal &&
		preferences.weeklyTrackingMinutesGoal ===
			DEFAULT_GOALS_CONFIG.weeklyTrackingMinutesGoal;

	const resetGoals = () =>
		setPreferences((current) => ({
			...current,
			...DEFAULT_GOALS_CONFIG,
		}));

	const streakKey = pluralKey("stats.streak.days", locale, streak.current);
	const dailyGoals = [
		{ key: "dailyBlinks", metric: goals.dailyBlinks },
		{ key: "dailyTracking", metric: goals.dailyTrackingMinutes },
	] as const;
	const weeklyGoals = [
		{ key: "weeklyBlinks", metric: goals.weeklyBlinks },
		{ key: "weeklyTracking", metric: goals.weeklyTrackingMinutes },
	] as const;

	return (
		<SettingPanel>
			<SettingRow
				title={t("goals.title")}
				description={settingsOpen ? t("goals.description") : undefined}
				action={
					<div className="flex flex-wrap items-center justify-end gap-2">
						<Button
							type="button"
							size="sm"
							variant="secondary"
							aria-expanded={settingsOpen}
							onClick={() => setSettingsOpen((open) => !open)}
						>
							<span className="inline-grid grid-cols-1 grid-rows-1 place-items-center">
								<span
									className="invisible col-start-1 row-start-1 whitespace-nowrap"
									aria-hidden
								>
									{t("goals.showSettings")}
								</span>
								<span
									className="invisible col-start-1 row-start-1 whitespace-nowrap"
									aria-hidden
								>
									{t("goals.hideSettings")}
								</span>
								<span className="col-start-1 row-start-1 whitespace-nowrap">
									{settingsOpen
										? t("goals.hideSettings")
										: t("goals.showSettings")}
								</span>
							</span>
						</Button>
						<ToggleSwitch
							aria-label={t("goals.enabledAria")}
							checked={preferences.goalsEnabled}
							onChange={() =>
								setPreferences((current) => ({
									...current,
									goalsEnabled: !current.goalsEnabled,
								}))
							}
						/>
					</div>
				}
			/>
			<div className="mt-4">
				{preferences.goalsEnabled ? (
					<div className="space-y-3">
						{dailyGoals.map(({ key, metric }) =>
							metric.enabled ? (
								<GoalProgressRow
									key={key}
									label={t(`stats.goals.${key}`)}
									metric={metric}
									metLabel={t("stats.goals.met")}
								/>
							) : null,
						)}
						{weeklyGoals.map(({ key, metric }) =>
							metric.enabled ? (
								<GoalProgressRow
									key={key}
									label={t(`stats.goals.${key}`)}
									metric={metric}
									metLabel={t("stats.goals.met")}
								/>
							) : null,
						)}
						<div className="flex flex-wrap items-center gap-3">
							<p className="text-lg font-semibold tabular-nums tracking-tight">
								{t(streakKey, { n: streak.current })}
							</p>
							<Badge
								className={
									streak.shieldCharges > 0
										? "border-primary/40 bg-primary/10 text-primary"
										: "text-muted-foreground"
								}
							>
								{streak.shieldCharges > 0
									? t("stats.streak.shieldReady")
									: t("stats.streak.shieldEmpty")}
							</Badge>
						</div>
					</div>
				) : (
					<p className="text-sm text-muted-foreground">
						{t("stats.goals.off")}
					</p>
				)}
				<Reveal open={settingsOpen}>
					<div className="mt-3">
						<Reveal open={preferences.goalsEnabled}>
							<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
								<GoalNumberInput
									id="daily-blink-goal"
									label={t("goals.dailyBlinks")}
									value={preferences.dailyBlinkGoal}
									onChange={(dailyBlinkGoal) =>
										setPreferences((current) => ({
											...current,
											dailyBlinkGoal,
										}))
									}
								/>
								<GoalNumberInput
									id="daily-tracking-goal"
									label={t("goals.dailyTracking")}
									value={preferences.dailyTrackingMinutesGoal}
									onChange={(dailyTrackingMinutesGoal) =>
										setPreferences((current) => ({
											...current,
											dailyTrackingMinutesGoal,
										}))
									}
								/>
								<GoalNumberInput
									id="weekly-blink-goal"
									label={t("goals.weeklyBlinks")}
									value={preferences.weeklyBlinkGoal}
									onChange={(weeklyBlinkGoal) =>
										setPreferences((current) => ({
											...current,
											weeklyBlinkGoal,
										}))
									}
								/>
								<GoalNumberInput
									id="weekly-tracking-goal"
									label={t("goals.weeklyTracking")}
									value={preferences.weeklyTrackingMinutesGoal}
									onChange={(weeklyTrackingMinutesGoal) =>
										setPreferences((current) => ({
											...current,
											weeklyTrackingMinutesGoal,
										}))
									}
								/>
							</div>
						</Reveal>
						<div className={preferences.goalsEnabled ? "mt-3" : undefined}>
							<Button
								type="button"
								size="sm"
								variant="secondary"
								disabled={atDefaults}
								onClick={resetGoals}
							>
								{t("common.reset")}
							</Button>
						</div>
					</div>
				</Reveal>
			</div>
		</SettingPanel>
	);
}
