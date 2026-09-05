import { useState } from "react";
import { Button } from "@/components/button";
import { SettingPanel } from "@/components/setting-panel";
import { SettingRow } from "@/components/setting-row";
import { SummaryStat } from "@/components/summary-stat";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import {
	type BlinkStatsSnapshot,
	formatTrackingDuration,
} from "../../../../shared/blink-stats";
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

export function StatisticsPanel({
	cameraEnabled = true,
}: {
	cameraEnabled?: boolean;
}) {
	const { t, locale } = useI18n();
	const { snapshot, clearStatistics } = useBlinkStats();
	const [range, setRange] = useState<ChartRange>("today");
	const { today, weekEyeCare } = snapshot;
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

	return (
		<>
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

			<SettingPanel>
				<SettingRow title={t("stats.today")} description={t("stats.todayDesc")}>
					<div
						className={cn(
							"grid gap-3",
							cameraEnabled ? "grid-cols-3" : "grid-cols-2",
						)}
					>
						{cameraEnabled ? (
							<SummaryStat
								label={t("stats.blinks")}
								value={String(today.blinks)}
							/>
						) : null}
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
						<table className="w-full text-left text-sm">
							<caption className="sr-only">{t("stats.eyeCare")}</caption>
							<thead>
								<tr className="text-xs text-muted-foreground">
									<th className="py-1.5 pr-3 font-medium" />
									<th className="px-2 py-1.5 text-right font-medium">
										{t("stats.eyeCare.done")}
									</th>
									<th className="px-2 py-1.5 text-right font-medium">
										{t("stats.eyeCare.skipped")}
									</th>
									<th className="px-2 py-1.5 text-right font-medium">
										{t("stats.eyeCare.snoozed")}
									</th>
								</tr>
							</thead>
							<tbody>
								<tr>
									<th
										scope="row"
										className="py-1.5 pr-3 font-medium text-foreground"
									>
										{t("stats.eyeCare.lookAway")}
									</th>
									<td className="px-2 py-1.5 text-right tabular-nums">
										{today.lookAwayCompleted}
									</td>
									<td className="px-2 py-1.5 text-right tabular-nums">
										{today.lookAwaySkipped}
									</td>
									<td className="px-2 py-1.5 text-right tabular-nums">
										{today.lookAwaySnoozed}
									</td>
								</tr>
								<tr>
									<th
										scope="row"
										className="py-1.5 pr-3 font-medium text-foreground"
									>
										{t("stats.eyeCare.exercise")}
									</th>
									<td className="px-2 py-1.5 text-right tabular-nums">
										{today.exerciseCompleted}
									</td>
									<td className="px-2 py-1.5 text-right tabular-nums">
										{today.exerciseSkipped}
									</td>
									<td className="px-2 py-1.5 text-right tabular-nums">
										{today.exerciseSnoozed}
									</td>
								</tr>
							</tbody>
						</table>
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
