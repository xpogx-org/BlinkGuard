/** Electron-free UI tokens. Settings consume semantic Tailwind; popups use `--popup-*`. */

export type Hsl = {
	h: number;
	s: number;
	l: number;
};

const hslToken = (h: number, s: number, l: number): Hsl => ({ h, s, l });

export const theme = {
	font: {
		sans: '"IBM Plex Sans", ui-sans-serif, system-ui, sans-serif',
		popup:
			'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu, Cantarell, "Open Sans", "Helvetica Neue", sans-serif',
	},
	radius: {
		settings: "0.5rem",
		popup: "10px",
		popupSm: "6px",
	},
	space: {
		1: "0.25rem",
		2: "0.5rem",
		3: "0.75rem",
		4: "1rem",
		5: "1.25rem",
		6: "1.5rem",
		8: "2rem",
		popupPad: "16px",
		popupPadLg: "18px",
	},
	fontSize: {
		"2xs": "0.6875rem",
		xs: "0.75rem",
		sm: "0.875rem",
		base: "1rem",
		lg: "1.125rem",
	},
	color: {
		light: {
			background: hslToken(210, 25, 97),
			foreground: hslToken(222, 47, 11),
			card: hslToken(0, 0, 100),
			cardForeground: hslToken(222, 47, 11),
			popover: hslToken(0, 0, 100),
			popoverForeground: hslToken(222, 47, 11),
			primary: hslToken(173, 58, 36),
			primaryForeground: hslToken(0, 0, 100),
			secondary: hslToken(210, 20, 93),
			secondaryForeground: hslToken(222, 47, 11),
			muted: hslToken(210, 18, 93),
			mutedForeground: hslToken(215, 16, 42),
			accent: hslToken(173, 35, 93),
			accentForeground: hslToken(173, 58, 26),
			destructive: hslToken(0, 72, 51),
			destructiveForeground: hslToken(0, 0, 100),
			warning: hslToken(38, 92, 50),
			warningForeground: hslToken(22, 78, 26),
			success: hslToken(142, 76, 36),
			successForeground: hslToken(0, 0, 100),
			border: hslToken(214, 18, 86),
			input: hslToken(214, 18, 86),
			ring: hslToken(173, 58, 36),
			chart1: hslToken(173, 58, 36),
			chart2: hslToken(199, 70, 42),
			chart3: hslToken(222, 40, 30),
			chart4: hslToken(43, 74, 55),
			chart5: hslToken(27, 80, 55),
			sidebar: hslToken(210, 22, 95),
			sidebarForeground: hslToken(222, 35, 20),
			sidebarActive: hslToken(173, 45, 92),
		},
		dark: {
			background: hslToken(222, 40, 8),
			foreground: hslToken(210, 20, 98),
			card: hslToken(222, 35, 11),
			cardForeground: hslToken(210, 20, 98),
			popover: hslToken(222, 35, 11),
			popoverForeground: hslToken(210, 20, 98),
			primary: hslToken(173, 55, 42),
			primaryForeground: hslToken(222, 47, 8),
			secondary: hslToken(217, 25, 16),
			secondaryForeground: hslToken(210, 20, 98),
			muted: hslToken(217, 25, 15),
			mutedForeground: hslToken(215, 14, 65),
			accent: hslToken(173, 28, 16),
			accentForeground: hslToken(173, 50, 72),
			destructive: hslToken(0, 62, 42),
			destructiveForeground: hslToken(210, 20, 98),
			warning: hslToken(43, 96, 56),
			warningForeground: hslToken(48, 96, 89),
			success: hslToken(142, 70, 45),
			successForeground: hslToken(210, 20, 98),
			border: hslToken(217, 22, 18),
			input: hslToken(217, 22, 18),
			ring: hslToken(173, 55, 42),
			chart1: hslToken(173, 55, 45),
			chart2: hslToken(199, 70, 50),
			chart3: hslToken(30, 80, 55),
			chart4: hslToken(280, 50, 55),
			chart5: hslToken(340, 65, 55),
			sidebar: hslToken(222, 38, 10),
			sidebarForeground: hslToken(210, 18, 90),
			sidebarActive: hslToken(173, 30, 16),
		},
	},
	popup: {
		bg: "#0f172a",
		text: "#f8fafc",
		transparency: 0.15,
		accent: "#0f766e",
		accentHover: "#0d9488",
		onAccent: "#fff",
		muted: "#e2e8f0",
		muted2: "#94a3b8",
		success: "#16a34a",
		danger: "#dc2626",
		warning: "#fbbf24",
		letterbox: "#000",
		shadowAlpha: 0.32,
		overlayAlpha: 0.82,
		softAlpha: 0.14,
		borderAlpha: 0.1,
		glassBlur: "4px",
		buttonMuted: "#334155",
		buttonMutedHover: "#475569",
	},
	recipe: {
		chip: "inline-flex items-center rounded border border-primary/40 bg-primary/10 px-2 py-0.5 text-2xs font-semibold leading-none tracking-wide text-primary",
		warningSurface:
			"border-warning/30 bg-warning/10 text-warning-foreground",
		destructiveSurface:
			"border-destructive/40 bg-destructive/10 text-destructive",
		enter: "motion-enter",
		overlay: "motion-overlay",
		dialog: "motion-dialog",
		exit: "motion-exit",
	},
} as const;

