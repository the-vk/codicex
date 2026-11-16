import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { chromium } from "playwright-core";

const chrome = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const exec = promisify(execFile);

test("renders the blog and navigates with history under a subpath", async t => {
  try { await stat(chrome); } catch { t.skip("Set CHROME_PATH to a Chromium executable to run browser tests"); return; }
  const temp = await mkdtemp(path.join(os.tmpdir(), "codicex-browser-test-"));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const dist = path.join(temp, "dist");
  await exec(process.execPath, [path.join(root, "bin/codicex"), path.join(root, "tests/test-data"), "--output", dist]);
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url!, "http://localhost");
      if (!url.pathname.startsWith("/blog/")) { res.writeHead(404).end(); return; }
      let filename = path.resolve(dist, `.${decodeURIComponent(url.pathname.slice("/blog".length))}`);
      if (filename !== dist && !filename.startsWith(dist + path.sep)) { res.writeHead(403).end(); return; }
      if ((await stat(filename)).isDirectory()) filename = path.join(filename, "index.html");
      const extensions: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };
      res.setHeader("Content-Type", extensions[path.extname(filename)] ?? "text/plain");
      res.end(await readFile(filename));
    } catch { res.writeHead(404).end(); }
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}/blog/`;
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));

  await page.goto(origin);
  await page.getByRole("heading", { name: "Test Blog" }).waitFor();
  assert.equal(await page.locator(".post-preview").count(), 1);
  await page.evaluate(() => { (window as unknown as { sentinel: number }).sentinel = 1; });
  await page.getByRole("link", { name: "Example" }).click();
  await page.getByRole("heading", { name: "Example" }).waitFor();
  assert.match(page.url(), /\/blog\/2026\/01\/02\/example\.html$/);
  assert.equal(await page.locator("main .date").innerText(), "January 2, 2026");
  assert.match(await page.locator("main").innerText(), /Hello/);
  assert.equal(await page.evaluate(() => (window as unknown as { sentinel: number }).sentinel), 1);
  await page.goBack();
  await page.getByRole("heading", { name: "Test Blog" }).waitFor();
  await page.goForward();
  await page.getByRole("heading", { name: "Example" }).waitFor();
  await page.reload();
  await page.getByRole("heading", { name: "Example" }).waitFor();
  for (const [label, heading] of [["Posts", "Posts by Year"], ["Categories", "Posts by Category"], ["Tags", "Posts by Tag"], ["Pages", "Page Archive"]]) {
    await page.getByRole("link", { name: label, exact: true }).click();
    await page.getByRole("heading", { name: heading, level: 1 }).waitFor();
  }
  await page.goto(`${origin}2026/01/02/example.html`);
  await page.getByRole("heading", { name: "Example" }).waitFor();
  const image = page.getByRole("img", { name: "Example image" });
  assert.match(await image.getAttribute("src") ?? "", /^\/blog\/assets\/images\//);
  assert.equal(await image.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0), true);
  assert.deepEqual(errors, []);
});
