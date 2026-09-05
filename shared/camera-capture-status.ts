import { t, type Locale } from "./i18n";
import {
	hushActiveLabel,
	pauseStatusMessageKey,
	type FocusPauseStatePayload,
} from "./session-pause-status";

export type CameraCaptureSurface = "idle" | "preview" | "monitoring";

export type CameraCaptureStatusPayload = {
	capturing: boolean;
	surface: CameraCaptureSurface;
};

const TRAY_PRODUCT_NAME = "BlinkGuard";

const SURFACES: ReadonlySet<CameraCaptureSurface> = new Set([
	"idle",
	"preview",
	"monitoring",
]);

export function deriveCameraCaptureSurface(
	capturing: boolean,
	isTracking: boolean,
): CameraCaptureSurface {
	if (!capturing) return "idle";
	return isTracking ? "monitoring" : "preview";
}

export function sanitizeCameraCaptureStatusPayload(
	input: unknown,
): CameraCaptureStatusPayload {
	const rec =
		input && typeof input === "object"
			? (input as Record<string, unknown>)
			: {};
	if (rec.capturing !== true) {
		return { capturing: false, surface: "idle" };
	}
	const surface =
		typeof rec.surface === "string" &&
		SURFACES.has(rec.surface as CameraCaptureSurface) &&
		rec.surface !== "idle"
			? (rec.surface as Exclude<CameraCaptureSurface, "idle">)
			: "monitoring";
	return { capturing: true, surface };
}

/** Settings chip / tray menu label key. Error is renderer-local (orthogonal). */
export function cameraCaptureStatusMessageKey(
	payload: CameraCaptureStatusPayload | null,
): string {
	if (!payload || !payload.capturing) return "tray.cameraIdle";
	if (payload.surface === "preview") return "tray.cameraPreview";
	return "tray.cameraOn";
}

/** Chip copy when Settings has no error override. */
export function cameraCaptureChipMessageKey(
	surface: CameraCaptureSurface,
): string {
	if (surface === "preview") return "camera.status.preview";
	if (surface === "monitoring") return "camera.status.live";
	return "camera.status.idle";
}

/**
 * Tray tooltip: product name, optional camera fragment, optional pause,
 * optional session glance (live BPM / today / goal).
 * Idle capture omits the camera fragment. Pause copy is never replaced.
 */
export function composeTrayTooltip(
	locale: Locale,
	pause: FocusPauseStatePayload | null,
	capture: CameraCaptureStatusPayload | null,
	glanceFragment?: string | null,
	hushTiming?: {
		promptSuppressUntil: number;
		promptHushUntilResume: boolean;
	} | null,
): string {
	const parts: string[] = [TRAY_PRODUCT_NAME];
	if (capture?.capturing) {
		const camKey =
			capture.surface === "preview" ? "tray.cameraPreview" : "tray.cameraOn";
		parts.push(t(locale, camKey));
	}
	if (pause) {
		const pauseKey = pauseStatusMessageKey(pause);
		if (pauseKey === "hush.active" && hushTiming) {
			parts.push(
				hushActiveLabel(
					locale,
					hushTiming.promptSuppressUntil,
					hushTiming.promptHushUntilResume,
				),
			);
		} else if (pauseKey) {
			parts.push(t(locale, pauseKey));
		}
	}
	const glance = glanceFragment?.trim();
	if (glance) parts.push(glance);
	return parts.join(" — ");
}
