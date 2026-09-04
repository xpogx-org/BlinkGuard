/**
 * Electron-free support funnel URLs (GitHub issues only).
 */

import { GITHUB_REPO_PAGE_URL } from "./release-notes";

export const GITHUB_ISSUES_PAGE_URL = `${GITHUB_REPO_PAGE_URL}/issues`;

export const GITHUB_NEW_ISSUE_BUG_URL =
	`${GITHUB_REPO_PAGE_URL}/issues/new?template=bug_report.yml`;

export const GITHUB_NEW_ISSUE_FEATURE_URL =
	`${GITHUB_REPO_PAGE_URL}/issues/new?template=feature_request.yml`;

const SUPPORT_ISSUES_PATH = new URL(GITHUB_ISSUES_PAGE_URL).pathname;

/** Allow only this repo's GitHub issues list / new-issue URLs (https). */
export function isAllowedSupportUrl(url: string): boolean {
	try {
		const parsed = new URL(url);
		if (parsed.protocol !== "https:") return false;
		if (parsed.hostname !== "github.com") return false;
		const { pathname } = parsed;
		return (
			pathname === SUPPORT_ISSUES_PATH ||
			pathname.startsWith(`${SUPPORT_ISSUES_PATH}/`)
		);
	} catch {
		return false;
	}
}
