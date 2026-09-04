import { tokenSnoozeMinutes } from "../../shared/blink-stats";
import { pluralKey, t, type Locale } from "../../shared/i18n";

/** Native toast second action when the user has banked snooze tokens. */
export function tokenSnoozeToastLabel(
	locale: Locale,
	snoozeMinutes: number,
	tokenCharges: number,
): string | undefined {
	if (tokenCharges <= 0) return undefined;
	const minutes = tokenSnoozeMinutes(snoozeMinutes);
	return t(locale, pluralKey("osToast.snoozeWithToken", locale, minutes), {
		n: minutes,
	});
}
