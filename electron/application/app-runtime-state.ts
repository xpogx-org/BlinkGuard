export class AppRuntimeState {
	blinkInterval: ReturnType<typeof setInterval> | null = null;
	cameraMonitoringInterval: ReturnType<typeof setInterval> | null = null;
	exerciseInterval: ReturnType<typeof setInterval> | null = null;
	exerciseSnoozeTimeout: ReturnType<typeof setTimeout> | null = null;
	lookAwayInterval: ReturnType<typeof setInterval> | null = null;
	lookAwaySnoozeTimeout: ReturnType<typeof setTimeout> | null = null;
	blinkSnoozeTimeout: ReturnType<typeof setTimeout> | null = null;
	cameraThresholdUpdateTimeout: ReturnType<typeof setTimeout> | null = null;
	noFaceDebounceTimer: ReturnType<typeof setTimeout> | null = null;
	noFaceAutoStopTimer: ReturnType<typeof setTimeout> | null = null;
	faceReturnDebounceTimer: ReturnType<typeof setTimeout> | null = null;

	blinkReminderActive = false;
	mgdReminderLoopActive = false;
	isExerciseShowing = false;
	isLookAwayShowing = false;
	isFaceDetected = false;
	isAutoResuming = false;
	/** Last real blink / grace credit (never auto-dismiss). */
	lastBlinkTime = Date.now();
	/** Last reminder show/auto-dismiss; used to avoid spam without forging blink credit. */
	lastReminderShownAt = Date.now();
	/** Epoch ms until which blink popups are suppressed (0 = not snoozed). */
	blinkSnoozeUntil = 0;
	/** Epoch ms until which all interruptive prompts are hushed (0 = not timed hush). */
	promptSuppressUntil = 0;
	/** Sticky hush until End hush; in-memory only (cleared on quit). */
	promptHushUntilResume = false;
	promptSuppressTimeout: ReturnType<typeof setTimeout> | null = null;

	clearPromptHush(): void {
		this.promptSuppressUntil = 0;
		this.promptHushUntilResume = false;
		if (this.promptSuppressTimeout) {
			clearTimeout(this.promptSuppressTimeout);
			this.promptSuppressTimeout = null;
		}
	}

	clearReminderTimers(): void {
		if (this.blinkInterval) clearInterval(this.blinkInterval);
		if (this.cameraMonitoringInterval) clearInterval(this.cameraMonitoringInterval);
		if (this.cameraThresholdUpdateTimeout) {
			clearTimeout(this.cameraThresholdUpdateTimeout);
		}
		if (this.blinkSnoozeTimeout) clearTimeout(this.blinkSnoozeTimeout);
		this.blinkInterval = null;
		this.cameraMonitoringInterval = null;
		this.cameraThresholdUpdateTimeout = null;
		this.blinkSnoozeTimeout = null;
		this.blinkSnoozeUntil = 0;
		this.clearPromptHush();
		this.blinkReminderActive = false;
		this.mgdReminderLoopActive = false;
	}

	clearExerciseTimers(): void {
		if (this.exerciseInterval) clearInterval(this.exerciseInterval);
		if (this.exerciseSnoozeTimeout) clearTimeout(this.exerciseSnoozeTimeout);
		this.exerciseInterval = null;
		this.exerciseSnoozeTimeout = null;
		this.isExerciseShowing = false;
	}

	clearLookAwayTimers(): void {
		if (this.lookAwayInterval) clearInterval(this.lookAwayInterval);
		if (this.lookAwaySnoozeTimeout) clearTimeout(this.lookAwaySnoozeTimeout);
		this.lookAwayInterval = null;
		this.lookAwaySnoozeTimeout = null;
		this.isLookAwayShowing = false;
	}
}
