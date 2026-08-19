const crypto = require('crypto');
const { findUserByEmail, hashCode, incrementAttempts, markVerified, MAX_ATTEMPTS } = require('./_lib/otp-airtable');
const { signSession, serializeCookie } = require('./_lib/session');

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

  const email = (data.email || '').trim().toLowerCase();
  const code = (data.code || '').trim();
  if (!email || !code) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid code' }) };
  }

  const { AIRTABLE_TOKEN, AIRTABLE_BASE_ID, AIRTABLE_USERS_TABLE_ID, SESSION_SECRET } = process.env;
  if (!AIRTABLE_TOKEN || !AIRTABLE_BASE_ID || !AIRTABLE_USERS_TABLE_ID || !SESSION_SECRET) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Server not configured' }) };
  }

  const airtable = { baseId: AIRTABLE_BASE_ID, tableId: AIRTABLE_USERS_TABLE_ID, token: AIRTABLE_TOKEN };

  let record;
  try {
    record = await findUserByEmail(email, airtable);
  } catch (err) {
    return { statusCode: 502, body: JSON.stringify({ error: 'Failed to reach Airtable' }) };
  }
  if (!record) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid code' }) };
  }

  const attempts = record.fields['OTP Attempts'] || 0;
  if (attempts >= MAX_ATTEMPTS) {
    return { statusCode: 429, body: JSON.stringify({ error: 'Too many attempts. Request a new code.' }) };
  }

  const expiry = record.fields['OTP Expiry'] ? new Date(record.fields['OTP Expiry']).getTime() : 0;
  if (!expiry || Date.now() > expiry) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Code expired. Request a new one.' }) };
  }

  const submittedHash = hashCode(code, SESSION_SECRET);
  const storedHash = record.fields['OTP Code'] || '';
  const submittedBuf = Buffer.from(submittedHash);
  const storedBuf = Buffer.from(storedHash);
  const matches = submittedBuf.length === storedBuf.length && crypto.timingSafeEqual(submittedBuf, storedBuf);

  if (!matches) {
    try {
      await incrementAttempts(record, airtable);
    } catch (err) {
      // best-effort; still report invalid code below
    }
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid code' }) };
  }

  try {
    await markVerified(record, airtable);
  } catch (err) {
    return { statusCode: 502, body: JSON.stringify({ error: 'Failed to reach Airtable' }) };
  }

  const name = record.fields.Name || 'Member';
  const token = signSession({ email, name }, SESSION_SECRET);

  return {
    statusCode: 200,
    headers: { 'Set-Cookie': serializeCookie(token) },
    body: JSON.stringify({ ok: true, name, email })
  };
};
