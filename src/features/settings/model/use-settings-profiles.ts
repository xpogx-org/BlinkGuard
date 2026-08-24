import { useCallback, useEffect, useState } from "react";
import { rendererIpc } from "@/shared/ipc/renderer-ipc";
import type {
	SettingsProfileSummary,
	SettingsProfilesResult,
} from "../../../../shared/settings-profiles";

export type SettingsProfilesView = {
	profiles: SettingsProfileSummary[];
	activeProfileId: string | null;
	dirty: boolean;
};

const EMPTY: SettingsProfilesView = {
	profiles: [],
	activeProfileId: null,
	dirty: false,
};

function fromResult(
	result: SettingsProfilesResult,
): SettingsProfilesView | null {
	if (!result.ok) return null;
	return {
		profiles: result.profiles,
		activeProfileId: result.activeProfileId,
		dirty: result.dirty,
	};
}

export function useSettingsProfiles(enabled: boolean) {
	const [view, setView] = useState<SettingsProfilesView>(EMPTY);
	const [errorCode, setErrorCode] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	const refresh = useCallback(async () => {
		const result = await rendererIpc.listSettingsProfiles();
		const next = fromResult(result);
		if (next) {
			setView(next);
			setErrorCode(null);
		} else if (!result.ok) {
			setErrorCode(result.code);
		}
		return result;
	}, []);

	useEffect(() => {
		if (!enabled) return;
		void refresh();
	}, [enabled, refresh]);

	useEffect(() => {
		if (!enabled) return;
		return rendererIpc.onPreferences(() => {
			void refresh();
		});
	}, [enabled, refresh]);

	const run = useCallback(
		async (
			action: () => Promise<SettingsProfilesResult>,
		): Promise<SettingsProfilesResult> => {
			if (busy) {
				return { ok: false, code: "error" };
			}
			setBusy(true);
			setErrorCode(null);
			try {
				const result = await action();
				const next = fromResult(result);
				if (next) {
					setView(next);
					setErrorCode(null);
				} else if (!result.ok) {
					// Dirty is handled as an inline confirm in the panel — not a banner.
					if (result.code !== "dirty") {
						setErrorCode(result.code);
					}
				}
				return result;
			} finally {
				setBusy(false);
			}
		},
		[busy],
	);

	return {
		...view,
		errorCode,
		busy,
		refresh,
		save: (name: string, replaceId?: string) =>
			run(() => rendererIpc.saveSettingsProfile({ name, replaceId })),
		rename: (id: string, name: string) =>
			run(() => rendererIpc.renameSettingsProfile({ id, name })),
		remove: (id: string) =>
			run(() => rendererIpc.deleteSettingsProfile({ id })),
		switchTo: (id: string, confirmDirty?: boolean) =>
			run(() => rendererIpc.switchSettingsProfile({ id, confirmDirty })),
		clearError: () => setErrorCode(null),
	};
}
