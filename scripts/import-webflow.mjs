#!/usr/bin/env node
// Converts the raw capture in ./source into the data the Next.js app renders.
//
//   node scripts/import-webflow.mjs
//
// - Copies mirrored assets into public/wf/<host>/<path>, rewriting url() references inside CSS.
// - Writes content/site.json (shared <html>/<head> data) and content/pages/<slug>.json (per-page head + body).
// Markup is kept byte-for-byte apart from asset URLs being pointed at the local copies.

import fs from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'node-html-parser';

const SRC = path.resolve('source');
const PUBLIC_DIR = path.resolve('public');
const CONTENT = path.resolve('content');
const manifest = JSON.parse(await fs.readFile(path.join(SRC, 'manifest.json'), 'utf8'));
const ORIGIN = manifest.origin;

// assets/<host>/<path> -> wf/<host>/<path>. Query-suffixed captures ("x.js__<q>") keep their extension last
// so they are served with the right MIME type.
const publicFile = (file) =>
  path.join('wf', file.replace(/^assets[\\/]/, '').replace(/^(.*?)(\.[A-Za-z0-9]+)__([\w-]+)$/, '$1__$3$2'));

// Original absolute URL -> local public URL path.
const urlMap = new Map();
for (const [url, info] of Object.entries(manifest.assets)) {
  if (info) urlMap.set(url, '/' + publicFile(info.file).split(path.sep).map(encodeURIComponent).join('/'));
}

