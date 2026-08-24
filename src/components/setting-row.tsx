import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface SettingRowProps {
	title: ReactNode;
	description?: ReactNode;
	action?: ReactNode;
	children?: ReactNode;
	className?: string;
}

export function SettingRow({
	title,
	description,
	action,
	children,
	className,
}: SettingRowProps) {
	return (
		<div className={cn("min-w-0", className)}>
			<div className="flex items-start justify-between gap-3">
				<div className="min-w-0 space-y-1">
					<div className="min-w-0 text-sm font-medium text-wrap text-foreground">
						{title}
					</div>
					{description ? (
						<div className="text-xs text-muted-foreground sm:text-sm">
							{description}
						</div>
					) : null}
				</div>
				{action ? <div className="shrink-0">{action}</div> : null}
			</div>
			{children ? (
				<div className="mt-4 transition-[margin] duration-200 ease-out has-[[data-reveal-open=false]]:mt-0">
					{children}
				</div>
			) : null}
		</div>
	);
}
