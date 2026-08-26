import { app, dialog } from "electron";
import electronUpdater from "electron-updater";
import type {
	AutoUpdateStatus,
	AutoUpdateSurface,
} from "../../../shared/auto-update";
import { t, type Locale } from "../../../shared/i18n";
import { killOrphanedSidecarProcesses } from "../process/process-cleanup";
import { hasUpdateFeed, isAutoUpdatePlatform } from "./update-feed";

// electron-updater is CJS; named ESM imports fail under Electron's ESM loader.
const { autoUpdater } = electronUpdater;

/** How often a packaged app re-checks GitHub Releases while running. */
export const UPDATE_CHECK_MS = 6 * 60 * 60 * 1000;

export type CheckForUpdatesOptions = {
	/** When true, use modal dialog UI and bring the main window forward. */
	interactive?: boolean;
	/**
	 * Interval / background poll: suppress checking / upToDate / error toasts.
	 * Still surfaces available → downloading → ready.
	 */
	background?: boolean;
};

export type AutoUpdateUiPort = {
	emit(status: AutoUpdateStatus): void;
	ensureVisible(): void;
	canHostInAppUi(): boolean;
};

/** True when `candidate` is a strictly newer semver than `baseline` (major.minor.patch). */
export function isNewerVersion(candidate: string, baseline: string): boolean {
	const next = parseSemverTriplet(candidate);
	const prev = parseSemverTriplet(baseline);
	if (!next || !prev) {
		return candidate.trim() !== baseline.trim() && candidate.trim() > baseline.trim();
	}
	for (let i = 0; i < 3; i++) {
		if (next[i] !== prev[i]) return next[i] > prev[i];
	}
	return false;
}

function parseSemverTriplet(version: string): [number, number, number] | null {
	const match = version
		.trim()
		.replace(/^v/i, "")
		.match(/^(\d+)\.(\d+)\.(\d+)/);
	if (!match) return null;
	return [
		Number(match[1]),
		Number(match[2]),
		Number(match[3]),
	];
}

/**
 * Windows / macOS GitHub Releases updater. Hard no-op when unpackaged,
 * unsupported platform, or when the build has no embedded feed
 * (`app-update.yml` from publish config).
 *
 * Silent launch → toast surface (ephemeral); consent prompt on explicit quit.
 * Manual About/tray → dialog with Restart / Later for interactive checks.
 * Background interval → quiet unless an update is actually available.
 * Install only via explicit Restart or quit-time consent (`autoInstallOnAppQuit`
 * is false).
 *
 * Always re-checks GitHub latest even with a staged download so a newer release
 * published before Restart replaces the stale package (no version ladder; feed
 * is already `/releases/latest`).
 */
export class AutoUpdateService {
	private enabled = false;
	private checking = false;
	private downloadedVersion: string | null = null;
	private availableVersion: string | null = null;
	/** True while an interactive (About / tray) check is in flight. */
	private interactivePending = false;
	/** True while a background interval check is in flight. */
	private backgroundPending = false;
	/**
	 * After Restart: re-check GitHub once; install only when staged matches
	 * latest (or the check fails soft).
	 */
	private installAfterFreshCheck = false;
	private updateTimer: ReturnType<typeof setInterval> | null = null;

	constructor(
		private readonly getLocale: () => Locale,
		private readonly ui: AutoUpdateUiPort,
		/** Graceful sidecar stop (stdin quit) before `quitAndInstall`; `/F` fallback inside. */
		private readonly stopSidecar: () => Promise<void> = killOrphanedSidecarProcesses,
	) {}

