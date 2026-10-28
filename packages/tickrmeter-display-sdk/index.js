'use strict';

const { createHash } = require('node:crypto');
const { isIP } = require('node:net');
const feedSchema = require('./schemas/feed.schema.json');

const { WIDTH, HEIGHT, FRAME_BYTES, MAX_FEED_BYTES, MAX_URL_BYTES, FORMAT, LED_COLORS } = require('./constants');

class DisplayValidationError extends Error {
  constructor(code, field) {
    super(`${code}: ${field}`);
    this.name = 'DisplayValidationError';
    this.code = code;
    this.field = field;
  }
}
const fail = (code, field) => { throw new DisplayValidationError(code, field); };
const bytes = value => value instanceof Uint8Array || value instanceof Uint8ClampedArray;
const exactKeys = (value, keys, field) => {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail('INVALID_OBJECT', field);
  const own = Reflect.ownKeys(value);
  if (own.length !== keys.length || own.some(key => !keys.includes(key)) ||
      keys.some(key => !Object.hasOwn(value, key))) fail('INVALID_FIELDS', field);
  if (keys.some(key => !Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value'))) fail('INVALID_OBJECT', field);
};

// No networking takes place here. A syntactically public host may still resolve
// to a private address; the client performing retrieval must validate DNS too.
function validateSourceUrl(value) {
  if (typeof value !== 'string' || !/^https:\/\/[^/]/i.test(value) || Buffer.byteLength(value, 'utf8') > MAX_URL_BYTES ||
      /[\s\u0000-\u001f\u007f\\]/u.test(value)) fail('INVALID_URL', 'url');
  let parsed;
  try { parsed = new URL(value); } catch { fail('INVALID_URL', 'url'); }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash ||
      value.includes('?') || value.includes('#')) fail('INVALID_URL', 'url');
  const host = parsed.hostname.toLowerCase();
  if (isIP(host) || host.includes(':') || host.length > 253 || host.endsWith('.') || !host.includes('.') ||
      /(?:^|\.)(?:localhost|local|localdomain|internal|intranet|lan|home|arpa|corp|private|test|invalid|example|onion)$/i.test(host) ||
      !host.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) ||
      !/^(?:[a-z]{2,63}|xn--[a-z0-9-]{2,59})$/.test(host.split('.').at(-1))) fail('INVALID_HOST', 'url');
  if (Buffer.byteLength(parsed.href, 'utf8') > MAX_URL_BYTES) fail('INVALID_URL', 'url');
  return parsed.href;
}

function privateNetwork(options, keys = ['network']) {
  if (!options || typeof options !== 'object' || Array.isArray(options) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(options)) ||
      Reflect.ownKeys(options).length !== keys.length ||
      keys.some(key => !Object.hasOwn(options, key) || !Object.hasOwn(Object.getOwnPropertyDescriptor(options, key), 'value'))) fail('INVALID_OPTIONS', 'options');
  if (!['lan', 'internet'].includes(options.network)) fail('INVALID_NETWORK', 'network');
  return options.network;
}

