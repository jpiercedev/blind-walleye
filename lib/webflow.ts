import fs from 'node:fs';
import path from 'node:path';
import 'server-only';

type Attrs = Record<string, string>;

export type Script = { attrs: Attrs; code: string };

export type WebflowPage = {
  route: string;
  slug: string;
  htmlAttrs: Attrs;
  head: {
    title: string;
    metas: Attrs[];
    links: Attrs[];
    styles: { attrs: Attrs; css: string }[];
    scripts: Script[];
  };
  bodyAttrs: Attrs;
  bodyHtml: string;
  bodyScripts: Script[];
};

export type Site = { origin: string; lang: string; wfSite: string | null; routes: string[] };

const CONTENT = path.join(process.cwd(), 'content');

export const site: Site = JSON.parse(fs.readFileSync(path.join(CONTENT, 'site.json'), 'utf8'));

export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? site.origin;

export function slugForRoute(route: string) {
  return route === '/' ? 'index' : route.replace(/^\/+|\/+$/g, '').replace(/\//g, '__');
}

export function loadPage(slug: string): WebflowPage | null {
  const file = path.join(CONTENT, 'pages', `${slug}.json`);
  if (!/^[\w-]+$/.test(slug) || !fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** Meta values that pointed at mirrored assets carry a placeholder so they resolve against metadataBase. */
export function metaValue(v: string | undefined) {
  return v?.replace('{{SITE_URL}}', '');
}
