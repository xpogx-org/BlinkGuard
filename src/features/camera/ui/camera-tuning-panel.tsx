import { Activity, Crosshair, Gauge, RefreshCw } from "lucide-react";
import { Button } from "@/components/button";
import { Reveal } from "@/components/reveal";
import { SettingGrid } from "@/components/setting-grid";
import { SettingPanel } from "@/components/setting-panel";
import { SettingRow } from "@/components/setting-row";
import { ToggleSwitch } from "@/components/toggle-switch";
import type { CameraCalibration } from "@/features/camera/model/use-camera-calibration";
import type { SettingsPreferences } from "@/features/settings/model/preferences";
import type { SetPreferences } from "@/features/settings/model/use-preferences";
import { useT } from "@/i18n";
import { cn } from "@/lib/utils";
import { rendererIpc } from "@/shared/ipc/renderer-ipc";
import { CLASSIFIER_CALIBRATION_MIN_BLINKS } from "../../../../shared/classifier-calibration";
import { EAR_CALIBRATION_MIN_SAMPLES } from "../../../../shared/ear-calibration";

interface CameraTuningPanelProps {
	preferences: SettingsPreferences;
	setPreferences: SetPreferences;
	calibration: CameraCalibration;
}

export function CameraTuningPanel({
	preferences,
	setPreferences,
	calibration,
}: CameraTuningPanelProps) {
	const t = useT();
	const {
		calibrating,
		calibrationPhase,
		calibrationSampleCount,
		calibrationBlinkCount,
		calibrationFaceDetected,
		calibrationMessage,
		progressRatio,
		remainingSec,
		earBadge,
		lastCalibratedLabel,
		hasSavedCalibration,
		startCalibration,
		cancelCalibration,
		resetCalibration,
	} = calibration;

	const toggleMgd = () => {
		const enabled = !preferences.mgdMode;
		if (preferences.isTracking) rendererIpc.stopReminders();
		setPreferences((current) => ({
			...current,
			isTracking: false,
			mgdMode: enabled,
		}));
		rendererIpc.updateMgdMode(enabled);
	};

	return (
		<>
			<SettingGrid>
				<SettingPanel className="h-full">
					<SettingRow
						title={
							<>
								<Crosshair
									className="h-4 w-4 text-muted-foreground"
									aria-hidden
								/>
								{t("camera.calibration")}
							</>
						}
						description={t("camera.calibrationDesc")}
					>
						<div className="flex flex-wrap items-center gap-2">
							{calibrating ? (
								<Button
									type="button"
									size="sm"
									variant="secondary"
									onClick={cancelCalibration}
								>
									{t("camera.cancelCalibration", { n: remainingSec })}
								</Button>
							) : (
								<Button type="button" size="sm" onClick={startCalibration}>
									{t("camera.calibrate")}
								</Button>
							)}
							<Reveal open={hasSavedCalibration && !calibrating}>
								<Button
									type="button"
									size="sm"
									variant="ghost"
									onClick={resetCalibration}
								>
									{t("common.reset")}
								</Button>
							</Reveal>
						</div>
						{earBadge || lastCalibratedLabel ? (
							<p className="mt-2 select-text text-xs">
								{earBadge ? (
									<span className="text-primary">{earBadge}</span>
								) : null}
								{lastCalibratedLabel ? (
									<span className="mt-0.5 block text-muted-foreground">
										{lastCalibratedLabel}
									</span>
								) : null}
							</p>
						) : null}
						<Reveal open={calibrating}>
							<div>
								<div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
									<div
										className="h-full bg-primary transition-[width] duration-200"
										style={{ width: `${progressRatio * 100}%` }}
									/>
								</div>
								<p className="mt-2 text-xs text-muted-foreground">
									{calibrationPhase === "blinks"
										? t("camera.calibrationPhaseBlinks")
										: t("camera.calibrationPhaseOpenEye")}
									{" · "}
									{calibrationPhase === "blinks"
										? t("camera.calibrationBlinkProgress", {
												n: calibrationBlinkCount,
												min: CLASSIFIER_CALIBRATION_MIN_BLINKS,
											})
										: t("camera.calibrationProgress", {
												n: calibrationSampleCount,
												min: EAR_CALIBRATION_MIN_SAMPLES,
											})}
									{" · "}
									{calibrationFaceDetected
										? t("camera.calibrationFaceOk")
										: t("camera.calibrationFaceMissing")}
								</p>
							</div>
						</Reveal>
						<Reveal variant="fade" open={Boolean(calibrationMessage)}>
							{calibrationMessage ? (
								<p className="mt-2 select-text text-xs text-muted-foreground">
									{calibrationMessage}
								</p>
							) : null}
						</Reveal>
					</SettingRow>
				</SettingPanel>

				<SettingPanel className="h-full">
					<SettingRow
						title={
							<>
								<RefreshCw
									className="h-4 w-4 text-muted-foreground"
									aria-hidden
								/>
								{t("camera.calibrationNudge")}
							</>
						}
						description={t("camera.calibrationNudgeDesc")}
						action={
							<ToggleSwitch
								aria-label={t("camera.calibrationNudgeToggleAria")}
								checked={preferences.calibrationNudgeEnabled}
								onChange={() =>
									setPreferences((current) => ({
										...current,
										calibrationNudgeEnabled: !current.calibrationNudgeEnabled,
									}))
								}
							/>
						}
					/>
				</SettingPanel>
			</SettingGrid>

			<SettingGrid>
				<SettingPanel className="h-full">
					<SettingRow
						title={
							<>
								<Activity
									className="h-4 w-4 text-muted-foreground"
									aria-hidden
								/>
								{t("camera.mgd")}
							</>
						}
						description={t("camera.mgdDesc")}
						action={
							<ToggleSwitch
								aria-label={t("camera.mgdToggleAria")}
								checked={preferences.mgdMode}
								onChange={toggleMgd}
							/>
						}
					>
						<div className="flex flex-wrap items-center gap-2">
							<button
								type="button"
								onClick={() =>
									setPreferences((current) => ({
										...current,
										showMgdInfo: !current.showMgdInfo,
									}))
								}
								className="text-xs text-primary hover:underline"
							>
								{preferences.showMgdInfo
									? t("common.hideInfo")
									: t("common.learnMore")}
							</button>
							<span
								className={cn(
									"rounded bg-primary/10 px-2 py-0.5 text-xs text-primary",
									!preferences.mgdMode && "invisible",
								)}
							>
								{t("camera.mgdActive")}
							</span>
						</div>
						<Reveal open={preferences.showMgdInfo}>
							<div className="mt-2 rounded-md bg-accent/60 p-3 text-xs text-muted-foreground sm:text-sm">
								{t("camera.mgdInfo")}
							</div>
						</Reveal>
					</SettingRow>
				</SettingPanel>

				<SettingPanel className="h-full">
					<SettingRow
						title={
							<>
								<Gauge className="h-4 w-4 text-muted-foreground" aria-hidden />
								{t("camera.coaching")}
							</>
						}
						description={t("camera.coachingDesc")}
						action={
							<ToggleSwitch
								aria-label={t("camera.coachingToggleAria")}
								checked={preferences.blinkRateCoachingEnabled}
								onChange={() =>
									setPreferences((current) => ({
										...current,
										blinkRateCoachingEnabled: !current.blinkRateCoachingEnabled,
									}))
								}
							/>
						}
					>
						<div className="flex flex-wrap items-center gap-3">
							<label
								htmlFor="blink-rate-threshold"
								className="text-xs text-muted-foreground"
							>
								{t("camera.minBlinks")}
							</label>
							<input
								id="blink-rate-threshold"
								type="number"
								min={1}
								max={60}
								step={1}
								disabled={!preferences.blinkRateCoachingEnabled}
								value={preferences.blinkRateThresholdPerMin}
								onChange={(event) => {
									const value = Number.parseInt(event.target.value, 10);
									if (!Number.isFinite(value)) return;
									setPreferences((current) => ({
										...current,
										blinkRateThresholdPerMin: value,
									}));
								}}
								className="w-20 rounded-md border border-border bg-background px-2 py-1 text-sm disabled:opacity-50"
							/>
						</div>
					</SettingRow>
				</SettingPanel>
			</SettingGrid>
		</>
	);
}
