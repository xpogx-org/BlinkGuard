import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_RENDERER_PREFERENCES } from "@/features/settings/model/preferences";
import type { SetPreferences } from "@/features/settings/model/use-preferences";
import { AppearanceSelect } from "@/features/settings/ui/appearance-select";
import { I18nProvider } from "@/i18n";
import type { AppearancePreference } from "../../../shared/preferences";

function renderToggle(appearance: AppearancePreference = "light") {
	const appearances: AppearancePreference[] = [];
	const setPreferences: SetPreferences = (action) => {
		const current = { ...DEFAULT_RENDERER_PREFERENCES, appearance };
		const next = typeof action === "function" ? action(current) : action;
		appearances.push(next.appearance);
	};
	render(
		<I18nProvider locale="en">
			<AppearanceSelect
				appearance={appearance}
				setPreferences={setPreferences}
			/>
		</I18nProvider>,
	);
	return { appearances };
}

describe("AppearanceSelect", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it("shows only the current icon until the row opens", () => {
		renderToggle("light");
		expect(screen.getByRole("radio", { name: "Light" })).toBeDefined();
		expect(screen.queryByRole("radio", { name: "System" })).toBeNull();
		expect(screen.queryByRole("radio", { name: "Night" })).toBeNull();

		fireEvent.click(screen.getByRole("radio", { name: "Light" }));

		const radios = screen.getAllByRole("radio");
		expect(radios.map((node) => node.getAttribute("aria-label"))).toEqual([
			"Light",
			"System",
			"Night",
		]);
	});

	it("collapses without changing prefs when the current icon is clicked again", () => {
		const { appearances } = renderToggle("system");
		fireEvent.click(screen.getByRole("radio", { name: "System" }));
		fireEvent.click(screen.getByRole("radio", { name: "System" }));
		expect(appearances).toEqual([]);
		expect(screen.queryByRole("radio", { name: "Light" })).toBeNull();
	});

	it("commits a different icon and collapses the row", () => {
		const { appearances } = renderToggle("light");
		fireEvent.click(screen.getByRole("radio", { name: "Light" }));
		fireEvent.click(screen.getByRole("radio", { name: "Night" }));
		expect(appearances).toEqual(["dark"]);
	});

	it("shows the option name as a long-press hint", () => {
		vi.useFakeTimers();
		renderToggle("system");
		fireEvent.pointerDown(screen.getByRole("radio", { name: "System" }), {
			pointerType: "touch",
		});
		expect(screen.queryByRole("tooltip")).toBeNull();
		act(() => {
			vi.advanceTimersByTime(500);
		});
		expect(screen.getByRole("tooltip").textContent).toBe("System");
	});
});
