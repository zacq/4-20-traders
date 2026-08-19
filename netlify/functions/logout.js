const { serializeExpiredCookie } = require('./_lib/session');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  return {
    statusCode: 200,
    headers: { 'Set-Cookie': serializeExpiredCookie() },
    body: JSON.stringify({ ok: true })
  };
};
