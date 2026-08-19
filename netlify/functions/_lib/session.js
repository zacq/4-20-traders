const crypto = require('crypto');

const COOKIE_NAME = 'pn_session';
const DEFAULT_TTL_SECONDS = 60 * 60 * 24 * 14; // 14 days

function base64url(input) {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlDecode(input) {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (input.length % 4)) % 4);
  return Buffer.from(padded, 'base64');
}

function signSession({ email, name }, secret, ttlSeconds = DEFAULT_TTL_SECONDS) {
  const now = Math.floor(Date.now() / 1000);
  const payload = { email, name, iat: now, exp: now + ttlSeconds };
  const payloadB64 = base64url(JSON.stringify(payload));
  const sig = base64url(crypto.createHmac('sha256', secret).update(payloadB64).digest());
  return `${payloadB64}.${sig}`;
}

function verifySession(token, secret) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payloadB64, sig] = parts;

  const expectedSig = base64url(crypto.createHmac('sha256', secret).update(payloadB64).digest());
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return null;
  }

  let payload;
  try {
    payload = JSON.parse(base64urlDecode(payloadB64).toString('utf8'));
  } catch (e) {
    return null;
  }

  if (!payload.exp || Math.floor(Date.now() / 1000) > payload.exp) return null;
  return payload;
}

function isSecureContext() {
  return process.env.CONTEXT === 'production' || process.env.CONTEXT === 'deploy-preview';
}

function serializeCookie(token, { maxAgeSeconds = DEFAULT_TTL_SECONDS } = {}) {
  const parts = [
    `${COOKIE_NAME}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`
  ];
  if (isSecureContext()) parts.push('Secure');
  return parts.join('; ');
}

function serializeExpiredCookie() {
  return serializeCookie('', { maxAgeSeconds: 0 });
}

function parseCookieHeader(cookieHeader) {
  if (!cookieHeader) return null;
  const match = cookieHeader.split(';').map((c) => c.trim()).find((c) => c.startsWith(`${COOKIE_NAME}=`));
  if (!match) return null;
  return match.slice(COOKIE_NAME.length + 1);
}

module.exports = {
  COOKIE_NAME,
  signSession,
  verifySession,
  serializeCookie,
  serializeExpiredCookie,
  parseCookieHeader
};
