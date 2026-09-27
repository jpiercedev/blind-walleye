import { MAX_BODY_BYTES, mailConfig, rateLimited, sendWithResend, validate } from '@/lib/contact';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const json = (status: number, body: { ok: boolean; error?: string }) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

async function readLimited(req: Request): Promise<string | null> {
  if (!req.body) return '';
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export async function POST(req: Request) {
  const origin = req.headers.get('origin');
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  if (!origin || !host || new URL(origin).host !== host) return json(403, { ok: false, error: 'forbidden' });

  if (!(req.headers.get('content-type') ?? '').startsWith('application/x-www-form-urlencoded')) {
    return json(415, { ok: false, error: 'unsupported content type' });
  }
  if (Number(req.headers.get('content-length') ?? 0) > MAX_BODY_BYTES) return json(413, { ok: false, error: 'too large' });

  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown';
  if (rateLimited(ip)) return json(429, { ok: false, error: 'too many requests' });

  const raw = await readLimited(req);
  if (raw === null) return json(413, { ok: false, error: 'too large' });

  const result = validate(new URLSearchParams(raw));
  if (!result.ok) {
    if (result.spam) console.warn('contact: rejected as spam:', result.reason);
    return json(400, { ok: false, error: 'invalid submission' });
  }

  const config = mailConfig();
  if (!config) {
    console.error('contact: RESEND_API_KEY, CONTACT_FROM_EMAIL and CONTACT_TO_EMAIL must all be set');
    return json(503, { ok: false, error: 'contact form not configured' });
  }

  try {
    const sent = await sendWithResend(config, result.submission);
    return sent ? json(200, { ok: true }) : json(502, { ok: false, error: 'delivery failed' });
  } catch (err) {
    console.error('contact: Resend request failed', err);
    return json(502, { ok: false, error: 'delivery failed' });
  }
}
