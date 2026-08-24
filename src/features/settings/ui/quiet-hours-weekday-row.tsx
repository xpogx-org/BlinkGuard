import { Reveal } from "@/components/reveal";
import { ToggleSwitch } from "@/components/toggle-switch";
import { useT } from "@/i18n";
import type {
	QuietHoursDayOverride,
	WeekdayKey,
} from "../../../../shared/preferences";

interface QuietHoursWeekdayRowProps {
	weekday: WeekdayKey;
	override: QuietHoursDayOverride | undefined;
	defaultStart: string;
	defaultEnd: string;
	onChange: (next: QuietHoursDayOverride | undefined) => void;
}

export function QuietHoursWeekdayRow({
	weekday,
	override,
	defaultStart,
	defaultEnd,
	onChange,
}: QuietHoursWeekdayRowProps) {
	const t = useT();
	const dayLabel = t(`stats.weekday.${weekday}`);
	const isOverride = override?.mode === "off" || override?.mode === "custom";
	const isOff = override?.mode === "off";
	const customStart =
		override?.mode === "custom" ? override.start : defaultStart;
	const customEnd = override?.mode === "custom" ? override.end : defaultEnd;

	return (
		<div className="space-y-2 rounded-md border border-border/60 px-3 py-2">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<span className="min-w-[2.5rem] text-sm font-medium text-foreground">
					{dayLabel}
				</span>
				<div className="flex flex-wrap items-center gap-3">
					<div className="flex items-center gap-2 text-xs text-muted-foreground">
						<span>{t("quietHours.dayOverride")}</span>
						<ToggleSwitch
							aria-label={t("quietHours.dayOverrideAria", { day: dayLabel })}
							checked={isOverride}
							onChange={() => {
								if (isOverride) {
									onChange(undefined);
									return;
								}
								onChange({
									mode: "custom",
									start: defaultStart,
									end: defaultEnd,
								});
							}}
						/>
					</div>
					<Reveal open={isOverride}>
						<div className="flex items-center gap-2 text-xs text-muted-foreground">
							<span>{t("quietHours.dayOff")}</span>
							<ToggleSwitch
								aria-label={t("quietHours.dayOffAria", { day: dayLabel })}
								checked={isOff}
								onChange={() => {
									if (isOff) {
										onChange({
											mode: "custom",
											start: defaultStart,
											end: defaultEnd,
										});
										return;
									}
									onChange({ mode: "off" });
								}}
							/>
						</div>
					</Reveal>
					<Reveal open={!isOverride}>
						<span className="text-xs text-muted-foreground">
							{t("quietHours.dayInherit")}
						</span>
					</Reveal>
				</div>
			</div>
			<Reveal open={isOverride && !isOff}>
				<div className="flex flex-wrap items-center gap-3">
					<label className="flex items-center gap-2 text-sm text-muted-foreground">
						<span>{t("common.from")}</span>
						<input
							type="time"
							value={customStart}
							onChange={(event) =>
								onChange({
									mode: "custom",
									start: event.target.value,
									end: customEnd,
								})
							}
							className="rounded-md border border-border bg-background px-2 py-1 text-foreground"
						/>
					</label>
					<label className="flex items-center gap-2 text-sm text-muted-foreground">
						<span>{t("common.to")}</span>
						<input
							type="time"
							value={customEnd}
							onChange={(event) =>
								onChange({
									mode: "custom",
									start: customStart,
									end: event.target.value,
								})
							}
							className="rounded-md border border-border bg-background px-2 py-1 text-foreground"
						/>
					</label>
				</div>
			</Reveal>
		</div>
	);
}
