export type FaceStatus =
	| "ok"
	| "none"
	| "too_far"
	| "too_close"
	| "head_too_high"
	| "head_too_low"
	| "unreliable_landmarks";

const RELIABLE_FACE_STATUSES: ReadonlySet<FaceStatus> = new Set(["ok"]);

export function isFaceStatus(value: unknown): value is FaceStatus {
	return (
		value === "ok" ||
		value === "none" ||
		value === "too_far" ||
		value === "too_close" ||
		value === "head_too_high" ||
		value === "head_too_low" ||
		value === "unreliable_landmarks"
	);
}

/** True only when the sidecar reports a trustworthy tracking frame. */
export function isReliableFaceStatus(
	faceDetected: boolean,
	faceStatus: string | undefined,
): boolean {
	return (
		faceDetected === true &&
		typeof faceStatus === "string" &&
		RELIABLE_FACE_STATUSES.has(faceStatus as FaceStatus)
	);
}
