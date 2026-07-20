exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const reference = event.queryStringParameters && event.queryStringParameters.reference;
  if (!reference) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing reference' }) };
  }

  const { PAYHERO_BASIC_AUTH_TOKEN } = process.env;
  if (!PAYHERO_BASIC_AUTH_TOKEN) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Server not configured' }) };
  }

  try {
    const res = await fetch(
      `https://backend.payhero.co.ke/api/v2/transaction-status?reference=${encodeURIComponent(reference)}`,
      { headers: { Authorization: PAYHERO_BASIC_AUTH_TOKEN } }
    );
    const body = await res.json();
    return { statusCode: res.status, body: JSON.stringify(body) };
  } catch (err) {
    return { statusCode: 502, body: JSON.stringify({ error: 'Failed to reach PayHero' }) };
  }
};
