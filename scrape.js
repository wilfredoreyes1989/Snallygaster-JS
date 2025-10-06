import fs from "fs";
import path from "path";
import * as XLSX from "xlsx";
import { chromium } from "playwright";

// Base URL (the main Snallygaster 2025 page)
const BASE_URL = "https://untappd.com/v/snallygaster-2025/13633892?menu_id=247596";

// Directory for output
const OUT_DIR = "./data";
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

function sanitize(text) {
  return text?.trim().replace(/\s+/g, " ") || "";
}

function toExcel(rows, filePath) {
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Beers");
  XLSX.writeFile(wb, filePath);
}

async function scrapeSnallygaster() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  console.log(`[INFO] Navigating to: ${BASE_URL}`);
  await page.goto(BASE_URL, { waitUntil: "networkidle" });

  // Scroll to load all beers
  let previousHeight;
  while (true) {
    previousHeight = await page.evaluate("document.body.scrollHeight");
    await page.evaluate("window.scrollTo(0, document.body.scrollHeight)");
    await page.waitForTimeout(1500);
    const newHeight = await page.evaluate("document.body.scrollHeight");
    if (newHeight === previousHeight) break;
  }

  // Scrape beers
  const beers = await page.$$eval(".menu-item", (cards) => {
    return cards.map((card) => {
      const name = card.querySelector(".menu-item-name")?.innerText || "";
      const brewery = card.querySelector(".menu-item-brewery")?.innerText || "";
      const style = card.querySelector(".menu-item-style")?.innerText || "";
      const abv = card.querySelector(".menu-item-abv")?.innerText || "";
      return { Name: name.trim(), Brewery: brewery.trim(), Style: style.trim(), ABV: abv.trim() };
    });
  });

  await browser.close();

  if (beers.length === 0) {
    console.warn("[WARN] No beers found. Site may have changed.");
  } else {
    console.log(`[OK] Found ${beers.length} beers`);
  }

  // Save as CSV and Excel
  const csvPath = pat

