#!/usr/bin/env node
// Captures the live Webflow site into ./source so it can be imported 1:1.
//
//   node scripts/capture-source.mjs [origin] [--no-screenshots]
//
// Output:
//   source/pages/<slug>.html      raw HTML exactly as served
//   source/assets/<host>/<path>   every first-party asset (CSS, JS, images, fonts, video, icons)
//   source/screenshots/*.png      full-page screenshots of the live site
//   source/manifest.json          routes, statuses, asset URL -> file map, external URLs left as-is
//
// Read-only: only GET requests are made. Forms are never submitted.

import fs from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'node-html-parser';

const args = process.argv.slice(2);
const ORIGIN = new URL(args.find((a) => !a.startsWith('--')) ?? 'https://www.theblindwalleye.com').origin;
const SCREENSHOTS = !args.includes('--no-screenshots');
const OUT = path.resolve('source');
const SEED_ROUTES = ['/', '/menu', '/events'];
const MAX_PAGES = 60;
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';

// Hosts whose files are mirrored locally. Anything else is recorded as external.
const MIRROR_HOSTS = [
  new URL(ORIGIN).host,
  'cdn.prod.website-files.com',
  'assets.website-files.com',
  'assets-global.website-files.com',
  'uploads-ssl.webflow.com',
  'global-uploads.webflow.com',
  'd3e54v103j8qbb.cloudfront.net',
  'd1otoma47x30pg.cloudfront.net',
];

export const SCREENSHOT_VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'tablet', width: 991, height: 1100 },
  { name: 'mobile', width: 390, height: 844 },
];

const manifest = { origin: ORIGIN, capturedAt: new Date().toISOString(), pages: [], assets: {}, external: [], failures: [] };
const external = new Set();

async function get(url) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'user-agent': UA }, redirect: 'follow' });
      return res;
    } catch (err) {
      if (attempt >= 4) throw err;
      await new Promise((r) => setTimeout(r, 2 ** attempt * 1000));
    }
  }
}

