import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_RENDERER_PREFERENCES } from "@/features/settings/model/preferences";
import {
	pushPreferenceDiff,
	sameRendererPrefs,
} from "@/features/settings/model/preferences-sync";
import { rendererIpc } from "@/shared/ipc/renderer-ipc";

vi.mock("@/shared/ipc/renderer-ipc", () => ({
	rendererIpc: {
		updateDarkMode: vi.fn(),
		updateMicroBreakInterval: vi.fn(),
		updateBlinkPromptProfile: vi.fn(),
		updateCameraEnabled: vi.fn(),
		updateCameraQuality: vi.fn(),
		updateCameraDevice: vi.fn(),
		updateAutoStopNoFaceEnabled: vi.fn(),
		updateAutoStopNoFaceMinutes: vi.fn(),
		updateSnoozeMinutes: vi.fn(),
		updateEarCalibration: vi.fn(),
		updateClassifierCalibration: vi.fn(),
		updateEyeExercisesEnabled: vi.fn(),
		updateExerciseInterval: vi.fn(),
		updateExercisePrompts: vi.fn(),
		updateEyeCareIndependentOfTracking: vi.fn(),
		updateLookAwayEnabled: vi.fn(),
		updateLookAwayInterval: vi.fn(),
		updateLookAwayDuration: vi.fn(),
		updateLookAwayTitle: vi.fn(),
		updateLookAwayHint: vi.fn(),
		updatePopupColors: vi.fn(),
		updatePopupTransparency: vi.fn(),
		updatePopupMessage: vi.fn(),
		updateBlinkPopupClickThrough: vi.fn(),
		updateNotificationStyle: vi.fn(),
		updateKeyboardShortcuts: vi.fn(),
		updateMgdMode: vi.fn(),
		updateSoundEnabled: vi.fn(),
		updateSoundVolume: vi.fn(),
		updateLaunchAtLogin: vi.fn(),
		updateQuietHoursEnabled: vi.fn(),
		updateQuietHoursStart: vi.fn(),
		updateQuietHoursEnd: vi.fn(),
		updateQuietHoursByWeekday: vi.fn(),
		updatePauseOnFullscreen: vi.fn(),
		updatePauseAppRules: vi.fn(),
		updateBlinkRateCoachingEnabled: vi.fn(),
		updateCalibrationNudgeEnabled: vi.fn(),
		updateBlinkRateThreshold: vi.fn(),
		updateLocale: vi.fn(),
		updateHasCompletedOnboarding: vi.fn(),
		updateGoalsConfig: vi.fn(),
	},
}));

