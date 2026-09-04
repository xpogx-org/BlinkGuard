import { Download, Upload } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/button";
import { Reveal } from "@/components/reveal";
import { SettingPanel } from "@/components/setting-panel";
import { SettingRow } from "@/components/setting-row";
import { useT } from "@/i18n";
import { cn } from "@/lib/utils";
import { rendererIpc } from "@/shared/ipc/renderer-ipc";
import {
	backupScopeIncludesPreferences,
	type BackupScope,
} from "../../../../shared/backup";

const BACKUP_SCOPES: BackupScope[] = ["both", "preferences", "statistics"];

type ProfilesConfirmState = {
	filePath: string;
	localProfileNames: string[];
	backupProfileNames: string[];
};

function formatNameList(names: string[]): string {
	return names.join(", ");
}

export function BackupSettings() {
	const t = useT();
	const [scope, setScope] = useState<BackupScope>("both");
	const [confirmingImport, setConfirmingImport] = useState(false);
	const [profilesConfirm, setProfilesConfirm] =
		useState<ProfilesConfirmState | null>(null);
	const [busy, setBusy] = useState<"export" | "import" | null>(null);
	const [status, setStatus] = useState<string | null>(null);

	const handleExport = async () => {
		if (busy) return;
		setBusy("export");
		setStatus(null);
		try {
			const result = await rendererIpc.exportBackup(scope);
			if (result.status === "cancelled") {
				setStatus(t("backup.export.cancelled"));
			} else if (result.status === "saved") {
				setStatus(t("backup.export.success", { path: result.path ?? "" }));
			} else {
				setStatus(
					t("backup.export.error", {
						message: result.message ?? "unknown",
					}),
				);
			}
		} catch (error) {
			setStatus(
				t("backup.export.error", {
					message: error instanceof Error ? error.message : String(error),
				}),
			);
		} finally {
			setBusy(null);
		}
	};

	const handleImport = async (options?: {
		profilesOverwriteConfirmed?: boolean;
		filePath?: string;
	}) => {
		if (busy) return;
		setBusy("import");
		setStatus(null);
		try {
			const result = await rendererIpc.importBackup(scope, options);
			if (result.status === "cancelled") {
				setStatus(t("backup.import.cancelled"));
				setProfilesConfirm(null);
			} else if (result.status === "needs-profiles-confirm") {
				setProfilesConfirm({
					filePath: result.path ?? "",
					localProfileNames: result.localProfileNames ?? [],
					backupProfileNames: result.backupProfileNames ?? [],
				});
				setConfirmingImport(false);
			} else if (result.status === "imported") {
				setStatus(t("backup.import.success"));
				setProfilesConfirm(null);
			} else {
				setStatus(
					t("backup.import.error", {
						message: result.message ?? "unknown",
					}),
				);
				setProfilesConfirm(null);
			}
		} catch (error) {
			setStatus(
				t("backup.import.error", {
					message: error instanceof Error ? error.message : String(error),
				}),
			);
			setProfilesConfirm(null);
		} finally {
			setBusy(null);
		}
	};

	if (profilesConfirm) {
		return (
			<Reveal variant="fade" open>
				<SettingPanel className="space-y-3">
					<p className="text-sm text-foreground">
						{t("backup.import.confirmProfiles", {
							localNames: formatNameList(profilesConfirm.localProfileNames),
							backupNames: formatNameList(profilesConfirm.backupProfileNames),
						})}
					</p>
					<div className="flex flex-wrap gap-2">
						<Button
							type="button"
							variant="secondary"
							disabled={busy !== null}
							onClick={() => setProfilesConfirm(null)}
						>
							{t("common.cancel")}
						</Button>
						<Button
							type="button"
							variant="destructive"
							disabled={busy !== null}
							onClick={() => {
								void handleImport({
									filePath: profilesConfirm.filePath,
									profilesOverwriteConfirmed: true,
								});
							}}
						>
							{busy === "import"
								? t("backup.import.busy")
								: t("backup.import.button")}
						</Button>
					</div>
				</SettingPanel>
			</Reveal>
		);
	}

	if (confirmingImport) {
		return (
			<Reveal variant="fade" open>
				<SettingPanel className="space-y-3">
					<p className="text-sm text-foreground">
						{t("backup.import.confirm")}
					</p>
					<div className="flex flex-wrap gap-2">
						<Button
							type="button"
							variant="secondary"
							disabled={busy !== null}
							onClick={() => setConfirmingImport(false)}
						>
							{t("common.cancel")}
						</Button>
						<Button
							type="button"
							variant="destructive"
							disabled={busy !== null}
							onClick={() => {
								void handleImport();
							}}
						>
							{busy === "import"
								? t("backup.import.busy")
								: t("backup.import.button")}
						</Button>
					</div>
				</SettingPanel>
			</Reveal>
		);
	}

	return (
		<SettingPanel>
			<SettingRow title={t("backup.title")} description={t("backup.body")}>
				<fieldset
					className="m-0 space-y-1.5 border-0 p-0 pt-1"
					disabled={busy !== null}
				>
					<legend className="mb-2 px-0 text-xs font-medium text-muted-foreground">
						{t("backup.scope.legend")}
					</legend>
					{BACKUP_SCOPES.map((value) => {
						const selected = scope === value;
						const label =
							value === "both"
								? t("backup.scope.both")
								: value === "preferences"
									? t("backup.scope.preferences")
									: t("backup.scope.statistics");
						return (
							<label
								key={value}
								className={cn(
									"flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2 text-sm transition-colors",
									selected
										? "border-primary bg-primary/10 text-foreground"
										: "border-border bg-background text-foreground hover:bg-muted",
									busy !== null && "cursor-not-allowed opacity-50",
								)}
							>
								{/* In-flow radio (not sr-only): avoids focus scroll jumping the whole window. */}
								<input
									type="radio"
									name="backup-scope"
									value={value}
									checked={selected}
									onChange={() => setScope(value)}
									disabled={busy !== null}
									className={cn(
										"h-4 w-4 shrink-0 appearance-none rounded-full border-2 bg-transparent",
										"checked:border-primary checked:bg-[radial-gradient(circle_at_center,hsl(var(--primary))_0_38%,transparent_40%)]",
										"focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
										selected ? "border-primary" : "border-muted-foreground/45",
									)}
								/>
								<span>{label}</span>
							</label>
						);
					})}
					{backupScopeIncludesPreferences(scope) ? (
						<p className="px-1 text-xs text-muted-foreground">
							{t("backup.scope.setups")}
						</p>
					) : null}
				</fieldset>
				<div className="mt-3 flex flex-wrap gap-2">
					<Button
						type="button"
						variant="secondary"
						disabled={busy !== null}
						onClick={() => {
							void handleExport();
						}}
					>
						<Upload className="mr-2 h-4 w-4" aria-hidden />
						{busy === "export"
							? t("backup.export.busy")
							: t("backup.export.button")}
					</Button>
					<Button
						type="button"
						variant="destructive"
						disabled={busy !== null}
						onClick={() => {
							setStatus(null);
							setConfirmingImport(true);
						}}
					>
						<Download className="mr-2 h-4 w-4" aria-hidden />
						{t("backup.import.button")}
					</Button>
				</div>
				<Reveal variant="fade" open={Boolean(status)}>
					{status ? (
						<p className="mt-3 select-text text-sm text-muted-foreground break-all">
							{status}
						</p>
					) : null}
				</Reveal>
			</SettingRow>
		</SettingPanel>
	);
}
