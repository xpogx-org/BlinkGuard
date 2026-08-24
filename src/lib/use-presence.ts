import { useEffect, useState } from "react";

/** Keep a node mounted for `exitMs` after `open` becomes false so exit CSS can play. */
export function usePresence(
	open: boolean,
	exitMs = 200,
): {
	mounted: boolean;
	exiting: boolean;
} {
	const [mounted, setMounted] = useState(open);
	const [exiting, setExiting] = useState(false);

	useEffect(() => {
		if (open) {
			setMounted(true);
			setExiting(false);
			return;
		}
		if (!mounted) return;
		setExiting(true);
		const timer = window.setTimeout(() => {
			setMounted(false);
			setExiting(false);
		}, exitMs);
		return () => window.clearTimeout(timer);
	}, [open, exitMs, mounted]);

	return { mounted, exiting };
}
