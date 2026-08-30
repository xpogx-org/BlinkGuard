import { type ReactNode, useEffect, useState } from "react";
import { Button } from "@/components/button";
import { SettingPanel } from "@/components/setting-panel";
import { SettingRow } from "@/components/setting-row";
import { useBlinkStats } from "@/features/statistics/model/use-blink-stats";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import type {
	BlinkRewardId,
	RewardCategory,
} from "../../../../shared/blink-rewards";
import type { RewardOffer } from "../../../../shared/blink-stats";

const CATEGORY_LABEL: Record<RewardCategory, string> = {
	cosmetic: "rewards.category.cosmetic",
	utility: "rewards.category.utility",
	meta: "rewards.category.meta",
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
	if (reward.id === "snoozeToken") {
		return t("rewards.stockProgress", {
			count: reward.charges,
			max: reward.maxPurchases ?? 2,
		});
	}
	if (reward.id === "cheer") {
		return t("rewards.purchaseCount", { count: reward.purchaseCount });
	}
	return null;
}

function RewardRow({
	reward,
	flashId,
	onBuy,
	onEquip,
	t,
}: {
	reward: RewardOffer;
	flashId: BlinkRewardId | null;
	onBuy: (id: BlinkRewardId) => void;
	onEquip: (reward: RewardOffer) => void;
	t: (key: string, vars?: Record<string, string | number>) => string;
}) {
	const description =
		reward.id === "shopDiscount"
			? t(reward.descriptionKey, { percent: reward.discountPercent })
			: t(reward.descriptionKey);
	const counter = rewardCounterLabel(reward, t);
	const showMax =
		reward.atMax && reward.id !== "streakShield" && reward.id !== "snoozeToken";

	let action: ReactNode;
	if (showMax) {
		action = (
			<span className="text-xs font-medium text-muted-foreground">
				{t("rewards.max")}
			</span>
		);
	} else if (reward.isEquipped) {
		action = (
			<span className="text-xs font-medium text-primary">
				{t("rewards.equipped")}
			</span>
		);
	} else if (reward.canEquip) {
		action = (
			<Button
				type="button"
				variant="secondary"
				size="sm"
				onClick={() => onEquip(reward)}
			>
				{t("rewards.equip")}
			</Button>
		);
	} else if (reward.owned && !reward.equipKind && reward.id !== "snoozeToken") {
		action = (
			<span className="text-xs font-medium text-muted-foreground">
				{reward.id === "streakShield" && reward.charges > 0
					? t("stats.streak.shieldReady")
					: t("rewards.owned")}
			</span>
		);
	} else if (!reward.canBuy && reward.owned && reward.id === "snoozeToken") {
		action = (
			<span className="text-xs font-medium text-muted-foreground">
				{t("rewards.max")}
			</span>
		);
	} else {
		action = (
			<Button
				type="button"
				variant="secondary"
				size="sm"
				disabled={!reward.canBuy}
				onClick={() => onBuy(reward.id)}
			>
				{t("rewards.buy", { cost: reward.cost })}
			</Button>
		);
	}

	return (
		<div
			className={cn(
				"flex flex-col gap-2 rounded-md border border-border bg-background px-3 py-2 sm:flex-row sm:items-center sm:justify-between",
				flashId === reward.id && "motion-flash ring-2 ring-primary/50",
			)}
		>
			<div className="min-w-0 flex-1">
				<div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
					<p className="text-sm font-medium text-foreground">
						{t(reward.titleKey)}
					</p>
					{counter ? (
						<span className="text-xs font-medium tabular-nums text-muted-foreground">
							{counter}
						</span>
					) : null}
					{reward.popupPresetId ? (
						<span
							className="inline-block h-3 w-3 shrink-0 rounded-full border border-border"
							style={{
								backgroundColor:
									reward.id === "popupPresetAurora" ? "#0c4a6e" : "#7c2d12",
							}}
							aria-hidden
						/>
					) : null}
				</div>
				<p className="text-xs text-muted-foreground">{description}</p>
			</div>
			<div className="shrink-0">{action}</div>
		</div>
	);
}

export function RewardsShopPanel() {
	const { t } = useI18n();
	const { snapshot, purchaseReward, equipCheerTheme, equipPopupPreset } =
		useBlinkStats();
	const { totals, rewards } = snapshot;
	const [flashId, setFlashId] = useState<BlinkRewardId | null>(null);

	useEffect(() => {
		if (!flashId) return;
		const timer = window.setTimeout(() => setFlashId(null), 400);
		return () => window.clearTimeout(timer);
	}, [flashId]);

	const handleBuy = (id: BlinkRewardId) => {
		purchaseReward(id);
		setFlashId(id);
	};

	const handleEquip = (reward: RewardOffer) => {
		if (reward.equipKind === "cheerTheme" && reward.cheerThemeId) {
			equipCheerTheme(reward.cheerThemeId);
			return;
		}
		if (reward.equipKind === "popupPreset" && reward.popupPresetId) {
			equipPopupPreset(reward.popupPresetId);
		}
	};

	let lastCategory: RewardCategory | null = null;

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
							const showCategory = reward.category !== lastCategory;
							lastCategory = reward.category;
							return (
								<div key={reward.id} className="space-y-2">
									{showCategory ? (
										<p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
											{t(CATEGORY_LABEL[reward.category])}
										</p>
									) : null}
									<RewardRow
										reward={reward}
										flashId={flashId}
										onBuy={handleBuy}
										onEquip={handleEquip}
										t={t}
									/>
								</div>
							);
						})}
					</div>
				</SettingRow>
			</SettingPanel>
		</>
	);
}
