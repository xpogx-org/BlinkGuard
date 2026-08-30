// Camera visualization window

let lastFaceData = null;
let lastBlinkTime = 0;
let blinkDisplayTimer = null;
let currentThreshold = 0.2;
let thresholdUpdateTimer = null;
/** EMA for face box only — HOG boxes jitter; keep light tracking lag. */
let smoothedFaceRect = null;
let lastReliableTracking = false;
let lastWeakHintStatus = false;
const FACE_OVERLAY_SMOOTH = 0.55;
/** Normalized jump above this snaps (re-acquire / large head move). */
const FACE_OVERLAY_SNAP = 0.08;
/** Reused decode target; drop stale JPEGs so preview does not queue lag. */
const previewImage = new window.Image();
let previewDecodeBusy = false;
let pendingPreview = null;

function tr(key, vars) {
	if (window.__i18n && typeof window.__i18n.t === "function") {
		return window.__i18n.t(key, vars);
	}
	return key;
}

function lerp(a, b, t) {
	return a + (b - a) * t;
}

function resetSmoothedOverlay() {
	smoothedFaceRect = null;
}

function smoothFaceRect(next, { smooth = true } = {}) {
	if (!next || !next.width || !next.height) {
		smoothedFaceRect = null;
		return null;
	}
	if (!smooth || !smoothedFaceRect) {
		smoothedFaceRect = {
			x: next.x,
			y: next.y,
			width: next.width,
			height: next.height,
		};
		return smoothedFaceRect;
	}
	const jump =
		Math.abs(next.x - smoothedFaceRect.x) +
		Math.abs(next.y - smoothedFaceRect.y) +
		Math.abs(next.width - smoothedFaceRect.width) +
		Math.abs(next.height - smoothedFaceRect.height);
	if (jump > FACE_OVERLAY_SNAP) {
		smoothedFaceRect = {
			x: next.x,
			y: next.y,
			width: next.width,
			height: next.height,
		};
		return smoothedFaceRect;
	}
	const a = FACE_OVERLAY_SMOOTH;
	smoothedFaceRect = {
		x: lerp(smoothedFaceRect.x, next.x, a),
		y: lerp(smoothedFaceRect.y, next.y, a),
		width: lerp(smoothedFaceRect.width, next.width, a),
		height: lerp(smoothedFaceRect.height, next.height, a),
	};
	return smoothedFaceRect;
}

function smoothEyeLandmarks(points) {
	// Frame-synced preview draws raw dots (no EMA float vs video).
	if (!points || !points.length) {
		return null;
	}
	return points.map((p) => ({ x: p.x, y: p.y }));
}

function isReliableFaceTracking(faceData) {
	return (
		faceData &&
		faceData.faceDetected === true &&
		faceData.faceStatus === "ok"
	);
}

function hasWeakFaceBBoxHint(faceStatus) {
	return (
		faceStatus === "too_far" ||
		faceStatus === "too_close" ||
		faceStatus === "head_too_high" ||
		faceStatus === "head_too_low" ||
		faceStatus === "unreliable_landmarks"
	);
}

function faceHintKey(faceStatus) {
	if (faceStatus === "too_far") return "popup.camera.hintTooFar";
	if (faceStatus === "too_close") return "popup.camera.hintTooClose";
	if (faceStatus === "head_too_high") return "popup.camera.hintTooHigh";
	if (faceStatus === "head_too_low") return "popup.camera.hintTooLow";
	if (faceStatus === "unreliable_landmarks") {
		return "popup.camera.hintUnreliable";
	}
	return "popup.camera.hintNone";
}

function shouldShowMissingOverlay(faceData) {
	return !isReliableFaceTracking(faceData);
}

function syncTrackingRecovery(faceData) {
	const reliable = isReliableFaceTracking(faceData);
	if (reliable && !lastReliableTracking) {
		resetSmoothedOverlay();
	}
	lastReliableTracking = reliable;
}

function syncWeakHintOverlay(faceStatus) {
	const weak = hasWeakFaceBBoxHint(faceStatus);
	if (weak !== lastWeakHintStatus) {
		resetSmoothedOverlay();
	}
	lastWeakHintStatus = weak;
}

function setFaceMissingOverlay(visible, faceStatus) {
	const overlay = document.getElementById("face-missing-overlay");
	const hint = document.getElementById("face-missing-hint");
	if (!overlay) return;

	overlay.classList.toggle("is-visible", Boolean(visible));
	if (visible && hint) {
		const hintKey = faceHintKey(faceStatus);
		hint.textContent = tr(hintKey);
		hint.setAttribute("data-i18n", hintKey);
	}
}

