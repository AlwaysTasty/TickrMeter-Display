#!/usr/bin/env node
'use strict';

const path = require('node:path');
const sdk = require('..');
const { writeAtomic, parseArgs } = require('../lib/files');
const { renderEmailOpenRate } = require('./metric');

function generate({ out, baseUrl, opened = 162, delivered = 500, observedAt = new Date().toISOString() }) {
  const base = sdk.validateSourceUrl(baseUrl);
  if (new URL(base).pathname !== '/') throw new Error('The example base URL must be an HTTPS origin without a path.');
  const bitmap = renderEmailOpenRate({ opened, delivered });
  const hash = sdk.hashBitmap(bitmap);
  const frameName = `${hash}.bin`;
  const feed = sdk.buildFeed({ bitmap, frameUrl: new URL(`frames/${frameName}`, base).href,
    feedUrl: new URL('feed.json', base).href, observedAt,
    led: { mode: 'solid', color: opened / delivered >= 0.30 ? 'green' : 'red' } });
  // Publish immutable content first, then atomically replace the complete feed.
  writeAtomic(path.join(out, 'frames', frameName), bitmap);
  writeAtomic(path.join(out, 'preview.png'), sdk.bitmapToPng(bitmap));
  writeAtomic(path.join(out, 'feed.json'), `${JSON.stringify(feed)}\n`);
  return feed;
}

if (require.main === module) {
  try {
    const { options, positional } = parseArgs(process.argv.slice(2), ['--out', '--base-url', '--opened', '--delivered', '--observed-at']);
    if (positional.length || !options['--out'] || !options['--base-url']) throw new Error('Usage: node examples/generate.js --out ./display-output --base-url https://display.example.com [--opened 162 --delivered 500 --observed-at UTC-ISO]');
    generate({ out: options['--out'], baseUrl: options['--base-url'],
      opened: options['--opened'] === undefined ? 162 : Number(options['--opened']),
      delivered: options['--delivered'] === undefined ? 500 : Number(options['--delivered']),
      observedAt: options['--observed-at'] });
    process.stdout.write('Synthetic email metric generated: feed.json, immutable frame, preview.png. No real email account was accessed.\n');
  } catch (error) {
    process.stderr.write(`${error.code && !(error instanceof sdk.DisplayValidationError) ? 'Could not write the local example files.' : error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { generate };
