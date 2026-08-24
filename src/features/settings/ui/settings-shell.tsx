import {
	BarChart3,
	Bug,
	Camera,
	Dumbbell,
	Info,
	Palette,
	Settings,
	Timer,
} from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { dismissBootSplash } from "@/boot-splash";
import { SettingGrid } from "@/components/setting-grid";
import { MAIN_SCROLL_CLASS, TabbedSection } from "@/components/tabbed-section";
import { useAutoUpdate } from "@/features/about/model/use-auto-update";
import { AboutPanel } from "@/features/about/ui/about-panel";
import { UpdateDialog } from "@/features/about/ui/update-dialog";
import { UpdateToast } from "@/features/about/ui/update-toast";
import { AchievementsPanel } from "@/features/achievements/ui/achievements-panel";
import { useCameraCalibration } from "@/features/camera/model/use-camera-calibration";
import type { useCameraStatus } from "@/features/camera/model/use-camera-status";
import {
	CameraControls,
	type CameraTabId,
} from "@/features/camera/ui/camera-controls";
import { DebugPanel } from "@/features/debug/ui/debug-panel";
import { ExerciseSettings } from "@/features/exercises/ui/exercise-settings";
import { EyeCareIndependenceSettings } from "@/features/exercises/ui/eye-care-independence-settings";
import { EyePromptsDisabledNotice } from "@/features/exercises/ui/eye-prompts-disabled-notice";
import { LookAwaySettings } from "@/features/look-away/ui/look-away-settings";
import { OnboardingWizard } from "@/features/onboarding/ui/onboarding-wizard";
import { PopupSettings } from "@/features/popup-appearance/ui/popup-settings";
import { ProfilePanel } from "@/features/profile/ui/profile-panel";
import { ReminderControls } from "@/features/reminders/ui/reminder-controls";
import { RewardsShopPanel } from "@/features/rewards/ui/rewards-shop-panel";
import type { usePreferences } from "@/features/settings/model/use-preferences";
import { BackupSettings } from "@/features/settings/ui/backup-settings";
import { DarkModeToggle } from "@/features/settings/ui/dark-mode-toggle";
import { GoalsSettings } from "@/features/settings/ui/goals-settings";
import { LanguageSettings } from "@/features/settings/ui/language-settings";
import { LaunchAtLoginSettings } from "@/features/settings/ui/launch-at-login-settings";
import { NotificationStyleSettings } from "@/features/settings/ui/notification-style-settings";
import { QuietHoursFocusSettings } from "@/features/settings/ui/quiet-hours-focus-settings";
import { ResetPreferencesButton } from "@/features/settings/ui/reset-preferences-button";
import { SettingsProfilesPanel } from "@/features/settings/ui/settings-profiles-panel";
import { SoundSettings } from "@/features/settings/ui/sound-settings";
import { TrackingEyeButton } from "@/features/settings/ui/tracking-eye-button";
import type { useShortcutControls } from "@/features/shortcuts/model/use-shortcut-controls";
import { ShortcutSettings } from "@/features/shortcuts/ui/shortcut-settings";
import { StatisticsPanel } from "@/features/statistics/ui/statistics-panel";
import { useT } from "@/i18n";
import { cn } from "@/lib/utils";
import { rendererIpc } from "@/shared/ipc/renderer-ipc";
import { theme } from "../../../../shared/theme";

type SectionId =
	| "reminders"
	| "camera"
	| "exercises"
	| "appearance"
	| "progress"
	| "settings"
	| "about"
	| "debug";

type ProgressTabId = "statistics" | "profile" | "achievements" | "rewards";
type RemindersTabId = "schedule" | "pause";
type SettingsTabId = "general" | "data";

function CameraSection({
	preferences,
	setPreferences,
	camera,
	tab,
	onTabChange,
}: {
	preferences: ReturnType<typeof usePreferences>["preferences"];
	setPreferences: ReturnType<typeof usePreferences>["setPreferences"];
	camera: ReturnType<typeof useCameraStatus>;
	tab: CameraTabId;
	onTabChange: (id: CameraTabId) => void;
}) {
	const t = useT();
	const calibration = useCameraCalibration(preferences, setPreferences);
	const cameraTabs = [
		{ id: "setup" as const, label: t("app.camera.tab.setup") },
		{ id: "tuning" as const, label: t("app.camera.tab.tuning") },
	];
	return (
		<TabbedSection
			aria-label={t("app.camera.tabsAria")}
			items={cameraTabs}
			value={tab}
			onChange={onTabChange}
			maxWidthClass="max-w-3xl"
		>
			<CameraControls
				tab={tab}
				preferences={preferences}
				setPreferences={setPreferences}
				isWindowOpen={camera.isWindowOpen}
				setIsWindowOpen={camera.setIsWindowOpen}
				calibration={calibration}
				error={camera.error}
				onDismissError={() => camera.setError(null)}
				captureSurface={camera.captureSurface}
			/>
		</TabbedSection>
	);
}