function updateInfoDisplay(eyeSize, isBlinking = false) {
	const info = document.getElementById("info");
	const currentValues = document.getElementById("current-values");

	if (info) {
		info.textContent = tr("popup.camera.infoLive");
		info.style.background = isBlinking ? "rgba(0, 255, 0, 0.5)" : "rgba(0, 0, 0, 0.4)";
	}

	if (currentValues) {
		const eyeSizeText = eyeSize !== null ? eyeSize.toFixed(3) : "0.000";
		const baseline =
			lastFaceData && lastFaceData.baseline
				? lastFaceData.baseline.toFixed(3)
				: tr("popup.camera.building");
		const statusText =
			lastFaceData && lastFaceData.blink_phase
				? lastFaceData.blink_phase
				: tr("popup.camera.monitoring");
		currentValues.innerHTML =
			"<strong>" +
			tr("popup.camera.current") +
			"</strong> " +
			tr("popup.camera.eyeSize", { value: eyeSizeText }) +
			"<br><strong>" +
			tr("popup.camera.baseline") +
			"</strong> " +
			baseline +
			"<br><strong>" +
			tr("popup.camera.status") +
			"</strong> " +
			statusText;
		currentValues.style.background = isBlinking ? "rgba(0, 255, 0, 0.5)" : "rgba(0, 0, 0, 0.4)";
	}
}

function resetBlinkDisplay() {
	if (lastFaceData && isReliableFaceTracking(lastFaceData)) {
		const eyeSize = lastFaceData.ear || 0;
		const status = document.getElementById("status");
		if (status) {
			status.textContent = tr("popup.camera.eyeSize", {
				value: eyeSize.toFixed(3),
			});
			status.style.background = "rgba(0, 0, 0, 0.4)";
		}
		updateInfoDisplay(eyeSize);
	}
}

function drawFaceRect(ctx, canvas, faceRect, strokeStyle) {
	if (!faceRect || !faceRect.width || !faceRect.height) return;
	ctx.save();
	ctx.strokeStyle = strokeStyle;
	ctx.lineWidth = 2;
	ctx.strokeRect(
		faceRect.x * canvas.width,
		faceRect.y * canvas.height,
		faceRect.width * canvas.width,
		faceRect.height * canvas.height,
	);
	ctx.restore();
}

function drawOverlays(faceData) {
	const canvas = document.getElementById("canvas");
	if (!canvas || !faceData) return;

	syncTrackingRecovery(faceData);
	syncWeakHintOverlay(faceData.faceStatus);
	const reliable = isReliableFaceTracking(faceData);
	const ctx = canvas.getContext("2d");
	if (reliable) {
		const rect = smoothFaceRect(faceData.faceRect, { smooth: true });
		drawFaceRect(ctx, canvas, rect, "#00FF00");

		const landmarks = smoothEyeLandmarks(faceData.eyeLandmarks);
		if (landmarks) {
			ctx.save();
			ctx.fillStyle = "#00FF00";
			landmarks.forEach((point) => {
				ctx.beginPath();
				ctx.arc(point.x * canvas.width, point.y * canvas.height, 2, 0, Math.PI * 2);
				ctx.fill();
			});
			ctx.restore();
		}

		const timeSinceLastBlink = Date.now() - lastBlinkTime;
		const shouldShowBlink = timeSinceLastBlink < 350;

		const eyeSize = faceData.ear || 0;
		const isBlinking = faceData.blink || shouldShowBlink;

		const status = document.getElementById("status");
		if (status) {
			status.textContent = isBlinking
				? tr("popup.camera.blinkDetected")
				: tr("popup.camera.eyeSize", { value: eyeSize.toFixed(3) });
			status.style.background = isBlinking ? "rgba(0, 255, 0, 0.5)" : "rgba(0, 0, 0, 0.4)";
		}

		updateInfoDisplay(eyeSize, isBlinking);
		setFaceMissingOverlay(false);
	} else {
		const showWeakBBox =
			hasWeakFaceBBoxHint(faceData.faceStatus) &&
			faceData.faceDetected === true &&
			faceData.faceRect &&
			faceData.faceRect.width &&
			faceData.faceRect.height;
		if (showWeakBBox) {
			const rect = smoothFaceRect(faceData.faceRect, { smooth: false });
			drawFaceRect(ctx, canvas, rect, "#FACC15");
		} else {
			resetSmoothedOverlay();
		}

		const status = document.getElementById("status");
		if (status) {
			status.textContent = tr("popup.camera.noFace");
			status.style.background = "rgba(255, 0, 0, 0.5)";
		}
		updateInfoDisplay(null);
		setFaceMissingOverlay(shouldShowMissingOverlay(faceData), faceData.faceStatus || "none");
	}
}

