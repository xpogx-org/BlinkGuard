import {
	Activity,
	Award,
	Calendar,
	CalendarDays,
	ChevronDown,
	Clock,
	Crosshair,
	Eye,
	Flame,
	Gem,
	type LucideIcon,
	Medal,
	PartyPopper,
	Play,
	Sparkles,
	Sun,
	Target,
	TrendingUp,
	Trophy,
	Zap,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Badge } from "@/components/badge";
import { SettingGrid } from "@/components/setting-grid";
import { SettingPanel } from "@/components/setting-panel";
import { SettingRow } from "@/components/setting-row";
import { SummaryStat } from "@/components/summary-stat";
import { useBlinkStats } from "@/features/statistics/model/use-blink-stats";
import { useT } from "@/i18n";
import { cn } from "@/lib/utils";
import {
	ACHIEVEMENT_CATEGORIES,
	ACHIEVEMENT_IDS_BY_CATEGORY,
	ACHIEVEMENTS,
	type AchievementCategory,
	type AchievementIconName,
	type AchievementId,
	type AchievementProgress,
	achievementDescKey,
	achievementTitleKey,
} from "../../../../shared/achievements";
import type { TranslateVars } from "../../../../shared/i18n";

const ICONS: Record<AchievementIconName, LucideIcon> = {
	eye: Eye,
	play: Play,
	sparkles: Sparkles,
	activity: Activity,
	trendingUp: TrendingUp,
	zap: Zap,
	trophy: Trophy,
	award: Award,
	medal: Medal,
	gem: Gem,
	flame: Flame,
	calendar: Calendar,
	calendarDays: CalendarDays,
	target: Target,
	clock: Clock,
	sun: Sun,
	partyPopper: PartyPopper,
	crosshair: Crosshair,
};

type Translate = (key: string, vars?: TranslateVars) => string;

function progressLabel(
	id: AchievementId,
	current: number,
	target: number,
	t: Translate,
): string {
	if (id === "tracking10h") {
		const hours = Math.min(10, Math.floor(current / 3_600_000));
		return t("achievements.progressHours", { current: hours, target: 10 });
	}
	return t("achievements.progress", { current, target });
}

function AchievementCard({
	id,
	unlocked,
	progress,
	t,
	celebrate,
}: {
	id: AchievementId;
	unlocked: boolean;
	progress: AchievementProgress | undefined;
	t: Translate;
	celebrate?: boolean;
}) {
	const Icon = ICONS[ACHIEVEMENTS[id].icon];
	const ratio =
		progress && progress.target > 0
			? Math.min(1, progress.current / progress.target)
			: 0;

	return (
		<div
			className={cn(
				"rounded-md border px-3 py-3",
				unlocked
					? "border-primary/40 bg-primary/10"
					: "border-border bg-background",
				celebrate && "motion-unlock",
			)}
		>
			<div className="flex items-start gap-3">
				<span
					className={cn(
						"mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border",
						unlocked
							? "border-primary/40 text-primary"
							: "border-border text-muted-foreground",
					)}
				>
					<Icon className="h-4 w-4" aria-hidden />
				</span>
				<div className="min-w-0 flex-1">
					<p className="text-sm font-medium">{t(achievementTitleKey(id))}</p>
					<p className="mt-1 text-sm text-muted-foreground">
						{t(achievementDescKey(id))}
					</p>
					{!unlocked && progress ? (
						<div className="mt-2">
							<div className="mb-1 flex justify-between gap-2 text-xs text-muted-foreground">
								<span>
									{progressLabel(id, progress.current, progress.target, t)}
								</span>
								<span className="tabular-nums">{Math.round(ratio * 100)}%</span>
							</div>
							<div className="h-1.5 overflow-hidden rounded-full bg-muted">
								<div
									className="h-full rounded-full bg-primary transition-[width] duration-300 ease-out"
									style={{ width: `${ratio * 100}%` }}
								/>
							</div>
						</div>
					) : null}
					{!unlocked && !progress ? (
						<p className="mt-1 text-xs text-muted-foreground">
							{t("achievements.locked")}
						</p>
					) : null}
				</div>
			</div>
		</div>
	);
}

