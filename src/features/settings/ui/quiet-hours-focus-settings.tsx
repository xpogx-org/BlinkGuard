import {
	AppWindow,
	ChevronDown,
	Gamepad2,
	Moon,
	Plus,
	Trash2,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/button";
import { Reveal } from "@/components/reveal";
import { SettingPanel } from "@/components/setting-panel";
import { SettingRow } from "@/components/setting-row";
import { ToggleSwitch } from "@/components/toggle-switch";
import { useT } from "@/i18n";
import { rendererIpc } from "@/shared/ipc/renderer-ipc";
import {
	emptyPauseAppPicker,
	PAUSE_APP_RULES_MAX,
	type PauseAppPickerPayload,
	type PauseAppRule,
	QUIET_HOURS_WEEKDAY_KEYS,
	type QuietHoursDayOverride,
	type WeekdayKey,
} from "../../../../shared/preferences";
import {
	type FocusPauseStatePayload,
	pauseStatusMessageKey,
} from "../../../../shared/session-pause-status";
import { theme } from "../../../../shared/theme";
import type { SettingsPreferences } from "../model/preferences";
import type { SetPreferences } from "../model/use-preferences";
import { QuietHoursWeekdayRow } from "./quiet-hours-weekday-row";

interface QuietHoursFocusSettingsProps {
	preferences: SettingsPreferences;
	setPreferences: SetPreferences;
}

function sameRule(a: PauseAppRule, b: PauseAppRule): boolean {
	return (
		a.processName.trim().toLowerCase() === b.processName.trim().toLowerCase() &&
		a.windowTitle.trim().toLowerCase() === b.windowTitle.trim().toLowerCase()
	);
}

function processOnlyRule(rule: PauseAppRule): PauseAppRule {
	const processName = rule.processName.trim();
	return {
		processName,
		windowTitle: processName ? "" : rule.windowTitle.trim(),
	};
}

function runningOptionValue(rule: PauseAppRule): string {
	return `${rule.processName}\n${rule.windowTitle}`;
}

function runningOptionLabel(rule: PauseAppRule): string {
	const title = rule.windowTitle.trim();
	return title ? `${rule.processName} — ${title}` : rule.processName;
}

export function QuietHoursFocusSettings({
	preferences,
	setPreferences,
}: QuietHoursFocusSettingsProps) {
	const t = useT();
	const [pauseState, setPauseState] = useState<FocusPauseStatePayload | null>(
		null,
	);
	const [picker, setPicker] =
		useState<PauseAppPickerPayload>(emptyPauseAppPicker);
	const [weekdaysOpen, setWeekdaysOpen] = useState(false);

	useEffect(
		() => rendererIpc.onFocusPauseState((payload) => setPauseState(payload)),
		[],
	);

	useEffect(() => {
		let cancelled = false;
		const refresh = () => {
			void rendererIpc.listPauseAppCandidates().then((payload) => {
				if (!cancelled) setPicker(payload);
			});
		};
		refresh();
		window.addEventListener("focus", refresh);
		return () => {
			cancelled = true;
			window.removeEventListener("focus", refresh);
		};
	}, []);

	const statusKey = pauseState ? pauseStatusMessageKey(pauseState) : null;
	const statusLabel = statusKey ? t(statusKey) : null;

	const fullscreenUnsupported =
		pauseState?.fullscreenDetectionSupported === false;
	const rules = preferences.pauseAppRules;
	const canAddRule =
		!fullscreenUnsupported && rules.length < PAUSE_APP_RULES_MAX;
	const lastFocused = picker.lastFocused
		? processOnlyRule(picker.lastFocused)
		: null;
	const lastFocusedName = lastFocused?.processName || lastFocused?.windowTitle;

	const addFilledRule = (draft: PauseAppRule) => {
		const nextRule = processOnlyRule(draft);
		if (!nextRule.processName && !nextRule.windowTitle) return;
		setPreferences((current) => {
			if (current.pauseAppRules.length >= PAUSE_APP_RULES_MAX) return current;
			if (current.pauseAppRules.some((rule) => sameRule(rule, nextRule))) {
				return current;
			}
			return {
				...current,
				pauseAppRules: [...current.pauseAppRules, nextRule],
			};
		});
	};

	const addRule = () => {
		setPreferences((current) => {
			if (current.pauseAppRules.length >= PAUSE_APP_RULES_MAX) return current;
			return {
				...current,
				pauseAppRules: [
					...current.pauseAppRules,
					{ processName: "", windowTitle: "" },
				],
			};
		});
	};

	const updateRule = (
		index: number,
		field: keyof PauseAppRule,
		value: string,
	) => {
		setPreferences((current) => {
			const next = [...current.pauseAppRules];
			const currentRule = next[index];
			if (!currentRule) return current;
			next[index] = { ...currentRule, [field]: value };
			return { ...current, pauseAppRules: next };
		});
	};

	const removeRule = (index: number) => {
		setPreferences((current) => ({
			...current,
			pauseAppRules: current.pauseAppRules.filter((_, i) => i !== index),
		}));
	};

	const setWeekdayOverride = (
		weekday: WeekdayKey,
		next: QuietHoursDayOverride | undefined,
	) => {
		setPreferences((current) => {
			const map = { ...current.quietHoursByWeekday };
			if (!next || next.mode === "default") {
				delete map[weekday];
			} else {
				map[weekday] = next;
			}
			return { ...current, quietHoursByWeekday: map };
		});
	};

	return (
		<div className="flex flex-col gap-4">
			<SettingPanel>
				<SettingRow
					title={
						<>
							<Moon className="h-4 w-4 text-muted-foreground" aria-hidden />
							{t("quietHours.title")}
						</>
					}
					description={t("quietHours.description")}
					action={
						<ToggleSwitch
							aria-label={t("quietHours.toggleAria")}
							checked={preferences.quietHoursEnabled}
							onChange={() =>
								setPreferences((current) => ({
									...current,
									quietHoursEnabled: !current.quietHoursEnabled,
								}))
							}
						/>
					}
				>
					<Reveal open={preferences.quietHoursEnabled}>
						<div className="space-y-3">
							<div className="flex flex-wrap items-center gap-3">
								<label className="flex items-center gap-2 text-sm text-muted-foreground">
									<span>{t("common.from")}</span>
									<input
										type="time"
										value={preferences.quietHoursStart}
										onChange={(event) =>
											setPreferences((current) => ({
												...current,
												quietHoursStart: event.target.value,
											}))
										}
										className="rounded-md border border-border bg-background px-2 py-1 text-foreground"
									/>
								</label>
								<label className="flex items-center gap-2 text-sm text-muted-foreground">
									<span>{t("common.to")}</span>
									<input
										type="time"
										value={preferences.quietHoursEnd}
										onChange={(event) =>
											setPreferences((current) => ({
												...current,
												quietHoursEnd: event.target.value,
											}))
										}
										className="rounded-md border border-border bg-background px-2 py-1 text-foreground"
									/>
								</label>
							</div>
							<div className="flex items-center justify-between gap-2 border-t border-border pt-3">
								<div className="text-xs font-medium text-muted-foreground">
									{t("quietHours.weekdays")}
								</div>
								<Button
									type="button"
									size="sm"
									variant="secondary"
									aria-expanded={weekdaysOpen}
									onClick={() => setWeekdaysOpen((open) => !open)}
								>
									<span className="inline-grid grid-cols-1 grid-rows-1 place-items-center">
										<span
											className="invisible col-start-1 row-start-1 whitespace-nowrap"
											aria-hidden
										>
											{t("quietHours.showWeekdays")}
										</span>
										<span
											className="invisible col-start-1 row-start-1 whitespace-nowrap"
											aria-hidden
										>
											{t("quietHours.hideWeekdays")}
										</span>
										<span className="col-start-1 row-start-1 whitespace-nowrap">
											{weekdaysOpen
												? t("quietHours.hideWeekdays")
												: t("quietHours.showWeekdays")}
										</span>
									</span>
								</Button>
							</div>
							<Reveal open={weekdaysOpen}>
								<div className="space-y-2">
									{QUIET_HOURS_WEEKDAY_KEYS.map((weekday) => (
										<QuietHoursWeekdayRow
											key={weekday}
											weekday={weekday}
											override={preferences.quietHoursByWeekday[weekday]}
											defaultStart={preferences.quietHoursStart}
											defaultEnd={preferences.quietHoursEnd}
											onChange={(next) => setWeekdayOverride(weekday, next)}
										/>
									))}
								</div>
							</Reveal>
						</div>
					</Reveal>
				</SettingRow>
			</SettingPanel>

			<SettingPanel>
				<SettingRow
					title={
						<>
							<Gamepad2 className="h-4 w-4 text-muted-foreground" aria-hidden />
							{t("fullscreen.title")}
						</>
					}
					description={
						fullscreenUnsupported
							? t("fullscreen.unsupportedDescription")
							: t("fullscreen.description")
					}
					action={
						<ToggleSwitch
							aria-label={t("fullscreen.toggleAria")}
							checked={preferences.pauseOnFullscreen}
							disabled={fullscreenUnsupported}
							onChange={() =>
								setPreferences((current) => ({
									...current,
									pauseOnFullscreen: !current.pauseOnFullscreen,
								}))
							}
						/>
					}
				/>
			</SettingPanel>

			<SettingPanel>
				<SettingRow
					title={
						<>
							<AppWindow
								className="h-4 w-4 text-muted-foreground"
								aria-hidden
							/>
							{t("appRules.title")}
						</>
					}
					description={
						fullscreenUnsupported
							? t("appRules.unsupportedDescription")
							: t("appRules.description")
					}
				>
					<div className="space-y-3">
						{fullscreenUnsupported ? null : (
							<div className="space-y-2">
								<div className="space-y-1">
									<Button
										type="button"
										size="sm"
										variant="secondary"
										disabled={!canAddRule || !lastFocused}
										onClick={() => lastFocused && addFilledRule(lastFocused)}
									>
										<Plus className="h-3 w-3" aria-hidden />
										{lastFocusedName
											? t("appRules.addLastFocusedNamed", {
													name: lastFocusedName,
												})
											: t("appRules.addLastFocused")}
									</Button>
									{lastFocused ? null : (
										<p className="text-xs text-muted-foreground">
											{t("appRules.addLastFocusedEmpty")}
										</p>
									)}
								</div>
								<label className="block space-y-1">
									<span className="text-xs text-muted-foreground">
										{t("appRules.runningLabel")}
									</span>
									<div className="relative">
										<select
											aria-label={t("appRules.runningAria")}
											value=""
											disabled={!canAddRule || picker.running.length === 0}
											onFocus={() => {
												void rendererIpc
													.listPauseAppCandidates()
													.then(setPicker);
											}}
											onChange={(event) => {
												const picked = picker.running.find(
													(app) =>
														runningOptionValue(app) === event.target.value,
												);
												if (picked) addFilledRule(picked);
											}}
											className="w-full appearance-none rounded-md border border-border bg-background py-1.5 pl-2.5 pr-9 text-sm text-foreground disabled:opacity-50"
										>
											<option value="">
												{t("appRules.runningPlaceholder")}
											</option>
											{picker.running.map((app) => (
												<option
													key={`${app.processName.toLowerCase()}\0${app.windowTitle.toLowerCase()}`}
													value={runningOptionValue(app)}
												>
													{runningOptionLabel(app)}
												</option>
											))}
										</select>
										<ChevronDown
											className="pointer-events-none absolute top-1/2 right-2.5 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
											aria-hidden
										/>
									</div>
								</label>
								{picker.running.length === 0 ? (
									<p className="text-xs text-muted-foreground">
										{t("appRules.runningEmpty")}
									</p>
								) : null}
								<p className="text-xs text-muted-foreground">
									{t("appRules.manual")}
								</p>
							</div>
						)}
						{rules.map((rule, index) => (
							// biome-ignore lint/suspicious/noArrayIndexKey: editable prefs rows use index as identity
							<div key={index} className="flex flex-wrap items-start gap-2">
								<label className="min-w-[8rem] flex-1 space-y-1">
									<span className="text-xs text-muted-foreground">
										{t("appRules.processLabel")}
									</span>
									<input
										value={rule.processName}
										disabled={fullscreenUnsupported}
										onChange={(event) =>
											updateRule(index, "processName", event.target.value)
										}
										className="w-full rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground disabled:opacity-50"
									/>
								</label>
								<label className="min-w-[8rem] flex-1 space-y-1">
									<span className="text-xs text-muted-foreground">
										{t("appRules.titleLabel")}
									</span>
									<input
										value={rule.windowTitle}
										disabled={fullscreenUnsupported}
										onChange={(event) =>
											updateRule(index, "windowTitle", event.target.value)
										}
										className="w-full rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground disabled:opacity-50"
									/>
								</label>
								<Button
									type="button"
									size="icon"
									variant="ghost"
									className="mt-5 h-8 w-8 shrink-0"
									aria-label={t("appRules.removeAria", { n: index + 1 })}
									onClick={() => removeRule(index)}
								>
									<Trash2 className="h-3.5 w-3.5" aria-hidden />
								</Button>
							</div>
						))}
						<Button
							type="button"
							size="sm"
							variant="secondary"
							disabled={!canAddRule}
							onClick={addRule}
						>
							<Plus className="h-3 w-3" aria-hidden />
							{t("appRules.add")}
						</Button>
						{!fullscreenUnsupported &&
						rules.length > 0 &&
						pauseState?.reason !== "app-rule" ? (
							<p className="text-xs text-muted-foreground">
								{t("appRules.foregroundHint")}
							</p>
						) : null}
					</div>
				</SettingRow>
			</SettingPanel>

			{statusLabel ? (
				<p
					className={`rounded-md border px-3 py-2 text-sm ${theme.recipe.warningSurface}`}
					role="status"
				>
					{statusLabel}
				</p>
			) : null}
		</div>
	);
}
