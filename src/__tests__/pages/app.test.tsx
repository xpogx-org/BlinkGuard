import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "@/app";
import { version } from "../../../package.json";
import { IPC_CHANNELS } from "../../../shared/ipc-channels";
import {
	DEFAULT_PREFERENCES,
	type RendererPreferences,
	toRendererPreferences,
} from "../../../shared/preferences";

vi.mock("lottie-web/build/player/lottie_light", () => ({
	default: {
		loadAnimation: () => ({
			goToAndStop: vi.fn(),
			goToAndPlay: vi.fn(),
			playSegments: vi.fn(),
			resetSegments: vi.fn(),
			setSpeed: vi.fn(),
			setDirection: vi.fn(),
			addEventListener: vi.fn(),
			removeEventListener: vi.fn(),
			destroy: vi.fn(),
			currentFrame: 0,
			loop: true,
		}),
	},
}));

const send = vi.fn();
const listeners = new Map<string, Set<(...args: unknown[]) => void>>();

function hydratePreferences(
	overrides: Partial<RendererPreferences> = {},
): void {
	const channelListeners = listeners.get(IPC_CHANNELS.loadPreferences);
	expect(channelListeners?.size).toBeGreaterThan(0);
	act(() => {
		for (const listener of channelListeners ?? []) {
			listener({
				...toRendererPreferences(DEFAULT_PREFERENCES),
				...overrides,
			});
		}
	});
}

beforeEach(() => {
	listeners.clear();
	send.mockClear();
	Object.defineProperty(window, "ipcRenderer", {
		configurable: true,
		value: {
			send,
			invoke: vi.fn(async (channel: string) => {
				if (channel === IPC_CHANNELS.getReleaseNotes) {
					return {
						status: "ok",
						releases: [
							{
								tagName: "v2.1.0",
								name: "BlinkGuard 2.1.0",
								body: "## Added\n- Goals",
								publishedAt: "2026-08-09T12:00:00Z",
								htmlUrl:
									"https://github.com/xpogx-org/BlinkGuard/releases/tag/v2.1.0",
								prerelease: false,
							},
						],
					};
				}
				if (channel === IPC_CHANNELS.listPauseAppCandidates) {
					return { lastFocused: null, running: [] };
				}
				if (channel === IPC_CHANNELS.listCameraDevices) {
					return { devices: [] };
				}
				if (channel === IPC_CHANNELS.listSettingsProfiles) {
					return {
						ok: true,
						profiles: [],
						activeProfileId: null,
						dirty: false,
					};
				}
				return { status: "error", message: "unexpected" };
			}),
			on: vi.fn((channel: string, listener: (...args: unknown[]) => void) => {
				const set = listeners.get(channel) ?? new Set();
				set.add(listener);
				listeners.set(channel, set);
			}),
			off: vi.fn((channel: string, listener: (...args: unknown[]) => void) => {
				listeners.get(channel)?.delete(listener);
			}),
		},
	});
});

