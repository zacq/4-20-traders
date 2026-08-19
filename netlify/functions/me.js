const { verifySession, parseCookieHeader } = require('./_lib/session');

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const { SESSION_SECRET } = process.env;
  if (!SESSION_SECRET) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Server not configured' }) };
  }

  const token = parseCookieHeader(event.headers.cookie || event.headers.Cookie);
  const payload = token ? verifySession(token, SESSION_SECRET) : null;

  if (!payload) {
    return { statusCode: 401, body: JSON.stringify({ ok: false }) };
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ ok: true, user: { name: payload.name, email: payload.email } })
  };
};
