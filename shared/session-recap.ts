import {
	formatTrackingDuration,
	type TodayBlinkSummary,
	type StreakSummary,
} from "./blink-stats";
import { pluralKey, t, type Locale } from "./i18n";

export type SessionRecapBaseline = {
	date: string;
	blinks: number;
	trackingMs: number;
	lookAwayCompleted: number;
	exerciseCompleted: number;
	armedAt: number;
};

export type SessionRecapDelta = {
	blinks: number;
	trackingMs: number;
	lookAwayCompleted: number;
	exerciseCompleted: number;
	eyeCareCompleted: number;
};

export type SessionRecapOverlayPayload = {
	title: string;
	sessionLines: string[];
	todaySubtitle: string;
	streakLine?: string;
};

export type SessionRecapNativePayload = {
	kind: "quit" | "lock";
	title: string;
	body: string;
};

function baselineSliceForDelta(
	baseline: SessionRecapBaseline,
	currentDate: string,
): Pick<
	SessionRecapBaseline,
	"blinks" | "trackingMs" | "lookAwayCompleted" | "exerciseCompleted"
> {
	if (baseline.date !== currentDate) {
		return {
			blinks: 0,
			trackingMs: 0,
			lookAwayCompleted: 0,
			exerciseCompleted: 0,
		};
	}
	return baseline;
}

export function computeSessionDelta(
	baseline: SessionRecapBaseline,
	current: TodayBlinkSummary,
): SessionRecapDelta {
	const slice = baselineSliceForDelta(baseline, current.date);
	const lookAwayCompleted = Math.max(
		0,
		current.lookAwayCompleted - slice.lookAwayCompleted,
	);
	const exerciseCompleted = Math.max(
		0,
		current.exerciseCompleted - slice.exerciseCompleted,
	);
	return {
		blinks: Math.max(0, current.blinks - slice.blinks),
		trackingMs: Math.max(0, current.trackingMs - slice.trackingMs),
		lookAwayCompleted,
		exerciseCompleted,
		eyeCareCompleted: lookAwayCompleted + exerciseCompleted,
	};
}

function formatEyeCareLine(
	locale: Locale,
	lookAwayCompleted: number,
	exerciseCompleted: number,
): string {
	const lookAwayLabel = t(
		locale,
		pluralKey("popup.recap.lookAwayCount", locale, lookAwayCompleted),
		{ n: lookAwayCompleted },
	);
	const exerciseLabel = t(
		locale,
		pluralKey("popup.recap.exerciseCount", locale, exerciseCompleted),
		{ n: exerciseCompleted },
	);
	return t(locale, "popup.recap.eyeCareLine", {
		lookAway: lookAwayLabel,
		exercise: exerciseLabel,
	});
}

export function buildOverlayPayload(
	delta: SessionRecapDelta,
	today: TodayBlinkSummary,
	streak: StreakSummary,
	locale: Locale,
): SessionRecapOverlayPayload {
	const sessionLines = [
		t(locale, "popup.recap.sessionPrimary", {
			duration: formatTrackingDuration(delta.trackingMs, locale),
			blinks: delta.blinks,
		}),
	];
	if (delta.eyeCareCompleted > 0) {
		sessionLines.push(
			formatEyeCareLine(
				locale,
				delta.lookAwayCompleted,
				delta.exerciseCompleted,
			),
		);
	}
	const todaySubtitle = t(locale, "popup.recap.todaySubtitle", {
		duration: formatTrackingDuration(today.trackingMs, locale),
		blinks: today.blinks,
	});
	const payload: SessionRecapOverlayPayload = {
		title: t(locale, "popup.recap.title"),
		sessionLines,
		todaySubtitle,
	};
	if (streak.current >= 2) {
		payload.streakLine = t(
			locale,
			pluralKey("popup.recap.streakLine", locale, streak.current),
			{ n: streak.current },
		);
	}
	return payload;
}

export function buildNativePayload(
	scope: "quit" | "lock",
	data: {
		today?: TodayBlinkSummary;
		delta?: SessionRecapDelta;
	},
	locale: Locale,
): SessionRecapNativePayload {
	if (scope === "quit" && data.today) {
		return {
			kind: "quit",
			title: t(locale, "popup.recap.quit.title"),
			body: t(locale, "popup.recap.quit.body", {
				duration: formatTrackingDuration(data.today.trackingMs, locale),
				blinks: data.today.blinks,
			}),
		};
	}
	const delta = data.delta;
	if (!delta) {
		return {
			kind: "lock",
			title: t(locale, "popup.recap.lock.title"),
			body: t(locale, "popup.recap.lock.body", {
				duration: formatTrackingDuration(0, locale),
				blinks: 0,
			}),
		};
	}
	const body =
		delta.eyeCareCompleted > 0
			? t(locale, "popup.recap.lock.bodyWithEyeCare", {
					duration: formatTrackingDuration(delta.trackingMs, locale),
					eyeCare: delta.eyeCareCompleted,
				})
			: t(locale, "popup.recap.lock.body", {
					duration: formatTrackingDuration(delta.trackingMs, locale),
					blinks: delta.blinks,
				});
	return {
		kind: "lock",
		title: t(locale, "popup.recap.lock.title"),
		body,
	};
}

export const SESSION_RECAP_NATIVE_BODY_MAX = 240;

export function truncateNativeBody(body: string): string {
	if (body.length <= SESSION_RECAP_NATIVE_BODY_MAX) return body;
	return `${body.slice(0, SESSION_RECAP_NATIVE_BODY_MAX - 1)}…`;
}
