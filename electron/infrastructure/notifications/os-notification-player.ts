import { Notification } from "electron";
import type {
	OsNotificationPort,
	OsToastKind,
	OsToastPayload,
	OsToastShowResult,
} from "../../application/ports/runtime-ports";

export const OS_TOAST_ID_PREFIX = "blinkguard-";

export function osToastId(kind: OsToastKind): string {
	return `${OS_TOAST_ID_PREFIX}${kind}`;
}

export function osToastKindFromId(id: string | undefined): OsToastKind | null {
	if (id === osToastId("blink")) return "blink";
	if (id === osToastId("exercise")) return "exercise";
	if (id === osToastId("lookAway")) return "lookAway";
	if (id === osToastId("sessionRecap")) return "sessionRecap";
	return null;
}

type ActivationDetails = {
	type?: string;
	actionIndex?: number;
	arguments?: string;
};

type NotificationStatic = typeof Notification & {
	handleActivation?: (callback: (details: ActivationDetails) => void) => void;
};

type OsNotificationPlayerOptions = {
	platform?: NodeJS.Platform;
};

/**
 * Main-process OS toasts for blink / exercise / look-away.
 * Always silent so BlinkGuard's sound player stays the only chime.
 * Windows: Notification.handleActivation is the click/snooze source of truth.
 * macOS / other: instance click / action events.
 */
export class OsNotificationPlayer implements OsNotificationPort {
	private readonly platform: NodeJS.Platform;
	private readonly instances = new Map<OsToastKind, Notification>();
	private readonly failedHooks = new Map<OsToastKind, () => void>();
	private handlers: {
		onClick: (kind: OsToastKind) => void;
		onSnooze: (kind: OsToastKind) => void;
	} | null = null;
	private lastShownKind: OsToastKind | null = null;
	private lastActivationAt = 0;
	private lastActivationKey = "";
	private activationRegistered = false;

	constructor(options: OsNotificationPlayerOptions = {}) {
		this.platform = options.platform ?? process.platform;
	}

	isSupported(): boolean {
		try {
			return Notification.isSupported();
		} catch {
			return false;
		}
	}

	setActivationHandlers(handlers: {
		onClick: (kind: OsToastKind) => void;
		onSnooze: (kind: OsToastKind) => void;
	}): void {
		this.handlers = handlers;
		if (this.activationRegistered) return;
		if (this.platform !== "win32") return;
		const ctor = Notification as NotificationStatic;
		if (typeof ctor.handleActivation !== "function") return;
		ctor.handleActivation((details) => this.onWindowsActivation(details));
		this.activationRegistered = true;
	}

	show(
		kind: OsToastKind,
		payload: OsToastPayload,
		hooks?: { onFailed?: () => void },
	): OsToastShowResult {
		if (!this.isSupported()) return { shown: false };
		this.dismiss(kind);
		let notification: Notification;
		try {
			notification = new Notification({
				id: osToastId(kind),
				title: payload.title,
				body: payload.body,
				silent: true,
				actions: [{ type: "button", text: payload.snoozeLabel }],
			});
		} catch {
			return { shown: false };
		}

		this.instances.set(kind, notification);
		this.lastShownKind = kind;
		if (hooks?.onFailed) {
			this.failedHooks.set(kind, hooks.onFailed);
		} else {
			this.failedHooks.delete(kind);
		}

		notification.on("failed", () => {
			this.instances.delete(kind);
			const failed = this.failedHooks.get(kind);
			this.failedHooks.delete(kind);
			failed?.();
		});

		const useInstanceActions =
			this.platform !== "win32" ||
			typeof (Notification as NotificationStatic).handleActivation !==
				"function";
		if (useInstanceActions) {
			notification.on("click", () => {
				this.emitClick(kind);
			});
			notification.on("action", (event: { actionIndex?: number }, index?: number) => {
				const actionIndex =
					typeof event?.actionIndex === "number" ? event.actionIndex : index;
				if (actionIndex === 0) this.emitSnooze(kind);
			});
		}

		try {
			notification.show();
			return { shown: true };
		} catch {
			this.instances.delete(kind);
			this.failedHooks.delete(kind);
			return { shown: false };
		}
	}

	showSessionRecap(payload: { title: string; body: string }): OsToastShowResult {
		if (!this.isSupported()) return { shown: false };
		this.dismiss("sessionRecap");
		const body =
			payload.body.length > 240
				? `${payload.body.slice(0, 239)}…`
				: payload.body;
		let notification: Notification;
		try {
			notification = new Notification({
				id: osToastId("sessionRecap"),
				title: payload.title,
				body,
				silent: true,
			});
		} catch {
			return { shown: false };
		}

		this.instances.set("sessionRecap", notification);
		this.lastShownKind = "sessionRecap";

		notification.on("failed", () => {
			this.instances.delete("sessionRecap");
		});

		const useInstanceActions =
			this.platform !== "win32" ||
			typeof (Notification as NotificationStatic).handleActivation !==
				"function";
		if (useInstanceActions) {
			notification.on("click", () => {
				this.emitClick("sessionRecap");
			});
		}

		try {
			notification.show();
			return { shown: true };
		} catch {
			this.instances.delete("sessionRecap");
			return { shown: false };
		}
	}

	dismiss(kind: OsToastKind): void {
		const notification = this.instances.get(kind);
		this.instances.delete(kind);
		this.failedHooks.delete(kind);
		if (!notification) return;
		try {
			notification.close();
		} catch {
			/* already gone */
		}
	}

	dismissAll(): void {
		for (const kind of [...this.instances.keys()]) {
			this.dismiss(kind);
		}
	}

	private onWindowsActivation(details: ActivationDetails): void {
		const kind =
			this.kindFromArguments(details.arguments) ??
			this.singleOpenKind() ??
			this.lastShownKind;
		if (!kind) return;
		if (details.type === "action") {
			this.emitSnooze(kind);
			return;
		}
		if (details.type === "click" || !details.type) {
			this.emitClick(kind);
		}
	}

	private kindFromArguments(raw: string | undefined): OsToastKind | null {
		if (!raw) return null;
		if (raw.includes(osToastId("lookAway"))) return "lookAway";
		if (raw.includes(osToastId("exercise"))) return "exercise";
		if (raw.includes(osToastId("blink"))) return "blink";
		if (raw.includes(osToastId("sessionRecap"))) return "sessionRecap";
		return osToastKindFromId(raw);
	}

	private singleOpenKind(): OsToastKind | null {
		if (this.instances.size !== 1) return null;
		return [...this.instances.keys()][0] ?? null;
	}

	private emitClick(kind: OsToastKind): void {
		if (!this.shouldEmit(`click:${kind}`)) return;
		this.handlers?.onClick(kind);
	}

	private emitSnooze(kind: OsToastKind): void {
		if (!this.shouldEmit(`snooze:${kind}`)) return;
		this.handlers?.onSnooze(kind);
	}

	private shouldEmit(key: string): boolean {
		const now = Date.now();
		if (key === this.lastActivationKey && now - this.lastActivationAt < 300) {
			return false;
		}
		this.lastActivationKey = key;
		this.lastActivationAt = now;
		return true;
	}
}
