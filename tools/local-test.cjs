'use strict';
// Local contract test for the Vercel endpoints, with Finnhub mocked (no network).
// Usage: node tools/local-test.cjs [pngOutDir]
// Checks what the TickrMeter firmware needs from the *code*; the deployed host's
// TLS chain, compression and chunking still have to be checked on the real URL.

const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

process.env.FINNHUB_API_KEY = 'local-test-key';
process.env.PUBLIC_ORIGIN = 'https://sls-tickrmeter.vercel.app';

const sdk = require('../packages/tickrmeter-display-sdk');
const core = require('../market-face/core.cjs');
const feedHandler = require('../api/feed.js');
const frameHandler = require('../api/frame.js');

// ---- Finnhub mock ----
let mock = { session: 'regular', quote: { c: 2.47, d: -0.03, dp: -1.2, h: 2.55, l: 2.4, o: 2.5, pc: 2.5, t: 1793170000 }, fail: false };
let calls = [];
global.fetch = async (url, opts) => {
  calls.push(String(url));
  assert.equal(opts.headers['X-Finnhub-Token'], 'local-test-key');
  if (mock.fail) throw new Error('network down');
  const body = String(url).includes('market-status')
    ? { exchange: 'US', isOpen: mock.session === 'regular', session: mock.session, holiday: null }
    : mock.quote;
  return { ok: true, status: 200, json: async () => body };
};
const resetCache = () => Object.assign(core._cache, { quote: null, quoteAt: 0, status: null, statusAt: 0 });

// ---- Minimal Vercel-style router (rewrites + req.query) ----
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://local');
  if (url.pathname === '/feed.json') { req.query = {}; return feedHandler(req, res); }
  const m = /^\/frame\/([^/]+)$/.exec(url.pathname);
  if (m) { req.query = { token: decodeURIComponent(m[1]) }; return frameHandler(req, res); }
  res.writeHead(404, { 'Content-Length': '0' }); res.end();
});

function get(port, p, method = 'GET') {
  return new Promise((resolve, reject) => {
    // No Accept-Encoding, like a small embedded HTTP client.
    const req = http.request({ host: '127.0.0.1', port, path: p, method }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.end();
  });
}

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const outDir = process.argv[2];
  if (outDir) fs.mkdirSync(outDir, { recursive: true });
  const results = [];
  const check = (name, fn) => { fn(); results.push(`ok  ${name}`); };

  for (const session of ['regular', 'pre-market', 'post-market', null]) {
    resetCache(); calls = [];
    mock.session = session;
    const feedRes = await get(port, '/feed.json');
    const label = session || 'closed';
    check(`${label}: feed 200, exact Content-Length, not chunked/compressed`, () => {
      assert.equal(feedRes.status, 200);
      assert.equal(Number(feedRes.headers['content-length']), feedRes.body.length);
      assert.equal(feedRes.headers['transfer-encoding'], undefined);
      assert.equal(feedRes.headers['content-encoding'], undefined);
      assert.match(feedRes.headers['content-type'], /^application\/json/);
      assert.equal(feedRes.headers['cache-control'], 'no-store');
      assert.ok(feedRes.body.length <= 2048);
    });
    const feed = sdk.validateFeed(feedRes.body, { feedUrl: `${process.env.PUBLIC_ORIGIN}/feed.json` });
    check(`${label}: feed passes SDK validation (same origin, URL ${Buffer.byteLength(feed.frame.url)} bytes <= 512)`, () => {
      assert.ok(Buffer.byteLength(feed.frame.url) <= 512);
    });
    const expectOpen = session !== null;
    check(`${label}: LED ${feed.led.color}`, () => {
      assert.equal(feed.led.mode === 'solid', expectOpen);
      if (expectOpen) assert.equal(feed.led.color, 'red'); // mock dp is negative
    });
    const framePath = new URL(feed.frame.url).pathname;
    const frameRes = await get(port, framePath);
    check(`${label}: frame 200, 4,736 bytes, SHA-256 matches feed`, () => {
      assert.equal(frameRes.status, 200);
      assert.equal(frameRes.body.length, 4736);
      assert.equal(Number(frameRes.headers['content-length']), 4736);
      assert.equal(frameRes.headers['content-type'], 'application/octet-stream');
      assert.equal(frameRes.headers['transfer-encoding'], undefined);
      assert.equal(crypto.createHash('sha256').update(frameRes.body).digest('hex'), feed.frame.sha256);
    });
    if (outDir) fs.writeFileSync(path.join(outDir, `endpoint-${label}.png`), sdk.bitmapToPng(frameRes.body));

    const head = await get(port, framePath, 'HEAD');
    check(`${label}: HEAD gives length without body`, () => {
      assert.equal(head.status, 200); assert.equal(Number(head.headers['content-length']), 4736); assert.equal(head.body.length, 0);
    });
    const tampered = framePath.replace(/\.([A-Za-z0-9_-]{22})\.bin$/, (m, sig) => `.${sig[0] === 'A' ? 'B' : 'A'}${sig.slice(1)}.bin`);
    check(`${label}: altered frame URL rejected`, () => assert.notEqual(tampered, framePath));
    assert.equal((await get(port, tampered)).status, 404);
  }

  // Rate use: a second feed request while closed must reuse the cached quote.
  resetCache(); mock.session = null; calls = [];
  await get(port, '/feed.json'); await get(port, '/feed.json');
  check(`closed: 2 polls -> ${calls.filter(u => u.includes('/quote')).length} quote call(s), ${calls.filter(u => u.includes('market-status')).length} status call(s)`, () => {
    assert.equal(calls.filter(u => u.includes('/quote')).length, 1);
  });

  // Provider outage with a cached quote: still serves, keeps the old observation time, flags DELAYED when open.
  resetCache(); mock.session = 'regular'; mock.fail = false;
  const before = sdk.validateFeed((await get(port, '/feed.json')).body);
  mock.fail = true;
  core._cache.quoteAt -= 11 * 60e3; core._cache.statusAt -= 11 * 60e3;
  const during = await get(port, '/feed.json');
  check('outage with cache: still 200, observedAt not advanced', () => {
    assert.equal(during.status, 200);
    assert.ok(Date.parse(sdk.validateFeed(during.body).observedAt) < Date.parse(before.observedAt));
  });

  // Outage with nothing cached: 503 so the device keeps its last image.
  resetCache();
  check('outage without cache: 503', async () => {});
  assert.equal((await get(port, '/feed.json')).status, 503);
  mock.fail = false;

  assert.equal((await get(port, '/feed.json', 'POST')).status, 405);
  results.push('ok  POST rejected (405)');
  assert.equal((await get(port, '/frame/garbage.bin')).status, 404);
  results.push('ok  unsigned frame URL rejected (404)');

  server.close();
  console.log(results.join('\n'));
  console.log(`\n${results.length} checks passed`);
})().catch(error => { console.error('FAILED:', error.message); server.close(); process.exitCode = 1; });
