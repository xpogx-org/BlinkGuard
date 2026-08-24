// Hidden sound player window — file MP3s or procedural cheer fanfare

/** @type {number} */
let playId = 0;
/** @type {number} */
let finishedForPlayId = -1;
/** @type {AudioContext | null} */
let cheerCtx = null;
/** @type {ReturnType<typeof setTimeout> | null} */
let deviceChangeTimer = null;

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
 * @param {number} volume 0..1
 * @param {string | undefined} kind
 * @param {number} id
 */
async function playCheerFanfare(volume, kind, id) {
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

	const roots = [261.63, 293.66, 329.63, 349.23, 392.0, 440.0]; // C4–A4
	const major = [0, 4, 7, 12];
	const pentatonic = [0, 2, 4, 7, 9];
	const scale = Math.random() < 0.5 ? major : pentatonic;
	const root = roots[Math.floor(Math.random() * roots.length)];
	const noteCount = 3 + Math.floor(Math.random() * 3); // 3–5
	const stepMs = 90 + Math.floor(Math.random() * 50);
	const noteDur = 0.18 + Math.random() * 0.1;

	const midiOffset = (semitones) => root * Math.pow(2, semitones / 12);

	function playTone(freq, startTime, duration, peak) {
		const osc = ctx.createOscillator();
		const gain = ctx.createGain();
		osc.type = Math.random() < 0.65 ? "triangle" : "sine";
		osc.frequency.value = freq;
		gain.gain.setValueAtTime(0.0001, startTime);
		gain.gain.exponentialRampToValueAtTime(peak, startTime + 0.02);
		gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
		osc.connect(gain);
		gain.connect(master);
		osc.start(startTime);
		osc.stop(startTime + duration + 0.02);
	}

	const t0 = ctx.currentTime + 0.02;
	for (let i = 0; i < noteCount; i++) {
		const deg = scale[Math.min(i, scale.length - 1)];
		const freq = midiOffset(deg);
		const start = t0 + (i * stepMs) / 1000;
		playTone(freq, start, noteDur, 0.7 + Math.random() * 0.25);
		if (i === noteCount - 1 && Math.random() < 0.7) {
			playTone(freq * 2, start + 0.04, noteDur * 0.7, 0.35);
		}
	}

	if (Math.random() < 0.85) {
		const dingStart = t0 + (noteCount * stepMs) / 1000 + 0.05;
		playTone(midiOffset(12 + Math.floor(Math.random() * 5)), dingStart, 0.22, 0.45);
	}

	const totalMs = noteCount * stepMs + noteDur * 1000 + 350;
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

		if (payload?.mode === "cheer") {
			void playCheerFanfare(volume, kind, id);
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
