import process from "node:process";

import { coralFmt } from "@get-coral/oxfmt-config";
import { coralReactLint } from "@get-coral/oxlint-config";
import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig, lazyPlugins } from "vite-plus";
import tsconfigPaths from "vite-tsconfig-paths";

const enableSpaShellBuild = process.env.AURORA_DISABLE_SPA_PRERENDER !== "true";

// Unit tests skip the TanStack Start plugin (SSR, prerender) and the devtools;
// tsconfigPaths keeps the `@/` alias working there.
const isTest = process.env.VITEST === "true";

const config = defineConfig({
	plugins: lazyPlugins(() =>
		isTest
			? [tsconfigPaths({ projects: ["./tsconfig.json"] })]
			: [
					devtools(),
					tsconfigPaths({ projects: ["./tsconfig.json"] }),
					tailwindcss(),
					tanstackStart(
						enableSpaShellBuild
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
							: {},
					),
					viteReact(),
				],
	),
	test: {
		environment: "node",
		include: ["src/**/*.test.{ts,tsx}"],
	},
	lint: {
		extends: [coralReactLint],
		jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
		ignorePatterns: [
			"android/**",
			"ios/**",
			"src-tauri/**",
			"capacitor-shell/**",
			"public/**",
			"store/**",
			"fastlane/**",
		],
		rules: {
			"vite-plus/prefer-vite-plus-imports": "error",
			// The same exceptions aurora made to Biome's rules.
			"jsx-a11y/no-autofocus": "off",
			"jsx-a11y/no-static-element-interactions": "off",
			"jsx-a11y/interactive-supports-focus": "off",
			"jsx-a11y/click-events-have-key-events": "off",
			"jsx-a11y/media-has-caption": "off",
			"jsx-a11y/prefer-tag-over-role": "off",
			"react/exhaustive-deps": "off",
			"react/no-danger": "off",
			"typescript/no-non-null-assertion": "off",
			"no-console": "off",
			complexity: "off",
			"jsx-a11y/no-noninteractive-element-interactions": "off",
			// React Compiler rules. Aurora does not use the compiler yet, and these
			// flag long-standing patterns in the player and search; adopt them with it.
			"react/refs": "off",
			"react/set-state-in-effect": "off",
			"react/purity": "off",
			"react/immutability": "off",
		},
		overrides: [
			{
				files: ["**/*.test.{ts,tsx}"],
				rules: { "typescript/no-base-to-string": "off" },
			},
		],
		options: { typeAware: true, typeCheck: true },
	},
	fmt: {
		...coralFmt,
		ignorePatterns: [
			"src/routeTree.gen.ts",
			"src/styles.css",
			"CHANGELOG.md",
			".release-please-manifest.json",
			"release-please-config.json",
			"android/**",
			"ios/**",
			"src-tauri/**",
			"capacitor-shell/**",
			"public/**",
			"store/**",
			"fastlane/**",
		],
	},
});

export default config;
