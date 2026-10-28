'use strict';

const fs = require('node:fs');
const path = require('node:path');
const sdk = require('../../tickrmeter-display-sdk');

class RunnerError extends Error {
  constructor(code) { super(code); this.name = 'RunnerError'; this.code = code; }
}
const fail = code => { throw new RunnerError(code); };
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const integer = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;
const inside = (root, file) => {
  const relative = path.relative(root, file);
  return relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
};
function keys(value, allowed) {
  if (!object(value) || Object.keys(value).some(key => !allowed.includes(key))) fail('INVALID_CONFIG');
}
function readJson(filename, maxBytes = 65536) {
  const stat = fs.statSync(filename);
  if (!stat.isFile() || stat.size > maxBytes) fail('INVALID_FILE');
  return JSON.parse(fs.readFileSync(filename, 'utf8'));
}
function isPlaceholderOrigin(origin) {
  const host = new URL(origin).hostname;
  return /(^|\.)(example\.com|example\.org|example\.net)$/.test(host);
}
function loadConfig(filename) {
  try {
    const configPath = fs.realpathSync(path.resolve(filename));
    const base = path.dirname(configPath);
    const value = readJson(configPath);
    const privateMode = value.version === 2;
    keys(value, privateMode
      ? ['version', 'mode', 'network', 'baseUrl', 'bindAddress', 'tls', 'credentialsFile', 'outputDir', 'port', 'apps']
      : ['version', 'publicBaseUrl', 'acknowledgePublicData', 'outputDir', 'port', 'apps']);
    if ((!privateMode && value.version !== 1) || (value.acknowledgePublicData !== undefined && typeof value.acknowledgePublicData !== 'boolean')) fail('INVALID_CONFIG');
    if (privateMode && (value.mode !== 'private' || !['lan', 'internet'].includes(value.network))) fail('INVALID_PRIVATE_CONFIG');
    const publicBaseUrl = privateMode ? sdk.validatePrivateSourceUrl(value.baseUrl, { network: value.network })
      : sdk.validateSourceUrl(value.publicBaseUrl || 'https://display.example.com');
    if (new URL(publicBaseUrl).pathname !== '/') fail(privateMode ? 'INVALID_PRIVATE_ORIGIN' : 'INVALID_PUBLIC_ORIGIN');
    const origin = new URL(publicBaseUrl).origin;
    const port = value.port === undefined ? 8787 : value.port;
    if (!integer(port, 1024, 65535)) fail('INVALID_PORT');
    if (typeof value.outputDir !== 'string' || !value.outputDir.trim()) fail('INVALID_OUTPUT_DIRECTORY');
    const outputDir = path.resolve(base, value.outputDir);
    if (outputDir === path.parse(outputDir).root || outputDir === base) fail('INVALID_OUTPUT_DIRECTORY');
    let privateSettings;
    if (privateMode) {
      // Binding to a specific interface is deliberate. Never silently listen on all interfaces.
      if (value.network === 'lan') sdk.validatePrivateDestinationAddress(value.bindAddress, { network: 'lan' });
      else if (value.bindAddress !== '127.0.0.1') fail('INVALID_PRIVATE_BIND');
      keys(value.tls, ['certificateFile', 'keyFile']);
      const localFile = name => {
        if (typeof name !== 'string' || !name.trim() || name.length > 4096 || /[\r\n\0]/.test(name)) fail('INVALID_PRIVATE_FILE');
        const filename = path.resolve(base, name);
        if (filename === outputDir || inside(outputDir, filename)) fail('INVALID_PRIVATE_FILE');
        return filename;
      };
      privateSettings = { mode: 'private', network: value.network, bindAddress: value.bindAddress,
        credentialsFile: localFile(value.credentialsFile),
        tls: Object.freeze({ certificateFile: localFile(value.tls.certificateFile), keyFile: localFile(value.tls.keyFile) }) };
      if (new Set([privateSettings.credentialsFile, ...Object.values(privateSettings.tls)]).size !== 3) fail('INVALID_PRIVATE_FILE');
    }
    if (!Array.isArray(value.apps) || value.apps.length < 1 || value.apps.length > 32) fail('INVALID_APPS');
    const ids = new Set();
    const apps = value.apps.map(app => {
      keys(app, ['id', 'module', 'intervalSeconds', 'timeoutSeconds', 'staleAfterSeconds', 'retainFrames', 'secrets']);
      if (typeof app.id !== 'string' || !/^[a-z][a-z0-9-]{0,39}$/.test(app.id) || ids.has(app.id)) fail('INVALID_APP_ID');
      ids.add(app.id);
      if (typeof app.module !== 'string' || !app.module.startsWith('./') || !/\.(?:cjs|mjs|js)$/.test(app.module)) fail('INVALID_APP_MODULE');
      const modulePath = fs.realpathSync(path.resolve(base, app.module));
      if (!inside(base, modulePath) || !fs.statSync(modulePath).isFile()) fail('INVALID_APP_MODULE');
      const intervalSeconds = app.intervalSeconds ?? 300;
      const timeoutSeconds = app.timeoutSeconds ?? 20;
      const staleAfterSeconds = app.staleAfterSeconds ?? Math.max(intervalSeconds * 3, 180);
      const retainFrames = app.retainFrames ?? 3;
      if (!integer(intervalSeconds, 60, 86400) || !integer(timeoutSeconds, 1, Math.min(intervalSeconds, 300)) ||
          !integer(staleAfterSeconds, intervalSeconds, 604800) || !integer(retainFrames, 2, 32)) fail('INVALID_APP_TIMING');
      const secrets = app.secrets ?? {};
      if (!object(secrets) || Object.keys(secrets).length > 32 || Object.entries(secrets).some(([key, env]) =>
        !/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(key) || typeof env !== 'string' || !/^[A-Z][A-Z0-9_]{0,127}$/.test(env))) fail('INVALID_SECRET_MAPPING');
      return Object.freeze({ id: app.id, modulePath, intervalSeconds, timeoutSeconds, staleAfterSeconds, retainFrames, secrets: Object.freeze({ ...secrets }) });
    });
    return Object.freeze({ configPath, outputDir, publicBaseUrl: origin, acknowledgePublicData: value.acknowledgePublicData === true,
      placeholderOrigin: isPlaceholderOrigin(origin), port, apps: Object.freeze(apps), ...(privateSettings || {}) });
  } catch (error) {
    if (error instanceof RunnerError) throw error;
    fail('CONFIG_UNREADABLE_OR_INVALID');
  }
}

module.exports = { RunnerError, fail, inside, readJson, loadConfig, isPlaceholderOrigin };
