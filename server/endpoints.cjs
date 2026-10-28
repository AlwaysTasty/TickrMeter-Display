'use strict';

// Platform-neutral endpoint logic. Each function returns { status, headers, body }
// and is wrapped by thin Vercel (api/) or Netlify (netlify/functions/) handlers.
//
// /feed.json fetches the quote, renders the current minute and points at a
// signed frame URL; /frame/<payload>.<sig>.bin re-renders that payload
// byte-for-byte. No storage is needed, and every response has an exact
// Content-Length (the firmware rejects chunked or compressed bodies).

const crypto = require('node:crypto');
const sdk = require('../packages/tickrmeter-display-sdk');
const core = require('../market-face/core.cjs');
const { renderFace } = require('../market-face/face.cjs');
const logo = require('../market-face/logo.cjs');

const FIELDS = {
  open: ['mode', 'symbol', 'price', 'change', 'high', 'low', 'time', 'ampm', 'day', 'date', 'session', 'delayed'],
  closed: ['mode', 'symbol', 'price', 'change', 'time', 'ampm', 'longDate'],
};

// The frame-signing key is derived from the API key, so there is one secret to configure.
const signingKey = apiKey => crypto.createHmac('sha256', apiKey).update('tickrmeter-frame-v1').digest();
const b64 = buf => Buffer.from(buf).toString('base64url');
const sign = (apiKey, payload) => b64(crypto.createHmac('sha256', signingKey(apiKey)).update(payload).digest().subarray(0, 16));

function encodeFace(apiKey, face) {
  const payload = b64(JSON.stringify(FIELDS[face.mode].map(key => face[key] ?? null)));
  return `${payload}.${sign(apiKey, payload)}`;
}

function decodeFace(apiKey, token) {
  const match = /^([A-Za-z0-9_-]{8,400})\.([A-Za-z0-9_-]{22})$/.exec(token || '');
  if (!match) return null;
  const expected = Buffer.from(sign(apiKey, match[1]));
  const received = Buffer.from(match[2]);
  if (expected.length !== received.length || !crypto.timingSafeEqual(expected, received)) return null;
  let values;
  try { values = JSON.parse(Buffer.from(match[1], 'base64url').toString('utf8')); } catch { return null; }
  if (!Array.isArray(values) || !Object.hasOwn(FIELDS, values[0]) || values.length !== FIELDS[values[0]].length) return null;
  const face = {};
  for (const [i, key] of FIELDS[values[0]].entries()) {
    const v = values[i];
    if (v === null) continue;
    if (key === 'delayed') { if (v === true) face.delayed = true; continue; }
    if (typeof v !== 'string' || v.length > 40) return null;
    face[key] = v;
  }
  return face;
}

const draw = face => sdk.validateBitmap(renderFace({ ...face, logo }));

function reply(method, status, type, body, cache) {
  const headers = { 'Content-Length': String(body ? body.length : 0), 'X-Content-Type-Options': 'nosniff', 'Cache-Control': cache };
  if (type) headers['Content-Type'] = type;
  return { status, headers, body: method === 'HEAD' || !body ? null : body };
}
const empty = (method, status) => reply(method, status, null, null, 'no-store, no-transform');

function normaliseOrigin(raw) {
  return sdk.validateSourceUrl(String(raw || '').replace(/\/+$/, '') + '/').replace(/\/$/, '');
}

/** GET /feed.json */
async function feed({ method, origin, apiKey, now = new Date() }) {
  if (!['GET', 'HEAD'].includes(method)) return empty(method, 405);
  try {
    if (!apiKey) throw new Error('FINNHUB_API_KEY is not set');
    const base = normaliseOrigin(origin);
    const result = core.buildResult(await core.snapshot(now, apiKey, AbortSignal.timeout(8000)), now);
    const document = sdk.buildFeed({
      bitmap: draw(result.face),
      frameUrl: `${base}/frame/${encodeFace(apiKey, result.face)}.bin`,
      feedUrl: `${base}/feed.json`,
      observedAt: result.observedAt,
      led: result.led,
    });
    return reply(method, 200, 'application/json', Buffer.from(JSON.stringify(document)), 'no-store, no-transform');
  } catch {
    // No data yet or misconfigured: the device keeps showing its last good image.
    return empty(method, 503);
  }
}

/** GET /frame/<payload>.<sig>.bin */
function frame({ method, token, apiKey }) {
  if (!['GET', 'HEAD'].includes(method)) return empty(method, 405);
  let face = null;
  try { face = apiKey ? decodeFace(apiKey, String(token || '').replace(/\.bin$/, '')) : null; } catch { face = null; }
  if (!face) return empty(method, 404);
  try {
    // Same URL always means the same bytes, so caches may keep it.
    return reply(method, 200, 'application/octet-stream', Buffer.from(draw(face)), 'public, max-age=86400, immutable, no-transform');
  } catch {
    return empty(method, 404);
  }
}

module.exports = { feed, frame };
