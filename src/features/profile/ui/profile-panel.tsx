import { Share } from "lucide-react";
import { useMemo, useState } from "react";
import { Badge } from "@/components/badge";
import { Button } from "@/components/button";
import { SettingPanel } from "@/components/setting-panel";
import { SettingRow } from "@/components/setting-row";
import { SummaryStat } from "@/components/summary-stat";
import { useProfile } from "@/features/profile/model/use-profile";
import { ProfileShareDialog } from "@/features/profile/ui/profile-share-dialog";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import { rendererIpc } from "@/shared/ipc/renderer-ipc";

export function ProfilePanel() {
	const { t } = useI18n();
	const {
		snapshot,
		progress,
		titleKey,
		descKey,
		tierKey,
		titleMaxed,
		milestones,
	} = useProfile();
	const [shareOpen, setShareOpen] = useState(false);
	const [shareStatus, setShareStatus] = useState<string | null>(null);

	const shareData = useMemo(
		() => ({
			level: progress.level,
			titleKey,
			descKey,
			tierKey,
			lifetimeBlinks: snapshot.totals.total,
			streak: snapshot.streak.current,
			todayBlinks: snapshot.today.blinks,
			availableBlinks: snapshot.totals.available,
			hasFlair: snapshot.hasStatsFlair,
			achievementsUnlocked: snapshot.achievementsUnlocked,
			achievementsTotal: snapshot.achievementsTotal,
			progressRatio: progress.ratio,
			progressCurrent: progress.current,
			progressNeeded: progress.needed,
		}),
		[
			progress.level,
			progress.ratio,
			progress.current,
			progress.needed,
			titleKey,
			descKey,
			tierKey,
			snapshot.totals.total,
			snapshot.totals.available,
			snapshot.streak.current,
			snapshot.today.blinks,
			snapshot.hasStatsFlair,
			snapshot.achievementsUnlocked,
			snapshot.achievementsTotal,
		],
	);

	const handleSave = async (bytes: Uint8Array) => {
		setShareStatus(t("profile.share.busy"));
		try {
			const result = await rendererIpc.exportProfileImage(bytes);
			if (result.status === "cancelled") {
				setShareStatus(t("profile.share.cancelled"));
			} else if (result.status === "saved") {
				setShareStatus(t("profile.share.saved", { path: result.path ?? "" }));
				setShareOpen(false);
			} else {
				setShareStatus(
					t("profile.share.error", {
						message: result.message ?? "unknown",
					}),
				);
			}
		} catch (error) {
			setShareStatus(
				t("profile.share.error", {
					message: error instanceof Error ? error.message : String(error),
				}),
			);
		}
	};

	return (
		<>
			<SettingPanel>
				<SettingRow
					title={t("profile.hero.title")}
					description={t("profile.hero.desc")}
					action={
						<Button
							type="button"
							variant="secondary"
							size="sm"
							onClick={() => setShareOpen(true)}
						>
							<Share className="mr-2 h-4 w-4" />
							{t("profile.share.button")}
						</Button>
					}
				>
					<div className="space-y-4">
						<div className="flex flex-wrap items-center gap-2.5">
							<p className="text-4xl font-semibold leading-none tabular-nums tracking-tight">
								{t("profile.levelLabel", { level: progress.level })}
							</p>
							<div className="flex flex-wrap items-center gap-2">
								<Badge className="uppercase">{t(tierKey)}</Badge>
								{snapshot.hasStatsFlair ? (
									<Badge className="uppercase">{t("stats.flair.badge")}</Badge>
								) : null}
								<Badge className="uppercase">
									{t("achievements.badge", {
										unlocked: snapshot.achievementsUnlocked,
										total: snapshot.achievementsTotal,
									})}
								</Badge>
							</div>
						</div>
						<div>
							<p className="text-lg font-medium">{t(titleKey)}</p>
							<p className="mt-1 text-sm text-muted-foreground">{t(descKey)}</p>
						</div>
						<div>
							<div className="mb-1.5 flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
								<span>
									{t("profile.progress", {
										current: progress.current,
										needed: progress.needed,
									})}
								</span>
								<span className="tabular-nums">
									{Math.round(progress.ratio * 100)}%
								</span>
							</div>
							{titleMaxed ? (
								<p className="mb-1.5 text-xs text-muted-foreground">
									{t("profile.progressMaxTitle")}
								</p>
							) : null}
							<div className="h-2 overflow-hidden rounded-full bg-muted">
								<div
									className="h-full rounded-full bg-primary transition-[width] duration-300 ease-out"
									style={{ width: `${Math.min(100, progress.ratio * 100)}%` }}
								/>
							</div>
						</div>
						{shareStatus ? (
							<p className="select-text break-all text-sm text-muted-foreground">
								{shareStatus}
							</p>
						) : null}
					</div>
				</SettingRow>
			</SettingPanel>

			<SettingPanel>
				<SettingRow
					title={t("profile.snapshot.title")}
					description={t("profile.snapshot.desc")}
				>
					<div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
						<SummaryStat
							label={t("profile.stat.today")}
							value={String(snapshot.today.blinks)}
						/>
						<SummaryStat
							label={t("profile.stat.lifetime")}
							value={String(snapshot.totals.total)}
						/>
						<SummaryStat
							label={t("profile.stat.streak")}
							value={String(snapshot.streak.current)}
						/>
						<SummaryStat
							label={t("profile.stat.available")}
							value={String(snapshot.totals.available)}
						/>
					</div>
				</SettingRow>
			</SettingPanel>

			<SettingPanel>
				<SettingRow
					title={t("profile.milestones.title")}
					description={t("profile.milestones.desc")}
				>
					{milestones.length === 0 ? (
						<p className="text-sm text-muted-foreground">
							{t("profile.milestones.empty")}
						</p>
					) : (
						<ul className="space-y-2">
							{milestones.map((item) => (
								<li
									key={item.level}
									className={cn(
										"flex items-center justify-between gap-3 rounded-md border border-border bg-background px-3 py-2",
									)}
								>
									<div className="min-w-0">
										<p className="text-sm font-medium">
											{t("profile.levelLabel", { level: item.level })}
											<span className="text-muted-foreground">
												{" · "}
												{t(item.titleKey)}
											</span>
										</p>
									</div>
									<p className="shrink-0 text-xs tabular-nums text-muted-foreground">
										{t("profile.milestones.threshold", {
											n: item.threshold,
										})}
									</p>
								</li>
							))}
						</ul>
					)}
				</SettingRow>
			</SettingPanel>

			<ProfileShareDialog
				open={shareOpen}
				data={shareData}
				onClose={() => setShareOpen(false)}
				onSave={handleSave}
			/>
		</>
	);
}
