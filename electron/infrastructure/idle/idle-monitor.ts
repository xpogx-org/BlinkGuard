import { powerMonitor } from "electron";

export type IdleMonitorOptions = {
	idleThresholdMs: number;
	pollIntervalMs: number;
	enabled: boolean;
	isTracking: () => boolean;
	isSuppressed: () => boolean;
	onIdleExceeded: () => void;
	schedule?: typeof setInterval;
	clearSchedule?: typeof clearInterval;
};

/**
 * Poll system idle while tracking; fire auto-stop when threshold exceeded.
 * No-op when `enabled` is false (stub session-activity hosts).
 */
export class IdleMonitor {
	private timer: ReturnType<typeof setInterval> | null = null;
	private readonly schedule: typeof setInterval;
	private readonly clearSchedule: typeof clearInterval;

	constructor(private readonly options: IdleMonitorOptions) {
		this.schedule = options.schedule ?? setInterval;
		this.clearSchedule = options.clearSchedule ?? clearInterval;
	}

	start(): void {
		if (!this.options.enabled) return;
		this.stop();
		this.timer = this.schedule(
			() => this.poll(),
			this.options.pollIntervalMs,
		);
	}

	stop(): void {
		if (this.timer === null) return;
		this.clearSchedule(this.timer);
		this.timer = null;
	}

	private poll(): void {
		if (!this.options.isTracking()) return;
		if (this.options.isSuppressed()) return;
		const idleMs = powerMonitor.getSystemIdleTime() * 1000;
		if (idleMs < this.options.idleThresholdMs) return;
		this.stop();
		this.options.onIdleExceeded();
	}
}
