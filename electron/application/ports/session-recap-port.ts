import type {
	SessionRecapNativePayload,
	SessionRecapOverlayPayload,
} from "../../../shared/session-recap";

export interface SessionRecapPorts {
	showOverlay(payload: SessionRecapOverlayPayload): void;
	showNative(payload: SessionRecapNativePayload): void;
	logInteraction?(event: string, data?: Record<string, unknown>): void;
}
