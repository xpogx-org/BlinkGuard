import type { CameraCalibration } from "@/features/camera/model/use-camera-calibration";
import type { SettingsPreferences } from "@/features/settings/model/preferences";
import type { SetPreferences } from "@/features/settings/model/use-preferences";
import type { CameraCaptureSurface } from "../../../../shared/camera-capture-status";
import { CameraCalibrationBanner } from "./camera-calibration-banner";
import { CameraErrorBanner } from "./camera-error-banner";
import { CameraSetupPanel } from "./camera-setup-panel";
import { CameraTuningPanel } from "./camera-tuning-panel";

export type CameraTabId = "setup" | "tuning";

interface CameraControlsProps {
	tab: CameraTabId;
	preferences: SettingsPreferences;
	setPreferences: SetPreferences;
	isWindowOpen: boolean;
	setIsWindowOpen: (open: boolean) => void;
	calibration: CameraCalibration;
	error: string | null;
	onDismissError: () => void;
	captureSurface: CameraCaptureSurface;
}

export function CameraControls({
	tab,
	preferences,
	setPreferences,
	isWindowOpen,
	setIsWindowOpen,
	calibration,
	error,
	onDismissError,
	captureSurface,
}: CameraControlsProps) {
	return (
		<>
			<CameraErrorBanner error={error} onDismiss={onDismissError} />
			<CameraCalibrationBanner
				reason={calibration.nudgeReason}
				calibrating={calibration.calibrating}
				onRecalibrate={calibration.startCalibration}
				onDismiss={calibration.dismissCalibrationNudge}
			/>
			{tab === "setup" ? (
				<CameraSetupPanel
					preferences={preferences}
					setPreferences={setPreferences}
					isWindowOpen={isWindowOpen}
					setIsWindowOpen={setIsWindowOpen}
					captureSurface={captureSurface}
					error={error}
					calibration={calibration}
				/>
			) : (
				<CameraTuningPanel
					preferences={preferences}
					setPreferences={setPreferences}
				/>
			)}
		</>
	);
}