const privateIPv4 = ([a, b]) => a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
const specialIPv4 = ([a, b, c]) => a === 0 || a === 127 || a >= 224 ||
  (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
  (a === 192 && ((b === 0 && (c === 0 || c === 2)) || (b === 88 && c === 99))) ||
  (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
  (a === 203 && b === 0 && c === 113);

// Host-side policy only: the retrieving client must apply this to the actual
// connected peer, not just an earlier DNS answer. No DNS/network access occurs.
function validatePrivateDestinationAddress(address, options) {
  const network = privateNetwork(options);
  if (typeof address !== 'string' || isIP(address) !== 4) fail('INVALID_DESTINATION', 'address');
  const octets = address.split('.').map(Number);
  if (network === 'lan' ? !privateIPv4(octets) : privateIPv4(octets) || specialIPv4(octets)) fail('INVALID_DESTINATION', 'address');
  return address;
}

// Explicit opt-in for future private-feed hosts; public defaults above remain
// unchanged. DNS names are syntax-checked only, never proof of LAN reachability.
function validatePrivateSourceUrl(value, options) {
  const network = privateNetwork(options);
  if (network === 'internet') return validateSourceUrl(value);
  if (typeof value !== 'string' || !/^https:\/\/[^/]/i.test(value) || Buffer.byteLength(value, 'utf8') > MAX_URL_BYTES ||
      /[\s\u0000-\u001f\u007f\\]/u.test(value)) fail('INVALID_URL', 'url');
  let parsed;
  try { parsed = new URL(value); } catch { fail('INVALID_URL', 'url'); }
  const authority = /^https:\/\/([^/?#]*)/i.exec(value)?.[1] || '';
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || authority.includes('@') ||
      parsed.search || parsed.hash || value.includes('?') || value.includes('#')) fail('INVALID_URL', 'url');
  const host = parsed.hostname.toLowerCase();
  const rawHost = authority.replace(/:\d*$/, '').toLowerCase();
  if (isIP(host) === 4) {
    // WHATWG URL accepts shorthand, octal, hex and percent-encoded addresses.
    // Firmware and host must agree on exactly the same dotted-decimal literal.
    if (rawHost !== host || !privateIPv4(host.split('.').map(Number))) fail('INVALID_HOST', 'url');
  } else if (host.includes(':') || host.length > 253 || host.endsWith('.') || rawHost !== host ||
      /(?:^|\.)localhost$/i.test(host) ||
      !host.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) fail('INVALID_HOST', 'url');
  if (Buffer.byteLength(parsed.href, 'utf8') > MAX_URL_BYTES) fail('INVALID_URL', 'url');
  return parsed.href;
}

function validateBitmap(value) {
  if (!bytes(value) || value.length !== FRAME_BYTES) fail('INVALID_BITMAP', 'bitmap');
  return Buffer.from(value);
}
const hashBitmap = value => createHash('sha256').update(validateBitmap(value)).digest('hex');

function encodeRGBA(rgba, options = {}) {
  if (!bytes(rgba) || rgba.length !== WIDTH * HEIGHT * 4) fail('INVALID_RGBA', 'rgba');
  if (!options || typeof options !== 'object' || Array.isArray(options) ||
      Object.keys(options).some(key => key !== 'threshold')) fail('INVALID_OPTIONS', 'options');
  const threshold = options.threshold === undefined ? 128 : options.threshold;
  if (typeof threshold !== 'number' || !Number.isFinite(threshold) || threshold < 0 || threshold > 255) fail('INVALID_THRESHOLD', 'threshold');
  const output = Buffer.alloc(FRAME_BYTES);
  for (let pixel = 0; pixel < WIDTH * HEIGHT; pixel++) {
    const offset = pixel * 4;
    const alpha = rgba[offset + 3] / 255;
    const brightness = (rgba[offset] + rgba[offset + 1] + rgba[offset + 2]) / 3 * alpha + 255 * (1 - alpha);
    if (brightness > threshold) output[pixel >> 3] |= 1 << (7 - pixel % 8);
  }
  return output;
}

function decodeRGBA(bitmap) {
  const source = validateBitmap(bitmap);
  const output = Buffer.alloc(WIDTH * HEIGHT * 4);
  for (let pixel = 0; pixel < WIDTH * HEIGHT; pixel++) {
    const color = source[pixel >> 3] & (1 << (7 - pixel % 8)) ? 255 : 0;
    output.fill(color, pixel * 4, pixel * 4 + 3);
    output[pixel * 4 + 3] = 255;
  }
  return output;
}

function validateObservedAt(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) fail('INVALID_DATE', 'observedAt');
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== (value.includes('.') ? value : value.replace('Z', '.000Z'))) fail('INVALID_DATE', 'observedAt');
  return value;
}

function validateLed(value) {
  exactKeys(value, ['color', 'mode'], 'led');
  if (!LED_COLORS.includes(value.color) || !['solid', 'off'].includes(value.mode) ||
      (value.color === 'off') !== (value.mode === 'off')) fail('INVALID_LED', 'led');
  return { color: value.color, mode: value.mode };
}

// JSON.parse alone silently accepts duplicate keys. Reject them so a firmware
// parser cannot see a different frame or LED state from the server validator.
function parseFeedJson(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > MAX_FEED_BYTES) fail('FEED_TOO_LARGE', 'feed');
  let offset = 0;
  const whitespace = () => { while (/[\x20\t\r\n]/.test(text[offset] || '\0')) offset++; };
  const string = () => {
    const start = offset++;
    while (offset < text.length) {
      if (text[offset] === '\\') { offset += 2; continue; }
      if (text[offset++] === '"') return JSON.parse(text.slice(start, offset));
    }
    fail('INVALID_JSON', 'feed');
  };
  const value = depth => {
    if (depth > 8) fail('INVALID_JSON', 'feed');
    whitespace();
    if (text[offset] === '"') return string();
    if (text[offset] === '{' || text[offset] === '[') {
      const object = text[offset++] === '{';
      const closing = object ? '}' : ']';
      const keys = new Set();
      whitespace();
      if (text[offset] === closing) { offset++; return; }
      while (offset < text.length) {
        if (object) {
          whitespace();
          if (text[offset] !== '"') fail('INVALID_JSON', 'feed');
          const key = string();
          if (keys.has(key)) fail('DUPLICATE_FIELD', 'feed');
          keys.add(key);
          whitespace();
          if (text[offset++] !== ':') fail('INVALID_JSON', 'feed');
        }
        value(depth + 1);
        whitespace();
        if (text[offset] === closing) { offset++; return; }
        if (text[offset++] !== ',') fail('INVALID_JSON', 'feed');
      }
      fail('INVALID_JSON', 'feed');
    }
    const token = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(text.slice(offset));
    if (!token) fail('INVALID_JSON', 'feed');
    offset += token[0].length;
  };
  try {
    value(0);
    whitespace();
    if (offset !== text.length) fail('INVALID_JSON', 'feed');
    return JSON.parse(text);
  } catch (error) {
    if (error instanceof DisplayValidationError) throw error;
    fail('INVALID_JSON', 'feed');
  }
}

