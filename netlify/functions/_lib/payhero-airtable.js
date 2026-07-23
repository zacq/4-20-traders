const AIRTABLE_API = 'https://api.airtable.com/v0';
const PAYHERO_STATUS_URL = 'https://backend.payhero.co.ke/api/v2/transaction-status';

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

async function findRecordByReference(externalRef, airtable) {
  const { baseId, tableId, token } = airtable;
  const escaped = escapeFormulaValue(externalRef);

  const byExternal = await airtableFetch(
    `${tableId}?filterByFormula=${encodeURIComponent(`{External Reference} = "${escaped}"`)}&maxRecords=1`,
    { baseId, token }
  );
  if (byExternal.ok && byExternal.body.records && byExternal.body.records.length > 0) {
    return byExternal.body.records[0];
  }

  const byPayment = await airtableFetch(
    `${tableId}?filterByFormula=${encodeURIComponent(`{Payment Reference} = "${escaped}"`)}&maxRecords=1`,
    { baseId, token }
  );
  if (byPayment.ok && byPayment.body.records && byPayment.body.records.length > 0) {
    return byPayment.body.records[0];
  }

  return null;
}

async function verifyTransactionStatus(reference, payheroAuthToken) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(`${PAYHERO_STATUS_URL}?reference=${encodeURIComponent(reference)}`, {
      headers: { Authorization: payheroAuthToken },
      signal: controller.signal
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function applyResolution(record, statusPayload, airtable) {
  const currentStatus = record.fields['Payment Status'];
  if (currentStatus === 'Paid' || currentStatus === 'Failed') {
    return { skipped: true };
  }

  const status = String((statusPayload && statusPayload.status) || '').toUpperCase();
  let fields;
  if (status === 'SUCCESS') {
    fields = {
      'Payment Status': 'Paid',
      Status: 'Paid',
      'Payment Reference': statusPayload.payment_reference || '',
      'Provider Reference': statusPayload.provider_reference || '',
      'Paid At': statusPayload.transaction_date || new Date().toISOString()
    };
  } else if (status === 'FAILED') {
    fields = { 'Payment Status': 'Failed' };
  } else {
    return { skipped: true };
  }

  const { baseId, tableId, token } = airtable;
  const result = await airtableFetch(`${tableId}/${record.id}`, { baseId, token }, {
    method: 'PATCH',
    body: JSON.stringify({ fields, typecast: true })
  });
  return { skipped: false, ok: result.ok };
}

async function markAbandoned(record, airtable) {
  const { baseId, tableId, token } = airtable;
  const result = await airtableFetch(`${tableId}/${record.id}`, { baseId, token }, {
    method: 'PATCH',
    body: JSON.stringify({
      fields: {
        'Payment Status': 'Abandoned',
        Notes: 'Auto-expired: no confirmation within 24h'
      },
      typecast: true
    })
  });
  return { ok: result.ok };
}

module.exports = {
  findRecordByReference,
  verifyTransactionStatus,
  applyResolution,
  markAbandoned
};
