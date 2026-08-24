import {
	Camera,
	Gamepad2,
	Keyboard,
	Languages,
	LogIn,
	Moon,
	Play,
	Timer,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/button";
import { Reveal } from "@/components/reveal";
import { SettingPanel } from "@/components/setting-panel";
import { ToggleSwitch } from "@/components/toggle-switch";
import { applyLocale } from "@/features/settings/model/apply-locale";
import type { SettingsPreferences } from "@/features/settings/model/preferences";
import type { SetPreferences } from "@/features/settings/model/use-preferences";
import type { useShortcutControls } from "@/features/shortcuts/model/use-shortcut-controls";
import { ShortcutSettings } from "@/features/shortcuts/ui/shortcut-settings";
import { useT } from "@/i18n";
import { cn } from "@/lib/utils";
import { rendererIpc } from "@/shared/ipc/renderer-ipc";
import type { Locale } from "../../../../shared/i18n";
import { theme } from "../../../../shared/theme";

interface OnboardingWizardProps {
	preferences: SettingsPreferences;
	setPreferences: SetPreferences;
	shortcut: ReturnType<typeof useShortcutControls>;
}

export function OnboardingWizard({
	preferences,
	setPreferences,
	shortcut,
}: OnboardingWizardProps) {
	const t = useT();
	const [stepIndex, setStepIndex] = useState(0);
	const [stepDirection, setStepDirection] = useState<1 | -1>(1);
	const [fullscreenDetectionSupported, setFullscreenDetectionSupported] =
		useState<boolean | null>(null);

	useEffect(
		() =>
			rendererIpc.onFocusPauseState((payload) => {
				setFullscreenDetectionSupported(payload.fullscreenDetectionSupported);
			}),
		[],
	);

	const steps = [
		{
			id: "language" as const,
			title: t("onboarding.step.language"),
			label: t("onboarding.step.languageLabel"),
		},
		{
			id: "mode" as const,
			title: t("onboarding.step.mode"),
			label: t("onboarding.step.modeLabel"),
		},
		{
			id: "shortcut" as const,
			title: t("onboarding.step.shortcut"),
			label: t("onboarding.step.shortcutLabel"),
		},
		{
			id: "quiet" as const,
			title: t("onboarding.step.quiet"),
			label: t("onboarding.step.quietLabel"),
		},
		{
			id: "ready" as const,
			title: t("onboarding.step.ready"),
			label: t("onboarding.step.readyLabel"),
		},
	];
	const isLast = stepIndex === steps.length - 1;
	const step = steps[stepIndex];
	const fullscreenUnsupported = fullscreenDetectionSupported === false;

	const complete = () => {
		setPreferences((current) => ({
			...current,
			hasCompletedOnboarding: true,
		}));
	};

	const selectLocale = (locale: Locale) => {
		setPreferences((current) => applyLocale(current, locale));
	};

	return (
		<div
			className={cn(
				"fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm",
				theme.recipe.overlay,
			)}
			role="dialog"
			aria-modal="true"
			aria-labelledby="onboarding-title"
		>
			<SettingPanel
				className={cn(
					"flex w-full max-w-lg flex-col gap-5 shadow-lg",
					theme.recipe.dialog,
				)}
			>
				<div className="space-y-1">
					<p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
						{t("onboarding.welcome")}
					</p>
					<h2
						id="onboarding-title"
						className="text-xl font-semibold tracking-tight"
					>
						{step.title}
					</h2>
					<p className="text-sm text-muted-foreground">
						{t("onboarding.subtitle")}
					</p>
				</div>

				<div className="flex items-center gap-2">
					{steps.map((item, index) => (
						<span
							key={item.id}
							className={cn(
								"h-1.5 flex-1 rounded-full transition-colors",
								index <= stepIndex ? "bg-primary" : "bg-muted",
							)}
							aria-hidden
						/>
					))}
				</div>

				<div
					key={step.id}
					className={cn(
						"min-h-40",
						stepDirection >= 0 ? "motion-step-forward" : "motion-step-back",
					)}
				>
					{step.id === "language" ? (
						<div className="space-y-3">
							<p className="flex items-start gap-2 text-sm text-muted-foreground">
								<Languages className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
								{t("onboarding.languageDesc")}
							</p>
							<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
								<button
									type="button"
									onClick={() => selectLocale("en")}
									className={cn(
										"rounded-lg border p-4 text-left transition-colors",
										preferences.locale === "en"
											? "border-primary bg-primary/10"
											: "border-border hover:bg-muted",
									)}
									aria-pressed={preferences.locale === "en"}
								>
									<p className="text-sm font-medium">{t("language.en")}</p>
								</button>
								<button
									type="button"
									onClick={() => selectLocale("uk")}
									className={cn(
										"rounded-lg border p-4 text-left transition-colors",
										preferences.locale === "uk"
											? "border-primary bg-primary/10"
											: "border-border hover:bg-muted",
									)}
									aria-pressed={preferences.locale === "uk"}
								>
									<p className="text-sm font-medium">{t("language.uk")}</p>
								</button>
							</div>
						</div>
					) : null}

					{step.id === "mode" ? (
						<div className="space-y-3">
							<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
								<button
									type="button"
									onClick={() =>
										setPreferences((current) => ({
											...current,
											cameraEnabled: false,
										}))
									}
									className={cn(
										"rounded-lg border p-4 text-left transition-colors",
										!preferences.cameraEnabled
											? "border-primary bg-primary/10"
											: "border-border hover:bg-muted",
									)}
									aria-pressed={!preferences.cameraEnabled}
								>
									<Timer
										className="mb-2 h-5 w-5 text-muted-foreground"
										aria-hidden
									/>
									<p className="text-sm font-medium">{t("onboarding.timer")}</p>
									<p className="mt-1 text-xs text-muted-foreground">
										{t("onboarding.timerDesc")}
									</p>
								</button>
								<button
									type="button"
									onClick={() =>
										setPreferences((current) => ({
											...current,
											cameraEnabled: true,
										}))
									}
									className={cn(
										"rounded-lg border p-4 text-left transition-colors",
										preferences.cameraEnabled
											? "border-primary bg-primary/10"
											: "border-border hover:bg-muted",
									)}
									aria-pressed={preferences.cameraEnabled}
								>
									<Camera
										className="mb-2 h-5 w-5 text-muted-foreground"
										aria-hidden
									/>
									<p className="text-sm font-medium">
										{t("onboarding.camera")}
									</p>
									<p className="mt-1 text-xs text-muted-foreground">
										{t("onboarding.cameraDesc")}
									</p>
								</button>
							</div>
							<p className="text-xs text-muted-foreground">
								{t("onboarding.modeCameraNote")}
							</p>
						</div>
					) : null}

					{step.id === "shortcut" ? (
						<div className="space-y-3">
							<p className="flex items-start gap-2 text-sm text-muted-foreground">
								<Keyboard className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
								{t("onboarding.shortcutHint")}
							</p>
							<ShortcutSettings
								shortcuts={preferences.keyboardShortcuts}
								activeAction={shortcut.activeAction}
								temporaryShortcut={shortcut.temporaryShortcut}
								errorMessage={shortcut.errorMessage}
								onStartRecording={shortcut.startRecording}
								onSave={shortcut.save}
								onCancel={shortcut.cancel}
								onClear={shortcut.clear}
								actions={["trackingToggle"]}
								footerNote={t("onboarding.shortcutMoreInSettings")}
							/>
						</div>
					) : null}

					{step.id === "quiet" ? (
						<div className="space-y-4">
							<div className="space-y-3">
								<div className="flex items-center justify-between gap-4">
									<p className="flex min-w-0 items-center gap-2 text-sm font-medium">
										<Moon
											className="h-4 w-4 shrink-0 text-muted-foreground"
											aria-hidden
										/>
										{t("quietHours.title")}
									</p>
									<div className="shrink-0">
										<ToggleSwitch
											aria-label={t("quietHours.toggleAria")}
											checked={preferences.quietHoursEnabled}
											onChange={() =>
												setPreferences((current) => ({
													...current,
													quietHoursEnabled: !current.quietHoursEnabled,
												}))
											}
										/>
									</div>
								</div>
								<p className="text-xs text-muted-foreground sm:text-sm">
									{t("onboarding.quietDesc")}
								</p>
								<Reveal open={preferences.quietHoursEnabled}>
									<div className="flex flex-wrap items-center gap-3">
										<label className="flex items-center gap-2 text-sm text-muted-foreground">
											<span>{t("common.from")}</span>
											<input
												type="time"
												value={preferences.quietHoursStart}
												onChange={(event) =>
													setPreferences((current) => ({
														...current,
														quietHoursStart: event.target.value,
													}))
												}
												className="rounded-md border border-border bg-background px-2 py-1 text-foreground"
											/>
										</label>
										<label className="flex items-center gap-2 text-sm text-muted-foreground">
											<span>{t("common.to")}</span>
											<input
												type="time"
												value={preferences.quietHoursEnd}
												onChange={(event) =>
													setPreferences((current) => ({
														...current,
														quietHoursEnd: event.target.value,
													}))
												}
												className="rounded-md border border-border bg-background px-2 py-1 text-foreground"
											/>
										</label>
									</div>
								</Reveal>
							</div>

							<div className="space-y-3 border-t border-border pt-4">
								<div className="flex items-center justify-between gap-4">
									<p className="flex min-w-0 items-center gap-2 text-sm font-medium">
										<Gamepad2
											className="h-4 w-4 shrink-0 text-muted-foreground"
											aria-hidden
										/>
										{t("fullscreen.title")}
									</p>
									<div className="shrink-0">
										<ToggleSwitch
											aria-label={t("fullscreen.toggleAria")}
											checked={preferences.pauseOnFullscreen}
											disabled={fullscreenUnsupported}
											onChange={() =>
												setPreferences((current) => ({
													...current,
													pauseOnFullscreen: !current.pauseOnFullscreen,
												}))
											}
										/>
									</div>
								</div>
								<p className="text-xs text-muted-foreground sm:text-sm">
									{fullscreenUnsupported
										? t("fullscreen.unsupportedDescription")
										: t("fullscreen.description")}
								</p>
							</div>
						</div>
					) : null}

					{step.id === "ready" ? (
						<div className="space-y-4">
							<p className="flex items-start gap-2 text-sm text-muted-foreground">
								<Play className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
								{preferences.keyboardShortcuts.trackingToggle
									? t("onboarding.readyDesc", {
											shortcut: preferences.keyboardShortcuts.trackingToggle,
										})
									: t("onboarding.readyDescUnbound")}
							</p>
							<div className="space-y-3 border-t border-border pt-4">
								<div className="flex items-center justify-between gap-4">
									<p className="flex min-w-0 items-center gap-2 text-sm font-medium">
										<LogIn
											className="h-4 w-4 shrink-0 text-muted-foreground"
											aria-hidden
										/>
										{t("launch.title")}
									</p>
									<div className="shrink-0">
										<ToggleSwitch
											aria-label={t("launch.toggleAria")}
											checked={preferences.launchAtLogin}
											onChange={() =>
												setPreferences((current) => ({
													...current,
													launchAtLogin: !current.launchAtLogin,
												}))
											}
										/>
									</div>
								</div>
								<p className="text-xs text-muted-foreground sm:text-sm">
									{t("onboarding.launchDesc")}
								</p>
							</div>
						</div>
					) : null}
				</div>

				<div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
					<Button type="button" variant="ghost" onClick={complete}>
						{t("common.skip")}
					</Button>
					<div className="flex gap-2">
						{stepIndex > 0 ? (
							<Button
								type="button"
								variant="secondary"
								onClick={() => {
									setStepDirection(-1);
									setStepIndex((current) => current - 1);
								}}
							>
								{t("common.back")}
							</Button>
						) : null}
						{isLast ? (
							<Button type="button" onClick={complete}>
								{t("common.finish")}
							</Button>
						) : (
							<Button
								type="button"
								onClick={() => {
									setStepDirection(1);
									setStepIndex((current) => current + 1);
								}}
							>
								{t("common.next")}
							</Button>
						)}
					</div>
				</div>
			</SettingPanel>
		</div>
	);
}
