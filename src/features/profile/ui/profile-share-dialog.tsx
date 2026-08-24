import { useEffect, useState } from "react";
import { Button } from "@/components/button";
import { SettingPanel } from "@/components/setting-panel";
import { ToggleSwitch } from "@/components/toggle-switch";
import {
	type ProfileShareCardInput,
	renderProfileShareCard,
} from "@/features/profile/ui/profile-share-card";
import { useI18n } from "@/i18n";
import { usePresence } from "@/lib/use-presence";
import { cn } from "@/lib/utils";
import { t as translate } from "../../../../shared/i18n";
import { theme } from "../../../../shared/theme";

export type ProfileShareToggles = {
	title: boolean;
	tier: boolean;
	desc: boolean;
	blinks: boolean;
	streak: boolean;
	today: boolean;
	available: boolean;
	date: boolean;
	flair: boolean;
	achievements: boolean;
	dark: boolean;
};

export function defaultShareToggles(dark: boolean): ProfileShareToggles {
	return {
		title: true,
		tier: true,
		desc: false,
		blinks: true,
		streak: true,
		today: true,
		available: true,
		date: true,
		flair: true,
		achievements: true,
		dark,
	};
}

type ToggleKey = keyof Omit<ProfileShareToggles, "dark">;

export type ProfileShareDialogData = {
	level: number;
	titleKey: string;
	descKey: string;
	tierKey: string;
	lifetimeBlinks: number;
	streak: number;
	todayBlinks: number;
	availableBlinks: number;
	hasFlair: boolean;
	achievementsUnlocked: number;
	achievementsTotal: number;
	progressRatio: number;
	progressCurrent: number;
	progressNeeded: number;
};

type ProfileShareDialogProps = {
	open: boolean;
	data: ProfileShareDialogData;
	onClose: () => void;
	onSave: (bytes: Uint8Array) => Promise<void>;
};

function ToggleRow({
	label,
	checked,
	onChange,
}: {
	label: string;
	checked: boolean;
	onChange: () => void;
}) {
	return (
		<div className="flex items-center justify-between gap-3 py-1.5">
			<span className="text-sm">{label}</span>
			<ToggleSwitch aria-label={label} checked={checked} onChange={onChange} />
		</div>
	);
}

function buildCardInput(
	toggles: ProfileShareToggles,
	data: ProfileShareDialogData,
	t: (key: string, vars?: Record<string, string | number>) => string,
	locale: string,
): ProfileShareCardInput {
	const dateLabel = new Intl.DateTimeFormat(
		locale === "uk" ? "uk-UA" : "en-US",
		{ dateStyle: "medium" },
	).format(new Date());

	const stats = [];
	if (toggles.blinks) {
		stats.push({
			label: t("profile.share.card.blinksLabel"),
			value: String(data.lifetimeBlinks),
		});
	}
	if (toggles.streak) {
		stats.push({
			label: t("profile.share.card.streakLabel"),
			value: t("profile.share.card.streakValue", { n: data.streak }),
		});
	}
	if (toggles.today) {
		stats.push({
			label: t("profile.share.card.todayLabel"),
			value: String(data.todayBlinks),
		});
	}
	if (toggles.available) {
		stats.push({
			label: t("profile.share.card.availableLabel"),
			value: String(data.availableBlinks),
		});
	}
	if (toggles.achievements) {
		stats.push({
			label: t("profile.share.card.achievementsLabel"),
			value: t("achievements.badge", {
				unlocked: data.achievementsUnlocked,
				total: data.achievementsTotal,
			}),
		});
	}

	return {
		brand: t("profile.share.card.brand"),
		level: data.level,
		levelLabel: t("profile.share.card.level", { level: data.level }),
		title: toggles.title ? t(data.titleKey) : null,
		tier: toggles.tier ? t(data.tierKey) : null,
		desc: toggles.desc ? t(data.descKey) : null,
		stats,
		flairLabel: toggles.flair && data.hasFlair ? t("stats.flair.badge") : null,
		dateLabel: toggles.date ? dateLabel : null,
		progressRatio: data.progressRatio,
		progressCaption: t("profile.share.card.progress", {
			current: data.progressCurrent,
			needed: data.progressNeeded,
		}),
		tagline: t("profile.share.card.tagline"),
		dark: toggles.dark,
	};
}

