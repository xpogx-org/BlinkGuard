import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { theme } from "../../shared/theme";

type StatusBannerVariant = "destructive" | "warning";

interface StatusBannerProps {
	variant?: StatusBannerVariant;
	children: ReactNode;
	className?: string;
	role?: "status" | "alert";
}

const variantClasses: Record<StatusBannerVariant, string> = {
	destructive: theme.recipe.destructiveSurface,
	warning: theme.recipe.warningSurface,
};

export function StatusBanner({
	variant = "warning",
	children,
	className,
	role = "status",
}: StatusBannerProps) {
	return (
		<aside
			role={role}
			className={cn(
				theme.recipe.enter,
				"rounded-lg border p-4",
				variantClasses[variant],
				className,
			)}
		>
			{children}
		</aside>
	);
}
