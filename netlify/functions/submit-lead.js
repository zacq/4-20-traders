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
  if (!name || !email || !phone || !tier) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing required fields' }) };
  }

  const { AIRTABLE_TOKEN, AIRTABLE_BASE_ID, AIRTABLE_TABLE_ID } = process.env;
  if (!AIRTABLE_TOKEN || !AIRTABLE_BASE_ID || !AIRTABLE_TABLE_ID) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Server not configured' }) };
  }

  const record = {
    fields: {
      Name: name,
      Email: email,
      Phone: phone,
      Tier: tier,
      'Price (KES)': Number(price) || 0,
      Status: 'New',
      Source: 'Pip Nation Landing Page',
      Notes: `Submitted from the Pip Nation landing page enrollment form.`
    }
  };

  try {
    const res = await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_TABLE_ID}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${AIRTABLE_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ records: [record], typecast: true })
    });

    const body = await res.json();
    if (!res.ok) {
      return { statusCode: res.status, body: JSON.stringify({ error: body.error || 'Airtable error' }) };
    }

    return { statusCode: 200, body: JSON.stringify({ ok: true, id: body.records?.[0]?.id }) };
  } catch (err) {
    return { statusCode: 502, body: JSON.stringify({ error: 'Failed to reach Airtable' }) };
  }
};
