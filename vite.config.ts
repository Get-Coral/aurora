import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

const enableSpaShellBuild = process.env.AURORA_DISABLE_SPA_PRERENDER !== "true";

const config = defineConfig({
	plugins: [
		devtools(),
		tsconfigPaths({ projects: ["./tsconfig.json"] }),
		tailwindcss(),
		tanstackStart({
			...(enableSpaShellBuild
				? {
						prerender: {
							autoStaticPathsDiscovery: false,
							retryCount: 3,
							retryDelay: 500,
						},
						spa: {
							enabled: true,
							prerender: {
								outputPath: "/index.html",
							},
						},
					}
				: {}),
		}),
		viteReact(),
	],
});

export default config;
