'use strict';

// Shared helpers for the Vercel endpoints. Files starting with "_" are not
// exposed as routes by Vercel.

const crypto = require('node:crypto');
const sdk = require('../packages/tickrmeter-display-sdk');
const { renderFace } = require('../market-face/face.cjs');
const logo = require('../market-face/logo.cjs');

// The public origin the device uses. Vercel exposes the production domain as
// VERCEL_PROJECT_PRODUCTION_URL; PUBLIC_ORIGIN overrides it (e.g. a custom domain).
function origin() {
  const raw = process.env.PUBLIC_ORIGIN || (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : '');
  const url = sdk.validateSourceUrl(raw.replace(/\/+$/, '') + '/');
  return url.replace(/\/$/, '');
}

// Frames are stateless: the frame URL carries the (signed) text to draw, and the
// frame endpoint re-renders it byte-for-byte. The signing key is derived from the
// API key, so there is only one secret to configure.
function signingKey() {
  const apiKey = process.env.FINNHUB_API_KEY;
  if (!apiKey) throw new Error('FINNHUB_API_KEY is not set');
  return crypto.createHmac('sha256', apiKey).update('tickrmeter-frame-v1').digest();
}
const b64 = buf => Buffer.from(buf).toString('base64url');
const sign = payload => b64(crypto.createHmac('sha256', signingKey()).update(payload).digest().subarray(0, 16));

const FIELDS = {
  open: ['mode', 'symbol', 'price', 'change', 'high', 'low', 'time', 'ampm', 'day', 'date', 'session', 'delayed'],
  closed: ['mode', 'symbol', 'price', 'change', 'time', 'ampm', 'longDate'],
};

function encodeFace(face) {
  const compact = FIELDS[face.mode].map(key => face[key] ?? null);
  const payload = b64(JSON.stringify(compact));
  return `${payload}.${sign(payload)}`;
}

function decodeFace(token) {
  const match = /^([A-Za-z0-9_-]{8,400})\.([A-Za-z0-9_-]{22})$/.exec(token || '');
  if (!match) return null;
  const expected = Buffer.from(sign(match[1]));
  const received = Buffer.from(match[2]);
  if (expected.length !== received.length || !crypto.timingSafeEqual(expected, received)) return null;
  let values;
  try { values = JSON.parse(Buffer.from(match[1], 'base64url').toString('utf8')); } catch { return null; }
  if (!Array.isArray(values)) return null;
  const mode = values[0];
  if (!Object.hasOwn(FIELDS, mode) || values.length !== FIELDS[mode].length) return null;
  const face = {};
  for (const [i, key] of FIELDS[mode].entries()) {
    const v = values[i];
    if (v === null) continue;
    if (key === 'delayed') { if (v === true) face.delayed = true; continue; }
    if (typeof v !== 'string' || v.length > 40) return null;
    face[key] = v;
  }
  return face;
}

const draw = face => sdk.validateBitmap(renderFace({ ...face, logo }));

// Exact-length, uncompressed, non-chunked responses, as the firmware requires.
function send(res, req, status, type, body, cache) {
  const headers = { 'Content-Length': String(body ? body.length : 0), 'X-Content-Type-Options': 'nosniff', 'Cache-Control': cache };
  if (type) headers['Content-Type'] = type;
  res.writeHead(status, headers);
  res.end(req.method === 'HEAD' || !body ? undefined : body);
}

module.exports = { sdk, origin, encodeFace, decodeFace, draw, send };
