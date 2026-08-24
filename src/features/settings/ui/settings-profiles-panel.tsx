import { useEffect, useState } from "react";
import { Button } from "@/components/button";
import { Reveal } from "@/components/reveal";
import { SettingGrid } from "@/components/setting-grid";
import { SettingPanel } from "@/components/setting-panel";
import { SettingRow } from "@/components/setting-row";
import { StatusBanner } from "@/components/status-banner";
import { useSettingsProfiles } from "@/features/settings/model/use-settings-profiles";
import { useT } from "@/i18n";
import { SETTINGS_PROFILE_CAP } from "../../../../shared/settings-profiles";

type ConfirmState =
	| { kind: "switch"; id: string; name: string }
	| { kind: "save-over"; id: string; name: string }
	| { kind: "delete"; id: string; name: string }
	| null;

function errorMessage(
	t: (key: string, vars?: Record<string, string | number>) => string,
	code: string | null,
): string | null {
	if (!code) return null;
	if (code === "cap") return t("settingsProfiles.error.cap");
	if (code === "invalid-name") return t("settingsProfiles.error.invalidName");
	if (code === "not-found") return t("settingsProfiles.error.notFound");
	if (code === "dirty") return t("settingsProfiles.dirty.body");
	return t("settingsProfiles.error.generic");
}

