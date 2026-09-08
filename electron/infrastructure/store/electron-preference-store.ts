import Store, { type Options as ElectronStoreOptions } from "electron-store";
import type { PreferenceStore } from "../../application/ports/preference-store";

export class ElectronPreferenceStore implements PreferenceStore {
	private readonly store: Store;

	constructor(options?: ElectronStoreOptions<Record<string, unknown>>) {
		this.store = new Store(options);
	}

	get<T>(key: string, defaultValue?: T): T {
		return defaultValue === undefined
			? (this.store.get(key) as T)
			: (this.store.get(key, defaultValue) as T);
	}

	set<T>(key: string, value: T): void {
		this.store.set(key, value);
	}

	has(key: string): boolean {
		return this.store.has(key);
	}

	delete(key: string): void {
		this.store.delete(key);
	}

	clear(): void {
		this.store.clear();
	}
}
