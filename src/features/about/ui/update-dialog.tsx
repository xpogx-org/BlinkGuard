import { useEffect, useRef } from "react";
import { Button } from "@/components/button";
import { SettingPanel } from "@/components/setting-panel";
import type { useAutoUpdate } from "@/features/about/model/use-auto-update";
import { usePresence } from "@/features/about/model/use-presence";
import { useT } from "@/i18n";
import { cn } from "@/lib/utils";
import { theme } from "../../../../shared/theme";

type AutoUpdateApi = ReturnType<typeof useAutoUpdate>;

export function UpdateDialog({ status, install, dismiss }: AutoUpdateApi) {
	const t = useT();

	useEffect(() => {
		if (status.state === "idle" || status.surface !== "dialog") return;
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			if (
				status.state === "checking" ||
				status.state === "available" ||
				status.state === "downloading"
			) {
				return;
			}
			dismiss();
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [status, dismiss]);

	const open = status.state !== "idle" && status.surface === "dialog";
	const { mounted, exiting } = usePresence(open);
	const cached = useRef({ title: "", message: "" });

	if (!mounted) return null;

	const titleId = "auto-update-title";
	let title = "";
	let message = "";
	let percent: number | null = null;

	switch (status.state) {
		case "checking":
			title = t("updates.checking.title");
			message = t("updates.checking.message");
			break;
		case "available":
			title = t("updates.available.title");
			message = t("updates.available.message", { version: status.version });
			break;
		case "downloading":
			title = t("updates.downloading.title");
			message = t("updates.downloading.message", {
				version: status.version,
				percent: status.percent,
			});
			percent = status.percent;
			break;
		case "upToDate":
			title = t("updates.upToDate.title");
			message = t("updates.upToDate.message");
			break;
		case "error":
			title = t("updates.error.title");
			message = t("updates.error.message");
			break;
		case "unavailable":
			title = t("updates.unavailable.title");
			message = t("updates.unavailable.message");
			break;
		case "ready":
			title = t("updates.ready.title");
			message = t("updates.ready.message", { version: status.version });
			break;
	}

	const showProgress =
		status.state === "downloading" || status.state === "available";
	const progressWidth = status.state === "downloading" ? (percent ?? 0) : 0;
	if (open) {
		cached.current = { title, message };
	}
	const shown = open ? { title, message } : cached.current;

	return (
		<div
			className={cn(
				"fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm",
				exiting ? theme.recipe.exit : theme.recipe.overlay,
			)}
			role="dialog"
			aria-modal="true"
			aria-labelledby={titleId}
		>
			<SettingPanel
				className={cn(
					"flex w-full max-w-md flex-col gap-4 shadow-lg",
					exiting ? theme.recipe.exit : theme.recipe.dialog,
				)}
			>
				<div className="space-y-1">
					<h2 id={titleId} className="text-xl font-semibold tracking-tight">
						{shown.title}
					</h2>
					<p className="select-text text-sm text-muted-foreground">
						{shown.message}
					</p>
				</div>

				{showProgress ? (
					<div className="h-1.5 overflow-hidden rounded-full bg-muted">
						<div
							className="h-full bg-primary transition-[width] duration-200"
							style={{ width: `${progressWidth}%` }}
						/>
					</div>
				) : null}

				<div className="flex justify-end gap-2">
					{status.state === "ready" ? (
						<>
							<Button type="button" variant="ghost" onClick={dismiss}>
								{t("updates.ready.later")}
							</Button>
							<Button type="button" onClick={install}>
								{t("updates.ready.restart")}
							</Button>
						</>
					) : status.state === "checking" ||
						status.state === "available" ||
						status.state === "downloading" ? null : (
						<Button type="button" onClick={dismiss}>
							{t("updates.ok")}
						</Button>
					)}
				</div>
			</SettingPanel>
		</div>
	);
}
