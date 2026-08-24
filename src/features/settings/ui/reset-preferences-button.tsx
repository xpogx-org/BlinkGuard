import { useState } from "react";
import { Button } from "@/components/button";
import { Reveal } from "@/components/reveal";
import { SettingPanel } from "@/components/setting-panel";
import { SettingRow } from "@/components/setting-row";
import { useT } from "@/i18n";
import { rendererIpc } from "@/shared/ipc/renderer-ipc";

export function ResetPreferencesButton() {
	const t = useT();
	const [confirming, setConfirming] = useState(false);
	const [replayOnboarding, setReplayOnboarding] = useState(false);

	const confirmReset = () => {
		rendererIpc.resetPreferences(replayOnboarding);
		setConfirming(false);
		setReplayOnboarding(false);
	};

	return (
		<SettingPanel className="border-destructive/40 bg-destructive/5">
			<SettingRow
				title={
					<span className="text-destructive">{t("reset.dangerZone")}</span>
				}
				description={t("reset.description")}
			>
				<Reveal open={confirming}>
					<div className="space-y-3">
						<p className="text-sm text-foreground">{t("reset.confirm")}</p>
						<label className="flex items-start gap-2 text-sm text-muted-foreground">
							<input
								type="checkbox"
								checked={replayOnboarding}
								onChange={(event) => setReplayOnboarding(event.target.checked)}
								className="mt-0.5"
							/>
							<span>{t("reset.replayOnboarding")}</span>
						</label>
						<div className="flex flex-wrap gap-2">
							<Button
								type="button"
								variant="secondary"
								onClick={() => {
									setConfirming(false);
									setReplayOnboarding(false);
								}}
							>
								{t("common.cancel")}
							</Button>
							<Button
								type="button"
								variant="destructive"
								onClick={confirmReset}
							>
								{t("common.reset")}
							</Button>
						</div>
					</div>
				</Reveal>
				<Reveal open={!confirming}>
					<Button
						type="button"
						variant="destructive"
						onClick={() => setConfirming(true)}
					>
						{t("reset.title")}
					</Button>
				</Reveal>
			</SettingRow>
		</SettingPanel>
	);
}
