import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { execMock } = vi.hoisted(() => ({
	execMock: vi.fn((_cmd: string, cb: (err: Error | null) => void) => {
		cb(null);
		return { kill() {} };
	}),
}));

vi.mock("node:child_process", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:child_process")>();
	const patched = { ...actual, exec: execMock };
	return { ...patched, default: { ...patched, exec: execMock } };
});

import { ChildProcessRegistry } from "../../../electron/infrastructure/process/child-process-registry";
import {
	GRACEFUL_SIDECAR_EXIT_MS,
	ProcessCleanup,
} from "../../../electron/infrastructure/process/process-cleanup";

type FakeStdin = {
	destroyed: boolean;
	writableEnded: boolean;
	write: (chunk?: string) => boolean;
	end: (chunk?: string) => void;
};

type FakeChild = EventEmitter & {
	pid: number;
	killed: boolean;
	exitCode: number | null;
	signalCode: NodeJS.Signals | null;
	stdin: FakeStdin;
};

function createFakeChild(pid: number, { exitOnEnd = false } = {}): FakeChild {
	const child = new EventEmitter() as FakeChild;
	child.pid = pid;
	child.killed = false;
	child.exitCode = null;
	child.signalCode = null;
	const write = vi.fn((_chunk?: string) => true);
	const stdin: FakeStdin = {
		destroyed: false,
		writableEnded: false,
		write,
		end: vi.fn((chunk?: string) => {
			if (chunk) write(chunk);
			stdin.writableEnded = true;
			if (exitOnEnd) {
				queueMicrotask(() => {
					child.exitCode = 0;
					child.emit("exit", 0, null);
				});
			}
		}),
	};
	child.stdin = stdin;
	return child;
}

function execCommands(): string[] {
	return execMock.mock.calls.map(([cmd]) => String(cmd));
}

describe("ProcessCleanup", () => {
	beforeEach(() => {
		execMock.mockClear();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("writes quit, ends stdin, and skips pid force-kill when the child exits", async () => {
		const child = createFakeChild(4242, { exitOnEnd: true });
		const processes = new ChildProcessRegistry();
		processes.add(child as never);
		const cleanup = new ProcessCleanup(processes);
		await cleanup.run();
		expect(child.stdin.end).toHaveBeenCalledWith('{"quit":true}\n');
		expect(execCommands().some((cmd) => cmd.includes("/pid 4242"))).toBe(false);
		expect(
			execCommands().some((cmd) =>
				cmd.includes("taskkill /im blink_detector.exe"),
			),
		).toBe(false);
		expect(processes.size).toBe(0);
	});

	it("force-kills after the graceful timeout if the child stays alive", async () => {
		vi.useFakeTimers();
		const child = createFakeChild(4242);
		const processes = new ChildProcessRegistry();
		processes.add(child as never);
		const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
		const cleanup = new ProcessCleanup(processes);
		const running = cleanup.run();
		await vi.advanceTimersByTimeAsync(GRACEFUL_SIDECAR_EXIT_MS);
		await running;
		expect(child.stdin.end).toHaveBeenCalledWith('{"quit":true}\n');
		if (process.platform === "win32") {
			expect(
				execCommands().some((cmd) => cmd.includes("taskkill /pid 4242 /t /f")),
			).toBe(true);
			expect(
				execCommands().some((cmd) =>
					cmd.includes("taskkill /im blink_detector.exe /f /t"),
				),
			).toBe(true);
		} else {
			expect(killSpy).toHaveBeenCalledWith(4242, "SIGTERM");
		}
		killSpy.mockRestore();
	});
});
