import type { AppPreferences } from "../../shared/preferences";
import {
	resolveSessionIdleCause,
	resolveSessionPauseMode,
	SESSION_RESUME_DELAY_MS,
	sessionPauseRank,
	type SessionActivityFlags,
	type SessionPauseMode,
} from "../domain/session-activity-policy";
import type { AppRuntimeState } from "./app-runtime-state";
import type { ExerciseService } from "./exercise-service";
import type { FocusPauseService } from "./focus-pause-service";
import type { LookAwayService } from "./look-away-service";
import {
	EMPTY_SESSION_ACTIVITY,
	sameSessionActivitySnapshot,
	type SessionActivitySnapshot,
} from "./ports/session-activity-port";
import type { ReminderService } from "./reminder-service";

type SessionPauseSnapshot = {
	tracking: boolean;
	exercises: boolean;
	lookAway: boolean;
};

type SessionPauseServiceOptions = {
	resumeDelayMs?: number;
	schedule?: typeof setTimeout;
	clearSchedule?: typeof clearTimeout;
	onEnterInactive?: () => void;
};

type SessionReminders = Pick<
	ReminderService,
	| "pauseForSession"
	| "pauseCameraForClamshell"
	| "pauseCameraForFocus"
	| "resumeAfterSleep"
	| "resumeCameraIfNeeded"
>;

/**
 * Pause tracking / eye-care on sleep, lock, or display-off; restore after a
 * short wake delay so the camera can re-enumerate.
 */
export class SessionPauseService {
	private suspended = false;
	private locked = false;
	private environment: SessionActivitySnapshot = EMPTY_SESSION_ACTIVITY;
	private mode: SessionPauseMode = "active";
	private snapshot: SessionPauseSnapshot | null = null;
	private resumeTimer: ReturnType<typeof setTimeout> | null = null;
	private readonly resumeDelayMs: number;
	private readonly schedule: typeof setTimeout;
	private readonly clearSchedule: typeof clearTimeout;
	private readonly onEnterInactive?: () => void;

	constructor(
		private readonly preferences: AppPreferences,
		private readonly state: AppRuntimeState,
		private readonly reminders: SessionReminders,
		private readonly exercises: Pick<
			ExerciseService,
			"start" | "stop" | "resetTimer"
		>,
		private readonly lookAway: Pick<
			LookAwayService,
			"start" | "stop" | "resetTimer"
		>,
		private readonly focusPause: Pick<
			FocusPauseService,
			"setSessionOverlay" | "recompute"
		>,
		options: SessionPauseServiceOptions = {},
	) {
		this.resumeDelayMs = options.resumeDelayMs ?? SESSION_RESUME_DELAY_MS;
		this.schedule = options.schedule ?? setTimeout;
		this.clearSchedule = options.clearSchedule ?? clearTimeout;
		this.onEnterInactive = options.onEnterInactive;
	}

	setPowerFlags(flags: { suspended?: boolean; locked?: boolean }): void {
		let changed = false;
		if (flags.suspended !== undefined && flags.suspended !== this.suspended) {
			this.suspended = flags.suspended;
			changed = true;
		}
		if (flags.locked !== undefined && flags.locked !== this.locked) {
			this.locked = flags.locked;
			changed = true;
		}
		if (changed) this.sync();
	}

	setEnvironment(snapshot: SessionActivitySnapshot): void {
		if (sameSessionActivitySnapshot(snapshot, this.environment)) return;
		this.environment = snapshot;
		this.sync();
	}

	dispose(): void {
		this.cancelResume();
	}

	private sync(): void {
		const flags = this.flags();
		const next = resolveSessionPauseMode(flags);
		if (next === this.mode) {
			this.cancelResume();
			this.pushOverlay(flags);
			return;
		}
		if (sessionPauseRank(next) > sessionPauseRank(this.mode)) {
			this.cancelResume();
			this.applyMode(next, flags);
			return;
		}
		this.scheduleResume(next);
	}

	private flags(): SessionActivityFlags {
		return {
			suspended: this.suspended,
			locked: this.locked,
			displaysAsleep: this.environment.displaysAsleep,
			lidClosed: this.environment.lidClosed,
		};
	}

	private pushOverlay(flags: SessionActivityFlags = this.flags()): void {
		this.focusPause.setSessionOverlay({
			mode: this.mode,
			cause: resolveSessionIdleCause(flags),
		});
	}

	private scheduleResume(next: SessionPauseMode): void {
		this.cancelResume();
		this.resumeTimer = this.schedule(() => {
			this.resumeTimer = null;
			this.applyMode(next);
		}, this.resumeDelayMs);
	}

	private cancelResume(): void {
		if (this.resumeTimer === null) return;
		this.clearSchedule(this.resumeTimer);
		this.resumeTimer = null;
	}

	private applyMode(
		next: SessionPauseMode,
		flags: SessionActivityFlags = this.flags(),
	): void {
		const prev = this.mode;
		if (prev === next) return;
		this.mode = next;
		this.pushOverlay(flags);

		if (next === "inactive") {
			this.enterInactive();
		} else if (prev === "inactive") {
			this.leaveInactive(next);
		} else if (next === "camera-only") {
			this.reminders.pauseCameraForClamshell();
		} else if (prev === "camera-only" && next === "active") {
			this.focusPause.recompute();
			this.reminders.resumeAfterSleep({ restoreStats: false });
		}
	}

	private enterInactive(): void {
		this.snapshot = {
			tracking: this.preferences.isTracking,
			exercises: this.state.exerciseInterval !== null,
			lookAway: this.state.lookAwayInterval !== null,
		};
		if (this.preferences.isTracking) {
			this.reminders.pauseForSession();
		} else {
			this.reminders.pauseCameraForFocus("session");
		}
		this.exercises.stop();
		this.lookAway.stop();
		this.onEnterInactive?.();
	}

	private leaveInactive(next: SessionPauseMode): void {
		const snap = this.snapshot;
		this.snapshot = null;
		if (snap?.exercises && this.preferences.eyeExercisesEnabled) {
			this.exercises.resetTimer();
			this.exercises.start();
		}
		if (snap?.lookAway && this.preferences.lookAwayEnabled) {
			this.lookAway.resetTimer();
			this.lookAway.start();
		}
		this.focusPause.recompute();
		if (snap?.tracking && this.preferences.isTracking) {
			this.reminders.resumeAfterSleep({
				releaseCamera: next === "active",
				restoreStats: true,
			});
		} else if (next === "active") {
			this.reminders.resumeCameraIfNeeded("session");
		}
	}
}
