import { useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export interface SectionTabItem<T extends string> {
	id: T;
	label: string;
}

interface SectionTabsProps<T extends string> {
	items: readonly SectionTabItem<T>[];
	value: T;
	onChange: (id: T) => void;
	"aria-label": string;
	className?: string;
}

export function SectionTabs<T extends string>({
	items,
	value,
	onChange,
	"aria-label": ariaLabel,
	className,
}: SectionTabsProps<T>) {
	const listRef = useRef<HTMLDivElement>(null);
	const [pill, setPill] = useState<{
		left: number;
		width: number;
		height: number;
	} | null>(null);

	// biome-ignore lint/correctness/useExhaustiveDependencies: pill must remeasure when the selected tab changes
	useLayoutEffect(() => {
		const list = listRef.current;
		if (!list) return;
		const selected = list.querySelector('[aria-selected="true"]');
		if (!(selected instanceof HTMLElement)) return;

		const update = () => {
			const listBox = list.getBoundingClientRect();
			const btnBox = selected.getBoundingClientRect();
			setPill({
				left: btnBox.left - listBox.left + list.scrollLeft,
				width: btnBox.width,
				height: btnBox.height,
			});
		};
		update();
		const observer = new ResizeObserver(update);
		observer.observe(list);
		observer.observe(selected);
		return () => observer.disconnect();
	}, [value, items]);

	return (
		<div
			ref={listRef}
			role="tablist"
			aria-label={ariaLabel}
			className={cn("relative flex w-full gap-1", className)}
		>
			{pill ? (
				<span
					aria-hidden
					className="pointer-events-none absolute top-0 left-0 rounded-md border border-border bg-sidebar-active shadow-xs transition-[transform,width,height] duration-200 ease-out motion-reduce:transition-none"
					style={{
						width: pill.width,
						height: pill.height,
						transform: `translateX(${pill.left}px)`,
					}}
				/>
			) : null}
			{items.map((item) => {
				const selected = item.id === value;
				return (
					<button
						key={item.id}
						type="button"
						role="tab"
						aria-selected={selected}
						onClick={() => onChange(item.id)}
						className={cn(
							"relative z-10 min-w-0 flex-1 rounded-md border px-3 py-1.5 text-center text-sm font-medium transition-colors",
							selected
								? "border-transparent text-primary"
								: "border-border bg-muted/40 text-muted-foreground hover:bg-muted hover:text-foreground",
						)}
					>
						<span className="block truncate">{item.label}</span>
					</button>
				);
			})}
		</div>
	);
}
