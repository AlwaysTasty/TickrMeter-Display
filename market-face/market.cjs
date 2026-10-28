'use strict';

// TickrMeter App Runner module (for running on an always-on computer instead
// of Vercel). Same faces and data logic as the Vercel endpoints.
// Settings (ticker, time zone, extended hours, LED) live in core.cjs.

const core = require('./core.cjs');
const { renderFace } = require('./face.cjs');

let logo = null;
try { logo = require('./logo.cjs'); } catch { /* placeholder */ }

exports.collect = async ({ now, signal, secrets }) => {
  if (secrets.apiKey === 'synthetic') {
    // Local design test only (FINNHUB_API_KEY=synthetic): made-up values, never for a device.
    const session = core.localSession(now);
    const quote = { c: 2.47, dp: -1.2315, h: 2.55, l: 2.4, t: Math.floor(now.getTime() / 1000) };
    return core.buildResult({ session, open: session !== null, quote, quoteAt: now.getTime() }, now);
  }
  return core.buildResult(await core.snapshot(now, secrets.apiKey, signal), now);
};

exports.render = async result => renderFace({ ...result.face, logo });