export function SettingsProfilesPanel({ active }: { active: boolean }) {
	const t = useT();
	const profiles = useSettingsProfiles(active);
	const [nameDraft, setNameDraft] = useState("");
	const [renameId, setRenameId] = useState<string | null>(null);
	const [renameDraft, setRenameDraft] = useState("");
	const [confirm, setConfirm] = useState<ConfirmState>(null);
	const activeProfileId = profiles.activeProfileId;

	// biome-ignore lint/correctness/useExhaustiveDependencies: re-run when active setup changes (tray switch)
	useEffect(() => {
		setConfirm(null);
	}, [activeProfileId]);

	const atCap = profiles.profiles.length >= SETTINGS_PROFILE_CAP;
	const canCreate = nameDraft.trim().length > 0 && !atCap && !profiles.busy;

	const handleSaveNew = async () => {
		const result = await profiles.save(nameDraft);
		if (result.ok) {
			setNameDraft("");
		}
	};

	const handleSwitch = async (id: string, name: string) => {
		if (
			profiles.dirty &&
			profiles.activeProfileId &&
			id !== profiles.activeProfileId
		) {
			setConfirm({ kind: "switch", id, name });
			return;
		}
		const result = await profiles.switchTo(id);
		// Prefs may have drifted after list — main re-checks dirty; open confirm.
		if (!result.ok && result.code === "dirty") {
			setConfirm({ kind: "switch", id, name });
			void profiles.refresh();
		}
	};

	const handleSaveOver = (id: string, name: string) => {
		setConfirm({ kind: "save-over", id, name });
	};

	if (confirm?.kind === "switch") {
		return (
			<SettingPanel className="space-y-3">
				<p className="text-sm text-foreground">
					{t("settingsProfiles.dirty.body")}
				</p>
				<p className="text-sm text-muted-foreground">
					{t("settingsProfiles.dirty.switchPrompt", { name: confirm.name })}
				</p>
				<div className="flex flex-wrap gap-2">
					<Button
						type="button"
						variant="secondary"
						onClick={() => setConfirm(null)}
					>
						{t("common.cancel")}
					</Button>
					<Button
						type="button"
						onClick={async () => {
							await profiles.switchTo(confirm.id, true);
							setConfirm(null);
						}}
					>
						{t("settingsProfiles.dirty.switchAnyway")}
					</Button>
				</div>
			</SettingPanel>
		);
	}

	if (confirm?.kind === "save-over") {
		return (
			<SettingPanel className="space-y-3">
				<p className="text-sm text-foreground">
					{t("settingsProfiles.saveOver.confirm")}
				</p>
				<div className="flex flex-wrap gap-2">
					<Button
						type="button"
						variant="secondary"
						onClick={() => setConfirm(null)}
					>
						{t("common.cancel")}
					</Button>
					<Button
						type="button"
						onClick={async () => {
							await profiles.save(confirm.name, confirm.id);
							setConfirm(null);
						}}
					>
						{t("settingsProfiles.saveOver.button")}
					</Button>
				</div>
			</SettingPanel>
		);
	}

	if (confirm?.kind === "delete") {
		return (
			<SettingPanel className="space-y-3">
				<p className="text-sm text-foreground">
					{t("settingsProfiles.delete.confirm", { name: confirm.name })}
				</p>
				<div className="flex flex-wrap gap-2">
					<Button
						type="button"
						variant="secondary"
						onClick={() => setConfirm(null)}
					>
						{t("common.cancel")}
					</Button>
					<Button
						type="button"
						variant="destructive"
						onClick={async () => {
							await profiles.remove(confirm.id);
							setConfirm(null);
						}}
					>
						{t("settingsProfiles.delete.button")}
					</Button>
				</div>
			</SettingPanel>
		);
	}

	const banner = errorMessage(t, profiles.errorCode);

	return (
		<SettingPanel className="space-y-4">
			<SettingRow
				title={t("settingsProfiles.title")}
				description={t("settingsProfiles.body")}
			>
				<div className="space-y-3">
					<Reveal variant="fade" open={profiles.dirty}>
						<StatusBanner>{t("settingsProfiles.dirty.body")}</StatusBanner>
					</Reveal>
					<Reveal variant="fade" open={Boolean(banner)}>
						{banner ? (
							<StatusBanner variant="destructive" role="alert">
								{banner}
							</StatusBanner>
						) : null}
					</Reveal>
					<Reveal variant="fade" open={atCap}>
						<StatusBanner>{t("settingsProfiles.cap.reached")}</StatusBanner>
					</Reveal>

					<div className="flex flex-wrap items-end gap-2">
						<label className="flex min-w-[12rem] flex-1 flex-col gap-1 text-sm">
							<span className="text-muted-foreground">
								{t("settingsProfiles.nameLabel")}
							</span>
							<input
								type="text"
								value={nameDraft}
								maxLength={40}
								disabled={profiles.busy || atCap}
								onChange={(event) => setNameDraft(event.target.value)}
								className="rounded-md border border-border bg-background px-2 py-1.5 text-foreground"
								placeholder={t("settingsProfiles.namePlaceholder")}
							/>
						</label>
						<Button
							type="button"
							disabled={!canCreate}
							onClick={() => void handleSaveNew()}
						>
							{t("settingsProfiles.save.button")}
						</Button>
					</div>
				</div>
			</SettingRow>

			{profiles.profiles.length > 0 ? (
				<SettingGrid>
					{profiles.profiles.map((profile) => {
						const isActive = profile.id === profiles.activeProfileId;
						const renaming = renameId === profile.id;
						return (
							<SettingRow
								key={profile.id}
								title={
									<span className="flex flex-wrap items-center gap-2">
										<span>{profile.name}</span>
										{isActive ? (
											<span className="text-2xs font-medium uppercase tracking-wide text-primary">
												{t("settingsProfiles.active")}
											</span>
										) : null}
									</span>
								}
								description={
									isActive && profiles.dirty
										? t("settingsProfiles.dirty.hint")
										: undefined
								}
							>
								<Reveal open={renaming}>
									<div className="flex flex-wrap gap-2">
										<input
											type="text"
											value={renameDraft}
											maxLength={40}
											onChange={(event) => setRenameDraft(event.target.value)}
											className="min-w-[10rem] flex-1 rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
										/>
										<Button
											type="button"
											size="sm"
											disabled={!renameDraft.trim() || profiles.busy}
											onClick={async () => {
												const result = await profiles.rename(
													profile.id,
													renameDraft,
												);
												if (result.ok) {
													setRenameId(null);
													setRenameDraft("");
												}
											}}
										>
											{t("common.save")}
										</Button>
										<Button
											type="button"
											size="sm"
											variant="secondary"
											onClick={() => {
												setRenameId(null);
												setRenameDraft("");
											}}
										>
											{t("common.cancel")}
										</Button>
									</div>
								</Reveal>
								<Reveal open={!renaming}>
									<div className="flex flex-wrap gap-2">
										<Button
											type="button"
											size="sm"
											disabled={isActive || profiles.busy}
											onClick={() =>
												void handleSwitch(profile.id, profile.name)
											}
										>
											{t("settingsProfiles.switch.button")}
										</Button>
										<Button
											type="button"
											size="sm"
											variant="secondary"
											disabled={profiles.busy}
											onClick={() => handleSaveOver(profile.id, profile.name)}
										>
											{t("settingsProfiles.saveOver.button")}
										</Button>
										<Button
											type="button"
											size="sm"
											variant="secondary"
											disabled={profiles.busy}
											onClick={() => {
												setRenameId(profile.id);
												setRenameDraft(profile.name);
											}}
										>
											{t("settingsProfiles.rename.button")}
										</Button>
										<Button
											type="button"
											size="sm"
											variant="destructive"
											disabled={profiles.busy}
											onClick={() =>
												setConfirm({
													kind: "delete",
													id: profile.id,
													name: profile.name,
												})
											}
										>
											{t("settingsProfiles.delete.button")}
										</Button>
									</div>
								</Reveal>
							</SettingRow>
						);
					})}
				</SettingGrid>
			) : null}
		</SettingPanel>
	);
}
