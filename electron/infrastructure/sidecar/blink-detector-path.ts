import { existsSync } from "node:fs";
import path from "node:path";

export function resolveBlinkDetectorExecutablePath(
	root: string,
	isProd: boolean,
): string {
	const basePath = isProd
		? path.join(
				process.resourcesPath,
				"app.asar.unpacked",
				"electron",
				"resources",
				"blink_detector",
			)
		: path.join(root, "electron", "resources", "blink_detector");
	return process.platform === "win32" ? `${basePath}.exe` : basePath;
}

export function isBlinkDetectorBinaryPresent(
	root: string,
	isProd: boolean,
): boolean {
	return existsSync(resolveBlinkDetectorExecutablePath(root, isProd));
}