describe("settings shell", () => {
	it("renders the main settings controls", async () => {
		render(<App />);

		expect(screen.getByRole("heading", { name: "BlinkGuard" })).toBeDefined();
		expect(screen.getByRole("button", { name: "Start" })).toBeDefined();

		fireEvent.click(screen.getByRole("button", { name: "Settings" }));
		expect(screen.getByText("Keyboard shortcuts")).toBeDefined();
		expect(screen.queryByText("Backup")).toBeNull();
		expect(screen.queryByText("Quiet hours")).toBeNull();
		fireEvent.click(screen.getByRole("tab", { name: "Data" }));
		expect(screen.getByText("Setups")).toBeDefined();
		expect(screen.getByText("Backup")).toBeDefined();
		expect(screen.getByText("Danger Zone")).toBeDefined();
		expect(screen.queryByText("Keyboard shortcuts")).toBeNull();

		fireEvent.click(screen.getByRole("button", { name: "Reminders" }));
		expect(screen.getByText("Reminder Interval")).toBeDefined();
		expect(screen.queryByText("Quiet hours")).toBeNull();
		fireEvent.click(screen.getByRole("tab", { name: "Pause" }));
		expect(screen.getByText("Quiet hours")).toBeDefined();
		expect(screen.getByText("Pause while fullscreen")).toBeDefined();

		fireEvent.click(screen.getByRole("button", { name: "Progress" }));
		expect(screen.getByText("Blink chart")).toBeDefined();
		expect(screen.getAllByText("Goals").length).toBeGreaterThanOrEqual(1);
		expect(
			screen.getByRole("button", { name: "Clear statistics" }),
		).toBeDefined();
		expect(send).toHaveBeenCalledWith(IPC_CHANNELS.subscribeBlinkStats);

		fireEvent.click(screen.getByRole("tab", { name: "Achievements" }));
		expect(screen.getByText("First blink")).toBeDefined();
		expect(screen.getByText("Calibrated")).toBeDefined();

		const startGroup = screen.getByRole("button", {
			name: "Start, 0 of 3 unlocked",
		});
		expect(startGroup.getAttribute("aria-expanded")).toBe("true");
		fireEvent.click(startGroup);
		expect(startGroup.getAttribute("aria-expanded")).toBe("false");
		expect(screen.getByText("Calibrated")).toBeDefined();
		fireEvent.click(startGroup);
		expect(startGroup.getAttribute("aria-expanded")).toBe("true");
		expect(screen.getByText("First blink")).toBeDefined();

		fireEvent.click(screen.getByRole("button", { name: "About" }));
		expect(screen.getByText("What it is")).toBeDefined();
		expect(screen.getByText("Open source")).toBeDefined();
		expect(screen.getByText(`Version ${version}`)).toBeDefined();
		fireEvent.click(screen.getByRole("button", { name: "View on GitHub" }));
		expect(send).toHaveBeenCalledWith(IPC_CHANNELS.openGithubRepo);
		fireEvent.click(screen.getByRole("button", { name: "Check for updates" }));
		expect(send).toHaveBeenCalledWith(IPC_CHANNELS.checkForUpdates);

		fireEvent.click(screen.getByRole("tab", { name: "Notes" }));
		expect(await screen.findByText("BlinkGuard 2.1.0")).toBeDefined();
		expect(screen.getByText("Goals")).toBeDefined();
		fireEvent.click(screen.getByRole("button", { name: "View on GitHub" }));
		expect(send).toHaveBeenCalledWith(IPC_CHANNELS.openGithubReleases);
		fireEvent.click(screen.getByRole("tab", { name: "Overview" }));
		expect(screen.getByText("What it is")).toBeDefined();
		fireEvent.click(screen.getByRole("tab", { name: "Thanks" }));
		expect(screen.getByText("Dmytro Gorobets")).toBeDefined();
		expect(screen.queryByText("What it is")).toBeNull();

		fireEvent.click(screen.getByRole("button", { name: "Reminders" }));
		expect(send).toHaveBeenCalledWith(IPC_CHANNELS.unsubscribeBlinkStats);
	});

	it("resets content scroll when switching sections and progress tabs", () => {
		render(<App />);

		const remindersScroller = document.querySelector(
			"main .overflow-y-auto",
		) as HTMLElement;
		expect(remindersScroller).toBeInstanceOf(HTMLElement);
		remindersScroller.scrollTop = 120;
		const canObserveScroll = remindersScroller.scrollTop === 120;

		fireEvent.click(screen.getByRole("tab", { name: "Pause" }));
		expect(screen.getByText("Quiet hours")).toBeDefined();
		const pauseScroller = document.querySelector(
			"main .overflow-y-auto",
		) as HTMLElement;
		expect(pauseScroller).toBeInstanceOf(HTMLElement);
		expect(pauseScroller).not.toBe(remindersScroller);
		if (canObserveScroll) {
			expect(pauseScroller.scrollTop).toBe(0);
		}

		fireEvent.click(screen.getByRole("button", { name: "Camera" }));
		expect(screen.getByRole("tab", { name: "Setup" })).toBeDefined();
		expect(screen.getByText("Camera Detection")).toBeDefined();
		expect(screen.getByText("Camera Quality")).toBeDefined();
		expect(screen.queryByText("MGD Mode")).toBeNull();

		const cameraScroller = document.querySelector(
			"main .overflow-y-auto",
		) as HTMLElement;
		expect(cameraScroller).toBeInstanceOf(HTMLElement);
		expect(cameraScroller).not.toBe(remindersScroller);
		if (canObserveScroll) {
			expect(cameraScroller.scrollTop).toBe(0);
		}
		cameraScroller.scrollTop = 80;
		const canObserveCameraScroll = cameraScroller.scrollTop === 80;

		fireEvent.click(screen.getByRole("tab", { name: "Tuning" }));
		expect(screen.getByText("Calibration")).toBeDefined();
		expect(screen.getByText("MGD Mode")).toBeDefined();
		expect(screen.queryByText("Camera Detection")).toBeNull();

		const tuningScroller = document.querySelector(
			"main .overflow-y-auto",
		) as HTMLElement;
		expect(tuningScroller).toBeInstanceOf(HTMLElement);
		expect(tuningScroller).not.toBe(cameraScroller);
		if (canObserveCameraScroll) {
			expect(tuningScroller.scrollTop).toBe(0);
		}

		fireEvent.click(screen.getByRole("button", { name: "Progress" }));
		const statsScroller = document.querySelector(
			"main .overflow-y-auto",
		) as HTMLElement;
		expect(statsScroller).toBeInstanceOf(HTMLElement);
		statsScroller.scrollTop = 80;
		const canObserveProgressScroll = statsScroller.scrollTop === 80;

		fireEvent.click(screen.getByRole("tab", { name: "Profile" }));
		const profileScroller = document.querySelector(
			"main .overflow-y-auto",
		) as HTMLElement;
		expect(profileScroller).toBeInstanceOf(HTMLElement);
		expect(profileScroller).not.toBe(statsScroller);
		if (canObserveProgressScroll) {
			expect(profileScroller.scrollTop).toBe(0);
		}
	});

	it("disables fullscreen pause toggle when detection is unsupported", () => {
		render(<App />);
		hydratePreferences({ hasCompletedOnboarding: true });
		fireEvent.click(screen.getByRole("button", { name: "Reminders" }));
		fireEvent.click(screen.getByRole("tab", { name: "Pause" }));

		const toggle = screen.getByRole("switch", {
			name: "Toggle pause while fullscreen",
		});
		expect(toggle.hasAttribute("disabled")).toBe(false);

		act(() => {
			for (const listener of listeners.get(IPC_CHANNELS.focusPauseState) ??
				[]) {
				listener({
					reason: null,
					fullscreenDetectionSupported: false,
				});
			}
		});

		expect(
			screen.getByText("Fullscreen pause is available on Windows and macOS."),
		).toBeDefined();
		expect(toggle.hasAttribute("disabled")).toBe(true);
	});

	it("shows first-run onboarding after prefs hydrate incomplete", () => {
		render(<App />);
		expect(screen.queryByRole("dialog")).toBeNull();

		hydratePreferences({ hasCompletedOnboarding: false });

		expect(screen.getByRole("dialog")).toBeDefined();
		expect(screen.getByText("Welcome to BlinkGuard")).toBeDefined();
		expect(screen.getByRole("heading", { name: "Language" })).toBeDefined();
	});

	it("hides onboarding when prefs hydrate as completed", () => {
		render(<App />);
		hydratePreferences({ hasCompletedOnboarding: true });

		expect(screen.queryByRole("dialog")).toBeNull();
		expect(screen.queryByText("Welcome to BlinkGuard")).toBeNull();
	});

	it("dismisses onboarding when Skip is pressed", () => {
		render(<App />);
		hydratePreferences({ hasCompletedOnboarding: false });

		fireEvent.click(screen.getByRole("button", { name: "Skip" }));

		expect(screen.queryByRole("dialog")).toBeNull();
		expect(send).toHaveBeenCalledWith(
			IPC_CHANNELS.updateHasCompletedOnboarding,
			true,
		);
	});

	it("dismisses onboarding when Finish is pressed", () => {
		render(<App />);
		hydratePreferences({ hasCompletedOnboarding: false });

		fireEvent.click(screen.getByRole("button", { name: "Next" }));
		fireEvent.click(screen.getByRole("button", { name: "Next" }));
		fireEvent.click(screen.getByRole("button", { name: "Next" }));
		fireEvent.click(screen.getByRole("button", { name: "Next" }));
		fireEvent.click(screen.getByRole("button", { name: "Finish" }));

		expect(screen.queryByRole("dialog")).toBeNull();
		expect(send).toHaveBeenCalledWith(
			IPC_CHANNELS.updateHasCompletedOnboarding,
			true,
		);
	});

	it("renders eye-care controls for exercises and look-away", () => {
		render(<App />);

		fireEvent.click(screen.getByRole("button", { name: "Eye care" }));
		expect(screen.getByText("Eye Exercises")).toBeDefined();
		expect(screen.getByText("20-20-20 Look Away")).toBeDefined();
		expect(screen.queryByText("Eye strain risk")).toBeNull();
	});

	it("warns about eye strain when all eye-care prompts are disabled", () => {
		render(<App />);

		fireEvent.click(screen.getByRole("button", { name: "Eye care" }));
		fireEvent.click(
			screen.getByRole("switch", { name: "Toggle eye exercises" }),
		);
		fireEvent.click(
			screen.getByRole("switch", { name: "Toggle look-away breaks" }),
		);

		expect(screen.getByText("Eye strain risk")).toBeDefined();
		expect(screen.getByText(/both turned off/i)).toBeDefined();
	});

	it("starts reminders with the renderer interval converted to milliseconds", () => {
		render(<App />);

		fireEvent.click(screen.getByRole("button", { name: "Start" }));

		expect(send).toHaveBeenCalledWith(IPC_CHANNELS.startBlinkReminders, 3000);
	});

	it("toggles tracking from the sidebar eye button", () => {
		render(<App />);

		fireEvent.click(screen.getByRole("button", { name: "Start reminders" }));
		expect(send).toHaveBeenCalledWith(IPC_CHANNELS.startBlinkReminders, 3000);

		fireEvent.click(screen.getByRole("button", { name: "Stop reminders" }));
		expect(send).toHaveBeenCalledWith(IPC_CHANNELS.stopBlinkReminders);
	});

	it("records and sends a keyboard shortcut", () => {
		render(<App />);

		fireEvent.click(screen.getByRole("button", { name: "Settings" }));
		fireEvent.click(screen.getAllByRole("button", { name: "Change" })[0]);
		fireEvent.keyDown(window, { key: "k", ctrlKey: true });
		fireEvent.keyDown(window, { key: "Enter" });

		expect(send).toHaveBeenCalledWith(IPC_CHANNELS.updateKeyboardShortcuts, {
			trackingToggle: "Ctrl+K",
			snoozeAll: "",
			openSettings: "",
			openCameraPreview: "",
		});
	});

	it("switches language and updates React UI immediately", () => {
		render(<App />);
		hydratePreferences({ hasCompletedOnboarding: true, locale: "en" });

		fireEvent.click(screen.getByRole("button", { name: "Settings" }));
		fireEvent.click(screen.getByRole("combobox", { name: "Select language" }));
		fireEvent.click(screen.getByRole("option", { name: "Українська" }));

		expect(screen.getByRole("button", { name: "Налаштування" })).toBeDefined();
		expect(screen.getByText("Мова")).toBeDefined();
		expect(send).toHaveBeenCalledWith(IPC_CHANNELS.updateLocale, "uk");
	});

	it("toggles dark mode without re-pushing locale or looping on prefs echo", () => {
		render(<App />);
		hydratePreferences({ hasCompletedOnboarding: true, darkMode: true });
		send.mockClear();

		fireEvent.click(
			screen.getAllByRole("button", { name: "Toggle dark mode" })[0],
		);

		expect(send).toHaveBeenCalledWith(IPC_CHANNELS.updateDarkMode, false);
		expect(
			send.mock.calls.filter(
				([channel]) => channel === IPC_CHANNELS.updateDarkMode,
			),
		).toHaveLength(1);
		expect(send).not.toHaveBeenCalledWith(IPC_CHANNELS.updateLocale, "en");

		send.mockClear();
		// Main used to bounce sendPreferences from updateLocale on every sync.
		hydratePreferences({ hasCompletedOnboarding: true, darkMode: false });

		expect(send).not.toHaveBeenCalledWith(IPC_CHANNELS.updateDarkMode, false);
		expect(send).not.toHaveBeenCalledWith(IPC_CHANNELS.updateLocale, "en");
	});

	it("does not echo-write prefs on hydrate", async () => {
		render(<App />);
		send.mockClear();
		hydratePreferences({ hasCompletedOnboarding: true });
		await act(async () => {});

		expect(send).toHaveBeenCalledWith(IPC_CHANNELS.shellReady);
		expect(
			send.mock.calls.filter(
				([channel]) => channel !== IPC_CHANNELS.shellReady,
			),
		).toHaveLength(0);
	});

	it("pushes only the changed field for common interactive toggles", () => {
		render(<App />);
		hydratePreferences({
			hasCompletedOnboarding: true,
			cameraEnabled: true,
		});

		fireEvent.click(screen.getByRole("button", { name: "Appearance" }));
		send.mockClear();
		fireEvent.click(
			screen.getByRole("switch", { name: "Toggle notification sound" }),
		);
		expect(send).toHaveBeenCalledWith(IPC_CHANNELS.updateSoundEnabled, true);
		expect(send).not.toHaveBeenCalledWith(IPC_CHANNELS.updateLocale, "en");
		expect(send).not.toHaveBeenCalledWith(IPC_CHANNELS.updateDarkMode, true);

		fireEvent.click(screen.getByRole("button", { name: "Settings" }));
		send.mockClear();
		fireEvent.click(
			screen.getByRole("switch", { name: "Toggle launch at login" }),
		);
		expect(send).toHaveBeenCalledWith(IPC_CHANNELS.updateLaunchAtLogin, true);
		expect(send).not.toHaveBeenCalledWith(
			IPC_CHANNELS.updateSoundEnabled,
			true,
		);

		fireEvent.click(screen.getByRole("button", { name: "Reminders" }));
		send.mockClear();
		fireEvent.click(screen.getByRole("tab", { name: "Pause" }));
		fireEvent.click(screen.getByRole("switch", { name: "Toggle quiet hours" }));
		expect(send).toHaveBeenCalledWith(
			IPC_CHANNELS.updateQuietHoursEnabled,
			false,
		);
		expect(send).not.toHaveBeenCalledWith(IPC_CHANNELS.updateLocale, "en");

		fireEvent.click(screen.getByRole("button", { name: "Eye care" }));
		send.mockClear();
		fireEvent.click(
			screen.getByRole("switch", { name: "Toggle eye exercises" }),
		);
		expect(send).toHaveBeenCalledWith(
			IPC_CHANNELS.updateEyeExercisesEnabled,
			false,
		);
		expect(send).not.toHaveBeenCalledWith(IPC_CHANNELS.updateLocale, "en");

		send.mockClear();
		fireEvent.click(
			screen.getByRole("switch", { name: "Toggle look-away breaks" }),
		);
		expect(send).toHaveBeenCalledWith(
			IPC_CHANNELS.updateLookAwayEnabled,
			false,
		);
		expect(send).not.toHaveBeenCalledWith(
			IPC_CHANNELS.updateEyeExercisesEnabled,
			false,
		);

		fireEvent.click(screen.getByRole("button", { name: "Camera" }));
		fireEvent.click(screen.getByRole("tab", { name: "Tuning" }));
		send.mockClear();
		fireEvent.click(
			screen.getByRole("switch", { name: "Toggle low-rate prompt boost" }),
		);
		expect(send).toHaveBeenCalledWith(
			IPC_CHANNELS.updateBlinkRateCoachingEnabled,
			false,
		);
		expect(send).not.toHaveBeenCalledWith(IPC_CHANNELS.updateLocale, "en");

		send.mockClear();
		fireEvent.click(
			screen.getByRole("switch", {
				name: "Toggle calibration reminders",
			}),
		);
		expect(send).toHaveBeenCalledWith(
			IPC_CHANNELS.updateCalibrationNudgeEnabled,
			false,
		);
		expect(send).not.toHaveBeenCalledWith(IPC_CHANNELS.updateLocale, "en");
	});

	it("ignores identical preference echoes after interactive changes", () => {
		render(<App />);
		hydratePreferences({ hasCompletedOnboarding: true, soundEnabled: false });

		fireEvent.click(screen.getByRole("button", { name: "Appearance" }));
		fireEvent.click(
			screen.getByRole("switch", { name: "Toggle notification sound" }),
		);
		send.mockClear();

		hydratePreferences({
			hasCompletedOnboarding: true,
			soundEnabled: true,
		});

		expect(send).not.toHaveBeenCalled();
	});

	it("pushes notificationStyle from Appearance without hiding click-through", () => {
		render(<App />);
		hydratePreferences({ hasCompletedOnboarding: true });

		fireEvent.click(screen.getByRole("button", { name: "Appearance" }));
		expect(
			screen.getByRole("switch", {
				name: "Pass clicks through reminder popups",
			}),
		).toBeTruthy();

		send.mockClear();
		fireEvent.click(
			screen.getByRole("combobox", {
				name: "How blink, exercise, and look-away prompts appear",
			}),
		);
		fireEvent.click(screen.getByRole("option", { name: /System banner/ }));

		expect(send).toHaveBeenCalledWith(
			IPC_CHANNELS.updateNotificationStyle,
			"native",
		);
		expect(send).not.toHaveBeenCalledWith(IPC_CHANNELS.updateLocale, "en");
		expect(
			screen.getByRole("switch", {
				name: "Pass clicks through reminder popups",
			}),
		).toBeTruthy();
	});

	it("pushes blinkPromptProfile from Reminders Schedule", () => {
		render(<App />);
		hydratePreferences({ hasCompletedOnboarding: true });

		fireEvent.click(screen.getByRole("button", { name: "Reminders" }));
		send.mockClear();
		fireEvent.click(
			screen.getByRole("combobox", {
				name: "Blink cue intensity profile",
			}),
		);
		fireEvent.click(screen.getByRole("option", { name: /^Gentle/ }));

		expect(send).toHaveBeenCalledWith(
			IPC_CHANNELS.updateBlinkPromptProfile,
			"gentle",
		);
		expect(send).not.toHaveBeenCalledWith(IPC_CHANNELS.updateLocale, "en");
	});

	it("pushes microBreakInterval in ms when camera is off", () => {
		render(<App />);
		hydratePreferences({
			hasCompletedOnboarding: true,
			cameraEnabled: false,
			microBreakInterval: 30,
		});

		fireEvent.click(screen.getByRole("button", { name: "Reminders" }));
		send.mockClear();
		fireEvent.change(screen.getByLabelText("Reminder interval"), {
			target: { value: "45" },
		});

		expect(send).toHaveBeenCalledWith(
			IPC_CHANNELS.updateMicroBreakInterval,
			45_000,
		);
		expect(send).not.toHaveBeenCalledWith(IPC_CHANNELS.updateInterval, 45_000);
		expect(send).not.toHaveBeenCalledWith(IPC_CHANNELS.updateLocale, "en");
	});

	it("pushes reminderInterval in ms when camera is on", () => {
		render(<App />);
		hydratePreferences({
			hasCompletedOnboarding: true,
			cameraEnabled: true,
			reminderInterval: 3,
		});

		fireEvent.click(screen.getByRole("button", { name: "Reminders" }));
		send.mockClear();
		fireEvent.change(screen.getByLabelText("Reminder interval"), {
			target: { value: "5" },
		});

		expect(send).toHaveBeenCalledWith(IPC_CHANNELS.updateInterval, 5_000);
		expect(send).not.toHaveBeenCalledWith(
			IPC_CHANNELS.updateMicroBreakInterval,
			5_000,
		);
		expect(send).not.toHaveBeenCalledWith(IPC_CHANNELS.updateLocale, "en");
	});
});
