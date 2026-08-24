import { useState } from "react";
import { Badge } from "@/components/badge";
import { Button } from "@/components/button";
import { SettingGrid } from "@/components/setting-grid";
import { SettingPanel } from "@/components/setting-panel";
import { SettingRow } from "@/components/setting-row";
import { SummaryStat } from "@/components/summary-stat";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import {
	type BlinkStatsSnapshot,
	formatTrackingDuration,
	type GoalMetricProgress,
} from "../../../../shared/blink-stats";
import { pluralKey } from "../../../../shared/i18n";
import { useBlinkStats } from "../model/use-blink-stats";
import { LiveBlinkRate } from "./live-blink-rate";
import { StatsBarChart } from "./stats-bar-chart";

type ChartRange = "today" | "week" | "month" | "year";

function chartBuckets(range: ChartRange, snapshot: BlinkStatsSnapshot) {
	switch (range) {
		case "today":
			return snapshot.dayChart;
		case "week":
			return snapshot.weekChart;
		case "month":
			return snapshot.monthChart;
		case "year":
			return snapshot.yearChart;
	}
}

export function StatisticsPanel() {
	const { t, locale } = useI18n();
	const { snapshot, clearStatistics } = useBlinkStats();
	const [range, setRange] = useState<ChartRange>("today");
	const { today, totals, goals, streak, hasStatsFlair, weekEyeCare } = snapshot;
	const buckets = chartBuckets(range, snapshot);
	const chartCopy: Record<
		ChartRange,
		{ description: string; ariaLabel: string }
	> = {
		today: {
			description: t("stats.chart.today.desc"),
			ariaLabel: t("stats.chart.today.aria"),
		},
		week: {
			description: t("stats.chart.week.desc"),
			ariaLabel: t("stats.chart.week.aria"),
		},
		month: {
			description: t("stats.chart.month.desc"),
			ariaLabel: t("stats.chart.month.aria"),
		},
		year: {
			description: t("stats.chart.year.desc"),
			ariaLabel: t("stats.chart.year.aria"),
		},
	};

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
		<>
			<SettingPanel>
				<SettingRow
					title={
						<span className="inline-flex items-center gap-2">
							{t("stats.totals")}
							{hasStatsFlair ? (
								<Badge className="uppercase">{t("stats.flair.badge")}</Badge>
							) : null}
						</span>
					}
					description={t("stats.totalsDesc")}
				>
					<div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
						<SummaryStat
							label={t("stats.total")}
							value={String(totals.total)}
						/>
						<SummaryStat
							label={t("stats.available")}
							value={String(totals.available)}
						/>
						<SummaryStat
							label={t("stats.spent")}
							value={String(totals.spent)}
						/>
					</div>
					<p className="mt-3 text-xs text-muted-foreground">
						{t("stats.spendingNote")}
					</p>
				</SettingRow>
			</SettingPanel>

			<SettingPanel>
				<SettingRow title={t("stats.goals")} description={t("stats.goalsDesc")}>
					{!goals.enabled ? (
						<p className="text-sm text-muted-foreground">
							{t("stats.goals.off")}
						</p>
					) : (
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
						</div>
					)}
				</SettingRow>
			</SettingPanel>

			<SettingGrid>
				<SettingPanel>
					<SettingRow
						title={t("stats.streak")}
						description={t("stats.streakDesc")}
					>
						<div className="flex flex-wrap items-center gap-3">
							<p className="text-lg font-semibold tabular-nums tracking-tight">
								{t(streakKey, { n: streak.current })}
							</p>
							<span
								className={cn(
									"rounded-md border px-2 py-1 text-xs font-medium",
									streak.shieldCharges > 0
										? "border-primary/40 bg-primary/10 text-primary"
										: "border-border text-muted-foreground",
								)}
							>
								{streak.shieldCharges > 0
									? t("stats.streak.shieldReady")
									: t("stats.streak.shieldEmpty")}
							</span>
						</div>
					</SettingRow>
				</SettingPanel>

				<SettingPanel>
					<SettingRow
						title={t("stats.liveRate")}
						description={t("stats.liveRateDesc")}
					>
						<LiveBlinkRate
							blinksPerMinute={snapshot.blinksPerMinute}
							blinkRateReady={snapshot.blinkRateReady}
							blinkRateWarmupMs={snapshot.blinkRateWarmupMs}
							blinkRateWarmupTargetMs={snapshot.blinkRateWarmupTargetMs}
						/>
					</SettingRow>
				</SettingPanel>
			</SettingGrid>

			<SettingPanel>
				<SettingRow title={t("stats.today")} description={t("stats.todayDesc")}>
					<div className="grid grid-cols-3 gap-3">
						<SummaryStat
							label={t("stats.blinks")}
							value={String(today.blinks)}
						/>
						<SummaryStat
							label={t("stats.tracking")}
							value={formatTrackingDuration(today.trackingMs, locale)}
						/>
						<SummaryStat
							label={t("stats.sessions")}
							value={String(today.sessions)}
						/>
					</div>
				</SettingRow>
			</SettingPanel>

			<SettingPanel>
				<SettingRow
					title={t("stats.eyeCare")}
					description={t("stats.eyeCareDesc")}
				>
					<div className="space-y-3">
						<div className="grid grid-cols-3 gap-3">
							<SummaryStat
								label={t("stats.lookAwayCompleted")}
								value={String(today.lookAwayCompleted)}
							/>
							<SummaryStat
								label={t("stats.lookAwaySkipped")}
								value={String(today.lookAwaySkipped)}
							/>
							<SummaryStat
								label={t("stats.lookAwaySnoozed")}
								value={String(today.lookAwaySnoozed)}
							/>
						</div>
						<div className="grid grid-cols-3 gap-3">
							<SummaryStat
								label={t("stats.exerciseCompleted")}
								value={String(today.exerciseCompleted)}
							/>
							<SummaryStat
								label={t("stats.exerciseSkipped")}
								value={String(today.exerciseSkipped)}
							/>
							<SummaryStat
								label={t("stats.exerciseSnoozed")}
								value={String(today.exerciseSnoozed)}
							/>
						</div>
						<p className="text-xs text-muted-foreground">
							{t("stats.eyeCareWeek", weekEyeCare)}
						</p>
					</div>
				</SettingRow>
			</SettingPanel>

			<SettingPanel>
				<div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
					<div>
						<p className="text-sm font-medium text-foreground">
							{t("stats.chart")}
						</p>
						<p className="text-xs text-muted-foreground sm:text-sm">
							{chartCopy[range].description}
						</p>
					</div>
					<div className="inline-flex shrink-0 flex-wrap rounded-md border border-border p-0.5">
						{(
							[
								["today", t("stats.today")],
								["week", t("stats.week")],
								["month", t("stats.month")],
								["year", t("stats.year")],
							] as const
						).map(([id, label]) => (
							<RangeButton
								key={id}
								active={range === id}
								onClick={() => setRange(id)}
							>
								{label}
							</RangeButton>
						))}
					</div>
				</div>
				<StatsBarChart
					buckets={buckets}
					ariaLabel={chartCopy[range].ariaLabel}
				/>
			</SettingPanel>

			<SettingPanel className="border-destructive/40 bg-destructive/5">
				<SettingRow
					title={
						<span className="text-destructive">{t("stats.dangerZone")}</span>
					}
					description={t("stats.clearDesc")}
				>
					<Button type="button" variant="destructive" onClick={clearStatistics}>
						{t("stats.clear")}
					</Button>
				</SettingRow>
			</SettingPanel>
		</>
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

function RangeButton({
	active,
	onClick,
	children,
}: {
	active: boolean;
	onClick: () => void;
	children: string;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			className={cn(
				"rounded px-2.5 py-1 text-xs font-medium transition-colors",
				active
					? "bg-primary text-primary-foreground"
					: "text-muted-foreground hover:text-foreground",
			)}
		>
			{children}
		</button>
	);
}
