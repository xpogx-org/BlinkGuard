// Hidden sound player window — file MP3s or procedural cheer fanfare

/** @type {number} */
let playId = 0;
/** @type {number} */
let finishedForPlayId = -1;
/** @type {AudioContext | null} */
let cheerCtx = null;
/** @type {ReturnType<typeof setTimeout> | null} */
let deviceChangeTimer = null;

/** @type {number} */
let debugCheerThemeIndex = 0;

const CHEER_THEME_IDS = [
	"classic",
	"bounce",
	"fanfare",
	"sparkle",
	"chime",
	"waltz",
];

const ROOTS = [261.63, 293.66, 329.63, 349.23, 392.0, 440.0];
const SCALES = {
	major: [0, 4, 7, 12],
	pentatonic: [0, 2, 4, 7, 9],
	mixolydian: [0, 2, 4, 7, 10],
	minor: [0, 3, 7, 12],
};

/**
 * @param {number} id
 */
function notifyFinished(id) {
	if (id !== playId || finishedForPlayId === id) return;
	finishedForPlayId = id;
	window.popupAPI.notifyAudioFinished();
}

/**
 * @param {{ kind?: string, reason: string, message?: string, contextState?: string }} payload
 */
function notifyError(payload) {
	window.popupAPI.notifyAudioError(payload);
}

function stopInFlight() {
	const audio = document.getElementById("audio");
	if (audio) {
		audio.pause();
		audio.removeAttribute("src");
		try {
			audio.load();
		} catch {
			// ignore
		}
	}
	if (cheerCtx) {
		const ctx = cheerCtx;
		cheerCtx = null;
		void ctx.close().catch(() => {});
	}
}

/**
 * @param {HTMLAudioElement} audio
 * @param {string | undefined} kind
 */
async function rebindSink(audio, kind) {
	if (typeof audio.setSinkId !== "function") return;

	try {
		await audio.setSinkId("default");
	} catch (error) {
		notifyError({
			kind,
			reason: "sink-failed",
			message: error instanceof Error ? error.message : String(error),
		});
	}

	if (!navigator.mediaDevices?.enumerateDevices) return;

	try {
		const devices = await navigator.mediaDevices.enumerateDevices();
		const outputs = devices.filter((device) => device.kind === "audiooutput");
		const defaultDev = outputs.find((device) => device.deviceId === "default");
		if (!defaultDev) return;
		const hardware = outputs.find(
			(device) =>
				device.groupId === defaultDev.groupId &&
				device.deviceId !== "default" &&
				device.deviceId !== "communications",
		);
		if (hardware) await audio.setSinkId(hardware.deviceId);
	} catch (error) {
		notifyError({
			kind,
			reason: "sink-failed",
			message: error instanceof Error ? error.message : String(error),
		});
	}
}

/**
 * @param {AudioContext} ctx
 * @param {GainNode} master
 * @param {number} root
 * @param {number[]} scale
 */
function createCheerTone(ctx, master, root, scale) {
	const midiOffset = (semitones) => root * 2 ** (semitones / 12);

	function playTone(freq, startTime, duration, peak, type) {
		const osc = ctx.createOscillator();
		const gain = ctx.createGain();
		osc.type = type ?? (Math.random() < 0.65 ? "triangle" : "sine");
		osc.frequency.value = freq;
		gain.gain.setValueAtTime(0.0001, startTime);
		gain.gain.exponentialRampToValueAtTime(peak, startTime + 0.02);
		gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
		osc.connect(gain);
		gain.connect(master);
		osc.start(startTime);
		osc.stop(startTime + duration + 0.02);
	}

	return { midiOffset, playTone };
}

/** @param {ReturnType<typeof createCheerTone>} tone @param {number} t0 */
function patternClassic(tone, t0, scale) {
	const noteCount = 3 + Math.floor(Math.random() * 3);
	const stepMs = 90 + Math.floor(Math.random() * 50);
	const noteDur = 0.18 + Math.random() * 0.1;
	for (let i = 0; i < noteCount; i++) {
		const deg = scale[Math.min(i, scale.length - 1)];
		const freq = tone.midiOffset(deg);
		const start = t0 + (i * stepMs) / 1000;
		tone.playTone(freq, start, noteDur, 0.7 + Math.random() * 0.25);
		if (i === noteCount - 1 && Math.random() < 0.7) {
			tone.playTone(freq * 2, start + 0.04, noteDur * 0.7, 0.35);
		}
	}
	if (Math.random() < 0.85) {
		const dingStart = t0 + (noteCount * stepMs) / 1000 + 0.05;
		tone.playTone(
			tone.midiOffset(12 + Math.floor(Math.random() * 5)),
			dingStart,
			0.22,
			0.45,
		);
	}
	return noteCount * stepMs + noteDur * 1000 + 350;
}

