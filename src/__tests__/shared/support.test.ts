import { describe, expect, it } from "vitest";
import {
	GITHUB_ISSUES_PAGE_URL,
	GITHUB_NEW_ISSUE_BUG_URL,
	GITHUB_NEW_ISSUE_FEATURE_URL,
	isAllowedSupportUrl,
} from "../../../shared/support";

describe("support URLs", () => {
	it("builds repo-scoped issue URLs from the org repository", () => {
		expect(GITHUB_ISSUES_PAGE_URL).toBe(
			"https://github.com/xpogx-org/BlinkGuard/issues",
		);
		expect(GITHUB_NEW_ISSUE_BUG_URL).toBe(
			"https://github.com/xpogx-org/BlinkGuard/issues/new?template=bug_report.yml",
		);
		expect(GITHUB_NEW_ISSUE_FEATURE_URL).toBe(
			"https://github.com/xpogx-org/BlinkGuard/issues/new?template=feature_request.yml",
		);
	});

	it("allows this repo issues list and new-issue template URLs", () => {
		expect(isAllowedSupportUrl(GITHUB_ISSUES_PAGE_URL)).toBe(true);
		expect(isAllowedSupportUrl(GITHUB_NEW_ISSUE_BUG_URL)).toBe(true);
		expect(isAllowedSupportUrl(GITHUB_NEW_ISSUE_FEATURE_URL)).toBe(true);
		expect(
			isAllowedSupportUrl(
				"https://github.com/xpogx-org/BlinkGuard/issues/new",
			),
		).toBe(true);
	});

	it("rejects arbitrary https and other repos", () => {
		expect(isAllowedSupportUrl("https://example.com/issues")).toBe(false);
		expect(isAllowedSupportUrl("http://github.com/xpogx-org/BlinkGuard/issues")).toBe(
			false,
		);
		expect(
			isAllowedSupportUrl("https://github.com/other-org/BlinkGuard/issues"),
		).toBe(false);
		expect(isAllowedSupportUrl("javascript:alert(1)")).toBe(false);
		expect(isAllowedSupportUrl("not a url")).toBe(false);
	});
});
