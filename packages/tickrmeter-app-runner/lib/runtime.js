'use strict';

const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const https = require('node:https');
const { pathToFileURL } = require('node:url');
const sdk = require('../../tickrmeter-display-sdk');
const { fail, RunnerError } = require('./config');
const { writeAtomic, readBounded, lockDirectory, appDirectory, readAppDirectory, ensureAppDirectory, feedUrl, assertOutputPolicy, buildOutputFeed, readOutput, publish } = require('./storage');
const { readCredentials, authorize } = require('./credentials');
const { assertProtected, ensureProtectedDirectory } = require('./private-files');
const { loadPrivateTls } = require('./private-tls');

const SAFE_ERRORS = new Set(['COLLECTION_FAILED', 'COLLECTION_TIMEOUT', 'INVALID_RESULT', 'OUTPUT_WRITE_FAILED', 'OUTPUT_UNREADABLE', 'RUNNER_STOPPED']);
function safeState(config, app, now) {
  let saved = {};
  try { saved = JSON.parse(readBounded(readAppDirectory(config, app), 'status.json', 4096)); } catch {}
  let feed;
  let recoveryError;
  try {
    feed = readOutput(config, app);
    if (Date.parse(feed.observedAt) > now + 60000) { feed = undefined; recoveryError = 'OUTPUT_UNREADABLE'; }
  } catch {
    if (fs.existsSync(path.join(appDirectory(config, app), 'feed.json'))) recoveryError = 'OUTPUT_UNREADABLE';
  }
  return { id: app.id, phase: feed ? 'ready' : 'waiting', observedAt: feed?.observedAt || null,
    lastAttemptAt: typeof saved.lastAttemptAt === 'string' && Number.isFinite(Date.parse(saved.lastAttemptAt)) ? saved.lastAttemptAt : null,
    lastSuccessAt: typeof saved.lastSuccessAt === 'string' && Number.isFinite(Date.parse(saved.lastSuccessAt)) ? saved.lastSuccessAt : null,
    failures: Number.isInteger(saved.failures) && saved.failures >= 0 ? Math.min(saved.failures, 100) : 0,
    error: recoveryError || (SAFE_ERRORS.has(saved.error) ? saved.error : null), nextRunAt: null,
    intervalSeconds: app.intervalSeconds, staleAfterSeconds: app.staleAfterSeconds, feedUrl: feedUrl(config, app) };
}
function reportState(state, now) {
  return { ...state, stale: !state.observedAt || now - Date.parse(state.observedAt) > state.staleAfterSeconds * 1000 };
}
function readStatus(config, now = Date.now()) {
  return { ...deliveryStatus(config),
    apps: config.apps.map(app => reportState(safeState(config, app, now), now)) };
}
function deliveryStatus(config) {
  return config.mode === 'private' ? { version: 2, publicDelivery: false, privateHostConfigured: true, network: config.network,
    deviceDeliverySupported: false, message: 'Protected host mode. Private device delivery and local pairing are not supported by current firmware.' }
    : { version: 1, publicDelivery: config.acknowledgePublicData && !config.placeholderOrigin };
}
function createHttpServer(config) {
  assertOutputPolicy(config);
  const ids = new Map(config.apps.map(app => [app.id, app]));
  const privateMode = config.mode === 'private';
  let tls;
  if (privateMode) {
    assertProtected(path.dirname(config.credentialsFile), true);
    readCredentials(config);
    tls = loadPrivateTls(config);
  }
  let budget = { resetAt: 0, used: 0, credentials: new Map() };
  const handler = (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cache-Control', privateMode ? 'private, no-store' : 'no-store');
    if (privateMode) response.setHeader('Vary', 'Authorization');
    const empty = (status, headers = {}) => { response.writeHead(status, { ...headers, 'Content-Length': '0' }); response.end(); };
    // The default runner only writes local output. A proxy cannot bypass this by rewriting Host.
    if (!privateMode && (!config.acknowledgePublicData || config.placeholderOrigin)) { empty(404); return; }
    try { assertOutputPolicy(config); } catch { empty(404); return; }
    if (privateMode) {
      if (Date.now() >= budget.resetAt) budget = { resetAt: Date.now() + 60000, used: 0, credentials: new Map() };
      if (++budget.used > 600) { empty(429, { 'Retry-After': '60', Connection: 'close' }); return; }
      const hostHeaders = request.rawHeaders.filter((_value, index) => index % 2 === 0 && request.rawHeaders[index].toLowerCase() === 'host');
      if (hostHeaders.length !== 1 || request.headers.host !== new URL(config.publicBaseUrl).host) { empty(421); return; }
      if (request.headers['transfer-encoding'] !== undefined || (request.headers['content-length'] !== undefined && request.headers['content-length'] !== '0')) {
        empty(400, { Connection: 'close' }); return;
      }
    }
    if (!['GET', 'HEAD'].includes(request.method)) { empty(405, { Allow: 'GET, HEAD' }); return; }
    const route = /^\/apps\/([a-z][a-z0-9-]{0,39})\/(feed\.json|frames\/([a-f0-9]{64})\.bin)$/.exec(request.url);
    if (privateMode && route) {
      const credentialId = authorize(config, request, route[1]);
      if (!credentialId) { empty(401, { 'WWW-Authenticate': 'Bearer realm="TickrMeter display"' }); return; }
      const used = (budget.credentials.get(credentialId) || 0) + 1;
      budget.credentials.set(credentialId, used);
      if (used > 120) { empty(429, { 'Retry-After': '60' }); return; }
    }
    const app = route && ids.get(route[1]);
    if (!app) { empty(404); return; }
    try {
      let body;
      let type;
      if (route[2] === 'feed.json') {
        body = Buffer.from(JSON.stringify(readOutput(config, app)));
        type = 'application/json';
      } else {
        body = sdk.validateBitmap(readBounded(readAppDirectory(config, app), route[2], sdk.FRAME_BYTES));
        if (sdk.hashBitmap(body) !== route[3]) { empty(404); return; }
        type = 'application/octet-stream';
        if (!privateMode) response.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      }
      response.writeHead(200, { 'Content-Type': type, 'Content-Length': String(body.length) });
      response.end(request.method === 'HEAD' ? undefined : body);
    } catch { empty(404); }
  };
  const server = privateMode ? https.createServer({ ...tls, maxHeaderSize: 8192 }, handler) : http.createServer(handler);
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.keepAliveTimeout = 3000;
  server.maxHeadersCount = 32;
  if (privateMode) {
    server.maxConnections = 64;
    server.maxRequestsPerSocket = 100;
    server.on('clientError', (_error, socket) => socket.destroy());
  }
  return server;
}

