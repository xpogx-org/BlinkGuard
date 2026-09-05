// Popup size/position editor

function updateSizeDisplay() {
	const sizeDisplay = document.getElementById("sizeDisplay");
	if (sizeDisplay) {
		const inset = readPopupShadowInset();
		const width = Math.round(window.innerWidth - inset * 2);
		const height = Math.round(window.innerHeight - inset * 2);
		const tr =
			window.__i18n && typeof window.__i18n.t === "function"
				? window.__i18n.t.bind(window.__i18n)
				: (key) => key;
		sizeDisplay.textContent = tr("popup.editor.size", { width, height });
	}
}

function editorGeometry() {
	const inset = readPopupShadowInset();
	return {
		size: {
			width: Math.round(window.innerWidth - inset * 2),
			height: Math.round(window.innerHeight - inset * 2),
		},
		position: {
			x: Math.round(window.screenX + inset),
			y: Math.round(window.screenY + inset),
		},
	};
}

function savePopupEditor(scope) {
	window.popupAPI.savePopupEditor({ ...editorGeometry(), scope: scope || "current" });
}

function setSaveAllVisible(multiDisplay) {
	const saveAllBtn = document.getElementById("saveAllBtn");
	if (!saveAllBtn) return;
	saveAllBtn.hidden = !multiDisplay;
}

function setSetupNextVisible(hasNextUnsaved) {
	const setupNextBtn = document.getElementById("setupNextBtn");
	if (!setupNextBtn) return;
	setupNextBtn.hidden = !hasNextUnsaved;
}

function cancelPopupEditor() {
	window.close();
}

function initPopupEditor() {
	updateSizeDisplay();
	if (window.__i18n) {
		window.__i18n.onApply = updateSizeDisplay;
	}

	const saveBtn = document.getElementById("saveBtn");
	const saveAllBtn = document.getElementById("saveAllBtn");
	const setupNextBtn = document.getElementById("setupNextBtn");
	const cancelBtn = document.getElementById("cancelBtn");

	if (saveBtn) {
		saveBtn.addEventListener("click", () => savePopupEditor("current"));
	}

	if (saveAllBtn) {
		saveAllBtn.addEventListener("click", () => savePopupEditor("all"));
	}

	if (setupNextBtn) {
		setupNextBtn.addEventListener("click", () => savePopupEditor("next"));
	}

	if (cancelBtn) {
		cancelBtn.addEventListener("click", cancelPopupEditor);
	}

	document.addEventListener("keydown", (event) => {
		if (event.key === "Escape") {
			event.preventDefault();
			cancelPopupEditor();
		} else if (event.key === "Enter") {
			event.preventDefault();
			savePopupEditor("current");
		}
	});

	window.addEventListener("resize", updateSizeDisplay);

	let isDragging = false;
	let isOverResizeHandle = false;

	document.addEventListener("mousedown", (event) => {
		const target = event.target;
		if (target.classList.contains("resize-handle") || target.classList.contains("corner-indicator")) {
			isOverResizeHandle = true;
			return;
		}

		if (!isDragging && !isOverResizeHandle) {
			const dragIndicator = document.getElementById("dragIndicator");
			if (dragIndicator) {
				dragIndicator.classList.add("show");
				setTimeout(() => {
					dragIndicator.classList.remove("show");
				}, 2000);
			}
		}
	});

	const resizeHandles = document.querySelectorAll(".resize-handle");
	resizeHandles.forEach((handle) => {
		handle.addEventListener("mouseenter", () => {
			isOverResizeHandle = true;
		});
		handle.addEventListener("mouseleave", () => {
			isOverResizeHandle = false;
		});
	});
}

function initEditor() {
	updateColors(POPUP_THEME_DEFAULTS);

	initPopupEditor();

	updateColors({
		background: "#FFFFFF",
		text: "#000000",
		transparency: 0.9,
	});

	window.popupAPI.onPopupEditorUpdate((data) => {
		if (data.type === "colors") {
			updateColors(data.data);
		} else if (data.type === "state") {
			updateSizeDisplay();
			setSaveAllVisible(Boolean(data.data && data.data.multiDisplay));
			setSetupNextVisible(Boolean(data.data && data.data.hasNextUnsaved));
		}
	});
}

if (document.readyState === "loading") {
	document.addEventListener("DOMContentLoaded", initEditor);
} else {
	initEditor();
}