export function SettingsShell({
	preferences,
	setPreferences,
	prefsHydrated,
	toggleTracking,
	changeReminderInterval,
	camera,
	shortcuts,
}: {
	preferences: ReturnType<typeof usePreferences>["preferences"];
	setPreferences: ReturnType<typeof usePreferences>["setPreferences"];
	prefsHydrated: boolean;
	toggleTracking: () => void;
	changeReminderInterval: (seconds: number) => void;
	camera: ReturnType<typeof useCameraStatus>;
	shortcuts: ReturnType<typeof useShortcutControls>;
}) {
	const t = useT();
	const autoUpdate = useAutoUpdate();
	const [section, setSection] = useState<SectionId>("reminders");
	const [progressTab, setProgressTab] = useState<ProgressTabId>("statistics");
	const [cameraTab, setCameraTab] = useState<CameraTabId>("setup");
	const [remindersTab, setRemindersTab] = useState<RemindersTabId>("schedule");
	const [settingsTab, setSettingsTab] = useState<SettingsTabId>("general");
	const navRef = useRef<HTMLElement>(null);
	const [navPill, setNavPill] = useState<{
		top: number;
		left: number;
		width: number;
		height: number;
	} | null>(null);
	const sections: {
		id: SectionId;
		label: string;
		description: string;
		icon: typeof Timer;
	}[] = [
		{
			id: "reminders",
			label: t("app.section.reminders"),
			description: t("app.section.reminders.desc"),
			icon: Timer,
		},
		{
			id: "camera",
			label: t("app.section.camera"),
			description: t("app.section.camera.desc"),
			icon: Camera,
		},
		{
			id: "exercises",
			label: t("app.section.exercises"),
			description: t("app.section.exercises.desc"),
			icon: Dumbbell,
		},
		{
			id: "appearance",
			label: t("app.section.appearance"),
			description: t("app.section.appearance.desc"),
			icon: Palette,
		},
		{
			id: "progress",
			label: t("app.section.progress"),
			description: t("app.section.progress.desc"),
			icon: BarChart3,
		},
		{
			id: "settings",
			label: t("app.section.settings"),
			description: t("app.section.settings.desc"),
			icon: Settings,
		},
		{
			id: "about",
			label: t("app.section.about"),
			description: t("app.section.about.desc"),
			icon: Info,
		},
		// Debug must always be the last nav section (DEV-only).
		...(import.meta.env.DEV
			? [
					{
						id: "debug" as const,
						label: t("app.section.debug"),
						description: t("app.section.debug.desc"),
						icon: Bug,
					},
				]
			: []),
	];
	const progressTabs = [
		{ id: "statistics" as const, label: t("app.progress.tab.statistics") },
		{ id: "profile" as const, label: t("app.progress.tab.profile") },
		{ id: "achievements" as const, label: t("app.progress.tab.achievements") },
		{ id: "rewards" as const, label: t("app.progress.tab.rewards") },
	];
	const remindersTabs = [
		{ id: "schedule" as const, label: t("app.reminders.tab.schedule") },
		{ id: "pause" as const, label: t("app.reminders.tab.pause") },
	];
	const settingsTabs = [
		{ id: "general" as const, label: t("app.settings.tab.general") },
		{ id: "data" as const, label: t("app.settings.tab.data") },
	];
	const active = sections.find((item) => item.id === section) ?? sections[0];
	const showOnboarding = prefsHydrated && !preferences.hasCompletedOnboarding;

	useEffect(() => {
		if (!prefsHydrated) return;
		void (async () => {
			await dismissBootSplash();
			// Main DeferredTrackingRestore is one-shot; duplicates (Strict Mode) are fine.
			rendererIpc.notifyShellReady();
		})();
	}, [prefsHydrated]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: selected item is queried after render when `section` changes
	useLayoutEffect(() => {
		const nav = navRef.current;
		if (!nav) return;
		const selected = nav.querySelector('[aria-current="page"]');
		if (!(selected instanceof HTMLElement)) return;
		const update = () => {
			const navBox = nav.getBoundingClientRect();
			const btnBox = selected.getBoundingClientRect();
			setNavPill({
				top: btnBox.top - navBox.top + nav.scrollTop,
				left: btnBox.left - navBox.left + nav.scrollLeft,
				width: btnBox.width,
				height: btnBox.height,
			});
		};
		update();
		const observer = new ResizeObserver(update);
		observer.observe(nav);
		observer.observe(selected);
		return () => observer.disconnect();
	}, [section]);

	return (
		<div className="flex h-full min-h-0 flex-col overflow-hidden bg-background text-foreground min-[820px]:flex-row">
			{showOnboarding ? (
				<OnboardingWizard
					preferences={preferences}
					setPreferences={setPreferences}
					shortcut={shortcuts}
				/>
			) : null}
			<UpdateToast {...autoUpdate} />
			<UpdateDialog {...autoUpdate} />
			<aside className="flex shrink-0 flex-col border-b border-border bg-sidebar min-[820px]:w-56 min-[820px]:border-r min-[820px]:border-b-0">
				<div className="flex items-center gap-2.5 px-4 py-3 min-[820px]:px-5 min-[820px]:py-5">
					<TrackingEyeButton
						isTracking={preferences.isTracking}
						onToggle={toggleTracking}
					/>
					<div className="min-w-0">
						<h1 className="text-base font-semibold tracking-tight">
							BlinkGuard
						</h1>
						<p className="hidden text-xs text-muted-foreground min-[820px]:block">
							{t("app.tagline")}
						</p>
					</div>
				</div>

				<nav
					ref={navRef}
					aria-label={t("app.navAria")}
					className="relative flex gap-1 overflow-x-auto px-3 pb-3 min-[820px]:flex-1 min-[820px]:flex-col min-[820px]:items-stretch min-[820px]:overflow-visible min-[820px]:px-3 min-[820px]:pb-0"
				>
					{navPill ? (
						<span
							aria-hidden
							className="pointer-events-none absolute top-0 left-0 rounded-md bg-sidebar-active transition-[transform,width,height] duration-200 ease-out motion-reduce:transition-none"
							style={{
								width: navPill.width,
								height: navPill.height,
								transform: `translate(${navPill.left}px, ${navPill.top}px)`,
							}}
						/>
					) : null}
					{sections.map((item) => {
						const Icon = item.icon;
						const selected = item.id === section;
						const showAttention =
							item.id === "camera" &&
							Boolean(camera.error) &&
							section !== "camera";
						return (
							<button
								key={item.id}
								type="button"
								aria-current={selected ? "page" : undefined}
								onClick={() => setSection(item.id)}
								className={cn(
									"relative z-10 inline-flex shrink-0 items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors min-[820px]:w-full",
									selected
										? "text-primary"
										: "text-sidebar-foreground hover:bg-muted",
								)}
							>
								<Icon className="h-4 w-4 shrink-0" aria-hidden />
								{item.label}
								{showAttention ? (
									<span
										className="ml-auto h-2 w-2 shrink-0 rounded-full bg-destructive"
										role="img"
										aria-label={t("app.navNeedsAttention")}
									/>
								) : null}
							</button>
						);
					})}
				</nav>

				<div className="hidden border-t border-border p-3 min-[820px]:block">
					<DarkModeToggle
						darkMode={preferences.darkMode}
						setPreferences={setPreferences}
						variant="row"
					/>
				</div>
			</aside>

			<div className="flex min-h-0 min-w-0 flex-1 flex-col">
				<header className="flex items-start justify-between gap-3 border-b border-border px-4 py-4 sm:px-6">
					<div className="min-w-0">
						<h2 className="text-lg font-semibold tracking-tight sm:text-xl">
							{active.label}
						</h2>
						<p className="mt-0.5 text-sm text-muted-foreground">
							{active.description}
						</p>
					</div>
					<div className="shrink-0 min-[820px]:hidden">
						<DarkModeToggle
							darkMode={preferences.darkMode}
							setPreferences={setPreferences}
						/>
					</div>
				</header>

				<main className="flex min-h-0 flex-1 flex-col overflow-hidden">
					<div
						key={section}
						className={cn(
							"flex min-h-0 flex-1 flex-col overflow-hidden",
							theme.recipe.enter,
						)}
					>
						{section === "progress" ? (
							<TabbedSection
								aria-label={t("app.progress.tabsAria")}
								items={progressTabs}
								value={progressTab}
								onChange={setProgressTab}
								maxWidthClass="max-w-4xl"
							>
								{progressTab === "statistics" && (
									<>
										<GoalsSettings
											preferences={preferences}
											setPreferences={setPreferences}
										/>
										<StatisticsPanel />
									</>
								)}
								{progressTab === "profile" && <ProfilePanel />}
								{progressTab === "achievements" && <AchievementsPanel />}
								{progressTab === "rewards" && <RewardsShopPanel />}
							</TabbedSection>
						) : section === "camera" ? (
							<CameraSection
								preferences={preferences}
								setPreferences={setPreferences}
								camera={camera}
								tab={cameraTab}
								onTabChange={setCameraTab}
							/>
						) : section === "reminders" ? (
							<TabbedSection
								aria-label={t("app.reminders.tabsAria")}
								items={remindersTabs}
								value={remindersTab}
								onChange={setRemindersTab}
								maxWidthClass="max-w-3xl"
							>
								{remindersTab === "schedule" ? (
									<ReminderControls
										preferences={preferences}
										setPreferences={setPreferences}
										onIntervalChange={changeReminderInterval}
										onToggleTracking={toggleTracking}
									/>
								) : (
									<QuietHoursFocusSettings
										preferences={preferences}
										setPreferences={setPreferences}
									/>
								)}
							</TabbedSection>
						) : section === "settings" ? (
							<TabbedSection
								aria-label={t("app.settings.tabsAria")}
								items={settingsTabs}
								value={settingsTab}
								onChange={setSettingsTab}
								maxWidthClass="max-w-3xl"
							>
								{settingsTab === "general" ? (
									<>
										<ShortcutSettings
											shortcuts={preferences.keyboardShortcuts}
											activeAction={shortcuts.activeAction}
											temporaryShortcut={shortcuts.temporaryShortcut}
											errorMessage={shortcuts.errorMessage}
											onStartRecording={shortcuts.startRecording}
											onSave={shortcuts.save}
											onCancel={shortcuts.cancel}
											onClear={shortcuts.clear}
										/>
										<SettingGrid>
											<LanguageSettings
												preferences={preferences}
												setPreferences={setPreferences}
											/>
											<LaunchAtLoginSettings
												preferences={preferences}
												setPreferences={setPreferences}
											/>
										</SettingGrid>
									</>
								) : (
									<>
										<SettingsProfilesPanel active={settingsTab === "data"} />
										<BackupSettings />
										<ResetPreferencesButton />
									</>
								)}
							</TabbedSection>
						) : section === "about" ? (
							<AboutPanel autoUpdate={autoUpdate} />
						) : section === "debug" && import.meta.env.DEV ? (
							<DebugPanel setPreferences={setPreferences} />
						) : (
							<div key={section} className={MAIN_SCROLL_CLASS}>
								<div className="mx-auto flex max-w-3xl flex-col gap-4">
									{section === "exercises" && (
										<>
											<EyePromptsDisabledNotice
												eyeExercisesEnabled={preferences.eyeExercisesEnabled}
												lookAwayEnabled={preferences.lookAwayEnabled}
											/>
											<EyeCareIndependenceSettings
												preferences={preferences}
												setPreferences={setPreferences}
											/>
											<ExerciseSettings
												preferences={preferences}
												setPreferences={setPreferences}
											/>
											<LookAwaySettings
												preferences={preferences}
												setPreferences={setPreferences}
											/>
										</>
									)}

									{section === "appearance" && (
										<>
											<PopupSettings
												preferences={preferences}
												setPreferences={setPreferences}
											/>
											<NotificationStyleSettings
												preferences={preferences}
												setPreferences={setPreferences}
											/>
											<SoundSettings
												preferences={preferences}
												setPreferences={setPreferences}
											/>
										</>
									)}
								</div>
							</div>
						)}
					</div>
				</main>
			</div>
		</div>
	);
}