/** @param {ReturnType<typeof createCheerTone>} tone @param {number} t0 */
function patternBounce(tone, t0, scale) {
	const jumps = [0, 4, 2, 7, 4, 9];
	const count = 4 + Math.floor(Math.random() * 2);
	const stepMs = 70 + Math.floor(Math.random() * 35);
	const noteDur = 0.1 + Math.random() * 0.06;
	for (let i = 0; i < count; i++) {
		const deg = jumps[i % jumps.length] + scale[0];
		const start = t0 + (i * stepMs) / 1000;
		tone.playTone(
			tone.midiOffset(deg),
			start,
			noteDur,
			0.55 + Math.random() * 0.2,
			"square",
		);
	}
	return count * stepMs + noteDur * 1000 + 280;
}

/** @param {ReturnType<typeof createCheerTone>} tone @param {number} t0 */
function patternFanfare(tone, t0, scale) {
	const leaps = [0, 7, 12, 7, 12, 16];
	const stepMs = 110 + Math.floor(Math.random() * 40);
	const noteDur = 0.24 + Math.random() * 0.12;
	for (let i = 0; i < 4; i++) {
		const deg = leaps[i];
		const start = t0 + (i * stepMs) / 1000;
		tone.playTone(
			tone.midiOffset(deg),
			start,
			noteDur,
			0.65 + Math.random() * 0.2,
			"triangle",
		);
	}
	const rest = t0 + (4 * stepMs) / 1000 + 0.08;
	tone.playTone(tone.midiOffset(12), rest, 0.35, 0.5, "sine");
	return 4 * stepMs + 450;
}

/** @param {ReturnType<typeof createCheerTone>} tone @param {number} t0 */
function patternSparkle(tone, t0, scale) {
	const bursts = 5 + Math.floor(Math.random() * 3);
	let elapsed = 0;
	for (let i = 0; i < bursts; i++) {
		const deg = scale[Math.floor(Math.random() * scale.length)] + 12;
		const start = t0 + elapsed / 1000;
		const dur = 0.06 + Math.random() * 0.05;
		tone.playTone(tone.midiOffset(deg), start, dur, 0.35 + Math.random() * 0.15, "sine");
		elapsed += 45 + Math.floor(Math.random() * 35);
	}
	return elapsed + 200;
}

/** @param {ReturnType<typeof createCheerTone>} tone @param {number} t0 */
function patternChime(tone, t0, scale) {
	const pairs = [
		[0, 7],
		[4, 11],
		[7, 14],
	];
	const stepMs = 160 + Math.floor(Math.random() * 60);
	const noteDur = 0.35 + Math.random() * 0.15;
	for (let i = 0; i < pairs.length; i++) {
		const [a, b] = pairs[i];
		const start = t0 + (i * stepMs) / 1000;
		tone.playTone(tone.midiOffset(a), start, noteDur, 0.4, "sine");
		tone.playTone(tone.midiOffset(b), start + 0.01, noteDur, 0.28, "triangle");
	}
	return pairs.length * stepMs + noteDur * 1000 + 300;
}

/** @param {ReturnType<typeof createCheerTone>} tone @param {number} t0 */
function patternWaltz(tone, t0, scale) {
	const groups = 3;
	const beatMs = 140 + Math.floor(Math.random() * 30);
	const noteDur = 0.14 + Math.random() * 0.05;
	for (let g = 0; g < groups; g++) {
		const base = g * 3;
		for (let b = 0; b < 3; b++) {
			const deg = scale[(base + b) % scale.length];
			const accent = b === 0 ? 0.55 : 0.38;
			const start = t0 + ((g * 3 + b) * beatMs) / 1000;
			tone.playTone(tone.midiOffset(deg), start, noteDur, accent, "triangle");
		}
	}
	return groups * 3 * beatMs + noteDur * 1000 + 250;
}

const CHEER_PATTERNS = {
	classic: patternClassic,
	bounce: patternBounce,
	fanfare: patternFanfare,
	sparkle: patternSparkle,
	chime: patternChime,
	waltz: patternWaltz,
};

/**
 * @param {string | undefined} requested
 */
function pickCheerThemeId(requested) {
	if (requested && CHEER_PATTERNS[requested]) return requested;
	return CHEER_THEME_IDS[Math.floor(Math.random() * CHEER_THEME_IDS.length)];
}

/**
 * @param {number} volume 0..1
 * @param {string | undefined} kind
 * @param {number} id
 * @param {string | undefined} cheerTheme
 */
