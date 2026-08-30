import { describe, expect, it, vi } from "vitest";
import { SessionRecapService } from "../../../electron/application/session-recap-service";
import {
	OVERLAY_COOLDOWN_MS,
	SESSION_RECAP_MIN_TRACKING_MS,
} from "../../../electron/domain/session-recap-policy";
import type { BlinkStatsSnapshot } from "../../../shared/blink-stats";
import type { AppPreferences } from "../../../shared/preferences";
import { DEFAULT_PREFERENCES } from "../../../shared/preferences";

function makeSnapshot(
	overrides: Partial<BlinkStatsSnapshot["today"]> = {},
): BlinkStatsSnapshot {
	return {
		today: {
			date: "2026-08-30",
			blinks: 100,
			trackingMs: SESSION_RECAP_MIN_TRACKING_MS,
			sessions: 1,
			lookAwayCompleted: 0,
			lookAwaySkipped: 0,
			lookAwaySnoozed: 0,
			exerciseCompleted: 0,
			exerciseSkipped: 0,
			exerciseSnoozed: 0,
			...overrides,
		},
		totals: { total: 100, spent: 0, available: 100 },
		weekEyeCare: {
			lookAwayCompleted: 0,
			lookAwaySkipped: 0,
			lookAwaySnoozed: 0,
			exerciseCompleted: 0,
			exerciseSkipped: 0,
			exerciseSnoozed: 0,
		},
		dayChart: [],
		weekChart: [],
		monthChart: [],
		yearChart: [],
		blinksPerMinute: 0,
		blinkRateReady: false,
		blinkRateWarmupMs: 0,
		blinkRateWarmupTargetMs: 60_000,
		goals: {
			enabled: false,
			dailyBlinks: { current: 0, target: 0, enabled: false, met: false },
			dailyTrackingMinutes: {
				current: 0,
				target: 0,
				enabled: false,
				met: false,
			},
			weeklyBlinks: { current: 0, target: 0, enabled: false, met: false },
			weeklyTrackingMinutes: {
				current: 0,
				target: 0,
				enabled: false,
				met: false,
			},
			dailyMet: false,
		},
		streak: { current: 0, shieldCharges: 0 },
		rewards: [],
		hasStatsFlair: false,
		equippedCheerTheme: "random",
		equippedPopupPresetId: null,
		unlockedCheerThemeIds: [],
		unlockedPopupPresetIds: [],
		unlockedAchievementIds: [],
		achievementsUnlocked: 0,
		achievementsTotal: 0,
		achievementProgress: {},
	};
}

function createService(options?: {
	preferences?: Partial<AppPreferences>;
	now?: number;
	gate?: { pauseReason: () => "manual-hush" | null };
	isTracking?: boolean;
}) {
	const preferences = {
		...DEFAULT_PREFERENCES,
		sessionRecapEnabled: true,
		isTracking: options?.isTracking ?? true,
		locale: "en" as const,
		...options?.preferences,
	};
	let snapshot = makeSnapshot();
	const ports = {
		showOverlay: vi.fn(),
		showNative: vi.fn(),
		logInteraction: vi.fn(),
	};
	const stats = {
		getSnapshot: () => snapshot,
	};
	const gate = options?.gate ?? {
		pauseReason: (): null => null,
	};
	let now = options?.now ?? 1_000_000;
	const service = new SessionRecapService(
		preferences,
		stats as never,
		{
			notificationsAllowed: () => gate.pauseReason() === null,
			pauseReason: () => gate.pauseReason(),
		},
		ports,
		() => now,
	);
	return {
		service,
		ports,
		setSnapshot: (next: BlinkStatsSnapshot) => {
			snapshot = next;
		},
		setNow: (value: number) => {
			now = value;
		},
	};
}

describe("SessionRecapService", () => {
	it("does not reset baseline when tracking start fires twice", () => {
		const ctx = createService();
		ctx.service.armBaseline(makeSnapshot({ blinks: 0, trackingMs: 0 }));
		ctx.service.armBaseline(makeSnapshot({ blinks: 999, trackingMs: 0 }));
		ctx.setSnapshot(
			makeSnapshot({
				blinks: 12,
				trackingMs: SESSION_RECAP_MIN_TRACKING_MS,
			}),
		);
		expect(ctx.service.handleStop({ showStatus: true })).toBe(true);
		expect(ctx.ports.showOverlay).toHaveBeenCalledOnce();
	});

	it("shows overlay on qualified stop", () => {
		const ctx = createService();
		ctx.service.armBaseline(makeSnapshot({ blinks: 0, trackingMs: 0 }));
		ctx.setSnapshot(
			makeSnapshot({
				blinks: 12,
				trackingMs: SESSION_RECAP_MIN_TRACKING_MS,
			}),
		);
		expect(ctx.service.handleStop({ showStatus: true })).toBe(true);
		expect(ctx.ports.showOverlay).toHaveBeenCalledOnce();
	});

	it("returns false when recap is disabled or suppressed", () => {
		const disabled = createService({
			preferences: { sessionRecapEnabled: false },
		});
		disabled.service.armBaseline(makeSnapshot());
		expect(disabled.service.handleStop({ showStatus: true })).toBe(false);

		const suppressed = createService({
			gate: { pauseReason: () => "manual-hush" },
		});
		suppressed.service.armBaseline(makeSnapshot());
		expect(suppressed.service.handleStop({ showStatus: true })).toBe(false);
		expect(suppressed.ports.logInteraction).toHaveBeenCalledWith(
			"recap-suppressed",
			{ trigger: "stop" },
		);
	});

	it("respects overlay cooldown on stop", () => {
		const ctx = createService({ now: 1_000_000 });
		ctx.service.armBaseline(makeSnapshot({ blinks: 0, trackingMs: 0 }));
		ctx.setSnapshot(
			makeSnapshot({
				blinks: 5,
				trackingMs: SESSION_RECAP_MIN_TRACKING_MS,
			}),
		);
		expect(ctx.service.handleStop({ showStatus: true })).toBe(true);
		ctx.service.armBaseline(makeSnapshot({ blinks: 0, trackingMs: 0 }));
		ctx.setSnapshot(
			makeSnapshot({
				blinks: 10,
				trackingMs: SESSION_RECAP_MIN_TRACKING_MS * 2,
			}),
		);
		ctx.setNow(1_000_000 + OVERLAY_COOLDOWN_MS - 1);
		expect(ctx.service.handleStop({ showStatus: true })).toBe(false);
	});

	it("shows native quit recap when day qualifies", () => {
		const ctx = createService();
		ctx.service.armBaseline(makeSnapshot());
		ctx.service.handleStop({ showStatus: true });
		ctx.service.handleQuit();
		expect(ctx.ports.showNative).toHaveBeenCalledOnce();
	});

	it("shows native lock recap and keeps baseline for return", () => {
		const ctx = createService();
		ctx.service.armBaseline(makeSnapshot({ blinks: 0, trackingMs: 0 }));
		ctx.setSnapshot(
			makeSnapshot({
				blinks: 4,
				trackingMs: SESSION_RECAP_MIN_TRACKING_MS,
				exerciseCompleted: 2,
			}),
		);
		ctx.service.handleSessionInactive();
		expect(ctx.ports.showNative).toHaveBeenCalledOnce();
		ctx.service.handleSessionInactive();
		expect(ctx.ports.showNative).toHaveBeenCalledOnce();
	});
});
