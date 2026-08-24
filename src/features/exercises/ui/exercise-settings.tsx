import { Clock, Dumbbell, Plus, RotateCcw, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/button";
import { RangeSlider } from "@/components/range-slider";
import { Reveal } from "@/components/reveal";
import { SettingPanel } from "@/components/setting-panel";
import { SettingRow } from "@/components/setting-row";
import { ToggleSwitch } from "@/components/toggle-switch";
import type { SettingsPreferences } from "@/features/settings/model/preferences";
import type { SetPreferences } from "@/features/settings/model/use-preferences";
import { useI18n } from "@/i18n";
import { defaultExercisePrompts, pluralKey } from "../../../../shared/i18n";

interface ExerciseSettingsProps {
	preferences: SettingsPreferences;
	setPreferences: SetPreferences;
}

export function ExerciseSettings({
	preferences,
	setPreferences,
}: ExerciseSettingsProps) {
	const { t, locale } = useI18n();
	const [promptsOpen, setPromptsOpen] = useState(false);
	const prompts = preferences.exercisePrompts;
	const descKey = pluralKey(
		"exercises.desc",
		locale,
		preferences.exerciseInterval,
	);
	const updatePrompt = (index: number, value: string) => {
		setPreferences((current) => {
			const next = [...current.exercisePrompts];
			next[index] = value;
			return { ...current, exercisePrompts: next };
		});
	};

	const addPrompt = () => {
		setPreferences((current) => ({
			...current,
			exercisePrompts: [...current.exercisePrompts, t("exercises.newPrompt")],
		}));
	};

	const removePrompt = (index: number) => {
		setPreferences((current) => {
			if (current.exercisePrompts.length <= 1) return current;
			return {
				...current,
				exercisePrompts: current.exercisePrompts.filter((_, i) => i !== index),
			};
		});
	};

	const resetPrompts = () => {
		setPreferences((current) => ({
			...current,
			exercisePrompts: [...defaultExercisePrompts(current.locale)],
		}));
	};

	return (
		<SettingPanel>
			<SettingRow
				title={
					<>
						<Dumbbell className="h-4 w-4 text-muted-foreground" aria-hidden />
						{t("exercises.title")}
					</>
				}
				description={t(descKey, { n: preferences.exerciseInterval })}
				action={
					<ToggleSwitch
						aria-label={t("exercises.toggleAria")}
						checked={preferences.eyeExercisesEnabled}
						onChange={() =>
							setPreferences((current) => ({
								...current,
								eyeExercisesEnabled: !current.eyeExercisesEnabled,
							}))
						}
					/>
				}
			>
				<Reveal open={preferences.eyeExercisesEnabled}>
					<div className="space-y-3 border-t border-border pt-3">
						<div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
							<Clock className="h-3 w-3" aria-hidden />
							{t("common.interval")}
						</div>
						<div className="flex items-center gap-2">
							<RangeSlider
								aria-label={t("exercises.intervalAria")}
								min={5}
								max={60}
								value={preferences.exerciseInterval}
								onChange={(exerciseInterval) =>
									setPreferences((current) => ({
										...current,
										exerciseInterval,
									}))
								}
								className="h-1.5 flex-1"
							/>
							<div className="min-w-[2.5rem] text-center text-xs font-medium text-primary">
								{preferences.exerciseInterval}m
							</div>
						</div>

						<div className="flex items-center justify-between gap-2 border-t border-border pt-3">
							<div className="text-xs font-medium text-muted-foreground">
								{t("exercises.prompts")}
							</div>
							<Button
								type="button"
								size="sm"
								variant="secondary"
								aria-expanded={promptsOpen}
								onClick={() => setPromptsOpen((open) => !open)}
							>
								<span className="inline-grid grid-cols-1 grid-rows-1 place-items-center">
									<span
										className="invisible col-start-1 row-start-1 whitespace-nowrap"
										aria-hidden
									>
										{t("exercises.showPrompts")}
									</span>
									<span
										className="invisible col-start-1 row-start-1 whitespace-nowrap"
										aria-hidden
									>
										{t("exercises.hidePrompts")}
									</span>
									<span className="col-start-1 row-start-1 whitespace-nowrap">
										{promptsOpen
											? t("exercises.hidePrompts")
											: t("exercises.showPrompts")}
									</span>
								</span>
							</Button>
						</div>

						<Reveal open={promptsOpen}>
							<div className="space-y-2">
								<div className="flex justify-end">
									<button
										type="button"
										onClick={resetPrompts}
										className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
									>
										<RotateCcw className="h-3 w-3" aria-hidden />
										{t("exercises.resetDefaults")}
									</button>
								</div>
								<div className="space-y-2">
									{prompts.map((prompt, index) => (
										// biome-ignore lint/suspicious/noArrayIndexKey: editable prefs rows use index as identity
										<div key={index} className="flex items-start gap-2">
											<textarea
												aria-label={t("exercises.promptAria", {
													n: index + 1,
												})}
												value={prompt}
												rows={2}
												onChange={(event) =>
													updatePrompt(index, event.target.value)
												}
												className="min-h-[2.5rem] flex-1 resize-y rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
											/>
											<button
												type="button"
												aria-label={t("exercises.removeAria", {
													n: index + 1,
												})}
												disabled={prompts.length <= 1}
												onClick={() => removePrompt(index)}
												className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
											>
												<Trash2 className="h-3.5 w-3.5" aria-hidden />
											</button>
										</div>
									))}
								</div>
								<button
									type="button"
									onClick={addPrompt}
									className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
								>
									<Plus className="h-3 w-3" aria-hidden />
									{t("exercises.addPrompt")}
								</button>
							</div>
						</Reveal>

						<div className="rounded-md bg-primary/10 px-2 py-1 text-xs text-primary">
							{t("exercises.hint")}
						</div>
						<Reveal open={preferences.lookAwayEnabled}>
							<p className="text-xs text-muted-foreground">
								{t("exercises.overlapHint")}
							</p>
						</Reveal>
					</div>
				</Reveal>
			</SettingRow>
		</SettingPanel>
	);
}
