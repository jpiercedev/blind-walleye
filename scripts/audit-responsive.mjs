#!/usr/bin/env node
// Deterministic responsive layout audit of the running site.
//
//   node scripts/audit-responsive.mjs [base=http://localhost:3000] [--shots]
//
// For each route and width, after scroll-triggered interactions settle, reports horizontal overflow, elements
// extending past the viewport, header/hero geometry, form width, undersized touch targets and image geometry.
// --shots also writes full-page screenshots to compare/audit/<slug>-<width>.png.

import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { settle } from './capture-source.mjs';

const args = process.argv.slice(2);
const BASE = args.find((a) => !a.startsWith('--')) ?? 'http://localhost:3000';
const SHOTS = args.includes('--shots');
const ROUTES = (process.env.ROUTES ?? '/,/menu,/events').split(',');
const WIDTHS = (process.env.WIDTHS ?? '320,375,390,430,768,991,1440').split(',').map(Number);
const OUT = path.resolve('compare/audit');

const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY } : undefined;
const browser = await chromium.launch({ proxy });

// Playwright sends loopback through the browser proxy, so local responses are fetched from Node. Google Fonts
// are requested protocol-relative (plain http locally); upgrade them to https.
async function route(r) {
  const u = r.request().url();
  if (u.startsWith(BASE)) {
    const res = await fetch(u, { method: r.request().method(), redirect: 'manual' });
    return r.fulfill({ status: res.status, headers: Object.fromEntries(res.headers), body: Buffer.from(await res.arrayBuffer()) });
  }
  if (!/^https?:\/\/(fonts\.(googleapis|gstatic)\.com|ajax\.googleapis\.com)\//.test(u)) return r.abort();
  if (u.startsWith('https:')) return r.continue();
  return r.fulfill({ response: await r.fetch({ url: u.replace(/^http:/, 'https:') }) }).catch(() => r.abort());
}

function measure() {
  const vw = document.documentElement.clientWidth;
  const visible = (el) => {
    const s = getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const label = (el) =>
    el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.classList.length ? '.' + [...el.classList].join('.') : '');
  const inClosedNav = (el) => !!el.closest('.w-nav-menu') && !document.querySelector('.w-nav-button.w--open');

  const offscreen = [];
  for (const el of document.body.querySelectorAll('*')) {
    if (!visible(el) || inClosedNav(el) || el.closest('.w-nav-overlay')) continue;
    const r = el.getBoundingClientRect();
    if (r.right > vw + 1 || r.left < -1) {
      // Only report the outermost offender.
      if (!offscreen.some((o) => o.el.contains(el))) offscreen.push({ el, left: Math.round(r.left), right: Math.round(r.right) });
    }
  }

  const small = [];
  for (const el of document.querySelectorAll('a, button, input[type="submit"], .w-nav-button')) {
    if (!visible(el) || inClosedNav(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 44 || r.height < 44) small.push(`${label(el)} ${Math.round(r.width)}x${Math.round(r.height)} "${el.textContent.trim().slice(0, 20)}"`);
  }

  const rect = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left), y: Math.round(r.top + scrollY), w: Math.round(r.width), h: Math.round(r.height) };
  };

  return {
    vw,
    docHeight: document.documentElement.scrollHeight,
    hScroll: document.documentElement.scrollWidth > vw,
    scrollWidth: document.documentElement.scrollWidth,
    offscreen: offscreen.map((o) => `${label(o.el)} [${o.left}..${o.right}]`),
    smallTargets: small,
    header: rect('.w-nav'),
    logo: rect('.w-nav-brand img'),
    heroFirstContent: rect('.w-nav ~ div .w-container, .w-nav ~ section .w-container'),
    form: rect('.w-form'),
    formEl: rect('.w-form form'),
    flyers: [...document.querySelectorAll('.div-block-4')].slice(0, 2).map((el) => {
      const r = el.getBoundingClientRect();
      return `${Math.round(r.width)}x${Math.round(r.height)} ${getComputedStyle(el).backgroundSize}`;
    }),
    menuImages: [...document.querySelectorAll('.menu-image')].slice(0, 1).map((el) => {
      const r = el.getBoundingClientRect();
      return `${Math.round(r.width)}x${Math.round(r.height)} natural ${el.naturalWidth}x${el.naturalHeight}`;
    }),
    minFontPx: Math.min(
      ...[...document.querySelectorAll('p, a, li, label, h1, h2, h3, h4, div')]
        .filter((el) => visible(el) && [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()))
        .map((el) => parseFloat(getComputedStyle(el).fontSize)),
    ),
  };
}

if (SHOTS) await fs.mkdir(OUT, { recursive: true });
const report = [];
for (const r of ROUTES) {
  for (const w of WIDTHS) {
    const ctx = await browser.newContext({ viewport: { width: w, height: w < 768 ? 844 : 1000 }, ignoreHTTPSErrors: true, hasTouch: w < 992, isMobile: w < 768 });
    const tab = await ctx.newPage();
    await tab.route('**/*', route);
    await tab.goto(BASE + r, { waitUntil: 'networkidle' });
    await settle(tab);
    const m = await tab.evaluate(measure);
    if (SHOTS) {
      const slug = r === '/' ? 'index' : r.slice(1);
      await tab.screenshot({ path: path.join(OUT, `${slug}-${w}.png`), fullPage: true });
    }
    report.push({ route: r, width: w, ...m });
    await ctx.close();
  }
}
await browser.close();
console.log(JSON.stringify(report, null, 1));
