import { Monitor, Moon, Sun } from "lucide-react";
import {
	type KeyboardEvent,
	useCallback,
	useEffect,
	useId,
	useRef,
	useState,
} from "react";
import { Button } from "@/components/button";
import { useT } from "@/i18n";
import { cn } from "@/lib/utils";
import type { AppearancePreference } from "../../../../shared/preferences";
import {
	APPEARANCE_BUTTON_REM,
	APPEARANCE_OPTIONS,
	type AppearanceOption,
	appearanceButtonOffsetRem,
	appearanceClusterShiftRem,
	appearanceOptionIndex,
} from "../model/appearance-toggle";
import type { SetPreferences } from "../model/use-preferences";

const HINT_MS = 500;

const OPTION_ICONS = {
	light: Sun,
	system: Monitor,
	dark: Moon,
} as const;

interface AppearanceSelectProps {
	appearance: AppearancePreference;
	setPreferences: SetPreferences;
	variant?: "header" | "row";
}

function optionLabelKey(option: AppearanceOption): string {
	if (option === "light") return "common.appearance.light";
	if (option === "dark") return "common.appearance.night";
	return "common.appearance.system";
}

export function AppearanceSelect({
	appearance,
	setPreferences,
	variant = "header",
}: AppearanceSelectProps) {
	const t = useT();
	const hintId = useId();
	const rootRef = useRef<HTMLDivElement>(null);
	const hintTimerRef = useRef<number | null>(null);
	const ignoreClickRef = useRef(false);
	const [open, setOpen] = useState(false);
	const [hint, setHint] = useState<AppearanceOption | null>(null);
	const selectedIndex = appearanceOptionIndex(appearance);
	const clusterShiftRem = appearanceClusterShiftRem(selectedIndex, open);

	const clearHintTimer = useCallback(() => {
		if (hintTimerRef.current == null) return;
		window.clearTimeout(hintTimerRef.current);
		hintTimerRef.current = null;
	}, []);

	const hideHint = useCallback(() => {
		clearHintTimer();
		setHint(null);
	}, [clearHintTimer]);

	useEffect(() => () => clearHintTimer(), [clearHintTimer]);

	useEffect(() => {
		if (!open) return;
		const onDocumentPointerDown = (event: globalThis.PointerEvent) => {
			if (rootRef.current?.contains(event.target as Node)) return;
			setOpen(false);
			hideHint();
		};
		document.addEventListener("pointerdown", onDocumentPointerDown);
		return () =>
			document.removeEventListener("pointerdown", onDocumentPointerDown);
	}, [open, hideHint]);

	const commit = useCallback(
		(next: AppearancePreference) => {
			setPreferences((current) =>
				current.appearance === next
					? current
					: { ...current, appearance: next },
			);
		},
		[setPreferences],
	);

	const onChoose = (next: AppearanceOption) => {
		if (!open) {
			setOpen(true);
			return;
		}
		if (next !== appearance) commit(next);
		setOpen(false);
		hideHint();
	};

	const onGroupKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
		if (event.key === "Escape" && open) {
			event.preventDefault();
			setOpen(false);
			hideHint();
		}
	};

	const startHint = (option: AppearanceOption, fromHold: boolean) => {
		clearHintTimer();
		hintTimerRef.current = window.setTimeout(() => {
			hintTimerRef.current = null;
			setHint(option);
			if (fromHold) ignoreClickRef.current = true;
		}, HINT_MS);
	};

	return (
		<div
			ref={rootRef}
			role="radiogroup"
			aria-label={t("common.appearance.aria")}
			aria-orientation="horizontal"
			onKeyDown={onGroupKeyDown}
			className={cn(
				"relative h-9 w-9 overflow-visible",
				open && "z-20",
				variant === "row" && "mx-auto",
			)}
		>
			<div
				className="absolute inset-0 transition-transform duration-200 ease-in-out motion-reduce:transition-none"
				style={{ transform: `translateX(${clusterShiftRem}rem)` }}
			>
				{APPEARANCE_OPTIONS.map((option, index) => {
					const selected = option === appearance;
					const Icon = OPTION_ICONS[option];
					const label = t(optionLabelKey(option));
					const showHint = hint === option;
					const visible = open || selected;
					return (
						<Button
							key={option}
							type="button"
							role="radio"
							variant={selected ? "secondary" : "ghost"}
							size="icon"
							tabIndex={visible ? 0 : -1}
							aria-checked={selected}
							aria-hidden={visible ? undefined : true}
							aria-label={label}
							aria-expanded={selected ? open : undefined}
							aria-describedby={showHint ? hintId : undefined}
							onClick={(event) => {
								if (ignoreClickRef.current) {
									event.preventDefault();
									ignoreClickRef.current = false;
									return;
								}
								onChoose(option);
							}}
							onPointerDown={(event) => {
								ignoreClickRef.current = false;
								if (event.pointerType === "mouse") return;
								startHint(option, true);
							}}
							onPointerEnter={(event) => {
								if (event.pointerType !== "mouse") return;
								startHint(option, false);
							}}
							onPointerUp={hideHint}
							onPointerLeave={hideHint}
							onPointerCancel={hideHint}
							onBlur={hideHint}
							className={cn(
								"absolute top-0 rounded-full transition-[left,opacity,color,background-color] duration-200 ease-in-out motion-reduce:transition-none",
								selected ? "z-10" : "z-0",
								visible ? "opacity-100" : "pointer-events-none opacity-0",
							)}
							style={{
								left: `${appearanceButtonOffsetRem(index, selectedIndex, open)}rem`,
								width: `${APPEARANCE_BUTTON_REM}rem`,
								height: `${APPEARANCE_BUTTON_REM}rem`,
							}}
						>
							<Icon className="h-4 w-4" aria-hidden />
							{showHint ? (
								<span
									id={hintId}
									role="tooltip"
									className="absolute bottom-full left-1/2 z-20 mb-1 -translate-x-1/2 whitespace-nowrap rounded-md border border-border bg-popover px-2 py-0.5 text-2xs text-popover-foreground shadow-sm"
								>
									{label}
								</span>
							) : null}
						</Button>
					);
				})}
			</div>
		</div>
	);
}
