// Drives a real headless browser to the app's dev panel and runs a query
// against the live PrimssgDB connection — the only way to inspect
// OPFS/SQLite-Wasm data, since it lives entirely in browser storage with no
// server-side file/endpoint. The panel only mounts when NEXT_PUBLIC_DEV is
// truthy, so the dev server needs that env var set.
//
// Uses a persistent Chromium profile (packages/primssg-db/.playwright-profile,
// gitignored) rather than a fresh throwaway context each run — OPFS storage is
// scoped per-profile, so this needs to be the *same* browser profile a real dev
// session (or another script) used, or it'll always see an empty DB.
//
// Run: bun run packages/primssg-db/scripts/query.mjs "SELECT * FROM keys"

import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const sql = process.argv[2] ?? "SELECT * FROM keys";
const PROFILE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".playwright-profile");

const context = await chromium.launchPersistentContext(PROFILE_DIR, {});
const page = context.pages()[0] ?? (await context.newPage());
await page.goto(BASE_URL);
await page.click('button:has-text("dev")');
await page.waitForSelector("text=Connected");

await page.fill("textarea", sql);
await page.click('button:has-text("Run")');

const errorLocator = page.locator("p.text-red-600");
if (await errorLocator.count()) {
  console.error(await errorLocator.textContent());
  await context.close();
  process.exit(1);
}

await page.waitForSelector("table", { timeout: 5000 }).catch(() => {});
const result = await page.evaluate(() => {
  const table = document.querySelector("table");
  if (!table) return { columns: [], rows: [] };
  const columns = [...table.querySelectorAll("thead th")].map((th) => th.textContent ?? "");
  const rows = [...table.querySelectorAll("tbody tr")].map((tr) =>
    [...tr.querySelectorAll("td")].map((td) => td.textContent ?? ""),
  );
  return { columns, rows };
});

console.log(JSON.stringify(result, null, 2));
await context.close();
