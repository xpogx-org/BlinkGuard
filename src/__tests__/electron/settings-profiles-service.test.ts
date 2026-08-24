import { describe, expect, it, vi } from "vitest";
import type { PreferenceStore } from "../../../electron/application/ports/preference-store";
import type { SettingsProfilesStore } from "../../../electron/application/ports/settings-profiles-store";
import { SettingsProfilesService } from "../../../electron/application/settings-profiles-service";
import {
	DEFAULT_PREFERENCES,
	type PersistedPreferences,
} from "../../../shared/preferences";
import {
	captureSettingsProfilePrefs,
	SETTINGS_PROFILE_CAP,
	type SettingsProfilesState,
} from "../../../shared/settings-profiles";

class MemoryProfilesStore implements SettingsProfilesStore {
	raw: unknown = null;
	saveCount = 0;

	load(): unknown {
		return this.raw;
	}

	save(state: SettingsProfilesState): void {
		this.raw = state;
		this.saveCount += 1;
	}
}

function createService(options?: {
	live?: PersistedPreferences;
	store?: MemoryProfilesStore;
	apply?: (snapshot: unknown) => void;
	ids?: string[];
	onChanged?: () => void;
}) {
	const store = options?.store ?? new MemoryProfilesStore();
	let live = options?.live ?? { ...DEFAULT_PREFERENCES };
	const apply = options?.apply ?? vi.fn();
	const ids = options?.ids ?? ["id-1", "id-2", "id-3", "id-4", "id-5", "id-6"];
	let idIndex = 0;
	const service = new SettingsProfilesService(
		store,
		() => live,
		apply as never,
		() => ids[idIndex++] ?? crypto.randomUUID(),
		() => "2026-08-21T12:00:00.000Z",
		options?.onChanged ?? null,
	);
	return {
		service,
		store,
		apply,
		setLive: (next: PersistedPreferences) => {
			live = next;
		},
	};
}

