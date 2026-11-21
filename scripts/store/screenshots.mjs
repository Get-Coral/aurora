#!/usr/bin/env node
/**
 * Play Store screenshots for tablets and TVs, in English and Dutch.
 *
 * Takes them from the app as the Android app runs it: the built client
 * (dist/client, what goes into the APK) with the on-device runtime, served
 * straight from disk to Chrome. It connects to the public Jellyfin demo
 * server (demo.jellyfin.org), which only holds public domain and Creative
 * Commons films, so the listing never shows anyone's own library or a TV
 * channel.
 *
 * - TV: the app in TV mode as a 1080p TV shows it (960×540 at 2×), full
 *   screen, 1920×1080.
 * - Tablets: the app at 1280×800, in a tablet frame under a caption in the
 *   style of the phone screenshots, 2560×1440. Used for 7" and 10" tablets.
 *
 * Usage: pnpm build && node scripts/store/screenshots.mjs [--only tv|tablet]
 * Needs Google Chrome.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const args = process.argv.slice(2);
const option = (name, fallback) => {
	const index = args.indexOf(name);
	return index === -1 ? fallback : args[index + 1];
};
// The app is served from disk under this made-up origin.
const base = "http://aurora.screenshots";
const clientDir = path.join(root, "dist", "client");
const metadata = path.join(root, "fastlane", "metadata", "android");
const only = option("--only"); // "tv" or "tablet"

const DEMO_SERVER = "https://demo.jellyfin.org/stable";
const LOCALES = [
	{ store: "en-US", app: "en" },
	{ store: "nl-NL", app: "nl" },
];

/** Captions for the tablet screenshots, as on the phone screenshots. */
const CAPTIONS = {
	en: {
		home: ["Your Jellyfin library,", "made cinematic"],
		rows: ["Browse by genre,", "row by row"],
		details: ["Rich details for", "every title"],
		series: ["Every episode,", "always within reach"],
		search: ["Find anything", "in seconds"],
		player: ["Playback that syncs", "with your server"],
	},
	nl: {
		home: ["Je Jellyfin-bibliotheek,", "als in de bioscoop"],
		rows: ["Blader per genre,", "rij na rij"],
		details: ["Alle details bij", "elke titel"],
		series: ["Elke aflevering,", "altijd binnen handbereik"],
		search: ["Vind alles in", "een paar seconden"],
		player: ["Afspelen dat synct", "met je server"],
	},
};

/** Types into a field; in TV mode a field opens for typing with OK first. */
async function type(page, selector, value) {
	const field = page.locator(selector);
	await field.focus();
	if (await field.evaluate((element) => element.readOnly)) await field.press("Enter");
	await field.fill(value);
}

/** Connects the app to the demo server through its setup screens. */
async function setUp(context) {
	const page = await context.newPage();
	await page.goto(`${base}/`);
	await page.waitForTimeout(3000);
	if (!page.url().includes("/setup")) {
		await page.close();
		return;
	}
	const next = page.locator(".setup-next-btn:not([disabled])");
	await type(page, "#setup-url", DEMO_SERVER);
	await next.click();
	// No API key: the app signs in with the demo account, which has no password.
	await page.waitForSelector("#setup-apikey");
	await next.click();
	await page.waitForSelector("#setup-username");
	await type(page, "#setup-username", "demo");
	await next.click();
	await page.waitForURL((url) => !url.pathname.startsWith("/setup"), { timeout: 30_000 });
	await page.close();
	console.log("Connected to the Jellyfin demo server");
}

/** Waits until the page has settled and its images have loaded. */
async function settle(page, extra = 1500) {
	await page.waitForLoadState("networkidle").catch(() => {});
	await page
		.waitForFunction(() => [...document.images].every((image) => image.complete), null, {
			timeout: 15_000,
		})
		.catch(() => {});
	await page.waitForTimeout(extra);
}

