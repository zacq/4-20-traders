// Sends a 6-digit one-time login code to the given email via Resend, and
// upserts a hashed copy (never plaintext) into the Pip Nation Users Airtable
// table. Same flow is used for both first-time signup and every later login.
const {
  findUserByEmail,
  generateCode,
  hashCode,
  upsertOtp,
  RESEND_COOLDOWN_SECONDS,
  OTP_TTL_SECONDS
} = require('./_lib/otp-airtable');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function otpEmailHtml(code, name) {
  const greeting = name ? `Hi ${escapeHtml(name)},` : 'Hi there,';
  return `
  <div style="background:#0E0B16;padding:40px 20px;font-family:Helvetica,Arial,sans-serif;">
    <div style="max-width:420px;margin:0 auto;background:#1F1A33;border:1px solid rgba(167,153,214,.2);border-radius:16px;padding:32px;">
      <p style="color:#F2EFFA;font-size:16px;margin:0 0 12px;">${greeting}</p>
      <p style="color:#B9B0D6;font-size:14px;margin:0 0 24px;">Here's your Pip Nation login code:</p>
      <div style="font-family:'IBM Plex Mono',monospace;font-size:36px;font-weight:600;letter-spacing:.14em;color:#F5A524;text-align:center;padding:16px;background:rgba(245,165,36,.08);border-radius:10px;margin-bottom:24px;">${code}</div>
      <p style="color:#7E75A0;font-size:13px;margin:0;">This code expires in 10 minutes. If you didn't request this, you can safely ignore this email.</p>
      <p style="color:#7E75A0;font-size:12px;margin:24px 0 0;">Pip Nation · four20traders.com</p>
    </div>
  </div>`;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  let data;
  try {
    data = JSON.parse(event.body || '{}');
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const name = (data.name || '').trim().slice(0, 80);
  const email = (data.email || '').trim().toLowerCase();
  if (!email || !EMAIL_RE.test(email)) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Please enter a valid email address' }) };
  }

  const { AIRTABLE_TOKEN, AIRTABLE_BASE_ID, AIRTABLE_USERS_TABLE_ID, RESEND_API_KEY, RESEND_FROM_EMAIL, SESSION_SECRET } = process.env;
  if (!AIRTABLE_TOKEN || !AIRTABLE_BASE_ID || !AIRTABLE_USERS_TABLE_ID || !RESEND_API_KEY || !RESEND_FROM_EMAIL || !SESSION_SECRET) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Server not configured' }) };
  }

  const airtable = { baseId: AIRTABLE_BASE_ID, tableId: AIRTABLE_USERS_TABLE_ID, token: AIRTABLE_TOKEN };

  let record;
  try {
    record = await findUserByEmail(email, airtable);
  } catch (err) {
    return { statusCode: 502, body: JSON.stringify({ error: 'Failed to reach Airtable' }) };
  }

  if (record && record.fields['Last OTP Sent At']) {
    const lastSent = new Date(record.fields['Last OTP Sent At']).getTime();
    const secondsSince = (Date.now() - lastSent) / 1000;
    if (secondsSince < RESEND_COOLDOWN_SECONDS) {
      return { statusCode: 429, body: JSON.stringify({ error: 'Please wait before requesting another code.' }) };
    }
  }

  const code = generateCode();
  const codeHash = hashCode(code, SESSION_SECRET);
  const nowIso = new Date().toISOString();
  const expiryIso = new Date(Date.now() + OTP_TTL_SECONDS * 1000).toISOString();

  try {
    const upsertResult = await upsertOtp(record, { name, email, codeHash, expiryIso, nowIso }, airtable);
    if (!upsertResult.ok) {
      return { statusCode: upsertResult.status, body: JSON.stringify({ error: 'Failed to save verification code' }) };
    }
  } catch (err) {
    return { statusCode: 502, body: JSON.stringify({ error: 'Failed to reach Airtable' }) };
  }

  try {
    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: RESEND_FROM_EMAIL,
        to: [email],
        subject: `${code} is your Pip Nation login code`,
        html: otpEmailHtml(code, name)
      })
    });
    if (!emailRes.ok) {
      return { statusCode: 502, body: JSON.stringify({ error: 'Failed to send code' }) };
    }
  } catch (err) {
    return { statusCode: 502, body: JSON.stringify({ error: 'Failed to send code' }) };
  }

  return { statusCode: 200, body: JSON.stringify({ ok: true }) };
};