export type Theme = typeof theme;
export type ThemeColorScheme = keyof typeof theme.color;
export type ThemeColorToken = keyof typeof theme.color.light;

export const THEME_CSS_MARKER_START = "/* theme:start */";
export const THEME_CSS_MARKER_END = "/* theme:end */";

const SETTINGS_COLOR_VARS = [
	{ css: "background", key: "background" },
	{ css: "foreground", key: "foreground" },
	{ css: "card", key: "card" },
	{ css: "card-foreground", key: "cardForeground" },
	{ css: "popover", key: "popover" },
	{ css: "popover-foreground", key: "popoverForeground" },
	{ css: "primary", key: "primary" },
	{ css: "primary-foreground", key: "primaryForeground" },
	{ css: "secondary", key: "secondary" },
	{ css: "secondary-foreground", key: "secondaryForeground" },
	{ css: "muted", key: "muted" },
	{ css: "muted-foreground", key: "mutedForeground" },
	{ css: "accent", key: "accent" },
	{ css: "accent-foreground", key: "accentForeground" },
	{ css: "destructive", key: "destructive" },
	{ css: "destructive-foreground", key: "destructiveForeground" },
	{ css: "warning", key: "warning" },
	{ css: "warning-foreground", key: "warningForeground" },
	{ css: "success", key: "success" },
	{ css: "success-foreground", key: "successForeground" },
	{ css: "border", key: "border" },
	{ css: "input", key: "input" },
	{ css: "ring", key: "ring" },
	{ css: "chart-1", key: "chart1" },
	{ css: "chart-2", key: "chart2" },
	{ css: "chart-3", key: "chart3" },
	{ css: "chart-4", key: "chart4" },
	{ css: "chart-5", key: "chart5" },
] as const satisfies ReadonlyArray<{ css: string; key: ThemeColorToken }>;

const SETTINGS_SIDEBAR_VARS = [
	{ css: "sidebar", key: "sidebar" },
	{ css: "sidebar-foreground", key: "sidebarForeground" },
	{ css: "sidebar-active", key: "sidebarActive" },
] as const satisfies ReadonlyArray<{ css: string; key: ThemeColorToken }>;

export type CssColorName =
	| (typeof SETTINGS_COLOR_VARS)[number]["css"]
	| (typeof SETTINGS_SIDEBAR_VARS)[number]["css"];

export function hslChannel(c: Hsl): string {
	return `${c.h} ${c.s}% ${c.l}%`;
}