async function openContext(browser, locale, tv) {
	const context = await browser.newContext({
		viewport: tv ? { width: 960, height: 540 } : { width: 1280, height: 800 },
		deviceScaleFactor: 2,
		colorScheme: "dark",
		locale: locale.app,
	});
	await context.addInitScript(
		({ app, tv }) => {
			// The Android shell, as far as the app checks for it: Capacitor
			// decides it runs natively when the Android bridge is there.
			window.androidBridge = { postMessage() {} };
			window.Capacitor = { isNativePlatform: () => true, getPlatform: () => "android" };
			localStorage.setItem("aurora-locale", app);
			localStorage.setItem("aurora-tv-mode", tv ? "1" : "0");
		},
		{ app: locale.app, tv },
	);
	await context.route(`${base}/**`, (route) => {
		const { pathname } = new URL(route.request().url());
		// The on-device runtime never calls a server.
		if (pathname.startsWith("/_serverFn")) return route.abort();
		let file = path.join(clientDir, decodeURIComponent(pathname));
		if (!file.startsWith(clientDir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
			file = path.join(clientDir, "index.html");
		}
		return route.fulfill({ path: file });
	});
	await setUp(context);
	return context;
}

/** Presses a control: with the remote (focus and OK) on a TV, else a tap. */
async function activate(locator, tv) {
	if (tv) {
		await locator.focus();
		await locator.press("Enter");
	} else {
		// The hero animates in, which Playwright reads as never "stable".
		await locator.evaluate((element) => element.click());
	}
}

/**
 * Presses a control until `ready` holds. The hero animates new copy in, which
 * can swap the button out from under a press.
 */
async function pressUntil(page, locator, tv, ready) {
	for (let attempt = 0; attempt < 4; attempt++) {
		await activate(locator, tv);
		try {
			await page.waitForFunction(ready, null, { timeout: 5000 });
			return;
		} catch {
			await page.waitForTimeout(500);
		}
	}
	throw new Error("The control didn't respond");
}

/**
 * Opens a page the way a viewer gets there: the app starts on Home and moves
 * on inside itself. (The app shell is prerendered at "/", so loading a deeper
 * URL cold would keep Home highlighted in the header.)
 */
async function go(page, to) {
	await page.goto(`${base}/`);
	await settle(page, 500);
	if (to !== "/") {
		await page.evaluate((href) => window.__TSR_ROUTER__.history.push(href), to);
	}
}

/** The screens, each leaving the page as it should be captured. */
const SCREENS = {
	async home(page) {
		await go(page, "/");
		await settle(page, 2500);
	},
	async rows(page, { tv }) {
		await go(page, "/library/movies");
		await settle(page);
		// Down into the rows, past the featured title, to the first row of
		// posters.
		if (tv) {
			for (let step = 0; step < 8; step++) {
				const inPosterRow = await page.evaluate(() => {
					const rows = [...document.querySelectorAll(".browse-row-track")];
					const row = document.activeElement?.closest(".browse-row-track");
					return Boolean(row && !row.classList.contains("browse-row-wide") && rows.indexOf(row) > 0);
				});
				if (inPosterRow) break;
				await page.keyboard.press("ArrowDown");
				await page.waitForTimeout(500);
			}
		} else {
			await page.mouse.wheel(0, 560);
		}
		await settle(page, 2000);
	},
	async details(page, { tv }) {
		await go(page, "/");
		await settle(page);
		await pressUntil(page, page.locator("#spotlight .secondary-action").first(), tv, () =>
			document.querySelector('[aria-modal="true"]'),
		);
		await settle(page, 2500);
	},
	async series(page, { tv }) {
		await go(page, "/library/series?view=grid");
		await settle(page);
		await pressUntil(page, page.locator(".media-card").first(), tv, () =>
			document.querySelector('[aria-modal="true"]'),
		);
		await settle(page, 3000);
	},
	async search(page) {
		await go(page, "/search?q=night");
		await settle(page, 2500);
	},
	async player(page, { tv }) {
		await go(page, "/");
		await settle(page);
		await pressUntil(page, page.locator("#spotlight .primary-action").first(), tv, () =>
			document.querySelector("video"),
		);
		await page.waitForFunction(
			() => {
				const video = document.querySelector("video");
				return video && video.readyState >= 3 && video.currentTime > 10;
			},
			null,
			{ timeout: 60_000 },
		);
		// Bring up the controls, as a viewer would.
		if (tv) await page.keyboard.press("Enter");
		else await page.mouse.move(640, 500);
		await page.waitForTimeout(800);
	},
};

const JPEG = { type: "jpeg", quality: 90 };
const TV_SCREENS = ["home", "rows", "details", "series", "player"];
const TABLET_SCREENS = ["home", "rows", "details", "series", "search", "player"];

function captionPage(raw, [first, second]) {
	const image = `data:image/png;base64,${raw.toString("base64")}`;
	return `<!doctype html><html><head>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;700&display=swap" rel="stylesheet">
<style>
html,body{margin:0;width:2560px;height:1440px;overflow:hidden;font-family:"Space Grotesk",sans-serif}
body{background:radial-gradient(ellipse at 50% -10%,#4a2a7a 0%,#1c1a3a 38%,#0b1020 70%);color:#fff;text-align:center}
.eyebrow{margin-top:70px;font-size:34px;letter-spacing:.42em;font-weight:500;color:#d9dcf2}
.eyebrow b{color:#c9a7ff;font-weight:700;margin-right:.35em;letter-spacing:0}
h1{margin:26px 0 0;font-size:92px;line-height:1.08;font-weight:700;letter-spacing:-.01em}
h1 span{background:linear-gradient(90deg,#8ec5ff,#c7b2ff 55%,#ffb38a);-webkit-background-clip:text;color:transparent}
.rule{width:1800px;height:2px;margin:56px auto 0;background:linear-gradient(90deg,transparent,#a77bd8 30%,#6aa8ff 70%,transparent);opacity:.6}
.tablet{position:absolute;left:50%;top:470px;transform:translateX(-50%);width:1960px;height:1225px;padding:34px;border-radius:64px;
background:linear-gradient(160deg,#3a3f5c,#1a1d2e 40%,#11131f);box-shadow:0 50px 120px rgba(0,0,0,.55),inset 0 0 0 2px rgba(255,255,255,.08)}
.tablet img{display:block;width:100%;height:100%;border-radius:34px}
</style></head><body>
<div class="eyebrow"><b>✦</b>AURORA</div>
<h1>${first}<br><span>${second}</span></h1>
<div class="rule"></div>
<div class="tablet"><img src="${image}"></div>
</body></html>`;
}

async function capture(browser, locale, tv) {
	const context = await openContext(browser, locale, tv);
	const page = await context.newPage();
	const names = tv ? TV_SCREENS : TABLET_SCREENS;
	const folders = tv
		? ["tvScreenshots"]
		: ["sevenInchScreenshots", "tenInchScreenshots"];
	for (const folder of folders) {
		fs.rmSync(path.join(metadata, locale.store, "images", folder), { recursive: true, force: true });
		fs.mkdirSync(path.join(metadata, locale.store, "images", folder), { recursive: true });
	}
	const composer = tv ? null : await browser.newPage({ viewport: { width: 2560, height: 1440 } });

	for (const [index, name] of names.entries()) {
		await SCREENS[name](page, { tv });
		const file = `${String(index + 1).padStart(2, "0")}_${name}.jpg`;
		// JPEG keeps the listing (and the repo) light; Play takes either.
		let image;
		if (composer) {
			await composer.setContent(captionPage(await page.screenshot(), CAPTIONS[locale.app][name]), {
				waitUntil: "networkidle",
			});
			await composer.evaluate(() => document.fonts.ready);
			image = await composer.screenshot(JPEG);
		} else {
			image = await page.screenshot(JPEG);
		}
		for (const folder of folders) {
			fs.writeFileSync(path.join(metadata, locale.store, "images", folder, file), image);
		}
		console.log(`${locale.store} ${tv ? "TV" : "tablet"}: ${file}`);
	}
	await context.close();
	await composer?.close();
}

if (!fs.existsSync(path.join(clientDir, "index.html"))) {
	throw new Error("Build the app first: pnpm build");
}
const browser = await chromium.launch({ channel: "chrome" });
try {
	for (const locale of LOCALES) {
		if (only !== "tablet") await capture(browser, locale, true);
		if (only !== "tv") await capture(browser, locale, false);
	}
} finally {
	await browser.close();
}
