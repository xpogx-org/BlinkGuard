export interface PreferenceStore {
	get<T>(key: string, defaultValue?: T): T;
	set<T>(key: string, value: T): void;
	has(key: string): boolean;
	clear(): void;
	delete?(key: string): void;
}
