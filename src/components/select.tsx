import { Check, ChevronDown } from "lucide-react";
import {
	type KeyboardEvent,
	useCallback,
	useEffect,
	useId,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { createPortal } from "react-dom";
import { usePresence } from "@/lib/use-presence";
import { cn } from "@/lib/utils";
import { theme } from "../../shared/theme";

export type SelectOption = {
	value: string;
	label: string;
	description?: string;
};

interface SelectProps {
	value: string;
	onChange: (value: string) => void;
	options: SelectOption[];
	"aria-label": string;
	disabled?: boolean;
	placeholder?: string;
	className?: string;
	onOpenChange?: (open: boolean) => void;
}

type MenuCoords = {
	top?: number;
	bottom?: number;
	left: number;
	width: number;
	maxHeight: number;
};

const MENU_GAP = 4;
const VIEWPORT_PAD = 8;
const MENU_MAX = 280;
const MENU_MIN = 256;

export function Select({
	value,
	onChange,
	options,
	"aria-label": ariaLabel,
	disabled = false,
	placeholder,
	className,
	onOpenChange,
}: SelectProps) {
	const listId = useId();
	const triggerRef = useRef<HTMLButtonElement>(null);
	const listRef = useRef<HTMLDivElement>(null);
	const [open, setOpen] = useState(false);
	const [activeIndex, setActiveIndex] = useState(0);
	const [coords, setCoords] = useState<MenuCoords | null>(null);
	const { mounted, exiting } = usePresence(open);

	const selectedIndex = options.findIndex((option) => option.value === value);
	const selected = selectedIndex >= 0 ? options[selectedIndex] : undefined;

	const setOpenState = useCallback(
		(next: boolean) => {
			setOpen(next);
			onOpenChange?.(next);
			if (next) {
				const index = options.findIndex((option) => option.value === value);
				setActiveIndex(index >= 0 ? index : 0);
			}
		},
		[onOpenChange, options, value],
	);

	useLayoutEffect(() => {
		if (!mounted) {
			setCoords(null);
			return;
		}
		const update = () => {
			const rect = triggerRef.current?.getBoundingClientRect();
			if (!rect) return;
			const spaceBelow =
				window.innerHeight - rect.bottom - MENU_GAP - VIEWPORT_PAD;
			const spaceAbove = rect.top - MENU_GAP - VIEWPORT_PAD;
			const openBelow = spaceBelow >= 96 || spaceBelow >= spaceAbove;
			const maxHeight = Math.min(
				MENU_MAX,
				Math.max(openBelow ? spaceBelow : spaceAbove, 72),
			);
			const width = Math.max(rect.width, MENU_MIN);
			let left = rect.right - width;
			if (left + width > window.innerWidth - VIEWPORT_PAD) {
				left = window.innerWidth - VIEWPORT_PAD - width;
			}
			if (left < VIEWPORT_PAD) left = VIEWPORT_PAD;
			if (openBelow) {
				setCoords({ top: rect.bottom + MENU_GAP, left, width, maxHeight });
			} else {
				setCoords({
					bottom: window.innerHeight - rect.top + MENU_GAP,
					left,
					width,
					maxHeight,
				});
			}
		};
		update();
		void options.length;
	}, [mounted, options.length]);

	useEffect(() => {
		if (!open) return;
		const onPointerDown = (event: PointerEvent) => {
			const target = event.target;
			if (!(target instanceof Node)) return;
			if (triggerRef.current?.contains(target)) return;
			if (listRef.current?.contains(target)) return;
			setOpenState(false);
		};
		const onScroll = (event: Event) => {
			const target = event.target;
			if (target instanceof Node && listRef.current?.contains(target)) return;
			setOpenState(false);
		};
		const onResize = () => setOpenState(false);
		window.addEventListener("pointerdown", onPointerDown);
		window.addEventListener("scroll", onScroll, true);
		window.addEventListener("resize", onResize);
		return () => {
			window.removeEventListener("pointerdown", onPointerDown);
			window.removeEventListener("scroll", onScroll, true);
			window.removeEventListener("resize", onResize);
		};
	}, [open, setOpenState]);

	useEffect(() => {
		if (!open) return;
		setActiveIndex((index) => {
			if (options.length === 0) return 0;
			return Math.min(index, options.length - 1);
		});
	}, [open, options.length]);

	useLayoutEffect(() => {
		if (!mounted) return;
		const active = document.getElementById(`${listId}-opt-${activeIndex}`);
		active?.scrollIntoView({ block: "nearest" });
	}, [mounted, activeIndex, listId]);

	const commit = (option: SelectOption) => {
		onChange(option.value);
		setOpenState(false);
		triggerRef.current?.focus();
	};

	const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
		if (disabled) return;
		if (!open) {
			if (event.key === "ArrowDown" || event.key === "ArrowUp") {
				event.preventDefault();
				setOpenState(true);
				if (event.key === "ArrowUp") {
					setActiveIndex(Math.max(options.length - 1, 0));
				}
			}
			return;
		}
		if (event.key === "Escape") {
			event.preventDefault();
			event.stopPropagation();
			setOpenState(false);
			return;
		}
		if (event.key === "ArrowDown") {
			event.preventDefault();
			setActiveIndex((index) =>
				Math.min(index + 1, Math.max(options.length - 1, 0)),
			);
			return;
		}
		if (event.key === "ArrowUp") {
			event.preventDefault();
			setActiveIndex((index) => Math.max(index - 1, 0));
			return;
		}
		if (event.key === "Home") {
			event.preventDefault();
			setActiveIndex(0);
			return;
		}
		if (event.key === "End") {
			event.preventDefault();
			setActiveIndex(Math.max(options.length - 1, 0));
			return;
		}
		if (event.key === "Enter" || event.key === " ") {
			event.preventDefault();
			const option = options[activeIndex];
			if (option) commit(option);
		}
	};

	const activeOption = options[activeIndex];
	const activeId = activeOption ? `${listId}-opt-${activeIndex}` : undefined;

	return (
		<div className={cn("relative inline-flex min-w-[8rem]", className)}>
			<button
				ref={triggerRef}
				type="button"
				role="combobox"
				aria-label={ariaLabel}
				aria-expanded={open}
				aria-haspopup="listbox"
				aria-controls={listId}
				aria-activedescendant={open ? activeId : undefined}
				disabled={disabled}
				onClick={() => {
					if (disabled) return;
					setOpenState(!open);
				}}
				onKeyDown={onKeyDown}
				className={cn(
					"relative w-full rounded-md border border-border bg-background py-1.5 pr-9 pl-2.5 text-left text-sm leading-snug text-foreground",
					"focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-hidden",
					"disabled:cursor-not-allowed disabled:opacity-50",
				)}
			>
				<span
					className={cn(
						"block break-all",
						!selected && "text-muted-foreground",
					)}
				>
					{selected?.label ?? placeholder ?? ""}
				</span>
				<ChevronDown
					className={cn(
						"pointer-events-none absolute top-1/2 right-2.5 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground transition-transform duration-200 motion-reduce:transition-none",
						open && "rotate-180",
					)}
					aria-hidden
				/>
			</button>
			{mounted && coords
				? createPortal(
						<div
							ref={listRef}
							id={listId}
							role="listbox"
							aria-label={ariaLabel}
							style={{
								top: coords.top,
								bottom: coords.bottom,
								left: coords.left,
								width: coords.width,
								maxHeight: coords.maxHeight,
							}}
							className={cn(
								"fixed z-50 flex min-w-0 flex-col gap-2 overflow-x-hidden overflow-y-auto overscroll-x-none rounded-md border border-border bg-popover p-1.5 text-popover-foreground shadow-lg",
								exiting ? theme.recipe.exit : theme.recipe.dialog,
								exiting && "pointer-events-none",
							)}
						>
							{options.map((option, index) => {
								const isSelected = option.value === value;
								const highlighted = index === activeIndex;
								return (
									<button
										key={option.value}
										id={`${listId}-opt-${index}`}
										type="button"
										role="option"
										aria-selected={isSelected}
										data-active={highlighted ? "true" : undefined}
										onMouseEnter={() => setActiveIndex(index)}
										onMouseDown={(event) => event.preventDefault()}
										onClick={() => {
											if (exiting) return;
											commit(option);
										}}
										className={cn(
											"flex w-full min-w-0 cursor-pointer items-start gap-2 rounded-sm px-2.5 py-2.5 text-left text-sm leading-snug",
											highlighted && "bg-accent text-accent-foreground",
											isSelected &&
												!highlighted &&
												"bg-primary/10 text-foreground",
										)}
									>
										<span className="flex h-5 w-4 shrink-0 items-center justify-center">
											{isSelected ? (
												<Check
													className="h-3.5 w-3.5 text-primary"
													aria-hidden
												/>
											) : null}
										</span>
										<span className="min-w-0 flex-1">
											<span className="block break-all">{option.label}</span>
											{option.description ? (
												<span className="mt-1 block break-all text-xs leading-snug text-muted-foreground">
													{option.description}
												</span>
											) : null}
										</span>
									</button>
								);
							})}
						</div>,
						document.body,
					)
				: null}
		</div>
	);
}
