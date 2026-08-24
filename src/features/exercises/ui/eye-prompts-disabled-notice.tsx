import { Reveal } from "@/components/reveal";
import { StatusBanner } from "@/components/status-banner";
import { useT } from "@/i18n";

interface EyePromptsDisabledNoticeProps {
	eyeExercisesEnabled: boolean;
	lookAwayEnabled: boolean;
}

export function EyePromptsDisabledNotice({
	eyeExercisesEnabled,
	lookAwayEnabled,
}: EyePromptsDisabledNoticeProps) {
	const t = useT();
	const visible = !eyeExercisesEnabled && !lookAwayEnabled;

	return (
		<Reveal variant="fade" open={visible}>
			<StatusBanner variant="warning">
				<h3 className="mb-1 text-sm font-semibold">
					{t("exercises.disabledNotice.title")}
				</h3>
				<p className="text-sm opacity-90">
					{t("exercises.disabledNotice.body")}
				</p>
			</StatusBanner>
		</Reveal>
	);
}
