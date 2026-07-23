const { findRecordByReference, verifyTransactionStatus, applyResolution } = require('./_lib/payhero-airtable');

exports.handler = async (event) => {
  if (event.httpMethod === 'GET') {
    return { statusCode: 200, body: 'ok' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const { AIRTABLE_TOKEN, AIRTABLE_BASE_ID, AIRTABLE_TABLE_ID, PAYHERO_BASIC_AUTH_TOKEN, PAYHERO_WEBHOOK_SECRET } = process.env;

  try {
    const rawBody = event.isBase64Encoded
      ? Buffer.from(event.body || '', 'base64').toString('utf8')
      : (event.body || '');

    console.log('payhero-webhook headers:', JSON.stringify(event.headers));
    console.log('payhero-webhook raw body:', rawBody);

    if (PAYHERO_WEBHOOK_SECRET) {
      const token = event.queryStringParameters && event.queryStringParameters.token;
      if (token !== PAYHERO_WEBHOOK_SECRET) {
        console.log('payhero-webhook: token mismatch (logged only, not rejected)');
      }
    }

    let body;
    try {
      body = JSON.parse(rawBody || '{}');
    } catch (e) {
      console.log('payhero-webhook: body is not JSON, ignoring');
      return { statusCode: 200, body: 'ok' };
    }

    const reference = body.external_reference || body.reference
      || (body.data && (body.data.external_reference || body.data.reference));

    if (!reference) {
      console.log('payhero-webhook: no reference found in payload', JSON.stringify(body));
      return { statusCode: 200, body: 'ok' };
    }

    const airtable = { baseId: AIRTABLE_BASE_ID, tableId: AIRTABLE_TABLE_ID, token: AIRTABLE_TOKEN };
    const record = await findRecordByReference(reference, airtable);
    if (!record) {
      console.log('payhero-webhook: no matching Airtable record for reference', reference);
      return { statusCode: 200, body: 'ok' };
    }

    const statusPayload = await verifyTransactionStatus(reference, PAYHERO_BASIC_AUTH_TOKEN);
    if (statusPayload) {
      await applyResolution(record, statusPayload, airtable);
    }

    return { statusCode: 200, body: 'ok' };
  } catch (err) {
    console.log('payhero-webhook error:', err && err.message);
    return { statusCode: 200, body: 'ok' };
  }
};
