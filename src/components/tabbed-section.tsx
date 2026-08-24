import type { ReactNode } from "react";
import { type SectionTabItem, SectionTabs } from "@/components/section-tabs";
import { cn } from "@/lib/utils";
import { theme } from "../../shared/theme";

export const MAIN_SCROLL_CLASS =
	"min-h-0 flex-1 overflow-y-auto overscroll-y-contain [overflow-anchor:none] [scrollbar-gutter:stable] px-4 py-4 sm:px-6 sm:py-5";

export function TabbedSection<T extends string>({
	items,
	value,
	onChange,
	"aria-label": ariaLabel,
	maxWidthClass,
	children,
}: {
	items: readonly SectionTabItem<T>[];
	value: T;
	onChange: (id: T) => void;
	"aria-label": string;
	maxWidthClass: string;
	children: ReactNode;
}) {
	return (
		<>
			<div className="shrink-0 border-b border-border bg-background px-4 pt-4 pb-3 sm:px-6 sm:pt-5">
				<div className={cn("mx-auto", maxWidthClass)}>
					<SectionTabs
						aria-label={ariaLabel}
						items={items}
						value={value}
						onChange={onChange}
					/>
				</div>
			</div>
			<div key={value} className={cn(MAIN_SCROLL_CLASS, theme.recipe.enter)}>
				<div className={cn("mx-auto flex flex-col gap-4", maxWidthClass)}>
					{children}
				</div>
			</div>
		</>
	);
}
