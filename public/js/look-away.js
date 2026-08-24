// Look-away / 20-20-20 popup

function readDurationSeconds() {
	const params = new URLSearchParams(window.location.search);
	const raw = Number.parseInt(params.get("duration") || "20", 10);
	if (!Number.isFinite(raw) || raw < 1) return 20;
	return raw;
}

function skipLookAway() {
	window.popupAPI.skipLookAway();
	window.close();
}

function snoozeLookAway() {
	window.popupAPI.snoozeLookAway();
	window.close();
}

function applyLookAwayClickThrough(enabled) {
	const a11y = window.__popupA11y;
	const root = document.getElementById("container");
	const actions = document.querySelector(".look-away-buttons");
	const snoozeBtn = document.querySelector(".look-away-button.snooze");
	if (!a11y || !root) return;

	a11y.setActionsHidden(actions, enabled);
	if (enabled) {
		a11y.teardownInteractiveDialog(root);
		return;
	}
	a11y.mountInteractiveDialog({
		root: root,
		labelledById: "look-away-title",
		primaryEl: snoozeBtn,
		onEscape: snoozeLookAway,
	});
}

function initLookAwayPopup() {
	const titleEl = document.getElementById("look-away-title");
	const hintEl = document.getElementById("look-away-hint");
	window.popupAPI.onUpdateLookAwayCopy((copy) => {
		if (titleEl && typeof copy?.title === "string") {
			titleEl.textContent = copy.title;
		}
		if (hintEl && typeof copy?.hint === "string") {
			hintEl.textContent = copy.hint;
		}
	});

	const countdownEl = document.getElementById("countdown");
	const ringEl = document.getElementById("countdown-ring");
	const total = readDurationSeconds();
	let remaining = total;
	const ringLength = 2 * Math.PI * 38;

	function renderCountdown(tickNumber) {
		if (countdownEl) {
			countdownEl.textContent = String(Math.max(0, remaining));
			if (tickNumber) {
				countdownEl.classList.remove("is-ticking");
				void countdownEl.offsetWidth;
				countdownEl.classList.add("is-ticking");
			}
		}
		if (ringEl) {
			const progress = total <= 0 ? 0 : Math.max(0, remaining) / total;
			ringEl.style.strokeDasharray = String(ringLength);
			ringEl.style.strokeDashoffset = String(ringLength * (1 - progress));
		}
	}

	renderCountdown(false);

	const tick = window.setInterval(() => {
		remaining -= 1;
		renderCountdown(true);
		if (remaining <= 0) {
			window.clearInterval(tick);
		}
	}, 1000);

	const skipBtn = document.querySelector(".look-away-button.skip");
	const snoozeBtn = document.querySelector(".look-away-button.snooze");

	if (skipBtn) {
		skipBtn.addEventListener("click", skipLookAway);
	}
	if (snoozeBtn) {
		snoozeBtn.addEventListener("click", snoozeLookAway);
	}

	window.popupAPI.onBlinkClickThrough(applyLookAwayClickThrough);
}

function initLookAway() {
	updateColors(POPUP_THEME_DEFAULTS);

	initLookAwayPopup();
}

if (document.readyState === "loading") {
	document.addEventListener("DOMContentLoaded", initLookAway);
} else {
	initLookAway();
}
