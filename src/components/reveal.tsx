import { type ReactNode, useRef } from "react";
import { usePresence } from "@/features/about/model/use-presence";
import { cn } from "@/lib/utils";

interface RevealProps {
	open: boolean;
	children: ReactNode;
	className?: string;
	/** collapse = height (nested settings); fade = mount/unmount banners */
	variant?: "collapse" | "fade";
}

export function Reveal({
	open,
	children,
	className,
	variant = "collapse",
}: RevealProps) {
	const cached = useRef(children);
	if (open) cached.current = children;
	const { mounted, exiting } = usePresence(open);

	if (variant === "fade") {
		if (!mounted) return null;
		return (
			<div className={cn(exiting ? "motion-exit" : "motion-enter", className)}>
				{open ? children : cached.current}
			</div>
		);
	}

	return (
		<div
			data-reveal-open={open ? "true" : "false"}
			className={cn(
				"grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none",
				open ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
			)}
		>
			<div className={cn("min-h-0 overflow-hidden", className)} inert={!open}>
				{children}
			</div>
		</div>
	);
}
