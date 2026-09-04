import react from "@vitejs/plugin-react";

import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
	plugins: [react()],
	test: {
		clearMocks: false,
		globals: true,
		environment: "happy-dom",
		coverage: {
			provider: "istanbul",
			reporter: ["text", "json", "html"],
			enabled: true,
		},
	},
	resolve: {
		alias: {
			"@": path.resolve(import.meta.dirname, "./src"),
		},
	},
	server: {
		port: 51204,
		host: "0.0.0.0",
	},
});
