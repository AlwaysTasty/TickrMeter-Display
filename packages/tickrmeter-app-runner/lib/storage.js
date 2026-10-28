'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { randomBytes } = require('node:crypto');
const sdk = require('../../tickrmeter-display-sdk');
const { fail, inside, readJson } = require('./config');
const PROCESS_INSTANCE = randomBytes(16).toString('hex');
function processIdentity(pid) {
  if (process.platform !== 'linux') return null;
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    return `${fs.readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim()}:${stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19]}`;
  } catch { return null; }
}

function writeAtomic(filename, body) {
  fs.mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
  const temp = `${filename}.${randomBytes(12).toString('hex')}.tmp`;
  let descriptor;
  try {
    descriptor = fs.openSync(temp, 'wx', 0o600);
    fs.writeFileSync(descriptor, body);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor); descriptor = undefined;
    fs.renameSync(temp, filename);
    // Directory fsync is unavailable on some Windows filesystems.
    try { const dir = fs.openSync(path.dirname(filename), 'r'); try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); } } catch {}
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    try { fs.unlinkSync(temp); } catch {}
  }
}
function readBounded(root, relative, maxBytes) {
  const resolved = fs.realpathSync(path.join(root, relative));
  if (!inside(fs.realpathSync(root), resolved)) fail('INVALID_OUTPUT_PATH');
  const fd = fs.openSync(resolved, 'r');
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size < 1 || stat.size > maxBytes) fail('INVALID_OUTPUT_FILE');
    const data = Buffer.alloc(stat.size);
    let offset = 0;
    while (offset < data.length) {
      const count = fs.readSync(fd, data, offset, data.length - offset, offset);
      if (!count) fail('INVALID_OUTPUT_FILE');
      offset += count;
    }
    return data;
  } finally { fs.closeSync(fd); }
}
function lockDirectory(root) {
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const filename = path.join(root, '.runner.lock');
  const guard = path.join(root, '.runner-lock-recovery');
  const identity = { pid: process.pid, hostname: os.hostname(), instance: PROCESS_INSTANCE,
    processIdentity: processIdentity(process.pid), nonce: randomBytes(16).toString('hex') };
  // Every acquisition uses this guard: stale reclaim cannot unlink another
  // contender's new live lock. A crash during the few filesystem operations
  // leaves a guard requiring explicit operator recovery, never an unsafe guess.
  try { fs.writeFileSync(guard, JSON.stringify(identity), { flag: 'wx', mode: 0o600 }); } catch { fail('OUTPUT_LOCKED'); }
  try {
    if (fs.existsSync(filename)) {
      let lock;
      try { lock = readJson(filename, 1024); } catch { fail('OUTPUT_LOCKED'); }
      if (!Number.isInteger(lock.pid) || lock.pid < 1 || lock.hostname !== os.hostname()) fail('OUTPUT_LOCKED');
      let stale = lock.pid === process.pid && lock.instance !== PROCESS_INSTANCE;
      try { process.kill(lock.pid, 0); } catch (error) { stale = error.code === 'ESRCH'; }
      const actualIdentity = processIdentity(lock.pid);
      if (lock.processIdentity && actualIdentity && lock.processIdentity !== actualIdentity) stale = true;
      if (!stale) fail('OUTPUT_LOCKED');
      fs.unlinkSync(filename);
    }
    try { fs.writeFileSync(filename, JSON.stringify(identity), { flag: 'wx', mode: 0o600 }); } catch { fail('OUTPUT_LOCKED'); }
  } finally { fs.unlinkSync(guard); }
  return () => {
    try { if (readJson(filename, 1024).nonce === identity.nonce) fs.unlinkSync(filename); } catch {}
  };
}
function appDirectory(config, app) { return path.join(config.outputDir, app.id); }
function readAppDirectory(config, app) {
  const root = fs.realpathSync(appDirectory(config, app));
  if (!inside(fs.realpathSync(config.outputDir), root)) fail('INVALID_OUTPUT_PATH');
  return root;
}
function ensureAppDirectory(config, app) {
  const root = appDirectory(config, app);
  const canonicalRoot = fs.realpathSync(config.outputDir);
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  if (!inside(canonicalRoot, fs.realpathSync(root))) fail('INVALID_OUTPUT_PATH');
  return root;
}
function feedUrl(config, app) { return `${config.publicBaseUrl}/apps/${app.id}/feed.json`; }
function assertOutputPolicy(config, initialize = false) {
  const filename = path.join(config.outputDir, '.private-output.json');
  const marked = fs.existsSync(filename);
  if (config.mode !== 'private') {
    if (marked) fail('PRIVATE_OUTPUT_REQUIRES_PRIVATE_CONFIG');
    return;
  }
  if (!marked) {
    if (!initialize) fail('PRIVATE_OUTPUT_NOT_INITIALIZED');
    writeAtomic(filename, '{"version":1,"mode":"private"}\n');
  }
  try {
    const marker = JSON.parse(readBounded(config.outputDir, '.private-output.json', 128));
    if (marker.version !== 1 || marker.mode !== 'private') fail('INVALID_PRIVATE_OUTPUT');
  } catch { fail('INVALID_PRIVATE_OUTPUT'); }
}
function buildOutputFeed(config, app, result, bitmap) {
  const options = { bitmap, frameUrl: `${config.publicBaseUrl}/apps/${app.id}/frames/${sdk.hashBitmap(bitmap)}.bin`,
    observedAt: result.observedAt, led: result.led, feedUrl: feedUrl(config, app) };
  return config.mode === 'private' ? sdk.buildPrivateFeed({ ...options, network: config.network }) : sdk.buildFeed(options);
}
function readOutput(config, app) {
  assertOutputPolicy(config);
  const root = readAppDirectory(config, app);
  const raw = readBounded(root, 'feed.json', sdk.MAX_FEED_BYTES);
  const feed = config.mode === 'private' ? sdk.validatePrivateFeed(raw, { feedUrl: feedUrl(config, app), network: config.network })
    : sdk.validateFeed(raw, { feedUrl: feedUrl(config, app) });
  if (feed.frame.url !== `${config.publicBaseUrl}/apps/${app.id}/frames/${feed.frame.sha256}.bin`) fail('INVALID_OUTPUT_FRAME');
  const frame = sdk.validateBitmap(readBounded(root, `frames/${feed.frame.sha256}.bin`, sdk.FRAME_BYTES));
  if (sdk.hashBitmap(frame) !== feed.frame.sha256) fail('INVALID_OUTPUT_FRAME');
  return feed;
}
function publish(config, app, result, bitmap) {
  assertOutputPolicy(config);
  const root = ensureAppDirectory(config, app);
  fs.mkdirSync(path.join(root, 'frames'), { recursive: true, mode: 0o700 });
  // Do not follow substituted app/frames directories outside the owned output.
  const canonicalRoot = fs.realpathSync(config.outputDir);
  if (!inside(canonicalRoot, fs.realpathSync(root)) || !inside(canonicalRoot, fs.realpathSync(path.join(root, 'frames')))) fail('INVALID_OUTPUT_PATH');
  const hash = sdk.hashBitmap(bitmap);
  const feed = buildOutputFeed(config, app, result, bitmap);
  const frameFile = path.join(root, 'frames', `${hash}.bin`);
  if (fs.existsSync(frameFile)) {
    if (sdk.hashBitmap(readBounded(root, `frames/${hash}.bin`, sdk.FRAME_BYTES)) !== hash) fail('INVALID_OUTPUT_FRAME');
  } else writeAtomic(frameFile, bitmap);
  writeAtomic(path.join(root, 'preview.png'), sdk.bitmapToPng(bitmap));
  // The feed is the commit point. It is replaced only after the complete immutable frame exists.
  writeAtomic(path.join(root, 'feed.json'), JSON.stringify(feed));
  const frames = fs.readdirSync(path.join(root, 'frames')).filter(name => /^[a-f0-9]{64}\.bin$/.test(name))
    .map(name => ({ name, modified: fs.lstatSync(path.join(root, 'frames', name)).mtimeMs }))
    .sort((a, b) => b.modified - a.modified);
  const keep = new Set([`${hash}.bin`, ...frames.filter(frame => frame.name !== `${hash}.bin`).slice(0, app.retainFrames - 1).map(frame => frame.name)]);
  for (const frame of frames) if (!keep.has(frame.name)) fs.unlinkSync(path.join(root, 'frames', frame.name));
  return feed;
}

module.exports = { writeAtomic, readBounded, lockDirectory, appDirectory, readAppDirectory, ensureAppDirectory, feedUrl, assertOutputPolicy, buildOutputFeed, readOutput, publish };
