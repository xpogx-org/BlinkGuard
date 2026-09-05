(function initTrayMenu() {
	const frame = document.getElementById("tray-menu-frame");
	const shell = document.getElementById("tray-menu-shell");
	const list = document.getElementById("tray-menu-list");
	if (!frame || !shell || !list || !window.popupAPI) return;

	let openGroupPanel = null;
	let lastReportedSize = null;
	let section = null;

	function readShadowInset() {
		return readPopupShadowInset();
	}

	const ICONS = {
		show:
			'<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="12" rx="2"/><path d="M8 21h8"/></svg>',
		tracking:
			'<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M10 8.5v7l5.5-3.5z"/></svg>',
		trackingStop:
			'<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><rect x="9" y="9" width="6" height="6" rx="1"/></svg>',
		hush:
			'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 9v6"/><path d="M15 9v6"/><path d="M5 9h2l2-2v10l-2-2H5z"/><path d="M19 9l-4 4"/></svg>',
		hushEnd:
			'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 9h2l2-2v10l-2-2H5z"/><path d="M15 9v6"/><path d="M19 9l-4 4"/></svg>',
		hushToken:
			'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l1.4 4.3H18l-3.6 2.6 1.4 4.3L12 11.6 8.2 14.2l1.4-4.3L6 7.3h4.6z"/></svg>',
		snooze:
			'<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
		setups:
			'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l2.2 4.5 5 .7-3.6 3.5.9 5-4.5-2.4-4.5 2.4.9-5L4.8 8.2l5-.7z"/></svg>',
		updates:
			'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v10"/><path d="M8 9l4 4 4-4"/><path d="M5 19h14"/></svg>',
		quit:
			'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4"/><path d="M15 12H8"/><path d="M18 9l3 3-3 3"/></svg>',
		camera:
			'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h4l2-2h4l2 2h4v10H4z"/><circle cx="12" cy="13" r="3"/></svg>',
		glance:
			'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6z"/><circle cx="12" cy="12" r="2.5"/></svg>',
		pause:
			'<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M10 9v6"/><path d="M14 9v6"/></svg>',
		snoozeItem:
			'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5h14v14H5z"/><path d="M9 12h6"/></svg>',
	};

	function setDarkMode(enabled) {
		document.documentElement.dataset.dark = enabled ? "true" : "false";
	}

	function applyTheme(payload) {
		setDarkMode(Boolean(payload.darkMode));
		updateColors({
			background: payload.colors?.background,
			text: payload.colors?.text,
			transparency: payload.transparency,
		});
	}

	function setGroupOpen(panel, trigger, open) {
		panel.classList.toggle("is-open", open);
		panel.setAttribute("aria-hidden", open ? "false" : "true");
		trigger.setAttribute("aria-expanded", open ? "true" : "false");
		trigger.querySelector(".tray-item__chevron")?.classList.toggle("is-open", open);
	}

	function collapseGroups() {
		if (!openGroupPanel) return false;
		const panel = openGroupPanel;
		const trigger = panel.previousElementSibling;
		if (trigger instanceof HTMLElement) {
			setGroupOpen(panel, trigger, false);
		} else {
			panel.classList.remove("is-open");
			panel.setAttribute("aria-hidden", "true");
		}
		openGroupPanel = null;
		return true;
	}

	function notifySize(force) {
		const width = frame.offsetWidth;
		const height = frame.offsetHeight;
		if (width <= 0 || height <= 0) return;
		const inset = readShadowInset();
		const next = {
			width: Math.ceil(width),
			height: Math.ceil(height),
			inset,
		};
		if (
			!force &&
			lastReportedSize &&
			lastReportedSize.width === next.width &&
			lastReportedSize.height === next.height &&
			lastReportedSize.inset === next.inset
		) {
			return;
		}
		lastReportedSize = next;
		window.popupAPI.notifyTrayMenuSize(next);
	}

	function scheduleSizeNotify(force) {
		requestAnimationFrame(() => notifySize(Boolean(force)));
	}

	function playShellEnter() {
		shell.classList.remove("popup-enter");
		void shell.offsetWidth;
		shell.classList.add("popup-enter");
	}

	const resizeObserver =
		typeof ResizeObserver === "function"
			? new ResizeObserver(() => scheduleSizeNotify(false))
			: null;
	resizeObserver?.observe(frame);

	function invokeAction(payload) {
		collapseGroups();
		void window.popupAPI.trayMenuAction(payload);
	}

	function icon(name) {
		const span = document.createElement("span");
		span.className = "tray-item__icon";
		span.innerHTML = ICONS[name] ?? ICONS.show;
		return span;
	}

	function label(text) {
		const span = document.createElement("span");
		span.className = "tray-item__label";
		span.textContent = text;
		return span;
	}

	function kbd(accelerator) {
		if (!accelerator) return null;
		const span = document.createElement("span");
		span.className = "tray-item__kbd";
		span.textContent = accelerator;
		return span;
	}

	function actionRow(text, options) {
		const row = document.createElement("button");
		row.type = "button";
		row.className = "tray-item";
		if (options.nested) row.classList.add("tray-item--nested");
		if (options.danger) row.classList.add("tray-item--danger");
		if (options.checked) row.classList.add("tray-item--checked");
		row.appendChild(icon(options.icon));
		row.appendChild(label(text));
		const shortcut = kbd(options.accelerator);
		if (shortcut) row.appendChild(shortcut);
		row.addEventListener("click", (event) => {
			event.stopPropagation();
			invokeAction(options.payload);
		});
		return row;
	}

	function statusRow(text, iconName) {
		const row = document.createElement("div");
		row.className = "tray-item tray-item--status";
		row.setAttribute("aria-disabled", "true");
		row.appendChild(icon(iconName));
		row.appendChild(label(text));
		return row;
	}

	function trackingRow(item) {
		const row = actionRow(item.label, {
			icon: item.isTracking ? "trackingStop" : "tracking",
			payload: { kind: "item", id: "tracking" },
			accelerator: item.accelerator,
		});
		const toggle = document.createElement("span");
		toggle.className = `tray-item__toggle${item.isTracking ? " is-on" : ""}`;
		toggle.setAttribute("aria-hidden", "true");
		const knob = document.createElement("span");
		knob.className = "tray-item__toggle-knob";
		toggle.appendChild(knob);
		row.appendChild(toggle);
		return row;
	}

	function expandableGroup(item, kind) {
		const wrap = document.createElement("div");
		wrap.className = "tray-menu-group";

		const panelId = `tray-group-${kind}`;
		const trigger = document.createElement("button");
		trigger.type = "button";
		trigger.className = "tray-item tray-menu-group__trigger";
		trigger.setAttribute("aria-expanded", "false");
		trigger.setAttribute("aria-controls", panelId);
		trigger.appendChild(icon(kind === "snooze" ? "snooze" : "setups"));
		trigger.appendChild(label(item.label));
		const chevron = document.createElement("span");
		chevron.className = "tray-item__chevron";
		chevron.textContent = "›";
		chevron.setAttribute("aria-hidden", "true");
		trigger.appendChild(chevron);

		const panel = document.createElement("div");
		panel.id = panelId;
		panel.className = "tray-menu-group__panel";
		panel.setAttribute("aria-hidden", "true");
		panel.setAttribute("role", "group");

		const panelInner = document.createElement("div");
		panelInner.className = "tray-menu-group__panel-inner";

		for (const child of item.submenu) {
			panelInner.appendChild(
				actionRow(child.label, {
					icon: kind === "snooze" ? "snoozeItem" : "setups",
					nested: true,
					checked: kind === "setups" && child.checked,
					payload:
						kind === "snooze"
							? { kind: "snooze", id: child.id }
							: { kind: "setup", id: child.id },
				}),
			);
		}

		panel.appendChild(panelInner);

		trigger.addEventListener("click", (event) => {
			event.stopPropagation();
			const isOpen = panel.classList.contains("is-open");
			if (openGroupPanel && openGroupPanel !== panel) {
				collapseGroups();
			}
			if (isOpen) {
				collapseGroups();
				return;
			}
			setGroupOpen(panel, trigger, true);
			openGroupPanel = panel;
		});

		wrap.appendChild(trigger);
		wrap.appendChild(panel);
		return wrap;
	}

	function beginSection() {
		const next = document.createElement("div");
		next.className = "tray-menu-section";
		list.appendChild(next);
		return next;
	}

	function startNextSection() {
		if (section && section.childElementCount > 0) {
			section = beginSection();
		}
	}

	function renderSpec(spec) {
		openGroupPanel = null;
		list.replaceChildren();
		lastReportedSize = null;

		section = beginSection();

		for (const item of spec) {
			switch (item.id) {
				case "show":
					section.appendChild(
						actionRow(item.label, {
							icon: "show",
							payload: { kind: "item", id: "show" },
							accelerator: item.accelerator,
						}),
					);
					break;
				case "tracking":
					section.appendChild(trackingRow(item));
					break;
				case "hush":
					section.appendChild(
						actionRow(item.label, {
							icon: item.active ? "hushEnd" : "hush",
							payload: { kind: "item", id: "hush" },
							accelerator: item.accelerator,
						}),
					);
					break;
				case "hush-token":
					section.appendChild(
						actionRow(item.label, {
							icon: "hushToken",
							payload: { kind: "item", id: "hush-token" },
							accelerator: item.accelerator,
						}),
					);
					break;
				case "camera":
				case "glance":
				case "pause":
					section.appendChild(
						statusRow(
							item.label,
							item.id === "camera"
								? "camera"
								: item.id === "glance"
									? "glance"
									: "pause",
						),
					);
					break;
				case "separator":
					startNextSection();
					break;
				case "snooze":
					section.appendChild(expandableGroup(item, "snooze"));
					break;
				case "setups":
					section.appendChild(expandableGroup(item, "setups"));
					break;
				case "check-for-updates":
					section.appendChild(
						actionRow(item.label, {
							icon: "updates",
							payload: { kind: "item", id: "check-for-updates" },
						}),
					);
					break;
				case "quit":
					section.appendChild(
						actionRow(item.label, {
							icon: "quit",
							payload: { kind: "item", id: "quit" },
							danger: true,
						}),
					);
					break;
			}
		}

		scheduleSizeNotify(true);
	}

	window.popupAPI.onTrayMenuRender((payload) => {
		if (!payload) return;
		applyTheme(payload);
		renderSpec(payload.spec ?? []);
	});

	window.popupAPI.onTrayMenuReveal(() => {
		playShellEnter();
	});

	document.addEventListener("keydown", (event) => {
		if (event.key === "Escape") {
			event.preventDefault();
			if (collapseGroups()) return;
			window.popupAPI.notifyTrayMenuHide();
		}
	});

	window.popupAPI.notifyTrayMenuReady();
})();
