// Renders every preview state in light and dark, wide and narrow, with the
// installed Google Chrome (playwright-core downloads no browser).
//   npm run screenshots                 → docs/screenshots/
//   npm run screenshots -- some/dir     → another folder
import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "../apps/paseo/node_modules/playwright-core/index.mjs";
import { createServer } from "../apps/paseo/node_modules/vite/dist/node/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const plugin = join(here, "..", "apps", "paseo");
const out = resolve(process.argv[2] ?? join(here, "..", "docs", "screenshots"));
mkdirSync(out, { recursive: true });

const STATES = ["setup", "overview", "overview-basic", "overview-admin", "overview-router-down", "overview-claude-paused", "models", "models-basic", "providers", "providers-admin", "accounts-operator", "accounts-admin", "accounts-claude-paused", "usage-populated", "usage-empty", "settings-operator", "settings-manage-key", "settings-recommended", "connection", "connection-basic", "connection-admin", "connection-router-down", "connection-misconfigured"];
const SIZES = { wide: 1280, narrow: 420 };
const only = process.env.STATES?.split(",");

const server = await createServer({ configFile: join(plugin, "tests", "ui", "vite.config.mts"), logLevel: "error" });
await server.listen();
const browser = await chromium.launch({ channel: "chrome" });
let failures = 0;
try {
  for (const state of STATES.filter((name) => !only || only.includes(name))) {
    for (const theme of ["light", "dark"]) {
      for (const [size, width] of Object.entries(SIZES)) {
        const page = await browser.newPage({ viewport: { width, height: 900 }, deviceScaleFactor: 1 });
        await page.goto(`http://127.0.0.1:43199/?state=${state}&theme=${theme}`);
        await page.waitForFunction(() => document.body.innerText.includes("AI Router"), null, { timeout: 15_000 });
        await page.waitForTimeout(400);
        // The panel scrolls inside itself; grow the page to the content so one PNG holds all of it.
        const height = await page.evaluate(() => Math.max(...[...document.querySelectorAll("div")].map((el) => el.scrollHeight)));
        await page.setViewportSize({ width, height: Math.min(Math.max(900, height), 9000) });
        await page.waitForTimeout(150);
        const errors = await page.evaluate(() => window.__renderErrors ?? []);
        const clipped = await page.evaluate(() => [...document.querySelectorAll("div,span")].filter((el) => el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX !== "visible").length);
        const file = join(out, `${state}-${theme}-${size}.png`);
        await page.screenshot({ path: file });
        const notes = [errors.length ? `${errors.length} render errors: ${errors[0].slice(0, 120)}` : "", clipped ? `${clipped} clipped boxes` : ""].filter(Boolean).join("; ");
        if (errors.length) failures += 1;
        console.log(`${notes ? "WARN" : "ok  "} ${file.replace(`${resolve(here, "..")}/`, "")}${notes ? ` — ${notes}` : ""}`);
        await page.close();
      }
    }
  }
} finally {
  await browser.close();
  await server.close();
}
if (failures) process.exit(1);
