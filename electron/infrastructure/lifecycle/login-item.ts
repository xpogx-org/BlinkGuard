import { app } from "electron";

/** Apply OS login-item settings so the app can start hidden to tray. */
export function applyLaunchAtLogin(enabled: boolean): void {
	app.setLoginItemSettings({
		openAtLogin: enabled,
		args: enabled ? ["--hidden"] : [],
	});
}
