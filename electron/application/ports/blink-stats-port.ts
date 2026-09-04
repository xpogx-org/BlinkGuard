export interface BlinkStatsPort {
	recordBlink(): void;
	onTrackingStart(): void;
	onTrackingStop(): void;
	/** Raw camera face presence for coverage BPM / face-only trackingMs. */
	onFaceVisibility(visible: boolean): void;
	/**
	 * Camera face-aware → true; MGD / timer-only → false.
	 * Controls whether BPM and trackingMs use face-visible time.
	 */
	setFaceCoverageMode(enabled: boolean): void;
	/** Live BPM snapshot for prompt ladder / backoff (optional in older mocks). */
	getSnapshot?(now?: Date): {
		blinksPerMinute: number;
		blinkRateReady: boolean;
	};
	/** Banked snooze tokens from the rewards shop (optional in older mocks). */
	getSnoozeTokenCharges?(): number;
}

export interface BlinkRateCoachingPort {
	start(): void;
	stop(): void;
}

export interface CalibrationNudgePort {
	start(): void;
	stop(): void;
	onDriftNudge(nowMs?: number): void;
}
