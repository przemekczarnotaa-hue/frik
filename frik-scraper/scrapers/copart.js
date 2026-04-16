'use strict';
const { chromium } = require('playwright');

/**
 * Scrape vehicle data from a Copart listing page.
 * Returns { source: 'Copart', data: { ... } }
 *
 * NOTE: Copart uses Angular SPA and aggressive bot-detection (Cloudflare).
 * If this fails, the frontend should fall back to the PDF upload path.
 */
async function scrapeCopart(url) {
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-dev-shm-usage',
      '--disable-gpu',
    ],
  });

  try {
    const context = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      viewport: { width: 1440, height: 900 },
      locale: 'en-US',
      extraHTTPHeaders: { 'Accept-Language': 'en-US,en;q=0.9' },
    });

    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      Object.defineProperty(navigator, 'plugins',   { get: () => [1, 2, 3] });
      window.chrome = { runtime: {} };
    });

    const page = await context.newPage();

    // Block fonts only — keep scripts & images for Angular to render
    await page.route('**/*.{woff,woff2,ttf,otf}', r => r.abort().catch(() => {}));

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });

    // Copart Angular needs more time to populate lot details
    await page.waitForTimeout(5_000);

    // Try to wait for the lot-details section
    try {
      await page.waitForSelector(
        '.lot-details, .veh-details, [class*="lot-detail"], .lot-number-details',
        { timeout: 8_000 },
      );
    } catch { /* proceed with whatever rendered */ }

    const pageTitle = await page.title();
    const snippet   = await page.evaluate(() => document.body.innerText.slice(0, 600));
    const finalUrl  = page.url();

    if (/just a moment|browser verification|cf-browser-verification/i.test(snippet + pageTitle)) {
      throw new Error('Cloudflare protection detected — użyj PDF fallback');
    }
    if (/login|signin|sign-in/i.test(finalUrl) || /sign in|log in/i.test(pageTitle)) {
      throw new Error('Strona wymaga logowania — użyj PDF fallback');
    }

    // ── Extract data ──────────────────────────────────────────────
    const data = await page.evaluate(() => {
      const body = document.body.innerText;

      function extract(pattern) {
        const m = body.match(pattern);
        return m ? m[1].trim() : null;
      }
      function labelVal(label) {
        return extract(new RegExp(label + '[:\\s]+([^\\n\\r]{1,120})', 'i'));
      }

      // VIN
      const vinMatch = body.match(/\b([A-HJ-NPR-Z0-9]{17})\b/);
      const vin = vinMatch ? vinMatch[1] : null;

      // Title: Copart uses h1 or .lot-title
      const titleEl = document.querySelector(
        'h1, .lot-title, [class*="lot-title"], [class*="veh-info__title"]',
      );
      let vehicleTitle = titleEl ? titleEl.textContent.trim() : null;

      let year = null, make = null, model = null;
      if (vehicleTitle) {
        const m = vehicleTitle.match(/^(\d{4})\s+([A-Za-z\-]+)\s+(.+)/);
        if (m) {
          year  = parseInt(m[1], 10);
          make  = m[2];
          model = m[3].replace(/\s*\|.*$/, '').replace(/\s*#.*$/, '').trim();
        }
      }

      // Lot number from URL (format: /lot/XXXXXXXX/)
      const lotFromUrl  = window.location.href.match(/\/lot\/([0-9]+)/);
      const lotFromText = body.match(/\bLot(?:\s*#?\s*|\s*:\s*)([0-9]{6,10})\b/i);
      const lotNumber   = lotFromUrl ? lotFromUrl[1] : (lotFromText ? lotFromText[1] : null);

      // Damage
      const primaryDamage   = labelVal('Primary Damage');
      const secondaryDamage = labelVal('Secondary Damage');

      // Odometer
      const odoM = body.match(/Odometer[:\s]*([\d,]+)\s*mi/i)
                || body.match(/Mileage[:\s]*([\d,]+)/i);
      const odometer = odoM ? parseInt(odoM[1].replace(/,/g, ''), 10) : null;

      // Run & Drive
      const rdM = body.match(/Run\s*(?:&|and|\/)\s*Drive[:\s]*(Yes|No|[A-Za-z ]{2,25})/i);
      const runDrive = rdM ? rdM[1].trim() : null;

      // Sale date
      const sdM = body.match(/Sale Date[:\s]+([^\n]{4,40})/i)
               || body.match(/Auction[:\s]+([0-9]{1,2}\/[0-9]{1,2}\/[0-9]{4})/i);
      const saleDate = sdM ? sdM[1].trim() : null;

      // Location
      const locM = body.match(/Location[:\s]+([^\n]{3,80})/i)
                || body.match(/Yard[:\s]+([^\n]{3,80})/i);
      const location = locM ? locM[1].trim() : null;

      // Estimated / actual value
      const estM = body.match(/Estimated(?:\s+Retail)?\s+Value[:\s$]*([\d,]+)/i)
                || body.match(/Actual\s+Value[:\s$]*([\d,]+)/i);
      const estimatedValue = estM ? parseInt(estM[1].replace(/,/g, ''), 10) : null;

      // ── Images ───────────────────────────────────────────────────
      const images = [];
      const seen   = new Set();

      // Copart serves images from cs.copart.com or cdnmedia.copart.com
      const inlineUrls = document.documentElement.innerHTML
        .match(/https?:\/\/(?:cs|cdnmedia)\.copart\.com\/[^"' \)\\]+\.(?:jpe?g|png|webp)/gi) || [];
      inlineUrls.forEach(u => {
        const clean = u.split(/[?#]/)[0];
        if (!seen.has(clean)) { images.push(clean); seen.add(clean); }
      });

      // Also check regular img tags
      document.querySelectorAll('img').forEach(img => {
        const src = img.getAttribute('src') || img.getAttribute('data-src');
        if (!src || seen.has(src)) return;
        if (!/\.(jpe?g|png|webp)/i.test(src)) return;
        if (/logo|icon|avatar|banner|sprite|placeholder/i.test(src)) return;
        images.push(src);
        seen.add(src);
      });

      return {
        vehicleTitle, year, make, model, vin, lotNumber,
        primaryDamage, secondaryDamage, odometer, runDrive,
        saleDate, location, estimatedValue,
        images: [...new Set(images)].slice(0, 15),
      };
    });

    return { source: 'Copart', data };

  } finally {
    await browser.close();
  }
}

module.exports = { scrapeCopart };
