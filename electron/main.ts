import { app } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AppRuntimeState } from "./application/app-runtime-state";
import { BlinkStatsService } from "./application/blink-stats-service";
import { CalibrationNudgeService } from "./application/calibration-nudge-service";
import { CameraCaptureStatusService } from "./application/camera-capture-status-service";
import { ExerciseService } from "./application/exercise-service";
import { FocusPauseService } from "./application/focus-pause-service";
import { LookAwayService } from "./application/look-away-service";
import type { NotificationGate } from "./application/ports/notification-gate";
import { PreferenceActions } from "./application/preference-actions";
import {
	PreferenceStoreSettingsProfilesAdapter,
	SettingsProfilesService,
} from "./application/settings-profiles-service";
import { PreferencesService } from "./application/preferences-service";
import { DeferredTrackingRestore } from "./application/deferred-tracking-restore";
import { ReminderService } from "./application/reminder-service";
import { SessionPauseService } from "./application/session-pause-service";
import {
	startTrackingSession,
	stopTrackingSession,
	toggleTrackingSession,
} from "./application/tracking-session";
import { createFocusEnvironment } from "./infrastructure/focus/create-focus-environment";
import { FocusEnvironmentMonitor } from "./infrastructure/focus/focus-environment-monitor";
import { registerIpcHandlers } from "./infrastructure/ipc/register-ipc-handlers";
import { AppLifecycle } from "./infrastructure/lifecycle/app-lifecycle";
import { applyLaunchAtLogin } from "./infrastructure/lifecycle/login-item";
import { BlinkDetectorDebugLogger } from "./infrastructure/logging/blink-detector-debug-logger";
import { configureFileLogging } from "./infrastructure/logging/configure-file-logging";
import { InteractionLogger } from "./infrastructure/logging/interaction-logger";
import { configureAppPaths } from "./infrastructure/paths/app-paths";
import { ChildProcessRegistry } from "./infrastructure/process/child-process-registry";
import {
	killOrphanedSidecarProcesses,
	ProcessCleanup,
} from "./infrastructure/process/process-cleanup";
import { createSessionActivity } from "./infrastructure/session-activity/create-session-activity";
import { BlinkDetectorSidecar } from "./infrastructure/sidecar/blink-detector-sidecar";
import { ShortcutController } from "./infrastructure/shortcuts/shortcut-controller";
import { NotificationSoundPlayer } from "./infrastructure/sound/notification-sound-player";
import { OsNotificationPlayer } from "./infrastructure/notifications/os-notification-player";
import { ElectronPreferenceStore } from "./infrastructure/store/electron-preference-store";
import { TrayController } from "./infrastructure/tray/tray-controller";
import { AutoUpdateService } from "./infrastructure/updates/auto-update-service";
import { WindowManager } from "./infrastructure/windows/window-manager";
import { IPC_CHANNELS } from "../shared/ipc-channels";
import { sameCameraDevice } from "../shared/camera-devices";
import { goalsConfigFromPreferences } from "../shared/preferences";

if (process.platform === "darwin") {
	process.env.NSWindowSupportsNonactivatingPanel = "true";
}

// Shared identity so packaged + `npm run dev` share one single-instance lock.
const APP_USER_MODEL_ID = "com.xpogx.blinkguard";
if (process.platform === "win32") {
	app.setAppUserModelId(APP_USER_MODEL_ID);
}
app.setPath("userData", path.join(app.getPath("appData"), "BlinkGuard"));

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
	// Hard exit: do not continue constructing services / spawning sidecars.
	app.exit(0);
} else {
	bootstrap();
}

