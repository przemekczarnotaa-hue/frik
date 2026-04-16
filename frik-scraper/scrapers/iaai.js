'use strict';
const { chromium } = require('playwright');

/**
 * Scrape vehicle data from an IAAI listing page.
 * Returns { source: 'IAAI', data: { ... } }
 */
async function scrapeIAAI(url) {
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
      viewport: { width: 1366, height: 768 },
      locale: 'en-US',
      extraHTTPHeaders: { 'Accept-Language': 'en-US,en;q=0.9' },
    });

    // Hide automation signals
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      Object.defineProperty(navigator, 'plugins',   { get: () => [1, 2, 3] });
      window.chrome = { runtime: {} };
    });

    const page = await context.newPage();

    // Speed up load — skip fonts and CSS; keep JS and images
    await page.route('**/*.{woff,woff2,ttf,otf}', r => r.abort().catch(() => {}));

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });

    // Let React/SPA hydrate
    await page.waitForTimeout(4_000);

    // Detect blocks
    const pageTitle = await page.title();
    const snippet   = await page.evaluate(() => document.body.innerText.slice(0, 600));

    if (/just a moment|browser verification|cf-browser-verification/i.test(snippet + pageTitle)) {
      throw new Error('Cloudflare protection detected — użyj PDF fallback');
    }
    const finalUrl = page.url();
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
        // "Label: value" or "Label\nvalue" patterns
        return extract(new RegExp(label + '[:\\s]+([^\\n\\r]{1,120})', 'i'));
      }

      // VIN ─ 17-char code (excludes I, O, Q per ISO 3779)
      const vinMatch = body.match(/\b([A-HJ-NPR-Z0-9]{17})\b/);
      const vin = vinMatch ? vinMatch[1] : null;

      // Title
      const titleEl = document.querySelector('h1, [class*="vehicle-title"], [class*="vdp-title"], [data-testid*="title"]');
      let vehicleTitle = titleEl ? titleEl.textContent.trim() : null;
      // Fallback: first prominent heading
      if (!vehicleTitle) {
        const any = document.querySelector('h2');
        if (any) vehicleTitle = any.textContent.trim();
      }

      // Parse year / make / model from title
      let year = null, make = null, model = null;
      if (vehicleTitle) {
        const m = vehicleTitle.match(/^(\d{4})\s+([A-Za-z\-]+)\s+(.+)/);
        if (m) {
          year  = parseInt(m[1], 10);
          make  = m[2];
          model = m[3].replace(/\s*\|.*$/, '').replace(/\s*#.*$/, '').trim();
        }
      }

      // Lot number
      const lotFromUrl  = window.location.href.match(/\/(\d{7,10})(?:[/?#]|$)/);
      const lotFromText = body.match(/\bLot(?:\s*#?\s*|\s*:\s*)(\d{6,10})\b/i);
      const lotNumber   = (lotFromUrl || lotFromText) ? (lotFromUrl || lotFromText)[1] : null;

      // Damage
      const primaryDamage   = labelVal('Primary Damage')   || labelVal('Primary');
      const secondaryDamage = labelVal('Secondary Damage') || labelVal('Secondary');

      // Odometer
      const odoM = body.match(/Odometer[:\s]*([\d,]+)\s*mi/i)
                || body.match(/Mileage[:\s]*([\d,]+)/i);
      const odometer = odoM ? parseInt(odoM[1].replace(/,/g, ''), 10) : null;

      // Run & Drive
      const rdM = body.match(/Run(?:s)?\s*(?:&|and|\/)\s*Drive(?:s)?[:\s]*(Yes|No|Run|Not Run|[A-Za-z ]{2,25})/i);
      const runDrive = rdM ? rdM[1].trim() : null;

      // Sale / Auction date
      const sdM = body.match(/Sale Date[:\s]+([^\n]{4,40})/i)
               || body.match(/Auction Date[:\s]+([^\n]{4,40})/i);
      const saleDate = sdM ? sdM[1].trim() : null;

      // Location
      const locM = body.match(/Location[:\s]+([^\n]{3,80})/i)
                || body.match(/Yard[:\s]+([^\n]{3,80})/i)
                || body.match(/Branch[:\s]+([^\n]{3,80})/i);
      const location = locM ? locM[1].trim() : null;

      // Estimated value
      const estM = body.match(/Estimated(?:\s+Retail)?\s+Value[:\s$]*([\d,]+)/i)
                || body.match(/Est\.?\s+Value[:\s$]*([\d,]+)/i);
      const estimatedValue = estM ? parseInt(estM[1].replace(/,/g, ''), 10) : null;

      // ── Images ───────────────────────────────────────────────────
      const images = [];
      const seen   = new Set();

      // 1. Visible <img> tags
      document.querySelectorAll('img').forEach(img => {
        const src = img.getAttribute('src') || img.getAttribute('data-src') || img.getAttribute('data-lazy');
        if (!src || seen.has(src)) return;
        if (!/\.(jpe?g|png|webp)/i.test(src)) return;
        if (/logo|icon|avatar|banner|sprite|pixel|placeholder/i.test(src)) return;
        images.push(src);
        seen.add(src);
      });

      // 2. High-res URLs embedded in page HTML (IAAI CDN)
      const inlineUrls = document.documentElement.innerHTML
        .match(/https?:\/\/(?:cs|images)\.iaai\.com\/[^"' \)\\]+\.(?:jpe?g|png|webp)/gi) || [];
      inlineUrls.forEach(u => {
        const clean = u.split(/[?#]/)[0];
        if (!seen.has(clean)) { images.push(clean); seen.add(clean); }
      });

      return {
        vehicleTitle, year, make, model, vin, lotNumber,
        primaryDamage, secondaryDamage, odometer, runDrive,
        saleDate, location, estimatedValue,
        images: [...new Set(images)].slice(0, 15),
      };
    });

    return { source: 'IAAI', data };

  } finally {
    await browser.close();
  }
}

module.exports = { scrapeIAAI };
