// Drives a real headless browser to /dev/sqlite and runs a query against the
// live PrimssgDB connection — the only way to inspect OPFS/SQLite-Wasm data,
// since it lives entirely in browser storage with no server-side file/endpoint.
//
// Run: bun run packages/primssg-db/scripts/query.mjs "SELECT * FROM keys"

import { chromium } from "playwright";

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const sql = process.argv[2] ?? "SELECT * FROM keys";

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(`${BASE_URL}/dev/sqlite`);
await page.waitForSelector("text=Connected");

await page.fill("textarea", sql);
await page.click('button:has-text("Run")');

const errorLocator = page.locator("p.text-red-600");
if (await errorLocator.count()) {
  console.error(await errorLocator.textContent());
  await browser.close();
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
await browser.close();