function validateFeedWithSource(input, options, validateUrl) {
  let value = input;
  if (bytes(value)) {
    if (value.length > MAX_FEED_BYTES) fail('FEED_TOO_LARGE', 'feed');
    try { value = new TextDecoder('utf-8', { fatal: true }).decode(value); } catch { fail('INVALID_JSON', 'feed'); }
  }
  if (typeof value === 'string') value = parseFeedJson(value);
  exactKeys(value, ['v', 'frame', 'observedAt', 'led'], 'feed');
  if (value.v !== 1) fail('UNSUPPORTED_VERSION', 'v');
  exactKeys(value.frame, ['url', 'sha256', 'format'], 'frame');
  if (value.frame.format !== FORMAT) fail('UNSUPPORTED_FORMAT', 'frame.format');
  if (typeof value.frame.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.frame.sha256)) fail('INVALID_HASH', 'frame.sha256');
  const frameUrl = validateUrl(value.frame.url);
  if (!options || typeof options !== 'object' || Array.isArray(options) ||
      Object.keys(options).some(key => key !== 'feedUrl')) fail('INVALID_OPTIONS', 'options');
  if (options.feedUrl !== undefined && new URL(validateUrl(options.feedUrl)).origin !== new URL(frameUrl).origin) fail('ORIGIN_MISMATCH', 'frame.url');
  const result = { v: 1, frame: { url: frameUrl, sha256: value.frame.sha256, format: FORMAT },
    observedAt: validateObservedAt(value.observedAt), led: validateLed(value.led) };
  if (Buffer.byteLength(JSON.stringify(result), 'utf8') > MAX_FEED_BYTES) fail('FEED_TOO_LARGE', 'feed');
  return result;
}

function validateFeed(input, options = {}) {
  return validateFeedWithSource(input, options, validateSourceUrl);
}

function validatePrivateFeed(input, options) {
  const network = privateNetwork(options, ['network', 'feedUrl']);
  const feedUrl = validatePrivateSourceUrl(options.feedUrl, { network });
  return validateFeedWithSource(input, { feedUrl }, url => validatePrivateSourceUrl(url, { network }));
}

function buildFeed({ bitmap, frameUrl, observedAt, led = { color: 'off', mode: 'off' }, feedUrl } = {}) {
  return validateFeed({ v: 1, frame: { url: frameUrl, sha256: hashBitmap(bitmap), format: FORMAT }, observedAt, led }, { feedUrl });
}

function buildPrivateFeed({ bitmap, frameUrl, observedAt, led = { color: 'off', mode: 'off' }, feedUrl, network } = {}) {
  return validatePrivateFeed({ v: 1, frame: { url: frameUrl, sha256: hashBitmap(bitmap), format: FORMAT }, observedAt, led }, { feedUrl, network });
}

module.exports = { WIDTH, HEIGHT, FRAME_BYTES, MAX_FEED_BYTES, MAX_URL_BYTES, FORMAT, LED_COLORS,
  DisplayValidationError, validateSourceUrl, validateBitmap, hashBitmap, encodeRGBA, decodeRGBA,
  validateFeed, buildFeed, validatePrivateSourceUrl, validatePrivateDestinationAddress, validatePrivateFeed, buildPrivateFeed, schemas: { feed: feedSchema },
  bitmapToPng: bitmap => require('./lib/png').encodePng(decodeRGBA(bitmap)),
  pngToBitmap: (png, options) => encodeRGBA(require('./lib/png').decodePng(png), options) };
