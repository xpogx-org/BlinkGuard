import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AutoUpdateStatus } from "../../../shared/auto-update";

const { showMessageBox, checkForUpdatesMock, quitAndInstall, autoUpdater } =
	vi.hoisted(() => {
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		const { EventEmitter } =
			require("node:events") as typeof import("node:events");
		const checkForUpdatesMock = vi.fn(() => Promise.resolve(null));
		const quitAndInstall = vi.fn();
		const showMessageBox = vi.fn(() => Promise.resolve({ response: 1 }));
		const autoUpdater = Object.assign(new EventEmitter(), {
			autoDownload: false,
			autoInstallOnAppQuit: false,
			checkForUpdates: checkForUpdatesMock,
			quitAndInstall,
		});
		return {
			showMessageBox,
			checkForUpdatesMock,
			quitAndInstall,
			autoUpdater,
		};
	});

vi.mock("electron", () => ({
	app: { isPackaged: true },
	dialog: { showMessageBox },
}));

vi.mock("electron-updater", () => ({
	default: { autoUpdater },
}));

vi.mock("../../../electron/infrastructure/updates/update-feed", () => ({
	isAutoUpdatePlatform: () => true,
	hasUpdateFeed: () => true,
}));

vi.mock("../../../electron/infrastructure/process/process-cleanup", () => ({
	killOrphanedSidecarProcesses: vi.fn(() => Promise.resolve()),
}));

import {
	AutoUpdateService,
	UPDATE_CHECK_MS,
	isNewerVersion,
} from "../../../electron/infrastructure/updates/auto-update-service";

async function flushMicrotasks(): Promise<void> {
	await Promise.resolve();
	await Promise.resolve();
}

describe("isNewerVersion", () => {
	it("compares major.minor.patch", () => {
		expect(isNewerVersion("2.5.1", "2.5.0")).toBe(true);
		expect(isNewerVersion("2.5.0", "2.5.1")).toBe(false);
		expect(isNewerVersion("2.5.0", "2.5.0")).toBe(false);
		expect(isNewerVersion("v3.0.0", "2.9.9")).toBe(true);
	});
});