describe("sameRendererPrefs", () => {
	it("ignores UI-only flags", () => {
		const a = { ...DEFAULT_RENDERER_PREFERENCES, showMgdInfo: false };
		const b = { ...DEFAULT_RENDERER_PREFERENCES, showMgdInfo: true };
		expect(sameRendererPrefs(a, b)).toBe(true);
	});

	it("detects nested popup and prompt changes", () => {
		const base = { ...DEFAULT_RENDERER_PREFERENCES };
		expect(
			sameRendererPrefs(base, {
				...base,
				popupColors: { ...base.popupColors, transparency: 0.5 },
			}),
		).toBe(false);
		expect(
			sameRendererPrefs(base, {
				...base,
				exercisePrompts: [...base.exercisePrompts, "extra"],
			}),
		).toBe(false);
		expect(
			sameRendererPrefs(base, {
				...base,
				lookAwayTitle: "Custom title",
			}),
		).toBe(false);
		expect(
			sameRendererPrefs(base, {
				...base,
				lookAwayHint: "Custom hint",
			}),
		).toBe(false);
		expect(
			sameRendererPrefs(base, {
				...base,
				popupPosition: { x: 1, y: 2 },
			}),
		).toBe(false);
		expect(
			sameRendererPrefs(base, {
				...base,
				popupPositionsByDisplayId: { "1": { x: 1, y: 2 } },
			}),
		).toBe(false);
		expect(
			sameRendererPrefs(base, {
				...base,
				popupSizesByDisplayId: { "1": { width: 320, height: 140 } },
			}),
		).toBe(false);
	});

	it("detects auto-stop no-face preference changes", () => {
		const base = { ...DEFAULT_RENDERER_PREFERENCES };
		expect(
			sameRendererPrefs(base, {
				...base,
				autoStopNoFaceEnabled: false,
			}),
		).toBe(false);
		expect(
			sameRendererPrefs(base, {
				...base,
				autoStopNoFaceMinutes: 5,
			}),
		).toBe(false);
	});

	it("detects cameraDevice preference changes", () => {
		const base = { ...DEFAULT_RENDERER_PREFERENCES };
		expect(
			sameRendererPrefs(base, {
				...base,
				cameraDevice: { id: "pnp-1", index: 0, name: "Integrated" },
			}),
		).toBe(false);
	});

	it("detects snoozeMinutes preference changes", () => {
		const base = { ...DEFAULT_RENDERER_PREFERENCES };
		expect(
			sameRendererPrefs(base, {
				...base,
				snoozeMinutes: 10,
			}),
		).toBe(false);
	});

	it("detects microBreakInterval and blinkPromptProfile changes", () => {
		const base = { ...DEFAULT_RENDERER_PREFERENCES };
		expect(
			sameRendererPrefs(base, {
				...base,
				microBreakInterval: 60,
			}),
		).toBe(false);
		expect(
			sameRendererPrefs(base, {
				...base,
				blinkPromptProfile: "gentle",
			}),
		).toBe(false);
	});

	it("detects notificationStyle preference changes", () => {
		const base = { ...DEFAULT_RENDERER_PREFERENCES };
		expect(
			sameRendererPrefs(base, {
				...base,
				notificationStyle: "native",
			}),
		).toBe(false);
	});

	it("detects keyboardShortcuts map changes", () => {
		const base = { ...DEFAULT_RENDERER_PREFERENCES };
		expect(
			sameRendererPrefs(base, {
				...base,
				keyboardShortcuts: {
					...base.keyboardShortcuts,
					snoozeAll: "",
				},
			}),
		).toBe(false);
	});

	it("detects calibration nudge preference changes", () => {
		const base = { ...DEFAULT_RENDERER_PREFERENCES };
		expect(
			sameRendererPrefs(base, {
				...base,
				calibrationNudgeEnabled: false,
			}),
		).toBe(false);
		expect(
			sameRendererPrefs(base, {
				...base,
				calibrationAt: 1_700_000_000_000,
			}),
		).toBe(false);
	});

	it("detects sound volume preference changes", () => {
		const base = { ...DEFAULT_RENDERER_PREFERENCES };
		expect(
			sameRendererPrefs(base, {
				...base,
				soundVolume: 40,
			}),
		).toBe(false);
	});
});