describe("SettingsProfilesService", () => {
	it("saves from live prefs, lists summaries without prefs blobs, and caps at 5", () => {
		const { service, store, apply } = createService({
			live: {
				...DEFAULT_PREFERENCES,
				reminderInterval: 4000,
				blinkPromptProfile: "gentle",
			},
		});

		const first = service.save({ name: "Desk" });
		expect(first.ok).toBe(true);
		if (!first.ok) return;
		expect(first.profiles).toHaveLength(1);
		expect(first.profiles[0]).toMatchObject({
			id: "id-1",
			name: "Desk",
		});
		expect(Object.prototype.hasOwnProperty.call(first.profiles[0], "prefs")).toBe(
			false,
		);
		expect(first.activeProfileId).toBe("id-1");
		expect(first.dirty).toBe(false);
		expect(apply).not.toHaveBeenCalled();

		const persisted = store.raw as SettingsProfilesState;
		expect(persisted.profiles[0]?.prefs.reminderInterval).toBe(4000);
		expect(persisted.profiles[0]?.prefs.blinkPromptProfile).toBe("gentle");

		for (let i = 2; i <= SETTINGS_PROFILE_CAP; i++) {
			expect(service.save({ name: `Setup ${i}` }).ok).toBe(true);
		}
		const capped = service.save({ name: "Overflow" });
		expect(capped).toEqual({ ok: false, code: "cap" });
	});

	it("rejects empty names and allows duplicate names", () => {
		const { service } = createService();
		expect(service.save({ name: "   " })).toEqual({
			ok: false,
			code: "invalid-name",
		});
		expect(service.save({ name: "Desk" }).ok).toBe(true);
		expect(service.save({ name: "Desk" }).ok).toBe(true);
		const listed = service.list();
		expect(listed.ok).toBe(true);
		if (!listed.ok) return;
		expect(listed.profiles).toHaveLength(2);
		expect(listed.profiles.every((p) => p.name === "Desk")).toBe(true);
	});

	it("dirty compares active id only and keeps activeProfileId while dirty", () => {
		let live: PersistedPreferences = {
			...DEFAULT_PREFERENCES,
			reminderInterval: 3000,
		};
		const store = new MemoryProfilesStore();
		const apply = vi.fn((snapshot: unknown) => {
			live = {
				...DEFAULT_PREFERENCES,
				...(snapshot as PersistedPreferences),
			};
		});
		const service = new SettingsProfilesService(
			store,
			() => live,
			apply,
			(() => {
				const ids = ["id-1", "id-2"];
				let i = 0;
				return () => ids[i++] ?? crypto.randomUUID();
			})(),
			() => "2026-08-21T12:00:00.000Z",
		);

		expect(service.save({ name: "Desk" }).ok).toBe(true);
		expect(service.save({ name: "Weekend" }).ok).toBe(true);

		const beforeDirty = service.list();
		expect(beforeDirty.ok).toBe(true);
		if (!beforeDirty.ok) return;
		expect(beforeDirty.activeProfileId).toBe("id-2");
		expect(beforeDirty.dirty).toBe(false);

		live = { ...DEFAULT_PREFERENCES, reminderInterval: 9000 };
		const dirty = service.list();
		expect(dirty.ok).toBe(true);
		if (!dirty.ok) return;
		expect(dirty.dirty).toBe(true);
		expect(dirty.activeProfileId).toBe("id-2");

		const blocked = service.switch({ id: "id-1" });
		expect(blocked).toEqual({ ok: false, code: "dirty" });

		const switched = service.switch({ id: "id-1", confirmDirty: true });
		expect(switched.ok).toBe(true);
		if (!switched.ok) return;
		expect(apply).toHaveBeenCalled();
		expect(switched.activeProfileId).toBe("id-1");
		expect(switched.dirty).toBe(false);
	});

	it("dirty is false when activeProfileId is null", () => {
		const { service, setLive } = createService();
		expect(service.save({ name: "Desk" }).ok).toBe(true);
		expect(service.delete({ id: "id-1" }).ok).toBe(true);
		setLive({ ...DEFAULT_PREFERENCES, reminderInterval: 1111 });
		const listed = service.list();
		expect(listed.ok).toBe(true);
		if (!listed.ok) return;
		expect(listed.activeProfileId).toBeNull();
		expect(listed.dirty).toBe(false);
	});

	it("rename and delete work; delete of active clears active id", () => {
		const { service } = createService();
		expect(service.save({ name: "Desk" }).ok).toBe(true);
		const renamed = service.rename({ id: "id-1", name: "Office" });
		expect(renamed.ok).toBe(true);
		if (!renamed.ok) return;
		expect(renamed.profiles[0]?.name).toBe("Office");

		const deleted = service.delete({ id: "id-1" });
		expect(deleted.ok).toBe(true);
		if (!deleted.ok) return;
		expect(deleted.profiles).toHaveLength(0);
		expect(deleted.activeProfileId).toBeNull();
	});

	it("sanitizes corrupt store on read and never touches a stats store", () => {
		const store = new MemoryProfilesStore();
		store.raw = {
			profiles: [{ id: "bad" }, { id: "ok", name: "Desk", prefs: {} }],
			activeProfileId: "missing",
		};
		const statsClear = vi.fn();
		const statsStore: PreferenceStore = {
			get: vi.fn(),
			set: vi.fn(),
			has: vi.fn(),
			clear: statsClear,
		};
		void statsStore;
		const { service } = createService({ store });
		const listed = service.list();
		expect(listed.ok).toBe(true);
		if (!listed.ok) return;
		expect(listed.profiles).toHaveLength(1);
		expect(listed.profiles[0]?.name).toBe("Desk");
		expect(listed.activeProfileId).toBeNull();
		expect(statsClear).not.toHaveBeenCalled();
	});

	it("replace save captures live prefs and sets active id", () => {
		const { service, setLive } = createService({
			live: { ...DEFAULT_PREFERENCES, reminderInterval: 2000 },
		});
		expect(service.save({ name: "Desk" }).ok).toBe(true);
		setLive({ ...DEFAULT_PREFERENCES, reminderInterval: 8000 });
		const replaced = service.save({ name: "Desk Updated", replaceId: "id-1" });
		expect(replaced.ok).toBe(true);
		if (!replaced.ok) return;
		expect(replaced.activeProfileId).toBe("id-1");
		expect(replaced.dirty).toBe(false);
		expect(
			captureSettingsProfilePrefs({
				...DEFAULT_PREFERENCES,
				reminderInterval: 8000,
			}).reminderInterval,
		).toBe(8000);
	});

	it("switch calls injected apply with snapshot prefs", () => {
		const apply = vi.fn();
		const { service } = createService({
			live: { ...DEFAULT_PREFERENCES, snoozeMinutes: 15 },
			apply,
		});
		expect(service.save({ name: "Desk" }).ok).toBe(true);
		service.switch({ id: "id-1" });
		expect(apply).toHaveBeenCalledOnce();
		expect(apply.mock.calls[0]?.[0]?.snoozeMinutes).toBe(15);
	});

	it("switch of a missing id is not-found and does not apply", () => {
		const { service, apply } = createService();
		expect(service.save({ name: "Desk" }).ok).toBe(true);
		expect(service.switch({ id: "missing" })).toEqual({
			ok: false,
			code: "not-found",
		});
		expect(apply).not.toHaveBeenCalled();
	});

	it("onChanged fires after save, switch, and delete, not list", () => {
		const onChanged = vi.fn();
		const { service } = createService({ onChanged });
		expect(service.save({ name: "Desk" }).ok).toBe(true);
		expect(service.save({ name: "Weekend" }).ok).toBe(true);
		expect(onChanged).toHaveBeenCalledTimes(2);
		service.list();
		expect(onChanged).toHaveBeenCalledTimes(2);
		expect(service.switch({ id: "id-1" }).ok).toBe(true);
		expect(onChanged).toHaveBeenCalledTimes(3);
		expect(service.delete({ id: "id-2" }).ok).toBe(true);
		expect(onChanged).toHaveBeenCalledTimes(4);
		expect(service.switch({ id: "missing" }).ok).toBe(false);
		expect(onChanged).toHaveBeenCalledTimes(4);
	});
});