export function ProfileShareDialog({
	open,
	data,
	onClose,
	onSave,
}: ProfileShareDialogProps) {
	const { t, locale } = useI18n();
	const [toggles, setToggles] = useState<ProfileShareToggles>(() =>
		defaultShareToggles(
			typeof document !== "undefined" &&
				document.documentElement.classList.contains("dark"),
		),
	);
	const [previewUrl, setPreviewUrl] = useState<string | null>(null);
	const [previewBusy, setPreviewBusy] = useState(false);
	const [saveBusy, setSaveBusy] = useState(false);
	const [lastBytes, setLastBytes] = useState<Uint8Array | null>(null);
	/** Snapshot at open — ignore live blink/stats updates while the dialog is open. */
	const [frozenData, setFrozenData] = useState<ProfileShareDialogData | null>(
		null,
	);

	const { mounted, exiting } = usePresence(open);

	useEffect(() => {
		if (!open) return;
		setToggles(
			defaultShareToggles(document.documentElement.classList.contains("dark")),
		);
	}, [open]);

	useEffect(() => {
		if (!mounted) setFrozenData(null);
	}, [mounted]);

	useEffect(() => {
		if (!open) return;
		setFrozenData((prev) => prev ?? data);
	}, [open, data]);

	useEffect(() => {
		if (!open) return;
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape" && !saveBusy) onClose();
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [open, onClose, saveBusy]);

	useEffect(() => {
		if (!open || !frozenData) return;
		let cancelled = false;
		setPreviewBusy(true);
		const input = buildCardInput(
			toggles,
			frozenData,
			(key, vars) => translate(locale, key, vars),
			locale,
		);
		void renderProfileShareCard(input)
			.then((result) => {
				if (cancelled) return;
				setPreviewUrl(result.dataUrl);
				setLastBytes(result.bytes);
			})
			.catch(() => {
				if (cancelled) return;
				setPreviewUrl(null);
				setLastBytes(null);
			})
			.finally(() => {
				if (!cancelled) setPreviewBusy(false);
			});
		return () => {
			cancelled = true;
		};
	}, [open, toggles, locale, frozenData]);

	if (!mounted || !frozenData) return null;

	const titleId = "profile-share-title";

	const flip = (key: ToggleKey | "dark") => {
		setToggles((current) => ({ ...current, [key]: !current[key] }));
	};

	const handleSave = async () => {
		if (saveBusy || !lastBytes) return;
		setSaveBusy(true);
		try {
			await onSave(lastBytes);
		} finally {
			setSaveBusy(false);
		}
	};

	const optionRows: { key: ToggleKey; label: string; show?: boolean }[] = [
		{ key: "title", label: t("profile.share.toggle.title") },
		{ key: "tier", label: t("profile.share.toggle.tier") },
		{ key: "desc", label: t("profile.share.toggle.desc") },
		{ key: "blinks", label: t("profile.share.toggle.blinks") },
		{ key: "streak", label: t("profile.share.toggle.streak") },
		{ key: "today", label: t("profile.share.toggle.today") },
		{ key: "available", label: t("profile.share.toggle.available") },
		{ key: "date", label: t("profile.share.toggle.date") },
		{
			key: "flair",
			label: t("profile.share.toggle.flair"),
			show: frozenData.hasFlair,
		},
		{ key: "achievements", label: t("profile.share.toggle.achievements") },
	];

	return (
		<div
			className={cn(
				"fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm",
				exiting ? theme.recipe.exit : theme.recipe.overlay,
			)}
			role="dialog"
			aria-modal="true"
			aria-labelledby={titleId}
			onMouseDown={(event) => {
				if (event.target === event.currentTarget && !saveBusy) onClose();
			}}
		>
			<SettingPanel
				className={cn(
					"flex max-h-[min(92vh,900px)] w-full max-w-3xl flex-col gap-4 overflow-y-auto [scrollbar-gutter:stable] shadow-lg",
					exiting ? theme.recipe.exit : theme.recipe.dialog,
				)}
			>
				<div className="space-y-1">
					<h2 id={titleId} className="text-xl font-semibold tracking-tight">
						{t("profile.share.dialogTitle")}
					</h2>
					<p className="text-sm text-muted-foreground">
						{t("profile.share.dialogDesc")}
					</p>
				</div>

				<div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_minmax(220px,0.9fr)]">
					<div className="space-y-2">
						<p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
							{t("profile.share.preview")}
						</p>
						<div
							className={cn(
								"relative overflow-hidden rounded-lg border border-border bg-muted/40",
								"flex max-h-[min(62vh,560px)] items-center justify-center p-2",
							)}
						>
							{previewUrl ? (
								<img
									src={previewUrl}
									alt={t("profile.share.previewAlt")}
									className="max-h-[min(58vh,520px)] w-full object-contain"
								/>
							) : (
								<div className="flex h-full items-center justify-center p-4 text-sm text-muted-foreground">
									{previewBusy
										? t("profile.share.busy")
										: t("profile.share.error", {
												message: "preview",
											})}
								</div>
							)}
							{previewBusy && previewUrl ? (
								<div className="absolute inset-0 bg-background/30" />
							) : null}
						</div>
					</div>

					<div className="space-y-1">
						<p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
							{t("profile.share.options")}
						</p>
						{optionRows
							.filter((row) => row.show !== false)
							.map((row) => (
								<ToggleRow
									key={row.key}
									label={row.label}
									checked={toggles[row.key]}
									onChange={() => flip(row.key)}
								/>
							))}
						<div className="my-2 border-t border-border" />
						<ToggleRow
							label={t("profile.share.toggle.dark")}
							checked={toggles.dark}
							onChange={() => flip("dark")}
						/>
					</div>
				</div>

				<div className="flex justify-end gap-2">
					<Button
						type="button"
						variant="ghost"
						disabled={saveBusy}
						onClick={onClose}
					>
						{t("profile.share.cancel")}
					</Button>
					<Button
						type="button"
						disabled={saveBusy || !lastBytes || previewBusy}
						onClick={() => void handleSave()}
					>
						{saveBusy ? t("profile.share.busy") : t("profile.share.save")}
					</Button>
				</div>
			</SettingPanel>
		</div>
	);
}