async function createRunner(config, options = {}) {
  const now = options.now || Date.now;
  const setTimer = options.setTimeout || setTimeout;
  const clearTimer = options.clearTimeout || clearTimeout;
  if (config.mode === 'private') ensureProtectedDirectory(config.outputDir);
  const release = lockDirectory(config.outputDir);
  try { assertOutputPolicy(config, true); } catch (error) { release(); throw error; }
  const states = new Map();
  const modules = new Map();
  const active = new Map();
  const schedules = new Map();
  let server;
  let stopped = false;
  let scheduling = false;
  let released = false;
  const maybeRelease = () => { if (stopped && !active.size && !released) { release(); released = true; } };
  try {
    for (const app of config.apps) {
      const imported = await import(pathToFileURL(app.modulePath).href);
      const provider = imported.default || imported;
      if (!provider || typeof provider.collect !== 'function' || (provider.render !== undefined && typeof provider.render !== 'function')) fail('INVALID_APP_MODULE');
      modules.set(app.id, provider);
      states.set(app.id, safeState(config, app, now()));
    }
  } catch { release(); fail('APP_MODULE_LOAD_FAILED'); }
  function persist(app) {
    writeAtomic(path.join(ensureAppDirectory(config, app), 'status.json'), JSON.stringify(states.get(app.id)));
  }
  function saveFailure(app, code) {
    const state = states.get(app.id);
    state.failures = Math.min(state.failures + 1, 100);
    state.error = code;
    state.phase = state.observedAt ? 'degraded' : 'waiting';
    try { persist(app); } catch { state.error = 'OUTPUT_WRITE_FAILED'; }
  }
  function schedule(app) {
    if (stopped || !scheduling || schedules.has(app.id)) return;
    const state = states.get(app.id);
    const delay = Math.min(86400, app.intervalSeconds * 2 ** Math.min(state.failures, 6)) * 1000;
    state.nextRunAt = new Date(now() + delay).toISOString();
    try { persist(app); } catch { state.error = 'OUTPUT_WRITE_FAILED'; }
    schedules.set(app.id, setTimer(() => { schedules.delete(app.id); void run(app.id); }, delay));
  }
  function run(id) {
    const app = config.apps.find(item => item.id === id);
    if (!app) return Promise.reject(new RunnerError('UNKNOWN_APP'));
    if (stopped) return Promise.reject(new RunnerError('RUNNER_STOPPED'));
    if (active.has(id)) return active.get(id).outcome;
    if (schedules.has(id)) { clearTimer(schedules.get(id)); schedules.delete(id); }
    const state = states.get(id);
    const controller = new AbortController();
    state.lastAttemptAt = new Date(now()).toISOString();
    state.phase = 'collecting'; state.nextRunAt = null;
    let timedOut = false;
    let timer;
    let timeoutResolve;
    const timeout = new Promise(resolve => { timeoutResolve = resolve; });
    const entry = { controller, outcome: null };
    active.set(id, entry);
    const work = Promise.resolve().then(async () => {
      let result;
      const secrets = Object.freeze(Object.fromEntries(Object.entries(app.secrets).map(([key, env]) => {
        if (!process.env[env]) throw new RunnerError('COLLECTION_FAILED');
        return [key, process.env[env]];
      })));
      try { result = await modules.get(id).collect({ signal: controller.signal, now: new Date(now()), secrets }); }
      catch { throw new RunnerError('COLLECTION_FAILED'); }
      if (timedOut || stopped) return;
      if (!result || typeof result !== 'object' || Array.isArray(result) || typeof result.observedAt !== 'string' ||
          !Number.isFinite(Date.parse(result.observedAt)) || Date.parse(result.observedAt) > now() + 60000) throw new RunnerError('INVALID_RESULT');
      // Missing/old observations never become fresh just because collection ran again.
      let bitmap;
      try {
        bitmap = sdk.validateBitmap(modules.get(id).render ? await modules.get(id).render(result, { signal: controller.signal, now: new Date(now()) })
          : require('./render').renderLayout(result.display));
        buildOutputFeed(config, app, result, bitmap);
      } catch { throw new RunnerError('INVALID_RESULT'); }
      if (timedOut || stopped) return;
      try { publish(config, app, result, bitmap); } catch { throw new RunnerError('OUTPUT_WRITE_FAILED'); }
      state.observedAt = result.observedAt; state.lastSuccessAt = new Date(now()).toISOString();
      state.failures = 0; state.error = null; state.phase = 'ready';
      try { persist(app); } catch { state.error = 'OUTPUT_WRITE_FAILED'; state.phase = 'degraded'; }
    }).catch(error => {
      if (!timedOut && !stopped) saveFailure(app, SAFE_ERRORS.has(error.code) ? error.code : 'COLLECTION_FAILED');
    }).finally(() => {
      clearTimer(timer);
      active.delete(id);
      // A collector that ignores abort keeps its slot until it really settles.
      // Its late result is discarded; no overlapping retry can be started.
      schedule(app); maybeRelease();
    });
    timer = setTimer(() => {
      timedOut = true;
      controller.abort();
      saveFailure(app, 'COLLECTION_TIMEOUT');
      timeoutResolve();
    }, app.timeoutSeconds * 1000);
    entry.cancel = () => { timedOut = true; clearTimer(timer); controller.abort(); timeoutResolve(); };
    entry.outcome = Promise.race([work, timeout]).then(() => reportState(state, now()));
    return entry.outcome;
  }
  return {
    config,
    run,
    async once() { return Promise.all(config.apps.map(app => run(app.id))); },
    status() { return { ...deliveryStatus(config),
      apps: [...states.values()].map(state => reportState(state, now())) }; },
    async start() {
      if (stopped || server) fail('RUNNER_ALREADY_STARTED_OR_STOPPED');
      server = createHttpServer(config);
      try {
        await new Promise((resolve, reject) => { server.once('error', reject); server.listen(config.port, config.mode === 'private' ? config.bindAddress : '127.0.0.1', () => { server.off('error', reject); resolve(); }); });
      } catch { server = undefined; fail('LISTENER_START_FAILED'); }
      scheduling = true;
      for (const app of config.apps) void run(app.id);
      return server.address();
    },
    async stop() {
      stopped = true; scheduling = false;
      for (const timer of schedules.values()) clearTimer(timer);
      schedules.clear();
      for (const entry of active.values()) entry.cancel();
      if (server) {
        const current = server; server = undefined;
        await new Promise(resolve => { current.close(resolve); current.closeAllConnections(); });
      }
      maybeRelease();
      return { pendingCollectors: active.size };
    }
  };
}

module.exports = { createRunner, createHttpServer, readStatus };
