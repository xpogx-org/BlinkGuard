import { fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import { Select } from "@/components/select";

const OPTIONS = [
	{ value: "a", label: "Alpha" },
	{ value: "b", label: "Beta" },
	{ value: "c", label: "Gamma" },
];

function renderSelect(props: Partial<ComponentProps<typeof Select>> = {}) {
	const onChange = props.onChange ?? vi.fn();
	render(
		<Select
			aria-label="Pick"
			value="a"
			onChange={onChange}
			options={OPTIONS}
			{...props}
		/>,
	);
	return { onChange };
}

describe("Select", () => {
	it("opens and selects an option", () => {
		const { onChange } = renderSelect();
		fireEvent.click(screen.getByRole("combobox", { name: "Pick" }));
		expect(screen.getByRole("listbox")).toBeDefined();
		fireEvent.click(screen.getByRole("option", { name: "Beta" }));
		expect(onChange).toHaveBeenCalledWith("b");
	});

	it("commits the highlighted option with the keyboard", () => {
		const { onChange } = renderSelect();
		const trigger = screen.getByRole("combobox", { name: "Pick" });
		fireEvent.keyDown(trigger, { key: "ArrowDown" });
		expect(screen.getByRole("listbox")).toBeDefined();
		fireEvent.keyDown(trigger, { key: "ArrowDown" });
		fireEvent.keyDown(trigger, { key: "Enter" });
		expect(onChange).toHaveBeenCalledWith("b");
	});

	it("does not open when disabled", () => {
		renderSelect({ disabled: true });
		fireEvent.click(screen.getByRole("combobox", { name: "Pick" }));
		expect(screen.queryByRole("listbox")).toBeNull();
	});
});
