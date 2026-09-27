# The Blind Walleye — Next.js

A 1:1 copy of the published Webflow site at https://www.theblindwalleye.com, statically rendered in Next.js,
plus a `/api/contact` route that replaces Webflow's native form handling.

## How it works

- `source/`: raw capture of the live site (HTML, every first-party asset, `manifest.json`, live screenshots).
  Made by `node scripts/capture-source.mjs https://www.theblindwalleye.com --no-screenshots` (GET requests only).
- `node scripts/import-webflow.mjs` turns `source/` into `content/pages/*.json` and `public/wf/**`. The markup is
  kept exactly as captured, with asset URLs pointed at local copies. Its output is committed, so builds don't
  need the capture step.
- `app/[[...slug]]/page.tsx` prerenders `/`, `/menu` and `/events`. `app/not-found.tsx` renders the captured
  Webflow 404 page. The original jQuery and webflow.js bundles run unchanged, so the navbar, interactions and
  animations behave as they do on Webflow.
- `public/contact-form.js` intercepts the Webflow contact form and posts to `/api/contact`. It reproduces the
  Webflow UI: the "Please wait..." button state, then the success or failure message. Success is shown only when
  Resend accepts the email.
- `node scripts/compare-visual.mjs [http://localhost:3000]` screenshots the captured source and the replica at
  1440, 991 and 390px wide and pixel-diffs them into `compare/`.

## Contact form configuration (server-only environment variables)

| Variable | Value |
| --- | --- |
| `RESEND_API_KEY` | Resend API key for the verified `theblindwalleye.com` domain |
| `CONTACT_FROM_EMAIL` | `The Blind Walleye <website@theblindwalleye.com>` |
| `CONTACT_TO_EMAIL` | Recipient address(es), comma-separated. The Webflow form currently delivers to `theblindwalleye.webhost@gmail.com`. |
| `NEXT_PUBLIC_SITE_URL` | Optional. Absolute base for og:image URLs. Defaults to `https://www.theblindwalleye.com`. |

If any of the first three is missing, the route returns 503 and visitors see the form's existing error message.
Nothing is ever reported as sent unless Resend accepted it.

Notification: a plain internal email containing name, email, phone and message (all values HTML-escaped, with a
plain-text alternative), with reply-to set to the visitor's email.

Server checks:
- same-origin `Origin` header;
- urlencoded body of at most 16 KB;
- valid email and a non-empty message;
- field lengths within the form's `maxlength` values;
- an off-screen honeypot field and a minimum time since the page loaded;
- at most 5 links in the message;
- best-effort rate limit of 5 submissions per IP per 10 minutes.

## Scripts

`npm run build`, `npm run typecheck`, `npm run import`, `npm run capture`, `npm run compare`.
