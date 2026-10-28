'use strict';

// GET /feed.json — the TickrMeter polls this every minute.
// Renders the current minute, then points at a signed, immutable frame URL.

const core = require('../market-face/core.cjs');
const { sdk, origin, encodeFace, draw, send } = require('./_shared.cjs');

module.exports = async (req, res) => {
  if (!['GET', 'HEAD'].includes(req.method)) return send(res, req, 405, null, null, 'no-store');
  try {
    const now = new Date();
    const base = origin();
    const signal = AbortSignal.timeout(8000);
    const result = core.buildResult(await core.snapshot(now, process.env.FINNHUB_API_KEY, signal), now);
    const bitmap = draw(result.face);
    const feed = sdk.buildFeed({
      bitmap,
      frameUrl: `${base}/frame/${encodeFace(result.face)}.bin`,
      feedUrl: `${base}/feed.json`,
      observedAt: result.observedAt,
      led: result.led,
    });
    send(res, req, 200, 'application/json', Buffer.from(JSON.stringify(feed)), 'no-store');
  } catch {
    // No data yet (or misconfiguration): the device keeps its last good image.
    send(res, req, 503, null, null, 'no-store');
  }
};
