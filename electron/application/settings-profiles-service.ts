import {
	SETTINGS_PROFILE_CAP,
	SETTINGS_PROFILES_STORE_KEY,
	captureSettingsProfilePrefs,
	sameSettingsProfilePrefs,
	sanitizeSettingsProfileName,
	sanitizeSettingsProfilesState,
	toSettingsProfileSummary,
	type SettingsProfile,
	type SettingsProfilePrefs,
	type SettingsProfilesResult,
	type SettingsProfilesState,
} from "../../shared/settings-profiles";
import type { PersistedPreferences } from "../../shared/preferences";
import type { PreferenceStore } from "./ports/preference-store";
import type { SettingsProfilesStore } from "./ports/settings-profiles-store";

/** Wrap a PreferenceStore (third electron-store file) as load/save. */
export class PreferenceStoreSettingsProfilesAdapter
	implements SettingsProfilesStore
{
	constructor(private readonly store: PreferenceStore) {}

	load(): unknown {
		return this.store.get(SETTINGS_PROFILES_STORE_KEY, null);
	}

	save(state: SettingsProfilesState): void {
		this.store.set(SETTINGS_PROFILES_STORE_KEY, state);
	}
}

export type ApplySettingsProfileFn = (snapshot: SettingsProfilePrefs) => void;

/**
 * CRUD for named settings setups. Never touches blinkguard-stats.
 * Apply is injected — do not import PreferenceActions here.
 */
export class SettingsProfilesService {
	constructor(
		private readonly store: SettingsProfilesStore,
		private readonly getLivePreferences: () => PersistedPreferences,
		private readonly applySettingsProfile: ApplySettingsProfileFn,
		private readonly createId: () => string = () => crypto.randomUUID(),
		private readonly nowIso: () => string = () => new Date().toISOString(),
		private readonly onChanged: (() => void) | null = null,
	) {}

	private readState(): SettingsProfilesState {
		return sanitizeSettingsProfilesState(this.store.load());
	}

	private writeState(state: SettingsProfilesState): void {
		this.store.save(sanitizeSettingsProfilesState(state));
		this.onChanged?.();
	}

	private isDirty(state: SettingsProfilesState): boolean {
		if (!state.activeProfileId) return false;
		const active = state.profiles.find((p) => p.id === state.activeProfileId);
		if (!active) return false;
		const live = captureSettingsProfilePrefs(this.getLivePreferences());
		return !sameSettingsProfilePrefs(live, active.prefs);
	}

	private okResult(state: SettingsProfilesState): SettingsProfilesResult {
		return {
			ok: true,
			profiles: state.profiles.map(toSettingsProfileSummary),
			activeProfileId: state.activeProfileId,
			dirty: this.isDirty(state),
		};
	}

	list(): SettingsProfilesResult {
		const state = this.readState();
		return this.okResult(state);
	}

	getPersistedState(): SettingsProfilesState {
		return this.readState();
	}

	replaceFromBackup(raw: unknown): void {
		this.writeState(sanitizeSettingsProfilesState(raw));
	}

	save(raw: unknown): SettingsProfilesResult {
		const record =
			raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
		const name = sanitizeSettingsProfileName(record.name);
		if (!name) {
			return { ok: false, code: "invalid-name" };
		}
		const replaceId =
			typeof record.replaceId === "string" && record.replaceId.trim()
				? record.replaceId.trim()
				: undefined;

		const state = this.readState();
		const livePrefs = captureSettingsProfilePrefs(this.getLivePreferences());
		const now = this.nowIso();

		if (replaceId) {
			const index = state.profiles.findIndex((p) => p.id === replaceId);
			if (index < 0) {
				return { ok: false, code: "not-found" };
			}
			const existing = state.profiles[index];
			const updated: SettingsProfile = {
				...existing,
				name,
				updatedAt: now,
				prefs: livePrefs,
			};
			const next: SettingsProfilesState = {
				...state,
				activeProfileId: replaceId,
				profiles: state.profiles.map((p, i) => (i === index ? updated : p)),
			};
			this.writeState(next);
			return this.okResult(this.readState());
		}

		if (state.profiles.length >= SETTINGS_PROFILE_CAP) {
			return { ok: false, code: "cap" };
		}

		const id = this.createId();
		const created: SettingsProfile = {
			id,
			name,
			createdAt: now,
			updatedAt: now,
			prefs: livePrefs,
		};
		const next: SettingsProfilesState = {
			...state,
			activeProfileId: id,
			profiles: [...state.profiles, created],
		};
		this.writeState(next);
		return this.okResult(this.readState());
	}

	rename(raw: unknown): SettingsProfilesResult {
		const record =
			raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
		const id = typeof record.id === "string" ? record.id.trim() : "";
		if (!id) {
			return { ok: false, code: "not-found" };
		}
		const name = sanitizeSettingsProfileName(record.name);
		if (!name) {
			return { ok: false, code: "invalid-name" };
		}
		const state = this.readState();
		const index = state.profiles.findIndex((p) => p.id === id);
		if (index < 0) {
			return { ok: false, code: "not-found" };
		}
		const existing = state.profiles[index];
		const next: SettingsProfilesState = {
			...state,
			profiles: state.profiles.map((p, i) =>
				i === index
					? { ...existing, name, updatedAt: this.nowIso() }
					: p,
			),
		};
		this.writeState(next);
		return this.okResult(this.readState());
	}

	delete(raw: unknown): SettingsProfilesResult {
		const record =
			raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
		const id = typeof record.id === "string" ? record.id.trim() : "";
		if (!id) {
			return { ok: false, code: "not-found" };
		}
		const state = this.readState();
		if (!state.profiles.some((p) => p.id === id)) {
			return { ok: false, code: "not-found" };
		}
		const profiles = state.profiles.filter((p) => p.id !== id);
		const next: SettingsProfilesState = {
			...state,
			profiles,
			activeProfileId:
				state.activeProfileId === id ? null : state.activeProfileId,
		};
		this.writeState(next);
		return this.okResult(this.readState());
	}

	switch(raw: unknown): SettingsProfilesResult {
		const record =
			raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
		const id = typeof record.id === "string" ? record.id.trim() : "";
		if (!id) {
			return { ok: false, code: "not-found" };
		}
		const confirmDirty = record.confirmDirty === true;
		const state = this.readState();
		const target = state.profiles.find((p) => p.id === id);
		if (!target) {
			return { ok: false, code: "not-found" };
		}
		if (this.isDirty(state) && !confirmDirty) {
			return { ok: false, code: "dirty" };
		}
		this.applySettingsProfile(target.prefs);
		const next: SettingsProfilesState = {
			...state,
			activeProfileId: id,
		};
		this.writeState(next);
		return this.okResult(this.readState());
	}
}
