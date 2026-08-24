import { ChevronDown } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/button";
import { Reveal } from "@/components/reveal";
import { SettingPanel } from "@/components/setting-panel";
import { SettingRow } from "@/components/setting-row";
import { StatusBanner } from "@/components/status-banner";
import type { SettingsPreferences } from "@/features/settings/model/preferences";
import type { SetPreferences } from "@/features/settings/model/use-preferences";
import { useT } from "@/i18n";
import { rendererIpc } from "@/shared/ipc/renderer-ipc";
import {
	type CameraDeviceInfo,
	type CameraDeviceNotice,
	cameraDeviceOptionValue,
	findCameraDeviceByOptionValue,
} from "../../../../shared/camera-devices";

interface CameraDevicePickerProps {
	preferences: SettingsPreferences;
	setPreferences: SetPreferences;
}

const AUTO_VALUE = "";

export function CameraDevicePicker({
	preferences,
	setPreferences,
}: CameraDevicePickerProps) {
	const t = useT();
	const [devices, setDevices] = useState<CameraDeviceInfo[]>([]);
	const [notice, setNotice] = useState<CameraDeviceNotice | null>(null);
	const [listing, setListing] = useState(false);

	const refresh = useCallback(async () => {
		setListing(true);
		try {
			const payload = await rendererIpc.listCameraDevices();
			setDevices(payload.devices);
		} finally {
			setListing(false);
		}
	}, []);

	useEffect(() => {
		const offDevices = rendererIpc.onCameraDevices((payload) => {
			setDevices(payload.devices);
		});
		const offNotice = rendererIpc.onCameraDeviceNotice((next) => {
			setNotice(next);
		});
		void refresh();
		return () => {
			offDevices();
			offNotice();
		};
	}, [refresh]);

	const selected = preferences.cameraDevice;
	const selectedValue = selected
		? cameraDeviceOptionValue(selected)
		: AUTO_VALUE;
	const selectedInList = Boolean(
		selected && findCameraDeviceByOptionValue(devices, selectedValue),
	);

	const onChange = (value: string) => {
		setNotice(null);
		if (value === AUTO_VALUE) {
			setPreferences((current) => ({ ...current, cameraDevice: null }));
			return;
		}
		const fromList = findCameraDeviceByOptionValue(devices, value);
		if (!fromList) return;
		setPreferences((current) => ({
			...current,
			cameraDevice: {
				id: fromList.id,
				index: fromList.index,
				name: fromList.name,
			},
		}));
	};

	const noticeName = notice?.name || selected?.name || "";
	const noticeText =
		notice === null
			? null
			: notice.code === "missing"
				? t("camera.deviceMissing", { name: noticeName })
				: t("camera.deviceFallback", { name: noticeName });

	return (
		<>
			<SettingPanel>
				<SettingRow
					title={t("camera.device")}
					description={t("camera.deviceDesc")}
					action={
						<Button
							type="button"
							size="sm"
							variant="outline"
							disabled={listing}
							onClick={() => void refresh()}
						>
							{t("camera.deviceRefresh")}
						</Button>
					}
				>
					<div className="relative max-w-md">
						<select
							aria-label={t("camera.deviceAria")}
							value={selectedValue}
							onChange={(event) => onChange(event.target.value)}
							className="w-full appearance-none rounded-md border border-border bg-background py-1.5 pl-2.5 pr-9 text-sm text-foreground"
						>
							<option value={AUTO_VALUE}>{t("camera.deviceAuto")}</option>
							{devices.map((device) => {
								const value = cameraDeviceOptionValue(device);
								return (
									<option key={value} value={value}>
										{device.name}
									</option>
								);
							})}
							{selected && !selectedInList ? (
								<option value={selectedValue}>
									{t("camera.deviceUnavailable", {
										name: selected.name || selected.id,
									})}
								</option>
							) : null}
						</select>
						<ChevronDown
							className="pointer-events-none absolute top-1/2 right-2.5 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
							aria-hidden
						/>
					</div>
					{devices.length === 0 ? (
						<p className="mt-2 text-xs text-muted-foreground">
							{t("camera.deviceEmpty")}
						</p>
					) : null}
				</SettingRow>
			</SettingPanel>
			<Reveal variant="fade" open={Boolean(noticeText)}>
				{noticeText ? (
					<StatusBanner variant="warning" className="px-4 py-3" role="status">
						<div className="flex items-center justify-between gap-3">
							<p className="min-w-0 text-sm">{noticeText}</p>
							<button
								type="button"
								aria-label={t("camera.dismissDeviceNotice")}
								onClick={() => setNotice(null)}
								className="shrink-0 text-lg leading-none opacity-70 hover:opacity-100"
							>
								×
							</button>
						</div>
					</StatusBanner>
				) : null}
			</Reveal>
		</>
	);
}
