import { SITE_URL, metaValue, type Script, type WebflowPage } from '@/lib/webflow';

type Attrs = Record<string, string>;

// HTML attribute names -> React prop names for the tags emitted here.
const PROP_NAMES: Record<string, string> = {
  class: 'className',
  crossorigin: 'crossOrigin',
  referrerpolicy: 'referrerPolicy',
  hreflang: 'hrefLang',
  nomodule: 'noModule',
  charset: 'charSet',
};

function props(attrs: Attrs) {
  const out: Record<string, string | boolean> = {};
  for (const [k, v] of Object.entries(attrs)) {
    const name = PROP_NAMES[k] ?? k;
    out[name] = (k === 'async' || k === 'defer' || k === 'nomodule') ? true : v;
  }
  return out;
}

function ScriptTag({ script }: { script: Script }) {
  if (script.attrs.src) return <script {...props(script.attrs)} />;
  return <script {...props(script.attrs)} dangerouslySetInnerHTML={{ __html: script.code }} />;
}

/**
 * Renders a captured Webflow page. Everything from the original <head> except <title>, charset and viewport
 * (emitted by Next with identical values) is output here; React hoists <meta>/<link> into <head>. Head scripts
 * run before any body content is parsed, exactly as in the original document, then the body markup, then the
 * original trailing scripts (jQuery + webflow.js) and the contact form handler.
 */
export function WebflowDocument({ page }: { page: WebflowPage }) {
  // <html>/<body> attributes differ per page (data-wf-page drives webflow.js interactions), so they are applied
  // before any content is parsed.
  const setup = `(function(d){var h=d.documentElement,b=d.body,a=${JSON.stringify(
    Object.fromEntries(Object.entries(page.htmlAttrs).filter(([k]) => k !== 'class')),
  )},c=${JSON.stringify(page.bodyAttrs)};for(var k in a)h.setAttribute(k,a[k]);for(var j in c)b.setAttribute(j,c[j]);})(document);`;

  return (
    <>
      {page.head.metas
        .filter((m) => m.name !== 'viewport')
        .map((m, i) => (
          <meta key={`m${i}`} {...props({ ...m, content: metaValue(m.content)?.replace(/^\//, `${SITE_URL}/`) ?? '' })} />
        ))}
      {page.head.links.map((l, i) =>
        l.rel === 'stylesheet' ? (
          <link key={`l${i}`} {...props(l)} precedence="webflow" />
        ) : (
          <link key={`l${i}`} {...props(l)} />
        ),
      )}
      {page.head.styles.map((s, i) => (
        <style key={`s${i}`} {...props(s.attrs)} dangerouslySetInnerHTML={{ __html: s.css }} />
      ))}
      <script dangerouslySetInnerHTML={{ __html: setup }} />
      {page.head.scripts.map((s, i) => (
        <ScriptTag key={`h${i}`} script={s} />
      ))}
      <div style={{ display: 'contents' }} dangerouslySetInnerHTML={{ __html: page.bodyHtml }} />
      {page.bodyScripts.map((s, i) => (
        <ScriptTag key={`b${i}`} script={s} />
      ))}
      {page.bodyHtml.includes('w-form') && <script src="/contact-form.js" />}
    </>
  );
}
