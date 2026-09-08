import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
	net: {
		fetch: vi.fn(),
	},
}));

import {
	clearGithubReleasesCache,
	fetchGithubReleases,
} from "../../../electron/infrastructure/github/fetch-github-releases";

describe("fetchGithubReleases", () => {
	beforeEach(() => {
		clearGithubReleasesCache();
	});

	it("maps API json and caches the result", async () => {
		const fetchImpl = vi.fn(async () => ({
			ok: true,
			status: 200,
			json: async () => [
				{
					tag_name: "v2.1.0",
					name: "BlinkGuard 2.1.0",
					body: "Notes",
					published_at: "2026-08-09T12:00:00Z",
					html_url:
						"https://github.com/xpogx-org/BlinkGuard/releases/tag/v2.1.0",
					draft: false,
					prerelease: false,
				},
			],
		}));

		const first = await fetchGithubReleases({
			fetchImpl: fetchImpl as unknown as typeof fetch,
			now: () => 1_000,
		});
		expect(first).toEqual({
			status: "ok",
			releases: [
				{
					tagName: "v2.1.0",
					name: "BlinkGuard 2.1.0",
					body: "Notes",
					publishedAt: "2026-08-09T12:00:00Z",
					htmlUrl:
						"https://github.com/xpogx-org/BlinkGuard/releases/tag/v2.1.0",
					prerelease: false,
				},
			],
		});

		const second = await fetchGithubReleases({
			fetchImpl: fetchImpl as unknown as typeof fetch,
			now: () => 2_000,
		});
		expect(second).toEqual(first);
		expect(fetchImpl).toHaveBeenCalledTimes(1);
	});

	it("returns an error when GitHub responds non-OK", async () => {
		const result = await fetchGithubReleases({
			fetchImpl: (async () => ({
				ok: false,
				status: 503,
				json: async () => ({}),
			})) as unknown as typeof fetch,
		});
		expect(result).toEqual({
			status: "error",
			message: "GitHub returned 503",
		});
	});
});
