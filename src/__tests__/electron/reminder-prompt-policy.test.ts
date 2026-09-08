import { describe, expect, it } from "vitest";
import {
	type BackoffRng,
	BLINK_BACKOFF_IMAX_I0_FACTOR,
	BLINK_BACKOFF_IMAX_MS,
	BLINK_CAMERA_MESSAGE_POOL_KEYS,
	BLINK_TIMER_MESSAGE_POOL_KEYS,
	createBackoffState,
	effectiveBackoffImaxMs,
	isLowBpmCoachingActive,
	type NextBlinkPromptStepInput,
	nextBackoffIntervalMs,
	nextBlinkPromptStep,
	pickBlinkOverlayMessage,
	resetBackoff,
} from "../../../electron/domain/reminder-prompt-policy";
import { t } from "../../../shared/i18n/t";

function baseStep(
	overrides: Partial<NextBlinkPromptStepInput> = {},
): NextBlinkPromptStepInput {
	return {
		profile: "standard",
		mgdMode: false,
		cameraEnabled: true,
		isTracking: true,
		blinkRateCoachingEnabled: true,
		blinkRateReady: true,
		blinksPerMinute: 8,
		thresholdPerMin: 4,
		soundEnabled: true,
		overlayShowing: false,
		ambientShowing: false,
		escalateChimePlayed: false,
		...overrides,
	};
}

describe("isLowBpmCoachingActive", () => {
	it("is active only when camera tracking coaching is on and BPM is ready below threshold", () => {
		expect(isLowBpmCoachingActive(baseStep({ blinksPerMinute: 2 }))).toBe(true);
		expect(isLowBpmCoachingActive(baseStep({ blinksPerMinute: 4 }))).toBe(
			false,
		);
		expect(
			isLowBpmCoachingActive(baseStep({ blinkRateCoachingEnabled: false })),
		).toBe(false);
		expect(isLowBpmCoachingActive(baseStep({ blinkRateReady: false }))).toBe(
			false,
		);
		expect(isLowBpmCoachingActive(baseStep({ cameraEnabled: false }))).toBe(
			false,
		);
		expect(isLowBpmCoachingActive(baseStep({ isTracking: false }))).toBe(false);
	});
});

