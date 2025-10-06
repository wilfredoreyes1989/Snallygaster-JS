// scrape.js — Scrape ALL Snallygaster 2025 tabs into CSV/XLSX
import fs from "fs";
import path from "path";
import * as XLSX from "xlsx";
import { chromium } from "playwright";

const BASE_URL =
  process.env.BASE_URL ||
  "https://untappd.com/v/snallygaster-2025/13633892?menu_id=247596";

const OUT_DIR = "./data";
const CSV_PATH = path.join(OUT_DIR, "snallygaster_2025.csv");
const XLSX_PATH = path.join(OUT_DIR, "snallygaster_2025.xlsx");

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

const uniqBy = (arr, keyFn) => {
  const s = new Set();
  return arr.filter((x) => {
    const k = keyFn(x);
    if (s.has(k)) return false;
    s.add(k);
    return true;
  });
};

async function acceptBanners(page) {
  const sels = [
    'button#onetrust-accept-btn-handler',
    "//button[contains(., 'Accept')]",
    "//button[contains(., 'I Accept')]",
    "//button[contains(., 'I agree')]",
    "//button[contains(., 'Continue')]",
    "//button[contains(., 'Yes')]",
  ];
  for (const sel of sels) {
    try {
      const loc = sel.startsWith("//") ? page.locator(sel).first() : page.locator(sel);
      if (await loc.isVisible({ timeout: 800 })) {
        await loc.click().catch(() => {});
        await page.waitForTimeout(400);
      }
    } catch {}
  }
}

async function scrollToBottom(page, max = 60) {
  let last = await page.evaluate(() => document.body.scrollHeight);
  for (let i = 0; i < max; i++) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(600);
    const cur = await page.evaluate(() => document.body.scrollHeight);
    if (cur === last) break;
    last = cur;
  }
}

async function clickShowMore(page) {
  while (true) {
    const btn = page
      .locator(
        "//button[contains(.,'Show more') or contains(.,'Load more')] | //a[contains(.,'Show more') or contains(.,'Load more')]"
      )
      .first();
    if (!(await btn.isVisible().catch(() => false))) break;
    await btn.click().catch(() => {});
    await page.waitForTimeout(800);
  }
}

async function discoverTabs(page) {
  // Collect all links with ?menu_id=, unique by menu_id
  const hrefs = await page.$$eval("a[href*='menu_id=']", (as) =>
    Array.from(new Set(as.map((a) => a.href)))
  );
  if (page.url().includes("menu_id=")) hrefs.unshift(page.url());
  const seen = new Set();
  const out = [];
  for (const u of hrefs) {
    try {
      const mid = new URL(u).searchParams.get("menu_id") || "";
      if (mid && !seen.has(mid)) {
        seen.add(mid);
        out.push(u);
      }
    } catch {}
  }
  return out.sort();
}

function parseBeersFromDOM() {
  const sels = [
    "div.menu-item",
    "div.menu-items .menu-item",
    "div.card",
    "div.beer",
    "div.list-item",
    "div.item",
    "li.item",
    "article",
  ];
  const clean = (t) => (t || "").replace(/\s+/g, " ").trim();

  const nodes = [];
  for (const s of sels) document.querySelectorAll(s).forEach((n) => nodes.push(n));

  const rows = [];
  const seen = new Set();

  for (const n of nodes) {
    const text = clean(n.innerText);
    if (!text) continue;

    const nameEl =
      n.querySelector(".menu-item-name, .name, .beer-name, .title, a, strong, b, h3, h4") ||
      n.querySelector("h3,h4,strong,b,a");
    const name = nameEl ? clean(nameEl.textContent) : null;
    if (!name) continue;

    const breweryEl =
      n.querySelector(".menu-item-brewery, .brewery, .vendor, .producer, .subtitle, .secondary, a[href*='/brewery/']");
    const brewery = breweryEl ? clean(breweryEl.textContent) : null;

    const styleEl =
      n.querySelector(".menu-item-style, .style, .beer_style, .category, .meta, .details");
    const style = styleEl ? clean(styleEl.textContent) : null;

    const m = text.match(/(\d+(?:\.\d+)?)\s*%?\s*ABV|\b(\d+(?:\.\d+)?)\s*%\b/i);
    const abv = m ? (m[1] || m[2] || "").trim() : null;

    const key = `${name}:::${brewery || ""}`;
    if (seen.has(key)) continue;
    seen.add(key);

    rows.push({ Name: name, Brewery: brewery, Style: style, "ABV%": abv });
  }
  return rows;
}

async function scrapeTab(page, url) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForLoadState("networkidle").catch(() => {});
  await acceptBanners(page);
  await scrollToBottom(page);
  await clickShowMore(page);
  const rows = await page.evaluate(parseBeersFromDOM);
  return rows.map((r) => ({ ...r, "Source URL": url }));
}

async function main() {
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const page = await (await browser.newContext({ viewport: { width: 1366, height: 2400 } })).newPage();

  console.log("[INFO] Base URL:", BASE_URL);
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForLoadState("networkidle").catch(() => {});
  await acceptBanners(page);

  let tabs = await discoverTabs(page);
  if (!tabs.length) {
    await scrollToBottom(page);
    tabs = await discoverTabs(page);
  }
  if (!tabs.length) tabs = [BASE_URL];
  console.log("[INFO] Tabs discovered:", tabs.length);

  let all = [];
  for (let i = 0; i < tabs.length; i++) {
    console.log(`[INFO] Scraping ${i + 1}/${tabs.length}: ${tabs[i]}`);
    const rows = await scrapeTab(page, tabs[i]);
    all = all.concat(rows);
  }

  all = uniqBy(all, (r) => `${r.Name}:::${r.Brewery || ""}`);

  // Save CSV
  const headers = ["Name", "Brewery", "Style", "ABV%", "Source URL"];
  const csv =
    [headers.join(",")]
      .concat(
        all.map((r) => headers.map((h) => `"${String(r[h] ?? "").replace(/"/g, '""')}"`).join(","))
      )
      .join("\n");
  fs.writeFileSync(CSV_PATH, csv, "utf8");

  // Save XLSX
  const ws = XLSX.utils.json_to_sheet(all);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Snallygaster 2025");
  XLSX.writeFile(wb, XLSX_PATH);

  console.log(`[OK] Saved ${all.length} beers:
  - ${CSV_PATH}
  - ${XLSX_PATH}`);

  await browser.close();
}

main().catch((e) => {
  console.error("ERROR:", e);
  process.exit(1);
});
