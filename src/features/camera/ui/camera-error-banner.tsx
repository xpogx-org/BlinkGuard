import { Camera } from "lucide-react";
import { Reveal } from "@/components/reveal";
import { StatusBanner } from "@/components/status-banner";
import { useT } from "@/i18n";

interface CameraErrorBannerProps {
	error: string | null;
	onDismiss: () => void;
}

export function CameraErrorBanner({
	error,
	onDismiss,
}: CameraErrorBannerProps) {
	const t = useT();

	return (
		<Reveal variant="fade" open={Boolean(error)}>
			{error ? (
				<StatusBanner variant="destructive" className="px-4 py-3" role="alert">
					<div className="flex items-center justify-between gap-3">
						<div className="flex min-w-0 items-center gap-2 text-sm">
							<Camera className="h-4 w-4 shrink-0" aria-hidden />
							<span className="font-medium">{t("camera.error")}</span>
							<span className="select-text truncate">{error}</span>
						</div>
						<button
							type="button"
							aria-label={t("camera.dismissError")}
							onClick={onDismiss}
							className="shrink-0 text-lg leading-none opacity-70 hover:opacity-100"
						>
							×
						</button>
					</div>
				</StatusBanner>
			) : null}
		</Reveal>
	);
}
