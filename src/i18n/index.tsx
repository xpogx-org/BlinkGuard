import { createContext, type ReactNode, useContext } from "react";
import {
	type Locale,
	type TranslateVars,
	t as translate,
} from "../../shared/i18n";

type TranslateFn = (key: string, vars?: TranslateVars) => string;

const I18nContext = createContext<{
	locale: Locale;
	t: TranslateFn;
}>({
	locale: "en",
	t: (key, vars) => translate("en", key, vars),
});

export function I18nProvider({
	locale,
	children,
}: {
	locale: Locale;
	children: ReactNode;
}) {
	const value = {
		locale,
		t: (key: string, vars?: TranslateVars) => translate(locale, key, vars),
	};
	return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
	return useContext(I18nContext);
}

export function useT(): TranslateFn {
	return useI18n().t;
}
