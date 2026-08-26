import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UpdateToast } from "@/features/about/ui/update-toast";
import { I18nProvider } from "@/i18n";
import type { AutoUpdateStatus } from "../../../shared/auto-update";

function renderToast(
	status: AutoUpdateStatus,
	handlers: { dismiss?: () => void } = {},
) {
	const dismiss = handlers.dismiss ?? vi.fn();
	render(
		<I18nProvider locale="en">
			<UpdateToast
				status={status}
				busy={false}
				check={vi.fn()}
				install={vi.fn()}
				dismiss={dismiss}
			/>
		</I18nProvider>,
	);
	return { dismiss };
}

describe("UpdateToast", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it("renders nothing when idle", () => {
		render(
			<I18nProvider locale="en">
				<UpdateToast
					status={{ state: "idle" }}
					busy={false}
					check={vi.fn()}
					install={vi.fn()}
					dismiss={vi.fn()}
				/>
			</I18nProvider>,
		);
		expect(screen.queryByRole("status")).toBeNull();
	});

	it("ignores dialog-surface statuses", () => {
		renderToast({ state: "checking", surface: "dialog" });
		expect(screen.queryByRole("status")).toBeNull();
	});

	it("shows silent checking toast", () => {
		renderToast({ state: "checking", surface: "toast" });
		expect(
			screen.getByRole("status", { name: "Checking for updates" }),
		).toBeDefined();
	});

	it("shows download progress percent", () => {
		renderToast({
			state: "downloading",
			version: "2.0.0",
			percent: 55,
			surface: "toast",
		});
		expect(screen.getByText("Downloading BlinkGuard 2.0.0… 55%")).toBeDefined();
	});

	it("auto-dismisses upToDate after a short delay", () => {
		vi.useFakeTimers();
		const { dismiss } = renderToast({ state: "upToDate", surface: "toast" });
		expect(dismiss).not.toHaveBeenCalled();
		act(() => {
			vi.advanceTimersByTime(4000);
		});
		expect(dismiss).toHaveBeenCalledOnce();
	});

	it("does not auto-dismiss checking", () => {
		vi.useFakeTimers();
		const { dismiss } = renderToast({ state: "checking", surface: "toast" });
		act(() => {
			vi.advanceTimersByTime(10_000);
		});
		expect(dismiss).not.toHaveBeenCalled();
	});

	it("shows ready-on-quit copy and auto-dismisses", () => {
		vi.useFakeTimers();
		const { dismiss } = renderToast({
			state: "ready",
			version: "2.2.0",
			surface: "toast",
		});
		expect(
			screen.getByRole("status", { name: "Update downloaded" }),
		).toBeDefined();
		expect(
			screen.getByText(
				"BlinkGuard 2.2.0 is ready. Restart from About to update now, or you'll be asked when you quit.",
			),
		).toBeDefined();
		act(() => {
			vi.advanceTimersByTime(4000);
		});
		expect(dismiss).toHaveBeenCalledOnce();
	});
});
