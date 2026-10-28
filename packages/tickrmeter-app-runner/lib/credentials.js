'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomBytes, createHash, timingSafeEqual } = require('node:crypto');
const { fail, inside } = require('./config');
const { writeAtomic } = require('./storage');
const { ensureProtectedDirectory, assertProtected, protectNewFile, readPrivateFile } = require('./private-files');
const MAX_CREDENTIALS = 256;
const MAX_STORE_BYTES = 131072;
const LABEL = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;
const TOKEN = /^tmr_[A-Za-z0-9_-]{43}$/;
const hashToken = token => createHash('sha256').update(token, 'ascii').digest();
function readCredentials(config, { missingAllowed = false, checkPermissions = true } = {}) {
  if (config.mode !== 'private') fail('PRIVATE_CONFIG_REQUIRED');
  try {
    if (!fs.existsSync(config.credentialsFile) && missingAllowed) return { version: 1, credentials: [] };
    const value = JSON.parse(readPrivateFile(config.credentialsFile, MAX_STORE_BYTES, checkPermissions));
    if (!value || value.version !== 1 || Object.keys(value).some(key => !['version', 'credentials'].includes(key)) ||
        !Array.isArray(value.credentials) || value.credentials.length > MAX_CREDENTIALS) fail('INVALID_CREDENTIAL_STORE');
    const ids = new Set(); const hashes = new Set();
    for (const record of value.credentials) {
      if (!record || typeof record !== 'object' || Array.isArray(record) || Object.keys(record).some(key => !['id', 'appId', 'deviceId', 'tokenHash', 'createdAt', 'revokedAt'].includes(key)) ||
          typeof record.id !== 'string' || !LABEL.test(record.id) || typeof record.deviceId !== 'string' || !LABEL.test(record.deviceId) || !config.apps.some(app => app.id === record.appId) ||
          typeof record.tokenHash !== 'string' || !/^[a-f0-9]{64}$/.test(record.tokenHash) ||
          typeof record.createdAt !== 'string' || !Number.isFinite(Date.parse(record.createdAt)) ||
          (record.revokedAt !== null && (typeof record.revokedAt !== 'string' || !Number.isFinite(Date.parse(record.revokedAt)))) ||
          ids.has(record.id) || hashes.has(record.tokenHash)) fail('INVALID_CREDENTIAL_STORE');
      ids.add(record.id); hashes.add(record.tokenHash);
    }
    return value;
  } catch (error) {
    if (error.code === 'PRIVATE_FILE_PERMISSIONS') throw error;
    fail('INVALID_CREDENTIAL_STORE');
  }
}
function credentialSummary(config) {
  const value = readCredentials(config);
  return value.credentials.map(({ id, appId, deviceId, revokedAt }) => ({ id, appId, deviceId, revoked: revokedAt !== null }));
}
function authorize(config, request, appId) {
  // Duplicate, noncanonical, query and cookie credentials are never accepted.
  const headers = request.rawHeaders || [];
  let count = 0;
  for (let index = 0; index < headers.length; index += 2) if (headers[index].toLowerCase() === 'authorization') count += 1;
  const authorization = request.headers.authorization;
  if (count !== 1 || typeof authorization !== 'string' || !authorization.startsWith('Bearer ')) return null;
  const token = authorization.slice(7);
  if (!TOKEN.test(token) || Buffer.from(token.slice(4), 'base64url').toString('base64url') !== token.slice(4)) return null;
  const digest = hashToken(token);
  try {
    // Reload every request, including HEAD: revocation takes effect without restarting. Parent ACL was checked at listener startup.
    const records = readCredentials(config, { checkPermissions: process.platform !== 'win32' }).credentials;
    let match = null;
    for (const record of records) {
      const equal = timingSafeEqual(digest, Buffer.from(record.tokenHash, 'hex'));
      if (equal && record.appId === appId && record.revokedAt === null) match = record.id;
    }
    return match;
  } catch { return null; }
}
function changeCredential(config, operation, { id, appId, deviceId, tokenFile } = {}) {
  if (config.mode !== 'private') fail('PRIVATE_CONFIG_REQUIRED');
  if (!['add', 'rotate', 'revoke'].includes(operation) || typeof id !== 'string' || !LABEL.test(id)) fail('INVALID_CREDENTIAL_ARGUMENTS');
  const parent = path.dirname(config.credentialsFile);
  ensureProtectedDirectory(parent);
  const lock = `${config.credentialsFile}.lock`;
  let descriptor;
  try { descriptor = fs.openSync(lock, 'wx', 0o600); } catch { fail('CREDENTIAL_STORE_LOCKED'); }
  let tokenPath; let wroteToken = false;
  try {
    const store = readCredentials(config, { missingAllowed: operation === 'add' });
    let record = store.credentials.find(value => value.id === id);
    if (operation === 'add') {
      if (record || store.credentials.length >= MAX_CREDENTIALS || typeof deviceId !== 'string' || !LABEL.test(deviceId) ||
          !config.apps.some(app => app.id === appId) || store.credentials.some(value => value.appId === appId && value.deviceId === deviceId && value.revokedAt === null)) fail('INVALID_CREDENTIAL_ARGUMENTS');
      record = { id, appId, deviceId, tokenHash: '', createdAt: new Date().toISOString(), revokedAt: null };
      store.credentials.push(record);
    } else if (!record) fail('UNKNOWN_CREDENTIAL');
    if (operation === 'revoke') {
      if (tokenFile !== undefined || appId !== undefined || deviceId !== undefined) fail('INVALID_CREDENTIAL_ARGUMENTS');
      record.revokedAt = record.revokedAt || new Date().toISOString();
    } else {
      if (operation === 'rotate' && (appId !== undefined || deviceId !== undefined || record.revokedAt !== null)) fail('INVALID_CREDENTIAL_ARGUMENTS');
      if (typeof tokenFile !== 'string' || !tokenFile.trim() || /[\r\n\0]/.test(tokenFile)) fail('INVALID_TOKEN_FILE');
      tokenPath = path.resolve(tokenFile);
      const blocked = [config.credentialsFile, config.configPath, ...Object.values(config.tls), ...config.apps.map(app => app.modulePath)];
      if (blocked.includes(tokenPath) || tokenPath === config.outputDir || inside(config.outputDir, tokenPath) || fs.existsSync(tokenPath)) fail('INVALID_TOKEN_FILE');
      ensureProtectedDirectory(path.dirname(tokenPath));
      // The empty file receives its private ACL before any token bytes are written.
      const fd = fs.openSync(tokenPath, 'wx', 0o600);
      wroteToken = true;
      try {
        protectNewFile(tokenPath); assertProtected(tokenPath);
        const token = `tmr_${randomBytes(32).toString('base64url')}`;
        record.tokenHash = hashToken(token).toString('hex');
        record.createdAt = new Date().toISOString();
        fs.writeFileSync(fd, `${token}\n`); fs.fsyncSync(fd);
      } finally { fs.closeSync(fd); }
    }
    writeAtomic(config.credentialsFile, `${JSON.stringify(store, null, 2)}\n`);
    assertProtected(config.credentialsFile);
    return { id: record.id, appId: record.appId, deviceId: record.deviceId, revoked: record.revokedAt !== null,
      ...(operation !== 'revoke' ? { tokenWritten: true } : {}), deviceDeliverySupported: false };
  } catch (error) {
    if (wroteToken) { try { fs.unlinkSync(tokenPath); } catch {} }
    throw error;
  } finally { fs.closeSync(descriptor); fs.unlinkSync(lock); }
}

module.exports = { MAX_CREDENTIALS, readCredentials, authorize, changeCredential, credentialSummary };
