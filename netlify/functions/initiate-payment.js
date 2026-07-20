// Records the signup as "Pending" in Airtable immediately, before the
// customer completes payment in PayHero's embedded checkout (see the
// PayHero.pay() call in index.html). This guarantees a record exists even
// if the browser tab closes mid-payment. n8n workflows reconcile Pending
// records to Paid/Failed via PayHero's callback + a polling backstop.
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

  const { name, email, phone, tier, price } = data;
  if (!name || !email || !phone || !tier || !price) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing required fields' }) };
  }

  const { AIRTABLE_TOKEN, AIRTABLE_BASE_ID, AIRTABLE_TABLE_ID } = process.env;
  if (!AIRTABLE_TOKEN || !AIRTABLE_BASE_ID || !AIRTABLE_TABLE_ID) {
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
    const res = await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_TABLE_ID}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${AIRTABLE_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        records: [{
          fields: {
            Name: name,
            Email: email,
            Phone: phone,
            Tier: tier,
            'Price (KES)': Number(price),
            Status: 'New',
            Source: 'Pip Nation Landing Page',
            'Payment Status': 'Pending',
            'External Reference': externalReference,
            Notes: 'Checkout opened, awaiting M-Pesa confirmation.'
          }
        }],
        typecast: true
      })
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return { statusCode: res.status, body: JSON.stringify({ error: body.error || 'Airtable error' }) };
    }
  } catch (err) {
    return { statusCode: 502, body: JSON.stringify({ error: 'Failed to reach Airtable' }) };
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ ok: true, phone: phoneNumber, externalReference })
  };
};
