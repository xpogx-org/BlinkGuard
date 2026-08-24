import { Button } from "@/components/button";
import { SettingPanel } from "@/components/setting-panel";
import { SettingRow } from "@/components/setting-row";
import { useT } from "@/i18n";
import { rendererIpc } from "@/shared/ipc/renderer-ipc";
import type {
	DebugOverlayKind,
	DebugSoundKind,
} from "../../../../shared/debug-preview";
import { DebugCleanButton } from "./debug-clean-button";

const OVERLAY_BUTTONS: { kind: DebugOverlayKind; labelKey: string }[] = [
	{ kind: "blink", labelKey: "debug.preview.blink" },
	{ kind: "starting", labelKey: "debug.preview.starting" },
	{ kind: "stopped", labelKey: "debug.preview.stopped" },
	{ kind: "ambient", labelKey: "debug.preview.ambient" },
	{ kind: "noFace", labelKey: "debug.preview.noFace" },
	{ kind: "lookAway", labelKey: "debug.preview.lookAway" },
	{ kind: "exercise", labelKey: "debug.preview.exercise" },
];

const SOUND_BUTTONS: { kind: DebugSoundKind; labelKey: string }[] = [
	{ kind: "blink", labelKey: "debug.sound.blink" },
	{ kind: "exercise", labelKey: "debug.sound.exercise" },
	{ kind: "lookAway", labelKey: "debug.sound.lookAway" },
	{ kind: "starting", labelKey: "debug.sound.starting" },
	{ kind: "stopped", labelKey: "debug.sound.stopped" },
	{ kind: "cheer", labelKey: "debug.sound.cheer" },
];

export function DebugPreviewPanel() {
	const t = useT();

	return (
		<>
			<SettingPanel>
				<SettingRow
					title={t("debug.overlays.title")}
					description={t("debug.overlays.desc")}
					action={<DebugCleanButton />}
				>
					<div className="flex flex-wrap gap-2">
						{OVERLAY_BUTTONS.map(({ kind, labelKey }) => (
							<Button
								key={kind}
								type="button"
								variant="secondary"
								onClick={() => rendererIpc.debugPreviewOverlay(kind)}
							>
								{t(labelKey)}
							</Button>
						))}
					</div>
				</SettingRow>
			</SettingPanel>

			<SettingPanel>
				<SettingRow
					title={t("debug.sounds.title")}
					description={t("debug.sounds.desc")}
					action={<DebugCleanButton />}
				>
					<div className="flex flex-wrap gap-2">
						{SOUND_BUTTONS.map(({ kind, labelKey }) => (
							<Button
								key={kind}
								type="button"
								variant="secondary"
								onClick={() => rendererIpc.debugPreviewSound(kind)}
							>
								{t(labelKey)}
							</Button>
						))}
					</div>
				</SettingRow>
			</SettingPanel>
		</>
	);
}
