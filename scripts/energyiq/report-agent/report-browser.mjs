import { checkReportDates } from './report-review.mjs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';
import { writeFileSync } from 'node:fs';

export async function checkReportBrowser(directory) {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ executablePath: process.env.REPORT_CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const issues = [];
  const checks = [];
  try {
    for (const width of [1440, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      page.on('pageerror', error => issues.push({ problem: `JavaScript error at ${width}px: ${error.message}`, correction: 'Fix the report JavaScript and rerun browser checks.', resolved: false }));
      await page.route('**/*', route => /^(file:|data:|blob:)/.test(route.request().url()) ? route.continue() : route.abort());
      await page.goto(pathToFileURL(join(directory, 'report.html')).href, { waitUntil: 'load', timeout: 20000 });
      const calendar = checkReportDates(await page.locator('body').innerText());
      checks.push(...calendar.checks); issues.push(...calendar.issues);
      for (const expanded of [false, true]) {
        if (expanded) await page.locator('details').evaluateAll(nodes => nodes.forEach(node => { node.open = true; }));
        const measured = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth }));
        if (measured.scrollWidth > width + 2) issues.push({ problem: `Page overflow at ${width}px (${expanded ? 'details expanded' : 'initial'}): ${measured.scrollWidth}px`, correction: 'Fix grid child min-width, text wrapping and local table scrolling without hiding page content.', resolved: false });
        checks.push({ claim: `Browser layout ${width}px, details expanded=${expanded}`, evidence: JSON.stringify(measured) });
      }
      await page.screenshot({ path: join(directory, `browser-${width}.png`) });
      await page.close();
    }
  } finally { await browser.close(); }
  const result = { status: issues.length ? 'revise' : 'pass', checks, issues, scope: 'Layout and JavaScript smoke checks only; filter semantics require report-specific interaction checks.' };
  writeFileSync(join(directory, 'browser-check.json'), JSON.stringify(result, null, 2));
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await checkReportBrowser(process.argv[2] || '/workspace/outputs');
  console.log(JSON.stringify(result));
  if (result.status !== 'pass') process.exitCode = 1;
}
