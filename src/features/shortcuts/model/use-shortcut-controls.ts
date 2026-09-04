import { useCallback, useEffect, useState } from "react";
import type { SettingsPreferences } from "@/features/settings/model/preferences";
import type { SetPreferences } from "@/features/settings/model/use-preferences";
import { rendererIpc } from "@/shared/ipc/renderer-ipc";
import { t } from "../../../../shared/i18n";
import {
	type KeyboardShortcuts,
	SHORTCUT_ACTIONS,
	type ShortcutAction,
} from "../../../../shared/preferences";

interface ShortcutControlsInput {
	preferences: SettingsPreferences;
	setPreferences: SetPreferences;
	toggleTracking: () => void;
}

function pressedAccelerator(event: KeyboardEvent): string {
	const keys: string[] = [];
	if (event.ctrlKey) keys.push("Ctrl");
	if (event.shiftKey) keys.push("Shift");
	if (event.altKey) keys.push("Alt");
	if (event.metaKey) keys.push("Meta");
	if (
		!["Control", "Shift", "Alt", "Meta", "Enter", "Escape"].includes(event.key)
	) {
		keys.push(event.key.toUpperCase());
	}
	return keys.join("+");
}

export function useShortcutControls({
	preferences,
	setPreferences,
	toggleTracking,
}: ShortcutControlsInput) {
	const [activeAction, setActiveAction] = useState<ShortcutAction | null>(null);
	const [temporaryShortcut, setTemporaryShortcut] = useState("");
	const [errors, setErrors] = useState<Partial<Record<ShortcutAction, string>>>(
		{},
	);
	const [conflictActions, setConflictActions] = useState<ShortcutAction[]>([]);
	const locale = preferences.locale;

	useEffect(
		() =>
			rendererIpc.onShortcutError((payload) => {
				if (!payload || typeof payload !== "object") {
					setErrors({});
					setConflictActions([]);
					return;
				}
				const nextErrors = payload.errors ?? {};
				const nextConflicts = Array.isArray(payload.conflicts)
					? payload.conflicts
					: [];
				setErrors(nextErrors);
				setConflictActions(nextConflicts);
				const failed = SHORTCUT_ACTIONS.find((action) => nextErrors[action]);
				if (failed) {
					setActiveAction(failed);
					setTemporaryShortcut(nextErrors[failed] ?? "");
				}
			}),
		[],
	);

	// Suspend Electron globalShortcut while capturing so existing chords do not fire.
	useEffect(() => {
		if (!activeAction) return;
		rendererIpc.setShortcutCaptureMode(true);
		return () => {
			rendererIpc.setShortcutCaptureMode(false);
		};
	}, [activeAction]);

	const persist = useCallback(
		(next: KeyboardShortcuts) => {
			setPreferences((current) => ({
				...current,
				keyboardShortcuts: next,
			}));
			rendererIpc.updateKeyboardShortcuts(next);
		},
		[setPreferences],
	);

	const save = useCallback(() => {
		if (!activeAction) return;
		const value = temporaryShortcut.trim();
		if (value) {
			if ([...value].some((character) => character.charCodeAt(0) > 127)) {
				setErrors((current) => ({
					...current,
					[activeAction]: t(locale, "shortcut.asciiOnly"),
				}));
				return;
			}
			if (value.split("+").length < 2) {
				setErrors((current) => ({
					...current,
					[activeAction]: t(locale, "shortcut.needModifier"),
				}));
				return;
			}
			const takenBy = SHORTCUT_ACTIONS.find(
				(action) =>
					action !== activeAction &&
					preferences.keyboardShortcuts[action] === value,
			);
			if (takenBy) {
				setErrors((current) => ({
					...current,
					[activeAction]: value,
				}));
				setConflictActions([activeAction, takenBy]);
				return;
			}
		}
		const next: KeyboardShortcuts = {
			...preferences.keyboardShortcuts,
			[activeAction]: value,
		};
		persist(next);
		setActiveAction(null);
		setTemporaryShortcut("");
		setErrors((current) => {
			const copy = { ...current };
			delete copy[activeAction];
			return copy;
		});
		setConflictActions((current) =>
			current.filter((action) => action !== activeAction),
		);
	}, [
		activeAction,
		locale,
		persist,
		preferences.keyboardShortcuts,
		temporaryShortcut,
	]);

	const clear = useCallback(
		(action: ShortcutAction) => {
			const next: KeyboardShortcuts = {
				...preferences.keyboardShortcuts,
				[action]: "",
			};
			persist(next);
			if (activeAction === action) {
				setActiveAction(null);
				setTemporaryShortcut("");
			}
			setErrors((current) => {
				const copy = { ...current };
				delete copy[action];
				return copy;
			});
			setConflictActions((current) =>
				current.filter((item) => item !== action),
			);
		},
		[activeAction, persist, preferences.keyboardShortcuts],
	);

	const cancel = useCallback(() => {
		setActiveAction(null);
		setTemporaryShortcut("");
	}, []);

	const startRecording = useCallback(
		(action: ShortcutAction) => {
			setActiveAction(action);
			setTemporaryShortcut(preferences.keyboardShortcuts[action]);
			setErrors((current) => {
				const copy = { ...current };
				delete copy[action];
				return copy;
			});
			setConflictActions((current) =>
				current.filter((item) => item !== action),
			);
		},
		[preferences.keyboardShortcuts],
	);

	const runBoundAction = useCallback(
		(action: ShortcutAction) => {
			switch (action) {
				case "trackingToggle":
					toggleTracking();
					return;
				case "snoozeAll":
					rendererIpc.snoozeAll();
					return;
				case "snoozeWithToken":
					rendererIpc.snoozeAll({ useToken: true });
					return;
				case "openSettings":
					// Already in settings shell; no-op.
					return;
				case "openCameraPreview":
					rendererIpc.showCameraWindow();
					return;
			}
		},
		[toggleTracking],
	);

	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent) => {
			if (activeAction) {
				event.preventDefault();
				event.stopPropagation();
				if (event.key === "Enter") {
					save();
					return;
				}
				if (event.key === "Escape") {
					cancel();
					return;
				}
				const accel = pressedAccelerator(event);
				if (accel.length > 0) {
					setTemporaryShortcut(accel);
					const takenBy = SHORTCUT_ACTIONS.find(
						(action) =>
							action !== activeAction &&
							preferences.keyboardShortcuts[action] === accel,
					);
					if (takenBy) {
						setErrors((current) => ({
							...current,
							[activeAction]: accel,
						}));
						setConflictActions([activeAction, takenBy]);
					} else {
						setErrors((current) => {
							const copy = { ...current };
							delete copy[activeAction];
							return copy;
						});
						setConflictActions((current) =>
							current.filter((item) => item !== activeAction),
						);
					}
				}
				return;
			}

			const pressed = pressedAccelerator(event);
			if (!pressed.includes("+")) return;
			const matched = SHORTCUT_ACTIONS.find(
				(action) => preferences.keyboardShortcuts[action] === pressed,
			);
			if (!matched) return;
			event.preventDefault();
			runBoundAction(matched);
		};

		window.addEventListener("keydown", handleKeyDown, true);
		return () => window.removeEventListener("keydown", handleKeyDown, true);
	}, [
		activeAction,
		cancel,
		preferences.keyboardShortcuts,
		runBoundAction,
		save,
	]);

	const errorMessage = (action: ShortcutAction): string => {
		const raw = errors[action];
		if (!raw) return "";
		if (raw === t(locale, "shortcut.asciiOnly")) return raw;
		if (raw === t(locale, "shortcut.needModifier")) return raw;
		if (conflictActions.includes(action)) {
			return t(locale, "shortcut.conflict", { shortcut: raw });
		}
		return t(locale, "shortcut.invalid", { shortcut: raw });
	};

	return {
		actions: SHORTCUT_ACTIONS,
		activeAction,
		temporaryShortcut,
		startRecording,
		save,
		cancel,
		clear,
		errorMessage,
	};
}
