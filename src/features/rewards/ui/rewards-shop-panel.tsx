import { useEffect, useState } from "react";
import { Button } from "@/components/button";
import { SettingPanel } from "@/components/setting-panel";
import { SettingRow } from "@/components/setting-row";
import { useBlinkStats } from "@/features/statistics/model/use-blink-stats";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import type { BlinkRewardId } from "../../../../shared/blink-rewards";
import type { RewardOffer } from "../../../../shared/blink-stats";

const REWARD_COPY: Record<
	BlinkRewardId,
	{ title: string; description: string }
> = {
	cheer: {
		title: "rewards.cheer",
		description: "rewards.cheerDesc",
	},
	statsFlair: {
		title: "rewards.statsFlair",
		description: "rewards.statsFlairDesc",
	},
	streakShield: {
		title: "rewards.streakShield",
		description: "rewards.streakShieldDesc",
	},
	shopDiscount: {
		title: "rewards.shopDiscount",
		description: "rewards.shopDiscountDesc",
	},
};

function rewardCounterLabel(
	reward: RewardOffer,
	t: (key: string, vars?: Record<string, string | number>) => string,
): string | null {
	if (reward.id === "statsFlair") return null;
	if (reward.id === "shopDiscount") {
		if (reward.atMax) return t("rewards.max");
		return t("rewards.discountProgress", {
			count: reward.purchaseCount,
			max: reward.maxPurchases ?? 10,
		});
	}
	return t("rewards.purchaseCount", { count: reward.purchaseCount });
}

export function RewardsShopPanel() {
	const { t } = useI18n();
	const { snapshot, purchaseReward } = useBlinkStats();
	const { totals, rewards } = snapshot;
	const [flashId, setFlashId] = useState<BlinkRewardId | null>(null);

	useEffect(() => {
		if (!flashId) return;
		const timer = window.setTimeout(() => setFlashId(null), 400);
		return () => window.clearTimeout(timer);
	}, [flashId]);

	return (
		<>
			<SettingPanel>
				<SettingRow
					title={t("rewards.balance")}
					description={t("rewards.balanceDesc")}
				>
					<div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
						<div className="rounded-md border border-border bg-background px-3 py-2">
							<p className="text-xs text-muted-foreground">
								{t("stats.available")}
							</p>
							<p className="mt-0.5 text-lg font-semibold tabular-nums tracking-tight">
								{totals.available}
							</p>
						</div>
						<div className="rounded-md border border-border bg-background px-3 py-2">
							<p className="text-xs text-muted-foreground">
								{t("stats.spent")}
							</p>
							<p className="mt-0.5 text-lg font-semibold tabular-nums tracking-tight">
								{totals.spent}
							</p>
						</div>
						<div className="rounded-md border border-border bg-background px-3 py-2">
							<p className="text-xs text-muted-foreground">
								{t("stats.total")}
							</p>
							<p className="mt-0.5 text-lg font-semibold tabular-nums tracking-tight">
								{totals.total}
							</p>
						</div>
					</div>
				</SettingRow>
			</SettingPanel>

			<SettingPanel>
				<SettingRow
					title={t("rewards.shop")}
					description={t("rewards.shopDesc")}
				>
					<div className="space-y-3">
						{rewards.map((reward) => {
							const copy = REWARD_COPY[reward.id];
							const description =
								reward.id === "shopDiscount"
									? t(copy.description, {
											percent: reward.discountPercent,
										})
									: t(copy.description);
							const counter = rewardCounterLabel(reward, t);
							const showOwned =
								reward.owned ||
								(reward.id === "streakShield" && reward.charges > 0);
							const showMax = reward.id === "shopDiscount" && reward.atMax;

							return (
								<div
									key={reward.id}
									className={cn(
										"flex flex-col gap-2 rounded-md border border-border bg-background px-3 py-2 sm:flex-row sm:items-center sm:justify-between",
										flashId === reward.id &&
											"motion-flash ring-2 ring-primary/50",
									)}
								>
									<div>
										<div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
											<p className="text-sm font-medium text-foreground">
												{t(copy.title)}
											</p>
											{counter ? (
												<span className="text-xs font-medium tabular-nums text-muted-foreground">
													{counter}
												</span>
											) : null}
										</div>
										<p className="text-xs text-muted-foreground">
											{description}
										</p>
									</div>
									{showMax ? (
										<span className="text-xs font-medium text-muted-foreground">
											{t("rewards.max")}
										</span>
									) : showOwned ? (
										<span className="text-xs font-medium text-muted-foreground">
											{reward.id === "streakShield" && reward.charges > 0
												? t("stats.streak.shieldReady")
												: t("rewards.owned")}
										</span>
									) : (
										<Button
											type="button"
											variant="secondary"
											size="sm"
											disabled={!reward.canBuy}
											onClick={() => {
												purchaseReward(reward.id);
												setFlashId(reward.id);
											}}
										>
											{t("rewards.buy", { cost: reward.cost })}
										</Button>
									)}
								</div>
							);
						})}
					</div>
				</SettingRow>
			</SettingPanel>
		</>
	);
}
