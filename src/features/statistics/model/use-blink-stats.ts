import { useEffect, useState } from "react";
import { useT } from "@/i18n";
import { rendererIpc } from "@/shared/ipc/renderer-ipc";
import type { BlinkRewardId } from "../../../../shared/blink-rewards";
import {
	type BlinkStatsSnapshot,
	DEFAULT_BLINK_STATS,
	toBlinkStatsSnapshot,
} from "../../../../shared/blink-stats";

const emptySnapshot = (): BlinkStatsSnapshot =>
	toBlinkStatsSnapshot(DEFAULT_BLINK_STATS);

export function useBlinkStats() {
	const t = useT();
	const [snapshot, setSnapshot] = useState<BlinkStatsSnapshot>(emptySnapshot);

	useEffect(() => {
		const unsubscribe = rendererIpc.onBlinkStats(setSnapshot);
		rendererIpc.subscribeBlinkStats();
		return () => {
			unsubscribe();
			rendererIpc.unsubscribeBlinkStats();
		};
	}, []);

	const clearStatistics = () => {
		if (window.confirm(t("stats.clearConfirm"))) {
			rendererIpc.resetBlinkStats();
		}
	};

	const purchaseReward = (rewardId: BlinkRewardId) => {
		rendererIpc.spendBlinkReward(rewardId);
	};

	const equipCheerTheme = (theme: string) => {
		rendererIpc.equipCheerTheme(theme);
	};

	const equipPopupPreset = (presetId: string) => {
		rendererIpc.equipPopupPreset(presetId);
	};

	const clearPopupPreset = () => {
		rendererIpc.equipPopupPreset("custom");
	};

	return {
		snapshot,
		clearStatistics,
		purchaseReward,
		equipCheerTheme,
		equipPopupPreset,
		clearPopupPreset,
	};
}
