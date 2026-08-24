import {
	NOOP_EYE_CARE_STATS,
	type EyeCareStatsRecorder,
} from "../../shared/blink-stats";
import { resolveExercisePrompts, t } from "../../shared/i18n";
import {
	resolvePromptSurfaces,
	withNativeFallback,
} from "../../shared/notification-style";
import {
	sanitizeExercisePrompts,
	type AppPreferences,
} from "../../shared/preferences";
import {
	EXERCISE_POPUP_VISIBLE_MS,
	promptSnoozeMs,
} from "../domain/reminder-policy";
import type { AppRuntimeState } from "./app-runtime-state";
import type { PreferenceStore } from "./ports/preference-store";
import type { NotificationGate } from "./ports/notification-gate";
import {
	NO_OP_OS_NOTIFICATIONS,
	type ExerciseWindowPort,
	type NotificationSoundPort,
	type OsNotificationPort,
} from "./ports/runtime-ports";

const ALLOW_ALL_GATE: NotificationGate = {
	notificationsAllowed: () => true,
	pauseReason: () => null,
};

type PromptSession = { overlay: unknown | null };

export class ExerciseService {
	private session: PromptSession | null = null;

	constructor(
		private readonly preferences: AppPreferences,
		private readonly state: AppRuntimeState,
		private readonly store: PreferenceStore,
		private readonly windows: ExerciseWindowPort,
		private readonly sound: NotificationSoundPort,
		private readonly notificationGate: NotificationGate = ALLOW_ALL_GATE,
		private readonly osNotifications: OsNotificationPort = NO_OP_OS_NOTIFICATIONS,
		private readonly stats: EyeCareStatsRecorder = NOOP_EYE_CARE_STATS,
	) {}

	start(): void {
		if (this.state.exerciseInterval) clearInterval(this.state.exerciseInterval);
		this.state.exerciseInterval = setInterval(() => {
			const now = Date.now();
			const elapsed = now - this.store.get("lastExerciseTime", 0);
			if (
				this.preferences.eyeExercisesEnabled &&
				!this.state.isExerciseShowing &&
				elapsed >= this.preferences.exerciseInterval * 60 * 1000
			) {
				this.show();
			}
		}, 60 * 1000);
	}

	stop(): void {
		this.state.clearExerciseTimers();
		this.dismissVisible();
	}

	skip(): void {
		const wasShowing = this.session !== null;
		this.dismissVisible();
		this.store.set("lastExerciseTime", Date.now());
		if (wasShowing) this.stats.recordEyeCare("exercise", "skipped");
	}

	snooze(): void {
		const wasShowing = this.session !== null;
		this.dismissVisible();
		if (this.state.exerciseSnoozeTimeout) {
			clearTimeout(this.state.exerciseSnoozeTimeout);
		}
		this.state.exerciseSnoozeTimeout = setTimeout(
			() => this.show(),
			promptSnoozeMs(this.preferences.snoozeMinutes),
		);
		if (wasShowing) this.stats.recordEyeCare("exercise", "snoozed");
	}

	resetTimer(): void {
		this.store.set("lastExerciseTime", Date.now());
	}

	private show(): void {
		if (this.state.isExerciseShowing) return;
		if (this.state.isLookAwayShowing) return;
		if (this.shouldDeferForLookAway()) return;
		if (!this.notificationGate.notificationsAllowed()) return;
		this.sound.play("exercise");
		this.state.isExerciseShowing = true;
		this.store.set("lastExerciseTime", Date.now());

		const locale = this.preferences.locale === "uk" ? "uk" : "en";
		const prompts = resolveExercisePrompts(
			sanitizeExercisePrompts(this.preferences.exercisePrompts, locale),
			locale,
		);
		const rawIndex = this.store.get("exercisePromptIndex", 0);
		const index =
			(typeof rawIndex === "number" && Number.isFinite(rawIndex)
				? Math.floor(rawIndex)
				: 0) % prompts.length;
		const prompt = prompts[index];
		this.store.set("exercisePromptIndex", (index + 1) % prompts.length);

		const surfaces = resolvePromptSurfaces(
			this.preferences.notificationStyle,
			this.osNotifications.isSupported(),
		);
		let nativeShown = false;
		if (surfaces.native) {
			nativeShown = this.osNotifications.show(
				"exercise",
				{
					title: t(locale, "popup.exercise.title"),
					body: prompt,
					snoozeLabel: t(locale, "osToast.snooze"),
				},
				{ onFailed: () => this.fallbackOverlay(prompt) },
			).shown;
		}
		const planned = withNativeFallback(surfaces, nativeShown);
		let overlay: unknown | null = null;
		if (planned.overlay) {
			overlay = this.windows.showExercise(prompt, () => {
				this.state.isExerciseShowing = false;
				this.osNotifications.dismiss("exercise");
				this.session = null;
			});
		}
		if (planned.overlay && !overlay && !planned.nativeShown) {
			this.state.isExerciseShowing = false;
			return;
		}
		const session: PromptSession = { overlay };
		this.session = session;
		setTimeout(() => {
			this.endSessionIfCurrent(session);
		}, EXERCISE_POPUP_VISIBLE_MS);
	}

	private fallbackOverlay(prompt: string): void {
		if (!this.state.isExerciseShowing) return;
		if (this.session?.overlay) return;
		const overlay = this.windows.showExercise(prompt, () => {
			this.state.isExerciseShowing = false;
			this.osNotifications.dismiss("exercise");
			this.session = null;
		});
		if (this.session) this.session.overlay = overlay;
	}

	private endSessionIfCurrent(session: PromptSession): void {
		if (this.session !== session) return;
		this.stats.recordEyeCare("exercise", "completed");
		if (session.overlay) {
			if (this.windows.closeExerciseIfCurrent(session.overlay)) {
				this.state.isExerciseShowing = false;
			}
		} else {
			this.state.isExerciseShowing = false;
		}
		this.osNotifications.dismiss("exercise");
		this.session = null;
	}

	/** Prefer 20-20-20 when both eye-care prompts are due in the same tick. */
	private shouldDeferForLookAway(): boolean {
		if (!this.preferences.lookAwayEnabled) return false;
		const elapsed =
			Date.now() - this.store.get("lastLookAwayTime", 0);
		return elapsed >= this.preferences.lookAwayInterval * 60 * 1000;
	}

	dismissVisible(): void {
		this.windows.closeExercise();
		this.osNotifications.dismiss("exercise");
		this.state.isExerciseShowing = false;
		this.session = null;
	}
}
