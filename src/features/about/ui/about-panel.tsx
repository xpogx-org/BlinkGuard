import { ExternalLink, Upload } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/button";
import { Reveal } from "@/components/reveal";
import { SettingPanel } from "@/components/setting-panel";
import { SettingRow } from "@/components/setting-row";
import { TabbedSection } from "@/components/tabbed-section";
import type { useAutoUpdate } from "@/features/about/model/use-auto-update";
import { ReleaseNotesPanel } from "@/features/about/ui/release-notes-panel";
import { ThanksPanel } from "@/features/about/ui/thanks-panel";
import { useT } from "@/i18n";
import { rendererIpc } from "@/shared/ipc/renderer-ipc";
import { author, version } from "../../../../package.json";

const AUTHOR_NAME = author.name;

const OVERVIEW_COPY = [
	{ title: "about.what.title", body: "about.what.body" },
	{ title: "about.why.title", body: "about.why.body" },
	{ title: "about.privacy.title", body: "about.privacy.body" },
	{ title: "about.display.title", body: "about.display.body" },
] as const;

type AboutTabId = "overview" | "notes" | "thanks";

type AboutPanelProps = {
	autoUpdate: Pick<ReturnType<typeof useAutoUpdate>, "busy" | "check">;
};

export function AboutPanel({ autoUpdate }: AboutPanelProps) {
	const t = useT();
	const [tab, setTab] = useState<AboutTabId>("overview");
	const [exportBusy, setExportBusy] = useState(false);
	const [exportStatus, setExportStatus] = useState<string | null>(null);
	const aboutTabs = [
		{ id: "overview" as const, label: t("app.about.tab.overview") },
		{ id: "notes" as const, label: t("app.about.tab.notes") },
		{ id: "thanks" as const, label: t("app.about.tab.thanks") },
	];

	const handleExportDiagnostics = async () => {
		if (exportBusy) return;
		setExportBusy(true);
		setExportStatus(null);
		try {
			const result = await rendererIpc.exportDiagnostics();
			if (result.status === "cancelled") {
				setExportStatus(t("about.exportDiagnostics.cancelled"));
			} else if (result.status === "saved") {
				setExportStatus(
					t("about.exportDiagnostics.success", {
						path: result.path ?? "",
					}),
				);
			} else {
				setExportStatus(
					t("about.exportDiagnostics.error", {
						message: result.message ?? "unknown",
					}),
				);
			}
		} catch (error) {
			setExportStatus(
				t("about.exportDiagnostics.error", {
					message: error instanceof Error ? error.message : String(error),
				}),
			);
		} finally {
			setExportBusy(false);
		}
	};

	return (
		<TabbedSection
			aria-label={t("app.about.tabsAria")}
			items={aboutTabs}
			value={tab}
			onChange={setTab}
			maxWidthClass="max-w-3xl"
		>
			{tab === "overview" ? (
				<>
					{OVERVIEW_COPY.map((item) => (
						<SettingPanel key={item.title}>
							<SettingRow title={t(item.title)} description={t(item.body)} />
						</SettingPanel>
					))}

					<SettingPanel>
						<SettingRow
							title={t("about.opensource.title")}
							description={t("about.opensource.body")}
							action={
								<Button
									type="button"
									variant="secondary"
									onClick={() => rendererIpc.openGithubRepo()}
								>
									<ExternalLink className="mr-2 h-4 w-4" aria-hidden />
									{t("about.opensource.github")}
								</Button>
							}
						/>
					</SettingPanel>

					<SettingPanel>
						<SettingRow
							title={t("about.exportDiagnostics.title")}
							description={t("about.exportDiagnostics.body")}
							action={
								<Button
									type="button"
									variant="secondary"
									disabled={exportBusy}
									onClick={() => {
										void handleExportDiagnostics();
									}}
								>
									<Upload className="mr-2 h-4 w-4" aria-hidden />
									{exportBusy
										? t("about.exportDiagnostics.busy")
										: t("about.exportDiagnostics.button")}
								</Button>
							}
						>
							<Reveal variant="fade" open={Boolean(exportStatus)}>
								{exportStatus ? (
									<p className="select-text text-sm text-muted-foreground break-all">
										{exportStatus}
									</p>
								) : null}
							</Reveal>
						</SettingRow>
					</SettingPanel>

					<SettingPanel>
						<SettingRow
							title="BlinkGuard"
							action={
								<Button
									type="button"
									variant="secondary"
									disabled={autoUpdate.busy}
									onClick={() => autoUpdate.check()}
								>
									{t("about.checkForUpdates")}
								</Button>
							}
						>
							<p className="select-text text-sm text-muted-foreground">
								{t("about.meta.version", { version })}
							</p>
							<p className="mt-1 text-sm text-muted-foreground">
								{t("about.meta.author", { name: AUTHOR_NAME })}
							</p>
						</SettingRow>
					</SettingPanel>
				</>
			) : null}
			{tab === "notes" ? <ReleaseNotesPanel /> : null}
			{tab === "thanks" ? <ThanksPanel /> : null}
		</TabbedSection>
	);
}
