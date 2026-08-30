import type { BlinkStatsSnapshot } from "../../shared/blink-stats";
import type { AppPreferences } from "../../shared/preferences";
import {
	buildNativePayload,
	buildOverlayPayload,
	computeSessionDelta,
	truncateNativeBody,
	type SessionRecapBaseline,
} from "../../shared/session-recap";
import {
	nativeLockCooldownAllows,
	overlayCooldownAllows,
	qualifiesQuitToday,
	qualifiesSession,
	shouldSuppressRecap,
} from "../domain/session-recap-policy";
import type { BlinkStatsService } from "./blink-stats-service";
import type { NotificationGate } from "./ports/notification-gate";
import type { SessionRecapPorts } from "./ports/session-recap-port";

export class SessionRecapService {
	private baseline: SessionRecapBaseline | null = null;
	private lastOverlayAt: number | null = null;
	private lastNativeLockAt: number | null = null;
	private lastUnlockAt: number | null = null;
	private lastSessionQualified = false;

	constructor(
		private readonly preferences: AppPreferences,
		private readonly stats: BlinkStatsService,
		private readonly gate: NotificationGate,
		private readonly ports: SessionRecapPorts,
		private readonly now: () => number = () => Date.now(),
	) {}

	armBaseline(snapshot?: BlinkStatsSnapshot): void {
		if (this.baseline) return;
		const snap = snapshot ?? this.stats.getSnapshot();
		this.baseline = {
			date: snap.today.date,
			blinks: snap.today.blinks,
			trackingMs: snap.today.trackingMs,
			lookAwayCompleted: snap.today.lookAwayCompleted,
			exerciseCompleted: snap.today.exerciseCompleted,
			armedAt: this.now(),
		};
	}

	clearBaseline(): void {
		this.baseline = null;
	}

	handleStop(options: { showStatus: boolean }): boolean {
		const snapshot = this.stats.getSnapshot();
		const baseline = this.baseline;
		this.clearBaseline();

		if (!options.showStatus) return false;
		if (!this.preferences.sessionRecapEnabled) return false;
		if (this.isRecapSuppressed()) {
			this.logSuppressed("stop");
			return false;
		}
		if (!baseline) return false;

		const delta = computeSessionDelta(baseline, snapshot.today);
		const qualified = qualifiesSession(delta);
		this.lastSessionQualified = qualified;
		if (!qualified) return false;

		const now = this.now();
		if (!overlayCooldownAllows(now, this.lastOverlayAt)) {
			this.logSuppressed("stop-cooldown");
			return false;
		}

		const locale = this.preferences.locale === "uk" ? "uk" : "en";
		const payload = buildOverlayPayload(
			delta,
			snapshot.today,
			snapshot.streak,
			locale,
		);
		this.lastOverlayAt = now;
		this.ports.showOverlay(payload);
		this.ports.logInteraction?.("recap-overlay", { trigger: "stop" });
		return true;
	}

	handleQuit(): void {
		if (!this.preferences.sessionRecapEnabled) return;
		if (this.isRecapSuppressed()) {
			this.logSuppressed("quit");
			return;
		}

		const snapshot = this.stats.getSnapshot();
		if (
			!qualifiesQuitToday(snapshot.today, this.lastSessionQualified)
		) {
			return;
		}

		const locale = this.preferences.locale === "uk" ? "uk" : "en";
		const native = buildNativePayload("quit", { today: snapshot.today }, locale);
		this.showNative(native);
	}

	handleSessionInactive(): void {
		if (!this.preferences.sessionRecapEnabled) return;
		if (!this.preferences.isTracking) return;
		if (this.isRecapSuppressed()) {
			this.logSuppressed("lock");
			return;
		}

		const baseline = this.baseline;
		if (!baseline) return;

		const snapshot = this.stats.getSnapshot();
		const delta = computeSessionDelta(baseline, snapshot.today);
		if (!qualifiesSession(delta)) return;

		const now = this.now();
		if (!nativeLockCooldownAllows(now, this.lastNativeLockAt, this.lastUnlockAt)) {
			this.logSuppressed("lock-cooldown");
			return;
		}

		const locale = this.preferences.locale === "uk" ? "uk" : "en";
		const native = buildNativePayload("lock", { delta }, locale);
		this.lastNativeLockAt = now;
		this.showNative(native);
	}

	handleUnlock(): void {
		this.lastUnlockAt = this.now();
	}

	private isRecapSuppressed(): boolean {
		return shouldSuppressRecap(this.gate.pauseReason());
	}

	private showNative(payload: {
		kind: "quit" | "lock";
		title: string;
		body: string;
	}): void {
		this.ports.showNative({
			kind: payload.kind,
			title: payload.title,
			body: truncateNativeBody(payload.body),
		});
		this.ports.logInteraction?.("recap-native", { trigger: payload.kind });
	}

	private logSuppressed(trigger: string): void {
		this.ports.logInteraction?.("recap-suppressed", { trigger });
	}
}
