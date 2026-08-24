import { useState } from "react";
import { Button } from "@/components/button";
import { Reveal } from "@/components/reveal";
import { SettingPanel } from "@/components/setting-panel";
import { SettingRow } from "@/components/setting-row";
import { ToggleSwitch } from "@/components/toggle-switch";
import type { SetPreferences } from "@/features/settings/model/use-preferences";
import { useBlinkStats } from "@/features/statistics/model/use-blink-stats";
import { useT } from "@/i18n";
import { rendererIpc } from "@/shared/ipc/renderer-ipc";
import { levelFromTotalBlinks } from "../../../../shared/blink-profile";

interface DebugToolsPanelProps {
	setPreferences: SetPreferences;
}

export function DebugToolsPanel({ setPreferences }: DebugToolsPanelProps) {
	const t = useT();
	const { snapshot } = useBlinkStats();
	const profileLevel = levelFromTotalBlinks(snapshot.totals.total);
	const hasFlair = snapshot.hasStatsFlair;
	const hasShield = snapshot.streak.shieldCharges > 0;
	const discountOffer = snapshot.rewards.find(
		(reward) => reward.id === "shopDiscount",
	);
	const discountLevel = discountOffer?.purchaseCount ?? 0;
	const discountPercent = discountOffer?.discountPercent ?? 0;
	const discountAtMax = discountOffer?.atMax ?? false;
	const [traceStatus, setTraceStatus] = useState("");
	const [traceRecording, setTraceRecording] = useState(false);

	return (
		<>
			<SettingPanel>
				<SettingRow
					title={t("debug.shop.title")}
					description={t("debug.shop.desc")}
				>
					<div className="space-y-3">
						<SettingRow
							title={t("rewards.statsFlair")}
							description={t("debug.shop.statsFlairDesc")}
							action={
								<ToggleSwitch
									checked={hasFlair}
									onChange={() =>
										rendererIpc.debugSetShopReward("statsFlair", !hasFlair)
									}
									aria-label={t("rewards.statsFlair")}
								/>
							}
						/>
						<SettingRow
							title={t("rewards.streakShield")}
							description={t("debug.shop.streakShieldDesc")}
							action={
								<ToggleSwitch
									checked={hasShield}
									onChange={() =>
										rendererIpc.debugSetShopReward("streakShield", !hasShield)
									}
									aria-label={t("rewards.streakShield")}
								/>
							}
						/>
						<SettingRow
							title={t("rewards.shopDiscount")}
							description={`${t("debug.shop.shopDiscountDesc")} ${
								discountAtMax
									? t("debug.shop.discountStatusMax")
									: t("debug.shop.discountStatus", {
											percent: discountPercent,
											level: discountLevel,
										})
							}`}
							action={
								<div className="flex flex-wrap gap-2">
									<Button
										type="button"
										variant="secondary"
										size="sm"
										disabled={discountLevel === 0}
										onClick={() => rendererIpc.debugSetShopDiscountLevel(0)}
									>
										{t("debug.shop.clear")}
									</Button>
									<Button
										type="button"
										variant="secondary"
										size="sm"
										disabled={discountAtMax}
										onClick={() =>
											rendererIpc.debugSetShopDiscountLevel(discountLevel + 1)
										}
									>
										{t("debug.shop.plusOne")}
									</Button>
									<Button
										type="button"
										variant="secondary"
										size="sm"
										disabled={discountAtMax}
										onClick={() => rendererIpc.debugSetShopDiscountLevel(10)}
									>
										{t("rewards.max")}
									</Button>
								</div>
							}
						/>
						<SettingRow
							title={t("debug.shop.previewCheer")}
							description={t("debug.shop.previewCheerDesc")}
							action={
								<Button
									type="button"
									variant="secondary"
									onClick={() => rendererIpc.debugPreviewCheer()}
								>
									{t("debug.shop.previewCheer")}
								</Button>
							}
						/>
					</div>
				</SettingRow>
			</SettingPanel>

			<SettingPanel>
				<SettingRow
					title={t("debug.profile.title")}
					description={t("debug.profile.desc")}
				>
					<div className="space-y-3">
						<p className="text-sm text-muted-foreground">
							{t("debug.profile.status", {
								level: profileLevel,
								total: snapshot.totals.total,
							})}
						</p>
						<SettingRow
							title={t("debug.profile.previewLevelUp")}
							description={t("debug.profile.previewLevelUpDesc")}
							action={
								<Button
									type="button"
									variant="secondary"
									onClick={() =>
										rendererIpc.debugPreviewLevelUp(profileLevel + 1)
									}
								>
									{t("debug.profile.previewLevelUp")}
								</Button>
							}
						/>
						<SettingRow
							title={t("debug.profile.plusOne")}
							description={t("debug.profile.plusOneDesc")}
							action={
								<Button
									type="button"
									variant="secondary"
									onClick={() =>
										rendererIpc.debugSetProfileLevel(profileLevel + 1, true)
									}
								>
									{t("debug.profile.plusOne")}
								</Button>
							}
						/>
						<SettingRow
							title={t("debug.profile.jump")}
							description={t("debug.profile.jumpDesc")}
							action={
								<div className="flex flex-wrap gap-2">
									{[1, 10, 50, 100].map((level) => (
										<Button
											key={level}
											type="button"
											variant="secondary"
											size="sm"
											onClick={() =>
												rendererIpc.debugSetProfileLevel(level, false)
											}
										>
											{level}
										</Button>
									))}
								</div>
							}
						/>
					</div>
				</SettingRow>
			</SettingPanel>

			<SettingPanel>
				<SettingRow
					title={t("debug.achievements.title")}
					description={t("debug.achievements.desc")}
				>
					<div className="space-y-3">
						<SettingRow
							title={t("debug.achievements.preview")}
							description={t("debug.achievements.previewDesc")}
							action={
								<Button
									type="button"
									variant="secondary"
									onClick={() => rendererIpc.debugPreviewAchievement()}
								>
									{t("debug.achievements.preview")}
								</Button>
							}
						/>
						<SettingRow
							title={t("debug.achievements.previewSummary")}
							description={t("debug.achievements.previewSummaryDesc")}
							action={
								<Button
									type="button"
									variant="secondary"
									onClick={() => rendererIpc.debugPreviewAchievementSummary(3)}
								>
									{t("debug.achievements.previewSummary")}
								</Button>
							}
						/>
					</div>
				</SettingRow>
			</SettingPanel>

			<SettingPanel>
				<SettingRow
					title={t("debug.trace.title")}
					description={t("debug.trace.desc")}
				>
					<div className="flex flex-col gap-2">
						<div className="flex flex-wrap gap-2">
							<Button
								type="button"
								variant="secondary"
								disabled={traceRecording}
								onClick={async () => {
									const result = await rendererIpc.startTraceRecording();
									if (result.status === "started") {
										setTraceRecording(true);
										const base = result.path
											? t("debug.trace.started", {
													path: result.path,
												})
											: t("debug.trace.startedNoPath");
										setTraceStatus(
											result.message ? `${base} — ${result.message}` : base,
										);
										return;
									}
									if (result.status === "cancelled") {
										setTraceStatus(t("debug.trace.cancelled"));
										return;
									}
									setTraceStatus(result.message || t("debug.trace.error"));
								}}
							>
								{t("debug.trace.start")}
							</Button>
							<Button
								type="button"
								variant="secondary"
								disabled={!traceRecording}
								onClick={async () => {
									const result = await rendererIpc.stopTraceRecording();
									setTraceRecording(false);
									if (result.status === "stopped") {
										setTraceStatus(t("debug.trace.stopped"));
										return;
									}
									setTraceStatus(result.message || t("debug.trace.error"));
								}}
							>
								{t("debug.trace.stop")}
							</Button>
						</div>
						<Reveal variant="fade" open={Boolean(traceStatus)}>
							{traceStatus ? (
								<p className="text-xs text-muted-foreground break-all">
									{traceStatus}
								</p>
							) : null}
						</Reveal>
					</div>
				</SettingRow>
			</SettingPanel>

			<SettingPanel>
				<SettingRow
					title={t("debug.onboarding.title")}
					description={t("debug.onboarding.desc")}
					action={
						<Button
							type="button"
							variant="secondary"
							onClick={() =>
								setPreferences((current) => ({
									...current,
									hasCompletedOnboarding: false,
								}))
							}
						>
							{t("reset.showOnboarding")}
						</Button>
					}
				/>
			</SettingPanel>
		</>
	);
}
