import { BrowserWindow } from "electron";
import fs from "node:fs";
import path from "node:path";
import { IPC_CHANNELS } from "../../../shared/ipc-channels";
import {
	sanitizeSoundVolume,
	type AppPreferences,
} from "../../../shared/preferences";
import type { AppPaths } from "../paths/app-paths";
import { SoundPlayQueue } from "./sound-play-queue";

export type NotificationSoundKind =
	| "blink"
	| "exercise"
	| "lookAway"
	| "starting"
	| "stopped"
	| "cheer";

export type PlaySoundPayload = {
	kind: NotificationSoundKind;
	volume: number;
	path?: string;
	mode?: "file" | "cheer";
	cheerTheme?: string;
};

export type AudioErrorPayload = {
	kind?: NotificationSoundKind | string;
	reason:
		| "play-rejected"
		| "cheer-not-running"
		| "cheer-no-context"
		| "sink-failed"
		| "no-audio-element";
	message?: string;
	contextState?: string;
};

type SoundPlayJob = {
	payload: PlaySoundPayload;
	timeoutMs: number;
};

const SOUND_FILES: Record<Exclude<NotificationSoundKind, "cheer">, string> = {
	blink: "notification.mp3",
	exercise: "exercisePopup.mp3",
	lookAway: "lookAwayPopup.mp3",
	starting: "startingPopup.mp3",
	stopped: "stoppedPopup.mp3",
};

const PLAY_TIMEOUT_MS: Record<NotificationSoundKind, number> = {
	blink: 3000,
	exercise: 3000,
	lookAway: 3000,
	starting: 3000,
	stopped: 3000,
	cheer: 4000,
};

export class NotificationSoundPlayer {
	private window: BrowserWindow | null = null;
	private ready = false;
	private disposed = false;
	private windowGeneration = 0;
	private jobEpoch = 0;
	private watchdog: ReturnType<typeof setTimeout> | null = null;
	private readonly queue = new SoundPlayQueue<SoundPlayJob>();

	constructor(
		private readonly paths: AppPaths,
		private readonly preferences: AppPreferences,
		private readonly isProd: boolean,
	) {}

	play(
		kind: NotificationSoundKind,
		options?: { force?: boolean; volume?: number; cheerTheme?: string },
	): void {
		if (this.disposed) return;
		if (!options?.force && !this.preferences.soundEnabled) return;

		const volumePercent =
			options?.volume !== undefined
				? sanitizeSoundVolume(options.volume)
				: this.preferences.soundVolume;
		if (volumePercent <= 0) return;

		const volume = Math.min(1, Math.max(0, volumePercent / 100));
		const payload = this.buildPayload(kind, volume, options?.cheerTheme);
		if (!payload) return;

		const job: SoundPlayJob = {
			payload,
			timeoutMs: PLAY_TIMEOUT_MS[kind],
		};
		const { started } = this.queue.enqueue(job);
		this.ensureWindow();
		if (started) this.sendOrWait(job);
	}

	stop(): void {
		if (this.disposed) return;
		this.jobEpoch += 1;
		this.clearWatchdog();
		this.queue.clear();
		if (this.window && !this.window.isDestroyed() && this.ready) {
			this.window.webContents.send(IPC_CHANNELS.stopSound);
		}
	}

	dispose(): void {
		this.disposed = true;
		this.clearWatchdog();
		this.queue.clear();
		this.destroyWindow();
	}

	private buildPayload(
		kind: NotificationSoundKind,
		volume: number,
		cheerTheme?: string,
	): PlaySoundPayload | null {
		if (kind === "cheer") {
			const payload: PlaySoundPayload = { kind, mode: "cheer", volume };
			if (typeof cheerTheme === "string" && cheerTheme.length > 0) {
				payload.cheerTheme = cheerTheme;
			}
			return payload;
		}

		const soundPath = this.isProd
			? path.join(
					process.resourcesPath,
					"app.asar.unpacked",
					"public",
					"sounds",
					SOUND_FILES[kind],
				)
			: path.join(this.paths.root, "public", "sounds", SOUND_FILES[kind]);

		if (!fs.existsSync(soundPath)) {
			console.error(`Notification sound missing: ${soundPath}`);
			return null;
		}

		return { kind, mode: "file", path: soundPath, volume };
	}

