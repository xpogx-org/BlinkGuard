import { describe, expect, it } from "vitest";
import {
	GITHUB_RELEASES_OWNER,
	GITHUB_RELEASES_PAGE_URL,
	GITHUB_RELEASES_REPO,
	GITHUB_REPO_PAGE_URL,
	isAllowedExternalUrl,
	mapGithubRelease,
	mapGithubReleases,
	stripDuplicateReleaseHeading,
} from "../../../shared/release-notes";

describe("release-notes mapping", () => {
	it("points GitHub constants at the org repository", () => {
		expect(GITHUB_RELEASES_OWNER).toBe("xpogx-org");
		expect(GITHUB_RELEASES_REPO).toBe("BlinkGuard");
		expect(GITHUB_REPO_PAGE_URL).toBe(
			"https://github.com/xpogx-org/BlinkGuard",
		);
		expect(GITHUB_RELEASES_PAGE_URL).toBe(
			"https://github.com/xpogx-org/BlinkGuard/releases",
		);
	});

	it("maps a published release", () => {
		expect(
			mapGithubRelease({
				tag_name: "v2.1.0",
				name: "BlinkGuard 2.1.0",
				body: "## Added\n- Goals",
				published_at: "2026-08-09T12:00:00Z",
				html_url: "https://github.com/xpogx-org/BlinkGuard/releases/tag/v2.1.0",
				prerelease: false,
				draft: false,
			}),
		).toEqual({
			tagName: "v2.1.0",
			name: "BlinkGuard 2.1.0",
			body: "## Added\n- Goals",
			publishedAt: "2026-08-09T12:00:00Z",
			htmlUrl: "https://github.com/xpogx-org/BlinkGuard/releases/tag/v2.1.0",
			prerelease: false,
		});
	});

	it("strips a leading body heading that repeats the release name", () => {
		expect(
			stripDuplicateReleaseHeading(
				"## BlinkGuard 2.1.0\n\nGoals, backup, and polish.\n\n### Added\n- Goals",
				"BlinkGuard 2.1.0",
				"v2.1.0",
			),
		).toBe("Goals, backup, and polish.\n\n### Added\n- Goals");

		expect(
			mapGithubRelease({
				tag_name: "v2.1.0",
				name: "BlinkGuard 2.1.0",
				body: "## BlinkGuard 2.1.0\n\nGoals and backup polish.",
				html_url: "https://github.com/xpogx-org/BlinkGuard/releases/tag/v2.1.0",
			}),
		).toMatchObject({
			name: "BlinkGuard 2.1.0",
			body: "Goals and backup polish.",
		});
	});

	it("keeps a leading heading that is not the release title", () => {
		expect(
			stripDuplicateReleaseHeading(
				"## Added\n- Goals",
				"BlinkGuard 2.1.0",
				"v2.1.0",
			),
		).toBe("## Added\n- Goals");
	});

	it("skips drafts and falls back name to tag", () => {
		expect(
			mapGithubRelease({
				tag_name: "v9.0.0",
				draft: true,
				html_url: "https://github.com/xpogx-org/BlinkGuard/releases/tag/v9.0.0",
			}),
		).toBeNull();

		expect(
			mapGithubRelease({
				tag_name: "v2.0.0",
				html_url: "https://github.com/xpogx-org/BlinkGuard/releases/tag/v2.0.0",
			}),
		).toMatchObject({
			tagName: "v2.0.0",
			name: "v2.0.0",
			body: "",
			publishedAt: null,
			prerelease: false,
		});
	});

	it("maps an array and ignores invalid entries", () => {
		const releases = mapGithubReleases([
			{
				tag_name: "v1.0.0",
				html_url: "https://github.com/xpogx-org/BlinkGuard/releases/tag/v1.0.0",
			},
			{ not: "a release" },
			null,
		]);
		expect(releases).toHaveLength(1);
		expect(releases[0]?.tagName).toBe("v1.0.0");
	});

	it("allows only https external urls", () => {
		expect(
			isAllowedExternalUrl("https://github.com/xpogx-org/BlinkGuard"),
		).toBe(true);
		expect(isAllowedExternalUrl("http://example.com")).toBe(false);
		expect(isAllowedExternalUrl("javascript:alert(1)")).toBe(false);
		expect(isAllowedExternalUrl("not a url")).toBe(false);
	});
});