function applyFaceTrackingUi(data) {
	syncTrackingRecovery(data);
	syncWeakHintOverlay(data.faceStatus);
	const timeSinceLastBlink = Date.now() - lastBlinkTime;
	const shouldShowBlink = timeSinceLastBlink < 350;

	if (isReliableFaceTracking(data)) {
		const eyeSize = data.ear || 0;
		const isBlinking = data.blink || shouldShowBlink;

		const status = document.getElementById("status");
		if (status) {
			status.textContent = isBlinking
				? tr("popup.camera.blinkDetected")
				: tr("popup.camera.eyeSize", { value: eyeSize.toFixed(3) });
			status.style.background = isBlinking
				? "rgba(0, 255, 0, 0.5)"
				: "rgba(0, 0, 0, 0.4)";
		}

		updateInfoDisplay(eyeSize, isBlinking);
		setFaceMissingOverlay(false);
	} else {
		if (!hasWeakFaceBBoxHint(data.faceStatus)) {
			resetSmoothedOverlay();
		}
		const status = document.getElementById("status");
		if (status) {
			status.textContent = tr("popup.camera.noFace");
			status.style.background = "rgba(255, 0, 0, 0.5)";
		}
		updateInfoDisplay(null);
		setFaceMissingOverlay(shouldShowMissingOverlay(data), data.faceStatus || "none");
	}
}

function initCameraPopup() {
	window.popupAPI.onFaceTrackingData((data) => {
		lastFaceData = data;
		applyFaceTrackingUi(data);
	});

	window.popupAPI.onBlinkDetected((blinkData) => {
		lastBlinkTime = Date.now();

		if (blinkDisplayTimer) {
			clearTimeout(blinkDisplayTimer);
		}

		if (lastFaceData && isReliableFaceTracking(lastFaceData)) {
			const status = document.getElementById("status");
			if (status) {
				status.textContent = tr("popup.camera.blinkDetected");
				status.style.background = "rgba(0, 255, 0, 0.5)";
			}

			updateInfoDisplay(blinkData.ear, true);
		}

		blinkDisplayTimer = setTimeout(resetBlinkDisplay, 350);
	});

	window.popupAPI.onThresholdUpdated((newThreshold) => {
		if (thresholdUpdateTimer) {
			clearTimeout(thresholdUpdateTimer);
		}

		thresholdUpdateTimer = setTimeout(() => {
			currentThreshold = newThreshold;
			updateInfoDisplay(lastFaceData ? lastFaceData.ear : null);
		}, 200);
	});

	function paintPreviewFrame(jpeg, overlayFace) {
		const canvas = document.getElementById("canvas");
		if (!canvas || !jpeg) {
			return;
		}
		const ctx = canvas.getContext("2d");
		if (previewDecodeBusy) {
			// Keep only the newest frame — backlog = visible delay.
			pendingPreview = { jpeg, overlayFace };
			return;
		}
		previewDecodeBusy = true;
		previewImage.onload = function () {
			canvas.width = previewImage.width;
			canvas.height = previewImage.height;
			ctx.drawImage(
				previewImage,
				0,
				0,
				previewImage.width,
				previewImage.height,
			);
			drawOverlays(overlayFace);
			previewDecodeBusy = false;
			if (pendingPreview) {
				const next = pendingPreview;
				pendingPreview = null;
				paintPreviewFrame(next.jpeg, next.overlayFace);
			}
		};
		previewImage.onerror = function () {
			previewDecodeBusy = false;
			pendingPreview = null;
		};
		previewImage.src = "data:image/jpeg;base64," + jpeg;
	}

	window.popupAPI.onVideoStream((streamData) => {
		try {
			// Prefer frame-synced overlay payload; fall back to legacy base64 string.
			let jpeg = streamData;
			let overlayFace = lastFaceData;
			if (streamData && typeof streamData === "object") {
				jpeg = streamData.jpeg || streamData.videoStream || "";
				overlayFace = {
					faceDetected: Boolean(streamData.faceDetected),
					faceStatus: streamData.faceStatus || "none",
					faceRect: streamData.faceRect,
					eyeLandmarks: streamData.eyeLandmarks || [],
					ear: lastFaceData ? lastFaceData.ear : undefined,
					blink: lastFaceData ? lastFaceData.blink : false,
				};
			}
			paintPreviewFrame(jpeg, overlayFace);
		} catch (error) {
			console.error("Error handling video stream:", error);
			const status = document.getElementById("status");
			if (status) {
				status.textContent = tr("popup.camera.streamError");
				status.style.background = "rgba(255, 0, 0, 0.5)";
			}
		}
	});

	if (window.__i18n) {
		window.__i18n.onApply = function () {
			updateInfoDisplay(lastFaceData ? lastFaceData.ear : null);
			if (lastFaceData && !isReliableFaceTracking(lastFaceData)) {
				setFaceMissingOverlay(
					shouldShowMissingOverlay(lastFaceData),
					lastFaceData.faceStatus || "none",
				);
			}
		};
	}

	window.popupAPI.requestVideoStream();
	updateInfoDisplay(null);
}

if (document.readyState === "loading") {
	document.addEventListener("DOMContentLoaded", initCameraPopup);
} else {
	initCameraPopup();
}