async function playCheerFanfare(volume, kind, id, cheerTheme) {
	const AudioCtx = window.AudioContext || window.webkitAudioContext;
	if (!AudioCtx) {
		notifyError({ kind, reason: "cheer-no-context" });
		notifyFinished(id);
		return;
	}

	const ctx = new AudioCtx();
	cheerCtx = ctx;
	try {
		await ctx.resume();
	} catch (error) {
		notifyError({
			kind,
			reason: "cheer-not-running",
			message: error instanceof Error ? error.message : String(error),
			contextState: ctx.state,
		});
		if (cheerCtx === ctx) cheerCtx = null;
		void ctx.close().catch(() => {});
		notifyFinished(id);
		return;
	}

	if (id !== playId) {
		if (cheerCtx === ctx) cheerCtx = null;
		void ctx.close().catch(() => {});
		return;
	}

	if (ctx.state !== "running") {
		notifyError({
			kind,
			reason: "cheer-not-running",
			contextState: ctx.state,
		});
		if (cheerCtx === ctx) cheerCtx = null;
		void ctx.close().catch(() => {});
		notifyFinished(id);
		return;
	}

	const master = ctx.createGain();
	master.gain.value = Math.min(1, Math.max(0, volume)) * 0.35;
	master.connect(ctx.destination);

	const scaleNames = Object.keys(SCALES);
	const scaleName = scaleNames[Math.floor(Math.random() * scaleNames.length)];
	const scale = SCALES[scaleName];
	const root = ROOTS[Math.floor(Math.random() * ROOTS.length)];
	const themeId = pickCheerThemeId(cheerTheme);
	const pattern = CHEER_PATTERNS[themeId] ?? CHEER_PATTERNS.classic;
	const tone = createCheerTone(ctx, master, root, scale);
	const t0 = ctx.currentTime + 0.02;
	const totalMs = pattern(tone, t0, scale);

	setTimeout(() => {
		if (cheerCtx === ctx) cheerCtx = null;
		void ctx.close().catch(() => {});
		notifyFinished(id);
	}, totalMs);
}

/**
 * @param {{ path?: string, volume?: number }} payload
 * @param {string | undefined} kind
 * @param {number} id
 */
async function playFileSound(payload, kind, id) {
	const audio = document.getElementById("audio");
	if (!audio || !payload?.path) {
		notifyError({ kind, reason: "no-audio-element" });
		notifyFinished(id);
		return;
	}

	const volume =
		typeof payload.volume === "number" && Number.isFinite(payload.volume)
			? Math.min(1, Math.max(0, payload.volume))
			: 1;

	await rebindSink(audio, kind);
	if (id !== playId) return;

	audio.src = payload.path;
	audio.volume = volume;

	audio.addEventListener(
		"ended",
		() => {
			notifyFinished(id);
		},
		{ once: true },
	);

	try {
		await audio.play();
	} catch (error) {
		notifyError({
			kind,
			reason: "play-rejected",
			message: error instanceof Error ? error.message : String(error),
		});
		notifyFinished(id);
	}
}

function onDeviceChange() {
	if (deviceChangeTimer) clearTimeout(deviceChangeTimer);
	deviceChangeTimer = setTimeout(() => {
		deviceChangeTimer = null;
		const id = playId;
		const inFlight = playId > 0 && finishedForPlayId !== playId;
		stopInFlight();
		window.popupAPI.notifyAudioOutputInvalidated();
		if (inFlight) notifyFinished(id);
	}, 200);
}

function initSoundPlayer() {
	window.popupAPI.onStopSound(() => {
		playId += 1;
		stopInFlight();
	});

	window.popupAPI.onPlaySound((payload) => {
		playId += 1;
		const id = playId;
		finishedForPlayId = -1;
		stopInFlight();

		const kind = typeof payload?.kind === "string" ? payload.kind : undefined;
		const volume =
			typeof payload?.volume === "number" && Number.isFinite(payload.volume)
				? Math.min(1, Math.max(0, payload.volume))
				: 1;
		const cheerTheme =
			typeof payload?.cheerTheme === "string" ? payload.cheerTheme : undefined;

		if (payload?.mode === "cheer") {
			if (payload?.cheerTheme === "__cycle__") {
				const theme = CHEER_THEME_IDS[debugCheerThemeIndex % CHEER_THEME_IDS.length];
				debugCheerThemeIndex += 1;
				void playCheerFanfare(volume, kind, id, theme);
				return;
			}
			void playCheerFanfare(volume, kind, id, cheerTheme);
			return;
		}

		void playFileSound(payload, kind, id);
	});

	if (navigator.mediaDevices?.addEventListener) {
		navigator.mediaDevices.addEventListener("devicechange", onDeviceChange);
	}
}

if (document.readyState === "loading") {
	document.addEventListener("DOMContentLoaded", initSoundPlayer);
} else {
	initSoundPlayer();
}
