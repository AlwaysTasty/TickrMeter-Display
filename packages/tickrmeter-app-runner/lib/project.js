'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { fail } = require('./config');
const { readStatus } = require('./runtime');
const { credentialSummary } = require('./credentials');
const { loadPrivateTls } = require('./private-tls');
const { assertProtected } = require('./private-files');

function initProject(directory, template = 'clock') {
  if (!['clock', 'metric'].includes(template)) fail('UNKNOWN_TEMPLATE');
  const target = path.resolve(directory);
  if (target === path.parse(target).root) fail('INVALID_PROJECT_DIRECTORY');
  if (fs.existsSync(target) && (!fs.statSync(target).isDirectory() || fs.readdirSync(target).length)) fail('PROJECT_NOT_EMPTY');
  fs.mkdirSync(target, { recursive: true, mode: 0o700 });
  const config = { version: 1, publicBaseUrl: 'https://display.example.com', acknowledgePublicData: false,
    outputDir: './output', port: 8787, apps: [{ id: template, module: `./${template}.cjs`, intervalSeconds: 60,
      timeoutSeconds: 20, staleAfterSeconds: 180, retainFrames: 3, secrets: {} }] };
  fs.writeFileSync(path.join(target, `${template}.cjs`), fs.readFileSync(path.join(__dirname, '..', 'templates', `${template}.cjs`)), { flag: 'wx', mode: 0o600 });
  fs.writeFileSync(path.join(target, 'runner.json'), `${JSON.stringify(config, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  fs.writeFileSync(path.join(target, '.gitignore'), 'output/\nprivate-output/\nprivate/\n*.key\n*-token.txt\n.env\n.env.*\n', { flag: 'wx', mode: 0o600 });
  return { config: path.join(target, 'runner.json'), template, mode: 'local-preview' };
}

function doctor(config, now = Date.now()) {
  const status = readStatus(config, now);
  const privateMode = config.mode === 'private';
  const checks = privateMode ? [] : [
    { name: 'public-origin', ok: !config.placeholderOrigin, detail: config.placeholderOrigin ? 'Replace the example origin with approved public HTTPS hosting.' : 'A syntactically valid HTTPS origin is configured; reachability and TLS were not checked.' },
    { name: 'public-data-consent', ok: config.acknowledgePublicData,
      detail: config.acknowledgePublicData ? 'Feed and frames are public. No HTTP authentication is provided.' : 'Local previews only. HTTP feed and frame routes are disabled until public data is explicitly acknowledged.' }
  ];
  if (privateMode) {
    let tlsOk = false; let credentials;
    try { loadPrivateTls(config); tlsOk = true; } catch {}
    try { assertProtected(path.dirname(config.credentialsFile), true); credentials = credentialSummary(config); } catch {}
    checks.push({ name: 'private-tls', ok: tlsOk, detail: tlsOk
      ? 'The protected key and matching, unexpired certificate validate locally. Device trust and network reachability are unverified.'
      : 'Provide a protected TLS key and matching, unexpired certificate for the configured host. No HTTP fallback exists.' });
    checks.push({ name: 'private-credentials', ok: !!credentials && config.apps.every(app => credentials.some(record => record.appId === app.id && !record.revoked)),
      detail: 'Each output needs an active, dedicated device read credential. The store reloads on every request; token values are never reported.' });
  }
  for (const app of config.apps) {
    const missing = Object.entries(app.secrets).filter(([, env]) => !process.env[env]).map(([key]) => key);
    checks.push({ name: `${app.id}:secrets`, ok: !missing.length, detail: missing.length ? `Missing environment mappings: ${missing.join(', ')}.` : 'Required mapped environment variables are present.' });
    const current = status.apps.find(item => item.id === app.id);
    checks.push({ name: `${app.id}:output`, ok: !!current.observedAt && !current.error && !current.stale,
      detail: !current.observedAt ? 'Run once to generate a validated feed and preview.' : current.error ? 'The last collection or stored output needs attention. Check local status.' : current.stale ? 'The last observation is stale; generate genuinely fresh data.' : 'Stored feed and matching frame validate; the observation is fresh.' });
  }
  if (privateMode) return { version: 2, configuredForPublicDelivery: false, privateHostPrepared: checks.every(check => check.ok),
    deviceDeliverySupported: false, checks,
    next: 'Host preparation only. Current TickrMeter firmware cannot use protected feeds. Local secure pairing, certificate trust and authenticated device retrieval still need implementation and testing. Keep private previews local; do not upload them to the public-feed workflow.' };
  return { version: 1, configuredForPublicDelivery: checks.every(check => check.ok), checks,
    next: 'An agent must separately verify public HTTPS feed/frame retrieval, ongoing scheduling and device compatibility. Doctor does not provision hosting, connect accounts, or assign devices.' };
}

module.exports = { initProject, doctor };