	/** Call once after `app.whenReady`. Safe if updater cannot start. */
	start(): void {
		try {
			if (!app.isPackaged) return;
			if (!isAutoUpdatePlatform()) return;
			if (!hasUpdateFeed(process.resourcesPath)) return;

			autoUpdater.autoDownload = true;
			autoUpdater.autoInstallOnAppQuit = false;

			autoUpdater.on("error", (error) => {
				console.error("Auto-update error:", error);
				this.checking = false;
				const interactive = this.interactivePending;
				const background = this.backgroundPending;
				const installPending = this.installAfterFreshCheck;
				this.clearPendingFlags();
				// Soft-fail: still install the staged package if Restart asked for it.
				if (installPending && this.downloadedVersion) {
					this.performQuitAndInstall();
					return;
				}
				if (background) return;
				this.present(
					{ state: "error", surface: this.surfaceFor(interactive) },
					interactive,
				);
			});

			autoUpdater.on("update-not-available", () => {
				this.checking = false;
				const interactive = this.interactivePending;
				const background = this.backgroundPending;
				const installPending = this.installAfterFreshCheck;
				this.clearPendingFlags();
				// Running app is already latest; drop any obsolete staged package.
				this.downloadedVersion = null;
				this.availableVersion = null;
				if (installPending) return;
				if (background) return;
				this.present(
					{ state: "upToDate", surface: this.surfaceFor(interactive) },
					interactive,
				);
			});

			autoUpdater.on("update-available", (info) => {
				this.checking = false;
				const version =
					typeof info?.version === "string" && info.version.length > 0
						? info.version
						: "…";
				const interactive = this.interactivePending;
				const background = this.backgroundPending;

				// Already staged this exact latest — no second download storm.
				if (
					this.downloadedVersion &&
					!isNewerVersion(version, this.downloadedVersion)
				) {
					if (this.installAfterFreshCheck) {
						this.performQuitAndInstall();
						return;
					}
					this.clearPendingFlags();
					if (background) return;
					this.presentReady(this.downloadedVersion, interactive);
					return;
				}

				// Stale staged package — let autoDownload pull the new latest.
				if (
					this.downloadedVersion &&
					isNewerVersion(version, this.downloadedVersion)
				) {
					this.downloadedVersion = null;
				}

				this.availableVersion = version;
				this.present(
					{
						state: "available",
						version,
						surface: this.surfaceFor(interactive),
					},
					interactive,
				);
			});

			autoUpdater.on("download-progress", (progress) => {
				const version = this.availableVersion ?? "…";
				const raw =
					typeof progress?.percent === "number" ? progress.percent : 0;
				const percent = Math.max(0, Math.min(100, Math.round(raw)));
				const interactive = this.interactivePending;
				this.present(
					{
						state: "downloading",
						version,
						percent,
						surface: this.surfaceFor(interactive),
					},
					interactive,
				);
			});

			autoUpdater.on("update-downloaded", (info) => {
				this.checking = false;
				const wasInteractive = this.interactivePending;
				const installPending = this.installAfterFreshCheck;
				this.clearPendingFlags();
				const version =
					typeof info?.version === "string" && info.version.length > 0
						? info.version
						: (this.availableVersion ?? "…");
				this.downloadedVersion = version;
				this.availableVersion = version;
				if (installPending) {
					this.performQuitAndInstall();
					return;
				}
				this.presentReady(version, wasInteractive);
			});

			this.enabled = true;
			this.updateTimer = setInterval(() => {
				this.checkForUpdates({ background: true });
			}, UPDATE_CHECK_MS);
		} catch (error) {
			console.error("Auto-update init failed:", error);
			this.enabled = false;
		}
	}

	/** Stop the periodic poll (app shutdown). Safe to call multiple times. */
	dispose(): void {
		if (this.updateTimer !== null) {
			clearInterval(this.updateTimer);
			this.updateTimer = null;
		}
	}

	/** Quiet launch check, background poll, or interactive tray / About. Never throws. */
	checkForUpdates(options: CheckForUpdatesOptions = {}): void {
		try {
			if (!this.enabled) {
				if (options.interactive) {
					this.present(
						{ state: "unavailable", surface: "dialog" },
						true,
					);
				}
				return;
			}

			const interactive = Boolean(options.interactive);
			const background = Boolean(options.background) && !interactive;

			if (interactive) {
				this.interactivePending = true;
				this.backgroundPending = false;
			} else if (background) {
				this.backgroundPending = true;
				this.interactivePending = false;
			}

			// Always re-query GitHub latest (do not sticky-skip when staged).

			if (!background && !this.downloadedVersion) {
				this.present(
					{ state: "checking", surface: this.surfaceFor(interactive) },
					interactive,
				);
			} else if (!background && this.downloadedVersion && interactive) {
				// Interactive: show checking briefly while we confirm staged is still latest.
				this.present(
					{ state: "checking", surface: "dialog" },
					true,
				);
			}

			if (this.checking) return;
			this.checking = true;

			void autoUpdater.checkForUpdates().catch((error) => {
				console.error("Auto-update check failed:", error);
				this.checking = false;
				const wasInteractive = this.interactivePending;
				const wasBackground = this.backgroundPending;
				const installPending = this.installAfterFreshCheck;
				this.clearPendingFlags();
				if (installPending && this.downloadedVersion) {
					this.performQuitAndInstall();
					return;
				}
				if (wasBackground) return;
				this.present(
					{ state: "error", surface: this.surfaceFor(wasInteractive) },
					wasInteractive,
				);
			});
		} catch (error) {
			console.error("Auto-update check failed:", error);
			this.checking = false;
			const installPending = this.installAfterFreshCheck;
			this.clearPendingFlags();
			if (installPending && this.downloadedVersion) {
				this.performQuitAndInstall();
				return;
			}
			if (options.interactive) {
				this.present({ state: "error", surface: "dialog" }, true);
			}
		}
	}

