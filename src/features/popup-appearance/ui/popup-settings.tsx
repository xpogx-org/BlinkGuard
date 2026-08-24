import { Palette, Settings } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "@/components/button";
import { Reveal } from "@/components/reveal";
import { SettingPanel } from "@/components/setting-panel";
import { SettingRow } from "@/components/setting-row";
import { ToggleSwitch } from "@/components/toggle-switch";
import type { SettingsPreferences } from "@/features/settings/model/preferences";
import type { SetPreferences } from "@/features/settings/model/use-preferences";
import { useT } from "@/i18n";
import { rendererIpc } from "@/shared/ipc/renderer-ipc";

interface PopupSettingsProps {
	preferences: SettingsPreferences;
	setPreferences: SetPreferences;
}

export function PopupSettings({
	preferences,
	setPreferences,
}: PopupSettingsProps) {
	const t = useT();
	const [isEditingMessage, setIsEditingMessage] = useState(false);
	const [temporaryMessage, setTemporaryMessage] = useState("");

	const saveMessage = () => {
		setPreferences((current) => ({
			...current,
			popupMessage: temporaryMessage,
		}));
		setIsEditingMessage(false);
	};

	const updateColor = (key: "background" | "text", value: string) => {
		setPreferences((current) => ({
			...current,
			popupColors: { ...current.popupColors, [key]: value },
		}));
	};

	return (
		<SettingPanel className="space-y-4">
			<SettingRow
				title={
					<>
						<Settings className="h-4 w-4 text-muted-foreground" aria-hidden />
						{t("popup.settings")}
					</>
				}
				description={t("popup.currentSize", {
					width: preferences.popupSize.width,
					height: preferences.popupSize.height,
				})}
				action={
					<button
						type="button"
						onClick={() =>
							setPreferences((current) => ({
								...current,
								showPopupColors: !current.showPopupColors,
							}))
						}
						className="text-xs text-primary hover:underline"
					>
						{preferences.showPopupColors
							? t("common.hide")
							: t("popup.customize")}
					</button>
				}
			>
				<Button
					type="button"
					className="w-full gap-2"
					onClick={rendererIpc.showPopupEditor}
				>
					<Settings className="h-4 w-4" aria-hidden />
					{t("popup.changePosition")}
				</Button>

				<Reveal open={preferences.showPopupColors}>
					<div className="mt-4 space-y-4 border-t border-border pt-4">
						<div className="flex items-center gap-2 text-sm font-medium text-foreground">
							<Palette className="h-4 w-4 text-muted-foreground" aria-hidden />
							{t("popup.appearance")}
						</div>

						<div>
							<label
								htmlFor="popup-message"
								className="mb-1 block text-xs text-muted-foreground"
							>
								{t("popup.message")}
							</label>
							<Reveal open={isEditingMessage}>
								<div className="space-y-2">
									<input
										id="popup-message"
										aria-label={t("popup.messageAria")}
										type="text"
										value={temporaryMessage}
										onChange={(event) =>
											setTemporaryMessage(event.target.value)
										}
										onKeyDown={(event) => {
											if (event.key === "Enter") saveMessage();
											else if (event.key === "Escape")
												setIsEditingMessage(false);
										}}
										className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
										ref={(input) => input?.focus()}
									/>
									<div className="flex items-center gap-2">
										<Button type="button" size="sm" onClick={saveMessage}>
											{t("common.save")}
										</Button>
										<Button
											type="button"
											size="sm"
											variant="secondary"
											onClick={() => setIsEditingMessage(false)}
										>
											{t("common.cancel")}
										</Button>
									</div>
								</div>
							</Reveal>
							<Reveal open={!isEditingMessage}>
								<div className="flex min-w-0 items-center gap-2">
									<p className="min-w-0 flex-1 truncate text-sm text-foreground">
										"{preferences.popupMessage}"
									</p>
									<button
										type="button"
										onClick={() => {
											setTemporaryMessage(preferences.popupMessage);
											setIsEditingMessage(true);
										}}
										className="shrink-0 text-xs text-primary hover:underline"
									>
										{t("common.edit")}
									</button>
								</div>
							</Reveal>
						</div>

						<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
							<ColorSetting
								label={t("popup.background")}
								value={preferences.popupColors.background}
								onChange={(value) => updateColor("background", value)}
							/>
							<ColorSetting
								label={t("popup.textColor")}
								value={preferences.popupColors.text}
								onChange={(value) => updateColor("text", value)}
							/>
						</div>

						<div>
							<label
								htmlFor="window-transparency"
								className="mb-1 block text-xs text-muted-foreground"
							>
								{t("popup.transparency")}
							</label>
							<div className="flex items-center gap-2">
								<input
									id="window-transparency"
									aria-label={t("popup.transparencyAria")}
									type="range"
									min="0"
									max="1"
									step="0.1"
									value={preferences.popupColors.transparency}
									onChange={(event) =>
										setPreferences((current) => ({
											...current,
											popupColors: {
												...current.popupColors,
												transparency: Number.parseFloat(event.target.value),
											},
										}))
									}
									className="h-2 flex-1 cursor-pointer appearance-none rounded-lg bg-muted"
								/>
								<span className="w-12 text-right text-sm text-muted-foreground">
									{Math.round(preferences.popupColors.transparency * 100)}%
								</span>
							</div>
							<p className="mt-2 text-xs text-muted-foreground sm:text-sm">
								{t("popup.transparencyHint")}
							</p>
						</div>
					</div>
				</Reveal>
			</SettingRow>

			<SettingRow
				title={t("popup.clickThrough")}
				description={t("popup.clickThroughDescription")}
				action={
					<ToggleSwitch
						aria-label={t("popup.clickThroughAria")}
						checked={preferences.blinkPopupClickThrough}
						onChange={() =>
							setPreferences((current) => ({
								...current,
								blinkPopupClickThrough: !current.blinkPopupClickThrough,
							}))
						}
					/>
				}
			/>
		</SettingPanel>
	);
}

interface ColorSettingProps {
	label: string;
	value: string;
	onChange: (value: string) => void;
}

function ColorSetting({ label, value, onChange }: ColorSettingProps) {
	const t = useT();
	const inputId = useId();

	return (
		<div>
			<label
				htmlFor={inputId}
				className="mb-1 block text-xs text-muted-foreground"
			>
				{label}
			</label>
			<div className="flex items-center gap-2">
				<input
					aria-label={t("popup.colorPickerAria", { label })}
					type="color"
					value={value}
					onChange={(event) => onChange(event.target.value)}
					className="h-10 w-10 cursor-pointer rounded-md border border-border"
				/>
				<input
					id={inputId}
					aria-label={label}
					type="text"
					value={value}
					onChange={(event) => onChange(event.target.value)}
					className="flex-1 rounded-md border border-input bg-background px-2 py-1.5 text-sm"
					placeholder="#000000"
				/>
			</div>
		</div>
	);
}