	private ensureWindow(): void {
		if (this.disposed) return;
		if (this.window && !this.window.isDestroyed()) return;
		this.createWindow();
	}

	private createWindow(): void {
		this.ready = false;
		const generation = ++this.windowGeneration;
		const window = new BrowserWindow({
			width: 1,
			height: 1,
			show: false,
			skipTaskbar: true,
			webPreferences: {
				nodeIntegration: false,
				contextIsolation: true,
				backgroundThrottling: false,
				preload: this.paths.preload,
			},
		});
		this.window = window;

		window.webContents.on("did-finish-load", () => {
			if (
				this.disposed ||
				this.windowGeneration !== generation ||
				this.window !== window
			) {
				return;
			}
			this.ready = true;
			const current = this.queue.current;
			if (current) this.sendPlay(current);
		});
		window.webContents.on("did-fail-load", (_event, code, description) => {
			if (this.window !== window) return;
			console.error(
				"Notification sound player failed to load:",
				code,
				description,
			);
			this.onFinished();
		});
		window.webContents.on("ipc-message", (_event, channel, ...args) => {
			if (this.window !== window || window.isDestroyed()) return;
			if (channel === IPC_CHANNELS.audioFinished) {
				this.onFinished();
				return;
			}
			if (channel === IPC_CHANNELS.audioError) {
				this.onAudioError(args[0]);
				return;
			}
			if (channel === IPC_CHANNELS.audioOutputInvalidated) {
				this.onOutputInvalidated();
			}
		});
		window.on("closed", () => {
			if (this.window === window) {
				this.window = null;
				this.ready = false;
			}
		});

		void window.loadFile(path.join(this.paths.publicDir, "sound-player.html"));
	}

	private destroyWindow(): void {
		this.ready = false;
		this.windowGeneration += 1;
		const window = this.window;
		this.window = null;
		if (window && !window.isDestroyed()) {
			window.destroy();
		}
	}

	private sendOrWait(job: SoundPlayJob): void {
		if (this.ready && this.window && !this.window.isDestroyed()) {
			this.sendPlay(job);
		}
	}

	private sendPlay(job: SoundPlayJob): void {
		if (!this.window || this.window.isDestroyed() || !this.ready) return;
		this.jobEpoch += 1;
		const epoch = this.jobEpoch;
		this.clearWatchdog();
		this.window.webContents.send(IPC_CHANNELS.playSound, job.payload);
		this.watchdog = setTimeout(() => {
			if (epoch !== this.jobEpoch) return;
			this.onFinished();
		}, job.timeoutMs);
	}

	private onFinished(): void {
		this.jobEpoch += 1;
		this.clearWatchdog();
		if (this.disposed) return;
		const next = this.queue.finish();
		if (next) this.sendOrWait(next);
	}

	private onAudioError(payload: unknown): void {
		const error = payload as AudioErrorPayload | undefined;
		console.error(
			"Notification sound failed:",
			error?.reason,
			error?.kind,
			error?.message ?? "",
			error?.contextState ?? "",
		);
	}

	private onOutputInvalidated(): void {
		if (this.disposed) return;
		this.clearWatchdog();
		const wasPlaying = this.queue.isPlaying;
		this.queue.interruptPlaying();
		// Drop the old window first so a trailing audio-finished from the
		// dying renderer cannot advance the queue (ipc-message is window-bound).
		this.destroyWindow();
		this.ensureWindow();
		if (wasPlaying) {
			const next = this.queue.finish();
			if (next) this.sendOrWait(next);
		}
	}

	private clearWatchdog(): void {
		if (this.watchdog !== null) {
			clearTimeout(this.watchdog);
			this.watchdog = null;
		}
	}
}