	/**
	 * Tray Quit / before-quit: ask whether to install a staged update.
	 * Returns `proceed` to continue normal quit, `cancel` to stay running or
	 * when install was chosen (`quitAndInstall` handles exit).
	 */
	async resolveQuitWithStagedUpdate(): Promise<"proceed" | "cancel"> {
		if (!this.downloadedVersion) return "proceed";
		try {
			const locale = this.getLocale();
			const { response } = await dialog.showMessageBox({
				type: "info",
				title: t(locale, "updates.quitPrompt.title"),
				message: t(locale, "updates.quitPrompt.message", {
					version: this.downloadedVersion,
				}),
				buttons: [
					t(locale, "updates.quitPrompt.install"),
					t(locale, "updates.quitPrompt.quitWithout"),
					t(locale, "updates.quitPrompt.cancel"),
				],
				defaultId: 0,
				cancelId: 2,
				noLink: true,
			});
			if (response === 0) {
				this.installUpdate();
				return "cancel";
			}
			if (response === 1) return "proceed";
			return "cancel";
		} catch (error) {
			console.error("Auto-update quit prompt failed:", error);
			return "proceed";
		}
	}

	/**
	 * Install a previously downloaded update (About / in-app Restart).
	 * Re-checks GitHub latest first so a newer release replaces a stale stage.
	 */
	installUpdate(): void {
		if (!this.downloadedVersion) return;
		if (!this.enabled) {
			this.performQuitAndInstall();
			return;
		}
		this.installAfterFreshCheck = true;
		this.checkForUpdates({ interactive: true });
	}

	private performQuitAndInstall(): void {
		this.installAfterFreshCheck = false;
		this.clearPendingFlags();
		if (!this.downloadedVersion) return;
		try {
			// quitAndInstall can skip graceful before-quit cleanup; stop the
			// sidecar first so the camera LED / exclusive lock are released
			// and PyInstaller can delete `%TEMP%\_MEI*` (force-kill fallback).
			void this.stopSidecar().finally(() => {
				try {
					autoUpdater.quitAndInstall(false, true);
				} catch (error) {
					console.error("Auto-update install failed:", error);
					this.present({ state: "error", surface: "dialog" }, true);
				}
			});
		} catch (error) {
			console.error("Auto-update install failed:", error);
			this.present({ state: "error", surface: "dialog" }, true);
		}
	}

	private clearPendingFlags(): void {
		this.interactivePending = false;
		this.backgroundPending = false;
	}

	private surfaceFor(interactive: boolean): AutoUpdateSurface {
		return interactive ? "dialog" : "toast";
	}

	/** Interactive → Restart dialog; silent → toast (prompt on quit). */
	private presentReady(version: string, interactive: boolean): void {
		this.present(
			{
				state: "ready",
				version,
				surface: this.surfaceFor(interactive),
			},
			interactive,
		);
	}

	private present(status: AutoUpdateStatus, bringToFront: boolean): void {
		const shouldShow = bringToFront === true;

		if (this.ui.canHostInAppUi()) {
			if (shouldShow) {
				this.ui.ensureVisible();
			}
			this.ui.emit(status);
			return;
		}
		// Silent toast with no host: skip native dialogs (tray autostart stays quiet).
		if (
			shouldShow ||
			("surface" in status && status.surface === "dialog")
		) {
			this.showNativeFallback(status);
		}
	}

	private showNativeFallback(status: AutoUpdateStatus): void {
		const locale = this.getLocale();
		switch (status.state) {
			case "upToDate":
				void dialog.showMessageBox({
					type: "info",
					title: t(locale, "updates.upToDate.title"),
					message: t(locale, "updates.upToDate.message"),
					buttons: [t(locale, "updates.ok")],
					defaultId: 0,
					noLink: true,
				});
				return;
			case "error":
				void dialog.showMessageBox({
					type: "warning",
					title: t(locale, "updates.error.title"),
					message: t(locale, "updates.error.message"),
					buttons: [t(locale, "updates.ok")],
					defaultId: 0,
					noLink: true,
				});
				return;
			case "unavailable":
				void dialog.showMessageBox({
					type: "info",
					title: t(locale, "updates.unavailable.title"),
					message: t(locale, "updates.unavailable.message"),
					buttons: [t(locale, "updates.ok")],
					defaultId: 0,
					noLink: true,
				});
				return;
			case "ready":
				// Toast-only silent ready: in-app toast; quit prompt handles install.
				if (status.surface !== "dialog") return;
				void dialog
					.showMessageBox({
						type: "info",
						title: t(locale, "updates.ready.title"),
						message: t(locale, "updates.ready.message", {
							version: status.version,
						}),
						buttons: [
							t(locale, "updates.ready.restart"),
							t(locale, "updates.ready.later"),
						],
						defaultId: 0,
						cancelId: 1,
						noLink: true,
					})
					.then(({ response }) => {
						if (response === 0) {
							this.installUpdate();
						}
					})
					.catch((error) => {
						console.error("Auto-update restart dialog failed:", error);
					});
				return;
			default:
				return;
		}
	}
}
