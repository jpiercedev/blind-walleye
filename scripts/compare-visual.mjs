#!/usr/bin/env node
// Pixel-compares the replica against the captured Webflow source.
//
//   npm run build && npm start &   # replica on :3000
//   node scripts/compare-visual.mjs [replicaBase=http://localhost:3000]
//
// The "source" side loads source/pages/*.html at its original URL with every original asset request answered
// from source/assets (the exact bytes the live site served), so it renders what a browser saw on the live site.
// Google Fonts load live on both sides. Output: compare/<slug>-<viewport>-{source,replica,diff}.png
// and a mismatch table. Exits non-zero if any page exceeds the threshold.

import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import { SCREENSHOT_VIEWPORTS, settle } from './capture-source.mjs';

const BASE = process.argv[2] ?? 'http://localhost:3000';
const THRESHOLD_PCT = Number(process.env.MAX_DIFF_PCT ?? 0.5);
const OUT = path.resolve('compare');
const manifest = JSON.parse(await fs.readFile('source/manifest.json', 'utf8'));
const pages = manifest.pages.filter((p) => p.slug);

const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY } : undefined;
const browser = await chromium.launch({ proxy });

async function sourceRoute(route) {
  const url = route.request().url();
  const asset = manifest.assets[url];
  if (asset) {
    return route.fulfill({
      body: await fs.readFile(path.join('source', asset.file)),
      contentType: asset.type ?? undefined,
      headers: { 'access-control-allow-origin': '*' },
    });
  }
  const page = pages.find((p) => p.finalUrl === url || manifest.origin + p.route === url.replace(/\/$/, '') || (p.route === '/' && url === manifest.origin + '/'));
  if (page) {
    return route.fulfill({
      status: page.status,
      body: await fs.readFile(path.join('source', 'pages', page.slug + '.html')),
      contentType: 'text/html; charset=utf-8',
    });
  }
  if (/fonts\.(googleapis|gstatic)\.com|ajax\.googleapis\.com/.test(url)) return route.continue();
  return route.abort();
}

async function shoot(url, vp, file, isSource) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, ignoreHTTPSErrors: true });
  const tab = await ctx.newPage();
  if (isSource) await tab.route('**/*', sourceRoute);
  // Playwright forces loopback through the browser proxy, so replica responses are fetched from Node instead.
  else await tab.route('**/*', async (r) => {
    const u = r.request().url();
    if (u.startsWith(BASE)) {
      const res = await fetch(u, { method: r.request().method(), redirect: 'manual' });
      return r.fulfill({ status: res.status, headers: Object.fromEntries(res.headers), body: Buffer.from(await res.arrayBuffer()) });
    }
    return /fonts\.(googleapis|gstatic)\.com|ajax\.googleapis\.com/.test(u) ? r.continue() : r.abort();
  });
  await tab.goto(url, { waitUntil: 'networkidle' });
  await settle(tab);
  await tab.screenshot({ path: file, fullPage: true });
  await ctx.close();
}

function diff(a, b, out) {
  const A = PNG.sync.read(a);
  const B = PNG.sync.read(b);
  const width = Math.max(A.width, B.width);
  const height = Math.max(A.height, B.height);
  const pad = (img) => {
    if (img.width === width && img.height === height) return img;
    const p = new PNG({ width, height });
    PNG.bitblt(img, p, 0, 0, img.width, img.height, 0, 0);
    return p;
  };
  const D = new PNG({ width, height });
  const n = pixelmatch(pad(A).data, pad(B).data, D.data, width, height, { threshold: 0.1 });
  return fs.writeFile(out, PNG.sync.write(D)).then(() => ({
    pct: (100 * n) / (width * height),
    sizes: `${A.width}x${A.height} vs ${B.width}x${B.height}`,
  }));
}

await fs.mkdir(OUT, { recursive: true });
const rows = [];
for (const p of pages) {
  for (const vp of SCREENSHOT_VIEWPORTS) {
    const stem = path.join(OUT, `${p.slug}-${vp.name}`);
    const sourceUrl = p.slug === '__404' ? p.finalUrl : manifest.origin + p.route;
    const replicaUrl = p.slug === '__404' ? `${BASE}/__missing-page-check` : BASE + p.route;
    await shoot(sourceUrl, vp, `${stem}-source.png`, true);
    await shoot(replicaUrl, vp, `${stem}-replica.png`, false);
    const r = await diff(await fs.readFile(`${stem}-source.png`), await fs.readFile(`${stem}-replica.png`), `${stem}-diff.png`);
    rows.push({ page: p.route, viewport: vp.name, 'diff %': r.pct.toFixed(3), sizes: r.sizes });
  }
}
await browser.close();
console.table(rows);
process.exit(rows.some((r) => Number(r['diff %']) > THRESHOLD_PCT) ? 1 : 0);