export function AchievementsPanel() {
	const t = useT();
	const { snapshot } = useBlinkStats();
	const unlocked = new Set(snapshot.unlockedAchievementIds);
	const [collapsed, setCollapsed] = useState<ReadonlySet<AchievementCategory>>(
		() => new Set(),
	);
	const seenUnlocked = useRef<Set<string> | null>(null);
	const [justUnlocked, setJustUnlocked] = useState<ReadonlySet<string>>(
		() => new Set(),
	);

	useEffect(() => {
		const current = new Set(snapshot.unlockedAchievementIds);
		if (seenUnlocked.current === null) {
			seenUnlocked.current = current;
			return;
		}
		const newly = [...current].filter((id) => !seenUnlocked.current?.has(id));
		seenUnlocked.current = current;
		if (newly.length === 0) return;
		setJustUnlocked(new Set(newly));
		const timer = window.setTimeout(() => setJustUnlocked(new Set()), 800);
		return () => window.clearTimeout(timer);
	}, [snapshot.unlockedAchievementIds]);

	const toggleGroup = (category: AchievementCategory) => {
		setCollapsed((current) => {
			const next = new Set(current);
			if (next.has(category)) next.delete(category);
			else next.add(category);
			return next;
		});
	};

	return (
		<>
			<SettingPanel>
				<SettingRow
					title={t("achievements.hero.title")}
					description={t("achievements.hero.desc")}
				>
					<SummaryStat
						label={t("achievements.stat.unlocked")}
						value={t("achievements.badge", {
							unlocked: snapshot.achievementsUnlocked,
							total: snapshot.achievementsTotal,
						})}
					/>
				</SettingRow>
			</SettingPanel>

			{ACHIEVEMENT_CATEGORIES.map((category) => {
				const ids = ACHIEVEMENT_IDS_BY_CATEGORY[category];
				const unlockedCount = ids.filter((id) => unlocked.has(id)).length;
				const isOpen = !collapsed.has(category);
				const panelId = `achievements-group-${category}`;
				const categoryLabel = t(`achievements.category.${category}`);

				return (
					<SettingPanel key={category}>
						<button
							type="button"
							className="flex w-full items-center gap-2 rounded-md text-left outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
							aria-expanded={isOpen}
							aria-controls={panelId}
							aria-label={t("achievements.group.aria", {
								category: categoryLabel,
								unlocked: unlockedCount,
								total: ids.length,
							})}
							onClick={() => toggleGroup(category)}
						>
							<span className="min-w-0 flex-1 text-sm font-medium text-foreground">
								{categoryLabel}
							</span>
							<Badge className="tabular-nums">
								{t("achievements.badge", {
									unlocked: unlockedCount,
									total: ids.length,
								})}
							</Badge>
							<ChevronDown
								className={cn(
									"h-4 w-4 shrink-0 text-muted-foreground transition-transform",
									isOpen && "rotate-180",
								)}
								aria-hidden
							/>
						</button>
						<div
							id={panelId}
							aria-hidden={!isOpen}
							className={cn(
								"grid transition-[grid-template-rows] duration-200 ease-out",
								isOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
							)}
						>
							<div className="overflow-hidden">
								<div className="mt-4">
									<SettingGrid>
										{ids.map((id) => (
											<AchievementCard
												key={id}
												id={id}
												unlocked={unlocked.has(id)}
												progress={snapshot.achievementProgress[id]}
												t={t}
												celebrate={justUnlocked.has(id)}
											/>
										))}
									</SettingGrid>
								</div>
							</div>
						</div>
					</SettingPanel>
				);
			})}
		</>
	);
}
