import { cn } from "@/lib/utils";
import type { ChartBucket } from "../../../../shared/blink-stats";

interface StatsBarChartProps {
	buckets: ChartBucket[];
	ariaLabel: string;
}

export function StatsBarChart({ buckets, ariaLabel }: StatsBarChartProps) {
	const max = Math.max(1, ...buckets.map((bucket) => bucket.value));

	return (
		<div
			role="img"
			aria-label={ariaLabel}
			className="flex h-40 items-end gap-1 sm:gap-1.5"
		>
			{buckets.map((bucket) => {
				const heightPct = Math.max(
					bucket.value > 0 ? 6 : 0,
					(bucket.value / max) * 100,
				);
				return (
					<div
						key={bucket.label}
						className="flex min-w-0 flex-1 flex-col items-center gap-1"
					>
						<div className="flex h-28 w-full items-end justify-center">
							<div
								title={`${bucket.label}: ${bucket.value}`}
								className={cn(
									"w-full max-w-5 rounded-t-sm bg-primary/80 transition-[height] duration-300 ease-out",
									bucket.value === 0 && "bg-muted",
								)}
								style={{ height: `${heightPct}%` }}
							/>
						</div>
						<span className="truncate text-2xs text-muted-foreground sm:text-xs">
							{bucket.label}
						</span>
					</div>
				);
			})}
		</div>
	);
}