describe("AutoUpdateService", () => {
	let emitted: AutoUpdateStatus[];
	let ensureVisibleCalls: number;
	let canHost: boolean;
	let service: AutoUpdateService | null;

	beforeEach(() => {
		emitted = [];
		ensureVisibleCalls = 0;
		canHost = true;
		service = null;
		autoUpdater.removeAllListeners();
		checkForUpdatesMock.mockClear();
		checkForUpdatesMock.mockImplementation(() => Promise.resolve(null));
		quitAndInstall.mockClear();
		showMessageBox.mockClear();
		vi.useRealTimers();
	});

	afterEach(() => {
		service?.dispose();
		service = null;
		vi.useRealTimers();
	});

	function createService(): AutoUpdateService {
		service = new AutoUpdateService(() => "en", {
			emit: (status) => {
				emitted.push(status);
			},
			ensureVisible: () => {
				ensureVisibleCalls += 1;
			},
			canHostInAppUi: () => canHost,
		});
		return service;
	}

	it("emits unavailable dialog for interactive check when disabled", () => {
		const svc = createService();
		svc.checkForUpdates({ interactive: true });
		expect(emitted).toEqual([{ state: "unavailable", surface: "dialog" }]);
		expect(ensureVisibleCalls).toBeGreaterThan(0);
		expect(checkForUpdatesMock).not.toHaveBeenCalled();
	});

	it("quiet check does not emit when disabled", () => {
		const svc = createService();
		svc.checkForUpdates();
		expect(emitted).toEqual([]);
		expect(ensureVisibleCalls).toBe(0);
	});

	it("interactive check emits dialog surface and brings window forward", () => {
		const svc = createService();
		svc.start();
		svc.checkForUpdates({ interactive: true });
		expect(emitted).toEqual([{ state: "checking", surface: "dialog" }]);
		expect(ensureVisibleCalls).toBe(1);
		autoUpdater.emit("update-not-available");
		expect(emitted.at(-1)).toEqual({ state: "upToDate", surface: "dialog" });
		expect(ensureVisibleCalls).toBe(2);
	});

	it("silent check emits toast surface without ensureVisible", () => {
		const svc = createService();
		svc.start();
		svc.checkForUpdates();
		expect(emitted).toEqual([{ state: "checking", surface: "toast" }]);
		expect(ensureVisibleCalls).toBe(0);
		autoUpdater.emit("update-not-available");
		expect(emitted).toEqual([
			{ state: "checking", surface: "toast" },
			{ state: "upToDate", surface: "toast" },
		]);
		expect(ensureVisibleCalls).toBe(0);
	});

	it("interactive download uses dialog surface throughout", () => {
		const svc = createService();
		svc.start();
		svc.checkForUpdates({ interactive: true });
		autoUpdater.emit("update-available", { version: "2.0.0" });
		autoUpdater.emit("download-progress", { percent: 42.6 });
		autoUpdater.emit("update-downloaded", { version: "2.0.0" });
		expect(emitted).toEqual([
			{ state: "checking", surface: "dialog" },
			{ state: "available", version: "2.0.0", surface: "dialog" },
			{
				state: "downloading",
				version: "2.0.0",
				percent: 43,
				surface: "dialog",
			},
			{ state: "ready", version: "2.0.0", surface: "dialog" },
		]);
	});

	it("silent download keeps ready as toast without ensureVisible", () => {
		const svc = createService();
		svc.start();
		svc.checkForUpdates();
		expect(ensureVisibleCalls).toBe(0);
		autoUpdater.emit("update-available", { version: "2.1.0" });
		autoUpdater.emit("download-progress", { percent: 10 });
		expect(ensureVisibleCalls).toBe(0);
		autoUpdater.emit("update-downloaded", { version: "2.1.0" });
		expect(emitted).toEqual([
			{ state: "checking", surface: "toast" },
			{ state: "available", version: "2.1.0", surface: "toast" },
			{
				state: "downloading",
				version: "2.1.0",
				percent: 10,
				surface: "toast",
			},
			{ state: "ready", version: "2.1.0", surface: "toast" },
		]);
		expect(ensureVisibleCalls).toBe(0);
	});

	it("installUpdate re-checks then quitAndInstall when staged is still latest", async () => {
		const svc = createService();
		svc.start();
		svc.checkForUpdates({ interactive: true });
		autoUpdater.emit("update-downloaded", { version: "3.0.0" });
		quitAndInstall.mockClear();
		checkForUpdatesMock.mockClear();
		svc.installUpdate();
		expect(checkForUpdatesMock).toHaveBeenCalledTimes(1);
		expect(quitAndInstall).not.toHaveBeenCalled();
		autoUpdater.emit("update-available", { version: "3.0.0" });
		await flushMicrotasks();
		expect(quitAndInstall).toHaveBeenCalledWith(false, true);
	});

	it("installUpdate awaits stopSidecar before quitAndInstall", async () => {
		let released: () => void = () => {};
		const stopSidecar = vi.fn(
			() =>
				new Promise<void>((resolve) => {
					released = resolve;
				}),
		);
		const svc = new AutoUpdateService(
			() => "en",
			{
				emit: (status) => {
					emitted.push(status);
				},
				ensureVisible: () => {
					ensureVisibleCalls += 1;
				},
				canHostInAppUi: () => canHost,
			},
			stopSidecar,
		);
		service = svc;
		svc.start();
		svc.checkForUpdates({ interactive: true });
		autoUpdater.emit("update-downloaded", { version: "3.0.0" });
		quitAndInstall.mockClear();
		svc.installUpdate();
		autoUpdater.emit("update-available", { version: "3.0.0" });
		await flushMicrotasks();
		expect(stopSidecar).toHaveBeenCalledTimes(1);
		expect(quitAndInstall).not.toHaveBeenCalled();
		released();
		await flushMicrotasks();
		expect(quitAndInstall).toHaveBeenCalledWith(false, true);
	});

	it("installUpdate does not quitAndInstall when a newer latest appears", async () => {
		const svc = createService();
		svc.start();
		svc.checkForUpdates({ interactive: true });
		autoUpdater.emit("update-downloaded", { version: "2.5.0" });
		quitAndInstall.mockClear();
		svc.installUpdate();
		autoUpdater.emit("update-available", { version: "2.5.1" });
		await flushMicrotasks();
		expect(quitAndInstall).not.toHaveBeenCalled();
		autoUpdater.emit("update-downloaded", { version: "2.5.1" });
		await flushMicrotasks();
		expect(quitAndInstall).toHaveBeenCalledWith(false, true);
	});

	it("re-checks GitHub when staged and re-presents ready if still latest", () => {
		const svc = createService();
		svc.start();
		svc.checkForUpdates({ interactive: true });
		autoUpdater.emit("update-downloaded", { version: "3.0.0" });
		emitted.length = 0;
		ensureVisibleCalls = 0;
		checkForUpdatesMock.mockClear();
		svc.checkForUpdates({ interactive: true });
		expect(checkForUpdatesMock).toHaveBeenCalledTimes(1);
		expect(emitted).toEqual([{ state: "checking", surface: "dialog" }]);
		autoUpdater.emit("update-available", { version: "3.0.0" });
		expect(emitted.at(-1)).toEqual({
			state: "ready",
			version: "3.0.0",
			surface: "dialog",
		});
		expect(ensureVisibleCalls).toBeGreaterThan(0);
	});

	it("silent check re-queries GitHub when staged and presents ready if unchanged", () => {
		const svc = createService();
		svc.start();
		svc.checkForUpdates();
		autoUpdater.emit("update-downloaded", { version: "3.0.0" });
		emitted.length = 0;
		ensureVisibleCalls = 0;
		checkForUpdatesMock.mockClear();
		svc.checkForUpdates();
		expect(checkForUpdatesMock).toHaveBeenCalledTimes(1);
		autoUpdater.emit("update-available", { version: "3.0.0" });
		expect(emitted).toEqual([
			{ state: "ready", version: "3.0.0", surface: "toast" },
		]);
		expect(ensureVisibleCalls).toBe(0);
	});

	it("replaces stale staged package when a newer latest is available", () => {
		const svc = createService();
		svc.start();
		svc.checkForUpdates();
		autoUpdater.emit("update-downloaded", { version: "2.5.0" });
		emitted.length = 0;
		checkForUpdatesMock.mockClear();
		svc.checkForUpdates();
		expect(checkForUpdatesMock).toHaveBeenCalledTimes(1);
		autoUpdater.emit("update-available", { version: "2.5.1" });
		autoUpdater.emit("download-progress", { percent: 50 });
		autoUpdater.emit("update-downloaded", { version: "2.5.1" });
		expect(emitted).toEqual([
			{ state: "available", version: "2.5.1", surface: "toast" },
			{
				state: "downloading",
				version: "2.5.1",
				percent: 50,
				surface: "toast",
			},
			{ state: "ready", version: "2.5.1", surface: "toast" },
		]);
	});

	it("background poll re-checks even when staged and refreshes newer latest", () => {
		const svc = createService();
		svc.start();
		svc.checkForUpdates();
		autoUpdater.emit("update-downloaded", { version: "5.0.0" });
		emitted.length = 0;
		checkForUpdatesMock.mockClear();
		svc.checkForUpdates({ background: true });
		expect(checkForUpdatesMock).toHaveBeenCalledTimes(1);
		expect(emitted).toEqual([]);
		autoUpdater.emit("update-available", { version: "5.1.0" });
		expect(emitted).toEqual([
			{ state: "available", version: "5.1.0", surface: "toast" },
		]);
	});

	it("background stays quiet when staged package is still latest", () => {
		const svc = createService();
		svc.start();
		svc.checkForUpdates();
		autoUpdater.emit("update-downloaded", { version: "5.0.0" });
		emitted.length = 0;
		svc.checkForUpdates({ background: true });
		autoUpdater.emit("update-available", { version: "5.0.0" });
		expect(emitted).toEqual([]);
	});

	it("clears staged download on update-not-available so install is a no-op", () => {
		const svc = createService();
		svc.start();
		svc.checkForUpdates();
		autoUpdater.emit("update-downloaded", { version: "6.0.0" });
		svc.checkForUpdates({ interactive: true });
		autoUpdater.emit("update-not-available");
		quitAndInstall.mockClear();
		checkForUpdatesMock.mockClear();
		svc.installUpdate();
		expect(quitAndInstall).not.toHaveBeenCalled();
		expect(checkForUpdatesMock).not.toHaveBeenCalled();
	});

	it("uses native dialog fallback when main window cannot host UI", () => {
		canHost = false;
		const svc = createService();
		svc.start();
		svc.checkForUpdates({ interactive: true });
		autoUpdater.emit("update-not-available");
		expect(emitted).toEqual([]);
		expect(showMessageBox).toHaveBeenCalled();
		expect(ensureVisibleCalls).toBe(0);
	});

	it("background interval polls after UPDATE_CHECK_MS", () => {
		vi.useFakeTimers();
		const svc = createService();
		svc.start();
		checkForUpdatesMock.mockClear();
		vi.advanceTimersByTime(UPDATE_CHECK_MS - 1);
		expect(checkForUpdatesMock).not.toHaveBeenCalled();
		vi.advanceTimersByTime(1);
		expect(checkForUpdatesMock).toHaveBeenCalledTimes(1);
	});

	it("background upToDate does not emit status", () => {
		const svc = createService();
		svc.start();
		emitted.length = 0;
		svc.checkForUpdates({ background: true });
		expect(emitted).toEqual([]);
		autoUpdater.emit("update-not-available");
		expect(emitted).toEqual([]);
	});

	it("background available still emits toast surface", () => {
		const svc = createService();
		svc.start();
		emitted.length = 0;
		svc.checkForUpdates({ background: true });
		autoUpdater.emit("update-available", { version: "4.0.0" });
		expect(emitted).toEqual([
			{ state: "available", version: "4.0.0", surface: "toast" },
		]);
	});

	it("dispose stops further interval polls", () => {
		vi.useFakeTimers();
		const svc = createService();
		svc.start();
		svc.dispose();
		checkForUpdatesMock.mockClear();
		vi.advanceTimersByTime(UPDATE_CHECK_MS * 2);
		expect(checkForUpdatesMock).not.toHaveBeenCalled();
	});

	it("start disables autoInstallOnAppQuit", () => {
		const svc = createService();
		svc.start();
		expect(autoUpdater.autoInstallOnAppQuit).toBe(false);
	});

	it("resolveQuitWithStagedUpdate proceeds when no staged update", async () => {
		const svc = createService();
		svc.start();
		await expect(svc.resolveQuitWithStagedUpdate()).resolves.toBe("proceed");
		expect(showMessageBox).not.toHaveBeenCalled();
	});

	it("resolveQuitWithStagedUpdate installs when user chooses Install", async () => {
		showMessageBox.mockResolvedValueOnce({ response: 0 });
		const svc = createService();
		svc.start();
		svc.checkForUpdates();
		autoUpdater.emit("update-downloaded", { version: "7.0.0" });
		checkForUpdatesMock.mockClear();
		quitAndInstall.mockClear();
		await expect(svc.resolveQuitWithStagedUpdate()).resolves.toBe("cancel");
		expect(showMessageBox).toHaveBeenCalledTimes(1);
		expect(checkForUpdatesMock).toHaveBeenCalledTimes(1);
	});

	it("resolveQuitWithStagedUpdate proceeds without install when user quits without", async () => {
		showMessageBox.mockResolvedValueOnce({ response: 1 });
		const svc = createService();
		svc.start();
		svc.checkForUpdates();
		autoUpdater.emit("update-downloaded", { version: "7.1.0" });
		quitAndInstall.mockClear();
		await expect(svc.resolveQuitWithStagedUpdate()).resolves.toBe("proceed");
		expect(showMessageBox).toHaveBeenCalledTimes(1);
		expect(quitAndInstall).not.toHaveBeenCalled();
	});

	it("resolveQuitWithStagedUpdate cancels quit when user dismisses prompt", async () => {
		showMessageBox.mockResolvedValueOnce({ response: 2 });
		const svc = createService();
		svc.start();
		svc.checkForUpdates();
		autoUpdater.emit("update-downloaded", { version: "7.2.0" });
		quitAndInstall.mockClear();
		await expect(svc.resolveQuitWithStagedUpdate()).resolves.toBe("cancel");
		expect(showMessageBox).toHaveBeenCalledTimes(1);
		expect(quitAndInstall).not.toHaveBeenCalled();
	});
});
