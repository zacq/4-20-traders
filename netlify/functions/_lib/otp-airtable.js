const crypto = require('crypto');

const AIRTABLE_API = 'https://api.airtable.com/v0';
const MAX_ATTEMPTS = 5;
const RESEND_COOLDOWN_SECONDS = 45;
const OTP_TTL_SECONDS = 10 * 60;

function escapeFormulaValue(value) {
  return String(value).replace(/"/g, '\\"');
}

async function airtableFetch(path, { baseId, token }, init = {}) {
  const res = await fetch(`${AIRTABLE_API}/${baseId}/${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init.headers || {})
    }
  });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body };
}

async function findUserByEmail(email, airtable) {
  const { baseId, tableId, token } = airtable;
  const escaped = escapeFormulaValue(email);
  const result = await airtableFetch(
    `${tableId}?filterByFormula=${encodeURIComponent(`{Email} = "${escaped}"`)}&maxRecords=1`,
    { baseId, token }
  );
  if (result.ok && result.body.records && result.body.records.length > 0) {
    return result.body.records[0];
  }
  return null;
}

function generateCode() {
  return String(crypto.randomInt(100000, 1000000));
}

function hashCode(code, pepper) {
  return crypto.createHash('sha256').update(`${code}${pepper}`).digest('hex');
}

async function upsertOtp(record, { name, email, codeHash, expiryIso, nowIso }, airtable) {
  const { baseId, tableId, token } = airtable;
  const fields = {
    Email: email,
    'OTP Code': codeHash,
    'OTP Expiry': expiryIso,
    'OTP Attempts': 0,
    'Last OTP Sent At': nowIso
  };
  if (name) fields.Name = name;

  if (record) {
    return airtableFetch(`${tableId}/${record.id}`, { baseId, token }, {
      method: 'PATCH',
      body: JSON.stringify({ fields, typecast: true })
    });
  }

  fields.Name = name || 'Member';
  fields['Created At'] = nowIso;
  fields.Verified = false;
  return airtableFetch(tableId, { baseId, token }, {
    method: 'POST',
    body: JSON.stringify({ records: [{ fields }], typecast: true })
  });
}

async function incrementAttempts(record, airtable) {
  const { baseId, tableId, token } = airtable;
  const attempts = (record.fields['OTP Attempts'] || 0) + 1;
  return airtableFetch(`${tableId}/${record.id}`, { baseId, token }, {
    method: 'PATCH',
    body: JSON.stringify({ fields: { 'OTP Attempts': attempts }, typecast: true })
  });
}

async function markVerified(record, airtable) {
  const { baseId, tableId, token } = airtable;
  const nowIso = new Date().toISOString();
  return airtableFetch(`${tableId}/${record.id}`, { baseId, token }, {
    method: 'PATCH',
    body: JSON.stringify({
      fields: {
        'OTP Code': '',
        'OTP Expiry': null,
        'OTP Attempts': 0,
        Verified: true,
        'Last Login At': nowIso
      },
      typecast: true
    })
  });
}

module.exports = {
  MAX_ATTEMPTS,
  RESEND_COOLDOWN_SECONDS,
  OTP_TTL_SECONDS,
  findUserByEmail,
  generateCode,
  hashCode,
  upsertOtp,
  incrementAttempts,
  markVerified
};