describe("nextBlinkPromptStep", () => {
	it("Standard: first miss is overlay; next interval escalates; then null", () => {
		expect(nextBlinkPromptStep(baseStep())).toBe("overlay");
		expect(nextBlinkPromptStep(baseStep({ overlayShowing: true }))).toBe(
			"escalate",
		);
		expect(
			nextBlinkPromptStep(
				baseStep({ overlayShowing: true, escalateChimePlayed: true }),
			),
		).toBeNull();
	});

	it("Standard never starts with ambient", () => {
		expect(nextBlinkPromptStep(baseStep({ profile: "standard" }))).toBe(
			"overlay",
		);
	});

	it("Gentle: ambient → overlay → escalate", () => {
		expect(nextBlinkPromptStep(baseStep({ profile: "gentle" }))).toBe(
			"ambient",
		);
		expect(
			nextBlinkPromptStep(
				baseStep({ profile: "gentle", ambientShowing: true }),
			),
		).toBe("overlay");
		expect(
			nextBlinkPromptStep(
				baseStep({ profile: "gentle", overlayShowing: true }),
			),
		).toBe("escalate");
	});

	it("Strong: first miss is full (glow + overlay + sound)", () => {
		expect(nextBlinkPromptStep(baseStep({ profile: "strong" }))).toBe("full");
		expect(
			nextBlinkPromptStep(
				baseStep({
					profile: "strong",
					overlayShowing: true,
					ambientShowing: true,
					escalateChimePlayed: true,
				}),
			),
		).toBeNull();
	});

	it("Strong + MGD: no ambient; escalate when sound on", () => {
		expect(
			nextBlinkPromptStep(
				baseStep({ profile: "strong", mgdMode: true, soundEnabled: true }),
			),
		).toBe("escalate");
		expect(
			nextBlinkPromptStep(
				baseStep({
					profile: "strong",
					mgdMode: true,
					soundEnabled: false,
				}),
			),
		).toBe("overlay");
	});

	it("MGD: always overlay first (never ambient), then escalate", () => {
		expect(
			nextBlinkPromptStep(baseStep({ mgdMode: true, profile: "gentle" })),
		).toBe("overlay");
		expect(
			nextBlinkPromptStep(
				baseStep({
					mgdMode: true,
					profile: "gentle",
					blinksPerMinute: 1,
					soundEnabled: true,
				}),
			),
		).toBe("overlay");
		expect(
			nextBlinkPromptStep(baseStep({ mgdMode: true, overlayShowing: true })),
		).toBe("escalate");
	});

	it("FR-6 Gentle low BPM skips ambient", () => {
		expect(
			nextBlinkPromptStep(
				baseStep({
					profile: "gentle",
					blinksPerMinute: 2,
					soundEnabled: false,
				}),
			),
		).toBe("overlay");
		expect(
			nextBlinkPromptStep(
				baseStep({
					profile: "gentle",
					blinksPerMinute: 2,
					soundEnabled: true,
				}),
			),
		).toBe("escalate");
	});

	it("FR-6 Standard low BPM + sound returns escalate on first overlay", () => {
		expect(
			nextBlinkPromptStep(
				baseStep({
					profile: "standard",
					blinksPerMinute: 1,
					soundEnabled: true,
				}),
			),
		).toBe("escalate");
		expect(
			nextBlinkPromptStep(
				baseStep({
					profile: "standard",
					blinksPerMinute: 1,
					soundEnabled: false,
				}),
			),
		).toBe("overlay");
	});

	it("coaching toggle off or BPM not ready: no FR-6 skip / instant escalate", () => {
		expect(
			nextBlinkPromptStep(
				baseStep({
					profile: "gentle",
					blinksPerMinute: 1,
					blinkRateCoachingEnabled: false,
				}),
			),
		).toBe("ambient");
		expect(
			nextBlinkPromptStep(
				baseStep({
					profile: "gentle",
					blinksPerMinute: 1,
					blinkRateReady: false,
				}),
			),
		).toBe("ambient");
		expect(
			nextBlinkPromptStep(
				baseStep({
					profile: "standard",
					blinksPerMinute: 1,
					blinkRateCoachingEnabled: false,
					soundEnabled: true,
				}),
			),
		).toBe("overlay");
		expect(
			nextBlinkPromptStep(
				baseStep({
					profile: "standard",
					blinksPerMinute: 1,
					blinkRateReady: false,
					soundEnabled: true,
				}),
			),
		).toBe("overlay");
	});
});