describe("pushPreferenceDiff", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("pushes only the fields that changed", () => {
		const previous = { ...DEFAULT_RENDERER_PREFERENCES, darkMode: true };
		const next = {
			...previous,
			darkMode: false,
			soundEnabled: true,
			locale: "uk" as const,
		};

		pushPreferenceDiff(previous, next);

		expect(rendererIpc.updateDarkMode).toHaveBeenCalledWith(false);
		expect(rendererIpc.updateSoundEnabled).toHaveBeenCalledWith(true);
		expect(rendererIpc.updateLocale).toHaveBeenCalledWith("uk");
		expect(rendererIpc.updateCameraEnabled).not.toHaveBeenCalled();
		expect(rendererIpc.updateEyeExercisesEnabled).not.toHaveBeenCalled();
		expect(rendererIpc.updateLookAwayEnabled).not.toHaveBeenCalled();
		expect(rendererIpc.updateKeyboardShortcuts).not.toHaveBeenCalled();
		expect(rendererIpc.updateAutoStopNoFaceEnabled).not.toHaveBeenCalled();
		expect(rendererIpc.updateCameraDevice).not.toHaveBeenCalled();
		expect(rendererIpc.updateQuietHoursByWeekday).not.toHaveBeenCalled();
		expect(rendererIpc.updateQuietHoursStart).not.toHaveBeenCalled();
		expect(rendererIpc.updateQuietHoursEnd).not.toHaveBeenCalled();
	});

	it("does not push IPC when only popupPositionsByDisplayId changes", () => {
		const previous = { ...DEFAULT_RENDERER_PREFERENCES };
		const next = {
			...previous,
			popupPositionsByDisplayId: { "1": { x: 40, y: 80 } },
		};

		pushPreferenceDiff(previous, next);

		for (const fn of Object.values(rendererIpc)) {
			expect(fn).not.toHaveBeenCalled();
		}
	});

	it("does not push IPC when only popupSizesByDisplayId changes", () => {
		const previous = { ...DEFAULT_RENDERER_PREFERENCES };
		const next = {
			...previous,
			popupSizesByDisplayId: { "1": { width: 320, height: 140 } },
		};

		pushPreferenceDiff(previous, next);

		for (const fn of Object.values(rendererIpc)) {
			expect(fn).not.toHaveBeenCalled();
		}
	});

	it("does not touch locale when only unrelated prefs change", () => {
		const previous = { ...DEFAULT_RENDERER_PREFERENCES };
		const next = { ...previous, quietHoursEnabled: false, mgdMode: true };

		pushPreferenceDiff(previous, next);

		expect(rendererIpc.updateQuietHoursEnabled).toHaveBeenCalledWith(false);
		expect(rendererIpc.updateMgdMode).toHaveBeenCalledWith(true);
		expect(rendererIpc.updateLocale).not.toHaveBeenCalled();
		expect(rendererIpc.updateDarkMode).not.toHaveBeenCalled();
	});

	it("pushes only auto-stop no-face fields when they change", () => {
		const previous = { ...DEFAULT_RENDERER_PREFERENCES };
		const next = {
			...previous,
			autoStopNoFaceEnabled: false,
			autoStopNoFaceMinutes: 10,
		};

		pushPreferenceDiff(previous, next);

		expect(rendererIpc.updateAutoStopNoFaceEnabled).toHaveBeenCalledWith(false);
		expect(rendererIpc.updateAutoStopNoFaceMinutes).toHaveBeenCalledWith(10);
		expect(rendererIpc.updateLocale).not.toHaveBeenCalled();
		expect(rendererIpc.updateCameraEnabled).not.toHaveBeenCalled();
	});

	it("pushes keyboardShortcuts when the map changes", () => {
		const previous = { ...DEFAULT_RENDERER_PREFERENCES };
		const next = {
			...previous,
			keyboardShortcuts: {
				...previous.keyboardShortcuts,
				snoozeAll: "",
			},
		};

		pushPreferenceDiff(previous, next);

		expect(rendererIpc.updateKeyboardShortcuts).toHaveBeenCalledWith(
			next.keyboardShortcuts,
		);
		expect(rendererIpc.updateLocale).not.toHaveBeenCalled();
	});

	it("pushes only snoozeMinutes when it changes", () => {
		const previous = { ...DEFAULT_RENDERER_PREFERENCES };
		const next = { ...previous, snoozeMinutes: 12 };

		pushPreferenceDiff(previous, next);

		expect(rendererIpc.updateSnoozeMinutes).toHaveBeenCalledWith(12);
		expect(rendererIpc.updateLocale).not.toHaveBeenCalled();
		expect(rendererIpc.updateAutoStopNoFaceMinutes).not.toHaveBeenCalled();
	});

	it("pushes only microBreakInterval when it changes", () => {
		const previous = { ...DEFAULT_RENDERER_PREFERENCES };
		const next = { ...previous, microBreakInterval: 45 };

		pushPreferenceDiff(previous, next);

		expect(rendererIpc.updateMicroBreakInterval).toHaveBeenCalledWith(45);
		expect(rendererIpc.updateBlinkPromptProfile).not.toHaveBeenCalled();
		expect(rendererIpc.updateLocale).not.toHaveBeenCalled();
		expect(rendererIpc.updateDarkMode).not.toHaveBeenCalled();
	});

	it("pushes only blinkPromptProfile when it changes", () => {
		const previous = { ...DEFAULT_RENDERER_PREFERENCES };
		const next = { ...previous, blinkPromptProfile: "gentle" as const };

		pushPreferenceDiff(previous, next);

		expect(rendererIpc.updateBlinkPromptProfile).toHaveBeenCalledWith(
			"gentle",
		);
		expect(rendererIpc.updateMicroBreakInterval).not.toHaveBeenCalled();
		expect(rendererIpc.updateLocale).not.toHaveBeenCalled();
	});

	it("pushes only sound volume when it changes", () => {
		const previous = { ...DEFAULT_RENDERER_PREFERENCES };
		const next = { ...previous, soundVolume: 55 };

		pushPreferenceDiff(previous, next);

		expect(rendererIpc.updateSoundVolume).toHaveBeenCalledWith(55);
		expect(rendererIpc.updateSoundEnabled).not.toHaveBeenCalled();
		expect(rendererIpc.updateLocale).not.toHaveBeenCalled();
	});

	it("pushes only blink click-through when it changes", () => {
		const previous = { ...DEFAULT_RENDERER_PREFERENCES };
		const next = { ...previous, blinkPopupClickThrough: false };

		pushPreferenceDiff(previous, next);

		expect(rendererIpc.updateBlinkPopupClickThrough).toHaveBeenCalledWith(
			false,
		);
		expect(rendererIpc.updateLocale).not.toHaveBeenCalled();
		expect(rendererIpc.updatePopupMessage).not.toHaveBeenCalled();
	});

	it("pushes only notification style when it changes", () => {
		const previous = { ...DEFAULT_RENDERER_PREFERENCES };
		const next = { ...previous, notificationStyle: "both" as const };

		pushPreferenceDiff(previous, next);

		expect(rendererIpc.updateNotificationStyle).toHaveBeenCalledWith("both");
		expect(rendererIpc.updateLocale).not.toHaveBeenCalled();
		expect(rendererIpc.updateSoundEnabled).not.toHaveBeenCalled();
		expect(rendererIpc.updateBlinkPopupClickThrough).not.toHaveBeenCalled();
	});

	it("pushes only eye-care independence when it changes", () => {
		const previous = { ...DEFAULT_RENDERER_PREFERENCES };
		const next = { ...previous, eyeCareIndependentOfTracking: false };

		pushPreferenceDiff(previous, next);

		expect(rendererIpc.updateEyeCareIndependentOfTracking).toHaveBeenCalledWith(
			false,
		);
		expect(rendererIpc.updateEyeExercisesEnabled).not.toHaveBeenCalled();
		expect(rendererIpc.updateLookAwayEnabled).not.toHaveBeenCalled();
		expect(rendererIpc.updateLocale).not.toHaveBeenCalled();
	});

	it("pushes only look-away copy when title or hint change", () => {
		const previous = { ...DEFAULT_RENDERER_PREFERENCES };
		const next = {
			...previous,
			lookAwayTitle: "Rest your eyes",
			lookAwayHint: "Look at a distant tree",
		};

		pushPreferenceDiff(previous, next);

		expect(rendererIpc.updateLookAwayTitle).toHaveBeenCalledWith(
			"Rest your eyes",
		);
		expect(rendererIpc.updateLookAwayHint).toHaveBeenCalledWith(
			"Look at a distant tree",
		);
		expect(rendererIpc.updateLookAwayDuration).not.toHaveBeenCalled();
		expect(rendererIpc.updateLocale).not.toHaveBeenCalled();
	});

	it("pushes goals config once when any goal field changes", () => {
		const previous = { ...DEFAULT_RENDERER_PREFERENCES };
		const next = { ...previous, dailyBlinkGoal: 300 };

		pushPreferenceDiff(previous, next);

		expect(rendererIpc.updateGoalsConfig).toHaveBeenCalledWith({
			goalsEnabled: next.goalsEnabled,
			dailyBlinkGoal: 300,
			dailyTrackingMinutesGoal: next.dailyTrackingMinutesGoal,
			weeklyBlinkGoal: next.weeklyBlinkGoal,
			weeklyTrackingMinutesGoal: next.weeklyTrackingMinutesGoal,
		});
		expect(rendererIpc.updateLocale).not.toHaveBeenCalled();
	});

	it("detects goals preference changes", () => {
		const base = { ...DEFAULT_RENDERER_PREFERENCES };
		expect(
			sameRendererPrefs(base, {
				...base,
				goalsEnabled: false,
			}),
		).toBe(false);
		expect(
			sameRendererPrefs(base, {
				...base,
				weeklyTrackingMinutesGoal: 120,
			}),
		).toBe(false);
		expect(
			sameRendererPrefs(base, {
				...base,
				pauseAppRules: [{ processName: "zoom", windowTitle: "" }],
			}),
		).toBe(false);
	});

	it("pushes classifier calibration as one payload and does not touch locale", () => {
		const previous = { ...DEFAULT_RENDERER_PREFERENCES };
		const next = {
			...previous,
			classifierBias: 0.4,
			classifierThreshold: 0.2,
		};

		pushPreferenceDiff(previous, next);

		expect(rendererIpc.updateClassifierCalibration).toHaveBeenCalledWith({
			bias: 0.4,
			threshold: 0.2,
		});
		expect(rendererIpc.updateEarCalibration).not.toHaveBeenCalled();
		expect(rendererIpc.updateLocale).not.toHaveBeenCalled();
	});

	it("pushes only pauseAppRules when the blocklist changes", () => {
		const previous = { ...DEFAULT_RENDERER_PREFERENCES };
		const next = {
			...previous,
			pauseAppRules: [{ processName: "Zoom.exe", windowTitle: "" }],
		};

		pushPreferenceDiff(previous, next);

		expect(rendererIpc.updatePauseAppRules).toHaveBeenCalledWith(
			next.pauseAppRules,
		);
		expect(rendererIpc.updatePauseOnFullscreen).not.toHaveBeenCalled();
		expect(rendererIpc.updateLocale).not.toHaveBeenCalled();
	});

	it("pushes only quietHoursByWeekday when the weekday map changes", () => {
		const previous = { ...DEFAULT_RENDERER_PREFERENCES };
		const next = {
			...previous,
			quietHoursByWeekday: { sat: { mode: "off" as const } },
		};

		pushPreferenceDiff(previous, next);

		expect(rendererIpc.updateQuietHoursByWeekday).toHaveBeenCalledWith(
			next.quietHoursByWeekday,
		);
		expect(rendererIpc.updateQuietHoursStart).not.toHaveBeenCalled();
		expect(rendererIpc.updateQuietHoursEnd).not.toHaveBeenCalled();
		expect(rendererIpc.updateLocale).not.toHaveBeenCalled();
	});

	it("treats quietHoursByWeekday key-order-only diffs as equal", () => {
		const a = {
			...DEFAULT_RENDERER_PREFERENCES,
			quietHoursByWeekday: {
				fri: { mode: "custom" as const, start: "22:00", end: "08:00" },
				sat: { mode: "off" as const },
			},
		};
		const b = {
			...DEFAULT_RENDERER_PREFERENCES,
			quietHoursByWeekday: {
				sat: { mode: "off" as const },
				fri: { mode: "custom" as const, start: "22:00", end: "08:00" },
			},
		};
		expect(sameRendererPrefs(a, b)).toBe(true);
	});

	it("pushes only cameraDevice when the picker changes", () => {
		const previous = { ...DEFAULT_RENDERER_PREFERENCES };
		const next = {
			...previous,
			cameraDevice: { id: "pnp-1", index: 1, name: "USB Webcam" },
		};

		pushPreferenceDiff(previous, next);

		expect(rendererIpc.updateCameraDevice).toHaveBeenCalledWith(
			next.cameraDevice,
		);
		expect(rendererIpc.updateCameraQuality).not.toHaveBeenCalled();
		expect(rendererIpc.updateLocale).not.toHaveBeenCalled();
	});

	it("pushes calibrationNudgeEnabled without locale or calibrationAt", () => {
		const previous = { ...DEFAULT_RENDERER_PREFERENCES };
		const next = { ...previous, calibrationNudgeEnabled: false };

		pushPreferenceDiff(previous, next);

		expect(rendererIpc.updateCalibrationNudgeEnabled).toHaveBeenCalledWith(
			false,
		);
		expect(rendererIpc.updateLocale).not.toHaveBeenCalled();
		expect(rendererIpc.updateEarCalibration).not.toHaveBeenCalled();
	});

	it("does not push main-owned calibration timestamps", () => {
		const previous = { ...DEFAULT_RENDERER_PREFERENCES };
		const next = {
			...previous,
			calibrationAt: 1_700_000_000_000,
			calibrationNudgeDismissedAt: 1_700_000_000_100,
			lastBaselineDriftAt: 1_700_000_000_200,
		};

		pushPreferenceDiff(previous, next);

		expect(rendererIpc.updateEarCalibration).not.toHaveBeenCalled();
		expect(rendererIpc.updateCalibrationNudgeEnabled).not.toHaveBeenCalled();
		expect(rendererIpc.updateLocale).not.toHaveBeenCalled();
	});

	it("does not re-push snapshot keys after a settings-setup switch echo", () => {
		const previous = {
			...DEFAULT_RENDERER_PREFERENCES,
			reminderInterval: 2000,
			microBreakInterval: 30_000,
			blinkPromptProfile: "standard" as const,
			cameraEnabled: false,
			cameraQuality: "medium" as const,
			snoozeMinutes: 5,
			quietHoursEnabled: false,
			notificationStyle: "overlay" as const,
			earCalibration: null,
		};
		// applySettingsProfile → one sendPreferences; React lastSynced already
		// matches the echoed snapshot (see preference-actions applySettingsProfile
		// sendPreferences-once spy). Equal previous→next must not fan out update-*.
		const echoed = structuredClone(previous);

		pushPreferenceDiff(previous, echoed);

		expect(rendererIpc.updateCameraEnabled).not.toHaveBeenCalled();
		expect(rendererIpc.updateCameraQuality).not.toHaveBeenCalled();
		expect(rendererIpc.updateCameraDevice).not.toHaveBeenCalled();
		expect(rendererIpc.updateSnoozeMinutes).not.toHaveBeenCalled();
		expect(rendererIpc.updateMicroBreakInterval).not.toHaveBeenCalled();
		expect(rendererIpc.updateBlinkPromptProfile).not.toHaveBeenCalled();
		expect(rendererIpc.updateQuietHoursEnabled).not.toHaveBeenCalled();
		expect(rendererIpc.updateNotificationStyle).not.toHaveBeenCalled();
		expect(rendererIpc.updateEarCalibration).not.toHaveBeenCalled();
		expect(rendererIpc.updateLocale).not.toHaveBeenCalled();
	});
});
