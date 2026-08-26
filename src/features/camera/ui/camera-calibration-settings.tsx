import { Crosshair } from "lucide-react";
import { Button } from "@/components/button";
import { Reveal } from "@/components/reveal";
import { SettingPanel } from "@/components/setting-panel";
import { SettingRow } from "@/components/setting-row";
import type { CameraCalibration } from "@/features/camera/model/use-camera-calibration";
import { useT } from "@/i18n";
import { cn } from "@/lib/utils";
import { CLASSIFIER_CALIBRATION_MIN_BLINKS } from "../../../../shared/classifier-calibration";
import { EAR_CALIBRATION_MIN_SAMPLES } from "../../../../shared/ear-calibration";

interface CameraCalibrationSettingsProps {
	calibration: CameraCalibration;
	disabled?: boolean;
	className?: string;
}

export function CameraCalibrationSettings({
	calibration,
	disabled = false,
	className,
}: CameraCalibrationSettingsProps) {
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

	return (
		<SettingPanel className={cn("h-full", disabled && "opacity-60", className)}>
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
							disabled={disabled}
							onClick={cancelCalibration}
						>
							{t("camera.cancelCalibration", { n: remainingSec })}
						</Button>
					) : (
						<Button
							type="button"
							size="sm"
							disabled={disabled}
							onClick={startCalibration}
						>
							{t("camera.calibrate")}
						</Button>
					)}
					<Reveal open={hasSavedCalibration && !calibrating}>
						<Button
							type="button"
							size="sm"
							variant="ghost"
							disabled={disabled}
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
	);
}
