import { Zap } from "lucide-react";
import { Button } from "@/components/button";
import { Reveal } from "@/components/reveal";
import { SettingPanel } from "@/components/setting-panel";
import { SettingRow } from "@/components/setting-row";
import { useT } from "@/i18n";
import type { ShortcutAction } from "../../../../shared/preferences";
import { SHORTCUT_ACTIONS } from "../../../../shared/preferences";

interface ShortcutSettingsProps {
	shortcuts: Record<ShortcutAction, string>;
	activeAction: ShortcutAction | null;
	temporaryShortcut: string;
	errorMessage: (action: ShortcutAction) => string;
	onStartRecording: (action: ShortcutAction) => void;
	onSave: () => void;
	onCancel: () => void;
	onClear: (action: ShortcutAction) => void;
	/** Subset of actions to show; defaults to all. */
	actions?: readonly ShortcutAction[];
	/** Optional note under the list (e.g. onboarding → Settings). */
	footerNote?: string;
}

const ACTION_TITLE: Record<ShortcutAction, string> = {
	trackingToggle: "shortcut.action.trackingToggle",
	snoozeAll: "shortcut.action.snoozeAll",
	snoozeWithToken: "shortcut.action.snoozeWithToken",
	openSettings: "shortcut.action.openSettings",
	openCameraPreview: "shortcut.action.openCameraPreview",
};

const ACTION_DESC: Record<ShortcutAction, string> = {
	trackingToggle: "shortcut.action.trackingToggleDesc",
	snoozeAll: "shortcut.action.snoozeAllDesc",
	snoozeWithToken: "shortcut.action.snoozeWithTokenDesc",
	openSettings: "shortcut.action.openSettingsDesc",
	openCameraPreview: "shortcut.action.openCameraPreviewDesc",
};

export function ShortcutSettings({
	shortcuts,
	activeAction,
	temporaryShortcut,
	errorMessage,
	onStartRecording,
	onSave,
	onCancel,
	onClear,
	actions = SHORTCUT_ACTIONS,
	footerNote,
}: ShortcutSettingsProps) {
	const t = useT();
	const singleAction = actions.length === 1;
	return (
		<SettingPanel>
			<SettingRow
				title={
					<>
						<Zap className="h-4 w-4 text-muted-foreground" aria-hidden />
						{singleAction ? t(ACTION_TITLE[actions[0]]) : t("shortcut.title")}
					</>
				}
				description={
					singleAction ? t(ACTION_DESC[actions[0]]) : t("shortcut.description")
				}
			>
				<div className="space-y-4">
					{actions.map((action) => {
						const isRecording = activeAction === action;
						const bound = shortcuts[action];
						const error = errorMessage(action);
						return (
							<div key={action} className="space-y-2">
								{singleAction ? null : (
									<div>
										<p className="text-sm font-medium">
											{t(ACTION_TITLE[action])}
										</p>
										<p className="text-xs text-muted-foreground">
											{t(ACTION_DESC[action])}
										</p>
									</div>
								)}
								<div className="flex flex-wrap items-center gap-2">
									<div
										role="status"
										aria-label={t("shortcut.currentAria", {
											action: t(ACTION_TITLE[action]),
										})}
										className="min-w-[8rem] flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
									>
										{isRecording ? (
											<span className="text-primary">
												{temporaryShortcut || t("shortcut.pressKeys")}
											</span>
										) : bound ? (
											bound
										) : (
											<span className="text-muted-foreground">
												{t("shortcut.unbound")}
											</span>
										)}
									</div>
									{isRecording ? (
										<div className="flex flex-wrap gap-2">
											<Button
												type="button"
												variant="secondary"
												onClick={onCancel}
											>
												{t("common.cancel")}
											</Button>
											<Button type="button" onClick={onSave}>
												{t("common.save")}
											</Button>
										</div>
									) : (
										<div className="flex flex-wrap gap-2">
											<Button
												type="button"
												onClick={() => onStartRecording(action)}
											>
												{t("common.change")}
											</Button>
											{bound ? (
												<Button
													type="button"
													variant="secondary"
													onClick={() => onClear(action)}
												>
													{t("shortcut.clear")}
												</Button>
											) : null}
										</div>
									)}
								</div>
								<Reveal variant="fade" open={Boolean(error)}>
									{error ? (
										<p className="select-text text-sm text-destructive">
											{error}
										</p>
									) : null}
								</Reveal>
							</div>
						);
					})}
					<Reveal variant="fade" open={Boolean(footerNote)}>
						{footerNote ? (
							<p className="rounded-md bg-accent/60 px-3 py-2 text-xs text-muted-foreground sm:text-sm">
								{footerNote}
							</p>
						) : null}
					</Reveal>
				</div>
			</SettingRow>
		</SettingPanel>
	);
}
