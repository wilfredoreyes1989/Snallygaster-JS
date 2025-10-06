import fs from "fs";
import path from "path";
import * as XLSX from "xlsx";
import { chromium } from "playwright";

const BASE_URL = "https://untappd.com/v/snallygaster-2025/13633892?menu_id=247596";
const OUT_DIR = "./data";

if (!fs.existsSync(OUT_DIR)) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
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

  // Scroll through to load all beers
  let previousHeight = 0;
  while (true) {
    const newHeight = await page.evaluate(() => document.body.scrollHeight);
    if (newHeight === previousHeight) break;
    previousHeight = newHeight;
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(1500);
  }

  // Extract beer data
  const beers = await page.$$eval(".menu-item", (cards) =>
    cards.map((card) => {
      const name = card.querySelector(".menu-item-name")?.innerText?.trim() || "";
      const brewery = card.querySelector(".menu-item-brewery")?.innerText?.trim() || "";
      const style = card.querySelector(".menu-item-style")?.innerText?.trim() || "";
      const abv = card.querySelector(".menu-item-abv")?.innerText?.trim() || "";
      return { Name: name, Brewery: brewery, Style: style, ABV: abv };
    })
  );

  await browser.close();

  if (!beers.length) {
    console.warn("[WARN] No beers found — Untappd structure may have changed.");
  } else {
    console.log(`[OK] Found ${beers.length} beers.`);
  }

  // Save results
  const csvPath = path.join(OUT_DIR, "snallygaster_2025.csv");
  const xlsxPath = path.join(OUT_DIR, "snallygaster_2025.xlsx");

  const csvData =
    "Name,Brewery,Style,ABV\n" +
    beers.map((b) => `${b.Name},${b.Brewery},${b.Style},${b.ABV}`).join("\n");

  fs.writeFileSync(csvPath, csvData);
  toExcel(beers, xlsxPath);

  console.log("[DONE] Files saved to ./data/");
  console.log("- snallygaster_2025.csv");
  console.log("- snallygaster_2025.xlsx");
}

scrapeSnallygaster().catch((err) => {
  console.error("[ERROR]", err);
});