export function hsl(c: Hsl, alpha?: number): string {
	const channel = hslChannel(c);
	if (alpha === undefined) return `hsl(${channel})`;
	return `hsl(${channel} / ${alpha})`;
}

export function cssColor(name: CssColorName, alpha?: number): string {
	if (alpha === undefined) return `hsl(var(--${name}))`;
	return `hsl(var(--${name}) / ${alpha})`;
}

function hexRgb(hex: string): { r: number; g: number; b: number } {
	const raw = hex.trim().replace(/^#/, "");
	const full =
		raw.length === 3
			? raw
					.split("")
					.map((c) => `${c}${c}`)
					.join("")
			: raw;
	return {
		r: Number.parseInt(full.slice(0, 2), 16),
		g: Number.parseInt(full.slice(2, 4), 16),
		b: Number.parseInt(full.slice(4, 6), 16),
	};
}

function hexRgba(hex: string, alpha: number): string {
	const { r, g, b } = hexRgb(hex);
	return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function settingsLines(scheme: ThemeColorScheme, indent: string): string[] {
	const colors = theme.color[scheme];
	const lines = SETTINGS_COLOR_VARS.map(
		({ css, key }) => `${indent}--${css}: ${hslChannel(colors[key])};`,
	);
	lines.push(`${indent}--radius: ${theme.radius.settings};`);
	for (const { css, key } of SETTINGS_SIDEBAR_VARS) {
		lines.push(`${indent}--${css}: ${hslChannel(colors[key])};`);
	}
	return lines;
}

/** Marker body for `src/index.css` `:root` / `.dark` (tab-indented declarations). */
export function settingsCssVars(scheme: ThemeColorScheme): string {
	return settingsLines(scheme, "\t\t").join("\n");
}

/** Marker body for `public/css/base.css` `:root`. */
export function popupCssVars(): string {
	const p = theme.popup;
	const indent = "\t";
	const surfaceAlpha = 1 - p.transparency;
	return [
		`${indent}--popup-bg-color: ${p.bg};`,
		`${indent}--popup-text-color: ${p.text};`,
		`${indent}--popup-transparency: ${p.transparency};`,
		`${indent}--popup-bg-alpha: ${hexRgba(p.bg, surfaceAlpha)};`,
		`${indent}--popup-accent: ${p.accent};`,
		`${indent}--popup-accent-soft: ${hexRgba(p.accent, p.softAlpha)};`,
		`${indent}--popup-accent-hover: ${p.accentHover};`,
		`${indent}--popup-on-accent: ${p.onAccent};`,
		`${indent}--popup-surface: ${hexRgba(p.bg, surfaceAlpha)};`,
		`${indent}--popup-surface-solid: ${p.bg};`,
		`${indent}--popup-border: ${hexRgba(p.text, p.borderAlpha)};`,
		`${indent}--popup-radius: ${theme.radius.popup};`,
		`${indent}--popup-radius-sm: ${theme.radius.popupSm};`,
		`${indent}--popup-glass-blur: ${p.glassBlur};`,
		`${indent}--popup-font: ${theme.font.popup};`,
		`${indent}--popup-muted: ${p.muted};`,
		`${indent}--popup-muted-2: ${p.muted2};`,
		`${indent}--popup-success: ${p.success};`,
		`${indent}--popup-success-soft: ${hexRgba(p.success, p.softAlpha)};`,
		`${indent}--popup-danger: ${p.danger};`,
		`${indent}--popup-danger-soft: ${hexRgba(p.danger, p.softAlpha)};`,
		`${indent}--popup-warning: ${p.warning};`,
		`${indent}--popup-overlay: ${hexRgba(p.bg, p.overlayAlpha)};`,
		`${indent}--popup-letterbox: ${p.letterbox};`,
		`${indent}--popup-shadow: ${hexRgba(p.letterbox, p.shadowAlpha)};`,
		`${indent}--popup-button-muted: ${p.buttonMuted};`,
		`${indent}--popup-button-muted-hover: ${p.buttonMutedHover};`,
	].join("\n");
}
