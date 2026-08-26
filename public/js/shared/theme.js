// Shared popup theme helpers (CSS variables + reminder text/mode)

const POPUP_THEME_DEFAULTS = {
	background: "#0f172a",
	text: "#f8fafc",
	transparency: 0.15,
};

function parseHexColor(hex) {
	if (typeof hex !== "string") return null;
	const raw = hex.trim().replace(/^#/, "");
	if (!/^[0-9a-fA-F]{3}$/.test(raw) && !/^[0-9a-fA-F]{6}$/.test(raw)) {
		return null;
	}
	const full =
		raw.length === 3
			? raw
					.split("")
					.map((c) => c + c)
					.join("")
			: raw;
	return {
		r: Number.parseInt(full.slice(0, 2), 16),
		g: Number.parseInt(full.slice(2, 4), 16),
		b: Number.parseInt(full.slice(4, 6), 16),
	};
}

function clamp01(value) {
	if (!Number.isFinite(value)) return 0;
	return Math.min(1, Math.max(0, value));
}

/** Card/surface alpha from transparency — keep window opacity at 1 for sharp glyphs. */
function applyPopupSurfaceAlpha() {
	const root = document.documentElement;
	const styles = getComputedStyle(root);
	const transparency = clamp01(
		Number.parseFloat(styles.getPropertyValue("--popup-transparency")),
	);
	const alpha = clamp01(1 - transparency);
	const bg =
		styles.getPropertyValue("--popup-bg-color").trim() ||
		POPUP_THEME_DEFAULTS.background;
	const rgb = parseHexColor(bg);
	if (rgb) {
		root.style.setProperty(
			"--popup-bg-alpha",
			`rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`,
		);
		root.style.setProperty(
			"--popup-surface",
			`rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${Math.min(0.92, Math.max(0.2, alpha))})`,
		);
		return;
	}
	const pct = Math.round(alpha * 100);
	root.style.setProperty(
		"--popup-bg-alpha",
		`color-mix(in srgb, ${bg} ${pct}%, transparent)`,
	);
	root.style.setProperty(
		"--popup-surface",
		`color-mix(in srgb, ${bg} ${Math.min(92, Math.max(20, pct))}%, transparent)`,
	);
}

function updateColors(colors) {
	if (!colors) return;
	if (colors.background) {
		document.documentElement.style.setProperty(
			"--popup-bg-color",
			colors.background,
		);
	}
	if (colors.text) {
		document.documentElement.style.setProperty(
			"--popup-text-color",
			colors.text,
		);
	}
	if (typeof colors.transparency === "number") {
		document.documentElement.style.setProperty(
			"--popup-transparency",
			String(clamp01(colors.transparency)),
		);
	}
	applyPopupSurfaceAlpha();
	applyPopupGlow(colors);
}

const POPUP_GLOW_VAR_KEYS = ["outer", "mid", "inner", "accent", "accent2"];

function clearPopupGlow(root) {
	delete root.dataset.popupGlow;
	for (const key of POPUP_GLOW_VAR_KEYS) {
		root.style.removeProperty(`--popup-glow-${key}`);
	}
}

function applyPopupGlow(colors) {
	const root = document.documentElement;
	const preset = colors?.glowPreset;
	const glow = colors?.glow;
	if (
		(preset === "aurora" || preset === "sunset") &&
		glow &&
		typeof glow === "object"
	) {
		root.dataset.popupGlow = preset;
		for (const key of POPUP_GLOW_VAR_KEYS) {
			if (typeof glow[key] === "string") {
				root.style.setProperty(`--popup-glow-${key}`, glow[key]);
			}
		}
		// Tie accent tokens used elsewhere (icons, ambient-adjacent chrome).
		if (glow.accent) {
			root.style.setProperty("--popup-accent", glow.accent);
			root.style.setProperty(
				"--popup-accent-soft",
				`color-mix(in srgb, ${glow.accent} 14%, transparent)`,
			);
		}
		if (glow.accent2) {
			root.style.setProperty("--popup-accent-hover", glow.accent2);
		}
		return;
	}
	clearPopupGlow(root);
}

function updateMessage(message) {
	const blinkElement = document.getElementById("blink");
	if (!blinkElement) return;
	const messageEl = blinkElement.querySelector(".reminder-message");
	if (messageEl) {
		messageEl.textContent = message;
	} else {
		blinkElement.textContent = message;
	}
}

function updateCameraMode(isEnabled) {
	const blinkElement = document.getElementById("blink");
	if (!blinkElement) return;
	blinkElement.classList.toggle("camera-mode", Boolean(isEnabled));
}

applyPopupSurfaceAlpha();