export function routeToSlug(route) {
  if (route === '/') return 'index';
  if (route === '__404') return '__404';
  return route.replace(/^\/+|\/+$/g, '').replace(/\//g, '__');
}

function shouldMirror(u) {
  return (u.protocol === 'https:' || u.protocol === 'http:') && MIRROR_HOSTS.includes(u.host);
}

function assetFile(u) {
  const clean = decodeURIComponent(u.pathname).replace(/^\/+/, '') || 'index';
  const q = u.search ? '__' + Buffer.from(u.search).toString('base64url') : '';
  return path.join('assets', u.host, clean + q);
}

function collectFromSrcset(value, base, out) {
  for (const part of value.split(',')) {
    const src = part.trim().split(/\s+/)[0];
    if (src) out.add(new URL(src, base).href);
  }
}

function collectCssUrls(css, base, out) {
  for (const m of css.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g)) {
    if (!m[2].startsWith('data:') && !m[2].startsWith('#')) out.add(new URL(m[2], base).href);
  }
  for (const m of css.matchAll(/@import\s+(?:url\()?\s*['"]([^'"]+)['"]/g)) out.add(new URL(m[1], base).href);
}

export function collectHtmlUrls(html, base) {
  const out = new Set();
  const root = parse(html, { comment: true });
  const attr = (sel, name) => root.querySelectorAll(sel).forEach((el) => {
    const v = el.getAttribute(name);
    if (v && !v.startsWith('data:') && !v.startsWith('#') && !v.startsWith('mailto:') && !v.startsWith('tel:')) {
      out.add(new URL(v, base).href);
    }
  });
  attr('link[href]', 'href');
  attr('script[src]', 'src');
  attr('img[src]', 'src');
  attr('video[src]', 'src');
  attr('video[poster]', 'poster');
  attr('source[src]', 'src');
  attr('[data-src]', 'data-src');
  attr('[data-poster-url]', 'data-poster-url');
  attr('[data-animation-url]', 'data-animation-url');
  root.querySelectorAll('[srcset]').forEach((el) => collectFromSrcset(el.getAttribute('srcset'), base, out));
  root.querySelectorAll('[data-video-urls]').forEach((el) =>
    el.getAttribute('data-video-urls').split(',').forEach((v) => v.trim() && out.add(new URL(v.trim(), base).href)),
  );
  root.querySelectorAll('meta[content]').forEach((el) => {
    const c = el.getAttribute('content');
    if (/^https?:\/\//.test(c) && /image|icon|url/i.test(el.getAttribute('property') ?? el.getAttribute('name') ?? '')) {
      out.add(c);
    }
  });
  root.querySelectorAll('[style]').forEach((el) => collectCssUrls(el.getAttribute('style'), base, out));
  root.querySelectorAll('style').forEach((el) => collectCssUrls(el.textContent, base, out));
  return out;
}

function internalLinks(html, base) {
  const links = new Set();
  for (const a of parse(html).querySelectorAll('a[href]')) {
    const href = a.getAttribute('href');
    if (!href || href.startsWith('#') || /^(mailto|tel|javascript):/.test(href)) continue;
    const u = new URL(href, base);
    if (u.origin !== ORIGIN) continue;
    if (/\.[a-z0-9]{2,5}$/i.test(u.pathname)) continue;
    links.add(u.pathname.replace(/\/+$/, '') || '/');
  }
  return links;
}

async function mirror(url, queue) {
  if (manifest.assets[url] !== undefined) return;
  const u = new URL(url);
  if (!shouldMirror(u)) {
    external.add(url);
    return;
  }
  manifest.assets[url] = null;
  const res = await get(url).catch((e) => ({ ok: false, status: String(e) }));
  if (!res.ok) {
    manifest.failures.push({ url, status: res.status });
    return;
  }
  const buf = Buffer.from(await res.arrayBuffer());
  const rel = assetFile(u);
  await fs.mkdir(path.join(OUT, path.dirname(rel)), { recursive: true });
  await fs.writeFile(path.join(OUT, rel), buf);
  manifest.assets[url] = { file: rel, type: res.headers.get('content-type'), bytes: buf.length };
  if (/css/.test(res.headers.get('content-type') ?? '') || u.pathname.endsWith('.css')) {
    const nested = new Set();
    collectCssUrls(buf.toString('utf8'), url, nested);
    nested.forEach((n) => queue.push(n));
  }
}

async function capturePages() {
  const seen = new Set();
  const todo = [...SEED_ROUTES];
  const assetQueue = [];
  while (todo.length && seen.size < MAX_PAGES) {
    const route = todo.shift();
    if (seen.has(route)) continue;
    seen.add(route);
    const res = await get(ORIGIN + route);
    const html = await res.text();
    const slug = routeToSlug(route);
    await fs.mkdir(path.join(OUT, 'pages'), { recursive: true });
    await fs.writeFile(path.join(OUT, 'pages', slug + '.html'), html);
    manifest.pages.push({ route, slug, status: res.status, finalUrl: res.url });
    console.log(res.status, route);
    if (!res.ok) continue;
    collectHtmlUrls(html, res.url).forEach((a) => assetQueue.push(a));
    internalLinks(html, res.url).forEach((l) => !seen.has(l) && todo.push(l));
  }

  // Webflow serves its custom 404 page for unknown paths.
  const missing = await get(`${ORIGIN}/__capture-missing-${Date.now()}`);
  const html404 = await missing.text();
  await fs.writeFile(path.join(OUT, 'pages', '__404.html'), html404);
  manifest.pages.push({ route: '__404', slug: '__404', status: missing.status, finalUrl: missing.url });
  collectHtmlUrls(html404, missing.url).forEach((a) => assetQueue.push(a));

  for (const extra of ['/robots.txt', '/sitemap.xml', '/favicon.ico']) {
    const r = await get(ORIGIN + extra);
    manifest.pages.push({ route: extra, slug: null, status: r.status, finalUrl: r.url });
    if (r.ok) {
      await fs.mkdir(path.join(OUT, 'root'), { recursive: true });
      await fs.writeFile(path.join(OUT, 'root', extra.slice(1)), Buffer.from(await r.arrayBuffer()));
    }
  }

  while (assetQueue.length) await mirror(assetQueue.shift(), assetQueue);
}

async function captureScreenshots() {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch();
  await fs.mkdir(path.join(OUT, 'screenshots'), { recursive: true });
  for (const page of manifest.pages.filter((p) => p.slug)) {
    for (const vp of SCREENSHOT_VIEWPORTS) {
      const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, userAgent: UA });
      const tab = await ctx.newPage();
      const url = page.slug === '__404' ? page.finalUrl : ORIGIN + page.route;
      await tab.goto(url, { waitUntil: 'networkidle' });
      await settle(tab);
      await tab.screenshot({ path: path.join(OUT, 'screenshots', `${page.slug}-${vp.name}.png`), fullPage: true });
      await ctx.close();
    }
  }
  await browser.close();
}

// Scroll through the page so lazy images load and scroll-triggered interactions finish, then return to top.
export async function settle(tab) {
  await tab.evaluate(async () => {
    const step = window.innerHeight / 2;
    for (let y = 0; y < document.body.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 150));
    }
    window.scrollTo(0, 0);
  });
  await tab.waitForLoadState('networkidle');
  await tab.waitForTimeout(1500);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await fs.rm(OUT, { recursive: true, force: true });
  await capturePages();
  manifest.external = [...external].sort();
  await fs.writeFile(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
  if (SCREENSHOTS) await captureScreenshots();
  console.log(
    `pages: ${manifest.pages.length}, assets: ${Object.keys(manifest.assets).length}, failures: ${manifest.failures.length}, external: ${manifest.external.length}`,
  );
}