function localize(raw, base) {
  if (!raw || /^(data:|#|mailto:|tel:|javascript:)/.test(raw)) return raw;
  let abs;
  try {
    abs = new URL(raw.replace(/&amp;/g, '&'), base);
  } catch {
    return raw;
  }
  const hit = urlMap.get(abs.href);
  if (hit) return hit;
  // First-party page links become root-relative so they stay on the new host.
  if (abs.origin === ORIGIN) return abs.pathname + abs.search + abs.hash;
  return raw;
}

const localizeSrcset = (v, base) =>
  v
    .split(',')
    .map((part) => {
      const [src, ...rest] = part.trim().split(/\s+/);
      return [localize(src, base), ...rest].join(' ');
    })
    .join(', ');

const CSS_URL = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)'"]+))\s*\)/g;
const localizeCss = (css, base) =>
  css.replace(CSS_URL, (m, dq, sq, bare) => {
    const q = dq != null ? '"' : sq != null ? "'" : '';
    return `url(${q}${localize((dq ?? sq ?? bare).trim(), base)}${q})`;
  });

function localizeTree(root, base) {
  // Only touch attributes whose value changes so untouched markup serializes exactly as captured.
  const set = (el, name, next) => {
    if (next !== el.getAttribute(name)) el.setAttribute(name, next);
  };
  for (const el of root.querySelectorAll('*')) {
    for (const name of ['src', 'href', 'poster', 'data-src', 'data-poster-url', 'data-animation-url']) {
      const v = el.getAttribute(name);
      if (v != null) set(el, name, localize(v, base));
    }
    const srcset = el.getAttribute('srcset');
    if (srcset) set(el, 'srcset', localizeSrcset(srcset, base));
    const videos = el.getAttribute('data-video-urls');
    if (videos) set(el, 'data-video-urls', videos.split(',').map((v) => localize(v.trim(), base)).join(','));
    const style = el.getAttribute('style');
    if (style && style.includes('url(')) set(el, 'style', localizeCss(style, base));
    if (el.tagName === 'STYLE') el.set_content(localizeCss(el.textContent, base));
  }
}

const attrsOf = (el) => (el ? { ...el.attributes } : {});

function readHead(head, base) {
  const out = { title: '', metas: [], links: [], styles: [], scripts: [] };
  for (const el of head.childNodes) {
    if (el.nodeType !== 1) continue;
    const tag = el.tagName.toLowerCase();
    if (tag === 'title') out.title = el.textContent;
    else if (tag === 'meta') {
      if (el.getAttribute('charset')) continue;
      const a = attrsOf(el);
      if (a.content && /image|url/i.test(a.property ?? a.name ?? '')) a.content = absoluteForMeta(a.content, base);
      out.metas.push(a);
    } else if (tag === 'link') {
      const a = attrsOf(el);
      // Every file from the Webflow CDN is now served locally, so its preconnect hint is dead weight.
      if (a.rel === 'preconnect' && /website-files\.com/.test(a.href ?? '')) continue;
      if (a.href) a.href = localize(a.href, base);
      out.links.push(a);
    } else if (tag === 'style') out.styles.push({ attrs: attrsOf(el), css: localizeCss(el.textContent, base) });
    else if (tag === 'script') out.scripts.push(scriptOf(el, base));
  }
  return out;
}

// og:image and friends must stay absolute; point them at the new host via a placeholder resolved at render time.
function absoluteForMeta(value, base) {
  const local = localize(value, base);
  return local.startsWith('/') ? '{{SITE_URL}}' + local : local;
}

function scriptOf(el, base) {
  const a = attrsOf(el);
  if (a.src) a.src = localize(a.src, base);
  return { attrs: a, code: a.src ? '' : el.textContent };
}

async function copyAssets() {
  await fs.rm(path.join(PUBLIC_DIR, 'wf'), { recursive: true, force: true });
  for (const [url, info] of Object.entries(manifest.assets)) {
    if (!info) continue;
    const from = path.join(SRC, info.file);
    const to = path.join(PUBLIC_DIR, publicFile(info.file));
    await fs.mkdir(path.dirname(to), { recursive: true });
    if (/css/.test(info.type ?? '') || info.file.endsWith('.css')) {
      await fs.writeFile(to, localizeCss(await fs.readFile(from, 'utf8'), url));
    } else {
      await fs.copyFile(from, to);
    }
  }
  const rootDir = path.join(SRC, 'root');
  for (const f of await fs.readdir(rootDir).catch(() => [])) {
    await fs.copyFile(path.join(rootDir, f), path.join(PUBLIC_DIR, f));
  }
}

async function importPages() {
  await fs.rm(path.join(CONTENT, 'pages'), { recursive: true, force: true });
  await fs.mkdir(path.join(CONTENT, 'pages'), { recursive: true });
  const pages = [];
  for (const p of manifest.pages) {
    if (!p.slug) continue;
    if (p.slug !== '__404' && p.status !== 200) continue;
    const html = await fs.readFile(path.join(SRC, 'pages', p.slug + '.html'), 'utf8');
    const base = p.finalUrl || ORIGIN + p.route;
    const root = parse(html, { comment: true, blockTextElements: { script: true, noscript: true, style: true, pre: true } });
    localizeTree(root, base);
    const htmlEl = root.querySelector('html');
    const head = readHead(root.querySelector('head'), base);
    const body = root.querySelector('body');

    // Split trailing body scripts (jQuery, webflow.js, custom code) from content so they can be emitted in order.
    const bodyScripts = [];
    const nodes = [...body.childNodes];
    while (nodes.length) {
      const last = nodes[nodes.length - 1];
      if (last.nodeType === 3 && !last.text.trim()) nodes.pop();
      else if (last.nodeType === 1 && last.tagName === 'SCRIPT') bodyScripts.unshift(scriptOf(nodes.pop(), base));
      else break;
    }
    const bodyHtml = nodes.map((n) => n.toString()).join('');

    const page = {
      route: p.route,
      slug: p.slug,
      htmlAttrs: attrsOf(htmlEl),
      head,
      bodyAttrs: attrsOf(body),
      bodyHtml,
      bodyScripts,
    };
    await fs.writeFile(path.join(CONTENT, 'pages', p.slug + '.json'), JSON.stringify(page, null, 2));
    pages.push(page);
  }

  // Shared data: <html> site attrs and head resources that are identical everywhere.
  const real = pages.filter((p) => p.slug !== '__404');
  const same = (f) => real.every((p) => JSON.stringify(f(p)) === JSON.stringify(f(real[0])));
  const site = {
    origin: ORIGIN,
    lang: real[0].htmlAttrs.lang ?? 'en',
    wfSite: real[0].htmlAttrs['data-wf-site'] ?? null,
    routes: real.map((p) => p.route),
    sharedHead: same((p) => [p.head.links.filter((l) => l.rel === 'stylesheet'), p.head.scripts]),
  };
  if (!site.sharedHead) console.warn('warning: head resources differ between pages; they are rendered per page');
  await fs.writeFile(path.join(CONTENT, 'site.json'), JSON.stringify(site, null, 2));
  console.log(`imported ${pages.length} pages (${site.routes.join(', ')}), ${urlMap.size} assets`);
}

await copyAssets();
await importPages();
