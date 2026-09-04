import {
	pluralKey,
	resolveLookAwayHint,
	resolveLookAwayTitle,
	t,
} from "../../shared/i18n";
import {
	resolvePromptSurfaces,
	withNativeFallback,
} from "../../shared/notification-style";
import {
	NOOP_EYE_CARE_STATS,
	type EyeCareStatsRecorder,
} from "../../shared/blink-stats";
import {
	sanitizeLookAwayHint,
	sanitizeLookAwayTitle,
	type AppPreferences,
} from "../../shared/preferences";
import { promptSnoozeMs } from "../domain/reminder-policy";
import type { AppRuntimeState } from "./app-runtime-state";
import type { BlinkStatsPort } from "./ports/blink-stats-port";
import type { PreferenceStore } from "./ports/preference-store";
import type { NotificationGate } from "./ports/notification-gate";
import { tokenSnoozeToastLabel } from "./snooze-token-prompt";
import {
	NO_OP_OS_NOTIFICATIONS,
	type LookAwayWindowPort,
	type NotificationSoundPort,
	type OsNotificationPort,
} from "./ports/runtime-ports";

const ALLOW_ALL_GATE: NotificationGate = {
	notificationsAllowed: () => true,
	pauseReason: () => null,
};

type PromptSession = { overlay: unknown | null };

export class LookAwayService {
	private session: PromptSession | null = null;

	constructor(
		private readonly preferences: AppPreferences,
		private readonly state: AppRuntimeState,
		private readonly store: PreferenceStore,
		private readonly windows: LookAwayWindowPort,
		private readonly sound: NotificationSoundPort,
		private readonly notificationGate: NotificationGate = ALLOW_ALL_GATE,
		private readonly osNotifications: OsNotificationPort = NO_OP_OS_NOTIFICATIONS,
		private readonly stats: EyeCareStatsRecorder & Pick<
			BlinkStatsPort,
			"getSnoozeTokenCharges"
		> = NOOP_EYE_CARE_STATS,
	) {}

	start(): void {
		if (this.state.lookAwayInterval) clearInterval(this.state.lookAwayInterval);
		this.state.lookAwayInterval = setInterval(() => {
			const now = Date.now();
			const elapsed = now - this.store.get("lastLookAwayTime", 0);
			if (
				this.preferences.lookAwayEnabled &&
				!this.state.isLookAwayShowing &&
				elapsed >= this.preferences.lookAwayInterval * 60 * 1000
			) {
				this.show();
			}
		}, 60 * 1000);
	}

	stop(): void {
		this.state.clearLookAwayTimers();
		this.dismissVisible();
	}

	skip(): void {
		const wasShowing = this.session !== null;
		this.dismissVisible();
		this.store.set("lastLookAwayTime", Date.now());
		if (wasShowing) this.stats.recordEyeCare("lookAway", "skipped");
	}

	snooze(): void {
		const wasShowing = this.session !== null;
		this.dismissVisible();
		// Defer the regular cadence so the 60s tick does not race the snooze.
		this.store.set("lastLookAwayTime", Date.now());
		if (this.state.lookAwaySnoozeTimeout) {
			clearTimeout(this.state.lookAwaySnoozeTimeout);
		}
		this.state.lookAwaySnoozeTimeout = setTimeout(
			() => this.show(),
			promptSnoozeMs(this.preferences.snoozeMinutes),
		);
		if (wasShowing) this.stats.recordEyeCare("lookAway", "snoozed");
	}

	/** Suppress look-away prompts without scheduling a deferred show. */
	suppressPrompts(): void {
		this.dismissVisible();
		this.store.set("lastLookAwayTime", Date.now());
		if (this.state.lookAwaySnoozeTimeout) {
			clearTimeout(this.state.lookAwaySnoozeTimeout);
			this.state.lookAwaySnoozeTimeout = null;
		}
	}

	resetTimer(): void {
		this.store.set("lastLookAwayTime", Date.now());
	}

	private show(): void {
		if (this.state.isLookAwayShowing) return;
		if (this.state.isExerciseShowing) return;
		if (!this.notificationGate.notificationsAllowed()) return;
		this.sound.play("lookAway");
		this.state.isLookAwayShowing = true;
		this.store.set("lastLookAwayTime", Date.now());

		const locale = this.preferences.locale === "uk" ? "uk" : "en";
		const title = resolveLookAwayTitle(
			sanitizeLookAwayTitle(this.preferences.lookAwayTitle, locale),
			locale,
		);
		const hint = resolveLookAwayHint(
			sanitizeLookAwayHint(this.preferences.lookAwayHint, locale),
			locale,
		);
		const durationSec = Math.max(1, this.preferences.lookAwayDuration);
		const durationLabel = t(
			locale,
			pluralKey("osToast.lookAway.body", locale, durationSec),
			{ n: durationSec },
		);
		const body = `${hint} (${durationLabel})`;

		const surfaces = resolvePromptSurfaces(
			this.preferences.notificationStyle,
			this.osNotifications.isSupported(),
		);
		let nativeShown = false;
		if (surfaces.native) {
			const tokenLabel = tokenSnoozeToastLabel(
				locale,
				this.preferences.snoozeMinutes,
				this.stats.getSnoozeTokenCharges?.() ?? 0,
			);
			nativeShown = this.osNotifications.show(
				"lookAway",
				{
					title,
					body,
					snoozeLabel: t(locale, "osToast.snooze"),
					...(tokenLabel ? { tokenSnoozeLabel: tokenLabel } : {}),
				},
				{ onFailed: () => this.fallbackOverlay() },
			).shown;
		}
		const planned = withNativeFallback(surfaces, nativeShown);
		let overlay: unknown | null = null;
		if (planned.overlay) {
			overlay = this.windows.showLookAway(() => {
				this.state.isLookAwayShowing = false;
				this.osNotifications.dismiss("lookAway");
				this.session = null;
			});
		}
		if (planned.overlay && !overlay && !planned.nativeShown) {
			this.state.isLookAwayShowing = false;
			return;
		}
		const session: PromptSession = { overlay };
		this.session = session;
		const durationMs = durationSec * 1000;
		setTimeout(() => {
			this.endSessionIfCurrent(session);
		}, durationMs);
	}

	private fallbackOverlay(): void {
		if (!this.state.isLookAwayShowing) return;
		if (this.session?.overlay) return;
		const overlay = this.windows.showLookAway(() => {
			this.state.isLookAwayShowing = false;
			this.osNotifications.dismiss("lookAway");
			this.session = null;
		});
		if (this.session) this.session.overlay = overlay;
	}

	private endSessionIfCurrent(session: PromptSession): void {
		if (this.session !== session) return;
		this.stats.recordEyeCare("lookAway", "completed");
		if (session.overlay) {
			if (this.windows.closeLookAwayIfCurrent(session.overlay)) {
				this.state.isLookAwayShowing = false;
			}
		} else {
			this.state.isLookAwayShowing = false;
		}
		this.osNotifications.dismiss("lookAway");
		this.session = null;
	}

	dismissVisible(): void {
		this.windows.closeLookAway();
		this.osNotifications.dismiss("lookAway");
		this.state.isLookAwayShowing = false;
		this.session = null;
	}
}
