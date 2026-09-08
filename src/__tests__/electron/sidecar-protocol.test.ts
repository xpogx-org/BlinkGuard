import { describe, expect, it } from "vitest";
import {
	encodeSidecarMessage,
	NdjsonBuffer,
	parseBaselineDriftNudge,
} from "../../../electron/infrastructure/sidecar/protocol";

describe("NdjsonBuffer", () => {
	it("returns nothing until a newline arrives", () => {
		const buffer = new NdjsonBuffer();
		expect(buffer.push('{"blink":true')).toEqual([]);
		expect(buffer.push(',"ear":0.2')).toEqual([]);
	});

	it("emits a complete line after a split chunk", () => {
		const buffer = new NdjsonBuffer();
		expect(buffer.push('{"blink":true')).toEqual([]);
		expect(buffer.push(',"ear":0.2}\n')).toEqual(['{"blink":true,"ear":0.2}']);
	});

	it("emits multiple lines from one chunk and keeps a trailing partial", () => {
		const buffer = new NdjsonBuffer();
		expect(buffer.push('{"a":1}\n{"b":2}\n{"c":')).toEqual([
			'{"a":1}',
			'{"b":2}',
		]);
		expect(buffer.push("3}\n")).toEqual(['{"c":3}']);
	});

	it("accepts Buffer chunks", () => {
		const buffer = new NdjsonBuffer();
		expect(buffer.push(Buffer.from('{"ok":true}\n'))).toEqual(['{"ok":true}']);
	});
});

describe("parseBaselineDriftNudge", () => {
	it("promotes baseline_drift_nudge blinkDebug and ignores other phases", () => {
		expect(
			parseBaselineDriftNudge({
				phase: "baseline_drift_nudge",
				baseline_before: 0.3,
				baseline: 0.31,
				live_open_ear: 0.34,
				drift_ratio: 0.13,
			}),
		).toEqual({
			baseline_before: 0.3,
			baseline: 0.31,
			live_open_ear: 0.34,
			drift_ratio: 0.13,
		});
		expect(parseBaselineDriftNudge({ phase: "complete" })).toBeNull();
		expect(parseBaselineDriftNudge(null)).toBeNull();
	});
});

describe("encodeSidecarMessage", () => {
	it("writes one JSON object per newline-terminated line", () => {
		expect(encodeSidecarMessage({ start_camera: true })).toBe(
			'{"start_camera":true}\n',
		);
	});
});