function bootstrap(): void {
	configureFileLogging();

	const entryDirectory = path.dirname(fileURLToPath(import.meta.url));
	const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;
	const paths = configureAppPaths(entryDirectory, VITE_DEV_SERVER_URL);

	const store = new ElectronPreferenceStore();
	const statsStore = new ElectronPreferenceStore({ name: "blinkguard-stats" });
	const settingsProfilesStore = new ElectronPreferenceStore({
		name: "blinkguard-settings-profiles",
	});
	const preferencesService = new PreferencesService(store);
	const preferences = preferencesService.current;
	const blinkStats = new BlinkStatsService(
		statsStore,
		() => preferences.locale,
		() =>
			goalsConfigFromPreferences({
				goalsEnabled: preferences.goalsEnabled,
				dailyBlinkGoal: preferences.dailyBlinkGoal,
				dailyTrackingMinutesGoal: preferences.dailyTrackingMinutesGoal,
				weeklyBlinkGoal: preferences.weeklyBlinkGoal,
				weeklyTrackingMinutesGoal: preferences.weeklyTrackingMinutesGoal,
			}),
		() => preferences.hasCompletedOnboarding,
		() => preferences.earCalibration != null,
	);
	const state = new AppRuntimeState();
	const processes = new ChildProcessRegistry();
	const windows = new WindowManager(
		paths,
		preferences,
		VITE_DEV_SERVER_URL,
		(update) => {
			preferencesService.set("popupPositionsByDisplayId", update.map);
			if (update.sizes) {
				preferencesService.set("popupSizesByDisplayId", update.sizes);
			}
			if (update.position) {
				preferencesService.set("popupPosition", update.position);
			}
			if (update.size) {
				preferencesService.set("popupSize", update.size);
			}
		},
	);
	const sound = new NotificationSoundPlayer(paths, preferences, app.isPackaged);
	const osNotifications = new OsNotificationPlayer();

	blinkStats.setPushHandler((snapshot) => {
		windows.sendToMain(IPC_CHANNELS.loadBlinkStats, snapshot);
	});
	blinkStats.setCheerEffects({
		onCheer: (celebration) => {
			sound.play("cheer", { force: true });
			windows.showCheerToast(celebration);
		},
	});

	const gateHolder: { current: NotificationGate } = {
		current: {
			notificationsAllowed: () => true,
			pauseReason: () => null,
		},
	};
	const notificationGate: NotificationGate = {
		notificationsAllowed: () => gateHolder.current.notificationsAllowed(),
		pauseReason: () => gateHolder.current.pauseReason(),
	};

	let reminders: ReminderService;
	let calibrationNudge: CalibrationNudgeService;
	const blinkDebugLogger = new BlinkDetectorDebugLogger();
	const interactionLogger = new InteractionLogger();
	const captureStatus = new CameraCaptureStatusService(
		windows,
		IPC_CHANNELS.cameraCaptureStatus,
	);
	const sidecar = new BlinkDetectorSidecar(
		paths,
		app.isPackaged,
		processes,
		preferences,
		{
			onBlink: (data) => {
				reminders.onBlink();
				windows.sendToCamera(IPC_CHANNELS.blinkDetected, data);
			},
			onFaceData: (data: any) => {
				reminders.onFaceDetection(!!data.faceDetected);
				blinkStats.onFaceVisibility(!!data.faceDetected);
				windows.sendToCamera(IPC_CHANNELS.faceTrackingData, data);
			},
			onVideoStream: (data) => {
				windows.sendToCamera(IPC_CHANNELS.videoStream, data);
			},
			onError: (message) => {
				windows.sendToMain(IPC_CHANNELS.cameraError, message);
			},
			onCameraReady: () => {
				windows.sendToMain(IPC_CHANNELS.cameraReady);
			},
			onCameraCaptureChange: (capturing) => {
				captureStatus.notifyCapture(capturing);
			},
			onCameraDevices: (payload) => {
				windows.sendToMain(IPC_CHANNELS.cameraDevices, payload);
			},
			onCameraDeviceNotice: (notice) => {
				windows.sendToMain(IPC_CHANNELS.cameraDeviceNotice, notice);
			},
			onCameraOpened: (meta) => {
				const selected = preferences.cameraDevice;
				if (!selected) return;
				const next = {
					id: selected.id || meta.id,
					index: meta.index,
					name: selected.name || meta.name,
				};
				if (sameCameraDevice(selected, next)) return;
				preferencesService.set("cameraDevice", next);
			},
			isCameraWindowOpen: () => windows.isCameraOpen(),
			shouldRetryCamera: () =>
				!reminders.isCameraSoftPaused &&
				(windows.isCameraOpen() ||
					(preferences.isTracking && preferences.cameraEnabled)),
			onCalibrationProgress: (payload) => {
				windows.sendToMain(IPC_CHANNELS.earCalibrationProgress, payload);
			},
			onCalibrationComplete: (payload) => {
				if (payload.baseline !== null) {
					preferencesService.set("earCalibration", payload.baseline);
					preferencesService.set("calibrationAt", Date.now());
					sidecar.applyEarCalibration(payload.baseline);
					calibrationNudge.onCalibrationUpdated();
				}
				if (typeof payload.classifierBias === "number") {
					preferencesService.set("classifierBias", payload.classifierBias);
					preferencesService.set(
						"classifierThreshold",
						payload.classifierThreshold ?? null,
					);
					sidecar.applyClassifierCalibration({
						bias: payload.classifierBias,
						threshold: payload.classifierThreshold ?? null,
					});
				}
				if (
					payload.baseline !== null ||
					typeof payload.classifierBias === "number"
				) {
					windows.sendPreferences();
				}
				if (payload.baseline !== null) {
					blinkStats.reconcileAchievements({ celebrate: "live" });
				}
				windows.sendToMain(IPC_CHANNELS.earCalibrationComplete, payload);
			},
			onBaselineDriftNudge: () => {
				calibrationNudge.onDriftNudge();
			},
		},
		blinkDebugLogger,
	);
	calibrationNudge = new CalibrationNudgeService(
		preferencesService,
		windows,
		notificationGate,
	);
	reminders = new ReminderService(
		preferences,
		state,
		windows,
		sidecar,
		sound,
		store,
		blinkStats,
		notificationGate,
		null,
		calibrationNudge,
		osNotifications,
	);
	const focusEnvironment = createFocusEnvironment();
	const focusPause = new FocusPauseService(
		preferences,
		windows,
		reminders,
		IPC_CHANNELS.focusPauseState,
		focusEnvironment.supportsFullscreenDetection(),
		osNotifications,
	);
	gateHolder.current = focusPause;
	const focusMonitor = new FocusEnvironmentMonitor(
		focusEnvironment,
		(snapshot) => {
			focusPause.setForeground(snapshot);
		},
	);

	const exercises = new ExerciseService(
		preferences,
		state,
		store,
		windows,
		sound,
		notificationGate,
		osNotifications,
		blinkStats,
	);
	const lookAway = new LookAwayService(
		preferences,
		state,
		store,
		windows,
		sound,
		notificationGate,
		osNotifications,
		blinkStats,
	);
	osNotifications.setActivationHandlers({
		onClick: () => windows.showMain(),
		onSnooze: (kind) => {
			if (kind === "blink") reminders.snooze();
			else if (kind === "exercise") exercises.snooze();
			else lookAway.snooze();
		},
	});
	focusPause.bindPromptDismissers({
		blink: () => reminders.dismissVisibleBlink(),
		exercise: () => exercises.dismissVisible(),
		lookAway: () => lookAway.dismissVisible(),
	});
	reminders.bindTrackingSessionStop((showStatus) =>
		stopTrackingSession(
			{ reminders, exercises, lookAway, preferences },
			showStatus,
		),
	);
	const sessionPause = new SessionPauseService(
		preferences,
		state,
		reminders,
		exercises,
		lookAway,
		focusPause,
	);
	const sessionActivity = createSessionActivity((snapshot) => {
		sessionPause.setEnvironment(snapshot);
	});
	const shortcuts = new ShortcutController(
		preferences,
		state,
		reminders,
		exercises,
		lookAway,
		windows,
		interactionLogger,
	);
	const processCleanup = new ProcessCleanup(processes);
	const autoUpdates = new AutoUpdateService(
		() => preferences.locale,
		{
			emit: (status) =>
				windows.sendToMain(IPC_CHANNELS.autoUpdateStatus, status),
			ensureVisible: () => windows.showMain(),
			canHostInAppUi: () =>
				Boolean(windows.main && !windows.main.isDestroyed()),
		},
		() => processCleanup.run(),
	);
	const lifecycle = new AppLifecycle(
		state,
		sessionPause,
		windows,
		processCleanup,
		blinkStats,
		() => {
			sound.dispose();
			osNotifications.dismissAll();
			shortcuts.unregisterAll();
			focusMonitor.stop();
			focusPause.stopQuietHoursWatch();
			focusEnvironment.dispose?.();
			sessionActivity.dispose();
			sessionPause.dispose();
			calibrationNudge.dispose();
			autoUpdates.dispose();
		},
	);
	const tray = new TrayController(
		paths,
		windows,
		() => lifecycle.quit(),
		() => preferences.locale,
		() => preferences.snoozeMinutes,
		() => {
			windows.showMain();
			autoUpdates.checkForUpdates({ interactive: true });
		},
		interactionLogger,
		() => reminders.snooze(),
		() => exercises.snooze(),
		() => lookAway.snooze(),
		() => preferences.isTracking,
		() => {
			if (state.isAutoResuming) {
				state.isAutoResuming = false;
				stopTrackingSession(
					{ reminders, exercises, lookAway, preferences },
					false,
				);
			}
			toggleTrackingSession(
				{ reminders, exercises, lookAway, preferences },
				preferences.isTracking,
			);
			windows.sendPreferences();
		},
		() => preferences.keyboardShortcuts,
	);
	reminders.setOnTrackingChange((isTracking) => {
		captureStatus.notifyTracking(isTracking);
		tray.setTrackingState(isTracking);
	});
	lifecycle.attachTray(tray);

	const preferenceActions = new PreferenceActions(
		preferencesService,
		reminders,
		exercises,
		lookAway,
		focusPause,
		blinkStats,
		windows,
		sidecar,
		shortcuts,
		applyLaunchAtLogin,
		tray,
	);
	const settingsProfiles = new SettingsProfilesService(
		new PreferenceStoreSettingsProfilesAdapter(settingsProfilesStore),
		() => preferencesService.current,
		(snapshot) => preferenceActions.applySettingsProfile(snapshot),
	);
	shortcuts.setOpenCameraPreview(() => preferenceActions.showCameraWindow());

	const trackingRestore = new DeferredTrackingRestore({
		pending: preferences.isTracking,
		isTracking: () => preferences.isTracking,
		start: () =>
			startTrackingSession({
				reminders,
				exercises,
				lookAway,
				preferences,
			}),
	});

	registerIpcHandlers({
		preferences: preferencesService,
		preferenceActions,
		reminders,
		exercises,
		lookAway,
		state,
		sidecar,
		shortcuts,
		windows,
		blinkStats,
		focusPause,
		focusEnvironment,
		sound,
		calibrationNudge,
		checkForUpdates: () => autoUpdates.checkForUpdates({ interactive: true }),
		installUpdate: () => autoUpdates.installUpdate(),
		interactions: interactionLogger,
		settingsProfiles,
		onShellReady: () => {
			blinkStats.reconcileAchievements({ celebrate: "summary" });
			trackingRestore.onShellReady();
			// Restore may start camera async; push current flags now, and the
			// renderer also requests a snapshot on mount after ACK.
			captureStatus.hydrate(sidecar.isCameraReady, preferences.isTracking);
		},
		pushCameraCaptureStatus: () => {
			captureStatus.hydrate(sidecar.isCameraReady, preferences.isTracking);
		},
		onSnoozeMinutesChanged: () => tray.rebuildMenu(),
		onKeyboardShortcutsChanged: () => tray.rebuildMenu(),
	});

	app.on("second-instance", () => {
		windows.showMain();
	});

	app.on("activate", () => windows.activateMain(lifecycle.handleMainClose));

	void app.whenReady().then(async () => {
		lifecycle.register();
		windows.registerDisplayListeners();
		preferencesService.seedPopupPositionsFromLegacy(
			windows.getPopupPositionSeedDisplayId(preferences.popupPosition),
		);
		windows.migrateLegacyPopupPositions();

		const startHidden =
			process.argv.includes("--hidden") ||
			app.getLoginItemSettings().wasOpenedAtLogin;
		windows.createMain(lifecycle.handleMainClose, {
			showOnReady: !startHidden,
		});

		tray.create();
		focusPause.setOnState((payload) => tray.setPauseState(payload));
		captureStatus.setOnState((payload) => tray.setCaptureState(payload));
		autoUpdates.start();
		autoUpdates.checkForUpdates();
		applyLaunchAtLogin(preferences.launchAtLogin);
		shortcuts.registerAll(preferences.keyboardShortcuts);

		exercises.resetTimer();
		lookAway.resetTimer();
		const eyeCareMayRun =
			preferences.eyeCareIndependentOfTracking || preferences.isTracking;
		if (eyeCareMayRun && preferences.eyeExercisesEnabled) {
			exercises.start();
		}
		if (eyeCareMayRun && preferences.lookAwayEnabled) {
			lookAway.start();
		}

		focusPause.startQuietHoursWatch();
		focusMonitor.start();
		sessionActivity.start();
		windows.setOnMainLoaded(() => {
			focusPause.pushState();
			captureStatus.hydrate(sidecar.isCameraReady, preferences.isTracking);
		});

		blinkDebugLogger.announce();
		blinkDebugLogger.append({
			source: "main",
			type: "startup",
			message: "Blink detector debug logging ready",
		});
		// Drop orphans left by HMR / crash before spawning a fresh sidecar.
		await killOrphanedSidecarProcesses();
		console.log("Starting blink detector on app startup...");
		sidecar.start();
		// Defer Start popup / camera until settings shell is ready (shellReady IPC).
		trackingRestore.armFallback();
	});
}
