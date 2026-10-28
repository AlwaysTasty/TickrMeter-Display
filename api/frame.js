'use strict';

// GET /frame/<payload>.<signature>.bin — the exact 4,736-byte image named in the feed.
// Stateless: the signed payload is re-rendered deterministically, so its
// SHA-256 matches the feed. Unsigned or altered URLs get 404.

const { decodeFace, draw, send } = require('./_shared.cjs');

module.exports = (req, res) => {
  if (!['GET', 'HEAD'].includes(req.method)) return send(res, req, 405, null, null, 'no-store');
  const token = String(req.query?.token || '').replace(/\.bin$/, '');
  let face;
  try { face = decodeFace(token); } catch { face = null; }
  if (!face) return send(res, req, 404, null, null, 'no-store');
  let bitmap;
  try { bitmap = draw(face); } catch { return send(res, req, 404, null, null, 'no-store'); }
  // Same URL always means the same bytes, so the CDN may cache it.
  send(res, req, 200, 'application/octet-stream', Buffer.from(bitmap), 'public, max-age=86400, s-maxage=86400, immutable');
};
