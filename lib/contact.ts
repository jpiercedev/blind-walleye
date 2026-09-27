import 'server-only';

// Field names exactly as published in the Webflow form (wf-form-BRIX---Contact-V10).
export const FIELDS = {
  name: { key: 'BRIX---Contact-Name---V10', max: 256 },
  email: { key: 'BRIX---Contact-Email---V10', max: 256 },
  phone: { key: 'BRIX---Contact-Phone---V10', max: 256 },
  message: { key: 'BRIX---Contact-Message---V10', max: 5000 },
} as const;

export const MAX_BODY_BYTES = 16 * 1024;
const HONEYPOT = 'company_website';
const MIN_ELAPSED_MS = 2500;
const MAX_LINKS = 5;
const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]{2,}$/;

export type Submission = { name: string; email: string; phone: string; message: string; page: string };

export type Validation = { ok: true; submission: Submission } | { ok: false; reason: string; spam?: boolean };

const clean = (v: string | null) => (v ?? '').replace(/\r\n?/g, '\n').trim();

export function validate(form: URLSearchParams): Validation {
  if (clean(form.get(HONEYPOT))) return { ok: false, reason: 'honeypot', spam: true };
  const elapsed = Number(form.get('_elapsed'));
  if (!Number.isFinite(elapsed) || elapsed < MIN_ELAPSED_MS) return { ok: false, reason: 'too fast', spam: true };

  const s: Submission = {
    name: clean(form.get(FIELDS.name.key)),
    email: clean(form.get(FIELDS.email.key)),
    phone: clean(form.get(FIELDS.phone.key)),
    message: clean(form.get(FIELDS.message.key)),
    page: clean(form.get('_page')).slice(0, 200),
  };
  for (const [field, { max }] of Object.entries(FIELDS)) {
    if (s[field as keyof typeof FIELDS].length > max) return { ok: false, reason: `${field} too long` };
  }
  if (/[\r\n]/.test(s.name + s.email + s.phone)) return { ok: false, reason: 'line breaks in single-line field' };
  if (!EMAIL_RE.test(s.email)) return { ok: false, reason: 'invalid email' };
  if (!s.message) return { ok: false, reason: 'missing message' };
  if ((s.message.match(/https?:\/\/|www\./gi) ?? []).length > MAX_LINKS) {
    return { ok: false, reason: 'too many links', spam: true };
  }
  return { ok: true, submission: s };
}

export function escapeHtml(v: string) {
  return v.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export function buildEmail(s: Submission) {
  const rows: [string, string][] = [
    ['Name', s.name || '(not provided)'],
    ['Email', s.email],
    ['Phone', s.phone || '(not provided)'],
  ];
  const subject = `Website contact: ${s.name || s.email}`.slice(0, 200);
  const text = [
    'New contact form submission from theblindwalleye.com',
    '',
    ...rows.map(([k, v]) => `${k}: ${v}`),
    '',
    'Message:',
    s.message,
    '',
    s.page ? `Page: ${s.page}` : '',
  ].join('\n').trim();
  const html = `<!doctype html><html><body style="font-family:Arial,sans-serif;font-size:14px;color:#111">
<p>New contact form submission from theblindwalleye.com</p>
<table cellpadding="4" style="border-collapse:collapse">${rows
    .map(([k, v]) => `<tr><td><strong>${k}</strong></td><td>${escapeHtml(v)}</td></tr>`)
    .join('')}</table>
<p><strong>Message</strong></p>
<p style="white-space:pre-wrap">${escapeHtml(s.message)}</p>
${s.page ? `<p style="color:#666">Page: ${escapeHtml(s.page)}</p>` : ''}
</body></html>`;
  return { subject, text, html };
}

export type MailConfig = { apiKey: string; from: string; to: string[] };

export function mailConfig(env: NodeJS.ProcessEnv = process.env): MailConfig | null {
  const apiKey = env.RESEND_API_KEY?.trim();
  const from = env.CONTACT_FROM_EMAIL?.trim();
  const to = (env.CONTACT_TO_EMAIL ?? '').split(',').map((v) => v.trim()).filter(Boolean);
  if (!apiKey || !from || !to.length) return null;
  return { apiKey, from, to };
}

/** Sends through Resend. Resolves true only when Resend accepted the message (2xx with an id). */
export async function sendWithResend(config: MailConfig, s: Submission): Promise<boolean> {
  const { subject, text, html } = buildEmail(s);
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: config.from, to: config.to, reply_to: s.email, subject, text, html }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    console.error('contact: Resend rejected message', res.status, (await res.text()).slice(0, 500));
    return false;
  }
  const body = (await res.json().catch(() => null)) as { id?: string } | null;
  return Boolean(body?.id);
}

// Best-effort per-instance limiter; serverless instances don't share it, so it only blunts bursts.
const hits = new Map<string, number[]>();
export function rateLimited(ip: string, limit = 5, windowMs = 10 * 60_000, now = Date.now()) {
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < windowMs);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) hits.clear();
  return recent.length > limit;
}
