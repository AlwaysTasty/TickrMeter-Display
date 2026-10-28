#!/usr/bin/env node
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { timingSafeEqual } = require('node:crypto');

// Loopback HTTP behind a customer-operated HTTPS reverse proxy. This example
// never provisions devices, fetches remote URLs, or logs request headers/paths.
function createDisplayServer({ directory, token }) {
  if (typeof token !== 'string' || token.length < 32 || token.length > 128 || !/^[A-Za-z0-9_-]+$/.test(token)) throw new Error('Supply a 32–128 character URL-safe display read token through the environment.');
  const expected = Buffer.from(`Bearer ${token}`);
  const root = path.resolve(directory);
  return http.createServer((request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cache-Control', 'no-store');
    const received = Buffer.from(request.headers.authorization || '');
    if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
      response.writeHead(401, { 'WWW-Authenticate': 'Bearer' });
      response.end(); return;
    }
    if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405, { Allow: 'GET, HEAD' }); response.end(); return; }
    const target = request.url;
    let filename;
    let contentType;
    if (target === '/feed.json') { filename = 'feed.json'; contentType = 'application/json; charset=utf-8'; }
    else if (target === '/preview.png') { filename = 'preview.png'; contentType = 'image/png'; }
    else if (/^\/frames\/[a-f0-9]{64}\.bin$/.test(target)) { filename = target.slice(1); contentType = 'application/octet-stream'; }
    else { response.writeHead(404); response.end(); return; }
    // Only fixed files and a restricted hash are accepted; no path traversal.
    let body;
    try { body = fs.readFileSync(path.join(root, filename)); } catch { response.writeHead(404); response.end(); return; }
    response.writeHead(200, { 'Content-Type': contentType, 'Content-Length': body.length });
    response.end(request.method === 'HEAD' ? undefined : body);
  });
}

if (require.main === module) {
  try {
    const port = Number(process.env.PORT || 8080);
    if (!Number.isInteger(port) || port < 1024 || port > 65535 || process.argv.length !== 3) throw new Error('Usage: DISPLAY_READ_TOKEN=<secret> node examples/server.js ./display-output; optional PORT 1024–65535.');
    const server = createDisplayServer({ directory: process.argv[2], token: process.env.DISPLAY_READ_TOKEN });
    server.on('error', () => { process.stderr.write('Could not start the local example server.\n'); process.exitCode = 1; });
    server.listen(port, '127.0.0.1', () => process.stdout.write(`Example server listening on loopback port ${port}. Configure your HTTPS reverse proxy before external delivery.\n`));
  } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}

module.exports = { createDisplayServer };
