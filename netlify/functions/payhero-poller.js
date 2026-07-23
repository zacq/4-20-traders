const { verifyTransactionStatus, applyResolution, markAbandoned } = require('./_lib/payhero-airtable');

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function listRecords(formula, maxRecords, airtable) {
  const url = `https://api.airtable.com/v0/${airtable.baseId}/${airtable.tableId}` +
    `?filterByFormula=${encodeURIComponent(formula)}&maxRecords=${maxRecords}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${airtable.token}` } });
  if (!res.ok) return [];
  const body = await res.json().catch(() => ({}));
  return body.records || [];
}

exports.handler = async () => {
  const { AIRTABLE_TOKEN, AIRTABLE_BASE_ID, AIRTABLE_TABLE_ID, PAYHERO_BASIC_AUTH_TOKEN } = process.env;
  const airtable = { baseId: AIRTABLE_BASE_ID, tableId: AIRTABLE_TABLE_ID, token: AIRTABLE_TOKEN };

  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  let checked = 0;
  let updated = 0;
  let abandoned = 0;

  const pending = await listRecords(
    `AND({Payment Status} = "Pending", IS_AFTER(CREATED_TIME(), DATETIME_PARSE("${cutoff}")))`,
    20,
    airtable
  );

  for (const batch of chunk(pending, 5)) {
    const results = await Promise.allSettled(batch.map(async (record) => {
      const reference = record.fields['External Reference'];
      if (!reference) return;
      checked += 1;
      const statusPayload = await verifyTransactionStatus(reference, PAYHERO_BASIC_AUTH_TOKEN);
      if (!statusPayload) return;
      const result = await applyResolution(record, statusPayload, airtable);
      if (result && !result.skipped && result.ok) updated += 1;
    }));
    results.forEach((r) => {
      if (r.status === 'rejected') console.log('payhero-poller: record check failed', r.reason);
    });
  }

  const expired = await listRecords(
    `AND({Payment Status} = "Pending", IS_BEFORE(CREATED_TIME(), DATETIME_PARSE("${cutoff}")))`,
    20,
    airtable
  );

  for (const batch of chunk(expired, 5)) {
    const results = await Promise.allSettled(batch.map(async (record) => {
      const result = await markAbandoned(record, airtable);
      if (result && result.ok) abandoned += 1;
    }));
    results.forEach((r) => {
      if (r.status === 'rejected') console.log('payhero-poller: abandon failed', r.reason);
    });
  }

  return { statusCode: 200, body: JSON.stringify({ checked, updated, abandoned }) };
};
