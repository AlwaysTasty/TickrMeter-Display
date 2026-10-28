#!/usr/bin/env node
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const sdk = require('..');

// Public synthetic data only. The customer's HTTPS reverse proxy terminates TLS.
// This listener never provisions a host, installs a tunnel or changes a device.
function createPublicDisplayServer({ directory }) {
  const root = fs.realpathSync(directory);
  const read = (name, maxBytes) => {
    const filename = fs.realpathSync(path.join(root, name));
    const relative = path.relative(root, filename);
    if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error('Invalid output file.');
    const descriptor = fs.openSync(filename, 'r');
    try {
      const stat = fs.fstatSync(descriptor);
      if (!stat.isFile() || stat.size < 1 || stat.size > maxBytes) throw new Error('Invalid output size.');
      // Bound allocation even if a writer changes a file during a request.
      const buffer = Buffer.alloc(stat.size);
      let offset = 0;
      while (offset < buffer.length) {
        const count = fs.readSync(descriptor, buffer, offset, buffer.length - offset, offset);
        if (!count) throw new Error('Incomplete output file.');
        offset += count;
      }
      return buffer;
    } finally { fs.closeSync(descriptor); }
  };
  return http.createServer((request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cache-Control', 'no-store');
    const empty = (status, headers = {}) => { response.writeHead(status, { ...headers, 'Content-Length': '0' }); response.end(); };
    if (!['GET', 'HEAD'].includes(request.method)) { empty(405, { Allow: 'GET, HEAD' }); return; }
    let body;
    let type;
    try {
      if (request.url === '/feed.json') {
        body = read('feed.json', 2048);
        sdk.validateFeed(body);
        type = 'application/json';
      } else if (/^\/frames\/[a-f0-9]{64}\.bin$/.test(request.url)) {
        body = read(request.url.slice(1), sdk.FRAME_BYTES);
        sdk.validateBitmap(body);
        if (sdk.hashBitmap(body) !== request.url.slice('/frames/'.length, -4)) throw new Error('Mismatched frame.');
        type = 'application/octet-stream';
      } else { empty(404); return; }
    } catch { empty(404); return; }
    // The firmware rejects chunking and compression: preserve these headers at
    // the proxy as well. HEAD carries the GET length without its body.
    response.writeHead(200, { 'Content-Type': type, 'Content-Length': String(body.length) });
    response.end(request.method === 'HEAD' ? undefined : body);
  });
}

if (require.main === module) {
  try {
    const port = Number(process.env.PORT || 8080);
    if (!Number.isInteger(port) || port < 1024 || port > 65535 || process.argv.length !== 3) throw new Error('Usage: node examples/public-server.js ./display-output; optional PORT 1024–65535. Use synthetic or explicitly public data only.');
    const server = createPublicDisplayServer({ directory: process.argv[2] });
    server.on('error', () => { process.stderr.write('Could not start the public sample listener.\n'); process.exitCode = 1; });
    server.listen(port, '127.0.0.1', () => process.stdout.write(`Public sample listener on loopback port ${port}. Configure approved HTTPS hosting; schedule the generator separately.\n`));
  } catch { process.stderr.write('Could not start the public sample listener. Check output directory and optional PORT 1024–65535.\n'); process.exitCode = 1; }
}

module.exports = { createPublicDisplayServer };
