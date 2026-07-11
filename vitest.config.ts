import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

// A dedicated vitest config so the full TanStack Start plugin (SSR, prerender)
// from vite.config.ts doesn't load during unit tests. tsconfigPaths keeps the
// `@/` alias working.
export default defineConfig({
	plugins: [tsconfigPaths({ projects: ["./tsconfig.json"] })],
	test: {
		environment: "node",
		include: ["src/**/*.test.ts"],
	},
});
