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

  const { name, phone, tier, price } = data;
  if (!name || !phone || !tier || !price) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing required fields' }) };
  }

  const { PAYHERO_BASIC_AUTH_TOKEN, PAYHERO_CHANNEL_ID } = process.env;
  if (!PAYHERO_BASIC_AUTH_TOKEN || !PAYHERO_CHANNEL_ID) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Server not configured' }) };
  }

  // Normalize to 2547XXXXXXXX / 2541XXXXXXXX
  let phoneNumber = String(phone).replace(/\s+/g, '').replace(/^\+/, '');
  if (phoneNumber.startsWith('0')) phoneNumber = '254' + phoneNumber.slice(1);
  else if (/^[71]/.test(phoneNumber)) phoneNumber = '254' + phoneNumber;
  if (!/^254[71]\d{8}$/.test(phoneNumber)) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid M-Pesa phone number' }) };
  }

  const externalReference = `PIPN-${Date.now()}`;

  try {
    const res = await fetch('https://backend.payhero.co.ke/api/v2/payments', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: PAYHERO_BASIC_AUTH_TOKEN
      },
      body: JSON.stringify({
        amount: Number(price),
        phone_number: phoneNumber,
        channel_id: Number(PAYHERO_CHANNEL_ID),
        provider: 'm-pesa',
        network_code: '63902',
        customer_name: name,
        external_reference: externalReference
      })
    });

    const body = await res.json();
    if (!res.ok) {
      return { statusCode: res.status, body: JSON.stringify({ error: body.message || body.error || 'PayHero error' }) };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true, reference: body.reference, externalReference })
    };
  } catch (err) {
    return { statusCode: 502, body: JSON.stringify({ error: 'Failed to reach PayHero' }) };
  }
};
