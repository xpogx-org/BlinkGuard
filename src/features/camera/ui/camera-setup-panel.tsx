import { Camera, UserRoundX } from "lucide-react";
import { Badge } from "@/components/badge";
import { Button } from "@/components/button";
import { RangeSlider } from "@/components/range-slider";
import { SettingGrid } from "@/components/setting-grid";
import { SettingPanel } from "@/components/setting-panel";
import { SettingRow } from "@/components/setting-row";
import { ToggleSwitch } from "@/components/toggle-switch";
import type { SettingsPreferences } from "@/features/settings/model/preferences";
import type { SetPreferences } from "@/features/settings/model/use-preferences";
import { useI18n, useT } from "@/i18n";
import { cn } from "@/lib/utils";
import { rendererIpc } from "@/shared/ipc/renderer-ipc";
import {
	type CameraCaptureSurface,
	cameraCaptureChipMessageKey,
} from "../../../../shared/camera-capture-status";
import {
	CAMERA_QUALITY_OPTIONS,
	CAMERA_QUALITY_PRESETS,
} from "../../../../shared/camera-quality";
import { pluralKey } from "../../../../shared/i18n";
import type { CameraQuality } from "../../../../shared/preferences";
import { CameraDevicePicker } from "./camera-device-picker";

interface CameraSetupPanelProps {
	preferences: SettingsPreferences;
	setPreferences: SetPreferences;
	isWindowOpen: boolean;
	setIsWindowOpen: (open: boolean) => void;
	captureSurface: CameraCaptureSurface;
	error: string | null;
}

