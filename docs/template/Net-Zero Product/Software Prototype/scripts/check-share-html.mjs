import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const htmlPath = path.resolve(__dirname, "../nap-energy-analysis-share.html");
const html = readFileSync(htmlPath, "utf8");

const server = createServer((_req, res) => {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;
const url = `http://127.0.0.1:${port}/`;

const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
page.on("console", (msg) => {
  if (msg.type() === "error") {
    errors.push(`console: ${msg.text()}`);
  }
});

await page.goto(url, { waitUntil: "networkidle" });
await page.waitForTimeout(3000);

const rootLen = await page.$eval("#root", (el) => el.innerHTML.length).catch(() => 0);
const title = await page.title();
const text = await page.locator("body").innerText().catch(() => "");
console.log(JSON.stringify({ url, title, rootLen, textPreview: text.slice(0, 200), errors }, null, 2));

await browser.close();
server.close();
