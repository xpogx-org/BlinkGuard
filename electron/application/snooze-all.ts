import type { AppPreferences } from "../../shared/preferences";
import { isPromptHushed } from "../../shared/session-pause-status";
import { promptSnoozeMs } from "../domain/reminder-policy";
import type { AppRuntimeState } from "./app-runtime-state";
import type { ExerciseService } from "./exercise-service";
import type { FocusPauseService } from "./focus-pause-service";
import type { LookAwayService } from "./look-away-service";
import type { ReminderService } from "./reminder-service";

export type PromptHushDeps = {
	reminders: Pick<ReminderService, "snooze">;
	exercises: Pick<ExerciseService, "suppressPrompts">;
	lookAway: Pick<LookAwayService, "suppressPrompts">;
	state: Pick<
		AppRuntimeState,
		| "promptSuppressUntil"
		| "promptHushUntilResume"
		| "promptSuppressTimeout"
		| "blinkSnoozeUntil"
		| "blinkSnoozeTimeout"
		| "exerciseSnoozeTimeout"
		| "lookAwaySnoozeTimeout"
	>;
	preferences: Pick<AppPreferences, "snoozeMinutes">;
	focusPause: Pick<FocusPauseService, "closeInterruptiveUi" | "pushState">;
	onHushStateChange?: () => void;
};

function clearHushSuppressState(
	state: Pick<
		PromptHushDeps["state"],
		| "promptSuppressUntil"
		| "promptHushUntilResume"
		| "promptSuppressTimeout"
		| "blinkSnoozeUntil"
		| "blinkSnoozeTimeout"
	>,
): void {
	state.promptSuppressUntil = 0;
	state.promptHushUntilResume = false;
	if (state.promptSuppressTimeout) {
		clearTimeout(state.promptSuppressTimeout);
		state.promptSuppressTimeout = null;
	}
	state.blinkSnoozeUntil = 0;
	if (state.blinkSnoozeTimeout) {
		clearTimeout(state.blinkSnoozeTimeout);
		state.blinkSnoozeTimeout = null;
	}
}

function schedulePromptHushExpiry(
	deps: Pick<
		PromptHushDeps,
		"state" | "focusPause" | "onHushStateChange"
	>,
	ms: number,
): void {
	if (deps.state.promptSuppressTimeout) {
		clearTimeout(deps.state.promptSuppressTimeout);
	}
	deps.state.promptSuppressTimeout = setTimeout(() => {
		clearHushSuppressState(deps.state);
		deps.focusPause.pushState();
		deps.onHushStateChange?.();
	}, ms);
}

/**
 * Hush all interruptive prompts for {@link promptSnoozeMs}(`snoozeMinutes`), a custom duration,
 * or until End hush. Tracking stays armed; camera keeps running.
 */
export function snoozeAllPrompts(
	deps: PromptHushDeps,
	options?: { durationMs?: number; untilResume?: boolean },
): void {
	deps.focusPause.closeInterruptiveUi();
	deps.reminders.snooze();
	deps.exercises.suppressPrompts();
	deps.lookAway.suppressPrompts();

	if (options?.untilResume) {
		if (deps.state.promptSuppressTimeout) {
			clearTimeout(deps.state.promptSuppressTimeout);
			deps.state.promptSuppressTimeout = null;
		}
		deps.state.promptSuppressUntil = 0;
		deps.state.promptHushUntilResume = true;
	} else {
		const ms =
			options?.durationMs ?? promptSnoozeMs(deps.preferences.snoozeMinutes);
		deps.state.promptHushUntilResume = false;
		deps.state.promptSuppressUntil = Date.now() + ms;
		schedulePromptHushExpiry(deps, ms);
	}

	deps.focusPause.pushState();
	deps.onHushStateChange?.();
}

/** End manual prompt hush early and resume normal cadence. */
export function endPromptHush(deps: PromptHushDeps): void {
	if (
		!isPromptHushed(
			deps.state.promptSuppressUntil,
			deps.state.promptHushUntilResume,
		)
	) {
		return;
	}
	clearHushSuppressState(deps.state);
	if (deps.state.exerciseSnoozeTimeout) {
		clearTimeout(deps.state.exerciseSnoozeTimeout);
		deps.state.exerciseSnoozeTimeout = null;
	}
	if (deps.state.lookAwaySnoozeTimeout) {
		clearTimeout(deps.state.lookAwaySnoozeTimeout);
		deps.state.lookAwaySnoozeTimeout = null;
	}
	deps.focusPause.pushState();
	deps.onHushStateChange?.();
}
