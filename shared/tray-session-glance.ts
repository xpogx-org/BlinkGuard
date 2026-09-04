import type { GoalMetricProgress } from "./blink-stats";
import { formatTrackingDuration } from "./blink-stats";
import {
	classifyBlinkRate,
	formatBlinksPerMinute,
} from "./blink-rate";
import { pluralKey, t, type Locale } from "./i18n";

export type TraySessionGlanceGoals = {
	enabled: boolean;
	dailyBlinks: GoalMetricProgress;
	dailyTrackingMinutes: GoalMetricProgress;
};

export type TraySessionGlanceInput = {
	isTracking: boolean;
	showLiveBpm: boolean;
	blinksPerMinute: number;
	blinkRateReady: boolean;
	todayBlinks: number;
	todayTrackingMs: number;
	goals: TraySessionGlanceGoals;
};

/** Compact count for tray tooltip (e.g. 1234 → 1.2k). */
export function formatCompactCount(value: number, locale: Locale = "en"): string {
	if (!Number.isFinite(value) || value < 0) return "0";
	const n = Math.floor(value);
	if (n < 1000) return String(n);
	if (n % 1000 === 0) {
		return `${n / 1000}k`;
	}
	const thousands = n / 1000;
	const rounded = Math.round(thousands * 10) / 10;
	const sep = locale === "uk" ? "," : ".";
	return `${String(rounded).replace(".", sep)}k`;
}

function goalPercent(metric: GoalMetricProgress): number {
	if (!metric.enabled || metric.target <= 0) return 0;
	return Math.min(100, Math.round((metric.current / metric.target) * 100));
}

function formatGoalFragment(
	locale: Locale,
	goals: TraySessionGlanceGoals,
): string | null {
	if (!goals.enabled) return null;
	const blink = goals.dailyBlinks;
	const tracking = goals.dailyTrackingMinutes;
	const metric = blink.enabled
		? blink
		: tracking.enabled
			? tracking
			: null;
	if (!metric) return null;
	const current = formatCompactCount(metric.current, locale);
	const target = formatCompactCount(metric.target, locale);
	let fragment = t(locale, "tray.glance.goal", { current, target });
	if (metric.met) {
		fragment += ` · ${t(locale, "stats.goals.met")}`;
	} else {
		const pct = goalPercent(metric);
		if (pct > 0) {
			fragment += ` · ${t(locale, "tray.glance.percent", { percent: pct })}`;
		}
	}
	return fragment;
}

function formatBpmFragment(
	locale: Locale,
	input: TraySessionGlanceInput,
): string | null {
	if (!input.showLiveBpm) return null;
	if (!input.blinkRateReady) {
		return t(locale, "tray.glance.warming");
	}
	const rate = formatBlinksPerMinute(input.blinksPerMinute);
	const band = classifyBlinkRate(input.blinksPerMinute, locale).label;
	return t(locale, "tray.glance.bpm", { rate, band });
}

function formatTodayFragment(
	locale: Locale,
	input: TraySessionGlanceInput,
): string | null {
	const { todayBlinks, todayTrackingMs, isTracking, showLiveBpm } = input;
	const hasData = todayBlinks > 0 || todayTrackingMs > 0 || isTracking;
	if (!hasData) return null;

	if (!showLiveBpm && todayTrackingMs > 0) {
		const duration = formatTrackingDuration(todayTrackingMs, locale);
		return t(locale, "tray.glance.todayWithTracking", {
			blinks: todayBlinks,
			duration,
		});
	}

	const blinkKey = pluralKey("tray.glance.today", locale, todayBlinks);
	return t(locale, blinkKey, { blinks: todayBlinks });
}

/**
 * Tray tooltip glance fragment: live BPM, today's progress, and daily goal.
 * Returns empty string when there is nothing meaningful to show.
 */
export function formatTraySessionGlance(
	locale: Locale,
	input: TraySessionGlanceInput | null,
): string {
	if (!input) return "";
	const parts: string[] = [];
	const bpm = formatBpmFragment(locale, input);
	if (bpm) parts.push(bpm);
	const today = formatTodayFragment(locale, input);
	if (today) parts.push(today);
	const goal = formatGoalFragment(locale, input.goals);
	if (goal) parts.push(goal);
	return parts.join(" · ");
}

export function traySessionGlanceEqual(
	a: TraySessionGlanceInput | null,
	b: TraySessionGlanceInput | null,
): boolean {
	if (a === b) return true;
	if (!a || !b) return false;
	return (
		a.isTracking === b.isTracking &&
		a.showLiveBpm === b.showLiveBpm &&
		a.blinksPerMinute === b.blinksPerMinute &&
		a.blinkRateReady === b.blinkRateReady &&
		a.todayBlinks === b.todayBlinks &&
		a.todayTrackingMs === b.todayTrackingMs &&
		a.goals.enabled === b.goals.enabled &&
		a.goals.dailyBlinks.current === b.goals.dailyBlinks.current &&
		a.goals.dailyBlinks.target === b.goals.dailyBlinks.target &&
		a.goals.dailyBlinks.enabled === b.goals.dailyBlinks.enabled &&
		a.goals.dailyBlinks.met === b.goals.dailyBlinks.met &&
		a.goals.dailyTrackingMinutes.current ===
			b.goals.dailyTrackingMinutes.current &&
		a.goals.dailyTrackingMinutes.target ===
			b.goals.dailyTrackingMinutes.target &&
		a.goals.dailyTrackingMinutes.enabled ===
			b.goals.dailyTrackingMinutes.enabled &&
		a.goals.dailyTrackingMinutes.met === b.goals.dailyTrackingMinutes.met
	);
}
