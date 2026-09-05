import { describe, expect, it } from "vitest";
import { sanitizeSnoozeAllOptions } from "../../../shared/ipc-channels";

describe("sanitizeSnoozeAllOptions", () => {
	it("defaults empty payload", () => {
		expect(sanitizeSnoozeAllOptions(undefined)).toEqual({
			useToken: false,
			untilResume: false,
		});
		expect(sanitizeSnoozeAllOptions(null)).toEqual({
			useToken: false,
			untilResume: false,
		});
	});

	it("accepts useToken only", () => {
		expect(sanitizeSnoozeAllOptions({ useToken: true })).toEqual({
			useToken: true,
			untilResume: false,
		});
	});

	it("accepts meeting durations", () => {
		expect(sanitizeSnoozeAllOptions({ durationMinutes: 30 })).toEqual({
			useToken: false,
			durationMinutes: 30,
			untilResume: false,
		});
	});

	it("accepts until-resume", () => {
		expect(sanitizeSnoozeAllOptions({ untilResume: true })).toEqual({
			useToken: false,
			untilResume: true,
		});
	});

	it("rejects hostile values", () => {
		expect(sanitizeSnoozeAllOptions({ durationMinutes: 5 })).toEqual({
			useToken: false,
			untilResume: false,
		});
		expect(sanitizeSnoozeAllOptions({ durationMinutes: "30" })).toEqual({
			useToken: false,
			untilResume: false,
		});
		expect(sanitizeSnoozeAllOptions({ untilResume: true, durationMinutes: 60 })).toEqual({
			useToken: false,
			untilResume: false,
			durationMinutes: 60,
		});
		expect(sanitizeSnoozeAllOptions("bad")).toEqual({
			useToken: false,
			untilResume: false,
		});
	});
});