export function CameraSetupPanel({
	preferences,
	setPreferences,
	isWindowOpen,
	setIsWindowOpen,
	captureSurface,
	error,
}: CameraSetupPanelProps) {
	const t = useT();
	const { locale } = useI18n();
	const cameraOn = preferences.cameraEnabled;
	const autoStopMinutes = preferences.autoStopNoFaceMinutes;
	const autoStopDescKey = pluralKey(
		"camera.autoStopNoFaceDesc",
		locale,
		autoStopMinutes,
	);
	const qualityLabels: Record<CameraQuality, string> = {
		performance: t("camera.quality.performance"),
		medium: t("camera.quality.medium"),
		high: t("camera.quality.high"),
		ultra: t("camera.quality.ultra"),
	};
	const activePreset = CAMERA_QUALITY_PRESETS[preferences.cameraQuality];
	const chipKey = error
		? "camera.status.error"
		: cameraCaptureChipMessageKey(captureSurface);
	const chipClassName = error
		? "border-destructive/40 bg-destructive/10 text-destructive"
		: captureSurface === "idle"
			? "border-muted-foreground/30 bg-muted text-muted-foreground"
			: captureSurface === "preview"
				? "border-warning/40 bg-warning/10 text-warning-foreground"
				: undefined;

	const toggleCamera = () => {
		const enabled = !preferences.cameraEnabled;
		const update = () => {
			setPreferences((current) => ({
				...current,
				isTracking: false,
				cameraEnabled: enabled,
			}));
			if (enabled) rendererIpc.startCameraTracking();
			else rendererIpc.stopCameraTracking();
		};

		if (preferences.isTracking) {
			rendererIpc.stopReminders();
			setTimeout(update, 100);
		} else {
			update();
		}
	};

	const setCameraQuality = (cameraQuality: CameraQuality) => {
		if (cameraQuality === preferences.cameraQuality) return;
		setPreferences((current) => ({ ...current, cameraQuality }));
		rendererIpc.updateCameraQuality(cameraQuality);
	};

	return (
		<>
			<SettingGrid>
				<SettingPanel
					className={cn(
						"h-full",
						cameraOn
							? "border-primary/40 bg-primary/5"
							: "border-warning/40 bg-warning/10",
					)}
				>
					<SettingRow
						title={
							<>
								<Camera
									className={cn(
										"h-4 w-4",
										cameraOn ? "text-primary" : "text-warning",
									)}
									aria-hidden
								/>
								<span
									className={cn(
										cameraOn ? "text-primary" : "text-warning-foreground",
									)}
								>
									{t("camera.detection")}
								</span>
								<Badge
									role="status"
									className={cn(
										"transition-colors duration-200",
										chipClassName,
									)}
								>
									{t(chipKey)}
								</Badge>
							</>
						}
						description={
							<span className="inline-grid w-full grid-cols-1 grid-rows-1">
								<span className="invisible col-start-1 row-start-1" aria-hidden>
									{t("camera.detectionDesc")}
								</span>
								<span className="invisible col-start-1 row-start-1" aria-hidden>
									{t("camera.detectionDescOn")}
								</span>
								<span
									className={cn(
										"col-start-1 row-start-1",
										cameraOn ? "text-primary/80" : "text-warning-foreground/85",
									)}
								>
									{cameraOn
										? t("camera.detectionDescOn")
										: t("camera.detectionDesc")}
								</span>
							</span>
						}
						action={
							<ToggleSwitch
								aria-label={t("camera.toggleAria")}
								checked={cameraOn}
								onChange={toggleCamera}
							/>
						}
					>
						{/* Keep button slot reserved so the row height stays stable. */}
						<div className={cn(!cameraOn && "invisible pointer-events-none")}>
							{isWindowOpen ? (
								<Button
									type="button"
									size="sm"
									variant="destructive"
									tabIndex={cameraOn ? undefined : -1}
									onClick={() => {
										rendererIpc.closeCameraWindow();
										setIsWindowOpen(false);
									}}
								>
									{t("camera.stopShowing")}
								</Button>
							) : (
								<Button
									type="button"
									size="sm"
									tabIndex={cameraOn ? undefined : -1}
									onClick={() => {
										rendererIpc.showCameraWindow();
										setIsWindowOpen(true);
									}}
								>
									{t("camera.show")}
								</Button>
							)}
						</div>
					</SettingRow>
				</SettingPanel>

				<SettingPanel className={cn("h-full", !cameraOn && "opacity-60")}>
					<SettingRow
						title={
							<>
								<UserRoundX
									className="h-4 w-4 text-muted-foreground"
									aria-hidden
								/>
								{t("camera.autoStopNoFace")}
							</>
						}
						description={t(autoStopDescKey, { n: autoStopMinutes })}
						action={
							<ToggleSwitch
								aria-label={t("camera.autoStopNoFaceToggleAria")}
								checked={preferences.autoStopNoFaceEnabled}
								disabled={!cameraOn}
								onChange={() =>
									setPreferences((current) => ({
										...current,
										autoStopNoFaceEnabled: !current.autoStopNoFaceEnabled,
									}))
								}
							/>
						}
					>
						<div
							className={cn(
								"flex items-center gap-2",
								(!cameraOn || !preferences.autoStopNoFaceEnabled) &&
									"opacity-50",
							)}
						>
							<RangeSlider
								aria-label={t("camera.autoStopNoFaceIntervalAria")}
								min={1}
								max={30}
								value={autoStopMinutes}
								disabled={!cameraOn || !preferences.autoStopNoFaceEnabled}
								onChange={(autoStopNoFaceMinutes) =>
									setPreferences((current) => ({
										...current,
										autoStopNoFaceMinutes,
									}))
								}
								className="h-1.5 flex-1"
							/>
							<div className="min-w-[2.5rem] text-center text-xs font-medium text-primary">
								{autoStopMinutes}m
							</div>
						</div>
					</SettingRow>
				</SettingPanel>
			</SettingGrid>

			<CameraDevicePicker
				preferences={preferences}
				setPreferences={setPreferences}
			/>

			<SettingPanel>
				<SettingRow
					title={t("camera.quality")}
					description={t("camera.qualityDesc")}
					action={
						<span className="text-xs text-muted-foreground">
							{activePreset.targetFps} FPS ·{" "}
							{activePreset.processingResolution[0]}×
							{activePreset.processingResolution[1]}
						</span>
					}
				>
					<fieldset
						aria-label={t("camera.qualityAria")}
						className="m-0 flex overflow-hidden rounded-md border border-border p-0"
					>
						{CAMERA_QUALITY_OPTIONS.map((option) => {
							const selected = preferences.cameraQuality === option;
							return (
								<button
									key={option}
									type="button"
									aria-pressed={selected}
									onClick={() => setCameraQuality(option)}
									className={cn(
										"flex-1 px-2 py-1.5 text-xs font-medium transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:text-sm",
										selected
											? "bg-primary text-primary-foreground"
											: "bg-background text-foreground hover:bg-muted",
									)}
								>
									{qualityLabels[option]}
								</button>
							);
						})}
					</fieldset>
				</SettingRow>
			</SettingPanel>
		</>
	);
}
