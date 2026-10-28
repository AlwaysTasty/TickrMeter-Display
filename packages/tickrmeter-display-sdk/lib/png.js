'use strict';

const { deflateSync, inflateSync } = require('node:zlib');
const { WIDTH, HEIGHT, DisplayValidationError } = require('..');
const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const fail = code => { throw new DisplayValidationError(code, 'png'); };
const crcTable = Array.from({ length: 256 }, (_, i) => {
  let value = i;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
const crc32 = input => {
  let value = 0xffffffff;
  for (const byte of input) value = crcTable[(value ^ byte) & 255] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const output = Buffer.alloc(12 + data.length);
  output.writeUInt32BE(data.length, 0);
  output.write(type, 4, 4, 'ascii');
  data.copy(output, 8);
  output.writeUInt32BE(crc32(output.subarray(4, -4)), output.length - 4);
  return output;
};

function encodePng(rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(WIDTH, 0);
  ihdr.writeUInt32BE(HEIGHT, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const rows = Buffer.alloc(HEIGHT * (1 + WIDTH * 4));
  for (let y = 0; y < HEIGHT; y++) rgba.copy(rows, y * (1 + WIDTH * 4) + 1, y * WIDTH * 4, (y + 1) * WIDTH * 4);
  return Buffer.concat([SIGNATURE, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}

function decodePng(input) {
  if (!(input instanceof Uint8Array) || input.length > 1048576) fail('INVALID_PNG');
  const data = Buffer.from(input);
  if (!data.subarray(0, 8).equals(SIGNATURE)) fail('INVALID_PNG');
  let offset = 8;
  let header;
  let palette;
  let alpha;
  let ended = false;
  let imageEnded = false;
  const idats = [];
  while (offset < data.length) {
    if (offset + 12 > data.length) fail('INVALID_PNG');
    const length = data.readUInt32BE(offset);
    if (length > data.length - offset - 12) fail('INVALID_PNG');
    const type = data.toString('ascii', offset + 4, offset + 8);
    const payload = data.subarray(offset + 8, offset + 8 + length);
    if (crc32(data.subarray(offset + 4, offset + 8 + length)) !== data.readUInt32BE(offset + 8 + length)) fail('PNG_CHECKSUM_MISMATCH');
    if (!header && type !== 'IHDR') fail('INVALID_PNG');
    if (idats.length && type !== 'IDAT') imageEnded = true;
    if (type === 'IHDR') {
      if (header || length !== 13) fail('INVALID_PNG');
      header = payload;
      if (header.readUInt32BE(0) !== WIDTH || header.readUInt32BE(4) !== HEIGHT) fail('PNG_DIMENSIONS_INVALID');
      if (header[8] !== 8 || ![0, 2, 3, 4, 6].includes(header[9]) || header[10] || header[11] || header[12]) fail('PNG_FORMAT_UNSUPPORTED');
    } else if (type === 'PLTE') {
      if (palette || idats.length || !length || length % 3 || length > 768 || [0, 4].includes(header[9])) fail('INVALID_PNG');
      palette = payload;
    } else if (type === 'tRNS') {
      if (alpha || idats.length || header[9] !== 3 || !palette || length > palette.length / 3) fail('PNG_FORMAT_UNSUPPORTED');
      alpha = payload;
    } else if (type === 'IDAT') {
      if (imageEnded || (header[9] === 3 && !palette)) fail('INVALID_PNG');
      idats.push(payload);
    } else if (type === 'IEND') {
      if (length || !idats.length || offset + 12 !== data.length) fail('INVALID_PNG');
      ended = true;
    } else if (!/^[a-z][A-Za-z]{3}$/.test(type) || type === 'acTL' || type === 'fcTL' || type === 'fdAT') {
      fail('PNG_FORMAT_UNSUPPORTED');
    }
    offset += length + 12;
  }
  if (!ended) fail('INVALID_PNG');
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[header[9]];
  const stride = WIDTH * channels;
  let rows;
  try { rows = inflateSync(Buffer.concat(idats), { maxOutputLength: HEIGHT * (stride + 1) }); } catch { fail('INVALID_PNG_DATA'); }
  if (rows.length !== HEIGHT * (stride + 1)) fail('INVALID_PNG_DATA');
  const pixels = Buffer.alloc(HEIGHT * stride);
  const paeth = (left, up, upperLeft) => {
    const p = left + up - upperLeft;
    const a = Math.abs(p - left), b = Math.abs(p - up), c = Math.abs(p - upperLeft);
    return a <= b && a <= c ? left : b <= c ? up : upperLeft;
  };
  for (let y = 0; y < HEIGHT; y++) {
    const filter = rows[y * (stride + 1)];
    if (filter > 4) fail('PNG_FILTER_INVALID');
    for (let x = 0; x < stride; x++) {
      const i = y * stride + x;
      const left = x >= channels ? pixels[i - channels] : 0;
      const up = y > 0 ? pixels[i - stride] : 0;
      const corner = y > 0 && x >= channels ? pixels[i - stride - channels] : 0;
      const predictor = [0, left, up, Math.floor((left + up) / 2), paeth(left, up, corner)][filter];
      pixels[i] = (rows[y * (stride + 1) + 1 + x] + predictor) & 255;
    }
  }
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  for (let i = 0; i < WIDTH * HEIGHT; i++) {
    const color = header[9];
    const position = i * channels;
    if (color === 3 && pixels[position] >= palette.length / 3) fail('INVALID_PNG_DATA');
    for (let channel = 0; channel < 3; channel++) rgba[i * 4 + channel] = color === 3 ? palette[pixels[position] * 3 + channel] : pixels[position + ([0, 4].includes(color) ? 0 : channel)];
    rgba[i * 4 + 3] = color === 3 ? (alpha?.[pixels[position]] ?? 255) : color === 4 ? pixels[position + 1] : color === 6 ? pixels[position + 3] : 255;
  }
  return rgba;
}

module.exports = { encodePng, decodePng };
