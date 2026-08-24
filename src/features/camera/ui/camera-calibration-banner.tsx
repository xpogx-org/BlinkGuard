import { Button } from "@/components/button";
import { Reveal } from "@/components/reveal";
import { StatusBanner } from "@/components/status-banner";
import { useT } from "@/i18n";
import type { CalibrationNudgeReason } from "../../../../shared/calibration-freshness";

interface CameraCalibrationBannerProps {
	reason: CalibrationNudgeReason | null;
	calibrating: boolean;
	onRecalibrate: () => void;
	onDismiss: () => void;
}

export function CameraCalibrationBanner({
	reason,
	calibrating,
	onRecalibrate,
	onDismiss,
}: CameraCalibrationBannerProps) {
	const t = useT();
	const hint =
		reason === "drift"
			? t("camera.calibrationDriftHint")
			: t("camera.calibrationStaleHint");

	return (
		<Reveal variant="fade" open={Boolean(reason)}>
			{reason ? (
				<StatusBanner variant="warning" className="px-4 py-3" role="status">
					<div className="flex flex-wrap items-center justify-between gap-3">
						<p className="min-w-0 flex-1 text-sm">{hint}</p>
						<div className="flex shrink-0 flex-wrap items-center gap-2">
							<Button
								type="button"
								size="sm"
								disabled={calibrating}
								onClick={onRecalibrate}
							>
								{t("camera.calibrate")}
							</Button>
							<Button
								type="button"
								size="sm"
								variant="ghost"
								disabled={calibrating}
								onClick={onDismiss}
							>
								{t("camera.calibrationNudgeDismiss")}
							</Button>
						</div>
					</div>
				</StatusBanner>
			) : null}
		</Reveal>
	);
}
