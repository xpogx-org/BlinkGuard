import { describe, expect, it } from "vitest";
import {
	autoStopNoFaceDelayMs,
	BLINK_CREDIT_DEBOUNCE_MS,
	BLINK_SNOOZE_MS,
	CAMERA_POLL_INTERVAL_MS,
	FACE_RETURN_DEBOUNCE_MS,
	NO_FACE_DEBOUNCE_MS,
	nextTimerReminderDelay,
	promptSnoozeMs,
	REMINDER_POPUP_VISIBLE_MS,
	shouldArmAutoStopOnNoFace,
	shouldShowCameraReminder,
} from "../../../electron/domain/reminder-policy";

describe("reminder-policy", () => {
	it("returns the interval as the timer reminder delay (no 2.5s add-on)", () => {
		expect(nextTimerReminderDelay(3000)).toBe(3000);
		expect(nextTimerReminderDelay(30_000)).toBe(30_000);
		expect(REMINDER_POPUP_VISIBLE_MS).toBe(2500);
		expect(CAMERA_POLL_INTERVAL_MS).toBe(100);
		expect(BLINK_CREDIT_DEBOUNCE_MS).toBe(150);
		expect(BLINK_SNOOZE_MS).toBe(5 * 60 * 1000);
		expect(NO_FACE_DEBOUNCE_MS).toBe(750);
		expect(FACE_RETURN_DEBOUNCE_MS).toBe(500);
	});

	it("converts auto-stop minutes to milliseconds", () => {
		expect(autoStopNoFaceDelayMs(2)).toBe(120_000);
		expect(autoStopNoFaceDelayMs(1)).toBe(60_000);
	});

	it("converts snooze minutes to milliseconds", () => {
		expect(promptSnoozeMs(5)).toBe(5 * 60 * 1000);
		expect(promptSnoozeMs(1)).toBe(60_000);
		expect(promptSnoozeMs(10)).toBe(10 * 60 * 1000);
	});

	it("arms auto-stop only while tracking with camera and feature on", () => {
		expect(
			shouldArmAutoStopOnNoFace({
				isTracking: true,
				cameraEnabled: true,
				autoStopNoFaceEnabled: true,
				cameraSoftPaused: false,
			}),
		).toBe(true);
		expect(
			shouldArmAutoStopOnNoFace({
				isTracking: true,
				cameraEnabled: true,
				autoStopNoFaceEnabled: true,
				cameraSoftPaused: true,
			}),
		).toBe(false);
		expect(
			shouldArmAutoStopOnNoFace({
				isTracking: true,
				cameraEnabled: true,
				autoStopNoFaceEnabled: false,
				cameraSoftPaused: false,
			}),
		).toBe(false);
	});

	it("shows a camera reminder only when all gates pass", () => {
		const ready = {
			isTracking: true,
			isDetectorRunning: true,
			isFaceDetected: true,
			hasPopup: false,
			timeSinceLastBlinkMs: 3000,
			timeSinceLastReminderMs: 3000,
			reminderIntervalMs: 3000,
		};

		expect(shouldShowCameraReminder(ready)).toBe(true);
	});

	it.each([
		["not tracking", { isTracking: false }],
		["detector stopped", { isDetectorRunning: false }],
		["no face", { isFaceDetected: false }],
		["popup already open", { hasPopup: true }],
		["blink too recent", { timeSinceLastBlinkMs: 2999 }],
		["reminder too recent", { timeSinceLastReminderMs: 2999 }],
	] as const)("blocks when %s", (_label, override) => {
		expect(
			shouldShowCameraReminder({
				isTracking: true,
				isDetectorRunning: true,
				isFaceDetected: true,
				hasPopup: false,
				timeSinceLastBlinkMs: 3000,
				timeSinceLastReminderMs: 3000,
				reminderIntervalMs: 3000,
				...override,
			}),
		).toBe(false);
	});

	it("does not treat a recent reminder cooldown as a blink credit", () => {
		// Auto-dismiss only ages lastReminderShownAt — blink clock can still be overdue.
		expect(
			shouldShowCameraReminder({
				isTracking: true,
				isDetectorRunning: true,
				isFaceDetected: true,
				hasPopup: false,
				timeSinceLastBlinkMs: 10_000,
				timeSinceLastReminderMs: 100,
				reminderIntervalMs: 3000,
			}),
		).toBe(false);

		expect(
			shouldShowCameraReminder({
				isTracking: true,
				isDetectorRunning: true,
				isFaceDetected: true,
				hasPopup: false,
				timeSinceLastBlinkMs: 10_000,
				timeSinceLastReminderMs: 3000,
				reminderIntervalMs: 3000,
			}),
		).toBe(true);
	});
});
