#!/usr/bin/env node
/**
 * Play Store screenshots for phones, tablets and TVs, in English and Dutch.
 *
 * Takes them from the app as the Android app runs it: the built client
 * (dist/client, what goes into the APK) with the on-device runtime, served
 * straight from disk to Chrome. It connects to the public Jellyfin demo
 * server (demo.jellyfin.org), which only holds public domain and Creative
 * Commons films, so the listing never shows anyone's own library or a TV
 * channel.
 *
 * - Phones: the app at 412×915 (a typical Android phone), in a phone frame
 *   under a caption, 1080×1920.
 * - Tablets: the app at 1280×800, in a tablet frame under a caption,
 *   2560×1440. Used for 7" and 10" tablets.
 * - TV: the app in TV mode as a 1080p TV shows it (960×540 at 2×), full
 *   screen, 1920×1080.
 *
 * Usage: pnpm store:screenshots [-- --only phone|tablet|tv]
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
const only = option("--only"); // "phone", "tablet" or "tv"

const DEMO_SERVER = "https://demo.jellyfin.org/stable";
const LOCALES = [
	{ store: "en-US", app: "en" },
	{ store: "nl-NL", app: "nl" },
];

/** Captions over the phone and tablet screenshots. */
const CAPTIONS = {
	en: {
		home: ["Your Jellyfin library,", "made cinematic"],
		continue: ["Pick up right where", "you left off"],
		rows: ["Browse by genre,", "row by row"],
		library: ["Browse by genre,", "sort it your way"],
		details: ["Rich details for", "every title"],
		series: ["Every episode,", "always within reach"],
		search: ["Find anything", "in seconds"],
		player: ["Playback that syncs", "with your server"],
	},
	nl: {
		home: ["Je Jellyfin-bibliotheek,", "als in de bioscoop"],
		continue: ["Kijk verder waar", "je gebleven was"],
		rows: ["Blader per genre,", "rij na rij"],
		library: ["Blader per genre,", "sorteer zoals jij wil"],
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

async function openContext(browser, locale, device) {
	const tv = device.name === "tv";
	const context = await browser.newContext({
		viewport: device.viewport,
		deviceScaleFactor: device.scale,
		isMobile: device.name === "phone",
		hasTouch: device.name === "phone",
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
	async continue(page) {
		await go(page, "/");
		await settle(page);
		// Continue watching at the top, just under the header.
		await page.evaluate(() => {
			const shelf = document.getElementById("continue");
			if (shelf) window.scrollTo(0, shelf.getBoundingClientRect().top + window.scrollY - 96);
		});
		await settle(page, 2000);
	},
	async library(page) {
		await go(page, "/library/movies?view=grid");
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
		// Bring up the controls, as a viewer would: OK on a remote, a tap on
		// a phone, the pointer elsewhere.
		const { width, height } = page.viewportSize();
		if (tv) await page.keyboard.press("Enter");
		else if (width < 600) await page.touchscreen.tap(width / 2, height / 2);
		else await page.mouse.move(width / 2, height / 2);
		await page.waitForTimeout(800);
	},
};

const JPEG = { type: "jpeg", quality: 90 };

const DEVICES = [
	{
		name: "phone",
		viewport: { width: 412, height: 915 },
		scale: 3,
		screens: ["home", "continue", "details", "series", "library", "search", "player"],
		folders: ["phoneScreenshots"],
		canvas: { width: 1080, height: 1920 },
	},
	{
		name: "tablet",
		viewport: { width: 1280, height: 800 },
		scale: 2,
		screens: ["home", "rows", "details", "series", "search", "player"],
		folders: ["sevenInchScreenshots", "tenInchScreenshots"],
		canvas: { width: 2560, height: 1440 },
	},
	{
		name: "tv",
		viewport: { width: 960, height: 540 },
		scale: 2,
		screens: ["home", "rows", "details", "series", "player"],
		folders: ["tvScreenshots"],
	},
];

/** The caption and device frame around a screenshot, sized per canvas. */
function captionPage(raw, [first, second], device) {
	const image = `data:image/png;base64,${raw.toString("base64")}`;
	const phone = device.name === "phone";
	const { width, height } = device.canvas;
	// Phone: a narrow frame that runs off the bottom; tablet: a wide one.
	const frame = phone
		? "left:50%;top:430px;transform:translateX(-50%);width:800px;height:1720px;padding:22px;border-radius:96px"
		: "left:50%;top:470px;transform:translateX(-50%);width:1960px;height:1225px;padding:34px;border-radius:64px";
	return `<!doctype html><html><head>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;700&display=swap" rel="stylesheet">
<style>
html,body{margin:0;width:${width}px;height:${height}px;overflow:hidden;font-family:"Space Grotesk",sans-serif}
body{background:radial-gradient(ellipse at 50% -10%,#4a2a7a 0%,#1c1a3a 38%,#0b1020 70%);color:#fff;text-align:center}
.eyebrow{margin-top:${phone ? 100 : 70}px;font-size:${phone ? 30 : 34}px;letter-spacing:.42em;font-weight:500;color:#d9dcf2}
.eyebrow b{color:#c9a7ff;font-weight:700;margin-right:.35em;letter-spacing:0}
h1{margin:${phone ? 22 : 26}px 0 0;font-size:${phone ? 68 : 92}px;line-height:1.1;font-weight:700;letter-spacing:-.01em}
h1 span{background:linear-gradient(90deg,#8ec5ff,#c7b2ff 55%,#ffb38a);-webkit-background-clip:text;color:transparent}
.rule{width:${phone ? 900 : 1800}px;height:2px;margin:${phone ? 44 : 56}px auto 0;background:linear-gradient(90deg,transparent,#a77bd8 30%,#6aa8ff 70%,transparent);opacity:.6}
.frame{position:absolute;${frame};box-sizing:border-box;
background:linear-gradient(160deg,#3a3f5c,#1a1d2e 40%,#11131f);box-shadow:0 50px 120px rgba(0,0,0,.55),inset 0 0 0 2px rgba(255,255,255,.08)}
.frame img{display:block;width:100%;${phone ? "" : "height:100%;"}border-radius:${phone ? 76 : 34}px}
</style></head><body>
<div class="eyebrow"><b>✦</b>AURORA</div>
<h1>${first}<br><span>${second}</span></h1>
<div class="rule"></div>
<div class="frame"><img src="${image}"></div>
</body></html>`;
}

async function capture(browser, locale, device) {
	const context = await openContext(browser, locale, device);
	const page = await context.newPage();
	for (const folder of device.folders) {
		fs.rmSync(path.join(metadata, locale.store, "images", folder), { recursive: true, force: true });
		fs.mkdirSync(path.join(metadata, locale.store, "images", folder), { recursive: true });
	}
	const composer = device.canvas ? await browser.newPage({ viewport: device.canvas }) : null;

	for (const [index, name] of device.screens.entries()) {
		await SCREENS[name](page, { tv: device.name === "tv" });
		const file = `${String(index + 1).padStart(2, "0")}_${name}.jpg`;
		// JPEG keeps the listing (and the repo) light; Play takes either.
		let image;
		if (composer) {
			await composer.setContent(
				captionPage(await page.screenshot(), CAPTIONS[locale.app][name], device),
				{ waitUntil: "networkidle" },
			);
			await composer.evaluate(() => document.fonts.ready);
			image = await composer.screenshot(JPEG);
		} else {
			image = await page.screenshot(JPEG);
		}
		for (const folder of device.folders) {
			fs.writeFileSync(path.join(metadata, locale.store, "images", folder, file), image);
		}
		console.log(`${locale.store} ${device.name}: ${file}`);
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
		for (const device of DEVICES) {
			if (!only || only === device.name) await capture(browser, locale, device);
		}
	}
} finally {
	await browser.close();
}