describe("ICMU backoff", () => {
	const healthy = {
		bpmReady: true,
		bpm: 10,
		threshold: 4,
		mgdMode: false,
		cameraEnabled: true,
	};

	it("create/reset start at I0", () => {
		const state = createBackoffState(3_000);
		expect(state).toEqual({ i0Ms: 3_000, intervalMs: 3_000 });
		expect(resetBackoff({ i0Ms: 3_000, intervalMs: 12_000 })).toEqual({
			i0Ms: 3_000,
			intervalMs: 3_000,
		});
	});

	it("doubles + jitter with fake RNG and caps at effective Imax (10× I0)", () => {
		const i0 = 3_000;
		const iMax = effectiveBackoffImaxMs(i0);
		expect(iMax).toBe(i0 * BLINK_BACKOFF_IMAX_I0_FACTOR);
		expect(iMax).toBeLessThan(BLINK_BACKOFF_IMAX_MS);

		const calls: number[] = [];
		const rng: BackoffRng = {
			randomInt(maxExclusive) {
				calls.push(maxExclusive);
				return 100;
			},
		};
		let state = createBackoffState(i0);
		state = nextBackoffIntervalMs(state, healthy, rng);
		expect(calls[0]).toBe(iMax - i0);
		expect(state.intervalMs).toBe(2 * i0 + 100);

		state = nextBackoffIntervalMs(state, healthy, rng);
		expect(state.intervalMs).toBe(2 * (6_000 + 100) + 100);

		const nearCapRng: BackoffRng = {
			randomInt() {
				return 50_000;
			},
		};
		state = { i0Ms: i0, intervalMs: 40_000 };
		state = nextBackoffIntervalMs(state, healthy, nearCapRng);
		// min(2*40000 + 50000, 10*3000) → 30000
		expect(state.intervalMs).toBe(iMax);
	});

	it("keeps small I0 from jumping to absolute 60s after one healthy show", () => {
		const rng: BackoffRng = {
			randomInt(maxExclusive) {
				return Math.max(0, maxExclusive - 1);
			},
		};
		let state = createBackoffState(1_000);
		state = nextBackoffIntervalMs(state, healthy, rng);
		expect(state.intervalMs).toBeLessThanOrEqual(10_000);
		expect(state.intervalMs).toBe(effectiveBackoffImaxMs(1_000));
	});

	it("resets to I0 when BPM low or not ready", () => {
		const rng: BackoffRng = {
			randomInt() {
				return 0;
			},
		};
		let state = createBackoffState(3_000);
		state = nextBackoffIntervalMs(state, healthy, rng);
		expect(state.intervalMs).toBeGreaterThan(3_000);

		state = nextBackoffIntervalMs(state, { ...healthy, bpm: 2 }, rng);
		expect(state.intervalMs).toBe(3_000);

		state = nextBackoffIntervalMs(state, healthy, rng);
		state = nextBackoffIntervalMs(state, { ...healthy, bpmReady: false }, rng);
		expect(state.intervalMs).toBe(3_000);
	});

	it("MGD and timer skip backoff (always I0)", () => {
		const rng: BackoffRng = {
			randomInt() {
				throw new Error("RNG must not run");
			},
		};
		const grown = { i0Ms: 3_000, intervalMs: 12_000 };
		expect(
			nextBackoffIntervalMs(grown, { ...healthy, mgdMode: true }, rng)
				.intervalMs,
		).toBe(3_000);
		expect(
			nextBackoffIntervalMs(grown, { ...healthy, cameraEnabled: false }, rng)
				.intervalMs,
		).toBe(3_000);
	});

	it("uses threshold for backoff even without coaching toggle (caller omits toggle)", () => {
		const rng: BackoffRng = {
			randomInt() {
				return 0;
			},
		};
		const state = nextBackoffIntervalMs(
			createBackoffState(3_000),
			healthy,
			rng,
		);
		expect(state.intervalMs).toBe(6_000);
	});
});

describe("pickBlinkOverlayMessage", () => {
	const defaultMsg = "Blink!";

	it("returns custom when it differs from default", () => {
		expect(
			pickBlinkOverlayMessage({
				locale: "en",
				customPopupMessage: "Soft blink please",
				cameraEnabled: true,
				index: 0,
				defaultPopupMessage: defaultMsg,
			}),
		).toBe("Soft blink please");
	});

	it("rotates camera pool when message is default", () => {
		expect(
			pickBlinkOverlayMessage({
				locale: "en",
				customPopupMessage: defaultMsg,
				cameraEnabled: true,
				index: 0,
				defaultPopupMessage: defaultMsg,
			}),
		).toBe(t("en", BLINK_CAMERA_MESSAGE_POOL_KEYS[0]));
		expect(
			pickBlinkOverlayMessage({
				locale: "en",
				customPopupMessage: defaultMsg,
				cameraEnabled: true,
				index: 7,
				defaultPopupMessage: defaultMsg,
			}),
		).toBe(
			t(
				"en",
				BLINK_CAMERA_MESSAGE_POOL_KEYS[
					7 % BLINK_CAMERA_MESSAGE_POOL_KEYS.length
				],
			),
		);
	});

	it("uses timer pool when camera is off", () => {
		expect(
			pickBlinkOverlayMessage({
				locale: "en",
				customPopupMessage: defaultMsg,
				cameraEnabled: false,
				index: 1,
				defaultPopupMessage: defaultMsg,
			}),
		).toBe(t("en", BLINK_TIMER_MESSAGE_POOL_KEYS[1]));
	});
});
